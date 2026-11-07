# Roles y permisos — estado actual

> Foto del sistema al **2026-11-07**, sacada del código (no de otros documentos).
> Pensado para editarse a mano: cambia las celdas de las tablas §2 y §3 al esquema que quieras
> y luego se ajusta el sistema a partir de este archivo.
>
> Leyenda: **✏️** ve y edita · **👁** solo ve · **—** no ve la pantalla (no aparece en el menú
> y si entra por URL lo redirige a su primera pantalla permitida).

Fuentes de verdad en el código:

| Qué                                                      | Dónde                                                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Catálogo de permisos y qué permisos tiene cada rol      | [backend/src/auth/roles.ts](../backend/src/auth/roles.ts) (`rolePermissions`)                                                 |
| Qué permiso pide cada pantalla del menú                 | [frontend/src/config/sidebar.ts](../frontend/src/config/sidebar.ts) (`SIDEBAR_GROUPS`)                                        |
| Qué permiso habilita la edición dentro de cada pantalla | [frontend/src/App.tsx](../frontend/src/App.tsx) (props `canWrite`, `canPublish`, …)                                        |
| Qué roles acepta cada endpoint                           | `authorize([...])` / `requirePermission(...)` en cada `*.routes.ts` (listado en [MAPA_PROYECTO.md](MAPA_PROYECTO.md) §1) |

---

## 1. Perfiles (roles)

| Rol            | Nombre de negocio  | Cómo se obtiene                                          |
| -------------- | ------------------ | --------------------------------------------------------- |
| `ADMIN`      | Administrador      | Rol de Entra ID, o el correo de `ADMIN_EMAIL` (siempre) |
| `PM`         | Jefe de proyecto   | Rol de Entra ID                                           |
| `CONSULTANT` | Consultor          | Rol de Entra ID, o por defecto si el token no trae roles  |
| `FINANCE`    | Finanzas / Nómina | Rol de Entra ID (`FINANCE` o `NOMINA`)                |
| `COMMERCIAL` | Comercial          | Rol de Entra ID (`COMMERCIAL` o `COMERCIAL`)          |
| `VIEWER`     | Observador         | Rol de Entra ID                                           |

Un usuario puede tener varios roles: sus permisos son la **unión** de los de cada rol.
Azure AD manda: si el token trae roles, reemplazan los locales en cada login.

---

## 2. Acceso a pantallas por rol

| Grupo              | Pantalla                    | ADMIN |   PM   | CONSULTANT | FINANCE | COMMERCIAL | VIEWER | Permiso para verla                   | Permiso para editar                                                      |
| ------------------ | --------------------------- | :---: | :-----: | :--------: | :-----: | :--------: | :-----: | ------------------------------------ | ------------------------------------------------------------------------ |
| Gobierno           | Dashboard                   |  👁  |   👁   |     —     |   👁   |     —     |   👁   | `stats:read`                       | —                                                                       |
| Gobierno           | Portafolio                  | ✏️ |  ✏️  |     —     |   👁   |     —     |   👁   | `stats:read`                       | `projects:write`                                                       |
| Gobierno           | Proyectos (lista y detalle) | ✏️ |  ✏️  |     —     |   👁   |     —     |   👁   | `projects:read`                    | `projects:write`                                                       |
| Gobierno           | Capacidad                   | ✏️ |   👁   |     —     |   👁   |     👁     |   👁   | `capacity:read`                    | `assignments:write` (asignar), `capacity:publish` (publicar reporte) |
| Operación         | Consultores                 | ✏️ |  ✏️  |     —     |   —   |     —     |   👁   | `consultants:read`                 | `consultants:write`                                                    |
| Operación         | Rastreador (cronómetro)    | ✏️ |  ✏️  |    ✏️    |   —   |     —     |   👁   | `time:read`                        | `time:write`                                                           |
| Operación         | Horas (timesheet)           | ✏️ |  ✏️  |    ✏️    |   —   |     —     |   👁   | `time:read`                        | `time:write`                                                           |
| Operación         | Aprobación de horas        | ✏️ | ✏️ ¹ |  ✏️ ¹  | ✏️ ¹ |   —    | ✏️ ¹ | ¹ No depende del permiso            | —                                                                       |
| Operación         | Informes                    |  👁  |   👁   |     —     |   👁   |     —     |   👁   | `stats:read`                       | —                                                                       |
| Operación         | Actividades                 | ✏️ |   —   |     —     |   —   |     —     |   —   | `activities:manage`                | —                                                                       |
| Operación         | Horas Extra                 | ✏️ |  ✏️  |    ✏️    |   —   |     —     |   👁   | `extrahours:read`                  | `extrahours:write`                                                     |
| Financiero         | Ingresos/Gastos             | ✏️ |  ✏️  |     —     |  ✏️  |     —     |   👁   | `expenses:read` o `revenue:read` | `expenses:write` / `revenue:write`                                   |
| Financiero         | Estimaciones                | ✏️ |  ✏️  |     —     |   —    |     —     |   —   | `estimations:read`                 | `estimations:write`                                                    |
| Financiero         | Tasas FX                    | ✏️ |   👁   |     —     |  ✏️  |     —     |   👁   | `fx:read`                          | `fx:write` o `users:manage`                                          |
| Administración    | Usuarios                    | ✏️ |   —   |     —     |   —   |     —     |   —   | `users:manage`                     | —                                                                       |
| Administración    | Config. Horas Extra         | ✏️ |   —   |     —     |   —   |     —     |   —   | `extrahours:config`                | —                                                                       |
| Administración    | Parámetros y Jornada       | ✏️ |   —   |     —     |   —   |     —     |   —   | `capacity:config`                  | `capacity:config`                                                      |
| Administración    | Feriados                    | ✏️ |   —   |     —     |   —   |     —     |   —   | `holidays:write`                   | `holidays:write`                                                       |
| Administración    | Umbrales de Salud           | ✏️ |   —   |     —     |   —   |     —     |   —   | `health:thresholds`                | —                                                                       |
| Administración    | Resumen de Aprobaciones     | ✏️ |   —   |     —     |   —   |     —     |   —   | `notifications:digest`             | —                                                                       |
| Administración    | Tipos de Hora               | ✏️ |   —   |     —     |   —   |     —     |   —   | `time:types`                       | `time:types`                                                           |
| Administración    | Categorías Financieras     | ✏️ |   —   |     —     |   —   |     —     |   —   | `finance:categories`               | `finance:categories`                                                   |
| Administración    | Auditoría                  |  👁  |   —   |     —     |   👁   |     —     |   —   | `audit:read`                       | —                                                                       |
| (menú de usuario) | Mi perfil                   | ✏️ |  ✏️  |    ✏️    |  ✏️  |    ✏️    |  ✏️  | ninguno                              | —                                                                       |

¹ **Aprobación de horas** (timesheet semanal) la decide `GET /api/timesheet-reviews/count` →
`canReview`, que es verdadero si el usuario es **ADMIN** (siempre, haya o no pendientes), es el
`projectManagerEmail` de algún proyecto, tiene una delegación de aprobación vigente, o tiene
semanas enviadas a su cargo. Si no cumple nada de eso, no la ve. COMMERCIAL nunca la ve (el
endpoint no acepta ese rol). Es un permiso sintético (`timesheet:review-queue`) que no está en
la matriz. La aprobación de **horas extra** es otra cosa: vive dentro de la pantalla Horas Extra.

² **FINANCE en Horas Extra**: ve la pantalla y la nómina (`/api/extra-hours/payroll`, solo
ADMIN y FINANCE), pero no registra horas extra. Aprobar o rechazar no depende del rol: el
endpoint acepta a cualquier autenticado y la regla de negocio es la aprobación única del PM.

---

## 3. Catálogo de permisos por rol

Esto es lo que hay hoy en `rolePermissions`. Si cambias la tabla §2, el cambio real se hace aquí.

| Permiso                  | Qué controla                               | ADMIN | PM | CONSULTANT | FINANCE | COMMERCIAL | VIEWER |
| ------------------------ | ------------------------------------------- | :---: | :-: | :--------: | :-----: | :--------: | :----: |
| `stats:read`           | Dashboard, Portafolio, Informes             |  ✅  | ✅ |            |   ✅   |            |   ✅   |
| `projects:read`        | Ver proyectos                               |  ✅  | ✅ |            |   ✅   |            |   ✅   |
| `projects:write`       | Crear/editar proyectos                      |  ✅  | ✅ |            |        |            |        |
| `consultants:read`     | Ver consultores (incluye tarifas)           |  ✅  | ✅ |            |        |            |   ✅   |
| `consultants:write`    | Editar consultores                          |  ✅  | ✅ |            |        |            |        |
| `time:read`            | Ver horas y cronómetro                     |  ✅  | ✅ |     ✅     |        |            |   ✅   |
| `time:write`           | Registrar horas                             |  ✅  | ✅ |     ✅     |        |            |        |
| `time:review`          | *(sin uso real, ver §4)*                 |  ✅  | ✅ |            |        |            |        |
| `time:types`           | Catálogo de tipos de hora                  |  ✅  |    |            |        |            |        |
| `expenses:read`        | Ver gastos                                  |  ✅  | ✅ |            |   ✅   |            |   ✅   |
| `expenses:write`       | Registrar gastos                            |  ✅  | ✅ |            |   ✅   |            |        |
| `revenue:read`         | Ver ingresos                                |  ✅  | ✅ |            |   ✅   |            |   ✅   |
| `revenue:write`        | Registrar ingresos                          |  ✅  | ✅ |            |   ✅   |            |        |
| `finance:categories`   | Catálogo de categorías de gasto/ingreso   |  ✅  |    |            |        |            |        |
| `fx:read`              | Ver tasas FX                                |  ✅  | ✅ |            |   ✅   |            |   ✅   |
| `fx:write`             | Editar tasas FX                             |  ✅  |    |            |   ✅   |            |        |
| `capacity:read`        | Ver capacidad y asignaciones                |  ✅  | ✅ |            |   ✅   |     ✅     |        |
| `assignments:write`    | Crear/mover asignaciones y bloqueos         |  ✅  |    |            |        |            |        |
| `capacity:config`      | Jornada laboral y parámetros               |  ✅  |    |            |        |            |        |
| `capacity:publish`     | Publicar/anular reporte oficial de capacity |  ✅  |    |            |        |            |        |
| `holidays:read`        | Leer feriados                               |  ✅  | ✅ |     ✅     |   ✅   |     ✅     |   ✅   |
| `holidays:write`       | Administrar feriados                        |  ✅  |    |            |        |            |        |
| `extrahours:read`      | Ver horas extra                             |  ✅  | ✅ |     ✅     |   ✅   |            |   ✅   |
| `extrahours:write`     | Registrar horas extra                       |  ✅  | ✅ |     ✅     |        |            |        |
| `extrahours:review`    | *(sin uso real, ver §4)*                 |  ✅  | ✅ |            |   ✅   |            |        |
| `extrahours:config`    | Recargos por país                          |  ✅  |    |            |        |            |        |
| `estimations:read`     | Ver estimaciones                            |  ✅  | ✅ |     ✅     |   ✅   |            |        |
| `estimations:write`    | Crear estimaciones                          |  ✅  | ✅ |            |        |            |        |
| `activities:manage`    | Pantalla de Actividades (oculta por D-8)    |  ✅  |    |            |        |            |        |
| `alerts:read`          | *(sin uso real, ver §4)*                 |  ✅  | ✅ |     ✅     |        |            |   ✅   |
| `alerts:resolve`       | *(sin uso real, ver §4)*                 |  ✅  | ✅ |            |        |            |        |
| `snapshots:close`      | *(sin uso real, ver §4)*                 |  ✅  |    |            |   ✅   |            |        |
| `audit:read`           | Bitácora de auditoría                     |  ✅  |    |            |   ✅   |            |        |
| `users:manage`         | Usuarios y roles                            |  ✅  |    |            |        |            |        |
| `health:thresholds`    | Umbrales CPI/SPI/presupuesto                |  ✅  |    |            |        |            |        |
| `notifications:digest` | Día/hora del resumen semanal               |  ✅  |    |            |        |            |        |

---

## 4. Cosas a tener en cuenta antes de reorganizar

1. **Dos sistemas de autorización.** El menú se gobierna con la matriz de §3, pero la mayoría
   de los endpoints (29 módulos) validan con `authorize([AppRole...])`, una lista de roles fija
   en el código. Solo capacity, asignaciones, feriados y tipos de hora usan `requirePermission`,
   que sí lee la matriz. Consecuencia: **dar una pantalla a un rol en la matriz no basta** si el
   endpoint que la alimenta no acepta ese rol (la pantalla saldría vacía o con 403), y quitarla
   del menú no impide llamar a la API.
2. **Permisos declarados que nadie consulta**: `time:review`, `extrahours:review`,
   `alerts:read`, `alerts:resolve` y `snapshots:close` existen en la matriz pero ni el frontend
   ni el backend los usan; las aprobaciones y el cierre de mes se deciden por rol crudo en las rutas.
3. **Pantalla de Alertas inaccesible**: existe (`AlertsTab`, ruta `/alerts`) pero no tiene
   entrada en el menú, así que la guarda de navegación expulsa a cualquiera que entre por URL.
4. **VIEWER ve datos sensibles**: tiene `consultants:read` (tarifas de la plantilla) y, por el
   hallazgo conocido de `GET /api/time-entries`, las horas de todos.
5. **Tasas FX**: la edición se habilita con `fx:write` **o** `users:manage` (atajo para ADMIN).

### Nota de diseño: el simulador de vista y "Aprobación de horas"

**Qué se observa.** Un ADMIN que usa el selector **VISTA** de la cabecera ve la entrada
"Aprobación de horas" en el menú con cualquier rol simulado, incluidos Financiero y Comercial.

**Por qué pasa.**
- El simulador solo reemplaza los permisos que usa el menú, tomándolos de la matriz de §3
  ([App.tsx](../frontend/src/App.tsx), `handleSwitchRole`). No cambia la sesión real: el
  backend sigue respondiendo con los roles del token.
- La entrada "Aprobación de horas" no sale de la matriz. Sale de
  `GET /api/timesheet-reviews/count`, que se consulta con el usuario **real**. Para un ADMIN
  siempre responde `canReview: true`.
- El frontend suma ese resultado como el permiso sintético `timesheet:review-queue` encima
  de los permisos simulados ([App.tsx](../frontend/src/App.tsx), cálculo de `visibleGroups`).
  Por eso la entrada aparece sea cual sea la vista elegida.

**Impacto.** Solo visual y solo para administradores que usan el simulador. Los usuarios
reales ven la entrada según la regla de la nota ¹ de §2: Comercial nunca la ve, y Financiero
solo si dirige un proyecto o tiene una delegación vigente.

**Decisión (2026-11-07).** No se ajusta en el corto plazo. Arreglarlo con exactitud no es
posible desde el simulador, porque la regla real depende de quién es la persona (si es PM de
un proyecto o tiene delegaciones) y no de su rol. Si más adelante molesta, la salida sencilla
es que, mientras se simula un rol, el menú aplique una regla aproximada: mostrar la entrada
con PM y ocultarla con los demás roles.

---

## 5. Hacia roles y permisos configurables desde la aplicación

Propuesta para conversar (no implementada):

- **Qué sería configurable**: la matriz rol × permiso de §3 (qué puede cada rol). Los
  **roles** siguen viniendo de Entra ID: la app no los crea, solo decide qué significa cada uno.
  El catálogo de permisos sí queda en el código, porque cada permiso corresponde a algo que el
  código comprueba.
- **Dónde**: una pantalla *Administración → Roles y permisos* (permiso `users:manage` o uno nuevo
  `roles:manage`), con la tabla de §3 como cuadrícula de casillas.
- **Cómo**: tabla `RolePermission (role, permission)` sembrada con los valores actuales;
  `rolePermissions` pasa a leerse de la base con caché en memoria (se invalida al guardar);
  cada cambio va a `AuditLog`. `GET /api/auth/permissions` ya expone la matriz al frontend, así
  que el menú y el simulador de rol se adaptan solos.
- **Requisito previo**: migrar los `authorize([...])` de las rutas a `requirePermission(...)`
  (punto 1 de §4). Sin eso, la pantalla de configuración solo movería el menú y no los accesos
  reales.
- **Protecciones**: ADMIN no editable (o al menos sin poder quitarse `users:manage`), para no
  dejar el sistema sin administrador.
