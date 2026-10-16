import { describe, expect, it, vi } from "vitest";
import { abrirContextoDeActor, getActor, runWithActor, setActor } from "../actorContext.js";
import { camposDeTrazabilidadPorModelo } from "../prisma.js";

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("actorContext", () => {
  it("fuera de contexto no hay actor", () => {
    expect(getActor()).toBeNull();
  });

  it("runWithActor expone el actor a lo largo de los await y lo limpia al salir", async () => {
    await runWithActor("sistema:job", async () => {
      expect(getActor()).toBe("sistema:job");
      await pausa(5);
      expect(getActor()).toBe("sistema:job");
    });
    expect(getActor()).toBeNull();
  });

  it("abrir contexto + setActor posterior es visible para el resto de la cadena", async () => {
    await new Promise<void>((resolver) => {
      abrirContextoDeActor(() => {
        void (async () => {
          expect(getActor()).toBeNull();
          setActor("ana@x.test");
          await pausa(5);
          expect(getActor()).toBe("ana@x.test");
          resolver();
        })();
      });
    });
  });

  it("setActor sin contexto no hace nada y avisa (falla cerrado)", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    setActor("intruso@x.test");
    expect(getActor()).toBeNull();
    await pausa(5);
    expect(getActor()).toBeNull();
    expect(aviso).toHaveBeenCalledTimes(1);
    aviso.mockRestore();
  });

  it("contextos concurrentes no se cruzan", async () => {
    const vistos: string[] = [];
    await Promise.all(
      ["a@x.test", "b@x.test", "c@x.test"].map((email, i) =>
        new Promise<void>((resolver) => {
          abrirContextoDeActor(() => {
            void (async () => {
              setActor(email);
              await pausa(15 - i * 5);
              vistos.push(`${email}=${getActor()}`);
              resolver();
            })();
          });
        }),
      ),
    );
    for (const v of vistos) {
      const [esperado, real] = v.split("=");
      expect(real).toBe(esperado);
    }
    expect(vistos).toHaveLength(3);
  });

  it("un runWithActor anidado no altera al contexto externo", () => {
    runWithActor("externo", () => {
      runWithActor("interno", () => expect(getActor()).toBe("interno"));
      expect(getActor()).toBe("externo");
    });
  });
});

describe("modelos con trazabilidad (derivados del esquema)", () => {
  it("incluye los modelos con columnas y excluye los que no las tienen", () => {
    for (const m of ["Project", "TimeEntry", "ExtraHourEntry", "Assignment", "Milestone", "User"]) {
      expect(camposDeTrazabilidadPorModelo.get(m)).toEqual(new Set(["createdBy", "updatedBy"]));
    }
    for (const m of ["JobRun", "AuditLog", "RunningTimer", "UserRole"]) {
      expect(camposDeTrazabilidadPorModelo.has(m)).toBe(false);
    }
    expect(camposDeTrazabilidadPorModelo.size).toBe(32);
  });
});
