import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppRole, Prisma, TimeEntrySource, TimeEntryStatus } from "@prisma/client";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { consultantSinDatosSensiblesSelect } from "../../utils/consultant-scope.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";
import {
  findMyConsultant,
  isMonthClosed,
  resolveActivityId,
  resolveTargetConsultantId,
} from "../../utils/currentConsultant.js";

const timeEntryPayloadSchema = z.object({
  projectId: z.string().min(1),
  // Opcional desde que existen el timesheet y el tracker: cuando no viene, se
  // resuelve a partir del usuario autenticado. Solo ADMIN y PM pueden imputar
  // horas a nombre de otra persona.
  consultantId: z.string().min(1).optional(),
  workDate: z.coerce.date(),
  hours: z.coerce.number().positive(),
  note: z.string().trim().optional(),
  description: z.string().trim().max(500).optional().nullable(),
  activityId: z.string().min(1).optional().nullable(),
  source: z.enum(["MANUAL", "TIMESHEET", "TIMER"]).optional(),
});

/** Edición de una entrada ya creada: una celda de la grilla semanal. */
const timeEntryUpdateSchema = z.object({
  hours: z.coerce.number().positive().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  activityId: z.string().min(1).nullable().optional(),
  note: z.string().trim().nullable().optional(),
  projectId: z.string().min(1).optional(),
  workDate: z.coerce.date().optional(),
});

const listQuerySchema = z.object({
  consultantId: z.string().optional(),
  projectId: z.string().optional(),
  /** Rango [from, to] inclusivo, en formato YYYY-MM-DD. */
  from: z.string().optional(),
  to: z.string().optional(),
  /** "1" restringe el listado a las horas del usuario autenticado. */
  mine: z.string().optional(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
});

/**
 * El cuerpo del rechazo solo aporta el motivo: la identidad de quien rechaza sale
 * de `request.authUser`, nunca del cliente.
 */
const rejectPayloadSchema = z.object({
  rejectionNote: z.string().trim().min(3),
});

const idParamsSchema = z.object({ id: z.string().min(1) });

/** Normaliza una fecha a medianoche UTC para que una celda del día sea única. */
function toUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Alcance por fila según el rol:
 *   ADMIN      -> todas.
 *   PM         -> las suyas (como consultor) + las de los proyectos que gestiona.
 *   VIEWER     -> todas, pero sin los datos sensibles del consultor.
 *   CONSULTANT -> solo las suyas.
 *
 * El orden fija la precedencia cuando alguien tiene varios roles a la vez.
 * Devolver un `where` en lugar de ejecutar la consulta permite componerlo con
 * los filtros de la petición sin que estos puedan ampliarlo.
 */
function visibilityScope(request: FastifyRequest): {
  where: Prisma.TimeEntryWhereInput;
  ocultarDatosSensibles: boolean;
} {
  const user = request.authUser!;
  const roles = user.roles;
  const email = user.email.toLowerCase();

  if (roles.includes(AppRole.ADMIN)) return { where: {}, ocultarDatosSensibles: false };

  if (roles.includes(AppRole.PM)) {
    return {
      where: {
        OR: [{ consultant: { email } }, { project: { projectManagerEmail: email } }],
      },
      ocultarDatosSensibles: false,
    };
  }

  if (roles.includes(AppRole.VIEWER)) return { where: {}, ocultarDatosSensibles: true };

  return { where: { consultant: { email } }, ocultarDatosSensibles: false };
}

/**
 * Un consultor solo puede modificar o borrar sus propias horas, y solo mientras
 * sigan pendientes de aprobación. ADMIN y PM no tienen esa restricción.
 */
async function canMutateEntry(request: FastifyRequest, entry: { consultantId: string }) {
  const roles = request.authUser?.roles ?? [];
  if (roles.includes(AppRole.ADMIN) || roles.includes(AppRole.PM)) return true;

  const mine = await findMyConsultant(request);
  return !!mine && mine.id === entry.consultantId;
}

export async function timeEntriesRoutes(app: FastifyInstance) {
  /**
   * Ficha de consultor del usuario autenticado. El timesheet y el tracker la
   * necesitan para saber a nombre de quién registran las horas, y un consultor
   * no tiene permiso para listar el directorio completo.
   */
  app.get(
    "/me",
    {
      preHandler: [
        authenticate,
        authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT, AppRole.FINANCE, AppRole.VIEWER]),
      ],
    },
    async (request) => {
      const consultant = await findMyConsultant(request);
      return { data: consultant };
    },
  );

  app.get(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT, AppRole.VIEWER])],
    },
    async (request) => {
      const query = listQuerySchema.parse(request.query);
      const { where: scope, ocultarDatosSensibles } = visibilityScope(request);

      // Los filtros de la petición se acumulan sobre el alcance del rol; nunca
      // lo sustituyen, así que no pueden ampliar lo que alguien puede ver.
      const filtros: Prisma.TimeEntryWhereInput[] = [];

      if (query.mine === "1") {
        const mine = await findMyConsultant(request);
        filtros.push({ consultantId: mine?.id ?? "__none__" });
      } else if (query.consultantId) {
        filtros.push({ consultantId: query.consultantId });
      }

      if (query.projectId) filtros.push({ projectId: query.projectId });
      if (query.status) filtros.push({ status: query.status as TimeEntryStatus });

      if (query.from || query.to) {
        filtros.push({
          workDate: {
            ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
            ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
          },
        });
      }

      const entries = await prisma.timeEntry.findMany({
        where: filtros.length > 0 ? { AND: [scope, ...filtros] } : scope,
        include: {
          project: true,
          consultant: ocultarDatosSensibles
            ? { select: consultantSinDatosSensiblesSelect }
            : true,
          activity: { select: { id: true, title: true } },
        },
        orderBy: { workDate: "desc" },
      });

      return { data: entries };
    },
  );

  app.post(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT])],
    },
    async (request, reply) => {
      const payload = timeEntryPayloadSchema.parse(request.body);
      const user = request.authUser!;

      // Un CONSULTANT solo puede registrar horas a su propio nombre; ADMIN y PM
      // sí pueden hacerlo a nombre de otros, que es un flujo legítimo de la PMO.
      const target = await resolveTargetConsultantId(request, payload.consultantId);
      if ("error" in target) {
        return reply.status(403).send({ message: target.error });
      }

      const workDate = toUtcDay(payload.workDate);

      const closed = await isMonthClosed(payload.projectId, workDate);
      if (closed) {
        return reply.status(400).send({
          message: `No se pueden registrar horas en un mes cerrado para este proyecto (${closed.year}-${String(closed.month).padStart(2, "0")}).`,
        });
      }

      const project = await prisma.project.findUnique({ where: { id: payload.projectId } });
      if (!project) {
        return reply.status(400).send({ message: "El proyecto indicado no existe" });
      }

      const activity = await resolveActivityId(payload.activityId, target.consultantId);
      if (!activity.ok) {
        return reply.status(400).send({ message: activity.error });
      }

      const entry = await prisma.timeEntry.create({
        data: {
          projectId: payload.projectId,
          consultantId: target.consultantId,
          workDate,
          hours: payload.hours,
          note: payload.note,
          description: payload.description || null,
          activityId: activity.activityId,
          source: (payload.source as TimeEntrySource) ?? TimeEntrySource.MANUAL,
          status: TimeEntryStatus.PENDING,
        },
      });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.timeEntry,
        entityId: entry.id,
        action: "CREATE",
        changedBy: user.email,
        after: entry as unknown as Record<string, unknown>,
        request,
      });

      return reply.status(201).send({ data: entry });
    },
  );

  /**
   * Edita una entrada pendiente. Es lo que usa la grilla semanal cada vez que
   * cambia el valor de una celda que ya existía.
   */
  app.patch(
    "/:id",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT])],
    },
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);
      const payload = timeEntryUpdateSchema.parse(request.body);

      const existing = await prisma.timeEntry.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({ message: "Registro de horas no encontrado" });
      }

      if (!(await canMutateEntry(request, existing))) {
        return reply.status(403).send({ message: "Solo puedes editar tus propias horas" });
      }

      if (existing.status !== TimeEntryStatus.PENDING) {
        return reply.status(409).send({
          message: "Solo se pueden editar las horas que siguen pendientes de aprobación",
        });
      }

      const workDate = payload.workDate ? toUtcDay(payload.workDate) : existing.workDate;
      const projectId = payload.projectId ?? existing.projectId;

      // Se comprueban el periodo de origen y el de destino: mover una entrada a
      // un mes cerrado, o sacarla de él, tampoco está permitido.
      for (const [checkProject, checkDate] of [
        [existing.projectId, existing.workDate],
        [projectId, workDate],
      ] as const) {
        const closed = await isMonthClosed(checkProject, checkDate);
        if (closed) {
          return reply.status(400).send({
            message: `No se pueden modificar horas de un mes cerrado para este proyecto (${closed.year}-${String(closed.month).padStart(2, "0")}).`,
          });
        }
      }

      let activityId: string | null | undefined;
      if (payload.activityId !== undefined) {
        const resolved = await resolveActivityId(payload.activityId, existing.consultantId);
        if (!resolved.ok) {
          return reply.status(400).send({ message: resolved.error });
        }
        activityId = resolved.activityId;
      }

      const entry = await prisma.timeEntry.update({
        where: { id },
        data: {
          hours: payload.hours ?? undefined,
          description: payload.description === undefined ? undefined : payload.description || null,
          note: payload.note === undefined ? undefined : payload.note || null,
          activityId,
          projectId: payload.projectId ?? undefined,
          workDate: payload.workDate ? workDate : undefined,
        },
      });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.timeEntry,
        entityId: entry.id,
        action: "UPDATE",
        changedBy: request.authUser!.email,
        before: existing as unknown as Record<string, unknown>,
        after: entry as unknown as Record<string, unknown>,
        request,
      });

      return { data: entry };
    },
  );

  app.patch(
    "/:id/approve",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])],
    },
    async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    // La identidad de quien aprueba sale del token, no del cuerpo de la petición.
    const revisor = request.authUser!.email.toLowerCase();

    const existing = await prisma.timeEntry.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ message: "Time entry not found" });
    }

    if (existing.status !== TimeEntryStatus.PENDING) {
      return reply.status(409).send({ message: "Only pending entries can be approved" });
    }

    const entry = await prisma.timeEntry.update({
      where: { id },
      data: {
        status: TimeEntryStatus.APPROVED,
        approvedAt: new Date(),
        approvedBy: revisor,
        rejectionNote: null,
      },
    });

    await writeAudit(prisma, {
      entity: AUDIT_ENTITIES.timeEntry,
      entityId: entry.id,
      action: "APPROVE",
      changedBy: revisor,
      before: existing as unknown as Record<string, unknown>,
      after: entry as unknown as Record<string, unknown>,
      request,
    });

      return { data: entry };
    },
  );

  app.patch(
    "/:id/reject",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])],
    },
    async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const payload = rejectPayloadSchema.parse(request.body);
    // La identidad de quien rechaza sale del token, no del cuerpo de la petición.
    const revisor = request.authUser!.email.toLowerCase();

    const existing = await prisma.timeEntry.findUnique({ where: { id } });
    if (!existing) {
      return reply.status(404).send({ message: "Time entry not found" });
    }

    if (existing.status !== TimeEntryStatus.PENDING) {
      return reply.status(409).send({ message: "Only pending entries can be rejected" });
    }

    const entry = await prisma.timeEntry.update({
      where: { id },
      data: {
        status: TimeEntryStatus.REJECTED,
        approvedAt: null,
        approvedBy: revisor,
        rejectionNote: payload.rejectionNote,
      },
    });

    await writeAudit(prisma, {
      entity: AUDIT_ENTITIES.timeEntry,
      entityId: entry.id,
      action: "REJECT",
      changedBy: revisor,
      before: existing as unknown as Record<string, unknown>,
      after: entry as unknown as Record<string, unknown>,
      request,
    });

      return { data: entry };
    },
  );

  app.delete(
    "/:id",
    {
      // El consultor entra aquí al vaciar una celda del timesheet; la
      // comprobación de propiedad se hace más abajo.
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT])],
    },
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);

      const existing = await prisma.timeEntry.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({ message: "Time entry not found" });
      }

      if (!(await canMutateEntry(request, existing))) {
        return reply.status(403).send({ message: "Solo puedes eliminar tus propias horas" });
      }

      const roles = request.authUser?.roles ?? [];
      const isReviewer = roles.includes(AppRole.ADMIN) || roles.includes(AppRole.PM);
      if (!isReviewer && existing.status !== TimeEntryStatus.PENDING) {
        return reply.status(409).send({
          message: "Solo se pueden eliminar las horas que siguen pendientes de aprobación",
        });
      }

      const closed = await isMonthClosed(existing.projectId, existing.workDate);
      if (closed) {
        return reply.status(400).send({
          message: "No se pueden eliminar horas de un mes cerrado para este proyecto.",
        });
      }

      try {
        await prisma.timeEntry.delete({ where: { id } });

        await writeAudit(prisma, {
          entity: AUDIT_ENTITIES.timeEntry,
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
          return reply.status(409).send({ message: "No se puede eliminar el registro de horas: tiene otros registros relacionados" });
        }
        throw err;
      }
    },
  );
}
