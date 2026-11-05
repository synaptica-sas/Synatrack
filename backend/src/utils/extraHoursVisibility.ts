import { AppRole } from "@prisma/client";

/**
 * Visibilidad de los montos de horas extra.
 *
 * Los montos (y la tarifa que los origina) solo los ven quien decide o quien paga:
 * ADMIN, FINANCE y el PM del proyecto de la fila (`Project.projectManagerEmail`).
 * Cualquier otro (incluido el propio consultor que pidió las horas) recibe solo horas.
 * Ser PM se decide por el campo del proyecto, no por el rol de la cuenta.
 */
export function puedeVerMontosHoraExtra(
  user: { email: string; roles: AppRole[] },
  projectManagerEmail: string | null | undefined,
): boolean {
  if (user.roles.includes(AppRole.ADMIN) || user.roles.includes(AppRole.FINANCE)) return true;
  const pm = projectManagerEmail?.trim().toLowerCase();
  return !!pm && pm === user.email.trim().toLowerCase();
}

/** Campos monetarios o del cálculo económico que se quitan de una fila / previsualización. */
export const CAMPOS_MONETARIOS_HORA_EXTRA = [
  "diurnalAmount",
  "nocturnalAmount",
  "diurnalHolidayAmount",
  "nocturnalHolidayAmount",
  "totalAmount",
  "hourlyRate",
  "divisorUsed",
] as const;

/** Información del PM: lo real y el excedente frente a lo solicitado. */
export const CAMPOS_SOLO_PM_HORA_EXTRA = ["realHours", "excessHours", "excessPendingHours"] as const;

/**
 * Quita de la fila los montos, la tarifa, el divisor y lo real/excedente. Si trae el objeto
 * `consultant` completo, le quita también `hourlyRate` y `costPerMonth`.
 */
export function sinMontosHoraExtra(fila: object): Record<string, unknown> {
  const copia = { ...fila } as Record<string, unknown>;
  for (const campo of CAMPOS_MONETARIOS_HORA_EXTRA) delete copia[campo];
  for (const campo of CAMPOS_SOLO_PM_HORA_EXTRA) delete copia[campo];
  const consultor = copia.consultant;
  if (consultor && typeof consultor === "object") {
    const { hourlyRate: _h, costPerMonth: _c, ...resto } = consultor as Record<string, unknown>;
    copia.consultant = resto;
  }
  return copia;
}

/**
 * Proyección mínima del proyecto para las respuestas de horas extra a quien no es
 * ADMIN/FINANCE: lo que la pantalla usa (nombre y PM) más contexto básico. Sin
 * presupuesto, tarifas ni montos.
 */
export const PROYECTO_MINIMO_SELECT = {
  id: true,
  name: true,
  projectManagerEmail: true,
  allowExtraHours: true,
  country: true,
  currency: true,
} as const;

/** ADMIN y FINANCE reciben el proyecto completo; el resto, solo la proyección mínima. */
export function veProyectoCompleto(roles: AppRole[]): boolean {
  return roles.includes(AppRole.ADMIN) || roles.includes(AppRole.FINANCE);
}
