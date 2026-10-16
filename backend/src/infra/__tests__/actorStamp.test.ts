import { describe, expect, it } from "vitest";
import { estamparActor } from "../actorStamp.js";

const AMBOS = new Set(["createdBy", "updatedBy"]);
const ACTOR = "ana@synaptica.test";

describe("estamparActor", () => {
  it("create: pone createdBy y updatedBy", () => {
    const r = estamparActor("create", { data: { name: "X" } }, ACTOR, AMBOS) as any;
    expect(r.data).toEqual({ name: "X", createdBy: ACTOR, updatedBy: ACTOR });
  });

  it("no pisa valores explícitos", () => {
    const r = estamparActor("create", { data: { createdBy: "otro", updatedBy: "otro2" } }, ACTOR, AMBOS) as any;
    expect(r.data).toEqual({ createdBy: "otro", updatedBy: "otro2" });
  });

  it("trata undefined como no explícito", () => {
    const r = estamparActor("create", { data: { createdBy: undefined } }, ACTOR, AMBOS) as any;
    expect(r.data.createdBy).toBe(ACTOR);
  });

  it("createMany y createManyAndReturn: arreglo y objeto", () => {
    const a = estamparActor("createMany", { data: [{ n: 1 }, { n: 2, createdBy: "z" }] }, ACTOR, AMBOS) as any;
    expect(a.data).toEqual([
      { n: 1, createdBy: ACTOR, updatedBy: ACTOR },
      { n: 2, createdBy: "z", updatedBy: ACTOR },
    ]);
    const b = estamparActor("createManyAndReturn", { data: { n: 1 } }, ACTOR, AMBOS) as any;
    expect(b.data).toEqual({ n: 1, createdBy: ACTOR, updatedBy: ACTOR });
  });

  it.each(["update", "updateMany", "updateManyAndReturn"])("%s: solo updatedBy", (op) => {
    const r = estamparActor(op, { where: {}, data: { name: "Y" } }, ACTOR, AMBOS) as any;
    expect(r.data).toEqual({ name: "Y", updatedBy: ACTOR });
    expect(r.where).toEqual({});
  });

  it("upsert: create recibe ambos y update solo updatedBy", () => {
    const r = estamparActor("upsert", { where: {}, create: { a: 1 }, update: { a: 2 } }, ACTOR, AMBOS) as any;
    expect(r.create).toEqual({ a: 1, createdBy: ACTOR, updatedBy: ACTOR });
    expect(r.update).toEqual({ a: 2, updatedBy: ACTOR });
  });

  it("sin actor no toca nada (devuelve los mismos args)", () => {
    const args = { data: { a: 1 } };
    expect(estamparActor("create", args, null, AMBOS)).toBe(args);
  });

  it("operaciones de lectura o borrado no se tocan", () => {
    for (const op of ["findMany", "delete", "deleteMany", "count", "aggregate"]) {
      const args = { where: { a: 1 } };
      expect(estamparActor(op, args, ACTOR, AMBOS)).toBe(args);
    }
  });

  it("respeta los campos que el modelo realmente tiene", () => {
    const r = estamparActor("create", { data: {} }, ACTOR, new Set(["updatedBy"])) as any;
    expect(r.data).toEqual({ updatedBy: ACTOR });
    expect(estamparActor("create", { data: {} }, ACTOR, new Set())).toEqual({ data: {} });
  });

  it("upsert con update vacío no estampa updatedBy (sigue siendo no-op)", () => {
    const r = estamparActor("upsert", { where: {}, create: { a: 1 }, update: {} }, ACTOR, AMBOS) as any;
    expect(r.update).toEqual({});
    expect(r.create).toEqual({ a: 1, createdBy: ACTOR, updatedBy: ACTOR });
  });

  it.each(["update", "updateMany", "updateManyAndReturn"])("%s con data vacío no estampa", (op) => {
    const r = estamparActor(op, { where: {}, data: {} }, ACTOR, AMBOS) as any;
    expect(r.data).toEqual({});
  });

  it("update con updatedBy explícito lo respeta", () => {
    const r = estamparActor("update", { where: {}, data: { updatedBy: "x" } }, ACTOR, AMBOS) as any;
    expect(r.data).toEqual({ updatedBy: "x" });
  });

  it("no muta los args originales", () => {
    const data = { a: 1 };
    estamparActor("create", { data }, ACTOR, AMBOS);
    expect(data).toEqual({ a: 1 });
  });
});
