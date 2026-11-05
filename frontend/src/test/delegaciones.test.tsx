import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DelegationsPanel } from '../features/timesheetReviews/DelegationsPanel';
import {
  canDelegate,
  delegableProjects,
  delegationState,
  validateDelegationForm,
} from '../features/timesheetReviews/delegationUtils';
import type { ApprovalDelegation, DelegationCandidate, Project } from '../services/api';

vi.mock('../services/api', async () => {
  const actual = await vi.importActual<typeof import('../services/api')>('../services/api');
  return {
    ...actual,
    listDelegations: vi.fn(),
    listDelegationCandidates: vi.fn(),
    createDelegation: vi.fn(),
    deleteDelegation: vi.fn(),
  };
});

const api = await import('../services/api');

function proyecto(id: string, name: string, pm: string | null): Project {
  return { id, name, projectManagerEmail: pm } as Project;
}

const proyectos = [
  proyecto('p1', 'Alfa', 'pm@x.com'),
  proyecto('p2', 'Beta', 'otro@x.com'),
  proyecto('p3', 'Sin PM', null),
];

describe('delegationUtils', () => {
  it('vigencia inclusiva por fecha de calendario', () => {
    const d = { startDate: '2026-11-02T00:00:00.000Z', endDate: '2026-11-06T00:00:00.000Z' };
    expect(delegationState(d, '2026-11-01')).toBe('FUTURE');
    expect(delegationState(d, '2026-11-02')).toBe('ACTIVE');
    expect(delegationState(d, '2026-11-06')).toBe('ACTIVE');
    expect(delegationState(d, '2026-11-07')).toBe('EXPIRED');
  });

  it('un PM solo delega sus proyectos; el ADMIN cualquiera con PM', () => {
    expect(delegableProjects(proyectos, 'PM@x.com', false).map((p) => p.id)).toEqual(['p1']);
    expect(delegableProjects(proyectos, 'admin@x.com', true).map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(canDelegate(proyectos, 'nadie@x.com', false)).toBe(false);
    expect(canDelegate(proyectos, 'nadie@x.com', true)).toBe(true);
    expect(canDelegate(proyectos, 'pm@x.com', false)).toBe(true);
  });

  it('valida el formulario', () => {
    const ok = { projectId: 'p1', toUserEmail: 'a@x.com', startDate: '2026-11-02', endDate: '2026-11-03' };
    expect(validateDelegationForm(ok)).toBeNull();
    expect(validateDelegationForm({ ...ok, projectId: '' })).toMatch(/proyecto/);
    expect(validateDelegationForm({ ...ok, endDate: '2026-11-01' })).toMatch(/fecha de fin/);
  });
});

describe('DelegationsPanel', () => {
  const candidatos: DelegationCandidate[] = [
    { email: 'pm@x.com', nombre: 'Yo PM', motivo: 'PROYECTO', proyectos: ['Alfa'] },
    { email: 'otro@x.com', nombre: 'Otro PM', motivo: 'PROYECTO', proyectos: ['Beta'] },
  ];
  const existente: ApprovalDelegation = {
    id: 'd1',
    projectId: 'p1',
    fromUserEmail: 'pm@x.com',
    toUserEmail: 'otro@x.com',
    startDate: '2020-01-01T00:00:00.000Z',
    endDate: '2020-01-05T00:00:00.000Z',
    createdAt: '2020-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listDelegations).mockResolvedValue([existente]);
    vi.mocked(api.listDelegationCandidates).mockResolvedValue(candidatos);
    vi.mocked(api.createDelegation).mockResolvedValue(existente);
    vi.mocked(api.deleteDelegation).mockResolvedValue(undefined);
  });

  function pintar() {
    const onNotice = vi.fn();
    render(<DelegationsPanel projects={proyectos} userEmail="pm@x.com" isAdmin={false} onNotice={onNotice} />);
    return { onNotice };
  }

  it('lista con estado vencida y excluye al propio usuario de los candidatos', async () => {
    pintar();
    expect(await screen.findByText('Vencida')).toBeTruthy();
    expect(screen.getByText('Alfa', { selector: 'td' })).toBeTruthy();
    const delegado = screen.getByLabelText('Delegado') as HTMLSelectElement;
    expect(Array.from(delegado.options).some((o) => o.value === 'pm@x.com')).toBe(false);
    expect(Array.from(delegado.options).some((o) => o.value === 'otro@x.com')).toBe(true);
  });

  it('crea una delegación', async () => {
    const { onNotice } = pintar();
    await screen.findByText('Vencida');
    fireEvent.change(screen.getByLabelText('Proyecto'), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText('Delegado'), { target: { value: 'otro@x.com' } });
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-11-10' } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-11-12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear delegación' }));
    await waitFor(() =>
      expect(api.createDelegation).toHaveBeenCalledWith({
        projectId: 'p1',
        toUserEmail: 'otro@x.com',
        startDate: '2026-11-10',
        endDate: '2026-11-12',
      }),
    );
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('Delegación creada.', 'success'));
  });

  it('muestra el error del servidor al crear', async () => {
    vi.mocked(api.createDelegation).mockRejectedValue(new Error('no puede recibir la delegación'));
    pintar();
    await screen.findByText('Vencida');
    fireEvent.change(screen.getByLabelText('Proyecto'), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText('Delegado'), { target: { value: 'otro@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear delegación' }));
    expect(await screen.findByText('no puede recibir la delegación')).toBeTruthy();
  });

  it('elimina con confirmación', async () => {
    pintar();
    fireEvent.click(await screen.findByRole('button', { name: /Eliminar delegación de Alfa/ }));
    const botones = screen.getAllByRole('button', { name: 'Eliminar' });
    fireEvent.click(botones[botones.length - 1]);
    await waitFor(() => expect(api.deleteDelegation).toHaveBeenCalledWith('d1'));
  });

  it('estado de error con reintento y estado vacío', async () => {
    vi.mocked(api.listDelegations).mockRejectedValueOnce(new Error('Falló'));
    pintar();
    expect(await screen.findByText('Falló')).toBeTruthy();
    vi.mocked(api.listDelegations).mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Aún no hay delegaciones.')).toBeTruthy();
  });
});
