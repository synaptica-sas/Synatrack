-- Jornada laboral configurable — decisión de negocio D-5, desbloquea DEP-41.
--
-- `CapacityConfig` ya admitía una fila por consultor (`consultantId` único) o una
-- por país, pero nada impedía dos filas para el mismo país: "la jornada de
-- Colombia" no estaba bien definida. Esta migración vuelve único el país, separa
-- los dos tipos de fila y siembra los valores acordados por dirección:
-- Colombia 8,5 h y Ecuador 8 h, con una fila general `Default` de 8 h × 5 días.
--
-- Idempotente: se puede aplicar sobre una base que ya tenga parte de esto.

-- 1. Colapsar duplicados por país antes de poder hacerlo único.
--    Se conserva la fila más reciente (desempate por id).
DELETE FROM "CapacityConfig" a
USING "CapacityConfig" b
WHERE a."consultantId" IS NULL
  AND b."consultantId" IS NULL
  AND a."country" IS NOT NULL
  AND b."country" IS NOT NULL
  AND a."country" = b."country"
  AND (a."updatedAt" < b."updatedAt" OR (a."updatedAt" = b."updatedAt" AND a."id" < b."id"));

-- 2. Una fila por consultor no lleva país: el país se hereda del consultor.
--    Sin esto, dos consultores del mismo país chocarían en el índice único.
UPDATE "CapacityConfig" SET "country" = NULL
WHERE "consultantId" IS NOT NULL AND "country" IS NOT NULL;

-- 3. El índice único sustituye al índice simple, que queda redundante.
DROP INDEX IF EXISTS "CapacityConfig_country_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "CapacityConfig_country_key" ON "CapacityConfig"("country");

-- 4. Siembra de los valores acordados. `WHERE NOT EXISTS` para no pisar un
--    valor que un administrador ya haya ajustado a mano.
INSERT INTO "CapacityConfig" ("id", "consultantId", "country", "hoursPerDay", "workDaysPerWeek", "createdAt", "updatedAt")
SELECT 'cfgjrn0000000000000default', NULL, 'Default', 8, 5, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "CapacityConfig" WHERE "country" = 'Default');

INSERT INTO "CapacityConfig" ("id", "consultantId", "country", "hoursPerDay", "workDaysPerWeek", "createdAt", "updatedAt")
SELECT 'cfgjrn000000000000colombia', NULL, 'Colombia', 8.5, 5, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "CapacityConfig" WHERE "country" = 'Colombia');

INSERT INTO "CapacityConfig" ("id", "consultantId", "country", "hoursPerDay", "workDaysPerWeek", "createdAt", "updatedAt")
SELECT 'cfgjrn0000000000000ecuador', NULL, 'Ecuador', 8, 5, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "CapacityConfig" WHERE "country" = 'Ecuador');
