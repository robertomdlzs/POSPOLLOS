import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AuthService } from '../auth/auth.service';
import { aCentavos, aPesos } from '../common/dinero';
import type { UsuarioToken } from '../common/tipos';
import { DatabaseService, Db } from '../database/database.service';
import { AbrirTurnoDto, CerrarTurnoDto, MovimientoCajaDto } from './caja.dto';

export const CAJA_POR_DEFECTO = 'Caja 1';

@Injectable()
export class CajaService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auth: AuthService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async abrir(dto: AbrirTurnoDto, u: UsuarioToken) {
    const caja = dto.caja ?? CAJA_POR_DEFECTO;
    try {
      return await this.db.transaction(async (c) => {
        const turno = await this.db.one(
          `INSERT INTO turno_caja (sede_id, caja, abierto_por, monto_inicial)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [u.sedeId, caja, u.id, aPesos(aCentavos(dto.montoInicial))],
          c,
        );
        await this.auditoria.registrar(
          { usuarioId: u.id, accion: 'abrir_turno', entidad: 'turno_caja', entidadId: turno.id, datos: { caja, montoInicial: dto.montoInicial } },
          c,
        );
        return turno;
      });
    } catch (e: any) {
      if (e?.code === '23505') throw new ConflictException(`Ya hay un turno abierto en ${caja}`);
      throw e;
    }
  }

  async actual(u: UsuarioToken, caja = CAJA_POR_DEFECTO) {
    const turno = await this.db.one(
      `SELECT * FROM turno_caja WHERE sede_id = $1 AND caja = $2 AND estado = 'abierto'`,
      [u.sedeId, caja],
    );
    if (!turno) throw new NotFoundException(`No hay turno abierto en ${caja}`);
    return { ...turno, resumen: await this.resumen(turno.id) };
  }

  async movimiento(turnoId: string, dto: MovimientoCajaDto, u: UsuarioToken) {
    let autorizadoPor: string | null = null;
    if (dto.tipo === 'egreso') {
      if (u.rol === 'supervisor' || u.rol === 'admin') autorizadoPor = u.id;
      else if (dto.autorizacion) autorizadoPor = await this.auth.verificarSupervisor(dto.autorizacion, u);
      else throw new ForbiddenException('Los retiros de caja requieren autorización de un supervisor');
    }
    return this.db.transaction(async (c) => {
      await this.bloquearAbierto(c, turnoId, u);
      const mov = await this.db.one(
        `INSERT INTO movimiento_caja (turno_id, tipo, monto, motivo, usuario_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [turnoId, dto.tipo, aPesos(aCentavos(dto.monto)), dto.motivo, u.id],
        c,
      );
      // Solo los datos del movimiento: el DTO trae el PIN del supervisor y la auditoría no se puede borrar
      await this.auditoria.registrar(
        {
          usuarioId: u.id,
          autorizadoPor,
          accion: `caja_${dto.tipo}`,
          entidad: 'movimiento_caja',
          entidadId: mov.id,
          datos: { tipo: dto.tipo, monto: mov.monto, motivo: dto.motivo },
        },
        c,
      );
      return mov;
    });
  }

  async cerrar(turnoId: string, dto: CerrarTurnoDto, u: UsuarioToken) {
    return this.db.transaction(async (c) => {
      const turno = await this.bloquearAbierto(c, turnoId, u);
      const r = await this.resumen(turnoId, c);
      const esperado = aCentavos(turno.monto_inicial) + aCentavos(r.efectivo) + aCentavos(r.ingresos) - aCentavos(r.egresos);
      const contado = aCentavos(dto.montoContado);

      const cerrado = await this.db.one(
        `UPDATE turno_caja
            SET estado = 'cerrado', cerrado_por = $2, cerrado_en = now(),
                monto_esperado = $3, monto_contado = $4
          WHERE id = $1 RETURNING *`,
        [turnoId, u.id, aPesos(esperado), aPesos(contado)],
        c,
      );
      const diferencia = aPesos(contado - esperado);
      await this.auditoria.registrar(
        {
          usuarioId: u.id,
          accion: 'cerrar_turno',
          entidad: 'turno_caja',
          entidadId: turnoId,
          datos: { esperado: aPesos(esperado), contado: aPesos(contado), diferencia, observacion: dto.observacion },
        },
        c,
      );
      return { turno: cerrado, resumen: r, diferencia };
    });
  }

  /** Totales del turno: ventas, pagos por método y movimientos de efectivo */
  async resumen(turnoId: string, db?: Db) {
    const r = await this.db.one(
      `SELECT
         (SELECT count(*)::int FROM venta WHERE turno_id = $1 AND estado = 'pagada') AS ventas,
         (SELECT COALESCE(sum(total), 0) FROM venta WHERE turno_id = $1 AND estado = 'pagada') AS "totalVentas",
         (SELECT COALESCE(sum(propina), 0) FROM venta WHERE turno_id = $1 AND estado = 'pagada') AS propinas,
         (SELECT count(*)::int FROM venta WHERE turno_id = $1 AND estado = 'anulada') AS anuladas,
         (SELECT COALESCE(sum(pg.monto), 0) FROM pago pg JOIN venta v ON v.id = pg.venta_id
           WHERE v.turno_id = $1 AND v.estado = 'pagada' AND pg.metodo = 'efectivo') AS efectivo,
         (SELECT COALESCE(json_object_agg(metodo, total), '{}') FROM (
             SELECT pg.metodo, sum(pg.monto) AS total FROM pago pg JOIN venta v ON v.id = pg.venta_id
              WHERE v.turno_id = $1 AND v.estado = 'pagada' GROUP BY pg.metodo) x) AS "porMetodo",
         (SELECT COALESCE(sum(monto), 0) FROM movimiento_caja WHERE turno_id = $1 AND tipo = 'ingreso') AS ingresos,
         (SELECT COALESCE(sum(monto), 0) FROM movimiento_caja WHERE turno_id = $1 AND tipo = 'egreso') AS egresos`,
      [turnoId],
      db,
    );
    return r!;
  }

  async bloquearAbierto(db: Db, turnoId: string, u: UsuarioToken) {
    const turno = await this.db.one(
      `SELECT * FROM turno_caja WHERE id = $1 AND sede_id = $2 FOR UPDATE`,
      [turnoId, u.sedeId],
      db,
    );
    if (!turno) throw new NotFoundException('Turno no encontrado');
    if (turno.estado !== 'abierto') throw new BadRequestException('El turno ya está cerrado');
    return turno;
  }
}
