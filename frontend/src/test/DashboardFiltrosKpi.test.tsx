import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { DashboardTab } from "../features/dashboard/DashboardTab";
import type { Project, StatsOverview, StatsProjectRowEnriched } from "../services/api";

/**
 * Los KPI y la tabla del tablero leían `stats.projects` directo: los filtros
 * de Empresa/Proyecto/Estado/Tipo de esta pantalla nunca los tocaban (solo
 * afectaban los paneles de "Horas por consultor" y "Gastos por categoría").
 * Mismo bug que R-005/R-032 en Portafolio, mismo arreglo: recalcular sobre
 * los proyectos ya filtrados.
 */

function proyecto(overrides: Partial<StatsProjectRowEnriched>): StatsProjectRowEnriched {
  return {
    projectId: "p1",
    projectName: "Proyecto",
    company: "Empresa A",
    currency: "USD",
    projectType: "TIME_AND_MATERIAL",
    status: "ACTIVE",
    displayCurrency: "USD",
    budget: 1000,
    spent: 500,
    remainingBudget: 500,
    usedBudgetPercent: 50,
    projectedCost: 500,
    projectedTotal: 500,
    projectedPct: 50,
    estimateAtCompletion: 1000,
    budgetVariance: 0,
    contractValue: 1000,
    revenueRecognized: 800,
    grossMarginActual: 300,
    grossMarginActualPct: 37.5,
    grossMarginProjected: 300,
    grossMarginProjectedPct: 37.5,
    marginWarningPct: 30,
    marginCriticalPct: 15,
    marginLevel: "ok",
    totalHours: 10,
    approvedHours: 10,
    alertLevel: "ok",
    phase: null,
    completionPct: 50,
    healthStatus: "GREEN",
    evm: null,
    ...overrides,
  } as StatsProjectRowEnriched;
}

const PROYECTO_A = proyecto({
  projectId: "p1",
  projectName: "Proyecto Activo",
  company: "Empresa A",
  status: "ACTIVE",
  budget: 10000,
  spent: 2000,
  revenueRecognized: 8000,
  grossMarginActual: 6000,
});

const PROYECTO_B = proyecto({
  projectId: "p2",
  projectName: "Proyecto Pausado",
  company: "Empresa B",
  status: "PAUSED",
  budget: 5000,
  spent: 4500,
  revenueRecognized: 1000,
  grossMarginActual: -3500,
  alertLevel: "exceeded",
});

const STATS: StatsOverview = {
  baseCurrency: "USD",
  projects: [PROYECTO_A, PROYECTO_B],
  totals: {
    budget: 15000,
    spent: 6500,
    projectedCost: 5500,
    contractValue: 15000,
    revenueRecognized: 9000,
    grossMarginActual: 2500,
    totalHours: 20,
    approvedHours: 20,
    alertCount: 1,
    avgCpi: null,
    avgSpi: null,
  },
};

function proyectoBase(overrides: Partial<Project>): Project {
  return {
    id: "p1",
    name: "Proyecto",
    company: "Empresa A",
    country: "Colombia",
    currency: "USD",
    budget: "1000",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    description: null,
    projectType: "TIME_AND_MATERIAL",
    status: "ACTIVE",
    sellPrice: null,
    sellCurrency: "USD",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...overrides,
  } as Project;
}

const PROJECTS: Project[] = [
  proyectoBase({ id: "p1", name: "Proyecto Activo", company: "Empresa A", status: "ACTIVE" }),
  proyectoBase({ id: "p2", name: "Proyecto Pausado", company: "Empresa B", status: "PAUSED" }),
];

function kpiValue(label: string) {
  const card = screen.getByText(label).closest("article.card.kpi");
  if (!card) throw new Error(`No se encontró la tarjeta KPI "${label}"`);
  return within(card as HTMLElement);
}

describe("Tablero: los KPI respetan los filtros", () => {
  it("al filtrar por estado, los KPI y la tabla solo cuentan los proyectos filtrados", async () => {
    render(
      <DashboardTab
        projects={PROJECTS}
        timeEntries={[]}
        expenses={[]}
        fxConfigs={[]}
        initialStats={STATS}
        initialBaseCurrency="USD"
        statsError={null}
        statsLoading={false}
        onError={() => {}}
      />,
    );

    // Sin filtro: el resumen cubre los dos proyectos. "Proyecto Activo" sale
    // dos veces a propósito (tabla + gráfico de progreso presupuestal).
    expect((await screen.findAllByText("Proyecto Activo")).length).toBeGreaterThan(0);
    expect(kpiValue("Presupuesto total (USD)").getByText(/15\.000/)).toBeInTheDocument();

    // Filtrar a solo los proyectos en pausa — queda solo "Proyecto Pausado".
    fireEvent.change(screen.getByLabelText("Estado del Proyecto"), { target: { value: "PAUSED" } });

    expect(screen.queryByText("Proyecto Activo")).not.toBeInTheDocument();
    expect(screen.getAllByText("Proyecto Pausado").length).toBeGreaterThan(0);

    // Antes del arreglo, los KPI seguían mostrando el total de los dos
    // proyectos sin importar el filtro. Deben seguir al filtro activo.
    expect(kpiValue("Presupuesto total (USD)").getByText(/5\.000/)).toBeInTheDocument();
    expect(kpiValue("Gasto real (USD)").getByText(/4\.500/)).toBeInTheDocument();
    expect(kpiValue("Ingresos reconocidos (USD)").getByText(/1\.000/)).toBeInTheDocument();
  });
});
