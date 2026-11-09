-- Catálogo de empresas (clientes) y relación 1:N con Project.
-- Reemplaza el texto libre "Project"."company" por "Project"."companyId".
-- Seguro con datos existentes y con base vacía. No toca Consultant.company.

-- 1) Tabla Company
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nit" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Company_name_key" ON "Company"("name");
CREATE UNIQUE INDEX "Company_nit_key" ON "Company"("nit");
CREATE INDEX "Company_active_idx" ON "Company"("active");
-- Unicidad sin distinguir mayúsculas (Prisma no lo expresa).
CREATE UNIQUE INDEX "Company_name_lower_key" ON "Company"(lower("name"));

-- 2) Backfill: una empresa por cada lower(trim(company)); nombre = variante más
--    frecuente (desempate: la del proyecto más antiguo). Vacío/NULL -> 'Sin empresa'.
INSERT INTO "Company" ("id", "name", "active", "createdAt", "updatedAt", "createdBy")
SELECT 'cmp_' || md5(k), nombre, true, now(), now(), 'migracion'
FROM (
    SELECT DISTINCT ON (k) k, nombre
    FROM (
        SELECT
            CASE WHEN btrim(coalesce("company", '')) = '' THEN 'sin empresa'
                 ELSE lower(btrim("company")) END AS k,
            CASE WHEN btrim(coalesce("company", '')) = '' THEN 'Sin empresa'
                 ELSE btrim("company") END AS nombre,
            "createdAt"
        FROM "Project"
    ) p
    GROUP BY k, nombre
    ORDER BY k, count(*) DESC, min("createdAt") ASC, nombre ASC
) elegidas;

-- 3) Project.companyId: nullable, poblar, NOT NULL
ALTER TABLE "Project" ADD COLUMN "companyId" TEXT;

UPDATE "Project" p
SET "companyId" = c."id"
FROM "Company" c
WHERE lower(c."name") = CASE WHEN btrim(coalesce(p."company", '')) = '' THEN 'sin empresa'
                             ELSE lower(btrim(p."company")) END;

ALTER TABLE "Project" ALTER COLUMN "companyId" SET NOT NULL;

ALTER TABLE "Project" ADD CONSTRAINT "Project_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Project_companyId_idx" ON "Project"("companyId");

-- 4) Eliminar el texto libre (ya copiado a Company.name)
ALTER TABLE "Project" DROP COLUMN "company";
