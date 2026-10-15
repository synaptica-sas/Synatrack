import { useCallback, useEffect, useState } from "react";
import {
  getHolidayCoverage,
  listHolidayCities,
  listHolidays,
  type Holiday,
  type HolidayCoverage,
} from "../services/api";

/**
 * Años de la tabla de cobertura: del año en curso -1 al +1, más el elegido. Un año
 * sin feriados solo se muestra si es el elegido (así se puede precargar y confirmar).
 */
export function filtrarCobertura(rows: HolidayCoverage[], year: number, now = new Date().getFullYear()): HolidayCoverage[] {
  return rows.filter((c) => c.year === year || (c.year >= now - 1 && c.year <= now + 1 && c.holidayCount > 0));
}

/**
 * Feriados de un país y año, más la cobertura (qué años están confirmados) y las
 * ciudades conocidas. Expone `error`: un 500 no puede verse como "no hay feriados",
 * porque invitaría a volver a cargarlos todos.
 */
export function useHolidays(enabled: boolean, country: string, year: number) {
  const [loaded, setLoaded] = useState<{ key: string; rows: Holiday[] }>({ key: "", rows: [] });
  const [coverage, setCoverage] = useState<HolidayCoverage[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const now = new Date().getFullYear();
  const [error, setError] = useState<string | null>(null);

  const key = `${country}|${year}`;
  const reload = useCallback(async () => {
    if (!enabled || !country) return;
    setLoading(true);
    setError(null);
    try {
      const [h, c, ci] = await Promise.all([
        listHolidays({ country, year }),
        // Rango que cubre los años en curso -1..+1 y el elegido; abajo se filtra lo que se muestra.
        getHolidayCoverage(Math.min(year, now - 1), Math.max(year, now + 1)),
        listHolidayCities(country),
      ]);
      setLoaded({ key, rows: h });
      setCoverage(filtrarCobertura(c, year, now));
      setCities(ci);
    } catch (err) {
      setLoaded({ key, rows: [] });
      setError(err instanceof Error ? err.message : "No se pudieron cargar los feriados");
    } finally {
      setLoading(false);
    }
  }, [enabled, country, year, key, now]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Mientras llegan los feriados del país/año nuevo no se muestran los del anterior.
  const stale = loaded.key !== key;
  return { holidays: stale ? [] : loaded.rows, coverage, cities, loading: loading || (enabled && !!country && stale), error, reload };
}
