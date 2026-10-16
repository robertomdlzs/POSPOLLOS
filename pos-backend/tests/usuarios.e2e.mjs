// Prueba de punta a punta de usuarios y roles: alta, PIN, roles por sede,
// revocación al cambiar permisos y las reglas contra escalar privilegios.
// Requiere el servidor corriendo sobre una base sembrada (la arma test:integracion).
import assert from 'node:assert/strict';

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

console.log('Usuarios y roles');

const CLAVE_ADMIN = process.env.SEED_ADMIN_PASSWORD ?? 'CambiaEsto123!';
const entrarCorreo = async (email, password) => {
  const r = await api('POST', '/auth/login', { body: { email, password } });
  esperar(200, r, `login ${email}`);
  return r.data;
};
const entrarPin = async (usuarioId, pin) => {
  const r = await api('POST', '/auth/pin', { body: { usuarioId, pin } });
  esperar(200, r, `login PIN ${usuarioId}`);
  return r.data;
};

const admin = await entrarCorreo('admin@demo.co', CLAVE_ADMIN);
const A = admin.accessToken;
const sede = admin.usuario.sedeId;

// --- Catálogo y roles -----------------------------------------------------
const catalogo = await api('GET', '/roles/permisos', { token: A });
esperar(200, catalogo, 'catálogo');
const roles = (await api('GET', '/roles', { token: A })).data;
const rol = (nombre) => roles.find((r) => r.nombre === nombre);
assert.equal(rol('Administración').editable, false);
assert.equal(rol('Administración').permisos.length, catalogo.data.length);
ok(`Catálogo de ${catalogo.data.length} permisos y ${roles.length} roles; el de administración no se edita`);

// --- Alta con PIN ---------------------------------------------------------
esperar(400, await api('POST', '/usuarios', { token: A, body: { nombre: 'Ana', pin: '1234', roles: [{ sedeId: sede, rolId: rol('Salón').id }] } }), 'PIN trivial');
const ana = await api('POST', '/usuarios', { token: A, body: { nombre: 'Ana Prueba', pin: '2580', roles: [{ sedeId: sede, rolId: rol('Salón').id }] } });
esperar(201, ana, 'crear Ana');
let sesionAna = await entrarPin(ana.data.id, '2580');
assert.deepEqual(sesionAna.usuario.permisos, ['pedido.tomar']);
ok('Un PIN trivial se rechaza; Ana se crea con rol Salón y entra con su PIN');

// --- Cambio de rol: se aplica al momento ----------------------------------
esperar(200, await api('PUT', `/usuarios/${ana.data.id}/roles`, { token: A, body: { roles: [{ sedeId: sede, rolId: rol('Caja').id }] } }), 'rol Caja');
esperar(401, await api('GET', '/auth/yo', { token: sesionAna.accessToken }), 'token viejo de Ana');
const renovada = await api('POST', '/auth/refresh', { body: { refreshToken: sesionAna.refreshToken } });
esperar(200, renovada, 'refresh Ana');
assert.ok(renovada.data.usuario.permisos.includes('venta.cobrar'));
sesionAna = renovada.data;
ok('Al pasarla a Caja, su token viejo deja de servir y al renovarlo trae los permisos nuevos');

// --- Rol propio con administración de usuarios ----------------------------
const jefeRol = await api('POST', '/roles', {
  token: A,
  body: { nombre: 'Jefe de turno', permisos: ['pedido.tomar', 'caja.operar', 'venta.cobrar', 'usuario.editar'] },
});
esperar(201, jefeRol, 'crear rol');
esperar(400, await api('POST', '/usuarios', { token: A, body: { nombre: 'Jefe sin correo', pin: '2580', roles: [{ sedeId: sede, rolId: jefeRol.data.id }] } }), 'jefe sin correo');
const jefe = await api('POST', '/usuarios', {
  token: A,
  body: { nombre: 'Jaime Jefe', email: 'jefe@demo.co', password: 'JefeTurno2026', pin: '7391', roles: [{ sedeId: sede, rolId: jefeRol.data.id }] },
});
esperar(201, jefe, 'crear jefe');
esperar(403, await api('POST', '/auth/pin', { body: { usuarioId: jefe.data.id, pin: '7391' } }), 'jefe con PIN');
const J = (await entrarCorreo('jefe@demo.co', 'JefeTurno2026')).accessToken;
ok('Un rol con administración de usuarios exige correo y contraseña, y no entra con PIN');

// --- Contra escalar privilegios -------------------------------------------
esperar(403, await api('PUT', `/usuarios/${ana.data.id}/roles`, { token: J, body: { roles: [{ sedeId: sede, rolId: rol('Administración').id }] } }), 'jefe da admin');
esperar(403, await api('PUT', `/usuarios/${ana.data.id}/roles`, { token: J, body: { roles: [{ sedeId: sede, rolId: rol('Supervisión').id }] } }), 'jefe da supervisión');
esperar(403, await api('PATCH', `/usuarios/${admin.usuario.id}`, { token: J, body: { activo: false } }), 'jefe desactiva admin');
esperar(403, await api('PUT', `/usuarios/${admin.usuario.id}/pin`, { token: J, body: { pin: '2580' } }), 'jefe cambia PIN del admin');
esperar(403, await api('POST', '/roles', { token: J, body: { nombre: 'Atajo', permisos: ['venta.anular'] } }), 'jefe crea rol');
esperar(400, await api('PUT', `/usuarios/${jefe.data.id}/roles`, { token: J, body: { roles: [{ sedeId: sede, rolId: rol('Administración').id }] } }), 'jefe se cambia a sí mismo');
const deJefe = await api('POST', '/usuarios', { token: J, body: { nombre: 'Mesero Nuevo', pin: '4826', roles: [{ sedeId: sede, rolId: rol('Salón').id }] } });
esperar(201, deJefe, 'jefe crea mesero');
ok('El jefe no puede dar roles más poderosos que el suyo, ni tocar al admin, ni cambiarse el rol; sí crear un mesero');

// --- El último admin y uno mismo ------------------------------------------
esperar(400, await api('PATCH', `/usuarios/${admin.usuario.id}`, { token: A, body: { activo: false } }), 'admin se desactiva');
esperar(400, await api('PUT', `/usuarios/${admin.usuario.id}/roles`, { token: A, body: { roles: [] } }), 'admin se quita el rol');
ok('Nadie se desactiva ni se cambia el rol a sí mismo, así que no se queda el restaurante sin admin');

// --- Desactivar corta todo ------------------------------------------------
esperar(200, await api('PATCH', `/usuarios/${ana.data.id}`, { token: A, body: { activo: false } }), 'desactivar Ana');
esperar(401, await api('GET', '/auth/yo', { token: sesionAna.accessToken }), 'token de Ana desactivada');
esperar(401, await api('POST', '/auth/refresh', { body: { refreshToken: sesionAna.refreshToken } }), 'refresh de Ana desactivada');
esperar(401, await api('POST', '/auth/pin', { body: { usuarioId: ana.data.id, pin: '2580' } }), 'PIN de Ana desactivada');
ok('Al desactivar a Ana se cortan su token, su sesión y su PIN');

// --- Editar los permisos de un rol los cambia a quienes lo tienen ---------
const mesero = await entrarPin(deJefe.data.id, '4826');
esperar(200, await api('PATCH', `/roles/${rol('Salón').id}`, { token: A, body: { permisos: ['pedido.tomar', 'inventario.ver'] } }), 'editar Salón');
esperar(401, await api('GET', '/auth/yo', { token: mesero.accessToken }), 'token viejo del mesero');
const meseroNuevo = (await api('POST', '/auth/refresh', { body: { refreshToken: mesero.refreshToken } })).data;
assert.ok(meseroNuevo.usuario.permisos.includes('inventario.ver'));
esperar(200, await api('PATCH', `/roles/${rol('Salón').id}`, { token: A, body: { permisos: ['pedido.tomar'] } }), 'restaurar Salón');
ok('Cambiar los permisos de Salón se le aplica al momento a quien tiene ese rol');

// --- Borrar un rol en uso -------------------------------------------------
esperar(400, await api('DELETE', `/roles/${rol('Salón').id}`, { token: A }), 'borrar rol de fábrica');
esperar(409, await api('DELETE', `/roles/${jefeRol.data.id}`, { token: A }), 'borrar rol en uso');
esperar(200, await api('PUT', `/usuarios/${jefe.data.id}/roles`, { token: A, body: { roles: [{ sedeId: sede, rolId: rol('Caja').id }] } }), 'jefe a Caja');
esperar(204, await api('DELETE', `/roles/${jefeRol.data.id}`, { token: A }), 'borrar rol libre');
ok('Los roles de fábrica no se borran; uno propio, solo cuando nadie lo tiene');

// --- Correo duplicado y paginación ----------------------------------------
esperar(409, await api('PATCH', `/usuarios/${ana.data.id}`, { token: A, body: { email: 'jefe@demo.co' } }), 'correo duplicado');
const p1 = await api('GET', '/usuarios?limite=3', { token: A });
esperar(200, p1, 'página 1');
assert.equal(p1.data.datos.length, 3);
const p2 = await api('GET', `/usuarios?limite=3&cursor=${p1.data.siguiente}`, { token: A });
const vistos = [...p1.data.datos, ...p2.data.datos].map((x) => x.id);
assert.equal(new Set(vistos).size, vistos.length);
const buscado = await api('GET', '/usuarios?buscar=jaime', { token: A });
assert.deepEqual(buscado.data.datos.map((x) => x.nombre), ['Jaime Jefe']);
ok('Un correo repetido da 409; la lista pagina sin repetir y busca por nombre');

console.log(`\nTodo en orden: ${pasos} verificaciones pasaron.`);
