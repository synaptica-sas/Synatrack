# Plan de migración de Synatrack a Azure

> Estado: herramientas listas en la rama `migracion-azure` (sin desplegar). Fecha: 2026-11-09.
> Operación paso a paso: [`infra/README.md`](../../infra/README.md). Cambios de código:
> [`PREPARACION.md`](PREPARACION.md).
>
> Los pasos indican el **rol** que los ejecuta (README §1): *Administrador de Azure* (Owner de la
> suscripción, corre `bootstrap`), *Administrador de Entra* (TI), *Operador* (miembro del grupo
> `OperatorsGroup`) y *Administrador del repositorio*. La plataforma la operan al
> menos dos personas de Synaptica; ningún paso depende de una cuenta personal.

## Situación de partida

| Pieza | Hoy | Destino |
|---|---|---|
| Frontend prod | **Vercel** (`synatrack.synaptica.co` resuelve a Vercel; el bundle se construye con `VITE_API_URL=https://synatrack.onrender.com`) | Static Web App nueva en `rg-synatrack-prod` |
| Backend prod | Render (Web Service + crons `app-gestion-fx-sync` y `app-gestion-jobs`) | App Service Linux B1 |
| Base prod | Supabase (Postgres, pooler) | Azure Database for PostgreSQL Flexible Server 16 |
| SWA `victorious-glacier-0d52b010f` | la despliega el workflow existente en cada push a `main`, **sin `VITE_API_URL`**; no sirve producción | candidata a retirar tras el corte |
| Stage | no existe | `rg-synatrack-stage`, rama `dev` |

---

## Fases

### Fase 1 — Stage en Azure

1. *Administrador de Entra*: crear el grupo de seguridad de operadores y agregar a los operadores.
2. *Administrador de Azure*: `login` → `bootstrap -Env stage` (README §3.3).
3. *Operador*: `plan` → `infra -Env stage`; cargar los secretos que apliquen con `secret-sync` (o `secret-set` uno a uno)
   (SMTP, webhooks de Teams, tokens).
4. *Administrador de Entra*: registrar el hostname de la SWA de stage como *SPA redirect URI*.
5. *Administrador del repositorio*: fusionar `migracion-azure` en `dev`; crear
   `AZURE_DEPLOY_ENABLED=true`.
6. El push a `dev` despliega backend y frontend; `migrate deploy` crea el esquema vacío.
7. *Operador*: `health -Env stage` en verde; las 3 ubicaciones de la prueba de disponibilidad en
   verde; `access -Env stage` muestra al grupo con sus 3 roles.
8. Un **segundo operador** completa el alta (README §9) y corre `plan -Env stage` desde su PC: así
   se comprueba que nada depende de la cuenta de quien preparó el entorno.

**Sale cuando**: `/health` 200 con `database: up`, la SWA carga y el login con Microsoft llega al
backend.

### Fase 2 — Validación de login Entra y datos en stage

- Login con usuarios reales de cada rol (ADMIN, PM, CONSULTANT, FINANCE, VIEWER, COMMERCIAL): el JIT
  provisioning crea el `User` y, para consultores, su `Consultant`.
- Confirmar que la claim `aud` real está en `AZURE_AD_AUDIENCE` (por defecto
  `api://<AppClientId>,<AppClientId>`; si todo devuelve 401, es esto).
- Si se activa `fxSyncInCycle` (hoy `false`: tasas solo a demanda), confirmar: `fx-sync` en
  `jobs.trabajos[]` de `/health` pasa a `ok` en ≤ 1 día.
- Recargar una ruta profunda (p. ej. `/portafolio`) en la SWA: debe cargar la app
  (`frontend/public/staticwebapp.config.json`, `navigationFallback`).
- Confirmar CORS desde la SWA, rate limit por IP real (`TRUST_PROXY=1`; en `AuditLog.ipAddress` debe
  verse la IP pública) y que los trabajos (`jobs.trabajos[]` en `/health`) pasan a `ok` en ≤ 1 h.
- Envío de correo SMTP y webhooks de Teams desde stage (usar destinatarios de prueba).
- Alertas: provocar un 5xx o detener el Web App unos minutos y comprobar que llega el correo.

### Fase 3 — Ensayo de migración de datos Supabase → stage

Objetivo: medir tiempos y validar el procedimiento que se repetirá en el corte.

```bash
# 1) Operador: abrir el firewall de stage para la IP del equipo que corre el ensayo
#    (y cerrarlo al terminar con firewall-rule delete)
az postgres flexible-server firewall-rule create -g rg-synatrack-stage --name <psql-stage> \
  --rule-name ensayo-migracion --start-ip-address <ip-del-equipo> --end-ip-address <ip-del-equipo>

# 2) Dump SOLO del esquema public de Supabase, por la conexión DIRECTA (puerto 5432, no el pooler)
pg_dump "$SUPABASE_DIRECT_URL" --schema=public --format=custom --no-owner --no-privileges \
  --file synatrack-public.dump

# 3) Restaurar en stage sobre una base vacía (si el deploy ya migró, recrear la base o el esquema)
pg_restore --dbname "$STAGE_DATABASE_URL" --no-owner --no-privileges --clean --if-exists \
  --single-transaction synatrack-public.dump

# 4) Comprobar: conteos por tabla en origen y destino, y que _prisma_migrations está al día
psql "$STAGE_DATABASE_URL" -c "select count(*) from _prisma_migrations where finished_at is not null"
```

- Usar `pg_dump`/`pg_restore` **17.x** (origen Supabase PG 17.11, destino PG17).
- `--schema=public` evita los esquemas propios de Supabase (`auth`, `storage`, `realtime`,
  `extensions`...). La app no usa extensiones (no hay `CREATE EXTENSION` en las migraciones).
- `--no-owner --no-privileges`: los roles de Supabase (`postgres`, `authenticated`, `anon`) no existen
  en Azure; todo queda a nombre de `synatrack_admin`.
- Antes del dump, Supabase debe tener **todas** las migraciones aplicadas (PREPARACION.md §5; CLAUDE.md
  §7.1 avisa de que `20260915164644_sync_schema_drift` estaba pendiente allá).
- Tras restaurar: `prisma migrate deploy` desde el pipeline no debe encontrar nada pendiente.
- Registrar el tiempo total (dump + restore + verificación): define la ventana del corte.
- El ensayo lo hace un operador y lo verifica otro (conteos, login), igual que en el corte.
- Borrar el `.dump` al terminar: contiene datos personales y tarifas.

### Fase 4 — Corte a producción

**Antes (días previos)**

- [ ] *Administrador de Azure*: `bootstrap -Env prod`. *Operador*: `infra -Env prod` y secretos
      de prod cargados.
- [ ] *Operador*: `access -Env prod` muestra que solo la rama `main` puede desplegar a prod
      (GitHub Free: no hay aprobación de despliegues; la revisión es del PR antes del merge).
- [ ] Hostname `*.azurestaticapps.net` de la SWA de prod y `https://synatrack.synaptica.co`
      registrados como *SPA redirect URI* en Entra.
- [ ] Primer deploy del backend a prod (push a `main` con `AZURE_DEPLOY_ENABLED=true`): crea el
      esquema vacío; `health -Env prod` en verde.
- [ ] Desplegar el frontend de prod a la SWA **sin mover el DNS**: `AZURE_FRONTEND_PROD_ENABLED=true`
      y `deploy -Env prod -App frontend`. Probar el login entrando por el hostname de Azure (el CORS
      del backend ya lo admite).
- [ ] En la SWA de prod: *Custom domains* > agregar `synatrack.synaptica.co`. Azure pide un
      registro TXT de validación (o valida con el propio CNAME): crear el TXT ahora, **sin tocar
      todavía el CNAME**. Bajar el TTL del CNAME actual a 300 s con al menos un día de antelación.
- [ ] Ensayo de la fase 3 hecho y cronometrado.
- [ ] Aviso a los usuarios de la ventana.
- [ ] Asignar los roles de la ventana: un operador ejecuta y otro verifica cada paso (sin
      aprobación en GitHub, la verificación cruzada es un acuerdo del equipo).

**Ventana**

1. Congelar escrituras: **suspender el Web Service** en Render y apagar sus dos crons.
2. `pg_dump` de Supabase (conexión directa, `--schema=public`).
3. `pg_restore` en prod Azure (con `--clean --if-exists`: el esquema vacío del primer deploy se
   reemplaza). El operador abre y cierra la regla de firewall de la IP de su equipo.
4. `deploy -Env prod -App backend` (aplica migraciones pendientes si las hubiera y reinicia).
5. Verificar: `health -Env prod`, conteos por tabla contra Supabase, login de un ADMIN y de un
   CONSULTANT, una carga de horas de prueba (y borrarla).
6. **DNS**: cambiar el CNAME de `synatrack.synaptica.co` de Vercel al hostname de la SWA de prod.
   Esperar a que la SWA emita el certificado (minutos) y comprobar `https://synatrack.synaptica.co`.
7. Desactivar los despliegues automáticos de producción en Vercel (o desconectar el proyecto del
   repositorio) para que un push a `main` no lo vuelva a publicar.
8. Vigilar `health` y las alertas durante las primeras horas.

**Rollback del corte** (si algo falla antes de dar por buena la migración)

1. Volver el CNAME de `synatrack.synaptica.co` a Vercel (con TTL 300 el efecto es en minutos).
2. Reanudar el Web Service y los crons de Render (siguen apuntando a Supabase, que no se tocó).
3. Las escrituras hechas en Azure durante la ventana se pierden salvo que se copien a mano: por eso
   la verificación del paso 5 se hace **antes** de mover el DNS y la ventana se mantiene corta.

### Fase 5 — Retiro de Render y Supabase

Tras 2-4 semanas estables:

- Último `pg_dump` completo de Supabase, guardado cifrado fuera del repositorio (retención según
  política de la empresa); después pausar y borrar el proyecto de Supabase.
- Borrar el Web Service y los crons de Render; retirar `render.yaml`.
- Retirar Vercel (`frontend/vercel.json`) y su proyecto.
- Retirar la SWA `victorious-glacier-0d52b010f` y su workflow
  `azure-static-web-apps-victorious-glacier-0d52b010f.yml` (y el secreto
  `AZURE_STATIC_WEB_APPS_API_TOKEN_VICTORIOUS_GLACIER_0D52B010F` de GitHub).
- Actualizar `documentacion/DESPLIEGUE.md` y CLAUDE.md §6.

---

## Decisiones tomadas y por qué

| Decisión | Motivo |
|---|---|
| Dos entornos, un resource group cada uno (`stage` ← `dev`, `prod` ← `main`), East US 2 | aislamiento de permisos y costos; la identidad del pipeline de stage no puede tocar prod. East US 2 tiene todos los servicios (incluida SWA) y buena latencia a Colombia. |
| Postgres con **acceso público + firewall** (IPs salientes posibles del App Service) y `require_secure_transport=ON` | lo más simple y barato para empezar; sin VNet no hace falta subir de plan ni pagar private endpoints. TLS obligatorio y contraseña de 32 caracteres en Key Vault. |
| **Sin deployment slots** (plan B1) | B1 no los tiene; S1 los tendría por ~5x el costo. Rollback = redesplegar un commit anterior con `workflow_dispatch` + `ref`. Se acepta un reinicio de segundos por despliegue. |
| **Sin "linked backend"** de Static Web Apps; el frontend llama directo al App Service con CORS | la app manda su propio `Authorization: Bearer <JWT de Entra>`. Con un backend enlazado, SWA se interpone en `/api` y gestiona ese encabezado con su propia autenticación, rompiendo la validación del token en el backend. Además el enlace exige SWA Standard. |
| Secretos en **Key Vault (RBAC)** + referencias `@Microsoft.KeyVault(...)` + identidad administrada del Web App | ningún secreto en App Settings en claro ni en GitHub; rotación sin redeploy. |
| Pipeline con **OIDC** (credencial federada) | sin secretos de Azure en GitHub. |
| Trabajos periódicos **en proceso** (`JOBS_INTERVAL_MINUTES=60`; `FX_SYNC_IN_CYCLE` hoy `false`, tasas a demanda) | con Always On el proceso no se duerme (el motivo de los crons externos de Render era el plan free). El ciclo tiene candado anti-solapamiento en `JobRun` y puede incluir la sincronización FX diaria si se activa `fxSyncInCycle`. |
| Operación por **grupo de seguridad** (`OperatorsGroup`), no por personas | lo operan al menos dos personas; altas y bajas se hacen en Entra sin tocar Azure RBAC. Los operadores tienen solo Contributor + Key Vault Secrets Officer + RBAC Administrator condicionado sobre su resource group; `bootstrap` queda para el Owner de la suscripción. |
| Prod **sin aprobación** de despliegues (GitHub Free, repo privado) y **OIDC por rama** | GitHub Free no ofrece revisores ni variables por Environment en repos privados. La identidad de prod solo confía en `main` y la de stage en `dev`; la revisión cruzada se hace en el PR antes del merge. Si se necesita aprobación formal: GitHub Enterprise o Azure Pipelines (gratis hasta 5 usuarios, con approvals). |
| Migraciones en el pipeline, antes de publicar, con firewall temporal | el arranque no migra (`node dist/server.js`), así un fallo de migración no deja el sitio caído en bucle de reinicios. |
| La contraseña de Postgres se genera una vez y se relee de Key Vault | no cambia en cada despliegue, no queda en disco ni en el historial. |
| Solo se referencian los secretos opcionales que existen | una referencia rota deja el texto literal en la variable; para un token sería un valor público. |

## Costos mensuales estimados por entorno

> **Estimación a confirmar en la [calculadora de Azure](https://azure.microsoft.com/pricing/calculator/)**:
> precios de lista en USD para East US 2, sin impuestos ni descuentos, con poco tráfico.

| Recurso | stage | prod | Nota |
|---|---|---|---|
| App Service Plan B1 Linux | ~13 | ~13 | |
| Postgres Flexible B1ms + 32 GB | ~16 | ~16 | ~12 de cómputo + ~4 de almacenamiento; backups hasta el tamaño aprovisionado sin costo extra |
| Prueba de disponibilidad estándar (3 ubic. × cada 5 min ≈ 26 000 ejecuciones) | ~30 (?) | ~30 (?) | **El rubro más incierto**: las pruebas estándar se cobran por ejecución. Si se confirma, bajar stage a 900 s (`availabilityFrequencySeconds`) |
| Log Analytics / App Insights | ~0-5 | ~2-8 | por GB ingerido; prod retiene 90 días |
| Key Vault | < 1 | < 1 | por operaciones |
| Static Web App Free | 0 | 0 | Standard: ~9 si se quiere SLA |
| Alertas métricas (5 reglas) | ~0.5 | ~0.5 | |
| **Total aproximado** | **~60** | **~65** | **~35 c/u sin la prueba de disponibilidad** |

El presupuesto del resource group (`MonthlyBudgetUsd`) avisa al 80 % y al 100 % real y al 100 %
previsto.

## Cómo pasar a red privada después

Pensado para que sea un cambio acotado:

1. **App Service**: subir el plan a uno con integración de VNet (B1 ya la admite) y agregar
   `virtualNetworkSubnetId` al Web App con `vnetRouteAllEnabled`.
2. **Postgres**: Flexible Server **no** cambia de acceso público a "VNet integrada" en caliente. Dos
   caminos:
   - *Private endpoint* sobre el mismo servidor (admitido en servidores con acceso público): crear
     el endpoint + zona DNS privada `privatelink.postgres.database.azure.com`, y luego
     `publicNetworkAccess: 'Disabled'`. Es el camino recomendado: no hay que migrar datos.
   - O crear un servidor nuevo con *delegated subnet* y restaurar (PITR o dump).
3. **Key Vault**: private endpoint + `publicNetworkAccess: 'Disabled'` (o reglas de red con
   `bypass: AzureServices`).
4. **Pipeline**: con la base privada, el runner hospedado de GitHub ya no llega para `migrate deploy`.
   Opciones: runner autohospedado dentro de la VNet, o mover las migraciones a un paso que corra en
   el App Service (comando de arranque previo) o en un Container Apps Job.
5. Quitar `postgres-firewall.bicep` y los pasos de firewall del workflow.

## Riesgos abiertos

| Riesgo | Mitigación |
|---|---|
| La claim `aud` del token no está en `AZURE_AD_AUDIENCE` → todos los logins dan 401 | el backend acepta una lista; por defecto se configuran `api://<AppClientId>` y `<AppClientId>` (v1 y v2). Validar en la fase 2. |
| Tasas FX a demanda (`fxSyncInCycle = false`): si nadie pulsa "Actualizar ahora", las tasas envejecen | decisión de negocio por ahora; para automatizarlas basta `fxSyncInCycle = true` y `infra`. |
| Un solo operador con conocimiento real de la plataforma | alta del segundo operador en la fase 1 (README §9) y ensayo/corte con un operador que ejecuta y otro que verifica. |
| Un operador que deja la empresa conserva acceso | baja = quitarlo del grupo y del repositorio (README §9); `access` para auditar periódicamente. |
| `workflow_dispatch` solo existe cuando el workflow está en `main` | los primeros despliegues de stage salen de pushes a `dev`; rollback por dispatch disponible tras fusionar en `main`. |
| Migraciones solo hacia adelante; un rollback de código no revierte el esquema | migraciones compatibles hacia atrás; ante daño de datos, *point-in-time restore* de Postgres (7 días stage / 14 prod) a un servidor nuevo. |
| Despliegue sin slots: reinicio breve en cada deploy | aceptado (B1); si molesta, pasar a S1 con slot de staging. |
| Auto-instrumentación de App Insights limitada en ESM | las solicitudes HTTP y métricas de plataforma llegan igual; si se necesita más detalle, instrumentar en código con la connection string ya presente. |
| Reglas de firewall: el modo incremental no borra IPs que el App Service ya no usa | revisar tras cambios de plan (`status` las cuenta). |
| Costos de la prueba de disponibilidad | confirmar en la calculadora; bajar frecuencia en stage. |
| Credenciales básicas de SCM deshabilitadas | `azure/webapps-deploy@v3` publica con el token de Entra; si diera 401, revisar que el login OIDC funcionó antes de reactivar credenciales básicas. |
