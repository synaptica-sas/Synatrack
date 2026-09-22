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

### 5.4 Contraste comprobado

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

Medido con `grep -o 'style={{'` y `grep -oiE '#[0-9a-f]{3,8}\b'` sobre `frontend/src/**/*.tsx`.

| | Antes (rama `dev`) | Ahora |
|---|---|---|
| Colores literales en `.tsx` | 575 | 536 |
| Estilos en línea en `.tsx` | 1576 | 1528 |

Todo el avance es de **una sola pantalla**, `PortfolioTab.tsx`: de 51 estilos en línea a 3
(y uno de esos 3 es un ejemplo dentro de un comentario, así que quedan 2 reales, ambos
valores calculados: el ancho del medidor y el `flexGrow` de un segmento), y de 39 colores
literales a 0.

### Pendiente de migrar, por orden de rentabilidad

| Archivo | Estilos en línea | Colores literales |
|---|---|---|
| `features/estimations/EstimationCalculatorTab.tsx` | 272 | 82 |
| `features/activities/ActivitiesTab.tsx` | 223 | 58 |
| `features/extraHours/ExtraHoursTab.tsx` | 186 | 35 |
| `features/capacity/CapacityTab.tsx` | 123 | 28 |
| `features/dashboard/DashboardTab.tsx` | 120 | 76 |
| `features/projects/ProjectDetailTab.tsx` | 95 | 65 |
| `features/profile/ProfileTab.tsx` | 48 | 6 |
| `features/alerts/AlertsTab.tsx` | 37 | 30 |
| `App.tsx` (landing y layout) | — | ~100 |

Recomendación: empezar por **`AlertsTab`** (pequeña, muy densa en color, mismo vocabulario de
estados que Portafolio) y luego por **`DashboardTab`**, que es la que más colores literales
tiene por línea. `EstimationCalculatorTab` es la más grande y conviene dejarla para cuando el
catálogo de patrones esté probado en tres o cuatro pantallas más.

También queda por migrar `components/PageHeader.tsx`, que sigue maquetado con estilos en
línea y con un color de respaldo (`#5f2f00`) que no es de la marca; migrarlo beneficia a las
16 pantallas de golpe.

### Cosas que este cambio NO tocó, a propósito

- **Comportamiento.** El filtrado, el ordenamiento y la exportación CSV de Portafolio son los
  mismos; solo cambió la presentación.
- **Las familias `--state-*-bg/border/text` originales.** Siguen con los valores de Tailwind
  que ya tenían porque las usan muchas pantallas; sustituirlas es un cambio de un solo
  commit pero hay que revisarlo pantalla por pantalla. Los tokens nuevos (`-strong`,
  `-solid`, `-on-solid`) conviven con ellas sin romperlas.
- **Los tres cálculos de rentabilidad divergentes** y demás deuda funcional: están en
  `PENDIENTES.md` y en `DOCUMENTACION_TECNICA.md` §10.

### Decisiones que requieren criterio de negocio (no las inventé)

1. **Las etiquetas del semáforo.** Puse "Saludable / Advertencia / Crítico" porque son las
   que ya usaba el filtro de Salud de la propia pantalla, pero `backendHealthToResult` sigue
   devolviendo "Verde / Amarillo / Rojo" y eso es lo que ven Tablero y Proyectos. **Hay que
   decidir cuál es el vocabulario oficial** y unificarlo; dejarlo así es incoherente entre
   pantallas.
2. **Umbrales de CPI/SPI (0,85 y 1,00) y de uso de presupuesto (90% y 100%)** en Portafolio:
   los respeté tal cual estaban, pero no coinciden con los que usa el backend para el
   semáforo (0,75 y 0,9). Alguien de negocio debería decir cuáles son los buenos.
3. **Qué hace exactamente "Alertas activas"** cuando vale 0: le puse el subtítulo "Sin
   pendientes" por simetría con el resto de KPIs; si el dato significa otra cosa, cámbialo.

---

## 8. Capturas

En `documentacion/capturas/`, generadas con Playwright sobre el entorno local:

- `portafolio-antes-*` / `portafolio-despues-*`: claro y oscuro, escritorio (1440px) y móvil (400px).
- `portafolio-despues-estados-*`: los tres estados del semáforo. Los datos demo solo traen
  proyectos en verde, así que para estas capturas se interceptó la respuesta de
  `/api/stats/portfolio` y se forzaron un `YELLOW` y un `RED`. **Solo afecta a la captura**,
  no hay ningún cambio en la app ni en los datos.

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
