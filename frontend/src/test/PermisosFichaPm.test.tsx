import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProjectsTab } from "../features/projects/ProjectsTab";
import { ConsultantsTab } from "../features/consultants/ConsultantsTab";
import { mensajeErrorPermiso, puedeEditarProyecto } from "../utils/permisosFicha";
import type { AuthUser, Consultant, Project } from "../services/api";

/**
 * R15: un no-ADMIN solo edita proyectos que dirige, no cambia el PM y no cambia
 * el correo de un consultor. La UI solo refleja la regla; el backend la impone.
 */

vi.mock("../services/api", async () => {
  const actual = await vi.importActual<typeof import("../services/api")>("../services/api");
  return {
    ...actual,
    listProjectCategories: vi.fn().mockResolvedValue([]),
    listCompanies: vi.fn().mockResolvedValue([]),
    listSupportedCountries: vi.fn().mockResolvedValue([]),
    updateProject: vi.fn().mockResolvedValue({}),
    updateConsultant: vi.fn().mockResolvedValue({}),
  };
});

const api = await import("../services/api");

const PM: AuthUser = {
  id: "u1",
  email: "pm@synaptica.test",
  displayName: "PM",
  roles: ["PM"],
  permissions: [],
  consultantId: null,
};
const ADMIN: AuthUser = { ...PM, roles: ["ADMIN"] };

function proyecto(id: string, nombre: string, pm: string | null): Project {
  return {
    id,
    name: nombre,
    company: "Empresa",
    companyId: "c1",
    country: "Colombia",
    currency: "USD",
    budget: "1000",
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2026-12-31T00:00:00.000Z",
    projectType: "TIME_AND_MATERIAL",
    status: "ACTIVE",
    projectManagerEmail: pm,
  } as unknown as Project;
}

const propios = [proyecto("a", "Proyecto propio", "PM@synaptica.test"), proyecto("b", "Proyecto ajeno", "otro@synaptica.test")];

function renderProyectos(user: AuthUser) {
  return render(
    <ProjectsTab projects={propios} loading={false} canWrite onReload={async () => {}} onError={() => {}} authUser={user} />,
  );
}

describe("puedeEditarProyecto / mensajeErrorPermiso", () => {
  it("ADMIN edita todo; PM solo lo propio sin importar mayúsculas", () => {
    expect(puedeEditarProyecto(true, "x@y.z", "otro@y.z")).toBe(true);
    expect(puedeEditarProyecto(false, "PM@y.z", "pm@y.z")).toBe(true);
    expect(puedeEditarProyecto(false, "pm@y.z", "otro@y.z")).toBe(false);
    expect(puedeEditarProyecto(false, "pm@y.z", null)).toBe(false);
  });

  it("traduce los códigos 403 a español", () => {
    expect(mensajeErrorPermiso({ code: "NOT_PROJECT_MANAGER" }, "x")).toMatch(/diriges/);
    expect(mensajeErrorPermiso({ code: "PM_CHANGE_FORBIDDEN" }, "x")).toMatch(/administrador/);
    expect(mensajeErrorPermiso({ code: "EMAIL_CHANGE_FORBIDDEN" }, "x")).toMatch(/correo/);
    expect(mensajeErrorPermiso(new Error("falló"), "x")).toBe("falló");
    expect(mensajeErrorPermiso("raro", "por defecto")).toBe("por defecto");
  });
});

describe("ProjectsTab con rol PM", () => {
  it("deshabilita Editar en proyectos ajenos y lo permite en los propios", () => {
    renderProyectos(PM);
    const botones = screen.getAllByRole("button", { name: "Editar" });
    expect(botones).toHaveLength(2);
    expect(botones[0]).toBeEnabled();
    expect(botones[1]).toBeDisabled();
    expect(botones[1]).toHaveAttribute("title", "Solo puedes editar los proyectos que diriges.");
  });

  it("al crear, el PM va prellenado con el correo propio y en solo lectura", () => {
    renderProyectos(PM);
    const campo = screen.getAllByPlaceholderText("Correo del Project Manager (opcional)")[0] as HTMLInputElement;
    expect(campo.value).toBe("pm@synaptica.test");
    expect(campo).toHaveAttribute("readonly");
  });

  it("al editar, el PM queda en solo lectura y no se envía", async () => {
    renderProyectos(PM);
    fireEvent.click(screen.getAllByRole("button", { name: "Editar" })[0]);
    const campos = screen.getAllByPlaceholderText("Correo del Project Manager (opcional)");
    const edicion = campos[campos.length - 1] as HTMLInputElement;
    expect(edicion).toHaveAttribute("readonly");
    fireEvent.submit(edicion.closest("form")!);
    await vi.waitFor(() => expect(api.updateProject).toHaveBeenCalled());
    const payload = vi.mocked(api.updateProject).mock.calls[0][1];
    expect(payload.projectManagerEmail).toBeUndefined();
  });
});

describe("ProjectsTab con rol ADMIN", () => {
  it("todo editable y el PM no es de solo lectura", () => {
    renderProyectos(ADMIN);
    for (const b of screen.getAllByRole("button", { name: "Editar" })) expect(b).toBeEnabled();
    const campo = screen.getAllByPlaceholderText("Correo del Project Manager (opcional)")[0];
    expect(campo).not.toHaveAttribute("readonly");
  });
});

describe("ConsultantsTab", () => {
  const consultor = {
    id: "c1",
    fullName: "Ana Pérez",
    email: "ana@synaptica.test",
    role: "Analista",
    active: true,
    hourlyRate: "10",
    rateCurrency: "USD",
    country: "Colombia",
  } as unknown as Consultant;

  async function editar(esAdmin: boolean) {
    render(
      <ConsultantsTab
        consultants={[consultor]}
        loading={false}
        canWrite
        esAdmin={esAdmin}
        onReload={async () => {}}
        onError={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    const campos = screen.getAllByPlaceholderText("Correo") as HTMLInputElement[];
    return campos[campos.length - 1];
  }

  it("no-ADMIN: correo de solo lectura y no se envía", async () => {
    vi.mocked(api.updateConsultant).mockClear();
    const correo = await editar(false);
    expect(correo).toHaveAttribute("readonly");
    fireEvent.submit(correo.closest("form")!);
    await vi.waitFor(() => expect(api.updateConsultant).toHaveBeenCalled());
    expect(vi.mocked(api.updateConsultant).mock.calls[0][1].email).toBeUndefined();
  });

  it("ADMIN: correo editable y se envía", async () => {
    vi.mocked(api.updateConsultant).mockClear();
    const correo = await editar(true);
    expect(correo).not.toHaveAttribute("readonly");
    fireEvent.submit(correo.closest("form")!);
    await vi.waitFor(() => expect(api.updateConsultant).toHaveBeenCalled());
    expect(vi.mocked(api.updateConsultant).mock.calls[0][1].email).toBe("ana@synaptica.test");
  });
});
