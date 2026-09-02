import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { env } from "../../config/env.js";
import { prisma } from "../../infra/prisma.js";
import { runFxSync } from "./fx-sync.service.js";

const fxPayloadSchema = z
  .object({
    baseCode: z.string().trim().toUpperCase().length(3),
    quoteCode: z.string().trim().toUpperCase().length(3),
    rate: z.coerce.number().positive(),
  })
  .refine((data) => data.baseCode !== data.quoteCode, {
    message: "baseCode y quoteCode deben ser monedas diferentes",
  });

const fxHistoryQuerySchema = z.object({
  baseCode: z.string().trim().toUpperCase().length(3).optional(),
  quoteCode: z.string().trim().toUpperCase().length(3).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const idParamsSchema = z.object({ id: z.string().min(1) });

export async function fxRoutes(app: FastifyInstance) {
  // GET /api/fx — lista todos los pares de tasas actuales
  app.get(
    "/",
    {
      preHandler: [
        authenticate,
        authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER, AppRole.CONSULTANT]),
      ],
    },
    async () => {
      const configs = await prisma.fxConfig.findMany({
        orderBy: [{ baseCode: "asc" }, { quoteCode: "asc" }],
      });
      return { data: configs };
    },
  );

  // PUT /api/fx — crea o actualiza la tasa para un par y guarda en historial
  app.put(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.FINANCE])],
    },
    async (request, reply) => {
      const payload = fxPayloadSchema.parse(request.body);
      const performedBy = request.authUser?.email ?? "system";

      const existing = await prisma.fxConfig.findFirst({
        where: { baseCode: payload.baseCode, quoteCode: payload.quoteCode },
      });

      // Transacción: actualizar config actual + escribir en historial
      const [config] = await prisma.$transaction([
        existing
          ? prisma.fxConfig.update({ where: { id: existing.id }, data: { rate: payload.rate } })
          : prisma.fxConfig.create({
              data: { baseCode: payload.baseCode, quoteCode: payload.quoteCode, rate: payload.rate },
            }),
        prisma.fxRateHistory.create({
          data: {
            baseCode: payload.baseCode,
            quoteCode: payload.quoteCode,
            rate: payload.rate,
            effectiveDate: new Date(),
            rateType: "SPOT",
            source: "manual",
            createdBy: performedBy,
          },
        }),
      ]);

      return existing
        ? { data: config }
        : reply.status(201).send({ data: config });
    },
  );

  // DELETE /api/fx/:id — elimina un par de tasas
  app.delete(
    "/:id",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.FINANCE])],
    },
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);

      const existing = await prisma.fxConfig.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({ message: "Tasa de cambio no encontrada" });
      }

      try {
        await prisma.fxConfig.delete({ where: { id } });
        return reply.status(204).send();
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "P2003" || code === "P2014") {
          return reply.status(409).send({ message: "No se puede eliminar la tasa de cambio: tiene registros relacionados" });
        }
        throw err;
      }
    },
  );

  // GET /api/fx/history — historial de tasas con filtros
  app.get(
    "/history",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.FINANCE, AppRole.VIEWER])],
    },
    async (request) => {
      const query = fxHistoryQuerySchema.parse(request.query);

      const history = await prisma.fxRateHistory.findMany({
        where: {
          baseCode: query.baseCode,
          quoteCode: query.quoteCode,
          effectiveDate: {
            gte: query.from,
            lte: query.to,
          },
        },
        orderBy: { effectiveDate: "desc" },
        take: 200,
      });

      return { data: history };
    },
  );

  // GET /api/fx/rate?from=COP&to=USD&date=2026-03-01 — tasa para fecha específica
  app.get(
    "/rate",
    {
      preHandler: [
        authenticate,
        authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER, AppRole.CONSULTANT]),
      ],
    },
    async (request, reply) => {
      const { from, to, date } = z
        .object({
          from: z.string().trim().toUpperCase().length(3),
          to: z.string().trim().toUpperCase().length(3),
          date: z.coerce.date().optional(),
        })
        .parse(request.query);

      const targetDate = date ?? new Date();

      // Tasa histórica más reciente <= fecha solicitada
      const historical = await prisma.fxRateHistory.findFirst({
        where: {
          baseCode: from,
          quoteCode: to,
          effectiveDate: { lte: targetDate },
        },
        orderBy: { effectiveDate: "desc" },
      });

      if (historical) {
        return { data: { ...historical, source: "history" } };
      }

      // Fallback: tasa actual
      const current = await prisma.fxConfig.findFirst({ where: { baseCode: from, quoteCode: to } });
      if (current) {
        return { data: { ...current, source: "current" } };
      }

      return reply.status(404).send({ message: `No se encontró tasa para ${from}/${to}` });
    },
  );

  // POST /api/fx/sync — sincroniza tasas desde exchangerate-api.com
  // Acepta dos formas de acceso:
  //  1) Token compartido (header Authorization: Bearer <FX_SYNC_TOKEN>) — para
  //     el Render Cron Job, que no tiene una sesión de usuario.
  //  2) Sesión de usuario normal con rol ADMIN/FINANCE — para el botón
  //     "Actualizar ahora" del frontend.
  app.post("/sync", async (request, reply) => {
    const authHeader = request.headers.authorization;
    const bearerToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : null;
    const isSystemToken = Boolean(env.FX_SYNC_TOKEN) && bearerToken === env.FX_SYNC_TOKEN;

    if (!isSystemToken) {
      await authenticate(request, reply);
      if (reply.sent) return;
      await authorize([AppRole.ADMIN, AppRole.FINANCE])(request, reply);
      if (reply.sent) return;
    }

    try {
      const result = await runFxSync(prisma);
      return { data: result };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return reply.status(502).send({ message: "No se pudo sincronizar con el proveedor de tasas de cambio", detail });
    }
  });
}
