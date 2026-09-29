-- Sube la precisión de las horas de 2 a 4 decimales.
--
-- Con DECIMAL(8,2) el valor más pequeño representable era 0.01 h = 36 segundos,
-- así que el cronómetro no podía registrar un minuto real sin redondearlo hacia
-- arriba. Con 4 decimales la resolución baja a 0.36 segundos.
--
-- Es una ampliación de precisión: los valores existentes se conservan tal cual
-- y ninguna fila se pierde ni se reescribe.
ALTER TABLE "TimeEntry" ALTER COLUMN "hours" TYPE DECIMAL(8,4);
