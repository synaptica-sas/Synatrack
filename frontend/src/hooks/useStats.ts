import { useCallback, useEffect, useState } from "react";
import { getStatsOverview, type StatsOverview } from "../services/api";

/**
 * Estadísticas del tablero.
 *
 * DEP-36: antes este hook se tragaba el error — un 500 dejaba `stats` en `null`
 * para siempre y el tablero caía a un cálculo local que **suma importes de
 * monedas distintas sin convertir**, es decir, mostraba una cifra inventada en
 * vez de un fallo. Ahora el error se expone.
 *
 * El campo `error` es **aditivo**: la forma `{ data, loading, reload }` que
 * comparten los demás hooks no cambia, así que ningún otro consumidor se rompe.
 */
export function useStats(enabled: boolean, baseCurrency = "USD") {
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [loading, setLoading] = useState(false);
  /** Mensaje del último fallo, o `null` si la última carga fue correcta. */
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const data = await getStatsOverview(baseCurrency);
      setStats(data);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      // Se descarta el dato viejo a propósito: es preferible "no hay dato" a un
      // número correcto para otro momento presentado como actual.
      setStats(null);
      setError(err instanceof Error ? err.message : "No se pudieron cargar las estadísticas");
    } finally {
      setLoading(false);
    }
  }, [enabled, baseCurrency]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { stats, loading, error, lastUpdated, reload };
}
