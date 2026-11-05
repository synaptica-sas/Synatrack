import type { FastifyInstance } from "fastify";
import { AppRole, TimeEntryStatus, TimesheetReviewStatus } from "@prisma/client";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";
import { fromIsoDate, isValidIsoDate, type IsoDate } from "../../utils/isoDate.js";
import { roundHours } from "../../utils/timesheetRules.js";
import { weekDays, weekStartOf, type WeekSubmissionError } from "../../utils/timesheetWeek.js";
import {
  closedMonthLocked,
  evaluateWeekSubmission,
  lockWeek,
  monthClosedMessage,
  resolveVisibleConsultant,
} from "./timesheet-weeks.service.js";

/** `weekStart` debe ser un lunes en formato YYYY-MM-DD. */
export const weekStartSchema = z
  .string()
  .refine(isValidIsoDate, "weekStart debe ser YYYY-MM-DD")
  .refine((v) => !isValidIsoDate(v) || weekStartOf(v) === v, "weekStart debe ser un lunes");

const statusQuerySchema = z.object({
  weekStart: weekStartSchema,
  consultantId: z.string().min(1).optional(),
});

const submitSchema = z.object({
  weekStart: weekStartSchema,
  consultantId: z.string().min(1).optional(),
});

/** Códigos que describen el estado de los datos (no un día incompleto): el envío responde 409. */
const STATE_ERROR_CODES = new Set(["NOTHING_TO_SUBMIT", "INCONSISTENT_REVIEW_STATE"]);

function submissionBody(errors: WeekSubmissionError[], days: unknown) {
  return {
    message: errors[0]?.message ?? "La semana no se puede enviar.",
    code: "WEEK_NOT_SUBMITTABLE",
    errors,
    days,
  };
}

export async function timesheetWeeksRoutes(app: FastifyInstance) {
  /**
   * Estado de una semana para el timesheet del consultor: revisiones por proyecto (estado, nota,
   * revisor), si la semana está bloqueada, qué proyectos siguen editables (los DEVUELTOS) y la
   * previsualización del envío (`validateWeekSubmission`) para habilitar o no "Enviar".
   * Solo lectura. Visibilidad como `GET /api/time-entries/day-summary`.
   */
  app.get(
    "/status",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT, AppRole.VIEWER])],
    },
    async (request, reply) => {
      const query = statusQuerySchema.parse(request.query);
      const target = await resolveVisibleConsultant(request, query.consultantId);
      if (!target.ok) return reply.status(target.status).send({ message: target.message });

      const weekStart = query.weekStart as IsoDate;
      const [{ today, result }, reviews] = await Promise.all([
        evaluateWeekSubmission(prisma, target.consultantId, weekStart),
        prisma.timesheetWeekReview.findMany({
          where: { consultantId: target.consultantId, weekStart: fromIsoDate(weekStart) },
          include: { project: { select: { id: true, name: true } } },
          orderBy: { createdAt: "asc" },
        }),
      ]);

      const emails = [...new Set(reviews.map((r) => r.reviewedBy).filter((e): e is string => !!e))];
      const users = emails.length
        ? await prisma.user.findMany({
            where: { email: { in: emails, mode: "insensitive" } },
            select: { email: true, displayName: true },
          })
        : [];
      const nameOf = new Map(users.map((u) => [u.email.toLowerCase(), u.displayName]));

      return {
        data: {
          consultantId: target.consultantId,
          weekStart,
          today,
          /** La semana tiene alguna revisión: solo los proyectos de `editableProjectIds` admiten cambios. */
          locked: reviews.length > 0,
          editableProjectIds: reviews.filter((r) => r.status === "RETURNED").map((r) => r.projectId),
          reviews: reviews.map((r) => ({
            projectId: r.projectId,
            projectName: r.project.name,
            status: r.status,
            note: r.note,
            hours: Number(r.hours),
            submittedAt: r.submittedAt,
            submittedBy: r.submittedBy,
            reviewedAt: r.reviewedAt,
            reviewedBy: r.reviewedBy,
            reviewedByName: r.reviewedBy ? (nameOf.get(r.reviewedBy.toLowerCase()) ?? r.reviewedBy) : null,
          })),
          submission: {
            ok: result.ok,
            errors: result.errors,
            projectsToSubmit: result.projectsToSubmit,
            returnedWithoutEntries: result.returnedWithoutEntries,
            days: result.days,
          },
        },
      };
    },
  );

  /**
   * Envía la semana completa (R15 §2.2-2.3): todos los proyectos con registros PENDING pasan a
   * SUBMITTED y nace/renace una `TimesheetWeekReview` SUBMITTED por proyecto. Solo viajan los
   * proyectos sin revisión o DEVUELTOS. Lo hace el propio consultor, o ADMIN en nombre de otro
   * (auditado con el actor). Todo en una transacción con candado por consultor + semana.
   */
  app.post(
    "/submit",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT])],
    },
    async (request, reply) => {
      const payload = submitSchema.parse(request.body);
      const user = request.authUser!;
      const actor = user.email.toLowerCase();
      const isAdmin = user.roles.includes(AppRole.ADMIN);

      let consultantId = user.consultantId ?? null;
      if (payload.consultantId && payload.consultantId !== consultantId) {
        if (!isAdmin) {
          return reply.status(403).send({ message: "Solo puedes enviar tu propia semana." });
        }
        const exists = await prisma.consultant.findUnique({ where: { id: payload.consultantId }, select: { id: true } });
        if (!exists) return reply.status(404).send({ message: "El consultor indicado no existe" });
        consultantId = exists.id;
      }
      if (!consultantId) {
        return reply.status(400).send({ message: "Tu usuario no tiene una ficha de consultor enlazada." });
      }

      const weekStart = payload.weekStart as IsoDate;
      const weekStartDate = fromIsoDate(weekStart);
      const from = weekStartDate;
      const to = fromIsoDate(weekDays(weekStart)[6]);
      const now = new Date();

      type Outcome =
        | { ok: false; errors: WeekSubmissionError[]; days: unknown }
        | { ok: false; monthClosed: { projectId: string; projectName: string; year: number; month: number } }
        | {
            ok: true;
            submitted: { projectId: string; hours: number; entryIds: string[]; before: Record<string, unknown> | null; after: Record<string, unknown>; id: string }[];
            closed: { id: string; projectId: string; before: Record<string, unknown> }[];
          };

      const outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
        await lockWeek(tx, consultantId!, weekStart);
        const { result } = await evaluateWeekSubmission(tx, consultantId!, weekStart, now);
        if (!result.ok) return { ok: false, errors: result.errors, days: result.days };

        // H7: no se envía un proyecto cuyas horas caen en un mes ya cerrado para él: la revisión
        // quedaría SUBMITTED sin salida (aprobar y devolver también respetan el cierre).
        for (const projectId of result.projectsToSubmit) {
          const pendientes = await tx.timeEntry.findMany({
            where: { consultantId: consultantId!, projectId, workDate: { gte: from, lte: to }, status: TimeEntryStatus.PENDING },
            select: { workDate: true },
          });
          const meses = new Map<string, Date>();
          for (const p of pendientes) meses.set(`${p.workDate.getUTCFullYear()}-${p.workDate.getUTCMonth()}`, p.workDate);
          for (const fecha of meses.values()) {
            const cerrado = await closedMonthLocked(tx, projectId, fecha);
            if (cerrado) {
              const proyecto = await tx.project.findUnique({ where: { id: projectId }, select: { name: true } });
              return { ok: false, monthClosed: { projectId, projectName: proyecto?.name ?? projectId, ...cerrado } };
            }
          }
        }

        const submitted: Extract<Outcome, { ok: true }>["submitted"] = [];
        for (const projectId of result.projectsToSubmit) {
          const pending = await tx.timeEntry.findMany({
            where: { consultantId: consultantId!, projectId, workDate: { gte: from, lte: to }, status: TimeEntryStatus.PENDING },
            select: { id: true },
          });
          await tx.timeEntry.updateMany({
            where: { id: { in: pending.map((e) => e.id) } },
            data: {
              status: TimeEntryStatus.SUBMITTED,
              rejectionNote: null,
              rejectedBy: null,
              rejectedAt: null,
            },
          });
          // Total que verá el PM: todo lo vivo del proyecto en la semana (no rechazado).
          const live = await tx.timeEntry.aggregate({
            where: {
              consultantId: consultantId!,
              projectId,
              workDate: { gte: from, lte: to },
              status: { not: TimeEntryStatus.REJECTED },
            },
            _sum: { hours: true },
          });
          const hours = roundHours(Number(live._sum.hours ?? 0));
          const previous = await tx.timesheetWeekReview.findUnique({
            where: { consultantId_weekStart_projectId: { consultantId: consultantId!, weekStart: weekStartDate, projectId } },
          });
          const review = await tx.timesheetWeekReview.upsert({
            where: { consultantId_weekStart_projectId: { consultantId: consultantId!, weekStart: weekStartDate, projectId } },
            create: {
              consultantId: consultantId!,
              projectId,
              weekStart: weekStartDate,
              status: TimesheetReviewStatus.SUBMITTED,
              submittedAt: now,
              submittedBy: actor,
              hours,
            },
            update: {
              status: TimesheetReviewStatus.SUBMITTED,
              submittedAt: now,
              submittedBy: actor,
              reviewedAt: null,
              reviewedBy: null,
              note: null,
              hours,
            },
          });
          submitted.push({
            projectId,
            hours,
            entryIds: pending.map((e) => e.id),
            id: review.id,
            before: previous as unknown as Record<string, unknown> | null,
            after: review as unknown as Record<string, unknown>,
          });
        }

        // Revisiones devueltas cuyo contenido el consultor borró por completo: se cierran.
        const closed: Extract<Outcome, { ok: true }>["closed"] = [];
        for (const projectId of result.returnedWithoutEntries) {
          const row = await tx.timesheetWeekReview.findUnique({
            where: { consultantId_weekStart_projectId: { consultantId: consultantId!, weekStart: weekStartDate, projectId } },
          });
          if (!row) continue;
          await tx.timesheetWeekReview.delete({ where: { id: row.id } });
          closed.push({ id: row.id, projectId, before: row as unknown as Record<string, unknown> });
        }
        return { ok: true, submitted, closed };
      });

      if (!outcome.ok && "monthClosed" in outcome) {
        const m = outcome.monthClosed;
        return reply.status(400).send({
          message: `${monthClosedMessage(m)} Proyecto: ${m.projectName}. Pide a un administrador que lo resuelva antes de enviar.`,
          code: "MONTH_CLOSED",
          ...m,
        });
      }
      if (!outcome.ok) {
        const onlyState = outcome.errors.every((e) => STATE_ERROR_CODES.has(e.code));
        return reply.status(onlyState ? 409 : 400).send(submissionBody(outcome.errors, outcome.days));
      }

      const onBehalf = consultantId !== user.consultantId;
      for (const s of outcome.submitted) {
        await writeAudit(prisma, {
          entity: AUDIT_ENTITIES.timesheetWeekReview,
          entityId: s.id,
          action: s.before ? "UPDATE" : "CREATE",
          changedBy: user.email,
          before: s.before,
          after: { ...s.after, entryIds: s.entryIds, accion: "ENVIAR", enNombreDeConsultor: onBehalf ? consultantId : undefined },
          request,
        });
      }
      for (const c of outcome.closed) {
        await writeAudit(prisma, {
          entity: AUDIT_ENTITIES.timesheetWeekReview,
          entityId: c.id,
          action: "DELETE",
          changedBy: user.email,
          before: c.before,
          request,
        });
      }

      return reply.status(201).send({
        data: {
          consultantId,
          weekStart,
          submittedProjectIds: outcome.submitted.map((s) => s.projectId),
          submittedHours: roundHours(outcome.submitted.reduce((a, s) => a + s.hours, 0)),
          closedReturnedProjectIds: outcome.closed.map((c) => c.projectId),
          onBehalf,
        },
      });
    },
  );
}
