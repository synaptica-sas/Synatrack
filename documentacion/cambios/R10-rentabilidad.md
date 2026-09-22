# R10 — Un solo cálculo de rentabilidad y un solo umbral de margen

Rama: `fix/rentabilidad-unificada` (sale de `dev`). Sin commits: los cambios quedan en el árbol de
trabajo.

Cierra los puntos **6** (tres implementaciones no unificadas de rentabilidad) y **7**
(`marginThreshold` hardcodeado a 15) de `DOCUMENTACION_TECNICA.md` §10.2, y de paso el **8**
(`delayedMilestones` con criterios distintos) y el **4** de §10.1 (bug de FX en
`/api/projects/:id/profitability`), que aparecieron dentro del mismo código.

Lo que estaba en juego: **el mismo proyecto daba tres semáforos distintos según la pantalla**.
Un número que alguien firma no puede depender de por dónde entró a mirarlo.

---

## 1. Las diferencias reales que había entre las cuatro implementaciones

Se compararon `calculateProfitability` (`utils/financial.ts`), `/api/stats/overview`,
`/api/stats/portfolio`, `GET /api/projects/:id/detail` y `alerts.service.ts`.

### 1.1 Qué entra en el costo

Idéntico en los cinco sitios: `horas APROBADAS × consultant.hourlyRate` convertido a la moneda
base, más los gastos convertidos. **Esta parte nunca divergió.**

La única diferencia: `/overview` filtra horas y gastos por el rango `from`/`to` de la query (el
tablero puede pedir un período); los demás toman todo el histórico. Es una diferencia
**intencional** del endpoint, no un error, y se conserva — el filtrado sigue ocurriendo en la
consulta Prisma, antes de entrar al cálculo.

### 1.2 Qué entra en el ingreso

- `revenueRecognized` = suma de `RevenueEntry` convertida. Idéntico en los cinco.
- **Ingreso proyectado**: solo `calculateProfitability` y `/overview` lo calculaban
  (`revenueRecognized` + horas de forecast pendientes × `sellRate`). `/portfolio`, el detalle y
  alertas **no tenían concepto de ingreso proyectado**.

### 1.3 Cómo trataban el forecast — aquí estaba el daño grande

| Sitio | Tratamiento del forecast |
|---|---|
| `calculateProfitability` | `(hoursProjected − horas aprobadas del mismo consultor en el rango) × (forecast.hourlyRate ?? consultant.hourlyRate)`, convertido desde **`forecast.currency`** |
| `/stats/overview` | Igual (llamaba a los mismos helpers) |
| `/stats/portfolio` | `hoursProjected × consultant.hourlyRate`, convertido desde **`consultant.rateCurrency`** |
| `project-detail` | **Ninguno.** Cargaba `forecasts` en el `include` y nunca los usaba |
| `alerts.service` | **Ninguno.** Ni siquiera los cargaba |

`/portfolio` acumulaba **tres** desviaciones a la vez: no descontaba lo ya ejecutado, ignoraba la
tarifa propia del forecast y convertía desde la moneda equivocada. La primera es la peor: un
proyecto que ya ejecutó el 75 % de su forecast veía ese 75 % contado **dos veces** (una como gasto
real, otra como proyección). Esto no era "distinto", era **incorrecto**: `getAdjustedForecastCost`
existía precisamente para arreglarlo y `/portfolio` nunca se enganchó.

### 1.4 Cómo calculaban el `alertLevel`

| Sitio | Base del porcentaje | Umbrales |
|---|---|---|
| `/overview`, `/portfolio` | `(gasto real + forecast) / presupuesto` | `> 100` excedido, `> 90` aviso (literales) |
| `project-detail` | `gasto real / presupuesto` (**sin forecast**) | `> 100`, `> 90` (literales) |
| `alerts.service` | `gasto real / presupuesto` | `> 100`, `>= project.budgetAlertPct ?? 90` (**configurable**) |

Es decir: el detalle usaba una métrica distinta (consumo, no proyección) bajo el mismo nombre, y
`budgetAlertPct` — un campo que el usuario puede configurar por proyecto — solo lo respetaba el
motor de alertas. La misma enfermedad de `marginThreshold`, en otro campo.

### 1.5 Cómo calculaban el margen y el porcentaje

La fórmula era la misma en todos: `(ingreso − gasto) / ingreso × 100`. Las diferencias estaban
en los bordes y el redondeo:

| Sitio | Sin ingresos reconocidos | Redondeo del % |
|---|---|---|
| `/overview`, `/portfolio` | `null` | 2 decimales |
| `project-detail` | `null` | 1 decimal |
| `calculateProfitability` | **`0`** | 2 decimales |

El `0` de `calculateProfitability` es un **error latente**: un proyecto que todavía no ha
facturado nada no tiene "margen del 0 %", tiene margen **no medible**. Si ese valor se hubiera
alimentado al semáforo, todo proyecto recién arrancado habría salido amarillo o rojo. Corregido a
`null`, que es lo que ya hacían los otros tres.

### 1.6 `marginThreshold`

| Sitio | Umbral usado |
|---|---|
| `project-detail.routes.ts:88` | `project.marginThreshold` real (y **ignora el margen** si es `null`) |
| `stats.routes.ts:193` (`/overview`) | `15` literal |
| `stats.routes.ts:404` (`/portfolio`) | `15` literal |
| `alerts.service.ts:161` | `const threshold = 15` |

### 1.7 `delayedMilestones` y riesgos (punto 8)

`stats` derivaba el atraso (`status !== "COMPLETED" && plannedDate < hoy`); el detalle exigía
`status === "DELAYED"`, un estado que hay que marcar a mano. Dos entradas más al semáforo que
divergían. Los riesgos altos (`score >= 6 && OPEN`) sí coincidían, pero estaban copiados en tres
sitios.

---

## 2. Qué se unificó

### 2.1 `computeProjectFinancials` en `utils/financial.ts`

Una sola función pura — sin Prisma, sin `fetch`, sin entorno, sin `new Date()` dentro — que recibe
el `rateMap` ya construido y la `baseCurrency` por parámetro y devuelve **todos** los números:
presupuesto, consumo, proyección, ingresos, costos, horas, márgenes, umbrales resueltos,
`belowMarginThreshold` y `alertLevel`.

La consumen los cinco sitios:

| Consumidor | Cómo |
|---|---|
| `/api/stats/overview` | `computeProjectFinancials(toFinancialsInput(...))` |
| `/api/stats/portfolio` | idem |
| `GET /api/projects/:id/detail` | idem |
| `GET /api/projects/:id/profitability` | vía `calculateProfitability`, que ahora **delega** en el núcleo |
| `alerts.service.ts` | idem, para la alerta de margen |

`toFinancialsInput(project, approvedEntries, rateMap, baseCurrency)` es el adaptador de filas de
Prisma (`Decimal` → `number`, nulos preservados). Vive también en `financial.ts` porque es puro
y así ninguna ruta tiene que importar de otra ruta.

`health.ts` gana `countDelayedMilestones(milestones, now)` y `countOpenHighRisks(risks)` — `now`
entra por parámetro, la utilidad no lee el reloj.

### 2.2 La decisión sobre `marginThreshold` nulo

**`marginThreshold = null` significa "no configurado", no "sin control de margen". Se aplica un
default explícito de 15 %, declarado una sola vez como
`DEFAULT_MARGIN_THRESHOLD_PCT` en `financial.ts`.**

Por qué ese camino y no el contrario (ignorar el margen, que es lo que hacía el detalle):

1. El campo está vacío en la práctica totalidad de los proyectos. Unificar hacia "ignorar" habría
   **apagado en silencio el control de margen de todo el portafolio** y la alerta
   `MARGIN_BELOW_THRESHOLD` habría dejado de dispararse por completo. Aflojar un control sin que
   nadie lo pida es peor que endurecerlo.
2. El 15 ya era el comportamiento de facto en 3 de los 4 sitios. Mantenerlo no inventa una regla
   nueva: solo la pone en un sitio con nombre en vez de en tres literales.
3. Es sobreescribible por proyecto, que es justamente para lo que existe el campo.

`marginThreshold = 0` en base de datos es un valor **válido** y se respeta (no cae al default);
solo `null`/`undefined`/`NaN` lo hacen. Hay test para eso.

Lo mismo se hizo con `budgetAlertPct`: `DEFAULT_BUDGET_ALERT_PCT = 90`, respetando el valor por
proyecto en los tres endpoints y no solo en el motor de alertas.

### 2.3 Correcciones de variantes que estaban mal (no solo distintas)

| Qué | Por qué la otra era la correcta |
|---|---|
| `/portfolio` ahora descuenta las horas aprobadas del forecast | Contarlas dos veces (como gasto real y como proyección) infla el EAC. `getAdjustedForecastCost` ya existía con este propósito documentado |
| `/portfolio` ahora usa `forecast.hourlyRate` y `forecast.currency` | El forecast puede pactar una tarifa y moneda distintas a las del consultor; usar las del consultor descarta un dato explícito del usuario |
| `calculateProfitability` devuelve `null` y no `0` sin ingresos | "No medible" ≠ "0 %". Los otros tres sitios ya lo hacían bien |
| `project-detail` ahora cuenta el forecast en `alertLevel` | Ya cargaba los forecasts y los tiraba. Dos de tres sitios usaban la proyección; la proyección es lo que responde "¿nos vamos a pasar?" |
| `/profitability`: FX arreglado | Reconstruía el `rateMap` con `key.split("_")` cuando `buildRateMap` usa `"->"`, así que **todas** las conversiones caían al fallback y devolvía montos sin convertir. Ahora recibe los `FxConfig` crudos (punto 4 de §10.1) |
| `delayedMilestones` homologado | Se toma el criterio derivado de `stats` (no depende de que alguien marque el hito a mano) **y además** se respeta el `DELAYED` explícito cuando está puesto |

---

## 3. Qué números cambian y en qué pantallas

Medido con un servidor compilado real (`node dist/server.js`) contra una base dedicada, con dos
proyectos sembrados. Ambas capturas son del mismo dato: la primera con el código de `dev`, la
segunda con el de esta rama.

### Proyecto A — `marginThreshold = 25`, margen real del 20 %

Presupuesto 100 000 USD, ingreso reconocido 100 000, coste 80 000 (1000 h × 80 USD).
Margen = 20 %: **por encima** del 15 hardcodeado, **por debajo** del 25 que configuró el usuario.

| Pantalla | ANTES | AHORA |
|---|---|---|
| Tablero (`/stats/overview`) | **GREEN** · umbral 15 | **YELLOW** · umbral 25 |
| Portafolio (`/stats/portfolio`) | **GREEN** · umbral 15 | **YELLOW** · umbral 25 |
| Detalle del proyecto | **YELLOW** · umbral 25 | **YELLOW** · umbral 25 |
| Alerta `MARGIN_BELOW_THRESHOLD` | **no se generaba** (20 > 15) | `[WARNING] margen bruto de 20.0% (umbral 25%)` |

**Dirección del cambio**: tablero y portafolio se vuelven **más estrictos** para los proyectos que
tengan un `marginThreshold` mayor que 15, y **más laxos** para los que lo tengan menor. El detalle
no se mueve. Los proyectos sin umbral configurado no cambian de color por esta causa.

### Proyecto B — forecast parcialmente ejecutado

Presupuesto 100 000 USD. Forecast de 800 h a 100 USD en Q2; ya hay 600 h aprobadas del mismo
consultor en ese Q2.

| Pantalla | ANTES | AHORA |
|---|---|---|
| Tablero | GREEN · proyectado 80 000 (80 %) · alerta `ok` | GREEN · proyectado 80 000 (80 %) · alerta `ok` |
| Portafolio | **RED** · proyectado **140 000 (140 %)** · alerta **`exceeded`** | **GREEN** · proyectado 80 000 (80 %) · alerta `ok` |
| Detalle | GREEN · sin proyección · alerta `ok` | GREEN · proyectado 80 000 (80 %) · alerta `ok` |

El portafolio contaba 600 h dos veces. **Este es el cambio de número más grande de R10**: el
portafolio pasa de 140 % a 80 % de presupuesto proyectado y el proyecto deja de estar en rojo.

### Resumen por pantalla

| Pantalla | Qué cambia |
|---|---|
| **Tablero** | Semáforo según `marginThreshold` real. `usedBudgetPercent`, `projectedPct`, `budgetVariance` sin cambio numérico. Nuevo campo `marginThreshold` en la respuesta |
| **Portafolio** | Semáforo por `marginThreshold` real **y** `alertLevel` deja de sobreestimar el forecast: **los proyectos con forecast parcialmente ejecutado bajan de proyectado y varios saldrán de rojo/ámbar**. Nuevos campos `projectedPct` y `marginThreshold` |
| **Detalle** | El semáforo no cambia por margen (ya usaba el umbral real). Sí cambia `alertLevel`, que ahora incluye la proyección: **puede pasar de `ok` a `warning`/`exceeded`** en proyectos con forecast pendiente grande. `delayedMilestones` puede subir (ahora cuenta los vencidos, no solo los marcados). `grossMarginActualPct` pasa de 1 a 2 decimales (la UI muestra 1, no se ve). Nuevos campos `projectedPct`, `projectedTotal`, `marginThreshold` |
| **Alertas** | `MARGIN_BELOW_THRESHOLD` usa el umbral del proyecto: **aparecen alertas nuevas** donde el umbral configurado es > 15 y **desaparecen** donde es < 15. La alerta de presupuesto (`BUDGET_*`) no se tocó |
| **`/profitability`** | No lo consume el frontend hoy. Con FX arreglado, **los montos multi-moneda cambian de verdad** (antes salían sin convertir). `grossMarginActualPct` pasa de `0` a `null` sin ingresos |

Los umbrales pasan de `> 90` a `>= budgetAlertPct`: un proyecto exactamente en el 90,00 % ahora
entra en `warning` donde antes no. Efecto marginal pero real.

---

## 4. Pruebas

`backend/src/utils/__tests__/projectFinancials.test.ts`, 36 casos nuevos. Cubre los bordes
obligatorios: presupuesto cero, sin horas aprobadas, sin forecast, margen negativo,
`marginThreshold` nulo, `marginThreshold` = 0, moneda sin tasa de conversión, forecast
sobre-ejecutado, fronteras UTC del rango del forecast (último día inclusive), horas de otro
consultor que no deben descontar, y un caso de consistencia que comprueba que con umbral 25 el
semáforo da `YELLOW` donde con el 15 viejo daba `GREEN`.

En `financial.test.ts` cambió una expectativa: `grossMarginActualPct` sin ingresos pasa de `0` a
`null` (ver §1.5).

```
npx tsc --noEmit      → exit code 0, sin salida
npm test              → Test Files 9 passed (9) · Tests 195 passed (195)   [antes 159]
npm run test:routes   → Test Files 12 passed (12) · Tests 78 passed (78)   [sin cambio]
```

---

## 5. Riesgos que quedan abiertos

1. **El frontend tiene su propio semáforo, con sus propios umbrales hardcodeados.**
   `frontend/src/utils/projectHealth.ts` (`calcularSaludProyecto`) usa `margen < 0` → ROJO y
   `margen < 10` → AMARILLO, y `PortfolioTab.tsx:357` colorea la celda de margen con un `< 15`
   literal. **Ninguno de los dos lee `marginThreshold`.** R10 unificó el backend; el front sigue
   pudiendo pintar un color distinto al `healthStatus` que le manda el API. Los nuevos campos
   `marginThreshold` y `projectedPct` de las tres respuestas están puestos precisamente para que
   el front pueda dejar de inventar umbrales.
2. **`GET /:id/detail` sigue escribiendo en una petición de lectura** (punto 11 de §10.2): si el
   `healthStatus` calculado difiere del guardado, hace `prisma.project.update` sin auditar. Con
   R10 ese `update` se va a **disparar más** la primera vez, porque muchos semáforos cambian de
   valor. No se tocó: es un punto aparte.
3. **`computeHealthStatus` sigue recibiendo `utilizationPct` sin usarlo** (punto 20). Los tres
   llamadores siguen pasando `0`.
4. **El default de 15 % es una decisión de negocio tomada por el equipo técnico.** Está en un solo
   sitio y con nombre, pero conviene que Dirección confirme que ese es el umbral corporativo, o
   bien poblar `marginThreshold` en todos los proyectos y retirar el default.
5. **Los proyectos cuyo `healthStatus` cambie de color lo harán sin aviso** la primera vez que
   alguien abra el detalle o corra el motor de alertas. Si hay informes ya entregados con los
   colores viejos, conviene comunicarlo antes de desplegar.
6. `/overview` sigue filtrando por `from`/`to` y los demás no. Es intencional, pero significa que
   **el tablero con un filtro de fechas activo puede mostrar un semáforo distinto al portafolio**,
   por un motivo legítimo. No hay forma de unificarlo sin quitarle el filtro al tablero.

---

## Añadido tras la revisión: los umbrales no se podían asignar

Al verificar el arreglo apareció que `marginThreshold` y `budgetAlertPct` **no estaban en el
esquema Zod de crear ni editar proyectos**. Es exactamente el mismo defecto que tenía
`projectManagerEmail` antes de R7: el backend leía un campo que nadie podía escribir.

Sin esto, la unificación habría sido **inerte**: la columna siempre nula, todo cayendo al
valor por defecto de 15, y ningún cambio visible para el usuario. Se detectó porque al crear
un proyecto con `marginThreshold: 25` por la API, el valor volvía como `null`.

Los dos campos se tratan distinto a propósito, porque el esquema de datos los declara
distinto: `marginThreshold` es `Decimal?`, así que una cadena vacía lo desasigna; mientras
que `budgetAlertPct` es `Decimal @default(90)` y no admite nulo, de modo que una cadena vacía
significa "no tocar".

Comprobado contra el servidor compilado, con un proyecto de umbral 25 y margen real del 20 %:

| Pantalla | Semáforo | Umbral aplicado |
|---|---|---|
| Tablero | YELLOW | 25 |
| Portafolio | YELLOW | 25 |
| Detalle | YELLOW | 25 |

Antes de este cambio, el tablero y el portafolio habrían dicho GREEN usando el 15 hardcodeado,
y solo el detalle habría dicho YELLOW.

**Queda pendiente el formulario del frontend**: los campos ya se pueden asignar por la API,
pero la pantalla de proyectos todavía no los expone. Hasta que se agreguen, solo se pueden
configurar por API. Es el siguiente paso natural, del mismo tamaño que el campo de PM que se
agregó en R7.
