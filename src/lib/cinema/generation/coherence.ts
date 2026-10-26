/**
 * COHERENCE VISUELLE D'UN PERSONNAGE — comparer deux plans, honnetement.
 *
 * ⚠️ CE MODULE NE GARANTIT RIEN. Il prepare la COMPARAISON — le mecanisme —
 * sans pretendre juger une identite visuelle reelle. Trois raisons :
 *
 *  1. Le seul fournisseur ACTIF (`simule`) ne genere pas une identite
 *     visuelle : il peint un aplat de couleur derive d'un hash de texte. Que
 *     deux plans du meme personnage portent la MEME couleur prouve que le
 *     MECANISME de comparaison fonctionne (il distingue bien « meme
 *     personnage » de « personnage different ») — ca ne prouve RIEN sur un
 *     visage, un vetement ni une continuite reels.
 *  2. « Visage » et « vetements » demandent une evaluation VISUELLE — humaine
 *     ou par un modele de vision — qu'aucun fournisseur de ce lot ne fait.
 *     Ces deux axes restent `'non_evalue'` tant qu'un vrai fournisseur n'est
 *     pas branche ET qu'une evaluation reelle n'a pas ete menee.
 *  3. « Continuite entre scenes » EST mesurable des aujourd'hui, sans IA :
 *     deux plans ont-ils ete generes depuis la MEME VERSION de reference du
 *     personnage (`PlanCinema.referencesUtilisees`, pose par
 *     `generation/atelier.ts`) ? Une reference changee entre deux scenes est
 *     un fait verifiable, pas une opinion visuelle.
 *
 * Toute fonction de ce fichier qui rend `true` le fait sur un fait VERIFIE
 * (meme id de reference, meme hash) — jamais sur une inference.
 */
import { couleurIdentite } from '@/lib/cinema/generation/simule';
import type { Film, MediaPlan, PlanCinema, SceneCinema } from '@/lib/cinema/types';

export type AxeEvaluation = 'identique' | 'different' | 'non_evalue';

export interface PlanGenereDuPersonnage {
  sceneId: string;
  sceneIndex: number;
  planId: string;
  media: MediaPlan;
  /** Version de reference utilisee pour CE personnage, dans CE plan — `null` si non trace. */
  referenceUtilisee: string | null;
}

/** Les plans du film ou ce personnage est present ET porte un media GENERE. */
export function plansGeneresDuPersonnage(film: Film, personnageId: string): PlanGenereDuPersonnage[] {
  const perso = film.personnages.find((p) => p.id === personnageId);
  if (!perso) return [];
  const out: PlanGenereDuPersonnage[] = [];
  for (const scene of film.scenes) {
    for (const plan of scene.plans) {
      if (!plan.personnages.includes(personnageId)) continue;
      if (!plan.media || plan.media.origine !== 'genere') continue;
      // `referencesUtilisees` recense les references de TOUS les personnages
      // presents dans ce plan, dans le meme ordre que `plan.personnages` au
      // moment de la generation — on y retrouve celle DE CE personnage par
      // position, le seul lien disponible sans sur-structurer la trace.
      const position = plan.personnages.indexOf(personnageId);
      // Chaine vide = personnage present mais sans reference active au
      // moment de la generation (voir `atelier.ts`) : traite comme non trace.
      const referenceUtilisee = plan.referencesUtilisees?.[position] || null;
      out.push({ sceneId: scene.id, sceneIndex: scene.index, planId: plan.id, media: plan.media, referenceUtilisee });
    }
  }
  return out;
}

export interface ComparaisonPaire {
  planA: string;
  sceneA: string;
  planB: string;
  sceneB: string;
  /** Meme version de reference utilisee pour les DEUX generations ? `null` = non trace pour l'une des deux. */
  continuiteReference: boolean | null;
  /**
   * Signal du fournisseur SIMULE uniquement (`null` sinon) : les deux medias
   * portent-ils la MEME couleur d'identite ? Preuve de MECANISME, pas de
   * ressemblance visuelle — voir l'en-tete du fichier.
   */
  signalSimuleIdentique: boolean | null;
  visage: AxeEvaluation;
  vetements: AxeEvaluation;
}

export interface RapportCoherencePersonnage {
  personnageId: string;
  nbPlansGeneres: number;
  paires: ComparaisonPaire[];
  /** Vrai seulement si AUCUNE paire ne contredit la continuite de reference tracee. */
  continuiteGlobale: boolean | null;
  /**
   * TOUJOURS false dans l'etat de ce lot — aucune generation reelle,
   * aucune evaluation visuelle. Change le jour, et seulement le jour, ou les
   * deux existent.
   */
  coherenceVisuelleGarantie: false;
  avertissement: string;
}

export const AVERTISSEMENT_COHERENCE =
  'Aucune coherence visuelle n’est garantie : ce rapport compare des traces (reference utilisee, couleur du fournisseur simule), pas des visages ni des vetements reels. Une evaluation visuelle reelle exige un fournisseur de generation reellement branche.';

function comparerPaire(a: PlanGenereDuPersonnage, b: PlanGenereDuPersonnage): ComparaisonPaire {
  const continuiteReference = a.referenceUtilisee && b.referenceUtilisee
    ? a.referenceUtilisee === b.referenceUtilisee
    : null;

  return {
    planA: a.planId, sceneA: a.sceneId, planB: b.planId, sceneB: b.sceneId,
    continuiteReference,
    // Toujours `null` ICI : comparer des couleurs exige le TEXTE de
    // reference, que ce rapport automatique ne lit pas (voir
    // `signalIdentiteSimulee`, appelee explicitement par le test qui a ce
    // texte sous la main) — jamais une comparaison de pixels devinee.
    signalSimuleIdentique: null,
    visage: 'non_evalue',
    vetements: 'non_evalue',
  };
}

/**
 * Le rapport de continuite d'un personnage sur tout le film : chaque paire
 * de plans generes ou il figure, comparee sur ce qui est VERIFIABLE
 * aujourd'hui (la version de reference) — jamais sur une ressemblance
 * visuelle supposee.
 */
export function rapportCoherencePersonnage(film: Film, personnageId: string): RapportCoherencePersonnage {
  const plans = plansGeneresDuPersonnage(film, personnageId);
  const paires: ComparaisonPaire[] = [];
  for (let i = 0; i < plans.length; i++) {
    for (let j = i + 1; j < plans.length; j++) paires.push(comparerPaire(plans[i], plans[j]));
  }
  const tracees = paires.filter((p) => p.continuiteReference !== null);
  const continuiteGlobale = tracees.length === 0 ? null : tracees.every((p) => p.continuiteReference === true);

  return {
    personnageId,
    nbPlansGeneres: plans.length,
    paires,
    continuiteGlobale,
    coherenceVisuelleGarantie: false,
    avertissement: AVERTISSEMENT_COHERENCE,
  };
}

/**
 * Le signal du fournisseur SIMULE, explicitement : les couleurs d'identite
 * derivees de deux textes de reference sont-elles les memes ? C'est une
 * fonction A PART (et non integree a `comparerPaire`) parce qu'elle a besoin
 * du TEXTE de reference, que le rapport ci-dessus ne lit pas — pour ne
 * jamais laisser croire qu'une comparaison de couleurs est une comparaison
 * de visages.
 *
 * Sert au test « le mecanisme distingue bien deux personnages » (mission 2) :
 * APPELE EXPLICITEMENT par ce test, jamais par le rapport automatique.
 */
export function signalIdentiteSimulee(descriptionA: string, descriptionB: string): boolean {
  return couleurIdentite(descriptionA) === couleurIdentite(descriptionB);
}

export type { Film, PlanCinema, SceneCinema };
