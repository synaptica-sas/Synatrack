/**
 * Umbrales del semáforo de salud — decisión de negocio D-7.
 *
 * ANTES había DOS criterios distintos para lo mismo, y se contradecían en la
 * misma pantalla:
 *
 *   · `utils/health.ts` decidía el semáforo con CPI/SPI < 0,75 (crítico) y
 *     < 0,9 (advertencia), con los números escritos dentro del `if`.
 *   · `PortfolioTab.tsx` pintaba la celda de CPI/SPI con < 0,85 y < 1,00, y la
 *     barra de presupuesto con > 90 % y > 100 %.
 *   · `alerts.service.ts` disparaba la alerta de CPI con 0,85 y 0,75.
 *
 * Un proyecto con CPI 0,80 salía con la celda en rojo y el semáforo de su
 * propia fila en ámbar. Dirección decidió que los umbrales **son configuración
 * general** y que los valores del backend (0,75 crítico, 0,90 advertencia) son
 * los que se quedan como punto de partida.
 *
 * Este módulo es el **único** sitio donde se clasifica un CPI, un SPI o un uso
 * de presupuesto. Es puro: las filas las trae el llamador, aquí no hay Prisma.
 */

/** Umbrales ya resueltos a número. Nunca nulos: siempre hay un veredicto. */
export type UmbralesSalud = {
  /** CPI por debajo de este valor → advertencia. */
  cpiWarning: number;
  /** CPI por debajo de este valor → crítico. */
  cpiCritical: number;
  spiWarning: number;
  spiCritical: number;
  /** % de presupuesto alcanzado a partir del cual se avisa. */
  budgetWarningPct: number;
  /** % de presupuesto **superado** a partir del cual se considera excedido. */
  budgetCriticalPct: number;
};

/**
 * Último escalón: lo que se aplica cuando la tabla de configuración está vacía
 * (base recién creada y todavía sin sembrar).
 *
 * Existe como constante con nombre a propósito, igual que `JORNADA_GENERAL` en
 * `capacity.ts`: si estos valores se usan, es porque falta la fila, y el API lo
 * dice explícitamente con `origen: "codigo"` en vez de disimularlo. Son los
 * mismos números que dirección confirmó (D-7), así que una base sin sembrar se
 * comporta igual que una sembrada — pero la pantalla avisa de que no hay fila.
 */
export const UMBRALES_SALUD_POR_DEFECTO: UmbralesSalud = {
  cpiWarning: 0.9,
  cpiCritical: 0.75,
  spiWarning: 0.9,
  spiCritical: 0.75,
  budgetWarningPct: 90,
  budgetCriticalPct: 100,
};

/**
 * Clave de la única fila de configuración general. Misma convención que la fila
 * `Default` de `CapacityConfig` y `ExtraHoursConfig`: un valor fijo y conocido
 * para poder hacer `upsert` sin buscar antes.
 */
export const AMBITO_GENERAL = "GENERAL";

/** Nivel de un indicador contra sus umbrales. Vocabulario acordado del semáforo. */
export type NivelIndicador = "ok" | "warning" | "critical" | "no-medible";

/** Fila cruda de `HealthThresholdConfig` (los `Decimal` llegan como objeto). */
export type FilaUmbralesSalud = {
  cpiWarning: unknown;
  cpiCritical: unknown;
  spiWarning: unknown;
  spiCritical: unknown;
  budgetWarningPct: unknown;
  budgetCriticalPct: unknown;
};

/**
 * Ojo con el `null`: `Number(null)` es 0, que es finito. Sin este descarte
 * explícito una columna nula se tomaría como umbral 0 y el indicador no sería
 * crítico nunca. El cero puesto a mano sí es un valor válido y se respeta, igual
 * que en `resolveMarginThresholds`.
 */
function aNumero(valor: unknown, porDefecto: number): number {
  if (valor === null || valor === undefined || valor === "") return porDefecto;
  const n = Number(valor);
  return Number.isFinite(n) ? n : porDefecto;
}

/**
 * Resuelve los umbrales efectivos a partir de la fila de la base.
 *
 * `null` (tabla sin sembrar) devuelve `UMBRALES_SALUD_POR_DEFECTO`. Un campo
 * suelto que no sea un número finito cae a su propio valor por defecto, no
 * arrastra a los demás.
 *
 * Al final se fuerza el invariante **crítico <= advertencia** para CPI y SPI
 * (son "cuanto más bajo, peor") y **advertencia <= crítico** para el
 * presupuesto (es "cuanto más alto, peor"). Una configuración incoherente
 * colapsa la banda de aviso en vez de producir un semáforo imposible; es el
 * mismo criterio que `resolveMarginThresholds` aplica al margen (D-2).
 */
export function resolverUmbralesSalud(
  fila: FilaUmbralesSalud | null | undefined,
): UmbralesSalud {
  if (!fila) return { ...UMBRALES_SALUD_POR_DEFECTO };

  const cpiCritical = aNumero(fila.cpiCritical, UMBRALES_SALUD_POR_DEFECTO.cpiCritical);
  const cpiWarning = aNumero(fila.cpiWarning, UMBRALES_SALUD_POR_DEFECTO.cpiWarning);
  const spiCritical = aNumero(fila.spiCritical, UMBRALES_SALUD_POR_DEFECTO.spiCritical);
  const spiWarning = aNumero(fila.spiWarning, UMBRALES_SALUD_POR_DEFECTO.spiWarning);
  const budgetWarningPct = aNumero(
    fila.budgetWarningPct,
    UMBRALES_SALUD_POR_DEFECTO.budgetWarningPct,
  );
  const budgetCriticalPct = aNumero(
    fila.budgetCriticalPct,
    UMBRALES_SALUD_POR_DEFECTO.budgetCriticalPct,
  );

  return {
    cpiCritical,
    cpiWarning: Math.max(cpiWarning, cpiCritical),
    spiCritical,
    spiWarning: Math.max(spiWarning, spiCritical),
    budgetCriticalPct,
    budgetWarningPct: Math.min(budgetWarningPct, budgetCriticalPct),
  };
}

/**
 * Clasifica un índice EVM (CPI o SPI) contra sus dos umbrales.
 *
 * Los bordes son EXACTOS y el umbral pertenece a la banda **buena**, el mismo
 * criterio que `classifyMargin`: con los valores iniciales, un CPI de 0,750 es
 * advertencia (no crítico) y uno de 0,900 es saludable. Reproduce exactamente
 * los `< 0.75` y `< 0.9` que tenía `computeHealthStatus` escritos a mano.
 *
 * `null` = índice no calculable (sin AC, sin PV o sin fechas): no se inventa un
 * veredicto, devuelve "no-medible" y quien lo use lo trata como neutro.
 */
export function clasificarIndiceEvm(
  valor: number | null | undefined,
  warning: number,
  critical: number,
): NivelIndicador {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return "no-medible";
  if (valor < critical) return "critical";
  if (valor < warning) return "warning";
  return "ok";
}

/**
 * Clasifica un porcentaje de consumo de presupuesto.
 *
 * Ojo a la asimetría de los bordes, que es deliberada y conserva exactamente el
 * comportamiento que tenía `alertLevel` antes de D-7:
 *
 *  · `pct >= warningPct` ya avisa — **alcanzar** el 90 % es motivo de aviso.
 *  · `pct > criticalPct` es crítico — gastar exactamente el 100 % del
 *    presupuesto todavía no es haberlo excedido.
 *
 * `warningPct` es el que cada proyecto puede sobrescribir con su
 * `budgetAlertPct`; `criticalPct` es general y no se configura por proyecto,
 * porque "haber excedido el presupuesto" no depende del contrato.
 */
export function clasificarUsoPresupuesto(
  pct: number,
  umbrales: Pick<UmbralesSalud, "budgetWarningPct" | "budgetCriticalPct">,
): Exclude<NivelIndicador, "no-medible"> {
  if (pct > umbrales.budgetCriticalPct) return "critical";
  if (pct >= umbrales.budgetWarningPct) return "warning";
  return "ok";
}
