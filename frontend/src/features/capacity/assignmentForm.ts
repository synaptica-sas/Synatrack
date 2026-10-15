import type {
  AllocationMode,
  AssignmentCertainty,
  AssignmentWarning,
  Project,
} from "../../services/api";

/** Jornada de referencia para mostrar el equivalente en % de una jornada. */
export const HORAS_JORNADA_REFERENCIA = 8;

export type AssignmentFormState = {
  projectId: string;
  consultantId: string;
  startDate: string;
  endDate: string;
  allocationMode: AllocationMode;
  allocationPct: string;
  hoursPerPeriod: string;
  periodUnit: "week" | "month";
  certainty: AssignmentCertainty;
  role: string;
  note: string;
};

/** Por defecto se captura en horas por semana, como pide el contrato. */
export const emptyAssignmentForm: AssignmentFormState = {
  projectId: "",
  consultantId: "",
  startDate: "",
  endDate: "",
  allocationMode: "HOURS",
  allocationPct: "100",
  hoursPerPeriod: "40",
  periodUnit: "week",
  certainty: "CONFIRMED",
  role: "",
  note: "",
};

export const CERTAINTY_LABELS: Record<AssignmentCertainty, string> = {
  CONFIRMED: "Confirmado",
  PROBABLE: "Probable",
};

/** Jornada con la que se compara la dedicación. `deConsultor` indica que es la vigente del consultor elegido. */
export type JornadaReferencia = { hoursPerDay: number; workDaysPerWeek: number; deConsultor: boolean };

/**
 * Equivalente en % de la jornada semanal (por defecto 8 h x 5 días = 40 h) de las
 * horas capturadas. Las horas por mes se pasan a semana con 12/52, como el backend.
 * Devuelve `null` si no hay un número válido.
 */
export function equivalentePctJornada(
  hoursPerPeriod: string,
  periodUnit: "week" | "month",
  jornada?: Pick<JornadaReferencia, "hoursPerDay" | "workDaysPerWeek">,
): number | null {
  const horas = Number(hoursPerPeriod.replace(",", "."));
  if (hoursPerPeriod.trim() === "" || !Number.isFinite(horas) || horas <= 0) return null;
  const porSemana = periodUnit === "month" ? (horas * 12) / 52 : horas;
  const semanal = jornada ? jornada.hoursPerDay * jornada.workDaysPerWeek : HORAS_JORNADA_REFERENCIA * 5;
  if (!(semanal > 0)) return null;
  return (porSemana / semanal) * 100;
}

/**
 * Texto "≈ 50 % de una jornada de 8 h" sin jornada conocida; con ella,
 * "≈ 100 % de su jornada (4 h × 5 días)" o "de la jornada general (...)". `null` si no aplica.
 */
export function textoEquivalente(
  hoursPerPeriod: string,
  periodUnit: "week" | "month",
  jornada?: JornadaReferencia,
): string | null {
  const pct = equivalentePctJornada(hoursPerPeriod, periodUnit, jornada);
  if (pct === null) return null;
  const redondeado = Math.round(pct * 10) / 10;
  const num = redondeado.toLocaleString("es-CO", { maximumFractionDigits: 1 });
  if (!jornada) return `≈ ${num} % de una jornada de ${HORAS_JORNADA_REFERENCIA} h`;
  const detalle = `${jornada.hoursPerDay.toLocaleString("es-CO")} h × ${jornada.workDaysPerWeek} días`;
  return `≈ ${num} % de ${jornada.deConsultor ? "su jornada" : "la jornada general"} (${detalle})`;
}

/** Valida el formulario. Devuelve el mensaje de error o `null`. Las fechas son `YYYY-MM-DD`. */
export function validarAsignacion(form: AssignmentFormState): string | null {
  if (!form.startDate || !form.endDate) return "Indica las fechas de inicio y fin.";
  // Comparar texto ISO equivale a comparar fechas y evita la hora local.
  if (form.endDate < form.startDate) return "La fecha de fin no puede ser anterior a la de inicio.";
  if (form.allocationMode === "HOURS") {
    const horas = Number(form.hoursPerPeriod.replace(",", "."));
    if (!Number.isFinite(horas) || horas <= 0) return "Indica las horas de dedicación.";
  }
  return null;
}

/** Mensaje de advertencia para el toast, o `null` si no hay sobreasignación. */
export function mensajeAdvertencias(warnings: AssignmentWarning[] | undefined): string | null {
  const sobre = (warnings ?? []).filter((w) => w.code === "OVERALLOCATED");
  if (sobre.length === 0) return null;
  const detalle = sobre
    .slice(0, 3)
    .map((w) => `${w.month} (${Math.round(w.pct)} %)`)
    .join(", ");
  const resto = sobre.length > 3 ? ` y ${sobre.length - 3} más` : "";
  return `Asignación guardada, pero el consultor queda sobreasignado en: ${detalle}${resto}.`;
}

/** Etiqueta de un proyecto en el selector: marca oportunidades e internos. */
export function etiquetaProyecto(p: Pick<Project, "name" | "status" | "isInternal">): string {
  const marcas: string[] = [];
  if (p.status === "PROSPECT") marcas.push("(Oportunidad)");
  if (p.isInternal) marcas.push("(Interno)");
  return marcas.length ? `${p.name} ${marcas.join(" ")}` : p.name;
}
