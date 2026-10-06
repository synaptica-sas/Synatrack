import { AppRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El correo es lo que se observa, así que la notificación se intercepta antes
 * de cargar nada que la use. En local no hay SMTP y `sendEmail` cae a un
 * `[SMTP MOCK]` que solo escribe un log: sin este espía no habría forma de
 * comprobar a quién se mandó qué.
 *
 * Se intercepta `notifyWeeklyApprovalDigest` y NO `sendEmail`, por una razón
 * concreta: en ESM, cuando una función llama a otra de su propio módulo usa el
 * enlace local, no el exportado, así que sustituir `sendEmail` desde fuera no
 * intercepta nada. El doble llama al constructor REAL del correo
 * (`construirResumenAprobaciones`, con su `escaparHtml` incluido) y guarda su
 * salida tal cual: lo que se prueba es el contenido de verdad, no una maqueta.
 */
const correosEnviados: { to: string; subject: string; text: string; html?: string }[] = [];

/** Avisos inmediatos de horas extra (R-022): el que debía desaparecer. */
const avisosInmediatos: { pmEmail: string; consultantName: string }[] = [];

vi.mock("../../src/utils/notifications.js", async (importarOriginal) => {
  const original =
    await importarOriginal<typeof import("../../src/utils/notifications.js")>();
  return {
    ...original,
    notifyWeeklyApprovalDigest: async (resumen: Parameters<
      typeof original.notifyWeeklyApprovalDigest
    >[0]) => {
      const { subject, text, html } = original.construirResumenAprobaciones(resumen);
      correosEnviados.push({ to: resumen.pmEmail, subject, text, html });
    },
    notifyNewExtraHourRequest: async (params: { pmEmail: string; consultantName: string }) => {
      avisosInmediatos.push({ pmEmail: params.pmEmail, consultantName: params.consultantName });
    },
  };
});

const { prisma } = await import("../../src/infra/prisma.js");
const { comoRol, crearAppDePrueba } = await import("../helpers/app.js");
const { AMBITO_GENERAL, CONFIG_RESUMEN_POR_DEFECTO } = await import(
  "../../src/utils/approval-digest.js"
);
const { runWeeklyApprovalDigest } = await import(
  "../../src/modules/approvals/weekly-digest.job.js"
);

/**
 * Resumen semanal de aprobaciones pendientes — R-020 + R-022.
 *
 * Lo que solo se puede comprobar con base de datos real y la app montada:
 *  · que el resumen se arma con las horas y horas extra que de verdad están
 *    pendientes, y que cada PM recibe las de SUS proyectos y nada más;
 *  · que **no sale dos veces en la misma semana** aunque el trabajo se ejecute
 *    una y otra vez — el ciclo corre cada hora, 168 veces por semana;
 *  · que al PM sin nada pendiente no le llega nada;
 *  · que la configuración solo la escribe ADMIN y deja rastro en auditoría;
 *  · que el aviso inmediato de horas extra ya NO sale por defecto (R-022).
 *
 * Todo lo que crea la prueba lleva prefijo propio y se borra al final. La fila
 * de configuración es global: se guarda al empezar y se restaura al terminar.
 */
describe("Resumen semanal de aprobaciones (R-020 + R-022)", () => {
  let app: FastifyInstance;

  const prefijo = `rsm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const pmAna = `ana.${prefijo}@synaptica.test`;
  const pmBeto = `beto.${prefijo}@synaptica.test`;
  const pmSinNada = `zoe.${prefijo}@synaptica.test`;

  let proyectoAnaId = "";
  let proyectoBetoId = "";
  let proyectoSinPmId = "";
  let consultorId = "";
  let consultorTravesuraId = "";

  /** Fila de configuración tal y como estaba, para restaurarla al terminar. */
  let configOriginal: Record<string, unknown> | null = null;

  /** Lunes 5 de octubre de 2026, 13:00 UTC: el momento de envío por defecto. */
  const LUNES_13_UTC = new Date("2026-10-05T13:00:00.000Z");

  /** Deja la marca de envío en blanco para que el trabajo pueda volver a enviar. */
  async function olvidarUltimoEnvio() {
    await prisma.approvalDigestConfig.updateMany({
      where: { scope: AMBITO_GENERAL },
      data: { lastSentAt: null },
    });
  }

  function correoDe(destinatario: string) {
    return correosEnviados.find((c) => c.to === destinatario);
  }

  beforeAll(async () => {
    app = await crearAppDePrueba();

    const fila = await prisma.approvalDigestConfig.findUnique({
      where: { scope: AMBITO_GENERAL },
    });
    configOriginal = fila as unknown as Record<string, unknown> | null;

    await prisma.approvalDigestConfig.upsert({
      where: { scope: AMBITO_GENERAL },
      update: { ...CONFIG_RESUMEN_POR_DEFECTO, lastSentAt: null },
      create: { scope: AMBITO_GENERAL, ...CONFIG_RESUMEN_POR_DEFECTO },
    });

    // El nombre del PM para el saludo sale de `User.displayName`.
    await prisma.user.create({
      data: { email: pmAna, displayName: `Ana ${prefijo}` },
    });

    const proyectoBase = {
      company: `Empresa ${prefijo}`,
      country: "Colombia",
      budget: 100_000,
      currency: "USD",
      status: "ACTIVE" as const,
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2027-12-31T00:00:00.000Z"),
    };

    proyectoAnaId = (
      await prisma.project.create({
        data: { ...proyectoBase, name: `Proyecto Ana ${prefijo}`, projectManagerEmail: pmAna },
      })
    ).id;

    proyectoBetoId = (
      await prisma.project.create({
        data: { ...proyectoBase, name: `Proyecto Beto ${prefijo}`, projectManagerEmail: pmBeto },
      })
    ).id;

    // Proyecto huérfano: nadie a quien avisar de sus pendientes.
    proyectoSinPmId = (
      await prisma.project.create({
        data: { ...proyectoBase, name: `Proyecto sin PM ${prefijo}`, projectManagerEmail: null },
      })
    ).id;

    consultorId = (
      await prisma.consultant.create({
        data: {
          fullName: `Carlos ${prefijo}`,
          email: `carlos.${prefijo}@synaptica.test`,
          hourlyRate: 50,
          country: "Colombia",
          role: "Consultor",
        },
      })
    ).id;

    // Nombre con HTML dentro: lo escribe una persona y acaba en un correo.
    consultorTravesuraId = (
      await prisma.consultant.create({
        data: {
          fullName: `<script>alert("x")</script> ${prefijo}`,
          email: `travieso.${prefijo}@synaptica.test`,
          hourlyRate: 50,
          country: "Colombia",
          role: "Consultor",
        },
      })
    ).id;

    // Horas regulares PENDIENTES (R-020): dos de Ana, una de Beto, una huérfana.
    await prisma.timeEntry.createMany({
      data: [
        {
          projectId: proyectoAnaId,
          consultantId: consultorId,
          workDate: new Date("2026-09-30T00:00:00.000Z"),
          hours: 8,
          status: "PENDING",
        },
        {
          projectId: proyectoAnaId,
          consultantId: consultorTravesuraId,
          workDate: new Date("2026-10-01T00:00:00.000Z"),
          hours: 4,
          status: "PENDING",
        },
        {
          projectId: proyectoBetoId,
          consultantId: consultorId,
          workDate: new Date("2026-10-01T00:00:00.000Z"),
          hours: 6,
          status: "PENDING",
        },
        {
          projectId: proyectoSinPmId,
          consultantId: consultorId,
          workDate: new Date("2026-10-01T00:00:00.000Z"),
          hours: 3,
          status: "PENDING",
        },
        // Ya aprobada: NO debe aparecer en el resumen de nadie.
        {
          projectId: proyectoAnaId,
          consultantId: consultorId,
          workDate: new Date("2026-09-15T00:00:00.000Z"),
          hours: 7,
          status: "APPROVED",
        },
      ],
    });

    // Horas extra pendientes del PM (R-022): una de Ana.
    await prisma.extraHourEntry.create({
      data: {
        projectId: proyectoAnaId,
        consultantId: consultorId,
        date: new Date("2026-10-02T00:00:00.000Z"),
        startTime: "19:00:00",
        endTime: "22:00:00",
        diurnal: 0,
        nocturnal: 3,
        diurnalHoliday: 0,
        nocturnalHoliday: 0,
        totalHours: 3,
        diurnalAmount: 0,
        nocturnalAmount: 262_500,
        diurnalHolidayAmount: 0,
        nocturnalHolidayAmount: 0,
        totalAmount: 262_500,
        status: "PENDING_PM",
      },
    });
  });

  afterAll(async () => {
    await prisma.extraHourEntry.deleteMany({
      where: { consultantId: { in: [consultorId, consultorTravesuraId] } },
    });
    await prisma.timeEntry.deleteMany({
      where: { consultantId: { in: [consultorId, consultorTravesuraId] } },
    });
    await prisma.consultant.deleteMany({
      where: { id: { in: [consultorId, consultorTravesuraId] } },
    });
    await prisma.project.deleteMany({
      where: { id: { in: [proyectoAnaId, proyectoBetoId, proyectoSinPmId] } },
    });
    await prisma.user.deleteMany({ where: { email: pmAna } });
    await prisma.auditLog.deleteMany({ where: { entity: "approvalDigestConfig" } });

    // Restaurar la configuración global exactamente como estaba.
    await prisma.approvalDigestConfig.deleteMany({ where: { scope: AMBITO_GENERAL } });
    if (configOriginal) {
      await prisma.approvalDigestConfig.create({ data: configOriginal as never });
    }

    await app.close();
  });

  beforeEach(() => {
    correosEnviados.length = 0;
    avisosInmediatos.length = 0;
  });

  afterEach(async () => {
    await prisma.approvalDigestConfig.updateMany({
      where: { scope: AMBITO_GENERAL },
      data: { ...CONFIG_RESUMEN_POR_DEFECTO },
    });
  });

  // ── El resumen: contenido y alcance ──────────────────────────────────────

  it("manda un correo por PM, con lo de sus proyectos y nada más", async () => {
    await olvidarUltimoEnvio();
    const resultado = await runWeeklyApprovalDigest(prisma, LUNES_13_UTC);

    expect(resultado.motivo).toBe("enviar");

    const deAna = correoDe(pmAna);
    const deBeto = correoDe(pmBeto);
    expect(deAna, "Ana debe recibir su resumen").toBeTruthy();
    expect(deBeto, "Beto debe recibir el suyo").toBeTruthy();

    // Ana: 2 horas regulares + 1 hora extra, todas de SU proyecto.
    expect(deAna!.subject).toContain("3 solicitudes pendientes");
    expect(deAna!.text).toContain(`Proyecto Ana ${prefijo}`);
    expect(deAna!.text).toContain("HORAS REGULARES: 2 solicitud(es), 12 horas en total.");
    expect(deAna!.text).toContain("HORAS EXTRA: 1 solicitud(es), 3 horas en total.");

    // Y nada del proyecto de Beto ni del proyecto huérfano.
    expect(deAna!.text).not.toContain(`Proyecto Beto ${prefijo}`);
    expect(deAna!.text).not.toContain(`Proyecto sin PM ${prefijo}`);

    // Beto: solo lo suyo, y su sección de horas extra vacía.
    expect(deBeto!.text).toContain(`Proyecto Beto ${prefijo}`);
    expect(deBeto!.text).not.toContain(`Proyecto Ana ${prefijo}`);
    expect(deBeto!.text).toContain("HORAS EXTRA: nada pendiente.");
  });

  it("saluda al PM por su nombre cuando existe el usuario, y por su correo si no", async () => {
    await olvidarUltimoEnvio();
    await runWeeklyApprovalDigest(prisma, LUNES_13_UTC);

    expect(correoDe(pmAna)!.text).toContain(`Hola Ana ${prefijo},`);
    // Beto no tiene fila en `User`: se le saluda con su correo, no con "undefined".
    expect(correoDe(pmBeto)!.text).toContain(`Hola ${pmBeto},`);
  });

  it("no incluye las horas ya aprobadas", async () => {
    await olvidarUltimoEnvio();
    await runWeeklyApprovalDigest(prisma, LUNES_13_UTC);
    // La entrada APPROVED es del 2026-09-15; si se colara, aparecería esa fecha.
    expect(correoDe(pmAna)!.text).not.toContain("2026-09-15");
  });

  it("no manda nada a un PM sin pendientes", async () => {
    await olvidarUltimoEnvio();
    await runWeeklyApprovalDigest(prisma, LUNES_13_UTC);

    expect(correoDe(pmSinNada)).toBeUndefined();
    expect(correosEnviados.map((c) => c.to).sort()).toEqual([pmAna, pmBeto].sort());
  });

  it("cuenta aparte lo que no tiene PM en vez de mandárselo a alguien", async () => {
    await olvidarUltimoEnvio();
    const resultado = await runWeeklyApprovalDigest(prisma, LUNES_13_UTC);

    expect(resultado.sinDestinatario).toBeGreaterThanOrEqual(1);
    for (const correo of correosEnviados) {
      expect(correo.text).not.toContain(`Proyecto sin PM ${prefijo}`);
    }
  });

  it("escapa el HTML del nombre del consultor en el correo", async () => {
    await olvidarUltimoEnvio();
    await runWeeklyApprovalDigest(prisma, LUNES_13_UTC);

    const html = correoDe(pmAna)!.html!;
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });

  it("no arrastra importes al correo: lleva horas, no dinero", async () => {
    await olvidarUltimoEnvio();
    await runWeeklyApprovalDigest(prisma, LUNES_13_UTC);

    const deAna = correoDe(pmAna)!;
    // 262.500 es el `totalAmount` de la hora extra sembrada.
    expect(deAna.text).not.toContain("262500");
    expect(deAna.text).not.toContain("262.500");
    expect(deAna.html).not.toContain("262500");
  });

  // ── El envío duplicado, que es el riesgo real ────────────────────────────

  it("NO se manda dos veces en la misma semana aunque el trabajo corra muchas veces", async () => {
    await olvidarUltimoEnvio();

    const primero = await runWeeklyApprovalDigest(prisma, LUNES_13_UTC);
    expect(primero.motivo).toBe("enviar");
    const enviadosTrasElPrimero = correosEnviados.length;
    expect(enviadosTrasElPrimero).toBe(2);

    // 24 ejecuciones más a lo largo de la misma semana: ni un correo más.
    for (let hora = 1; hora <= 24; hora += 1) {
      const resultado = await runWeeklyApprovalDigest(
        prisma,
        new Date(LUNES_13_UTC.getTime() + hora * 3_600_000),
      );
      expect(resultado.motivo).toBe("ya-enviado");
      expect(resultado.enviados).toBe(0);
    }

    expect(correosEnviados).toHaveLength(enviadosTrasElPrimero);
  });

  it("dos ejecuciones simultáneas: solo una se queda con la semana", async () => {
    await olvidarUltimoEnvio();

    // Sin esperar a la primera: es el caso de dos instancias del servidor a la
    // vez, que el cerrojo en memoria de `jobs.service.ts` no cubre. Quien decide
    // es el UPDATE condicional sobre `lastSentAt`, que es atómico en Postgres.
    const [a, b] = await Promise.all([
      runWeeklyApprovalDigest(prisma, LUNES_13_UTC),
      runWeeklyApprovalDigest(prisma, LUNES_13_UTC),
    ]);

    const motivos = [a.motivo, b.motivo].sort();
    expect(motivos).toEqual(["enviar", "reclamado-por-otro"]);
    expect(a.enviados + b.enviados).toBe(2); // dos PM, un correo cada uno
    expect(correosEnviados).toHaveLength(2);
  });

  it("vuelve a enviar la semana siguiente", async () => {
    await olvidarUltimoEnvio();
    await runWeeklyApprovalDigest(prisma, LUNES_13_UTC);
    correosEnviados.length = 0;

    const siguiente = await runWeeklyApprovalDigest(
      prisma,
      new Date("2026-10-12T13:00:00.000Z"),
    );
    expect(siguiente.motivo).toBe("enviar");
    expect(correosEnviados.length).toBeGreaterThan(0);
  });

  it("no manda nada antes de la hora configurada", async () => {
    await olvidarUltimoEnvio();
    const resultado = await runWeeklyApprovalDigest(
      prisma,
      new Date("2026-10-05T12:00:00.000Z"),
    );

    expect(resultado.motivo).toBe("todavia-no");
    expect(correosEnviados).toHaveLength(0);
  });

  it("apagar el resumen por configuración lo apaga de verdad", async () => {
    await olvidarUltimoEnvio();
    await prisma.approvalDigestConfig.updateMany({
      where: { scope: AMBITO_GENERAL },
      data: { enabled: false },
    });

    const resultado = await runWeeklyApprovalDigest(prisma, LUNES_13_UTC);
    expect(resultado.motivo).toBe("desactivado");
    expect(correosEnviados).toHaveLength(0);
  });

  // ── La pantalla de configuración ─────────────────────────────────────────

  it("cualquier rol puede leer la configuración", async () => {
    for (const rol of [AppRole.PM, AppRole.CONSULTANT, AppRole.FINANCE, AppRole.VIEWER]) {
      const res = await app.inject({
        method: "GET",
        url: "/api/approval-digest",
        headers: comoRol(rol),
      });
      expect(res.statusCode, `rol ${rol}`).toBe(200);
      expect(res.json().data.sendWeekday).toBe(1);
      expect(res.json().data.porDefecto).toEqual(CONFIG_RESUMEN_POR_DEFECTO);
    }
  });

  it("solo ADMIN puede escribirla", async () => {
    const payload = { ...CONFIG_RESUMEN_POR_DEFECTO, sendWeekday: 3 };

    for (const rol of [AppRole.PM, AppRole.CONSULTANT, AppRole.FINANCE, AppRole.VIEWER]) {
      const res = await app.inject({
        method: "PUT",
        url: "/api/approval-digest",
        headers: comoRol(rol),
        payload,
      });
      expect(res.statusCode, `rol ${rol}`).toBe(403);
    }

    const comoAdmin = await app.inject({
      method: "PUT",
      url: "/api/approval-digest",
      headers: comoRol(AppRole.ADMIN),
      payload,
    });
    expect(comoAdmin.statusCode).toBe(200);
    expect(comoAdmin.json().data.sendWeekday).toBe(3);
    expect(comoAdmin.json().data.origen).toBe("base");
  });

  it("rechaza un día o una hora fuera de rango", async () => {
    const casos = [
      { ...CONFIG_RESUMEN_POR_DEFECTO, sendWeekday: 0 },
      { ...CONFIG_RESUMEN_POR_DEFECTO, sendWeekday: 8 },
      { ...CONFIG_RESUMEN_POR_DEFECTO, sendHourUtc: 24 },
      { ...CONFIG_RESUMEN_POR_DEFECTO, sendHourUtc: -1 },
      { ...CONFIG_RESUMEN_POR_DEFECTO, sendWeekday: 1.5 },
    ];

    for (const payload of casos) {
      const res = await app.inject({
        method: "PUT",
        url: "/api/approval-digest",
        headers: comoRol(AppRole.ADMIN),
        payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it("guardar la configuración deja rastro en la bitácora", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/approval-digest",
      headers: comoRol(AppRole.ADMIN, "admin@synaptica.local"),
      payload: { ...CONFIG_RESUMEN_POR_DEFECTO, sendHourUtc: 11 },
    });

    const registro = await prisma.auditLog.findFirst({
      where: { entity: "approvalDigestConfig" },
      orderBy: { createdAt: "desc" },
    });

    expect(registro, "debe haber una entrada de auditoría").toBeTruthy();
    expect(registro!.changedBy).toBe("admin@synaptica.local");
    expect(JSON.stringify(registro!.after)).toContain('"sendHourUtc":11');
  });

  it("escribir la configuración NO toca la marca del último envío", async () => {
    await olvidarUltimoEnvio();
    await runWeeklyApprovalDigest(prisma, LUNES_13_UTC);

    await app.inject({
      method: "PUT",
      url: "/api/approval-digest",
      headers: comoRol(AppRole.ADMIN),
      payload: { ...CONFIG_RESUMEN_POR_DEFECTO, sendHourUtc: 9 },
    });

    // Si el PUT hubiera borrado `lastSentAt`, aquí volvería a enviar.
    correosEnviados.length = 0;
    const resultado = await runWeeklyApprovalDigest(prisma, LUNES_13_UTC);
    expect(resultado.motivo).toBe("ya-enviado");
    expect(correosEnviados).toHaveLength(0);
  });

  // ── El aviso inmediato de horas extra (R-022) ────────────────────────────

  it("crear una hora extra ya NO dispara el correo inmediato al PM", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/extra-hours",
      headers: comoRol(AppRole.ADMIN),
      payload: {
        projectId: proyectoAnaId,
        consultantId: consultorId,
        date: "2026-10-03",
        startTime: "19:00",
        endTime: "21:00",
      },
    });

    expect(res.statusCode).toBe(201);
    // Nada dirigido al PM. (Sí puede salir el aviso a Nómina en la aprobación,
    // que es otro flujo y no se toca aquí.)
    expect(avisosInmediatos).toHaveLength(0);
  });

  it("pero puede recuperarse desde la pantalla sin desplegar nada", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/approval-digest",
      headers: comoRol(AppRole.ADMIN),
      payload: { ...CONFIG_RESUMEN_POR_DEFECTO, immediateExtraHour: true },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/extra-hours",
      headers: comoRol(AppRole.ADMIN),
      payload: {
        projectId: proyectoAnaId,
        consultantId: consultorId,
        date: "2026-10-04",
        startTime: "19:00",
        endTime: "21:00",
      },
    });
    expect(res.statusCode).toBe(201);

    // El aviso sale en segundo plano (no se espera en el handler).
    await vi.waitFor(() => {
      expect(avisosInmediatos.length).toBeGreaterThan(0);
    });
    expect(avisosInmediatos[0].pmEmail).toBe(pmAna);
  });

  // ── Vigilancia del trabajo ───────────────────────────────────────────────

  it("el trabajo está en el catálogo de /health: si deja de correr, se nota", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    const cuerpo = res.json();
    const nombres = (cuerpo.jobs?.trabajos ?? []).map((t: { nombre: string }) => t.nombre);
    expect(nombres).toContain("approval-digest");
  });
});
