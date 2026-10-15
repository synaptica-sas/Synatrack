import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";

/**
 * Catálogo de categorías de proyecto (R-010). Solo lectura: no hay pantalla de
 * administración propia. Una categoría nueva se agrega sola al catálogo
 * cuando se escribe en el formulario de un proyecto — ver
 * `resolverOInsertarCategoria` en `projects.routes.ts` —, así que no hace
 * falta un endpoint de escritura aparte.
 */
export async function projectCategoriesRoutes(app: FastifyInstance) {
  // GET /api/project-categories
  app.get(
    "/",
    {
      preHandler: [
        authenticate,
        authorize([AppRole.ADMIN, AppRole.PM, AppRole.CONSULTANT, AppRole.FINANCE, AppRole.VIEWER]),
      ],
    },
    async () => {
      const categorias = await prisma.projectCategory.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      });
      return { data: categorias };
    },
  );
}
