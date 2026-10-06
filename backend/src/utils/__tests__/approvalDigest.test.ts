import { describe, expect, it } from "vitest";
import {
  CONFIG_RESUMEN_POR_DEFECTO,
  agruparPendientesPorPm,
  decidirEnvio,
  inicioSemanaIsoUtc,
  momentoEnvioDeLaSemana,
  resolverConfigResumen,
  type ConfigResumenSemanal,
  type PendienteCrudo,
} from "../approval-digest.js";
import { construirResumenAprobaciones } from "../notifications.js";

/**
 * Resumen semanal de aprobaciones pendientes — R-020 + R-022.
 *
 * Lo que se prueba aquí es exactamente lo que podría salir mal sin que nadie se
 * entere hasta recibir la queja:
 *  · que un PM reciba trabajo de otro PM;
 *  · que el correo salga 168 veces en una semana (el ciclo corre cada hora);
 *  · que alguien reciba un correo vacío cada lunes hasta dejar de leerlos;
 *  · que un nombre de proyecto con `<script>` llegue sin escapar al buzón.
 */

const CONFIG: ConfigResumenSemanal = { ...CONFIG_RESUMEN_POR_DEFECTO };

/** Lunes 6 de octubre de 2026, 13:00 UTC: el momento de envío por defecto. */
const LUNES_13_UTC = new Date("2026-10-05T13:00:00.000Z");

function pendiente(parcial: Partial<PendienteCrudo> = {}): PendienteCrudo {
  return {
    pmEmail: "ana@synaptica.co",
    consultantName: "Carlos Ruiz",
    projectName: "Migración Cloudera",
    fecha: "2026-10-01",
    horas: 8,
    ...parcial,
  };
}

describe("inicioSemanaIsoUtc", () => {
  it("devuelve el lunes a medianoche UTC de la semana que contiene la fecha", () => {
    // 2026-10-05 es lunes; 2026-10-07, miércoles.
    expect(inicioSemanaIsoUtc(new Date("2026-10-07T18:30:00.000Z")).toISOString()).toBe(
      "2026-10-05T00:00:00.000Z",
    );
  });

  it("el propio lunes a las 00:00 ya es el inicio de su semana", () => {
    expect(inicioSemanaIsoUtc(new Date("2026-10-05T00:00:00.000Z")).toISOString()).toBe(
      "2026-10-05T00:00:00.000Z",
    );
  });

  it("el domingo cierra su semana, no abre la siguiente", () => {
    // Si se usara getUTCDay() sin pasar a ISO, el domingo caería en la semana
    // siguiente y el resumen del domingo se duplicaría con el del lunes.
    expect(inicioSemanaIsoUtc(new Date("2026-10-11T23:59:59.000Z")).toISOString()).toBe(
      "2026-10-05T00:00:00.000Z",
    );
  });
});

describe("momentoEnvioDeLaSemana", () => {
  it("coloca el envío en el día y la hora configurados", () => {
    const miercolesA9 = { ...CONFIG, sendWeekday: 3, sendHourUtc: 9 };
    expect(
      momentoEnvioDeLaSemana(new Date("2026-10-05T13:00:00.000Z"), miercolesA9).toISOString(),
    ).toBe("2026-10-07T09:00:00.000Z");
  });

  it("acota valores fuera de rango en vez de producir una fecha absurda", () => {
    const roto = { ...CONFIG, sendWeekday: 99, sendHourUtc: -4 };
    expect(momentoEnvioDeLaSemana(LUNES_13_UTC, roto).toISOString()).toBe(
      "2026-10-11T00:00:00.000Z",
    );
  });
});

describe("decidirEnvio", () => {
  it("no envía nada si el resumen está desactivado", () => {
    expect(
      decidirEnvio({
        ahora: LUNES_13_UTC,
        ultimoEnvioEn: null,
        config: { ...CONFIG, enabled: false },
      }),
    ).toBe("desactivado");
  });

  it("no envía antes del momento configurado", () => {
    expect(
      decidirEnvio({
        ahora: new Date("2026-10-05T12:59:59.000Z"),
        ultimoEnvioEn: null,
        config: CONFIG,
      }),
    ).toBe("todavia-no");
  });

  it("envía en cuanto llega el momento y nunca se ha enviado", () => {
    expect(decidirEnvio({ ahora: LUNES_13_UTC, ultimoEnvioEn: null, config: CONFIG })).toBe(
      "enviar",
    );
  });

  it("no repite si ya se envió esta semana", () => {
    expect(
      decidirEnvio({
        ahora: new Date("2026-10-08T13:00:00.000Z"),
        ultimoEnvioEn: LUNES_13_UTC,
        config: CONFIG,
      }),
    ).toBe("ya-enviado");
  });

  it("vuelve a enviar a la semana siguiente", () => {
    expect(
      decidirEnvio({
        ahora: new Date("2026-10-12T13:00:00.000Z"),
        ultimoEnvioEn: LUNES_13_UTC,
        config: CONFIG,
      }),
    ).toBe("enviar");
  });

  it("recupera un envío perdido: si el servicio estuvo caído el lunes, sale el miércoles", () => {
    // El último envío fue la semana ANTERIOR, así que el miércoles sigue tocando.
    expect(
      decidirEnvio({
        ahora: new Date("2026-10-07T10:00:00.000Z"),
        ultimoEnvioEn: new Date("2026-09-28T13:00:00.000Z"),
        config: CONFIG,
      }),
    ).toBe("enviar");
  });

  /**
   * La prueba que de verdad importa para R-022: el ciclo de trabajos corre cada
   * hora, o sea 168 veces por semana. De esas 168 oportunidades debe salir UN
   * correo, no 168 ni 0.
   */
  it("de 168 ejecuciones horarias en una semana, exactamente una envía", () => {
    // Se parte de una semana ya cubierta para medir solo el régimen estable; el
    // primer arranque tiene su propio caso, justo debajo.
    let ultimoEnvioEn: Date | null = new Date("2026-09-28T13:00:00.000Z");
    let envios = 0;

    // Desde el lunes 00:00 UTC, dos semanas completas hora a hora.
    const arranque = new Date("2026-10-05T00:00:00.000Z").getTime();
    for (let hora = 0; hora < 336; hora += 1) {
      const ahora = new Date(arranque + hora * 3_600_000);
      if (decidirEnvio({ ahora, ultimoEnvioEn, config: CONFIG }) === "enviar") {
        envios += 1;
        ultimoEnvioEn = ahora;
      }
    }

    // Dos semanas -> exactamente dos correos.
    expect(envios).toBe(2);
    expect(ultimoEnvioEn?.toISOString()).toBe("2026-10-12T13:00:00.000Z");
  });

  /**
   * Consecuencia deliberada de comparar contra el inicio de la semana: si el
   * trabajo se estrena un miércoles, no espera al lunes siguiente — manda el
   * resumen de lo que ya está esperando. Para el primer despliegue es lo que se
   * quiere, y a partir de ahí entra en el ritmo semanal normal.
   */
  it("en su primera ejecución envía aunque sea mitad de semana, y luego ya no", () => {
    const miercoles = new Date("2026-10-07T10:00:00.000Z");
    expect(decidirEnvio({ ahora: miercoles, ultimoEnvioEn: null, config: CONFIG })).toBe("enviar");
    expect(
      decidirEnvio({
        ahora: new Date("2026-10-09T10:00:00.000Z"),
        ultimoEnvioEn: miercoles,
        config: CONFIG,
      }),
    ).toBe("ya-enviado");
  });
});

describe("resolverConfigResumen", () => {
  it("sin fila, usa los valores del código", () => {
    expect(resolverConfigResumen(null)).toEqual(CONFIG_RESUMEN_POR_DEFECTO);
  });

  it("el aviso inmediato de horas extra viene apagado por defecto (R-022)", () => {
    expect(CONFIG_RESUMEN_POR_DEFECTO.immediateExtraHour).toBe(false);
  });
});

describe("agruparPendientesPorPm", () => {
  it("cada PM recibe lo suyo y solo lo suyo", () => {
    const { resumenes } = agruparPendientesPorPm({
      horas: [
        pendiente({ pmEmail: "ana@synaptica.co", consultantName: "Carlos" }),
        pendiente({ pmEmail: "beto@synaptica.co", consultantName: "Diana" }),
      ],
      horasExtra: [pendiente({ pmEmail: "ana@synaptica.co", consultantName: "Elena" })],
    });

    expect(resumenes.map((r) => r.pmEmail)).toEqual(["ana@synaptica.co", "beto@synaptica.co"]);

    const ana = resumenes[0];
    expect(ana.horas.map((l) => l.consultantName)).toEqual(["Carlos"]);
    expect(ana.horasExtra.map((l) => l.consultantName)).toEqual(["Elena"]);

    const beto = resumenes[1];
    expect(beto.horas.map((l) => l.consultantName)).toEqual(["Diana"]);
    expect(beto.horasExtra).toEqual([]);
    // Nada de Carlos ni de Elena se ha colado en el resumen de Beto.
    expect(JSON.stringify(beto)).not.toContain("Carlos");
    expect(JSON.stringify(beto)).not.toContain("Elena");
  });

  it("agrupa sin distinguir mayúsculas en el correo del PM", () => {
    const { resumenes } = agruparPendientesPorPm({
      horas: [pendiente({ pmEmail: "Ana@Synaptica.CO" })],
      horasExtra: [pendiente({ pmEmail: "ana@synaptica.co" })],
    });

    expect(resumenes).toHaveLength(1);
    expect(resumenes[0].pmEmail).toBe("ana@synaptica.co");
  });

  it("un PM sin pendientes no aparece: nunca se construye un correo vacío", () => {
    const { resumenes } = agruparPendientesPorPm({ horas: [], horasExtra: [] });
    expect(resumenes).toEqual([]);
  });

  it("cuenta aparte lo que no tiene PM a quien avisar", () => {
    const { resumenes, sinDestinatario } = agruparPendientesPorPm({
      horas: [pendiente({ pmEmail: null }), pendiente({ pmEmail: "   " })],
      horasExtra: [pendiente({ pmEmail: "" })],
    });

    expect(resumenes).toEqual([]);
    expect(sinDestinatario).toBe(3);
  });

  it("suma las horas y ordena de lo más antiguo a lo más reciente", () => {
    const { resumenes } = agruparPendientesPorPm({
      horas: [
        pendiente({ fecha: "2026-10-03", horas: 2.5 }),
        pendiente({ fecha: "2026-09-28", horas: 4 }),
      ],
      horasExtra: [],
    });

    expect(resumenes[0].horas.map((l) => l.fecha)).toEqual(["2026-09-28", "2026-10-03"]);
    expect(resumenes[0].sumaHoras).toBe(6.5);
    expect(resumenes[0].totalHoras).toBe(2);
  });

  it("recorta el detalle al tope y cuenta lo omitido en vez de perderlo", () => {
    const muchas = Array.from({ length: 20 }, (_, i) =>
      pendiente({ fecha: `2026-09-${String(i + 1).padStart(2, "0")}`, horas: 1 }),
    );

    const { resumenes } = agruparPendientesPorPm({ horas: muchas, horasExtra: [], maxLineas: 15 });

    expect(resumenes[0].horas).toHaveLength(15);
    expect(resumenes[0].totalHoras).toBe(20);
    expect(resumenes[0].horasOmitidas).toBe(5);
    expect(resumenes[0].sumaHoras).toBe(20);
  });

  it("usa el nombre del PM cuando se conoce, y el correo cuando no", () => {
    const { resumenes } = agruparPendientesPorPm({
      horas: [pendiente({ pmEmail: "ana@synaptica.co" }), pendiente({ pmEmail: "zoe@synaptica.co" })],
      horasExtra: [],
      nombresPorEmail: new Map([["ana@synaptica.co", "Ana Gómez"]]),
    });

    expect(resumenes[0].pmNombre).toBe("Ana Gómez");
    expect(resumenes[1].pmNombre).toBe("zoe@synaptica.co");
  });

  it("no arrastra ningún importe: el resumen lleva horas, no dinero", () => {
    const { resumenes } = agruparPendientesPorPm({
      horas: [],
      horasExtra: [pendiente({ horas: 3 })],
    });

    const linea = resumenes[0].horasExtra[0];
    expect(Object.keys(linea).sort()).toEqual(["consultantName", "fecha", "horas", "projectName"]);
  });
});

describe("construirResumenAprobaciones", () => {
  const resumenDe = (parcial: Partial<PendienteCrudo> = {}) =>
    agruparPendientesPorPm({
      horas: [pendiente(parcial)],
      horasExtra: [pendiente({ ...parcial, fecha: "2026-10-02", horas: 3 })],
    }).resumenes[0];

  it("el asunto dice cuántas solicitudes hay", () => {
    expect(construirResumenAprobaciones(resumenDe()).subject).toBe(
      "[Aprobaciones] Resumen semanal: 2 solicitudes pendientes",
    );
  });

  it("el texto plano lista las dos secciones con sus datos", () => {
    const { text } = construirResumenAprobaciones(resumenDe());
    expect(text).toContain("HORAS REGULARES");
    expect(text).toContain("HORAS EXTRA");
    expect(text).toContain("2026-10-01 · Carlos Ruiz · Migración Cloudera · 8 h");
    expect(text).toContain("2026-10-02 · Carlos Ruiz · Migración Cloudera · 3 h");
  });

  it("dice explícitamente cuando una de las dos secciones está vacía", () => {
    const soloHoras = agruparPendientesPorPm({ horas: [pendiente()], horasExtra: [] }).resumenes[0];
    const { text, html } = construirResumenAprobaciones(soloHoras);
    expect(text).toContain("HORAS EXTRA: nada pendiente.");
    expect(html).toContain("Nada pendiente.");
  });

  /**
   * Ya hubo un hallazgo por esto: los correos interpolan texto escrito por
   * usuarios. Un consultor puede llamar a su proyecto como quiera.
   */
  it("escapa el HTML de los nombres de consultor y de proyecto", () => {
    const resumen = resumenDe({
      consultantName: '<script>alert("x")</script>',
      projectName: 'Proyecto "A" & <b>B</b>',
    });

    const { html } = construirResumenAprobaciones(resumen);

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain("Proyecto &quot;A&quot; &amp; &lt;b&gt;B&lt;/b&gt;");
  });

  it("escapa también el nombre del PM en el saludo", () => {
    const resumen = {
      ...resumenDe(),
      pmNombre: "<img src=x onerror='robar()'>",
    };

    const { html } = construirResumenAprobaciones(resumen);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&#39;robar()&#39;&gt;");
  });

  it("anuncia el resto cuando el detalle se recortó", () => {
    const muchas = Array.from({ length: 18 }, (_, i) =>
      pendiente({ fecha: `2026-09-${String(i + 1).padStart(2, "0")}` }),
    );
    const resumen = agruparPendientesPorPm({ horas: muchas, horasExtra: [] }).resumenes[0];
    const { text, html } = construirResumenAprobaciones(resumen);

    expect(text).toContain("… y 3 solicitud(es) más.");
    expect(html).toContain("… y 3 solicitud(es) más.");
  });
});
