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
 *     compara contra `marginThreshold` del proyecto (rojo por debajo de la
 *     mitad del umbral, amarillo por debajo del umbral) y además mira CPI, SPI,
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

const HEALTH_MAP: Record<HealthLevel, Omit<ProjectHealthResult, "nivel">> = {
  VERDE:    { label: "Verde",   color: "#6bb42d", pillClass: "ok",    icon: "●" },
  AMARILLO: { label: "Amarillo", color: "#f1a323", pillClass: "warn",  icon: "●" },
  ROJO:     { label: "Rojo",    color: "#a8194c", pillClass: "error", icon: "●" },
  CRITICO:  { label: "Crítico", color: "#a8194c", pillClass: "error", icon: "▲" },
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
 * Valor por defecto de `marginThreshold` del backend
 * (`DEFAULT_MARGIN_THRESHOLD_PCT` en `backend/src/utils/financial.ts`).
 * Solo se usa como texto de respaldo cuando la respuesta no trae el umbral;
 * nunca para colorear nada.
 */
export const UMBRAL_MARGEN_POR_DEFECTO = 15;

/**
 * Texto del tooltip con los criterios **reales** del backend. Recibe el
 * `marginThreshold` que viene en la propia respuesta para no inventar un valor.
 *
 * @param marginThreshold umbral resuelto del proyecto, tal como lo devuelve el
 *   API. Si llega `null`/`undefined` se dice explícitamente que no se conoce en
 *   vez de suponer uno.
 */
export function textoCriteriosSalud(marginThreshold?: number | null): string {
  const umbral =
    marginThreshold != null && Number.isFinite(marginThreshold)
      ? `${marginThreshold}%`
      : "no informado por el API";

  return (
    "Semáforo calculado por el servidor. " +
    `Umbral de margen de este proyecto: ${umbral}. ` +
    "ROJO: presupuesto proyectado excedido, riesgos altos abiertos, CPI o SPI < 0,75, " +
    "o margen por debajo de la mitad del umbral. " +
    "AMARILLO: aviso de presupuesto, hitos atrasados, CPI o SPI < 0,9, " +
    "o margen por debajo del umbral. " +
    "VERDE: ninguna de las anteriores."
  );
}

/**
 * Clase de tono del texto del margen bruto, contrastada contra el umbral
 * **real** del proyecto y no contra un literal. Devuelve el tono neutro cuando
 * el margen no es medible (sin ingresos reconocidos).
 *
 * Antes se llamaba `colorMargen` y devolvía literales de Tailwind (#ef4444,
 * #f59e0b, #22c55e, #9ca3af) que se incrustaban en un `style` en línea: eso
 * ignoraba el modo oscuro y la paleta de Synaptica. Ahora devuelve una de las
 * clases `tone-*` de `App.css`, que resuelven su color por token
 * (`--state-*-strong`) y tienen contraparte oscura.
 */
export function claseMargen(
  grossMarginActualPct: number | null | undefined,
  marginThreshold?: number | null,
): "tone-success" | "tone-warning" | "tone-danger" | "tone-muted" {
  if (grossMarginActualPct == null) return "tone-muted";
  const umbral =
    marginThreshold != null && Number.isFinite(marginThreshold)
      ? marginThreshold
      : UMBRAL_MARGEN_POR_DEFECTO;
  // Mismos cortes que `computeHealthStatus`: rojo bajo medio umbral, ámbar bajo umbral.
  if (grossMarginActualPct < umbral * 0.5) return "tone-danger";
  if (grossMarginActualPct < umbral) return "tone-warning";
  return "tone-success";
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
