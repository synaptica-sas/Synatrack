import type { PrismaClient } from "@prisma/client";
import type { FastifyRequest } from "fastify";

type AuditAction = "CREATE" | "UPDATE" | "DELETE" | "APPROVE" | "REJECT" | "CLOSE" | "CANCEL" | "COMPLETE";

/**
 * Catálogo único de entidades auditables (R9).
 *
 * Antes convivían `"Project"` y `"project"`, o `"Forecast"` junto a
 * `"assignment"`/`"changeRequest"`: filtrar por entidad en `GET /api/audit`
 * perdía registros. La nomenclatura homologada es **camelCase con minúscula
 * inicial**, que es la que ya usaba la mayoría de los módulos y la que coincide
 * con el nombre del modelo de Prisma en su forma de propiedad
 * (`prisma.timeEntry`, `prisma.extraHourEntry`, ...).
 *
 * Al tipar `writeAudit` contra este catálogo, cualquier módulo nuevo que
 * invente una variante queda cazado por `tsc`, no por una consulta en producción.
 */
export const AUDIT_ENTITIES = {
  project: "project",
  consultant: "consultant",
  timeEntry: "timeEntry",
  extraHourEntry: "extraHourEntry",
  expense: "expense",
  revenueEntry: "revenueEntry",
  forecast: "forecast",
  assignment: "assignment",
  changeRequest: "changeRequest",
  monthlySnapshot: "monthlySnapshot",
  approvalDelegation: "approvalDelegation",
  user: "user",
  activity: "activity",
  estimation: "estimation",
  alert: "alert",
  consultantBlock: "consultantBlock",
} as const;

export type AuditEntity = (typeof AUDIT_ENTITIES)[keyof typeof AUDIT_ENTITIES];

/**
 * Equivalencias con la nomenclatura anterior, para que el histórico ya escrito
 * en producción siga siendo consultable sin migrar datos (ver
 * `documentacion/cambios/R9-auditoria.md`). La clave es el nombre homologado;
 * el valor, todas las variantes que hay que buscar en `AuditLog.entity`.
 */
export const ALIAS_HISTORICOS_ENTIDAD: Partial<Record<AuditEntity, readonly string[]>> = {
  project: ["Project"],
  forecast: ["Forecast"],
};

/**
 * Devuelve todas las variantes de `entity` que corresponden a una misma entidad
 * lógica: la homologada más las históricas. Se usa para filtrar en
 * `GET /api/audit` sin partir la bitácora en dos.
 */
export function variantesDeEntidad(entity: string): string[] {
  const alias = ALIAS_HISTORICOS_ENTIDAD[entity as AuditEntity] ?? [];
  return [entity, ...alias];
}

function computeDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { before: unknown; after: unknown }> {
  const diff: Record<string, { before: unknown; after: unknown }> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of keys) {
    const bVal = JSON.stringify(before[key]);
    const aVal = JSON.stringify(after[key]);
    if (bVal !== aVal) {
      diff[key] = { before: before[key], after: after[key] };
    }
  }

  return diff;
}

/**
 * Registra una escritura en `AuditLog`.
 *
 * **Nunca lanza.** La auditoría es un rastro lateral: si falla el `INSERT`
 * (la tabla no existe todavía en un entorno, el `payload` no es serializable,
 * la base rechaza la conexión...) no puede tumbar una operación de negocio que
 * ya se confirmó. Tumbarla sería peor que el fallo original: el usuario vería
 * un 500 sobre unas horas extra que en realidad SÍ quedaron aprobadas, y se
 * quedaría sin registro igual. El error se deja en el log del servidor con el
 * nivel `error` para que sea detectable en operación.
 *
 * Contrapartida asumida: una escritura de negocio puede quedar sin rastro y
 * solo lo sabrá quien lea los logs. Está anotado como riesgo abierto en
 * `documentacion/cambios/R9-auditoria.md`.
 */
export async function writeAudit(
  prisma: PrismaClient,
  options: {
    entity: AuditEntity;
    entityId: string;
    action: AuditAction;
    changedBy: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    request?: FastifyRequest;
  },
) {
  try {
    const diff =
      options.before && options.after
        ? computeDiff(options.before as Record<string, unknown>, options.after as Record<string, unknown>)
        : null;

    await prisma.auditLog.create({
      data: {
        entity: options.entity,
        entityId: options.entityId,
        action: options.action,
        changedBy: options.changedBy,
        before: options.before ? JSON.parse(JSON.stringify(options.before)) : undefined,
        after: options.after ? JSON.parse(JSON.stringify(options.after)) : undefined,
        diff: diff ? JSON.parse(JSON.stringify(diff)) : undefined,
        ipAddress: options.request?.ip ?? null,
        userAgent: options.request?.headers["user-agent"] ?? null,
      },
    });
  } catch (err) {
    const detalle = {
      err,
      entity: options.entity,
      entityId: options.entityId,
      action: options.action,
      changedBy: options.changedBy,
    };

    if (options.request) {
      options.request.log.error(detalle, "No se pudo escribir en la bitácora de auditoría");
    } else {
      console.error("No se pudo escribir en la bitácora de auditoría", detalle);
    }
  }
}
