import "dotenv/config";
import { AppRole, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const adminEmail = (process.env.ADMIN_EMAIL || "admin@synaptica.local").toLowerCase();

  // Create standard roles
  await Promise.all(
    Object.values(AppRole).map((role) =>
      prisma.role.upsert({
        where: { name: role },
        update: {},
        create: { name: role },
      }),
    ),
  );

  const adminRole = await prisma.role.findUnique({ where: { name: AppRole.ADMIN } });
  if (!adminRole) {
    throw new Error("ADMIN role was not created");
  }

  // Create admin user
  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      displayName: "Administrador",
      active: true,
    },
    create: {
      email: adminEmail,
      displayName: "Administrador",
      active: true,
    },
  });

  // Assign ADMIN role to the admin user
  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: adminUser.id,
        roleId: adminRole.id,
      },
    },
    update: {},
    create: {
      userId: adminUser.id,
      roleId: adminRole.id,
    },
  });

  // Corrección puntual de `monthlyDivisor` (DEP-10).
  // Antes vivía en `ensureDefaultConfigs()` y corría en cada petición de horas extra.
  // Aquí es idempotente: solo toca las filas que siguen con el 220 heredado del DEFAULT
  // de la columna, nunca un valor ajustado a mano por un administrador.
  const monthlyDivisorFixes = {
    Peru: 240,
    Chile: 180,
    Mexico: 240,
    Ecuador: 240,
    Argentina: 200,
    "España": 160,
  };

  for (const [country, monthlyDivisor] of Object.entries(monthlyDivisorFixes)) {
    await prisma.extraHoursConfig.updateMany({
      where: { country, monthlyDivisor: 220 },
      data: { monthlyDivisor },
    });
  }

  // Jornada laboral por país (decisión de negocio D-5) con vigencia (P1).
  // La fila `Default` es el valor general que hereda cualquier país sin
  // configuración propia. Colombia pasa de 8 a 8,4 h desde el 2026-07-15: son
  // dos filas, y así los meses anteriores no se recalculan. Idempotente por
  // (country, validFrom) y con `update: {}` para no pisar lo que un
  // administrador haya ajustado después.
  const vigenciaInicial = new Date(Date.UTC(2000, 0, 1));
  const jornadasPorPais = [
    { country: "Default", hoursPerDay: 8, workDaysPerWeek: 5, validFrom: vigenciaInicial },
    { country: "Colombia", hoursPerDay: 8, workDaysPerWeek: 5, validFrom: vigenciaInicial },
    { country: "Colombia", hoursPerDay: 8.4, workDaysPerWeek: 5, validFrom: new Date(Date.UTC(2026, 6, 15)) },
    { country: "Ecuador", hoursPerDay: 8, workDaysPerWeek: 5, validFrom: vigenciaInicial },
  ];

  for (const jornada of jornadasPorPais) {
    await prisma.capacityConfig.upsert({
      where: { country_validFrom: { country: jornada.country, validFrom: jornada.validFrom } },
      update: {},
      create: jornada,
    });
  }

  // Parámetros de capacity: umbrales 70 % / 100 % y probables excluidos. La
  // migración ya la siembra; esto es para que una base recién creada quede igual.
  await prisma.capacitySettings.upsert({
    where: { scope: "GENERAL" },
    update: {},
    create: { scope: "GENERAL", underThresholdPct: 70, overThresholdPct: 100, includeProbablesDefault: false },
  });

  // Feriados Ecuador y Colombia (hoja Feriados del Excel de capacity), oct-2026 a dic-2027.
  // city "" = nacional; "Quito" = local. source DECREE para el decreto ejecutivo.
  // NO se confirman años en HolidayCalendarYear: lo hace un ADMIN desde la UI.
  // Idempotente por (country, city, date); `update: {}` respeta ediciones posteriores.
  const feriados = [
    ["Ecuador", "", "2026-10-09", "Independencia de Guayaquil"],
    ["Ecuador", "", "2026-11-02", "Día de Difuntos"],
    ["Ecuador", "", "2026-11-03", "Independencia de Cuenca"],
    ["Ecuador", "", "2026-11-20", "Suspensión de jornada – Decreto Ejecutivo 507", "DECREE"],
    ["Ecuador", "Quito", "2026-12-07", "Fundación de Quito"],
    ["Ecuador", "", "2026-12-25", "Navidad"],
    ["Ecuador", "", "2027-01-01", "Año Nuevo"],
    ["Ecuador", "", "2027-02-08", "Carnaval (lunes)"],
    ["Ecuador", "", "2027-02-09", "Carnaval (martes)"],
    ["Ecuador", "", "2027-03-26", "Viernes Santo"],
    ["Ecuador", "", "2027-04-30", "Día del Trabajo (trasladado del sáb 1-may)"],
    ["Ecuador", "", "2027-05-24", "Batalla de Pichincha"],
    ["Ecuador", "", "2027-08-09", "Primer Grito de Independencia (trasladado del mar 10-ago)"],
    ["Ecuador", "", "2027-10-08", "Independencia de Guayaquil (trasladado del sáb 9-oct)"],
    ["Ecuador", "", "2027-11-01", "Día de Difuntos (trasladado del mar 2-nov)"],
    ["Ecuador", "", "2027-11-05", "Independencia de Cuenca (trasladado del mié 3-nov)"],
    ["Ecuador", "Quito", "2027-12-06", "Fundación de Quito"],
    ["Ecuador", "", "2027-12-25", "Navidad"],
    ["Colombia", "", "2026-10-12", "Día de la Raza"],
    ["Colombia", "", "2026-11-02", "Todos los Santos"],
    ["Colombia", "", "2026-11-16", "Independencia de Cartagena"],
    ["Colombia", "", "2026-12-08", "Inmaculada Concepción"],
    ["Colombia", "", "2026-12-25", "Navidad"],
    ["Colombia", "", "2027-01-01", "Año Nuevo"],
    ["Colombia", "", "2027-01-11", "Reyes Magos"],
    ["Colombia", "", "2027-03-22", "San José"],
    ["Colombia", "", "2027-03-25", "Jueves Santo"],
    ["Colombia", "", "2027-03-26", "Viernes Santo"],
    ["Colombia", "", "2027-05-01", "Día del Trabajo"],
    ["Colombia", "", "2027-05-10", "Ascensión"],
    ["Colombia", "", "2027-05-31", "Corpus Christi"],
    ["Colombia", "", "2027-06-07", "Sagrado Corazón"],
    ["Colombia", "", "2027-07-05", "San Pedro y San Pablo"],
    ["Colombia", "", "2027-07-20", "Independencia"],
    ["Colombia", "", "2027-08-07", "Batalla de Boyacá"],
    ["Colombia", "", "2027-08-16", "Asunción de la Virgen"],
    ["Colombia", "", "2027-10-18", "Día de la Raza"],
    ["Colombia", "", "2027-11-01", "Todos los Santos"],
    ["Colombia", "", "2027-11-15", "Independencia de Cartagena"],
    ["Colombia", "", "2027-12-08", "Inmaculada Concepción"],
    ["Colombia", "", "2027-12-25", "Navidad"],
  ];

  for (const [country, city, fecha, name, source = "MANUAL"] of feriados) {
    const date = new Date(`${fecha}T00:00:00.000Z`);
    await prisma.holiday.upsert({
      where: { country_city_date: { country, city, date } },
      update: {},
      create: { country, city, date, name, source },
    });
  }

  // Catálogo de categorías financieras (D-4). Las dos de ingreso son las
  // genéricas que pidió dirección; las de gasto son las siete que hasta ahora
  // estaban escritas en el frontend. La migración ya las siembra: esto es para
  // que una base recién creada por `migrate deploy` + seed quede igual.
  const categoriasFinancieras = [
    { type: "REVENUE", name: "Servicios de consultoría", sortOrder: 1 },
    { type: "REVENUE", name: "Otros ingresos", sortOrder: 99 },
    { type: "EXPENSE", name: "Viajes", sortOrder: 1 },
    { type: "EXPENSE", name: "Alojamiento", sortOrder: 2 },
    { type: "EXPENSE", name: "Alimentacion", sortOrder: 3 },
    { type: "EXPENSE", name: "Transporte", sortOrder: 4 },
    { type: "EXPENSE", name: "Software", sortOrder: 5 },
    { type: "EXPENSE", name: "Servicios", sortOrder: 6 },
    { type: "EXPENSE", name: "Otros", sortOrder: 99 },
  ];

  for (const categoria of categoriasFinancieras) {
    await prisma.financialCategory.upsert({
      where: { type_name: { type: categoria.type, name: categoria.name } },
      update: {},
      create: categoria,
    });
  }

  // Umbrales del semáforo de salud (D-7). Una sola fila general con los
  // valores que confirmó dirección: CPI y SPI crítico 0,75 y advertencia 0,90,
  // presupuesto 90 % de aviso y 100 % de excedido. La migración ya la siembra;
  // esto es para que una base recién creada quede igual sin depender de ella.
  // `update: {}` para no pisar lo que un administrador haya ajustado después.
  await prisma.healthThresholdConfig.upsert({
    where: { scope: "GENERAL" },
    update: {},
    create: {
      scope: "GENERAL",
      cpiWarning: 0.9,
      cpiCritical: 0.75,
      spiWarning: 0.9,
      spiCritical: 0.75,
      budgetWarningPct: 90,
      budgetCriticalPct: 100,
    },
  });

  // Configuración del resumen semanal de aprobaciones (R-020 + R-022): activo,
  // lunes a las 13:00 UTC (08:00 en Colombia) y SIN el aviso inmediato de horas
  // extra, que es justo lo que el resumen viene a reemplazar. La migración ya la
  // siembra; esto es para que una base recién creada quede igual sin depender de
  // ella. `update: {}` para no pisar lo ajustado desde la pantalla, y en especial
  // para no borrar `lastSentAt`, la marca que evita un segundo envío semanal.
  await prisma.approvalDigestConfig.upsert({
    where: { scope: "GENERAL" },
    update: {},
    create: {
      scope: "GENERAL",
      enabled: true,
      sendWeekday: 1,
      sendHourUtc: 13,
      immediateExtraHour: false,
    },
  });

  console.log("Database initialized successfully with roles and admin user.");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
