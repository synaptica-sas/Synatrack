import type { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";

/** Levanta la app real (mismas rutas, mismos guards) para usarla con `inject()`. */
export async function crearAppDePrueba(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}

/**
 * Encabezados del simulador de rol. Requieren `AUTH_DEV_ROLE_HEADER=true`
 * (lo pone `vitest.routes.config.ts`) y modo demo.
 */
export function comoRol(roles: AppRole[] | AppRole, email?: string) {
  const lista = Array.isArray(roles) ? roles : [roles];
  const headers: Record<string, string> = { "x-dev-roles": lista.join(",") };
  if (email) {
    headers["x-dev-email"] = email;
  }
  return headers;
}
