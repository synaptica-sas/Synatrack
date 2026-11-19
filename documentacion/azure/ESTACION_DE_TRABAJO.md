# Preparar una estación de trabajo para el repositorio de Azure DevOps

**Actualizado:** 2026-11-19. Para Juan Alejandro Espinosa y Marcos Armas (y para quien se sume
después). Desde el 2026-11-19 el repositorio vivo es
**https://dev.azure.com/synaptica-co/Synatrack** y GitHub dejó de desplegar. Cómo se llegó aquí:
`MIGRAR_A_AZURE_DEVOPS.md` §3.

Esta guía cubre lo que cambia en cada PC. Para levantar la aplicación en local, ver
`documentacion/DESARROLLO_LOCAL.md`; para el detalle de `scripts/azure.ps1`, `infra/README.md`.

## Estado por persona

| Paso | Juan Alejandro | Marcos |
|---|---|---|
| 1. Acceso a Azure DevOps | ✅ | ⬜ confirmar que entra al proyecto |
| 2. Herramientas | ✅ (Git 2.55 con GCM, az 2.92 + `azure-devops`) | ⬜ |
| 3. Git: credenciales e identidad | ⬜ fijar `oauth` (3.1) | ⬜ |
| 4. Repositorio apuntando a Azure DevOps | ✅ `origin` cambiado | ⬜ **pendiente** |
| 5. Limpiar restos de GitHub | ⬜ quitar el remoto `fork` | ⬜ |
| 6. `azure.config.psd1` con `CiProvider = "ado"` | ✅ | ⬜ **pendiente** |
| 7. Valores por defecto de `az devops` | ⬜ | ⬜ |
| 8. Verificación | ✅ (status, deploy, rollback) | ⬜ |
| 9. Notificaciones | ⬜ | ⬜ |

---

## 1. Acceso a Azure DevOps

Cada uno entra con su cuenta de Synaptica. El acceso llega por el grupo de Entra
`Synatrack-IaC-Operadores`, que está en *Project Collection Administrators* con licencia
**Basic**.

- Abrir https://dev.azure.com/synaptica-co/Synatrack. Debe verse *Repos*, *Pipelines* y las
  ramas `dev` y `main`.
- Si pide acceso o no aparece la organización, quien ya entra revisa
  *Organization settings → Users*.

## 2. Herramientas

| Herramienta | Versión | Para qué | Comprobar |
|---|---|---|---|
| Git para Windows | 2.40 o más | Trae **Git Credential Manager** (GCM), que hace el login con Microsoft sin PAT | `git --version` · `git credential-manager --version` |
| Azure CLI | 2.86 o más (la sintaxis de reglas de firewall cambió en 2.86) | `scripts/azure.ps1`, despliegues manuales | `az version` |
| Extensión `azure-devops` de az | la última | Pipelines, grupos de variables, PR desde la terminal | `az extension add --name azure-devops` (o `az extension update --name azure-devops`) |
| Bicep | el de az | `plan` e `infra` | `az bicep install` / `az bicep upgrade` |
| PowerShell | 5.1 o 7 | `scripts/*.ps1` | |
| Node | la de `backend/.nvmrc` (24.13) | build y pruebas locales | `node -v` |
| Docker Desktop | opcional | entorno local con Docker y herramientas de Postgres | |

**Ya no hace falta:** GitHub CLI (`gh`). Se puede dejar instalado mientras dure el cierre de la
3.6 (fase G), que todavía toca GitHub.

## 3. Git

### 3.1 Credenciales: Microsoft Entra, sin PAT

GCM abre el navegador y guarda un token de Entra que se renueva solo. Para que no cree un PAT
de larga vida:

```powershell
git config --global credential.azreposCredentialType oauth
```

No crear PAT para Git. Si alguna herramienta lo pide, avisar antes de crearlo.

### 3.2 Identidad de los commits

`/commit` exige un correo `@synaptica.co`:

```powershell
git config --global user.name  "Nombre Apellido"
git config --global user.email "usuario@synaptica.co"
```

### 3.3 Tags: nunca `git push --tags`

En la PC de Juan Alejandro existen `v1.0.0` y `v2.0.0`, que se decidió **no** llevar a Azure
DevOps (2026-11-17). Un tag nuevo se sube por nombre:

```powershell
git push origin v2.4.0
```

## 4. Repositorio apuntando a Azure DevOps

### 4.1 Si ya tienes un clon (caso de Marcos)

1. **Antes de cambiar nada**, revisar que no quede trabajo sin subir. Con el `origin` todavía en
   GitHub:
   ```powershell
   git fetch origin
   git status
   git log --branches --not --remotes --oneline   # commits locales que no están en ningún remoto
   ```
   Si sale algo, anotarlo: se sube después del paso 3, sobre el `dev` de Azure DevOps.
2. Cambiar el remoto y traer lo nuevo:
   ```powershell
   git remote set-url origin https://dev.azure.com/synaptica-co/Synatrack/_git/Synatrack
   git fetch --prune origin
   ```
   La primera vez se abre el navegador para iniciar sesión con la cuenta de Synaptica.
3. Poner `dev` y `main` al día. `dev` de Azure DevOps va por delante del de GitHub:
   ```powershell
   git switch dev
   git branch -u origin/dev
   git merge --ff-only origin/dev        # si falla, hay commits locales: usar /sync (rebase)
   git branch -f main origin/main        # solo si no estás parado en main
   git branch -u origin/main main
   ```
4. Borrar las ramas locales que apuntaban a ramas de GitHub que ya no existen (se borraron 19
   en la 3.1):
   ```powershell
   git branch -vv | Select-String ': gone]'      # revisar la lista antes de borrar
   git branch -vv | Select-String ': gone]' | ForEach-Object { git branch -d ($_.ToString().Trim().Split()[0]) }
   ```
   `-d` no borra ramas con commits sin fusionar; si alguna se niega, revisarla antes de usar `-D`.

### 4.2 Si es una PC nueva

```powershell
git clone https://dev.azure.com/synaptica-co/Synatrack/_git/Synatrack
cd Synatrack
git switch dev
```

Recomendado: clonar **fuera de OneDrive** (por ejemplo `C:\dev\Synatrack`). OneDrive sincroniza
`node_modules` y `.git` y puede bloquear archivos durante un build. Si el clon actual vive en
OneDrive y funciona, no hace falta moverlo.

## 5. Limpiar restos de GitHub

- **Remoto `fork`** (PC de Juan Alejandro): apunta al repositorio alterno
  `alejandroespinosa03/synatrack`, del que desplegaba Vercel. Ya no se usa:
  ```powershell
  git remote remove fork
  ```
- **Credenciales de GitHub guardadas**: pueden quedarse hasta la fase G. Después,
  `gh auth logout` y, si se quiere, `git credential-manager github logout <usuario>`.
- **No empujar nada a GitHub.** Si por error se empuja, no despliega
  (`AZURE_DEPLOY_ENABLED=false`), pero deja el repositorio de GitHub distinto del real.

## 6. `infra/azure.config.psd1`

Cada operador tiene su copia (no se versiona; Claude Code no la lee). Agregar en el nivel
principal, **no** dentro de `Environments`:

```powershell
CiProvider = "ado"
AdoOrg     = "synaptica-co"
AdoProject = "Synatrack"
```

`GitHubRepo` puede quedarse; con `CiProvider = "ado"` no se usa. Si el archivo solo tiene
`ConfigFile = "C:\..."`, las claves van en el archivo al que apunta.

Comprobar qué está leyendo el script (no muestra secretos):

```powershell
$c = Import-PowerShellDataFile infra\azure.config.psd1; "CiProvider=$($c.CiProvider)"; "ConfigFile=$($c.ConfigFile)"
```

## 7. Valores por defecto de `az devops`

Evita repetir la organización y el proyecto en cada comando:

```powershell
az devops configure --defaults organization=https://dev.azure.com/synaptica-co project=Synatrack
```

`az` usa la misma sesión que `.\scripts\azure.ps1 login` (cuenta de Synaptica, tenant de
Synaptica).

## 8. Verificación

```powershell
git remote -v                                  # solo origin -> dev.azure.com
git status -sb                                 # ## dev...origin/dev
.\scripts\azure.ps1 status -Env stage          # termina en "Últimos despliegues (Azure Pipelines)"
.\scripts\azure.ps1 access -Env prod           # ado-azure-prod = service connection azure-prod
az pipelines list -o table                     # ci, deploy-backend, deploy-frontend, infra
```

Si `status` muestra "GitHub Actions", el script sigue leyendo `CiProvider = "github"` (ver §6).

## 9. Notificaciones

Por defecto, Azure DevOps avisa por correo a quien lanzó o provocó una ejecución, y a los
revisores de un PR. Cada uno puede ajustar las suyas en *User settings → Notifications*. Si se
quiere que a los dos les lleguen todos los fallos de despliegue, se configura una sola vez en
*Project settings → Notifications*.

---

## Cómo se trabaja desde ahora

| Qué | Cómo | Qué pasa |
|---|---|---|
| Cambio normal | `/commit` y `/sync` (push a `dev`) | `ci` corre; si toca `backend/**` o `frontend/**`, se despliega **stage** solo |
| Pasar a prod | PR de `dev` a `main` en Azure DevOps (*Repos → Pull requests*) o `az repos pr create --source-branch dev --target-branch main` | `ci` obligatorio + 1 aprobación. **Completar con "Rebase and fast-forward" y SIN borrar `dev`** |
| Despliegue a prod | Lo dispara el merge si cambió `backend/**` o `frontend/**` | Pide aprobación en la ejecución (*Review → Approve*). Por ahora el mismo operador puede aprobar |
| Desplegar a mano | `.\scripts\azure.ps1 deploy -Env <env> [-App backend\|frontend] [-Ref <sha>]` | Lanza el pipeline y espera; prod pide aprobación |
| Rollback | `.\scripts\azure.ps1 rollback -Env <env> -App backend` | Elige un despliegue anterior; sin migraciones |
| Infra | `plan`/`infra` desde la PC, o el pipeline `infra` (what-if o deploy) | Prod solo desde `main`, con aprobación |

`main` ya no acepta push directo (política de rama): todo llega por PR. `dev` no tiene
políticas, para que `/commit` + `/sync` sigan funcionando.

**Si Azure DevOps falla antes de cerrar la 3.6 (fase G):** volver a
`AZURE_DEPLOY_ENABLED=true` en GitHub, `origin` a `https://github.com/synaptica-sas/Synatrack.git`
y `CiProvider = "github"`. Ver `MIGRAR_A_AZURE_DEVOPS.md` §3.6.
