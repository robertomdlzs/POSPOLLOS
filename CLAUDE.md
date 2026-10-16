# POS Restaurante (POSPOLLOS)

Punto de venta para restaurantes en Colombia: pedidos, cocina en tiempo real (KDS), caja, cobro con pagos mixtos e inventario por receta. Hoy sirve a un solo restaurante; la meta es venderlo como SaaS multi-restaurante. El porqué de cada decisión está en [HISTORIA.md](HISTORIA.md), y el trabajo pendiente, por fases y en orden, en [PLAN.md](PLAN.md): al terminar una tarea, márcala `[x]` en el mismo commit.

## Estructura

- `pos-backend/`: NestJS 12, TypeScript 6, PostgreSQL y Socket.IO. API bajo `/api`, puerto 3000. Ver su README para endpoints y decisiones de seguridad.
- `pos-frontend/`: React 19 y Vite 8, sin librería de componentes (estilos en `src/estilos.css`). Puerto 5173, con proxy de `/api` y `/socket.io` al backend.

## Entorno de Roberto (Windows)

- No hay Docker: se usa el PostgreSQL 17 instalado como servicio (`postgresql-x64-17`). Si aparece `ECONNREFUSED 127.0.0.1:5432`, el servicio está apagado: `Start-Service postgresql-x64-17` como administrador.
- Node 24 LTS. NestJS 12 exige Node 22.22.3 o superior (`engine-strict` en `.npmrc`).
- Las sentencias SQL no van en PowerShell: se ejecutan con `psql` o en pgAdmin.

## Comandos

```bash
# backend (pos-backend/)
npm run db:migrar        # aplica db/migraciones/*.sql pendientes
npm run db:semilla       # restaurante de ejemplo (no hace nada si ya hay datos)
npm run start:dev
npm test                 # pruebas unitarias (Vitest, sin base de datos)
npm run test:flujo       # prueba de punta a punta; exige el servidor corriendo sobre una base recién sembrada
npx tsc --noEmit

# frontend (pos-frontend/)
npm run dev
npm run build            # tsc --noEmit + vite build
```

## Reglas del proyecto

- **SQL directo con `pg`, sin ORM.** El esquema depende de triggers, CHECKs y `FOR UPDATE`. Los cambios de esquema van en una migración nueva numerada en `pos-backend/db/migraciones/` y nunca se edita una ya aplicada.
- **Dinero en centavos enteros** (`common/dinero.ts`). Los precios del menú son finales, con el impuesto incluido. El servidor calcula los totales; al cliente nunca se le cree.
- **Todo es privado por defecto:** las rutas públicas llevan `@Publico()` y los roles se declaran con `@Roles(...)`. El admin siempre pasa.
- **Acciones sensibles** (descuentos, anular lo que ya está en cocina, anular ventas, retiros de caja) exigen PIN de supervisor y quedan en `auditoria`, una tabla que la base no deja editar ni borrar. El PIN nunca se guarda en la auditoría.
- **Idempotencia:** crear pedidos y cobrar llevan `idempotencyKey`, que genera el cliente y se conserva en los reintentos.
- **Multi-tenant a futuro:** las tablas raíz llevan `empresa_id`/`sede_id`, y las consultas filtran siempre por la empresa o la sede del token.
- **TypeScript 6 con `isolatedModules`:** los tipos usados en firmas con decoradores se importan con `import type`.
- **Interfaz en español colombiano**, pensada para tablet táctil. Los colores comunican estado: verde para cobrar o libre, ámbar para ocupada o en cocina, azul para listo y rojo para anular.

## Usuarios de ejemplo (semilla)

Admin `admin@demo.co` / `CambiaEsto123!` (PIN 0000) · Supervisora 9999 · Cajero 1111 · Mesera 2222 · Cocina 3333.

## Pendiente conocido

Ver la sección 10 de HISTORIA.md. Los 5 fallos principales de la revisión del 15-oct-2026 ya están corregidos (PIN en auditoría, mesa bloqueada, idempotencia de ítems, bloqueo del supervisor, devolución de inventario). Siguen abiertos, de menor gravedad:

- La caja no se cuenta a ciegas: la pantalla muestra el efectivo esperado antes del cierre.
- El límite de peticiones por IP no tiene `trust proxy`: detrás de Nginx o de un NAT, todo el restaurante comparte el mismo límite.
- `num()` en el frontend borra el punto decimal (`Cobro.tsx`, `Caja.tsx`).
- `/cocina/pendientes` no filtra los pedidos anulados.
- El menú queda en caché en el navegador sin invalidarse; un monto gigante desborda `numeric(14,2)` y da un 500.
- Las tablets compartidas no se bloquean por inactividad, y un usuario desactivado conserva su token hasta 15 minutos.
