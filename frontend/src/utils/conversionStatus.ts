/**
 * Presentación del estado de conversión de moneda que publica el backend.
 *
 * Cinco endpoints (`/api/stats/overview`, `/api/stats/portfolio`,
 * `/api/projects/:id/detail`, `/api/projects/:id/profitability` y
 * `/api/projects/:id/timeline`) devuelven un campo `conversion` con la forma
 * `{ incomplete, missingPairs }`. Cuando `incomplete` es `true`, al menos un
 * importe se sumó **sin convertir** porque no había tasa para su par, así que
 * el total es aproximado aunque venga rotulado con la moneda base.
 *
 * Este módulo traduce esa información técnica a español legible. Los pares
 * llegan como `"COP->USD"`; en pantalla nunca se muestra esa flecha ni el
 * nombre del campo: se dice "de COP a USD".
 */

/** Cuántos pares se enumeran antes de resumir el resto con "y N más". */
const MAX_PARES_VISIBLES = 4;

/** `"COP->USD"` → `"de COP a USD"`. Un par con formato inesperado se deja tal cual. */
export function formatearPar(par: string): string {
  const partes = par.split("->");
  if (partes.length !== 2) return par;
  const [origen, destino] = partes.map((p) => p.trim());
  if (!origen || !destino) return par;
  return `de ${origen} a ${destino}`;
}

/**
 * Enumera los pares en una frase española: "de COP a USD, de BRL a USD y de
 * CLP a USD". A partir de {@link MAX_PARES_VISIBLES} corta y añade "y N más"
 * para que el aviso no se convierta en un muro de texto.
 */
export function formatearParesFaltantes(pares: string[]): string {
  const limpios = pares.filter((p) => p.trim().length > 0);
  if (limpios.length === 0) return "";

  const visibles = limpios.slice(0, MAX_PARES_VISIBLES).map(formatearPar);
  const ocultos = limpios.length - visibles.length;

  if (ocultos > 0) {
    return `${visibles.join(", ")} y ${ocultos} ${ocultos === 1 ? "par más" : "pares más"}`;
  }
  if (visibles.length === 1) return visibles[0];
  return `${visibles.slice(0, -1).join(", ")} y ${visibles[visibles.length - 1]}`;
}

/**
 * Frase completa para el aviso: qué falta y qué consecuencia tiene.
 * No incluye la instrucción de ir a Tasas FX; esa la pone el componente,
 * porque allí puede ser un botón además de texto.
 */
export function textoConversionIncompleta(pares: string[]): string {
  const lista = formatearParesFaltantes(pares);
  if (!lista) {
    return "Faltan tasas de cambio, así que algunos importes se sumaron sin convertir y los totales son aproximados.";
  }
  return (
    `Faltan tasas de cambio para convertir ${lista}. ` +
    "Esos importes se sumaron sin convertir, así que los totales son aproximados."
  );
}

/**
 * Frase del aviso **leve** de R-008/R-012: todo se convirtió, pero algunos
 * importes se valoraron con la tasa de hoy en vez de con la de su fecha porque
 * el histórico no llega tan atrás. No es un número incorrecto; es un número que
 * se mueve solo, que es justo lo que estos dos ítems vinieron a eliminar.
 */
export function textoValoracionAproximada(pares: string[]): string {
  const lista = formatearParesFaltantes(pares);
  if (!lista) {
    return (
      "Algunos importes se valoraron con la tasa de cambio de hoy porque no hay " +
      "tasa histórica para su fecha, así que su valor cambia cada día."
    );
  }
  return (
    `No hay tasa histórica anterior a la fecha de algunos movimientos ${lista}. ` +
    "Esos importes se valoraron con la tasa de hoy, así que su valor cambia cada día."
  );
}

/** Texto corto para el `title` de la marca de valoración aproximada. */
export function tituloValoracionAproximada(pares: string[]): string {
  const lista = formatearParesFaltantes(pares);
  if (!lista) return "Valorado con la tasa de hoy: falta tasa histórica para esa fecha.";
  return `Valorado con la tasa de hoy ${lista}: falta tasa histórica para esa fecha.`;
}

/** Texto corto para el `title` de la marca de fila o tarjeta. */
export function tituloConversionIncompleta(pares: string[]): string {
  const lista = formatearParesFaltantes(pares);
  if (!lista) return "Cifra aproximada: faltan tasas de cambio.";
  return `Cifra aproximada: faltan tasas de cambio para convertir ${lista}.`;
}
