import { describe, expect, it } from "vitest";
import { construirCorreoSemanaDevuelta } from "../notifications.js";

describe("construirCorreoSemanaDevuelta (R15)", () => {
  const base = {
    consultantName: "Ana Pérez",
    projectName: "Proyecto Alfa",
    weekStart: "2026-11-02",
    note: "Falta detalle en las tareas",
    reviewerName: "Beto PM",
  };

  it("lleva proyecto, semana legible, nota y revisor en el texto y en el asunto", () => {
    const { subject, text, html } = construirCorreoSemanaDevuelta(base);
    expect(subject).toBe("[Horas] Semana devuelta - Proyecto Alfa");
    for (const parte of ["Ana Pérez", "Proyecto Alfa", "lunes 2 de noviembre de 2026", "Falta detalle en las tareas", "Beto PM"]) {
      expect(text).toContain(parte);
    }
    expect(html).toContain("Falta detalle en las tareas");
  });

  it("escapa en el HTML el texto escrito por personas (nota, nombres, proyecto)", () => {
    const { html } = construirCorreoSemanaDevuelta({
      ...base,
      consultantName: "<img src=x onerror=alert(1)>",
      projectName: "A & B <script>",
      note: '<script>alert("x")</script>',
      reviewerName: "O'Neil <b>",
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain("A &amp; B &lt;script&gt;");
    expect(html).toContain("O&#39;Neil &lt;b&gt;");
  });
});
