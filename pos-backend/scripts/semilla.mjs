// Crea un restaurante de ejemplo para desarrollo. No hace nada si ya hay datos.
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const q = async (sql, params) => (await client.query(sql, params)).rows;
const id = async (sql, params) => (await q(sql, params))[0].id;

if ((await q('SELECT 1 FROM empresa LIMIT 1')).length) {
  console.log('Ya hay datos; no se crea la semilla.');
  await client.end();
  process.exit(0);
}

const passwordAdmin = process.env.SEED_ADMIN_PASSWORD ?? 'CambiaEsto123!';
const hash = (s) => bcrypt.hashSync(s, 10);

await client.query('BEGIN');
try {
  const empresa = await id(
    `INSERT INTO empresa (nombre, nit, config) VALUES ($1, $2, $3) RETURNING id`,
    ['Restaurante Demo', '900000000-0', JSON.stringify({ propinaSugerida: 10, modosServicio: ['mesa', 'mostrador', 'domicilio', 'para_llevar'] })],
  );
  const sede = await id(`INSERT INTO sede (empresa_id, nombre, direccion) VALUES ($1, 'Principal', 'Calle 1 # 2-3') RETURNING id`, [empresa]);

  const usuarios = [
    ['Admin Demo', 'admin', 'admin@demo.co', hash(passwordAdmin), hash('0000')],
    ['Sofía Supervisora', 'supervisor', null, null, hash('9999')],
    ['Carlos Cajero', 'cajero', null, null, hash('1111')],
    ['María Mesera', 'mesero', null, null, hash('2222')],
    ['Pedro Cocina', 'cocina', null, null, hash('3333')],
  ];
  for (const [nombre, rol, email, ph, pin] of usuarios) {
    await q(
      `INSERT INTO usuario (empresa_id, nombre, rol, email, password_hash, pin_hash) VALUES ($1, $2, $3, $4, $5, $6)`,
      [empresa, nombre, rol, email, ph, pin],
    );
  }

  const zona = await id(`INSERT INTO zona (sede_id, nombre) VALUES ($1, 'Salón') RETURNING id`, [sede]);
  for (let n = 1; n <= 6; n++) {
    await q(`INSERT INTO mesa (sede_id, zona_id, numero, capacidad) VALUES ($1, $2, $3, 4)`, [sede, zona, String(n)]);
  }

  const cocina = await id(`INSERT INTO estacion_cocina (sede_id, nombre) VALUES ($1, 'Cocina caliente') RETURNING id`, [sede]);
  const bar = await id(`INSERT INTO estacion_cocina (sede_id, nombre) VALUES ($1, 'Bar') RETURNING id`, [sede]);
  const catHamb = await id(`INSERT INTO categoria (empresa_id, nombre, orden) VALUES ($1, 'Hamburguesas', 1) RETURNING id`, [empresa]);
  const catBeb = await id(`INSERT INTO categoria (empresa_id, nombre, orden) VALUES ($1, 'Bebidas', 2) RETURNING id`, [empresa]);

  // Precios finales al público; la tasa de impuesto es configurable por producto
  const producto = (cat, est, nombre, descripcion, precio, stock) =>
    id(
      `INSERT INTO producto (empresa_id, categoria_id, estacion_id, nombre, descripcion, precio, tipo_impuesto, tasa_impuesto, controla_stock)
       VALUES ($1, $2, $3, $4, $5, $6, 'impoconsumo', 8, $7) RETURNING id`,
      [empresa, cat, est, nombre, descripcion, precio, stock],
    );
  const clasica = await producto(catHamb, cocina, 'Hamburguesa clásica', 'Carne de res de 150 g, queso, lechuga, tomate y salsa de la casa', 25000, true);
  const doble = await producto(catHamb, cocina, 'Hamburguesa doble', 'Dos carnes de 150 g, doble queso y cebolla caramelizada', 32000, true);
  await producto(catBeb, bar, 'Limonada natural', 'Limón recién exprimido, endulzada al gusto', 8000, false);
  await producto(catBeb, bar, 'Gaseosa', 'Botella personal de 400 ml', 5000, false);

  const termino = await id(
    `INSERT INTO grupo_modificador (empresa_id, nombre, min_seleccion, max_seleccion) VALUES ($1, 'Término de la carne', 1, 1) RETURNING id`,
    [empresa],
  );
  const adiciones = await id(
    `INSERT INTO grupo_modificador (empresa_id, nombre, min_seleccion, max_seleccion) VALUES ($1, 'Adiciones', 0, 3) RETURNING id`,
    [empresa],
  );
  for (const [g, nombre, extra] of [
    [termino, 'Tres cuartos', 0],
    [termino, 'Bien asada', 0],
    [adiciones, 'Extra queso', 3000],
    [adiciones, 'Tocineta', 4000],
  ]) {
    await q(`INSERT INTO modificador (grupo_id, nombre, precio_extra) VALUES ($1, $2, $3)`, [g, nombre, extra]);
  }
  for (const p of [clasica, doble]) {
    await q(`INSERT INTO producto_grupo_modificador (producto_id, grupo_id) VALUES ($1, $2), ($1, $3)`, [p, termino, adiciones]);
  }

  const carne = await id(
    `INSERT INTO insumo (empresa_id, nombre, unidad, costo_unitario, stock_minimo) VALUES ($1, 'Carne de res', 'g', 32, 2000) RETURNING id`,
    [empresa],
  );
  const pan = await id(
    `INSERT INTO insumo (empresa_id, nombre, unidad, costo_unitario, stock_minimo) VALUES ($1, 'Pan de hamburguesa', 'und', 900, 10) RETURNING id`,
    [empresa],
  );
  await q(`INSERT INTO receta (producto_id, insumo_id, cantidad) VALUES ($1, $2, 150), ($1, $3, 1)`, [clasica, carne, pan]);
  await q(`INSERT INTO receta (producto_id, insumo_id, cantidad) VALUES ($1, $2, 300), ($1, $3, 1)`, [doble, carne, pan]);
  await q(
    `INSERT INTO movimiento_inventario (sede_id, insumo_id, tipo, cantidad, costo_unitario, nota)
     VALUES ($1, $2, 'compra', 10000, 32, 'Inventario inicial'), ($1, $3, 'compra', 50, 900, 'Inventario inicial')`,
    [sede, carne, pan],
  );

  await client.query('COMMIT');
  console.log('Semilla creada.');
  console.log(`  Admin: admin@demo.co / ${passwordAdmin}`);
  console.log('  PIN → Supervisora 9999 · Cajero 1111 · Mesera 2222 · Cocina 3333');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('Error creando la semilla:', e.message);
  process.exitCode = 1;
}
await client.end();
