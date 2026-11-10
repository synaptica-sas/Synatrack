# Configuración de Azure para scripts/azure.ps1 -- PLANTILLA.
#
# Copia este archivo como `infra/azure.config.psd1` y llena los valores:
#
#     Copy-Item infra/azure.config.example.psd1 infra/azure.config.psd1
#
# `infra/azure.config.psd1` está en .gitignore y los agentes de Claude Code
# tienen prohibido leerlo (.claude/settings.json). Aun así, NO pongas
# contraseñas aquí: la contraseña de Postgres la genera el script y la guarda
# directo en Key Vault; los demás secretos se cargan con `secret-set`. Este
# archivo solo lleva identificadores y preferencias.
#
# Formato: archivo de datos de PowerShell (.psd1). Se carga con
# Import-PowerShellDataFile, que no ejecuta código.
#
# Las claves marcadas "opcional" pueden omitirse. Una clave opcional puede ir
# también dentro de Environments.<env> y entonces manda sobre la global.
@{
    # --- Cuenta ---------------------------------------------------------------
    TenantId       = "00000000-0000-0000-0000-000000000000"  # Entra ID de Synaptica
    SubscriptionId = "00000000-0000-0000-0000-000000000000"
    Location       = "eastus2"

    # --- GitHub (para la identidad OIDC del pipeline) -------------------------
    GitHubRepo     = "synaptica-sas/Synatrack"

    # --- Notificaciones -------------------------------------------------------
    AlertEmail     = "equipo@synaptica.co"   # alertas de salud y de presupuesto
    MonthlyBudgetUsd = 150                    # alerta al 80% y 100% (por entorno; se puede sobrescribir en Environments)

    # --- Entra ID de la app (los mismos que usa el frontend hoy) --------------
    AppClientId    = "00000000-0000-0000-0000-000000000000"
    AppApiScope    = "api://00000000-0000-0000-0000-000000000000/access_as_user"
    AdminEmail     = "admin@synaptica.co"

    # Opcional. Valores aceptados en la claim `aud` del token
    # (AZURE_AD_AUDIENCE; el backend admite una lista separada por comas).
    # Si se omite, el script usa AMBOS valores posibles:
    #   "api://<AppClientId>,<AppClientId>"
    # que cubren tokens v1 (aud = App ID URI) y v2 (aud = GUID del client id).
    # Si el App ID URI de AppApiScope es otro (p. ej. "api://synatrack-api"),
    # también se agrega. Defínelo solo para restringir a un valor concreto.
    # ApiAudience  = "api://00000000-0000-0000-0000-000000000000,00000000-0000-0000-0000-000000000000"

    # --- Operadores (recomendado) ---------------------------------------------
    # Grupo de SEGURIDAD de Entra ID con las personas que operan la plataforma
    # (nombre o object id). `bootstrap` le asigna sobre el resource group de
    # cada entorno los roles de operador (ver infra/README.md §8). El grupo lo
    # crea TI en Entra; el script solo valida que exista. Si se omite, los
    # roles quedan solo para quien ejecuta bootstrap.
    OperatorsGroup = "Synatrack-IaC-Operadores"

    # --- Correo saliente y buzones (opcionales) -------------------------------
    # SupportEmail = "soporte@synaptica.co"
    # PayrollEmail = "nomina@synaptica.co"
    # SmtpHost     = "smtp.office365.com"
    # SmtpPort     = "587"
    # SmtpUser     = "noreply@synaptica.co"   # la contraseña va en azure.secrets.psd1 (secret-sync)
    # SmtpFrom     = "Synatrack <noreply@synaptica.co>"

    # --- Archivo de secretos para secret-sync (opcional) ----------------------
    # Por defecto infra/azure.secrets.psd1. Si el repo está en OneDrive, guárdalo
    # fuera para que no se suba a la nube (ver infra/azure.secrets.example.psd1).
    # SecretsFile = "%USERPROFILE%\.synatrack\azure.secrets.psd1"

    # --- Runtime (opcional) ---------------------------------------------------
    # LinuxFxVersion = "NODE|24-lts"   # ver: az webapp list-runtimes --os linux

    # --- Entornos -------------------------------------------------------------
    # Los nombres de recursos se derivan de estos valores (ver infra/README.md).
    Environments = @{
        stage = @{
            ResourceGroup = "rg-synatrack-stage"
            GitBranch     = "dev"
            FrontendUrl   = ""   # vacío = el hostname que asigne Static Web Apps
            # MonthlyBudgetUsd = 50
        }
        prod = @{
            ResourceGroup = "rg-synatrack-prod"
            GitBranch     = "main"
            # Dominio propio. Hasta el corte resuelve a Vercel; el CORS del
            # backend admite también el hostname *.azurestaticapps.net de la SWA
            # nueva para poder probarla antes de mover el DNS.
            FrontendUrl   = "https://synatrack.synaptica.co"
            # Opcional: orígenes CORS extra separados por coma.
            # ExtraCorsOrigins = ""

            # Por defecto el Bicep CREA la SWA de prod (el dominio se le mueve en
            # el corte). Solo si se decide reutilizar una SWA ya existente:
            # CreateStaticWebApp       = $false
            # ExistingSwaName          = "nombre-de-la-swa"
            # ExistingSwaResourceGroup = "rg-de-la-swa"
        }
    }
}
