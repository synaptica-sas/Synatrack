# R7 — Asignación del Project Manager (DEP-37) y cierre de las fugas de tarifas (DEP-38)

Rama: `fix/pm-y-fugas-tarifas` (sale de `dev`). Sin commits: los cambios quedan en el árbol de
trabajo.

Continúa R5 (`R5-seguridad-datos.md`), que cerró la fuga de tarifas en `GET /api/time-entries` y
dejó explícitamente pendientes las demás rutas. Aquí se cierran, y se arregla el defecto que dejaba
inerte la mitad del alcance por rol que R5 construyó: **no había forma de asignar el PM de un
proyecto**.

---

## 1. DEP-37 — El Project Manager por fin se puede asignar

`projectManagerEmail` se leía en nueve sitios del backend y no se escribía en ninguno: no estaba en
el esquema Zod de crear ni de editar proyectos, no había campo en el formulario y el seed no crea
proyectos. La columna solo podía tener valor escribiéndola a mano en la base.

### Backend (`backend/src/modules/projects/projects.routes.ts`)

Se añade `projectManagerEmail` a `projectPayloadSchema`, que es el mismo esquema que usan `POST /`
y `PUT /:id`, con estas reglas:

| Lo que manda el cliente | Lo que se guarda | Por qué |
|---|---|---|
| `"Ana.PEREZ@Synaptica.test"` | `"ana.perez@synaptica.test"` | Todas las comparaciones del backend (`getExtraHourAuthLevel`, el alcance por rol de `time-entries`, `extra-hours` y `activities`) hacen `toLowerCase()` contra el correo del token. Guardar en minúsculas evita el fallo silencioso que R5 dejó anotado como riesgo. |
| `""` | `null` | Es lo que manda un formulario con el campo vacío, y es también la forma de **desasignar** el PM. |
| campo ausente | no se toca | En el `PUT` significa "no tocar", igual que hace `description`. Un cliente viejo que no conozca el campo no borra el PM. |
| texto que no es correo | **400** de Zod | Zod valida antes de Prisma, como manda el patrón del proyecto. |

El campo es **opcional y nulable**: los proyectos sin PM siguen siendo válidos y no se rompe ningún
proyecto existente. El `authorize([ADMIN, PM])` de las rutas **no se tocó**.

### Frontend (`frontend/src/features/projects/ProjectsTab.tsx`, `frontend/src/services/api.ts`)

- `Project` gana `projectManagerEmail?: string | null`, y los payloads de `createProject` y
  `updateProject` lo aceptan.
- Campo `type="email"` en el formulario de alta y en el cajón de edición, con el texto de ayuda
  "Correo corporativo de quien aprueba las horas extra del proyecto".
- Columna **PM** en la tabla de proyectos (`—` cuando no hay) y columna "Project Manager" en la
  exportación CSV.

### Sobre el selector de usuarios: se descartó, y por qué

El backlog sugería "idealmente, un selector de usuarios con rol PM". **No se hizo**, a propósito:

- El único endpoint que lista usuarios es `GET /api/admin/users`, que es **solo ADMIN**. Un PM
  también crea proyectos, así que el selector estaría vacío —o daría 403— justo para la mitad de
  quienes usan el formulario.
- Crear un endpoint nuevo que exponga el directorio corporativo (correos, roles, estado) a cualquier
  `PM` es **abrir una fuga de datos dentro de un cambio cuyo otro objetivo es cerrarlas**. Es una
  decisión de producto sobre quién puede ver la nómina de personas, no un detalle de implementación,
  y no corresponde tomarla de paso.
- Poblarlo desde `GET /api/consultants` tampoco sirve: un PM no tiene necesariamente ficha de
  consultor, y la lista de consultores no es la lista de usuarios.

Queda un campo de correo con validación en los dos extremos (HTML `type="email"` y Zod en el
backend). Si más adelante se quiere el selector, lo limpio es un endpoint acotado
(`GET /api/users/managers`, solo `{ email, displayName }`, roles ADMIN y PM) decidido a conciencia.

### La prueba de que sirve para algo

`backend/tests/routes/proyectos-project-manager.test.ts` recorre el flujo completo:

1. Con el proyecto **sin PM**, el usuario `pm.aprobador@synaptica.test` con rol `PM` pide aprobar
   una solicitud de horas extra → **403**, y la solicitud sigue en `PENDING_PM`. Es exactamente el
   estado anterior a DEP-37: nivel 1 inalcanzable salvo para ADMIN o una delegación.
2. Se asigna el PM **por la API** (`PUT /api/projects/:id`, mandando el correo en mayúsculas) →
   200 y la respuesta devuelve el correo en minúsculas.
3. El mismo usuario aprueba → **200**, y la solicitud queda en `PENDING_FINANCE`, en la base, no
   solo en la respuesta.
4. Un PM de otro proyecto sigue recibiendo 403: asignar el PM no aflojó la autorización.

---

## 2. DEP-38 — Las tarifas dejan de salir de la base

### El `select` compartido

R5 definió `consultantSinDatosSensiblesSelect` dentro de `time-entries.routes.ts`. Aplicarlo a tres
módulos más significaba cuatro copias del mismo `select`, que es exactamente cómo se reabre una
fuga: basta con que alguien añada un campo sensible al modelo `Consultant` y lo excluya solo en
tres. Se movió a **`backend/src/utils/consultant-scope.ts`**, junto con la regla de quién ve las
tarifas:

```ts
export function puedeVerTarifas(roles: AppRole[]): boolean {
  return roles.includes(ADMIN) || roles.includes(PM) || roles.includes(FINANCE);
}
```

`ADMIN` y `PM` las necesitan para gestionar; `FINANCE`, para la nómina. `CONSULTANT` y `VIEWER` no.

`time-entries.routes.ts` pasa a importarlo; su comportamiento no cambia.

### Rutas corregidas

| Ruta | Qué pasaba | Qué hace ahora |
|---|---|---|
| `GET /api/extra-hours` | El `consultant` completo, con `hourlyRate` y `costPerMonth`, para todo el que entrara por la rama de acceso total: **incluido `VIEWER`** | Recorte con `select` para quien no puede ver tarifas. **El alcance por fila no se tocó**: `ADMIN`/`FINANCE`/`VIEWER` siguen viendo todas las filas, el `PM` las suyas más las de sus proyectos, el `CONSULTANT` solo las suyas |
| `GET /api/consultants` | La plantilla entera con tarifa, costo y documento para los cinco roles | Recorte para `CONSULTANT` y `VIEWER` |
| `GET /api/activities` | `consultant: true` en el listado, que un `VIEWER` recibe entero | Recorte para `VIEWER` |
| `GET /api/capacity/project/:projectId` | `estimatedCost` por consultor **y** `committedHours`: dividir uno por otro devuelve la tarifa exacta | Para quien no puede ver tarifas, `hourlyRate` ni se lee de la base y `estimatedCost` / `summary.totalEstimatedCost` salen `null` |
| `GET /api/capacity/by-project` | Lo mismo, por proyecto | Igual: `estimatedCost` y `totalEstimatedCost` en `null` |

El `CONSULTANT` **no** entra por la rama recortada en `extra-hours` ni en `activities`: en esas
rutas solo recibe sus propias filas, así que el consultor que viaja es él mismo. Ve su tarifa y su
documento, igual que en `time-entries` desde R5. Sí queda recortado en `GET /api/consultants`, que
devuelve la plantilla completa y no se puede recortar por fila (hoy ningún rol `CONSULTANT` tiene el
permiso `consultants:read`, así que esa pantalla ni se le muestra).

En todos los casos se usa **`select` de Prisma**: el dato no sale de la base, no se borra después.
En `capacity` eso se hace con `hourlyRate: verTarifas` dentro del `select` —Prisma admite un
booleano calculado— para que el criterio y la consulta no puedan desincronizarse.

### Rutas revisadas y **no** tocadas

- **`GET /api/assignments`** y **`GET /api/assignments/:id`**: ya entregaban el consultor con un
  `select` acotado (`id`, `fullName`, `role`, `country`, `seniority`), sin datos económicos. No hay
  nada que cerrar. Hay una prueba que lo fija, para que no se abra por descuido.
- **`GET /api/capacity/overview`, `/releasing`, `/overloaded`, `/consultant/:id`**: proyectan campos
  a mano y ninguno es económico. Sin cambios.
- **`GET /api/projects/:id/profitability`**: lee `hourlyRate` para calcular, pero **no lo devuelve**;
  publica márgenes agregados. Su `authorize` incluye `VIEWER`, así que un rol de consulta ve la
  rentabilidad del proyecto. Eso es una decisión de producto anterior y distinta de una fuga de
  tarifas individuales: **no se tocó**, y se deja anotado en riesgos.
- **`GET /api/extra-hours/payroll`**: devuelve tarifas e identificaciones, pero está autorizada solo
  para `ADMIN` y `FINANCE`. Es su trabajo.

### Frontend, que sí consumía esos campos

`Consultant.hourlyRate` y `costPerMonth` pasan a ser **opcionales** en `frontend/src/services/api.ts`.
La distinción importa y está documentada en el tipo:

- `null` = "no tiene tarifa cargada".
- `undefined` = "no te corresponde verla".

- **`ConsultantsTab.tsx`**: helper `tarifaOculta()`. La tabla muestra **`—`** en las dos columnas de
  tarifa (moneda propia y equivalente en USD) en vez de `$ 0,00`; la exportación CSV deja la celda
  vacía en vez de `0.00`; y al abrir el formulario de edición el campo queda **vacío**, no en `0`,
  para que nadie reenvíe un cero que sobrescriba la tarifa real (el backend interpreta el campo
  vacío como `undefined` y no toca la columna).
- **`RagChat.tsx`**: respondía `$0 COP/hora`. Ahora distingue: `No disponible para tu rol` cuando el
  dato no vino, `Sin tarifa registrada` cuando vino en `null`.
- **`CapacityTab.tsx`**: las dos celdas de costo estimado ya pintaban `—` cuando el valor era 0;
  ahora también cuando es `null`.
- **`ExtraHoursTab.tsx`**: la columna de documento mostraba `No asignado`, que para un dato oculto
  sería mentira. Ahora `—` si no vino, `No asignado` si vino vacío.
- **`ForecastsTab.tsx`** usa `consultant.hourlyRate` para precargar el formulario, pero solo quien
  tiene `forecasts:write` (ADMIN, PM) ve ese formulario, y esos roles sí reciben la tarifa. Sin
  cambios.

---

## 3. Qué se rompe para quien consuma la API

1. `GET /api/extra-hours`, `GET /api/consultants` y `GET /api/activities` devuelven el objeto
   `consultant` **sin** las claves `hourlyRate`, `costPerMonth` ni `identification` para los roles
   que no pueden verlas. Quien las lea verá `undefined`, no `null`.
2. `GET /api/capacity/project/:projectId` y `GET /api/capacity/by-project` pueden devolver
   `estimatedCost` y `totalEstimatedCost` en **`null`**. El tipo dejó de ser `number`.
3. `POST` y `PUT /api/projects` aceptan `projectManagerEmail`. No es un cambio incompatible: el
   campo es opcional y, si no viene, el `PUT` no toca la columna.

---

## 4. Cómo se demostró

Las pruebas de ruta pasan de **41 a 63**, en 10 archivos (2 nuevos):

| Archivo | Pruebas | Cubre |
|---|---|---|
| `proyectos-project-manager.test.ts` | **9** | asignar, normalizar a minúsculas, crear sin PM, desasignar, correo inválido, PM que asigna PM, y el flujo 403 → asignar → aprobación de nivel 1 |
| `tarifas-fugas.test.ts` | **13** | `extra-hours`, `consultants`, `activities`, las dos rutas de `capacity` y `assignments` (que no cambió) |

Cada prueba de fuga comprueba dos cosas: que el objeto **no tiene** las claves
(`not.toHaveProperty`) y que la tarifa marcada **no aparece en el cuerpo crudo** de la respuesta,
que es lo que detecta una fuga por un camino que la prueba no sabía mirar. Y, en el mismo archivo,
que un `ADMIN` (y un `PM`, y un `FINANCE` donde aplica) **sí** la recibe: el recorte tiene que doler
solo donde debe.

### Un defecto de las pruebas encontrado de paso

La tarifa marcada del consultor B era `999`, y el escenario se nombra con `Date.now()`. El
2026-09-21 a las 11:48 el reloj valía `1790009299987`, que **contiene "999"**, así que
`expect(res.body).not.toContain("999")` falló en dos pruebas de R5 por pura coincidencia. No era una
regresión: era una prueba frágil que había pasado por suerte hasta ahora. La tarifa marcada pasa a
ser **`999.77`**, una cadena que no puede aparecer dentro de un `cuid` ni de un timestamp.

### Verificación

```
$ cd backend && npx tsc --noEmit
(sin salida, exit 0)

$ npm test
 Test Files  7 passed (7)
      Tests  153 passed (153)

$ npm run test:routes
 Test Files  10 passed (10)
      Tests  63 passed (63)

$ cd frontend && npx tsc -b --noEmit
(sin salida, exit 0)

$ npm run lint
(sin salida, exit 0)

$ npm run build
 ✓ built in 771ms

$ npm test
 Test Files  11 passed (11)
      Tests  133 passed (133)
```

---

## 5. Riesgos que quedan

- **La delegación de aprobaciones sigue sin interfaz.** `ApprovalDelegation` se consulta en
  `getExtraHourAuthLevel`, pero crearla es otro camino que no se ha revisado aquí. El PM ya funciona;
  la delegación, no consta.
- **El alcance del PM se resuelve por igualdad exacta de correo.** Ahora los proyectos nuevos se
  guardan en minúsculas, pero **los proyectos que ya tenían el PM escrito a mano en la base pueden
  tenerlo con mayúsculas** y seguirán sin funcionar. Falta una migración de datos
  (`UPDATE "Project" SET "projectManagerEmail" = lower("projectManagerEmail")`) o pasar los `where`
  a `mode: "insensitive"`. Falla hacia el lado seguro (el PM ve de menos), pero falla en silencio.
- **`GET /api/projects/:id/profitability` sigue abierta a `VIEWER`** con márgenes y costos agregados
  del proyecto. No es una tarifa individual, pero con pocos datos más se aproxima. Es una decisión de
  producto pendiente.
- **`estimatedCost: null` no se explica en la interfaz.** Un `VIEWER` ve `—` en la columna de costo
  sin saber si es que no hay costo o que no puede verlo. Es correcto pero mudo; lo honesto sería un
  texto del tipo "no disponible para tu rol", como el que sí da `RagChat`.
- **No hay selector de PM**: quien asigne el PM tiene que escribir el correo bien. Un correo con una
  errata se guarda tal cual y el PM resultante no existe, con el mismo síntoma silencioso de antes
  (nadie puede aprobar el nivel 1). Un selector, o al menos una validación contra los usuarios
  existentes, cerraría ese hueco.
- **`GET /api/consultants` le oculta al `CONSULTANT` su propia tarifa**, porque el listado no se
  puede recortar por fila sin cambiar su alcance. Hoy da igual —ese rol no tiene la pantalla—, pero
  si algún día se le da, habrá que resolverlo.
- **Las escrituras de proyectos ya dejan rastro en `AuditLog`, pero las de consultores no**
  (auditoría parcial, §10 de la documentación técnica): cambiar una tarifa sigue sin dejar huella.
- **`tests/` sigue fuera de `npx tsc --noEmit`** (`rootDir: "src"`), igual que en R0 y R5.
