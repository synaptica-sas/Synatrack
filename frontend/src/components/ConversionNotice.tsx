import type { ConversionStatus } from "../services/api";
import {
  textoConversionIncompleta,
  textoValoracionAproximada,
  tituloConversionIncompleta,
  tituloValoracionAproximada,
} from "../utils/conversionStatus";

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
  if (!conversion) return null;

  // Aviso LEVE (R-008/R-012): no falta ninguna tasa, pero algunos importes se
  // valoraron con la de hoy por no haber histórico para su fecha. Se muestra
  // solo si no hay un problema peor que contar.
  if (!conversion.incomplete) {
    if (!conversion.approximateDates) return null;
    return (
      <div className="notice notice--warning conversion-notice" role="status">
        <div className="notice__title">
          <span aria-hidden="true">▲</span>
          Valoración a la tasa de hoy
        </div>
        <p className="notice__text">
          {/* "no se fijaron" y no "no están fijadas": `contexto` puede venir en
              masculino ("Los totales del tablero") o en femenino ("Las cifras
              financieras de este proyecto"), y la forma anterior solo concordaba
              con el segundo. */}
          {contexto} no se fijaron a la fecha de cada movimiento.{" "}
          {textoValoracionAproximada(conversion.undatedPairs ?? [])}
        </p>
        <div className="conversion-notice__foot">
          {onIrATasasFx ? (
            <button type="button" className="chip-button chip-button--warning" onClick={onIrATasasFx}>
              Ver historial en Tasas FX
            </button>
          ) : (
            <p className="notice__text">
              Cargue las tasas con su fecha en la pantalla <strong>Tasas FX</strong> para fijar estos valores.
            </p>
          )}
        </div>
      </div>
    );
  }

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
  if (!conversion) return null;

  // Mismo orden de gravedad que el aviso: primero lo que está mal, después lo
  // que solo es inestable.
  if (!conversion.incomplete) {
    if (!conversion.approximateDates) return null;
    return (
      <span
        className="state-chip state-chip--warning conversion-chip"
        title={tituloValoracionAproximada(conversion.undatedPairs ?? [])}
      >
        <span aria-hidden="true">▲</span>
        Tasa de hoy
      </span>
    );
  }

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
