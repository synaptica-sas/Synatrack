import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";
import { resolverCategoriaActiva } from "../financial-categories/financial-categories.routes.js";

const revenuePayloadSchema = z.object({
  projectId: z.string().min(1),
  entryDate: z.coerce.date(),
  amount: z.coerce.number().positive(),
  currency: z.string().trim().toUpperCase().length(3),
  // Categoría del ingreso (decisión de negocio D-4). Es **opcional** a
  // propósito: los ingresos registrados antes de D-4 no tienen ninguna, y
  // obligar aquí rompería la edición de cualquiera de ellos. Quien la manda,
  // la manda válida: se comprueba contra el catálogo activo más abajo.
  category: z.string().trim().min(1).max(60).nullish(),
  description: z.string().trim().optional(),
});

const idParamsSchema = z.object({ id: z.string().min(1) });
const projectIdParamsSchema = z.object({ projectId: z.string().min(1) });

// FinancialEntry -> forma pública de RevenueEntry: oculta solo el discriminador
// `type`. Hasta D-4 ocultaba también `category`, porque se daba por hecho que
// esa columna era exclusiva de los gastos; ahora los ingresos se categorizan y
// el campo forma parte del contrato (nulo en los ingresos anteriores a D-4).
function toRevenueDto<T extends { type: unknown }>(row: T) {
  const { type, ...rest } = row;
  return rest;
}

/**
 * Normaliza la categoría recibida contra el catálogo activo de ingresos.
 *
 * Devuelve el nombre canónico, `null` si no venía ninguna, o un mensaje de
 * error si la categoría no existe o está desactivada. Sin esta comprobación el
 * catálogo sería decorativo: cualquiera podría mandar texto libre, que es
 * justamente lo que hoy pasa con los gastos.
 */
async function normalizarCategoria(
  category: string | null | undefined,
): Promise<{ ok: true; value: string | null } | { ok: false; message: string }> {
  if (category == null || category === "") return { ok: true, value: null };

  const canonica = await resolverCategoriaActiva("REVENUE", category);
  if (!canonica) {
    return {
      ok: false,
      message: `La categoría "${category}" no existe o está desactivada en el catálogo de ingresos`,
    };
  }
  return { ok: true, value: canonica };
}

export async function revenueRoutes(app: FastifyInstance) {
  // GET /api/revenue?projectId=... — listado por proyecto
  app.get(
    "/",
    {
      preHandler: [
        authenticate,
        authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER]),
      ],
    },
    async (request) => {
      const { projectId } = projectIdParamsSchema.partial().parse(request.query);

      const entries = await prisma.financialEntry.findMany({
        where: { type: "REVENUE", projectId },
        include: { project: { select: { id: true, name: true, currency: true } } },
        orderBy: { entryDate: "desc" },
      });

      return { data: entries.map(toRevenueDto) };
    },
  );

  // POST /api/revenue — registrar ingreso
  app.post(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE])],
    },
    async (request, reply) => {
      const payload = revenuePayloadSchema.parse(request.body);

      const project = await prisma.project.findUnique({ where: { id: payload.projectId } });
      if (!project) {
        return reply.status(400).send({ message: "Proyecto no encontrado" });
      }

      const categoria = await normalizarCategoria(payload.category);
      if (!categoria.ok) {
        return reply.status(400).send({ message: categoria.message });
      }

      const entry = await prisma.financialEntry.create({
        data: { ...payload, category: categoria.value, type: "REVENUE" },
      });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.revenueEntry,
        entityId: entry.id,
        action: "CREATE",
        changedBy: request.authUser!.email,
        after: entry as unknown as Record<string, unknown>,
        request,
      });

      return reply.status(201).send({ data: toRevenueDto(entry) });
    },
  );

  // PUT /api/revenue/:id — editar ingreso
  app.put(
    "/:id",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE])],
    },
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);
      const payload = revenuePayloadSchema.parse(request.body);

      const existing = await prisma.financialEntry.findUnique({ where: { id } });
      if (!existing || existing.type !== "REVENUE") {
        return reply.status(404).send({ message: "Ingreso no encontrado" });
      }

      const project = await prisma.project.findUnique({ where: { id: payload.projectId } });
      if (!project) {
        return reply.status(400).send({ message: "Proyecto no encontrado" });
      }

      const categoria = await normalizarCategoria(payload.category);
      if (!categoria.ok) {
        return reply.status(400).send({ message: categoria.message });
      }

      try {
        const entry = await prisma.financialEntry.update({
          where: { id },
          data: { ...payload, category: categoria.value },
        });

        await writeAudit(prisma, {
          entity: AUDIT_ENTITIES.revenueEntry,
          entityId: entry.id,
          action: "UPDATE",
          changedBy: request.authUser!.email,
          before: existing as unknown as Record<string, unknown>,
          after: entry as unknown as Record<string, unknown>,
          request,
        });

        return { data: toRevenueDto(entry) };
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "P2003" || code === "P2014") {
          return reply.status(409).send({ message: "No se puede actualizar el ingreso debido a un conflicto de registros relacionados" });
        }
        throw err;
      }
    },
  );

  // DELETE /api/revenue/:id — eliminar ingreso
  app.delete(
    "/:id",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE])],
    },
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);

      const existing = await prisma.financialEntry.findUnique({ where: { id } });
      if (!existing || existing.type !== "REVENUE") {
        return reply.status(404).send({ message: "Ingreso no encontrado" });
      }

      try {
        await prisma.financialEntry.delete({ where: { id } });

        await writeAudit(prisma, {
          entity: AUDIT_ENTITIES.revenueEntry,
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
          return reply.status(409).send({ message: "No se puede eliminar el ingreso: tiene otros registros relacionados" });
        }
        throw err;
      }
    },
  );
}
