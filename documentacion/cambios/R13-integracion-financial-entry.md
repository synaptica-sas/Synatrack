# R13 — Integración de `FinancialEntry` con el cálculo unificado de R10

Rama: `integracion/financial-entry`. Merge de `origin/dev` (lado de Juan Espinosa) sobre el
trabajo de R10 y siguientes (lado nuestro, `HEAD`). **6 archivos en conflicto**, todos resueltos
conservando las dos aportaciones.

## 0. Qué se estaba integrando

| Lado | Aporta |
|---|---|
| `origin/dev` ("theirs") | Fusión de `Expense` + `RevenueEntry` en **`FinancialEntry`** con discriminador `type` (requerimiento de cliente), su migración con copia de datos, `financial-entries.routes.ts`, el panel unificado `FinancialTab.tsx` y la navegación asociada |
| `HEAD` ("ours") | R10: `computeProjectFinancials` como única fuente de verdad, `marginThreshold`/`budgetAlertPct` reales por proyecto, forecast sin doble conteo, `project-detail` usando los forecasts que ya cargaba, y la auditoría de R9 |

**Criterio aplicado:** su lado gana en el **modelo de datos**; nuestro lado gana en la **capa de
cálculo**. Los tres defectos que su rama todavía arrastraba (el `15` literal en `stats.routes.ts`
y `alerts.service.ts`, el doble conteo del forecast en `/portfolio`, y los forecasts ignorados en
`project-detail`) **no han vuelto a entrar**.

## 1. Dónde se parte por `type`: en **un solo sitio**

`computeProjectFinancials` no cambió ni una línea: sigue recibiendo `expenses` y `revenueEntries`
como listas de `{ amount, currency }`. Lo único que hacía falta era partir `financialEntries` por
su discriminador **antes** de llamarla.

La partición vive en **`backend/src/utils/financial.ts`**, en una función nueva:

```ts
export function splitFinancialEntries(entries: FinancialEntryRow[]):
  { expenses: ExpenseInput[]; revenueEntries: RevenueEntryInput[] }
```

y `toFinancialsInput` la invoca internamente: su tipo de entrada pasó de exigir
`project.expenses` + `project.revenueEntries` a exigir `project.financialEntries`.

**Por qué ahí y no en cada ruta:**

1. `toFinancialsInput` ya era el adaptador Prisma → cálculo. La forma de las filas de Prisma es
   precisamente su responsabilidad; las rutas no tienen por qué saber que existe un discriminador.
2. Es puro y testeable, igual que el resto de `financial.ts`, y no obliga a ninguna ruta a
   importar de otra ruta.
3. Los cuatro consumidores del cálculo (`/stats/overview`, `/stats/portfolio`,
   `project-detail`, `alerts.service`) lo reciben gratis con solo cambiar el `include` de Prisma
   a `financialEntries`. El `filter((e) => e.type === "EXPENSE")` que el lado de `dev` había
   escrito **cuatro veces** desaparece.

El único llamador que no pasa por `toFinancialsInput` es `/api/projects/:id/profitability`
(usa `calculateProfitability`, con un contrato de entrada propio). Ahí se llama
`splitFinancialEntries` directamente — **la misma función**, no una copia del `filter`.

## 2. Resolución de los 6 conflictos

### 2.1 `backend/src/modules/stats/stats.routes.ts` (2 conflictos)

- **`/overview`** — gana **HEAD** en el bloque de cálculo (`fin.totalCostActual`, `fin.budget`,
  `fin.alertLevel`). El bloque de `dev` reimplementaba a mano gasto, ingreso, forecast y margen,
  con `projectedPct > 90` literal en vez de `budgetAlertPct` del proyecto.
- El filtrado de gastos por el rango `from`/`to` (comportamiento propio del tablero, documentado
  como intencional en R10 §1.1) **se mantiene, y vuelve a Prisma**. `dev` lo había replicado en JS
  porque gastos e ingresos ahora comparten relación; en su lugar el `include` pide:

  ```ts
  financialEntries: { where: { OR: [
    { type: "REVENUE" },
    { type: "EXPENSE", entryDate: { gte: query.from, lte: query.to } },
  ] } }
  ```

  Así se conserva la semántica exacta de antes de la fusión (ingresos sin filtrar, gastos
  filtrados) sin traer filas de más ni filtrar dos veces.
- **`/portfolio`** — gana **HEAD**. El bloque de `dev` era justamente el que tenía el doble conteo:
  `hoursProjected × consultant.hourlyRate` sin descontar lo aprobado, desde la moneda del
  consultor y con el `> 90` literal.

### 2.2 `backend/src/modules/alerts/alerts.service.ts` (2 conflictos)

- **`include`**: mezcla de los dos. De `dev`, `financialEntries: true`; de HEAD, `forecasts`
  (que R10 añadió y `dev` no tiene). Sin los forecasts, `computeProjectFinancials` daría una
  proyección de cero y la alerta volvería a mirar solo el gasto ejecutado.
- **Cálculo de la alerta de margen**: gana **HEAD**. El bloque de `dev` conservaba literalmente
  `const threshold = 15;` bajo el comentario `// Margin alert (threshold 15%)`. Ahora el umbral es
  `fin.marginThreshold`, resuelto por proyecto.

### 2.3 `backend/src/modules/projects/project-detail.routes.ts` (1 conflicto)

Gana **HEAD**. El bloque de `dev` recalculaba a mano el costo, el margen y un `alertLevel` basado
solo en el gasto real (`usedBudgetPct > 100 / > 90`), sin tocar los forecasts que la propia
consulta ya carga. Es el defecto nº 3 de R10. El `include` de su lado (`financialEntries: true`)
se conserva tal cual.

### 2.4 `backend/src/modules/projects/projects.routes.ts` (2 conflictos)

- **`/profitability`, entradas**: gana HEAD en `marginThreshold` y `budgetAlertPct` (su lado los
  omitía, así que el endpoint caía siempre al default) y gana `dev` en el origen de los datos
  (`financialEntries`). Los dos `filter` por `type` que traía `dev` se sustituyen por una sola
  llamada a `splitFinancialEntries`.
- **`fxConfigs`**: gana **HEAD**. El bloque de `dev` reconstruía los `FxConfig` a partir del
  `rateMap` partiendo la clave por `"_"` cuando `buildRateMap` usa `"->"`, de modo que **todas**
  las conversiones caían al fallback sin convertir (punto 4 de §10.1). Se pasan los `FxConfig`
  crudos.

### 2.5 `frontend/src/App.tsx` (1 conflicto)

**Sobreviven los dos.** El conflicto era puramente de adyacencia: dos declaraciones distintas
insertadas en el mismo punto del cuerpo de `App`.

- De HEAD: `rutaPedidaRef` (DEP-33, enlaces profundos — guarda la ruta pedida antes de que la
  autenticación redirija a `/`).
- De `dev`: el estado `financialPanel`, que decide si el panel unificado abre en Gastos o Ingresos
  según la ruta.

Ninguno de los dos toca al otro: se conservan ambos, en ese orden.

### 2.6 `frontend/src/features/dashboard/DashboardTab.tsx` (3 conflictos)

**Sobreviven los dos, combinados prop a prop.** Los tres conflictos son el mismo patrón, en las
tarjetas de *Gasto real*, *Ingresos reconocidos* y *Margen bruto*:

- De `dev`: `onClick={() => onDrillTo?.("financial", "expenses" | "revenue")}` — la navegación al
  panel unificado, con su sub-panel. (Las pestañas sueltas `expenses`/`revenue` ya no existen en
  `TabId`, así que el `onDrillTo` de HEAD no compilaría.)
- De HEAD: `error={totalsFailed ? statsErrorMessage : null}` y
  `loading={totalsPending || statsLoading}` — el estado de error/carga que el tablero no tenía
  (antes un 500 se veía como un cero).

El cálculo local del tablero que sumaba monedas distintas ya lo había quitado HEAD fuera de la
zona de conflicto y no se reintrodujo.

## 3. Archivos NO conflictivos que hubo que tocar

| Archivo | Por qué |
|---|---|
| `backend/src/utils/financial.ts` | Añadida `splitFinancialEntries` + `FinancialEntryRow`; `ProjectRowForFinancials` pasa de `expenses`/`revenueEntries` a `financialEntries`. **El núcleo de cálculo no cambió.** |
| `backend/src/modules/alerts/alerts.service.ts` (`include`) | `expenses: true` + `revenueEntries: true` → `financialEntries: true` (el conflicto solo cubría parte del bloque) |
| `backend/src/utils/audit.ts` | Ver §4 |
| `backend/src/utils/__tests__/projectFinancials.test.ts` | Ver §5 |

**Revisados y ya correctos (los había migrado el lado de `dev`)**: `snapshots.routes.ts`
(usa `prisma.financialEntry` con `type` en el `where`), `expenses.routes.ts`, `revenue.routes.ts`,
`routes/index.ts`. Tras el merge **no queda ni un `prisma.expense` ni un `prisma.revenueEntry`**
en `backend/src`.

## 4. La auditoría de R9 tras la fusión

`expenses.routes.ts` y `revenue.routes.ts` escriben ahora en `prisma.financialEntry`, pero siguen
auditando con `AUDIT_ENTITIES.expense` y `AUDIT_ENTITIES.revenueEntry`.

**Decisión: se conservan los dos valores separados y se añade `financialEntry` como paraguas.**

```ts
expense: "expense",
revenueEntry: "revenueEntry",
financialEntry: "financialEntry",   // nuevo
// y en ALIAS_HISTORICOS_ENTIDAD:
financialEntry: ["expense", "revenueEntry"],
```

Por qué no unificar a `financialEntry` a secas, que es lo que pediría la regla "el catálogo sigue
el nombre de propiedad del modelo Prisma": el filtro de `GET /api/audit` es un campo libre que
Finanzas usa para aislar movimientos, y un gasto y un ingreso son **dos operaciones de negocio
distintas** aunque compartan tabla. Colapsarlas habría perdido esa distinción sin que nadie la
pidiera. Con el alias jerárquico no se pierde nada en ninguna dirección:

```
entity=expense        → 1 registro  [expense/CREATE]
entity=revenueEntry   → 1 registro  [revenueEntry/CREATE]
entity=financialEntry → 2 registros [revenueEntry/CREATE, expense/CREATE]
```

(salida real de la verificación funcional). El histórico ya escrito en producción sigue siendo
consultable sin migrar datos, que es para lo que existe `ALIAS_HISTORICOS_ENTIDAD`.

## 5. Pruebas modificadas

**Una sola**: `backend/src/utils/__tests__/projectFinancials.test.ts`, bloque `toFinancialsInput`,
2 casos. El motivo es mecánico, no de comportamiento: construían el objeto de proyecto con
`expenses: [...]` y `revenueEntries: [...]`, campos que ya no existen en `ProjectRowForFinancials`.
Se sustituyen por `financialEntries: [{ type: "REVENUE", ... }, { type: "EXPENSE", ... }]` y
**se añaden dos aserciones nuevas** que comprueban que la partición por `type` reparte bien:

```ts
expect(input.revenueEntries).toEqual([{ amount: 1000, currency: "USD" }]);
expect(input.expenses).toEqual([{ amount: 50, currency: "USD" }]);
```

El total sigue en **195**: no se añadieron ni quitaron casos, solo se reescribió el insumo de dos
de ellos y se reforzaron sus aserciones. Ningún test cambió de expectativa numérica.

## 6. Verificación

### 6.1 Comandos

```
backend/  npx tsc --noEmit      → exit 0, sin salida
backend/  npm test              → Test Files 9 passed (9) · Tests 195 passed (195)     [195 antes]
backend/  npm run test:routes   → Test Files 12 passed (12) · Tests 78 passed (78)     [78 antes]
frontend/ npx tsc -b --noEmit   → exit 0, sin salida
frontend/ npm run lint          → sin hallazgos
frontend/ npm run build         → built in 2.45s
frontend/ npm test              → Test Files 11 passed (11) · Tests 135 passed (135)   [135 antes]
```

### 6.2 Prueba funcional: servidor compilado contra base creada desde cero

`node dist/server.js` en el puerto 4099 contra una base `r13_verif` recién creada con
`prisma migrate deploy` (la cadena completa de migraciones, incluida
`20260922053854_merge_expense_revenue`, aplica limpia desde cero).

Proyecto con `marginThreshold = 25` (≠ 15), presupuesto y precio de venta 100 000 USD. Un gasto de
20 000 por `POST /api/expenses` y un ingreso de 25 000 por `POST /api/revenue` — las dos rutas
escriben ya en `FinancialEntry`, y `GET /api/financial-entries` devuelve `EXPENSE 20000` +
`REVENUE 25000`.

Margen real = (25 000 − 20 000) / 25 000 = **20 %**: por encima del 15 viejo, por debajo del 25
configurado.

| Pantalla | Semáforo | Umbral | Margen |
|---|---|---|---|
| Tablero (`/stats/overview`) | **YELLOW** | **25** | 20 % |
| Portafolio (`/stats/portfolio`) | **YELLOW** | **25** | 20 % |
| Detalle (`/projects/:id/detail`) | **YELLOW** | **25** | 20 % |

Con el `15` hardcodeado que `dev` todavía tenía, tablero y portafolio habrían dicho GREEN.

**Sin doble conteo del forecast.** Sobre el mismo proyecto: forecast de 800 h a 100 USD
(abr–jun 2026) con 600 h ya aprobadas dentro del rango. Pendiente real = 200 h × 100 = 20 000.

| Pantalla | Gasto real | Costo proyectado | Proyectado % | alertLevel | Semáforo |
|---|---|---|---|---|---|
| Tablero | 80 000 | **20 000** | 100 | warning | RED |
| Portafolio | 80 000 | **20 000** | 100 | warning | RED |
| Detalle | 80 000 | **20 000** | 100 | warning | RED |

El portafolio de `dev` habría contado las 800 h completas: 80 000 + 80 000 = **160 %**.
El detalle de `dev` no habría contado nada de forecast.

**Motor de alertas** (reinicio del servidor, que es cuando corre):

```
MARGIN_BELOW_THRESHOLD | CRITICAL | Proyecto "R13 Verificacion" tiene margen bruto de -220.0% (umbral 25%)
```

Umbral 25, no 15.

**Filtro de fechas del tablero.** `GET /api/stats/overview?from=2026-06-01` sobre el mismo
proyecto: `expensesActual = 0` (el gasto es de marzo, queda fuera) y `revenueRecognized = 25000`
(los ingresos no se filtran). Exactamente la semántica de antes de la fusión.

La base `r13_verif` se eliminó al terminar.

## 7. Abierto / requiere criterio de negocio

1. **`/api/financial-entries` no aplica `consultant-scope`.** Es de solo lectura y protegida con
   `authorize([ADMIN, PM, FINANCE, VIEWER])`, así que ningún `CONSULTANT` la alcanza; pero un
   `VIEWER` ve los movimientos de **todos** los proyectos, sin el filtrado por proyecto asignado
   que sí aplican otros módulos. **No se ha tocado** porque el alcance por rol es trabajo de otra
   rama y cambiarlo aquí sería decidir una política de visibilidad. Queda señalado.
2. **`FinancialEntry.category` solo aplica a `EXPENSE`** y queda `null` en `REVENUE`; el esquema no
   lo impide. Si el negocio quiere categorizar ingresos, es un cambio de modelo, no de integración.
3. Siguen abiertos los riesgos 1 y 2 de R10 §5: el frontend mantiene su propio semáforo con
   umbrales literales (`projectHealth.ts`, `PortfolioTab.tsx:357` con un `< 15`) que **no leen**
   `marginThreshold`, y `GET /:id/detail` sigue escribiendo `healthStatus` dentro de una lectura.
   Ninguno de los dos entró en este merge.
