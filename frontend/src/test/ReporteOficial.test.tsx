import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ReportView } from "../features/capacity/reports/ReportView";
import { ReportsPanel } from "../features/capacity/reports/ReportsPanel";
import { RevokeReportDialog } from "../features/capacity/reports/RevokeReportDialog";
import { frozenConsultantDetail, validateRevokeReason } from "../features/capacity/reports/reportUtils";
import * as api from "../services/api";
import { sampleData, sampleReport } from "./capacityFixtures";

vi.mock("../services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api")>();
  return {
    ...actual,
    getCapacityReport: vi.fn(),
    listCapacityReports: vi.fn(),
    revokeCapacityReport: vi.fn(),
    getCapacityMonthly: vi.fn(),
    getCapacityMonthlyConsultant: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ReportView", () => {
  it("muestra los datos congelados sin llamar a /monthly ni al detalle del consultor", async () => {
    vi.mocked(api.getCapacityReport).mockResolvedValue(sampleReport());
    render(<ReportView reportId="rep1" canPublish={false} onBack={vi.fn()} />);
    expect(await screen.findByText("Capacity ene 2026 a feb 2026")).toBeInTheDocument();
    expect(screen.getByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByText(/Cierre del trimestre/)).toBeInTheDocument();
    expect(screen.getByText("Vigente")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Anular" })).not.toBeInTheDocument();

    // Abrir el panel de un consultor usa el payload, no la API.
    fireEvent.click(screen.getByRole("button", { name: "Ver detalle de Ana Pérez" }));
    expect(await screen.findByText("Proyecto Alfa")).toBeInTheDocument();
    expect(api.getCapacityMonthly).not.toHaveBeenCalled();
    expect(api.getCapacityMonthlyConsultant).not.toHaveBeenCalled();
  });

  it("un reporte anulado muestra ANULADO con el motivo y sin botón Anular", async () => {
    vi.mocked(api.getCapacityReport).mockResolvedValue(
      sampleReport({ revokedAt: "2026-10-16T15:00:00.000Z", revokedBy: "otro@synaptica.com", revokeReason: "Feriados mal cargados" }),
    );
    render(<ReportView reportId="rep1" canPublish onBack={vi.fn()} />);
    expect((await screen.findAllByText("ANULADO")).length).toBeGreaterThan(0);
    expect(screen.getByText(/Feriados mal cargados/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Anular" })).not.toBeInTheDocument();
  });

  it("muestra el error de carga con opción de reintentar", async () => {
    vi.mocked(api.getCapacityReport).mockRejectedValueOnce(new Error("Error 500"));
    render(<ReportView reportId="rep1" canPublish={false} onBack={vi.fn()} />);
    expect(await screen.findByText("No se pudo cargar el reporte oficial")).toBeInTheDocument();
    expect(screen.getByText("Error 500")).toBeInTheDocument();
    vi.mocked(api.getCapacityReport).mockResolvedValue(sampleReport());
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Capacity ene 2026 a feb 2026")).toBeInTheDocument();
  });

  it("el ADMIN anula con motivo y el reporte pasa a ANULADO", async () => {
    vi.mocked(api.getCapacityReport).mockResolvedValue(sampleReport());
    const { revokedAt: _r, revokedBy: _b, revokeReason: _m, payload: _p, ...summary } = sampleReport();
    void _r; void _b; void _m; void _p;
    vi.mocked(api.revokeCapacityReport).mockResolvedValue({
      ...summary, revokedAt: "2026-10-16T15:00:00.000Z", revokedBy: "admin@synaptica.com", revokeReason: "Cifras equivocadas",
    });
    const onChanged = vi.fn();
    render(<ReportView reportId="rep1" canPublish onBack={vi.fn()} onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole("button", { name: "Anular" }));
    const dialog = await screen.findByRole("dialog", { name: "Anular reporte oficial" });
    fireEvent.change(within(dialog).getByLabelText("Motivo de la anulación"), { target: { value: "Cifras equivocadas" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Anular reporte" }));
    await waitFor(() => expect(api.revokeCapacityReport).toHaveBeenCalledWith("rep1", "Cifras equivocadas"));
    expect((await screen.findAllByText("ANULADO")).length).toBeGreaterThan(0);
    expect(onChanged).toHaveBeenCalled();
  });
});

describe("anular: motivo mínimo", () => {
  it("validateRevokeReason exige 5 caracteres", () => {
    expect(validateRevokeReason("    ab ")).toMatch(/al menos 5/);
    expect(validateRevokeReason("abcd")).not.toBeNull();
    expect(validateRevokeReason("abcde")).toBeNull();
  });

  it("el diálogo no envía un motivo corto", async () => {
    const onRevoked = vi.fn();
    render(<RevokeReportDialog reportId="rep1" title="Reporte" onClose={vi.fn()} onRevoked={onRevoked} />);
    fireEvent.change(screen.getByLabelText("Motivo de la anulación"), { target: { value: "no" } });
    fireEvent.click(screen.getByRole("button", { name: "Anular reporte" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/al menos 5 caracteres/);
    expect(api.revokeCapacityReport).not.toHaveBeenCalled();
    expect(onRevoked).not.toHaveBeenCalled();
  });

  it("si el servidor responde 409 muestra el error", async () => {
    vi.mocked(api.revokeCapacityReport).mockRejectedValue(new Error("El reporte ya estaba anulado"));
    render(<RevokeReportDialog reportId="rep1" title="Reporte" onClose={vi.fn()} onRevoked={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Motivo de la anulación"), { target: { value: "motivo válido" } });
    fireEvent.click(screen.getByRole("button", { name: "Anular reporte" }));
    expect(await screen.findByText("El reporte ya estaba anulado")).toBeInTheDocument();
  });
});

describe("ReportsPanel", () => {
  it("lista los reportes con su estado y pagina", async () => {
    const { payload: _p, ...vigente } = sampleReport();
    void _p;
    const anulado = { ...vigente, id: "rep2", title: "Otro reporte", revokedAt: "2026-10-16T15:00:00.000Z", revokedBy: "x", revokeReason: "Error" };
    vi.mocked(api.listCapacityReports).mockResolvedValue({
      data: [vigente, anulado],
      meta: { total: 45, page: 1, pageSize: 20, totalPages: 3 },
    });
    const onSelect = vi.fn();
    render(<ReportsPanel canPublish={false} selectedId={null} onSelect={onSelect} />);
    expect(await screen.findByText("Vigente")).toBeInTheDocument();
    expect(screen.getByText("Anulado")).toBeInTheDocument();
    expect(screen.getByText(/Página 1 de 3/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    await waitFor(() => expect(api.listCapacityReports).toHaveBeenLastCalledWith(2));

    fireEvent.click(screen.getByRole("button", { name: "Abrir reporte Otro reporte" }));
    expect(onSelect).toHaveBeenCalledWith("rep2");
  });

  it("estado vacío", async () => {
    vi.mocked(api.listCapacityReports).mockResolvedValue({ data: [], meta: { total: 0, page: 1, pageSize: 20, totalPages: 0 } });
    render(<ReportsPanel canPublish={false} selectedId={null} onSelect={vi.fn()} />);
    expect(await screen.findByText("Aún no hay reportes oficiales")).toBeInTheDocument();
  });

  it("un error del servidor no se ve como lista vacía", async () => {
    vi.mocked(api.listCapacityReports).mockRejectedValue(new Error("Error 500"));
    render(<ReportsPanel canPublish={false} selectedId={null} onSelect={vi.fn()} />);
    expect(await screen.findByText("No se pudieron cargar los reportes oficiales")).toBeInTheDocument();
    expect(screen.queryByText("Aún no hay reportes oficiales")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });
});

describe("frozenConsultantDetail", () => {
  it("arma el detalle desde el payload y devuelve undefined si no existe", () => {
    const d = frozenConsultantDetail(sampleData(), "c1");
    expect(d?.consultant.fullName).toBe("Ana Pérez");
    expect(d?.assignments).toHaveLength(2);
    expect(d?.months).toHaveLength(2);
    expect(frozenConsultantDetail(sampleData(), "nope")).toBeUndefined();
  });
});
