import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { invalidateAuthCache } from "../../auth/authCache.js";
import { authenticate } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";

const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(1, "El nombre no puede estar vacío").max(100, "El nombre no puede superar los 100 caracteres"),
  photoUrl: z
    .string()
    .trim()
    .refine((val) => {
      if (!val) return true;
      return val.startsWith("data:") || /^https?:\/\/.+/i.test(val);
    }, "La foto debe ser una URL válida de imagen o un archivo cargado")
    .nullable()
    .optional(),
  bio: z.string().trim().max(1000, "La biografía no puede superar los 1000 caracteres").nullable().optional(),
  phrase: z.string().trim().max(250, "El mantra personal no puede superar los 250 caracteres").nullable().optional(),
  skills: z.array(z.string().max(50, "Cada habilidad no puede superar los 50 caracteres")).optional(),
});

export async function profileRoutes(app: FastifyInstance) {
  // 1. Obtener perfil de usuario autenticado
  app.get(
    "/",
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const authUser = request.authUser!;
      const user = await prisma.user.findUnique({
        where: { email: authUser.email },
      });

      if (!user) {
        return reply.status(404).send({ message: "Usuario no encontrado" });
      }

      return {
        data: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          photoUrl: user.photoUrl,
          bio: user.bio,
          phrase: user.phrase,
          skills: user.skills,
          roles: authUser.roles,
        },
      };
    },
  );

  // 2. Actualizar perfil de usuario
  app.put(
    "/",
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const authUser = request.authUser!;
      const payload = profileUpdateSchema.parse(request.body);

      const user = await prisma.user.findUnique({
        where: { email: authUser.email },
      });

      if (!user) {
        return reply.status(404).send({ message: "Usuario no encontrado" });
      }

      const updated = await prisma.user.update({
        where: { email: authUser.email },
        data: {
          displayName: payload.displayName,
          photoUrl: payload.photoUrl || null,
          bio: payload.bio || null,
          phrase: payload.phrase || null,
          skills: payload.skills || [],
        },
      });

      // displayName viaja en el authUser cacheado.
      invalidateAuthCache(authUser.email);

      return {
        data: {
          id: updated.id,
          email: updated.email,
          displayName: updated.displayName,
          photoUrl: updated.photoUrl,
          bio: updated.bio,
          phrase: updated.phrase,
          skills: updated.skills,
          roles: authUser.roles,
        },
      };
    },
  );
}
