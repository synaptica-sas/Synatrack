import type { MonthlyCapacityTeamCell, MonthlyCapacitySettings } from "../../../services/api";
import { STATUS_LABELS, chartMax, formatPct, monthHeader, statusTone } from "./monthlyUtils";

const COL_W = 56;
const LEFT = 44;
const RIGHT = 12;
const TOP = 22;
const PLOT_H = 170;
const BOTTOM = 30;

/**
 * Columnas por mes con la utilización del equipo. SVG a mano, sin librería:
 * el color sale de clases (`.cap-bar--*`) para respetar el tema oscuro, y cada
 * columna lleva su porcentaje escrito encima.
 */
export function UtilizationChart({
  months,
  settings,
}: {
  months: MonthlyCapacityTeamCell[];
  settings: MonthlyCapacitySettings;
}) {
  const width = LEFT + months.length * COL_W + RIGHT;
  const height = TOP + PLOT_H + BOTTOM;
  const max = chartMax(months.map((m) => m.pct), settings.overThresholdPct);
  const y = (pct: number) => TOP + PLOT_H - (Math.min(pct, max) / max) * PLOT_H;

  const ticks: number[] = [];
  for (let t = 0; t <= max; t += max > 120 ? 40 : 20) ticks.push(t);

  const description = `Utilización del equipo por mes. ${months
    .map((m) => `${monthHeader(m.month)}: ${formatPct(m.pct)}${m.status ? ` (${STATUS_LABELS[m.status]})` : ""}`)
    .join("; ")}. Umbral de subutilización ${settings.underThresholdPct}%, de sobreasignación ${settings.overThresholdPct}%.`;

  return (
    <div className="panel">
      <div className="panel__head">
        <h3 className="panel__title">Utilización del equipo por mes</h3>
      </div>
      <div className="chart-scroll">
        <svg
          className="cap-chart"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={description}
          preserveAspectRatio="xMidYMid meet"
          style={{ minWidth: width }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line className="chart-grid" x1={LEFT} x2={width - RIGHT} y1={y(t)} y2={y(t)} />
              <text className="chart-axis" x={LEFT - 6} y={y(t) + 4} textAnchor="end">{t}%</text>
            </g>
          ))}

          {/* Las líneas de umbral van detrás de las columnas para no tachar sus etiquetas. */}
          <line className="cap-threshold cap-threshold--under" x1={LEFT} x2={width - RIGHT} y1={y(settings.underThresholdPct)} y2={y(settings.underThresholdPct)} />
          <line className="cap-threshold cap-threshold--over" x1={LEFT} x2={width - RIGHT} y1={y(settings.overThresholdPct)} y2={y(settings.overThresholdPct)} />

          {months.map((m, i) => {
            const x = LEFT + i * COL_W + 8;
            const barW = COL_W - 16;
            const tone = statusTone(m.status);
            return (
              <g key={m.month}>
                {m.pct !== null && (
                  <>
                    <rect
                      className={`cap-bar cap-bar--${tone}`}
                      x={x}
                      y={y(m.pct)}
                      width={barW}
                      height={TOP + PLOT_H - y(m.pct)}
                      rx={3}
                    >
                      <title>{`${monthHeader(m.month)}: ${formatPct(m.pct)}`}</title>
                    </rect>
                    <text className="chart-label" x={x + barW / 2} y={y(m.pct) - 5} textAnchor="middle">
                      {formatPct(m.pct)}
                    </text>
                  </>
                )}
                {m.pct === null && (
                  <text className="chart-axis" x={x + barW / 2} y={TOP + PLOT_H - 6} textAnchor="middle">—</text>
                )}
                <text className="chart-axis" x={x + barW / 2} y={TOP + PLOT_H + 18} textAnchor="middle">
                  {monthHeader(m.month)}
                </text>
              </g>
            );
          })}

          <text className="cap-threshold-label cap-threshold-label--over" x={width - RIGHT} y={y(settings.overThresholdPct) - 4} textAnchor="end">
            {`Sobre ${settings.overThresholdPct}%`}
          </text>
          <text className="cap-threshold-label cap-threshold-label--under" x={width - RIGHT} y={y(settings.underThresholdPct) - 4} textAnchor="end">
            {`Sub ${settings.underThresholdPct}%`}
          </text>
        </svg>
      </div>
    </div>
  );
}
