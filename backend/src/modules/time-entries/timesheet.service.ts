/**
 * Escritura del timesheet con las reglas de R14 (tope diario, tipos de hora, horas extra
 * aprobadas, excedente y bloqueos por ausencia).
 *
 * Lo usan `PUT /api/time-entries/day`, `POST` y `PATCH /api/time-entries` y (en parte)
 * `POST /api/timer/stop`. Las reglas puras viven en `utils/timesheetRules.ts`; aquí solo se
 * arma el estado final del día, se valida con `validateDay` ANTES de escribir nada y se aplica.
 *
 * Todo corre sobre el cliente que se reciba (`Db`), así que dentro de `prisma.$transaction`
 * un fallo posterior deshace el día completo. Las auditorías no se escriben aquí: se devuelven
 * como eventos para que el llamador las registre cuando la transacción ya confirmó.
 */

import { BlockType, Prisma, TimeEntrySource, TimeEntryStatus } from "@prisma/client";
import {
  HOURS_TOLERANCE,
  roundHours,
  splitExcess,
  validateDay,
  type DaySummary,
  type ExtraRowInput,
  type TimeEntryCategory,
} from "../../utils/timesheetRules.js";
import {
  loadDayContext,
  lockDay,
  summaryOfContext,
  toDayEntryInputs,
  toValidateInput,
  type ApprovedRequest,
  type Db,
  type DayEntryRow,
} from "./day-context.service.js";
import type { DayEntryInput } from "../../utils/timesheetRules.js";

export interface TypeInfo {
  id: string;
  code: string | null;
  name: string;
  category: TimeEntryCategory;
  blockType: BlockType | null;
  active: boolean;
}

/** Fila que el usuario propone en un guardado. */
export interface ProposedRow {
  /** Id de un registro PENDING existente; sin id se crea uno nuevo. */
  id?: string;
  typeId: string;
  hours: number;
  startedAt?: Date | null;
  endedAt?: Date | null;
  description?: string | null;
  /** `undefined` = no tocar. */
  note?: string | null;
  /** `undefined` = no tocar. */
  activityId?: string | null;
  source?: TimeEntrySource;
}

export interface SaveDayError {
  status: 400 | 409;
  code: string;
  message: string;
  /** Índice de la fila en el payload; `null` si el error es del día. */
  index: number | null;
  /** Todos los errores de validación (el primero es el principal). */
  errors: { index: number | null; code: string; message: string }[];
}

export interface AuditEvent {
  entityId: string;
  action: "CREATE" | "UPDATE" | "DELETE";
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

export const ENTRY_WITH_TYPE_INCLUDE = {
  type: { select: { id: true, code: true, name: true, category: true } },
} satisfies Prisma.TimeEntryInclude;

export type EntryWithType = Prisma.TimeEntryGetPayload<{ include: typeof ENTRY_WITH_TYPE_INCLUDE }>;

export type SaveDayResult =
  | {
      ok: true;
      /** Todos los registros del consultor en ese proyecto y día, ya guardados. */
      entries: EntryWithType[];
      /** Por cada fila del payload (por índice), los ids resultantes (2 si se partió por excedente). */
      resultIds: string[][];
      audits: AuditEvent[];
      /** Resumen del día completo (todos los proyectos) tras guardar. */
      summary: DaySummary;
    }
  | { ok: false; error: SaveDayError };

function fail(status: 400 | 409, code: string, message: string, index: number | null): SaveDayResult {
  return { ok: false, error: { status, code, message, index, errors: [{ index, code, message }] } };
}

/** Elige la solicitud aprobada a la que vincular un registro EXTRA según el saldo restante. */
export function pickRequest(
  requests: ApprovedRequest[],
  consumed: Map<string, number>,
  hours: number,
): ApprovedRequest | null {
  if (requests.length === 0) return null;
  const remaining = (r: ApprovedRequest) => r.totalHours - (consumed.get(r.id) ?? 0);
  const fits = requests.find((r) => remaining(r) + HOURS_TOLERANCE >= hours);
  if (fits) return fits;
  return requests.reduce((best, r) => (remaining(r) > remaining(best) ? r : best), requests[0]);
}

const toRecord = (row: unknown) => row as unknown as Record<string, unknown>;

type ExtraSource =
  | { kind: "proposed"; index: number }
  | { kind: "kept"; row: DayEntryRow }
  | { kind: "fixed"; row: DayEntryRow };

/**
 * Guarda el estado de UN proyecto y día de UN consultor.
 *
 * - `deleteMissing: true` (PUT /day): los PENDING del proyecto/día que no vienen en `rows` se borran.
 * - `deleteMissing: false` (POST/PATCH): los demás PENDING se conservan, aunque se reclasifican
 *   si la partición por excedente lo requiere.
 * - `movedIds`: ids de registros que se están trasladando a este proyecto/día desde otro (PATCH).
 *
 * Los registros que no son PENDING nunca se tocan; solo cuentan para el tope y el saldo.
 */
export async function saveDayGroup(
  tx: Db,
  params: {
    consultantId: string;
    projectId: string;
    workDate: Date;
    isAbsenceProject: boolean;
    rows: ProposedRow[];
    deleteMissing: boolean;
    types: Map<string, TypeInfo>;
    movedIds?: string[];
  },
): Promise<SaveDayResult> {
  const { consultantId, projectId, workDate, isAbsenceProject, rows, deleteMissing, types } = params;
  const moved = new Set(params.movedIds ?? []);
  await lockDay(tx, consultantId, workDate);
  const ctx = await loadDayContext(tx, consultantId, workDate);

  const groupPending = ctx.entries.filter((e) => e.projectId === projectId && e.status === "PENDING");
  const groupPendingById = new Map(groupPending.map((e) => [e.id, e]));

  // 1. Identidad y tipos de cada fila.
  const seenIds = new Set<string>();
  const categories: TimeEntryCategory[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.id) {
      if (seenIds.has(row.id)) return fail(400, "DUPLICATE_ENTRY_ID", "Un registro aparece más de una vez.", i);
      seenIds.add(row.id);
      if (!groupPendingById.has(row.id) && !moved.has(row.id)) {
        const other = ctx.entries.find((e) => e.id === row.id);
        if (other) {
          return fail(409, "ENTRY_NOT_PENDING", "Solo se pueden editar los registros que siguen pendientes de aprobación.", i);
        }
        return fail(400, "ENTRY_NOT_IN_DAY", "El registro indicado no pertenece a este consultor, proyecto y día.", i);
      }
    }
    const type = types.get(row.typeId);
    if (!type) return fail(400, "TYPE_NOT_FOUND", "El tipo de hora indicado no existe.", i);
    const previousTypeId = row.id ? groupPendingById.get(row.id)?.typeId : undefined;
    if (!type.active && previousTypeId !== type.id) {
      return fail(400, "TYPE_INACTIVE", `El tipo de hora "${type.name}" está desactivado.`, i);
    }
    categories.push(type.category);
  }

  // 2. Estado final propuesto del día completo (todos los proyectos).
  const proposed: DayEntryInput[] = rows.map((row, i) => ({
    id: row.id,
    projectId,
    category: categories[i],
    hours: roundHours(row.hours),
    status: "PENDING",
    startedAt: row.startedAt ?? null,
    endedAt: row.endedAt ?? null,
    isExcess: false,
    isAbsenceProject,
    editable: true,
  }));
  const kept = deleteMissing ? [] : groupPending.filter((e) => !seenIds.has(e.id));
  const others = ctx.entries.filter(
    (e) => !(e.projectId === projectId && e.status === "PENDING") && !moved.has(e.id),
  );

  const validationErrors = validateDay(
    toValidateInput(ctx, [...proposed, ...toDayEntryInputs(kept), ...toDayEntryInputs(others)]),
  );
  if (validationErrors.length > 0) {
    const errors = validationErrors.map((e) => ({
      index: e.index !== null && e.index < rows.length ? e.index : null,
      code: e.code as string,
      message: e.message,
    }));
    return { ok: false, error: { status: 400, ...errors[0], errors } };
  }

  // 3. Partición por excedente de los EXTRA de este proyecto.
  type Decision = { hours: number; startedAt: Date | null; endedAt: Date | null; isExcess: boolean; requestId: string | null };
  const decisionsByProposed = new Map<number, Decision[]>();
  const decisionsByKept = new Map<string, Decision>();
  const keptSecondParts: (Decision & { keptId: string })[] = [];

  const extraSources: ExtraSource[] = [];
  const extraInputs: ExtraRowInput[] = [];
  rows.forEach((row, i) => {
    if (categories[i] !== "EXTRA") return;
    extraSources.push({ kind: "proposed", index: i });
    extraInputs.push({
      id: row.id,
      hours: roundHours(row.hours),
      startedAt: row.startedAt ?? null,
      endedAt: row.endedAt ?? null,
      status: "PENDING",
      isExcess: false,
    });
  });
  for (const e of kept.filter((k) => k.category === "EXTRA")) {
    extraSources.push({ kind: "kept", row: e });
    extraInputs.push({ id: e.id, hours: e.hours, startedAt: e.startedAt, endedAt: e.endedAt, status: "PENDING", isExcess: e.isExcess });
  }
  const fixedExtra = others.filter((e) => e.projectId === projectId && e.category === "EXTRA");
  for (const e of fixedExtra) {
    extraSources.push({ kind: "fixed", row: e });
    extraInputs.push({ id: e.id, hours: e.hours, startedAt: e.startedAt, endedAt: e.endedAt, status: e.status, isExcess: e.isExcess });
  }

  if (extraInputs.length > 0) {
    const requests = ctx.approvedRequests.filter((r) => r.projectId === projectId);
    const consumed = new Map<string, number>();
    for (const e of fixedExtra) {
      if (!e.isExcess && e.status !== "REJECTED" && e.extraHourEntryId) {
        consumed.set(e.extraHourEntryId, (consumed.get(e.extraHourEntryId) ?? 0) + e.hours);
      }
    }
    const split = splitExcess(extraInputs, ctx.approvedExtraBalance[projectId] ?? 0);
    for (const part of split.rows) {
      if (part.fixed) continue;
      const source = extraSources[part.sourceIndex];
      let requestId: string | null = null;
      if (part.isExcess) {
        requestId = requests[0]?.id ?? null;
      } else {
        const chosen = pickRequest(requests, consumed, part.hours);
        requestId = chosen?.id ?? null;
        if (chosen) consumed.set(chosen.id, (consumed.get(chosen.id) ?? 0) + part.hours);
      }
      const decision: Decision = {
        hours: part.hours,
        startedAt: part.startedAt,
        endedAt: part.endedAt,
        isExcess: part.isExcess,
        requestId,
      };
      if (source.kind === "proposed") {
        const list = decisionsByProposed.get(source.index) ?? [];
        list.push(decision);
        decisionsByProposed.set(source.index, list);
      } else if (source.kind === "kept") {
        // Si un registro conservado cruza el límite, el primer tramo conserva el id y el resto es nuevo.
        if (part.part === "second") keptSecondParts.push({ ...decision, keptId: source.row.id });
        else decisionsByKept.set(source.row.id, decision);
      }
    }
  }

  // 4. Escritura. Todo lo anterior solo leyó: un error de validación no dejó nada a medias.
  const audits: AuditEvent[] = [];
  const resultIds: string[][] = rows.map(() => []);

  const idsToLoad = [
    ...rows.map((r) => r.id).filter((x): x is string => !!x),
    ...(deleteMissing ? groupPending.filter((e) => !seenIds.has(e.id)).map((e) => e.id) : []),
    ...kept.map((e) => e.id),
  ];
  const before = new Map(
    (await tx.timeEntry.findMany({ where: { id: { in: idsToLoad } } })).map((r) => [r.id, r]),
  );

  if (deleteMissing) {
    for (const e of groupPending) {
      if (seenIds.has(e.id)) continue;
      await tx.timeEntry.delete({ where: { id: e.id } });
      audits.push({ entityId: e.id, action: "DELETE", before: toRecord(before.get(e.id)) });
    }
  }

  const baseCreate = (row: ProposedRow, typeId: string) => ({
    projectId,
    consultantId,
    workDate,
    description: row.description || null,
    note: row.note || null,
    activityId: row.activityId ?? null,
    source: row.source ?? TimeEntrySource.TIMESHEET,
    status: TimeEntryStatus.PENDING,
    typeId,
  });

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const isExtra = categories[i] === "EXTRA";
    const decisions: Decision[] = isExtra
      ? decisionsByProposed.get(i) ?? []
      : [
          {
            hours: roundHours(row.hours),
            startedAt: row.startedAt ?? null,
            endedAt: row.endedAt ?? null,
            isExcess: false,
            requestId: null,
          },
        ];

    for (let k = 0; k < decisions.length; k++) {
      const d = decisions[k];
      const common = {
        hours: d.hours,
        startedAt: d.startedAt,
        endedAt: d.endedAt,
        isExcess: d.isExcess,
        extraHourEntryId: d.requestId,
        typeId: row.typeId,
      };
      if (k === 0 && row.id) {
        const updated = await tx.timeEntry.update({
          where: { id: row.id },
          data: {
            ...common,
            projectId,
            workDate,
            description: row.description === undefined ? undefined : row.description || null,
            note: row.note === undefined ? undefined : row.note || null,
            activityId: row.activityId,
          },
        });
        resultIds[i].push(updated.id);
        audits.push({ entityId: updated.id, action: "UPDATE", before: toRecord(before.get(row.id)), after: toRecord(updated) });
      } else {
        const created = await tx.timeEntry.create({ data: { ...baseCreate(row, row.typeId), ...common } });
        resultIds[i].push(created.id);
        audits.push({ entityId: created.id, action: "CREATE", after: toRecord(created) });
      }
    }
  }

  // Registros conservados cuyo estado de excedente cambió (p. ej. una nueva aprobación subió el saldo).
  for (const [id, d] of decisionsByKept) {
    const previous = before.get(id)!;
    const changed =
      previous.isExcess !== d.isExcess ||
      previous.extraHourEntryId !== d.requestId ||
      roundHours(Number(previous.hours)) !== d.hours;
    if (!changed) continue;
    const updated = await tx.timeEntry.update({
      where: { id },
      data: { hours: d.hours, startedAt: d.startedAt, endedAt: d.endedAt, isExcess: d.isExcess, extraHourEntryId: d.requestId },
    });
    audits.push({ entityId: id, action: "UPDATE", before: toRecord(previous), after: toRecord(updated) });
  }
  // Partes "second" de registros conservados (caso raro: el saldo bajó por debajo de lo ya registrado).
  for (const d of keptSecondParts) {
    const previous = before.get(d.keptId)!;
    const created = await tx.timeEntry.create({
      data: {
        projectId,
        consultantId,
        workDate,
        description: previous.description,
        note: previous.note,
        activityId: previous.activityId,
        source: previous.source,
        status: TimeEntryStatus.PENDING,
        typeId: previous.typeId,
        hours: d.hours,
        startedAt: d.startedAt,
        endedAt: d.endedAt,
        isExcess: d.isExcess,
        extraHourEntryId: d.requestId,
      },
    });
    audits.push({ entityId: created.id, action: "CREATE", after: toRecord(created) });
  }

  // 5. Resultado: registros del grupo y resumen del día completo.
  const after = await loadDayContext(tx, consultantId, workDate);
  const entries = await tx.timeEntry.findMany({
    where: { consultantId, projectId, workDate },
    include: ENTRY_WITH_TYPE_INCLUDE,
    orderBy: [{ startedAt: "asc" }, { createdAt: "asc" }],
  });

  return { ok: true, entries, resultIds, audits, summary: summaryOfContext(after) };
}

/**
 * Mantiene el `ConsultantBlock` de las ausencias aprobadas de un día (R14 §2.4): si las ausencias
 * APROBADAS cubren la jornada completa existe un bloque vinculado a una de ellas; si no, no.
 * Idempotente: se llama tras aprobar, rechazar o borrar una ausencia.
 */
export async function syncAbsenceBlock(
  db: Db,
  consultantId: string,
  workDate: Date,
  preferEntryId?: string,
): Promise<AuditEvent[]> {
  const ctx = await loadDayContext(db, consultantId, workDate);
  const absences = ctx.entries.filter((e) => e.category === "ABSENCE");
  const approved = absences.filter((e) => e.status === "APPROVED");
  const approvedHours = roundHours(approved.reduce((acc, e) => acc + e.hours, 0));
  const covered = ctx.hoursPerDay > 0 && roundHours(approvedHours - ctx.hoursPerDay) >= -HOURS_TOLERANCE;

  const linked = absences.length
    ? await db.consultantBlock.findMany({ where: { timeEntryId: { in: absences.map((e) => e.id) } } })
    : [];
  const approvedIds = new Set(approved.map((e) => e.id));
  const events: AuditEvent[] = [];

  for (const block of linked) {
    if (covered && block.timeEntryId && approvedIds.has(block.timeEntryId)) continue;
    await db.consultantBlock.delete({ where: { id: block.id } });
    events.push({ entityId: block.id, action: "DELETE", before: toRecord(block) });
  }

  const stillLinked = linked.some((b) => covered && b.timeEntryId && approvedIds.has(b.timeEntryId));
  if (covered && !stillLinked) {
    const owner =
      approved.find((e) => e.id === preferEntryId) ?? approved[approved.length - 1];
    const type = await db.timeEntryType.findUnique({ where: { id: owner.typeId }, select: { name: true, blockType: true } });
    const created = await db.consultantBlock.create({
      data: {
        consultantId,
        startDate: workDate,
        endDate: workDate,
        blockType: type?.blockType ?? BlockType.OTHER,
        note: `Ausencia aprobada: ${type?.name ?? "Ausencia"}`,
        timeEntryId: owner.id,
      },
    });
    events.push({ entityId: created.id, action: "CREATE", after: toRecord(created) });
  }
  return events;
}
