import { describe, it, expect } from 'vitest';
import {
  sortProjectRows,
  type ProjectAlertLevel,
} from '../features/dashboard/dashboardUtils';

// Prueba la MISMA función de orden que usa la tabla de DashboardTab
// (`sortProjectRows` en `features/dashboard/dashboardUtils.ts`), no una copia.
type MockRow = {
  projectName: string;
  budget: number;
  alertLevel: ProjectAlertLevel;
};

describe('table sort logic', () => {
  const rows: MockRow[] = [
    { projectName: "Alpha",   budget: 50000, alertLevel: "ok" },
    { projectName: "Beta",    budget: 80000, alertLevel: "exceeded" },
    { projectName: "Gamma",   budget: 30000, alertLevel: "warning" },
    { projectName: "Delta",   budget: 95000, alertLevel: "ok" },
  ];

  it('sorts by budget descending', () => {
    const sorted = sortProjectRows(rows, "budget", "desc");
    expect(sorted.map((r) => r.projectName)).toEqual(["Delta", "Beta", "Alpha", "Gamma"]);
  });

  it('sorts by budget ascending', () => {
    const sorted = sortProjectRows(rows, "budget", "asc");
    expect(sorted.map((r) => r.projectName)).toEqual(["Gamma", "Alpha", "Beta", "Delta"]);
  });

  it('sorts by alertLevel: exceeded first (desc = most critical first)', () => {
    const sorted = sortProjectRows(rows, "alertLevel", "asc"); // asc = 0 (exceeded) first
    expect(sorted[0].alertLevel).toBe("exceeded");
    expect(sorted[1].alertLevel).toBe("warning");
    expect(sorted[2].alertLevel).toBe("ok");
    expect(sorted[3].alertLevel).toBe("ok");
  });

  it('sorts by alertLevel: ok first (desc = least critical first)', () => {
    const sorted = sortProjectRows(rows, "alertLevel", "desc"); // desc = 2 (ok) first
    expect(sorted[0].alertLevel).toBe("ok");
    expect(sorted[3].alertLevel).toBe("exceeded");
  });

  it('does not mutate original array', () => {
    const original = [...rows];
    sortProjectRows(rows, "budget", "asc");
    expect(rows).toEqual(original);
  });
});
