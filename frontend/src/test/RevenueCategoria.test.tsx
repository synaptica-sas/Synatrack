import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { RevenueTab } from '../features/revenue/RevenueTab';
import type { Project, RevenueEntry } from '../services/api';

/**
 * Categorías de ingreso en pantalla (decisión de negocio D-4).
 *
 * Comprueba lo que la prueba de ruta no ve: que el desplegable se llena con el
 * catálogo que devuelve la API, que un ingreso se envía con la categoría
 * elegida, y —lo que más importa para no romper nada— que un ingreso anterior a
 * D-4, con `category` nula, se sigue pintando y editando sin problemas.
 */

const listFinancialCategories = vi.fn();
const createRevenueEntry = vi.fn();

vi.mock('../services/api', async () => {
  const actual = await vi.importActual<typeof import('../services/api')>('../services/api');
  return {
    ...actual,
    listFinancialCategories: (...args: unknown[]) => listFinancialCategories(...args),
    createRevenueEntry: (...args: unknown[]) => createRevenueEntry(...args),
    updateRevenueEntry: vi.fn(),
    deleteRevenueEntry: vi.fn(),
  };
});

const proyecto = { id: 'p1', name: 'Proyecto Alpha' } as unknown as Project;

function ingreso(overrides: Partial<RevenueEntry>): RevenueEntry {
  return {
    id: 'r1',
    projectId: 'p1',
    entryDate: '2026-03-10T00:00:00.000Z',
    amount: '1500',
    currency: 'USD',
    category: 'Servicios de consultoría',
    description: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function pintar(entries: RevenueEntry[]) {
  return render(
    <RevenueTab
      revenueEntries={entries}
      projects={[proyecto]}
      loading={false}
      canWrite
      onReload={() => Promise.resolve()}
      onError={() => {}}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listFinancialCategories.mockResolvedValue([
    { id: 'c1', type: 'REVENUE', name: 'Servicios de consultoría', active: true, sortOrder: 1, createdAt: '', updatedAt: '' },
    { id: 'c2', type: 'REVENUE', name: 'Otros ingresos', active: true, sortOrder: 99, createdAt: '', updatedAt: '' },
  ]);
  createRevenueEntry.mockResolvedValue(ingreso({}));
});

describe('Categorías de ingreso en la pantalla de Ingresos (D-4)', () => {
  it('el desplegable se llena con el catálogo que devuelve la API', async () => {
    pintar([]);

    const selector = await screen.findByLabelText('Categoría del ingreso');
    await waitFor(() => {
      expect(within(selector).getByRole('option', { name: 'Servicios de consultoría' })).toBeTruthy();
    });
    expect(within(selector).getByRole('option', { name: 'Otros ingresos' })).toBeTruthy();
    expect(listFinancialCategories).toHaveBeenCalledWith('REVENUE', false);
  });

  it('registra el ingreso con la categoría elegida', async () => {
    pintar([]);

    const selector = await screen.findByLabelText('Categoría del ingreso');
    await waitFor(() => {
      expect(within(selector).getByRole('option', { name: 'Otros ingresos' })).toBeTruthy();
    });

    // Orden del formulario: proyecto, fecha, monto, moneda, categoría.
    const comboboxes = screen.getAllByRole('combobox');
    fireEvent.change(comboboxes[0], { target: { value: 'p1' } });
    fireEvent.change(selector, { target: { value: 'Otros ingresos' } });

    const fecha = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(fecha, { target: { value: '2026-03-10' } });

    const monto = screen.getByPlaceholderText('Monto');
    fireEvent.change(monto, { target: { value: '1500' } });

    fireEvent.click(screen.getByRole('button', { name: 'Registrar ingreso' }));

    await waitFor(() => {
      expect(createRevenueEntry).toHaveBeenCalled();
    });
    expect(createRevenueEntry.mock.calls[0][0].category).toBe('Otros ingresos');
  });

  it('muestra la categoría de cada ingreso en la tabla', async () => {
    pintar([ingreso({ id: 'r1', category: 'Servicios de consultoría' })]);

    await waitFor(() => {
      const filas = screen.getAllByRole('row');
      expect(filas.length).toBeGreaterThan(1);
    });
    const fila = screen.getAllByRole('row')[1];
    expect(within(fila).getByText('Servicios de consultoría')).toBeTruthy();
  });

  it('un ingreso anterior a D-4, sin categoría, se pinta como «Sin categoría»', async () => {
    pintar([ingreso({ id: 'r-viejo', category: null })]);

    await waitFor(() => {
      expect(screen.getByText('Sin categoría')).toBeTruthy();
    });
  });

  it('al editar un ingreso sin categoría, el desplegable deja dejarlo sin ella', async () => {
    pintar([ingreso({ id: 'r-viejo', category: null })]);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Editar' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));

    const selectores = await screen.findAllByLabelText('Categoría del ingreso');
    // El segundo es el del modal de edición; el primero, el del alta.
    const selectorEdicion = selectores[selectores.length - 1] as HTMLSelectElement;
    expect(selectorEdicion.value).toBe('');
    expect(within(selectorEdicion).getByRole('option', { name: 'Sin categoría' })).toBeTruthy();
  });

  it('si la categoría del ingreso ya no está activa, el desplegable la conserva', async () => {
    pintar([ingreso({ id: 'r-retirada', category: 'Línea retirada' })]);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Editar' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));

    const selectores = await screen.findAllByLabelText('Categoría del ingreso');
    const selectorEdicion = selectores[selectores.length - 1] as HTMLSelectElement;
    expect(selectorEdicion.value).toBe('Línea retirada');
    expect(within(selectorEdicion).getByRole('option', { name: /Línea retirada \(desactivada\)/ })).toBeTruthy();
  });
});
