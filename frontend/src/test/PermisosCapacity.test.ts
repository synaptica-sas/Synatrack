import { describe, it, expect } from 'vitest';
import { visibleGroupsFor } from '../config/sidebar';

/**
 * Qué pestañas ve cada rol según CONTRATO §4. Los permisos reales los sirve el
 * backend (`GET /api/auth/permissions`); aquí se fijan los relevantes para que
 * un cambio del menú que contradiga el contrato rompa la prueba.
 */
const PERMISOS = {
  ADMIN: ['capacity:read', 'capacity:config', 'assignments:write', 'holidays:read', 'holidays:write', 'stats:read', 'projects:read'],
  PM: ['capacity:read', 'holidays:read', 'stats:read', 'projects:read'],
  FINANCE: ['capacity:read', 'holidays:read', 'stats:read'],
  COMMERCIAL: ['capacity:read', 'holidays:read'],
  CONSULTANT: ['holidays:read', 'time:read'],
  VIEWER: ['holidays:read', 'projects:read', 'time:read'],
} as const;

function pestanas(rol: keyof typeof PERMISOS): string[] {
  return visibleGroupsFor([...PERMISOS[rol]]).flatMap((g) => g.tabs.map((t) => t.id));
}

describe('menú lateral por rol', () => {
  it('COMMERCIAL ve Capacidad; VIEWER y CONSULTANT no', () => {
    expect(pestanas('COMMERCIAL')).toContain('capacity');
    expect(pestanas('VIEWER')).not.toContain('capacity');
    expect(pestanas('CONSULTANT')).not.toContain('capacity');
  });

  it('Feriados solo aparece para ADMIN', () => {
    expect(pestanas('ADMIN')).toContain('holidays');
    for (const rol of ['PM', 'FINANCE', 'COMMERCIAL', 'CONSULTANT', 'VIEWER'] as const) {
      expect(pestanas(rol)).not.toContain('holidays');
    }
  });

  it('Parámetros y jornada sigue siendo solo de ADMIN', () => {
    expect(pestanas('ADMIN')).toContain('workdayConfig');
    expect(pestanas('PM')).not.toContain('workdayConfig');
  });
});
