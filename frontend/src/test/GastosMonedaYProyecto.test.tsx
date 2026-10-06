import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ExpensesTab } from '../features/expenses/ExpensesTab';
import type { Expense, Project } from '../services/api';

/**
 * Los dos pendientes de la pantalla de Gastos del backlog de usuario:
 *
 * - **R-026**: la vista agrupada se presentaba siempre en USD, sin mirar la
 *   moneda del proyecto. (La otra mitad del ítem —que la conversión no cuadraba
 *   con el importe original— se resolvió el 2026-10-05 valorando cada gasto a la
 *   tasa de su fecha; aquí no se vuelve a tocar.)
 * - **R-027**: el proyecto se buscaba escribiéndolo a mano en un `<input>`, en
 *   vez de elegirlo de una lista como en Portafolio y Proyectos.
 */

vi.mock('../services/api', async () => {
  const actual = await vi.importActual<typeof import('../services/api')>('../services/api');
  return {
    ...actual,
    listFinancialCategories: vi.fn().mockResolvedValue([]),
    createExpense: vi.fn(),
    updateExpense: vi.fn(),
    deleteExpense: vi.fn(),
  };
});

const proyectoCOP = { id: 'p-cop', name: 'Proyecto Pesos', currency: 'COP' } as unknown as Project;
const proyectoEUR = { id: 'p-eur', name: 'Proyecto Euros', currency: 'EUR' } as unknown as Project;

function gasto(id: string, proyecto: Project, amount: string): Expense {
  return {
    id,
    projectId: proyecto.id,
    expenseDate: '2026-04-01',
    category: 'Viajes',
    amount,
    currency: proyecto.currency,
    description: null,
    createdAt: '',
    updatedAt: '',
    project: { id: proyecto.id, name: proyecto.name, currency: proyecto.currency },
  } as unknown as Expense;
}

function pintar(expenses: Expense[], projects: Project[]) {
  return render(
    <ExpensesTab
      expenses={expenses}
      projects={projects}
      loading={false}
      canWrite
      onReload={() => Promise.resolve()}
      onError={() => {}}
    />,
  );
}

/**
 * Las opciones desplegadas del buscador de proyecto. Hay que acotar la búsqueda
 * al desplegable: el nombre del proyecto también sale en la tabla de resumen.
 */
function opcionesDesplegadas() {
  const dropdown = document.querySelector('.searchable-select-dropdown');
  if (!dropdown) throw new Error('El desplegable de proyecto no está abierto');
  return within(dropdown as HTMLElement);
}

/** El selector de moneda base, por su etiqueta visible. */
function selectorMonedaBase() {
  return screen.getByLabelText('Moneda base') as HTMLSelectElement;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Moneda de presentación por defecto en Gastos (R-026)', () => {
  it('arranca en la moneda del proyecto, no en USD', async () => {
    pintar([gasto('e1', proyectoCOP, '1000000')], [proyectoCOP]);

    await waitFor(() => {
      expect(selectorMonedaBase().value).toBe('COP');
    });
  });

  it('ofrece esa moneda en la lista aunque no sea una de las fijas', async () => {
    const proyectoPEN = { id: 'p-pen', name: 'Proyecto Soles', currency: 'PEN' } as unknown as Project;
    pintar([gasto('e1', proyectoPEN, '500')], [proyectoPEN]);

    await waitFor(() => {
      expect(selectorMonedaBase().value).toBe('PEN');
    });
    // Si no se añadiera a las opciones, el `select` se quedaría en blanco.
    const opciones = Array.from(selectorMonedaBase().options).map((o) => o.value);
    expect(opciones).toContain('PEN');
  });

  it('cae al respaldo cuando hay proyectos de monedas distintas a la vez', async () => {
    pintar(
      [gasto('e1', proyectoCOP, '1000000'), gasto('e2', proyectoEUR, '800')],
      [proyectoCOP, proyectoEUR],
    );

    await waitFor(() => {
      expect(selectorMonedaBase().value).toBe('USD');
    });
  });

  it('respeta la moneda que elija el usuario por encima de la del proyecto', async () => {
    pintar([gasto('e1', proyectoCOP, '1000000')], [proyectoCOP]);

    await waitFor(() => {
      expect(selectorMonedaBase().value).toBe('COP');
    });
    fireEvent.change(selectorMonedaBase(), { target: { value: 'USD' } });
    expect(selectorMonedaBase().value).toBe('USD');
  });
});

describe('Buscador de proyecto en Gastos (R-027)', () => {
  it('es un desplegable con los proyectos, no un campo de texto suelto', async () => {
    pintar(
      [gasto('e1', proyectoCOP, '1000000'), gasto('e2', proyectoEUR, '800')],
      [proyectoCOP, proyectoEUR],
    );

    const disparador = await screen.findByPlaceholderText('Buscar o escribir proyecto...');
    // El antiguo `<input type="search">` ya no está.
    expect(screen.queryByPlaceholderText('Buscar proyecto, categoría…')).toBeNull();

    // Al abrirlo salen los proyectos como opciones elegibles.
    fireEvent.click(disparador);
    expect(opcionesDesplegadas().getByText('Proyecto Pesos')).toBeTruthy();
    expect(opcionesDesplegadas().getByText('Proyecto Euros')).toBeTruthy();
  });

  it('al elegir un proyecto de la lista, la vista se queda solo con sus gastos', async () => {
    pintar(
      [gasto('e1', proyectoCOP, '1000000'), gasto('e2', proyectoEUR, '800')],
      [proyectoCOP, proyectoEUR],
    );

    const disparador = await screen.findByPlaceholderText('Buscar o escribir proyecto...');
    fireEvent.click(disparador);
    fireEvent.click(opcionesDesplegadas().getByText('Proyecto Euros'));

    // Filtrado a un solo proyecto: la moneda por defecto pasa a ser la suya,
    // que es justo la unión de R-026 con R-027.
    await waitFor(() => {
      expect(selectorMonedaBase().value).toBe('EUR');
    });
  });
});
