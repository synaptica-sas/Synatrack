import type { ConversionStatus } from "../services/api";
import { textoConversionIncompleta, tituloConversionIncompleta } from "../utils/conversionStatus";

/**
 * Aviso de conversión incompleta.
 *
 * El backend avisa —en `data.conversion`— cuando un total se calculó sumando
 * importes que no pudo convertir por falta de tasa. La cifra sigue siendo útil,
 * solo es aproximada, así que esto **no es un error**: es un aviso en tono de
 * advertencia, en línea, que no bloquea la pantalla ni tapa los datos.
 *
 * Dos niveles, a propósito:
 *  - {@link ConversionNotice}: el consolidado de la pantalla es aproximado.
 *  - {@link ConversionChip}: marca la fila o tarjeta del proyecto concreto que
 *    lo causa, para que el aviso de arriba tenga a dónde señalar.
 *
 * Accesibilidad: el color nunca viaja solo. El aviso lleva icono `▲` y el
 * título "Cifras aproximadas"; el chip lleva icono y la palabra "Aprox.".
 * `role="status"` y no `role="alert"`: no interrumpe la lectura.
 */
export function ConversionNotice({
  conversion,
  contexto,
  onIrATasasFx,
}: {
  /** El campo `conversion` de la respuesta. `undefined` en respuestas antiguas. */
  conversion: ConversionStatus | undefined;
  /** Qué cifras son aproximadas. Ej.: "Los totales del tablero". */
  contexto: string;
  /** Si se pasa, se ofrece un atajo a la pantalla de Tasas FX. */
  onIrATasasFx?: () => void;
}) {
  if (!conversion?.incomplete) return null;

  return (
    <div className="notice notice--warning conversion-notice" role="status">
      <div className="notice__title">
        <span aria-hidden="true">▲</span>
        Cifras aproximadas
      </div>
      <p className="notice__text">
        {contexto} no se pudieron convertir del todo. {textoConversionIncompleta(conversion.missingPairs)}
      </p>
      <div className="conversion-notice__foot">
        {onIrATasasFx ? (
          <button type="button" className="chip-button chip-button--warning" onClick={onIrATasasFx}>
            Cargar tasas en Tasas FX
          </button>
        ) : (
          <p className="notice__text">
            Cargue las tasas que faltan en la pantalla <strong>Tasas FX</strong> y vuelva a consultar.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Marca compacta para la fila o la tarjeta de un proyecto cuyo importe quedó
 * sin convertir. Va junto al nombre, no junto a la cifra, porque afecta a
 * varias columnas a la vez.
 */
export function ConversionChip({ conversion }: { conversion: ConversionStatus | undefined }) {
  if (!conversion?.incomplete) return null;

  return (
    <span
      className="state-chip state-chip--warning conversion-chip"
      title={tituloConversionIncompleta(conversion.missingPairs)}
    >
      <span aria-hidden="true">▲</span>
      Aprox.
    </span>
  );
}
