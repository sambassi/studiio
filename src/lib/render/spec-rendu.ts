/**
 * SPEC DE RENDU CANONIQUE (A2.1) — module feuille, PUR.
 *
 * Une seule description de « ce qu'il faut rendre », indépendante du moteur.
 * Aujourd'hui elle est égale à l'entrée du rendu serveur
 * (`CreerSimpleRenderInput`) plus les champs que la composition Remotion
 * accepte déjà sans qu'ils soient déclarés dans cette entrée.
 *
 * ⚠️ RIEN N'EST BRANCHÉ EN A2.1. Aucun appelant n'utilise ce module :
 * `renderCreerSimple` garde son propre calcul. Les fonctions ci-dessous en
 * sont une COPIE fidèle, verrouillée par
 * `src/__tests__/contracts/spec-rendu-parite.contract.test.ts` (toStrictEqual
 * contre les inputProps réellement confiés au worker, fixtures A/D/E/F/G/H/J
 * + specs directes 9:16 / 1:1 / 16:9). Les brancher est un lot ultérieur.
 *
 * Aucun import de valeur hors `designSpec` (pur) : ni React, ni réseau, ni
 * base, ni facturation. Les autres imports sont des types.
 *
 * SENS DES CLÉS AMBIGUËS (aucune n'est renommée) :
 *   - `watermark` : le TEXTE du filigrane peint par Remotion (`<Filigrane>`).
 *     Ce n'est PAS le booléen `watermark` du compositeur navigateur (filigrane
 *     « Studiio » du plan gratuit) : celui-là relève du plan / de la
 *     facturation et n'appartient PAS à la spec.
 *   - `ctaText` : le texte PRINCIPAL (gros) du CTA. Le compositeur l'appelle
 *     `watermarkText` (ou `design.ctaMainText`, prioritaire) ; son propre
 *     `ctaText` n'y est que le REPLI du sous-texte.
 *   - `ctaSubText` : sous-texte du CTA. ABSENT ≠ '' : absent, Remotion
 *     retombe sur ses defaultProps (« LIEN EN BIO ») ; '' n'affiche rien.
 *   - `format` : format VISUEL ('9:16' | '1:1' | '16:9'). Jamais le format de
 *     facturation ('reel' / 'tv'), qui reste hors spec.
 */
import { buildSequences, totalDurationFrames, VIDEO_SIZE, type DesignFormat, type PlannedSequence } from '@/lib/creer/designSpec';
import type { CreerSimpleRenderInput } from '@/lib/render/creerSimple';

/** La spec canonique : l'entrée serveur + les champs Remotion non déclarés. */
export interface SpecRendu extends CreerSimpleRenderInput {
  /** Couleur du sous-titre. Absente : la couleur par défaut du montage. */
  subtitleColor?: string | null;
  /** Couleur du texte principal du CTA. Absente : '#FFFFFF'. */
  ctaColor?: string;
  /** Couleur du sous-texte du CTA. Absente : '#EC4899'. */
  ctaSubColor?: string;
  /** Panneau derrière le CTA (surimpressions, #502). Absent : aucun. */
  ctaBackground?: string | null;
}

/** Props confiées à la composition `creer-simple-montage`. */
export type EntreeRemotion = SpecRendu & {
  introDuration: number;
  cardsDuration: number;
  videoDuration: number;
  ctaDuration: number;
  cards: NonNullable<SpecRendu['cards']>;
};

/** Images par seconde du rendu serveur. */
export const FPS_RENDU = 30;

/**
 * Spec → props Remotion. EXACTEMENT le calcul de `renderCreerSimple`
 * aujourd'hui : étalement, puis défauts 4 / 6 / 0 / 4 et `cards ?? []`, dans
 * cet ordre. Aucune autre clé n'est ajoutée, aucune n'est retirée.
 */
export function versEntreeRemotion(spec: SpecRendu): EntreeRemotion {
  const d = spec;
  return {
    ...d,
    introDuration: d.introDuration ?? 4,
    cardsDuration: d.cardsDuration ?? 6,
    videoDuration: d.videoDuration ?? 0,
    ctaDuration: d.ctaDuration ?? 4,
    cards: d.cards ?? [],
  };
}

/**
 * Format et dimensions du rendu — la MÊME règle que `calculateMetadata`
 * (`remotion/index.tsx`) : '16:9' et '1:1' reconnus, tout le reste en 9:16.
 */
export function dimensionsDeRendu(spec: Pick<SpecRendu, 'format'>): { format: DesignFormat; width: number; height: number } {
  const format: DesignFormat = spec.format === '16:9' ? '16:9' : spec.format === '1:1' ? '1:1' : '9:16';
  const taille = VIDEO_SIZE[format];
  return { format, width: taille.w, height: taille.h };
}

export interface PlanDeRendu {
  sequences: PlannedSequence[];
  durationFrames: number;
  fps: number;
  /** Nombre de raccords entre séquences. */
  transitions: number;
  format: DesignFormat;
  width: number;
  height: number;
}

/**
 * Ligne de temps du rendu — les MÊMES arguments de `buildSequences` que
 * `renderCreerSimple` (et donc que `planFromProps`) : un rush fourni est
 * réputé jouable, l'ordre demandé est respecté. Les durées ne sont PAS
 * recalculées (elles sont déjà calées par l'éditeur / l'Autopilote).
 */
export function planDeRendu(spec: SpecRendu): PlanDeRendu {
  const p = versEntreeRemotion(spec);
  const sequences = buildSequences({
    introDuration: p.introDuration,
    cardsDuration: p.cardsDuration,
    videoDuration: p.videoDuration,
    ctaDuration: p.ctaDuration,
    cardCount: p.cards.length,
    hasVideoBackground: !!spec.videoUrl,
    videoRequested: !!spec.videoUrl,
    sequenceOrder: spec.sequenceOrder ?? null,
  });
  return {
    sequences,
    durationFrames: totalDurationFrames(sequences, FPS_RENDU),
    fps: FPS_RENDU,
    transitions: Math.max(0, sequences.length - 1),
    ...dimensionsDeRendu(spec),
  };
}

/**
 * Champs qui n'appartiennent PAS à la spec : plan, facturation, identité du
 * travail. Ils restent chez leurs appelants.
 */
export const CHAMPS_HORS_SPEC: readonly string[] = [
  'watermark (booléen compositeur, plan gratuit)',
  'format reel/tv (facturation)',
  'crédits / coût / prix',
  'référence d’opération',
  'jobId / userId (identité du travail, pas du design)',
];

/**
 * Correspondance compositeur navigateur (Créer / Calendrier, `ComposerOptions`)
 * ↔ spec. `spec: null` = le compositeur le rend, Remotion NE le rend PAS
 * encore : écart connu, rien à brancher en A2.1.
 */
export const CORRESPONDANCE_COMPOSITEUR: ReadonlyArray<{ compositeur: string; spec: keyof SpecRendu | null; note?: string }> = [
  { compositeur: 'title', spec: 'title' },
  { compositeur: 'subtitle', spec: 'subtitle' },
  { compositeur: 'cards', spec: 'cards' },
  { compositeur: 'design.ctaMainText || watermarkText', spec: 'ctaText', note: 'texte PRINCIPAL du CTA' },
  { compositeur: 'design.ctaSubTextDesign ?? ctaText', spec: 'ctaSubText', note: 'sous-texte ; absent ≠ ""' },
  { compositeur: 'width / height', spec: 'format', note: 'dimensions = VIDEO_SIZE[format]' },
  { compositeur: 'posterUrl', spec: 'posterUrl' },
  { compositeur: 'videoUrl', spec: 'videoUrl' },
  { compositeur: 'rushs', spec: 'rushs' },
  { compositeur: 'montage', spec: 'montage' },
  { compositeur: 'musicUrl', spec: 'musicUrl' },
  { compositeur: 'voiceUrl', spec: 'voiceUrl' },
  { compositeur: 'sequenceVoiceUrls', spec: 'sequenceVoiceUrls' },
  { compositeur: 'musicVolume', spec: 'musicVolume' },
  { compositeur: 'voiceVolume', spec: 'voiceVolume' },
  { compositeur: 'introDuration', spec: 'introDuration' },
  { compositeur: 'cardsDuration', spec: 'cardsDuration' },
  { compositeur: 'videoDuration', spec: 'videoDuration' },
  { compositeur: 'ctaDuration', spec: 'ctaDuration' },
  { compositeur: 'sequenceOrder', spec: 'sequenceOrder' },
  { compositeur: 'transition', spec: 'transition' },
  { compositeur: 'design.textAnimation', spec: 'textAnimation' },
  { compositeur: 'design.gradientColor1', spec: 'gradientStart' },
  { compositeur: 'design.gradientColor2', spec: 'gradientEnd' },
  { compositeur: 'design.titleColor', spec: 'titleColor' },
  { compositeur: 'watermark (booléen, plan gratuit)', spec: null, note: 'hors spec — facturation/plan' },
  // ── Écarts connus : rendus par le compositeur, pas (encore) par Remotion ──
  { compositeur: 'logoUrl', spec: null },
  { compositeur: 'siteText', spec: null, note: "pas de bandeau site dans Remotion ; Remotion peint seulement `watermark` (texte du filigrane), qui recouvre en partie siteText.text" },
  { compositeur: 'rushLut', spec: null },
  { compositeur: 'titleIcon* (icône du titre)', spec: null },
  { compositeur: 'extraTitle', spec: null },
  { compositeur: 'habillageVideo', spec: null },
  { compositeur: 'posterTransform / rushTransforms', spec: null },
  { compositeur: 'sequenceTransitions (transition par raccord)', spec: null },
  { compositeur: 'rushAudioRequis', spec: null },
  { compositeur: 'ducking du jumeau (avatar)', spec: null },
];
