import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ExtraHoursTab } from '../features/extraHours/ExtraHoursTab';
import type { AuthUser, Consultant, ExtraHourEntry, Project } from '../services/api';

/**
 * Valor, real y excedente son información del PM (y de ADMIN/FINANCE). El
 * consultor ve solo Fecha, Proyecto, Horario, Horas solicitadas, Estado y
 * Acciones; el backend ni siquiera le envía montos (llegan ausentes).
 */

vi.mock('../services/api', async () => {
  const actual = await vi.importActual<typeof import('../services/api')>('../services/api');
  return {
    ...actual,
    listExtraHours: vi.fn(),
    listAllExtraHours: vi.fn().mockResolvedValue([]),
    listExtraHoursConfigs: vi.fn().mockResolvedValue([]),
    listCustomHolidays: vi.fn().mockResolvedValue([]),
    listSupportedCountries: vi.fn().mockResolvedValue([]),
    calculateExtraHoursApi: vi.fn(),
  };
});

const api = await import('../services/api');

const MI_PROYECTO = { id: 'p1', name: 'Proyecto Mío', projectManagerEmail: 'yo.pm@synaptica.test' } as unknown as Project;
const OTRO_PROYECTO = { id: 'p2', name: 'Proyecto Ajeno', projectManagerEmail: 'otra.pm@synaptica.test' } as unknown as Project;
const CONSULTOR = { id: 'c1', fullName: 'Ana Consultora', rateCurrency: 'COP' } as unknown as Consultant;

function solicitud(id: string, project: Project, conMonto: boolean): ExtraHourEntry {
  return {
    id,
    projectId: project.id,
    project,
    consultantId: 'c1',
    consultant: CONSULTOR,
    date: '2026-10-01T00:00:00.000Z',
    startTime: '18:00:00',
    endTime: '20:00:00',
    totalHours: '2',
    diurnal: '2',
    nocturnal: '0',
    diurnalHoliday: '0',
    nocturnalHoliday: '0',
    ...(conMonto ? { totalAmount: '123456' } : {}),
    observations: null,
    status: 'PENDING_PM',
  } as unknown as ExtraHourEntry;
}

function usuario(email: string, roles: AuthUser['roles']): AuthUser {
  return { id: 'u1', email, displayName: 'Yo', roles, permissions: [], consultantId: 'c1' };
}

function pintar(authUser: AuthUser, entradas: ExtraHourEntry[]) {
  vi.mocked(api.listExtraHours).mockResolvedValue({
    data: entradas,
    meta: { total: entradas.length, page: 1, pageSize: 50, totalPages: 1 },
  });
  return render(
    <ExtraHoursTab
      projects={[MI_PROYECTO, OTRO_PROYECTO]}
      consultants={[CONSULTOR]}
      authUser={authUser}
      can={() => true}
      onError={() => {}}
    />,
  );
}

const cabeceras = () => screen.getAllByRole('columnheader').map((h) => h.textContent);

describe('Historial de solicitudes de horas extra: visibilidad por rol', () => {
  beforeEach(() => vi.clearAllMocks());

  it('el consultor ve solo Fecha, Proyecto, Horario, Horas solicitadas, Estado y Acciones', async () => {
    pintar(usuario('ana@synaptica.test', ['CONSULTANT']), [solicitud('e1', OTRO_PROYECTO, false)]);

    expect(await screen.findByText('Proyecto Ajeno')).toBeTruthy();
    expect(cabeceras()).toEqual(['Fecha', 'Proyecto', 'Horario', 'Horas solicitadas', 'Estado', 'Acciones']);
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it('muestra la duración legible y el desglose en palabras solo con tipos distintos de cero', async () => {
    const e = { ...solicitud('e1', OTRO_PROYECTO, false), totalHours: '3', diurnal: '2', nocturnal: '1' } as ExtraHourEntry;
    pintar(usuario('ana@synaptica.test', ['CONSULTANT']), [e]);

    expect(await screen.findByText('03:00:00')).toBeTruthy();
    expect(screen.getByText('Diurnas 02:00:00')).toBeTruthy();
    expect(screen.getByText('Nocturnas 01:00:00')).toBeTruthy();
    expect(screen.queryByText(/Festivas/)).toBeNull();
    expect(screen.queryByText(/D:\d/)).toBeNull();
    expect(screen.queryByText('Aprobado')).toBeNull();
  });

  it('el PM ve Real, Excedente y Monto de sus proyectos y guiones en los ajenos', async () => {
    pintar(usuario('yo.pm@synaptica.test', ['CONSULTANT']), [
      solicitud('e1', MI_PROYECTO, true),
      solicitud('e2', OTRO_PROYECTO, false),
    ]);

    await screen.findByText('Proyecto Mío');
    expect(cabeceras()).toContain('Monto');
    expect(cabeceras()).toContain('Excedente');
    expect(screen.getByText('$123.456')).toBeTruthy();
  });

  it('ADMIN y FINANCE ven las columnas de monto aunque no dirijan proyectos', async () => {
    pintar(usuario('admin@synaptica.test', ['ADMIN']), [solicitud('e1', OTRO_PROYECTO, true)]);

    await screen.findByText('Proyecto Ajeno');
    expect(cabeceras()).toEqual([
      'Fecha', 'Proyecto', 'Consultor', 'Horario', 'Horas solicitadas', 'Real', 'Excedente', 'Monto', 'Estado', 'Acciones',
    ]);
    expect(screen.getByText('$123.456')).toBeTruthy();
  });

  it('el formulario no previsualiza tarifa ni monto al consultor', async () => {
    vi.mocked(api.calculateExtraHoursApi).mockResolvedValue({
      diurnal: 2, nocturnal: 0, diurnalHoliday: 0, nocturnalHoliday: 0, totalHours: 2,
      diurnalAmount: 1, nocturnalAmount: 0, diurnalHolidayAmount: 0, nocturnalHolidayAmount: 0,
      totalAmount: 99999, hourlyRate: 5000, hourlyRateUsed: 5000, divisorUsed: 220, isHoliday: false, warnings: [],
    });
    pintar(usuario('ana@synaptica.test', ['CONSULTANT']), []);

    expect(await screen.findByText(/Simulación en Vivo/)).toBeTruthy();
    await waitFor(() => expect(api.calculateExtraHoursApi).toHaveBeenCalled());
    expect(screen.getByText(/Diurnas \/ Nocturnas/)).toBeTruthy();
    expect(screen.queryByText(/Valor Estimado Pago/)).toBeNull();
    expect(screen.queryByText(/Tarifa por Hora/)).toBeNull();
  });
});
