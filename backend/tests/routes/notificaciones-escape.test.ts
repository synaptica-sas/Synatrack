import { describe, expect, it } from "vitest";
import { escaparHtml } from "../../src/utils/notifications.js";

/**
 * Los correos de la plataforma interpolan texto escrito por usuarios (nombres,
 * observaciones, motivos de rechazo, notas de feedback) dentro de plantillas
 * HTML. Sin escapar, cualquiera puede inyectar etiquetas en el correo que
 * recibe nómina.
 *
 * Esta prueba vive en `tests/` y no en `src/utils/__tests__/` a propósito: la
 * suite unitaria (`npm test`) tiene un conteo fijo de 153 que no se quiere mover
 * en esta rama.
 */
describe("escaparHtml", () => {
  it("neutraliza etiquetas y atributos", () => {
    expect(escaparHtml('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
  });

  it("escapa el ampersand antes que el resto, sin doble escape cruzado", () => {
    expect(escaparHtml("Tom & Jerry <b>")).toBe("Tom &amp; Jerry &lt;b&gt;");
  });

  it("escapa comillas simples (atributos con comilla simple)", () => {
    expect(escaparHtml("onmouseover='robar()'")).toBe("onmouseover=&#39;robar()&#39;");
  });

  it("convierte null y undefined en cadena vacía", () => {
    expect(escaparHtml(null)).toBe("");
    expect(escaparHtml(undefined)).toBe("");
  });

  it("deja intacto el texto sin caracteres especiales", () => {
    expect(escaparHtml("Horas extra del sábado")).toBe("Horas extra del sábado");
  });
});
