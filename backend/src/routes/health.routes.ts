import type { FastifyInstance } from "fastify";
import { prisma } from "../infra/prisma.js";
import { getLogger } from "../infra/logger.js";
import { obtenerFrescura } from "../modules/jobs/job-runs.service.js";
import type { FrescuraTrabajos } from "../utils/job-freshness.js";

/**
 * Lo que `/health` publica de cada trabajo. Es un endpoint SIN autenticación
 * (lo consulta Render), así que va deliberadamente recortado: el estado y los
 * tiempos bastan para saber si algo dejó de correr, mientras que el mensaje de
 * error puede arrastrar detalle interno (rutas, cadenas de conexión, mensajes
 * crudos de Prisma). El error completo se consulta en `GET /api/jobs/status`,
 * que exige ADMIN o el token compartido.
 */
type FrescuraPublica = {
  estado: FrescuraTrabajos["estado"];
  trabajos: {
    nombre: string;
    estado: FrescuraTrabajos["trabajos"][number]["estado"];
    ultimoIntentoEn: string | null;
    ultimoExitoEn: string | null;
    antiguedadExitoSegundos: number | null;
    toleranciaSegundos: number;
  }[];
};

function sinDetallesInternos(frescura: FrescuraTrabajos): FrescuraPublica {
  return {
    estado: frescura.estado,
    trabajos: frescura.trabajos.map((trabajo) => ({
      nombre: trabajo.nombre,
      estado: trabajo.estado,
      ultimoIntentoEn: trabajo.ultimoIntentoEn,
      ultimoExitoEn: trabajo.ultimoExitoEn,
      antiguedadExitoSegundos: trabajo.antiguedadExitoSegundos,
      toleranciaSegundos: trabajo.toleranciaSegundos,
    })),
  };
}

export async function healthRoutes(app: FastifyInstance) {
  const payload = async () => {
    let db: "up" | "down" = "up";

    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      db = "down";
    }

    // Frescura de los trabajos periódicos.
    //
    // DELIBERADAMENTE NO entra en `ok`. Render consulta este endpoint cada pocos
    // segundos y reinicia el servicio cuando devuelve 503: un trabajo obsoleto
    // no se arregla reiniciando, así que devolver 503 por eso solo produciría un
    // bucle de reinicios. Se informa, no se tumba. Quien quiera alertar sobre
    // ello debe mirar `jobs.estado`, no el código HTTP.
    //
    // Si la base está caída ni se intenta: el 503 ya lo decide `db`.
    let jobs: FrescuraPublica | { estado: "desconocido" } = { estado: "desconocido" };
    if (db === "up") {
      try {
        jobs = sinDetallesInternos(await obtenerFrescura(prisma));
      } catch (err) {
        // La observabilidad jamás puede degradar el chequeo de salud.
        getLogger().error({ err }, "[Health] No se pudo calcular la frescura de los trabajos");
      }
    }

    return {
      ok: db === "up",
      service: "app-gestion-backend",
      database: db,
      jobs,
      timestamp: new Date().toISOString(),
    };
  };

  app.get("/", async () => {
    return payload();
  });

  app.get("/health", async (_request, reply) => {
    const status = await payload();
    if (!status.ok) {
      return reply.status(503).send(status);
    }

    return status;
  });
}
