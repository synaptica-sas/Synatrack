import { AppRole } from "@prisma/client";

/**
 * Proyección del consultor **sin datos sensibles**, para los roles que pueden ver
 * filas de toda la plantilla pero no su información económica ni su documento.
 *
 * Se omiten a propósito: `hourlyRate` y `costPerMonth` (remuneración) e
 * `identification` (documento de identidad, dato personal que ninguna de las
 * pantallas operativas necesita para nada), y `hireDate`/`exitDate` (fechas de
 * vínculo laboral, que solo ve quien puede ver tarifas).
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
  city: true,
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

type BloqueConMotivo = { blockType: unknown; note: string | null };

/**
 * Los bloqueos (vacaciones, incapacidad, permiso) revelan el motivo de una
 * ausencia, un dato personal. Quien solo lee capacity ve el rango de fechas (lo
 * necesita para entender la disponibilidad) pero no el tipo ni la nota: salen
 * `null` con `masked: true`. Quien puede escribir bloqueos (`assignments:write`)
 * los recibe completos.
 */
export function enmascararBloqueo<T extends BloqueConMotivo>(
  bloque: T,
  puedeVerMotivo: boolean,
): T | (Omit<T, "blockType" | "note"> & { blockType: null; note: null; masked: true }) {
  if (puedeVerMotivo) return bloque;
  return { ...bloque, blockType: null, note: null, masked: true };
}
