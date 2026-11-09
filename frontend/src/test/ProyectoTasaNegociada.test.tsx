import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ProjectsTab } from "../features/projects/ProjectsTab";
import type { Company, Project } from "../services/api";

/** Casilla "Usar tasa de cambio negociada" del formulario de proyectos. */

const listCompanies = vi.fn();
const createProject = vi.fn();
const updateProject = vi.fn();

vi.mock("../services/api", async () => {
  const actual = await vi.importActual<typeof import("../services/api")>("../services/api");
  return {
    ...actual,
    listCompanies: (...a: unknown[]) => listCompanies(...a),
    listProjectCategories: vi.fn().mockResolvedValue([]),
    listSupportedCountries: vi.fn().mockResolvedValue(["Colombia"]),
    createProject: (...a: unknown[]) => createProject(...a),
    updateProject: (...a: unknown[]) => updateProject(...a),
  };
});

const acme: Company = {
  id: "c1", name: "ACME", nit: null, contactName: null, contactEmail: null, contactPhone: null, active: true,
  createdAt: "", updatedAt: "", createdBy: null, updatedBy: null, projectCount: 0,
};

function proyecto(extra: Partial<Project> = {}): Project {
  return {
    id: "p1", name: "Proyecto Alpha", company: "Globex", companyId: "c1", country: "Colombia",
    currency: "COP", sellCurrency: "COP", budget: "35000000",
    startDate: "2025-01-01T00:00:00.000Z", endDate: "2026-12-31T00:00:00.000Z",
    projectType: "TIME_AND_MATERIAL", status: "ACTIVE", projectManagerEmail: null,
    ...extra,
  } as unknown as Project;
}

function pintar(p: Project) {
  return render(
    <ProjectsTab projects={[p]} loading={false} canWrite onReload={async () => {}} onError={() => {}} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listCompanies.mockResolvedValue([acme]);
  createProject.mockResolvedValue({});
  updateProject.mockResolvedValue({});
});

describe("ProjectsTab: tasa de cambio negociada", () => {
  it("al crear, la casilla está desactivada mientras todo es USD", async () => {
    pintar(proyecto());
    fireEvent.click(screen.getByRole("button", { name: "+ Nuevo proyecto" }));
    const casilla = await screen.findByLabelText("Usar tasa de cambio negociada");
    expect(casilla).toBeDisabled();
  });

  it("al crear en COP, marcarla muestra '1 USD = … COP' y envía la tasa", async () => {
    pintar(proyecto());
    fireEvent.click(screen.getByRole("button", { name: "+ Nuevo proyecto" }));
    fireEvent.click(await screen.findByText("-- Empresa --"));
    fireEvent.click(await screen.findByText("ACME"));
    fireEvent.change(screen.getByDisplayValue("Selecciona moneda..."), { target: { value: "COP" } });
    fireEvent.change(screen.getByPlaceholderText("Nombre"), { target: { value: "Nuevo" } });

    expect(screen.queryByLabelText("Tasa negociada: COP por 1 USD")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Usar tasa de cambio negociada"));
    fireEvent.change(screen.getByLabelText("Tasa negociada: COP por 1 USD"), { target: { value: "3900" } });

    fireEvent.submit(screen.getByRole("button", { name: "Crear proyecto" }).closest("form")!);
    await waitFor(() => expect(createProject).toHaveBeenCalled());
    const payload = createProject.mock.calls[0][0];
    expect(payload.negotiatedFxRate).toBe(3900);
    expect(payload).not.toHaveProperty("usarTasaNegociada");
  });

  it("al crear sin marcar la casilla envía null", async () => {
    pintar(proyecto());
    fireEvent.click(screen.getByRole("button", { name: "+ Nuevo proyecto" }));
    fireEvent.click(await screen.findByText("-- Empresa --"));
    fireEvent.click(await screen.findByText("ACME"));
    fireEvent.change(screen.getByPlaceholderText("Nombre"), { target: { value: "Nuevo" } });
    fireEvent.submit(screen.getByRole("button", { name: "Crear proyecto" }).closest("form")!);
    await waitFor(() => expect(createProject).toHaveBeenCalled());
    expect(createProject.mock.calls[0][0].negotiatedFxRate).toBeNull();
  });

  it("al editar un proyecto con tasa, la muestra marcada y desmarcarla la quita", async () => {
    pintar(proyecto({ negotiatedFxRate: "3500.000000", negotiatedFxCurrency: "COP" }));
    await waitFor(() => expect(listCompanies).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    const form = (await screen.findByRole("button", { name: "Guardar cambios" })).closest("form")!;
    const casilla = within(form).getByLabelText("Usar tasa de cambio negociada");
    expect(casilla).toBeChecked();
    expect(within(form).getByLabelText("Tasa negociada: COP por 1 USD")).toHaveValue(3500);

    fireEvent.click(casilla);
    fireEvent.submit(form);
    await waitFor(() => expect(updateProject).toHaveBeenCalled());
    expect(updateProject.mock.calls[0][1].negotiatedFxRate).toBeNull();
  });
});
