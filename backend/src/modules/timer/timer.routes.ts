import type { FastifyInstance } from "fastify";
import { AppRole, Prisma, TimeEntrySource, TimeEntryStatus } from "@prisma/client";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import {
  isMonthClosed,
  resolveActivityId,
  resolveTargetConsultantId,
} from "../../utils/currentConsultant.js";

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
  project: true,
  activity: { select: { id: true, title: true } },
  consultant: { select: { id: true, fullName: true } },
} satisfies Prisma.RunningTimerInclude;

/** Un segundo expresado en horas: el valor más pequeño que se registra. */
const ONE_SECOND_IN_HOURS = 1 / 3600;

/**
 * Milisegundos a horas con 4 decimales, que es la precisión de la columna.
 *
 * Antes se redondeaba a 2 decimales con un mínimo de 0.01, y eso convertía un
 * minuto de cronómetro (0.0167 h) en 0.02 h -- un 20 % de más -- y cualquier
 * medición por debajo de 36 segundos en 36 segundos. Ahora el suelo es un
 * segundo y el redondeo conserva la medida real.
 */
function msToHours(ms: number) {
  const hours = ms / 3_600_000;
  return Math.max(ONE_SECOND_IN_HOURS, Math.round(hours * 10_000) / 10_000);
}

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
        select: { id: true },
      });
      if (!project) return reply.status(400).send({ message: "El proyecto indicado no existe" });

      const activity = await resolveActivityId(payload.activityId, target.consultantId);
      if (!activity.ok) {
        return reply.status(400).send({ message: activity.error });
      }

      const startedAt = payload.startedAt ?? new Date();
      if (startedAt.getTime() > Date.now() + 60_000) {
        return reply.status(400).send({ message: "El inicio del cronómetro no puede estar en el futuro" });
      }

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
          select: { id: true },
        });
        if (!project) return reply.status(400).send({ message: "El proyecto indicado no existe" });
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

      const endedAt = new Date();
      const hours = msToHours(endedAt.getTime() - timer.startedAt.getTime());

      // La entrada se imputa al día en que arrancó el cronómetro, aunque se
      // detenga pasada la medianoche.
      const workDate = new Date(
        Date.UTC(
          timer.startedAt.getUTCFullYear(),
          timer.startedAt.getUTCMonth(),
          timer.startedAt.getUTCDate(),
        ),
      );

      const closed = await isMonthClosed(timer.projectId, workDate);
      if (closed) {
        return reply.status(400).send({
          message: `El mes ${closed.year}-${String(closed.month).padStart(2, "0")} ya está cerrado para este proyecto, así que no se pueden registrar horas.`,
        });
      }

      // Crear la entrada y borrar el cronómetro van juntos: si falla el alta,
      // el cronómetro sigue en marcha y no se pierde el tiempo trabajado.
      const entry = await prisma.$transaction(async (tx) => {
        const created = await tx.timeEntry.create({
          data: {
            projectId: timer.projectId,
            consultantId: timer.consultantId,
            workDate,
            hours,
            description: timer.description,
            activityId: timer.activityId,
            source: TimeEntrySource.TIMER,
            startedAt: timer.startedAt,
            endedAt,
            status: TimeEntryStatus.PENDING,
          },
          include: {
            project: true,
            consultant: true,
            activity: { select: { id: true, title: true } },
          },
        });

        await tx.runningTimer.delete({ where: { id: timer.id } });

        return created;
      });

      return reply.status(201).send({ data: entry });
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
