import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AssignmentFormModal } from "../features/capacity/AssignmentFormModal";
import { ConsultantCapacityDrawer } from "../features/capacity/monthly/ConsultantCapacityDrawer";
import * as api from "../services/api";
import type { AssignmentFormState } from "../features/capacity/assignmentForm";

vi.mock("../services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/api")>();
  return {
    ...actual,
    getEffectiveWorkdays: vi.fn().mockResolvedValue(null),
    getCapacityMonthlyConsultant: vi.fn().mockReturnValue(new Promise(() => {})),
  };
});

const form = {
  projectId: "", consultantId: "", startDate: "", endDate: "", certainty: "CONFIRMED",
  allocationMode: "HOURS", allocationPct: "", hoursPerPeriod: "", periodUnit: "week", role: "", note: "",
} as unknown as AssignmentFormState;

function renderModal(submitting: boolean, onClose: () => void) {
  return render(
    <AssignmentFormModal
      editing={false} form={form} setForm={() => {}} projects={[]} consultants={[]}
      multipleMode={false} onMultipleModeChange={() => {}} selectedConsultantIds={[]}
      setSelectedConsultantIds={() => {}} submitting={submitting} onSubmit={() => {}} onClose={onClose}
    />,
  );
}

describe("Escape en los modales de capacity", () => {
  it("Escape cierra el modal de asignación, con foco en el campo de Horas", () => {
    const onClose = vi.fn();
    renderModal(false, onClose);
    const horas = screen.getByLabelText("Horas *");
    horas.focus();
    fireEvent.keyDown(horas, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("el foco inicial queda en el primer campo y Escape no cierra con un envío en curso", () => {
    const onClose = vi.fn();
    renderModal(true, onClose);
    expect(screen.getByLabelText("Proyecto *")).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Escape cierra el drawer, que vive en un contenedor fijo sobre <body>", () => {
    const onClose = vi.fn();
    const { container } = render(<ConsultantCapacityDrawer consultantId="c1" params={{ from: "2026-01", to: "2026-02" }} onClose={onClose} />);
    expect(vi.mocked(api.getCapacityMonthlyConsultant)).toHaveBeenCalled();
    const overlay = screen.getByTestId("cap-drawer-overlay");
    expect(overlay).toHaveClass("cap-drawer-overlay");
    expect(overlay.parentElement).toBe(document.body);
    expect(container.contains(overlay)).toBe(false);
    expect(screen.getByRole("button", { name: "Cerrar detalle" })).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
