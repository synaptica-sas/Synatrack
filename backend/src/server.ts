import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./infra/prisma.js";
import { runMaintenanceCycle, startJobsScheduler, stopJobsScheduler } from "./modules/jobs/jobs.service.js";
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

    // Ciclo de mantenimiento al arrancar (asignaciones + alertas). Nunca rechaza:
    // cada trabajo va con su propio try/catch dentro de runMaintenanceCycle.
    void runMaintenanceCycle(prisma, "arranque");

    // Intervalo EN PROCESO. Se arranca aquí y NUNCA en `buildApp()`, para que las
    // pruebas de ruta no dejen temporizadores colgando. Apagado salvo que
    // JOBS_INTERVAL_MINUTES > 0 (ver documentacion/cambios/R8-scheduler.md).
    startJobsScheduler(prisma);

    // Siembra de configuraciones de horas extra: una sola vez por proceso.
    // Antes se ejecutaba en cada petición del módulo de horas extra (DEP-10).
    void ensureDefaultConfigs().catch((e) => app.log.error(e, "[ExtraHoursConfig]"));

    // Apagado ordenado: sin esto, el temporizador mantiene vivo el proceso y
    // Render/Docker terminan matándolo a la fuerza en cada redespliegue.
    for (const senal of ["SIGINT", "SIGTERM"] as const) {
      process.once(senal, () => {
        app.log.info({ senal }, "Señal de apagado recibida; cerrando");
        stopJobsScheduler();
        void app.close().then(() => process.exit(0));
      });
    }
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void main();
