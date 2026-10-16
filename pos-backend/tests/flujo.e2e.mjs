// Prueba de punta a punta del flujo mesa → cocina → cobro → cierre de caja.
// Requiere el servidor corriendo sobre una base recién sembrada (npm run db:semilla).
// Uso: API_URL=http://localhost:3000 npm run test:flujo
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

console.log('Flujo completo del POS');

// --- Login ---------------------------------------------------------------
const rUsuarios = await api('GET', '/auth/usuarios');
if (rUsuarios.status !== 200 || !Array.isArray(rUsuarios.data)) {
  console.error(`\n✘ El servidor respondió ${rUsuarios.status} en /api/auth/usuarios:`, rUsuarios.data);
  console.error('  Revisa la terminal del servidor. Lo más común: la base no está migrada o el .env no conecta.');
  process.exit(1);
}
const usuarios = rUsuarios.data;
if (!['cajero', 'mesero', 'cocina', 'supervisor'].every((r) => usuarios.some((u) => u.rol === r))) {
  console.error('\n✘ Faltan los usuarios de ejemplo. Corre "npm run db:semilla" sobre una base recién migrada.');
  process.exit(1);
}
const quien = (rol) => usuarios.find((u) => u.rol === rol);
const login = async (rol, pin) => {
  const r = await api('POST', '/auth/pin', { body: { usuarioId: quien(rol).id, pin } });
  esperar(200, r, `login ${rol}`);
  return r.data;
};

esperar(401, await api('POST', '/auth/pin', { body: { usuarioId: quien('cocina').id, pin: '0001' } }), 'PIN errado');
ok('PIN incorrecto rechazado');

const cajero = await login('cajero', '1111');
const mesera = await login('mesero', '2222');
const cocina = await login('cocina', '3333');
const supervisora = quien('supervisor');
ok('Login por PIN de cajero, mesera y cocina');

esperar(401, await api('GET', '/pedidos'), 'sin token');
esperar(403, await api('GET', '/pedidos', { token: cocina.accessToken }), 'cocina no ve pedidos');
ok('Rutas protegidas por token y por rol');

// --- Refresh rotativo ----------------------------------------------------
const r1 = await api('POST', '/auth/refresh', { body: { refreshToken: cajero.refreshToken } });
esperar(200, r1, 'refresh');
esperar(401, await api('POST', '/auth/refresh', { body: { refreshToken: cajero.refreshToken } }), 'refresh reutilizado');
esperar(401, await api('POST', '/auth/refresh', { body: { refreshToken: r1.data.refreshToken } }), 'familia revocada');
ok('Refresh token de un solo uso; reutilizarlo cierra todas las sesiones');

// --- Menú y mesas --------------------------------------------------------
const menu = (await api('GET', '/menu', { token: mesera.accessToken })).data;
const prod = (n) => menu.find((p) => p.nombre === n);
const clasica = prod('Hamburguesa clásica');
const limonada = prod('Limonada natural');
const opcion = (p, grupo, nombre) =>
  p.modificadores.find((g) => g.nombre === grupo).opciones.find((o) => o.nombre === nombre).id;
const mesas = (await api('GET', '/mesas', { token: mesera.accessToken })).data;
const mesa1 = mesas.find((m) => m.numero === '1');
ok(`Menú con ${menu.length} productos y ${mesas.length} mesas`);

// --- Abrir caja ----------------------------------------------------------
const turno = await api('POST', '/caja/turnos', { token: cajero.accessToken, body: { montoInicial: 100000 } });
esperar(201, turno, 'abrir turno');
esperar(409, await api('POST', '/caja/turnos', { token: cajero.accessToken, body: { montoInicial: 0 } }), 'turno doble');
ok('Turno de caja abierto con $100.000 de base (y no se puede abrir otro)');

// --- Cocina escuchando ---------------------------------------------------
const socket = io(`${BASE}/cocina`, { auth: { token: cocina.accessToken }, transports: ['websocket'] });
await new Promise((res, rej) => { socket.on('connect', res); socket.on('connect_error', rej); });
const comandaRecibida = new Promise((res) => socket.once('comanda.nueva', res));
ok('Pantalla de cocina conectada por WebSocket');

// --- Pedido --------------------------------------------------------------
const sinTermino = await api('POST', '/pedidos', {
  token: mesera.accessToken,
  body: { idempotencyKey: randomUUID(), tipoServicio: 'mesa', mesaId: mesa1.id, items: [{ productoId: clasica.id, cantidad: 1 }] },
});
esperar(400, sinTermino, 'hamburguesa sin término');
ok(`Validación de modificadores: "${sinTermino.data.message}"`);

const claveP = randomUUID();
const cuerpoPedido = {
  idempotencyKey: claveP,
  tipoServicio: 'mesa',
  mesaId: mesa1.id,
  personas: 2,
  items: [
    {
      productoId: clasica.id,
      cantidad: 2,
      notas: 'Sin cebolla',
      modificadorIds: [opcion(clasica, 'Término de la carne', 'Tres cuartos'), opcion(clasica, 'Adiciones', 'Extra queso')],
    },
    { productoId: limonada.id, cantidad: 1 },
  ],
};
const pedido = await api('POST', '/pedidos', { token: mesera.accessToken, body: cuerpoPedido });
esperar(201, pedido, 'crear pedido');
assert.equal(pedido.data.totales.total, '64000.00');
ok(`Pedido #${pedido.data.numero} en mesa 1 por $${pedido.data.totales.total} (2×(25.000+3.000) + 8.000)`);

const repetido = await api('POST', '/pedidos', { token: mesera.accessToken, body: cuerpoPedido });
assert.equal(repetido.data.id, pedido.data.id);
ok('Reenviar el mismo pedido no lo duplica (idempotencia)');

esperar(409, await api('POST', '/pedidos', {
  token: mesera.accessToken,
  body: { idempotencyKey: randomUUID(), tipoServicio: 'mesa', mesaId: mesa1.id, items: [] },
}), 'mesa ocupada');
ok('No se puede abrir un segundo pedido en una mesa ocupada');

// --- Cocina --------------------------------------------------------------
esperar(200, await api('POST', `/pedidos/${pedido.data.id}/enviar-cocina`, { token: mesera.accessToken }), 'enviar a cocina');
const comanda = await comandaRecibida;
assert.equal(comanda.items.length, 2);
ok(`Comanda recibida en cocina en tiempo real: ${comanda.items.map((i) => `${i.cantidad}× ${i.producto} [${i.estacion}]`).join(', ')}`);

const itemLimonada = pedido.data.items.find((i) => i.producto === 'Limonada natural');
esperar(403, await api('POST', `/pedidos/${pedido.data.id}/items/${itemLimonada.id}/anular`, {
  token: mesera.accessToken, body: { motivo: 'Cliente cambió de opinión' },
}), 'anular sin supervisor');
ok('Anular algo que ya está en cocina exige PIN de supervisor');

for (const item of comanda.items) {
  for (const estado of ['preparando', 'listo', 'entregado']) {
    esperar(200, await api('PATCH', `/cocina/items/${item.id}`, { token: cocina.accessToken, body: { estado } }), `item → ${estado}`);
  }
}
esperar(409, await api('PATCH', `/cocina/items/${comanda.items[0].id}`, { token: cocina.accessToken, body: { estado: 'preparando' } }), 'retroceso');
const servido = await api('GET', `/pedidos/${pedido.data.id}`, { token: mesera.accessToken });
assert.equal(servido.data.estado, 'servido');
ok('Cocina: preparando → listo → entregado; el pedido queda servido');

// --- Cobro ---------------------------------------------------------------
const baseCobro = { pedidoId: pedido.data.id, descuento: 4000, propina: 6000 };
esperar(403, await api('POST', '/ventas/cobrar', {
  token: cajero.accessToken,
  body: { ...baseCobro, idempotencyKey: randomUUID(), pagos: [{ metodo: 'efectivo', monto: 66000 }] },
}), 'descuento sin supervisor');
ok('Un descuento sin PIN de supervisor se rechaza');

esperar(400, await api('POST', '/ventas/cobrar', {
  token: cajero.accessToken,
  body: { ...baseCobro, idempotencyKey: randomUUID(), pagos: [{ metodo: 'efectivo', monto: 60000 }],
          autorizacion: { supervisorId: supervisora.id, pin: '9999' } },
}), 'pagos no cuadran');
ok('Si los pagos no cuadran con el total, no se cobra');

const claveV = randomUUID();
const cobro = {
  ...baseCobro,
  idempotencyKey: claveV,
  autorizacion: { supervisorId: supervisora.id, pin: '9999' },
  pagos: [
    { metodo: 'efectivo', monto: 50000, recibido: 60000 },
    { metodo: 'tarjeta', monto: 16000, referencia: 'VOUCHER-123' },
  ],
};
const venta = await api('POST', '/ventas/cobrar', { token: cajero.accessToken, body: cobro });
esperar(201, venta, 'cobrar');
assert.equal(venta.data.total, '66000.00');
assert.equal(venta.data.cambio, '10000.00');
ok(`Cobrado $${venta.data.total} (subtotal ${venta.data.subtotal} + impoconsumo ${venta.data.impuestos} − desc. ${venta.data.descuento} + propina ${venta.data.propina}); cambio $${venta.data.cambio}`);

const ventaRepetida = await api('POST', '/ventas/cobrar', { token: cajero.accessToken, body: cobro });
assert.equal(ventaRepetida.data.id, venta.data.id);
ok('Reintentar el cobro devuelve la misma venta (no cobra dos veces)');

const mesasDespues = (await api('GET', '/mesas', { token: mesera.accessToken })).data;
assert.equal(mesasDespues.find((m) => m.numero === '1').estado, 'libre');
ok('La mesa 1 quedó libre');

const stock = (await api('GET', '/inventario/stock', { token: cajero.accessToken })).data;
const carne = stock.find((s) => s.nombre === 'Carne de res');
const pan = stock.find((s) => s.nombre === 'Pan de hamburguesa');
assert.equal(Number(carne.cantidad), 10000 - 300);
assert.equal(Number(pan.cantidad), 50 - 2);
ok(`Inventario descontado por receta: carne ${carne.cantidad} g, pan ${pan.cantidad} und`);

// --- Cierre de caja ------------------------------------------------------
const cierre = await api('POST', `/caja/turnos/${turno.data.id}/cerrar`, { token: cajero.accessToken, body: { montoContado: 150000 } });
esperar(200, cierre, 'cerrar turno');
assert.equal(cierre.data.diferencia, '0.00');
ok(`Caja cerrada: esperado $${cierre.data.turno.monto_esperado} (100.000 base + 50.000 efectivo), diferencia $${cierre.data.diferencia}`);

esperar(409, await api('POST', `/ventas/${venta.data.id}/anular`, {
  token: cajero.accessToken, body: { motivo: 'Prueba', autorizacion: { supervisorId: supervisora.id, pin: '9999' } },
}), 'anular en turno cerrado');
ok('Una venta de un turno cerrado no se puede anular (va por nota crédito)');

socket.close();
console.log(`\nTodo en orden: ${pasos} verificaciones pasaron.`);
