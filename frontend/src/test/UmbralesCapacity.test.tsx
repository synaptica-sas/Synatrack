import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CapacityThresholdsSection } from '../features/workday/CapacityThresholdsSection';
import { marcarVigencias, validarUmbrales } from '../features/workday/workdayUtils';
import type { JornadaFila } from '../services/api';

const getCapacitySettings = vi.fn();
const updateCapacitySettings = vi.fn();

vi.mock('../services/api', async () => {
  const actual = await vi.importActual<typeof import('../services/api')>('../services/api');
  return {
    ...actual,
    getCapacitySettings: (...a: unknown[]) => getCapacitySettings(...a),
    updateCapacitySettings: (...a: unknown[]) => updateCapacitySettings(...a),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  getCapacitySettings.mockResolvedValue({ underThresholdPct: 70, overThresholdPct: 100, includeProbablesDefault: false });
  updateCapacitySettings.mockImplementation(async (p: object) => p);
});

describe('validarUmbrales', () => {
  it('exige subutilizado < sobreasignado', () => {
    expect(validarUmbrales({ under: '100', over: '70' })).toMatch(/menor/);
    expect(validarUmbrales({ under: '80', over: '80' })).toMatch(/menor/);
    expect(validarUmbrales({ under: '70', over: '100' })).toBeNull();
  });
  it('rechaza vacíos y valores fuera de rango', () => {
    expect(validarUmbrales({ under: '', over: '100' })).not.toBeNull();
    expect(validarUmbrales({ under: '-1', over: '100' })).not.toBeNull();
    expect(validarUmbrales({ under: '70', over: '301' })).not.toBeNull();
  });
});

describe('CapacityThresholdsSection', () => {
  it('no guarda si under >= over y muestra el error', async () => {
    render(<CapacityThresholdsSection canWrite onError={vi.fn()} onSuccess={vi.fn()} />);
    const under = await screen.findByLabelText(/Subutilizado/);
    fireEvent.change(under, { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar umbrales' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/menor que el de sobreasignado/);
    expect(updateCapacitySettings).not.toHaveBeenCalled();
  });

  it('guarda umbrales válidos con el valor de incluir probables', async () => {
    const onSuccess = vi.fn();
    render(<CapacityThresholdsSection canWrite onError={vi.fn()} onSuccess={onSuccess} />);
    fireEvent.change(await screen.findByLabelText(/Subutilizado/), { target: { value: '60' } });
    fireEvent.click(screen.getByLabelText(/Incluir asignaciones probables/));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar umbrales' }));
    await waitFor(() =>
      expect(updateCapacitySettings).toHaveBeenCalledWith({
        underThresholdPct: 60,
        overThresholdPct: 100,
        includeProbablesDefault: true,
      }),
    );
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it('muestra el error de carga con opción de reintentar', async () => {
    getCapacitySettings.mockRejectedValueOnce(new Error('Sin conexión'));
    render(<CapacityThresholdsSection canWrite onError={vi.fn()} onSuccess={vi.fn()} />);
    expect(await screen.findByText('Sin conexión')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByLabelText(/Subutilizado/)).toHaveValue(70);
  });
});

describe('marcarVigencias', () => {
  const fila = (id: string, validFrom: string): JornadaFila => ({
    id,
    consultantId: null,
    country: 'Colombia',
    validFrom,
    hoursPerDay: 8,
    workDaysPerWeek: 5,
    updatedAt: '',
  });
  it('marca la de mayor fecha no posterior a hoy como vigente', () => {
    const r = marcarVigencias([fila('c', '2027-01-01'), fila('a', '2000-01-01'), fila('b', '2026-07-15')], '2026-10-15');
    expect(r.map((x) => [x.id, x.estado])).toEqual([
      ['a', 'anterior'],
      ['b', 'vigente'],
      ['c', 'futura'],
    ]);
  });
});
