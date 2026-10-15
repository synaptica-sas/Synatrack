import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { PortfolioTab } from "../features/portfolio/PortfolioTab";
import type { Portfolio, PortfolioProject } from "../services/api";

/**
 * R-005 / R-032: el resumen de arriba (KPIs, distribución de salud, proyectos
 * críticos) debía reflejar el portafolio completo sin importar los filtros —
 * solo la tabla de abajo los respetaba. Ahora el resumen se recalcula sobre
 * los proyectos filtrados.
 */

vi.mock("../services/api", async () => {
  const actual = await vi.importActual<typeof import("../services/api")>("../services/api");
  return {
    ...actual,
    getPortfolio: vi.fn(),
  };
});

const api = await import("../services/api");

// Solo la parte numérica: el formato de moneda de `Intl` intercala un espacio
// de no separación entre el símbolo y la cifra, que no siempre coincide
// byte a byte entre el componente y la prueba aunque se vea igual impreso.
const num = (n: number) => new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 }).format(n);

function proyecto(overrides: Partial<PortfolioProject>): PortfolioProject {
  return {
    conversion: undefined,
    projectId: "p1",
    projectName: "Proyecto",
    company: "Empresa A",
    projectType: "TIME_AND_MATERIAL",
    status: "ACTIVE",
    phase: null,
    projectManagerEmail: null,
    startDate: null,
    endDate: null,
    completionPct: 50,
    healthStatus: "GREEN",
    displayCurrency: "USD",
    budget: 1000,
    spent: 500,
    usedBudgetPercent: 50,
    revenueRecognized: 800,
    grossMarginActual: 300,
    grossMarginActualPct: 37.5,
    marginWarningPct: 30,
    marginCriticalPct: 15,
    marginLevel: "ok",
    cpiLevel: "ok",
    spiLevel: "ok",
    budgetUseLevel: "ok",
    budgetAlertPct: 90,
    budgetCriticalPct: 100,
    alertLevel: "ok",
    evm: null,
    totalMilestones: 0,
    completedMilestones: 0,
    delayedMilestones: 0,
    totalRisks: 0,
    openHighRisks: 0,
    openIssues: 0,
    criticalIssues: 0,
    ...overrides,
  } as PortfolioProject;
}

const PROYECTO_VERDE = proyecto({
  projectId: "p1",
  projectName: "Proyecto Verde",
  company: "Empresa A",
  healthStatus: "GREEN",
  budget: 10000,
  spent: 2000,
  revenueRecognized: 8000,
  grossMarginActual: 6000,
});

const PROYECTO_ROJO = proyecto({
  projectId: "p2",
  projectName: "Proyecto Rojo",
  company: "Empresa B",
  healthStatus: "RED",
  budget: 5000,
  spent: 4500,
  revenueRecognized: 1000,
  grossMarginActual: -3500,
  alertLevel: "exceeded",
});

const PORTFOLIO: Portfolio = {
  baseCurrency: "USD",
  thresholds: { cpiWarning: 0.9, cpiCritical: 0.75, spiWarning: 0.9, spiCritical: 0.75 } as unknown as Portfolio["thresholds"],
  projects: [PROYECTO_VERDE, PROYECTO_ROJO],
  summary: {
    totalProjects: 2,
    byHealth: { GREEN: 1, YELLOW: 0, RED: 1 },
    byStatus: { ACTIVE: 2, PAUSED: 0, CLOSED: 0 },
    totalBudget: 15000,
    totalSpent: 6500,
    totalRevenue: 9000,
    totalGrossMargin: 2500,
    criticalCount: 1,
    alertCount: 1,
  },
};

function kpiValue(label: string) {
  const card = screen.getByText(label).closest(".kpi-card");
  if (!card) throw new Error(`No se encontró la tarjeta KPI "${label}"`);
  return within(card as HTMLElement);
}

/**
 * Busca por la magnitud de la cifra, sin depender de cómo `Intl` coloque el
 * símbolo de moneda ni el signo negativo (p. ej. "-US$ 3.500": el signo va
 * pegado al símbolo, no al número, así que no sirve de ancla).
 */
function getByAmount(scope: ReturnType<typeof within>, n: number) {
  return scope.getByText((content: string) => content.includes(num(Math.abs(n))));
}

describe("Portafolio: el resumen respeta los filtros (R-005/R-032)", () => {
  it("al filtrar por salud, los KPI y la distribución de salud solo cuentan los proyectos filtrados", async () => {
    vi.mocked(api.getPortfolio).mockResolvedValue(PORTFOLIO);
    render(<PortfolioTab />);

    // Estado inicial: sin filtro, el resumen cubre los dos proyectos.
    expect(await screen.findByText("Proyecto Verde")).toBeInTheDocument();
    expect(kpiValue("Total proyectos").getByText("2")).toBeInTheDocument();
    expect(getByAmount(kpiValue("Presupuesto total"), 15000)).toBeInTheDocument();

    // Filtrar a solo los proyectos en estado Crítico (RED) — queda solo "Proyecto Rojo".
    fireEvent.change(screen.getByLabelText("Salud"), { target: { value: "RED" } });

    // La tabla ya respetaba el filtro (eso nunca fue el bug): confirma que el
    // escenario de prueba filtra de verdad antes de revisar el resumen.
    // "Proyecto Rojo" aparece dos veces a propósito (tabla + aviso de críticos).
    expect(screen.queryByText("Proyecto Verde")).not.toBeInTheDocument();
    expect(screen.getAllByText("Proyecto Rojo").length).toBeGreaterThan(0);

    // El resumen de arriba debe seguir al filtro, no quedarse en el total global.
    expect(kpiValue("Total proyectos").getByText("1")).toBeInTheDocument();
    expect(getByAmount(kpiValue("Presupuesto total"), 5000)).toBeInTheDocument();
    expect(getByAmount(kpiValue("Ejecutado total"), 4500)).toBeInTheDocument();
    expect(getByAmount(kpiValue("Ingresos totales"), 1000)).toBeInTheDocument();
    expect(getByAmount(kpiValue("Margen bruto"), -3500)).toBeInTheDocument();

    // La lista de "Proyectos en estado crítico" es la misma clase de resumen:
    // tampoco debe mostrar proyectos fuera del filtro activo.
    const criticos = screen.getByText("Proyectos en estado crítico").closest(".notice");
    expect(criticos).not.toBeNull();
    expect(within(criticos as HTMLElement).getByText("Proyecto Rojo")).toBeInTheDocument();
    expect(within(criticos as HTMLElement).queryByText("Proyecto Verde")).not.toBeInTheDocument();
  });
});
