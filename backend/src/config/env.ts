import "dotenv/config";
import { AppRole } from "@prisma/client";
import { z } from "zod";
import { AUDIENCIA_POR_DEFECTO, parseAudiences } from "../auth/audience.js";
import { parseTrustProxy } from "../utils/clientIp.js";

/**
 * Las variables de entorno llegan siempre como cadena. Una variable "presente pero
 * vacía" (`FOO=` en el .env) debe tratarse como ausente, no como cadena vacía, para
 * que los valores por defecto sigan aplicando.
 */
const optionalString = z
  .string()
  .trim()
  .transform((value) => (value === "" ? undefined : value))
  .optional();

/**
 * Lista de roles separados por coma, p. ej. `CONSULTANT` o `PM,FINANCE`.
 * Se normaliza a mayúsculas y se valida contra el enum `AppRole` de Prisma, así
 * que un rol mal escrito hace fallar el arranque en vez de degradar en silencio.
 */
const devRolesSchema = optionalString
  .transform((value) =>
    value === undefined
      ? undefined
      : value
          .split(",")
          .map((role) => role.trim().toUpperCase())
          .filter((role) => role !== ""),
  )
  .pipe(
    z
      .array(
        z.enum(AppRole, {
          error: `AUTH_DEV_ROLES solo acepta roles de AppRole (${Object.values(AppRole).join(", ")})`,
        }),
      )
      .min(1, "AUTH_DEV_ROLES no puede quedar vacía si se define")
      .optional(),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().min(1).default("http://localhost:5173"),
  // Peticiones por IP y minuto. Configurable para poder relajarlo si una
  // oficina con NAT empieza a chocar contra el limite.
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  // Proxies inversos de confianza delante del proceso, para que `request.ip`
  // (límite de peticiones y bitácora de auditoría) sea la IP real del cliente.
  // Acepta `false` (por defecto: comportamiento histórico, la IP es la del
  // proxy), `true`, un número de saltos o una lista de IPs/CIDR (ver
  // `utils/clientIp.ts`). En Azure App Service: `1` (un solo front end, que
  // añade la IP del cliente a X-Forwarded-For).
  TRUST_PROXY: optionalString.transform(parseTrustProxy),
  DATABASE_URL: z.string().min(1),
  // Conexión directa (no pooled) que Prisma usa para `migrate`. Es OPCIONAL a propósito:
  // en runtime la API solo necesita DATABASE_URL, y hay entornos (local, Docker, CI) donde
  // DIRECT_URL no se define. Hacerla obligatoria dejaría al servidor sin arrancar en esos
  // entornos. Lo que sí se valida ahora es su forma: si está presente debe ser una URL
  // postgres válida, así que una cadena mal puesta falla al arrancar y no recién al migrar.
  DIRECT_URL: z
    .string()
    .url("DIRECT_URL debe ser una URL de conexión válida (postgresql://...)")
    .refine((value) => value.startsWith("postgres://") || value.startsWith("postgresql://"), {
      message: "DIRECT_URL debe empezar por postgres:// o postgresql://",
    })
    .optional(),
  AUTH_ENABLED: z.preprocess((val) => val === "true" || val === "1" || val === true, z.boolean()).default(false),
  AUTH_DEMO_BYPASS: z.preprocess((val) => val === "true" || val === "1" || val === true, z.boolean()).default(false),
  AZURE_AD_TENANT_ID: z.string().min(1).default("common"),
  // Una o varias audiencias separadas por coma (ver `auth/audience.ts`): con
  // tokens v2 `aud` es el client id (GUID), con v1 el App ID URI. Llega a
  // `jwtVerify` como arreglo; vacía o sin definir, el valor por defecto.
  AZURE_AD_AUDIENCE: optionalString.transform((value) => {
    const audiencias = parseAudiences(value);
    return audiencias.length > 0 ? audiencias : [AUDIENCIA_POR_DEFECTO];
  }),
  ADMIN_EMAIL: z.string().email().default("admin@synaptica.local"),
  // Vacías (`SUPPORT_EMAIL=`) cuentan como no definidas: antes una app setting
  // vacía hacía fallar el arranque. Sin valor, los correos van a ADMIN_EMAIL.
  SUPPORT_EMAIL: optionalString.pipe(z.string().email("SUPPORT_EMAIL debe ser un correo válido").optional()),
  PAYROLL_EMAIL: optionalString.pipe(z.string().email("PAYROLL_EMAIL debe ser un correo válido").optional()),
  FX_SYNC_TOKEN: z.string().min(1).optional(),

  // --- Trabajos periódicos de mantenimiento (POST /api/jobs/run) --------------
  // Token compartido que usa el cron externo (Render Cron Job) para disparar el
  // ciclo de mantenimiento sin sesión de usuario. Mismo patrón que FX_SYNC_TOKEN,
  // pero token propio para poder rotarlo por separado. Sin definir, la ruta solo
  // acepta sesiones con rol ADMIN.
  JOBS_RUN_TOKEN: optionalString,
  // Minutos entre ciclos del intervalo EN PROCESO. `0` (por defecto) lo deja
  // apagado, que es lo correcto en Render free: el servicio se duerme y el cron
  // externo es quien despierta y dispara. Póngalo > 0 en instalaciones que estén
  // siempre despiertas (Docker, on-premise, plan de pago). Máximo 1440 (un día).
  JOBS_INTERVAL_MINUTES: z.coerce
    .number()
    .int("JOBS_INTERVAL_MINUTES debe ser un número entero de minutos")
    .min(0, "JOBS_INTERVAL_MINUTES no puede ser negativa")
    .max(1440, "JOBS_INTERVAL_MINUTES no puede superar 1440 (24 h)")
    .default(0),
  // Incluye la sincronización diaria de tasas FX en el ciclo de mantenimiento
  // (con compuerta: como mucho una sincronización correcta por día UTC). En
  // Render va apagado porque la dispara su propio cron (`app-gestion-fx-sync`);
  // en Azure, donde no existe ese cron, se enciende. Encenderlo con el cron
  // activo es seguro: la compuerta ve la sincronización del cron y no repite.
  FX_SYNC_IN_CYCLE: z
    .preprocess((val) => val === "true" || val === "1" || val === true, z.boolean())
    .default(false),

  // --- Simulador de rol para desarrollo ---------------------------------------
  // Solo tienen efecto cuando el bypass de demo ya está activo
  // (`!AUTH_ENABLED || AUTH_DEMO_BYPASS`). Con autenticación real de Entra ID se
  // ignoran por completo: la decisión se toma en `src/auth/guard.ts`, dentro de la
  // rama de bypass, nunca fuera de ella.
  // Detalle de uso en `documentacion/DESARROLLO_LOCAL.md`.

  // Correo con el que entrar en modo demo. Importa porque varias rutas filtran por
  // `request.authUser.email` contra el correo del consultor. Sin definir: ADMIN_EMAIL.
  AUTH_DEV_EMAIL: optionalString.pipe(
    z.string().email("AUTH_DEV_EMAIL debe ser un correo válido").optional(),
  ),
  // Roles con los que entrar en modo demo. Sin definir: ADMIN (comportamiento histórico).
  AUTH_DEV_ROLES: devRolesSchema,
  // Habilita los encabezados `x-dev-email` / `x-dev-roles` para cambiar de identidad
  // sin reiniciar el servidor. Exige además `NODE_ENV !== "production"`.
  AUTH_DEV_ROLE_HEADER: z
    .preprocess((val) => val === "true" || val === "1" || val === true, z.boolean())
    .default(false),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
