import type {
  ApprovedExtraRequest,
  DayEntryInput,
  DaySummary,
  TimeEntry,
  TimeEntryStatus,
  TimeEntryType,
  TimeEntryTypeCategory,
} from "../../services/api";
import { formatDuration, numberish, parseHoursInput, roundHours } from "./timesheetUtils";
import { hoursBetween, isValidTime, rangeFor, timeOfDay } from "./timesheetGrid";

/**
 * Lógica pura de la tabla "Editar tiempo" (R14): qué tipos se ofrecen, cómo se
 * arma el payload de `PUT /day`, el pie con el consumo en vivo y la navegación
 * con teclado. Aparte de la pantalla para probarla sin montar React.
 *
 * El servidor es quien valida de verdad (tope, saldo de extra, fines de semana):
 * aquí solo se anticipa para que el usuario vea el efecto antes de guardar.
 */

/** Un renglón de la tabla. `id` vacío = registro nuevo. */
export type DayRow = {
  /** Clave estable para React; no es el id del servidor. */
  key: string;
  id: string;
  typeId: string;
  duration: string;
  start: string;
  end: string;
  description: string;
  /** Solo los PENDING se editan; el resto se muestra como lectura. */
  editable: boolean;
  /**
   * Fila Extra de otro consultor: solo lectura y se reenvía intacta en el guardado
   * (omitirla la borraría, porque PUT /day elimina los PENDING que no vienen).
   */
  locked?: boolean;
  status: TimeEntryStatus | null;
  isExcess: boolean;
  /** Nota con la que el PM devolvió el registro (R15); se conserva hasta reenviar. */
  rejectionNote?: string | null;
  /** Nombre del tipo, para mostrarlo en filas de solo lectura. */
  typeName: string;
  /** Valores originales del servidor: si no se tocan se reenvían tal cual. */
  original: { hours: number; startedAt: string | null; endedAt: string | null; start: string; end: string; duration: string } | null;
};

let rowCounter = 0;
const nextKey = () => `fila-${++rowCounter}`;

/** Renglón vacío al final de la tabla: escribir en él crea un registro. */
export function blankRow(typeId: string): DayRow {
  return {
    key: nextKey(),
    id: "",
    typeId,
    duration: "",
    start: "",
    end: "",
    description: "",
    editable: true,
    status: null,
    isExcess: false,
    typeName: "",
    original: null,
  };
}

/**
 * `lockExtra`: quien edita no es el consultor dueño de la semana (ADMIN/PM viendo
 * a otro); las horas extra solo las registra el propio consultor.
 */
export function rowFromEntry(entry: TimeEntry, opciones?: { lockExtra?: boolean }): DayRow {
  const lockExtra = opciones?.lockExtra ?? false;
  const locked = lockExtra && (entry.type?.category ?? "REGULAR") === "EXTRA";
  const hours = numberish(entry.hours);
  const duration = formatDuration(hours);
  const start = timeOfDay(entry.startedAt);
  const end = timeOfDay(entry.endedAt);
  return {
    key: nextKey(),
    id: entry.id,
    typeId: entry.typeId ?? entry.type?.id ?? "",
    duration,
    start,
    end,
    description: entry.description ?? "",
    editable: entry.status === "PENDING" && !locked,
    locked,
    status: entry.status,
    isExcess: !!entry.isExcess,
    rejectionNote: entry.rejectionNote,
    typeName: entry.type?.name ?? "Horas Regulares",
    original: { hours, startedAt: entry.startedAt, endedAt: entry.endedAt, start, end, duration },
  };
}

/** ¿El renglón está sin tocar? (el tipo por defecto no cuenta). */
export function isBlank(row: DayRow): boolean {
  return !row.id && !row.duration.trim() && !row.start.trim() && !row.end.trim() && !row.description.trim();
}

/** Garantiza que la tabla termine siempre con exactamente un renglón vacío editable. */
export function withTrailingBlank(rows: DayRow[], defaultTypeId: string): DayRow[] {
  const last = rows[rows.length - 1];
  if (last && last.editable && isBlank(last)) {
    // Si hubiera varios vacíos al final, se deja solo uno.
    let end = rows.length;
    while (end > 1 && rows[end - 2].editable && isBlank(rows[end - 2])) end--;
    return end === rows.length ? rows : rows.slice(0, end);
  }
  return [...rows, blankRow(defaultTypeId)];
}

// ── Entrada flexible de horas y duraciones ───────────────────────────────────

export const MSG_HORA_INVALIDA = "Hora inválida — usa HH:MM, p.ej. 18:30";
export const MSG_DURACION_INVALIDA = "Duración inválida — usa 1:30, 1,5 o 90m";
export const MSG_FIN_ANTES_DE_INICIO = "El fin debe ser posterior al inicio";
export const MSG_MEDIANOCHE = "La franja no puede cruzar la medianoche";

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Interpreta una hora escrita a mano y la devuelve como "HH:MM" de 24 h, o `null`
 * si no se entiende (o está vacía). Acepta "6", "06", "630", "0630", "6:3",
 * "6:30", "18", "1830" y los sufijos a/p/am/pm ("6p", "6 pm", "6:30pm", "12am").
 * Sin sufijo, "6" es 06:00: la lectura de 24 h manda.
 */
export function parseTimeInput(raw: string): string | null {
  const text = raw.trim().toLowerCase().replace(/\s+/g, "");
  const match = /^(\d{1,4}|\d{1,2}:\d{1,2})(am|pm|a|p)?$/.exec(text);
  if (!match) return null;
  const [, body, suffix] = match;

  let hours: number;
  let minutes: number;
  if (body.includes(":")) {
    const [h, m] = body.split(":");
    hours = Number(h);
    minutes = m.length === 1 ? Number(m) * 10 : Number(m);
  } else if (body.length <= 2) {
    hours = Number(body);
    minutes = 0;
  } else {
    hours = Number(body.slice(0, body.length - 2));
    minutes = Number(body.slice(-2));
  }
  if (minutes > 59) return null;

  if (suffix) {
    if (hours < 1 || hours > 12) return null;
    const pm = suffix.startsWith("p");
    hours = (hours % 12) + (pm ? 12 : 0);
  } else if (hours > 23) {
    return null;
  }
  return `${pad2(hours)}:${pad2(minutes)}`;
}

/**
 * Duración escrita a mano, en horas; `null` si no se entiende o está vacía.
 * Además de lo que ya acepta `parseHoursInput` ("2", "2.5", "2,5", "2:30", "45m"),
 * entiende "230" y "0230" como 2:30.
 */
export function parseDurationInput(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  if (/^\d{3,4}$/.test(text)) {
    const n = Number(text);
    const minutes = n % 100;
    return minutes > 59 ? null : Math.floor(n / 100) + minutes / 60;
  }
  return parseHoursInput(text);
}

const toMinutes = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

export type TimeField = "start" | "end" | "duration";
export type TimeFieldError = { message: string; fields: TimeField[] };
export type TimeLinkResult = { changes: Partial<DayRow>; error?: TimeFieldError };

/** Fin = inicio + duración, o un error si la franja se saldría del día. */
function endFrom(start: string, hours: number): { end: string } | { error: TimeFieldError } {
  const total = toMinutes(start) + Math.round(hours * 60);
  if (total > 1439) return { error: { message: MSG_MEDIANOCHE, fields: ["duration"] } };
  return { end: `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}` };
}

/**
 * Enlaza inicio, fin y duración después de que cambió uno (`changed`): inicio+fin
 * calculan la duración; inicio+duración calculan el fin. Mover el inicio con
 * duración conserva la duración y desplaza el fin. Solo usa valores que se
 * entienden; lo ilegible se deja quieto (el aviso de "inválido" sale al salir del campo).
 */
export function linkRow(row: DayRow, changed: TimeField): TimeLinkResult {
  const start = parseTimeInput(row.start);
  const end = parseTimeInput(row.end);
  const hours = parseDurationInput(row.duration);

  const orderError = (fields: TimeField[]): TimeLinkResult => ({
    changes: {},
    error: { message: MSG_FIN_ANTES_DE_INICIO, fields },
  });

  if (changed === "end") {
    if (!end || !start) return { changes: {} };
    const between = hoursBetween(start, end);
    return between === null ? orderError(["end"]) : { changes: { duration: formatDuration(between) } };
  }

  // Cambió el inicio o la duración.
  if (!start) return { changes: {} };
  if (hours !== null && hours > 0) {
    const result = endFrom(start, hours);
    return "error" in result ? { changes: {}, error: result.error } : { changes: { end: result.end } };
  }
  if (changed === "start" && end) {
    const between = hoursBetween(start, end);
    return between === null ? orderError(["start", "end"]) : { changes: { duration: formatDuration(between) } };
  }
  return { changes: {} };
}

/**
 * Normaliza un campo al salir de él: la hora queda como "HH:MM" y la duración
 * como "HH:MM:SS", y se recalculan los demás. Vacío no es error (lo exigen,
 * según el tipo, las validaciones de guardado). Ilegible sí lo es.
 */
export function normalizeField(row: DayRow, field: TimeField): TimeLinkResult {
  const raw = row[field];
  if (!raw.trim()) return { changes: {} };

  let changes: Partial<DayRow>;
  if (field === "duration") {
    const hours = parseDurationInput(raw);
    if (hours === null) return { changes: {}, error: { message: MSG_DURACION_INVALIDA, fields: ["duration"] } };
    changes = { duration: formatDuration(hours) };
  } else {
    const time = parseTimeInput(raw);
    if (time === null) return { changes: {}, error: { message: MSG_HORA_INVALIDA, fields: [field] } };
    changes = { [field]: time };
  }
  const linked = linkRow({ ...row, ...changes }, field);
  return { changes: { ...changes, ...linked.changes }, error: linked.error };
}

/**
 * Normaliza los tres campos de un renglón (para guardar sin haber salido de la
 * celda). Devuelve el renglón resultante y el primer error, si lo hay.
 */
export function normalizeRowTimes(row: DayRow): { row: DayRow; error?: TimeFieldError } {
  let current = row;
  for (const field of ["start", "end", "duration"] as const) {
    const result = normalizeField(current, field);
    current = { ...current, ...result.changes };
    if (result.error) return { row: current, error: result.error };
  }
  return { row: current };
}

// ── Franjas de horas extra aprobadas ─────────────────────────────────────────

/** Franjas aprobadas de ese proyecto en el resumen del día (vacío si el servidor no las manda). */
export function approvedRangesOf(summary: DaySummary | undefined, projectId: string): ApprovedExtraRequest[] {
  return summary?.projects.find((p) => p.projectId === projectId)?.approvedRequests ?? [];
}

/** "18:00–20:00, 21:00–22:00" */
export function formatApprovedRanges(ranges: ApprovedExtraRequest[]): string {
  return ranges.map((r) => `${r.startTime}–${r.endTime}`).join(", ");
}

/**
 * Datos con los que rellenar un renglón que acaba de pasar a Extra: la primera
 * franja aprobada que ningún otro renglón Extra solapa. `null` si el renglón ya
 * tiene inicio o fin, si no hay franjas (servidor viejo) o si todas están cubiertas.
 */
export function prefillExtraRow(
  row: DayRow,
  others: DayRow[],
  ranges: ApprovedExtraRequest[],
  types: TimeEntryType[],
): Partial<DayRow> | null {
  if (row.start.trim() || row.end.trim()) return null;

  const taken: Array<[number, number]> = [];
  for (const other of others) {
    if (categoryOf(types, other.typeId) !== "EXTRA") continue;
    const s = parseTimeInput(other.start);
    const e = parseTimeInput(other.end);
    if (s && e) taken.push([toMinutes(s), toMinutes(e)]);
  }

  for (const range of ranges) {
    const s = parseTimeInput(range.startTime);
    const e = parseTimeInput(range.endTime);
    if (!s || !e) continue;
    const hours = hoursBetween(s, e);
    if (hours === null) continue;
    const [a, b] = [toMinutes(s), toMinutes(e)];
    if (taken.some(([x, y]) => x < b && y > a)) continue;
    return { start: s, end: e, duration: formatDuration(hours) };
  }
  return null;
}

/**
 * Aviso (no bloqueante) si una fila Extra con inicio y fin válidos no queda
 * contenida en ninguna franja aprobada. `null` si no hay nada que avisar o si
 * el servidor no mandó franjas.
 */
export function outsideApprovedWarning(
  row: DayRow,
  ranges: ApprovedExtraRequest[],
  types: TimeEntryType[],
): string | null {
  if (ranges.length === 0 || categoryOf(types, row.typeId) !== "EXTRA") return null;
  const start = parseTimeInput(row.start);
  const end = parseTimeInput(row.end);
  if (!start || !end || hoursBetween(start, end) === null) return null;
  const [a, b] = [toMinutes(start), toMinutes(end)];
  const contained = ranges.some((r) => {
    const rs = parseTimeInput(r.startTime);
    const re = parseTimeInput(r.endTime);
    return !!rs && !!re && toMinutes(rs) <= a && b <= toMinutes(re);
  });
  if (contained) return null;
  const plural = ranges.length > 1;
  return `${start}–${end} está fuera de ${plural ? "las franjas aprobadas" : "la franja aprobada"} ${formatApprovedRanges(ranges)}`;
}

// ── Tipos ofrecidos ──────────────────────────────────────────────────────────

export type OfferContext = {
  isAbsenceProject: boolean;
  /** ¿Hay horas regulares permitidas ese día? (`false` en fin de semana/festivo sin permiso). */
  regularAllowed: boolean;
  /** Saldo de extra aprobado ese día para ESTE proyecto. */
  extraApproved: number;
  /** `false` si quien edita no es el consultor dueño: no se ofrece Extra en filas nuevas. */
  allowExtra?: boolean;
};

/**
 * Tipos que se pueden elegir. En el proyecto Ausencias, solo los de ausencia;
 * en los demás, REGULAR (si el día lo permite) y EXTRA únicamente con saldo
 * aprobado. Un registro existente conserva su tipo aunque ya no se ofrezca, para
 * que la fila no quede con un selector en blanco.
 */
export function offeredTypes(
  types: TimeEntryType[],
  ctx: OfferContext,
  currentTypeIds: string[] = [],
): TimeEntryType[] {
  const keep = new Set(currentTypeIds);
  const allowed = (t: TimeEntryType) => {
    if (keep.has(t.id)) return true;
    if (!t.active) return false;
    if (ctx.isAbsenceProject) return t.category === "ABSENCE";
    if (t.category === "REGULAR") return ctx.regularAllowed;
    if (t.category === "EXTRA") return ctx.allowExtra !== false && ctx.extraApproved > 0;
    return false;
  };
  return types.filter(allowed).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/**
 * Tipo con el que nace un renglón nuevo: Permiso en Ausencias, Regular en el
 * resto (o, si el día no admite regulares, el primero que se ofrezca).
 */
export function defaultTypeId(offered: TimeEntryType[], isAbsenceProject: boolean): string {
  if (isAbsenceProject) {
    return (offered.find((t) => t.code === "PERMISO") ?? offered.find((t) => t.category === "ABSENCE"))?.id ?? "";
  }
  return (offered.find((t) => t.category === "REGULAR") ?? offered[0])?.id ?? "";
}

export function categoryOf(types: TimeEntryType[], typeId: string): TimeEntryTypeCategory | null {
  return types.find((t) => t.id === typeId)?.category ?? null;
}

// ── Horas de un renglón ──────────────────────────────────────────────────────

/** Horas que declara el renglón; `null` si la duración no se entiende. 0 si está vacía. */
export function rowHours(row: DayRow): number | null {
  return row.duration.trim() ? parseDurationInput(row.duration) : 0;
}

// ── Pie con el consumo en vivo ───────────────────────────────────────────────

export type LiveFooter = {
  /** Regular + ausencias de todos los proyectos, con el borrador aplicado. */
  used: number;
  /** Jornada del día. */
  cap: number;
  /** Lo que queda (nunca negativo). */
  remaining: number;
  /** Cuánto se pasa de la jornada (0 si no se pasa). */
  overBy: number;
  /** Solo se muestra si hay saldo aprobado o el borrador usa horas extra. */
  showExtra: boolean;
  extraUsed: number;
  extraApproved: number;
  /** Horas extra del borrador que superan el saldo (quedarán como excedente). */
  extraOver: number;
};

/**
 * Combina el resumen del servidor con el borrador: al total del servidor se le
 * resta lo que ESTE proyecto ya tenía pendiente (lo va a reemplazar el guardado)
 * y se le suma lo que hay escrito en la tabla. Los registros ya revisados y los
 * de otros proyectos quedan tal como los cuenta el servidor.
 */
export function computeLiveFooter(params: {
  summary: DaySummary;
  projectId: string;
  /** Registros actuales del proyecto ese día (los PENDING son los que se reemplazan). */
  entries: TimeEntry[];
  rows: DayRow[];
  types: TimeEntryType[];
}): LiveFooter {
  const { summary, projectId, entries, rows, types } = params;
  const catOfEntry = (e: TimeEntry): TimeEntryTypeCategory => e.type?.category ?? "REGULAR";

  let pendingCap = 0;
  let pendingExtra = 0;
  for (const e of entries) {
    if (e.status !== "PENDING") continue;
    const h = numberish(e.hours);
    const cat = catOfEntry(e);
    if (cat === "EXTRA") {
      if (!e.isExcess) pendingExtra += h;
    } else {
      pendingCap += h;
    }
  }

  let draftCap = 0;
  let draftExtra = 0;
  for (const row of rows) {
    if (!row.editable && !row.locked) continue;
    const h = rowHours(row);
    if (h === null || h <= 0) continue;
    const cat = categoryOf(types, row.typeId) ?? "REGULAR";
    if (cat === "EXTRA") draftExtra += h;
    else draftCap += h;
  }

  const used = roundHours(Math.max(0, summary.usedAgainstCap - pendingCap + draftCap));
  const cap = summary.hoursPerDay;
  const proj = summary.projects.find((p) => p.projectId === projectId);
  const extraApproved = proj?.extraApproved ?? 0;
  const extraUsed = roundHours(Math.max(0, (proj?.extraUsed ?? 0) - pendingExtra + draftExtra));

  return {
    used,
    cap,
    remaining: roundHours(Math.max(0, cap - used)),
    overBy: roundHours(Math.max(0, used - cap)),
    showExtra: extraApproved > 0 || draftExtra > 0,
    extraUsed,
    extraApproved,
    extraOver: roundHours(Math.max(0, extraUsed - extraApproved)),
  };
}

// ── Payload de PUT /day ──────────────────────────────────────────────────────

export type BuiltPayload =
  | { ok: true; entries: DayEntryInput[]; /** Índice de fila de la tabla de cada entrada del payload. */ rowIndexes: number[] }
  | { ok: false; rowIndex: number; message: string };

/**
 * Traduce los renglones a las entradas de `PUT /day`. Se omiten los vacíos y los
 * de solo lectura (el servidor no toca los no PENDING). Valida lo que se puede
 * saber en el cliente y devuelve el renglón culpable para marcarlo.
 */
export function buildDayPayload(day: string, rows: DayRow[], types: TimeEntryType[]): BuiltPayload {
  const entries: DayEntryInput[] = [];
  const rowIndexes: number[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.locked && row.id && row.original) {
      // Fila Extra ajena: se reenvía sin cambios para que el guardado no la borre.
      entries.push({
        id: row.id,
        typeId: row.typeId,
        hours: roundHours(row.original.hours),
        startedAt: row.original.startedAt,
        endedAt: row.original.endedAt,
        description: row.description.trim() || null,
      });
      rowIndexes.push(i);
      continue;
    }
    if (!row.editable || isBlank(row)) continue;

    const fail = (message: string): BuiltPayload => ({ ok: false, rowIndex: i, message });

    if (!row.typeId) return fail("Elige el tipo de hora.");
    const hours = rowHours(row);
    if (hours === null || hours <= 0) {
      return fail(`"${row.duration || "vacío"}" no es una duración válida. Usa 1:30:00, 1,5 o 90m.`);
    }
    if (row.start.trim() && !isValidTime(row.start)) {
      return fail(`"${row.start}" no es una hora de inicio válida. Usa HH:MM, por ejemplo 09:00.`);
    }
    if (row.end.trim() && !isValidTime(row.end)) {
      return fail(`"${row.end}" no es una hora de fin válida. Usa HH:MM, por ejemplo 18:00.`);
    }
    if (!row.start.trim() && row.end.trim()) return fail("Pon también la hora de inicio, o deja vacías las dos.");
    if (row.start.trim() && row.end.trim() && hoursBetween(row.start, row.end) === null) {
      return fail(MSG_FIN_ANTES_DE_INICIO);
    }
    if (categoryOf(types, row.typeId) === "EXTRA" && (!row.start.trim() || !row.end.trim())) {
      return fail("Las horas extra necesitan hora de inicio y de fin.");
    }

    const description = row.description.trim() || null;
    const o = row.original;
    const sinCambioDeFranja =
      !!o && row.start === o.start && row.end === o.end && row.duration === o.duration;

    let startedAt: string | null;
    let endedAt: string | null;
    let finalHours: number;
    if (sinCambioDeFranja) {
      // Se reenvía el instante exacto: reconstruirlo desde "HH:MM" perdería los segundos.
      startedAt = o.startedAt;
      endedAt = o.endedAt;
      finalHours = roundHours(o.hours);
    } else {
      ({ startedAt, endedAt } = rangeFor(day, row.start, hours));
      finalHours = roundHours(hours);
    }

    entries.push({
      ...(row.id ? { id: row.id } : {}),
      typeId: row.typeId,
      hours: finalHours,
      startedAt,
      endedAt,
      description,
    });
    rowIndexes.push(i);
  }

  return { ok: true, entries, rowIndexes };
}

/** Pasa los errores por fila del servidor (índice del payload) a índice de renglón. */
export function mapServerErrors(
  errors: Array<{ index: number | null; message: string }>,
  rowIndexes: number[],
): { byRow: Record<number, string>; general: string[] } {
  const byRow: Record<number, string> = {};
  const general: string[] = [];
  for (const e of errors) {
    const row = e.index === null ? undefined : rowIndexes[e.index];
    if (row === undefined) {
      general.push(e.message);
    } else if (!(row in byRow)) {
      byRow[row] = e.message;
    }
  }
  return { byRow, general };
}

// ── Teclado ──────────────────────────────────────────────────────────────────

export const DAY_COLUMNS = ["type", "start", "end", "duration", "description"] as const;
export type DayColumn = (typeof DAY_COLUMNS)[number];

/**
 * Enter baja a la misma columna de la fila siguiente. La última fila es siempre
 * el renglón vacío, así que la siguiente existe (si se acaba de escribir en el
 * vacío, la pantalla ya agregó uno nuevo al re-renderizar).
 */
export function focusAfterEnter(pos: { row: number; col: DayColumn }): { row: number; col: DayColumn } {
  return { row: pos.row + 1, col: pos.col };
}

/** Tras borrar una fila, el foco se queda en la misma posición (o en la última que quede). */
export function focusAfterDelete(row: number, remainingRows: number): number {
  return Math.max(0, Math.min(row, remainingRows - 1));
}

// ── Celda del grid ───────────────────────────────────────────────────────────

/**
 * ¿La celda se puede teclear directamente? Solo con 0 registros, o con uno solo,
 * pendiente y de tipo Regular (de ausencia en el proyecto Ausencias). Cualquier
 * otra combinación (varios registros, extra, ya revisado) se edita en la ventana.
 */
export function isCellTypable(entries: TimeEntry[], isAbsenceProject: boolean): boolean {
  if (entries.length === 0) return true;
  if (entries.length > 1) return false;
  const only = entries[0];
  if (only.status !== "PENDING" || only.isExcess) return false;
  const category = only.type?.category ?? "REGULAR";
  return category === (isAbsenceProject ? "ABSENCE" : "REGULAR");
}

/** Tipo con el que se crea un registro tecleado en una celda vacía. */
export function cellDefaultTypeId(types: TimeEntryType[], isAbsenceProject: boolean): string | undefined {
  const active = types.filter((t) => t.active);
  if (isAbsenceProject) {
    return (active.find((t) => t.code === "PERMISO") ?? active.find((t) => t.category === "ABSENCE"))?.id;
  }
  // Sin typeId el servidor usa Regular.
  return undefined;
}

/** "7,5/8,4 h": consumo de la jornada para la cabecera del día. */
export function formatDayUsage(used: number, cap: number): string {
  const f = (n: number) => (Math.round(n * 10) / 10).toLocaleString("es", { maximumFractionDigits: 1 });
  return `${f(used)}/${f(cap)} h`;
}
