import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResult } from 'pg';
import { config } from '../config';

/** Cualquier cosa que ejecute consultas: el pool o un cliente dentro de una transacción */
export interface Db {
  query(text: string, values?: unknown[]): Promise<QueryResult<any>>;
}

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: config.databaseUrl, max: 20 });

  async query<T = any>(sql: string, params: unknown[] = [], db: Db = this.pool): Promise<T[]> {
    const r = await db.query(sql, params);
    return r.rows as T[];
  }

  async one<T = any>(sql: string, params: unknown[] = [], db: Db = this.pool): Promise<T | undefined> {
    const rows = await this.query<T>(sql, params, db);
    return rows[0];
  }

  /** Ejecuta fn dentro de BEGIN/COMMIT; cualquier excepción hace ROLLBACK */
  async transaction<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const resultado = await fn(client);
      await client.query('COMMIT');
      return resultado;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
