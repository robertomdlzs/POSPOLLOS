import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { exigeContrasena, problemaContrasena, problemaPin } from '../common/credenciales';
import { condicionCursor, limiteConsulta, paginar } from '../common/paginacion';
import { CLAVE_ADMIN, permisosDeRol, type Permiso } from '../common/permisos';
import { RevocacionService } from '../common/revocacion';
import type { UsuarioToken } from '../common/tipos';
import { DatabaseService, Db } from '../database/database.service';
import {
  ActualizarRolDto,
  ActualizarUsuarioDto,
  AsignacionRolDto,
  CrearUsuarioDto,
  FiltroUsuariosDto,
  GuardarRolDto,
} from './usuarios.dto';

interface RolFila {
  id: string;
  nombre: string;
  descripcion: string | null;
  clave: string | null;
  permisos: Permiso[];
}

const COSTO_BCRYPT = 10;

/**
 * Usuarios y roles de la empresa. Regla de fondo: nadie da más poder del que
 * tiene. Solo se asignan roles y permisos que uno mismo tenga, y no se puede
 * editar a alguien que tenga permisos que uno no tiene. Así quien administra
 * usuarios no se puede volver admin a sí mismo ni tocar al admin.
 */
@Injectable()
export class UsuariosService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditoria: AuditoriaService,
    private readonly revocacion: RevocacionService,
  ) {}

  // ------------------------------------------------------------------ usuarios

  async listar(f: FiltroUsuariosDto, u: UsuarioToken) {
    const params: unknown[] = [u.empresaId];
    let buscar = '';
    if (f.buscar?.trim()) {
      params.push(`%${f.buscar.trim()}%`);
      buscar = `AND (us.nombre ILIKE $${params.length} OR us.email ILIKE $${params.length})`;
    }
    const filas = await this.db.query(
      `SELECT us.id, us.nombre, us.email, us.activo, us.creado_en::text AS cursor_fecha,
              us.pin_hash IS NOT NULL AS "tienePin", us.password_hash IS NOT NULL AS "tieneContrasena",
              COALESCE((SELECT json_agg(json_build_object('sedeId', s.id, 'sede', s.nombre, 'rolId', r.id, 'rol', r.nombre) ORDER BY s.nombre)
                          FROM usuario_sede_rol x JOIN sede s ON s.id = x.sede_id JOIN rol r ON r.id = x.rol_id
                         WHERE x.usuario_id = us.id), '[]') AS roles
         FROM usuario us
        WHERE us.empresa_id = $1 ${buscar} ${condicionCursor(f.cursor, 'us.creado_en', 'us.id', params)}
        ORDER BY us.creado_en DESC, us.id DESC
        LIMIT ${limiteConsulta(f)}`,
      params,
    );
    return paginar(filas, f);
  }

  async obtener(id: string, u: UsuarioToken, db?: Db) {
    const fila = await this.db.one(
      `SELECT us.id, us.nombre, us.email, us.activo, us.creado_en AS "creadoEn",
              us.pin_hash IS NOT NULL AS "tienePin", us.password_hash IS NOT NULL AS "tieneContrasena",
              COALESCE((SELECT json_agg(json_build_object('sedeId', s.id, 'sede', s.nombre, 'rolId', r.id, 'rol', r.nombre) ORDER BY s.nombre)
                          FROM usuario_sede_rol x JOIN sede s ON s.id = x.sede_id JOIN rol r ON r.id = x.rol_id
                         WHERE x.usuario_id = us.id), '[]') AS roles
         FROM usuario us
        WHERE us.id = $1 AND us.empresa_id = $2`,
      [id, u.empresaId],
      db,
    );
    if (!fila) throw new NotFoundException('Usuario no encontrado');
    return fila;
  }

  async crear(dto: CrearUsuarioDto, u: UsuarioToken) {
    if (!dto.pin && !dto.password) throw new BadRequestException('Asígnale un PIN o una contraseña para que pueda entrar');
    this.validarCredenciales(dto.pin, dto.password);
    const id = await this.db.transaction(async (c) => {
      const roles = await this.validarAsignaciones(dto.roles, u, c);
      this.exigirAccesoPosible(roles, { email: dto.email, conContrasena: !!dto.password });
      const nuevo = await this.db.one<{ id: string }>(
        `INSERT INTO usuario (empresa_id, nombre, email, pin_hash, password_hash)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [u.empresaId, dto.nombre.trim(), dto.email?.trim().toLowerCase() || null, await this.hash(dto.pin), await this.hash(dto.password)],
        c,
      ).catch(this.correoDuplicado);
      await this.guardarAsignaciones(nuevo!.id, dto.roles, c);
      await this.auditoria.registrar(
        { usuarioId: u.id, accion: 'usuario_crear', entidad: 'usuario', entidadId: nuevo!.id, datos: { nombre: dto.nombre, roles: roles.map((r) => r.nombre) } },
        c,
      );
      return nuevo!.id;
    });
    return this.obtener(id, u);
  }

  async actualizar(id: string, dto: ActualizarUsuarioDto, u: UsuarioToken) {
    if (dto.activo === false && id === u.id) throw new BadRequestException('No te puedes desactivar a ti mismo');
    const desactivado = await this.db.transaction(async (c) => {
      const antes = await this.bloquearEditable(id, u, c);
      if (dto.activo === false && antes.activo) await this.exigirOtroAdmin(id, u.empresaId, c);
      if (dto.email === null && antes.password_hash) {
        const roles = await this.rolesAsignados(id, c);
        if (roles.some((r) => exigeContrasena(r.permisos))) throw new BadRequestException('Su rol entra con correo: no se le puede quitar');
      }
      await this.db
        .query(
          `UPDATE usuario SET nombre = COALESCE($2, nombre),
                              email = CASE WHEN $3::boolean THEN $4 ELSE email END,
                              activo = COALESCE($5, activo)
            WHERE id = $1`,
          [id, dto.nombre?.trim() ?? null, dto.email !== undefined, dto.email?.trim().toLowerCase() || null, dto.activo ?? null],
          c,
        )
        .catch(this.correoDuplicado);
      await this.auditoria.registrar(
        { usuarioId: u.id, accion: 'usuario_editar', entidad: 'usuario', entidadId: id, datos: dto },
        c,
      );
      if (dto.activo === false && antes.activo) await this.cerrarSesionesEnBase(id, c);
      return dto.activo === false && antes.activo;
    });
    if (desactivado) this.revocacion.revocar({ tipo: 'usuario', id });
    return this.obtener(id, u);
  }

  async cambiarPin(id: string, pin: string, u: UsuarioToken) {
    this.validarCredenciales(pin, undefined);
    await this.db.transaction(async (c) => {
      await this.bloquearEditable(id, u, c);
      await this.db.query(
        `UPDATE usuario SET pin_hash = $2, intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1`,
        [id, await this.hash(pin)],
        c,
      );
      await this.auditoria.registrar({ usuarioId: u.id, accion: 'usuario_pin', entidad: 'usuario', entidadId: id }, c);
    });
    return this.obtener(id, u);
  }

  async cambiarContrasena(id: string, password: string, u: UsuarioToken) {
    this.validarCredenciales(undefined, password);
    await this.db.transaction(async (c) => {
      const antes = await this.bloquearEditable(id, u, c);
      if (!antes.email) throw new BadRequestException('Primero asígnale un correo: con él entra junto a la contraseña');
      await this.db.query(
        `UPDATE usuario SET password_hash = $2, intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1`,
        [id, await this.hash(password)],
        c,
      );
      // Una contraseña nueva cierra las sesiones abiertas (por si la anterior se filtró)
      if (id !== u.id) await this.cerrarSesionesEnBase(id, c);
      await this.auditoria.registrar({ usuarioId: u.id, accion: 'usuario_contrasena', entidad: 'usuario', entidadId: id }, c);
    });
    if (id !== u.id) this.revocacion.revocar({ tipo: 'usuario', id });
    return this.obtener(id, u);
  }

  async asignarRoles(id: string, asignaciones: AsignacionRolDto[], u: UsuarioToken) {
    if (id === u.id) throw new BadRequestException('No puedes cambiar tu propio rol');
    await this.db.transaction(async (c) => {
      const antes = await this.bloquearEditable(id, u, c);
      const roles = await this.validarAsignaciones(asignaciones, u, c);
      this.exigirAccesoPosible(roles, { email: antes.email, conContrasena: !!antes.password_hash });
      const eraAdmin = (await this.rolesAsignados(id, c)).some((r) => r.clave === CLAVE_ADMIN);
      if (eraAdmin && !roles.some((r) => r.clave === CLAVE_ADMIN)) await this.exigirOtroAdmin(id, u.empresaId, c);
      await this.db.query(`DELETE FROM usuario_sede_rol WHERE usuario_id = $1`, [id], c);
      await this.guardarAsignaciones(id, asignaciones, c);
      await this.auditoria.registrar(
        { usuarioId: u.id, accion: 'usuario_roles', entidad: 'usuario', entidadId: id, datos: { roles: asignaciones } },
        c,
      );
    });
    // Sus tokens dejan de servir ya: al renovarlos recibe los permisos nuevos
    this.revocacion.revocar({ tipo: 'usuario', id });
    return this.obtener(id, u);
  }

  async cerrarSesiones(id: string, u: UsuarioToken) {
    await this.db.transaction(async (c) => {
      await this.bloquearEditable(id, u, c);
      await this.cerrarSesionesEnBase(id, c);
      await this.auditoria.registrar({ usuarioId: u.id, accion: 'usuario_cerrar_sesiones', entidad: 'usuario', entidadId: id }, c);
    });
    this.revocacion.revocar({ tipo: 'usuario', id });
  }

  // --------------------------------------------------------------------- roles

  async listarRoles(u: UsuarioToken) {
    const roles = await this.rolesDeEmpresa(u.empresaId);
    const usos = await this.db.query<{ rol_id: string; n: number }>(
      `SELECT x.rol_id, count(DISTINCT x.usuario_id)::int AS n
         FROM usuario_sede_rol x JOIN rol r ON r.id = x.rol_id
        WHERE r.empresa_id = $1 GROUP BY x.rol_id`,
      [u.empresaId],
    );
    return roles.map((r) => ({
      ...r,
      usuarios: usos.find((x) => x.rol_id === r.id)?.n ?? 0,
      // El admin no se edita; los roles con permisos que uno no tiene, tampoco
      editable: r.clave !== CLAVE_ADMIN && r.permisos.every((p) => u.permisos.includes(p)),
    }));
  }

  async crearRol(dto: GuardarRolDto, u: UsuarioToken) {
    this.exigirOtorgables(dto.permisos, u);
    const id = await this.db.transaction(async (c) => {
      const rol = await this.db
        .one<{ id: string }>(
          `INSERT INTO rol (empresa_id, nombre, descripcion) VALUES ($1, $2, $3) RETURNING id`,
          [u.empresaId, dto.nombre.trim(), dto.descripcion?.trim() || null],
          c,
        )
        .catch(this.nombreRolDuplicado);
      await this.guardarPermisos(rol!.id, dto.permisos, c);
      await this.auditoria.registrar(
        { usuarioId: u.id, accion: 'rol_crear', entidad: 'rol', entidadId: rol!.id, datos: { nombre: dto.nombre, permisos: dto.permisos } },
        c,
      );
      return rol!.id;
    });
    return (await this.listarRoles(u)).find((r) => r.id === id);
  }

  async actualizarRol(id: string, dto: ActualizarRolDto, u: UsuarioToken) {
    const afectados = await this.db.transaction(async (c) => {
      const rol = await this.rolEditable(id, u, c);
      if (dto.permisos) this.exigirOtorgables(dto.permisos, u);
      await this.db
        .query(
          `UPDATE rol SET nombre = COALESCE($2, nombre), descripcion = COALESCE($3, descripcion) WHERE id = $1`,
          [id, dto.nombre?.trim() ?? null, dto.descripcion?.trim() ?? null],
          c,
        )
        .catch(this.nombreRolDuplicado);
      if (dto.permisos) {
        // Si alguien con este rol tiene permisos de administración, debe poder entrar con contraseña
        if (exigeContrasena(dto.permisos) && !exigeContrasena(rol.permisos)) {
          const sinCorreo = await this.db.one(
            `SELECT us.nombre FROM usuario_sede_rol x JOIN usuario us ON us.id = x.usuario_id
              WHERE x.rol_id = $1 AND (us.email IS NULL OR us.password_hash IS NULL) LIMIT 1`,
            [id],
            c,
          );
          if (sinCorreo) throw new BadRequestException(`Con esos permisos se entra con correo y contraseña, y ${sinCorreo.nombre} no los tiene`);
        }
        await this.db.query(`DELETE FROM rol_permiso WHERE rol_id = $1`, [id], c);
        await this.guardarPermisos(id, dto.permisos, c);
      }
      await this.auditoria.registrar(
        { usuarioId: u.id, accion: 'rol_editar', entidad: 'rol', entidadId: id, datos: { antes: rol.permisos, ...dto } },
        c,
      );
      return dto.permisos ? (await this.db.query<{ usuario_id: string }>(`SELECT DISTINCT usuario_id FROM usuario_sede_rol WHERE rol_id = $1`, [id], c)).map((x) => x.usuario_id) : [];
    });
    // Quienes tienen el rol reciben los permisos nuevos al renovar el token, ya
    for (const usuarioId of afectados) this.revocacion.revocar({ tipo: 'usuario', id: usuarioId });
    return (await this.listarRoles(u)).find((r) => r.id === id);
  }

  async borrarRol(id: string, u: UsuarioToken) {
    await this.db.transaction(async (c) => {
      const rol = await this.rolEditable(id, u, c);
      if (rol.clave) throw new BadRequestException('Los roles de fábrica no se borran; puedes cambiar sus permisos');
      const enUso = await this.db.one(`SELECT 1 FROM usuario_sede_rol WHERE rol_id = $1 LIMIT 1`, [id], c);
      if (enUso) throw new ConflictException('Hay usuarios con este rol: asígnales otro antes de borrarlo');
      await this.db.query(`DELETE FROM rol WHERE id = $1`, [id], c);
      await this.auditoria.registrar({ usuarioId: u.id, accion: 'rol_borrar', entidad: 'rol', entidadId: id, datos: { nombre: rol.nombre } }, c);
    });
  }

  // ------------------------------------------------------------------ apoyo

  private async rolesDeEmpresa(empresaId: string, db?: Db): Promise<RolFila[]> {
    const filas = await this.db.query<{ id: string; nombre: string; descripcion: string | null; clave: string | null; permisos: string[] }>(
      `SELECT r.id, r.nombre, r.descripcion, r.clave,
              COALESCE(array_agg(rp.permiso) FILTER (WHERE rp.permiso IS NOT NULL), '{}') AS permisos
         FROM rol r LEFT JOIN rol_permiso rp ON rp.rol_id = r.id
        WHERE r.empresa_id = $1
        GROUP BY r.id
        ORDER BY r.clave IS NULL, r.nombre`,
      [empresaId],
      db,
    );
    return filas.map((r) => ({ ...r, permisos: permisosDeRol(r.clave, r.permisos) }));
  }

  private async rolesAsignados(usuarioId: string, db: Db): Promise<RolFila[]> {
    const filas = await this.db.query<{ id: string; nombre: string; descripcion: string | null; clave: string | null; permisos: string[] }>(
      `SELECT DISTINCT r.id, r.nombre, r.descripcion, r.clave,
              ARRAY(SELECT permiso FROM rol_permiso WHERE rol_id = r.id) AS permisos
         FROM usuario_sede_rol x JOIN rol r ON r.id = x.rol_id
        WHERE x.usuario_id = $1`,
      [usuarioId],
      db,
    );
    return filas.map((r) => ({ ...r, permisos: permisosDeRol(r.clave, r.permisos) }));
  }

  /** Bloquea al usuario y comprueba que quien edita tenga todos los permisos que él tiene */
  private async bloquearEditable(id: string, u: UsuarioToken, db: Db) {
    const fila = await this.db.one<{ id: string; activo: boolean; email: string | null; password_hash: string | null }>(
      `SELECT id, activo, email, password_hash FROM usuario WHERE id = $1 AND empresa_id = $2 FOR UPDATE`,
      [id, u.empresaId],
      db,
    );
    if (!fila) throw new NotFoundException('Usuario no encontrado');
    if (id !== u.id) {
      const suyos = (await this.rolesAsignados(id, db)).flatMap((r) => r.permisos);
      if (suyos.some((p) => !u.permisos.includes(p))) {
        throw new ForbiddenException('Este usuario tiene permisos que tú no tienes: no lo puedes modificar');
      }
    }
    return fila;
  }

  private async validarAsignaciones(asignaciones: AsignacionRolDto[], u: UsuarioToken, db: Db): Promise<RolFila[]> {
    const sedes = asignaciones.map((a) => a.sedeId);
    if (new Set(sedes).size !== sedes.length) throw new BadRequestException('Cada sede puede tener un solo rol por usuario');
    if (sedes.length) {
      const validas = await this.db.query(`SELECT id FROM sede WHERE id = ANY($1::uuid[]) AND empresa_id = $2 AND activa`, [sedes, u.empresaId], db);
      if (validas.length !== sedes.length) throw new BadRequestException('Hay una sede que no existe o está cerrada');
    }
    const roles = await this.rolesDeEmpresa(u.empresaId, db);
    return asignaciones.map((a) => {
      const rol = roles.find((r) => r.id === a.rolId);
      if (!rol) throw new BadRequestException('Hay un rol que no existe');
      if (rol.permisos.some((p) => !u.permisos.includes(p))) {
        throw new ForbiddenException(`No puedes asignar el rol ${rol.nombre}: tiene permisos que tú no tienes`);
      }
      return rol;
    });
  }

  private exigirAccesoPosible(roles: RolFila[], u: { email?: string | null; conContrasena: boolean }) {
    if (roles.some((r) => exigeContrasena(r.permisos)) && (!u.email || !u.conContrasena)) {
      throw new BadRequestException('Ese rol entra con correo y contraseña: asígnale ambos');
    }
  }

  private exigirOtorgables(permisos: Permiso[], u: UsuarioToken) {
    const ajenos = permisos.filter((p) => !u.permisos.includes(p));
    if (ajenos.length) throw new ForbiddenException(`No puedes dar permisos que no tienes: ${ajenos.join(', ')}`);
  }

  private async rolEditable(id: string, u: UsuarioToken, db: Db): Promise<RolFila> {
    await this.db.one(`SELECT id FROM rol WHERE id = $1 AND empresa_id = $2 FOR UPDATE`, [id, u.empresaId], db);
    const rol = (await this.rolesDeEmpresa(u.empresaId, db)).find((r) => r.id === id);
    if (!rol) throw new NotFoundException('Rol no encontrado');
    if (rol.clave === CLAVE_ADMIN) throw new BadRequestException('El rol de administración siempre tiene todos los permisos');
    if (rol.permisos.some((p) => !u.permisos.includes(p))) throw new ForbiddenException('Este rol tiene permisos que tú no tienes');
    return rol;
  }

  /** Que quede al menos otro admin activo en la empresa */
  private async exigirOtroAdmin(usuarioId: string, empresaId: string, db: Db) {
    const otro = await this.db.one(
      `SELECT 1 FROM usuario_sede_rol x JOIN rol r ON r.id = x.rol_id JOIN usuario us ON us.id = x.usuario_id
        WHERE r.empresa_id = $1 AND r.clave = $2 AND us.activo AND us.id <> $3 LIMIT 1`,
      [empresaId, CLAVE_ADMIN, usuarioId],
      db,
    );
    if (!otro) throw new BadRequestException('Es el único administrador activo: asigna otro antes');
  }

  private async guardarAsignaciones(usuarioId: string, asignaciones: AsignacionRolDto[], db: Db) {
    for (const a of asignaciones) {
      await this.db.query(`INSERT INTO usuario_sede_rol (usuario_id, sede_id, rol_id) VALUES ($1, $2, $3)`, [usuarioId, a.sedeId, a.rolId], db);
    }
  }

  private async guardarPermisos(rolId: string, permisos: Permiso[], db: Db) {
    if (permisos.length) {
      await this.db.query(`INSERT INTO rol_permiso (rol_id, permiso) SELECT $1, unnest($2::text[])`, [rolId, permisos], db);
    }
  }

  private async cerrarSesionesEnBase(usuarioId: string, db: Db) {
    await this.db.query(`UPDATE sesion SET revocada_en = now() WHERE usuario_id = $1 AND revocada_en IS NULL`, [usuarioId], db);
  }

  private validarCredenciales(pin?: string, password?: string) {
    const problema = (pin !== undefined && problemaPin(pin)) || (password !== undefined && problemaContrasena(password));
    if (problema) throw new BadRequestException(problema);
  }

  private hash = (secreto?: string) => (secreto ? bcrypt.hash(secreto, COSTO_BCRYPT) : Promise.resolve(null));

  private correoDuplicado = (e: any): never => {
    if (e?.code === '23505') throw new ConflictException('Ese correo ya lo usa otro usuario');
    throw e;
  };

  private nombreRolDuplicado = (e: any): never => {
    if (e?.code === '23505') throw new ConflictException('Ya hay un rol con ese nombre');
    throw e;
  };
}
