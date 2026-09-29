/**
 * Options de rendu d'un post du Calendrier, construites depuis sa metadata —
 * UNE fonction pour les quatre chemins qui recomposent (« Régénérer »,
 * « Planifier », « Publier maintenant », export « Bureau »).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les quatre chemins portaient chacun leur copie d'un bloc de ~90 lignes, et
 * aucun ne transmettait ce que le parcours Créer passe au compositeur au-delà
 * de la typographie : mixage (`musicVolume`, `voiceVolume`,
 * `audioKeyframes`), `transition`, `design.textAnimation`, éléments libres,
 * fonds par séquence, recadrage de l'affiche, photo des cartes. Un montage
 * régénéré différait donc de celui qui avait été payé.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DEFAULT SAFE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Pour un post SANS ces champs, les options sont exactement celles d'avant,
 * chemin par chemin — y compris les différences historiques entre chemins,
 * conservées telles quelles (voir `DIFFERENCES_HISTORIQUES`) : les corriger
 * changerait le rendu de posts existants, c'est un autre chantier. Chaque
 * champ de fidélité n'est posé que s'il est présent ET valide ; absent, la
 * clé n'existe pas du tout.
 *
 * `test` : `src/__tests__/calendrier-regeneration-fidele.test.tsx` compare les
 * quatre anciens blocs, recopiés, à cette fonction sur des posts anciens.
 */
import {
  TRANSITION_KEYS,
  type ComposerOptions,
  type DesignOptions,
  type FreeElementRender,
  type TransitionStyle,
} from '@/lib/video-composer';
import type { AudioKeyframe } from '@/lib/creer/audioDucking';
import {
  elementsLibresDepuisMetadata,
  fondsPourMetadata,
  fondsVersCompositeur,
  photoCartesValide,
  recadrageValide,
  type ElementLibre,
} from '@/lib/creer/postMetadata/rendu-fidele';

export type CheminCalendrier = 'regenerer' | 'planifier' | 'publier' | 'exporter';

/** Le post tel que le Calendrier le manipule — seuls ces champs sont lus. */
export interface PostARendre {
  title?: string | null;
  format?: string | null;
  // `jsonb` : n'importe quelle forme, lue défensivement.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: any;
}

/**
 * Dimensions à recomposer pour un post.
 *
 * `format` ne connait que deux résolutions : un montage carré recomposé
 * d'après lui ressortait en 1920x1080, dans un cadre annoncé 1:1. Quand le
 * post porte ses dimensions réelles, ce sont elles qui font foi.
 */
export function montageSize(
  videoSize: { w: number; h: number } | undefined,
  format: 'reel' | 'tv' | string,
): { width: number; height: number } {
  if (videoSize && videoSize.w > 0 && videoSize.h > 0) {
    return { width: videoSize.w, height: videoSize.h };
  }
  return format === 'reel' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
}

/**
 * Les écarts ENTRE CHEMINS qui existaient avant ce module, et qu'il garde :
 *
 *  - « Régénérer » borne les durées (`0` = séquence masquée, `< 2` = valeur
 *    corrompue -> défaut) et met la vidéo à 0 sans rush ; les trois autres
 *    prennent la valeur stockée telle quelle (`??`).
 *  - L'export « Bureau » n'envoie pas la description des cartes, ni neuf
 *    champs de `design` (position/taille du CTA et du titre, typographies
 *    CTA et overlay, dégradés par séquence, fonds noirs, filtre).
 */
export const DIFFERENCES_HISTORIQUES = {
  dureesBornees: ['regenerer'] as ReadonlyArray<CheminCalendrier>,
  exportSansChamps: [
    'watermarkPosition', 'watermarkSize', 'titleSize', 'ctaTypography', 'overlayTypography',
    'seqGradients', 'noColorBg', 'noColorSequences', 'filter',
  ] as const,
};

/** Cartes brutes à pré-rendre, dans la forme de CHAQUE chemin. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function cartesSourcePourRendu(meta: any, chemin: CheminCalendrier): { aPrerendre: boolean; cartes: any[] } {
  if (meta?.cards?.length > 0) {
    return {
      aPrerendre: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cartes: meta.cards.map((c: any) => (chemin === 'exporter'
        ? { emoji: c.emoji, label: c.label, value: c.value, color: c.color }
        : { emoji: c.emoji, label: c.label, value: c.value, description: c.description, color: c.color })),
    };
  }
  return {
    aPrerendre: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cartes: (meta?.textCards || []).map((tCard: any) => ({ emoji: 'FileText', label: tCard.text, value: tCard.text, color: tCard.color })),
  };
}

const fini = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Keyframes du mixeur exploitables (forme `AudioKeyframe`), ou `undefined`. */
function keyframesValides(brut: unknown): AudioKeyframe[] | undefined {
  if (!Array.isArray(brut)) return undefined;
  const ok = brut.filter((k): k is AudioKeyframe =>
    typeof k === 'object' && k !== null && fini((k as AudioKeyframe).time));
  return ok.length > 0 ? ok : undefined;
}

/** Ce que le chemin a déjà préparé de façon asynchrone. */
export interface PreparationRendu {
  cards: ComposerOptions['cards'];
  rushLut?: ComposerOptions['rushLut'];
  elements?: FreeElementRender[];
  cardsSnapshot?: HTMLImageElement;
  onProgress?: ComposerOptions['onProgress'];
}

/**
 * Options du compositeur pour ce post et ce chemin. PURE : tout ce qui
 * demande un chargement arrive déjà prêt dans `prep`.
 */
export function optionsRenduDepuisMetadata(
  post: PostARendre,
  chemin: CheminCalendrier,
  prep: PreparationRendu,
): ComposerOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta: any = post?.metadata || {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const designMeta: any = meta.design || {};
  const brand = meta.branding;
  const seq = meta.sequences;
  const hasRush = !!meta.rushUrls?.[0];
  const hasCards = meta.cards?.length > 0 || meta.textCards?.length > 0;

  // ── Durées : la règle historique de CHAQUE chemin ──────────────────────
  // `0` est une valeur VOULUE (séquence masquée) : « Régénérer » ne la
  // remplace jamais par le défaut.
  const safeDuration = (val: unknown, fallback: number, min = 2) =>
    val === 0 ? 0 : ((typeof val === 'number' && val >= min) ? val : fallback);
  const durees = DIFFERENCES_HISTORIQUES.dureesBornees.includes(chemin)
    ? {
        introDuration: safeDuration(seq?.intro, 5),
        cardsDuration: hasCards ? safeDuration(seq?.cards, 6) : 0,
        videoDuration: hasRush ? safeDuration(seq?.video, 12) : 0,
        ctaDuration: safeDuration(seq?.cta, 5),
      }
    : {
        introDuration: seq?.intro ?? 5,
        cardsDuration: seq?.cards ?? (hasCards ? 6 : 0),
        videoDuration: seq?.video ?? 12,
        ctaDuration: seq?.cta ?? 5,
      };

  // ── Design : le bloc historique commun ─────────────────────────────────
  const design: DesignOptions & Record<string, unknown> = {
    font: designMeta.font || undefined,
    titleColor: designMeta.titleColor || undefined,
    gradientColor1: designMeta.gradientColor1 || undefined,
    gradientColor2: designMeta.gradientColor2 || undefined,
    gradientOpacity: designMeta.gradientOpacity ?? undefined,
    ctaSubColor: designMeta.ctaSubColor || brand?.ctaSubColor || undefined,
    ctaColor: designMeta.ctaColor || undefined,
    logoSequences: designMeta.logoSequences || undefined,
    logoPosition: designMeta.positions?.logo || undefined,
    logoPositions: designMeta.logoPositions || undefined,
    logoScale: designMeta.logoScale || undefined,
    overlayText: meta.videoOverlayText || undefined,
    overlayColor: designMeta.overlayColor || undefined,
    overlayTextScale: meta.overlayTextScale,
    overlayStartTime: meta.overlayStartTime,
    overlayEndTime: meta.overlayEndTime,
    overlays: Array.isArray(meta.overlays) ? meta.overlays : undefined,
    overlayPosition: meta.overlayPosition || designMeta.positions?.overlay || undefined,
    textScale: designMeta.textScale || undefined,
    titleFont: designMeta.titleFont || undefined,
    subtitleFont: designMeta.subtitleFont || undefined,
    subtitleColor: designMeta.subtitleColor || undefined,
    subtitleScale: designMeta.subtitleScale ?? undefined,
    ctaFont: designMeta.ctaFont || undefined,
    watermarkFont: designMeta.watermarkFont || undefined,
    cardsTextScale: designMeta.cardsTextScale ?? undefined,
    ctaTextScale: designMeta.ctaTextScale || undefined,
    cardStyle: designMeta.cardStyle || undefined,
    titlePosition: designMeta.positions?.title || undefined,
    // undefined pour tout post existant -> le compositeur retombe sur 'center'
    titleAlign: designMeta.titleAlign || undefined,
    cardsPosition: designMeta.positions?.cards || undefined,
    cardsSize: designMeta.sizes?.cards || undefined,
    ctaMainText: designMeta.ctaMainText || undefined,
    ctaSubTextDesign: designMeta.ctaSubText || undefined,
    titleTypography: designMeta.typography?.title || undefined,
    cardsTypography: designMeta.typography?.cards || designMeta.cardsTypography || undefined,
    extraTitle: designMeta.extraTitle || undefined,
    extraSubtitle: designMeta.extraSubtitle || undefined,
    extraTitlePosition: designMeta.extraTitlePosition || undefined,
    extraSubtitlePosition: designMeta.extraSubtitlePosition || undefined,
    extraTitleTypography: designMeta.extraTitleTypography || undefined,
    extraSubtitleTypography: designMeta.extraSubtitleTypography || undefined,
  };
  if (chemin !== 'exporter') {
    Object.assign(design, {
      watermarkPosition: designMeta.positions?.watermark || undefined,
      watermarkSize: designMeta.sizes?.watermark || undefined,
      titleSize: designMeta.sizes?.title || undefined,
      ctaTypography: designMeta.typography?.cta || undefined,
      overlayTypography: designMeta.typography?.overlay || undefined,
      seqGradients: designMeta.seqGradients || undefined,
      noColorBg: designMeta.noColorBg || undefined,
      noColorSequences: designMeta.noColorSequences || undefined,
      filter: designMeta.filter || undefined,
    });
  }

  // ── Fidélité au parcours Créer — chaque clé SEULEMENT si présente ──────
  if (typeof designMeta.textAnimation === 'string' && designMeta.textAnimation) {
    design.textAnimation = designMeta.textAnimation;
  }
  // Police des cartes : utile quand la photo manque et que le compositeur les
  // redessine. `cardsTextStyle` n'est pas lu par le compositeur, il voyage
  // pour que les options soient celles du parcours, champ pour champ.
  if (typeof designMeta.cardsFont === 'string' && designMeta.cardsFont) {
    design.cardsFont = designMeta.cardsFont;
  }
  if (designMeta.cardsTextStyle && typeof designMeta.cardsTextStyle === 'object') {
    design.cardsTextStyle = designMeta.cardsTextStyle;
  }
  if (prep.elements && prep.elements.length > 0) design.elements = prep.elements;
  // La photo n'est posée que si elle représente ENCORE les cartes du post
  // (empreinte) : après un « Modifier » des cartes, le compositeur les
  // redessine plutôt que de blitter l'ancien contenu.
  const photo = photoCartesValide(meta);
  if (prep.cardsSnapshot && photo) {
    design.cardsSnapshot = prep.cardsSnapshot;
    design.cardsSnapshotRect = photo.rect;
  }

  const fidelite: Partial<ComposerOptions> = {};
  if (fini(meta.musicVolume)) fidelite.musicVolume = meta.musicVolume;
  if (fini(meta.voiceVolume)) fidelite.voiceVolume = meta.voiceVolume;
  const keyframes = keyframesValides(meta.audioKeyframes);
  if (keyframes) fidelite.audioKeyframes = keyframes;
  if (TRANSITION_KEYS.includes(designMeta.transition as TransitionStyle)) {
    fidelite.transition = designMeta.transition as TransitionStyle;
  }
  const recadrage = recadrageValide(meta.posterTransform);
  if (recadrage) fidelite.posterTransform = recadrage;
  const fonds = fondsVersCompositeur(fondsPourMetadata(meta.seqBackgrounds));
  if (fonds) fidelite.sequenceBackgrounds = fonds;

  return {
    ...montageSize(meta?.videoSize, post?.format ?? 'tv'),
    fps: 30,
    title: post.title || 'Vidéo',
    subtitle: meta.subtitle || undefined,
    salesPhrase: meta.salesPhrase || undefined,
    cards: prep.cards,
    posterUrl: meta.posterUrl || meta.pexelsUrl || meta.characterUrl || null,
    videoUrl: meta.rushUrls?.[0] || null,
    ...(prep.rushLut ? { rushLut: prep.rushLut } : {}),
    logoUrl: meta.logoUrl || designMeta.logoUrl || null,
    musicUrl: meta.musicUrl || null,
    voiceUrl: meta.voiceUrl || null,
    sequenceVoiceUrls: meta.sequenceVoiceUrls || undefined,
    // Ordre de séquences stocké : sans lui la vidéo repartait toujours en
    // intro->cards->video->cta, divergeant de l'aperçu.
    sequenceOrder: (meta?.sequences?.order as string[] | undefined) || undefined,
    ...durees,
    accentColor: brand?.accentColor || '#D91CD2',
    ctaText: brand?.ctaText || "CHAT POUR PLUS D'INFOS",
    ctaSubText: brand?.ctaSubText || 'LIEN EN BIO',
    watermarkText: brand?.watermarkText || undefined,
    siteText: designMeta.siteText || undefined,
    ...fidelite,
    design,
    onProgress: prep.onProgress,
  };
}

/** Chargements délégués — doublés dans les tests. */
export interface DepsPreparation {
  preRenderCardIcons: <T>(cartes: T[]) => Promise<T[]>;
  chargerLutPourRendu: (brut: unknown) => Promise<ComposerOptions['rushLut'] | null>;
  rasteriserElements: (elements: ElementLibre[], largeur: number) => Promise<FreeElementRender[] | undefined>;
  chargerImage: (url: string) => Promise<HTMLImageElement | null>;
}

async function depsNavigateur(): Promise<DepsPreparation> {
  const [{ preRenderCardIcons }, { chargerLutPourRendu }, { rasteriserElementsLibres, chargerImagePourRendu }] =
    await Promise.all([
      import('@/lib/icons/prerender'),
      import('@/lib/luts/charger'),
      import('@/lib/icons/elements'),
    ]);
  return {
    preRenderCardIcons: preRenderCardIcons as DepsPreparation['preRenderCardIcons'],
    chargerLutPourRendu: (brut) => chargerLutPourRendu(brut),
    rasteriserElements: rasteriserElementsLibres,
    chargerImage: (url) => chargerImagePourRendu(url),
  };
}

/**
 * Prépare tout ce qui se charge (icônes des cartes, LUT du rush, éléments
 * libres, photo des cartes) puis construit les options. Aucun chargement
 * n'est tenté pour un champ absent : un ancien post ne fait AUCUNE requête
 * de plus qu'avant.
 */
export async function preparerOptionsRendu(
  post: PostARendre,
  chemin: CheminCalendrier,
  onProgress?: ComposerOptions['onProgress'],
  deps?: DepsPreparation,
): Promise<ComposerOptions> {
  const d = deps ?? await depsNavigateur();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta: any = post?.metadata || {};
  const source = cartesSourcePourRendu(meta, chemin);
  const cards = source.aPrerendre ? await d.preRenderCardIcons(source.cartes) : source.cartes;
  // Filtre couleur du rush (`metadata.lut`, référence seule). Absent ou
  // illisible : rendu sans étalonnage, comme avant.
  const rushLut = meta.rushUrls?.[0] ? await d.chargerLutPourRendu(meta.lut) : null;
  const elementsLus = elementsLibresDepuisMetadata(meta);
  const elements = elementsLus.length > 0
    ? await d.rasteriserElements(elementsLus, montageSize(meta?.videoSize, post?.format ?? 'tv').width)
    : undefined;
  const photo = photoCartesValide(meta);
  const cardsSnapshot = photo ? (await d.chargerImage(photo.url)) ?? undefined : undefined;
  return optionsRenduDepuisMetadata(post, chemin, { cards, rushLut, elements, cardsSnapshot, onProgress });
}
