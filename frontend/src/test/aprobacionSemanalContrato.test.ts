import { describe, it, expect, vi, afterEach } from "vitest";
import type { ApiError as ApiErrorT, TimesheetWeekStatus, WeekReviewRow } from "../services/api";

/**
 * Contrato cliente <-> backend de R15 (aprobación semanal), con los cuerpos de
 * error TAL COMO los arma el backend (`timesheet-reviews.routes.ts`,
 * `timesheet-weeks.routes.ts`). Pasan por el `request()` real (fetch simulado),
 * no por un `ApiError` construido a mano: así se comprueba que `details.item`,
 * `errors`, `days` y los campos del cierre llegan hasta las utilidades que los
 * pintan.
 */

function respuesta(status: number, body: unknown) {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

const ITEMS = [
  { consultantId: "c1", projectId: "p1", weekStart: "2026-11-02" },
  { consultantId: "c2", projectId: "p2", weekStart: "2026-11-02" },
];

const ROWS = [
  { consultantId: "c1", consultantName: "Ana Pérez", projectId: "p1", projectName: "Proyecto Uno", weekStart: "2026-11-02" },
  { consultantId: "c2", consultantName: "Luis Gómez", projectId: "p2", projectName: "Proyecto Dos", weekStart: "2026-11-02" },
] as unknown as WeekReviewRow[];

/** Cuerpo de `ItemError` del backend: `{ message, code, item: { index, consultantId, projectId, weekStart } }`. */
function itemError(code: string, message: string, index: number) {
  return { message, code, item: { index, ...ITEMS[index] } };
}

describe("aprobación: errores por ítem con la forma real del backend", () => {
  const casos: [number, string, string][] = [
    [400, "DUPLICATE_ITEM", "Hay ítems repetidos en la solicitud."],
    [400, "MONTH_CLOSED", "No se pueden modificar horas de un mes cerrado para este proyecto (2026-11)."],
    [403, "NOT_REVIEWER", "Solo el PM del proyecto o su delegado vigente pueden revisar estas horas."],
    [404, "REVIEW_NOT_FOUND", "No hay una semana enviada para ese consultor, proyecto y semana."],
    [409, "REVIEW_NOT_SUBMITTED", "Esa semana no está pendiente de revisión (ya fue aprobada o devuelta)."],
  ];

  for (const [status, code, message] of casos) {
    it(`${status} ${code}: nombra la fila culpable (item.index = 1)`, async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(status, itemError(code, message, 1))));
      const { approveTimesheetReviews, ApiError } = await import("../services/api");
      const { approveErrorMessage } = await import("../features/timesheetReviews/reviewUtils");

      const err = await approveTimesheetReviews(ITEMS).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).code).toBe(code);
      expect((err as InstanceType<typeof ApiError>).status).toBe(status);
      expect(approveErrorMessage(err, ITEMS, ROWS)).toBe(`Luis Gómez · Proyecto Dos · semana del 2026-11-02: ${message}`);
    });
  }

  it("item.index = 0 apunta a la primera fila (el índice es el del payload, no el orden interno)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(403, itemError("NOT_REVIEWER", "No", 0))));
    const { approveTimesheetReviews } = await import("../services/api");
    const { approveErrorMessage } = await import("../features/timesheetReviews/reviewUtils");
    const err = await approveTimesheetReviews(ITEMS).catch((e: unknown) => e);
    expect(approveErrorMessage(err, ITEMS, ROWS)).toMatch(/^Ana Pérez · Proyecto Uno/);
  });

  it("validación de Zod (sin item): se muestra el mensaje traducido, sin inventar fila", async () => {
    const cuerpo = { message: "Validation error", issues: [{ path: "note", message: "La nota no puede superar los 1000 caracteres" }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(400, cuerpo)));
    const { returnTimesheetReview } = await import("../services/api");
    const err = await returnTimesheetReview({ ...ITEMS[0], note: "x".repeat(1001) }).catch((e: unknown) => e);
    expect((err as Error).message).toContain('"Nota"');
    expect((err as Error).message).toContain("1000 caracteres");
  });
});

describe("envío de la semana: errores reales de POST /timesheet-weeks/submit", () => {
  it("400 WEEK_NOT_SUBMITTABLE: un mensaje por día incompleto", async () => {
    const cuerpo = {
      message: "El lunes 2 de noviembre de 2026 suma 5:00 de 8:00: faltan 3:00.",
      code: "WEEK_NOT_SUBMITTABLE",
      errors: [
        { code: "INCOMPLETE_DAY", date: "2026-11-02", missingHours: 3, message: "El lunes 2 de noviembre de 2026 suma 5:00 de 8:00: faltan 3:00." },
        { code: "INCOMPLETE_DAY", date: "2026-11-03", missingHours: 8, message: "El martes 3 de noviembre de 2026 suma 0:00 de 8:00: faltan 8:00." },
      ],
      days: [],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(400, cuerpo)));
    const { submitTimesheetWeek } = await import("../services/api");
    const { submitErrorMessages } = await import("../features/timesheet/weekStatus");
    const err = (await submitTimesheetWeek({ weekStart: "2026-11-02" }).catch((e: unknown) => e)) as ApiErrorT;
    expect(err.code).toBe("WEEK_NOT_SUBMITTABLE");
    expect(submitErrorMessages(err.details)).toEqual(cuerpo.errors.map((e) => e.message));
    // Los errores del envío no traen `index`: no se confunden con errores de fila de PUT /day.
    expect(err.errors).toEqual([]);
  });

  it("409 NOTHING_TO_SUBMIT: el mensaje llega", async () => {
    const msg = "No hay nada que enviar en esta semana: todos los proyectos ya están enviados o aprobados, o no hay registros pendientes.";
    const cuerpo = { message: msg, code: "WEEK_NOT_SUBMITTABLE", errors: [{ code: "NOTHING_TO_SUBMIT", message: msg }], days: [] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(409, cuerpo)));
    const { submitTimesheetWeek } = await import("../services/api");
    const { submitErrorMessages } = await import("../features/timesheet/weekStatus");
    const err = (await submitTimesheetWeek({ weekStart: "2026-11-02" }).catch((e: unknown) => e)) as { status: number; details: Record<string, unknown> };
    expect(err.status).toBe(409);
    expect(submitErrorMessages(err.details)).toEqual([msg]);
  });

  it("400 MONTH_CLOSED: sin `errors`; el mensaje (con el proyecto) y los campos viajan en details", async () => {
    const cuerpo = {
      message:
        "No se pueden modificar horas de un mes cerrado para este proyecto (2026-10). Proyecto: Proyecto Uno. Pide a un administrador que lo resuelva antes de enviar.",
      code: "MONTH_CLOSED",
      projectId: "p1",
      projectName: "Proyecto Uno",
      year: 2026,
      month: 10,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(400, cuerpo)));
    const { submitTimesheetWeek } = await import("../services/api");
    const { submitErrorMessages } = await import("../features/timesheet/weekStatus");
    const err = (await submitTimesheetWeek({ weekStart: "2026-10-26" }).catch((e: unknown) => e)) as ApiErrorT;
    expect(err.code).toBe("MONTH_CLOSED");
    expect(err.details).toMatchObject({ projectId: "p1", projectName: "Proyecto Uno", year: 2026, month: 10 });
    // TimesheetTab cae a `err.message` cuando no hay `errors`: debe nombrar el proyecto.
    expect(submitErrorMessages(err.details)).toEqual([]);
    expect(err.message).toContain("Proyecto Uno");
  });
});

describe("vista previa del envío: casos que el backend sí produce", () => {
  it("NO_SCHEDULE (required: null) aparece como mensaje y bloquea el envío", async () => {
    const { summarizeSubmission } = await import("../features/timesheet/weekStatus");
    const status = {
      consultantId: "c1",
      weekStart: "2026-11-02",
      today: "2026-11-10",
      locked: false,
      editableProjectIds: [],
      reviews: [],
      submission: {
        ok: false,
        errors: [{ code: "NO_SCHEDULE", date: "2026-11-02", message: "No hay una jornada válida configurada para el lunes 2 de noviembre de 2026: no se puede validar la semana." }],
        projectsToSubmit: ["p1"],
        returnedWithoutEntries: [],
        // El backend manda `required: null` en un día laborable sin jornada (el tipo del cliente dice `number`).
        days: [{ date: "2026-11-02", isWorkday: true, required: null, covered: 0, missing: 0, complete: false }],
      },
    } as unknown as TimesheetWeekStatus;
    const r = summarizeSubmission(status);
    expect(r.canSubmit).toBe(false);
    expect(r.missingDays).toEqual([]);
    expect(r.otherMessages).toEqual([expect.stringContaining("No hay una jornada válida")]);
  });
});
