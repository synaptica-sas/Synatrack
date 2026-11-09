import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProjectsTab } from "../features/projects/ProjectsTab";
import type { Company, Project } from "../services/api";

/** El campo Empresa de Proyectos es un selector sobre el catálogo y guarda `companyId`. */

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

function empresa(id: string, name: string, active = true): Company {
  return {
    id, name, nit: null, contactName: null, contactEmail: null, contactPhone: null, active,
    createdAt: "", updatedAt: "", createdBy: null, updatedBy: null, projectCount: 0,
  };
}

const proyecto = {
  id: "p1",
  name: "Proyecto Alpha",
  company: "Vieja SA",
  companyId: "c-vieja",
  country: "Colombia",
  currency: "USD",
  budget: "1000",
  startDate: "2026-01-01T00:00:00.000Z",
  endDate: "2026-12-31T00:00:00.000Z",
  projectType: "TIME_AND_MATERIAL",
  status: "ACTIVE",
  projectManagerEmail: null,
} as unknown as Project;

function pintar(onOpenCompanies?: () => void) {
  return render(
    <ProjectsTab
      projects={[proyecto]}
      loading={false}
      canWrite
      onReload={async () => {}}
      onError={() => {}}
      onOpenCompanies={onOpenCompanies}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  createProject.mockResolvedValue({});
  updateProject.mockResolvedValue({});
});

describe("ProjectsTab: selector de empresa", () => {
  it("sin empresas registradas avisa, enlaza a Gestión de empresas y bloquea el guardado", async () => {
    listCompanies.mockResolvedValue([]);
    const ir = vi.fn();
    pintar(ir);
    fireEvent.click(screen.getByRole("button", { name: "+ Nuevo proyecto" }));
    expect(await screen.findByText(/Primero debes crear una empresa en Gestión de empresas/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crear proyecto" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Ir a Gestión de empresas" }));
    expect(ir).toHaveBeenCalled();
  });

  it("si falla la carga muestra el error y no el aviso de 'sin empresas'", async () => {
    listCompanies.mockRejectedValue(new Error("Servidor caído"));
    pintar();
    fireEvent.click(screen.getByRole("button", { name: "+ Nuevo proyecto" }));
    expect(await screen.findByText(/Servidor caído/)).toBeInTheDocument();
    expect(screen.queryByText(/Primero debes crear una empresa/)).not.toBeInTheDocument();
  });

  it("al crear envía companyId (no el nombre) de la empresa elegida", async () => {
    listCompanies.mockResolvedValue([empresa("c1", "ACME"), empresa("c2", "Globex")]);
    pintar();
    fireEvent.click(screen.getByRole("button", { name: "+ Nuevo proyecto" }));
    fireEvent.click(await screen.findByText("-- Empresa --"));
    fireEvent.click(await screen.findByText("Globex"));
    const form = screen.getByRole("button", { name: "Crear proyecto" }).closest("form")!;
    fireEvent.change(screen.getByPlaceholderText("Nombre"), { target: { value: "Nuevo" } });
    fireEvent.submit(form);
    await waitFor(() => expect(createProject).toHaveBeenCalled());
    const payload = createProject.mock.calls[0][0];
    expect(payload.companyId).toBe("c2");
    expect(payload).not.toHaveProperty("company");
  });

  it("al crear sin elegir empresa no llama a la API", async () => {
    listCompanies.mockResolvedValue([empresa("c1", "ACME")]);
    pintar();
    fireEvent.click(screen.getByRole("button", { name: "+ Nuevo proyecto" }));
    const form = (await screen.findByRole("button", { name: "Crear proyecto" })).closest("form")!;
    fireEvent.submit(form);
    expect(await screen.findByText("Selecciona una empresa.")).toBeInTheDocument();
    expect(createProject).not.toHaveBeenCalled();
  });

  it("al editar conserva una empresa inactiva como opción seleccionada y envía su companyId", async () => {
    listCompanies.mockResolvedValue([empresa("c1", "ACME")]);
    pintar();
    await waitFor(() => expect(listCompanies).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(await screen.findByText("Vieja SA (inactiva)")).toBeInTheDocument();
    const form = screen.getByRole("button", { name: "Guardar cambios" }).closest("form")!;
    fireEvent.submit(form);
    await waitFor(() => expect(updateProject).toHaveBeenCalled());
    expect(updateProject.mock.calls[0][1].companyId).toBe("c-vieja");
  });
});
