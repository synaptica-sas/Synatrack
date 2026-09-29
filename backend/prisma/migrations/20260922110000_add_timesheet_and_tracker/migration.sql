-- CreateEnum
CREATE TYPE "TimeEntrySource" AS ENUM ('MANUAL', 'TIMESHEET', 'TIMER');

-- AlterTable
ALTER TABLE "TimeEntry"
    ADD COLUMN "description" TEXT,
    ADD COLUMN "activityId" TEXT,
    ADD COLUMN "source" "TimeEntrySource" NOT NULL DEFAULT 'MANUAL',
    ADD COLUMN "startedAt" TIMESTAMP(3),
    ADD COLUMN "endedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RunningTimer" (
    "id" TEXT NOT NULL,
    "consultantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "activityId" TEXT,
    "description" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RunningTimer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimeEntry_activityId_idx" ON "TimeEntry"("activityId");

-- CreateIndex
CREATE INDEX "TimeEntry_consultantId_workDate_idx" ON "TimeEntry"("consultantId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "RunningTimer_consultantId_key" ON "RunningTimer"("consultantId");

-- CreateIndex
CREATE INDEX "RunningTimer_projectId_idx" ON "RunningTimer"("projectId");

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunningTimer" ADD CONSTRAINT "RunningTimer_consultantId_fkey" FOREIGN KEY ("consultantId") REFERENCES "Consultant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunningTimer" ADD CONSTRAINT "RunningTimer_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunningTimer" ADD CONSTRAINT "RunningTimer_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
