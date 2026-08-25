/**
 * `toComposerOptions` — contrat canonique -> options du compositeur.
 *
 * Fonction PURE : aucun reseau, aucune base, aucun rendu declenche, aucun
 * credit. Elle ne fait que TRADUIRE.
 *
 * La reference est la traduction qui existe deja dans
 * `regenerateMontage` (`app/dashboard/calendar/page.tsx`) : c'est elle qui
 * recompose aujourd'hui les posts, donc elle qui fait autorite sur la forme
 * attendue. Deux ecarts, tous deux deliberes :
 *
 *  1. `regenerateMontage` ecrit `designMeta.x || undefined` partout. Un `0`,
 *     un `false` ou une chaine vide enregistres y sont donc effaces au profit
 *     du defaut du compositeur — une opacite de degrade reglee a `0` se
 *     regenere ainsi a `0.3`. Ici, une valeur enregistree est transmise
 *     telle quelle. Aucun consommateur n'appelle encore cette fonction : la
 *     divergence ne peut rien casser, et corrige un defaut reel.
 *
 *  2. Le rush est lu depuis `rushUrls[0]` AVANT `videoUrl`. `metadata.videoUrl`
 *     porte le rush pour l'editeur avance mais le MONTAGE pour les posts les
 *     plus anciens ; `regenerateMontage` et le cron de publication l'ignorent
 *     deja pour cette raison.
 *
 * Ce que la fonction ne peut PAS produire, et pourquoi :
 *   - `title`      : colonne du post, absente des metadonnees ;
 *   - `width`/`height` : seulement si `videoSize` a ete enregistre ;
 *   - `onProgress`, `sharedAudioCtx`, `musicBuffer`, `voiceBuffer` : objets
 *     de rendu, propriete de l'appelant ;
 *   - `cardsSnapshot`, `ctaIconImage`, `titleIconImage` : images pre-rendues,
 *     jamais serialisables ;
 *   - `sequenceBackgrounds` : les editeurs ne le persistent pas encore dans
 *     `metadata` (il vit dans les preferences locales) — il traverse donc le
 *     contrat par le `passthrough` sans etre traduit.
 */

import { resolveCanonicalDesign } from './resolve';
import { isPlainObject } from './internal';
import type {
  CanonicalCard,
  CanonicalDesign,
  CardData,
  ComposerOptionsFromDesign,
  DesignOptions,
  NonSerializableDesignKey,
} from './types';

/** Objet nu, ou rien. */
function rec(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined;
}

/** Position `{x, y}` exploitable, ou rien. */
function pos(value: unknown): { x?: number; y?: number } | undefined {
  const obj = rec(value);
  if (!obj) return undefined;
  const x = typeof obj.x === 'number' ? obj.x : undefined;
  const y = typeof obj.y === 'number' ? obj.y : undefined;
  if (x === undefined && y === undefined) return undefined;
  return { x, y };
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/** Premiere valeur definie. `null` compte comme « rien » ici : le compositeur veut une source ou pas de source. */
function first<T>(...candidates: Array<T | null | undefined>): T | undefined {
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null) return candidate;
  }
  return undefined;
}

/**
 * Carte persistee -> carte du compositeur.
 *
 * `CardData` exige `emoji`, `label` et `value` ; une carte enregistree peut
 * n'en porter aucun. Les chaines vides sont le seul repli sain : elles
 * rendent une carte vide, la ou une carte absente decalerait toute la grille.
 */
function toCardData(card: CanonicalCard): CardData {
  return {
    ...card,
    emoji: str(card.emoji) ?? '',
    label: str(card.label) ?? '',
    value: str(card.value) ?? '',
  } as CardData;
}

/** N'ajoute la cle que si la valeur existe — pour ne pas ecraser un defaut du compositeur par `undefined`. */
function put(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) target[key] = value;
}

export function toComposerOptions(design: CanonicalDesign): ComposerOptionsFromDesign {
  const r = resolveCanonicalDesign(design);

  // `designOptions` est ouvert (cles inconnues conservees) ; on le restreint
  // ici a la forme que le compositeur declare, sans les images pre-rendues.
  const stored: Omit<DesignOptions, NonSerializableDesignKey> = r.designOptions;
  const raw = r.designOptions as Record<string, unknown>;

  // Les editeurs ecrivent positions / tailles / typographie IMBRIQUEES dans
  // `metadata.design`, alors que le compositeur les attend a plat.
  const positions = rec(raw.positions);
  const sizes = rec(raw.sizes);
  const typography = rec(raw.typography);

  const derived: Record<string, unknown> = {};
  put(derived, 'titlePosition', first(pos(positions?.title), pos(raw.titlePosition)));
  put(derived, 'cardsPosition', first(pos(positions?.cards), pos(raw.cardsPosition)));
  put(derived, 'watermarkPosition', first(pos(positions?.watermark), pos(raw.watermarkPosition)));
  put(derived, 'logoPosition', first(pos(positions?.logo), pos(raw.logoPosition)));
  put(derived, 'overlayPosition', first(
    pos(r.overlays.overlayPosition),
    pos(positions?.overlay),
    pos(raw.overlayPosition),
  ));
  put(derived, 'titleSize', first(num(sizes?.title), num(raw.titleSize)));
  put(derived, 'cardsSize', first(num(sizes?.cards), num(raw.cardsSize)));
  put(derived, 'watermarkSize', first(num(sizes?.watermark), num(raw.watermarkSize)));
  put(derived, 'titleTypography', first(rec(typography?.title), rec(raw.titleTypography)));
  put(derived, 'ctaTypography', first(rec(typography?.cta), rec(raw.ctaTypography)));
  put(derived, 'overlayTypography', first(rec(typography?.overlay), rec(raw.overlayTypography)));
  put(derived, 'cardsTypography', first(rec(typography?.cards), rec(raw.cardsTypography)));

  // `metadata.design.ctaSubText` (ecrit par l'editeur avance) devient
  // `ctaSubTextDesign` cote compositeur — meme donnee, autre nom.
  put(derived, 'ctaSubTextDesign', first(str(raw.ctaSubText), str(raw.ctaSubTextDesign)));
  put(derived, 'ctaSubColor', first(str(raw.ctaSubColor), str(r.branding.ctaSubColor)));

  // Incrustations : enregistrees a la RACINE des metadonnees, attendues dans
  // `design` par le compositeur.
  put(derived, 'overlayText', first(str(r.overlays.videoOverlayText), str(raw.overlayText)));
  put(derived, 'overlayColor', first(str(r.overlays.overlayColor), str(raw.overlayColor)));
  put(derived, 'overlayTextScale', num(r.overlays.overlayTextScale));
  put(derived, 'overlayStartTime', num(r.overlays.overlayStartTime));
  put(derived, 'overlayEndTime', num(r.overlays.overlayEndTime));
  if (Array.isArray(r.overlays.overlays)) derived.overlays = r.overlays.overlays;

  // Bordure : `design` fait foi, la marque sert de repli.
  put(derived, 'borderEnabled', first(bool(raw.borderEnabled), bool(r.branding.borderEnabled)));
  put(derived, 'borderColor', first(str(raw.borderColor), str(r.branding.borderColor)));

  const composerDesign: DesignOptions = { ...stored, ...derived };

  const options: Record<string, unknown> = {
    design: composerDesign,
  };

  // ── Dimensions ─────────────────────────────────────────────────────
  const videoSize = rec(r.format.videoSize);
  put(options, 'width', num(videoSize?.w));
  put(options, 'height', num(videoSize?.h));

  // ── Contenu ────────────────────────────────────────────────────────
  put(options, 'subtitle', str(r.content.subtitle));
  put(options, 'salesPhrase', str(r.content.salesPhrase));
  options.cards = (r.cards.cards ?? []).map(toCardData);

  // ── Sources visuelles ──────────────────────────────────────────────
  options.posterUrl = first(
    str(r.media.posterUrl),
    str(r.media.pexelsUrl),
    str(r.media.characterUrl),
  ) ?? null;
  options.videoUrl = first(
    Array.isArray(r.media.rushUrls) ? str(r.media.rushUrls[0]) : undefined,
    str(r.media.videoUrl),
  ) ?? null;
  options.videoImageUrl = str(r.media.videoImageUrl) ?? null;
  options.logoUrl = first(str(r.media.logoUrl), str(raw.logoUrl)) ?? null;

  // ── Sequences ──────────────────────────────────────────────────────
  put(options, 'introDuration', num(r.sequences.intro));
  put(options, 'cardsDuration', num(r.sequences.cards));
  put(options, 'videoDuration', num(r.sequences.video));
  put(options, 'ctaDuration', num(r.sequences.cta));
  // Un ordre vide signifie « pas de reordonnancement » : transmettre `[]`
  // reviendrait au meme, mais l'omettre est plus fidele a l'opt-in decrit
  // par `ComposerOptions.sequenceOrder`.
  if (Array.isArray(r.sequences.order) && r.sequences.order.length > 0) {
    options.sequenceOrder = r.sequences.order;
  }

  // ── Marque ─────────────────────────────────────────────────────────
  put(options, 'accentColor', str(r.branding.accentColor));
  put(options, 'ctaText', str(r.branding.ctaText));
  put(options, 'ctaSubText', str(r.branding.ctaSubText));
  put(options, 'watermarkText', str(r.branding.watermarkText));

  // ── Filigrane de site ──────────────────────────────────────────────
  // `SiteTextConfig.text` est OBLIGATOIRE : un objet sans texte est ecarte
  // plutot que transmis incomplet.
  const siteText = rec(raw.siteText);
  if (siteText && typeof siteText.text === 'string') {
    options.siteText = siteText;
  }

  // ── Audio ──────────────────────────────────────────────────────────
  options.musicUrl = str(r.audio.musicUrl) ?? null;
  options.voiceUrl = str(r.audio.voiceUrl) ?? null;
  put(options, 'musicVolume', num(r.audio.musicVolume));
  put(options, 'voiceVolume', num(r.audio.voiceVolume));
  const seqVoices = rec(r.audio.sequenceVoiceUrls);
  if (seqVoices && Object.keys(seqVoices).length > 0) options.sequenceVoiceUrls = seqVoices;
  if (Array.isArray(r.audio.audioKeyframes) && r.audio.audioKeyframes.length > 0) {
    options.audioKeyframes = r.audio.audioKeyframes;
  }

  return options as ComposerOptionsFromDesign;
}
