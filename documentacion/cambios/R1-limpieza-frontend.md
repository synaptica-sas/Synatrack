# R1 — Limpieza del frontend (`fix/limpieza-frontend`)

Rama R1 del plan de `documentacion/PLAN_DE_RAMAS.md`.
Alcance: **DEP-01, DEP-02, DEP-03, DEP-04, DEP-07 y DEP-16** del
`documentacion/BACKLOG_DEPURACION.md`. Fecha: 2026-09-18.

Nada de lo que sigue cambia el comportamiento visible de la aplicación, salvo el punto 1
(que agrega una pantalla de error donde antes quedaba el lienzo en blanco).

---

## 1. DEP-02 — Montar el `ErrorBoundary` (P0)

### `frontend/src/main.tsx`

Se importa `ErrorBoundary` y se envuelve el árbol completo que se pasa a `createRoot`:

```tsx
<StrictMode>
  <ErrorBoundary>
    <MsalProvider instance={msalInstance}>
      <App />
    </MsalProvider>
  </ErrorBoundary>
</StrictMode>
```

**Por qué por fuera de `MsalProvider` y no solo alrededor de `<App />`:** así también quedan
cubiertos los errores de render del propio proveedor de MSAL. El fallback no consume el contexto
de MSAL, así que no pierde nada por estar afuera.

### `frontend/src/components/ErrorBoundary.tsx`

La interfaz pública no cambia: sigue siendo `class ErrorBoundary` con `props = { children, fallback? }`,
`getDerivedStateFromError` y `componentDidCatch` (que sigue dejando el error en la consola).
Lo que cambió es la **UI de fallback por defecto**, que antes era pobre:

| Antes | Ahora |
|---|---|
| Título genérico "Algo salió mal" | "Se produjo un error inesperado" + dos párrafos que explican qué pasó y qué hacer |
| Un solo botón "Reintentar" (solo limpia el estado; si el error es determinista, vuelve a fallar) | Botón primario **"Recargar la página"** (`window.location.reload()`) + botón secundario "Reintentar" |
| Colores literales en estilos en línea (`#dc2626`, `#6b7280`) — ilegibles en modo oscuro | Clases CSS (`.error-boundary*`) sobre las variables existentes (`--bg`, `--card-bg`, `--state-danger-*`, `--text-soft`, `--gradient-accent`) |
| Sin rol de accesibilidad | `role="alert"` en el contenedor |

El mensaje de `error.message` se muestra en un bloque monoespaciado aparte, para que quien reporte
el problema pueda copiarlo.

### `frontend/src/index.css`

Se agregó al final el bloque `/* ── ErrorBoundary (fallback de error de render) ── */` con las
clases `.error-boundary`, `.error-boundary-card`, `.error-boundary-detail` y
`.error-boundary-actions`.

**Se puso en `index.css` y no en `App.css` a propósito:** `App.css` se importa desde `App.tsx`.
El fallback lo renderiza `main.tsx`, que importa `index.css`; poniéndolo ahí los estilos existen
aunque el problema esté en el árbol de `App`. Las variables semánticas (`--bg`, `--card-bg`,
`--state-danger-*`, …) están declaradas en el `:root` de `index.css` y se sobreescriben en
`body.dark` dentro de `App.css`, así que el fallback se ve bien en ambos temas.

---

## 2. DEP-01 / DEP-03 / DEP-04 — Borrado de código muerto

Antes de borrar se verificó cada archivo en todo `frontend/src`, buscando **el nombre del archivo,
la ruta de import y el símbolo exportado**:

| Archivo borrado | Símbolo exportado | Verificación |
|---|---|---|
| `frontend/src/components/Table.tsx` | `Table`, `type Column<T>` | 0 imports de `components/Table`. Los aciertos de "Table" en el código son `tableSearch`/`tablePage` de `DashboardTab`, `GastosSummaryTable` (otro componente, vivo) y `autoTable` de `jspdf-autotable`. |
| `frontend/src/components/KpiCard.tsx` | `KpiCard` | 0 imports. **Ojo:** `KpiCard` sí aparece en `PortfolioTab.tsx:28` y `ProjectDetailTab.tsx:71`, pero son **definiciones locales propias** de cada archivo (`function KpiCard(...)` con props distintas), no importaciones del componente compartido. |
| `frontend/src/components/StatusBadge.tsx` | `StatusBadge` | 0 imports. Igual que el anterior: `GastosSummaryTable.tsx:9` define su propio `StatusBadge` local. |
| `frontend/src/hooks/usePermissions.ts` | `usePermissions` | 0 apariciones de la cadena `usePermissions` en todo `frontend/src` fuera del propio archivo. |

`ErrorBoundary.tsx` **no se borró**: se montó (punto 1).

Nota para quien revise: la duplicación de `KpiCard`/`StatusBadge` en tres archivos distintos sigue
existiendo; lo que se eliminó es la cuarta copia, la que nadie usaba. Unificarlas es un ítem aparte
y fuera del alcance de esta rama.

---

## 3. DEP-16 — Que la prueba de orden pruebe el código real

El test `tableSort.test.ts` traía su propia copia de la lógica ("Mirrors the sort logic from
DashboardTab"), así que podía estar en verde con `DashboardTab` roto.

### `frontend/src/features/dashboard/dashboardUtils.ts`

Se agregó, sin tocar lo que ya había (`fmt`, `calcDelta`, `calcEVM`):

- `type ProjectAlertLevel = "ok" | "warning" | "exceeded"`
- `type ProjectSortField` — las 8 columnas ordenables
- `const ALERT_LEVEL_ORDER` — `{ exceeded: 0, warning: 1, ok: 2 }`
- `function sortProjectRows<T extends { alertLevel: ProjectAlertLevel }>(rows, sortField, sortDir): T[]`

Es una copia literal de la comparación que estaba dentro del componente: mismo manejo de nulos
(`?? 0`), mismo criterio para `alertLevel`, misma copia defensiva del arreglo (`[...rows]`).

### `frontend/src/features/dashboard/DashboardTab.tsx`

- El `import` de `./dashboardUtils` ahora trae también `sortProjectRows` y `ProjectSortField`.
- `type SortField` pasó de ser una unión literal duplicada a `type SortField = ProjectSortField`
  (se conserva el alias local para no tocar las ~10 referencias de `DashboardSortTh`).
- Se eliminaron el `useMemo` de `alertOrder` y el cuerpo del `useMemo` de `sortedProjects`, que
  ahora es una sola línea: `sortProjectRows(filteredProjects, sortField, sortDir)`.
- Se eliminó el alias `type DisplayProject = typeof displayProjects[number]`, que quedó sin uso
  (solo servía para el cast dentro del comparador).

### `frontend/src/test/tableSort.test.ts`

Se borró la copia local de `sortRows`/`alertOrder` y el test importa `sortProjectRows` y
`ProjectAlertLevel` desde `../features/dashboard/dashboardUtils`. **Los 5 casos y sus
aserciones son exactamente los mismos**, por eso el total sigue en 124 pruebas.

**Comprobación de que ahora sí prueba el código real (prueba de mutación manual):** se invirtió
temporalmente `ALERT_LEVEL_ORDER` a `{ exceeded: 2, warning: 1, ok: 0 }` y el test **falló**
(2 de 5 casos en rojo). Con la versión anterior del test ese cambio habría pasado desapercibido.
La mutación se revirtió inmediatamente.

```
 FAIL  src/test/tableSort.test.ts > table sort logic > sorts by alertLevel: ok first
Expected: "ok"
Received: "exceeded"
 Test Files  1 failed (1)
      Tests  2 failed | 3 passed (5)
```

---

## 4. DEP-07 — Clases CSS sin uso en `App.css`

Se verificó **una por una** la lista de 19 candidatas del backlog, buscando en todo
`frontend/src` (`.ts`/`.tsx`), en `index.html` y en `server.mjs`:

1. la cadena literal completa;
2. **prefijos y sufijos** para descartar construcción dinámica con template literals
   (`span-`, `page-`, `switch-`, `day-`, `chip`, `filters`, `converter`, `section-layout`,
   `stats-tab`, `feedback`, `result`, `inactive`);
3. inspección del marcado real donde la clase era plausible.

Las 19 dieron **0 usos** y se eliminaron. Detalle de lo que se revisó a mano:

| Clase | Qué se comprobó |
|---|---|
| `span-4`, `span-5` | Definidas 2 veces (bloques duplicados de `App.css`) + 3 media queries. No hay construcción dinámica del tipo `span-${n}`. Lo que sí existe y **se dejó** es `calculator-grid-span-2` y `task-editor-span-2` (`EstimationCalculatorTab.tsx`), que son otras clases. |
| `span-full` | Definida 2 veces. Sin usos. |
| `span-all` | Solo `.form-inline .span-all`. Sin usos. |
| `filters-bar` | Definida 2 veces + media query de 600px. La que **sí se usa** es `filters-grid` (`AuditTab`, `ForecastsTab`, `FxTab`) y `filters-panel` (`ActivitiesTab`); no se tocaron. |
| `converter-result` | Definida 2 veces + override oscuro. La que **sí se usa** es `converter-grid` (`App.tsx:169`); no se tocó. |
| `fx-drawer-duplicate-disabled` | Copia desactivada de `.fx-drawer` (nombre autodescriptivo). `.fx-drawer` sí se usa y **se conservó íntegra**, incluidas sus reglas responsive. |
| `switch-item` | Bloque claro (+ `input[type=checkbox]`) y override oscuro. Sin usos. |
| `feedback-panel` | Solo existía `body.dark .feedback-panel`, sin regla en modo claro. Lo que **sí se usa** es `app-footer__feedback-btn`; no se tocó. |
| `page-header`, `page-title`, `page-subtitle` | Solo existían como overrides `body.dark` (4 reglas), nunca definidas en modo claro. Ningún componente las emite. |
| `section-layout-header`, `section-layout-title` | Solo overrides `body.dark`. Se leyó `components/SectionLayout.tsx`: usa `section-layout`, `section-header`, `section-header-title`, `section-form-*` — **todas conservadas**. |
| `stats-tab-container` | Solo override `body.dark`. Sin usos. |
| `role-chip`, `role-chip-group`, `inactive` | 6 reglas claras + 2 oscuras. La cadena `chip` **no aparece ni una vez** en `frontend/src`. Se conservaron `role-badge` y `role-badge.role-admin/pm/consultant/finance/viewer`, que sí se construyen dinámicamente. `.inactive` solo existía como `.role-chip.inactive`. |
| `day-number` | Solo `body.dark .month-day-cell .day-number`. Se leyó el calendario de `ActivitiesTab.tsx:1265+`: el número del día se pinta con estilos en línea, sin clase. `month-day-cell`, `is-blocked`, `out-of-month`, `is-weekend` y `day-activity-item` **se conservaron**. |

Resultado: 3.735 bytes menos en `App.css`. Se verificó después que el balance de llaves del
archivo sigue en 0 y que `npm run build` genera el CSS sin errores.

---

## 5. Verificación

Los tres comandos se corrieron desde `frontend/`. Salida real:

```
$ npx tsc --noEmit
EXIT=0
```
(sin ninguna línea de salida)

```
$ npm run lint

> frontend@0.0.0 lint
> eslint .

EXIT=0
```

```
$ npm test

> frontend@0.0.0 test
> vitest run


 RUN  v4.1.4 C:/Users/JuanMahecha/Synatrack/Synatrack/frontend


 Test Files  10 passed (10)
      Tests  124 passed (124)
   Start at  17:14:22
   Duration  5.12s (transform 1.19s, setup 2.90s, import 2.80s, tests 1.77s, environment 31.86s)

EXIT=0
```

**124 pruebas, el mismo número de antes**, como debe ser: `tableSort.test.ts` conserva sus 5 casos,
solo cambió de dónde sale la función bajo prueba. No se agregaron ni se quitaron pruebas.

Verificación extra (no pedida, para cubrir los cambios de CSS, que ni `tsc` ni `eslint` miran):

```
$ npm run build
✓ 437 modules transformed.
dist/assets/index-CEZp8Tay.css                   53.83 kB │ gzip:  10.99 kB
...
✓ built in 406ms
EXIT=0
```

---

## 6. Qué NO se tocó, y por qué

- **`DEP-01` "adoptar `Table.tsx` en las tablas nuevas"**: se tomó la decisión de borrar
  (queda en el historial de git). Migrar las tablas a mano de cada `*Tab.tsx` es un trabajo de
  otra magnitud y cambiaría comportamiento visible.
- **El `can()` en línea de `App.tsx`** (`DEP-03`): se borró el hook `usePermissions` duplicado,
  pero **no** se refactorizó `App.tsx` para consumirlo. Eso toca `DEP-15` (las tres copias de la
  matriz de permisos), que es un ítem P0 con riesgo propio y no está en el alcance de esta rama.
- **La duplicación interna de `App.css`**: el archivo tiene dos bloques casi idénticos
  (`.kpi-delta`, `.form-grid`, `.filters-grid`, `.converter-grid`, `.fx-note`…) repetidos con
  valores ligeramente distintos (p. ej. `.form-grid { gap: 1.1rem }` y más abajo `gap: 0.7rem`,
  donde gana el segundo). **No se tocó**: desduplicar cambia estilos de verdad. Las clases
  eliminadas sí se quitaron de **ambos** bloques.
- **Los 72 exports sin referencias de `DEP-08`** (`listMilestones`, `updateRisk`, …): fuera de
  alcance, y el propio backlog dice que es una decisión de producto, no de código.
- **`bootstrapApp()` en `main.tsx`**: sigue siendo `void bootstrapApp()`. Ver riesgos.

---

## 7. Riesgos para quien revise el merge

1. **El `ErrorBoundary` no cubre los fallos de arranque.** `main.tsx` hace
   `void bootstrapApp()`; si `msalInstance.initialize()` o `handleRedirectPromise()` rechazan,
   `createRoot(...).render(...)` nunca se ejecuta y **la pantalla sigue quedando en blanco**.
   Un `ErrorBoundary` de React solo captura errores de render, no rechazos de promesas del
   bootstrap. Se dejó como está para no cambiar comportamiento fuera del alcance, pero conviene
   abrir un ítem: envolver `bootstrapApp()` en `try/catch` y pintar el mismo fallback.
   Tampoco captura errores dentro de manejadores de eventos ni de `async` (limitación de React).
2. **CSS: la verificación es por búsqueda de texto.** Es fuerte (se buscaron literales, prefijos,
   sufijos y se leyó el marcado de los casos dudosos), pero no es una ejecución del navegador.
   Si algún estilo se ve distinto tras el merge, el sospechoso número uno son las clases
   `span-4`/`span-5`/`span-full`/`span-all` (afectaban `grid-column` en 3 media queries) y
   `filters-bar`. Todo está en un solo commit y se revierte con un `git revert` del archivo.
   **Vale la pena una pasada visual** por: Tablero de Control, Tasas FX (y su cajón lateral),
   Estimaciones, Actividades (calendario mensual) y Usuarios (chips de rol), en **claro y oscuro**.
3. **El fallback del `ErrorBoundary` no tiene prueba automatizada.** No se agregó una para no
   alterar el conteo de 124. Se probó por lectura; si se quiere cubrir, es un test de render con
   un componente que lance.
4. **`DashboardTab` no tiene pruebas de componente.** `sortProjectRows` ahora sí está cubierta y el
   componente la usa, que era justo el punto de DEP-16; pero el resto de la tabla (filtro,
   paginación, `toggleSort`) sigue sin red. El cambio es una extracción literal, sin cambio de
   semántica, así que el riesgo es bajo.
5. **`sortProjectRows` es genérica sobre `T`** y hace `a[sortField as keyof T]`. Si mañana alguien
   agrega una columna ordenable a `ProjectSortField` que no exista en las filas, TypeScript no lo
   va a detener y esa columna ordenará todo como 0. Es exactamente el mismo comportamiento que
   tenía el código en línea; no es una regresión, pero sí una trampa heredada.
