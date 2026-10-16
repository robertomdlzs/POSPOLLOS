import { Controller, Get, Module } from '@nestjs/common';
import { Roles, UsuarioActual } from '../common/decoradores';
import type { UsuarioToken } from '../common/tipos';
import { DatabaseService } from '../database/database.service';

@Controller()
export class MenuController {
  constructor(private readonly db: DatabaseService) {}

  /** Productos activos con sus grupos de modificadores, listos para pintar el menú */
  @Get('menu')
  menu(@UsuarioActual() u: UsuarioToken) {
    return this.db.query(
      `SELECT p.id, p.nombre, p.descripcion, p.precio, p.imagen_url AS "imagenUrl", c.id AS "categoriaId", c.nombre AS categoria,
              COALESCE(json_agg(json_build_object(
                  'id', g.id, 'nombre', g.nombre, 'min', g.min_seleccion, 'max', g.max_seleccion,
                  'opciones', (SELECT COALESCE(json_agg(json_build_object(
                                   'id', m.id, 'nombre', m.nombre, 'precioExtra', m.precio_extra) ORDER BY m.nombre), '[]')
                                 FROM modificador m WHERE m.grupo_id = g.id AND m.activo)
                ) ORDER BY g.nombre) FILTER (WHERE g.id IS NOT NULL), '[]') AS modificadores
         FROM producto p
         JOIN categoria c ON c.id = p.categoria_id
         LEFT JOIN producto_grupo_modificador pg ON pg.producto_id = p.id
         LEFT JOIN grupo_modificador g ON g.id = pg.grupo_id
        WHERE p.empresa_id = $1 AND p.activo AND c.activa
        GROUP BY p.id, c.id
        ORDER BY c.orden, c.nombre, p.nombre`,
      [u.empresaId],
    );
  }

  @Get('mesas')
  mesas(@UsuarioActual() u: UsuarioToken) {
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

@Controller('inventario')
@Roles('supervisor', 'cajero')
export class InventarioController {
  constructor(private readonly db: DatabaseService) {}

  @Get('stock')
  stock(@UsuarioActual() u: UsuarioToken) {
    return this.db.query(
      `SELECT i.id, i.nombre, i.unidad, COALESCE(s.cantidad, 0) AS cantidad, i.stock_minimo AS "stockMinimo",
              COALESCE(s.cantidad, 0) <= i.stock_minimo AS "bajoMinimo"
         FROM insumo i
         LEFT JOIN stock_insumo s ON s.insumo_id = i.id AND s.sede_id = $2
        WHERE i.empresa_id = $1 AND i.activo
        ORDER BY i.nombre`,
      [u.empresaId, u.sedeId],
    );
  }
}

@Module({ controllers: [MenuController, InventarioController] })
export class MenuModule {}
