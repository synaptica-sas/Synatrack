-- El cronómetro pasa a producir horas de TIMESHEET en vez de un origen propio.
--
-- Es una forma cómoda de rellenar el timesheet, no un registro aparte: sus
-- horas deben contar en el informe igual que las escritas a mano en la grilla.
-- Que vinieron del cronómetro se sigue sabiendo porque son las únicas filas
-- con `startedAt` y `endedAt`.
--
-- Se reetiquetan las que ya existían para que el pasado siga la misma regla y
-- los totales históricos no dependan de cuándo se registró cada hora.
UPDATE "TimeEntry" SET "source" = 'TIMESHEET' WHERE "source" = 'TIMER';
