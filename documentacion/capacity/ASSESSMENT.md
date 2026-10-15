# Módulo de Capacity — Evaluación del estado actual (Fase 1)

> Fecha: 2026-10-15 · Rama: `dev` (46 commits por delante de `main`) · Sin cambios de código.
> Especificación de referencia: [`Capacity_Synaptica_v2.xlsx`](Capacity_Synaptica_v2.xlsx), en esta
> misma carpeta. Se revisaron fórmulas, validaciones, formato condicional, comentarios y el gráfico.

---

## 0. Resumen ejecutivo

1. **Synatrack ya tiene un módulo de capacidad**, y no es pequeño: `backend/src/modules/capacity/`
   (rutas de 646 líneas, jornada y bloqueos), `backend/src/utils/capacity.ts` (cálculo puro con tests),
   un modelo `Assignment` y la pantalla `frontend/src/features/capacity/CapacityTab.tsx` (1455 líneas,
   cuatro sub-pestañas). **No hay que construir desde cero, sino reorientarlo** hacia la vista
   mensual del Excel.
2. **Lo que existe no replica las reglas del Excel.** Calcula **un periodo a la vez** (de/hasta), no
   la matriz consultor × 6 meses. No distingue Confirmado/Probable. Los umbrales están fijos en el
   código. **Suma dos veces** las asignaciones creadas desde la UI, porque cada `POST /api/assignments`
   crea también un `Forecast` y la capacidad suma ambos.
3. **La jornada de Colombia está en 8,5 h** (seed y migración `20261005190000_jornada_configurable`).
   Con eso, el caso de prueba CO (96 h de 168 → 57 %) **no se cumple**: daría 96/178,5 = 54 %.
   Es una decisión de negocio (ver preguntas).
4. **Los feriados de Colombia del código coinciden con el Excel. Los de Ecuador no**: el código mueve
   la Independencia de Cuenca 2026 al 2-nov (pierde el 3-nov), no traslada el 1-may-2027 (sábado) al
   viernes 30-abr y no tiene los días por decreto (20-nov-2026) ni los locales de Quito.
5. **Ninguna fecha del schema es `@db.Date`**: todo es `timestamp`, y hay mezcla de hora local y UTC en
   varios cálculos de capacidad. Es el riesgo técnico principal para "mes calendario exacto".
6. **Quién ve qué**: hoy ven capacidad ADMIN, PM y VIEWER (y FINANCE por API pero no por menú). El
   CONSULTANT recibe 403. No existe el concepto de "líder" de equipo.

---

## 1. La especificación: qué hace exactamente el Excel

### 1.1 Hojas y fórmulas

| Hoja | Contenido | Detalle relevante |
|---|---|---|
| **Parametros** | Mes inicial (B4, se toma el día 1), horas estándar/día (B5 = 8, solo referencia), incluir probables (B6 Sí/No, por defecto **No**), umbral subutilizado (B7 = 0,70), umbral sobreasignado (B8 = 1,00) | B10: alerta de cobertura de feriados (ver 1.3) |
| **Consultores** | Nombre, País (validación: **EC o CO**), Horas diarias (8 o 4), Rol/Perfil, Notas | Máximo 60 filas (6–65) |
| **Feriados** | Dos listas, Ecuador (A) y Colombia (D), con fecha y descripción | Rangos con nombre `FER_EC` y `FER_CO`. Cargados hasta dic-2027 |
| **Asignaciones** | Consultor, Proyecto, **Cliente**, Fecha inicio, Fecha fin, **Horas semanales**, Estado (Confirmado/Probable; **vacío = Confirmado**) | Calcula país, horas/día (`F/5`), horas por mes (J:O) y % de capacidad de esa asignación por mes (P:U). Máximo 300 filas |
| **Horas** | Por consultor: capacidad (C:H), horas asignadas (J:O, `SUMIFS` por nombre) y disponibles (Q:V = capacidad − asignadas, **pueden ser negativas**) | Fila 66 `TOTAL EQUIPO` |
| **Capacity** | Título con el periodo y "Incluye probables / Solo confirmados"; KPIs por mes (utilización del equipo, # sobreasignados, # subutilizados) más columna "Periodo"; matriz consultor × mes con columna "Promedio periodo"; **gráfico de columnas "Utilización del equipo por mes"** (serie Capacity!C6:H6) | Formato condicional rojo `#F8696B` / verde `#A9D08E` / ámbar `#FFD966` |
| **Instrucciones** | Uso, lógica y convenciones de color | Límites: 60 consultores y 300 asignaciones. "En Ecuador el Gobierno puede añadir o mover días" |

Horas de una asignación en un mes (Asignaciones!J6):

```
inicio   = MAX(fecha_inicio, primer día del mes)
fin      = MIN(fecha_fin, último día del mes)
feriados = SI(país = "CO"; FER_CO; FER_EC)
días     = SI(inicio > fin; 0; DIAS.LAB(inicio; fin; feriados))
factor   = SI(estado = "Probable"; SI(incluir_probables = "Sí"; 1; 0); 1)
horas    = SI(falta consultor, inicio o fin; 0; días × (horas_semanales / 5) × factor)
```

- Capacidad (Horas!C6): `DIAS.LAB(mes_ini; mes_fin; feriados_país) × horas_diarias_consultor`.
- % del consultor en el mes (Capacity!C10): `asignadas / capacidad`. La celda queda vacía si la
  capacidad es 0.
- Promedio del periodo (Capacity!I10): `Σ asignadas / Σ capacidad` de los 6 meses, **ponderado**.
- Utilización del equipo (Capacity!C6): `Σ asignadas equipo / Σ capacidad equipo`, ponderado.
- Color: rojo si `> B8`; verde si `≥ B7`; ámbar si `< B7`. **Exactamente 100 % es verde**; un
  consultor con 0 h asignadas cuenta como subutilizado (0 % < 70 %).

### 1.2 Casos de prueba, verificados a mano contra el calendario

| Caso | Cálculo | Resultado |
|---|---|---|
| EC, oct-2026 | 22 días L-V − 9-oct = 21 días × 8 h | capacidad **168 h** |
| EC, 32 h/sem (1-sep-26 → 26-feb-27) + 16 h/sem (1-oct → 18-dic-26) | 21 × 6,4 + 21 × 3,2 | 134,4 + 67,2 = **201,6 h → 120 %** |
| CO, 40 h/sem desde 15-oct-26 | 12 días hábiles (15-oct → 30-oct) × 8 | **96 h / 168 = 57,1 %** (CO: 12-oct feriado → 21 días × 8) |
| EC medio tiempo (4 h/día), oct-2026 | 21 × 4 | **84 h** |

Los datos de ejemplo del Excel coinciden con los casos que diste.

### 1.2.1 Resultado esperado completo del ejemplo (oct-2026 → mar-2027)

El Excel trae **4 asignaciones de ejemplo**. La cuarta es el caso "Probable": Consultor 3 (EC, 4 h/día),
"Gobierno de datos", 20 h/sem, 4-nov-2026 → 29-ene-2027. El archivo se guardó sin valores cacheados
(`fullCalcOnLoad`), así que esta tabla se recalculó replicando las fórmulas con los feriados de la hoja.
Sirve como **fixture de regresión de punta a punta**.

Solo confirmados (por defecto):

| Consultor | oct-26 | nov-26 | dic-26 | ene-27 | feb-27 | mar-27 | Periodo |
|---|---|---|---|---|---|---|---|
| C1 (EC, 8 h) | 201,6/168 = **120 %** | 172,8/144 = 120 % | 176/168 = 104,8 % | 128/160 = 80 % | 115,2/144 = 80 % | 0/176 = 0 % | 82,7 % |
| C2 (CO, 8 h) | 96/168 = **57,1 %** | 152/152 = 100 % | 168/168 = 100 % | 152/152 = 100 % | 160/160 = 100 % | 160/160 = 100 % | 92,5 % |
| C3 (EC, 4 h) | 0/**84** = 0 % | 0/72 = 0 % | 0/84 = 0 % | 0/80 = 0 % | 0/72 = 0 % | 0/88 = 0 % | 0 % |
| **Equipo** | 70,9 % | 88,3 % | 81,9 % | 71,4 % | 73,2 % | 37,7 % | |

Con probables, solo cambia C3: nov 72/72, dic 84/84 y ene 80/80 = **100 %** (periodo 49,2 %). El equipo
queda en 70,9 / 107,8 / 101,9 / 91,8 / 73,2 / 37,7 %.

Hay detalles que una implementación ingenua rompe. Noviembre en EC tiene **3 feriados** (2, 3 y 20-nov):
quedan 18 días, o sea 144 h. Diciembre en EC incluye el 7-dic de Quito. La asignación de C1 que termina
el 18-dic se prorratea dentro del mes.

### 1.3 Particularidades del Excel que conviene decidir conscientemente, no copiar

- **El cruce es por nombre** (`MATCH` sobre el nombre del consultor). Si el nombre no existe, el país
  queda "No existe" y **se usan los feriados de EC** (cualquier país distinto de "CO" cae en EC).
- **Las horas de la asignación usan `÷ 5` fijo**, sin importar las horas diarias del consultor. Un
  consultor de medio tiempo con una asignación de 20 h/sem queda al 100 %, lo cual es correcto.
- **La alerta de cobertura solo mira la fecha máxima**: `fin del periodo > MIN(MAX(FER_EC), MAX(FER_CO))`.
  No detecta huecos dentro del rango, ni años sin cargar si hay fechas posteriores.
- **Los feriados de EC incluyen días locales de Quito** (Fundación de Quito, 7-dic-2026 y 6-dic-2027)
  y un día por decreto (20-nov-2026, Decreto Ejecutivo 507). En el Excel aplican a **todos** los
  consultores EC, aunque estén en Guayaquil.
- Las instrucciones sugieren **cargar las vacaciones como feriados**, lo que las aplicaría a todo el
  país. En la app eso corresponde a `ConsultantBlock` (por consultor).
- No hay concepto de rol del consultor en el cálculo; "Rol / Perfil" es solo informativo.
- "Horas disponibles" negativas = sobreasignación en horas.

---

## 2. Estructura del repositorio

```
backend/  Fastify 5 + Zod 4 + Prisma 6 (ESM, imports .js), Node 24
  prisma/schema.prisma (934 líneas), 21 migraciones, seed.mjs
  src/app.ts, server.ts, config/env.ts, auth/{guard,roles}.ts
  src/routes/index.ts            → registro de módulos con prefijo /api/<dominio>
  src/modules/<dominio>/*.routes.ts (+ *.service.ts, *.job.ts)
  src/modules/jobs/              → scheduler (ver §8)
  src/utils/                     → cálculo puro (capacity, holidays, country, financial, evm, …)
  tests/routes/                  → integración con Postgres real (24 archivos)
frontend/ React 19 + Vite 8 + TS, sin router ni librería de estado
  src/App.tsx (2221 líneas: layout, routing manual, SIDEBAR_GROUPS)
  src/services/api.ts (2686 líneas: todos los tipos y llamadas; capacity en :1292-1540)
  src/hooks/use<Dominio>.ts, src/features/<dominio>/*Tab.tsx, src/components/
documentacion/  docs del proyecto (aquí la carpeta es documentacion/, no docs/)
scripts/        dev.ps1, db.ps1, generate-map.mjs
```

**Rutas de la API**: cada módulo exporta `xRoutes(app)` y se registra en `src/routes/index.ts` con su
prefijo. Lo relacionado con capacidad está repartido así:

| Prefijo | Archivo | Qué hace |
|---|---|---|
| `/api/capacity` | `modules/capacity/capacity.routes.ts` | overview, available, bench, releasing, overloaded, consultant/:id, project/:id, by-project |
| `/api/capacity/workday` | `modules/capacity/workday.routes.ts` | jornada por país y por consultor |
| `/api/consultants/:id/blocks` | `modules/capacity/blocks.routes.ts` | ausencias (vacaciones, licencias…) |
| `/api/assignments` | `modules/assignments/assignments.routes.ts` | CRUD de asignaciones (+ complete/cancel) |
| `/api/custom-holidays` | `modules/custom-holidays/custom-holidays.routes.ts` | feriados manuales |
| `/api/extra-hours/holidays` | `extra-hours.routes.ts:1169` | feriados oficiales + manuales combinados |

---

## 3. Modelo de datos

**Hechos generales**: ninguna columna usa `@db.Date` (todas las fechas son `timestamp(3)`, salvo
`Forecast.startDate/endDate`, que son `String "YYYY-MM-DD"`). **No hay enum de país**: es texto libre
validado en código por `utils/country.ts` (`SUPPORTED_COUNTRIES = Colombia, Peru, Chile, Mexico,
Ecuador, Argentina, España, Default`), con nombres completos, no códigos ISO. Las migraciones parecen
sincronizadas con el schema (revisado a mano; no se corrió `prisma migrate diff`).

### 3.1 Qué necesita capacity y qué hay

| Necesidad (Excel) | Hoy en el schema | Veredicto |
|---|---|---|
| Consultor | `Consultant` (fullName, email?, role, company?, country?, active, isInternal…) | **Sirve.** Sin relación con `User`: se cruzan por email |
| País del consultor | `Consultant.country String?` (texto, "Colombia"/"Ecuador") | **Sirve, con ajuste**: es opcional y no hay códigos EC/CO. Hay que exigirlo para capacity y mapear EC→Ecuador, CO→Colombia |
| Horas diarias (8 / 4) | `CapacityConfig.hoursPerDay` (por consultor **o** por país, fallback "Default") con precedencia consultor → país → general. También existe `Consultant.maxHoursPerDay`, que **no se usa** | **Sirve** el mecanismo de jornada. Ojo: **Colombia = 8,5 h** sembrado |
| Proyecto | `Project` (name, company, country, startDate/endDate timestamp, status ACTIVE/PAUSED/CLOSED, projectManagerEmail) | **Sirve** |
| Cliente | Solo `Project.company` (texto) | **Falta** un modelo `Client`. Para capacity basta con `company` (ver preguntas) |
| Asignación consultor-proyecto con inicio/fin | `Assignment` (projectId, consultantId, startDate/endDate **timestamp**, allocationMode PERCENTAGE\|HOURS, allocationPct, hoursPerPeriod, periodUnit week\|month, status, role, note) | **Sirve, hay que extenderla**: `HOURS` + `week` equivale a "horas semanales". Faltan Confirmado/Probable y fechas `DATE` |
| Estado Confirmado / Probable | `AssignmentStatus` = PLANNED, ACTIVE, PARTIAL (nunca se escribe), COMPLETED, CANCELLED. Es **ciclo de vida**, no certeza | **Falta.** Es otra dimensión: una asignación puede estar PLANNED y ser Probable. Nuevo campo, no reutilizar el enum |
| Feriados por país | (a) **calendario calculado en código** (`utils/holidays.ts`, 7 países + Pascua) + (b) tabla `CustomHoliday` (name, date timestamp, country texto, "All" = todos; único por date+country) | **Existe, pero con diferencias contra el Excel** (ver §5) y sin forma de **quitar** un feriado calculado |
| Ausencias por consultor | `ConsultantBlock` (VACATION, SICK_LEAVE, …) | **Existe y el Excel no lo tiene.** Hoy resta capacidad: decidir si el informe las aplica |
| Parámetros (mes inicial, umbrales, incluir probables) | No hay tabla. Patrón similar: `HealthThresholdConfig` (fila única `scope="GENERAL"`) | **Falta.** Copiar el patrón de fila única |
| Horas reales registradas | `TimeEntry` (workDate, hours, status) | No lo usa el Excel; útil después (planificado vs real) |
| Proyección de horas | `Forecast` (hoursProjected, fechas string) | **Conflicto**: se crea solo junto con cada asignación y capacity lo suma encima (§4.3) |

---

## 4. El módulo de capacity actual frente a las reglas del Excel

### 4.1 Cómo calcula hoy

`buildCapacityRows` (`capacity.routes.ts:54-234`), para el periodo `from`–`to` pedido:

1. Carga los consultores activos con jornada, bloqueos, asignaciones PLANNED/ACTIVE/PARTIAL que se
   cruzan con el periodo, **todos** sus forecasts (sin filtrar por fecha) y los `CustomHoliday` del periodo.
2. `computeAvailability` (`utils/capacity.ts:276`): capacidad = `(días hábiles − días bloqueados) ×
   hoursPerDay`; comprometido según el modo de asignación:
   - `PERCENTAGE`: `días de solape × hoursPerDay × pct/100`.
   - `HOURS` + `week`: `días de solape × horas/5` (con `workDaysPerWeek = 5`): **igual que el Excel**.
   - `HOURS` + `month`: aproximación `÷ (workDaysPerWeek × 4,33)`.
3. Suma los **forecasts prorrateados por días calendario** (no hábiles).
4. Recalcula `utilizationPct` (redondeado a 0,1) y el estado FREE (0) / PARTIAL (<100) / FULL (=100) /
   OVERLOADED (>100).

`summary.utilizationPct` del overview **sí es ponderado** (Σ comprometidas / Σ capacidad).

### 4.2 Regla por regla

| # | Regla del Excel | Estado actual | Brecha |
|---|---|---|---|
| 1 | Mes calendario real | El overview admite cualquier rango. `GET /capacity/consultant/:id` da línea de tiempo mensual (6 meses), pero arma los meses en **hora local** y nadie la usa en el frontend | Media: falta el endpoint matriz × meses en UTC |
| 2 | L-V menos feriados del país | `countWorkdays` lo hace en UTC, con feriados calculados + `CustomHoliday`. `/consultant/:id`, `/project/:id` y `/by-project` **no** pasan los `CustomHoliday` | Baja-media: unificar y corregir EC |
| 3 | horas = días × (h_sem/5) × factor | Equivalente en modo `HOURS/week`. **No hay factor de probables.** Los forecasts **se suman aparte** | Alta: doble conteo y falta el estado |
| 4 | capacidad = días hábiles × horas diarias | Igual, **menos los días bloqueados**, y con jornada por país (CO = 8,5) | Decisión de negocio |
| 5 | % = asignadas / capacidad | Igual (redondeado a 0,1) | Ninguna |
| 6 | Promedios ponderados | El overview sí. No existe "promedio del periodo" por consultor sobre 6 meses | Baja |
| 7 | Umbrales configurables 70 % / 100 % | Fijos en código (FREE/PARTIAL/FULL/OVERLOADED); la barra de la UI usa 80/100 | Media: nuevo parámetro y nueva clasificación |
| 8 | Ventana de 6 meses movible | No hay vista matriz; solo el selector de/hasta del overview | Media (frontend) |
| 9 | Alerta si faltan feriados | No existe. Con el calendario calculado nunca "faltan", pero eso oculta los feriados por decreto | Media: hay que redefinirla (ver preguntas) |

### 4.3 Problemas del módulo actual que afectan el nuevo informe

- **Doble conteo asignación + forecast** (verificado en código): `POST /api/assignments`
  (`assignments.routes.ts:147-150`) crea un `Forecast` con las mismas horas, y `buildCapacityRows`
  (`capacity.routes.ts:154-178`) suma las horas de la asignación **y** las del forecast. Además, al
  borrar la asignación el forecast queda huérfano y al editarla no se sincroniza (PENDIENTES R-013).
- **Validación de sobrecarga débil** (`assignments.routes.ts:95-111`): suma `allocationPct` de todas las
  asignaciones que se solapan (no el pico diario), ignora las de modo `HOURS` y tolera hasta 110 %.
  Con asignaciones por horas semanales **no valida nada**.
- `PUT` no recalcula el estado y `complete` puede dejar `endDate < startDate` (codereview BE-09).
- `AssignmentStatus.PARTIAL` nunca se escribe (DEP-05). `CONSULTANT_OVERLOADED` nunca se genera como
  alerta (DEP-06).
- `countWorkdays` trata `workDaysPerWeek` de 1 a 4 como 5 (NEG-08); los bloqueos solapados se restan dos veces.
- `/consultant/:id` cuenta también asignaciones COMPLETED, a diferencia del overview.

### 4.4 Frontend actual

`CapacityTab.tsx` tiene cuatro sub-pestañas: **Vista general** (6 tarjetas KPI, tabla por consultor
con barra CSS de utilización, filtros, CSV), **Por proyecto**, **Asignaciones** (CRUD en modal, modo %
u horas por semana o mes) y **Bloqueos**. **No hay mapa de calor, ni matriz consultor × mes, ni gráfico.**
Hay cuatro `eslint-disable exhaustive-deps`. Los catálogos de jornada están en
`features/workday/WorkdayConfigTab.tsx`. No hay pantalla para administrar `CustomHoliday` dentro de capacity.

---

## 5. Feriados: el código frente al Excel (oct-2026 → dic-2027)

Calculado ejecutando `getHolidaysForYear` del código actual.

**Colombia: coincide al 100 %** (5 fechas en 2026 y 18 en 2027, incluidos los traslados por la ley Emiliani
y los de Pascua).

**Ecuador: 5 diferencias**

| Fecha | Excel | Código | Efecto |
|---|---|---|---|
| 3-nov-2026 (mar) | Independencia de Cuenca | La mueve al **2-nov** (cae junto a Difuntos) | El código cuenta el 3-nov como hábil: +1 día en nov-2026 |
| 20-nov-2026 (vie) | Suspensión de jornada, Decreto 507 | — | Decreto: debe cargarse a mano |
| 7-dic-2026 (lun) | Fundación de Quito (local) | — | Local de Quito |
| 30-abr-2027 (vie) | Día del Trabajo trasladado del sáb 1-may | Lo deja en el **sábado 1-may** | El código cuenta el 30-abr como hábil |
| 6-dic-2027 (lun) | Fundación de Quito (local) | — | Local de Quito |

Las dos primeras son **errores de la regla de traslado** en `holidays.ts:255-267` (el 1-may está marcado
como "no se mueve" y Cuenca se pasa por `moveEcuadorHoliday` sin considerar el 2-nov). Los tests de
feriados no cubren Colombia ni estos casos de Ecuador (NEG-07).

**Consecuencia para el diseño**: un calendario 100 % calculado no resuelve decretos ni feriados locales,
y uno 100 % manual (como el Excel) exige carga anual. Ver la decisión en preguntas.

---

## 6. Autenticación, roles y quién debería ver capacity

- **Entra ID**: solo se lee la claim `roles` (**app roles, no grupos**); se pasa a mayúsculas y
  `NOMINA` → `FINANCE`. Si el token trae roles, reemplazan a los locales. JIT provisioning: crea el
  `User` (país desde la claim `ctry`, por defecto CO) y, si tiene rol CONSULTANT, su `Consultant` con
  `hourlyRate = 0` (`auth/guard.ts:228-382`).
- **Roles**: ADMIN, PM, CONSULTANT, FINANCE, VIEWER. Dos sistemas paralelos: `authorize([...])` por
  ruta (lo que realmente protege) y la matriz `rolePermissions` de `auth/roles.ts` (lo que muestra el
  menú). El simulador de rol ya no es una tercera copia: lee `GET /api/auth/permissions`.
- **Capacity hoy**:

| Rol | Menú (`capacity:read`) | API `/api/capacity/*` | Asignaciones (escritura) |
|---|---|---|---|
| ADMIN | ✔ | ✔ | ✔ |
| PM | ✔ | ✔ (ve a **todos** los consultores) | ✔ |
| VIEWER | ✔ | ✔ | — |
| FINANCE | ✘ | ✔ (**desalineado**) | — |
| CONSULTANT | ✘ | 403 | — |

- **Patrones de alcance reutilizables**: `findMyConsultant` y `resolveTargetConsultantId`
  (`utils/currentConsultant.ts`) para "lo mío"; el `where` de alcance de `extra-hours`
  (`extra-hours.routes.ts:324-361`, PM = sus propios datos + proyectos donde es `projectManagerEmail`,
  combinado con `AND` para que un filtro nunca amplíe el alcance); `consultant-scope.ts`
  (`puedeVerTarifas`) para ocultar tarifas. Capacity ya oculta `estimatedCost` según el rol.
- **No existe "líder"**: no hay relación consultor → jefe ni equipos. El único alcance por proyecto es
  `Project.projectManagerEmail` (decisión D-13: ser PM depende de ese campo, no del rol).

Propuesta inicial para discutir: gerencia (ADMIN, VIEWER) ve todo; PM ve todo en solo lectura o solo
a los consultores de sus proyectos; el consultor ve únicamente su propia fila y el desglose de sus
proyectos. Ver preguntas.

---

## 7. Convenciones del código

| Tema | Convención |
|---|---|
| Validación | Zod `.parse()` antes de Prisma; `ZodError` → 400 `{ message, issues }` |
| Respuestas | `{ data }`; listas paginadas `{ data, meta: { total, page, pageSize, totalPages } }` (máx. 100); `204` en deletes |
| Errores | Handler global en `app.ts:81-115`; **ya no filtra `stack` en producción** (test `error-handler-fuga`). Prisma P2002/P2025 sin mapear |
| Auditoría | `writeAudit(prisma, { entity: AUDIT_ENTITIES.x, … })`; las entidades nuevas se agregan al catálogo tipado. Asignaciones, jornada y bloqueos auditan; **`CustomHoliday` no** |
| Seguridad | Helmet (sin CSP), `@fastify/rate-limit` 300/min por IP |
| Candado mensual | `MonthlySnapshot` + `isMonthClosed`. Aplica a horas reales, **no** a asignaciones planificadas |
| UI | Sin librería de componentes: `src/components/` propios (Toast, ConfirmDialog, SearchableSelect, DateRangePicker, **MonthYearPicker**, EmptyState, PageHeader…). CSS con variables y tema oscuro (`.dark`) |
| Gráficos | **Sin librería**: SVG a mano (`HoursBarChart.tsx`, Dashboard, ProjectDetail). Capacity usa barras CSS |
| Fechas | Sin librería de fechas. Backend en UTC (`Date.UTC`) salvo excepciones (§9). Frontend: `utils/formatDate.ts` con `timeZone: "UTC"` para fechas de calendario. Ya hubo bugs de "un día antes" (R-014, R-026) |
| Exportación | `xlsx` y `jspdf` + `jspdf-autotable` solo en el frontend, cargados dinámicamente (`DashboardTab.tsx:703-760`); `utils/csv.ts` para CSV |
| Hooks | `{ data, loading, reload }`; la mayoría se tragan los errores. `useTimeEntries` ya expone `error` y es el modelo a copiar |

---

## 8. Tests, CI/CD y variables de entorno

- **Backend unitario**: `npm test` (vitest, solo `src/**/*.test.ts`, unos 340 casos en 13 archivos de
  `utils/__tests__/` + jobs). `capacity.test.ts` (~460 líneas) y `holidays.test.ts` (8 casos) existen.
- **Backend integración**: `npm run test:routes` contra Postgres real `synatrack_test` en
  `localhost:5433`, con helpers `comoRol(role, email)`; 24 archivos (~280 casos), sin uno de capacity.
- **Frontend**: `npm test` (vitest + jsdom + Testing Library), 24 archivos (~247 casos), ninguno de capacity.
- **CI**: un solo workflow (Azure Static Web Apps) que en push/PR a `main` corre type-check, tests y
  build **solo del frontend**. **El backend no se prueba en CI.**
- **Scheduler**: existe (CLAUDE.md está desactualizado). `modules/jobs/jobs.service.ts` con lista
  `TRABAJOS`, candado anti-solapamiento e historial en `JobRun`; se dispara con `setInterval`
  (`JOBS_INTERVAL_MINUTES`) o por cron de Render (`POST /api/jobs/run`, cada hora).
- **Variables backend** (`config/env.ts`): NODE_ENV, PORT, CORS_ORIGIN, RATE_LIMIT_MAX, DATABASE_URL,
  DIRECT_URL, AUTH_ENABLED, AUTH_DEMO_BYPASS, AZURE_AD_TENANT_ID, AZURE_AD_AUDIENCE, ADMIN_EMAIL,
  SUPPORT_EMAIL, PAYROLL_EMAIL, FX_SYNC_TOKEN, JOBS_RUN_TOKEN, JOBS_INTERVAL_MINUTES, AUTH_DEV_*.
  **Frontend**: VITE_API_URL, VITE_AZURE_*, VITE_FORCE_LOCAL_AUTH (o `window.__APP_CONFIG__` en runtime).
  Capacity no necesita variables nuevas.

---

## 9. Hosting

| Servicio | Plan | Relevancia para capacity |
|---|---|---|
| Render (backend) | **Free**: se duerme a los 15 min, arranque en frío de decenas de segundos | El cálculo en memoria es barato (ver abajo). El arranque en frío pesa más que el cómputo |
| Render cron | Starter (FX diario y jobs cada hora) | No se necesita un cron nuevo |
| Supabase | **Free** (500 MB, pausa por inactividad) | Datos nuevos ínfimos: ~60 consultores × ~300 asignaciones × ~30 feriados/año = kilobytes |
| Vercel | Hobby | Una pestaña más; el bundle de `xlsx`/`jspdf` ya está en chunks aparte |

Orden de magnitud del cálculo: 60 consultores × 6 meses × ~5 asignaciones × ~22 días ≈ 40 000
iteraciones simples, del orden de milisegundos en Node. **No cambia el uso de los planes.**

Riesgos de despliegue que sí afectan: **las migraciones no se aplican en el deploy** (el `start` de
Render no corre `prisma migrate deploy`), **producción sigue en la versión del 2 de septiembre** y
Supabase **no tiene RLS** en sus tablas, con permisos completos para `anon` y `authenticated`.

---

## 10. Deuda técnica y riesgos para este módulo

| Riesgo | Impacto | Dónde |
|---|---|---|
| Fechas `timestamp` + mezcla local/UTC | Un día corrido cambia horas y %. Afecta la regla de mes calendario | `capacity.routes.ts:45-52` y `:426-435` (meses en hora local), `utils/capacity.ts:270` (`addDays` local), `assignments.job.ts:9-10` |
| Doble conteo asignación + forecast | % inflados; el caso de 120 % daría más | §4.3 |
| Jornada CO 8,5 h | Casos de prueba CO no cuadran | seed + migración `jornada_configurable` |
| Feriados EC con errores y sin decretos | Capacidad de EC sobrestimada 1–3 días/año | `holidays.ts:255-267` |
| Permisos desalineados (FINANCE) y PM ve a todos | Fuga de datos de asignación; posible exposición de tarifas si se agrega costo | `roles.ts` vs `capacity.routes.ts` |
| Hooks sin estado de error | Un 500 se ve como "equipo sin asignaciones", lo cual es engañoso en un informe de gerencia | `hooks/*` |
| Sin paginación y carga de todos los forecasts | Bien a esta escala; empeora con historial de años | `capacity.routes.ts:108-110` |
| `onDelete: Cascade` Project → Assignment | Borrar un proyecto borra el historial de capacity | `schema.prisma` (BD-01) |
| CustomHoliday sin auditoría y con país texto libre | Un "ecuador" mal escrito no aplica; no queda rastro de quién cambió feriados | `custom-holidays.routes.ts` |
| CapacityTab de 1455 líneas y App.tsx de 2221 | Cambios costosos; conviene meter la vista nueva como sub-pestaña o componente aparte | frontend |
| Backend sin CI | Los tests del cálculo no protegen nada si nadie los corre | `.github/workflows/` |

---

## 11. Documentación desactualizada detectada (de paso)

- CLAUDE.md §4 y §7.3 dicen "no hay scheduler": **ya existe** (`modules/jobs`).
- CLAUDE.md §7.2 (stack en producción): **resuelto**.
- CLAUDE.md §5 (tercera copia de permisos en `App.tsx`): **resuelto** (DEP-15).
- CLAUDE.md §6 (`output_location: "build"`): **resuelto** (DEP-19); el CI ya corre los tests del frontend.
- CLAUDE.md §7.1, `DESPLIEGUE.md:114` y `DOCUMENTACION_TECNICA.md:428-432` citan la migración
  `20260918120000_fix_schema_drift`, que **no existe**; las reales son `20260915164644_sync_schema_drift`
  y `20260918130000_fix_extra_hours_monthly_divisor`.
- Conteos de tests de CLAUDE.md §3 (195 / 156) desactualizados.

---

## 12. Preguntas abiertas

> **Respondidas** en [cuestionario_15_10_26.md](cuestionario_15_10_26.md). Las decisiones resultantes y las preguntas que quedan están en [PLAN.md](PLAN.md) §1 y §11.

Cada pregunta trae la opción recomendada **(R)**. Las de bloque A cambian el modelo de datos o hacen
que los casos de prueba pasen o fallen; hay que cerrarlas antes del plan.

### A. Bloqueantes

**A1. Horas diarias de capacidad (Colombia 8,5 h).** El Excel usa las horas diarias **del consultor**
(8 o 4) en ambos países. La app siembra la jornada por país, con CO = 8,5 h, y con eso el caso CO da
54 % en vez de 57 %. (Contexto: la Ley 2101 de 2021 baja la jornada máxima en Colombia a 42 h/sem
desde jul-2026, o sea 8,4 h/día. A verificar.)
- (a) **(R)** Capacity usa las horas diarias que se capturan por consultor, como el Excel, con valor
  sugerido 8 (Parametros!B5). La jornada por país solo se usa como valor inicial al crear el consultor.
- (b) Se mantiene la jornada por país (8,5 h CO) y se ajustan los casos de prueba.

**A2. Fuente de los feriados.** El Excel es una lista manual por país, con decretos y feriados
locales, y la regla 9 ("alerta si faltan feriados") solo tiene sentido con una lista cargada. La app
los calcula en código y ese cálculo tiene errores en Ecuador.
- (a) **(R)** Una tabla `Holiday(país, fecha DATE, descripción)` como **única fuente** para capacity:
  se precarga con el generador del código y con la hoja Feriados, y se edita en pantalla. La alerta
  salta si un país de algún consultor no tiene feriados en algún año del periodo.
- (b) Mantener el cálculo en código, corregir Ecuador y cargar decretos y locales en `CustomHoliday`.
  Con esta opción la alerta de cobertura queda sin sentido.

¿El módulo de horas extra (recargos por festivo) debe usar la misma tabla? **(R)** Sí, pero en una
fase posterior, para no mezclar riesgos.

**A3. Feriados locales (Fundación de Quito).** El Excel los aplica a todo Ecuador.
- (a) **(R)** Replicar el Excel en el MVP: el feriado es por país.
- (b) Agregar ciudad o sede al consultor y feriados por ciudad.

¿Hay consultores de EC fuera de Quito?

**A4. Ausencias (vacaciones, licencias).** El Excel no las tiene (sugiere cargarlas como feriados, lo
que afecta a todo el país). La app ya tiene `ConsultantBlock` y hoy **resta** capacidad.
- (a) **(R)** Restar las ausencias de la capacidad del consultor, que es más fiel a la realidad. Los
  casos de prueba no tienen ausencias, así que siguen pasando.
- (b) Ignorarlas, para replicar el Excel tal cual.

**A5. Proyectos "Probable" que aún no existen en Synatrack.** En el Excel, Proyecto y Cliente son
texto libre: una asignación Probable puede ser una oportunidad que todavía no es proyecto. En la app,
`Assignment` exige un `Project` existente, y `ProjectStatus` no tiene un estado de oportunidad.
- (a) **(R)** Crear el proyecto en Synatrack con un nuevo estado `PROSPECT` (pipeline) y marcar la
  asignación como Probable.
- (b) Permitir asignaciones Probables sin proyecto, solo con nombre y cliente en texto.
- (c) Probable solo para proyectos que ya existen.

**A6. Forecasts y doble conteo.** Hoy cada asignación crea un `Forecast` y capacity suma los dos.
- (a) **(R)** Capacity cuenta **solo asignaciones**. El forecast queda para el módulo financiero; dejar
  de crearlo automáticamente o sincronizarlo, según cómo lo use Finanzas.
- (b) Capacity cuenta solo forecasts.

¿Finanzas usa hoy esos forecasts autogenerados?

**A7. Asignaciones existentes en % o en horas por mes.** El Excel solo maneja horas semanales.
- (a) **(R)** Conservar los modos, pero mostrar y capturar en horas/semana por defecto. El % se
  convierte como `% × horas diarias × 5`.
- (b) Migrar todo a horas semanales y quitar los otros modos.

¿Hay asignaciones reales en producción que haya que conservar?

### B. Importantes (definen pantallas y permisos)

**B1. ¿Quién ve capacity?**
- (R) ADMIN y VIEWER (gerencia) ven todo.
- (R) PM ve todo en solo lectura, o solo a los consultores de sus proyectos (¿cuál?).
- (R) CONSULTANT ve solo su fila y su desglose.
- FINANCE: ¿sí o no? Hoy está desalineado.

Pregunta adicional: ¿las horas y el % de un colega son información sensible entre consultores?

**B2. Quién edita:** asignaciones (hoy ADMIN y PM); feriados (hoy ADMIN y PM, sin auditoría);
parámetros y umbrales. **(R)** Parámetros y feriados solo ADMIN; asignaciones ADMIN y PM, este último
solo en sus proyectos.

**B3. Parámetros globales o por usuario.** En el Excel, el mes inicial y "incluir probables" son
globales. **(R)** Los umbrales son globales y persistidos (solo ADMIN). El mes inicial (por defecto el
mes actual) y el interruptor de probables son controles de la vista, no se persisten. ¿Hace falta un
"informe oficial" congelado para gerencia?

**B4. Qué consultores aparecen.** ¿Todos los `active`? ¿Los externos (`isInternal = false`, otra
`company`)? ¿Consultores sin país? **(R)** Activos, internos y externos, con filtro. Los que no tienen
país aparecen con un aviso y sin cálculo.

**B5. Fechas de ingreso y salida del consultor.** El Excel no las tiene: quien entra a mitad de mes
cuenta el mes completo, y lo ve como subutilizado. **(R)** No incluirlas en el MVP.

**B6. Validación de sobreasignación al guardar.** Hoy bloquea a partir de 110 %, solo para asignaciones
en %. **(R)** Avisar sin bloquear (el Excel permite 120 %), y las Probables no cuentan en el aviso.

**B7. Lugar en la UI.** **(R)** Nueva sub-pestaña "Mensual" en Capacidad, como vista por defecto,
conservando las demás. ¿O reemplazar la "Vista general" actual?

### C. Pueden esperar

- **C1. Importación.** El Excel del repo trae solo los datos de ejemplo. ¿Tienes la versión con datos
  reales? El Excel cruza por **nombre** y no trae email: ¿se emparejan los consultores por nombre
  exacto con `Consultant.fullName`? ¿Qué se hace con los que no existen (crearlos o reportarlos)? ¿Y
  con los proyectos y clientes que no existen? **(R)** Un modo de simulación que reporte, y una
  creación explícita.
- **C2. Exportación.** ¿Excel, PDF o ambos? ¿Formato libre o una réplica de la hoja Capacity con colores?
- **C3. Códigos de país.** El Excel usa EC/CO y la app usa "Ecuador"/"Colombia". **(R)** Guardar el
  código ISO (EC, CO) y mostrar el nombre.
- **C4. Despliegue.** Producción corre la versión del 2 de septiembre y las migraciones no se aplican
  solas. ¿El objetivo es solo `dev`, o hay que planificar la salida a producción con este módulo?

---

## 13. Impacto en la base de datos

> Resume los cambios propuestos en [PLAN.md](PLAN.md) §3, pensados para quien revise la migración.
> Sin datos productivos (decisión D7), ningún cambio requiere migrar información real.

### 13.1 Resumen

| | MVP (fase 1) | Fase 2 | Fase 3 | Total |
|---|---|---|---|---|
| Tablas nuevas | 3 | 1 | — | **4** |
| Tablas eliminadas | — | — | 1 (`CustomHoliday`) | **1** |
| Columnas nuevas | 4 (+2 si se aprueba P6) | — | — | **4–6** |
| Columnas que cambian de tipo | 2 | — | — | **2** |
| Columnas eliminadas | — | — | 0 (2 candidatas, opcionales) | **0** |
| Enums nuevos | 2 | — | — | **2** |
| Valores nuevos en enums existentes | 2 | 1 | — | **3** |
| Restricciones e índices modificados | 4 | — | — | **4** |

### 13.2 Tablas nuevas

| Tabla | Fase | Para qué | Columnas | Volumen esperado |
|---|---|---|---|---|
| `Holiday` | 1 | Fuente única de feriados (reemplaza a `CustomHoliday` y al cálculo en código) | `id`, `country`, `city` (`""` = nacional), `date DATE`, `name`, `source` (GENERATED/MANUAL/DECREE), `createdBy`, `createdAt`, `updatedAt`. Único `(country, city, date)`; índice `(country, date)` | ~20–30 filas por país y año |
| `HolidayCalendarYear` | 1 | Año confirmado por país; alimenta la alerta de "faltan feriados" | `country`, `year` (PK compuesta), `confirmedBy`, `confirmedAt` | 1 fila por país y año |
| `CapacitySettings` | 1 | Umbrales y valor por defecto de "incluir probables" | `scope` (PK, `"GENERAL"`), `underThresholdPct` (70), `overThresholdPct` (100), `includeProbablesDefault`, `updatedBy`, `updatedAt` | 1 fila |
| `CapacityReport` | 2 | Reporte oficial congelado para gerencia | `id`, `title`, `fromMonth`, `toMonth`, `includeProbables`, `settings JSON`, `payload JSON`, `publishedBy`, `publishedAt` | ~12 por año, 50–100 KB cada uno |

### 13.3 Columnas nuevas en tablas existentes

| Tabla.columna | Tipo | Valor por defecto | Para qué |
|---|---|---|---|
| `Project.isInternal` | `BOOLEAN` | `false` | Proyectos internos (stand-by). Ojo: no es lo mismo que `Consultant.isInternal`, que indica empleado propio frente a externo |
| `Consultant.city` | `TEXT NULL` | `null` | Feriados locales (Quito, Guayaquil); `null` = solo feriados nacionales |
| `Assignment.certainty` | enum `AssignmentCertainty` | `CONFIRMED` | Confirmado / Probable (regla 3) |
| `CapacityConfig.validFrom` | `DATE` | `2000-01-01` | Vigencia de la jornada (48 → 42 → 40 h) sin reescribir meses pasados |
| `Consultant.startDate`, `Consultant.exitDate` | `DATE NULL` | `null` | **Solo si se aprueba P6**: fuera de ese rango, capacidad 0 |

### 13.4 Columnas que cambian de tipo

| Tabla.columna | De | A | Conversión |
|---|---|---|---|
| `Assignment.startDate` | `timestamp(3)` | `date` | `USING ("startDate" AT TIME ZONE 'UTC')::date` |
| `Assignment.endDate` | `timestamp(3)` | `date` | igual |

Efecto en el código: Prisma sigue devolviendo `Date` (medianoche UTC). Hay que revisar los lugares que
comparan esas fechas con `new Date()` u horas del día: `assignments.job.ts`, `alerts.service.ts:288` y
las rutas de capacity. Están cubiertos por la tarea 1.10.

### 13.5 Enums

| Enum | Cambio | Fase |
|---|---|---|
| `AssignmentCertainty` | **Nuevo**: `CONFIRMED`, `PROBABLE` | 1 |
| `HolidaySource` | **Nuevo**: `GENERATED`, `MANUAL`, `DECREE` | 1 |
| `AppRole` | + `COMMERCIAL` | 1 |
| `ProjectStatus` | + `PROSPECT` | 1 |
| `AlertType` | + `CONSULTANT_UNDERUTILIZED` | 2 |

Nota técnica: en Postgres, un valor agregado con `ALTER TYPE … ADD VALUE` no puede usarse dentro de la
misma transacción. Si el seed o la misma migración insertan filas con `COMMERCIAL` o `PROSPECT`, el
`ADD VALUE` va en una migración propia, anterior.

### 13.6 Restricciones e índices

| Objeto | Antes | Después | Motivo |
|---|---|---|---|
| `CapacityConfig` único por consultor | `UNIQUE (consultantId)` | `UNIQUE (consultantId, validFrom)` | Historial de jornadas |
| `CapacityConfig` único por país | `UNIQUE (country)` | `UNIQUE (country, validFrom)` | Historial de jornadas |
| FK `Assignment → Project` | `ON DELETE CASCADE` | `ON DELETE RESTRICT` | Borrar un proyecto ya no borra el historial de asignaciones (BD-01) |
| Índice de `Assignment` | `(consultantId)` y `(startDate, endDate)` por separado | + `(consultantId, startDate, endDate)` | La consulta mensual filtra por consultor y rango |

La relación 1:1 `Consultant.capacityConfig` pasa a 1:N (`capacityConfigs`), lo que toca
`workday.routes.ts`, `resolverJornada` y `capacity.routes.ts`.

### 13.7 Lo que se elimina

| Objeto | Cuándo | Condición |
|---|---|---|
| Tabla `CustomHoliday` | **Fase 3**, no en el MVP | La usan también Horas extra (`calculateExtraHours.ts`, `extra-hours.routes.ts`) y tres pantallas del frontend (Horas extra, Actividades, Calculadora de estimaciones). Se retira cuando todas lean de `Holiday`. Hasta entonces, la migración del MVP **copia** sus filas a `Holiday` y ambas conviven |
| Columna `Consultant.maxHoursPerDay` | Opcional | El cálculo no la usa, pero se expone en `utils/consultant-scope.ts:26`. Candidata a eliminar al limpiar; no bloquea |
| Valor `AssignmentStatus.PARTIAL` | Opcional | Nunca se escribe (DEP-05), pero aparece en 12 filtros. Retirarlo es limpieza aparte; **no se incluye** |

**No se elimina**:
- `Forecast`: se conserva para Finanzas; solo se deja de crear automáticamente.
- `ConsultantBlock`: el capacity lo ignora, pero se usará en el informe real vs proyectado.
- `CapacityConfig.workDaysPerWeek`.
- Los modos `PERCENTAGE` y `HOURS/month` de `Assignment`.

### 13.8 Migraciones, reversibilidad y entornos

| Migración | Contenido | Fase |
|---|---|---|
| `…_capacity_enums` | `ADD VALUE` de `COMMERCIAL` y `PROSPECT`; enums nuevos | 1 |
| `…_capacity_mensual` | Tablas, columnas, cambio de tipo, restricciones, índices, copia de `CustomHoliday` → `Holiday` y fila de `CapacitySettings` | 1 |
| `…_capacity_reports` | `CapacityReport` y `AlertType.CONSULTANT_UNDERUTILIZED` | 2 |
| `…_drop_custom_holiday` | `DROP TABLE "CustomHoliday"` | 3 |

Los **datos iniciales** van por `seed.mjs`, no por la migración: feriados EC y CO 2026–2027 de la hoja
Feriados (con `city = "Quito"` en los locales) y las jornadas por país con su vigencia.

- **Reversibilidad**: Prisma no genera *down migrations*. Antes de aplicar en la base compartida se toma
  un respaldo. Todo lo del MVP es aditivo salvo el cambio de tipo y el cambio de FK, ambos reversibles
  a mano.
- **Entornos**: local (Postgres portable), la base de pruebas `synatrack_test` (la crea `globalSetup`) y
  Supabase al publicar la versión, con `prisma migrate deploy`, porque Render no lo corre solo.
- **Seguridad en Supabase**: las 4 tablas nuevas heredan el problema existente de **RLS desactivado** y
  permisos completos para `anon` y `authenticated` (`PENDIENTES.md`). No lo empeoran, pero conviene
  resolverlo antes de publicar.
- **Tamaño**: menos de 1 MB por año en total. Sin impacto en el plan Free de Supabase.
