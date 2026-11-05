-- R15: revisión semanal del timesheet y campos de devolución. Idempotente.

DO $$ BEGIN
  CREATE TYPE "TimesheetReviewStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'RETURNED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "TimeEntry" ADD COLUMN IF NOT EXISTS "rejectedBy" TEXT;
ALTER TABLE "TimeEntry" ADD COLUMN IF NOT EXISTS "rejectedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "TimeEntry_consultantId_workDate_status_idx"
  ON "TimeEntry"("consultantId", "workDate", "status");

CREATE TABLE IF NOT EXISTS "TimesheetWeekReview" (
    "id" TEXT NOT NULL,
    "consultantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "status" "TimesheetReviewStatus" NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "note" TEXT,
    "hours" DECIMAL(8,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "TimesheetWeekReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TimesheetWeekReview_consultantId_weekStart_projectId_key"
  ON "TimesheetWeekReview"("consultantId", "weekStart", "projectId");
CREATE INDEX IF NOT EXISTS "TimesheetWeekReview_projectId_status_idx"
  ON "TimesheetWeekReview"("projectId", "status");
CREATE INDEX IF NOT EXISTS "TimesheetWeekReview_status_weekStart_idx"
  ON "TimesheetWeekReview"("status", "weekStart");

DO $$ BEGIN
  ALTER TABLE "TimesheetWeekReview" ADD CONSTRAINT "TimesheetWeekReview_consultantId_fkey"
    FOREIGN KEY ("consultantId") REFERENCES "Consultant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TimesheetWeekReview" ADD CONSTRAINT "TimesheetWeekReview_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
