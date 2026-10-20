-- DropForeignKey
ALTER TABLE "Forecast" DROP CONSTRAINT "Forecast_consultantId_fkey";

-- DropForeignKey
ALTER TABLE "Forecast" DROP CONSTRAINT "Forecast_projectId_fkey";

-- DropTable
DROP TABLE "Forecast";
