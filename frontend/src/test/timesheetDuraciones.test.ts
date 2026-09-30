import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatHoursShort,
  formatHoursTotal,
  parseHoursInput,
  roundHours,
} from "../features/timesheet/timesheetUtils";

/**
 * Una actividad de 43 segundos aparecía en el timesheet como "0:01".
 *
 * Eran dos fallos encadenados: el formato redondeaba al minuto y perdía los
 * segundos, y como el reloj del rastreador sí usa HH:MM:SS, ese "0:01" se leía
 * como un segundo. Además, al visitar la celda se reescribía el valor: lo que
 * se mostraba volvía a entrar por el analizador y salía convertido en 72 s.
 */

/** 43 segundos, tal como los guarda la columna (4 decimales). */
const S43 = roundHours(43 / 3600);

describe("Las duraciones no pierden los segundos", () => {
  it("43 segundos se muestran como tales, no como un minuto", () => {
    expect(formatDuration(S43)).toBe("0:00:43");
    expect(formatHoursShort(S43)).toBe("0:00:43");
  });

  it("los valores redondos siguen mostrándose cortos", () => {
    expect(formatDuration(8)).toBe("8:00");
    expect(formatDuration(1.5)).toBe("1:30");
    expect(formatDuration(0.25)).toBe("0:15");
  });

  it("los totales siguen la misma regla", () => {
    expect(formatHoursTotal(0)).toBe("0:00");
    expect(formatHoursTotal(10)).toBe("10:00");
    expect(formatHoursTotal(S43)).toBe("0:00:43");
  });

  it("una celda vacía se queda vacía, no muestra un cero", () => {
    expect(formatHoursShort(0)).toBe("");
  });
});

describe("Lo que se muestra vuelve a entrar igual", () => {
  it("visitar una celda sin tocarla no le cambia el valor", () => {
    // Es el ciclo real: se pinta la celda, el usuario entra y sale, y lo que
    // se pintó se vuelve a analizar y a redondear antes de comparar.
    const mostrado = formatDuration(S43);
    const devuelto = roundHours(parseHoursInput(mostrado)!);

    expect(devuelto).toBe(S43);
  });

  it.each([8, 1.5, 0.25, 7.25])("y tampoco con %s h", (horas) => {
    const devuelto = roundHours(parseHoursInput(formatDuration(horas))!);
    expect(devuelto).toBe(horas);
  });
});

describe("El analizador acepta los formatos que la pantalla usa", () => {
  it("entiende horas, minutos y segundos", () => {
    expect(parseHoursInput("0:00:43")).toBeCloseTo(43 / 3600, 6);
    expect(parseHoursInput("1:30:30")).toBeCloseTo(1.5 + 30 / 3600, 6);
  });

  it("sigue entendiendo lo de antes", () => {
    expect(parseHoursInput("1:30")).toBe(1.5);
    expect(parseHoursInput("1,5")).toBe(1.5);
    expect(parseHoursInput("90m")).toBe(1.5);
    expect(parseHoursInput("2h")).toBe(2);
    expect(parseHoursInput("")).toBe(0);
  });

  it("y ahora también segundos sueltos", () => {
    expect(parseHoursInput("45s")).toBeCloseTo(45 / 3600, 6);
  });

  it("rechaza lo que no es una duración", () => {
    expect(parseHoursInput("ocho")).toBeNull();
    expect(parseHoursInput("1:75")).toBeNull();
  });
});

describe("El redondeo es al menos tan fino como el de la base", () => {
  it("conserva los 4 decimales de la columna", () => {
    expect(roundHours(43 / 3600)).toBe(0.0119);
    expect(roundHours(1 / 3600)).toBe(0.0003);
  });

  it("un minuto ya no se infla a 0.02 h", () => {
    // Con 2 decimales, 60 s (0.01667 h) se guardaban como 0.02 h: un 20 % más.
    expect(roundHours(60 / 3600)).toBe(0.0167);
  });
});
