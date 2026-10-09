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
  return { id: 'u1', email, displayName: 'Yo', roles, permissions: [] };
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
