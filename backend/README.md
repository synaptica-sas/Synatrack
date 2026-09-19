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

## Render deploy (API)
1. Root directory:
   - `backend`
2. Build command:
   - `npm ci && npm run build`
3. Start command:
   - `npm run start`
4. Variables:
   - `NODE_ENV=production`
   - `CORS_ORIGIN=https://<frontend-domain>,https://<optional-custom-domain>`
   - `DATABASE_URL=<supabase-pooled-url>`
   - `DIRECT_URL=<supabase-direct-url>`
   - `AUTH_ENABLED=false`
   - `AUTH_DEMO_BYPASS=true`
   - `ADMIN_EMAIL=<demo-admin-email>`

For a Microsoft Entra production-style flow, set:
- `AUTH_ENABLED=true`
- `AUTH_DEMO_BYPASS=false`
- `AZURE_AD_TENANT_ID=<entra-tenant-id>`
- `AZURE_AD_AUDIENCE=<api-audience>`

Apply migrations before or during deployment with:
- `npm run prisma:deploy`

Do not run `prisma db push --accept-data-loss` as part of a production start command.

## Health and readiness
- `GET /health`:
   - Returns `200` when DB is reachable.
   - Returns `503` when DB is down.

## Notes
- `render.yaml` in the repository root documents the expected Render Web Service.
- The health check path is `/health`.
- Render provides the `PORT` variable automatically.

## Smoke test (E2E-lite)
With API running locally or deployed, execute:
- `npm run smoke`

To run against Render:
- `API_BASE_URL=https://<your-backend-domain>.onrender.com npm run smoke`

If authentication is enabled, provide a token:
- `SMOKE_BEARER_TOKEN=<access-token> API_BASE_URL=https://<your-backend-domain>.onrender.com npm run smoke`

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
