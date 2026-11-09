import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";
import { MONEDA_TASA_NEGOCIADA, describeMissingRates, negotiatedFxFromProject } from "../../utils/currency.js";
import {
  DEFAULT_MARGIN_CRITICAL_PCT,
  DEFAULT_MARGIN_WARNING_PCT,
  calculateProfitability,
  marginThresholdsAreCoherent,
  splitFinancialEntries,
  toRiskCostInputs,
} from "../../utils/financial.js";
import { cargarUmbralesSalud } from "../admin/health-thresholds.routes.js";
import { SOLO_TRABAJADAS } from "../../utils/horasEjecutadas.js";

/**
 * Correo del Project Manager del proyecto (DEP-37).
 *
 * Es **opcional y nulable**: un proyecto sin PM asignado sigue siendo válido, y
 * así estaban todos los que existían antes de este cambio.
 *
 * - `""` (lo que manda un formulario con el campo vacío) se normaliza a `null`,
 *   que es como se desasigna el PM.
 * - `undefined` (el campo no viene en la petición) se deja pasar tal cual: en el
 *   `PUT` significa "no tocar", igual que hace `description`.
 * - El valor se guarda en **minúsculas** porque todas las comparaciones del
 *   backend (`getExtraHourAuthLevel`, el alcance por rol de `time-entries`,
 *   `extra-hours` y `activities`) usan `toLowerCase()` contra el correo del token.
 */
const projectManagerEmailSchema = z
  .union([
    z.literal(""),
    z.string().trim().toLowerCase().email("projectManagerEmail debe ser un correo válido"),
  ])
  .nullish()
  .transform((valor) => (valor === "" ? null : valor));

/**
 * Umbrales porcentuales configurables por proyecto (`marginWarningPct`,
 * `marginCriticalPct` y `budgetAlertPct`).
 *
 * Hasta R10 no estaban en este esquema, así que **no se podían asignar desde la
 * aplicación**: la columna quedaba siempre nula y todo caía al valor por defecto
 * (ver `DEFAULT_MARGIN_WARNING_PCT`, `DEFAULT_MARGIN_CRITICAL_PCT` y
 * `DEFAULT_BUDGET_ALERT_PCT` en
 * `utils/financial.ts`). Es el mismo defecto que tenía `projectManagerEmail`
 * antes de R7: el backend leía un campo que nadie podía escribir.
 *
 * El cero es un valor legítimo y NO cae al default.
 *
 * Los campos se tratan distinto a propósito, porque el esquema de datos los
 * declara distinto: los dos de margen son `Decimal?` (nulables), así que una
 * cadena vacía los desasigna y vuelven a null.
 *
 * DESDE D-7 `budgetAlertPct` también es nulable y se comporta igual que los de
 * margen: vaciar el campo significa "este proyecto no tiene umbral propio,
 * hereda el general de `HealthThresholdConfig`". Antes era
 * `Decimal @default(90)` NOT NULL, con lo que ninguna fila podía heredar nada
 * y el valor general de la empresa no habría llegado a aplicarse nunca.
 */
const umbralBase = z.coerce
  .number()
  .min(0, "el umbral no puede ser negativo")
  .max(100, "el umbral no puede superar 100");

const umbralNulableSchema = z
  .union([z.literal(""), umbralBase])
  .nullish()
  .transform((valor) => (valor === "" ? null : valor));

/**
 * Categoría de proyecto (R-010). Mismo patrón que `projectManagerEmailSchema`:
 * `""` desasigna (se guarda `null`), `undefined` significa "no tocar" en el
 * `PUT`. El valor se resuelve contra el catálogo (o se agrega solo) en
 * `resolverOInsertarCategoria`, no aquí: Zod solo valida la forma.
 */
const categorySchema = z
  .union([z.literal(""), z.string().trim().min(1).max(100)])
  .nullish()
  .transform((valor) => (valor === "" ? null : valor));

/**
 * Resuelve el nombre de categoría contra `ProjectCategory` sin distinguir
 * mayúsculas (para no crear "Soporte" y "soporte" como filas distintas) y, si
 * no existe, la agrega sola. Es lo que permite "personalizar" el desplegable
 * sin una pantalla de administración aparte: la categoría que alguien escriba
 * en el formulario de un proyecto queda disponible para los próximos.
 */
async function resolverOInsertarCategoria(
  category: string | null | undefined,
): Promise<string | null | undefined> {
  if (category === undefined) return undefined;
  if (category === null) return null;
  const existente = await prisma.projectCategory.findFirst({
    where: { name: { equals: category, mode: "insensitive" } },
  });
  if (existente) return existente.name;
  const creada = await prisma.projectCategory.create({ data: { name: category } });
  return creada.name;
}


const projectPayloadBaseSchema = z.object({
  name: z.string().trim().min(1),
  // Obligatorio al crear; en el PUT es opcional (si no viene se conserva la empresa actual).
  companyId: z.string().trim().min(1, "companyId no puede estar vacío").optional(),
  country: z.string().trim().min(1),
  currency: z
    .string()
    .trim()
    .length(3, "currency must be a 3-letter ISO code")
    .transform((value) => value.toUpperCase()),
  budget: z.coerce.number().nonnegative(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  description: z.string().trim().optional(),
  projectType: z.enum(["FIXED_PRICE", "TIME_AND_MATERIAL", "STAFFING"]).default("TIME_AND_MATERIAL"),
  status: z.enum(["PROSPECT", "ACTIVE", "PAUSED", "CLOSED"]).default("ACTIVE"),
  // Proyecto interno / stand-by; si no se envía, un PUT conserva el valor actual.
  isInternal: z.boolean().optional(),
  category: categorySchema,
  sellPrice: z.coerce.number().positive().optional(),
  sellCurrency: z.string().trim().toUpperCase().length(3).default("USD"),
  // Tasa negociada con el cliente: "1 USD = X" en la moneda del proyecto (o la
  // de venta si el proyecto está en USD). null = quitarla; omitida en el PUT =
  // conservar la actual. La moneda la deduce el servidor (`resolverTasaNegociada`).
  negotiatedFxRate: z.coerce.number().positive("la tasa negociada debe ser mayor que 0").nullable().optional(),
  projectManagerEmail: projectManagerEmailSchema,
  marginWarningPct: umbralNulableSchema,
  marginCriticalPct: umbralNulableSchema,
  budgetAlertPct: umbralNulableSchema,
});

/**
 * Coherencia de los dos umbrales de margen (D-2): el crítico es un suelo, así
 * que no puede quedar por encima del de advertencia. Se valida sobre los valores
 * YA resueltos (`marginThresholdsAreCoherent`), porque dejar un campo vacío
 * significa "usa el de la empresa" y ese también entra en la comparación: poner
 * crítico 40 y dejar la advertencia en blanco es incoherente contra el 30 por
 * defecto, aunque el formulario no haya escrito nada.
 */
const projectPayloadSchema = projectPayloadBaseSchema.superRefine(validarUmbralesCoherentes);

/** POST: igual que el PUT pero `companyId` es obligatorio. */
const projectCreateSchema = projectPayloadBaseSchema
  .extend({ companyId: z.string().trim().min(1, "companyId es obligatorio") })
  .superRefine(validarUmbralesCoherentes);

function validarUmbralesCoherentes(
  body: { marginWarningPct?: number | null; marginCriticalPct?: number | null },
  ctx: z.RefinementCtx,
) {
  if (!marginThresholdsAreCoherent(body.marginWarningPct, body.marginCriticalPct)) {
    ctx.addIssue({
      code: "custom",
      path: ["marginCriticalPct"],
      message:
        "el umbral crítico de margen no puede ser mayor que el de advertencia " +
        `(advertencia por defecto: ${DEFAULT_MARGIN_WARNING_PCT}%, crítico por defecto: ${DEFAULT_MARGIN_CRITICAL_PCT}%)`,
    });
  }
}

const INCLUIR_EMPRESA = { company: { select: { id: true, name: true } } } as const;

/**
 * Moneda a la que se refiere la tasa negociada ("1 USD = X <moneda>"): la del
 * proyecto, o la de venta si el proyecto está en USD. `null` si ambas son USD,
 * en cuyo caso no hay nada que negociar.
 */
function monedaTasaNegociada(currency: string, sellCurrency: string): string | null {
  if (currency !== MONEDA_TASA_NEGOCIADA) return currency;
  if (sellCurrency !== MONEDA_TASA_NEGOCIADA) return sellCurrency;
  return null;
}

/**
 * Valida y resuelve las dos columnas de la tasa negociada. En el PUT, si la tasa
 * no viene se conserva la actual, pero solo si sigue refiriéndose a la misma
 * moneda: si el proyecto cambió de moneda, una tasa de COP no puede pasar a
 * leerse como de MXN sin que nadie lo decida.
 */
function resolverTasaNegociada(
  body: { negotiatedFxRate?: number | null; currency: string; sellCurrency: string },
  existente?: { negotiatedFxRate: unknown; negotiatedFxCurrency: string | null },
): { error: string } | { negotiatedFxRate: number | null; negotiatedFxCurrency: string | null } {
  const moneda = monedaTasaNegociada(body.currency, body.sellCurrency);
  let tasa = body.negotiatedFxRate;
  if (tasa === undefined) {
    if (!existente || existente.negotiatedFxRate == null) return { negotiatedFxRate: null, negotiatedFxCurrency: null };
    if (existente.negotiatedFxCurrency !== moneda) {
      return { error: "La moneda del proyecto cambió: vuelve a indicar la tasa negociada o quítala." };
    }
    tasa = Number(existente.negotiatedFxRate);
  }
  if (tasa === null) return { negotiatedFxRate: null, negotiatedFxCurrency: null };
  if (!moneda) {
    return { error: "El proyecto está en USD: no necesita tasa negociada." };
  }
  return { negotiatedFxRate: tasa, negotiatedFxCurrency: moneda };
}

/** Compatibilidad: `company` sigue siendo el nombre (string) y se agrega `companyId` (ya viene en la fila). */
function aplanarEmpresa<T extends { company: { name: string } }>(project: T): Omit<T, "company"> & { company: string } {
  return { ...project, company: project.company.name };
}

/**
 * La empresa debe existir y estar activa. `empresaActualId` permite conservar la empresa que el
 * proyecto ya tiene aunque se haya desactivado después (editar un proyecto no debe obligar a moverlo).
 */
async function validarEmpresa(companyId: string, empresaActualId?: string): Promise<string | null> {
  const empresa = await prisma.company.findUnique({ where: { id: companyId }, select: { active: true } });
  if (!empresa) return "La empresa indicada no existe";
  if (!empresa.active && companyId !== empresaActualId) return "La empresa indicada está inactiva; elige una empresa activa";
  return null;
}

const listProjectsQuerySchema = z.object({
  company: z.string().trim().optional(),
  companyId: z.string().trim().optional(),
  country: z.string().trim().optional(),
  search: z.string().trim().optional(),
});

const projectParamsSchema = z.object({ id: z.string().min(1) });

function ensureDateRange(startDate: Date, endDate: Date) {
  if (endDate < startDate) {
    throw new Error("endDate cannot be before startDate");
  }
}

/**
 * Un CONSULTANT llega a `GET /api/projects` (y a `GET /api/projects/:id`) solo
 * por `estimations:read`, para el selector "Proyecto Vinculado" de
 * Estimaciones -- no tiene `projects:read`. Ese selector solo necesita
 * nombre e identificación básica, así que aquí se le recorta lo monetario del
 * portafolio entero (presupuesto, precio de venta, umbrales de margen y
 * presupuesto de línea base). Quien además tenga un rol con más alcance
 * (ADMIN/PM/FINANCE/VIEWER) sigue viendo el proyecto completo: el recorte es
 * por lo que la CUENTA puede ver, no por la ruta que usó para llegar.
 */
const CAMPOS_MONETARIOS_PROYECTO = [
  "budget",
  "sellPrice",
  "negotiatedFxRate",
  "marginWarningPct",
  "marginCriticalPct",
  "budgetAlertPct",
  "baselineBudget",
] as const;

function esSoloConsultant(roles: AppRole[]): boolean {
  return (
    roles.includes(AppRole.CONSULTANT) &&
    !roles.includes(AppRole.ADMIN) &&
    !roles.includes(AppRole.PM) &&
    !roles.includes(AppRole.FINANCE) &&
    !roles.includes(AppRole.VIEWER)
  );
}

function ocultarDatosMonetariosProyecto<T extends Record<string, unknown>>(
  project: T,
): Omit<T, (typeof CAMPOS_MONETARIOS_PROYECTO)[number]> {
  const copia: Record<string, unknown> = { ...project };
  for (const campo of CAMPOS_MONETARIOS_PROYECTO) {
    delete copia[campo];
  }
  return copia as Omit<T, (typeof CAMPOS_MONETARIOS_PROYECTO)[number]>;
}

export async function projectsRoutes(app: FastifyInstance) {
  app.get(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT, AppRole.FINANCE, AppRole.VIEWER])],
    },
    async (request) => {
    const query = listProjectsQuerySchema.parse(request.query);

    const projects = await prisma.project.findMany({
      where: {
        company: query.company ? { name: { equals: query.company, mode: "insensitive" } } : undefined,
        companyId: query.companyId || undefined,
        country: query.country ? { equals: query.country, mode: "insensitive" } : undefined,
        OR: query.search
          ? [
              { name: { contains: query.search, mode: "insensitive" } },
              { company: { name: { contains: query.search, mode: "insensitive" } } },
            ]
          : undefined,
      },
      include: INCLUIR_EMPRESA,
      orderBy: { createdAt: "desc" },
    });
    const filas = projects.map(aplanarEmpresa);

      const roles = request.authUser!.roles;
      const data = esSoloConsultant(roles)
        ? filas.map(ocultarDatosMonetariosProyecto)
        : filas;

      return { data };
    },
  );

  app.post(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])],
    },
    async (request, reply) => {
    const body = projectCreateSchema.parse(request.body);

    // R15: el PM del proyecto decide quién aprueba horas. Quien no es ADMIN solo puede ponerse a sí
    // mismo (o dejarlo vacío).
    if (!request.authUser!.roles.includes(AppRole.ADMIN)) {
      const pedido = (body.projectManagerEmail ?? "").trim().toLowerCase();
      if (pedido !== "" && pedido !== request.authUser!.email.trim().toLowerCase()) {
        return reply.status(403).send({ message: "Solo un administrador puede asignar a otra persona como PM del proyecto.", code: "PM_CHANGE_FORBIDDEN" });
      }
    }

    try {
      ensureDateRange(body.startDate, body.endDate);
    } catch (error) {
      return reply.status(400).send({ message: (error as Error).message });
    }

    const errorEmpresa = await validarEmpresa(body.companyId);
    if (errorEmpresa) return reply.status(400).send({ message: errorEmpresa });

    const tasaNegociada = resolverTasaNegociada(body);
    if ("error" in tasaNegociada) return reply.status(400).send({ message: tasaNegociada.error });

    const category = await resolverOInsertarCategoria(body.category);

    const creado = await prisma.project.create({
      include: INCLUIR_EMPRESA,
      data: {
        name: body.name,
        companyId: body.companyId,
        country: body.country,
        currency: body.currency,
        budget: body.budget,
        startDate: body.startDate,
        endDate: body.endDate,
        description: body.description,
        projectType: body.projectType,
        status: body.status,
        isInternal: body.isInternal,
        category,
        sellPrice: body.sellPrice,
        sellCurrency: body.sellCurrency,
        negotiatedFxRate: tasaNegociada.negotiatedFxRate,
        negotiatedFxCurrency: tasaNegociada.negotiatedFxCurrency,
        projectManagerEmail: body.projectManagerEmail,
        marginWarningPct: body.marginWarningPct,
        marginCriticalPct: body.marginCriticalPct,
        budgetAlertPct: body.budgetAlertPct,
      },
    });

    const project = aplanarEmpresa(creado);

    await writeAudit(prisma, {
      entity: AUDIT_ENTITIES.project,
      entityId: project.id,
      action: "CREATE",
      changedBy: request.authUser?.email ?? "system",
      after: project as unknown as Record<string, unknown>,
      request,
    });

      return reply.status(201).send({ data: project });
    },
  );

  app.get(
    "/:id",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT, AppRole.FINANCE, AppRole.VIEWER])],
    },
    async (request, reply) => {
    const { id } = projectParamsSchema.parse(request.params);

    const encontrado = await prisma.project.findUnique({ where: { id }, include: INCLUIR_EMPRESA });
    if (!encontrado) {
      return reply.status(404).send({ message: "Project not found" });
    }
    const project = aplanarEmpresa(encontrado);

      const roles = request.authUser!.roles;
      const data = esSoloConsultant(roles) ? ocultarDatosMonetariosProyecto(project) : project;

      return { data };
    },
  );

  app.put(
    "/:id",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])],
    },
    async (request, reply) => {
    const { id } = projectParamsSchema.parse(request.params);
    const body = projectPayloadSchema.parse(request.body);

    try {
      ensureDateRange(body.startDate, body.endDate);
    } catch (error) {
      return reply.status(400).send({ message: (error as Error).message });
    }

    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ message: "Project not found" });
    }

    // R15: un PM (no ADMIN) solo edita proyectos que ya dirige y no puede cambiar el PM: de eso
    // depende quién aprueba las horas.
    if (!request.authUser!.roles.includes(AppRole.ADMIN)) {
      const yo = request.authUser!.email.trim().toLowerCase();
      const actual = (existing.projectManagerEmail ?? "").trim().toLowerCase();
      if (actual !== yo) {
        return reply.status(403).send({ message: "Solo puedes editar los proyectos que diriges.", code: "NOT_PROJECT_MANAGER" });
      }
      if (body.projectManagerEmail !== undefined && (body.projectManagerEmail ?? "").trim().toLowerCase() !== actual) {
        return reply.status(403).send({ message: "Solo un administrador puede cambiar el PM del proyecto.", code: "PM_CHANGE_FORBIDDEN" });
      }
    }

    if (body.companyId !== undefined) {
      const errorEmpresa = await validarEmpresa(body.companyId, existing.companyId);
      if (errorEmpresa) return reply.status(400).send({ message: errorEmpresa });
    }

    const tasaNegociada = resolverTasaNegociada(body, existing);
    if ("error" in tasaNegociada) return reply.status(400).send({ message: tasaNegociada.error });

    const category = await resolverOInsertarCategoria(body.category);

    const actualizado = await prisma.project.update({
      where: { id },
      include: INCLUIR_EMPRESA,
      data: {
        name: body.name,
        companyId: body.companyId,
        country: body.country,
        currency: body.currency,
        budget: body.budget,
        startDate: body.startDate,
        endDate: body.endDate,
        description: body.description,
        projectType: body.projectType,
        status: body.status,
        isInternal: body.isInternal,
        category,
        sellPrice: body.sellPrice,
        sellCurrency: body.sellCurrency,
        negotiatedFxRate: tasaNegociada.negotiatedFxRate,
        negotiatedFxCurrency: tasaNegociada.negotiatedFxCurrency,
        projectManagerEmail: body.projectManagerEmail,
        marginWarningPct: body.marginWarningPct,
        marginCriticalPct: body.marginCriticalPct,
        budgetAlertPct: body.budgetAlertPct,
      },
    });

    const project = aplanarEmpresa(actualizado);

    await writeAudit(prisma, {
      entity: AUDIT_ENTITIES.project,
      entityId: project.id,
      action: "UPDATE",
      changedBy: request.authUser?.email ?? "system",
      before: existing as unknown as Record<string, unknown>,
      after: project as unknown as Record<string, unknown>,
      request,
    });

      return { data: project };
    },
  );

  app.delete(
    "/:id",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])],
    },
    async (request, reply) => {
    const { id } = projectParamsSchema.parse(request.params);

    const existing = await prisma.project.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ message: "Project not found" });
    }

    try {
      await prisma.project.delete({ where: { id } });
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === "P2003" || code === "P2014") {
        return reply.status(409).send({
          message: "Cannot delete project: it has related records that prevent deletion",
        });
      }
      throw err;
    }

    await writeAudit(prisma, {
      entity: AUDIT_ENTITIES.project,
      entityId: id,
      action: "DELETE",
      changedBy: request.authUser?.email ?? "system",
      before: existing as unknown as Record<string, unknown>,
      request,
    });

      return reply.status(204).send();
    },
  );

  // GET /api/projects/:id/profitability
  app.get(
    "/:id/profitability",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER])],
    },
    async (request, reply) => {
      const { id } = projectParamsSchema.parse(request.params);
      const { baseCurrency: qBase } = z.object({ baseCurrency: z.string().trim().toUpperCase().length(3).optional() }).parse(request.query);

      const project = await prisma.project.findUnique({
        where: { id },
        include: {
          timeEntries: {
            where: { status: "APPROVED", ...SOLO_TRABAJADAS },
            include: { consultant: { select: { hourlyRate: true, rateCurrency: true } } },
          },
          financialEntries: true,
          risks: { select: { estimatedCost: true, costCurrency: true, status: true, identifiedAt: true } },
        },
      });

      if (!project) return reply.status(404).send({ message: "Project not found" });

      const [fxConfigs, fxHistory] = await Promise.all([
        prisma.fxConfig.findMany(),
        prisma.fxRateHistory.findMany({
          select: { baseCode: true, quoteCode: true, rate: true, effectiveDate: true },
          orderBy: { effectiveDate: "asc" },
        }),
      ]);
      const baseCurrency = qBase ?? fxConfigs[0]?.baseCode ?? "USD";

      // Partición por `type` con el mismo helper que usa el cálculo unificado.
      const { expenses, revenueEntries } = splitFinancialEntries(project.financialEntries);

      const profitability = calculateProfitability({
        budget: Number(project.budget),
        budgetCurrency: project.currency,
        sellPrice: project.sellPrice ? Number(project.sellPrice) : null,
        sellCurrency: project.sellCurrency,
        marginWarningPct: project.marginWarningPct != null ? Number(project.marginWarningPct) : null,
        marginCriticalPct: project.marginCriticalPct != null ? Number(project.marginCriticalPct) : null,
        budgetAlertPct: project.budgetAlertPct != null ? Number(project.budgetAlertPct) : null,
        healthThresholds: await cargarUmbralesSalud(),
        revenueEntries,
        approvedTimeEntries: project.timeEntries.map((e) => ({
          consultantId: e.consultantId,
          hours: Number(e.hours),
          workDate: e.workDate,
          status: "APPROVED" as const,
          hourlyRate: e.consultant.hourlyRate ? Number(e.consultant.hourlyRate) : null,
          rateCurrency: e.consultant.rateCurrency,
        })),
        expenses,
        risks: toRiskCostInputs(project.risks),
        // ANTES (bug §10.2 #4): se reconstruía el rateMap con `key.split("_")`
        // cuando buildRateMap usa "->", así que TODAS las conversiones caían al
        // fallback (monto sin convertir). Se pasan los FxConfig crudos.
        fxConfigs,
        // R-008/R-012: con el histórico, cada importe se valora a su fecha.
        fxHistory,
        // R-033: presupuesto y precio de venta, a la fecha de contratación.
        valuationDate: project.startDate ?? new Date(),
        negotiatedFx: negotiatedFxFromProject(project),
        baseCurrency,
      });

      // DEP-32: si algún importe se sumó sin convertir, queda en el log del
      // servidor con el par exacto y viaja al cliente en `conversion`, que
      // `calculateProfitability` ya incluye en su resultado.
      if (profitability.conversion.incomplete) {
        request.log.warn(
          {
            endpoint: "/api/projects/:id/profitability",
            projectId: project.id,
            baseCurrency,
            missingPairs: profitability.conversion.missingPairs,
          },
          describeMissingRates(profitability.conversion.missingPairs),
        );
      }

      return {
        data: {
          projectId: project.id,
          projectName: project.name,
          projectType: project.projectType,
          currency: project.currency,
          baseCurrency,
          ...profitability,
        },
      };
    },
  );
}
