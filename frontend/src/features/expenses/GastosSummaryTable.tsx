import { useState, Fragment } from "react";
import type { Expense, FxConfig } from "../../services/api";
import type { GroupBy, GroupedGasto, GastoTotals } from "./useGastosGrouped";
import { GastosDetailRow } from "./GastosDetailRow";
import { fmtMoney, fmtDate } from "./gastosUtils";

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: GroupedGasto["status"] }) {
  const map = {
    exceeded: { bg: "var(--state-danger-bg)", color: "var(--state-danger-text)", text: "⚠ Superado" },
    warning:  { bg: "var(--state-warning-bg)", color: "var(--state-warning-text)", text: "⚡ Cerca del límite" },
    ok:       { bg: "var(--state-success-bg)", color: "var(--state-success-text)", text: "✅ OK" },
  };
  const s = map[status];
  return (
    <span style={{
      background: s.bg,
      color: s.color,
      borderRadius: "9999px",
      padding: "0.2rem 0.6rem",
      fontSize: "0.68rem",
      fontWeight: 700,
      whiteSpace: "nowrap",
    }}>
      {s.text}
    </span>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <tr>
      <td colSpan={6} style={{ padding: "2rem", textAlign: "center", color: "var(--color-accent)" }}>
        <div style={{ fontSize: "1.5rem", marginBottom: "0.3rem" }}>📋</div>
        <p style={{ margin: 0, fontWeight: 600 }}>Sin gastos para los filtros seleccionados</p>
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
  fxConfigs,
  canWrite,
  onEdit,
  onDelete,
}: {
  groups: GroupedGasto[];
  totals: GastoTotals;
  groupBy: GroupBy;
  baseCurrency: string;
  fxConfigs: FxConfig[];
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
      <table className="project-table" style={{ fontSize: "0.82rem" }}>
        <thead>
          <tr>
            <th style={{ width: "36%" }}>{groupLabel}</th>
            <th style={{ width: "8%", textAlign: "center" }}># Gastos</th>
            <th style={{ width: "20%", textAlign: "right" }}>Total ({baseCurrency})</th>
            <th style={{ width: "14%", textAlign: "center" }}>Última fecha</th>
            {groupBy === "project" && (
              <th style={{ width: "16%", textAlign: "center" }}>Estado</th>
            )}
            <th style={{ width: "6%", textAlign: "center" }} aria-label="Expandir" />
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
                  style={{
                    cursor: "pointer",
                    background: isOpen ? "var(--state-neutral-bg)" : undefined,
                    transition: "background 0.15s",
                  }}
                >
                  <td style={{ fontWeight: 600, color: "var(--text-strong)", padding: "0.55rem 0.75rem" }}>
                    {group.label}
                  </td>
                  <td style={{ textAlign: "center", color: "var(--text-soft)" }}>
                    {group.count}
                  </td>
                  <td
                    style={{ textAlign: "right", fontWeight: 700, color: "var(--text-strong)" }}
                    title={group.tooltipBreakdown}
                  >
                    {fmtMoney(group.totalBase, baseCurrency)}
                  </td>
                  <td style={{ textAlign: "center", color: "var(--text-soft)" }}>
                    {fmtDate(group.lastDate)}
                  </td>
                  {groupBy === "project" && (
                    <td style={{ textAlign: "center" }}>
                      <StatusBadge status={group.status} />
                    </td>
                  )}
                  <td style={{ textAlign: "center" }}>
                    <button
                      type="button"
                      aria-label={`${isOpen ? "Colapsar" : "Expandir"} detalle de ${group.label}`}
                      onClick={(e) => { e.stopPropagation(); toggleRow(group.key); }}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontSize: "0.75rem",
                        color: "var(--color-accent)",
                        fontWeight: 700,
                        padding: "0.2rem 0.35rem",
                        borderRadius: "4px",
                        transition: "transform 0.2s",
                        transform: isOpen ? "rotate(90deg)" : "none",
                        display: "inline-block",
                      }}
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
                    fxConfigs={fxConfigs}
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
            <tr style={{ borderTop: "2px solid var(--border-color)", background: "var(--state-neutral-bg)" }}>
              <td style={{ padding: "0.5rem 0.75rem", fontWeight: 800, color: "var(--text-strong)" }}>
                Total general
              </td>
              <td style={{ textAlign: "center", fontWeight: 700, color: "var(--text-strong)" }}>
                {totals.count}
              </td>
              <td style={{ textAlign: "right", fontWeight: 800, color: "var(--text-strong)" }}>
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
