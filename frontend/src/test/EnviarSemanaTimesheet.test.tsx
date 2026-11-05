import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TimesheetTab } from '../features/timesheet/TimesheetTab';
import { startOfWeek, todayIso } from '../features/timesheet/timesheetUtils';
import type { Consultant, Project, TimesheetWeekStatus } from '../services/api';

/**
 * Envío de la semana (R15): el botón se habilita solo si el servidor dice que la
 * semana se puede enviar; si no, se explica qué días faltan. Con la semana
 * bloqueada no hay forma de agregar proyectos.
 */

vi.mock('../services/api', async () => {
  const actual = await vi.importActual<typeof import('../services/api')>('../services/api');
  return {
    ...actual,
    getMyConsultant: vi.fn(),
    listTimeEntryTypes: vi.fn(),
    getDaySummary: vi.fn(),
    listAllTimeEntries: vi.fn(),
    getTimesheetWeekStatus: vi.fn(),
    submitTimesheetWeek: vi.fn(),
  };
});

const api = await import('../services/api');

const SEMANA = startOfWeek(todayIso());
const PROYECTO = { id: 'p1', name: 'Proyecto Uno', currency: 'USD' } as unknown as Project;
const YO = { id: 'c1', fullName: 'Ana Pérez', email: 'ana@synaptica.test' } as unknown as Consultant;
const OTRO = { id: 'c2', fullName: 'Luis Gómez', email: 'luis@synaptica.test' } as unknown as Consultant;

function estado(parcial: Partial<TimesheetWeekStatus> = {}, ok = true): TimesheetWeekStatus {
  return {
    consultantId: 'c1',
    weekStart: SEMANA,
    today: todayIso(),
    locked: false,
    editableProjectIds: [],
    reviews: [],
    submission: {
      ok,
      errors: [],
      projectsToSubmit: ['p1'],
      returnedWithoutEntries: [],
      days: ok
        ? []
        : [{ date: SEMANA, isWorkday: true, required: 8, covered: 5.5, missing: 2.5, complete: false }],
    },
    ...parcial,
  };
}

function pintar(props: { isAdmin?: boolean; consultants?: Consultant[] } = {}) {
  return render(
    <TimesheetTab
      projects={[PROYECTO]}
      consultants={props.consultants ?? []}
      canWrite
      isAdmin={props.isAdmin ?? false}
      onReload={async () => {}}
      onError={() => {}}
    />,
  );
}

describe('Enviar semana', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getMyConsultant).mockResolvedValue(YO);
    vi.mocked(api.listTimeEntryTypes).mockResolvedValue([]);
    vi.mocked(api.getDaySummary).mockResolvedValue([]);
    vi.mocked(api.listAllTimeEntries).mockResolvedValue([]);
    vi.mocked(api.submitTimesheetWeek).mockResolvedValue({
      consultantId: 'c1',
      weekStart: SEMANA,
      submittedProjectIds: ['p1'],
      submittedHours: 40,
      closedReturnedProjectIds: [],
      onBehalf: false,
    });
  });

  it('con la jornada completa el botón está habilitado y pide confirmación antes de enviar', async () => {
    vi.mocked(api.getTimesheetWeekStatus).mockResolvedValue(estado());
    pintar();

    const boton = (await screen.findByRole('button', { name: 'Enviar semana' })) as HTMLButtonElement;
    await waitFor(() => expect(boton.disabled).toBe(false));
    expect(screen.getByText('Pendiente')).toBeTruthy();

    fireEvent.click(boton);
    expect(await screen.findByText(/no podrás modificar la semana hasta que un PM la devuelva/)).toBeTruthy();
    expect(api.submitTimesheetWeek).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(api.submitTimesheetWeek).toHaveBeenCalledWith({ weekStart: SEMANA }));
  });

  it('si faltan horas el botón queda deshabilitado y se listan los días que faltan', async () => {
    vi.mocked(api.getTimesheetWeekStatus).mockResolvedValue(estado({}, false));
    pintar();

    const boton = (await screen.findByRole('button', { name: 'Enviar semana' })) as HTMLButtonElement;
    await waitFor(() => expect(screen.getByText(/faltan 02:30:00/)).toBeTruthy());
    expect(boton.disabled).toBe(true);
    expect(screen.getByText(/completa la jornada de estos días/)).toBeTruthy();
  });

  it('con la semana bloqueada no se pueden agregar proyectos y se muestra el estado', async () => {
    vi.mocked(api.getTimesheetWeekStatus).mockResolvedValue(
      estado({
        locked: true,
        reviews: [
          {
            projectId: 'p1',
            projectName: 'Proyecto Uno',
            status: 'SUBMITTED',
            note: null,
            hours: 8,
            submittedAt: null,
            submittedBy: null,
            reviewedAt: null,
            reviewedBy: null,
            reviewedByName: null,
          },
        ],
      }),
    );
    pintar();

    expect(await screen.findByText('Enviada')).toBeTruthy();
    expect(screen.queryByLabelText('Seleccionar proyecto')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copiar semana anterior' })).toBeNull();
  });

  it('muestra el aviso de devolución con el revisor y la nota', async () => {
    vi.mocked(api.getTimesheetWeekStatus).mockResolvedValue(
      estado({
        locked: true,
        editableProjectIds: ['p1'],
        reviews: [
          {
            projectId: 'p1',
            projectName: 'Proyecto Uno',
            status: 'RETURNED',
            note: 'Falta detallar el martes',
            hours: 8,
            submittedAt: null,
            submittedBy: null,
            reviewedAt: null,
            reviewedBy: 'laura@synaptica.test',
            reviewedByName: 'Laura Gómez',
          },
        ],
      }),
    );
    pintar();

    expect(
      await screen.findByText('El PM Laura Gómez devolvió Proyecto Uno: «Falta detallar el martes»'),
    ).toBeTruthy();
    expect(screen.getByText('Devuelta')).toBeTruthy();
  });

  it('un ADMIN viendo a otro consultor envía en nombre de él; un PM no ve el botón', async () => {
    vi.mocked(api.getTimesheetWeekStatus).mockImplementation(async ({ consultantId }) =>
      estado({ consultantId: consultantId ?? 'c1' }),
    );
    const { unmount } = pintar({ isAdmin: true, consultants: [YO, OTRO] });
    const selector = (await screen.findByLabelText('Consultor')) as HTMLSelectElement;
    fireEvent.change(selector, { target: { value: 'c2' } });

    const boton = await screen.findByRole('button', { name: 'Enviar en nombre de Luis Gómez' });
    await waitFor(() => expect((boton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(boton);
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar' }));
    await waitFor(() =>
      expect(api.submitTimesheetWeek).toHaveBeenCalledWith({ weekStart: SEMANA, consultantId: 'c2' }),
    );
    unmount();

    pintar({ isAdmin: false, consultants: [YO, OTRO] });
    const selectorPm = (await screen.findByLabelText('Consultor')) as HTMLSelectElement;
    fireEvent.change(selectorPm, { target: { value: 'c2' } });
    await waitFor(() => expect(api.getTimesheetWeekStatus).toHaveBeenCalledWith({ weekStart: SEMANA, consultantId: 'c2' }));
    expect(screen.queryByRole('button', { name: /Enviar/ })).toBeNull();
  });
});
