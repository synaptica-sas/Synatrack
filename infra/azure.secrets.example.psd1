# Secretos de la aplicación para `scripts/azure.ps1 secret-sync` -- PLANTILLA.
#
# Copia este archivo y llena los valores en TU PC:
#
#     Copy-Item infra/azure.secrets.example.psd1 infra/azure.secrets.psd1
#
# `infra/azure.secrets.psd1` está en .gitignore y los agentes de Claude Code
# tienen prohibido leerlo (.claude/settings.json). Esta plantilla SÍ se versiona:
# nunca escribas valores reales aquí.
#
# OJO con OneDrive: si el repositorio está dentro de OneDrive (o Dropbox,
# Google Drive...), el archivo real se sube a la nube. En ese caso guárdalo
# fuera, por ejemplo en $env:USERPROFILE\.synatrack\azure.secrets.psd1, y en
# infra/azure.config.psd1 pon:  SecretsFile = "%USERPROFILE%\.synatrack\azure.secrets.psd1"
# El script avisa si detecta que el archivo está dentro de OneDrive.
#
# Cómo se usa:
#     .\scripts\azure.ps1 secret-sync -Env stage
#     .\scripts\azure.ps1 secret-sync -Env prod
#
# - Solo carga los secretos con valor; un valor vacío "" se ignora (no borra nada).
# - Compara con Key Vault y solo escribe los que cambiaron. Nunca muestra valores.
# - "<generar>" (solo en los tokens): crea un valor aleatorio si el secreto aún
#   no existe; si ya existe no lo toca. Para rotarlo usa secret-set -Generate.
# - Agrega al Web App las referencias a Key Vault que falten.
#
# Los valores de stage y prod deben ser DISTINTOS (otro buzón o canal de prueba en
# stage, tokens propios por entorno). Formato: archivo de datos de PowerShell;
# Import-PowerShellDataFile no ejecuta código.
@{
    stage = @{
        # Contraseña de aplicación del buzón SMTP (host, puerto y usuario van en azure.config.psd1).
        'smtp-pass'                  = ""
        # Webhooks de Teams: en stage, de un CANAL DE PRUEBA.
        'teams-feedback-webhook-url' = ""
        'teams-payroll-webhook-url'  = ""
        # Tokens internos: dejar "<generar>".
        'jobs-run-token'             = "<generar>"
        'fx-sync-token'              = "<generar>"
    }
    prod = @{
        'smtp-pass'                  = ""
        'teams-feedback-webhook-url' = ""
        'teams-payroll-webhook-url'  = ""
        'jobs-run-token'             = "<generar>"
        'fx-sync-token'              = "<generar>"
    }
}
