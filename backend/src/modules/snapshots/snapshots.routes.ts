import { AppRole, TimeEntryStatus } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import {
  buildRateBook,
  hasUndatedRates,
  undatedRatePairs,
  describeUndatedRates,
  conversionStatus,
  createConversionLedger,
  convertAmountFallbackOnDate,
  describeMissingRates,
  hasMissingRates,
  missingRatePairs,
} from "../../utils/currency.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";

const closePayloadSchema = z.object({
  projectId: z.string().min(1),
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  baseCurrency: z.string().trim().toUpperCase().length(3).default("USD"),
});

const listQuerySchema = z.object({
  projectId: z.string().optional(),
  year: z.coerce.number().int().optional(),
  month: z.coerce.number().int().optional(),
});

export async function snapshotsRoutes(app: FastifyInstance) {
  // POST /api/snapshots/close — cierra el mes para un proyecto
  app.post(
    "/close",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.FINANCE])] },
    async (request, reply) => {
      const payload = closePayloadSchema.parse(request.body);
      const { projectId, year, month, baseCurrency } = payload;
      const performedBy = request.authUser!.email;

      const existing = await prisma.monthlySnapshot.findUnique({
        where: { projectId_year_month: { projectId, year, month } },
      });
      if (existing) {
        return reply.status(409).send({
          message: `Ya existe un cierre para este proyecto en ${year}-${String(month).padStart(2, "0")}`,
        });
      }

      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) return reply.status(404).send({ message: "Proyecto no encontrado" });

      const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
      const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

      const [fxConfigs, fxHistory, timeEntries, expenses, revenueEntries] = await Promise.all([
        prisma.fxConfig.findMany(),
        prisma.fxRateHistory.findMany({
          select: { baseCode: true, quoteCode: true, rate: true, effectiveDate: true },
          orderBy: { effectiveDate: "asc" },
        }),
        prisma.timeEntry.findMany({
          where: {
            projectId,
            status: TimeEntryStatus.APPROVED,
            workDate: { gte: startOfMonth, lte: endOfMonth },
          },
          include: { consultant: { select: { hourlyRate: true, rateCurrency: true } } },
        }),
        prisma.financialEntry.findMany({
          where: { projectId, type: "EXPENSE", entryDate: { gte: startOfMonth, lte: endOfMonth } },
        }),
        prisma.financialEntry.findMany({
          where: { projectId, type: "REVENUE", entryDate: { gte: startOfMonth, lte: endOfMonth } },
        }),
      ]);

      // R-008/R-012: el cierre valora cada movimiento a SU fecha, que es
      // justamente lo que un cierre contable necesita: congelar el mes con los
      // tipos de cambio de ese mes, no con los del día en que se pulsa el botón.
      const rateBook = buildRateBook(fxConfigs, fxHistory);
      // DEP-32. El cierre mensual es el único sitio donde el total NO se puede
      // "degradar con aviso": se congela en `MonthlySnapshot` y se consulta
      // después sin ningún canal que lleve la advertencia (la tabla no tiene
      // columna para ello y añadirla exige migración). Por eso aquí la
      // conversión incompleta bloquea la escritura con 422 en vez de guardar un
      // número aproximado como si fuera exacto. Es un fallo accionable y
      // reintentable: basta cargar la tasa que falta y volver a cerrar.
      const ledger = createConversionLedger();

      const laborCostActual = timeEntries.reduce((s, e) => {
        const rate = Number(e.consultant.hourlyRate ?? 0);
        return (
          s +
          convertAmountFallbackOnDate(
            Number(e.hours) * rate, e.consultant.rateCurrency, baseCurrency, e.workDate, rateBook, ledger,
          )
        );
      }, 0);

      const expensesActual = expenses.reduce(
        (s, e) =>
          s + convertAmountFallbackOnDate(Number(e.amount), e.currency, baseCurrency, e.entryDate, rateBook, ledger),
        0,
      );

      const revenueRecognized = revenueEntries.reduce(
        (s, r) =>
          s + convertAmountFallbackOnDate(Number(r.amount), r.currency, baseCurrency, r.entryDate, rateBook, ledger),
        0,
      );

      // R-033: el valor del contrato se valora a la fecha de contratación, no
      // a la del cierre. Si no, cada cierre mensual reexpresaba el mismo
      // contrato con una tasa distinta y la serie de meses no era comparable.
      const contractValue = project.sellPrice
        ? convertAmountFallbackOnDate(
            Number(project.sellPrice),
            project.sellCurrency,
            baseCurrency,
            project.startDate ?? endOfMonth,
            rateBook,
            ledger,
          )
        : 0;

      if (hasMissingRates(ledger)) {
        const missingPairs = missingRatePairs(ledger);
        request.log.warn(
          { endpoint: "POST /api/snapshots/close", projectId, year, month, baseCurrency, missingPairs },
          describeMissingRates(missingPairs),
        );
        return reply.status(422).send({
          message:
            `No se puede cerrar ${year}-${String(month).padStart(2, "0")}: faltan tasas de cambio ` +
            `(${missingPairs.join(", ")}). Cargue las tasas en Tasas FX y vuelva a intentarlo.`,
          conversion: conversionStatus(ledger),
        });
      }

      const totalCostActual = laborCostActual + expensesActual;
      const grossMargin = revenueRecognized - totalCostActual;
      const grossMarginPct = revenueRecognized > 0 ? (grossMargin / revenueRecognized) * 100 : 0;
      const hoursApproved = timeEntries.reduce((s, e) => s + Number(e.hours), 0);

      // Snapshot de tasas FX en el momento del cierre
      const fxSnapshotJson: Record<string, number | string[]> = {};
      for (const fx of fxConfigs) {
        fxSnapshotJson[`${fx.baseCode}->${fx.quoteCode}`] = Number(fx.rate);
      }

      // R-008/R-012: si algún importe se valoró con la tasa de HOY por no haber
      // histórico anterior a su fecha, el cierre NO se bloquea (sería imposible
      // cerrar mientras el histórico está poco poblado) pero la aproximación se
      // congela junto a las cifras. `fxSnapshotJson` es Json libre, así que
      // cabe sin migración y el dato queda donde se consulta el cierre.
      if (hasUndatedRates(ledger)) {
        const undatedPairs = undatedRatePairs(ledger);
        fxSnapshotJson.__aproximacionPorFecha = undatedPairs;
        request.log.warn(
          { endpoint: "POST /api/snapshots/close", projectId, year, month, baseCurrency, undatedPairs },
          describeUndatedRates(undatedPairs),
        );
      }

      const snapshot = await prisma.monthlySnapshot.create({
        data: {
          projectId,
          year,
          month,
          baseCurrency,
          laborCostActual,
          expensesActual,
          totalCostActual,
          revenueRecognized,
          contractValue,
          grossMargin,
          grossMarginPct,
          hoursApproved,
          fxSnapshotJson,
          closedBy: performedBy,
          closedAt: new Date(),
        },
      });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.monthlySnapshot,
        entityId: snapshot.id,
        action: "CLOSE",
        changedBy: performedBy,
        after: { projectId, year, month, baseCurrency, grossMargin, grossMarginPct } as Record<string, unknown>,
        request,
      });

      return reply.status(201).send({ data: snapshot });
    },
  );

  // GET /api/snapshots
  app.get(
    "/",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER])] },
    async (request) => {
      const query = listQuerySchema.parse(request.query);
      const snapshots = await prisma.monthlySnapshot.findMany({
        where: {
          projectId: query.projectId,
          year: query.year,
          month: query.month,
        },
        include: { project: { select: { id: true, name: true, company: true } } },
        orderBy: [{ year: "desc" }, { month: "desc" }],
      });
      return { data: snapshots };
    },
  );

  // GET /api/snapshots/trend/:projectId
  app.get(
    "/trend/:projectId",
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE, AppRole.VIEWER])] },
    async (request, reply) => {
      const { projectId } = z.object({ projectId: z.string().min(1) }).parse(request.params);
      const query = z
        .object({ from: z.string().regex(/^\d{4}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}$/).optional() })
        .parse(request.query);

      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) return reply.status(404).send({ message: "Proyecto no encontrado" });

      const snapshots = await prisma.monthlySnapshot.findMany({
        where: { projectId },
        orderBy: [{ year: "asc" }, { month: "asc" }],
      });

      const filtered = snapshots.filter((s) => {
        const key = `${s.year}-${String(s.month).padStart(2, "0")}`;
        if (query.from && key < query.from) return false;
        if (query.to && key > query.to) return false;
        return true;
      });

      return { data: { project: { id: project.id, name: project.name }, trend: filtered } };
    },
  );
}
