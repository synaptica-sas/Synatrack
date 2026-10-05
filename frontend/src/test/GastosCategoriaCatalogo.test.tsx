import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ExpensesTab } from '../features/expenses/ExpensesTab';
import type { Expense, Project } from '../services/api';

/**
 * Las categorías de gasto salen del catálogo editable (decisión de negocio D-4).
 *
 * Hasta D-4 eran una constante en este mismo archivo. Lo que importa comprobar
 * es que **nada se rompió al moverlas**: el desplegable ahora refleja lo que hay
 * en la base, y si la API falla se recurre a las siete categorías de siempre en
 * vez de dejar el formulario sin opciones.
 */

const listFinancialCategories = vi.fn();

vi.mock('../services/api', async () => {
  const actual = await vi.importActual<typeof import('../services/api')>('../services/api');
  return {
    ...actual,
    listFinancialCategories: (...args: unknown[]) => listFinancialCategories(...args),
    createExpense: vi.fn(),
    updateExpense: vi.fn(),
    deleteExpense: vi.fn(),
  };
});

const proyecto = { id: 'p1', name: 'Proyecto Alpha', currency: 'USD' } as unknown as Project;

const gasto = {
  id: 'e1',
  projectId: 'p1',
  expenseDate: '2026-04-01',
  category: 'Viajes',
  amount: '500',
  currency: 'USD',
  description: null,
  createdAt: '',
  updatedAt: '',
} as unknown as Expense;

function pintar() {
  return render(
    <ExpensesTab
      expenses={[gasto]}
      projects={[proyecto]}
      loading={false}
      canWrite
      onReload={() => Promise.resolve()}
      onError={() => {}}
    />,
  );
}

async function abrirFormulario() {
  pintar();
  await waitFor(() => {
    expect(screen.getByRole('button', { name: '+ Nuevo gasto' })).toBeTruthy();
  });
  fireEvent.click(screen.getByRole('button', { name: '+ Nuevo gasto' }));
  return screen.findByLabelText('Categoría del gasto');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Categorías de gasto desde el catálogo (D-4)', () => {
  it('el desplegable usa las categorías que devuelve la API, no la lista del código', async () => {
    listFinancialCategories.mockResolvedValue([
      { id: 'g1', type: 'EXPENSE', name: 'Viajes', active: true, sortOrder: 1, createdAt: '', updatedAt: '' },
      { id: 'g2', type: 'EXPENSE', name: 'Formación', active: true, sortOrder: 2, createdAt: '', updatedAt: '' },
    ]);

    const selector = await abrirFormulario();

    await waitFor(() => {
      expect(within(selector).getByRole('option', { name: 'Formación' })).toBeTruthy();
    });
    // "Formación" no está en la lista de respaldo: solo puede venir del catálogo.
    expect(within(selector).queryByRole('option', { name: 'Alojamiento' })).toBeNull();
    expect(listFinancialCategories).toHaveBeenCalledWith('EXPENSE', false);
  });

  it('si el catálogo falla, el formulario cae a las siete categorías de siempre', async () => {
    listFinancialCategories.mockRejectedValue(new Error('500 sin conexión'));

    const selector = await abrirFormulario();

    await waitFor(() => {
      expect(within(selector).getByRole('option', { name: 'Viajes' })).toBeTruthy();
    });
    for (const esperada of [
      'Viajes',
      'Alojamiento',
      'Alimentacion',
      'Transporte',
      'Software',
      'Servicios',
      'Otros',
    ]) {
      expect(within(selector).getByRole('option', { name: esperada })).toBeTruthy();
    }
  });

  it('un gasto cuya categoría ya no está en el catálogo se puede seguir editando', async () => {
    listFinancialCategories.mockResolvedValue([
      { id: 'g2', type: 'EXPENSE', name: 'Formación', active: true, sortOrder: 2, createdAt: '', updatedAt: '' },
    ]);

    pintar();

    // Los gastos se listan agrupados y plegados: hay que desplegar el grupo
    // para llegar al botón de editar de cada línea.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Expandir detalle de/ })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: /Expandir detalle de/ }));

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Editar gasto/ }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole('button', { name: /Editar gasto/ })[0]);

    const selectores = await screen.findAllByLabelText('Categoría del gasto');
    const selector = selectores[selectores.length - 1] as HTMLSelectElement;
    expect(selector.value).toBe('Viajes');
    expect(within(selector).getByRole('option', { name: /Viajes \(fuera del catálogo\)/ })).toBeTruthy();
  });
});
