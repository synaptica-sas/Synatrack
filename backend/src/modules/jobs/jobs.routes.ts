import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { permitirTokenCompartidoOSesion } from "../../auth/shared-token.js";
import { env } from "../../config/env.js";
import { prisma } from "../../infra/prisma.js";
import { hayCicloEnCurso, runMaintenanceCycle } from "./jobs.service.js";

export async function jobsRoutes(app: FastifyInstance) {
  // POST /api/jobs/run — dispara un ciclo de mantenimiento (asignaciones + alertas).
  //
  // Misma doble puerta que POST /api/fx/sync:
  //  1) Token compartido (Authorization: Bearer <JOBS_RUN_TOKEN>) — para el
  //     Render Cron Job, que no tiene sesión de usuario.
  //  2) Sesión normal con rol ADMIN — para dispararlo a mano.
  //
  // Responde 200 siempre que la petición esté autorizada, incluso si el ciclo se
  // omitió por solapamiento: para el cron eso no es un fallo y `curl -sf` no
  // debe darse por caído.
  app.post("/run", async (request, reply) => {
    const autorizado = await permitirTokenCompartidoOSesion(request, reply, {
      token: env.JOBS_RUN_TOKEN,
      roles: [AppRole.ADMIN],
    });
    if (!autorizado) return;

    const resultado = await runMaintenanceCycle(prisma, "http");
    return reply.status(200).send({ data: resultado });
  });

  // GET /api/jobs/status — estado del planificador. Sirve para comprobar en un
  // entorno desplegado si el intervalo en proceso está encendido y con qué cadencia.
  app.get("/status", async (request, reply) => {
    const autorizado = await permitirTokenCompartidoOSesion(request, reply, {
      token: env.JOBS_RUN_TOKEN,
      roles: [AppRole.ADMIN],
    });
    if (!autorizado) return;

    return reply.status(200).send({
      data: {
        intervaloMinutos: env.JOBS_INTERVAL_MINUTES,
        intervaloActivo: env.JOBS_INTERVAL_MINUTES > 0,
        cicloEnCurso: hayCicloEnCurso(),
        tokenConfigurado: Boolean(env.JOBS_RUN_TOKEN),
      },
    });
  });
}
