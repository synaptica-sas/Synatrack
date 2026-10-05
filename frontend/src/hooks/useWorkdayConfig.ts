import { useCallback, useEffect, useState } from "react";
import { getWorkdayConfig, type JornadaConfig } from "../services/api";

/**
 * Configuración de la jornada laboral (D-5), para la pantalla de administración.
 *
 * A diferencia de los hooks antiguos, este **expone el error** en vez de
 * tragárselo: un 500 aquí no puede verse como "no hay nada configurado", porque
 * invitaría a volver a escribirlo todo.
 */
export function useWorkdayConfig(enabled: boolean) {
  const [config, setConfig] = useState<JornadaConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      setConfig(await getWorkdayConfig());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la jornada laboral");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { config, loading, error, reload };
}
