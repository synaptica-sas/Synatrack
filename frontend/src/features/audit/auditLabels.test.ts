import { describe, expect, it } from "vitest";
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTION_OPTIONS,
  AUDIT_ENTITY_LABELS,
  AUDIT_ENTITY_OPTIONS,
  auditActionLabel,
  auditActionTone,
  auditEntityLabel,
} from "./auditLabels";

describe("auditLabels", () => {
  it("traduce entidades conocidas", () => {
    expect(auditEntityLabel("timeEntry")).toBe("Hora registrada");
    expect(auditEntityLabel("fxConfig")).toBe("Tasa de cambio");
  });

  it("devuelve el valor crudo para entidades desconocidas o históricas", () => {
    expect(auditEntityLabel("Project")).toBe("Project");
    expect(auditEntityLabel("toString")).toBe("toString");
  });

  it("traduce acciones y tolera desconocidas", () => {
    expect(auditActionLabel("LOGIN")).toBe("Inicio de sesión");
    expect(auditActionLabel("UPDATE")).toBe("Edición");
    expect(auditActionLabel("OTRA")).toBe("OTRA");
  });

  it("asigna un tono distinto a LOGIN", () => {
    expect(auditActionTone("LOGIN")).toBe("info");
    expect(auditActionTone("CREATE")).toBe("success");
    expect(auditActionTone("DELETE")).toBe("danger");
    expect(auditActionTone("UPDATE")).toBe("warning");
  });

  it("las opciones cubren todo el catálogo", () => {
    expect(AUDIT_ENTITY_OPTIONS).toHaveLength(Object.keys(AUDIT_ENTITY_LABELS).length);
    expect(AUDIT_ENTITY_OPTIONS).toHaveLength(31);
    expect(AUDIT_ACTION_OPTIONS).toHaveLength(Object.keys(AUDIT_ACTION_LABELS).length);
  });
});
