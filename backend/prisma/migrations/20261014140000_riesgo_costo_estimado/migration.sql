-- R-009: costo estimado de un riesgo, para medir su impacto potencial sobre
-- el presupuesto del proyecto. `estimatedCost` nulable a propósito (no todo
-- riesgo tiene un costo estimable todavía); `costCurrency` con default "USD",
-- nunca null, mismo patrón que `Project.sellPrice`/`Project.sellCurrency`.
--
-- Idempotente (IF NOT EXISTS) para poder aplicarse sin romper una base que ya
-- tenga estas columnas por otra vía.

ALTER TABLE "Risk" ADD COLUMN IF NOT EXISTS "estimatedCost" DECIMAL(14,2);
ALTER TABLE "Risk" ADD COLUMN IF NOT EXISTS "costCurrency" TEXT NOT NULL DEFAULT 'USD';
