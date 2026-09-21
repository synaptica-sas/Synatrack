import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { writeAudit } from "../../utils/audit.js";
import { buildRateMap } from "../../utils/currency.js";
import { calculateProfitability } from "../../utils/financial.js";

/**
 * Correo del Project Manager del proyecto (DEP-37).
 *
 * Es **opcional y nulable**: un proyecto sin PM asignado sigue siendo válido, y
 * así estaban todos los que existían antes de este cambio.
 *
 * - `""` (lo que manda un formulario con el campo vacío) se normaliza a `null`,
 *   que es como se desasigna el PM.
 * - `undefined` (el campo no viene en la petición) se deja pasar tal cual: en el
 *   `PUT` significa "no tocar", igual que hace `description`.
 * - El valor se guarda en **minúsculas** porque todas las comparaciones del
 *   backend (`getExtraHourAuthLevel`, el alcance por rol de `time-entries`,
 *   `extra-hours` y `activities`) usan `toLowerCase()` contra el correo del token.
 */
const projectManagerEmailSchema = z
  .union([
    z.literal(""),
    z.string().trim().toLowerCase().email("projectManagerEmail debe ser un correo válido"),
  ])
  .nullish()
  .transform((valor) => (valor === "" ? null : valor));

const projectPayloadSchema = z.object({
  name: z.string().trim().min(1),
  company: z.string().trim().min(1),
  country: z.string().trim().min(1),
  currency: z
    .string()
    .trim()
    .length(3, "currency must be a 3-letter ISO code")
    .transform((value) => value.toUpperCase()),
  budget: z.coerce.number().nonnegative(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  description: z.string().trim().optional(),
  projectType: z.enum(["FIXED_PRICE", "TIME_AND_MATERIAL", "STAFFING"]).default("TIME_AND_MATERIAL"),
  status: z.enum(["ACTIVE", "PAUSED", "CLOSED"]).default("ACTIVE"),
  sellPrice: z.coerce.number().positive().optional(),
  sellCurrency: z.string().trim().toUpperCase().length(3).default("USD"),
  projectManagerEmail: projectManagerEmailSchema,
});

const listProjectsQuerySchema = z.object({
  company: z.string().trim().optional(),
  country: z.string().trim().optional(),
  search: z.string().trim().optional(),
});

const projectParamsSchema = z.object({ id: z.string().min(1) });

function ensureDateRange(startDate: Date, endDate: Date) {
  if (endDate < startDate) {
    throw new Error("endDate cannot be before startDate");
  }
}

export async function projectsRoutes(app: FastifyInstance) {
  app.get(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT, AppRole.FINANCE, AppRole.VIEWER])],
    },
    async (request) => {
    const query = listProjectsQuerySchema.parse(request.query);

    const projects = await prisma.project.findMany({
      where: {
        company: query.company ? { equals: query.company, mode: "insensitive" } : undefined,
        country: query.country ? { equals: query.country, mode: "insensitive" } : undefined,
        OR: query.search
          ? [
              { name: { contains: query.search, mode: "insensitive" } },
              { company: { contains: query.search, mode: "insensitive" } },
            ]
          : undefined,
      },
      orderBy: { createdAt: "desc" },
    });

      return { data: projects };
    },
  );

  app.post(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])],
    },
    async (request, reply) => {
    const body = projectPayloadSchema.parse(request.body);

    try {
      ensureDateRange(body.startDate, body.endDate);
    } catch (error) {
      return reply.status(400).send({ message: (error as Error).message });
    }

    const project = await prisma.project.create({
      data: {
        name: body.name,
        company: body.company,
        country: body.country,
        currency: body.currency,
        budget: body.budget,
        startDate: body.startDate,
        endDate: body.endDate,
        description: body.description,
        projectType: body.projectType,
        status: body.status,
        sellPrice: body.sellPrice,
        sellCurrency: body.sellCurrency,
        projectManagerEmail: body.projectManagerEmail,
      },
    });

    await writeAudit(prisma, {
      entity: "Project",
      entityId: project.id,
      action: "CREATE",
      changedBy: request.authUser?.email ?? "system",
      after: project as unknown as Record<string, unknown>,
      request,
    });

      return reply.status(201).send({ data: project });
    },
  );

  app.get(
    "/:id",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT, AppRole.FINANCE, AppRole.VIEWER])],
    },
    async (request, reply) => {
    const { id } = projectParamsSchema.parse(request.params);

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      return reply.status(404).send({ message: "Project not found" });
    }

      return { data: project };
    },
  );

  app.put(
    "/:id",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])],
    },
    async (request, reply) => {
    const { id } = projectParamsSchema.parse(request.params);
    const body = projectPayloadSchema.parse(request.body);

    try {
      ensureDateRange(body.startDate, body.endDate);
    } catch (error) {
      return reply.status(400).send({ message: (error as Error).message });
    }

    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ message: "Project not found" });
    }

    const project = await prisma.project.update({
      where: { id },
      data: {
        name: body.name,
        company: body.company,
        country: body.country,
        currency: body.currency,
        budget: body.budget,
        startDate: body.startDate,
        endDate: body.endDate,
        description: body.description,
        projectType: body.projectType,
        status: body.status,
        sellPrice: body.sellPrice,
        sellCurrency: body.sellCurrency,
        projectManagerEmail: body.projectManagerEmail,
      },
    });

    await writeAudit(prisma, {
      entity: "Project",
      entityId: project.id,
      action: "UPDATE",
      changedBy: request.authUser?.email ?? "system",
      before: existing as unknown as Record<string, unknown>,
      after: project as unknown as Record<string, unknown>,
      request,
    });

      return { data: project };
    },
  );

  app.delete(
    "/:id",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])],
    },
    async (request, reply) => {
    const { id } = projectParamsSchema.parse(request.params);

    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ message: "Project not found" });
    }

    try {
      await prisma.project.delete({ where: { id } });
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === "P2003" || code === "P2014") {
        return reply.status(409).send({
          message: "Cannot delete project: it has related records that prevent deletion",
        });
      }
      throw err;
    }

    await writeAudit(prisma, {
      entity: "Project",
      entityId: id,
      action: "DELETE",
      changedBy: request.authUser?.email ?? "system",
      before: existing as unknown as Record<string, unknown>,
      request,
    });

      return reply.status(204).send();
    },
  );

  // GET /api/projects/:id/profitability
  app.get(
    "/:id/profitability",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER])],
    },
    async (request, reply) => {
      const { id } = projectParamsSchema.parse(request.params);
      const { baseCurrency: qBase } = z.object({ baseCurrency: z.string().trim().toUpperCase().length(3).optional() }).parse(request.query);

      const project = await prisma.project.findUnique({
        where: { id },
        include: {
          timeEntries: {
            where: { status: "APPROVED" },
            include: { consultant: { select: { hourlyRate: true, rateCurrency: true } } },
          },
          expenses: true,
          forecasts: {
            include: { consultant: { select: { hourlyRate: true, rateCurrency: true } } },
          },
          revenueEntries: true,
        },
      });

      if (!project) return reply.status(404).send({ message: "Project not found" });

      const fxConfigs = await prisma.fxConfig.findMany();
      const baseCurrency = qBase ?? fxConfigs[0]?.baseCode ?? "USD";
      const rateMap = buildRateMap(fxConfigs);

      const profitability = calculateProfitability({
        budget: Number(project.budget),
        budgetCurrency: project.currency,
        sellPrice: project.sellPrice ? Number(project.sellPrice) : null,
        sellCurrency: project.sellCurrency,
        revenueEntries: project.revenueEntries.map((r) => ({ amount: Number(r.amount), currency: r.currency })),
        approvedTimeEntries: project.timeEntries.map((e) => ({
          consultantId: e.consultantId,
          hours: Number(e.hours),
          workDate: e.workDate,
          status: "APPROVED" as const,
          hourlyRate: e.consultant.hourlyRate ? Number(e.consultant.hourlyRate) : null,
          rateCurrency: e.consultant.rateCurrency,
        })),
        expenses: project.expenses.map((e) => ({ amount: Number(e.amount), currency: e.currency })),
        forecasts: project.forecasts.map((f) => ({
          consultantId: f.consultantId,
          hoursProjected: Number(f.hoursProjected),
          hourlyRate: f.hourlyRate ? Number(f.hourlyRate) : null,
          sellRate: f.sellRate ? Number(f.sellRate) : null,
          currency: f.currency,
          startDate: f.startDate,
          endDate: f.endDate,
          consultant: {
            hourlyRate: f.consultant.hourlyRate ? Number(f.consultant.hourlyRate) : null,
            rateCurrency: f.consultant.rateCurrency,
          },
        })),
        fxConfigs: Array.from(rateMap.entries()).map(([key, rate]) => {
          const [baseCode, quoteCode] = key.split("_");
          return { baseCode, quoteCode, rate };
        }),
        baseCurrency,
      });

      return {
        data: {
          projectId: project.id,
          projectName: project.name,
          projectType: project.projectType,
          currency: project.currency,
          baseCurrency,
          ...profitability,
        },
      };
    },
  );
}
