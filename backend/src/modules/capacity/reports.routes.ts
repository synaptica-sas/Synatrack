import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requirePermission } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";
import { cargarSettings, construirInformeMensual } from "./monthly.service.js";

/**
 * Reporte oficial de capacity (CONTRATO §5.2). Un reporte publicado es inmutable: no hay PUT ni
 * DELETE, solo se puede anular (`revoke`). El payload lo calcula el servidor con la misma función
 * que `GET /api/capacity/monthly?includeAssignments=true`; nunca llega del cliente.
 *
 * Confidencialidad: el payload no contiene tarifas ni costos (el cálculo de capacity no los
 * maneja), porque lo leen PM, FINANCE y COMMERCIAL con solo `capacity:read`.
 */

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Se espera YYYY-MM");

const publishSchema = z.object({
  title: z.string().trim().min(3).max(150),
  note: z.string().trim().max(1000).optional(),
  from: monthSchema,
  to: monthSchema,
  includeProbables: z.boolean(),
  internal: z.enum(["include", "exclude"]).default("include"),
  country: z.string().trim().min(1).optional(),
  city: z.string().trim().min(1).optional(),
  company: z.string().trim().min(1).optional(),
});

const revokeSchema = z.object({ reason: z.string().trim().min(5).max(500) });
const idSchema = z.object({ id: z.string().min(1) });
const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

/** Campos de la lista y de la ficha, sin `payload` (el payload solo sale en el detalle). */
const SELECT_RESUMEN = {
  id: true,
  title: true,
  note: true,
  fromMonth: true,
  toMonth: true,
  includeProbables: true,
  internal: true,
  filters: true,
  settings: true,
  publishedBy: true,
  publishedAt: true,
  revokedAt: true,
  revokedBy: true,
  revokeReason: true,
} as const;

export async function capacityReportsRoutes(app: FastifyInstance) {
  // POST /api/capacity/reports
  app.post(
    "/",
    { preHandler: [authenticate, requirePermission("capacity:publish")] },
    async (request, reply) => {
      const body = publishSchema.parse(request.body);
      const usuario = request.authUser!.email;

      let payload;
      try {
        payload = await construirInformeMensual({
          from: body.from,
          to: body.to,
          includeProbables: body.includeProbables,
          internal: body.internal,
          country: body.country,
          city: body.city,
          company: body.company,
          includeAssignments: true,
        });
      } catch (error) {
        return reply.status(400).send({ message: (error as Error).message });
      }

      const settings = await cargarSettings();
      const filters = { country: body.country, city: body.city, company: body.company };

      const row = await prisma.capacityReport.create({
        data: {
          title: body.title,
          note: body.note || null,
          fromMonth: payload.from,
          toMonth: payload.to,
          includeProbables: body.includeProbables,
          internal: body.internal,
          filters: JSON.parse(JSON.stringify(filters)),
          settings: {
            underThresholdPct: settings.underThresholdPct,
            overThresholdPct: settings.overThresholdPct,
            includeProbablesDefault: settings.includeProbablesDefault,
          },
          payload: JSON.parse(JSON.stringify(payload)),
          publishedBy: usuario,
        },
      });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.capacityReport,
        entityId: row.id,
        action: "CREATE",
        changedBy: usuario,
        // El payload no se duplica en la bitácora: basta con el resumen.
        after: {
          title: row.title,
          fromMonth: row.fromMonth,
          toMonth: row.toMonth,
          includeProbables: row.includeProbables,
          internal: row.internal,
          filters,
        },
        request,
      });

      return reply.status(201).send({ data: row });
    },
  );

  // GET /api/capacity/reports
  app.get(
    "/",
    { preHandler: [authenticate, requirePermission("capacity:read")] },
    async (request) => {
      const query = listQuerySchema.parse(request.query);
      const [rows, total] = await Promise.all([
        prisma.capacityReport.findMany({
          select: SELECT_RESUMEN,
          orderBy: { publishedAt: "desc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        prisma.capacityReport.count(),
      ]);
      return {
        data: rows,
        meta: {
          total,
          page: query.page,
          pageSize: query.pageSize,
          totalPages: Math.ceil(total / query.pageSize),
        },
      };
    },
  );

  // GET /api/capacity/reports/:id
  app.get(
    "/:id",
    { preHandler: [authenticate, requirePermission("capacity:read")] },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const row = await prisma.capacityReport.findUnique({ where: { id } });
      if (!row) return reply.status(404).send({ message: "Reporte no encontrado" });
      return { data: row };
    },
  );

  // POST /api/capacity/reports/:id/revoke
  app.post(
    "/:id/revoke",
    { preHandler: [authenticate, requirePermission("capacity:publish")] },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const { reason } = revokeSchema.parse(request.body);
      const usuario = request.authUser!.email;

      const actual = await prisma.capacityReport.findUnique({ where: { id }, select: SELECT_RESUMEN });
      if (!actual) return reply.status(404).send({ message: "Reporte no encontrado" });
      if (actual.revokedAt) return reply.status(409).send({ message: "El reporte ya está anulado" });

      // `updateMany` condicionado a `revokedAt: null` evita que dos anulaciones simultáneas pasen las dos.
      const { count } = await prisma.capacityReport.updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt: new Date(), revokedBy: usuario, revokeReason: reason },
      });
      if (count === 0) return reply.status(409).send({ message: "El reporte ya está anulado" });

      const row = await prisma.capacityReport.findUniqueOrThrow({ where: { id } });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.capacityReport,
        entityId: id,
        action: "CANCEL",
        changedBy: usuario,
        before: { revokedAt: null },
        after: { revokedAt: row.revokedAt, revokedBy: usuario, revokeReason: reason },
        request,
      });

      return { data: row };
    },
  );
}
