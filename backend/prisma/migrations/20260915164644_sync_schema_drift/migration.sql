-- AlterTable
ALTER TABLE "Consultant" ADD COLUMN     "allowWeekendWork" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "company" TEXT,
ADD COLUMN     "isInternal" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "ExtraHoursConfig" ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'Default',
ADD COLUMN     "monthlyDivisor" DECIMAL(5,2) NOT NULL DEFAULT 220;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "country" TEXT;

-- CreateTable
CREATE TABLE "CustomHoliday" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'All',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalDelegation" (
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
CREATE UNIQUE INDEX "CustomHoliday_date_country_key" ON "CustomHoliday"("date", "country");

-- CreateIndex
CREATE INDEX "ApprovalDelegation_projectId_idx" ON "ApprovalDelegation"("projectId");

-- CreateIndex
CREATE INDEX "ApprovalDelegation_fromUserEmail_idx" ON "ApprovalDelegation"("fromUserEmail");

-- CreateIndex
CREATE INDEX "ApprovalDelegation_toUserEmail_idx" ON "ApprovalDelegation"("toUserEmail");

-- CreateIndex
CREATE UNIQUE INDEX "ExtraHoursConfig_country_key" ON "ExtraHoursConfig"("country");

-- AddForeignKey
ALTER TABLE "ApprovalDelegation" ADD CONSTRAINT "ApprovalDelegation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

