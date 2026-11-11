// Static Web App del frontend.
//
// SIN "linked backend": el frontend llama directo al App Service con CORS, igual
// que hoy con Render. Motivo: la app manda su propio
// `Authorization: Bearer <JWT de Entra>` y, con un backend enlazado, SWA se pone
// delante de /api y reescribe ese encabezado con su propia autenticación. Ver
// documentacion/azure/PLAN.md, "Decisiones".
//
// No se enlaza a un repositorio: el despliegue lo hace el workflow
// deploy-frontend-azure.yml con un token que obtiene en cada ejecución
// (`az staticwebapp secrets list`), sin guardarlo en GitHub.

@description('Ubicación (Static Web Apps solo existe en algunas regiones; centralus y eastus2 sí).')
param location string

@description('Nombre de la Static Web App.')
param name string

@description('SKU: Free o Standard (Standard: SLA, dominios y autenticación personalizados).')
@allowed([
  'Free'
  'Standard'
])
param sku string = 'Free'

@description('Etiquetas comunes.')
param tags object = {}

resource site 'Microsoft.Web/staticSites@2024-04-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: sku
    tier: sku
  }
  properties: {
    stagingEnvironmentPolicy: 'Disabled'
    allowConfigFileUpdates: true
    publicNetworkAccess: 'Enabled'
  }
}

output name string = site.name
output defaultHostname string = site.properties.defaultHostname
