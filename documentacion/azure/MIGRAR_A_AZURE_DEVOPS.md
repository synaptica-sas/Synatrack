# Dominio propio, apagado de lo viejo y mudanza a Azure DevOps

**Actualizado:** 2026-11-17. Lo ejecutan Juan Alejandro Espinosa y Marcos Armas, que hacen tanto TI como
desarrollo. Claude Code puede encargarse de las verificaciones, los pipelines y la
documentación, pero no recibe secretos ni lee `infra/azure.config.psd1`.

## Punto de partida

- Producción ya opera en Azure. La única usuaria que carga datos entra por la URL por defecto de
  la Static Web App (`*.azurestaticapps.net`) y ya está al tanto del cambio.
- Render y Vercel ya no operan. El dominio `synatrack.synaptica.co` sigue apuntando a Vercel,
  así que solo hay que moverlo.
- En GitHub, todas las ramas están fusionadas en `dev`, y `dev` es igual a `main`. Los tags son
  `v2.1.0` y `v2.3.0`.
- La limpieza del repositorio (quitar Render, Vercel y la SWA vieja) está en la rama local
  `chore/retirar-render-vercel`. Todavía no se ha subido.

---

## Parte 1. Mover el dominio

> **Hecho el 2026-11-17.** Se quitó el dominio de Vercel y el CNAME pasó a
> `calm-flower-00e3d4c10.3.azurestaticapps.net` (TTL 300). Después se agregó el dominio a la SWA
> con `az staticwebapp hostname set`, que lo validó por el CNAME y emitió el certificado en
> minutos. En Entra se agregó `https://synatrack.synaptica.co` **sin barra final**, porque el
> frontend usa `window.location.origin` y la URI registrada antes tenía la barra. El paso 5 no
> hizo falta: `CORS_ORIGIN` de prod ya incluía el dominio.

1. **Vercel:** quitar `synatrack.synaptica.co` del proyecto. Si sigue ahí, Vercel pelea por el
   certificado.
2. **Portal de Azure:** en la SWA de prod, abrir *Custom domains → Add → Custom domain on other
   DNS* y escribir `synatrack.synaptica.co`. El portal muestra el hostname al que debe apuntar el
   CNAME.
3. **DNS de synaptica.co:** cambiar el CNAME de `synatrack` de Vercel a
   `<swa-prod>.azurestaticapps.net`. Después, esperar a que la SWA lo valide y emita el
   certificado. Suelen ser minutos.
4. **Entra ID:** en la app registration del frontend, agregar la URI de redirección SPA
   `https://synatrack.synaptica.co`. No hay que recompilar el frontend, porque toma la URI de
   redirección de `window.location.origin`.
5. **Variables:** en `infra/azure.config.psd1` de prod, poner
   `FrontendUrl = "https://synatrack.synaptica.co"`. Después:
   ```powershell
   .\scripts\azure.ps1 plan  -Env prod   # revisar que solo cambien CORS_ORIGIN y FRONTEND_URL
   .\scripts\azure.ps1 infra -Env prod
   ```
   Con esto el backend acepta el dominio en CORS y los enlaces de los correos usan el dominio.
   La URL por defecto de la SWA sigue en CORS, así que nadie se queda sin entrar.
6. **Verificar:**
   ```powershell
   nslookup -type=CNAME synatrack.synaptica.co   # *.azurestaticapps.net
   .\scripts\azure.ps1 health -Env prod
   ```
   Después, entrar con una cuenta real por `https://synatrack.synaptica.co` y avisarle a la
   usuaria que ya puede usar el dominio.

**Si algo falla:** la URL por defecto sigue funcionando, así que basta con quitar el CNAME
mientras se corrige.

---

## Parte 2. Apagar lo viejo

Se hace todo de una vez, sin esperas, porque nada de esto se usa.

- [ ] **Render:** borrar los Web Services `synatrack` y `app-gestion-demo` y los cron jobs
      `app-gestion-jobs` y `app-gestion-fx-sync`.
- [ ] **Vercel:** borrar el proyecto, y archivar o borrar el repositorio alterno
      `alejandroespinosa03/synatrack`.
- [ ] **Supabase:** borrar el proyecto. Si se quiere guardar una copia, hacer antes un `pg_dump`,
      guardarlo cifrado y fuera del repositorio, porque tiene tarifas. Esto cierra también la
      exposición de RLS anotada en `PENDIENTES.md` §0.
- [ ] **Azure:** borrar la Static Web App vieja, `victorious-glacier-0d52b010f`.
- [ ] **Entra ID:** quitar las URIs de redirección de Vercel y de `*.onrender.com`.
- [ ] **GitHub:**
  - borrar el secreto `AZURE_STATIC_WEB_APPS_API_TOKEN_VICTORIOUS_GLACIER_0D52B010F`;
  - desinstalar las apps de Render, Vercel y Supabase (*Settings → GitHub Apps*), que siguen
    teniendo acceso de lectura al código.
- [ ] **Tasas de cambio** (no se migran como trabajo, ver D-15 en `PENDIENTES.md`):
  - sacar `fx-sync` de `TRABAJOS_VIGILADOS` (`backend/src/modules/jobs/job-runs.service.ts`);
  - borrar `fx-sync-token` del Key Vault si existe;
  - pulsar "Actualizar ahora" una vez en Tasas FX.
- [ ] **Repositorio:** rebasar `chore/retirar-render-vercel` sobre `origin/dev`, cambiar
      "corte pendiente" por "hecho" en `CLAUDE.md` §6 y `DESPLIEGUE.md`, y fusionarla a `dev` y
      después a `main`.

---

## Parte 3. Mover GitHub a Azure DevOps

### 3.1 Preparar el repositorio

> **Hecho el 2026-11-17.** Ninguna rama sin fusionar; se borraron las 19 históricas y en GitHub
> quedan `main` y `dev`. gitleaks (Docker, `zricethezav/gitleaks:v8.21.2`, 256 commits) dio 3
> falsos positivos: los IDs públicos de los roles *Key Vault Secrets User* y *Officer*. El
> `frontend/.env` commiteado en abril de 2026 solo tenía `VITE_*` no secretas. Nada que rotar.
> No había issues ni PRs abiertos. Los tags `v1.0.0` y `v2.0.0` existen solo en un PC y **no
> viajan** (decisión del 2026-11-17): en la 3.3 se empujan `v2.1.0` y `v2.3.0` por nombre.

- [X] Borrar las ramas históricas. Hay que confirmar antes que no queda nada sin fusionar:
  ```powershell
  git fetch --prune origin
  git branch -r --no-merged origin/dev        # debe salir vacío
  git branch -r --merged origin/dev | Select-String -NotMatch 'origin/(main|dev|HEAD)' |
    ForEach-Object { git push origin --delete ($_.ToString().Trim() -replace '^origin/','') }
  ```
- [X] Escanear la historia con `gitleaks git . --report-path gitleaks.json`, porque viaja
      completa. Si aparece un secreto real, hay que rotarlo. El reporte no se commitea.
- [X] Cerrar o anotar los issues y PRs abiertos, que no viajan.

### 3.2 Crear la organización

> **Hecho el 2026-11-17:** organización **`synaptica-co`** (https://dev.azure.com/synaptica-co),
> conectada al tenant de Synaptica, con el proyecto privado `Synatrack`.

- [X] Crear la organización de Azure DevOps conectada al tenant de Synaptica y un proyecto
      privado `Synatrack`.
- [X] Paralelismo. **Microsoft retiró el formulario del *free grant***: ahora el job gratis
      (1 job hospedado, 1800 min/mes para proyectos privados) se concede solo al vincular la
      facturación. En *Organization settings → Billing* quedó vinculada la suscripción **MCPP
      Subscription**, con 0 jobs pagos y *GitHub-hosted agents* en Off. No cuesta nada mientras
      no se compren jobs, no se active la prueba de *Test Plans* y no pasen de 5 usuarios Basic.
- [X] Licencia Basic para los dos operadores. El grupo de Entra `Synatrack-IaC-Operadores` quedó
      en **Project Collection Administrators** (administra toda la organización, que hoy solo
      tiene este proyecto); para el permiso mínimo bastaría *Project Administrators* del proyecto.
- [X] *Policies*: *Allow public projects* y *Third-party application access via OAuth* en Off.

### 3.3 Subir el código (solo `main`, `dev` y tags)

> **Hecho el 2026-11-17.** En https://dev.azure.com/synaptica-co/Synatrack/_git/Synatrack quedaron
> `main` (`c81a922`), `dev` (`94326cb`), `v2.1.0` y `v2.3.0`, con los mismos SHAs que GitHub y
> `main` como rama por defecto. Los tags se empujaron por nombre, no con `--tags`. La
> autenticación fue un token temporal de `az account get-access-token`, sin PAT. GitHub sigue
> siendo el repositorio activo hasta la 3.6: lo que se suba antes a GitHub hay que volver a
> empujarlo.

```powershell
git clone --mirror https://github.com/synaptica-sas/Synatrack.git synatrack-mirror
cd synatrack-mirror
git remote add ado https://dev.azure.com/<org>/Synatrack/_git/Synatrack
git push ado refs/heads/main:refs/heads/main refs/heads/dev:refs/heads/dev
git push ado --tags
git ls-remote origin main dev ; git ls-remote ado main dev   # los SHAs deben coincidir
```

Toda la historia viaja con esas dos ramas. Después hay que poner `main` como rama por defecto y
borrar el clon espejo.

### 3.4 Seguridad

> **Hecho el 2026-11-18, salvo las políticas de rama.** Verificado con `az`: cada service
> connection coincide con su credencial federada, ninguna está abierta a todos los pipelines y
> las credenciales de GitHub siguen intactas hasta la 3.6.

- [ ] **Políticas de rama** (pasan a la 3.5, cuando exista `pipelines/ci.yml`; la validación de
      build necesita un pipeline, y exigir PR en `main` antes de la 3.6 impediría reflejar ahí los
      merges de GitHub):
  - `main`: PR obligatorio, 1 revisor distinto del autor, y el CI en verde;
  - `dev`: el CI en verde.
  - Cuando existan, activar *Verify branch protection* en el *Branch control* de `azure-prod`.
- [X] **Service connections** `azure-stage` y `azure-prod`, de tipo *Workload Identity
      Federation (manual)*, sobre las mismas app registrations de hoy (`gh-synatrack-<env>`).
      Las credenciales federadas se llaman `ado-azure-<env>`. Azure DevOps usa ahora como issuer
      el de Entra (`login.microsoftonline.com/<tenant>/v2.0`) con un subject `/eid1/...`, no
      `vstoken.dev.azure.com` ni `sc://...`.
- [X] **Checks de `azure-prod`:** *Branch control* (solo `main`), *Approvals* (grupo
      `Synatrack-IaC-Operadores`, 1 día) y *Exclusive lock*. En Azure DevOps la federación es por
      conexión y no por rama, así que sin *Branch control* cualquier rama podría desplegar a prod.
  - ⚠ **Decisión temporal (2026-11-18):** *Allow approvers to approve their own runs* quedó
    **marcado**, para publicar correcciones a prod sin esperar al otro operador. Cuando la
    versión esté estable, desmarcarlo para que siempre apruebe quien no lanzó el despliegue.
- [X] **Check de `azure-stage`:** *Branch control* (`refs/heads/dev, refs/pull/*`).
- [X] **Environments** `stage` y `prod` (vacíos: las aprobaciones van en la service connection).
- [X] **Grupos de variables** `synatrack-stage` y `synatrack-prod`, 15 variables cada uno, con las
      mismas claves que las variables de GitHub pero sin el sufijo `_STAGE`/`_PROD`. Fuera quedan
      `AZURE_DEPLOY_ENABLED`, `AZURE_FRONTEND_PROD_ENABLED` y `AZURE_ENV_BRANCH_*` (los reemplaza
      *Branch control*) y `AZURE_CLIENT_ID_*` (lo lleva la service connection). Ningún pipeline
      los usa sin autorización. Los secretos siguen en Key Vault.

### 3.5 Pipelines y script

> **Escrito el 2026-11-18** en la rama `chore/azure-pipelines`. Hasta la 3.6 solo se crea en
> Azure DevOps el pipeline `ci` (no toca Azure): los de despliegue se crean después de apagar
> GitHub, para que nunca desplieguen los dos a la vez.

| Hoy (GitHub Actions) | Azure Pipelines |
|---|---|
| `backend-ci.yml` | `pipelines/ci.yml`: backend con Postgres de servicio y, además, type-check, pruebas y build del frontend. Sin service connection |
| `deploy-backend-azure.yml` | `pipelines/deploy-backend.yml`: build sin acceso a Azure → *deployment job* en el environment → firewall, migraciones, `az webapp deploy`, `/health`. Etiqueta cada ejecución con `<env>` y `sha-<7>` para el rollback |
| `deploy-frontend-azure.yml` | `pipelines/deploy-frontend.yml` |
| `infra-azure.yml` | `pipelines/infra.yml`: manual (what-if o deploy) y what-if de stage en PR vía *Build validation* con filtro `/infra/*` |

- `dev` despliega a stage y `main` a prod. Los parámetros manuales (`environment`, `ref`,
  `skipMigrations`) cubren el rollback.
- Rama, aprobación y bloqueo los imponen los checks de la service connection, no el YAML.
- `infra/ci/infra-env.sh` emite la sintaxis de cada plataforma (`TF_BUILD`).
- `scripts/azure.ps1` funciona con las dos plataformas según `CiProvider` (`github` | `ado`) en
  `azure.config.psd1`, con `AdoOrg` y `AdoProject`. Resumen en `infra/README.md` §11.
- Probado el 2026-11-18: `access` y `status` en modo `ado` contra Azure DevOps real y en modo
  `github` (sin cambios). La escritura en los grupos de variables y `deploy` solo se probarán en
  la 3.6.

- [X] YAML de los cuatro pipelines y adaptación de `azure.ps1` e `infra-env.sh`.
- [X] Agregar `CiProvider = "github"`, `AdoOrg = "synaptica-co"` y `AdoProject = "Synatrack"` a
      `infra/azure.config.psd1` (lo hace un operador; Claude no lo lee). Cada operador lo
      repite en su copia.
- [X] Crear el pipeline `ci` en Azure DevOps desde la rama `chore/azure-pipelines`
      (`/pipelines/ci.yml`) y correrlo una vez en verde. Primera ejecución `ci-20261118.1`:
      frontend ~4 min y backend ~2,5 min (con las pruebas de ruta), en serie porque hay un solo
      job gratis.
- [ ] Fusionar `chore/azure-pipelines` a `dev` y a `main` en GitHub (los workflows de GitHub no
      cambian de comportamiento).

### 3.6 Cambio

> **En curso desde el 2026-11-18.** Hechos los pasos 1 y 2:
> - GitHub con `AZURE_DEPLOY_ENABLED=false`. `dev` y `main` de Azure DevOps en `982a2cb`, iguales
>   a GitHub. `ci` con rama por defecto `dev`; `chore/azure-pipelines` borrada.
> - Pipelines `deploy-backend` (id 2), `deploy-frontend` (3) e `infra` (4) creados desde `dev`
>   sin ejecutarse, y compilados con *preview* para stage, prod y rollback.
> - **`dev` sin políticas** (decisión del 2026-11-18): con política, toda la rama exigiría PR y
>   `/commit` + `/sync` dejarían de servir; el CI corre igual en cada push por el `trigger`.
> - `main`: 1 revisor (**el autor puede aprobar su PR por ahora**, como la aprobación de prod),
>   `ci` obligatorio y `infra` obligatorio con filtro `/infra/*`. *Verify branch protection*
>   activado en el *Branch control* de `azure-prod`.

1. En GitHub, poner `AZURE_DEPLOY_ENABLED=false`, para que nunca desplieguen los dos a la vez.
   Reflejar en Azure DevOps lo último de `main` y `dev` y crear las políticas de rama (3.4).
2. Crear en Azure DevOps los pipelines `deploy-backend`, `deploy-frontend` e `infra` (con esos
   nombres: `azure.ps1` los busca así) apuntando a cada YAML. La primera ejecución de cada uno pide
   autorizar la service connection, el grupo de variables y el environment (*Permit*). Poner
   `CiProvider = "ado"` en `azure.config.psd1`.
3. Cada uno cambia el remoto. `/sync` y `/commit` siguen funcionando:
   ```powershell
   git remote set-url origin https://dev.azure.com/<org>/Synatrack/_git/Synatrack
   ```
4. Probar en stage: un PR a `dev` (corre el CI), un merge (despliega) y un rollback.
5. Prod: PR de `dev` a `main`, aprobación y health.
6. Si todo salió bien:
   - archivar el repositorio de GitHub, sin borrarlo;
   - borrar las credenciales federadas de GitHub en `gh-synatrack-<env>`;
   - borrar `.github/workflows/` y las variables de GitHub;
   - quitar de `azure.ps1` el modo `github` y reescribir `infra/README.md` sin GitHub.

**Si algo falla antes del paso 6:** volver a poner `AZURE_DEPLOY_ENABLED=true` y apuntar el
`origin` a GitHub.

---

## Por decidir

| Decisión | Recomendación |
|---|---|
| Quién aprueba prod | El otro operador, el que no hizo el merge. Hoy se permite autoaprobar (ver 3.4) |
| Paralelismo | Resuelto: job gratis activo con la facturación vinculada (3.2) |
