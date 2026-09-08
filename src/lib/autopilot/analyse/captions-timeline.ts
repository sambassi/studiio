/**
 * A_4a — DE LA PAROLE DU RUSH À LA TIMELINE DU MONTAGE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ TROIS REPÈRES DE TEMPS, ET ILS NE SE RESSEMBLENT PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La transcription est datée dans le RUSH. Le plan, lui, entre dans un CLIP
 * — un fichier extrait par M3-F, dont le zéro n'est pas celui du rush. Et le
 * montage final réordonne ces plans, en les faisant parfois se recouvrir.
 *
 *   rush        →  clip.debutSecondes + plan.entreeSecondes
 *   clip        →  plan.dureeRetenueSecondes à partir de là
 *   montage     →  la somme des durées précédentes, MOINS les recouvrements
 *
 * Sauter une seule de ces conversions donne des sous-titres qui avancent
 * régulièrement à côté de la parole — le genre d'erreur qui passe sur deux
 * secondes de démonstration et saute aux yeux sur trente.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ LE MONTAGE PEUT RÉORDONNER, ET LES MOTS SUIVENT LE MONTAGE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Si le plan montre d'abord 15–18 s puis 5–10 s, les sous-titres disent
 * d'abord ce qui est dit à 15 s. Trier par temps de RUSH remettrait la
 * parole dans l'ordre du tournage — pas dans l'ordre de ce qu'on voit.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ AUCUN MOT INVENTÉ, ET AUCUN MOT COUPÉ EN DEUX
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un mot dont la coupe ne garde qu'un tiers s'afficherait quelques images :
 * un clignotement illisible. Il appartient donc au plan qui en montre LE
 * PLUS, et disparaît de l'autre. On ne complète jamais, on ne devine jamais.
 *
 * MODULE PUR : aucune base, aucun disque, aucun réseau, aucune horloge.
 */

export const VERSION_MOTEUR_CAPTIONS = 'caption-engine-v1';

/** Un mot daté dans le RUSH — la forme que rend la transcription. */
export interface MotSource {
  debutSecondes: number;
  finSecondes: number;
  texte: string;
}

/** Ce qu'un plan retient, tel que `MontagePlan.plans[]` le porte. */
export interface PlanProjection {
  /** Sa place dans le montage, à partir de 1. */
  ordre: number;
  /** Le clip dont il sort — c'est lui qui donne le repère du rush. */
  rangClip: number;
  /** Où entrer DANS LE CLIP, dont le repère commence à zéro. */
  entreeSecondes: number;
  dureeRetenueSecondes: number;
}

/** Où un clip commence DANS LE RUSH — ce que M3-F a mesuré. */
export interface ClipProjection {
  rang: number;
  debutSecondes: number;
}

/** Un mot daté dans le MONTAGE FINAL. */
export interface MotMonte {
  debutSecondes: number;
  finSecondes: number;
  texte: string;
  /** L'ordre du plan qui le porte — le segmenteur ne coupe pas à travers. */
  ordrePlan: number;
}

/**
 * ⚠️ UN MOT APPARTIENT AU PLAN QUI EN MONTRE LE PLUS.
 *
 * La moitié est le seul seuil qui ne demande pas d'arbitrage : en deçà,
 * l'autre plan en montre davantage, et c'est lui qui l'affichera.
 */
export const PART_MOT_RETENUE = 0.5;

/** En dessous, ce n'est plus un mot lisible mais un clignotement. */
export const DUREE_MOT_MIN_SECONDES = 0.06;

const arrondir = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Les mots de la parole, replacés sur la timeline du montage.
 *
 * `recouvrementSecondes` est le recouvrement d'A_3d — `0` pour une coupe
 * franche. Il déplace TOUS les plans à partir du second, et il ouvre une
 * zone où deux plans sont visibles en même temps.
 */
export function projeterMots(
  mots: readonly MotSource[],
  plans: readonly PlanProjection[],
  clips: readonly ClipProjection[],
  recouvrementSecondes = 0,
): MotMonte[] {
  const D = Math.max(0, recouvrementSecondes);
  const ordonnes = [...plans].sort((a, b) => a.ordre - b.ordre);
  const parRang = new Map(clips.map((c) => [c.rang, c.debutSecondes]));

  const sortie: MotMonte[] = [];
  let cumul = 0;

  ordonnes.forEach((p, i) => {
    const duree = Math.max(0, p.dureeRetenueSecondes);
    // ⚠️ LE DÉBUT FINAL RETIRE LES RECOUVREMENTS DÉJÀ CONSOMMÉS. Le plan `i`
    // commence `i x D` plus tôt que ce que la somme des durées suggère.
    const debutFinal = cumul - i * D;
    cumul += duree;

    const origine = parRang.get(p.rangClip);
    // Un plan dont le clip est inconnu ne peut pas être daté dans le rush :
    // on n'invente pas une origine, on n'affiche rien pour lui.
    if (origine === undefined) return;

    const fenetreDebut = origine + Math.max(0, p.entreeSecondes);
    const fenetreFin = fenetreDebut + duree;

    /* ⚠️ ON NE COUPE PAS LA PAROLE À LA MOITIÉ DE LA TRANSITION.
       Le réflexe est de partager la zone de recouvrement en deux et de faire
       taire chaque plan dans la moitié de l'autre. Mesuré : un mot prononcé
       entièrement dans la seconde moitié du plan sortant DISPARAÎT alors —
       de la parole réelle, perdue pour éviter une superposition.
       Chaque plan garde donc ses mots, avec leur timing naturel ; c'est la
       PISTE UNIQUE du segmenteur qui garantit qu'un seul bloc s'affiche à la
       fois, en faisant commencer le bloc entrant quand le précédent finit. */
    const emissionDebut = debutFinal;
    const emissionFin = debutFinal + duree;

    for (const m of mots) {
      const d = Math.max(m.debutSecondes, fenetreDebut);
      const f = Math.min(m.finSecondes, fenetreFin);
      if (!(d < f)) continue;

      const dureeMot = Math.max(0, m.finSecondes - m.debutSecondes);
      // Le mot appartient-il VRAIMENT à ce plan ?
      if (dureeMot > 0 && (f - d) / dureeMot < PART_MOT_RETENUE) continue;

      const debut = Math.max(emissionDebut, debutFinal + (d - fenetreDebut));
      const fin = Math.min(emissionFin, debutFinal + (f - fenetreDebut));
      if (!(fin - debut >= DUREE_MOT_MIN_SECONDES)) continue;

      sortie.push({
        debutSecondes: arrondir(debut),
        finSecondes: arrondir(fin),
        texte: m.texte,
        ordrePlan: p.ordre,
      });
    }
  });

  /* ⚠️ L'ORDRE DU MONTAGE, PAS CELUI DU TOURNAGE. Les plans ont déjà été
     parcourus dans l'ordre ; ce tri ne fait que départager deux mots d'un
     même plan, et il est stable sur le texte pour rester déterministe. */
  sortie.sort((a, b) => (a.debutSecondes - b.debutSecondes)
    || (a.finSecondes - b.finSecondes));
  return sortie;
}

/**
 * La durée réelle du montage, recouvrements compris.
 *
 * Écrite ici pour que le segmenteur et le générateur ASS n'aient pas à la
 * recalculer chacun de leur côté — deux calculs de la même chose finissent
 * toujours par diverger.
 */
export function dureeMontageSecondes(
  plans: readonly PlanProjection[], recouvrementSecondes = 0,
): number {
  const n = plans.length;
  if (n === 0) return 0;
  const somme = plans.reduce((t, p) => t + Math.max(0, p.dureeRetenueSecondes), 0);
  return arrondir(Math.max(0, somme - Math.max(0, recouvrementSecondes) * (n - 1)));
}
