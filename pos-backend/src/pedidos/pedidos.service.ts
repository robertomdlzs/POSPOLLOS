import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AuthService } from '../auth/auth.service';
import { CocinaGateway } from '../cocina/cocina.gateway';
import { CocinaService } from '../cocina/cocina.service';
import { aPesos, calcularTotales } from '../common/dinero';
import { tienePermiso } from '../common/permisos';
import type { UsuarioToken } from '../common/tipos';
import { DatabaseService, Db } from '../database/database.service';
import { AgregarItemsDto, AnularItemDto, CrearPedidoDto, ItemPedidoDto } from './pedidos.dto';

const ESTADOS_EDITABLES = ['abierto', 'en_cocina', 'servido'];

@Injectable()
export class PedidosService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auth: AuthService,
    private readonly auditoria: AuditoriaService,
    private readonly cocina: CocinaService,
    private readonly gateway: CocinaGateway,
  ) {}

  async crear(dto: CrearPedidoDto, u: UsuarioToken) {
    const previo = await this.db.one(`SELECT id FROM pedido WHERE idempotency_key = $1`, [dto.idempotencyKey]);
    if (previo) return this.obtener(previo.id, u);
    if (dto.tipoServicio !== 'mesa' && dto.mesaId) {
      throw new BadRequestException('Solo los pedidos de mesa llevan mesa');
    }

    const id = await this.db.transaction(async (c) => {
      if (dto.tipoServicio === 'mesa') {
        // El bloqueo de la fila evita que dos meseros abran la misma mesa a la vez
        const mesa = await this.db.one(
          `SELECT id, estado FROM mesa WHERE id = $1 AND sede_id = $2 FOR UPDATE`,
          [dto.mesaId, u.sedeId],
          c,
        );
        if (!mesa) throw new NotFoundException('Mesa no encontrada');
        if (mesa.estado === 'inactiva') throw new BadRequestException('La mesa está inactiva');
        const abierto = await this.db.one(
          `SELECT numero FROM pedido WHERE mesa_id = $1 AND estado NOT IN ('pagado', 'anulado')`,
          [mesa.id],
          c,
        );
        if (abierto) throw new ConflictException(`La mesa ya tiene abierto el pedido #${abierto.numero}`);
        await this.db.query(`UPDATE mesa SET estado = 'ocupada' WHERE id = $1`, [mesa.id], c);
      }

      const pedido = await this.db.one(
        `INSERT INTO pedido (sede_id, tipo_servicio, mesa_id, mesero_id, cliente_nombre, cliente_telefono,
                             direccion_entrega, personas, notas, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [
          u.sedeId,
          dto.tipoServicio,
          dto.mesaId ?? null,
          u.id,
          dto.clienteNombre ?? null,
          dto.clienteTelefono ?? null,
          dto.direccionEntrega ?? null,
          dto.personas ?? null,
          dto.notas ?? null,
          dto.idempotencyKey,
        ],
        c,
      );
      if (!pedido) return null; // otro reintento idéntico llegó primero
      await this.insertarItems(c, pedido.id, dto.items, u);
      return pedido.id as string;
    });

    const final = id ?? (await this.db.one(`SELECT id FROM pedido WHERE idempotency_key = $1`, [dto.idempotencyKey]))!.id;
    return this.obtener(final, u);
  }

  async agregarItems(pedidoId: string, dto: AgregarItemsDto, u: UsuarioToken) {
    await this.db.transaction(async (c) => {
      const p = await this.bloquear(c, pedidoId, u);
      // Con el pedido bloqueado, un reintento simultáneo espera aquí y luego encuentra la clave
      const lote = await this.db.one(
        `INSERT INTO pedido_lote (idempotency_key, pedido_id, usuario_id) VALUES ($1, $2, $3)
         ON CONFLICT (idempotency_key) DO NOTHING RETURNING pedido_id`,
        [dto.idempotencyKey, pedidoId, u.id],
        c,
      );
      if (!lote) {
        const previo = await this.db.one(`SELECT pedido_id FROM pedido_lote WHERE idempotency_key = $1`, [dto.idempotencyKey], c);
        if (previo?.pedido_id !== pedidoId) throw new ConflictException('La clave de idempotencia ya se usó en otro pedido');
        return; // esta tanda ya se agregó
      }
      this.exigirEditable(p);
      await this.insertarItems(c, pedidoId, dto.items, u);
      await this.db.query(`UPDATE pedido SET actualizado_en = now() WHERE id = $1`, [pedidoId], c);
    });
    return this.obtener(pedidoId, u);
  }

  /** Envía a cocina todo lo que aún no se ha enviado y avisa por WebSocket */
  async enviarACocina(pedidoId: string, u: UsuarioToken) {
    const ids = await this.db.transaction(async (c) => {
      const p = await this.bloquear(c, pedidoId, u);
      this.exigirEditable(p);
      const items = await this.db.query<{ id: string }>(
        `UPDATE pedido_item SET enviado_cocina_en = now()
          WHERE pedido_id = $1 AND enviado_cocina_en IS NULL AND estado = 'pendiente'
        RETURNING id`,
        [pedidoId],
        c,
      );
      if (!items.length) throw new BadRequestException('No hay productos nuevos para enviar a cocina');
      await this.db.query(
        `UPDATE pedido SET estado = 'en_cocina', actualizado_en = now()
          WHERE id = $1 AND estado IN ('abierto', 'servido')`,
        [pedidoId],
        c,
      );
      return items.map((i) => i.id);
    });

    const items = await this.cocina.itemsPorIds(ids);
    const comanda = { pedidoId, numero: items[0]?.numero, mesa: items[0]?.mesa, items };
    this.gateway.emitir(u.sedeId, 'comanda.nueva', comanda);
    return comanda;
  }

  async anularItem(pedidoId: string, itemId: string, dto: AnularItemDto, u: UsuarioToken) {
    const resultado = await this.db.transaction(async (c) => {
      const p = await this.bloquear(c, pedidoId, u);
      this.exigirEditable(p);
      const item = await this.db.one(
        `SELECT id, nombre_producto, estado, enviado_cocina_en FROM pedido_item
          WHERE id = $1 AND pedido_id = $2 FOR UPDATE`,
        [itemId, pedidoId],
        c,
      );
      if (!item) throw new NotFoundException('Ítem no encontrado');
      if (item.estado === 'anulado') throw new ConflictException('El ítem ya estaba anulado');

      // Lo que ya salió a cocina cuesta plata: solo un supervisor lo puede anular
      let autorizadoPor: string | null = null;
      if (item.enviado_cocina_en) {
        if (tienePermiso(u, 'pedido.anular_enviado')) autorizadoPor = u.id;
        else if (dto.autorizacion) autorizadoPor = await this.auth.verificarAutorizacion(dto.autorizacion, 'pedido.anular_enviado', u);
        else throw new ForbiddenException('Este producto ya está en cocina: se requiere autorización de un supervisor');
      }

      await this.db.query(
        `UPDATE pedido_item SET estado = 'anulado', anulado_por = $2, motivo_anulacion = $3 WHERE id = $1`,
        [itemId, u.id, dto.motivo],
        c,
      );
      await this.auditoria.registrar(
        {
          usuarioId: u.id,
          autorizadoPor,
          accion: 'anular_item',
          entidad: 'pedido_item',
          entidadId: itemId,
          datos: { pedidoId, producto: item.nombre_producto, estadoPrevio: item.estado, motivo: dto.motivo },
        },
        c,
      );
      return { enviado: !!item.enviado_cocina_en, producto: item.nombre_producto };
    });

    if (resultado.enviado) {
      this.gateway.emitir(u.sedeId, 'item.anulado', {
        itemId,
        pedidoId,
        producto: resultado.producto,
        motivo: dto.motivo,
      });
    }
    return this.obtener(pedidoId, u);
  }

  /**
   * Cierra un pedido que se quedó sin productos (todos anulados) y libera la mesa.
   * Cada anulación ya pasó por su propia autorización, así que aquí no se pide supervisor.
   */
  async cerrarVacio(pedidoId: string, u: UsuarioToken) {
    await this.db.transaction(async (c) => {
      const p = await this.bloquear(c, pedidoId, u);
      this.exigirEditable(p);
      const activos = await this.db.one<{ n: number }>(
        `SELECT count(*)::int AS n FROM pedido_item WHERE pedido_id = $1 AND estado <> 'anulado'`,
        [pedidoId],
        c,
      );
      if (activos!.n > 0) {
        throw new ConflictException('El pedido todavía tiene productos: anúlalos o cóbralo');
      }
      await this.db.query(`UPDATE pedido SET estado = 'anulado', actualizado_en = now() WHERE id = $1`, [pedidoId], c);
      if (p.mesa_id) {
        await this.db.query(`UPDATE mesa SET estado = 'libre' WHERE id = $1 AND estado = 'ocupada'`, [p.mesa_id], c);
      }
      await this.auditoria.registrar(
        { usuarioId: u.id, accion: 'cerrar_pedido_vacio', entidad: 'pedido', entidadId: pedidoId, datos: { numero: p.numero } },
        c,
      );
    });
    return this.obtener(pedidoId, u);
  }

  async obtener(pedidoId: string, u: UsuarioToken) {
    const pedido = await this.db.one(
      `SELECT p.id, p.numero, p.tipo_servicio AS "tipoServicio", p.estado, p.mesa_id AS "mesaId",
              m.numero AS mesa, p.mesero_id AS "meseroId", us.nombre AS mesero,
              p.cliente_nombre AS "clienteNombre", p.cliente_telefono AS "clienteTelefono",
              p.direccion_entrega AS "direccionEntrega", p.personas, p.notas, p.creado_en AS "creadoEn"
         FROM pedido p
         LEFT JOIN mesa m ON m.id = p.mesa_id
         LEFT JOIN usuario us ON us.id = p.mesero_id
        WHERE p.id = $1 AND p.sede_id = $2`,
      [pedidoId, u.sedeId],
    );
    if (!pedido) throw new NotFoundException('Pedido no encontrado');

    const items = await this.db.query(
      `SELECT i.id, i.producto_id AS "productoId", i.nombre_producto AS producto, i.cantidad,
              i.precio_unitario, i.tasa_impuesto, i.notas, i.estado,
              i.enviado_cocina_en AS "enviadoCocinaEn", i.motivo_anulacion AS "motivoAnulacion",
              COALESCE((SELECT sum(precio_extra) FROM pedido_item_modificador WHERE pedido_item_id = i.id), 0) AS extras,
              COALESCE((SELECT json_agg(json_build_object('nombre', nombre, 'precioExtra', precio_extra))
                          FROM pedido_item_modificador WHERE pedido_item_id = i.id), '[]') AS modificadores
         FROM pedido_item i WHERE i.pedido_id = $1 ORDER BY i.creado_en`,
      [pedidoId],
    );
    const t = calcularTotales(items.filter((i) => i.estado !== 'anulado'));
    return {
      ...pedido,
      items: items.map(({ precio_unitario, tasa_impuesto, ...resto }) => ({
        ...resto,
        precioUnitario: precio_unitario,
        tasaImpuesto: tasa_impuesto,
      })),
      totales: { subtotal: aPesos(t.subtotal), impuestos: aPesos(t.impuestos), total: aPesos(t.bruto) },
    };
  }

  listarAbiertos(u: UsuarioToken) {
    return this.db.query(
      `SELECT p.id, p.numero, p.tipo_servicio AS "tipoServicio", p.estado, m.numero AS mesa,
              p.cliente_nombre AS "clienteNombre", p.creado_en AS "creadoEn",
              count(i.id) FILTER (WHERE i.estado <> 'anulado')::int AS items
         FROM pedido p
         LEFT JOIN mesa m ON m.id = p.mesa_id
         LEFT JOIN pedido_item i ON i.pedido_id = p.id
        WHERE p.sede_id = $1 AND p.estado NOT IN ('pagado', 'anulado')
        GROUP BY p.id, m.numero
        ORDER BY p.creado_en`,
      [u.sedeId],
    );
  }

  // ---------------------------------------------------------------------

  /** Bloquea el pedido para que nadie lo modifique o cobre en paralelo */
  async bloquear(db: Db, pedidoId: string, u: UsuarioToken) {
    const p = await this.db.one(
      `SELECT id, numero, estado, mesa_id FROM pedido WHERE id = $1 AND sede_id = $2 FOR UPDATE`,
      [pedidoId, u.sedeId],
      db,
    );
    if (!p) throw new NotFoundException('Pedido no encontrado');
    return p;
  }

  private exigirEditable(p: { estado: string }) {
    if (!ESTADOS_EDITABLES.includes(p.estado)) {
      throw new ConflictException(`El pedido está ${p.estado} y ya no se puede modificar`);
    }
  }

  private async insertarItems(db: Db, pedidoId: string, items: ItemPedidoDto[], u: UsuarioToken) {
    for (const it of items) {
      const producto = await this.db.one(
        `SELECT id, nombre, precio, tipo_impuesto, tasa_impuesto
           FROM producto WHERE id = $1 AND empresa_id = $2 AND activo`,
        [it.productoId, u.empresaId],
        db,
      );
      if (!producto) throw new BadRequestException(`Producto no disponible: ${it.productoId}`);

      const modIds = [...new Set(it.modificadorIds ?? [])];
      const grupos = await this.db.query(
        `SELECT g.id, g.nombre, g.min_seleccion, g.max_seleccion
           FROM grupo_modificador g
           JOIN producto_grupo_modificador pg ON pg.grupo_id = g.id
          WHERE pg.producto_id = $1`,
        [producto.id],
        db,
      );
      const mods = modIds.length
        ? await this.db.query(
            `SELECT id, grupo_id, nombre, precio_extra FROM modificador WHERE id = ANY($1::uuid[]) AND activo`,
            [modIds],
            db,
          )
        : [];
      if (mods.length !== modIds.length) throw new BadRequestException('Hay un modificador que no existe o no está activo');
      for (const m of mods) {
        if (!grupos.some((g) => g.id === m.grupo_id)) {
          throw new BadRequestException(`"${m.nombre}" no aplica a ${producto.nombre}`);
        }
      }
      for (const g of grupos) {
        const elegidos = mods.filter((m) => m.grupo_id === g.id).length;
        if (elegidos < g.min_seleccion || elegidos > g.max_seleccion) {
          const rango = g.min_seleccion === g.max_seleccion ? `${g.min_seleccion}` : `entre ${g.min_seleccion} y ${g.max_seleccion}`;
          throw new BadRequestException(`${producto.nombre}: en "${g.nombre}" elige ${rango} opción(es)`);
        }
      }

      const item = await this.db.one(
        `INSERT INTO pedido_item (pedido_id, producto_id, nombre_producto, precio_unitario,
                                  tipo_impuesto, tasa_impuesto, cantidad, notas)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [pedidoId, producto.id, producto.nombre, producto.precio, producto.tipo_impuesto,
         producto.tasa_impuesto, it.cantidad, it.notas ?? null],
        db,
      );
      for (const m of mods) {
        await this.db.query(
          `INSERT INTO pedido_item_modificador (pedido_item_id, modificador_id, nombre, precio_extra)
           VALUES ($1, $2, $3, $4)`,
          [item!.id, m.id, m.nombre, m.precio_extra],
          db,
        );
      }
    }
  }
}
