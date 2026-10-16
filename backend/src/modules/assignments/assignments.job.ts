import { fromIsoDate, toIsoDate } from "../../utils/isoDate.js";
import { getLogger } from "../../infra/logger.js";
import type { DbClient } from "../../infra/prisma.js";

/**
 * Job nocturno: mantiene los estados de asignaciones sincronizados con las fechas.
 * Debe ejecutarse diariamente (vía cron o al iniciar el servidor).
 */
export async function runAssignmentMaintenance(prisma: DbClient): Promise<void> {
  // BE-12: las fechas de asignación son DATE (día calendario); se compara el día de hoy en UTC,
  // no la hora local del servidor (que movía el corte según la zona horaria).
  const today = fromIsoDate(toIsoDate(new Date()));

  // PLANNED → ACTIVE si startDate ya llegó y endDate aún no pasó
  const activated = await prisma.assignment.updateMany({
    where: {
      status: "PLANNED",
      startDate: { lte: today },
      endDate: { gte: today },
    },
    data: { status: "ACTIVE" },
  });

  // ACTIVE | PARTIAL → COMPLETED si endDate ya pasó
  const completed = await prisma.assignment.updateMany({
    where: {
      status: { in: ["ACTIVE", "PARTIAL"] },
      endDate: { lt: today },
    },
    data: { status: "COMPLETED" },
  });

  getLogger().info(
    { activated: activated.count, completed: completed.count },
    "[AssignmentJob] Mantenimiento de asignaciones completado",
  );
}
