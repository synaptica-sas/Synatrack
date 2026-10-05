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
