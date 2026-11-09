import { AppRole, AssignmentStatus, type AlertType, type Prisma } from "@prisma/client";
import { prisma } from "../../infra/prisma.js";

/**
 * A quién le toca cada alerta in-app. Una sola fuente de verdad para el listado,
 * el contador y la resolución: así el número del icono coincide con la lista y
 * nadie resuelve algo que no ve.
 *
 * Regla de negocio: resolver una alerta la resuelve para todos (no hay estado por
 * destinatario); lo que cambia por usuario es qué ve y qué puede resolver.
 */

const TIPOS_FINANCIEROS: AlertType[] = [
  "BUDGET_WARNING",
  "BUDGET_EXCEEDED",
  "MARGIN_BELOW_THRESHOLD",
  "FORECAST_DEVIATION",
];
const TIPOS_DE_CAPACIDAD: AlertType[] = ["ASSIGNMENT_ENDING", "CONSULTANT_OVERLOADED", "CONSULTANT_UNDERUTILIZED"];
const TODOS_LOS_TIPOS: AlertType[] = [...TIPOS_FINANCIEROS, ...TIPOS_DE_CAPACIDAD, "FX_RATE_MISSING"];

export type AudienceUser = {
  roles: AppRole[];
  /** `Consultant` enlazado al usuario (Consultant.userId), si lo hay. */
  consultantId: string | null;
  /** Proyectos donde `projectManagerEmail` es el correo del usuario. */
  managedProjectIds: string[];
  /** Consultores con asignación vigente en alguno de esos proyectos. */
  managedConsultantIds: string[];
};

export type AlertRef = { type: AlertType; projectId: string | null; consultantId: string | null };

/** Una cláusula de visibilidad: tipos permitidos, acotados opcionalmente por proyecto o consultor. */
type Regla = {
  types: AlertType[];
  projectIds?: string[];
  consultantIds?: string[];
  resolvable: boolean;
};

function reglasDe(user: AudienceUser): Regla[] {
  const reglas: Regla[] = [];
  for (const rol of new Set(user.roles)) {
    switch (rol) {
      case AppRole.ADMIN:
        reglas.push({ types: TODOS_LOS_TIPOS, resolvable: true });
        break;
      case AppRole.PM:
        reglas.push(
          { types: [...TIPOS_FINANCIEROS, "ASSIGNMENT_ENDING"], projectIds: user.managedProjectIds, resolvable: true },
          { types: ["CONSULTANT_OVERLOADED"], consultantIds: user.managedConsultantIds, resolvable: true },
        );
        break;
      case AppRole.FINANCE:
        reglas.push({ types: [...TIPOS_FINANCIEROS, "FX_RATE_MISSING"], resolvable: true });
        break;
      case AppRole.COMMERCIAL:
        reglas.push({ types: TIPOS_DE_CAPACIDAD, resolvable: true });
        break;
      case AppRole.CONSULTANT:
        reglas.push({
          types: ["ASSIGNMENT_ENDING"],
          consultantIds: user.consultantId ? [user.consultantId] : [],
          resolvable: false,
        });
        break;
      default:
        break; // VIEWER: ninguna
    }
  }
  // Una regla con un alcance vacío (PM sin proyectos) no deja pasar nada.
  return reglas.filter((r) => (r.projectIds ?? r.consultantIds ?? [""]).length > 0);
}

/** `where` de Prisma con todo lo que el usuario puede ver (OR entre roles). */
export function buildAlertWhere(user: AudienceUser): Prisma.AlertWhereInput {
  const reglas = reglasDe(user);
  if (reglas.length === 0) return { id: { in: [] } };
  return {
    OR: reglas.map((r) => ({
      type: { in: r.types },
      ...(r.projectIds ? { projectId: { in: r.projectIds } } : {}),
      ...(r.consultantIds ? { consultantId: { in: r.consultantIds } } : {}),
    })),
  };
}

function coincide(regla: Regla, alerta: AlertRef): boolean {
  if (!regla.types.includes(alerta.type)) return false;
  if (regla.projectIds && !(alerta.projectId && regla.projectIds.includes(alerta.projectId))) return false;
  if (regla.consultantIds && !(alerta.consultantId && regla.consultantIds.includes(alerta.consultantId))) return false;
  return true;
}

/** ¿La alerta es visible para el usuario? Equivale a `buildAlertWhere`, evaluado en memoria. */
export function canSeeAlert(user: AudienceUser, alerta: AlertRef): boolean {
  return reglasDe(user).some((r) => coincide(r, alerta));
}

/** Solo se resuelve lo que se ve y que el rol puede resolver. */
export function canResolveAlert(user: AudienceUser, alerta: AlertRef): boolean {
  return reglasDe(user).some((r) => r.resolvable && coincide(r, alerta));
}

/** Arma el contexto del usuario: proyectos que gestiona y consultores con asignación vigente en ellos. */
export async function loadAudienceUser(
  authUser: { roles: AppRole[]; email: string; consultantId?: string | null },
  now: Date = new Date(),
): Promise<AudienceUser> {
  let managedProjectIds: string[] = [];
  let managedConsultantIds: string[] = [];

  if (authUser.roles.includes(AppRole.PM)) {
    const proyectos = await prisma.project.findMany({
      where: { projectManagerEmail: { equals: authUser.email, mode: "insensitive" } },
      select: { id: true },
    });
    managedProjectIds = proyectos.map((p) => p.id);

    if (managedProjectIds.length > 0) {
      const hoy = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const asignaciones = await prisma.assignment.findMany({
        where: {
          projectId: { in: managedProjectIds },
          status: { in: [AssignmentStatus.ACTIVE, AssignmentStatus.PARTIAL] },
          endDate: { gte: hoy },
        },
        select: { consultantId: true },
        distinct: ["consultantId"],
      });
      managedConsultantIds = asignaciones.map((a) => a.consultantId);
    }
  }

  return {
    roles: authUser.roles,
    consultantId: authUser.consultantId ?? null,
    managedProjectIds,
    managedConsultantIds,
  };
}
