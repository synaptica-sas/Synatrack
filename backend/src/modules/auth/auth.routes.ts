import { resolvePermissions, rolePermissions } from "../../auth/roles.js";
import { authenticate } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import type { FastifyInstance } from "fastify";

export async function authRoutes(app: FastifyInstance) {
  app.get(
    "/me",
    {
      preHandler: [authenticate],
    },
    async (request) => {
      const user = request.authUser!;
      const dbUser = await prisma.user.findUnique({
        where: { email: user.email },
      });
      return {
        data: {
          id: dbUser?.id || user.id,
          email: user.email,
          displayName: dbUser?.displayName || user.displayName,
          photoUrl: dbUser?.photoUrl || null,
          bio: dbUser?.bio || null,
          phrase: dbUser?.phrase || null,
          roles: user.roles,
          permissions: resolvePermissions(user.roles),
        },
      };
    },
  );

  /**
   * Matriz completa de permisos por rol, tal como la define `auth/roles.ts`.
   *
   * La consume el simulador de rol del frontend (el selector "VISTA" que ven
   * los administradores) para previsualizar la interfaz como otro rol sin
   * mantener una segunda copia escrita a mano (DEP-15).
   *
   * Importante: esto es solo presentación. Los permisos reales del backend los
   * imponen los `authorize([AppRole...])` de cada ruta, que no cambian porque
   * el administrador mueva el selector.
   */
  app.get(
    "/permissions",
    {
      preHandler: [authenticate],
    },
    async () => {
      return { data: rolePermissions };
    },
  );
}
