/**
 * L'ASSISTANT ET LES CRÉDITS — ce qu'il sait, et ce qu'il ne doit pas savoir.
 */
import { describe, expect, it } from 'vitest';
import { TARIFS_DEFAUT } from '@/lib/tarifs/catalogue';
import {
  LIEN_ABONNEMENT, LIEN_RECHARGE, blocContexteCommercial, prixCitables,
} from '@/lib/chat/contexte-commercial';
import { NOMS_FOURNISSEURS_INTERDITS } from '@/lib/fournisseurs/messages-neutres';

const BASE = { plan: 'Pro', solde: 120, exempte: false, prix: prixCitables(TARIFS_DEFAUT) };

describe('bloc portefeuille de l’assistant', () => {
  it('porte le plan, le solde et les tarifs réels', () => {
    const b = blocContexteCommercial(BASE);
    expect(b).toContain('Plan : Pro');
    expect(b).toContain('Solde actuel : 120 crédits.');
    // Un tarif réel de la grille, avec son libellé Studiio et son unité.
    expect(b).toContain(`Reel (9:16) : ${TARIFS_DEFAUT['render.reel']}`);
    expect(b).toContain('crédits / rendu');
  });

  it('ne contient AUCUN coût fournisseur, AUCUNE marge, AUCUN nom de prestataire', () => {
    const b = blocContexteCommercial(BASE).toLowerCase();
    for (const n of NOMS_FOURNISSEURS_INTERDITS) expect(b, n).not.toContain(n);
    expect(b).not.toContain('marge');
    expect(b).not.toContain('usd');
    expect(b).not.toContain('coût fournisseur');
  });

  it('interdit d’inventer un prix et de lancer une opération payante', () => {
    const b = blocContexteCommercial(BASE);
    expect(b).toContain('N’annonce que les tarifs de la liste ci-dessus.');
    expect(b).toMatch(/Ne lance jamais une opération payante/);
    expect(b).toContain(LIEN_RECHARGE);
    expect(b).toContain(LIEN_ABONNEMENT);
  });

  it('énumère les gestes gratuits pour qu’ils ne soient pas facturés dans une estimation', () => {
    const b = blocContexteCommercial(BASE);
    for (const geste of ['naviguer', 'ouvrir un panneau', 'importer un média', 'pré-écoute']) {
      expect(b, geste).toContain(geste);
    }
  });

  it('solde illisible : aucun chiffre inventé', () => {
    const b = blocContexteCommercial({ ...BASE, solde: null });
    expect(b).toContain('Solde indisponible');
    expect(b).not.toMatch(/Solde actuel/);
  });

  it('compte de l’administration : aucun débit, aucune proposition de recharge', () => {
    const b = blocContexteCommercial({ ...BASE, exempte: true, solde: null });
    expect(b).toContain('aucune opération ne débite de crédits');
    expect(b).toContain('Ne propose jamais de recharge à ce compte.');
  });

  it('les tarifs citables suivent la grille en vigueur, pas les valeurs codées', () => {
    const grilleAdmin = { ...TARIFS_DEFAUT, 'render.reel': 42 };
    const p = prixCitables(grilleAdmin);
    expect(p.find((x) => x.libelle === 'Reel (9:16)')?.credits).toBe(42);
  });
});
