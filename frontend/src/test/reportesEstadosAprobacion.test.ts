import { describe, it, expect } from 'vitest';
import { filterByScope, hoursByStatus } from '../features/reports/reportUtils';
import { isWeekLockedError } from '../features/tracker/trackerAvisos';
import { ApiError, type TimeEntry } from '../services/api';

function registro(status: TimeEntry['status'], hours: string): TimeEntry {
  return { id: `${status}-${hours}`, status, hours, workDate: '2026-11-03' } as unknown as TimeEntry;
}

describe('informes: horas por estado de aprobación (R15)', () => {
  const lista = [
    registro('APPROVED', '8'),
    registro('APPROVED', '2.5'),
    registro('SUBMITTED', '4'),
    registro('PENDING', '1.5'),
    registro('REJECTED', '3'),
  ];

  it('separa aprobadas, enviadas y pendientes; el histórico rechazado no cuenta', () => {
    expect(hoursByStatus(lista)).toEqual({ approved: 10.5, submitted: 4, pending: 1.5 });
  });

  it('la gráfica usa solo lo aprobado por defecto, o todo lo vigente', () => {
    expect(filterByScope(lista, 'approved')).toHaveLength(2);
    expect(filterByScope(lista, 'all')).toHaveLength(4);
  });
});

describe('cronómetro con la semana enviada', () => {
  it('reconoce el error WEEK_LOCKED', () => {
    expect(isWeekLockedError(new ApiError('Semana enviada', 409, 'WEEK_LOCKED'))).toBe(true);
    expect(isWeekLockedError(new ApiError('Otro', 409, 'MONTH_CLOSED'))).toBe(false);
    expect(isWeekLockedError(new Error('x'))).toBe(false);
  });
});
