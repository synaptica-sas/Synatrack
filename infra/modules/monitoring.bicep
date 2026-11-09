// Log Analytics + Application Insights (basado en workspace).
//
// Todo lo que se monitorea del entorno (logs de consola del App Service, logs
// de Postgres, resultados de la prueba de disponibilidad, telemetría de la app)
// termina en este workspace, así que una sola consulta KQL lo cruza todo.

@description('Ubicación de los recursos.')
param location string

@description('Nombre del workspace de Log Analytics.')
param logAnalyticsName string

@description('Nombre del recurso de Application Insights.')
param appInsightsName string

@description('Días de retención de los logs.')
@minValue(30)
@maxValue(730)
param retentionDays int = 30

@description('Etiquetas comunes.')
param tags object = {}

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: retentionDays
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    IngestionMode: 'LogAnalytics'
    RetentionInDays: retentionDays
  }
}

output workspaceId string = workspace.id
output workspaceName string = workspace.name
@description('GUID del workspace (customerId): es el que pide la API de consultas KQL.')
output workspaceCustomerId string = workspace.properties.customerId
output appInsightsId string = appInsights.id
output appInsightsName string = appInsights.name
output appInsightsConnectionString string = appInsights.properties.ConnectionString
