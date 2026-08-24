import { AppRole, Prisma } from "@prisma/client";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { env } from "../config/env.js";
import { prisma } from "../infra/prisma.js";

/**
 * Crea la relación usuario-rol si no existe. Si dos peticiones concurrentes
 * (p. ej. dos llamadas del frontend justo después del login) intentan crear
 * la misma asignación al mismo tiempo, una de las dos puede chocar contra la
 * restricción única (userId, roleId) incluso usando upsert. En ese caso el
 * estado deseado ya se cumplió (la fila existe), así que se ignora el error.
 */
async function ensureUserRole(userId: string, roleId: string) {
  try {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId } },
      update: {},
      create: { userId, roleId },
    });
  } catch (err) {
    const isDuplicateRoleAssignment =
      err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
    if (!isDuplicateRoleAssignment) {
      throw err;
    }
  }
}

type MicrosoftClaims = JWTPayload & {
  oid?: string;
  preferred_username?: string;
  email?: string;
  upn?: string;
  name?: string;
};

const issuerV2 = `https://login.microsoftonline.com/${env.AZURE_AD_TENANT_ID}/v2.0`;
const issuerV1 = `https://sts.windows.net/${env.AZURE_AD_TENANT_ID}/`;

const jwks = createRemoteJWKSet(
  new URL(`https://login.microsoftonline.com/${env.AZURE_AD_TENANT_ID}/discovery/v2.0/keys`),
);

function getBearerToken(request: FastifyRequest) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  return authHeader.slice("Bearer ".length).trim();
}

async function verifyMicrosoftToken(token: string) {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: [issuerV2, issuerV1],
    audience: env.AZURE_AD_AUDIENCE,
  });

  return payload as MicrosoftClaims;
}

function resolveEmail(payload: MicrosoftClaims) {
  return payload.preferred_username || payload.email || payload.upn || null;
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  if (!env.AUTH_ENABLED || env.AUTH_DEMO_BYPASS) {
    request.authUser = {
      id: "local-admin",
      email: env.ADMIN_EMAIL.toLowerCase(),
      displayName: "Local Admin",
      roles: [AppRole.ADMIN],
    };
    return;
  }

  const token = getBearerToken(request);
  if (!token) {
    return reply.status(401).send({ message: "Missing bearer token" });
  }

  let claims: MicrosoftClaims;
  try {
    claims = await verifyMicrosoftToken(token);
  } catch (err) {
    console.error("DEBUG: Token verification failed:", err);
    return reply.status(401).send({ message: "Invalid Microsoft token" });
  }

  const email = resolveEmail(claims)?.toLowerCase();
  if (!email) {
    return reply.status(401).send({ message: "Token does not include a valid email" });
  }

  // JIT Provisioning: Buscar o crear dinámicamente al usuario
  let user = await prisma.user.findUnique({
    where: { email },
    include: {
      roles: {
        include: {
          role: true,
        },
      },
    },
  });

  if (!user) {
    const countryMap: Record<string, string> = {
      CO: "Colombia",
      PE: "Peru",
      CL: "Chile",
      MX: "Mexico",
      EC: "Ecuador",
      AR: "Argentina",
      ES: "España",
      US: "Default",
    };
    const rawCountry = (claims.ctry as string) || (claims.country as string) || "CO";
    const mappedCountry = countryMap[rawCountry.toUpperCase()] || "Default";

    // Si no existe, crearlo automáticamente
    user = await prisma.user.create({
      data: {
        email,
        displayName: claims.name || email.split("@")[0],
        active: true,
        country: mappedCountry,
      },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
    });
  }

  if (!user.active) {
    return reply.status(403).send({
      message: "Tu usuario esta inactivo. Contacta a un administrador.",
    });
  }

  // Sincronizar roles desde el token:
  // Si vienen definidos explícitamente en el token de Azure AD, sincronizamos siempre (Azure AD como origen de verdad).
  const hasTokenRoles = claims.roles && Array.isArray(claims.roles) && claims.roles.length > 0;
  const localRolesCount = await prisma.userRole.count({
    where: { userId: user.id },
  });

  if (hasTokenRoles) {
    const tokenRoles: AppRole[] = [];
    for (const roleName of claims.roles as string[]) {
      let appRole = roleName.toUpperCase();
      if (appRole === "NOMINA") {
        appRole = "FINANCE";
      }
      if (appRole in AppRole) {
        tokenRoles.push(appRole as AppRole);
      }
    }

    if (tokenRoles.length > 0) {
      // Deduplicar: Azure AD puede repetir el mismo rol si el usuario lo tiene
      // asignado por más de un camino (directo + grupo, o varios grupos).
      const uniqueRoles = Array.from(new Set(tokenRoles));

      // Limpiar roles actuales de la DB para este usuario
      await prisma.userRole.deleteMany({
        where: { userId: user.id },
      });

      // Insertar nuevos roles desde el token
      for (const appRole of uniqueRoles) {
        const roleObj = await prisma.role.upsert({
          where: { name: appRole },
          update: {},
          create: { name: appRole },
        });

        await ensureUserRole(user.id, roleObj.id);
      }
    }
  } else if (localRolesCount === 0) {
    // Si no vienen roles en el token y el usuario local no tiene ningún rol, le damos CONSULTANT por defecto
    const consultantRole = await prisma.role.upsert({
      where: { name: AppRole.CONSULTANT },
      update: {},
      create: { name: AppRole.CONSULTANT },
    });

    await ensureUserRole(user.id, consultantRole.id);
  }

  // Regla especial de seguridad: Garantizar que el correo configurado en ADMIN_EMAIL siempre tenga el rol ADMIN local
  if (email === env.ADMIN_EMAIL.toLowerCase()) {
    const adminRoleObj = await prisma.role.upsert({
      where: { name: AppRole.ADMIN },
      update: {},
      create: { name: AppRole.ADMIN },
    });

    await ensureUserRole(user.id, adminRoleObj.id);
  }

  // Obtener los roles actualizados desde la base de datos
  const userWithRoles = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    include: {
      roles: {
        include: {
          role: true,
        },
      },
    },
  });

  const roles = userWithRoles.roles.map((item) => item.role.name);
  if (roles.length === 0) {
    return reply.status(403).send({
      message: "Tu usuario no tiene roles asignados. Contacta a un administrador.",
    });
  }

  // JIT sincronización: Si el usuario tiene rol CONSULTANT, asegurar que exista su correspondiente consultor en la base de datos
  if (roles.includes(AppRole.CONSULTANT)) {
    try {
      const existingConsultant = await prisma.consultant.findFirst({
        where: { email: { equals: userWithRoles.email, mode: "insensitive" } },
      });
      if (!existingConsultant) {
        await prisma.consultant.create({
          data: {
            fullName: userWithRoles.displayName,
            email: userWithRoles.email,
            role: "Consultor",
            hourlyRate: 0,
            rateCurrency: "USD",
            country: userWithRoles.country || "Colombia",
            active: userWithRoles.active,
            allowWeekendWork: false,
          },
        });
      }
    } catch (err) {
      console.error("Failed to run JIT consultant sync on login:", err);
    }
  }

  request.authUser = {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    roles,
  };
}

export function authorize(allowedRoles: AppRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.authUser;
    if (!user) {
      return reply.status(401).send({ message: "Not authenticated" });
    }

    const hasRole = user.roles.some((role) => allowedRoles.includes(role));
    if (!hasRole) {
      return reply.status(403).send({ message: "Insufficient permissions" });
    }
  };
}
