-- Observabilidad de los trabajos periodicos.
--
-- Persiste el resultado de cada ejecucion (que trabajo, cuando empezo, si salio
-- bien, cuanto tardo y el error si lo hubo). Antes vivia en una variable de
-- modulo y el plan free de Render duerme el servicio, asi que tras cada siesta
-- no quedaba rastro de nada.
--
-- IDEMPOTENTE a proposito (`IF NOT EXISTS`): tiene que poder aplicarse sobre
-- bases que ya divergen del historial de migraciones (Supabase recibio cambios
-- por `db push`).

-- CreateTable
CREATE TABLE IF NOT EXISTS "JobRun" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Resuelve "ultima ejecucion de cada trabajo" sin recorrer la tabla.
CREATE INDEX IF NOT EXISTS "JobRun_jobName_startedAt_idx" ON "JobRun"("jobName", "startedAt" DESC);

-- CreateIndex
-- Resuelve "ultimo EXITO de cada trabajo", que es lo que decide la frescura.
CREATE INDEX IF NOT EXISTS "JobRun_jobName_ok_startedAt_idx" ON "JobRun"("jobName", "ok", "startedAt" DESC);
