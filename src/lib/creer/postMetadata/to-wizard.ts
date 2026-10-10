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

import { rushSegmentsDepuisMetadata, rushsDepuisSegments, estPlanMontage, rushsDuPlan } from '@/lib/creer/multi-rush';
import { DRAFT_VERSION, type Draft } from '../draft';
import { resoudreTextes } from '../textesCanoniques';
import { fromPostMetadata } from './from-post';
import { idsCartesLues } from './cartes';
import { lutRefValide } from '@/lib/luts/bibliotheque';
import type { CanonicalDesign } from './types';
import { fondsPourMetadata, recadrageValide } from './rendu-fidele';

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
 * L'`id` enregistré dans `metadata.cards` fait foi ; un post qui n'en porte
 * pas reçoit `card-lu-N`. La dérivation vit dans `postMetadata/cartes.ts`
 * (`idsCartesLues`), PARTAGÉE avec l'enregistrement : deux calculs
 * divergents recolleraient une carte sur une autre, ou un groupe sur la
 * mauvaise carte.
 *
 * Sans `Date.now()` ni aléa : deux lectures du même post donnent les mêmes
 * identifiants, ce qui rend la traduction reproductible et testable.
 */
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

  // ── Les deux CTA passent par le RESOLVEUR CANONIQUE ─────────────────
  //
  // Lire `branding.ctaText` en direct etait faux une fois sur deux : cette cle
  // ne porte le GROS texte que chez l'Assistant et l'Autopilote. Chez
  // `creer-avance` (`page.tsx:5258`) et l'Agent IA (`api/agent/generate:216`)
  // elle porte la PETITE ligne — et c'est ainsi que le compositeur la peint
  // (`video-composer.ts:2807`). Le champ « CTA » affichait donc le sous-texte
  // sur ces posts, et l'enregistrement le reecrivait a la place du gros.
  //
  // Le resolveur tranche par la FORME des cles, pas par leur nom. `valeur`
  // vaut `null` seulement si rien ne la portait : `''` reste une extinction
  // volontaire, jamais un defaut.
  const textes = resoudreTextes(post?.metadata);
  const idsLus = Array.isArray(cartesLues) ? idsCartesLues(cartesLues) : [];
  draft.generated = {
    title: typeof post?.title === 'string' ? post.title : '',
    subtitle: typeof presence(meta, 'subtitle') === 'string' ? (meta.subtitle as string) : '',
    cta: textes.ctaPrincipal.valeur ?? '',
    ctaSub: textes.ctaSecondaire.valeur ?? '',
    cards: Array.isArray(cartesLues)
      ? cartesLues.map((c, i) => {
          const carte = estObjet(c) ? c : {};
          // #500 : l'Autopilote écrit `icon` / `title`, Créer `emoji` /
          // `label`. Ne lire que la seconde forme vidait titre ET icône d'une
          // vidéo Autopilote rouverte dans Créer — puis de toutes celles
          // créées à partir d'elle (cartes réduites à leur valeur).
          const texte = (...v: unknown[]) => (v.find((x) => typeof x === 'string' && x.trim()) as string | undefined) ?? '';
          return {
            id: idsLus[i],
            icon: texte(carte.emoji, carte.icon),
            title: texte(carte.label, carte.title),
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
  // Même clé que l'écriture du parcours et que l'Autopilote. `sanitizeDraft`
  // écarte ensuite un nom de transition inconnu.
  const transition = presence(design, 'transition');
  if (typeof transition === 'string') draft.transition = transition;

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
  // Recadrage de l'affiche et fonds par séquence : relus tels qu'écrits,
  // bornés et filtrés ensuite par `sanitizeDraft`. Sans eux, « Modifier »
  // rouvrait le post cadré au centre et sans ses fonds propres — et un
  // enregistrement les aurait effacés du montage suivant.
  const recadrage = recadrageValide(presence(meta, 'posterTransform'));
  if (recadrage) draft.posterTransform = recadrage;
  // Recadrage du rush : relu tel qu'écrit — sinon « Modifier » rouvrirait la vidéo recentrée.
  const recadrageRush = recadrageValide(presence(meta, 'rushTransform'));
  if (recadrageRush) draft.rushTransform = recadrageRush;
  const fonds = fondsPourMetadata(presence(meta, 'seqBackgrounds'));
  if (Object.keys(fonds).length > 0) draft.seqBackgrounds = fonds;

  // `rushUrls[0]` UNIQUEMENT. Aucun repli sur `metadata.videoUrl` : sur les
  // posts anciens cette clé porte le MONTAGE, pas un rush — le Calendrier
  // l'ignore volontairement, et le repli réinjecterait une vidéo finale en fond.
  const rushs = presence(meta, 'rushUrls');
  if (Array.isArray(rushs) && typeof rushs[0] === 'string') draft.rushUrl = rushs[0];
  // Multi-rush : la liste ORDONNEE n'est relue que depuis `rushSegments`
  // (écrit par Créer), jamais depuis `rushUrls` seul — l'Agent IA y range sa
  // banque. Sans segments : `rushUrls[0]` seul, comme avant.
  const segments = rushSegmentsDepuisMetadata(presence(meta, 'rushSegments'));
  if (segments && estPlanMontage(segments)) {
    // Smart montage : l'écran liste les RUSHES (sans doublon), pas les
    // extraits — le plan est recalculé au prochain envoi.
    const [premier, ...suivants] = rushsDuPlan(segments);
    draft.rushUrl = premier.url;
    draft.rushSuivants = suivants.map((r) => ({ url: r.url, name: '', secondes: null }));
  } else if (segments) {
    draft.rushUrl = segments[0].url;
    draft.rushSecondes = Math.round((segments[0].fin - segments[0].debut) * 1000) / 1000;
    draft.rushSuivants = rushsDepuisSegments(segments.slice(1)).map((r) => ({ url: r.url, name: '', secondes: r.secondes }));
  }

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

  // ── Filtre couleur du rush ──────────────────────────────────────────
  // La reference seule, validee comme celle d'un brouillon. Invalide ou
  // absente : aucun filtre, comme avant.
  const lut = lutRefValide(presence(meta, 'lut'));
  if (lut) draft.lut = lut;

  // ── Groupes de cartes ───────────────────────────────────────────────
  const groupes = presence(meta, 'cardGroups');
  if (Array.isArray(groupes)) draft.cardGroups = copier(groupes) as Draft['cardGroups'];

  // ── Date : elle vient de la LIGNE du post, pas de sa metadata ───────
  if (typeof post?.scheduled_date === 'string') draft.scheduledDate = post.scheduled_date;

  return draft;
}
