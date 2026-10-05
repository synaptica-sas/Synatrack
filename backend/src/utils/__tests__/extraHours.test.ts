import { describe, it, expect, vi, beforeEach } from "vitest";
import { isPublicHoliday } from "../holidays.js";
import { calculateExtraHours } from "../calculateExtraHours.js";
import { prisma } from "../../infra/prisma.js";

vi.mock("../../infra/prisma.js", () => {
  return {
    prisma: {
      consultant: {
        findUnique: vi.fn(),
      },
      extraHourEntry: {
        findMany: vi.fn(() => []),
      },
      customHoliday: {
        findMany: vi.fn(() => []),
      },
    },
  };
});

describe("colombianHolidays - isPublicHoliday", () => {
  it("Año Nuevo (1 de Enero) es festivo", () => {
    // 2026-01-01 es Jueves (Año Nuevo)
    const date = new Date(Date.UTC(2026, 0, 1));
    expect(isPublicHoliday(date, "Colombia")).toBe(true);
  });

  it("Día del Trabajo (1 de Mayo) es festivo", () => {
    // 2026-05-01 es Viernes (Día del Trabajo)
    const date = new Date(Date.UTC(2026, 4, 1));
    expect(isPublicHoliday(date, "Colombia")).toBe(true);
  });

  it("Un día ordinario no es festivo", () => {
    // 2026-06-03 es Miércoles (Ordinario)
    const date = new Date(Date.UTC(2026, 5, 3));
    expect(isPublicHoliday(date, "Colombia")).toBe(false);
  });

  it("San José se traslada al lunes siguiente por Ley Emiliani", () => {
    // San José es el 19 de Marzo. En 2026, el 19 de Marzo es Jueves.
    // Se traslada al lunes siguiente: 23 de Marzo.
    const originalDate = new Date(Date.UTC(2026, 2, 19));
    const shiftedDate = new Date(Date.UTC(2026, 2, 23));
    expect(isPublicHoliday(originalDate, "Colombia")).toBe(false);
    expect(isPublicHoliday(shiftedDate, "Colombia")).toBe(true);
  });
});

describe("calculateExtraHours", () => {
  const defaultConfig = {
    weeklyExtraHoursLimit: 12,
    diurnalMultiplier: 1.25,
    nocturnalMultiplier: 1.75,
    diurnalHolidayMultiplier: 2.00,
    nocturnalHolidayMultiplier: 2.50,
    diurnalStart: "06:00:00",
    diurnalEnd: "21:00:00",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("USA / Default: recargo plano +50% (1.50x)", async () => {
    // Consultor de Default con tarifa de $10/h. Trabaja 3 horas diurnas (18:00 a 21:00)
    const date = new Date(Date.UTC(2026, 5, 3)); // Miércoles ordinario
    
    // Mock prisma to return default consultant
    vi.mocked(prisma.consultant.findUnique).mockResolvedValue({
      id: "c-us",
      fullName: "US Consultant",
      email: "us@synaptica.co",
      role: "Developer",
      country: "USA",
      hourlyRate: 10 as any,
      costPerMonth: null,
      rateCurrency: "USD",
      active: true,
      allowWeekendWork: false,
      skills: [],
      seniority: "Senior",
      maxHoursPerDay: 8 as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      identification: null,
      isInternal: true,
      company: null,
    });

    const result = await calculateExtraHours({
      date,
      startTime: "18:00",
      endTime: "21:00",
      consultantId: "c-us",
      config: {
        ...defaultConfig,
        diurnalMultiplier: 1.50,
        nocturnalMultiplier: 1.50,
        diurnalHolidayMultiplier: 1.50,
        nocturnalHolidayMultiplier: 1.50,
      },
    });

    expect(result.totalHours).toBe(3);
    // 3h * $10/h * 1.50 = $45.00
    expect(result.totalAmount).toBe(45);
    expect(result.diurnal).toBe(3);
    expect(result.nocturnal).toBe(0);
  });


  it("Chile: recargo plano +50% (1.50x) y advierte si supera límite de 2h diarias", async () => {
    const date = new Date(Date.UTC(2026, 5, 3)); // Miércoles ordinario

    vi.mocked(prisma.consultant.findUnique).mockResolvedValue({
      id: "c-cl",
      fullName: "Chile Consultant",
      email: "cl@synaptica.co",
      role: "Developer",
      country: "Chile",
      hourlyRate: 20 as any,
      costPerMonth: null,
      rateCurrency: "CLP",
      active: true,
      allowWeekendWork: false,
      skills: [],
      seniority: "Senior",
      maxHoursPerDay: 8 as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      identification: null,
      isInternal: true,
      company: null,
    });

    const result = await calculateExtraHours({
      date,
      startTime: "17:00",
      endTime: "20:00", // 3 horas
      consultantId: "c-cl",
      config: {
        ...defaultConfig,
        diurnalMultiplier: 1.50,
        nocturnalMultiplier: 1.50,
        diurnalHolidayMultiplier: 1.50,
        nocturnalHolidayMultiplier: 1.50,
      },
    });

    expect(result.totalHours).toBe(3);
    expect(result.totalAmount).toBe(3 * 20 * 1.50); // 90
    expect(result.warnings).toContain("Advertencia: El reporte supera el límite legal sugerido de 2 horas extra diarias en Chile.");
  });

  it("Colombia: calcula correctamente franja diurna y nocturna (transiciones de 21:00)", async () => {
    const date = new Date(Date.UTC(2026, 5, 3)); // Miércoles ordinario

    vi.mocked(prisma.consultant.findUnique).mockResolvedValue({
      id: "c-co",
      fullName: "Colombia Consultant",
      email: "co@synaptica.co",
      role: "Developer",
      country: "Colombia",
      hourlyRate: 100 as any,
      costPerMonth: null,
      rateCurrency: "COP",
      active: true,
      allowWeekendWork: false,
      skills: [],
      seniority: "Senior",
      maxHoursPerDay: 8 as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      identification: null,
      isInternal: true,
      company: null,
    });

    // Reporta de 19:00 a 23:00 (2h diurnas de 19:00 a 21:00; y 2h nocturnas de 21:00 a 23:00)
    const result = await calculateExtraHours({
      date,
      startTime: "19:00",
      endTime: "23:00",
      consultantId: "c-co",
      config: defaultConfig,
    });

    expect(result.diurnal).toBe(2);
    expect(result.nocturnal).toBe(2);
    // Diurno: 2h * 100 * 1.25 = 250
    // Nocturno: 2h * 100 * 1.75 = 350
    // Total = 600
    expect(result.totalAmount).toBe(600);
  });

  it("Colombia: aplica el cambio de divisor de 220h a 210h a partir de Julio 15, 2026", async () => {
    // Antes del 15 de julio de 2026 (e.g. 1 de julio)
    const dateBefore = new Date(Date.UTC(2026, 6, 1));
    // Después del 15 de julio de 2026 (e.g. 22 de julio)
    const dateAfter = new Date(Date.UTC(2026, 6, 22));

    // Consultor con salario fijo de $220.000 / mes (sin rate por hora asignada directamente)
    const mockConsultant = {
      id: "c-co-salary",
      fullName: "Salary Consultant",
      email: "salary@synaptica.co",
      role: "Developer",
      country: "Colombia",
      hourlyRate: null,
      costPerMonth: 220000 as any,
      rateCurrency: "COP",
      active: true,
      allowWeekendWork: false,
      skills: [],
      seniority: "Senior",
      maxHoursPerDay: 8 as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      identification: null,
      isInternal: true,
      company: null,
    };

    vi.mocked(prisma.consultant.findUnique).mockResolvedValue(mockConsultant);

    const resultBefore = await calculateExtraHours({
      date: dateBefore,
      startTime: "18:00",
      endTime: "19:00", // 1 hora
      consultantId: "c-co-salary",
      config: defaultConfig,
    });

    // Divisor 220h. Rate = 220000 / 220 = 1000/h. Monto = 1h * 1000 * 1.25 = 1250
    expect(resultBefore.divisorUsed).toBe(220);
    expect(resultBefore.hourlyRate).toBe(1000);
    expect(resultBefore.totalAmount).toBe(1250);

    const resultAfter = await calculateExtraHours({
      date: dateAfter,
      startTime: "18:00",
      endTime: "19:00", // 1 hora
      consultantId: "c-co-salary",
      config: defaultConfig,
    });

    // Divisor 210h. Rate = 220000 / 210 = 1047.62/h. Monto = 1h * 1047.62 * 1.25 = 1309.52
    expect(resultAfter.divisorUsed).toBe(210);
    expect(resultAfter.hourlyRate).toBeCloseTo(220000 / 210, 2);
    expect(resultAfter.totalAmount).toBeCloseTo((220000 / 210) * 1.25, 2);
  });

  it("Perú: primeras 2 horas al +25% (1.25x), siguientes al +35% (1.35x)", async () => {
    const date = new Date(Date.UTC(2026, 5, 3)); // Miércoles ordinario

    vi.mocked(prisma.consultant.findUnique).mockResolvedValue({
      id: "c-pe",
      fullName: "Peru Consultant",
      email: "pe@synaptica.co",
      role: "Developer",
      country: "Peru",
      hourlyRate: 10 as any,
      costPerMonth: null,
      rateCurrency: "PEN",
      active: true,
      allowWeekendWork: false,
      skills: [],
      seniority: "Senior",
      maxHoursPerDay: 8 as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      identification: null,
      isInternal: true,
      company: null,
    });

    // Reporta 4 horas (e.g. 18:00 a 22:00)
    // Primeras 2 horas: 2h * 10 * 1.25 = 25
    // Siguientes 2 horas: 2h * 10 * 1.35 = 27
    // Total = 52
    const result = await calculateExtraHours({
      date,
      startTime: "18:00",
      endTime: "22:00",
      consultantId: "c-pe",
      config: defaultConfig,
    });

    expect(result.totalHours).toBe(4);
    expect(result.totalAmount).toBeCloseTo(52, 0);
  });

  it("México: primeras 9 horas semanales al +100%, excedentes al +200%", async () => {
    const date = new Date(Date.UTC(2026, 5, 3)); // Miércoles ordinario

    vi.mocked(prisma.consultant.findUnique).mockResolvedValue({
      id: "c-mx",
      fullName: "Mexico Consultant",
      email: "mx@synaptica.co",
      role: "Developer",
      country: "Mexico",
      hourlyRate: 10 as any,
      costPerMonth: null,
      rateCurrency: "MXN",
      active: true,
      allowWeekendWork: false,
      skills: [],
      seniority: "Senior",
      maxHoursPerDay: 8 as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      identification: null,
      isInternal: true,
      company: null,
    });

    // Mock findMany de extraHourEntry para simular que ya reportó 7 horas esta semana
    vi.mocked(prisma.extraHourEntry.findMany).mockResolvedValue([
      {
        id: "entry-1",
        consultantId: "c-mx",
        projectId: "p1",
        date: date,
        startTime: "18:00",
        endTime: "21:30", // 3.5h
        diurnal: 3.5 as any,
        nocturnal: 0 as any,
        diurnalHoliday: 0 as any,
        nocturnalHoliday: 0 as any,
        totalHours: 3.5 as any,
        diurnalAmount: 70 as any,
        nocturnalAmount: 0 as any,
        diurnalHolidayAmount: 0 as any,
        nocturnalHolidayAmount: 0 as any,
        totalAmount: 70 as any,
        observations: null,
        status: "APPROVED",
        approvedBy: "PM",
        approvedAt: new Date(),
        rejectionNote: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "entry-2",
        consultantId: "c-mx",
        projectId: "p1",
        date: date,
        startTime: "18:00",
        endTime: "21:30", // 3.5h
        diurnal: 3.5 as any,
        nocturnal: 0 as any,
        diurnalHoliday: 0 as any,
        nocturnalHoliday: 0 as any,
        totalHours: 3.5 as any,
        diurnalAmount: 70 as any,
        nocturnalAmount: 0 as any,
        diurnalHolidayAmount: 0 as any,
        nocturnalHolidayAmount: 0 as any,
        totalAmount: 70 as any,
        observations: null,
        status: "APPROVED",
        approvedBy: "PM",
        approvedAt: new Date(),
        rejectionNote: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    ]);

    // Total acumulado previo: 7 horas.
    // Reporta 4 horas más.
    // 2 horas restantes de las primeras 9 se pagan al +100% (2.0x).
    // 2 horas excedentes se pagan al +200% (3.0x).
    // Monto: (2h * $10 * 2.0) + (2h * $10 * 3.0) = 40 + 60 = 100.
    const result = await calculateExtraHours({
      date,
      startTime: "18:00",
      endTime: "22:00",
      consultantId: "c-mx",
      config: defaultConfig,
    });

    expect(result.totalHours).toBe(4);
    expect(result.totalAmount).toBe(100);
    expect(result.warnings.some((w) => w.includes("7 horas extra registradas esta semana"))).toBe(true);
  });

  it("Ecuador: suplementarias al +50% (1.50x) y extraordinarias al +100% (2.00x)", async () => {
    vi.mocked(prisma.consultant.findUnique).mockResolvedValue({
      id: "c-ec",
      fullName: "Ecuador Consultant",
      email: "ec@synaptica.co",
      role: "Developer",
      country: "Ecuador",
      hourlyRate: 10 as any,
      costPerMonth: null,
      rateCurrency: "USD",
      active: true,
      allowWeekendWork: false,
      skills: [],
      seniority: "Senior",
      maxHoursPerDay: 8 as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      identification: null,
      isInternal: true,
      company: null,
    });

    const ecuadorConfig = {
      weeklyExtraHoursLimit: 12,
      diurnalMultiplier: 1.50,
      nocturnalMultiplier: 1.50,
      diurnalHolidayMultiplier: 2.00,
      nocturnalHolidayMultiplier: 2.00,
      diurnalStart: "06:00:00",
      diurnalEnd: "24:00:00",
    };

    // Caso 1: Suplementarias (día de semana ordinario, de 18:00 a 20:00)
    const dateWeekday = new Date(Date.UTC(2026, 5, 3)); // Miércoles
    const resSuplementarias = await calculateExtraHours({
      date: dateWeekday,
      startTime: "18:00",
      endTime: "20:00",
      consultantId: "c-ec",
      config: ecuadorConfig,
    });
    expect(resSuplementarias.totalHours).toBe(2);
    expect(resSuplementarias.diurnal).toBe(2);
    expect(resSuplementarias.totalAmount).toBe(30);

    // Caso 2: Extraordinarias en fin de semana (Domingo, de 10:00 a 12:00)
    const dateSunday = new Date(Date.UTC(2026, 5, 7)); // Domingo
    const resSunday = await calculateExtraHours({
      date: dateSunday,
      startTime: "10:00",
      endTime: "12:00",
      consultantId: "c-ec",
      config: ecuadorConfig,
    });
    expect(resSunday.totalHours).toBe(2);
    expect(resSunday.diurnalHoliday).toBe(2);
    expect(resSunday.totalAmount).toBe(40);

    // Caso 3: Extraordinarias por horario (Lunes, 01:00 a 03:00)
    const dateMonday = new Date(Date.UTC(2026, 5, 8)); // Lunes
    const resNight = await calculateExtraHours({
      date: dateMonday,
      startTime: "01:00",
      endTime: "03:00",
      consultantId: "c-ec",
      config: ecuadorConfig,
    });
    expect(resNight.totalHours).toBe(2);
    expect(resNight.nocturnalHoliday).toBe(2);
    expect(resNight.totalAmount).toBe(40);
  });

  it("Custom Holidays: liquida a tarifa de feriado si coincide con día ordinario", async () => {
    // Miércoles ordinario (2026-06-03)
    const date = new Date(Date.UTC(2026, 5, 3));

    vi.mocked(prisma.consultant.findUnique).mockResolvedValue({
      id: "c-co-custom-holiday",
      fullName: "Colombia Consultant Custom",
      email: "col-holiday@synaptica.co",
      role: "Developer",
      country: "Colombia",
      hourlyRate: 10 as any,
      costPerMonth: null,
      rateCurrency: "COP",
      active: true,
      allowWeekendWork: false,
      skills: [],
      seniority: "Senior",
      maxHoursPerDay: 8 as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      identification: null,
      isInternal: true,
      company: null,
    });

    // Mock findMany de customHoliday para devolver un feriado corporativo en esa fecha
    vi.mocked(prisma.customHoliday.findMany).mockResolvedValue([
      {
        id: "ch-1",
        name: "Día Especial de la Empresa",
        date: new Date(Date.UTC(2026, 5, 3)),
        country: "Colombia",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const result = await calculateExtraHours({
      date,
      startTime: "08:00",
      endTime: "10:00", // 2h diurnas
      consultantId: "c-co-custom-holiday",
      config: defaultConfig,
    });

    // Debe detectarlo como feriado diurno, pagarse con diurnalHolidayMultiplier (2.00x)
    expect(result.totalHours).toBe(2);
    expect(result.diurnalHoliday).toBe(2);
    expect(result.diurnal).toBe(0);
    expect(result.totalAmount).toBe(2 * 10 * 2.00); // 40
  });
});

