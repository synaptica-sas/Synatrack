import { BlockType, TimeEntryCategory } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requirePermission } from "../../auth/guard.js";
import { hasPermission } from "../../auth/roles.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";

/**
 * Catálogo de tipos de hora del timesheet (R14 §2.1).
 *
 * La categoría es lo que el código interpreta (REGULAR cuenta contra la jornada, EXTRA exige
 * solicitud aprobada, ABSENCE solo va en el proyecto Ausencias); el nombre es libre. Los tipos de
 * semilla llevan un `code` estable (REGULAR, EXTRA, PERMISO, VACACIONES): se pueden renombrar y
 * reordenar, no borrar ni cambiar de categoría. REGULAR tampoco se desactiva.
 *
 * Leer: cualquier rol con `time:read`. Escribir: `time:types` (ADMIN).
 */

const listQuerySchema = z.object({
  all: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  category: z.nativeEnum(TimeEntryCategory),
  blockType: z.nativeEnum(BlockType).nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(999).optional(),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    category: z.nativeEnum(TimeEntryCategory).optional(),
    blockType: z.nativeEnum(BlockType).nullable().optional(),
    active: z.boolean().optional(),
    sortOrder: z.coerce.number().int().min(0).max(999).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No hay nada que cambiar" });

const idParamsSchema = z.object({ id: z.string().min(1) });

/** `blockType` es obligatorio en ABSENCE y está prohibido en el resto. */
function blockTypeError(category: TimeEntryCategory, blockType: BlockType | null | undefined): string | null {
  if (category === TimeEntryCategory.ABSENCE && !blockType) {
    return "Los tipos de ausencia deben indicar el tipo de bloqueo de capacidad (blockType).";
  }
  if (category !== TimeEntryCategory.ABSENCE && blockType) {
    return "Solo los tipos de ausencia pueden indicar un tipo de bloqueo (blockType).";
  }
  return null;
}

type Fila = {
  id: string;
  code: string | null;
  name: string;
  category: TimeEntryCategory;
  blockType: BlockType | null;
  active: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

function serializar(fila: Fila, entriesCount?: number) {
  return {
    id: fila.id,
    code: fila.code,
    name: fila.name,
    category: fila.category,
    blockType: fila.blockType,
    active: fila.active,
    sortOrder: fila.sortOrder,
    createdAt: fila.createdAt,
    updatedAt: fila.updatedAt,
    ...(entriesCount === undefined ? {} : { entriesCount }),
  };
}

export async function timeEntryTypesRoutes(app: FastifyInstance) {
  // GET /api/time-entry-types[?all=true]
  app.get("/", { preHandler: [authenticate, requirePermission("time:read")] }, async (request) => {
    const query = listQuerySchema.parse(request.query);
    const canManage = hasPermission(request.authUser!.roles, "time:types");
    // Los inactivos y los conteos son para la pantalla de administración; el resto solo ve los activos.
    const includeInactive = query.all && canManage;

    const filas = await prisma.timeEntryType.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: canManage ? { _count: { select: { timeEntries: true } } } : undefined,
    });

    return {
      data: filas.map((f) =>
        serializar(f, "_count" in f ? (f as unknown as { _count: { timeEntries: number } })._count.timeEntries : undefined),
      ),
    };
  });

  // POST /api/time-entry-types
  app.post("/", { preHandler: [authenticate, requirePermission("time:types")] }, async (request, reply) => {
    const payload = createSchema.parse(request.body);

    const invalido = blockTypeError(payload.category, payload.blockType);
    if (invalido) return reply.status(400).send({ message: invalido });

    const yaExiste = await prisma.timeEntryType.findFirst({
      where: { name: { equals: payload.name, mode: "insensitive" } },
    });
    if (yaExiste) {
      return reply.status(409).send({ message: `Ya existe un tipo de hora llamado "${yaExiste.name}"` });
    }

    const fila = await prisma.timeEntryType.create({
      data: {
        name: payload.name,
        category: payload.category,
        blockType: payload.category === TimeEntryCategory.ABSENCE ? payload.blockType : null,
        active: payload.active ?? true,
        sortOrder: payload.sortOrder ?? 50,
      },
    });

    await writeAudit(prisma, {
      entity: AUDIT_ENTITIES.timeEntryType,
      entityId: fila.id,
      action: "CREATE",
      changedBy: request.authUser!.email,
      after: fila as unknown as Record<string, unknown>,
      request,
    });

    return reply.status(201).send({ data: serializar(fila, 0) });
  });

  // PATCH /api/time-entry-types/:id
  app.patch("/:id", { preHandler: [authenticate, requirePermission("time:types")] }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const payload = updateSchema.parse(request.body);

    const actual = await prisma.timeEntryType.findUnique({
      where: { id },
      include: { _count: { select: { timeEntries: true } } },
    });
    if (!actual) return reply.status(404).send({ message: "Tipo de hora no encontrado" });

    const categoria = payload.category ?? actual.category;
    if (payload.category && payload.category !== actual.category) {
      if (actual.code) {
        return reply
          .status(409)
          .send({ message: "Los tipos base no pueden cambiar de categoría; puedes renombrarlos o reordenarlos." });
      }
      if (actual._count.timeEntries > 0) {
        return reply.status(409).send({
          message: "No se puede cambiar la categoría de un tipo que ya tiene registros; crea otro tipo y desactiva este.",
        });
      }
    }
    if (actual.code === "REGULAR" && payload.active === false) {
      return reply.status(409).send({ message: "El tipo Horas Regulares no se puede desactivar." });
    }

    // `blockType` final: si la categoría deja de ser ABSENCE se limpia; si no llega, se conserva.
    const blockType =
      categoria !== TimeEntryCategory.ABSENCE
        ? payload.blockType === undefined || payload.blockType === null
          ? null
          : payload.blockType
        : payload.blockType === undefined
          ? actual.blockType
          : payload.blockType;
    const invalido = blockTypeError(categoria, blockType);
    if (invalido) return reply.status(400).send({ message: invalido });

    if (payload.name && payload.name.toLowerCase() !== actual.name.toLowerCase()) {
      const yaExiste = await prisma.timeEntryType.findFirst({
        where: { id: { not: id }, name: { equals: payload.name, mode: "insensitive" } },
      });
      if (yaExiste) {
        return reply.status(409).send({ message: `Ya existe un tipo de hora llamado "${yaExiste.name}"` });
      }
    }

    const fila = await prisma.timeEntryType.update({
      where: { id },
      data: {
        name: payload.name,
        category: payload.category,
        blockType,
        active: payload.active,
        sortOrder: payload.sortOrder,
      },
    });

    await writeAudit(prisma, {
      entity: AUDIT_ENTITIES.timeEntryType,
      entityId: id,
      action: "UPDATE",
      changedBy: request.authUser!.email,
      before: actual as unknown as Record<string, unknown>,
      after: fila as unknown as Record<string, unknown>,
      request,
    });

    return { data: serializar(fila, actual._count.timeEntries) };
  });

  // DELETE /api/time-entry-types/:id
  app.delete("/:id", { preHandler: [authenticate, requirePermission("time:types")] }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);

    const actual = await prisma.timeEntryType.findUnique({
      where: { id },
      include: { _count: { select: { timeEntries: true } } },
    });
    if (!actual) return reply.status(404).send({ message: "Tipo de hora no encontrado" });

    if (actual.code) {
      return reply
        .status(409)
        .send({ message: "Los tipos base no se pueden borrar; puedes renombrarlos o reordenarlos." });
    }
    if (actual._count.timeEntries > 0) {
      return reply.status(409).send({
        message: `Este tipo ya tiene ${actual._count.timeEntries} registro(s) de horas. Desactívalo en vez de borrarlo.`,
      });
    }

    await prisma.timeEntryType.delete({ where: { id } });

    await writeAudit(prisma, {
      entity: AUDIT_ENTITIES.timeEntryType,
      entityId: id,
      action: "DELETE",
      changedBy: request.authUser!.email,
      before: actual as unknown as Record<string, unknown>,
      request,
    });

    return reply.status(204).send();
  });
}
