import { describe, it, expect } from 'vitest';
import {
  deriveWeekState,
  formatMissingDay,
  isProjectEditable,
  returnedMessage,
  returnedReviews,
  submitErrorMessages,
  summarizeSubmission,
} from '../features/timesheet/weekStatus';
import { REVIEW_QUEUE_PERMISSION, visibleGroupsFor } from '../config/sidebar';
import type { TimesheetWeekStatus, WeekProjectReview } from '../services/api';

function revision(projectId: string, status: WeekProjectReview['status'], extra: Partial<WeekProjectReview> = {}): WeekProjectReview {
  return {
    projectId,
    projectName: `Proyecto ${projectId}`,
    status,
    note: null,
    hours: 8,
    submittedAt: null,
    submittedBy: null,
    reviewedAt: null,
    reviewedBy: null,
    reviewedByName: null,
    ...extra,
  };
}

function estado(sobre: Partial<TimesheetWeekStatus['submission']> = {}, resto: Partial<TimesheetWeekStatus> = {}): TimesheetWeekStatus {
  return {
    consultantId: 'c1',
    weekStart: '2026-11-02',
    today: '2026-11-05',
    locked: false,
    editableProjectIds: [],
    reviews: [],
    submission: {
      ok: false,
      errors: [],
      projectsToSubmit: ['p1'],
      returnedWithoutEntries: [],
      days: [],
      ...sobre,
    },
    ...resto,
  };
}

describe('estado derivado de la semana', () => {
  it('sin revisiones está Pendiente', () => {
    expect(deriveWeekState([])).toBe('PENDING');
    expect(deriveWeekState(undefined)).toBe('PENDING');
  });

  it('sin revisiones, deriva de los registros (semanas anteriores a R15)', () => {
    expect(deriveWeekState([], [{ status: 'APPROVED' }, { status: 'APPROVED' }])).toBe('APPROVED');
    expect(deriveWeekState([], [{ status: 'SUBMITTED' }])).toBe('SUBMITTED');
    expect(deriveWeekState([], [{ status: 'APPROVED' }, { status: 'PENDING' }])).toBe('PENDING');
    expect(deriveWeekState([], [{ status: 'PENDING' }])).toBe('PENDING');
    expect(deriveWeekState([], [])).toBe('EMPTY');
  });

  it('con revisiones, los registros no alteran el estado', () => {
    expect(deriveWeekState([revision('a', 'SUBMITTED')], [{ status: 'APPROVED' }])).toBe('SUBMITTED');
  });

  it('todo enviado = Enviada; todo aprobado = Aprobada', () => {
    expect(deriveWeekState([revision('a', 'SUBMITTED'), revision('b', 'SUBMITTED')])).toBe('SUBMITTED');
    expect(deriveWeekState([revision('a', 'APPROVED'), revision('b', 'APPROVED')])).toBe('APPROVED');
  });

  it('mezcla de aprobado y enviado = Parcialmente aprobada', () => {
    expect(deriveWeekState([revision('a', 'APPROVED'), revision('b', 'SUBMITTED')])).toBe('PARTIAL');
  });

  it('un proyecto devuelto manda sobre el resto', () => {
    expect(deriveWeekState([revision('a', 'APPROVED'), revision('b', 'RETURNED')])).toBe('RETURNED');
  });
});

describe('editabilidad por proyecto', () => {
  it('semana sin bloquear: todo editable', () => {
    expect(isProjectEditable({ locked: false, editableProjectIds: [] }, 'p1')).toBe(true);
  });

  it('semana bloqueada: solo los proyectos devueltos', () => {
    const s = { locked: true, editableProjectIds: ['p2'] };
    expect(isProjectEditable(s, 'p1')).toBe(false);
    expect(isProjectEditable(s, 'p2')).toBe(true);
  });

  it('sin estado cargado no se bloquea en el cliente (autoriza el backend)', () => {
    expect(isProjectEditable(null, 'p1')).toBe(true);
  });
});

describe('aviso de devolución', () => {
  it('nombra al revisor, el proyecto y la nota', () => {
    const r = revision('p1', 'RETURNED', { reviewedByName: 'Laura Gómez', note: 'Falta detallar el martes' });
    expect(returnedMessage(r)).toBe('El PM Laura Gómez devolvió Proyecto p1: «Falta detallar el martes»');
  });

  it('solo lista los devueltos', () => {
    const lista = [revision('a', 'APPROVED'), revision('b', 'RETURNED')];
    expect(returnedReviews(lista).map((r) => r.projectId)).toEqual(['b']);
  });
});

describe('resumen del envío', () => {
  it('habilitado cuando submission.ok', () => {
    const r = summarizeSubmission(estado({ ok: true }));
    expect(r.canSubmit).toBe(true);
    expect(r.missingDays).toEqual([]);
  });

  it('lista los días laborables incompletos con cuánto falta', () => {
    const r = summarizeSubmission(
      estado({
        days: [
          { date: '2026-11-02', isWorkday: true, required: 8, covered: 8, missing: 0, complete: true },
          { date: '2026-11-03', isWorkday: true, required: 8, covered: 5.5, missing: 2.5, complete: false },
          { date: '2026-11-07', isWorkday: false, required: 0, covered: 0, missing: 0, complete: true },
        ],
      }),
    );
    expect(r.canSubmit).toBe(false);
    expect(r.missingDays).toHaveLength(1);
    expect(formatMissingDay(r.missingDays[0])).toBe('Mar 03: faltan 02:30:00');
    expect(r.inProgress).toBe(false);
  });

  it('semana en curso cuando faltan días futuros', () => {
    const r = summarizeSubmission(
      estado({
        days: [{ date: '2026-11-06', isWorkday: true, required: 8, covered: 0, missing: 8, complete: false }],
      }),
    );
    expect(r.inProgress).toBe(true);
    expect(r.missingDays[0].future).toBe(true);
  });

  it('sin estado no se puede enviar', () => {
    expect(summarizeSubmission(null).canSubmit).toBe(false);
  });

  it('extrae los mensajes del error de envío', () => {
    expect(submitErrorMessages({ errors: [{ message: 'Falta el martes' }, { code: 'x' }] })).toEqual(['Falta el martes']);
    expect(submitErrorMessages({})).toEqual([]);
  });
});

describe('menú: Aprobación de horas', () => {
  const ids = (perms: string[]) => visibleGroupsFor(perms).flatMap((g) => g.tabs.map((t) => t.id));

  it('aparece solo con el permiso sintético de la cola, no con time:review', () => {
    expect(ids(['time:read', 'time:review'])).not.toContain('timesheetReviews');
    expect(ids(['time:read', REVIEW_QUEUE_PERMISSION])).toContain('timesheetReviews');
  });
});
