# R14 — Timesheet: tipos de hora, tope por jornada e integración con horas extra

Contrato del cambio. Es la fuente de verdad para las cinco fases; si algo del código contradice
este documento, gana el documento (o se corrige aquí primero).

Decisiones de negocio tomadas con Marcos Armas el 2026-11-04.

## 1. Problemas que resuelve

1. Hoy **no hay ningún tope diario**: ni `POST/PATCH /api/time-entries` ni `POST /api/timer/stop`
   validan horas por día, fines de semana ni festivos.
2. Las horas extra del timesheet no se distinguen de las regulares y no tienen relación con el
   módulo de horas extra (`ExtraHourEntry` no conoce a `TimeEntry`).
3. El modal "Editar tiempo" es un formulario apilado ("Registro 1", "Registro 2", "+ Agregar"),
   incómodo para quien registra en varios proyectos, y guarda con varias llamadas sueltas: si una
   falla, el día queda guardado a medias.

## 2. Reglas de negocio

### 2.1 Tipos de hora (catálogo configurable)

Catálogo `TimeEntryType`, editable por ADMIN. Cada tipo tiene una **categoría** fija que es lo
que el código interpreta; el nombre es libre.

| Categoría | Semilla | Significado |
|---|---|---|
| `REGULAR` | Horas Regulares (por defecto) | Cuenta contra la jornada |
| `EXTRA` | Horas Extras | Solo con solicitud de horas extra aprobada; no cuenta contra la jornada |
| `ABSENCE` | Permiso, Vacaciones | Cuenta contra la jornada; solo en el proyecto interno de Ausencias |

- Los tipos de semilla tienen un `code` estable (`REGULAR`, `EXTRA`, `PERMISO`, `VACACIONES`):
  se pueden renombrar y reordenar, no borrar ni cambiar de categoría. `REGULAR` no se puede desactivar.
- Los tipos nuevos se desactivan en vez de borrarse si ya tienen registros (patrón `FinancialCategory`).
- Todo `TimeEntry` existente queda como `REGULAR`.
- Un tipo `ABSENCE` declara a qué `BlockType` corresponde (Vacaciones → `VACATION`, Permiso → `OTHER`).

### 2.2 Tope diario

- **Regular + Ausencias** de un consultor en un día, **sumando todos los proyectos** y excluyendo
  `REJECTED`, no puede superar `hoursPerDay` de su jornada vigente ese día.
- La jornada sale **solo** de `CapacityConfig` vía `resolverJornada` (consultor → país → general),
  con su vigencia por fecha. Hoy: Colombia 8 → 8.4 desde 2026-07-15, Ecuador 8. Nada hardcodeado.
- Fines de semana y festivos (`Holiday`, país + ciudad del consultor): horas `REGULAR` solo si
  `Consultant.allowWeekendWork`; si no, solo `EXTRA` con solicitud aprobada.
- Lo valida **siempre el servidor**: celda del grid, modal, tracker. El frontend solo anticipa.

### 2.3 Flujo de horas extra

1. **Solicitud presupuestada**: el consultor crea la solicitud en el módulo de horas extra con el
   peor escenario (fecha, proyecto, franja). El monto se calcula como hoy. Sin cambios de flujo.
2. **Aprobación del PM** (aprobación única, `projectManagerEmail`): habilita el tipo `EXTRA` en el
   timesheet para ese consultor, proyecto y día. **Saldo** = Σ `totalHours` de las solicitudes
   aprobadas de ese día y proyecto.
3. **Registro real** en el timesheet con tipo `EXTRA`. Exige `startedAt`/`endedAt` (el recargo
   diurno/nocturno/festivo depende de la franja). Queda vinculado a la solicitud (`extraHourEntryId`).
4. **Excedente**: si lo registrado supera el saldo, el servidor parte el registro en el límite y
   la parte de más queda como un `TimeEntry` `EXTRA` con `isExcess = true`. El PM del proyecto lo
   aprueba o rechaza (aparece en "Aprobaciones" de horas extra); se usa la aprobación normal del
   `TimeEntry`, restringida al `projectManagerEmail` cuando `isExcess`.
5. **Nómina paga lo real**: `GET /api/extra-hours/payroll` pasa a calcularse sobre los `TimeEntry`
   `EXTRA` `APPROVED` (incluidos los excedentes aprobados), aplicando `calculateExtraHours` a su
   franja real convertida a hora local del país. La solicitud queda como presupuesto: el módulo
   muestra **aprobado vs. real**.

Sin solicitud aprobada no se pueden registrar horas `EXTRA` (400).

**Separación de funciones (decisión de negocio, 2026-11-04).** La solicitud y el registro real de
horas extra los hace SOLO el consultor dueño; la aprobación sigue siendo del PM del proyecto (nunca
de lo propio).

- `POST /api/extra-hours`: el `consultantId` es el de `authUser.consultantId` para TODOS los roles,
  ADMIN y PM incluidos. Omitirlo usa el propio; enviar otro responde 403 "Las horas extra solo las
  puede solicitar el propio consultor."; un usuario sin ficha de consultor recibe 400. Se eliminó la
  excepción de ADMIN/PM para fechas pasadas: nadie solicita para días anteriores al actual.
- `PUT /api/time-entries/day`, `POST /` y `PATCH /:id`: si se crea, modifica o borra una fila de
  categoría EXTRA de otro consultor, 403 "Las horas extra solo las puede registrar el propio
  consultor." Las filas REGULAR/ABSENCE conservan la regla anterior (ADMIN/PM imputan a otros). En
  `PUT /day` una fila EXTRA ajena reenviada idéntica (id, tipo, horas con tolerancia 1e-4, franja y
  descripción/nota si vienen) no cuenta como cambio; omitirla equivale a borrarla y se bloquea.
- `POST /api/timer/stop`: si ADMIN/PM detienen el cronómetro de otro y la partición produce algún
  tramo EXTRA/excedente, 403 sin crear nada y el cronómetro sigue en marcha (debe detenerlo su
  dueño). Si no hay tramos EXTRA, el comportamiento no cambia.

### 2.4 Ausencias

- Proyecto interno **"Ausencias"** (marca en `Project`), visible para todos los consultores en el
  timesheet sin necesidad de asignación. Los tipos `ABSENCE` solo se aceptan en ese proyecto, y ese
  proyecto solo acepta tipos `ABSENCE`.
- Siguen la aprobación normal de horas (PM del proyecto Ausencias o ADMIN).
- Al aprobarse, si las ausencias del día cubren la jornada completa, se crea el `ConsultantBlock`
  del `BlockType` del tipo, vinculado al registro; si se borra, el bloque se elimina (una ausencia
  ya aprobada no se puede rechazar, igual que cualquier hora aprobada; solo ADMIN/PM la borran).
  Los permisos parciales no bloquean capacidad.

### 2.5 Tracker al detenerse

El servidor divide la franja automáticamente, en orden cronológico:

1. Hasta completar la jornada (considerando lo ya registrado ese día) → `REGULAR`.
2. Lo que sobra, si hay solicitud aprobada → `EXTRA` hasta el saldo; lo que pase del saldo →
   `EXTRA` con `isExcess`.
3. Si no hay solicitud aprobada → se guarda solo hasta el tope y la respuesta informa cuánto quedó fuera.

### 2.6 Decisiones de implementación (fase 2, `utils/timesheetRules.ts`)

- Tolerancia de comparación con el tope: 1e-4 h (0.36 s); un segundo por encima siempre se detecta.
- Los registros ya aprobados solo cuentan para el tope, no se revalidan; si solo lo aprobado ya
  supera el tope, no bloquea guardar otras cosas ese día.
- Ausencias en fin de semana o festivo sin `allowWeekendWork`: se rechazan, igual que REGULAR.
- En un registro EXTRA, `hours` debe coincidir con la franja inicio–fin (lo que se paga es la franja).
- Nómina: una franja que cruza medianoche **no** se parte por día local (así se calcula igual que la
  solicitud); `calculateExtraHours` ya maneja fin < inicio.
- Aprobador de Ausencias: ADMIN, o el `projectManagerEmail` del proyecto si se le asigna.
- El límite semanal y el pool de México en `calculateExtraHours` siguen leyendo `ExtraHourEntry`
  (solicitudes), no los registros reales.

## 3. Contratos de API (fase 3)

| Endpoint | Qué hace |
|---|---|
| `GET /api/time-entry-types` | Catálogo (activos por defecto; `?all=true` para admin) |
| `POST/PATCH/DELETE /api/time-entry-types[/:id]` | CRUD, permiso nuevo `time:types` (ADMIN) con `requirePermission` |
| `GET /api/time-entries/day-summary?consultantId&from&to` | Por día: jornada, regular+ausencias usadas (todos los proyectos), festivo/fin de semana permitido, y por proyecto saldo `EXTRA` aprobado y usado |
| `PUT /api/time-entries/day` | `{ projectId, consultantId?, workDate, entries: [{ id?, typeId, hours, startedAt?, endedAt?, description? }] }`. Reemplaza en **una transacción** los registros `PENDING` de ese día y proyecto (los no `PENDING` no se tocan). Valida todo lo de §2, aplica la partición de excedente y devuelve los registros resultantes + el resumen del día. Errores 400 con el índice de la fila culpable |
| `POST/PATCH /api/time-entries` | Mismas validaciones; `typeId` opcional (por defecto `REGULAR`) |
| `POST /api/timer/stop` | Partición de §2.5; respuesta incluye los registros creados y las horas descartadas |

Se respetan: candado de `MonthlySnapshot`, `writeAudit`, `resolveTargetConsultantId`, `{ data }`.

## 4. Frontend (fase 4)

- El **modal "Editar tiempo" se mantiene** (se abre desde ⋮, encabezado fecha + proyecto, pie
  Cancelar/Guardar). Lo que se reemplaza es el formulario apilado por una **tabla editable**:
  columnas Tipo · Inicio · Fin · Duración · Descripción · eliminar.
- Siempre hay una fila vacía al final; escribir en ella crea un registro (desaparece "+ Agregar").
- Teclado: Tab/Shift+Tab entre celdas, Enter baja a la fila siguiente, Ctrl+Supr elimina la fila,
  Ctrl+Enter guarda, Esc cierra. El tipo se elige tecleando.
- Filas no `PENDING`: visibles, solo lectura, con su estado.
- Pie de la tabla: día en todos los proyectos `usado / jornada` regular y `usado / aprobado` extra.
  `EXTRA` solo aparece en el selector si hay saldo aprobado ese día.
- Guardar = una sola llamada a `PUT /api/time-entries/day`; los errores se marcan en su fila.
- La celda del grid sigue siendo tecleable cuando tiene 0 o 1 registro `PENDING` de tipo `REGULAR`.
- Pantalla de administración del catálogo de tipos y vista aprobado vs. real en horas extra.

## 5. Fases

| # | Qué | Agente |
|---|---|---|
| 1 | Esquema y migración idempotente | base-de-datos |
| 2 | Cálculo puro con pruebas | calculos-negocio |
| 3 | Endpoints y validaciones | backend-fastify |
| 4 | Modal con tabla, catálogo, vista aprobado vs. real | frontend-react |
| 5 | Pruebas de ruta, navegador, permisos | qa-pruebas, revisor-ui, revisor-seguridad |

## 5.1 Decisiones tomadas al cerrar R14 (2026-11-05)

1. **Borrado de horas ajenas: solo ADMIN.** Cada quien borra las suyas (PENDING, semana no bloqueada).
   Borrar horas de otro consultor, de cualquier tipo, exige ADMIN: aplica a `DELETE /api/time-entries/:id`
   y a `PUT /day` cuando omite filas PENDING de otro (equivale a borrarlas). El PM no borra: si algo está
   mal, devuelve la semana con una nota o lo gestiona con el consultor. La edición (PUT/PATCH) no cambia.
2. **Capacity y ausencias.** La proyección sigue sin descontar ausencias (`capacity/PLAN.md` D4). Más
   adelante habrá un comparativo "Capacidad real (capacidad − ausencias) vs Ejecutado". Por eso **ejecutado
   = horas trabajadas**: las horas de categoría ABSENCE no entran a costo, EVM, utilización ni totales de
   horas (se exponen aparte como `absenceHours`). Siguen contando para la jornada: tope diario, envío
   semanal y "Jornada sin cargar".
3. **El cronómetro no registra horas extra.** Solo guarda REGULAR hasta el tope de la jornada (descontando
   lo ya registrado ese día); todo lo que sobre se descarta siempre, haya o no solicitud aprobada, y la
   respuesta lo informa (`discardedHours`, `discardedFrom`, `discardedTo`). Si eran horas extra, el
   consultor las registra a mano en el timesheet. Esto reemplaza el punto 2 de §2.5 y el 403 por tramos EXTRA
   del cronómetro ajeno de §2.3.

## 6. Fuera de alcance

- Detección de solapamiento de franjas entre registros.
- Migrar horas extra antiguas (`ExtraHourEntry` aprobadas sin `TimeEntry`): la nómina de meses ya
  cerrados no se recalcula; para meses abiertos, ver nota de transición en la fase 3.
