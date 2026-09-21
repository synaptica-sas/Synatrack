import Fastify from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { env } from "./config/env.js";
import { registerRoutes } from "./routes/index.js";
import { setAppLogger } from "./infra/logger.js";

function normalizeOrigin(value: string) {
  return value.trim().replace(/\/$/, "");
}

export async function buildApp() {
  const app = Fastify({
    logger: env.NODE_ENV !== "test",
  });

  // Los módulos sin acceso a `request` (notificaciones, alertas, jobs) escriben aquí.
  setAppLogger(app.log);

  // Permitir cuerpos JSON vacíos cuando se envía la cabecera 'Content-Type: application/json'
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    if (!rawBody || rawBody.trim() === "") {
      done(null, undefined);
      return;
    }
    try {
      const json = JSON.parse(rawBody);
      done(null, json);
    } catch (err) {
      done(err as Error);
    }
  });

  const allowAllOrigins = env.CORS_ORIGIN.trim() === "*";
  const allowedOrigins = allowAllOrigins
    ? []
    : env.CORS_ORIGIN.split(",").map(normalizeOrigin).filter(Boolean);

  await app.register(cors, {
    origin: (origin, callback) => {
      if (allowAllOrigins || !origin) {
        callback(null, true);
        return;
      }

      const isAllowed = allowedOrigins.includes(normalizeOrigin(origin));
      callback(null, isAllowed);
    },
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      app.log.warn({ issues: error.issues }, "Error de validación Zod");
      return reply.status(400).send({
        message: "Validation error",
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    // El detalle y la traza van SIEMPRE al log del servidor.
    app.log.error({ err: error }, "Unhandled error");

    // En producción la respuesta no lleva nada del interior: ni mensaje de la
    // excepción ni traza. Fuera de producción sí, porque ayuda a desarrollar.
    if (env.NODE_ENV === "production") {
      return reply.status(500).send({ message: "Internal server error" });
    }

    const detail = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    return reply.status(500).send({ message: "Internal server error", detail, stack });
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({ message: "Route not found" });
  });

  await registerRoutes(app);

  return app;
}
