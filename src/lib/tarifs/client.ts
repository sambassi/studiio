'use client';
/**
 * Les prix vus par les ÉCRANS — `useTarifs()`.
 *
 * Lit `GET /api/tarifs` (la grille que débitent les routes). Pendant le
 * chargement, ou si la lecture échoue, l'écran affiche les prix de repli
 * (`TARIFS_DEFAUT`, ceux d'avant la configuration) — jamais 0. Le serveur
 * recalcule toujours le prix au débit : l'écran informe, il ne décide pas.
 */
import { useEffect, useState } from 'react';
import { TARIFS_DEFAUT, normaliserGrille, type CleTarif, type GrilleTarifs } from './catalogue';

export interface TarifsEcran {
  prix: GrilleTarifs;
  /** Administrateur : prix public affiché, coût Studiio 0. */
  exempte: boolean;
  charge: boolean;
}

let memo: Promise<{ prix: GrilleTarifs; exempte: boolean }> | null = null;

/** Tests uniquement. */
export function reinitialiserTarifsEcran(): void { memo = null; }

export function chargerTarifsEcran(): Promise<{ prix: GrilleTarifs; exempte: boolean }> {
  if (!memo) {
    memo = fetch('/api/tarifs', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => ({ prix: normaliserGrille(j?.prix), exempte: j?.exempte === true }))
      .catch(() => ({ prix: { ...TARIFS_DEFAUT }, exempte: false }));
    // Une page ouverte longtemps relit la grille au plus toutes les 30 s.
    const courant = memo;
    setTimeout(() => { if (memo === courant) memo = null; }, 30_000);
  }
  return memo;
}

export function useTarifs(): TarifsEcran {
  const [etat, setEtat] = useState<TarifsEcran>({ prix: { ...TARIFS_DEFAUT }, exempte: false, charge: false });
  useEffect(() => {
    let actif = true;
    chargerTarifsEcran().then((t) => { if (actif) setEtat({ ...t, charge: true }); });
    return () => { actif = false; };
  }, []);
  return etat;
}

export function libelleCredits(n: number): string {
  return `${n} crédit${n > 1 ? 's' : ''}`;
}

/** « 40 crédits » ou, pour un admin, « 40 crédits — votre coût : 0 ». */
export function libellePrix(t: Pick<TarifsEcran, 'prix' | 'exempte'>, cle: CleTarif): string {
  const p = t.prix[cle];
  return t.exempte ? `${libelleCredits(p)} — votre coût Studiio : 0 crédit` : libelleCredits(p);
}
