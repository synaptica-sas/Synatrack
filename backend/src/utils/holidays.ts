const EMILIANI_LAW_START_YEAR = 1984;

// Helper to calculate Easter Sunday (Gauss Algorithm)
export function calculateEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return new Date(Date.UTC(year, month - 1, day));
}

// Helper to get the N-th Monday of a given month (1-indexed month)
function getNthMonday(year: number, month: number, n: number): Date {
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const dayOfWeek = firstDay.getUTCDay(); // 0=Sun, 1=Mon
  const daysUntilMonday = (1 - dayOfWeek + 7) % 7;
  const firstMondayDay = 1 + daysUntilMonday;
  const targetDay = firstMondayDay + (n - 1) * 7;
  return new Date(Date.UTC(year, month - 1, targetDay));
}

// Helper to get the N-th Thursday of a given month
function getNthThursday(year: number, month: number, n: number): Date {
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const dayOfWeek = firstDay.getUTCDay(); // 4=Thu
  const daysUntilThursday = (4 - dayOfWeek + 7) % 7;
  const firstThursdayDay = 1 + daysUntilThursday;
  const targetDay = firstThursdayDay + (n - 1) * 7;
  return new Date(Date.UTC(year, month - 1, targetDay));
}

// Helper to move Chilean holidays under Law 19.668
// (June 29 and October 12 move to preceding Mon if Tue/Wed/Thu, or following Mon if Fri)
function moveChileanHoliday(year: number, month: number, day: number): Date {
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = date.getUTCDay();
  if (dayOfWeek === 2 || dayOfWeek === 3 || dayOfWeek === 4) {
    const offset = dayOfWeek === 2 ? -1 : dayOfWeek === 3 ? -2 : -3;
    return new Date(date.getTime() + offset * 24 * 60 * 60 * 1000);
  } else if (dayOfWeek === 5) {
    return new Date(date.getTime() + 3 * 24 * 60 * 60 * 1000);
  }
  return date;
}

/**
 * Traslado de feriados de Ecuador (Código del Trabajo art. 65 y LOSEP, reformados por la Ley
 * Orgánica Reformatoria de dic-2016):
 * - martes -> lunes anterior; miércoles o jueves -> viernes de la misma semana;
 * - sábado -> viernes anterior; domingo -> lunes siguiente.
 * Se exceptúan (no se trasladan) el 1 de enero, el 25 de diciembre y el carnaval; el Viernes Santo
 * tampoco se mueve (siempre es viernes). Los traslados extraordinarios por decreto ejecutivo
 * (p. ej. Navidad 2021 o Año Nuevo 2022) no los produce este generador: se cargan a mano como
 * feriado DECREE. Coincide con la hoja Feriados del Excel del cliente (Navidad 2027, sábado, sin
 * trasladar).
 */
function ecuadorMoveOffset(dayOfWeek: number): number {
  switch (dayOfWeek) {
    case 6: return -1; // sábado -> viernes anterior
    case 0: return 1; // domingo -> lunes siguiente
    case 2: return -1; // martes -> lunes anterior
    case 3: return 2; // miércoles -> viernes
    case 4: return 1; // jueves -> viernes
    default: return 0; // lunes y viernes no se mueven
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

type HolidayDef = { month: number; day: number; name: string };

/**
 * Coloca los feriados de Ecuador sin que dos caigan el mismo día.
 * Primero se fijan los no trasladables y los que no necesitan moverse; después los que se mueven,
 * en orden cronológico. Si el día de destino ya está ocupado por otro feriado, el que se iba a
 * mover se queda en su fecha original. Es el caso de Difuntos (2-nov) e Independencia de Cuenca
 * (3-nov), que son consecutivos: en 2026 (lunes y martes) Cuenca no se pasa al lunes 2 sino que se
 * queda el martes 3, como en el calendario oficial; en 2027 (martes y miércoles) Difuntos pasa al
 * lunes 1 y Cuenca al viernes 5, sin choque.
 * Supuesto (la ley no lo resuelve): ante un choque, gana el feriado que ya estaba en ese día.
 */
function placeEcuadorHolidays(
  year: number,
  fixed: HolidayDef[],
  movable: HolidayDef[],
  easterBased: { date: Date; name: string }[],
): { date: Date; name: string }[] {
  const placed: { date: Date; name: string }[] = [];
  const taken = new Set<number>();
  const place = (date: Date, name: string) => {
    placed.push({ date, name });
    taken.add(date.getTime());
  };

  for (const f of fixed) place(new Date(Date.UTC(year, f.month - 1, f.day)), f.name);
  for (const e of easterBased) place(e.date, e.name);

  const toMove: { original: Date; target: Date; name: string }[] = [];
  for (const m of movable) {
    const original = new Date(Date.UTC(year, m.month - 1, m.day));
    const offset = ecuadorMoveOffset(original.getUTCDay());
    if (offset === 0) place(original, m.name);
    else toMove.push({ original, target: new Date(original.getTime() + offset * DAY_MS), name: m.name });
  }

  toMove.sort((a, b) => a.original.getTime() - b.original.getTime());
  for (const m of toMove) {
    if (taken.has(m.target.getTime())) place(m.original, m.name);
    else place(m.target, `${m.name} (trasladado)`);
  }
  return placed;
}

function normalizarPais(country: string): string {
  return country.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

type FeriadoCalculado = { date: Date; name: string };

/**
 * Memo por país normalizado y año. `isPublicHoliday` se llama una vez por día
 * dentro de bucles de capacidad; sin esto regeneraba el año entero en cada día.
 * Guarda el arreglo y los días (UTC, ms) ya listos, ambos congelados; quien
 * consume desde fuera recibe copias (ver `getHolidaysForYear`).
 */
const MAX_ENTRADAS_CACHE = 2000;
const cacheFeriados =new Map<string, { lista: readonly FeriadoCalculado[]; dias: ReadonlySet<number> }>();

function feriadosEnCache(year: number, country: string) {
  const clave = `${normalizarPais(country)}|${year}`;
  let entrada = cacheFeriados.get(clave);
  if (!entrada) {
    const lista = Object.freeze(
      calcularFeriadosDelAnio(year, country).map((h) => Object.freeze({ date: h.date, name: h.name })),
    );
    const dias = new Set(
      lista.map((h) => Date.UTC(h.date.getUTCFullYear(), h.date.getUTCMonth(), h.date.getUTCDate())),
    );
    entrada = { lista, dias };
    // El país llega de texto libre: se acota el cache para que no crezca sin fin.
    if (cacheFeriados.size >= MAX_ENTRADAS_CACHE) cacheFeriados.clear();
    cacheFeriados.set(clave, entrada);
  }
  return entrada;
}

/** Devuelve copias: mutar el resultado no contamina el cache. */
export function getHolidaysForYear(year: number, country: string): { date: Date; name: string }[] {
  return feriadosEnCache(year, country).lista.map((h) => ({ date: new Date(h.date.getTime()), name: h.name }));
}

function calcularFeriadosDelAnio(year: number, country: string): { date: Date; name: string }[] {
  if (year < 1900 || year > 3000) {
    throw new Error(`Año ${year} fuera de rango`);
  }

  const holidays: { date: Date; name: string }[] = [];
  const normalizedCountry = country.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  // 1. COLOMBIA
  if (normalizedCountry === "colombia") {
    // Fixed
    const fixed = {
      "01-01": "Año Nuevo",
      "05-01": "Día del Trabajo",
      "07-20": "Día de la Independencia",
      "08-07": "Batalla de Boyacá",
      "12-08": "Día de la Inmaculada Concepción",
      "12-25": "Navidad",
    };
    for (const [key, name] of Object.entries(fixed)) {
      const [m, d] = key.split("-").map(Number);
      holidays.push({ date: new Date(Date.UTC(year, m - 1, d)), name });
    }

    // Movable (Emiliani)
    const movable = {
      "01-06": "Día de los Reyes Magos",
      "03-19": "Día de San José",
      "06-29": "San Pedro y San Pablo",
      "08-15": "La Asunción",
      "10-12": "Día de la Raza",
      "11-01": "Día de Todos los Santos",
      "11-11": "Independencia de Cartagena",
    };
    for (const [key, name] of Object.entries(movable)) {
      const [m, d] = key.split("-").map(Number);
      const originalDate = new Date(Date.UTC(year, m - 1, d));
      if (year >= EMILIANI_LAW_START_YEAR) {
        if (originalDate.getUTCDay() === 1) {
          holidays.push({ date: originalDate, name });
        } else {
          const daysUntilMonday = (1 - originalDate.getUTCDay() + 7) % 7;
          const offset = daysUntilMonday === 0 ? 7 : daysUntilMonday;
          const movedDate = new Date(originalDate.getTime() + offset * 24 * 60 * 60 * 1000);
          holidays.push({ date: movedDate, name: `${name} (trasladado)` });
        }
      } else {
        holidays.push({ date: originalDate, name });
      }
    }

    // Easter Dependent
    const easter = calculateEasterSunday(year);
    const easterDependent = {
      [-3]: "Jueves Santo",
      [-2]: "Viernes Santo",
      [43]: "Ascensión del Señor",
      [64]: "Corpus Christi",
      [71]: "Sagrado Corazón",
    };
    for (const [offsetStr, name] of Object.entries(easterDependent)) {
      const offset = Number(offsetStr);
      const holidayDate = new Date(easter.getTime() + offset * 24 * 60 * 60 * 1000);
      if (offset === -3 || offset === -2) {
        holidays.push({ date: holidayDate, name });
      } else if (year >= EMILIANI_LAW_START_YEAR) {
        if (holidayDate.getUTCDay() === 1) {
          holidays.push({ date: holidayDate, name });
        } else {
          const daysUntilMonday = (1 - holidayDate.getUTCDay() + 7) % 7;
          const offsetMonday = daysUntilMonday === 0 ? 7 : daysUntilMonday;
          const movedDate = new Date(holidayDate.getTime() + offsetMonday * 24 * 60 * 60 * 1000);
          holidays.push({ date: movedDate, name: `${name} (trasladado)` });
        }
      } else {
        holidays.push({ date: holidayDate, name });
      }
    }
  }

  // 2. PERÚ
  else if (normalizedCountry === "peru") {
    const fixed = {
      "01-01": "Año Nuevo",
      "05-01": "Día del Trabajo",
      "06-07": "Día de la Bandera",
      "06-29": "San Pedro y San Pablo",
      "07-23": "Día de la Fuerza Aérea",
      "07-28": "Fiestas Patrias (Independencia)",
      "07-29": "Fiestas Patrias (Fuerzas Armadas)",
      "08-06": "Batalla de Junín",
      "08-30": "Santa Rosa de Lima",
      "10-08": "Combate de Angamos",
      "11-01": "Día de Todos los Santos",
      "12-08": "Día de la Inmaculada Concepción",
      "12-09": "Batalla de Ayacucho",
      "12-25": "Navidad",
    };
    for (const [key, name] of Object.entries(fixed)) {
      const [m, d] = key.split("-").map(Number);
      holidays.push({ date: new Date(Date.UTC(year, m - 1, d)), name });
    }

    // Easter
    const easter = calculateEasterSunday(year);
    holidays.push({ date: new Date(easter.getTime() - 3 * 24 * 60 * 60 * 1000), name: "Jueves Santo" });
    holidays.push({ date: new Date(easter.getTime() - 2 * 24 * 60 * 60 * 1000), name: "Viernes Santo" });
  }

  // 3. CHILE
  else if (normalizedCountry === "chile") {
    const fixed = {
      "01-01": "Año Nuevo",
      "05-01": "Día del Trabajo",
      "05-21": "Día de las Glorias Navales",
      "07-16": "Día de la Virgen del Carmen",
      "08-15": "Asunción de la Virgen",
      "09-18": "Fiestas Patrias (Independencia)",
      "09-19": "Glorias del Ejército",
      "11-01": "Día de Todos los Santos",
      "12-08": "Inmaculada Concepción",
      "12-25": "Navidad",
    };
    for (const [key, name] of Object.entries(fixed)) {
      const [m, d] = key.split("-").map(Number);
      holidays.push({ date: new Date(Date.UTC(year, m - 1, d)), name });
    }

    // Movable (June 29 and October 12)
    holidays.push({ date: moveChileanHoliday(year, 6, 29), name: "San Pedro y San Pablo (trasladado)" });
    holidays.push({ date: moveChileanHoliday(year, 10, 12), name: "Encuentro de Dos Mundos (trasladado)" });

    // Evangélicos (Oct 31: if Wednesday -> Friday Nov 2, if Tuesday -> Friday Oct 27, else Oct 31)
    const evangBase = new Date(Date.UTC(year, 9, 31)); // Oct 31
    const evangDay = evangBase.getUTCDay();
    let evangDate = evangBase;
    if (evangDay === 3) {
      evangDate = new Date(Date.UTC(year, 10, 2)); // Friday Nov 2
    } else if (evangDay === 2) {
      evangDate = new Date(Date.UTC(year, 9, 27)); // Friday Oct 27
    }
    holidays.push({ date: evangDate, name: "Día de las Iglesias Evangélicas y Protestantes" });

    // Easter
    const easter = calculateEasterSunday(year);
    holidays.push({ date: new Date(easter.getTime() - 2 * 24 * 60 * 60 * 1000), name: "Viernes Santo" });
    holidays.push({ date: new Date(easter.getTime() - 1 * 24 * 60 * 60 * 1000), name: "Sábado Santo" });
  }

  // 4. MÉXICO
  else if (normalizedCountry === "mexico") {
    // Fixed
    const fixed = {
      "01-01": "Año Nuevo",
      "05-01": "Día del Trabajo",
      "09-16": "Día de la Independencia",
      "12-25": "Navidad",
    };
    for (const [key, name] of Object.entries(fixed)) {
      const [m, d] = key.split("-").map(Number);
      holidays.push({ date: new Date(Date.UTC(year, m - 1, d)), name });
    }

    // Movables (LFT)
    holidays.push({ date: getNthMonday(year, 2, 1), name: "Día de la Constitución Mexicana" });
    holidays.push({ date: getNthMonday(year, 3, 3), name: "Natalicio de Benito Juárez" });
    holidays.push({ date: getNthMonday(year, 11, 3), name: "Día de la Revolución Mexicana" });

    // Transmisión del Poder Ejecutivo (Dec 1 every 6 years before 2024; Oct 1 starting in 2024)
    if ((year - 2024) % 6 === 0) {
      const month = year >= 2024 ? 9 : 11;
      holidays.push({ date: new Date(Date.UTC(year, month, 1)), name: "Transmisión del Poder Ejecutivo Federal" });
    }
  }

  // 5. ECUADOR
  else if (normalizedCountry === "ecuador") {
    const easter = calculateEasterSunday(year);
    holidays.push(
      ...placeEcuadorHolidays(
        year,
        // No trasladables por ley (ver ecuadorMoveOffset).
        [
          { month: 1, day: 1, name: "Año Nuevo" },
          { month: 12, day: 25, name: "Navidad" },
        ],
        // Trasladables. Día del Trabajo también se traslada (antes se dejaba fijo por error).
        [
          { month: 5, day: 1, name: "Día del Trabajo" },
          { month: 5, day: 24, name: "Batalla de Pichincha" },
          { month: 8, day: 10, name: "Primer Grito de Independencia" },
          { month: 10, day: 9, name: "Independencia de Guayaquil" },
          { month: 11, day: 2, name: "Día de los Difuntos" },
          { month: 11, day: 3, name: "Independencia de Cuenca" },
        ],
        // Carnaval y Viernes Santo dependen de la Pascua y no se trasladan.
        [
          { date: new Date(easter.getTime() - 48 * DAY_MS), name: "Lunes de Carnaval" },
          { date: new Date(easter.getTime() - 47 * DAY_MS), name: "Martes de Carnaval" },
          { date: new Date(easter.getTime() - 2 * DAY_MS), name: "Viernes Santo" },
        ],
      ),
    );
  }

  // 6. ARGENTINA
  else if (normalizedCountry === "argentina") {
    const fixed = {
      "01-01": "Año Nuevo",
      "03-24": "Día Nacional de la Memoria por la Verdad y la Justicia",
      "04-02": "Día del Veterano y de los Caídos en la Guerra de Malvinas",
      "05-01": "Día del Trabajador",
      "05-25": "Día de la Revolución de Mayo",
      "06-20": "Paso a la Inmortalidad del Gral. Manuel Belgrano",
      "07-09": "Día de la Independencia",
      "08-17": "Paso a la Inmortalidad del Gral. José de San Martín",
      "10-12": "Día del Respeto a la Diversidad Cultural",
      "11-20": "Día de la Soberanía Nacional",
      "12-08": "Día de la Inmaculada Concepción",
      "12-25": "Navidad",
    };
    for (const [key, name] of Object.entries(fixed)) {
      const [m, d] = key.split("-").map(Number);
      holidays.push({ date: new Date(Date.UTC(year, m - 1, d)), name });
    }

    const easter = calculateEasterSunday(year);
    holidays.push({ date: new Date(easter.getTime() - 48 * 24 * 60 * 60 * 1000), name: "Lunes de Carnaval" });
    holidays.push({ date: new Date(easter.getTime() - 47 * 24 * 60 * 60 * 1000), name: "Martes de Carnaval" });
    holidays.push({ date: new Date(easter.getTime() - 2 * 24 * 60 * 60 * 1000), name: "Viernes Santo" });
  }

  // 7. ESPAÑA
  else if (normalizedCountry === "espana" || normalizedCountry === "espanna" || normalizedCountry === "spain") {
    const fixed = {
      "01-01": "Año Nuevo",
      "01-06": "Epifanía del Señor",
      "05-01": "Fiesta del Trabajo",
      "08-15": "Asunción de la Virgen",
      "10-12": "Fiesta Nacional de España",
      "11-01": "Todos los Santos",
      "12-06": "Día de la Constitución Española",
      "12-08": "Inmaculada Concepción",
      "12-25": "Navidad",
    };
    for (const [key, name] of Object.entries(fixed)) {
      const [m, d] = key.split("-").map(Number);
      holidays.push({ date: new Date(Date.UTC(year, m - 1, d)), name });
    }

    const easter = calculateEasterSunday(year);
    holidays.push({ date: new Date(easter.getTime() - 2 * 24 * 60 * 60 * 1000), name: "Viernes Santo" });
  }

  // 6. DEFAULT / USA
  else {
    // Fixed
    holidays.push({ date: new Date(Date.UTC(year, 0, 1)), name: "New Year's Day" });
    holidays.push({ date: new Date(Date.UTC(year, 6, 4)), name: "Independence Day" });
    holidays.push({ date: new Date(Date.UTC(year, 11, 25)), name: "Christmas Day" });

    // Movables
    // Labor Day: 1st Monday of Sep
    holidays.push({ date: getNthMonday(year, 9, 1), name: "Labor Day" });
    // Thanksgiving: 4th Thursday of Nov
    holidays.push({ date: getNthThursday(year, 11, 4), name: "Thanksgiving" });
    // Memorial Day: Last Monday of May
    const firstMondayJune = getNthMonday(year, 6, 1);
    const memorialDay = new Date(firstMondayJune.getTime() - 7 * 24 * 60 * 60 * 1000);
    holidays.push({ date: memorialDay, name: "Memorial Day" });
  }

  // Dos feriados pueden coincidir legítimamente (p. ej. en Colombia 2000, San Pedro trasladado y
  // Sagrado Corazón caen el lunes 3-jul). Se devuelve una sola entrada por fecha con los nombres
  // unidos, para que quien precargue la tabla Holiday (única por país/ciudad/fecha) no choque.
  const byDate = new Map<number, { date: Date; name: string }>();
  for (const h of holidays) {
    const prev = byDate.get(h.date.getTime());
    if (prev) prev.name = `${prev.name} / ${h.name}`;
    else byDate.set(h.date.getTime(), { date: h.date, name: h.name });
  }
  return [...byDate.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function isPublicHoliday(date: Date, country: string): boolean {
  const year = date.getUTCFullYear();

  try {
    const targetTime = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    return feriadosEnCache(year, country).dias.has(targetTime);
  } catch {
    return false;
  }
}
