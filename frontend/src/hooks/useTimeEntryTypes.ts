import { useCallback, useEffect, useState } from "react";
import { listTimeEntryTypes, type TimeEntryType } from "../services/api";

/**
 * Catálogo de tipos de hora (R14).
 *
 * Con `all` trae también los desactivados y el conteo de registros, que solo
 * entrega el servidor a quien tiene `time:types`. Expone el error en vez de
 * tragárselo: una tabla vacía por un 500 se leería como "no hay tipos".
 */
export function useTimeEntryTypes(enabled: boolean, all = false) {
  const [types, setTypes] = useState<TimeEntryType[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      setTypes(await listTimeEntryTypes(all));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar el catálogo de tipos de hora");
    } finally {
      setLoading(false);
    }
  }, [enabled, all]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { types, loading, error, reload };
}
