'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import {
  Wand2,
  Rocket,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Sparkles,
  Check,
  AlertTriangle,
  CalendarPlus,
  RefreshCw,
  MonitorPlay,
  GripVertical,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  Music,
  Film,
  Trash2,
  RotateCcw,
  X,
} from 'lucide-react';
import { generateSmartContent } from '@/lib/smart-content';
import { composeAndUpload, CURRENT_COMPOSER_VERSION } from '@/lib/video-composer';
import { AudioStudioPanel } from '@/components/creer/AudioStudioPanel';
import type { AudioKeyframe } from '@/lib/creer/audioDucking';
import { pointToPct, grabOffset, clampToBox, type Pos } from '@/lib/creer/dragPosition';
import { MediaLibrary } from '@/components/shared/MediaLibrary';
import ClipDetectorModal, { type ClipSource } from '@/components/media/ClipDetectorModal';
import { CardIcon } from '@/components/ui/CardIcon';
import ColorWheel from '@/components/ui/ColorWheel';
// Catalogue de polices — LA source unique, partagee avec le compositeur.
// Deux listes finiraient par diverger, et la video ne ressemblerait plus a
// l'apercu.
import { FONT_GROUPS, fontStack, ensureFontLoaded, preloadCatalogPreview } from '@/lib/fonts/catalog';
import { useSession } from 'next-auth/react';
import {
  DRAFT_VERSION,
  draftKey,
  readDraft,
  sanitizeDraft,
  writeDraft,
  clearDraft,
  persistableUrl as persistableDraftUrl,
  newCardId,
  type Draft,
} from '@/lib/creer/draft';
import { useBranding, NEUTRAL_BRANDING } from '@/lib/hooks/useBranding';
import { preRenderCardIcons } from '@/lib/icons/prerender';
import { Card, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

/**
 * Parcours « Créer avec l'assistant » (F5) — couche NON DESTRUCTIVE.
 *
 * Ce composant n'importe QUE des modules existants sans les modifier :
 *   - generateSmartContent (src/lib/smart-content.ts) pour le contenu
 *   - CardIcon (src/components/ui/CardIcon.tsx) pour les icônes de cartes
 *   - POST /api/posts pour la création du post calendrier
 *
 * Choix d'implémentation documentés :
 *
 * 1. `generateSmartContent` est importé DIRECTEMENT plutôt que via
 *    POST /api/content/generate, parce que cette route plafonne le résultat à
 *    3 cartes (route.ts, `result.cards.slice(0, 3)`) alors qu'il en faut 5.
 *    Modifier la route changerait le fallback de l'éditeur existant : exclu.
 *    L'import direct est déjà pratiqué par /dashboard/infographic.
 *
 * 2. `generateSmartContent` ne produit NI CTA NI notion de ton — elle renvoie
 *    exactement { subtitle, tagLine, cards[5] }. Le ton choisi à l'étape 2
 *    pilote donc ce qui est réellement sous notre contrôle : le texte du CTA
 *    et le seed (donc la variante de contenu). Il ne « reformule » pas les
 *    cartes, la bibliothèque ne l'permet pas.
 */

// ── Thèmes ────────────────────────────────────────────────────────────────
// `CONTENT_THEMES` de /dashboard/creer n'est pas exporté et ce fichier ne doit
// pas être modifié. On redéclare donc une liste locale dont les libellés sont
// choisis pour tomber sur les bonnes entrées de la base de connaissances
// (le matching se fait sur du texte libre, pas sur un slug).
const THEMES: Array<{ id: string; label: string; icon: string; topic: string }> = [
  { id: 'sommeil', label: 'Sommeil & récupération', icon: 'Moon', topic: 'sommeil' },
  { id: 'nutrition', label: 'Nutrition', icon: 'Salad', topic: 'nutrition' },
  { id: 'energie', label: 'Énergie & cardio', icon: 'Zap', topic: 'energie' },
  { id: 'stress', label: 'Stress & mental', icon: 'Brain', topic: 'stress' },
  { id: 'danse', label: 'Danse', icon: 'PersonStanding', topic: 'danse' },
  { id: 'motivation', label: 'Motivation', icon: 'Flame', topic: 'motivation' },
  { id: 'eau', label: 'Hydratation', icon: 'Droplet', topic: 'eau' },
  { id: 'beauty', label: 'Beauté', icon: 'Sparkles', topic: 'beauty' },
  { id: 'finance', label: 'Finance', icon: 'Wallet', topic: 'finance' },
  { id: 'productivity', label: 'Productivité', icon: 'Target', topic: 'productivity' },
  { id: 'food', label: 'Cuisine', icon: 'Utensils', topic: 'food' },
  { id: 'travel', label: 'Voyage', icon: 'Plane', topic: 'travel' },
];

// ── Tons ──────────────────────────────────────────────────────────────────
// Le ton pilote le CTA (que smart-content ne fournit pas) et le décalage de
// seed, donc la variante de contenu retenue.
const TONES: Array<{
  id: string;
  label: string;
  hint: string;
  cta: string;
  ctaSub: string;
  seedOffset: number;
}> = [
  {
    id: 'punchy',
    label: 'Punchy',
    hint: 'Direct, qui accroche',
    cta: 'JE ME LANCE',
    ctaSub: 'LIEN EN BIO',
    seedOffset: 0,
  },
  {
    id: 'pedago',
    label: 'Pédagogique',
    hint: 'Explicatif, rassurant',
    cta: 'EN SAVOIR PLUS',
    ctaSub: 'LIEN EN BIO',
    seedOffset: 1,
  },
  {
    id: 'pro',
    label: 'Professionnel',
    hint: 'Sobre, crédible',
    cta: 'DÉCOUVRIR',
    ctaSub: 'LIEN EN BIO',
    seedOffset: 2,
  },
  {
    id: 'friendly',
    label: 'Complice',
    hint: 'Chaleureux, proche',
    cta: 'ON EN PARLE ?',
    ctaSub: 'ÉCRIS-MOI EN DM',
    seedOffset: 3,
  },
];

/**
 * Repli NEUTRE studiio.pro, utilise tant que l'utilisateur n'a pas configure
 * son kit de marque (Reglages -> Branding). Ce ne sont pas les couleurs
 * d'Afroboost : la charte du produit est violet #7C3AED / rose #EC4899.
 *
 * Reprises de NEUTRAL_BRANDING plutot que redeclarees : une seule definition
 * du repli dans toute l'app.
 */
const NEUTRAL_ACCENT = NEUTRAL_BRANDING.accentColor;
const NEUTRAL_GRADIENT_END = NEUTRAL_BRANDING.gradientColor2;
const DARK = '#0A0A0F';

/**
 * Durées des séquences, en secondes. Elles sont passées au compositeur ET
 * écrites dans `metadata.sequences` : une seule source, donc pas de dérive
 * entre la vidéo produite et ce que le Calendrier croit savoir.
 * `video: 0` — valeur de DEPART : tant qu'aucun rush n'est importé, la
 * sequence video est masquee et sa duree nulle. L'import d'un rush la fixe
 * (voir `applyRush`).
 */
const SEQ = { intro: 4, cards: 6, video: 0, cta: 4 } as const;

/**
 * Duree de la sequence video, en secondes, quand un rush vient d'etre importe.
 *
 * On prend la duree REELLE du rush, plafonnee : un rush d'une minute ne doit
 * pas transformer un reel de 14 s en montage d'une minute. En dessous du
 * plafond, la sequence dure exactement le rush — sinon le compositeur fige la
 * derniere image pendant le reste de la sequence.
 * Ce n'est qu'une valeur de depart : le champ « Video » du panneau audio
 * permet ensuite de monter jusqu'a 30 s.
 */
const RUSH_SECONDS = { fallback: 6, min: 1, max: 10 } as const;

/**
 * Duree d'un rush, lue dans ses metadonnees — `null` si elle est illisible.
 *
 * `preload='metadata'` ne telecharge que l'entete : un rush de 40 Mo n'est pas
 * rapatrie pour cette seule mesure. Le delai de garde evite qu'un fichier dont
 * l'entete n'arrive jamais (atome `moov` en fin de fichier sur un stockage sans
 * requetes de plage) laisse la promesse pendante et bloque le bouton.
 *
 * ⚠️ Cas du WebM produit par `MediaRecorder` — c'est-a-dire TOUT extrait rendu
 * par « Temps forts » (`extractClip`, clip-detector.ts) : son en-tete EBML ne
 * porte aucune duree, et Chrome renvoie donc `Infinity`. Sans le rattrapage
 * ci-dessous, chaque clip retombait sur la duree par defaut : un temps fort de
 * 3 s laissait 3 s d'image figee, un temps fort de 12 s etait ampute de moitie.
 * Le contournement est celui, connu, du seek au-dela de la fin : le decodeur
 * lit alors le dernier bloc et publie la vraie duree. Il n'est tente QUE sur
 * une duree non finie — un MP4 normal reste mesure sur son seul en-tete.
 */
function probeRushDuration(url: string, timeoutMs = 15000): Promise<number | null> {
  return new Promise((resolve) => {
    const vid = document.createElement('video');
    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      vid.removeAttribute('src');
      vid.load();
      resolve(value && value > 0 ? value : null);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    vid.preload = 'metadata';
    vid.muted = true;
    if (!url.startsWith('blob:') && !url.startsWith('/') && !url.startsWith(location.origin + '/')) {
      vid.crossOrigin = 'anonymous';
    }
    vid.onloadedmetadata = () => {
      const d = vid.duration;
      if (Number.isFinite(d)) {
        finish(d);
        return;
      }
      // Duree absente de l'en-tete : on force le decodeur a atteindre la fin.
      // Selon les moteurs, la vraie valeur apparait ensuite dans `duration`
      // (Chrome) ou dans `currentTime`, ramene a la fin reelle du media.
      vid.onseeked = () => {
        const after = Number.isFinite(vid.duration) ? vid.duration : vid.currentTime;
        finish(Number.isFinite(after) ? after : null);
      };
      vid.ontimeupdate = () => {
        if (Number.isFinite(vid.duration)) finish(vid.duration);
      };
      try {
        vid.currentTime = 1e101;
      } catch {
        finish(null);
      }
    };
    vid.onerror = () => finish(null);
    vid.src = url;
    vid.load();
  });
}

/**
 * Les 4 sequences, dans leur ordre par defaut — le meme que celui du
 * compositeur (intro -> cards -> video -> cta). L'utilisateur peut les
 * reordonner et les desactiver ; `video` part desactivee car ce parcours
 * n'accepte pas de rush.
 */
type SeqKey = 'intro' | 'cards' | 'video' | 'cta';

const SEQ_META: Record<SeqKey, { label: string; hint: string }> = {
  intro: { label: 'Titre', hint: 'Titre et sous-titre' },
  cards: { label: 'Cartes', hint: 'Les points cles' },
  // Le libelle de la sequence video depend du rush importe : il est calcule au
  // rendu (nom du fichier une fois importe), ce hint est l'etat « vide ».
  video: { label: 'Vidéo', hint: 'Importez un rush pour l’activer' },
  cta: { label: 'CTA', hint: "Appel a l'action" },
};

const DEFAULT_SEQUENCES: Array<{ key: SeqKey; enabled: boolean }> = [
  { key: 'intro', enabled: true },
  { key: 'cards', enabled: true },
  { key: 'video', enabled: false },
  { key: 'cta', enabled: true },
];

/**
 * SPEC DE DESIGN PARTAGÉE — une seule définition pour l'aperçu, le
 * compositeur et les métadonnées lues par le Calendrier.
 *
 * Chaque valeur est transmise EXPLICITEMENT au compositeur. Sans cela il
 * applique ses propres défauts, qui diffèrent de l'aperçu — c'est ce qui
 * faisait diverger le titre, le CTA et le fond.
 */
const DESIGN = {
  /** Titre : bord gauche à 8 %, haut à 8 %. Nécessite titleAlign:'left'. */
  titlePos: { x: 8, y: 8 },
  /** Largeur du bloc de titre, en % de la largeur totale. */
  titleWidth: 84,
  titleColor: '#FFFFFF',
  /** CTA : bas-centre. Le defaut du compositeur est y=97 ; on fixe 92. */
  ctaPos: { x: 50, y: 92 },
  ctaWidth: 70,
  ctaColor: '#FFFFFF',
  gradientOpacity: 0.5,
  /**
   * Police. Sans ce champ le compositeur retombe sur 'sans-serif' (Helvetica)
   * alors que l'aperçu et le snapshot des cartes sont en Inter — titre et CTA
   * n'auraient pas la même fonte que les cartes dans la vidéo.
   * 'Inter' fait partie des familles que le compositeur charge (document.fonts).
   */
  font: 'Inter',
} as const;

/** Resolution native de la video, par format. */
const VIDEO_SIZE = {
  '9:16': { w: 1080, h: 1920 },
  '1:1': { w: 1080, h: 1080 },
  '16:9': { w: 1920, h: 1080 },
} as const;

/**
 * Metriques exprimees en FRACTION DE LA LARGEUR VIDEO.
 *
 * L'apercu etant desormais rendu a la resolution native puis reduit par un
 * `transform: scale`, toutes les tailles se calculent directement en pixels
 * video. Plus de `cqw`, plus de dependance a la largeur du panneau — les
 * proportions ne derivent plus avec la taille de la fenetre.
 *
 * Les valeurs de police reprennent celles du compositeur (w * 0.04375 pour le
 * titre, etc.) ; celles des cartes reprennent l'ancien rendu (9 px de texte
 * sur un panneau de 330 px, soit 9/330 de la largeur).
 */
const FONT_RATIO = {
  '9:16': { title: 0.04375, subtitle: 0.028, cta: 0.0375, ctaSub: 0.028 },
  /**
   * ⚠️ Le carre reprend les ratios du 16:9, et ce n'est pas un choix
   * esthetique : le compositeur ne connait pas les formats, il teste
   * `isReel = h > w` (video-composer.ts). Pour un canvas 1080x1080 cette
   * condition est FAUSSE — il applique donc, du titre au CTA en passant par
   * les cartes, exactement les metriques du paysage. Y mettre des valeurs
   * « mieux adaptees au carre » ferait diverger l'apercu de l'export : ce
   * serait plus joli a l'ecran et faux dans la video.
   */
  '1:1': { title: 0.035, subtitle: 0.0215, cta: 0.031, ctaSub: 0.023 },
  '16:9': { title: 0.035, subtitle: 0.0215, cta: 0.031, ctaSub: 0.023 },
} as const;

const CARD_RATIO = {
  text: 9 / 330,
  icon: 13 / 330,
  gap: 6 / 330,
  padX: 8 / 330,
  padY: 6 / 330,
  radius: 8 / 330,
} as const;

/** Marge titre/sous-titre et CTA : le compositeur utilise w * 4/320. */
const GAP_RATIO = 4 / 320;


/**
 * Ombres du compositeur, en fraction de la largeur video.
 * `dropShadowLgFilter` vaut 4/320 et 10/320 ; `dropShadowBaseFilter` 2.5/320.
 */
function titleShadow(w: number): string {
  const px = (r: number) => Math.max(1, Math.round(w * r));
  return `drop-shadow(0 ${px(4 / 320)}px ${px(3 / 320)}px rgba(0,0,0,0.1)) drop-shadow(0 ${px(10 / 320)}px ${px(8 / 320)}px rgba(0,0,0,0.04))`;
}
function subtitleShadow(w: number): string {
  const px = (r: number) => Math.max(1, Math.round(w * r));
  return `drop-shadow(0 ${px(2.5 / 320)}px ${px(2 / 320)}px rgba(0,0,0,0.1))`;
}

/**
 * Angle CSS reproduisant `createLinearGradient(0, 0, w, h)` du compositeur.
 *
 * Le canvas trace la diagonale coin à coin ; l'équivalent CSS n'est PAS
 * `to bottom right` (CSS utilise la perpendiculaire à l'autre diagonale) mais
 * `180° − atan(w/h)`. En 9:16 → 150,64° ; en 1:1 → 135° ; en 16:9 → 119,36°.
 *
 * Les dimensions viennent de `VIDEO_SIZE` : codees en dur, elles auraient
 * donne au carre l'angle du paysage, et un fond different de celui peint par
 * le compositeur.
 */
function backdropAngle(format: Format): number {
  const { w, h } = VIDEO_SIZE[format];
  return 180 - (Math.atan(w / h) * 180) / Math.PI;
}

/**
 * Fond identique à celui peint par le compositeur : le backdrop diagonal
 * (paintSeqBackdrop, 2 arrêts) surmonté de l'overlay `both` (paintSeqGradient,
 * 4 arrêts verticaux). Le premier de la liste CSS est au-dessus, comme dans
 * le canvas.
 *
 * Un dégradé à 3 arrêts sur 160° — l'ancien fond de l'aperçu — n'est pas
 * exprimable via les options du compositeur : le backdrop y est figé à 2
 * arrêts sur la diagonale du canvas. Plutôt que de modifier le moteur (donc
 * de repeindre le fond de TOUS les posts existants), c'est l'aperçu qui
 * s'aligne sur le compositeur.
 */
function backdropCSS(
  format: Format,
  gradStart: string,
  gradEnd: string,
  gradientOpacity: number,
): string {
  const a = gradientOpacity;
  const rgba = (hex: string, alpha: number) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  };
  return [
    `linear-gradient(180deg, ${rgba(gradStart, a)} 0%, rgba(0,0,0,0) 40%, rgba(0,0,0,0) 60%, ${rgba(gradEnd, a)} 100%)`,
    `linear-gradient(${backdropAngle(format).toFixed(2)}deg, ${gradStart} 0%, ${gradEnd} 100%)`,
  ].join(', ');
}

/**
 * Filigrane par defaut.
 *
 * ⚠️ Le compositeur allume le calque `siteText` DES QU'IL N'EST PAS DESACTIVE
 * (`siteText?.enabled !== false`, video-composer.ts) et, faute de texte, ecrit
 * `Afroboost.com`. Ce parcours ne lui transmettait rien : chaque montage sortait
 * donc marque « Afroboost.com », sur les quatre sequences, sans que rien dans
 * l'interface ne l'annonce ni ne permette de l'enlever. On transmet desormais
 * la valeur explicitement — le kit de marque s'il en porte une, sinon
 * `Studiio.pro`.
 */
const DEFAULT_WATERMARK = 'Studiio.pro';

/**
 * Filigrane : metriques du compositeur (calque `siteText`), centre, graisse
 * 700, opacite 0.85.
 *
 * ⚠️ Le compositeur calcule `linkFontSize = width * 0.0375 * size` — indexe
 * sur la LARGEUR — mais place le texte a un pourcentage de la HAUTEUR. En
 * 16:9 cela donnait 72 px de haut sur un cadre de 1080 : un filigrane plus
 * gros que le sous-CTA, qui venait le chevaucher. Le facteur `size` ramene
 * les deux formats a la meme taille absolue (40,5 px), et le 16:9 descend
 * d'un point pour retrouver la meme respiration au-dessus du CTA.
 */
const WATERMARK = {
  fontRatio: 0.0375,
  opacity: 0.85,
  color: '#FFFFFF',
  '9:16': { size: 1, y: 95 },
  // Carre : meme largeur qu'en 9:16, donc `size: 1` donne la meme taille
  // absolue (40,5 px). Mais le cadre est deux fois moins haut, si bien qu'a
  // 95 % le filigrane venait toucher le CTA ancre a 92 % — d'ou le point de
  // plus, comme en 16:9.
  '1:1': { size: 1, y: 96 },
  '16:9': { size: 1080 / 1920, y: 96 },
} as const;

/** Libelle sous chaque bouton de format. */
const FORMAT_HINT: Record<Format, string> = {
  '9:16': 'Reel / Short',
  '1:1': 'Post carré',
  '16:9': 'Paysage',
};

/** Ratio CSS du cadre d'apercu — derive des dimensions natives, pas ecrit deux fois. */
const ASPECT_CSS: Record<Format, string> = {
  '9:16': '9 / 16',
  '1:1': '1 / 1',
  '16:9': '16 / 9',
};

/** Sequences ou le filigrane est visible — noms cote editeur, comme le Calendrier les attend. */
const WATERMARK_SEQUENCES = ['titre', 'cartes', 'video', 'cta'] as const;

/**
 * Reglages typographiques par zone.
 *
 * Chaque champ correspond a une lecture REELLE du compositeur
 * (video-composer.ts), verifiee ligne a ligne :
 *
 *   Titre       — `titleFont`, `titleColor`, `textScale`, et
 *                 `titleTypography.{bold,italic,letterSpacing,lineHeight}`.
 *   Sous-titre  — `subtitleFont`, `subtitleColor`, `subtitleScale`. Chacun
 *                 retombe sur le titre quand il n'est pas renseigne : c'est
 *                 le rendu d'avant, a l'identique.
 *   CTA         — `watermarkFont` (grand texte) et `ctaFont` (sous-texte),
 *                 `ctaColor`, `ctaSubColor`, `ctaTextScale`, et
 *                 `ctaTypography.{bold,italic,letterSpacing,lineHeight}`.
 *
 * L'INTERLETTRAGE revient : `wrapText` decide desormais la coupe avec
 * `measureSpacedText`, c'est-a-dire la largeur que le trace produira
 * vraiment. La video coupe donc aux memes endroits que l'apercu, et le titre
 * ne sort plus du cadre.
 *
 * Restent hors de portee de ce parcours, faute d'etre lus la ou il faut :
 * le sous-titre n'a ni graisse ni italique propres (`drawIntro` lui impose
 * ceux du titre), ni interlettrage (il est trace par `fillText` nu).
 */
interface TextStyles {
  title: {
    font: string;
    color: string;
    scale: number;
    bold: boolean;
    italic: boolean;
    letterSpacing: number;
    lineHeight: number;
  };
  /**
   * Sous-titre. `null` = « suit le titre » — c'est ce que fait le
   * compositeur en l'absence de champ, donc l'etat par defaut ne transmet
   * rien et le rendu ne change pas.
   */
  subtitle: {
    font: string | null;
    color: string | null;
    scale: number;
  };
  cta: {
    font: string;
    color: string;
    subColor: string;
    scale: number;
    bold: boolean;
    italic: boolean;
    letterSpacing: number;
    lineHeight: number;
  };
}

/**
 * Defauts = rendu actuel, a l'identique.
 *
 * Chaque valeur reprend soit une constante `DESIGN`, soit le defaut du
 * compositeur : un montage produit sans toucher a ces reglages sort donc
 * exactement comme avant leur ajout. `cta.subColor` manque volontairement —
 * il suit la fin du degrade du kit de marque, qui n'est pas une constante.
 */
const DEFAULT_TEXT_STYLES: {
  title: TextStyles['title'];
  subtitle: TextStyles['subtitle'];
  cta: Omit<TextStyles['cta'], 'subColor'>;
} = {
  title: {
    font: DESIGN.font,
    color: DESIGN.titleColor,
    scale: 1,
    // `drawIntro` : `bold !== false ? 900 : 400`. L'apercu ecrivait 900 en dur.
    bold: true,
    italic: false,
    letterSpacing: 0,
    // Defaut du compositeur ET de l'apercu.
    lineHeight: 1.1,
  },
  subtitle: {
    // `null` = suit le titre. Le compositeur fait exactement cela quand le
    // champ est absent : rien n'est transmis, rien ne change.
    font: null,
    color: null,
    scale: 1,
  },
  cta: {
    font: DESIGN.font,
    color: DESIGN.ctaColor,
    scale: 1,
    // `drawCTA` : `bold !== false ? 900 : 400`, desormais comme le titre.
    bold: true,
    italic: false,
    letterSpacing: 0,
    lineHeight: 1.2,
  },
};

/** Style de cartes utilisé partout : aperçu, compositeur, metadata. */
const CARD_STYLE = 'Compact';

/** Coût du rendu, aligné sur l'éditeur (RENDER_COSTS). */
const COST = { reel: 10, tv: 15 } as const;

type Format = '9:16' | '1:1' | '16:9';

interface GeneratedCard {
  /**
   * Identite stable d'une carte, portee par la carte elle-meme et non par sa
   * place dans le tableau.
   *
   * Les cartes etaient rendues avec `key={i}` : l'index sert d'identite tant
   * que la liste ne bouge pas, mais il designe une AUTRE carte des qu'on en
   * insere, supprime ou reordonne une. C'est le prealable a dupliquer et a
   * regrouper, qui doivent tous deux nommer une carte precise.
   *
   * L'`id` est cree a la generation et survit au brouillon (`draft.ts`), pour
   * qu'un groupe enregistre designe encore les memes cartes apres un F5.
   */
  id: string;
  icon: string; // emoji renvoyé par smart-content
  title: string;
  description: string;
  value: string;
}

interface Generated {
  title: string;
  subtitle: string;
  cards: GeneratedCard[];
  cta: string;
  ctaSub: string;
}

const STEPS = ['Sujet', 'Style', 'Audio', 'Contenu', 'Envoi'] as const;

/**
 * Index des etapes, NOMMES.
 *
 * Ils etaient ecrits en chiffres en dur a onze endroits. Inserer « Audio » au
 * milieu decale tout : une seule occurrence oubliee enverrait l'utilisateur
 * sur la mauvaise etape, sans erreur visible ni au build ni a l'execution.
 */
const S = { sujet: 0, style: 1, audio: 2, contenu: 3, envoi: 4 } as const;

/**
 * URL stockable dans les metadonnees d'un post, ou `undefined`.
 *
 * Une URL `blob:` n'existe que dans l'onglet qui l'a creee : elle est parfaite
 * pour composer la video (tout se passe dans le navigateur) mais morte des le
 * rechargement de la page. On ne la persiste donc pas.
 */
const persistableUrl = (url: string | null): string | undefined =>
  url && !url.startsWith('blob:') ? url : undefined;

/** Classes de désactivation : `Button` n'en fournit aucune (ui/Button.tsx). */
const DISABLED = 'disabled:opacity-40 disabled:cursor-not-allowed';

/** Onglets au-dessus de l'apercu. « Tout » d'abord : c'est l'etat par defaut. */
const PREVIEW_TABS: Array<{ id: 'all' | 'intro' | 'cards' | 'cta'; label: string }> = [
  { id: 'all', label: 'Tout' },
  { id: 'intro', label: 'Titre' },
  { id: 'cards', label: 'Cartes' },
  { id: 'cta', label: 'CTA' },
];

/** Sections repliables de l'etape Style — l'ordre du panneau. */
type SectionId = 'format' | 'couleurs' | 'texte' | 'sequences';

/**
 * Une section repliable.
 *
 * L'en-tete porte un RESUME de ce que la section contient : replie, le panneau
 * doit encore dire ou en sont les reglages, sinon replier revient a cacher.
 *
 * Le contenu est monte en permanence et masque par `hidden` plutot que
 * demonte : les panneaux replies gardent ainsi leur etat, et surtout le bloc
 * de cartes de l'apercu — photographie a l'export — ne depend d'aucune
 * section ouverte.
 */
function StyleSection({
  id,
  title,
  hint,
  swatches,
  open,
  onToggle,
  children,
}: {
  id: SectionId;
  title: string;
  hint?: string;
  /** Pastilles de couleur affichees dans l'en-tete replie. */
  swatches?: string[];
  open: boolean;
  onToggle: (id: SectionId) => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl transition ${open ? 'bg-gray-900/40' : ''}`}>
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={open}
        aria-controls={`section-${id}`}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-gray-800/40"
      >
        <span className="text-sm font-medium text-white">{title}</span>
        {/* Le separateur evite un nom accessible colle (« Ton et formatPunchy »). */}
        <span className="flex-1 truncate text-[11px] text-gray-500">{hint ? `— ${hint}` : ''}</span>
        {swatches && (
          <span className="flex flex-shrink-0 gap-1">
            {swatches.map((c, i) => (
              <span
                key={i}
                className="h-3.5 w-3.5 rounded-full border border-white/10"
                style={{ backgroundColor: c }}
              />
            ))}
          </span>
        )}
        <ChevronDown
          className={`w-4 h-4 flex-shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <div id={`section-${id}`} hidden={!open} className="space-y-4 px-3 pb-3 pt-1">
        {children}
      </div>
    </div>
  );
}

/**
 * Aperçu — déclaré HORS du composant parent.
 *
 * Déclaré à l'intérieur, sa référence changeait à chaque rendu : React
 * démontait puis remontait tout le sous-arbre à chaque frappe dans le champ
 * « votre sujet ».
 *
 * Exporté pour être monté seul dans les tests : le cadrage du rush (règle
 * « aucune vidéo déformée ») se vérifie alors sur le DOM produit, pas sur une
 * lecture du source.
 */
export function Preview({
  generated,
  format,
  previewRef,
  cardsRef,
  frameRef,
  displayScale,
  activeOrder,
  gradStart,
  gradEnd,
  gradientOpacity,
  rushUrl,
  watermark,
  accent,
  text,
  focus = 'all',
  onFocusChange,
  titlePos = DESIGN.titlePos,
  ctaPos = DESIGN.ctaPos,
  dragging = null,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  /**
   * Position du titre et du CTA, en % du cadre. Optionnelles : sans elles,
   * l'apercu retombe sur les constantes `DESIGN` historiques — c'est ce qui
   * garde les montages existants et les tests d'apercu inchanges.
   */
  titlePos?: Pos;
  ctaPos?: Pos;
  /** Element en cours de glissement, pour le curseur et le liseré. */
  dragging?: 'title' | 'cta' | null;
  /** Absents = apercu non deplacable (lecture seule). */
  onDragStart?: (el: 'title' | 'cta', e: React.PointerEvent) => void;
  onDragMove?: (e: React.PointerEvent) => void;
  onDragEnd?: () => void;
  /** Absent = pas d'onglets (l'apercu reste la composition complete). */
  onFocusChange?: (focus: 'all' | 'intro' | 'cards' | 'cta') => void;
  /**
   * Element mis en avant par les onglets au-dessus de l'apercu.
   *
   * `'all'` = la composition complete, celle que photographie l'export. Les
   * autres valeurs n'isolent qu'un element pour le regler de pres : elles ne
   * changent RIEN au montage, seulement ce qui est montre.
   */
  focus?: 'all' | 'intro' | 'cards' | 'cta';
  /**
   * Reglages typographiques — la MEME valeur que celle envoyee au
   * compositeur. Une seule source : l'apercu ne peut pas deriver de l'export.
   */
  text: TextStyles;
  /** Filigrane affiche sur toutes les sequences, ou chaine vide si masque. */
  watermark?: string;
  /**
   * Couleur d'accent. Le compositeur ne s'en sert que pour le halo du
   * filigrane et la barre de progression : l'apercu reproduit le halo, sans
   * quoi le reglage « Accent » ne se verrait nulle part.
   */
  accent: string;
  generated: Generated | null;
  format: Format;
  /**
   * Rush de la sequence « Video », ou `null`. Il occupe tout le plateau —
   * c'est ce que le compositeur en fait : `drawVideoSeq` peint le rush en
   * plein cadre, sans titre ni cartes par-dessus.
   */
  rushUrl?: string | null;
  previewRef?: React.RefObject<HTMLDivElement>;
  cardsRef?: React.RefObject<HTMLDivElement>;
  /** Cadre visible, mesure pour calculer la reduction. */
  frameRef?: React.RefObject<HTMLDivElement>;
  /** Facteur de reduction du plateau : largeurCadre / largeurVideo. */
  displayScale: number;
  /** Couleurs issues du kit de marque, ou repli neutre. */
  gradStart: string;
  gradEnd: string;
  gradientOpacity: number;
  /**
   * Sequences activees, dans l'ordre choisi. L'apercu est une composition
   * fixe (les 3 blocs empiles) alors que la video les joue l'une apres
   * l'autre : l'ORDRE n'y est donc pas representable, mais la VISIBILITE
   * l'est — une sequence masquee disparait de l'apercu comme de la video.
   */
  activeOrder: string[];
}) {
  const vw = VIDEO_SIZE[format].w;

  // Rush illisible (fichier expire, format refuse par le navigateur) : on le
  // retire de l'apercu plutot que de laisser un rectangle noir. L'etat est
  // remis a zero a chaque changement d'URL — jamais de mutation directe du
  // DOM dans un `onError`, qui survivrait aux rendus suivants.
  const [rushBroken, setRushBroken] = useState(false);
  useEffect(() => setRushBroken(false), [rushUrl]);
  const showRush = !!rushUrl && !rushBroken && activeOrder.includes('video') && focus === 'all';

  /** Une sequence est visible si elle est active ET mise en avant. */
  const shows = (seq: 'intro' | 'cards' | 'cta') =>
    activeOrder.includes(seq) && (focus === 'all' || focus === seq);

  const titleWeight = text.title.bold ? 900 : 400;
  const titleStyle = text.title.italic ? 'italic' : 'normal';
  const ctaWeight = text.cta.bold ? 900 : 400;
  const ctaFontStyle = text.cta.italic ? 'italic' : 'normal';

  /**
   * Interlettrage : le compositeur multiplie la valeur saisie par `w / 320`
   * (l'echelle du viewport de l'editeur). Le plateau etant a la resolution
   * native, on applique le meme facteur — sinon 2 px saisis donneraient 2 px
   * a l'ecran et 6,75 px dans la video.
   */
  const spacingPx = (value: number) => (value * vw) / 320;

  // Sous-titre : chaque champ non renseigne suit le titre, exactement comme
  // `drawIntro` le fait en l'absence du champ correspondant.
  const subFamily = text.subtitle.font || text.title.font;
  const subSizePx = vw * FONT_RATIO[format].subtitle * text.title.scale * text.subtitle.scale;
  // Sans couleur choisie : celle du titre a 80 % (le `CC` du compositeur).
  // Avec : peinte a plein, ce que l'utilisateur choisit est ce qu'il voit.
  const subColor = text.subtitle.color || `${text.title.color}CC`;

  /**
   * Suppression du demi-interligne CSS.
   *
   * Le compositeur dessine en `textBaseline: 'top'` : le glyphe commence
   * EXACTEMENT a Y. En CSS, une `line-height` de L repartit `(L-1)·F` a parts
   * egales au-dessus et au-dessous de chaque ligne — le texte descendrait
   * donc de `(L-1)·F/2`, et le bloc serait d'autant plus haut, decalant le
   * sous-titre. A l'interligne par defaut (1,1) l'ecart est de 2 px ; a 2,0,
   * le maximum du reglage, il atteint 24 px sur le titre et 63 px sur le
   * sous-titre. Les marges negatives rendent la boite au ras des glyphes,
   * comme le canvas.
   */
  const leadingTrim = (fontSizePx: number, lineHeight: number) => {
    const half = ((lineHeight - 1) * fontSizePx) / 2;
    return { marginTop: -half, marginBottom: -half };
  };

  return (
    <div className="card-base p-4">
      <div className="flex items-center gap-2 mb-3">
        <MonitorPlay className="w-4 h-4 text-gray-500" />
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Aperçu
        </span>
      </div>

      {/* Onglets — isolent un element pour le regler de pres. « Tout » reste
          la composition complete, celle qui part a l'export : ces onglets ne
          changent que ce qui est MONTRE, jamais le montage. */}
      {generated && onFocusChange && (
        <div className="flex gap-1 mb-3" role="tablist" aria-label="Élément mis en avant">
          {PREVIEW_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={focus === t.id}
              onClick={() => onFocusChange(t.id)}
              disabled={t.id !== 'all' && !activeOrder.includes(t.id)}
              title={
                t.id !== 'all' && !activeOrder.includes(t.id)
                  ? 'Séquence masquée — activez-la dans Séquences'
                  : undefined
              }
              className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition disabled:opacity-30 disabled:cursor-not-allowed ${
                focus === t.id
                  ? 'bg-gray-800 text-white ring-1 ring-purple-500/40'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Rendu 1:1 ──────────────────────────────────────────────────
          Le plateau interne fait la TAILLE REELLE de la video (1080x1920 ou
          1920x1080) et n'est que REDUIT a l'affichage par un transform. Ce
          que l'utilisateur voit est donc une mini-version exacte de l'image
          video, et la capture du bloc cartes se fait a 1:1 — texte net par
          construction, sans surechantillonnage.
          `transform` n'affecte pas la taille de layout : modern-screenshot
          capture bien le plateau a sa resolution native. */}
      <div
        ref={frameRef}
        className="w-full rounded-xl overflow-hidden relative"
        style={{
          aspectRatio: ASPECT_CSS[format],
          border: generated ? 'none' : '1px dashed #1F2937',
          backgroundColor: DARK,
        }}
      >
      <div
        ref={previewRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: VIDEO_SIZE[format].w,
          height: VIDEO_SIZE[format].h,
          transform: `scale(${displayScale})`,
          transformOrigin: 'top left',
          // Fond STRICTEMENT identique a celui peint par le compositeur.
          background: generated ? backdropCSS(format, gradStart, gradEnd, gradientOpacity) : DARK,
          // `var(--font-inter)` est la SEULE reference valide : Next charge la
          // police via next/font, il n'existe aucune @font-face nommee 'Inter'.
          fontFamily: 'var(--font-inter), Inter, sans-serif',
        }}
      >
        {/* ── Rush de la sequence « Video » ─────────────────────────────
            `object-fit: cover` est l'exact equivalent CSS du cadrage du
            compositeur : `drawVideoSeq` calcule `max(w/srcW, h/srcH)` et
            applique cette MEME echelle aux deux dimensions. Le rush est
            donc recadre, jamais etire — quel que soit le format de sortie.
            Ne JAMAIS y substituer `width:100%; height:100%` sans
            `object-fit`, qui deformerait (regle absolue du cahier).
            Il est peint EN PREMIER, donc sous le titre, les cartes et le
            CTA : dans la video ces sequences se succedent, l'apercu les
            empile — comme il le fait deja pour les trois autres. */}
        {showRush && (
          <video
            src={rushUrl!}
            muted
            loop
            autoPlay
            playsInline
            preload="metadata"
            onError={() => setRushBroken(true)}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        )}
        {!generated ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-2">
            <MonitorPlay className="w-8 h-8 text-gray-700" />
            <p className="text-xs text-gray-600 leading-relaxed">
              Votre visuel s&apos;affichera ici
              <br />
              au fil des étapes.
            </p>
          </div>
        ) : (
          <>
            {shows('intro') && (
            /* Titre — ancre au bord GAUCHE (x) et au bord HAUT (y), comme
                drawIntro avec titleAlign:'left' et textBaseline:'top'.
                L'ombre est appliquee en dur par le compositeur. */
            <div
              onPointerDown={(e) => onDragStart?.('title', e)}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
              onPointerCancel={onDragEnd}
              onLostPointerCapture={onDragEnd}
              title={onDragStart ? "Glisser pour déplacer le titre" : undefined}
              style={{
                position: 'absolute',
                left: `${titlePos.x}%`,
                top: `${titlePos.y}%`,
                width: `${DESIGN.titleWidth}%`,
                textAlign: 'left',
                cursor: onDragStart ? (dragging === 'title' ? 'grabbing' : 'grab') : undefined,
                // Au-dessus de la grille de cartes : sans cela, un titre
                // depose sur la zone des cartes n'etait plus saisissable —
                // la grille couvre le cadre meme quand elle est vide.
                zIndex: onDragStart ? 2 : undefined,
                touchAction: onDragStart ? 'none' : undefined,
                outline: dragging === 'title' ? '1px dashed rgba(255,255,255,0.5)' : undefined,
                outlineOffset: 2,
              }}
            >
              <div
                className="uppercase"
                style={{
                  fontFamily: fontStack(text.title.font),
                  fontSize: vw * FONT_RATIO[format].title * text.title.scale,
                  fontWeight: titleWeight,
                  fontStyle: titleStyle,
                  letterSpacing: spacingPx(text.title.letterSpacing),
                  color: text.title.color,
                  lineHeight: text.title.lineHeight,
                  ...leadingTrim(vw * FONT_RATIO[format].title * text.title.scale, text.title.lineHeight),
                  filter: titleShadow(vw),
                }}
              >
                {generated.title}
              </div>
              {/* Sous-titre : `drawIntro` lui impose la police, la graisse,
                  l'italique et l'interligne du TITRE, et sa couleur a 80 %.
                  Il n'a aucun reglage propre — en lui en donnant un ici,
                  l'apercu promettrait ce que la video ne rendrait pas. */}
              <div
                style={{
                  fontFamily: fontStack(subFamily),
                  fontSize: subSizePx,
                  // Graisse, italique et interligne restent ceux du titre :
                  // `drawIntro` les lui impose, lui donner des controles
                  // afficherait des reglages sans effet sur la video.
                  fontWeight: titleWeight,
                  fontStyle: titleStyle,
                  color: subColor,
                  lineHeight: text.title.lineHeight,
                  ...leadingTrim(subSizePx, text.title.lineHeight),
                  // `mt1` du compositeur, mesure depuis le BAS des glyphes du
                  // titre — d'ou le retrait du demi-interligne ci-dessus.
                  marginTop:
                    vw * GAP_RATIO - ((text.title.lineHeight - 1) * subSizePx) / 2,
                  filter: subtitleShadow(vw),
                }}
              >
                {generated.subtitle}
              </div>
            </div>
            )}

            {/* Cartes — ce conteneur est PHOTOGRAPHIÉ (modern-screenshot) et
                l'image est blittée telle quelle dans la vidéo par le
                compositeur. C'est ce qui garantit que les cartes de l'aperçu
                et celles du montage sont pixel pour pixel identiques. */}
            <div
              ref={cardsRef}
              data-cards-grid
              className="absolute flex flex-col justify-center"
              style={{ left: '8%', right: '8%', top: '30%', bottom: '22%', gap: vw * CARD_RATIO.gap }}
            >
              {(shows('cards') ? generated.cards : []).map((c) => (
                <div
                  key={c.id}
                  className="flex items-center"
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.08)',
                    gap: vw * CARD_RATIO.gap,
                    borderRadius: vw * CARD_RATIO.radius,
                    padding: `${vw * CARD_RATIO.padY}px ${vw * CARD_RATIO.padX}px`,
                  }}
                >
                  <CardIcon
                    name={c.icon}
                    size={Math.round(vw * CARD_RATIO.icon)}
                    color="#FFFFFF"
                    className=""
                  />
                  <span
                    className="font-semibold text-white truncate flex-1"
                    style={{ fontSize: vw * CARD_RATIO.text }}
                  >
                    {c.title}
                  </span>
                  {c.value && (
                    <span
                      className="font-bold flex-shrink-0"
                      style={{ fontSize: vw * CARD_RATIO.text, color: gradEnd }}
                    >
                      {c.value}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {shows('cta') && (
            /* CTA — ancre par le BAS a ctaPos.y, centre horizontalement :
                drawCTA fait `curY = ctaPosY - blockH`, donc y designe le bas
                du bloc. Graisse 900 en dur cote compositeur. */
            <div
              onPointerDown={(e) => onDragStart?.('cta', e)}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
              onPointerCancel={onDragEnd}
              onLostPointerCapture={onDragEnd}
              title={onDragStart ? "Glisser pour déplacer le CTA" : undefined}
              style={{
                position: 'absolute',
                left: `${ctaPos.x}%`,
                top: `${ctaPos.y}%`,
                transform: 'translate(-50%, -100%)',
                width: `${DESIGN.ctaWidth}%`,
                textAlign: 'center',
                cursor: onDragStart ? (dragging === 'cta' ? 'grabbing' : 'grab') : undefined,
                zIndex: onDragStart ? 2 : undefined,
                touchAction: onDragStart ? 'none' : undefined,
                outline: dragging === 'cta' ? '1px dashed rgba(255,255,255,0.5)' : undefined,
                outlineOffset: 2,
              }}
            >
              {/* `drawCTA` lit desormais `ctaTypography.bold/italic` — il
                  ecrivait `900` en dur, ce qui rendait ces deux champs
                  inertes bien qu'ils existent dans le type depuis toujours. */}
              <div
                className="uppercase"
                style={{
                  fontFamily: fontStack(text.cta.font),
                  fontSize: vw * FONT_RATIO[format].cta * text.cta.scale,
                  fontWeight: ctaWeight,
                  fontStyle: ctaFontStyle,
                  letterSpacing: spacingPx(text.cta.letterSpacing),
                  color: text.cta.color,
                  lineHeight: text.cta.lineHeight,
                  ...leadingTrim(vw * FONT_RATIO[format].cta * text.cta.scale, text.cta.lineHeight),
                  textShadow: `0 0 ${vw * 0.02}px ${text.cta.color}66`,
                }}
              >
                {generated.cta}
              </div>
              <div
                className="uppercase"
                style={{
                  fontFamily: fontStack(text.cta.font),
                  fontSize: vw * FONT_RATIO[format].ctaSub * text.cta.scale,
                  fontWeight: ctaWeight,
                  fontStyle: ctaFontStyle,
                  letterSpacing: spacingPx(text.cta.letterSpacing),
                  color: text.cta.subColor,
                  lineHeight: text.cta.lineHeight,
                  ...leadingTrim(vw * FONT_RATIO[format].ctaSub * text.cta.scale, text.cta.lineHeight),
                  marginTop:
                    vw * GAP_RATIO
                    - ((text.cta.lineHeight - 1) * vw * FONT_RATIO[format].ctaSub * text.cta.scale) / 2,
                }}
              >
                {generated.ctaSub}
              </div>
            </div>
            )}

            {/* Filigrane — le compositeur le peint sur CHAQUE sequence, au
                centre a 95 % de la hauteur. Mêmes police, graisse et opacite
                que le calque `siteText`, pour que l'apercu ne promette pas
                autre chose que la video. */}
            {watermark && (
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  // Cote canvas, `y` designe la LIGNE DE BASE. En CSS on
                  // remonte le bloc d'une ascendante (~0,8 em avec
                  // `lineHeight: 1`) pour que la base tombe au meme endroit —
                  // un `translateY(-50%)` y centrerait le bloc, donc
                  // descendrait le texte d'un tiers de cadratin.
                  top: `${WATERMARK[format].y}%`,
                  transform: 'translateY(-0.8em)',
                  lineHeight: 1,
                  textAlign: 'center',
                  fontSize: vw * WATERMARK.fontRatio * WATERMARK[format].size,
                  fontWeight: 700,
                  color: WATERMARK.color,
                  opacity: WATERMARK.opacity,
                  // Contour noir + halo a la couleur d'accent : le compositeur
                  // peint les deux (`fillTextWithOutline` + `shadowColor =
                  // accentColor`). Sans le halo ici, regler l'accent ne se
                  // voyait nulle part dans l'apercu.
                  textShadow: [
                    '0 1px 2px rgba(0,0,0,0.85)',
                    '0 -1px 2px rgba(0,0,0,0.85)',
                    `0 0 8px ${accent}`,
                  ].join(', '),
                }}
              >
                {watermark}
              </div>
            )}
          </>
        )}
      </div>

      </div>

      {generated && (
        <p className="mt-3 text-[10px] text-gray-600 leading-relaxed">
          Les cartes de la vidéo seront exactement celles-ci. Le titre et le CTA, eux, apparaissent en séquences successives dans le montage.
          {showRush && ' Le rush occupe seul sa séquence, cadré comme ici.'}
        </p>
      )}
    </div>
  );
}

export default function AssistantWizard() {
  // Kit de marque (F7). `useBranding` fournit deja des defauts neutres ; les
  // `||` couvrent une valeur vide heritee d'un ancien enregistrement.
  const { branding } = useBranding();

  /**
   * Couleurs : le kit de marque fournit la base, l'utilisateur peut la
   * surcharger POUR CETTE CREATION.
   *
   * La surcharge est un objet nul tant qu'on n'y a pas touche — et non quatre
   * etats initialises depuis `branding`. `useBranding` lit le localStorage
   * dans un effet : des etats seedes au montage captureraient les defauts
   * neutres, puis ignoreraient le kit charge une milliseconde plus tard.
   * Tant que `colors` vaut `null`, l'ecran suit le kit ; des le premier
   * reglage, il suit l'utilisateur.
   */
  const [colors, setColors] = useState<{
    accent: string;
    gradStart: string;
    gradEnd: string;
    gradientOpacity: number;
  } | null>(null);

  const brandAccent = branding.accentColor || NEUTRAL_ACCENT;
  // Le kit distingue la couleur d'accent (bordures, icones) du DEBUT du
  // degrade de fond : changer l'une ne change pas l'autre, le panneau les
  // expose separement. Le `|| accent` ne couvre qu'une valeur vide heritee
  // d'un enregistrement anterieur a ce champ.
  const brandGradStart = branding.gradientColor1 || brandAccent;
  const brandGradEnd = branding.gradientColor2 || NEUTRAL_GRADIENT_END;
  const brandGradientOpacity =
    typeof branding.gradientOpacity === 'number' ? branding.gradientOpacity : DESIGN.gradientOpacity;

  const accent = colors?.accent ?? brandAccent;
  const gradStart = colors?.gradStart ?? brandGradStart;
  const gradEnd = colors?.gradEnd ?? brandGradEnd;
  const gradientOpacity = colors?.gradientOpacity ?? brandGradientOpacity;


  /** Regle une couleur : fige les trois autres a leur valeur courante. */
  const setColor = (patch: Partial<NonNullable<typeof colors>>) =>
    setColors({ accent, gradStart, gradEnd, gradientOpacity, ...patch });

  /** Couleur en cours d'edition dans la roue — purement local a l'interface. */
  const [editedColor, setEditedColor] = useState<'accent' | 'gradStart' | 'gradEnd' | null>(null);

  // ── Typographie ──────────────────────────────────────────────────────
  // Un seul objet, transmis a l'identique a l'apercu, au compositeur et aux
  // metadonnees. Les defauts reproduisent le rendu d'avant ces reglages.
  const [titleStyle, setTitleStyle] = useState<TextStyles['title']>(DEFAULT_TEXT_STYLES.title);
  const [subtitleStyle, setSubtitleStyle] = useState<TextStyles['subtitle']>(
    DEFAULT_TEXT_STYLES.subtitle,
  );
  const [ctaStyle, setCtaStyle] = useState<TextStyles['cta']>({
    ...DEFAULT_TEXT_STYLES.cta,
    // Provisoire : remplace juste en dessous par la fin du degrade tant que
    // l'utilisateur n'a pas choisi de couleur de sous-texte.
    subColor: '',
  });
  /**
   * Section ouverte. Une seule a la fois : c'est ce qui empeche le panneau de
   * s'allonger indefiniment. `null` = tout replie.
   */
  const [openSection, setOpenSection] = useState<SectionId | null>('format');
  /**
   * Element mis en avant dans l'apercu. Purement visuel : l'export force
   * `'all'` le temps de la photo des cartes (voir `sendToCalendar`).
   */
  const [previewFocus, setPreviewFocus] = useState<'all' | 'intro' | 'cards' | 'cta'>('all');
  const toggleSection = (id: SectionId) => setOpenSection((prev) => (prev === id ? null : id));

  /** Zone de texte en cours de reglage — purement local a l'interface. */
  const [editedZone, setEditedZone] = useState<'title' | 'subtitle' | 'cta'>('title');
  /** Champ de couleur ouvert dans la roue, pour la zone active. */
  const [editedTextColor, setEditedTextColor] = useState<'color' | 'subColor' | null>(null);

  /**
   * Chargement des polices A LA DEMANDE.
   *
   * Le catalogue compte des dizaines de familles : les charger toutes
   * plomberait la page pour n'en servir qu'une ou deux. On ne demande que
   * celles qui sont reellement choisies — et on force un rendu quand elles
   * arrivent, sinon l'apercu resterait dans la police de repli jusqu'a la
   * prochaine frappe.
   *
   * Les six familles servies par `next/font` sont deja dans la page : elles
   * s'affichent immediatement, ce chargement ne fait que les rendre
   * disponibles au canvas, qui ne sait pas lire une variable CSS.
   */
  const [, bumpFonts] = useState(0);
  const [missingFonts, setMissingFonts] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    const families = [titleStyle.font, subtitleStyle.font, ctaStyle.font].filter(
      (f): f is string => !!f,
    );
    for (const family of families) {
      void ensureFontLoaded(family).then((ok) => {
        if (cancelled) return;
        bumpFonts((n) => n + 1);
        setMissingFonts((prev) => {
          const without = prev.filter((f) => f !== family);
          return ok ? without : [...without, family];
        });
      });
    }
    return () => { cancelled = true; };
  }, [titleStyle.font, subtitleStyle.font, ctaStyle.font]);

  /**
   * Reglages de texte effectifs — LA source unique.
   *
   * La couleur du sous-texte du CTA suit la fin du degrade tant qu'elle n'a
   * pas ete choisie : c'est ce que faisait le code avant ces reglages
   * (`ctaSubColor: gradEnd`). Une valeur seedee au montage la figerait sur le
   * repli neutre, le kit de marque n'etant lu qu'apres, dans un effet.
   */
  const textStyles: TextStyles = {
    title: titleStyle,
    subtitle: subtitleStyle,
    cta: { ...ctaStyle, subColor: ctaStyle.subColor || gradEnd },
  };

  /**
   * Traduction des reglages de texte vers les champs du compositeur.
   *
   * Ecrite UNE FOIS, etalee a la fois dans `design` (compositeur) et dans
   * `metadata.design` (Calendrier). En deux copies, l'une aurait fini par
   * deriver de l'autre — et c'est le Calendrier, qui relit la seconde, qui
   * aurait affiche autre chose que la video.
   *
   * Le nommage cote compositeur est deroutant et n'est pas de notre fait :
   * le GRAND texte du CTA prend `watermarkFont`, le sous-texte `ctaFont`
   * (drawCTA). On pose donc la meme police dans les deux.
   *
   * ⚠️ Le Calendrier ne lit PAS ces cles a plat : il attend
   * `design.typography.{title,cta}` (calendar/page.tsx). D'ou le champ
   * `typography` ci-dessous, qui porte les memes valeurs — sans lui, gras,
   * italique et interligne disparaissaient a la regeneration.
   */
  const textDesign = {
    titleFont: textStyles.title.font,
    titleColor: textStyles.title.color,
    textScale: textStyles.title.scale,
    /**
     * Neutralise l'effet de bord de `textScale` sur les CARTES.
     *
     * `textScale` est le seul levier de taille que `drawIntro` connait, mais
     * `drawCards` le lit aussi : `fontPx = w × cssPx / viewport × textScale ×
     * cardsTextScale/100`. Regler « Taille » sous l'onglet Titre grossirait
     * donc le texte des cartes d'autant — sans effet tant que les cartes sont
     * blittees depuis la photo de l'apercu, mais bien reel des que la capture
     * echoue, et SYSTEMATIQUE dans la reconstruction HTML du Calendrier, qui
     * applique la meme formule. Le produit reste donc a 1, quoi qu'il arrive.
     */
    cardsTextScale: 100 / textStyles.title.scale,
    titleTypography: {
      bold: textStyles.title.bold,
      italic: textStyles.title.italic,
      letterSpacing: textStyles.title.letterSpacing,
      lineHeight: textStyles.title.lineHeight,
    },
    // Sous-titre : on ne transmet QUE ce qui a ete choisi. Un champ absent
    // fait retomber le compositeur sur le titre — c'est le rendu d'origine,
    // et c'est aussi ce que fait l'apercu.
    ...(textStyles.subtitle.font ? { subtitleFont: textStyles.subtitle.font } : {}),
    ...(textStyles.subtitle.color ? { subtitleColor: textStyles.subtitle.color } : {}),
    ...(textStyles.subtitle.scale !== 1 ? { subtitleScale: textStyles.subtitle.scale } : {}),
    watermarkFont: textStyles.cta.font,
    ctaFont: textStyles.cta.font,
    ctaColor: textStyles.cta.color,
    ctaSubColor: textStyles.cta.subColor,
    ctaTextScale: textStyles.cta.scale,
    ctaTypography: {
      bold: textStyles.cta.bold,
      italic: textStyles.cta.italic,
      letterSpacing: textStyles.cta.letterSpacing,
      lineHeight: textStyles.cta.lineHeight,
    },
    /**
     * MEMES valeurs, sous la forme imbriquee que relit le Calendrier
     * (`designMeta.typography?.title` / `.cta`, calendar/page.tsx) — c'est
     * aussi le contrat qu'ecrit l'editeur complet. Les cles a plat
     * ci-dessus servent au compositeur, celle-ci a la regeneration et a
     * l'apercu du Calendrier. Elles derivent du meme objet, donc elles ne
     * peuvent pas diverger.
     */
    typography: {
      title: {
        bold: textStyles.title.bold,
        italic: textStyles.title.italic,
        letterSpacing: textStyles.title.letterSpacing,
        lineHeight: textStyles.title.lineHeight,
      },
      cta: {
        bold: textStyles.cta.bold,
        italic: textStyles.cta.italic,
        letterSpacing: textStyles.cta.letterSpacing,
        lineHeight: textStyles.cta.lineHeight,
      },
    },
  };

  /**
   * Filigrane. Meme raisonnement que les couleurs pour la surcharge nulle :
   * `branding.watermarkText` arrive apres le premier rendu.
   */
  const [watermarkOverride, setWatermarkOverride] = useState<string | null>(null);
  const [watermarkEnabled, setWatermarkEnabled] = useState(true);
  const watermarkText = watermarkOverride ?? (branding.watermarkText || DEFAULT_WATERMARK);
  /** Ce qui est reellement peint : chaine vide si masque ou vide. */
  const watermarkLabel = watermarkEnabled ? watermarkText.trim() : '';
  /**
   * Un champ vide eteint le filigrane. Le bouton doit le dire, sinon il
   * annonce « Affiche » devant un apercu ou rien ne s'affiche.
   */
  const watermarkVisible = !!watermarkLabel;

  const [started, setStarted] = useState(false);
  const [step, setStep] = useState(0);

  const [themeId, setThemeId] = useState(THEMES[0].id);
  const [customTopic, setCustomTopic] = useState('');
  const [toneId, setToneId] = useState(TONES[0].id);
  const [format, setFormat] = useState<Format>('9:16');
  const [sequences, setSequences] = useState(DEFAULT_SEQUENCES);
  const [dragKey, setDragKey] = useState<SeqKey | null>(null);

  /**
   * Configuration du filigrane, ECRITE UNE FOIS et transmise a l'identique au
   * compositeur et aux metadonnees. En deux copies, l'une aurait fini par
   * deriver de l'autre — et c'est le Calendrier, qui relit la seconde, qui
   * aurait affiche autre chose que la video.
   *
   * `sequences` est indispensable cote Calendrier : sa reconstruction HTML
   * fait `(siteText.sequences || []).includes(seq)`, donc un objet sans ce
   * champ n'affiche JAMAIS le filigrane — alors que le compositeur, lui,
   * applique sa propre liste par defaut. Les deux rendus divergeraient en
   * silence. Depend du format, d'ou sa place apres `format`.
   */
  const watermarkConfig = {
    text: watermarkLabel || DEFAULT_WATERMARK,
    enabled: watermarkVisible,
    color: WATERMARK.color,
    opacity: WATERMARK.opacity,
    size: WATERMARK[format].size,
    sequences: [...WATERMARK_SEQUENCES],
    pos: { x: 50, y: WATERMARK[format].y },
  };

  // ── Rush video ───────────────────────────────────────────────────────
  // Le compositeur accepte deja `videoUrl` : il suffit de le lui passer. Sans
  // rush, `rushUrl` reste nul et la sequence « Video » demeure masquee —
  // comportement strictement identique a celui d'avant cet ajout.
  const [rushUrl, setRushUrl] = useState<string | null>(null);
  const [rushName, setRushName] = useState('');
  const [rushLibOpen, setRushLibOpen] = useState(false);
  const [rushLoading, setRushLoading] = useState(false);
  // Le rush courant est-il DEJA un extrait produit par « Temps forts » ?
  // `detectClips` abandonne sur une duree non finie (clip-detector.ts) — or
  // c'est exactement ce que renvoie un WebM `MediaRecorder`. Relancer la
  // detection sur un extrait ne pouvait donc qu'echouer, sur un message
  // trompeur (« la video est peut-etre trop courte ou illisible »).
  const [rushIsClip, setRushIsClip] = useState(false);
  const rushRunIdRef = useRef(0);
  // Rush soumis a la detection des temps forts. C'est l'IDENTITE de cet objet
  // qui pilote (re)lancement et fermeture du modal — meme contrat que
  // /dashboard/media, qui l'utilise deja ainsi.
  const [clipSource, setClipSource] = useState<ClipSource | null>(null);

  // ── Audio ────────────────────────────────────────────────────────────
  // Le compositeur accepte deja `musicUrl` / `voiceUrl` : il suffit de les
  // lui passer. Sans audio il rend en mode « fast » (~10x temps reel) ; des
  // qu'une piste est posee il bascule en mode « normal », temps reel, et
  // embarque le son dans le fichier.
  const [musicUrl, setMusicUrl] = useState<string | null>(null);
  const [musicName, setMusicName] = useState('');
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  const [voiceName, setVoiceName] = useState('');
  const [musicVolume, setMusicVolume] = useState(0.5);
  const [voiceVolume, setVoiceVolume] = useState(1);
  // Niveaux du mixeur unifie (musique + voix off + son du rush). Tant que
  // l'utilisateur n'a pas touche au mixeur, la liste reste vide et le
  // compositeur garde strictement son comportement actuel.
  const [audioKeyframes, setAudioKeyframes] = useState<AudioKeyframe[]>([]);

  // Durees par sequence. Elles etaient figees dans la constante `SEQ` ; le
  // panneau audio expose des reglages de duree, et les afficher sans qu'ils
  // agissent serait mensonger. Valeurs initiales identiques a `SEQ`, donc
  // comportement par defaut strictement inchange.
  const [introDuration, setIntroDuration] = useState<number>(SEQ.intro);
  const [cardsDuration, setCardsDuration] = useState<number>(SEQ.cards);
  const [videoDuration, setVideoDuration] = useState<number>(SEQ.video);
  const [ctaDuration, setCtaDuration] = useState<number>(SEQ.cta);

  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<Generated | null>(null);

  const [scheduledDate, setScheduledDate] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rendu du montage
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderStage, setRenderStage] = useState('');
  const previewRef = useRef<HTMLDivElement>(null);

  // ── Deplacement du titre et du CTA ────────────────────────────────────
  // Defauts = les constantes `DESIGN` d'origine : tant que l'utilisateur ne
  // deplace rien, l'apercu ET l'export sont identiques a avant, au pixel.
  const [titlePos, setTitlePos] = useState<Pos>(DESIGN.titlePos);
  const [ctaPos, setCtaPos] = useState<Pos>(DESIGN.ctaPos);
  /** Element en cours de glissement, et ecart de saisie fige au pointerdown. */
  const dragRef = useRef<{
    el: 'title' | 'cta';
    pointerId: number;
    grab: Pos;
    box: { width: number; height: number };
  } | null>(null);
  // Refs de position : `moveDrag` est memoise sans dependances (le remonter a
  // chaque deplacement recreerait les gestionnaires 60 fois par seconde).
  const titlePosRef = useRef<Pos>(DESIGN.titlePos);
  const ctaPosRef = useRef<Pos>(DESIGN.ctaPos);
  const [dragging, setDragging] = useState<'title' | 'cta' | null>(null);
  useEffect(() => { titlePosRef.current = titlePos; }, [titlePos]);
  useEffect(() => { ctaPosRef.current = ctaPos; }, [ctaPos]);

  const startDrag = useCallback((el: 'title' | 'cta', e: React.PointerEvent) => {
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Un seul glissement a la fois : le second doigt d'un multi-touch ne doit
    // pas voler le glissement en cours — sinon poser deux doigts deplace le
    // mauvais element.
    if (dragRef.current) return;
    const anchor = el === 'title' ? titlePos : ctaPos;
    const box = e.currentTarget.getBoundingClientRect();
    dragRef.current = {
      el,
      pointerId: e.pointerId,
      grab: grabOffset(e.clientX, e.clientY, rect, anchor),
      // Encombrement du bloc en % du cadre, fige a la saisie : c'est lui qui
      // empeche de deposer l'element hors de l'ecran.
      box: { width: (box.width / rect.width) * 100, height: (box.height / rect.height) * 100 },
    };
    setDragging(el);
    try {
      // Capture : le glissement continue meme si le curseur sort de l'element.
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      // `NotFoundError` si le pointeur n'est deja plus actif — sans garde, on
      // resterait bloque en etat « glissement ».
      dragRef.current = null;
      setDragging(null);
      return;
    }
    e.stopPropagation();
  }, [titlePos, ctaPos]);

  const moveDrag = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    const rect = previewRef.current?.getBoundingClientRect();
    if (!drag || !rect) return;
    // Seul le pointeur qui a commence le glissement le poursuit.
    if (drag.pointerId !== e.pointerId) return;
    // `pointermove` se declenche aussi au simple survol : sans bouton appuye,
    // il n'y a pas de glissement (garde-fou anti « element collant »).
    if (e.buttons === 0 && e.pointerType === 'mouse') return;
    const current = drag.el === 'title' ? titlePosRef.current : ctaPosRef.current;
    const raw = pointToPct(e.clientX, e.clientY, rect, drag.grab, current);
    const next = clampToBox(raw, drag.el === 'title' ? 'top-left' : 'bottom-center', drag.box);
    if (drag.el === 'title') setTitlePos(next);
    else setCtaPos(next);
  }, []);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setDragging(null);
  }, []);
  const cardsRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  // Facteur de reduction du plateau : largeur affichee / largeur video.
  // Mesure par ResizeObserver — le panneau est fluide, et le plateau doit le
  // remplir exactement quelle que soit la largeur de la fenetre.
  // Initialise a 0 : le plateau reste invisible jusqu'a la premiere mesure,
  // plutot que de flasher a une echelle arbitraire (0.3 debordait en 16:9).
  const [displayScale, setDisplayScale] = useState(0);
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const apply = () => {
      const w = el.clientWidth;
      if (w > 0) setDisplayScale(w / VIDEO_SIZE[format].w);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [format]);

  // ── Brouillon : sauvegarde automatique ───────────────────────────────
  //
  // Un rafraichissement perdait tout le travail. Tout ce qui suit sert a ce
  // qu'il n'en perde plus rien.
  const { data: session, status } = useSession();
  /**
   * La session n'est PAS disponible au premier rendu.
   *
   * `SessionProvider` est monte sans session initiale : `useSession()` rend
   * d'abord `status === 'loading'` et `data === undefined`. Restaurer a ce
   * moment-la lisait la cle anonyme, ne trouvait rien — et la sauvegarde
   * ecrasait ensuite la cle du compte avec l'etat par defaut. Autrement dit :
   * un rafraichissement ne restaurait rien ET detruisait le brouillon, alors
   * que la navigation interne, elle, fonctionnait (le fournisseur y est deja
   * resolu). C'est le seul cas qui comptait qui echouait.
   */
  const sessionReady = status !== 'loading';
  const storageKey = draftKey(session?.user?.email);
  /** Vrai une fois la restauration tentee : on n'ecrit rien avant. */
  const restoredRef = useRef(false);
  const [restoredNotice, setRestoredNotice] = useState<string | null>(null);

  /**
   * Etat a conserver, construit en UN SEUL endroit.
   *
   * Les trois chemins d'ecriture (minuterie, demontage, fermeture d'onglet)
   * appellent cette meme fonction : ecrite trois fois, elle aurait fini par
   * diverger, et c'est le chemin le moins teste qui aurait enregistre un
   * brouillon incomplet.
   */
  const buildDraft = useCallback((): Draft => ({
    version: DRAFT_VERSION,
    savedAt: Date.now(),
    started,
    step,
    themeId,
    customTopic,
    toneId,
    format,
    colors,
    titleStyle,
    subtitleStyle,
    ctaStyle,
    watermarkOverride,
    watermarkEnabled,
    sequences,
    introDuration,
    cardsDuration,
    videoDuration,
    ctaDuration,
    generated,
    audioKeyframes,
    // Les `blob:` ne survivent pas au rechargement : les enregistrer laisserait
    // un media fantome dans le brouillon restaure.
    musicUrl: persistableDraftUrl(musicUrl),
    musicName,
    voiceUrl: persistableDraftUrl(voiceUrl),
    voiceName,
    musicVolume,
    voiceVolume,
    rushUrl: persistableDraftUrl(rushUrl),
    rushName,
    rushIsClip,
    scheduledDate,
  }), [
    started, step, themeId, customTopic, toneId, format, colors,
    titleStyle, subtitleStyle, ctaStyle, watermarkOverride, watermarkEnabled,
    sequences, introDuration, cardsDuration, videoDuration, ctaDuration,
    generated, audioKeyframes, musicUrl, musicName, voiceUrl, voiceName, musicVolume,
    voiceVolume, rushUrl, rushName, rushIsClip, scheduledDate,
  ]);

  /** La derniere version connue, pour ecrire sans attendre un rendu. */
  const draftRef = useRef(buildDraft);
  draftRef.current = buildDraft;

  /**
   * Restauration, au montage.
   *
   * Chaque champ est valide separement : un brouillon d'une version
   * anterieure, ou dont une police a disparu du catalogue, doit rendre ce
   * qu'il a de bon plutot que de tout perdre.
   */
  useEffect(() => {
    if (!sessionReady || restoredRef.current) return;
    restoredRef.current = true;
    const draft = sanitizeDraft(readDraft(storageKey), {
      themeIds: THEMES.map((t) => t.id),
      toneIds: TONES.map((t) => t.id),
      formats: Object.keys(VIDEO_SIZE),
      maxStep: S.contenu,
      defaults: {
        themeId: THEMES[0].id,
        toneId: TONES[0].id,
        format: '9:16',
        titleStyle: DEFAULT_TEXT_STYLES.title,
        subtitleStyle: DEFAULT_TEXT_STYLES.subtitle,
        ctaStyle: { ...DEFAULT_TEXT_STYLES.cta, subColor: '' },
        sequences: DEFAULT_SEQUENCES,
        durations: { intro: SEQ.intro, cards: SEQ.cards, video: SEQ.video, cta: SEQ.cta },
      },
    });
    if (!draft) return;

    setStarted(!!draft.started);
    setStep(draft.step ?? 0);
    setThemeId(draft.themeId!);
    setCustomTopic(draft.customTopic ?? '');
    setToneId(draft.toneId!);
    setFormat(draft.format as Format);
    setColors(draft.colors ?? null);
    setTitleStyle(draft.titleStyle as TextStyles['title']);
    setSubtitleStyle(draft.subtitleStyle as TextStyles['subtitle']);
    setCtaStyle(draft.ctaStyle as TextStyles['cta']);
    setWatermarkOverride(draft.watermarkOverride ?? null);
    setWatermarkEnabled(draft.watermarkEnabled !== false);
    setSequences(draft.sequences as typeof DEFAULT_SEQUENCES);
    setIntroDuration(draft.introDuration!);
    setCardsDuration(draft.cardsDuration!);
    setVideoDuration(draft.videoDuration!);
    setCtaDuration(draft.ctaDuration!);
    if (draft.generated) setGenerated(draft.generated as Generated);
    if (draft.audioKeyframes) setAudioKeyframes(draft.audioKeyframes as AudioKeyframe[]);
    if (draft.musicUrl) { setMusicUrl(draft.musicUrl); setMusicName(draft.musicName ?? ''); }
    if (draft.voiceUrl) { setVoiceUrl(draft.voiceUrl); setVoiceName(draft.voiceName ?? ''); }
    setMusicVolume(draft.musicVolume!);
    setVoiceVolume(draft.voiceVolume!);
    if (draft.rushUrl) {
      setRushUrl(draft.rushUrl);
      setRushName(draft.rushName ?? '');
      setRushIsClip(!!draft.rushIsClip);
    }
    if (draft.scheduledDate) setScheduledDate(draft.scheduledDate);
    // Le contenu a ete regenere s'il vient du brouillon : la signature evite
    // qu'il soit remplace par un autre texte des la premiere navigation.
    if (draft.generated) genSigRef.current = `${draft.customTopic?.trim() || (THEMES.find((t) => t.id === draft.themeId) ?? THEMES[0]).topic}|${draft.toneId}`;

    // Dire ce qui a ete retrouve : sans un mot, l'utilisateur ne sait pas si
    // son travail est revenu ou si l'ecran est reparti de zero.
    const bits = [
      draft.generated ? 'contenu' : null,
      draft.colors ? 'couleurs' : null,
      draft.rushUrl ? 'rush' : null,
      draft.musicUrl || draft.voiceUrl ? 'audio' : null,
    ].filter(Boolean);
    // Uniquement si le brouillon porte du travail : annoncer « Brouillon
    // restaure » sur un ecran vierge inquiete sans rien apprendre.
    if (draft.started || draft.generated) {
      setRestoredNotice(`Brouillon restauré${bits.length ? ` (${bits.join(', ')})` : ''}.`);
    }
    // `restoredRef` garantit un seul passage : une fois la session resolue,
    // relancer la restauration ecraserait ce que l'utilisateur vient de regler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionReady, storageKey]);

  /**
   * Sauvegarde : minuterie, PLUS trois filets.
   *
   * Le `beforeunload` seul ne suffit pas : il ne se declenche pas sur une
   * navigation interne Next (un clic dans la barre laterale demonte le
   * composant sans jamais le lever), et il est ignore sur mobile. D'ou
   * l'ecriture dans le nettoyage de l'effet — qui couvre le demontage, donc
   * la navigation interne — et `pagehide`, plus fiable qu'`unload` sur iOS.
   */
  /**
   * Ecriture effective — le SEUL point qui touche au stockage.
   *
   * Le garde est ici, et pas seulement a l'entree des effets : « Repartir de
   * zero » le baisse puis recharge la page, et c'est `pagehide` qui, sinon,
   * reecrivait aussitot le brouillon qu'on venait d'effacer.
   *
   * Rien n'est ecrit tant que l'utilisateur n'a pas commence : une simple
   * visite laissait sinon un brouillon par defaut, et la visite suivante
   * annoncait « Brouillon restaure » sur un ecran vierge.
   */
  const flushDraft = useCallback(() => {
    if (!restoredRef.current || !sessionReady) return;
    const draft = draftRef.current();
    if (!draft.started && !draft.generated) return;
    writeDraft(storageKey, draft);
  }, [storageKey, sessionReady]);
  const flushRef = useRef(flushDraft);
  flushRef.current = flushDraft;

  // Minuterie : une ecriture APRES la pause de frappe. Le nettoyage ne fait
  // qu'annuler le minuteur — y ecrire rendait le debounce inoperant, puisque
  // cet effet se relance a chaque frappe.
  useEffect(() => {
    const timer = setTimeout(() => flushRef.current(), 400);
    return () => clearTimeout(timer);
  }, [buildDraft, flushDraft]);

  /**
   * Les filets : demontage et fermeture d'onglet.
   *
   * `beforeunload` ne se declenche pas sur une navigation interne Next — un
   * clic dans la barre laterale demonte le composant sans jamais le lever —
   * d'ou l'ecriture dans le nettoyage. Et `pagehide` est plus fiable
   * qu'`unload` sur mobile.
   */
  useEffect(() => {
    const onHide = () => flushRef.current();
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('beforeunload', onHide);
      onHide();
    };
  }, []);

  /** Repartir de zero — le brouillon est efface, la page se recharge propre. */
  const discardDraft = () => {
    // L'ordre compte : baisser le garde AVANT d'effacer. `flushDraft` le lit
    // a chaque appel, donc plus rien ne peut reecrire — ni le nettoyage des
    // effets, ni le `pagehide` que va lever le rechargement. Sans cela,
    // « repartir de zero » repartait du meme brouillon.
    restoredRef.current = false;
    clearDraft(storageKey);
    window.location.reload();
  };

  const genTimerRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    return () => {
      if (genTimerRef.current) clearTimeout(genTimerRef.current);
    };
  }, []);

  // Date du jour posée après le montage : la calculer pendant le rendu
  // provoquerait un écart d'hydratation entre serveur et navigateur.
  useEffect(() => {
    // `setScheduledDate` seulement si le champ est encore vide : cet effet
    // s'executait APRES la restauration et ecrasait la date du brouillon par
    // celle du jour.
    setScheduledDate((prev) => {
      if (prev) return prev;
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    });
  }, []);

  /** Ordre effectif : sequences activees, dans l'ordre choisi. */
  const activeOrder = sequences.filter((s) => s.enabled).map((s) => s.key);

  /**
   * Un onglet braque sur une sequence masquee ne montrerait qu'un plateau
   * vide, sans rien pour l'expliquer — le desactiver empeche de le CHOISIR,
   * pas d'y RESTER. On revient donc a la vue d'ensemble.
   */
  useEffect(() => {
    if (previewFocus !== 'all' && !activeOrder.includes(previewFocus)) setPreviewFocus('all');
  }, [previewFocus, activeOrder]);

  /**
   * Duree effective d'une sequence : 0 si elle est desactivee.
   *
   * Une sequence masquee a une duree NULLE — c'est ainsi que le compositeur
   * l'exclut, et que le Calendrier la filtre (`dur > 0`). Passer par ce seul
   * point evite que l'apercu, la video et le Calendrier divergent.
   */
  const seqDuration = (k: SeqKey): number => {
    if (!activeOrder.includes(k)) return 0;
    return { intro: introDuration, cards: cardsDuration, video: videoDuration, cta: ctaDuration }[k];
  };

  /**
   * Geometrie du montage pour le mixeur audio : elle doit etre calculee sur
   * `activeOrder` + `seqDuration`, jamais sur les durees brutes. Une sequence
   * masquee ou deplacee change le debut de la sequence video et la duree
   * totale ; sans ca la timeline du mixeur decrirait un autre montage que
   * celui exporte, et un keyframe pose « au milieu » tomberait ailleurs.
   */
  const mixLayout = {
    totalDuration: activeOrder.reduce((sum, k) => sum + seqDuration(k), 0),
    videoSeqStart: activeOrder
      .slice(0, Math.max(0, activeOrder.indexOf('video')))
      .reduce((sum, k) => sum + seqDuration(k), 0),
    videoSeqDuration: seqDuration('video'),
  };

  const moveSequence = (from: SeqKey, to: SeqKey) => {
    if (from === to) return;
    setSequences((prev) => {
      const next = [...prev];
      const fi = next.findIndex((s) => s.key === from);
      const ti = next.findIndex((s) => s.key === to);
      if (fi === -1 || ti === -1) return prev;
      const [moved] = next.splice(fi, 1);
      next.splice(ti, 0, moved);
      return next;
    });
  };

  /** Deplacement relatif — repli accessible du glisser-deposer. */
  const moveSequenceBy = (key: SeqKey, delta: number) => {
    setSequences((prev) => {
      const i = prev.findIndex((s) => s.key === key);
      const j = i + delta;
      if (i === -1 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const toggleSequence = (key: SeqKey) => {
    setSequences((prev) => {
      const next = prev.map((s) => (s.key === key ? { ...s, enabled: !s.enabled } : s));
      // Garde-fou : jamais zero sequence. Le compositeur retomberait sur une
      // intro d'1 s et le Calendrier afficherait une barre de progression NaN.
      return next.some((s) => s.enabled) ? next : prev;
    });
  };

  /**
   * Rush importe : la sequence « Video » s'active et prend une duree utile.
   *
   * Sans cette duree la sequence resterait a zero, et le compositeur l'exclut
   * a zero (`videoDuration > 0`) : le rush serait televerse, affiche dans la
   * liste… et absent du montage. Les deux vont donc ensemble, ici, en un seul
   * point.
   */
  const applyRush = async (url: string, name: string, isClip = false) => {
    // Jeton d'import : deux imports rapproches se resolvent dans l'ordre de
    // leur SONDE, pas de leur appel. Sans ce garde, le rush affiche pourrait
    // porter la duree de celui qu'il vient de remplacer.
    const runId = ++rushRunIdRef.current;
    setRushUrl(url);
    setRushName(name);
    setRushIsClip(isClip);
    setSequences((prev) => prev.map((s) => (s.key === 'video' ? { ...s, enabled: true } : s)));
    setRushLoading(true);
    try {
      const probed = await probeRushDuration(url);
      if (rushRunIdRef.current !== runId) return;
      const seconds = probed
        ? Math.min(Math.max(Math.round(probed), RUSH_SECONDS.min), RUSH_SECONDS.max)
        : RUSH_SECONDS.fallback;
      setVideoDuration(seconds);
      console.log(
        `[Assistant] Rush importé — durée source ${probed ? probed.toFixed(1) + 's' : 'illisible'}, séquence vidéo ${seconds}s`,
      );
    } finally {
      if (rushRunIdRef.current === runId) setRushLoading(false);
    }
  };

  /** Retrait du rush : la sequence video repart masquee et a duree nulle. */
  const clearRush = () => {
    // Invalide toute sonde en vol : sans cela elle reposerait une duree sur
    // une sequence que l'utilisateur vient de retirer.
    rushRunIdRef.current++;
    setRushLoading(false);
    setRushUrl(null);
    setRushName('');
    setRushIsClip(false);
    setVideoDuration(0);
    setSequences((prev) => prev.map((s) => (s.key === 'video' ? { ...s, enabled: false } : s)));
  };

  const theme = THEMES.find((t) => t.id === themeId) ?? THEMES[0];
  const tone = TONES.find((t) => t.id === toneId) ?? TONES[0];
  const topicText = customTopic.trim() || theme.topic;

  // ── Génération ──────────────────────────────────────────────────────
  const runGeneration = useCallback(() => {
    setGenerating(true);
    setError(null);
    // Laisse le navigateur peindre l'état « génération » avant le calcul
    // synchrone de smart-content. Le timer est mémorisé pour être annulé au
    // démontage — même discipline que le reste du dépôt.
    if (genTimerRef.current) clearTimeout(genTimerRef.current);
    genTimerRef.current = setTimeout(() => {
      try {
        const seed = Math.floor(Math.random() * 100000) + tone.seedOffset;
        genSigRef.current = `${topicText}|${tone.id}`;
        const result = generateSmartContent(topicText, seed);
        setGenerated({
          title: result.tagLine,
          subtitle: result.subtitle,
          cards: result.cards.slice(0, 5).map((c) => ({ ...c, id: newCardId() })),
          cta: tone.cta,
          ctaSub: tone.ctaSub,
        });
      } catch {
        setError("La génération du contenu a échoué. Réessayez.");
      } finally {
        setGenerating(false);
      }
    }, 30);
  }, [topicText, tone]);

  /**
   * Sujet ou ton depuis la derniere generation. Sert a ne PAS regenerer un
   * contenu que l'utilisateur vient de regler — et a le regenerer des qu'il
   * change de sujet.
   */
  const genSigRef = useRef('');

  /**
   * Genere le contenu s'il manque, ou si le sujet/ton a change depuis.
   *
   * Appele en entrant dans Style : sans contenu, l'apercu n'affiche qu'un
   * placeholder, les onglets n'ont rien a montrer et regler les couleurs ou
   * la typo se fait a l'aveugle — ce que la refonte etait justement censee
   * corriger.
   */
  const ensureGenerated = useCallback(() => {
    if (generated && genSigRef.current === `${topicText}|${tone.id}`) return;
    runGeneration();
  }, [generated, topicText, tone.id, runGeneration]);

  const goToStyle = () => {
    setStep(S.style);
    ensureGenerated();
  };

  const goToGeneration = () => {
    setStep(S.contenu);
    // Le contenu existe deja si l'utilisateur n'a pas change de sujet : le
    // regenerer lui donnerait un texte different de celui sur lequel il vient
    // de regler son style. Le bouton « Relancer » reste la pour le faire
    // explicitement.
    ensureGenerated();
  };

  // ── Envoi au calendrier ─────────────────────────────────────────────
  /**
   * Envoi au calendrier — LE point où le montage est produit.
   *
   * Cette page est la source de vérité : la vidéo est composée ICI, à partir
   * du design exact montré dans l'aperçu, puis le post est créé AVEC son
   * `renderedVideoUrl`. Le Calendrier n'a donc plus rien à recomposer : il lit
   * la vidéo telle quelle (calendar/page.tsx branche `renderedVideoUrl`).
   *
   * Ordre volontaire :
   *   1. vérification du solde   → on ne lance pas un rendu qu'on ne peut payer
   *   2. photo des cartes        → garantit apercu == video, pixel pour pixel
   *   3. composition + upload    → composeAndUpload fait les deux
   *   4. création du post
   *   5. débit des crédits       → EN DERNIER
   *
   * Le débit vient après le post, et non l'inverse : si /api/posts échoue,
   * l'utilisateur ne doit pas se retrouver débité, sans post, avec une vidéo
   * orpheline — et invité à recommencer, donc à payer une seconde fois.
   * Un échec de composition ne débite rien non plus.
   */
  const sendToCalendar = async () => {
    if (!generated || sending) return;
    setSending(true);
    setError(null);
    setRenderProgress(0);
    setRenderStage('Préparation…');

    const isReel = format === '9:16';
    const size = VIDEO_SIZE[format];
    // 9:16 = reel, tout le reste = tv. Même convention que l'éditeur
    // (creer/page.tsx), et même classification que le compositeur, qui range
    // le carré du côté non-vertical (`isReel = h > w`).
    //
    // `post.format` ne distingue que ces deux valeurs : c'est
    // `metadata.videoSize` qui porte les dimensions réelles, et c'est lui que
    // le Calendrier lit pour dimensionner son conteneur. Sans cela un montage
    // carré serait recadré dans un cadre 16:9 — la vidéo n'est pas déformée,
    // mais on en perdrait le haut et le bas, CTA compris.
    const renderFormat: 'reel' | 'tv' = isReel ? 'reel' : 'tv';
    // Le carré est aussi large que le 9:16 et deux fois moins haut : le
    // facturer au tarif paysage ferait payer plus cher un rendu plus petit.
    const cost = format === '16:9' ? COST.tv : COST.reel;

    try {
      // 1. Solde — non bloquant si l'endpoint est indisponible, comme l'éditeur.
      try {
        const check = await fetch('/api/credits/balance').then((r) => r.json());
        const balance = check?.data?.credits ?? check?.balance;
        // `check.ok` est indispensable : la route renvoie `{ok:false, balance:0}`
        // sur 401/500. Sans ce garde, une panne passagère afficherait
        // « Crédits insuffisants : 0 disponible » à un utilisateur qui en a.
        const readable = check?.success !== false && check?.ok !== false;
        if (readable && typeof balance === 'number' && balance < cost) {
          setError(`Crédits insuffisants : ${cost} requis, ${balance} disponible(s).`);
          return;
        }
      } catch {
        // On continue : un échec de lecture du solde ne doit pas bloquer.
      }

      // 2. Photo des cartes de l'aperçu (WYSIWYG). Le compositeur blitte cette
      //    image au lieu de redessiner les cartes lui-même — c'est ce qui rend
      //    l'aperçu et la vidéo strictement identiques.
      let cardsSnapshot: HTMLImageElement | undefined;
      let cardsSnapshotRect: { x: number; y: number; width: number; height: number } | undefined;
      // Les onglets de l'apercu n'affichent qu'un element a la fois. La photo,
      // elle, doit TOUJOURS partir de la composition complete : prise depuis
      // l'onglet « Titre », elle aurait fige des cartes vides dans la video.
      // `flushSync` force le rendu AVANT la capture ; le `finally` restaure
      // l'onglet de l'utilisateur meme si la capture echoue.
      const focusBeforeCapture = previewFocus;
      try {
        if (focusBeforeCapture !== 'all') {
          flushSync(() => setPreviewFocus('all'));
          // Une frame de peinture, bornee : `requestAnimationFrame` est GELE
          // dans un onglet en arriere-plan. Sans ce delai de garde, lancer
          // l'envoi puis changer d'onglet laissait la promesse pendante et le
          // bouton desactive jusqu'au retour de l'utilisateur.
          await new Promise<void>((r) => {
            const done = () => { clearTimeout(timer); r(); };
            const timer = setTimeout(r, 300);
            requestAnimationFrame(() => requestAnimationFrame(done));
          });
        }
        const cardsEl = cardsRef.current;
        const previewEl = previewRef.current;
        if (cardsEl && previewEl && cardsEl.offsetWidth > 0) {
          setRenderStage('Capture de l’aperçu…');
          const { domToCanvas } = await import('modern-screenshot');
          // Les polices doivent être chargées, sinon la capture sérialise une
          // police de repli et le rendu diverge de l'écran.
          try { await (document as unknown as { fonts?: FontFaceSet }).fonts?.ready; } catch { /* ignore */ }
          // Capture 1:1 a la resolution NATIVE du plateau.
          //
          // `width`/`height` sont OBLIGATOIRES ici. Sans eux, `resolveBoundingBox`
          // (modern-screenshot) appelle `getBoundingClientRect()`, qui renvoie la
          // boite APRES le `transform: scale` de l'ancetre : la lib capturerait
          // 272x276 au lieu de 907x922, et forcerait cette taille sur le clone
          // racine alors que ses enfants gardent leurs px natifs — contenu
          // deborde et rogne. Les fournir court-circuite ce calcul et donne au
          // clone ses dimensions de layout.
          const canvas = await domToCanvas(cardsEl, {
            backgroundColor: undefined,
            scale: 1,
            width: cardsEl.offsetWidth,
            height: cardsEl.offsetHeight,
          });
          console.log(
            `[Assistant] Capture cartes ${canvas.width}x${canvas.height} (1:1, resolution native)`,
          );
          const img = new Image();
          img.src = canvas.toDataURL('image/png');
          // onerror ET timeout : sans eux, une data URL qui ne se décode pas
          // laisse la promesse pendante pour toujours — le bouton reste
          // désactivé et l'utilisateur doit recharger la page.
          await new Promise<void>((resolve) => {
            const done = () => resolve();
            const timer = setTimeout(done, 10000);
            img.onload = () => { clearTimeout(timer); done(); };
            img.onerror = () => { clearTimeout(timer); done(); };
          });
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            cardsSnapshot = img;
            const pRect = previewEl.getBoundingClientRect();
            const cRect = cardsEl.getBoundingClientRect();
            cardsSnapshotRect = {
              x: ((cRect.left - pRect.left) / pRect.width) * 100,
              y: ((cRect.top - pRect.top) / pRect.height) * 100,
              width: (cRect.width / pRect.width) * 100,
              height: (cRect.height / pRect.height) * 100,
            };
          }
        }
      } catch (err) {
        // Non fatal : sans photo, le compositeur redessine les cartes lui-même
        // (style Compact, qu'il connaît). Le rendu reste correct, simplement
        // moins fidèle au pixel près.
        console.warn('[Assistant] Capture des cartes impossible, rendu canvas de secours:', err);
      } finally {
        if (focusBeforeCapture !== 'all') setPreviewFocus(focusBeforeCapture);
      }

      // 3. Composition + upload (composeAndUpload fait les deux et produit
      //    aussi la vignette).
      setRenderStage('Rendu du montage…');
      // Cartes enrichies d'un `iconImage` : sans cela le repli canvas du
      // compositeur ecrirait « Droplet » en toutes lettres.
      const composerCards = await preRenderCardIcons(
        generated.cards.map((c) => ({
          emoji: c.icon,
          label: c.title,
          value: c.value,
          description: c.description,
          color: accent,
        })),
      );
      const composed = await composeAndUpload({
        width: size.w,
        height: size.h,
        fps: 30,
        // Le compositeur ne met PAS le titre en majuscules (contrairement a
        // l'apercu, qui applique `uppercase` en CSS) : on le fait ici.
        title: (generated.title || 'Infographie').toUpperCase(),
        subtitle: generated.subtitle || undefined,
        cards: composerCards,
        // Rush : `drawVideoSeq` le cadre en « cover » (echelle uniforme
        // `max(w/srcW, h/srcH)`), donc il recadre mais n'etire JAMAIS — le
        // ratio de la source est preserve quel que soit le format de sortie.
        //
        // Conditionne a la sequence : un rush transmis alors que la sequence
        // « Video » est masquee etait quand meme telecharge et decode, et sa
        // seule presence fait basculer le compositeur en rendu TEMPS REEL
        // (`hasRushAudio = !!videoEl`) — dix fois plus lent, pour une video
        // qui n'apparait nulle part dans le montage.
        videoUrl: seqDuration('video') > 0 ? rushUrl || undefined : undefined,
        // Une sequence desactivee a une duree nulle : c'est ainsi que le
        // compositeur l'exclut (conditions d'inclusion), et le Calendrier la
        // filtre pareil (`dur > 0`).
        introDuration: seqDuration('intro'),
        cardsDuration: seqDuration('cards'),
        videoDuration: seqDuration('video'),
        ctaDuration: seqDuration('cta'),
        // Le compositeur bascule en mode « normal » (temps reel, audio mixe et
        // embarque) des qu'une de ces deux URL est fournie ; sans elles il
        // reste en mode « fast ».
        musicUrl: musicUrl || undefined,
        voiceUrl: voiceUrl || undefined,
        musicVolume,
        voiceVolume,
        // Mixeur unifie : ces keyframes pilotent les trois bus audio du
        // compositeur (musique, rush, voix). Absents tant que l'utilisateur
        // n'a rien reglé — donc aucun changement pour les montages existants.
        audioKeyframes: audioKeyframes.length > 0 ? audioKeyframes : undefined,
        sequenceOrder: activeOrder,
        accentColor: accent,
        // drawCTA lit `design.ctaMainText || watermarkText || 'AFROBOOST'` :
        // ces deux options seules ne suffisent pas, d'ou les champs `design`
        // ci-dessous. Sans eux la video affichait « AFROBOOST » en gros.
        ctaText: generated.ctaSub,
        ctaSubText: generated.ctaSub,
        watermarkText: generated.cta,
        // Filigrane. `enabled: false` est la SEULE facon de l'eteindre : le
        // compositeur allume le calque des qu'il n'est pas explicitement
        // desactive, et se rabat alors sur « Afroboost.com ».
        siteText: watermarkConfig,
        design: {
          cardStyle: CARD_STYLE,
          // Sans ce champ : titre et CTA en Helvetica, cartes en Inter.
          font: DESIGN.font,

          // ── Fond ──────────────────────────────────────────────────────
          gradientColor1: gradStart,
          gradientColor2: gradEnd,
          gradientOpacity,
          // Aucune sequence en noir plein, et pas d'affiche : le backdrop
          // degrade est peint partout, exactement comme dans l'apercu.
          noColorSequences: [],

          // ── Titre : haut-gauche ───────────────────────────────────────
          titleAlign: 'left' as const,
          titlePosition: { x: titlePos.x, y: titlePos.y },
          titleSize: DESIGN.titleWidth,
          // Typographie du titre — memes valeurs que l'apercu.
          // `textScale` est le SEUL levier de taille que `drawIntro` connait ;
          // il vaut aussi pour le sous-titre, que le compositeur dimensionne
          // avec le meme facteur.
          ...textDesign,

          // ── CTA : bas-centre ──────────────────────────────────────────
          // `ctaMainText` est lu EN PREMIER par drawCTA ; `ctaSubTextDesign`
          // est le nom du champ cote design pour le sous-texte.
          ctaMainText: generated.cta,
          ctaSubTextDesign: generated.ctaSub,
          watermarkPosition: { x: ctaPos.x, y: ctaPos.y },
          watermarkSize: DESIGN.ctaWidth,

          // ── Cartes : image de l'apercu, blittee telle quelle ──────────
          cardsSnapshot,
          cardsSnapshotRect,
        },
        onProgress: (pct, stage) => {
          setRenderProgress(Math.max(0, Math.min(100, Math.round(pct))));
          if (stage) setRenderStage(stage);
        },
      });

      if (!composed.url) {
        setError("Le montage a été rendu mais son envoi a échoué. Réessayez.");
        return;
      }

      // 4. Création du post AVANT le débit. Dans l'autre ordre, un échec de
      //    /api/posts laissait l'utilisateur débité, sans post, avec une vidéo
      //    orpheline — et le message l'invitait à recommencer, donc à payer
      //    une seconde fois.
      setRenderStage('Finalisation…');

      // Le post, montage inclus. `renderedVideoUrl` +
      //    `thumbnailUrl` + `composerVersion` à jour : le Calendrier lit la
      //    vidéo directement et n'affiche même pas son bouton « Régénérer ».
      const metadata = {
        type: 'infographic',
        source: 'assistant-simple',
        subtitle: generated.subtitle,
        theme: theme.id,
        cards: generated.cards.map((c) => ({
          emoji: c.icon,
          label: c.title,
          value: c.value,
          description: c.description,
          color: accent,
        })),
        // Le Calendrier detecte l'audio via `!!meta?.hasAudio` : le laisser a
        // `false` alors qu'une piste est embarquee ferait afficher l'apercu en
        // muet, avec le bouton de son masque.
        //
        // `hasAudio` reste vrai meme si l'URL n'est pas persistable : le son
        // est de toute facon EMBARQUE dans le fichier rendu.
        //
        // Le rush compte lui aussi : il porte sa propre piste, que le
        // compositeur route et embarque dans le fichier
        // (`hasRushAudio = !!videoEl`). L'omettre faisait proposer par le
        // Calendrier « Ajouter du son » sur un montage qui en avait deja.
        hasAudio: !!(musicUrl || voiceUrl || (rushUrl && seqDuration('video') > 0)),
        // Les URL `blob:` ne survivent pas au rechargement de la page. Le
        // panneau audio televerse normalement les pistes et renvoie une URL
        // publique, mais il retombe sur un blob local si le televersement de
        // la voix de synthese echoue. Stocker cette URL-la laisserait une
        // reference morte dans le post.
        musicUrl: persistableUrl(musicUrl),
        voiceUrl: persistableUrl(voiceUrl),
        // Le rush est deja INCRUSTE dans le montage ; on le persiste quand
        // meme sous `rushUrls` — c'est le champ que le Calendrier relit pour
        // regenerer (`videoUrl: meta.rushUrls?.[0]`). Sans lui, une
        // regeneration produirait le meme montage AMPUTE de sa sequence video.
        // Meme condition que `videoUrl` ci-dessus : un rush persiste alors que
        // sa sequence est masquee ferait re-telecharger et re-decoder le
        // fichier a chaque regeneration depuis le Calendrier, en pure perte.
        rushUrls:
          seqDuration('video') > 0 && persistableUrl(rushUrl)
            ? [persistableUrl(rushUrl)!]
            : undefined,
        renderedVideoUrl: composed.url,
        thumbnailUrl: composed.thumbnailUrl || undefined,
        composerVersion: composed.composerVersion || CURRENT_COMPOSER_VERSION,
        // Dimensions REELLES du montage. `post.format` ne connait que
        // « reel » et « tv » : sans ce champ, le Calendrier cadrerait un
        // carre dans un conteneur 16:9 et en perdrait le haut et le bas,
        // CTA compris.
        videoSize: { w: size.w, h: size.h },
        // Meme source que les durees passees au compositeur : l'apercu, la
        // video et le Calendrier suivent donc strictement le meme ordre.
        sequences: {
          intro: seqDuration('intro'),
          cards: seqDuration('cards'),
          video: seqDuration('video'),
          cta: seqDuration('cta'),
          total: activeOrder.reduce((t, k) => t + seqDuration(k), 0),
          order: activeOrder,
        },
        branding: {
          accentColor: accent,
          ctaText: generated.cta,
          ctaSubText: generated.ctaSub,
          watermarkText: generated.cta,
          borderEnabled: false,
          borderColor: null,
        },
        design: {
          cardStyle: CARD_STYLE,
          font: DESIGN.font,
          // Persiste pour que le Calendrier (apercu HTML et regeneration)
          // ancre le titre a GAUCHE comme la video, et non centre sur x=8%.
          titleAlign: 'left',
          // Memes champs typographiques que ceux passes au compositeur : une
          // regeneration depuis le Calendrier repart donc du meme rendu.
          ...textDesign,
          ctaMainText: generated.cta,
          ctaSubText: generated.ctaSub,
          gradientColor1: gradStart,
          gradientColor2: gradEnd,
          gradientOpacity,
          noColorSequences: [],
          // Filigrane persiste : le Calendrier le relit pour sa
          // reconstruction HTML (`design.siteText`) ET pour toute
          // regeneration du montage. Sans lui, les deux se rabattent sur
          // « Afroboost.com » — le post afficherait un filigrane que
          // l'utilisateur n'a jamais choisi, et different de sa video.
          siteText: watermarkConfig,
          // Le Calendrier lit les positions sous `positions.*` (imbrique),
          // la ou le compositeur attend des cles a plat. On ecrit la forme
          // du Calendrier ici pour que sa reconstruction HTML de secours
          // place le titre et le CTA au meme endroit que la video.
          positions: {
            title: { x: titlePos.x, y: titlePos.y },
            watermark: { x: ctaPos.x, y: ctaPos.y },
          },
          sizes: {
            title: DESIGN.titleWidth,
            watermark: DESIGN.ctaWidth,
          },
        },
      };

      const res = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Meme casse que le titre envoye au compositeur : une recomposition
          // ulterieure repart de post.title et doit produire le meme rendu.
          title: (generated.title || 'Infographie').toUpperCase(),
          caption: generated.subtitle || '',
          media_url: composed.url,
          media_type: 'video',
          format: renderFormat,
          platforms: [],
          scheduled_date: scheduledDate,
          scheduled_time: '12:00',
          status: 'draft',
          metadata,
        }),
      });

      const json = await res.json();
      if (!json.success || !json.post?.id) {
        setError(
          res.status === 401
            ? 'Votre session a expiré. Reconnectez-vous et réessayez.'
            : "Le montage est prêt mais l'enregistrement du post a échoué.",
        );
        return;
      }
      // 5. Débit — le post existe, la vidéo est en ligne. On lit le statut :
      //    `/api/credits/deduct` répond 402 sur solde insuffisant, et un
      //    `.catch()` seul n'attrape que les erreurs réseau, pas un 402.
      try {
        const deductRes = await fetch('/api/credits/deduct', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cost, reason: 'render', format: renderFormat }),
        });
        if (!deductRes.ok) {
          console.warn(`[Assistant] Débit des crédits refusé (${deductRes.status}) — post ${json.post.id} conservé`);
        }
      } catch (e) {
        console.warn('[Assistant] Débit des crédits injoignable — post conservé:', e);
      }

      setRenderProgress(100);
      setSent(true);
    } catch (err) {
      console.error('[Assistant] Envoi au calendrier échoué:', err);
      setError(
        err instanceof Error && err.message
          ? `Le rendu a échoué : ${err.message}`
          : 'Le rendu du montage a échoué. Réessayez.',
      );
    } finally {
      setSending(false);
    }
  };


  const reset = () => {
    setStarted(false);
    setStep(S.sujet);
    // Sans cela, le montage suivant naitrait filtre sur l'onglet du precedent.
    setPreviewFocus('all');
    // Meme raison pour le placement : sans remise a zero, le montage suivant
    // heriterait en silence du titre et du CTA deplaces du precedent — et les
    // enverrait tels quels au compositeur et aux metadonnees.
    setTitlePos(DESIGN.titlePos);
    setCtaPos(DESIGN.ctaPos);
    setOpenSection('format');
    genSigRef.current = '';
    setGenerated(null);
    setSent(false);
    setError(null);
  };

  // ── Rendu ───────────────────────────────────────────────────────────
  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
      <div className="lg:col-span-3 space-y-4">
        {error && (
          <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Brouillon retrouve. Sans un mot, l'utilisateur ne sait pas si son
            travail est revenu ou si l'ecran est reparti de zero — et « repartir
            de zero » doit rester a portee, sans etre un gros bouton. */}
        {restoredNotice && (
          <div className="flex items-center gap-3 rounded-xl border border-gray-800 bg-gray-900/50 px-4 py-2.5 text-[13px] text-gray-400">
            <RotateCcw className="w-4 h-4 flex-shrink-0 text-gray-500" />
            <span className="flex-1">{restoredNotice}</span>
            <button
              type="button"
              onClick={discardDraft}
              className="text-gray-500 underline underline-offset-2 hover:text-white transition"
            >
              Repartir de zéro
            </button>
            <button
              type="button"
              onClick={() => setRestoredNotice(null)}
              aria-label="Masquer ce message"
              className="text-gray-600 hover:text-white transition"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Choix du parcours */}
        {!started && (
          <>
            <Card>
              <div className="flex items-start gap-4">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: `${accent}26`, color: '#C4B5FD' }}
                >
                  <Wand2 className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle className="text-lg">Créer avec l&apos;assistant</CardTitle>
                  <CardContent className="mt-1 text-sm text-gray-400">
                    Quatre étapes — sujet, style, contenu, envoi. Le texte et les cartes sont
                    générés pour vous.
                  </CardContent>
                  <div className="mt-4">
                    <Button variant="primary" size="sm" onClick={() => setStarted(true)}>
                      Commencer
                    </Button>
                  </div>
                </div>
              </div>
            </Card>

            <Card>
              <div className="flex items-start gap-4">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: '#EC489926', color: '#F9A8D4' }}
                >
                  <Rocket className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CardTitle className="text-lg">Autopilote</CardTitle>
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                      style={{
                        backgroundColor: `${accent}33`,
                        color: '#DDD6FE',
                        boxShadow: `inset 0 0 0 1px ${accent}66`,
                      }}
                    >
                      Pro
                    </span>
                  </div>
                  <CardContent className="mt-1 text-sm text-gray-400">
                    Studiio produit et planifie vos contenus en continu à partir de vos objectifs.
                  </CardContent>
                  <div className="mt-4">
                    <Button variant="secondary" size="sm" disabled aria-disabled="true" className={DISABLED}>
                      Activer
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          </>
        )}

        {/* Wizard */}
        {started && (
          <Card>
            {/* Fil d'étapes */}
            <div className="flex items-center gap-2 mb-6">
              {STEPS.map((label, i) => (
                <div key={label} className="flex items-center gap-2 flex-1 last:flex-none">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                      style={
                        i <= step
                          ? { backgroundColor: accent, color: '#fff' }
                          : { backgroundColor: '#1F2937', color: '#6B7280' }
                      }
                    >
                      {i < step ? <Check className="w-3 h-3" /> : i + 1}
                    </span>
                    <span
                      className={`text-[11px] truncate ${i === step ? 'text-white font-medium' : 'text-gray-500'}`}
                    >
                      {label}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div
                      className="h-px flex-1 min-w-2"
                      style={{ backgroundColor: i < step ? accent : '#1F2937' }}
                    />
                  )}
                </div>
              ))}
            </div>

            {/* Étape 1 — sujet */}
            {step === S.sujet && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold mb-1">De quoi parle votre contenu ?</h3>
                  <p className="text-sm text-gray-400">
                    Choisissez un thème, ou saisissez votre propre sujet.
                  </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {THEMES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        setThemeId(t.id);
                        setCustomTopic('');
                      }}
                      className={`rounded-xl px-3 py-2.5 text-left text-xs transition ${
                        themeId === t.id && !customTopic
                          ? 'bg-purple-600/20 ring-1 ring-purple-500/50 text-white'
                          : 'bg-gray-900/60 text-gray-400 hover:text-white hover:bg-gray-800/70'
                      }`}
                    >
                      <CardIcon name={t.icon} size={13} color="currentColor" className="inline-block mr-1.5 align-[-2px]" />
                      {t.label}
                    </button>
                  ))}
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Ou votre sujet</label>
                  <input
                    type="text"
                    value={customTopic}
                    onChange={(e) => setCustomTopic(e.target.value)}
                    placeholder="Ex. : récupération après le sport"
                    className="w-full rounded-xl bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none p-2.5 text-sm"
                  />
                </div>

                <div className="flex justify-end pt-2">
                  <Button variant="primary" size="sm" onClick={goToStyle}>
                    <span className="flex items-center gap-2">
                      Continuer <ArrowRight className="w-4 h-4" />
                    </span>
                  </Button>
                </div>
              </div>
            )}

            {/* Étape 2 — ton + format */}
            {step === S.style && (
              <div className="space-y-3">
                <div>
                  <h3 className="font-semibold mb-1">Quel style ?</h3>
                  <p className="text-sm text-gray-400">
                    Le ton oriente l&apos;appel à l&apos;action et la variante de contenu retenue.
                  </p>
                </div>

                {/* Accordeon — une seule section ouverte a la fois. Le panneau
                    s'allongeait jusqu'a chasser l'apercu hors de l'ecran ; en
                    repliant, la colonne de reglages garde une hauteur a peu
                    pres constante et l'apercu reste en vis-a-vis. Aucun reglage
                    n'a ete retire : ils sont seulement regroupes. */}
                <StyleSection
                  id="format"
                  title="Ton et format"
                  hint={`${tone.label} · ${format}`}
                  open={openSection === 'format'}
                  onToggle={toggleSection}
                >
                    <div className="grid grid-cols-2 gap-2">
                      {TONES.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => setToneId(t.id)}
                          className={`rounded-xl px-3 py-2.5 text-left transition ${
                            toneId === t.id
                              ? 'bg-purple-600/20 ring-1 ring-purple-500/50'
                              : 'bg-gray-900/60 hover:bg-gray-800/70'
                          }`}
                        >
                          <div
                            className={`text-sm font-medium ${toneId === t.id ? 'text-white' : 'text-gray-300'}`}
                          >
                            {t.label}
                          </div>
                          <div className="text-[11px] text-gray-500 mt-0.5">{t.hint}</div>
                        </button>
                      ))}
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">Format</label>
                      <div className="flex gap-2">
                        {(['9:16', '1:1', '16:9'] as const).map((f) => (
                          <button
                            key={f}
                            onClick={() => setFormat(f)}
                            aria-pressed={format === f}
                            className={`flex-1 rounded-xl px-3 py-2.5 text-sm transition ${
                              format === f
                                ? 'bg-purple-600/20 text-purple-200 ring-1 ring-purple-500/50'
                                : 'bg-gray-900 text-gray-400 hover:text-white'
                            }`}
                          >
                            {f}
                            <span className="block text-[10px] text-gray-500">
                              {FORMAT_HINT[f]}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                </StyleSection>

                <StyleSection
                  id="couleurs"
                  title="Couleurs"
                  hint={colors ? 'Personnalisées' : 'Kit de marque'}
                  swatches={[accent, gradStart, gradEnd]}
                  open={openSection === 'couleurs'}
                  onToggle={toggleSection}
                >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="block text-sm font-medium">Couleurs</label>
                        {colors && (
                          <button
                            type="button"
                            onClick={() => { setColors(null); setEditedColor(null); }}
                            className="text-[11px] text-gray-500 hover:text-white transition"
                          >
                            Revenir au kit de marque
                          </button>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {([
                          { key: 'accent' as const, label: 'Accent', value: accent },
                          { key: 'gradStart' as const, label: 'Dégradé — début', value: gradStart },
                          { key: 'gradEnd' as const, label: 'Dégradé — fin', value: gradEnd },
                        ]).map((c) => (
                          <button
                            key={c.key}
                            type="button"
                            onClick={() => setEditedColor(editedColor === c.key ? null : c.key)}
                            aria-pressed={editedColor === c.key}
                            className={`flex-1 rounded-xl px-3 py-2.5 text-left transition ${
                              editedColor === c.key
                                ? 'bg-gray-800 ring-1 ring-purple-500/50'
                                : 'bg-gray-900/60 hover:bg-gray-800/70'
                            }`}
                          >
                            <span
                              className="block h-5 w-full rounded-md border border-white/10"
                              style={{ backgroundColor: c.value }}
                            />
                            <span className="mt-1.5 block text-[10px] text-gray-400 truncate">{c.label}</span>
                          </button>
                        ))}
                      </div>

                      {editedColor && (
                        <div className="mt-2 rounded-xl bg-gray-900/60 p-3">
                          <ColorWheel
                            color={
                              editedColor === 'accent' ? accent : editedColor === 'gradStart' ? gradStart : gradEnd
                            }
                            onChange={(value) => setColor({ [editedColor]: value })}
                            label={
                              editedColor === 'accent'
                                ? 'Accent'
                                : editedColor === 'gradStart'
                                  ? 'Dégradé — début'
                                  : 'Dégradé — fin'
                            }
                          />
                        </div>
                      )}

                      <p className="mt-1.5 text-[11px] text-gray-500">
                        Le dégradé peint le fond ; l&apos;accent colore le halo du filigrane et la
                        barre de progression.
                      </p>

                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-[11px] text-gray-500 w-24 flex-shrink-0">Opacité du fond</span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={Math.round(gradientOpacity * 100)}
                          onChange={(e) => setColor({ gradientOpacity: Number(e.target.value) / 100 })}
                          aria-label="Opacité du dégradé de fond"
                          className="flex-1 h-1 rounded-lg appearance-none bg-gray-700 accent-purple-500 cursor-pointer"
                        />
                        <span className="text-[11px] text-gray-400 w-9 text-right tabular-nums">
                          {Math.round(gradientOpacity * 100)}%
                        </span>
                      </div>
                    </div>
                </StyleSection>

                <StyleSection
                  id="texte"
                  title="Texte"
                  hint={`${textStyles.title.font} · filigrane ${watermarkVisible ? 'affiché' : 'masqué'}`}
                  open={openSection === 'texte'}
                  onToggle={toggleSection}
                >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="block text-sm font-medium">Texte</label>
                        <button
                          type="button"
                          onClick={() => {
                            setTitleStyle(DEFAULT_TEXT_STYLES.title);
                            setSubtitleStyle(DEFAULT_TEXT_STYLES.subtitle);
                            setCtaStyle({ ...DEFAULT_TEXT_STYLES.cta, subColor: '' });
                            setEditedTextColor(null);
                          }}
                          className="text-[11px] text-gray-500 hover:text-white transition"
                        >
                          Réinitialiser
                        </button>
                      </div>

                      <div className="flex gap-2 mb-2">
                        {([
                          { key: 'title' as const, label: 'Titre', hint: 'le grand texte' },
                          { key: 'subtitle' as const, label: 'Sous-titre', hint: 'sous le titre' },
                          { key: 'cta' as const, label: 'CTA', hint: 'et sous-texte' },
                        ]).map((z) => (
                          <button
                            key={z.key}
                            type="button"
                            onClick={() => {
                          setEditedZone(z.key);
                          setEditedTextColor(null);
                          // Le sous-titre n'a pas d'onglet : il vit avec le
                          // titre, comme dans le montage. Et on ne braque
                          // l'apercu que sur une sequence reellement active,
                          // sinon le plateau se viderait sans explication.
                          const target = z.key === 'cta' ? 'cta' : 'intro';
                          if (activeOrder.includes(target)) setPreviewFocus(target);
                        }}
                            aria-pressed={editedZone === z.key}
                            className={`flex-1 rounded-xl px-3 py-2 text-left transition ${
                              editedZone === z.key
                                ? 'bg-purple-600/20 ring-1 ring-purple-500/50'
                                : 'bg-gray-900/60 hover:bg-gray-800/70'
                            }`}
                          >
                            <span
                              className={`block text-sm font-medium ${editedZone === z.key ? 'text-white' : 'text-gray-300'}`}
                            >
                              {z.label}
                            </span>
                            <span className="block text-[10px] text-gray-500">{z.hint}</span>
                          </button>
                        ))}
                      </div>

                      {(() => {
                        const isTitle = editedZone === 'title';
                        const isSubtitle = editedZone === 'subtitle';
                        const zoneLabel = isTitle ? 'titre' : isSubtitle ? 'sous-titre' : 'CTA';
                        /** Applique un correctif a la zone en cours. */
                        const patch = (p: Record<string, unknown>) =>
                          isTitle
                            ? setTitleStyle((prev) => ({ ...prev, ...p }))
                            : isSubtitle
                              ? setSubtitleStyle((prev) => ({ ...prev, ...p }))
                              : setCtaStyle((prev) => ({ ...prev, ...p }));
                        // Le sous-titre affiche ce qu'il HERITE tant qu'il n'a
                        // rien de propre : montrer « Inter » alors que le titre
                        // est en Anton mentirait sur ce que produit la video.
                        const zone = isTitle
                          ? textStyles.title
                          : isSubtitle
                            ? {
                                font: textStyles.subtitle.font || textStyles.title.font,
                                color: textStyles.subtitle.color || `${textStyles.title.color}CC`,
                                scale: textStyles.subtitle.scale,
                              }
                            : textStyles.cta;
                        return (
                          <div className="rounded-xl bg-gray-900/60 p-3 space-y-3">
                            <div>
                              <label
                                htmlFor="txt-font"
                                className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1"
                              >
                                Police
                              </label>
                              <select
                                id="txt-font"
                                value={zone.font}
                                onChange={(e) => patch({ font: e.target.value })}
                                // Sans feuille chargee, les cinquante et
                                // quelques noms s'affichent tous dans la meme
                                // police systeme. On charge donc le 400 de
                                // TOUT le catalogue — une seule requete — des
                                // que l'utilisateur s'approche du selecteur.
                                onFocus={() => { void preloadCatalogPreview(); }}
                                onPointerEnter={() => { void preloadCatalogPreview(); }}
                                style={{ fontFamily: fontStack(zone.font) }}
                                className="w-full rounded-lg bg-gray-800 border border-gray-700 focus:border-purple-500 outline-none px-2 py-1.5 text-sm"
                              >
                                {FONT_GROUPS.map((g) => (
                                  <optgroup key={g.group} label={g.label}>
                                    {g.fonts.map((f) => (
                                      <option key={f} value={f} style={{ fontFamily: fontStack(f) }}>
                                        {f}
                                      </option>
                                    ))}
                                  </optgroup>
                                ))}
                              </select>
                            </div>

                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-gray-500 w-24 flex-shrink-0">Taille</span>
                              <input
                                type="range"
                                min={60}
                                max={180}
                                step={5}
                                value={Math.round(zone.scale * 100)}
                                onChange={(e) => patch({ scale: Number(e.target.value) / 100 })}
                                aria-label={`Taille du texte — ${zoneLabel}`}
                                className="flex-1 h-1 rounded-lg appearance-none bg-gray-700 accent-purple-500 cursor-pointer"
                              />
                              <span className="text-[11px] text-gray-400 w-11 text-right tabular-nums">
                                {Math.round(zone.scale * 100)}%
                              </span>
                            </div>

                            {!isSubtitle && (
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-gray-500 w-24 flex-shrink-0">
                                Interligne
                              </span>
                              <input
                                type="range"
                                min={0.9}
                                max={2}
                                step={0.05}
                                value={'lineHeight' in zone ? zone.lineHeight : 1.1}
                                onChange={(e) => patch({ lineHeight: Number(e.target.value) })}
                                aria-label={`Interligne — ${zoneLabel}`}
                                className="flex-1 h-1 rounded-lg appearance-none bg-gray-700 accent-purple-500 cursor-pointer"
                              />
                              <span className="text-[11px] text-gray-400 w-11 text-right tabular-nums">
                                {'lineHeight' in zone ? zone.lineHeight.toFixed(2) : ''}
                              </span>
                            </div>
                            )}

                            {/* Gras / italique — titre ET CTA. `drawCTA` lit
                                desormais `ctaTypography.bold/italic` ; le
                                sous-titre, lui, reste sur ceux du titre, que
                                `drawIntro` lui impose. */}
                            {!isSubtitle && (() => {
                              const st = isTitle ? textStyles.title : textStyles.cta;
                              return (
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] text-gray-500 w-24 flex-shrink-0">Style</span>
                                <button
                                  type="button"
                                  onClick={() => patch({ bold: !st.bold })}
                                  aria-pressed={st.bold}
                                  aria-label={`Gras — ${zoneLabel}`}
                                  className={`rounded-lg px-3 py-1 text-xs font-bold transition ${
                                    st.bold
                                      ? 'bg-purple-600/30 text-white ring-1 ring-purple-500/50'
                                      : 'bg-gray-800 text-gray-400 hover:text-white'
                                  }`}
                                >
                                  G
                                </button>
                                <button
                                  type="button"
                                  onClick={() => patch({ italic: !st.italic })}
                                  aria-pressed={st.italic}
                                  aria-label={`Italique — ${zoneLabel}`}
                                  className={`rounded-lg px-3 py-1 text-xs italic transition ${
                                    st.italic
                                      ? 'bg-purple-600/30 text-white ring-1 ring-purple-500/50'
                                      : 'bg-gray-800 text-gray-400 hover:text-white'
                                  }`}
                                >
                                  I
                                </button>
                              </div>
                              );
                            })()}

                            {/* Interlettrage — titre et CTA. La coupe des lignes
                                est desormais mesuree AVEC l'espacement cote
                                compositeur : la video coupe la ou l'apercu coupe,
                                et le texte ne sort plus du cadre. Le sous-titre en
                                est prive : il est trace par `fillText` nu. */}
                            {!isSubtitle && (() => {
                              const st = isTitle ? textStyles.title : textStyles.cta;
                              return (
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] text-gray-500 w-24 flex-shrink-0">
                                  Interlettrage
                                </span>
                                <input
                                  type="range"
                                  min={-2}
                                  max={10}
                                  step={0.5}
                                  value={st.letterSpacing}
                                  onChange={(e) => patch({ letterSpacing: Number(e.target.value) })}
                                  aria-label={`Interlettrage — ${zoneLabel}`}
                                  className="flex-1 h-1 rounded-lg appearance-none bg-gray-700 accent-purple-500 cursor-pointer"
                                />
                                <span className="text-[11px] text-gray-400 w-11 text-right tabular-nums">
                                  {st.letterSpacing}
                                </span>
                              </div>
                              );
                            })()}

                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-gray-500 w-24 flex-shrink-0">Couleur</span>
                              <button
                                type="button"
                                onClick={() =>
                                  setEditedTextColor(editedTextColor === 'color' ? null : 'color')
                                }
                                aria-pressed={editedTextColor === 'color'}
                                aria-label={`Couleur — ${zoneLabel}`}
                                className={`h-6 flex-1 rounded-md border transition ${
                                  editedTextColor === 'color' ? 'border-purple-400' : 'border-white/10'
                                }`}
                                style={{ backgroundColor: zone.color }}
                              />
                              {editedZone === 'cta' && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditedTextColor(editedTextColor === 'subColor' ? null : 'subColor')
                                  }
                                  aria-pressed={editedTextColor === 'subColor'}
                                  aria-label="Couleur du sous-texte du CTA"
                                  className={`h-6 flex-1 rounded-md border transition ${
                                    editedTextColor === 'subColor'
                                      ? 'border-purple-400'
                                      : 'border-white/10'
                                  }`}
                                  style={{ backgroundColor: textStyles.cta.subColor }}
                                />
                              )}
                            </div>

                            {editedTextColor && (
                              <ColorWheel
                                color={
                                  editedTextColor === 'subColor' ? textStyles.cta.subColor : zone.color
                                }
                                onChange={(value) => patch({ [editedTextColor]: value })}
                                label={editedTextColor === 'subColor' ? 'Sous-texte' : 'Texte'}
                              />
                            )}

                            {missingFonts.includes(zone.font) && (
                              <p className="text-[11px] text-amber-400/90">
                                « {zone.font} » n’a pas pu être chargée : l’aperçu et la
                                vidéo utiliseront une police de repli.
                              </p>
                            )}

                            <p className="text-[11px] text-gray-500">
                              {isTitle
                                ? 'Sans réglage propre, le sous-titre suit le titre.'
                                : isSubtitle
                                  ? 'Graisse, italique et interligne restent ceux du titre : le montage les lui impose.'
                                  : 'La même police sert au CTA et à son sous-texte.'}
                            </p>
                          </div>
                        );
                      })()}
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label htmlFor="wm-text" className="block text-sm font-medium">
                          Filigrane
                        </label>
                        <button
                          type="button"
                          onClick={() => setWatermarkEnabled((v) => !v)}
                          title={watermarkEnabled ? 'Masquer le filigrane' : 'Afficher le filigrane'}
                          className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-white transition"
                        >
                          {watermarkVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                          {watermarkVisible ? 'Affiché' : 'Masqué'}
                        </button>
                      </div>
                      <input
                        id="wm-text"
                        type="text"
                        value={watermarkText}
                        onChange={(e) => setWatermarkOverride(e.target.value)}
                        disabled={!watermarkEnabled}
                        placeholder={DEFAULT_WATERMARK}
                        maxLength={40}
                        className="w-full rounded-xl bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none p-2.5 text-sm disabled:opacity-40"
                      />
                      <p className="mt-1 text-[11px] text-gray-500">
                        Affiché en bas de chaque séquence du montage.
                        {watermarkEnabled && !watermarkVisible && ' Champ vide : rien ne sera affiché.'}
                      </p>
                    </div>
                </StyleSection>

                <StyleSection
                  id="sequences"
                  title="Séquences"
                  hint={`${activeOrder.length} active${activeOrder.length > 1 ? 's' : ''}${rushUrl ? ' · rush' : ''}`}
                  open={openSection === 'sequences'}
                  onToggle={toggleSection}
                >
                    <div>
                      <label className="block text-sm font-medium mb-2">Séquences</label>
                      <p className="text-xs text-gray-500 mb-2">
                        Glissez pour réordonner. L&apos;œil active ou masque une séquence.
                      </p>
                      <div className="space-y-1.5">
                        {sequences.map((seq) => {
                          const meta = SEQ_META[seq.key];
                          const position = activeOrder.indexOf(seq.key);
                          const isVideo = seq.key === 'video';
                          // Seule une sequence video SANS rush reste inerte. Des
                          // qu'un rush est importe, elle se deplace, se masque et
                          // s'affiche comme les trois autres.
                          const inert = isVideo && !rushUrl;
                          return (
                            <div
                              key={seq.key}
                              draggable={!inert}
                              onDragStart={(e) => {
                                // Firefox n'initie aucun drag HTML5 sans donnees.
                                e.dataTransfer.setData('text/plain', seq.key);
                                e.dataTransfer.effectAllowed = 'move';
                                setDragKey(seq.key);
                              }}
                              onDragEnd={() => setDragKey(null)}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={(e) => {
                                e.preventDefault();
                                const from = (dragKey || e.dataTransfer.getData('text/plain')) as SeqKey;
                                if (from) moveSequence(from, seq.key);
                                setDragKey(null);
                              }}
                              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition ${
                                dragKey === seq.key ? 'opacity-40' : ''
                              } ${
                                seq.enabled
                                  ? 'bg-gray-900/60 ring-1 ring-purple-500/20'
                                  : 'bg-gray-900/30 opacity-50'
                              } ${inert ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}`}
                            >
                              <GripVertical
                                className={`w-4 h-4 flex-shrink-0 ${inert ? 'text-gray-700' : 'text-gray-500'}`}
                              />
                              <span
                                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                                style={
                                  seq.enabled
                                    ? { backgroundColor: accent, color: '#fff' }
                                    : { backgroundColor: '#1F2937', color: '#6B7280' }
                                }
                              >
                                {seq.enabled ? position + 1 : '—'}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium truncate">{meta.label}</div>
                                <div className="text-[11px] text-gray-500 truncate" title={isVideo && rushUrl ? rushName : undefined}>
                                  {isVideo && rushUrl ? rushName || 'Rush importé' : meta.hint}
                                </div>
                              </div>
                              <span className="text-[11px] text-gray-500 flex-shrink-0">
                                {seq.enabled ? `${seqDuration(seq.key)}s` : ''}
                              </span>
                              {/* Import du rush — la mediatheque sert a la fois de
                                  televersement et de re-selection d'un fichier
                                  deja envoye, comme dans le panneau audio. */}
                              {isVideo && (
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => setRushLibOpen(true)}
                                    disabled={rushLoading}
                                    title={rushUrl ? 'Remplacer le rush' : 'Importer un rush'}
                                    aria-label={rushUrl ? 'Remplacer le rush' : 'Importer un rush'}
                                    className="flex items-center gap-1 rounded-lg bg-gray-800 hover:bg-gray-700 px-2 py-1 text-[10px] font-medium text-gray-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition"
                                  >
                                    {rushLoading ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                      <Film className="w-3 h-3" />
                                    )}
                                    {rushUrl ? 'Changer' : 'Importer'}
                                  </button>
                                  {rushUrl && !rushIsClip && (
                                    <button
                                      type="button"
                                      onClick={() => setClipSource({ url: rushUrl, name: rushName || 'rush' })}
                                      disabled={rushLoading}
                                      title="Découper les temps forts du rush. Le premier extrait devient la séquence Vidéo ; les autres restent dans la médiathèque."
                                      aria-label="Découper les temps forts du rush"
                                      className="flex items-center gap-1 rounded-lg bg-gray-800 hover:bg-gray-700 px-2 py-1 text-[10px] font-medium text-gray-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition"
                                    >
                                      <Sparkles className="w-3 h-3" />
                                      Temps forts
                                    </button>
                                  )}
                                  {rushUrl && (
                                    <button
                                      type="button"
                                      onClick={clearRush}
                                      title="Retirer le rush"
                                      aria-label="Retirer le rush"
                                      className="text-gray-500 hover:text-red-400 transition"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              )}
                              {/* Repli tactile et clavier : le glisser-deposer
                                  HTML5 n'existe pas sur mobile. */}
                              <div className="flex flex-col flex-shrink-0">
                                <button
                                  type="button"
                                  onClick={() => moveSequenceBy(seq.key, -1)}
                                  disabled={inert}
                                  title="Monter"
                                  aria-label={`Monter ${meta.label}`}
                                  className="text-gray-500 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed leading-none"
                                >
                                  <ChevronUp className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => moveSequenceBy(seq.key, 1)}
                                  disabled={inert}
                                  title="Descendre"
                                  aria-label={`Descendre ${meta.label}`}
                                  className="text-gray-500 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed leading-none"
                                >
                                  <ChevronDown className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              <button
                                type="button"
                                onClick={() => toggleSequence(seq.key)}
                                disabled={inert}
                                title={seq.enabled ? 'Masquer' : 'Afficher'}
                                className="flex-shrink-0 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                {seq.enabled ? (
                                  <Eye className="w-4 h-4" />
                                ) : (
                                  <EyeOff className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      {rushUrl && (
                        <p className="text-[11px] text-gray-500 mt-2">
                          Le rush est intégré au montage à la place qu&apos;occupe la séquence
                          Vidéo, au ratio de la source. Le rendu se fait alors en temps réel :
                          comptez la durée du montage.
                        </p>
                      )}
                      {/* Mediatheque — televersement ET re-selection d'un rush deja
                          envoye. Meme composant que le panneau audio, filtre sur
                          les videos. */}
                      <MediaLibrary
                        isOpen={rushLibOpen}
                        onClose={() => setRushLibOpen(false)}
                        mediaType="video"
                        onSelect={(url, name) => { void applyRush(url, name); }}
                      />
                    </div>
                </StyleSection>

                <div className="flex justify-between pt-2">
                  <Button variant="ghost" size="sm" onClick={() => setStep(S.sujet)}>
                    <span className="flex items-center gap-2">
                      <ArrowLeft className="w-4 h-4" /> Retour
                    </span>
                  </Button>
                  <Button variant="primary" size="sm" onClick={() => setStep(S.audio)}>
                    <span className="flex items-center gap-2">
                      <Music className="w-4 h-4" /> Suivant : audio
                    </span>
                  </Button>
                </div>
              </div>
            )}

            {/* Étape 3 — audio (facultatif) */}
            {step === S.audio && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-semibold">Musique et voix</h3>
                  <p className="text-xs text-gray-500 mt-1">
                    Facultatif. Sans piste, le montage est rendu bien plus vite ;
                    avec une piste, le son est intégré au fichier exporté.
                  </p>
                </div>

                <AudioStudioPanel
                  musicUrl={musicUrl}
                  musicName={musicName}
                  voiceUrl={voiceUrl}
                  voiceName={voiceName}
                  musicVolume={musicVolume}
                  voiceVolume={voiceVolume}
                  onMusicChange={(url, name) => {
                    setMusicUrl(url);
                    setMusicName(name);
                  }}
                  onVoiceChange={(url, name) => {
                    setVoiceUrl(url);
                    setVoiceName(name);
                  }}
                  onMusicVolumeChange={setMusicVolume}
                  onVoiceVolumeChange={setVoiceVolume}
                  introDuration={introDuration}
                  cardsDuration={cardsDuration}
                  videoDuration={videoDuration}
                  ctaDuration={ctaDuration}
                  onIntroDurationChange={setIntroDuration}
                  onCardsDurationChange={setCardsDuration}
                  onVideoDurationChange={setVideoDuration}
                  onCtaDurationChange={setCtaDuration}
                  // Sans rush, le champ « durée de la séquence Vidéo » reste
                  // masqué : il n'y aurait rien à cadencer.
                  hasRush={!!rushUrl}
                  contentTheme={themeId}
                  // Branche le mixeur unifie : un seul bouton « Mixer » pour
                  // les trois niveaux, au lieu d'un curseur par source.
                  rushUrl={rushUrl}
                  audioKeyframes={audioKeyframes}
                  onAudioKeyframesChange={setAudioKeyframes}
                  // Geometrie reelle (sequences masquees / reordonnees prises
                  // en compte) : sans elle le mixeur decrirait un autre montage.
                  mixLayout={mixLayout}
                />

                <div className="flex justify-between pt-2">
                  <Button variant="ghost" size="sm" onClick={() => setStep(S.style)}>
                    <span className="flex items-center gap-2">
                      <ArrowLeft className="w-4 h-4" /> Retour
                    </span>
                  </Button>
                  <Button variant="primary" size="sm" onClick={goToGeneration}>
                    <span className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4" /> Générer le contenu
                    </span>
                  </Button>
                </div>
              </div>
            )}

            {/* Étape 4 — contenu généré */}
            {step === S.contenu && (
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold mb-1">Votre contenu</h3>
                  <p className="text-sm text-gray-400">
                    Relancez si le résultat ne vous convient pas.
                  </p>
                </div>

                {generating && (
                  <div className="flex items-center justify-center gap-3 py-10 text-sm text-gray-400">
                    <Loader2 className="w-5 h-5 animate-spin" /> Génération…
                  </div>
                )}

                {!generating && generated && (
                  <div className="space-y-3">
                    <div className="rounded-xl bg-gray-900/60 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                        Titre
                      </div>
                      <div className="text-sm font-bold">{generated.title}</div>
                      <div className="text-xs text-gray-400 mt-1">{generated.subtitle}</div>
                    </div>

                    <div className="space-y-1.5">
                      {(activeOrder.includes('cards') ? generated.cards : []).map((c) => (
                        <div
                          key={c.id}
                          className="flex items-start gap-3 rounded-xl bg-gray-900/60 p-3"
                        >
                          <CardIcon name={c.icon} size={16} color="#C4B5FD" className="" />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate">{c.title}</div>
                            <div className="text-xs text-gray-500 mt-0.5">{c.description}</div>
                          </div>
                          {c.value && (
                            <span
                              className="text-xs font-bold flex-shrink-0"
                              style={{ color: gradEnd }}
                            >
                              {c.value}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="rounded-xl bg-gray-900/60 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                        Appel à l&apos;action
                      </div>
                      <div className="text-sm font-bold">{generated.cta}</div>
                      <div className="text-xs" style={{ color: gradEnd }}>
                        {generated.ctaSub}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex justify-between pt-2 gap-2 flex-wrap">
                  <Button variant="ghost" size="sm" onClick={() => setStep(S.audio)}>
                    <span className="flex items-center gap-2">
                      <ArrowLeft className="w-4 h-4" /> Retour
                    </span>
                  </Button>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={runGeneration}
                      disabled={generating}
                      className={DISABLED}
                    >
                      <span className="flex items-center gap-2">
                        <RefreshCw className="w-4 h-4" /> Relancer
                      </span>
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setStep(S.envoi)}
                      disabled={generating || !generated}
                      className={DISABLED}
                    >
                      <span className="flex items-center gap-2">
                        Continuer <ArrowRight className="w-4 h-4" />
                      </span>
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Étape 4 — envoi */}
            {step === S.envoi && (
              <div className="space-y-4">
                {sent ? (
                  <div className="py-6 text-center space-y-4">
                    <div
                      className="w-12 h-12 rounded-full mx-auto flex items-center justify-center"
                      style={{ backgroundColor: '#10B98126', color: '#6EE7B7' }}
                    >
                      <Check className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="font-semibold">Envoyé au calendrier</div>
                      <p className="text-sm text-gray-400 mt-1">
                        La vidéo est composée et le post enregistré en brouillon. Le calendrier
                        la lit telle quelle — aucun nouveau rendu n'est nécessaire.
                      </p>
                    </div>
                    <div className="flex gap-2 justify-center flex-wrap">
                      <a href="/dashboard/calendar" className="button-primary px-4 py-2 text-sm">
                        Ouvrir le calendrier
                      </a>
                      <Button variant="ghost" size="sm" onClick={reset}>
                        Créer un autre contenu
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      <h3 className="font-semibold mb-1">Envoyer au calendrier</h3>
                      <p className="text-sm text-gray-400">
                        La vidéo est composée maintenant, exactement telle que l&apos;aperçu
                        l&apos;affiche, puis enregistrée en brouillon.{' '}
                        <span className="text-gray-300">
                          {format === '9:16' ? COST.reel : COST.tv} crédits
                        </span>{' '}
                        seront débités une fois le rendu terminé.
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-2">Date</label>
                      <input
                        type="date"
                        value={scheduledDate}
                        onChange={(e) => setScheduledDate(e.target.value)}
                        className="w-full rounded-xl bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none p-2.5 text-sm"
                      />
                    </div>

                    <div className="flex justify-between pt-2">
                      <Button variant="ghost" size="sm" onClick={() => setStep(S.contenu)}>
                        <span className="flex items-center gap-2">
                          <ArrowLeft className="w-4 h-4" /> Retour
                        </span>
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={sendToCalendar}
                        disabled={sending || !scheduledDate}
                        className={DISABLED}
                      >
                        <span className="flex items-center gap-2">
                          {sending ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" /> Rendu…
                            </>
                          ) : (
                            <>
                              <CalendarPlus className="w-4 h-4" /> Composer et envoyer
                            </>
                          )}
                        </span>
                      </Button>
                    </div>

                    {/* Progression du rendu — même barre fine que la page avatar */}
                    {sending && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <div
                            className="flex-1 rounded-full overflow-hidden"
                            style={{ height: 5, backgroundColor: '#1F2937' }}
                            role="progressbar"
                            aria-valuenow={renderProgress}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label="Progression du rendu"
                          >
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${renderProgress}%`,
                                background: `linear-gradient(90deg, ${accent} 0%, ${gradEnd} 100%)`,
                                transition: 'width 300ms ease-out',
                              }}
                            />
                          </div>
                          <span
                            className="text-xs font-medium text-gray-400 text-right"
                            style={{ minWidth: 34, fontVariantNumeric: 'tabular-nums' }}
                          >
                            {renderProgress}%
                          </span>
                        </div>
                        {renderStage && (
                          <p className="text-center text-xs text-gray-500">{renderStage}</p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </Card>
        )}
      </div>

      {/* Colonne d'apercu COLLEE : elle defilait avec les reglages et sortait
          de l'ecran des que le panneau s'allongeait. `items-start` sur la
          grille (deja present) est ce qui rend le `sticky` operant : sans lui
          la colonne s'etire sur toute la hauteur et n'a plus rien a coller.
          `top-20` et non `top-4` : la navbar est `fixed h-16`, un decalage
          plus court glissait 48 px de la carte — en-tete et onglets compris —
          sous cette barre. */}
      <div className="lg:col-span-2 lg:sticky lg:top-20">
        <Preview
          titlePos={titlePos}
          ctaPos={ctaPos}
          dragging={dragging}
          onDragStart={startDrag}
          onDragMove={moveDrag}
          onDragEnd={endDrag}
          generated={generated}
          format={format}
          previewRef={previewRef}
          cardsRef={cardsRef}
          frameRef={frameRef}
          displayScale={displayScale}
          activeOrder={activeOrder}
          gradStart={gradStart}
          gradEnd={gradEnd}
          gradientOpacity={gradientOpacity}
          rushUrl={rushUrl}
          watermark={watermarkLabel}
          accent={accent}
          text={textStyles}
          focus={previewFocus}
          onFocusChange={setPreviewFocus}
        />
      </div>

      {/* Temps forts — le modal est reutilise TEL QUEL depuis /dashboard/media.
          Il decoupe, televerse, puis rend les clips ; on retient le premier
          comme nouveau rush.

          Monte a la RACINE, et non dans l'etape Style : demonte, il
          disparaissait de l'ecran sans interrompre sa boucle d'extraction, qui
          finissait par remplacer le rush alors que l'utilisateur etait deja
          deux etapes plus loin. A la racine, il reste visible et sous son
          controle — la fermeture passe par son propre garde-fou. */}
      <ClipDetectorModal
        isOpen={clipSource !== null}
        source={clipSource}
        onClose={() => setClipSource(null)}
        onExtracted={(clips, failure) => {
          // `failure` = succes partiel ou interruption. Le modal reste alors
          // ouvert sur son propre encart d'erreur ; ce message-ci prend le
          // relais une fois qu'il est ferme, sans quoi l'echec ne laisserait
          // aucune trace.
          if (failure) setError(failure);
          const clip = clips[0];
          if (!clip) return;
          // Plus de rush : l'utilisateur l'a retire pendant l'extraction. Ses
          // extraits restent dans la mediatheque, mais aucun ne doit revenir
          // s'imposer dans un montage dont il a justement retire la video.
          if (!rushUrl) {
            console.warn('[Assistant] Extraits ignorés — le rush a été retiré entre-temps');
            return;
          }
          // Le clip DEVIENT le rush : c'est lui qui part au compositeur et
          // s'affiche dans l'apercu. Les autres extraits restent dans la
          // mediatheque, accessibles via « Changer ».
          void applyRush(clip.url, clip.name, true);
          if (!failure) setClipSource(null);
        }}
      />
    </div>
  );
}
