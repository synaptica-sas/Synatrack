-- Corrige el drift entre schema.prisma y el historial de migraciones.
--
-- Estas tablas y columnas se habian aplicado a las bases existentes con
-- `prisma db push`, por lo que nunca quedaron registradas como migracion. Una
-- base creada solo con `prisma migrate deploy` quedaba incompleta y la
-- aplicacion fallaba en runtime (por ejemplo, `prisma.user.findUnique()` contra
-- la columna `country` durante el login).
--
-- Todo el script es idempotente (IF NOT EXISTS y un bloque DO para la
-- constraint): se puede aplicar tanto a una base nueva como a una que ya tenga
-- los objetos creados por `db push`, como Supabase. Sin esas guardas la
-- migracion aborta con "column already exists" en cualquier base que ya los
-- tuviera, que es justamente el caso de produccion.

-- AlterTable
ALTER TABLE "Consultant" ADD COLUMN IF NOT EXISTS "allowWeekendWork" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Consultant" ADD COLUMN IF NOT EXISTS "company" TEXT;
ALTER TABLE "Consultant" ADD COLUMN IF NOT EXISTS "isInternal" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "ExtraHoursConfig" ADD COLUMN IF NOT EXISTS "country" TEXT NOT NULL DEFAULT 'Default';
ALTER TABLE "ExtraHoursConfig" ADD COLUMN IF NOT EXISTS "monthlyDivisor" DECIMAL(5,2) NOT NULL DEFAULT 220;

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "country" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "CustomHoliday" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'All',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ApprovalDelegation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fromUserEmail" TEXT NOT NULL,
    "toUserEmail" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalDelegation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CustomHoliday_date_country_key" ON "CustomHoliday"("date", "country");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ApprovalDelegation_projectId_idx" ON "ApprovalDelegation"("projectId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ApprovalDelegation_fromUserEmail_idx" ON "ApprovalDelegation"("fromUserEmail");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ApprovalDelegation_toUserEmail_idx" ON "ApprovalDelegation"("toUserEmail");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ExtraHoursConfig_country_key" ON "ExtraHoursConfig"("country");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ApprovalDelegation_projectId_fkey'
  ) THEN
    ALTER TABLE "ApprovalDelegation"
      ADD CONSTRAINT "ApprovalDelegation_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
