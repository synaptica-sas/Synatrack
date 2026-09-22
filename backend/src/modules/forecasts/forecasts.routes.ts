import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";
const isoDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "date must use format YYYY-MM-DD");

const forecastPayloadSchema = z.object({
  projectId: z.string().min(1),
  consultantId: z.string().min(1),
  startDate: isoDate,
  endDate: isoDate,
  hoursProjected: z.coerce.number().positive(),
  hourlyRate: z.coerce.number().nonnegative().optional(),
  sellRate: z.coerce.number().nonnegative().optional(),
  currency: z.string().trim().toUpperCase().length(3).default("USD"),
  note: z.string().trim().optional(),
}).refine((d) => d.startDate <= d.endDate, { message: "startDate must be before or equal to endDate" });

const idParamsSchema = z.object({ id: z.string().min(1) });

export async function forecastsRoutes(app: FastifyInstance) {
  app.get(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER])],
    },
    async () => {
    const forecasts = await prisma.forecast.findMany({
      include: {
        project: true,
        consultant: true,
      },
      orderBy: { createdAt: "desc" },
    });

    // Batch: approved hours per (project, consultant, period)
    const approvedEntries = await prisma.timeEntry.findMany({
      where: {
        status: "APPROVED",
        projectId: { in: [...new Set(forecasts.map((f) => f.projectId))] },
      },
      select: { projectId: true, consultantId: true, workDate: true, hours: true },
    });

    const data = forecasts.map((item) => {
      const effectiveRate = Number(item.hourlyRate ?? item.consultant.hourlyRate ?? 0);
      const sellRate = item.sellRate ? Number(item.sellRate) : 0;
      const hoursProjected = Number(item.hoursProjected);
      const projectedCost = hoursProjected * effectiveRate;

      // Horas aprobadas en el rango exacto de este forecast
      const rangeStart = new Date(item.startDate + "T00:00:00Z");
      const rangeEnd   = new Date(item.endDate   + "T23:59:59Z");
      const approvedHours = approvedEntries
        .filter(
          (e) =>
            e.projectId === item.projectId &&
            e.consultantId === item.consultantId &&
            e.workDate >= rangeStart &&
            e.workDate <= rangeEnd,
        )
        .reduce((s, e) => s + Number(e.hours), 0);

      const adjustedHoursProjected = Math.max(hoursProjected - approvedHours, 0);
      const adjustedProjectedCost = adjustedHoursProjected * effectiveRate;
      const adjustedProjectedRevenue = adjustedHoursProjected * sellRate;
      const executionPct = hoursProjected > 0 ? Math.round((approvedHours / hoursProjected) * 1000) / 10 : 0;

      return {
        ...item,
        projectedCost,
        approvedHours: Math.round(approvedHours * 100) / 100,
        adjustedHoursProjected: Math.round(adjustedHoursProjected * 100) / 100,
        adjustedProjectedCost: Math.round(adjustedProjectedCost * 100) / 100,
        adjustedProjectedRevenue: Math.round(adjustedProjectedRevenue * 100) / 100,
        executionPct,
      };
    });

      return { data };
    },
  );

  app.post(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])],
    },
    async (request, reply) => {
    const payload = forecastPayloadSchema.parse(request.body);

    const [project, consultant] = await Promise.all([
      prisma.project.findUnique({ where: { id: payload.projectId } }),
      prisma.consultant.findUnique({ where: { id: payload.consultantId } }),
    ]);

    if (!project) {
      return reply.status(400).send({ message: "Invalid projectId" });
    }

    if (!consultant) {
      return reply.status(400).send({ message: "Invalid consultantId" });
    }

    const forecast = await prisma.forecast.create({
      data: payload,
    });

    await writeAudit(prisma, {
      entity: AUDIT_ENTITIES.forecast,
      entityId: forecast.id,
      action: "CREATE",
      changedBy: request.authUser?.email ?? "system",
      after: forecast as unknown as Record<string, unknown>,
      request,
    });

      return reply.status(201).send({ data: forecast });
    },
  );

  app.put(
    "/:id",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])],
    },
    async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const payload = forecastPayloadSchema.parse(request.body);

    const existing = await prisma.forecast.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ message: "Forecast not found" });
    }

    const [project, consultant] = await Promise.all([
      prisma.project.findUnique({ where: { id: payload.projectId } }),
      prisma.consultant.findUnique({ where: { id: payload.consultantId } }),
    ]);

    if (!project) {
      return reply.status(400).send({ message: "Invalid projectId" });
    }

    if (!consultant) {
      return reply.status(400).send({ message: "Invalid consultantId" });
    }

    const forecast = await prisma.forecast.update({
      where: { id },
      data: payload,
    });

    await writeAudit(prisma, {
      entity: AUDIT_ENTITIES.forecast,
      entityId: forecast.id,
      action: "UPDATE",
      changedBy: request.authUser?.email ?? "system",
      before: existing as unknown as Record<string, unknown>,
      after: forecast as unknown as Record<string, unknown>,
      request,
    });

      return { data: forecast };
    },
  );

  app.delete(
    "/:id",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])],
    },
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);

      const existing = await prisma.forecast.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({ message: "Forecast not found" });
      }

      try {
        await prisma.forecast.delete({ where: { id } });
        return reply.status(204).send();
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "P2003" || code === "P2014") {
          return reply.status(409).send({ message: "No se puede eliminar el forecast: tiene registros relacionados" });
        }
        throw err;
      }
    },
  );
}
