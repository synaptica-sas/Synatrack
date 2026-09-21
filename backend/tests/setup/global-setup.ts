import { execFileSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import {
  MAINTENANCE_DATABASE_URL,
  TEST_DATABASE_URL,
  TEST_DB_HOST,
  TEST_DB_NAME,
  TEST_DB_PORT,
  postgresNoDisponible,
} from "./test-database.js";

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Comprueba que hay algo escuchando en el puerto antes de intentar hablar Postgres. */
function esperarPuerto(host: string, port: number, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const fallar = (err: Error) => {
      socket.destroy();
      reject(new Error(err.message || err.name || "conexión rechazada"));
    };
    socket.setTimeout(timeoutMs);
    socket.once("error", fallar);
    socket.once("timeout", () => fallar(new Error(`timeout de ${timeoutMs} ms`)));
    socket.connect(port, host, () => {
      socket.end();
      resolve();
    });
  });
}

async function crearBaseSiNoExiste() {
  const admin = new PrismaClient({ datasourceUrl: MAINTENANCE_DATABASE_URL });
  try {
    // `CREATE DATABASE` no admite parámetros ni correr dentro de una transacción.
    // El nombre viene de nuestra propia configuración, no de entrada de usuario.
    await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB_NAME}"`);
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    // 42P04 = duplicate_database. Que ya exista es el caso normal.
    if (!/42P04|already exists|ya existe/i.test(mensaje)) {
      throw err;
    }
  } finally {
    await admin.$disconnect();
  }
}

export async function setup() {
  // Cerrojo de seguridad: jamás correr contra la base de desarrollo.
  if (/app_gestion_demo/.test(TEST_DATABASE_URL)) {
    throw new Error(
      "TEST_DATABASE_URL apunta a `app_gestion_demo`, la base de DESARROLLO. " +
        "Las pruebas de ruta borran datos: usa una base dedicada (por ejemplo `synatrack_test`).",
    );
  }

  try {
    await esperarPuerto(TEST_DB_HOST, Number(TEST_DB_PORT));
  } catch (err) {
    throw new Error(postgresNoDisponible(err instanceof Error ? err.message : String(err)));
  }

  try {
    await crearBaseSiNoExiste();
  } catch (err) {
    throw new Error(postgresNoDisponible(err instanceof Error ? err.message : String(err)));
  }

  // Migraciones sobre la base de pruebas. `migrate deploy` es idempotente.
  try {
    // Se invoca el CLI de Prisma por su entrypoint de Node en vez de `npx`:
    // en Windows, `npx.cmd` exige `shell: true` desde Node 20 y eso complica el
    // escapado. Así es un proceso Node normal en cualquier sistema operativo.
    const prismaCli = path.join(backendDir, "node_modules", "prisma", "build", "index.js");
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
      cwd: backendDir,
      stdio: "pipe",
      env: {
        ...process.env,
        DATABASE_URL: TEST_DATABASE_URL,
        DIRECT_URL: TEST_DATABASE_URL,
      },
    });
  } catch (err) {
    const salida =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr?: Buffer }).stderr ?? "")
        : String(err);
    throw new Error(
      `Falló \`prisma migrate deploy\` contra la base de pruebas ${TEST_DB_NAME}.\n${salida}`,
    );
  }
}
