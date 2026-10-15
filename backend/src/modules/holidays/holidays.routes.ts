import { HolidaySource, Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requirePermission } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";
import { normalizeCountry } from "../../utils/country.js";
import { getHolidaysForYear } from "../../utils/holidays.js";
import { fromIsoDate, isValidIsoDate, toIsoDate } from "../../utils/isoDate.js";

/**
 * Feriados de capacity (CONTRATO §3.4). `Holiday` es la fuente única que usa el
 * cálculo mensual; `CustomHoliday` sigue vivo para horas extra y actividades.
 *
 * - Leer: cualquier rol autenticado (`holidays:read`).
 * - Escribir: solo ADMIN (`holidays:write`).
 * - Las fechas viajan como "YYYY-MM-DD" y se guardan como `@db.Date`; nunca se
 *   pasan por hora local, así que 2026-12-07 sale como 2026-12-07.
 * - `city = ""` es el feriado nacional.
 */

const isoDateSchema = z
  .string()
  .trim()
  .refine(isValidIsoDate, { message: "Fecha inválida, se espera YYYY-MM-DD" });

/** País normalizado ("Ecuador"); 400 si no está soportado. */
const countrySchema = z
  .string()
  .trim()
  .min(1)
  .transform((valor, ctx) => {
    try {
      return normalizeCountry(valor);
    } catch {
      ctx.addIssue({ code: "custom", message: `País no soportado: ${valor}` });
      return z.NEVER;
    }
  });

/** Ciudad recortada y con espacios simples. Vacía = feriado nacional. */
const citySchema = z
  .string()
  .transform((valor) => valor.trim().replace(/\s+/g, " "))
  .pipe(z.string().max(80));

const yearSchema = z.coerce.number().int().min(1900).max(3000);

const holidayPayloadSchema = z.object({
  country: countrySchema,
  city: citySchema.default(""),
  date: isoDateSchema,
  name: z.string().trim().min(1).max(200),
  source: z.nativeEnum(HolidaySource).default(HolidaySource.MANUAL),
});

const holidayUpdateSchema = z
  .object({
    country: countrySchema,
    city: citySchema,
    date: isoDateSchema,
    name: z.string().trim().min(1).max(200),
    source: z.nativeEnum(HolidaySource),
  })
  .partial()
  .refine((valor) => Object.keys(valor).length > 0, { message: "No hay campos para actualizar" });

const listQuerySchema = z.object({
  country: countrySchema.optional(),
  city: citySchema.optional(),
  year: yearSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

/** `from`/`to` de coverage: se aceptan "YYYY", "YYYY-MM" o "YYYY-MM-DD"; solo importa el año. */
const yearBoundSchema = z
  .string()
  .trim()
  .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, "Se espera YYYY, YYYY-MM o YYYY-MM-DD")
  .transform((valor) => Number(valor.slice(0, 4)));

const coverageQuerySchema = z.object({
  from: yearBoundSchema.optional(),
  to: yearBoundSchema.optional(),
});

const idParamSchema = z.object({ id: z.string().min(1) });
const generateSchema = z.object({ country: countrySchema, year: yearSchema });
const calendarYearParamSchema = z.object({ country: countrySchema, year: yearSchema });
const citiesQuerySchema = z.object({ country: countrySchema.optional() });

function serializar(h: {
  id: string;
  country: string;
  city: string;
  date: Date;
  name: string;
  source: HolidaySource;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: h.id,
    country: h.country,
    city: h.city,
    date: toIsoDate(h.date),
    name: h.name,
    source: h.source,
    createdBy: h.createdBy,
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
  };
}

function esDuplicado(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

const MENSAJE_DUPLICADO = "Ya existe un feriado para ese país, ciudad y fecha.";

export async function holidaysRoutes(app: FastifyInstance) {
  // ── Listado ───────────────────────────────────────────────────────────────
  app.get(
    "/",
    { preHandler: [authenticate, requirePermission("holidays:read")] },
    async (request) => {
      const query = listQuerySchema.parse(request.query);

      const date: Prisma.DateTimeFilter = {};
      if (query.year !== undefined) {
        date.gte = fromIsoDate(`${String(query.year).padStart(4, "0")}-01-01`);
        date.lte = fromIsoDate(`${String(query.year).padStart(4, "0")}-12-31`);
      }
      if (query.from) date.gte = fromIsoDate(query.from);
      if (query.to) date.lte = fromIsoDate(query.to);

      const rows = await prisma.holiday.findMany({
        where: {
          ...(query.country ? { country: query.country } : {}),
          ...(query.city !== undefined ? { city: { equals: query.city, mode: "insensitive" } } : {}),
          ...(Object.keys(date).length > 0 ? { date } : {}),
        },
        orderBy: [{ date: "asc" }, { country: "asc" }, { city: "asc" }],
      });

      return { data: rows.map(serializar) };
    },
  );

  // ── Cobertura: ¿qué países y años tienen feriados cargados y confirmados? ──
  app.get(
    "/coverage",
    { preHandler: [authenticate, requirePermission("holidays:read")] },
    async (request) => {
      const query = coverageQuerySchema.parse(request.query);
      const anioActual = new Date().getUTCFullYear();
      const desde = query.from ?? anioActual;
      const hasta = query.to ?? query.from ?? anioActual;
      if (hasta < desde || hasta - desde > 10) {
        return { data: [] };
      }

      // Países de los consultores activos, normalizados (los no soportados se ignoran).
      const consultores = await prisma.consultant.findMany({
        where: { active: true, country: { not: null } },
        select: { country: true },
      });
      const paises = new Set<string>();
      for (const c of consultores) {
        try {
          paises.add(normalizeCountry(c.country!));
        } catch {
          // País libre o no soportado: no hay calendario que cubrir.
        }
      }
      paises.delete("Default");
      const listaPaises = [...paises].sort();
      if (listaPaises.length === 0) return { data: [] };

      const [feriados, confirmados] = await Promise.all([
        prisma.holiday.findMany({
          where: {
            country: { in: listaPaises },
            date: {
              gte: fromIsoDate(`${String(desde).padStart(4, "0")}-01-01`),
              lte: fromIsoDate(`${String(hasta).padStart(4, "0")}-12-31`),
            },
          },
          select: { country: true, date: true },
        }),
        prisma.holidayCalendarYear.findMany({
          where: { country: { in: listaPaises }, year: { gte: desde, lte: hasta } },
        }),
      ]);

      const conteo = new Map<string, number>();
      for (const f of feriados) {
        const clave = `${f.country}|${f.date.getUTCFullYear()}`;
        conteo.set(clave, (conteo.get(clave) ?? 0) + 1);
      }
      const confirmadoDe = new Map(confirmados.map((c) => [`${c.country}|${c.year}`, c]));

      const data: {
        country: string;
        year: number;
        holidayCount: number;
        confirmed: boolean;
        confirmedBy: string | null;
        confirmedAt: Date | null;
      }[] = [];
      for (const country of listaPaises) {
        for (let year = desde; year <= hasta; year++) {
          const confirmacion = confirmadoDe.get(`${country}|${year}`);
          data.push({
            country,
            year,
            holidayCount: conteo.get(`${country}|${year}`) ?? 0,
            confirmed: Boolean(confirmacion),
            confirmedBy: confirmacion?.confirmedBy ?? null,
            confirmedAt: confirmacion?.confirmedAt ?? null,
          });
        }
      }

      return { data };
    },
  );

  // ── Ciudades conocidas (de feriados y de consultores) ─────────────────────
  app.get(
    "/cities",
    { preHandler: [authenticate, requirePermission("holidays:read")] },
    async (request) => {
      const { country } = citiesQuerySchema.parse(request.query);

      const [deFeriados, deConsultores] = await Promise.all([
        prisma.holiday.findMany({
          where: { city: { not: "" }, ...(country ? { country } : {}) },
          select: { city: true },
          distinct: ["city"],
        }),
        prisma.consultant.findMany({
          where: {
            city: { not: null },
            ...(country ? { country: { equals: country, mode: "insensitive" } } : {}),
          },
          select: { city: true },
          distinct: ["city"],
        }),
      ]);

      // Sin distinguir mayúsculas: "quito" y "Quito" son la misma ciudad.
      const vistas = new Map<string, string>();
      for (const { city } of [...deFeriados, ...deConsultores]) {
        const limpia = (city ?? "").trim().replace(/\s+/g, " ");
        if (limpia && !vistas.has(limpia.toLowerCase())) vistas.set(limpia.toLowerCase(), limpia);
      }

      return { data: [...vistas.values()].sort((a, b) => a.localeCompare(b, "es")) };
    },
  );

  // ── Alta ──────────────────────────────────────────────────────────────────
  app.post(
    "/",
    { preHandler: [authenticate, requirePermission("holidays:write")] },
    async (request, reply) => {
      const payload = holidayPayloadSchema.parse(request.body);

      try {
        const row = await prisma.holiday.create({
          data: {
            country: payload.country,
            city: payload.city,
            date: fromIsoDate(payload.date),
            name: payload.name,
            source: payload.source,
            createdBy: request.authUser!.email,
          },
        });

        await writeAudit(prisma, {
          entity: AUDIT_ENTITIES.holiday,
          entityId: row.id,
          action: "CREATE",
          changedBy: request.authUser!.email,
          after: serializar(row),
          request,
        });

        return reply.status(201).send({ data: serializar(row) });
      } catch (err) {
        if (esDuplicado(err)) return reply.status(409).send({ message: MENSAJE_DUPLICADO });
        throw err;
      }
    },
  );

  // ── Generación desde el calendario del país ───────────────────────────────
  app.post(
    "/generate",
    { preHandler: [authenticate, requirePermission("holidays:write")] },
    async (request) => {
      const { country, year } = generateSchema.parse(request.body);
      const generados = getHolidaysForYear(year, country);

      // Fechas que el país ya tiene como feriado nacional: no se duplican ni se
      // pisan (puede haber una edición manual o por decreto).
      const existentes = await prisma.holiday.findMany({
        where: {
          country,
          city: "",
          date: {
            gte: fromIsoDate(`${String(year).padStart(4, "0")}-01-01`),
            lte: fromIsoDate(`${String(year).padStart(4, "0")}-12-31`),
          },
        },
        select: { date: true },
      });
      const ocupadas = new Set(existentes.map((e) => toIsoDate(e.date)));

      const nuevos: { date: Date; name: string }[] = [];
      for (const g of generados) {
        const iso = toIsoDate(g.date);
        if (ocupadas.has(iso)) continue;
        ocupadas.add(iso);
        nuevos.push({ date: fromIsoDate(iso), name: g.name });
      }

      const creados = nuevos.length
        ? await prisma.holiday.createManyAndReturn({
            data: nuevos.map((n) => ({
              country,
              city: "",
              date: n.date,
              name: n.name,
              source: HolidaySource.GENERATED,
              createdBy: request.authUser!.email,
            })),
            skipDuplicates: true,
          })
        : [];

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.holiday,
        entityId: `generate:${country}:${year}`,
        action: "CREATE",
        changedBy: request.authUser!.email,
        after: {
          country,
          year,
          created: creados.length,
          skipped: generados.length - creados.length,
        },
        request,
      });

      return {
        data: {
          created: creados.map(serializar).sort((a, b) => a.date.localeCompare(b.date)),
          skipped: generados.length - creados.length,
        },
      };
    },
  );

  // ── Edición y baja ────────────────────────────────────────────────────────
  app.put(
    "/:id",
    { preHandler: [authenticate, requirePermission("holidays:write")] },
    async (request, reply) => {
      const { id } = idParamSchema.parse(request.params);
      const payload = holidayUpdateSchema.parse(request.body);

      const antes = await prisma.holiday.findUnique({ where: { id } });
      if (!antes) return reply.status(404).send({ message: "Feriado no encontrado." });

      try {
        const row = await prisma.holiday.update({
          where: { id },
          data: {
            ...(payload.country !== undefined ? { country: payload.country } : {}),
            ...(payload.city !== undefined ? { city: payload.city } : {}),
            ...(payload.date !== undefined ? { date: fromIsoDate(payload.date) } : {}),
            ...(payload.name !== undefined ? { name: payload.name } : {}),
            ...(payload.source !== undefined ? { source: payload.source } : {}),
          },
        });

        await writeAudit(prisma, {
          entity: AUDIT_ENTITIES.holiday,
          entityId: id,
          action: "UPDATE",
          changedBy: request.authUser!.email,
          before: serializar(antes),
          after: serializar(row),
          request,
        });

        return { data: serializar(row) };
      } catch (err) {
        if (esDuplicado(err)) return reply.status(409).send({ message: MENSAJE_DUPLICADO });
        throw err;
      }
    },
  );

  app.delete(
    "/:id",
    { preHandler: [authenticate, requirePermission("holidays:write")] },
    async (request, reply) => {
      const { id } = idParamSchema.parse(request.params);

      const antes = await prisma.holiday.findUnique({ where: { id } });
      if (!antes) return reply.status(404).send({ message: "Feriado no encontrado." });

      await prisma.holiday.delete({ where: { id } });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.holiday,
        entityId: id,
        action: "DELETE",
        changedBy: request.authUser!.email,
        before: serializar(antes),
        request,
      });

      return reply.status(204).send();
    },
  );

  // ── Confirmación del calendario de un año ─────────────────────────────────
  app.put(
    "/calendar-years/:country/:year",
    { preHandler: [authenticate, requirePermission("holidays:write")] },
    async (request) => {
      const { country, year } = calendarYearParamSchema.parse(request.params);
      const usuario = request.authUser!.email;

      const antes = await prisma.holidayCalendarYear.findUnique({
        where: { country_year: { country, year } },
      });

      const row = await prisma.holidayCalendarYear.upsert({
        where: { country_year: { country, year } },
        update: { confirmedBy: usuario, confirmedAt: new Date() },
        create: { country, year, confirmedBy: usuario },
      });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.holidayCalendarYear,
        entityId: `${country}-${year}`,
        action: antes ? "UPDATE" : "CREATE",
        changedBy: usuario,
        before: antes as unknown as Record<string, unknown> | null,
        after: row as unknown as Record<string, unknown>,
        request,
      });

      return { data: row };
    },
  );

  app.delete(
    "/calendar-years/:country/:year",
    { preHandler: [authenticate, requirePermission("holidays:write")] },
    async (request, reply) => {
      const { country, year } = calendarYearParamSchema.parse(request.params);

      const antes = await prisma.holidayCalendarYear.findUnique({
        where: { country_year: { country, year } },
      });
      if (!antes) return reply.status(404).send({ message: "Ese año no está confirmado." });

      await prisma.holidayCalendarYear.delete({ where: { country_year: { country, year } } });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.holidayCalendarYear,
        entityId: `${country}-${year}`,
        action: "DELETE",
        changedBy: request.authUser!.email,
        before: antes as unknown as Record<string, unknown>,
        request,
      });

      return reply.status(204).send();
    },
  );
}
