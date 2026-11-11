// Parámetros de PROD (rama main).
//
// Aquí solo va el DIMENSIONAMIENTO (SKUs, retenciones, umbrales). Todo lo que
// depende de la config del usuario llega por variables de entorno SYNATRACK_*
// que exportan scripts/azure.ps1 (desde infra/azure.config.psd1) o el workflow
// infra-azure.yml (desde las variables del GitHub Environment). Ninguna de esas
// variables es secreta salvo SYNATRACK_PG_ADMIN_PASSWORD, que se lee del Key
// Vault y vive solo en memoria del proceso.
using '../main.bicep'

param environmentName = 'prod'

// --- Dimensionamiento -------------------------------------------------------
param appServicePlanSku = 'B1'
param linuxFxVersion = readEnvironmentVariable('SYNATRACK_LINUX_FX_VERSION', 'NODE|24-lts')
param postgresVersion = '17'
param postgresSkuName = 'Standard_B1ms'
param postgresSkuTier = 'Burstable'
// Zona donde la suscripción permite el SKU (ver: az postgres flexible-server list-skus). Vacío = Azure elige.
param postgresAvailabilityZone = ''
// Resource group y nombre del servidor: vienen de la config (DataResourceGroup, PostgresServerName).
param dataResourceGroupName = readEnvironmentVariable('SYNATRACK_DATA_RESOURCE_GROUP', '')
param postgresServerName = readEnvironmentVariable('SYNATRACK_POSTGRES_SERVER_NAME', '')
param postgresStorageGB = 32
param postgresBackupRetentionDays = 14
param postgresGeoRedundantBackup = false
param keyVaultPurgeProtection = true
param staticWebAppSku = 'Free'
param logRetentionDays = 90
param jobsIntervalMinutes = 60
// Tasas FX solo a demanda por ahora (decisión 2026-11-09). true = diaria automática.
param fxSyncInCycle = false
param availabilityLocationCount = 3
param availabilityFrequencySeconds = 300
param http5xxThreshold = 5
param responseTimeThresholdSeconds = 3

// --- Desde la config (variables de entorno) ---------------------------------
param tenantId = readEnvironmentVariable('SYNATRACK_TENANT_ID')
param apiAudience = readEnvironmentVariable('SYNATRACK_API_AUDIENCE')
param adminEmail = readEnvironmentVariable('SYNATRACK_ADMIN_EMAIL')
param supportEmail = readEnvironmentVariable('SYNATRACK_SUPPORT_EMAIL', '')
param payrollEmail = readEnvironmentVariable('SYNATRACK_PAYROLL_EMAIL', '')
param alertEmail = readEnvironmentVariable('SYNATRACK_ALERT_EMAIL')
param monthlyBudgetUsd = int(readEnvironmentVariable('SYNATRACK_MONTHLY_BUDGET_USD', '100'))
param budgetStartDate = readEnvironmentVariable('SYNATRACK_BUDGET_START_DATE')
param frontendUrl = readEnvironmentVariable('SYNATRACK_FRONTEND_URL', '')
param extraCorsOrigins = readEnvironmentVariable('SYNATRACK_EXTRA_CORS_ORIGINS', '')
param createStaticWebApp = bool(readEnvironmentVariable('SYNATRACK_CREATE_SWA', 'true'))
param smtpHost = readEnvironmentVariable('SYNATRACK_SMTP_HOST', '')
param smtpPort = readEnvironmentVariable('SYNATRACK_SMTP_PORT', '587')
param smtpUser = readEnvironmentVariable('SYNATRACK_SMTP_USER', '')
param smtpFrom = readEnvironmentVariable('SYNATRACK_SMTP_FROM', '')
param presentSecrets = filter(split(readEnvironmentVariable('SYNATRACK_PRESENT_SECRETS', ''), ','), s => !empty(s))

// --- Secreto (solo en memoria; lo pone el script o el workflow) -------------
param postgresAdminPassword = readEnvironmentVariable('SYNATRACK_PG_ADMIN_PASSWORD')
