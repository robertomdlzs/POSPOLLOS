import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { CocinaGateway } from '../cocina/cocina.gateway';
import { aCentavos, aPesos } from '../common/dinero';
import type { UsuarioToken } from '../common/tipos';
import { DatabaseService, Db } from '../database/database.service';
import {
  ActualizarCategoriaDto,
  ActualizarGrupoDto,
  ActualizarOpcionDto,
  ActualizarProductoDto,
  CrearCategoriaDto,
  CrearGrupoDto,
  CrearProductoDto,
  OpcionDto,
  ProductoSedeDto,
} from './menu-admin.dto';

const dinero = (n: number) => aPesos(aCentavos(n));

/**
 * Administración del menú: categorías, productos, modificadores, precio por
 * sede y agotados. Cada cambio avisa a las tablets por WebSocket (menu.cambio)
 * para que recarguen el menú, y queda en la auditoría (los cambios de precio
 * con el valor anterior).
 */
@Injectable()
export class MenuAdminService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditoria: AuditoriaService,
    private readonly gateway: CocinaGateway,
  ) {}

  // -------------------------------------------------------------- categorías

  categorias(u: UsuarioToken) {
    return this.db.query(
      `SELECT c.id, c.nombre, c.orden, c.activa,
              (SELECT count(*)::int FROM producto p WHERE p.categoria_id = c.id) AS productos
         FROM categoria c WHERE c.empresa_id = $1
        ORDER BY c.orden, c.nombre`,
      [u.empresaId],
    );
  }

  async crearCategoria(dto: CrearCategoriaDto, u: UsuarioToken) {
    const c = await this.db
      .one(
        `INSERT INTO categoria (empresa_id, nombre, orden)
         VALUES ($1, $2, COALESCE((SELECT max(orden) + 1 FROM categoria WHERE empresa_id = $1), 1))
         RETURNING id, nombre, orden, activa, 0 AS productos`,
        [u.empresaId, dto.nombre.trim()],
      )
      .catch(duplicado('Ya hay una categoría con ese nombre'));
    await this.registrar(u, 'categoria_crear', 'categoria', c.id, { nombre: c.nombre });
    await this.avisar(u);
    return c;
  }

  async actualizarCategoria(id: string, dto: ActualizarCategoriaDto, u: UsuarioToken) {
    const c = await this.db
      .one(
        `UPDATE categoria SET nombre = COALESCE($3, nombre), activa = COALESCE($4, activa)
          WHERE id = $1 AND empresa_id = $2
        RETURNING id, nombre, orden, activa`,
        [id, u.empresaId, dto.nombre?.trim() ?? null, dto.activa ?? null],
      )
      .catch(duplicado('Ya hay una categoría con ese nombre'));
    if (!c) throw new NotFoundException('Categoría no encontrada');
    await this.registrar(u, 'categoria_editar', 'categoria', id, dto);
    await this.avisar(u);
    return c;
  }

  async ordenarCategorias(ids: string[], u: UsuarioToken) {
    await this.db.transaction(async (c) => {
      await this.exigirTodos(c, 'categoria', ids, u.empresaId, 'empresa_id');
      await this.db.query(
        `UPDATE categoria SET orden = x.n FROM unnest($1::uuid[]) WITH ORDINALITY AS x(id, n) WHERE categoria.id = x.id`,
        [ids],
        c,
      );
    });
    await this.avisar(u);
    return this.categorias(u);
  }

  async borrarCategoria(id: string, u: UsuarioToken) {
    const c = await this.db.one(`SELECT nombre FROM categoria WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!c) throw new NotFoundException('Categoría no encontrada');
    const conProductos = await this.db.one(`SELECT 1 FROM producto WHERE categoria_id = $1 LIMIT 1`, [id]);
    if (conProductos) throw new ConflictException('La categoría tiene productos: muévelos o desactiva la categoría');
    await this.db.query(`DELETE FROM categoria WHERE id = $1`, [id]);
    await this.registrar(u, 'categoria_borrar', 'categoria', id, { nombre: c.nombre });
    await this.avisar(u);
  }

  // --------------------------------------------------------------- productos

  /** Todos los productos, también los inactivos, con lo propio de la sede de la sesión */
  productos(u: UsuarioToken, categoriaId?: string) {
    return this.db.query(
      `${SQL_PRODUCTO}
        WHERE p.empresa_id = $1 AND ($3::uuid IS NULL OR p.categoria_id = $3)
        ORDER BY c.orden, c.nombre, p.orden, p.nombre`,
      [u.empresaId, u.sedeId, categoriaId ?? null],
    );
  }

  async producto(id: string, u: UsuarioToken, db?: Db) {
    const p = await this.db.one(`${SQL_PRODUCTO} WHERE p.id = $3 AND p.empresa_id = $1`, [u.empresaId, u.sedeId, id], db);
    if (!p) throw new NotFoundException('Producto no encontrado');
    return p;
  }

  async crearProducto(dto: CrearProductoDto, u: UsuarioToken) {
    const id = await this.db.transaction(async (c) => {
      await this.exigirCategoria(c, dto.categoriaId, u);
      if (dto.estacionId) await this.exigirEstacion(c, dto.estacionId, u);
      const p = await this.db.one<{ id: string }>(
        `INSERT INTO producto (empresa_id, categoria_id, estacion_id, nombre, descripcion, precio, tipo_impuesto,
                               tasa_impuesto, controla_stock, orden)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                 COALESCE((SELECT max(orden) + 1 FROM producto WHERE categoria_id = $2), 1))
         RETURNING id`,
        [
          u.empresaId,
          dto.categoriaId,
          dto.estacionId ?? null,
          dto.nombre.trim(),
          dto.descripcion?.trim() || null,
          dinero(dto.precio),
          dto.tipoImpuesto,
          dto.tasaImpuesto,
          dto.controlaStock ?? false,
        ],
        c,
      );
      if (dto.grupoIds?.length) await this.guardarGrupos(c, p!.id, dto.grupoIds, u);
      await this.registrar(u, 'producto_crear', 'producto', p!.id, { nombre: dto.nombre, precio: dinero(dto.precio) }, c);
      return p!.id;
    });
    await this.avisar(u);
    return this.producto(id, u);
  }

  async actualizarProducto(id: string, dto: ActualizarProductoDto, u: UsuarioToken) {
    await this.db.transaction(async (c) => {
      const antes = await this.db.one(
        `SELECT nombre, precio, activo FROM producto WHERE id = $1 AND empresa_id = $2 FOR UPDATE`,
        [id, u.empresaId],
        c,
      );
      if (!antes) throw new NotFoundException('Producto no encontrado');
      if (dto.categoriaId) await this.exigirCategoria(c, dto.categoriaId, u);
      if (dto.estacionId) await this.exigirEstacion(c, dto.estacionId, u);
      await this.db.query(
        `UPDATE producto SET
            categoria_id   = COALESCE($2, categoria_id),
            nombre         = COALESCE($3, nombre),
            descripcion    = CASE WHEN $4::boolean THEN $5 ELSE descripcion END,
            precio         = COALESCE($6, precio),
            tipo_impuesto  = COALESCE($7::tipo_impuesto, tipo_impuesto),
            tasa_impuesto  = COALESCE($8, tasa_impuesto),
            estacion_id    = CASE WHEN $9::boolean THEN $10::uuid ELSE estacion_id END,
            controla_stock = COALESCE($11, controla_stock),
            activo         = COALESCE($12, activo)
          WHERE id = $1`,
        [
          id,
          dto.categoriaId ?? null,
          dto.nombre?.trim() ?? null,
          dto.descripcion !== undefined,
          dto.descripcion?.trim() || null,
          dto.precio === undefined ? null : dinero(dto.precio),
          dto.tipoImpuesto ?? null,
          dto.tasaImpuesto ?? null,
          dto.estacionId !== undefined,
          dto.estacionId ?? null,
          dto.controlaStock ?? null,
          dto.activo ?? null,
        ],
        c,
      );
      if (dto.grupoIds) {
        await this.db.query(`DELETE FROM producto_grupo_modificador WHERE producto_id = $1`, [id], c);
        await this.guardarGrupos(c, id, dto.grupoIds, u);
      }
      // El precio anterior queda en la auditoría: ahí se ve quién lo cambió y cuándo
      const cambioPrecio = dto.precio !== undefined && aCentavos(antes.precio) !== aCentavos(dto.precio);
      await this.registrar(u, 'producto_editar', 'producto', id, { ...dto, ...(cambioPrecio ? { precioAntes: antes.precio } : {}) }, c);
    });
    await this.avisar(u);
    return this.producto(id, u);
  }

  async ordenarProductos(categoriaId: string, ids: string[], u: UsuarioToken) {
    await this.db.transaction(async (c) => {
      await this.exigirCategoria(c, categoriaId, u);
      const filas = await this.db.query(`SELECT id FROM producto WHERE id = ANY($1::uuid[]) AND categoria_id = $2`, [ids, categoriaId], c);
      if (filas.length !== ids.length) throw new BadRequestException('Hay productos que no son de esa categoría');
      await this.db.query(
        `UPDATE producto SET orden = x.n FROM unnest($1::uuid[]) WITH ORDINALITY AS x(id, n) WHERE producto.id = x.id`,
        [ids],
        c,
      );
    });
    await this.avisar(u);
    return this.productos(u, categoriaId);
  }

  /** Solo se borra lo que nunca se vendió; lo vendido se desactiva para no romper el histórico */
  async borrarProducto(id: string, u: UsuarioToken) {
    const p = await this.db.one(`SELECT nombre FROM producto WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!p) throw new NotFoundException('Producto no encontrado');
    const vendido = await this.db.one(`SELECT 1 FROM pedido_item WHERE producto_id = $1 LIMIT 1`, [id]);
    if (vendido) throw new ConflictException('Este producto ya se vendió: desactívalo en lugar de borrarlo');
    await this.db.transaction(async (c) => {
      await this.db.query(`DELETE FROM receta WHERE producto_id = $1`, [id], c);
      await this.db.query(`DELETE FROM producto WHERE id = $1`, [id], c);
      await this.registrar(u, 'producto_borrar', 'producto', id, { nombre: p.nombre }, c);
    });
    await this.avisar(u);
  }

  /** Precio propio y disponibilidad en una sede */
  async productoEnSede(id: string, sedeId: string, dto: ProductoSedeDto, u: UsuarioToken) {
    await this.db.transaction(async (c) => {
      await this.producto(id, u, c);
      const sede = await this.db.one(`SELECT 1 FROM sede WHERE id = $1 AND empresa_id = $2`, [sedeId, u.empresaId], c);
      if (!sede) throw new NotFoundException('Sede no encontrada');
      await this.db.query(
        `INSERT INTO producto_sede (producto_id, sede_id, precio, disponible)
         VALUES ($1, $2, $3, COALESCE($4, true))
         ON CONFLICT (producto_id, sede_id) DO UPDATE
            SET precio = CASE WHEN $5::boolean THEN EXCLUDED.precio ELSE producto_sede.precio END,
                disponible = COALESCE($4, producto_sede.disponible),
                actualizado_en = now()`,
        [id, sedeId, dto.precio == null ? null : dinero(dto.precio), dto.disponible ?? null, dto.precio !== undefined],
        c,
      );
      await this.registrar(u, 'producto_sede', 'producto', id, { sedeId, ...dto }, c);
    });
    await this.avisar(u);
    return this.producto(id, u);
  }

  /** Se acabó (o volvió a haber) durante el servicio, en la sede de la sesión */
  async agotar(id: string, agotado: boolean, u: UsuarioToken) {
    const p = await this.db.one(`SELECT nombre FROM producto WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!p) throw new NotFoundException('Producto no encontrado');
    await this.db.query(
      `INSERT INTO producto_sede (producto_id, sede_id, agotado) VALUES ($1, $2, $3)
       ON CONFLICT (producto_id, sede_id) DO UPDATE SET agotado = EXCLUDED.agotado, actualizado_en = now()`,
      [id, u.sedeId, agotado],
    );
    await this.registrar(u, agotado ? 'producto_agotado' : 'producto_disponible', 'producto', id, { nombre: p.nombre });
    this.gateway.emitir(u.sedeId, 'menu.cambio', { productoId: id, agotado, producto: p.nombre });
    return { id, nombre: p.nombre, agotado };
  }

  // ----------------------------------------------------------- modificadores

  grupos(u: UsuarioToken) {
    return this.db.query(
      `SELECT g.id, g.nombre, g.min_seleccion AS min, g.max_seleccion AS max, g.orden,
              COALESCE((SELECT json_agg(json_build_object('id', m.id, 'nombre', m.nombre, 'precioExtra', m.precio_extra,
                                                          'activo', m.activo) ORDER BY m.orden, m.nombre)
                          FROM modificador m WHERE m.grupo_id = g.id), '[]') AS opciones,
              (SELECT count(*)::int FROM producto_grupo_modificador pg WHERE pg.grupo_id = g.id) AS productos
         FROM grupo_modificador g WHERE g.empresa_id = $1
        ORDER BY g.orden, g.nombre`,
      [u.empresaId],
    );
  }

  async crearGrupo(dto: CrearGrupoDto, u: UsuarioToken) {
    if (dto.min > dto.max) throw new BadRequestException('El mínimo no puede ser mayor que el máximo');
    const id = await this.db.transaction(async (c) => {
      const g = await this.db
        .one<{ id: string }>(
          `INSERT INTO grupo_modificador (empresa_id, nombre, min_seleccion, max_seleccion, orden)
           VALUES ($1, $2, $3, $4, COALESCE((SELECT max(orden) + 1 FROM grupo_modificador WHERE empresa_id = $1), 1))
           RETURNING id`,
          [u.empresaId, dto.nombre.trim(), dto.min, dto.max],
          c,
        )
        .catch(duplicado('Ya hay un grupo con ese nombre'));
      for (const [i, o] of dto.opciones.entries()) await this.insertarOpcion(c, g!.id, o, i + 1);
      await this.registrar(u, 'grupo_crear', 'grupo_modificador', g!.id, dto, c);
      return g!.id;
    });
    await this.avisar(u);
    return (await this.grupos(u)).find((g) => g.id === id);
  }

  async actualizarGrupo(id: string, dto: ActualizarGrupoDto, u: UsuarioToken) {
    await this.db.transaction(async (c) => {
      const g = await this.db.one(
        `SELECT min_seleccion, max_seleccion FROM grupo_modificador WHERE id = $1 AND empresa_id = $2 FOR UPDATE`,
        [id, u.empresaId],
        c,
      );
      if (!g) throw new NotFoundException('Grupo no encontrado');
      if ((dto.min ?? g.min_seleccion) > (dto.max ?? g.max_seleccion)) {
        throw new BadRequestException('El mínimo no puede ser mayor que el máximo');
      }
      await this.db
        .query(
          `UPDATE grupo_modificador SET nombre = COALESCE($2, nombre), min_seleccion = COALESCE($3, min_seleccion),
                                        max_seleccion = COALESCE($4, max_seleccion)
            WHERE id = $1`,
          [id, dto.nombre?.trim() ?? null, dto.min ?? null, dto.max ?? null],
          c,
        )
        .catch(duplicado('Ya hay un grupo con ese nombre'));
      await this.registrar(u, 'grupo_editar', 'grupo_modificador', id, dto, c);
    });
    await this.avisar(u);
    return (await this.grupos(u)).find((g) => g.id === id);
  }

  async borrarGrupo(id: string, u: UsuarioToken) {
    const g = await this.db.one(`SELECT nombre FROM grupo_modificador WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId]);
    if (!g) throw new NotFoundException('Grupo no encontrado');
    const usado = await this.db.one(
      `SELECT 1 FROM pedido_item_modificador pm JOIN modificador m ON m.id = pm.modificador_id WHERE m.grupo_id = $1 LIMIT 1`,
      [id],
    );
    if (usado) throw new ConflictException('Ya se vendieron opciones de este grupo: desactiva sus opciones o quítalo de los productos');
    await this.db.transaction(async (c) => {
      await this.db.query(`DELETE FROM grupo_modificador WHERE id = $1`, [id], c);
      await this.registrar(u, 'grupo_borrar', 'grupo_modificador', id, { nombre: g.nombre }, c);
    });
    await this.avisar(u);
  }

  async agregarOpcion(grupoId: string, dto: OpcionDto, u: UsuarioToken) {
    await this.db.transaction(async (c) => {
      const g = await this.db.one(`SELECT 1 FROM grupo_modificador WHERE id = $1 AND empresa_id = $2 FOR UPDATE`, [grupoId, u.empresaId], c);
      if (!g) throw new NotFoundException('Grupo no encontrado');
      const orden = await this.db.one(`SELECT COALESCE(max(orden) + 1, 1) AS n FROM modificador WHERE grupo_id = $1`, [grupoId], c);
      const id = await this.insertarOpcion(c, grupoId, dto, orden.n);
      await this.registrar(u, 'opcion_crear', 'modificador', id, dto, c);
    });
    await this.avisar(u);
    return (await this.grupos(u)).find((g) => g.id === grupoId);
  }

  /** Las opciones no se borran (pueden estar en pedidos viejos): se desactivan */
  async actualizarOpcion(id: string, dto: ActualizarOpcionDto, u: UsuarioToken) {
    const o = await this.db.one(
      `UPDATE modificador m SET nombre = COALESCE($3, m.nombre), precio_extra = COALESCE($4, m.precio_extra),
                                activo = COALESCE($5, m.activo)
         FROM grupo_modificador g
        WHERE m.id = $1 AND g.id = m.grupo_id AND g.empresa_id = $2
       RETURNING m.grupo_id`,
      [id, u.empresaId, dto.nombre?.trim() ?? null, dto.precioExtra === undefined ? null : dinero(dto.precioExtra), dto.activo ?? null],
    );
    if (!o) throw new NotFoundException('Opción no encontrada');
    await this.registrar(u, 'opcion_editar', 'modificador', id, dto);
    await this.avisar(u);
    return (await this.grupos(u)).find((g) => g.id === o.grupo_id);
  }

  /** Estaciones de cocina de la sede, para escoger a cuál va un producto */
  estaciones(u: UsuarioToken) {
    return this.db.query(`SELECT id, nombre FROM estacion_cocina WHERE sede_id = $1 ORDER BY nombre`, [u.sedeId]);
  }

  // ------------------------------------------------------------------ apoyo

  private async insertarOpcion(db: Db, grupoId: string, o: OpcionDto, orden: number): Promise<string> {
    const fila = await this.db.one<{ id: string }>(
      `INSERT INTO modificador (grupo_id, nombre, precio_extra, orden) VALUES ($1, $2, $3, $4) RETURNING id`,
      [grupoId, o.nombre.trim(), dinero(o.precioExtra), orden],
      db,
    );
    return fila!.id;
  }

  private async guardarGrupos(db: Db, productoId: string, grupoIds: string[], u: UsuarioToken) {
    await this.exigirTodos(db, 'grupo_modificador', grupoIds, u.empresaId, 'empresa_id');
    await this.db.query(
      `INSERT INTO producto_grupo_modificador (producto_id, grupo_id, orden)
       SELECT $1, x.id, x.n FROM unnest($2::uuid[]) WITH ORDINALITY AS x(id, n)`,
      [productoId, grupoIds],
      db,
    );
  }

  private async exigirCategoria(db: Db, id: string, u: UsuarioToken) {
    const c = await this.db.one(`SELECT 1 FROM categoria WHERE id = $1 AND empresa_id = $2`, [id, u.empresaId], db);
    if (!c) throw new BadRequestException('La categoría no existe');
  }

  private async exigirEstacion(db: Db, id: string, u: UsuarioToken) {
    const e = await this.db.one(
      `SELECT 1 FROM estacion_cocina e JOIN sede s ON s.id = e.sede_id WHERE e.id = $1 AND s.empresa_id = $2`,
      [id, u.empresaId],
      db,
    );
    if (!e) throw new BadRequestException('La estación no existe');
  }

  /** Todos los ids existen y son de la empresa (para ordenar y asignar) */
  private async exigirTodos(db: Db, tabla: 'categoria' | 'grupo_modificador', ids: string[], empresaId: string, columna: 'empresa_id') {
    if (!ids.length) return;
    const filas = await this.db.query(`SELECT id FROM ${tabla} WHERE id = ANY($1::uuid[]) AND ${columna} = $2`, [ids, empresaId], db);
    if (filas.length !== ids.length) throw new BadRequestException('Hay elementos que no existen');
  }

  private registrar(u: UsuarioToken, accion: string, entidad: string, entidadId: string, datos: unknown, db?: Db) {
    return this.auditoria.registrar({ usuarioId: u.id, accion, entidad, entidadId, datos }, db);
  }

  /** Las tablets de todas las sedes recargan el menú */
  private async avisar(u: UsuarioToken) {
    const sedes = await this.db.query<{ id: string }>(`SELECT id FROM sede WHERE empresa_id = $1`, [u.empresaId]);
    for (const s of sedes) this.gateway.emitir(s.id, 'menu.cambio', {});
  }
}

const SQL_PRODUCTO = `
  SELECT p.id, p.nombre, p.descripcion, p.precio, p.tipo_impuesto AS "tipoImpuesto", p.tasa_impuesto AS "tasaImpuesto",
         p.controla_stock AS "controlaStock", p.activo, p.orden, p.imagen_url AS "imagenUrl",
         p.categoria_id AS "categoriaId", c.nombre AS categoria, p.estacion_id AS "estacionId", e.nombre AS estacion,
         ps.precio AS "precioSede", COALESCE(ps.disponible, true) AS disponible, COALESCE(ps.agotado, false) AS agotado,
         COALESCE((SELECT json_agg(pg.grupo_id ORDER BY pg.orden) FROM producto_grupo_modificador pg WHERE pg.producto_id = p.id), '[]') AS "grupoIds",
         EXISTS (SELECT 1 FROM pedido_item i WHERE i.producto_id = p.id) AS vendido
    FROM producto p
    JOIN categoria c ON c.id = p.categoria_id
    LEFT JOIN estacion_cocina e ON e.id = p.estacion_id
    LEFT JOIN producto_sede ps ON ps.producto_id = p.id AND ps.sede_id = $2`;

/** Traduce el choque con un índice único a un 409 con un mensaje claro */
const duplicado =
  (mensaje: string) =>
  (e: any): never => {
    if (e?.code === '23505') throw new ConflictException(mensaje);
    throw e;
  };
