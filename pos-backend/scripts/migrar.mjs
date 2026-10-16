// Aplica en orden los .sql de db/migraciones que aún no se hayan aplicado.
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';

const dir = new URL('../db/migraciones/', import.meta.url);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

await client.query(`CREATE TABLE IF NOT EXISTS _migraciones (
  nombre text PRIMARY KEY,
  aplicada_en timestamptz NOT NULL DEFAULT now()
)`);
const aplicadas = new Set((await client.query('SELECT nombre FROM _migraciones')).rows.map((r) => r.nombre));
const archivos = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

let nuevas = 0;
for (const archivo of archivos) {
  if (aplicadas.has(archivo)) continue;
  const sql = fs.readFileSync(new URL(archivo, dir), 'utf8');
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO _migraciones (nombre) VALUES ($1)', [archivo]);
    await client.query('COMMIT');
    console.log(`✔ ${archivo}`);
    nuevas++;
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(`✘ ${archivo}: ${e.message}`);
    process.exitCode = 1;
    break;
  }
}
if (!nuevas && !process.exitCode) console.log('La base de datos ya está al día');
await client.end();
