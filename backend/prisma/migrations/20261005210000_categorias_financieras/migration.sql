-- Catálogo editable de categorías financieras (decisión de negocio D-4).
--
-- Dirección pidió categorizar los ingresos «con posibilidad de luego editarlos».
-- La parte que manda es «editarlos»: por eso el catálogo vive en la base y no
-- como una constante en el frontend, que es como están hoy las de gasto.
--
-- Idempotente a propósito (IF NOT EXISTS / ON CONFLICT): Supabase recibió
-- cambios por `db push` en su día y esta migración tiene que poder aplicarse
-- allá sin explotar.

CREATE TABLE IF NOT EXISTS "FinancialCategory" (
    "id" TEXT NOT NULL,
    "type" "FinancialEntryType" NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FinancialCategory_type_name_key"
    ON "FinancialCategory"("type", "name");

CREATE INDEX IF NOT EXISTS "FinancialCategory_type_active_idx"
    ON "FinancialCategory"("type", "active");

-- ── Siembra ───────────────────────────────────────────────────────────────────
-- Dos categorías genéricas de ingreso. Dirección no dio nombres: se proponen el
-- que cubre el negocio principal de una consultora y un cajón de sastre, para
-- que nunca haya que forzar un ingreso dentro de una categoría que no le toca.
INSERT INTO "FinancialCategory" ("id", "type", "name", "active", "sortOrder", "updatedAt")
VALUES
    ('finrevcat_servicios', 'REVENUE', 'Servicios de consultoría', true, 1, CURRENT_TIMESTAMP),
    ('finrevcat_otros',     'REVENUE', 'Otros ingresos',           true, 99, CURRENT_TIMESTAMP)
ON CONFLICT ("type", "name") DO NOTHING;

-- Las siete categorías de gasto que hasta hoy vivían en
-- `frontend/src/features/expenses/ExpensesTab.tsx:27`. Pasan al catálogo con los
-- mismos nombres y el mismo orden, para que la pantalla de Gastos se comporte
-- exactamente igual que antes y deje de necesitar una lista en el código.
INSERT INTO "FinancialCategory" ("id", "type", "name", "active", "sortOrder", "updatedAt")
VALUES
    ('finexpcat_viajes',      'EXPENSE', 'Viajes',       true, 1, CURRENT_TIMESTAMP),
    ('finexpcat_alojamiento', 'EXPENSE', 'Alojamiento',  true, 2, CURRENT_TIMESTAMP),
    ('finexpcat_alimentacion','EXPENSE', 'Alimentacion', true, 3, CURRENT_TIMESTAMP),
    ('finexpcat_transporte',  'EXPENSE', 'Transporte',   true, 4, CURRENT_TIMESTAMP),
    ('finexpcat_software',    'EXPENSE', 'Software',     true, 5, CURRENT_TIMESTAMP),
    ('finexpcat_servicios',   'EXPENSE', 'Servicios',    true, 6, CURRENT_TIMESTAMP),
    ('finexpcat_otros',       'EXPENSE', 'Otros',        true, 99, CURRENT_TIMESTAMP)
ON CONFLICT ("type", "name") DO NOTHING;

-- Y cualquier categoría de gasto que ya esté en uso y no sea ninguna de las
-- siete: el backend aceptaba texto libre, así que puede haberlas. Si no se
-- recogen aquí, desaparecerían del desplegable y nadie podría volver a usarlas.
INSERT INTO "FinancialCategory" ("id", "type", "name", "active", "sortOrder", "updatedAt")
SELECT
    'finexpcat_' || md5(e."category"),
    'EXPENSE'::"FinancialEntryType",
    e."category",
    true,
    50,
    CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "category" FROM "FinancialEntry"
      WHERE "type" = 'EXPENSE' AND "category" IS NOT NULL AND btrim("category") <> '') AS e
ON CONFLICT ("type", "name") DO NOTHING;
