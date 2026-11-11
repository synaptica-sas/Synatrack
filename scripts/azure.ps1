<#
.SYNOPSIS
    Herramientas de operación de Synatrack en Azure (stage y prod).

.DESCRIPTION
    Envuelve `az` (Azure CLI) y `gh` (GitHub CLI) para preparar, desplegar y operar
    los dos entornos de Synatrack en Azure. Compatible con Windows PowerShell 5.1 y
    PowerShell 7.

    La configuración se lee de infra/azure.config.psd1 (copia de
    infra/azure.config.example.psd1; no se versiona). Guía completa: infra/README.md.

    Comandos:
      login       az login con el tenant y selección de la suscripción.
      bootstrap   Una vez por entorno: resource group, identidad OIDC del pipeline,
                  roles y variables de GitHub. Idempotente.
      plan        what-if del Bicep (no cambia nada).
      infra       Despliega el Bicep, guarda las salidas en infra/.out/<env>.json y
                  actualiza las variables de GitHub que dependen de ellas.
      deploy      Dispara el workflow de despliegue en GitHub y sigue su avance.
      status      Estado de Web App, plan, Postgres, Key Vault, SWA y último despliegue.
      health      GET /health, prueba de disponibilidad reciente y alertas activas.
      logs        Log stream del backend.
      rollback    Elige un despliegue exitoso anterior y lo vuelve a desplegar.
      secret-set  Carga un secreto en Key Vault pidiéndolo de forma oculta.
      secret-sync Carga en Key Vault los secretos de infra/azure.secrets.psd1 (solo
                  los que cambiaron) y agrega sus referencias al Web App.
      access      Solo lectura: quién tiene qué rol sobre el entorno, miembros del
                  grupo de operadores y ramas de GitHub que pueden desplegar.

.EXAMPLE
    .\scripts\azure.ps1 login
    .\scripts\azure.ps1 bootstrap -Env stage
    .\scripts\azure.ps1 plan -Env stage
    .\scripts\azure.ps1 infra -Env stage
    .\scripts\azure.ps1 secret-set -Env stage -Name smtp-pass
    .\scripts\azure.ps1 secret-set -Env stage -Name jobs-run-token -Generate
    .\scripts\azure.ps1 secret-sync -Env stage
    .\scripts\azure.ps1 deploy -Env stage
    .\scripts\azure.ps1 deploy -Env prod -Ref 1a2b3c4 -App backend
    .\scripts\azure.ps1 rollback -Env prod
    .\scripts\azure.ps1 access -Env prod
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('login', 'bootstrap', 'plan', 'infra', 'deploy', 'status', 'health', 'logs', 'rollback', 'secret-set', 'secret-sync', 'access')]
    [string]$Command,

    # Entorno. Se llama -Environment para no chocar con la unidad env: de
    # PowerShell; -Env funciona como alias.
    [Alias('Env')]
    [ValidateSet('stage', 'prod')]
    [string]$Environment = 'stage',

    # deploy: commit, tag o rama a desplegar (por defecto, la rama del entorno).
    [string]$Ref,

    # deploy / rollback: qué parte desplegar.
    [ValidateSet('backend', 'frontend', 'all')]
    [string]$App = 'all',

    # deploy: no ejecutar `prisma migrate deploy` (rollback a código anterior).
    [switch]$SkipMigrations,

    # secret-set: nombre del secreto.
    [ValidateSet('jobs-run-token', 'fx-sync-token', 'smtp-pass', 'teams-feedback-webhook-url', 'teams-payroll-webhook-url')]
    [string]$Name,

    # secret-set: generar un valor aleatorio en vez de pedirlo (solo tokens).
    [switch]$Generate,

    # secret-sync: archivo de secretos (por defecto infra/azure.secrets.psd1, o la
    # clave SecretsFile de la config).
    [string]$SecretsFile,

    # Archivo de configuración fuera del repositorio (también: variable de
    # entorno SYNATRACK_AZURE_CONFIG, o la clave ConfigFile en infra/azure.config.psd1).
    [string]$ConfigFile
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# az y gh escriben UTF-8; sin esto Windows PowerShell 5.1 rompe las tildes y el
# texto que se le pasa por tubería a gh.
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {
    Write-Verbose 'No se pudo fijar la codificación de la consola.'
}

# =============================================================================
# Constantes
# =============================================================================

$RepoRoot = Split-Path -Parent $PSScriptRoot
$InfraDir = Join-Path $RepoRoot 'infra'
$ConfigPath = Join-Path $InfraDir 'azure.config.psd1'
$ExampleConfigPath = Join-Path $InfraDir 'azure.config.example.psd1'
$OutDir = Join-Path $InfraDir '.out'
$DefaultSecretsPath = Join-Path $InfraDir 'azure.secrets.psd1'
# Valor especial en el archivo de secretos: generar el token si no existe.
$GenerateKeyword = '<generar>'

$BackendWorkflow = 'deploy-backend-azure.yml'
$FrontendWorkflow = 'deploy-frontend-azure.yml'

# Secretos opcionales (los carga el usuario) -> variable de entorno del backend.
# Debe coincidir con `optionalSecretEnv` de infra/main.bicep.
$OptionalSecrets = [ordered]@{
    'jobs-run-token'             = 'JOBS_RUN_TOKEN'
    'fx-sync-token'              = 'FX_SYNC_TOKEN'
    'smtp-pass'                  = 'SMTP_PASS'
    'teams-feedback-webhook-url' = 'TEAMS_FEEDBACK_WEBHOOK_URL'
    'teams-payroll-webhook-url'  = 'TEAMS_PAYROLL_WEBHOOK_URL'
}
$GeneratableSecrets = @('jobs-run-token', 'fx-sync-token')

# Roles integrados (IDs fijos en todos los tenants).
$RoleIds = @{
    Contributor          = 'b24988ac-6180-42a0-ab88-20f7382dd24c'
    KeyVaultSecretsUser  = '4633458b-17de-408a-b874-0445c86b69e6'
    KeyVaultSecretsOfficer = 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'
    RbacAdministrator    = 'f58310d9-a9f6-439a-9e8d-f62e7b41a168'
}

$GitHubOidcIssuer = 'https://token.actions.githubusercontent.com'
$GitHubOidcAudience = 'api://AzureADTokenExchange'

# =============================================================================
# Salida
# =============================================================================

function Write-Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host "    OK  $Message" -ForegroundColor Green }
function Write-Note([string]$Message) { Write-Host "    $Message" }
function Write-Warn([string]$Message) { Write-Host "    AVISO  $Message" -ForegroundColor Yellow }
function Stop-WithError([string]$Message) {
    Write-Host ''
    Write-Host "ERROR: $Message" -ForegroundColor Red
    exit 1
}

# =============================================================================
# Ejecución de az / gh
# =============================================================================

# Ejecuta un comando nativo y lanza excepción si falla. Devuelve stdout como un
# solo string. stderr va directo a la consola (los avisos de az no rompen el
# JSON). NUNCA pases secretos como argumento: quedarían visibles en la lista de
# procesos; ver Set-KeyVaultSecretValue.
function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$Exe,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [switch]$AllowFailure
    )
    # En 5.1, con ErrorActionPreference=Stop, la salida de error de un comando
    # nativo redirigida se convierte en excepción. Se relaja solo aquí.
    $ErrorActionPreference = 'Continue'
    if ($AllowFailure) {
        $out = & $Exe @Arguments 2>$null
    } else {
        $out = & $Exe @Arguments
    }
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        if ($AllowFailure) { return $null }
        throw "Falló: $Exe $($Arguments[0]) $($Arguments[1]) (código $code)"
    }
    if ($null -eq $out) { return '' }
    return (@($out) -join "`n").Trim()
}

function Invoke-Az {
    param([Parameter(Mandatory = $true)][string[]]$Arguments, [switch]$AllowFailure)
    Invoke-Native -Exe 'az' -Arguments ($Arguments + @('--only-show-errors')) -AllowFailure:$AllowFailure
}

function Invoke-AzJson {
    param([Parameter(Mandatory = $true)][string[]]$Arguments, [switch]$AllowFailure)
    $raw = Invoke-Az -Arguments ($Arguments + @('-o', 'json')) -AllowFailure:$AllowFailure
    return (ConvertFrom-AzOutput $raw)
}

# Convierte la salida JSON de az. Con un .bicepparam, az puede escribir en stdout
# líneas de Bicep (avisos del linter o "A new Bicep release is available")
# ANTES del JSON: se muestran como aviso y se descartan.
function ConvertFrom-AzOutput([string]$Raw) {
    if ([string]::IsNullOrWhiteSpace($Raw)) { return $null }
    $lines = $Raw -split "`n"
    $start = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^\s*[\[\{]') { $start = $i; break }
    }
    if ($start -lt 0) { Stop-WithError "az no devolvió JSON. Salida:`n$Raw" }
    for ($i = 0; $i -lt $start; $i++) {
        if ($lines[$i].Trim()) { Write-Warn ("az: " + $lines[$i].Trim()) }
    }
    return (($lines[$start..($lines.Count - 1)] -join "`n") | ConvertFrom-Json)
}

function Invoke-Gh {
    param([Parameter(Mandatory = $true)][string[]]$Arguments, [switch]$AllowFailure)
    Invoke-Native -Exe 'gh' -Arguments $Arguments -AllowFailure:$AllowFailure
}

# Prefijo del claim `sub` del token OIDC que GitHub emite para el repositorio.
# Puede ser el clásico (`repo:dueño/repo`) o el inmutable con IDs numéricos
# (`repo:dueño@123/repo@456`), según `use_immutable_subject` del repo. Entra ID
# compara el `sub` exacto: con el formato equivocado el login falla con
# AADSTS700213. Synatrack usa el inmutable (visto el 2026-11-11).
function Get-GitHubOidcSubjectPrefix([string]$Repo) {
    $raw = Invoke-Gh -Arguments @('api', "repos/$Repo/actions/oidc/customization/sub") -AllowFailure
    if ($raw) {
        try {
            $c = $raw | ConvertFrom-Json
            if ($c.use_default -eq $false) {
                Write-Warn 'El repositorio usa una plantilla OIDC personalizada: revisa a mano el subject de las credenciales federadas.'
            }
            if ($c.sub_claim_prefix) { return [string]$c.sub_claim_prefix }
        } catch { }
    }
    Write-Warn "No pude leer la configuración OIDC del repositorio en GitHub; uso el formato clásico repo:$Repo."
    return "repo:$Repo"
}

function Assert-Tool([string]$Exe, [string]$InstallHint) {
    if (-not (Get-Command $Exe -ErrorAction SilentlyContinue)) {
        Stop-WithError "No se encontró '$Exe'. $InstallHint"
    }
}

# Código HTTP de un error de Invoke-WebRequest/Invoke-RestMethod (0 si no hubo
# respuesta). Funciona en 5.1 (WebException) y en 7 (HttpResponseException).
function Get-HttpStatusFromError($ErrorRecord) {
    $ex = $ErrorRecord.Exception
    if ($ex.PSObject.Properties['Response'] -and $null -ne $ex.Response) {
        try { return [int]$ex.Response.StatusCode } catch { return 0 }
    }
    return 0
}

# Escribe un JSON temporal (solo para contenido NO sensible) y devuelve la ruta.
function New-TempJsonFile($Object) {
    $path = Join-Path ([System.IO.Path]::GetTempPath()) ("synatrack-" + [guid]::NewGuid().ToString('N') + '.json')
    # -InputObject (y no tubería) para que un arreglo de un elemento siga siendo arreglo.
    $json = ConvertTo-Json -InputObject $Object -Depth 10
    [System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))
    return $path
}

# =============================================================================
# Configuración
# =============================================================================

# Ruta de la configuración, en este orden:
#   1. -ConfigFile <ruta>
#   2. variable de entorno SYNATRACK_AZURE_CONFIG
#   3. infra/azure.config.psd1; si ese archivo solo trae la clave ConfigFile
#      (p. ej. ConfigFile = "C:\secretos\azure.config.psd1"), se sigue esa ruta.
# Así la config real puede vivir fuera del repositorio (y de OneDrive).
function Resolve-ConfigPath {
    $candidate = ''
    $origin = ''
    if ($ConfigFile) { $candidate = $ConfigFile; $origin = '-ConfigFile' }
    elseif ($env:SYNATRACK_AZURE_CONFIG) { $candidate = $env:SYNATRACK_AZURE_CONFIG; $origin = 'SYNATRACK_AZURE_CONFIG' }
    if ($candidate) {
        $candidate = [Environment]::ExpandEnvironmentVariables($candidate)
        if (-not (Test-Path -LiteralPath $candidate)) { Stop-WithError "No existe el archivo de configuración indicado en ${origin}: $candidate" }
        return $candidate
    }
    if (-not (Test-Path -LiteralPath $ConfigPath)) {
        Stop-WithError ("No existe infra/azure.config.psd1.`n" +
            "  Opción 1: cópialo desde la plantilla y llena los valores:`n" +
            "    Copy-Item infra/azure.config.example.psd1 infra/azure.config.psd1`n" +
            "  Opción 2: guarda la config fuera del repositorio y apúntala con -ConfigFile,`n" +
            "    con la variable de entorno SYNATRACK_AZURE_CONFIG o con una sola línea en`n" +
            "    infra/azure.config.psd1:  @{ ConfigFile = 'C:\ruta\azure.config.psd1' }`n" +
            "  Plantilla: $ExampleConfigPath")
    }
    $local = Import-PowerShellDataFile -LiteralPath $ConfigPath
    if ($local.ContainsKey('ConfigFile') -and -not [string]::IsNullOrWhiteSpace([string]$local.ConfigFile)) {
        $target = [Environment]::ExpandEnvironmentVariables([string]$local.ConfigFile)
        if (-not (Test-Path -LiteralPath $target)) { Stop-WithError "infra/azure.config.psd1 apunta (ConfigFile) a un archivo que no existe: $target" }
        return $target
    }
    return $ConfigPath
}

function Get-Config {
    $path = Resolve-ConfigPath
    $label = $path
    if ($path -eq $ConfigPath) { $label = 'infra/azure.config.psd1' } else { Write-Note "Configuración: $path" }
    $cfg = Import-PowerShellDataFile -LiteralPath $path
    foreach ($key in @('TenantId', 'SubscriptionId', 'Location', 'GitHubRepo', 'AlertEmail', 'MonthlyBudgetUsd',
            'AppClientId', 'AppApiScope', 'AdminEmail', 'Environments')) {
        if (-not $cfg.ContainsKey($key) -or [string]::IsNullOrWhiteSpace([string]$cfg[$key])) {
            $hint = ''
            if ($path -eq $ConfigPath) { $hint = " Si la config real está en otra carpeta, apúntala con ConfigFile, -ConfigFile o SYNATRACK_AZURE_CONFIG." }
            Stop-WithError "Falta la clave '$key' en $label (ver la plantilla).$hint"
        }
    }
    if ($cfg.TenantId -eq '00000000-0000-0000-0000-000000000000') {
        Stop-WithError "$label todavía tiene los valores de ejemplo."
    }
    if (-not $cfg.Environments.ContainsKey($Environment)) {
        Stop-WithError "$label no define Environments.$Environment."
    }
    foreach ($key in @('ResourceGroup', 'GitBranch')) {
        if ([string]::IsNullOrWhiteSpace([string]$cfg.Environments[$Environment][$key])) {
            Stop-WithError "Falta Environments.$Environment.$key en $label."
        }
    }
    return $cfg
}

# Lee una clave opcional (primero del entorno, luego global) con valor por defecto.
function Get-Opt($Cfg, [string]$Key, $Default = '') {
    $envCfg = $Cfg.Environments[$Environment]
    if ($envCfg.ContainsKey($Key) -and $null -ne $envCfg[$Key]) { return $envCfg[$Key] }
    if ($Cfg.ContainsKey($Key) -and $null -ne $Cfg[$Key]) { return $Cfg[$Key] }
    return $Default
}

function Get-EnvCfg($Cfg) { return $Cfg.Environments[$Environment] }

# Resource group del servidor de Postgres (Environments.<env>.DataResourceGroup).
# Si no se define, el servidor va en el mismo RG de la app (comportamiento previo).
function Get-DataResourceGroup($Cfg) {
    $envCfg = Get-EnvCfg $Cfg
    $value = [string]$envCfg['DataResourceGroup']
    if ([string]::IsNullOrWhiteSpace($value)) { return [string]$envCfg.ResourceGroup }
    return $value
}

# AZURE_AD_AUDIENCE (el backend acepta una lista separada por comas): valor
# explícito (ApiAudience) o, por defecto, los valores que puede traer la claim
# `aud`: "api://<AppClientId>" (tokens v1), "<AppClientId>" (tokens v2) y el App
# ID URI deducido de AppApiScope si es distinto ("api://<id>/access_as_user" ->
# "api://<id>").
function Get-ApiAudience($Cfg) {
    $explicit = [string](Get-Opt $Cfg 'ApiAudience' '')
    if ($explicit) { return $explicit }
    $clientId = [string]$Cfg.AppClientId
    $values = New-Object System.Collections.Generic.List[string]
    $values.Add("api://$clientId")
    $values.Add($clientId)
    $scope = [string]$Cfg.AppApiScope
    $idx = $scope.LastIndexOf('/')
    if ($idx -le 'api://'.Length) { Stop-WithError "AppApiScope no tiene la forma api://<id>/<scope>: $scope" }
    $appIdUri = $scope.Substring(0, $idx)
    if (-not $values.Contains($appIdUri)) { $values.Add($appIdUri) }
    return ($values -join ',')
}

function Get-CreateSwa($Cfg) {
    $value = Get-Opt $Cfg 'CreateStaticWebApp' $true
    return [bool]$value
}

function Get-RepoParts($Cfg) {
    $parts = ([string]$Cfg.GitHubRepo).Split('/')
    if ($parts.Count -ne 2) { Stop-WithError "GitHubRepo debe tener la forma propietario/repositorio: $($Cfg.GitHubRepo)" }
    return $parts
}

# Parámetros NO sensibles del Bicep, con el nombre de la variable de entorno que
# lee params/<env>.bicepparam. La misma tabla se publica en GitHub (codificada)
# para que infra-azure.yml despliegue exactamente lo mismo.
function Get-InfraParams($Cfg) {
    $p = [ordered]@{
        SYNATRACK_TENANT_ID          = [string]$Cfg.TenantId
        SYNATRACK_API_AUDIENCE       = (Get-ApiAudience $Cfg)
        SYNATRACK_ADMIN_EMAIL        = [string]$Cfg.AdminEmail
        SYNATRACK_ALERT_EMAIL        = [string]$Cfg.AlertEmail
        SYNATRACK_MONTHLY_BUDGET_USD = [string](Get-Opt $Cfg 'MonthlyBudgetUsd' 150)
        SYNATRACK_FRONTEND_URL       = [string](Get-Opt $Cfg 'FrontendUrl' '')
        SYNATRACK_EXTRA_CORS_ORIGINS = [string](Get-Opt $Cfg 'ExtraCorsOrigins' '')
        SYNATRACK_CREATE_SWA         = $(if (Get-CreateSwa $Cfg) { 'true' } else { 'false' })
        SYNATRACK_SUPPORT_EMAIL      = [string](Get-Opt $Cfg 'SupportEmail' '')
        SYNATRACK_PAYROLL_EMAIL      = [string](Get-Opt $Cfg 'PayrollEmail' '')
        SYNATRACK_SMTP_HOST          = [string](Get-Opt $Cfg 'SmtpHost' '')
        SYNATRACK_SMTP_PORT          = [string](Get-Opt $Cfg 'SmtpPort' '587')
        SYNATRACK_SMTP_USER          = [string](Get-Opt $Cfg 'SmtpUser' '')
        SYNATRACK_SMTP_FROM          = [string](Get-Opt $Cfg 'SmtpFrom' '')
        SYNATRACK_LINUX_FX_VERSION   = [string](Get-Opt $Cfg 'LinuxFxVersion' 'NODE|24-lts')
        SYNATRACK_DATA_RESOURCE_GROUP = (Get-DataResourceGroup $Cfg)
        SYNATRACK_POSTGRES_SERVER_NAME = [string]((Get-EnvCfg $Cfg)['PostgresServerName'])
    }
    return $p
}

function ConvertTo-Base64Json($Map) {
    $json = ($Map | ConvertTo-Json -Compress)
    return [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json))
}

function Confirm-ProdChange([string]$Action) {
    if ($Environment -ne 'prod') { return }
    Write-Host ''
    Write-Host "Vas a $Action en PRODUCCIÓN." -ForegroundColor Yellow
    $answer = Read-Host "Escribe 'prod' para continuar"
    if ($answer -ne 'prod') { Stop-WithError 'Cancelado: no se confirmó.' }
}

# =============================================================================
# Contexto de Azure y recursos
# =============================================================================

function Assert-AzContext($Cfg) {
    Assert-Tool 'az' 'Instala Azure CLI: https://aka.ms/installazurecli'
    $account = Invoke-AzJson -Arguments @('account', 'show') -AllowFailure
    if ($null -eq $account) { Stop-WithError 'No hay sesión de Azure. Ejecuta: .\scripts\azure.ps1 login' }
    if ($account.tenantId -ne $Cfg.TenantId -or $account.id -ne $Cfg.SubscriptionId) {
        Write-Note "Seleccionando la suscripción de la config..."
        Invoke-Az -Arguments @('account', 'set', '--subscription', $Cfg.SubscriptionId) | Out-Null
        $account = Invoke-AzJson -Arguments @('account', 'show')
        if ($account.tenantId -ne $Cfg.TenantId) {
            Stop-WithError 'La sesión de az es de otro tenant. Ejecuta: .\scripts\azure.ps1 login'
        }
    }
    return $account
}

function Assert-GhContext {
    Assert-Tool 'gh' 'Instala GitHub CLI: https://cli.github.com'
    $null = Invoke-Gh -Arguments @('auth', 'status') -AllowFailure
    if ($LASTEXITCODE -ne 0) { Stop-WithError 'No hay sesión de GitHub CLI. Ejecuta: gh auth login' }
}

function Test-ResourceGroup([string]$Rg) {
    $exists = Invoke-Az -Arguments @('group', 'exists', '--name', $Rg)
    return ($exists -eq 'true')
}

function Assert-ResourceGroup([string]$Rg) {
    if (-not (Test-ResourceGroup $Rg)) {
        Stop-WithError "No existe el resource group '$Rg'. Ejecuta primero: .\scripts\azure.ps1 bootstrap -Env $Environment"
    }
}

# Crea el resource group en $Location o comprueba que el existente esté ahí. Los
# recursos del Bicep toman la región del RG: uno que quedó en otra región (p. ej.
# de un intento previo en eastus2) desplegaría todo en el lugar equivocado.
function Confirm-ResourceGroup([string]$Rg, [string]$Location, [string]$AppTag) {
    if (Test-ResourceGroup $Rg) {
        $current = Invoke-Az -Arguments @('group', 'show', '--name', $Rg, '--query', 'location', '-o', 'tsv')
        if ($current -ne $Location) {
            $count = Invoke-Az -Arguments @('resource', 'list', '-g', $Rg, '--query', 'length(@)', '-o', 'tsv') -AllowFailure
            Stop-WithError ("El resource group '$Rg' existe en '$current' y la config pide '$Location'.`n" +
                "  La región de un RG no se puede cambiar. Tiene $count recurso(s). Si no hay nada que conservar:`n" +
                "    az group delete --name $Rg`n" +
                "  y vuelve a ejecutar bootstrap -Env $Environment (recrea el RG y sus roles).")
        }
        Write-Ok "Ya existe ($current)."
        return
    }
    Invoke-Az -Arguments @('group', 'create', '--name', $Rg, '--location', $Location,
        '--tags', "app=$AppTag", "env=$Environment", 'managedBy=bicep', '-o', 'none') | Out-Null
    Write-Ok "Creado ($Location)."
}

# Nombre de un recurso del RG por tipo (primer resultado) o '' si no hay.
function Get-ResourceName([string]$Rg, [string]$Type) {
    $name = Invoke-Az -Arguments @('resource', 'list', '-g', $Rg, '--resource-type', $Type, '--query', '[0].name', '-o', 'tsv') -AllowFailure
    if ($null -eq $name) { return '' }
    return $name
}

# Key Vault de la app o el de datos (etiqueta rol=datos). Se distinguen por la
# etiqueta porque, sin DataResourceGroup, los dos viven en el mismo RG.
function Find-KeyVault([string]$Rg, [switch]$Data) {
    $filter = $(if ($Data) { "[?tags.rol=='datos'] | [0].name" } else { "[?tags.rol!='datos'] | [0].name" })
    $name = Invoke-Az -Arguments @('keyvault', 'list', '-g', $Rg, '--query', $filter, '-o', 'tsv') -AllowFailure
    if ($null -eq $name) { return '' }
    return [string]$name
}

function Get-Outputs {
    $file = Join-Path $OutDir "$Environment.json"
    if (Test-Path -LiteralPath $file) {
        return (Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json)
    }
    return $null
}

# Nombres reales del entorno: de infra/.out/<env>.json o descubiertos en el RG.
function Get-EnvResources($Cfg) {
    $rg = (Get-EnvCfg $Cfg).ResourceGroup
    $dataRg = Get-DataResourceGroup $Cfg
    $out = Get-Outputs
    $r = [ordered]@{
        ResourceGroup = $rg
        DataResourceGroup = $dataRg
        WebApp        = ''
        Plan          = ''
        Postgres      = ''
        KeyVault      = ''
        DataKeyVault  = ''
        StaticWebApp  = ''
        SwaResourceGroup = $rg
        AppInsights   = ''
        WorkspaceId   = ''
        WebTest       = ''
    }
    if ($null -ne $out) {
        $r.WebApp = [string]$out.webAppName
        $r.Plan = [string]$out.appServicePlanName
        $r.Postgres = [string]$out.postgresServerName
        $r.KeyVault = [string]$out.keyVaultName
        $r.DataKeyVault = [string]$out.dataKeyVaultName
        $r.StaticWebApp = [string]$out.staticWebAppName
        $r.AppInsights = [string]$out.appInsightsName
        $r.WorkspaceId = [string]$out.logAnalyticsCustomerId
        $r.WebTest = [string]$out.webTestName
    } else {
        $r.WebApp = Get-ResourceName $rg 'Microsoft.Web/sites'
        $r.Plan = Get-ResourceName $rg 'Microsoft.Web/serverfarms'
        # El RG de datos puede alojar servidores de otras apps: si la config
        # fija el nombre, se usa ese; si no, el primero que haya.
        $pgName = [string]((Get-EnvCfg $Cfg)['PostgresServerName'])
        if ($pgName) {
            $found = Invoke-Az -Arguments @('postgres', 'flexible-server', 'show', '-g', $dataRg, '-n', $pgName, '--query', 'name', '-o', 'tsv') -AllowFailure
            $r.Postgres = [string]$found
        } else {
            $r.Postgres = Get-ResourceName $dataRg 'Microsoft.DBforPostgreSQL/flexibleServers'
        }
        $r.KeyVault = Find-KeyVault $rg
        $r.StaticWebApp = Get-ResourceName $rg 'Microsoft.Web/staticSites'
        $r.AppInsights = Get-ResourceName $rg 'Microsoft.Insights/components'
        $ws = Get-ResourceName $rg 'Microsoft.OperationalInsights/workspaces'
        if ($ws) {
            $r.WorkspaceId = Invoke-Az -Arguments @('monitor', 'log-analytics', 'workspace', 'show', '-g', $rg, '-n', $ws, '--query', 'customerId', '-o', 'tsv') -AllowFailure
        }
    }
    # Salidas de un despliegue anterior al Key Vault de datos: se busca en el RG.
    if (-not $r.DataKeyVault) { $r.DataKeyVault = Find-KeyVault $dataRg -Data }
    if (-not (Get-CreateSwa $Cfg)) {
        $existing = [string](Get-Opt $Cfg 'ExistingSwaName' '')
        if ($existing) {
            $r.StaticWebApp = $existing
            $r.SwaResourceGroup = [string](Get-Opt $Cfg 'ExistingSwaResourceGroup' $rg)
        }
    }
    return $r
}

# =============================================================================
# Secretos
# =============================================================================

function New-RandomSecret([int]$Length = 40) {
    # Solo alfanuméricos: van dentro de una URL (database-url) y de encabezados.
    $upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
    $lower = 'abcdefghijkmnpqrstuvwxyz'
    $digits = '23456789'
    $all = $upper + $lower + $digits
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] ($Length)
    $rng.GetBytes($bytes)
    $chars = New-Object char[] ($Length)
    for ($i = 0; $i -lt $Length; $i++) { $chars[$i] = $all[$bytes[$i] % $all.Length] }
    # Garantiza las 3 categorías que exige Postgres.
    $chars[0] = $upper[$bytes[0] % $upper.Length]
    $chars[1] = $lower[$bytes[1] % $lower.Length]
    $chars[2] = $digits[$bytes[2] % $digits.Length]
    $rng.Dispose()
    return (-join $chars)
}

function Get-KeyVaultSecretValue([string]$Vault, [string]$SecretName) {
    if (-not $Vault) { return $null }
    $value = Invoke-Az -Arguments @('keyvault', 'secret', 'show', '--vault-name', $Vault, '--name', $SecretName, '--query', 'value', '-o', 'tsv') -AllowFailure
    if ([string]::IsNullOrEmpty($value)) { return $null }
    return $value
}

# Escribe un secreto con la API REST de Key Vault: el valor viaja solo en el
# cuerpo HTTPS, nunca como argumento de un proceso ni en un archivo.
function Set-KeyVaultSecretValue([string]$Vault, [string]$SecretName, [string]$Value) {
    $token = Invoke-Az -Arguments @('account', 'get-access-token', '--resource', 'https://vault.azure.net', '--query', 'accessToken', '-o', 'tsv')
    $uri = "https://$Vault.vault.azure.net/secrets/$($SecretName)?api-version=7.4"
    $body = @{ value = $Value; contentType = 'text/plain' } | ConvertTo-Json -Compress
    try {
        $null = Invoke-RestMethod -Method Put -Uri $uri -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
    } catch {
        $status = Get-HttpStatusFromError $_
        if ($status -eq 403) {
            Stop-WithError "Key Vault rechazó la escritura (403). La cuenta debe estar en el grupo de operadores (rol Key Vault Secrets Officer; ver: azure.ps1 access). Los cambios de grupo tardan unos minutos."
        }
        Stop-WithError "No se pudo escribir el secreto '$SecretName' (HTTP $status)."
    } finally {
        $body = $null
        $token = $null
    }
}

function Get-PresentOptionalSecrets([string]$Vault) {
    if (-not $Vault) { return @() }
    $names = Invoke-Az -Arguments @('keyvault', 'secret', 'list', '--vault-name', $Vault, '--query', '[?attributes.enabled].name', '-o', 'tsv') -AllowFailure
    if (-not $names) { return @() }
    return @($names -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $OptionalSecrets.Contains($_) })
}

# Contraseña de Postgres: se relee del Key Vault; solo se genera si el entorno es
# nuevo. Si el servidor existe pero el secreto no, se pide confirmación porque
# desplegar con otra contraseña la CAMBIA en el servidor.
#
# Vive en el Key Vault de DATOS. Los entornos creados antes la tienen en el de la
# app: se toma de ahí, el despliegue la escribe en el de datos y
# Remove-LegacyPostgresPassword borra la copia vieja.
function Resolve-PostgresPassword($Res, [switch]$ForWhatIf) {
    $existing = Get-KeyVaultSecretValue $Res.DataKeyVault 'postgres-admin-password'
    if ($existing) {
        Write-Ok "Contraseña de Postgres leída del Key Vault de datos ($($Res.DataKeyVault))."
        return $existing
    }
    $legacy = Get-KeyVaultSecretValue $Res.KeyVault 'postgres-admin-password'
    if ($legacy) {
        Write-Ok "Contraseña de Postgres leída del Key Vault de la app ($($Res.KeyVault)); este despliegue la pasa al de datos."
        return $legacy
    }
    if ($ForWhatIf) {
        Write-Note 'Sin contraseña en Key Vault todavía: el what-if usa una temporal que no se guarda.'
        return (New-RandomSecret 32)
    }
    if ($Res.Postgres) {
        Write-Warn "El servidor '$($Res.Postgres)' ya existe pero Key Vault no tiene 'postgres-admin-password'."
        Write-Warn 'Si sigues, se genera una contraseña nueva y se CAMBIA la del servidor (y database-url).'
        $answer = Read-Host "Escribe 'cambiar' para continuar"
        if ($answer -ne 'cambiar') { Stop-WithError 'Cancelado.' }
    } else {
        Write-Note 'Entorno nuevo: se genera la contraseña de Postgres (irá directo a Key Vault).'
    }
    return (New-RandomSecret 32)
}

# Tras un despliegue exitoso: si la contraseña sigue en el Key Vault de la app y
# el de datos ya tiene la MISMA, se borra la de la app (borrado suave: se puede
# recuperar durante la retención). Así la identidad del Web App deja de verla.
function Remove-LegacyPostgresPassword([string]$AppVault, [string]$DataVault) {
    if (-not $AppVault -or -not $DataVault) { return }
    $legacy = Get-KeyVaultSecretValue $AppVault 'postgres-admin-password'
    if (-not $legacy) { return }
    $current = Get-KeyVaultSecretValue $DataVault 'postgres-admin-password'
    if ($current -ne $legacy) {
        Write-Warn "La contraseña de Postgres en $AppVault no coincide con la de $DataVault; no se borra. Revisar a mano."
        return
    }
    Invoke-Az -Arguments @('keyvault', 'secret', 'delete', '--vault-name', $AppVault, '--name', 'postgres-admin-password', '-o', 'none') | Out-Null
    Write-Ok "Contraseña de Postgres trasladada a $DataVault; borrada de $AppVault (borrado suave)."
}

# Fecha de inicio del presupuesto: la del presupuesto existente (no se puede
# cambiar) o el primer día del mes actual (UTC).
function Get-BudgetStartDate($Cfg, [string]$Rg) {
    $budgetName = "budget-synatrack-$Environment"
    $url = "https://management.azure.com/subscriptions/$($Cfg.SubscriptionId)/resourceGroups/$Rg/providers/Microsoft.Consumption/budgets/$($budgetName)?api-version=2023-11-01"
    $start = Invoke-Az -Arguments @('rest', '--method', 'get', '--url', $url, '--query', 'properties.timePeriod.startDate', '-o', 'tsv') -AllowFailure
    if ($start) { return $start.Substring(0, 10) }
    $now = [DateTime]::UtcNow
    return ('{0:yyyy}-{0:MM}-01' -f $now)
}

# Exporta las variables que lee el .bicepparam y ejecuta el bloque. La
# contraseña solo vive en el entorno del proceso y se borra al terminar.
function Invoke-WithInfraEnv($Cfg, $Res, [switch]$ForWhatIf, [scriptblock]$Body) {
    $params = Get-InfraParams $Cfg
    $params['SYNATRACK_BUDGET_START_DATE'] = Get-BudgetStartDate $Cfg $Res.ResourceGroup
    $params['SYNATRACK_PRESENT_SECRETS'] = ((Get-PresentOptionalSecrets $Res.KeyVault) -join ',')
    if ($params['SYNATRACK_PRESENT_SECRETS']) {
        Write-Note "Secretos opcionales presentes: $($params['SYNATRACK_PRESENT_SECRETS'])"
    } else {
        Write-Note 'Secretos opcionales presentes: ninguno (cárgalos con secret-set).'
    }
    $password = Resolve-PostgresPassword $Res -ForWhatIf:$ForWhatIf
    try {
        foreach ($k in $params.Keys) { Set-Item -Path "Env:$k" -Value ([string]$params[$k]) }
        Set-Item -Path 'Env:SYNATRACK_PG_ADMIN_PASSWORD' -Value $password
        & $Body
    } finally {
        Remove-Item -Path 'Env:SYNATRACK_PG_ADMIN_PASSWORD' -ErrorAction SilentlyContinue
        foreach ($k in $params.Keys) { Remove-Item -Path "Env:$k" -ErrorAction SilentlyContinue }
        $password = $null
    }
}

# =============================================================================
# GitHub
# =============================================================================

# GitHub Free con repositorio privado NO tiene variables por Environment (ni
# revisores obligatorios). Por eso todas las variables van a nivel de
# repositorio y las de cada entorno llevan sufijo: AZURE_WEBAPP_NAME_STAGE,
# AZURE_WEBAPP_NAME_PROD... Los workflows eligen el sufijo según el entorno.
function Set-GhVariable($Cfg, [string]$VarName, [string]$Value) {
    $scope = @('--repo', $Cfg.GitHubRepo)
    if ([string]::IsNullOrEmpty($Value)) {
        # GitHub no admite variables vacías: si no hay valor, se borra.
        $null = Invoke-Gh -Arguments (@('variable', 'delete', $VarName) + $scope) -AllowFailure
        Write-Note "$VarName (vacía, se borra si existía)"
        return
    }
    Invoke-Gh -Arguments (@('variable', 'set', $VarName, '--body', $Value) + $scope) | Out-Null
    Write-Ok $VarName
}

# Variable propia del entorno actual: <Base>_STAGE o <Base>_PROD.
function Set-GhEnvVariable($Cfg, [string]$BaseName, [string]$Value) {
    Set-GhVariable $Cfg ("{0}_{1}" -f $BaseName, $Environment.ToUpperInvariant()) $Value
}

function Set-GhInfraVariables($Cfg) {
    Set-GhEnvVariable $Cfg 'AZURE_INFRA_PARAMS_B64' (ConvertTo-Base64Json (Get-InfraParams $Cfg))
}

function Set-GhOutputVariables($Cfg, $Outputs) {
    $envCfg = Get-EnvCfg $Cfg
    $swaName = [string]$Outputs.staticWebAppName
    $swaRg = $envCfg.ResourceGroup
    if (-not $swaName) {
        $swaName = [string](Get-Opt $Cfg 'ExistingSwaName' '')
        $swaRg = [string](Get-Opt $Cfg 'ExistingSwaResourceGroup' $envCfg.ResourceGroup)
    }
    Set-GhEnvVariable $Cfg 'AZURE_WEBAPP_NAME' ([string]$Outputs.webAppName)
    Set-GhEnvVariable $Cfg 'AZURE_API_URL' ([string]$Outputs.apiUrl)
    Set-GhEnvVariable $Cfg 'AZURE_KEYVAULT_NAME' ([string]$Outputs.keyVaultName)
    Set-GhEnvVariable $Cfg 'AZURE_POSTGRES_SERVER' ([string]$Outputs.postgresServerName)
    Set-GhEnvVariable $Cfg 'AZURE_POSTGRES_RESOURCE_GROUP' (Get-DataResourceGroup $Cfg)
    Set-GhEnvVariable $Cfg 'AZURE_SWA_NAME' $swaName
    Set-GhEnvVariable $Cfg 'AZURE_SWA_RESOURCE_GROUP' $swaRg
    Set-GhEnvVariable $Cfg 'AZURE_FRONTEND_URL' ([string]$Outputs.frontendUrl)
}

# =============================================================================
# Comandos
# =============================================================================

function Invoke-Login($Cfg) {
    Assert-Tool 'az' 'Instala Azure CLI: https://aka.ms/installazurecli'
    Write-Step "Iniciando sesión en el tenant $($Cfg.TenantId)"
    Invoke-Native -Exe 'az' -Arguments @('login', '--tenant', $Cfg.TenantId, '--only-show-errors', '-o', 'none') | Out-Null
    Invoke-Az -Arguments @('account', 'set', '--subscription', $Cfg.SubscriptionId) | Out-Null
    $acc = Invoke-AzJson -Arguments @('account', 'show')
    Write-Ok "Suscripción: $($acc.name) ($($acc.id))"
    Write-Ok "Usuario: $($acc.user.name)"
    if (Get-Command gh -ErrorAction SilentlyContinue) {
        $null = Invoke-Gh -Arguments @('auth', 'status') -AllowFailure
        if ($LASTEXITCODE -ne 0) { Write-Warn 'GitHub CLI sin sesión: ejecuta `gh auth login` antes de bootstrap/deploy.' }
        else { Write-Ok 'GitHub CLI con sesión.' }
    } else {
        Write-Warn 'GitHub CLI (gh) no está instalado; lo necesitan bootstrap, infra, deploy y rollback.'
    }
}

# Condición ABAC para "Role Based Access Control Administrator": solo permite
# asignar o quitar "Key Vault Secrets User", y solo a service principals (la
# identidad administrada del Web App, que es lo único que crea el Bicep). Con
# ella, quien la tenga no puede darse Owner ni darle nada a un usuario o grupo.
function Get-KvRbacCondition {
    $kvUser = $RoleIds.KeyVaultSecretsUser
    return "((!(ActionMatches{'Microsoft.Authorization/roleAssignments/write'})) OR " +
        "(@Request[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {$kvUser} AND " +
        "@Request[Microsoft.Authorization/roleAssignments:PrincipalType] StringEqualsIgnoreCase 'ServicePrincipal')) AND " +
        "((!(ActionMatches{'Microsoft.Authorization/roleAssignments/delete'})) OR " +
        "(@Resource[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {$kvUser}))"
}

# Grupo de operadores de Entra (OperatorsGroup: nombre o object id). Devuelve
# $null si la clave no está en la config; detiene el script si está pero el
# grupo no existe. El grupo NO se crea desde aquí: lo administra TI en Entra.
function Resolve-OperatorsGroup($Cfg) {
    $ref = [string](Get-Opt $Cfg 'OperatorsGroup' '')
    if (-not $ref) { return $null }
    $g = Invoke-AzJson -Arguments @('ad', 'group', 'show', '--group', $ref, '--query', '{id:id, name:displayName, security:securityEnabled}') -AllowFailure
    if ($null -eq $g -or -not $g.id) {
        Stop-WithError ("No se encontró en Entra ID el grupo de operadores '$ref' (OperatorsGroup).`n" +
            "  TI debe crearlo como grupo de SEGURIDAD y agregar a los operadores; luego repite el comando.`n" +
            "  Si hay varios grupos con ese nombre, usa su object id.")
    }
    if (-not $g.security) {
        Stop-WithError "El grupo '$($g.name)' no es de seguridad: Azure RBAC solo admite grupos con seguridad habilitada."
    }
    return $g
}

# Roles que necesita un OPERADOR para correr todos los comandos del script
# salvo bootstrap (que exige Owner de la suscripción). Ver infra/README.md §8.
function Add-OperatorRoles([string]$PrincipalId, [string]$PrincipalType, [string]$Label, [string]$RgId) {
    # plan/infra/status/health/logs/access: crear y leer recursos, desplegar el
    # Bicep, reiniciar el Web App, firewall, Log Analytics y alertas.
    Add-RoleAssignment $PrincipalId $PrincipalType $RoleIds.Contributor "Contributor para $Label" $RgId ''
    # infra relee postgres-admin-password; secret-set escribe secretos (plano de datos).
    Add-RoleAssignment $PrincipalId $PrincipalType $RoleIds.KeyVaultSecretsOfficer "Key Vault Secrets Officer para $Label" $RgId ''
    # infra: el Bicep crea (o reafirma) la asignación Key Vault Secrets User del
    # Web App, y el despliegue corre con la identidad de quien lo lanza.
    Add-RoleAssignment $PrincipalId $PrincipalType $RoleIds.RbacAdministrator "Role Based Access Control Administrator (condicionado) para $Label" $RgId (Get-KvRbacCondition)
}

function Add-RoleAssignment([string]$PrincipalId, [string]$PrincipalType, [string]$RoleId, [string]$RoleLabel, [string]$Scope, [string]$Condition) {
    $existing = Invoke-Az -Arguments @('role', 'assignment', 'list', '--assignee', $PrincipalId, '--scope', $Scope,
        '--query', "[?ends_with(roleDefinitionId, '$RoleId')] | length(@)", '-o', 'tsv') -AllowFailure
    if ($existing -and [int]$existing -gt 0) {
        Write-Ok "$RoleLabel (ya estaba)"
        return
    }
    $azArgs = @('role', 'assignment', 'create', '--assignee-object-id', $PrincipalId, '--assignee-principal-type', $PrincipalType,
        '--role', $RoleId, '--scope', $Scope, '-o', 'none')
    if ($Condition) { $azArgs += @('--condition', $Condition, '--condition-version', '2.0') }
    Invoke-Az -Arguments $azArgs | Out-Null
    Write-Ok $RoleLabel
}

function Invoke-Bootstrap($Cfg) {
    $account = Assert-AzContext $Cfg
    Assert-GhContext
    $envCfg = Get-EnvCfg $Cfg
    $rg = $envCfg.ResourceGroup
    $repo = $Cfg.GitHubRepo
    Confirm-ProdChange 'preparar (bootstrap) el entorno'
    # Se valida ANTES de crear nada: si el grupo no existe, no se toca Azure.
    $operators = Resolve-OperatorsGroup $Cfg
    if ($operators) { Write-Ok "Grupo de operadores: $($operators.name) ($($operators.id))" }

    Write-Step 'Registrando proveedores de recursos (una vez por suscripción)'
    foreach ($ns in @('Microsoft.Web', 'Microsoft.DBforPostgreSQL', 'Microsoft.KeyVault', 'Microsoft.Insights',
            'Microsoft.OperationalInsights', 'Microsoft.AlertsManagement', 'Microsoft.Consumption')) {
        $state = Invoke-Az -Arguments @('provider', 'show', '--namespace', $ns, '--query', 'registrationState', '-o', 'tsv') -AllowFailure
        if ($state -ne 'Registered') {
            Invoke-Az -Arguments @('provider', 'register', '--namespace', $ns) | Out-Null
            Write-Ok "$ns (registro solicitado)"
        } else {
            Write-Ok "$ns"
        }
    }

    $dataRg = Get-DataResourceGroup $Cfg
    Write-Step "Resource group $rg ($($Cfg.Location))"
    Confirm-ResourceGroup $rg $Cfg.Location 'synatrack'
    $rgId = "/subscriptions/$($Cfg.SubscriptionId)/resourceGroups/$rg"
    $dataRgId = "/subscriptions/$($Cfg.SubscriptionId)/resourceGroups/$dataRg"
    if ($dataRg -ne $rg) {
        # Servidor de Postgres del entorno, compartible con otras aplicaciones.
        Write-Step "Resource group de datos $dataRg ($($Cfg.Location))"
        Confirm-ResourceGroup $dataRg $Cfg.Location 'compartido'
    }

    # --- Identidad del pipeline (una por entorno) ----------------------------
    # Una app por entorno: la de stage no puede tocar prod y viceversa.
    $appName = "gh-synatrack-$Environment"
    Write-Step "Identidad del pipeline: $appName"
    $appId = Invoke-Az -Arguments @('ad', 'app', 'list', '--display-name', $appName, '--query', '[0].appId', '-o', 'tsv')
    if (-not $appId) {
        $appId = Invoke-Az -Arguments @('ad', 'app', 'create', '--display-name', $appName, '--sign-in-audience', 'AzureADMyOrg', '--query', 'appId', '-o', 'tsv')
        Write-Ok "App registration creada ($appId)"
    } else {
        Write-Ok "App registration existente ($appId)"
    }
    $spId = Invoke-Az -Arguments @('ad', 'sp', 'show', '--id', $appId, '--query', 'id', '-o', 'tsv') -AllowFailure
    if (-not $spId) {
        $spId = Invoke-Az -Arguments @('ad', 'sp', 'create', '--id', $appId, '--query', 'id', '-o', 'tsv')
        Write-Ok 'Service principal creado.'
        # Entra tarda unos segundos en hacerlo visible para RBAC.
        Start-Sleep -Seconds 20
    } else {
        Write-Ok 'Service principal existente.'
    }

    Write-Step 'Credenciales federadas (OIDC de GitHub Actions)'
    # Confianza por RAMA (GitHub Free no ofrece Environments útiles en repos
    # privados): solo los workflows que corren en la rama del entorno obtienen
    # un token. prod = main; un workflow lanzado desde dev u otra rama no puede
    # autenticarse contra prod.
    $branch = [string]$envCfg.GitBranch
    $prefix = Get-GitHubOidcSubjectPrefix $repo
    $subjects = [ordered]@{ "gh-branch-$branch" = "$($prefix):ref:refs/heads/$branch" }
    if ($Environment -eq 'stage') {
        # Solo stage: el what-if de los PR. Dársela a prod permitiría que
        # cualquier PR obtuviera permisos sobre producción.
        $subjects['gh-pull-request'] = "$($prefix):pull_request"
    }
    $existing = @{}
    $fc = Invoke-AzJson -Arguments @('ad', 'app', 'federated-credential', 'list', '--id', $appId)
    if ($fc) { foreach ($c in @($fc)) { $existing[[string]$c.name] = [string]$c.subject } }
    foreach ($credName in $subjects.Keys) {
        $subject = $subjects[$credName]
        if ($existing.ContainsKey($credName) -and $existing[$credName] -eq $subject) { Write-Ok "$subject (ya estaba)"; continue }
        $file = New-TempJsonFile @{
            name        = $credName
            issuer      = $GitHubOidcIssuer
            subject     = $subject
            audiences   = @($GitHubOidcAudience)
            description = "GitHub Actions de $repo ($credName)"
        }
        try {
            if ($existing.ContainsKey($credName)) {
                # Misma credencial con otro subject (p. ej. el formato clásico
                # creado antes): se corrige en vez de duplicarla.
                Invoke-Az -Arguments @('ad', 'app', 'federated-credential', 'update', '--id', $appId, '--federated-credential-id', $credName, '--parameters', "@$file", '-o', 'none') | Out-Null
                Write-Ok "$subject (actualizada; antes $($existing[$credName]))"
            } else {
                Invoke-Az -Arguments @('ad', 'app', 'federated-credential', 'create', '--id', $appId, '--parameters', "@$file", '-o', 'none') | Out-Null
                Write-Ok $subject
            }
        } finally { Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue }
    }

    Write-Step "Roles del pipeline sobre $rg"
    Add-RoleAssignment $spId 'ServicePrincipal' $RoleIds.Contributor 'Contributor' $rgId ''
    # Leer database-url y postgres-admin-password (plano de datos de Key Vault).
    Add-RoleAssignment $spId 'ServicePrincipal' $RoleIds.KeyVaultSecretsUser 'Key Vault Secrets User' $rgId ''
    # El Bicep crea la asignación "Key Vault Secrets User" de la identidad del
    # Web App; Contributor no puede crear asignaciones. Se usa
    # "Role Based Access Control Administrator" con una CONDICIÓN que solo le
    # permite asignar/quitar ese rol, y solo a service principals: así el
    # pipeline no puede darse Owner a sí mismo ni a nadie.
    Add-RoleAssignment $spId 'ServicePrincipal' $RoleIds.RbacAdministrator 'Role Based Access Control Administrator (condicionado a Key Vault Secrets User)' $rgId (Get-KvRbacCondition)
    if ($dataRg -ne $rg) {
        # Desplegar el módulo de Postgres en ese RG y abrir/cerrar la regla
        # temporal de firewall del runner durante las migraciones.
        Write-Step "Roles del pipeline sobre $dataRg"
        Add-RoleAssignment $spId 'ServicePrincipal' $RoleIds.Contributor 'Contributor' $dataRgId ''
    }
    # Leer postgres-admin-password del Key Vault de datos (infra-azure.yml). Si
    # no hay RG de datos aparte, el rol sobre $rg ya lo cubre.
    if ($dataRg -ne $rg) {
        Add-RoleAssignment $spId 'ServicePrincipal' $RoleIds.KeyVaultSecretsUser 'Key Vault Secrets User (Key Vault de datos)' $dataRgId ''
    }

    if (-not (Get-CreateSwa $Cfg)) {
        $swaName = [string](Get-Opt $Cfg 'ExistingSwaName' '')
        $swaRg = [string](Get-Opt $Cfg 'ExistingSwaResourceGroup' '')
        if ($swaName -and $swaRg -and $swaRg -ne $rg) {
            $swaId = Invoke-Az -Arguments @('staticwebapp', 'show', '-n', $swaName, '-g', $swaRg, '--query', 'id', '-o', 'tsv') -AllowFailure
            if ($swaId) {
                # Para `az staticwebapp secrets list` (token de despliegue).
                Add-RoleAssignment $spId 'ServicePrincipal' $RoleIds.Contributor "Contributor sobre la SWA existente $swaName" $swaId ''
            } else {
                Write-Warn "No se encontró la SWA existente '$swaName' en '$swaRg'."
            }
        }
    }

    $userId = Invoke-Az -Arguments @('ad', 'signed-in-user', 'show', '--query', 'id', '-o', 'tsv') -AllowFailure
    if ($operators) {
        Write-Step "Roles de operador para el grupo '$($operators.name)' sobre $rg"
        Add-OperatorRoles $operators.id 'Group' "grupo $($operators.name)" $rgId
        if ($dataRg -ne $rg) {
            Add-RoleAssignment $operators.id 'Group' $RoleIds.Contributor "Contributor sobre $dataRg para grupo $($operators.name)" $dataRgId ''
            Add-RoleAssignment $operators.id 'Group' $RoleIds.KeyVaultSecretsOfficer "Key Vault Secrets Officer sobre $dataRg para grupo $($operators.name)" $dataRgId ''
        }
        if ($userId) {
            $member = Invoke-Az -Arguments @('ad', 'group', 'member', 'check', '--group', $operators.id, '--member-id', $userId, '--query', 'value', '-o', 'tsv') -AllowFailure
            if ($member -ne 'true') {
                Write-Warn "Quien ejecuta bootstrap no es miembro de '$($operators.name)': sin eso no podrá usar plan/infra/secret-set."
            }
        }
    } else {
        Write-Step 'Roles de operador para quien ejecuta bootstrap (no hay OperatorsGroup en la config)'
        Write-Warn 'Sin OperatorsGroup los roles quedan solo para esta cuenta; otro operador no podrá usar plan/infra/secret-set.'
        Write-Warn 'Recomendado: que TI cree un grupo de seguridad en Entra, ponerlo en OperatorsGroup y repetir bootstrap.'
        if ($userId) {
            Add-OperatorRoles $userId 'User' $account.user.name $rgId
            if ($dataRg -ne $rg) {
                Add-RoleAssignment $userId 'User' $RoleIds.Contributor "Contributor sobre $dataRg para $($account.user.name)" $dataRgId ''
                Add-RoleAssignment $userId 'User' $RoleIds.KeyVaultSecretsOfficer "Key Vault Secrets Officer sobre $dataRg para $($account.user.name)" $dataRgId ''
            }
        } else {
            Write-Warn 'No se pudo leer el usuario (¿sesión de service principal?). Asigna los roles de operador a mano (README §8).'
        }
    }

    Write-Step "Variables de GitHub en $repo (nivel repositorio)"
    Set-GhVariable $Cfg 'AZURE_TENANT_ID' $Cfg.TenantId
    Set-GhVariable $Cfg 'AZURE_SUBSCRIPTION_ID' $Cfg.SubscriptionId
    Set-GhVariable $Cfg 'VITE_AZURE_CLIENT_ID' $Cfg.AppClientId
    Set-GhVariable $Cfg 'VITE_AZURE_TENANT_ID' $Cfg.TenantId
    Set-GhVariable $Cfg 'VITE_AZURE_API_SCOPE' $Cfg.AppApiScope
    Set-GhEnvVariable $Cfg 'AZURE_CLIENT_ID' $appId
    Set-GhEnvVariable $Cfg 'AZURE_RESOURCE_GROUP' $rg
    Set-GhEnvVariable $Cfg 'AZURE_POSTGRES_RESOURCE_GROUP' $dataRg
    Set-GhEnvVariable $Cfg 'AZURE_ENV_BRANCH' $branch
    Set-GhInfraVariables $Cfg
    if ($Environment -eq 'prod') {
        Write-Note "prod NO pide aprobación (GitHub Free): despliega todo lo que llegue a $branch."
    }

    Write-Host ''
    Write-Ok "Bootstrap de $Environment terminado."
    Write-Note "Siguiente: .\scripts\azure.ps1 plan -Env $Environment   y luego   infra -Env $Environment"
    Write-Note 'Los despliegues siguen apagados hasta que crees la variable de repositorio AZURE_DEPLOY_ENABLED=true.'
}

function Get-ParamFile {
    $file = Join-Path (Join-Path $InfraDir 'params') "$Environment.bicepparam"
    if (-not (Test-Path -LiteralPath $file)) { Stop-WithError "No existe $file" }
    return $file
}

function Invoke-Plan($Cfg) {
    $null = Assert-AzContext $Cfg
    $rg = (Get-EnvCfg $Cfg).ResourceGroup
    Assert-ResourceGroup $rg
    Assert-ResourceGroup (Get-DataResourceGroup $Cfg)
    $res = Get-EnvResources $Cfg
    $paramFile = Get-ParamFile
    Write-Step "what-if de $Environment sobre $rg (no cambia nada)"
    Invoke-WithInfraEnv $Cfg $res -ForWhatIf {
        $ErrorActionPreference = 'Continue'
        & az deployment group what-if --resource-group $rg --name "synatrack-$Environment-whatif" --parameters $paramFile --only-show-errors
        if ($LASTEXITCODE -ne 0) { Stop-WithError 'El what-if falló (ver arriba).' }
    }
}

function Invoke-Infra($Cfg) {
    $null = Assert-AzContext $Cfg
    $rg = (Get-EnvCfg $Cfg).ResourceGroup
    Assert-ResourceGroup $rg
    Assert-ResourceGroup (Get-DataResourceGroup $Cfg)
    Confirm-ProdChange 'desplegar la infraestructura (Bicep)'
    $res = Get-EnvResources $Cfg
    $paramFile = Get-ParamFile
    $deploymentName = "synatrack-$Environment-" + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')

    Write-Step "Desplegando Bicep en $rg ($deploymentName). Tarda 10-20 min la primera vez."
    $outputsRaw = Invoke-WithInfraEnv $Cfg $res {
        Invoke-Az -Arguments @('deployment', 'group', 'create', '--resource-group', $rg, '--name', $deploymentName,
            '--parameters', $paramFile, '--query', 'properties.outputs', '-o', 'json')
    }
    if (-not $outputsRaw) { Stop-WithError 'El despliegue no devolvió salidas.' }

    # { nombre: { type, value } } -> { nombre: value }
    $parsed = ConvertFrom-AzOutput $outputsRaw
    $flat = [ordered]@{}
    foreach ($prop in $parsed.PSObject.Properties) { $flat[$prop.Name] = $prop.Value.value }
    if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
    $outFile = Join-Path $OutDir "$Environment.json"
    [System.IO.File]::WriteAllText($outFile, ($flat | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))
    Write-Ok "Salidas guardadas en infra/.out/$Environment.json"
    Remove-LegacyPostgresPassword ([string]$flat.keyVaultName) ([string]$flat.dataKeyVaultName)

    Write-Step 'Resumen'
    Write-Note "API:       $($flat.apiUrl)"
    Write-Note "Frontend:  $($flat.frontendUrl)"
    Write-Note "Postgres:  $($flat.postgresFqdn)  (RG $($flat.postgresResourceGroup))"
    Write-Note "Key Vault: $($flat.keyVaultName)  (datos: $($flat.dataKeyVaultName))"
    Write-Note "CORS:      $($flat.corsOrigins)"

    if (Get-Command gh -ErrorAction SilentlyContinue) {
        Write-Step 'Actualizando variables de GitHub que dependen de las salidas'
        try {
            Set-GhOutputVariables $Cfg ([pscustomobject]$flat)
            Set-GhInfraVariables $Cfg
        } catch {
            # Escribir variables exige rol Admin en el repositorio. La infra ya
            # quedó desplegada: solo falta que un operador con Admin repita infra.
            Write-Warn 'No se pudieron actualizar las variables de GitHub (hace falta rol Admin en el repositorio).'
            Write-Warn 'La infraestructura sí quedó desplegada; un operador con Admin debe ejecutar infra de nuevo.'
        }
    } else {
        Write-Warn 'gh no está instalado: actualiza a mano las variables de GitHub (ver infra/README.md).'
    }

    $present = @(Get-PresentOptionalSecrets $flat.keyVaultName)
    $missing = @($OptionalSecrets.Keys | Where-Object { $present -notcontains $_ })
    if ($missing.Count -gt 0) {
        # Informativo: cada uno solo activa una función (correo, Teams, cron externo).
        Write-Note ("Secretos opcionales no cargados (sus funciones quedan apagadas): " + ($missing -join ', ') + ". Para activar alguna: secret-sync o secret-set y luego infra.")
    }
}

function Wait-WorkflowRun($Cfg, [string]$Workflow, [DateTime]$Since) {
    $repo = $Cfg.GitHubRepo
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Seconds 3
        $runs = Invoke-Gh -Arguments @('run', 'list', '--repo', $repo, '--workflow', $Workflow, '--event', 'workflow_dispatch',
            '--limit', '5', '--json', 'databaseId,createdAt,url') | ConvertFrom-Json
        $run = @($runs | Where-Object { ([DateTime]$_.createdAt).ToUniversalTime() -ge $Since.AddSeconds(-5) }) | Select-Object -First 1
        if ($run) { return $run }
    }
    return $null
}

function Invoke-Deploy($Cfg, [string]$DeployRef, [string]$Which, [bool]$NoMigrations) {
    Assert-GhContext
    $envCfg = Get-EnvCfg $Cfg
    $branch = $envCfg.GitBranch
    if (-not $DeployRef) { $DeployRef = $branch }
    Confirm-ProdChange "desplegar '$DeployRef' ($Which)"

    $workflows = @()
    if ($Which -in @('backend', 'all')) { $workflows += $BackendWorkflow }
    if ($Which -in @('frontend', 'all')) { $workflows += $FrontendWorkflow }

    foreach ($wf in $workflows) {
        Write-Step "Disparando $wf en $Environment (ref $DeployRef)"
        $since = [DateTime]::UtcNow
        # --ref = rama donde vive el workflow (la del entorno); `ref` = lo que se despliega.
        $ghArgs = @('workflow', 'run', $wf, '--repo', $Cfg.GitHubRepo, '--ref', $branch, '-f', "environment=$Environment", '-f', "ref=$DeployRef")
        if ($wf -eq $BackendWorkflow -and $NoMigrations) { $ghArgs += @('-f', 'skip_migrations=true') }
        Invoke-Gh -Arguments $ghArgs | Out-Null
        $run = Wait-WorkflowRun $Cfg $wf $since
        if (-not $run) {
            Write-Warn "No se encontró la ejecución recién creada. Revísala en GitHub > Actions > $wf."
            continue
        }
        Write-Note "Ejecución: $($run.url)"
        $ErrorActionPreference = 'Continue'
        & gh run watch $run.databaseId --repo $Cfg.GitHubRepo --exit-status
        $code = $LASTEXITCODE
        $ErrorActionPreference = 'Stop'
        if ($code -ne 0) { Stop-WithError "El workflow $wf terminó con error. Detalle: $($run.url)" }
        Write-Ok "$wf terminó bien."
    }
}

function Invoke-Status($Cfg) {
    $null = Assert-AzContext $Cfg
    $rg = (Get-EnvCfg $Cfg).ResourceGroup
    Assert-ResourceGroup $rg
    $res = Get-EnvResources $Cfg
    Write-Step "Estado de $Environment ($rg)"

    if ($res.WebApp) {
        $w = Invoke-AzJson -Arguments @('webapp', 'show', '-g', $rg, '-n', $res.WebApp, '--query',
            '{state:state, host:defaultHostName, runtime:siteConfig.linuxFxVersion, alwaysOn:siteConfig.alwaysOn, httpsOnly:httpsOnly}')
        Write-Note ("Web App      {0}  estado={1}  runtime={2}  alwaysOn={3}  https://{4}" -f $res.WebApp, $w.state, $w.runtime, $w.alwaysOn, $w.host)
    } else { Write-Warn 'Web App: no existe todavía.' }
    if ($res.Plan) {
        $p = Invoke-AzJson -Arguments @('appservice', 'plan', 'show', '-g', $rg, '-n', $res.Plan, '--query', '{sku:sku.name, workers:sku.capacity}')
        Write-Note ("Plan         {0}  sku={1}  instancias={2}" -f $res.Plan, $p.sku, $p.workers)
    }
    if ($res.Postgres) {
        $dataRg = $res.DataResourceGroup
        $pg = Invoke-AzJson -Arguments @('postgres', 'flexible-server', 'show', '-g', $dataRg, '-n', $res.Postgres, '--query',
            '{state:state, version:version, sku:sku.name, storage:storage.storageSizeGb, fqdn:fullyQualifiedDomainName}')
        Write-Note ("Postgres     {0}  estado={1}  v{2}  {3}  {4} GB  (RG {5})" -f $res.Postgres, $pg.state, $pg.version, $pg.sku, $pg.storage, $dataRg)
        $rules = Invoke-AzJson -Arguments @('postgres', 'flexible-server', 'firewall-rule', 'list', '-g', $dataRg, '--name', $res.Postgres, '--query', '[].name') -AllowFailure
        $runnerRules = @($rules | Where-Object { $_ -like 'gh-runner-*' })
        Write-Note ("             reglas de firewall={0}{1}" -f @($rules).Count, $(if ($runnerRules.Count) { "  (AVISO: $($runnerRules.Count) regla(s) gh-runner-* sin cerrar)" } else { '' }))
    } else { Write-Warn 'Postgres: no existe todavía.' }
    if ($res.KeyVault) {
        $present = @(Get-PresentOptionalSecrets $res.KeyVault)
        Write-Note ("Key Vault    {0}  opcionales cargados: {1}" -f $res.KeyVault, $(if ($present.Count) { $present -join ', ' } else { 'ninguno' }))
    }
    if ($res.DataKeyVault) {
        Write-Note ("Key Vault de datos  {0}  (RG {1}; contraseña del administrador de Postgres)" -f $res.DataKeyVault, $res.DataResourceGroup)
    } else { Write-Warn 'Key Vault de datos: no existe todavía (lo crea infra).' }
    if ($res.StaticWebApp) {
        $s = Invoke-AzJson -Arguments @('staticwebapp', 'show', '-g', $res.SwaResourceGroup, '-n', $res.StaticWebApp, '--query', '{host:defaultHostname, sku:sku.name, domains:customDomains}') -AllowFailure
        if ($s) { Write-Note ("Static Web   {0}  sku={1}  https://{2}  dominios={3}" -f $res.StaticWebApp, $s.sku, $s.host, (@($s.domains) -join ',')) }
    } else { Write-Note 'Static Web   (no se gestiona en este entorno)' }

    if (Get-Command gh -ErrorAction SilentlyContinue) {
        Write-Step 'Últimos despliegues (GitHub Actions)'
        foreach ($wf in @($BackendWorkflow, $FrontendWorkflow)) {
            $runs = Invoke-Gh -Arguments @('run', 'list', '--repo', $Cfg.GitHubRepo, '--workflow', $wf, '--limit', '10',
                '--json', 'displayTitle,status,conclusion,createdAt,url') -AllowFailure
            if (-not $runs) { Write-Note "$($wf): sin ejecuciones (o el workflow aún no está en GitHub)."; continue }
            $list = $runs | ConvertFrom-Json
            $last = @($list | Where-Object { $_.displayTitle -match "\b$Environment\b" }) | Select-Object -First 1
            if ($last) { Write-Note ("{0}: {1} -> {2}/{3}  {4}" -f $wf, $last.displayTitle, $last.status, $last.conclusion, $last.createdAt) }
            else { Write-Note "$($wf): sin ejecuciones para $Environment." }
        }
    }
}

function Invoke-LogAnalyticsQuery([string]$WorkspaceId, [string]$Query) {
    $file = New-TempJsonFile @{ query = $Query }
    try {
        $raw = Invoke-Az -Arguments @('rest', '--method', 'post', '--url', "https://api.loganalytics.io/v1/workspaces/$WorkspaceId/query",
            '--resource', 'https://api.loganalytics.io', '--headers', 'Content-Type=application/json', '--body', "@$file") -AllowFailure
    } finally { Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue }
    if (-not $raw) { return $null }
    $resp = $raw | ConvertFrom-Json
    $table = $resp.tables[0]
    $cols = @($table.columns | ForEach-Object { $_.name })
    $rows = @()
    foreach ($r in $table.rows) {
        $o = [ordered]@{}
        for ($i = 0; $i -lt $cols.Count; $i++) { $o[$cols[$i]] = $r[$i] }
        $rows += [pscustomobject]$o
    }
    return $rows
}

function Invoke-Health($Cfg) {
    $null = Assert-AzContext $Cfg
    $rg = (Get-EnvCfg $Cfg).ResourceGroup
    $res = Get-EnvResources $Cfg
    if (-not $res.WebApp) { Stop-WithError "No hay Web App en $rg. ¿Corriste infra?" }
    $hostName = Invoke-Az -Arguments @('webapp', 'show', '-g', $rg, '-n', $res.WebApp, '--query', 'defaultHostName', '-o', 'tsv')
    $url = "https://$hostName/health"

    Write-Step "GET $url"
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $status = 0
    $content = ''
    try {
        $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30
        $status = [int]$resp.StatusCode
        $content = $resp.Content
    } catch {
        $status = Get-HttpStatusFromError $_
        if ($status -gt 0) {
            # 5.1 y 7 dejan el cuerpo de la respuesta de error en ErrorDetails.
            if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $content = $_.ErrorDetails.Message }
        } else {
            Write-Warn "Sin respuesta: $($_.Exception.Message)"
        }
    }
    $sw.Stop()
    $color = 'Red'
    if ($status -eq 200) { $color = 'Green' }
    Write-Host ("    HTTP {0}  en {1} ms" -f $status, $sw.ElapsedMilliseconds) -ForegroundColor $color
    if ($content) {
        try {
            $h = $content | ConvertFrom-Json
            Write-Note ("ok={0}  database={1}  jobs={2}" -f $h.ok, $h.database, $h.jobs.estado)
            if ($h.jobs.PSObject.Properties.Name -contains 'trabajos') {
                foreach ($t in $h.jobs.trabajos) {
                    Write-Note ("  - {0,-24} {1,-10} último éxito: {2}" -f $t.nombre, $t.estado, $t.ultimoExitoEn)
                }
            }
        } catch { Write-Note $content }
    }

    if ($res.WorkspaceId) {
        Write-Step 'Prueba de disponibilidad (última hora, por ubicación)'
        $q = 'AppAvailabilityResults | where TimeGenerated > ago(1h) ' +
            '| summarize pruebas = count(), fallos = countif(Success == false), ultima = max(TimeGenerated), duracionMs = round(avg(DurationMs)) by Location ' +
            '| order by Location asc'
        $rows = Invoke-LogAnalyticsQuery $res.WorkspaceId $q
        if ($null -eq $rows) { Write-Warn 'No se pudo consultar Log Analytics.' }
        elseif ($rows.Count -eq 0) { Write-Note 'Sin resultados todavía (la prueba corre cada 5 min).' }
        else { $rows | Format-Table -AutoSize | Out-String -Width 200 | Write-Host }
    }

    Write-Step 'Alertas activas del resource group'
    $alertsUrl = "https://management.azure.com/subscriptions/$($Cfg.SubscriptionId)/providers/Microsoft.AlertsManagement/alerts" +
        "?api-version=2019-05-05-preview&targetResourceGroup=$rg&monitorCondition=Fired&timeRange=1d"
    $raw = Invoke-Az -Arguments @('rest', '--method', 'get', '--url', $alertsUrl) -AllowFailure
    if (-not $raw) { Write-Warn 'No se pudieron consultar las alertas.'; return }
    $alerts = @(($raw | ConvertFrom-Json).value)
    if ($alerts.Count -eq 0) { Write-Ok 'Ninguna alerta disparada en las últimas 24 h.'; return }
    foreach ($a in $alerts) {
        $e = $a.properties.essentials
        Write-Host ("    [{0}] {1}  desde {2}  ({3})" -f $e.severity, $a.name, $e.startDateTime, $e.alertState) -ForegroundColor Yellow
    }
}

function Invoke-Logs($Cfg) {
    $null = Assert-AzContext $Cfg
    $rg = (Get-EnvCfg $Cfg).ResourceGroup
    $res = Get-EnvResources $Cfg
    if (-not $res.WebApp) { Stop-WithError "No hay Web App en $rg." }
    Write-Step "Log stream de $($res.WebApp) (Ctrl+C para salir)"
    $ErrorActionPreference = 'Continue'
    & az webapp log tail -g $rg -n $res.WebApp --only-show-errors
}

function Invoke-Rollback($Cfg, [string]$Which) {
    Assert-GhContext
    Write-Step "Despliegues exitosos recientes de $Environment"
    $runs = Invoke-Gh -Arguments @('run', 'list', '--repo', $Cfg.GitHubRepo, '--workflow', $BackendWorkflow, '--status', 'success',
        '--limit', '40', '--json', 'displayTitle,headSha,createdAt,event,url') | ConvertFrom-Json
    # El run-name del workflow es "Backend <env> @ <ref>" (ver deploy-backend-azure.yml).
    $candidates = @()
    foreach ($r in $runs) {
        if ($r.displayTitle -match "^Backend $Environment @ (\S+)") {
            $deployed = $Matches[1]
            if ($r.event -eq 'push' -or $deployed -match '^(dev|main)$') { $deployed = $r.headSha }
            $candidates += [pscustomobject]@{ Fecha = $r.createdAt; Ref = $deployed; Evento = $r.event; Titulo = $r.displayTitle }
        }
    }
    if ($candidates.Count -lt 1) { Stop-WithError "No hay despliegues exitosos de $Environment en el historial." }
    $candidates = @($candidates | Select-Object -First 10)
    for ($i = 0; $i -lt $candidates.Count; $i++) {
        $c = $candidates[$i]
        $label = ''
        if ($i -eq 0) { $label = '  <- el más reciente (probablemente el actual)' }
        Write-Host ("  [{0}] {1}  {2}  ({3}){4}" -f $i, $c.Fecha, $c.Ref, $c.Evento, $label)
    }
    $choice = Read-Host 'Número del despliegue a restaurar (vacío = cancelar)'
    if ([string]::IsNullOrWhiteSpace($choice)) { Stop-WithError 'Cancelado.' }
    $n = 0
    if (-not [int]::TryParse($choice, [ref]$n) -or $n -lt 0 -or $n -ge $candidates.Count) { Stop-WithError 'Opción no válida.' }
    $target = $candidates[$n].Ref
    Write-Warn 'Las migraciones NO se revierten: el rollback despliega código anterior sobre el esquema actual.'
    Write-Warn 'Por eso el rollback se lanza con skip_migrations=true.'
    Invoke-Deploy $Cfg $target $Which $true
}

function Invoke-SecretSet($Cfg, [string]$SecretName, [bool]$GenerateValue) {
    if (-not $SecretName) {
        Stop-WithError ("Indica -Name: " + ($OptionalSecrets.Keys -join ', '))
    }
    $null = Assert-AzContext $Cfg
    $rg = (Get-EnvCfg $Cfg).ResourceGroup
    $res = Get-EnvResources $Cfg
    if (-not $res.KeyVault) { Stop-WithError "No hay Key Vault en $rg. Ejecuta primero infra." }
    Confirm-ProdChange "cambiar el secreto '$SecretName'"

    $plain = $null
    $bstr = [IntPtr]::Zero
    try {
        if ($GenerateValue) {
            if ($GeneratableSecrets -notcontains $SecretName) { Stop-WithError "-Generate solo aplica a: $($GeneratableSecrets -join ', ')" }
            $plain = New-RandomSecret 48
            Write-Note 'Valor aleatorio generado (no se muestra). Si un sistema externo lo necesita, léelo de Key Vault.'
        } else {
            $secure = Read-Host -AsSecureString "Valor de '$SecretName' (no se muestra)"
            $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
            $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
            if ([string]::IsNullOrEmpty($plain)) { Stop-WithError 'Valor vacío: no se guarda nada.' }
        }
        Set-KeyVaultSecretValue $res.KeyVault $SecretName $plain
        Write-Ok "Secreto '$SecretName' guardado en $($res.KeyVault)."
    } finally {
        if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
        $plain = $null
    }

    Update-SecretReferences $res @($SecretName)
}

# Tras escribir secretos en Key Vault: agrega al Web App las referencias que
# falten (eso lo reinicia solo) y, si todas existían, ofrece reiniciar para que
# tome los valores nuevos (App Service los cachea hasta 24 h).
function Update-SecretReferences($Res, [string[]]$SecretNames) {
    if (-not $Res.WebApp -or $SecretNames.Count -eq 0) { return }
    $rg = $Res.ResourceGroup
    $existing = @(Invoke-AzJson -Arguments @('webapp', 'config', 'appsettings', 'list', '-g', $rg, '-n', $Res.WebApp, '--query', '[].name') -AllowFailure)
    $toAdd = @()
    foreach ($s in $SecretNames) {
        $settingName = $OptionalSecrets[$s]
        if ($existing -notcontains $settingName) {
            # Solo la referencia, no el valor: el archivo temporal no tiene nada sensible.
            $toAdd += @{ name = $settingName; value = "@Microsoft.KeyVault(VaultName=$($Res.KeyVault);SecretName=$s)"; slotSetting = $false }
        }
    }
    if ($toAdd.Count -gt 0) {
        $file = New-TempJsonFile $toAdd
        try {
            Invoke-Az -Arguments @('webapp', 'config', 'appsettings', 'set', '-g', $rg, '-n', $Res.WebApp, '--settings', "@$file", '-o', 'none') | Out-Null
        } finally { Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue }
        foreach ($a in $toAdd) { Write-Ok "App Setting $($a.name) agregado como referencia a Key Vault." }
        Write-Note 'El Web App se reinicia solo y toma todos los valores. El próximo `infra` mantiene las referencias.'
        return
    }
    $answer = Read-Host "¿Reiniciar $($Res.WebApp) para que tome los valores nuevos ya? (s/N)"
    if ($answer -match '^[sS]') {
        Invoke-Az -Arguments @('webapp', 'restart', '-g', $rg, '-n', $Res.WebApp) | Out-Null
        Write-Ok 'Web App reiniciado.'
    } else {
        Write-Note 'Sin reinicio: los valores nuevos se toman en el próximo reinicio o despliegue (máx. 24 h).'
    }
}

function Get-SecretsFilePath($Cfg) {
    if ($SecretsFile) { return $SecretsFile }
    $fromCfg = [string](Get-Opt $Cfg 'SecretsFile' '')
    if ($fromCfg) { return [Environment]::ExpandEnvironmentVariables($fromCfg) }
    return $DefaultSecretsPath
}

# Lee la sección del entorno del archivo de secretos y la valida. Devuelve un
# diccionario nombre -> valor solo con los secretos que tienen valor.
function Read-SecretsFile($Cfg) {
    $path = Get-SecretsFilePath $Cfg
    if (-not (Test-Path -LiteralPath $path)) {
        Stop-WithError ("No existe el archivo de secretos: $path`n" +
            "  Cópialo desde la plantilla y llena los valores:`n" +
            "    Copy-Item infra/azure.secrets.example.psd1 infra/azure.secrets.psd1")
    }
    $full = (Resolve-Path -LiteralPath $path).Path
    foreach ($cloud in @($env:OneDrive, $env:OneDriveCommercial, $env:OneDriveConsumer)) {
        if ($cloud -and $full.StartsWith($cloud, [StringComparison]::OrdinalIgnoreCase)) {
            Write-Warn "El archivo de secretos está dentro de OneDrive ($cloud): se copia a la nube."
            Write-Warn 'Muévelo fuera (p. ej. $env:USERPROFILE\.synatrack\) y apunta SecretsFile en la config.'
            break
        }
    }
    # Import-PowerShellDataFile no ejecuta código: solo admite literales.
    $data = Import-PowerShellDataFile -LiteralPath $full
    foreach ($envName in $data.Keys) {
        if (@('stage', 'prod') -notcontains $envName) { Stop-WithError "Sección desconocida '$envName' en el archivo de secretos (solo stage y prod)." }
    }
    if (-not $data.ContainsKey($Environment)) { Stop-WithError "El archivo de secretos no tiene la sección '$Environment'." }
    $section = $data[$Environment]
    $result = [ordered]@{}
    foreach ($key in $section.Keys) {
        if (-not $OptionalSecrets.Contains($key)) {
            Stop-WithError ("Secreto desconocido '$key' en la sección $Environment. Válidos: " + ($OptionalSecrets.Keys -join ', '))
        }
        $value = [string]$section[$key]
        if ([string]::IsNullOrWhiteSpace($value)) { continue }
        if ($value -eq $GenerateKeyword -and $GeneratableSecrets -notcontains $key) {
            Stop-WithError "'$GenerateKeyword' solo aplica a: $($GeneratableSecrets -join ', ')"
        }
        if ($key -like 'teams-*' -and $value -ne $GenerateKeyword -and $value -notlike 'https://*') {
            Stop-WithError "El valor de '$key' debe ser una URL https:// (no se muestra cuál es)."
        }
        $result[$key] = $value
    }
    return $result
}

function Invoke-SecretSync($Cfg) {
    $null = Assert-AzContext $Cfg
    $rg = (Get-EnvCfg $Cfg).ResourceGroup
    $res = Get-EnvResources $Cfg
    if (-not $res.KeyVault) { Stop-WithError "No hay Key Vault en $rg. Ejecuta primero infra." }
    $wanted = Read-SecretsFile $Cfg
    if ($wanted.Count -eq 0) { Write-Note "La sección $Environment no tiene valores: nada que cargar."; return }

    # Plan: comparar con Key Vault sin mostrar valores.
    Write-Step "Comparando con $($res.KeyVault)"
    $plan = @()
    foreach ($name in $wanted.Keys) {
        $current = Get-KeyVaultSecretValue $res.KeyVault $name
        $value = $wanted[$name]
        if ($value -eq $GenerateKeyword) {
            if ($current) { Write-Note "$name  ya existe (los tokens generados no se rotan solos)"; continue }
            $plan += [pscustomobject]@{ Name = $name; Generate = $true; Action = 'generar' }
        } elseif ($current -ceq $value) {
            Write-Note "$name  sin cambios"
        } else {
            $action = 'actualizar'
            if (-not $current) { $action = 'crear' }
            $plan += [pscustomobject]@{ Name = $name; Generate = $false; Action = $action }
        }
        $current = $null
    }
    if ($plan.Count -eq 0) { Write-Ok 'Key Vault ya está al día.'; return }
    foreach ($p in $plan) { Write-Note "$($p.Name)  -> $($p.Action)" }
    Confirm-ProdChange ("cargar " + $plan.Count + " secreto(s)")

    foreach ($p in $plan) {
        $plain = $null
        try {
            if ($p.Generate) { $plain = New-RandomSecret 48 } else { $plain = $wanted[$p.Name] }
            Set-KeyVaultSecretValue $res.KeyVault $p.Name $plain
            Write-Ok "$($p.Name) guardado."
        } finally { $plain = $null }
    }
    $wanted = $null
    Update-SecretReferences $res @($plan | ForEach-Object { $_.Name })
}

function Invoke-Access($Cfg) {
    $null = Assert-AzContext $Cfg
    $rg = (Get-EnvCfg $Cfg).ResourceGroup
    Assert-ResourceGroup $rg
    $rgId = "/subscriptions/$($Cfg.SubscriptionId)/resourceGroups/$rg"
    $fields = '{rol:roleDefinitionName, principal:principalName, tipo:principalType, ambito:scope, condicion:condition}'

    Write-Step "Asignaciones de rol que aplican a $rg (incluye heredadas)"
    $direct = @(Invoke-AzJson -Arguments @('role', 'assignment', 'list', '--scope', $rgId, '--include-inherited', '--query', "[].$fields"))
    # Las de recursos hijos (p. ej. la del Web App sobre el Key Vault).
    $children = @(Invoke-AzJson -Arguments @('role', 'assignment', 'list', '--all', '--query', "[?starts_with(scope, '$rgId/')].$fields") -AllowFailure)
    $rows = @()
    foreach ($a in @($direct + $children)) {
        if ($null -eq $a) { continue }
        $ambito = [string]$a.ambito
        if ($ambito -eq $rgId) { $ambito = 'resource group' }
        elseif ($ambito.StartsWith("$rgId/")) { $ambito = $ambito.Substring($rgId.Length + 1) }
        elseif ($ambito -like '/subscriptions/*' -and $ambito -notlike '*/resourceGroups/*') { $ambito = 'suscripción (heredado)' }
        else { $ambito = "$ambito (heredado)" }
        $cond = ''
        if ($a.condicion) { $cond = 'sí' }
        $principal = [string]$a.principal
        if (-not $principal) { $principal = '(sin nombre: identidad borrada o sin permiso de lectura en Entra)' }
        $rows += [pscustomobject]@{ Rol = $a.rol; Principal = $principal; Tipo = $a.tipo; Ambito = $ambito; Condicion = $cond }
    }
    $rows | Sort-Object Ambito, Rol, Principal | Format-Table -AutoSize | Out-String -Width 250 | Write-Host

    $dataRg = Get-DataResourceGroup $Cfg
    if ($dataRg -ne $rg -and (Test-ResourceGroup $dataRg)) {
        # Compartido con otras aplicaciones: todo el que tenga rol aquí puede
        # tocar el servidor de Postgres (firewall, contraseña del administrador).
        Write-Step "Asignaciones de rol directas sobre $dataRg (servidor de Postgres)"
        $dataRgId = "/subscriptions/$($Cfg.SubscriptionId)/resourceGroups/$dataRg"
        $dataRows = @(Invoke-AzJson -Arguments @('role', 'assignment', 'list', '--scope', $dataRgId, '--query', "[].$fields"))
        $dataRows | Where-Object { $_ } | ForEach-Object {
            [pscustomobject]@{ Rol = $_.rol; Principal = $(if ($_.principal) { $_.principal } else { '(sin nombre)' }); Tipo = $_.tipo }
        } | Sort-Object Rol, Principal | Format-Table -AutoSize | Out-String -Width 250 | Write-Host
    }

    Write-Step 'Grupo de operadores'
    $ref = [string](Get-Opt $Cfg 'OperatorsGroup' '')
    if (-not $ref) {
        Write-Warn 'La config no define OperatorsGroup: los roles de operador están asignados a cuentas sueltas (ver la tabla).'
    } else {
        $g = Invoke-AzJson -Arguments @('ad', 'group', 'show', '--group', $ref, '--query', '{id:id, name:displayName}') -AllowFailure
        if ($null -eq $g) {
            Write-Warn "No se encontró el grupo '$ref' en Entra ID."
        } else {
            Write-Note "$($g.name) ($($g.id))"
            $members = @(Invoke-AzJson -Arguments @('ad', 'group', 'member', 'list', '--group', $g.id, '--query', '[].{nombre:displayName, cuenta:userPrincipalName}') -AllowFailure)
            if ($members.Count -eq 0) { Write-Warn 'El grupo no tiene miembros (o falta permiso para listarlos).' }
            foreach ($m in $members) {
                if ($null -eq $m) { continue }
                $cuenta = [string]$m.cuenta
                if (-not $cuenta) { $cuenta = 'no es usuario: grupo anidado o service principal' }
                Write-Note ("  - {0}  <{1}>" -f $m.nombre, $cuenta)
            }
            $groupRoles = @($rows | Where-Object { $_.Principal -eq $g.name -and $_.Ambito -eq 'resource group' }).Count
            if ($groupRoles -lt 3) {
                Write-Warn "El grupo tiene $groupRoles de los 3 roles de operador sobre el RG: un administrador debe ejecutar bootstrap -Env $Environment."
            }
        }
    }

    # Qué ramas de GitHub pueden obtener un token de este entorno (OIDC).
    Write-Step "Quién puede desplegar a $Environment desde GitHub (credenciales federadas)"
    $appName = "gh-synatrack-$Environment"
    $appId = Invoke-Az -Arguments @('ad', 'app', 'list', '--display-name', $appName, '--query', '[0].appId', '-o', 'tsv') -AllowFailure
    if (-not $appId) {
        Write-Warn "No existe la identidad $appName (o falta permiso para leerla en Entra)."
    } else {
        $fc = @(Invoke-AzJson -Arguments @('ad', 'app', 'federated-credential', 'list', '--id', $appId, '--query', '[].subject') -AllowFailure)
        foreach ($s in $fc) { if ($s) { Write-Note "  - $s" } }
        $expected = "$(Get-GitHubOidcSubjectPrefix $Cfg.GitHubRepo):ref:refs/heads/$((Get-EnvCfg $Cfg).GitBranch)"
        if ($fc -notcontains $expected) { Write-Warn "Falta $expected : ejecuta bootstrap -Env $Environment." }
        $extra = @($fc | Where-Object { $_ -and $_ -ne $expected -and -not ($Environment -eq 'stage' -and $_ -like '*:pull_request') })
        if ($extra.Count -gt 0) { Write-Warn ("Credenciales que sobran (revisar y borrar): " + ($extra -join ', ')) }
    }
    if ($Environment -eq 'prod') {
        Write-Note 'GitHub Free: prod no pide aprobación. Lo que llega a main se despliega.'
    }
}

# =============================================================================
# Main
# =============================================================================

$cfg = Get-Config

switch ($Command) {
    'login' { Invoke-Login $cfg }
    'bootstrap' { Invoke-Bootstrap $cfg }
    'plan' { Invoke-Plan $cfg }
    'infra' { Invoke-Infra $cfg }
    'deploy' { Invoke-Deploy $cfg $Ref $App ([bool]$SkipMigrations) }
    'status' { Invoke-Status $cfg }
    'health' { Invoke-Health $cfg }
    'logs' { Invoke-Logs $cfg }
    'rollback' { Invoke-Rollback $cfg $App }
    'secret-set' { Invoke-SecretSet $cfg $Name ([bool]$Generate) }
    'secret-sync' { Invoke-SecretSync $cfg }
    'access' { Invoke-Access $cfg }
}
