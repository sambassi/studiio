/**
 * Ce que l'ecran annonce comme cout — sans jamais l'inventer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TROIS ETATS, PAS DEUX
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   1. `partner_cost_only`   -> « Frais partenaires uniquement », aucun nombre ;
 *   2. tarif serveur connu   -> « N crédits », le N de `tarifs_rendu` ;
 *   3. tarif inconnu         -> « Tarif confirmé au rendu ».
 *
 * Le troisieme etat est le plus important. L'ecran avait un prix code en
 * TypeScript et l'affichait comme certain ; il se trouvait juste. Un pilote
 * de deux videos double l'ecart si jamais il cesse de l'etre, et le
 * caractere « certain » de l'annonce n'a jamais rien eu de verifiable.
 *
 * Mieux vaut dire qu'on ne sait pas encore que d'affirmer un chiffre qu'on
 * n'a pas lu.
 */
import type { Politique } from './politique';
import { LIBELLE_PARTENAIRES } from './libelles';

/** Ce qu'on ecrit quand le serveur n'a pas (encore) donne son tarif. */
export const LIBELLE_TARIF_INCONNU = 'Tarif confirmé au rendu';

export type Tarifs = { reel: number; tv: number } | null;

/**
 * Normalise la reponse de `/api/render/tarifs`.
 *
 * Tout ce qui n'est pas deux nombres finis et positifs rend `null` : un tarif
 * partiel, une chaine, un `NaN` ou une reponse illisible signifient « je ne
 * sais pas », pas « c'est gratuit ».
 */
export function tarifsAffichables(valeur: unknown): Tarifs {
  if (!valeur || typeof valeur !== 'object') return null;
  const t = valeur as Record<string, unknown>;
  const reel = t.reel;
  const tv = t.tv;
  if (typeof reel !== 'number' || !Number.isFinite(reel) || reel < 0) return null;
  if (typeof tv !== 'number' || !Number.isFinite(tv) || tv < 0) return null;
  return { reel, tv };
}

/**
 * Le cout total annonce, en mots.
 *
 * `nombre` est le nombre de montages : un pilote de deux videos annonce le
 * total, pas le prix unitaire. Aucun calcul n'a lieu si le tarif est inconnu.
 */
export function annonceCout(
  politique: Politique,
  tarifs: Tarifs,
  format: 'reel' | 'tv',
  nombre: number,
): string {
  if (politique === 'partner_cost_only') return LIBELLE_PARTENAIRES;
  if (!tarifs) return LIBELLE_TARIF_INCONNU;
  const n = Number.isFinite(nombre) ? Math.max(1, Math.floor(nombre)) : 1;
  return `${tarifs[format] * n} crédits`;
}

/** « 2 vidéos », « 1 contenu » — le sujet de l'annonce, au bon nombre. */
export function libelleNombre(nombre: number): string {
  const n = Number.isFinite(nombre) ? Math.max(1, Math.floor(nombre)) : 1;
  return n > 1 ? `${n} vidéos` : '1 contenu';
}
