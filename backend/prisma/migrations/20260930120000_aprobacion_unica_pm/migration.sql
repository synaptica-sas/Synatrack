-- Aprobación única del PM para las horas extra
-- ============================================
--
-- POR QUÉ
-- El dueño del producto eliminó el segundo nivel de aprobación. Hasta hoy el PM
-- daba el visto bueno operativo (PENDING_PM -> PENDING_FINANCE) y Finanzas la
-- autorización de pago (PENDING_FINANCE -> APPROVED). La regla nueva es que el
-- PM es quien conoce el estado de salud de su proyecto: si aprobó las horas es
-- porque el proyecto puede pagarlas. Finanzas desembolsa, no decide.
--
-- QUÉ HACE CON LOS DATOS
-- Las solicitudes que quedaron en PENDING_FINANCE ya tienen la aprobación del
-- PM, que con la regla nueva es la única necesaria. Por lo tanto pasan a
-- APPROVED y entran directamente en el consolidado de nómina
-- (GET /api/extra-hours/payroll, que filtra por status = 'APPROVED').
--
-- NO se toca ningún importe: los recargos ya calculados quedan intactos. Esto
-- cambia quién aprueba, no cuánto se paga.
--
-- TRAZABILIDAD
-- Cada fila movida deja su registro en "AuditLog" con changedBy =
-- 'migracion:20260930120000_aprobacion_unica_pm', para que la bitácora explique
-- por qué una solicitud cambió de estado sin que nadie pulsara un botón.
--
-- SOBRE EL ENUM
-- El valor 'PENDING_FINANCE' se CONSERVA en el tipo "ExtraHourStatus" aunque
-- deje de producirse. Quitarlo obligaría a recrear el tipo y, sobre todo, el
-- histórico de "AuditLog" guarda ese estado dentro de before/after para
-- siempre: sin el valor en el enum, ese histórico dejaría de ser legible como
-- un estado del sistema. Es un valor muerto, no un valor inválido.
--
-- IDEMPOTENTE: se puede reejecutar sin efecto (el UPDATE no encuentra filas y
-- el INSERT usa un id determinista con ON CONFLICT DO NOTHING).

-- 1. Bitácora: se escribe ANTES del UPDATE, mientras las filas siguen en
--    PENDING_FINANCE, para poder registrar el estado previo real.
INSERT INTO "AuditLog" ("id", "entity", "entityId", "action", "changedBy", "before", "after", "diff", "createdAt")
SELECT
  'mig-aprob-unica-' || e."id",
  'extraHourEntry',
  e."id",
  'APPROVE',
  'migracion:20260930120000_aprobacion_unica_pm',
  jsonb_build_object('status', 'PENDING_FINANCE', 'approvedAt', e."approvedAt", 'approvedBy', e."approvedBy"),
  jsonb_build_object('status', 'APPROVED', 'approvedAt', COALESCE(e."approvedAt", NOW()), 'approvedBy', e."approvedBy"),
  jsonb_build_object(
    'status', jsonb_build_object('before', 'PENDING_FINANCE', 'after', 'APPROVED'),
    'motivo', 'Se elimina la aprobación de Finanzas: la del PM pasa a ser la única necesaria.'
  ),
  NOW()
FROM "ExtraHourEntry" e
WHERE e."status" = 'PENDING_FINANCE'
ON CONFLICT ("id") DO NOTHING;

-- 2. Las solicitudes con aprobación del PM quedan aprobadas.
--    `approvedAt` se rellena solo si estaba vacío (el nivel 1 no lo escribía),
--    con la fecha de la migración, que es cuando pasaron a ser pagables.
--    `approvedBy` se deja COMO ESTÁ a propósito: la fila no guarda quién dio la
--    aprobación de nivel 1, y rellenarlo con un correo inventado falsificaría el
--    rastro de quién autorizó un pago. Ese dato está en "AuditLog" (action =
--    'APPROVE' sobre la misma entityId), que es la fuente correcta.
UPDATE "ExtraHourEntry"
SET
  "status" = 'APPROVED',
  "approvedAt" = COALESCE("approvedAt", NOW()),
  "updatedAt" = NOW()
WHERE "status" = 'PENDING_FINANCE';
