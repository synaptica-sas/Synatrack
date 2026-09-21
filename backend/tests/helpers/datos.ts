import { prisma } from "../../src/infra/prisma.js";

/**
 * Datos mínimos para las pruebas de ruta. Todo se crea con un prefijo único por
 * ejecución y se borra al final, para no depender del estado previo de la base
 * ni dejar basura.
 */

export type EscenarioBasico = {
  prefijo: string;
  projectId: string;
  consultorA: { id: string; email: string };
  consultorB: { id: string; email: string };
};

export async function crearEscenarioBasico(etiqueta: string): Promise<EscenarioBasico> {
  const prefijo = `${etiqueta}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const project = await prisma.project.create({
    data: {
      name: `Proyecto ${prefijo}`,
      company: "Synaptica",
      country: "Colombia",
      currency: "USD",
      budget: 10000,
      startDate: new Date(Date.UTC(2026, 0, 1)),
      endDate: new Date(Date.UTC(2026, 11, 31)),
      projectManagerEmail: `pm.${prefijo}@synaptica.test`,
    },
  });

  const consultorA = await prisma.consultant.create({
    data: {
      fullName: `Consultor A ${prefijo}`,
      email: `a.${prefijo}@synaptica.test`,
      role: "Consultor",
      hourlyRate: 40,
      rateCurrency: "USD",
      country: "Colombia",
    },
  });

  const consultorB = await prisma.consultant.create({
    data: {
      fullName: `Consultor B ${prefijo}`,
      email: `b.${prefijo}@synaptica.test`,
      role: "Consultor",
      hourlyRate: 999,
      rateCurrency: "USD",
      country: "Colombia",
    },
  });

  return {
    prefijo,
    projectId: project.id,
    consultorA: { id: consultorA.id, email: consultorA.email! },
    consultorB: { id: consultorB.id, email: consultorB.email! },
  };
}

export async function limpiarEscenario(escenario: EscenarioBasico) {
  const consultantIds = [escenario.consultorA.id, escenario.consultorB.id];
  await prisma.extraHourEntry.deleteMany({ where: { consultantId: { in: consultantIds } } });
  await prisma.timeEntry.deleteMany({ where: { consultantId: { in: consultantIds } } });
  await prisma.consultant.deleteMany({ where: { id: { in: consultantIds } } });
  await prisma.project.deleteMany({ where: { id: escenario.projectId } });
}

/** Fila de horas extra ya calculada: las pruebas de alcance no ejercitan el cálculo. */
export async function crearHoraExtra(params: {
  consultantId: string;
  projectId: string;
  fecha: Date;
}) {
  return prisma.extraHourEntry.create({
    data: {
      consultantId: params.consultantId,
      projectId: params.projectId,
      date: params.fecha,
      startTime: "19:00:00",
      endTime: "21:00:00",
      diurnal: 0,
      nocturnal: 2,
      diurnalHoliday: 0,
      nocturnalHoliday: 0,
      totalHours: 2,
      diurnalAmount: 0,
      nocturnalAmount: 100,
      diurnalHolidayAmount: 0,
      nocturnalHolidayAmount: 0,
      totalAmount: 100,
    },
  });
}
