/**
 * Resumen semanal de aprobaciones pendientes — R-020 + R-022.
 *
 * Cálculo PURO: no lee el reloj (el "ahora" entra por parámetro), no toca la
 * base y no envía nada. Aquí se decide **cuándo** toca mandar el resumen y
 * **cómo se reparte** por Project Manager; quien consulta la base y llama al
 * correo es `modules/approvals/weekly-digest.job.ts`.
 *
 * Por qué existe: hasta ahora el PM recibía un correo por CADA solicitud de
 * horas extra (R-022) y ninguno por las horas regulares (R-020). Las dos cosas
 * se arreglan con el mismo mecanismo, así que se construye una sola vez.
 */

/** Ámbito de la fila única de configuración, como en `HealthThresholdConfig`. */
export const AMBITO_GENERAL = "GENERAL";

/** Configuración resuelta del resumen. Todo en números, sin `Decimal`. */
export type ConfigResumenSemanal = {
  /** `false` apaga el resumen por completo. */
  enabled: boolean;
  /** Día ISO de envío: 1 = lunes … 7 = domingo. */
  sendWeekday: number;
  /** Hora UTC de envío (0-23). */
  sendHourUtc: number;
  /** Conservar el aviso inmediato al PM por cada solicitud de horas extra. */
  immediateExtraHour: boolean;
}

/**
 * Valores por defecto, los mismos que siembra la migración.
 *
 * Lunes a las 13:00 UTC = 08:00 en Colombia (UTC-5, sin horario de verano):
 * el PM se encuentra el resumen al empezar la semana. `immediateExtraHour` en
 * `false` porque R-022 pide el resumen **en vez de** el aviso por solicitud.
 */
export const CONFIG_RESUMEN_POR_DEFECTO: ConfigResumenSemanal = {
  enabled: true,
  sendWeekday: 1,
  sendHourUtc: 13,
  immediateExtraHour: false,
};

/** La fila tal como la devuelve Prisma, o `null` si no existe. */
export interface FilaConfigResumen {
  enabled: boolean;
  sendWeekday: number;
  sendHourUtc: number;
  immediateExtraHour: boolean;
}

/**
 * Resuelve la configuración efectiva. Sin fila -> los valores del código.
 * Mismo contrato que `resolverUmbralesSalud`.
 */
export function resolverConfigResumen(fila: FilaConfigResumen | null): ConfigResumenSemanal {
  if (!fila) return { ...CONFIG_RESUMEN_POR_DEFECTO };
  return {
    enabled: fila.enabled,
    sendWeekday: fila.sendWeekday,
    sendHourUtc: fila.sendHourUtc,
    immediateExtraHour: fila.immediateExtraHour,
  };
}

// --- Semana y momento de envío ----------------------------------------------

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Inicio de la semana ISO (lunes 00:00:00 UTC) que contiene `ahora`.
 *
 * Todo el backend calcula en UTC (ver "Convenciones" en CLAUDE.md) y esta es la
 * referencia contra la que se compara `lastSentAt` para saber si el resumen de
 * ESTA semana ya salió.
 */
export function inicioSemanaIsoUtc(ahora: Date): Date {
  const medianoche = Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate());
  // getUTCDay(): 0 = domingo. Se pasa a ISO (1 = lunes … 7 = domingo) para que
  // el domingo quede al FINAL de su semana y no al principio de la siguiente.
  const diaIso = ahora.getUTCDay() === 0 ? 7 : ahora.getUTCDay();
  return new Date(medianoche - (diaIso - 1) * DIA_MS);
}

/**
 * Instante exacto en el que debería salir el resumen de la semana que contiene
 * `ahora`, según el día y la hora configurados.
 */
export function momentoEnvioDeLaSemana(ahora: Date, config: ConfigResumenSemanal): Date {
  const inicio = inicioSemanaIsoUtc(ahora);
  const dia = Math.min(7, Math.max(1, Math.trunc(config.sendWeekday)));
  const hora = Math.min(23, Math.max(0, Math.trunc(config.sendHourUtc)));
  return new Date(inicio.getTime() + (dia - 1) * DIA_MS + hora * 60 * 60 * 1000);
}

/** Por qué se envía o por qué no. Se escribe en el log del trabajo. */
export type MotivoEnvio =
  /** El resumen está apagado por configuración. */
  | "desactivado"
  /** Aún no ha llegado el día y la hora de esta semana. */
  | "todavia-no"
  /** Ya salió el resumen de esta semana. */
  | "ya-enviado"
  /** Toca. */
  | "enviar";

/**
 * Decide si el trabajo debe mandar el resumen de la semana en curso.
 *
 * El ciclo de trabajos corre cada hora, o sea **168 veces por semana**. Esta
 * función es lo que hace que de esas 168 oportunidades se use exactamente una:
 *
 *  1. `enabled` apagado -> nunca.
 *  2. Antes del momento configurado -> todavía no.
 *  3. `ultimoEnvioEn` dentro de la semana en curso -> ya salió.
 *  4. En cualquier otro caso -> toca.
 *
 * El paso 3 compara contra el **inicio de la semana**, no contra "hace 7 días":
 * así, si el servicio estuvo caído el lunes y el ciclo revive el miércoles, el
 * resumen sale el miércoles (tarde, pero sale) en vez de perderse; y si lo que
 * se movió fue el día configurado, tampoco se duplica.
 */
export function decidirEnvio(params: {
  ahora: Date;
  ultimoEnvioEn: Date | null;
  config: ConfigResumenSemanal;
}): MotivoEnvio {
  const { ahora, ultimoEnvioEn, config } = params;

  if (!config.enabled) return "desactivado";
  if (ahora.getTime() < momentoEnvioDeLaSemana(ahora, config).getTime()) return "todavia-no";
  if (ultimoEnvioEn && ultimoEnvioEn.getTime() >= inicioSemanaIsoUtc(ahora).getTime()) {
    return "ya-enviado";
  }
  return "enviar";
}

// --- Agrupación por Project Manager -----------------------------------------

/** Una solicitud pendiente, ya aplanada por quien consulta la base. */
export interface PendienteCrudo {
  /** Correo del PM del proyecto. Puede venir vacío o nulo. */
  pmEmail: string | null;
  consultantName: string;
  projectName: string;
  /** Fecha del día trabajado, en `YYYY-MM-DD`. */
  fecha: string;
  horas: number;
}

/** Una línea del resumen, ya lista para pintar. */
export interface LineaResumen {
  consultantName: string;
  projectName: string;
  fecha: string;
  horas: number;
}

/** Lo que recibe un PM concreto. */
export interface ResumenPm {
  pmEmail: string;
  /** Nombre para el saludo. Si no se conoce, el propio correo. */
  pmNombre: string;
  horas: LineaResumen[];
  horasExtra: LineaResumen[];
  /** Cuántas solicitudes de horas hay en total (no solo las listadas). */
  totalHoras: number;
  /** Cuántas solicitudes de horas extra hay en total. */
  totalHorasExtra: number;
  /** Suma de horas regulares pendientes. */
  sumaHoras: number;
  /** Suma de horas extra pendientes. */
  sumaHorasExtra: number;
  /** Cuántas líneas de horas se omitieron por el tope. */
  horasOmitidas: number;
  /** Cuántas líneas de horas extra se omitieron por el tope. */
  horasExtraOmitidas: number;
}

/**
 * Tope de líneas de detalle por sección.
 *
 * Un PM con meses sin aprobar podría acumular cientos de filas; el correo no es
 * la pantalla de aprobación, es el recordatorio para ir a ella. Lo que pase del
 * tope se cuenta ("y N más"), no se pierde ni infla el mensaje.
 */
export const MAX_LINEAS_POR_SECCION = 15;

function aLinea(p: PendienteCrudo): LineaResumen {
  return {
    consultantName: p.consultantName,
    projectName: p.projectName,
    fecha: p.fecha,
    horas: p.horas,
  };
}

/** Más antiguo primero: lo que lleva más tiempo esperando es lo urgente. */
function porFecha(a: LineaResumen, b: LineaResumen): number {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
  if (a.projectName !== b.projectName) return a.projectName < b.projectName ? -1 : 1;
  return a.consultantName < b.consultantName ? -1 : a.consultantName > b.consultantName ? 1 : 0;
}

/**
 * Agrupa los pendientes por PM.
 *
 * Reglas, todas deliberadas:
 *
 *  - **Un PM solo recibe lo suyo.** La clave es el correo del PM del proyecto,
 *    en minúsculas, que es exactamente el mismo criterio con el que
 *    `time-entries` y `extra-hours` acotan lo que ese PM puede aprobar. Si las
 *    dos cosas se separaran, el correo prometería trabajo que la pantalla no
 *    deja hacer.
 *  - **Sin PM, sin correo.** Una solicitud de un proyecto sin
 *    `projectManagerEmail` (o sin proyecto, que en horas extra es posible) no
 *    tiene destinatario: se devuelve aparte para que el trabajo la cuente en el
 *    log en vez de mandársela a alguien que no le toca.
 *  - **Nunca se incluyen importes.** El resumen lleva horas y fechas, no
 *    dinero: es un recordatorio de aprobación, y meter montos arrastraría la
 *    tarifa del consultor a un canal sin control de acceso.
 *  - **Quien no tiene nada pendiente no aparece.** La lista resultante solo
 *    contiene PM con al menos una solicitud, así que el trabajo no tiene
 *    siquiera la oportunidad de mandar un correo vacío.
 */
export function agruparPendientesPorPm(params: {
  horas: PendienteCrudo[];
  horasExtra: PendienteCrudo[];
  /** Correo -> nombre para el saludo. Lo que falte cae al propio correo. */
  nombresPorEmail?: Map<string, string>;
  maxLineas?: number;
}): { resumenes: ResumenPm[]; sinDestinatario: number } {
  const { horas, horasExtra } = params;
  const nombres = params.nombresPorEmail ?? new Map<string, string>();
  const maxLineas = params.maxLineas ?? MAX_LINEAS_POR_SECCION;

  const acumulado = new Map<string, { horas: PendienteCrudo[]; horasExtra: PendienteCrudo[] }>();
  let sinDestinatario = 0;

  const repartir = (lista: PendienteCrudo[], clase: "horas" | "horasExtra") => {
    for (const pendiente of lista) {
      const email = (pendiente.pmEmail ?? "").trim().toLowerCase();
      if (email === "") {
        sinDestinatario += 1;
        continue;
      }
      const actual = acumulado.get(email) ?? { horas: [], horasExtra: [] };
      actual[clase].push(pendiente);
      acumulado.set(email, actual);
    }
  };

  repartir(horas, "horas");
  repartir(horasExtra, "horasExtra");

  const resumenes: ResumenPm[] = [];

  for (const [pmEmail, grupo] of acumulado) {
    const lineasHoras = grupo.horas.map(aLinea).sort(porFecha);
    const lineasHorasExtra = grupo.horasExtra.map(aLinea).sort(porFecha);

    resumenes.push({
      pmEmail,
      pmNombre: nombres.get(pmEmail) ?? pmEmail,
      horas: lineasHoras.slice(0, maxLineas),
      horasExtra: lineasHorasExtra.slice(0, maxLineas),
      totalHoras: lineasHoras.length,
      totalHorasExtra: lineasHorasExtra.length,
      sumaHoras: redondear(lineasHoras.reduce((acc, l) => acc + l.horas, 0)),
      sumaHorasExtra: redondear(lineasHorasExtra.reduce((acc, l) => acc + l.horas, 0)),
      horasOmitidas: Math.max(0, lineasHoras.length - maxLineas),
      horasExtraOmitidas: Math.max(0, lineasHorasExtra.length - maxLineas),
    });
  }

  // Orden estable por correo: hace la salida reproducible en las pruebas y en
  // el log, que si no dependería del orden de inserción del Map.
  resumenes.sort((a, b) => (a.pmEmail < b.pmEmail ? -1 : a.pmEmail > b.pmEmail ? 1 : 0));

  return { resumenes, sinDestinatario };
}

/** Dos decimales, para que la suma de horas no salga con cola binaria. */
function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}
