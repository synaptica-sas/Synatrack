import { useCallback, useEffect, useState } from "react";
import { listAllTimeEntries, type TimeEntry } from "../services/api";

/**
 * Horas del tablero.
 *
 * Pide **todas** las páginas a propósito: el tablero recorta por proyecto, por
 * rango y por periodo anterior en el cliente, y calcula totales y gráficas
 * sobre el conjunto. Con una sola página los indicadores pasarían a estar mal
 * sin que nadie lo notara, que es justo el defecto que la paginación no puede
 * introducir. La tabla de aprobaciones del timesheet, en cambio, sí pagina.
 *
 * El campo `error` es **aditivo**: la forma `{ data, loading, reload }` que
 * comparten los demás hooks no cambia.
 */
export function useTimeEntries(enabled: boolean) {
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  /** Mensaje del último fallo, o `null` si la última carga fue correcta. */
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const data = await listAllTimeEntries();
      setTimeEntries(data);
      setError(null);
    } catch (err) {
      // Se descarta el dato viejo: un conjunto incompleto alimentando los
      // indicadores es peor que no tener dato.
      setTimeEntries([]);
      setError(err instanceof Error ? err.message : "No se pudieron cargar las horas");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { timeEntries, loading, error, reload };
}
