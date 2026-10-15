import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCapacityMonthly,
  type MonthlyCapacity,
  type MonthlyCapacityParams,
} from "../services/api";

/**
 * Capacity mensual del equipo.
 *
 * Mismo contrato que los demás hooks (`{ data, loading, error, reload }`) con
 * el flag `enabled` atado a un permiso. Dos cuidados:
 *  - un fallo deja `data = null` y `error` con mensaje: la pantalla nunca debe
 *    pintar un "equipo vacío" cuando en realidad hubo un 500;
 *  - si los filtros cambian rápido, solo cuenta la última petición; una
 *    respuesta vieja que llega tarde no pisa a la nueva.
 */
export function useCapacityMonthly(params: MonthlyCapacityParams, enabled: boolean) {
  const [data, setData] = useState<MonthlyCapacity | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Número de la última petición lanzada; las anteriores se descartan al llegar. */
  const latest = useRef(0);

  // Los parámetros se comparan por valor, no por identidad del objeto.
  const key = JSON.stringify(params);

  const reload = useCallback(async () => {
    if (!enabled) return;
    const id = ++latest.current;
    setLoading(true);
    try {
      const result = await getCapacityMonthly(JSON.parse(key) as MonthlyCapacityParams);
      if (id !== latest.current) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (id !== latest.current) return;
      // Se descarta el dato viejo: mostrarlo junto a un error engañaría.
      setData(null);
      setError(err instanceof Error ? err.message : "No se pudo cargar la capacidad mensual");
    } finally {
      if (id === latest.current) setLoading(false);
    }
  }, [key, enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload };
}
