-- R14: tipos de hora del timesheet, vínculo con horas extra y proyecto Ausencias.
-- Idempotente: se puede aplicar sobre una base que ya tenga los objetos.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "TimeEntryCategory" AS ENUM ('REGULAR', 'EXTRA', 'ABSENCE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "TimeEntryType" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "category" "TimeEntryCategory" NOT NULL,
    "blockType" "BlockType",
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "TimeEntryType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TimeEntryType_code_key" ON "TimeEntryType"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "TimeEntryType_name_key" ON "TimeEntryType"("name");
CREATE INDEX IF NOT EXISTS "TimeEntryType_category_idx" ON "TimeEntryType"("category");
CREATE INDEX IF NOT EXISTS "TimeEntryType_active_sortOrder_idx" ON "TimeEntryType"("active", "sortOrder");

-- Semilla de los 4 tipos base, con ids fijos (el DEFAULT de TimeEntry.typeId apunta a tet_regular).
INSERT INTO "TimeEntryType" ("id", "code", "name", "category", "blockType", "active", "sortOrder", "updatedAt") VALUES
  ('tet_regular',    'REGULAR',    'Horas Regulares', 'REGULAR', NULL,       true, 0, CURRENT_TIMESTAMP),
  ('tet_extra',      'EXTRA',      'Horas Extras',    'EXTRA',   NULL,       true, 1, CURRENT_TIMESTAMP),
  ('tet_permiso',    'PERMISO',    'Permiso',         'ABSENCE', 'OTHER',    true, 2, CURRENT_TIMESTAMP),
  ('tet_vacaciones', 'VACACIONES', 'Vacaciones',      'ABSENCE', 'VACATION', true, 3, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- AlterTable TimeEntry: typeId nullable -> backfill a REGULAR -> NOT NULL + DEFAULT
ALTER TABLE "TimeEntry" ADD COLUMN IF NOT EXISTS "typeId" TEXT;
ALTER TABLE "TimeEntry" ADD COLUMN IF NOT EXISTS "extraHourEntryId" TEXT;
ALTER TABLE "TimeEntry" ADD COLUMN IF NOT EXISTS "isExcess" BOOLEAN NOT NULL DEFAULT false;

UPDATE "TimeEntry" SET "typeId" = 'tet_regular' WHERE "typeId" IS NULL;

ALTER TABLE "TimeEntry" ALTER COLUMN "typeId" SET DEFAULT 'tet_regular';
ALTER TABLE "TimeEntry" ALTER COLUMN "typeId" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "TimeEntry_typeId_idx" ON "TimeEntry"("typeId");
CREATE INDEX IF NOT EXISTS "TimeEntry_extraHourEntryId_idx" ON "TimeEntry"("extraHourEntryId");

DO $$ BEGIN
  ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_typeId_fkey"
    FOREIGN KEY ("typeId") REFERENCES "TimeEntryType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_extraHourEntryId_fkey"
    FOREIGN KEY ("extraHourEntryId") REFERENCES "ExtraHourEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable Project: marca del proyecto interno Ausencias
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "isAbsenceProject" BOOLEAN NOT NULL DEFAULT false;

-- Siembra del proyecto "Ausencias" solo si no existe ninguno marcado. Project no exige FK
-- (company/country/currency son texto), así que el INSERT es válido sin inventar datos ajenos.
INSERT INTO "Project" ("id", "name", "company", "country", "currency", "budget", "startDate", "endDate",
                       "description", "isInternal", "isAbsenceProject", "allowExtraHours", "updatedAt")
SELECT 'prj_ausencias', 'Ausencias', 'Synaptica', 'Interno', 'USD', 0,
       '2026-01-01T00:00:00.000Z', '2099-12-31T00:00:00.000Z',
       'Proyecto interno para registrar permisos y vacaciones.', true, true, false, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Project" WHERE "isAbsenceProject" = true)
ON CONFLICT DO NOTHING;

-- AlterTable ConsultantBlock: bloque generado por una ausencia aprobada
ALTER TABLE "ConsultantBlock" ADD COLUMN IF NOT EXISTS "timeEntryId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "ConsultantBlock_timeEntryId_key" ON "ConsultantBlock"("timeEntryId");

DO $$ BEGIN
  ALTER TABLE "ConsultantBlock" ADD CONSTRAINT "ConsultantBlock_timeEntryId_fkey"
    FOREIGN KEY ("timeEntryId") REFERENCES "TimeEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
