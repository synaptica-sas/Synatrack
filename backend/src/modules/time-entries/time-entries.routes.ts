import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppRole, Prisma, TimeEntryCategory, TimeEntrySource, TimeEntryStatus } from "@prisma/client";
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
import { isValidIsoDate, toIsoDate, type IsoDate } from "../../utils/isoDate.js";
import { weekStartOf } from "../../utils/timesheetWeek.js";
import { MAX_DAYS_RANGE, loadDaysContext, lockDay, summaryOfContext, type Db } from "./day-context.service.js";
import {
  ENTRY_WITH_TYPE_INCLUDE,
  loadTypes,
  saveDayGroup,
  syncAbsenceBlock,
  type AuditEvent,
  type ProposedRow,
  type SaveDayError,
  type TypeInfo,
} from "./timesheet.service.js";
import {
  checkWeekEditable,
  lockAndCheckWeeks,
  lockWeek,
  lockAndCheckMonths,
  monthClosedDayResult,
  weekLockedBody,
  weekLockedDayResult,
} from "../timesheet-weeks/timesheet-weeks.service.js";

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
  // Tipo de hora (R14). Sin él se usa REGULAR.
  typeId: z.string().min(1).optional(),
  // Franja horaria opcional ("09:00 - 09:04" en la ventana de edición).
  startedAt: z.coerce.date().nullable().optional(),
  endedAt: z.coerce.date().nullable().optional(),
});

/** Edición de una entrada ya creada: una celda de la grilla semanal. */
const timeEntryUpdateSchema = z.object({
  hours: z.coerce.number().positive().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  activityId: z.string().min(1).nullable().optional(),
  note: z.string().trim().nullable().optional(),
  projectId: z.string().min(1).optional(),
  workDate: z.coerce.date().optional(),
  startedAt: z.coerce.date().nullable().optional(),
  endedAt: z.coerce.date().nullable().optional(),
  typeId: z.string().min(1).optional(),
});

/**
 * Guardado del día de un proyecto (R14 §3). Las horas se validan en el servicio
 * (`validateDay`) para devolver el código y el índice de la fila culpable, no un error de Zod.
 */
const dayEntrySchema = z.object({
  id: z.string().min(1).optional(),
  typeId: z.string().min(1),
  hours: z.coerce.number(),
  startedAt: z.coerce.date().nullable().optional(),
  endedAt: z.coerce.date().nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  note: z.string().trim().nullable().optional(),
  activityId: z.string().min(1).nullable().optional(),
});

const dayPutSchema = z.object({
  projectId: z.string().min(1),
  consultantId: z.string().min(1).optional(),
  workDate: z.coerce.date(),
  entries: z.array(dayEntrySchema).max(50),
});

const daySummaryQuerySchema = z.object({
  consultantId: z.string().min(1).optional(),
  from: z.string().refine(isValidIsoDate, "from debe ser YYYY-MM-DD"),
  to: z.string().refine(isValidIsoDate, "to debe ser YYYY-MM-DD"),
});

/** Una franja con inicio y fin solo tiene sentido si el fin va después. */
function franjaInvalida(startedAt: Date | null | undefined, endedAt: Date | null | undefined) {
  return !!startedAt && !!endedAt && endedAt.getTime() <= startedAt.getTime();
}

const FRANJA_INVALIDA = "La hora de fin debe ser posterior a la de inicio.";

const listQuerySchema = z.object({
  consultantId: z.string().optional(),
  projectId: z.string().optional(),
  /** Rango [from, to] inclusivo, en formato YYYY-MM-DD. */
  from: z.string().optional(),
  to: z.string().optional(),
  /** "1" restringe el listado a las horas del usuario autenticado. */
  mine: z.string().optional(),
  status: z.enum(["PENDING", "SUBMITTED", "APPROVED", "REJECTED"]).optional(),
  // Paginación con el mismo contrato que `/api/audit`: `page` empieza en 1 y
  // `pageSize` está topado a 100 para que nadie pueda pedir la tabla entera
  // en una sola petición.
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
});

const idParamsSchema = z.object({ id: z.string().min(1) });

const descriptionsQuerySchema = z.object({
  projectId: z.string().min(1).optional(),
  consultantId: z.string().min(1).optional(),
});

/** Una tarea tal como la identifica la grilla: descripción + actividad. */
const taskRefSchema = z.object({
  description: z.string().trim().max(500),
  activityId: z.string().min(1).nullable(),
});

const mergeTaskSchema = z.object({
  projectId: z.string().min(1),
  consultantId: z.string().min(1).optional(),
  from: taskRefSchema,
  to: taskRefSchema,
});

/**
 * Filtro por descripción que trata igual "Tarea", "tarea" y la ausencia de
 * descripción que la grilla muestra como vacía. Es el mismo criterio con el
 * que la grilla agrupa filas, así que fusionar una fila afecta exactamente a
 * los registros que esa fila muestra.
 */
function descriptionFilter(description: string): Prisma.TimeEntryWhereInput {
  if (description === "") return { OR: [{ description: null }, { description: "" }] };
  return { description: { equals: description, mode: "insensitive" } };
}

/** Normaliza una fecha a medianoche UTC para que una celda del día sea única. */
function toUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Id del tipo REGULAR: se resuelve por `code`, no por el id literal de la semilla. */
function regularTypeId(types: Map<string, TypeInfo>): string | null {
  for (const t of types.values()) if (t.code === "REGULAR") return t.id;
  return null;
}

/** Error de validación del día: 400 `{ message, error, code, index, errors }`. */
function sendDayError(reply: { status: (n: number) => { send: (b: unknown) => unknown } }, e: SaveDayError) {
  return reply.status(e.status).send({
    message: e.message,
    error: e.message,
    code: e.code,
    index: e.index,
    errors: e.errors,
  });
}

/** Registra en la bitácora los eventos que devolvió una escritura ya confirmada. */
async function flushAudits(
  request: FastifyRequest,
  events: AuditEvent[],
  entity: typeof AUDIT_ENTITIES.timeEntry | typeof AUDIT_ENTITIES.consultantBlock = AUDIT_ENTITIES.timeEntry,
) {
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
        OR: [
          { consultantId: user.consultantId ?? "__none__" },
          { project: { projectManagerEmail: email } },
        ],
      },
      ocultarDatosSensibles: false,
    };
  }

  if (roles.includes(AppRole.VIEWER)) return { where: {}, ocultarDatosSensibles: true };

  return { where: { consultantId: user.consultantId ?? "__none__" }, ocultarDatosSensibles: false };
}

/**
 * Un consultor solo puede modificar o borrar sus propias horas, y solo mientras
 * sigan pendientes de aprobación. ADMIN no tiene esa restricción.
 *
 * Un PM solo la tiene levantada para los proyectos que gestiona
 * (`Project.projectManagerEmail`): antes CUALQUIER PM podía editar o borrar las
 * horas de CUALQUIER proyecto, propio o no. Un PM que no gestiona el proyecto
 * de la entrada cae al mismo criterio que el resto: solo puede tocar lo suyo.
 */
/** Separación de funciones: las horas extra las registra SOLO el consultor dueño. */
const MENSAJE_EXTRA_SOLO_PROPIO = "Las horas extra solo las puede registrar el propio consultor.";

function esConsultorPropio(request: FastifyRequest, consultantId: string) {
  return !!request.authUser?.consultantId && request.authUser.consultantId === consultantId;
}

async function canMutateEntry(request: FastifyRequest, entry: { consultantId: string; projectId: string }) {
  const roles = request.authUser?.roles ?? [];
  if (roles.includes(AppRole.ADMIN)) return true;

  if (roles.includes(AppRole.PM)) {
    const project = await prisma.project.findUnique({
      where: { id: entry.projectId },
      select: { projectManagerEmail: true },
    });
    const pmEmail = project?.projectManagerEmail?.trim().toLowerCase();
    const email = request.authUser?.email?.toLowerCase();
    if (pmEmail && email && pmEmail === email) return true;
  }

  const mine = await findMyConsultant(request);
  return !!mine && mine.id === entry.consultantId;
}

/**
 * Borrado de horas (decisión 2026-11-05): cada quien borra solo las suyas; borrar las de otro
 * consultor exige ADMIN. El PM no borra horas ajenas aunque gestione el proyecto: si algo está mal,
 * devuelve la semana con una nota. Se aplica a todos los tipos (REGULAR, EXTRA y ABSENCE).
 */
const MENSAJE_BORRAR_AJENO =
  "Solo un administrador puede eliminar horas de otro consultor. Devuelve la semana con una nota o pídele al consultor que las corrija.";

async function canDeleteEntry(request: FastifyRequest, consultantId: string) {
  if ((request.authUser?.roles ?? []).includes(AppRole.ADMIN)) return true;
  const mine = await findMyConsultant(request);
  return !!mine && mine.id === consultantId;
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

  /**
   * Descripciones de tarea que ya usó un consultor, de la más reciente a la más
   * antigua. Alimentan el autocompletado del rastreador y del timesheet: si la
   * gente elige una tarea existente en vez de reescribirla, las horas caen en
   * la misma fila y no aparece una nueva por cada errata.
   *
   * Se deduplican sin distinguir mayúsculas, igual que agrupa la grilla, y se
   * conserva la grafía del uso más reciente.
   */
  app.get(
    "/descriptions",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT])],
    },
    async (request, reply) => {
      const query = descriptionsQuerySchema.parse(request.query);

      const target = await resolveTargetConsultantId(request, query.consultantId);
      if ("error" in target) {
        return reply.status(403).send({ message: target.error });
      }

      const grupos = await prisma.timeEntry.groupBy({
        by: ["description"],
        where: {
          consultantId: target.consultantId,
          ...(query.projectId ? { projectId: query.projectId } : {}),
          description: { not: null },
          NOT: { description: "" },
        },
        _max: { createdAt: true },
        _count: { _all: true },
        orderBy: { _max: { createdAt: "desc" } },
        take: 200,
      });

      const vistas = new Set<string>();
      const data: { description: string; uses: number; lastUsedAt: Date | null }[] = [];
      for (const g of grupos) {
        const description = (g.description ?? "").trim();
        const clave = description.toLowerCase();
        if (!description || vistas.has(clave)) continue;
        vistas.add(clave);
        data.push({ description, uses: g._count._all, lastUsedAt: g._max.createdAt });
        if (data.length >= 50) break;
      }

      return { data };
    },
  );

  /**
   * Fusiona dos tareas: todas las horas de `from` pasan a llamarse como `to`,
   * en toda la historia del consultor en ese proyecto, no solo en la semana
   * visible. Si solo se fusionara la semana, la errata seguiría viva en las
   * anteriores y el autocompletado la seguiría sugiriendo.
   *
   * Cambia la etiqueta, nunca las horas. Aun así respeta dos reglas del resto
   * del módulo: no toca meses cerrados, y un consultor solo reetiqueta sus
   * horas pendientes (las aprobadas ya las revisó alguien tal como estaban).
   * Lo que se salta se devuelve contado para poder explicarlo en pantalla.
   */
  app.post(
    "/merge-task",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT])],
    },
    async (request, reply) => {
      const payload = mergeTaskSchema.parse(request.body);

      const mismaTarea =
        payload.from.description.toLowerCase() === payload.to.description.toLowerCase() &&
        payload.from.activityId === payload.to.activityId;
      if (mismaTarea) {
        return reply.status(400).send({ message: "No se puede fusionar una tarea consigo misma" });
      }

      const target = await resolveTargetConsultantId(request, payload.consultantId);
      if ("error" in target) {
        return reply.status(403).send({ message: target.error });
      }

      const activity = await resolveActivityId(payload.to.activityId, target.consultantId);
      if (!activity.ok) {
        return reply.status(400).send({ message: activity.error });
      }

      const roles = request.authUser?.roles ?? [];

      // Todo en UNA transacción con el candado de cada semana tocada: la comprobación de bloqueo
      // (R15) no puede competir con un envío concurrente.
      const filtro = {
        consultantId: target.consultantId,
        projectId: payload.projectId,
        activityId: payload.from.activityId,
        ...descriptionFilter(payload.from.description),
      };
      const { aFusionar, actualizadas, saltadasCerradas, saltadasRevisadas, saltadasSemana } = await prisma.$transaction(
        async (tx) => {
          const previas = await tx.timeEntry.findMany({ where: filtro, select: { workDate: true } });
          const semanas = [...new Set(previas.map((e) => weekStartOf(toIsoDate(e.workDate))))].sort();
          for (const semana of semanas) await lockWeek(tx, target.consultantId, semana);
          const candidatas = await tx.timeEntry.findMany({ where: filtro });

          // Meses cerrados: se consulta cada mes distinto una sola vez.
          const mesesCerrados = new Set<string>();
          const mesesVistos = new Set<string>();
          for (const e of candidatas) {
            const mes = `${e.workDate.getUTCFullYear()}-${e.workDate.getUTCMonth()}`;
            if (mesesVistos.has(mes)) continue;
            mesesVistos.add(mes);
            if (await isMonthClosed(payload.projectId, e.workDate)) mesesCerrados.add(mes);
          }

          // Semanas enviadas o aprobadas (R15): bloqueadas para todos los roles. Una devolución
          // reabre solo ese proyecto.
          const semanasBloqueadas = new Set<string>();
          const semanasVistas = new Set<string>();
          for (const e of candidatas) {
            const semana = weekStartOf(toIsoDate(e.workDate));
            if (semanasVistas.has(semana)) continue;
            semanasVistas.add(semana);
            if (await checkWeekEditable(tx, target.consultantId, payload.projectId, e.workDate)) {
              semanasBloqueadas.add(semana);
            }
          }

          let saltadasCerradas = 0;
          let saltadasRevisadas = 0;
          let saltadasSemana = 0;
          const aFusionar = candidatas.filter((e) => {
            const mes = `${e.workDate.getUTCFullYear()}-${e.workDate.getUTCMonth()}`;
            if (mesesCerrados.has(mes)) {
              saltadasCerradas++;
              return false;
            }
            if (semanasBloqueadas.has(weekStartOf(toIsoDate(e.workDate)))) {
              saltadasSemana++;
              return false;
            }
            // Solo se reetiqueta lo PENDING editable; lo enviado nunca se toca y lo aprobado lo corrige
            // únicamente ADMIN (un PM ya no).
            const esAdmin = roles.includes(AppRole.ADMIN);
            if (e.status === TimeEntryStatus.SUBMITTED || (!esAdmin && e.status !== TimeEntryStatus.PENDING)) {
              saltadasRevisadas++;
              return false;
            }
            return true;
          });

          const actualizadas = [];
          for (const e of aFusionar) {
            actualizadas.push(
              await tx.timeEntry.update({
                where: { id: e.id },
                data: { description: payload.to.description || null, activityId: activity.activityId },
              }),
            );
          }
          return { aFusionar, actualizadas, saltadasCerradas, saltadasRevisadas, saltadasSemana };
        },
        { timeout: 30_000, maxWait: 10_000 },
      );

      // La auditoría va después de confirmar, como en el resto del módulo.
      for (let i = 0; i < actualizadas.length; i++) {
        await writeAudit(prisma, {
          entity: AUDIT_ENTITIES.timeEntry,
          entityId: actualizadas[i].id,
          action: "UPDATE",
          changedBy: request.authUser!.email,
          before: aFusionar[i] as unknown as Record<string, unknown>,
          after: actualizadas[i] as unknown as Record<string, unknown>,
          request,
        });
      }

      return {
        data: {
          merged: actualizadas.length,
          skippedClosedMonth: saltadasCerradas,
          skippedReviewed: saltadasRevisadas,
          skippedWeekLocked: saltadasSemana,
        },
      };
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

      const where = filtros.length > 0 ? { AND: [scope, ...filtros] } : scope;
      const skip = (query.page - 1) * query.pageSize;

      // El desempate por `id` es lo que hace estable la paginación: varias
      // horas comparten el mismo `workDate` a diario, y sin un segundo criterio
      // Postgres puede devolverlas en distinto orden en cada página y hacer que
      // una fila se repita o se pierda entre la página 1 y la 2.
      const [entries, total] = await Promise.all([
        prisma.timeEntry.findMany({
          where,
          include: {
            project: { include: { company: true } },
            consultant: ocultarDatosSensibles
              ? { select: consultantSinDatosSensiblesSelect }
              : true,
            activity: { select: { id: true, title: true } },
          },
          orderBy: [{ workDate: "desc" }, { id: "desc" }],
          skip,
          take: query.pageSize,
        }),
        // `where` ya incluye el alcance del rol, así que el total es el que ese
        // usuario puede ver. Contar sobre la tabla entera filtraría cuántas
        // horas hay de gente que no le corresponde.
        prisma.timeEntry.count({ where }),
      ]);

      return {
        data: entries,
        meta: {
          total,
          page: query.page,
          pageSize: query.pageSize,
          totalPages: Math.ceil(total / query.pageSize),
        },
      };
    },
  );

  /**
   * Resumen por día de un consultor (R14 §3): jornada vigente, regular + ausencias usadas en TODOS
   * los proyectos, si el día admite horas regulares y, por proyecto, el saldo EXTRA aprobado y usado.
   * Alimenta el pie del modal "Editar tiempo" y la celda del grid. Solo lectura.
   *
   * Visibilidad: ADMIN, PM y VIEWER pueden pedir a cualquier consultor (mismo criterio que
   * `resolveTargetConsultantId` para PM y que el listado para VIEWER); un CONSULTANT solo el suyo.
   */
  app.get(
    "/day-summary",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT, AppRole.VIEWER])],
    },
    async (request, reply) => {
      const query = daySummaryQuerySchema.parse(request.query);
      const roles = request.authUser!.roles;
      const veTodos = roles.includes(AppRole.ADMIN) || roles.includes(AppRole.VIEWER);
      const esPm = roles.includes(AppRole.PM);

      let consultantId: string;
      if (query.consultantId && (veTodos || esPm)) {
        const exists = await prisma.consultant.findUnique({ where: { id: query.consultantId }, select: { id: true } });
        if (!exists) return reply.status(404).send({ message: "El consultor indicado no existe" });
        consultantId = exists.id;
        // Un PM (sin ADMIN/VIEWER) solo ve a sí mismo o a quien tiene horas o asignaciones en
        // un proyecto que él dirige.
        if (!veTodos && consultantId !== request.authUser!.consultantId) {
          const pm = { projectManagerEmail: { equals: request.authUser!.email, mode: "insensitive" as const } };
          const [horas, asignacion] = await Promise.all([
            prisma.timeEntry.findFirst({ where: { consultantId, project: pm }, select: { id: true } }),
            prisma.assignment.findFirst({ where: { consultantId, project: pm }, select: { id: true } }),
          ]);
          if (!horas && !asignacion) {
            return reply.status(403).send({ message: "No puedes consultar el resumen de un consultor que no está en tus proyectos." });
          }
        }
      } else {
        const mine = await findMyConsultant(request);
        if (!mine) {
          return reply.status(400).send({ message: "Tu usuario no tiene una ficha de consultor enlazada." });
        }
        if (query.consultantId && query.consultantId !== mine.id) {
          return reply.status(403).send({ message: "Solo puedes consultar tu propio resumen." });
        }
        consultantId = mine.id;
      }

      if (query.to < query.from) {
        return reply.status(400).send({ message: "`to` no puede ser anterior a `from`." });
      }
      const dias = (Date.parse(query.to) - Date.parse(query.from)) / 86_400_000 + 1;
      if (dias > MAX_DAYS_RANGE) {
        return reply.status(400).send({ message: `El rango no puede superar ${MAX_DAYS_RANGE} días.` });
      }

      const contexts = await loadDaysContext(prisma, consultantId, query.from as IsoDate, query.to as IsoDate);
      const hhmm = (t: string) => t.slice(0, 5);
      const days = [...contexts.values()].map((ctx) => {
        const summary = summaryOfContext(ctx);
        return {
          date: ctx.date,
          isWeekend: ctx.isWeekend,
          isHoliday: ctx.isHoliday,
          holidayName: ctx.holidayName,
          allowWeekendWork: ctx.allowWeekendWork,
          jornadaOrigen: ctx.jornadaOrigen,
          ...summary,
          // Solicitudes de horas extra aprobadas del día por proyecto (sin montos), por hora de inicio.
          projects: summary.projects.map((p) => ({
            ...p,
            approvedRequests: ctx.approvedRequests
              .filter((r) => r.projectId === p.projectId)
              .map((r) => ({ id: r.id, startTime: hhmm(r.startTime), endTime: hhmm(r.endTime), totalHours: r.totalHours }))
              .sort((a, b) => (a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0)),
          })),
        };
      });

      return { data: { consultantId, days } };
    },
  );

  /**
   * Guarda el día de un consultor en un proyecto (R14 §3) en UNA transacción.
   *
   * Reemplaza solo los registros PENDING de ese consultor/proyecto/día: crea los nuevos, actualiza
   * los que traen `id` y borra los PENDING que no vienen. Los APPROVED/REJECTED no se tocan (solo
   * cuentan para el tope). Valida el estado final del día completo (todos los proyectos) con
   * `validateDay`; si algo falla responde 400 `{ message, error, code, index, errors }` con el
   * índice de la fila culpable y no guarda nada. Los EXTRA se parten en el límite del saldo aprobado
   * (la parte de más queda `isExcess` y la revisa el PM).
   */
  app.put(
    "/day",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT])],
    },
    async (request, reply) => {
      const payload = dayPutSchema.parse(request.body);

      const target = await resolveTargetConsultantId(request, payload.consultantId);
      if ("error" in target) {
        return reply.status(403).send({ message: target.error });
      }
      if (!(await canMutateEntry(request, { consultantId: target.consultantId, projectId: payload.projectId }))) {
        return reply.status(403).send({ message: "Solo puedes editar tus propias horas" });
      }

      const workDate = toUtcDay(payload.workDate);

      const project = await prisma.project.findUnique({
        where: { id: payload.projectId },
        select: { id: true, isAbsenceProject: true },
      });
      if (!project) {
        return reply.status(400).send({ message: "El proyecto indicado no existe" });
      }

      const closed = await isMonthClosed(payload.projectId, workDate);
      if (closed) {
        return reply.status(400).send({
          message: `No se pueden modificar horas de un mes cerrado para este proyecto (${closed.year}-${String(closed.month).padStart(2, "0")}).`,
        });
      }

      const rows: ProposedRow[] = [];
      for (let i = 0; i < payload.entries.length; i++) {
        const e = payload.entries[i];
        if (franjaInvalida(e.startedAt, e.endedAt)) {
          return sendDayError(reply, {
            status: 400,
            code: "INVALID_SPAN",
            message: FRANJA_INVALIDA,
            index: i,
            errors: [{ index: i, code: "INVALID_SPAN", message: FRANJA_INVALIDA }],
          });
        }
        let activityId: string | null | undefined;
        if (e.activityId !== undefined) {
          const resolved = await resolveActivityId(e.activityId, target.consultantId);
          if (!resolved.ok) {
            return sendDayError(reply, {
              status: 400,
              code: "ACTIVITY_INVALID",
              message: resolved.error,
              index: i,
              errors: [{ index: i, code: "ACTIVITY_INVALID", message: resolved.error }],
            });
          }
          activityId = resolved.activityId;
        }
        rows.push({
          id: e.id,
          typeId: e.typeId,
          hours: e.hours,
          startedAt: e.startedAt ?? null,
          endedAt: e.endedAt ?? null,
          description: e.description ?? null,
          note: e.note,
          activityId,
          source: TimeEntrySource.TIMESHEET,
        });
      }

      const types = await loadTypes(prisma);

      // Separación de funciones: si el día se guarda a nombre de otro consultor, el payload no puede
      // crear, modificar ni borrar filas EXTRA. Las filas EXTRA existentes que llegan sin cambios
      // (mismo tipo, horas y franja) no cuentan, para que un PM pueda editar lo REGULAR del día.
      if (!esConsultorPropio(request, target.consultantId)) {
        const existentesExtra = await prisma.timeEntry.findMany({
          where: {
            consultantId: target.consultantId,
            projectId: payload.projectId,
            workDate,
            status: TimeEntryStatus.PENDING,
            type: { category: TimeEntryCategory.EXTRA },
          },
        });
        const porId = new Map(existentesExtra.map((e) => [e.id, e]));
        const mismaFecha = (a: Date | null | undefined, b: Date | null | undefined) =>
          (a?.getTime() ?? null) === (b?.getTime() ?? null);
        const sinCambios = (row: ProposedRow) => {
          const previo = row.id ? porId.get(row.id) : undefined;
          return (
            !!previo &&
            previo.typeId === row.typeId &&
            Math.abs(Number(previo.hours) - row.hours) < 1e-4 &&
            mismaFecha(previo.startedAt, row.startedAt) &&
            mismaFecha(previo.endedAt, row.endedAt) &&
            (row.description === undefined || (previo.description ?? null) === (row.description ?? null)) &&
            (row.note === undefined || (previo.note ?? null) === (row.note ?? null))
          );
        };
        const idsEnviados = new Set(rows.map((r) => r.id).filter(Boolean));
        const tocaExtra =
          rows.some((r) => types.get(r.typeId)?.category === TimeEntryCategory.EXTRA && !sinCambios(r)) ||
          existentesExtra.some((e) => !idsEnviados.has(e.id)) ||
          rows.some((r) => r.id && porId.has(r.id) && types.get(r.typeId)?.category !== TimeEntryCategory.EXTRA);
        if (tocaExtra) return reply.status(403).send({ message: MENSAJE_EXTRA_SOLO_PROPIO });
      }

      // Reemplazar el día borra los PENDING que no vienen en el payload: si son de otro consultor,
      // eso es borrar horas ajenas y solo lo hace ADMIN (mismo criterio que DELETE /:id).
      if (!(await canDeleteEntry(request, target.consultantId))) {
        const idsEnviados = new Set(rows.map((r) => r.id).filter(Boolean));
        const pendientes = await prisma.timeEntry.findMany({
          where: {
            consultantId: target.consultantId,
            projectId: payload.projectId,
            workDate,
            status: TimeEntryStatus.PENDING,
          },
          select: { id: true },
        });
        if (pendientes.some((e) => !idsEnviados.has(e.id))) {
          return reply.status(403).send({ message: MENSAJE_BORRAR_AJENO });
        }
      }

      const result = await prisma.$transaction(async (tx) => {
        // R15: una semana enviada queda bloqueada (salvo el proyecto devuelto).
        const lock = await lockAndCheckWeeks(tx, target.consultantId, [{ projectId: payload.projectId, workDate }]);
        if (lock) return weekLockedDayResult(lock);
        const cerrado = await lockAndCheckMonths(tx, [{ projectId: payload.projectId, workDate }]);
        if (cerrado) return monthClosedDayResult(cerrado);
        return saveDayGroup(tx, {
          consultantId: target.consultantId,
          projectId: payload.projectId,
          workDate,
          isAbsenceProject: project.isAbsenceProject,
          rows,
          deleteMissing: true,
          types,
        });
      });
      if (!result.ok) return sendDayError(reply, result.error);

      await flushAudits(request, result.audits);
      return { data: { entries: result.entries, summary: result.summary } };
    },
  );

  app.post(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT])],
    },
    async (request, reply) => {
      const payload = timeEntryPayloadSchema.parse(request.body);

      // Un CONSULTANT solo puede registrar horas a su propio nombre; ADMIN y PM
      // sí pueden hacerlo a nombre de otros, que es un flujo legítimo de la PMO.
      const target = await resolveTargetConsultantId(request, payload.consultantId);
      if ("error" in target) {
        return reply.status(403).send({ message: target.error });
      }

      if (!(await canMutateEntry(request, { consultantId: target.consultantId, projectId: payload.projectId }))) {
        return reply.status(403).send({ message: "Solo puedes registrar horas a tu propio nombre o en proyectos que gestionas" });
      }

      const workDate = toUtcDay(payload.workDate);

      if (franjaInvalida(payload.startedAt, payload.endedAt)) {
        return reply.status(400).send({ message: FRANJA_INVALIDA });
      }

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

      const types = await loadTypes(prisma);
      const typeId = payload.typeId ?? regularTypeId(types);
      if (!typeId) {
        return reply.status(500).send({ message: "El catálogo de tipos de hora no tiene el tipo Horas Regulares." });
      }

      if (types.get(typeId)?.category === TimeEntryCategory.EXTRA && !esConsultorPropio(request, target.consultantId)) {
        return reply.status(403).send({ message: MENSAJE_EXTRA_SOLO_PROPIO });
      }

      // Misma validación del día completo que `PUT /day` (tope, fines de semana, horas extra).
      const result = await prisma.$transaction(async (tx) => {
        const lock = await lockAndCheckWeeks(tx, target.consultantId, [{ projectId: payload.projectId, workDate }]);
        if (lock) return weekLockedDayResult(lock);
        const cerrado = await lockAndCheckMonths(tx, [{ projectId: payload.projectId, workDate }]);
        if (cerrado) return monthClosedDayResult(cerrado);
        return saveDayGroup(tx, {
          consultantId: target.consultantId,
          projectId: payload.projectId,
          workDate,
          isAbsenceProject: project.isAbsenceProject,
          rows: [
            {
              typeId,
              hours: payload.hours,
              startedAt: payload.startedAt ?? null,
              endedAt: payload.endedAt ?? null,
              description: payload.description || null,
              note: payload.note,
              activityId: activity.activityId,
              source: (payload.source as TimeEntrySource) ?? TimeEntrySource.MANUAL,
            },
          ],
          deleteMissing: false,
          types,
        });
      });
      if (!result.ok) return sendDayError(reply, result.error);

      await flushAudits(request, result.audits);

      const entry = result.entries.find((e) => e.id === result.resultIds[0][0])!;
      // `data` es el registro creado (la primera parte si se partió por excedente); `meta` trae
      // todos los del proyecto/día y el resumen del día.
      return reply.status(201).send({ data: entry, meta: { entries: result.entries, summary: result.summary } });
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

      // R15: semana enviada o aprobada = bloqueo total (se re-comprueba dentro de la transacción).
      const bloqueo = await checkWeekEditable(prisma, existing.consultantId, existing.projectId, existing.workDate);
      if (bloqueo) return reply.status(409).send(weekLockedBody(bloqueo));

      if (existing.status !== TimeEntryStatus.PENDING) {
        return reply.status(409).send({
          message: "Solo se pueden editar las horas que siguen pendientes de aprobación",
        });
      }

      const workDate = payload.workDate ? toUtcDay(payload.workDate) : existing.workDate;
      const projectId = payload.projectId ?? existing.projectId;

      if (
        projectId !== existing.projectId &&
        !(await canMutateEntry(request, { consultantId: existing.consultantId, projectId }))
      ) {
        return reply.status(403).send({ message: "No puedes mover horas a un proyecto que no es tuyo ni gestionas" });
      }

      // La franja resultante combina lo que llega con lo que ya había.
      const startedAt = payload.startedAt === undefined ? existing.startedAt : payload.startedAt;
      const endedAt = payload.endedAt === undefined ? existing.endedAt : payload.endedAt;
      if (franjaInvalida(startedAt, endedAt)) {
        return reply.status(400).send({ message: FRANJA_INVALIDA });
      }

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

      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, isAbsenceProject: true },
      });
      if (!project) {
        return reply.status(400).send({ message: "El proyecto indicado no existe" });
      }

      const types = await loadTypes(prisma);
      const nuevoTipo = payload.typeId ?? existing.typeId;
      if (
        !esConsultorPropio(request, existing.consultantId) &&
        (types.get(existing.typeId)?.category === TimeEntryCategory.EXTRA ||
          types.get(nuevoTipo)?.category === TimeEntryCategory.EXTRA)
      ) {
        return reply.status(403).send({ message: MENSAJE_EXTRA_SOLO_PROPIO });
      }
      const moved =
        projectId !== existing.projectId || workDate.getTime() !== existing.workDate.getTime();
      if (moved && types.get(existing.typeId)?.category === TimeEntryCategory.EXTRA) {
        return reply.status(400).send({
          message: "Un registro de horas extra no se puede mover de proyecto o de día; elimínalo y créalo de nuevo.",
          code: "EXTRA_CANNOT_MOVE",
        });
      }

      // Misma validación del día completo que `PUT /day`, con la fila ya combinada.
      const result = await prisma.$transaction(async (tx) => {
        const lock = await lockAndCheckWeeks(tx, existing.consultantId, [
          { projectId: existing.projectId, workDate: existing.workDate },
          { projectId, workDate },
        ]);
        if (lock) return weekLockedDayResult(lock);
        const cerrado = await lockAndCheckMonths(tx, [
          { projectId: existing.projectId, workDate: existing.workDate },
          { projectId, workDate },
        ]);
        if (cerrado) return monthClosedDayResult(cerrado);
        return saveDayGroup(tx, {
          consultantId: existing.consultantId,
          projectId,
          workDate,
          isAbsenceProject: project.isAbsenceProject,
          rows: [
            {
              id,
              typeId: payload.typeId ?? existing.typeId,
              hours: payload.hours ?? Number(existing.hours),
              startedAt,
              endedAt,
              description: payload.description,
              note: payload.note,
              activityId,
              source: existing.source,
            },
          ],
          deleteMissing: false,
          types,
          movedIds: moved ? [id] : [],
        });
      });
      if (!result.ok) return sendDayError(reply, result.error);

      await flushAudits(request, result.audits);

      const entry = result.entries.find((e) => e.id === result.resultIds[0][0])!;
      return { data: entry, meta: { entries: result.entries, summary: result.summary } };
    },
  );

  /**
   * R15: la aprobación ya no es registro por registro. Se aprueba o devuelve la SEMANA de un
   * proyecto desde `POST /api/timesheet-reviews/approve|return`. Estas rutas se retiran para todos
   * los roles (410 Gone): dejarlas, aun solo para ADMIN, permitiría saltarse el envío y dejar la
   * revisión semanal incoherente. Para corregir algo aprobado, ADMIN borra el registro.
   * Siguen detrás de `authenticate` y `authorize`.
   */
  const RETIRADA = {
    message:
      "Las horas ya no se aprueban ni se rechazan una por una: el PM aprueba o devuelve la semana completa del proyecto desde Aprobación de horas.",
    code: "ENDPOINT_RETIRED",
  };
  for (const accion of ["approve", "reject"] as const) {
    app.patch(
      `/:id/${accion}`,
      {
        preHandler: [
          authenticate,
          authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT, AppRole.FINANCE, AppRole.VIEWER]),
        ],
      },
      async (request, reply) => {
        idParamsSchema.parse(request.params);
        return reply.status(410).send(RETIRADA);
      },
    );
  }

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

      if (!(await canDeleteEntry(request, existing.consultantId))) {
        return reply.status(403).send({ message: MENSAJE_BORRAR_AJENO });
      }

      const roles = request.authUser?.roles ?? [];
      // R15: bloqueo de semana para todos los roles. Única excepción: ADMIN borra registros que ya
      // no están PENDING (corrección de lo aprobado), como antes de R15.
      // La excepción es SOLO para registros APROBADOS: uno SUBMITTED está en revisión y no se borra.
      const adminCorrige = roles.includes(AppRole.ADMIN) && existing.status === TimeEntryStatus.APPROVED;
      if (!adminCorrige) {
        const bloqueo = await checkWeekEditable(prisma, existing.consultantId, existing.projectId, existing.workDate);
        if (bloqueo) return reply.status(409).send(weekLockedBody(bloqueo));
        if (existing.status === TimeEntryStatus.SUBMITTED) {
          return reply.status(409).send({
            message: "Estas horas están enviadas a revisión y no se pueden eliminar.",
            code: "WEEK_LOCKED",
            weekStart: weekStartOf(toIsoDate(existing.workDate)),
          });
        }
      }
      // Borrar cualquier registro que no esté PENDING (corrección de lo aprobado) exige ADMIN.
      if (!roles.includes(AppRole.ADMIN) && existing.status !== TimeEntryStatus.PENDING) {
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
        // Si era una ausencia aprobada, su bloqueo de capacidad se borra en cascada; después se
        // reevalúa si las ausencias que quedan siguen cubriendo la jornada.
        const tipo = await prisma.timeEntryType.findUnique({ where: { id: existing.typeId }, select: { category: true } });
        const proyecto = await prisma.project.findUnique({
          where: { id: existing.projectId },
          select: { isAbsenceProject: true },
        });
        const borrado = await prisma.$transaction(async (tx) => {
          // ADMIN corrigiendo lo aprobado toma el candado de la semana (sin comprobar el bloqueo).
          if (adminCorrige) await lockWeek(tx, existing.consultantId, weekStartOf(toIsoDate(existing.workDate)));
          const lock = adminCorrige
            ? null
            : await lockAndCheckWeeks(tx, existing.consultantId, [
                { projectId: existing.projectId, workDate: existing.workDate },
              ]);
          if (lock) return { lock } as const;
          const cerrado = await lockAndCheckMonths(tx, [
            { projectId: existing.projectId, workDate: existing.workDate },
          ]);
          if (cerrado) return { cerrado } as const;
          await lockDay(tx, existing.consultantId, existing.workDate);
          await tx.timeEntry.delete({ where: { id } });
          const eventos =
            tipo?.category === TimeEntryCategory.ABSENCE
              ? await syncAbsenceBlock(tx, existing.consultantId, existing.workDate)
              : [];
          // El saldo que libera un EXTRA borrado puede cubrir un excedente pendiente.
          const repartido =
            tipo?.category === TimeEntryCategory.EXTRA
              ? await saveDayGroup(tx, {
                  consultantId: existing.consultantId,
                  projectId: existing.projectId,
                  workDate: existing.workDate,
                  isAbsenceProject: proyecto?.isAbsenceProject ?? false,
                  rows: [],
                  deleteMissing: false,
                  types: await loadTypes(tx),
                })
              : null;
          return { bloques: eventos, reparto: repartido && repartido.ok ? repartido.audits : [] };
        });
        if ("lock" in borrado && borrado.lock) return reply.status(409).send(weekLockedBody(borrado.lock));
        if ("cerrado" in borrado && borrado.cerrado) {
          return reply.status(400).send({ message: "No se pueden eliminar horas de un mes cerrado para este proyecto." });
        }
        const { bloques, reparto } = borrado as unknown as { bloques: AuditEvent[]; reparto: AuditEvent[] };
        await flushAudits(request, bloques, AUDIT_ENTITIES.consultantBlock);
        await flushAudits(request, reparto);

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
