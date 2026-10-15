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
  | "assignments:write"
  | "capacity:read"
  | "capacity:config"
  | "holidays:read"
  | "holidays:write"
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
  | "finance:categories"
  | "health:thresholds"
  | "notifications:digest"
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
  "assignments:write",
  "capacity:read",
  // Solo ADMIN: la jornada laboral (D-5) mueve las ocupaciones de todo el
  // portafolio a la vez, igual que `extrahours:config` mueve los recargos.
  "capacity:config",
  // Feriados: leer lo tienen todos los roles (la capacidad y las horas extra los
  // usan); escribir solo ADMIN, porque mueve la capacidad de todo el equipo.
  "holidays:read",
  "holidays:write",
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
  // Solo ADMIN: el catálogo de categorías de gasto e ingreso (D-4) es
  // configuración general, del mismo tipo que la jornada o los recargos.
  "finance:categories",
  // Solo ADMIN: los umbrales de CPI, SPI y uso de presupuesto (D-7). Mover uno
  // repinta de golpe el semáforo de todo el portafolio, así que va con el mismo
  // criterio que `capacity:config` y `finance:categories`. Leerlos no requiere
  // permiso: las pantallas los necesitan para explicar el color que pintan.
  "health:thresholds",
  // Solo ADMIN: el día y la hora del resumen semanal de aprobaciones
  // (R-020 + R-022) y el interruptor del aviso inmediato de horas extra.
  // Cambiarlo afecta al correo que reciben TODOS los PM a la vez, así que va
  // con el mismo criterio que `capacity:config` y `health:thresholds`.
  // Leer la configuración no requiere permiso: cualquiera puede querer saber
  // qué día le llega su resumen.
  "notifications:digest",
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
    // Sin `assignments:write` (P5): solo ADMIN crea y mueve asignaciones.
    "capacity:read",
    "holidays:read",
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
    "holidays:read",
  ],
  FINANCE: [
    "extrahours:read",
    "extrahours:review",
    "capacity:read",
    "holidays:read",
  ],
  // Comercial: ve la ocupación y los feriados para saber a quién puede vender.
  // El detalle de asignaciones en solo lectura sale de `capacity:read`
  // (`canWrite` sale de `assignments:write`, que no tiene). No recibe proyectos,
  // tarifas ni dinero. El permiso `assignments:read` se eliminó: nadie lo exigía.
  COMMERCIAL: [
    "capacity:read",
    "holidays:read",
  ],
  VIEWER: [
    "projects:read",
    "consultants:read",
    "time:read",
    "expenses:read",
    "revenue:read",
    "fx:read",
    "stats:read",
    // Sin `capacity:read` (P3) ni `forecasts:read`: la ocupación y las horas
    // planificadas por consultor son confidenciales (D8).
    "holidays:read",
    "alerts:read",
    "extrahours:read",
  ],
};

/** ¿Alguno de los roles tiene el permiso? Misma fuente que `requirePermission`. */
export function hasPermission(roles: AppRole[], permission: Permission): boolean {
  return roles.some((role) => rolePermissions[role].includes(permission));
}

export function resolvePermissions(roles: AppRole[]): Permission[] {
  const permissions = new Set<Permission>();
  for (const role of roles) {
    for (const permission of rolePermissions[role]) {
      permissions.add(permission);
    }
  }
  return Array.from(permissions);
}

