-- Dos umbrales de margen bruto por proyecto (decisión de negocio D-2).
--
-- Hasta ahora `Project."marginThreshold"` era UN solo umbral y el semáforo
-- improvisaba el segundo nivel multiplicándolo por 0,5 (ver `utils/health.ts`).
-- Dirección confirmó que son dos niveles distintos y configurables:
--   · advertencia — por defecto 30 %, "el margen baja, hay que vigilarlo"
--   · crítico     — por defecto 15 %, "el suelo que no se debe cruzar"
--
-- ─── Interpretación de los datos que YA existen ──────────────────────────────
--
-- `marginThreshold` se renombra a `marginCriticalPct`, NO a `marginWarningPct`.
-- El razonamiento, porque es una interpretación y no un detalle técnico:
--
--  1. La frase que cierra la decisión es literal: «ya el del 15 es un umbral que
--     no debe pasar». El 15 era exactamente el valor por defecto del campo viejo
--     (`DEFAULT_MARGIN_THRESHOLD_PCT`), así que el número que el negocio llama
--     "crítico" es el mismo número que el campo viejo aplicaba por defecto.
--     Mapearlo al nuevo campo crítico deja el comportamiento por defecto
--     idéntico para los proyectos sin configurar; mapearlo a "advertencia"
--     habría convertido el suelo histórico en un simple aviso, es decir, habría
--     AFLOJADO el control sin que nadie lo pidiera.
--  2. Quien escribió un valor propio en el formulario lo hizo contra una ayuda
--     que decía «margen bruto mínimo para que el proyecto siga en verde»: un
--     mínimo, un suelo. Eso es el nivel crítico.
--  3. En caso de duda, el error seguro es el conservador: tratar el valor
--     existente como suelo mantiene la vigilancia donde estaba. Tratarlo como
--     advertencia habría bajado el suelo real de cada proyecto a un número que
--     nadie escribió.
--
-- Los proyectos con el campo NULO (la mayoría) siguen nulos: "sin umbral propio"
-- y caen a los valores por defecto del código, que ahora son 30 / 15 en vez de
-- un único 15. Es un cambio deliberado de comportamiento: antes esos proyectos
-- se ponían en amarillo por debajo de 15 y en rojo por debajo de 7,5; ahora
-- avisan por debajo de 30 y se ponen en crítico por debajo de 15.
--
-- ─── Coherencia ─────────────────────────────────────────────────────────────
--
-- El invariante es crítico <= advertencia. Un proyecto que ya tuviera un suelo
-- por encima del 30 % por defecto quedaría incoherente, así que se le fija la
-- advertencia igual a su crítico: toda la franja por debajo de su suelo es
-- crítica y no hay banda de aviso. Es lo que su configuración actual ya decía.
--
-- Idempotente (`IF NOT EXISTS` / `DO $$`): Supabase recibió cambios por
-- `db push` y esta migración tiene que poder correr allá sin explotar.

-- 1. Nuevo campo de advertencia.
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "marginWarningPct" DECIMAL(5,2);

-- 2. Renombrar el umbral único a "crítico", solo si procede.
DO $$
BEGIN
  IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'Project'
        AND column_name = 'marginThreshold'
    )
    AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'Project'
        AND column_name = 'marginCriticalPct'
    )
  THEN
    ALTER TABLE "Project" RENAME COLUMN "marginThreshold" TO "marginCriticalPct";
  END IF;
END $$;

-- 3. Red de seguridad: si la base nunca tuvo la columna vieja, crearla igual.
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "marginCriticalPct" DECIMAL(5,2);

-- 4. Coherencia de los proyectos con suelo por encima del 30 % por defecto.
UPDATE "Project"
   SET "marginWarningPct" = "marginCriticalPct"
 WHERE "marginWarningPct" IS NULL
   AND "marginCriticalPct" IS NOT NULL
   AND "marginCriticalPct" > 30;
