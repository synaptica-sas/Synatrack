# R9 — Auditoría completa de escrituras y homologación de `entity`

Rama: `feat/auditoria-completa` (sale de `dev`). Sin commits: los cambios quedan en el árbol de
trabajo.

Cierra los puntos **9** (auditoría parcial) y **10** (nomenclatura inconsistente de `entity`) de
`DOCUMENTACION_TECNICA.md` §10.2, y el punto 6 de la deuda técnica de `CLAUDE.md` §7.

Disparador concreto: acaba de entrar en producción la **doble aprobación de horas extra**, que es
nómina. Hasta ahora la pregunta "¿quién aprobó este pago y cuándo?" no tenía respuesta en la base
de datos, porque `writeAudit` solo se invocaba desde 7 de los 22 módulos.

---

## 1. Qué quedó auditado

`writeAudit` se llamaba desde `assignments`, `delegations`, `forecasts`, `change-requests`,
`project-detail`, `projects` y `snapshots`. Se añaden **11 módulos más**, en el orden de impacto
pedido:

| Módulo | Entidad | Operaciones auditadas | Acciones |
|---|---|---|---|
| `extra-hours` | `extraHourEntry` | crear, aprobar nivel 1 (PM), aprobar nivel 2 (Finanzas), rechazar, eliminar | `CREATE`, `APPROVE` ×2, `REJECT`, `DELETE` |
| `time-entries` | `timeEntry` | crear, aprobar, rechazar, eliminar | `CREATE`, `APPROVE`, `REJECT`, `DELETE` |
| `expenses` | `expense` | crear, editar, eliminar | `CREATE`, `UPDATE`, `DELETE` |
| `revenue` | `revenueEntry` | crear, editar, eliminar | `CREATE`, `UPDATE`, `DELETE` |
| `consultants` | `consultant` | crear, editar, eliminar (por id **y** por nombre) | `CREATE`, `UPDATE`, `DELETE` ×2 |
| `admin/users` | `user` | crear, editar | `CREATE`, `UPDATE` |
| `activities` | `activity` | crear, editar, eliminar | `CREATE`, `UPDATE`, `DELETE` |
| `estimations` | `estimation` | crear, eliminar | `CREATE`, `DELETE` |
| `alerts` | `alert` | resolver | `UPDATE` |
| `capacity/blocks` | `consultantBlock` | crear, eliminar | `CREATE`, `DELETE` |

**Los dos niveles de la aprobación de horas extra escriben un registro cada uno.** Es la diferencia
entre saber que "alguien la aprobó" y poder distinguir la aprobación **operativa** del PM de la
**autorización de pago** de Finanzas. El `diff` del nivel 2 incluye `approvedBy`, que es la columna
que alimenta el cierre de nómina.

### Criterios aplicados en todos los casos

- **`changedBy` sale siempre de `request.authUser!.email`**, nunca del cuerpo. En `extra-hours`,
  `time-entries` y `activities` se reutiliza la variable `email`/`revisor` que el handler ya
  derivaba del token (R5 la introdujo precisamente para que `approvedBy` no fuera falsificable);
  la auditoría usa la misma fuente, no una paralela.
- **Se pasa `request`** en todas las llamadas, así que cada fila lleva `ipAddress` y `userAgent`.
- **En ediciones se registran `before` y `after`**, tomados de la fila que el handler ya leía para
  validar (`existing`), de modo que `computeDiff` produzca un `diff` real campo a campo. No se
  añadió ni una consulta extra a la base por este motivo, salvo en `admin/users` (ver abajo).
- **No se tocó ningún `authorize([...])`** ni el alcance de datos de ninguna ruta. Las respuestas
  HTTP son idénticas: mismos códigos, mismos cuerpos.

### Caso especial: `admin/users`

El `findUnique` previo del `PATCH` no traía los roles, así que el `before` no habría podido mostrar
el cambio de permisos — que es justamente lo que interesa auditar aquí. Se le añadió
`include: { roles: { include: { role: true } } }` y se introdujo `instantaneaUsuario()`, que aplana
los roles a un arreglo de nombres ordenado. El `diff` queda legible
(`roles: ["CONSULTANT"] -> ["ADMIN"]`) en vez de una lista de filas `UserRole` con ids opacos.
Es una consulta marginalmente más cara en un endpoint de administración de bajo tráfico.

---

## 2. Un fallo de auditoría no puede tumbar la operación de negocio

`writeAudit` ahora **nunca lanza**: el cuerpo entero va en un `try/catch` que registra el error con
`request.log.error` (o `console.error` si no hay request) y sigue.

El razonamiento: la escritura de negocio ya se confirmó cuando se llama a `writeAudit`. Si el
`INSERT` en `AuditLog` falla —la tabla no existe todavía en un entorno, la base rechaza la conexión,
el `payload` trae algo no serializable— propagar la excepción produciría un **500 sobre una
operación que en realidad sí ocurrió**. El usuario reintentaría y duplicaría horas extra, o daría
por rechazada una aprobación que quedó aplicada. Y el registro de auditoría se habría perdido
igualmente: fallar ruidosamente no lo recupera, solo añade un segundo problema encima del primero.

Se resolvió dentro de `writeAudit` y no en cada llamador, así que los 7 módulos que ya auditaban
quedan cubiertos por el mismo criterio sin tocarlos.

**Lo que esto cuesta**, dicho explícitamente: una escritura puede quedar sin rastro y el único
aviso será una línea de nivel `error` en el log del servidor. Queda anotado como riesgo en §5.

---

## 3. Tarifas de consultor en el log de auditoría: sí, a propósito

El `before`/`after` de un consultor incluye `hourlyRate` y `costPerMonth`.

**Se dejan.** La tarifa es exactamente el dato que se quiere auditar: cambiarla recalcula todos los
costos, márgenes y métricas EVM del portafolio hacia atrás, y sin el `diff` no hay forma de explicar
por qué la rentabilidad de un proyecto cambió sin que cambiara ninguna hora. Un log de auditoría de
consultores que omitiera la tarifa no auditaría nada relevante.

No abre ninguna vía nueva de fuga: `GET /api/audit` está restringido a `ADMIN`, `FINANCE` y `PM`,
que son **los mismos tres roles** que `puedeVerTarifas()` autoriza a ver `hourlyRate` en
`GET /api/consultants` (DEP-38, cerrado en R7). Un `CONSULTANT` o un `VIEWER` no alcanzan el
endpoint de bitácora.

La decisión queda escrita como comentario junto a las dos llamadas de `consultants.routes.ts`, para
que no se "limpie" por precaución en una revisión futura.

---

## 4. Nomenclatura de `entity` y el histórico de producción

### La decisión

Se homologa a **camelCase con minúscula inicial**, que ya usaba la mayoría (`assignment`,
`changeRequest`, `monthlySnapshot`, `approvalDelegation`) y coincide con el nombre del modelo de
Prisma en su forma de propiedad (`prisma.timeEntry`, `prisma.extraHourEntry`). Se corrigieron los
dos desviados: `"Project"` → `project` (3 sitios en `projects.routes.ts`) y `"Forecast"` →
`forecast` (2 sitios en `forecasts.routes.ts`).

Para que no vuelva a pasar, `writeAudit` ya no acepta `entity: string`: acepta `AuditEntity`, una
unión derivada del catálogo `AUDIT_ENTITIES` de `utils/audit.ts`. **Un módulo nuevo que invente una
variante ahora lo caza `tsc`, no una consulta en producción seis meses después.**

### El histórico: no se migra, se hace transparente en la consulta

En producción ya hay filas con `entity = "Project"` y `entity = "Forecast"`. **No se migran.**

Razones:

1. `AuditLog` es un registro de auditoría. Reescribir filas de una bitácora para que "se vean
   bonitas" es precisamente lo que una bitácora no debería permitir: el valor que se escribió en su
   momento es parte del hecho registrado. Un `UPDATE` masivo sobre ella deja la tabla sin poder
   afirmar que es inmutable.
2. El problema real no era el valor almacenado, sino que **filtrar perdía registros**. Eso se
   arregla en el punto de lectura, que es donde duele, y sin tocar un solo dato.
3. La migración tampoco es gratis: es un `UPDATE` sobre la tabla que más crece del sistema, contra
   Supabase, en un entorno donde la migración `20260918120000_fix_schema_drift` **todavía no se ha
   aplicado** (ver `CLAUDE.md` §7.1). No es el momento de añadirle escrituras masivas.

En su lugar, `GET /api/audit` resuelve el alias al filtrar: `variantesDeEntidad("project")` devuelve
`["project", "Project"]` y la consulta usa `entity: { in: [...] }`. **Filtrar por `project` devuelve
el histórico completo, antes y después del corte.** Lo mismo con `forecast`. El mapa de alias vive
en `ALIAS_HISTORICOS_ENTIDAD`, en `utils/audit.ts`, junto al catálogo.

Hay una prueba de ruta que inserta a mano una fila con `entity: "Project"` y comprueba que el filtro
`?entity=project` la devuelve. Si alguien "simplifica" el filtro quitando el alias, la prueba falla.

**El corte queda documentado aquí**, que era la condición: nadie tiene que descubrir por su cuenta
que el histórico está partido, porque desde la API ya no lo está.

---

## 5. Lo que NO se hizo, y los riesgos que quedan

### Segunda pasada: huecos cerrados (2026-10-15)

Lo que arriba figuraba como "no auditado" ahora sí lo está, salvo lo indicado en "Sigue sin auditarse".

| Área | Entidad | Qué queda registrado |
|---|---|---|
| `timer` POST /stop | `timeEntry` | CREATE de las horas que nacen del cronómetro (`after.origen = "cronometro"`), con el correo del token |
| `extra-hours` PUT /config/:country y POST /config/:country/reset | `extraHoursConfig` | CREATE/UPDATE con before/after de multiplicadores y divisor mensual |
| `fx` PUT, DELETE, POST /sync | `fxConfig` | CREATE/UPDATE/DELETE. La sincronización solo escribe si la tasa cambió; actor = correo si la dispara un usuario, `sistema:fx-sync` si es el cron con token |
| `milestones` (5 escrituras) | `milestone` | CREATE, UPDATE (editar/estado), COMPLETE, DELETE |
| `risks` (4) | `risk` | CREATE, UPDATE (editar/estado), DELETE |
| `issues` (4) | `issue` | CREATE, UPDATE (editar/resolver), DELETE |
| `project-detail` PATCH health / completion / phase | `project` | UPDATE con before/after del campo |
| `forecasts` DELETE | `forecast` | DELETE |
| `change-requests` POST y DELETE | `changeRequest` | CREATE, DELETE |
| `alerts` POST /run | `alert` | quién forzó la ejecución manual (`entityId = "motor-alertas"`) |
| Login / aprovisionamiento JIT (`auth/guard.ts`) | `user`, `consultant` | CREATE al crear el usuario/consultor; UPDATE de roles solo si cambiaron (before/after); actor `sistema:entra-id` |
| Inicio de sesión | `user` | action `LOGIN`, ver abajo |

**LOGIN.** No hay endpoint de login (la sesión la emite Entra ID) y `authenticate` corre en cada
petición, así que no se registra ahí. El frontend llama a `GET /api/auth/me` al arrancar
(`App.tsx`), y ese es el punto elegido (`registrarLogin` en `utils/audit.ts`). Como `/me` también se
llama en cada recarga de página, hay un umbral de **8 horas** (`UMBRAL_LOGIN_HORAS`): si ya existe un
LOGIN del mismo usuario **con la misma IP y el mismo user-agent** en esa ventana no se escribe otro; si
el origen cambia (otro equipo o navegador con el mismo token) sí queda un LOGIN nuevo. Usa el índice
`(entity, entityId)` y ninguna columna nueva. `changedBy` es el correo del usuario. En modo demo también
se registra (con la identidad simulada) y el umbral evita el ruido.

**Alcance de LOGIN:** significa "arranque de sesión en la UI" (la llamada a `GET /api/auth/me`), no
control de acceso al API. Quien use un token directamente contra otros endpoints sin pasar por `/me` no
genera LOGIN; esta marca no sirve para reconstruir accesos al API.

**Visibilidad en `GET /api/audit`:** `ipAddress`, `userAgent` y los registros `LOGIN` solo los ve ADMIN;
PM y FINANCE reciben la bitácora sin esos datos. Los cambios de rol (`entity=user`) siguen visibles para
PM/FINANCE (decisión por defecto). Filtro opcional `action` (una o varias, separadas por coma); para
no-ADMIN, `action=LOGIN` devuelve vacío.

**Actor de procesos sin usuario:** `sistema:<nombre>` (`sistema:entra-id`, `sistema:fx-sync`).

### Sigue sin auditarse, a propósito

- **`RunningTimer` (start / patch / delete del cronómetro):** estado efímero que cambia decenas de
  veces al día. Lo que tiene consecuencia económica es el `TimeEntry` del stop, y ese sí queda.
- **`POST /extra-hours/calculate`:** verificado, es solo cálculo; no escribe.
- **Alertas auto-generadas por `alerts.service.ts`:** serían decenas por ejecución sin un actor
  legítimo; cada alerta ya lleva `createdAt`/`resolvedAt`. Solo se audita la resolución manual y la
  ejecución manual del motor.
- **`feedback`, `profile` (preferencias del propio usuario), `jobs/run` (ya deja `JobRun`) y
  `holidays`, `capacity/config`:** fuera de alcance de esta pasada.
- Observación: `GET /extra-hours/config/:country` puede crear la configuración por defecto dentro de un
  GET; es una escritura en lectura que se deja anotada, no se tocó.

- **Una fila de auditoría puede perderse en silencio** si el `INSERT` falla (§2). Solo queda
  constancia en el log del servidor. Mitigación pendiente: una alerta de operación sobre esa línea
  de log, o un contador de fallos expuesto en `/health`.
- **La auditoría no es transaccional con la operación.** Se escribe después del `commit` de Prisma,
  no dentro de la misma transacción. Si el proceso muere justo en medio, la operación queda hecha y
  sin rastro. Meterla en la transacción sería lo correcto en teoría, pero volvería a hacer que un
  fallo de auditoría tumbe el negocio — es el intercambio del §2, resuelto a favor de la operación.
- **La bitácora no tiene retención ni purga.** Con `before`/`after` completos de cada escritura
  crecerá bastante más rápido que antes. `GET /api/audit` ya pagina (es el único endpoint que lo
  hace), pero no hay política de archivado. Conviene vigilar el tamaño de la tabla en Supabase.
- **El frontend no muestra la bitácora nueva de forma diferenciada.** La pantalla de auditoría
  existente lista todo por igual; no se le añadió un filtro por entidad con los nombres nuevos.
  Fuera del alcance de este cambio, que es de backend.

---

## 6. Verificación

| Comprobación | Antes | Después |
|---|---|---|
| `npx tsc --noEmit` | limpio | **limpio** (sin salida, exit 0) |
| `npm test` (unitarias) | 153 | **153** — sin cambios, no se tocó `src/utils` salvo `audit.ts`, que no tenía pruebas unitarias |
| `npm run test:routes` | 63 | **69** (+6) |

> Nota: el encargo mencionaba 159 unitarias y 72 de ruta. Los conteos reales medidos en esta rama
> antes de tocar nada son **153** y **63**. No se maquilló ninguno de los dos.

Las 6 pruebas nuevas están en `backend/tests/routes/auditoria-escrituras.test.ts` y no se limitan a
comprobar que exista una fila:

1. **Crear horas extra** → `CREATE` con `changedBy` = correo del token y `entity = "extraHourEntry"`.
2. **Los dos niveles de aprobación de horas extra** → exactamente 2 filas `APPROVE`, con el `diff`
   de cada transición de estado (`PENDING_PM → PENDING_FINANCE` y `PENDING_FINANCE → APPROVED`) y
   `approvedBy` en el diff del nivel 2.
3. **Rechazar horas extra** → `REJECT` con el motivo en el `diff`.
4. **Crear y aprobar horas** → `CREATE` y `APPROVE` sobre `entity = "timeEntry"`, con el `diff` de
   `status` y `approvedBy`.
5. **Editar un consultor** → `UPDATE` con `hourlyRate: 40 → 55` en el `diff`.
6. **`GET /api/audit`** → filtrar por `entity=project` devuelve también una fila escrita a mano con
   la nomenclatura vieja `"Project"`.

---

## 7. Archivos tocados

```
backend/src/utils/audit.ts                              catálogo AUDIT_ENTITIES, alias, no-lanza
backend/src/modules/audit/audit.routes.ts               filtro por entidad consciente de alias
backend/src/modules/extra-hours/extra-hours.routes.ts   5 llamadas
backend/src/modules/time-entries/time-entries.routes.ts 4 llamadas
backend/src/modules/expenses/expenses.routes.ts         3 llamadas
backend/src/modules/revenue/revenue.routes.ts           3 llamadas
backend/src/modules/consultants/consultants.routes.ts   4 llamadas
backend/src/modules/admin/users.routes.ts               2 llamadas + instantaneaUsuario()
backend/src/modules/activities/activities.routes.ts     3 llamadas
backend/src/modules/estimations/estimations.routes.ts   2 llamadas
backend/src/modules/alerts/alerts.routes.ts             1 llamada
backend/src/modules/capacity/blocks.routes.ts           2 llamadas
backend/src/modules/projects/projects.routes.ts         "Project" -> project
backend/src/modules/forecasts/forecasts.routes.ts       "Forecast" -> forecast
backend/src/modules/projects/change-requests.routes.ts  constantes del catálogo
backend/src/modules/projects/project-detail.routes.ts   constantes del catálogo
backend/src/modules/assignments/assignments.routes.ts   constantes del catálogo
backend/src/modules/delegations/delegations.routes.ts   constantes del catálogo
backend/src/modules/snapshots/snapshots.routes.ts       constantes del catálogo
backend/tests/routes/auditoria-escrituras.test.ts       nuevo, 6 pruebas
documentacion/cambios/R9-auditoria.md                   este documento
```

## Columnas de trazabilidad: `createdBy` / `updatedBy`

Además de la bitácora (`AuditLog`), 32 modelos llevan `createdAt`, `updatedAt`,
`createdBy` y `updatedBy` (email del actor). **Los handlers no las escriben**: se
llenan solas.

**Cómo funciona**

1. `src/infra/actorContext.ts`: un `AsyncLocalStorage` con un almacén mutable
   `{ actor }`. Un hook global `preHandler` (`app.ts`) abre un almacén por petición con
   `als.run(..., done)`; `authenticate` lo rellena con el email validado (también en modo
   demo, con la identidad simulada). Se usa `preHandler` y no `onRequest` porque tras leer
   el cuerpo de la petición el contexto asíncrono puede perderse.
2. `src/infra/prisma.ts`: el cliente exportado es `PrismaClient.$extends({ query })`. La
   extensión consulta `Prisma.dmmf` para saber qué modelos tienen las columnas (no hay
   lista a mano) y, vía `src/infra/actorStamp.ts` (lógica pura, con test), aplica:
   `create`/`createMany`/`createManyAndReturn` -> `createdBy` y `updatedBy`;
   `update`/`updateMany`/`updateManyAndReturn` -> `updatedBy`; `upsert` -> `create` con
   ambos y `update` con `updatedBy`. Nunca pisa un valor explícito (por eso `Milestone`,
   `Issue` y `Risk`, con `createdBy` obligatorio, siguen funcionando) y sin actor no toca nada.
3. Tipos: el cliente extendido no es un `PrismaClient`. Se exporta `DbClient = typeof prisma`
   y los helpers (`writeAudit`, jobs, servicios) lo usan en lugar de `PrismaClient`.
4. Trabajos periódicos: `jobs.service.ts` ejecuta cada trabajo con
   `runWithActor("sistema:<nombre>")`; si un usuario dispara el ciclo con
   `POST /api/jobs/run` se conserva su correo. `runFxSync` usa su propio actor
   (`sistema:fx-sync` o el usuario) y el arranque de `server.ts` usa `sistema:arranque`.
   El aprovisionamiento JIT de `authenticate` escribe como `sistema:entra-id`.

**Qué no cubre**

- Escrituras **anidadas** (`data: { hijos: { create: ... } }`): la extensión solo ve la
  operación de nivel superior. Se revisó el código y hoy no existe ninguna sobre tablas con
  estas columnas; si aparece una, hay que poner `createdBy`/`updatedBy` a mano en el anidado.
- Escrituras en SQL crudo (`$executeRaw`) y desde scripts o seed (sin actor: quedan en `null`).
- Borrados: no hay columna; los cubre `AuditLog`.
- `$transaction` (interactiva o en arreglo) sobre el cliente extendido sí aplica la extensión
  (comprobado con el cronómetro en `tests/routes/trazabilidad-actor.test.ts`).
