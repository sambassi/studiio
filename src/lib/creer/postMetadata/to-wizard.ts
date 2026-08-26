/**
 * `toWizardDraft` — un post enregistré -> l'état du parcours guidé.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE MODULE PRODUIT UN `Draft`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le wizard sait DÉJÀ se remplir à partir d'un objet : il le fait à chaque
 * rafraîchissement avec son brouillon local, par un bloc de `setState` éprouvé
 * et couvert par ses propres tests. Produire la même forme (`Draft`) laisse ce
 * chemin d'application intact — pas une ligne à y changer, et un seul chemin de
 * remplissage à maintenir.
 *
 * L'objet rendu traverse ensuite `sanitizeDraft`, qui borne, valide et écarte ce
 * qui n'est pas exploitable. Une metadata abîmée ne casse donc pas plus l'écran
 * qu'un brouillon abîmé — ce que le dépôt sait déjà encaisser.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA RÈGLE, ET D'OÙ ELLE VIENT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * L'ABSENCE RESTE L'ABSENCE. Aucun défaut n'est injecté, aucune valeur n'est
 * déduite d'une autre. `index.ts` documente trois défauts avérés de la
 * traduction voisine (`toComposerOptions`, retirée du dépôt) : une séquence
 * vidéo fantôme et un repli `videoUrl` contraire au Calendrier viennent tous
 * deux de la même faute — inventer une valeur là où la metadata n'en portait
 * pas. Un champ absent laisse donc le wizard sur SON défaut, jamais sur un
 * défaut fabriqué ici.
 *
 * Corollaire, tout aussi important : `0`, `false`, `''` et `[]` sont des
 * VALEURS. Un `?? 1` sur un volume transformerait un silence voulu en volume
 * plein ; `presence()` ne regarde donc que la présence de la clé.
 *
 * Ce module ne lit aucun stockage, n'appelle aucune API, ne déclenche aucun
 * rendu et ne modifie jamais son argument.
 */

import { DRAFT_VERSION, type Draft } from '../draft';
import { fromPostMetadata } from './from-post';
import type { CanonicalDesign } from './types';

/** Le post tel que le serveur le rend. */
interface PostLu {
  id?: unknown;
  title?: unknown;
  scheduled_date?: unknown;
  metadata?: unknown;
  [cle: string]: unknown;
}

const estObjet = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Copie profonde par valeur : rien de ce qui sort ne pointe vers la metadata. */
const copier = <T,>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/**
 * La valeur SI la clé est présente, `undefined` sinon.
 *
 * `?.` et `??` confondent « absent » et « valant zéro ». Ici la distinction
 * décide entre « le wizard garde son défaut » et « l'utilisateur a réglé 0 ».
 */
function presence(source: unknown, cle: string): unknown {
  if (!estObjet(source)) return undefined;
  return Object.prototype.hasOwnProperty.call(source, cle) ? source[cle] : undefined;
}

/** Les quatre séquences du montage, dans l'ordre où le wizard les affiche. */
const SEQUENCES = ['intro', 'cards', 'video', 'cta'] as const;

/** Les quatre voix, qui portent d'AUTRES noms que les séquences. */
const VOIX = ['titre', 'cartes', 'video', 'cta'] as const;

/** Dimensions connues -> nom de format. Aucune approximation. */
const FORMATS: Array<{ w: number; h: number; nom: string }> = [
  { w: 1080, h: 1920, nom: '9:16' },
  { w: 1080, h: 1080, nom: '1:1' },
  { w: 1920, h: 1080, nom: '16:9' },
];

/**
 * Identité des cartes relues.
 *
 * La metadata enregistrée ne porte pas l'`id` des cartes (le wizard écrit
 * `emoji`/`label`/`value`/`description`). Un identifiant est donc recréé à la
 * lecture : il sert aux groupes et au réordonnancement DANS la session, et
 * repartira dans la metadata sous la même forme qu'avant.
 *
 * Sans `Date.now()` ni aléa : deux lectures du même post donnent les mêmes
 * identifiants, ce qui rend la traduction reproductible et testable.
 */
const idCarte = (index: number) => `card-lu-${index}`;

/** Le format nommé correspondant aux dimensions, ou `undefined`. */
function formatDepuis(videoSize: unknown): string | undefined {
  if (!estObjet(videoSize)) return undefined;
  const w = videoSize.w;
  const h = videoSize.h;
  const trouve = FORMATS.find((f) => f.w === w && f.h === h);
  return trouve?.nom;
}

/**
 * Traduit un post en brouillon.
 *
 * `started: true` toujours : un contenu existant qui rouvrirait sur l'écran
 * d'accueil (« Que voulez-vous créer ? ») donnerait exactement l'impression de
 * perte que ce lot combat.
 */
export function toWizardDraft(post: PostLu): Partial<Draft> {
  const canonique: CanonicalDesign = fromPostMetadata(post?.metadata);
  const meta = estObjet(post?.metadata) ? (post.metadata as Record<string, unknown>) : {};

  const draft: Partial<Draft> = {
    version: DRAFT_VERSION,
    savedAt: 0,
    started: true,
  };

  // ── Textes et cartes ────────────────────────────────────────────────
  // `generated` est ce que le wizard considère comme « le contenu ». Il est
  // toujours produit : un post SANS contenu affiché serait un montage vierge.
  const branding = estObjet(canonique.branding) ? canonique.branding : {};
  const cartesLues = presence(meta, 'cards');
  draft.generated = {
    title: typeof post?.title === 'string' ? post.title : '',
    subtitle: typeof presence(meta, 'subtitle') === 'string' ? (meta.subtitle as string) : '',
    cta: typeof branding.ctaText === 'string' ? branding.ctaText : '',
    ctaSub: typeof branding.ctaSubText === 'string' ? branding.ctaSubText : '',
    cards: Array.isArray(cartesLues)
      ? cartesLues.map((c, i) => {
          const carte = estObjet(c) ? c : {};
          return {
            id: idCarte(i),
            icon: typeof carte.emoji === 'string' ? carte.emoji : '',
            title: typeof carte.label === 'string' ? carte.label : '',
            value: typeof carte.value === 'string' ? carte.value : '',
            description: typeof carte.description === 'string' ? carte.description : '',
          };
        })
      : [],
  };

  // ── Thème et format ─────────────────────────────────────────────────
  const theme = presence(meta, 'theme');
  if (typeof theme === 'string') draft.themeId = theme;
  const format = formatDepuis(presence(meta, 'videoSize'));
  if (format) draft.format = format;

  // ── Séquences : durées et activation ────────────────────────────────
  const sequences = presence(meta, 'sequences');
  if (estObjet(sequences)) {
    const dureeVers: Record<string, 'introDuration' | 'cardsDuration' | 'videoDuration' | 'ctaDuration'> = {
      intro: 'introDuration', cards: 'cardsDuration', video: 'videoDuration', cta: 'ctaDuration',
    };
    for (const cle of SEQUENCES) {
      const v = presence(sequences, cle);
      if (typeof v === 'number') draft[dureeVers[cle]] = v;
    }
    // L'ordre enregistré liste les séquences ACTIVES. Une séquence qui n'y est
    // pas a été désactivée : la rallumer ferait réapparaître un bloc que
    // l'utilisateur avait retiré.
    const ordre = presence(sequences, 'order');
    if (Array.isArray(ordre)) {
      draft.sequences = SEQUENCES.map((key) => ({ key, enabled: ordre.includes(key) }));
    }
  }

  // ── Couleurs ────────────────────────────────────────────────────────
  // Produites seulement si la metadata en porte : `sanitizeDraft` remplacerait
  // sinon un `null` par des couleurs par défaut qui ne sont pas celles du post.
  const design = estObjet(canonique.designOptions) ? canonique.designOptions : {};
  const accent = branding.accentColor;
  const g1 = presence(design, 'gradientColor1');
  const g2 = presence(design, 'gradientColor2');
  const opacite = presence(design, 'gradientOpacity');
  if (typeof accent === 'string' || typeof g1 === 'string' || typeof g2 === 'string') {
    draft.colors = {
      accent: typeof accent === 'string' ? accent : '#7C3AED',
      gradStart: typeof g1 === 'string' ? g1 : '#7C3AED',
      gradEnd: typeof g2 === 'string' ? g2 : '#EC4899',
      gradientOpacity: typeof opacite === 'number' ? opacite : 0.5,
    };
  }

  // ── Animation, placements, éléments libres ──────────────────────────
  const anim = presence(design, 'textAnimation');
  if (typeof anim === 'string') draft.textAnimation = anim;

  const positions = presence(design, 'positions');
  if (estObjet(positions)) {
    const titre = presence(positions, 'title');
    if (estObjet(titre) && typeof titre.x === 'number' && typeof titre.y === 'number') {
      draft.titlePos = { x: titre.x, y: titre.y };
    }
    // Le wizard nomme `ctaPos` ce que la metadata range sous `watermark` :
    // c'est le même bloc à l'écran, et le confondre déplacerait le CTA.
    const filigrane = presence(positions, 'watermark');
    if (estObjet(filigrane) && typeof filigrane.x === 'number' && typeof filigrane.y === 'number') {
      draft.ctaPos = { x: filigrane.x, y: filigrane.y };
    }
    const elements = presence(positions, 'elements');
    if (Array.isArray(elements)) draft.elements = copier(elements) as Draft['elements'];
  }

  // ── Médias ──────────────────────────────────────────────────────────
  const poster = presence(meta, 'posterUrl');
  if (typeof poster === 'string') draft.posterUrl = poster;

  // `rushUrls[0]` UNIQUEMENT. Aucun repli sur `metadata.videoUrl` : sur les
  // posts anciens cette clé porte le MONTAGE, pas un rush — le Calendrier
  // l'ignore volontairement, et le repli réinjecterait une vidéo finale en fond.
  const rushs = presence(meta, 'rushUrls');
  if (Array.isArray(rushs) && typeof rushs[0] === 'string') draft.rushUrl = rushs[0];

  // ── Audio ───────────────────────────────────────────────────────────
  const musique = presence(meta, 'musicUrl');
  if (typeof musique === 'string') draft.musicUrl = musique;
  const voix = presence(meta, 'voiceUrl');
  if (typeof voix === 'string') draft.voiceUrl = voix;
  const volMusique = presence(meta, 'musicVolume');
  if (typeof volMusique === 'number') draft.musicVolume = volMusique;
  const volVoix = presence(meta, 'voiceVolume');
  if (typeof volVoix === 'number') draft.voiceVolume = volVoix;
  const keyframes = presence(meta, 'audioKeyframes');
  if (keyframes !== undefined) draft.audioKeyframes = copier(keyframes);

  const voixParSequence = presence(meta, 'sequenceVoiceUrls');
  if (estObjet(voixParSequence)) {
    const out: NonNullable<Draft['sequenceVoices']> = {};
    for (const cle of VOIX) {
      const url = presence(voixParSequence, cle);
      // Seule l'URL est enregistrée dans la metadata : le texte, lui, n'y est
      // pas. Le laisser vide est exact — l'inventer serait pire.
      if (typeof url === 'string') out[cle] = { text: '', audioUrl: url };
    }
    if (Object.keys(out).length > 0) draft.sequenceVoices = out;
  }

  // ── Groupes de cartes ───────────────────────────────────────────────
  const groupes = presence(meta, 'cardGroups');
  if (Array.isArray(groupes)) draft.cardGroups = copier(groupes) as Draft['cardGroups'];

  // ── Date : elle vient de la LIGNE du post, pas de sa metadata ───────
  if (typeof post?.scheduled_date === 'string') draft.scheduledDate = post.scheduled_date;

  return draft;
}
