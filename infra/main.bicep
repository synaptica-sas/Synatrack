// Infraestructura de Synatrack en Azure, un resource group por entorno.
//
// Se despliega con `scripts/azure.ps1 -Command infra -Env <stage|prod>` o con el
// workflow .github/workflows/infra-azure.yml. Los parámetros de dimensionamiento
// están en params/<env>.bicepparam; los que dependen de la config del usuario
// (tenant, correos, URLs, etc.) llegan por variables de entorno SYNATRACK_* que
// el .bicepparam lee con readEnvironmentVariable(). Así el mismo archivo sirve
// desde la PC y desde GitHub Actions sin escribir nada sensible en disco.
//
// Guía completa: infra/README.md. Plan de migración: documentacion/azure/PLAN.md.

targetScope = 'resourceGroup'

// --- Identidad del entorno ---------------------------------------------------

@description('Entorno.')
@allowed([
  'stage'
  'prod'
])
param environmentName string

@description('Región. Por defecto la del resource group.')
param location string = resourceGroup().location

@description('Nombre base de la aplicación para derivar nombres.')
@minLength(3)
@maxLength(12)
param appName string = 'synatrack'

@description('Etiquetas adicionales.')
param extraTags object = {}

// --- Entra ID ----------------------------------------------------------------

@description('Tenant de Entra ID (también dueño del Key Vault).')
param tenantId string = tenant().tenantId

@description('Valores aceptados en la claim `aud` del token (AZURE_AD_AUDIENCE), separados por coma. Por defecto el script envía api://<AppClientId>,<AppClientId> (tokens v1 y v2).')
param apiAudience string

@description('Correo que siempre recibe ADMIN (ADMIN_EMAIL).')
param adminEmail string

@description('Correo de soporte (SUPPORT_EMAIL). Vacío = no se define.')
param supportEmail string = ''

@description('Correo de nómina (PAYROLL_EMAIL). Vacío = no se define.')
param payrollEmail string = ''

// --- Frontend / CORS ---------------------------------------------------------

@description('URL pública del frontend del entorno. Vacía = la de la Static Web App creada aquí.')
param frontendUrl string = ''

@description('Orígenes CORS adicionales separados por coma (p. ej. durante el corte).')
param extraCorsOrigins string = ''

@description('Crear la Static Web App. En prod puede quedar en false para seguir usando la existente (synatrack.synaptica.co).')
param createStaticWebApp bool = true

@description('SKU de la Static Web App.')
@allowed([
  'Free'
  'Standard'
])
param staticWebAppSku string = 'Free'

@description('Región de la Static Web App (solo algunas regiones la ofrecen).')
param staticWebAppLocation string = location

// --- App Service -------------------------------------------------------------

@description('SKU del App Service Plan.')
param appServicePlanSku string = 'B1'

@description('Runtime Linux. El backend declara engines.node 24.x.')
param linuxFxVersion string = 'NODE|24-lts'

@description('Minutos entre ciclos de trabajos EN PROCESO (JOBS_INTERVAL_MINUTES). Con Always On el proceso no se duerme.')
@minValue(0)
@maxValue(1440)
param jobsIntervalMinutes int = 60

@description('FX_SYNC_IN_CYCLE: sincronizar las tasas FX una vez al día dentro del ciclo de trabajos. false = solo a demanda (botón "Actualizar ahora").')
param fxSyncInCycle bool = false

@description('Zona horaria del proceso (TZ). El backend calcula en UTC; Render también corría en UTC.')
param timeZone string = 'UTC'

@description('Servidor SMTP (SMTP_HOST). Vacío = no se define.')
param smtpHost string = ''

@description('Puerto SMTP (SMTP_PORT).')
param smtpPort string = '587'

@description('Usuario SMTP (SMTP_USER). Vacío = no se define.')
param smtpUser string = ''

@description('Remitente (SMTP_FROM). Vacío = el valor por defecto del backend.')
param smtpFrom string = ''

// --- Postgres ----------------------------------------------------------------

@description('Versión mayor de PostgreSQL.')
param postgresVersion string = '17'

@description('SKU de Postgres.')
param postgresSkuName string = 'Standard_B1ms'

@description('Nivel del SKU de Postgres.')
param postgresSkuTier string = 'Burstable'

@description('Almacenamiento de Postgres en GB.')
param postgresStorageGB int = 32

@description('Días de retención de backups de Postgres.')
param postgresBackupRetentionDays int = 7

@description('Backups geo-redundantes (solo al crear).')
param postgresGeoRedundantBackup bool = false

@description('Usuario administrador de Postgres.')
param postgresAdminLogin string = 'synatrack_admin'

@description('Contraseña del administrador de Postgres. La genera/relee scripts/azure.ps1 desde Key Vault.')
@secure()
param postgresAdminPassword string

// --- Key Vault ---------------------------------------------------------------

@description('Protección contra purga del Key Vault (irreversible).')
param keyVaultPurgeProtection bool = false

@description('Secretos opcionales que YA existen en el Key Vault. Solo esos se referencian en App Settings.')
param presentSecrets array = []

// --- Observabilidad ----------------------------------------------------------

@description('Retención de Log Analytics / App Insights en días.')
param logRetentionDays int = 30

@description('Correo de alertas y presupuesto.')
param alertEmail string

@description('Presupuesto mensual del resource group en USD.')
param monthlyBudgetUsd int

@description('Inicio del presupuesto (primer día de mes, yyyy-MM-dd).')
param budgetStartDate string

@description('Ubicaciones de la prueba de disponibilidad (3-5).')
param availabilityLocationCount int = 3

@description('Frecuencia de la prueba de disponibilidad (s).')
param availabilityFrequencySeconds int = 300

@description('Umbral de 5xx en 5 min.')
param http5xxThreshold int = 5

@description('Umbral de tiempo de respuesta promedio (s).')
param responseTimeThresholdSeconds int = 3

// =============================================================================
// Nombres
// =============================================================================

// Sufijo estable por resource group para los nombres únicos globales.
var suffix = substring(uniqueString(resourceGroup().id), 0, 6)
var namePrefix = '${appName}-${environmentName}'

var names = {
  logAnalytics: 'log-${namePrefix}'
  appInsights: 'appi-${namePrefix}'
  plan: 'plan-${namePrefix}'
  webApp: 'app-${namePrefix}-${suffix}'
  postgres: 'psql-${namePrefix}-${suffix}'
  // Máx. 24 caracteres: kv-syn-stage-xxxxxx = 19.
  keyVault: 'kv-${take(appName, 3)}-${environmentName}-${suffix}'
  staticWebApp: 'stapp-${namePrefix}'
}

var tags = union(
  {
    app: appName
    env: environmentName
    managedBy: 'bicep'
  },
  extraTags
)

var databaseName = 'synatrack'

// Secretos opcionales -> variable de entorno del backend.
var optionalSecretEnv = {
  'jobs-run-token': 'JOBS_RUN_TOKEN'
  'fx-sync-token': 'FX_SYNC_TOKEN'
  'smtp-pass': 'SMTP_PASS'
  'teams-feedback-webhook-url': 'TEAMS_FEEDBACK_WEBHOOK_URL'
  'teams-payroll-webhook-url': 'TEAMS_PAYROLL_WEBHOOK_URL'
}

// =============================================================================
// Recursos
// =============================================================================

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    location: location
    logAnalyticsName: names.logAnalytics
    appInsightsName: names.appInsights
    retentionDays: logRetentionDays
    tags: tags
  }
}

module postgres 'modules/postgres.bicep' = {
  name: 'postgres'
  params: {
    location: location
    serverName: names.postgres
    postgresVersion: postgresVersion
    skuName: postgresSkuName
    skuTier: postgresSkuTier
    storageSizeGB: postgresStorageGB
    backupRetentionDays: postgresBackupRetentionDays
    geoRedundantBackup: postgresGeoRedundantBackup
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    databaseName: databaseName
    logAnalyticsWorkspaceId: monitoring.outputs.workspaceId
    tags: tags
  }
}

// Sin pgbouncer ni connection_limit=1: eso era propio del pooler de Supabase.
// Aquí DATABASE_URL y DIRECT_URL son la misma conexión directa.
var databaseUrl = 'postgresql://${postgresAdminLogin}:${uriComponent(postgresAdminPassword)}@${postgres.outputs.fqdn}:5432/${databaseName}?sslmode=require'

module keyVault 'modules/keyvault.bicep' = {
  name: 'keyvault'
  params: {
    location: location
    keyVaultName: names.keyVault
    tenantId: tenantId
    enablePurgeProtection: keyVaultPurgeProtection
    postgresAdminPassword: postgresAdminPassword
    databaseUrl: databaseUrl
    tags: tags
  }
}

module staticWebApp 'modules/staticwebapp.bicep' = if (createStaticWebApp) {
  name: 'staticwebapp'
  params: {
    location: staticWebAppLocation
    name: names.staticWebApp
    sku: staticWebAppSku
    tags: tags
  }
}

var swaUrl = createStaticWebApp ? 'https://${staticWebApp!.outputs.defaultHostname}' : ''
var effectiveFrontendUrl = empty(frontendUrl) ? swaUrl : frontendUrl
var corsOrigins = join(
  filter(
    union(
      [effectiveFrontendUrl, swaUrl],
      map(split(extraCorsOrigins, ','), o => trim(o))
    ),
    o => !empty(o)
  ),
  ','
)

// Referencias a Key Vault: la plataforma las resuelve con la identidad
// administrada del Web App al arrancar (y las refresca cada 24 h o al reiniciar).
var kvRef = '@Microsoft.KeyVault(VaultName=${names.keyVault};SecretName='

var baseSettings = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'TZ', value: timeZone }
  // App Service termina TLS en su front-end y reenvía con X-Forwarded-For: el
  // backend debe confiar en un salto de proxy para ver la IP real del cliente
  // (rate limit por IP). Ver documentacion/azure/PREPARACION.md.
  { name: 'TRUST_PROXY', value: '1' }
  { name: 'CORS_ORIGIN', value: corsOrigins }
  { name: 'DATABASE_URL', value: '${kvRef}database-url)' }
  { name: 'DIRECT_URL', value: '${kvRef}database-url)' }
  { name: 'AUTH_ENABLED', value: 'true' }
  { name: 'AUTH_DEMO_BYPASS', value: 'false' }
  { name: 'AZURE_AD_TENANT_ID', value: tenantId }
  { name: 'AZURE_AD_AUDIENCE', value: apiAudience }
  { name: 'ADMIN_EMAIL', value: adminEmail }
  { name: 'SUPPORT_EMAIL', value: supportEmail }
  { name: 'PAYROLL_EMAIL', value: payrollEmail }
  { name: 'JOBS_INTERVAL_MINUTES', value: string(jobsIntervalMinutes) }
  // Sincronización FX diaria DENTRO del ciclo de trabajos. Con false las tasas
  // solo se actualizan con el botón "Actualizar ahora" (ADMIN/FINANCE).
  { name: 'FX_SYNC_IN_CYCLE', value: fxSyncInCycle ? 'true' : 'false' }
  { name: 'SMTP_HOST', value: smtpHost }
  { name: 'SMTP_PORT', value: empty(smtpHost) ? '' : smtpPort }
  { name: 'SMTP_USER', value: smtpUser }
  { name: 'SMTP_FROM', value: smtpFrom }
  // Despliegue: el paquete ya viene compilado; la plataforma no ejecuta Oryx.
  { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
  { name: 'ENABLE_ORYX_BUILD', value: 'false' }
  // Health check: reemplaza la instancia tras 10 fallos (con 1 sola instancia,
  // la plataforma solo la reinicia).
  { name: 'WEBSITE_HEALTHCHECK_MAXPINGFAILURES', value: '10' }
  // Application Insights: auto-instrumentación del agente de Node en Linux.
  // OJO: el backend es ESM; el agente cubre bien solicitudes HTTP entrantes y
  // dependencias, pero parte de la instrumentación automática de módulos ESM es
  // limitada. La connection string queda disponible por si se instrumenta en
  // código (applicationinsights / @azure/monitor-opentelemetry).
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: monitoring.outputs.appInsightsConnectionString }
  { name: 'ApplicationInsightsAgent_EXTENSION_VERSION', value: '~3' }
]

// Ajustes vacíos NO se envían: SUPPORT_EMAIL/PAYROLL_EMAIL vacíos harían fallar
// la validación Zod del backend (z.string().email() no acepta "").
var nonEmptyBaseSettings = filter(baseSettings, s => !empty(s.value))

var secretSettings = map(
  filter(items(optionalSecretEnv), i => contains(presentSecrets, i.key)),
  i => { name: i.value, value: '${kvRef}${i.key})' }
)

module appService 'modules/appservice.bicep' = {
  name: 'appservice'
  params: {
    location: location
    planName: names.plan
    webAppName: names.webApp
    planSku: appServicePlanSku
    linuxFxVersion: linuxFxVersion
    appSettings: concat(nonEmptyBaseSettings, secretSettings)
    logAnalyticsWorkspaceId: monitoring.outputs.workspaceId
    tags: tags
  }
}

module keyVaultAccess 'modules/keyvault-access.bicep' = {
  name: 'keyvault-access'
  params: {
    keyVaultName: keyVault.outputs.keyVaultName
    principalId: appService.outputs.principalId
  }
}

module postgresFirewall 'modules/postgres-firewall.bicep' = {
  name: 'postgres-firewall'
  params: {
    serverName: postgres.outputs.serverName
    allowedIps: split(appService.outputs.possibleOutboundIpAddresses, ',')
  }
}

module alerts 'modules/alerts.bicep' = {
  name: 'alerts'
  params: {
    location: location
    environmentName: environmentName
    namePrefix: namePrefix
    alertEmail: alertEmail
    appInsightsId: monitoring.outputs.appInsightsId
    webAppId: appService.outputs.webAppId
    webAppHostname: appService.outputs.defaultHostname
    postgresServerId: postgres.outputs.serverId
    monthlyBudgetUsd: monthlyBudgetUsd
    budgetStartDate: budgetStartDate
    availabilityLocationCount: availabilityLocationCount
    availabilityFrequencySeconds: availabilityFrequencySeconds
    http5xxThreshold: http5xxThreshold
    responseTimeThresholdSeconds: responseTimeThresholdSeconds
    tags: tags
  }
}

// =============================================================================
// Salidas (las guarda scripts/azure.ps1 en infra/.out/<env>.json)
// =============================================================================

output environmentName string = environmentName
output webAppName string = appService.outputs.webAppName
output webAppHostname string = appService.outputs.defaultHostname
output apiUrl string = 'https://${appService.outputs.defaultHostname}'
output appServicePlanName string = appService.outputs.planName
output postgresServerName string = postgres.outputs.serverName
output postgresFqdn string = postgres.outputs.fqdn
output postgresDatabase string = postgres.outputs.databaseName
output keyVaultName string = keyVault.outputs.keyVaultName
output keyVaultUri string = keyVault.outputs.keyVaultUri
output staticWebAppName string = createStaticWebApp ? staticWebApp!.outputs.name : ''
output staticWebAppHostname string = createStaticWebApp ? staticWebApp!.outputs.defaultHostname : ''
output frontendUrl string = effectiveFrontendUrl
output corsOrigins string = corsOrigins
output appInsightsName string = monitoring.outputs.appInsightsName
output logAnalyticsWorkspaceName string = monitoring.outputs.workspaceName
output logAnalyticsCustomerId string = monitoring.outputs.workspaceCustomerId
output webTestName string = alerts.outputs.webTestName
