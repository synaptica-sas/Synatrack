import type { FastifyInstance } from "fastify";
import { AppRole } from "@prisma/client";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";
import {
  AMBITO_GENERAL,
  CONFIG_RESUMEN_POR_DEFECTO,
  resolverConfigResumen,
  type ConfigResumenSemanal,
} from "../../utils/approval-digest.js";

/**
 * Configuración del resumen semanal de aprobaciones (R-020 + R-022).
 *
 * Existe como pantalla y no como constante en el código por una razón concreta:
 * este proyecto lleva **ocho** tropiezos con el mismo patrón —un dato que el
 * código usa y que nadie puede cambiar sin un despliegue— y los dos últimos
 * (Jornada Laboral, Umbrales de Salud) se resolvieron justamente así. El día y
 * la hora de un correo semanal, y la decisión de conservar o no el aviso
 * inmediato de horas extra, son criterios de negocio que van a cambiar.
 *
 * Diferencia deliberada con `health-thresholds.routes.ts`, que es el modelo que
 * sigue este módulo: **aquí no hay DELETE**. La misma fila guarda `lastSentAt`,
 * la marca que impide mandar el resumen dos veces en la misma semana; borrarla
 * para "restaurar los valores iniciales" borraría también esa marca y permitiría
 * un segundo envío. Restaurar se hace con un PUT de los valores por defecto, que
 * el frontend ofrece como botón.
 */

/** Lo que devuelve el GET, más la procedencia y la marca del último envío. */
interface RespuestaConfig extends ConfigResumenSemanal {
  /** `"base"` si hay fila guardada, `"codigo"` si se usan los valores del código. */
  origen: "base" | "codigo";
  porDefecto: ConfigResumenSemanal;
  /** Cuándo salió el último resumen. `null` = todavía ninguno. */
  lastSentAt: string | null;
  updatedAt: string | null;
}

/**
 * Carga la configuración efectiva. Sin fila -> los valores del código.
 *
 * La consumen esta ruta y `extra-hours.routes.ts` (para saber si el aviso
 * inmediato sigue activo), igual que `cargarUmbralesSalud` se comparte entre su
 * ruta y los cálculos de salud.
 */
export async function cargarConfigResumen(): Promise<ConfigResumenSemanal> {
  const fila = await prisma.approvalDigestConfig.findUnique({
    where: { scope: AMBITO_GENERAL },
    select: {
      enabled: true,
      sendWeekday: true,
      sendHourUtc: true,
      immediateExtraHour: true,
    },
  });
  return resolverConfigResumen(fila);
}

/** `true` si hay que seguir mandando el correo por cada solicitud de horas extra. */
export async function avisoInmediatoActivo(): Promise<boolean> {
  return (await cargarConfigResumen()).immediateExtraHour;
}

const payloadSchema = z.object({
  enabled: z.boolean(),
  sendWeekday: z.coerce
    .number()
    .int("El día de envío debe ser un número entero")
    .min(1, "El día de envío va de 1 (lunes) a 7 (domingo)")
    .max(7, "El día de envío va de 1 (lunes) a 7 (domingo)"),
  sendHourUtc: z.coerce
    .number()
    .int("La hora de envío debe ser un número entero")
    .min(0, "La hora de envío va de 0 a 23 (UTC)")
    .max(23, "La hora de envío va de 0 a 23 (UTC)"),
  immediateExtraHour: z.boolean(),
});

/**
 * Leerla no requiere permiso especial: cualquier rol operativo puede querer
 * saber qué día le llega su resumen. Escribirla es solo de ADMIN, con el mismo
 * criterio que `capacity:config`, `finance:categories` y `health:thresholds`:
 * mueve el comportamiento de toda la plataforma a la vez.
 */
const ROLES_LECTURA = [
  AppRole.ADMIN,
  AppRole.PM,
  AppRole.CONSULTANT,
  AppRole.FINANCE,
  AppRole.VIEWER,
];

export async function approvalDigestRoutes(app: FastifyInstance) {
  app.get(
    "/",
    { preHandler: [authenticate, authorize(ROLES_LECTURA)] },
    async () => {
      const fila = await prisma.approvalDigestConfig.findUnique({
        where: { scope: AMBITO_GENERAL },
      });

      const respuesta: RespuestaConfig = {
        ...resolverConfigResumen(fila),
        origen: fila ? "base" : "codigo",
        porDefecto: CONFIG_RESUMEN_POR_DEFECTO,
        lastSentAt: fila?.lastSentAt ? fila.lastSentAt.toISOString() : null,
        updatedAt: fila?.updatedAt ? fila.updatedAt.toISOString() : null,
      };

      return { data: respuesta };
    },
  );

  app.put(
    "/",
    { preHandler: [authenticate, authorize([AppRole.ADMIN])] },
    async (request, reply) => {
      const payload = payloadSchema.parse(request.body);

      const anterior = await prisma.approvalDigestConfig.findUnique({
        where: { scope: AMBITO_GENERAL },
      });

      // `lastSentAt` NO se toca aquí a propósito: es estado del trabajo, no
      // configuración. Si un administrador adelanta el día de envío a mitad de
      // semana y el resumen de esa semana ya salió, no vuelve a salir — que es
      // lo correcto: el cambio aplica desde la semana siguiente.
      const fila = await prisma.approvalDigestConfig.upsert({
        where: { scope: AMBITO_GENERAL },
        update: payload,
        create: { scope: AMBITO_GENERAL, ...payload },
      });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.approvalDigestConfig,
        entityId: fila.id,
        action: anterior ? "UPDATE" : "CREATE",
        changedBy: request.authUser!.email,
        before: anterior ? { ...resolverConfigResumen(anterior) } : null,
        after: { ...resolverConfigResumen(fila) },
        request,
      });

      const respuesta: RespuestaConfig = {
        ...resolverConfigResumen(fila),
        origen: "base",
        porDefecto: CONFIG_RESUMEN_POR_DEFECTO,
        lastSentAt: fila.lastSentAt ? fila.lastSentAt.toISOString() : null,
        updatedAt: fila.updatedAt.toISOString(),
      };

      return reply.status(200).send({ data: respuesta });
    },
  );
}
