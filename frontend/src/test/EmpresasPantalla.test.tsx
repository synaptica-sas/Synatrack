import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CompaniesTab } from "../features/companies/CompaniesTab";
import type { Company, CompanyDetail } from "../services/api";

/**
 * Pantalla "Gestión de empresas". Se trabaja contra el contrato de la API
 * (mocks): listado, alta con validación y bloqueo de borrado con proyectos.
 */

const listCompanies = vi.fn();
const getCompany = vi.fn();
const createCompany = vi.fn();
const updateCompany = vi.fn();
const deleteCompany = vi.fn();

vi.mock("../services/api", async () => {
  const actual = await vi.importActual<typeof import("../services/api")>("../services/api");
  return {
    ...actual,
    listCompanies: (...a: unknown[]) => listCompanies(...a),
    getCompany: (...a: unknown[]) => getCompany(...a),
    createCompany: (...a: unknown[]) => createCompany(...a),
    updateCompany: (...a: unknown[]) => updateCompany(...a),
    deleteCompany: (...a: unknown[]) => deleteCompany(...a),
  };
});

function empresa(parcial: Partial<Company>): Company {
  return {
    id: "c1",
    name: "ACME",
    nit: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    active: true,
    createdAt: "",
    updatedAt: "",
    createdBy: null,
    updatedBy: null,
    projectCount: 0,
    ...parcial,
  };
}

function pintar(canWrite = true, extra: { onOpenProject?: (id: string) => void } = {}) {
  const onError = vi.fn();
  const onSuccess = vi.fn();
  render(<CompaniesTab canWrite={canWrite} onError={onError} onSuccess={onSuccess} {...extra} />);
  return { onError, onSuccess };
}

beforeEach(() => {
  vi.clearAllMocks();
  listCompanies.mockResolvedValue([
    empresa({ id: "c1", name: "ACME", nit: "900.123", contactName: "Ana", projectCount: 2 }),
    empresa({ id: "c2", name: "Globex", projectCount: 0 }),
  ]);
});

describe("CompaniesTab", () => {
  it("lista las empresas con NIT, contacto, proyectos y 'Sin NIT'", async () => {
    pintar();
    expect(await screen.findByText("ACME")).toBeInTheDocument();
    expect(screen.getByText("900.123")).toBeInTheDocument();
    expect(screen.getByText("Sin NIT")).toBeInTheDocument();
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(listCompanies).toHaveBeenCalledWith({ active: true, search: undefined });
  });

  it("filtra por búsqueda y cambia el filtro de estado", async () => {
    pintar();
    await screen.findByText("ACME");
    fireEvent.change(screen.getByLabelText("Buscar empresa"), { target: { value: "glob" } });
    expect(screen.queryByText("ACME")).not.toBeInTheDocument();
    expect(screen.getByText("Globex")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filtrar por estado"), { target: { value: "all" } });
    await waitFor(() => expect(listCompanies).toHaveBeenLastCalledWith({ active: undefined, search: undefined }));
  });

  it("muestra el error de carga en vez de una tabla vacía", async () => {
    listCompanies.mockRejectedValue(new Error("Fallo del servidor"));
    pintar();
    expect(await screen.findByText("Fallo del servidor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("sin permiso de escritura no hay botones de alta, edición ni borrado", async () => {
    pintar(false);
    await screen.findByText("ACME");
    expect(screen.queryByRole("button", { name: "+ Nueva empresa" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminar" })).not.toBeInTheDocument();
  });

  it("alta: exige nombre, valida el correo y envía el payload", async () => {
    createCompany.mockResolvedValue(empresa({ id: "c3", name: "Nueva SA" }));
    const { onSuccess } = pintar();
    await screen.findByText("ACME");
    fireEvent.click(screen.getByRole("button", { name: "+ Nueva empresa" }));

    fireEvent.click(screen.getByRole("button", { name: "Crear empresa" }));
    expect(await screen.findByText("El nombre de la empresa es obligatorio.")).toBeInTheDocument();
    expect(createCompany).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "  Nueva SA " } });
    fireEvent.change(screen.getByLabelText("Correo de contacto"), { target: { value: "no-es-correo" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear empresa" }));
    expect(await screen.findByText("El correo de contacto no tiene un formato válido.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Correo de contacto"), { target: { value: "a@nueva.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear empresa" }));
    await waitFor(() => expect(createCompany).toHaveBeenCalled());
    expect(createCompany.mock.calls[0][0]).toMatchObject({
      name: "Nueva SA",
      nit: null,
      contactEmail: "a@nueva.com",
      active: true,
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('Empresa "Nueva SA" creada.'));
  });

  it("alta: un 409 por duplicado se muestra dentro del formulario", async () => {
    createCompany.mockRejectedValue(new Error("Ya existe una empresa con ese nombre"));
    pintar();
    await screen.findByText("ACME");
    fireEvent.click(screen.getByRole("button", { name: "+ Nueva empresa" }));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear empresa" }));
    expect(await screen.findByText("Ya existe una empresa con ese nombre")).toBeInTheDocument();
  });

  it("no ofrece borrar una empresa con proyectos: explica y ofrece desactivar", async () => {
    updateCompany.mockResolvedValue(empresa({ active: false }));
    pintar();
    await screen.findByText("ACME");
    fireEvent.click(screen.getAllByRole("button", { name: "Eliminar" })[0]);
    expect(screen.getByText(/primero debes reasignar sus proyectos/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Desactivar empresa" }));
    await waitFor(() => expect(updateCompany).toHaveBeenCalledWith("c1", { active: false }));
    expect(deleteCompany).not.toHaveBeenCalled();
  });

  it("elimina una empresa sin proyectos tras confirmar", async () => {
    deleteCompany.mockResolvedValue(undefined);
    pintar();
    await screen.findByText("Globex");
    fireEvent.click(screen.getAllByRole("button", { name: "Eliminar" })[1]);
    expect(screen.getByText(/¿Eliminar la empresa "Globex"\?/)).toBeInTheDocument();
    const botones = screen.getAllByRole("button", { name: "Eliminar" });
    fireEvent.click(botones[botones.length - 1]);
    await waitFor(() => expect(deleteCompany).toHaveBeenCalledWith("c2"));
  });

  it("detalle: lista los proyectos y abre uno con el mecanismo de la app", async () => {
    const detalle: CompanyDetail = {
      ...empresa({ id: "c1", name: "ACME", projectCount: 1 }),
      projects: [
        {
          id: "p1",
          name: "Proyecto Alpha",
          status: "ACTIVE",
          country: "Colombia",
          currency: "USD",
          startDate: "2026-01-01T00:00:00.000Z",
          endDate: "2026-12-31T00:00:00.000Z",
          projectManagerEmail: "pm@x.com",
          isInternal: false,
        },
      ],
    };
    getCompany.mockResolvedValue(detalle);
    const onOpenProject = vi.fn();
    pintar(true, { onOpenProject });
    fireEvent.click((await screen.findAllByRole("button", { name: "Ver detalle" }))[0]);
    expect(await screen.findByText("pm@x.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Proyecto Alpha" }));
    expect(onOpenProject).toHaveBeenCalledWith("p1");
  });
});
