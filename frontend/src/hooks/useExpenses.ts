import { useCallback, useEffect, useState } from "react";
import { listExpenses, type ConversionStatus, type Expense } from "../services/api";

/**
 * Gastos ya convertidos a `baseCurrency` por el servidor (R-026).
 *
 * La moneda viaja al backend porque la conversión se hace allí, a la tasa de la
 * fecha de cada gasto. Cambiar la moneda de presentación es, por tanto, una
 * recarga: es el precio de no tener una segunda implementación de la aritmética
 * de conversión en el cliente, que es justo lo que hacía que Gastos y Tablero
 * dieran números distintos. `undefined` deja que el backend elija su base.
 *
 * `conversion` es el estado de la conversión del listado COMPLETO; la pantalla
 * filtra en el cliente y rotula lo que está a la vista con las marcas por gasto.
 */
export function useExpenses(enabled: boolean, baseCurrency?: string) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [conversion, setConversion] = useState<ConversionStatus | undefined>(undefined);
  /** Moneda en la que están realmente los `baseAmount` que hay cargados. */
  const [loadedCurrency, setLoadedCurrency] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const resultado = await listExpenses(baseCurrency);
      setExpenses(resultado.expenses);
      setConversion(resultado.conversion);
      setLoadedCurrency(resultado.baseCurrency);
      setError(null);
    } catch (err) {
      // No se traga el fallo: una lista vacía y un 500 no son lo mismo.
      setError(err instanceof Error ? err.message : "No se pudieron cargar los gastos");
    } finally {
      setLoading(false);
    }
  }, [enabled, baseCurrency]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { expenses, conversion, loadedCurrency, loading, error, reload };
}
