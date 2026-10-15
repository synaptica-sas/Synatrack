import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CapacityThresholdsSection } from "../features/workday/CapacityThresholdsSection";
import { localToUtc, utcToLocal, validarAlertas } from "../features/workday/digestSchedule";

const getCapacitySettings = vi.fn();
const updateCapacitySettings = vi.fn();

vi.mock("../services/api", async () => {
  const actual = await vi.importActual<typeof import("../services/api")>("../services/api");
  return {
    ...actual,
    getCapacitySettings: (...a: unknown[]) => getCapacitySettings(...a),
    updateCapacitySettings: (...a: unknown[]) => updateCapacitySettings(...a),
  };
});

const BASE = {
  underThresholdPct: 70, overThresholdPct: 100, includeProbablesDefault: false,
  alertsEnabled: true, alertHorizonMonths: 3, digestEnabled: true, digestWeekday: 1, digestHourUtc: 13, digestLastSentAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  getCapacitySettings.mockResolvedValue(BASE);
  updateCapacitySettings.mockImplementation(async (p: object) => ({ ...BASE, ...p }));
});

describe("conversión hora local (UTC-5) <-> UTC", () => {
  it("13 UTC son las 08:00 de Bogotá/Quito", () => {
    expect(utcToLocal({ weekday: 1, hour: 13 })).toEqual({ weekday: 1, hour: 8 });
    expect(localToUtc({ weekday: 1, hour: 8 })).toEqual({ weekday: 1, hour: 13 });
  });

  it("guarda digestHourUtc = (local + 5) mod 24", () => {
    for (let h = 0; h < 24; h += 1) {
      expect(localToUtc({ weekday: 3, hour: h }).hour).toBe((h + 5) % 24);
    }
  });

  it("pasada la medianoche UTC el día avanza (y el domingo da la vuelta al lunes)", () => {
    expect(localToUtc({ weekday: 1, hour: 21 })).toEqual({ weekday: 2, hour: 2 });
    expect(localToUtc({ weekday: 7, hour: 20 })).toEqual({ weekday: 1, hour: 1 });
    expect(localToUtc({ weekday: 1, hour: 18 })).toEqual({ weekday: 1, hour: 23 });
  });

  it("la inversa retrocede el día cuando la hora UTC es menor a 5", () => {
    expect(utcToLocal({ weekday: 2, hour: 2 })).toEqual({ weekday: 1, hour: 21 });
    expect(utcToLocal({ weekday: 1, hour: 1 })).toEqual({ weekday: 7, hour: 20 });
    expect(utcToLocal({ weekday: 1, hour: 5 })).toEqual({ weekday: 1, hour: 0 });
  });

  it("ida y vuelta devuelve lo mismo para todas las horas y días", () => {
    for (let d = 1; d <= 7; d += 1) {
      for (let h = 0; h < 24; h += 1) {
        expect(utcToLocal(localToUtc({ weekday: d, hour: h }))).toEqual({ weekday: d, hour: h });
      }
    }
  });
});

describe("validarAlertas", () => {
  it("el horizonte es un entero entre 1 y 12", () => {
    expect(validarAlertas({ horizon: "0", weekday: 1, hour: 8 })).toMatch(/entre 1 y 12/);
    expect(validarAlertas({ horizon: "13", weekday: 1, hour: 8 })).not.toBeNull();
    expect(validarAlertas({ horizon: "2,5", weekday: 1, hour: 8 })).not.toBeNull();
    expect(validarAlertas({ horizon: "", weekday: 1, hour: 8 })).not.toBeNull();
    expect(validarAlertas({ horizon: "12", weekday: 7, hour: 23 })).toBeNull();
  });
  it("día y hora dentro de rango", () => {
    expect(validarAlertas({ horizon: "3", weekday: 8, hour: 8 })).toMatch(/día/);
    expect(validarAlertas({ horizon: "3", weekday: 1, hour: 24 })).toMatch(/hora/);
  });
});

describe("CapacityThresholdsSection: alertas y resumen semanal", () => {
  it("muestra la hora local a partir de la hora UTC guardada y el último envío", async () => {
    getCapacitySettings.mockResolvedValue({ ...BASE, digestLastSentAt: "2026-10-12T13:00:00.000Z" });
    render(<CapacityThresholdsSection canWrite onError={vi.fn()} onSuccess={vi.fn()} />);
    expect(await screen.findByLabelText(/Hora de envío/)).toHaveValue("8");
    expect(screen.getByLabelText("Día de envío")).toHaveValue("1");
    expect(screen.getByLabelText(/Horizonte de alertas/)).toHaveValue(3);
    expect(screen.getByText(/Último envío: (?!todavía)/)).toBeInTheDocument();
    expect(screen.getByText(/lunes a las 13:00 UTC/)).toBeInTheDocument();
  });

  it("guarda la hora convertida a UTC", async () => {
    const onSuccess = vi.fn();
    render(<CapacityThresholdsSection canWrite onError={vi.fn()} onSuccess={onSuccess} />);
    fireEvent.change(await screen.findByLabelText(/Horizonte de alertas/), { target: { value: "6" } });
    fireEvent.change(screen.getByLabelText("Día de envío"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/Hora de envío/), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar alertas" }));
    await waitFor(() =>
      expect(updateCapacitySettings).toHaveBeenCalledWith({
        underThresholdPct: 70, overThresholdPct: 100, includeProbablesDefault: false,
        alertsEnabled: true, alertHorizonMonths: 6, digestEnabled: true, digestWeekday: 5, digestHourUtc: 14,
      }),
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it("no guarda un horizonte fuera de 1–12", async () => {
    render(<CapacityThresholdsSection canWrite onError={vi.fn()} onSuccess={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText(/Horizonte de alertas/), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar alertas" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/entre 1 y 12/);
    expect(updateCapacitySettings).not.toHaveBeenCalled();
  });

  it("sin permiso de escritura no hay botón de guardar", async () => {
    render(<CapacityThresholdsSection canWrite={false} onError={vi.fn()} onSuccess={vi.fn()} />);
    await screen.findByLabelText(/Horizonte de alertas/);
    expect(screen.queryByRole("button", { name: "Guardar alertas" })).not.toBeInTheDocument();
  });
});
