# R15 — Aprobación semanal del timesheet

Contrato del cambio; fuente de verdad para todas las fases. Si el código lo contradice, gana este
documento (o se corrige aquí primero). Decisiones tomadas con Marcos Armas el 2026-11-05.
Construye sobre R14 (`R14-timesheet-tipos-y-tope.md`).

## 1. Problemas que resuelve

1. Un registro queda "Pendiente" desde que se guarda; no existe el acto de **entregar** la semana.
2. La aprobación es registro por registro, en una tabla plana sin agrupar por semana, proyecto ni
   consultor; el rechazo manda una nota fija ("No cumple criterio").
3. El consultor no se entera cuando le rechazan horas regulares (no hay correo ni aviso).
4. `ApprovalDelegation` existe pero ninguna ruta de aprobación la consulta.
5. Se puede cerrar un mes con horas sin aprobar: quedan fuera de las cifras y congeladas sin aviso.
6. Algunas cifras suman todas las horas sin importar el estado (`/stats/overview` `totalHours`,
   Informes, totales del timesheet).

## 2. Reglas de negocio

### 2.1 Estados

| Estado del registro | Significado |
|---|---|
| `PENDING` "Pendiente" | Editable por el consultor. Estado inicial y estado tras una devolución |
| `SUBMITTED` "Enviado" | Entregado al PM; nadie lo edita |
| `APPROVED` "Aprobado" | Cuenta en reportes, rentabilidad, EVM, nómina |
| `REJECTED` | Solo histórico (registros rechazados antes de R15). No se generan nuevos |

Un registro devuelto vuelve a `PENDING` y conserva `rejectionNote`, `rejectedBy`, `rejectedAt`
(visibles para el consultor hasta que vuelva a enviar).

### 2.2 Unidad de revisión

- **Semana** = lunes a domingo (fechas de calendario `workDate`).
- El consultor **envía la semana completa** (todos sus proyectos, incluido Ausencias).
- Cada PM **aprueba o devuelve su proyecto** dentro de esa semana: unidad de revisión =
  consultor + semana + proyecto (`TimesheetWeekReview`).
- Una semana enviada queda **bloqueada por completo** para el consultor: no edita, no borra, no
  agrega registros ni proyectos, el tracker no puede detenerse ni iniciarse en esa semana.
- Una **devolución reabre solo ese proyecto**: sus registros pasan a `PENDING`, el consultor los
  corrige (puede editar/agregar/borrar registros de ese proyecto en esa semana) y vuelve a enviar.
  Al reenviar solo viajan los proyectos devueltos.
- Lo aprobado no se reabre (si hace falta corregir algo aprobado, ADMIN lo borra/ajusta como hoy).

### 2.3 Validación al enviar (bloqueante)

- Cada **día laborable** de la semana (lunes a viernes, no festivo según `Holiday` país + ciudad,
  dentro de `[hireDate, exitDate]` del consultor) debe sumar **regular + ausencias ≥ jornada**
  vigente ese día (`resolverJornada`, misma tolerancia 1e-4 de R14).
- Si algún día no completa, el envío se rechaza con la lista de días y cuánto falta en cada uno.
- No se puede enviar una semana con días laborables futuros (se envía cuando ya transcurrió el
  último día laborable, o antes si todos los días ya están completos).
- No se envía si todos los proyectos ya están enviados/aprobados (nada que enviar).

### 2.4 Quién revisa

- Aprueba/devuelve el `projectManagerEmail` del proyecto **o su delegado vigente**
  (`ApprovalDelegation` con `fromUserEmail` = PM, fecha de la semana dentro de `[startDate,
  endDate]`), sea cual sea su rol.
- Nadie revisa sus propias horas. Si el PM es el mismo consultor, o el proyecto no tiene PM
  (p.ej. Ausencias sin PM asignado), revisa **ADMIN**.
- Los **excedentes** de horas extra (R14 §2.3) se aprueban dentro de la revisión semanal del
  proyecto; desaparece la bandeja aparte "Excedentes por aprobar".
- Las ausencias aprobadas siguen generando su `ConsultantBlock` (R14 §2.4) al aprobarse la semana.
- Devolver exige nota (mínimo 3 caracteres).
- **ADMIN puede enviar la semana en nombre del consultor** (para no bloquear el cierre de mes por
  un consultor ausente). Queda auditado con el actor. Aplica la misma validación de §2.3.
  Decisión del 2026-11-05: es exclusivo de ADMIN y está pensado para salidas imprevistas (renuncia,
  despido, calamidad). La aprobación sigue las reglas normales: si el proyecto tiene PM, aprueba el
  PM; si no tiene, el mismo ADMIN que envió puede aprobar.

### 2.5 Notificaciones

- Devolución: correo al consultor con proyecto, semana, nota y nombre del revisor (texto del
  usuario escapado). Además, aviso visible en el timesheet de esa semana.
- El resumen semanal de aprobaciones (`weekly-digest.job.ts`) cuenta semanas **enviadas** por PM
  (no pendientes sin enviar). La pantalla de aprobación muestra un contador en el menú.
- No hay correo inmediato al PM por cada envío.

### 2.6 Cierre de mes

- `MonthlySnapshot` de un proyecto no se puede crear si ese proyecto tiene en el mes registros
  `PENDING` o `SUBMITTED` (los `REJECTED` históricos no bloquean). La respuesta lista consultor,
  semana y horas pendientes.

### 2.7 Reportes

- Cifras oficiales (rentabilidad, EVM, portafolio, alertas, cierre, nómina, KPI de horas): solo
  `APPROVED` (ya era así salvo las excepciones de §1.6, que se corrigen).
- Vistas de horas (Informes, dashboard de horas, `/stats/overview`): muestran lo aprobado como
  cifra principal y aparte lo enviado y lo pendiente.
- Los totales del timesheet del propio consultor siguen mostrando todo lo que registró.

### 2.8 Decisiones de implementación (fase 2, `utils/timesheetWeek.ts`)

- Las horas EXTRA no completan la jornada; solo REGULAR + ABSENCE (no REJECTED), todos los proyectos.
- Día laborable siempre lunes–viernes (aunque `workDaysPerWeek` diga otra cosa), no festivo,
  dentro de `[hireDate, exitDate]` inclusive. Día sin jornada válida → error `NO_SCHEDULE`.
- Delegación: cubre la semana si algún día lunes–domingo cae en `[startDate, endDate]`.
- ADMIN no es comodín: si hay un PM distinto del consultor, solo ese PM o su delegado revisan.
  Si el PM es el propio consultor, revisa ADMIN y sus delegaciones no aplican.
- Un proyecto devuelto al que el consultor le borra todos los registros se cierra al reenviar.

## 3. Pantalla del PM: "Aprobación de horas"

- Entrada propia en el menú (Operación), visible para quien dirige algún proyecto, tiene una
  delegación vigente o es ADMIN; contador de semanas por revisar.
- Filtros: semana (por defecto la más antigua con pendientes), proyecto, consultor, estado.
- Tabla: una fila por consultor × proyecto × semana. Columnas: consultor, proyecto, Lun…Dom
  (horas del día en ese proyecto), total, estado, acciones (Aprobar / Devolver). Selección múltiple
  para aprobar varias filas.
- Fila expandible con los registros (tipo, franja, duración, descripción).
- Colores de novedades por celda/fila (con leyenda; nunca solo color — también icono/texto):
  horas extra, excedente, ausencias, trabajo en fin de semana/festivo, y día cuya suma total del
  consultor (todos los proyectos) supera la jornada por horas extra.
- Devolver abre un diálogo con nota obligatoria.

## 4. Fases

| # | Qué | Agente |
|---|---|---|
| 1 | Enum `SUBMITTED`, `TimesheetWeekReview`, campos de devolución en `TimeEntry`, migración idempotente | base-de-datos |
| 2 | Cálculo puro: semana, validación de envío, quién revisa (con delegación), agregación y novedades para la vista del PM | calculos-negocio |
| 3 | Endpoints de envío/revisión, bloqueos (time-entries, PUT /day, timer), cierre de mes, correo, digest, reportes | backend-fastify |
| 4 | Botón Enviar y avisos en timesheet/tracker, pantalla "Aprobación de horas", quitar bandeja de excedentes, reportes con pendientes | frontend-react |
| 5 | Pruebas de ruta y e2e, navegador, permisos | qa-pruebas, revisor-ui, revisor-seguridad |

## 5. Transición

- Registros `PENDING` existentes quedan `PENDING` (sin enviar); los `APPROVED` siguen aprobados;
  los `REJECTED` quedan como histórico.
- Los endpoints por registro `PATCH /api/time-entries/:id/approve|reject` dejan de usarse desde la
  UI; se mantienen solo para ADMIN (correcciones puntuales) o se retiran en la fase 3 (decidir allí
  y documentar).

### Decisiones de la fase 3 (backend)

- **`PATCH /api/time-entries/:id/approve|reject` se retiran para todos los roles** (`410`, código
  `ENDPOINT_RETIRED`; siguen tras `authenticate` + `authorize`). Dejarlos, aun solo para ADMIN,
  permitiría saltarse el envío y dejaría la revisión semanal incoherente; rechazar además creaba
  `REJECTED`, que ya no se genera. Para corregir algo aprobado, ADMIN borra el registro (se conserva
  su `DELETE` de registros no `PENDING`).
- **`GET /api/extra-hours/excess-pending`** se conserva devolviendo `{ data: [] }` (clientes antiguos);
  el excedente se decide dentro de la revisión semanal (filas con la novedad `EXCESS`).
- **Excedente en las listas**: `excessPendingHours` de `GET /api/extra-hours` cuenta `PENDING` y
  `SUBMITTED` (todo excedente aún no aprobado).
- **ADMIN no es comodín**: solo revisa proyectos sin PM o cuyo PM es el propio consultor
  (`resolveReviewer`). Un proyecto con PM lo revisan el PM o su delegado vigente.
- **Bloqueo**: un registro del proyecto P en la semana W solo se escribe si W no tiene ninguna
  `TimesheetWeekReview` o la de P está `RETURNED`; vale para todos los roles (PUT /day, POST, PATCH,
  DELETE, merge-task —que salta lo bloqueado y lo cuenta en `skippedWeekLocked`—, y el cronómetro).
  Única excepción: ADMIN borra registros que no están `PENDING`.
- **Cierre de mes**: `409` `PENDING_HOURS` si el proyecto tiene en el mes registros `PENDING` o
  `SUBMITTED`.
- **Informes**: `/api/stats/overview` devuelve `approvedHours`, `submittedHours` y `pendingHours` por
  proyecto y en `totals`; `totalHours` se conserva y equivale a `approvedHours`.

### Correcciones de la revisión de seguridad (fase 3)

- **Identidad por id, no por correo (H1)**: "es el propio consultor" se decide con `authUser.consultantId`
  o `Consultant.userId` (el correo de la ficha puede ser null o distinto); "el PM es el consultor" con el
  correo del `User` enlazado a la ficha. `resolveReviewer` recibe `actorIsConsultant` y
  `projectManagerIsConsultant`; la comparación de correos queda como respaldo. El digest aplica lo mismo.
- **PM del proyecto (H2)**: solo ADMIN cambia `projectManagerEmail` (`PM_CHANGE_FORBIDDEN`); un PM solo
  edita proyectos que dirige (`NOT_PROJECT_MANAGER`) y al crear solo puede ponerse a sí mismo o dejarlo
  vacío. Solo ADMIN cambia el `email` de una ficha de consultor (`EMAIL_CHANGE_FORBIDDEN`; si un no
  ADMIN omite el correo, se conserva).
- **Borrados (H3, H4)**: borrar un registro no `PENDING` exige ADMIN y solo si está `APPROVED` (con el
  candado de la semana); uno `SUBMITTED` no se borra (409 `WEEK_LOCKED`).
- **merge-task (H5)**: una sola transacción con el candado de cada semana tocada.
- **Cierre de mes (H6)**: candado de aviso por proyecto + mes que toman el cierre y toda escritura de
  horas (guardar, borrar, cronómetro, enviar, aprobar, devolver; orden semana, mes, día). El cierre
  recomprueba bajo el candado y, si las horas cambiaron mientras calculaba, responde 409 `MONTH_CHANGED`.
- **Revisiones atascadas (H7)**: `POST /submit` rechaza con 400 `MONTH_CLOSED` los proyectos con horas
  pendientes en un mes ya cerrado. Lo que ya estuviera `SUBMITTED` en un mes cerrado antes de este
  cambio lo resuelve ADMIN (borra o ajusta los registros / reabre el cierre); aprobar y devolver siguen
  respetando el cierre.
- **Menores**: la nota de devolución admite como máximo 1000 caracteres; la bandeja y el contador
  filtran por revisor antes de aplicar el tope; el correo del digest habla de "semanas enviadas" y
  apunta a "Aprobación de horas".
