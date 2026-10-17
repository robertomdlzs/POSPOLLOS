// Prueba de punta a punta de la administración del menú: categorías, productos,
// precio por sede, agotados en tiempo real, modificadores y reglas de borrado.
// Requiere el servidor corriendo sobre una base sembrada (la arma test:integracion)
// y corre después de tests/flujo.e2e.mjs, que deja vendidos algunos productos.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

const BASE = process.env.API_URL ?? 'http://localhost:3000';
let pasos = 0;
const ok = (msg) => console.log(`  ✔ ${++pasos}. ${msg}`);

async function api(metodo, ruta, { token, body } = {}) {
  const r = await fetch(`${BASE}/api${ruta}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await r.text();
  return { status: r.status, data: texto ? JSON.parse(texto) : null };
}
const esperar = (status, r, contexto) =>
  assert.equal(r.status, status, `${contexto}: esperaba ${status}, llegó ${r.status} ${JSON.stringify(r.data)}`);

console.log('Administración del menú');

const usuarios = (await api('GET', '/auth/usuarios')).data;
const quien = (clave) => usuarios.find((u) => u.rolClave === clave);
const admin = (await api('POST', '/auth/login', { body: { email: 'admin@demo.co', password: process.env.SEED_ADMIN_PASSWORD ?? 'CambiaEsto123!' } })).data;
const A = admin.accessToken;
const sede = admin.usuario.sedeId;
const pin = async (clave, p) => (await api('POST', '/auth/pin', { body: { usuarioId: quien(clave).id, pin: p } })).data.accessToken;
const M = await pin('mesero', '2222');
const C = await pin('cocina', '3333');
const delMenu = async (id) => (await api('GET', '/menu', { token: M })).data.find((p) => p.id === id);

// --- Permisos -------------------------------------------------------------
esperar(403, await api('GET', '/categorias', { token: M }), 'mesera ve categorías');
esperar(403, await api('POST', '/productos', { token: C, body: {} }), 'cocina crea producto');
ok('La mesera y cocina no administran el menú');

// --- Categoría y producto -------------------------------------------------
const cat = await api('POST', '/categorias', { token: A, body: { nombre: 'Postres de prueba' } });
esperar(201, cat, 'crear categoría');
esperar(409, await api('POST', '/categorias', { token: A, body: { nombre: 'postres DE prueba' } }), 'categoría repetida');
const adiciones = (await api('GET', '/grupos-modificadores', { token: A })).data.find((g) => g.nombre === 'Adiciones');
const prod = await api('POST', '/productos', {
  token: A,
  body: { categoriaId: cat.data.id, nombre: 'Torta de prueba', precio: 12000, tipoImpuesto: 'impoconsumo', tasaImpuesto: 8, grupoIds: [adiciones.id] },
});
esperar(201, prod, 'crear producto');
const enMenu = await delMenu(prod.data.id);
assert.equal(Number(enMenu.precio), 12000);
assert.deepEqual(enMenu.modificadores.map((g) => g.nombre), ['Adiciones']);
esperar(400, await api('POST', '/productos', { token: A, body: { categoriaId: cat.data.id, nombre: 'X', precio: -5, tipoImpuesto: 'iva', tasaImpuesto: 19 } }), 'producto inválido');
ok('Categoría y producto creados; el producto sale en el menú de las tablets con su grupo de adiciones');

// --- Precio por sede ------------------------------------------------------
esperar(200, await api('PUT', `/productos/${prod.data.id}/sedes/${sede}`, { token: A, body: { precio: 13500 } }), 'precio en sede');
assert.equal(Number((await delMenu(prod.data.id)).precio), 13500);
const pedido = await api('POST', '/pedidos', {
  token: M,
  body: { idempotencyKey: randomUUID(), tipoServicio: 'para_llevar', items: [{ productoId: prod.data.id, cantidad: 1 }] },
});
esperar(201, pedido, 'pedido con precio de sede');
assert.equal(pedido.data.totales.total, '13500.00');
ok('Con precio propio en la sede, el menú y el pedido cobran $13.500 en lugar de $12.000');

// --- Agotado en tiempo real ----------------------------------------------
const socket = io(`${BASE}/cocina`, { auth: { token: M }, transports: ['websocket'] });
await new Promise((r) => socket.on('connect', r));
const aviso = new Promise((r) => socket.on('menu.cambio', (e) => e.productoId && r(e)));
esperar(403, await api('PUT', `/productos/${prod.data.id}/agotado`, { token: M, body: { agotado: true } }), 'mesera agota');
esperar(200, await api('PUT', `/productos/${prod.data.id}/agotado`, { token: C, body: { agotado: true } }), 'cocina agota');
const evento = await Promise.race([aviso, new Promise((_, no) => setTimeout(() => no(new Error('no llegó menu.cambio')), 3000))]);
assert.equal(evento.agotado, true);
assert.equal((await delMenu(prod.data.id)).agotado, true);
const agotado = await api('POST', '/pedidos', {
  token: M,
  body: { idempotencyKey: randomUUID(), tipoServicio: 'para_llevar', items: [{ productoId: prod.data.id, cantidad: 1 }] },
});
esperar(400, agotado, 'pedir agotado');
assert.match(agotado.data.message, /agotado/);
esperar(200, await api('PUT', `/productos/${prod.data.id}/agotado`, { token: C, body: { agotado: false } }), 'cocina desagota');
socket.close();
ok('Cocina lo marca agotado, las tablets se enteran al momento y no se puede pedir; la mesera no puede agotarlo');

// --- Disponible en la sede ------------------------------------------------
esperar(200, await api('PUT', `/productos/${prod.data.id}/sedes/${sede}`, { token: A, body: { disponible: false } }), 'no disponible');
assert.equal(await delMenu(prod.data.id), undefined);
esperar(200, await api('PUT', `/productos/${prod.data.id}/sedes/${sede}`, { token: A, body: { disponible: true, precio: null } }), 'disponible otra vez');
const devuelto = await delMenu(prod.data.id);
assert.equal(Number(devuelto.precio), 12000);
ok('Si no se vende en la sede desaparece de sus tablets; al volver, con el precio general');

// --- Orden ----------------------------------------------------------------
const cats = (await api('GET', '/categorias', { token: A })).data;
const invertidas = cats.map((c) => c.id).reverse();
esperar(200, await api('PUT', '/categorias/orden', { token: A, body: { ids: invertidas } }), 'ordenar');
const menuOrden = (await api('GET', '/menu', { token: M })).data;
assert.equal(menuOrden[0].categoriaId, invertidas.find((id) => menuOrden.some((p) => p.categoriaId === id)));
esperar(200, await api('PUT', '/categorias/orden', { token: A, body: { ids: cats.map((c) => c.id) } }), 'restaurar orden');
ok('Reordenar las categorías cambia el orden del menú en las tablets');

// --- Modificadores --------------------------------------------------------
esperar(400, await api('POST', '/grupos-modificadores', { token: A, body: { nombre: 'Malo', min: 3, max: 1, opciones: [] } }), 'min > max');
const salsas = await api('POST', '/grupos-modificadores', {
  token: A,
  body: { nombre: 'Salsas', min: 0, max: 2, opciones: [{ nombre: 'Rosada', precioExtra: 0 }, { nombre: 'Tártara', precioExtra: 500 }] },
});
esperar(201, salsas, 'crear grupo');
esperar(200, await api('PATCH', `/productos/${prod.data.id}`, { token: A, body: { grupoIds: [salsas.data.id, adiciones.id] } }), 'asignar grupos');
const tartara = salsas.data.opciones.find((o) => o.nombre === 'Tártara');
esperar(200, await api('PATCH', `/modificadores/${tartara.id}`, { token: A, body: { activo: false } }), 'desactivar opción');
const conSalsas = await delMenu(prod.data.id);
assert.deepEqual(conSalsas.modificadores.map((g) => g.nombre), ['Salsas', 'Adiciones']);
assert.deepEqual(conSalsas.modificadores[0].opciones.map((o) => o.nombre), ['Rosada']);
ok('Grupo Salsas creado y asignado en orden; una opción desactivada deja de ofrecerse');

// --- Fotos ----------------------------------------------------------------
const sharp = (await import('sharp')).default;
const subir = async (contenido, tipo, nombre) => {
  const form = new FormData();
  form.append('foto', new Blob([contenido], { type: tipo }), nombre);
  const r = await fetch(`${BASE}/api/productos/${prod.data.id}/foto`, { method: 'POST', headers: { authorization: `Bearer ${A}` }, body: form });
  return { status: r.status, data: await r.json() };
};
const png = await sharp({ create: { width: 1200, height: 1600, channels: 3, background: '#c9772a' } }).png().toBuffer();
const conFoto = await subir(png, 'image/png', 'torta.png');
esperar(201, conFoto, 'subir foto');
const servida = await fetch(`${BASE}${conFoto.data.imagenUrl}`);
assert.equal(servida.status, 200);
assert.equal(servida.headers.get('content-type'), 'image/webp');
const meta = await sharp(Buffer.from(await servida.arrayBuffer())).metadata();
assert.deepEqual([meta.format, meta.width, meta.height], ['webp', 800, 600]);
esperar(400, await subir(Buffer.from('no soy una imagen'), 'image/png', 'falsa.png'), 'archivo falso');
esperar(200, await api('DELETE', `/productos/${prod.data.id}/foto`, { token: A }), 'quitar foto');
assert.equal((await fetch(`${BASE}${conFoto.data.imagenUrl}`)).status, 404);
ok('La foto se guarda en WebP de 800×600 aunque llegue vertical; un archivo que no es imagen se rechaza; al quitarla se borra');

// --- Borrar ---------------------------------------------------------------
const clasica = (await api('GET', '/productos', { token: A })).data.find((p) => p.nombre === 'Hamburguesa clásica');
esperar(409, await api('DELETE', `/productos/${clasica.id}`, { token: A }), 'borrar vendido');
esperar(409, await api('DELETE', `/grupos-modificadores/${adiciones.id}`, { token: A }), 'borrar grupo vendido');
esperar(409, await api('DELETE', `/categorias/${cat.data.id}`, { token: A }), 'borrar categoría con productos');
const nuevo = await api('POST', '/productos', { token: A, body: { categoriaId: cat.data.id, nombre: 'Sin vender', precio: 1000, tipoImpuesto: 'exento', tasaImpuesto: 0 } });
esperar(204, await api('DELETE', `/productos/${nuevo.data.id}`, { token: A }), 'borrar sin vender');
esperar(200, await api('PATCH', `/productos/${prod.data.id}`, { token: A, body: { activo: false } }), 'desactivar vendido');
assert.equal(await delMenu(prod.data.id), undefined);
ok('Lo vendido no se borra (se desactiva); lo que nunca se vendió, sí');

console.log(`\nTodo en orden: ${pasos} verificaciones pasaron.`);
