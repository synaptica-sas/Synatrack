# CLAUDE.md — Contexto del proyecto Synatrack

> Archivo de contexto para sesiones de Claude Code. Léelo completo antes de tocar código.
> Complementa (no reemplaza) `documentacion/DOCUMENTACION_TECNICA.md`, que tiene el detalle
> exhaustivo de arquitectura, flujos y una auditoría previa en sus §10 y §11.

**Antes de explorar el repo a ciegas**, hay dos atajos:

1. `documentacion/MAPA_PROYECTO.md` (generado): los 125 endpoints con sus roles reales, las 16
   pantallas con su permiso y componente, y el grafo de dependencias entre carpetas. Responde la
   mayoría de los "¿dónde vive esto?" sin abrir un solo archivo.
   Regenerar: `node scripts/generate-map.mjs`.
2. **Graphify**, para relaciones a nivel de símbolo. Si `graphify-out/` no existe (está en
   `.gitignore`), constrúyelo con `graphify extract . --code-only` (~1 min, sin API key). Luego:
   - `graphify affected "<símbolo>"` — qué se rompe si tocas algo. Es el más útil a diario.
   - `graphify god-nodes` / `graphify path "A" "B"` / `graphify explain "X"`.
   - `graphify query "<pregunta>"` funciona pero devuelve mucho ruido; prefiere `affected`.

Para levantar la app localmente y el detalle de estas herramientas:
`documentacion/DESARROLLO_LOCAL.md`.

**El trabajo se organiza con agentes** (`.claude/agents/`), no con un ciclo de specs:
`backend-fastify`, `base-de-datos`, `frontend-react`, `calculos-negocio`, `qa-pruebas`,
`revisor-ui` (navegador real vía Playwright) y `revisor-seguridad`. Delega en el que
corresponda en vez de hacerlo todo desde la sesión principal.

---

## 1. Qué es la aplicación

**Synatrack** (también llamada "App Gestión" en docs y nombres de servicio) es una aplicación web
de **PMO / control de proyectos de consultoría** para Synaptica. Cubre el ciclo completo:

- **Gobierno**: dashboard de KPIs, portafolio con semáforo RAG y métricas EVM (CPI/SPI), CRUD de proyectos, matriz de capacidad.
- **Operación**: consultores, registro y aprobación de horas, actividades, horas extra con recargos por ley y doble aprobación (PM → Finanzas), gastos.
- **Financiero**: ingresos/facturación, proyecciones (forecasts), calculadora de estimaciones, tasas FX.
- **Administración**: usuarios y roles, configuración de horas extra por país, bitácora de auditoría.

Idioma del producto: **español** (UI, mensajes de error, comentarios de código). Mantenlo.

---

## 2. Stack y estructura

| Capa | Tecnología |
|---|---|
| Frontend | React 19 + TypeScript + Vite 8, **sin router ni librería de estado** (routing manual con `history.pushState`) |
| Backend | Fastify 5 + Zod 4 + Prisma 6 (ESM, `"type": "module"`, imports con extensión `.js`) |
| BD | PostgreSQL (Supabase en prod, Docker `localhost:5433` en local) |
| Auth | Microsoft Entra ID (MSAL en el front, `jose` + JWKS en el back) o bypass demo |
| Tests | Vitest en ambos proyectos (unitarios de utils + algunos componentes) |

```
backend/
  prisma/schema.prisma          # 25+ modelos, todos los enums de negocio
  prisma/migrations/            # desfasado respecto al schema (ver §7)
  prisma/seed.mjs               # datos demo
  scripts/{smoke,bootstrap-admin}.mjs
  src/app.ts                    # buildApp: CORS, content-type parser, error handler
  src/server.ts                 # listen + jobs de arranque (una sola vez)
  src/config/env.ts             # validación Zod de variables de entorno
  src/auth/guard.ts             # authenticate (JWT + JIT provisioning) y authorize(roles)
  src/auth/roles.ts             # matriz Permission x AppRole (solo la consume el frontend)
  src/routes/index.ts           # registro de TODOS los módulos con su prefijo
  src/modules/<dominio>/*.routes.ts
  src/utils/                    # cálculo puro y testeable (financial, evm, capacity, holidays,
                                # calculateExtraHours, currency, health, audit, notifications)
frontend/
  src/App.tsx                   # ~2000 líneas: layout, sidebar, routing, landing, drawers
  src/services/api.ts           # TODOS los tipos de dominio + TODAS las llamadas HTTP
  src/hooks/use<Dominio>.ts     # patrón { data, loading, reload } con flag `enabled`
  src/features/<dominio>/*Tab.tsx
  src/components/               # reutilizables (Table, Toast, SearchableSelect, ...)
  src/App.css                   # 3000 líneas, variables CSS + tema oscuro vía .dark en <body>
documentacion/                  # 4 docs md (técnica, aplicación, deployment, correos)
contexto/                       # insumos originales del cliente (.docx, .xlsx, html)
```

---

## 3. Comandos

El entorno local **ya está instalado y funcionando** en esta máquina (detalle en
`documentacion/DESARROLLO_LOCAL.md`). No hay Docker: la base es un **Postgres 15.15 portable**
en `C:\Users\<usuario>\Synatrack\pg-local\`, fuera del repo, que solo corre cuando se arranca.

```powershell
.\scripts\dev.ps1                     # base + backend + frontend, y abre el navegador
.\scripts\db.ps1 start|stop|status|psql|reset
node scripts/generate-map.mjs         # regenera documentacion/MAPA_PROYECTO.md
```

```bash
cd backend
npm run dev                           # tsx watch -> http://localhost:4000
npm test                              # 153 tests, pasan
npm run prisma:deploy                 # migrate deploy
npm run prisma:seed                   # solo roles + usuario admin, NO datos demo
npm run smoke                         # smoke test manual contra un deploy

cd frontend
npm run dev                           # http://localhost:5173
npm run build                         # tsc -b && vite build -> dist/
npm test                              # 124 tests, pasan
npm run lint
```

El backend local corre en modo demo: entra como `ADMIN` sin pasar por Microsoft.
`docker-compose.yml` sigue en el repo y es válido en máquinas que sí tengan Docker.

---

## 4. Patrones que hay que respetar

**Ruta de backend** (`src/modules/<dominio>/<dominio>.routes.ts`):

```ts
const payloadSchema = z.object({ /* ... */ });

export async function xRoutes(app: FastifyInstance) {
  app.post("/", { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])] },
    async (request, reply) => {
      const payload = payloadSchema.parse(request.body);    // Zod ANTES de Prisma
      const row = await prisma.x.create({ data: payload }); // Prisma directo, sin capa de servicio
      return reply.status(201).send({ data: row });         // envoltorio { data }
    });
}
```

Reglas: siempre `{ data: ... }` (o `204` sin cuerpo en deletes); registrar el módulo en
`src/routes/index.ts`; si escribe horas/dinero, respetar el candado de `MonthlySnapshot`
(ver `time-entries` y `extra-hours` como referencia); llamar `writeAudit(...)` en escrituras.

**Frontend**: tipo + funciones `list*/get*/create*/update*/delete*` en `services/api.ts` ->
hook `use<Dominio>(enabled)` -> `features/<dominio>/<Dominio>Tab.tsx` -> registrar en `types.ts`
(`TabId`), `TAB_PATH_MAP`, `SIDEBAR_GROUPS` (con su `permission`) y el render condicional de `App.tsx`.

**Lógica de negocio**: cálculo puro -> `backend/src/utils/` con test en `utils/__tests__/`.
Proceso que reacciona solo -> `*.service.ts` dentro del módulo (patrón `alerts.service.ts`).
**No existe scheduler**: si algo debe correr periódicamente hay que implementarlo explícitamente.

---

## 5. Autenticación y autorización

Dos modos por variables de entorno:

- **Demo**: `AUTH_ENABLED=false` o `AUTH_DEMO_BYPASS=true` -> `authenticate` inyecta un admin local
  sin validar nada. Frontend: `VITE_FORCE_LOCAL_AUTH=true`.
- **Entra ID**: valida el JWT contra JWKS del tenant, con issuer v1 y v2 y audiencia `AZURE_AD_AUDIENCE`.

Roles (`AppRole`): `ADMIN`, `PM`, `CONSULTANT`, `FINANCE`, `VIEWER`. La claim `roles` del token se
pasa a mayúsculas y debe coincidir con el enum (`NOMINA` se mapea a `FINANCE`). Azure AD es la
fuente de verdad: si el token trae roles, se reemplazan los locales.

**JIT provisioning** en cada login: crea el `User` si no existe; si no hay roles asigna `CONSULTANT`;
si es `CONSULTANT` crea su `Consultant` con `hourlyRate = 0` (hay que editarlo a mano después);
el correo de `ADMIN_EMAIL` siempre recibe `ADMIN`.

**Punto clave**: los endpoints protegen con `authorize([AppRole...])` (roles crudos). El mapa
`Permission`/`rolePermissions` de `auth/roles.ts` **solo gobierna qué ve el frontend**. Son dos
sistemas paralelos que pueden desincronizarse. Existe además una **tercera copia** de la matriz de
permisos hardcodeada en `App.tsx` (`handleSwitchRole`, el simulador de rol para admins).

---

## 6. Despliegue (estado confuso — verificar antes de tocar)

- `render.yaml`: backend como Web Service (`app-gestion-backend`) + cron job diario de FX.
- `frontend/vercel.json`: rewrite de `/api` a **`app-gestion-demo.onrender.com`** (nombre distinto
  al de `render.yaml`), hardcodeado.
- `.github/workflows/azure-static-web-apps-*.yml`: despliega el frontend a Azure Static Web Apps en
  cada push a `main`, con `output_location: "build"` cuando Vite emite `dist` -> **probablemente roto**.
  No corre tests ni type-check.
- `frontend/server.mjs`: servidor estático propio que inyecta `/env.js` con `window.__APP_CONFIG__`
  (config en runtime, usado por Docker/Render; Vercel usa las `VITE_*` de build).
- Ramas: `main` (activa, la de este checkout) y `origin/dev`. Los docs hablan de `develop`/`deploy`,
  que ya no existen como tales.

---

## 7. Deuda técnica conocida (verificada contra el código el 2026-09-18)

`documentacion/DOCUMENTACION_TECNICA.md` §10 lista 27 hallazgos y §11 las mejoras propuestas.
**Sigue todo abierto.** Los que más condicionan cualquier desarrollo nuevo:

1. ~~**Drift de migraciones**~~ — **RESUELTO el 2026-09-18**. La migración
   `20260918120000_fix_schema_drift` incorpora `CustomHoliday`, `ApprovalDelegation`,
   `Consultant.allowWeekendWork`/`isInternal`/`company`, `ExtraHoursConfig.country`/`monthlyDivisor`
   y `User.country`. Es **idempotente** (`IF NOT EXISTS`), así que se puede aplicar tal cual sobre
   una base que ya los tenga por `db push`.
   ⚠ **Pendiente en Supabase/producción**: aún no se ha aplicado allá. Ejecutar `prisma migrate deploy`
   contra esa base (seguro por ser idempotente) o, si se prefiere no tocarla,
   `prisma migrate resolve --applied 20260918120000_fix_schema_drift` para registrarla como aplicada.
   Sigue en pie la regla: nunca `prisma db push` fuera de un prototipo local.
2. **El error handler global devuelve `detail` y `stack` al cliente en producción** (`src/app.ts`).
3. **No hay scheduler**: `runAssignmentMaintenance` y `runAlertEngine` corren una sola vez al arrancar.
4. **Bug de FX en `GET /api/projects/:id/profitability`**: reconstruye el rateMap con `key.split("_")`
   cuando `buildRateMap` usa `"->"` -> las conversiones caen al fallback sin convertir.
5. **Tres cálculos de rentabilidad distintos** (`financial.ts`, `/stats/overview`, `/portfolio`,
   `project-detail`) y `marginThreshold` hardcodeado a 15 en stats y alerts.
6. **Auditoría parcial**: horas, horas extra, gastos, ingresos, consultores y usuarios no dejan rastro.
7. Sin paginación en casi ningún `GET /` (excepto `/api/audit`).

`documentacion/BACKLOG_DEPURACION.md` tiene 30 ítems de **limpieza** (código muerto, objetos
obsoletos, duplicación, configuración inconsistente) con evidencia archivo:línea y orden
sugerido. Es la lista que hay que ir vaciando; no repite los §10 ni los de abajo.

**Hallazgos adicionales de la revisión del 2026-09-18** (no estaban en §10):

- **`GET /api/time-entries` no filtra por rol**: devuelve todas las horas de todos con el objeto
  `consultant` incluido -> expone `hourlyRate` de toda la plantilla a cualquier `CONSULTANT`/`VIEWER`.
  `extra-hours` y `activities` sí filtran por email; time-entries es la excepción.
- **`POST /api/time-entries` acepta cualquier `consultantId`**: un consultor puede registrar horas
  a nombre de otro.
- **`approve`/`reject` de horas toman `approvedBy` del body**, no de `request.authUser` -> el rastro
  de quién aprobó es falsificable.
- **`nodemailer` con `rejectUnauthorized: false` y `ciphers: "SSLv3"`** en `utils/notifications.ts`.
- **Los correos HTML interpolan texto del usuario sin escapar** (notas de feedback, nombres).
- **Los hooks de datos se tragan los errores**: `useProjects` y compañía no exponen estado de error y
  `void reload()` deja rejections sin manejar; un 500 se ve como una tabla vacía.
- **`authenticate` hace 4–6 queries por petición** (incluido el chequeo JIT de consultor) y
  `ensureDefaultConfigs()` escribe en BD en casi cada request de horas extra.
- **`RagChat`** no es un LLM: es coincidencia de texto en el cliente sobre los datos ya cargados.
- Las instrucciones de arranque local de `DOCUMENTACION_APLICACION.md` §7.3 apuntan a
  `.env.local.5433.example`, que no existe.

---

## 8. Convenciones

- Comentarios y textos de UI en español; nombres de código en inglés.
- Prisma devuelve `Decimal` -> en el frontend los montos llegan como **string**; convertir con `Number()`.
- Fechas: el backend calcula en **UTC** (`Date.UTC`) salvo `assignments.job.ts`, que usa hora local.
- Los `Forecast.startDate/endDate` son **strings** `"YYYY-MM-DD"`, no `DateTime`.
- Sin librería de gráficos: las visualizaciones son SVG/CSS a mano.
- Exportaciones: `xlsx` y `jspdf` + `jspdf-autotable` (chunks separados en `vite.config.ts`).
