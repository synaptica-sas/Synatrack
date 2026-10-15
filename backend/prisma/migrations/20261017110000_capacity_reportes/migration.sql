-- Capacity fase 2: parametros de alertas/resumen semanal y reportes oficiales inmutables.
-- Idempotente: Supabase puede haber recibido cambios por fuera de las migraciones.

ALTER TABLE "CapacitySettings"
  ADD COLUMN IF NOT EXISTS "alertsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "alertHorizonMonths" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "digestEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "digestWeekday" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "digestHourUtc" INTEGER NOT NULL DEFAULT 13,
  ADD COLUMN IF NOT EXISTS "digestLastSentAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "CapacityReport" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "note" TEXT,
  "fromMonth" TEXT NOT NULL,
  "toMonth" TEXT NOT NULL,
  "includeProbables" BOOLEAN NOT NULL,
  "internal" TEXT NOT NULL,
  "filters" JSONB NOT NULL,
  "settings" JSONB NOT NULL,
  "payload" JSONB NOT NULL,
  "publishedBy" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "revokedBy" TEXT,
  "revokeReason" TEXT,
  CONSTRAINT "CapacityReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CapacityReport_publishedAt_idx" ON "CapacityReport"("publishedAt");
