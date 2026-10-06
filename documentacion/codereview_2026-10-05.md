# Code review de Synatrack — 2026-10-05

| | |
|---|---|
| **Alcance** | Todo el repositorio en la rama `main`: backend, frontend, base de datos, lógica de negocio y configuración de despliegue. No es la revisión de un cambio puntual. |
| **Método** | Cinco revisiones especializadas en paralelo (seguridad, backend, lógica de negocio, base de datos y frontend). Cada hallazgo se verificó leyendo el código; los más graves se comprobaron una segunda vez a mano. |
| **Público** | La sección 1 es para el líder del proyecto, sin conocimientos de programación. Las secciones 3 a 8 son para el equipo de desarrollo. |
| **Cómo citar un hallazgo** | Cada hallazgo tiene un código (`SEG-01`, `BE-03`…). Úsenlo en tickets, ramas y commits para trazarlo. |

---

## 1. Resumen ejecutivo (para el líder)

### Estado general

El proyecto tiene **buena base técnica**. El código es ordenado y está bien tipado, y el dinero se guarda con precisión decimal, nunca con aproximaciones. Hay pruebas automáticas de los cálculos y el equipo documenta sus decisiones. **Pero no está listo para manejar datos reales de nómina en producción.** Hay tres tipos de riesgo que hoy podrían causar daño real:

1. **Privacidad salarial.** Un consultor, con conocimientos técnicos básicos (abrir las herramientas del navegador), puede ver **la tarifa por hora de todos sus compañeros**. También puede ver el presupuesto, el precio de venta y el margen de todos los proyectos. La pantalla se lo oculta, pero el servidor se lo entrega igual.
2. **Integridad de la nómina y del cierre contable.**
   - Un consultor puede registrar horas extra **a nombre de otro**.
   - Un PM puede **aprobar sus propias horas**.
   - Se pueden aprobar horas o registrar gastos en **meses ya cerrados**, y entonces el cierre mensual deja de coincidir con la realidad.
   - Borrar un proyecto **borra en cascada** todo su historial contable.
   - El consolidado de nómina puede mostrar **pesos colombianos como si fueran dólares**, sin ningún aviso.
3. **Acceso abierto por configuración.** Si en el servidor falta **una sola variable de entorno**, la aplicación deja entrar a cualquiera de Internet **como administrador**, sin contraseña. Hay que confirmar hoy mismo que producción no está en ese estado (ver la acción inmediata más abajo).

### Semáforo por área

| Área | Estado | En una frase |
|---|---|---|
| Seguridad y permisos | 🔴 Rojo | Hay fugas de datos salariales y suplantación entre consultores; la autenticación queda abierta por defecto. |
| Flujos de aprobación (backend) | 🔴 Rojo | Faltan controles de quién aprueba qué, y el cierre mensual no se respeta en todos los módulos. |
| Cálculos de negocio | 🟠 Ámbar | La base es sólida, pero hay errores en moneda, en indicadores del tablero y en reglas de horas extra fijas en el código. |
| Base de datos | 🟠 Ámbar | El diseño es bueno, pero los borrados en cascada pueden destruir historia contable. |
| Frontend | 🟡 Amarillo | Funciona, pero la sesión caduca sin renovarse y los errores pasan sin aviso. Hay archivos demasiado grandes. |
| Pruebas automáticas | 🟠 Ámbar | Solo cubren los cálculos. Los flujos de aprobación y permisos, que son lo más riesgoso, no tienen ninguna prueba. |

> **Actualización del mismo día — comparación con Supabase:** al revisar la base real aparecieron dos problemas más, detallados en [Base de Datos/comparacion_supabase_2026-10-05.md](Base%20de%20Datos/comparacion_supabase_2026-10-05.md):
> - 🔴 **Toda la base está expuesta por la API pública de Supabase:** no tiene RLS y los roles `anon` y `authenticated` tienen todos los permisos. Es la primera acción de la Fase 0.
> - 🟠 **Supabase tiene 8 migraciones sin aplicar:** faltan `FinancialEntry`, `RunningTimer`, `JobRun` y columnas de `TimeEntry`.

### Acción inmediata (hoy, 5 minutos)

Pedir a un desarrollador que ejecute, **sin estar logueado**:

```bash
curl -s https://app-gestion-demo.onrender.com/api/auth/me
```

Si la respuesta contiene un usuario **"Local Admin"**, el servidor está abierto ahora mismo. En ese caso hay que configurar `AUTH_ENABLED=true` y `AUTH_DEMO_BYPASS=false` en Render antes de cargar cualquier dato real. Ver [SEG-03](#seg-03).

### Plan recomendado

| Fase | Duración estimada | Objetivo | Hallazgos |
|---|---|---|---|
| **Fase 0: bloqueantes** | 1 semana | Cerrar las fugas de datos salariales y la suplantación; impedir que la autenticación quede abierta. | SEG-01 a SEG-05, BE-01 |
| **Fase 1: integridad contable** | 1–2 semanas | Proteger el cierre mensual, evitar borrados en cascada y corregir la moneda en la nómina. | BE-02 a BE-04, BD-01, BD-02, NEG-01 |
| **Fase 2: confiabilidad** | 2 semanas | Corregir los indicadores del tablero, la renovación de sesión, los errores silenciosos y añadir pruebas de flujos. | NEG-02 a NEG-07, FE-01 a FE-05, QA-01 |
| **Fase 3: deuda técnica** | Continuo | Dividir archivos gigantes, añadir índices y paginación, mejorar accesibilidad y rendimiento. | Resto |

**Reparto sugerido para 3 desarrolladores:** el reparto sigue las especialidades de cada área; ajústenlo a las personas reales.

| Dev | Fase 0 | Fase 1 |
|---|---|---|
| **Dev A (backend / seguridad)** | SEG-01, SEG-02, SEG-04, SEG-05 | BE-02, BE-03 |
| **Dev B (backend / datos)** | SEG-03, BE-01 | BD-01, BD-02, NEG-01 |
| **Dev C (frontend + pruebas)** | Pruebas de ruta que reproduzcan SEG-01, SEG-02, SEG-04 y BE-01 antes del arreglo | FE-01 a FE-04 |

**Criterio de "listo para producción":** todas las fases 0 y 1 cerradas, cada una con una prueba automática que demuestre el arreglo, y `npm audit` sin vulnerabilidades altas.

---

## 2. Cómo leer este documento

| Severidad | Significado |
|---|---|
| 🔴 **Crítica** | Daño real explotable hoy: fuga de datos, fraude posible o pérdida de información. Arreglar antes de producción. |
| 🟠 **Alta** | Error de lógica con impacto en dinero, permisos o datos. Arreglar en el siguiente sprint. |
| 🟡 **Media** | Bug o deuda técnica con impacto acotado. Planificar. |
| ⚪ **Baja** | Mejora de calidad o de mantenibilidad. |

Las rutas de archivo son relativas a la raíz del repositorio. Los números de línea son los del commit `3dee1f7`.

---

## 3. Seguridad y permisos

<a id="seg-01"></a>
### SEG-01 🔴 Cualquier CONSULTANT puede leer la tarifa por hora de cualquier compañero

- **Dónde:** [extra-hours.routes.ts:578-635](../backend/src/modules/extra-hours/extra-hours.routes.ts#L578-L635) (`POST /api/extra-hours/calculate`) y [calculateExtraHours.ts:501](../backend/src/utils/calculateExtraHours.ts#L501).
- **Problema:** el endpoint acepta cualquier `consultantId` en el cuerpo y devuelve `hourlyRate` en el resultado. No escribe nada ni deja auditoría.
- **Escenario:**
  1. El consultor obtiene los ids de sus compañeros con `GET /api/consultants`.
  2. Llama a `/calculate` con cada id.
  3. Obtiene la tarifa de toda la plantilla, sin dejar rastro.
- **Arreglo:**
  - Pasar `consultantId` por `resolveTargetConsultantId` ([currentConsultant.ts:36](../backend/src/utils/currentConsultant.ts#L36)), como ya hacen time-entries y timer.
  - Quitar `hourlyRate` y `divisorUsed` de la respuesta cuando el usuario no pueda ver tarifas.

<a id="seg-02"></a>
### SEG-02 🔴 Un CONSULTANT puede registrar horas extra a nombre de otro y recibe la ficha completa de esa persona

- **Dónde:** [extra-hours.routes.ts:412-573](../backend/src/modules/extra-hours/extra-hours.routes.ts#L412-L573), en concreto las líneas 438 y 528 (`consultantId` del body), 546-549 (`include: { consultant: true }`) y 573.
- **Problema:** es suplantación en un flujo que termina en nómina. Además, la respuesta incluye `hourlyRate`, `costPerMonth` e `identification` (el documento de identidad) del compañero.
- **Arreglo:**
  - Usar `resolveTargetConsultantId`.
  - Devolver el consultor con `consultantSinDatosSensiblesSelect` a quien no pueda ver tarifas.

<a id="seg-03"></a>
### SEG-03 🔴 La autenticación queda abierta por defecto: cualquiera entra como ADMIN

- **Dónde:**
  - [env.ts:61-62](../backend/src/config/env.ts#L61-L62): `AUTH_ENABLED` vale `false` por defecto.
  - [guard.ts:185-193](../backend/src/auth/guard.ts#L185-L193): con autenticación apagada, inyecta un ADMIN fijo.
  - `backend/.env.example` combina `NODE_ENV=production` con `AUTH_ENABLED=false` y `AUTH_DEMO_BYPASS=true`.
  - `frontend/.env.production.example` trae `VITE_FORCE_LOCAL_AUTH=true`.
  - `render.yaml:32-35` deja ambas variables para configurarlas a mano (`sync:false`).
- **Escenario:** si nadie define `AUTH_ENABLED=true` en Render, cualquier persona en Internet obtiene permisos de administrador sin token.
- **Arreglo:**
  - Que la autenticación esté activa por defecto.
  - En `env.ts`, hacer `process.exit(1)` si `NODE_ENV=production` y el bypass está activo.
  - Quitar el bypass de los archivos `*.production.example`.

<a id="seg-04"></a>
### SEG-04 🔴 CONSULTANT recibe las finanzas de toda la empresa en `/api/stats/overview` y en `/api/projects`

- **Dónde:**
  - [stats.routes.ts:42](../backend/src/modules/stats/stats.routes.ts#L42) incluye `AppRole.CONSULTANT`, aunque ese rol no tiene `stats:read`.
  - [projects.routes.ts:105-124 y 178-188](../backend/src/modules/projects/projects.routes.ts#L105) devuelven `budget`, `sellPrice`, `marginThreshold` y `baselineBudget`.
  - [time-entries.routes.ts:368](../backend/src/modules/time-entries/time-entries.routes.ts#L368) incluye `project: true`.
- **Escenario:** en un proyecto con un solo consultor, `laborCostActual / approvedHours` revela su tarifa exacta. El precio de venta y el margen de todos los contratos quedan visibles con DevTools.
- **Arreglo:**
  - Quitar CONSULTANT de `authorize` en `/stats/overview`.
  - Usar una proyección de proyecto sin campos económicos para ese rol, también en el `include` de time-entries.

<a id="seg-05"></a>
### SEG-05 🟠 `GET /api/forecasts` entrega a VIEWER la ficha completa de los consultores

- **Dónde:** [forecasts.routes.ts:27-72](../backend/src/modules/forecasts/forecasts.routes.ts#L27-L72) usa `include: { consultant: true }` y devuelve `hourlyRate` y `sellRate` del forecast.
- **Problema:** es la misma fuga que ya se cerró en time-entries, extra-hours y activities, pero este módulo quedó sin cubrir.
- **Arreglo:** usar `consultantSinDatosSensiblesSelect` y ocultar `hourlyRate`, `sellRate` y `projectedCost` a quien no pueda ver tarifas.

<a id="seg-06"></a>
### SEG-06 🟠 Quitar un rol en Entra ID no lo quita en la aplicación, y cualquier usuario del tenant entra como CONSULTANT

- **Dónde:** [guard.ts:268-382](../backend/src/auth/guard.ts#L268-L382).
- **Problema:** los roles solo se sincronizan si el token trae `roles`. Si no trae ninguno, se conservan los que ya había en la base de datos. A un usuario nuevo sin roles se le asigna CONSULTANT y se le crea una ficha de consultor.
- **Escenario:** a un usuario de FINANCE le retiran el rol en Entra, pero sigue viendo la nómina. Cualquier invitado del tenant obtiene CONSULTANT, que es justo el rol que explotan SEG-01, SEG-02 y SEG-04.
- **Arreglo:**
  - Si el token no trae roles, revocar los roles de origen Entra en lugar de conservarlos.
  - Activar "Assignment required" en la Enterprise App de Azure.
  - No asignar ningún rol por defecto.

<a id="seg-07"></a>
### SEG-07 🟠 PM y FINANCE pueden cambiar multiplicadores de nómina, y PM puede crear festivos, sin auditoría

- **Dónde:**
  - [extra-hours.routes.ts:691-771](../backend/src/modules/extra-hours/extra-hours.routes.ts#L691-L771) (`PUT /config/:country` y `/reset`): admiten ADMIN, PM y FINANCE.
  - [custom-holidays.routes.ts:39,76](../backend/src/modules/holidays/custom-holidays.routes.ts#L39).
  - En la interfaz, `extrahours:config` solo lo tiene ADMIN.
- **Escenario:** un PM declara festivo el día en que su equipo hizo horas extra (recargo de 2x a 3x), o sube un multiplicador. No queda rastro de quién lo cambió.
- **Arreglo:**
  - Restringir esas rutas a ADMIN (o al rol que decida negocio).
  - Llamar a `writeAudit` con el estado anterior y el posterior.

<a id="seg-08"></a>
### SEG-08 🟠 La interfaz no deja escribir a FINANCE, pero el backend sí

- **Dónde:**
  - Gastos e ingresos: `expenses.routes.ts:50,80,118` y `revenue.routes.ts:53,82,126`.
  - Tasas FX: `fx.routes.ts:52,92`, sin auditoría.
  - Issues y change requests: `issues.routes.ts`, `change-requests.routes.ts`.
- **Problema:** los permisos de `roles.ts` y los `authorize([...])` de las rutas no coinciden. Cambiar una tasa FX altera todos los márgenes y la nómina en USD sin dejar rastro.
- **Arreglo:** alinear `authorize` con la matriz de permisos y auditar las escrituras de FX.

<a id="seg-09"></a>
### SEG-09 🟡 Datos de nómina en los logs de producción

- **Dónde:** [notifications.ts:79-83](../backend/src/utils/notifications.ts#L79-L83).
- **Problema:** sin SMTP configurado, se escribe en el log el texto completo del correo, con identificación y montos. `render.yaml` no declara variables `SMTP_*`, así que lo más probable es que producción esté en ese modo.
- **Arreglo:** registrar en el log solo `to` y `subject`.

<a id="seg-10"></a>
### SEG-10 🟡 La identidad del usuario depende del correo y no del `oid` de Entra

- **Dónde:** [guard.ts:71-73, 217](../backend/src/auth/guard.ts#L71-L73). `User.microsoftOid` existe pero nunca se compara.
- **Escenario:** si se reasigna el correo de un exempleado, la persona nueva hereda sus roles, su ficha y su historial.
- **Arreglo:** identificar al usuario por `oid` y `tid`, y tratar el correo como dato informativo.

<a id="seg-11"></a>
### SEG-11 🟡 El límite de peticiones funciona como un límite global

- **Dónde:** [app.ts:15-17, 46-55](../backend/src/app.ts#L15-L55): no hay `trustProxy`.
- **Problema:** todo el tráfico llega desde la IP del proxy de Vercel o Render, así que un solo script agota las 300 peticiones por minuto y bloquea a todos los usuarios.
- **Arreglo:** configurar `trustProxy`, o usar un `keyGenerator` por usuario autenticado.

<a id="seg-12"></a>
### SEG-12 🟡 Dependencias con vulnerabilidades altas

- **Paquetes:**
  - `fastify` ≤5.12.4: bypass de autenticación en handlers not-found encapsulados y spoofing de `X-Forwarded`.
  - `nodemailer` ≤10.0.5.
  - `fast-uri` y `find-my-way`.
- **Arreglo:** `npm audit fix` y subir de versión `fastify` y `nodemailer` en `backend/package.json`.

<a id="seg-13"></a>
### SEG-13 ⚪ Bajas de seguridad

- **Errores con detalle interno:** [consultants.routes.ts:248-252 y 315-319](../backend/src/modules/consultants/consultants.routes.ts#L248-L252) y `fx.routes.ts:230` devuelven `detail` y el `code` de Prisma, saltándose el manejador global de errores. Arreglo: `throw err`.
- **Tokens en `localStorage`:** [msal.ts:11](../frontend/src/auth/msal.ts#L11) guarda los tokens de MSAL ahí. Hoy no hay `dangerouslySetInnerHTML`, así que el riesgo es bajo; `sessionStorage` lo reduciría.
- **`xlsx` 0.18.5:** tiene avisos de seguridad sin parche en npm. Solo se usa para exportar, así que hoy no es explotable. Si algún día se importan archivos, migrar al build de la CDN de SheetJS.
- **Allowlist de Claude Code:** `.claude/settings.json` permite `npx prisma db push`, que contradice la regla del proyecto de usar solo migraciones. Recomendación: quitarlo.

**Ya corregido (verificado):**
- Las respuestas 500 ya no incluyen el stack en producción.
- Los correos ya escapan el HTML.
- No hay secretos commiteados.
- Los encabezados `x-dev-*` están bien protegidos.
- `GET /api/time-entries` ya acota los datos por rol.

---

## 4. Backend: flujos, transacciones y errores

<a id="be-01"></a>
### BE-01 🔴 Un PM puede aprobar horas propias y horas de proyectos ajenos, incluso en meses cerrados

- **Dónde:**
  - [time-entries.routes.ts:538-623](../backend/src/modules/time-entries/time-entries.routes.ts#L538-L623): approve y reject.
  - [time-entries.routes.ts:138-144](../backend/src/modules/time-entries/time-entries.routes.ts#L138-L144) (`canMutateEntry`): un PM puede borrar horas ya aprobadas.
  - [extra-hours.routes.ts:263-289](../backend/src/modules/extra-hours/extra-hours.routes.ts#L263-L289) (`canReviewExtraHour`): no excluye al propio solicitante.
- **Problema:** aprobar o rechazar no comprueba que el proyecto sea del PM ni llama a `isMonthClosed`.
- **Escenario:** un PM registra horas extra retroactivas a su nombre y las aprueba él mismo. Desde que la aprobación es única, entran directo a la nómina. Otro caso: alguien aprueba horas de abril después del cierre, y el `MonthlySnapshot` deja de coincidir con los datos.
- **Arreglo:**
  - Extraer un helper compartido de "puede revisar" que exija PM del proyecto o delegación activa, y que prohíba revisar lo propio.
  - Validar que el mes no esté cerrado.
  - Limitar el borrado de horas aprobadas a ADMIN.

<a id="be-02"></a>
### BE-02 🟠 El cierre mensual no se respeta en gastos, ingresos, movimientos financieros ni forecasts

- **Dónde:** `expenses.routes.ts`, `revenue.routes.ts`, `financial-entries.routes.ts` y `forecasts.routes.ts`. Ninguno llama a `isMonthClosed`.
- **Escenario:** se registra o se borra un gasto de un mes ya cerrado, y el cierre "inmutable" deja de coincidir con la rentabilidad que muestra el sistema.
- **Arreglo:** un helper `assertMonthOpen(projectId, fecha)` aplicado a toda escritura que mueva dinero.

<a id="be-03"></a>
### BE-03 🟠 Aprobar y rechazar no es atómico (condición de carrera)

- **Dónde:**
  - [time-entries.routes.ts:548-609](../backend/src/modules/time-entries/time-entries.routes.ts#L548-L609).
  - [extra-hours.routes.ts:788-956](../backend/src/modules/extra-hours/extra-hours.routes.ts#L788-L956).
- **Problema:** primero se lee el estado, después se compara y por último se hace `update where {id}`, sin condición sobre el estado.
- **Escenario:** dos revisores actúan a la vez: uno aprueba y el otro rechaza. Ambos pasan la comprobación y gana el último. Se envían notificaciones contradictorias.
- **Arreglo:** `updateMany({ where: { id, status: PENDING } })` y devolver 409 si `count === 0`.

<a id="be-04"></a>
### BE-04 🟠 Las delegaciones de aprobación nunca funcionan para un CONSULTANT

- **Dónde:** [extra-hours.routes.ts:781 y 893](../backend/src/modules/extra-hours/extra-hours.routes.ts#L781). Las rutas approve y reject hacen `authorize([ADMIN, PM])`.
- **Problema:** el `preHandler` devuelve 403 antes de que `canReviewExtraHour` pueda comprobar la delegación.
- **Arreglo:** autorizar también a CONSULTANT en esas rutas y dejar que el helper decida, junto con lo de BE-01.

<a id="be-05"></a>
### BE-05 🟠 `GET /api/consultants` escribe en la base de datos y hace N+1 consultas

- **Dónde:** [consultants.routes.ts:46-85](../backend/src/modules/consultants/consultants.routes.ts#L46-L85).
- **Problema:** en cada GET sincroniza las fichas de consultor: un `findFirst` y un `create` por usuario.
- **Escenario:** dos GET simultáneos crean fichas duplicadas, porque `email` no es único. El `catch` se traga el error.
- **Arreglo:** hacer la sincronización solo en el JIT del guard o en un job. Añadir el índice único de BD-04.

<a id="be-06"></a>
### BE-06 🟡 El cierre mensual (`POST /snapshots/close`) no es atómico

- **Dónde:** [snapshots.routes.ts:40-145](../backend/src/modules/snapshots/snapshots.routes.ts#L40-L145).
- **Problemas:**
  - Dos cierres simultáneos provocan un 500 por violación del índice único, porque `P2002` no se captura.
  - Pueden entrar horas o gastos entre la lectura y la creación.
  - No avisa si quedan horas `PENDING` en el mes.
- **Arreglo:** hacer la lectura y la creación dentro de `$transaction`, mapear `P2002` a 409 y avisar o bloquear si hay pendientes.

<a id="be-07"></a>
### BE-07 🟡 Las horas no tienen tope y el cronómetro acepta cualquier inicio pasado

- **Dónde:**
  - [time-entries.routes.ts:22,31](../backend/src/modules/time-entries/time-entries.routes.ts#L22): `hours` solo exige `positive()`.
  - [timer.routes.ts:102-105, 187-255](../backend/src/modules/timer/timer.routes.ts#L102-L105): `startedAt` solo se valida contra el futuro, y `/stop` no audita.
- **Escenario:** un `startedAt` de hace 30 días genera una entrada de unas 720 h en un solo día.
- **Arreglo:** poner un tope de 24 h por día y por consultor, un límite inferior para `startedAt` y `writeAudit` en `/stop`.

<a id="be-08"></a>
### BE-08 🟡 Errores de Prisma mal mapeados: 500 donde debería ser 400, 404 o 409

- **Dónde:**
  - [app.ts:77-101](../backend/src/app.ts#L77-L101) solo trata `ZodError`.
  - El bloque `try/catch` para `P2003/P2014` está copiado en 17 sitios.
  - `P2002` y `P2025` no se mapean en ninguno.
- **Casos concretos:**
  - `?from=abc` en `GET /time-entries` (líneas 42-44) da 500.
  - `PATCH /time-entries/:id` con un proyecto inexistente da 500 (líneas 512-522).
  - Un doble clic en `POST /timer/start` da 500 (líneas 107-127).
- **Arreglo:**
  - Un `setErrorHandler` central que traduzca P2002 a 409, P2025 a 404 y P2003 a 409. Después, borrar los 17 bloques copiados.
  - Validar las fechas con regex o con `z.coerce.date()`.

<a id="be-09"></a>
### BE-09 🟡 Asignaciones: estado y validación de sobrecarga defectuosos

- **Dónde:** [assignments.routes.ts:94-109, 183-208, 244-247](../backend/src/modules/assignments/assignments.routes.ts#L94-L109).
- **Problemas:**
  - `PUT` no recalcula el estado de la asignación.
  - `complete` puede dejar `endDate` anterior a `startDate`.
  - La sobrecarga suma todo lo que se solapa en cualquier punto del rango, en lugar de calcular el pico diario.
  - Ignora el modo HOURS.
  - No controla la concurrencia.
- **Arreglo:** recalcular el estado, usar `endDate = max(startDate, hoy)` y calcular el pico diario dentro de una transacción.

<a id="be-10"></a>
### BE-10 🟡 Endpoints GET que crean registros

- **Dónde:** [extra-hours.routes.ts:651-688](../backend/src/modules/extra-hours/extra-hours.routes.ts#L651-L688) (`GET /config/:country`) y BE-05.
- **Arreglo:** que un GET nunca escriba. Devolver 404 o un valor por defecto calculado.

<a id="be-11"></a>
### BE-11 🟡 Listados sin paginación y agregación en memoria

- **Dónde:**
  - `stats.routes.ts:57-84` (`/overview` carga todos los proyectos con todas sus horas, forecasts y movimientos) y `/portfolio`.
  - `capacity.routes.ts`.
  - `assignments`, `expenses` y `consultants`, que no paginan.
  - En total hay 62 `findMany` y solo 8 `take:`.
- **Escenario:** con años de datos, cada carga del tablero trae cientos de miles de filas y bloquea el servidor.
- **Arreglo:** agregar en SQL (`groupBy` / `aggregate`) y paginar los listados.

<a id="be-12"></a>
### BE-12 🟡 Fechas y zonas horarias

- **Dónde:**
  - [assignments.job.ts:10-11](../backend/src/modules/assignments/assignments.job.ts#L10-L11) usa `setHours` en hora local.
  - [delegations.routes.ts:11-12](../backend/src/modules/delegations/delegations.routes.ts#L11-L12).
- **Problema:** las delegaciones expiran al **empezar** su último día en lugar de al terminarlo.
- **Arreglo:** usar `Date.UTC` y normalizar `endDate` al final del día.

<a id="be-13"></a>
### BE-13 ⚪ Deuda técnica del backend

- **Archivo gigante:** `extra-hours.routes.ts` tiene 1.191 líneas y mezcla rutas, seed, valores por defecto, autorización y nómina. Dividirlo en `config`, `payroll` y `requests`.
- **Fallback duplicado:** el literal de configuración por defecto se repite 3 veces (`:493`, `:602`, `:670`).
- **Rutas copiadas:** `DELETE /consultants/:id` y `/by-name` son casi idénticos.
- **Auditoría fuera de la transacción:** `writeAudit` corre fuera de `$transaction`, así que si falla, el cliente recibe 500 con el cambio ya guardado.
- **Logging:** hay `console.error` en lugar de `getLogger()` en `extra-hours` y `feedback`.
- **Respuestas inconsistentes:** el envelope varía (`alerts/run` devuelve `{ message }`) y los mensajes de error mezclan español e inglés.
- **Cerrojo de jobs:** el anti-solapamiento de `jobs.service.ts` es una variable en memoria y no protege si hay varias instancias.

---

## 5. Lógica de negocio y cálculos

<a id="neg-01"></a>
### NEG-01 🔴 El consolidado de nómina muestra moneda local como si fuera USD

- **Dónde:** [extra-hours.routes.ts:1033-1049](../backend/src/modules/extra-hours/extra-hours.routes.ts#L1033-L1049).
- **Problema:**
  - Usa su propia búsqueda de tasas FX, sin pasar por `currency.ts`.
  - Si no encuentra la tasa, iguala `totalAmountUSD` a `totalAmountLocal` y no deja ninguna marca.
  - La moneda sale del consultor *actual*, porque `ExtraHourEntry` no guarda su propia moneda.
- **Ejemplo:** un consultor con 1.200.000 COP en horas extra y sin tasa USD/COP aparece con **1.200.000 USD**.
- **Arreglo:**
  - Usar `convertAmount`. Si no hay tasa, devolver `null` con una advertencia o un 422, como ya hace el cierre mensual.
  - Guardar la moneda en cada entrada de horas extra.

<a id="neg-02"></a>
### NEG-02 🟠 Los indicadores del tablero mezclan periodos y promedian mal

- **CPI calculado con datos de periodos distintos:** [stats.routes.ts:63-112](../backend/src/modules/stats/stats.routes.ts#L63-L112) toma el costo **del periodo filtrado**, pero el avance y los ingresos **de toda la vida del proyecto**.
  - Ejemplo: presupuesto 100k, avance 60 % y 10k de costo en el último mes dan **CPI 6.0 (verde)**. El detalle del proyecto, con el costo acumulado, da **0.86 (amarillo)**.
- **CPI del portafolio:** [stats.routes.ts:193-197](../backend/src/modules/stats/stats.routes.ts#L193-L197) y [DashboardTab.tsx:737](../frontend/src/features/dashboard/DashboardTab.tsx#L737) usan un promedio simple de CPI, sin ponderar.
  - Ejemplo: un proyecto de 1M con CPI 0.5 y otro de 10k con CPI 2.0 dan un EAC de 808k; el real es de unos 2M.
- **Delta de "Gastado":** [DashboardTab.tsx:605-613](../frontend/src/features/dashboard/DashboardTab.tsx#L605-L613) compara gastos brutos del periodo anterior, sin convertir moneda ni contar mano de obra, contra el total convertido del periodo actual.
- **Arreglo:**
  - Calcular el EVM siempre con el costo acumulado.
  - CPI del portafolio = ΣEV / ΣAC, calculado en el backend.
  - Que el periodo anterior lo calcule el backend con la misma fórmula.

<a id="neg-03"></a>
### NEG-03 🟠 Reglas legales de horas extra fijas en el código, por encima de la configuración

- **Multiplicadores fijos:** [calculateExtraHours.ts:249-393](../backend/src/utils/calculateExtraHours.ts#L249) fija los de Perú (1.25 / 1.35 / 2.0) y México (2.0 / 3.0), e ignora `ExtraHoursConfig`.
- **Ecuador:** la franja nocturna está fija en 22:00–06:00. El Código del Trabajo la define como 19:00–06:00, y hay que validarlo con el área legal.
- **Colombia:** el divisor de la Ley 2101 (210 desde el 2026-07-15) pisa la configuración sin avisar. Para fechas anteriores no se usan los divisores vigentes en cada momento (235, 230 y 220).
- **Divisor por defecto:** la ruta siempre envía `monthlyDivisor || 220`, así que los valores por defecto de otros países (240, 180) nunca se aplican.
- **País sin normalizar:** [extra-hours.routes.ts:453, 485-500](../backend/src/modules/extra-hours/extra-hours.routes.ts#L453) busca la configuración con el país sin normalizar (por ejemplo "colombia"). Cae en `Default` sin avisar. Si tampoco existe `Default`, usa recargos colombianos fijos.
- **Arreglo:**
  - Mover todos los parámetros a la configuración por país, con fechas de vigencia.
  - Normalizar el país antes de buscar la configuración.
  - Añadir a `warnings` cuando se use `Default`.

<a id="neg-04"></a>
### NEG-04 🟠 Horas extra pagadas en 0 o con una tarifa inventada

- **Dónde:** [calculateExtraHours.ts:138-161](../backend/src/utils/calculateExtraHours.ts#L138-L161).
- **Problemas:**
  - Si el consultor no tiene tarifa, todos los montos salen en 0 sin advertencia.
  - Si no hay consultor, se usa una tarifa mágica de 50, sin moneda.
  - Con hora de inicio igual a la de fin, se pagan **24 h**.
  - La regex acepta "99:99", que se desborda en silencio.
- **Arreglo:** devolver un error o una advertencia explícita, rechazar duraciones 0 y validar los rangos horarios.

<a id="neg-05"></a>
### NEG-05 🟡 `calculateExtraHours` no es pura: al editar una entrada, se cuenta a sí misma

- **Dónde:** [calculateExtraHours.ts:2, 70, 93, 365, 476](../backend/src/utils/calculateExtraHours.ts#L70).
- **Problema:** consulta Prisma desde dentro de la función.
- **Ejemplo:** en México, al editar una entrada de 9 h, el acumulado semanal ya incluye esas 9 h, así que se paga todo al 3.0x en lugar del 2.0x.
- **Arreglo:** recibir el consultor, los festivos y las horas previas de la semana (sin la propia entrada) como parámetros.

<a id="neg-06"></a>
### NEG-06 🟡 Errores en EVM y en el cálculo de rentabilidad

- **Avance 0 % tratado como "sin dato":** [evm.ts:199-205](../backend/src/utils/evm.ts#L199-L205).
  - Ejemplo: con avance 0 % y 50k gastados, el CPI sale `null` en lugar de 0, que sería la peor señal posible.
  - Además lee `new Date()` dentro de la función.
- **EAC distinto en frontend y backend cuando AC = 0:** [evm.ts:216](../backend/src/utils/evm.ts#L216) frente a `dashboardUtils.ts:22-23`. El frontend no debería recalcular el EVM.
- **Semáforo "ok" con presupuesto 0:** [financial.ts:347-363](../backend/src/utils/financial.ts#L347-L363) da "ok" con presupuesto 0 o sin tasa, aunque haya costo.
- **Horas aprobadas descontadas dos veces:** [financial.ts:315-326](../backend/src/utils/financial.ts#L315-L326). Con dos forecasts solapados del mismo consultor, el EAC sale subestimado.
- **Historia recalculada con datos de hoy:** [financial.ts:295-298](../backend/src/utils/financial.ts#L295-L298) usa la tarifa y la tasa FX **de hoy** para todo el costo pasado. Si se sube una tarifa, se reescribe el margen histórico.
- **Fórmula duplicada:** `alerts.service.ts`, `project-detail.routes.ts` y `snapshots.routes.ts` rehacen la suma de mano de obra, gastos e ingresos en lugar de usar `computeProjectFinancials`.

<a id="neg-07"></a>
### NEG-07 🟡 Festivos incompletos o incorrectos

- **Dónde:** [holidays.ts](../backend/src/utils/holidays.ts).
- **Errores por país:**
  - **Ecuador:** el traslado del 2 y el 3 de noviembre puede fusionar los dos días en uno (pasó en 2022).
  - **Chile:** falta el Día de los Pueblos Indígenas.
  - **Argentina:** falta Güemes y no se trasladan los feriados movibles.
  - **USA/Default:** faltan MLK Day, Presidents Day, Juneteenth y Veterans Day.
  - **Perú:** aplica feriados recientes a años anteriores a su creación.
- **Pruebas:** no hay ninguna de CL, PE, AR, ES, USA ni de los festivos que dependen de la Pascua.

<a id="neg-08"></a>
### NEG-08 ⚪ Otros cálculos

- **`capacity.ts`:**
  - `addDays` usa hora local.
  - `workDaysPerWeek = 4` se trata como 5.
  - Bloques solapados restan dos veces.
- **`currency.ts`:** el pivote de conversión es el primer par cargado, no una moneda explícita. Tampoco hay redondeo final a centavos.

---

## 6. Base de datos (Prisma)

<a id="bd-01"></a>
### BD-01 🔴 Borrar un proyecto destruye en cascada su historia contable

- **Dónde:** [schema.prisma:260, 313, 334, 426, 484](../backend/prisma/schema.prisma#L260) usan `onDelete: Cascade` hacia Project en TimeEntry, FinancialEntry, Forecast, Assignment y MonthlySnapshot. [projects.routes.ts:261](../backend/src/modules/projects/projects.routes.ts#L261) borra sin comprobar nada antes.
- **Escenario:** un PM borra por error un proyecto con tres meses cerrados. Se pierden horas aprobadas, gastos y cierres mensuales. La auditoría solo registra el proyecto.
- **Arreglo:**
  - Cambiar esas relaciones a `Restrict` con una migración nueva.
  - Cerrar proyectos con `status=CLOSED`, o añadir soft-delete.
  - Dejar el DELETE solo para ADMIN y rechazarlo si hay cierres o horas aprobadas.

<a id="bd-02"></a>
### BD-02 🟠 El cierre mensual (`MonthlySnapshot`) no es inmutable en la práctica

- **Dónde:** [schema.prisma:465-488](../backend/prisma/schema.prisma#L465-L488).
- **Problema:** el código solo lo crea, pero nada en la base de datos impide modificarlo o borrarlo (scripts, Studio, cascada). Tampoco existe un proceso para reabrir un mes.
- **Arreglo:**
  - Poner `Restrict` en la relación.
  - Añadir un trigger de Postgres `BEFORE UPDATE OR DELETE` que lance una excepción.
  - Aplicar BE-02.

<a id="bd-03"></a>
### BD-03 🟡 Horas extra aprobadas sin responsable

- **Dónde:** la migración `20260930120000_aprobacion_unica_pm`.
- **Problema:** pasó solicitudes `PENDING_FINANCE` a `APPROVED` con `approvedBy = NULL`. Los reportes directos muestran horas aprobadas sin responsable. El dato se puede recuperar del AuditLog.
- **Arreglo:** hacer un backfill de `approvedBy` desde el AuditLog y validar que toda solicitud `APPROVED` tenga `approvedBy`.

<a id="bd-04"></a>
### BD-04 🟡 Faltan restricciones de unicidad

- **Casos:**
  - `FxConfig` no tiene `@@unique([baseCode, quoteCode])`. Si hay dos tasas para el mismo par, se toma una arbitraria.
  - `FxRateHistory` no es única por par y fecha, así que un reintento duplica el historial.
  - `Consultant.email` no es único. Provoca los duplicados de BE-05.
- **Arreglo:** limpiar los duplicados y luego añadir `@@unique` (para el email, un índice case-insensitive).

<a id="bd-05"></a>
### BD-05 🟡 Tipos débiles

- **Fechas como texto:** `Forecast.startDate` y `endDate` son `String` con default `""` ([schema.prisma:324-325](../backend/prisma/schema.prisma#L324-L325)). Migrarlas a `DateTime`.
- **Estados y prioridades como texto libre** en lugar de enum: `Activity.activityType`, `status` y `priority`, `Assignment.periodUnit`, `Consultant.seniority`, `Estimation.riskLevel`.
- **Delegaciones por correo:** `ApprovalDelegation` usa correos sin FK a User y no tiene CHECK de fechas.
- **Horas como texto:** `startTime` y `endTime` son `String` sin validación de formato.
- **Mes sin restricción:** `MonthlySnapshot.month` no tiene CHECK 1..12.

<a id="bd-06"></a>
### BD-06 🟡 Faltan índices compuestos

- **Índices a añadir:**
  - TimeEntry: `(projectId, status, workDate)`.
  - FinancialEntry: `(projectId, type, entryDate)`.
  - ExtraHourEntry: `(consultantId, date)` y `(status, date)`.
  - Project: `(status)`.
  - Consultant: `(email)`.
  - ApprovalDelegation: `(projectId, toUserEmail, startDate, endDate)`.
- **Urgencia:** con el volumen actual no es urgente, pero sí antes de crecer.

<a id="bd-07"></a>
### BD-07 ⚪ Otros

- **Timestamps duplicados:** dos migraciones comparten el timestamp `20260930120000`. No hay que renombrarlas; basta con evitarlo en adelante.
- **Seed:** `seed.mjs` repite una corrección de datos que ya hace la migración `20260918130000`.
- **Consultores:** `Activity` se borra en cascada al borrar un consultor. Mejor usar el campo `active` como soft-delete.
- **Drift:** no se ejecutó `prisma migrate diff` porque no había base de datos disponible. Hay que ejecutarlo antes de dar el visto bueno.

---

## 7. Frontend

<a id="fe-01"></a>
### FE-01 🟠 La sesión caduca a la hora y la app no renueva el token

- **Dónde:** [App.tsx:1296-1298](../frontend/src/App.tsx#L1296-L1298) y [api.ts:43, 351, 364](../frontend/src/services/api.ts#L351).
- **Problema:** el token se obtiene una sola vez al arrancar. No hay renovación ni reintento ante un 401.
- **Escenario:** tras unos 60 minutos todas las llamadas fallan con un mensaje genérico.
- **Arreglo:** que `request()` llame a `acquireTokenSilent` en cada petición. Ante un 401, reintentar una vez y si vuelve a fallar, redirigir al login.

<a id="fe-02"></a>
### FE-02 🟠 Los errores de carga pasan en silencio

- **Dónde:** `useProjects`, `useConsultants`, `useExpenses`, `useForecasts`, `useRevenue`, `useFxConfigs`, `useAdminUsers` y `useAlerts`.
- **Problema:** usan `try/finally` sin `catch` y no exponen `error`.
- **Escenario:** un error 500 o un corte de red deja la tabla vacía sin ningún aviso, y el usuario cree que no hay datos.
- **Arreglo:** devolver `{ data, loading, error, reload }` y mostrar el error.

<a id="fe-03"></a>
### FE-03 🟠 Respuestas desordenadas y datos de otro rol que quedan visibles

- **Problemas:**
  - Ningún hook cancela las peticiones anteriores (no usan `AbortController`).
  - [CapacityTab.tsx:246, 601, 773, 1203](../frontend/src/features/capacity/CapacityTab.tsx#L246) desactiva `exhaustive-deps`.
  - Al cambiar rápido de filtro, una respuesta vieja puede pisar a la nueva.
  - Cuando `enabled` pasa a `false` (logout o simulador de rol), los datos anteriores no se limpian, así que el siguiente usuario o rol los ve brevemente.
- **Arreglo:** un hook compartido `useAsyncResource` con `signal`, un contador de petición y que limpie los datos cuando `!enabled`.

<a id="fe-04"></a>
### FE-04 🟡 El servidor de producción del frontend se cae con una URL malformada

- **Dónde:** `frontend/server.mjs:~85-107`.
- **Problemas:**
  - `decodeURIComponent` lanza una excepción fuera de un `try/catch` con una URL como `/%E0%A4%A`, y eso tumba el proceso.
  - El filtro `startsWith(distDir)` no exige el separador, así que acepta directorios hermanos como `dist-x`.
- **Arreglo:** envolver en `try/catch` y devolver 400, comparar contra `distDir + path.sep` y añadir caché `immutable` a `/assets/*`.
- **Nota:** solo aplica si se usa `npm run start`. En Vercel no se usa ese servidor.

<a id="fe-05"></a>
### FE-05 🟡 Arquitectura: archivos gigantes y todo en un solo bundle

- **Archivos más grandes:**

  | Archivo | Líneas |
  |---|---|
  | `EstimationCalculatorTab.tsx` | 2.284 |
  | `api.ts` | 2.245 |
  | `App.tsx` | 2.125, con unos 80 `useState` |
  | `ActivitiesTab.tsx` | 2.121 |
  | `ExtraHoursTab.tsx` | 1.992 |

- **Bundle:** no hay `React.lazy`. Las 21 pantallas van en un solo bundle, y `chunkSizeWarningLimit: 1000` oculta el aviso de tamaño.
- **Routing manual:** [App.tsx:1198-1260](../frontend/src/App.tsx#L1198-L1260) tiene seis efectos que comparten estado y pueden entrar en bucle.
- **Arreglo:**
  - Extraer `AppShell`, `useAppRouter`, `useAuthSession` y `useGlobalShortcuts`.
  - Un `PermissionsContext` para `can`.
  - `React.lazy` por pestaña.
  - Dividir `api.ts` por dominio, con un `index.ts` que re-exporte.

<a id="fe-06"></a>
### FE-06 🟡 Rendimiento: sin caché ni paginación

- **Problema:** cada `reload()` vuelve a traer el dataset completo después de cada mutación. Hay 41 tablas y ninguna está virtualizada.
- **Arreglo:** paginación en el servidor (junto con BE-11) y actualizaciones locales tras mutar.

<a id="fe-07"></a>
### FE-07 🟡 Accesibilidad y atajos de teclado

- **Elementos sin accesibilidad:** hay 25 `<div onClick>` sin `role`, sin `tabIndex` y sin soporte de teclado. 18 pantallas no tienen ningún atributo `aria-*`.
- **Atajos:** `Alt+N/H/F/C` y `Escape` ([App.tsx:1113-1160](../frontend/src/App.tsx#L1113-L1160)) se disparan aunque se esté escribiendo en un campo. `Alt` además choca con AltGr en teclados en español.
- **Modales:** no atrapan el foco.

<a id="fe-08"></a>
### FE-08 ⚪ Otros del frontend

- **Traducción de errores:** `request()` mezcla el transporte con la traducción de errores. `FIELD_MAP` se recrea en cada error y el mensaje de fallback sale en inglés.
- **Keys por índice:** `key={i}` en `DashboardTab` y `EstimationCalculatorTab`.
- **Parpadeo del tema:** el tema oscuro parpadea al cargar. Aplicarlo con un script inline en `index.html`.
- **Bypass en producción:** el código del bypass de autenticación (`VITE_FORCE_LOCAL_AUTH`) se incluye en el build de producción. Excluirlo con `import.meta.env.DEV`.
- **`vercel.json`:**
  - No define cabeceras de seguridad (CSP, X-Frame-Options).
  - El rewrite universal también captura `/env.js` y los assets inexistentes.
  - La URL del backend está fija.

---

## 8. Pruebas y calidad del proceso

<a id="qa-01"></a>
### QA-01 🟠 No hay ninguna prueba de rutas, permisos ni flujos de aprobación

- **Situación actual:** solo hay pruebas de funciones puras (9 archivos en el backend y 18 en el frontend). Los hallazgos más graves de este informe (SEG-01 a SEG-05, BE-01 a BE-04) habrían salido con pruebas de ruta.
- **Recomendación:**
  - Añadir pruebas con `app.inject()` de Fastify y Prisma mockeado (o una base de datos de prueba) para: quién puede aprobar qué, el cierre mensual, el alcance de datos por rol y la suplantación de `consultantId`.
  - **Regla de equipo:** todo arreglo de seguridad o de flujo entra acompañado de la prueba que lo reproduce.

**Utils sin pruebas:** `notifications.ts`, `audit.ts`, `country.ts`, `consultant-scope.ts` y `currentConsultant.ts`. Los dos últimos son justamente los que deciden el alcance por rol.

### QA-02 🟡 No se pudieron ejecutar las pruebas, el lint ni la compilación

Ni `backend/` ni `frontend/` tienen `node_modules` instalados, así que esta revisión **no tiene resultados de ejecución**. Antes de empezar los arreglos, un desarrollador debe correr y registrar el resultado:

```bash
cd backend  && npm ci && npm test && npx tsc --noEmit && npm audit --omit=dev
cd frontend && npm ci && npm run lint && npx tsc -b && npm test
```

**Recomendación:** un workflow de CI (GitHub Actions) que ejecute lo anterior en cada PR. El workflow actual de Azure Static Web Apps no funciona y debería borrarse o reemplazarse.

### QA-03 ⚪ `CLAUDE.md` y la documentación técnica están desactualizados

| Dice | Realidad verificada |
|---|---|
| Node 20.19.0 en `.nvmrc` y `render.yaml` | `.nvmrc` está en `backend/` y `frontend/`, y `render.yaml` usa **24.13.0**. Las versiones ya son consistentes (24). |
| No hay scheduler | `server.ts` tiene `startJobsScheduler` (desactivado con `JOBS_INTERVAL_MINUTES=0`), `POST /api/jobs/run` y un cron de Render. |
| Horas extra con aprobación doble (PM y luego Finanzas) | Desde el commit `32d0583` basta la aprobación del PM. |
| Las respuestas 500 incluyen el stack | Corregido en producción. |

Actualizar `CLAUDE.md` y la tabla §10.1 de `DOCUMENTACION_TECNICA.md`.

---

## 9. Aspectos positivos

Para que el equipo sepa qué **mantener**:

1. **Dinero 100 % `Decimal`** con precisiones coherentes; nunca `Float`.
2. **Errores centralizados:** el handler global responde un 500 genérico en producción y traduce los errores de validación a 400 con rutas legibles. Todas las rutas leídas usan `authenticate` + `authorize` y validan con Zod antes de llegar a la base de datos.
3. **Identidad tomada del token:** quien aprueba sale de `request.authUser`, nunca del cuerpo de la petición. Los listados críticos (time-entries, extra-hours) combinan el alcance por rol con los filtros mediante `AND`, de modo que el filtro nunca amplía lo visible.
4. **Moneda faltante visible:** el `ConversionLedger` hace que la falta de tasa viaje con el dato, y el cierre mensual bloquea con 422 en lugar de congelar un número aproximado.
5. **Una fuente para las finanzas:** `computeProjectFinancials` alimenta overview, portfolio, detalle y alertas; el semáforo de salud ya no se calcula en el frontend.
6. **Festivos en UTC,** con la Ley Emiliani y los festivos de Pascua de Colombia correctos.
7. **Jobs bien diseñados:** cerrojo anti-solapamiento, aislamiento de errores, rastro persistente de ejecuciones y apagado ordenado.
8. **Frontend bien tipado:** cero `any` y cero `@ts-ignore`, con solo 4 `eslint-disable`. La configuración en runtime (`env.js`) permite desplegar sin recompilar.
9. **Migraciones bien hechas:** son idempotentes, y las migraciones de datos dejan rastro en el AuditLog.
10. **Decisiones documentadas:** los comentarios explican el *porqué* de cada decisión.

---

## 10. Métricas del repositorio

| Métrica | Valor |
|---|---|
| Commits en `main` | 188 |
| Módulos de backend | 25 carpetas, 31 plugins registrados |
| Modelos Prisma / enums / migraciones | 28 / 24 / 13 |
| Líneas de frontend (`src/**/*.ts(x)`) | ~28.000 |
| Archivos de rutas con `$transaction` | 4 de 25 |
| Rutas con escritura sin `writeAudit` | timer, fx, custom-holidays, issues, milestones, risks, profile, financial-entries, feedback y config de horas extra |
| Listados paginados | 3 (time-entries, extra-hours, audit) |
| Archivos de prueba | 9 en backend (utils) y 18 en frontend |

---

## 11. Índice de hallazgos

| ID | Sev. | Título corto | Fase |
|---|---|---|---|
| SEG-01 | 🔴 | Consultor lee la tarifa de cualquiera (`/extra-hours/calculate`) | 0 |
| SEG-02 | 🔴 | Horas extra a nombre de otro y fuga de su ficha | 0 |
| SEG-03 | 🔴 | Autenticación abierta por defecto | 0 |
| SEG-04 | 🔴 | Consultor ve las finanzas de todos los proyectos | 0 |
| BE-01 | 🔴 | PM autoaprueba, aprueba proyectos ajenos y meses cerrados | 0 |
| NEG-01 | 🔴 | Nómina en moneda local mostrada como USD | 1 |
| BD-01 | 🔴 | Borrar un proyecto borra en cascada su historia contable | 1 |
| SEG-05 | 🟠 | Forecasts filtran datos salariales a VIEWER | 0 |
| SEG-06 | 🟠 | Roles de Entra no se revocan; rol por defecto CONSULTANT | 1 |
| SEG-07 | 🟠 | PM y FINANCE cambian multiplicadores y festivos sin auditoría | 1 |
| SEG-08 | 🟠 | FINANCE escribe en el backend aunque la interfaz no lo permite | 1 |
| BE-02 | 🟠 | Cierre mensual no respetado en gastos, ingresos y forecasts | 1 |
| BE-03 | 🟠 | Condición de carrera en aprobar y rechazar | 1 |
| BE-04 | 🟠 | Delegaciones inútiles para CONSULTANT | 1 |
| BE-05 | 🟠 | GET de consultores escribe y hace N+1 | 1 |
| BD-02 | 🟠 | Cierre mensual modificable | 1 |
| NEG-02 | 🟠 | KPIs del tablero mezclan periodos y promedian mal | 2 |
| NEG-03 | 🟠 | Reglas legales de horas extra fijas en el código | 2 |
| NEG-04 | 🟠 | Horas extra en 0, tarifa 50 o turnos de 24 h | 2 |
| FE-01 | 🟠 | Token sin renovación | 2 |
| FE-02 | 🟠 | Errores de carga silenciosos | 2 |
| FE-03 | 🟠 | Carreras en fetch y datos de otro rol visibles | 2 |
| QA-01 | 🟠 | Sin pruebas de rutas ni permisos | 0–2 |
| SEG-09…12 | 🟡 | Logs con nómina, identidad por correo, rate limit, dependencias | 2 |
| BE-06…12 | 🟡 | Atomicidad del cierre, topes de horas, errores Prisma, asignaciones, paginación, zonas horarias | 2–3 |
| NEG-05…07 | 🟡 | Función no pura, EVM y rentabilidad, festivos | 2–3 |
| BD-03…06 | 🟡 | approvedBy nulo, unicidades, tipos, índices | 2–3 |
| FE-04…07 | 🟡 | server.mjs, arquitectura, rendimiento, accesibilidad | 3 |
| QA-02 | 🟡 | Ejecutar pruebas, lint y audit; montar CI | 0 |
| SEG-13, BE-13, NEG-08, BD-07, FE-08, QA-03 | ⚪ | Deuda técnica y documentación | 3 |
