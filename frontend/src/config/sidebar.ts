import type { TabId } from "../types";

/**
 * Menú lateral: qué pestañas existen y con qué permiso se muestra cada una.
 * Vive aquí (y no en App.tsx) para poder probarlo sin montar toda la aplicación.
 * Ocultar una pestaña NO protege nada: quien autoriza de verdad es el backend.
 */
/**
 * Permiso sintético que App.tsx añade cuando `GET /api/timesheet-reviews/count`
 * dice `canReview`. No existe en la matriz de roles: quien revisa un proyecto
 * es su PM o su delegado, sea cual sea su rol.
 */
export const REVIEW_QUEUE_PERMISSION = "timesheet:review-queue";

export type SidebarTab = { id: TabId; label: string; icon: string; permission?: string | string[] };
export type SidebarGroup = { label: string; tabs: SidebarTab[] };

export const SIDEBAR_GROUPS: SidebarGroup[] = [
  {
    label: "Gobierno",
    tabs: [
      { id: "dashboard",  label: "Dashboard",   icon: "▦",  permission: "stats:read" },
      { id: "portfolio",  label: "Portafolio",  icon: "◈",  permission: "stats:read" },
      { id: "projects",   label: "Proyectos",   icon: "◻",  permission: "projects:read" },
      { id: "companies",  label: "Empresas",    icon: "▣",  permission: "companies:read" },
      { id: "capacity",   label: "Capacidad",   icon: "◉",  permission: "capacity:read" },
    ],
  },
  {
    label: "Operación",
    tabs: [
      { id: "consultants",  label: "Consultores",   icon: "◐", permission: "consultants:read" },
      { id: "tracker",      label: "Rastreador",     icon: "⏱", permission: "time:read" },
      { id: "timeEntries",  label: "Horas",          icon: "▥", permission: "time:read" },
      // La entrada depende de la cola del backend (PM de proyecto, delegado o ADMIN), no solo del rol.
      { id: "timesheetReviews", label: "Aprobación de horas", icon: "✔", permission: REVIEW_QUEUE_PERMISSION },
      { id: "reports",      label: "Informes",       icon: "▧", permission: "stats:read" },
      { id: "activities",   label: "Actividades",   icon: "▤", permission: "activities:manage" },
      { id: "extraHours",   label: "Horas Extra",    icon: "⧗", permission: "extrahours:read" },
    ],
  },
  {
    label: "Financiero",
    tabs: [
      { id: "financial",  label: "Ingresos/Gastos", icon: "⊕", permission: ["expenses:read", "revenue:read"] },
      { id: "estimations", label: "Estimaciones",  icon: "⚖", permission: "estimations:read" },
      { id: "fx",         label: "Tasas FX",      icon: "⊗", permission: "fx:read" },
    ],
  },
  {
    label: "Administración",
    tabs: [
      { id: "admin", label: "Usuarios",  icon: "⧉", permission: "users:manage" },
      { id: "extraHoursConfig", label: "Config. Horas Extra", icon: "⚙", permission: "extrahours:config" },
      { id: "workdayConfig", label: "Parámetros y Jornada", icon: "⌛", permission: "capacity:config" },
      { id: "holidays", label: "Feriados", icon: "✺", permission: "holidays:write" },
      { id: "healthThresholds", label: "Umbrales de Salud", icon: "♡", permission: "health:thresholds" },
      { id: "approvalDigest", label: "Resumen de Aprobaciones", icon: "✉", permission: "notifications:digest" },
      { id: "timeEntryTypes", label: "Tipos de Hora", icon: "⌚", permission: "time:types" },
      { id: "financialCategories", label: "Categorías Financieras", icon: "⊞", permission: "finance:categories" },
      { id: "audit", label: "Auditoría", icon: "⊛", permission: "audit:read" },
    ],
  },
];

/** Grupos y pestañas que ve quien tiene estos permisos (los grupos vacíos se omiten). */
export function visibleGroupsFor(permissions: string[]): SidebarGroup[] {
  return SIDEBAR_GROUPS.map((g) => ({
    ...g,
    tabs: g.tabs.filter((t) =>
      !t.permission ||
      (Array.isArray(t.permission)
        ? t.permission.some((p) => permissions.includes(p))
        : permissions.includes(t.permission)),
    ),
  })).filter((g) => g.tabs.length > 0);
}
