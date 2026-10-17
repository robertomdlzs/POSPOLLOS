import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { UsuarioToken } from '../common/tipos';
import { DatabaseService, Db } from '../database/database.service';
import { CocinaGateway } from './cocina.gateway';

const COMANDA_SQL = `
  SELECT i.id, i.pedido_id AS "pedidoId", p.numero, p.tipo_servicio AS "tipoServicio",
         m.numero AS mesa, i.nombre_producto AS producto, i.cantidad, i.notas, i.estado,
         i.enviado_cocina_en AS "enviadoEn", e.id AS "estacionId", e.nombre AS estacion,
         ci.nombre_producto AS combo,
         COALESCE((SELECT json_agg(pm.nombre ORDER BY pm.nombre)
                     FROM pedido_item_modificador pm WHERE pm.pedido_item_id = i.id), '[]') AS modificadores
    FROM pedido_item i
    JOIN pedido p ON p.id = i.pedido_id
    LEFT JOIN mesa m ON m.id = p.mesa_id
    JOIN producto pr ON pr.id = i.producto_id
    LEFT JOIN estacion_cocina e ON e.id = pr.estacion_id
    LEFT JOIN pedido_item ci ON ci.id = i.combo_item_id`;

/** Cocina prepara las partes de un combo, no el combo: el ítem del combo no se le muestra */
const SIN_COMBOS = `pr.tipo <> 'combo'`;

/** Transiciones permitidas en cocina: a qué estado se puede pasar desde cuál */
const VIENE_DE: Record<string, string[]> = {
  preparando: ['pendiente'],
  listo: ['pendiente', 'preparando'],
  entregado: ['listo'],
};

@Injectable()
export class CocinaService {
  constructor(
    private readonly db: DatabaseService,
    private readonly gateway: CocinaGateway,
  ) {}

  itemsPorIds(ids: string[], db?: Db) {
    return this.db.query(`${COMANDA_SQL} WHERE i.id = ANY($1::uuid[]) AND ${SIN_COMBOS} ORDER BY e.nombre, i.creado_en`, [ids], db);
  }

  pendientes(u: UsuarioToken, estacionId?: string) {
    return this.db.query(
      `${COMANDA_SQL}
        WHERE p.sede_id = $1
          AND p.estado <> 'anulado'
          AND i.enviado_cocina_en IS NOT NULL
          AND i.estado IN ('pendiente', 'preparando', 'listo')
          AND ${SIN_COMBOS}
          AND ($2::uuid IS NULL OR e.id = $2)
        ORDER BY i.enviado_cocina_en, p.numero`,
      [u.sedeId, estacionId ?? null],
    );
  }

  async cambiarEstado(itemId: string, nuevo: string, u: UsuarioToken) {
    const item = await this.db.transaction(async (c) => {
      const actualizado = await this.db.one(
        `UPDATE pedido_item i SET estado = $3
           FROM pedido p
          WHERE p.id = i.pedido_id AND i.id = $1 AND p.sede_id = $2
            AND NOT EXISTS (SELECT 1 FROM producto px WHERE px.id = i.producto_id AND px.tipo = 'combo')
            AND i.enviado_cocina_en IS NOT NULL
            AND i.estado = ANY($4::estado_item[])
        RETURNING i.id, i.pedido_id`,
        [itemId, u.sedeId, nuevo, VIENE_DE[nuevo]],
        c,
      );
      if (!actualizado) {
        const existe = await this.db.one(
          `SELECT i.estado FROM pedido_item i JOIN pedido p ON p.id = i.pedido_id JOIN producto pr ON pr.id = i.producto_id
            WHERE i.id = $1 AND p.sede_id = $2 AND i.enviado_cocina_en IS NOT NULL AND ${SIN_COMBOS}`,
          [itemId, u.sedeId],
          c,
        );
        if (!existe) throw new NotFoundException('Ítem no encontrado en cocina');
        throw new ConflictException(`No se puede pasar de "${existe.estado}" a "${nuevo}"`);
      }
      // Si ya se entregó todo, el pedido queda servido
      await this.db.query(
        `UPDATE pedido SET estado = 'servido', actualizado_en = now()
          WHERE id = $1 AND estado = 'en_cocina'
            AND NOT EXISTS (SELECT 1 FROM pedido_item x JOIN producto px ON px.id = x.producto_id
                             WHERE x.pedido_id = $1 AND x.estado NOT IN ('entregado', 'anulado') AND px.tipo <> 'combo')`,
        [actualizado.pedido_id],
        c,
      );
      return actualizado;
    });

    const info = await this.db.one(
      `SELECT i.nombre_producto AS producto, i.cantidad, p.numero, m.numero AS mesa
         FROM pedido_item i JOIN pedido p ON p.id = i.pedido_id LEFT JOIN mesa m ON m.id = p.mesa_id
        WHERE i.id = $1`,
      [item.id],
    );
    const evento = { itemId: item.id, pedidoId: item.pedido_id, estado: nuevo, ...info };
    this.gateway.emitir(u.sedeId, 'item.estado', evento);
    return evento;
  }
}
