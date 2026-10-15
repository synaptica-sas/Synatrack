import { describe, expect, it } from "vitest";
import {
  calcularAlertasDeseadas,
  etiquetaMes,
  planAlertSync,
  type AlertaAbierta,
  type ConsultorParaAlertas,
} from "../capacityAlerts.js";

type Mes = ConsultorParaAlertas["months"][number];
const mes = (month: string, pct: number | null, extra: Partial<Mes> = {}): Mes => ({
  month,
  capacityHours: pct === null ? 0 : 100,
  assignedHours: pct === null ? 0 : pct,
  pct,
  billablePct: pct,
  status: pct === null ? null : pct > 100 ? "OVER" : pct >= 70 ? "OK" : "UNDER",
  billableStatus: pct === null ? null : pct >= 70 ? "OK" : "UNDER",
  ...extra,
});
const nombres = new Map([
  ["c1", "Ana Pérez"],
  ["c2", "Beto"],
]);

describe("etiquetaMes", () => {
  it("abrevia en español", () => {
    expect(etiquetaMes("2026-11")).toBe("nov-2026");
    expect(etiquetaMes("2027-01")).toBe("ene-2027");
  });
});

describe("calcularAlertasDeseadas", () => {
  it("OVER genera CONSULTANT_OVERLOADED WARNING con el mensaje del contrato", () => {
    const r = calcularAlertasDeseadas({
      consultants: [{ consultantId: "c1", months: [mes("2026-11", 110)] }],
      overPct: 100,
      nombres,
    });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      type: "CONSULTANT_OVERLOADED",
      consultantId: "c1",
      month: "2026-11",
      severity: "WARNING",
      message: "Ana Pérez: 110 % asignado en nov-2026 (sobreasignado)",
      metadata: { month: "2026-11", pct: 110, assignedHours: 110, capacityHours: 100 },
    });
  });

  it("CRITICAL solo cuando pct > over + 20 (120 exacto sigue siendo WARNING)", () => {
    const sev = (pct: number) =>
      calcularAlertasDeseadas({
        consultants: [{ consultantId: "c1", months: [mes("2026-11", pct)] }],
        overPct: 100,
        nombres,
      })[0].severity;
    expect(sev(120)).toBe("WARNING");
    expect(sev(120.5)).toBe("CRITICAL");
  });

  it("el % del mensaje va sin decimales", () => {
    const r = calcularAlertasDeseadas({
      consultants: [{ consultantId: "c1", months: [mes("2026-11", 104.8)] }],
      overPct: 100,
      nombres,
    });
    expect(r[0].message).toContain("105 %");
  });

  it("billableStatus UNDER genera CONSULTANT_UNDERUTILIZED WARNING con % facturable", () => {
    const r = calcularAlertasDeseadas({
      consultants: [{ consultantId: "c2", months: [mes("2026-12", 45.4)] }],
      overPct: 100,
      nombres,
    });
    expect(r).toEqual([
      expect.objectContaining({
        type: "CONSULTANT_UNDERUTILIZED",
        severity: "WARNING",
        message: "Beto: 45 % facturable en dic-2026 (subutilizado)",
      }),
    ]);
  });

  it("puede generar las dos a la vez (sobreasignado pero poco facturable)", () => {
    const r = calcularAlertasDeseadas({
      consultants: [{ consultantId: "c1", months: [mes("2026-11", 130, { billablePct: 20, billableStatus: "UNDER" })] }],
      overPct: 100,
      nombres,
    });
    expect(r.map((a) => a.type).sort()).toEqual(["CONSULTANT_OVERLOADED", "CONSULTANT_UNDERUTILIZED"]);
  });

  it("pct null (sin capacidad) no genera nada, aunque el estado venga informado", () => {
    const r = calcularAlertasDeseadas({
      consultants: [{ consultantId: "c1", months: [mes("2026-11", null, { status: "OVER", billableStatus: "UNDER" })] }],
      overPct: 100,
      nombres,
    });
    expect(r).toEqual([]);
  });

  it("OK no genera nada", () => {
    expect(
      calcularAlertasDeseadas({ consultants: [{ consultantId: "c1", months: [mes("2026-11", 90)] }], overPct: 100, nombres }),
    ).toEqual([]);
  });

  it("acepta los nombres como objeto y cae a 'Consultor' si falta", () => {
    const r = calcularAlertasDeseadas({
      consultants: [{ consultantId: "zz", months: [mes("2026-11", 150)] }],
      overPct: 100,
      nombres: {},
    });
    expect(r[0].message.startsWith("Consultor:")).toBe(true);
  });
});

describe("planAlertSync", () => {
  const deseadas = () =>
    calcularAlertasDeseadas({
      consultants: [{ consultantId: "c1", months: [mes("2026-11", 110), mes("2026-12", 130)] }],
      overPct: 100,
      nombres,
    });
  const comoAbierta = (id: string, d: ReturnType<typeof deseadas>[number]): AlertaAbierta => ({
    id,
    type: d.type,
    consultantId: d.consultantId,
    severity: d.severity,
    message: d.message,
    metadata: JSON.parse(JSON.stringify(d.metadata)),
  });

  it("sin abiertas: crea todas", () => {
    const plan = planAlertSync(deseadas(), []);
    expect(plan.crear).toHaveLength(2);
    expect(plan.actualizar).toEqual([]);
    expect(plan.resolver).toEqual([]);
  });

  it("sin cambios: no crea, ni actualiza, ni resuelve", () => {
    const d = deseadas();
    const plan = planAlertSync(d, [comoAbierta("a1", d[0]), comoAbierta("a2", d[1])]);
    expect(plan).toEqual({ crear: [], actualizar: [], resolver: [] });
  });

  it("cambia el pct: actualiza solo esa alerta", () => {
    const d = deseadas();
    const vieja = { ...comoAbierta("a1", d[0]), message: "viejo", metadata: { ...d[0].metadata, pct: 105 } };
    const plan = planAlertSync(d, [vieja, comoAbierta("a2", d[1])]);
    expect(plan.actualizar).toEqual([{ id: "a1", deseada: d[0] }]);
    expect(plan.crear).toEqual([]);
    expect(plan.resolver).toEqual([]);
  });

  it("cambia solo la severidad: actualiza", () => {
    const d = deseadas();
    const plan = planAlertSync(d, [{ ...comoAbierta("a1", d[0]), severity: "CRITICAL" }, comoAbierta("a2", d[1])]);
    expect(plan.actualizar.map((a) => a.id)).toEqual(["a1"]);
  });

  it("la condición desaparece: resuelve", () => {
    const d = deseadas();
    const plan = planAlertSync([d[1]], [comoAbierta("a1", d[0]), comoAbierta("a2", d[1])]);
    expect(plan.resolver).toEqual(["a1"]);
    expect(plan.crear).toEqual([]);
  });

  it("mes fuera del horizonte (no está entre las deseadas): resuelve", () => {
    const d = deseadas();
    const fuera = comoAbierta("a9", {
      ...d[0],
      month: "2026-05",
      metadata: { ...d[0].metadata, month: "2026-05" },
    });
    const plan = planAlertSync(d, [fuera]);
    expect(plan.resolver).toEqual(["a9"]);
    expect(plan.crear).toHaveLength(2);
  });

  it("alerta vieja sin metadata.month: resuelve", () => {
    const d = deseadas();
    const plan = planAlertSync(d, [
      { id: "viejo", type: "CONSULTANT_OVERLOADED", consultantId: "c1", severity: "WARNING", message: "x", metadata: null },
      { id: "viejo2", type: "CONSULTANT_OVERLOADED", consultantId: "c1", severity: "WARNING", message: "x", metadata: {} },
    ]);
    expect(plan.resolver).toEqual(["viejo", "viejo2"]);
    expect(plan.crear).toHaveLength(2);
  });

  it("duplicadas abiertas con la misma clave: conserva una y resuelve el resto", () => {
    const d = deseadas();
    const plan = planAlertSync([d[0]], [comoAbierta("a1", d[0]), comoAbierta("a2", d[0])]);
    expect(plan.resolver).toEqual(["a2"]);
    expect(plan.crear).toEqual([]);
  });

  it("el mismo mes y consultor con otro tipo es otra clave", () => {
    const d = calcularAlertasDeseadas({
      consultants: [{ consultantId: "c1", months: [mes("2026-11", 130, { billablePct: 10, billableStatus: "UNDER" })] }],
      overPct: 100,
      nombres,
    });
    const sobre = d.find((x) => x.type === "CONSULTANT_OVERLOADED")!;
    const plan = planAlertSync(d, [comoAbierta("a1", sobre)]);
    expect(plan.crear.map((x) => x.type)).toEqual(["CONSULTANT_UNDERUTILIZED"]);
  });

  it("sin deseadas ni abiertas: plan vacío", () => {
    expect(planAlertSync([], [])).toEqual({ crear: [], actualizar: [], resolver: [] });
  });
});
