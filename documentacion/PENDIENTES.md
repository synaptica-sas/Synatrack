# Pendientes de Synatrack

Lista viva de lo que falta. Si vas a tomar algo, empieza por aquí.

**Actualizado:** 2026-10-06 · **Rama con todo lo hecho:** `dev`

Para el detalle de cada arreglo ya hecho, ver `documentacion/cambios/`.
Para el histórico completo de la depuración, `documentacion/BACKLOG_DEPURACION.md`
(42 ítems, 29 resueltos). Para las decisiones de negocio ya tomadas, con su justificación
completa, `documentacion/DECISIONES_REUNION.md`. Para el backlog de usuario recibido a
principios de septiembre (53 ítems, verificados contra el código actual), §6 de este mismo
documento. Este documento es el que hay que mirar para saber qué queda.

---

## 0. Lo primero: nada de esto está en producción

`dev` va **45 commits por delante de `main`**. Producción sigue en el estado de
principios de septiembre, así que **todo lo arreglado no le sirve a nadie todavía**: el
drift del esquema, las fugas de tarifas, la suplantación al registrar horas, el cron de
tasas de cambio apuntando a un host inexistente, la auditoría, el planificador de tareas.

**El procedimiento completo, con los comandos ya ensayados, está en
`documentacion/DESPLIEGUE.md`.** Decisión tomada: como lo que hay en producción son datos de
prueba, la base de Supabase se rehace desde cero en vez de intentar reconciliar su historial
de migraciones.

Resumen de lo que hay que hacer:

- [ ] Rehacer la base de **Supabase**: no se construyó con las migraciones de este repo
      (se usó `db push` desde Railway), así que `migrate deploy` falla contra ella.
- [ ] **Cargar las tasas de cambio** con `POST /api/fx/sync` justo después. El seed deja
      cero, y sin ellas los importes salen en la moneda equivocada.
- [ ] Confirmar que Render acepta **Node 24** (`NODE_VERSION` en `render.yaml`). Es
      reversible en una línea si algo falla.
- [ ] Asegurarse de que las variables `AUTH_DEV_*` **no existan** en producción. Son el
      simulador de rol; están apagadas por defecto y protegidas por tres cerrojos, pero
      no deben estar ahí.
- [ ] Crear en Render los cron `app-gestion-jobs` y `app-gestion-fx-sync` si el Blueprint no
      los aplica solo. **Cómo se comprueba ahora**: espera un ciclo y mira `GET /health`; si
      algún trabajo sigue en `estado: "nunca"` pasadas su cadencia, ese cron no existe. El
      detalle completo está en `GET /api/jobs/status` (ADMIN o `JOBS_RUN_TOKEN`).
- [ ] Revisar si las tasas de cambio quedaron congeladas durante los meses en que el cron
      apuntaba a un host que no existía.
- [ ] **Avisar a Nómina de que pierde su bandeja de aprobación.** La aprobación de horas extra
      pasó a un solo nivel (solo el PM). Al desplegar, la migración
      `20260930120000_aprobacion_unica_pm` **aprueba automáticamente todas las solicitudes que
      estaban esperando a Nómina** (`PENDING_FINANCE`) y las deja listas para pago. Es
      idempotente y deja su rastro en la bitácora. Conviene avisar antes: alguien de Nómina va
      a abrir la pantalla y no va a encontrar su pestaña.
- [ ] **Avisar al equipo de que varios proyectos van a cambiar de color.** El semáforo
      ahora usa el umbral configurado de cada proyecto en vez de un 15 fijo, y el
      portafolio dejó de contar el forecast dos veces. Si hay informes ya entregados con
      los colores viejos, conviene explicarlo antes.

---

## 1. Decisiones que necesitan a una persona, no a un desarrollador

Nada de esto se puede resolver leyendo código.

| # | Decisión | Por qué hace falta |
|---|---|---|
| D-1 | **¿El dominio `synaptica.cc` es nuestro?** `SMTP_FROM` usa `noreply@synaptica.cc` mientras el resto del proyecto usa `synaptica.co`. Si no es un dominio propio, **todo correo saliente lleva un remitente ajeno** y acaba en spam. (DEP-22) | Nadie puede confirmarlo desde el código |
| ~~D-2~~ | ~~**¿El umbral de margen por defecto debe ser 15 %?**~~ **Resuelta el 2026-10-05: son dos umbrales, no uno.** Cada proyecto configura `marginWarningPct` (advertencia, 30 % por defecto) y `marginCriticalPct` (crítico, 15 % por defecto); el crítico es el suelo que no se debe cruzar y no puede quedar por encima del de advertencia. El `marginThreshold` único se renombró a `marginCriticalPct` (migración `20261005143000_dos_umbrales_margen`), porque el valor que ya tenían los proyectos era un suelo. El semáforo RAG, el motor de alertas y las pantallas distinguen los dos niveles. | — |
| D-3 | **¿Un VIEWER debe ver los movimientos de todos los proyectos?** `GET /api/financial-entries` no aplica alcance por rol, a diferencia de otros módulos. | Política de visibilidad |
| ~~D-4~~ | ~~**¿Los ingresos se categorizan?**~~ **Resuelta el 2026-10-05: sí, y el catálogo es editable.** Dirección pidió «dos categorías genéricas de ingreso con posibilidad de luego editarlas». Se montó un catálogo en la base (`FinancialCategory`) con pantalla propia en Administración, en vez de una segunda lista fija en el frontend. Arranca con **Servicios de consultoría** y **Otros ingresos**; las siete categorías de gasto que vivían en `ExpensesTab.tsx` se trasladaron al mismo catálogo. | — |
| ~~D-5~~ | ~~**¿La jornada laboral se configura por país, por consultor o ambos?**~~ **Resuelta el 2026-10-05: las dos, con precedencia.** Manda la jornada del consultor; si no tiene, la de su país; si su país no está configurado, la fila general `Default`. Colombia queda en 8,5 h y Ecuador en 8 h. Implementado: cierra DEP-41. | — |
| D-6 | **Credenciales SMTP de prueba** para poder corregir el TLS del correo sin romper el envío. | Sin un buzón de prueba no se puede verificar |
| D-7 | **¿Cuáles son los umbrales buenos de CPI, SPI y uso de presupuesto?** La pantalla de Portafolio pinta con **0,85 / 1,00** y **90 % / 100 %**, pero `utils/health.ts` calcula la salud con **0,75** y **0,9**. Son criterios distintos para lo mismo, así que el color de una celda puede contradecir al semáforo de su propia fila. | Es una regla de negocio, no una decisión técnica |
| D-8 | **¿Se va a usar el módulo de Actividades?** El cronómetro y el timesheet permiten enlazar cada registro a una `Activity` para poder comparar horas estimadas con reales, pero no hay ninguna creada: el desplegable solo ofrece "Sin tarea" y parece roto. O se empieza a usar, o se retira el selector de las dos pantallas. | Decisión de producto |
| D-10 | **¿Qué fecha fija el tipo de cambio de un contrato, y cuál la de un ingreso?** La parte técnica ya está resuelta (R-008/R-012, 2026-10-05): presupuesto y precio de venta se valoran a `Project.startDate` y los ingresos a `FinancialEntry.entryDate`. Las dos son la **elección conservadora**, tomada porque el modelo no tiene nada mejor, y hacen falta dos confirmaciones: **(a)** ¿la fecha de contrato es la de inicio del proyecto, o hay una fecha de firma distinta que habría que guardar en un campo nuevo (`Project.contractDate`)? **(b)** ¿el ingreso se valora a la fecha de **factura** (lo implementado, `entryDate`) o a la de **cobro**? Hoy no existe campo de fecha de pago; si la respuesta es "cobro", hace falta añadirlo. | Es criterio contable, no técnico |
| D-11 | **¿Hay que cargar el histórico de tasas hacia atrás?** `FxRateHistory` solo tiene las 5 filas del día en que se sembró la base. Para todo lo anterior el cálculo cae a la tasa de hoy —y ya lo dice en pantalla ("Valoración a la tasa de hoy")—, así que el presupuesto de un proyecto de mayo sigue moviéndose hasta que exista una tasa con esa fecha. O se carga la serie histórica (manualmente en Tasas FX, o desde el proveedor), o se asume que los contratos anteriores al histórico se revalúan. | Depende de si existe la fuente del dato |
| D-12 | **¿En qué hora y en qué zona horaria debe salir el resumen semanal de aprobaciones, y debe ser la misma para todos los países?** R-020/R-022 quedan implementados con el envío configurable (día ISO + hora), pero la hora se guarda y se evalúa en **UTC**, con un valor inicial de lunes 13:00 UTC = 08:00 en Colombia. Eso funciona exacto para Colombia, Perú y Ecuador (UTC-5 todo el año), pero **un PM en Chile, Argentina, México o España recibe el correo a otra hora**, y en Chile además cambia con el horario de verano. Hacen falta dos respuestas: **(a)** ¿basta con una única hora global, o el día y la hora deben configurarse **por país** —como ya se hace con los recargos de horas extra y la jornada—? **(b)** si es por país, ¿de dónde sale el país del PM: de `User.country`, que hoy es opcional y está casi siempre vacío? Mientras no se responda, la pantalla muestra la hora en UTC y su equivalente en Colombia, para que al menos nadie la configure a ciegas. | Es criterio de negocio (a quién se le sirve primero), y la opción por país obliga a poblar un dato que hoy nadie llena |
| D-13 | **¿Un consultor sin rol de PM debe poder aprobar horas extra cuando se le delega?** Al cerrar R-024 (2026-10-06) se vio que la delegación promete algo que el sistema no cumple: la pantalla dice que el PM «delega la aprobación a un consultor normal» y el desplegable ofrece precisamente la lista de consultores, pero `PATCH /api/extra-hours/:id/approve` exige `authorize([ADMIN, PM])` (`extra-hours.routes.ts:796`). Un delegado cuyo único rol es `CONSULTANT` —el que le da el aprovisionamiento JIT la primera vez que entra— recibe un 403 antes de que se mire su delegación. Hoy, por tanto, delegar solo funciona de verdad **entre personas que ya tienen rol PM**. Hay tres salidas y ninguna es técnica: **(a)** añadir `CONSULTANT` a esa ruta y dejar que la delegación vigente decida (es lo que ya comprueba `canReviewExtraHour`, y basta una línea, pero amplía quién puede aprobar dinero); **(b)** dejarlo como está y cambiar la pantalla para que solo se pueda delegar en quien ya tiene rol PM o Administrador; **(c)** crear un rol o permiso intermedio de «aprobador delegado». Mientras no se responda, la delegación se registra para cualquiera (ya no falla) y la pantalla avisa de la limitación. | Es quién puede autorizar un pago: decisión de negocio, no de desarrollo |
| ~~D-9~~ | ~~**¿Las horas de sábado y domingo cuentan en el informe semanal?**~~ **Resuelta el 2026-09-30: sí cuentan.** El informe vuelve a cubrir los siete días y esas horas entran en los totales como cualquier otra; las columnas de sábado y domingo se dibujan atenuadas para distinguirlas de la jornada habitual sin ocultar el dato. | — |

---

## 2. Pendientes técnicos, por valor

### Alto

**El estado `PENDING_FINANCE` quedó muerto pero sigue en el enum.**
Desde `20260930120000_aprobacion_unica_pm` ninguna solicitud puede llegar a ese estado: el PM
aprueba y queda en `APPROVED`. Se conservó el valor a propósito, porque el histórico de
`AuditLog` lo guarda dentro de `before`/`after` y quitarlo dejaría esos registros sin un
estado legible. **No hay nada que hacer hoy**; queda anotado para que nadie lo reintroduzca
por accidente ni lo borre sin entender el coste. Si algún día se limpia el histórico de
auditoría, entonces sí se puede retirar del enum.

Efecto colateral pendiente de decidir: `calculateExtraHours.ts` sigue incluyendo
`PENDING_FINANCE` en las dos consultas que acumulan horas para el límite semanal. Es
inofensivo (no hay filas con ese estado) y se dejó intacto a propósito para no tocar la
lógica de cálculo de recargos, pero es código que ya no puede hacer nada.

**~~DEP-41~~ — La jornada laboral no se puede configurar. RESUELTO el 2026-10-05.**
`CapacityConfig` ya se escribe desde la aplicación: pantalla **Jornada Laboral**
(Administración, permiso `capacity:config`, solo ADMIN) sobre
`backend/src/modules/capacity/workday.routes.ts`. La precedencia la resuelve
`resolverJornada()` en `utils/capacity.ts` —**consultor → su país → la fila general
`Default`**— y los cinco puntos de `capacity.routes.ts` la reciben ya resuelta, en vez de
leer solo la fila del consultor como antes.

Un país sin configurar **no** cae en un 8 escondido: hereda la fila `Default` de forma
explícita, y la API devuelve el `origen` ("consultor" / "pais" / "general") para poder
decirlo en pantalla. Si ni siquiera existe esa fila se usa `JORNADA_GENERAL`, una constante
con nombre que solo se alcanza con la base sin sembrar.

La migración `20261005190000_jornada_configurable` vuelve único el país en `CapacityConfig`
y siembra Colombia 8,5 h, Ecuador 8 h y `Default` 8 h × 5 días; el seed hace lo mismo para
la base de producción que se va a rehacer.

**El segundo consumidor también quedó conectado**: `reportUtils.ts` ya no declara
`DAILY_LIMIT = 8`. `barsByDay`/`barsByConsultant` reciben un resolver de jornada por
consultor y el informe semanal pide `GET /api/capacity/workday/effective`. **Cambio visible**:
un colombiano que registre 8,5 h en un día ya no aparece con 0,5 h en rojo, porque esa es
su jornada completa.

**Paginación: hecha la mitad urgente, falta el resto.** El 2026-09-30 se paginaron los
tres listados **cuyo volumen crece con el tiempo**, con el mismo contrato de `/api/audit`
(`page`, `pageSize` topado a 100, respuesta `{ data, meta }`):

- `GET /api/time-entries` — pantalla Horas → Aprobaciones, con paginador.
- `GET /api/extra-hours` — Horas Extra → Historial de Solicitudes, con paginador.
- `GET /api/financial-entries` — sin consumidor en el frontend hoy.

En los tres, el `meta.total` se cuenta sobre el mismo `where` que ya lleva el alcance por
rol, así que el contador no delata filas ajenas. Los tres llevan desempate por `id` en el
`orderBy` para que la paginación sea estable.

**Lo que sigue pendiente**, medido contra la base local del 2026-09-30:

| Listado | Filas hoy | ¿Paginar? |
|---|---|---|
| `consultants` | 6 | No por ahora. Cota: plantilla de la empresa. |
| `projects` | 4 | No por ahora. Cota: cartera activa. |
| `assignments` | 4 | No por ahora, pero crece como consultores × proyectos × tiempo: es el primero de esta lista que habrá que paginar. |
| `forecasts` | 4 | No por ahora. Cota: proyectos × consultores. |
| `alerts` | 0 | **Vigilar.** No tiene cota natural: crece con cada ciclo del motor de alertas y hoy no hay purga ni archivado. Antes de paginarlo, decidir si se archivan las resueltas. |
| `activities` | 2 | No por ahora, pero crece por consultor y por día como las horas. Segundo candidato. |
| `audit` | 30 | Ya paginado desde antes. |

Criterio con el que se decidió: **se pagina lo que crece con el tiempo, no lo que crece con
el tamaño de la empresa**. Y no se pagina un endpoint sin tocar a la vez la pantalla que lo
consume: si el backend recorta y la pantalla no lo dice, el usuario ve un subconjunto
indistinguible de un conjunto completo.

**Deuda que deja este cambio:** el **Tablero** sigue descargando *todas* las horas
(`useTimeEntries` → `listAllTimeEntries`), ahora en páginas de 100 en vez de una petición
gigante. Es explícito y está comentado, pero el arreglo de verdad es pedirle los agregados
al servidor (`/api/stats/overview` ya hace parte del trabajo) en vez de sumar 124 filas —
y mañana 50.000 — en el navegador. Lo mismo, en menor grado, para la exportación a CSV del
timesheet y para los dos buzones de aprobación de horas extra.


**El TLS del correo está debilitado.** `utils/notifications.ts` usa
`rejectUnauthorized: false` y `ciphers: "SSLv3"`. Bloqueado por D-6.

### Medio

**`GET /api/projects/:id/detail` escribe dentro de una lectura.** Si el `healthStatus`
calculado difiere del guardado, hace un `update` dentro de un `GET`, y sin auditarlo.

**Los umbrales de Portafolio no coinciden con los del backend (ver D-7).** Es un defecto
funcional, no visual: se detectó al rediseñar la pantalla y se dejó sin tocar a propósito,
porque elegir los umbrales buenos es decisión de negocio. Un proyecto con CPI 0,80 sale con
la celda en **rojo** (`PortfolioTab.tsx`, < 0,85) mientras el semáforo de su propia fila es
**ámbar** (`health.ts`, 0,80 no baja de 0,75); con CPI 0,95 la celda va **ámbar** y la fila
**verde**.

**Los deltas «vs período anterior» del tablero comparan peras con manzanas.** Un total del
servidor ya convertido contra una suma local en monedas mezcladas. Arreglarlo bien exige que
`/stats/overview` devuelva los totales del período anterior.

**DEP-05 y DEP-06 — Enums muertos.** `AssignmentStatus.PARTIAL` nunca se escribe pero
aparece en 12 filtros de lectura; `AlertType.CONSULTANT_OVERLOADED` nunca se genera, aunque
`capacity.ts` ya calcula el estado `OVERLOADED` y conectarlos sería trabajo corto.
*(Decisión previa: dejarlos documentados por ahora.)*

~~**Nadie vigila que el cron esté vivo.**~~ **RESUELTO el 2026-09-29.** Cada ejecución de un
trabajo periódico deja fila en la tabla `JobRun` (qué trabajo, cuándo empezó, si salió bien,
cuánto tardó y el error si lo hubo), así que el rastro sobrevive al reinicio y a la siesta del
plan free. `GET /health` y `GET /api/jobs/status` publican el estado de frescura de cada
trabajo: `nunca` (no hay ninguna ejecución: el cron probablemente no existe), `fallido`,
`obsoleto` (el último éxito es más viejo que la tolerancia) u `ok`. `/health` **informa pero no
devuelve 503** por un trabajo obsoleto: Render reiniciaría el servicio en bucle por algo que un
reinicio no arregla.

**La auditoría no es transaccional.** Se escribe después de confirmar la operación, así que
si el proceso muere en medio, la operación queda sin rastro. Es deliberado —lo contrario
haría fallar operaciones que sí ocurrieron— pero conviene saberlo. Tampoco hay política de
retención para `AuditLog`.

### Bajo

- **DEP-42** — `Consultant.maxHoursPerDay` no entra en ningún cálculo: solo aparece en la
  proyección de `utils/consultant-scope.ts`. Campo muerto: implementarlo o retirarlo.
  *(Corregido el 2026-09-24: la otra mitad de este ítem ya no aplica. `skills` **sí** existe
  en el esquema — `Consultant` y `User` — y se usa en `ProfileTab`, `CapacityTab` y
  `RagChat`.)*
- **DEP-08** — Unas 20 funciones de `services/api.ts` sin usar (hitos, riesgos,
  incidencias). Son andamiaje de pantallas nunca construidas: primero decidir producto.
- **DEP-14** — `TODO(backend)` duplicado en `periodUtils.ts` sobre rangos ISO.
- **El nombre del producto no es consistente**: `Synatrack` en el repositorio, `SynaTrack`
  en la interfaz, `App Gestión` y `app-gestion-*` en los servicios y la base de datos.


---

## 3. Migración visual del frontend (tarea abierta, lista para retomar)

Hay un sistema de diseño completo y seis pantallas ya migradas que sirven de referencia. Lo
que falta es aplicar lo mismo al resto. **Es trabajo acotado y repetitivo, apto para
retomar por partes.**

### Qué hay que leer antes de empezar

1. `documentacion/DISENO.md` — las convenciones: escala de espaciado, radios, sombras, el
   catálogo de clases ya creadas y las trampas conocidas (la de especificidad de
   `body.dark .card` es importante).
2. `.claude/agents/disenador-ui.md` — el agente de diseño, con sus reglas.
3. `frontend/src/features/portfolio/PortfolioTab.tsx` — la pantalla de referencia. Así debe
   quedar el resto.

Hay además una skill instalada, `ui-ux-pro-max`, con 119 guías de UX, paletas por tipo de
producto, tipografías e iconos. Se consulta así:

```bash
python .claude/skills/ui-ux-pro-max/scripts/search.py --domain ux --max-results 5 "tu consulta"
```

### En qué consiste exactamente

Dos métricas, medibles con `grep`, que resumen el problema:

- **Colores literales** (`#a1b2c3`) dentro de los `.tsx`. Hay que llevarlos a **cero**: todo
  color sale de un token de `index.css`. Los literales que quedan no son de la marca, son la
  paleta por defecto de Tailwind que se coló copiando y pegando.
- **Estilos en línea** (`style={{ }}`). Lo repetido pasa a clases en `App.css`. Lo único que
  puede quedarse es el **valor calculado** (un ancho que depende de un porcentaje, por
  ejemplo).

### Cómo medir el avance

```bash
# Global
grep -rhoE '#[0-9a-fA-F]{3,6}' --include='*.tsx' frontend/src | wc -l
grep -rho 'style={{' --include='*.tsx' frontend/src | wc -l

# Un archivo concreto
grep -c 'style={{' frontend/src/features/<pantalla>.tsx
```

### Lo que queda, medido hoy

| Archivo | Estilos en línea | Colores literales |
|---|---|---|
| `features/activities/ActivitiesTab.tsx` | 223 | 58 |
| `App.tsx` (landing y layout) | 93 | 42 |

**Eso es todo lo que queda.** Las dos son las decididas a propósito para más adelante:
`ActivitiesTab` está a la espera de una decisión de producto sobre si el módulo se retira, y
`App.tsx` se hará aparte porque es landing y layout y por tanto afecta a las 16 pantallas.

Totales globales sobre `frontend/src/**/*.tsx` tras esta pasada: **340 estilos en línea y
100 colores literales** (venían de 1.576 y 575 en la rama `dev`). De los 340, 316 están en
esos dos archivos; los 24 restantes se reparten entre pantallas ya migradas y son **valores
calculados**, el único uso legítimo.

**Ya migrados** (puntos 1, 2 y 3 del orden recomendado):

- `components/Toast.tsx` y `components/ValidationErrorBox.tsx` — reusan `.notice`/
  `--state-*-bg/border/strong` y `.toast`/`.toast--*` (clases nuevas, mismo lenguaje de color
  que `.state-chip`).
- `components/AlertsPanel.tsx` (el cajón, no la pestaña) — las tarjetas de alerta ahora
  comparten literalmente las clases `.alert-item`/`.status-badge` de
  `features/alerts/AlertsTab.tsx`, en vez de tener su propio mapa `SEV_COLOR` divergente. El
  marco del cajón (botón con contador, telón, panel deslizante, grupos plegables) es CSS
  nuevo (`.alert-panel*`), y se retiró el fondo cálido `#fff8f0`/texto `#5f2f00` del
  encabezado (mismo hallazgo de color fuera de marca que ya se había corregido en
  `PageHeader`). De paso se eliminó ~50 líneas de parches `!important` en `App.css` que
  apuntaban a las clases viejas del cajón y quedaban muertas tras el cambio.

- `components/DateRangePicker.tsx` y `components/RagChat.tsx` — el naranja de Tailwind de los
  presets del selector de fechas (`#f97316`/`#ea580c`/fondo `#fff6ef`) se sustituye por el
  mismo lenguaje `--state-warning-*`/`.state-chip--filled` que ya usan otras pantallas; el
  estado activo del botón reusa la convención de `.subtab.is-active` (borde `--color-accent`,
  texto `--state-warning-strong`). En `RagChat`, el degradado navy→azul de Tailwind
  (`#234175`→`#3b82f6`) resultó ser el mismo que ya usa el botón flotante 🤖 sin migrar
  (comentado "Corporate Blue Gradient" en `App.css`); se creó `--gradient-primary`
  (navy→azul de marca, ya existía a medias en `index.css` sin usarse) y un token nuevo,
  `--text-on-dark`, para el texto blanco sobre ese degradado — documentado en `index.css`
  junto a los demás tokens de color.

Los cinco: 0 estilos en línea y 0 colores literales. Verificado con Playwright en claro y
oscuro además de `tsc`/`lint`/`build`/tests: el cajón de alertas se probó con 3 alertas de
ejemplo (una por severidad, inyectadas interceptando `/api/alerts` en el navegador, sin tocar
datos reales) confirmando tinte + borde + insignia con etiqueta en los tres estados, en ambos
temas. El selector de fechas y el chat se probaron de punta a punta en la app real (Ingresos/
Gastos y el botón flotante 🤖), incluido el estado activo del preset. `Toast`/`ValidationErrorBox`
se verificaron inyectando temporalmente en el DOM el mismo marcado que producen (los flujos de
UI para dispararlos de verdad chocan con la validación
nativa del formulario antes de llegar al servidor). Capturas en
`documentacion/capturas/alertas-cajon-despues-*`, `toast-notice-despues-*`,
`daterange-despues-*` y `ragchat-despues-*`.

- **Gastos** (`features/expenses/`, las cinco piezas: `ExpensesTab`, `GastosFilters`,
  `GastosSummaryTable`, `GastosDetailRow`, `GastosKPIStrip`) — **70 → 0 estilos en línea y
  7 → 0 colores literales**, sin ningún valor calculado pendiente. Casi todo salió de clases
  que ya existían (`.kpi-grid`/`.kpi-card`, `.state-chip`, `.empty-state`, `.chip-row`,
  `.inline-filter`, `.control-sm`, `.btn-sm`, `.card--roomy`, `.card-head`, `.card-title`,
  `.table-wrap--spaced`, `.cell-*`, `.tone-*`); lo propio de la pantalla lleva prefijo
  `gastos-` y está al final de `App.css`. Lo sustancial: el botón "+ Nuevo gasto" iba en un
  degradado naranja de Tailwind (`#ff8b3d`→`#ea580c`) con texto blanco y los chips de
  categoría en `#ea580c`/`#fff`; ahora usan `--state-warning-solid` con
  `--state-warning-on-solid` (navy) encima, que es la convención documentada en `DISENO.md`
  §5.3. El total de costos proyectados iba en `#2563eb` sin contraparte oscura y ahora es
  `--state-info-strong`. El detalle de las clases está en `DISENO.md` §6, sección "Clases
  añadidas al migrar Gastos". Verificado en la app real con Playwright en claro y oscuro y a
  400px, más una auditoría de estilo computado que destapó dos fallos de especificidad de
  modo oscuro ya corregidos. Capturas en `documentacion/capturas/gastos-antes-*` y
  `gastos-despues-*`.

- **Perfil, Usuarios, Auditoría y Tasas FX** (`features/profile/ProfileTab.tsx`,
  `features/admin/AdminTab.tsx`, `features/audit/AuditTab.tsx`, `features/fx/FxTab.tsx`) —
  **94 → 0 estilos en línea y 10 → 0 colores literales**, sin ningún valor calculado
  pendiente. Son cuatro pantallas de formulario + tabla, así que se migraron juntas buscando
  el patrón común una sola vez. Hallazgo principal: **el CSS de Perfil ya existía y llevaba
  sin usarse desde el commit `e565e54`** — las clases `.profile-*`, `.skill-*` e
  `.inline-success` se habían escrito con la migración de Detalle de Proyecto pero el `.tsx`
  nunca llegó a aplicarlas, así que 43 de los 48 estilos en línea de esa pantalla se
  resolvieron simplemente conectando el marcado a lo que ya estaba. Lo nuevo es
  deliberadamente genérico (`.field-stack`, `.filters-grid--spaced`, `.span-full`,
  `.cell-mono`, `.modal-header--rule`, `.modal-actions--rule`, `.modal-title`,
  `.role-badge--sm`) porque las cuatro repetían el mismo campo apilado y el mismo modal a
  mano; solo `.audit-diff__*` y `.fx-rate-field*` son de una pantalla concreta. Las píldoras
  `.pill ok/warn/error/neutral` pasan a `.state-chip--*`, igual que en Capacidad. El detalle
  está en `DISENO.md` §6, sección "Clases añadidas al migrar Perfil, Usuarios, Auditoría y
  Tasas FX". Verificado en la app real con Playwright, claro y oscuro, a 1440 y 400px,
  incluidos el modal de Usuarios y la tabla de Auditoría con datos reales. Capturas en
  `documentacion/capturas/perfil-*`, `admin-*`, `auditoria-*` y `fx-*` (`-antes-`/`-despues-`).

- **Calculadora de Estimaciones** (`features/estimations/EstimationCalculatorTab.tsx`) —
  **272 → 2 estilos en línea y 82 → 0 colores literales**. Era el archivo más cargado del
  frontend (2.422 líneas). Los 2 que quedan son valores calculados, el único uso legítimo:
  el ancho de cada segmento de la barra apilada de esfuerzo y el del tramo "Ideal" de la
  comparación ideal vs. real.

  Se hizo en cuatro pasadas verificadas por separado (guía educativa → parámetros y espacio
  de trabajo → consolidado → calibrador de pesos). Lo más rentable no fue reemplazar color
  por color sino **buscar el patrón repetido**: un solo `style` de control de formulario
  (`width:100%`, `padding:0.5rem`, `background:"#fff"`) aparecía **30 veces**, y la etiqueta
  de campo apilada **26 veces**; las dos clases correspondientes resolvieron 67 de los 272
  estilos de una vez. Las dos filas de pestañas (estimador/pesos y la de la guía) estaban
  escritas a mano con ámbar incrustado y pasan a `.subtabs`/`.subtab`/`.is-active`, que ya
  existía.

  Los 82 literales eran casi todos de Tailwind y se mapearon **por significado**: verde →
  `--state-success-*`, ámbar → `--state-warning-*`, rojo → `--state-danger-*`, azul →
  `--state-info-*`, y morado/naranja/cian/rosa → los tintes categóricos `--tint-*`, que ya
  tenían contraparte oscura. **No hizo falta crear ningún token nuevo.** De los 18 `#fff`,
  15 eran fondos de campo (ahora `--card-bg`, con `body.dark input` haciendo su trabajo) y 3
  eran texto sobre relleno sólido; los que iban sobre ámbar pasan a navy
  (`--state-warning-on-solid`), que es la convención de `DISENO.md` §5.3. El detalle está en
  `DISENO.md` §6, sección "Clases añadidas al migrar la Calculadora de Estimaciones".

  Verificado con `tsc -b`/`lint`/`build`/156 pruebas, más Playwright en claro y oscuro a
  1440 y 400px sobre cinco estados de la pantalla (estimador, las tres pestañas de la guía y
  el calibrador) y una auditoría de `getComputedStyle` de 35 selectores en ambos temas.
  Capturas en `documentacion/capturas/estimaciones-*` (`-antes-`/`-despues-`).

- **Cola de pantallas medianas y componentes menores** (doce archivos) — **162 → 12
  estilos en línea y 30 → 0 colores literales**. Los 12 que quedan son todos valores
  calculados o ya documentados como tales. Por archivo:

  | Archivo | Estilos en línea | Colores literales |
  |---|---|---|
  | `features/consultants/ConsultantsTab.tsx` | 39 → **0** | 0 → 0 |
  | `features/forecasts/ForecastsTab.tsx` | 39 → **1** | 19 → **0** |
  | `features/projects/ProjectsTab.tsx` | 24 → **1** | 3 → **0** |
  | `features/reports/ReportsTab.tsx` | 19 → **0** | 0 → 0 |
  | `components/SearchableSelect.tsx` | 13 → **0** | 2 → **0** |
  | `features/dashboard/DashboardTab.tsx` | 6 → 6 | 0 → 0 |
  | `components/EmptyState.tsx` | 5 → **0** | 2 → **0** |
  | `components/MonthYearPicker.tsx` | 5 → **0** | 0 → 0 |
  | `components/ConfirmDialog.tsx` | 3 → **0** | 4 → **0** |
  | `components/CountryFlag.tsx` | 3 → **1** | 0 → 0 |
  | `features/financial/FinancialTab.tsx` | 3 → **0** | 0 → 0 |
  | `features/portfolio/PortfolioTab.tsx` | 3 → 3 | 0 → 0 |

  Se empezó por los cinco componentes compartidos, que aparecen dentro de las pantallas
  grandes, y eso resolvió de paso parte de lo demás. Casi todo salió de vocabulario que ya
  existía: `.field-label` absorbió **18 etiquetas** escritas a mano entre Consultores y
  Proyectos, `.meter`/`.meter__track`/`.meter__fill--*` absorbió las dos barras de progreso
  que cada pantalla se había inventado, y `.cell-right`/`.cell-strong` resolvió los 19
  estilos de Informes de una vez. Lo nuevo lleva prefijo `cons-`, `fore-` o `proy-`, salvo
  seis utilidades genuinamente compartidas (`.no-select`, `.control-block`, `.span-2`,
  `.cell-nowrap`, `.meter__fill--info`, `.field-help--warning`).

  Lo sustancial: `RagBadge` de Proyectos pintaba el semáforo con el color de fondo y `#fff`
  encima —el error de `DISENO.md` §5.3: sobre el verde y el ámbar de marca el blanco se queda
  en 2,6:1— y pasa a `PRESENTACION_SALUD` + `.status-badge--*`; la barra de ejecución de
  Proyecciones tenía su propio semáforo (`#dc2626`/`#f59e0b`/`#2563eb`) sin modo oscuro; el
  formulario de Proyecciones fijaba `background: #ffffff`, así que en oscuro se quedaba
  blanco; y `SearchableSelect`, que usan cinco pantallas, marcaba el foco con el naranja de
  Tailwind `#ea580c`. **`ReportsTab` se revisó y su `features/reports/reports.css` está bien
  como está** —tokenizado, con su paleta validada para daltonismo— así que no se tocó: solo
  se pasaron a clase los 19 estilos de alineación de su tabla.

  La auditoría de `getComputedStyle` en ambos temas destapó **cuatro fallos que las capturas
  no mostraban**, todos corregidos: `.status-badge--*` perdía su texto navy dentro de una
  tarjeta en oscuro (`body.dark .card span:not(.pill)`, (0,3,2), le gana a un modificador de
  dos clases) y salía en gris claro sobre el verde de marca, 2,4:1 —afecta también a
  Portafolio y Tablero, que la comparten—; el botón «Asignar» perdía su relleno verde
  (`body.dark button.ghost`, (0,2,2)); y `.meter__value` y `.cell-empty` se aplanaban al
  blanco de la tarjeta. El detalle está en `DISENO.md` §6, sección "Clases añadidas al cerrar
  la cola de pantallas medianas". Capturas en `documentacion/capturas/consultores-*`,
  `proyecciones-*`, `proyectos-*`, `informes-*` y `financiero-*` (`-antes-`/`-despues-`).

### Orden recomendado, y por qué

No por tamaño, sino por impacto:

1. ~~`components/Toast.tsx` y `components/ValidationErrorBox.tsx`~~ **— hecho.** Eran
   diminutos, pero tenían más color literal que código y aparecen encima de cualquier
   pantalla: se ven cada vez que se guarda algo o falla una validación.
2. ~~`components/AlertsPanel.tsx`~~ **— hecho.** El cajón de la campana, que se abre desde
   todas partes.
3. ~~`components/DateRangePicker.tsx` y `components/RagChat.tsx`~~ **— hecho.** Compartidos.
4. ~~**Horas Extra** y **Capacidad**~~ **— hecho.** Horas Extra: 186 → 0 estilos en línea,
   35 → 0 colores literales. Capacidad: 123 → 1 (el valor calculado del medidor, legítimo),
   28 → 0. Las dos se migraron con agentes en paralelo sobre el mismo `App.css`; no hubo
   colisión de clases (prefijos `capacity-*` vs. nombres genéricos reutilizables), pero
   ninguno de los dos actualizó esta tabla ni la de `DISENO.md` §7 por evitar pisarse — se
   reconcilió a mano después. El detalle de las clases nuevas y los defectos encontrados
   (banner sin keyframe, hover en JS que dejaba el botón de otro color, sub-pestañas sin CSS,
   etc.) está en `DISENO.md` §6, secciones "Clases añadidas al migrar Horas Extra" y
   "...Planificación de Capacidad". Verificado en la app real con Playwright, claro y oscuro,
   sin errores de consola: reporte y configuración multipaís (fichas de legislación) de Horas
   Extra, y las cuatro sub-pestañas de Capacidad. Capturas en
   `documentacion/capturas/extrahoras-*-despues-*` y `capacidad-*-despues-*`.
5. ~~**Estimaciones**~~ **— hecho.** 272 → 2 estilos en línea (los dos calculados), 82 → 0
   colores. Era la más grande (2.422 líneas). **Queda `ActivitiesTab` (223 / 58)**, que es
   ahora la de mayor rentabilidad, y después `App.tsx` (93 / 42), que es landing y layout.
   **Léelas por rangos, no enteras**, y empieza mapeando qué patrón se repite: en
   Estimaciones, dos clases resolvieron 67 de los 272 estilos.

### Reglas que no se pueden romper

- Cero colores literales. Si falta un matiz, se crea como token y se documenta.
- El modo oscuro tiene que funcionar. Un color literal es, casi siempre, un fallo de modo
  oscuro esperando a ocurrir.
- Contraste 4.5:1 en texto normal, 3:1 en texto grande.
- El color nunca es lo único que comunica un estado — pero quien cumple esa regla es la
  **etiqueta**, no un icono metido dentro de una píldora (ver §"Iconos de estado" de
  `DISENO.md`; ya se cometió ese error una vez).
- **No cambiar comportamiento.** Si aparece un defecto funcional, se anota y se sigue.
- La paleta de Synaptica **no se cambia**. El trabajo es aplicar la identidad que ya existe.

### Cómo verificar antes de dar algo por hecho

```bash
cd frontend
npx tsc -b --noEmit   # ojo: `tsc --noEmit` a secas NO verifica nada aquí
npm run lint
npm run build
npm test              # 136 pruebas
```

Y **capturas de antes y después**, en claro y oscuro y a 400 px de ancho. Hay Playwright y
Chromium instalados; en `documentacion/capturas/` están las de las pantallas ya migradas
como ejemplo del formato. Una afirmación de que "se ve mejor" sin captura no sirve para
revisar.

### Trampas ya descubiertas, para no volver a tropezar

- **`body.dark .card` pesa más que las clases de estado** (incluye el elemento `body`), así
  que el tinte de una tarjeta desaparece en oscuro. Se resuelve dando más peso a la clase
  nueva, repitiéndola si hace falta (`.kpi-sub.kpi-sub`), **sin `!important`**.
- **En los SVG el color va por clase, no por el atributo `fill` o `stroke`**: un
  `fill="#ff9c2c"` no resuelve tokens ni tiene contraparte oscura.
- **Una prueba que afirma un color literal bloquea la migración.** Pasó con `AlertBadge`: la
  solución fue que la prueba afirme la clase, que es el contrato real.
- Los datos locales no traen alertas ni proyectos en rojo, así que para capturar esos
  estados hay que interceptar la respuesta de la API **solo en el navegador**, sin tocar la
  aplicación ni los datos.

---

### Deuda que queda abierta tras D-4

**El backend de gastos sigue aceptando cualquier texto como categoría.**
`POST /api/expenses` valida `category: z.string().trim().min(1)` y no comprueba el catálogo,
mientras que `POST /api/revenue` sí lo hace (`normalizarCategoria`). Se dejó así **a
propósito**, para no cambiar el contrato de una ruta que ya está en uso y arriesgarse a
rechazar categorías históricas que no estén sembradas. El efecto práctico es menor —el
formulario solo ofrece las del catálogo y la migración recogió todas las categorías de gasto
ya en uso— pero significa que un cliente de la API puede meter una categoría de gasto fuera
del catálogo, y que la pantalla de administración no gobierna del todo los gastos.

Cerrarlo es un cambio pequeño: reutilizar `resolverCategoriaActiva("EXPENSE", ...)` en
`expenses.routes.ts`. Antes de hacerlo conviene comprobar contra Supabase que no hay
categorías de gasto en uso que la migración no haya recogido.

**Las categorías se guardan por nombre, no por clave foránea.** `FinancialEntry.category`
sigue siendo texto. Renombrar una categoría propaga el nombre nuevo a los movimientos en la
misma transacción (`PUT /api/financial-categories/:id`), así que no quedan huérfanos, pero
es un apaño: si algún día se tocan esos nombres por SQL directo, la coherencia se rompe sin
que nada avise. Convertirlo en FK obliga a migrar los datos de gasto históricos y no pareció
rentable hoy.

**Los ingresos anteriores a D-4 siguen sin categoría.** No se rellenaron hacia atrás: elegir
por ellos habría sido inventar datos contables. Aparecen como «Sin categoría» y se les puede
asignar una editándolos uno a uno. Si el negocio quiere el histórico categorizado, hay que
pedirle a Finanzas el criterio; no se puede deducir del dato.

---

## 4. Una trampa que ya apareció cinco veces

**Campos que el backend lee y que nadie puede escribir.** El modelo declara la columna, el
código la consulta, pero no está en ningún esquema Zod ni en ningún formulario, así que
queda siempre nula y la funcionalidad que depende de ella **no funciona, sin dar error**.

Ya pasó con `projectManagerEmail` (la aprobación de horas extra por el PM era imposible),
`marginThreshold` y `budgetAlertPct` (el umbral configurado se ignoraba), `identification`
(el documento salía siempre "No asignado" en la nómina) y `CapacityConfig` (DEP-41, resuelto el 2026-10-05; antes
abierto).

**Y una variante nueva (sexta vez), esta al revés** (corregida el 2026-10-05 junto con
DEP-41)**:** en lugar de leer un campo que nadie escribe, se escribió un valor fijo en el
código donde ya existía la columna para configurarlo. El informe de horas usaba
`DAILY_LIMIT = 8` en el frontend teniendo `CapacityConfig.hoursPerDay` en el modelo. El
efecto es el mismo -- la configuración no manda -- y cuesta más de encontrar, porque no hay
ninguna columna nula que delate el problema. Hoy el informe pide la jornada real a
`GET /api/capacity/workday/effective`; lo único que queda con nombre de constante es
`JORNADA_POR_DEFECTO`, el marcador de posición mientras la petición está en vuelo.

**Séptima vez, otra variante del mismo error (corregida el 2026-10-05 con D-4):** la lista de
categorías de gasto era una constante en `frontend/src/features/expenses/ExpensesTab.tsx:27`.
No había columna nula ni campo inescribible —el dato se guardaba bien— pero el **conjunto de
valores posibles** vivía en el código, así que cambiarlo exigía desplegar. Al pedir dirección
categorías de ingreso «editables después», la salida fácil habría sido copiar esa lista y
tener dos. Están las dos en la base, en `FinancialCategory`, con pantalla propia.

**Si agregas un campo al modelo, agrégalo también al esquema Zod y al formulario en el mismo
cambio.** Y si vas a escribir una lista de opciones en el código, pregunta primero si alguien
va a querer cambiarla sin ti. Y si encuentras código que lee un campo, comprueba que exista forma de escribirlo.

---

## 5. Cómo verificar lo que hagas

El proyecto tiene con qué demostrar que un cambio funciona; úsalo.

```bash
cd backend && npm test          # 257 (ojo: incluye 2 ficheros mal ubicados que piden base)
cd backend && npm run test:routes   # 78 pruebas de ruta, con base y autorización reales
cd frontend && npm test         # 155 pruebas
cd frontend && npx tsc -b --noEmit  # ojo: `tsc --noEmit` a secas NO verifica nada aquí
```

**`npm run test:routes` es el que hay que mirar antes de tocar autorización.** Fue el que
cazó que el Timesheet había rebajado en silencio el 403 de `POST /api/time-entries` a un 201
con las horas reasignadas al propio solicitante. `npm test` pasaba igual.

Para probar comportamiento por rol hay un **simulador**: variables `AUTH_DEV_EMAIL` y
`AUTH_DEV_ROLES`, o los encabezados `x-dev-email` y `x-dev-roles` con
`AUTH_DEV_ROLE_HEADER=true`. Sin él, el bypass de demo entra siempre como ADMIN y **ninguna
falla de autorización se manifiesta en local**.

Entorno local completo: `.\scripts\dev.ps1`. Detalle en `documentacion/DESARROLLO_LOCAL.md`.

---

## 6. Backlog recibido a principios de septiembre (`documentacion/Backlog.xlsx`)

Son **53 ítems** levantados contra la versión que estaba desplegada a principios de septiembre
de 2026, **antes** de toda la fusión de Ingresos/Gastos, la unificación de rentabilidad y
semáforo (R10), el rediseño del timesheet, la paginación y las correcciones de seguridad de
permisos. El Excel los junta en una sola hoja; aquí se separan por quién los pidió, porque son
dos conversaciones distintas: §6.1 es retroalimentación de uso de **Greysi - Yamilet** sobre
pantallas concretas; §6.2 es la lista de **Juan Espinosa** de la reunión de requerimientos
(incluye pedidos de terceros — Francis Garrido, Juan Bedoya — que él trasladó).

**Verificado ítem por ítem contra el código de `dev` el 2026-10-05** (no es una copia del
Excel): cada fila dice si ya se resolvió, a medias, sigue abierta, o no es un bug sino que hace
falta que alguien decida algo primero. Cuatro etiquetas:

| Etiqueta | Qué significa |
|---|---|
| **Resuelto** | Ya funciona así hoy en `dev`. Se cita el archivo/línea que lo confirma. |
| **Parcial** | Se construyó una parte; se explica qué falta exactamente. |
| **Abierto** | No hay código relacionado. Confirmado, no es una suposición. |
| **Decisión** | No es un defecto: es ambiguo o depende de que el negocio resuelva algo primero. |

**Hallazgo transversal, no estaba en el Excel original — RESUELTO el 2026-10-05:** cinco ítems de
monedas distintos (R-008, R-012, R-026, R-033, R-034) eran **el mismo defecto de raíz**: todo el
sistema financiero convertía con la tasa de cambio **de hoy** (`prisma.fxConfig.findMany()` en
`stats.routes.ts`, `project-detail.routes.ts`, `projects.routes.ts`), nunca con la tasa vigente en
la fecha del contrato o de la factura. Ya existía la pieza —`FxRateHistory` y
`GET /api/fx/rate?date=`— pero no estaba conectada al cálculo.

Se conectó en un solo cambio, sin migración (`FxRateHistory` ya existía):

- `backend/src/utils/currency.ts` — **libro de tasas fechado** (`RateBook`, `buildRateBook`,
  `rateMapForDate`, `convertAmountOnDate`, `convertAmountFallbackOnDate`). Reutiliza el mismo
  criterio de respaldo de `GET /api/fx/rate`: la tasa histórica más reciente con
  `effectiveDate <= fecha` y, si no hay ninguna, la actual de `FxConfig`.
- `backend/src/modules/fx/rate-book.service.ts` — carga `FxConfig` + `FxRateHistory` **una vez por
  petición**. El histórico se resuelve en memoria con búsqueda binaria y se memoiza por día UTC,
  así que `/stats/overview` no hace ni una consulta extra por movimiento.
- `backend/src/utils/financial.ts` — `computeProjectFinancials` recibe `rateBook` + `valuationDate`
  en vez del `rateMap` único; `ExpenseInput`/`RevenueEntryInput` llevan `entryDate`.
- Conectado en `stats.routes.ts` (overview y portfolio), `project-detail.routes.ts` (detalle y
  timeline), `projects.routes.ts` (profitability), `snapshots.routes.ts` (cierre mensual) y
  `alerts.service.ts`.

**Qué fecha valora qué** (razonamiento completo en el comentario de `computeProjectFinancials`):

| Concepto | Fecha | Por qué |
|---|---|---|
| Presupuesto y precio de venta | `Project.startDate` | No son movimientos: son el valor pactado en un contrato firmado una vez. Reexpresarlos cada día era justo lo que pedía R-033. Falta confirmar si la fecha de contrato es la de inicio (**D-10a**). |
| Gasto | `FinancialEntry.entryDate` | Fecha del hecho económico (R-008, R-026). |
| Ingreso | `FinancialEntry.entryDate` | Fecha de reconocimiento/factura. Si el negocio quiere fecha de cobro, hace falta un campo nuevo (**D-10b**). |
| Costo de las horas | `TimeEntry.workDate` de cada registro | La hora se consumió ese día. Registro a registro, no por periodo: promediar inventaría una fecha que nadie eligió. |
| Forecast | Inicio de su periodo | Para periodos futuros no hay tasa posterior a hoy y la búsqueda cae en la última conocida, que es lo mejor para proyectar. |

**Cuando falta la tasa histórica** se usa la actual y **queda anotado**: el libro de DEP-32 tiene
ahora un segundo canal, `undated`, y las respuestas publican
`conversion: { incomplete, missingPairs, approximateDates, undatedPairs }`. La interfaz distingue
los dos niveles: "Cifras aproximadas" (falta la tasa, el importe se sumó **sin convertir**) y
"Valoración a la tasa de hoy" (el importe sí se convirtió, pero se revalúa cada día).

**Efecto medido** sobre la base local, sembrando la curva USD→COP que el cron diario habría
dejado (4.400 en enero → 4.300 en mayo → 4.150 en julio → 4.000 en septiembre; tasa actual 3.950):
el presupuesto de *Migración Cloudera a Azure* (480.000.000 COP, inicio 2026-05-24) pasa de
**121.518,99 USD** (480 M / 3.950, la tasa de hoy) a **111.627,91 USD** (480 M / 4.300, la tasa de
mayo): **−9.891,08 USD, −8,1 %**. Y, sobre todo, deja de moverse: antes ese número cambiaba cada
día que cambiara la tasa.

Dos pares más son el mismo síntoma reportado por separado: **R-005 y R-032** (el filtro de
Portafolio no actualiza los totales de arriba) son un solo bug, ya confirmado en código.
~~**R-020 y R-022** piden lo mismo (PM como aprobador de horas, con notificación) para Horas y
Horas Extra respectivamente~~ — **resueltos juntos el 2026-10-06**, como anticipaba esta nota:
comparten un único trabajo semanal (`approval-digest`) y una única fila de configuración.

### 6.1 Backlog Greysi (R-001 a R-027)

| ID | Pantalla | Qué pidió | Estado y evidencia |
|---|---|---|---|
| R-001 | Dashboard | Resumen mes a mes por proyecto; clic en un proyecto lleva a su ficha en Gestión de Proyectos | **Resuelto el 2026-10-05.** La tabla "Resumen por proyecto" gana una columna "Acciones": el botón "Ver" navega a la ficha del proyecto en Gestión de Proyectos (`DashboardTab.tsx`, prop `onOpenProject`, mismo patrón que Portafolio/Capacidad). El botón "▼ mensual" expande, por fila, un desglose mes a mes de gastos/ingresos/margen a partir de `GET /api/financial-entries` (endpoint de reportería ya existente, sin UI hasta ahora), filtrado por el rango de fechas del tablero — nuevo binding `listFinancialEntries`/`listAllFinancialEntries` en `services/api.ts`. El presupuesto no tiene granularidad mensual en el modelo de datos, así que el desglose cubre solo movimientos reales (gastos/ingresos), no presupuesto proyectado por mes. |
| R-002 | Dashboard | Ver evolución de horas aprobadas/proyectadas/extra; clic lleva a Horas con el detalle por consultor; quitar horas extra de aquí | **Parcial.** El KPI "Horas aprobadas" sí navega a Horas y hay tablas por consultor (`DashboardTab.tsx:1419-1473`). Las horas extra **no se retiraron**: siguen sus propios gráficos (líneas 1500-1517). |
| R-003 | Portafolio | Precio de venta, presupuesto, ejecutado, comisiones/impuestos/descuento, margen | **Parcial.** Presupuesto/ejecutado/margen ya están. Precio de venta no se muestra en la tabla de Portafolio (solo en el formulario de Proyectos). Comisiones/impuestos/descuento **no existen en ningún lado del código** — es concepto nuevo. |
| R-004 | Portafolio | Filtro de proyecto desplegable | **Resuelto.** `SearchableSelect` desplegable con búsqueda (`PortfolioTab.tsx:347-355`). |
| R-005 | Portafolio | Al filtrar por proyecto, los totales de arriba no cambian | **Abierto — mismo bug que R-032.** Los KPI de resumen leen `portfolio.summary` sin filtrar; los filtros solo afectan la tabla de abajo. |
| R-006 | Portafolio | Filtros arriba + botón de limpiar filtros | **Parcial.** Los filtros ya están arriba. Falta el botón "Limpiar filtros" (sí existe en Dashboard, no en Portafolio). |
| R-007 | Proyectos | País como lista desplegable | **Abierto.** Sigue siendo `<input>` de texto libre (`ProjectsTab.tsx:302,544`). Consultores ya migró esto mismo a `<select>`; a Proyectos no se le aplicó. |
| R-008 | Proyectos | Vincular la tasa de cambio del proyecto a su propia fecha, no mostrar siempre en USD | **Resuelto el 2026-10-05** (ver hallazgo transversal arriba). Cada importe se convierte con la tasa de su fecha: `currency.ts:241-461` (`buildRateBook`/`rateMapForDate`/`convertAmountFallbackOnDate`), `financial.ts:454-513` (presupuesto, ingresos, gastos y horas, cada uno a su fecha), conectado en `stats.routes.ts:53` y `:283`, `project-detail.routes.ts:55`, `projects.routes.ts:342` y `alerts.service.ts:90`. Pruebas: `backend/src/utils/__tests__/tasasPorFecha.test.ts`. **Queda el matiz de presentación**: la moneda que se muestra sigue siendo la base (`useStats` con USD por defecto); eso es R-026 y es independiente del cálculo. |
| R-009 | Proyectos | Riesgos con costo que afecte el presupuesto | **Abierto.** `Risk` no tiene campo de costo; ningún cálculo lo descuenta del presupuesto. |
| R-010 | Proyectos | Categoría de proyecto como lista desplegable, con opción de personalizar | **Abierto.** No existe campo "categoría" a nivel de proyecto en absoluto (el único "category" es el de Riesgos, y es texto libre). |
| R-011 | Proyectos | El semáforo sale distinto en el listado que en el detalle | **Resuelto.** `computeHealthStatus` es ya la única fuente para ambas vistas (`stats.routes.ts:120`, `project-detail.routes.ts:106`), con auto-corrección si diverge. (Distinto del matiz de colores de CPI/SPI que sigue abierto como D-7). |
| R-012 | Proyectos | La tasa a dólares debe fijarse en la fecha de contratación, no recalcularse después | **Resuelto el 2026-10-05.** Presupuesto y precio de venta se valoran a `Project.startDate` (`financial.ts:480-486`, `toFinancialsInput` en `financial.ts:717`), no a la fecha de consulta. Medido en la base local: el presupuesto de *Migración Cloudera a Azure* pasa de 121.518,99 a 111.627,91 USD y deja de moverse con la tasa. **Depende de D-10a**: si la fecha de contrato no es la de inicio, hace falta un campo nuevo. |
| R-013 | Capacidad | Al asignar un consultor, asignar también su proyección | **Resuelto el 2026-10-05.** `POST /api/assignments` crea también el `Forecast` correspondiente (mismo proyecto/consultor/fechas, `hoursProjected` calculado con `calculateCommittedHours` — la misma lógica de capacidad del resto de la pantalla — y `hourlyRate`/`currency` del consultor), en una transacción con la asignación: `assignments.routes.ts`. Se omite si la asignación nace COMPLETED (fechas ya vencidas) o si el cálculo da 0 horas. El frontend avisa con un toast ("Asignación creada, con su proyección de horas."): `CapacityTab.tsx`. Editar una asignación no toca su Forecast (no hay relación en el esquema; es una semilla en la creación, no una sincronización). De paso se corrigió que el toast de éxito de esta pantalla quedaba tapado por los botones de la tabla y por el panel de RAG Chat (`z-index`, `createPortal` en `App.tsx`, y fondo opaco — el tinte de `--state-*-bg` es translúcido en modo oscuro — en `App.css`, aplica a los 4 tipos de toast en toda la app). **Limitación conocida, no resuelta aquí**: al eliminar una asignación, su `Forecast` auto-generado no se borra (no hay relación en el esquema para hacer cascada); queda como proyección huérfana en Proyecciones. |
| R-014 | Capacidad | Opción de editar una asignación | **Resuelto el 2026-10-05.** El backend ya tenía `PUT /api/assignments/:id` completo (valida proyecto/consultor/sobrecarga, bloquea si está completada/cancelada) y el frontend ya tenía `updateAssignment` en `services/api.ts`, pero ninguna pantalla lo usaba. Se agregó el botón "Editar" (visible solo en PLANNED/ACTIVE/PARTIAL) en `CapacityTab.tsx` (`AssignmentsPanel`), que reutiliza la misma modal de creación precargada, con título y botón de envío condicionados al modo. De paso se corrigió un desfase de un día en las columnas de fecha de Asignaciones/Bloqueos/Vista general (`CapacityTab.tsx`) y de Hitos/Asignaciones/línea base (`ProjectDetailTab.tsx`): usaban `toLocaleDateString` en huso horario local sobre fechas UTC; ahora usan `formatDate`/`formatDateTime` de `utils/formatDate.ts`, ya el estándar en Forecasts/FX/Ingresos/Horas. |
| R-015 | Capacidad | Asignar riesgos por consultor | **Resuelto el 2026-10-05.** `Risk.consultantId` nuevo (nulable, convive con `owner`): `schema.prisma`, migración `20261005231000_riesgo_por_consultor`. Backend valida el consultor e incluye `{id, fullName}` en GET/POST/PUT: `risks.routes.ts:10-27,54-56,74-76` (el include se reexporta como `riskInclude` y también se usa en `GET /:id/detail`, `project-detail.routes.ts`, para que el detalle del proyecto vea el mismo dato). Detalle del proyecto permite elegir consultor al crear un riesgo y lo muestra en la tabla: `ProjectDetailTab.tsx` (`RiesgosTab`). Capacidad agrega una vista de solo lectura de riesgos abiertos agrupados por consultor dentro del detalle expandido de cada proyecto, con enlace a Detalle del proyecto para editar: `CapacityTab.tsx` (`ByProjectPanel`). |
| R-016 | Capacidad | Costo total por consultor | **Parcial.** El costo por consultor existe dentro de cada proyecto; falta el total consolidado entre todos sus proyectos en la vista general. |
| R-017 | Actividades | Al completar una actividad, que se actualicen las horas automáticamente | **Abierto, y en sentido contrario al pedido.** Hoy las horas de la actividad se calculan *leyendo* el timesheet (`activities.routes.ts:41`); no hay nada que cree horas al completar una actividad. |
| R-018 | Actividades | Ver el proyecto asignado y el estado de cada actividad | **Resuelto.** Ambos se muestran en la tabla y en el Kanban. |
| R-019 | Actividades | La sincronización con Teams debe traer las actividades del consultor conectado, no de otro | **Resuelto.** El selector se bloquea con sesión activa y siempre sincroniza el calendario de quien está conectado. |
| R-020 | Horas | PM recibe horas y horas extra para aprobar, con notificación semanal por correo | **Resuelto el 2026-10-06, junto con R-022.** Trabajo `approval-digest` (`backend/src/modules/approvals/weekly-digest.job.ts:145-227`), registrado en el ciclo horario (`backend/src/modules/jobs/jobs.service.ts:48-56`) y en el catálogo vigilado por `/health` (`backend/src/modules/jobs/job-runs.service.ts:58-68`). Agrupa por PM con el **mismo criterio que la pantalla de aprobación** (`project.projectManagerEmail`): `backend/src/utils/approval-digest.ts:225-280`. Correo en `backend/src/utils/notifications.ts:422-529`, con `escaparHtml` en todo valor interpolado. Configurable en Administración → Resumen de Aprobaciones (`backend/src/modules/admin/approval-digest.routes.ts`, `frontend/src/features/admin/ApprovalDigestTab.tsx`). Pruebas: `backend/src/utils/__tests__/approvalDigest.test.ts` (29) y `backend/tests/routes/resumen-aprobaciones.test.ts` (20). |
| R-021 | Horas Extra | Solo Admin puede solicitar, no el Consultor | **Resuelto** (el síntoma ya no existe). `POST /api/extra-hours` y el botón del frontend ya autorizan a CONSULTANT. |
| R-022 | Horas Extra | PM aprueba y notifica a Financiero | **Resuelto el 2026-10-06, junto con R-020.** El aviso inmediato por cada solicitud queda **apagado por defecto** y detrás de un interruptor, no borrado (`backend/src/modules/extra-hours/extra-hours.routes.ts:553-577`, `ApprovalDigestConfig.immediateExtraHour`): si el negocio descubre que para una hora extra urgente esperar al lunes no sirve, recuperarlo es un clic y no un despliegue. Las horas extra pendientes entran ahora en el mismo resumen semanal que las horas regulares. El aviso a Nómina **al aprobar** no se toca: es otro flujo y sigue siendo inmediato. |
| R-023 | Horas Extra | Calendario de solicitud solo desde hoy en adelante | **Resuelto**, con matiz: aplica a CONSULTANT; ADMIN/PM quedan exentos a propósito (para registrar en nombre de otros retroactivamente). |
| R-024 | Horas Extra | Delegación falla, dice que el correo no existe | **Resuelto el 2026-10-06 en lo que era un defecto; lo que queda es decisión de negocio (D-13).** `POST /api/delegations` buscaba al delegado solo en `User`, y esa fila nace la primera vez que la persona inicia sesión, así que delegar en un consultor recién dado de alta fallaba. Ahora se busca en `User` **y** en `Consultant`, sin distinguir mayúsculas porque `Consultant.email` no está normalizado (`backend/src/modules/delegations/delegations.routes.ts:88-100`). El mensaje de error también cambió: decía «no está registrado en el sistema», que sonaba a error de tipeo; ahora dice dónde se buscó. **Lo que el arreglo NO hace, a propósito**: que el delegado pueda aprobar. `PATCH /api/extra-hours/:id/approve` lleva `authorize([ADMIN, PM])` (`backend/src/modules/extra-hours/extra-hours.routes.ts:796`), así que un delegado cuyo único rol es `CONSULTANT` choca con el guard antes de que `canReviewExtraHour` mire su delegación. Ampliarlo cambiaría quién puede aprobar horas extra: eso es **D-13**. Mientras tanto la pantalla lo avisa (`frontend/src/features/extraHours/ExtraHoursTab.tsx:1858-1875`). Pruebas: `backend/tests/routes/delegacion-destinatario.test.ts` (5). Sin migración. |
| R-025 | Gastos | Agregar categorías de capacitación y horas extra; aclarar qué cubre "Servicios" | **Resuelto en su parte técnica** por D-4 (`d6b807c`). Las categorías de gasto salieron del código a un catálogo editable desde Administración: "Capacitación" ya existe —la recogió el barrido de la migración, estaba en uso sin figurar en la lista del código— y "Horas extra" se añade desde la pantalla sin desplegar. `ExpensesTab.tsx:27` ya solo es respaldo si la API no responde. **Queda la parte de negocio**: qué cubre "Servicios" sigue sin definir. |
| R-026 | Gastos | Siempre aparece en USD sin importar la moneda elegida, y la conversión no coincide | **Resuelto del todo el 2026-10-06.** La mitad de cálculo se cerró el 2026-10-05 convirtiendo cada gasto con la tasa de su `entryDate` (`financial.ts:509-513`), que era la causa de que el importe convertido no cuadrara con el original. La mitad de presentación se cierra ahora: la vista agrupada ya no arranca en USD fijo, sino en la moneda del proyecto. La decide `monedaBasePorDefecto()` (`frontend/src/features/expenses/gastosUtils.ts:113`), que solo contesta cuando **todos** los gastos a la vista comparten moneda de proyecto —el caso normal al filtrar por uno— y si no cae al respaldo, porque con varias monedas mezcladas ninguna es «la del proyecto». Se conecta en `ExpensesTab.tsx:158-162`, con la elección manual del usuario por encima (`baseCurrencyElegida`, `:122`), y `GastosFilters.tsx:53-55` añade esa moneda al selector si no era una de las cuatro fijas, para que no quede en blanco con un proyecto en PEN o CLP. Pruebas: `frontend/src/test/gastosUtils.test.ts` (5) y `frontend/src/test/GastosMonedaYProyecto.test.tsx` (4). **Matiz que queda**: esta pantalla convierte en el cliente con `convertToBase()` y las tasas de hoy, no con la tasa de la fecha de cada gasto como hace el backend. Los totales agrupados de Gastos pueden no coincidir con los del Tablero o Portafolio. No se tocó aquí porque es la mitad de cálculo, ya dada por cerrada. |
| R-027 | Gastos | Buscar proyecto como lista desplegable | **Resuelto el 2026-10-06.** El `<input type="search">` de la barra de filtros se sustituye por el `SearchableSelect` que ya usaban Portafolio y Proyectos (`frontend/src/features/expenses/GastosFilters.tsx:73-81`), con `allowFreeText` para no quitarle a nadie la posibilidad de escribir el nombre a mano. El filtro sigue el mismo criterio que Portafolio: coincidencia exacta por `id` cuando se elige de la lista, por nombre cuando se escribe (`ExpensesTab.tsx:137-152`). **Cambio de alcance deliberado**: el campo antiguo también buscaba por categoría y por importe; ahora es un filtro de proyecto y solo eso, porque las categorías ya tienen sus propios chips justo debajo y un control etiquetado «Proyecto» que además filtre por importe engaña. Pruebas: `frontend/src/test/GastosMonedaYProyecto.test.tsx` (2). |

### 6.2 Cambios propuestos en reunión (Juan Espinosa)

| ID | Título | Qué pidió | Estado y evidencia |
|---|---|---|---|
| R-028 | Corregir visibilidad del panel de administrador | Restringir el panel de Admin solo al rol Admin | **Resuelto.** Permiso `users:manage` lo tiene únicamente ADMIN, reforzado también en el backend (`users.routes.ts`). Defensa en profundidad correcta. |
| R-029 | Mostrar parte del presupuesto como porcentaje | Formatear una parte del presupuesto como % en vez de valor absoluto | **Resuelto** (con ambigüedad). El uso de presupuesto y el avance ya se muestran como % en Portafolio/Proyectos/Dashboard. No está claro a qué parte puntual se refería el pedido original. |
| R-030 | Documentación técnica del desarrollo | Documentar arquitectura y decisiones de diseño (pedido de Francis Garrido) | **Resuelto.** `DOCUMENTACION_TECNICA.md`, `MAPA_PROYECTO.md`, `DISENO.md` y varios más. |
| R-031 | Definir fecha/ventana de lanzamiento | Franja tentativa de lanzamiento (pedido de Juan Bedoya) | **Decisión.** Pura decisión de negocio; nada en el código la resuelve. Sigue sin nada en producción (§0 de este documento). |
| R-032 | Corregir filtros del dashboard/portafolio | Los filtros no actualizan el presupuesto total mostrado | **Abierto — mismo bug que R-005**, confirmado en código. |
| R-033 | Fijar el presupuesto en su moneda original | No recalcular el presupuesto contratado cada vez que cambia la tasa | **Resuelto el 2026-10-05.** El presupuesto se guarda y se sigue guardando en su moneda original; lo que cambia es que su reexpresión a la moneda base se hace con la tasa de la fecha de contratación y no con la del día (`financial.ts:480-486`). También en la línea base de la curva EVM (`project-detail.routes.ts:292`), en el cierre mensual (`snapshots.routes.ts:119`) y en el motor de alertas (`alerts.service.ts:115`), donde antes una alerta podía dispararse solo porque la tasa de hoy había encogido el presupuesto. |
| R-034 | Definir lógica de fecha para la tasa de cambio | Elegir si la conversión usa fecha de factura, de pago o de balance | **Técnicamente resuelto el 2026-10-05; la decisión de negocio pasa a D-10.** Se eligió, y se dejó escrito en el código, la opción conservadora: **fecha de factura/reconocimiento** (`FinancialEntry.entryDate`) para ingresos y gastos, **fecha de contratación** (`Project.startDate`) para presupuesto y precio de venta, **fecha del día trabajado** para el costo de las horas. La "fecha de balance" queda descartada a propósito: es la que producía el defecto. Falta que el negocio confirme factura vs. cobro (**D-10b**); si es cobro, hace falta un campo de fecha de pago que hoy no existe. |
| R-035 | Seguimiento de presupuesto mensual con semáforo | Semáforo mensual con compensación entre meses | **Abierto.** `MonthlySnapshot` guarda actuales por mes pero no tiene estimado-por-mes, semáforo mensual ni lógica de compensación. |
| R-036 | Separar gastos por categoría | Saber cuánto se consumió de cada rubro (capacitación, riesgo, ejecución) | **Parcial.** Costo laboral vs. gastos directos ya se separan (visible en un tooltip del Dashboard) y Gastos ya filtra por categoría. Falta una vista persistente de desglose, y "riesgo" como rubro no existe (ver R-009). |
| R-037 | Fusionar módulos de Ingresos y Gastos | Una sola vista para facilitar edición y balance general | **Parcial.** El modelo de datos ya se fusionó (`FinancialEntry`) y el menú ya es una sola pestaña "Ingresos/Gastos". Pero sigue siendo un selector entre dos paneles separados, no una tabla combinada con balance general. |
| R-038 | Vista separada de tarifa cliente vs. tarifa proyecto | Módulo distinto (no una columna) para costo interno vs. tarifa al cliente, con acceso restringido | **Parcial.** `hourlyRate` (costo) y `sellRate` (venta) ya existen con restricción de acceso por rol, pero como columnas del mismo formulario de Proyecciones, no como vista separada. |
| R-039 | Campo "tipo de hora" al registrar horas | Normal / capacitación / hora extra / ausencia | **Abierto.** `TimeEntry` no tiene ese campo; `source` es un detalle técnico interno (`MANUAL`/`TIMESHEET`/`TIMER`), no elegible por el usuario. |
| R-040 | Aprobación del PM para habilitar horas extra | El PM debe aprobar antes de que el consultor pueda solicitar | **Abierto.** Existe `allowExtraHours` por proyecto, editable en cualquier momento por PM/ADMIN, pero no es una aprobación explícita ni es por consultor. |
| R-041 | Definir quién puede pedir horas extra por mes | El PM activa mes a mes, por consultor | **Abierto.** No existe ninguna dimensión temporal ni por persona; solo el interruptor de proyecto de R-040. |
| R-042 | Fusionar horas extra en el reporte general de horas | Integrarlas al informe de Horas en vez de mantenerlas aparte | **Abierto.** El informe semanal de Horas marca como "extra" lo que excede 8h/día o cae en fin de semana, pero eso es una regla visual sobre horas regulares — no integra el módulo real de Horas Extra (aprobación, recargos, nómina). |
| R-043 | Alerta de utilización al 100% de un consultor | Alerta visual al llegar al límite de horas asignadas | **Parcial.** Al superar el 100% sí cambia a estado "Sobrecargado" visualmente; exactamente al 100% queda como "Completo" (neutral). No hay alerta push — `AlertType.CONSULTANT_OVERLOADED` nunca se genera (mismo hallazgo que DEP-06). |
| R-044 | Alerta de límite legal de horas extra por país | Avisar según los topes legales vigentes por país | **Resuelto.** El motor de cálculo ya emite avisos de límite diario y semanal configurados por país, visibles en el formulario de solicitud. |
| R-045 | Gestión formal de proveedores/terceros (v2.0) | Registrar horas de terceros subcontratados, no solo como gasto fijo | **Abierto**, consistente con que el propio ítem lo marca para v2.0. Solo existe `Consultant.isInternal` como booleano simple. |
| R-046 | Evaluar registro automático de tiempo tipo Clockify | Se había descartado para el MVP; quedó en backlog para evaluar | **Abierto, intencional.** El Tracker que sí se construyó es un cronómetro manual (inicio/pausa), no captura automática en segundo plano. Sigue siendo una evaluación futura, no un pendiente técnico. |
| R-047 | Reporte consolidado de horas trabajadas | Más que exportar a CSV sin resumen | **Parcial.** `ReportsTab` ya tiene totales, tabla por consultor y gráfica — la premisa original de "solo CSV" ya no aplica. Limitación real: la ventana es de una semana a la vez, no un rango flexible multi-mes. |
| R-048 | Vista/reporte para el cliente final | Reporte pensado para compartir con el cliente | **Abierto.** Sin evidencia de ninguna vista o reporte etiquetado para cliente final en todo el repo. |
| R-049 | Asociar factura/orden de compra a cada recurso facturado | Para modelos de staffing facturados por recurso | **Abierto.** Ningún campo de factura u orden de compra en `FinancialEntry`, `Assignment` ni `Forecast`. |
| R-050 | Afinar el cálculo del semáforo de salud | Hoy se basa solo en presupuesto | **Parcial.** `computeHealthStatus` ya no se basa solo en presupuesto (usa alertas, CPI, SPI, riesgos, hitos y margen) — el reclamo original ya está resuelto. Queda abierto el matiz de D-7: los cortes de color de Portafolio no coinciden con los del semáforo; la decisión ya se tomó (pantalla de configuración) pero **aún no está construida**. |
| R-051 | Acceso de comercial a disponibilidad y tarifas | Dar a Fernando (comercial) acceso a consultores disponibles y sus tarifas | **Abierto + Decisión nueva.** No existe un rol "Comercial". VIEWER ve disponibilidad pero no tarifas (excluido a propósito de `puedeVerTarifas`). Hace falta definir el rol/permiso exacto antes de construir nada — **candidato a una décima decisión (D-10)** junto a las de `DECISIONES_REUNION.md`. |
| R-052 | Modelo de centros de costo y sincronización contable | Definir el modelo y cómo se sincroniza con contabilidad | **Decisión.** Cero menciones de "centro de costo" en todo el repo. El propio ítem pide "definir el modelo" — es un pendiente de producto, no un bug. |
| R-053 | Mantener en backlog: sincronización con calendario de Teams | Medir % de tiempo en reuniones vs. trabajo efectivo | **Resuelto, mejor de lo pedido.** `ActivitiesTab` ya calcula "Sobrecarga de Reuniones (Teams)" con aviso si supera 30%. El módulo de Actividades ya quedó oculto salvo para ADMIN (D-8, permiso `activities:manage`, commit `c360afe`). |

**Fuente:** `documentacion/Backlog.xlsx` (53 filas, columnas ID/Prioridad/Título/Detalle/
Solicitante/Fecha). Verificación de estado contra `dev` hecha el 2026-10-05; si el código
avanza, estas etiquetas quedan desactualizadas y hay que repetir la verificación antes de
confiar en ellas para planear trabajo nuevo.

---

## 7. Plan de desarrollo — backlog Greysi repartido entre 3 personas

Reparte los 27 ítems de §6.1 por **carga de trabajo estimada**, no por cantidad de ítems — una
tarea grande no vale lo mismo que una chica. "Persona 1/2/3" son marcadores: sustitúyelos por
los nombres reales al asignar. Los tamaños salen de lo ya verificado contra el código en §6.1,
no de una sesión formal de planning poker:

| Tamaño | Qué significa | Ejemplo en este backlog |
|---|---|---|
| **S** (1 punto) | Un archivo o dos, sin tocar el modelo de datos | Cambiar un `<input>` por `<select>`, agregar un botón |
| **M** (2 puntos) | Backend y frontend juntos, o un campo nuevo con su migración | Campo nuevo + Zod + Prisma + formulario |
| **L** (3 puntos) | Varias piezas coordinadas, o un concepto que no existe hoy | Comisiones/impuestos en Portafolio, riesgos por consultor |

**Antes de repartir, se descuentan 7 de los 27:**

- **6 ya resueltos, sin acción**: R-004, R-011, R-018, R-019, R-021, R-023 (el detalle de cada
  uno está en §6.1).
- **R-017 queda diferido, sin asignar.** Depende de que se resuelva D-8 (¿se usa Actividades o
  se retira?, hoy en *StandBy*). Construir "que las horas se actualicen al completar una
  actividad" antes de esa respuesta es trabajo que se tira si el módulo se retira.

Quedan **20 ítems reales, 34 puntos entre los tres** (≈11-12 cada uno).

> **Actualización 05/10/2026.** Dos ítems más cayeron sin tocarlos, de rebote de las decisiones
> de negocio: **R-053** (ocultar Actividades) con D-8, y **R-025** (categorías de gasto) con D-4.
> El bloque de Moneda queda en **11 puntos reales**. Antes de empezar cualquier ítem conviene
> comprobar si sigue abierto: la base se movió mucho esta semana.

### Persona 1 — Portafolio y Proyectos (11 puntos)

| ID | Qué hay que hacer | Tamaño |
|---|---|---|
| R-007 | País de `<input>` libre a `<select>`, igual que ya existe en Consultores (`ConsultantsTab.tsx:327-329`) | S |
| R-006 | Botón "Limpiar filtros" en Portafolio (reusar el patrón que ya existe en Dashboard) | S |
| R-009 | Campo de costo en `Risk` y descontarlo del presupuesto en `financial.ts` | M |
| R-010 | Campo "categoría" en `Project` — lista desplegable con opción "otra, especifica" | M |
| R-005 | Que los KPI de resumen de Portafolio respeten el filtro activo (hoy leen el total sin filtrar, mismo bug que R-032 de §6.2) | M |
| R-003 | Precio de venta visible en la tabla de Portafolio, y diseñar comisiones/impuestos/descuento (no existe hoy en ningún lado — necesita primero decidir qué campos lleva y cómo entran en el margen) | L |

**Coordinar con Persona 3**: R-005 y R-009 tocan `stats.routes.ts`/`financial.ts`, los mismos
archivos que el trabajo de Persona 3 sobre tasas de cambio. Avisarse antes de tocarlos para no
pisarse.

### Juan Espinosa — Dashboard y Capacidad (11 puntos)

> **Tomado por Juan Espinosa el 05/10/2026.**

| ID | Qué hay que hacer | Tamaño |
|---|---|---|
| R-002 | Quitar los gráficos de horas extra del Dashboard (`DashboardTab.tsx:1500-1517`); la navegación a Horas ya funciona | S |
| R-016 | Vista consolidada de costo total por consultor en Capacidad (hoy solo existe por proyecto) | S |
| R-013 | Al crear una asignación, crear también su `Forecast` correspondiente | M |
| R-014 | Opción de editar una asignación (hoy solo cancelar/completar/eliminar) — necesita endpoint `PATCH` | M |
| R-001 | Resumen mensual por proyecto en el Dashboard, con clic que lleve a su ficha en Proyectos | M |
| R-015 | Asociar riesgos a un consultor dentro de Capacidad — necesita `consultantId` en `Risk` | L |

**Coordinar con Persona 1**: R-015 y R-009 tocan el mismo modelo `Risk`. Si se resuelven en
paralelo, quien vaya segundo rebasa sobre una migración que el otro ya aplicó — decidir el
orden antes de empezar, no a mitad de camino.

### Juan Mahecha — Moneda transversal, Horas Extra y Gastos (11 puntos)

> **Tomado por Juan Mahecha el 05/10/2026.** Se elige este bloque a propósito: `R-008+R-012`
> continúa directamente el trabajo de conversión de monedas que ya se hizo esta semana
> (DEP-32, el libro de faltantes de `utils/currency.ts`), así que arranca con el contexto
> puesto en vez de con una curva de aprendizaje.

| ID | Qué hay que hacer | Tamaño |
|---|---|---|
| ~~R-024~~ | ~~Que la delegación busque también en `Consultant` por correo, no solo en `User`~~ **Hecho el 2026-10-06.** Sin migración. Evidencia en su fila de §6.1. Deja abierta **D-13**: el delegado se puede nombrar, pero sigue sin poder aprobar si su único rol es `CONSULTANT`. | S |
| ~~R-025~~ | ~~Categorías de "Capacitación" y "Horas extra" en Gastos~~ — **ya resuelto por D-4**; solo queda preguntar a negocio qué cubre "Servicios" | — |
| ~~R-027~~ | ~~Buscador de proyecto en Gastos a `SearchableSelect`, igual que Portafolio~~ **Hecho el 2026-10-06.** Se reutiliza el componente existente, sin crear otro. Evidencia en su fila de §6.1. | S |
| ~~R-026~~ | ~~Mostrar el gasto en la moneda del proyecto por defecto, no en USD fijo (`ExpensesTab.tsx:61`)~~ **Hecho el 2026-10-06.** Con esto R-026 queda cerrado entero: la mitad de cálculo ya estaba. Evidencia en su fila de §6.1. | S |
| ~~**R-008 + R-012**~~ | ~~**La pieza de mayor apalancamiento del plan**: conectar `FxRateHistory`/`GET /api/fx/rate?date=` (ya existen) al cálculo financiero~~ **Hecho el 2026-10-05.** Resueltos R-008, R-012 y R-033; R-026 y R-034 quedan resueltos en su parte de cálculo. Sin migración. Detalle y evidencia en el hallazgo transversal de §6. Lo que quedó fuera a propósito: la moneda de presentación de la vista agrupada de Gastos (R-026) y las dos confirmaciones contables de D-10. | L |
| ~~R-022~~ | ~~Cambiar la notificación de aprobación de horas extra de inmediata a un resumen semanal~~ **Hecho el 2026-10-06**, junto a R-020. Evidencia en su fila de §6.1. | M |
| ~~R-020~~ | ~~Notificación semanal al PM con las horas pendientes de aprobar — comparte la infraestructura del job semanal con R-022, construirlos juntos~~ **Hecho el 2026-10-06.** Se construyeron juntos, como decía la nota: un solo trabajo, un solo correo, una sola pantalla de configuración. Con migración idempotente `20261006120000_resumen_semanal_aprobaciones`. Queda abierta **D-12** (zona horaria del envío). | L |

**De regalo**: R-008+R-012 también resuelve de fondo R-026 de este mismo bloque y, sin trabajo
adicional, R-033/R-034 del backlog de Juan Espinosa (§6.2) — es la misma causa raíz, documentada
ahí mismo.

### Cómo verificar cada entrega

Mismos comandos de siempre (§5 de este documento) y, si el cambio toca presentación, las reglas
de `DISENO.md`. Al cerrar algo de este plan, actualiza su fila en §6.1 de **Abierto/Parcial** a
**Resuelto** con el archivo y línea que lo confirme — es la misma disciplina que ya se usó para
verificar el backlog completo, no hace falta inventar un formato nuevo.
