import { describe, expect, it } from "vitest";
import { construirResumenCapacity, hayNovedades } from "../capacityDigest.js";

const base = {
  equipo: [
    { month: "2026-11", pct: 88.3 },
    { month: "2026-12", pct: null },
  ],
  sobreasignados: [{ nombre: "Ana", month: "2026-11", pct: 120.4 }],
  subutilizados: [{ nombre: "Beto", month: "2026-12", billablePct: 30 }],
  url: "http://localhost:5173",
};

describe("construirResumenCapacity", () => {
  it("incluye utilización, tablas, enlace y texto plano", () => {
    const r = construirResumenCapacity(base);
    expect(r.subject).toBe("[Capacity] Resumen semanal: 1 sobreasignado(s), 1 subutilizado(s)");
    expect(r.html).toContain("nov-2026");
    expect(r.html).toContain("88 %");
    expect(r.html).toContain("120 %");
    expect(r.html).toContain("http://localhost:5173");
    expect(r.text).toContain("Ana · nov-2026 · 120 %");
    expect(r.text).toContain("Beto · dic-2026 · 30 % facturable");
  });

  it("escapa los nombres en el HTML", () => {
    const r = construirResumenCapacity({
      ...base,
      sobreasignados: [{ nombre: "<script>alert(1)</script>", month: "2026-11", pct: 130 }],
    });
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
  });

  it("hayNovedades", () => {
    expect(hayNovedades(base)).toBe(true);
    expect(hayNovedades({ sobreasignados: [], subutilizados: [] })).toBe(false);
  });
});
