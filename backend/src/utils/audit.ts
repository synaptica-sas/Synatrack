import type { FastifyRequest } from "fastify";
import type { DbClient } from "../infra/prisma.js";

type AuditAction = "CREATE" | "UPDATE" | "DELETE" | "APPROVE" | "REJECT" | "CLOSE" | "CANCEL" | "COMPLETE" | "LOGIN";

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
  // `Expense` y `RevenueEntry` se fusionaron en el modelo `FinancialEntry` con
  // un discriminador `type`. Se conservan los dos valores separados porque son
  // dos operaciones de negocio distintas (un gasto no es un ingreso) y el filtro
  // de `GET /api/audit` los distingue; `financialEntry` es el paraguas que
  // devuelve ambos (ver ALIAS_HISTORICOS_ENTIDAD).
  expense: "expense",
  revenueEntry: "revenueEntry",
  financialEntry: "financialEntry",
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
  capacityConfig: "capacityConfig",
  capacitySettings: "capacitySettings",
  capacityReport: "capacityReport",
  holiday: "holiday",
  holidayCalendarYear: "holidayCalendarYear",
  customHoliday: "customHoliday",
  financialCategory: "financialCategory",
  healthThresholdConfig: "healthThresholdConfig",
  approvalDigestConfig: "approvalDigestConfig",
  extraHoursConfig: "extraHoursConfig",
  fxConfig: "fxConfig",
  milestone: "milestone",
  risk: "risk",
  issue: "issue",
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
  // No es un alias "histórico" sino jerárquico: al fusionarse las tablas,
  // `entity=financialEntry` debe devolver gastos e ingresos juntos.
  financialEntry: ["expense", "revenueEntry"],
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
  prisma: DbClient,
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

/**
 * Ventana mínima entre dos LOGIN del mismo usuario. Una jornada: recargar la
 * pestaña o abrir otra no cuenta como un inicio de sesión nuevo.
 */
export const UMBRAL_LOGIN_HORAS = 8;

/**
 * Registra el inicio de sesión de un usuario en `AuditLog` (action `LOGIN`).
 *
 * No existe un endpoint de login propio: la sesión la emite Entra ID y el
 * backend solo ve un token en cada petición. El único punto que ocurre una vez
 * al arrancar la app es `GET /api/auth/me` (el frontend lo llama al cargar,
 * ver `App.tsx`), así que se invoca desde ahí y NO desde `authenticate`, que
 * corre en cada request y ya hace varias consultas.
 *
 * Aun así `/me` se vuelve a llamar en cada recarga de página, por eso se aplica
 * un umbral: si ya hay un LOGIN del mismo usuario, con la misma IP y el mismo
 * user-agent, dentro de las últimas `UMBRAL_LOGIN_HORAS`, no se escribe otro. Se apoya en el índice
 * (entity, entityId) y no necesita columnas nuevas.
 *
 * Devuelve `true` si escribió el registro. Nunca lanza.
 */
export async function registrarLogin(
  prisma: DbClient,
  options: { userId: string; email: string; request?: FastifyRequest; ahora?: Date },
): Promise<boolean> {
  try {
    const ahora = options.ahora ?? new Date();
    const desde = new Date(ahora.getTime() - UMBRAL_LOGIN_HORAS * 3_600_000);

    // La llave del umbral es (usuario, IP, user-agent): un token usado desde
    // otro equipo o navegador dentro de la ventana SÍ deja rastro. Los filtros
    // extra se evalúan sobre las filas que ya acota el índice (entity, entityId).
    const ipAddress = options.request?.ip ?? null;
    const userAgent = options.request?.headers["user-agent"] ?? null;
    const reciente = await prisma.auditLog.findFirst({
      where: {
        entity: AUDIT_ENTITIES.user,
        entityId: options.userId,
        action: "LOGIN",
        ipAddress,
        userAgent,
        createdAt: { gte: desde },
      },
      select: { id: true },
    });
    if (reciente) return false;

    await writeAudit(prisma, {
      entity: AUDIT_ENTITIES.user,
      entityId: options.userId,
      action: "LOGIN",
      changedBy: options.email,
      request: options.request,
    });
    return true;
  } catch (err) {
    options.request?.log.error({ err }, "No se pudo registrar el inicio de sesión");
    return false;
  }
}
