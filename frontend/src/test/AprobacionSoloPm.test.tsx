import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ExtraHoursTab } from '../features/extraHours/ExtraHoursTab';
import type { AuthUser, Consultant, ExtraHourEntry, Project } from '../services/api';

/**
 * Solo el PM del proyecto aprueba horas extra (decisión del 2026-10-09): ni el
 * Administrador ni un delegado. La pantalla aplica la misma regla que el
 * backend: el buzón solo muestra las solicitudes de los proyectos que dirige
 * quien está conectado, y la pestaña de Delegaciones desaparece.
 */

vi.mock('../services/api', async () => {
  const actual = await vi.importActual<typeof import('../services/api')>('../services/api');
  return {
    ...actual,
    listExtraHours: vi.fn().mockResolvedValue({ data: [], meta: { total: 0, page: 1, pageSize: 50, totalPages: 1 } }),
    listAllExtraHours: vi.fn(),
    listExtraHoursConfigs: vi.fn().mockResolvedValue([]),
    listCustomHolidays: vi.fn().mockResolvedValue([]),
    listSupportedCountries: vi.fn().mockResolvedValue([]),
    // R14: excedentes de horas extra por aprobar (parte del buzón del PM).
    listExcessPending: vi.fn().mockResolvedValue([]),
  };
});

const api = await import('../services/api');

const MI_PROYECTO = {
  id: 'p1',
  name: 'Proyecto Mío',
  currency: 'USD',
  projectManagerEmail: 'Yo.PM@synaptica.test',
} as unknown as Project;
const OTRO_PROYECTO = {
  id: 'p2',
  name: 'Proyecto Ajeno',
  currency: 'USD',
  projectManagerEmail: 'otra.pm@synaptica.test',
} as unknown as Project;

const CONSULTOR = { id: 'c1', fullName: 'Ana Consultora', email: 'ana@synaptica.test' } as unknown as Consultant;

function solicitud(id: string, project: Project): ExtraHourEntry {
  return {
    id,
    projectId: project.id,
    project,
    consultantId: 'c1',
    consultant: CONSULTOR,
    date: '2026-10-01T00:00:00.000Z',
    startTime: '18:00',
    endTime: '20:00',
    totalHours: '2',
    diurnal: '1',
    nocturnal: '1',
    diurnalHoliday: '0',
    nocturnalHoliday: '0',
    totalAmount: '100',
    observations: `Solicitud de ${project.name}`,
    status: 'PENDING_PM',
  } as unknown as ExtraHourEntry;
}

function usuario(email: string, roles: AuthUser['roles']): AuthUser {
  return { id: 'u1', email, displayName: 'Yo', roles, permissions: [], consultantId: null };
}

function pintar(authUser: AuthUser) {
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

describe('Aprobación de horas extra: solo el PM del proyecto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listAllExtraHours).mockResolvedValue([
      solicitud('e1', MI_PROYECTO),
      solicitud('e2', OTRO_PROYECTO),
    ]);
    vi.mocked(api.listExcessPending).mockResolvedValue([]);
  });

  it('el buzón cuenta y lista los excedentes de horas extra que el backend le devuelve al PM', async () => {
    vi.mocked(api.listExcessPending).mockResolvedValue([
      {
        id: 'x1',
        workDate: '2026-10-01T00:00:00.000Z',
        hours: '1.5',
        startedAt: '2026-10-02T03:00:00.000Z',
        endedAt: '2026-10-02T04:30:00.000Z',
        description: 'Despliegue nocturno',
        projectId: 'p1',
        consultantId: 'c1',
        extraHourEntryId: 'e1',
        project: { id: 'p1', name: 'Proyecto Mío' },
        consultant: { id: 'c1', fullName: 'Ana Consultora' },
        type: { id: 't', code: 'EXTRA', name: 'Horas Extras' },
      },
    ]);
    pintar(usuario('yo.pm@synaptica.test', ['PM']));

    // 1 solicitud propia + 1 excedente.
    const pestana = await screen.findByRole('button', { name: /Aprobaciones \(2\)/ });
    fireEvent.click(pestana);
    expect(await screen.findByText('Despliegue nocturno')).toBeTruthy();
    expect(screen.getByText('1.50')).toBeTruthy();
    expect(api.listExcessPending).toHaveBeenCalled();
  });

  it('el buzón del PM muestra solo las solicitudes de sus proyectos', async () => {
    // El correo del proyecto viene con mayúsculas: se compara sin distinguirlas.
    pintar(usuario('yo.pm@synaptica.test', ['PM']));

    const pestana = await screen.findByRole('button', { name: /Aprobaciones \(1\)/ });
    fireEvent.click(pestana);

    expect(await screen.findByText('Solicitud de Proyecto Mío')).toBeTruthy();
    expect(screen.queryByText('Solicitud de Proyecto Ajeno')).toBeNull();
  });

  it('un PM cuya cuenta solo tiene rol de Consultor también ve su buzón', async () => {
    pintar(usuario('yo.pm@synaptica.test', ['CONSULTANT']));

    expect(await screen.findByRole('button', { name: /Aprobaciones \(1\)/ })).toBeTruthy();
  });

  it('el Administrador que no dirige proyectos no tiene pestaña de aprobaciones', async () => {
    pintar(usuario('admin@synaptica.test', ['ADMIN']));

    await waitFor(() => expect(api.listAllExtraHours).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Aprobaciones/ })).toBeNull();
  });

  it('ya no existe la pestaña de Delegaciones', async () => {
    pintar(usuario('yo.pm@synaptica.test', ['ADMIN', 'PM']));

    await waitFor(() => expect(api.listAllExtraHours).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Delegaci/i })).toBeNull();
  });
});
