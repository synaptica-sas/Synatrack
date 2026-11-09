import type { FastifyInstance } from "fastify";
import { AppRole, Prisma, TimeEntrySource, TimeEntryStatus } from "@prisma/client";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";
import {
  isMonthClosed,
  resolveActivityId,
  resolveTargetConsultantId,
} from "../../utils/currentConsultant.js";
import { resolveCountryTimezone } from "../../utils/country.js";
import { splitTimerSpan } from "../../utils/timesheetRules.js";
import { loadDayContext, lockDay } from "../time-entries/day-context.service.js";
import {
  checkWeekEditable,
  localCalendarDay,
  lockAndCheckMonths,
  lockAndCheckWeeks,
  weekLockedBody,
} from "../timesheet-weeks/timesheet-weeks.service.js";

const WRITE_ROLES = [AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT];

const startPayloadSchema = z.object({
  projectId: z.string().min(1, "Debes elegir un proyecto"),
  activityId: z.string().min(1).optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
  // Permite reanudar una entrada existente: el cronómetro arranca en el pasado
  // en lugar de en "ahora".
  startedAt: z.coerce.date().optional(),
  consultantId: z.string().min(1).optional(),
});

const updatePayloadSchema = z.object({
  projectId: z.string().min(1).optional(),
  activityId: z.string().min(1).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  startedAt: z.coerce.date().optional(),
  consultantId: z.string().min(1).optional(),
});

// Consultar, detener o descartar el cronómetro de otra persona. Solo ADMIN y
// PM llegan a usarlo: `resolveTargetConsultantId` ignora el campo para el
// resto de roles y los deja atados a su propio cronómetro.
const targetConsultantSchema = z.object({
  consultantId: z.string().min(1).optional(),
});

const timerInclude = {
  project: { include: { company: true } },
  activity: { select: { id: true, title: true } },
  consultant: { select: { id: true, fullName: true } },
} satisfies Prisma.RunningTimerInclude;

/** Un cronómetro no puede empezar más de 24 h atrás ni registrar un tramo de más de 24 h. */
const MAX_TIMER_MS = 24 * 3_600_000;
const MENSAJE_ANTIGUO = "El inicio del cronómetro no puede ser de hace más de 24 horas.";

const MENSAJE_AUSENCIAS =
  "El proyecto Ausencias no admite cronómetro: registra los permisos y vacaciones desde el timesheet.";

/**
 * R15: el tiempo del cronómetro se imputa al día local en que arrancó. Si esa semana ya fue enviada
 * (y el proyecto no fue devuelto), no se puede iniciar ni mover el cronómetro hacia ella.
 */
async function bloqueoDeSemana(consultantId: string, projectId: string, startedAt: Date) {
  const duenio = await prisma.consultant.findUnique({ where: { id: consultantId }, select: { country: true } });
  const dia = localCalendarDay(startedAt, duenio?.country);
  return checkWeekEditable(prisma, consultantId, projectId, dia);
}

const MENSAJE_CRONOMETRO_BLOQUEADO =
  " El cronómetro no se pierde: puedes descartarlo o esperar a que el PM devuelva el proyecto.";

export async function timerRoutes(app: FastifyInstance) {
  // Cronómetro actualmente en marcha (null si no hay ninguno).
  app.get(
    "/",
    { preHandler: [authenticate, authorize([...WRITE_ROLES, AppRole.FINANCE, AppRole.VIEWER])] },
    async (request) => {
      const query = targetConsultantSchema.parse(request.query);
      const target = await resolveTargetConsultantId(request, query.consultantId);
      // Sin ficha de consultor simplemente no hay cronómetro; no es un error.
      if ("error" in target) return { data: null };

      const timer = await prisma.runningTimer.findUnique({
        where: { consultantId: target.consultantId },
        include: timerInclude,
      });

      return { data: timer };
    },
  );

  // Arranca el cronómetro.
  app.post(
    "/start",
    { preHandler: [authenticate, authorize(WRITE_ROLES)] },
    async (request, reply) => {
      const payload = startPayloadSchema.parse(request.body);

      const target = await resolveTargetConsultantId(request, payload.consultantId);
      if ("error" in target) return reply.status(400).send({ message: target.error });

      const project = await prisma.project.findUnique({
        where: { id: payload.projectId },
        select: { id: true, isAbsenceProject: true },
      });
      if (!project) return reply.status(400).send({ message: "El proyecto indicado no existe" });
      if (project.isAbsenceProject) return reply.status(400).send({ message: MENSAJE_AUSENCIAS });

      const activity = await resolveActivityId(payload.activityId, target.consultantId);
      if (!activity.ok) {
        return reply.status(400).send({ message: activity.error });
      }

      const startedAt = payload.startedAt ?? new Date();
      if (startedAt.getTime() > Date.now() + 60_000) {
        return reply.status(400).send({ message: "El inicio del cronómetro no puede estar en el futuro" });
      }
      if (startedAt.getTime() < Date.now() - MAX_TIMER_MS) {
        return reply.status(400).send({ message: MENSAJE_ANTIGUO });
      }

      const bloqueoInicio = await bloqueoDeSemana(target.consultantId, payload.projectId, startedAt);
      if (bloqueoInicio) return reply.status(409).send(weekLockedBody(bloqueoInicio));

      const existing = await prisma.runningTimer.findUnique({
        where: { consultantId: target.consultantId },
      });
      if (existing) {
        // Redactado en tercera persona: un ADMIN o PM puede estar arrancando
        // el cronómetro a nombre de otra persona.
        return reply.status(409).send({
          message: "Ya hay un cronómetro en marcha para ese consultor. Deténlo antes de iniciar otro.",
        });
      }

      const timer = await prisma.runningTimer.create({
        data: {
          consultantId: target.consultantId,
          projectId: payload.projectId,
          activityId: activity.activityId,
          description: payload.description || null,
          startedAt,
        },
        include: timerInclude,
      });

      return reply.status(201).send({ data: timer });
    },
  );

  // Edita el cronómetro en marcha: cambiar proyecto, tarea o descripción sin
  // perder el tiempo acumulado.
  app.patch(
    "/",
    { preHandler: [authenticate, authorize(WRITE_ROLES)] },
    async (request, reply) => {
      const payload = updatePayloadSchema.parse(request.body);

      const target = await resolveTargetConsultantId(request, payload.consultantId);
      if ("error" in target) return reply.status(400).send({ message: target.error });

      const existing = await prisma.runningTimer.findUnique({
        where: { consultantId: target.consultantId },
      });
      if (!existing) return reply.status(404).send({ message: "No hay ningún cronómetro en marcha" });

      if (payload.projectId) {
        const project = await prisma.project.findUnique({
          where: { id: payload.projectId },
          select: { id: true, isAbsenceProject: true },
        });
        if (!project) return reply.status(400).send({ message: "El proyecto indicado no existe" });
        if (project.isAbsenceProject) return reply.status(400).send({ message: MENSAJE_AUSENCIAS });
      }

      let activityId: string | null | undefined;
      if (payload.activityId !== undefined) {
        const resolved = await resolveActivityId(payload.activityId, target.consultantId);
        if (!resolved.ok) {
          return reply.status(400).send({ message: resolved.error });
        }
        activityId = resolved.activityId;
      }

      if (payload.startedAt && payload.startedAt.getTime() > Date.now() + 60_000) {
        return reply.status(400).send({ message: "El inicio del cronómetro no puede estar en el futuro" });
      }
      if (payload.startedAt && payload.startedAt.getTime() < Date.now() - MAX_TIMER_MS) {
        return reply.status(400).send({ message: MENSAJE_ANTIGUO });
      }

      // Proyecto y día de arranque resultantes: la semana de destino no puede estar bloqueada.
      const bloqueoEdicion = await bloqueoDeSemana(
        target.consultantId,
        payload.projectId ?? existing.projectId,
        payload.startedAt ?? existing.startedAt,
      );
      if (bloqueoEdicion) return reply.status(409).send(weekLockedBody(bloqueoEdicion));

      const timer = await prisma.runningTimer.update({
        where: { id: existing.id },
        data: {
          projectId: payload.projectId ?? undefined,
          activityId,
          description: payload.description === undefined ? undefined : payload.description || null,
          startedAt: payload.startedAt ?? undefined,
        },
        include: timerInclude,
      });

      return { data: timer };
    },
  );

  // Detiene el cronómetro y convierte el tiempo transcurrido en un TimeEntry
  // PENDIENTE, que entra al mismo flujo de aprobación que el resto de horas.
  app.post(
    "/stop",
    { preHandler: [authenticate, authorize(WRITE_ROLES)] },
    async (request, reply) => {
      const payload = targetConsultantSchema.parse(request.body ?? {});
      const target = await resolveTargetConsultantId(request, payload.consultantId);
      if ("error" in target) return reply.status(400).send({ message: target.error });

      const timer = await prisma.runningTimer.findUnique({
        where: { consultantId: target.consultantId },
      });
      if (!timer) return reply.status(404).send({ message: "No hay ningún cronómetro en marcha" });

      // Piso de un segundo, como antes de R14: detener el cronómetro al instante sigue dejando
      // un registro mínimo en vez de uno de 0 horas que la partición descartaría.
      const endedAt = new Date(Math.max(Date.now(), timer.startedAt.getTime() + 1000));

      // La entrada se imputa al día LOCAL (zona del país del consultor) en que arrancó el
      // cronómetro, aunque se detenga pasada la medianoche. Es el mismo criterio con que R14 ata
      // la franja a `workDate` (SPAN_OUTSIDE_WORKDATE): con el día UTC, un cronómetro iniciado en
      // Colombia después de las 19:00 caería en el día siguiente.
      const duenio = await prisma.consultant.findUnique({
        where: { id: timer.consultantId },
        select: { country: true },
      });
      const diaLocal = new Intl.DateTimeFormat("en-CA", {
        timeZone: resolveCountryTimezone(duenio?.country).timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(timer.startedAt); // YYYY-MM-DD
      const workDate = new Date(`${diaLocal}T00:00:00.000Z`);

      const closed = await isMonthClosed(timer.projectId, workDate);
      if (closed) {
        return reply.status(400).send({
          message: `El mes ${closed.year}-${String(closed.month).padStart(2, "0")} ya está cerrado para este proyecto, así que no se pueden registrar horas.`,
        });
      }

      const regularTypeId = (
        await prisma.timeEntryType.findUnique({ where: { code: "REGULAR" }, select: { id: true } })
      )?.id;
      if (!regularTypeId) {
        return reply.status(500).send({ message: "El catálogo de tipos de hora no está completo." });
      }

      // Crear las entradas y borrar el cronómetro van juntos: si falla el alta,
      // el cronómetro sigue en marcha y no se pierde el tiempo trabajado. El corte
      // (R14 §2.5) se calcula dentro de la transacción, con el estado del día ya leído.
      const resultado = await prisma.$transaction(async (tx) => {
        const proyecto = await tx.project.findUnique({
          where: { id: timer.projectId },
          select: { isAbsenceProject: true },
        });
        if (proyecto?.isAbsenceProject) return { error: MENSAJE_AUSENCIAS } as const;

        // R15: semana enviada = no se puede registrar; el cronómetro se conserva (la transacción
        // no escribe nada).
        const bloqueo = await lockAndCheckWeeks(tx, timer.consultantId, [{ projectId: timer.projectId, workDate }]);
        if (bloqueo) return { lock: bloqueo } as const;
        // Candado del mes: el cierre mensual y esta escritura no se cruzan.
        const cerrado = await lockAndCheckMonths(tx, [{ projectId: timer.projectId, workDate }]);
        if (cerrado) {
          return {
            error: `El mes ${cerrado.year}-${String(cerrado.month).padStart(2, "0")} ya está cerrado para este proyecto, así que no se pueden registrar horas.`,
          } as const;
        }

        await lockDay(tx, timer.consultantId, workDate);
        const ctx = await loadDayContext(tx, timer.consultantId, workDate);
        const usadoRegular = ctx.entries
          .filter((e) => e.status !== "REJECTED" && (e.category === "REGULAR" || e.category === "ABSENCE"))
          .reduce((acc, e) => acc + e.hours, 0);

        // Decisión 2026-11-05: el cronómetro solo registra REGULAR hasta el tope de la jornada.
        // Lo que sobre se descarta siempre (con o sin solicitud de horas extra aprobada); si eran
        // horas extra, el consultor las registra a mano en el timesheet.
        const particion = splitTimerSpan({
          start: timer.startedAt,
          end: endedAt,
          hoursPerDay: ctx.hoursPerDay,
          alreadyUsedRegular: usadoRegular,
          regularAllowed: !ctx.isNonWorkingDay || ctx.allowWeekendWork,
        });

        // Tope de 24 h por tramo: lo que exceda se descarta y se informa.
        let descartadoExtra = 0;
        const tramos = particion.segments.map((seg) => {
          const ms = seg.endedAt.getTime() - seg.startedAt.getTime();
          if (ms <= MAX_TIMER_MS) return seg;
          descartadoExtra += (ms - MAX_TIMER_MS) / 3_600_000;
          return { ...seg, endedAt: new Date(seg.startedAt.getTime() + MAX_TIMER_MS), hours: 24 };
        });
        const creadas = [];
        for (const seg of tramos) {
          creadas.push(
            await tx.timeEntry.create({
              data: {
                projectId: timer.projectId,
                consultantId: timer.consultantId,
                workDate,
                hours: seg.hours,
                description: timer.description,
                activityId: timer.activityId,
                // El cronómetro es una forma cómoda de rellenar el timesheet, no
                // un registro aparte: lo que produce SON horas de timesheet, y por
                // eso cuentan en el informe como cualquier otra. Que vinieron del
                // cronómetro se sigue sabiendo porque son las únicas con
                // `startedAt` y `endedAt`.
                source: TimeEntrySource.TIMESHEET,
                startedAt: seg.startedAt,
                endedAt: seg.endedAt,
                status: TimeEntryStatus.PENDING,
                typeId: regularTypeId,
              },
              include: {
                project: { include: { company: true } },
                consultant: true,
                activity: { select: { id: true, title: true } },
                type: { select: { id: true, code: true, name: true, category: true } },
              },
            }),
          );
        }

        await tx.runningTimer.delete({ where: { id: timer.id } });

        const descartadas = Math.round((particion.discardedHours + descartadoExtra) * 10_000) / 10_000;
        // Si el tope de 24 h recortó el tramo, lo descartado empieza donde termina el último guardado.
        const ultimo = tramos[tramos.length - 1];
        const descartadoDesde =
          descartadoExtra > 0 && ultimo ? ultimo.endedAt : particion.discardedFrom;
        return {
          creadas,
          particion: {
            ...particion,
            discardedHours: descartadas,
            discardedFrom: descartadas > 0 ? descartadoDesde : null,
            discardedTo: descartadas > 0 ? endedAt : null,
          },
        } as const;
      });
      if ("lock" in resultado && resultado.lock) {
        return reply
          .status(409)
          .send({ ...weekLockedBody(resultado.lock), message: resultado.lock.message + MENSAJE_CRONOMETRO_BLOQUEADO });
      }
      if ("error" in resultado) {
        return reply.status(400).send({ message: resultado.error });
      }
      const { creadas, particion } = resultado;

      // El cronómetro en sí (RunningTimer) no se audita: es estado efímero que
      // se crea, edita y descarta decenas de veces al día. Lo que importa son los
      // TimeEntry que nacen aquí, que entran al flujo de aprobación y mueven costos.
      // Quién lo registró sale del token, aunque un ADMIN/PM pueda detener el
      // cronómetro de otra persona (entonces el consultor del registro es otro).
      for (const entry of creadas) {
        await writeAudit(prisma, {
          entity: AUDIT_ENTITIES.timeEntry,
          entityId: entry.id,
          action: "CREATE",
          changedBy: request.authUser!.email,
          after: { ...(entry as unknown as Record<string, unknown>), origen: "cronometro" },
          request,
        });
      }

      // `data` sigue siendo el primer registro creado (compatibilidad, null si no cupo nada); `entries`
      // trae todos. `discardedHours` (con `discardedFrom`/`discardedTo`) es lo que pasó del tope de la
      // jornada y NO se guardó: el cronómetro no registra horas extra, el consultor las carga a mano.
      return reply.status(201).send({
        data: creadas[0] ?? null,
        entries: creadas,
        discardedHours: particion.discardedHours,
        discardedFrom: particion.discardedFrom,
        discardedTo: particion.discardedTo,
        totalHours: particion.totalHours,
      });
    },
  );

  // Descarta el cronómetro sin guardar nada.
  app.delete(
    "/",
    { preHandler: [authenticate, authorize(WRITE_ROLES)] },
    async (request, reply) => {
      const query = targetConsultantSchema.parse(request.query);
      const target = await resolveTargetConsultantId(request, query.consultantId);
      if ("error" in target) return reply.status(400).send({ message: target.error });

      const timer = await prisma.runningTimer.findUnique({
        where: { consultantId: target.consultantId },
      });
      if (!timer) return reply.status(404).send({ message: "No hay ningún cronómetro en marcha" });

      await prisma.runningTimer.delete({ where: { id: timer.id } });

      return reply.status(204).send();
    },
  );
}
