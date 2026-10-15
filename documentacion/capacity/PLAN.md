# Módulo de Capacity — Plan de cambios (Fase 2)

> Fecha: 2026-10-15 · Rama objetivo: `dev` (sale en la siguiente versión) · **Pendiente de aprobación.**
> Insumos: [ASSESSMENT.md](ASSESSMENT.md), [cuestionario_15_10_26.md](cuestionario_15_10_26.md) y
> [Capacity_Synaptica_v2.xlsx](Capacity_Synaptica_v2.xlsx).
> Esfuerzo: **S** ≈ ½–1 día · **M** ≈ 2–3 días · **L** ≈ 4–6 días.

---

## 1. Decisiones tomadas (de tus respuestas)

| # | Decisión | Consecuencia en el diseño |
|---|---|---|
| D1 | La jornada (horas/día) es **configurable, nunca fija en código**, y cambia en el tiempo (CO: 48 → 42 → 40 h/sem) | Jornada **con vigencia** (`validFrom`) por país y por consultor. La capacidad se calcula **día a día** con la jornada vigente ese día, así que un cambio de ley no reescribe los meses pasados |
| D2 | Una sola tabla de feriados en BD; horas extra también la usará | `Holiday` con fecha `DATE` reemplaza a `CustomHoliday` y al cálculo en tiempo real de `holidays.ts`. El generador de código queda solo para **precargar** un año |
| D3 | Feriados **por ciudad** (al menos Quito y Guayaquil) y alta inmediata desde la UI | `Holiday.city` (vacío = nacional) y `Consultant.city`. Pantalla de feriados con alta rápida para decretos |
| D4 | El capacity (proyección) **no descuenta ausencias** | El cálculo mensual ignora `ConsultantBlock`. El informe real vs proyectado es posterior |
| D5 | Proyectos internos para el stand-by; sin asignación el % baja de 100 y hay que alertar | `Project.isInternal`; estado `PROSPECT` para oportunidades; alertas de sub y sobreasignación |
| D6 | Finanzas y Comercial planifican **sobre el capacity** | Capacity cuenta **solo asignaciones**. Se deja de crear el `Forecast` automático y Finanzas consume el capacity (fase 3) |
| D7 | No hay datos productivos | Se pueden cambiar tipos de columna (timestamp → date) y reglas sin migrar datos |
| D8 | Ven capacity: **ADMIN, PM, Comercial, Finanzas**. El consultor no ve nada (información confidencial) | Nuevo rol `COMMERCIAL`. CONSULTANT: 403 en todo `/api/capacity`. Permisos configurables |
| D9 | Solo **ADMIN** edita asignaciones, feriados y parámetros | Hoy PM puede editar asignaciones: se le quita (ver P5) |
| D10 | Se guarda todo el historial; la vista arranca en el **año completo**, con filtro de fecha inicio y fin, y hace falta un **reporte oficial** | Rango libre de meses (por defecto ene–dic del año en curso), más informes oficiales congelados (snapshot) |
| D11 | **No hay importación**: la carga es manual por la UI; se copia la lógica | Sin script de importación. El Excel solo sirve de especificación y de *fixture* de pruebas |
| D12 | Exportación a **Excel y PDF** | Fase 2 |
| D13 | País por **nombre** (como hoy: "Ecuador", "Colombia") | Se mantiene `utils/country.ts` |
| D14 | Destino: `dev`, siguiente versión | Sin cambios de hosting; la migración se aplica en ese despliegue |

---

## 2. Dónde vive el cálculo: **backend, TypeScript puro**

**Recomendación**: una función pura `computeMonthlyCapacity(input)` en `backend/src/utils/capacityMonthly.ts`.
La ruta hace 4 o 5 consultas (consultores, jornadas, asignaciones del rango, feriados del rango y
parámetros) y le pasa todo en memoria.

| Criterio | TS puro en backend (recomendado) | Vista o función SQL en Postgres |
|---|---|---|
| Rendimiento | ~60 consultores × 12 meses × ~22 días ≈ 16 000 iteraciones: **milisegundos**. Las consultas son acotadas por rango e indexadas | Más rápido en teoría, pero a esta escala no se nota; la latencia la dominan la red y el arranque en frío de Render |
| Pruebas | Vitest ya existe; los casos del Excel quedan como pruebas unitarias **sin base de datos**, y se ejecutan en milisegundos | Requiere Postgres para cada prueba (`test:routes`); depurar SQL con `generate_series` y feriados es más lento |
| Mantenimiento | Mismo lenguaje y patrón que `utils/capacity.ts`, `financial.ts` y `evm.ts`; la jornada con vigencia por día es un `for` legible | Lógica de negocio repartida entre Prisma y SQL a mano; las migraciones de vistas son frágiles con Prisma (no las modela) |
| Riesgo de zona horaria | Se controla con un tipo `IsoDate` ("YYYY-MM-DD") y aritmética UTC | Bajo si las columnas son `DATE`, pero Supabase y Prisma devuelven `Date` de todos modos |

SQL tendría sentido si el historial creciera a decenas de miles de asignaciones o si se consumiera
desde BI. Lo dejamos como opción futura: la función pura sirve de referencia para validarlo.

**Convención de fechas del módulo**: las columnas `DATE` llegan de Prisma como `Date` a medianoche UTC.
Se convierten en el borde a `IsoDate` ("YYYY-MM-DD") y el cálculo trabaja solo con cadenas y `Date.UTC`.
Nada de `setHours`, `setDate` ni `new Date(año, mes)` en hora local.

---

## 3. Modelo de datos

Una migración principal, `backend/prisma/migrations/20261016xxxxxx_capacity_mensual/`, más una de
limpieza en la fase 3. El agente es `base-de-datos`.

> El inventario completo, con lo que se agrega, cambia y elimina, las migraciones, la reversibilidad y
> los entornos, está en [ASSESSMENT.md §13](ASSESSMENT.md#13-impacto-en-la-base-de-datos).
> `CustomHoliday` **convive** con `Holiday` hasta la fase 3, porque también la usan Horas extra,
> Actividades y Estimaciones. Los `ADD VALUE` de enums van en una migración previa y separada.

### 3.1 Cambios

```prisma
enum AppRole { ADMIN PM CONSULTANT FINANCE VIEWER COMMERCIAL }          // + COMMERCIAL

enum ProjectStatus { PROSPECT ACTIVE PAUSED CLOSED }                     // + PROSPECT (oportunidad)

enum AssignmentCertainty { CONFIRMED PROBABLE }                          // nuevo

model Project {
  // ...
  isInternal Boolean @default(false)   // proyectos internos / stand-by
}

model Consultant {
  // ...
  city String?                          // "Quito", "Guayaquil"; null = solo feriados nacionales
}

model Assignment {
  // ...
  startDate DateTime @db.Date           // timestamp -> date
  endDate   DateTime @db.Date
  certainty AssignmentCertainty @default(CONFIRMED)
  // allocationMode/hoursPerPeriod/periodUnit se conservan; la UI captura HOURS + "week"
  project Project @relation(..., onDelete: Restrict)   // antes Cascade (BD-01): no borrar historial
  @@index([consultantId, startDate, endDate])
}

model CapacityConfig {                  // jornada con vigencia
  // ...
  validFrom DateTime @db.Date @default(dbgenerated("'2000-01-01'::date"))
  // se cambian los unique (consultantId) y (country) por (consultantId, validFrom) y (country, validFrom)
}

model Holiday {                         // reemplaza a CustomHoliday
  id        String   @id @default(cuid())
  country   String                      // nombre normalizado ("Ecuador")
  city      String   @default("")       // "" = nacional
  date      DateTime @db.Date
  name      String
  source    HolidaySource @default(MANUAL)   // GENERATED | MANUAL | DECREE
  createdBy String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([country, city, date])
  @@index([country, date])
}

model HolidayCalendarYear {             // cobertura explícita para la alerta (regla 9)
  country     String
  year        Int
  confirmedBy String
  confirmedAt DateTime @default(now())
  @@id([country, year])
}

model CapacitySettings {                // fila única, patrón HealthThresholdConfig
  scope              String  @id @default("GENERAL")
  underThresholdPct  Decimal @db.Decimal(5,2) @default(70)
  overThresholdPct   Decimal @db.Decimal(5,2) @default(100)
  includeProbablesDefault Boolean @default(false)
  updatedBy String?
  updatedAt DateTime @updatedAt
}

model CapacityReport {                  // reporte oficial congelado (fase 2)
  id               String   @id @default(cuid())
  title            String
  fromMonth        String               // "YYYY-MM"
  toMonth          String
  includeProbables Boolean
  settings         Json                 // umbrales usados
  payload          Json                 // resultado completo del cálculo
  publishedBy      String
  publishedAt      DateTime @default(now())
}
```

**Por qué `city = ""` y no `null`**: en Postgres, `NULL` no choca en un `UNIQUE`, y se podrían
duplicar feriados nacionales. Con la cadena vacía basta un `@@unique` normal.

**Por qué `HolidayCalendarYear`**: en el Excel, "faltan feriados" se deduce de la fecha máxima, y eso no
detecta huecos. Aquí ADMIN **confirma** cada año por país ("calendario EC 2027 revisado"). La alerta
salta si algún país de los consultores visibles no tiene el año confirmado dentro del rango. Un decreto
nuevo se agrega en cualquier momento sin tocar la confirmación.

### 3.2 Migración de datos

La migración convierte `Assignment.startDate/endDate` con `USING (col AT TIME ZONE 'UTC')::date`;
como no hay datos productivos, el riesgo es nulo. Copia `CustomHoliday` a `Holiday` (`"All"` → un
registro por país soportado). Agrega `COMMERCIAL` al enum y la fila `CapacitySettings`. El seed carga
**feriados EC y CO 2026–2027** desde la hoja Feriados del Excel, incluidos el decreto 507 y los de
Quito (como `city="Quito"`), y la jornada actual por país (ver P1).

### 3.3 Fuera de alcance

`ConsultantBlock` sigue con `timestamp`, porque el capacity no lo usa. Se dejan para después la
paginación general (BE-11) y la relación `User` ↔ `Consultant`.

---

## 4. Reglas de cálculo (contrato de `computeMonthlyCapacity`)

Para cada consultor `c`, mes `m` y día `d`:

```
hábil(c, d)     = d es L-V  ∧  d ∉ feriados(c.country, "")  ∧  d ∉ feriados(c.country, c.city)
jornada(c, d)   = CapacityConfig vigente en d: consultor > país > "Default"     (validFrom ≤ d, el mayor)
capacidad(c, m) = Σ_{d ∈ m, hábil} jornada(c, d)
horas(a, m)     = Σ_{d ∈ [max(a.ini, m.ini), min(a.fin, m.fin)], hábil(c, d)} (a.horasSem / 5) × factor(a)
factor(a)       = 0 si a.certainty = PROBABLE y !incluirProbables;  1 en otro caso
asignadas(c, m) = Σ_a horas(a, m)        (a con status ≠ CANCELLED)
%(c, m)         = asignadas / capacidad   (null si capacidad = 0)
%(c, periodo)   = Σ_m asignadas / Σ_m capacidad          ← ponderado
%(equipo, m)    = Σ_c asignadas / Σ_c capacidad          ← ponderado
estado          = SOBRE si % > umbralSobre;  SANO si % ≥ umbralSub;  SUB si % < umbralSub
```

- Si `fin < inicio`, la asignación aporta 0 horas y además se rechaza al guardarla (Zod).
- Un feriado en fin de semana no cambia nada, porque ese día ya no era hábil.
- Un consultor sin asignaciones queda en 0 %, estado SUB, y se cuenta en "# subutilizados".
- Un consultor sin país se excluye del total y genera el aviso `CONSULTANT_WITHOUT_COUNTRY`.
- Un país sin año confirmado genera el aviso `HOLIDAYS_NOT_CONFIRMED { country, year }`. **No bloquea**
  el cálculo: se calcula con los feriados que haya.
- Los modos `PERCENTAGE` y `HOURS/month` se normalizan a horas semanales:
  `% × jornada_base × 5` y `horas_mes × 12 / 52`. La UI ya no los ofrece, pero se aceptan.
- El cálculo no redondea; solo se redondea al presentar (1 decimal en horas y 0 decimales en %).
- Las horas de proyectos internos se suman a las asignadas y se reportan también aparte
  (`internalHours`). Ver P2.

---

## 5. API

Las rutas siguen el patrón Zod → Prisma → `{ data }`, con `writeAudit` en toda escritura. El agente es
`backend-fastify`. Los permisos se resuelven con un helper nuevo, `requirePermission("capacity:read")`,
que lee `rolePermissions`, en lugar de listas de roles a mano. Así, la matriz de `roles.ts` pasa a ser la
única fuente para este módulo.

| Método y ruta | Permiso | Descripción |
|---|---|---|
| `GET /api/capacity/monthly?from=YYYY-MM&to=YYYY-MM&country&city&consultantId&includeProbables&internal=include\|exclude` | `capacity:read` | Por defecto, ene–dic del año en curso. Máximo 24 meses. Devuelve `months[]`, `consultants[{…, months[{workdays, capacityHours, assignedHours, internalHours, availableHours, pct, status}], period}]`, `team{months[], period}`, `kpis{utilization, overCount, underCount, availableHours}`, `warnings[]` y los `settings` usados |
| `GET /api/capacity/monthly/consultant/:id?from&to&includeProbables` | `capacity:read` | Desglose por asignación × mes (proyecto, cliente, h/sem, estado, horas por mes) |
| `GET/PUT /api/capacity/settings` | read / `capacity:config` | Umbrales y valor por defecto de probables |
| `GET /api/holidays?country&city&year` | `holidays:read` | Lista |
| `POST/PUT/DELETE /api/holidays[/:id]` | `holidays:write` (ADMIN) | Alta, edición y baja, con auditoría |
| `POST /api/holidays/generate { country, year }` | `holidays:write` | Precarga con el generador del código (sin duplicar) y devuelve lo creado para revisión |
| `GET /api/holidays/coverage?from&to` | `holidays:read` | Países × años confirmados o pendientes |
| `PUT/DELETE /api/holidays/calendar-years/:country/:year` | `holidays:write` | Confirmar o desconfirmar un año |
| `GET/POST/PUT/DELETE /api/assignments` | read: `capacity:read`; write: `assignments:write` (ADMIN) | Se adaptan: `certainty`, fechas `YYYY-MM-DD`, horas/semana. La sobreasignación **avisa** (`warnings` en la respuesta) y no bloquea. Ya no crea `Forecast` |
| `GET/PUT/DELETE /api/capacity/workday/...` | `capacity:config` | Se extiende con `validFrom` (historial de jornadas) |
| `POST /api/capacity/reports` · `GET /api/capacity/reports[/:id]` | publicar: ADMIN; leer: `capacity:read` | Reporte oficial congelado (fase 2) |

Los endpoints actuales `/overview`, `/available`, `/bench`, etc. se conservan en el MVP, con dos
cambios: **dejan de sumar forecasts** y sus permisos se alinean a `capacity:read`. Su retiro se decide
en la fase 3.

---

## 6. Frontend

El agente es `frontend-react`; luego `revisor-ui` revisa en el navegador. `CapacityTab.tsx` ya tiene
1455 líneas: **la vista nueva va en archivos propios**.

| Pieza | Archivo | Contenido |
|---|---|---|
| Sub-pestaña "Mensual" (por defecto) | `features/capacity/monthly/MonthlyCapacityPanel.tsx` | Orquesta filtros, KPIs, mapa de calor, gráfico y detalle |
| Selector de periodo | `features/capacity/monthly/PeriodSelector.tsx` (reutiliza `MonthYearPicker`) | Desde y hasta en meses, botones ◀ ▶ que desplazan el rango, atajos "Año actual" y "Próximos 6 meses", interruptor "Incluir probables" y filtros de país y ciudad |
| Fila de KPIs | `KpiRow.tsx` | Utilización del equipo (ponderada), # sobreasignados, # subutilizados, horas disponibles y aviso de feriados no confirmados |
| Mapa de calor | `CapacityHeatmap.tsx` | Consultor × mes, con columna "Periodo" y fila "Equipo". Celdas rojo/verde/ámbar con los **tokens CSS** del tema (claro y oscuro) más texto del % (no solo color, por accesibilidad). Ordenable |
| Gráfico de utilización mensual | `UtilizationChart.tsx` (SVG a mano, como `HoursBarChart`) | Columnas por mes con líneas de umbral al 70 % y 100 % |
| Detalle del consultor | `ConsultantCapacityDrawer.tsx` | Desglose por proyecto × mes (confirmado, probable o interno) y capacidad y días hábiles del mes |
| Hook | `hooks/useCapacityMonthly.ts` | Con estado `error` (patrón de `useTimeEntries`): un 500 no se muestra como "equipo vacío" |
| Asignaciones | Formulario actual en `CapacityTab` | Horas/semana por defecto, campo Confirmado/Probable, aviso de sobreasignación, proyectos `PROSPECT` e internos en el selector |
| Feriados (ADMIN) | `features/holidays/HolidaysTab.tsx` (Administración) | Calendario o lista por país, ciudad y año; alta rápida para decretos; "Precargar año"; "Confirmar año" |
| Parámetros (ADMIN) | Se agrega a `WorkdayConfigTab.tsx` | Umbrales y jornadas con vigencia ("desde") por país y por consultor |
| Permisos | `App.tsx` (`SIDEBAR_GROUPS`, `TAB_PATH_MAP`, simulador de rol), `services/api.ts` (`AppRole`) | `COMMERCIAL` en el simulador; Capacidad oculta para CONSULTANT |

---

## 7. Plan por fases

### Fase 0 — Preparación (corrige lo que hoy está mal) · ~2 días

| # | Tarea | Archivos | Agente | Esf. |
|---|---|---|---|---|
| 0.1 | Corregir el generador de feriados de Ecuador: Cuenca 3-nov y traslado del 1-may en sábado. Agregar pruebas de EC y CO 2026–2027 contra la hoja Feriados | `utils/holidays.ts`, `utils/__tests__/holidays.test.ts` | calculos-negocio | S |
| 0.2 | Quitar la suma de forecasts del capacity actual (doble conteo) y dejar de autocrear `Forecast` en `POST /assignments` | `capacity.routes.ts:140-182`, `assignments.routes.ts:121-185`, tests | backend-fastify | S |
| 0.3 | Agregar las pruebas unitarias del backend al CI (hoy solo corre el frontend) | `.github/workflows/*.yml` | qa-pruebas | S |

### Fase 1 — MVP: informe mensual con datos cargados a mano · ~3 semanas

| # | Tarea | Archivos | Agente | Esf. |
|---|---|---|---|---|
| 1.1 | Schema y migración `capacity_mensual` (§3), seed de feriados EC/CO 2026–27 y jornadas | `prisma/schema.prisma`, `migrations/…`, `seed.mjs` | base-de-datos | M |
| 1.2 | Rol `COMMERCIAL`: enum, mapeo de la claim, matriz `rolePermissions` (`capacity:read` para ADMIN, PM, FINANCE y COMMERCIAL; nuevos `holidays:*`) y helper `requirePermission` | `auth/roles.ts`, `auth/guard.ts`, `utils/` | backend-fastify | S |
| 1.3 | `IsoDate` y utilidades de fecha UTC (rango de meses, iterar días, `max`/`min`) | `utils/isoDate.ts` + test | calculos-negocio | S |
| 1.4 | `resolveJornadaForDay` con vigencia | `utils/capacity.ts` + test | calculos-negocio | S |
| 1.5 | **`computeMonthlyCapacity`** (§4) | `utils/capacityMonthly.ts` | calculos-negocio | M |
| 1.6 | **Pruebas del cálculo**: los 4 casos obligatorios, el *fixture* completo del Excel (§1.2.1 del assessment, con y sin probables) y los bordes (§8) | `utils/__tests__/capacityMonthly.test.ts` | calculos-negocio + qa-pruebas | M |
| 1.7 | Endpoints `GET /capacity/monthly` y `/monthly/consultant/:id` | `modules/capacity/monthly.routes.ts`, `routes/index.ts` | backend-fastify | M |
| 1.8 | Módulo de feriados: CRUD, `generate`, `coverage`, `calendar-years` y auditoría | `modules/holidays/holidays.routes.ts` (reemplaza `custom-holidays`), `utils/audit.ts` | backend-fastify | M |
| 1.9 | `CapacitySettings` GET/PUT y jornada con `validFrom` | `modules/capacity/settings.routes.ts`, `workday.routes.ts` | backend-fastify | S |
| 1.10 | Adaptar asignaciones: `certainty`, fechas DATE, h/sem, avisar sin bloquear, escritura solo ADMIN | `modules/assignments/assignments.routes.ts`, `assignments.job.ts` (a UTC) | backend-fastify | M |
| 1.11 | `PROSPECT` e `isInternal` en proyectos: revisar dónde se filtra por estado (portafolio, dashboard, EVM, alertas) para que un `PROSPECT` no contamine indicadores | `modules/projects`, `stats`, `portfolio`, `alerts` | backend-fastify | M |
| 1.12 | Pruebas de rutas: permisos (CONSULTANT 403, COMMERCIAL 200, PM no escribe), feriados solo ADMIN y fechas sin corrimiento | `tests/routes/capacity-mensual.test.ts`, `holidays.test.ts` | qa-pruebas | M |
| 1.13 | Tipos y llamadas en `services/api.ts`; `useCapacityMonthly` con error | `services/api.ts`, `hooks/` | frontend-react | S |
| 1.14 | `MonthlyCapacityPanel` con selector de periodo, KPIs, mapa de calor y detalle | `features/capacity/monthly/*` | frontend-react | L |
| 1.15 | `UtilizationChart` en SVG | `features/capacity/monthly/UtilizationChart.tsx` | frontend-react | S |
| 1.16 | Pantalla de Feriados (ADMIN) y parámetros en Jornada | `features/holidays/HolidaysTab.tsx`, `WorkdayConfigTab.tsx`, `App.tsx`, `types.ts` | frontend-react | M |
| 1.17 | Formulario de asignaciones (h/sem, certeza, avisos) y proyecto (`PROSPECT`, interno) | `CapacityTab.tsx`, `features/projects/*` | frontend-react | M |
| 1.18 | Permisos en la UI: sidebar, simulador con COMMERCIAL, ocultar para CONSULTANT | `App.tsx`, `services/api.ts` | frontend-react | S |
| 1.19 | Pruebas del frontend: clasificación de color, desplazamiento del periodo y estado de error | `frontend/src/test/` | qa-pruebas | S |
| 1.20 | Revisión de seguridad (fuga de % entre roles, COMMERCIAL, PM) y revisión en el navegador (modo oscuro, móvil) | — | revisor-seguridad, revisor-ui | S |
| 1.21 | Documentación: `MAPA_PROYECTO.md` (regenerar), `DOCUMENTACION_APLICACION.md` y CLAUDE.md (secciones desactualizadas) | `documentacion/` | — | S |

Para aceptar el MVP: cargar a mano los datos de ejemplo del Excel y obtener **exactamente** la tabla del
§1.2.1 del assessment, en pantalla y por API.

### Fase 2 — Gerencia y alertas · ~1,5 semanas

| # | Tarea | Agente | Esf. |
|---|---|---|---|
| 2.1 | **Exportar a Excel**: hojas Capacity (con colores), Horas y Detalle, con `xlsx` como en `DashboardTab` | frontend-react | M |
| 2.2 | **Exportar a PDF**: horizontal, título del periodo, KPIs, mapa de calor coloreado y gráfico, con `jspdf-autotable` | frontend-react | M |
| 2.3 | **Reporte oficial**: `CapacityReport` (publicar, listar, ver y exportar el congelado) | backend-fastify + frontend-react | M |
| 2.4 | **Alertas**: `CONSULTANT_UNDERUTILIZED` (nuevo) y `CONSULTANT_OVERLOADED` (existe y nunca se genera, DEP-06), dentro del ciclo de `jobs`, con aviso por correo o Teams (ver P7) | backend-fastify | M |

Esfuerzo de la exportación (pregunta original): **Excel M + PDF M ≈ 4–5 días entre ambos**. Las
librerías ya están instaladas y en chunks separados.

### Fase 3 — Integraciones · ~2 semanas (a planificar después)

| # | Tarea | Esf. |
|---|---|---|
| 3.1 | Horas extra usa `Holiday`, con país y ciudad del consultor, en lugar de `isPublicHoliday` + `CustomHoliday` (`calculateExtraHours.ts:93-118`, `extra-hours.routes.ts:1169`). Requiere pruebas de recargos en festivo | M |
| 3.2 | Finanzas: proyección de costo e ingreso desde asignaciones (capacity) × tarifa, en lugar de forecasts autogenerados | L |
| 3.3 | Retirar `CustomHoliday`, el cálculo de feriados en tiempo real y, si se decide, la "Vista general" antigua | S |
| 3.4 | Informe real vs proyectado (horas registradas y ausencias contra capacity) | L |
| 3.5 | Permisos configurables desde la UI (matriz rol × permiso en BD), si P4 lo pide | L |

---

## 8. Pruebas

**Unitarias del cálculo** (`capacityMonthly.test.ts`, sin BD):

| Caso | Esperado |
|---|---|
| EC, oct-2026, 32 + 16 h/sem | capacidad 168; 134,4 + 67,2 = 201,6 h; 120 % |
| CO 40 h/sem desde 15-oct-2026 (jornada CO fijada en 8 dentro del caso) | 96 / 168 = 57,14 % |
| EC medio tiempo (4 h) | capacidad oct-2026 = 84 h |
| Probable con el filtro apagado / encendido | 0 h / suma |
| *Fixture* completo del Excel, 6 meses × 3 consultores + equipo, con y sin probables | Tabla del §1.2.1 del assessment |
| Asignación que cruza meses (1-sep-26 → 26-feb-27) | Prorrateo correcto en cada mes, incluido el corte del 18-dic |
| Feriado en fin de semana (CO 1-may-2027, sábado) | No cambia los días hábiles |
| Consultor sin asignaciones | 0 %, SUB, cuenta en `underCount` |
| `fin < inicio` | 0 h (y la validación Zod lo rechaza) |
| País sin feriados confirmados | Se calcula con lo que haya y aparece el aviso `HOLIDAYS_NOT_CONFIRMED` |
| Feriado local (Quito 7-dic-2026) | Lo descuenta un consultor de Quito; uno de Guayaquil no |
| Cambio de jornada a mitad de mes (CO 8 → 8,4 desde el 15-jul) | La capacidad suma día a día |
| Mes con capacidad 0 | `pct = null`, sin división por cero |
| Exactamente 100 % / 70 % | SANO (umbrales estrictos como en el Excel) |
| Promedio del periodo ponderado frente a promedio simple | Difieren y se usa el ponderado |

Además: el generador de feriados contra la hoja Feriados (0.1), pruebas de rutas (1.12) y del
frontend (1.19).

---

## 9. Impacto en hosting

| Servicio | Impacto |
|---|---|
| Supabase (Free, 500 MB) | **Despreciable**. Feriados: ~60 filas/año por país. Asignaciones: cientos. Reportes oficiales: JSON de ~50–100 KB cada uno, unos 12/año ≈ 1 MB/año |
| Render (Free) | **Sin cambio**. El cálculo dura milisegundos; las alertas van en el cron de jobs que ya existe (cada hora) |
| Vercel (Hobby) | **Sin cambio**. Una pantalla más; `xlsx` y `jspdf` ya se cargan bajo demanda |
| Entra ID | **Acción manual**: crear el app role `Commercial` en el registro de la aplicación y asignarlo a las personas de Comercial |
| Despliegue | Recordatorio: Render no aplica migraciones solo; hay que correr `prisma migrate deploy` al publicar la versión |

---

## 10. Riesgos

| Riesgo | Mitigación |
|---|---|
| `PROSPECT` contamina portafolio, dashboard y EVM (11 filtros por estado en el backend) | Tarea 1.11 con pruebas; alternativa: excluir `PROSPECT` por defecto en todos los listados |
| Corrimiento de un día por zona horaria | Columnas `DATE`, tipo `IsoDate`, pruebas de borde en el primer y el último día del mes con TZ distinta de UTC (`TZ=America/Bogota` en vitest) |
| Quitar la escritura de asignaciones al PM cambia el flujo actual | Confirmar (P5) antes de 1.10 |
| Dejar de autocrear forecasts afecta pantallas de Finanzas que los lean | Revisar `ForecastsTab` y `financial.ts` en 0.2; sin datos productivos, el impacto es solo funcional |
| Jornada CO 8,4 h frente a asignación "tiempo completo" de 40 h/sem → 95 % | Decidir P1 |
| Dos vistas de capacidad con reglas distintas (la antigua resta ausencias; la mensual no) | Rotularlas ("Disponibilidad real" frente a "Capacity proyectado") y decidir el retiro en 3.3 |
| Permisos en dos sistemas | `requirePermission` en este módulo; la convergencia total queda en 3.5 |

---

## 11. Preguntas que quedan

Las respuestas resolvieron casi todo. Quedan estas, con el supuesto que uso si no me indicas otra cosa:

| # | Pregunta | Supuesto por defecto |
|---|---|---|
| P1 | **Jornada actual de Colombia y desde cuándo.** Dijiste 42 h/sem → 8,4 h/día. ¿Desde qué fecha (la ley la aplicó el 15-jul-2026)? Y con 8,4 h, una asignación de 40 h/sem queda al 95 %: ¿está bien, o una asignación "tiempo completo" debe equivaler a la jornada? | CO = 8 h hasta el 14-jul-2026 y 8,4 h desde el 15-jul-2026; EC = 8 h; 40 h/sem = 95 % es correcto (refleja que sobra capacidad) |
| P2 | **¿Las horas en proyectos internos (stand-by) cuentan como ocupación?** Si cuentan, un consultor en la banca asignado a un interno aparece al 100 % y no alerta | Cuentan en el %, pero se muestran aparte (sombreado distinto) y existe el KPI "% facturable" y un filtro "excluir internos". La alerta de subutilización usa el % **facturable** |
| P3 | **VIEWER** no está en tu lista. ¿Pierde el acceso a capacity? | Sí, lo pierde |
| P4 | **"Configuración de permisos"**: ¿te basta con la matriz en código (cambiarla requiere despliegue), o quieres una pantalla para que ADMIN la edite? | Matriz en código para el MVP; la pantalla queda en la fase 3.5 |
| P5 | **Asignaciones solo ADMIN**: hoy el PM las crea y edita. ¿Confirmas que pierde la escritura? | Sí, solo ADMIN |
| P6 | **Fechas de ingreso y salida del consultor**: con la vista por defecto de año completo, alguien que entra en junio aparece en rojo de enero a mayo | Agregar `startDate` y `exitDate` opcionales al consultor; fuera de ese rango, capacidad 0 y "—" en la celda (+S en 1.1 y 1.5) |
| P7 | **Alertas de sub y sobreasignación**: ¿a quién (Comercial, PM, ADMIN), por qué canal (correo o Teams) y con qué frecuencia? | Resumen semanal por correo a ADMIN y Comercial, como el digest de aprobaciones |
| P8 | **Reporte oficial**: ¿quién lo publica y cuándo? | ADMIN, a demanda (normalmente al cierre de mes); inmutable |
| P9 | **Qué consultores aparecen**: no quedó respondida | Activos, internos y externos, con filtro "Empresa" |
