import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./infra/prisma.js";
import { runAssignmentMaintenance } from "./modules/assignments/assignments.job.js";
import { runAlertEngine } from "./modules/alerts/alerts.service.js";
import { ensureDefaultConfigs } from "./modules/extra-hours/extra-hours.routes.js";

async function main() {
  const app = await buildApp();

  try {
    await app.listen({
      host: "0.0.0.0",
      port: env.PORT,
    });
    app.log.info(`Backend listening on http://localhost:${env.PORT}`);

    // El simulador de rol permite entrar como cualquiera sin autenticarse. Está
    // protegido por tres cerrojos, pero si alguien lo deja encendido por error
    // conviene que se vea en el log de arranque y no pase inadvertido.
    if ((!env.AUTH_ENABLED || env.AUTH_DEMO_BYPASS) && env.AUTH_DEV_ROLE_HEADER) {
      app.log.warn(
        "ATENCIÓN: el simulador de rol por encabezado (AUTH_DEV_ROLE_HEADER) está ACTIVO. " +
          "Cualquiera puede elegir su rol enviando x-dev-roles. Úsalo solo en desarrollo local.",
      );
    }

    // Ejecutar jobs de mantenimiento al iniciar
    void runAssignmentMaintenance(prisma).catch((e) => app.log.error(e, "[AssignmentJob]"));
    void runAlertEngine(prisma).catch((e) => app.log.error(e, "[AlertEngine]"));

    // Siembra de configuraciones de horas extra: una sola vez por proceso.
    // Antes se ejecutaba en cada petición del módulo de horas extra (DEP-10).
    void ensureDefaultConfigs().catch((e) => app.log.error(e, "[ExtraHoursConfig]"));
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void main();
