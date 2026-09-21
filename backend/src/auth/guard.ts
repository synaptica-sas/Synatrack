import { AppRole, Prisma } from "@prisma/client";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { env } from "../config/env.js";
import { prisma } from "../infra/prisma.js";

/**
 * Crea la relación usuario-rol si no existe. El frontend dispara varias
 * peticiones autenticadas en paralelo (una por cada hook de dominio), y cada
 * una pasa por `authenticate`. Si dos de ellas caen en este mismo instante,
 * una puede chocar contra la restricción única (userId, roleId) -- ya sea
 * porque la otra ya insertó la fila (P2002) o porque la borró justo antes de
 * que esta intentara actualizarla (P2025). En ambos casos se reintenta una
 * vez: si para entonces la fila ya existe, el estado deseado se cumplió y no
 * hay nada más que hacer.
 */
async function ensureUserRole(userId: string, roleId: string, attemptsLeft = 2): Promise<void> {
  try {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId } },
      update: {},
      create: { userId, roleId },
    });
  } catch (err) {
    const isConcurrencyRace =
      err instanceof Prisma.PrismaClientKnownRequestError &&
      (err.code === "P2002" || err.code === "P2025");
    if (!isConcurrencyRace) {
      throw err;
    }
    if (attemptsLeft <= 0) {
      return;
    }
    await ensureUserRole(userId, roleId, attemptsLeft - 1);
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

// --- Simulador de rol para desarrollo ---------------------------------------
// Solo se consulta dentro de la rama de bypass de `authenticate`. Con
// autenticación real (`AUTH_ENABLED=true` y `AUTH_DEMO_BYPASS=false`) este
// código no se ejecuta nunca, así que ni las variables ni los encabezados
// pueden usarse para suplantar a nadie en un entorno autenticado.

export const DEV_EMAIL_HEADER = "x-dev-email";
export const DEV_ROLES_HEADER = "x-dev-roles";

type DemoIdentity = {
  id: string;
  email: string;
  displayName: string;
  roles: AppRole[];
};

function readHeader(request: FastifyRequest, name: string): string | null {
  const raw = request.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Convierte "PM,FINANCE" en roles válidos. Devuelve null si alguno no existe. */
function parseRolesHeader(raw: string): AppRole[] | null {
  const names = raw
    .split(",")
    .map((name) => name.trim().toUpperCase())
    .filter((name) => name !== "");

  if (names.length === 0) {
    return null;
  }

  const roles: AppRole[] = [];
  for (const name of names) {
    if (!(name in AppRole)) {
      return null;
    }
    roles.push(name as AppRole);
  }

  return Array.from(new Set(roles));
}

/**
 * Los encabezados solo se aceptan si el bypass ya está activo (garantizado por
 * quien llama), si el desarrollador los habilitó explícitamente con
 * `AUTH_DEV_ROLE_HEADER=true` y si NO estamos en producción. Tres cerrojos
 * independientes: cualquiera de los tres que falle deja los encabezados inertes.
 */
function headersAllowed() {
  return env.AUTH_DEV_ROLE_HEADER && env.NODE_ENV !== "production";
}

function resolveDemoIdentity(
  request: FastifyRequest,
): { ok: true; identity: DemoIdentity } | { ok: false; message: string } {
  // Identidad base: la de las variables de entorno. Sin ellas, el admin local
  // de siempre (mismo id, correo, nombre y rol que antes de existir el simulador).
  let email = (env.AUTH_DEV_EMAIL ?? env.ADMIN_EMAIL).toLowerCase();
  let roles: AppRole[] = env.AUTH_DEV_ROLES ?? [AppRole.ADMIN];
  let simulated = env.AUTH_DEV_EMAIL !== undefined || env.AUTH_DEV_ROLES !== undefined;

  if (headersAllowed()) {
    const rawRoles = readHeader(request, DEV_ROLES_HEADER);
    if (rawRoles) {
      const parsed = parseRolesHeader(rawRoles);
      if (!parsed) {
        return {
          ok: false,
          message: `El encabezado ${DEV_ROLES_HEADER} trae roles no válidos. Valores aceptados: ${Object.values(AppRole).join(", ")}.`,
        };
      }
      roles = parsed;
      simulated = true;
    }

    const rawEmail = readHeader(request, DEV_EMAIL_HEADER);
    if (rawEmail) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
        return {
          ok: false,
          message: `El encabezado ${DEV_EMAIL_HEADER} debe contener un correo válido.`,
        };
      }
      email = rawEmail.toLowerCase();
      simulated = true;
    }
  }

  return {
    ok: true,
    identity: simulated
      ? {
          id: `local-sim:${email}`,
          email,
          displayName: `Simulación (${roles.join(", ")})`,
          roles,
        }
      : {
          id: "local-admin",
          email,
          displayName: "Local Admin",
          roles,
        },
  };
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  if (!env.AUTH_ENABLED || env.AUTH_DEMO_BYPASS) {
    const resolved = resolveDemoIdentity(request);
    if (!resolved.ok) {
      return reply.status(400).send({ message: resolved.message });
    }

    request.authUser = resolved.identity;
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
    request.log.warn(
      { reason: err instanceof Error ? err.name : "unknown" },
      "Token de Microsoft rechazado",
    );
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

      // El frontend dispara varias peticiones autenticadas en paralelo, y
      // todas pasan por aquí. Si los roles en la BD ya coinciden con los del
      // token, no tocamos la tabla -- evita el borrar-y-recrear (y su
      // condición de carrera) en el 100% de las peticiones normales; solo se
      // ejecuta de verdad cuando los roles cambiaron desde el último login.
      const currentRoleNames = user.roles.map((entry) => entry.role.name);
      const rolesAlreadyInSync =
        currentRoleNames.length === uniqueRoles.length &&
        uniqueRoles.every((role) => currentRoleNames.includes(role));

      if (!rolesAlreadyInSync) {
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
      request.log.error({ err }, "Falló la sincronización JIT de consultor en el login");
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
