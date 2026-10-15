import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PublishReportDialog, type PublishRequest } from "../features/capacity/reports/PublishReportDialog";
import { MonthlyCapacityPanel } from "../features/capacity/monthly/MonthlyCapacityPanel";
import { defaultReportTitle, validateReportTitle } from "../features/capacity/reports/reportUtils";
import * as api from "../services/api";
import { sampleData, sampleReport } from "./capacityFixtures";

vi.mock("../services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api")>();
  return {
    ...actual,
    publishCapacityReport: vi.fn(),
    getCapacityMonthly: vi.fn(),
    getCapacitySettings: vi.fn(),
    getCapacityMonthlyConsultant: vi.fn(),
  };
});

const exportExcel = vi.fn();
vi.mock("../features/capacity/export/exportRenderers", () => ({
  exportCapacityExcel: (...a: unknown[]) => exportExcel(...a),
  exportCapacityPdf: vi.fn(),
}));

const REQUEST: PublishRequest = {
  from: "2026-01",
  to: "2026-12",
  includeProbables: true,
  internal: "exclude",
  country: "Ecuador",
  city: "Quito",
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  vi.mocked(api.getCapacitySettings).mockResolvedValue({
    underThresholdPct: 70, overThresholdPct: 100, includeProbablesDefault: false,
    alertsEnabled: true, alertHorizonMonths: 3, digestEnabled: true, digestWeekday: 1, digestHourUtc: 13, digestLastSentAt: null,
  });
  vi.mocked(api.getCapacityMonthly).mockResolvedValue(sampleData());
});

describe("reportUtils", () => {
  it("propone el título «Capacity <mes año> a <mes año>»", () => {
    expect(defaultReportTitle("2026-01", "2026-12")).toBe("Capacity ene 2026 a dic 2026");
  });
  it("el título es obligatorio", () => {
    expect(validateReportTitle("   ")).toMatch(/obligatorio/);
    expect(validateReportTitle("Capacity Q1")).toBeNull();
  });
});

describe("PublishReportDialog", () => {
  it("viene prellenado con el título sugerido y resume periodo, filtros y probables", () => {
    render(<PublishReportDialog request={REQUEST} onClose={vi.fn()} onPublished={vi.fn()} />);
    expect(screen.getByLabelText("Título")).toHaveValue("Capacity ene 2026 a dic 2026");
    expect(screen.getByText("Incluidas")).toBeInTheDocument();
    expect(screen.getByText("Excluidos")).toBeInTheDocument();
    expect(screen.getByText("Ecuador · Quito")).toBeInTheDocument();
  });

  it("no publica con el título vacío y muestra el error", async () => {
    render(<PublishReportDialog request={REQUEST} onClose={vi.fn()} onPublished={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Publicar reporte" }));
    expect(await screen.findByText("El título es obligatorio.")).toBeInTheDocument();
    expect(api.publishCapacityReport).not.toHaveBeenCalled();
  });

  it("envía los filtros actuales, el título y la nota; nunca el contenido", async () => {
    const report = sampleReport();
    vi.mocked(api.publishCapacityReport).mockResolvedValue(report);
    const onPublished = vi.fn();
    render(<PublishReportDialog request={REQUEST} onClose={vi.fn()} onPublished={onPublished} />);
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "  Cierre T1  " } });
    fireEvent.change(screen.getByLabelText("Nota (opcional)"), { target: { value: "Para junta" } });
    fireEvent.click(screen.getByRole("button", { name: "Publicar reporte" }));
    await waitFor(() => expect(onPublished).toHaveBeenCalledWith(report));
    expect(api.publishCapacityReport).toHaveBeenCalledWith({
      from: "2026-01", to: "2026-12", includeProbables: true, internal: "exclude",
      country: "Ecuador", city: "Quito", title: "Cierre T1", note: "Para junta",
    });
  });

  it("si el servidor falla muestra el error y deja el diálogo abierto", async () => {
    vi.mocked(api.publishCapacityReport).mockRejectedValue(new Error("Error 500"));
    const onPublished = vi.fn();
    render(<PublishReportDialog request={REQUEST} onClose={vi.fn()} onPublished={onPublished} />);
    fireEvent.click(screen.getByRole("button", { name: "Publicar reporte" }));
    expect(await screen.findByText("Error 500")).toBeInTheDocument();
    expect(onPublished).not.toHaveBeenCalled();
  });
});

describe("MonthlyCapacityPanel: exportar y publicar", () => {
  it("el botón Publicar solo aparece con permiso", async () => {
    const { unmount } = render(<MonthlyCapacityPanel />);
    await screen.findByText("Ana Pérez");
    expect(screen.queryByRole("button", { name: "Publicar reporte oficial" })).not.toBeInTheDocument();
    unmount();
    render(<MonthlyCapacityPanel canPublish />);
    expect(await screen.findByRole("button", { name: "Publicar reporte oficial" })).toBeInTheDocument();
  });

  it("publicar manda la vista actual y ofrece «Ver reporte»", async () => {
    vi.mocked(api.publishCapacityReport).mockResolvedValue(sampleReport());
    const onOpenReport = vi.fn();
    render(<MonthlyCapacityPanel canPublish onOpenReport={onOpenReport} />);
    fireEvent.click(await screen.findByRole("button", { name: "Publicar reporte oficial" }));
    fireEvent.click(await screen.findByRole("button", { name: "Publicar reporte" }));
    await waitFor(() => expect(api.publishCapacityReport).toHaveBeenCalled());
    expect(vi.mocked(api.publishCapacityReport).mock.calls[0][0]).toMatchObject({
      from: "2026-01", to: "2026-02", includeProbables: false, internal: "include",
    });
    fireEvent.click(await screen.findByRole("button", { name: "Ver reporte" }));
    expect(onOpenReport).toHaveBeenCalledWith("rep1");
  });

  it("exportar pide la vista actual con includeAssignments=true", async () => {
    exportExcel.mockResolvedValue("capacity_2026-01_2026-02.xlsx");
    render(<MonthlyCapacityPanel />);
    await screen.findByText("Ana Pérez");
    fireEvent.click(screen.getByRole("button", { name: /Exportar/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Excel (.xlsx)" }));
    await waitFor(() => expect(exportExcel).toHaveBeenCalled());
    const calls = vi.mocked(api.getCapacityMonthly).mock.calls;
    expect(calls[calls.length - 1][0]).toMatchObject({ includeAssignments: true });
  });

  it("mientras genera muestra «Generando…» y el botón queda bloqueado", async () => {
    let release: (v: string) => void = () => undefined;
    exportExcel.mockReturnValue(new Promise<string>((r) => { release = r; }));
    render(<MonthlyCapacityPanel />);
    await screen.findByText("Ana Pérez");
    fireEvent.click(screen.getByRole("button", { name: /Exportar/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Excel (.xlsx)" }));
    const busy = await screen.findByRole("button", { name: "Generando…" });
    expect(busy).toBeDisabled();
    release("x.xlsx");
    await waitFor(() => expect(screen.getByRole("button", { name: /Exportar/ })).toBeEnabled());
  });
});
