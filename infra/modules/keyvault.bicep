// Key Vault en modo RBAC + los dos secretos que la infraestructura conoce.
//
// Secretos que crea este módulo:
//   - postgres-admin-password : la genera scripts/azure.ps1 la primera vez y
//                               después se relee de aquí, así que no cambia en
//                               cada despliegue ni queda en disco.
//   - database-url            : cadena completa para Prisma (DATABASE_URL y
//                               DIRECT_URL apuntan a ella).
//
// Los demás secretos (jobs-run-token, fx-sync-token, smtp-pass y los webhooks
// de Teams) NO se crean aquí: sus valores los carga el usuario con
// `scripts/azure.ps1 -Command secret-set`. Ver main.bicep, `presentSecrets`.
//
// Nota: crear secretos vía ARM es una operación del plano de control, así que la
// identidad del pipeline con Contributor puede hacerlo sin rol de datos. LEER
// un secreto (az keyvault secret show) sí es plano de datos y exige
// "Key Vault Secrets User" (lo asigna `bootstrap`).

@description('Ubicación de los recursos.')
param location string

@description('Nombre del Key Vault (3-24 caracteres, único global).')
@maxLength(24)
param keyVaultName string

@description('Tenant de Entra ID dueño del vault.')
param tenantId string

@description('Activa la protección contra purga. Es IRREVERSIBLE una vez activada.')
param enablePurgeProtection bool

@description('Días de retención del borrado suave.')
@minValue(7)
@maxValue(90)
param softDeleteRetentionDays int = 90

@description('Contraseña del administrador de Postgres.')
@secure()
param postgresAdminPassword string

@description('Cadena de conexión completa de Prisma (con sslmode=require).')
@secure()
param databaseUrl string

@description('Etiquetas comunes.')
param tags object = {}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    tenantId: tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: softDeleteRetentionDays
    // `null` en vez de `false`: la API rechaza "false" si alguna vez estuvo en true.
    enablePurgeProtection: enablePurgeProtection ? true : null
    // Acceso público: lo leen el App Service (identidad administrada) y el
    // runner de GitHub. Para pasar a red privada ver documentacion/azure/PLAN.md.
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
}

resource secretPostgresPassword 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'postgres-admin-password'
  properties: {
    value: postgresAdminPassword
    contentType: 'text/plain'
  }
}

resource secretDatabaseUrl 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'database-url'
  properties: {
    value: databaseUrl
    contentType: 'text/plain'
  }
}

output keyVaultId string = vault.id
output keyVaultName string = vault.name
output keyVaultUri string = vault.properties.vaultUri
