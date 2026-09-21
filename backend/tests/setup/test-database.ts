/**
 * Configuración de la base de datos DEDICADA a las pruebas de ruta.
 *
 * Nunca debe apuntar a `app_gestion_demo` (la base de desarrollo): las pruebas
 * borran filas, y perder los datos locales de trabajo sería inaceptable. El
 * `globalSetup` verifica esta condición antes de tocar nada.
 */

export const TEST_DB_NAME = process.env.TEST_DB_NAME ?? "synatrack_test";

const TEST_DB_HOST = process.env.TEST_DB_HOST ?? "localhost";
const TEST_DB_PORT = process.env.TEST_DB_PORT ?? "5433";
const TEST_DB_USER = process.env.TEST_DB_USER ?? "postgres";
const TEST_DB_PASSWORD = process.env.TEST_DB_PASSWORD ?? "postgres";

/** Base de mantenimiento usada solo para ejecutar `CREATE DATABASE`. */
export const MAINTENANCE_DATABASE_URL =
  `postgresql://${TEST_DB_USER}:${TEST_DB_PASSWORD}@${TEST_DB_HOST}:${TEST_DB_PORT}/postgres?schema=public`;

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  `postgresql://${TEST_DB_USER}:${TEST_DB_PASSWORD}@${TEST_DB_HOST}:${TEST_DB_PORT}/${TEST_DB_NAME}?schema=public`;

export const TEST_DB_HOSTPORT = `${TEST_DB_HOST}:${TEST_DB_PORT}`;
export { TEST_DB_HOST, TEST_DB_PORT };

/** Mensaje único cuando Postgres no responde, para no repetirlo en cada archivo. */
export function postgresNoDisponible(detalle: string) {
  return [
    "",
    "No se pudo conectar a PostgreSQL en " + TEST_DB_HOSTPORT + ".",
    "",
    "Las pruebas de ruta necesitan una base real; NO se saltan en silencio.",
    "Levanta el Postgres portable desde la raíz del repositorio:",
    "",
    "    .\\scripts\\db.ps1 start",
    "",
    "y verifica con `.\\scripts\\db.ps1 status`. Luego vuelve a ejecutar",
    "`npm run test:routes` desde `backend/`.",
    "",
    "Detalle del error: " + detalle,
    "",
  ].join("\n");
}
