# POS Restaurante · Frontend

Pantallas de caja, salón y cocina para el backend `pos-backend`.

**Stack:** React 19 · Vite 8 · TypeScript 6 · Socket.IO. Sin librería de componentes: los estilos están en `src/estilos.css`.

## Arranque

Requisitos: Node 22.22.3+ (recomendado Node 24 LTS) y el backend corriendo en el puerto 3000.

```bash
npm install
npm run dev        # http://localhost:5173
```

En desarrollo, Vite redirige `/api` y el WebSocket al backend, así que no hace falta configurar CORS.

### Desde una tablet o celular

Vite queda escuchando en la red local. En la terminal aparece una dirección tipo `http://192.168.1.20:5173`; ábrela desde la tablet conectada al mismo wifi. Si Windows pregunta por el firewall, permite el acceso en redes privadas.

## Quién ve qué

| Rol | Secciones |
|---|---|
| Mesero | Mesas y pedidos. Recibe un aviso cuando un plato sale de cocina |
| Cajero | Mesas, pedidos, cobro y caja |
| Cocina | Pantalla de comandas por estación, con pitido al llegar una nueva |
| Supervisor y admin | Todo, y aprueba descuentos, anulaciones y retiros con su PIN |

## Pantallas

- **Ingreso:** toca tu nombre y escribe el PIN, con el teclado en pantalla o el físico.
- **Mesas:** las libres sobresalen y las ocupadas se ven hundidas, con el estado del pedido y los minutos que lleva. A la derecha están los pedidos sin mesa (para llevar, mostrador y domicilio).
- **Pedido:** categorías, productos con foto y la comanda tipo tiquete. Los productos simples se suman con − / + en la tarjeta; los que tienen opciones (término, adiciones) abren un selector que valida lo obligatorio. Lo nuevo queda marcado en ámbar hasta enviarlo a cocina.
- **Cobro:** descuento (con PIN de supervisor), propina del 10% u otra, pagos divididos entre efectivo, tarjeta, Nequi, Daviplata o transferencia, y cálculo del cambio.
- **Caja:** abrir turno con base, ventas y efectivo esperado en vivo, ingresos y retiros, y cierre con cuadre.
- **Cocina:** riel de comandas por estación; Empezar → Listo → Entregado. Las que pasan de 15 minutos se marcan en rojo.

## Menú

Se administra en **Administración → Menú** (permiso `menu.editar`): categorías y su orden, productos con foto, impuesto, estación y modificadores, precio propio por sede, y grupos de modificadores con sus opciones. Las fotos se suben desde la ficha del producto. Un combo (o el menú del día) se crea como producto de tipo combo y se arma en su ficha: partes con mínimo y máximo, y los productos que se pueden escoger en cada una con su precio extra. En la tablet se arma con el botón **Armar**, que pide también los modificadores de cada parte (el término de la hamburguesa); en la comanda las partes van debajo del combo. Cocina y supervisión marcan lo que se acaba con el botón **Agotados** de la pantalla de cocina (`menu.agotar`); las tablets lo muestran tachado al momento.

Para probar contra otro backend sin tocar el que corre en el 3000: `BACKEND_URL=http://localhost:3001 npm run dev`.

## Producción

```bash
npm run build      # genera dist/
```

Sirve `dist/` en el mismo dominio que el backend (por ejemplo, con Nginx: `/` a `dist/` y `/api` y `/socket.io` al backend). Como la app usa rutas (`/mesas`, `/pedido/:id`, `/caja`…), el servidor debe responder `index.html` a cualquier ruta que no sea un archivo: en Nginx, `try_files $uri /index.html;`; en Caddy, `try_files {path} /index.html`. Si van en dominios distintos, compila con `VITE_API_URL=https://api.tu-dominio.com` y agrega el dominio del frontend a `CORS_ORIGINS` del backend.

## Decisiones

- **Sesión:** el access token vive 15 minutos y se renueva solo; si varias peticiones lo necesitan a la vez, comparten una sola renovación. El refresh token se guarda en el dispositivo para no pedir el PIN en cada recarga. "Cambiar de usuario" lo revoca en el servidor.
- **Bloqueo por inactividad:** tras 3 minutos sin tocar la pantalla (se cambia con `VITE_MINUTOS_BLOQUEO`), la tablet pide otra vez el PIN de quien estaba trabajando, sin perder el pedido o el cobro en curso. "Soy otra persona" cierra la sesión. La pantalla de cocina no se bloquea.
- **Sin cobros dobles:** cada pedido nuevo y cada cobro llevan una clave única que se conserva en los reintentos. Si la red falla justo al cobrar y la cajera vuelve a tocar el botón, el servidor devuelve la misma venta.
- **Funciona por IP de red local:** `crypto.randomUUID` no existe fuera de https o localhost, así que las claves se generan con `getRandomValues` cuando hace falta.
- **Tipografías empaquetadas** (Atkinson Hyperlegible e IBM Plex Mono): la interfaz se ve igual aunque el restaurante se quede sin internet.

## Pendiente

- Funcionamiento sin conexión (PWA con cola de sincronización).
- Impresión de comandas y del tiquete de cobro mediante el agente local.
- Administración del menú, usuarios y mesas desde la interfaz.
