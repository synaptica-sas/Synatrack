import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AssignmentsPanel } from '../features/capacity/CapacityTab';
import {
  etiquetaProyecto,
  mensajeAdvertencias,
  textoEquivalente,
  validarAsignacion,
  emptyAssignmentForm,
} from '../features/capacity/assignmentForm';
import type { Consultant, Project } from '../services/api';

const listAssignments = vi.fn();
const createAssignment = vi.fn();
const getEffectiveWorkdays = vi.fn();
const showToast = vi.fn();

vi.mock('../services/api', async () => {
  const actual = await vi.importActual<typeof import('../services/api')>('../services/api');
  return {
    ...actual,
    listAssignments: (...a: unknown[]) => listAssignments(...a),
    createAssignment: (...a: unknown[]) => createAssignment(...a),
    getEffectiveWorkdays: (...a: unknown[]) => getEffectiveWorkdays(...a),
  };
});
vi.mock('../hooks/useToast', () => ({ useToast: () => ({ showToast }) }));

const proyectos = [
  { id: 'p1', name: 'Alpha', status: 'ACTIVE' },
  { id: 'p2', name: 'Beta', status: 'PROSPECT' },
  { id: 'p3', name: 'Gamma', status: 'ACTIVE', isInternal: true },
] as unknown as Project[];
const consultores = [{ id: 'c1', fullName: 'Ana Pérez', role: 'Dev', active: true }] as unknown as Consultant[];

beforeEach(() => {
  vi.clearAllMocks();
  listAssignments.mockResolvedValue([]);
  getEffectiveWorkdays.mockResolvedValue({
    general: { hoursPerDay: 8, workDaysPerWeek: 5, origen: 'general', paisAplicado: null },
    consultants: [{ consultantId: 'c1', hoursPerDay: 4, workDaysPerWeek: 5, origen: 'consultor', paisAplicado: null }],
  });
});

describe('helpers de asignación', () => {
  it('equivalente: 20 h/semana es 50 % de una jornada de 8 h', () => {
    expect(textoEquivalente('20', 'week')).toBe('≈ 50 % de una jornada de 8 h');
    expect(textoEquivalente('', 'week')).toBeNull();
  });
  it('equivalente con la jornada del consultor: 20 h/sem con 4 h x 5 días es 100 %', () => {
    const j = { hoursPerDay: 4, workDaysPerWeek: 5, deConsultor: true };
    expect(textoEquivalente('20', 'week', j)).toBe('≈ 100 % de su jornada (4 h × 5 días)');
    expect(textoEquivalente('20', 'week', { ...j, hoursPerDay: 8, deConsultor: false })).toBe(
      '≈ 50 % de la jornada general (8 h × 5 días)',
    );
  });
  it('valida fin >= inicio', () => {
    const f = { ...emptyAssignmentForm, startDate: '2026-05-10', endDate: '2026-05-09', hoursPerPeriod: '10' };
    expect(validarAsignacion(f)).toMatch(/anterior/);
    expect(validarAsignacion({ ...f, endDate: '2026-05-10' })).toBeNull();
  });
  it('marca oportunidades e internos', () => {
    expect(etiquetaProyecto({ name: 'X', status: 'PROSPECT' })).toBe('X (Oportunidad)');
    expect(etiquetaProyecto({ name: 'X', status: 'ACTIVE', isInternal: true })).toBe('X (Interno)');
  });
  it('arma el mensaje de sobreasignación', () => {
    expect(mensajeAdvertencias([{ code: 'OVERALLOCATED', month: '2026-03', pct: 112.4 }])).toMatch(/2026-03 \(112 %\)/);
    expect(mensajeAdvertencias([])).toBeNull();
  });
});

describe('modal de asignación', () => {
  async function abrir() {
    const onError = vi.fn();
    render(<AssignmentsPanel projects={proyectos} consultants={consultores} canWrite onError={onError} />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Nueva asignación' }));
    return onError;
  }

  it('captura en horas por semana por defecto y muestra el equivalente', async () => {
    await abrir();
    expect(screen.getByLabelText('Modo de asignación *')).toHaveValue('HOURS');
    expect(screen.getByLabelText('Período *')).toHaveValue('week');
    fireEvent.change(screen.getByLabelText('Horas *'), { target: { value: '20' } });
    expect(screen.getByTestId('equivalente-jornada')).toHaveTextContent(/≈ 50 % de (una jornada de 8 h|la jornada general .8 h × 5 días.)/);
    expect(screen.getByRole('option', { name: 'Beta (Oportunidad)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Gamma (Interno)' })).toBeInTheDocument();
  });

  it('el campo Horas arranca con 40 h por semana', async () => {
    await abrir();
    expect(screen.getByLabelText('Horas *')).toHaveValue(40);
  });

  it('el equivalente usa la jornada vigente del consultor elegido', async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText('Consultor *'), { target: { value: 'c1' } });
    fireEvent.change(screen.getByLabelText('Horas *'), { target: { value: '20' } });
    await waitFor(() =>
      expect(screen.getByTestId('equivalente-jornada')).toHaveTextContent('≈ 100 % de su jornada (4 h × 5 días)'),
    );
  });

  it('una advertencia de sobreasignación avisa pero no bloquea', async () => {
    createAssignment.mockResolvedValue({
      data: { id: 'a1' },
      warnings: [{ code: 'OVERALLOCATED', month: '2026-03', pct: 130 }],
    });
    const onError = await abrir();
    fireEvent.change(screen.getByLabelText('Proyecto *'), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText('Consultor *'), { target: { value: 'c1' } });
    fireEvent.change(screen.getByLabelText('Fecha de inicio *'), { target: { value: '2026-03-01' } });
    fireEvent.change(screen.getByLabelText('Fecha de fin *'), { target: { value: '2026-03-31' } });
    fireEvent.change(screen.getByLabelText('Estado de certeza *'), { target: { value: 'PROBABLE' } });
    fireEvent.change(screen.getByLabelText('Horas *'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear asignación' }));

    await waitFor(() => expect(createAssignment).toHaveBeenCalledTimes(1));
    expect(createAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        allocationMode: 'HOURS',
        periodUnit: 'week',
        hoursPerPeriod: 30,
        certainty: 'PROBABLE',
        startDate: '2026-03-01',
        endDate: '2026-03-31',
      }),
    );
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringContaining('sobreasignado'), 'warning'));
    expect(onError).not.toHaveBeenCalled();
    // La modal se cierra: la asignación quedó guardada.
    await waitFor(() => expect(screen.queryByText('Nueva asignación')).not.toBeInTheDocument());
  });

  it('no envía si el fin es anterior al inicio', async () => {
    const onError = await abrir();
    fireEvent.change(screen.getByLabelText('Proyecto *'), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText('Consultor *'), { target: { value: 'c1' } });
    fireEvent.change(screen.getByLabelText('Fecha de inicio *'), { target: { value: '2026-03-10' } });
    fireEvent.change(screen.getByLabelText('Fecha de fin *'), { target: { value: '2026-03-01' } });
    fireEvent.change(screen.getByLabelText('Horas *'), { target: { value: '10' } });
    // El navegador ya frena el envío por el atributo min; aquí se comprueba la validación propia.
    fireEvent.submit(screen.getByRole('button', { name: 'Crear asignación' }).closest('form')!);
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringMatching(/anterior/)));
    expect(createAssignment).not.toHaveBeenCalled();
  });
});
