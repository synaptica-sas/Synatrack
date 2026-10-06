import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExpensesTab } from '../features/expenses/ExpensesTab';
import { estadoConversionDe } from '../utils/conversionStatus';
import type { Expense, Project } from '../services/api';

/**
 * R-026 — la pantalla de Gastos muestra los mismos avisos de conversión que el
 * resto del producto.
 *
 * Hasta R-026 Gastos convertía por su cuenta en el cliente con las tasas de hoy,
 * así que no tenía nada que avisar: ni sabía que un par no tenía tasa (sumaba el
 * importe sin convertir en silencio) ni que estaba valorando un gasto de marzo
 * con la tasa de octubre. Ahora convierte el backend, marca cada gasto y la
 * pantalla rotula lo que está a la vista con el mismo `ConversionNotice` que
 * usan Tablero, Portafolio y Detalle.
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

const proyecto = {
  id: 'p1',
  name: 'Proyecto Alpha',
  currency: 'USD',
  budget: '100000',
} as unknown as Project;

function gasto(id: string, o: Partial<Expense> = {}): Expense {
  return {
    id,
    projectId: 'p1',
    expenseDate: '2026-03-15',
    category: 'Viajes',
    amount: '4000000',
    currency: 'COP',
    description: null,
    createdAt: '',
    updatedAt: '',
    project: proyecto,
    baseAmount: 1000,
    baseCurrency: 'USD',
    conversionQuality: 'dated',
    ...o,
  } as unknown as Expense;
}

function pintar(expenses: Expense[]) {
  return render(
    <ExpensesTab
      expenses={expenses}
      projects={[proyecto]}
      loading={false}
      canWrite
      onReload={() => Promise.resolve()}
      onError={() => {}}
    />,
  );
}

// ── La agregación pura ───────────────────────────────────────────────────────

describe('estadoConversionDe — el aviso del subconjunto a la vista (R-026)', () => {
  it('no avisa nada cuando todo se valoró con su tasa fechada', () => {
    expect(estadoConversionDe([gasto('a'), gasto('b')])).toEqual({
      incomplete: false,
      missingPairs: [],
      approximateDates: false,
      undatedPairs: [],
    });
  });

  it('marca `approximateDates` cuando algún gasto se valoró a la tasa de hoy', () => {
    const estado = estadoConversionDe([
      gasto('a'),
      gasto('b', { conversionQuality: 'undated' }),
    ]);
    expect(estado.approximateDates).toBe(true);
    expect(estado.undatedPairs).toEqual(['COP->USD']);
    // Más leve que `incomplete`: el importe SÍ está convertido.
    expect(estado.incomplete).toBe(false);
  });

  it('marca `incomplete` cuando a algún gasto le falta la tasa', () => {
    const estado = estadoConversionDe([
      gasto('a'),
      gasto('b', { currency: 'JPY', conversionQuality: 'missing', baseAmount: 4000000 }),
    ]);
    expect(estado.incomplete).toBe(true);
    expect(estado.missingPairs).toEqual(['JPY->USD']);
  });

  it('no ensucia el aviso por un importe de 0, igual que el backend', () => {
    const estado = estadoConversionDe([
      gasto('a', { amount: '0', baseAmount: 0, conversionQuality: 'missing' }),
    ]);
    expect(estado.incomplete).toBe(false);
  });

  it('no repite el mismo par dos veces', () => {
    const estado = estadoConversionDe([
      gasto('a', { conversionQuality: 'undated' }),
      gasto('b', { conversionQuality: 'undated' }),
    ]);
    expect(estado.undatedPairs).toEqual(['COP->USD']);
  });
});

// ── El aviso en pantalla ─────────────────────────────────────────────────────

describe('ExpensesTab — avisos de conversión (R-026)', () => {
  it('no muestra ningún aviso cuando todos los gastos están bien fechados', () => {
    pintar([gasto('a'), gasto('b')]);
    expect(screen.queryByText('Cifras aproximadas')).not.toBeInTheDocument();
    expect(screen.queryByText('Valoración a la tasa de hoy')).not.toBeInTheDocument();
  });

  it('avisa "Cifras aproximadas" cuando falta la tasa de un gasto a la vista', () => {
    pintar([
      gasto('a'),
      gasto('b', { currency: 'JPY', conversionQuality: 'missing', baseAmount: 4000000 }),
    ]);
    expect(screen.getByText('Cifras aproximadas')).toBeInTheDocument();
    expect(screen.getByText(/de JPY a USD/)).toBeInTheDocument();
  });

  it('avisa "Valoración a la tasa de hoy" cuando falta el histórico de la fecha', () => {
    pintar([gasto('a', { conversionQuality: 'undated' })]);
    expect(screen.getByText('Valoración a la tasa de hoy')).toBeInTheDocument();
    expect(screen.queryByText('Cifras aproximadas')).not.toBeInTheDocument();
  });

  it('el total mostrado es la suma de los importes que convirtió el backend', () => {
    // Dos gastos del MISMO importe en COP pero de fechas con tasas distintas:
    // el backend los valoró en 1.000 y 800 USD. La pantalla debe mostrar 1.800,
    // que es lo que suma el Tablero, y no reconvertir nada por su cuenta.
    pintar([
      gasto('a', { expenseDate: '2026-03-15', baseAmount: 1000 }),
      gasto('b', { expenseDate: '2026-08-15', baseAmount: 800 }),
    ]);
    // El total general del pie de la tabla.
    expect(screen.getAllByText(/US\$\s?1\.800,00/).length).toBeGreaterThan(0);
  });
});
