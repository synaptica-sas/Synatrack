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
| `.inline-list` | Lista de nombres separados en línea dentro de un aviso |
| `.kpi-sub`, `.kpi-sub--danger`, `.kpi-hint`, `.kpi-loading`, `.table-search`, `.card-title-tight`, `.field-grid--compact`, `.col-health/.col-company/.col-project`, `.cell-empty--roomy`, `.table-foot--tight`, `.chart-block`, `.fx-note--spaced` | Detalles sueltos que antes eran estilos en línea repetidos |

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

| | Antes (rama `dev`) | Tras Portafolio | Tras Encabezado/Alertas/Tablero | Ahora (tras Toast, ValidationErrorBox, AlertsPanel, DateRangePicker, RagChat, Horas Extra, Capacidad) |
|---|---|---|---|---|
| Colores literales en `.tsx` | 575 | 533 | 428 | **229** |
| Estilos en línea en `.tsx` | 1576 | 1528 | 1372 | **903** |

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
| `features/estimations/EstimationCalculatorTab.tsx` | 272 | 82 |
| `features/activities/ActivitiesTab.tsx` | 223 | 58 |
| `features/projects/ProjectDetailTab.tsx` | 95 | 65 |
| `features/profile/ProfileTab.tsx` | 48 | 6 |
| `features/dashboard/AlertBadge.tsx` | 1 | 6 |
| `App.tsx` (landing y layout) | — | ~100 |

**Ya migrados desde esta tabla**: `components/AlertsPanel.tsx`, `components/Toast.tsx`,
`components/ValidationErrorBox.tsx`, `components/DateRangePicker.tsx`, `components/RagChat.tsx`,
`features/extraHours/ExtraHoursTab.tsx` y `features/capacity/CapacityTab.tsx` — todos en 0/0
salvo `CapacityTab` (1 estilo en línea, el valor calculado del medidor). Detalle de cada uno
en "Clases añadidas al migrar..." más arriba y en `documentacion/PENDIENTES.md` §3.

`ProjectDetailTab` es la siguiente candidata natural: reutiliza tabla, KPIs y semáforo, que
es justo lo que ya está resuelto. `EstimationCalculatorTab` sigue siendo la más grande y
conviene dejarla para el final.

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
- `encabezado-antes-*` / `encabezado-despues-*`: el `PageHeader` en contexto (Portafolio),
  claro y oscuro, a 400px.
- `alertas-antes-*` / `alertas-despues-*`: el Centro de Alertas, claro y oscuro, a 400px.
- `tablero-antes-*` / `tablero-despues-*`: el Tablero de Control, claro y oscuro, a 400px.

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
