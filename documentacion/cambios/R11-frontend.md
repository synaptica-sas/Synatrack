# R11 — El frontend deja de inventar umbrales, semáforos y totales

Rama: `fix/frontend-umbrales-y-ux` (sale de `fix/rentabilidad-unificada`). Sin commits: los
cambios quedan en el árbol de trabajo.

Cierra el **pendiente que dejó R10** (los umbrales no se podían configurar desde la aplicación)
y su **riesgo abierto n.º 1** (el frontend tenía su propio semáforo), más cuatro ítems del
backlog: **DEP-33**, **DEP-36**, **DEP-34** y **DEP-39**.

R10 unificó el cálculo en el servidor. Esto cierra el otro extremo: que la pantalla no
contradiga al número que recibe, ni rellene un hueco con una cifra propia.

---

## 1. Los umbrales se pueden configurar desde la pantalla de proyectos

`ProjectsTab.tsx` gana `marginThreshold` y `budgetAlertPct` en el alta y en la edición, como
porcentajes con `type="number"`, `min=0` y `max=100`, junto al campo de PM que se agregó en R7.

**La cadena vacía no significa lo mismo en los dos campos**, porque el esquema de datos los
declara distinto, y eso se le dice al usuario en vez de dejarlo implícito:

| Campo | Vacío significa | Por qué |
|---|---|---|
| `marginThreshold` | «sin umbral propio»: el backend lo guarda como `null` y aplica su valor por defecto (15 %) | `Decimal?` en Prisma, nulable |
| `budgetAlertPct` | «no modificar»: conserva el valor que ya tuviera la fila (90 % por defecto) | `Decimal @default(90)`, no admite nulo |

Se explica en tres sitios: el `title` de cada campo, un párrafo de ayuda bajo el grupo en el
alta, y otro párrafo — con el matiz de edición («vaciarlo lo desasigna» / «vaciarlo *no* lo
borra») — en el modal de edición.

Los valores se envían **tal cual, como cadena**, sin convertir a número en el cliente. Es
deliberado: el esquema Zod del backend (`umbralNulableSchema` / `umbralNoNulableSchema`)
distingue `""` de un número y de `undefined`, y convertir en el cliente destruiría esa
distinción. `api.ts` declara los dos como `string | number | null` por ese motivo.

El modal de edición precarga los valores desde `GET /api/projects` (que devuelve la fila
completa de Prisma, así que ya traía los dos campos como `string`).

## 2. El frontend deja de calcular salud — decisión y por qué

**Se elige consumir el `healthStatus` del backend, no recalcular con los umbrales reales.**

La investigación de quién usaba `calcularSaludProyecto` dio el argumento decisivo:
**no la usaba nadie**. Las tres pantallas que pintan el semáforo (tablero, portafolio y
proyectos) ya llamaban a `backendHealthToResult(healthStatus)`. Era código muerto con umbrales
fijos, conservado sin uso: la forma más barata de volver a divergir el día que alguien lo
enganche.

Los otros dos motivos, por si el primero no bastara:

1. **El cliente no tiene los insumos.** `computeHealthStatus` mira `alertLevel`, riesgos altos
   abiertos, hitos atrasados, CPI, SPI **y** el margen contra `marginThreshold`. El tablero no
   recibe hitos ni riesgos; recalcular con lo que hay daría otro color por falta de datos, no
   por criterio.
2. **Recalcular solo puede contradecir.** El color y el `healthStatus` vienen en la **misma
   respuesta**. Cualquier divergencia es un defecto por construcción.

Qué se hizo, entonces:

- **Se elimina `calcularSaludProyecto`** de `utils/projectHealth.ts`. El módulo queda como lo
  que realmente es: traducción de estado a etiqueta, color e icono.
- **`HEALTH_CRITERIA_TOOLTIP` era un texto que mentía.** Describía los umbrales fijos viejos
  (uso 70/90/100/120, margen < 10 %), que nunca fueron las reglas del backend. Se sustituye por
  `textoCriteriosSalud(marginThreshold)`, que enuncia las reglas reales de
  `computeHealthStatus` y **nombra el umbral del propio proyecto**, tomado de la respuesta.
  Si el campo no llega, dice «no informado por el API» en vez de suponer un 15.
- **`PortfolioTab.tsx:357` pintaba la celda de margen con un `< 15` literal.** Se sustituye por
  `colorMargen(grossMarginActualPct, marginThreshold)`, con los mismos cortes que el servidor
  (rojo bajo medio umbral, ámbar bajo el umbral) y el umbral real del proyecto en un `title`.
- `api.ts` declara `marginThreshold: number` en `StatsProjectRow`, `PortfolioProject` y
  `ProjectDetailFinancials`, más `projectedPct` y `projectedTotal` en el detalle.

**Lo que hay que decir y no se ha inventado: `budgetAlertPct` NO viene en ninguna de las tres
respuestas.** Se verificó en el código del backend: `/stats/overview`, `/stats/portfolio` y
`GET /:id/detail` devuelven `marginThreshold`, pero de `budgetAlertPct` solo el `alertLevel` ya
derivado. Como ningún componente necesita hoy ese número crudo, no se ha añadido nada al
backend ni se ha rellenado con un 90 por defecto: el frontend no pinta lo que no recibe.

## 3. DEP-33 — Los enlaces profundos funcionan

**Causa real, que resultó ser doble.** El diagnóstico del efecto de enrutamiento era correcto
pero incompleto: hay tres sitios que borraban el destino.

1. El efecto de enrutamiento redirige a `/` cualquier ruta de pestaña mientras `authUser` es
   `null`, y **no guardaba a dónde iba**.
2. El efecto que valida la pestaña contra los permisos corría con `allVisibleTabs` vacío
   (todavía no hay sesión, así que no hay permisos) y reseteaba `activeTab` a `dashboard`.
   **Esto es lo que hacía que `/profile` sí funcionara**: está en `NON_SIDEBAR_TABS` y ese
   efecto no lo toca. Encaja exactamente con el síntoma descrito.
3. `bootstrap()`, al terminar con éxito sobre una ruta pública, hacía
   `replaceState("/dashboard")` incondicional, pisando cualquier destino.

Arreglo: un `rutaPedidaRef` (un `ref`, para no disparar renders ni reejecutar los efectos que
lo leen) guarda la ruta pedida antes de redirigir, en los dos sitios que redirigen. Al haber
sesión se restaura, comprobando antes que la pestaña esté permitida. El efecto de permisos se
guarda con `if (!authUser || allVisibleTabs.length === 0) return`, y el efecto de enrutamiento
no resuelve el destino mientras los permisos no se conozcan (si lo hiciera, lo descartaría por
«no permitido»). `bootstrap` respeta la ruta anotada en lugar de forzar `/dashboard`.

## 4. DEP-36 — Un fallo de estadísticas se ve como un fallo

- **`useStats` expone `error: string | null`.** El cambio es **aditivo**: la forma
  `{ data, loading, reload }` que comparten todos los hooks no cambia, así que **ningún otro
  consumidor se tocó**. `useStats` solo lo usa `App.tsx`, que ahora pasa `statsError` y
  `statsLoading` a `DashboardTab`. Ningún otro hook se modificó.
- Ante un fallo, el hook **descarta el dato viejo**: es preferible «no hay dato» a un número
  correcto para otro momento presentado como actual.
- **Se eliminan `dashboardTotals` y `dashboardProjectSummary`** de `DashboardTab`. Eran el
  respaldo local que sumaba `p.budget`, `e.amount` y `f.projectedCost` **sin convertir de
  moneda**. Como desde R1 solo se activaban cuando fallaba la petición, su efecto neto era
  presentar una cifra sin sentido en lugar de un error.
- `DashboardKpi` gana `error` y `loading`: con error muestra «Sin dato / Error al cargar» en
  rojo con el detalle en el tooltip; cargando, un `…`. Nunca una cifra.
- Un banner rojo sobre la rejilla de indicadores da el mensaje completo del fallo.
- `changeBaseCurrency` ya no deja el dato de la moneda anterior en pantalla bajo la etiqueta de
  la nueva: descarta y marca error.

**Efecto secundario cubierto**: con el backend caído, la pantalla de inicio ya no se queda muda
al pulsar «Ingresar». `LandingPage` recibe `errorMessage` y pinta un `role="alert"`; el banner
de error solo existía en la pantalla de autenticación, a la que no se llega desde la portada.
Además, `request()` de `api.ts` envuelve el fallo de red en un mensaje en español («No se pudo
contactar con el servidor…») en lugar del «Failed to fetch» del navegador.

## 5. Los dos menores

- **DEP-34**: `fill-opacity`, `stop-color` y `stop-opacity` → camelCase en el SVG de Teams de
  `ActivitiesTab.tsx`. **No eran 7 ocurrencias sino 34** (el backlog contaba las 3 advertencias
  distintas de React, que se deduplican por nombre de atributo). Se comprobó que no quedaba
  ningún otro atributo con guion en el archivo.
- **DEP-39**: `findFxRate` replica ahora el algoritmo del backend: construye un mapa
  **bidireccional** con la misma clave `"FROM->TO"` que `buildRateMap` y busca el pivote sobre
  ese mapa. Con `USD→COP` y `USD→MXN` cargadas, `COP→MXN` ya se resuelve. De paso se descartan
  las tasas no finitas o no positivas, como hace el backend. La prueba que fijaba la limitación
  se sustituyó por tres que fijan el comportamiento nuevo.

---

## 6. Verificación

Todo lo de abajo es salida real.

```
$ npx tsc -b --noEmit
(sin salida, exit code 0)

$ npm run lint
> eslint .
(sin salida, exit code 0)

$ npm run build
✓ 438 modules transformed.
dist/assets/index-CHLy-6o3.js   559.23 kB │ gzip: 121.43 kB
✓ built in 616ms

$ npm test
Test Files  11 passed (11)
     Tests  135 passed (135)        [antes 133: +3 de fxRate, −1 la que fijaba la limitación]
```

### En navegador (Playwright, Chromium headless, backend y base reales)

Enlaces profundos:

```
A) tras login, URL = http://localhost:5173/dashboard
B) enlace profundo /projects (con sesión) = http://localhost:5173/projects
C) /projects en frío antes de ingresar = http://localhost:5173/
D) /projects en frío DESPUÉS de ingresar = http://localhost:5173/projects
   ¿se ve la pantalla de proyectos?  true
E) /portfolio -> /portfolio
E) /expenses -> /expenses
E) /fx -> /fx
E) /activities -> /activities
```

La prueba pedida es la C→D: pestaña nueva, sin sesión, entrando directo a `/projects`; el
destino sobrevive al arranque y la pantalla que se ve es la de proyectos, no el tablero.

Umbrales, ciclo completo por la interfaz:

```
1) proyecto creado desde el formulario: {"marginThreshold":"25","budgetAlertPct":"80"}
2) el modal precarga umbral de margen = 25 | aviso presupuesto = 80
3) tras vaciar ambos campos: {"marginThreshold":null,"budgetAlertPct":"80"}
```

La línea 3 es la que confirma la semántica asimétrica: vaciar el margen lo desasigna, vaciar el
aviso de presupuesto lo conserva. (El proyecto de prueba se borró al terminar.)

Estado de error del tablero, interceptando `/api/stats/**` con un 500:

```
1) tablero con backend vivo, KPI presupuesto = PRESUPUESTO TOTAL (USD) | US$ 257.089
2) banner de error visible: true
3) indicadores: 'PRESUPUESTO TOTAL (USD) | ! | Sin dato | Error al cargar'  (y los 5 restantes igual)
4) ¿queda algún importe inventado?: 0
```

Portada con el backend caído (todas las llamadas al API abortadas):

```
2) ¿se muestra el error al pulsar Ingresar? true
3) texto: No se pudo iniciar sesión: No se pudo contactar con el servidor. Verifica que el backend esté disponible.
```

DEP-34, consola del navegador en `/activities`:

```
G) advertencias de atributos SVG en consola: 0  []
```

---

## 7. Riesgos y deuda que quedan abiertos

1. **`prevTotals` sigue siendo un cálculo local sin conversión de moneda.** Los deltas «vs
   período anterior» de «Gasto real» y «Horas aprobadas» comparan un total del servidor (ya
   convertido) contra una suma local en monedas mezcladas. Es el mismo defecto que DEP-36, en
   otro sitio y con menos consecuencia (el de las horas no tiene moneda y es correcto). **No se
   tocó**: arreglarlo bien exige que `/stats/overview` devuelva los totales del período
   anterior, y eso es trabajo de backend.
2. **`budgetAlertPct` no viaja en las tres respuestas** (§2). Si alguna pantalla necesita
   mostrarlo, habrá que añadirlo en el backend; no se debe rellenar con el 90 por defecto en el
   cliente.
3. **El tablero ya no muestra la tabla de proyectos si falla `/stats/overview`.** Es
   intencional — era la misma suma sin convertir —, pero significa que un fallo de ese endpoint
   deja el tablero más vacío que antes. A cambio, nada de lo que muestra es falso.
4. **`colorMargen` aplica el corte del backend (medio umbral / umbral) sobre datos del
   portafolio**, que es una réplica de regla, no el `healthStatus`. Se aceptó porque colorea una
   celda numérica, no el semáforo, y porque el umbral que usa es el real del proyecto. Si
   `computeHealthStatus` cambia esos cortes, hay que cambiarlo aquí también; queda anotado en el
   comentario de la función.
5. **La restauración del enlace profundo depende de `allVisibleTabs`**, es decir, de los
   permisos. Si `GET /api/me` tarda o falla parcialmente, el destino se pierde y se cae a
   `/dashboard`. Es una degradación aceptable, pero no un fallo visible: el usuario no sabe que
   pidió otra cosa.
6. **`/projects/:id` (detalle) no tiene ruta propia**: `openProjectId` es estado, no URL, así
   que un proyecto concreto sigue sin poder compartirse por enlace. DEP-33 hablaba solo de las
   pestañas; esto es un paso más y no se hizo.
7. La **duplicación deliberada de `findFxRate`** (DEP-18) sigue en pie: ahora las dos
   implementaciones coinciden, pero nada impide que vuelvan a separarse. El comentario de
   cabecera lo advierte y la prueba lo fija del lado del frontend.
