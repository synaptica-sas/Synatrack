import { describe, it, expect, vi, afterEach } from "vitest";
import { InteractionRequiredAuthError, type AccountInfo } from "@azure/msal-browser";

vi.mock("../auth/msal", () => ({ apiTokenRequest: { scopes: ["User.Read"] } }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

const cuenta = { homeAccountId: "a" } as AccountInfo;

describe("getAccessToken", () => {
  it("redirige a Microsoft solo cuando MSAL pide interacción", async () => {
    const { getAccessToken } = await import("../auth/accessToken");
    const instance = {
      acquireTokenSilent: vi.fn().mockRejectedValue(new InteractionRequiredAuthError("interaction_required")),
      acquireTokenRedirect: vi.fn().mockResolvedValue(undefined),
    };
    await expect(getAccessToken(instance, cuenta)).resolves.toBeNull();
    expect(instance.acquireTokenRedirect).toHaveBeenCalledTimes(1);
  });

  it("propaga cualquier otro error sin redirigir", async () => {
    const { getAccessToken } = await import("../auth/accessToken");
    const instance = {
      acquireTokenSilent: vi.fn().mockRejectedValue(new Error("network_error")),
      acquireTokenRedirect: vi.fn(),
    };
    await expect(getAccessToken(instance, cuenta)).rejects.toThrow("network_error");
    expect(instance.acquireTokenRedirect).not.toHaveBeenCalled();
  });

  it("devuelve el token cuando la adquisición silenciosa funciona", async () => {
    const { getAccessToken } = await import("../auth/accessToken");
    const instance = {
      acquireTokenSilent: vi.fn().mockResolvedValue({ idToken: "id", accessToken: "acc" }),
      acquireTokenRedirect: vi.fn(),
    };
    await expect(getAccessToken(instance, cuenta)).resolves.toBeTruthy();
  });
});

describe("timeout de request() en getMe", () => {
  it("lanza un error en español cuando el servidor no responde a tiempo", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("abortado", "AbortError")));
        }),
      ),
    );
    const { getMe } = await import("../services/api");
    const resultado = expect(getMe()).rejects.toThrow(/tardó demasiado en responder/);
    await vi.advanceTimersByTimeAsync(25_000);
    await resultado;
  });
});
