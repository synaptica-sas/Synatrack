import { AppRole } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { buildAlertWhere, canResolveAlert, canSeeAlert, type AudienceUser } from "../alert-audience.js";

const base: AudienceUser = { roles: [], consultantId: null, managedProjectIds: [], managedConsultantIds: [] };
const usuario = (roles: AppRole[], extra: Partial<AudienceUser> = {}): AudienceUser => ({ ...base, roles, ...extra });

describe("alert-audience", () => {
  it("sin roles con alcance no devuelve nada", () => {
    expect(buildAlertWhere(usuario([AppRole.VIEWER]))).toEqual({ id: { in: [] } });
    expect(canSeeAlert(usuario([AppRole.VIEWER]), { type: "BUDGET_WARNING", projectId: "p", consultantId: null })).toBe(false);
  });

  it("PM sin proyectos ni consultores queda sin alcance", () => {
    expect(buildAlertWhere(usuario([AppRole.PM]))).toEqual({ id: { in: [] } });
  });

  it("PM: financieras y vencimientos por proyecto, sobrecarga por consultor; nunca subutilización ni FX", () => {
    const pm = usuario([AppRole.PM], { managedProjectIds: ["p1"], managedConsultantIds: ["c1"] });
    expect(canSeeAlert(pm, { type: "BUDGET_EXCEEDED", projectId: "p1", consultantId: null })).toBe(true);
    expect(canSeeAlert(pm, { type: "BUDGET_EXCEEDED", projectId: "p2", consultantId: null })).toBe(false);
    expect(canSeeAlert(pm, { type: "ASSIGNMENT_ENDING", projectId: "p1", consultantId: "c9" })).toBe(true);
    expect(canSeeAlert(pm, { type: "CONSULTANT_OVERLOADED", projectId: null, consultantId: "c1" })).toBe(true);
    expect(canSeeAlert(pm, { type: "CONSULTANT_OVERLOADED", projectId: null, consultantId: "c2" })).toBe(false);
    expect(canSeeAlert(pm, { type: "CONSULTANT_UNDERUTILIZED", projectId: null, consultantId: "c1" })).toBe(false);
    expect(canSeeAlert(pm, { type: "FX_RATE_MISSING", projectId: null, consultantId: null })).toBe(false);
  });

  it("CONSULTANT: solo su vencimiento y no resuelve", () => {
    const c = usuario([AppRole.CONSULTANT], { consultantId: "c1" });
    const propia = { type: "ASSIGNMENT_ENDING" as const, projectId: "p1", consultantId: "c1" };
    expect(canSeeAlert(c, propia)).toBe(true);
    expect(canResolveAlert(c, propia)).toBe(false);
    expect(canSeeAlert(c, { ...propia, consultantId: "c2" })).toBe(false);
    expect(canSeeAlert(usuario([AppRole.CONSULTANT]), propia)).toBe(false);
  });

  it("varios roles: unión; ADMIN ve y resuelve todo", () => {
    const u = usuario([AppRole.PM, AppRole.FINANCE], { managedProjectIds: ["p1"] });
    expect(canResolveAlert(u, { type: "FX_RATE_MISSING", projectId: null, consultantId: null })).toBe(true);
    expect(canResolveAlert(u, { type: "BUDGET_WARNING", projectId: "p2", consultantId: null })).toBe(true);
    expect(canSeeAlert(u, { type: "CONSULTANT_UNDERUTILIZED", projectId: null, consultantId: "c1" })).toBe(false);
    expect(canResolveAlert(usuario([AppRole.ADMIN]), { type: "CONSULTANT_UNDERUTILIZED", projectId: null, consultantId: "c1" })).toBe(true);
  });

  it("canResolve exige ver la alerta: COMMERCIAL no resuelve las financieras", () => {
    const com = usuario([AppRole.COMMERCIAL]);
    expect(canResolveAlert(com, { type: "BUDGET_WARNING", projectId: "p1", consultantId: null })).toBe(false);
    expect(canResolveAlert(com, { type: "CONSULTANT_UNDERUTILIZED", projectId: null, consultantId: "c1" })).toBe(true);
  });
});
