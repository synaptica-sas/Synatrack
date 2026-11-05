import { useCallback, useEffect, useState } from "react";
import { getTimesheetReviewCount } from "../services/api";

/**
 * Cola de revisión semanal de horas (R15): si el usuario puede revisar alguna
 * semana (PM de un proyecto, delegado o ADMIN) y cuántas hay por revisar.
 *
 * La entrada de menú NO depende solo de un permiso del rol: un PM de proyecto
 * con rol CONSULTANT o un delegado también revisan, y eso solo lo sabe el
 * backend. `resolved` evita que App expulse de la pestaña antes de saberlo.
 */
export function useReviewQueue(enabled: boolean) {
  const [canReview, setCanReview] = useState(false);
  const [pending, setPending] = useState(0);
  const [resolved, setResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      const data = await getTimesheetReviewCount();
      setCanReview(data.canReview);
      setPending(data.pending);
      setError(null);
    } catch (err) {
      setCanReview(false);
      setPending(0);
      setError(err instanceof Error ? err.message : "No se pudo consultar la cola de aprobación");
    } finally {
      setResolved(true);
    }
  }, [enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { canReview, pending, resolved, error, reload };
}
