import { Prisma, TimeEntryCategory } from "@prisma/client";

/**
 * "Ejecutado" = horas TRABAJADAS (decisión 2026-11-05). Las horas de categoría ABSENCE (Permiso,
 * Vacaciones, proyecto de Ausencias) cuentan para completar la jornada, pero no son ejecución: no
 * entran a costo, EVM, utilización ni a los totales de horas de proyecto.
 *
 * Fragmento para el `where` de cualquier consulta de `TimeEntry` que mida ejecución o costo.
 * (Los registros ABSENCE solo existen en el proyecto de Ausencias y viceversa: R14 §2.4.)
 */
export const SOLO_TRABAJADAS = {
  type: { category: { not: TimeEntryCategory.ABSENCE } },
} satisfies Prisma.TimeEntryWhereInput;

/** Complemento: solo ausencias (para exponer `absenceHours` aparte). */
export const SOLO_AUSENCIAS = {
  type: { category: TimeEntryCategory.ABSENCE },
} satisfies Prisma.TimeEntryWhereInput;
