import { useState, Fragment } from "react";
import type { Expense } from "../../services/api";
import type { GroupBy, GroupedGasto, GastoTotals } from "./useGastosGrouped";
import { GastosDetailRow } from "./GastosDetailRow";
import { fmtMoney, fmtDate } from "./gastosUtils";

// ── Status badge ──────────────────────────────────────────────────────────────

/* El color nunca viaja solo: cada estado lleva su icono (forma distinta) y su
   etiqueta de texto. `.state-chip` ya resuelve el tinte y el modo oscuro. */
const STATUS_PRESENTATION: Record<GroupedGasto["status"], { tone: string; text: string }> = {
  exceeded: { tone: "danger",  text: "⚠ Superado" },
  warning:  { tone: "warning", text: "⚡ Cerca del límite" },
  ok:       { tone: "success", text: "✅ OK" },
};

function StatusBadge({ status }: { status: GroupedGasto["status"] }) {
  const s = STATUS_PRESENTATION[status];
  return <span className={`state-chip state-chip--${s.tone}`}>{s.text}</span>;
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <tr>
      <td colSpan={6} className="cell-empty cell-empty--roomy">
        <div className="empty-state">
          <div className="empty-state__icon">📋</div>
          <p className="empty-state__title">Sin gastos para los filtros seleccionados</p>
        </div>
      </td>
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function GastosSummaryTable({
  groups,
  totals,
  groupBy,
  baseCurrency,
  canWrite,
  onEdit,
  onDelete,
}: {
  groups: GroupedGasto[];
  totals: GastoTotals;
  groupBy: GroupBy;
  baseCurrency: string;
  canWrite: boolean;
  onEdit: (expense: Expense) => void;
  onDelete: (expense: Expense) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleRow(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const groupLabel =
    groupBy === "project"  ? "Proyecto" :
    groupBy === "category" ? "Categoría" :
    "Mes";

  // Summary table has 6 cols: label | # gastos | total | última fecha | estado | chevron
  const SUMMARY_COLS = 6;

  return (
    <div className="table-wrap">
      <table className="project-table gastos-table">
        <thead>
          <tr>
            <th className="gastos-col--group">{groupLabel}</th>
            <th className="gastos-col--count cell-center"># Gastos</th>
            <th className="gastos-col--total cell-right">Total ({baseCurrency})</th>
            <th className="gastos-col--date cell-center">Última fecha</th>
            {groupBy === "project" && (
              <th className="gastos-col--status cell-center">Estado</th>
            )}
            <th className="gastos-col--toggle cell-center" aria-label="Expandir" />
          </tr>
        </thead>
        <tbody role="rowgroup">
          {groups.length === 0 && <EmptyState />}

          {groups.map((group) => {
            const isOpen = expanded.has(group.key);
            return (
              <Fragment key={group.key}>
                {/* Summary row */}
                <tr
                  key={`sum-${group.key}`}
                  onClick={() => toggleRow(group.key)}
                  aria-expanded={isOpen}
                  className={isOpen ? "gastos-row is-open" : "gastos-row"}
                >
                  <td className="gastos-cell-group">
                    {group.label}
                  </td>
                  <td className="cell-center gastos-cell-soft">
                    {group.count}
                  </td>
                  <td className="cell-right gastos-cell-amount" title={group.tooltipBreakdown}>
                    {fmtMoney(group.totalBase, baseCurrency)}
                  </td>
                  <td className="cell-center gastos-cell-soft">
                    {fmtDate(group.lastDate)}
                  </td>
                  {groupBy === "project" && (
                    <td className="cell-center">
                      <StatusBadge status={group.status} />
                    </td>
                  )}
                  <td className="cell-center">
                    <button
                      type="button"
                      aria-label={`${isOpen ? "Colapsar" : "Expandir"} detalle de ${group.label}`}
                      onClick={(e) => { e.stopPropagation(); toggleRow(group.key); }}
                      className={isOpen ? "gastos-toggle is-open" : "gastos-toggle"}
                    >
                      ▶
                    </button>
                  </td>
                </tr>

                {/* Detail accordion row */}
                {isOpen && (
                  <GastosDetailRow
                    key={`det-${group.key}`}
                    items={group.items}
                    baseCurrency={baseCurrency}
                    canWrite={canWrite}
                    colSpan={groupBy === "project" ? SUMMARY_COLS : SUMMARY_COLS - 1}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                )}
              </Fragment>
            );
          })}
        </tbody>

        {/* Grand total footer */}
        {groups.length > 0 && (
          <tfoot>
            <tr className="gastos-total-row">
              <td className="gastos-cell-total">
                Total general
              </td>
              <td className="cell-center gastos-cell-total">
                {totals.count}
              </td>
              <td className="cell-right gastos-cell-total">
                {fmtMoney(totals.totalBase, baseCurrency)}
              </td>
              <td colSpan={groupBy === "project" ? 3 : 2} />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
