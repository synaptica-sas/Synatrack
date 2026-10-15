import type { FastifyInstance } from "fastify";
import type { Decimal } from "@prisma/client/runtime/library";
import { z } from "zod";
import { authenticate, requirePermission } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { writeAudit } from "../../utils/audit.js";
import { normalizeCountry } from "../../utils/country.js";
import { fromIsoDate, isValidIsoDate, toIsoDate } from "../../utils/isoDate.js";
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
 * Con vigencia (CONTRATO §3.5): cada clave (país o consultor) puede tener varias
 * filas con `validFrom`, y a un día le aplica la de mayor `validFrom` <= ese día.
 * Así un cambio de jornada no reescribe los meses pasados.
 *
 * Quién puede tocarla: **solo ADMIN** (`capacity:config`), igual que la
 * configuración de horas extra (`extrahours:config`). No es un dato operativo
 * sino un parámetro que mueve todas las ocupaciones del portafolio a la vez.
 *
 * La lectura de la jornada *efectiva* sí es abierta a todos los roles
 * autenticados: solo dice cuántas horas tiene la jornada de cada consultor, no
 * expone tarifas ni costos, y el informe semanal la necesita para pintar las
 * horas extra de cada persona contra su propia jornada.
 */

const VIGENCIA_INICIAL = "2000-01-01";

const isoDateSchema = z
  .string()
  .trim()
  .refine(isValidIsoDate, { message: "Fecha inválida, se espera YYYY-MM-DD" });

const payloadSchema = z.object({
  hoursPerDay: z.coerce.number().positive().max(24),
  workDaysPerWeek: z.coerce.number().int().min(1).max(7),
  validFrom: isoDateSchema.default(VIGENCIA_INICIAL),
});

const validFromQuerySchema = z.object({ validFrom: isoDateSchema.default(VIGENCIA_INICIAL) });
const effectiveQuerySchema = z.object({ date: isoDateSchema.optional() });

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

/** Hoy a medianoche UTC (nunca hora local). */
export function hoyUtc(): Date {
  const ahora = new Date();
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate()));
}

/**
 * Filas de jornada por país vigentes en `fecha` (por defecto hoy): para cada
 * país, la de mayor `validFrom` <= fecha. Devuelve una fila por país, de modo
 * que `resolverJornada` no necesita saber de vigencias.
 */
export async function cargarJornadasPorPais(fecha: Date = hoyUtc()) {
  const filas = await prisma.capacityConfig.findMany({
    where: { consultantId: null, country: { not: null }, validFrom: { lte: fecha } },
    orderBy: [{ country: "asc" }, { validFrom: "desc" }],
  });
  const vistos = new Set<string>();
  return filas.filter((f) => {
    if (vistos.has(f.country!)) return false;
    vistos.add(f.country!);
    return true;
  });
}

/** Argumento `capacityConfigs` de un `select`/`include`: solo la fila vigente en `fecha`. */
export function jornadaVigenteDe(fecha: Date = hoyUtc()) {
  return {
    where: { validFrom: { lte: fecha } },
    orderBy: { validFrom: "desc" as const },
    take: 1,
  };
}

function serializar(fila: {
  id: string;
  consultantId: string | null;
  country: string | null;
  validFrom: Date;
  hoursPerDay: Decimal;
  workDaysPerWeek: number;
  updatedAt: Date;
}) {
  return {
    id: fila.id,
    consultantId: fila.consultantId,
    country: fila.country,
    validFrom: toIsoDate(fila.validFrom),
    hoursPerDay: Number(fila.hoursPerDay),
    workDaysPerWeek: fila.workDaysPerWeek,
    updatedAt: fila.updatedAt,
  };
}

export async function workdayRoutes(app: FastifyInstance) {
  // ── Lectura de la configuración completa (pantalla de administración) ──────
  // Devuelve TODAS las filas con su `validFrom`; `propia` y `efectiva` son las
  // vigentes hoy.
  app.get(
    "/workday",
    { preHandler: [authenticate, requirePermission("capacity:config")] },
    async () => {
      const hoy = hoyUtc();
      const [todasPais, vigentesPais, filasConsultor, consultores] = await Promise.all([
        prisma.capacityConfig.findMany({
          where: { consultantId: null, country: { not: null } },
          orderBy: [{ country: "asc" }, { validFrom: "asc" }],
        }),
        cargarJornadasPorPais(hoy),
        prisma.capacityConfig.findMany({
          where: { consultantId: { not: null } },
          orderBy: { validFrom: "asc" },
        }),
        prisma.consultant.findMany({
          where: { active: true },
          select: { id: true, fullName: true, country: true },
          orderBy: { fullName: "asc" },
        }),
      ]);

      return {
        data: {
          // El último escalón, para poder explicarlo en pantalla sin repetirlo.
          general: JORNADA_GENERAL,
          paisGeneral: PAIS_GENERAL,
          countries: todasPais.map(serializar),
          consultants: consultores.map((c) => {
            const filas = filasConsultor.filter((f) => f.consultantId === c.id);
            const vigente = filas.filter((f) => f.validFrom <= hoy).at(-1) ?? null;
            const efectiva = resolverJornada(vigente, c.country, vigentesPais);
            return {
              consultantId: c.id,
              fullName: c.fullName,
              country: c.country,
              /** Fila propia vigente hoy, o `null` si hereda. */
              propia: vigente ? serializar(vigente) : null,
              /** Todas las filas propias (historial y futuras). */
              filas: filas.map(serializar),
              efectiva,
            };
          }),
        },
      };
    },
  );

  // ── Jornada efectiva de cada consultor activo, a una fecha ────────────────
  // La usa el informe semanal para separar las horas extra de cada persona
  // contra su propia jornada. No expone tarifas ni costos. Abierta a todo rol
  // autenticado.
  app.get(
    "/workday/effective",
    { preHandler: [authenticate] },
    async (request) => {
      const { date } = effectiveQuerySchema.parse(request.query);
      const fecha = date ? fromIsoDate(date) : hoyUtc();

      const [filasPais, consultores] = await Promise.all([
        cargarJornadasPorPais(fecha),
        prisma.consultant.findMany({
          where: { active: true },
          select: { id: true, country: true, capacityConfigs: jornadaVigenteDe(fecha) },
        }),
      ]);

      const general = resolverJornada(null, null, filasPais);

      const data: {
        date: string;
        general: JornadaEfectiva;
        consultants: ({ consultantId: string } & JornadaEfectiva)[];
      } = {
        date: toIsoDate(fecha),
        general,
        consultants: consultores.map((c) => ({
          consultantId: c.id,
          ...resolverJornada(c.capacityConfigs[0] ?? null, c.country, filasPais),
        })),
      };

      return { data };
    },
  );

  // ── Jornada de un país ────────────────────────────────────────────────────
  app.put(
    "/workday/country/:country",
    { preHandler: [authenticate, requirePermission("capacity:config")] },
    async (request) => {
      const { country } = countryParamSchema.parse(request.params);
      const payload = payloadSchema.parse(request.body);
      const validFrom = fromIsoDate(payload.validFrom);

      const antes = await prisma.capacityConfig.findUnique({
        where: { country_validFrom: { country, validFrom } },
      });

      const fila = await prisma.capacityConfig.upsert({
        where: { country_validFrom: { country, validFrom } },
        update: { hoursPerDay: payload.hoursPerDay, workDaysPerWeek: payload.workDaysPerWeek },
        create: {
          country,
          consultantId: null,
          validFrom,
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
    { preHandler: [authenticate, requirePermission("capacity:config")] },
    async (request, reply) => {
      const { country } = countryParamSchema.parse(request.params);
      const { validFrom: validFromIso } = validFromQuerySchema.parse(request.query);
      const validFrom = fromIsoDate(validFromIso);

      const fila = await prisma.capacityConfig.findUnique({
        where: { country_validFrom: { country, validFrom } },
      });
      if (!fila) return reply.status(404).send({ message: "Ese país no tiene jornada con esa vigencia" });

      // La fila general vigente no se puede borrar: es el suelo de la precedencia
      // y sin ella un país sin configurar caería en la constante del código.
      if (country === PAIS_GENERAL) {
        const hoy = hoyUtc();
        const otrasVigentes = await prisma.capacityConfig.count({
          where: {
            country: PAIS_GENERAL,
            consultantId: null,
            validFrom: { lte: hoy },
            id: { not: fila.id },
          },
        });
        if (fila.validFrom <= hoy && otrasVigentes === 0) {
          return reply.status(409).send({
            message: "La jornada general no se puede eliminar; edítela en lugar de borrarla.",
          });
        }
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

  // ── Jornada de un consultor (excepción sobre la de su país) ───────────────
  app.put(
    "/workday/consultant/:consultantId",
    { preHandler: [authenticate, requirePermission("capacity:config")] },
    async (request, reply) => {
      const { consultantId } = consultantParamSchema.parse(request.params);
      const payload = payloadSchema.parse(request.body);
      const validFrom = fromIsoDate(payload.validFrom);

      const consultor = await prisma.consultant.findUnique({ where: { id: consultantId } });
      if (!consultor) return reply.status(404).send({ message: "Consultor no encontrado" });

      const antes = await prisma.capacityConfig.findUnique({
        where: { consultantId_validFrom: { consultantId, validFrom } },
      });

      const fila = await prisma.capacityConfig.upsert({
        where: { consultantId_validFrom: { consultantId, validFrom } },
        update: { hoursPerDay: payload.hoursPerDay, workDaysPerWeek: payload.workDaysPerWeek },
        create: {
          consultantId,
          // Una fila de consultor no lleva país: el país se hereda del consultor.
          country: null,
          validFrom,
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
    { preHandler: [authenticate, requirePermission("capacity:config")] },
    async (request, reply) => {
      const { consultantId } = consultantParamSchema.parse(request.params);
      const { validFrom: validFromIso } = validFromQuerySchema.parse(request.query);

      const fila = await prisma.capacityConfig.findUnique({
        where: { consultantId_validFrom: { consultantId, validFrom: fromIsoDate(validFromIso) } },
      });
      if (!fila) {
        return reply
          .status(404)
          .send({ message: "Ese consultor no tiene jornada propia con esa vigencia" });
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
