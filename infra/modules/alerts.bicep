// Monitoreo y alertas del entorno.
//
// - Action Group con el correo de la config (AlertEmail).
// - Prueba de disponibilidad ESTÁNDAR contra /health, cada 5 min desde 3
//   ubicaciones (parametrizable). /health devuelve 503 si la base está caída (no por un trabajo
//   obsoleto: eso lo publica en `jobs.estado` sin tumbar el código HTTP).
// - Alertas métricas: disponibilidad < 100 %, HTTP 5xx, tiempo de respuesta,
//   CPU y almacenamiento de Postgres > 80 %.
// - Presupuesto mensual del resource group con aviso al 80 % y al 100 %.

@description('Ubicación de los recursos (la prueba web vive junto a App Insights).')
param location string

@description('Nombre del entorno (stage | prod), para nombres y textos.')
param environmentName string

@description('Prefijo de nombres, p. ej. synatrack-stage.')
param namePrefix string

@description('Correo que recibe alertas y avisos de presupuesto.')
param alertEmail string

@description('ID del recurso de Application Insights.')
param appInsightsId string

@description('ID del Web App.')
param webAppId string

@description('Hostname del Web App (sin https://).')
param webAppHostname string

@description('ID del servidor de Postgres.')
param postgresServerId string

@description('Monto del presupuesto mensual en USD.')
param monthlyBudgetUsd int

@description('Inicio del presupuesto: primer día de un mes, yyyy-MM-dd. Lo calcula el script (no puede cambiar una vez creado).')
param budgetStartDate string

@description('Cuántas ubicaciones usa la prueba de disponibilidad (3-5). Cada ejecución se cobra: ver PLAN.md, costos.')
@minValue(3)
@maxValue(5)
param availabilityLocationCount int = 3

@description('Frecuencia de la prueba de disponibilidad en segundos.')
@allowed([
  300
  600
  900
])
param availabilityFrequencySeconds int = 300

@description('Umbral de respuestas 5xx en 5 minutos.')
param http5xxThreshold int = 5

@description('Umbral de tiempo de respuesta promedio en segundos (ventana de 15 min).')
param responseTimeThresholdSeconds int = 3

@description('Etiquetas comunes.')
param tags object = {}

var isProd = environmentName == 'prod'
// Sev 1 en prod (error), Sev 2 en stage (advertencia).
var severity = isProd ? 1 : 2

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'ag-${namePrefix}'
  location: 'global'
  tags: tags
  properties: {
    // Máximo 12 caracteres: es lo que aparece en SMS/correo como remitente.
    groupShortName: take('syn-${environmentName}', 12)
    enabled: true
    emailReceivers: [
      {
        name: 'equipo'
        emailAddress: alertEmail
        useCommonAlertSchema: true
      }
    ]
  }
}

var webTestName = 'wt-${namePrefix}-health'

// Ubicaciones de la prueba, en orden de preferencia (se toman las primeras N).
var availabilityLocations = [
  { Id: 'us-va-ash-azr' } // East US
  { Id: 'us-tx-sn1-azr' } // South Central US
  { Id: 'latam-br-gru-edge' } // Brazil South (cerca de los usuarios de LatAm)
  { Id: 'us-il-ch1-azr' } // North Central US
  { Id: 'us-ca-sjc-azr' } // West US
]

resource healthTest 'Microsoft.Insights/webtests@2022-06-15' = {
  name: webTestName
  location: location
  // La etiqueta hidden-link es la que asocia la prueba con App Insights.
  tags: union(tags, {
    'hidden-link:${appInsightsId}': 'Resource'
  })
  kind: 'standard'
  properties: {
    SyntheticMonitorId: webTestName
    Name: 'Synatrack ${environmentName} /health'
    Description: 'GET /health del backend; 200 = API y base arriba.'
    Enabled: true
    Frequency: availabilityFrequencySeconds
    Timeout: 30
    Kind: 'standard'
    RetryEnabled: true
    Locations: take(availabilityLocations, availabilityLocationCount)
    Request: {
      RequestUrl: 'https://${webAppHostname}/health'
      HttpVerb: 'GET'
      ParseDependentRequests: false
    }
    ValidationRules: {
      ExpectedHttpStatusCode: 200
      SSLCheck: true
      SSLCertRemainingLifetimeCheck: 7
    }
  }
}

// Una regla métrica por señal. `autoMitigate` cierra la alerta sola cuando la
// señal vuelve a la normalidad.
var metricAlerts = [
  {
    key: 'availability'
    description: 'La prueba de disponibilidad de /health falló en al menos una ubicación.'
    scope: appInsightsId
    namespace: 'microsoft.insights/components'
    metric: 'availabilityResults/availabilityPercentage'
    operator: 'LessThan'
    threshold: 100
    aggregation: 'Average'
    window: 'PT15M'
    frequency: 'PT5M'
    dimensions: [
      {
        name: 'availabilityResult/name'
        operator: 'Include'
        values: [
          'Synatrack ${environmentName} /health'
        ]
      }
    ]
  }
  {
    key: 'http5xx'
    description: 'El backend devolvió más de ${http5xxThreshold} respuestas 5xx en 5 minutos.'
    scope: webAppId
    namespace: 'Microsoft.Web/sites'
    metric: 'Http5xx'
    operator: 'GreaterThan'
    threshold: http5xxThreshold
    aggregation: 'Total'
    window: 'PT5M'
    frequency: 'PT1M'
    dimensions: []
  }
  {
    key: 'response-time'
    description: 'Tiempo de respuesta promedio del backend > ${responseTimeThresholdSeconds} s en 15 minutos.'
    scope: webAppId
    namespace: 'Microsoft.Web/sites'
    metric: 'HttpResponseTime'
    operator: 'GreaterThan'
    threshold: responseTimeThresholdSeconds
    aggregation: 'Average'
    window: 'PT15M'
    frequency: 'PT5M'
    dimensions: []
  }
  {
    key: 'pg-cpu'
    description: 'CPU de Postgres > 80 % en 15 minutos.'
    scope: postgresServerId
    namespace: 'Microsoft.DBforPostgreSQL/flexibleServers'
    metric: 'cpu_percent'
    operator: 'GreaterThan'
    threshold: 80
    aggregation: 'Average'
    window: 'PT15M'
    frequency: 'PT5M'
    dimensions: []
  }
  {
    key: 'pg-storage'
    description: 'Almacenamiento de Postgres > 80 %.'
    scope: postgresServerId
    namespace: 'Microsoft.DBforPostgreSQL/flexibleServers'
    metric: 'storage_percent'
    operator: 'GreaterThan'
    threshold: 80
    aggregation: 'Maximum'
    window: 'PT1H'
    frequency: 'PT15M'
    dimensions: []
  }
]

resource alerts 'Microsoft.Insights/metricAlerts@2018-03-01' = [
  for a in metricAlerts: {
    name: 'alert-${namePrefix}-${a.key}'
    location: 'global'
    tags: tags
    properties: {
      description: a.description
      severity: severity
      enabled: true
      scopes: [
        a.scope
      ]
      evaluationFrequency: a.frequency
      windowSize: a.window
      autoMitigate: true
      criteria: {
        'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
        allOf: [
          {
            criterionType: 'StaticThresholdCriterion'
            name: a.key
            metricNamespace: a.namespace
            metricName: a.metric
            operator: a.operator
            threshold: a.threshold
            timeAggregation: a.aggregation
            dimensions: a.dimensions
          }
        ]
      }
      actions: [
        {
          actionGroupId: actionGroup.id
        }
      ]
    }
    dependsOn: [
      healthTest
    ]
  }
]

resource budget 'Microsoft.Consumption/budgets@2023-11-01' = {
  name: 'budget-${namePrefix}'
  properties: {
    category: 'Cost'
    amount: monthlyBudgetUsd
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: budgetStartDate
    }
    notifications: {
      actual80: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 80
        thresholdType: 'Actual'
        contactEmails: [
          alertEmail
        ]
        contactGroups: [
          actionGroup.id
        ]
        locale: 'es-es'
      }
      actual100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Actual'
        contactEmails: [
          alertEmail
        ]
        contactGroups: [
          actionGroup.id
        ]
        locale: 'es-es'
      }
      forecast100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Forecasted'
        contactEmails: [
          alertEmail
        ]
        contactGroups: [
          actionGroup.id
        ]
        locale: 'es-es'
      }
    }
  }
}

output actionGroupId string = actionGroup.id
output webTestName string = healthTest.name
output budgetName string = budget.name
