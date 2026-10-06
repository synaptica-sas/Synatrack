import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ExtraHoursTab } from '../features/extraHours/ExtraHoursTab';
import type { AuthUser, Consultant, DelegationCandidate, Project } from '../services/api';

/**
 * D-13 — el desplegable de delegación deja de ofrecer a quien no podría aprobar.
 *
 * El bug R-024 nació de un desajuste: el formulario se rellenaba con la lista de
 * consultores y el backend rechazaba justo esas opciones. Endurecer la regla sin
 * tocar la pantalla lo habría reproducido, así que el desplegable ahora se
 * rellena con `GET /api/delegations/candidates`, que es la **misma** regla que
 * valida el `POST`.
 */

vi.mock('../services/api', async () => {
  const actual = await vi.importActual<typeof import('../services/api')>('../services/api');
  return {
    ...actual,
    listDelegations: vi.fn().mockResolvedValue([]),
    listDelegationCandidates: vi.fn(),
    listExtraHours: vi.fn().mockResolvedValue({ data: [], meta: { total: 0, page: 1, pageSize: 50, totalPages: 1 } }),
    listAllExtraHours: vi.fn().mockResolvedValue([]),
    listExtraHoursConfigs: vi.fn().mockResolvedValue([]),
    listCustomHolidays: vi.fn().mockResolvedValue([]),
    listSupportedCountries: vi.fn().mockResolvedValue([]),
    createDelegation: vi.fn(),
    deleteDelegation: vi.fn(),
  };
});

const api = await import('../services/api');

const PROYECTO = { id: 'p1', name: 'Proyecto Uno', currency: 'USD' } as unknown as Project;

/** Consultor que NO dirige proyectos: antes aparecía en el desplegable, ahora no. */
const CONSULTOR_RASO = {
  id: 'c1',
  fullName: 'Ana Consultora',
  email: 'ana@synaptica.test',
} as unknown as Consultant;

const YO: AuthUser = {
  id: 'u1',
  email: 'pm.principal@synaptica.test',
  displayName: 'PM Principal',
  roles: ['ADMIN'],
  permissions: [],
};

function pintar(candidatos: DelegationCandidate[]) {
  vi.mocked(api.listDelegationCandidates).mockResolvedValue(candidatos);
  return render(
    <ExtraHoursTab
      projects={[PROYECTO]}
      consultants={[CONSULTOR_RASO]}
      authUser={YO}
      can={() => true}
      onError={() => {}}
    />,
  );
}

/** Abre la sub-pestaña de delegaciones y espera a que termine de cargar. */
async function abrirDelegaciones() {
  fireEvent.click(screen.getByRole('button', { name: /Delegaci/i }));
  await waitFor(() => expect(api.listDelegationCandidates).toHaveBeenCalled());
}

describe('Delegación de aprobaciones: el desplegable solo ofrece candidatos válidos (D-13)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listDelegations).mockResolvedValue([]);
    vi.mocked(api.listExtraHours).mockResolvedValue({ data: [], meta: { total: 0, page: 1, pageSize: 50, totalPages: 1 } });
    vi.mocked(api.listAllExtraHours).mockResolvedValue([]);
    vi.mocked(api.listExtraHoursConfigs).mockResolvedValue([]);
    vi.mocked(api.listCustomHolidays).mockResolvedValue([]);
    vi.mocked(api.listSupportedCountries).mockResolvedValue([]);
  });

  it('ofrece a los PM que devuelve el backend y NO a un consultor que no dirige proyectos', async () => {
    pintar([
      { email: 'carlos@synaptica.test', nombre: 'Carlos Méndez', motivo: 'PROYECTO', proyectos: ['Proyecto Dos'] },
    ]);
    await abrirDelegaciones();

    const opciones = await waitFor(() => {
      const encontradas = screen.getAllByRole('option');
      expect(encontradas.length).toBeGreaterThan(1);
      return encontradas;
    });
    const textos = opciones.map((o) => o.textContent ?? '');

    expect(textos.some((t) => t.includes('carlos@synaptica.test'))).toBe(true);
    // El consultor sigue llegando por props (se usa en el resto de la pantalla),
    // pero ya no es una opción aquí: el backend lo rechazaría.
    expect(textos.some((t) => t.includes('ana@synaptica.test'))).toBe(false);
  });

  it('dice por qué cada candidato lo es: los proyectos que dirige, o el rol de su cuenta', async () => {
    pintar([
      { email: 'carlos@synaptica.test', nombre: 'Carlos Méndez', motivo: 'PROYECTO', proyectos: ['Proyecto Dos'] },
      { email: 'jefa@synaptica.test', nombre: 'Jefa Admin', motivo: 'ROL', proyectos: [] },
    ]);
    await abrirDelegaciones();

    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(2));
    const textos = screen.getAllByRole('option').map((o) => o.textContent ?? '');

    expect(textos.some((t) => t.includes('Carlos Méndez') && t.includes('Proyecto Dos'))).toBe(true);
    expect(textos.some((t) => t.includes('Jefa Admin') && t.includes('rol en su cuenta'))).toBe(true);
  });

  it('no se ofrece a uno mismo: delegarse a sí mismo no cubre nada', async () => {
    pintar([
      { email: YO.email, nombre: 'PM Principal', motivo: 'PROYECTO', proyectos: ['Proyecto Uno'] },
      { email: 'carlos@synaptica.test', nombre: 'Carlos Méndez', motivo: 'PROYECTO', proyectos: ['Proyecto Dos'] },
    ]);
    await abrirDelegaciones();

    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(1));
    const textos = screen.getAllByRole('option').map((o) => o.textContent ?? '');

    expect(textos.some((t) => t.includes('carlos@synaptica.test'))).toBe(true);
    expect(textos.some((t) => t.includes(YO.email))).toBe(false);
  });

  it('sin candidatos hay un estado vacío que dice qué hacer, y el botón queda inhabilitado', async () => {
    pintar([]);
    await abrirDelegaciones();

    expect(await screen.findByText('No hay nadie a quien delegar')).toBeInTheDocument();
    expect(screen.getByText(/Asigna un responsable en la ficha de algún proyecto/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delegar Aprobación/ })).toBeDisabled();
  });

  it('el aviso explica la regla real y ya no promete delegar en un consultor normal', async () => {
    pintar([
      { email: 'carlos@synaptica.test', nombre: 'Carlos Méndez', motivo: 'PROYECTO', proyectos: ['Proyecto Dos'] },
    ]);
    await abrirDelegaciones();

    // El aviso anterior (R-024) decía que se podía nombrar a cualquiera y que
    // después haría falta el rol para aprobar. Eso dejó de ser cierto con D-13.
    expect(await screen.findByText('Solo se puede delegar en quien ya es PM')).toBeInTheDocument();
    expect(screen.queryByText(/Antes de delegar, comprueba el rol del delegado/)).toBeNull();
    expect(screen.queryByText(/delegar temporalmente la aprobación de horas extra a un consultor normal/)).toBeNull();
  });
});
