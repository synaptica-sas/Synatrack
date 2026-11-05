/**
 * Lógica pura de "Mis delegaciones" (R15 §2.4): quién puede delegar, qué
 * proyectos ofrecer, estado de vigencia y validación del formulario.
 * Las reglas de fondo las aplica el backend; esto solo evita ofrecer lo que
 * seguro será rechazado.
 */
import type { ApprovalDelegation, Project } from "../../services/api";

export type DelegationState = "ACTIVE" | "EXPIRED" | "FUTURE";

export const DELEGATION_STATE_LABELS: Record<DelegationState, string> = {
  ACTIVE: "Vigente",
  EXPIRED: "Vencida",
  FUTURE: "Programada",
};

/** Solo la parte de fecha ("YYYY-MM-DD") de un ISO completo o de una fecha. */
export function dateOnly(value: string): string {
  return value.slice(0, 10);
}

/** Vigencia inclusiva en ambos extremos, comparando fechas de calendario. */
export function delegationState(
  d: Pick<ApprovalDelegation, "startDate" | "endDate">,
  today: string,
): DelegationState {
  if (dateOnly(d.endDate) < today) return "EXPIRED";
  if (dateOnly(d.startDate) > today) return "FUTURE";
  return "ACTIVE";
}

function norm(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

/** Proyectos sobre los que puede delegar: los que dirige; el ADMIN, cualquiera con PM. */
export function delegableProjects(
  projects: readonly Project[],
  userEmail: string | undefined,
  isAdmin: boolean,
): Project[] {
  const me = norm(userEmail);
  return projects
    .filter((p) => {
      const pm = norm(p.projectManagerEmail);
      if (!pm) return false;
      return isAdmin || (!!me && pm === me);
    })
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export function canDelegate(
  projects: readonly Project[],
  userEmail: string | undefined,
  isAdmin: boolean,
): boolean {
  return isAdmin || delegableProjects(projects, userEmail, false).length > 0;
}

/** Mensaje de error del formulario, o null si es válido. */
export function validateDelegationForm(f: {
  projectId: string;
  toUserEmail: string;
  startDate: string;
  endDate: string;
}): string | null {
  if (!f.projectId) return "Elige el proyecto.";
  if (!f.toUserEmail) return "Elige a quién delegas.";
  if (!f.startDate || !f.endDate) return "Indica la fecha de inicio y la de fin.";
  if (f.endDate < f.startDate) return "La fecha de fin no puede ser anterior a la de inicio.";
  return null;
}
