import { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requirePermission } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";

/** Texto opcional: "" (formulario vacío) se guarda como null; undefined = "no tocar". */
const textoOpcional = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v === undefined ? undefined : v === null || v === "" ? null : v));

const correoOpcional = z
  .union([z.literal(""), z.string().trim().email("contactEmail debe ser un correo válido")])
  .nullish()
  .transform((v) => (v === undefined ? undefined : v === null || v === "" ? null : v));

const createSchema = z.object({
  name: z.string().trim().min(1, "El nombre de la empresa es obligatorio"),
  nit: textoOpcional,
  contactName: textoOpcional,
  contactEmail: correoOpcional,
  contactPhone: textoOpcional,
  active: z.boolean().optional(),
});

const updateSchema = createSchema.partial();

const listQuerySchema = z.object({
  active: z.enum(["true", "false"]).optional(),
  search: z.string().trim().optional(),
});

const paramsSchema = z.object({ id: z.string().min(1) });

const MSG_NOMBRE_DUPLICADO = "Ya existe una empresa con ese nombre";
const MSG_NIT_DUPLICADO = "Ya existe una empresa con ese NIT";

const conConteo = { _count: { select: { projects: true } } } as const;

type CompanyRow = Prisma.CompanyGetPayload<{ include: typeof conConteo }>;

function serializar(row: CompanyRow) {
  const { _count, ...resto } = row;
  return { ...resto, projectCount: _count.projects };
}

/** Devuelve el mensaje de conflicto si el nombre (sin distinguir mayúsculas) o el NIT ya existen. */
async function detectarConflicto(name: string | undefined, nit: string | null | undefined, excluirId?: string) {
  const fueraDeEsta = excluirId ? { id: { not: excluirId } } : {};
  if (name !== undefined) {
    const dup = await prisma.company.findFirst({
      where: { ...fueraDeEsta, name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    if (dup) return MSG_NOMBRE_DUPLICADO;
  }
  if (nit) {
    const dup = await prisma.company.findFirst({ where: { ...fueraDeEsta, nit }, select: { id: true } });
    if (dup) return MSG_NIT_DUPLICADO;
  }
  return null;
}

/** Carrera entre la validación y el insert: el índice único de la base manda. */
function mensajeP2002(err: unknown): string | null {
  if ((err as { code?: string })?.code !== "P2002") return null;
  const target = JSON.stringify((err as { meta?: { target?: unknown } }).meta?.target ?? "").toLowerCase();
  return target.includes("nit") ? MSG_NIT_DUPLICADO : MSG_NOMBRE_DUPLICADO;
}

export async function companiesRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: [authenticate, requirePermission("companies:read")] }, async (request) => {
    const query = listQuerySchema.parse(request.query);
    const rows = await prisma.company.findMany({
      where: {
        active: query.active === undefined ? undefined : query.active === "true",
        OR: query.search
          ? [
              { name: { contains: query.search, mode: "insensitive" } },
              { nit: { contains: query.search, mode: "insensitive" } },
            ]
          : undefined,
      },
      include: conConteo,
      orderBy: { name: "asc" },
    });
    return { data: rows.map(serializar) };
  });

  app.get("/:id", { preHandler: [authenticate, requirePermission("companies:read")] }, async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    const row = await prisma.company.findUnique({
      where: { id },
      include: {
        ...conConteo,
        projects: {
          select: {
            id: true,
            name: true,
            status: true,
            country: true,
            currency: true,
            startDate: true,
            endDate: true,
            projectManagerEmail: true,
            isInternal: true,
          },
          orderBy: { name: "asc" },
        },
      },
    });
    if (!row) return reply.status(404).send({ message: "Empresa no encontrada" });
    const { _count, ...resto } = row;
    return { data: { ...resto, projectCount: _count.projects } };
  });

  app.post("/", { preHandler: [authenticate, requirePermission("companies:write")] }, async (request, reply) => {
    const body = createSchema.parse(request.body);

    const conflicto = await detectarConflicto(body.name, body.nit);
    if (conflicto) return reply.status(409).send({ message: conflicto });

    let row: CompanyRow;
    try {
      row = await prisma.company.create({
        data: {
          name: body.name,
          nit: body.nit,
          contactName: body.contactName,
          contactEmail: body.contactEmail,
          contactPhone: body.contactPhone,
          active: body.active,
        },
        include: conConteo,
      });
    } catch (err) {
      const msg = mensajeP2002(err);
      if (msg) return reply.status(409).send({ message: msg });
      throw err;
    }

    const data = serializar(row);
    await writeAudit(prisma, {
      entity: AUDIT_ENTITIES.company,
      entityId: row.id,
      action: "CREATE",
      changedBy: request.authUser?.email ?? "system",
      after: data as unknown as Record<string, unknown>,
      request,
    });
    return reply.status(201).send({ data });
  });

  app.put("/:id", { preHandler: [authenticate, requirePermission("companies:write")] }, async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);
    const body = updateSchema.parse(request.body);

    const existing = await prisma.company.findUnique({ where: { id }, include: conConteo });
    if (!existing) return reply.status(404).send({ message: "Empresa no encontrada" });

    const conflicto = await detectarConflicto(body.name, body.nit, id);
    if (conflicto) return reply.status(409).send({ message: conflicto });

    let row: CompanyRow;
    try {
      row = await prisma.company.update({
        where: { id },
        data: {
          name: body.name,
          nit: body.nit,
          contactName: body.contactName,
          contactEmail: body.contactEmail,
          contactPhone: body.contactPhone,
          active: body.active,
        },
        include: conConteo,
      });
    } catch (err) {
      const msg = mensajeP2002(err);
      if (msg) return reply.status(409).send({ message: msg });
      throw err;
    }

    const data = serializar(row);
    await writeAudit(prisma, {
      entity: AUDIT_ENTITIES.company,
      entityId: id,
      action: "UPDATE",
      changedBy: request.authUser?.email ?? "system",
      before: serializar(existing) as unknown as Record<string, unknown>,
      after: data as unknown as Record<string, unknown>,
      request,
    });
    return { data };
  });

  app.delete("/:id", { preHandler: [authenticate, requirePermission("companies:write")] }, async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);

    const existing = await prisma.company.findUnique({ where: { id }, include: conConteo });
    if (!existing) return reply.status(404).send({ message: "Empresa no encontrada" });

    const n = existing._count.projects;
    if (n > 0) {
      return reply.status(409).send({
        message:
          `No se puede eliminar la empresa: tiene ${n} ${n === 1 ? "proyecto" : "proyectos"}. ` +
          "Reasígnalos a otra empresa o desactiva la empresa.",
      });
    }

    try {
      await prisma.company.delete({ where: { id } });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "P2003" || code === "P2014") {
        return reply.status(409).send({
          message: "No se puede eliminar la empresa: tiene proyectos asociados. Reasígnalos o desactiva la empresa.",
        });
      }
      throw err;
    }

    await writeAudit(prisma, {
      entity: AUDIT_ENTITIES.company,
      entityId: id,
      action: "DELETE",
      changedBy: request.authUser?.email ?? "system",
      before: serializar(existing) as unknown as Record<string, unknown>,
      request,
    });
    return reply.status(204).send();
  });
}
