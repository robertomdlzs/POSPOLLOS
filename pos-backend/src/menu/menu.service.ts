import { Injectable } from '@nestjs/common';
import type { UsuarioToken } from '../common/tipos';
import { DatabaseService } from '../database/database.service';

/** Grupos de modificadores de un producto (alias de la tabla), en JSON para las tablets */
const GRUPOS_DE = (p: string) => `COALESCE((SELECT json_agg(json_build_object(
          'id', g.id, 'nombre', g.nombre, 'min', g.min_seleccion, 'max', g.max_seleccion,
          'opciones', (SELECT COALESCE(json_agg(json_build_object(
                           'id', m.id, 'nombre', m.nombre, 'precioExtra', m.precio_extra) ORDER BY m.orden, m.nombre), '[]')
                         FROM modificador m WHERE m.grupo_id = g.id AND m.activo)
        ) ORDER BY pg.orden, g.nombre)
          FROM producto_grupo_modificador pg JOIN grupo_modificador g ON g.id = pg.grupo_id
         WHERE pg.producto_id = ${p}.id), '[]')`;

@Injectable()
export class MenuService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Productos activos que se venden en la sede, con su precio de la sede (o el
   * general), si están agotados y sus grupos de modificadores, listos para
   * pintar el menú de las tablets.
   */
  menu(u: UsuarioToken) {
    return this.db.query(
      `SELECT p.id, p.nombre, p.descripcion, COALESCE(ps.precio, p.precio) AS precio, p.imagen_url AS "imagenUrl",
              COALESCE(ps.agotado, false) AS agotado, p.tipo, c.id AS "categoriaId", c.nombre AS categoria,
              -- Partes del combo con las opciones que hoy se pueden escoger (activas, a la venta y no agotadas)
              COALESCE((SELECT json_agg(json_build_object(
                          'id', s.id, 'nombre', s.nombre, 'min', s.min_seleccion, 'max', s.max_seleccion,
                          'opciones', (SELECT COALESCE(json_agg(json_build_object(
                                           'productoId', op.id, 'nombre', op.nombre, 'precioExtra', o.precio_extra,
                                           'modificadores', ${GRUPOS_DE('op')}) ORDER BY o.orden), '[]')
                                         FROM combo_opcion o
                                         JOIN producto op ON op.id = o.producto_id AND op.activo
                                         LEFT JOIN producto_sede ops ON ops.producto_id = op.id AND ops.sede_id = $2
                                        WHERE o.seccion_id = s.id AND COALESCE(ops.disponible, true) AND NOT COALESCE(ops.agotado, false))
                        ) ORDER BY s.orden)
                          FROM combo_seccion s WHERE s.combo_id = p.id), '[]') AS secciones,
              ${GRUPOS_DE('p')} AS modificadores
         FROM producto p
         JOIN categoria c ON c.id = p.categoria_id
         LEFT JOIN producto_sede ps ON ps.producto_id = p.id AND ps.sede_id = $2
        WHERE p.empresa_id = $1 AND p.activo AND c.activa AND COALESCE(ps.disponible, true)
        ORDER BY c.orden, c.nombre, p.orden, p.nombre`,
      [u.empresaId, u.sedeId],
    );
  }

  /** Mesas de la sede con el pedido abierto de cada una, si lo tiene */
  mesas(u: UsuarioToken) {
    return this.db.query(
      `SELECT m.id, m.numero, m.capacidad, m.estado, m.pos_x AS "posX", m.pos_y AS "posY",
              z.nombre AS zona,
              (SELECT p.id FROM pedido p WHERE p.mesa_id = m.id
                  AND p.estado NOT IN ('pagado', 'anulado') LIMIT 1) AS "pedidoAbiertoId"
         FROM mesa m LEFT JOIN zona z ON z.id = m.zona_id
        WHERE m.sede_id = $1 AND m.estado <> 'inactiva'
        ORDER BY z.orden, length(m.numero), m.numero`,
      [u.sedeId],
    );
  }
}
