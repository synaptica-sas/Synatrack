import type { PrismaClient } from "@prisma/client";
import { buildRateBook, type RateBook } from "../../utils/currency.js";

/**
 * Carga de un tirón las tasas actuales y todo el histórico, y arma el libro
 * fechado que usan los cálculos financieros (R-008 / R-012).
 *
 * POR QUÉ DE UN TIRÓN: la alternativa obvia —preguntar la tasa de cada
 * movimiento con `GET /api/fx/rate?date=`— sería una consulta por gasto, por
 * registro de horas y por forecast. `/stats/overview` recorre TODOS los
 * proyectos: eso son miles de consultas por pantalla. El histórico de tasas es
 * una tabla pequeña (una fila por par y día), así que cabe entera en memoria y
 * se resuelve ahí, igual que ya se hacía con `buildRateMap`, pero con la
 * dimensión de fecha añadida.
 *
 * Se ordena por `effectiveDate` ascendente en la base para que `buildRateBook`
 * encuentre las series casi ordenadas y su `sort` sea barato.
 */
export async function cargarLibroDeTasas(
  prisma: Pick<PrismaClient, "fxConfig" | "fxRateHistory">,
): Promise<{ rateBook: RateBook; baseCurrency: string }> {
  const [fxConfigs, fxHistory] = await Promise.all([
    prisma.fxConfig.findMany(),
    prisma.fxRateHistory.findMany({
      select: { baseCode: true, quoteCode: true, rate: true, effectiveDate: true },
      orderBy: { effectiveDate: "asc" },
    }),
  ]);

  return {
    rateBook: buildRateBook(fxConfigs, fxHistory),
    // Misma convención de siempre: la moneda base por defecto es la del primer
    // FxConfig, y "USD" si no hay ninguno.
    baseCurrency: fxConfigs[0]?.baseCode ?? "USD",
  };
}
