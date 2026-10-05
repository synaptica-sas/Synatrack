import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";
import {
  AMBITO_GENERAL,
  UMBRALES_SALUD_POR_DEFECTO,
  resolverUmbralesSalud,
  type UmbralesSalud,
} from "../../utils/healthThresholds.js";

/**
 * Umbrales del semáforo de salud (decisión de negocio D-7).
 *
 * Hasta ahora los cortes de CPI, SPI y uso de presupuesto estaban escritos en
 * el código, y **en tres sitios distintos con números distintos**: el semáforo
 * del backend, la celda del Portafolio y el motor de alertas. Dirección decidió
 * que son configuración general y pidió una pantalla para ajustarlos.
 *
 * Quién puede tocarlos: **solo ADMIN** (`health:thresholds`), igual que la
 * jornada laboral (D-5) o el catálogo de categorías (D-4). No es un dato
 * operativo: mover un umbral repinta de golpe el semáforo de todo el portafolio.
 *
 * Leerlos sí puede cualquier rol autenticado: las pantallas necesitan saber
 * contra qué se comparó para poder explicarlo en el tooltip, y un umbral no
 * expone ningún dato sensible.
 */

/**
 * Carga los umbrales generales de la base.
 *
 * La usan todas las rutas que calculan salud. Si la tabla está vacía devuelve
 * `UMBRALES_SALUD_POR_DEFECTO` — comportamiento definido y con nombre, no un
 * número escondido — junto con el origen, para poder avisarlo en pantalla.
 */
export async function cargarUmbralesSalud(): Promise<UmbralesSalud> {
  const fila = await prisma.healthThresholdConfig.findUnique({
    where: { scope: AMBITO_GENERAL },
  });
  return resolverUmbralesSalud(fila);
}

/**
 * Invariantes de negocio, validados ANTES de tocar Prisma:
 *  · CPI y SPI son "cuanto más bajo, peor" → crítico <= advertencia.
 *  · El presupuesto es "cuanto más alto, peor" → aviso <= excedido.
 * Sin esto se podría guardar una configuración que produce un semáforo
 * imposible (una banda de advertencia que nunca se alcanza).
 */
const payloadSchema = z
  .object({
    cpiWarning: z.coerce.number().positive().max(99),
    cpiCritical: z.coerce.number().positive().max(99),
    spiWarning: z.coerce.number().positive().max(99),
    spiCritical: z.coerce.number().positive().max(99),
    budgetWarningPct: z.coerce.number().min(0).max(999),
    budgetCriticalPct: z.coerce.number().min(0).max(999),
  })
  .refine((v) => v.cpiCritical <= v.cpiWarning, {
    message: "El CPI crítico no puede ser mayor que el de advertencia",
    path: ["cpiCritical"],
  })
  .refine((v) => v.spiCritical <= v.spiWarning, {
    message: "El SPI crítico no puede ser mayor que el de advertencia",
    path: ["spiCritical"],
  })
  .refine((v) => v.budgetWarningPct <= v.budgetCriticalPct, {
    message: "El aviso de presupuesto no puede ser mayor que el umbral de excedido",
    path: ["budgetWarningPct"],
  });

const ROLES_LECTURA = [
  AppRole.ADMIN,
  AppRole.PM,
  AppRole.CONSULTANT,
  AppRole.FINANCE,
  AppRole.VIEWER,
];

export async function healthThresholdsRoutes(app: FastifyInstance) {
  // ── Lectura ───────────────────────────────────────────────────────────────
  app.get(
    "/",
    { preHandler: [authenticate, authorize(ROLES_LECTURA)] },
    async () => {
      const fila = await prisma.healthThresholdConfig.findUnique({
        where: { scope: AMBITO_GENERAL },
      });

      return {
        data: {
          ...resolverUmbralesSalud(fila),
          /**
           * "base" = hay fila guardada. "codigo" = la tabla está vacía y se
           * están aplicando los valores por defecto del código. La pantalla lo
           * dice explícitamente en vez de hacer pasar uno por el otro.
           */
          origen: fila ? ("base" as const) : ("codigo" as const),
          porDefecto: UMBRALES_SALUD_POR_DEFECTO,
          updatedAt: fila?.updatedAt ?? null,
        },
      };
    },
  );

  // ── Escritura ─────────────────────────────────────────────────────────────
  app.put(
    "/",
    { preHandler: [authenticate, authorize([AppRole.ADMIN])] },
    async (request) => {
      const payload = payloadSchema.parse(request.body);

      const antes = await prisma.healthThresholdConfig.findUnique({
        where: { scope: AMBITO_GENERAL },
      });

      const fila = await prisma.healthThresholdConfig.upsert({
        where: { scope: AMBITO_GENERAL },
        update: payload,
        create: { scope: AMBITO_GENERAL, ...payload },
      });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.healthThresholdConfig,
        entityId: fila.id,
        action: antes ? "UPDATE" : "CREATE",
        changedBy: request.authUser!.email,
        before: antes ? resolverUmbralesSalud(antes) : null,
        after: resolverUmbralesSalud(fila),
        request,
      });

      return {
        data: {
          ...resolverUmbralesSalud(fila),
          origen: "base" as const,
          porDefecto: UMBRALES_SALUD_POR_DEFECTO,
          updatedAt: fila.updatedAt,
        },
      };
    },
  );

  // ── Volver a los valores iniciales ────────────────────────────────────────
  // Borra la fila en vez de reescribirla con los defaults: así el API vuelve a
  // decir `origen: "codigo"` y queda claro que no hay configuración propia.
  app.delete(
    "/",
    { preHandler: [authenticate, authorize([AppRole.ADMIN])] },
    async (request, reply) => {
      const fila = await prisma.healthThresholdConfig.findUnique({
        where: { scope: AMBITO_GENERAL },
      });
      if (!fila) return reply.status(404).send({ message: "No hay umbrales configurados" });

      await prisma.healthThresholdConfig.delete({ where: { id: fila.id } });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.healthThresholdConfig,
        entityId: fila.id,
        action: "DELETE",
        changedBy: request.authUser!.email,
        before: resolverUmbralesSalud(fila),
        request,
      });

      return reply.status(204).send();
    },
  );
}
