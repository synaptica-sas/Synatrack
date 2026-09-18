import type { PrismaClient } from "@prisma/client";
import { getLogger } from "../../infra/logger.js";

/**
 * Job nocturno: mantiene los estados de asignaciones sincronizados con las fechas.
 * Debe ejecutarse diariamente (vía cron o al iniciar el servidor).
 */
export async function runAssignmentMaintenance(prisma: PrismaClient): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

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
