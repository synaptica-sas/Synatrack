# Despliegue

Todo lo relativo a poner Synatrack en producción: la topología, el procedimiento para llevar
`dev` a producción y la configuración de cada servicio.

**Los comandos de la sección 2 se ensayaron contra una base limpia antes de escribirlos.**

Para levantar el entorno **local**, este no es el documento: ver `DESARROLLO_LOCAL.md`.

> Este archivo absorbió al antiguo `DEPLOYMENT.md`, que se eliminó. Si encuentras esa
> referencia en documentos históricos (el backlog o las notas de cambio), apunta aquí.

---

## 1. Topología

| Pieza | Dónde | Notas |
|---|---|---|
| Frontend | **Vercel**, carpeta `frontend` | URL pública de la demo |
| Frontend (segundo destino) | **Azure Static Web Apps** | Se despliega desde GitHub Actions en cada push y PR contra `main` |
| Backend | **Render** Web Service, carpeta `backend` | `runtime: node`, **no** usa el Dockerfile |
| Base de datos | **Supabase** PostgreSQL | |
| Tareas periódicas | Dos **Render Cron Jobs** | Tasas de cambio y mantenimiento |

Los `Dockerfile` del repositorio solo los usa `docker-compose.yml`, que es una alternativa de
desarrollo local. Render compila con `npm`, así que un cambio en esos archivos **no afecta a
producción**.

### Ramas

- `main`: la rama que mira producción.
- `dev`: donde se integra el trabajo.
- Ramas `fix/*`, `feat/*` y `docs/*` de trabajo.

**Al 30/09/2026 `main` y `dev` están idénticas** (`3300eb5`), con los 69 cambios acumulados
desde la versión del 2 de septiembre que **sigue siendo la que se ejecuta en producción**. Es
decir: las ramas ya están fusionadas, pero **el despliegue todavía no se ha hecho**.

**No hay un flujo de promoción acordado** entre ramas, y **la rama que Render y Vercel tienen
conectada no está declarada en el repositorio** (`render.yaml` no fija `branch`): hay que
confirmarla en el panel de cada servicio antes de asumir que un merge libera la demo.

Lo único automatizado es el workflow de Azure Static Web Apps. Cuando se acuerde un flujo
formal, este es el sitio donde documentarlo.

---

## 2. Llevar `dev` a producción

> ### 🔴 Dos cosas que hay que hacer sí o sí en este despliegue
>
> **1. Cerrar la base de Supabase.** Hoy no tiene seguridad por filas en ninguna de sus 28 tablas
> y los roles públicos `anon` y `authenticated` tienen todos los permisos, así que la API REST
> automática de Supabase expone sueldos, tarifas y documentos de identidad a cualquiera que tenga
> la clave pública. Detalle y arreglo en
> `documentacion/Base de Datos/comparacion_supabase_2026-10-05.md` §3.
>
> **2. Añadir `prisma migrate deploy` al arranque en Render.** Hoy el servicio arranca con
> `npm run start` y **nunca aplica migraciones**. Ésa es la razón de fondo por la que Supabase
> lleva semanas atrasada: si no se corrige, el próximo despliegue volverá a dejarla atrás.


> ### ⚠ El orden importa: primero la base, después el backend, después el frontend
>
> El workflow de Azure Static Web Apps **despliega el frontend en cada push a `main`**, sin
> esperar a nada más. Como `main` ya se movió, es posible que el frontend nuevo ya esté
> publicado contra el backend viejo.
>
> Eso rompe de forma visible **Horas → Aprobaciones** y **Horas Extra → Historial**: el frontend
> nuevo espera `{ data, meta }` de los listados paginados y el backend viejo devuelve solo la
> lista. Si alguien reporta esas dos pantallas rotas antes de completar el despliegue, **ésta es
> la causa y se arregla desplegando el backend**, no tocando el frontend.
>
> El orden correcto es: **1)** rehacer la base (§2.3), **2)** cargar las tasas (§2.4),
> **3)** desplegar el backend en Render, **4)** comprobar (§4). El frontend ya va solo.
>
> **Desde el 06/10 hay un motivo más para ese orden**: `GET /api/expenses` cambió de contrato
> —ahora devuelve cada gasto ya convertido por el servidor—, así que el frontend nuevo **no
> funciona contra el backend viejo**. La pantalla de Gastos saldría sin importes convertidos.

### 2.1 Por qué hay que rehacer la base de Supabase

La base que está funcionando **no se construyó con las migraciones de este repositorio**. El
proyecto arrancó desplegando en Railway y el esquema se fue aplicando con `prisma db push`
—hay commits usando `--accept-data-loss`—, y la primera migración formal no aparece hasta
siete semanas después.

Consecuencia: su tabla `_prisma_migrations` no coincide con nuestra carpeta. Al correr
`prisma migrate deploy`, Prisma la trata como base nueva, intenta crear `Project`, se topa
con que ya existe y **falla**. Es también la raíz del drift de esquema que se corrigió en su
momento.

**Decisión tomada: rehacerla**, porque lo que hay en producción son datos de prueba.

> **Si algún día hubiera datos reales, no repitas este procedimiento.** El camino sería
> `prisma migrate diff --from-url <supabase> --to-schema-datamodel prisma/schema.prisma`
> (solo lectura) para ver la diferencia real, y luego `prisma migrate resolve --applied`
> migración por migración, conservando los datos.

### 2.2 Antes de empezar

- [ ] Avisar al equipo de que la base se va a vaciar.
- [ ] Respaldo, aunque sean datos de prueba: *Database → Backups* en Supabase, o `pg_dump`.
- [ ] Tener a mano la **cadena directa** (`DIRECT_URL`, puerto 5432), no la del pooler. Las
      migraciones necesitan la directa.

**Migraciones que aún no están en Supabase.** Como aquí la base se rehace desde cero, la cadena
completa se aplica sola en §2.3 y no hay que hacer nada extra. Se listan porque son las que
faltaban respecto a producción, y porque si alguien decidiera **no** rehacer la base tendría que
aplicarlas a mano:

| Migración | Qué trae |
|---|---|
| `20260918120000_fix_schema_drift` | `CustomHoliday`, `ApprovalDelegation`, campos de `Consultant`, `ExtraHoursConfig.country`, `User.country` |
| `20260922110000_add_timesheet_and_tracker` | Timesheet y cronómetro |
| `20260922120000_time_entry_hours_precision` | Precisión en segundos del cronómetro |
| `20260929143000_add_job_run_observability` | `JobRun`, el rastro de los trabajos periódicos (§4) |

Las cuatro son idempotentes y solo crean, así que aplicarlas sobre una base que ya las tenga es
seguro. **Sin la última, el bloque `jobs` de `/health` no sirve de nada.**

### 2.3 Rehacer la base

Desde `backend/`, con `DATABASE_URL` y `DIRECT_URL` apuntando a Supabase:

```bash
npm ci
npm run prisma:generate

# 1. Vaciar el esquema público
npx prisma migrate reset --force --skip-seed

# 2. Aplicar toda la cadena de migraciones
npx prisma migrate deploy

# 3. Comprobar que el esquema real coincide con schema.prisma
npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code
```

El paso 2 debe reportar **8 migraciones aplicadas** y el paso 3 debe decir
**"No difference detected"**. Si el paso 3 dice otra cosa, **detente**: el esquema quedó
distinto de lo que el código espera y fallará en runtime, no al arrancar.

```bash
# 4. Sembrar roles y usuario administrador
ADMIN_EMAIL=<correo-del-admin> npm run prisma:seed
```

El seed crea los 5 roles y **un** usuario administrador. **No carga datos de demostración**:
la base queda sin proyectos, consultores ni horas.

### 2.4 Cargar las tasas de cambio — no te lo saltes

El seed deja **cero tasas**, y sin ellas no hay nada que convertir.

Esto ya no falla en silencio: desde que se corrigió DEP-32, un total que no se pudo convertir
del todo llega marcado y la interfaz lo avisa en pantalla con el rótulo **"Cifras aproximadas"**
y un atajo a *Tasas FX*. O sea que **con la base recién creada la aplicación se va a quejar en
casi todas las pantallas hasta que cargues las tasas**. Es el comportamiento correcto, no un
fallo del despliegue, pero conviene saberlo antes de que alguien lo reporte como tal.

Ojo además: una sincronización que deje monedas sin tasa (`failed` no vacío) se registra como
**no correcta** en la frescura de trabajos (§4). No basta con que el `curl` devuelva 200: hay
que comprobar que `failed` venga vacío.

Con el backend ya desplegado:

```bash
curl -X POST https://app-gestion-demo.onrender.com/api/fx/sync \
  -H "Authorization: Bearer $FX_SYNC_TOKEN"
```

Respuesta esperada, verificada:
`{"data":{"updated":["COP","EUR","MXN","PEN","CLP"],"failed":[]}}`

---

## 3. Configuración de los servicios

### 3.1 Render — backend

Equivalente manual de `render.yaml`:

| Campo | Valor |
|---|---|
| Type | Web Service |
| Root Directory | `backend` |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm run start` |
| Health Check Path | `/health` |
| Plan | Free |

Variables de entorno:

| Variable | Valor | Nota |
|---|---|---|
| `NODE_ENV` | `production` | |
| `NODE_VERSION` | `24.13.0` | Antes era 20.19.0 |
| `CORS_ORIGIN` | la URL de Vercel | |
| `DATABASE_URL` | cadena **pooled** de Supabase | |
| `DIRECT_URL` | cadena **directa** de Supabase, con `sslmode=require` | |
| `ADMIN_EMAIL` | correo del administrador | Recibe rol ADMIN automáticamente |
| `FX_SYNC_TOKEN` | valor aleatorio largo | El mismo en el Web Service y en su cron |
| `JOBS_RUN_TOKEN` | valor aleatorio largo | **Nueva.** Ídem, para el cron de mantenimiento |
| `JOBS_INTERVAL_MINUTES` | `0` | Apagado: en Render el servicio duerme y es el cron quien despierta |
| `AUTH_DEV_EMAIL` | **no debe existir** | Simulador de rol |
| `AUTH_DEV_ROLES` | **no debe existir** | Simulador de rol |
| `AUTH_DEV_ROLE_HEADER` | **no debe existir** | Simulador de rol |

Las tres `AUTH_DEV_*` permiten entrar como cualquier rol sin autenticarse. Están apagadas por
defecto y protegidas por tres cerrojos —uno exige que `NODE_ENV` no sea `production`—, pero
**no deben estar definidas en producción**. Si alguna quedara activa, el log de arranque lo
advierte en mayúsculas.

Modo demo (entra como ADMIN sin login):

```env
AUTH_ENABLED=false
AUTH_DEMO_BYPASS=true
```

Autenticación real con Microsoft Entra ID:

```env
AUTH_ENABLED=true
AUTH_DEMO_BYPASS=false
AZURE_AD_TENANT_ID=<tenant-id>
AZURE_AD_AUDIENCE=api://<backend-app-id-uri-or-client-id>
```

### 3.2 Vercel — frontend

| Campo | Valor |
|---|---|
| Root Directory | `frontend` |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist` |

```env
VITE_API_URL=https://app-gestion-demo.onrender.com
VITE_FORCE_LOCAL_AUTH=true
VITE_AZURE_TENANT_ID=<entra-tenant-id>
VITE_AZURE_CLIENT_ID=<entra-app-client-id>
VITE_AZURE_REDIRECT_URI=https://<dominio-vercel>
VITE_AZURE_API_SCOPE=api://<backend-app-id-uri-or-client-id>/access_as_user
```

`frontend/vercel.json` además reescribe `/api/*` hacia el backend. Ese host está
**hardcodeado**: si el servicio de Render cambia de nombre, hay que actualizarlo ahí.

### 3.3 Cron jobs

`render.yaml` declara dos. Si el *Blueprint sync* no los aplica solo, créalos a mano:

| Nombre | Cadencia | Comando |
|---|---|---|
| `app-gestion-fx-sync` | `0 13 * * *` (08:00 Colombia) | `curl -sf -X POST https://app-gestion-demo.onrender.com/api/fx/sync -H "Authorization: Bearer $FX_SYNC_TOKEN"` |
| `app-gestion-jobs` | `0 * * * *` (cada hora) | `curl -sf -X POST https://app-gestion-demo.onrender.com/api/jobs/run -H "Authorization: Bearer $JOBS_RUN_TOKEN"` |

Ambos requieren plan `starter`: el plan free no tiene cron jobs.

**Ahora se puede comprobar que existen sin entrar al panel de Render.** `GET /health` publica la
frescura de cada trabajo (§4). Si pasada una hora `assignment-maintenance` y `alert-engine`
siguen en `nunca`, el cron `app-gestion-jobs` no se creó; si pasado un día `fx-sync` sigue en
`nunca`, no se creó el de FX. En `obsoleto` significa que existen pero dejaron de correr.

**Ojo con el host.** El cron de FX apuntaba a `app-gestion-backend.onrender.com`, que **no
existe** —se comprobó que no responde en 150 segundos, mientras `app-gestion-demo` devuelve
200—, y por eso la sincronización de tasas nunca funcionó. El `name` del servicio en
`render.yaml` sigue diciendo `app-gestion-backend`, pero la URL pública real es
`app-gestion-demo`. **No cambies el `name`**: en Render el subdominio se fija al crear el
servicio, y renombrarlo en un blueprint crea uno nuevo sin las variables marcadas
`sync: false`.

---

## 4. Verificación después de desplegar

```bash
# La aplicación responde y ve la base
curl https://app-gestion-demo.onrender.com/health
# Esperado: {"ok":true,"database":"up",...}

# El planificador quedó bien configurado
curl -H "Authorization: Bearer $JOBS_RUN_TOKEN" \
  https://app-gestion-demo.onrender.com/api/jobs/status
# Esperado: tokenConfigurado: true

# Los trabajos periódicos están vivos (bloque `jobs` del health)
curl https://app-gestion-demo.onrender.com/health
# Recién desplegado los tres saldrán en `nunca`: es lo esperado.
# Vuelve a mirarlo pasada una hora (ciclo) y al día siguiente (FX).
# Si siguen en `nunca`, los cron jobs no se crearon: volver a §3.3.

# Prueba de humo end-to-end
API_BASE_URL=https://app-gestion-demo.onrender.com npm run smoke
# Con autenticación real, añade SMOKE_BEARER_TOKEN=<access-token>
```

Y en la interfaz, entrando con una cuenta real:

- [ ] Sin errores de CORS en la consola del navegador.
- [ ] El tablero muestra importes con la moneda correcta. Si salen cifras enormes en dólares,
      faltan las tasas: volver a §2.4.
- [ ] Entrar directo a una URL como `/projects` deja al usuario ahí, no en el tablero.
- [ ] Crear un proyecto asignando **Project Manager** y **umbral de margen**: son campos
      nuevos que antes no se podían configurar.
- [ ] Que ese PM pueda aprobar una solicitud de horas extra. Ese flujo **no funcionaba**
      antes, precisamente porque el campo no se podía asignar.
- [ ] `Auditoría` muestra registros de las operaciones que vayas haciendo.

---

## 5. Qué va a cambiar de aspecto

Conviene avisarlo antes, para que nadie piense que algo se rompió:

- **Varios proyectos cambiarán de color.** El semáforo ahora usa el umbral configurado de
  cada proyecto en vez de un 15 % fijo, y el portafolio dejó de contar el forecast dos veces
  (antes sumaba las horas ya ejecutadas como gasto *y* como proyección). Algunos saldrán de
  rojo y otros entrarán en amarillo.
- **Gastos e Ingresos son ahora un solo panel**, sobre la tabla unificada `FinancialEntry`.
- **Un consultor ya solo ve sus propias horas**, y quien no sea ADMIN, PM o FINANCE deja de
  ver las tarifas de la plantilla.
- **Los correos de aprobación registran el correo de quien aprueba**, no su nombre para
  mostrar.
- **La aplicación entera cambia de aspecto.** Se migró al sistema de tokens de diseño: los
  estilos en línea bajaron de 1.162 a 340 y los colores incrustados de 575 a 100. No es un
  rediseño —la paleta de Synaptica es la misma— pero se retiró una segunda paleta de Tailwind
  que se había colado por copiar y pegar, así que **bastantes tonos concretos cambian** y el
  modo oscuro funciona en pantallas donde antes no. Quedan sin migrar Actividades y `App.tsx`.
- **Aparece el aviso "Cifras aproximadas"** cuando falta una tasa de cambio (ver §2.4).
- **Tres listados pasan a estar paginados**: Horas → Aprobaciones, Horas Extra → Historial e
  ingresos/gastos. Muestran 50 filas por página con el total a la vista. Ninguna pantalla pasó
  a mostrar un subconjunto en silencio: lo que necesita el conjunto completo —la rejilla del
  timesheet, los informes, las colas de aprobación, el CSV— lo sigue pidiendo entero.
- **Horas → Aprobaciones estrena filtro por estado** y el de Horas Extra por consultor pasó a
  filtrar en el servidor.

---

## 6. Si algo sale mal

- **Horas → Aprobaciones y Horas Extra → Historial salen vacías o con error**: el frontend está
  desplegado y el backend no. Esas dos pantallas esperan listados paginados (`{ data, meta }`) y
  el backend viejo devuelve una lista suelta. Se arregla desplegando el backend.
- **`migrate deploy` falla**: no insistas ni uses `db push`. Es lo que causó el drift
  original. Si el error es "ya existe", el esquema no quedó vacío en el paso 1.
- **El esquema no coincide en el paso 3**: no despliegues. El código espera columnas que la
  base no tiene y fallará en runtime.
- **Node 24 da problemas en Render**: revertir `NODE_VERSION` a `20.19.0` es una línea. El
  código no usa nada específico de 24.
- **Volver atrás del todo**: `main` no se ha tocado, así que redesplegar desde `main`
  devuelve el código anterior, **pero no la base**. Las migraciones son aditivas salvo la de
  `FinancialEntry`, que borra `Expense` y `RevenueEntry` tras copiar sus datos; el código
  viejo no encontraría esas tablas.

---

## 7. Riesgos de los planes gratuitos

- **Render Free** duerme el backend tras 15 minutos de inactividad: hay cold starts de
  decenas de segundos. Es también la razón de que el planificador dependa de un cron externo
  y no de un temporizador en proceso. Antes de una demo importante, conviene despertarlo.
- **Supabase Free** tiene límites de almacenamiento y de tráfico, y puede pausar proyectos
  inactivos.
- **Vercel Hobby** sirve para demo, no para uso comercial formal.
