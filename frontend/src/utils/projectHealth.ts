/**
 * Presentación del semáforo de salud del proyecto.
 *
 * DECISIÓN (R11): **el frontend NO calcula salud.** El único semáforo válido es
 * el `healthStatus` que devuelve el backend (`computeHealthStatus` en
 * `backend/src/utils/health.ts`, alimentado por `computeProjectFinancials`
 * desde R10). Este módulo solo traduce ese estado a etiqueta, color e icono.
 *
 * Hasta R10 aquí vivía `calcularSaludProyecto`, que reimplementaba el semáforo
 * con umbrales fijos (margen < 0 rojo, < 10 amarillo, uso de presupuesto
 * 70/90/100/120). Se eliminó porque:
 *  1. No la llamaba nadie: las tres pantallas (tablero, portafolio y proyectos)
 *     ya pintaban con `backendHealthToResult(healthStatus)`. Era código muerto
 *     que solo servía para volver a divergir.
 *  2. Sus reglas no eran las del backend ni con los umbrales reales: el backend
 *     compara contra los DOS umbrales del proyecto (crítico por debajo del
 *     umbral crítico, advertencia por debajo del de advertencia) y además mira CPI, SPI,
 *     riesgos altos abiertos e hitos atrasados, datos que el cliente no
 *     siempre tiene.
 *  3. Recalcular en el cliente solo puede producir un color que contradiga al
 *     que ya viene en la misma respuesta.
 */

export type HealthLevel = "VERDE" | "AMARILLO" | "ROJO" | "CRITICO";

export type ProjectHealthResult = {
  nivel: HealthLevel;
  label: string;
  color: string;
  /** Clase CSS pill: "ok" | "warn" | "error" */
  pillClass: "ok" | "warn" | "error";
  /** Icono breve para tablas */
  icon: string;
};

/**
 * Vocabulario único del semáforo. Las etiquetas **nombran el estado, no el color**
 * ("Crítico", no "Rojo"): el color por sí solo no es accesible para quien no
 * distingue rojo y verde, y además "Verde" no dice nada sobre qué está pasando.
 *
 * Antes convivían dos vocabularios —este con nombres de color y el de Portafolio
 * con nombres de estado—, de modo que la misma salud se llamaba distinto según la
 * pantalla. Se unificó en el de estado (decisión de Juan, 2026-09-22).
 *
 * Los iconos tienen **forma distinta** a propósito, para que el estado se
 * distinga sin depender del color.
 */
const HEALTH_MAP: Record<HealthLevel, Omit<ProjectHealthResult, "nivel">> = {
  VERDE:    { label: "Saludable",   color: "var(--state-success-solid)", pillClass: "ok",    icon: "●" },
  AMARILLO: { label: "Advertencia", color: "var(--state-warning-solid)", pillClass: "warn",  icon: "▲" },
  ROJO:     { label: "Crítico",     color: "var(--state-danger-solid)",  pillClass: "error", icon: "■" },
  CRITICO:  { label: "Crítico",     color: "var(--state-danger-solid)",  pillClass: "error", icon: "■" },
};

/**
 * Convierte el `healthStatus` del backend ("GREEN" | "YELLOW" | "RED") al tipo
 * de presentación. Es el único camino admitido para pintar el semáforo.
 */
export function backendHealthToResult(status: "GREEN" | "YELLOW" | "RED"): ProjectHealthResult {
  const map: Record<"GREEN" | "YELLOW" | "RED", HealthLevel> = {
    GREEN: "VERDE",
    YELLOW: "AMARILLO",
    RED: "ROJO",
  };
  const nivel = map[status] ?? "VERDE";
  return { nivel, ...HEALTH_MAP[nivel] };
}

/**
 * Valores por defecto de los DOS umbrales de margen del backend
 * (`DEFAULT_MARGIN_WARNING_PCT` y `DEFAULT_MARGIN_CRITICAL_PCT` en
 * `backend/src/utils/financial.ts`), fijados por la decisión de negocio D-2.
 * Solo se usan como texto de respaldo cuando la respuesta no trae los umbrales;
 * nunca para colorear nada por cuenta propia.
 */
export const UMBRAL_ADVERTENCIA_POR_DEFECTO = 30;
export const UMBRAL_CRITICO_POR_DEFECTO = 15;

/** Vocabulario acordado del semáforo. No se cambia. */
export type NivelMargen = "ok" | "warning" | "critical" | "no-medible";

const PRESENTACION_MARGEN: Record<
  NivelMargen,
  { etiqueta: string; tono: "tone-success" | "tone-warning" | "tone-danger" | "tone-muted"; modificador: "success" | "warning" | "danger" | "neutral" }
> = {
  ok: { etiqueta: "Saludable", tono: "tone-success", modificador: "success" },
  warning: { etiqueta: "Advertencia", tono: "tone-warning", modificador: "warning" },
  critical: { etiqueta: "Crítico", tono: "tone-danger", modificador: "danger" },
  "no-medible": { etiqueta: "No medible", tono: "tone-muted", modificador: "neutral" },
};

function umbralesEfectivos(
  marginWarningPct?: number | null,
  marginCriticalPct?: number | null,
): { advertencia: number; critico: number } {
  return {
    advertencia:
      marginWarningPct != null && Number.isFinite(marginWarningPct)
        ? marginWarningPct
        : UMBRAL_ADVERTENCIA_POR_DEFECTO,
    critico:
      marginCriticalPct != null && Number.isFinite(marginCriticalPct)
        ? marginCriticalPct
        : UMBRAL_CRITICO_POR_DEFECTO,
  };
}

/**
 * Texto del tooltip con los criterios **reales** del backend. Recibe los dos
 * umbrales que vienen en la propia respuesta para no inventar valores.
 *
 * @param marginWarningPct umbral de advertencia ya resuelto por el API.
 * @param marginCriticalPct umbral crítico ya resuelto por el API.
 *   Si llegan `null`/`undefined` se dice explícitamente que no se conocen, en
 *   vez de suponerlos.
 */
export function textoCriteriosSalud(
  marginWarningPct?: number | null,
  marginCriticalPct?: number | null,
): string {
  const advertencia =
    marginWarningPct != null && Number.isFinite(marginWarningPct)
      ? `${marginWarningPct}%`
      : "no informado por el API";
  const critico =
    marginCriticalPct != null && Number.isFinite(marginCriticalPct)
      ? `${marginCriticalPct}%`
      : "no informado por el API";

  return (
    "Semáforo calculado por el servidor. " +
    `Umbrales de margen de este proyecto — advertencia: ${advertencia}, crítico: ${critico}. ` +
    "Crítico: presupuesto proyectado excedido, riesgos altos abiertos, CPI o SPI < 0,75, " +
    "o margen por debajo del umbral crítico. " +
    "Advertencia: aviso de presupuesto, hitos atrasados, CPI o SPI < 0,9, " +
    "o margen por debajo del umbral de advertencia. " +
    "Saludable: ninguna de las anteriores."
  );
}

/**
 * Nivel del margen bruto contra los DOS umbrales del proyecto (D-2), con los
 * mismos cortes exactos que `classifyMargin` en el backend: el umbral pertenece
 * a la banda buena, así que 30,00 con advertencia 30 está saludable y 15,00 con
 * crítico 15 es advertencia, no crítico.
 */
export function nivelMargen(
  grossMarginActualPct: number | null | undefined,
  marginWarningPct?: number | null,
  marginCriticalPct?: number | null,
): NivelMargen {
  if (grossMarginActualPct == null) return "no-medible";
  const { advertencia, critico } = umbralesEfectivos(marginWarningPct, marginCriticalPct);
  if (grossMarginActualPct < critico) return "critical";
  if (grossMarginActualPct < advertencia) return "warning";
  return "ok";
}

/**
 * Presentación completa del margen: etiqueta en palabras + tono. El color NO
 * puede ser el único portador de la información (WCAG 1.4.1), así que quien
 * pinte el margen debe mostrar también la etiqueta o, como mínimo, llevarla al
 * `title` y al `aria-label`.
 */
export function presentacionMargen(
  grossMarginActualPct: number | null | undefined,
  marginWarningPct?: number | null,
  marginCriticalPct?: number | null,
) {
  const nivel = nivelMargen(grossMarginActualPct, marginWarningPct, marginCriticalPct);
  return { nivel, ...PRESENTACION_MARGEN[nivel] };
}

/**
 * Clase de tono del texto del margen bruto, contrastada contra los umbrales
 * **reales** del proyecto y no contra un literal. Devuelve el tono neutro
 * cuando el margen no es medible (sin ingresos reconocidos).
 *
 * Antes se llamaba `colorMargen` y devolvía literales de Tailwind (#ef4444,
 * #f59e0b, #22c55e, #9ca3af) que se incrustaban en un `style` en línea: eso
 * ignoraba el modo oscuro y la paleta de Synaptica. Ahora devuelve una de las
 * clases `tone-*` de `App.css`, que resuelven su color por token
 * (`--state-*-strong`) y tienen contraparte oscura.
 */
export function claseMargen(
  grossMarginActualPct: number | null | undefined,
  marginWarningPct?: number | null,
  marginCriticalPct?: number | null,
): "tone-success" | "tone-warning" | "tone-danger" | "tone-muted" {
  return presentacionMargen(grossMarginActualPct, marginWarningPct, marginCriticalPct).tono;
}

/**
 * Presentación accesible del semáforo: además del color, un icono y una
 * etiqueta que **describe el estado, no el color** ("Crítico", no "Rojo"), con
 * las mismas palabras que usa el filtro de Salud de la pantalla de portafolio.
 * El color por sí solo no es información suficiente (WCAG 1.4.1).
 */
export const PRESENTACION_SALUD: Record<
  "GREEN" | "YELLOW" | "RED",
  { etiqueta: string; icono: string; modificador: "success" | "warning" | "danger" }
> = {
  GREEN: { etiqueta: "Saludable", icono: "●", modificador: "success" },
  YELLOW: { etiqueta: "Advertencia", icono: "▲", modificador: "warning" },
  RED: { etiqueta: "Crítico", icono: "■", modificador: "danger" },
};
