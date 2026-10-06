import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GastosSummaryTable } from '../features/expenses/GastosSummaryTable';
import type { GroupedGasto, GastoTotals } from '../features/expenses/useGastosGrouped';
import type { Expense } from '../services/api';

const expense: Expense = {
  id: "e1",
  projectId: "p1",
  expenseDate: "2026-04-01",
  category: "Viajes",
  amount: "500",
  currency: "USD",
  description: null,
  createdAt: "",
  updatedAt: "",
  baseAmount: 500,
  baseCurrency: "USD",
  conversionQuality: "dated",
  project: { id: "p1", name: "Proyecto Alpha", company: "ACME", country: "", currency: "USD", projectType: "TIME_AND_MATERIAL", status: "ACTIVE", budget: "10000", startDate: "", endDate: "", description: null, sellPrice: null, sellCurrency: "", createdAt: "", updatedAt: "" },
};

const groups: GroupedGasto[] = [
  {
    key: "p1",
    label: "Proyecto Alpha",
    count: 1,
    totalBase: 500,
    lastDate: "2026-04-01",
    status: "ok",
    items: [expense],
    tooltipBreakdown: "US$ 500,00 = US$ 500,00",
  },
  {
    key: "p2",
    label: "Proyecto Beta",
    count: 2,
    totalBase: 1500,
    lastDate: "2026-04-14",
    status: "exceeded",
    items: [expense],
    tooltipBreakdown: "US$ 1.500,00 = US$ 1.500,00",
  },
];

const totals: GastoTotals = { count: 3, totalBase: 2000 };

const defaultProps = {
  groups,
  totals,
  groupBy: "project" as const,
  baseCurrency: "USD",
  canWrite: true,
  onEdit: vi.fn(),
  onDelete: vi.fn(),
};

describe('GastosSummaryTable', () => {
  it('renders one summary row per group', () => {
    render(<GastosSummaryTable {...defaultProps} />);
    expect(screen.getByText("Proyecto Alpha")).toBeInTheDocument();
    expect(screen.getByText("Proyecto Beta")).toBeInTheDocument();
  });

  it('renders total general row in footer', () => {
    render(<GastosSummaryTable {...defaultProps} />);
    expect(screen.getByText("Total general")).toBeInTheDocument();
  });

  it('shows "⚠ Superado" badge for exceeded status', () => {
    render(<GastosSummaryTable {...defaultProps} />);
    expect(screen.getByText("⚠ Superado")).toBeInTheDocument();
  });

  it('shows "✅ OK" badge for ok status', () => {
    render(<GastosSummaryTable {...defaultProps} />);
    expect(screen.getByText("✅ OK")).toBeInTheDocument();
  });

  it('detail row is not visible before expansion', () => {
    render(<GastosSummaryTable {...defaultProps} />);
    // "Monto original" header only shows in the detail sub-table
    expect(screen.queryByText("Monto original")).not.toBeInTheDocument();
  });

  it('expands detail row when chevron button is clicked', () => {
    render(<GastosSummaryTable {...defaultProps} />);
    const expandBtn = screen.getAllByRole('button', { name: /expandir detalle/i })[0];
    fireEvent.click(expandBtn);
    expect(screen.getByText("Monto original")).toBeInTheDocument();
  });

  it('collapses detail row on second click', () => {
    render(<GastosSummaryTable {...defaultProps} />);
    const expandBtn = screen.getAllByRole('button', { name: /expandir detalle/i })[0];
    fireEvent.click(expandBtn);
    expect(screen.getByText("Monto original")).toBeInTheDocument();
    // click again on the same button (now labeled "colapsar")
    const collapseBtn = screen.getByRole('button', { name: /colapsar detalle/i });
    fireEvent.click(collapseBtn);
    expect(screen.queryByText("Monto original")).not.toBeInTheDocument();
  });

  it('clicking the row itself also expands', () => {
    render(<GastosSummaryTable {...defaultProps} />);
    const row = screen.getByText("Proyecto Alpha").closest('tr')!;
    fireEvent.click(row);
    expect(screen.getByText("Monto original")).toBeInTheDocument();
  });

  it('shows empty state when groups is empty', () => {
    render(<GastosSummaryTable {...defaultProps} groups={[]} totals={{ count: 0, totalBase: 0 }} />);
    expect(screen.getByText(/Sin gastos para los filtros/i)).toBeInTheDocument();
  });

  it('renders action icons when canWrite=true and row is expanded', () => {
    render(<GastosSummaryTable {...defaultProps} />);
    const expandBtn = screen.getAllByRole('button', { name: /expandir detalle/i })[0];
    fireEvent.click(expandBtn);
    expect(screen.getByRole('button', { name: /editar gasto/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /eliminar gasto/i })).toBeInTheDocument();
  });

  it('hides action icons when canWrite=false', () => {
    render(<GastosSummaryTable {...defaultProps} canWrite={false} />);
    const expandBtn = screen.getAllByRole('button', { name: /expandir detalle/i })[0];
    fireEvent.click(expandBtn);
    expect(screen.queryByRole('button', { name: /editar gasto/i })).not.toBeInTheDocument();
  });
});
