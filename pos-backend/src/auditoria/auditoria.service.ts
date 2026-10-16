import { Global, Injectable, Module } from '@nestjs/common';
import { DatabaseService, Db } from '../database/database.service';

export interface EventoAuditoria {
  usuarioId: string | null;
  autorizadoPor?: string | null;
  accion: string;
  entidad: string;
  entidadId?: string | null;
  datos?: unknown;
  dispositivo?: string | null;
}

@Injectable()
export class AuditoriaService {
  constructor(private readonly db: DatabaseService) {}

  /** Pasa el cliente de la transacción para que la auditoría se confirme o revierta junto con la acción */
  async registrar(e: EventoAuditoria, db?: Db) {
    await this.db.query(
      `INSERT INTO auditoria (usuario_id, autorizado_por, accion, entidad, entidad_id, datos, dispositivo)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        e.usuarioId,
        e.autorizadoPor ?? null,
        e.accion,
        e.entidad,
        e.entidadId ?? null,
        e.datos === undefined ? null : JSON.stringify(e.datos),
        e.dispositivo ?? null,
      ],
      db,
    );
  }
}

@Global()
@Module({
  providers: [AuditoriaService],
  exports: [AuditoriaService],
})
export class AuditoriaModule {}
