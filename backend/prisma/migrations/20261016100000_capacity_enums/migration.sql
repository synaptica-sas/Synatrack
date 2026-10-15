-- Capacity mensual: nuevos valores de enum.
-- Va en una migracion propia porque Postgres no permite usar un valor agregado
-- con ADD VALUE dentro de la misma transaccion que lo agrega; la migracion
-- siguiente (capacity_mensual) ya puede referirlos.
ALTER TYPE "AppRole" ADD VALUE IF NOT EXISTS 'COMMERCIAL';
ALTER TYPE "ProjectStatus" ADD VALUE IF NOT EXISTS 'PROSPECT';
