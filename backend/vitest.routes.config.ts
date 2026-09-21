import { defineConfig } from "vitest/config";
import { TEST_DATABASE_URL } from "./tests/setup/test-database.js";

/**
 * Configuración SEPARADA para las pruebas de ruta (`npm run test:routes`).
 *
 * Están fuera de `src/` a propósito: `vitest.config.ts` recolecta únicamente
 * `src/**` , así que `npm test` sigue reportando solo las pruebas unitarias
 * (153) y estas no se le mezclan. Además necesitan una base de datos real y
 * tardan bastante más, por lo que conviene poder correrlas por separado.
 */
export default defineConfig({
  test: {
    include: ["tests/routes/**/*.test.ts"],
    globalSetup: ["tests/setup/global-setup.ts"],
    // Comparten una misma base de datos: nada de archivos en paralelo.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: "test",
      // Base DEDICADA a pruebas; nunca `app_gestion_demo`.
      DATABASE_URL: TEST_DATABASE_URL,
      DIRECT_URL: TEST_DATABASE_URL,
      // Modo demo + simulador de rol por encabezado, para poder cambiar de rol
      // petición a petición sin levantar un servidor por cada caso.
      AUTH_ENABLED: "false",
      AUTH_DEMO_BYPASS: "true",
      AUTH_DEV_ROLE_HEADER: "true",
      ADMIN_EMAIL: "admin@synaptica.local",
    },
  },
});
