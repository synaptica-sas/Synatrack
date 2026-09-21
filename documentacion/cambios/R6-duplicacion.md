# R6 — Duplicación: matriz de permisos, aprobación de horas extra y tasas FX

Rama: `fix/duplicacion` (sale de `fix/seguridad-datos`). Sin commits: los cambios quedan en el
árbol de trabajo.

Cubre tres ítems del backlog de depuración: **DEP-15**, **DEP-17** y **DEP-18**. Alcance decidido
de antemano: **eliminar duplicación concreta, sin emprender la refactorización grande** de hacer
que `authorize()` reciba permisos en vez de roles (eso toca los 125 endpoints y va aparte).

Ningún cambio altera quién puede hacer qué. Los tres son reorganizaciones de código con pruebas
que fijan el comportamiento.

---

## 1. DEP-15 — La tercera copia de la matriz de permisos

### Qué había

Tres definiciones de quién puede qué:

1. `backend/src/auth/roles.ts` (`rolePermissions`) — alimenta la UI vía `GET /api/auth/me`.
2. El `authorize([AppRole...])` de cada ruta — **lo que de verdad protege**. No se tocó.
3. Una **copia literal** de la matriz dentro de `handleSwitchRole`, en `frontend/src/App.tsx`
   (~línea 984), usada por el selector "VISTA" con el que un administrador previsualiza la
   interfaz como otro rol.

### ¿Ya habían divergido la (1) y la (3)?

**No.** Se compararon campo por campo los cuatro roles que aparecen en ambas:

| Rol | Permisos en `roles.ts` | Permisos en `App.tsx` | Solo en backend | Solo en frontend |
|---|---|---|---|---|
| ADMIN | 30 | 30 | — | — |
| PM | 25 | 25 | — | — |
| CONSULTANT | 6 | 6 | — | — |
| FINANCE | 2 | 2 | — | — |

Coincidían incluso en el orden de los elementos. La copia estaba sincronizada por suerte, no por
mecanismo: nada avisaba si dejaba de estarlo.

**Diferencia que sí existía**: la copia de `App.tsx` **no incluía `VIEWER`**, porque el selector
solo ofrece cuatro botones (Admin, PM, Consultor, Financiero). Eso no es un desajuste de permisos
sino del alcance del propio selector, y se dejó igual para no cambiar comportamiento visible. Hoy
el backend sí sirve los cinco roles; añadir el botón de `VIEWER` es una decisión de producto de
una línea, cuando se quiera.

### Qué se hizo

Se expone la matriz desde el backend y el frontend la consume:

- **Backend**: nuevo `GET /api/auth/permissions` en `backend/src/modules/auth/auth.routes.ts`,
  detrás de `authenticate` (sin `authorize`: es la misma información que ya devuelve `/me`, solo
  que completa). Devuelve `rolePermissions` tal cual, en el envoltorio `{ data }` de siempre.
- **Frontend**: `getRolePermissions()` y el tipo `RolePermissionsMap` en `services/api.ts`;
  `App.tsx` la pide **una sola vez al arrancar y solo si el usuario es ADMIN** (los únicos que ven
  el selector), la guarda en estado y `handleSwitchRole` la usa.

Con eso `roles.ts` queda como fuente única de la matriz de presentación.

### Decisiones y por qué

- **Servirla desde el backend en vez de duplicar un módulo compartido en el frontend.** No hay
  paquete compartido entre `backend/` y `frontend/` en este repo, y crear uno (o un script de
  generación) para una constante es más maquinaria de la que el problema pide. Un endpoint ya
  autenticado es la vía que el proyecto usa para todo lo demás.
- **Se carga solo para administradores**, no para todos: es una petición extra en el arranque y
  nadie más la necesita.
- **Si la petición falla, no se rompe el arranque**: se captura, la matriz queda en `null` y los
  botones del selector se muestran **deshabilitados** con un `title` que lo explica. Antes, con la
  copia local, el selector funcionaba siempre; esta es la única diferencia observable del cambio, y
  solo cuando el endpoint falla. Se prefirió eso a inventar permisos en el cliente.
- **El selector sigue siendo solo previsualización.** Queda escrito en un comentario sobre
  `handleSwitchRole` y en otro sobre el endpoint: cambia lo que se ve, no lo que el backend
  autoriza. El `authorize([AppRole...])` de cada ruta sigue mandando sobre los roles del token.

### Pruebas

`backend/tests/routes/auth-permisos.test.ts` (2 casos): la respuesta es **exactamente**
`rolePermissions` importado del módulo, y trae los cinco roles. Si alguien vuelve a escribir una
matriz a mano en cualquiera de los dos lados, esta prueba no lo detecta — pero sí detecta que el
endpoint deje de reflejar `roles.ts`, que es la garantía que sostiene la unificación.

---

## 2. DEP-17 — Lógica de aprobación duplicada en horas extra

### Qué había

En `backend/src/modules/extra-hours/extra-hours.routes.ts`, los handlers de `approve` y `reject`
repetían palabra por palabra la comprobación de "quién puede actuar en este nivel": PM del
proyecto, ADMIN, delegación vigente, y el corte entre `PENDING_PM` (nivel 1) y el resto (nivel 2,
Finanzas).

### Qué se hizo

Se extrajo `getExtraHourAuthLevel(entry, user)`, exportada desde el mismo módulo:

```ts
{ level: "PM" | "FINANCE", authorized: boolean }
```

- `PENDING_PM` → nivel `"PM"`: autoriza el PM del proyecto, un ADMIN, o quien tenga una
  `ApprovalDelegation` vigente sobre ese proyecto.
- Cualquier otro estado → nivel `"FINANCE"`: autoriza FINANCE o ADMIN.

Ambos handlers la llaman. La consulta de delegación es la misma, con la única diferencia de que
ahora usa **un solo `new Date()`** para `startDate` y `endDate` en vez de dos instancias creadas
con microsegundos de diferencia; es equivalente.

### Diferencias encontradas entre `approve` y `reject` (y qué se hizo con cada una)

La lógica de **autorización** era idéntica. Las diferencias estaban alrededor, y **todas se
conservaron tal cual** en su handler:

| Diferencia | `approve` | `reject` | Qué se hizo |
|---|---|---|---|
| Mensajes del 403 | "Solo el supervisor (PM) de este proyecto…" / "Solo el personal de Finanzas / Nómina o el Administrador…" | "Solo el PM de este proyecto…" / "Solo Finanzas o el Administrador…" | **Se conservan los cuatro mensajes.** El helper devuelve el veredicto; el texto lo pone cada handler. |
| Orden de las comprobaciones previas | estado (409) → mes cerrado (400) | mes cerrado (400) → estado (409) | **Sin tocar.** Ante una solicitud ya aprobada en un mes cerrado, `approve` sigue devolviendo 409 y `reject` sigue devolviendo 400. |
| Estados rechazables | 409 si `APPROVED`, 409 si `REJECTED` (mensajes distintos) | un solo 409 si `APPROVED` o `REJECTED` | Sin tocar. |
| Efecto | transición de estado en dos niveles, con notificación distinta por nivel | un único `update` a `REJECTED` | Sin tocar. |

No se eligió nada por cuenta propia: lo que difería sigue difiriendo, y queda anotado aquí.

### Pruebas

`npm run test:routes` pasó de **32 a 41** casos. Además de los 2 de `auth-permisos`, se añadieron
**7** a `backend/tests/routes/extra-hours-aprobacion.test.ts`, que ejercitan el helper por los dos
handlers:

- nivel 1: el PM del proyecto aprueba → `PENDING_FINANCE`;
- nivel 1: un PM ajeno recibe 403 al aprobar **y** al rechazar;
- nivel 1: Finanzas todavía no puede aprobar;
- nivel 1: una delegación **vigente** habilita a quien no es PM;
- nivel 1: una delegación **vencida** no habilita a nadie;
- nivel 2: el PM ya no puede aprobar ni rechazar, Finanzas sí → `APPROVED`;
- nivel 2: Finanzas puede rechazar lo que el PM ya aprobó.

---

## 3. DEP-18 — `findFxRate` duplicado

### Qué había

`frontend/src/App.tsx` (~línea 126) reimplementaba la triangulación de monedas de
`backend/src/utils/currency.ts`, con un comentario que lo admitía, sin ninguna prueba.

### Camino elegido: (b) extraer y probar, no (a) consumir la API

`GET /api/fx/rate` existe y funciona, pero el conversor del cajón lateral (`FxDrawer`) recalcula en
un `useMemo` cada vez que cambian la moneda origen, la moneda destino o el monto, mientras el
usuario escribe. Consumir la API significaría o una petición por pulsación, o montar *debounce* +
caché + estados de carga y error dentro de un conversor que hoy es instantáneo y funciona con los
`FxConfig` que la aplicación **ya tiene cargados**. Además el conversor permite una tasa
personalizada, que no pasa por el backend en ningún caso.

El costo de (b) es aceptar que la regla vive en dos sitios; el beneficio es que ahora está
**aislada y probada**, que era justo lo que faltaba.

Se creó `frontend/src/utils/fxRate.ts` con la función movida **sin cambios de lógica**, un tipo
`FxRateSource` mínimo (nada de `any`), y un encabezado que declara la duplicación como deliberada y
dice qué hacer si la regla cambia en el backend.

### Divergencia real encontrada entre las dos implementaciones

Al escribir las pruebas apareció una diferencia de comportamiento que **no** estaba documentada:

> La versión del frontend solo triangula cuando la moneda de **origen** aparece como `baseCode` en
> alguna tasa. Si la moneda de origen existe únicamente como `quoteCode`, devuelve `null` aunque
> haya un camino evidente.

Ejemplo con tasas `USD→COP` y `USD→MXN` cargadas: `COP→MXN` es perfectamente calculable vía USD, y
el backend lo resuelve (porque `buildRateMap` construye el mapa **bidireccional** antes de buscar
el pivote), pero el frontend devuelve `null` y el conversor no muestra resultado.

**No se corrigió**, porque este trabajo es de eliminación de duplicación y corregirlo cambiaría
comportamiento visible del conversor. Queda fijado en una prueba que lo nombra como limitación
conocida y explica la diferencia con el backend, para que el arreglo sea deliberado y no un
efecto colateral.

### Pruebas

`frontend/src/test/fxRate.test.ts`, **9 casos**: misma moneda, tasa directa, tasa inversa, tasa
numérica además de cadena, triangulación por pivote, triangulación por pivote invertido, la
limitación de arriba, sin ruta posible (y sin tasas), y coherencia ida/vuelta.

El total del frontend pasa de **124 a 133** pruebas.

---

## 4. Archivos tocados

**Backend**

- `src/modules/auth/auth.routes.ts` — nuevo `GET /api/auth/permissions`.
- `src/modules/extra-hours/extra-hours.routes.ts` — nuevo `getExtraHourAuthLevel(...)`; `approve` y
  `reject` lo usan.
- `tests/routes/auth-permisos.test.ts` — **nuevo** (2 casos).
- `tests/routes/extra-hours-aprobacion.test.ts` — +7 casos.

**Frontend**

- `src/services/api.ts` — `RolePermissionsMap` y `getRolePermissions()`.
- `src/App.tsx` — se borra la copia de la matriz y la definición local de `findFxRate`; el selector
  de rol consume la matriz del backend y queda deshabilitado si no se pudo cargar.
- `src/utils/fxRate.ts` — **nuevo**.
- `src/test/fxRate.test.ts` — **nuevo** (9 casos).

No se agregó ninguna dependencia.

---

## 5. Verificaciones

| Comprobación | Resultado |
|---|---|
| `backend/ npx tsc --noEmit` | sin errores |
| `backend/ npm test` | **153 pasan** (7 archivos) — sin cambios |
| `backend/ npm run test:routes` | **41 pasan** (8 archivos) — eran 32 |
| `frontend/ npx tsc -b --noEmit` | sin errores |
| `frontend/ npm run lint` | sin hallazgos |
| `frontend/ npm run build` | build correcto (`dist/`, 438 módulos) |
| `frontend/ npm test` | **133 pasan** (11 archivos) — eran 124 |

(En el frontend, `npx tsc --noEmit` a secas no verifica nada: el `tsconfig.json` raíz solo tiene
referencias. Hay que usar `tsc -b`.)

---

## 6. Riesgos que quedan

1. **La duplicación grande sigue en pie.** `authorize([AppRole...])` y `rolePermissions` siguen
   siendo dos sistemas paralelos: la interfaz puede ofrecer algo que el backend rechaza, o
   esconder algo que permitiría. DEP-15 queda **parcialmente** cerrado — se eliminó la tercera
   copia, no la segunda. Ejemplo vivo: `FINANCE` puede aprobar horas extra en las rutas, pero en
   `rolePermissions` no tiene `projects:read` ni `stats:read`.
2. **Nada impide reintroducir una copia a mano.** No hay linter ni prueba que detecte una nueva
   matriz escrita en el frontend; lo único que hay es que ya no existe ninguna, y la prueba de
   `auth-permisos` que ata el endpoint a `roles.ts`.
3. **`findFxRate` sigue duplicado a propósito**, y con una limitación real frente al backend
   (§3). Si alguien cambia la triangulación en `currency.ts` sin tocar `fxRate.ts`, el conversor
   del cajón dará otro número que el resto de la aplicación. Está anotado en ambos archivos.
4. **El selector de rol no ofrece `VIEWER`.** El backend ya sirve sus permisos; el botón no existe.
5. **El nuevo endpoint añade una petición al arranque** para administradores. Es una constante en
   memoria, sin consulta a la base; el costo es despreciable, pero está ahí.
6. **DEP-17 no cambió el orden de comprobaciones** entre `approve` y `reject` (§2). Esa
   inconsistencia de códigos de estado (409 vs. 400 para el mismo caso) sigue abierta y merece una
   decisión propia.
