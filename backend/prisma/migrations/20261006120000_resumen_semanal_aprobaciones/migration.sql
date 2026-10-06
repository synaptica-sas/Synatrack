-- Resumen semanal de aprobaciones pendientes — R-020 + R-022.
--
-- R-022 pedía que el aviso de horas extra al PM dejara de ser un correo por
-- cada solicitud y pasara a ser un resumen semanal. R-020 pedía lo mismo para
-- las horas regulares, donde hoy no hay ningún aviso. Comparten el trabajo
-- periódico, así que comparten también esta única fila de configuración.
--
-- `lastSentAt` es la pieza que impide el envío duplicado: el ciclo de trabajos
-- corre cada hora (168 veces por semana) y necesita una marca PERSISTENTE de
-- "esta semana ya salió". Se reclama con un UPDATE condicional, que en Postgres
-- es atómico, así que el cerrojo vale incluso con dos instancias del servidor
-- —cosa que el cerrojo en memoria de `jobs.service.ts` no cubre—.
--
-- Idempotente a propósito (IF NOT EXISTS / ON CONFLICT): Supabase recibió
-- cambios por `db push` en su día y esto tiene que poder aplicarse allá tal cual.

CREATE TABLE IF NOT EXISTS "ApprovalDigestConfig" (
    "id"                 TEXT NOT NULL,
    "scope"              TEXT NOT NULL DEFAULT 'GENERAL',
    "enabled"            BOOLEAN NOT NULL DEFAULT true,
    "sendWeekday"        INTEGER NOT NULL DEFAULT 1,
    "sendHourUtc"        INTEGER NOT NULL DEFAULT 13,
    "immediateExtraHour" BOOLEAN NOT NULL DEFAULT false,
    "lastSentAt"         TIMESTAMP(3),
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalDigestConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ApprovalDigestConfig_scope_key"
    ON "ApprovalDigestConfig"("scope");

-- Siembra de la única fila, con los valores por defecto: activo, lunes a las
-- 13:00 UTC (08:00 en Colombia) y SIN el aviso inmediato de horas extra, que es
-- justo lo que R-022 pide reemplazar.
--
-- `lastSentAt` queda en NULL: el primer ciclo que pase después del lunes a las
-- 13:00 UTC mandará el primer resumen.
INSERT INTO "ApprovalDigestConfig"
    ("id", "scope", "enabled", "sendWeekday", "sendHourUtc", "immediateExtraHour", "lastSentAt", "createdAt", "updatedAt")
VALUES
    ('apprdigest_general', 'GENERAL', true, 1, 13, false, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("scope") DO NOTHING;
