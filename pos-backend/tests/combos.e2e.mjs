// Prueba de punta a punta de los combos: configurarlos, pedirlos con
// modificadores en sus partes, cocina por estación, anulación, inventario y
// agotados. Requiere el servidor sobre una base sembrada (la arma
// test:integracion) y corre después de las demás pruebas.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

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

console.log('Combos');

const usuarios = (await api('GET', '/auth/usuarios')).data;
const quien = (clave) => usuarios.find((u) => u.rolClave === clave);
const A = (await api('POST', '/auth/login', { body: { email: 'admin@demo.co', password: process.env.SEED_ADMIN_PASSWORD ?? 'CambiaEsto123!' } })).data.accessToken;
const pin = async (clave, p) => (await api('POST', '/auth/pin', { body: { usuarioId: quien(clave).id, pin: p } })).data.accessToken;
const M = await pin('mesero', '2222');
const C = await pin('cocina', '3333');
const CJ = await pin('cajero', '1111');

const productos = (await api('GET', '/productos', { token: A })).data;
const prod = (nombre) => productos.find((p) => p.nombre === nombre);
const grupos = (await api('GET', '/grupos-modificadores', { token: A })).data;
const opcion = (grupo, nombre) => grupos.find((g) => g.nombre === grupo).opciones.find((o) => o.nombre === nombre).id;

// --- Configurar -----------------------------------------------------------
const combo = await api('POST', '/productos', {
  token: A,
  body: { categoriaId: prod('Hamburguesa clásica').categoriaId, nombre: 'Combo clásico', tipo: 'combo', precio: 30000, tipoImpuesto: 'impoconsumo', tasaImpuesto: 8 },
});
esperar(201, combo, 'crear combo');
const estructura = {
  secciones: [
    { nombre: 'Plato fuerte', min: 1, max: 1, opciones: [{ productoId: prod('Hamburguesa clásica').id, precioExtra: 0 }, { productoId: prod('Hamburguesa doble').id, precioExtra: 5000 }] },
    { nombre: 'Bebida', min: 1, max: 1, opciones: [{ productoId: prod('Gaseosa').id, precioExtra: 0 }, { productoId: prod('Limonada natural').id, precioExtra: 2000 }] },
  ],
};
esperar(400, await api('PUT', `/productos/${combo.data.id}/combo`, { token: A, body: { secciones: [{ nombre: 'Mal', min: 1, max: 1, opciones: [{ productoId: combo.data.id, precioExtra: 0 }] }] } }), 'combo dentro de sí mismo');
esperar(400, await api('PUT', `/productos/${combo.data.id}/combo`, { token: A, body: { secciones: [{ nombre: 'Mal', min: 2, max: 2, opciones: [{ productoId: prod('Gaseosa').id, precioExtra: 0 }] }] } }), 'pide más de las que hay');
esperar(400, await api('PUT', `/productos/${prod('Gaseosa').id}/combo`, { token: A, body: estructura }), 'producto que no es combo');
esperar(200, await api('PUT', `/productos/${combo.data.id}/combo`, { token: A, body: estructura }), 'armar combo');
const enMenu = (await api('GET', '/menu', { token: M })).data.find((p) => p.id === combo.data.id);
assert.equal(enMenu.tipo, 'combo');
assert.deepEqual(enMenu.secciones.map((s) => s.nombre), ['Plato fuerte', 'Bebida']);
assert.deepEqual(enMenu.secciones[0].opciones[1].modificadores.map((g) => g.nombre), ['Adiciones', 'Término de la carne']);
ok('Combo con plato fuerte y bebida; en el menú trae sus partes y los modificadores de cada opción');

// --- Pedirlo --------------------------------------------------------------
const plato = enMenu.secciones[0];
const bebida = enMenu.secciones[1];
const doble = { seccionId: plato.id, productoId: prod('Hamburguesa doble').id, modificadorIds: [opcion('Término de la carne', 'Tres cuartos'), opcion('Adiciones', 'Extra queso')] };
const limonada = { seccionId: bebida.id, productoId: prod('Limonada natural').id };
const pedir = (componentes) =>
  api('POST', '/pedidos', { token: M, body: { idempotencyKey: randomUUID(), tipoServicio: 'para_llevar', items: [{ productoId: combo.data.id, cantidad: 1, componentes }] } });

assert.match((await pedir([doble])).data.message, /Bebida/);
assert.match((await pedir([{ ...doble, modificadorIds: [] }, limonada])).data.message, /Término/);
assert.match((await pedir([doble, { ...limonada, seccionId: plato.id }])).data.message, /no está en/);
esperar(400, await api('POST', '/pedidos', { token: M, body: { idempotencyKey: randomUUID(), tipoServicio: 'para_llevar', items: [{ productoId: prod('Gaseosa').id, cantidad: 1, componentes: [limonada] }] } }), 'componentes en un producto simple');
const pedido = await pedir([doble, limonada]);
esperar(201, pedido, 'pedir combo');
// 30.000 + 5.000 (doble) + 3.000 (extra queso) + 2.000 (limonada)
assert.equal(pedido.data.totales.total, '40000.00');
const padre = pedido.data.items.find((i) => i.productoId === combo.data.id);
const partes = pedido.data.items.filter((i) => i.comboItemId === padre.id);
assert.deepEqual(partes.map((i) => `${i.comboSeccion}: ${i.producto}`).sort(), ['Bebida: Limonada natural', 'Plato fuerte: Hamburguesa doble']);
ok('Sin bebida, sin término o con una opción de otra parte, no se pide; bien armado cobra $40.000 con sus extras');

// --- Cocina ---------------------------------------------------------------
const comanda = await api('POST', `/pedidos/${pedido.data.id}/enviar-cocina`, { token: M });
esperar(200, comanda, 'enviar a cocina');
assert.deepEqual(comanda.data.items.map((i) => `${i.producto} [${i.estacion}] (${i.combo})`).sort(), [
  'Hamburguesa doble [Cocina caliente] (Combo clásico)',
  'Limonada natural [Bar] (Combo clásico)',
]);
for (const it of comanda.data.items) {
  for (const estado of ['preparando', 'listo', 'entregado']) {
    esperar(200, await api('PATCH', `/cocina/items/${it.id}`, { token: C, body: { estado } }), `${it.producto} → ${estado}`);
  }
}
esperar(404, await api('PATCH', `/cocina/items/${padre.id}`, { token: C, body: { estado: 'preparando' } }), 'cocina toca el combo');
assert.equal((await api('GET', `/pedidos/${pedido.data.id}`, { token: M })).data.estado, 'servido');
ok('Cocina recibe cada parte en su estación con el nombre del combo; entregadas las partes, el pedido queda servido');

// --- Anular ---------------------------------------------------------------
const otro = await pedir([doble, limonada]);
await api('POST', `/pedidos/${otro.data.id}/enviar-cocina`, { token: M });
const otroPadre = otro.data.items.find((i) => i.productoId === combo.data.id);
const otraParte = otro.data.items.find((i) => i.comboItemId === otroPadre.id);
esperar(400, await api('POST', `/pedidos/${otro.data.id}/items/${otraParte.id}/anular`, { token: M, body: { motivo: 'Solo la bebida' } }), 'anular una parte');
const sup = await pin('supervisor', '9999');
esperar(200, await api('POST', `/pedidos/${otro.data.id}/items/${otroPadre.id}/anular`, { token: sup, body: { motivo: 'Prueba de combos' } }), 'anular combo');
const tras = (await api('GET', `/pedidos/${otro.data.id}`, { token: M })).data;
assert.ok(tras.items.every((i) => i.estado === 'anulado'));
assert.equal(tras.totales.total, '0.00');
const cola = (await api('GET', '/cocina/pendientes', { token: C })).data;
assert.ok(!cola.some((i) => i.pedidoId === otro.data.id));
ok('Una parte sola no se anula; anular el combo anula sus partes y salen de la cola de cocina');

// --- Inventario -----------------------------------------------------------
const stock = async () => Object.fromEntries((await api('GET', '/inventario/stock', { token: CJ })).data.map((s) => [s.nombre, Number(s.cantidad)]));
const antes = await stock();
const turno = await api('POST', '/caja/turnos', { token: CJ, body: { montoInicial: 0, caja: 'Caja combos' } });
esperar(201, turno, 'abrir caja');
const clasico = await pedir([{ seccionId: plato.id, productoId: prod('Hamburguesa clásica').id, modificadorIds: [opcion('Término de la carne', 'Bien asada')] }, { seccionId: bebida.id, productoId: prod('Gaseosa').id }]);
esperar(201, clasico, 'pedir clásico');
const venta = await api('POST', '/ventas/cobrar', {
  token: CJ,
  body: { idempotencyKey: randomUUID(), pedidoId: clasico.data.id, caja: 'Caja combos', pagos: [{ metodo: 'efectivo', monto: 30000 }] },
});
esperar(201, venta, 'cobrar combo');
const despues = await stock();
assert.equal(antes['Carne de res'] - despues['Carne de res'], 150);
assert.equal(antes['Pan de hamburguesa'] - despues['Pan de hamburguesa'], 1);
esperar(200, await api('POST', `/caja/turnos/${turno.data.id}/cerrar`, { token: CJ, body: { montoContado: 30000 } }), 'cerrar caja');
ok('Al cobrar el combo se descuenta la receta de la hamburguesa que lleva (150 g de carne y un pan)');

// --- Agotados y borrado ---------------------------------------------------
esperar(200, await api('PUT', `/productos/${prod('Gaseosa').id}/agotado`, { token: C, body: { agotado: true } }), 'agotar gaseosa');
const sinGaseosa = (await api('GET', '/menu', { token: M })).data.find((p) => p.id === combo.data.id);
assert.deepEqual(sinGaseosa.secciones[1].opciones.map((o) => o.nombre), ['Limonada natural']);
assert.match((await pedir([doble, { seccionId: bebida.id, productoId: prod('Gaseosa').id }])).data.message, /agotado/);
esperar(200, await api('PUT', `/productos/${prod('Gaseosa').id}/agotado`, { token: C, body: { agotado: false } }), 'desagotar gaseosa');
const suelto = await api('POST', '/productos', { token: A, body: { categoriaId: prod('Gaseosa').categoriaId, nombre: 'Agua de prueba', precio: 3000, tipoImpuesto: 'exento', tasaImpuesto: 0 } });
estructura.secciones[1].opciones.push({ productoId: suelto.data.id, precioExtra: 0 });
esperar(200, await api('PUT', `/productos/${combo.data.id}/combo`, { token: A, body: estructura }), 'agregar agua');
assert.match((await api('DELETE', `/productos/${suelto.data.id}`, { token: A })).data.message, /combo/);
ok('Una opción agotada desaparece del combo y no se puede pedir; un producto que está en un combo no se borra');

console.log(`\nTodo en orden: ${pasos} verificaciones pasaron.`);
