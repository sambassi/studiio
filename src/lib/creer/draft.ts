'use client';

import { findFont } from '@/lib/fonts/catalog';
import { TRANSITION_KEYS } from '@/lib/video-composer';
import { TEXT_ANIMATION_KEYS } from '@/lib/creer/textAnimation';

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
  /**
   * Style de transition entre sequences. Absent = le fondu enchaine, que le
   * compositeur applique de toute facon a un montage qui ne demande rien.
   */
  transition?: string;
  /** Animation d'apparition du texte. Absente = aucune, le rendu d'hier. */
  textAnimation?: string;
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
  /**
   * Voix off PAR SEQUENCE. Absent = aucune, ce qui est le cas de tous les
   * brouillons anterieurs : le montage retombe alors sur la voix unique
   * `voiceUrl`, exactement comme avant.
   *
   * Seuls le TEXTE et l'URL sont relus. La duree ne l'est PAS : elle est
   * mesuree sur l'audio a chaque chargement, et une valeur relue d'un
   * brouillon pourrait ne plus correspondre au fichier — ce qui calerait la
   * sequence sur une duree fausse.
   */
  sequenceVoices?: Record<string, { text: string; audioUrl?: string; source?: string; ttsVoice?: string }>;
  /** Textes que l'utilisateur a repris a la main : le pre-remplissage les respecte. */
  sequenceVoicesUserEdited?: Record<string, boolean>;
  musicVolume?: number;
  voiceVolume?: number;
  rushUrl?: string;
  rushName?: string;
  rushIsClip?: boolean;
  scheduledDate?: string;
  /**
   * Placement fait a la main. ABSENT = « rien n'a ete deplace », et c'est le
   * cas de tous les brouillons anterieurs : l'assistant garde alors ses
   * positions d'origine, au pixel.
   *
   * Ces trois champs sont volontairement optionnels ET annulables sans repli :
   * une valeur abimee doit rendre le placement PAR DEFAUT, pas une position
   * approchee — un titre a demi hors cadre serait pire que le titre d'origine.
   */
  titlePos?: { x: number; y: number };
  ctaPos?: { x: number; y: number };
  /**
   * Emplacements libres des cartes, avec le FORMAT dans lequel ils ont ete
   * mesures : `h` est un % de la hauteur du conteneur, laquelle varie en sens
   * inverse de la taille des cartes d'un format a l'autre.
   */
  cardBoxes?: { format: string; boxes: Record<string, { x: number; y: number; w: number; h: number }> };
  /** Groupes d'edition. Sans effet sur le montage exporte. */
  cardGroups?: { id: string; cardIds: string[] }[];
  /**
   * Elements libres poses dans la zone des cartes. Absent = aucun element,
   * ce qui est le cas de tous les brouillons anterieurs.
   */
  elements?: { id: string; iconName: string; x: number; y: number; sizePct: number; color: string }[];
  /**
   * Photo d'affiche retenue. Absente = fond degrade, le comportement de tous
   * les brouillons anterieurs.
   */
  posterUrl?: string;
  /** Recadrage de l'affiche. Absent = cadrage « cover » centre. */
  posterTransform?: { scale: number; offsetX: number; offsetY: number };
  /**
   * Fonds propres a une sequence. Absent = chaque sequence herite de
   * l'affiche globale, le comportement de tous les brouillons anterieurs.
   */
  seqBackgrounds?: Partial<Record<'titre' | 'cartes' | 'video' | 'cta', {
    url: string;
    transform: { scale: number; offsetX: number; offsetY: number };
  }>>;
  /** Source de recherche preferee. */
  imageSource?: 'pexels' | 'unsplash';
  /** Nombre de montages du lot. Absent ou 1 = un seul montage, comme avant. */
  batchCount?: number;
  /** Affiches retenues pour le lot, dans l'ordre. */
  batchPhotoUrls?: string[];
  /** Comment les affiches du lot sont attribuees. Absent = automatique. */
  batchPhotoMode?: 'auto' | 'manuel';
}

/** Nombre d'emplacements et de groupes relus au maximum — garde-fou anti-brouillon abime. */
const MAX_BOXES = 24;
const MAX_GROUPS = 12;
const MAX_ELEMENTS = 24;

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

/** Identifiants des cartes du contenu relu, ou `null` s'il n'y a pas de contenu. */
function cardIdsOf(generated: unknown): string[] | null {
  if (!isObj(generated) || !Array.isArray(generated.cards)) return null;
  return generated.cards
    .map((c) => (isObj(c) && typeof c.id === 'string' ? c.id : ''))
    .filter(Boolean);
}

/** Un pourcentage de placement : fini, et dans le cadre. */
const pct = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;

/**
 * Position relue, ou `undefined`.
 *
 * Pas de repli sur une valeur approchee : une coordonnee abimee doit rendre le
 * placement d'ORIGINE. Restaurer un `x` valide avec un `y` invente poserait le
 * titre a un endroit que l'utilisateur n'a jamais choisi.
 */
function sanitizePos(raw: unknown): { x: number; y: number } | undefined {
  if (!isObj(raw)) return undefined;
  const x = pct(raw.x);
  const y = pct(raw.y);
  return x === null || y === null ? undefined : { x, y };
}

/**
 * Emplacements libres relus.
 *
 * Tout ou rien : une seule boite abimee rend l'ensemble inutilisable, parce
 * qu'une carte sans emplacement dans une disposition libre se rendrait sans
 * position, empilee dans un coin avec les autres. Le format doit etre connu,
 * sinon les hauteurs seraient rejouees a la mauvaise echelle.
 */
function sanitizeCardBoxes(
  raw: unknown,
  format: string,
  cardIds: string[] | null,
): Draft['cardBoxes'] {
  // Sans contenu relu, il n'y a aucune carte a placer : des emplacements
  // subsistants seraient effaces au premier rendu, en detruisant au passage le
  // brouillon qui les portait.
  if (!cardIds || cardIds.length === 0) return undefined;
  // Le format de mesure doit etre CELUI du brouillon : `h` est un % de la
  // hauteur du conteneur, laquelle varie en sens inverse de la taille des
  // cartes d'un format a l'autre. Rejouer une mesure 9:16 en 16:9 ecrase les
  // cartes les unes sur les autres, dans la video comprise.
  if (!isObj(raw) || raw.format !== format) return undefined;
  if (!isObj(raw.boxes)) return undefined;
  const entries = Object.entries(raw.boxes);
  if (entries.length === 0 || entries.length > MAX_BOXES) return undefined;
  // Sans prototype : `boxes['__proto__'] = …` sur un litteral `{}` declenche
  // l'accesseur d'`Object.prototype` et avale l'entree en silence, ce que le
  // « tout ou rien » ci-dessous interdit precisement.
  const boxes: Record<string, { x: number; y: number; w: number; h: number }> =
    Object.create(null);
  for (const [id, b] of entries) {
    if (typeof id !== 'string' || !id || !isObj(b)) return undefined;
    // Un emplacement qui ne designe aucune carte du contenu relu est le signe
    // d'un brouillon incoherent : l'accepter ferait disparaitre la disposition
    // au premier rendu, en detruisant au passage ce qui etait enregistre.
    if (!cardIds.includes(id)) return undefined;
    const x = pct(b.x); const y = pct(b.y);
    const w = pct(b.w); const h = pct(b.h);
    // Une carte de largeur ou de hauteur nulle serait invisible et
    // insaisissable — irrattrapable sans repartir de zero.
    if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) return undefined;
    // La carte doit tenir ENTIEREMENT dans le conteneur. Borner x et y a
    // [0,100] ne suffit pas : une carte a `x=95` large de 100 % sort de la
    // zone photographiee, donc du montage. C'est l'invariant que le
    // deplacement et la duplication maintiennent en permanence.
    if (x + w > 100 || y + h > 100) return undefined;
    boxes[id] = { x, y, w, h };
  }
  // Toutes les cartes doivent etre couvertes : une carte sans emplacement dans
  // une disposition libre se rendrait sans position, empilee dans un coin.
  if (cardIds.some((id) => !boxes[id])) return undefined;
  return { format, boxes: { ...boxes } };
}

/**
 * Groupes relus.
 *
 * Les invariants du mode edition sont retablis a la lecture : au moins deux
 * cartes par groupe, et une carte dans UN seul groupe. Un brouillon abime
 * pourrait sinon reintroduire des groupes fantomes qu'aucune action de l'ecran
 * ne sait defaire.
 */
function sanitizeCardGroups(raw: unknown, connus: string[] | null): Draft['cardGroups'] {
  if (!Array.isArray(raw) || !connus || connus.length === 0) return undefined;
  const vus = new Set<string>();
  const out: { id: string; cardIds: string[] }[] = [];
  for (const g of raw.slice(0, MAX_GROUPS)) {
    if (!isObj(g) || typeof g.id !== 'string' || !g.id || !Array.isArray(g.cardIds)) continue;
    const cardIds: string[] = [];
    for (const cid of g.cardIds) {
      if (typeof cid !== 'string' || !cid || vus.has(cid)) continue;
      // Un groupe qui designe une carte absente du contenu relu n'a plus
      // d'objet ; le garder ferait rester un groupe qu'aucun bouton ne defait.
      if (!connus.includes(cid)) continue;
      vus.add(cid);
      cardIds.push(cid);
    }
    if (cardIds.length >= 2) out.push({ id: g.id, cardIds });
  }
  return out.length ? out : undefined;
}

/**
 * Elements libres relus.
 *
 * Chaque element est valide SEPAREMENT — contrairement aux emplacements des
 * cartes, un element abime n'en empeche aucun autre d'exister : ils sont
 * independants, et en perdre un vaut mieux que de tous les perdre.
 *
 * Le nom d'icone n'est PAS verifie contre la bibliotheque : `CardIcon` retombe
 * deja sur une icone par defaut pour un nom inconnu, et refuser ici ferait
 * disparaitre un element au moindre renommage cote lucide.
 */
/** Cles de sequence acceptees dans le brouillon des voix. */
const VOICE_KEYS = ['titre', 'cartes', 'video', 'cta'] as const;

/**
 * Voix par sequence relues d'un brouillon.
 *
 * Une entree dont l'URL est inexploitable garde son TEXTE : le travail de
 * redaction survit, seul l'audio est a regenerer. C'est le contraire qui
 * serait penible — reecrire un texte parce qu'un fichier a expire.
 */
function sanitizeSequenceVoices(raw: unknown): Draft['sequenceVoices'] {
  if (!isObj(raw)) return undefined;
  const out: NonNullable<Draft['sequenceVoices']> = {};
  for (const key of VOICE_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (!isObj(v)) continue;
    const text = typeof v.text === 'string' ? v.text.slice(0, 2000) : '';
    const audioUrl = persistableUrl(v.audioUrl as string);
    // Ni texte ni audio : l'entree ne dit rien, on ne l'ecrit pas.
    if (!text && !audioUrl) continue;
    const source = v.source === 'tts' || v.source === 'record' ? v.source : undefined;
    out[key] = {
      text,
      // `source` sans `audioUrl` n'aurait aucun sens : l'un ne va pas sans l'autre.
      ...(audioUrl ? { audioUrl, source: source ?? 'tts' } : {}),
      ...(typeof v.ttsVoice === 'string' && v.ttsVoice ? { ttsVoice: v.ttsVoice } : {}),
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Marqueurs « texte repris a la main », par sequence. */
function sanitizeVoicesUserEdited(raw: unknown): Draft['sequenceVoicesUserEdited'] {
  if (!isObj(raw)) return undefined;
  const out: Record<string, boolean> = {};
  for (const key of VOICE_KEYS) {
    if ((raw as Record<string, unknown>)[key] === true) out[key] = true;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeElements(raw: unknown): Draft['elements'] {
  if (!Array.isArray(raw)) return undefined;
  const out: NonNullable<Draft['elements']> = [];
  for (const e of raw.slice(0, MAX_ELEMENTS)) {
    if (!isObj(e)) continue;
    const x = pct(e.x);
    const y = pct(e.y);
    if (x === null || y === null) continue;
    if (typeof e.id !== 'string' || !e.id) continue;
    if (typeof e.iconName !== 'string' || !e.iconName) continue;
    // Taille en % de la largeur du plateau, bornee : ni un element invisible,
    // ni un aplat qui couvre tout le cadre. Le champ s'appelle `sizePct` et
    // non `size` : un brouillon ecrit avec l'ancienne unite (des pixels) est
    // ainsi ecarte plutot que rejoue a une echelle absurde.
    if (typeof e.sizePct !== 'number' || !Number.isFinite(e.sizePct) || e.sizePct <= 0 || e.sizePct > 100) continue;
    const color = typeof e.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(e.color) ? e.color : '#FFFFFF';
    out.push({ id: e.id, iconName: e.iconName, x, y, sizePct: e.sizePct, color });
  }
  return out.length ? out : undefined;
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
    // Valide contre la liste du compositeur, jamais contre une copie : un
    // style retire la-bas doit cesser d'etre relu ici.
    transition: TRANSITION_KEYS.includes(raw.transition as never)
      ? (raw.transition as string)
      : undefined,
    textAnimation: TEXT_ANIMATION_KEYS.includes(raw.textAnimation as never)
      ? (raw.textAnimation as string)
      : undefined,
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
    sequenceVoices: sanitizeSequenceVoices(raw.sequenceVoices),
    sequenceVoicesUserEdited: sanitizeVoicesUserEdited(raw.sequenceVoicesUserEdited),
    musicVolume: num(raw.musicVolume, 0, 1, 0.5),
    voiceVolume: num(raw.voiceVolume, 0, 1, 1),
    rushUrl: persistableUrl(raw.rushUrl as string),
    rushName: typeof raw.rushName === 'string' ? raw.rushName : '',
    rushIsClip: raw.rushIsClip === true,
    scheduledDate:
      typeof raw.scheduledDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.scheduledDate)
        ? raw.scheduledDate
        : undefined,
    titlePos: sanitizePos(raw.titlePos),
    ctaPos: sanitizePos(raw.ctaPos),
  };

  // Le placement des cartes se relit APRES le contenu : sans ce croisement,
  // un brouillon dont le contenu a ete rejete gardait des emplacements et des
  // groupes orphelins, que l'ecran effacait ~400 ms plus tard en reecrivant le
  // brouillon — le travail etait perdu sans que personne ait rien fait.
  const cardIds = cardIdsOf(out.generated);
  out.cardBoxes = sanitizeCardBoxes(raw.cardBoxes, out.format!, cardIds);
  out.cardGroups = sanitizeCardGroups(raw.cardGroups, cardIds);
  // Les elements ne dependent d'aucune carte : ils survivent a une
  // regeneration du contenu.
  out.elements = sanitizeElements(raw.elements);
  // `persistableUrl` ecarte les `blob:`, qui meurent avec l'onglet. Les data
  // URL sont ecartees ici en plus : une photo encodee en base64 pese plusieurs
  // Mo et ferait sauter le quota du stockage local a la premiere sauvegarde.
  out.posterUrl =
    typeof raw.posterUrl === 'string' && /^https?:\/\//.test(raw.posterUrl)
      ? raw.posterUrl
      : undefined;
  // Un recadrage abime rognerait la photo sur des reperes absurdes : on
  // n'accepte que des nombres finis dans des bornes utiles.
  const rt = raw.posterTransform;
  out.posterTransform =
    isObj(rt)
    && typeof rt.scale === 'number' && Number.isFinite(rt.scale) && rt.scale >= 1 && rt.scale <= 3
    && typeof rt.offsetX === 'number' && Number.isFinite(rt.offsetX) && Math.abs(rt.offsetX) <= 1
    && typeof rt.offsetY === 'number' && Number.isFinite(rt.offsetY) && Math.abs(rt.offsetY) <= 1
      ? { scale: rt.scale, offsetX: rt.offsetX, offsetY: rt.offsetY }
      : undefined;
  // Fonds par sequence : chaque entree est validee SEPAREMENT — elles sont
  // independantes, et en perdre une vaut mieux que de toutes les perdre.
  const bruts = raw.seqBackgrounds;
  if (isObj(bruts)) {
    const retenus: NonNullable<Draft['seqBackgrounds']> = {};
    for (const cle of ['titre', 'cartes', 'video', 'cta'] as const) {
      const b = bruts[cle];
      if (!isObj(b) || typeof b.url !== 'string' || !/^https?:\/\//.test(b.url)) continue;
      const t = b.transform;
      const valide =
        isObj(t)
        && typeof t.scale === 'number' && Number.isFinite(t.scale) && t.scale >= 1 && t.scale <= 3
        && typeof t.offsetX === 'number' && Number.isFinite(t.offsetX) && Math.abs(t.offsetX) <= 1
        && typeof t.offsetY === 'number' && Number.isFinite(t.offsetY) && Math.abs(t.offsetY) <= 1;
      retenus[cle] = {
        url: b.url,
        // Un recadrage abime n'annule pas le fond : on retombe sur le cadrage
        // neutre, qui reste juste.
        transform: valide
          ? { scale: t.scale as number, offsetX: t.offsetX as number, offsetY: t.offsetY as number }
          : { scale: 1, offsetX: 0, offsetY: 0 },
      };
    }
    out.seqBackgrounds = Object.keys(retenus).length ? retenus : undefined;
  }
  out.imageSource = raw.imageSource === 'unsplash' ? 'unsplash' : raw.imageSource === 'pexels' ? 'pexels' : undefined;
  // Un lot relu hors bornes debiterait des credits que l'ecran n'a jamais
  // proposes : on le ramene dans la plage, ou on l'oublie.
  out.batchCount =
    typeof raw.batchCount === 'number' && Number.isFinite(raw.batchCount) && raw.batchCount >= 1
      ? Math.min(10, Math.floor(raw.batchCount))
      : undefined;
  out.batchPhotoUrls = Array.isArray(raw.batchPhotoUrls)
    ? raw.batchPhotoUrls.filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u)).slice(0, 10)
    : undefined;
  if (out.batchPhotoUrls && out.batchPhotoUrls.length === 0) out.batchPhotoUrls = undefined;
  out.batchPhotoMode = raw.batchPhotoMode === 'manuel' ? 'manuel' : raw.batchPhotoMode === 'auto' ? 'auto' : undefined;

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
