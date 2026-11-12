/**
 * GARDE DE COÛT — pas de vente à l'aveugle, et aucun blocage aujourd'hui.
 */
import { describe, expect, it } from 'vitest';
import { CLES_TARIF, TARIFS_DEFAUT } from '@/lib/tarifs/catalogue';
import {
  BLOCAGE_COUT_INCONNU_DEFAUT, MESSAGE_REFUS_COUT, operationAutorisee,
} from '@/lib/tarifs/garde-cout';
import { NOMS_FOURNISSEURS_INTERDITS } from '@/lib/fournisseurs/messages-neutres';

describe('garde de coût', () => {
  it('est active par défaut', () => {
    expect(BLOCAGE_COUT_INCONNU_DEFAUT).toBe(true);
  });

  it('⚠️ ne bloque AUCUN tarif actuel : activer la garde ne change rien aujourd’hui', () => {
    for (const cle of CLES_TARIF) {
      const v = operationAutorisee({ cle, credits: TARIFS_DEFAUT[cle] || 1, blocage: true });
      expect(v.autorisee, cle).toBe(true);
    }
  });

  it('refuse une opération payante dont le coût n’est pas vérifié', () => {
    const v = operationAutorisee({ cle: 'tarif.futur' as never, credits: 20, blocage: true });
    expect(v.autorisee).toBe(false);
    expect(v.motif).toBe('cout_inconnu');
    expect(v.message).toBe(MESSAGE_REFUS_COUT);
    // Le détail va aux journaux, pas à l'utilisateur.
    expect(v.detail).toContain('tarif.futur');
  });

  it('ne bloque jamais une opération à 0 crédit — gratuite ou manuelle', () => {
    for (const credits of [0, -1, Number.NaN]) {
      expect(operationAutorisee({ cle: 'tarif.futur' as never, credits, blocage: true }).autorisee, String(credits)).toBe(true);
    }
  });

  it('garde désactivée : comportement d’avant, rien n’est refusé', () => {
    expect(operationAutorisee({ cle: 'tarif.futur' as never, credits: 20, blocage: false }).autorisee).toBe(true);
  });

  it('le message ne nomme aucun fournisseur', () => {
    const m = MESSAGE_REFUS_COUT.toLowerCase();
    for (const n of NOMS_FOURNISSEURS_INTERDITS) expect(m, n).not.toContain(n);
    expect(MESSAGE_REFUS_COUT).toContain('Aucun crédit n’a été débité');
  });
});
