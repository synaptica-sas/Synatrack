#!/usr/bin/env bash
# Prepara, EN LA SHELL ACTUAL, las variables SYNATRACK_* que lee
# infra/params/<env>.bicepparam. Es el equivalente en CI de
# Invoke-WithInfraEnv de scripts/azure.ps1. Se usa con `source` desde
# .github/workflows/infra-azure.yml, en el MISMO paso que ejecuta az, para que la
# contraseña de Postgres no pase nunca por $GITHUB_ENV ni por un archivo.
#
# Entradas (variables de entorno):
#   INFRA_PARAMS_B64     JSON en base64 con los parámetros no sensibles
#                        (lo publica scripts/azure.ps1 en la variable de GitHub
#                        AZURE_INFRA_PARAMS_B64_STAGE / AZURE_INFRA_PARAMS_B64_PROD).
#   RESOURCE_GROUP       resource group del entorno.
#   ENV_NAME             stage | prod.
#   ALLOW_TEMP_PASSWORD  1 = si Key Vault aún no tiene la contraseña, usar una
#                        temporal (solo para what-if; un deploy NUNCA debe).

set -euo pipefail

: "${INFRA_PARAMS_B64:?Falta la variable AZURE_INFRA_PARAMS_B64: ejecuta scripts/azure.ps1 bootstrap/infra}"
: "${RESOURCE_GROUP:?Falta AZURE_RESOURCE_GROUP}"
: "${ENV_NAME:?Falta ENV_NAME}"

# 1) Parámetros no sensibles.
while IFS='=' read -r key value; do
  case "$key" in
    SYNATRACK_*) export "$key=$value" ;;
    *) echo "::warning::Clave ignorada en los parámetros: $key" ;;
  esac
done < <(echo "$INFRA_PARAMS_B64" | base64 -d | jq -r 'to_entries[] | "\(.key)=\(.value)"')

# 2) Inicio del presupuesto: el del presupuesto existente o el 1 del mes actual.
SUBSCRIPTION_ID="$(az account show --query id -o tsv)"
BUDGET_URL="https://management.azure.com/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.Consumption/budgets/budget-synatrack-${ENV_NAME}?api-version=2023-11-01"
BUDGET_START="$(az rest --method get --url "$BUDGET_URL" --query properties.timePeriod.startDate -o tsv 2>/dev/null || true)"
if [[ -n "$BUDGET_START" ]]; then
  export SYNATRACK_BUDGET_START_DATE="${BUDGET_START:0:10}"
else
  SYNATRACK_BUDGET_START_DATE="$(date -u +%Y-%m-01)"
  export SYNATRACK_BUDGET_START_DATE
fi

# 3) Key Vaults del entorno (pueden no existir todavía): el de la app y el de
#    datos (etiqueta rol=datos, en el RG de datos), que guarda la contraseña
#    del administrador de Postgres.
KV_NAME="$(az keyvault list -g "$RESOURCE_GROUP" --query "[?tags.rol!='datos'] | [0].name" -o tsv 2>/dev/null || true)"
DATA_RG="${SYNATRACK_DATA_RESOURCE_GROUP:-$RESOURCE_GROUP}"
DATA_KV_NAME="$(az keyvault list -g "$DATA_RG" --query "[?tags.rol=='datos'] | [0].name" -o tsv 2>/dev/null || true)"

# 4) Secretos opcionales presentes -> se referencian en App Settings.
OPTIONAL="jobs-run-token fx-sync-token smtp-pass teams-feedback-webhook-url teams-payroll-webhook-url"
PRESENT=""
if [[ -n "$KV_NAME" ]]; then
  ALL="$(az keyvault secret list --vault-name "$KV_NAME" --query '[?attributes.enabled].name' -o tsv 2>/dev/null || true)"
  for s in $OPTIONAL; do
    if grep -qx "$s" <<<"$ALL"; then PRESENT="${PRESENT:+$PRESENT,}$s"; fi
  done
fi
export SYNATRACK_PRESENT_SECRETS="$PRESENT"
echo "Secretos opcionales presentes: ${PRESENT:-ninguno}"

# 5) Contraseña de Postgres: del Key Vault de datos; si un entorno creado antes
#    aún la tiene solo en el de la app, de ahí (el despliegue la copia al de
#    datos; la copia vieja la borra scripts/azure.ps1 infra).
PG_PASSWORD=""
if [[ -n "$DATA_KV_NAME" ]]; then
  PG_PASSWORD="$(az keyvault secret show --vault-name "$DATA_KV_NAME" -n postgres-admin-password --query value -o tsv 2>/dev/null || true)"
fi
if [[ -z "$PG_PASSWORD" && -n "$KV_NAME" ]]; then
  PG_PASSWORD="$(az keyvault secret show --vault-name "$KV_NAME" -n postgres-admin-password --query value -o tsv 2>/dev/null || true)"
fi
if [[ -z "$PG_PASSWORD" ]]; then
  if [[ "${ALLOW_TEMP_PASSWORD:-0}" == "1" ]]; then
    echo "::notice::Key Vault aún no tiene postgres-admin-password: el what-if usa una contraseña temporal."
    PG_PASSWORD="Tmp$(openssl rand -hex 16)"
  else
    echo "::error::Key Vault no tiene postgres-admin-password. El PRIMER despliegue de infraestructura se hace desde la PC: scripts/azure.ps1 -Command infra -Env ${ENV_NAME}"
    # Se usa con `source`: `return` corta el script sin cerrar la shell del paso,
    # que de todos modos falla por `set -e`.
    return 1
  fi
fi
echo "::add-mask::$PG_PASSWORD"
export SYNATRACK_PG_ADMIN_PASSWORD="$PG_PASSWORD"
unset PG_PASSWORD
