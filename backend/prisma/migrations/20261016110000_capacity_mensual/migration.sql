-- Capacity mensual (fase 1). Idempotente donde es razonable: Supabase puede
-- haber recibido cambios por fuera de las migraciones.

-- Enums nuevos
DO $$ BEGIN
  CREATE TYPE "AssignmentCertainty" AS ENUM ('CONFIRMED', 'PROBABLE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "HolidaySource" AS ENUM ('GENERATED', 'MANUAL', 'DECREE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Columnas nuevas
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "isInternal" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Consultant"
  ADD COLUMN IF NOT EXISTS "city" TEXT,
  ADD COLUMN IF NOT EXISTS "exitDate" DATE,
  ADD COLUMN IF NOT EXISTS "hireDate" DATE;

ALTER TABLE "Assignment"
  ADD COLUMN IF NOT EXISTS "certainty" "AssignmentCertainty" NOT NULL DEFAULT 'CONFIRMED';

-- Assignment.startDate/endDate: timestamp -> date (solo si aun son timestamp)
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'Assignment' AND column_name = 'startDate')
     <> 'date' THEN
    ALTER TABLE "Assignment"
      ALTER COLUMN "startDate" SET DATA TYPE DATE USING ("startDate" AT TIME ZONE 'UTC')::date,
      ALTER COLUMN "endDate" SET DATA TYPE DATE USING ("endDate" AT TIME ZONE 'UTC')::date;
  END IF;
END $$;

-- Borrar un proyecto ya no borra el historial de asignaciones (CASCADE -> RESTRICT)
ALTER TABLE "Assignment" DROP CONSTRAINT IF EXISTS "Assignment_projectId_fkey";
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Assignment_consultantId_startDate_endDate_idx"
  ON "Assignment"("consultantId", "startDate", "endDate");

-- CapacityConfig con vigencia: los unicos pasan a (clave, validFrom)
ALTER TABLE "CapacityConfig" ADD COLUMN IF NOT EXISTS "validFrom" DATE NOT NULL DEFAULT '2000-01-01'::date;
DROP INDEX IF EXISTS "CapacityConfig_consultantId_key";
DROP INDEX IF EXISTS "CapacityConfig_country_key";
CREATE UNIQUE INDEX IF NOT EXISTS "CapacityConfig_consultantId_validFrom_key"
  ON "CapacityConfig"("consultantId", "validFrom");
CREATE UNIQUE INDEX IF NOT EXISTS "CapacityConfig_country_validFrom_key"
  ON "CapacityConfig"("country", "validFrom");

-- Tablas nuevas
CREATE TABLE IF NOT EXISTS "Holiday" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT '',
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "source" "HolidaySource" NOT NULL DEFAULT 'MANUAL',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "HolidayCalendarYear" (
    "country" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "confirmedBy" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HolidayCalendarYear_pkey" PRIMARY KEY ("country","year")
);

CREATE TABLE IF NOT EXISTS "CapacitySettings" (
    "scope" TEXT NOT NULL DEFAULT 'GENERAL',
    "underThresholdPct" DECIMAL(5,2) NOT NULL DEFAULT 70,
    "overThresholdPct" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "includeProbablesDefault" BOOLEAN NOT NULL DEFAULT false,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CapacitySettings_pkey" PRIMARY KEY ("scope")
);

CREATE INDEX IF NOT EXISTS "Holiday_country_date_idx" ON "Holiday"("country", "date");
CREATE UNIQUE INDEX IF NOT EXISTS "Holiday_country_city_date_key" ON "Holiday"("country", "city", "date");

-- Datos: fila unica de parametros
INSERT INTO "CapacitySettings" ("scope", "updatedAt") VALUES ('GENERAL', CURRENT_TIMESTAMP)
ON CONFLICT ("scope") DO NOTHING;

-- Datos: CustomHoliday -> Holiday. "All" se expande a un registro por pais
-- soportado (SUPPORTED_COUNTRIES sin "Default"). Conviven hasta la fase 3.
INSERT INTO "Holiday" ("id", "country", "city", "date", "name", "source", "updatedAt")
SELECT gen_random_uuid()::text, c."country", '', (h."date" AT TIME ZONE 'UTC')::date, h."name", 'MANUAL', CURRENT_TIMESTAMP
FROM "CustomHoliday" h
CROSS JOIN LATERAL (
  SELECT unnest(
    CASE WHEN h."country" = 'All'
      THEN ARRAY['Colombia','Peru','Chile','Mexico','Ecuador','Argentina','España']
      ELSE ARRAY[h."country"] END
  ) AS "country"
) c
ON CONFLICT ("country", "city", "date") DO NOTHING;

-- Datos: jornadas con vigencia (decision P1). Default, Ecuador y Colombia a 8 h
-- desde 2000-01-01; Colombia 8,4 h desde 2026-07-15.
INSERT INTO "CapacityConfig" ("id", "country", "hoursPerDay", "workDaysPerWeek", "validFrom", "updatedAt")
SELECT gen_random_uuid()::text, v.country, 8, 5, DATE '2000-01-01', CURRENT_TIMESTAMP
FROM (VALUES ('Default'), ('Ecuador'), ('Colombia')) AS v(country)
ON CONFLICT ("country", "validFrom") DO NOTHING;

-- La fila Colombia previa tenia 8,5 h; pasa a 8,0 y el cambio a 8,4 queda con vigencia.
UPDATE "CapacityConfig" SET "hoursPerDay" = 8, "updatedAt" = CURRENT_TIMESTAMP
WHERE "country" = 'Colombia' AND "validFrom" = DATE '2000-01-01' AND "hoursPerDay" = 8.5;

INSERT INTO "CapacityConfig" ("id", "country", "hoursPerDay", "workDaysPerWeek", "validFrom", "updatedAt")
VALUES (gen_random_uuid()::text, 'Colombia', 8.4, 5, DATE '2026-07-15', CURRENT_TIMESTAMP)
ON CONFLICT ("country", "validFrom") DO NOTHING;
