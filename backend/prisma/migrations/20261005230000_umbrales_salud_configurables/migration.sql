-- Umbrales del semáforo de salud configurables — decisión de negocio D-7.
--
-- Había DOS criterios distintos para lo mismo y se contradecían en pantalla:
-- `PortfolioTab.tsx` pintaba la celda de CPI/SPI con 0,85 / 1,00 y la barra de
-- presupuesto con 90 % / 100 %, mientras `utils/health.ts` decidía el semáforo
-- de la MISMA fila con 0,75 / 0,90. Un proyecto con CPI 0,80 salía con la celda
-- en rojo y su propio semáforo en ámbar.
--
-- Dirección decidió que son configuración general y que se quedan los valores
-- del backend (0,75 crítico, 0,90 advertencia) como punto de partida, pero
-- editables desde una pantalla.
--
-- Idempotente a propósito (IF NOT EXISTS / ON CONFLICT / bloques DO): Supabase
-- recibió cambios por `db push` en su día y esto tiene que poder aplicarse allá
-- sin explotar.

-- ── 1. Tabla de umbrales generales ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "HealthThresholdConfig" (
    "id"                TEXT NOT NULL,
    "scope"             TEXT NOT NULL DEFAULT 'GENERAL',
    "cpiWarning"        DECIMAL(5,3) NOT NULL DEFAULT 0.900,
    "cpiCritical"       DECIMAL(5,3) NOT NULL DEFAULT 0.750,
    "spiWarning"        DECIMAL(5,3) NOT NULL DEFAULT 0.900,
    "spiCritical"       DECIMAL(5,3) NOT NULL DEFAULT 0.750,
    "budgetWarningPct"  DECIMAL(5,2) NOT NULL DEFAULT 90,
    "budgetCriticalPct" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HealthThresholdConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "HealthThresholdConfig_scope_key"
    ON "HealthThresholdConfig"("scope");

-- ── 2. Siembra de la única fila ──────────────────────────────────────────────
-- Los valores que confirmó dirección. `ON CONFLICT DO NOTHING` para no pisar
-- un ajuste que un administrador ya haya hecho desde la pantalla.
INSERT INTO "HealthThresholdConfig"
    ("id", "scope", "cpiWarning", "cpiCritical", "spiWarning", "spiCritical",
     "budgetWarningPct", "budgetCriticalPct", "updatedAt")
VALUES
    ('healththr_general', 'GENERAL', 0.900, 0.750, 0.900, 0.750, 90, 100, CURRENT_TIMESTAMP)
ON CONFLICT ("scope") DO NOTHING;

-- ── 3. `Project.budgetAlertPct` pasa a nulable ───────────────────────────────
-- Era `DECIMAL(5,2) NOT NULL DEFAULT 90`, así que NINGUNA fila podía quedar sin
-- valor y el umbral general nunca llegaba a aplicarse: la configuración general
-- de presupuesto habría nacido muerta. Nulo pasa a significar "este proyecto no
-- define umbral propio, hereda el de la empresa", igual que ya hacen
-- `marginWarningPct` y `marginCriticalPct` desde D-2.
ALTER TABLE "Project" ALTER COLUMN "budgetAlertPct" DROP NOT NULL;
ALTER TABLE "Project" ALTER COLUMN "budgetAlertPct" DROP DEFAULT;

-- CAMBIO DE DATOS, declarado: los proyectos que siguen con el 90 exacto heredado
-- del DEFAULT de la columna pasan a NULL, es decir, a heredar el valor general.
-- Hoy el valor general TAMBIÉN es 90, así que ningún semáforo cambia por esto;
-- lo que cambia es que a partir de ahora esos proyectos siguen al valor general
-- cuando la PMO lo mueva, en vez de quedarse clavados en 90 para siempre.
-- Un proyecto con cualquier otro valor conserva el suyo intacto.
-- Solo se ejecuta una vez: después ya no quedan filas con 90 puesto por defecto.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "_prisma_migrations"
        WHERE "migration_name" = '20261005230000_umbrales_salud_configurables'
          AND "finished_at" IS NOT NULL
    ) THEN
        UPDATE "Project" SET "budgetAlertPct" = NULL WHERE "budgetAlertPct" = 90;
    END IF;
END $$;
