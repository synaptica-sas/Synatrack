import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().min(1).default("http://localhost:5173"),
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
  AZURE_AD_AUDIENCE: z.string().min(1).default("api://app-gestion-backend"),
  ADMIN_EMAIL: z.string().email().default("admin@synaptica.local"),
  SUPPORT_EMAIL: z.string().email().optional(),
  PAYROLL_EMAIL: z.string().email().optional(),
  FX_SYNC_TOKEN: z.string().min(1).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
