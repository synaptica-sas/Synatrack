import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { variantesDeEntidad } from "../../utils/audit.js";

const querySchema = z.object({
  entity: z.string().optional(),
  entityId: z.string().optional(),
  changedBy: z.string().optional(),
  // Una acción o varias separadas por coma: `?action=LOGIN`, `?action=CREATE,UPDATE`.
  action: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((a) => a.trim()).filter(Boolean) : undefined)),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
});

export async function auditRoutes(app: FastifyInstance) {
  app.get(
    "/",
    // Solo ADMIN y FINANCE (permiso `audit:read`, auth/roles.ts). Un PM no
    // tiene responsabilidad de auditoría general: antes veía la bitácora
    // completa de la empresa, tarifas e identificación de toda la plantilla
    // incluidas.
    { preHandler: [authenticate, authorize([AppRole.ADMIN, AppRole.FINANCE])] },
    async (request) => {
      const query = querySchema.parse(request.query);
      const esAdmin = request.authUser?.roles.includes(AppRole.ADMIN) ?? false;
      const skip = (query.page - 1) * query.pageSize;

      // Filtrar por entidad incluye las variantes históricas (`Project`,
      // `Forecast`) además de la nomenclatura homologada, para que la bitácora
      // anterior a R9 no desaparezca del filtro. Ver
      // `documentacion/cambios/R9-auditoria.md`.
      const where = {
        entity: query.entity ? { in: variantesDeEntidad(query.entity) } : undefined,
        entityId: query.entityId,
        changedBy: query.changedBy,
        // Los LOGIN (con IP y navegador) son datos de seguridad: solo ADMIN. Para el
        // resto se excluyen siempre, así `action=LOGIN` les devuelve vacío.
        action: {
          in: query.action?.length ? query.action : undefined,
          notIn: esAdmin ? undefined : ["LOGIN"],
        },
        createdAt: {
          gte: query.from,
          lte: query.to,
        },
      };

      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: query.pageSize,
        }),
        prisma.auditLog.count({ where }),
      ]);

      return {
        // IP y user-agent identifican el equipo de la persona: solo ADMIN.
        data: esAdmin ? logs : logs.map(({ ipAddress: _ip, userAgent: _ua, ...resto }) => resto),
        meta: {
          total,
          page: query.page,
          pageSize: query.pageSize,
          totalPages: Math.ceil(total / query.pageSize),
        },
      };
    },
  );
}
