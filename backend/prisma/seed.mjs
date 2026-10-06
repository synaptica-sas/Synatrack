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

  // Jornada laboral por país (decisión de negocio D-5).
  // La fila `Default` es el valor general que hereda cualquier país sin
  // configuración propia; Colombia y Ecuador llevan los valores acordados.
  // `update: {}` para no pisar lo que un administrador haya ajustado después.
  const jornadasPorPais = [
    { country: "Default", hoursPerDay: 8, workDaysPerWeek: 5 },
    { country: "Colombia", hoursPerDay: 8.5, workDaysPerWeek: 5 },
    { country: "Ecuador", hoursPerDay: 8, workDaysPerWeek: 5 },
  ];

  for (const jornada of jornadasPorPais) {
    await prisma.capacityConfig.upsert({
      where: { country: jornada.country },
      update: {},
      create: jornada,
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
