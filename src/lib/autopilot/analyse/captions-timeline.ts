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

/**
 * D'OU VIENT LA PAROLE D'UN SEGMENT — A_7c.
 *
 * ⚠️ SANS ELLE, TOUS LES MOTS VIENDRAIENT DU MEME TRANSCRIPT. Le repere d'un
 * plan se lisait sur `clips` : rang du clip -> instant dans LE rush. Un
 * montage multi-rush n'a pas UN rush, et le rang n'est unique qu'a
 * l'interieur d'un jeu — le rang 1 existe dans A comme dans B. Chercher la
 * phrase d'un segment de B dans le transcript de A donnerait un texte qui ne
 * correspond a rien de ce qu'on entend, sans qu'aucune erreur ne le dise.
 */
export interface SourceProjection {
  clipSetId: string;
  /** Le debut du passage DANS SON rush — A_7a l'a deja calcule. */
  debutSourceSecondes: number;
  finSourceSecondes: number;
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
  /**
   * A_7c — la provenance, quand le plan la porte.
   *
   * ⚠️ ABSENTE = LE CHEMIN HISTORIQUE, exactement. Un plan d'avant A_7a n'en a
   * pas : son repere se lit sur `clips`, comme avant, et la projection est
   * identique au millieme de seconde pres.
   */
  source?: SourceProjection;
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
  /**
   * A_7c — LA PAROLE DE CHAQUE RUSH, indexee par son jeu de clips.
   *
   * ⚠️ ABSENTE, RIEN NE CHANGE : `mots` reste la seule matiere, et le repere
   * se lit sur `clips`. Presente, un segment qui declare sa source y prend SA
   * transcription et nulle part ailleurs — un segment de B ne peut pas
   * afficher une phrase de A, meme si les deux passages tombent aux memes
   * secondes de leurs rushes respectifs.
   *
   * ⚠️ UN SEGMENT DONT LA SOURCE N'A PAS DE TRANSCRIPT N'AFFICHE RIEN. Se
   * rabattre sur `mots` lui ferait dire les phrases d'un autre rush : mieux
   * vaut un plan muet qu'un sous-titre faux.
   */
  motsParSource?: ReadonlyMap<string, readonly MotSource[]> | null,
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

    /* ── OU CHERCHER LA PAROLE DE CE SEGMENT ─────────────────────────────
       Deux reperes possibles, et un seul est juste pour un plan donne :

         • A_7a : le segment DIT sa fenetre dans son rush, et dit de quel jeu
           elle vient. Rien a deduire, rien a croiser ;
         • historique : le rang du clip, croise avec `clips`, donne l'instant
           dans LE rush — c'est le chemin de tous les plans d'avant A_7a. */
    const src = p.source;
    const motsDuPlan = src && motsParSource
      ? motsParSource.get(src.clipSetId)
      : mots;
    /* Une source sans transcription n'affiche rien. Se rabattre sur `mots`
       lui ferait dire les phrases d'un autre rush. */
    if (motsDuPlan === undefined) return;

    let fenetreDebut: number;
    let fenetreFin: number;
    if (src && motsParSource) {
      fenetreDebut = src.debutSourceSecondes;
      fenetreFin = src.finSourceSecondes;
    } else {
      const origine = parRang.get(p.rangClip);
      // Un plan dont le clip est inconnu ne peut pas être daté dans le rush :
      // on n'invente pas une origine, on n'affiche rien pour lui.
      if (origine === undefined) return;
      fenetreDebut = origine + Math.max(0, p.entreeSecondes);
      fenetreFin = fenetreDebut + duree;
    }

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

    for (const m of motsDuPlan) {
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
