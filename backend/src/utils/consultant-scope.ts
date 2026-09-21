import { AppRole } from "@prisma/client";

/**
 * Proyección del consultor **sin datos sensibles**, para los roles que pueden ver
 * filas de toda la plantilla pero no su información económica ni su documento.
 *
 * Se omiten a propósito: `hourlyRate` y `costPerMonth` (remuneración) e
 * `identification` (documento de identidad, dato personal que ninguna de las
 * pantallas operativas necesita para nada).
 *
 * Nació en `time-entries` con R5; aquí vive compartido porque R7 lo aplica
 * también a `extra-hours`, `consultants` y `activities`, y tener cuatro copias
 * del mismo `select` es exactamente cómo se vuelve a abrir una fuga: basta con
 * que alguien añada un campo sensible al modelo y solo lo excluya en tres.
 */
export const consultantSinDatosSensiblesSelect = {
  id: true,
  fullName: true,
  email: true,
  role: true,
  company: true,
  rateCurrency: true,
  country: true,
  skills: true,
  seniority: true,
  maxHoursPerDay: true,
  active: true,
  allowWeekendWork: true,
  isInternal: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Quién puede ver tarifas y costos de la plantilla.
 *
 * `ADMIN` y `PM` las necesitan para gestionar el proyecto; `FINANCE` para la
 * nómina. `CONSULTANT` y `VIEWER` no: el primero solo debe conocer la suya
 * propia (y la conoce porque en las rutas de horas solo recibe sus propias
 * filas), el segundo es un rol de consulta sin responsabilidad económica.
 */
export function puedeVerTarifas(roles: AppRole[]): boolean {
  return (
    roles.includes(AppRole.ADMIN) ||
    roles.includes(AppRole.PM) ||
    roles.includes(AppRole.FINANCE)
  );
}
