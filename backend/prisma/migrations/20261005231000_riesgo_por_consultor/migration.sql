-- R-015: asignar un riesgo a un consultor del equipo.
--
-- `owner` (texto libre) se conserva tal cual: sigue sirviendo para un
-- responsable externo (cliente, tercero) sin fila en `Consultant`.
-- `consultantId` es nuevo y nulable: no todo riesgo es de alguien del equipo.

-- AlterTable
ALTER TABLE "Risk" ADD COLUMN     "consultantId" TEXT;

-- CreateIndex
CREATE INDEX "Risk_consultantId_idx" ON "Risk"("consultantId");

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_consultantId_fkey" FOREIGN KEY ("consultantId") REFERENCES "Consultant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
