import { useCallback, useEffect, useState } from "react";
import { getApprovalDigestConfig, type ConfigResumenAprobacionesCompleta } from "../services/api";

/**
 * Configuración del resumen semanal de aprobaciones (R-020 + R-022).
 *
 * Como los de jornada laboral y umbrales de salud, **expone el error** en vez de
 * tragárselo: si la carga falla y se mostrara el formulario con los valores
 * iniciales, el administrador creería que esa es la configuración guardada y la
 * sobrescribiría sin querer.
 */
export function useApprovalDigestConfig(enabled: boolean) {
  const [config, setConfig] = useState<ConfigResumenAprobacionesCompleta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      setConfig(await getApprovalDigestConfig());
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo cargar la configuración del resumen semanal",
      );
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { config, loading, error, reload };
}
