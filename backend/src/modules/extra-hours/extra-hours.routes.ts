import type { FastifyInstance } from "fastify";
import { AppRole, ExtraHourStatus } from "@prisma/client";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { normalizeCountry, SUPPORTED_COUNTRIES } from "../../utils/country.js";
import { getHolidaysForYear } from "../../utils/holidays.js";
import { calculateExtraHours } from "../../utils/calculateExtraHours.js";
import { notifyNewExtraHourRequest, notifyExtraHourApprovedByPM, notifyExtraHourFullyApproved, notifyExtraHourRejected } from "../../utils/notifications.js";

const extraHourPayloadSchema = z.object({
  projectId: z.string().min(1),
  consultantId: z.string().min(1),
  date: z.coerce.date(),
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  observations: z.string().trim().optional(),
});

const calculatePayloadSchema = z.object({
  consultantId: z.string().min(1),
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

const reviewPayloadSchema = z.object({
  approvedBy: z.string().trim().min(1),
  rejectionNote: z.string().trim().optional(),
});

const rejectPayloadSchema = z.object({
  approvedBy: z.string().trim().min(1),
  rejectionNote: z.string().trim().min(3),
});

const idParamsSchema = z.object({ id: z.string().min(1) });

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

      let entries;

      if (roles.includes(AppRole.ADMIN) || roles.includes(AppRole.FINANCE) || roles.includes(AppRole.VIEWER)) {
        // Acceso total
        entries = await prisma.extraHourEntry.findMany({
          include: {
            project: true,
            consultant: true,
          },
          orderBy: { date: "desc" },
        });
      } else if (roles.includes(AppRole.PM)) {
        // PM ve las suyas reportadas como consultor Y las de proyectos que gestiona
        entries = await prisma.extraHourEntry.findMany({
          where: {
            OR: [
              { consultant: { email: email } },
              { project: { projectManagerEmail: email } },
            ],
          },
          include: {
            project: true,
            consultant: true,
          },
          orderBy: { date: "desc" },
        });
      } else {
        // Consultor solo ve las suyas
        entries = await prisma.extraHourEntry.findMany({
          where: {
            consultant: { email: email },
          },
          include: {
            project: true,
            consultant: true,
          },
          orderBy: { date: "desc" },
        });
      }

      return { data: entries };
    },
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
      const isManager = roles.includes(AppRole.ADMIN) || roles.includes(AppRole.PM);

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
        prisma.consultant.findUnique({ where: { id: payload.consultantId } }),
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

      // Check date limit for standard consultants (non-Admin/non-PM)
      if (!isManager) {
        const COUNTRY_TIMEZONES: Record<string, string> = {
          Colombia: "America/Bogota",
          Peru: "America/Lima",
          Chile: "America/Santiago",
          Mexico: "America/Mexico_City",
          Ecuador: "America/Guayaquil",
          Argentina: "America/Argentina/Buenos_Aires",
          España: "Europe/Madrid",
          Default: "America/Bogota",
        };
        const timezone = COUNTRY_TIMEZONES[country] || "America/Bogota";
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
        consultantId: payload.consultantId,
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
          consultantId: payload.consultantId,
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
          project: true,
          consultant: true,
        },
      });

      // Notificar al PM de la nueva solicitud de horas extras
      notifyNewExtraHourRequest({
        consultantName: entry.consultant.fullName,
        date: entry.date.toISOString().split("T")[0],
        hours: Number(entry.totalHours),
        pmEmail: entry.project?.projectManagerEmail || "",
        projectName: entry.project?.name || "Proyecto",
      }).catch((err) => {
        console.error("Error al enviar notificación de nueva hora extra:", err);
      });

      return reply.status(201).send({ data: entry, warnings: calcResult.warnings });
    },
  );

  // 3. Simular cálculo dinámico (para UI en tiempo real)
  app.post(
    "/calculate",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT])],
    },
    async (request) => {
      await ensureDefaultConfigs();
      const payload = calculatePayloadSchema.parse(request.body);

      const consultant = await prisma.consultant.findUnique({
        where: { id: payload.consultantId },
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
        consultantId: payload.consultantId,
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

      return { data: calcResult };
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
  app.put(
    "/config/:country",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE])],
    },
    async (request) => {
      const { country } = z.object({ country: z.string().trim().transform(normalizeCountry) }).parse(request.params);
      const payload = configPayloadSchema.parse(request.body);

      // Formatear horas
      const formattedStart = payload.diurnalStart.split(":").length === 2 ? `${payload.diurnalStart}:00` : payload.diurnalStart;
      const formattedEnd = payload.diurnalEnd.split(":").length === 2 ? `${payload.diurnalEnd}:00` : payload.diurnalEnd;

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

      return { data: updated };
    },
  );

  // 5b. Restablecer configuración a predeterminados por país
  app.post(
    "/config/:country/reset",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE])],
    },
    async (request) => {
      const { country } = z.object({ country: z.string().trim().transform(normalizeCountry) }).parse(request.params);
      
      const defaultConfig = defaultConfigs.find(c => c.country.toLowerCase() === country.toLowerCase()) || defaultConfigs[0];
      
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

      return { data: updated };
    },
  );

  // 6. Aprobar solicitud de horas extras (Flujo secuencial de 2 niveles)
  app.patch(
    "/:id/approve",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE])],
    },
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);
      const payload = reviewPayloadSchema.parse(request.body);
      const user = request.authUser!;
      const email = user.email.toLowerCase();
      const isAdmin = user.roles.includes(AppRole.ADMIN);
      const isFinance = user.roles.includes(AppRole.FINANCE);

      const existing = await prisma.extraHourEntry.findUnique({
        where: { id },
        include: { project: true },
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

      // Lógica de transición de estados
      if (existing.status === ExtraHourStatus.PENDING_PM) {
        // Nivel 1: Requiere aprobación del PM del proyecto, Admin o Delegado
        const isPM = existing.project?.projectManagerEmail?.toLowerCase() === email;
        let hasDelegation = false;
        if (!isPM && !isAdmin && existing.project?.id) {
          const activeDelegation = await prisma.approvalDelegation.findFirst({
            where: {
              projectId: existing.project.id,
              toUserEmail: email,
              startDate: { lte: new Date() },
              endDate: { gte: new Date() },
            },
          });
          if (activeDelegation) {
            hasDelegation = true;
          }
        }

        if (!isPM && !isAdmin && !hasDelegation) {
          return reply.status(403).send({ message: "Solo el supervisor (PM) de este proyecto, un consultor con delegación activa o el Administrador pueden otorgar la aprobación operativa." });
        }

        const entry = await prisma.extraHourEntry.update({
          where: { id },
          data: {
            status: ExtraHourStatus.PENDING_FINANCE,
            rejectionNote: null,
          },
          include: { project: true, consultant: true },
        });

        // Notificar a Nómina/Finanzas que el PM ha aprobado las horas extras
        notifyExtraHourApprovedByPM({
          consultantName: entry.consultant.fullName,
          identification: entry.consultant.identification || "N/A",
          date: entry.date.toISOString().split("T")[0],
          hours: Number(entry.totalHours),
          totalAmount: Number(entry.totalAmount),
          currency: entry.consultant.rateCurrency || "USD",
          projectName: entry.project?.name || "Proyecto",
          approvedByPM: payload.approvedBy || user.email,
          observations: entry.observations || undefined,
        }).catch((err) => {
          console.error("Error al enviar notificación de aprobación del PM a nómina:", err);
        });

        return { data: entry };
      } else {
        // Nivel 2: Requiere aprobación de Finanzas / Recursos Humanos (Lina) o Admin
        if (!isFinance && !isAdmin) {
          return reply.status(403).send({ message: "Solo el personal de Finanzas / Nómina o el Administrador pueden otorgar la aprobación final para pago." });
        }

        const entry = await prisma.extraHourEntry.update({
          where: { id },
          data: {
            status: ExtraHourStatus.APPROVED,
            approvedAt: new Date(),
            approvedBy: payload.approvedBy,
            rejectionNote: null,
          },
          include: { project: true, consultant: true },
        });

        // Notify the consultant of the final approval (Level 2)
        notifyExtraHourFullyApproved({
          consultantName: entry.consultant.fullName,
          consultantEmail: entry.consultant.email || "",
          date: entry.date.toISOString().split("T")[0],
          hours: Number(entry.totalHours),
          projectName: entry.project?.name || "Proyecto",
          approvedBy: payload.approvedBy,
        }).catch((err) => {
          console.error("Error al enviar notificación de aprobación final al consultor:", err);
        });

        return { data: entry };
      }
    },
  );

  // 7. Rechazar solicitud
  app.patch(
    "/:id/reject",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.PM, AppRole.FINANCE])],
    },
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);
      const payload = rejectPayloadSchema.parse(request.body);
      const user = request.authUser!;
      const email = user.email.toLowerCase();
      const isAdmin = user.roles.includes(AppRole.ADMIN);
      const isFinance = user.roles.includes(AppRole.FINANCE);

      const existing = await prisma.extraHourEntry.findUnique({
        where: { id },
        include: { project: true },
      });

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
            message: "No se pueden realizar cambios en solicitudes pertenecientes a un mes cerrado.",
          });
        }
      }

      if (existing.status === ExtraHourStatus.APPROVED || existing.status === ExtraHourStatus.REJECTED) {
        return reply.status(409).send({ message: "Solo solicitudes pendientes pueden ser rechazadas" });
      }

      // Validar quién tiene permiso de rechazar
      if (existing.status === ExtraHourStatus.PENDING_PM) {
        const isPM = existing.project?.projectManagerEmail?.toLowerCase() === email;
        let hasDelegation = false;
        if (!isPM && !isAdmin && existing.project?.id) {
          const activeDelegation = await prisma.approvalDelegation.findFirst({
            where: {
              projectId: existing.project.id,
              toUserEmail: email,
              startDate: { lte: new Date() },
              endDate: { gte: new Date() },
            },
          });
          if (activeDelegation) {
            hasDelegation = true;
          }
        }
        if (!isPM && !isAdmin && !hasDelegation) {
          return reply.status(403).send({ message: "Solo el PM de este proyecto, un consultor con delegación activa o el Administrador pueden rechazar en este nivel." });
        }
      } else {
        if (!isFinance && !isAdmin) {
          return reply.status(403).send({ message: "Solo Finanzas o el Administrador pueden rechazar en este nivel." });
        }
      }

      const entry = await prisma.extraHourEntry.update({
        where: { id },
        data: {
          status: ExtraHourStatus.REJECTED,
          approvedAt: null,
          approvedBy: payload.approvedBy,
          rejectionNote: payload.rejectionNote,
        },
        include: { project: true, consultant: true },
      });

      // Notify the consultant of the rejection
      notifyExtraHourRejected({
        consultantName: entry.consultant.fullName,
        consultantEmail: entry.consultant.email || "",
        date: entry.date.toISOString().split("T")[0],
        hours: Number(entry.totalHours),
        projectName: entry.project?.name || "Proyecto",
        rejectedBy: payload.approvedBy,
        rejectionNote: payload.rejectionNote || "No especificado",
      }).catch((err) => {
        console.error("Error al enviar notificación de rechazo al consultor:", err);
      });

      return { data: entry };
    },
  );

  // 8. Cierre consolidado de nómina mensual (bimoneda local / USD)
  app.get(
    "/payroll",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.FINANCE])],
    },
    async (request) => {
      const { year, month } = payrollQuerySchema.parse(request.query);

      const startDate = new Date(Date.UTC(year, month - 1, 1));
      const endDate = new Date(Date.UTC(year, month, 1));

      // Obtener todas las solicitudes aprobadas en el mes
      const approvedEntries = await prisma.extraHourEntry.findMany({
        where: {
          status: ExtraHourStatus.APPROVED,
          date: {
            gte: startDate,
            lt: endDate,
          },
        },
        include: {
          consultant: true,
          project: true,
        },
      });

      // Obtener configuraciones de FX para conversiones a USD
      const fxRates = await prisma.fxConfig.findMany();

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
      }>();

      for (const entry of approvedEntries) {
        const c = entry.consultant;
        const cId = c.id;
        const currency = c.rateCurrency || "USD";
        const totalAmountLocal = Number(entry.totalAmount);

        // Convertir a USD usando FX Config
        let totalAmountUSD = totalAmountLocal;
        if (currency !== "USD") {
          const rateRow = fxRates.find((fx) => fx.baseCode === "USD" && fx.quoteCode === currency);
          if (rateRow && Number(rateRow.rate) > 0) {
            totalAmountUSD = totalAmountLocal / Number(rateRow.rate);
          } else {
            // Conversión inversa si aplica
            const reverseRow = fxRates.find((fx) => fx.baseCode === currency && fx.quoteCode === "USD");
            if (reverseRow && Number(reverseRow.rate) > 0) {
              totalAmountUSD = totalAmountLocal * Number(reverseRow.rate);
            }
          }
        }

        if (!consolidationMap.has(cId)) {
          consolidationMap.set(cId, {
            consultantName: c.fullName,
            identification: c.identification || "N/A",
            country: c.country || "Default",
            currency: currency,
            totalHours: 0,
            diurnal: 0,
            nocturnal: 0,
            diurnalHoliday: 0,
            nocturnalHoliday: 0,
            totalAmountLocal: 0,
            totalAmountUSD: 0,
          });
        }

        const data = consolidationMap.get(cId)!;
        data.totalHours += Number(entry.totalHours);
        data.diurnal += Number(entry.diurnal);
        data.nocturnal += Number(entry.nocturnal);
        data.diurnalHoliday += Number(entry.diurnalHoliday);
        data.nocturnalHoliday += Number(entry.nocturnalHoliday);
        data.totalAmountLocal += totalAmountLocal;
        data.totalAmountUSD += totalAmountUSD;
      }

      // Convertir mapa a array y redondear
      const summaryList = Array.from(consolidationMap.values()).map((c) => ({
        ...c,
        totalHours: Math.round(c.totalHours * 100) / 100,
        diurnal: Math.round(c.diurnal * 100) / 100,
        nocturnal: Math.round(c.nocturnal * 100) / 100,
        diurnalHoliday: Math.round(c.diurnalHoliday * 100) / 100,
        nocturnalHoliday: Math.round(c.nocturnalHoliday * 100) / 100,
        totalAmountLocal: Math.round(c.totalAmountLocal * 100) / 100,
        totalAmountUSD: Math.round(c.totalAmountUSD * 100) / 100,
      }));

      return { data: summaryList };
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
