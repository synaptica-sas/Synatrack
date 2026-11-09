import { useCallback, useEffect, useState } from "react";
import { listCompanies, type Company, type CompanyFilters } from "../services/api";

/**
 * Catálogo de empresas (clientes de los proyectos).
 *
 * Patrón `{ data, loading, reload }` con flag `enabled`, pero **expone el error**:
 * una lista vacía por un 500 se confundiría con "no hay empresas registradas".
 * `active`/`search` se filtran en el servidor.
 */
export function useCompanies(enabled: boolean, filters?: CompanyFilters) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = filters?.active;
  const search = filters?.search;

  const reload = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      setCompanies(await listCompanies({ active, search }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar las empresas");
    } finally {
      setLoading(false);
    }
  }, [enabled, active, search]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { companies, loading, error, reload };
}
