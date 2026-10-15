import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requirePermission } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import {
  cargarSettings,
  cargarYCalcular,
  construirInformeMensual,
  detalleAsignaciones,
  redondearCelda,
  resolverRango,
} from "./monthly.service.js";

/**
 * Informe mensual de capacity (CONTRATO §3.1 y §3.2). Solo lectura: `capacity:read`.
 * Registrado bajo `/api/capacity/monthly`, así no choca con `/api/capacity/consultant/:id`.
 */

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Se espera YYYY-MM");

const baseQuery = {
  from: monthSchema.optional(),
  to: monthSchema.optional(),
  includeProbables: z.enum(["true", "false"]).optional(),
  internal: z.enum(["include", "exclude"]).default("include"),
};

const listQuerySchema = z.object({
  ...baseQuery,
  country: z.string().trim().min(1).optional(),
  city: z.string().trim().min(1).optional(),
  company: z.string().trim().min(1).optional(),
  consultantId: z.string().min(1).optional(),
  includeAssignments: z.enum(["true", "false"]).optional(),
});

const detailQuerySchema = z.object(baseQuery);
const idSchema = z.object({ id: z.string().min(1) });

export async function monthlyCapacityRoutes(app: FastifyInstance) {
  // GET /api/capacity/monthly
  app.get(
    "/",
    { preHandler: [authenticate, requirePermission("capacity:read")] },
    async (request, reply) => {
      const query = listQuerySchema.parse(request.query);

      let data;
      try {
        data = await construirInformeMensual({
          from: query.from,
          to: query.to,
          includeProbables: query.includeProbables === undefined ? undefined : query.includeProbables === "true",
          internal: query.internal,
          country: query.country,
          city: query.city,
          company: query.company,
          consultantId: query.consultantId,
          includeAssignments: query.includeAssignments === "true",
        });
      } catch (error) {
        return reply.status(400).send({ message: (error as Error).message });
      }
      return { data };
    },
  );

  // GET /api/capacity/monthly/consultant/:id
  app.get(
    "/consultant/:id",
    { preHandler: [authenticate, requirePermission("capacity:read")] },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const query = detailQuerySchema.parse(request.query);

      let rango;
      try {
        rango = resolverRango(query.from, query.to);
      } catch (error) {
        return reply.status(400).send({ message: (error as Error).message });
      }

      const existe = await prisma.consultant.findUnique({ where: { id }, select: { id: true } });
      if (!existe) return reply.status(404).send({ message: "Consultor no encontrado" });

      const settings = await cargarSettings();
      const includeProbables =
        query.includeProbables === undefined ? settings.includeProbablesDefault : query.includeProbables === "true";

      const { consultants, assignments, result } = await cargarYCalcular({
        months: rango.months,
        includeProbables,
        internal: query.internal,
        thresholds: { underPct: settings.underThresholdPct, overPct: settings.overThresholdPct },
        consultantWhere: { id },
        sinFiltroDeActivo: true,
      });

      const c = consultants[0];
      const r = result.consultants[0];
      const desglose = new Map(r.assignments.map((b) => [b.assignmentId, b]));

      return {
        data: {
          from: rango.from,
          to: rango.to,
          includeProbables,
          internal: query.internal,
          settings: { underThresholdPct: settings.underThresholdPct, overThresholdPct: settings.overThresholdPct },
          consultant: {
            id: c.id,
            fullName: c.fullName,
            country: c.country,
            city: c.city,
            company: c.company,
            isInternal: c.isInternal,
            role: c.role,
            hireDate: c.hireDate,
            exitDate: c.exitDate,
          },
          months: r.months.map(redondearCelda),
          period: redondearCelda(r.period),
          assignments: detalleAsignaciones(assignments, desglose),
          warnings: result.warnings.map((w) =>
            w.code === "CONSULTANT_WITHOUT_COUNTRY" ? { ...w, fullName: c.fullName } : w,
          ),
        },
      };
    },
  );
}
