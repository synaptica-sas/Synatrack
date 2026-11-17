# Dominio propio, apagado de lo viejo y mudanza a Azure DevOps

**Actualizado:** 2026-11-17. Lo ejecutan Juan, Alejandro y Marcos, que hacen tanto TI como
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

- [ ] Borrar las ramas históricas. Hay que confirmar antes que no queda nada sin fusionar:
  ```powershell
  git fetch --prune origin
  git branch -r --no-merged origin/dev        # debe salir vacío
  git branch -r --merged origin/dev | Select-String -NotMatch 'origin/(main|dev|HEAD)' |
    ForEach-Object { git push origin --delete ($_.ToString().Trim() -replace '^origin/','') }
  ```
- [ ] Escanear la historia con `gitleaks git . --report-path gitleaks.json`, porque viaja
      completa. Si aparece un secreto real, hay que rotarlo. El reporte no se commitea.
- [ ] Cerrar o anotar los issues y PRs abiertos, que no viajan.

### 3.2 Crear la organización

- [ ] Crear la organización de Azure DevOps conectada al tenant de Synaptica y un proyecto
      privado `Synatrack`.
- [ ] Revisar *Organization settings → Parallel jobs*. Si no aparece 1 job hospedado, pedir el
      free grant, que tarda unos días, o comprar 1 job (unos USD 40 al mes) y cancelarlo cuando
      llegue el grant.
- [ ] Dar licencias Basic a los tres operadores y permisos de administración al grupo
      `Synatrack-IaC-Operadores`.

### 3.3 Subir el código (solo `main`, `dev` y tags)

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

- [ ] **Políticas de rama:**
  - `main`: PR obligatorio, 1 revisor distinto del autor, y el CI en verde;
  - `dev`: el CI en verde.
- [ ] **Service connections** `azure-stage` y `azure-prod`, de tipo *Workload Identity
      Federation (manual)*, sobre las mismas app registrations de hoy (`gh-synatrack-<env>`).
      A cada una se le agrega la credencial federada que indica Azure DevOps.
- [ ] **Checks de `azure-prod`:** *Branch control* (solo `main`), *Approvals* y *Exclusive lock*.
      En Azure DevOps la federación es por conexión y no por rama, así que sin *Branch control*
      cualquier rama podría desplegar a prod.
- [ ] **Check de `azure-stage`:** *Branch control* (`dev` y PRs).
- [ ] **Environments** `stage` y `prod`.
- [ ] **Grupos de variables** `synatrack-stage` y `synatrack-prod`, con las mismas claves que las
      variables de GitHub pero sin el sufijo `_STAGE`/`_PROD`. Los secretos siguen en Key Vault.

### 3.5 Pipelines y script

Claude Code puede adelantarlo en una rama de GitHub, para que viaje con el código.

| Hoy (GitHub Actions) | Azure Pipelines |
|---|---|
| `backend-ci.yml` | `pipelines/ci.yml`, validación de PR, con Postgres de servicio |
| `deploy-backend-azure.yml` | `pipelines/deploy-backend.yml` |
| `deploy-frontend-azure.yml` | `pipelines/deploy-frontend.yml` |
| `infra-azure.yml` | `pipelines/infra.yml`, con el what-if en el PR |

En `scripts/azure.ps1`, `gh` pasa a ser `az pipelines`, y en `azure.config.psd1`, `GitHubRepo`
pasa a `AdoOrg`/`AdoProject`.

### 3.6 Cambio

1. En GitHub, poner `AZURE_DEPLOY_ENABLED=false`, para que nunca desplieguen los dos a la vez.
2. Crear los 4 pipelines en Azure DevOps apuntando a cada YAML.
3. Cada uno cambia el remoto. `/sync` y `/commit` siguen funcionando:
   ```powershell
   git remote set-url origin https://dev.azure.com/<org>/Synatrack/_git/Synatrack
   ```
4. Probar en stage: un PR a `dev` (corre el CI), un merge (despliega) y un rollback.
5. Prod: PR de `dev` a `main`, aprobación y health.
6. Si todo salió bien:
   - archivar el repositorio de GitHub, sin borrarlo;
   - borrar las credenciales federadas de GitHub en `gh-synatrack-<env>`;
   - borrar `.github/workflows/` y las variables de GitHub.

**Si algo falla antes del paso 6:** volver a poner `AZURE_DEPLOY_ENABLED=true` y apuntar el
`origin` a GitHub.

---

## Por decidir

| Decisión | Recomendación |
|---|---|
| Quién aprueba prod | Cualquiera de los tres que no haya hecho el merge |
| Paralelismo | Free grant; si urge, 1 job pagado por un mes |
