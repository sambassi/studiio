/**
 * A_3d — LE CALCUL DES RECOUVREMENTS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ UNE DURÉE UNIQUE POUR TOUTES LES JONCTIONS, ET C'EST UN CHOIX
 * ─────────────────────────────────────────────────────────────────────────
 *
 * On pourrait borner chaque jonction par ses deux plans et obtenir des durées
 * différentes d'une jonction à l'autre. Deux raisons de ne pas le faire :
 *
 *   1. Un plan du MILIEU est mordu des DEUX côtés. Il faudrait garantir
 *      `D(i-1) + D(i) <= d(i)` — une contrainte couplée, où réduire une
 *      jonction en autorise une autre, et dont aucune formule locale ne sort.
 *   2. Une jonction qui dure 0 doit redevenir une coupe. Le graphe mêlerait
 *      alors `concat` et `xfade`, deux façons d'assembler qui ne s'écrivent
 *      pas de la même manière — pour un résultat que personne n'a demandé :
 *      un montage dont les raccords n'ont pas le même rythme.
 *
 * La durée est donc UNIQUE, bornée par le plan le plus court. Elle est
 * conservatrice, prévisible, et elle rend `D(i-1) + D(i) <= d(i)` vrai par
 * construction tant que `PART_MAX_CLIP <= 0.5`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ LE RECOUVREMENT RACCOURCIT LE MONTAGE, ET IL FAUT LE DIRE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `resultatConforme` compare la durée MESURÉE du fichier à celle du plan.
 * C'est précisément l'obstacle qui avait fait écarter `xfade` : un montage
 * recouvert est plus court, donc refusé. Ce module rend ce raccourcissement
 * EXPLICITE, pour qu'il soit retiré de la durée attendue — la vérification
 * devient alors plus stricte, puisqu'elle contrôle aussi que le recouvrement
 * a bien eu lieu.
 *
 * MODULE PUR : il calcule des nombres, il n'écrit aucun filtre.
 */

/** Au plus cette part du plan le plus court. `<= 0.5` par nécessité. */
export const PART_MAX_CLIP = 0.4;

/** En deçà, on ne voit rien : la transition redevient une coupe. */
export const DUREE_MIN_SECONDES = 0.15;

/**
 * Au-delà, le son des rushes passe en courbes exponentielles.
 *
 * ⚠️ LE FONDU AUDIO DURE EXACTEMENT COMME LE RECOUVREMENT VIDÉO. Un fondu
 * audio plus court désynchroniserait l'image et le son un peu plus à chaque
 * jonction, puisque les deux pistes ne se raccourciraient pas d'autant. La
 * seule façon de raccourcir le CHEVAUCHEMENT PERÇU sans toucher à la durée
 * est donc de changer la COURBE : `exp` bascule vite, et deux voix ne se
 * superposent pleinement que sur une fraction du recouvrement.
 */
export const SEUIL_COURBE_EXP_SECONDES = 0.4;

export interface PlanTransitions {
  /** La durée du recouvrement, en secondes. `0` = coupe. */
  dureeSecondes: number;
  /** L'instant, dans le flux déjà assemblé, où commence chaque recouvrement. */
  offsetsSecondes: readonly number[];
  /** Ce que le montage perd au total. `(n-1) x duree`. */
  recoupementTotalSecondes: number;
  /** La durée demandée a été rabotée par le plan le plus court. */
  reduite: boolean;
  /** Trop courte pour se voir : le montage repasse en coupe. */
  abandonnee: boolean;
  /** La courbe du fondu audio, choisie par la durée. */
  courbeAudio: 'tri' | 'exp';
}

export const PLAN_TRANSITIONS_COUPE: PlanTransitions = Object.freeze({
  dureeSecondes: 0,
  offsetsSecondes: Object.freeze([]) as readonly number[],
  recoupementTotalSecondes: 0,
  reduite: false,
  abandonnee: false,
  courbeAudio: 'tri',
});

/**
 * Les instants de recouvrement, calculés cumulativement.
 *
 * ⚠️ AUCUNE CONSTANTE PAR INDICE. Après une jonction, le flux assemblé dure
 * `T - D + d(suivant)` — pas `somme des durées`. Écrire l'offset comme
 * « début du clip i moins D » marche pour deux plans et se décale d'un
 * recouvrement de plus à chaque jonction suivante ; c'est l'erreur classique
 * des chaînes `xfade`, et elle ne se voit qu'à partir du troisième plan.
 */
export function planTransitions(
  dureesClips: readonly number[], dureeDemandeeSecondes: number,
): PlanTransitions {
  const n = dureesClips.length;
  // Un seul plan n'a aucune jonction : la transition ne s'applique nulle part.
  if (n < 2 || dureeDemandeeSecondes <= 0) return PLAN_TRANSITIONS_COUPE;

  const plusCourt = Math.min(...dureesClips);
  const plafond = PART_MAX_CLIP * plusCourt;
  const duree = Math.min(dureeDemandeeSecondes, plafond);
  const reduite = duree < dureeDemandeeSecondes - 1e-9;

  if (duree < DUREE_MIN_SECONDES) {
    return { ...PLAN_TRANSITIONS_COUPE, reduite, abandonnee: true };
  }

  const offsets: number[] = [];
  let assemble = dureesClips[0];
  for (let i = 0; i < n - 1; i += 1) {
    offsets.push(assemble - duree);
    assemble = assemble - duree + dureesClips[i + 1];
  }

  return {
    dureeSecondes: duree,
    offsetsSecondes: offsets,
    recoupementTotalSecondes: duree * (n - 1),
    reduite,
    abandonnee: false,
    courbeAudio: duree > SEUIL_COURBE_EXP_SECONDES ? 'exp' : 'tri',
  };
}
