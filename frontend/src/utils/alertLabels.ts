/** Etiquetas en español de los tipos de alerta de capacity (CONTRATO §5.3). */
export const CAPACITY_ALERT_LABELS: Record<string, string> = {
  CONSULTANT_OVERLOADED: "Consultor sobreasignado",
  CONSULTANT_UNDERUTILIZED: "Consultor subutilizado",
};

/** Etiqueta del tipo de alerta, o `null` si no es una alerta con etiqueta propia. */
export function alertTypeLabel(type: string): string | null {
  return CAPACITY_ALERT_LABELS[type] ?? null;
}

/** Tipos que se agrupan bajo "Capacidad" en el centro de alertas. */
export const CAPACITY_ALERT_TYPES = Object.keys(CAPACITY_ALERT_LABELS);
