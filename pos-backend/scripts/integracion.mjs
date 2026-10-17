// Prueba de integración completa, sin levantar nada a mano:
//   1. rehace un esquema de prueba (pos_prueba) dentro de la base de DATABASE_URL,
//   2. aplica las migraciones y la semilla en ese esquema,
//   3. compila y arranca el servidor apuntando a él, en un puerto aparte,
//   4. corre las pruebas de tests/ (flujo, usuarios y menú) y apaga el servidor.
// Los datos reales de la base no se tocan: todo vive en el esquema de prueba.
// Uso: npm run test:integracion
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ESQUEMA = process.env.ESQUEMA_PRUEBA ?? 'pos_prueba';
const PUERTO = Number(process.env.PUERTO_PRUEBA ?? 3199);
const raiz = fileURLToPath(new URL('..', import.meta.url));

// El esquema se borra completo: que nunca sea uno con datos de verdad
if (!/^[a-z_]*prueba[a-z_]*$/.test(ESQUEMA)) {
  console.error(`✘ ESQUEMA_PRUEBA debe contener "prueba" (llegó "${ESQUEMA}")`);
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('✘ Falta DATABASE_URL');
  process.exit(1);
}

const url = new URL(process.env.DATABASE_URL);
url.searchParams.set('options', `-c search_path=${ESQUEMA},public`);
const urlPrueba = url.toString();

function correr(args, env = {}) {
  return new Promise((ok, mal) => {
    const p = spawn(process.execPath, args, { cwd: raiz, stdio: 'inherit', env: { ...process.env, ...env } });
    p.on('exit', (codigo) => (codigo === 0 ? ok() : mal(new Error(`${args.join(' ')} terminó con código ${codigo}`))));
  });
}

async function esperarServidor(base) {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${base}/api/auth/usuarios`)).ok) return;
    } catch {
      /* todavía arrancando */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('El servidor de prueba no arrancó en 30 segundos');
}

console.log(`Preparando el esquema ${ESQUEMA}…`);
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
await admin.connect();
await admin.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`);
await admin.query(`CREATE SCHEMA ${ESQUEMA}`);
// gen_random_uuid() vive en pgcrypto; si la extensión no existe aún, se crea en public
await admin.query('CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA public');
await admin.end();

let servidor;
let codigo = 1;
try {
  await correr(['scripts/migrar.mjs'], { DATABASE_URL: urlPrueba });
  await correr(['scripts/semilla.mjs'], { DATABASE_URL: urlPrueba });
  console.log('Compilando…');
  await correr(['node_modules/@nestjs/cli/bin/nest.js', 'build']);

  const base = `http://localhost:${PUERTO}`;
  servidor = spawn(process.execPath, ['dist/main.js'], {
    cwd: raiz,
    stdio: ['ignore', 'ignore', 'inherit'],
    // Las fotos de prueba van a una carpeta temporal, no a la de desarrollo
    env: { ...process.env, DATABASE_URL: urlPrueba, PORT: String(PUERTO), ARCHIVOS_DIR: join(tmpdir(), 'pos-prueba-archivos') },
  });
  await esperarServidor(base);
  for (const prueba of ['tests/flujo.e2e.mjs', 'tests/usuarios.e2e.mjs', 'tests/menu.e2e.mjs']) await correr([prueba], { API_URL: base });
  codigo = 0;
} catch (e) {
  console.error(`\n✘ ${e.message}`);
} finally {
  servidor?.kill();
}
process.exit(codigo);
