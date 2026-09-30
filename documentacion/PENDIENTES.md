# Pendientes de Synatrack

Lista viva de lo que falta. Si vas a tomar algo, empieza por aquí.

**Actualizado:** 2026-09-24 · **Rama con todo lo hecho:** `dev`

Para el detalle de cada arreglo ya hecho, ver `documentacion/cambios/`.
Para el histórico completo de la depuración, `documentacion/BACKLOG_DEPURACION.md`
(42 ítems, 29 resueltos). Este documento es el que hay que mirar para saber qué queda.

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
- [ ] Crear en Render el cron `app-gestion-jobs` si el Blueprint no lo aplica solo, y
      comprobar con `GET /api/jobs/status` que quedó activo.
- [ ] Revisar si las tasas de cambio quedaron congeladas durante los meses en que el cron
      apuntaba a un host que no existía.
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
| D-2 | **¿El umbral de margen por defecto debe ser 15 %?** Cuando un proyecto no tiene `marginThreshold` configurado se aplica 15, que era el comportamiento de facto. La alternativa es poblarlo en todos los proyectos y quitar el valor por defecto. | Es una regla de negocio |
| D-3 | **¿Un VIEWER debe ver los movimientos de todos los proyectos?** `GET /api/financial-entries` no aplica alcance por rol, a diferencia de otros módulos. | Política de visibilidad |
| D-4 | **¿Los ingresos se categorizan?** `FinancialEntry.category` solo se usa en gastos y queda nulo en ingresos, sin que el esquema lo impida. | Cambio de modelo si la respuesta es sí |
| D-5 | **¿La jornada laboral se configura por país, por consultor o ambos?** Necesario para poder arreglar DEP-41. | Define el diseño |
| D-6 | **Credenciales SMTP de prueba** para poder corregir el TLS del correo sin romper el envío. | Sin un buzón de prueba no se puede verificar |
| D-7 | **¿Cuáles son los umbrales buenos de CPI, SPI y uso de presupuesto?** La pantalla de Portafolio pinta con **0,85 / 1,00** y **90 % / 100 %**, pero `utils/health.ts` calcula la salud con **0,75** y **0,9**. Son criterios distintos para lo mismo, así que el color de una celda puede contradecir al semáforo de su propia fila. | Es una regla de negocio, no una decisión técnica |
| D-8 | **¿Se va a usar el módulo de Actividades?** El cronómetro y el timesheet permiten enlazar cada registro a una `Activity` para poder comparar horas estimadas con reales, pero no hay ninguna creada: el desplegable solo ofrece "Sin tarea" y parece roto. O se empieza a usar, o se retira el selector de las dos pantallas. | Decisión de producto |
| D-9 | **¿Las horas de sábado y domingo cuentan en el informe semanal?** Hoy el informe cubre de lunes a viernes y avisa aparte si hay horas en fin de semana, para no ocultarlas. Pero `Consultant.allowWeekendWork` existe, así que trabajar en fin de semana está contemplado: hay que decidir si entran en los totales o se siguen tratando como excepción. | Depende de cómo se factura y se controla la jornada |

---

## 2. Pendientes técnicos, por valor

### Alto

**DEP-41 — La jornada laboral no se puede configurar.**
`CapacityConfig` tiene `hoursPerDay` (8 por defecto) y `workDaysPerWeek` (5), por consultor
o por país, y `capacity.routes.ts` los lee en cinco sitios. Pero **no existe endpoint ni
formulario que los escriba**, así que la fila siempre es nula y toda la capacidad se calcula
con 8 h y 5 días para todo el mundo, sin importar el país ni la jornada real.
Bloqueado por D-5.

Desde el 2026-09-24 hay **un consumidor más**: `frontend/src/features/reports/reportUtils.ts`
declara `DAILY_LIMIT = 8` para decidir qué parte de cada barra del informe sale en rojo. Es
la misma jornada fija, ahora también en una pantalla que la gente mira. Cuando D-5 se
decida, hay que conectar los dos sitios, no solo `capacity.routes.ts`.

**Sin paginación.** Casi todos los `GET /` devuelven el conjunto completo
(`time-entries`, `extra-hours`, `consultants`, `projects`…). Solo `/api/audit` pagina, y
puede servir de plantilla. A medida que crezcan los datos, esto se vuelve el cuello de
botella; `AuditLog` además crece más rápido desde que guarda `before` y `after` completos.


**El TLS del correo está debilitado.** `utils/notifications.ts` usa
`rejectUnauthorized: false` y `ciphers: "SSLv3"`. Bloqueado por D-6.

### Medio

**DEP-32 — La conversión de moneda falla en silencio.** `convertAmountFallback` devuelve el
importe sin convertir cuando no hay tasa, en vez de señalarlo. Los importes salen en su
moneda original pero rotulados con la moneda base. Afecta especialmente a la nómina.

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

**Nadie vigila que el cron esté vivo.** Si el Blueprint no lo aplica y nadie lo crea a mano,
las tareas periódicas vuelven a no ejecutarse **en silencio**. Ya pasó con el cron de tasas
de cambio, que apuntó a un host inexistente durante meses sin que nadie lo notara.

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

## 4. Una trampa que ya apareció cinco veces

**Campos que el backend lee y que nadie puede escribir.** El modelo declara la columna, el
código la consulta, pero no está en ningún esquema Zod ni en ningún formulario, así que
queda siempre nula y la funcionalidad que depende de ella **no funciona, sin dar error**.

Ya pasó con `projectManagerEmail` (la aprobación de horas extra por el PM era imposible),
`marginThreshold` y `budgetAlertPct` (el umbral configurado se ignoraba), `identification`
(el documento salía siempre "No asignado" en la nómina) y `CapacityConfig` (DEP-41, todavía
abierto).

**Y una variante nueva (sexta vez), esta al revés:** en lugar de leer un campo que nadie
escribe, se escribió un valor fijo en el código donde ya existía la columna para
configurarlo. El informe de horas usa `DAILY_LIMIT = 8` en el frontend teniendo
`CapacityConfig.hoursPerDay` en el modelo. El efecto es el mismo -- la configuración no
manda -- y cuesta más de encontrar, porque no hay ninguna columna nula que delate el
problema.

**Si agregas un campo al modelo, agrégalo también al esquema Zod y al formulario en el mismo
cambio.** Y si encuentras código que lee un campo, comprueba que exista forma de escribirlo.

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
