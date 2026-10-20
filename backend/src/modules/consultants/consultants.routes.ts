import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";
import { consultantSinDatosSensiblesSelect, puedeVerTarifas } from "../../utils/consultant-scope.js";

import { normalizeCountry } from "../../utils/country.js";
import { fromIsoDate, isValidIsoDate, toIsoDate } from "../../utils/isoDate.js";

/** Fecha "YYYY-MM-DD" real (rechaza 2026-02-30); null o ausente se respetan. */
const fechaOpcional = z
  .union([z.literal(""), z.string().trim().refine(isValidIsoDate, { message: "Fecha inválida, se espera YYYY-MM-DD" })])
  .nullish()
  .transform((valor) => (valor === "" ? null : valor));

/** Cambia las fechas @db.Date a "YYYY-MM-DD" para que la respuesta no dependa de la zona horaria. */
function conFechas<T extends object>(entrada: T) {
  // Quien no ve datos sensibles recibe la fila sin estas claves: solo se convierten si están.
  const fila = entrada as T & { hireDate?: Date | null; exitDate?: Date | null };
  return {
    ...fila,
    ...("hireDate" in fila ? { hireDate: fila.hireDate ? toIsoDate(fila.hireDate) : null } : {}),
    ...("exitDate" in fila ? { exitDate: fila.exitDate ? toIsoDate(fila.exitDate) : null } : {}),
  };
}

/** Datos de Prisma para city, hireDate y exitDate; "undefined" deja el campo como está. */
function camposDeVinculo(p: { city?: string | null; hireDate?: string | null; exitDate?: string | null }) {
  return {
    ...(p.city !== undefined ? { city: p.city } : {}),
    ...(p.hireDate !== undefined ? { hireDate: p.hireDate ? fromIsoDate(p.hireDate) : null } : {}),
    ...(p.exitDate !== undefined ? { exitDate: p.exitDate ? fromIsoDate(p.exitDate) : null } : {}),
  };
}

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
  // Ciudad para feriados locales: espacios simples; vacía se guarda como null.
  city: z
    .string()
    .nullish()
    .transform((valor) => {
      if (valor === undefined || valor === null) return valor;
      const limpia = valor.trim().replace(/\s+/g, " ");
      return limpia === "" ? null : limpia;
    })
    .pipe(z.string().max(80).nullish()),
  hireDate: fechaOpcional,
  exitDate: fechaOpcional,
  active: z.coerce.boolean().default(true),
  allowWeekendWork: z.coerce.boolean().default(false),
  isInternal: z.coerce.boolean().default(true),
});

const MENSAJE_FECHAS = "La fecha de salida no puede ser anterior a la fecha de ingreso";

const consultantParamsSchema = z.object({ id: z.string().min(1) });

const linkUserPayloadSchema = z.object({ userId: z.string().min(1).nullable() });

/**
 * Si el correo del consultor coincide con un `User` que todavía no tiene
 * ningún consultor enlazado, los enlaza. Mismo criterio insensible a
 * mayúsculas que usa `authenticate` en el login — es el segundo de los tres
 * momentos de enlace (el primero es el login, el tercero es el enlace manual
 * de `PATCH /:id/link-user`).
 */
async function autoLinkByEmail(consultantId: string, email: string | null) {
  if (!email) return null;
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, consultant: null },
  });
  if (!user) return null;
  return prisma.consultant.update({ where: { id: consultantId }, data: { userId: user.id } });
}

export async function consultantsRoutes(app: FastifyInstance) {
  app.get(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT, AppRole.FINANCE, AppRole.VIEWER])],
    },
    async (request) => {
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

      return { data: consultants.map(conFechas) };
    },
  );

  app.post(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])],
    },
    async (request, reply) => {
    const payload = consultantPayloadSchema.parse(request.body);

    if (payload.hireDate && payload.exitDate && payload.exitDate < payload.hireDate) {
      return reply.status(400).send({ message: MENSAJE_FECHAS });
    }

    let consultant = await prisma.consultant.create({
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
        ...camposDeVinculo(payload),
      },
    });

    consultant = (await autoLinkByEmail(consultant.id, consultant.email)) ?? consultant;

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

      return reply.status(201).send({ data: conFechas(consultant) });
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

    // Una fecha ausente conserva la guardada: se valida contra el resultado final.
    const ingreso = payload.hireDate !== undefined ? payload.hireDate : existing.hireDate ? toIsoDate(existing.hireDate) : null;
    const salida = payload.exitDate !== undefined ? payload.exitDate : existing.exitDate ? toIsoDate(existing.exitDate) : null;
    if (ingreso && salida && salida < ingreso) {
      return reply.status(400).send({ message: MENSAJE_FECHAS });
    }

    let consultant = await prisma.consultant.update({
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
        ...camposDeVinculo(payload),
      },
    });

    // Solo se intenta enlazar si todavía no tenía uno: un enlace ya hecho (a
    // mano o por login) no se toca porque alguien edite otro campo.
    if (!existing.userId) {
      consultant = (await autoLinkByEmail(consultant.id, consultant.email)) ?? consultant;
    }

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

      return { data: conFechas(consultant) };
    },
  );

  /**
   * Tercer momento de enlace (el primero es el login, el segundo es
   * crear/editar por correo coincidente): a mano, para los casos en que el
   * correo del consultor no coincide con el del usuario de Entra. `userId:
   * null` desenlaza.
   */
  app.patch(
    "/:id/link-user",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN])],
    },
    async (request, reply) => {
      const { id } = consultantParamsSchema.parse(request.params);
      const { userId } = linkUserPayloadSchema.parse(request.body);

      const existing = await prisma.consultant.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({ message: "Consultant not found" });
      }

      if (userId) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
          return reply.status(400).send({ message: "Usuario no encontrado" });
        }
        const yaEnlazado = await prisma.consultant.findFirst({ where: { userId, NOT: { id } } });
        if (yaEnlazado) {
          return reply
            .status(409)
            .send({ message: `Ese usuario ya está enlazado a ${yaEnlazado.fullName}` });
        }
      }

      const consultant = await prisma.consultant.update({ where: { id }, data: { userId } });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.consultant,
        entityId: id,
        action: "UPDATE",
        changedBy: request.authUser!.email,
        before: existing as unknown as Record<string, unknown>,
        after: consultant as unknown as Record<string, unknown>,
        request,
      });

      return { data: conFechas(consultant) };
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

      // Pre-check RESTRICT relations (TimeEntry, Assignment)
      const [linkedTimeEntries, linkedAssignments] = await Promise.all([
        prisma.timeEntry.count({ where: { consultantId: id } }),
        prisma.assignment.count({ where: { consultantId: id } }),
      ]);

      if (linkedTimeEntries > 0 || linkedAssignments > 0) {
        const parts: string[] = [];
        if (linkedTimeEntries > 0) parts.push(`${linkedTimeEntries} registro(s) de horas`);
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

      // Pre-check RESTRICT relations (TimeEntry, Assignment)
      const [linkedTimeEntries, linkedAssignments] = await Promise.all([
        prisma.timeEntry.count({ where: { consultantId: id } }),
        prisma.assignment.count({ where: { consultantId: id } }),
      ]);

      if (linkedTimeEntries > 0 || linkedAssignments > 0) {
        const parts: string[] = [];
        if (linkedTimeEntries > 0) parts.push(`${linkedTimeEntries} registro(s) de horas`);
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
