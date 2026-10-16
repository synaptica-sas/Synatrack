import type { AuditAction, AuditEntity } from "../../services/api";

/**
 * Etiquetas en español de la bitácora. Deben mantenerse sincronizadas con
 * `AUDIT_ENTITIES` (backend/src/utils/audit.ts) y con las acciones que escribe
 * `writeAudit`: al agregar una entidad o acción en el backend, agrégala aquí
 * y en los tipos `AuditEntity`/`AuditAction` de `services/api.ts`.
 */
export const AUDIT_ENTITY_LABELS: Record<AuditEntity, string> = {
  project: "Proyecto",
  consultant: "Consultor",
  timeEntry: "Hora registrada",
  extraHourEntry: "Hora extra",
  expense: "Gasto",
  revenueEntry: "Ingreso",
  financialEntry: "Movimiento financiero",
  forecast: "Proyección",
  assignment: "Asignación",
  changeRequest: "Cambio de alcance",
  monthlySnapshot: "Cierre mensual",
  approvalDelegation: "Delegación de aprobación",
  user: "Usuario",
  activity: "Actividad",
  estimation: "Estimación",
  alert: "Alerta",
  consultantBlock: "Bloqueo de consultor",
  capacityConfig: "Config. de capacidad",
  capacitySettings: "Ajustes de capacity",
  capacityReport: "Reporte de capacity",
  holiday: "Feriado",
  holidayCalendarYear: "Calendario de feriados",
  customHoliday: "Feriado personalizado",
  financialCategory: "Categoría financiera",
  healthThresholdConfig: "Umbrales de salud",
  approvalDigestConfig: "Resumen de aprobaciones",
  extraHoursConfig: "Config. de horas extra",
  fxConfig: "Tasa de cambio",
  milestone: "Hito",
  risk: "Riesgo",
  issue: "Incidencia",
};

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  CREATE: "Creación",
  UPDATE: "Edición",
  DELETE: "Eliminación",
  APPROVE: "Aprobación",
  REJECT: "Rechazo",
  CLOSE: "Cierre",
  CANCEL: "Cancelación",
  COMPLETE: "Completado",
  LOGIN: "Inicio de sesión",
};

/** Etiqueta de una entidad; si es desconocida (p. ej. histórico "Project") devuelve el valor crudo. */
export function auditEntityLabel(entity: string): string {
  return Object.prototype.hasOwnProperty.call(AUDIT_ENTITY_LABELS, entity)
    ? AUDIT_ENTITY_LABELS[entity as AuditEntity]
    : entity;
}

/** Etiqueta de una acción; si es desconocida devuelve el valor crudo. */
export function auditActionLabel(action: string): string {
  return Object.prototype.hasOwnProperty.call(AUDIT_ACTION_LABELS, action)
    ? AUDIT_ACTION_LABELS[action as AuditAction]
    : action;
}

/**
 * Tono del `.state-chip` de la acción. El sistema de diseño decide el matiz y
 * su contraparte oscura.
 */
export function auditActionTone(action: string): "success" | "danger" | "warning" | "info" {
  if (action === "CREATE") return "success";
  if (action === "DELETE" || action === "REJECT") return "danger";
  if (action === "LOGIN") return "info";
  return "warning";
}

export type AuditSelectOption = { value: string; label: string };

/** Opciones para los selects de filtro, ordenadas alfabéticamente por etiqueta. */
export const AUDIT_ENTITY_OPTIONS: AuditSelectOption[] = Object.entries(AUDIT_ENTITY_LABELS)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label, "es"));

export const AUDIT_ACTION_OPTIONS: AuditSelectOption[] = Object.entries(AUDIT_ACTION_LABELS).map(
  ([value, label]) => ({ value, label }),
);
