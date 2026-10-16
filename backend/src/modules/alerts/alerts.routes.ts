import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { hasPermission } from "../../auth/roles.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";
import { runAlertEngine } from "./alerts.service.js";

const listQuerySchema = z.object({
  projectId: z.string().optional(),
  consultantId: z.string().optional(),
  resolved: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

const idSchema = z.object({ id: z.string().min(1) });

/**
 * D8: las alertas de asignaciones por vencer y de sobrecarga revelan la carga
 * del equipo; solo las ve quien tiene `capacity:read`. Para el resto se
 * excluyen en la consulta, no después.
 */
const TIPOS_DE_CAPACITY = ["ASSIGNMENT_ENDING", "CONSULTANT_OVERLOADED", "CONSULTANT_UNDERUTILIZED"] as const;

function filtroSinCapacity(roles: AppRole[]) {
  return hasPermission(roles, "capacity:read") ? {} : { type: { notIn: [...TIPOS_DE_CAPACITY] } };
}

export async function alertsRoutes(app: FastifyInstance) {
  // GET /api/alerts
  app.get(
    "/",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER])] },
    async (request) => {
      const query = listQuerySchema.parse(request.query);

      const alerts = await prisma.alert.findMany({
        where: {
          projectId: query.projectId,
          consultantId: query.consultantId,
          resolvedAt: query.resolved ? { not: null } : null,
          ...filtroSinCapacity(request.authUser!.roles),
        },
        include: {
          project: { select: { id: true, name: true, company: true } },
          consultant: { select: { id: true, fullName: true } },
        },
        orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
        take: 200,
      });

      return { data: alerts };
    },
  );

  // PATCH /api/alerts/:id/resolve
  app.patch(
    "/:id/resolve",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE])] },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const alert = await prisma.alert.findUnique({ where: { id } });
      if (!alert) return reply.status(404).send({ message: "Alerta no encontrada" });
      if (alert.resolvedAt) return reply.status(409).send({ message: "La alerta ya está resuelta" });

      const updated = await prisma.alert.update({
        where: { id },
        data: { resolvedAt: new Date(), resolvedBy: request.authUser!.email },
      });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.alert,
        entityId: updated.id,
        action: "UPDATE",
        changedBy: request.authUser!.email,
        before: alert as unknown as Record<string, unknown>,
        after: updated as unknown as Record<string, unknown>,
        request,
      });

      return { data: updated };
    },
  );

  // GET /api/alerts/unread-count — conteo de alertas activas (sin resolver)
  app.get(
    "/unread-count",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER])] },
    async (request) => {
      const count = await prisma.alert.count({
        where: { resolvedAt: null, ...filtroSinCapacity(request.authUser!.roles) },
      });
      return { data: { count } };
    },
  );

  // POST /api/alerts/run — ejecutar motor de alertas manualmente
  app.post(
    "/run",
    { preHandler: [authenticate, authorize([AppRole.ADMIN])] },
    async (request, reply) => {
      await runAlertEngine(prisma);
      // Las alertas que el motor crea o cierra solas NO se auditan una a una
      // (serían decenas por ejecución, sin un actor legítimo, y cada alerta ya
      // lleva su propio createdAt/resolvedAt). Sí queda constancia de QUIÉN
      // forzó una ejecución manual.
      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.alert,
        entityId: "motor-alertas",
        action: "UPDATE",
        changedBy: request.authUser!.email,
        after: { accion: "ejecución manual del motor de alertas" },
        request,
      });
      return reply.status(200).send({ message: "Motor de alertas ejecutado correctamente" });
    },
  );
}
