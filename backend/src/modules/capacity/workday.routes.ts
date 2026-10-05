import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import type { Decimal } from "@prisma/client/runtime/library";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { writeAudit } from "../../utils/audit.js";
import { normalizeCountry } from "../../utils/country.js";
import {
  JORNADA_GENERAL,
  PAIS_GENERAL,
  resolverJornada,
  type JornadaEfectiva,
} from "../../utils/capacity.js";

/**
 * Configuración de la jornada laboral (decisión de negocio D-5, cierra DEP-41).
 *
 * `CapacityConfig` existía desde el principio pero no había forma de escribirlo,
 * así que toda la capacidad del sistema se calculaba con 8 h × 5 días. Estos
 * endpoints son la pieza que faltaba: la jornada se configura **por país y por
 * consultor**, y el consultor manda sobre su país (la precedencia la resuelve
 * `resolverJornada` en `utils/capacity.ts`).
 *
 * Quién puede tocarla: **solo ADMIN**, igual que la configuración de horas extra
 * (`extrahours:config`). No es un dato operativo sino un parámetro que mueve
 * todas las ocupaciones del portafolio a la vez.
 *
 * La lectura de la jornada *efectiva* sí es abierta a todos los roles
 * autenticados: solo dice cuántas horas tiene la jornada de cada consultor, no
 * expone tarifas ni costos, y el informe semanal la necesita para pintar las
 * horas extra de cada persona contra su propia jornada.
 */

const payloadSchema = z.object({
  hoursPerDay: z.coerce.number().positive().max(24),
  workDaysPerWeek: z.coerce.number().int().min(1).max(7),
});

const countryParamSchema = z.object({
  country: z
    .string()
    .trim()
    .min(1)
    .transform((valor, ctx) => {
      try {
        return normalizeCountry(valor);
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `País no soportado: ${valor}` });
        return z.NEVER;
      }
    }),
});

const consultantParamSchema = z.object({ consultantId: z.string().min(1) });

/** Filas de jornada por país (las que no pertenecen a un consultor). */
export async function cargarJornadasPorPais() {
  return prisma.capacityConfig.findMany({
    where: { consultantId: null, country: { not: null } },
    orderBy: { country: "asc" },
  });
}

function serializar(fila: {
  id: string;
  consultantId: string | null;
  country: string | null;
  hoursPerDay: Decimal;
  workDaysPerWeek: number;
  updatedAt: Date;
}) {
  return {
    id: fila.id,
    consultantId: fila.consultantId,
    country: fila.country,
    hoursPerDay: Number(fila.hoursPerDay),
    workDaysPerWeek: fila.workDaysPerWeek,
    updatedAt: fila.updatedAt,
  };
}

export async function workdayRoutes(app: FastifyInstance) {
  // ── Lectura de la configuración completa (pantalla de administración) ──────
  app.get(
    "/workday",
    { preHandler: [authenticate, authorize([AppRole.ADMIN])] },
    async () => {
      const [filasPais, filasConsultor, consultores] = await Promise.all([
        cargarJornadasPorPais(),
        prisma.capacityConfig.findMany({ where: { consultantId: { not: null } } }),
        prisma.consultant.findMany({
          where: { active: true },
          select: { id: true, fullName: true, country: true },
          orderBy: { fullName: "asc" },
        }),
      ]);

      const porConsultor = new Map(filasConsultor.map((f) => [f.consultantId!, f]));

      return {
        data: {
          // El último escalón, para poder explicarlo en pantalla sin repetirlo.
          general: JORNADA_GENERAL,
          paisGeneral: PAIS_GENERAL,
          countries: filasPais.map(serializar),
          consultants: consultores.map((c) => {
            const propia = porConsultor.get(c.id) ?? null;
            const efectiva = resolverJornada(propia, c.country, filasPais);
            return {
              consultantId: c.id,
              fullName: c.fullName,
              country: c.country,
              /** Fila propia, o `null` si hereda. */
              propia: propia ? serializar(propia) : null,
              efectiva,
            };
          }),
        },
      };
    },
  );

  // ── Jornada efectiva de cada consultor activo ─────────────────────────────
  // La usa el informe semanal para separar las horas extra de cada persona
  // contra su propia jornada. No expone tarifas ni costos.
  app.get(
    "/workday/effective",
    {
      preHandler: [
        authenticate,
        authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT, AppRole.FINANCE, AppRole.VIEWER]),
      ],
    },
    async () => {
      const [filasPais, consultores] = await Promise.all([
        cargarJornadasPorPais(),
        prisma.consultant.findMany({
          where: { active: true },
          select: { id: true, country: true, capacityConfig: true },
        }),
      ]);

      const general = resolverJornada(null, null, filasPais);

      const data: {
        general: JornadaEfectiva;
        consultants: ({ consultantId: string } & JornadaEfectiva)[];
      } = {
        general,
        consultants: consultores.map((c) => ({
          consultantId: c.id,
          ...resolverJornada(c.capacityConfig, c.country, filasPais),
        })),
      };

      return { data };
    },
  );

  // ── Jornada de un país ────────────────────────────────────────────────────
  app.put(
    "/workday/country/:country",
    { preHandler: [authenticate, authorize([AppRole.ADMIN])] },
    async (request) => {
      const { country } = countryParamSchema.parse(request.params);
      const payload = payloadSchema.parse(request.body);

      const antes = await prisma.capacityConfig.findUnique({ where: { country } });

      const fila = await prisma.capacityConfig.upsert({
        where: { country },
        update: { hoursPerDay: payload.hoursPerDay, workDaysPerWeek: payload.workDaysPerWeek },
        create: {
          country,
          consultantId: null,
          hoursPerDay: payload.hoursPerDay,
          workDaysPerWeek: payload.workDaysPerWeek,
        },
      });

      await writeAudit(prisma, {
        entity: "capacityConfig",
        entityId: fila.id,
        action: antes ? "UPDATE" : "CREATE",
        changedBy: request.authUser!.email,
        before: antes ? serializar(antes) : null,
        after: serializar(fila),
        request,
      });

      return { data: serializar(fila) };
    },
  );

  app.delete(
    "/workday/country/:country",
    { preHandler: [authenticate, authorize([AppRole.ADMIN])] },
    async (request, reply) => {
      const { country } = countryParamSchema.parse(request.params);

      // La fila general no se puede borrar: es el suelo de la precedencia y sin
      // ella un país sin configurar caería en la constante del código.
      if (country === PAIS_GENERAL) {
        return reply.status(409).send({
          message: "La jornada general no se puede eliminar; edítela en lugar de borrarla.",
        });
      }

      const fila = await prisma.capacityConfig.findUnique({ where: { country } });
      if (!fila) return reply.status(404).send({ message: "Ese país no tiene jornada configurada" });

      await prisma.capacityConfig.delete({ where: { id: fila.id } });

      await writeAudit(prisma, {
        entity: "capacityConfig",
        entityId: fila.id,
        action: "DELETE",
        changedBy: request.authUser!.email,
        before: serializar(fila),
        request,
      });

      return reply.status(204).send();
    },
  );

  // ── Jornada de un consultor (excepción sobre la de su país) ───────────────
  app.put(
    "/workday/consultant/:consultantId",
    { preHandler: [authenticate, authorize([AppRole.ADMIN])] },
    async (request, reply) => {
      const { consultantId } = consultantParamSchema.parse(request.params);
      const payload = payloadSchema.parse(request.body);

      const consultor = await prisma.consultant.findUnique({ where: { id: consultantId } });
      if (!consultor) return reply.status(404).send({ message: "Consultor no encontrado" });

      const antes = await prisma.capacityConfig.findUnique({ where: { consultantId } });

      const fila = await prisma.capacityConfig.upsert({
        where: { consultantId },
        update: { hoursPerDay: payload.hoursPerDay, workDaysPerWeek: payload.workDaysPerWeek },
        create: {
          consultantId,
          // Una fila de consultor no lleva país: el país se hereda del consultor
          // y dejarlo aquí chocaría con el índice único de `country`.
          country: null,
          hoursPerDay: payload.hoursPerDay,
          workDaysPerWeek: payload.workDaysPerWeek,
        },
      });

      await writeAudit(prisma, {
        entity: "capacityConfig",
        entityId: fila.id,
        action: antes ? "UPDATE" : "CREATE",
        changedBy: request.authUser!.email,
        before: antes ? serializar(antes) : null,
        after: serializar(fila),
        request,
      });

      return { data: serializar(fila) };
    },
  );

  app.delete(
    "/workday/consultant/:consultantId",
    { preHandler: [authenticate, authorize([AppRole.ADMIN])] },
    async (request, reply) => {
      const { consultantId } = consultantParamSchema.parse(request.params);

      const fila = await prisma.capacityConfig.findUnique({ where: { consultantId } });
      if (!fila) {
        return reply.status(404).send({ message: "Ese consultor no tiene jornada propia" });
      }

      await prisma.capacityConfig.delete({ where: { id: fila.id } });

      await writeAudit(prisma, {
        entity: "capacityConfig",
        entityId: fila.id,
        action: "DELETE",
        changedBy: request.authUser!.email,
        before: serializar(fila),
        request,
      });

      return reply.status(204).send();
    },
  );
}
