// App Service Plan Linux + Web App Node del backend.
//
// - Sin deployment slots (B1 no los tiene). Rollback = redesplegar un commit
//   anterior con deploy-backend-azure.yml (workflow_dispatch + ref).
// - Arranque: `node dist/server.js` (el script `start` del backend). El paquete
//   que sube el workflow ya trae dist/, node_modules de producción y el cliente
//   Prisma generado, así que la plataforma NO compila nada
//   (SCM_DO_BUILD_DURING_DEPLOYMENT=false).
// - App Service inyecta PORT (8080) y el backend escucha en env.PORT y 0.0.0.0.
// - Las App Settings las gobierna este Bicep: cada despliegue REEMPLAZA la lista
//   completa. Un ajuste hecho a mano en el portal se pierde en el siguiente
//   `infra`; agrégalo aquí.

@description('Ubicación de los recursos.')
param location string

@description('Nombre del App Service Plan.')
param planName string

@description('Nombre del Web App (único global: forma parte del hostname).')
param webAppName string

@description('SKU del plan. B1 no tiene slots ni autoescala.')
param planSku string = 'B1'

@description('Runtime de Linux, p. ej. NODE|24-lts. Ver `az webapp list-runtimes --os linux`.')
param linuxFxVersion string

@description('Comando de arranque.')
param startupCommand string = 'node dist/server.js'

@description('Ruta del health check de la plataforma.')
param healthCheckPath string = '/health'

@description('App Settings ya armadas por main.bicep: [{ name, value }].')
param appSettings array

@description('Workspace de Log Analytics para los logs del App Service.')
param logAnalyticsWorkspaceId string

@description('Etiquetas comunes.')
param tags object = {}

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: planName
  location: location
  tags: tags
  kind: 'linux'
  sku: {
    name: planSku
  }
  properties: {
    reserved: true // obligatorio para Linux
  }
}

resource webApp 'Microsoft.Web/sites@2024-04-01' = {
  name: webAppName
  location: location
  tags: tags
  kind: 'app,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    clientAffinityEnabled: false
    keyVaultReferenceIdentity: 'SystemAssigned'
    publicNetworkAccess: 'Enabled'
    siteConfig: {
      linuxFxVersion: linuxFxVersion
      appCommandLine: startupCommand
      alwaysOn: true
      http20Enabled: true
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      ftpsState: 'Disabled'
      healthCheckPath: healthCheckPath
      appSettings: appSettings
    }
  }
}

// Sin credenciales básicas (usuario/contraseña de publicación) ni para FTP ni
// para SCM: el workflow despliega con el token de Entra que deja azure/login.
resource ftpBasicAuth 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-04-01' = {
  parent: webApp
  name: 'ftp'
  properties: {
    allow: false
  }
}

resource scmBasicAuth 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-04-01' = {
  parent: webApp
  name: 'scm'
  properties: {
    allow: false
  }
}

// Logs de consola en el sistema de archivos: es lo que muestra
// `az webapp log tail` (scripts/azure.ps1 -Command logs).
resource logsConfig 'Microsoft.Web/sites/config@2024-04-01' = {
  parent: webApp
  name: 'logs'
  properties: {
    applicationLogs: {
      fileSystem: {
        level: 'Information'
      }
    }
    httpLogs: {
      fileSystem: {
        enabled: true
        retentionInDays: 3
        retentionInMb: 35
      }
    }
    detailedErrorMessages: {
      enabled: false
    }
    failedRequestsTracing: {
      enabled: false
    }
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: webApp
  properties: {
    workspaceId: logAnalyticsWorkspaceId
    logs: [
      {
        category: 'AppServiceConsoleLogs'
        enabled: true
      }
      {
        category: 'AppServiceHTTPLogs'
        enabled: true
      }
      {
        category: 'AppServiceAppLogs'
        enabled: true
      }
      {
        category: 'AppServicePlatformLogs'
        enabled: true
      }
    ]
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
      }
    ]
  }
}

output planId string = plan.id
output planName string = plan.name
output webAppId string = webApp.id
output webAppName string = webApp.name
output defaultHostname string = webApp.properties.defaultHostName
output principalId string = webApp.identity.principalId
@description('IPs salientes posibles, separadas por coma.')
output possibleOutboundIpAddresses string = webApp.properties.possibleOutboundIpAddresses
