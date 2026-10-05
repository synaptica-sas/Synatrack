# DISENO.md — Sistema de diseño de Synatrack

> Para quien llega nuevo al frontend. Explica qué tokens existen, cuándo usar cada uno y
> qué falta por migrar. Complementa a `CLAUDE.md` §8 y al agente `.claude/agents/disenador-ui.md`.

**Dónde vive cada cosa:**

| Qué | Dónde |
|---|---|
| Tokens (color, espaciado, radios, sombras, tipografía) | `frontend/src/index.css` (`:root`) |
| Contraparte de modo oscuro de esos tokens | `frontend/src/App.css`, bloque `body.dark` |
| Clases de patrón (`.panel`, `.kpi-card`, `.meter`…) | `frontend/src/App.css`, al final, sección "PATRONES BASE" |
| Pantalla de referencia ya migrada | `frontend/src/features/portfolio/PortfolioTab.tsx` |

---

## 1. Las tres reglas

1. **Cero colores literales en `.tsx`.** Todo color sale de un token. Si necesitas un matiz
   que no existe, créalo en `index.css` con su contraparte oscura y documéntalo; no lo
   incrustes en un `style`.
2. **Lo que se repite es una clase, no un `style={{ }}`.** Un estilo en línea vale para un
   valor calculado (el ancho de una barra, `flexGrow` de un segmento). Todo lo demás va a
   `App.css`.
3. **El color nunca es el único portador de información.** Un semáforo lleva además icono
   y etiqueta de texto. Un medidor lleva su número visible.

La identidad de Synaptica (navy `#121228`, ámbar `#f1a323`, azul `#234175`, verde `#6bb42d`,
rojo `#a8194c`, gris `#767676`) **no se cambia**. Lo que había que arreglar no era la paleta,
era que la mitad de la app pintaba con la paleta por defecto de Tailwind (`#6b7280`,
`#ef4444`, `#22c55e`, `#f59e0b`) copiada y pegada.

---

## 2. Escala de espaciado

Seis pasos. Con menos opciones es más difícil equivocarse; una escala de doce valores no la
usa nadie bien.

| Token | Valor | Cuándo |
|---|---|---|
| `--space-1` | 4px | Detalles pegados: icono + texto, interior de un chip |
| `--space-2` | 8px | Separación dentro de un control o de una celda |
| `--space-3` | 12px | Separación entre campos de un formulario, entre tarjetas de una rejilla |
| `--space-4` | 16px | Padding interior de una tarjeta o panel |
| `--space-6` | 24px | Separación entre bloques de una pantalla (`.page-stack`) |
| `--space-8` | 32px | Separación entre secciones mayores |

Si te hace falta un valor intermedio, casi siempre el correcto es el paso de al lado. No
añadas pasos nuevos sin discutirlo.

## 3. Radios

El radio comunica jerarquía: cuanto mayor la superficie, mayor el radio. No mezcles dos
radios distintos en el mismo elemento.

| Token | Valor | Cuándo |
|---|---|---|
| `--radius-sm` | 6px | Chips, barras de progreso, celdas, botones pequeños |
| `--radius-md` | 10px | Controles de formulario y botones estándar |
| `--radius-lg` | 14px | Tarjetas, paneles, modales |
| `--radius-pill` | 9999px | Píldoras, avatares, rellenos de medidor |

## 4. Sombras

Tres niveles de elevación, **nunca negro puro**: la sombra se tiñe con el navy de marca
(`--shadow-color`) para no ensuciar el fondo.

| Token | Cuándo |
|---|---|
| `--shadow-sm` | Reposo: separa una tarjeta del fondo sin llamar la atención |
| `--shadow-md` | Hover de tarjeta, barras fijas, popovers |
| `--shadow-lg` | Capas flotantes: drawers, modales, menús desplegados |

En modo oscuro `--shadow-color` pasa a un navy casi negro (`4 4 14`) con más opacidad, y
`md`/`lg` añaden un filo claro `inset` arriba: sobre fondo oscuro la elevación se percibe
más por el borde iluminado que por la sombra.

## 5. Color

### 5.1 Semánticos existentes (prefiérelos a los de marca)

`--text`, `--text-soft`, `--text-strong`, `--bg`, `--card-bg`, `--border-color`, las familias
`--state-*-bg/border/text` (chips y mini-tarjetas) y `--tint-*` (categóricos decorativos).

### 5.2 Equivalentes de marca a los grises de Tailwind

Existen para que sustituir un literal sea cambiar una palabra, no inventar un color:

| Literal que encuentres | Token |
|---|---|
| `#6b7280`, `#9ca3af`, `#64748b` | `var(--text-muted)` |
| `#f9fafb`, `#f3f4f6` | `var(--surface-subtle)` |
| `#e5e7eb`, `#d1d5db` | `var(--border-subtle)` |

`--text-muted` está calculado para llegar a 4.5:1 sobre `--card-bg` en ambos temas, así que
sirve para texto pequeño. El gris de marca `--color-sec-gray` (`#767676`) se queda en 4.3:1 y
solo vale para bordes, iconos y texto grande.

### 5.3 Estados: texto sobre superficie vs. relleno sólido

Son dos usos distintos y por eso son dos familias de tokens distintas.

**a) `--state-*-strong` — color de TEXTO de un estado sobre `--bg` / `--card-bg`.**
Cifras de un KPI, celdas de tabla, títulos de aviso. Versiones oscurecidas de la marca en
claro y aclaradas en oscuro para cumplir 4.5:1.

| Literal que encuentres (texto) | Token | Clase |
|---|---|---|
| `#ef4444`, `#dc2626` | `--state-danger-strong` | `.tone-danger` |
| `#f59e0b`, `#b45309` | `--state-warning-strong` | `.tone-warning` |
| `#22c55e`, `#16a34a` | `--state-success-strong` | `.tone-success` |
| `#1d4ed8` | `--state-info-strong` | `.tone-info` |
| `#9ca3af` | `--state-neutral-strong` | `.tone-muted` |

**b) `--state-*-solid` + `--state-*-on-solid` — cuando el color ES el dato.**
Barras de distribución, insignias de semáforo, rellenos de medidor. `*-solid` es el fondo,
`*-on-solid` el color de texto que encima de él contrasta.

> **Ojo: el texto sobre sólido NO siempre es blanco.** Sobre el verde y el ámbar de marca el
> blanco se queda en 2,6:1; encima va el navy. Sobre el rojo sí va blanco. Por eso hay un
> token por estado en vez de un `#fff` escrito a mano. Los 87 `#fff` incrustados en los
> `.tsx` son exactamente este error, y en modo oscuro dejan texto blanco sobre blanco.

### 5.4 Color en los gráficos

El proyecto dibuja los gráficos a mano en SVG y cada uno traía su propia lista de literales
(`#ff9c2c`, `#3b82f6`, `#e2e8f0`, `#64748b`…): una **tercera** paleta accidental, sin modo
oscuro y sin relación con la marca. Ahora hay dos familias de tokens:

| Token | Para qué |
|---|---|
| `--chart-1` … `--chart-7` | Serie **categórica**: cuando cada color representa una categoría (porciones del donut). Arranca por la marca (ámbar, azul, verde, rojo) y sigue con los tintes violeta, cian y gris |
| `--chart-grid`, `--chart-axis`, `--chart-track` | Andamiaje: rejilla, textos de eje y pista de una barra. Va por detrás del dato |

Para el color de **estado** dentro de un gráfico (presupuesto excedido, en aviso, correcto)
**no** se usa la serie categórica: se usa `--state-*-solid`, el mismo verde/ámbar/rojo que el
resto de la aplicación. Un gráfico no inventa su propio semáforo.

En modo oscuro la serie se aclara (el azul y el rojo de marca se apagan sobre navy) y
`--chart-grid` pasa a ser un blanco translúcido.

> **El color se pone con clase, no con el atributo `fill`.** `fill="#ff9c2c"` no puede
> resolver un token ni tener contraparte oscura. Para eso están `.chart-fill--1..7`,
> `.chart-stroke--*`, `.chart-grid`, `.chart-axis`, `.chart-label`, `.chart-track`,
> `.chart-gap` y `.chart-hole`. Los dos últimos pintan del color de la tarjeta la separación
> entre porciones y el hueco del donut, que antes eran dos `#fff` incrustados.

### 5.5 Contraste comprobado

| Combinación | Claro | Oscuro |
|---|---|---|
| `--text-muted` sobre `--card-bg` | 5,4:1 | 6,7:1 |
| `--state-success-strong` sobre `--card-bg` | 5,0:1 | 9,3:1 |
| `--state-warning-strong` sobre `--card-bg` | 6,4:1 | 5,1:1 |
| `--state-danger-strong` sobre `--card-bg` | 7,3:1 | 6,3:1 |
| `--state-info-strong` sobre `--card-bg` | 10:1 | 6,8:1 |
| `--state-success-on-solid` sobre `--state-success-solid` | 6,5:1 | 6,5:1 |
| `--state-warning-on-solid` sobre `--state-warning-solid` | 5,1:1 | 5,1:1 |
| `--state-danger-on-solid` sobre `--state-danger-solid` | 7,3:1 | 5,4:1 |

Recordatorio: el ámbar `#f1a323` **no alcanza** para texto pequeño sobre blanco. Úsalo como
fondo con texto oscuro (`--state-warning-solid` + `--state-warning-on-solid`) o como acento,
nunca para texto fino sobre claro; para eso está `--state-warning-strong`.

---

## 6. Clases de patrón

Todas construidas solo con tokens. Están al final de `App.css`.

| Clase | Para qué |
|---|---|
| `.page-stack` | Contenedor de la pantalla: columna con `gap: var(--space-6)` |
| `.panel`, `.panel__head`, `.panel__title`, `.panel__body` | Superficie estándar (tarjeta, caja de filtros, bloque) |
| `.kpi-grid`, `.kpi-card`, `.kpi-card__label/__value/__sub` | Rejilla de indicadores; se reordena sola por `auto-fit` |
| `.tone-success/-warning/-danger/-info/-muted` | Color de texto de un dato según su estado |
| `.field-grid`, `.field-label`, `.select-control` | Formularios; la rejilla colapsa a una columna en móvil |
| `.status-badge` + `--success/--warning/--danger/--neutral` | Insignia de estado: fondo sólido + icono + etiqueta |
| `.stack-bar`, `.stack-bar__seg--*` | Barra de distribución apilada |
| `.legend`, `.legend__item`, `.legend__dot--*` | Leyenda con etiqueta de texto junto a cada color |
| `.meter`, `.meter__track`, `.meter__fill--*`, `.meter__value` | Medidor de porcentaje con su número visible |
| `.notice`, `.notice--danger/--warning`, `.notice__title` | Aviso en línea |
| `.chip-row`, `.chip-button` | Fila de chips pulsables |
| `.table-foot`, `.cell-num`, `.cell-center`, `.cell-strong`, `.cell-small`, `.cell-empty`, `th.is-sortable`, `tr.row-danger/.row-warning` | Utilidades de tabla |
| `.toolbar-btn` | Botón de la barra de acciones del encabezado |
| `.sr-only` | Texto solo para lectores de pantalla |

### Clases añadidas al migrar Encabezado, Alertas y Tablero

| Clase | Para qué |
|---|---|
| `.page-header`, `__text`, `__title`, `__icon`, `__description`, `__actions` | Encabezado de pantalla. Lo usan las 16 pantallas; a 560px se apila y las acciones ocupan el ancho |
| `.filter-row`, `.filter-row__grow`, `.filter-row__fixed` | Fila de filtros: un campo que crece y controles de ancho fijo; a 560px cada uno pasa a ocupar la fila |
| `.count-badge` | Contador neutro junto a un título de grupo |
| `.panel__title--heading` | `.panel__title` cuando el título es un encabezado real (`h3`) con icono |
| `.empty-state`, `__icon`, `__title`, `__text` | "No hay nada que mostrar", que no es un error |
| `.alert-groups`, `.alert-list`, `.alert-item` + `--danger/--warning/--info`, `__body`, `__meta`, `__project`, `__time`, `__message`, `__actions`, `__resolve` | Tarjeta de alerta de la bandeja |
| `.card-head`, `.card-head__actions` | Cabecera de tarjeta: título a la izquierda, acciones a la derecha |
| `.menu-anchor`, `.menu-pop` (+ `--pad`), `__item`, `__empty`, `__list`, `__row`, `__delete`, `__foot` | Menú desplegable anclado a un botón (exportar, vistas guardadas) |
| `.health-tiles`, `.health-tile` + `--success/--warning/--danger`, `__count`, `__label`, `__pct` | Mosaico de recuento por estado de salud |
| `.health-dot` + `--success/--warning/--danger` | Semáforo en una celda estrecha: lleva dentro el icono de forma distinta |
| `.stat-tile` + `--success/--warning/--danger/--info/--neutral`, `__value`, `__sub` | Mini-tarjeta de recuento con tinte de estado |
| `.table-pager`, `__status`, `__nav` | Paginación de tabla |
| `.chart-scroll`, `.chart-svg` (+ `--fixed`), `.chart-legend-row`, `.chart-legend`, `__item`, `__name`, `__value`, `__more`, `.chart-swatch--1..7`, `.chart-empty`, `.chart-caption` | Envoltorio, leyenda y estados de un gráfico |
| `.status-badge--info` | Faltaba el modificador de información en la insignia de estado |
| `.notice__text` | Cuerpo de un aviso, debajo de su título |

### Clase añadida al montar la pantalla de Jornada Laboral

| Clase | Para qué |
|---|---|
| `.notice--info` | Tercer tono de `.notice`, junto a `--danger` y `--warning`, con los tokens `--state-info-*` que ya existían. Es para una explicación que no es ni error ni advertencia: en Jornada Laboral, el recuadro que dice cómo se decide la jornada de cada persona. Lleva sus tres reglas (caja, `.notice__title` y `.notice__text`) como los otros dos tonos, así que no necesita nada propio en modo oscuro |

La pantalla **Jornada Laboral** (`features/workday/WorkdayConfigTab.tsx`) no añadió nada más:
es encabezado, avisos y dos tablas con campos, todo con `.section-stack`, `.card`,
`.card-head`, `.table-wrap`, `.state-chip--*`, `.inline-actions`, `.btn-sm`, `.cell-right`,
`.cell-strong`, `.field-help` y `.empty-note`, que ya existían. Cero colores literales y cero
estilos en línea.
| `.inline-list` | Lista de nombres separados en línea dentro de un aviso |
| `.kpi-sub`, `.kpi-sub--danger`, `.kpi-hint`, `.kpi-loading`, `.table-search`, `.card-title-tight`, `.field-grid--compact`, `.col-health/.col-company/.col-project`, `.cell-empty--roomy`, `.table-foot--tight`, `.chart-block`, `.fx-note--spaced` | Detalles sueltos que antes eran estilos en línea repetidos |

### Clases añadidas al montar Categorías Financieras

**Ninguna.** La pantalla `features/financial/FinancialCategoriesTab.tsx` (decisión D-4) se
armó entera con vocabulario existente: `.section-stack`, `.card`, `.card-head`,
`.card-title-tight`, `.field-help`, `.table-wrap`, `.notice--info` con `.notice__title` y
`.notice__text`, `.state-chip--success` / `--neutral` para activa y desactivada,
`.inline-actions`, `.btn-sm`, `.cell-right`, `.cell-strong` y `.empty-note`. Cero colores
literales y cero estilos en línea. Es la segunda pantalla seguida (tras Jornada Laboral) que
no necesita CSS propio: señal de que el vocabulario de tablas de configuración ya está
completo.

En Ingresos y Gastos, la columna y el desplegable de categoría tampoco añadieron nada: el
selector es un `<select>` del formulario y la celda sin categoría usa `.cell-empty`, que ya
existía.

### Clases añadidas al migrar Planificación de Capacidad

`features/capacity/CapacityTab.tsx` pasó de 123 estilos en línea y 28 colores literales a
**1 y 0**. El único que queda es el ancho calculado del relleno del medidor, que es el uso
legítimo. Casi todo salió de clases que ya existían (`.card-head`, `.field-grid--compact`,
`.select-control`, `.field-label`, `.meter`, `.state-chip`, `.subtabs`, `.section-stack`,
`.tone-*`, `.cell-strong`, `.cell-empty`, `tr.row-warning`, `.toolbar-btn`); lo propio de la
pantalla lleva prefijo `capacity-`:

| Clase | Para qué |
|---|---|
| `.capacity-btn-sm`, `.capacity-btn-row` | Los dos tamaños de botón pequeño: el de la cabecera de una tarjeta (Limpiar, Exportar CSV) y el que vive dentro de una celda (el alternador `▼ n`). Los dos conservan 2rem de alto mínimo |
| `.capacity-col-util`, `.capacity-util` + `--success/--warning/--danger` | Columna y valor del medidor de utilización. El porcentaje va escrito al lado del relleno: el color solo refuerza un dato que ya se lee |
| `.capacity-detail-cell`, `.capacity-subtable` | Fila desplegada y su tabla anidada. El fondo era `#f9fafb`, un parche blanco en modo oscuro; ahora es `--surface-subtle` |
| `.capacity-inline-select`, `.capacity-filters`, `.capacity-form-note`, `.capacity-span-full`, `.capacity-block-filter` | Controles sueltos: select estrecho en una cabecera, rejilla de filtros pegada a una tabla, nota bajo un título, tarjeta que ocupa las dos columnas cuando la de al lado no se pinta |
| `.capacity-modal`, `-header`, `-title`, `-close`, `-actions` | Modal de nueva asignación: ancho, cabecera con separador y pie con separador. Se apoyan en `.modal-card`/`.modal-header`/`.modal-actions`, que ya existían |
| `.capacity-form`, `.capacity-field` (+ `--full`, `--grow`), `.capacity-field-pair`, `.capacity-check` | Rejilla del formulario del modal y sus campos apilados. La etiqueta reusa `.field-label`; dentro de la columna se le quita el margen inferior porque ya separa el `gap` |
| `.capacity-picker` + `__search`, `__actions`, `__list`, `__role`, `__count` | Selector múltiple de consultores |

Tres decisiones que conviene conocer antes de migrar una pantalla parecida:

1. **Las píldoras `.pill ok/warn/error/neutral` pasan a `.state-chip--*`**, igual que en
   Detalle de Proyecto. `.pill` tenía su modo oscuro a base de `!important` con verdes y
   ámbares que no son los de marca; `.state-chip` sale de `--state-*` y ya trae sus reglas
   de especificidad para `body.dark .card` y `body.dark td`.
2. **Las etiquetas de filtro iban en ámbar de marca y centradas.** El ámbar sobre blanco se
   queda en 1,9:1 y no vale para texto de 0,75rem (§5.5), así que pasan a `.field-label`
   (`--text-soft`, alineada a la izquierda como en la pantalla de referencia). Lo mismo con
   el `(rol)` del selector múltiple, que ahora va en `--text-muted`.
3. **La navegación de sub-pestañas usaba `.sub-tabs`/`.tab`/`.active`, que no existen en
   ningún CSS**: eran cuatro botones ámbar idénticos, sin ninguna marca de cuál estaba
   activo. Pasan a `.subtabs`/`.subtab`/`.is-active`, el patrón que ya creó Detalle de
   Proyecto, donde el activo se distingue por color, peso y subrayado.

### Clases añadidas al migrar Horas Extra

`features/extraHours/ExtraHoursTab.tsx` pasó de 186 estilos en línea y 35 colores literales
a **0 y 0**. Son siete sub-pestañas (reportar, aprobar PM, aprobar nómina, cierre de nómina,
parámetros, festivos, delegaciones) que repetían la misma tarjeta, el mismo encabezado y la
misma tabla a mano. Reusa lo que ya existía (`.card-head`, `.field-grid`, `.inline-form`,
`.inline-actions`, `.notice--warning`, `.state-chip`, `.table-wrap`, `.cell-*`,
`.toolbar-btn`, `.modal-*`, `.empty-state`); lo nuevo es genérico a propósito, porque
`ActivitiesTab` y `EstimationCalculatorTab` repiten los mismos patrones:

| Clase | Para qué |
|---|---|
| `.page-stack--padded` | La pantalla con su aire lateral. A 560px el margen de 32px se reduce, que antes se comía un cuarto del ancho útil |
| `.two-pane` | Dos paneles asimétricos (ayuda a la izquierda, formulario o tabla a la derecha). Había tres proporciones distintas a ojo y ninguna colapsaba: a 400px seguían siendo dos columnas. Ahora una sola por debajo de 900px |
| `.card--roomy`, `.card--stack` | `.card` con padding holgado; `.card` que además apila su contenido |
| `.card-title` (+ `--rule`, `--tight`), `.card-lead` | Título de tarjeta, con filete inferior o pegado a una acción, y su entradilla. La clase se repite (`.card-title.card-title`) porque `.card h3` pesa (0,1,1) |
| `.section-intro__title`, `__text` | Tarjeta de presentación de una sección |
| `.form-label--sm` | El tamaño pequeño de `.form-label`. Convivían 0,78 / 0,8 / 0,85rem sin criterio |
| `.field-pair` (+ `--spaced`), `.form-row-3`, `.form-stack`, `.form-actions`, `.form-grid--tight`, `.inline-form--spaced`, `.inline-filter` + `__label` | Composición de formularios: dos campos que van juntos, fila de tres con el primero largo, campos apilados, pie de acciones y etiqueta en línea con su control |
| `.input-readonly`, `.control-sm` | Campo no editable (se repite la clase: `body.dark input` le ganaba y quedaba indistinguible de uno editable) y control en tamaño compacto |
| `.btn-block`, `.btn-sm`, `.btn-compact`, `.btn-success`, `.btn-danger`, `.btn-danger-soft`, `.btn-icon-danger` | Tamaños y estados de botón. Sobre el verde de marca el texto es navy (`--state-success-on-solid`), no blanco |
| `.success-banner` | Aviso flotante de operación correcta |
| `.modal-card--sm`, `.modal-actions--spaced`, `.modal-close` | Modal estrecho, pie separado y botón de cierre |
| `.cell-right`, `.cell-meta`, `.cell-dash`, `.cell-note`, `.cell-reject-note`, `.table-wrap--spaced`, `.empty-note` (+ `--center`) | Utilidades de tabla que faltaban: segunda línea de una celda, celda alineada a la derecha, "no hay nada" en línea |
| `.preview-card`, `__title`, `.preview-grid`, `.preview-note--success/--info`, `.preview-total`, `__amount` | Tarjeta de simulación del cálculo en vivo |
| `.country-tabs`, `.country-tab-btn` + `__flag`, `.legislation-card__head`, `__flag`, `.holiday-list`, `__row`, `__date` | Selector de país y ficha de legislación de la configuración multipaís |

Cinco cosas que conviene saber:

1. **El banner de éxito pintaba `#10b981`** —el verde de Tailwind, no el `#6bb42d` de
   Synaptica— con texto `#fff`, y animaba con `slideIn`, **un keyframe que no existe en
   ninguna hoja del proyecto**: el aviso aparecía de golpe. Ahora usa `--state-success-solid`
   con `--state-success-on-solid` encima y el keyframe `toast-slide-in` que ya trajo
   `components/Toast.tsx`.
2. **`getStatusLabel` devolvía dos colores sueltos** (`bg` y `color`) que se inyectaban como
   estilo en línea, sin contraparte oscura. Ahora devuelve `{ label, tone }` y el marcado usa
   `.state-chip--warning/-info/-success/-danger`. La etiqueta de texto no cambia: sigue
   diciendo "Pte. PM (Nivel 1)", "Aprobada total"…
3. **Cinco tarjetas fijaban `background: "#fff"`**, así que en modo oscuro se quedaban
   blancas. Al quitarlo, `body.dark .card` hace su trabajo.
4. **El botón "Volver a predeterminados" tenía el hover en JavaScript**
   (`onMouseOver`/`onMouseOut`) y el manejador de salida **devolvía un rojo distinto del
   inicial** (`rgba(239, 68, 68, 0.08)` y `#fecaca`, de Tailwind): tras pasar el ratón una
   vez, el botón se quedaba de otro color para siempre. El hover vive ahora en CSS.
5. **`.legislation-card` y `.country-tab-btn` vivían en `App.css` con siete literales y nueve
   `!important` de modo oscuro.** Reescritos con `--state-warning-*` y `--surface-subtle`, la
   contraparte oscura sale sola y los `!important` sobran. Las pestañas de país pasan a verse
   como el resto de botones `ghost` de la aplicación en modo oscuro, que es lo coherente.

Dos límites conocidos que **no** se tocaron: `body.dark h1..h6 { color: #f8fafc !important }`
gana a cualquier clase, así que en modo oscuro los títulos de tarjeta y el de la ficha de
legislación salen en blanco en vez de en su tono; y `.table-container`, la clase con la que
se envolvían dos tablas, **no está definida en ningún CSS** (se sustituyó por `.table-wrap`).

### Clases añadidas al migrar Gastos

Las cinco piezas de `features/expenses/` (`ExpensesTab`, `GastosFilters`,
`GastosSummaryTable`, `GastosDetailRow`, `GastosKPIStrip`) pasaron de **70 estilos en línea
y 7 colores literales a 0 y 0**, sin ningún valor calculado pendiente. La mayor parte salió
de clases que ya existían: `.kpi-grid`/`.kpi-card`, `.state-chip--*`, `.empty-state`,
`.chip-row`, `.inline-filter`, `.control-sm`, `.btn-sm`, `.card--roomy`, `.card-head`,
`.card-title`, `.table-wrap--spaced`, `.cell-center/-right/-num/-strong/-empty--roomy` y los
tonos `.tone-*`. Lo propio de la pantalla lleva prefijo `gastos-`:

| Clase | Para qué |
|---|---|
| `.gastos-kpi-strip`, `.gastos-kpi-delta` | La tira de KPIs (reusa `.kpi-grid`/`.kpi-card`) y su línea de variación contra el período anterior. La flecha ▲/▼ acompaña al color: la subida del gasto se lee sin distinguir rojo de verde |
| `.gastos-filters` (+ `__row`, `__row--top`, `__actions`), `.gastos-search`, `.gastos-daterange`, `.gastos-currency-select` | Las dos filas de filtros. La de abajo alinea arriba porque el selector de rango despliega un panel |
| `.inline-filter.gastos-inline-filter` | `.inline-filter` reserva 15,6rem porque nació para formularios; aquí la etiqueta va pegada a un select estrecho y esa reserva rompía la fila. Solo se anula el mínimo |
| `.gastos-btn-new` | El botón principal. Iba en degradado naranja de Tailwind con texto blanco; ahora ámbar de marca con navy encima (`--state-warning-on-solid`) |
| `.gastos-chip-row`, `.gastos-chip` (+ `.is-active`) | Chips de categoría. El activo lleva `aria-pressed` además del relleno, y el contraste se percibe en escala de grises |
| `.gastos-table`, `.gastos-col--group/-count/-total/-date/-status/-toggle` | Tabla resumen y sus anchos de columna, que cambian cuando el agrupador no es "Proyecto" |
| `.gastos-row` (+ `.is-open`), `.gastos-cell-group/-amount/-total/-soft`, `.gastos-total-row`, `.gastos-toggle` | Fila plegable, jerarquía de sus celdas, pie de total y el chevron |
| `.gastos-detail-cell`, `.gastos-detail-inner`, `.gastos-subtable` (+ `__col-actions`, `__actions`, `__total`), `.gastos-icon-btn` | Fila desplegada y su tabla anidada. La cabecera iba en ámbar de marca, que no llega a 4,5:1 para 0,68rem; pasa a `--surface-subtle` + `--text-soft`, como `.capacity-subtable` |
| `.gastos-forecast-title/-note/-row/-total/-meta/-foot` | El bloque de costos proyectados |

Cuatro cosas que conviene saber:

1. **El realce de la fila abierta va en las celdas, no en la `tr`.** `body.dark
   .project-table tr` lleva `!important`, así que un fondo puesto en la `tr` desaparece en
   oscuro. `.gastos-row.is-open > td` sí sobrevive, igual que hace `tr.row-danger > td`.
2. **Dos fallos de especificidad de modo oscuro que solo aparecieron al medir el estilo
   computado**, no a ojo: `body.dark .card span:not(.pill)` pesa (0,3,2) —tres clases y
   **dos** elementos—, así que un selector de tres clases y un elemento *pierde el
   desempate*; hubo que repetir la clase para llegar a (0,4,1). Y `body.dark th` pinta la
   cabecera de tabla en ámbar con (0,1,2), que le ganaba a `.gastos-subtable th`. La lección
   práctica: **contar clases no basta, hay que contar también los elementos**, y conviene
   auditar con `getComputedStyle` antes de dar por buena una migración.
3. **`StatusBadge` devolvía un mapa de `bg`/`color` inyectado como estilo en línea.** Ahora
   es una tabla `{ tone, text }` y el marcado usa `.state-chip--danger/-warning/-success`,
   que ya trae resueltas sus reglas para `body.dark td`. Las etiquetas no cambian.
4. **Los dos `<label>` de la fila de filtros no estaban asociados a su control** (no había
   `htmlFor`/`id`) y el select de moneda no tenía nombre accesible. Se añadieron; es
   accesibilidad, no comportamiento.

Un límite conocido que **no** se tocó: a ancho de móvil la tabla resumen se apila en una
tarjeta por fila por una regla responsive previa, y el pie "Total general" queda en un bloque
estrecho y desalineado. Ya pasaba antes de esta migración (se ve igual en
`gastos-antes-claro-movil.png`) y arreglarlo toca CSS compartido por todas las tablas.

### Clases añadidas al migrar Perfil, Usuarios, Auditoría y Tasas FX

Las cuatro pasaron de **94 estilos en línea y 10 colores literales a 0 y 0**
(`ProfileTab` 48/6, `AdminTab` 26/0, `AuditTab` 12/4, `FxTab` 8/0). No queda ningún valor
calculado pendiente: ninguna de las cuatro dibuja barras ni porcentajes.

Son sobre todo formulario y tabla, así que se migraron **juntas y buscando el patrón común
una sola vez**, en vez de resolver cada pantalla por separado. Casi todo salió de clases que
ya existían: `.page-stack`, `.section-stack`, `.card-head`, `.card`, `.table-wrap`
(+`--spaced`), `.table-pager` con `__status`/`__nav`, `.state-chip--*`, `.field-label`,
`.field-help`, `.empty-note`, `.input-readonly`, `.btn-sm`, `.inline-actions`, `.tag-list`,
`.form-grid--tight`, `.modal-card--sm`, `.modal-close`, `.modal-actions`.

**El hallazgo más rentable fue que el CSS de Perfil ya estaba escrito y sin usar.** Las
clases `.profile-page`, `.profile-mantra*`, `.profile-card`, `.profile-head`,
`.profile-avatar*`, `.profile-identity*`, `.profile-preview`, `.profile-form*`,
`.profile-section`, `.profile-actions`, `.profile-modal__*`, `.skill-chips`, `.skill-chip*`,
`.skill-empty`, `.skill-picker`, `.skill-suggestions*` e `.inline-success` entraron con el
commit `e565e54` (migración de Detalle de Proyecto) pero el `.tsx` nunca llegó a usarlas: la
pantalla seguía pintando lo mismo a mano. **Antes de escribir una clase nueva, busca también
las que ya existen sin usar.**

Lo nuevo va al final de `App.css`. Es genérico a propósito cuando lo comparten las cuatro:

| Clase | Para qué |
|---|---|
| `.field-stack` | Campo apilado: etiqueta encima de su control. Era el `style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}` repetido ocho veces entre Perfil y Usuarios. Dentro de la columna se le quita el margen inferior a `.field-label`, porque ya separa el `gap`. **Sustituye a `.profile-field`**, que era lo mismo con nombre de pantalla y queda sin usar: candidata a `BACKLOG_DEPURACION.md` |
| `.filters-grid--spaced` | La rejilla de filtros pegada a la tabla que filtra. Cada pantalla escribía su propio `marginBottom: "0.75rem"` |
| `.span-full` | `grid-column: 1 / -1`. Equivalente genérico de `.capacity-span-full`, que estaba prefijado |
| `.cell-mono` | Identificador técnico en una celda: monoespaciado y más pequeño, porque se lee carácter a carácter |
| `.modal-header--rule`, `.modal-actions--rule` | El filete que separa la cabecera y el pie de un modal de su cuerpo. `.modal-header` y `.modal-actions` ya existían; lo que se escribía a mano era la línea |
| `.modal-title` | Título de un modal. Se repite la clase (`.modal-title.modal-title`) porque los estilos de encabezado pesan más que una sola |
| `.role-badge--sm` | `.role-badge` en su tamaño de celda de tabla. Es un modificador de una clase compartida, no una clase de pantalla, y por eso no lleva prefijo |
| `.audit-diff__summary`, `.audit-diff__pre` | El volcado JSON del cambio en la bitácora. El fondo era `#f9fafb`: un parche blanco en modo oscuro, ahora `--surface-subtle` |
| `.fx-rate-field`, `.fx-rate-field__spinner` | El campo de tasa de solo lectura y su indicador de carga anclado al borde derecho |

Cuatro decisiones que conviene conocer:

1. **El avatar de Perfil y cada sugerencia de habilidad eran `div` con `onClick`**: no se
   podían alcanzar con el teclado, y el CSS ya preparado (`.profile-avatar:focus-visible`,
   `.skill-suggestions__item:focus-visible`) daba por hecho que serían botones. Ahora lo son.
   Al serlo heredan el estilo global de `button` —fondo ámbar, desplazamiento y sombra al
   pasar el ratón—, así que hay dos reglas que lo neutralizan; sin ellas el avatar da un
   salto al pasar por encima.
2. **El hover del desplegable de habilidades vivía en JavaScript**
   (`onMouseEnter`/`onMouseLeave` escribiendo `style.background`), y el `<style>` con las
   reglas del avatar estaba **incrustado dentro del JSX**. Los dos viven ahora en `App.css`.
3. **Las píldoras `.pill ok/warn/error/neutral` pasan a `.state-chip--*`**, como ya se hizo
   en Capacidad y Detalle de Proyecto. `.pill` tiene su modo oscuro a base de `!important`
   con verdes y ámbares que no son los de marca. En Auditoría, `actionColor()` —que devolvía
   el nombre de una píldora— pasa a llamarse `actionTone()` y devuelve el modificador de
   estado, por el mismo motivo por el que `colorMargen` pasó a `claseMargen`: que nadie
   vuelva a meter un color ahí.
4. **El paginador de la bitácora estaba escrito a mano** con su `#6b7280` y sus dos botones
   de 0,75rem, cuando `.table-pager` ya existía con exactamente esa forma. Los dos botones
   además no tenían nombre accesible (solo `‹` y `›`); ahora llevan `aria-label`.

Un límite conocido que **no** se tocó: `body.dark h1..h6 { color: #f8fafc !important }` gana
a cualquier clase, así que en modo oscuro el título del modal de Usuarios y el mantra de
Perfil salen en blanco en vez de en su tono. Es la misma limitación ya anotada al migrar
Horas Extra.

### Clases añadidas al migrar la Calculadora de Estimaciones

`features/estimations/EstimationCalculatorTab.tsx` pasó de **272 estilos en línea y 82
colores literales a 2 y 0**. Era el archivo más cargado del frontend (2.422 líneas). Los 2
que quedan son **valores calculados**, el único uso legítimo: el ancho de cada segmento de la
barra apilada de esfuerzo y el del tramo "Ideal" de la comparación ideal vs. real.

Lo más rentable no fue cambiar color por color sino **buscar primero el patrón repetido**:

- El `style` del control de formulario (`width:100%`, `padding:0.5rem`, `borderRadius:6px`,
  `border`, `background:"#fff"`) aparecía **30 veces** entre los parámetros globales, el
  editor de tarea y el calibrador de pesos.
- La etiqueta de campo apilada (`display:block; fontSize:0.78rem; fontWeight:700`) **26 veces**.

`.est-control` y `.field-label` (que ya existía) resolvieron **67 de los 272 estilos en una
sola sustitución**. Merece la pena mapear antes de migrar.

Mucho salió de clases que ya existían: `.subtabs`/`.subtab`/`.is-active`, `.card`,
`.card--roomy`, `.card-title`, `.page-stack`/`--padded`, `.state-chip--*`, `.field-label`,
`.empty-state`, `.empty-note`, `.notice--warning/--danger`, `.tone-*`, `.split-pane-*`. Lo
propio de la pantalla lleva prefijo `est-`:

| Clase | Para qué |
|---|---|
| `.est-hdr-btn` (+ `--guide`, `--export`), `.est-btn-primary`, `.est-btn-secondary`, `.est-banner-ok` | Acciones de la cabecera y aviso de guardado correcto |
| `.est-tone--purple/-orange/-cyan/-pink` | Hermanos de `.tone-*` para los conceptos que **no** son estados (deuda, dependencias, Brooks, switching) y solo necesitan distinguirse entre sí |
| `.est-guide` (+ `__tabs`, `__split`), `.est-concept-grid`, `.est-concept` + 7 tintes, `__head`, `__title`, `__body`, `__tip` | La guía educativa y sus ocho tarjetas de concepto |
| `.est-brooks` (+ `__head`, `__title`, `__sub`, `__canvas`, `__empty`, `__svg`, `__note`), `.est-link`, `.est-node--*`, `.est-node-ring`, `.est-node-label--*`, `.est-legend` (+ `__item`, `__dot--*`) | La red de canales de Brooks. **El color del SVG se pone con clase, no con `fill`**, que no resuelve tokens ni tiene modo oscuro |
| `.est-example` (+ `__scenario`, `__title`, `__rows`, `__row`, `__key`, `__val`), `.est-steps` (+ `__title`), `.est-step` (+ `--base`, `__label`, `__value`), `.est-step-total`, `.est-step-note` | El ejemplo resuelto paso a paso |
| `.est-factor-scroll`, `.est-factor-note`, `.est-factor-table` (+ `__cat`, `__cat--empty`, `__level`, `__factor`, `__when`) | La tabla de factores |
| `.est-columns`, `.est-column`, `.est-config-card`, `.est-split` (+ `__master`, `__detail`) | La estructura de dos columnas y el espacio maestro-detalle |
| `.est-control` (+ `--sm`, `--area`), `.est-check` (+ `--tight`, `__label`), `.est-check-row` | Controles de formulario y casillas |
| `.est-subcard` (+ `__head`, `__title`), `.est-team` (+ `__head`), `.est-cal` (+ `__options`) | Las dos subtarjetas de los parámetros globales (equipo y calendario) |
| `.est-workspace` (+ `__head`, `__title`), `.est-master__head`, `.est-master__list`, `.est-task` (+ `.is-active`, `__text`, `__idx`, `__name`, `__right`, `__hours`, `__remove`), `.est-detail__head/__title/__factor/__form` | La lista de tareas y el formulario de detalle |
| `.est-breakdown` (+ `__head`, `__rows`, `__row`, `__label`, `__value`, `__pct`, `__total`), `.est-bar` + `.est-bar__seg--base/-complexity/-team/-debt/-deps/-switching/-scope/-ceremonies`, `.est-risk--*` | El desglose de esfuerzo y su barra apilada de ocho segmentos |
| `.est-summary-card`, `.est-summary-rows/-label/-value` (+ `--accent`, `--lg`), `.summary-row--last`, `.est-reco`, `.est-notice--spaced`, `.est-compare` (+ `__title`, `__bar`, `__seg--ideal/--real`, `__note`) | El consolidado del proyecto |
| `.est-saved-list`, `.est-saved-item` (+ `__main`, `__name`, `__meta`, `__delete`) | Las estimaciones guardadas |
| `.est-weights` (+ `__lead`, `__actions`), `.est-weight-section__head/__title`, `.est-weight-toggle`, `.est-weight-grid` (+ `--narrow`, `.is-off`), `.est-weight-field.is-off` | El calibrador de pesos |

Seis cosas que conviene saber:

1. **No hizo falta crear ningún token nuevo.** Los 82 literales se mapearon por **significado**:
   verde (`#22c55e` `#4ade80` `#15803d`) → `--state-success-*`; ámbar (`#eab308` `#fbbf24`
   `#d97706` `#b45309` `#f1a323`) → `--state-warning-*` o `--color-accent`; rojo (`#ef4444`
   `#b91c1c` `#7f1d1d`) → `--state-danger-*`; azul (`#1d4ed8` `#60a5fa` `#234175`) →
   `--state-info-*`; y morado, naranja, cian y rosa → los tintes categóricos `--tint-*`, que
   ya tenían contraparte oscura definida en `App.css`. La barra apilada tiene ocho segmentos
   y la serie `--chart-1..7` solo siete, pero **no se añadió un `--chart-8`**: cada segmento
   usa el mismo color que su fila nombrada justo debajo, que es más informativo que una serie
   categórica arbitraria.
2. **Los 18 `#fff`, uno por uno.** 15 eran `background` de un `input`/`select`/`textarea`:
   quitarlos basta, porque `body.dark input` ya pinta el campo. Los otros 3 eran texto sobre
   relleno sólido y **no todos eran blanco**: sobre el ámbar de marca pasan a navy
   (`--state-warning-on-solid`, §5.3) y solo el del tramo "Ideal", que va sobre el azul, se
   queda en blanco vía `--state-info-on-solid`.
3. **`button.ghost` pesa (0,1,1) y le gana a un modificador de una sola clase.** Los botones
   "Guía Educativa" y "Exportar CSV" salían los dos del azul de `.ghost` en vez de su color;
   se repite la clase (`.est-hdr-btn--export.est-hdr-btn--export`) para llegar a (0,2,0).
   **Esto solo apareció al auditar el estilo computado**, no en las capturas.
4. **El hover del botón de eliminar tarea vivía en JavaScript** (`onMouseEnter`/`onMouseLeave`
   escribiendo `style.background` con un rojo de Tailwind), el mismo patrón ya encontrado en
   Horas Extra y Perfil. Ahora vive en CSS.
5. **La tarjeta de tarea era un `div` con `onClick`**: no se podía alcanzar con el teclado.
   Ahora lleva `role="button"`, `tabIndex`, `aria-pressed` y manejador de Enter/Espacio. Lo
   mismo con la estimación guardada, que pasa a ser un `<button>`. Los dos botones de borrar
   tenían solo un glifo (`✕`, `🗑`) y ahora llevan `aria-label`.
6. **La pantalla no colapsaba en móvil.** La rejilla `2.1fr 0.9fr` y el `split-pane` con
   anchos `35%`/`65%` en línea seguían siendo dos columnas a 400px. Ahora `.est-columns`
   colapsa por debajo de 1100px y `.est-split` por debajo de 900px.

Dos límites conocidos que **no** se tocaron: `body.dark h1..h6 { color: #f8fafc !important }`
sigue ganando, así que en oscuro los títulos de sección del calibrador y el del escenario de
ejemplo salen en blanco en vez de en su tono (la misma limitación ya anotada en Horas Extra,
Perfil y Usuarios); y `.summary-row`, que es CSS previo compartido, conserva sus literales
`#ffd8a8` y `rgba(255, 156, 44, 0.05)` — reescribirla es tocar CSS que no es de esta pantalla.

### Clases añadidas al cerrar la cola de pantallas medianas

Doce archivos —cinco componentes compartidos y siete pantallas— pasaron de **162 estilos en
línea y 30 colores literales a 12 y 0**. Los 12 restantes son todos valores calculados o ya
documentados como tales:

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

Los 12 que quedan, uno por uno: el ancho calculado del relleno del medidor en Proyecciones y
en Proyectos (2), los tres `flexGrow` de la barra de salud y los tres `maxWidth` de los SVG
de ancho fluido del Tablero (6, ya documentados en la pasada anterior), los dos `flexGrow` de
la barra apilada de Portafolio (2, mas una mención en su comentario de cabecera que el `grep`
cuenta) y el tamaño de fuente del globo de respaldo de `CountryFlag`, que sale de su prop
`size` (1).

**Se empezo por los componentes compartidos**, que viven dentro de las pantallas grandes, y
eso resolvio de paso parte de lo demás. La mayor parte salió de vocabulario ya existente:

- **`.field-label` absorbió 18 etiquetas** escritas a mano (15 en Consultores, 3 en
  Proyectos). Todas iban en `--color-accent` o `--color-sec-blue` a 0,75rem; el ámbar sobre
  blanco se queda en 1,9:1 y no vale para ese tamaño (sección 5.5). Es la misma sustitución
  que ya se hizo en Capacidad.
- **`.meter`/`.meter__track`/`.meter__fill--*`/`.meter__value` absorbió las dos barras de
  progreso** que Proyecciones y Proyectos se habían inventado por separado.
- **`.cell-right` y `.cell-strong` resolvieron los 19 estilos de Informes** de una vez: eran
  todos `textAlign: "right"` y `fontWeight: 700` de celdas de tabla.
- También `.section-stack`, `.field-stack`, `.field-help`, `.field-error`, `.state-chip--*`,
  `.status-badge--*`, `.select-control`, `.control-sm`, `.btn-sm`, `.btn-compact`,
  `.btn-danger`, `.modal-card--sm`, `.modal-title`, `.modal-actions--spaced`,
  `.filters-grid--spaced`, `.empty-state__*`, `.empty-note--center`, `.cell-small`,
  `.cell-dash`, `.cell-empty--roomy`, `.inline-actions`, `.span-full` y `.tone-danger`.

Lo nuevo lleva prefijo de pantalla, salvo las piezas genuinamente compartidas:

| Clase | Para qué |
|---|---|
| `.no-select`, `.control-block`, `.span-2`, `.cell-nowrap` | Utilidades que faltaban: texto de casilla no seleccionable, control a ancho completo (hermano de `.btn-block`), `grid-column: span 2` (hermano de `.span-full`) y celda que no se parte en dos líneas |
| `.meter__fill--info` | Faltaba el modificador de información del medidor |
| `.field-help--warning` | Variante de aviso de `.field-help`, para el texto de presupuesto ajustado |
| `.empty-state__action` | La ranura de acción de `.empty-state`, que no existía |
| `.country-flag`, `__img`, `__fallback`, `__name` | La bandera de país. El radio es de 2px a propósito: mide 20x15px y `--radius-sm` (6px) le comería las esquinas |
| `.month-year-picker__row`, `__month` | La fila de los dos selectores del selector de mes y año |
| `.modal-title--danger`, `.confirm-dialog__body` | Título en rojo y cuerpo del diálogo de confirmación |
| `.searchable-select-container/-trigger/-value/-freetext/-caret/-dropdown/-search(__input)/-list/-option/-empty/-mark` | El selector con búsqueda, entero. Solo tenía CSS para `:hover`; todo lo demás se pintaba a maño |
| `.cons-filters`, `.cons-filter-select`, `.cons-btn-tall`, `.cons-check-aligned`, `.cons-edit-row-3`, `.cons-btn-assign` | Consultores: rejilla de filtros, su select estrecho, alturas y proporciones de fila, y el botón «Asignar» |
| `.fore-presets`, `.fore-form`, `.fore-row` (+ `--lg/--md/--sm`), `.fore-submit-row` (+ `__msg`), `.fore-range-error`, `.fore-cell-date`, `.fore-help-block` | Proyecciones: atajos de fecha, formulario, sus tres rejillas y el pie de envío |
| `.proy-bar`, `.proy-bar-cell`, `.proy-bar-pct`, `.proy-filters`, `.proy-note`, `.proy-check-label/-input/-box/-row/-text` | Proyectos: barra de presupuesto en una celda, filtros y las dos casillas de horas extra |
| `.fin-panel-toggle` | Financiero: la fila de los dos botónes de panel |
| `.section-header-title--tight` | Informes: el título de sección pegado a su tabla |

Seis cosas que conviene saber:

1. **`RagBadge` de Proyectos pintaba el semáforo con `result.color` de fondo y `#fff`
   encima**, que es exactamente el error de la sección 5.3: sobre el verde y el ámbar de
   marca el blanco se queda en 2,6:1. Pasa a `PRESENTACION_SALUD` + `.status-badge--*`, el
   camino que ya usaban Portafolio y Tablero. `backendHealthToResult` deja de usarse allí.
2. **La barra de ejecución de Proyecciones tenía su propio semáforo** (`#dc2626`, `#f59e0b`,
   `#2563eb` sobre pista `#e5e7eb`): un cuarto juego de colores, de Tailwind, sin modo
   oscuro. Pasa a `.meter`, que ya existía. Lo mismo la barra de presupuesto de Proyectos.
3. **El formulario de Proyecciones fijaba `background: "#ffffff"`**, así que en modo oscuro
   se quedaba blanco. Es el mismo fallo encontrado cinco veces al migrar Horas Extra.
4. **`SearchableSelect` marcaba el foco con `#ea580c`** —el naranja de Tailwind, no el ámbar
   de Synaptica— con halo `rgba(234,88,12,.15)`, sombra `rgba(154,79,15,.15)` y el resaltado
   de coincidencia en `#fde047`. Lo usan cinco pantallas, así que arreglarlo las mejora todas
   a la vez. De paso, el campo de búsqueda del desplegable no tenía nombre accesible.
5. **`ReportsTab` se revisó y su `features/reports/reports.css` está bien como está**:
   tokenizado, con una paleta validada contra deuteranopia y su propio modo oscuro. **No se
   tocó.** Sus 19 estilos en línea no eran valores calculados —las barras las dibuja
   `HoursBarChart`, que ya es SVG con clases— sino alíneacion de tabla, y salieron con
   clases existentes.
6. **`components/EmptyState.tsx` no lo importa nadie.** Se migró igualmente (queda en 0/0),
   pero es código muerto: candidato a `BACKLOG_DEPURACION.md`. `features/expenses/` define su
   propio `EmptyState` local, que es el que de verdad se usa.

**Cuatro fallos de modo oscuro que solo aparecieron al auditar `getComputedStyle`**, no en
las capturas, todos corregidos al final de `App.css`:

1. **`.status-badge--*` perdía su color de texto dentro de una tarjeta en oscuro.**
   `body.dark .card span:not(.pill)` pesa (0,3,2) y le gana a un modificador de dos clases,
   así que la insignia salía en gris claro (`#e2e8f0`) sobre el verde de marca: **2,4:1**.
   Afecta también a Portafolio y Tablero, que comparten la clase. Resuelto repitiendo la
   clase hasta (0,4,1), y con su gemela para `body.dark td`.
2. **El botón «Asignar» perdía su relleno verde**: `body.dark button.ghost` pesa (0,2,2) y le
   gana a `.cons-btn-assign.cons-btn-assign` (0,2,0). Es la trampa ya conocida de `.ghost`,
   ahora con el agravante de que en oscuro gana por número de *elementos*.
3. **`.meter__value` y `.cell-empty` se aplanaban al blanco de la tarjeta**, perdiendo su
   jerarquía de texto secundario.
4. El propio arreglo de (3) tapaba a `.meter__value--danger`: **una regla nueva puede ganarle
   a otra regla nueva**. Por eso las tres correcciones finales van al final del bloque, en su
   propia sección comentada.

**Tres límites conocidos que NO se tocaron**, por ser CSS compartido por toda la aplicación:

- `body.dark h1..h6 { color: #f8fafc !important }` sigue ganando, así que en oscuro el título
  en rojo del diálogo de confirmación sale en blanco. Misma limitación ya anotada en Horas
  Extra, Perfil y Estimaciones.
- `body.dark th` pinta la cabecera de tabla en ámbar con (0,1,2), que le gana a `.cell-right`
  puesta en un `th`. Solo afecta al color, no a la alíneacion, que es lo que se buscaba.
- **El botón primario de la aplicación es ámbar con texto blanco** (2,6:1). Se ve en el
  alternador de panel de Financiero, pero es el estilo global de `button` y cambiarlo toca
  las 16 pantallas: no es una decisión de esta pasada. Queda anotado.

### Clases añadidas al avisar de la conversión de moneda incompleta

Cinco endpoints agregados publican `conversion: { incomplete, missingPairs }`. Cuando falta
la tasa de un par, el importe se suma **sin convertir** y el total queda aproximado aunque
venga rotulado con la moneda base. El aviso es de **advertencia, no de error**: la cifra
sigue siendo útil, así que va en línea y no bloquea nada.

Casi todo sale de clases que ya existían (`.notice`, `.notice--warning`, `.notice__title`,
`.notice__text`, `.state-chip--warning`, `.chip-button`). Lo nuevo es mínimo:

| Clase | Para qué |
|---|---|
| `.conversion-notice__foot` | Separa del cuerpo el pie del aviso, donde va el atajo a Tasas FX |
| `.chip-button--warning` | Variante ámbar de `.chip-button`. La base está cableada a los tonos de peligro **y pinta el fondo con `--card-bg`**, lo que en oscuro deja texto ámbar sobre tarjeta oscura; la variante fija su propio fondo con `--state-warning-bg` para no depender del tema |
| `.conversion-chip` | Solo separación: la marca `▲ Aprox.` junto al nombre del proyecto en la tabla |

Tres decisiones que conviene conocer:

1. **Dos niveles, no uno.** `.conversion-notice` dice que el consolidado de la pantalla es
   aproximado; `.conversion-chip` marca la fila del proyecto concreto que lo causa, con
   `data.projects[].conversion`. Sin el segundo, el aviso de arriba no tiene a dónde señalar.
   La regla de reparto es **un solo aviso completo por pantalla**: en Detalle de Proyecto la
   Curva S lleva la marca compacta junto a su título, no un segundo aviso, porque el de la
   cabecera ya dice qué falta y dónde se carga.
2. **El texto traduce el dato técnico.** Los pares llegan como `"COP->USD"` y en pantalla se
   leen "de COP a USD" (`utils/conversionStatus.ts`, con pruebas). A partir de cinco pares se
   resume con "y N más" para que el aviso no crezca sin control.
3. **El color no viaja solo**: icono `▲` más el título "Cifras aproximadas" y la palabra
   "Aprox." en el chip. El aviso es `role="status"`, no `role="alert"`: informa sin
   interrumpir la lectura.

Contraste medido sobre **estilo computado** (no sobre la captura), componiendo las capas
translúcidas, en Tablero y Portafolio y en los dos temas: ocho medidas, de 5,72:1 a 7,49:1,
todas por encima de 4,5:1. El chip dentro de la tabla del Tablero queda en 6,36:1 en oscuro
gracias a la regla `body.dark td .state-chip--warning` que ya existía.

### Especificidad: la trampa de `body.dark .card`

Al migrar el Tablero salieron dos reglas heredadas que le ganan a cualquier clase de patrón:

- `body.dark .card` pesa **(0,2,1)** —tres selectores, uno de ellos el elemento `body`—, así
  que un `.card.stat-tile--danger` (0,2,0) **pierde** y el tinte de estado desaparecía en
  modo oscuro. Por eso esas reglas se escriben con las tres clases:
  `.card.stat-tile.stat-tile--danger`.
- `body.dark .card p`, `body.dark .card span:not(.pill)` y `body.dark .card div` fuerzan
  `color: inherit` con hasta **(0,3,2)**. Eso aplana toda la jerarquía de texto dentro de una
  tarjeta en oscuro: el texto atenuado, el subtítulo de un KPI y la cifra de estado salen del
  mismo blanco. No se tocaron porque las usan las dieciséis pantallas; en su lugar, al final
  de `App.css` hay un bloque que devuelve su color a los patrones nuevos, a veces repitiendo
  la clase (`.kpi-sub.kpi-sub`) para subir el peso **sin recurrir a `!important`**.

Si añades un patrón que se use dentro de `.card`, compruébalo en modo oscuro antes de darlo
por bueno: es el sitio donde más fácil se pierde el color.

### El semáforo, en concreto

`utils/projectHealth.ts` expone `PRESENTACION_SALUD`, que traduce el `healthStatus` del
backend a **etiqueta + icono + modificador de clase**:

| Estado | Etiqueta | Icono | Clase |
|---|---|---|---|
| `GREEN` | Saludable | ● | `status-badge--success` |
| `YELLOW` | Advertencia | ▲ | `status-badge--warning` |
| `RED` | Crítico | ■ | `status-badge--danger` |

Las etiquetas describen el **estado, no el color** ("Crítico", no "Rojo") y son las mismas
palabras que usa el filtro de Salud. Los iconos tienen forma distinta, no solo color distinto.

`claseMargen(margenPct, umbral)` devuelve la clase `tone-*` del margen bruto contrastada
contra el umbral real del proyecto. Antes se llamaba `colorMargen` y devolvía literales de
Tailwind; el cambio de nombre es deliberado para que nadie vuelva a meter un color ahí.

---

## 7. Estado de la migración

Medido con `grep -o 'style={{'` y `grep -oiE '#[0-9a-f]{3,8}'` sobre `frontend/src/**/*.tsx`.

| | Antes (rama `dev`) | Tras Portafolio | Tras Encabezado/Alertas/Tablero | Tras Toast…Capacidad | Tras Gastos/Perfil/Estimaciones | Ahora (tras la cola de medianas) |
|---|---|---|---|---|---|---|
| Colores literales en `.tsx` | 575 | 533 | 428 | 229 | 130 | **100** |
| Estilos en línea en `.tsx` | 1576 | 1528 | 1372 | 903 | 490 | **340** |

### Lo migrado en esta pasada

| Archivo | Estilos en línea | Colores literales |
|---|---|---|
| `components/PageHeader.tsx` | 5 → **0** | 2 → **0** |
| `features/alerts/AlertsTab.tsx` | 37 → **0** | 30 → **0** |
| `features/dashboard/DashboardTab.tsx` | 120 → **6** | 73 → **0** |

Los 6 estilos que quedan en `DashboardTab` son **valores calculados**, que es el único uso
legítimo: el `maxWidth` de cada uno de los tres SVG de ancho fluido y el `flexGrow` de los
tres segmentos de la barra de salud.

`PageHeader` es el de mayor rendimiento por línea: lo usan las 16 pantallas, así que
arreglarlo las mejora todas a la vez. De paso se fue su respaldo marrón `#5f2f00`, que no es
de la paleta de Synaptica.

### Pendiente de migrar, por orden de rentabilidad

| Archivo | Estilos en línea | Colores literales |
|---|---|---|
| `features/activities/ActivitiesTab.tsx` | 223 | 58 |
| `App.tsx` (landing y layout) | 93 | 42 |

**No queda nada más.** De los 340 estilos en línea globales, 316 están en esos dos archivos y
los 24 restantes son valores calculados repartidos por pantallas ya migradas.
`ActivitiesTab` espera una decisión de producto sobre si el módulo se retira; `App.tsx` se
hará aparte porque es landing y layout y se ve en las 16 pantallas.

**Ya migrados desde esta tabla**: `components/AlertsPanel.tsx`, `components/Toast.tsx`,
`components/ValidationErrorBox.tsx`, `components/DateRangePicker.tsx`, `components/RagChat.tsx`,
`features/extraHours/ExtraHoursTab.tsx`, `features/capacity/CapacityTab.tsx` y el grupo
`features/profile/ProfileTab.tsx` + `features/admin/AdminTab.tsx` +
`features/audit/AuditTab.tsx` + `features/fx/FxTab.tsx` — todos en 0/0
salvo `CapacityTab` (1 estilo en línea, el valor calculado del medidor). Detalle de cada uno
en "Clases añadidas al migrar..." más arriba y en `documentacion/PENDIENTES.md` §3.

`EstimationCalculatorTab` (272 / 82), `ProjectDetailTab` y `AlertBadge` ya están migrados y
salen de esta tabla. **La siguiente candidata es `ActivitiesTab`**, que es ahora la de mayor
rentabilidad con diferencia; después `App.tsx`, que es landing y layout y por tanto se ve en
todas las pantallas.

### Cosas que esta pasada NO tocó, a propósito

- **Comportamiento.** Ni filtros, ni orden, ni paginación, ni exportaciones, ni la lógica
  financiera del Tablero (el estado de error de `statsError` y la sincronización con
  `initialStats` se dejaron intactas).
- **`AlertBadge.tsx`**, aunque lo pinta el Tablero. Su prueba
  (`src/test/AlertBadge.test.tsx`) **afirma los literales**: comprueba
  `rgb(254, 226, 226)` y `rgb(153, 27, 27)` leyendo `span.style`. Migrarlo a `.status-badge`
  rompe cinco de las 135 pruebas, y reescribir una prueba para que deje de comprobar lo que
  comprueba no es una decisión de diseño. **Hay que decidirlo**: lo razonable es migrar el
  componente y cambiar esas cinco pruebas para que afirmen la *clase* (`status-badge--danger`)
  en vez del color, que es lo que el sistema de diseño garantiza.
- **`headStyles: { fillColor: [234, 88, 12] }`** en la exportación a PDF del Tablero: es un
  naranja que no es el de marca, pero vive en el PDF generado, no en la interfaz, y cambiarlo
  altera un entregable que alguien puede estar comparando. Queda anotado.
- **Las familias `--state-*-bg/border/text` originales**, por lo dicho en la pasada anterior.

### Defectos encontrados y no corregidos (no son de diseño)

1. **La pestaña de Alertas es inalcanzable.** `AlertsTab` se renderiza con
   `activeTab === "alerts"` y tiene ruta `/alerts`, pero `alerts` no está en ningún grupo de
   la barra lateral ni en `NON_SIDEBAR_TABS`, así que el efecto que valida la pestaña contra
   los permisos la devuelve siempre a `dashboard`. El botón 🔔 Alertas de la cabecera abre el
   **cajón** (`components/AlertsPanel.tsx`), no la pestaña. Para poder capturarla hubo que
   añadir `alerts` a `NON_SIDEBAR_TABS` **solo durante la captura**; el cambio está revertido.
2. **`body.dark div[style*="background: #fff"]…`**: un bloque de `App.css` que intentaba dar
   modo oscuro a la pestaña de Alertas desde el atributo `style`. **Nunca llegó a aplicarse**:
   el navegador normaliza `#fff` a `rgb(255, 255, 255)` en el atributo, así que el selector no
   casaba. Se eliminó al migrar la pantalla. Las reglas equivalentes del cajón
   (`.alert-card.sev-*`) sí siguen en uso y se conservan.

### Defectos visuales encontrados y sí corregidos

Los dos estaban en CSS compartido y rompían el Tablero a 400px; se arreglaron porque son
presentación pura:

1. `responsive.css` le pone `min-width: 600px` a **toda** `table` en móvil para que se pueda
   desplazar en horizontal, pero `.project-table` deja de ser una tabla en móvil (se convierte
   en una pila de tarjetas). Ese mínimo empujaba el valor de cada celda fuera de la pantalla y
   solo quedaban visibles las etiquetas. Ahora el modo tarjeta fija `min-width: 0`.
2. En ese mismo modo tarjeta, las celdas fijas pasaban a `position: static`, con lo que el
   `::before` que dibuja la etiqueta perdía su contexto de posicionamiento y las tres primeras
   (Salud, Empresa, Proyecto) aparecían amontonadas al pie de la tarjeta. Ahora es
   `position: relative`.

### Decisiones que requieren criterio de negocio (no las inventé)

Siguen abiertas las tres de la pasada anterior (etiquetas del semáforo ya unificadas, umbrales
de CPI/SPI y significado de "Alertas activas"), más:

4. **El vocabulario de severidad de las alertas.** La bandeja usa Crítico / Advertencia /
   Info, y el filtro de la misma pantalla ofrece "Informativo". Se respetó tal cual para no
   cambiar textos, pero conviene elegir uno.

## 8. Capturas

En `documentacion/capturas/`, generadas con Playwright sobre el entorno local:

- `portafolio-antes-*` / `portafolio-despues-*`: claro y oscuro, escritorio (1440px) y móvil (400px).
- `portafolio-despues-estados-*`: los tres estados del semáforo. Los datos demo solo traen
  proyectos en verde, así que para estas capturas se interceptó la respuesta de
  `/api/stats/portfolio` y se forzaron un `YELLOW` y un `RED`. **Solo afecta a la captura**,
  no hay ningún cambio en la app ni en los datos.
- `conversion-*` (`-antes-` / `-despues-`): el aviso de conversión de moneda incompleta, en
  Tablero, Portafolio y Detalle de Proyecto (más `conversion-detalle-curva-*`, que enseña la
  marca compacta junto al título de la Curva S), claro y oscuro, a 1440px, y el Tablero también a 400px. Para
  provocar el estado se creó un gasto en **XTS** —código ISO reservado para pruebas, sin tasa
  cargada— sobre un proyecto demo, y se borró después. El "antes" se capturó desde una copia
  limpia del `HEAD` servida en el puerto 5174, con los **mismos datos**: la diferencia entre
  las dos capturas es solo el aviso.
- `encabezado-antes-*` / `encabezado-despues-*`: el `PageHeader` en contexto (Portafolio),
  claro y oscuro, a 400px.
- `jornada-*`: la jornada laboral configurable (decisión D-5). `jornada-config-*` es la
  pantalla nueva, claro y oscuro, a 1440px y a 400px; `jornada-config-guardado-*` es la misma
  justo después de guardar un país desde la interfaz; `jornada-capacidad-*` y
  `jornada-informe-*` son las dos pantallas que consumen la jornada. Para que el informe
  enseñara el efecto —8,5 h de un colombiano ya **no** son media hora en rojo— se creó una
  entrada de horas de 8,5 h sobre un proyecto demo y **se borró después**; la configuración
  quedó como estaba (Colombia 8,5 h, Ecuador 8 h, `Default` 8 h).
- `alertas-antes-*` / `alertas-despues-*`: el Centro de Alertas, claro y oscuro, a 400px.
- `tablero-antes-*` / `tablero-despues-*`: el Tablero de Control, claro y oscuro, a 400px.
- `estimaciones-*` (`-antes-` / `-despues-`): la Calculadora de Estimaciones, claro y oscuro.
  Cinco estados, porque la pantalla tiene dos pestañas mayores y la guía tiene tres solapas:
  `estimaciones-*` (el estimador), `estimaciones-guia-*` (conceptos), `estimaciones-ejemplo-*`
  (el cálculo paso a paso), `estimaciones-factores-*` (la tabla de factores) y
  `estimaciones-pesos-*` (el calibrador). A 1440px los cinco; a 400px el estimador y el
  calibrador, que son los dos que cambiaron de estructura al colapsar a una columna.
- `perfil-*`, `admin-*`, `auditoria-*`, `fx-*` (`-antes-` / `-despues-`): las cuatro
  pantallas de formulario y tabla, claro y oscuro, a 1440px y 400px. Más dos estados que la
  navegación simple no muestra: `admin-modal-despues-*` (el modal de edición de usuario, con
  su filete de cabecera y pie) y `auditoria-tabla-despues-*` (la bitácora con datos reales y
  un diff desplegado). Las de `-antes-` se tomaron levantando un segundo servidor de Vite
  sobre un `git worktree` en `HEAD`, en otro puerto, porque el servidor de desarrollo
  compartido estaba en ese momento a medio recompilar por otra migración en paralelo.

- `consultores-*`, `proyectos-*`, `informes-*`, `financiero-*` y `proyecciones-despues-*`
  (`-antes-` / `-despues-`): la cola de pantallas medianas, claro y oscuro, a 1440 y 400px.
  Más dos estados que la navegación simple no muestra porque el formulario de alta arranca
  plegado: `proyecciones-form-*` y `consultores-form-*`, que es donde vive el grueso de lo
  migrado (las etiquetas de campo, la rejilla del formulario y el pie de envío).
  Las `proyecciones-antes-*` son las de una pasada anterior y **no se regeneraron**, para no
  pisar capturas ya commiteadas; por eso su barra lateral es la de aquel momento.
  Las demás `-antes-` se tomaron levantando un segundo servidor de Vite sobre un
  `git worktree` en `HEAD`. **Tiene que correr en el puerto 4173**: el backend solo devuelve
  cabecera CORS a `5173` y `4173`, así que en cualquier otro puerto la app se queda en la
  portada con «No se pudo contactar con el servidor» y las capturas salen de la portada, no
  de la pantalla. Pasó en el primer intento.

Dos avisos sobre estas tres últimas, por honestidad:

- Los datos demo **no traen ninguna alerta**, así que para que las tarjetas de severidad
  salieran en la captura se interceptó `/api/alerts` en el navegador con seis alertas de
  ejemplo. Solo afecta a la captura.
- La pestaña de Alertas no se puede alcanzar navegando (ver §7, defecto 1), así que para
  capturarla se añadió `alerts` a `NON_SIDEBAR_TABS` durante la sesión de captura y se
  revirtió después. En el código entregado `NON_SIDEBAR_TABS` sigue siendo `["profile"]`.

## Iconos de estado: cuándo sí y cuándo no

La regla es que **el color nunca sea el único portador de información**. Lo que satisface esa
regla es la **etiqueta de texto**, no necesariamente un icono.

- **Insignia con etiqueta** (`.status-badge`): **sin icono**. "Saludable" ya dice el estado;
  añadir un `●` dentro de una píldora rellena no aporta nada y se lee como una viñeta de
  lista. Se probó con icono y se quitó por eso.
- **Junto a un título** (el panel de proyectos críticos): **sí**, ahí el icono funciona como
  marcador visual del encabezado.
- **Leyenda de un gráfico**: **punto de color**, que es la convención para mapear color a
  serie. No un glifo de texto.
- **Contexto compacto sin espacio para texto**: ahí el icono es la única opción, y entonces
  debe tener **forma distinta** entre estados (● ▲ ■), no solo color distinto.
