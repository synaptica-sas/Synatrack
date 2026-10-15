import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectDetailTab } from "../features/projects/ProjectDetailTab";
import * as api from "../services/api";
import type { ProjectDetail } from "../services/api";

vi.mock("../services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api")>();
  return { ...actual, getProjectDetail: vi.fn() };
});

// Detalle mínimo: solo lo que pinta la cabecera y las pestañas.
const detalle = {
  project: {
    id: "p1", name: "Proyecto X", company: "Cliente A", country: "Ecuador", currency: "USD",
    status: "ACTIVE", projectType: "FIXED_PRICE", phase: null, healthStatus: null, completionPct: null,
    projectManagerEmail: null, startDate: "2026-01-01", endDate: "2026-12-31", baselineBudget: null,
    baselineStartDate: null, baselineEndDate: null, baselineSetAt: null, baselineSetBy: null,
  },
  financials: {
    displayCurrency: "USD", budget: 0, spent: 0, laborCostActual: 0, expensesActual: 0, riskExposure: 0,
    remainingBudget: 0, usedBudgetPercent: 0, alertLevel: "ok", contractValue: 0, revenueRecognized: 0,
    grossMarginActual: 0, grossMarginActualPct: null, marginWarningPct: 30, marginCriticalPct: 15,
    marginLevel: "ok", projectedPct: 0, projectedTotal: 0, approvedHours: 0,
  },
  evm: null, milestones: [], risks: [], issues: [], changeRequests: [], assignments: [],
  summary: { totalMilestones: 0, completedMilestones: 0, delayedMilestones: 0, openRisks: 0, openHighRisks: 0, openIssues: 0, pendingChanges: 0 },
} as unknown as ProjectDetail;

describe("Detalle de proyecto: pestaña Recursos (D8, asignaciones confidenciales)", () => {
  it("no muestra Recursos a quien no tiene capacity:read", async () => {
    vi.mocked(api.getProjectDetail).mockResolvedValue(detalle);
    render(<ProjectDetailTab projectId="p1" canWrite={false} onBack={() => {}} onError={() => {}} />);
    expect(await screen.findByText("Hitos (0)")).toBeInTheDocument();
    expect(screen.queryByText(/^Recursos/)).not.toBeInTheDocument();
  });

  it("muestra Recursos con capacity:read", async () => {
    vi.mocked(api.getProjectDetail).mockResolvedValue(detalle);
    render(<ProjectDetailTab projectId="p1" canWrite={false} canSeeAssignments onBack={() => {}} onError={() => {}} />);
    expect(await screen.findByText("Recursos (0)")).toBeInTheDocument();
  });
});
