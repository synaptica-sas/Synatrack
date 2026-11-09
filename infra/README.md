# Infraestructura de Synatrack en Azure

Guía para los **operadores de Synaptica** que administran la plataforma. Bicep +
`scripts/azure.ps1` + tres workflows de GitHub Actions para correr Synatrack en Azure con dos
entornos aislados:

| Entorno | Rama | Resource group (por defecto) | Frontend |
|---|---|---|---|
| `stage` | `dev` | `rg-synatrack-stage` | hostname `*.azurestaticapps.net` de su SWA |
| `prod` | `main` | `rg-synatrack-prod` | `synatrack.synaptica.co` (se mueve de Vercel a la SWA en el corte) |

Plan de migración, decisiones y costos: [`documentacion/azure/PLAN.md`](../documentacion/azure/PLAN.md).
Cambios de código que hicieron falta: [`documentacion/azure/PREPARACION.md`](../documentacion/azure/PREPARACION.md).

```
infra/
  main.bicep                  # orquesta los módulos (scope: resource group)
  modules/
    monitoring.bicep          # Log Analytics + Application Insights
    postgres.bicep            # Flexible Server PG16 + base synatrack + TLS obligatorio
    postgres-firewall.bicep   # reglas = IPs salientes posibles del App Service
    keyvault.bicep            # Key Vault RBAC + postgres-admin-password + database-url
    keyvault-access.bicep     # "Key Vault Secrets User" para la identidad del Web App
    appservice.bicep          # Plan Linux B1 + Web App Node + App Settings
    staticwebapp.bicep        # Static Web App (sin backend enlazado)
    alerts.bicep              # Action Group, prueba de disponibilidad, alertas, presupuesto
  params/stage.bicepparam     # dimensionamiento de stage
  params/prod.bicepparam      # dimensionamiento de prod
  ci/infra-env.sh             # prepara los parámetros en GitHub Actions
  azure.config.example.psd1   # plantilla de la config (la real NO se versiona)
  .out/<env>.json             # salidas del último `infra` en esa PC (en .gitignore)
```

---

## 1. Roles

La plataforma la opera un equipo, no una persona. Cada tarea de esta guía indica qué rol la hace:

| Rol | Quién | Qué puede hacer |
|---|---|---|
| **Administrador de Azure** | quien sea Owner de la suscripción (normalmente TI) | `bootstrap` (registra proveedores, crea el resource group, la identidad del pipeline y asigna roles). Se usa una vez por entorno y al cambiar permisos. |
| **Administrador de Entra** | TI | crear el grupo de seguridad de operadores y administrar sus miembros; redirect URIs de la app. |
| **Operador** | miembros del grupo `OperatorsGroup` (p. ej. `Synatrack-Operadores`) | todos los demás comandos: `plan`, `infra`, `secret-set`, `deploy`, `rollback`, `status`, `health`, `logs`, `access`. Roles exactos en §8. |
| **Administrador del repositorio** | operadores con rol *Admin* en GitHub | variables y Environments de GitHub (`bootstrap`, `infra` al sincronizar variables, `AZURE_DEPLOY_ENABLED`, revisores). |
| **Revisor de prod** | operadores listados como *Required reviewers* del Environment `prod` | aprobar cada despliegue a producción. Con *Prevent self-review*, nunca el mismo que lo disparó. |

Una misma persona puede tener varios roles, pero conviene que haya **al menos dos revisores de
prod** para que un despliegue a producción siempre lo apruebe alguien distinto de quien lo lanza.

---

## 2. Requisitos

- **Azure CLI** 2.60 o más reciente (`az version`) con Bicep (`az bicep install`).
- **GitHub CLI** (`gh auth login`).
- Windows PowerShell 5.1 o PowerShell 7.
- Para `bootstrap` (Administrador de Azure):
  - **Owner** de la suscripción (o Contributor + User Access Administrator).
  - En Entra ID, poder crear *app registrations* (rol **Application Developer** o superior, o que
    el tenant lo permita a usuarios) y leer grupos.
  - Rol **Admin** en el repositorio de GitHub.

---

## 3. Primera vez (por entorno; empieza por `stage`)

### 3.1 Grupo de operadores (Administrador de Entra)

Crear en Entra ID un **grupo de seguridad** (no de Microsoft 365), por ejemplo
`Synatrack-Operadores`, y agregar a los operadores. El script no lo crea: solo valida que exista y
falla con un mensaje claro si no lo encuentra.

### 3.2 Config

```powershell
Copy-Item infra/azure.config.example.psd1 infra/azure.config.psd1
notepad infra/azure.config.psd1     # TenantId, SubscriptionId, AppClientId, AppApiScope, OperatorsGroup, correos...
```

El archivo no lleva secretos, pero sí identificadores internos: no se versiona. Cada operador tiene
su copia (ver §9).

**`ApiAudience`**: si se omite, el backend acepta `api://<AppClientId>` y `<AppClientId>` (tokens v1
y v2; el backend admite una lista separada por comas). Defínelo solo para restringirlo.

### 3.3 Sesión y bootstrap (Administrador de Azure)

```powershell
.\scripts\azure.ps1 login
.\scripts\azure.ps1 bootstrap -Env stage
```

`bootstrap` es idempotente (se puede repetir). Hace:

1. Valida que exista el grupo `OperatorsGroup` (antes de crear nada).
2. Registra los proveedores `Microsoft.Web`, `DBforPostgreSQL`, `KeyVault`, `Insights`,
   `OperationalInsights`, `AlertsManagement` y `Consumption`.
3. Crea el resource group.
4. Crea (o reutiliza) la identidad del pipeline **`gh-synatrack-<env>`** (app registration +
   service principal, **sin secretos**) con credenciales federadas:
   - `repo:<GitHubRepo>:environment:<env>`: los jobs que declaran `environment: <env>`.
   - `repo:<GitHubRepo>:pull_request`: **solo en stage**, para el what-if de los PR (que corre sin
     environment). Prod no la tiene: si la tuviera, cualquier PR obtendría permisos sobre producción.
5. Asigna a esa identidad, **solo sobre su resource group**:

   | Rol | Para qué |
   |---|---|
   | Contributor | crear y actualizar los recursos del Bicep, desplegar código, reglas de firewall |
   | Key Vault Secrets User | leer `database-url` (migraciones) y `postgres-admin-password` (infra) |
   | Role Based Access Control Administrator **con condición** | el Bicep crea la asignación "Key Vault Secrets User" de la identidad del Web App, y Contributor no puede crear asignaciones de rol. La condición solo permite asignar o quitar **ese** rol y solo a service principals: no puede dar Owner ni darle nada a un usuario o grupo. Es la alternativa de mínimo privilegio a User Access Administrator. |

6. Asigna al **grupo de operadores** los roles de operador sobre el resource group (§8). Si la config
   no define `OperatorsGroup`, se los asigna solo a la cuenta que ejecuta `bootstrap` y avisa de que
   ningún otro operador podrá usar `plan`, `infra` ni `secret-set`.
7. Crea el GitHub Environment `<env>` y carga las variables (§6).

### 3.4 Infraestructura (Operador)

```powershell
.\scripts\azure.ps1 plan  -Env stage     # what-if: no cambia nada
.\scripts\azure.ps1 infra -Env stage     # 10-20 min la primera vez
```

En la primera ejecución `infra` genera la contraseña de Postgres (32 caracteres alfanuméricos) y el
Bicep la guarda en Key Vault como `postgres-admin-password`, junto con `database-url`. En las
siguientes, cualquier operador la relee de Key Vault, así que **no cambia** en cada despliegue y
**nunca toca el disco**: viaja en una variable de entorno del proceso que se borra al terminar.

Las salidas quedan en `infra/.out/<env>.json` **de esa PC** (el script las redescubre en el resource
group si otra PC no las tiene) y se actualizan las variables de GitHub que dependen de ellas. Esto
último requiere rol *Admin* en el repositorio; sin él `infra` despliega igual y avisa de que un
Administrador del repositorio debe repetirlo.

> Si Key Vault avisa de un nombre en uso tras borrar un entorno: el vault quedó en *soft delete*.
> `az keyvault list-deleted` y luego `az keyvault recover` (o `purge` si de verdad sobra; en prod la
> protección contra purga lo impide durante 90 días).

### 3.5 Secretos de la aplicación (Operador)

Ninguno es obligatorio para arrancar. Cada uno se pide oculto (`Read-Host -AsSecureString`) y se
escribe con la API REST de Key Vault: no pasa por argumentos, historial ni disco.

```powershell
.\scripts\azure.ps1 secret-set -Env stage -Name smtp-pass
.\scripts\azure.ps1 secret-set -Env stage -Name teams-feedback-webhook-url
.\scripts\azure.ps1 secret-set -Env stage -Name teams-payroll-webhook-url
.\scripts\azure.ps1 secret-set -Env stage -Name jobs-run-token -Generate   # aleatorio
.\scripts\azure.ps1 secret-set -Env stage -Name fx-sync-token  -Generate   # aleatorio
```

Solo los secretos que **existen** en Key Vault se referencian en los App Settings: una referencia a
un secreto inexistente dejaría en la variable el texto literal `@Microsoft.KeyVault(...)`, que en el
caso de un token sería un valor conocido. `secret-set` agrega la referencia al Web App en el
momento, y el siguiente `infra` la mantiene.

Los valores de los secretos **no se comparten entre operadores por chat ni correo**: viven solo en
Key Vault, y cualquier operador puede rotarlos con `secret-set`.

### 3.6 Entra ID (Administrador de Entra, una vez por entorno)

En el registro de la app del **frontend** (`AppClientId`) > *Authentication* > plataforma
**Single-page application**, agregar como *Redirect URI*:

- stage: `https://<staticWebAppHostname>` (salida `staticWebAppHostname` de `infra`).
- prod: `https://<staticWebAppHostname>` de prod y `https://synatrack.synaptica.co` (este ya existe).

El build no fija `VITE_AZURE_REDIRECT_URI`: MSAL usa `window.location.origin`, así el mismo bundle
sirve en el hostname de Azure y en el dominio propio.

### 3.7 GitHub (Administrador del repositorio)

1. **Revisores de prod**: *Settings > Environments > prod > Required reviewers*: agregar a los
   operadores que aprueban producción (al menos dos).
2. **Activar *Prevent self-review*** en esa misma regla: así un despliegue a producción lo aprueba
   una persona distinta de quien lo disparó (o de quien hizo el push a `main`).
3. Recomendado: *Deployment branches and tags* de `prod` = `main`.
4. **Activar los despliegues**: variable de **repositorio** (no de environment: el `if` del job se
   evalúa antes de cargar el environment):

   ```powershell
   gh variable set AZURE_DEPLOY_ENABLED --body true --repo <GitHubRepo>
   ```

   Mientras no exista, los tres workflows terminan en *skipped* (no en error).

`.\scripts\azure.ps1 access -Env prod` muestra los revisores y si *Prevent self-review* está activo.

### 3.8 Primer despliegue y verificación (Operador)

```powershell
.\scripts\azure.ps1 deploy -Env stage    # backend + frontend
.\scripts\azure.ps1 health -Env stage
.\scripts\azure.ps1 status -Env stage
```

> `workflow_dispatch` (lo que usan `deploy` y `rollback`) solo existe cuando el workflow ya está en
> la rama por defecto (`main`). Mientras los workflows solo estén en `dev`, el primer despliegue de
> stage sale de un **push a `dev`** que toque `backend/` o `frontend/`.

Repetir §3.3–3.8 con `-Env prod` cuando toque (fases en PLAN.md). Hasta el corte, el frontend de
prod NO se publica desde aquí: hace falta además `AZURE_FRONTEND_PROD_ENABLED=true` (§6).

---

## 4. Uso diario (Operador)

| Quiero... | Cómo |
|---|---|
| Publicar en stage | commit/merge a `dev` → `deploy-backend-azure.yml` y/o `deploy-frontend-azure.yml` (según qué carpeta cambió) |
| Publicar en prod | merge de `dev` a `main` → mismos workflows; un Revisor de prod distinto de quien lo disparó aprueba en el Environment `prod` |
| Volver a una versión anterior | `.\scripts\azure.ps1 rollback -Env prod` → elegir el despliegue → redepliega ese SHA con `skip_migrations=true` (también pasa por la aprobación de prod) |
| Desplegar un commit concreto | `.\scripts\azure.ps1 deploy -Env stage -Ref <sha> -App backend` (o `frontend`, `all`) |
| Ver si está vivo | `.\scripts\azure.ps1 health -Env prod` (HTTP, latencia, estado de los jobs, prueba de disponibilidad por ubicación, alertas disparadas) |
| Ver logs en vivo | `.\scripts\azure.ps1 logs -Env prod` |
| Auditar accesos | `.\scripts\azure.ps1 access -Env prod` (roles sobre el resource group, miembros del grupo de operadores, revisores de GitHub) |
| Cambiar infraestructura | PR que toca `infra/**` → el workflow comenta el what-if de stage en el PR → al fusionar, `.\scripts\azure.ps1 infra -Env stage` (o *Actions > Infra Azure > Run workflow*) |
| Rotar un secreto | `secret-set` de nuevo; ofrece reiniciar el Web App para que lo tome ya (si no, App Service lo refresca en ≤ 24 h) |

Toda acción del script que cambia algo en `prod` pide confirmación escribiendo `prod`.

**Sobre el rollback**: no hay slots (plan B1), así que es un despliegue normal de código anterior;
hay unos segundos de reinicio. Las migraciones de Prisma **no se revierten**: el esquema queda en la
versión más nueva, por eso las migraciones deben ser compatibles hacia atrás (añadir antes de
quitar). Si una migración rompe datos, la salida es el *point-in-time restore* de Postgres (PLAN.md,
riesgos).

**App Settings**: los gobierna el Bicep y cada `infra` reemplaza la lista completa. Un ajuste hecho a
mano en el portal se pierde en el siguiente `infra`: hay que agregarlo a `main.bicep`.

---

## 5. Nombres de recursos

`<env>` = `stage` | `prod`. `<sfx>` = 6 primeros caracteres de `uniqueString(resourceGroup().id)`:
estable para un mismo resource group, solo en los nombres que deben ser únicos en todo Azure.

| Recurso | Nombre |
|---|---|
| Log Analytics | `log-synatrack-<env>` |
| Application Insights | `appi-synatrack-<env>` |
| App Service Plan (Linux B1) | `plan-synatrack-<env>` |
| Web App (backend) | `app-synatrack-<env>-<sfx>` → `https://app-synatrack-<env>-<sfx>.azurewebsites.net` |
| Postgres Flexible Server | `psql-synatrack-<env>-<sfx>` → `psql-synatrack-<env>-<sfx>.postgres.database.azure.com`, base `synatrack`, usuario `synatrack_admin` |
| Key Vault | `kv-syn-<env>-<sfx>` |
| Static Web App | `stapp-synatrack-<env>` |
| Action Group | `ag-synatrack-<env>` |
| Prueba de disponibilidad | `wt-synatrack-<env>-health` (3 ubicaciones, cada 5 min) |
| Alertas | `alert-synatrack-<env>-{availability,http5xx,response-time,pg-cpu,pg-storage}` |
| Presupuesto | `budget-synatrack-<env>` (80 % y 100 % real, 100 % previsto) |
| Identidad del pipeline | app registration `gh-synatrack-<env>` |

Dimensionamiento por entorno (en `params/<env>.bicepparam`):

| | stage | prod |
|---|---|---|
| App Service | B1 Linux, Always On, Node 24 LTS (`linuxFxVersion`) | igual |
| Postgres | Standard_B1ms (Burstable), 32 GB, PG16 | igual |
| Backups de Postgres | 7 días | 14 días |
| Key Vault: protección contra purga | no | sí (irreversible) |
| Retención de logs | 30 días | 90 días |
| Static Web App | Free | Free (pasar a Standard si se quiere SLA) |

### App Settings del backend

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | la inyecta App Service (8080); el backend escucha en `env.PORT` y `0.0.0.0` |
| `TZ` | `UTC` |
| `TRUST_PROXY` | `1` (IP real del cliente tras el front-end de App Service) |
| `CORS_ORIGIN` | `FrontendUrl` + hostname de la SWA + `ExtraCorsOrigins` |
| `DATABASE_URL`, `DIRECT_URL` | Key Vault `database-url` (conexión directa, `sslmode=require`, sin `pgbouncer` ni `connection_limit`) |
| `AUTH_ENABLED` / `AUTH_DEMO_BYPASS` | `true` / `false` |
| `AZURE_AD_TENANT_ID` | `TenantId` |
| `AZURE_AD_AUDIENCE` | `ApiAudience` o, por defecto, `api://<AppClientId>,<AppClientId>` (tokens v1 y v2) |
| `ADMIN_EMAIL`, `SUPPORT_EMAIL`, `PAYROLL_EMAIL` | de la config (los vacíos no se envían: el backend rechaza correos vacíos) |
| `JOBS_INTERVAL_MINUTES` | `60`: con Always On el proceso no se duerme y el ciclo corre en proceso (reemplaza el cron horario de Render) |
| `FX_SYNC_IN_CYCLE` | `true`: sincronización FX diaria dentro del ciclo de trabajos (reemplaza el cron diario de Render; sin ella las tasas no se actualizan) |
| `JOBS_RUN_TOKEN`, `FX_SYNC_TOKEN`, `SMTP_PASS`, `TEAMS_*_WEBHOOK_URL` | Key Vault, solo si el secreto existe |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_FROM` | de la config |
| `SCM_DO_BUILD_DURING_DEPLOYMENT`, `ENABLE_ORYX_BUILD` | `false` (el zip ya viene construido) |
| `APPLICATIONINSIGHTS_CONNECTION_STRING`, `ApplicationInsightsAgent_EXTENSION_VERSION=~3` | auto-instrumentación de Node en Linux |

---

## 6. Variables de GitHub

Ninguna es secreta: los workflows se autentican por OIDC y leen los secretos de Key Vault.

**Repositorio**

| Variable | La define | Uso |
|---|---|---|
| `AZURE_DEPLOY_ENABLED` | Administrador del repositorio, a mano (§3.7) | `true` activa los tres workflows |
| `AZURE_FRONTEND_PROD_ENABLED` | Administrador del repositorio, a mano, en el corte | `true` publica el frontend de prod desde `main` |
| `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` | bootstrap | login OIDC |
| `AZURE_STAGE_CLIENT_ID`, `AZURE_STAGE_RESOURCE_GROUP`, `AZURE_STAGE_INFRA_PARAMS_B64` | bootstrap stage / infra stage | what-if de los PR (corre sin environment) |

**Environment (`stage` y `prod`)**

| Variable | La define | Uso |
|---|---|---|
| `AZURE_CLIENT_ID` | bootstrap | identidad `gh-synatrack-<env>` |
| `AZURE_RESOURCE_GROUP`, `AZURE_ENV_BRANCH` | bootstrap | |
| `AZURE_INFRA_PARAMS_B64` | bootstrap / infra | parámetros no sensibles del Bicep (JSON en base64) para `infra-azure.yml` |
| `VITE_AZURE_CLIENT_ID`, `VITE_AZURE_TENANT_ID`, `VITE_AZURE_API_SCOPE` | bootstrap | build del frontend |
| `AZURE_WEBAPP_NAME`, `AZURE_API_URL` | infra | deploy del backend; `VITE_API_URL` del frontend |
| `AZURE_KEYVAULT_NAME`, `AZURE_POSTGRES_SERVER` | infra | migraciones |
| `AZURE_SWA_NAME`, `AZURE_SWA_RESOURCE_GROUP`, `AZURE_FRONTEND_URL` | infra | deploy del frontend |

Los workflows **no pueden** escribir variables (el `GITHUB_TOKEN` no tiene ese permiso): si un
despliegue de infra desde Actions cambia un nombre o URL, un operador con rol *Admin* en el
repositorio debe correr `.\scripts\azure.ps1 infra` desde su PC para sincronizarlas.

---

## 7. Workflows

| Workflow | Disparo | Qué hace |
|---|---|---|
| `infra-azure.yml` | PR que toca `infra/**`; manual | PR: what-if de stage + comentario fijo en el PR. Manual: what-if o deploy del entorno elegido (prod con revisores). El **primer** deploy de cada entorno se hace con el script (genera la contraseña). |
| `deploy-backend-azure.yml` | push a `dev`/`main` en `backend/**`; manual (`environment`, `ref`, `skip_migrations`) | build y pruebas **sin** permiso de Azure → zip (`dist/`, `node_modules` podado, `package.json`, …) → firewall temporal para la IP del runner → `prisma migrate deploy` → cierra el firewall (`if: always()`) → `azure/webapps-deploy` → espera `/health` 200 hasta 5 min |
| `deploy-frontend-azure.yml` | push a `dev`/`main` en `frontend/**`; manual | type-check, pruebas y build con las `VITE_*` del environment → token de la SWA con `az staticwebapp secrets list` → `static-web-apps-deploy` (solo subida; `staticwebapp.config.json` viene de `frontend/public/`) → comprueba que responde |

El workflow viejo `azure-static-web-apps-victorious-glacier-0d52b010f.yml` no se tocó; su SWA no es
la que sirve producción (prod está en Vercel) y es candidata a retirarse tras el corte.

---

## 8. Roles de un operador (qué asigna `bootstrap` al grupo)

Sobre el **resource group de cada entorno** (nada a nivel de suscripción). Es el mínimo para correr
todos los comandos del script salvo `bootstrap`:

| Rol | Por qué lo necesita | Comandos |
|---|---|---|
| **Contributor** | desplegar el Bicep (crea y actualiza todos los recursos), reiniciar el Web App, log stream, reglas de firewall, leer métricas, alertas y Log Analytics. Incluye lectura (`*/read`). | `plan`, `infra`, `status`, `health`, `logs`, `access`, `secret-set` (agrega la App Setting) |
| **Key Vault Secrets Officer** | plano de datos de Key Vault: `infra` relee `postgres-admin-password`; `secret-set` escribe secretos. Contributor no da acceso a valores de secretos. | `plan`, `infra`, `secret-set` |
| **Role Based Access Control Administrator**, con la misma condición que el pipeline | el despliegue del Bicep corre con la identidad de quien lo lanza y crea (o reafirma) la asignación "Key Vault Secrets User" de la identidad del Web App; Contributor no puede escribir asignaciones de rol. La condición solo permite asignar o quitar ese rol a service principals. | `infra` (y `plan`, que valida las mismas operaciones) |

Lo que un operador **no** tiene, a propósito: Owner, User Access Administrator, permisos a nivel de
suscripción ni sobre otros resource groups, ni capacidad de darse roles a sí mismo o a otras
personas. Por eso `bootstrap` (proveedores, resource group, identidad del pipeline, asignar roles)
queda para el Administrador de Azure.

Además de Azure, los comandos usan GitHub:

| Permiso en GitHub | Para |
|---|---|
| *Write* en el repositorio | `deploy`, `rollback`, `status` (disparar y ver workflows) |
| *Admin* en el repositorio | `bootstrap`, y que `infra` sincronice variables (sin él, `infra` despliega igual y avisa) |
| Revisor del Environment `prod` | aprobar despliegues a producción |

---

## 9. Alta de un operador nuevo

1. **Entra ID** (Administrador de Entra): agregar a la persona al grupo `OperatorsGroup`. No hay que
   volver a correr `bootstrap`: los roles están asignados al grupo. Puede tardar unos minutos en
   reflejarse; la persona debe cerrar y abrir sesión en `az` después.
2. **GitHub** (Administrador del repositorio): darle acceso al repositorio con rol *Write* (o
   *Admin* si va a correr `bootstrap` o sincronizar variables).
3. **Environment `prod`** (Administrador del repositorio): si va a aprobar despliegues, agregarla
   en *Settings > Environments > prod > Required reviewers*. Verificar que *Prevent self-review*
   siga activo.
4. **Config en su PC**: clonar el repositorio y copiar la plantilla:

   ```powershell
   Copy-Item infra/azure.config.example.psd1 infra/azure.config.psd1
   ```

   Pedir los valores (TenantId, SubscriptionId, AppClientId, etc.) a otro operador **por un canal
   interno de Synaptica** (Teams o correo corporativo), nunca por canales externos. El archivo no
   lleva secretos y los secretos no se comparten: viven en Key Vault.
5. **Herramientas**: Azure CLI con Bicep, GitHub CLI (`gh auth login`), PowerShell 5.1 o 7 (§2).
6. **Verificar**:

   ```powershell
   .\scripts\azure.ps1 login
   .\scripts\azure.ps1 access -Env stage     # debe aparecer en los miembros del grupo
   .\scripts\azure.ps1 status -Env stage
   .\scripts\azure.ps1 plan   -Env stage     # confirma Contributor + lectura de Key Vault
   ```

**Baja de un operador**: quitarlo del grupo en Entra, del repositorio y de los revisores de `prod`.
Si se sospecha que conoció el valor de algún secreto, rotarlo con `secret-set`. `access` permite
comprobar que ya no aparece.

---

## 10. Problemas frecuentes

- **El backend arranca con `DIRECT_URL debe ser una URL...`**: la referencia a Key Vault no se
  resolvió (el valor quedó literal). Causas: el rol del Web App aún se está propagando (minutos) o
  el secreto no existe. Portal > Web App > *Environment variables* muestra el estado de cada
  referencia; `az webapp restart` la vuelve a resolver.
- **403 al leer o escribir secretos desde la PC**: la cuenta no está en el grupo de operadores (o el
  cambio aún no se propagó). `access` lo muestra.
- **`infra` falla al crear la asignación de rol del Key Vault**: falta el rol RBAC Administrator
  condicionado; un Administrador de Azure debe repetir `bootstrap`.
- **`migrate deploy` no conecta**: mirar `status`; si quedaron reglas `gh-runner-*` abiertas,
  borrarlas con `az postgres flexible-server firewall-rule delete`.
- **Reglas de firewall viejas**: el modo incremental no borra reglas `appsvc-*` de IPs que el App
  Service ya no usa. Revisarlas tras un cambio de plan.
- **`gh workflow run` falla con 404**: el workflow todavía no está en `main` (§3.8).
