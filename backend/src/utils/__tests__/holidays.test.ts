import { describe, it, expect } from "vitest";
import { isPublicHoliday, getHolidaysForYear } from "../holidays.js";

describe("Ecuador holidays calculation", () => {
  it("Año Nuevo (1 de Enero) de 2026 no se mueve", () => {
    // 2026-01-01 es Jueves
    const date = new Date(Date.UTC(2026, 0, 1));
    expect(isPublicHoliday(date, "Ecuador")).toBe(true);
  });

  it("Batalla de Pichincha (24 de Mayo) cae en Domingo de 2026 y se traslada al Lunes 25", () => {
    const originalDate = new Date(Date.UTC(2026, 4, 24)); // Domingo
    const shiftedDate = new Date(Date.UTC(2026, 4, 25)); // Lunes

    // El domingo original no es festivo público en sí mismo porque se traslada al lunes
    expect(isPublicHoliday(originalDate, "Ecuador")).toBe(false);
    // El domingo ya no es devuelto por isPublicHoliday directamente, sino manejado en la lógica de horas extra o es día ordinario de asueto.
    expect(isPublicHoliday(originalDate, "Ecuador")).toBe(false);
    // El lunes 25 debe ser festivo por traslado
    expect(isPublicHoliday(shiftedDate, "Ecuador")).toBe(true);

    const holidays = getHolidaysForYear(2026, "Ecuador");
    const pichincha = holidays.find(h => h.name.includes("Pichincha"));
    expect(pichincha).toBeDefined();
    // Debe estar registrado el lunes 25 de mayo de 2026
    expect(pichincha!.date.getUTCDate()).toBe(25);
    expect(pichincha!.date.getUTCMonth()).toBe(4); // Mayo (0-indexed)
  });

  it("Independencia de Guayaquil (9 de Octubre) de 2026 cae en Viernes y se mantiene el viernes", () => {
    const date = new Date(Date.UTC(2026, 9, 9)); // Viernes
    expect(isPublicHoliday(date, "Ecuador")).toBe(true);
  });
});

describe("Mexico holidays calculation", () => {
  it("Año Nuevo (1 de Enero) de 2026 es feriado en México", () => {
    const date = new Date(Date.UTC(2026, 0, 1));
    expect(isPublicHoliday(date, "Mexico")).toBe(true);
  });

  it("Natalicio de Benito Juárez es el tercer lunes de marzo", () => {
    // En 2026, marzo inicia en Domingo. El primer lunes es 2, el segundo es 9, el tercero es 16.
    const date = new Date(Date.UTC(2026, 2, 16));
    expect(isPublicHoliday(date, "Mexico")).toBe(true);
  });

  it("Transmisión del Poder Ejecutivo Federal es el 1 de Octubre a partir de 2024", () => {
    const transition2024 = new Date(Date.UTC(2024, 9, 1)); // 1 de Octubre (mes 9 es Octubre)
    expect(isPublicHoliday(transition2024, "Mexico")).toBe(true);

    const check2023 = new Date(Date.UTC(2023, 9, 1));
    expect(isPublicHoliday(check2023, "Mexico")).toBe(false);
  });

  it("Domingos no son marcados automáticamente como festivos nacionales", () => {
    const sunday = new Date(Date.UTC(2026, 4, 17)); // Domingo
    expect(isPublicHoliday(sunday, "Mexico")).toBe(false);
  });
});

describe("Accented and tilde country names normalization", () => {
  it("Maneja correctamente 'México', 'Perú' y 'España' con tildes y caracteres especiales", () => {
    const dateMexico = new Date(Date.UTC(2026, 0, 1));
    expect(isPublicHoliday(dateMexico, "México")).toBe(true);

    const datePeru = new Date(Date.UTC(2026, 0, 1));
    expect(isPublicHoliday(datePeru, "Perú")).toBe(true);

    const dateEspana = new Date(Date.UTC(2026, 0, 1));
    expect(isPublicHoliday(dateEspana, "España")).toBe(true);
  });
});

// ─── Contra la hoja Feriados del Excel del cliente (tarea 0.1) ────────────────

function isoListBetween(country: string, from: string, to: string): string[] {
  const years = [Number(from.slice(0, 4)), Number(to.slice(0, 4))];
  const out: string[] = [];
  for (let y = years[0]; y <= years[1]; y++) {
    for (const h of getHolidaysForYear(y, country)) {
      const iso = h.date.toISOString().slice(0, 10);
      if (iso >= from && iso <= to) out.push(iso);
    }
  }
  return out.sort();
}

describe("Generador contra la hoja Feriados del Excel (2026-10 a 2027-12)", () => {
  it("Ecuador: lista exacta de feriados nacionales (sin decretos ni locales)", () => {
    expect(isoListBetween("Ecuador", "2026-10-01", "2027-12-31")).toEqual([
      "2026-10-09", // Independencia de Guayaquil (viernes)
      "2026-11-02", // Difuntos (lunes)
      "2026-11-03", // Independencia de Cuenca (martes; no se mueve al lunes porque choca con Difuntos)
      "2026-12-25", // Navidad
      "2027-01-01", // Año Nuevo
      "2027-02-08", // Carnaval
      "2027-02-09", // Carnaval
      "2027-03-26", // Viernes Santo
      "2027-04-30", // Día del Trabajo (sábado 1-may -> viernes anterior)
      "2027-05-24", // Batalla de Pichincha (lunes)
      "2027-08-09", // Primer Grito (martes 10-ago -> lunes anterior)
      "2027-10-08", // Independencia de Guayaquil (sábado 9-oct -> viernes anterior)
      "2027-11-01", // Difuntos (martes 2-nov -> lunes anterior)
      "2027-11-05", // Independencia de Cuenca (miércoles 3-nov -> viernes)
      "2027-12-25", // Navidad (sábado: excepción legal, no se traslada)
    ]);
  });

  it("Ecuador: el generador no produce los feriados por decreto ni los locales de Quito", () => {
    const list = isoListBetween("Ecuador", "2026-10-01", "2027-12-31");
    expect(list).not.toContain("2026-11-20"); // Decreto 507
    expect(list).not.toContain("2026-12-07"); // Fundación de Quito (local)
    expect(list).not.toContain("2027-12-06"); // Fundación de Quito (local)
  });

  it("Ecuador: Día del Trabajo en domingo pasa al lunes y en jueves al viernes", () => {
    // 2022-05-01 domingo -> lunes 2; 2025-05-01 jueves -> viernes 2
    expect(isPublicHoliday(new Date(Date.UTC(2022, 4, 2)), "Ecuador")).toBe(true);
    expect(isPublicHoliday(new Date(Date.UTC(2022, 4, 1)), "Ecuador")).toBe(false);
    expect(isPublicHoliday(new Date(Date.UTC(2025, 4, 2)), "Ecuador")).toBe(true);
    expect(isPublicHoliday(new Date(Date.UTC(2025, 4, 1)), "Ecuador")).toBe(false);
  });

  it("Ecuador: 1 de enero y 25 de diciembre no se trasladan aunque caigan en fin de semana", () => {
    // 2028-01-01 es sábado; 2027-12-25 es sábado
    expect(isPublicHoliday(new Date(Date.UTC(2028, 0, 1)), "Ecuador")).toBe(true);
    expect(isPublicHoliday(new Date(Date.UTC(2027, 11, 24)), "Ecuador")).toBe(false);
  });

  it("Colombia: lista exacta (coincide con el Excel)", () => {
    expect(isoListBetween("Colombia", "2026-10-01", "2027-12-31")).toEqual([
      "2026-10-12", "2026-11-02", "2026-11-16", "2026-12-08", "2026-12-25",
      "2027-01-01", "2027-01-11", "2027-03-22", "2027-03-25", "2027-03-26",
      "2027-05-01", "2027-05-10", "2027-05-31", "2027-06-07", "2027-07-05",
      "2027-07-20", "2027-08-07", "2027-08-16", "2027-10-18", "2027-11-01",
      "2027-11-15", "2027-12-08", "2027-12-25",
    ]);
  });

  it("dos feriados que coinciden se devuelven en una sola entrada con los dos nombres", () => {
    // Colombia 2000: San Pedro (jue 29-jun -> lun 3-jul) y Sagrado Corazón (Pascua + 71 = lun 3-jul)
    const julio3 = getHolidaysForYear(2000, "Colombia").filter((h) => h.date.toISOString().startsWith("2000-07-03"));
    expect(julio3).toHaveLength(1);
    expect(julio3[0].name).toContain("San Pedro");
    expect(julio3[0].name).toContain("Sagrado Corazón");
  });

  it("ningún país produce dos feriados el mismo día en un año (2000-2050)", () => {
    const countries = ["Ecuador", "Colombia", "Peru", "Chile", "Mexico", "Argentina", "España", "Default"];
    for (const country of countries) {
      for (let year = 2000; year <= 2050; year++) {
        const dates = getHolidaysForYear(year, country).map((h) => h.date.toISOString().slice(0, 10));
        const dups = dates.filter((d, i) => dates.indexOf(d) !== i);
        expect({ country, year, dups }).toEqual({ country, year, dups: [] });
      }
    }
  });
});

describe("cache de feriados por país y año", () => {
  it("devuelve copias: mutar el resultado no contamina las siguientes lecturas", () => {
    const primera = getHolidaysForYear(2031, "Colombia");
    const nombre = primera[0].name;
    const tiempo = primera[0].date.getTime();
    const total = primera.length;
    primera[0].name = "MUTADO";
    primera[0].date.setUTCFullYear(1999);
    primera.pop();

    const segunda = getHolidaysForYear(2031, "Colombia");
    expect(segunda[0].name).toBe(nombre);
    expect(segunda[0].date.getTime()).toBe(tiempo);
    expect(segunda.length).toBe(total);
  });

  it("normaliza el país igual que antes (tildes y mayúsculas comparten resultado)", () => {
    expect(getHolidaysForYear(2031, "PERÚ")).toEqual(getHolidaysForYear(2031, "peru"));
  });

  it("isPublicHoliday acierta con el cache y el año fuera de rango sigue lanzando/false", () => {
    expect(isPublicHoliday(new Date(Date.UTC(2031, 11, 25)), "Colombia")).toBe(true);
    expect(isPublicHoliday(new Date(Date.UTC(2031, 11, 25)), "Colombia")).toBe(true);
    expect(isPublicHoliday(new Date(Date.UTC(2031, 11, 24)), "Colombia")).toBe(false);
    expect(isPublicHoliday(new Date(Date.UTC(1500, 0, 1)), "Colombia")).toBe(false);
    expect(() => getHolidaysForYear(3001, "Colombia")).toThrow();
  });
});
