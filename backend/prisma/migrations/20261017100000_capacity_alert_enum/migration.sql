-- Nuevo tipo de alerta de capacity. Va solo en su migracion porque un valor de enum
-- agregado no puede usarse en la misma transaccion.
ALTER TYPE "AlertType" ADD VALUE IF NOT EXISTS 'CONSULTANT_UNDERUTILIZED';
