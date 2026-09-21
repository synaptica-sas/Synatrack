import type { FastifyInstance } from "fastify";
import { AppRole, TimeEntryStatus } from "@prisma/client";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { consultantSinDatosSensiblesSelect } from "../../utils/consultant-scope.js";

const timeEntryPayloadSchema = z.object({
  projectId: z.string().min(1),
  consultantId: z.string().min(1),
  workDate: z.coerce.date(),
  hours: z.coerce.number().positive(),
  note: z.string().trim().optional(),
});

/**
 * El cuerpo del rechazo solo aporta el motivo: la identidad de quien rechaza sale
 * de `request.authUser`, nunca del cliente.
 */
const rejectPayloadSchema = z.object({
  rejectionNote: z.string().trim().min(3),
});

const idParamsSchema = z.object({ id: z.string().min(1) });


export async function timeEntriesRoutes(app: FastifyInstance) {
  app.get(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT, AppRole.VIEWER])],
    },
    async (request) => {
      // Alcance por fila, replicando el patrón de `extra-hours`:
      //   ADMIN      -> todas.
      //   PM         -> las suyas (como consultor) + las de los proyectos que gestiona.
      //   VIEWER     -> todas, pero sin los datos sensibles del consultor.
      //   CONSULTANT -> solo las suyas.
      // El orden de las comprobaciones fija la precedencia cuando alguien tiene
      // varios roles a la vez.
      const user = request.authUser!;
      const roles = user.roles;
      const email = user.email.toLowerCase();

      const incluirTodo = { project: true, consultant: true } as const;
      const orderBy = { workDate: "desc" } as const;

      if (roles.includes(AppRole.ADMIN)) {
        const entries = await prisma.timeEntry.findMany({ include: incluirTodo, orderBy });
        return { data: entries };
      }

      if (roles.includes(AppRole.PM)) {
        const entries = await prisma.timeEntry.findMany({
          where: {
            OR: [
              { consultant: { email } },
              { project: { projectManagerEmail: email } },
            ],
          },
          include: incluirTodo,
          orderBy,
        });
        return { data: entries };
      }

      if (roles.includes(AppRole.VIEWER)) {
        const entries = await prisma.timeEntry.findMany({
          include: {
            project: true,
            consultant: { select: consultantSinDatosSensiblesSelect },
          },
          orderBy,
        });
        return { data: entries };
      }

      const entries = await prisma.timeEntry.findMany({
        where: { consultant: { email } },
        include: incluirTodo,
        orderBy,
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

    // Un CONSULTANT solo puede registrar horas a su propio nombre. ADMIN y PM sí
    // pueden hacerlo a nombre de otros: es un flujo legítimo de la PMO.
    const user = request.authUser!;
    const esGestor = user.roles.includes(AppRole.ADMIN) || user.roles.includes(AppRole.PM);

    if (!esGestor) {
      const propio = await prisma.consultant.findFirst({
        where: { email: user.email.toLowerCase() },
        select: { id: true },
      });

      if (!propio) {
        return reply.status(403).send({
          message: `No hay un consultor asociado al correo ${user.email}, así que no se pueden registrar horas a tu nombre. Pide a un administrador que cree tu ficha de consultor.`,
        });
      }

      if (propio.id !== payload.consultantId) {
        return reply.status(403).send({
          message: "Solo puedes registrar horas a tu propio nombre.",
        });
      }
    }

    const entryYear = payload.workDate.getUTCFullYear();
    const entryMonth = payload.workDate.getUTCMonth() + 1;

    const isClosed = await prisma.monthlySnapshot.findUnique({
      where: {
        projectId_year_month: {
          projectId: payload.projectId,
          year: entryYear,
          month: entryMonth,
        },
      },
    });

    if (isClosed) {
      return reply.status(400).send({
        message: `No se pueden registrar horas en un mes cerrado para este proyecto (${entryYear}-${String(entryMonth).padStart(2, "0")}).`,
      });
    }

    const [project, consultant] = await Promise.all([
      prisma.project.findUnique({ where: { id: payload.projectId } }),
      prisma.consultant.findUnique({ where: { id: payload.consultantId } }),
    ]);

    if (!project) {
      return reply.status(400).send({ message: "Invalid projectId" });
    }

    if (!consultant) {
      return reply.status(400).send({ message: "Invalid consultantId" });
    }

    const entry = await prisma.timeEntry.create({
      data: {
        projectId: payload.projectId,
        consultantId: payload.consultantId,
        workDate: payload.workDate,
        hours: payload.hours,
        note: payload.note,
        status: TimeEntryStatus.PENDING,
      },
    });

      return reply.status(201).send({ data: entry });
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

      return { data: entry };
    },
  );

  app.delete(
    "/:id",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])],
    },
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);

      const existing = await prisma.timeEntry.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({ message: "Time entry not found" });
      }

      const entryYear = existing.workDate.getUTCFullYear();
      const entryMonth = existing.workDate.getUTCMonth() + 1;

      const isClosed = await prisma.monthlySnapshot.findUnique({
        where: {
          projectId_year_month: {
            projectId: existing.projectId,
            year: entryYear,
            month: entryMonth,
          },
        },
      });

      if (isClosed) {
        return reply.status(400).send({
          message: "No se pueden eliminar horas de un mes cerrado para este proyecto.",
        });
      }

      try {
        await prisma.timeEntry.delete({ where: { id } });
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
