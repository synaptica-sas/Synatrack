import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCapacityReport,
  listCapacityReports,
  type ApiPage,
  type CapacityReport,
  type CapacityReportSummary,
} from "../services/api";

/**
 * Reportes oficiales de capacity (lista paginada y detalle). Mismo contrato que
 * `useCapacityMonthly`: `{ data, loading, error, reload }`, flag `enabled` y descarte de
 * respuestas viejas. Un fallo deja `data = null` con el mensaje, nunca una lista vacía.
 */
export function useCapacityReports(page: number, enabled: boolean) {
  const [data, setData] = useState<ApiPage<CapacityReportSummary> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    if (!enabled) return;
    const id = ++latest.current;
    setLoading(true);
    try {
      const result = await listCapacityReports(page);
      if (id !== latest.current) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (id !== latest.current) return;
      setData(null);
      setError(err instanceof Error ? err.message : "No se pudieron cargar los reportes oficiales");
    } finally {
      if (id === latest.current) setLoading(false);
    }
  }, [page, enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload };
}

export function useCapacityReport(reportId: string | null, enabled: boolean) {
  const [data, setData] = useState<CapacityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    if (!enabled || !reportId) return;
    const id = ++latest.current;
    setLoading(true);
    try {
      const result = await getCapacityReport(reportId);
      if (id !== latest.current) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (id !== latest.current) return;
      setData(null);
      setError(err instanceof Error ? err.message : "No se pudo cargar el reporte oficial");
    } finally {
      if (id === latest.current) setLoading(false);
    }
  }, [reportId, enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, setData, loading, error, reload };
}
