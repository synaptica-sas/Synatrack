import { useCallback, useEffect, useMemo, useState } from "react";
import { getEffectiveWorkdays, type JornadasEfectivas } from "../services/api";
import { JORNADA_POR_DEFECTO } from "../features/reports/reportUtils";

/**
 * Jornada efectiva de cada consultor (D-5), para pantallas que necesitan
 * separar lo que cabe en la jornada de lo que la excede.
 *
 * Devuelve además `jornadaDe(consultantId)`, que resuelve la jornada de una
 * persona concreta y cae en la general si no la conoce (consultor inactivo,
 * datos aún sin cargar). Nunca devuelve `undefined`: quien pinta una barra
 * siempre tiene un número contra el que comparar.
 */
export function useEffectiveWorkdays(enabled: boolean) {
  const [jornadas, setJornadas] = useState<JornadasEfectivas | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      setJornadas(await getEffectiveWorkdays());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la jornada laboral");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const porConsultor = useMemo(
    () => new Map((jornadas?.consultants ?? []).map((j) => [j.consultantId, j.hoursPerDay])),
    [jornadas],
  );

  /** Horas de jornada del consultor; la general si no se conoce. */
  // Mientras la petición está en vuelo no hay jornada real que aplicar.
  const horasGenerales = jornadas?.general.hoursPerDay ?? JORNADA_POR_DEFECTO;
  const jornadaDe = useCallback(
    (consultantId: string) => porConsultor.get(consultantId) ?? horasGenerales,
    [porConsultor, horasGenerales],
  );

  return { jornadas, jornadaDe, horasGenerales, loading, error, reload };
}
