import type { AppRole } from "@prisma/client";
import type { FastifyReply, FastifyRequest } from "fastify";
import { authenticate, authorize } from "./guard.js";

/**
 * Doble puerta de acceso para endpoints que dispara un cron externo.
 *
 * Los Cron Jobs de Render no tienen sesión de usuario, así que se autentican con
 * un token compartido en `Authorization: Bearer <token>`. Las mismas rutas deben
 * seguir siendo llamables desde el frontend por un usuario con el rol adecuado.
 *
 * El patrón nació en POST /api/fx/sync; aquí está extraído para que
 * POST /api/jobs/run lo reutilice en vez de duplicarlo.
 *
 * @returns `true` si la petición puede continuar; `false` si ya se respondió
 *          (401 sin sesión ni token válido, 403 con rol insuficiente).
 */
export async function permitirTokenCompartidoOSesion(
  request: FastifyRequest,
  reply: FastifyReply,
  options: { token: string | undefined; roles: AppRole[] },
): Promise<boolean> {
  if (esTokenDelSistema(request, options.token)) {
    return true;
  }

  await authenticate(request, reply);
  if (reply.sent) return false;

  await authorize(options.roles)(request, reply);
  if (reply.sent) return false;

  return true;
}

/** Extrae el bearer del encabezado y lo compara con el token configurado. */
function esTokenDelSistema(request: FastifyRequest, token: string | undefined): boolean {
  if (!token) return false;

  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return false;

  return authHeader.slice("Bearer ".length).trim() === token;
}
