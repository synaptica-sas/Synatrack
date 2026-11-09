// Reglas de firewall de Postgres a partir de las IPs salientes del App Service.
//
// Va en módulo aparte porque la lista de IPs (`possibleOutboundIpAddresses`) solo
// se conoce en tiempo de despliegue: un bucle `for` necesita saber su tamaño al
// empezar, y dentro de un módulo el parámetro ya está resuelto.
//
// `possibleOutboundIpAddresses` (y no `outboundIpAddresses`) porque incluye las
// IPs que la plataforma podría usar si cambia de escala o de stamp; con la lista
// corta, un cambio de plan podía dejar a la app sin base.
//
// Limitación: el modo incremental de ARM no borra reglas. Si el App Service deja
// de usar una IP, su regla queda abierta hasta que se borre a mano
// (`az postgres flexible-server firewall-rule delete`). Las reglas temporales del
// runner de GitHub se llaman `gh-runner-*` y las cierra el propio workflow.

@description('Nombre del servidor Flexible Server.')
param serverName string

@description('IPs que pueden conectarse.')
param allowedIps array

@description('Prefijo del nombre de cada regla.')
param rulePrefix string = 'appsvc'

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' existing = {
  name: serverName
}

// `batchSize(1)`: Flexible Server no admite operaciones de firewall en paralelo
// (devuelve conflicto si llegan varias a la vez).
@batchSize(1)
resource rules 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = [
  for (ip, i) in allowedIps: {
    parent: server
    name: '${rulePrefix}-${replace(ip, '.', '-')}'
    properties: {
      startIpAddress: ip
      endIpAddress: ip
    }
  }
]

output ruleCount int = length(allowedIps)
