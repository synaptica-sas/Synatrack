// Azure Database for PostgreSQL - Flexible Server + base `synatrack`.
//
// Red: ACCESO PÚBLICO con firewall. Las reglas se crean aparte
// (postgres-firewall.bicep) con las IPs salientes posibles del App Service.
// `require_secure_transport = ON` obliga TLS; la cadena de conexión lleva
// `sslmode=require`.
//
// Cambiar a red privada (VNet + delegated subnet o private endpoint) NO se puede
// hacer en caliente sobre el mismo servidor con acceso público: hay que crear
// uno nuevo y restaurar. Ver documentacion/azure/PLAN.md, "Pasar a red privada".

@description('Ubicación de los recursos.')
param location string

@description('Nombre del servidor (único global: forma parte del FQDN).')
param serverName string

@description('Versión mayor de PostgreSQL.')
@allowed([
  '16'
  '17'
])
param postgresVersion string = '17'

@description('SKU de cómputo, p. ej. Standard_B1ms.')
param skuName string = 'Standard_B1ms'

@description('Nivel del SKU.')
@allowed([
  'Burstable'
  'GeneralPurpose'
  'MemoryOptimized'
])
param skuTier string = 'Burstable'

@description('Almacenamiento en GB.')
param storageSizeGB int = 32

@description('Crecimiento automático del almacenamiento.')
param storageAutoGrow bool = true

@description('Días de retención de backups (7-35).')
@minValue(7)
@maxValue(35)
param backupRetentionDays int = 7

@description('Backups geo-redundantes (solo se puede elegir al crear el servidor).')
param geoRedundantBackup bool = false

@description('Usuario administrador.')
param administratorLogin string

@description('Contraseña del administrador.')
@secure()
param administratorLoginPassword string

@description('Nombre de la base de la aplicación.')
param databaseName string = 'synatrack'

@description('Workspace de Log Analytics para los logs del servidor.')
param logAnalyticsWorkspaceId string

@description('Zona de disponibilidad ("1", "2", "3") o vacío para que Azure elija. Algunas suscripciones (p. ej. MCPP) tienen el SKU bloqueado en ciertas zonas y fallan con SkuNotAvailable si Azure elige esa. Solo se fija al crear el servidor.')
param availabilityZone string = ''

@description('Etiquetas comunes.')
param tags object = {}

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: serverName
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: skuTier
  }
  properties: {
    version: postgresVersion
    availabilityZone: empty(availabilityZone) ? null : availabilityZone
    administratorLogin: administratorLogin
    administratorLoginPassword: administratorLoginPassword
    authConfig: {
      passwordAuth: 'Enabled'
      activeDirectoryAuth: 'Disabled'
    }
    storage: {
      storageSizeGB: storageSizeGB
      autoGrow: storageAutoGrow ? 'Enabled' : 'Disabled'
    }
    backup: {
      backupRetentionDays: backupRetentionDays
      geoRedundantBackup: geoRedundantBackup ? 'Enabled' : 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: server
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// Ya viene en ON por defecto; se declara para que nadie lo apague desde el portal
// sin que el siguiente despliegue lo regrese.
resource requireTls 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: server
  name: 'require_secure_transport'
  properties: {
    value: 'ON'
    source: 'user-override'
  }
}

resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'to-log-analytics'
  scope: server
  properties: {
    workspaceId: logAnalyticsWorkspaceId
    logs: [
      {
        categoryGroup: 'allLogs'
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

output serverId string = server.id
output serverName string = server.name
output fqdn string = server.properties.fullyQualifiedDomainName
output databaseName string = database.name
