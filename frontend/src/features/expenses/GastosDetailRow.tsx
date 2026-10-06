import type { Expense } from "../../services/api";
import { numberish, fmtMoney, fmtDate, tooltipConversion } from "./gastosUtils";

export function GastosDetailRow({
  items,
  baseCurrency,
  canWrite,
  colSpan,
  onEdit,
  onDelete,
}: {
  items: Expense[];
  baseCurrency: string;
  canWrite: boolean;
  colSpan: number;
  onEdit: (expense: Expense) => void;
  onDelete: (expense: Expense) => void;
}) {
  // R-026: importes ya convertidos por el backend a la tasa de su fecha.
  const subtotal = items.reduce((s, e) => s + e.baseAmount, 0);

  return (
    <tr>
      <td colSpan={colSpan} className="gastos-detail-cell">
        <div className="gastos-detail-inner">
          <table className="gastos-subtable">
            <thead>
              <tr>
                <th>Categoría</th>
                <th>Monto original</th>
                <th>Monto ({baseCurrency})</th>
                <th>Fecha</th>
                {canWrite && <th className="gastos-subtable__col-actions">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((e) => {
                const value = e.baseAmount;
                const tooltip = tooltipConversion(e);
                return (
                  <tr key={e.id}>
                    <td>{e.category}</td>
                    <td>{fmtMoney(numberish(e.amount), e.currency)}</td>
                    <td className="cell-strong" title={tooltip}>
                      {fmtMoney(value, baseCurrency)}
                    </td>
                    <td>{fmtDate(e.expenseDate)}</td>
                    {canWrite && (
                      <td className="gastos-subtable__actions">
                        <button
                          type="button"
                          title="Editar"
                          aria-label={`Editar gasto de ${e.category}`}
                          onClick={() => onEdit(e)}
                          className="gastos-icon-btn"
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          title="Eliminar"
                          aria-label={`Eliminar gasto de ${e.category}`}
                          onClick={() => onDelete(e)}
                          className="gastos-icon-btn"
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
                <td className="gastos-subtable__total" colSpan={2}>
                  Subtotal
                </td>
                <td className="gastos-subtable__total">
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
