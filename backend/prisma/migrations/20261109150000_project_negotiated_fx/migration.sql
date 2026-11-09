-- Tasa de cambio negociada por proyecto (opcional). Nulas en los proyectos existentes:
-- siguen valorándose con el histórico de tasas, igual que antes.
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "negotiatedFxRate" DECIMAL(18,6);
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "negotiatedFxCurrency" TEXT;
