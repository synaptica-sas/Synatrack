-- Trazabilidad: createdAt/updatedAt/createdBy/updatedBy en todas las tablas de negocio.
-- Excluidas a proposito: JobRun, AuditLog, RunningTimer, UserRole (tablas de sistema).
-- El actor se guarda como email en texto (no es FK a User), igual que approvedBy o closedBy.
-- Idempotente: Supabase puede haber recibido cambios por fuera de las migraciones. Los
-- backfills solo corren cuando la columna se crea en esta ejecucion, asi que re-ejecutar
-- la migracion no pisa valores ya escritos por la aplicacion.
-- Las filas anteriores quedan con createdBy/updatedBy en NULL: no se inventan actores.

-- Project
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Project' AND column_name = 'createdBy') THEN
    ALTER TABLE "Project" ADD COLUMN "createdBy" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Project' AND column_name = 'updatedBy') THEN
    ALTER TABLE "Project" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- Consultant
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Consultant' AND column_name = 'createdBy') THEN
    ALTER TABLE "Consultant" ADD COLUMN "createdBy" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Consultant' AND column_name = 'updatedBy') THEN
    ALTER TABLE "Consultant" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- TimeEntry
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'TimeEntry' AND column_name = 'createdBy') THEN
    ALTER TABLE "TimeEntry" ADD COLUMN "createdBy" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'TimeEntry' AND column_name = 'updatedBy') THEN
    ALTER TABLE "TimeEntry" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- FinancialEntry
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'FinancialEntry' AND column_name = 'createdBy') THEN
    ALTER TABLE "FinancialEntry" ADD COLUMN "createdBy" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'FinancialEntry' AND column_name = 'updatedBy') THEN
    ALTER TABLE "FinancialEntry" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- FinancialCategory
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'FinancialCategory' AND column_name = 'createdBy') THEN
    ALTER TABLE "FinancialCategory" ADD COLUMN "createdBy" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'FinancialCategory' AND column_name = 'updatedBy') THEN
    ALTER TABLE "FinancialCategory" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- ProjectCategory
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'ProjectCategory' AND column_name = 'createdBy') THEN
    ALTER TABLE "ProjectCategory" ADD COLUMN "createdBy" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'ProjectCategory' AND column_name = 'updatedBy') THEN
    ALTER TABLE "ProjectCategory" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- Forecast
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Forecast' AND column_name = 'createdBy') THEN
    ALTER TABLE "Forecast" ADD COLUMN "createdBy" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Forecast' AND column_name = 'updatedBy') THEN
    ALTER TABLE "Forecast" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- FxConfig
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'FxConfig' AND column_name = 'createdBy') THEN
    ALTER TABLE "FxConfig" ADD COLUMN "createdBy" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'FxConfig' AND column_name = 'updatedBy') THEN
    ALTER TABLE "FxConfig" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- User
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'User' AND column_name = 'createdBy') THEN
    ALTER TABLE "User" ADD COLUMN "createdBy" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'User' AND column_name = 'updatedBy') THEN
    ALTER TABLE "User" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- Role
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Role' AND column_name = 'createdBy') THEN
    ALTER TABLE "Role" ADD COLUMN "createdBy" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Role' AND column_name = 'updatedBy') THEN
    ALTER TABLE "Role" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- Assignment
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Assignment' AND column_name = 'createdBy') THEN
    ALTER TABLE "Assignment" ADD COLUMN "createdBy" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Assignment' AND column_name = 'updatedBy') THEN
    ALTER TABLE "Assignment" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- CapacityConfig
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'CapacityConfig' AND column_name = 'createdBy') THEN
    ALTER TABLE "CapacityConfig" ADD COLUMN "createdBy" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'CapacityConfig' AND column_name = 'updatedBy') THEN
    ALTER TABLE "CapacityConfig" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- ChangeRequest
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'ChangeRequest' AND column_name = 'createdBy') THEN
    ALTER TABLE "ChangeRequest" ADD COLUMN "createdBy" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'ChangeRequest' AND column_name = 'updatedBy') THEN
    ALTER TABLE "ChangeRequest" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- ExtraHoursConfig
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'ExtraHoursConfig' AND column_name = 'createdBy') THEN
    ALTER TABLE "ExtraHoursConfig" ADD COLUMN "createdBy" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'ExtraHoursConfig' AND column_name = 'updatedBy') THEN
    ALTER TABLE "ExtraHoursConfig" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- HealthThresholdConfig
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'HealthThresholdConfig' AND column_name = 'createdBy') THEN
    ALTER TABLE "HealthThresholdConfig" ADD COLUMN "createdBy" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'HealthThresholdConfig' AND column_name = 'updatedBy') THEN
    ALTER TABLE "HealthThresholdConfig" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- ExtraHourEntry
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'ExtraHourEntry' AND column_name = 'createdBy') THEN
    ALTER TABLE "ExtraHourEntry" ADD COLUMN "createdBy" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'ExtraHourEntry' AND column_name = 'updatedBy') THEN
    ALTER TABLE "ExtraHourEntry" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- Activity
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Activity' AND column_name = 'createdBy') THEN
    ALTER TABLE "Activity" ADD COLUMN "createdBy" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Activity' AND column_name = 'updatedBy') THEN
    ALTER TABLE "Activity" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- CustomHoliday
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'CustomHoliday' AND column_name = 'createdBy') THEN
    ALTER TABLE "CustomHoliday" ADD COLUMN "createdBy" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'CustomHoliday' AND column_name = 'updatedBy') THEN
    ALTER TABLE "CustomHoliday" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- ApprovalDigestConfig
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'ApprovalDigestConfig' AND column_name = 'createdBy') THEN
    ALTER TABLE "ApprovalDigestConfig" ADD COLUMN "createdBy" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'ApprovalDigestConfig' AND column_name = 'updatedBy') THEN
    ALTER TABLE "ApprovalDigestConfig" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- Milestone
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Milestone' AND column_name = 'updatedBy') THEN
    ALTER TABLE "Milestone" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- Issue
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Issue' AND column_name = 'updatedBy') THEN
    ALTER TABLE "Issue" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- Holiday
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Holiday' AND column_name = 'updatedBy') THEN
    ALTER TABLE "Holiday" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- Risk
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Risk' AND column_name = 'createdAt') THEN
    ALTER TABLE "Risk" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    UPDATE "Risk" SET "createdAt" = "identifiedAt";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Risk' AND column_name = 'updatedBy') THEN
    ALTER TABLE "Risk" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- ConsultantBlock
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'ConsultantBlock' AND column_name = 'updatedAt') THEN
    ALTER TABLE "ConsultantBlock" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    UPDATE "ConsultantBlock" SET "updatedAt" = "createdAt";
    ALTER TABLE "ConsultantBlock" ALTER COLUMN "updatedAt" DROP DEFAULT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'ConsultantBlock' AND column_name = 'createdBy') THEN
    ALTER TABLE "ConsultantBlock" ADD COLUMN "createdBy" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'ConsultantBlock' AND column_name = 'updatedBy') THEN
    ALTER TABLE "ConsultantBlock" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- Estimation
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Estimation' AND column_name = 'updatedAt') THEN
    ALTER TABLE "Estimation" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    UPDATE "Estimation" SET "updatedAt" = "createdAt";
    ALTER TABLE "Estimation" ALTER COLUMN "updatedAt" DROP DEFAULT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Estimation' AND column_name = 'createdBy') THEN
    ALTER TABLE "Estimation" ADD COLUMN "createdBy" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Estimation' AND column_name = 'updatedBy') THEN
    ALTER TABLE "Estimation" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- ApprovalDelegation
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'ApprovalDelegation' AND column_name = 'updatedAt') THEN
    ALTER TABLE "ApprovalDelegation" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    UPDATE "ApprovalDelegation" SET "updatedAt" = "createdAt";
    ALTER TABLE "ApprovalDelegation" ALTER COLUMN "updatedAt" DROP DEFAULT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'ApprovalDelegation' AND column_name = 'createdBy') THEN
    ALTER TABLE "ApprovalDelegation" ADD COLUMN "createdBy" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'ApprovalDelegation' AND column_name = 'updatedBy') THEN
    ALTER TABLE "ApprovalDelegation" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- MonthlySnapshot
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'MonthlySnapshot' AND column_name = 'updatedAt') THEN
    ALTER TABLE "MonthlySnapshot" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    UPDATE "MonthlySnapshot" SET "updatedAt" = "createdAt";
    ALTER TABLE "MonthlySnapshot" ALTER COLUMN "updatedAt" DROP DEFAULT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'MonthlySnapshot' AND column_name = 'createdBy') THEN
    ALTER TABLE "MonthlySnapshot" ADD COLUMN "createdBy" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'MonthlySnapshot' AND column_name = 'updatedBy') THEN
    ALTER TABLE "MonthlySnapshot" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- Alert
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Alert' AND column_name = 'updatedAt') THEN
    ALTER TABLE "Alert" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    UPDATE "Alert" SET "updatedAt" = "createdAt";
    ALTER TABLE "Alert" ALTER COLUMN "updatedAt" DROP DEFAULT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Alert' AND column_name = 'createdBy') THEN
    ALTER TABLE "Alert" ADD COLUMN "createdBy" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Alert' AND column_name = 'updatedBy') THEN
    ALTER TABLE "Alert" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- FxRateHistory
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'FxRateHistory' AND column_name = 'updatedAt') THEN
    ALTER TABLE "FxRateHistory" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    UPDATE "FxRateHistory" SET "updatedAt" = "createdAt";
    ALTER TABLE "FxRateHistory" ALTER COLUMN "updatedAt" DROP DEFAULT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'FxRateHistory' AND column_name = 'updatedBy') THEN
    ALTER TABLE "FxRateHistory" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- HolidayCalendarYear
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'HolidayCalendarYear' AND column_name = 'createdAt') THEN
    ALTER TABLE "HolidayCalendarYear" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    UPDATE "HolidayCalendarYear" SET "createdAt" = "confirmedAt";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'HolidayCalendarYear' AND column_name = 'updatedAt') THEN
    ALTER TABLE "HolidayCalendarYear" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    UPDATE "HolidayCalendarYear" SET "updatedAt" = "confirmedAt";
    ALTER TABLE "HolidayCalendarYear" ALTER COLUMN "updatedAt" DROP DEFAULT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'HolidayCalendarYear' AND column_name = 'createdBy') THEN
    ALTER TABLE "HolidayCalendarYear" ADD COLUMN "createdBy" TEXT;
    UPDATE "HolidayCalendarYear" SET "createdBy" = "confirmedBy";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'HolidayCalendarYear' AND column_name = 'updatedBy') THEN
    ALTER TABLE "HolidayCalendarYear" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- CapacityReport
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'CapacityReport' AND column_name = 'createdAt') THEN
    ALTER TABLE "CapacityReport" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    UPDATE "CapacityReport" SET "createdAt" = "publishedAt";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'CapacityReport' AND column_name = 'updatedAt') THEN
    ALTER TABLE "CapacityReport" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
    UPDATE "CapacityReport" SET "updatedAt" = COALESCE("revokedAt", "publishedAt");
    ALTER TABLE "CapacityReport" ALTER COLUMN "updatedAt" DROP DEFAULT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'CapacityReport' AND column_name = 'createdBy') THEN
    ALTER TABLE "CapacityReport" ADD COLUMN "createdBy" TEXT;
    UPDATE "CapacityReport" SET "createdBy" = "publishedBy";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'CapacityReport' AND column_name = 'updatedBy') THEN
    ALTER TABLE "CapacityReport" ADD COLUMN "updatedBy" TEXT;
  END IF;
END $$;

-- CapacitySettings
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'CapacitySettings' AND column_name = 'createdAt') THEN
    ALTER TABLE "CapacitySettings" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'CapacitySettings' AND column_name = 'createdBy') THEN
    ALTER TABLE "CapacitySettings" ADD COLUMN "createdBy" TEXT;
  END IF;
END $$;
