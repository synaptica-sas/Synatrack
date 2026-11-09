import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AlertsPanel } from "../components/AlertsPanel";
import { AlertsTab } from "../features/alerts/AlertsTab";
import type { AppAlert } from "../services/api";

vi.mock("../services/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/api")>();
  return {
    ...real,
    resolveAlert: vi.fn().mockRejectedValue(new Error("No tienes permiso para resolver esta alerta")),
    runAlertEngine: vi.fn(),
  };
});

function alerta(id: string, canResolve: boolean): AppAlert {
  return {
    id,
    projectId: null,
    consultantId: null,
    type: "BUDGET_EXCEEDED",
    severity: "WARNING",
    message: `Mensaje ${id}`,
    resolvedAt: null,
    resolvedBy: null,
    createdAt: "2026-11-01T10:00:00.000Z",
    canResolve,
  };
}

describe("Alertas: botón Resolver según canResolve", () => {
  it("el panel muestra Resolver solo en las alertas con canResolve", () => {
    render(
      <AlertsPanel
        alerts={[alerta("a1", true), alerta("a2", false)]}
        unreadCount={2}
        canRun={false}
        onReload={async () => {}}
        onError={() => {}}
      />,
    );
    // El grupo "Presupuesto" viene expandido por defecto.
    expect(screen.getByText("Mensaje a1")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Resolver" })).toHaveLength(1);
  });

  it("la pestaña oculta Resolver cuando canResolve es false", () => {
    render(
      <AlertsTab alerts={[alerta("a2", false)]} unreadCount={1} loading={false} canRun={false}
        onReload={async () => {}} onError={() => {}} />,
    );
    expect(screen.getByText("Mensaje a2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Resolver/ })).toBeNull();
  });

  it("la pestaña muestra Resolver cuando canResolve es true, y ante error avisa y recarga", async () => {
    const onError = vi.fn();
    const onReload = vi.fn().mockResolvedValue(undefined);
    render(
      <AlertsTab alerts={[alerta("a1", true)]} unreadCount={1} loading={false} canRun={false}
        onReload={onReload} onError={onError} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Resolver/ }));
    expect(onError).toHaveBeenCalledWith("No tienes permiso para resolver esta alerta");
    expect(onReload).toHaveBeenCalled();
  });

  it("sin alertas muestra el estado vacío personal", () => {
    render(
      <AlertsTab alerts={[]} unreadCount={0} loading={false} canRun={false}
        onReload={async () => {}} onError={() => {}} />,
    );
    expect(screen.getByText("No tienes alertas pendientes.")).toBeInTheDocument();
  });
});
