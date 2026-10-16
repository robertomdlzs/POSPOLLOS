# Historia del proyecto

Registro de la conversación con la que nació este POS (15 de octubre de 2026): qué se pidió, qué se decidió en cada momento, qué alternativas se descartaron y qué problemas ya se resolvieron. Sirve para entender el porqué de las decisiones que resume `CLAUDE.md`.

## 1. El punto de partida

Roberto preguntó cómo se llaman los programas que usan los restaurantes para tomar pedidos, cobrar, registrar ventas y controlar el stock.

- Se les llama sistemas POS (Point of Sale, punto de venta) o software de gestión de restaurantes.
- Sus módulos típicos son: toma de pedidos o comandera, KDS (Kitchen Display System, pantalla de cocina), caja, facturación electrónica (obligatoria en Colombia ante la DIAN), inventario con recetas (escandallo), reportes, compras y proveedores, y delivery o reservas.
- Ejemplos del mercado: Toast, Square for Restaurants, Lightspeed, Loyverse, Fudo, y en Colombia Siigo POS y Alegra POS.

Roberto decidió construir uno propio, con una estructura sólida, escalable y segura, y no sabía si hacerlo web o de escritorio.

## 2. Web o escritorio

**Decisión: web (PWA) más un agente local.**

- A favor de la web: se actualiza una sola vez para todos los clientes, el dueño consulta reportes desde el celular y se puede vender como suscripción.
- Las únicas ventajas reales del escritorio se resuelven sin renunciar a la web:
  - **Sin internet:** la caja guarda en IndexedDB y sincroniza al volver la conexión. Cada operación lleva una clave de idempotencia para no duplicarse. En Barranquilla los cortes de luz e internet son frecuentes, así que esto no es opcional.
  - **Impresión:** el navegador no imprime tiquetes ESC/POS en silencio. Un agente pequeño (Node o Tauri) instalado en el PC de caja recibe los trabajos de impresión y abre el cajón monedero. Si un cliente insiste en tener app de escritorio, la misma PWA se empaqueta con Tauri.

Arquitectura propuesta:

- **Clientes:** caja (PWA), app de meseros (React Native), pantalla de cocina (KDS en tiempo real) y panel de administración.
- **API:** monolito modular en NestJS (REST + WebSockets), con los módulos pedidos, caja y ventas, inventario, y autenticación y roles.
- **Datos y servicios:** PostgreSQL (con RLS más adelante), Redis (caché y colas, cuando haga falta), proveedor de facturación DIAN y el agente local de impresión.
- **Stack** escogido por la experiencia de Roberto: React con TypeScript, React Native, Node con NestJS y PostgreSQL.

Seguridad planteada desde el día uno: JWT de corta duración con refresh rotativo, PIN de 4 dígitos para cambiar de usuario rápido en equipos compartidos, roles (admin, cajero, mesero, cocina) con autorización de supervisor para acciones sensibles, aislamiento por `tenant_id` con Row Level Security, auditoría inmutable (donde más fraude interno hay es en anulaciones y descuentos), validación de entrada, rate limiting, HTTPS y secretos fuera del código. La facturación va por un proveedor autorizado de la DIAN, porque certificarse directamente es un proceso largo que no vale la pena al inicio.

## 3. Un solo restaurante o muchos

Roberto aclaró la visión: quiere un software que se adapte a cualquier restaurante al que se lo venda, cada uno independiente y sin afectar el funcionamiento de los demás.

**Modelo: SaaS multi-tenant.** Se compararon tres formas de aislar a cada restaurante:

1. **Base compartida con `tenant_id` y Row Level Security:** la más barata y fácil de mantener. Es la recomendada para arrancar.
2. **Un esquema por restaurante:** más aislamiento, pero las migraciones se vuelven pesadas con cientos de clientes.
3. **Una base o servidor por restaurante:** máximo aislamiento, con costo y mantenimiento multiplicados.

Lo inteligente es diseñar con la opción 1 sin amarrarse, para ofrecer instancias dedicadas (plan Enterprise) a cadenas grandes con el mismo código.

**Organización de los datos:** empresa (NIT, plan y datos de facturación), sedes (inventario, cajas, impresoras y horarios propios) y usuarios con rol por sede.

**La versatilidad viene de la configuración, no del código.** Cada restaurante configura sus modos de servicio, su menú con modificadores (tamaños, adiciones, "sin cebolla", combos, menú del día), sus impuestos por producto, la propina, las estaciones de cocina y los módulos según su plan, controlados con feature flags para poder cobrar distinto.

Detalles anotados para después: UUID como identificadores (facilitan la sincronización offline y no revelan volúmenes), exportación de datos para cada restaurante, panel de superadministrador (altas, planes, suspensión por falta de pago, soporte) y registro de qué configuración estaba activa en cada venta.

## 4. Decisión: empezar con un solo restaurante

Roberto decidió arrancar directo para un solo restaurante y escalar después.

Para que escalar no implique reescribir, las tablas raíz llevan `empresa_id` y `sede_id` desde ya, aunque hoy solo exista una empresa y una sede. Agregarlos después obligaría a migrar todos los datos.

## 5. Modelo de datos (`001_esquema.sql`)

Se probó cargándolo en PostgreSQL 16 con datos de ejemplo.

- **Organización:** `empresa`, `sede`, `usuario` (contraseña para admin y supervisor, PIN para el cambio rápido).
- **Salón:** `zona` y `mesa` (con posición para el plano del salón).
- **Menú:** `categoria`, `producto` (precio final, tipo y tasa de impuesto, si controla stock), `estacion_cocina`, `grupo_modificador` (mínimo y máximo de selección) y `modificador`.
- **Pedidos:** `pedido` (tipo de servicio, mesa, mesero, cliente, clave de idempotencia) y `pedido_item`, que copia nombre, precio e impuesto al momento de la venta para que el histórico no cambie si cambian los precios.
- **Caja y ventas:** `turno_caja` (un solo turno abierto por caja), `movimiento_caja`, `venta` (con campos para la factura electrónica) y `pago` (pagos mixtos, efectivo recibido y referencia).
- **Inventario:** `insumo`, `receta`, `movimiento_inventario` (kardex) y `stock_insumo`, actualizado por trigger.
- **Auditoría:** tabla que un trigger impide editar o borrar.
- **Reglas dentro de la base:** un descuento sin supervisor no se guarda, el total de la venta tiene que cuadrar y un pedido de mesa sin mesa se rechaza.

## 6. Backend en NestJS

Lo pidió Roberto como siguiente paso, empezando por el login con PIN y el flujo pedido → cocina → cobro.

- **Versiones:** salieron NestJS 12 y TypeScript 7, más nuevos que lo conocido. Se revisó la plantilla oficial de NestJS 12 (`module: nodenext`, TypeScript 6) y se siguió esa configuración. Con TypeScript 6 e `isolatedModules`, los tipos usados en firmas con decoradores se importan con `import type`.
- **SQL directo con `pg` y no un ORM:** el esquema ya estaba en SQL con triggers, bloqueos y reglas en la base, y un ORM habría escondido justo esas piezas.
- **Migración `002_sesiones_y_seguridad.sql`:** tabla `sesion` para el refresh rotativo, contador de intentos y bloqueo en `usuario`, y un índice que impide dos ventas vigentes para el mismo pedido.
- **Módulos:** auth (PIN, contraseña, refresh rotativo con detección de reutilización, PIN de supervisor), pedidos, cocina (REST y gateway Socket.IO), caja, ventas, menú, mesas e inventario, más la auditoría.
- **Prueba `tests/flujo.e2e.mjs`:** 22 verificaciones de punta a punta, todas pasando, incluido el cobro de $66.000 con pagos mixtos y $10.000 de cambio. Aparte se comprobó el bloqueo del PIN al quinto intento (423) y el límite por IP (429).
- **Observación pendiente:** si un pedido se rechaza por validación, PostgreSQL igual consume su número, así que la numeración puede saltar. Si se quieren tiquetes con números consecutivos por día, hay que cambiarlo por un contador propio.

## 7. Puesta en marcha en el PC de Roberto (problemas ya resueltos)

En orden, para no repetirlos:

1. **No hay Docker.** Se usa el PostgreSQL 17 instalado en Windows.
2. **Node 22.14 era muy viejo.** NestJS 12 exige Node 22.22.3 o superior; el síntoma era `ERR_REQUIRE_CYCLE_MODULE` al correr `nest start`. Se actualizó a Node 24 LTS, se borró `node_modules` y se reinstaló. Se agregó `engines` al `package.json` y `engine-strict` en `.npmrc` para que el error salga claro.
3. **Autenticación fallida para el usuario `pos`.** Faltaba crearlo. Las sentencias SQL no van en PowerShell (sale `CREATE no se reconoce como cmdlet`); se ejecutan con `psql` o en pgAdmin:

   ```powershell
   $psql = (Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" | Select-Object -Last 1).FullName
   & $psql -U postgres -c "CREATE USER pos WITH PASSWORD 'pos';"
   & $psql -U postgres -c "CREATE DATABASE pos OWNER pos;"
   ```

4. **`test:flujo` fallaba con `usuarios.find is not a function`** porque la base no estaba migrada. Ahora la prueba muestra la respuesta exacta del servidor cuando algo falla.
5. Con todo eso, la prueba pasó completa en el PC de Roberto, con las 22 verificaciones.
6. **`ECONNREFUSED 127.0.0.1:5432`:** el servicio de PostgreSQL estaba apagado (pasa tras reiniciar si no arranca solo). Se enciende con `Start-Service postgresql-x64-17` en PowerShell como administrador y `Set-Service ... -StartupType Automatic`. Este paso quedó pendiente al pasar el proyecto a Claude Code.

El proyecto ahora vive en `C:\Users\rober\Downloads\POSPOLLOS\`.

## 8. Frontend en React

Diseño, pensado para el mostrador de un restaurante y no como página genérica:

- **Concepto de la comanda de papel:** el panel del pedido es un tiquete térmico con borde dentado y tipografía de impresora, y la cocina es un riel de comandas colgadas.
- **Colores con significado operativo, no decorativo:** verde (cobrar o libre), ámbar (ocupada o en cocina), azul (listo) y rojo (anular).
- **Atkinson Hyperlegible** para la interfaz, por su legibilidad, e **IBM Plex Mono** solo en comandas y cifras. Ambas van empaquetadas para funcionar sin internet.
- **Botones grandes para el dedo**, pensados para tablet horizontal, y en el celular la comanda pasa a ser una hoja inferior.

**Pedido de Roberto con imagen de referencia:** compartió el diseño de un POS de comidas con fotos de producto, tarjetas, selector de cantidad en la tarjeta y acento naranja, y pidió "un poco de neumorfismo embossed". Se aplicó así:

- De la referencia se tomaron las tarjetas con foto y descripción y el − 2 + directo en la tarjeta para productos sin opciones.
- Neumorfismo en relieve en todo lo que se toca (productos, mesas, categorías, botones, chips y teclado de PIN): sobresale con luz arriba a la izquierda y sombra abajo a la derecha, y se hunde al presionarlo o cuando está activo. Las mesas ocupadas se ven hundidas, así el estado se lee de reojo. Los campos de texto son "pozos" hundidos.
- La comanda de papel se mantuvo como tiquete sobre esa superficie.
- No se copió el naranja de la referencia, porque los colores del sistema ya comunican estado.
- Para las fotos se agregó la migración `003_imagen_producto.sql` (`producto.imagen_url`). Mientras no hay foto, la tarjeta muestra la inicial del producto.

**Pantallas:** ingreso por PIN, mesas, pedido (categorías, productos, modificadores con validación de mínimos y máximos, comanda, anulación con motivo y supervisor), cobro (descuento con supervisor, propina del 10% u otra, pagos divididos, cambio), caja (abrir turno, efectivo esperado en vivo, ingresos y retiros, cierre con cuadre) y cocina (riel por estación, Empezar → Listo → Entregado, alerta pasados 15 minutos, pitido al llegar una comanda).

**Ajuste al backend:** el evento `item.estado` ahora incluye producto, cantidad y mesa, para que la mesera reciba avisos como "Listo para la mesa 1: 2 Hamburguesa clásica".

**Verificación:** se recorrió el flujo en un navegador real con cuatro sesiones simultáneas (mesera, cocina, cajero y celular), revisando capturas de cada pantalla. Se corrigieron varias cosas encontradas así: el borde dentado del tiquete, que salió invertido; la cantidad en cocina, que aparecía separada del producto; los avisos, que tapaban el botón de cobrar; el orden del control − n + en la comanda; la mayúscula sobrante en la fecha; la alineación de las tablas de caja; la barra superior vacía con una sola sección; y la falta de ícono de pestaña.

## 9. Paso a Claude Code

Roberto pidió poder trabajar directamente sobre el código en VS Code, sin descargar zips en cada cambio. Las opciones fueron la extensión Claude Code para VS Code o dar acceso a la carpeta desde la app de escritorio. Se escogió Claude Code, y para que no se perdiera el contexto se escribieron este archivo y `CLAUDE.md`.

Recomendación pendiente: poner el proyecto bajo Git antes de seguir:

```powershell
cd C:\Users\rober\Downloads\POSPOLLOS
git init
git add .
git commit -m "POS: backend y frontend iniciales"
```

## 10. Próximos pasos, en orden sugerido

1. Encender PostgreSQL, aplicar la migración `003` e inicializar Git.
2. Administración del menú desde la app (productos, precios, fotos, categorías y modificadores), para no depender de SQL al configurar un restaurante nuevo.
3. Facturación electrónica DIAN con un proveedor autorizado (hoy las ventas quedan en `factura_estado = 'pendiente'`).
4. Agente local de impresión para comandas por estación y tiquete de cobro.
5. Modo sin conexión (PWA con cola de sincronización).
6. Notas crédito para anular ventas de turnos cerrados o ya facturadas.
7. App de meseros en React Native, si la PWA en el celular se queda corta.
8. Paso a multi-restaurante: RLS por `empresa_id`, configuración por restaurante, planes con feature flags y panel de superadministrador.
