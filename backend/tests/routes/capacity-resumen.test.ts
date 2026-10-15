import { AppRole } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El correo es lo que se observa: `sendEmail` se intercepta antes de cargar el servicio. El resto de
 * `notifications.js` (incluido `escaparHtml`) es el real.
 */
const correos: { to: string; subject: string; text: string; html?: string }[] = [];
vi.mock("../../src/utils/notifications.js", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("../../src/utils/notifications.js")>();
  return {
    ...original,
    sendEmail: async (p: { to: string; subject: string; text: string; html?: string }) => {
      correos.push(p);
    },
  };
});

const { prisma } = await import("../../src/infra/prisma.js");
const { runCapacityDigest } = await import("../../src/modules/capacity/capacity-digest.service.js");

/**
 * Resumen semanal de capacity (CONTRATO §5.4). Se corre con un "ahora" inyectado, así que no depende
 * del reloj. Todo lo que crea la prueba lleva prefijo propio; la fila global de parámetros se guarda y
 * se restaura.
 */
describe("runCapacityDigest", () => {
  const prefijo = `cdig-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const PAIS = `EC-${prefijo}`;
  const NOMBRE_HOSTIL = `<script>alert('${prefijo}')</script>`;

  // Lunes 5-oct-2026. Horizonte de 3 meses desde octubre.
  const LUNES_13 = new Date("2026-10-05T13:00:00Z");
  const LUNES_12 = new Date("2026-10-05T12:00:00Z");
  const MARTES_09 = new Date("2026-10-06T09:00:00Z");
  const LUNES_SIGUIENTE = new Date("2026-10-12T13:00:00Z");

  const emails = {
    admin: `admin.${prefijo}@synaptica.test`,
    comercial: `comercial.${prefijo}@synaptica.test`,
    pm: `pm.${prefijo}@synaptica.test`,
    adminInactivo: `inactivo.${prefijo}@synaptica.test`,
  };
  const userIds: string[] = [];
  let consultorId = "";
  let proyectoId = "";
  let settingsOriginal: Record<string, unknown> | null = null;

  const mios = () => correos.filter((c) => Object.values(emails).includes(c.to));

  async function fijarSettings(datos: Record<string, unknown> = {}) {
    const base = {
      underThresholdPct: 70,
      overThresholdPct: 100,
      alertsEnabled: true,
      alertHorizonMonths: 3,
      digestEnabled: true,
      digestWeekday: 1,
      digestHourUtc: 13,
      digestLastSentAt: null,
      ...datos,
    };
    await prisma.capacitySettings.upsert({
      where: { scope: "GENERAL" },
      update: base,
      create: { scope: "GENERAL", ...base },
    });
  }

  beforeAll(async () => {
    settingsOriginal = (await prisma.capacitySettings.findUnique({
      where: { scope: "GENERAL" },
    })) as unknown as Record<string, unknown> | null;

    const crearUsuario = async (email: string, rol: AppRole, active = true) => {
      const role = await prisma.role.upsert({ where: { name: rol }, update: {}, create: { name: rol } });
      const u = await prisma.user.create({ data: { email, displayName: email, active } });
      await prisma.userRole.create({ data: { userId: u.id, roleId: role.id } });
      userIds.push(u.id);
    };
    await crearUsuario(emails.admin, AppRole.ADMIN);
    await crearUsuario(emails.comercial, AppRole.COMMERCIAL);
    await crearUsuario(emails.pm, AppRole.PM);
    await crearUsuario(emails.adminInactivo, AppRole.ADMIN, false);

    // Un consultor con nombre hostil, sobreasignado al 200 % en octubre de 2026.
    const c = await prisma.consultant.create({
      data: {
        fullName: NOMBRE_HOSTIL,
        email: `hostil.${prefijo}@synaptica.test`,
        role: "Consultor",
        hourlyRate: 40,
        rateCurrency: "USD",
        country: PAIS,
        company: `Resumen ${prefijo}`,
      },
    });
    consultorId = c.id;
    await prisma.capacityConfig.create({
      data: { consultantId: c.id, hoursPerDay: 8, validFrom: new Date("2000-01-01T00:00:00Z") },
    });
    const p = await prisma.project.create({
      data: {
        name: `Proyecto ${prefijo}`,
        company: "Synaptica",
        country: "Colombia",
        currency: "USD",
        budget: 1000,
        startDate: new Date(Date.UTC(2026, 0, 1)),
        endDate: new Date(Date.UTC(2027, 11, 31)),
      },
    });
    proyectoId = p.id;
    await prisma.assignment.create({
      data: {
        consultantId: c.id,
        projectId: p.id,
        startDate: new Date("2026-10-01T00:00:00Z"),
        endDate: new Date("2026-10-31T00:00:00Z"),
        allocationMode: "HOURS",
        hoursPerPeriod: 80,
        periodUnit: "week",
        status: "PLANNED",
      },
    });
  });

  beforeEach(async () => {
    correos.length = 0;
    await fijarSettings();
  });

  afterAll(async () => {
    await prisma.assignment.deleteMany({ where: { consultantId: consultorId } });
    await prisma.capacityConfig.deleteMany({ where: { consultantId: consultorId } });
    await prisma.consultant.deleteMany({ where: { id: consultorId } });
    await prisma.project.deleteMany({ where: { id: proyectoId } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (settingsOriginal) {
      const { scope: _scope, ...resto } = settingsOriginal;
      await prisma.capacitySettings.update({ where: { scope: "GENERAL" }, data: resto as never });
    } else {
      await prisma.capacitySettings.deleteMany({ where: { scope: "GENERAL" } });
    }
  });

  it("no envía antes de la hora configurada del día", async () => {
    const r = await runCapacityDigest(prisma, LUNES_12);
    expect(r).toMatchObject({ enviado: false, motivo: "todavia-no" });
    expect(correos).toHaveLength(0);
    const fila = await prisma.capacitySettings.findUnique({ where: { scope: "GENERAL" } });
    expect(fila?.digestLastSentAt).toBeNull();
  });

  it("no envía fuera del día configurado (miércoles configurado, llega lunes)", async () => {
    await fijarSettings({ digestWeekday: 3 });
    const r = await runCapacityDigest(prisma, LUNES_13);
    expect(r.motivo).toBe("todavia-no");
    expect(correos).toHaveLength(0);
  });

  it("no envía si el resumen está apagado", async () => {
    await fijarSettings({ digestEnabled: false });
    const r = await runCapacityDigest(prisma, LUNES_13);
    expect(r).toMatchObject({ enviado: false, motivo: "desactivado" });
    expect(correos).toHaveLength(0);
  });

  it("envía a ADMIN y COMMERCIAL activos, no al PM ni al usuario inactivo, y marca la semana", async () => {
    const r = await runCapacityDigest(prisma, LUNES_13);
    expect(r.enviado).toBe(true);
    expect(r.motivo).toBe("enviado");
    expect(r.sobre).toBeGreaterThanOrEqual(1);

    const destinos = mios().map((c) => c.to).sort();
    expect(destinos).toEqual([emails.admin, emails.comercial].sort());
    expect(r.destinatarios).toEqual(expect.arrayContaining([emails.admin, emails.comercial]));
    expect(r.destinatarios).not.toContain(emails.pm);
    expect(r.destinatarios).not.toContain(emails.adminInactivo);

    const fila = await prisma.capacitySettings.findUnique({ where: { scope: "GENERAL" } });
    expect(fila?.digestLastSentAt?.toISOString()).toBe(LUNES_13.toISOString());
  });

  it("escapa el nombre del consultor en el HTML y lo deja tal cual en el texto plano", async () => {
    await runCapacityDigest(prisma, LUNES_13);
    const correo = mios()[0];
    expect(correo.subject).toContain("[Capacity]");
    expect(correo.html).not.toContain("<script>");
    expect(correo.html).toContain("&lt;script&gt;");
    expect(correo.text).toContain(NOMBRE_HOSTIL);
    expect(correo.html).toContain("oct-2026");
  });

  it("envía una sola vez por semana ISO aunque el job corra todas las horas", async () => {
    await runCapacityDigest(prisma, LUNES_13);
    const primeros = mios().length;
    expect(primeros).toBe(2);

    for (const momento of [LUNES_13, new Date("2026-10-05T14:00:00Z"), MARTES_09]) {
      const r = await runCapacityDigest(prisma, momento);
      expect(r).toMatchObject({ enviado: false, motivo: "ya-enviado" });
    }
    expect(mios()).toHaveLength(primeros);

    // La semana siguiente vuelve a salir.
    const siguiente = await runCapacityDigest(prisma, LUNES_SIGUIENTE);
    expect(siguiente.enviado).toBe(true);
    expect(mios()).toHaveLength(primeros * 2);
  });

  it("dos ejecuciones simultáneas envían una sola vez (reclamo atómico)", async () => {
    await Promise.all([runCapacityDigest(prisma, LUNES_13), runCapacityDigest(prisma, LUNES_13)]);
    expect(mios()).toHaveLength(2);
  });

  it("sin destinatarios no envía y no marca la semana", async () => {
    await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { active: false } });
    // Otros ADMIN/COMMERCIAL de la base de pruebas también cuentan: solo se afirma si no hay ninguno.
    const otros = await prisma.user.count({
      where: { active: true, roles: { some: { role: { name: { in: [AppRole.ADMIN, AppRole.COMMERCIAL] } } } } },
    });
    const r = await runCapacityDigest(prisma, LUNES_13);
    if (otros === 0) {
      expect(r).toMatchObject({ enviado: false, motivo: "sin-destinatarios" });
      const fila = await prisma.capacitySettings.findUnique({ where: { scope: "GENERAL" } });
      expect(fila?.digestLastSentAt).toBeNull();
    }
    expect(mios()).toHaveLength(0);
    await prisma.user.updateMany({
      where: { id: { in: userIds.slice(0, 3) } },
      data: { active: true },
    });
  });

  it("sin novedades marca la semana pero no envía correo", async () => {
    // Umbrales que no producen ni sobre ni subocupación para nadie.
    await fijarSettings({ underThresholdPct: 0, overThresholdPct: 300 });
    const r = await runCapacityDigest(prisma, LUNES_13);
    expect(r).toMatchObject({ enviado: false, motivo: "sin-novedades", sobre: 0, sub: 0 });
    expect(mios()).toHaveLength(0);
    const fila = await prisma.capacitySettings.findUnique({ where: { scope: "GENERAL" } });
    expect(fila?.digestLastSentAt?.toISOString()).toBe(LUNES_13.toISOString());
  });
});
