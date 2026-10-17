# Plan de trabajo: de POS operativo a software empresarial

Escrito el 16 de octubre de 2026, a partir del análisis general del sistema. Cubre todo lo que falta: administración, roles nuevos, módulos de negocio, plataforma y el paso a SaaS. El contexto de cada decisión está en [HISTORIA.md](HISTORIA.md) y las reglas del código en [CLAUDE.md](CLAUDE.md).

## Cómo usar este plan

- **Una tarea, una rama y un commit (o PR).** Cada tarea está pensada para una sesión de trabajo con Claude Code. Al terminarla se marca `[x]` aquí, en el mismo commit.
- **Ninguna tarea se da por hecha sin su prueba:** unitaria o de integración en el backend, y recorrida en el navegador si toca pantallas.
- **Migraciones:** la siguiente es `006`. Una migración por tarea que cambie el esquema, y nunca se edita una ya aplicada.
- **Orden:** las fases van en orden, porque cada una depende de la anterior. Dentro de una fase, las tareas sin dependencias entre sí se pueden hacer en paralelo.
- **Las fases 0 a 5 están detalladas; de la 6 en adelante, solo a nivel de tareas.** Las fases posteriores se detallan al llegar, con lo aprendido para entonces.
- **Tamaños:** S = menos de un día, M = 1 a 3 días, L = 3 a 5 días. Las semanas son estimaciones para una persona a tiempo completo con Claude Code; tómalas como orden de magnitud, no como compromiso.

## Resumen

| Fase | Objetivo | Semanas aprox. | Hito |
|---|---|---|---|
| 0 | Cimientos: fallos abiertos, pruebas, CI, router en el frontend | 2 | |
| 1 | Permisos configurables y panel de administración | 4–5 | El restaurante se configura sin SQL |
| 2 | Reportes y cierre del día | 2 | |
| 3 | ~~Facturación electrónica DIAN~~: fuera del alcance de este software | — | |
| 4 | Impresión y dispositivos | 2 | |
| 5 | Producción: despliegue, respaldos, monitoreo | 1–2 | **Primer restaurante real** |
| 6 | Operación avanzada de salón y supervisión | 3 | |
| 7 | Modo sin conexión | 3–4 | Aguanta los cortes de internet |
| 8 | Inventario completo, compras y costeo | 4 | |
| 9 | Clientes, domicilios, promociones y reservas | 5–6 | |
| 10 | SaaS multi-restaurante | 5–6 | **Se vende como suscripción** |
| 11 | Integraciones y extras | según demanda | |

En total son unos 8 a 10 meses hasta la fase 10. El hito que importa primero es el de la fase 5, alrededor de 3 meses.

## Decisiones que necesita Roberto

Conviene tenerlas antes de la fase en la que se usan:

| Decisión | Se necesita en | Opciones |
|---|---|---|
| Dónde alojar el sistema | Fase 5 | VPS propio (más barato, más mantenimiento) o base de datos administrada (DigitalOcean, AWS RDS, Supabase) con respaldos incluidos. |
| Impresoras de prueba | Fase 4 | Una térmica ESC/POS de 80 mm por USB o red (por ejemplo Epson TM-T20 o una genérica) y un cajón monedero. |
| Planes y precios del SaaS | Fase 10 | Qué módulos van en cada plan. |
| App nativa de meseros | Fase 11 | Solo si la PWA se queda corta en el celular. |

---

## Fase 0: Cimientos (≈ 2 semanas)

Sin esto, cada fase siguiente se construye más lento y con más riesgo.

### 0.1 Fallos abiertos de la revisión

- [x] **0.1.1 Cierre de caja a ciegas** (S). La pantalla de caja deja de mostrar el efectivo esperado mientras el turno está abierto; el supervisor lo ve, el cajero no. El backend solo devuelve `monto_esperado` en el resultado del cierre o a quien tenga el permiso. *Prueba:* con el cajero, `GET /caja/turnos/actual` no trae el efectivo esperado.
- [x] **0.1.2 `trust proxy`** (S). Configurarlo con la variable `TRUST_PROXY`, documentarlo y hacer que el límite de ingresos cuente por usuario además de por IP.
- [x] **0.1.3 Montos con decimales en el frontend** (S). Reemplazar `num()` por un lector de montos en pesos que respete la coma decimal colombiana, en `Cobro.tsx` y `Caja.tsx`.
- [x] **0.1.4 Cocina sin pedidos anulados** (S). `/cocina/pendientes` excluye los pedidos en estado `anulado`.
- [x] **0.1.5 Montos máximos** (S). Agregar `@Max` a todos los DTO de dinero y traducir el error `22003` de PostgreSQL a un 400.
- [x] **0.1.6 Revocación inmediata** (M). Al desactivar un usuario o cerrar sus sesiones, su access token deja de servir de inmediato: una lista de usuarios revocados en memoria, con caducidad de 15 minutos, que consultan el guard y el WebSocket. El socket se desconecta al vencer el token.
- [x] **0.1.7 Bloqueo por inactividad** (M). Tras N minutos sin tocar la pantalla (configurable, 3 por defecto), la tablet vuelve a pedir el PIN sin perder el pedido en curso.

### 0.2 Pruebas y CI

- [x] **0.2.1 Pruebas unitarias del backend** (M). Vitest. Cubrir `dinero.ts` (redondeos, impuestos, cantidades fraccionadas), guards, revocación y límites de ingreso. La validación de modificadores consulta la base, así que va en las pruebas de integración (0.2.2).
- [x] **0.2.2 Pruebas de integración con PostgreSQL** (L). `npm run test:integracion` rehace el esquema `pos_prueba` dentro de la base de `DATABASE_URL` (no hace falta permiso para crear bases), migra, siembra, arranca el servidor en el puerto 3199 y corre `tests/flujo.e2e.mjs`. Los datos reales no se tocan.
- [x] **0.2.3 CI en GitHub Actions** (M). En cada push: instalar, `tsc --noEmit`, pruebas del backend con PostgreSQL en un servicio de Actions, y `npm run build` del frontend. *Requiere* subir el repositorio a GitHub (privado).

### 0.3 Base técnica del backend

- [x] **0.3.1 Logs estructurados** (S). pino con un id por petición, el usuario y la sede, y sin datos sensibles (PIN, contraseña ni tokens).
- [x] **0.3.2 OpenAPI** (M). `@nestjs/swagger` en `/api/docs`, solo fuera de producción o detrás del rol admin.
- [x] **0.3.3 Paginación común** (S). Un DTO `?limite=&cursor=` y una utilidad para paginar por cursor, usada desde ya en cualquier listado nuevo.
- [x] **0.3.4 Separar el SQL de los controladores** (S). `menu.module.ts` pasa a la estructura controlador + servicio que usan los demás módulos. El inventario queda en su propio módulo (`src/inventario/`) y el controlador de ventas sale a `ventas.controller.ts`.

### 0.4 Base técnica del frontend

- [x] **0.4.1 Router** (M). React Router, con rutas `/ingreso`, `/mesas`, `/pedido/:id`, `/caja`, `/cocina` y `/admin/*`. Protección de rutas por permiso. El botón "atrás" del navegador funciona.
- [x] **0.4.2 Caché de datos** (M). TanStack Query en lugar de `useDatos`, con invalidación por eventos del WebSocket. Resuelve también el menú que se quedaba en caché para siempre.
- [x] **0.4.3 Componentes para el panel de administración** (L). Siguen el estilo neumórfico actual, sin librería externa de componentes: tabla con orden, filtro y paginación; formulario con validación y errores por campo; selector; interruptor; carga de imagen; confirmación de borrado; y estado vacío.

---

## Fase 1: Permisos y panel de administración (≈ 4–5 semanas)

### 1.1 Permisos configurables

Hoy los roles son un `ENUM` fijo. Se pasa a permisos por acción y a roles que define cada restaurante.

- [x] **1.1.1 Esquema de permisos** (M). Migración `006_permisos.sql`:
  - tabla `rol` con `empresa_id`, nombre y si es de sistema;
  - tabla `rol_permiso` con el rol y el código de permiso;
  - tabla `usuario_sede_rol`, para que un usuario pueda tener un rol distinto en cada sede.

  Los cinco roles actuales se crean como roles de sistema con sus permisos de hoy, y la columna `usuario.rol` se mantiene durante la transición.
- [x] **1.1.2 Catálogo de permisos en el código** (S). Un archivo con los códigos (`pedido.crear`, `pedido.anular_item`, `venta.cobrar`, `venta.descuento`, `caja.retiro`, `menu.editar`, `usuario.editar`, `reporte.ver`, `auditoria.ver`, etc.), cada uno con su descripción en español para la pantalla.
- [x] **1.1.3 Guard `@Permiso()`** (M). Reemplaza `@Roles()` en todos los controladores. Los permisos viajan en el access token. Las autorizaciones de supervisor pasan a exigir un permiso concreto (`venta.descuento`, por ejemplo) en lugar del rol "supervisor".
- [x] **1.1.4 Frontend por permisos** (S). `SECCIONES` y los botones se muestran según los permisos, no según el rol.
- [x] **1.1.5 Retirar el `ENUM`** (S). Migración que elimina `usuario.rol` cuando todo use permisos.

### 1.2 Usuarios

- [x] **1.2.1 API de usuarios** (M). Listar, crear, editar, desactivar, restablecer el PIN, asignar rol por sede y cerrar todas sus sesiones. Todo queda en la auditoría.
- [x] **1.2.2 Política de PIN** (S). Prohibir PIN triviales (repetidos, secuencias como 1234 o 4321, alternados como 1212) y contraseñas de menos de 10 caracteres sin letras y números. Quien tenga permisos de administración entra con correo y contraseña, no con PIN. *Cambio sobre lo planeado:* no se exige que el PIN sea único en la sede, porque el aviso "ese PIN ya lo usa alguien" le revelaría a quien administra el PIN de otra persona.
- [x] **1.2.3 Pantallas de usuarios y roles** (L). Lista, ficha del usuario y editor de roles con casillas de permisos agrupadas por área.

### 1.3 Menú

- [x] **1.3.1 API de categorías y productos** (L). CRUD completo, orden por arrastre, activar y desactivar. Nunca se borra un producto que ya se vendió: solo se desactiva.
- [x] **1.3.2 Fotos** (M). Subida al servidor (disco local en desarrollo, almacenamiento S3-compatible en producción), redimensionadas a un tamaño fijo y en formato WebP.
- [x] **1.3.3 Modificadores** (M). CRUD de grupos y opciones, y su asignación a productos.
- [ ] **1.3.4 Agotado en vivo** (S). Marcar y desmarcar un producto como agotado durante el servicio, con aviso por WebSocket a todas las tablets.
- [x] **1.3.5 Precio por sede** (M). Migración con la tabla `producto_sede` (precio, disponible). Si no hay fila, aplica el precio general.
- [ ] **1.3.6 Combos y menú del día** (L). Un producto de tipo combo con componentes a escoger. En cocina se ven los componentes y el inventario descuenta cada uno.
- [ ] **1.3.7 Pantallas del menú** (L). Categorías, productos con foto, modificadores y combos.

### 1.4 Salón, cocina y configuración

- [ ] **1.4.1 Zonas y mesas** (M). CRUD y un editor de plano que arrastra mesas y guarda `pos_x` y `pos_y`. La pantalla de mesas usa el plano cuando existe.
- [ ] **1.4.2 Estaciones de cocina** (S). CRUD y asignación de productos a estaciones.
- [ ] **1.4.3 Configuración de la empresa y la sede** (M). Esquema validado para `empresa.config`: propina sugerida, métodos de pago activos, modos de servicio, minutos de alerta en cocina e inactividad. Datos legales (NIT, razón social, dirección) y horario de la sede.
- [ ] **1.4.4 Impuestos** (S). Tipo y tasa por producto, con valores predefinidos (impoconsumo 8 %, IVA 19 %, exento) y aviso de consultar al contador.
- [ ] **1.4.5 Cajas** (S). Las cajas de cada sede pasan a una tabla en lugar de un texto libre (`'Caja 1'`).

---

## Fase 2: Reportes y cierre del día (≈ 2 semanas)

- [ ] **2.1 Vistas de reporte en SQL** (M). Ventas por día, hora, producto, categoría, mesero, caja y método de pago. Descuentos, cortesías y anulaciones con quién las autorizó. Propinas por mesero. Impuestos por tipo y tasa. Índices para que respondan rápido con un año de datos.
- [ ] **2.2 API de reportes** (M). Filtros por rango de fechas y sede, con permiso `reporte.ver`.
- [ ] **2.3 Exportar** (S). A Excel (xlsx) y CSV.
- [ ] **2.4 Cierre del día, o informe Z** (M). Consolida todos los turnos de una jornada en un informe numerado y sin modificaciones posteriores, imprimible y en PDF.
- [ ] **2.5 Panel del dueño** (L). Ventas de hoy contra el mismo día de la semana pasada, ticket promedio, productos más vendidos y alertas (anulaciones fuera de lo normal, caja descuadrada). Pensado también para verse en el celular.
- [ ] **2.6 Consulta de la auditoría** (M). Pantalla con filtros por usuario, acción, fecha y entidad, y enlace al pedido o la venta.

---

## Fase 3: Facturación electrónica DIAN (fuera del alcance)

Decisión de Roberto del 16 de octubre de 2026: la facturación electrónica no se construye en este software. Las tareas que tenía esta fase (resoluciones y consecutivos, datos del comprador, cola de envío al proveedor, notas crédito, contingencia y representación gráfica) quedan fuera del plan. Se conserva la numeración de las demás fases para no cambiar las referencias.

Consecuencias que hay que tener presentes:

- Las columnas `venta.factura_*` y el valor `factura_estado = 'pendiente'` siguen en el esquema, sin uso.
- Sin notas crédito, una venta de un turno ya cerrado sigue sin poder anularse desde el sistema.

---

## Fase 4: Impresión y dispositivos (≈ 2 semanas)

- [ ] **4.1 Registro de dispositivos** (M). Tabla `dispositivo` (tablet, caja, agente, pantalla de cocina) con un emparejamiento por código de un solo uso que da un token propio por dispositivo. La auditoría registra desde qué dispositivo se hizo cada acción.
- [ ] **4.2 Agente local de impresión** (L). Proyecto nuevo `pos-agente/` en Node, que se instala como servicio de Windows. Se conecta hacia afuera por WebSocket al backend, así no hay que abrir puertos en el router del restaurante. Imprime en ESC/POS por USB o red y abre el cajón monedero.
- [ ] **4.3 Cola de impresión** (M). Tabla `trabajo_impresion` con estados y reintentos. Si el agente estaba desconectado, recibe lo pendiente al volver.
- [ ] **4.4 Plantillas** (M). Comanda por estación, pre-cuenta, tiquete de venta con datos legales, cierre de caja e informe Z. Ancho de 58 u 80 mm según la impresora.
- [ ] **4.5 Configuración de impresoras** (S). Desde el panel: qué impresora imprime qué, por estación y por caja.

---

## Fase 5: Producción (≈ 1–2 semanas) → primer restaurante real

- [ ] **5.1 Imágenes Docker** (M). Backend, y frontend servido con Caddy (HTTPS automático). Un `docker-compose.prod.yml`.
- [ ] **5.2 Ambientes** (M). Pruebas (`staging`) y producción, con variables y secretos fuera del repositorio. Despliegue automático a pruebas en cada merge y a producción con una etiqueta de versión.
- [ ] **5.3 Migraciones en el despliegue** (S). Se aplican antes de levantar la nueva versión, y el despliegue se detiene si una falla.
- [ ] **5.4 Respaldos** (M). Respaldo automático diario más recuperación a un punto en el tiempo, guardados fuera del servidor. **Hacer una restauración de prueba** y documentar los pasos.
- [ ] **5.5 Monitoreo** (M). Sentry en backend y frontend, una verificación de salud (`/api/salud`), alertas si el servidor cae o si una sede no vende en su horario, y métricas básicas.
- [ ] **5.6 Seguridad de producción** (M). Doble factor para quien tenga permisos de administración. Encabezados de seguridad revisados. Límites de peticiones probados detrás del proxy. Revisión de dependencias (`npm audit`) en CI.
- [ ] **5.7 Datos personales** (S). Política de tratamiento de datos y autorización del cliente, por la Ley 1581 de 2012. Revisar con un abogado.
- [ ] **5.8 Instalación de un restaurante nuevo** (M). Un guion o asistente que crea la empresa, la sede, el admin y las impresoras, más una guía de instalación para el restaurante.
- [ ] **5.9 Piloto** (sin código). Un restaurante real durante 2 a 4 semanas, con un canal directo para reportar problemas.

---

## Fase 6: Operación avanzada de salón y supervisión (≈ 3 semanas)

- [ ] **6.1** Mover un pedido a otra mesa y unir mesas (M).
- [ ] **6.2** Dividir la cuenta por productos, por puesto o en partes iguales, generando varias ventas de un mismo pedido. Hay que revisar el índice `venta_unica_pagada` (L).
- [ ] **6.3** Puestos y tiempos: cada producto con su comensal y su tiempo (entrada, plato fuerte, postre); la cocina recibe cada tiempo cuando el mesero lo libera (L).
- [ ] **6.4** Pre-cuenta y aviso de "la mesa pidió la cuenta" a caja (S).
- [ ] **6.5** Cortesías con motivo y autorización, separadas de los descuentos en los reportes (M).
- [ ] **6.6** Descuentos por porcentaje y por producto, no solo un valor sobre el total (M).
- [ ] **6.7** Cambiar el mesero de un pedido y reabrir una mesa ya cobrada, con autorización (M).
- [ ] **6.8** Panel en vivo del supervisor: mesas abiertas con su tiempo, cocina atrasada, ventas del turno y autorizaciones del día (L).
- [ ] **6.9** Historial de ventas del turno para el cajero, con reimpresión (S).
- [ ] **6.10** Arqueo por denominaciones al cerrar la caja (S).
- [ ] **6.11** Cocina: recuperar una comanda marcada por error, tiempos promedio por producto y estación, y agotar un producto desde la cocina (M).
- [ ] **6.12** Vista del mesero con sus ventas y propinas del turno (S).

## Fase 7: Modo sin conexión (≈ 3–4 semanas)

- [ ] **7.1** PWA instalable con service worker (`vite-plugin-pwa`) y la aplicación disponible sin red (M).
- [ ] **7.2** Copia local del menú, las mesas y los usuarios en IndexedDB, con verificación del PIN sin conexión mediante un hash local de vida limitada (L).
- [ ] **7.3** Cola local de operaciones (crear pedido, agregar, enviar a cocina, cobrar), cada una con su clave de idempotencia (L).
- [ ] **7.4** Sincronización al volver la red, en orden, con reglas de conflicto. Por ejemplo, si dos tablets abrieron la misma mesa sin conexión, el supervisor decide (L).
- [ ] **7.5** Numeración provisional de pedidos y ventas creados sin conexión (M).
- [ ] **7.6** Modo de servidor local opcional, para restaurantes con muchos cortes: el agente de la fase 4 también sirve de punto de encuentro de la red local, para que cocina y meseros sigan conectados entre sí sin internet. Evaluar después del piloto (L).
- [ ] **7.7** Indicador claro de "sin conexión, N operaciones pendientes" en todas las pantallas (S).

## Fase 8: Inventario, compras y costeo (≈ 4 semanas)

- [ ] **8.1** CRUD de insumos y recetas en el panel, con sub-recetas (preparaciones que son insumos de otros platos) (L).
- [ ] **8.2** Proveedores y órdenes de compra (M).
- [ ] **8.3** Recepción de mercancía con costo real y costo promedio ponderado (M).
- [ ] **8.4** Conteo físico con ajuste automático y su diferencia valorizada (M).
- [ ] **8.5** Mermas con motivo (M).
- [ ] **8.6** Traslados entre sedes (M).
- [ ] **8.7** Alertas de stock mínimo y sugerencia de compra (S).
- [ ] **8.8** Costeo: costo de cada plato según la receta, margen por producto y food cost por periodo (M).
- [ ] **8.9** Kardex consultable por insumo (S).
- [ ] **8.10** Rol de bodega o compras con sus permisos (S).

## Fase 9: Clientes, domicilios, promociones y reservas (≈ 5–6 semanas)

- [ ] **9.1** Clientes: ficha, historial de compras y búsqueda por teléfono al tomar un domicilio (M).
- [ ] **9.2** Fidelización: puntos o sellos y su redención (L).
- [ ] **9.3** Domicilios: estados (recibido, en preparación, en camino, entregado), zonas y costo de envío (L).
- [ ] **9.4** Rol de domiciliario con vista móvil de sus entregas y cobro contra entrega (M).
- [ ] **9.5** Promociones programadas: happy hour, 2x1, combos por día y cupones (L).
- [ ] **9.6** Reservas y lista de espera, con rol de recepción (L).
- [ ] **9.7** Asistencia del personal (entrada y salida) y reparto de propinas, si los clientes lo piden (M).

## Fase 10: SaaS multi-restaurante (≈ 5–6 semanas)

- [ ] **10.1** Row Level Security por `empresa_id` en todas las tablas, con un rol de base de datos sin `BYPASSRLS` para la aplicación (L).
- [ ] **10.2** `DatabaseService` fija `SET LOCAL app.empresa_id` en cada transacción a partir del token; ninguna consulta corre sin contexto de empresa (L).
- [ ] **10.3** Pruebas de aislamiento: una batería automática que verifica que ningún endpoint devuelve ni modifica datos de otra empresa (M).
- [ ] **10.4** `/auth/usuarios` y el ingreso por PIN pasan a depender del dispositivo emparejado (fase 4.1), para que una tablet solo muestre a los usuarios de su sede (M).
- [ ] **10.5** Panel de superadministrador: alta de restaurantes, planes, suspensión por falta de pago, soporte entrando como el cliente con auditoría (L).
- [ ] **10.6** Planes y funciones activables por plan (feature flags), comprobados en el backend (M).
- [ ] **10.7** Cobro de la suscripción con una pasarela (Wompi, PayU o similar) (L).
- [ ] **10.8** Registro de un restaurante nuevo por su cuenta, con un asistente de configuración inicial (L).
- [ ] **10.9** Exportación completa de los datos de un restaurante (M).
- [ ] **10.10** Escalar: adaptador Redis para Socket.IO, varias instancias del backend y colas para reportes y trabajos pesados (M).
- [ ] **10.11** Versionado de la API (`/api/v1`) antes de abrirla a terceros (S).

## Fase 11: Integraciones y extras (según demanda)

- [ ] Plataformas de domicilios (Rappi, DiDi Food): recibir pedidos directo en el POS.
- [ ] Datáfonos integrados, para que el monto llegue al datáfono sin digitarlo.
- [ ] App nativa de meseros en React Native, si la PWA no alcanza.
- [ ] Contabilidad: exportación al formato del software contable del cliente (Siigo, World Office, Alegra).
- [ ] Menú digital con código QR para que el cliente vea la carta (y más adelante pida) desde su celular.
- [ ] Pantalla para el cliente en la caja con el total.
- [ ] Varios idiomas y monedas, si se vende fuera de Colombia.
