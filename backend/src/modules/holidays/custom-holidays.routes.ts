import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requirePermission } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";

import { normalizeCountry } from "../../utils/country.js";

const customHolidayPayloadSchema = z.object({
  name: z.string().trim().min(1),
  date: z.coerce.date(),
  country: z.string().trim().default("All").transform((val) => {
    if (val.toLowerCase() === "all") return "All";
    return normalizeCountry(val);
  }),
});

const paramsSchema = z.object({ id: z.string().min(1) });

export async function customHolidaysRoutes(app: FastifyInstance) {
  // 1. Obtener todos los feriados especiales
  app.get(
    "/",
    {
      preHandler: [authenticate, requirePermission("holidays:read")],
    },
    async () => {
      const holidays = await prisma.customHoliday.findMany({
        orderBy: { date: "asc" },
      });
      return { data: holidays };
    },
  );

  // 2. Crear un nuevo feriado especial de la empresa (solo ADMIN: mueve la capacidad de todos)
  app.post(
    "/",
    {
      preHandler: [authenticate, requirePermission("holidays:write")],
    },
    async (request, reply) => {
      const payload = customHolidayPayloadSchema.parse(request.body);

      // Normalizar fecha a medianoche UTC
      const dateOnly = new Date(Date.UTC(payload.date.getUTCFullYear(), payload.date.getUTCMonth(), payload.date.getUTCDate()));

      const existing = await prisma.customHoliday.findUnique({
        where: {
          date_country: {
            date: dateOnly,
            country: payload.country,
          },
        },
      });

      if (existing) {
        return reply.status(409).send({ message: "Ya existe un feriado registrado para esta fecha y país." });
      }

      const holiday = await prisma.customHoliday.create({
        data: {
          name: payload.name,
          date: dateOnly,
          country: payload.country,
        },
      });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.customHoliday,
        entityId: holiday.id,
        action: "CREATE",
        changedBy: request.authUser!.email,
        after: holiday as unknown as Record<string, unknown>,
        request,
      });

      return reply.status(201).send({ data: holiday });
    },
  );

  // 3. Eliminar un feriado especial de la empresa
  app.delete(
    "/:id",
    {
      preHandler: [authenticate, requirePermission("holidays:write")],
    },
    async (request, reply) => {
      const { id } = paramsSchema.parse(request.params);

      const existing = await prisma.customHoliday.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({ message: "Feriado no encontrado." });
      }

      await prisma.customHoliday.delete({ where: { id } });
      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.customHoliday,
        entityId: id,
        action: "DELETE",
        changedBy: request.authUser!.email,
        before: existing as unknown as Record<string, unknown>,
        request,
      });
      return reply.status(204).send();
    },
  );
}
