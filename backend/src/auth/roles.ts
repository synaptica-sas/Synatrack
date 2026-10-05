import { AppRole } from "@prisma/client";

export type Permission =
  | "projects:read"
  | "projects:write"
  | "consultants:read"
  | "consultants:write"
  | "time:read"
  | "time:write"
  | "time:review"
  | "expenses:read"
  | "expenses:write"
  | "forecasts:read"
  | "forecasts:write"
  | "revenue:read"
  | "revenue:write"
  | "fx:read"
  | "fx:write"
  | "stats:read"
  | "assignments:read"
  | "assignments:write"
  | "capacity:read"
  | "capacity:config"
  | "snapshots:close"
  | "alerts:read"
  | "alerts:resolve"
  | "audit:read"
  | "users:manage"
  | "extrahours:read"
  | "extrahours:write"
  | "extrahours:review"
  | "extrahours:config"
  | "estimations:write"
  | "estimations:read"
  | "activities:manage";

const allPermissions: Permission[] = [
  // `activities:manage` gobierna SOLO la visibilidad de la pantalla de
  // Actividades, que por decisión de negocio (D-8) queda oculta salvo para
  // ADMIN mientras se decide el futuro del módulo. NO se usa para leer
  // actividades: el cronómetro necesita listarlas para su selector de tarea y
  // se apoya en `time:read`, que conservan todos los roles operativos.
  "activities:manage",
  "projects:read",
  "projects:write",
  "consultants:read",
  "consultants:write",
  "time:read",
  "time:write",
  "time:review",
  "expenses:read",
  "expenses:write",
  "forecasts:read",
  "forecasts:write",
  "revenue:read",
  "revenue:write",
  "fx:read",
  "fx:write",
  "stats:read",
  "assignments:read",
  "assignments:write",
  "capacity:read",
  // Solo ADMIN: la jornada laboral (D-5) mueve las ocupaciones de todo el
  // portafolio a la vez, igual que `extrahours:config` mueve los recargos.
  "capacity:config",
  "snapshots:close",
  "alerts:read",
  "alerts:resolve",
  "audit:read",
  "users:manage",
  "extrahours:read",
  "extrahours:write",
  "extrahours:review",
  "extrahours:config",
  "estimations:write",
  "estimations:read",
];

export const rolePermissions: Record<AppRole, Permission[]> = {
  ADMIN: allPermissions,
  PM: [
    "projects:read",
    "projects:write",
    "consultants:read",
    "consultants:write",
    "time:read",
    "time:write",
    "time:review",
    "expenses:read",
    "expenses:write",
    "forecasts:read",
    "forecasts:write",
    "revenue:read",
    "revenue:write",
    "fx:read",
    "stats:read",
    "assignments:read",
    "assignments:write",
    "capacity:read",
    "alerts:read",
    "alerts:resolve",
    "extrahours:read",
    "extrahours:write",
    "extrahours:review",
    "estimations:write",
    "estimations:read",
  ],
  CONSULTANT: [
    "time:read",
    "time:write",
    "alerts:read",
    "extrahours:read",
    "extrahours:write",
    "estimations:read",
  ],
  FINANCE: [
    "extrahours:read",
    "extrahours:review",
  ],
  VIEWER: [
    "projects:read",
    "consultants:read",
    "time:read",
    "expenses:read",
    "forecasts:read",
    "revenue:read",
    "fx:read",
    "stats:read",
    "assignments:read",
    "capacity:read",
    "alerts:read",
    "extrahours:read",
  ],
};

export function resolvePermissions(roles: AppRole[]): Permission[] {
  const permissions = new Set<Permission>();
  for (const role of roles) {
    for (const permission of rolePermissions[role]) {
      permissions.add(permission);
    }
  }
  return Array.from(permissions);
}

