import { describe, it, expect } from "vitest";
import { REDIRECT_ERROR_MESSAGE, getRedirectError, setRedirectError } from "../auth/redirectError";

describe("error al volver del login de Microsoft", () => {
  it("se guarda en español, sin detalles técnicos, y se puede limpiar", () => {
    expect(getRedirectError()).toBeNull();
    setRedirectError(REDIRECT_ERROR_MESSAGE);
    expect(getRedirectError()).toMatch(/inicio de sesión con Microsoft/);
    setRedirectError(null);
    expect(getRedirectError()).toBeNull();
  });
});
