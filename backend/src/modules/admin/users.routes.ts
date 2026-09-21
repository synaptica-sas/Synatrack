import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorize } from "../../auth/guard.js";
import { prisma } from "../../infra/prisma.js";
import { AUDIT_ENTITIES, writeAudit } from "../../utils/audit.js";

import { normalizeCountry } from "../../utils/country.js";

const userPayloadSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  displayName: z.string().trim().min(1),
  microsoftOid: z.string().trim().min(1).optional(),
  active: z.coerce.boolean().default(true),
  roles: z.array(z.nativeEnum(AppRole)).min(1),
  country: z.string().trim().nullish().transform(val => val ? normalizeCountry(val) : "Default"),
});

const userUpdateSchema = z.object({
  displayName: z.string().trim().min(1).optional(),
  microsoftOid: z.string().trim().min(1).optional(),
  active: z.coerce.boolean().optional(),
  roles: z.array(z.nativeEnum(AppRole)).min(1).optional(),
  country: z.string().trim().nullish().transform(val => val ? normalizeCountry(val) : "Default"),
});

const paramsSchema = z.object({ id: z.string().min(1) });

/** Tipo mínimo para construir la instantánea de auditoría de un usuario. */
type UsuarioConRoles = {
  id: string;
  email: string;
  displayName: string;
  microsoftOid: string | null;
  active: boolean;
  country: string | null;
  roles: { role: { name: string } }[];
};

/**
 * Instantánea plana del usuario para la bitácora. Aplana los roles a un arreglo
 * de nombres para que el `diff` muestre el cambio de permisos de forma legible
 * ("roles: [CONSULTANT] -> [ADMIN]") en vez de una lista de filas `UserRole`.
 */
function instantaneaUsuario(user: UsuarioConRoles): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    microsoftOid: user.microsoftOid,
    active: user.active,
    country: user.country,
    roles: user.roles.map((item) => item.role.name).sort(),
  };
}

async function ensureRoles() {
  await Promise.all(
    Object.values(AppRole).map((role) =>
      prisma.role.upsert({
        where: { name: role },
        update: {},
        create: { name: role },
      }),
    ),
  );
}

export async function adminUsersRoutes(app: FastifyInstance) {
  app.get(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN])],
    },
    async () => {
      const users = await prisma.user.findMany({
        include: {
          roles: {
            include: {
              role: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      return {
        data: users.map((user) => ({
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          microsoftOid: user.microsoftOid,
          active: user.active,
          roles: user.roles.map((item) => item.role.name),
          country: user.country,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        })),
      };
    },
  );

  app.post(
    "/",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN])],
    },
    async (request, reply) => {
      await ensureRoles();
      const payload = userPayloadSchema.parse(request.body);

      const existing = await prisma.user.findUnique({ where: { email: payload.email } });
      if (existing) {
        return reply.status(409).send({ message: "User email already exists" });
      }

      const roleRecords = await prisma.role.findMany({
        where: {
          name: { in: payload.roles },
        },
      });

      const user = await prisma.user.create({
        data: {
          email: payload.email,
          displayName: payload.displayName,
          microsoftOid: payload.microsoftOid,
          active: payload.active,
          country: payload.country,
          roles: {
            create: roleRecords.map((role) => ({
              roleId: role.id,
            })),
          },
        },
        include: {
          roles: {
            include: {
              role: true,
            },
          },
        },
      });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.user,
        entityId: user.id,
        action: "CREATE",
        changedBy: request.authUser!.email,
        after: instantaneaUsuario(user),
        request,
      });

      return reply.status(201).send({
        data: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          microsoftOid: user.microsoftOid,
          active: user.active,
          roles: user.roles.map((item) => item.role.name),
          country: user.country,
        },
      });
    },
  );

  app.patch(
    "/:id",
    {
      preHandler: [authenticate, authorize([AppRole.ADMIN])],
    },
    async (request, reply) => {
      await ensureRoles();
      const { id } = paramsSchema.parse(request.params);
      const payload = userUpdateSchema.parse(request.body);

      // Se traen también los roles porque son el dato que más importa auditar
      // aquí: cambiarlos es cambiar permisos.
      const user = await prisma.user.findUnique({
        where: { id },
        include: { roles: { include: { role: true } } },
      });
      if (!user) {
        return reply.status(404).send({ message: "User not found" });
      }

      const antes = instantaneaUsuario(user);

      if (payload.roles) {
        const roleRecords = await prisma.role.findMany({
          where: {
            name: { in: payload.roles },
          },
        });

        await prisma.userRole.deleteMany({ where: { userId: id } });
        await prisma.userRole.createMany({
          data: roleRecords.map((role) => ({
            userId: id,
            roleId: role.id,
          })),
          skipDuplicates: true,
        });
      }

      const updated = await prisma.user.update({
        where: { id },
        data: {
          displayName: payload.displayName,
          microsoftOid: payload.microsoftOid,
          active: payload.active,
          country: payload.country,
        },
        include: {
          roles: {
            include: {
              role: true,
            },
          },
        },
      });

      await writeAudit(prisma, {
        entity: AUDIT_ENTITIES.user,
        entityId: updated.id,
        action: "UPDATE",
        changedBy: request.authUser!.email,
        before: antes,
        after: instantaneaUsuario(updated),
        request,
      });

      return {
        data: {
          id: updated.id,
          email: updated.email,
          displayName: updated.displayName,
          microsoftOid: updated.microsoftOid,
          active: updated.active,
          roles: updated.roles.map((item) => item.role.name),
          country: updated.country,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        },
      };
    },
  );
}
