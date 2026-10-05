import { useCallback, useEffect, useState } from "react";
import { getHealthThresholds, type UmbralesSaludConfig } from "../services/api";

/**
 * Umbrales generales del semáforo de salud (D-7), para la pantalla de
 * administración.
 *
 * Como el de la jornada laboral, **expone el error** en vez de tragárselo: si
 * la carga falla y se mostrara el formulario vacío, el administrador creería
 * que no hay nada configurado y volvería a escribirlo todo encima.
 */
export function useHealthThresholds(enabled: boolean) {
  const [config, setConfig] = useState<UmbralesSaludConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      setConfig(await getHealthThresholds());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los umbrales de salud");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { config, loading, error, reload };
}
