import { describe, expect, it } from "vitest";
import { aplanarEmpresaDeProyecto } from "../projectCompany.js";

describe("aplanarEmpresaDeProyecto", () => {
  it("reemplaza la relación company por el nombre y agrega companyId", () => {
    const salida = aplanarEmpresaDeProyecto({ id: "p1", company: { id: "c1", name: "Acme" } });
    expect(salida).toEqual({ id: "p1", company: "Acme", companyId: "c1" });
  });

  it("recorre arreglos y objetos anidados (project dentro de otra fila)", () => {
    const salida = aplanarEmpresaDeProyecto([{ hours: 3, project: { companyId: "c1", company: { id: "c1", name: "Acme" } } }]);
    expect(salida).toEqual([{ hours: 3, project: { companyId: "c1", company: "Acme" } }]);
  });

  it("deja intactos los strings (Consultant.company), las fechas y los nulos", () => {
    const fecha = new Date("2026-01-01");
    const entrada = { company: "Synaptica", d: fecha, n: null };
    const salida = aplanarEmpresaDeProyecto(entrada);
    expect(salida).toEqual(entrada);
    expect(salida.d).toBe(fecha);
  });
});
