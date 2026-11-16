# Frontend (React + TypeScript + Vite)

## Purpose
- Functional UI for App Gestion modules:
   - Dashboard and KPIs
   - Projects
   - Consultants
   - Time entries workflow (approve/reject)
   - Expenses
   - Forecasts
- Connects to backend API via `VITE_API_URL`.
- Uses orange brand style tokens and responsive layout.

## Local quick start
1. Install dependencies:
   - `npm install`
2. Set environment variable:
   - Create `.env` from `.env.example`
3. Run app:
   - `npm run dev`

## Build and run
- `npm run build`
- `npm run start` (serves built files using `server.mjs`)

## Despliegue (Azure Static Web Apps)
- Lo hace el pipeline `.github/workflows/deploy-frontend-azure.yml`: un push a `dev` publica en stage y uno a `main`, en prod.
- Las `VITE_*` se fijan en el build del pipeline. Los App Settings de la SWA no llegan a Vite.
- `public/staticwebapp.config.json` hace que las rutas de la SPA (por ejemplo `/projects`) caigan en `index.html`.
- `public/env.js` es un respaldo vacío de la configuración en runtime. Solo `server.mjs` (Docker local) lo reemplaza con valores reales.
- Detalle: `documentacion/DESPLIEGUE.md` e `infra/README.md`.
