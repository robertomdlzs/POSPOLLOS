import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Paginación por cursor para cualquier listado: `?limite=50&cursor=...`.
 *
 * Se pagina por (fecha, id) de la más nueva a la más vieja, no por número de
 * página: así, si entran ventas nuevas mientras alguien recorre la lista, no
 * se repiten ni se saltan filas.
 *
 * Uso en un servicio:
 *
 *   const params: unknown[] = [u.sedeId];
 *   const filas = await this.db.query(
 *     `SELECT v.id, v.total, v.creado_en::text AS cursor_fecha
 *        FROM venta v
 *       WHERE v.sede_id = $1 ${condicionCursor(p.cursor, 'v.creado_en', 'v.id', params)}
 *       ORDER BY v.creado_en DESC, v.id DESC
 *       LIMIT ${limiteConsulta(p)}`,
 *     params,
 *   );
 *   return paginar(filas, p);
 *
 * La fecha se selecciona como texto (`::text`): PostgreSQL la guarda con
 * microsegundos y un Date de JavaScript solo tiene milisegundos, así que pasarla
 * por Date haría que el cursor se saltara filas.
 */
export const LIMITE_POR_DEFECTO = 50;
export const LIMITE_MAXIMO = 200;

export class PaginacionDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(LIMITE_MAXIMO)
  limite?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}

export interface Pagina<T> {
  datos: T[];
  /** Cursor para pedir la siguiente página, o null si no hay más */
  siguiente: string | null;
}

interface Cursor {
  fecha: string;
  id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const codificarCursor = (c: Cursor) => Buffer.from(JSON.stringify([c.fecha, c.id])).toString('base64url');

export function leerCursor(texto: string): Cursor {
  try {
    const [fecha, id] = JSON.parse(Buffer.from(texto, 'base64url').toString('utf8'));
    if (typeof fecha === 'string' && !Number.isNaN(Date.parse(fecha)) && typeof id === 'string' && UUID_RE.test(id)) {
      return { fecha, id };
    }
  } catch {
    /* cae al error de abajo */
  }
  throw new BadRequestException('Cursor de paginación inválido');
}

/** Filas a pedir: una de más, para saber si hay otra página sin contar todo */
export const limiteConsulta = (p: PaginacionDto) => (p.limite ?? LIMITE_POR_DEFECTO) + 1;

/**
 * Fragmento `AND (fecha, id) < (...)` para el WHERE, o vacío en la primera
 * página. Agrega sus valores al final de `params`.
 */
export function condicionCursor(cursor: string | undefined, columnaFecha: string, columnaId: string, params: unknown[]) {
  if (!cursor) return '';
  const c = leerCursor(cursor);
  params.push(c.fecha, c.id);
  return `AND (${columnaFecha}, ${columnaId}) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
}

/** Corta la fila de más y arma el cursor siguiente a partir de `cursor_fecha` e `id` */
export function paginar<T extends { id: string; cursor_fecha: string }>(
  filas: T[],
  p: PaginacionDto,
): Pagina<Omit<T, 'cursor_fecha'>> {
  const limite = p.limite ?? LIMITE_POR_DEFECTO;
  const pagina = filas.slice(0, limite);
  const ultima = pagina[pagina.length - 1];
  return {
    datos: pagina.map(({ cursor_fecha: _, ...resto }) => resto),
    siguiente: filas.length > limite && ultima ? codificarCursor({ fecha: ultima.cursor_fecha, id: ultima.id }) : null,
  };
}
