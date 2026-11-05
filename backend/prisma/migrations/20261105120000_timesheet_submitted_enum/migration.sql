-- R15: estado SUBMITTED (semana enviada al PM). Va en su propia migración para que el
-- valor nuevo no se use en la misma transacción en que se agrega. Idempotente.
ALTER TYPE "TimeEntryStatus" ADD VALUE IF NOT EXISTS 'SUBMITTED' BEFORE 'APPROVED';
