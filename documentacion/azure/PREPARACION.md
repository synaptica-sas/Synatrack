# Preparación del código para Azure

> Rama `migracion-azure`, 2026-11-09. Qué se cambió en el código para que Synatrack corra en
> **Azure App Service Linux** (backend), **Azure Database for PostgreSQL Flexible Server** (base)
> y **Azure Static Web Apps** (frontend), sin romper la producción actual en Render + Supabase.
>
> Este documento cubre solo el código. La infraestructura (`infra/`, `scripts/azure.ps1`) y los
> workflows (`.github/workflows/`) son de otro frente de trabajo.

---

## 1. Qué se cambió y por qué

| #  | Tema                                          | Estado encontrado                                                                                                                                                                                                          | Cambio                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | Motor de Prisma en Linux                      | `generator client` sin `binaryTargets`: solo se generaba el motor de la máquina que construye.                                                                                                                        | `binaryTargets = ["native", "debian-openssl-3.0.x"]` en `backend/prisma/schema.prisma`. `npm run build` genera ahora también `libquery_engine-debian-openssl-3.0.x.so.node` (verificado en Windows). Sirve para App Service Linux y para `node:24-slim` (Dockerfile/Render).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2  | Puerto y host                                 | `server.ts` ya escuchaba en `env.PORT` y `0.0.0.0`.                                                                                                                                                                  | Sin cambios.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2  | Apagado con SIGTERM                           | El manejador paraba el intervalo de jobs y cerraba Fastify, pero **no cerraba el pool de Prisma**.                                                                                                                   | Ahora: `stopJobsScheduler()` → `app.close()` → `prisma.$disconnect()` → `exit(0)`; si algo falla, `exit(1)`; y un temporizador de seguridad de 20 s (con `unref`) por si algo se traba, antes de que App Service mate el proceso (~30 s tras SIGTERM).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 3  | IP real del cliente                           | Sin `trustProxy`: detrás de Render o de App Service, `request.ip` es la IP del proxy, así que **todos los usuarios compartían un único cupo** del rate limit y la auditoría guardaba la IP del balanceador. | Variable nueva `TRUST_PROXY` (por defecto `false`, igual que antes: Render no cambia). En Azure: `TRUST_PROXY=1`. Además, App Service escribe la IP de `X-Forwarded-For` con puerto (`1.2.3.4:5678`); sin quitarlo, cada conexión tendría su propio cupo. `utils/clientIp.ts` normaliza la IP y se usa en el `keyGenerator` del rate limit y en `utils/audit.ts` (`writeAudit` y `registrarLogin`). Test: `utils/__tests__/clientIp.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 3  | `allowList` de `/health`                  | Comparaba `request.url` exacto: `/health?x=1` sí contaba contra el límite.                                                                                                                                           | Compara la ruta sin query string.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 4  | Migraciones fuera del arranque                | `npm run start` = `node dist/server.js`: no migra.                                                                                                                                                                     | Sin cambios (ver §3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 5  | URLs de Render en el código                  | El fallback de producción ya es `""` y `services/api.ts` ya lanza `Missing VITE_API_URL in frontend build configuration`.                                                                                           | Sin cambios (ver §4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 6  | `backend/.env.example`                      | Supabase con `connection_limit=1` (serializa todas las consultas).                                                                                                                                                       | Supabase con `connection_limit=5` y explicación; sección nueva de Azure Flexible Server; `TRUST_PROXY`, `RATE_LIMIT_MAX`, `FX_SYNC_IN_CYCLE` y la lista de `AZURE_AD_AUDIENCE` documentadas.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 7  | Sincronización FX en Azure                   | `POST /api/fx/sync` solo lo disparaba el cron de Render (`app-gestion-fx-sync`); no estaba en `TRABAJOS` de `jobs.service.ts`, así que en Azure nadie traería las tasas.                                         | Nuevo trabajo `fx-sync` en el ciclo, activo solo con `FX_SYNC_IN_CYCLE=true` (por defecto `false`: Render y las pruebas de ruta, que no deben salir a internet, siguen igual). Reutiliza `runFxSync` a través de `runFxSyncDiario` (`modules/fx/fx-sync.service.ts`). **Compuerta diaria** pura en `utils/fxSyncGate.ts`, sobre el historial `JobRun` de `fx-sync` (que también escribe la ruta HTTP): no corre si ya hubo un éxito el mismo día UTC, venga del ciclo, del cron de Render o del botón; tras un fallo espera 3 h antes de reintentar. Si la compuerta lo omite, el ciclo **no** escribe en `JobRun` (para que la omisión no cuente como éxito en `/health`). Si alguna moneda falla, se registra `ok=false`, igual que la ruta. Tests: `utils/__tests__/fxSyncGate.test.ts`, `jobs.service.test.ts` y `tests/routes/fx-sync-diario.test.ts` (con `fetch` simulado). |
| 7  | Convivencia con Render                        | —                                                                                                                                                                                                                         | Idempotente: si el cron de Render y el ciclo coinciden en el mismo instante (o hay dos instancias en App Service), ambos escriben la misma tasa en `FxConfig` (actualización por moneda, no inserción) y lo único que se duplica es una fila de `FxRateHistory` con el mismo valor. No se puso cerrojo entre instancias (un advisory lock de Postgres no es fiable con conexiones de pool); el peor caso es esa fila repetida.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 8  | Rutas profundas en Static Web Apps            | No había `staticwebapp.config.json`: con el routing por `history.pushState`, recargar `/timesheet` daba 404.                                                                                                        | `frontend/public/staticwebapp.config.json` (Vite lo copia a `dist/`): `navigationFallback` → `/index.html` excluyendo `/assets/*`, `/Logos/*`, `/env.js` y archivos estáticos por extensión; caché inmutable para `/assets/*` y `no-cache` para `index.html` y `env.js`. Cabeceras: `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Strict-Transport-Security` y `Permissions-Policy`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 8  | CSP (fuera a propósito)                      | —                                                                                                                                                                                                                         | **No** se añadió `Content-Security-Policy`. MSAL necesita `login.microsoftonline.com` (redirect e iframe oculto de `acquireTokenSilent`), el front llama a la API en otro origen, a `graph.microsoft.com`, a dos APIs públicas de FX y carga banderas de `flagcdn.com`, y `jspdf`/`xlsx` generan blobs. Una CSP mal ajustada rompe el login en silencio; queda para después del corte, empezando en modo `Content-Security-Policy-Report-Only`. Por la misma razón `X-Frame-Options` es `SAMEORIGIN` y no `DENY`: el iframe silencioso de MSAL carga la propia app.                                                                                                                                                                                                                                                                                                                                  |
| 9  | Audiencia del token                           | `AZURE_AD_AUDIENCE` aceptaba un solo valor; con tokens v2 `aud` es el client id (GUID), no el App ID URI.                                                                                                              | Lista separada por comas (`api://<id>,<id>`), parseada en `auth/audience.ts` y validada en `env.ts`; llega a `jwtVerify` como arreglo. Un solo valor funciona igual que antes (Render). Vacía → valor por defecto. Test: `auth/__tests__/audience.test.ts` (firma tokens locales con `aud` v1 y v2 y uno ajeno).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 10 | `SUPPORT_EMAIL` / `PAYROLL_EMAIL` vacías | `z.string().email()`: una app setting vacía hacía fallar el arranque.                                                                                                                                                  | Usan el patrón `optionalString` de `env.ts`: vacía = no definida (caen en `ADMIN_EMAIL`). `utils/notifications.ts` ya no relee `process.env` para estas dos (saltaba la validación).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

**Para que Render siga intacto en producción después de fusionar esto:** no se tocó
`render.yaml`; `TRUST_PROXY` sin definir se comporta como antes; el motor extra de Prisma solo
añade un archivo. Si se quiere la IP real también en Render, poner `TRUST_PROXY=1` desde el
panel de Render y comprobar en `AuditLog.ipAddress` que aparece la IP pública y no una interna.

---

## 2. Variables de entorno

Leyenda: **KV** = secreto, va en Key Vault y se referencia desde App Service
(`@Microsoft.KeyVault(SecretUri=...)`). **AS** = app setting en claro. **Build** = se hornea en el
bundle del frontend en el build (todo lo `VITE_*` es público por definición: nunca secretos).

### 2.1 Backend (`backend/src/config/env.ts` + `process.env` en `utils/notifications.ts`)

| Variable                                                           | Obligatoria                                                                                              | Stage                                                                    | Prod                                                | Dónde                           | Existe en Render |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------- | -------------------------------- | ----------------- |
| `NODE_ENV`                                                       | Sí en la nube (por defecto `development`)                                                             | `production`                                                           | `production`                                      | AS                               | Si                |
| `PORT`                                                           | No: la inyecta App Service                                                                               | no definir                                                               | no definir                                          | —                               | No                |
| `CORS_ORIGIN`                                                    | Sí en la práctica (por defecto `http://localhost:5173`)                                              | URL de la SWA de stage (lista separada por coma si hay varias)           | URL de la SWA de prod / dominio propio              | AS                               | Si                |
| `RATE_LIMIT_MAX`                                                 | No (300)                                                                                                 | 300                                                                      | 300                                                 | AS                               | No                |
| `TRUST_PROXY`                                                    | No (`false`) — **nueva**                                                                        | `1`                                                                    | `1`                                               | AS                               | No                |
| `DATABASE_URL`                                                   | **Sí**                                                                                            | cadena de Flexible Server stage, `sslmode=require`                     | cadena de Flexible Server prod, `sslmode=require` | KV                               | Si                |
| `DIRECT_URL`                                                     | No en runtime; sí para `prisma migrate deploy`                                                        | igual a `DATABASE_URL`                                                 | igual a `DATABASE_URL`                            | KV (y como secreto del pipeline) | Si                |
| `AUTH_ENABLED`                                                   | No (`false`)                                                                                           | `true`                                                                 | `true`                                            | AS                               | Si                |
| `AUTH_DEMO_BYPASS`                                               | No (`false`)                                                                                           | `false`                                                                | `false`                                           | AS                               | Si                |
| `AZURE_AD_TENANT_ID`                                             | Sí con auth real (por defecto `common`)                                                               | ID del tenant                                                            | ID del tenant                                       | AS                               | Si                |
| `AZURE_AD_AUDIENCE`                                              | Sí con auth real (por defecto `api://app-gestion-backend`). Acepta **lista separada por comas** | `api://<client-id-api>,<client-id-api>` (v1 y v2)                      | ídem con el API de prod                            | AS                               | Si                |
| `ADMIN_EMAIL`                                                    | No (`admin@synaptica.local`)                                                                           | correo del admin                                                         | correo del admin                                    | AS                               | Si                |
| `SUPPORT_EMAIL`                                                  | No (cae en `ADMIN_EMAIL`; vacía = no definida)                                                        | buzón de soporte                                                        | buzón de soporte                                   | AS                               | No                |
| `PAYROLL_EMAIL`                                                  | No (cae en `ADMIN_EMAIL`; vacía = no definida)                                                        | buzón de nómina (de prueba en stage)                                   | buzón de nómina                                   | AS                               | No                |
| `FX_SYNC_TOKEN`                                                  | No (sin él, `/api/fx/sync` solo con sesión)                                                          | aleatorio largo, distinto por entorno                                    | ídem                                               | KV                               | Si                |
| `JOBS_RUN_TOKEN`                                                 | No (sin él, `/api/jobs/run` solo con sesión ADMIN)                                                   | aleatorio largo                                                          | ídem                                               | KV                               | Si                |
| `JOBS_INTERVAL_MINUTES`                                          | No (`0`)                                                                                               | `60` si el plan tiene *Always On*; si no, `0` + disparador externo | ídem                                               | AS                               | No                |
| `FX_SYNC_IN_CYCLE`                                               | No (`false`) — **nueva**                                                                        | `false` (parámetro `fxSyncInCycle`; tasas a demanda)                   | `false` (en Render también `false`)             | AS                               | No                |
| `AUTH_DEV_EMAIL` / `AUTH_DEV_ROLES` / `AUTH_DEV_ROLE_HEADER` | No                                                                                                       | **no definir**                                                     | **no definir**                                | —                               | No                |
| `SMTP_HOST`                                                      | No (sin él, los correos se simulan en el log)                                                           | servidor SMTP                                                            | servidor SMTP                                       | AS                               | No                |
| `SMTP_PORT`                                                      | No (587)                                                                                                 | 587                                                                      | 587                                                 | AS                               | No                |
| `SMTP_USER`                                                      | No                                                                                                       | usuario SMTP                                                             | usuario SMTP                                        | AS                               | No                |
| `SMTP_PASS`                                                      | No                                                                                                       | contraseña de aplicación                                               | ídem                                               | KV                               | No                |
| `SMTP_FROM`                                                      | No (`App Gestión <noreply@synaptica.co>`)                                                             | remitente                                                                | remitente                                           | AS                               | No                |
| `TEAMS_PAYROLL_WEBHOOK_URL`                                      | No (sin él, se simula)                                                                                  | webhook de un canal de prueba                                            | webhook real                                        | KV (la URL es la credencial)     | No                |
| `TEAMS_FEEDBACK_WEBHOOK_URL`                                     | No                                                                                                       | ídem                                                                    | ídem                                               | KV                               | No                |
| `TZ`                                                             | No: el código no la lee y calcula en UTC                                                                | `UTC` (por defecto en App Service)                                     | `UTC`                                             | AS (opcional)                    | No                |

Notas:

- El candado anti-solapamiento del ciclo es **por proceso** (variable de módulo): con varias
  instancias de App Service y `JOBS_INTERVAL_MINUTES > 0`, cada instancia corre su ciclo. Los
  trabajos están pensados para tolerarlo (la compuerta de FX y la marca semanal del resumen leen la
  base), pero lo más limpio es una sola instancia o `JOBS_INTERVAL_MINUTES=0` + un disparador
  externo a `POST /api/jobs/run`.
- FX (hoy a demanda en Azure: `fxSyncInCycle = false`). Si se activa, con `FX_SYNC_IN_CYCLE=true` el ciclo trae las tasas una vez al día; ya no hace falta un
  disparador aparte a `POST /api/fx/sync` en Azure (la ruta sigue existiendo para el botón
  "Actualizar ahora" y para el cron de Render). Requiere que el ciclo corra (intervalo en proceso o
  disparador de `POST /api/jobs/run`).
- Ajustes de plataforma (no los lee el código, pero condicionan el arranque):
  comando de inicio `node dist/server.js`, Node 24 (coincide con `engines`), health check en
  `/health` y `SCM_DO_BUILD_DURING_DEPLOYMENT=false` (el paquete ya viene construido; si Oryx
  vuelve a instalar dependencias sin la CLI de Prisma, el cliente generado queda sustituido por un stub).

### 2.2 Frontend (`frontend/src/config/env.ts`)

Cada valor se busca primero en `window.__APP_CONFIG__` (runtime, lo escribe `frontend/server.mjs`
en Docker/Render) y después en `import.meta.env` (build). **En Static Web Apps no hay servidor**:
`public/env.js` es un marcador vacío, así que solo cuentan las variables de **build**, que el
workflow debe pasar como `env:` del paso que compila (las *app settings* de la SWA no llegan a Vite).

| Variable                    | Obligatoria                                                                             | Stage                                             | Prod                                      | Dónde |
| --------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------- | ------ |
| `VITE_API_URL`            | **Sí** en producción (sin ella, cada llamada lanza `Missing VITE_API_URL...`) | `https://<app-service-stage>.azurewebsites.net` | URL del App Service prod / dominio propio | Build  |
| `VITE_AZURE_TENANT_ID`    | Sí con Entra ID                                                                        | ID del tenant                                     | ID del tenant                             | Build  |
| `VITE_AZURE_CLIENT_ID`    | Sí con Entra ID                                                                        | client ID de la SPA                               | ídem                                     | Build  |
| `VITE_AZURE_REDIRECT_URI` | No (por defecto `window.location.origin`)                                             | no definir o URL de la SWA                        | ídem                                     | Build  |
| `VITE_AZURE_API_SCOPE`    | Sí con Entra ID                                                                        | `api://<audiencia>/access_as_user`              | ídem                                     | Build  |
| `VITE_FORCE_LOCAL_AUTH`   | No                                                                                      | no definir / `false`                            | no definir / `false`                    | Build  |

`server.mjs` acepta alias (`API_URL`, `BACKEND_URL`, `AZURE_TENANT_ID`, `ENTRA_*`, `AAD_*`,
`FORCE_LOCAL_AUTH`, `AUTH_BYPASS`) y `PORT`; solo aplican cuando el front se sirve con ese servidor,
no en SWA. Ninguna variable del frontend es secreta.

---

## 3. Paquete de despliegue del backend

`npm run start` = `node dist/server.js`: no ejecuta migraciones ni usa `tsx`, `typescript`,
`vitest` ni la CLI `prisma` (se comprobó: en `src/` fuera de pruebas solo se importan
`@fastify/*`, `@prisma/client`, `fastify`, `jose`, `nodemailer`, `zod` y `dotenv`, todas en
`dependencies`). Las migraciones corren en el pipeline con `npx prisma migrate deploy`.

El cliente generado vive en `node_modules/.prisma/client/` (motores
`libquery_engine-debian-openssl-3.0.x.so.node` y el nativo, más el `schema.prisma` embebido) y se
carga vía `node_modules/@prisma/client`. Por eso **no** se puede hacer `npm ci --omit=dev` en limpio
después de generar: la reinstalación de `@prisma/client` sin la CLI deja un cliente stub.

Secuencia del pipeline (en un runner Linux, desde `backend/`):

```bash
npm ci                       # con devDependencies (hace falta la CLI de prisma y tsc)
npm run build                # prisma generate + tsc -> dist/
npx prisma migrate deploy    # con DATABASE_URL y DIRECT_URL del entorno destino
npm prune --omit=dev         # quita devDependencies; respeta node_modules/.prisma
test -f node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node
```

Contenido del zip:

| Ruta                                          | Necesaria        | Motivo                                                                                                         |
| --------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `dist/`                                     | Sí              | código compilado (`dist/server.js` es el punto de entrada)                                                  |
| `node_modules/` (ya podado)                 | Sí              | incluye `node_modules/.prisma/client` y `node_modules/@prisma/client`                                      |
| `package.json`                              | Sí              | `"type": "module"` (sin él Node no carga `dist/` como ESM)                                                |
| `package-lock.json`                         | Recomendable     | trazabilidad de versiones                                                                                      |
| `prisma/`                                   | No para arrancar | solo si las migraciones se lanzan desde el paquete; si corren en el pipeline sobre el checkout, puede omitirse |
| `src/`, `tests/`, `scripts/`, `.env*` | No               | no incluir; nunca un `.env` real                                                                             |

---

## 4. URLs de Render en el código y pasos del corte

Búsqueda de `onrender.com` y `app-gestion` en `frontend/` y `backend/` (sin docs):

| Archivo                                          | Contenido                                               | Acción                                                                     |
| ------------------------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------- |
| `frontend/vercel.json`                         | rewrite de `/api` a `app-gestion-demo.onrender.com` | Solo afecta a Vercel. Retirar en el corte, junto con el proyecto de Vercel. |
| `frontend/.env.production.example`             | `VITE_API_URL=https://your-backend-name.onrender.com` | Ejemplo; actualizar a la URL de App Service en el corte.                    |
| `backend/src/config/env.ts`                    | default `AZURE_AD_AUDIENCE=api://app-gestion-backend` | Es un App ID URI, no una URL de Render. Se define siempre por variable.     |
| `backend/src/routes/health.routes.ts`          | `service: "app-gestion-backend"`                      | Nombre informativo en `/health`. Sin impacto.                             |
| `backend/src/modules/jobs/job-runs.service.ts` | comentarios con los crons de Render                     | Actualizar el comentario cuando el disparador pase a Azure.                 |

**De dónde sale `https://synatrack.onrender.com`:** no viene del código.
`frontend/src/config/env.ts` usa `http://localhost:4000` solo en `vite dev` y `""` en build de
producción, y `services/api.ts` ya lanza un error explícito si queda vacía. Ningún archivo
versionado contiene `synatrack.onrender.com`, y el workflow
`azure-static-web-apps-victorious-glacier-0d52b010f.yml` **no** define `VITE_API_URL`. Se revisó el
bundle publicado hoy en esa SWA (`victorious-glacier-0d52b010f.7.azurestaticapps.net`): compila
`apiUrl: window.__APP_CONFIG__.VITE_API_URL || ""` y no contiene ninguna URL de Render, es decir,
**esa SWA hoy no puede hablar con ningún backend**. El bundle que sí contiene
`synatrack.onrender.com` es, con toda probabilidad, el de otro despliegue (Vercel u otro servicio
de Render) con `VITE_API_URL` definida en su panel. Ojo: `render.yaml` dice que el backend vivo es
`app-gestion-demo.onrender.com`; `synatrack.onrender.com` sería otro servicio. Confirmar en los
paneles de Render y Vercel cuál es la producción real antes del corte.

Como el fallback ya es un error explícito y no una URL fija, no hay nada que quitar en el código.

Pasos del corte que dependen del frontend (no se pueden hacer aún):

1. Pasar `VITE_API_URL` (y las `VITE_AZURE_*`) como `env:` del paso de build en el workflow de la
   SWA, con la URL del App Service del entorno.
2. Añadir la URL de la SWA (y el dominio propio) a `CORS_ORIGIN` del App Service, y como *redirect
   URI* de la SPA en el registro de Entra ID.
3. Dejar de publicar en Vercel y retirar `frontend/vercel.json`; actualizar
   `frontend/.env.production.example`.
4. Apagar los crons de Render (`app-gestion-fx-sync`, `app-gestion-jobs`) cuando los disparadores
   de Azure estén vivos, para no tener dos ciclos contra bases distintas.
5. Comprobar tras el primer despliegue en la SWA que recargar una ruta profunda (`/timesheet`) sirve
   la app y no un 404, y que el login con Microsoft sigue funcionando con las cabeceras de
   `staticwebapp.config.json`.

---

## 5. Supabase al día antes del dump

**Contexto.** CLAUDE.md §7.1 dice que `20260915164644_sync_schema_drift` no está aplicada en
Supabase. Pero desde entonces el `startCommand` de Render es
`npm run prisma:deploy && npm run start`, que aplica las migraciones pendientes en cada arranque,
así que **es probable que ya esté aplicada**. Primero se mira, luego se decide.

`20260915164644_sync_schema_drift` es idempotente (`CREATE ... IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS` y la FK dentro de un `DO $$ ... IF NOT EXISTS`). La siguiente,
`20260918130000_fix_extra_hours_monthly_divisor`, es una migración **de datos** (corrige
`monthlyDivisor` de Perú, Chile, México, Ecuador, Argentina y España solo si siguen en 220) y
también es segura de repetir.

**Importante:** ejecutar desde un checkout del **mismo commit que corre en producción** (`main`),
no desde esta rama. `migrate deploy` aplica *todas* las pendientes que encuentre en la carpeta, y
aplicar migraciones de una rama que producción aún no tiene puede dejar el esquema por delante del
código desplegado.

PowerShell, desde `backend/`, con la cadena **directa** de Supabase (puerto 5432, sin pgbouncer).
Las variables del shell tienen prioridad sobre `backend/.env`:

```powershell
$env:DATABASE_URL = "postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require"
$env:DIRECT_URL   = $env:DATABASE_URL

npx prisma migrate status      # 1. ver qué falta
```

- Si dice *Database schema is up to date*: no hay nada que hacer, pasar al dump.
- Si lista migraciones pendientes, **opción A (recomendada)**:

  ```powershell
  npx prisma migrate deploy
  npx prisma migrate status    # debe decir up to date
  ```
- **Opción B**, solo si se prefiere no ejecutar SQL de esquema sobre Supabase y se verificó a mano
  que las tablas/columnas de `sync_schema_drift` ya existen (por un `db push` antiguo):

  ```powershell
  npx prisma migrate resolve --applied 20260915164644_sync_schema_drift
  npx prisma migrate deploy    # aplica el resto, incluida la corrección de datos de 20260918
  ```

  No marcar `20260918130000_fix_extra_hours_monthly_divisor` con `resolve --applied`: es de datos
  y marcarla sin ejecutarla deja los divisores mal.
- Si `status` muestra una migración **fallida** (error P3009), revisar en `_prisma_migrations`
  qué se aplicó, corregir a mano y marcarla con `npx prisma migrate resolve --rolled-back <nombre>`
  (para reintentarla) o `--applied <nombre>` (si quedó completa).

Al terminar, limpiar las variables (`Remove-Item Env:DATABASE_URL, Env:DIRECT_URL`) y hacer el dump
solo del esquema `public` (el resto de esquemas son internos de Supabase):

```powershell
pg_dump "<cadena directa>" --schema=public --no-owner --no-privileges --format=custom --file synatrack.dump
```

Ninguno de estos comandos se ha ejecutado.
