import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppRole, Prisma, TimeEntryCategory, TimeEntryStatus, TimesheetReviewStatus } from "@prisma/client";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { getLogger } from "../../infra/logger.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";
import { addDaysIso, fromIsoDate, toIsoDate, type IsoDate } from "../../utils/isoDate.js";
import { notifyTimesheetReturned } from "../../utils/notifications.js";
import type { TimeEntryCategory as RuleCategory, TimeEntryStatus as RuleStatus } from "../../utils/timesheetRules.js";
import {
  buildReviewRows,
  resolveReviewer,
  type ConsultantReviewContext,
  type ResolveReviewerResult,
} from "../../utils/timesheetWeek.js";
import { loadDaysContext, lockDay } from "../time-entries/day-context.service.js";
import { loadTypes, saveDayGroup, syncAbsenceBlock, type AuditEvent } from "../time-entries/timesheet.service.js";
import { closedMonthLocked, lockWeek, monthClosedMessage } from "./timesheet-weeks.service.js";
import { weekStartSchema } from "./timesheet-weeks.routes.js";

/**
 * Ser PM de un proyecto depende de `Project.projectManagerEmail`, no del rol de la cuenta: pueden
 * revisar todos los roles operativos y la regla real es `resolveReviewer`.
 */
const REVIEW_ROLES = [AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT, AppRole.FINANCE, AppRole.VIEWER];

const MAX_BATCH = 100;
/** Tope de revisiones que devuelve el listado (la pantalla filtra por semana). */
const MAX_LIST = 1000;

const listQuerySchema = z.object({
  weekStart: weekStartSchema.optional(),
  projectId: z.string().min(1).optional(),
  consultantId: z.string().min(1).optional(),
  status: z.enum(["SUBMITTED", "APPROVED", "RETURNED", "ALL"]).default("SUBMITTED"),
});

const itemSchema = z.object({
  consultantId: z.string().min(1),
  projectId: z.string().min(1),
  weekStart: weekStartSchema,
});

const approveSchema = z.object({ items: z.array(itemSchema).min(1).max(MAX_BATCH) });

const returnSchema = itemSchema.extend({
  note: z.string().trim().min(3, "La nota debe tener al menos 3 caracteres").max(1000, "La nota no puede superar los 1000 caracteres"),
});

type ReviewWithRefs = Prisma.TimesheetWeekReviewGetPayload<{
  include: {
    consultant: { select: { id: true; fullName: true; email: true; userId: true; user: { select: { email: true } } } };
    project: {
      select: {
        id: true;
        name: true;
        projectManagerEmail: true;
        isAbsenceProject: true;
        delegations: { select: { fromUserEmail: true; toUserEmail: true; startDate: true; endDate: true } };
      };
    };
  };
}>;

const REVIEW_INCLUDE = {
  consultant: { select: { id: true, fullName: true, email: true, userId: true, user: { select: { email: true } } } },
  project: {
    select: {
      id: true,
      name: true,
      projectManagerEmail: true,
      isAbsenceProject: true,
      delegations: { select: { fromUserEmail: true, toUserEmail: true, startDate: true, endDate: true } },
    },
  },
} as const;

/** Error de un ítem de aprobación/devolución: aborta la transacción y se responde con el culpable. */
class ItemError extends Error {
  constructor(
    public status: 400 | 403 | 404 | 409,
    public code: string,
    message: string,
    public index: number,
  ) {
    super(message);
  }
}

function actorOf(request: FastifyRequest) {
  const user = request.authUser!;
  return { email: user.email, roles: user.roles as readonly string[] };
}

function reviewerFor(request: FastifyRequest, review: ReviewWithRefs): ResolveReviewerResult {
  const user = request.authUser!;
  const pm = (review.project.projectManagerEmail ?? "").trim().toLowerCase();
  return resolveReviewer({
    projectManagerEmail: review.project.projectManagerEmail,
    consultantEmail: review.consultant.email,
    delegations: review.project.delegations,
    weekStart: toIsoDate(review.weekStart),
    actor: actorOf(request),
    // Identidad por id (H1 de la revisión de seguridad): el correo de la ficha puede ser null.
    actorIsConsultant: review.consultantId === user.consultantId || (!!review.consultant.userId && review.consultant.userId === user.id),
    projectManagerIsConsultant: pm !== "" && (review.consultant.user?.email ?? "").trim().toLowerCase() === pm,
  });
}

/**
 * Revisiones que el actor puede ver, ya filtradas con `resolveReviewer` fila por fila. Se acota
 * primero en la base (PM del proyecto, delegación, o ADMIN) y se afina en memoria.
 *
 * Con estado distinto de SUBMITTED también se incluye lo que el propio actor revisó (`reviewedBy`).
 */
async function findVisibleReviews(
  request: FastifyRequest,
  filters: { weekStart?: string; projectId?: string; consultantId?: string; status: "SUBMITTED" | "APPROVED" | "RETURNED" | "ALL" },
) {
  const user = request.authUser!;
  const actorEmail = user.email.toLowerCase();
  const isAdmin = user.roles.includes(AppRole.ADMIN);

  const where: Prisma.TimesheetWeekReviewWhereInput = {
    ...(filters.weekStart ? { weekStart: fromIsoDate(filters.weekStart) } : {}),
    ...(filters.projectId ? { projectId: filters.projectId } : {}),
    ...(filters.consultantId ? { consultantId: filters.consultantId } : {}),
    ...(filters.status !== "ALL" ? { status: filters.status as TimesheetReviewStatus } : {}),
  };
  const scope: Prisma.TimesheetWeekReviewWhereInput[] = [
    {
      project: {
        OR: [
          { projectManagerEmail: { equals: actorEmail, mode: "insensitive" } },
          { delegations: { some: { toUserEmail: { equals: actorEmail, mode: "insensitive" } } } },
        ],
      },
    },
    { status: { not: TimesheetReviewStatus.SUBMITTED }, reviewedBy: { equals: actorEmail, mode: "insensitive" } },
  ];

  const rows = await prisma.timesheetWeekReview.findMany({
    // ADMIN: sin acotar por proyecto (revisa los que no tienen PM o cuyo PM es el consultor, y
    // `resolveReviewer` decide fila por fila). El resto: su proyecto, sus delegaciones o lo que revisó.
    where: isAdmin ? where : { AND: [where, { OR: scope }] },
    include: REVIEW_INCLUDE,
    orderBy: [{ weekStart: "asc" }, { createdAt: "asc" }],
  });

  // El tope se aplica DESPUÉS de filtrar por revisor, para que la bandeja y el contador no queden
  // cortos por filas que el actor no puede ver.
  const todas: { review: ReviewWithRefs; verdict: ResolveReviewerResult }[] = [];
  for (const review of rows) {
    const verdict = reviewerFor(request, review);
    const reviewedByMe = review.status !== TimesheetReviewStatus.SUBMITTED && review.reviewedBy?.toLowerCase() === actorEmail;
    if (verdict.canReview || reviewedByMe) todas.push({ review, verdict });
  }
  const truncated = todas.length > MAX_LIST;
  return { visible: todas.slice(0, MAX_LIST), truncated, total: todas.length };
}

/** Meses distintos (como fecha del primer día registrado) que tocan unos registros. */
function distinctMonths(dates: Date[]): Date[] {
  const seen = new Map<string, Date>();
  for (const d of dates) {
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    if (!seen.has(key)) seen.set(key, d);
  }
  return [...seen.values()];
}

function itemInfo(item: { consultantId: string; projectId: string; weekStart: string }, index: number) {
  return { index, consultantId: item.consultantId, projectId: item.projectId, weekStart: item.weekStart };
}

async function flushEvents(request: FastifyRequest, entity: typeof AUDIT_ENTITIES.timeEntry | typeof AUDIT_ENTITIES.consultantBlock, events: AuditEvent[]) {
  for (const ev of events) {
    await writeAudit(prisma, {
      entity,
      entityId: ev.entityId,
      action: ev.action,
      changedBy: request.authUser!.email,
      before: ev.before ?? null,
      after: ev.after ?? null,
      request,
    });
  }
}

export async function timesheetReviewsRoutes(app: FastifyInstance) {
  /**
   * Bandeja del revisor (R15 §3): una fila por consultor × proyecto × semana, SOLO de lo que el
   * actor puede revisar (PM del proyecto, delegado vigente esa semana, o ADMIN cuando no hay PM /
   * el PM es el propio consultor) y, con estado distinto de SUBMITTED, también lo que él revisó.
   * Sin tarifas ni montos. Por defecto `status=SUBMITTED`. Solo lectura.
   */
  app.get(
    "/",
    { preHandler: [authenticate, authorize(REVIEW_ROLES)] },
    async (request) => {
      const query = listQuerySchema.parse(request.query);
      const { visible, truncated } = await findVisibleReviews(request, query);
      if (visible.length === 0) return { data: [], meta: { total: 0, truncated } };

      const reviews = visible.map((v) => v.review);

      // Registros de cada revisión (consultor + proyecto + semana).
      const entries = await prisma.timeEntry.findMany({
        where: {
          OR: reviews.map((r) => ({
            consultantId: r.consultantId,
            projectId: r.projectId,
            workDate: { gte: r.weekStart, lte: fromIsoDate(addDaysIso(toIsoDate(r.weekStart), 6)) },
          })),
        },
        select: {
          id: true,
          consultantId: true,
          projectId: true,
          workDate: true,
          hours: true,
          status: true,
          isExcess: true,
          startedAt: true,
          endedAt: true,
          description: true,
          rejectionNote: true,
          type: { select: { id: true, code: true, name: true, category: true } },
        },
        orderBy: [{ workDate: "asc" }, { startedAt: "asc" }, { createdAt: "asc" }],
      });

      // Contexto por consultor: jornada, festivos y total del día en TODOS sus proyectos.
      const weeksByConsultant = new Map<string, Set<IsoDate>>();
      for (const r of reviews) {
        const set = weeksByConsultant.get(r.consultantId) ?? new Set<IsoDate>();
        set.add(toIsoDate(r.weekStart));
        weeksByConsultant.set(r.consultantId, set);
      }
      const consultants: Record<string, ConsultantReviewContext> = {};
      await Promise.all(
        [...weeksByConsultant].map(async ([consultantId, weeks]) => {
          const jornada: Record<IsoDate, number> = {};
          const holidays = new Set<IsoDate>();
          const dailyTotals: Record<IsoDate, number> = {};
          for (const week of weeks) {
            const days = await loadDaysContext(prisma, consultantId, week, addDaysIso(week, 6));
            for (const [date, ctx] of days) {
              jornada[date] = ctx.hoursPerDay;
              if (ctx.isHoliday) holidays.add(date);
              dailyTotals[date] = ctx.entries
                .filter((e) => e.status !== "REJECTED")
                .reduce((acc, e) => acc + e.hours, 0);
            }
          }
          consultants[consultantId] = { jornada, holidays, dailyTotals };
        }),
      );

      const { rows } = buildReviewRows({
        entries: entries.map((e) => ({
          id: e.id,
          consultantId: e.consultantId,
          projectId: e.projectId,
          workDate: toIsoDate(e.workDate),
          category: e.type.category as RuleCategory,
          hours: Number(e.hours),
          status: e.status as RuleStatus,
          isExcess: e.isExcess,
          raw: e,
        })),
        reviews: reviews.map((r) => ({
          consultantId: r.consultantId,
          projectId: r.projectId,
          weekStart: toIsoDate(r.weekStart),
          status: r.status,
        })),
        consultants,
      });

      const byKey = new Map(visible.map((v) => [`${v.review.consultantId}|${v.review.projectId}|${toIsoDate(v.review.weekStart)}`, v]));
      const data = rows.map((row) => {
        const v = byKey.get(`${row.consultantId}|${row.projectId}|${row.weekStart}`)!;
        return {
          consultantId: row.consultantId,
          consultantName: v.review.consultant.fullName,
          projectId: row.projectId,
          projectName: v.review.project.name,
          weekStart: row.weekStart,
          days: row.days,
          total: row.total,
          status: row.status,
          flags: row.flags,
          /** El actor puede aprobar o devolver esta fila (si no, es solo consulta de lo que revisó). */
          canReview: v.verdict.canReview,
          review: {
            id: v.review.id,
            status: v.review.status,
            hours: Number(v.review.hours),
            submittedAt: v.review.submittedAt,
            submittedBy: v.review.submittedBy,
            reviewedAt: v.review.reviewedAt,
            reviewedBy: v.review.reviewedBy,
            note: v.review.note,
          },
          entries: row.entries.map(({ raw: e }) => ({
            id: e.id,
            workDate: toIsoDate(e.workDate),
            hours: Number(e.hours),
            status: e.status,
            isExcess: e.isExcess,
            startedAt: e.startedAt,
            endedAt: e.endedAt,
            description: e.description,
            rejectionNote: e.rejectionNote,
            type: e.type,
          })),
        };
      });

      return { data, meta: { total: data.length, truncated } };
    },
  );

  /** Contador del menú: `canReview` (dirige un proyecto, delegación vigente o ADMIN) y semanas por revisar. */
  app.get(
    "/count",
    { preHandler: [authenticate, authorize(REVIEW_ROLES)] },
    async (request) => {
      const user = request.authUser!;
      const email = user.email.toLowerCase();
      const now = new Date();
      const [manages, delegated] = await Promise.all([
        prisma.project.findFirst({
          where: { projectManagerEmail: { equals: email, mode: "insensitive" } },
          select: { id: true },
        }),
        prisma.approvalDelegation.findFirst({
          where: { toUserEmail: { equals: email, mode: "insensitive" }, startDate: { lte: now }, endDate: { gte: now } },
          select: { id: true },
        }),
      ]);
      // Misma regla que la bandeja: una delegación pasada que cubre una semana enviada también cuenta.
      const { total } = await findVisibleReviews(request, { status: "SUBMITTED" });
      const canReview = user.roles.includes(AppRole.ADMIN) || !!manages || !!delegated || total > 0;
      return { data: { canReview, pending: total } };
    },
  );

  /**
   * Aprueba semanas enviadas (R15 §2.4). TODO O NADA: si un solo ítem falla (no enviado, sin
   * permiso, mes cerrado) no se aprueba ninguno y la respuesta nombra al culpable.
   */
  app.post(
    "/approve",
    { preHandler: [authenticate, authorize(REVIEW_ROLES)] },
    async (request, reply) => {
      const { items } = approveSchema.parse(request.body);
      const user = request.authUser!;
      const actor = user.email.toLowerCase();

      const seen = new Set<string>();
      for (let i = 0; i < items.length; i++) {
        const key = `${items[i].consultantId}|${items[i].projectId}|${items[i].weekStart}`;
        if (seen.has(key)) {
          return reply.status(400).send({ message: "Hay ítems repetidos en la solicitud.", code: "DUPLICATE_ITEM", item: itemInfo(items[i], i) });
        }
        seen.add(key);
      }

      // Orden determinista de bloqueos entre aprobaciones concurrentes.
      const ordered = items
        .map((item, index) => ({ item, index }))
        .sort((a, b) => (`${a.item.weekStart}|${a.item.consultantId}` < `${b.item.weekStart}|${b.item.consultantId}` ? -1 : 1));

      const now = new Date();
      let outcome;
      try {
        outcome = await prisma.$transaction(
          async (tx) => {
            const done: { review: ReviewWithRefs; after: Record<string, unknown>; entryIds: string[]; hours: number }[] = [];
            const entryEvents: AuditEvent[] = [];
            const blockEvents: AuditEvent[] = [];

            for (const { item, index } of ordered) {
              await lockWeek(tx, item.consultantId, item.weekStart as IsoDate);
              const review = await tx.timesheetWeekReview.findUnique({
                where: {
                  consultantId_weekStart_projectId: {
                    consultantId: item.consultantId,
                    weekStart: fromIsoDate(item.weekStart),
                    projectId: item.projectId,
                  },
                },
                include: REVIEW_INCLUDE,
              });
              if (!review) {
                throw new ItemError(404, "REVIEW_NOT_FOUND", "No hay una semana enviada para ese consultor, proyecto y semana.", index);
              }
              if (review.status !== TimesheetReviewStatus.SUBMITTED) {
                throw new ItemError(409, "REVIEW_NOT_SUBMITTED", "Esa semana no está pendiente de revisión (ya fue aprobada o devuelta).", index);
              }
              const verdict = reviewerFor(request, review);
              if (!verdict.canReview) throw new ItemError(403, "NOT_REVIEWER", verdict.message, index);

              const weekEnd = fromIsoDate(addDaysIso(item.weekStart, 6));
              const entries = await tx.timeEntry.findMany({
                where: {
                  consultantId: item.consultantId,
                  projectId: item.projectId,
                  workDate: { gte: review.weekStart, lte: weekEnd },
                  status: TimeEntryStatus.SUBMITTED,
                },
                include: { type: { select: { category: true } } },
                orderBy: [{ startedAt: "asc" }, { createdAt: "asc" }],
              });

              for (const month of distinctMonths(entries.map((e) => e.workDate))) {
                const closed = await closedMonthLocked(tx, item.projectId, month);
                if (closed) throw new ItemError(400, "MONTH_CLOSED", monthClosedMessage(closed), index);
              }

              if (entries.length) {
                await tx.timeEntry.updateMany({
                  where: { id: { in: entries.map((e) => e.id) } },
                  data: {
                    status: TimeEntryStatus.APPROVED,
                    approvedAt: now,
                    approvedBy: actor,
                    rejectionNote: null,
                    rejectedBy: null,
                    rejectedAt: null,
                  },
                });
              }
              const updated = await tx.timesheetWeekReview.update({
                where: { id: review.id },
                data: { status: TimesheetReviewStatus.APPROVED, reviewedAt: now, reviewedBy: actor, note: null },
              });

              // Las ausencias aprobadas que cubren la jornada generan su bloqueo de capacidad (R14 §2.4).
              const absenceDays = new Map<string, { date: Date; id: string }>();
              for (const e of entries) {
                if (e.type.category === TimeEntryCategory.ABSENCE) absenceDays.set(toIsoDate(e.workDate), { date: e.workDate, id: e.id });
              }
              for (const { date, id } of absenceDays.values()) {
                await lockDay(tx, item.consultantId, date);
                blockEvents.push(...(await syncAbsenceBlock(tx, item.consultantId, date, id)));
              }

              for (const e of entries) {
                entryEvents.push({
                  entityId: e.id,
                  action: "UPDATE",
                  before: { status: e.status } as Record<string, unknown>,
                  after: { status: TimeEntryStatus.APPROVED, approvedBy: actor },
                });
              }
              done.push({
                review,
                after: updated as unknown as Record<string, unknown>,
                entryIds: entries.map((e) => e.id),
                hours: Number(review.hours),
              });
            }
            return { done, entryEvents, blockEvents };
          },
          { timeout: 60_000, maxWait: 10_000 },
        );
      } catch (err) {
        if (err instanceof ItemError) {
          return reply.status(err.status).send({
            message: err.message,
            code: err.code,
            item: itemInfo(items[err.index], err.index),
          });
        }
        throw err;
      }

      for (const d of outcome.done) {
        await writeAudit(prisma, {
          entity: AUDIT_ENTITIES.timesheetWeekReview,
          entityId: d.review.id,
          action: "APPROVE",
          changedBy: user.email,
          before: { status: d.review.status } as Record<string, unknown>,
          after: { ...d.after, entryIds: d.entryIds },
          request,
        });
      }
      await flushEvents(request, AUDIT_ENTITIES.timeEntry, outcome.entryEvents);
      await flushEvents(request, AUDIT_ENTITIES.consultantBlock, outcome.blockEvents);

      return {
        data: {
          approved: outcome.done.map((d) => ({
            consultantId: d.review.consultantId,
            projectId: d.review.projectId,
            weekStart: toIsoDate(d.review.weekStart),
            entries: d.entryIds.length,
          })),
        },
      };
    },
  );

  /**
   * Devuelve a un consultor su semana de un proyecto (R15 §2.2): los registros SUBMITTED vuelven a
   * PENDING conservando la nota y quién devolvió; la revisión queda RETURNED y SOLO ese proyecto se
   * reabre. Exige nota (≥ 3 caracteres). Avisa al consultor por correo.
   */
  app.post(
    "/return",
    { preHandler: [authenticate, authorize(REVIEW_ROLES)] },
    async (request, reply) => {
      const payload = returnSchema.parse(request.body);
      const user = request.authUser!;
      const actor = user.email.toLowerCase();
      const now = new Date();
      const weekStart = payload.weekStart as IsoDate;

      let outcome;
      try {
        outcome = await prisma.$transaction(
          async (tx) => {
            await lockWeek(tx, payload.consultantId, weekStart);
            const review = await tx.timesheetWeekReview.findUnique({
              where: {
                consultantId_weekStart_projectId: {
                  consultantId: payload.consultantId,
                  weekStart: fromIsoDate(weekStart),
                  projectId: payload.projectId,
                },
              },
              include: REVIEW_INCLUDE,
            });
            if (!review) {
              throw new ItemError(404, "REVIEW_NOT_FOUND", "No hay una semana enviada para ese consultor, proyecto y semana.", 0);
            }
            if (review.status !== TimesheetReviewStatus.SUBMITTED) {
              throw new ItemError(409, "REVIEW_NOT_SUBMITTED", "Esa semana no está pendiente de revisión (ya fue aprobada o devuelta).", 0);
            }
            const verdict = reviewerFor(request, review);
            if (!verdict.canReview) throw new ItemError(403, "NOT_REVIEWER", verdict.message, 0);

            const entries = await tx.timeEntry.findMany({
              where: {
                consultantId: payload.consultantId,
                projectId: payload.projectId,
                workDate: { gte: review.weekStart, lte: fromIsoDate(addDaysIso(weekStart, 6)) },
                status: TimeEntryStatus.SUBMITTED,
              },
              include: { type: { select: { category: true } } },
            });
            for (const month of distinctMonths(entries.map((e) => e.workDate))) {
              const closed = await closedMonthLocked(tx, payload.projectId, month);
              if (closed) throw new ItemError(400, "MONTH_CLOSED", monthClosedMessage(closed), 0);
            }

            if (entries.length) {
              await tx.timeEntry.updateMany({
                where: { id: { in: entries.map((e) => e.id) } },
                data: {
                  status: TimeEntryStatus.PENDING,
                  rejectionNote: payload.note,
                  rejectedBy: actor,
                  rejectedAt: now,
                  approvedBy: null,
                  approvedAt: null,
                },
              });
            }
            const updated = await tx.timesheetWeekReview.update({
              where: { id: review.id },
              data: { status: TimesheetReviewStatus.RETURNED, reviewedAt: now, reviewedBy: actor, note: payload.note },
            });

            // Re-evalúa el excedente de los días con horas extra (saldo y partición, como R14).
            const reparto: AuditEvent[] = [];
            const extraDays = new Map<string, Date>();
            for (const e of entries) {
              if (e.type.category === TimeEntryCategory.EXTRA) extraDays.set(toIsoDate(e.workDate), e.workDate);
            }
            if (extraDays.size > 0) {
              const types = await loadTypes(tx);
              for (const workDate of extraDays.values()) {
                const res = await saveDayGroup(tx, {
                  consultantId: payload.consultantId,
                  projectId: payload.projectId,
                  workDate,
                  isAbsenceProject: review.project.isAbsenceProject,
                  rows: [],
                  deleteMissing: false,
                  types,
                });
                if (res.ok) reparto.push(...res.audits);
                else getLogger().warn({ code: res.error.code, workDate }, "[R15] No se pudo reevaluar el excedente tras devolver la semana");
              }
            }
            return { review, updated, entries, reparto };
          },
          { timeout: 30_000, maxWait: 10_000 },
        );
      } catch (err) {
        if (err instanceof ItemError) {
          return reply.status(err.status).send({ message: err.message, code: err.code, item: itemInfo(payload, 0) });
        }
        throw err;
      }

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.timesheetWeekReview,
        entityId: outcome.review.id,
        action: "REJECT",
        changedBy: user.email,
        before: { status: outcome.review.status } as Record<string, unknown>,
        after: { ...(outcome.updated as unknown as Record<string, unknown>), entryIds: outcome.entries.map((e) => e.id) },
        request,
      });
      await flushEvents(request, AUDIT_ENTITIES.timeEntry, outcome.reparto);

      // Aviso al consultor. Un correo fallido no deshace la devolución.
      try {
        const reviewer = await prisma.user.findFirst({
          where: { email: { equals: actor, mode: "insensitive" } },
          select: { displayName: true },
        });
        await notifyTimesheetReturned({
          consultantName: outcome.review.consultant.fullName,
          consultantEmail: outcome.review.consultant.email,
          projectName: outcome.review.project.name,
          weekStart,
          note: payload.note,
          reviewerName: reviewer?.displayName || user.email,
        });
      } catch (err) {
        request.log.error({ err }, "No se pudo avisar al consultor de la devolución de su semana");
      }

      return {
        data: {
          consultantId: payload.consultantId,
          projectId: payload.projectId,
          weekStart,
          status: TimesheetReviewStatus.RETURNED,
          entries: outcome.entries.length,
        },
      };
    },
  );
}
