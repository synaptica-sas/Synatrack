-- Migración de DATOS (no de esquema).
--
-- Corrección puntual que antes vivía en `ensureDefaultConfigs()` de
-- `src/modules/extra-hours/extra-hours.routes.ts` y se ejecutaba en CADA petición
-- del módulo de horas extra (DEP-10 del backlog de depuración).
--
-- Cuando se agregó la columna `monthlyDivisor` se creó con DEFAULT 220 para todos los
-- países. Los países cuyo divisor legal real no es 220 quedaron mal. Esta migración
-- los corrige UNA sola vez, y solo si siguen con el 220 heredado del default
-- (no pisa valores que un administrador haya ajustado a mano).
UPDATE "ExtraHoursConfig" SET "monthlyDivisor" = 240 WHERE "country" = 'Peru'      AND "monthlyDivisor" = 220;
UPDATE "ExtraHoursConfig" SET "monthlyDivisor" = 180 WHERE "country" = 'Chile'     AND "monthlyDivisor" = 220;
UPDATE "ExtraHoursConfig" SET "monthlyDivisor" = 240 WHERE "country" = 'Mexico'    AND "monthlyDivisor" = 220;
UPDATE "ExtraHoursConfig" SET "monthlyDivisor" = 240 WHERE "country" = 'Ecuador'   AND "monthlyDivisor" = 220;
UPDATE "ExtraHoursConfig" SET "monthlyDivisor" = 200 WHERE "country" = 'Argentina' AND "monthlyDivisor" = 220;
UPDATE "ExtraHoursConfig" SET "monthlyDivisor" = 160 WHERE "country" = 'España'    AND "monthlyDivisor" = 220;
