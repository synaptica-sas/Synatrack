import type { Expense, FxConfig } from "../../services/api";
import { convertToBase, numberish, fmtMoney, fmtDate } from "./gastosUtils";

export function GastosDetailRow({
  items,
  baseCurrency,
  fxConfigs,
  canWrite,
  colSpan,
  onEdit,
  onDelete,
}: {
  items: Expense[];
  baseCurrency: string;
  fxConfigs: FxConfig[];
  canWrite: boolean;
  colSpan: number;
  onEdit: (expense: Expense) => void;
  onDelete: (expense: Expense) => void;
}) {
  const subtotal = items.reduce(
    (s, e) => s + convertToBase(numberish(e.amount), e.currency, baseCurrency, fxConfigs).value,
    0,
  );

  return (
    <tr>
      <td
        colSpan={colSpan}
        style={{ padding: 0, background: "var(--card-bg)", borderBottom: "1px solid var(--color-primary-10)" }}
      >
        <div
          style={{
            padding: "0 0.75rem 0.6rem 2.5rem",
            animation: "fadeIn 0.18s ease",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
            <thead>
              <tr>
                <th style={thStyle}>Categoría</th>
                <th style={thStyle}>Monto original</th>
                <th style={thStyle}>Monto ({baseCurrency})</th>
                <th style={thStyle}>Fecha</th>
                {canWrite && <th style={{ ...thStyle, width: "4rem" }}>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((e) => {
                const { value, tooltip } = convertToBase(numberish(e.amount), e.currency, baseCurrency, fxConfigs);
                return (
                  <tr key={e.id} style={{ borderBottom: "1px solid var(--border-color)" }}>
                    <td style={tdStyle}>{e.category}</td>
                    <td style={tdStyle}>{fmtMoney(numberish(e.amount), e.currency)}</td>
                    <td
                      style={{ ...tdStyle, fontWeight: 600 }}
                      title={tooltip}
                    >
                      {fmtMoney(value, baseCurrency)}
                    </td>
                    <td style={tdStyle}>{fmtDate(e.expenseDate)}</td>
                    {canWrite && (
                      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                        <button
                          type="button"
                          title="Editar"
                          aria-label={`Editar gasto de ${e.category}`}
                          onClick={() => onEdit(e)}
                          style={iconBtn}
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          title="Eliminar"
                          aria-label={`Eliminar gasto de ${e.category}`}
                          onClick={() => onDelete(e)}
                          style={iconBtn}
                        >
                          🗑️
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ ...tdStyle, fontWeight: 700, color: "var(--text-strong)" }} colSpan={2}>
                  Subtotal
                </td>
                <td style={{ ...tdStyle, fontWeight: 700, color: "var(--text-strong)" }}>
                  {fmtMoney(subtotal, baseCurrency)}
                </td>
                <td colSpan={canWrite ? 2 : 1} />
              </tr>
            </tfoot>
          </table>
        </div>
      </td>
    </tr>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "0.3rem 0.5rem",
  fontSize: "0.68rem",
  color: "var(--color-accent)",
  fontWeight: 700,
  borderBottom: "1px solid var(--border-color)",
  background: "var(--state-neutral-bg)",
};

const tdStyle: React.CSSProperties = {
  padding: "0.35rem 0.5rem",
  color: "var(--text)",
  verticalAlign: "middle",
};

const iconBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: "0.9rem",
  padding: "0.1rem 0.25rem",
  borderRadius: "4px",
  lineHeight: 1,
};
