/**
 * Mapeos centralizados de status codes → etiquetas en español.
 * Usar en todos los renders de tabla para consistencia visual.
 */

// ── Proyectos ─────────────────────────────────────────────────────────────────

export const PROJECT_STATUS_LABELS: Record<string, string> = {
  PROSPECT: "Oportunidad",
  ACTIVE:  "Activo",
  PAUSED:  "Pausado",
  CLOSED:  "Cerrado",
};

export const PROJECT_TYPE_LABELS: Record<string, string> = {
  FIXED_PRICE:       "Precio fijo",
  TIME_AND_MATERIAL: "Tiempo y materiales",
  STAFFING:          "Staffing",
};

export const PROJECT_PHASE_LABELS: Record<string, string> = {
  INITIATION:  "Inicio",
  PLANNING:    "Planificación",
  EXECUTION:   "Ejecución",
  MONITORING:  "Seguimiento",
  CLOSING:     "Cierre",
};

// ── Hitos ─────────────────────────────────────────────────────────────────────

export const MILESTONE_STATUS_LABELS: Record<string, string> = {
  PLANNED:     "Planificado",
  IN_PROGRESS: "En progreso",
  COMPLETED:   "Completado",
  DELAYED:     "Atrasado",
  CANCELLED:   "Cancelado",
};

// ── Riesgos ───────────────────────────────────────────────────────────────────

export const RISK_STATUS_LABELS: Record<string, string> = {
  OPEN:      "Abierto",
  MITIGATED: "Mitigado",
  ACCEPTED:  "Aceptado",
  CLOSED:    "Cerrado",
};

// ── Incidentes ────────────────────────────────────────────────────────────────

export const ISSUE_STATUS_LABELS: Record<string, string> = {
  OPEN:        "Abierto",
  IN_PROGRESS: "En progreso",
  RESOLVED:    "Resuelto",
  CLOSED:      "Cerrado",
};

export const ISSUE_SEVERITY_LABELS: Record<string, string> = {
  LOW:      "Baja",
  MEDIUM:   "Media",
  HIGH:     "Alta",
  CRITICAL: "Crítica",
};

// ── Cambios ───────────────────────────────────────────────────────────────────

export const CHANGE_REQUEST_TYPE_LABELS: Record<string, string> = {
  SCOPE:    "Alcance",
  BUDGET:   "Presupuesto",
  SCHEDULE: "Cronograma",
  OTHER:    "Otro",
};

export const CHANGE_REQUEST_STATUS_LABELS: Record<string, string> = {
  PENDING:  "Pendiente",
  APPROVED: "Aprobado",
  REJECTED: "Rechazado",
};

// ── Asignaciones ──────────────────────────────────────────────────────────────

export const ASSIGNMENT_STATUS_LABELS: Record<string, string> = {
  PLANNED:   "Planificado",
  ACTIVE:    "Activo",
  COMPLETED: "Completado",
  CANCELLED: "Cancelado",
};

// ── Registros de tiempo ───────────────────────────────────────────────────────

export const TIME_ENTRY_STATUS_LABELS: Record<string, string> = {
  PENDING:  "Pendiente",
  APPROVED: "Aprobado",
  REJECTED: "Rechazado",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Devuelve la etiqueta o el code original si no existe mapeo */
export function label(map: Record<string, string>, code: string | null | undefined): string {
  if (!code) return "—";
  return map[code] ?? code;
}

export function getCountryISOCode(country: string | null | undefined): string {
  if (!country) return "us";
  const name = country.trim().toLowerCase();
  if (name === "colombia") return "co";
  if (name === "peru" || name === "perú") return "pe";
  if (name === "chile") return "cl";
  if (name === "mexico" || name === "méxico") return "mx";
  if (name === "ecuador") return "ec";
  if (name === "argentina") return "ar";
  if (name === "espana" || name === "españa" || name === "spain") return "es";
  if (name === "default" || name === "usa" || name === "us" || name === "estados unidos") return "us";
  return "";
}

export function getCountryFlagUrl(country: string | null | undefined): string {
  const iso = getCountryISOCode(country);
  if (!iso) return "";
  return `https://flagcdn.com/24x18/${iso}.png`;
}

export function getCountryFlag(country: string | null | undefined): string {
  if (!country) return "🌐";
  const name = country.trim().toLowerCase();
  if (name === "colombia") return "🇨🇴";
  if (name === "peru" || name === "perú") return "🇵🇪";
  if (name === "chile") return "🇨🇱";
  if (name === "mexico" || name === "méxico") return "🇲🇽";
  if (name === "ecuador") return "🇪🇨";
  if (name === "argentina") return "🇦🇷";
  if (name === "espana" || name === "españa" || name === "spain") return "🇪🇸";
  if (name === "default" || name === "usa" || name === "us" || name === "estados unidos") return "🇺🇸";
  return "🌐";
}

export function displayCountry(country: string | null | undefined): string {
  if (!country) return "USA";
  const name = country.trim();
  const lower = name.toLowerCase();
  if (lower === "default" || lower === "usa" || lower === "us" || lower === "estados unidos") {
    return "USA";
  }
  return name;
}

export function displayCountryWithFlag(country: string | null | undefined): string {
  const name = displayCountry(country);
  const flag = getCountryFlag(country);
  return `${flag} ${name}`;
}

