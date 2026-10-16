import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AutorizacionDto } from '../common/dto';
import { PERMISOS, permisosDeRol, type Permiso } from '../common/permisos';
import { RevocacionService } from '../common/revocacion';
import type { UsuarioToken } from '../common/tipos';
import { config } from '../config';
import { DatabaseService, Db } from '../database/database.service';
import { LoginPasswordDto, LoginPinDto } from './auth.dto';

const MAX_INTENTOS = 5;
const MINUTOS_BLOQUEO = 5;
// Hash de relleno para que un email inexistente tarde lo mismo que uno real
const HASH_RELLENO = bcrypt.hashSync('relleno-no-usar', 10);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface UsuarioFila {
  id: string;
  nombre: string;
  empresa_id: string;
  activo: boolean;
  pin_hash: string | null;
  password_hash: string | null;
  intentos_fallidos: number;
  bloqueado_hasta: Date | null;
}

interface RolEnSede {
  id: string;
  nombre: string;
  clave: string | null;
  permisos: Permiso[];
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
    private readonly auditoria: AuditoriaService,
    private readonly revocacion: RevocacionService,
  ) {}

  /**
   * Lista para la pantalla de "toca tu nombre y escribe tu PIN": quienes tienen
   * PIN y un rol en alguna sede. `rol` es la clave del rol de fábrica (o null);
   * se conserva mientras el frontend pasa a usar rolNombre y permisos.
   */
  usuariosConPin() {
    return this.db.query(
      `SELECT DISTINCT ON (u.nombre, u.id) u.id, u.nombre, r.nombre AS "rolNombre", r.clave AS "rolClave", r.clave AS rol
         FROM usuario u
         JOIN usuario_sede_rol x ON x.usuario_id = u.id
         JOIN sede s ON s.id = x.sede_id AND s.activa
         JOIN rol r ON r.id = x.rol_id
        WHERE u.activo AND u.pin_hash IS NOT NULL
        ORDER BY u.nombre, u.id, s.creado_en`,
    );
  }

  /** Quienes pueden aprobar con su PIN una acción que exige `permiso`, en la sede de quien pide */
  async autorizadores(permiso: Permiso, u: UsuarioToken) {
    const filas = await this.db.query<{ id: string; nombre: string; clave: string | null; permisos: string[] }>(
      `SELECT us.id, us.nombre, r.clave,
              COALESCE(array_agg(rp.permiso) FILTER (WHERE rp.permiso IS NOT NULL), '{}') AS permisos
         FROM usuario_sede_rol x
         JOIN usuario us ON us.id = x.usuario_id AND us.activo AND us.pin_hash IS NOT NULL
         JOIN rol r ON r.id = x.rol_id
         LEFT JOIN rol_permiso rp ON rp.rol_id = r.id
        WHERE x.sede_id = $1
        GROUP BY us.id, r.id
        ORDER BY us.nombre`,
      [u.sedeId],
    );
    return filas.filter((f) => permisosDeRol(f.clave, f.permisos).includes(permiso)).map(({ id, nombre }) => ({ id, nombre }));
  }

  async loginPin(dto: LoginPinDto, dispositivo?: string) {
    const u = await this.verificarCredencial(dto.usuarioId, 'pin_hash', dto.pin);
    return this.db.transaction((c) => this.crearSesion(c, u, dto.sedeId, dispositivo));
  }

  async loginPassword(dto: LoginPasswordDto, dispositivo?: string) {
    const fila = await this.db.one<{ id: string }>(
      `SELECT id FROM usuario WHERE lower(email) = lower($1)`,
      [dto.email],
    );
    if (!fila) {
      await bcrypt.compare(dto.password, HASH_RELLENO);
      throw new UnauthorizedException('Credenciales inválidas');
    }
    const u = await this.verificarCredencial(fila.id, 'password_hash', dto.password);
    return this.db.transaction((c) => this.crearSesion(c, u, dto.sedeId, dispositivo));
  }

  /**
   * Refresh rotativo: cada refresh token sirve una sola vez. Si alguien
   * reutiliza uno ya usado, asumimos robo y cerramos todas las sesiones.
   */
  async refrescar(refreshToken: string, dispositivo?: string) {
    const [id, secreto] = refreshToken.split('.');
    if (!id || !secreto || !UUID_RE.test(id)) throw new UnauthorizedException('Sesión inválida');

    type Resultado =
      | { invalida: true }
      | { reutilizada: true; usuarioId: string }
      | { sesion: Awaited<ReturnType<AuthService['crearSesion']>> };

    const resultado = await this.db.transaction(async (c): Promise<Resultado> => {
      const s = await this.db.one(
        `SELECT s.id, s.usuario_id, s.sede_id, s.token_hash, s.expira_en, s.revocada_en,
                u.nombre, u.empresa_id, u.activo
           FROM sesion s JOIN usuario u ON u.id = s.usuario_id
          WHERE s.id = $1
          FOR UPDATE OF s`,
        [id],
        c,
      );
      if (!s || !this.hashIgual(sha256(secreto), s.token_hash)) return { invalida: true };
      if (s.revocada_en) return { reutilizada: true, usuarioId: s.usuario_id };
      if (new Date(s.expira_en) < new Date() || !s.activo) return { invalida: true };

      await this.db.query(`UPDATE sesion SET revocada_en = now() WHERE id = $1`, [s.id], c);
      // Los permisos se vuelven a leer: un cambio de rol se aplica al renovar el token
      const usuario = { id: s.usuario_id, nombre: s.nombre, empresa_id: s.empresa_id };
      return { sesion: await this.crearSesion(c, usuario, s.sede_id, dispositivo) };
    });

    if ('reutilizada' in resultado) {
      await this.db.query(
        `UPDATE sesion SET revocada_en = now() WHERE usuario_id = $1 AND revocada_en IS NULL`,
        [resultado.usuarioId],
      );
      // Posible robo: también dejan de servir los access tokens que ya circulan
      this.revocacion.revocar({ tipo: 'usuario', id: resultado.usuarioId });
      await this.auditoria.registrar({
        usuarioId: resultado.usuarioId,
        accion: 'refresh_reutilizado',
        entidad: 'sesion',
        entidadId: id,
        dispositivo,
      });
      throw new UnauthorizedException('Sesión inválida');
    }
    if ('invalida' in resultado) throw new UnauthorizedException('Sesión inválida o vencida');
    return resultado.sesion;
  }

  /**
   * Comprueba el PIN del usuario de la sesión, sin crear otra. Los fallos
   * cuentan para el bloqueo como en el ingreso normal.
   */
  async desbloquear(u: UsuarioToken, pin: string) {
    await this.verificarCredencial(u.id, 'pin_hash', pin);
  }

  async cerrarSesion(refreshToken: string) {
    const [id, secreto] = refreshToken.split('.');
    if (!id || !secreto || !UUID_RE.test(id)) return;
    const cerrada = await this.db.one(
      `UPDATE sesion SET revocada_en = now() WHERE id = $1 AND token_hash = $2 AND revocada_en IS NULL RETURNING id`,
      [id, sha256(secreto)],
    );
    // El access token de este dispositivo deja de servir ya, no en 15 minutos
    if (cerrada) this.revocacion.revocar({ tipo: 'sesion', id: cerrada.id });
  }

  /**
   * Valida el PIN de quien aprueba una acción sensible (descuento, anulación,
   * retiro de caja…): tiene que tener `permiso` en la sede de quien la pide.
   * Devuelve su id para la auditoría.
   *
   * Los intentos fallidos se cuentan contra quien pide la autorización y no
   * contra el supervisor, para que un cajero no lo pueda dejar bloqueado.
   * Estas consultas van por el pool, fuera de la transacción de quien llama,
   * para que el contador no se revierta junto con la acción rechazada.
   */
  async verificarAutorizacion(aut: AutorizacionDto, permiso: Permiso, solicitante: UsuarioToken): Promise<string> {
    const s = await this.db.one<{ autorizacion_bloqueada_hasta: Date | null; intentos_autorizacion: number }>(
      `SELECT autorizacion_bloqueada_hasta, intentos_autorizacion FROM usuario WHERE id = $1`,
      [solicitante.id],
    );
    if (s?.autorizacion_bloqueada_hasta && new Date(s.autorizacion_bloqueada_hasta) > new Date()) {
      throw new HttpException('Demasiadas autorizaciones fallidas. Espera unos minutos', 423);
    }

    let sup: UsuarioFila | null = null;
    try {
      sup = await this.verificarCredencial(aut.supervisorId, 'pin_hash', aut.pin, false);
    } catch (e) {
      if (!(e instanceof UnauthorizedException)) throw e;
    }
    const rol = sup && sup.empresa_id === solicitante.empresaId ? await this.rolEnSede(sup.id, solicitante.sedeId) : null;
    const puede = !!rol?.permisos.includes(permiso);
    if (!puede) {
      await this.db.query(
        `UPDATE usuario
            SET autorizacion_bloqueada_hasta = CASE WHEN intentos_autorizacion + 1 >= $2
                                                    THEN now() + make_interval(mins => $3) ELSE autorizacion_bloqueada_hasta END,
                intentos_autorizacion        = CASE WHEN intentos_autorizacion + 1 >= $2 THEN 0 ELSE intentos_autorizacion + 1 END
          WHERE id = $1`,
        [solicitante.id, MAX_INTENTOS, MINUTOS_BLOQUEO],
      );
      await this.auditoria.registrar({
        usuarioId: solicitante.id,
        accion: 'autorizacion_fallida',
        entidad: 'usuario',
        entidadId: aut.supervisorId,
      });
      throw new ForbiddenException(
        sup ? `${sup.nombre.split(' ')[0]} no puede aprobar esto: ${PERMISOS[permiso].descripcion.toLowerCase()}` : 'Autorización de supervisor inválida',
      );
    }
    if (s && (s.intentos_autorizacion > 0 || s.autorizacion_bloqueada_hasta)) {
      await this.db.query(
        `UPDATE usuario SET intentos_autorizacion = 0, autorizacion_bloqueada_hasta = NULL WHERE id = $1`,
        [solicitante.id],
      );
    }
    return sup!.id;
  }

  // ---------------------------------------------------------------------

  private async verificarCredencial(
    usuarioId: string,
    campo: 'pin_hash' | 'password_hash',
    secreto: string,
    /** false para las autorizaciones de supervisor: ahí el fallo se cuenta al solicitante */
    contarFallos = true,
  ): Promise<UsuarioFila> {
    const u = await this.db.one<UsuarioFila>(
      `SELECT id, nombre, empresa_id, activo, pin_hash, password_hash, intentos_fallidos, bloqueado_hasta
         FROM usuario WHERE id = $1`,
      [usuarioId],
    );
    if (!u || !u.activo || !u[campo]) {
      await bcrypt.compare(secreto, HASH_RELLENO);
      throw new UnauthorizedException('Credenciales inválidas');
    }
    if (u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) {
      throw new HttpException('Usuario bloqueado temporalmente por intentos fallidos', 423);
    }

    const correcto = await bcrypt.compare(secreto, u[campo]!);
    if (!correcto && !contarFallos) throw new UnauthorizedException('Credenciales inválidas');
    if (!correcto) {
      // Al llegar al límite se bloquea y el contador vuelve a cero
      await this.db.query(
        `UPDATE usuario
            SET bloqueado_hasta   = CASE WHEN intentos_fallidos + 1 >= $2
                                         THEN now() + make_interval(mins => $3) ELSE bloqueado_hasta END,
                intentos_fallidos = CASE WHEN intentos_fallidos + 1 >= $2 THEN 0 ELSE intentos_fallidos + 1 END
          WHERE id = $1`,
        [u.id, MAX_INTENTOS, MINUTOS_BLOQUEO],
      );
      throw new UnauthorizedException('Credenciales inválidas');
    }
    if (contarFallos && (u.intentos_fallidos > 0 || u.bloqueado_hasta)) {
      await this.db.query(`UPDATE usuario SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1`, [u.id]);
    }
    return u;
  }

  private async resolverSede(db: Db, empresaId: string, sedeId?: string): Promise<string> {
    if (sedeId) {
      const s = await this.db.one(`SELECT id FROM sede WHERE id = $1 AND empresa_id = $2 AND activa`, [sedeId, empresaId], db);
      if (!s) throw new BadRequestException('Sede no válida');
      return s.id;
    }
    const sedes = await this.db.query(`SELECT id FROM sede WHERE empresa_id = $1 AND activa`, [empresaId], db);
    if (sedes.length !== 1) throw new BadRequestException('Indica la sede en la que vas a trabajar');
    return sedes[0].id;
  }

  /** Rol del usuario en la sede, con sus permisos efectivos; null si no tiene */
  private async rolEnSede(usuarioId: string, sedeId: string, db?: Db): Promise<RolEnSede | null> {
    const r = await this.db.one<{ id: string; nombre: string; clave: string | null; permisos: string[] }>(
      `SELECT r.id, r.nombre, r.clave,
              COALESCE(array_agg(rp.permiso) FILTER (WHERE rp.permiso IS NOT NULL), '{}') AS permisos
         FROM usuario_sede_rol x
         JOIN rol r ON r.id = x.rol_id
         LEFT JOIN rol_permiso rp ON rp.rol_id = r.id
        WHERE x.usuario_id = $1 AND x.sede_id = $2
        GROUP BY r.id`,
      [usuarioId, sedeId],
      db,
    );
    return r ? { id: r.id, nombre: r.nombre, clave: r.clave, permisos: permisosDeRol(r.clave, r.permisos) } : null;
  }

  private async crearSesion(
    db: Db,
    u: Pick<UsuarioFila, 'id' | 'nombre' | 'empresa_id'>,
    sedeId: string | undefined,
    dispositivo?: string,
  ) {
    const sede = await this.resolverSede(db, u.empresa_id, sedeId);
    const rol = await this.rolEnSede(u.id, sede, db);
    if (!rol) throw new ForbiddenException('No tienes un rol asignado en esta sede');
    const secreto = randomBytes(32).toString('base64url');
    const sesion = await this.db.one<{ id: string }>(
      `INSERT INTO sesion (usuario_id, sede_id, token_hash, expira_en, dispositivo)
       VALUES ($1, $2, $3, now() + make_interval(days => $4), $5) RETURNING id`,
      [u.id, sede, sha256(secreto), config.refreshTtlDias, dispositivo?.slice(0, 200) ?? null],
      db,
    );
    const accessToken = this.jwt.sign({
      sub: u.id,
      sid: sesion!.id,
      emi: Date.now(),
      nombre: u.nombre,
      rolId: rol.id,
      rol: rol.nombre,
      permisos: rol.permisos,
      empresaId: u.empresa_id,
      sedeId: sede,
    });
    return {
      accessToken,
      refreshToken: `${sesion!.id}.${secreto}`,
      expiraEnSegundos: config.accessTtlSegundos,
      usuario: {
        id: u.id,
        nombre: u.nombre,
        rolNombre: rol.nombre,
        // Clave del rol de fábrica; se conserva mientras el frontend pasa a usar permisos
        rol: rol.clave,
        permisos: rol.permisos,
        sedeId: sede,
      },
    };
  }

  private hashIgual(a: string, b: string) {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }
}
