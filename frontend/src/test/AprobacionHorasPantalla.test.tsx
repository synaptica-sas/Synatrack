import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { TimesheetReviewsTab } from '../features/timesheetReviews/TimesheetReviewsTab';
import { ApiError, type WeekReviewRow } from '../services/api';

/**
 * Pantalla "Aprobación de horas" (R15): filas por consultor x proyecto x semana,
 * novedades con texto (nunca solo color), selección múltiple, aprobar todo o
 * nada y devolver con nota obligatoria.
 */

vi.mock('../services/api', async () => {
  const actual = await vi.importActual<typeof import('../services/api')>('../services/api');
  return {
    ...actual,
    listTimesheetReviews: vi.fn(),
    approveTimesheetReviews: vi.fn(),
    returnTimesheetReview: vi.fn(),
  };
});

const api = await import('../services/api');

function dias(horas: number[], flags: Record<number, WeekReviewRow['flags']> = {}): WeekReviewRow['days'] {
  return horas.map((h, i) => ({
    date: `2026-11-0${2 + i}`,
    hours: h,
    flags: flags[i] ?? [],
    consultantTotal: h,
    jornada: 8,
  }));
}

function fila(parcial: Partial<WeekReviewRow> = {}): WeekReviewRow {
  return {
    consultantId: 'c1',
    consultantName: 'Ana Pérez',
    projectId: 'p1',
    projectName: 'Proyecto Uno',
    weekStart: '2026-11-02',
    days: dias([8, 8, 8, 8, 8, 0, 0]),
    total: 40,
    status: 'SUBMITTED',
    flags: [],
    canReview: true,
    review: { id: 'r1', status: 'SUBMITTED', hours: 40, submittedAt: null, submittedBy: null, reviewedAt: null, reviewedBy: null, note: null },
    entries: [
      {
        id: 'e1',
        workDate: '2026-11-02T00:00:00.000Z',
        hours: '8',
        status: 'SUBMITTED',
        isExcess: false,
        startedAt: null,
        endedAt: null,
        description: 'Reunión con el cliente',
        rejectionNote: null,
        type: { id: 't1', code: 'REGULAR', name: 'Horas Regulares', category: 'REGULAR' },
      },
    ],
    ...parcial,
  };
}

const luis = fila({
  consultantId: 'c2',
  consultantName: 'Luis Gómez',
  days: dias([8, 8, 10, 8, 8, 4, 0], { 2: ['EXTRA', 'OVER_JORNADA'], 5: ['NON_WORKING_DAY'] }),
  total: 46,
  flags: ['EXTRA', 'NON_WORKING_DAY', 'OVER_JORNADA'],
});

const ajena = fila({ consultantId: 'c3', consultantName: 'Marta Ruiz', projectId: 'p9', projectName: 'Proyecto Ajeno', canReview: false });

function pintar() {
  const onChanged = vi.fn();
  const onNotice = vi.fn();
  render(<TimesheetReviewsTab onChanged={onChanged} onNotice={onNotice} />);
  return { onChanged, onNotice };
}

describe('Aprobación de horas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listTimesheetReviews).mockResolvedValue({ rows: [fila(), luis, ajena], total: 3, truncated: false });
    vi.mocked(api.approveTimesheetReviews).mockResolvedValue(undefined);
    vi.mocked(api.returnTimesheetReview).mockResolvedValue(undefined);
  });

  it('pide por defecto las semanas enviadas y pinta una fila por consultor y proyecto', async () => {
    pintar();
    expect(await screen.findByLabelText('Seleccionar Ana Pérez, Proyecto Uno')).toBeTruthy();
    expect(screen.getByLabelText('Seleccionar Luis Gómez, Proyecto Uno')).toBeTruthy();
    expect(vi.mocked(api.listTimesheetReviews)).toHaveBeenCalledWith({ status: 'SUBMITTED' });
    expect(screen.getAllByText('Enviada').length).toBeGreaterThan(0);
  });

  it('las novedades llevan texto accesible, no solo color', async () => {
    pintar();
    await screen.findByLabelText('Seleccionar Luis Gómez, Proyecto Uno');
    // El miércoles de Luis: horas extra y supera la jornada (10:00 de 8:00).
    const celda = screen.getByLabelText(/2026-11-04: 10:00 h · Horas extra · Supera jornada: 10:00 de 8:00/);
    expect(celda.getAttribute('title')).toContain('Supera jornada');
    // Resumen de novedades de la fila.
    expect(screen.getAllByText(/Fin de semana\/festivo/).length).toBeGreaterThan(0);
  });

  it('aprobar seleccionadas solo envía las filas que el usuario puede revisar', async () => {
    const { onChanged } = pintar();
    await screen.findByLabelText('Seleccionar Ana Pérez, Proyecto Uno');

    // La fila ajena no se puede marcar.
    const ajenaBox = screen.getByLabelText('Seleccionar Marta Ruiz, Proyecto Ajeno') as HTMLInputElement;
    expect(ajenaBox.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText('Seleccionar Ana Pérez, Proyecto Uno'));
    fireEvent.click(screen.getByLabelText('Seleccionar Luis Gómez, Proyecto Uno'));
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar seleccionadas (2)' }));

    await waitFor(() =>
      expect(api.approveTimesheetReviews).toHaveBeenCalledWith([
        { consultantId: 'c1', projectId: 'p1', weekStart: '2026-11-02' },
        { consultantId: 'c2', projectId: 'p1', weekStart: '2026-11-02' },
      ]),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('si devolver falla, el diálogo sigue abierto con la nota, muestra el error y recarga', async () => {
    vi.mocked(api.returnTimesheetReview).mockRejectedValue(
      new ApiError('Esa semana no está pendiente de revisión', 409, 'REVIEW_NOT_SUBMITTED'),
    );
    const { onChanged } = pintar();
    await screen.findByLabelText('Seleccionar Ana Pérez, Proyecto Uno');
    const filaAna = screen.getByLabelText('Seleccionar Ana Pérez, Proyecto Uno').closest('tr') as HTMLElement;
    fireEvent.click(within(filaAna).getByRole('button', { name: 'Devolver' }));
    const modal = document.querySelector('.modal-card') as HTMLElement;
    const area = within(modal).getByLabelText(/Motivo de la devolución/) as HTMLTextAreaElement;
    expect(area.maxLength).toBe(1000);
    fireEvent.change(area, { target: { value: 'Falta detalle' } });
    expect(within(modal).getByText('13 / 1000')).toBeTruthy();
    fireEvent.click(within(modal).getByRole('button', { name: 'Devolver' }));

    expect(await within(modal).findByText('Esa semana no está pendiente de revisión')).toBeTruthy();
    expect(document.querySelector('.modal-card')).toBeTruthy();
    expect((within(modal).getByLabelText(/Motivo de la devolución/) as HTMLTextAreaElement).value).toBe('Falta detalle');
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(vi.mocked(api.listTimesheetReviews).mock.calls.length).toBeGreaterThan(1);
  });

  it('si aprobar falla, recarga la lista y el contador además de mostrar el error', async () => {
    vi.mocked(api.approveTimesheetReviews).mockRejectedValue(
      new ApiError('Ya fue aprobada', 409, 'REVIEW_NOT_SUBMITTED'),
    );
    const { onChanged } = pintar();
    await screen.findByLabelText('Seleccionar Ana Pérez, Proyecto Uno');
    const filaAna = screen.getByLabelText('Seleccionar Ana Pérez, Proyecto Uno').closest('tr') as HTMLElement;
    fireEvent.click(within(filaAna).getByRole('button', { name: 'Aprobar' }));
    expect(await screen.findByText('Ya fue aprobada')).toBeTruthy();
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(vi.mocked(api.listTimesheetReviews).mock.calls.length).toBeGreaterThan(1);
  });

  it('si el servidor rechaza un ítem, muestra la fila culpable', async () => {
    vi.mocked(api.approveTimesheetReviews).mockRejectedValue(
      new ApiError('El mes está cerrado', 400, 'MONTH_CLOSED', [], { item: { index: 0 } }),
    );
    pintar();
    await screen.findByLabelText('Seleccionar Ana Pérez, Proyecto Uno');
    fireEvent.click(screen.getByLabelText('Seleccionar Ana Pérez, Proyecto Uno'));
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar seleccionadas (1)' }));

    const alerta = await screen.findByText(/Ana Pérez · Proyecto Uno · semana del 2026-11-02: El mes está cerrado/);
    expect(alerta).toBeTruthy();
  });

  it('una jornada nula (sin horario) se muestra como "Sin jornada"', async () => {
    const sinJornada = fila({
      days: dias([10, 0, 0, 0, 0, 0, 0], { 0: ['OVER_JORNADA'] }).map((d) => ({ ...d, jornada: null })),
    });
    vi.mocked(api.listTimesheetReviews).mockResolvedValue({ rows: [sinJornada], total: 1, truncated: false });
    pintar();
    expect(await screen.findByLabelText(/Supera jornada: 10:00 de Sin jornada/)).toBeTruthy();
  });

  it('devolver exige una nota de al menos 3 caracteres', async () => {
    const { onChanged } = pintar();
    await screen.findByLabelText('Seleccionar Ana Pérez, Proyecto Uno');

    const filaAna = screen.getByLabelText('Seleccionar Ana Pérez, Proyecto Uno').closest('tr') as HTMLElement;
    fireEvent.click(within(filaAna).getByRole('button', { name: 'Devolver' }));

    await screen.findByLabelText(/Motivo de la devolución/);
    const modal = document.querySelector('.modal-card') as HTMLElement;
    const botonDialogo = within(modal).getByRole('button', { name: 'Devolver' }) as HTMLButtonElement;
    expect(botonDialogo.disabled).toBe(true);

    fireEvent.change(within(modal).getByLabelText(/Motivo de la devolución/), { target: { value: 'ab' } });
    expect(botonDialogo.disabled).toBe(true);
    fireEvent.change(within(modal).getByLabelText(/Motivo de la devolución/), { target: { value: 'Falta el detalle del martes' } });
    expect(botonDialogo.disabled).toBe(false);

    fireEvent.click(botonDialogo);
    await waitFor(() =>
      expect(api.returnTimesheetReview).toHaveBeenCalledWith({
        consultantId: 'c1',
        projectId: 'p1',
        weekStart: '2026-11-02',
        note: 'Falta el detalle del martes',
      }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('expande los registros de una fila', async () => {
    pintar();
    await screen.findByLabelText('Seleccionar Ana Pérez, Proyecto Uno');
    fireEvent.click(screen.getByLabelText('Ver registros de Ana Pérez en Proyecto Uno'));
    expect(await screen.findByText('Reunión con el cliente')).toBeTruthy();
  });

  it('estado vacío', async () => {
    vi.mocked(api.listTimesheetReviews).mockResolvedValue({ rows: [], total: 0, truncated: false });
    pintar();
    expect(await screen.findByText('No hay semanas por revisar')).toBeTruthy();
  });

  it('estado de error con reintento', async () => {
    vi.mocked(api.listTimesheetReviews).mockRejectedValueOnce(new Error('Falló el servidor'));
    pintar();
    expect(await screen.findByText('Falló el servidor')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByLabelText('Seleccionar Ana Pérez, Proyecto Uno')).toBeTruthy();
  });
});
