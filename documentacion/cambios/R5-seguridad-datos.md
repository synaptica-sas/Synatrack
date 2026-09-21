# R5 — Seguridad de datos: alcance por rol, identidad del aprobador y fugas

Rama: `fix/seguridad-datos` (sale de `feat/pruebas-de-rol`). Sin commits: los cambios quedan en el
árbol de trabajo.

A diferencia de R0, **esta rama sí cambia comportamiento**, y uno de los cambios **rompe el
contrato de la API** (ver §6). Cada punto queda demostrado con una prueba de ruta, no afirmado.

---

## 1. Alcance por fila en `GET /api/time-entries`

**Antes**: la ruta hacía un `findMany` sin `where`, con `include: { consultant: true }`. Cualquier
`CONSULTANT` o `VIEWER` recibía las horas de toda la empresa y, dentro de cada fila, el consultor
completo — incluida su `hourlyRate`. Era la única ruta de horas que no filtraba: `extra-hours` y
`activities` sí lo hacían.

**Ahora** (`backend/src/modules/time-entries/time-entries.routes.ts`), replicando el patrón de
`extra-hours.routes.ts`:

| Rol | Filas | Consultor |
|---|---|---|
| `ADMIN` | todas | completo |
| `PM` | las suyas (consultor con su correo) + las de proyectos donde es `projectManagerEmail` | completo |
| `VIEWER` | todas | **recortado** |
| `CONSULTANT` | solo las suyas | completo (solo sale el suyo) |

La autorización de la ruta **no se tocó**: sigue siendo
`authorize([ADMIN, PM, CONSULTANT, VIEWER])` y `FINANCE` sigue sin entrar.

### Precedencia entre roles

Las comprobaciones se evalúan en orden `ADMIN → PM → VIEWER → CONSULTANT`, así que un usuario con
varios roles obtiene el alcance del más alto que tenga. Es el mismo criterio de `extra-hours`, que
mete a `VIEWER` en la rama de acceso total.

### Qué campos del consultor se recortan para `VIEWER`, y por qué

El `select` `consultantSinDatosSensiblesSelect` omite tres campos:

- **`hourlyRate`** — lo pedía el encargo explícitamente. Es la tarifa de venta de la persona.
- **`costPerMonth`** — se omite también. Es el otro lado de la misma moneda: el costo interno.
  Dejarlo fuera de `hourlyRate` pero visible sería incoherente, y de hecho es el dato *más*
  sensible de los dos: con `costPerMonth` y las horas registradas se reconstruye el margen del
  proyecto, que es justo lo que un rol de solo-lectura no financiero no debería poder calcular.
- **`identification`** — documento de identidad. No es un dato económico, pero es un dato personal
  que una pantalla de registro de horas no necesita para nada: la tabla muestra `fullName`. Se
  omite por el mismo principio de mínimo privilegio.

Se **dejan** `rateCurrency`, `country`, `company`, `seniority`, `skills`, `maxHoursPerDay`,
`active`, `allowWeekendWork` e `isInternal`: no revelan remuneración y algunos alimentan filtros de
la UI. `rateCurrency` por sí solo, sin tarifa, no dice cuánto cobra nadie.

Se usa `select` de Prisma en vez de borrar campos después de la consulta: así el dato **nunca sale
de la base**, y no depende de que alguien recuerde filtrar en cada punto de salida.

---

## 2. Suplantación en `POST /api/time-entries`

**Antes**: la ruta aceptaba cualquier `consultantId` del cuerpo. Un consultor podía registrar horas
a nombre de otro (y esas horas entran en costos y en aprobaciones).

**Ahora**: si quien registra **no** es `ADMIN` ni `PM`, se busca el consultor cuyo correo coincide
con el del token:

- No existe ficha de consultor para ese correo → **403** con
  `No hay un consultor asociado al correo <x>, así que no se pueden registrar horas a tu nombre.
  Pide a un administrador que cree tu ficha de consultor.`
  Es un caso real: el JIT provisioning crea el `Consultant` solo para quien entra con rol
  `CONSULTANT`; un usuario provisionado de otra forma puede no tenerlo.
- La ficha existe pero el `consultantId` del cuerpo es otro → **403**
  `Solo puedes registrar horas a tu propio nombre.`

`ADMIN` y `PM` conservan la capacidad de registrar a nombre de terceros: es un flujo legítimo de la
PMO (cargar el parte de horas de un equipo).

La comprobación va **después** del `parse` de Zod y **antes** de cualquier escritura, y no altera
el candado de `MonthlySnapshot`, que sigue evaluándose igual.

---

## 3. La identidad de quien aprueba sale del token

**Antes**, en los dos módulos, `approvedBy` venía del cuerpo de la petición. El rastro de quién
aprobó era literalmente un campo de texto que escribía el cliente. En `extra-hours` esto es peor
porque esa columna alimenta el cierre de nómina (`GET /api/extra-hours/payroll`) y viaja además en
los correos a Nómina y en la tarjeta de Teams.

**Ahora**:

- `time-entries`: `approve` ya no lee cuerpo alguno; `reject` solo lee `rejectionNote`. Ambos
  escriben `approvedBy: request.authUser!.email.toLowerCase()`.
- `extra-hours`: igual. Las cinco interpolaciones de `payload.approvedBy`
  (base de datos en nivel 2, notificación a Nómina, notificación de aprobación final al consultor,
  base de datos en el rechazo, notificación de rechazo) pasan a usar el `email` del token.

Se guarda el **correo**, no el `displayName`: es la clave con la que ya se resuelven PM, delegaciones
y filtros por consultor en todo el backend, y a diferencia del nombre para mostrar es único.

Se eliminaron `approvedBy` de los schemas Zod de entrada de los dos módulos; `rejectionNote` se
queda, y en `extra-hours` sigue siendo obligatorio con mínimo 3 caracteres. En `time-entries` el
`reviewPayloadSchema` de aprobación desapareció entero: ya no había nada que validar (nunca usó
`rejectionNote`).

---

## 4. El error handler ya no filtra `stack`

`backend/src/app.ts` devolvía `detail` (el mensaje de la excepción) y `stack` (traza completa, con
rutas absolutas del sistema de archivos y nombres de módulos internos) en **toda** respuesta 500,
en cualquier entorno.

Ahora, con `NODE_ENV === "production"`, la respuesta es exactamente
`{ "message": "Internal server error" }`. El `app.log.error({ err: error })` con el detalle y la
traza **se mantiene y corre antes del corte**, así que no se pierde nada para diagnosticar: se
mueve del cliente al log del servidor, que es donde debía estar. Fuera de producción se sigue
devolviendo `detail` y `stack`, que es útil para desarrollar.

El manejo de `ZodError` (400 con las `issues`) no cambia: son errores del cliente sobre datos que
el cliente mandó.

---

## 5. HTML de los correos escapado

`backend/src/utils/notifications.ts` interpolaba nombres, observaciones, motivos de rechazo y notas
de feedback directamente dentro de las plantillas HTML. Un consultor podía inyectar etiquetas en el
correo que recibe Nómina simplemente escribiéndolas en el campo de observaciones.

Se añadió `escaparHtml()` (exportada, para poder probarla) y se aplicó a **todas** las
interpolaciones de los cinco bloques `const html = ...`, no solo a las que hoy parecen peligrosas:
la regla que resiste el paso del tiempo es "todo lo que entra en HTML se escapa".

Las versiones `text` de los correos no se escapan: ahí `<` es un carácter más.
La única interpolación que se dejó sin envolver es la que elige un color de fondo según la
categoría (`category === "BUG" ? "#fee2e2; ..." : "#fef3c7; ..."`): produce solo literales del
propio código, no texto de usuario.

**No se tocó la configuración TLS del SMTP** (`rejectUnauthorized: false`, `ciphers: "SSLv3"`),
según lo decidido: queda para cuando haya credenciales de prueba.

---

## 6. Qué se rompe para quien consuma la API

Este es el punto que hay que comunicar. Son **cambios de contrato**, no solo de datos:

1. **`PATCH /api/time-entries/:id/approve`** ya no acepta ni necesita cuerpo. Enviar
   `{ approvedBy: "..." }` ya no falla, pero **se ignora en silencio**.
2. **`PATCH /api/time-entries/:id/reject`** ahora solo lee `rejectionNote`. `approvedBy` se ignora.
3. **`PATCH /api/extra-hours/:id/approve`** y **`/reject`**: idéntico.
4. El valor guardado en `approvedBy` pasa de ser un **nombre para mostrar** a un **correo**. Los
   registros históricos conservan el nombre, así que la columna queda **mezclada**: nombres para lo
   aprobado antes de este cambio, correos para lo posterior. Cualquier informe que agrupe por
   `approvedBy` tiene que contar con las dos formas. No se migraron los datos históricos: no hay
   forma fiable de mapear un `displayName` a un correo a posteriori.
5. **`GET /api/time-entries`** devuelve muchas menos filas para `PM` y `CONSULTANT`, y para
   `VIEWER` el objeto `consultant` viene **sin** `hourlyRate`, `costPerMonth` ni `identification`.
   Un cliente que lea `entry.consultant.hourlyRate` verá `undefined`, no `null`.
6. En producción, las respuestas 500 ya no traen `detail` ni `stack`. Cualquier herramienta que los
   estuviera leyendo deja de verlos.

### Frontend actualizado en el mismo cambio

- `frontend/src/services/api.ts`: `approveTimeEntry(id)`, `rejectTimeEntry(id, rejectionNote)`,
  `approveExtraHour(id)` y `rejectExtraHour(id, { rejectionNote })` perdieron el parámetro
  `approvedBy`. Se añadió el tipo `TimeEntryConsultant` (el consultor de un registro de horas con
  `hourlyRate`, `costPerMonth` e `identification` **opcionales**), para que TypeScript refleje que
  esos campos pueden no venir.
- `frontend/src/features/timeEntries/TimeEntriesTab.tsx`: las dos llamadas actualizadas. La prop
  `reviewerName` quedó sin uso y se eliminó, junto con el `reviewerName={authUser.displayName}` de
  `frontend/src/App.tsx`. Eran las únicas referencias en todo el frontend (verificado con `grep`).
- `frontend/src/features/extraHours/ExtraHoursTab.tsx`: `handleApprove` y `handleRejectSubmit`
  actualizados.

Se buscaron todas las llamadas con `grep -rn "approvedBy\|approveTimeEntry\|rejectTimeEntry\|
approveExtraHour\|rejectExtraHour" frontend/src/`. No quedan otras.

---

## 7. Cómo se demostró

`backend/tests/routes/time-entries-defectos-conocidos.test.ts` **desapareció**. Sus tres pruebas
`DEFECTO:` están invertidas dentro de `backend/tests/routes/time-entries-alcance.test.ts`, cuyo
comentario de cabecera explica la sustitución. Se renombró porque el archivo ya no documenta
defectos: fija el comportamiento correcto.

Las pruebas de ruta pasan de **12 a 32**, en 7 archivos:

| Archivo | Pruebas | Cubre |
|---|---|---|
| `authorize.test.ts` | 4 | (sin cambios) |
| `auth-requerida.test.ts` | 3 | (sin cambios) |
| `extra-hours-alcance.test.ts` | 2 | (sin cambios) — el patrón de referencia |
| `time-entries-alcance.test.ts` | **12** | alcance por rol, suplantación y `approvedBy` de horas |
| `extra-hours-aprobacion.test.ts` | **4** | `approvedBy` de horas extra (nómina) |
| `error-handler-fuga.test.ts` | **2** | 500 sin `stack` en producción, con `stack` fuera |
| `notificaciones-escape.test.ts` | **5** | `escaparHtml` |

Lo que fija cada prueba nueva:

- Un `CONSULTANT` no recibe filas de otro consultor, y la tarifa ajena (999) **no aparece en ningún
  lugar del cuerpo crudo** de la respuesta — se comprueba sobre `res.body`, no solo sobre los campos
  que la prueba sabe mirar. Su propia tarifa (40) sí llega.
- Un `VIEWER` recibe filas de ambos consultores, pero el objeto `consultant` **no tiene** las claves
  `hourlyRate`, `costPerMonth` ni `identification` (`not.toHaveProperty`), sí tiene `fullName`, y el
  999 tampoco aparece en el cuerpo.
- Un `PM` ve las horas de su proyecto (de ambos consultores) y **no** las de un segundo proyecto
  creado a propósito con otro `projectManagerEmail`.
- Un `ADMIN` sigue viendo todo, incluida la tarifa de 999: se comprueba que el recorte **no** se
  aplicó de más.
- Un `CONSULTANT` que manda el `consultantId` de otro recibe 403 **y no se crea ninguna fila**
  (se cuenta en la base después). Registrando el suyo, 201. Sin ficha de consultor, 403 con el
  mensaje claro. Un `PM` a nombre de otro, 201.
- Aprobando y rechazando horas con `payload: { approvedBy: "Director General Falsificado" }`, lo que
  queda en la respuesta **y en la base** es el correo del token. Aprobar sin cuerpo funciona.
- En horas extra se recorre el flujo de dos niveles completo: nivel 1 con `approvedBy` falsificado
  en el cuerpo deja la solicitud en `PENDING_FINANCE`, y el nivel 2 escribe el correo del token. El
  rechazo guarda el correo del token y conserva el `rejectionNote` del cliente; sin motivo sigue
  dando 400 de Zod.

### Verificación

```
$ cd backend && npx tsc --noEmit
(sin salida, exit 0)

$ npm test
 Test Files  7 passed (7)
      Tests  153 passed (153)

$ npm run test:routes
 Test Files  7 passed (7)
      Tests  32 passed (32)

$ cd frontend && npx tsc -b --noEmit
(sin salida, exit 0)

$ npm run lint
(sin salida, exit 0)

$ npm test
 Test Files  10 passed (10)
      Tests  124 passed (124)
```

---

## 8. Riesgos que quedan

- **`GET /api/extra-hours` sigue devolviendo `consultant` completo a `VIEWER` y `FINANCE`**, con
  tarifa incluida. Para `FINANCE` es su trabajo; para `VIEWER` es la misma fuga que se acaba de
  cerrar en `time-entries`, en otra ruta. No se tocó porque el encargo acotaba el alcance a
  `time-entries` y porque `extra-hours` es el módulo de referencia: cambiarlo a mitad de este
  trabajo habría movido el patrón que se estaba copiando. **Queda pendiente y es el siguiente paso
  obvio.** Lo mismo aplica a `activities`, `assignments` y `capacity`, que no se auditaron aquí.
- **El resto de rutas que exponen `Consultant` no se revisaron**: `GET /api/consultants` entrega la
  tarifa a quien pueda llamarla. Hay que barrer la matriz completa de 125 endpoints.
- **`approvedBy` es una columna mezclada** (nombres antiguos, correos nuevos) hasta que se decida
  migrar o normalizar los históricos.
- **Las notificaciones a Teams no se escapan.** Van como JSON a una `MessageCard` con
  `"markdown": true`, así que el texto del usuario puede inyectar *markdown* (enlaces, formato) en
  la tarjeta, no HTML. Es un riesgo menor que el del correo pero real, y no se abordó.
- **La configuración TLS del SMTP sigue insegura** (`rejectUnauthorized: false`, `ciphers: "SSLv3"`),
  por decisión explícita: queda para cuando haya credenciales de prueba con las que validar el
  cambio.
- **El alcance del `PM` se resuelve por igualdad exacta de correo** (`consultant.email === email`,
  `project.projectManagerEmail === email`), heredado de `extra-hours`. Si un correo se guardó con
  mayúsculas distintas en la ficha del consultor o del proyecto, el PM no verá esas filas. El
  filtrado falla hacia el lado seguro (ve de menos, no de más), pero es una trampa a corregir de
  forma uniforme en los dos módulos.
- **`tests/` sigue fuera de `npx tsc --noEmit`** (`rootDir: "src"`), igual que en R0: los errores de
  tipo de las pruebas los detecta vitest al transpilar, no el type-check.
- **`escaparHtml` se prueba desde `tests/routes/`, no desde `src/utils/__tests__/`**, para no mover
  el conteo fijo de 153 de la suite unitaria. Es una prueba de función pura viviendo en la suite de
  rutas: funciona, pero está fuera de su sitio natural y conviene reubicarla cuando se acepte
  cambiar ese número.
