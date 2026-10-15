import { useMemo, useState } from "react";
import type {
  CapacityStatus,
  MonthlyCapacity,
  MonthlyCapacityCell,
  MonthlyCapacityPeriod,
} from "../../../services/api";
import {
  STATUS_LABELS,
  formatHours,
  formatPct,
  monthHeader,
  sortConsultants,
  statusTone,
  type SortDir,
  type SortKey,
} from "./monthlyUtils";

/** Tooltip de una celda: "asignadas / capacidad h". */
function cellTitle(cell: Pick<MonthlyCapacityCell, "assignedHours" | "capacityHours" | "status">): string {
  const base = `${formatHours(cell.assignedHours)} / ${formatHours(cell.capacityHours)} h`;
  return cell.status ? `${base} (${STATUS_LABELS[cell.status]})` : base;
}

/** Celda de porcentaje. El número siempre se escribe: el color solo lo refuerza. */
export function PctCell({
  cell,
  className = "",
}: {
  cell: Pick<MonthlyCapacityPeriod, "pct" | "status" | "assignedHours" | "capacityHours">;
  className?: string;
}) {
  const tone = statusTone(cell.status);
  return (
    <td className={`cap-cell cap-cell--${tone} ${className}`.trim()} title={cellTitle(cell)}>
      {formatPct(cell.pct)}
    </td>
  );
}

export function CapacityHeatmap({
  data,
  onSelect,
}: {
  data: MonthlyCapacity;
  onSelect: (consultantId: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const rows = useMemo(() => sortConsultants(data.consultants, sortKey, sortDir), [data.consultants, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "period" ? "desc" : "asc");
    }
  }

  function sortHead(key: SortKey, label: string, extraClass = "") {
    const active = sortKey === key;
    return (
      <th
        className={`is-sortable ${extraClass}`.trim()}
        aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      >
        <button type="button" className="cap-sort" onClick={() => toggleSort(key)}>
          {label}
          <span aria-hidden="true">{active ? (sortDir === "asc" ? " ▲" : " ▼") : ""}</span>
        </button>
      </th>
    );
  }

  const under = data.settings.underThresholdPct;
  const over = data.settings.overThresholdPct;
  const legend: [CapacityStatus, string][] = [
    ["OVER", `Sobreasignado (más de ${over}%)`],
    ["OK", `En rango (${under}% a ${over}%)`],
    ["UNDER", `Subutilizado (menos de ${under}%)`],
  ];

  return (
    <div className="panel">
      <div className="panel__head">
        <h3 className="panel__title">Utilización por consultor y mes</h3>
      </div>
      <div className="cap-legend" aria-label="Leyenda de colores">
        {legend.map(([status, text]) => (
          <span key={status} className="cap-legend__item">
            <span className={`cap-swatch cap-swatch--${statusTone(status)}`} aria-hidden="true" />
            {text}
          </span>
        ))}
        <span className="cap-legend__item">
          <span className="cap-swatch cap-swatch--none" aria-hidden="true" />
          Sin capacidad (—)
        </span>
      </div>
      <div className="table-wrap cap-heatmap-wrap">
        <table className="cap-heatmap">
          <thead>
            <tr>
              {sortHead("name", "Consultor", "cap-sticky")}
              {sortHead("country", "País")}
              {data.months.map((m) => (
                <th key={m} className="cell-center">{monthHeader(m)}</th>
              ))}
              {sortHead("period", "Periodo", "cap-period-col")}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="cap-row" onClick={() => onSelect(c.id)}>
                <td className="cap-sticky cap-name">
                  <button
                    type="button"
                    className="cap-link"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(c.id);
                    }}
                    aria-label={`Ver detalle de ${c.fullName}`}
                  >
                    {c.fullName}
                  </button>
                  {c.isInternal === false && <span className="cell-meta"> · externo</span>}
                </td>
                <td className="cell-small">
                  {c.country ?? <span className="cell-empty">sin país</span>}
                  {c.city ? <span className="cell-meta"> · {c.city}</span> : null}
                </td>
                {c.months.map((cell) => (
                  <PctCell key={cell.month} cell={cell} />
                ))}
                <PctCell cell={c.period} className="cap-period-col" />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="cap-team-row">
              <th scope="row" className="cap-sticky">Equipo</th>
              <td />
              {data.team.months.map((cell) => (
                <PctCell key={cell.month} cell={cell} className="cap-team-cell" />
              ))}
              <PctCell cell={data.team.period} className="cap-period-col cap-team-cell" />
            </tr>
            <tr className="cap-team-counts">
              <th scope="row" className="cap-sticky">Sobreasignados</th>
              <td />
              {data.team.months.map((cell) => (
                <td key={cell.month} className="cell-center">{cell.overCount}</td>
              ))}
              <td className="cell-center cap-period-col">{data.team.period.overCount}</td>
            </tr>
            <tr className="cap-team-counts">
              <th scope="row" className="cap-sticky">Subutilizados</th>
              <td />
              {data.team.months.map((cell) => (
                <td key={cell.month} className="cell-center">{cell.underCount}</td>
              ))}
              <td className="cell-center cap-period-col">{data.team.period.underCount}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="field-help">
        Haz clic en un consultor para ver sus proyectos por mes. Pasa el cursor sobre una celda para ver horas asignadas y capacidad.
      </p>
    </div>
  );
}
