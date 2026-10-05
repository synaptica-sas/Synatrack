export type TabId =
  | "dashboard" | "portfolio" | "projects" | "consultants" | "timeEntries" | "tracker"
  | "reports" | "financial" | "forecasts" | "capacity" | "fx" | "admin" | "audit" | "alerts"
  | "extraHours" | "estimations" | "profile" | "activities" | "extraHoursConfig"
  | "workdayConfig" | "financialCategories" | "healthThresholds";

/** Sub-panel dentro del tab unificado "financial" (Gastos / Ingresos). */
export type FinancialPanel = "expenses" | "revenue";

