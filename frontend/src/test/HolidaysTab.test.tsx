import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HolidaysTab } from '../features/holidays/HolidaysTab';
import type { Holiday, HolidayCoverage } from '../services/api';

/**
 * Pantalla de Feriados: el alta rápida (caso "decreto de un día para otro") debe
 * mandar la fecha exacta `YYYY-MM-DD`, sin pasar por hora local, y confirmar un
 * año debe llamar al endpoint del país y año correctos.
 */

const listHolidays = vi.fn();
const getHolidayCoverage = vi.fn();
const listHolidayCities = vi.fn();
const listSupportedCountries = vi.fn();
const createHoliday = vi.fn();
const confirmHolidayYear = vi.fn();
const unconfirmHolidayYear = vi.fn();
const generateHolidays = vi.fn();

vi.mock('../services/api', async () => {
  const actual = await vi.importActual<typeof import('../services/api')>('../services/api');
  return {
    ...actual,
    listHolidays: (...a: unknown[]) => listHolidays(...a),
    getHolidayCoverage: (...a: unknown[]) => getHolidayCoverage(...a),
    listHolidayCities: (...a: unknown[]) => listHolidayCities(...a),
    listSupportedCountries: (...a: unknown[]) => listSupportedCountries(...a),
    createHoliday: (...a: unknown[]) => createHoliday(...a),
    confirmHolidayYear: (...a: unknown[]) => confirmHolidayYear(...a),
    unconfirmHolidayYear: (...a: unknown[]) => unconfirmHolidayYear(...a),
    generateHolidays: (...a: unknown[]) => generateHolidays(...a),
    updateHoliday: vi.fn(),
    deleteHoliday: vi.fn(),
  };
});

const anio = new Date().getFullYear();

const feriado: Holiday = {
  id: 'h1', country: 'Ecuador', city: '', date: `${anio}-12-25`, name: 'Navidad', source: 'GENERATED', createdBy: null,
};
const cobertura: HolidayCoverage[] = [
  { country: 'Ecuador', year: anio, holidayCount: 1, confirmed: false, confirmedBy: null, confirmedAt: null },
];

function montar(canWrite = true) {
  const onError = vi.fn();
  const onSuccess = vi.fn();
  render(<HolidaysTab canWrite={canWrite} onError={onError} onSuccess={onSuccess} />);
  return { onError, onSuccess };
}

beforeEach(() => {
  vi.clearAllMocks();
  listSupportedCountries.mockResolvedValue(['Colombia', 'Ecuador', 'Default']);
  listHolidays.mockResolvedValue([feriado]);
  getHolidayCoverage.mockResolvedValue(cobertura);
  listHolidayCities.mockResolvedValue(['Quito']);
  createHoliday.mockResolvedValue({ ...feriado, id: 'h2' });
  confirmHolidayYear.mockResolvedValue(undefined);
  unconfirmHolidayYear.mockResolvedValue(undefined);
});

describe('HolidaysTab', () => {
  it('muestra el feriado con su origen y ámbito', async () => {
    montar();
    expect(await screen.findByText('Navidad')).toBeInTheDocument();
    expect(screen.getByText('Generado')).toBeInTheDocument();
    expect(screen.getByText('Nacional')).toBeInTheDocument();
  });

  it('el alta rápida envía la fecha YYYY-MM-DD exacta', async () => {
    const { onSuccess } = montar();
    await screen.findByText('Navidad');
    fireEvent.change(screen.getByLabelText('Fecha *'), { target: { value: '2026-12-07' } });
    fireEvent.change(screen.getByLabelText('Nombre *'), { target: { value: 'Decreto feriado' } });
    fireEvent.change(screen.getByLabelText('Ciudad (opcional)'), { target: { value: 'Quito' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar feriado' }));

    await waitFor(() => expect(createHoliday).toHaveBeenCalledTimes(1));
    expect(createHoliday).toHaveBeenCalledWith({
      country: 'Ecuador', city: 'Quito', date: '2026-12-07', name: 'Decreto feriado', source: 'DECREE',
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it('confirmar un año pide confirmación y llama al país y año correctos', async () => {
    montar();
    await screen.findByText('Sin confirmar');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar año' }));
    // El diálogo trae su propio botón "Confirmar año".
    const botones = await screen.findAllByRole('button', { name: 'Confirmar año' });
    fireEvent.click(botones[botones.length - 1]);
    await waitFor(() => expect(confirmHolidayYear).toHaveBeenCalledWith('Ecuador', anio));
  });

  it('sin permiso de escritura no ofrece alta ni confirmación', async () => {
    montar(false);
    await screen.findByText('Navidad');
    expect(screen.queryByText('Agregar feriado o decreto')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar año' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Precargar año' })).not.toBeInTheDocument();
  });

  it('muestra el error en vez de una tabla vacía cuando falla la carga', async () => {
    listHolidays.mockRejectedValue(new Error('Boom 500'));
    montar();
    expect(await screen.findByText('Boom 500')).toBeInTheDocument();
    expect(screen.getByText('No se pudieron cargar los feriados')).toBeInTheDocument();
  });
});

describe('HolidaysTab: cobertura', () => {
  it('oculta años sin feriados salvo el elegido y deshabilita confirmar si el año está vacío', async () => {
    getHolidayCoverage.mockResolvedValue([
      { country: 'Ecuador', year: anio - 1, holidayCount: 0, confirmed: false, confirmedBy: null, confirmedAt: null },
      { country: 'Ecuador', year: anio, holidayCount: 0, confirmed: false, confirmedBy: null, confirmedAt: null },
      { country: 'Ecuador', year: anio + 1, holidayCount: 12, confirmed: false, confirmedBy: null, confirmedAt: null },
    ]);
    montar();
    await screen.findByText('Navidad');
    const filas = await screen.findAllByRole('row');
    const textos = filas.map((f) => f.textContent ?? '');
    expect(textos.some((t) => t.includes(String(anio - 1)))).toBe(false);
    const botones = screen.getAllByRole('button', { name: 'Confirmar año' });
    expect(botones).toHaveLength(2);
    expect(botones[0]).toBeDisabled();
    expect(botones[0]).toHaveAttribute('title', 'Carga o precarga feriados antes de confirmar');
    expect(botones[1]).toBeEnabled();
    // Pide el rango que cubre año en curso -1..+1.
    expect(getHolidayCoverage).toHaveBeenCalledWith(anio - 1, anio + 1);
  });
});
