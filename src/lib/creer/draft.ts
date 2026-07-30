'use client';

import { findFont } from '@/lib/fonts/catalog';
import type { LutRef } from '@/lib/luts/types';

/**
 * Brouillon de « Créer (simple) » — écriture, relecture, validation.
 *
 * Un rafraîchissement perdait tout le travail. Ce module le conserve dans
 * `localStorage` et le relit au montage.
 *
 * Deux règles gouvernent tout ce fichier :
 *
 * 1. **Rien de ce qui est relu n'est digne de confiance.** Un brouillon peut
 *    dater d'une version antérieure de l'application, d'un autre onglet, ou
 *    avoir été modifié à la main. Une police retirée du catalogue, une
 *    séquence inconnue, un nombre aberrant : chaque champ est validé
 *    séparément et remplacé par son défaut s'il ne tient pas. Un brouillon
 *    partiellement invalide doit rendre ce qu'il a de bon, pas tout perdre.
 *
 * 2. **Aucune URL `blob:` n'est persistée.** Elle n'existe que dans l'onglet
 *    qui l'a créée : relue après un rafraîchissement, elle pointerait vers
 *    rien et l'aperçu comme l'export échoueraient sur un média fantôme. Les
 *    fichiers déjà téléversés, eux, ont une URL publique et reviennent.
 */

/** Version du format. Un brouillon d'une autre version est ignoré, pas devine. */
export const DRAFT_VERSION = 1;

const KEY_PREFIX = 'studiio_creer_simple_draft';

/**
 * Clé de stockage, par utilisateur quand on le connaît.
 *
 * Deux comptes sur le même navigateur ne doivent pas hériter du brouillon de
 * l'autre — ni voir leur travail écrasé par lui.
 */
export function draftKey(userId?: string | null): string {
  return userId ? `${KEY_PREFIX}:${userId}` : KEY_PREFIX;
}

export interface DraftSequence {
  key: 'intro' | 'cards' | 'video' | 'cta';
  enabled: boolean;
}

/**
 * Ce qui est conserve.
 *
 * Uniquement de la CONFIGURATION : rien de transitoire (section ouverte,
 * onglet d'aperçu, progression d'un rendu, message d'erreur). Restaurer un
 * état de rendu en cours ferait croire à un travail qui ne tourne plus.
 */
export interface Draft {
  version: number;
  savedAt: number;
  started?: boolean;
  step?: number;
  themeId?: string;
  customTopic?: string;
  toneId?: string;
  format?: string;
  colors?: { accent: string; gradStart: string; gradEnd: string; gradientOpacity: number } | null;
  titleStyle?: Record<string, unknown>;
  subtitleStyle?: Record<string, unknown>;
  ctaStyle?: Record<string, unknown>;
  watermarkOverride?: string | null;
  watermarkEnabled?: boolean;
  sequences?: DraftSequence[];
  introDuration?: number;
  cardsDuration?: number;
  videoDuration?: number;
  ctaDuration?: number;
  generated?: unknown;
  audioKeyframes?: unknown;
  musicUrl?: string;
  musicName?: string;
  voiceUrl?: string;
  voiceName?: string;
  musicVolume?: number;
  voiceVolume?: number;
  rushUrl?: string;
  rushName?: string;
  rushIsClip?: boolean;
  /**
   * Étalonnage du rush. **La référence seule** — jamais la table parsée : une
   * `.cube` de 6 Mo dans le brouillon ferait sauter le quota `localStorage`,
   * et l'auto-sauvegarde échouerait ensuite en silence pour tout le reste.
   */
  lut?: LutRef;
  scheduledDate?: string;
}

/**
 * Référence de LUT relue.
 *
 * Une URL `blob:` est écartée comme partout ailleurs dans ce fichier, et tout
 * champ superflu qu'un brouillon ancien porterait est laissé de côté : on
 * reconstruit l'objet plutôt que de recopier ce qu'on a reçu.
 */
function sanitizeLutRef(raw: unknown): LutRef | undefined {
  if (!isObj(raw)) return undefined;
  const url = persistableUrl(raw.url as string);
  if (!url) return undefined;
  return {
    url,
    name: typeof raw.name === 'string' ? raw.name.slice(0, 120) : '',
    intensity: num(raw.intensity, 0, 1, 1),
  };
}

/** URL conservable — jamais un `blob:`, qui meurt avec l'onglet. */
export const persistableUrl = (url: string | null | undefined): string | undefined =>
  url && !url.startsWith('blob:') ? url : undefined;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const num = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback;

const str = (v: unknown, allowed: readonly string[], fallback: string): string =>
  typeof v === 'string' && allowed.includes(v) ? v : fallback;

const hex = (v: unknown, fallback: string): string =>
  typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;

/**
 * Police relue.
 *
 * Une famille retirée du catalogue depuis l'enregistrement doit céder la
 * place au défaut : la garder ferait rendre l'aperçu ET la vidéo dans une
 * police de repli, sans que rien ne l'explique.
 */
const font = (v: unknown, fallback: string): string =>
  typeof v === 'string' && findFont(v) ? v : fallback;

const SEQ_KEYS = ['intro', 'cards', 'video', 'cta'] as const;

/** Séquences relues : les quatre clés, une seule fois chacune, au moins une active. */
export function sanitizeSequences(
  value: unknown,
  fallback: DraftSequence[],
): DraftSequence[] {
  if (!Array.isArray(value)) return fallback;
  const seen = new Set<string>();
  const out: DraftSequence[] = [];
  for (const raw of value) {
    if (!isObj(raw)) continue;
    const key = raw.key;
    if (typeof key !== 'string' || !SEQ_KEYS.includes(key as never) || seen.has(key)) continue;
    seen.add(key);
    out.push({ key: key as DraftSequence['key'], enabled: raw.enabled !== false });
  }
  // Une clé manquante serait une séquence définitivement inaccessible.
  for (const key of SEQ_KEYS) {
    if (!seen.has(key)) out.push({ key, enabled: false });
  }
  // Zéro séquence active ferait retomber le compositeur sur une intro d'une
  // seconde, et le Calendrier afficherait une progression NaN.
  return out.some((s) => s.enabled) ? out : fallback;
}

export interface SanitizeDeps {
  themeIds: readonly string[];
  toneIds: readonly string[];
  formats: readonly string[];
  defaults: {
    themeId: string;
    toneId: string;
    format: string;
    titleStyle: Record<string, unknown>;
    subtitleStyle: Record<string, unknown>;
    ctaStyle: Record<string, unknown>;
    sequences: DraftSequence[];
    durations: { intro: number; cards: number; video: number; cta: number };
  };
  /** Dernière étape atteignable — on ne restaure jamais l'écran d'envoi. */
  maxStep: number;
}

/**
 * Transforme un brouillon brut en valeurs sûres.
 *
 * Renvoie `null` quand il n'y a rien d'exploitable : l'appelant garde alors
 * ses défauts, c'est-à-dire le comportement d'avant cette fonctionnalité.
 */
export function sanitizeDraft(raw: unknown, deps: SanitizeDeps): Draft | null {
  if (!isObj(raw) || raw.version !== DRAFT_VERSION) return null;
  const d = deps.defaults;

  const titleStyle = isObj(raw.titleStyle) ? raw.titleStyle : {};
  const subtitleStyle = isObj(raw.subtitleStyle) ? raw.subtitleStyle : {};
  const ctaStyle = isObj(raw.ctaStyle) ? raw.ctaStyle : {};

  const colors = isObj(raw.colors)
    ? {
        accent: hex(raw.colors.accent, '#7C3AED'),
        gradStart: hex(raw.colors.gradStart, '#7C3AED'),
        gradEnd: hex(raw.colors.gradEnd, '#EC4899'),
        gradientOpacity: num(raw.colors.gradientOpacity, 0, 1, 0.5),
      }
    : null;

  const out: Draft = {
    version: DRAFT_VERSION,
    savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : 0,
    started: raw.started === true,
    // L'écran d'envoi n'est jamais restauré : il annonce un rendu et un débit
    // qui n'ont pas eu lieu. Une étape au-delà est RAMENEE à la dernière sûre
    // — repartir de l'étape 1 ferait refaire tout le parcours.
    step:
      typeof raw.step === 'number' && Number.isFinite(raw.step)
        ? Math.min(Math.max(0, Math.floor(raw.step)), deps.maxStep)
        : 0,
    themeId: str(raw.themeId, deps.themeIds, d.themeId),
    customTopic: typeof raw.customTopic === 'string' ? raw.customTopic.slice(0, 300) : '',
    toneId: str(raw.toneId, deps.toneIds, d.toneId),
    format: str(raw.format, deps.formats, d.format),
    colors,
    titleStyle: {
      ...d.titleStyle,
      font: font(titleStyle.font, d.titleStyle.font as string),
      color: hex(titleStyle.color, d.titleStyle.color as string),
      scale: num(titleStyle.scale, 0.2, 3, 1),
      bold: titleStyle.bold !== false,
      italic: titleStyle.italic === true,
      letterSpacing: num(titleStyle.letterSpacing, -10, 40, 0),
      lineHeight: num(titleStyle.lineHeight, 0.5, 4, 1.1),
    },
    subtitleStyle: {
      ...d.subtitleStyle,
      // `null` a un sens ici : « suit le titre ». On ne le remplace pas.
      font: typeof subtitleStyle.font === 'string' && findFont(subtitleStyle.font)
        ? subtitleStyle.font
        : null,
      color: typeof subtitleStyle.color === 'string' ? hex(subtitleStyle.color, '#FFFFFF') : null,
      scale: num(subtitleStyle.scale, 0.2, 3, 1),
    },
    ctaStyle: {
      ...d.ctaStyle,
      font: font(ctaStyle.font, d.ctaStyle.font as string),
      color: hex(ctaStyle.color, d.ctaStyle.color as string),
      // Chaîne vide = « suit la fin du dégradé », un état volontaire.
      subColor: typeof ctaStyle.subColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(ctaStyle.subColor)
        ? ctaStyle.subColor
        : '',
      scale: num(ctaStyle.scale, 0.2, 3, 1),
      bold: ctaStyle.bold !== false,
      italic: ctaStyle.italic === true,
      letterSpacing: num(ctaStyle.letterSpacing, -10, 40, 0),
      lineHeight: num(ctaStyle.lineHeight, 0.5, 4, 1.2),
    },
    watermarkOverride:
      typeof raw.watermarkOverride === 'string' ? raw.watermarkOverride.slice(0, 60) : null,
    watermarkEnabled: raw.watermarkEnabled !== false,
    sequences: sanitizeSequences(raw.sequences, d.sequences),
    introDuration: num(raw.introDuration, 0, 60, d.durations.intro),
    cardsDuration: num(raw.cardsDuration, 0, 60, d.durations.cards),
    videoDuration: num(raw.videoDuration, 0, 60, d.durations.video),
    ctaDuration: num(raw.ctaDuration, 0, 60, d.durations.cta),
    generated: sanitizeGenerated(raw.generated),
    audioKeyframes: Array.isArray(raw.audioKeyframes)
      ? raw.audioKeyframes
          .filter(isObj)
          .slice(0, 200)
          .map((k) => ({
            t: num(k.t, 0, 3600, 0),
            music: num(k.music, 0, 1, 0.5),
            voice: num(k.voice, 0, 1, 1),
            rush: num(k.rush, 0, 1, 1),
          }))
      : undefined,
    // Ces URL sont relues telles quelles : elles ont été filtrées A L'ECRITURE
    // (`persistableUrl`), donc aucune `blob:` n'a pu être enregistrée.
    musicUrl: persistableUrl(raw.musicUrl as string),
    musicName: typeof raw.musicName === 'string' ? raw.musicName : '',
    voiceUrl: persistableUrl(raw.voiceUrl as string),
    voiceName: typeof raw.voiceName === 'string' ? raw.voiceName : '',
    musicVolume: num(raw.musicVolume, 0, 1, 0.5),
    voiceVolume: num(raw.voiceVolume, 0, 1, 1),
    rushUrl: persistableUrl(raw.rushUrl as string),
    rushName: typeof raw.rushName === 'string' ? raw.rushName : '',
    rushIsClip: raw.rushIsClip === true,
    lut: sanitizeLutRef(raw.lut),
    scheduledDate:
      typeof raw.scheduledDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.scheduledDate)
        ? raw.scheduledDate
        : undefined,
  };

  // Sequence « Video » active mais rush disparu — URL `blob:` filtree a
  // l'ecriture, ou fichier expire depuis. La laisser active ferait sortir un
  // montage avec N secondes de vide a la place de la video.
  if (!out.rushUrl) {
    out.sequences = out.sequences!.map((s) =>
      s.key === 'video' ? { ...s, enabled: false } : s,
    );
    out.videoDuration = 0;
  }
  return out;
}

/**
 * Identifiant de carte. Le compteur importe autant que l'horodatage :
 * `Date.now()` seul donnerait le meme `id` a deux cartes creees dans la meme
 * milliseconde, ce que fait une duplication multiple.
 */
let cardIdSeq = 0;
export const newCardId = () => `card-${Date.now().toString(36)}-${(cardIdSeq++).toString(36)}`;

/** Contenu généré relu — la forme entière, ou rien. */
function sanitizeGenerated(raw: unknown): unknown {
  if (!isObj(raw)) return null;
  const { title, subtitle, cards, cta, ctaSub } = raw;
  if (typeof title !== 'string' || !Array.isArray(cards)) return null;
  // Les `id` deja vus. Un brouillon anterieur a l'introduction des `id` n'en a
  // aucun ; un brouillon abime peut en avoir deux fois le meme. Dans les deux
  // cas on en refabrique un, sans quoi l'identite ne vaudrait pas mieux que
  // l'index qu'elle remplace.
  const seen = new Set<string>();
  return {
    title,
    subtitle: typeof subtitle === 'string' ? subtitle : '',
    cta: typeof cta === 'string' ? cta : '',
    ctaSub: typeof ctaSub === 'string' ? ctaSub : '',
    cards: cards
      .filter(isObj)
      .slice(0, 10)
      .map((c) => {
        const id = typeof c.id === 'string' && c.id && !seen.has(c.id) ? c.id : newCardId();
        seen.add(id);
        return {
          id,
          icon: typeof c.icon === 'string' ? c.icon : 'Sparkles',
          title: typeof c.title === 'string' ? c.title : '',
          description: typeof c.description === 'string' ? c.description : '',
          value: typeof c.value === 'string' ? c.value : '',
        };
      }),
  };
}

/** Lit le brouillon. Ne jette jamais : un stockage illisible vaut pas de brouillon. */
export function readDraft(key: string): unknown {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Écrit le brouillon. Ne jette jamais non plus : navigation privée, quota
 * dépassé ou stockage désactivé ne doivent pas interrompre une édition.
 */
export function writeDraft(key: string, draft: Draft): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* rien a faire : le brouillon disparaitra de lui-meme */
  }
}
