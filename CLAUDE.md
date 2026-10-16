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
npm run test:integracion # punta a punta (tests/*.e2e.mjs) en el esquema pos_prueba: migra, siembra, arranca y prueba; no toca tus datos
npm run test:flujo       # la misma prueba contra un servidor que ya esté corriendo sobre una base recién sembrada
npx tsc --noEmit

# frontend (pos-frontend/)
npm run dev
npm run build            # tsc --noEmit + vite build
```

## Reglas del proyecto

- **SQL directo con `pg`, sin ORM.** El esquema depende de triggers, CHECKs y `FOR UPDATE`. Los cambios de esquema van en una migración nueva numerada en `pos-backend/db/migraciones/` y nunca se edita una ya aplicada.
- **Dinero en centavos enteros** (`common/dinero.ts`). Los precios del menú son finales, con el impuesto incluido. El servidor calcula los totales; al cliente nunca se le cree.
- **Todo es privado por defecto, y se autoriza por permisos, no por rol:** las rutas públicas llevan `@Publico()`; las demás declaran `@RequierePermiso(...)` con códigos del catálogo `pos-backend/src/common/permisos.ts` (en el frontend, `usePuede()`). Nunca se compara el nombre de un rol. Un permiso nuevo va en el catálogo de los dos lados y, si un rol de fábrica debe tenerlo, en una migración. El admin tiene siempre todos.
- **Acciones sensibles** (descuentos, anular lo que ya está en cocina, anular ventas, retiros de caja) exigen el permiso de la acción o la aprobación con PIN de alguien que lo tenga (`verificarAutorizacion`), y quedan en `auditoria`, una tabla que la base no deja editar ni borrar. El PIN nunca se guarda en la auditoría.
- **Idempotencia:** crear pedidos y cobrar llevan `idempotencyKey`, que genera el cliente y se conserva en los reintentos.
- **Multi-tenant a futuro:** las tablas raíz llevan `empresa_id`/`sede_id`, y las consultas filtran siempre por la empresa o la sede del token.
- **TypeScript 6 con `isolatedModules`:** los tipos usados en firmas con decoradores se importan con `import type`.
- **Interfaz en español colombiano**, pensada para tablet táctil. Los colores comunican estado: verde para cobrar o libre, ámbar para ocupada o en cocina, azul para listo y rojo para anular.

## Usuarios de ejemplo (semilla)

Admin `admin@demo.co` / `CambiaEsto123!` (PIN 0000) · Supervisora 9999 · Cajero 1111 · Mesera 2222 · Cocina 3333.

## Pendiente conocido

El trabajo por hacer está en [PLAN.md](PLAN.md). La fase 0 está completa; la CI corre en GitHub Actions en cada push. La facturación DIAN (fase 3) quedó fuera del alcance de este software. Detalles abiertos que no son tareas del plan:

- Los mensajes de validación del backend salen en inglés ("precio must not be less than 0"): son los de class-validator por defecto. Los DTO nuevos del panel (fase 1) deben llevar `message` en español.
- Sin notas crédito, una venta de un turno ya cerrado no se puede anular desde el sistema.
- Los botones de las mesas no tienen nombre accesible para lectores de pantalla.
- El estado de inactividad se prueba rápido con `VITE_MINUTOS_BLOQUEO` en `pos-frontend/.env.local`; el muestrario de componentes está en `/admin/muestra` (solo admin).
