import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppRole, ExtraHourStatus, Prisma, TimeEntryCategory, TimeEntryStatus } from "@prisma/client";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { consultantSinDatosSensiblesSelect, puedeVerTarifas } from "../../utils/consultant-scope.js";
import { normalizeCountry, resolveCountryTimezone, SUPPORTED_COUNTRIES } from "../../utils/country.js";
import { getHolidaysForYear } from "../../utils/holidays.js";
import { calculateExtraHours } from "../../utils/calculateExtraHours.js";
import { roundHours, toLocalExtraShift } from "../../utils/timesheetRules.js";
import { PROYECTO_MINIMO_SELECT, puedeVerMontosHoraExtra, sinMontosHoraExtra, veProyectoCompleto } from "../../utils/extraHoursVisibility.js";
import { resolveTargetConsultantId } from "../../utils/currentConsultant.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";
import { avisoInmediatoActivo } from "../admin/approval-digest.routes.js";
import { notifyNewExtraHourRequest, notifyExtraHourApprovedForPayroll, notifyExtraHourFullyApproved, notifyExtraHourRejected } from "../../utils/notifications.js";

const extraHourPayloadSchema = z.object({
  projectId: z.string().min(1),
  /** Opcional: solo puede ser el propio consultor (separación de funciones). */
  consultantId: z.string().min(1).optional(),
  date: z.coerce.date(),
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  observations: z.string().trim().optional(),
});

const calculatePayloadSchema = z.object({
  consultantId: z.string().min(1),
  /** Opcional: permite al PM de ese proyecto ver los montos de la previsualización. */
  projectId: z.string().min(1).optional(),
  date: z.coerce.date(),
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
});

const configPayloadSchema = z.object({
  weeklyExtraHoursLimit: z.coerce.number().positive(),
  diurnalMultiplier: z.coerce.number().positive(),
  nocturnalMultiplier: z.coerce.number().positive(),
  diurnalHolidayMultiplier: z.coerce.number().positive(),
  nocturnalHolidayMultiplier: z.coerce.number().positive(),
  diurnalStart: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  diurnalEnd: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  monthlyDivisor: z.coerce.number().positive().default(220),
});

/**
 * El cuerpo del rechazo solo aporta el motivo: la identidad de quien aprueba o
 * rechaza sale de `request.authUser`, nunca del cliente. La aprobación no recibe
 * cuerpo alguno.
 */
const rejectPayloadSchema = z.object({
  rejectionNote: z.string().trim().min(3),
});

const idParamsSchema = z.object({ id: z.string().min(1) });

/**
 * Fecha de la migración R14 (timesheet con tipos de hora). Las solicitudes aprobadas creadas antes
 * y sin ningún TimeEntry vinculado se siguen pagando por su monto en la nómina (`legacy`).
 */
const PAYROLL_REAL_HOURS_SINCE = new Date("2026-11-04T00:00:00.000Z");

const payrollQuerySchema = z.object({
  year: z.coerce.number().min(2020).max(2100),
  month: z.coerce.number().min(1).max(12),
});

const defaultConfigs = [
  {
    country: "Default",
    weeklyExtraHoursLimit: 12,
    diurnalMultiplier: 1.50,
    nocturnalMultiplier: 1.50,
    diurnalHolidayMultiplier: 1.50,
    nocturnalHolidayMultiplier: 1.50,
    diurnalStart: "06:00:00",
    diurnalEnd: "21:00:00",
    monthlyDivisor: 220,
  },
  {
    country: "Colombia",
    weeklyExtraHoursLimit: 12,
    diurnalMultiplier: 1.25,
    nocturnalMultiplier: 1.75,
    diurnalHolidayMultiplier: 2.00,
    nocturnalHolidayMultiplier: 2.50,
    diurnalStart: "06:00:00",
    diurnalEnd: "19:00:00",
    monthlyDivisor: 220,
  },
  {
    country: "Peru",
    weeklyExtraHoursLimit: 12,
    diurnalMultiplier: 1.25,
    nocturnalMultiplier: 1.60,
    diurnalHolidayMultiplier: 2.00,
    nocturnalHolidayMultiplier: 2.00,
    diurnalStart: "06:00:00",
    diurnalEnd: "22:00:00",
    monthlyDivisor: 240,
  },
  {
    country: "Chile",
    weeklyExtraHoursLimit: 12,
    diurnalMultiplier: 1.50,
    nocturnalMultiplier: 1.50,
    diurnalHolidayMultiplier: 1.50,
    nocturnalHolidayMultiplier: 1.50,
    diurnalStart: "06:00:00",
    diurnalEnd: "21:00:00",
    monthlyDivisor: 180,
  },
  {
    country: "Mexico",
    weeklyExtraHoursLimit: 9,
    diurnalMultiplier: 2.00,
    nocturnalMultiplier: 2.00,
    diurnalHolidayMultiplier: 3.00,
    nocturnalHolidayMultiplier: 3.00,
    diurnalStart: "06:00:00",
    diurnalEnd: "20:00:00",
    monthlyDivisor: 240,
  },
  {
    country: "Ecuador",
    weeklyExtraHoursLimit: 12,
    diurnalMultiplier: 1.50,
    nocturnalMultiplier: 1.50,
    diurnalHolidayMultiplier: 2.00,
    nocturnalHolidayMultiplier: 2.00,
    diurnalStart: "06:00:00",
    diurnalEnd: "23:59:00",
    monthlyDivisor: 240,
  },
  {
    country: "Argentina",
    weeklyExtraHoursLimit: 12,
    diurnalMultiplier: 1.50,
    nocturnalMultiplier: 1.50,
    diurnalHolidayMultiplier: 2.00,
    nocturnalHolidayMultiplier: 2.00,
    diurnalStart: "06:00:00",
    diurnalEnd: "21:00:00",
    monthlyDivisor: 200,
  },
  {
    country: "España",
    weeklyExtraHoursLimit: 12,
    diurnalMultiplier: 1.75,
    nocturnalMultiplier: 2.00,
    diurnalHolidayMultiplier: 2.00,
    nocturnalHolidayMultiplier: 2.50,
    diurnalStart: "06:00:00",
    diurnalEnd: "22:00:00",
    monthlyDivisor: 160,
  },
];

/**
 * Siembra de configuraciones por defecto y normalización de países heredados.
 *
 * Se ejecuta **una sola vez por proceso** (ver `ensureDefaultConfigs`): antes se
 * invocaba en cada petición del módulo, de modo que cada request escribía en la base.
 */
async function seedDefaultConfigs() {
  // Migrate legacy USA country values to Default for users and consultants
  await prisma.user.updateMany({
    where: {
      country: {
        in: ["USA", "usa", "Estados Unidos", "United States", "US", "us", "Estados Unidos de América"]
      }
    },
    data: {
      country: "Default"
    }
  });

  await prisma.consultant.updateMany({
    where: {
      country: {
        in: ["USA", "usa", "Estados Unidos", "United States", "US", "us", "Estados Unidos de América"]
      }
    },
    data: {
      country: "Default"
    }
  });

  await prisma.customHoliday.updateMany({
    where: {
      country: {
        in: ["USA", "usa", "Estados Unidos", "United States", "US", "us", "Estados Unidos de América"]
      }
    },
    data: {
      country: "Default"
    }
  });

  // Fix any configurations with 24:00:00 diurnalEnd
  await prisma.extraHoursConfig.updateMany({
    where: { diurnalEnd: "24:00:00" },
    data: { diurnalEnd: "23:59:00" }
  });

  const configs = await prisma.extraHoursConfig.findMany();
  const requiredCountries = ["Default", "Colombia", "Peru", "Chile", "Mexico", "Ecuador", "Argentina", "España"];
  const existingCountries = configs.map((c) => c.country);
  const missingCountries = requiredCountries.filter((c) => !existingCountries.includes(c));

  if (missingCountries.length > 0) {
    for (const defaultC of defaultConfigs) {
      if (missingCountries.includes(defaultC.country)) {
        await prisma.extraHoursConfig.create({
          data: defaultC,
        });
      }
    }
  }

  // NOTA: la corrección puntual de `monthlyDivisor = 220` que antes corría aquí en cada
  // petición se movió a la migración de datos
  // `prisma/migrations/20260918130000_fix_extra_hours_monthly_divisor` y al seed
  // (`prisma/seed.mjs`), que es donde corresponde a una corrección de una sola vez.
}

/**
 * Memoriza la siembra para que ocurra una única vez por proceso.
 * Si falla, se libera la memoria para poder reintentar en la siguiente invocación.
 */
let defaultConfigsPromise: Promise<void> | null = null;

async function ensureDefaultConfigs(): Promise<void> {
  if (!defaultConfigsPromise) {
    defaultConfigsPromise = seedDefaultConfigs().catch((error) => {
      defaultConfigsPromise = null;
      throw error;
    });
  }
  return defaultConfigsPromise;
}

export { ensureDefaultConfigs };

/**
 * Puerta de rol de aprobar y rechazar: todos los roles, porque cualquiera puede
 * figurar como PM de un proyecto. La regla real es `canReviewExtraHour`.
 */
const ROLES_QUE_PUEDEN_SER_PM = [
  AppRole.ADMIN,
  AppRole.PM,
  AppRole.CONSULTANT,
  AppRole.FINANCE,
  AppRole.VIEWER,
];

/** Lo mínimo que hace falta de la solicitud para decidir quién puede actuar. */
type ExtraHourForAuth = {
  status: ExtraHourStatus;
  project: { id: string; projectManagerEmail: string | null } | null;
};

/** Lo mínimo que hace falta del usuario autenticado. */
type AuthUserForAuth = {
  email: string;
  roles: AppRole[];
};

/**
 * Decide si el usuario autenticado puede aprobar o rechazar una solicitud de
 * horas extra.
 *
 * Existe porque `approve` y `reject` repetían esta comprobación palabra por
 * palabra (DEP-17). Devuelve solo el veredicto: cada handler conserva su propio
 * mensaje de error, que es lo único en lo que diferían.
 *
 * **Aprobación única del PM.** Antes esto resolvía dos niveles (PM → Finanzas).
 * El dueño del producto eliminó el segundo: el PM conoce el estado de salud de
 * su proyecto, así que si aprueba las horas es porque se pueden pagar. Finanzas
 * desembolsa —lo aprobado aparece directamente en `GET /payroll`—, no decide, y
 * por eso ya no puede ni aprobar ni rechazar.
 *
 * **Solo el PM del proyecto** (decisión del dueño del producto, 2026-10-09):
 * quien figura en `Project.projectManagerEmail`. Ni el Administrador ni un
 * delegado pueden aprobar o rechazar. Ser PM se decide por ese campo y no por
 * el rol de la cuenta (igual que en D-13): un PM cuya cuenta solo tenga rol
 * CONSULTANT sigue siendo el PM de su proyecto. El estado no entra en la
 * decisión: los handlers ya descartan antes lo que no es `PENDING_PM`.
 */
export async function canReviewExtraHour(
  entry: ExtraHourForAuth,
  user: AuthUserForAuth,
): Promise<{ authorized: boolean }> {
  const email = user.email.toLowerCase();
  const pmEmail = entry.project?.projectManagerEmail?.trim().toLowerCase();
  return { authorized: !!pmEmail && pmEmail === email };
}

/**
 * Filtros y paginación del listado. Se acumulan SOBRE el alcance del rol; nunca
 * lo sustituyen, así que un filtro no puede ampliar lo que alguien ve.
 * Contrato de paginación idéntico al de `/api/audit`.
 */
const listQuerySchema = z.object({
  status: z.nativeEnum(ExtraHourStatus).optional(),
  consultantId: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
});

/** Registra el cambio de la configuración de recargos de un país (CREATE si no existía). */
async function auditarConfigHorasExtra(
  request: FastifyRequest,
  antes: { id: string } | null,
  despues: { id: string },
) {
  await writeAudit(prisma, {
    entity: AUDIT_ENTITIES.extraHoursConfig,
    entityId: despues.id,
    action: antes ? "UPDATE" : "CREATE",
    changedBy: request.authUser!.email,
    before: antes as unknown as Record<string, unknown> | null,
    after: despues as unknown as Record<string, unknown>,
    request,
  });
}

export async function extraHoursRoutes(app: FastifyInstance) {
  // 0. Obtener países soportados dinámicamente
  app.get(
    "/countries",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT, AppRole.FINANCE, AppRole.VIEWER])],
    },
    async () => {
      return { data: SUPPORTED_COUNTRIES };
    }
  );

  // 1. Obtener listado de horas extras (con filtros por rol)
  app.get(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT, AppRole.FINANCE, AppRole.VIEWER])],
    },
    async (request) => {
      const user = request.authUser!;
      const roles = user.roles;
      const email = user.email.toLowerCase();
      const query = listQuerySchema.parse(request.query);

      // Alcance por fila (sin cambios respecto a antes de R7):
      //   ADMIN / FINANCE / VIEWER -> todas.
      //   PM                       -> las suyas como consultor + las de sus proyectos.
      //   CONSULTANT               -> solo las suyas.
      let alcance: Prisma.ExtraHourEntryWhereInput = {};
      let soloPropias = false;

      if (roles.includes(AppRole.ADMIN) || roles.includes(AppRole.FINANCE) || roles.includes(AppRole.VIEWER)) {
        alcance = {};
      } else if (roles.includes(AppRole.PM)) {
        alcance = {
          OR: [
            { consultantId: user.consultantId ?? "__none__" },
            { project: { projectManagerEmail: email } },
          ],
        };
      } else {
        // Las suyas y, si figura como PM de algún proyecto, las de ese proyecto:
        // es quien las aprueba aunque su cuenta no tenga rol PM. Las tarifas de
        // los demás no viajan (`soloPropias` solo es cierto si no dirige nada).
        alcance = {
          OR: [
            { consultantId: user.consultantId ?? "__none__" },
            { project: { projectManagerEmail: { equals: email, mode: "insensitive" } } },
          ],
        };
        const diriges = await prisma.project.count({
          where: { projectManagerEmail: { equals: email, mode: "insensitive" } },
        });
        soloPropias = diriges === 0;
      }

      const filtros: Prisma.ExtraHourEntryWhereInput[] = [];
      if (query.status) filtros.push({ status: query.status });
      if (query.consultantId) filtros.push({ consultantId: query.consultantId });

      const where: Prisma.ExtraHourEntryWhereInput =
        filtros.length > 0 ? { AND: [alcance, ...filtros] } : alcance;

      // Alcance por campo (DEP-38): el consultor viaja completo solo para quien
      // puede ver tarifas (ADMIN, PM, FINANCE) o para quien solo recibe sus
      // propias filas (el CONSULTANT, que ve su propia tarifa y su propio
      // documento, igual que en `time-entries` desde R5). El caso que se cierra
      // aquí es el VIEWER: recibía la `hourlyRate` y el `costPerMonth` de toda
      // la plantilla, la misma fuga que R5 cerró en `time-entries`.
      // El desempate por `id` hace estable la paginación: varias solicitudes
      // comparten la misma `date` y sin él una fila podría repetirse o
      // desaparecer al pasar de página.
      const orderBy = [{ date: "desc" as const }, { id: "desc" as const }];
      const skip = (query.page - 1) * query.pageSize;

      // ADMIN y FINANCE reciben el proyecto completo; el resto, solo la proyección mínima
      // (sin presupuesto ni tarifas).
      const proyectoInclude = veProyectoCompleto(roles) ? ({ include: { company: true } } as const) : { select: PROYECTO_MINIMO_SELECT };

      const [entries, total] = await Promise.all([
        puedeVerTarifas(roles) || soloPropias
          ? prisma.extraHourEntry.findMany({
              where,
              include: { project: proyectoInclude, consultant: true },
              orderBy,
              skip,
              take: query.pageSize,
            })
          : prisma.extraHourEntry.findMany({
              where,
              include: {
                project: proyectoInclude,
                consultant: { select: consultantSinDatosSensiblesSelect },
              },
              orderBy,
              skip,
              take: query.pageSize,
            }),
        // El total se cuenta sobre el mismo `where`, que ya lleva el alcance
        // del rol: un consultor no debe enterarse por el contador de cuántas
        // solicitudes hay de sus compañeros.
        prisma.extraHourEntry.count({ where }),
      ]);

      // VIEWER es un rol de consulta sin responsabilidad económica (igual que
      // en `puedeVerTarifas`): ve que la solicitud existe, sus horas y su
      // estado, pero no cuánto se le va a pagar a nadie. Antes recibía los
      // montos de TODA la plantilla con su `totalAmount` completo.
      // Ampliado: los montos (y lo real/excedente) los ven solo ADMIN, FINANCE y el
      // PM del proyecto de cada fila; el resto, incluido el consultor dueño de la
      // solicitud, recibe solo horas. Se decide fila por fila, abajo.

      // Aprobado vs. real (R14): lo registrado en el timesheet contra cada solicitud.
      //   realHours          EXTRA vinculados, no rechazados y que no son excedente.
      //   excessHours        EXTRA excedentes vinculados no rechazados (pendientes o aprobados).
      //   excessPendingHours los excedentes que aún espera decidir el PM.
      const vinculados = entries.length
        ? await prisma.timeEntry.findMany({
            where: {
              extraHourEntryId: { in: entries.map((e) => e.id) },
              status: { not: TimeEntryStatus.REJECTED },
              type: { category: TimeEntryCategory.EXTRA },
            },
            select: { extraHourEntryId: true, hours: true, isExcess: true, status: true },
          })
        : [];
      const porSolicitud = new Map<string, { real: number; excess: number; excessPending: number }>();
      for (const t of vinculados) {
        const acc = porSolicitud.get(t.extraHourEntryId!) ?? { real: 0, excess: 0, excessPending: 0 };
        const h = Number(t.hours);
        if (t.isExcess) {
          acc.excess += h;
          // R15: el excedente espera la decisión del PM mientras no esté aprobado (sin enviar o enviado).
          if (t.status === TimeEntryStatus.PENDING || t.status === TimeEntryStatus.SUBMITTED) acc.excessPending += h;
        } else {
          acc.real += h;
        }
        porSolicitud.set(t.extraHourEntryId!, acc);
      }
      const data = entries.map((e) => {
        if (!puedeVerMontosHoraExtra(user, e.project?.projectManagerEmail)) {
          return sinMontosHoraExtra(e);
        }
        const acc = porSolicitud.get(e.id);
        return {
          ...e,
          realHours: roundHours(acc?.real ?? 0),
          excessHours: roundHours(acc?.excess ?? 0),
          excessPendingHours: roundHours(acc?.excessPending ?? 0),
        };
      });

      return {
        data,
        meta: {
          total,
          page: query.page,
          pageSize: query.pageSize,
          totalPages: Math.ceil(total / query.pageSize),
        },
      };
    },
  );

  // 1b. RETIRADA por R15. Los excedentes de horas extra se aprueban dentro de la revisión semanal
  //     del proyecto (`GET /api/timesheet-reviews`, filas con la novedad EXCESS). Se conserva la ruta,
  //     siempre detrás de authenticate/authorize, devolviendo una lista vacía para no romper clientes
  //     antiguos que aún la consulten.
  app.get(
    "/excess-pending",
    {
      preHandler: [authenticate, authorize(ROLES_QUE_PUEDEN_SER_PM)],
    },
    async () => ({ data: [] }),
  );

  // 2. Registrar solicitud de horas extras
  app.post(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT])],
    },
    async (request, reply) => {
      await ensureDefaultConfigs();
      const payload = extraHourPayloadSchema.parse(request.body);

      const roles = request.authUser!.roles;

      // Separación de funciones: la solicitud la hace SOLO el consultor dueño, sin
      // excepción para ADMIN/PM. La identidad sale del token, no del cuerpo.
      const miConsultantId = request.authUser!.consultantId;
      if (payload.consultantId && payload.consultantId !== miConsultantId) {
        return reply.status(403).send({ message: "Las horas extra solo las puede solicitar el propio consultor." });
      }
      if (!miConsultantId) {
        return reply.status(400).send({
          message: "Tu usuario no tiene una ficha de consultor enlazada, así que no puedes solicitar horas extra. Pide a un administrador que te cree o enlace una.",
        });
      }
      const consultantId = miConsultantId;

      const entryYear = payload.date.getUTCFullYear();
      const entryMonth = payload.date.getUTCMonth() + 1;

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
          message: `No se pueden registrar horas extra en un mes que ya ha sido cerrado para este proyecto (${entryYear}-${String(entryMonth).padStart(2, "0")}).`,
        });
      }

      const [project, consultant] = await Promise.all([
        prisma.project.findUnique({ where: { id: payload.projectId } }),
        prisma.consultant.findUnique({ where: { id: consultantId } }),
      ]);

      if (!project) {
        return reply.status(400).send({ message: "Proyecto no válido" });
      }

      if (!project.allowExtraHours) {
        return reply.status(400).send({ message: "Las horas extra están deshabilitadas para este proyecto" });
      }

      if (!consultant) {
        return reply.status(400).send({ message: "Consultor no válido" });
      }

      const country = consultant.country || "Default";

      // Nadie solicita horas extra para días anteriores al actual.
      {
        // Misma tabla de zonas que usa la nómina real (utils/country.ts).
        const timezone = resolveCountryTimezone(consultant.country).timeZone;
        const todayStr = new Intl.DateTimeFormat("en-CA", {
          timeZone: timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date()); // Formato YYYY-MM-DD
        
        const entryStr = payload.date.toISOString().split("T")[0]; // YYYY-MM-DD
        
        if (entryStr < todayStr) {
          return reply.status(400).send({
            message: "No se pueden solicitar horas extra para días anteriores al actual."
          });
        }
      }
      let configRow = await prisma.extraHoursConfig.findUnique({
        where: { country },
      });

      if (!configRow) {
        configRow = await prisma.extraHoursConfig.findUnique({
          where: { country: "Default" },
        });
      }

      const activeConfig = configRow || {
        weeklyExtraHoursLimit: 12,
        diurnalMultiplier: 1.25,
        nocturnalMultiplier: 1.75,
        diurnalHolidayMultiplier: 2.00,
        nocturnalHolidayMultiplier: 2.50,
        diurnalStart: "06:00:00",
        diurnalEnd: "21:00:00",
        monthlyDivisor: 220,
      };

      // Formatear horas de inicio y fin para asegurar que tengan segundos
      const formattedStartTime = payload.startTime.split(":").length === 2 ? `${payload.startTime}:00` : payload.startTime;
      const formattedEndTime = payload.endTime.split(":").length === 2 ? `${payload.endTime}:00` : payload.endTime;

      // Calcular montos y horas en backend de forma segura
      const calcResult = await calculateExtraHours({
        date: payload.date,
        startTime: formattedStartTime,
        endTime: formattedEndTime,
        consultantId,
        config: {
          weeklyExtraHoursLimit: Number(activeConfig.weeklyExtraHoursLimit),
          diurnalMultiplier: Number(activeConfig.diurnalMultiplier),
          nocturnalMultiplier: Number(activeConfig.nocturnalMultiplier),
          diurnalHolidayMultiplier: Number(activeConfig.diurnalHolidayMultiplier),
          nocturnalHolidayMultiplier: Number(activeConfig.nocturnalHolidayMultiplier),
          diurnalStart: activeConfig.diurnalStart,
          diurnalEnd: activeConfig.diurnalEnd,
          monthlyDivisor: Number(activeConfig.monthlyDivisor || 220),
        },
      });

      const entry = await prisma.extraHourEntry.create({
        data: {
          consultantId,
          projectId: payload.projectId,
          date: payload.date,
          startTime: formattedStartTime,
          endTime: formattedEndTime,
          diurnal: calcResult.diurnal,
          nocturnal: calcResult.nocturnal,
          diurnalHoliday: calcResult.diurnalHoliday,
          nocturnalHoliday: calcResult.nocturnalHoliday,
          totalHours: calcResult.totalHours,
          diurnalAmount: calcResult.diurnalAmount,
          nocturnalAmount: calcResult.nocturnalAmount,
          diurnalHolidayAmount: calcResult.diurnalHolidayAmount,
          nocturnalHolidayAmount: calcResult.nocturnalHolidayAmount,
          totalAmount: calcResult.totalAmount,
          observations: payload.observations,
          status: ExtraHourStatus.PENDING_PM,
        },
        include: {
          project: veProyectoCompleto(roles) ? true : { select: PROYECTO_MINIMO_SELECT },
          consultant: true,
        },
      });

      // Aviso INMEDIATO al PM: apagado por defecto desde R-022.
      //
      // Antes salía un correo por cada solicitud, y esa era justamente la queja:
      // el PM recibía tantos avisos que dejaba de leerlos. Ahora lo que le llega
      // es el resumen semanal (`modules/approvals/weekly-digest.job.ts`), que
      // cubre horas regulares y horas extra en un solo mensaje.
      //
      // No se borra el aviso inmediato, se deja tras un interruptor
      // (`ApprovalDigestConfig.immediateExtraHour`, editable en
      // Administración → Resumen de Aprobaciones). Razón: si el negocio
      // descubre que para horas extra urgentes esperar al lunes no sirve,
      // recuperarlo tiene que ser un clic, no un despliegue. Borrarlo del todo
      // habría convertido una decisión reversible en una irreversible.
      if (await avisoInmediatoActivo()) {
        notifyNewExtraHourRequest({
          consultantName: entry.consultant.fullName,
          date: entry.date.toISOString().split("T")[0],
          hours: Number(entry.totalHours),
          pmEmail: entry.project?.projectManagerEmail || "",
          projectName: entry.project?.name || "Proyecto",
        }).catch((err) => {
          request.log.error({ err }, "Error al enviar notificación de nueva hora extra");
        });
      }

      // Nómina: dejar rastro de quién registró la solicitud y con qué montos.
      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.extraHourEntry,
        entityId: entry.id,
        action: "CREATE",
        changedBy: request.authUser!.email,
        after: entry as unknown as Record<string, unknown>,
        request,
      });

      // Los montos solo vuelven a ADMIN, FINANCE y al PM del proyecto.
      const data = puedeVerMontosHoraExtra(request.authUser!, project.projectManagerEmail)
        ? entry
        : sinMontosHoraExtra(entry);
      return reply.status(201).send({ data, warnings: calcResult.warnings });
    },
  );

  // 3. Simular cálculo dinámico (para UI en tiempo real)
  app.post(
    "/calculate",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT])],
    },
    async (request, reply) => {
      await ensureDefaultConfigs();
      const payload = calculatePayloadSchema.parse(request.body);

      // Mismo criterio que `POST /`: un CONSULTANT solo puede simular el
      // cálculo de su propio consultantId. Antes esta ruta usaba el valor del
      // cuerpo tal cual, así que cualquiera podía pedir el cálculo (y de paso
      // la tarifa horaria implícita en el resultado) de un compañero.
      const target = await resolveTargetConsultantId(request, payload.consultantId);
      if ("error" in target) {
        return reply.status(403).send({ message: target.error });
      }

      const consultant = await prisma.consultant.findUnique({
        where: { id: target.consultantId },
      });

      const country = consultant?.country || "Default";
      let configRow = await prisma.extraHoursConfig.findUnique({
        where: { country },
      });

      if (!configRow) {
        configRow = await prisma.extraHoursConfig.findUnique({
          where: { country: "Default" },
        });
      }

      const activeConfig = configRow || {
        weeklyExtraHoursLimit: 12,
        diurnalMultiplier: 1.25,
        nocturnalMultiplier: 1.75,
        diurnalHolidayMultiplier: 2.00,
        nocturnalHolidayMultiplier: 2.50,
        diurnalStart: "06:00:00",
        diurnalEnd: "21:00:00",
        monthlyDivisor: 220,
      };

      const formattedStartTime = payload.startTime.split(":").length === 2 ? `${payload.startTime}:00` : payload.startTime;
      const formattedEndTime = payload.endTime.split(":").length === 2 ? `${payload.endTime}:00` : payload.endTime;

      const calcResult = await calculateExtraHours({
        date: payload.date,
        startTime: formattedStartTime,
        endTime: formattedEndTime,
        consultantId: target.consultantId,
        config: {
          weeklyExtraHoursLimit: Number(activeConfig.weeklyExtraHoursLimit),
          diurnalMultiplier: Number(activeConfig.diurnalMultiplier),
          nocturnalMultiplier: Number(activeConfig.nocturnalMultiplier),
          diurnalHolidayMultiplier: Number(activeConfig.diurnalHolidayMultiplier),
          nocturnalHolidayMultiplier: Number(activeConfig.nocturnalHolidayMultiplier),
          diurnalStart: activeConfig.diurnalStart,
          diurnalEnd: activeConfig.diurnalEnd,
          monthlyDivisor: Number(activeConfig.monthlyDivisor || 220),
        },
      });

      // Sin projectId (o con uno cuyo PM no es el usuario) solo ADMIN/FINANCE ven montos y tarifa.
      const pmProyecto = payload.projectId
        ? (await prisma.project.findUnique({
            where: { id: payload.projectId },
            select: { projectManagerEmail: true },
          }))?.projectManagerEmail
        : null;
      const data = puedeVerMontosHoraExtra(request.authUser!, pmProyecto)
        ? calcResult
        : sinMontosHoraExtra(calcResult);
      return { data };
    },
  );

  // 4. Obtener todas las configuraciones por país
  app.get(
    "/config",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT, AppRole.FINANCE])],
    },
    async () => {
      await ensureDefaultConfigs();
      const configs = await prisma.extraHoursConfig.findMany();
      return { data: configs };
    },
  );

  // 4b. Obtener configuración de un país específico
  app.get(
    "/config/:country",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT, AppRole.FINANCE])],
    },
    async (request) => {
      await ensureDefaultConfigs();
      const { country } = z.object({ country: z.string().trim().transform(normalizeCountry) }).parse(request.params);
      let config = await prisma.extraHoursConfig.findUnique({
        where: { country },
      });

      if (!config) {
        // Retornar la configuración Default o crearla temporalmente
        config = await prisma.extraHoursConfig.findUnique({
          where: { country: "Default" },
        });

        if (!config) {
          config = await prisma.extraHoursConfig.create({
            data: {
              country,
              weeklyExtraHoursLimit: 12,
              diurnalMultiplier: 1.25,
              nocturnalMultiplier: 1.75,
              diurnalHolidayMultiplier: 2.00,
              nocturnalHolidayMultiplier: 2.50,
              diurnalStart: "06:00:00",
              diurnalEnd: "21:00:00",
              monthlyDivisor: 220,
            },
          });
        }
      }

      return { data: config };
    },
  );

  // 5. Actualizar/Crear configuración por país (Upsert)
  //    Solo ADMIN (permiso `extrahours:config`, auth/roles.ts): mueve los
  //    recargos de nómina de todo el país para cualquier solicitud futura.
  app.put(
    "/config/:country",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN])],
    },
    async (request) => {
      const { country } = z.object({ country: z.string().trim().transform(normalizeCountry) }).parse(request.params);
      const payload = configPayloadSchema.parse(request.body);

      // Formatear horas
      const formattedStart = payload.diurnalStart.split(":").length === 2 ? `${payload.diurnalStart}:00` : payload.diurnalStart;
      const formattedEnd = payload.diurnalEnd.split(":").length === 2 ? `${payload.diurnalEnd}:00` : payload.diurnalEnd;

      const antes = await prisma.extraHoursConfig.findUnique({ where: { country } });

      const updated = await prisma.extraHoursConfig.upsert({
        where: { country },
        update: {
          weeklyExtraHoursLimit: payload.weeklyExtraHoursLimit,
          diurnalMultiplier: payload.diurnalMultiplier,
          nocturnalMultiplier: payload.nocturnalMultiplier,
          diurnalHolidayMultiplier: payload.diurnalHolidayMultiplier,
          nocturnalHolidayMultiplier: payload.nocturnalHolidayMultiplier,
          diurnalStart: formattedStart,
          diurnalEnd: formattedEnd,
          monthlyDivisor: payload.monthlyDivisor,
        },
        create: {
          country,
          weeklyExtraHoursLimit: payload.weeklyExtraHoursLimit,
          diurnalMultiplier: payload.diurnalMultiplier,
          nocturnalMultiplier: payload.nocturnalMultiplier,
          diurnalHolidayMultiplier: payload.diurnalHolidayMultiplier,
          nocturnalHolidayMultiplier: payload.nocturnalHolidayMultiplier,
          diurnalStart: formattedStart,
          diurnalEnd: formattedEnd,
          monthlyDivisor: payload.monthlyDivisor,
        },
      });

      // Los multiplicadores y el divisor mensual determinan el monto de nómina
      // de toda solicitud futura de ese país.
      await auditarConfigHorasExtra(request, antes, updated);

      return { data: updated };
    },
  );

  // 5b. Restablecer configuración a predeterminados por país (solo ADMIN, mismo
  //     criterio que el PUT de arriba).
  app.post(
    "/config/:country/reset",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN])],
    },
    async (request) => {
      const { country } = z.object({ country: z.string().trim().transform(normalizeCountry) }).parse(request.params);
      
      const defaultConfig = defaultConfigs.find(c => c.country.toLowerCase() === country.toLowerCase()) || defaultConfigs[0];
      
      const antes = await prisma.extraHoursConfig.findUnique({ where: { country: defaultConfig.country } });

      const updated = await prisma.extraHoursConfig.upsert({
        where: { country: defaultConfig.country },
        update: {
          weeklyExtraHoursLimit: defaultConfig.weeklyExtraHoursLimit,
          diurnalMultiplier: defaultConfig.diurnalMultiplier,
          nocturnalMultiplier: defaultConfig.nocturnalMultiplier,
          diurnalHolidayMultiplier: defaultConfig.diurnalHolidayMultiplier,
          nocturnalHolidayMultiplier: defaultConfig.nocturnalHolidayMultiplier,
          diurnalStart: defaultConfig.diurnalStart,
          diurnalEnd: defaultConfig.diurnalEnd,
          monthlyDivisor: defaultConfig.monthlyDivisor,
        },
        create: {
          country: defaultConfig.country,
          weeklyExtraHoursLimit: defaultConfig.weeklyExtraHoursLimit,
          diurnalMultiplier: defaultConfig.diurnalMultiplier,
          nocturnalMultiplier: defaultConfig.nocturnalMultiplier,
          diurnalHolidayMultiplier: defaultConfig.diurnalHolidayMultiplier,
          nocturnalHolidayMultiplier: defaultConfig.nocturnalHolidayMultiplier,
          diurnalStart: defaultConfig.diurnalStart,
          diurnalEnd: defaultConfig.diurnalEnd,
          monthlyDivisor: defaultConfig.monthlyDivisor,
        },
      });

      await auditarConfigHorasExtra(request, antes, updated);

      return { data: updated };
    },
  );

  // 6. Aprobar solicitud de horas extras (aprobación única del PM)
  //
  //    Solo el PM del proyecto aprueba: ni ADMIN, ni Finanzas, ni delegados.
  //    La puerta de rol deja pasar a cualquier usuario autenticado porque ser
  //    PM no depende del rol de la cuenta, sino de figurar como
  //    `projectManagerEmail` del proyecto; eso lo decide `canReviewExtraHour`.
  app.patch(
    "/:id/approve",
    {
      preHandler: [authenticate, authorize(ROLES_QUE_PUEDEN_SER_PM)],
    },
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);
      const user = request.authUser!;
      const email = user.email.toLowerCase();

      const existing = await prisma.extraHourEntry.findUnique({
        where: { id },
        include: { project: { include: { company: true } } },
      });

      if (!existing) {
        return reply.status(404).send({ message: "Solicitud no encontrada" });
      }

      if (existing.status === ExtraHourStatus.APPROVED) {
        return reply.status(409).send({ message: "La solicitud ya se encuentra aprobada" });
      }

      if (existing.status === ExtraHourStatus.REJECTED) {
        return reply.status(409).send({ message: "Una solicitud rechazada no puede ser aprobada" });
      }

      if (existing.projectId) {
        const entryYear = existing.date.getUTCFullYear();
        const entryMonth = existing.date.getUTCMonth() + 1;
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
            message: "No se pueden realizar cambios en solicitudes pertenecientes a un mes cerrado.",
          });
        }
      }

      // Nadie aprueba sus propias horas extra, sin importar el rol: ni
      // siquiera un ADMIN que de casualidad figurara como PM del proyecto
      // (hoy no puede por la regla de abajo, pero esta comprobación no
      // depende de esa otra).
      if (existing.consultantId && existing.consultantId === user.consultantId) {
        return reply.status(403).send({ message: "No puedes aprobar tus propias horas extra." });
      }

      // Veredicto compartido con `reject` (DEP-17): solo el PM del proyecto.
      const auth = await canReviewExtraHour(existing, user);

      if (!auth.authorized) {
        return reply.status(403).send({ message: "Solo el PM de este proyecto puede aprobar estas horas extra." });
      }

      // Aprobación única: la del PM ya es la autorización de pago, así que aquí
      // se escriben `approvedAt` y `approvedBy` y la solicitud queda elegible
      // para el consolidado de nómina sin ningún paso intermedio.
      const entry = await prisma.extraHourEntry.update({
        where: { id },
        data: {
          status: ExtraHourStatus.APPROVED,
          approvedAt: new Date(),
          approvedBy: email,
          rejectionNote: null,
        },
        include: { project: { select: PROYECTO_MINIMO_SELECT }, consultant: true },
      });

      // Aviso al consultor de que sus horas quedaron aprobadas.
      notifyExtraHourFullyApproved({
        consultantName: entry.consultant.fullName,
        consultantEmail: entry.consultant.email || "",
        date: entry.date.toISOString().split("T")[0],
        hours: Number(entry.totalHours),
        projectName: entry.project?.name || "Proyecto",
        approvedBy: email,
      }).catch((err) => {
        console.error("Error al enviar notificación de aprobación al consultor:", err);
      });

      // Aviso a Nómina. Ya no le pide que apruebe —no puede—, le avisa de que
      // hay un importe aprobado que tendrá que desembolsar. Se conserva porque
      // sin él Nómina solo se entera consultando el consolidado a mano.
      notifyExtraHourApprovedForPayroll({
        consultantName: entry.consultant.fullName,
        identification: entry.consultant.identification || "N/A",
        date: entry.date.toISOString().split("T")[0],
        hours: Number(entry.totalHours),
        totalAmount: Number(entry.totalAmount),
        currency: entry.consultant.rateCurrency || "USD",
        projectName: entry.project?.name || "Proyecto",
        approvedByPM: email,
        observations: entry.observations || undefined,
      }).catch((err) => {
        console.error("Error al enviar notificación de horas extra aprobadas a nómina:", err);
      });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.extraHourEntry,
        entityId: entry.id,
        action: "APPROVE",
        changedBy: email,
        before: existing as unknown as Record<string, unknown>,
        after: entry as unknown as Record<string, unknown>,
        request,
      });

      return { data: entry };
    },
  );

  // 7. Rechazar solicitud (mismo alcance que aprobar: solo el PM del proyecto)
  app.patch(
    "/:id/reject",
    {
      preHandler: [authenticate, authorize(ROLES_QUE_PUEDEN_SER_PM)],
    },
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);
      const payload = rejectPayloadSchema.parse(request.body);
      const user = request.authUser!;
      const email = user.email.toLowerCase();

      const existing = await prisma.extraHourEntry.findUnique({
        where: { id },
        include: { project: { include: { company: true } } },
      });

      if (!existing) {
        return reply.status(404).send({ message: "Solicitud no encontrada" });
      }

      // DEP-40: el estado se comprueba ANTES que el mes cerrado, igual que en
      // `approve`. Antes iba al revés, así que una solicitud ya aprobada en un mes
      // cerrado devolvía 409 al aprobarla y 400 al rechazarla. Además evita una
      // consulta a la base cuando el estado ya descarta la operación.
      if (existing.status === ExtraHourStatus.APPROVED || existing.status === ExtraHourStatus.REJECTED) {
        return reply.status(409).send({ message: "Solo solicitudes pendientes pueden ser rechazadas" });
      }

      if (existing.projectId) {
        const entryYear = existing.date.getUTCFullYear();
        const entryMonth = existing.date.getUTCMonth() + 1;
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
            message: "No se pueden realizar cambios en solicitudes pertenecientes a un mes cerrado.",
          });
        }
      }

      // Nadie rechaza sus propias horas extra, sin importar el rol. Mismo
      // candado que `approve`.
      if (existing.consultantId && existing.consultantId === user.consultantId) {
        return reply.status(403).send({ message: "No puedes rechazar tus propias horas extra." });
      }

      // Validar quién tiene permiso de rechazar. Mismo helper que `approve`
      // (DEP-17): el veredicto es común, el mensaje de error es el de aquí.
      const auth = await canReviewExtraHour(existing, user);

      if (!auth.authorized) {
        return reply.status(403).send({
          message: "Solo el PM de este proyecto puede rechazar estas horas extra.",
        });
      }

      const entry = await prisma.extraHourEntry.update({
        where: { id },
        data: {
          status: ExtraHourStatus.REJECTED,
          approvedAt: null,
          approvedBy: email,
          rejectionNote: payload.rejectionNote,
        },
        include: { project: { select: PROYECTO_MINIMO_SELECT }, consultant: true },
      });

      // Notify the consultant of the rejection
      notifyExtraHourRejected({
        consultantName: entry.consultant.fullName,
        consultantEmail: entry.consultant.email || "",
        date: entry.date.toISOString().split("T")[0],
        hours: Number(entry.totalHours),
        projectName: entry.project?.name || "Proyecto",
        rejectedBy: email,
        rejectionNote: payload.rejectionNote || "No especificado",
      }).catch((err) => {
        console.error("Error al enviar notificación de rechazo al consultor:", err);
      });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.extraHourEntry,
        entityId: entry.id,
        action: "REJECT",
        changedBy: email,
        before: existing as unknown as Record<string, unknown>,
        after: entry as unknown as Record<string, unknown>,
        request,
      });

      return { data: entry };
    },
  );

  // 8. Cierre consolidado de nómina mensual (bimoneda local / USD)
  //
  //    R14: la nómina paga lo REAL. Se calcula sobre los TimeEntry de tipo EXTRA APROBADOS del
  //    mes (incluidos los excedentes que el PM aprobó), con su franja real convertida a hora local
  //    del país del consultor y valorada con `calculateExtraHours`. La solicitud de horas extra es
  //    solo el presupuesto.
  //
  //    Transición: las solicitudes APROBADAS creadas antes de la migración (2026-11-04) que no
  //    tienen ningún TimeEntry vinculado se siguen pagando por su monto aprobado y se marcan como
  //    `legacy` (el consultor las registró antes de que el timesheet conociera las horas extra).
  app.get(
    "/payroll",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.FINANCE])],
    },
    async (request) => {
      const { year, month } = payrollQuerySchema.parse(request.query);

      const startDate = new Date(Date.UTC(year, month - 1, 1));
      const endDate = new Date(Date.UTC(year, month, 1));

      const [realEntries, legacyEntries, fxRates, configRows] = await Promise.all([
        // Lo real: horas EXTRA aprobadas en el timesheet.
        prisma.timeEntry.findMany({
          where: {
            status: TimeEntryStatus.APPROVED,
            type: { category: TimeEntryCategory.EXTRA },
            workDate: { gte: startDate, lt: endDate },
          },
          include: { consultant: true },
          orderBy: [{ workDate: "asc" }, { startedAt: "asc" }],
        }),
        // Lo anterior a R14: solicitudes aprobadas sin ningún registro real vinculado.
        prisma.extraHourEntry.findMany({
          where: {
            status: ExtraHourStatus.APPROVED,
            date: { gte: startDate, lt: endDate },
            createdAt: { lt: PAYROLL_REAL_HOURS_SINCE },
            timeEntries: { none: { status: { not: TimeEntryStatus.REJECTED } } },
          },
          include: { consultant: true, project: { include: { company: true } } },
        }),
        prisma.fxConfig.findMany(),
        prisma.extraHoursConfig.findMany(),
      ]);

      const warnings = new Set<string>();
      const configByCountry = new Map(configRows.map((c) => [c.country, c]));
      const configFor = (country: string) => {
        const row = configByCountry.get(country) ?? configByCountry.get("Default");
        return {
          weeklyExtraHoursLimit: Number(row?.weeklyExtraHoursLimit ?? 12),
          diurnalMultiplier: Number(row?.diurnalMultiplier ?? 1.25),
          nocturnalMultiplier: Number(row?.nocturnalMultiplier ?? 1.75),
          diurnalHolidayMultiplier: Number(row?.diurnalHolidayMultiplier ?? 2),
          nocturnalHolidayMultiplier: Number(row?.nocturnalHolidayMultiplier ?? 2.5),
          diurnalStart: row?.diurnalStart ?? "06:00:00",
          diurnalEnd: row?.diurnalEnd ?? "21:00:00",
          monthlyDivisor: Number(row?.monthlyDivisor ?? 220),
        };
      };

      // Conversión a USD con la configuración de FX.
      const toUsd = (amountLocal: number, currency: string) => {
        if (currency === "USD") return amountLocal;
        const rateRow = fxRates.find((fx) => fx.baseCode === "USD" && fx.quoteCode === currency);
        if (rateRow && Number(rateRow.rate) > 0) return amountLocal / Number(rateRow.rate);
        const reverseRow = fxRates.find((fx) => fx.baseCode === currency && fx.quoteCode === "USD");
        if (reverseRow && Number(reverseRow.rate) > 0) return amountLocal * Number(reverseRow.rate);
        return amountLocal;
      };

      // Consolidar por consultor
      const consolidationMap = new Map<string, {
        consultantName: string;
        identification: string;
        country: string;
        currency: string;
        totalHours: number;
        diurnal: number;
        nocturnal: number;
        diurnalHoliday: number;
        nocturnalHoliday: number;
        totalAmountLocal: number;
        totalAmountUSD: number;
        realHours: number;
        realAmountLocal: number;
        legacyHours: number;
        legacyAmountLocal: number;
        legacy: boolean;
      }>();

      const bucketOf = (c: {
        id: string;
        fullName: string;
        identification: string | null;
        country: string | null;
        rateCurrency: string | null;
      }) => {
        let data = consolidationMap.get(c.id);
        if (!data) {
          data = {
            consultantName: c.fullName,
            identification: c.identification || "N/A",
            country: c.country || "Default",
            currency: c.rateCurrency || "USD",
            totalHours: 0,
            diurnal: 0,
            nocturnal: 0,
            diurnalHoliday: 0,
            nocturnalHoliday: 0,
            totalAmountLocal: 0,
            totalAmountUSD: 0,
            realHours: 0,
            realAmountLocal: 0,
            legacyHours: 0,
            legacyAmountLocal: 0,
            legacy: false,
          };
          consolidationMap.set(c.id, data);
        }
        return data;
      };

      for (const entry of realEntries) {
        const c = entry.consultant;
        const data = bucketOf(c);
        if (!entry.startedAt || !entry.endedAt) {
          // Un EXTRA siempre exige franja; si falta (dato inconsistente) no se puede valorar.
          warnings.add(`El registro ${entry.id} de ${c.fullName} es de horas extra sin franja horaria: no se pagó.`);
          continue;
        }
        const shift = toLocalExtraShift({ startedAt: entry.startedAt, endedAt: entry.endedAt, country: c.country });
        shift.warnings.forEach((w) => warnings.add(`${c.fullName}: ${w}`));

        for (const seg of shift.segments) {
          const calc = await calculateExtraHours({
            date: seg.date,
            startTime: seg.startTime,
            endTime: seg.endTime,
            consultantId: c.id,
            config: configFor(shift.country),
          });
          data.totalHours += calc.totalHours;
          data.diurnal += calc.diurnal;
          data.nocturnal += calc.nocturnal;
          data.diurnalHoliday += calc.diurnalHoliday;
          data.nocturnalHoliday += calc.nocturnalHoliday;
          data.totalAmountLocal += calc.totalAmount;
          data.totalAmountUSD += toUsd(calc.totalAmount, data.currency);
          data.realHours += calc.totalHours;
          data.realAmountLocal += calc.totalAmount;
        }
      }

      const legacyIds: string[] = [];
      for (const entry of legacyEntries) {
        const data = bucketOf(entry.consultant);
        const totalAmountLocal = Number(entry.totalAmount);
        data.totalHours += Number(entry.totalHours);
        data.diurnal += Number(entry.diurnal);
        data.nocturnal += Number(entry.nocturnal);
        data.diurnalHoliday += Number(entry.diurnalHoliday);
        data.nocturnalHoliday += Number(entry.nocturnalHoliday);
        data.totalAmountLocal += totalAmountLocal;
        data.totalAmountUSD += toUsd(totalAmountLocal, data.currency);
        data.legacyHours += Number(entry.totalHours);
        data.legacyAmountLocal += totalAmountLocal;
        data.legacy = true;
        legacyIds.push(entry.id);
      }

      // Convertir mapa a array y redondear
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const summaryList = Array.from(consolidationMap.values()).map((c) => ({
        ...c,
        totalHours: r2(c.totalHours),
        diurnal: r2(c.diurnal),
        nocturnal: r2(c.nocturnal),
        diurnalHoliday: r2(c.diurnalHoliday),
        nocturnalHoliday: r2(c.nocturnalHoliday),
        totalAmountLocal: r2(c.totalAmountLocal),
        totalAmountUSD: r2(c.totalAmountUSD),
        realHours: r2(c.realHours),
        realAmountLocal: r2(c.realAmountLocal),
        legacyHours: r2(c.legacyHours),
        legacyAmountLocal: r2(c.legacyAmountLocal),
      }));

      return { data: summaryList, meta: { warnings: [...warnings], legacyRequestIds: legacyIds } };
    },
  );

  // 9. Eliminar solicitud
  app.delete(
    "/:id",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM])],
    },
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);

      const existing = await prisma.extraHourEntry.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({ message: "Solicitud no encontrada" });
      }

      if (existing.projectId) {
        const entryYear = existing.date.getUTCFullYear();
        const entryMonth = existing.date.getUTCMonth() + 1;
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
            message: "No se pueden eliminar registros de horas extra de un período de nómina cerrado.",
          });
        }
      }

      if (existing.status === ExtraHourStatus.APPROVED) {
        return reply.status(409).send({ message: "No se puede eliminar una solicitud ya aprobada en nómina" });
      }

      await prisma.extraHourEntry.delete({ where: { id } });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.extraHourEntry,
        entityId: id,
        action: "DELETE",
        changedBy: request.authUser!.email,
        before: existing as unknown as Record<string, unknown>,
        request,
      });

      return reply.status(204).send();
    },
  );

  // 10. Obtener listado consolidado de feriados (oficiales + personalizados) por país y año
  app.get(
    "/holidays",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT, AppRole.FINANCE, AppRole.VIEWER])],
    },
    async (request) => {
      const { country, year } = z.object({
        country: z.string().trim().transform(normalizeCountry),
        year: z.coerce.number().min(1900).max(3000),
      }).parse(request.query);

      const official = getHolidaysForYear(year, country);

      const customHolidays = await prisma.customHoliday.findMany({
        where: {
          OR: [
            { country: "All" },
            { country: country },
          ],
        },
      });

      const customInYear = customHolidays
        .filter((h) => h.date.getUTCFullYear() === year)
        .map((h) => ({
          date: h.date,
          name: h.name,
          isCustom: true,
        }));

      const combined = [...official.map(h => ({ ...h, isCustom: false })), ...customInYear];
      
      const uniqueHolidays = [];
      const seenDates = new Set();
      for (const h of combined) {
        const dateStr = h.date instanceof Date ? h.date.toISOString().split("T")[0] : new Date(h.date).toISOString().split("T")[0];
        if (!seenDates.has(dateStr)) {
          seenDates.add(dateStr);
          uniqueHolidays.push(h);
        }
      }

      return { data: uniqueHolidays };
    }
  );
}
