# POS Restaurante · Backend

API del punto de venta para restaurantes: login por PIN, pedidos, pantalla de cocina en tiempo real, caja, cobro e inventario por receta.

**Stack:** NestJS 12 · TypeScript 6 · PostgreSQL 16 · Socket.IO · `pg` (SQL directo, sin ORM)

## Arranque rápido

Requisitos: Node 22.22.3+ (recomendado Node 24 LTS) y Docker, o un PostgreSQL 14+ propio.

```bash
npm install
cp .env.example .env          # y cambia JWT_SECRET
docker compose up -d          # PostgreSQL en el puerto 5432
npm run db:migrar             # aplica db/migraciones/*.sql en orden
npm run db:semilla            # restaurante de ejemplo
npm run start:dev             # http://localhost:3000/api
```

### Sin Docker (PostgreSQL instalado en Windows)

Crea el usuario y la base una sola vez, desde pgAdmin (Query Tool) o con `psql -U postgres`:

```sql
CREATE USER pos WITH PASSWORD 'pos';
CREATE DATABASE pos OWNER pos;
```

Si `psql` no se reconoce, está en `C:\Program Files\PostgreSQL\<versión>\bin\psql.exe`. Se necesita PostgreSQL 14 o superior.

### Pruebas

```bash
npm test                      # unitarias, sin base de datos
npm run test:integracion      # punta a punta en un esquema aparte (pos_prueba)
```

`test:integracion` rehace el esquema `pos_prueba` dentro de la base de `DATABASE_URL`, aplica migraciones y semilla, arranca el servidor en el puerto 3199 y corre el flujo completo. Tus datos no se tocan y no hace falta permiso para crear bases.

### Prueba de flujo contra un servidor ya corriendo

Con el servidor corriendo (en otra terminal) sobre una base recién sembrada:

```bash
npm run test:flujo            # 22 verificaciones del flujo completo
```

### Usuarios de ejemplo

| Usuario | Rol | Acceso |
|---|---|---|
| Admin Demo | admin | `admin@demo.co` / `CambiaEsto123!` · PIN 0000 |
| Sofía Supervisora | supervisor | PIN 9999 |
| Carlos Cajero | cajero | PIN 1111 |
| María Mesera | mesero | PIN 2222 |
| Pedro Cocina | cocina | PIN 3333 |

## Estructura

```
db/migraciones/     SQL versionado (001 esquema, 002 sesiones, 003 fotos, 004 tandas de ítems, 005 bloqueo de autorizaciones)
scripts/            migrar.mjs, semilla.mjs
src/
  auth/             login PIN y contraseña, refresh rotativo, PIN de supervisor
  pedidos/          crear, agregar ítems, enviar a cocina, anular ítems
  cocina/           KDS: pendientes, cambio de estado, gateway WebSocket
  caja/             abrir turno, ingresos/retiros, cierre con cuadre
  ventas/           cobro con pagos mixtos, anulación, descuento de inventario
  menu/             menú con modificadores y mesas
  inventario/       stock por insumo
  auditoria/        bitácora inmutable
  common/           guards, decoradores, dinero en centavos, filtro de errores
tests/flujo.e2e.mjs prueba de punta a punta
```

## Endpoints

Con el servidor corriendo, la documentación interactiva (OpenAPI) está en http://localhost:3000/api/docs y el JSON en `/api/docs/json`. En producción está apagada salvo que se fije `DOCS_API=true`.

Todas las rutas van bajo `/api` y exigen `Authorization: Bearer <accessToken>`, salvo las marcadas como públicas.

| Método | Ruta | Permiso | Para qué |
|---|---|---|---|
| GET | `/auth/usuarios` | pública | Lista para "toca tu nombre y escribe tu PIN", con el nombre del rol |
| POST | `/auth/pin` | pública | `{ usuarioId, pin }` → tokens y permisos de la sesión |
| POST | `/auth/login` | pública | `{ email, password }` → tokens |
| POST | `/auth/refresh` | pública | `{ refreshToken }` → tokens nuevos (relee los permisos) |
| POST | `/auth/logout` | pública | Revoca el refresh token |
| POST | `/auth/desbloquear` | con sesión | `{ pin }` para volver tras el bloqueo por inactividad |
| GET | `/auth/autorizadores?permiso=` | con sesión | Quiénes pueden aprobar con su PIN una acción |
| GET | `/menu` · `/mesas` | con sesión | Menú con modificadores · mesas con su pedido abierto |
| POST | `/pedidos` | `pedido.tomar` | Crear pedido (con `idempotencyKey`) |
| GET | `/pedidos` · `/pedidos/:id` | ídem | Pedidos abiertos · detalle con totales |
| POST | `/pedidos/:id/items` | ídem | Agregar productos (con `idempotencyKey` por tanda) |
| POST | `/pedidos/:id/enviar-cocina` | ídem | Envía lo nuevo y avisa por WebSocket |
| POST | `/pedidos/:id/items/:itemId/anular` | ídem | Si ya está en cocina, exige `pedido.anular_enviado` o la aprobación de alguien que lo tenga |
| POST | `/pedidos/:id/cerrar-vacio` | ídem | Cierra un pedido con todo anulado y libera la mesa |
| GET | `/cocina/pendientes?estacionId=` | `cocina.operar` | Cola de la pantalla de cocina |
| PATCH | `/cocina/items/:id` | ídem | `{ estado: preparando \| listo \| entregado }` |
| POST | `/caja/turnos` | `caja.operar` | Abrir turno con base |
| GET | `/caja/turnos/actual` | ídem | Turno abierto y resumen; sin `caja.ver_esperado`, a ciegas |
| POST | `/caja/turnos/:id/movimientos` | ídem | Ingreso o retiro; el retiro exige `caja.retiro` o su aprobación |
| POST | `/caja/turnos/:id/cerrar` | ídem | Cuadre: esperado vs. contado |
| POST | `/ventas/cobrar` | `venta.cobrar` | Cobro con pagos mixtos y propina; el descuento exige `venta.descuento` o su aprobación |
| GET | `/ventas/:id` | ídem | Venta con pagos y cambio |
| POST | `/ventas/:id/anular` | ídem | Exige la aprobación de alguien con `venta.anular` y turno abierto |
| GET | `/inventario/stock` | `inventario.ver` | Stock por insumo y alerta de mínimo |
| GET · POST · PATCH · DELETE | `/categorias` · `/categorias/:id` | `menu.editar` | Categorías; `PUT /categorias/orden` con los ids en su orden |
| GET · POST · PATCH · DELETE | `/productos` · `/productos/:id` | ídem | Productos con impuesto, estación y grupos de modificadores; lo vendido no se borra, se desactiva |
| PUT | `/productos/orden` · `/productos/:id/sedes/:sedeId` | ídem | Orden dentro de la categoría · precio propio y disponibilidad por sede |
| PUT | `/productos/:id/agotado` | `menu.agotar` | Agotado en la sede; avisa a las tablets (`menu.cambio`) |
| GET · POST · PATCH · DELETE | `/grupos-modificadores` · `/grupos-modificadores/:id` | `menu.editar` | Grupos con mínimo, máximo y opciones; `POST /:id/opciones`, `PATCH /modificadores/:id` |
| GET | `/usuarios?buscar=&limite=&cursor=` | `usuario.editar` | Usuarios con sus roles por sede, paginados |
| POST · PATCH | `/usuarios` · `/usuarios/:id` | ídem | Crear; cambiar nombre, correo o activo (desactivar cierra sus sesiones) |
| PUT | `/usuarios/:id/pin` · `/usuarios/:id/contrasena` · `/usuarios/:id/roles` | ídem | PIN y contraseña con política; roles por sede, aplicados al momento |
| POST | `/usuarios/:id/cerrar-sesiones` | ídem | Cierra todas sus sesiones |
| GET | `/roles` · `/roles/permisos` | `usuario.editar` o `rol.editar` | Roles con permisos y cuántos los usan · catálogo de permisos |
| POST · PATCH · DELETE | `/roles` · `/roles/:id` | `rol.editar` | Crear, editar y borrar roles propios |

### WebSocket de cocina

```js
const socket = io('http://localhost:3000/cocina', { auth: { token: accessToken } });
socket.on('comanda.nueva', (c) => ...);  // { pedidoId, numero, mesa, items[] }
socket.on('item.estado', (e) => ...);    // { itemId, pedidoId, estado, producto, mesa, numero }
socket.on('item.anulado', (e) => ...);   // { itemId, pedidoId, producto, motivo }
```

Cada conexión entra a la sala de su sede, así que una sede nunca ve comandas de otra.

## Decisiones de seguridad

- **Todo es privado por defecto.** Los guards globales exigen token y, donde se declara con `@RequierePermiso()`, un permiso; solo `@Publico()` abre una ruta.
- **Permisos por acción, no roles fijos.** Cada empresa tiene roles (cinco de fábrica más los que cree) y cada rol, una lista de permisos del catálogo de `src/common/permisos.ts`. Un usuario puede tener un rol distinto en cada sede. El admin tiene siempre todos los permisos. El token lleva los permisos de la sesión; un cambio de rol se aplica al renovarlo (15 min como máximo).
- **Access token de 15 min y refresh token de un solo uso.** El refresh se guarda como hash SHA-256. Si alguien reutiliza uno ya usado, se cierran todas las sesiones de ese usuario y queda en auditoría. Cerrar sesión o detectar un robo corta al instante el access token y el WebSocket de esa sesión (o de todas las del usuario), sin esperar los 15 minutos; la lista de revocados vive en memoria, así que con varias instancias habrá que pasarla a Redis.
- **Fuerza bruta:** 5 PIN errados bloquean al usuario 5 minutos (423), y los ingresos tienen dos límites (429): 10 intentos por minuto para cada usuario y 60 por minuto desde una misma IP sumando todos. Detrás de Nginx o Caddy hay que fijar `TRUST_PROXY` (por ejemplo `loopback`); si no, todas las peticiones parecen venir de la misma IP. En las autorizaciones de supervisor, los 5 intentos fallidos bloquean a quien las pide, no al supervisor, y cada fallo queda en auditoría.
- **Nadie da más poder del que tiene:** solo se asignan roles y permisos que uno mismo tenga, no se edita a quien tenga permisos que uno no tiene, nadie se desactiva ni se cambia el rol a sí mismo, y siempre queda un admin activo. Quien tenga permisos de administración entra con correo y contraseña, no con PIN.
- **Acciones sensibles con aprobación por PIN:** descuentos, anular ítems ya enviados a cocina, anular ventas y retiros de caja. Las aprueba quien tenga el permiso de esa acción en la sede. Todo queda en `auditoria`, que la base de datos no deja editar ni borrar.
- **El servidor calcula los totales.** El cliente solo dice qué productos y cuánto paga con cada método; si no cuadra, no cobra.
- **Idempotencia** al crear pedidos, al agregarles productos y al cobrar: un reintento por mala señal no duplica nada.
- **Bloqueos de fila** (`FOR UPDATE`) para que dos personas no cobren el mismo pedido ni abran la misma mesa a la vez.
- **Validación estricta:** campos que no estén en el DTO se rechazan con 400.
- Helmet, CORS restringido y errores de PostgreSQL traducidos a respuestas claras en vez de 500.

## Dinero e impuestos

- Los precios del menú son **finales** (impuesto incluido); al cobrar se desglosa `base = precio / (1 + tasa)`.
- Todo se calcula en centavos enteros para no perder pesos por redondeo.
- La tasa y el tipo de impuesto (impoconsumo, IVA o exento) se configuran por producto. Verifica con tu contador cuál aplica a cada cliente.

## Fotos de productos

La migración `003` agrega `producto.imagen_url`, que `/api/menu` devuelve como `imagenUrl`. Por ahora se llena con SQL; el frontend muestra la inicial del producto cuando no hay foto.

## Pendiente

- **Facturación electrónica DIAN:** cada venta queda con `factura_estado = 'pendiente'`. Falta el worker que la envíe a un proveedor tecnológico autorizado y guarde CUFE y número.
- **Notas crédito** para anular ventas de turnos cerrados o ya facturadas.
- **Agente local de impresión** (comandas por estación y tiquete de caja).
- **Sincronización offline** del lado del cliente (las claves de idempotencia ya están listas para eso).
- Al pasar a multi-restaurante: políticas RLS por `empresa_id` (ya está en todas las tablas raíz).
