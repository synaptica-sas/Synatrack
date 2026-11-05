import { describe, it, expect } from 'vitest';
import {
  FLAG_LABELS,
  approveErrorMessage,
  dayCellTitle,
  formatHm,
  isSelectable,
  rowKey,
  sortFlags,
  toItems,
} from '../features/timesheetReviews/reviewUtils';
import { ApiError, type WeekReviewRow } from '../services/api';

function fila(parcial: Partial<WeekReviewRow> = {}): WeekReviewRow {
  return {
    consultantId: 'c1',
    consultantName: 'Ana Pérez',
    projectId: 'p1',
    projectName: 'Proyecto Uno',
    weekStart: '2026-11-02',
    days: [],
    total: 8,
    status: 'SUBMITTED',
    flags: [],
    canReview: true,
    review: { id: 'r1', status: 'SUBMITTED', hours: 8, submittedAt: null, submittedBy: null, reviewedAt: null, reviewedBy: null, note: null },
    entries: [],
    ...parcial,
  };
}

describe('novedades de la revisión semanal', () => {
  it('etiquetas en español de cada novedad', () => {
    expect(FLAG_LABELS.EXTRA).toBe('Horas extra');
    expect(FLAG_LABELS.EXCESS).toBe('Excedente');
    expect(FLAG_LABELS.ABSENCE).toBe('Ausencia');
    expect(FLAG_LABELS.NON_WORKING_DAY).toBe('Fin de semana/festivo');
    expect(FLAG_LABELS.OVER_JORNADA).toBe('Supera jornada');
  });

  it('ordena las novedades de forma estable', () => {
    expect(sortFlags(['OVER_JORNADA', 'EXTRA', 'ABSENCE'])).toEqual(['EXTRA', 'ABSENCE', 'OVER_JORNADA']);
  });

  it('formatea horas como H:MM', () => {
    expect(formatHm(8.5)).toBe('8:30');
    expect(formatHm(0)).toBe('');
    expect(formatHm(0.25)).toBe('0:15');
  });

  it('el title de una celda que supera la jornada trae total vs jornada', () => {
    const t = dayCellTitle({ date: '2026-11-03', hours: 3, flags: ['OVER_JORNADA', 'EXTRA'], consultantTotal: 10, jornada: 8 });
    expect(t).toContain('Horas extra');
    expect(t).toContain('Supera jornada: 10:00 de 8:00');
  });
});

describe('selección y errores', () => {
  it('solo se seleccionan filas enviadas con canReview', () => {
    expect(isSelectable(fila())).toBe(true);
    expect(isSelectable(fila({ canReview: false }))).toBe(false);
    expect(isSelectable(fila({ status: 'APPROVED' }))).toBe(false);
  });

  it('toItems ignora lo no revisable aunque esté marcado', () => {
    const a = fila();
    const b = fila({ projectId: 'p2', canReview: false });
    const items = toItems([a, b], new Set([rowKey(a), rowKey(b)]));
    expect(items).toEqual([{ consultantId: 'c1', projectId: 'p1', weekStart: '2026-11-02' }]);
  });

  it('el error por ítem nombra consultor, proyecto y semana', () => {
    const a = fila();
    const items = toItems([a], new Set([rowKey(a)]));
    const err = new ApiError('El mes está cerrado', 400, 'MONTH_CLOSED', [], { item: { index: 0 } });
    expect(approveErrorMessage(err, items, [a])).toBe('Ana Pérez · Proyecto Uno · semana del 2026-11-02: El mes está cerrado');
  });

  it('sin ítem culpable, devuelve el mensaje tal cual', () => {
    const err = new ApiError('Sin permiso', 403, 'NOT_REVIEWER');
    expect(approveErrorMessage(err, [], [])).toBe('Sin permiso');
  });
});
