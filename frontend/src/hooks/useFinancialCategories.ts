import { useCallback, useEffect, useState } from "react";
import {
  listFinancialCategories,
  type FinancialCategory,
  type FinancialCategoryType,
} from "../services/api";

/**
 * Catálogo de categorías financieras (decisión de negocio D-4).
 *
 * Sirve a dos sitios: los desplegables de los formularios de Gastos e Ingresos
 * (solo las activas) y la pantalla de administración (`includeInactive`, para
 * poder reactivar una).
 *
 * Como `useWorkdayConfig`, **expone el error** en vez de tragárselo: si la
 * petición falla, un desplegable vacío se vería como "no hay categorías", que
 * es justo lo que no queremos que crea quien está registrando un ingreso.
 */
export function useFinancialCategories(
  enabled: boolean,
  type?: FinancialCategoryType,
  includeInactive = false,
) {
  const [categories, setCategories] = useState<FinancialCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      setCategories(await listFinancialCategories(type, includeInactive));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar las categorías");
    } finally {
      setLoading(false);
    }
  }, [enabled, type, includeInactive]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { categories, loading, error, reload };
}
