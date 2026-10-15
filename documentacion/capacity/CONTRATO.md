# Capacity mensual — Contrato técnico

> Fuente de verdad compartida entre base de datos, cálculo, API y frontend. Deriva de
> [PLAN.md](PLAN.md) (aprobado el 2026-10-15 con los supuestos P1–P9). Si algo aquí contradice al
> plan, manda este documento; si hay que cambiarlo, se cambia aquí primero.

## 1. Esquema (Prisma)

```prisma
enum AppRole        { ADMIN PM CONSULTANT FINANCE VIEWER COMMERCIAL }
enum ProjectStatus  { PROSPECT ACTIVE PAUSED CLOSED }
enum AssignmentCertainty { CONFIRMED PROBABLE }
enum HolidaySource  { GENERATED MANUAL DECREE }

Project.isInternal     Boolean  @default(false)
Consultant.city        String?                      // "Quito", "Guayaquil"; null = solo nacionales
Consultant.hireDate    DateTime? @db.Date           // P6
Consultant.exitDate    DateTime? @db.Date           // P6
Assignment.startDate   DateTime @db.Date            // antes timestamp
Assignment.endDate     DateTime @db.Date
Assignment.certainty   AssignmentCertainty @default(CONFIRMED)
Assignment.project     onDelete: Restrict           // antes Cascade
@@index([consultantId, startDate, endDate]) en Assignment

CapacityConfig.validFrom DateTime @db.Date @default(dbgenerated("'2000-01-01'::date"))
  unique (consultantId, validFrom) y (country, validFrom)   // reemplazan a los unique simples
  Consultant.capacityConfig (1:1) -> Consultant.capacityConfigs CapacityConfig[] (1:N)

model Holiday { id, country, city String @default(""), date @db.Date, name, source HolidaySource @default(MANUAL),
                createdBy String?, createdAt, updatedAt; @@unique([country, city, date]); @@index([country, date]) }
model HolidayCalendarYear { country, year Int, confirmedBy, confirmedAt; @@id([country, year]) }
model CapacitySettings { scope String @id @default("GENERAL"), underThresholdPct Decimal(5,2) @default(70),
                         overThresholdPct Decimal(5,2) @default(100), includeProbablesDefault Boolean @default(false),
                         updatedBy String?, updatedAt @updatedAt }
```

- `country` siempre es el **nombre normalizado** de `utils/country.ts` ("Ecuador", "Colombia").
- `city`: texto recortado (trim, espacios simples). `""` = feriado nacional. Las comparaciones de ciudad y
  país en el cálculo **no distinguen mayúsculas ni tildes**.
- `CustomHoliday` **sigue existiendo** (lo usan horas extra, actividades y estimaciones). La migración copia
  sus filas a `Holiday` (`"All"` → una fila por país soportado excepto "Default"). Se retira en la fase 3.
- Jornadas sembradas: `Default` 8 h (desde 2000-01-01); `Ecuador` 8 h (desde 2000-01-01); `Colombia` 8 h
  (desde 2000-01-01) y **8,4 h desde 2026-07-15** (P1).

## 2. Cálculo puro — `backend/src/utils/capacityMonthly.ts`

```ts
export type IsoDate = string;   // "YYYY-MM-DD"
export type MonthKey = string;  // "YYYY-MM"
export type CapacityStatus = "OVER" | "OK" | "UNDER";

export interface MonthlyCapacityInput {
  months: MonthKey[];                       // consecutivos, ya validados (máx. 24)
  includeProbables: boolean;
  thresholds: { underPct: number; overPct: number };   // 70, 100 (en %)
  consultants: { id: string; country: string | null; city: string | null;
                 hireDate: IsoDate | null; exitDate: IsoDate | null }[];
  jornadas: { consultantId: string | null; country: string | null;
              hoursPerDay: number; validFrom: IsoDate }[];   // country "Default" = general
  holidays: { country: string; city: string; date: IsoDate }[];   // city "" = nacional
  confirmedYears: { country: string; year: number }[];
  assignments: { id: string; consultantId: string; startDate: IsoDate; endDate: IsoDate;
                 hoursPerWeek: number; certainty: "CONFIRMED" | "PROBABLE"; isInternal: boolean }[];
}
```

Reglas (día `d`, consultor `c`, mes `m`):

- `hábil(c,d)` = lunes a viernes, `d` dentro de `[hireDate, exitDate]` (si existen), y `d` no es feriado
  del país de `c` con ciudad `""` ni con la ciudad de `c`. `workDaysPerWeek` **no** aplica aquí.
- `jornada(c,d)`: entre las filas con `validFrom ≤ d`, toma la de mayor `validFrom`, en este orden de
  precedencia: las del consultor, luego las de su país y luego `Default`. Si no hay ninguna, 8.
- `capacidad(c,m) = Σ jornada(c,d)` sobre los días hábiles de `m`.
- `horas(a,m) = díasHábiles(c, max(a.ini, m.ini) .. min(a.fin, m.fin)) × a.hoursPerWeek / 5`. Si
  `ini > fin`, da 0. Las horas de una asignación también son 0 fuera de `[hireDate, exitDate]`.
- Probable: `probableHours` se acumula **siempre**; entra en `assignedHours` solo si `includeProbables`.
- `assignedHours` = confirmadas + (probables si aplica), incluidos los internos. `internalHours` es la parte
  interna de `assignedHours`, y `billableHours = assignedHours − internalHours`.
- `pct = assignedHours / capacityHours × 100` y `billablePct = billableHours / capacityHours × 100`; los dos
  son `null` si la capacidad es 0.
- `status(pct)`: `null` si `pct` es `null`; `OVER` si `pct > overPct`; `OK` si `pct ≥ underPct`; si no, `UNDER`.
- `period` de un consultor: sumas de los meses y `pct` ponderado; `status` según el `pct` del periodo.
- `team.months[m]`: sumas de los consultores **con país** y `pct` ponderado. `overCount` cuenta los
  consultores con `status` del mes = OVER; `underCount` los que tienen `billableStatus` del mes = UNDER.
  `team.period` es igual, sobre el periodo.
- `kpis` = `team.period` más `consultantCount`.
- `warnings`:
  - `{ code: "CONSULTANT_WITHOUT_COUNTRY", consultantId }`: ese consultor no entra en el equipo y sus
    meses traen `capacityHours = 0`.
  - `{ code: "HOLIDAYS_NOT_CONFIRMED", country, year }`: por cada país de los consultores incluidos y
    cada año del rango sin fila en `confirmedYears`.
- **Sin redondeo** en la salida del cálculo; se redondea al presentar.

Salida:

```ts
interface MonthCell { month: MonthKey; workdays: number; capacityHours: number; assignedHours: number;
  billableHours: number; internalHours: number; probableHours: number; availableHours: number;  // capacidad − asignadas (puede ser < 0)
  pct: number | null; billablePct: number | null; status: CapacityStatus | null; billableStatus: CapacityStatus | null; }
interface AssignmentBreakdown { assignmentId: string; included: boolean; totalHours: number;
  months: { month: MonthKey; hours: number }[] }      // horas reales calculadas aunque no se incluya
interface ConsultantResult { consultantId: string; months: MonthCell[]; period: Omit<MonthCell,"month">;
  assignments: AssignmentBreakdown[] }
interface TeamCell extends MonthCell { overCount: number; underCount: number }   // workdays = 0 en equipo
interface MonthlyCapacityResult { months: MonthKey[]; consultants: ConsultantResult[];
  team: { months: TeamCell[]; period: Omit<TeamCell,"month"> };
  kpis: { utilizationPct: number | null; billablePct: number | null; overCount: number; underCount: number;
          availableHours: number; capacityHours: number; assignedHours: number; consultantCount: number };
  warnings: ({ code: "CONSULTANT_WITHOUT_COUNTRY"; consultantId: string }
           | { code: "HOLIDAYS_NOT_CONFIRMED"; country: string; year: number })[] }

export function computeMonthlyCapacity(input: MonthlyCapacityInput): MonthlyCapacityResult;
export function monthRange(from: MonthKey, to: MonthKey): MonthKey[];       // valida orden y máximo 24
export function toHoursPerWeek(a: { allocationMode: "PERCENTAGE" | "HOURS"; allocationPct: number | null;
  hoursPerPeriod: number | null; periodUnit: string | null }, baseHoursPerDay: number): number;
  // HOURS + week -> hoursPerPeriod; HOURS + month -> hoursPerPeriod*12/52; PERCENTAGE -> pct/100*base*5
```

Utilidades de fecha en `backend/src/utils/isoDate.ts`: `toIsoDate(Date)` (en UTC), `fromIsoDate`,
`addDaysIso`, `isWeekdayIso`, `monthStart`/`monthEnd(MonthKey)`, `eachDayIso(from, to)`, `maxIso`/`minIso`.
Prohibido usar hora local.

## 3. API

Todas las rutas usan el envoltorio `{ data }` y `writeAudit` en las escrituras. Las fechas viajan como
`"YYYY-MM-DD"` y los meses como `"YYYY-MM"`.

### 3.1 `GET /api/capacity/monthly` — permiso `capacity:read`

Query (Zod):
- `from` y `to`: `YYYY-MM`. Por defecto, enero y diciembre del año en curso (UTC). Máximo 24 meses.
- `includeProbables`: `"true"` o `"false"`. Por defecto, `CapacitySettings.includeProbablesDefault`.
- `internal`: `include` (por defecto) o `exclude`, que quita las asignaciones a proyectos internos.
- Filtros opcionales: `country`, `city`, `company`, `consultantId`.

Consultores incluidos: los que tienen `active = true`, o un `exitDate ≥` el primer día del rango, que
además cumplan los filtros. Asignaciones incluidas: `status ≠ CANCELLED` y que se crucen con el rango.

```jsonc
{ "data": {
  "from": "2026-01", "to": "2026-12", "includeProbables": false, "internal": "include",
  "settings": { "underThresholdPct": 70, "overThresholdPct": 100 },
  "months": ["2026-01", "..."],
  "consultants": [{ "id": "…", "fullName": "…", "country": "Ecuador", "city": "Quito", "company": "Synaptica",
                    "isInternal": true, "role": "…", "hireDate": null, "exitDate": null,
                    "months": [MonthCell], "period": {…} }],
  "team": { "months": [TeamCell], "period": {…} },
  "kpis": {…}, "warnings": [ … , { "code": "CONSULTANT_WITHOUT_COUNTRY", "consultantId": "…", "fullName": "…" } ]
}}
```

Las horas van redondeadas a 1 decimal y los porcentajes a 1 decimal; el redondeo se hace en la ruta.

### 3.2 `GET /api/capacity/monthly/consultant/:id` — permiso `capacity:read`

Misma query (sin `consultantId`). Devuelve `{ consultant, months, period, assignments: [{ assignmentId,
projectId, projectName, client (Project.company), projectStatus, isInternal, certainty, status, startDate,
endDate, hoursPerWeek, included, totalHours, months: [{ month, hours }] }] }`. Responde 404 si no existe.

### 3.3 Parámetros

- `GET /api/capacity/settings` (`capacity:read`).
- `PUT /api/capacity/settings` (`capacity:config`, ADMIN), con `{ underThresholdPct, overThresholdPct,
  includeProbablesDefault }`. Validación: `0 ≤ under < over ≤ 300`.

### 3.4 Feriados — `/api/holidays`

| Ruta | Permiso | Notas |
|---|---|---|
| `GET /?country&city&year&from&to` | `holidays:read` (todos los roles) | Ordenado por fecha |
| `POST /` | `holidays:write` (ADMIN) | `{ country, city?, date, name, source? }`. 409 si se duplica |
| `PUT /:id` | `holidays:write` | |
| `DELETE /:id` | `holidays:write` | Responde 204 |
| `POST /generate` | `holidays:write` | `{ country, year }`. Inserta lo que da `getHolidaysForYear` con `source = GENERATED` y `city = ""`, sin duplicar fechas ya cargadas para ese país. Devuelve `{ created: [...], skipped: n }` |
| `GET /coverage?from&to` | `holidays:read` | `[{ country, year, holidayCount, confirmed, confirmedBy, confirmedAt }]` para los países de consultores activos |
| `PUT /calendar-years/:country/:year` | `holidays:write` | Confirma el año |
| `DELETE /calendar-years/:country/:year` | `holidays:write` | Desconfirma; responde 204 |
| `GET /cities?country` | `holidays:read` | Ciudades distintas, de `Holiday` y de `Consultant.city` |

Las rutas viejas de `/api/custom-holidays` siguen funcionando, pero su escritura pasa a ser solo de ADMIN.

### 3.5 Jornada — `/api/capacity/workday`

Se conserva la forma actual y se agrega `validFrom` (`YYYY-MM-DD`, por defecto `2000-01-01`). Así, un país o
un consultor pueden tener varias filas.

- `PUT /country/:country` y `PUT /consultant/:id` hacen *upsert* por `(clave, validFrom)`.
- `DELETE` recibe `?validFrom=`.
- `GET` devuelve **todas** las filas con su `validFrom`.
- `/effective?date=` resuelve la jornada vigente en esa fecha (por defecto, hoy).

### 3.6 Asignaciones — `/api/assignments`

- Lectura con `capacity:read`; escritura con `assignments:write` (**solo ADMIN**).
- El payload acepta `certainty`, y fechas como `YYYY-MM-DD` (las ISO completas se truncan a la fecha UTC).
- La UI envía `allocationMode = "HOURS"` y `periodUnit = "week"`; los otros modos siguen aceptándose.
- `endDate < startDate` → 400.
- Ya **no** crea `Forecast`.
- La sobreasignación **no bloquea**: la respuesta trae `warnings: [{ code: "OVERALLOCATED", month, pct }]`.
  Se calcula con `computeMonthlyCapacity` en los meses de la asignación, solo con las confirmadas.

### 3.7 Proyectos

- `status` acepta `PROSPECT`.
- `isInternal` se puede leer y escribir.
- Los indicadores de portafolio, dashboard, EVM, alertas y stats **excluyen los `PROSPECT`**.

## 4. Permisos (`auth/roles.ts`)

| Permiso | ADMIN | PM | FINANCE | COMMERCIAL | CONSULTANT | VIEWER |
|---|---|---|---|---|---|---|
| `capacity:read` | ✔ | ✔ | ✔ | ✔ | — | — (P3) |
| `capacity:config` | ✔ | — | — | — | — | — |
| `assignments:write` | ✔ | — (P5) | — | — | — | — |
| `holidays:read` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `holidays:write` | ✔ | — | — | — | — | — |

- COMMERCIAL solo recibe `capacity:read` y `holidays:read`, además de lo que la UI necesite para navegar.
- Claim de Entra: `Commercial` y `COMERCIAL` se mapean a `COMMERCIAL`.
- Helper `requirePermission(perm)` en `auth/guard.ts`: preHandler que usa `rolePermissions`. Lo usan todas
  las rutas de capacity, assignments y holidays.

---

## 5. Fase 2: exportación, reporte oficial y alertas (2026-10-15)

### 5.1 Esquema

```prisma
enum AlertType { ... CONSULTANT_UNDERUTILIZED }      // + valor (CONSULTANT_OVERLOADED ya existe)

CapacitySettings (+ campos):
  alertsEnabled       Boolean @default(true)
  alertHorizonMonths  Int     @default(3)      // mes en curso + (n-1) siguientes; 1..12
  digestEnabled       Boolean @default(true)
  digestWeekday       Int     @default(1)      // ISO: 1 = lunes … 7 = domingo
  digestHourUtc       Int     @default(13)     // 13 UTC = 08:00 en Bogotá/Quito
  digestLastSentAt    DateTime?

model CapacityReport {                         // reporte oficial, inmutable
  id               String   @id @default(cuid())
  title            String
  note             String?
  fromMonth        String                      // "YYYY-MM"
  toMonth          String
  includeProbables Boolean
  internal         String                      // "include" | "exclude"
  filters          Json                        // { country?, city?, company? } usados
  settings         Json                        // umbrales vigentes al publicar
  payload          Json                        // respuesta completa de /monthly con includeAssignments=true
  publishedBy      String
  publishedAt      DateTime @default(now())
  revokedAt        DateTime?                   // "anulado": no se borra, queda la marca
  revokedBy        String?
  revokeReason     String?
  @@index([publishedAt])
}
```

### 5.2 API

- **`GET /api/capacity/monthly?...&includeAssignments=true`** agrega a cada consultor
  `assignments: AssignmentDetail[]`, con la misma forma que §3.2. Sirve para exportar el detalle
  completo y para congelar el reporte.
- **Reportes oficiales**, en `/api/capacity/reports`:

| Ruta | Permiso | Notas |
|---|---|---|
| `POST /` | `capacity:publish` (solo ADMIN) | Recibe `{ title, note?, from, to, includeProbables, internal?, country?, city?, company? }`. El **servidor** calcula el payload, nunca lo recibe del cliente. Registra auditoría. Responde 201 con el reporte completo |
| `GET /?page&pageSize` | `capacity:read` | Lista paginada (`{ data, meta }`) **sin `payload`**: id, título, periodo, filtros, quién y cuándo publicó, y si está anulado |
| `GET /:id` | `capacity:read` | Reporte completo con su payload |
| `POST /:id/revoke` | `capacity:publish` | Recibe `{ reason }` (mínimo 5 caracteres) y lo marca como anulado. Responde 409 si ya estaba anulado. Registra auditoría |

  No hay `PUT` ni `DELETE`: un reporte publicado es inmutable.
- **Parámetros**: `GET/PUT /api/capacity/settings` incluye los campos nuevos. Se valida
  `alertHorizonMonths` entre 1 y 12, `digestWeekday` entre 1 y 7 y `digestHourUtc` entre 0 y 23.
- **Permiso nuevo**: `capacity:publish`, solo para ADMIN.

### 5.3 Alertas de capacity (job `capacity-alerts` en `TRABAJOS`)

Se ejecuta en cada ciclo de jobs si `alertsEnabled` está activo. Usa la carga y el cálculo de
`monthly.service` sobre los meses `[mes en curso UTC, + alertHorizonMonths − 1]`, con solo asignaciones
confirmadas (`includeProbables = false`) y los internos incluidos.

- Por cada consultor con país y cada mes del horizonte:
  - Si `status = OVER`, corresponde una alerta `CONSULTANT_OVERLOADED`, severidad `CRITICAL` si
    `pct > overPct + 20` y `WARNING` en otro caso.
  - Si `billableStatus = UNDER`, corresponde una alerta `CONSULTANT_UNDERUTILIZED`, severidad `WARNING`.
- Las alertas son **idempotentes**. La clave es `(type, consultantId, metadata.month)` entre las
  alertas sin resolver:
  - si la alerta ya existe, se actualizan `message` y `metadata` (pct, horas);
  - si existe pero la condición desapareció, o el mes ya salió del horizonte, se resuelve con
    `resolvedAt = now` y `resolvedBy = "system:capacity-alerts"`.
- `metadata` lleva `{ month, pct, billablePct, assignedHours, capacityHours }`.
- El mensaje va en español, por ejemplo: "Ana Pérez: 120 % asignado en nov-2026 (sobreasignado)".
- Un consultor sin capacidad en el mes (`pct = null`) no genera alerta.
- Las alertas de capacity solo las ven los roles con `capacity:read` (ver la ruta de alertas).

### 5.4 Resumen semanal por correo (job `capacity-digest`)

- **Cuándo**: se envía si `digestEnabled` está activo, si `ahora` (UTC) está en `digestWeekday` y
  `≥ digestHourUtc`, y si no se envió ya esa semana ISO. La marca es `digestLastSentAt`. Es el mismo
  patrón que `approval-digest`.
- **Destinatarios**: usuarios `active` con rol ADMIN o COMMERCIAL que tengan correo. Si no hay
  ninguno, no se envía y no se marca.
- **Contenido**:
  - utilización del equipo de cada mes del horizonte;
  - tabla de sobreasignados (consultor, mes, %);
  - tabla de subutilizados (consultor, mes, % facturable);
  - enlace a la app.
- **Seguridad del correo**: todo texto que venga del usuario se **escapa en el HTML** (nombres de
  consultores). Usa la utilidad de notificaciones existente; si SMTP no está configurado, se simula
  y se deja registro.
- **Prioridad de la marca**: el envío marca `digestLastSentAt` aunque la lista esté vacía, pero en
  ese caso no envía el correo y deja registro de que "no hubo novedades".

### 5.5 Exportación (frontend)

Se exporta la vista actual, o un reporte oficial abierto. Los datos salen de la respuesta con
`includeAssignments=true` o del `payload` del reporte.

- **Excel** (`xlsx`, carga dinámica). SheetJS CE **no escribe colores**, así que el estado va en texto.
  Nombre del archivo: `capacity_<from>_<to>.xlsx`, o `reporte-oficial_<id>.xlsx`. Hojas:
  - **Capacity**: consultor, país, ciudad, % de cada mes y del periodo, más la fila Equipo y las filas
    "# Sobreasignados" y "# Subutilizados", como en el Excel del cliente.
  - **Estado**: la misma matriz con el texto SOBRE / OK / SUB.
  - **Horas**: capacidad, asignadas y disponibles por mes.
  - **Detalle**: consultor, proyecto, cliente, certeza, interno, h/sem, horas por mes, total e incluida.
  - **Parámetros**: periodo, probables, internos, filtros, umbrales, fecha de generación, avisos y, si es
    oficial, título, quién lo publicó, cuándo y si está anulado.
- **PDF** (`jspdf` + `jspdf-autotable`, carga dinámica), en A4 horizontal:
  - **Encabezado**: título ("Informe de Capacity", o el título del reporte oficial), periodo, "Incluye
    probables / Solo confirmados", fecha de generación y, si corresponde, la marca **ANULADO** en rojo.
  - **KPIs** en una línea.
  - **Mapa de calor** con autoTable, cada celda **coloreada** según su `status` con los mismos colores
    de la app.
  - **Fila Equipo**.
  - **Gráfico** de utilización mensual dibujado con primitivas de jsPDF (columnas y líneas de umbral).
  - **Leyenda** con los umbrales.
  - **Avisos**.
  - **Detalle** por consultor en las páginas siguientes.
  - **Pie** con número de página.

Las funciones que arman los datos (filas, colores y nombres) son **puras** y van en
`features/capacity/export/`, con pruebas unitarias.
