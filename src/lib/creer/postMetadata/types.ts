/**
 * Contrat de design canonique — types.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI UN TYPE DE PLUS, ET POURQUOI IL N'EN CONCURRENCE AUCUN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Quatre modeles decrivent deja une partie du sujet, et aucun ne couvre le
 * besoin de bout en bout :
 *
 *  1. `ComposerOptions` / `DesignOptions` (`lib/video-composer.ts`)
 *     Ce que le COMPOSITEUR sait consommer. Contient des objets non
 *     serialisables (`HTMLImageElement`, `AudioBuffer`, `AudioContext`) et
 *     ignore tout ce qui ne sert pas au rendu (plateformes, date de
 *     planification, vignette, version du compositeur).
 *     -> destination, jamais stockage.
 *
 *  2. `ScheduledPost.metadata: Record<string, any>` (`lib/types/database.ts`)
 *     La colonne `jsonb` reelle, typee `any` : aucune garantie.
 *
 *  3. `PostMetadata` (local a `app/dashboard/calendar/page.tsx`, non exporte)
 *     La lecture la plus complete des metadonnees existantes, mais privee de
 *     la page Calendrier, partiellement fausse (`noColorSequences` y est
 *     `boolean` alors que le compositeur attend `string[]`) et incomplete
 *     (ni `overlays`, ni `cardGroups`, ni `audioKeyframes`, ni
 *     `sequenceVoiceUrls`).
 *
 *  4. `Draft` (`lib/creer/draft.ts`)
 *     L'etat du parcours guide en `localStorage` : un sous-ensemble oriente
 *     reprise de saisie (`step`, `started`, `themeId`), sans rapport avec la
 *     forme persistee en base.
 *
 * `CanonicalDesign` ne remplace aucun des quatre : il les RELIE. Il
 * REEXPORTE les types du compositeur au lieu de les redefinir, et se contente
 * d'ajouter ce qu'aucun ne fournit : une lecture typee, integrale et
 * REVERSIBLE des metadonnees d'un post.
 *
 * Le nom porte « Canonical » precisement parce que `Design` seul preterait a
 * confusion avec `DesignOptions`, qui existe deja et designe autre chose : le
 * sous-objet `metadata.design`, ici expose sous `designOptions`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * REGLE FONDATRICE : AUCUNE PERTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un `CanonicalDesign` ne contient QUE ce qui etait reellement enregistre.
 * Les valeurs par defaut ne s'appliquent qu'a la LECTURE, via
 * `resolveCanonicalDesign`, et ne sont jamais reecrites. C'est ce qui permet
 * de distinguer quatre etats que le reste du code confondait :
 *
 *   - champ absent                -> la cle n'est pas dans `present`
 *   - champ defini a `null`       -> la cle est dans `present`, valeur `null`
 *   - valeur par defaut d'affichage -> `resolveCanonicalDesign`, jamais ecrite
 *   - valeur reellement enregistree -> la valeur portee par le groupe
 */

import type {
  CardData,
  DesignOptions,
} from '@/lib/video-composer';
import type { AudioKeyframe } from '@/lib/creer/audioDucking';
import type { OpenRecord } from './internal';

export type { OpenRecord };

/**
 * Types du compositeur reexportes tels quels.
 *
 * Un consommateur du contrat n'a pas a importer `lib/video-composer` — un
 * module lourd, cote navigateur — pour nommer une carte ou un keyframe.
 */
export type { CardData, DesignOptions, AudioKeyframe };

/** Champs de `DesignOptions` qui ne survivent pas a une serialisation JSON. */
export type NonSerializableDesignKey =
  | 'cardsSnapshot'
  | 'ctaIconImage'
  | 'titleIconImage';

/**
 * `metadata.design`, typé.
 *
 * = `DesignOptions` prive de ses images pre-rendues, ouvert aux cles que les
 * editeurs y ecrivent sans que le compositeur les declare (`positions`,
 * `sizes`, `typography`, `cardCustomIcons`, `ctaIconName`, `elements`…).
 * L'ouverture n'est pas de la paresse : c'est ce qui garantit qu'une cle
 * inconnue traverse le contrat sans etre perdue.
 */
export type CanonicalDesignOptions = Omit<DesignOptions, NonSerializableDesignKey> & OpenRecord;

/** Carte telle qu'elle est PERSISTEE : `iconImage` est un objet de rendu, jamais stocke. */
export type CanonicalCard = Partial<Omit<CardData, 'iconImage'>> & OpenRecord;

/** Carte de texte simple, forme historique de `metadata.textCards`. */
export interface CanonicalTextCard extends OpenRecord {
  text?: string;
  color?: string;
}

/** Groupe de cartes du mode libre (`metadata.cardGroups`). */
export interface CanonicalCardGroup extends OpenRecord {
  id?: string;
  cardIds?: string[];
  color?: string;
}

/** Origine PROBABLE du post. Indication de lecture, jamais un contrat. */
export type CanonicalSource = 'assistant' | 'advanced' | 'unknown';

// ═══════════════════════════════════════════════════════════════════════
// GROUPES
// ═══════════════════════════════════════════════════════════════════════

/** Contenu redactionnel. */
export interface CanonicalContent extends OpenRecord {
  type?: string;
  subtitle?: string;
  salesPhrase?: string;
  theme?: string;
  colorTheme?: string;
}

/**
 * Format du montage.
 *
 * `videoSize` porte les dimensions REELLES. La colonne `format` du post ne
 * connait que « reel » et « tv » : sans ce champ, un montage carre serait
 * cadre en 16:9 et perdrait son haut et son bas.
 */
export interface CanonicalFormat extends OpenRecord {
  videoSize?: { w?: number; h?: number } | null;
}

/** Sources visuelles et fichiers produits. */
export interface CanonicalMedia extends OpenRecord {
  posterUrl?: string | null;
  pexelsUrl?: string | null;
  /**
   * Historiquement ambigu : porte le RUSH pour l'editeur avance, mais le
   * MONTAGE pour les posts les plus anciens. Le contrat le conserve tel quel
   * et ne tranche pas — tout futur traducteur devra preferer `rushUrls[0]`,
   * comme le fait deja la regeneration du Calendrier. Voir la DETTE D2
   * documentee dans `index.ts`.
   */
  videoUrl?: string | null;
  videoImageUrl?: string | null;
  rushKind?: string | null;
  rushUrls?: string[] | null;
  rawVideoUrl?: string | null;
  logoUrl?: string | null;
  characterUrl?: string | null;
  renderedVideoUrl?: string | null;
  thumbnailUrl?: string | null;
  composerVersion?: string | null;
}

/** Cartes, sous leurs trois formes persistees. */
export interface CanonicalCards extends OpenRecord {
  cards?: CanonicalCard[] | null;
  textCards?: CanonicalTextCard[] | null;
  cardGroups?: CanonicalCardGroup[] | null;
}

/** Durees et ordre des sequences (`metadata.sequences`). Cles EN : intro / cards. */
export interface CanonicalSequences extends OpenRecord {
  intro?: number;
  cards?: number;
  video?: number;
  cta?: number;
  total?: number;
  order?: string[];
}

/** Habillage de marque (`metadata.branding`). */
export interface CanonicalBranding extends OpenRecord {
  accentColor?: string;
  ctaText?: string;
  ctaSubText?: string;
  ctaSubColor?: string;
  watermarkText?: string;
  borderEnabled?: boolean;
  borderColor?: string | null;
}

/**
 * Voix par sequence. Cles FR — c'est la forme PERSISTEE, et c'est aussi celle
 * qu'attend `ComposerOptions.sequenceVoiceUrls` (`video-composer.ts:488-493`).
 *
 * Ecrite en clair plutot que derivee de `ComposerOptions` : ce lot ne parle
 * plus au compositeur, et `ComposerOptions` decrit une ENTREE DE RENDU, pas
 * une forme persistee — s'y accrocher aurait fait varier le contrat au gre
 * des besoins du compositeur.
 *
 * `CardData` et `DesignOptions` restent importes, eux, parce qu'ils
 * decrivent litteralement deux cles enregistrees (`metadata.cards` et
 * `metadata.design`) : la dependance y est le sujet meme, pas un accident.
 * Si le compositeur ajoutait une sequence ici, `OpenRecord` la laisserait
 * passer sans qu'on ait a suivre.
 */
export type CanonicalSequenceVoiceUrls = {
  titre?: string | null;
  cartes?: string | null;
  video?: string | null;
  cta?: string | null;
} & OpenRecord;

/** Musique, voix off, mixage. */
export interface CanonicalAudio extends OpenRecord {
  musicUrl?: string | null;
  voiceUrl?: string | null;
  musicVolume?: number;
  voiceVolume?: number;
  /** Drapeau lu par le Calendrier pour proposer — ou non — « Ajouter audio ». */
  hasAudio?: boolean;
  audioKeyframes?: AudioKeyframe[] | null;
  sequenceVoiceUrls?: CanonicalSequenceVoiceUrls | null;
}

/**
 * Textes incrustes sur la sequence video.
 *
 * L'editeur avance les ecrit a la RACINE des metadonnees, alors que le
 * compositeur les attend dans `design`. Le contrat conserve la forme
 * PERSISTEE et ne traduit pas : la traduction vers le compositeur est hors
 * de ce lot (voir les DETTES documentees dans `index.ts`).
 */
export interface CanonicalOverlays extends OpenRecord {
  videoOverlayText?: string | null;
  overlays?: DesignOptions['overlays'] | null;
  overlayTextScale?: number;
  overlayStartTime?: number;
  overlayEndTime?: number;
  overlayPosition?: { x?: number; y?: number } | null;
  overlayColor?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════
// LE CONTRAT
// ═══════════════════════════════════════════════════════════════════════

/**
 * Lecture typee et REVERSIBLE des metadonnees d'un post.
 *
 * Chaque groupe ne porte que ce qui etait reellement enregistre : un champ
 * absent vaut `undefined`, et non sa valeur par defaut.
 */
export interface CanonicalDesign {
  readonly version: 1;
  /** Indication d'origine, deduite. Ne sert qu'a l'affichage et au diagnostic. */
  readonly source: CanonicalSource;
  readonly content: CanonicalContent;
  readonly format: CanonicalFormat;
  readonly media: CanonicalMedia;
  readonly cards: CanonicalCards;
  readonly sequences?: CanonicalSequences;
  readonly branding?: CanonicalBranding;
  readonly audio: CanonicalAudio;
  readonly overlays: CanonicalOverlays;
  /** `metadata.design`. Nomme ainsi pour ne pas devenir `design.design`. */
  readonly designOptions?: CanonicalDesignOptions;
  /**
   * Toutes les cles de premier niveau que le contrat NE GERE PAS, copiees
   * telles quelles : `error`, `cron_publish_results`, `timezone`, `source`,
   * `objective`, et toute extension future. Elles sont reecrites intactes.
   */
  readonly passthrough: Readonly<Record<string, unknown>>;
  /**
   * Cles gerees REELLEMENT PRESENTES dans les metadonnees d'origine, dans
   * l'ordre canonique. C'est la memoire qui distingue « absent » de « nul »
   * et qui empeche une simple lecture d'ajouter des cles a l'enregistrement.
   */
  readonly present: readonly string[];
}

/**
 * Meme forme, mais chaque champ connu porte une valeur.
 *
 * C'est la vue destinee a l'AFFICHAGE et au compositeur. Elle n'est jamais
 * reecrite en base : les defauts qu'elle applique resteraient sinon graves
 * dans le post au premier enregistrement.
 */
export interface ResolvedCanonicalDesign {
  readonly version: 1;
  readonly source: CanonicalSource;
  readonly content: Required<Pick<CanonicalContent, 'subtitle' | 'salesPhrase'>> & CanonicalContent;
  readonly format: CanonicalFormat;
  readonly media: CanonicalMedia;
  readonly cards: Required<Pick<CanonicalCards, 'cards' | 'textCards' | 'cardGroups'>> & CanonicalCards;
  readonly sequences: Required<Pick<CanonicalSequences, 'intro' | 'cards' | 'video' | 'cta' | 'order'>> & CanonicalSequences;
  readonly branding: Required<Pick<CanonicalBranding, 'accentColor' | 'ctaText' | 'ctaSubText'>> & CanonicalBranding;
  readonly audio: Required<Pick<CanonicalAudio, 'musicVolume' | 'voiceVolume' | 'hasAudio' | 'audioKeyframes' | 'sequenceVoiceUrls'>> & CanonicalAudio;
  readonly overlays: Required<Pick<CanonicalOverlays, 'overlayTextScale' | 'overlayStartTime' | 'overlayEndTime'>> & CanonicalOverlays;
  readonly designOptions: CanonicalDesignOptions;
}
