import { useId, useState } from "react";
import { formatHms, type ReportBar } from "./reportUtils";

/**
 * Columnas verticales, una por día de la semana.
 *
 * El tramo verde son las horas dentro de la jornada y el rojo lo que se
 * excedió. Los días sin horas no desaparecen: se dibujan como una línea plana
 * en la base con su "00:00:00" encima, para que un hueco se lea como un cero
 * y no como un día que falta.
 *
 * Los colores salen de `.report-chart` en el CSS, con pasos propios para claro
 * y oscuro, ambos validados para daltonismo. El color nunca es el único
 * indicio: cada columna lleva su cifra encima, hay leyenda y la misma
 * información aparece en tabla debajo.
 */

/** 8.5 → "8,5"; 8 → "8". La coma decimal es la del producto. */
function formatHoras(horas: number): string {
  return horas.toLocaleString("es-CO", { maximumFractionDigits: 2 });
}

// Unidades del viewBox; el SVG escala al ancho disponible.
const W = 1120;
const PAD_L = 58;
const PAD_R = 18;
const PAD_T = 34;
const PLOT_H = 250;
const PAD_B = 42;
const H = PAD_T + PLOT_H + PAD_B;
const BASELINE = PAD_T + PLOT_H;
/** Grosor de la marca de un día sin horas. */
const ZERO_H = 3;
/** Hueco entre el tramo verde y el rojo, para que se lean como dos piezas. */
const SEG_GAP = 2;

/** Escoge un tope redondo y sus marcas, de forma que el eje no quede raro. */
function niceScale(maxValue: number, jornada: number) {
  const target = Math.max(maxValue, jornada);
  const steps = [1, 2, 4, 5, 8, 10, 12, 16, 20, 24, 30, 40, 50, 60, 80, 100, 120];
  const step = steps.find((s) => target / s <= 5) ?? Math.ceil(target / 5);
  const max = Math.ceil(target / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return { max, ticks };
}

export function HoursBarChart({
  bars,
  /** Dibuja la línea de la jornada. Solo tiene sentido con un consultor filtrado. */
  showDailyLimit,
  /**
   * Horas de jornada contra las que se dibuja la línea de referencia. Es la del
   * consultor filtrado, o la general si se está mirando al equipo entero (D-5).
   */
  jornada,
  emptyMessage,
}: {
  bars: ReportBar[];
  showDailyLimit: boolean;
  jornada: number;
  emptyMessage: string;
}) {
  const titleId = useId();
  const [hovered, setHovered] = useState<string | null>(null);

  if (bars.length === 0) {
    return <p className="ts-empty-note">{emptyMessage}</p>;
  }

  const { max, ticks } = niceScale(Math.max(...bars.map((b) => b.total)), jornada);
  const toY = (hours: number) => BASELINE - (hours / max) * PLOT_H;

  const slot = (W - PAD_L - PAD_R) / bars.length;
  // Con cinco columnas el reparto deja mucho aire; el tope evita que una
  // semana con pocos días dibuje columnas desproporcionadas.
  const colW = Math.min(slot * 0.7, 150);
  const xOf = (i: number) => PAD_L + slot * i + (slot - colW) / 2;

  const hoveredBar = bars.find((b) => b.key === hovered) ?? null;

  return (
    <div className="report-chart">
      <div className="report-legend" aria-hidden="true">
        <span><i className="swatch regular" /> Dentro de jornada</span>
        <span><i className="swatch excess" /> Horas extra (fuera de la jornada o en fin de semana)</span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-labelledby={titleId}
        className="report-svg"
        preserveAspectRatio="xMidYMid meet"
      >
        <title id={titleId}>
          Horas por día de la semana, separando las que exceden la jornada de cada consultor
        </title>

        {/* Rejilla y eje vertical */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD_L} x2={W - PAD_R} y1={toY(t)} y2={toY(t)} className="report-grid" />
            <text x={PAD_L - 10} y={toY(t) + 4} textAnchor="end" className="report-axis">
              {t}h
            </text>
          </g>
        ))}

        {showDailyLimit && max > jornada && (
          <g>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={toY(jornada)}
              y2={toY(jornada)}
              className="report-limit-line"
            />
            <text x={W - PAD_R} y={toY(jornada) - 5} textAnchor="end" className="report-limit-label">
              jornada {formatHoras(jornada)} h
            </text>
          </g>
        )}

        {bars.map((bar, i) => {
          const x = xOf(i);
          const cx = x + colW / 2;
          const isHovered = hovered === bar.key;
          const vacio = bar.total === 0;

          const yRegular = toY(bar.regular);
          const hRegular = BASELINE - yRegular;
          const yTop = toY(bar.total);
          const hExcess = yRegular - yTop;

          return (
            <g
              key={bar.key}
              className={[
                "report-col",
                isHovered ? "hovered" : "",
                // El fin de semana atenúa su rótulo; la barra no, porque todas
                // sus horas son extra y el rojo debe verse.
                bar.weekend ? "weekend" : "",
              ].filter(Boolean).join(" ")}
              onMouseEnter={() => setHovered(bar.key)}
              onMouseLeave={() => setHovered(null)}
            >
              {/* Zona sensible de toda la columna, para acertar sin precisión. */}
              <rect x={PAD_L + slot * i} y={PAD_T - 20} width={slot} height={PLOT_H + 20} fill="transparent" />

              {vacio ? (
                <rect x={x} y={BASELINE - ZERO_H} width={colW} height={ZERO_H} rx={1.5} className="report-zero-bar" />
              ) : (
                <>
                  {bar.regular > 0 && (
                    <rect
                      x={x}
                      y={yRegular}
                      width={colW}
                      height={Math.max(hRegular - (bar.excess > 0 ? SEG_GAP : 0), 2)}
                      rx={4}
                      className="report-bar regular"
                    />
                  )}
                  {bar.excess > 0 && (
                    <rect
                      x={x}
                      y={yTop}
                      width={colW}
                      height={Math.max(hExcess, 2)}
                      rx={4}
                      className="report-bar excess"
                    />
                  )}
                </>
              )}

              {/* Cifra encima de la columna */}
              <text
                x={cx}
                y={(vacio ? BASELINE - ZERO_H : yTop) - 9}
                textAnchor="middle"
                className={vacio ? "report-value zero" : "report-value"}
              >
                {formatHms(bar.total)}
              </text>

              {/* Día, bajo el eje */}
              <text x={cx} y={BASELINE + 22} textAnchor="middle" className="report-cat">
                {bar.label}
              </text>
            </g>
          );
        })}

        <line x1={PAD_L} x2={W - PAD_R} y1={BASELINE} y2={BASELINE} className="report-baseline" />
      </svg>

      {hoveredBar && hoveredBar.total > 0 && (
        <div className="report-tooltip" role="status">
          <strong>{hoveredBar.label}</strong>
          <span>Total {formatHms(hoveredBar.total)}</span>
          <span>Dentro de jornada {formatHms(hoveredBar.regular)}</span>
          {hoveredBar.excess > 0 && (
            <span className="excess">Horas extra {formatHms(hoveredBar.excess)}</span>
          )}
        </div>
      )}
    </div>
  );
}
