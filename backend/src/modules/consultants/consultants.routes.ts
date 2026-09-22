import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";
import { consultantSinDatosSensiblesSelect, puedeVerTarifas } from "../../utils/consultant-scope.js";

import { normalizeCountry } from "../../utils/country.js";

const consultantPayloadSchema = z.object({
  fullName: z.string().trim().min(1),
  email: z.string().trim().email().optional().or(z.literal("")),
  role: z.string().trim().min(1),
  company: z.string().trim().optional().nullable(),
  hourlyRate: z.coerce.number().nonnegative().optional(),
  rateCurrency: z.string().trim().toUpperCase().length(3).default("USD"),
  country: z.string().trim().optional().transform(val => val ? normalizeCountry(val) : "Default"),
  seniority: z.string().trim().optional(),
  // Documento de identidad. Se muestra en la tabla de nómina de horas extra y se
  // exporta en su CSV, pero hasta ahora no estaba en este esquema, así que no
  // había forma de rellenarlo desde la aplicación y siempre salía "No asignado".
  // Es el mismo defecto que tenían projectManagerEmail (R7) y los umbrales (R10):
  // el backend leía un campo que nadie podía escribir.
  // Cadena vacía se normaliza a null, que es como se borra.
  identification: z
    .union([z.literal(""), z.string().trim().max(40, "el documento no puede superar 40 caracteres")])
    .nullish()
    .transform((valor) => (valor === "" ? null : valor)),
  costPerMonth: z.coerce.number().nonnegative().optional(),
  active: z.coerce.boolean().default(true),
  allowWeekendWork: z.coerce.boolean().default(false),
  isInternal: z.coerce.boolean().default(true),
});

const consultantParamsSchema = z.object({ id: z.string().min(1) });

export async function consultantsRoutes(app: FastifyInstance) {
  app.get(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT, AppRole.FINANCE, AppRole.VIEWER])],
    },
    async (request) => {
      try {
        // JIT synchronization: Ensure all users with role AppRole.CONSULTANT have a Consultant record
        const consultantUsers = await prisma.user.findMany({
          where: {
            roles: {
              some: {
                role: {
                  name: AppRole.CONSULTANT,
                },
              },
            },
          },
        });

        for (const u of consultantUsers) {
          const existing = await prisma.consultant.findFirst({
            where: { email: { equals: u.email, mode: "insensitive" } },
          });

          if (!existing) {
            await prisma.consultant.create({
              data: {
                fullName: u.displayName,
                email: u.email,
                role: "Consultor",
                hourlyRate: 0,
                rateCurrency: "USD",
                country: u.country ? normalizeCountry(u.country) : "Colombia",
                active: u.active,
                allowWeekendWork: false,
              },
            });
          }
        }
      } catch (err) {
        app.log.error(err, "Failed to run JIT consultant sync");
      }

      // Alcance por campo (DEP-38): este listado es la fuente más directa de
      // tarifas de toda la plantilla. Solo ADMIN, PM y FINANCE la reciben; para
      // CONSULTANT y VIEWER se omiten `hourlyRate`, `costPerMonth` e
      // `identification` con un `select`, para que el dato no salga de la base.
      // Nota: un CONSULTANT tampoco ve aquí su propia tarifa. Es el precio de un
      // listado que devuelve a todo el mundo; hoy además ningún rol
      // `CONSULTANT` tiene el permiso `consultants:read`, así que la pantalla ni
      // se le muestra.
      const orderBy = { createdAt: "desc" } as const;

      const consultants = puedeVerTarifas(request.authUser!.roles)
        ? await prisma.consultant.findMany({ orderBy })
        : await prisma.consultant.findMany({ select: consultantSinDatosSensiblesSelect, orderBy });

      return { data: consultants };
    },
  );

  app.post(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])],
    },
    async (request, reply) => {
    const payload = consultantPayloadSchema.parse(request.body);

    const consultant = await prisma.consultant.create({
      data: {
        fullName: payload.fullName,
        email: payload.email || null,
        role: payload.role,
        company: payload.company || null,
        hourlyRate: payload.hourlyRate,
        rateCurrency: payload.rateCurrency,
        country: payload.country,
        seniority: payload.seniority,
        identification: payload.identification,
        costPerMonth: payload.costPerMonth,
        active: payload.active,
        allowWeekendWork: payload.allowWeekendWork,
        isInternal: payload.isInternal,
      },
    });

    // El `after` incluye `hourlyRate` y `costPerMonth` a propósito: la tarifa es
    // justamente el dato que se quiere poder auditar, porque cambia todos los
    // costos calculados del portafolio. `GET /api/audit` ya está restringido a
    // ADMIN / FINANCE / PM, los mismos roles que pueden ver tarifas en el
    // listado de consultores, así que no se abre ninguna vía nueva de fuga.
    await writeAudit(prisma, {
      entity: AUDIT_ENTITIES.consultant,
      entityId: consultant.id,
      action: "CREATE",
      changedBy: request.authUser!.email,
      after: consultant as unknown as Record<string, unknown>,
      request,
    });

      return reply.status(201).send({ data: consultant });
    },
  );

  app.put(
    "/:id",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])],
    },
    async (request, reply) => {
    const { id } = consultantParamsSchema.parse(request.params);
    const payload = consultantPayloadSchema.parse(request.body);

    const existing = await prisma.consultant.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ message: "Consultant not found" });
    }

    const consultant = await prisma.consultant.update({
      where: { id },
      data: {
        fullName: payload.fullName,
        email: payload.email || null,
        role: payload.role,
        company: payload.company || null,
        hourlyRate: payload.hourlyRate,
        rateCurrency: payload.rateCurrency,
        country: payload.country,
        seniority: payload.seniority,
        identification: payload.identification,
        costPerMonth: payload.costPerMonth,
        active: payload.active,
        allowWeekendWork: payload.allowWeekendWork,
        isInternal: payload.isInternal,
      },
    });

    // Igual que en la creación: el `diff` deja ver el cambio de tarifa, que es
    // el motivo principal para auditar este endpoint.
    await writeAudit(prisma, {
      entity: AUDIT_ENTITIES.consultant,
      entityId: consultant.id,
      action: "UPDATE",
      changedBy: request.authUser!.email,
      before: existing as unknown as Record<string, unknown>,
      after: consultant as unknown as Record<string, unknown>,
      request,
    });

      return { data: consultant };
    },
  );

  app.delete(
    "/:id",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN])],
    },
    async (request, reply) => {
      const { id } = consultantParamsSchema.parse(request.params);

      const existing = await prisma.consultant.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({ message: "Consultant not found" });
      }

      // Pre-check RESTRICT relations (TimeEntry, Forecast, Assignment)
      const [linkedTimeEntries, linkedForecasts, linkedAssignments] = await Promise.all([
        prisma.timeEntry.count({ where: { consultantId: id } }),
        prisma.forecast.count({ where: { consultantId: id } }),
        prisma.assignment.count({ where: { consultantId: id } }),
      ]);

      if (linkedTimeEntries > 0 || linkedForecasts > 0 || linkedAssignments > 0) {
        const parts: string[] = [];
        if (linkedTimeEntries > 0) parts.push(`${linkedTimeEntries} registro(s) de horas`);
        if (linkedForecasts > 0) parts.push(`${linkedForecasts} forecast(s)`);
        if (linkedAssignments > 0) parts.push(`${linkedAssignments} asignación(es)`);
        return reply
          .status(409)
          .send({ message: `No se puede eliminar el consultor porque tiene: ${parts.join(", ")}` });
      }

      try {
        // Explicitly delete CASCADE children in a transaction to avoid any edge-case issues
        await prisma.$transaction([
          prisma.alert.deleteMany({ where: { consultantId: id } }),
          prisma.consultantBlock.deleteMany({ where: { consultantId: id } }),
          prisma.capacityConfig.deleteMany({ where: { consultantId: id } }),
          prisma.consultant.delete({ where: { id } }),
        ]);

        await writeAudit(prisma, {
          entity: AUDIT_ENTITIES.consultant,
          entityId: id,
          action: "DELETE",
          changedBy: request.authUser!.email,
          before: existing as unknown as Record<string, unknown>,
          request,
        });

        return reply.status(204).send();
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "P2003" || code === "P2014") {
          return reply.status(409).send({ message: "No se puede eliminar el consultor: tiene registros relacionados" });
        }
        return reply.status(500).send({
          message: "Error interno del servidor al eliminar consultor",
          detail: err instanceof Error ? err.message : String(err),
          code
        });
      }
    },
  );

  app.delete(
    "/by-name",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN])],
    },
    async (request, reply) => {
      const { name } = z.object({ name: z.string().trim().min(1) }).parse(request.query);

      const existing = await prisma.consultant.findFirst({
        where: { fullName: { equals: name, mode: "insensitive" } },
      });
      if (!existing) {
        return reply.status(404).send({ message: "Consultor no encontrado" });
      }

      const { id } = existing;

      // Pre-check RESTRICT relations (TimeEntry, Forecast, Assignment)
      const [linkedTimeEntries, linkedForecasts, linkedAssignments] = await Promise.all([
        prisma.timeEntry.count({ where: { consultantId: id } }),
        prisma.forecast.count({ where: { consultantId: id } }),
        prisma.assignment.count({ where: { consultantId: id } }),
      ]);

      if (linkedTimeEntries > 0 || linkedForecasts > 0 || linkedAssignments > 0) {
        const parts: string[] = [];
        if (linkedTimeEntries > 0) parts.push(`${linkedTimeEntries} registro(s) de horas`);
        if (linkedForecasts > 0) parts.push(`${linkedForecasts} forecast(s)`);
        if (linkedAssignments > 0) parts.push(`${linkedAssignments} asignación(es)`);
        return reply
          .status(409)
          .send({ message: `No se puede eliminar el consultor porque tiene: ${parts.join(", ")}` });
      }

      try {
        // Explicitly delete CASCADE children in a transaction to avoid any edge-case issues
        await prisma.$transaction([
          prisma.alert.deleteMany({ where: { consultantId: id } }),
          prisma.consultantBlock.deleteMany({ where: { consultantId: id } }),
          prisma.capacityConfig.deleteMany({ where: { consultantId: id } }),
          prisma.consultant.delete({ where: { id } }),
        ]);

        await writeAudit(prisma, {
          entity: AUDIT_ENTITIES.consultant,
          entityId: id,
          action: "DELETE",
          changedBy: request.authUser!.email,
          before: existing as unknown as Record<string, unknown>,
          request,
        });

        return reply.status(204).send();
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "P2003" || code === "P2014") {
          return reply.status(409).send({ message: "No se puede eliminar el consultor: tiene registros relacionados" });
        }
        return reply.status(500).send({
          message: "Error interno del servidor al eliminar consultor por nombre",
          detail: err instanceof Error ? err.message : String(err),
          code
        });
      }
    },
  );
}
