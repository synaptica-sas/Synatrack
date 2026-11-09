import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize, requirePermission } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";
import { buildAlertWhere, canResolveAlert, loadAudienceUser } from "./alert-audience.js";
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
 * Las alertas se filtran por destinatario (ver `alert-audience.ts`): el mismo
 * `where` alimenta el listado y el contador, y resolver exige ver la alerta y
 * que el rol pueda resolverla.
 */
export async function alertsRoutes(app: FastifyInstance) {
  // GET /api/alerts
  app.get("/", { preHandler: [authenticate, requirePermission("alerts:read")] }, async (request) => {
    const query = listQuerySchema.parse(request.query);
    const audiencia = await loadAudienceUser(request.authUser!);

    const alerts = await prisma.alert.findMany({
      where: {
        AND: [
          {
            projectId: query.projectId,
            consultantId: query.consultantId,
            resolvedAt: query.resolved ? { not: null } : null,
          },
          buildAlertWhere(audiencia),
        ],
      },
      include: {
        project: { select: { id: true, name: true, company: { select: { id: true, name: true } } } },
        consultant: { select: { id: true, fullName: true } },
      },
      orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
      take: 200,
    });

    return { data: alerts.map((a) => ({ ...a, canResolve: canResolveAlert(audiencia, a) })) };
  });

  // PATCH /api/alerts/:id/resolve
  app.patch(
    "/:id/resolve",
    { preHandler: [authenticate, requirePermission("alerts:resolve")] },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);

      // Una alerta que el usuario no ve responde 404, igual que una inexistente:
      // no se revela que existe.
      const audiencia = await loadAudienceUser(request.authUser!);
      const alert = await prisma.alert.findFirst({ where: { AND: [{ id }, buildAlertWhere(audiencia)] } });
      if (!alert) return reply.status(404).send({ message: "Alerta no encontrada" });
      if (!canResolveAlert(audiencia, alert)) {
        return reply.status(403).send({ message: "No tienes permiso para resolver esta alerta" });
      }
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

  // GET /api/alerts/unread-count — conteo de alertas activas (sin resolver) que el usuario ve
  app.get("/unread-count", { preHandler: [authenticate, requirePermission("alerts:read")] }, async (request) => {
    const audiencia = await loadAudienceUser(request.authUser!);
    const count = await prisma.alert.count({
      where: { AND: [{ resolvedAt: null }, buildAlertWhere(audiencia)] },
    });
    return { data: { count } };
  });

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
