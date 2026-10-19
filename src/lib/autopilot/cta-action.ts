/**
 * CTA DE L'AUTOPILOTE — l'action du brief LISIBLE.
 *
 * Rendu réel (preuve du 19/10/2026) : l'action saisie dans le brief
 * (« Réserve ton cours d'essai gratuit ») est la PETITE ligne du CTA, sous le
 * slogan généré (« AFRO + ENTRAÎN. ») — c'est la règle VERROUILLÉE, la même
 * que Créer (`avecCtaDuBrief`, contrat `autopilot.contract.test.ts`). Mais
 * elle était rose (#EC4899) sur le dégradé rose, en 30 px sur 1080 :
 * ≈ 1,2:1 mesuré sur l'image du MP4, illisible.
 *
 * Ici, SANS TOUCHER AUX TEXTES (ni à leur place) : quand la petite ligne EST
 * l'action du brief, le bloc CTA reçoit la mise en lisibilité du CTA en
 * surimpression (#502) — panneau sombre, ligne d'action éclaircie — et la
 * même échelle de CTA (×1,6, bornée par `ajusterCta` pour tenir en largeur).
 *
 * Sans brief, ou quand l'action est déjà la ligne principale (slogan vide ou
 * identique) : rien n'est ajouté — le CTA d'avant, à l'octet près.
 */
import { avecCtaDuBrief } from '@/lib/creer/validation-rendu';
import { ajusterCta, eclaircir } from '@/lib/creer/surimpressions-mise-en-page';
import { FONT_RATIO } from '@/lib/creer/designSpec';

/** Le panneau du CTA en surimpression (#502, `ctaFond`) — le même sombre. */
export const CTA_ACTION_PANNEAU = 'rgba(0,0,0,0.6)';
/** Rose par défaut du sous-texte (`SequenceCta`), éclairci comme en #502 (`ctaActionEclaircie`). */
export const CTA_ACTION_SOUS_COULEUR = eclaircir('#EC4899', 0.6) as string;
/** Échelle du CTA en surimpression 9:16 (#502, `ctaScale`). */
export const CTA_ACTION_ECHELLE = 1.6;

export interface CtaAutopilote {
  cta: string;
  ctaSub: string;
  /** Vrai seulement quand la petite ligne porte l'action du brief. */
  actionEnPetiteLigne: boolean;
}

/** Le CTA de l'Autopilote : la règle de Créer, telle quelle, et où se trouve l'action. */
export function ctaAutopilote(tagLine: string | null | undefined, brief: { cta?: string | null } | null | undefined): CtaAutopilote {
  const c = avecCtaDuBrief({ cta: tagLine ?? '', ctaSub: '' }, brief);
  return { ...c, actionEnPetiteLigne: actionEnPetiteLigne(c, brief) };
}

/** La petite ligne d'un CTA déjà résolu (`avecCtaDuBrief`) est-elle l'action du brief ? */
export function actionEnPetiteLigne(c: { ctaSub: string }, brief: { cta?: string | null } | null | undefined): boolean {
  const action = (brief?.cta ?? '').trim();
  return !!action && !!c.ctaSub && c.ctaSub === action;
}

/**
 * Champs de rendu qui rendent l'action lisible — à poser seulement si
 * `actionEnPetiteLigne`. `echelle` : celle que l'utilisateur a réglée (1 sinon).
 */
export function lisibiliteCtaAction(cta: { cta: string; ctaSub: string }, echelle = 1): {
  ctaBackground: string; ctaSubColor: string; ctaScale: number;
} {
  return {
    ctaBackground: CTA_ACTION_PANNEAU,
    ctaSubColor: CTA_ACTION_SOUS_COULEUR,
    ctaScale: ajusterCta({
      texte: cta.cta, sousTexte: cta.ctaSub, echelle: echelle * CTA_ACTION_ECHELLE, largeur: 1080,
      ratioTexte: FONT_RATIO['9:16'].cta, ratioSousTexte: FONT_RATIO['9:16'].ctaSub, panneau: true,
    }),
  };
}

/**
 * Le design SANS la lisibilité du CTA d'action — pour la mise en page en
 * surimpression (#502), qui pose elle-même panneau, teinte et échelle à
 * partir des réglages de l'utilisateur. Sans ce retrait, elle les
 * appliquerait une seconde fois (teinte éclaircie deux fois, échelle ×2,56).
 */
export function sansLisibiliteCtaAction<T extends { ctaBackground?: string | null; ctaSubColor?: string; ctaScale?: number }>(
  design: T, echelleUtilisateur?: number,
): T {
  if (design.ctaSubColor !== CTA_ACTION_SOUS_COULEUR || design.ctaBackground !== CTA_ACTION_PANNEAU) return design;
  return { ...design, ctaBackground: undefined, ctaSubColor: undefined, ctaScale: echelleUtilisateur };
}
