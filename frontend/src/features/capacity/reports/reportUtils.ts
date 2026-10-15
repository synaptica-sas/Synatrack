import type {
  CapacityReportFilters,
  CapacityReportSummary,
  MonthlyCapacity,
  MonthlyCapacityConsultantDetail,
} from "../../../services/api";
import { monthShort } from "../../../utils/periodUtils";
import { parseMonthKey } from "../monthly/monthlyUtils";

/** "ene 2026" a partir de "2026-01". */
export function monthYearLabel(key: string): string {
  const { year, month } = parseMonthKey(key);
  return `${monthShort(month).toLowerCase()} ${year}`;
}

/** Título que se propone al publicar: "Capacity ene 2026 a dic 2026". */
export function defaultReportTitle(from: string, to: string): string {
  return `Capacity ${monthYearLabel(from)} a ${monthYearLabel(to)}`;
}

export const REPORT_TITLE_MAX = 200;
export const REVOKE_REASON_MIN = 5;

/** Error del título, o `null` si es válido. */
export function validateReportTitle(title: string): string | null {
  const t = title.trim();
  if (t === "") return "El título es obligatorio.";
  if (t.length > REPORT_TITLE_MAX) return `El título no puede superar ${REPORT_TITLE_MAX} caracteres.`;
  return null;
}

/** Error del motivo de anulación (mínimo 5 caracteres, CONTRATO §5.2), o `null`. */
export function validateRevokeReason(reason: string): string | null {
  if (reason.trim().length < REVOKE_REASON_MIN) {
    return `El motivo debe tener al menos ${REVOKE_REASON_MIN} caracteres.`;
  }
  return null;
}

export function reportFiltersText(filters: CapacityReportFilters | null | undefined): string {
  const parts: string[] = [];
  if (filters?.country) parts.push(filters.country);
  if (filters?.city) parts.push(filters.city);
  if (filters?.company) parts.push(filters.company);
  return parts.length > 0 ? parts.join(" · ") : "Sin filtros";
}

export function isRevoked(report: Pick<CapacityReportSummary, "revokedAt">): boolean {
  return report.revokedAt !== null && report.revokedAt !== undefined;
}

/** Detalle de un consultor armado desde el payload congelado (sin llamar a `/monthly/consultant`). */
export function frozenConsultantDetail(data: MonthlyCapacity, consultantId: string): MonthlyCapacityConsultantDetail | undefined {
  const row = data.consultants.find((c) => c.id === consultantId);
  if (!row) return undefined;
  const { months, period, assignments, ...consultant } = row;
  return { consultant, months, period, assignments: assignments ?? [] };
}
