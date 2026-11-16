# Backend (Node.js + TypeScript)

## Stack
- Fastify
- Prisma
- PostgreSQL (Supabase)

## Functional modules
- Projects (`/api/projects`)
- Consultants (`/api/consultants`)
- Time entries with approval workflow (`/api/time-entries`)
- Expenses (`/api/expenses`)
- Forecasts (`/api/forecasts`)
- Dashboard overview metrics (`/api/stats/overview`)

## Local quick start
1. Install dependencies:
   - `npm install`
2. Create `.env` from the only example file in this folder, `.env.example`:
   - `cp .env.example .env` (Windows: `copy .env.example .env`)
   - Then set `DATABASE_URL` and `DIRECT_URL` to a reachable Postgres. `.env.example` already
     ships commented-out pairs for local Postgres on port 5432 and on port 5433; uncomment the
     one you need and remove the Supabase strings.
   - Note: `.env.local.example` and `.env.local.5433.example` do not exist; earlier versions of
     this README referenced them by mistake.
3. Generate Prisma client:
   - `npm run prisma:generate`
4. Apply schema to a local/demo database:
   - `npm run prisma:deploy`
   - For throwaway local experiments only, `npm run prisma:push`
5. Seed baseline data:
   - `npm run prisma:seed`
   - This only creates the `AppRole` roles and the admin user from `ADMIN_EMAIL`. It does **not**
     create demo projects, consultants or time entries: the app starts empty.
6. Start API:
   - `npm run dev`

## Validation and status rules
- Project `endDate` must be after `startDate`.
- Currency fields require 3-letter ISO format (example: `USD`).
- Time entries can only move from `PENDING` to `APPROVED` or `REJECTED`.
- Rejection requires a note.
- Forecast ranges must use `YYYY-MM-DD` in `startDate` and `endDate`.
- Stats endpoint validates date ranges (`to` cannot be before `from`).

## Despliegue (Azure App Service)
Lo hace el pipeline `.github/workflows/deploy-backend-azure.yml`: un push a `dev` publica en stage y uno a `main`, en prod. El pipeline construye el backend, poda las dependencias, lo empaqueta en un zip, corre `prisma migrate deploy` y publica el zip en App Service.

Los App Settings los define `infra/main.bicep` y los secretos viven en Key Vault. Detalle: `documentacion/DESPLIEGUE.md` e `infra/README.md`.

Nunca correr `prisma db push` contra stage ni contra producción.

## Health and readiness
- `GET /health`:
   - Returns `200` when DB is reachable.
   - Returns `503` when DB is down.

## Notes
- The health check path is `/health` (App Service health check and the Azure availability test).
- App Service injects the `PORT` variable.

## Smoke test (E2E-lite)
With the API running locally, execute:
- `npm run smoke`

The smoke test creates test projects and consultants: run it only against a local API, never against stage or production. If authentication is enabled locally, provide `SMOKE_BEARER_TOKEN=<access-token>`.

## Available scripts
- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run prisma:generate`
- `npm run prisma:migrate`
- `npm run prisma:push`
- `npm run prisma:seed`
- `npm run prisma:deploy`
- `npm run prisma:studio`
- `npm run smoke`
