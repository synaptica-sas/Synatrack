import type { FastifyInstance } from "fastify";
import { AppRole, Prisma, TimeEntryStatus } from "@prisma/client";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";
import { consultantSinDatosSensiblesSelect, puedeVerTarifas } from "../../utils/consultant-scope.js";

/**
 * Las horas reales de una actividad se CALCULAN sumando los registros de horas
 * que apuntan a ella, no se escriben a mano.
 *
 * Antes `actualHours` era una columna que el formulario rellenaba, así que
 * convivían dos contabilidades del mismo trabajo -- la de `Activity` y la de
 * `TimeEntry` -- sin que nada las conciliara: se podían anotar 8 h en una
 * actividad y 0 en el timesheet, y el informe, la capacidad y el coste del
 * proyecto no se enteraban. Con el cálculo al leer hay una sola fuente de
 * verdad y no puede desincronizarse.
 *
 * Se excluyen las rechazadas: horas que un aprobador tumbó no son trabajo
 * hecho. Las pendientes sí cuentan, porque el trabajo ya ocurrió.
 */
async function conHorasReales<T extends { id: string }>(activities: T[]) {
  if (activities.length === 0) return activities;

  const sumas = await prisma.timeEntry.groupBy({
    by: ["activityId"],
    where: {
      activityId: { in: activities.map((a) => a.id) },
      status: { not: TimeEntryStatus.REJECTED },
    },
    _sum: { hours: true },
  });

  const porActividad = new Map(
    sumas.map((s) => [s.activityId, s._sum.hours ?? new Prisma.Decimal(0)]),
  );

  return activities.map((a) => ({
    ...a,
    actualHours: porActividad.get(a.id) ?? new Prisma.Decimal(0),
  }));
}

const activityPayloadSchema = z.object({
  title: z.string().trim().min(1, "El título es requerido").max(100, "El título no puede exceder los 100 caracteres"),
  description: z.string().trim().max(1000, "La descripción no puede exceder los 1000 caracteres").optional().nullable(),
  consultantId: z.string().min(1, "El consultor es requerido"),
  projectId: z.string().optional().nullable(),
  activityType: z.enum(["project", "personal", "meeting", "training", "support", "other"]).default("project"),
  scheduledDate: z.coerce.date(),
  dueDate: z.coerce.date().optional().nullable(),
  completedDate: z.coerce.date().optional().nullable(),
  estimatedHours: z.coerce.number().min(0, "Las horas estimadas no pueden ser negativas"),
  status: z.enum(["pending", "in_progress", "completed", "cancelled", "blocked"]).default("pending"),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  comments: z.string().trim().max(1000, "Los comentarios no pueden exceder los 1000 caracteres").optional().nullable(),
});

const activityQuerySchema = z.object({
  consultantId: z.string().optional(),
  projectId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

const idParamsSchema = z.object({ id: z.string().min(1) });

export async function activitiesRoutes(app: FastifyInstance) {
  // 1. Obtener listado de actividades con filtros por rol
  app.get(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT, AppRole.FINANCE, AppRole.VIEWER])],
    },
    async (request) => {
      const user = request.authUser!;
      const roles = user.roles;
      const email = user.email.toLowerCase();
      const query = activityQuerySchema.parse(request.query);

      let whereClause: any = {};
      // `true` cuando el listado ya está restringido a las filas del propio
      // usuario: entonces el consultor que viaja es él mismo y no hay fuga.
      let soloPropias = false;

      // Restricción por rol
      if (!roles.includes(AppRole.ADMIN) && !roles.includes(AppRole.FINANCE) && !roles.includes(AppRole.VIEWER)) {
        // Si es PM o Consultor, pero no admin/finanzas/viewer
        const consultant = await prisma.consultant.findFirst({
          where: { email: { equals: email, mode: "insensitive" } },
        });

        if (roles.includes(AppRole.PM)) {
          // El PM ve sus propias actividades y las de proyectos que gestiona
          whereClause = {
            OR: [
              { consultantId: consultant?.id || "none" },
              { project: { projectManagerEmail: { equals: email, mode: "insensitive" } } },
            ],
          };
        } else {
          // Consultor normal solo ve las suyas
          if (!consultant) {
            return { data: [] };
          }
          whereClause.consultantId = consultant.id;
          soloPropias = true;
        }
      }

      // Aplicar filtros adicionales de query si vienen
      if (query.consultantId) {
        // Si ya hay un filtro OR por rol (en PM), respetamos la jerarquía
        if (whereClause.OR) {
          whereClause = {
            AND: [
              whereClause,
              { consultantId: query.consultantId }
            ]
          };
        } else {
          whereClause.consultantId = query.consultantId;
        }
      }

      if (query.projectId) {
        if (whereClause.OR) {
          whereClause = {
            AND: [
              whereClause,
              { projectId: query.projectId }
            ]
          };
        } else {
          whereClause.projectId = query.projectId;
        }
      }

      if (query.startDate || query.endDate) {
        const dateFilter: any = {};
        if (query.startDate) {
          dateFilter.gte = new Date(query.startDate);
        }
        if (query.endDate) {
          dateFilter.lte = new Date(query.endDate);
        }
        
        if (whereClause.OR) {
          whereClause = {
            AND: [
              whereClause,
              { scheduledDate: dateFilter }
            ]
          };
        } else {
          whereClause.scheduledDate = dateFilter;
        }
      }

      // Alcance por campo (DEP-38): el consultor completo —con `hourlyRate`,
      // `costPerMonth` e `identification`— solo viaja para quien puede ver
      // tarifas. Un VIEWER recibe todas las actividades de la empresa, así que
      // aquí tenía la misma fuga que R5 cerró en `time-entries`. El consultor
      // corriente no entra por esta rama: su `whereClause` ya lo deja con sus
      // propias filas, y su propia tarifa sí la puede ver.
      const verTarifas = puedeVerTarifas(roles) || soloPropias;
      const orderBy = { scheduledDate: "desc" } as const;

      const entries = verTarifas
        ? await prisma.activity.findMany({
            where: whereClause,
            include: { project: true, consultant: true },
            orderBy,
          })
        : await prisma.activity.findMany({
            where: whereClause,
            include: {
              project: true,
              consultant: { select: consultantSinDatosSensiblesSelect },
            },
            orderBy,
          });

      return { data: await conHorasReales(entries) };
    },
  );

  // 2. Crear actividad
  app.post(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT])],
    },
    async (request, reply) => {
      const payload = activityPayloadSchema.parse(request.body);
      const user = request.authUser!;
      const email = user.email.toLowerCase();
      const roles = user.roles;

      // Si es consultor, validar que se asigne a sí mismo (a menos que sea Admin o PM)
      if (!roles.includes(AppRole.ADMIN) && !roles.includes(AppRole.PM)) {
        const consultant = await prisma.consultant.findFirst({
          where: { email: { equals: email, mode: "insensitive" } },
        });

        if (!consultant || consultant.id !== payload.consultantId) {
          return reply.status(403).send({ message: "No tienes permiso para registrar actividades a otro consultor" });
        }
      }

      // Validar proyecto si se provee
      if (payload.projectId) {
        const project = await prisma.project.findUnique({
          where: { id: payload.projectId },
        });
        if (!project) {
          return reply.status(400).send({ message: "El proyecto especificado no existe" });
        }
      }

      const activity = await prisma.activity.create({
        data: {
          title: payload.title,
          description: payload.description,
          consultantId: payload.consultantId,
          projectId: payload.projectId || null,
          activityType: payload.activityType,
          scheduledDate: payload.scheduledDate,
          dueDate: payload.dueDate || null,
          completedDate: payload.completedDate || null,
          estimatedHours: payload.estimatedHours,
          status: payload.status,
          priority: payload.priority,
          comments: payload.comments,
        },
        include: {
          project: true,
          consultant: true,
        },
      });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.activity,
        entityId: activity.id,
        action: "CREATE",
        changedBy: email,
        after: activity as unknown as Record<string, unknown>,
        request,
      });

      const [conHoras] = await conHorasReales([activity]);
      return reply.status(201).send({ data: conHoras });
    },
  );

  // 3. Editar actividad
  app.put(
    "/:id",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT])],
    },
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);
      const payload = activityPayloadSchema.parse(request.body);
      const user = request.authUser!;
      const email = user.email.toLowerCase();
      const roles = user.roles;

      const existing = await prisma.activity.findUnique({
        where: { id },
      });

      if (!existing) {
        return reply.status(404).send({ message: "Actividad no encontrada" });
      }

      // Si es consultor, validar propiedad
      if (!roles.includes(AppRole.ADMIN) && !roles.includes(AppRole.PM)) {
        const consultant = await prisma.consultant.findFirst({
          where: { email: { equals: email, mode: "insensitive" } },
        });

        if (!consultant || existing.consultantId !== consultant.id || payload.consultantId !== consultant.id) {
          return reply.status(403).send({ message: "No tienes permiso para modificar esta actividad" });
        }
      }

      // Validar proyecto
      if (payload.projectId) {
        const project = await prisma.project.findUnique({
          where: { id: payload.projectId },
        });
        if (!project) {
          return reply.status(400).send({ message: "El proyecto especificado no existe" });
        }
      }

      const updated = await prisma.activity.update({
        where: { id },
        data: {
          title: payload.title,
          description: payload.description,
          consultantId: payload.consultantId,
          projectId: payload.projectId || null,
          activityType: payload.activityType,
          scheduledDate: payload.scheduledDate,
          dueDate: payload.dueDate || null,
          completedDate: payload.completedDate || null,
          estimatedHours: payload.estimatedHours,
          status: payload.status,
          priority: payload.priority,
          comments: payload.comments,
        },
        include: {
          project: true,
          consultant: true,
        },
      });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.activity,
        entityId: updated.id,
        action: "UPDATE",
        changedBy: email,
        before: existing as unknown as Record<string, unknown>,
        after: updated as unknown as Record<string, unknown>,
        request,
      });

      const [conHoras] = await conHorasReales([updated]);
      return { data: conHoras };
    },
  );

  // 4. Eliminar actividad
  app.delete(
    "/:id",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT])],
    },
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);
      const user = request.authUser!;
      const email = user.email.toLowerCase();
      const roles = user.roles;

      const existing = await prisma.activity.findUnique({
        where: { id },
      });

      if (!existing) {
        return reply.status(404).send({ message: "Actividad no encontrada" });
      }

      // Si es consultor, validar propiedad
      if (!roles.includes(AppRole.ADMIN) && !roles.includes(AppRole.PM)) {
        const consultant = await prisma.consultant.findFirst({
          where: { email: { equals: email, mode: "insensitive" } },
        });

        if (!consultant || existing.consultantId !== consultant.id) {
          return reply.status(403).send({ message: "No tienes permiso para eliminar esta actividad" });
        }
      }

      await prisma.activity.delete({ where: { id } });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.activity,
        entityId: id,
        action: "DELETE",
        changedBy: email,
        before: existing as unknown as Record<string, unknown>,
        request,
      });

      return reply.status(204).send();
    },
  );
}
