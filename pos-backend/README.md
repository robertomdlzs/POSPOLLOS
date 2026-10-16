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

### Prueba de flujo

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
db/migraciones/     SQL versionado (001 esquema, 002 sesiones y seguridad)
scripts/            migrar.mjs, semilla.mjs
src/
  auth/             login PIN y contraseña, refresh rotativo, PIN de supervisor
  pedidos/          crear, agregar ítems, enviar a cocina, anular ítems
  cocina/           KDS: pendientes, cambio de estado, gateway WebSocket
  caja/             abrir turno, ingresos/retiros, cierre con cuadre
  ventas/           cobro con pagos mixtos, anulación, descuento de inventario
  menu/             menú con modificadores, mesas, stock
  auditoria/        bitácora inmutable
  common/           guards, decoradores, dinero en centavos, filtro de errores
tests/flujo.e2e.mjs prueba de punta a punta
```

## Endpoints

Todas las rutas van bajo `/api` y exigen `Authorization: Bearer <accessToken>`, salvo las marcadas como públicas.

| Método | Ruta | Roles | Para qué |
|---|---|---|---|
| GET | `/auth/usuarios` | pública | Lista para "toca tu nombre y escribe tu PIN" |
| POST | `/auth/pin` | pública | `{ usuarioId, pin }` → tokens |
| POST | `/auth/login` | pública | `{ email, password }` → tokens |
| POST | `/auth/refresh` | pública | `{ refreshToken }` → tokens nuevos |
| POST | `/auth/logout` | pública | Revoca el refresh token |
| GET | `/menu` · `/mesas` | todos | Menú con modificadores · mesas con su pedido abierto |
| POST | `/pedidos` | mesero, cajero, supervisor | Crear pedido (con `idempotencyKey`) |
| GET | `/pedidos` · `/pedidos/:id` | ídem | Pedidos abiertos · detalle con totales |
| POST | `/pedidos/:id/items` | ídem | Agregar productos |
| POST | `/pedidos/:id/enviar-cocina` | ídem | Envía lo nuevo y avisa por WebSocket |
| POST | `/pedidos/:id/items/:itemId/anular` | ídem | Si ya está en cocina, pide PIN de supervisor |
| POST | `/pedidos/:id/cerrar-vacio` | ídem | Cierra un pedido con todo anulado y libera la mesa |
| GET | `/cocina/pendientes?estacionId=` | cocina, mesero, supervisor | Cola de la pantalla de cocina |
| PATCH | `/cocina/items/:id` | ídem | `{ estado: preparando \| listo \| entregado }` |
| POST | `/caja/turnos` | cajero, supervisor | Abrir turno con base |
| GET | `/caja/turnos/actual` | ídem | Turno abierto y resumen |
| POST | `/caja/turnos/:id/movimientos` | ídem | Ingreso o retiro (el retiro pide supervisor) |
| POST | `/caja/turnos/:id/cerrar` | ídem | Cuadre: esperado vs. contado |
| POST | `/ventas/cobrar` | cajero, supervisor | Cobro con pagos mixtos, descuento y propina |
| GET | `/ventas/:id` | ídem | Venta con pagos y cambio |
| POST | `/ventas/:id/anular` | ídem | Requiere PIN de supervisor y turno abierto |
| GET | `/inventario/stock` | cajero, supervisor | Stock por insumo y alerta de mínimo |

### WebSocket de cocina

```js
const socket = io('http://localhost:3000/cocina', { auth: { token: accessToken } });
socket.on('comanda.nueva', (c) => ...);  // { pedidoId, numero, mesa, items[] }
socket.on('item.estado', (e) => ...);    // { itemId, pedidoId, estado, producto, mesa, numero }
socket.on('item.anulado', (e) => ...);   // { itemId, pedidoId, producto, motivo }
```

Cada conexión entra a la sala de su sede, así que una sede nunca ve comandas de otra.

## Decisiones de seguridad

- **Todo es privado por defecto.** Los guards globales exigen token y rol; solo `@Publico()` abre una ruta.
- **Access token de 15 min y refresh token de un solo uso.** El refresh se guarda como hash SHA-256. Si alguien reutiliza uno ya usado, se cierran todas las sesiones de ese usuario y queda en auditoría.
- **Fuerza bruta:** 5 PIN errados bloquean al usuario 5 minutos (423), y los logins tienen límite de 10 por minuto por IP (429).
- **Acciones sensibles con PIN de supervisor:** descuentos, anular ítems ya enviados a cocina, anular ventas y retiros de caja. Todo queda en `auditoria`, que la base de datos no deja editar ni borrar.
- **El servidor calcula los totales.** El cliente solo dice qué productos y cuánto paga con cada método; si no cuadra, no cobra.
- **Idempotencia** en pedidos y cobros: un reintento por mala señal no duplica nada.
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
