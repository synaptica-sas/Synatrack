// Rol "Key Vault Secrets User" para la identidad administrada del Web App.
//
// Es el mínimo para resolver referencias @Microsoft.KeyVault(...) en App
// Settings: solo lee valores de secretos, no los lista ni los escribe.
//
// Crear esta asignación exige Microsoft.Authorization/roleAssignments/write en
// el vault. La identidad del pipeline lo tiene por el rol "Role Based Access
// Control Administrator" que asigna `scripts/azure.ps1 -Command bootstrap`,
// restringido por condición a este único rol (ver infra/README.md).

@description('Nombre del Key Vault.')
param keyVaultName string

@description('principalId de la identidad administrada del Web App.')
param principalId string

// Rol integrado: Key Vault Secrets User.
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource secretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, principalId, keyVaultSecretsUserRoleId)
  scope: vault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}
