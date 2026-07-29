# Plan de despliegue demo

Este repositorio queda orientado a una demo con:

- Frontend: Vercel desde la rama `deploy`, carpeta `frontend`.
- Backend: Render Web Service desde la rama `deploy`, carpeta `backend`.
- Base de datos: Supabase PostgreSQL.

## Flujo de ramas

Trabaja en `develop` y solo fusiona a `deploy` cuando la demo compile y pase validaciones basicas.

```bash
git checkout develop
# cambios + pruebas
git push origin develop

git checkout deploy
git merge develop
git push origin deploy
```

## Lista de trabajo para llegar a la meta

- Mantener Railway fuera del flujo activo de despliegue.
- Usar scripts seguros de backend: build genera Prisma Client y start solo arranca la API.
- Crear migraciones Prisma y ejecutarlas con `npm run prisma:deploy`.
- Configurar Supabase con `DATABASE_URL` pooled y `DIRECT_URL` direct/session.
- Configurar Render con root `backend`, build `npm ci && npm run build`, start `npm run start`.
- Configurar Vercel con root `frontend`, build `npm run build`, output `dist`.
- Configurar CORS en Render con la URL final de Vercel.
- Mantener `.env` fuera de Git; usar solo `.env.example` y `.env.production.example`.
- Validar `/health`, login/demo auth, CRUD principal y refresh directo de `/home`.

## Supabase

1. Crea un proyecto Supabase.
2. Copia la cadena pooled para `DATABASE_URL`.
3. Copia la cadena directa/session para `DIRECT_URL`.
4. Asegura SSL en la cadena directa, por ejemplo `sslmode=require`.
5. Desde `backend`, ejecuta migraciones:

```bash
npm ci
npm run prisma:generate
npm run prisma:deploy
```

Para cargar datos demo:

```bash
npm run prisma:seed
```

## Desarrollo local antes del despliegue

La aplicacion puede probarse localmente con PostgreSQL local o con Supabase remoto.

Para PostgreSQL local en puerto `5432`, usa como referencia:

- `backend/.env.local.example`

Para PostgreSQL local en puerto `5433`, usa como referencia:

- `backend/.env.local.5433.example`

El archivo local `backend/.env` ya esta preparado para `localhost:5433` y queda ignorado por Git. Si tu usuario, clave o nombre de base cambia, ajusta:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/app_gestion_demo?schema=public"
DIRECT_URL="postgresql://postgres:postgres@localhost:5433/app_gestion_demo?schema=public"
```

Si prefieres usar Supabase desde local, reemplaza esas dos variables por las cadenas de Supabase y conserva:

```env
AUTH_ENABLED=false
AUTH_DEMO_BYPASS=true
CORS_ORIGIN=http://localhost:5173
```

Flujo local recomendado:

```bash
cd backend
npm ci
npm run prisma:deploy
npm run prisma:seed
npm run dev
```

En otra terminal:

```bash
cd frontend
npm ci
npm run dev
```

Luego abre:

- `http://localhost:5173/home`
- `http://localhost:4000/health`

## Render backend

Configuracion manual equivalente a `render.yaml`:

| Campo | Valor |
| --- | --- |
| Type | Web Service |
| Root Directory | `backend` |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm run start` |
| Health Check Path | `/health` |
| Plan | Free |

Variables minimas para demo:

```env
NODE_ENV=production
CORS_ORIGIN=https://your-frontend-name.vercel.app
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...
AUTH_ENABLED=false
AUTH_DEMO_BYPASS=true
ADMIN_EMAIL=admin@yourcompany.com
```

Para auth real con Microsoft Entra:

```env
AUTH_ENABLED=true
AUTH_DEMO_BYPASS=false
AZURE_AD_TENANT_ID=<tenant-id>
AZURE_AD_AUDIENCE=api://<backend-app-id-uri-or-client-id>
```

## Vercel frontend

| Campo | Valor |
| --- | --- |
| Root Directory | `frontend` |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist` |

Variables minimas para demo:

```env
VITE_API_URL=https://your-backend-name.onrender.com
VITE_FORCE_LOCAL_AUTH=true
VITE_AZURE_TENANT_ID=<entra-tenant-id>
VITE_AZURE_CLIENT_ID=<entra-app-client-id>
VITE_AZURE_REDIRECT_URI=https://your-frontend-name.vercel.app
VITE_AZURE_API_SCOPE=api://<backend-app-id-uri-or-client-id>/access_as_user
```

## Validacion post despliegue

1. Abre `https://your-backend-name.onrender.com/health`.
2. Confirma `ok: true` y `database: "up"`.
3. Abre `https://your-frontend-name.vercel.app/home`.
4. Revisa que no existan errores CORS en consola.
5. Crea un proyecto, consultor, gasto y forecast.
6. Ejecuta smoke test contra Render:

```bash
API_BASE_URL=https://your-backend-name.onrender.com npm run smoke
```

Si el backend tiene auth real activada:

```bash
SMOKE_BEARER_TOKEN=<access-token> API_BASE_URL=https://your-backend-name.onrender.com npm run smoke
```

## Riesgos conocidos de planes free

- Render Free puede dormir el backend despues de inactividad, causando cold starts.
- Supabase Free tiene limites de almacenamiento/egress y puede pausar proyectos inactivos.
- Vercel Hobby es adecuado para demo, pero no para uso comercial/produccion formal.
