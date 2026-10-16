import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AuthService } from '../auth/auth.service';
import { CAJA_POR_DEFECTO } from '../caja/caja.service';
import { aCentavos, aPesos, calcularTotales } from '../common/dinero';
import type { UsuarioToken } from '../common/tipos';
import { DatabaseService, Db } from '../database/database.service';
import { PedidosService } from '../pedidos/pedidos.service';
import { AnularVentaDto, CobrarDto } from './ventas.dto';

@Injectable()
export class VentasService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auth: AuthService,
    private readonly auditoria: AuditoriaService,
    private readonly pedidos: PedidosService,
  ) {}

  async cobrar(dto: CobrarDto, u: UsuarioToken) {
    const previa = await this.db.one(`SELECT id FROM venta WHERE idempotency_key = $1`, [dto.idempotencyKey]);
    if (previa) return this.obtener(previa.id, u);

    const descuento = aCentavos(dto.descuento ?? 0);
    const propina = aCentavos(dto.propina ?? 0);

    let autorizadoPor: string | null = null;
    if (descuento > 0) {
      if (u.rol === 'supervisor' || u.rol === 'admin') autorizadoPor = u.id;
      else if (dto.autorizacion) autorizadoPor = await this.auth.verificarSupervisor(dto.autorizacion, u.empresaId);
      else throw new ForbiddenException('El descuento requiere autorización de un supervisor');
    }

    const ventaId = await this.db.transaction(async (c) => {
      const caja = dto.caja ?? CAJA_POR_DEFECTO;
      const turno = await this.db.one(
        `SELECT id FROM turno_caja WHERE sede_id = $1 AND caja = $2 AND estado = 'abierto' FOR SHARE`,
        [u.sedeId, caja],
        c,
      );
      if (!turno) throw new BadRequestException(`No hay un turno abierto en ${caja}`);

      const pedido = await this.pedidos.bloquear(c, dto.pedidoId, u);
      if (!['abierto', 'en_cocina', 'servido'].includes(pedido.estado)) {
        throw new ConflictException(`El pedido #${pedido.numero} ya está ${pedido.estado}`);
      }

      // El total siempre se calcula aquí, nunca se confía en lo que manda el cliente
      const lineas = await this.db.query(
        `SELECT i.precio_unitario, i.cantidad, i.tasa_impuesto,
                COALESCE((SELECT sum(precio_extra) FROM pedido_item_modificador
                           WHERE pedido_item_id = i.id), 0) AS extras
           FROM pedido_item i WHERE i.pedido_id = $1 AND i.estado <> 'anulado'`,
        [pedido.id],
        c,
      );
      if (!lineas.length) throw new BadRequestException('El pedido no tiene productos');

      const t = calcularTotales(lineas);
      if (descuento > t.bruto) throw new BadRequestException('El descuento no puede superar el valor del pedido');
      const total = t.bruto - descuento + propina;

      const sumaPagos = dto.pagos.reduce((s, p) => s + aCentavos(p.monto), 0);
      if (sumaPagos !== total) {
        throw new BadRequestException(`Los pagos suman ${aPesos(sumaPagos)} y el total es ${aPesos(total)}`);
      }
      for (const p of dto.pagos) {
        if (p.recibido !== undefined && p.metodo !== 'efectivo') {
          throw new BadRequestException('"recibido" solo aplica a pagos en efectivo');
        }
        if (p.recibido !== undefined && aCentavos(p.recibido) < aCentavos(p.monto)) {
          throw new BadRequestException('El efectivo recibido es menor que el monto del pago');
        }
      }

      const venta = await this.db.one(
        `INSERT INTO venta (pedido_id, turno_id, cajero_id, subtotal, impuestos, descuento,
                            descuento_autorizado_por, propina, total, factura_estado, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pendiente', $10)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [pedido.id, turno.id, u.id, aPesos(t.subtotal), aPesos(t.impuestos), aPesos(descuento),
         autorizadoPor, aPesos(propina), aPesos(total), dto.idempotencyKey],
        c,
      );
      if (!venta) return null;

      for (const p of dto.pagos) {
        await this.db.query(
          `INSERT INTO pago (venta_id, metodo, monto, recibido, referencia) VALUES ($1, $2, $3, $4, $5)`,
          [venta.id, p.metodo, aPesos(aCentavos(p.monto)),
           p.recibido === undefined ? null : aPesos(aCentavos(p.recibido)), p.referencia ?? null],
          c,
        );
      }

      await this.db.query(`UPDATE pedido SET estado = 'pagado', actualizado_en = now() WHERE id = $1`, [pedido.id], c);
      if (pedido.mesa_id) await this.db.query(`UPDATE mesa SET estado = 'libre' WHERE id = $1`, [pedido.mesa_id], c);

      await this.moverInventario(c, u, pedido.id, venta.id, -1, 'venta');

      if (descuento > 0) {
        await this.auditoria.registrar(
          {
            usuarioId: u.id,
            autorizadoPor,
            accion: 'aplicar_descuento',
            entidad: 'venta',
            entidadId: venta.id,
            datos: { pedido: pedido.numero, descuento: aPesos(descuento), totalAntes: aPesos(t.bruto) },
          },
          c,
        );
      }
      return venta.id as string;
    });

    const id = ventaId ?? (await this.db.one(`SELECT id FROM venta WHERE idempotency_key = $1`, [dto.idempotencyKey]))!.id;
    // TODO: encolar el envío de la factura electrónica al proveedor DIAN (proceso asíncrono)
    return this.obtener(id, u);
  }

  async anular(ventaId: string, dto: AnularVentaDto, u: UsuarioToken) {
    const supervisorId = await this.auth.verificarSupervisor(dto.autorizacion, u.empresaId);
    await this.db.transaction(async (c) => {
      const v = await this.db.one(
        `SELECT v.id, v.estado, v.pedido_id, v.factura_cufe, t.estado AS turno_estado
           FROM venta v JOIN turno_caja t ON t.id = v.turno_id
          WHERE v.id = $1 AND t.sede_id = $2
          FOR UPDATE OF v`,
        [ventaId, u.sedeId],
        c,
      );
      if (!v) throw new NotFoundException('Venta no encontrada');
      if (v.estado !== 'pagada') throw new ConflictException('La venta ya estaba anulada');
      if (v.turno_estado !== 'abierto') {
        throw new ConflictException('La venta es de un turno cerrado: se debe hacer una nota crédito');
      }
      if (v.factura_cufe) {
        throw new ConflictException('La venta ya tiene factura electrónica: se debe hacer una nota crédito');
      }

      await this.db.query(
        `UPDATE venta SET estado = 'anulada', anulada_por = $2, motivo_anulacion = $3 WHERE id = $1`,
        [ventaId, supervisorId, dto.motivo],
        c,
      );
      await this.db.query(`UPDATE pedido SET estado = 'anulado', actualizado_en = now() WHERE id = $1`, [v.pedido_id], c);
      await this.moverInventario(c, u, v.pedido_id, ventaId, 1, 'devolucion');
      await this.auditoria.registrar(
        { usuarioId: u.id, autorizadoPor: supervisorId, accion: 'anular_venta', entidad: 'venta', entidadId: ventaId, datos: { motivo: dto.motivo } },
        c,
      );
    });
    return this.obtener(ventaId, u);
  }

  async obtener(ventaId: string, u: UsuarioToken) {
    const venta = await this.db.one(
      `SELECT v.id, v.pedido_id AS "pedidoId", p.numero AS "numeroPedido", v.turno_id AS "turnoId",
              v.subtotal, v.impuestos, v.descuento, v.propina, v.total, v.estado,
              v.factura_estado AS "facturaEstado", v.factura_numero AS "facturaNumero", v.creado_en AS "creadoEn"
         FROM venta v
         JOIN pedido p ON p.id = v.pedido_id
        WHERE v.id = $1 AND p.sede_id = $2`,
      [ventaId, u.sedeId],
    );
    if (!venta) throw new NotFoundException('Venta no encontrada');
    const pagos = await this.db.query(
      `SELECT metodo, monto, recibido, referencia FROM pago WHERE venta_id = $1 ORDER BY creado_en`,
      [ventaId],
    );
    const cambio = pagos
      .filter((p) => p.metodo === 'efectivo' && p.recibido !== null)
      .reduce((s, p) => s + aCentavos(p.recibido) - aCentavos(p.monto), 0);
    return { ...venta, pagos, cambio: aPesos(cambio) };
  }

  /**
   * Descuenta (signo -1) o devuelve (signo +1) los insumos de las recetas
   * de los productos que controlan stock. El trigger actualiza stock_insumo.
   */
  private async moverInventario(db: Db, u: UsuarioToken, pedidoId: string, ventaId: string, signo: 1 | -1, tipo: string) {
    await this.db.query(
      `INSERT INTO movimiento_inventario (sede_id, insumo_id, tipo, cantidad, costo_unitario, referencia_id, usuario_id)
       SELECT $1, r.insumo_id, $2::tipo_mov_inv, $3 * sum(r.cantidad * i.cantidad), ins.costo_unitario, $4, $5
         FROM pedido_item i
         JOIN producto p ON p.id = i.producto_id AND p.controla_stock
         JOIN receta r ON r.producto_id = i.producto_id
         JOIN insumo ins ON ins.id = r.insumo_id
        WHERE i.pedido_id = $6 AND i.estado <> 'anulado'
        GROUP BY r.insumo_id, ins.costo_unitario`,
      [u.sedeId, tipo, signo, ventaId, u.id, pedidoId],
      db,
    );
  }
}
