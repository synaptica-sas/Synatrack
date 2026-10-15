import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MonthlyCapacityPanel } from "../features/capacity/monthly/MonthlyCapacityPanel";
import { CapacityHeatmap } from "../features/capacity/monthly/CapacityHeatmap";
import * as api from "../services/api";
import type { MonthlyCapacity, MonthlyCapacityCell, MonthlyCapacityTeamCell } from "../services/api";

vi.mock("../services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api")>();
  return { ...actual, getCapacityMonthly: vi.fn(), getCapacitySettings: vi.fn(), getCapacityMonthlyConsultant: vi.fn() };
});

function cell(month: string, over: Partial<MonthlyCapacityCell> = {}): MonthlyCapacityCell {
  return {
    month, workdays: 20, capacityHours: 160, assignedHours: 120, billableHours: 120, internalHours: 0,
    probableHours: 0, availableHours: 40, pct: 75, billablePct: 75, status: "OK", billableStatus: "OK", ...over,
  };
}
function teamCell(month: string): MonthlyCapacityTeamCell {
  return { ...cell(month), overCount: 0, underCount: 0 };
}
function sample(consultantMonths: MonthlyCapacityCell[]): MonthlyCapacity {
  const { month: _m, ...period } = cell("2026-01");
  void _m;
  return {
    from: "2026-01", to: "2026-02", includeProbables: false, internal: "include",
    settings: { underThresholdPct: 70, overThresholdPct: 100 },
    months: ["2026-01", "2026-02"],
    consultants: [{
      id: "c1", fullName: "Ana Pérez", country: "Ecuador", city: "Quito", company: null, isInternal: false,
      role: null, hireDate: null, exitDate: null, months: consultantMonths, period,
    }],
    team: { months: [teamCell("2026-01"), teamCell("2026-02")], period: { ...period, overCount: 0, underCount: 0 } },
    kpis: { utilizationPct: 75, billablePct: 75, overCount: 0, underCount: 0, availableHours: 80, capacityHours: 320, assignedHours: 240, consultantCount: 1 },
    warnings: [],
  };
}

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(api.getCapacityMonthly).mockReset();
  vi.mocked(api.getCapacitySettings).mockResolvedValue({
    underThresholdPct: 70, overThresholdPct: 100, includeProbablesDefault: false,
    alertsEnabled: true, alertHorizonMonths: 3, digestEnabled: true, digestWeekday: 1, digestHourUtc: 13, digestLastSentAt: null,
  });
});

describe("MonthlyCapacityPanel", () => {
  it("un error del servidor muestra estado de error y no una tabla vacía", async () => {
    vi.mocked(api.getCapacityMonthly).mockRejectedValue(new Error("Error 500"));
    render(<MonthlyCapacityPanel />);
    expect(await screen.findByText("No se pudo cargar la capacidad mensual")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText(/No hay consultores/)).not.toBeInTheDocument();
  });

  it("muestra el aviso de feriados sin confirmar", async () => {
    const data = sample([cell("2026-01"), cell("2026-02")]);
    data.warnings = [{ code: "HOLIDAYS_NOT_CONFIRMED", country: "Ecuador", year: 2027 }];
    vi.mocked(api.getCapacityMonthly).mockResolvedValue(data);
    render(<MonthlyCapacityPanel />);
    await waitFor(() =>
      expect(screen.getByText("Feriados de Ecuador 2027 sin confirmar: el cálculo puede estar incompleto.")).toBeInTheDocument(),
    );
  });

  it("muestra el estado vacío cuando no hay consultores", async () => {
    const data = sample([]);
    data.consultants = [];
    vi.mocked(api.getCapacityMonthly).mockResolvedValue(data);
    render(<MonthlyCapacityPanel />);
    expect(await screen.findByText("No hay consultores para mostrar")).toBeInTheDocument();
  });
});

describe("CapacityHeatmap", () => {
  it("muestra — cuando el porcentaje es null", () => {
    const data = sample([
      cell("2026-01", { pct: null, status: null, capacityHours: 0, assignedHours: 0 }),
      cell("2026-02"),
    ]);
    render(<CapacityHeatmap data={data} onSelect={vi.fn()} />);
    const row = screen.getByText("Ana Pérez").closest("tr");
    expect(row).not.toBeNull();
    const cells = row!.querySelectorAll("td.cap-cell");
    expect(cells[0].textContent).toBe("—");
    expect(cells[0].className).toContain("cap-cell--none");
    expect(cells[1].textContent).toBe("75%");
    expect(cells[1].className).toContain("cap-cell--ok");
  });
});

describe("etiqueta de tipo de consultor", () => {
  it("marca '· externo' solo cuando isInternal es false y no marca a los empleados", () => {
    const data = sample([cell("2026-01"), cell("2026-02")]);
    const { rerender } = render(<CapacityHeatmap data={data} onSelect={vi.fn()} />);
    expect(screen.getByText(/· externo/)).toBeInTheDocument();
    expect(screen.queryByText(/· interno/)).not.toBeInTheDocument();

    const empleado = { ...data, consultants: [{ ...data.consultants[0], isInternal: true }] };
    rerender(<CapacityHeatmap data={empleado} onSelect={vi.fn()} />);
    expect(screen.queryByText(/· externo/)).not.toBeInTheDocument();
    expect(screen.queryByText(/· interno/)).not.toBeInTheDocument();
  });
});

describe("persistencia del periodo", () => {
  it("al montar de nuevo conserva el rango guardado y lo usa en la consulta", async () => {
    sessionStorage.setItem(
      "synatrack.capacity.monthly.filters",
      JSON.stringify({ from: "2026-03", to: "2026-05", includeProbables: null, excludeInternal: false, country: "", city: "" }),
    );
    vi.mocked(api.getCapacityMonthly).mockResolvedValue(sample([cell("2026-01"), cell("2026-02")]));
    render(<MonthlyCapacityPanel />);
    await waitFor(() => expect(api.getCapacityMonthly).toHaveBeenCalled());
    expect(vi.mocked(api.getCapacityMonthly).mock.calls[0][0]).toMatchObject({ from: "2026-03", to: "2026-05" });
  });
});
