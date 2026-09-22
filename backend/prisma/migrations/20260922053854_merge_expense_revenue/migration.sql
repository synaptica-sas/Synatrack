/*
  Warnings:

  - Se fusionan las tablas `Expense` y `RevenueEntry` en una sola tabla `FinancialEntry`
    con un discriminador `type`. Los datos existentes se copian antes de eliminar las
    tablas viejas, no se pierden.

*/
-- CreateEnum
CREATE TYPE "FinancialEntryType" AS ENUM ('EXPENSE', 'REVENUE');

-- CreateTable
CREATE TABLE "FinancialEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "FinancialEntryType" NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "category" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinancialEntry_projectId_idx" ON "FinancialEntry"("projectId");

-- CreateIndex
CREATE INDEX "FinancialEntry_entryDate_idx" ON "FinancialEntry"("entryDate");

-- CreateIndex
CREATE INDEX "FinancialEntry_type_idx" ON "FinancialEntry"("type");

-- AddForeignKey
ALTER TABLE "FinancialEntry" ADD CONSTRAINT "FinancialEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- MigrateData: copiar Expense -> FinancialEntry
INSERT INTO "FinancialEntry" (id, "projectId", type, "entryDate", category, amount, currency, description, "createdAt", "updatedAt")
SELECT id, "projectId", 'EXPENSE', "expenseDate", category, amount, currency, description, "createdAt", "updatedAt" FROM "Expense";

-- MigrateData: copiar RevenueEntry -> FinancialEntry
INSERT INTO "FinancialEntry" (id, "projectId", type, "entryDate", category, amount, currency, description, "createdAt", "updatedAt")
SELECT id, "projectId", 'REVENUE', "entryDate", NULL, amount, currency, description, "createdAt", "updatedAt" FROM "RevenueEntry";

-- DropForeignKey
ALTER TABLE "Expense" DROP CONSTRAINT "Expense_projectId_fkey";

-- DropForeignKey
ALTER TABLE "RevenueEntry" DROP CONSTRAINT "RevenueEntry_projectId_fkey";

-- DropTable
DROP TABLE "Expense";

-- DropTable
DROP TABLE "RevenueEntry";
