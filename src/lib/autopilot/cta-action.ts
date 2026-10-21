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
import { FOND_TEXTE_SUR_IMAGE } from '@/lib/creer/contraste';

/**
 * « Panneau » du CTA d'action : plus d'aplat opaque (`rgba(0,0,0,0.6)` d'avant,
 * « rectangle gris » relevé sur l'aperçu du style et le MP4 du 20/10). Le CTA
 * est posé sur l'image avec le contour fin des glyphes (`SequenceCta`, fond
 * fourni ⇒ `haloTexteCss`) : la MÊME règle que les surimpressions
 * (`FOND_TEXTE_SUR_IMAGE`). La petite ligne est éclaircie jusqu'à 4,5:1 au
 * bord des lettres (`fondHaloPire`). Un post enregistré avec l'ancien panneau
 * le garde (sa métadonnée porte la couleur).
 */
export const CTA_ACTION_PANNEAU = FOND_TEXTE_SUR_IMAGE;
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

/**
 * CTA SANS CTA DANS LE BRIEF — un appel à l'action GÉNÉRIQUE et HONNÊTE,
 * dérivé de l'OBJECTIF de l'utilisateur (puis de son message, puis du sujet).
 *
 * ⚠️ Constat (démo « Motivation », 20/10) : sans CTA dans le brief, le CTA
 * final était le slogan généré (« LEVIERS EFFICACES ») et, sous lui, la ligne
 * par défaut du rendu « LIEN EN BIO » — un lien que personne n'a fourni.
 * Désormais : une ACTION que le spectateur peut faire sans lien, jamais une
 * URL, jamais « lien en bio », jamais une promotion ni une promesse
 * commerciale. Un lien n'apparaît que s'il est écrit dans le brief (`cta`).
 * Table ordonnée : la première règle qui reconnaît le texte l'emporte.
 */
export const CTA_PAR_OBJECTIF: ReadonlyArray<{ cle: string; motif: RegExp; cta: string }> = [
  { cle: 'vendre', motif: /\b(vend|achat|achet|command|reserv|inscri|essai|rendez|rdv|devis|tarif|client|boutique|cours\b)/, cta: 'ÉCRIS-NOUS EN MESSAGE' },
  { cle: 'eduquer', motif: /\b(eduqu|apprend|appren|expliqu|enseign|astuce|conseil|savoir|comprend|guide|tuto|inform|decouvr)/, cta: 'ENREGISTRE POUR PLUS TARD' },
  { cle: 'motiver', motif: /\b(motiv|inspir|encourag|bouge|action|depass|disciplin|mental|confiance|lance)/, cta: 'PASSE À L’ACTION AUJOURD’HUI' },
  { cle: 'communaute', motif: /\b(communaut|abonn|notoriet|visibilit|partag|engag|fidel|rejoin)/, cta: 'ABONNE-TOI POUR LA SUITE' },
];
/** Aucun objectif reconnu : une action sans lien ni promesse. En capitales, comme les CTA générés (le rendu les met en capitales). */
export const CTA_GENERIQUE = 'ENREGISTRE POUR PLUS TARD';

const sansAccents = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** L'appel à l'action dérivé de l'objectif, du message, puis du sujet. Pur. */
export function ctaDeLObjectif(...textes: ReadonlyArray<string | null | undefined>): string {
  for (const t of textes) {
    const x = sansAccents((t ?? '').trim());
    if (!x) continue;
    const r = CTA_PAR_OBJECTIF.find((c) => c.motif.test(x));
    if (r) return r.cta;
  }
  return CTA_GENERIQUE;
}

/**
 * Le CTA de l'Autopilote. Brief AVEC CTA : la règle de Créer, telle quelle
 * (slogan + action du brief en petite ligne). Brief SANS CTA : l'action
 * dérivée de l'objectif (`ctaDeLObjectif`) en ligne principale, petite ligne
 * VIDE (jamais le « LIEN EN BIO » par défaut du rendu).
 */
export function ctaAutopilote(
  tagLine: string | null | undefined,
  brief: { cta?: string | null; objectif?: string | null; message?: string | null } | null | undefined,
  sujet?: string | null,
): CtaAutopilote {
  if (!(brief?.cta ?? '').trim()) {
    return { cta: ctaDeLObjectif(brief?.objectif, brief?.message, sujet), ctaSub: '', actionEnPetiteLigne: false };
  }
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
