import { Injectable } from '@nestjs/common';
import type { UsuarioToken } from '../common/tipos';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class InventarioService {
  constructor(private readonly db: DatabaseService) {}

  /** Stock de cada insumo en la sede, con la alerta de mínimo */
  stock(u: UsuarioToken) {
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
