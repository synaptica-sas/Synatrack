-- R-010: categoría de proyecto, como lista desplegable con opción de
-- personalizar. `Project.category` es texto libre (sin llave foránea, mismo
-- criterio que `FinancialEntry.category`), y `ProjectCategory` es el catálogo
-- que alimenta el desplegable. Una categoría nueva escrita en el formulario
-- de un proyecto se agrega sola al catálogo.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "category" TEXT;

-- CreateTable
CREATE TABLE "ProjectCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectCategory_name_key" ON "ProjectCategory"("name");

-- CreateIndex
CREATE INDEX "ProjectCategory_active_idx" ON "ProjectCategory"("active");
