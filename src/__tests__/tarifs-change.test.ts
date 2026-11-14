import { describe, expect, it } from 'vitest';
import {
  JOURS_TAUX_PERIME, SOURCE_REFERENCE, libelleTaux, normaliserTaux, tauxPerime, tauxValide,
} from '@/lib/tarifs/change';

const LE = '2026-11-11';
const MAINTENANT = new Date('2026-11-12T03:00:00Z');

describe('taux de change', () => {
  it('refuse un taux hors des bornes de bon sens', () => {
    expect(tauxValide(0.83)).toBe(true);
    expect(tauxValide(0)).toBe(false);
    expect(tauxValide(42)).toBe(false);
    expect(tauxValide('0.83')).toBe(false);
  });

  it('refuse un taux sans date valide — un taux sans date n’est pas un taux', () => {
    expect(normaliserTaux({ chfParUsd: 0.83 })).toBeNull();
    expect(normaliserTaux({ chfParUsd: 0.83, le: '11/11/2026' })).toBeNull();
    expect(normaliserTaux({ chfParUsd: 0.83, le: LE })?.chfParUsd).toBe(0.83);
  });

  it('attribue la source de référence quand elle manque, jamais une source vide', () => {
    expect(normaliserTaux({ chfParUsd: 0.83, le: LE })?.source).toBe(SOURCE_REFERENCE);
    expect(normaliserTaux({ chfParUsd: 0.83, le: LE, source: 'Saisie admin' })?.source).toBe('Saisie admin');
  });

  it('signale un taux périmé sans le supprimer', () => {
    const vieux = { chfParUsd: 0.83, le: '2026-01-01', source: 'x' };
    expect(tauxPerime(vieux, MAINTENANT)).toBe(true);
    expect(tauxPerime({ chfParUsd: 0.83, le: LE, source: 'x' }, MAINTENANT)).toBe(false);
    expect(libelleTaux(vieux, MAINTENANT)).toContain('PÉRIMÉ');
  });

  it('dit clairement qu’aucun taux n’est enregistré', () => {
    expect(libelleTaux(null)).toContain('Aucun taux');
    expect(tauxPerime(null)).toBe(false);
  });

  it('borne la péremption à 30 jours', () => {
    expect(JOURS_TAUX_PERIME).toBe(30);
  });
});
