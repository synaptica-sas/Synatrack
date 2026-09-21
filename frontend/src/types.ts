export type TabId =
  | "dashboard" | "portfolio" | "projects" | "consultants" | "timeEntries" | "tracker"
  | "financial" | "forecasts" | "capacity" | "fx" | "admin" | "audit" | "alerts"
  | "extraHours" | "estimations" | "profile" | "activities" | "extraHoursConfig";

/** Sub-panel dentro del tab unificado "financial" (Gastos / Ingresos). */
export type FinancialPanel = "expenses" | "revenue";

