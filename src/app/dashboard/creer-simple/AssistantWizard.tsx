'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  Copy,
  Combine,
  Ungroup,
  Shapes,
  Search,
  Minus,
  Plus,
  ImageDown,
  Download,
  ImagePlus,
  Upload,
  Crop,
  Maximize2,
  Play,
  X,
} from 'lucide-react';
import { generateSmartContent } from '@/lib/smart-content';
import {
  composeAndUpload, composeVideo, uploadRendu, downloadBlob, CURRENT_COMPOSER_VERSION, posterTransformActive,
  type ComposerOptions,
  TRANSITION_KEYS, TRANSITION_LABELS, DEFAULT_TRANSITION, type TransitionStyle,
  TEXT_ANIMATION_KEYS, TEXT_ANIMATION_LABELS, TEXT_ANIMATION_HINTS,
  DEFAULT_TEXT_ANIMATION, type TextAnimation,
} from '@/lib/video-composer';
import { AudioStudioPanel } from '@/components/creer/AudioStudioPanel';
import { SequenceVoicesPanel } from '@/components/creer/SequenceVoicesPanel';
import { voiceSequenceSeconds } from '@/lib/creer/voiceFit';
import {
  SEQUENCE_KEYS, emptySequenceVoices, emptySequenceVoicesUserEdited, buildAutoFillText,
  type SequenceVoices, type SequenceVoicesUserEdited, type SequenceKey,
} from '@/lib/types/voice';
import type { AudioKeyframe } from '@/lib/creer/audioDucking';
import { pointToPct, grabOffset, clampToBox, type Pos, type CardBox, boxesFromRects, samePos } from '@/lib/creer/dragPosition';
import {
  snapPosition, computeDistanceBadges, anchorToCenter, centerToAnchor,
  type ActiveGuide, type DistanceBadge, type ElementPos, type Anchor,
} from '@/lib/creer/smartGuides';
import SmartGuides from '@/components/creer/SmartGuides';
import {
  nextSelection, pruneSelection, movingIds, groupBounds, clampGroupDelta, shiftBoxes,
  duplicateCards, duplicateBoxes, maxCards,
  groupCards, ungroupCards, pruneGroups, expandSelection, groupOf, newGroupId, newElementId, MIN_GROUP,
  type CardGroup,
} from '@/lib/creer/selection';
import { MediaLibrary } from '@/components/shared/MediaLibrary';
import AiImageTools from '@/components/creer/AiImageTools';
import AutopilotPanel from '@/components/creer/AutopilotPanel';
import SequenceCards from '@/components/creer/SequenceCards';
import SequenceTitle, { titleFrameStyle } from '@/components/creer/SequenceTitle';
import SequenceCta, { ctaFrameStyle } from '@/components/creer/SequenceCta';
import FreeElementsLayer, { type FreeElement } from '@/components/creer/FreeElementsLayer';
import { renderSignature, signatureMatches } from '@/lib/creer/renderSignature';

import {
  sanitizePhotos, vignetteAffichable, photoUtilisable, urlUtilisable,
} from '@/lib/creer/posterPhotos';
import ClipDetectorModal, { type ClipSource } from '@/components/media/ClipDetectorModal';
import { CardIcon } from '@/components/ui/CardIcon';
import { ICON_LIBRARY, iconMatches } from '@/lib/icons/library';
import ColorWheel from '@/components/ui/ColorWheel';
import FloatingPanel from '@/components/ui/FloatingPanel';
import { uploadPosterFile } from '@/lib/creer/posterUpload';
import {
  MAX_BATCH, clampBatchCount, batchCost, distinctPhotoForIndex, distinctUrls,
  autoAssignPhotos, batchPhotosReady, photosToFetch, batchDates, batchTopic, variationNonce,
} from '@/lib/creer/batch';
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
// FONT_RATIO vit desormais dans `designSpec` — partage avec la composition.


/**
 * Cartes en PAYSAGE — les ratios du compositeur, base 512 et non 330.
 *
 * `video-composer.ts` reproduit l'editeur avance, dont la fenetre de reference
 * fait 320 px en portrait et 512 px en paysage (`editorViewportPx`). Garder la
 * base 330 en 16:9 donnait des cartes presque deux fois trop grandes pour un
 * conteneur presque deux fois plus court : la grille debordait encore.
 *
 * Avec ces valeurs, deux rangees de trois cartes mesurent ~511 px de haut pour
 * un conteneur de 518 — c'est exactement le dimensionnement que le compositeur
 * a ete ecrit pour tenir.
 */
// Ratios de carte : lus dans la spec PARTAGEE depuis la Phase 2 — la
// composition Remotion dessine les MEMES cartes, elle doit lire les memes
// mesures.



/**
 * Ombres du compositeur, en fraction de la largeur video.
 * `dropShadowLgFilter` vaut 4/320 et 10/320 ; `dropShadowBaseFilter` 2.5/320.
 */

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
  return [
    backdropVeilCSS(gradStart, gradEnd, gradientOpacity),
    `linear-gradient(${backdropAngle(format).toFixed(2)}deg, ${gradStart} 0%, ${gradEnd} 100%)`,
  ].join(', ');
}

/**
 * Voile de degrade, seul — sans le fond plein.
 *
 * C'est la couche que le compositeur peint PAR-DESSUS l'affiche
 * (`paintSeqGradient`, position « both » par defaut : teinte en haut, teinte
 * en bas, transparent au milieu). Quand une photo sert de fond, l'apercu doit
 * garder ce voile et lui seul — sinon le degrade plein masquerait la photo a
 * l'ecran alors que la video la montrerait.
 */
function backdropVeilCSS(gradStart: string, gradEnd: string, gradientOpacity: number): string {
  const rgba = (hex: string, alpha: number) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  };
  return `linear-gradient(180deg, ${rgba(gradStart, gradientOpacity)} 0%, rgba(0,0,0,0) 40%, rgba(0,0,0,0) 60%, ${rgba(gradEnd, gradientOpacity)} 100%)`;
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

/**
 * Une phrase par style — ce qu'on VERRA, pas le nom du style.
 *
 * Les cles viennent du compositeur (`TransitionStyle`) : ajouter un style
 * la-bas sans l'expliquer ici casserait la compilation, plutot que d'afficher
 * un vide a l'ecran.
 */
const TRANSITION_HINTS: Record<TransitionStyle, string> = {
  'crossfade': 'Les deux séquences se superposent en fondu. Le plus discret.',
  'slide': 'La nouvelle séquence entre par le côté.',
  'wipe': 'Un bord balaie l’écran et découvre la suite.',
  'zoom': 'La séquence sortante s’éloigne pendant que la suivante avance.',
  'fade-to-black': 'Passage par le noir. Marque une rupture.',
  'push': 'La nouvelle séquence pousse l’ancienne vers le haut.',
  'iris': 'Un cercle s’ouvre sur la séquence suivante.',
  'blur-dissolve': 'Fondu avec un flou : plus doux que le fondu simple.',
  'whip-pan': 'Balayage rapide et flou, comme un mouvement de caméra.',
};

/** Sequences ou le filigrane est visible — noms cote editeur, comme le Calendrier les attend. */
const WATERMARK_SEQUENCES = ['titre', 'cartes', 'video', 'cta'] as const;

/**
 * Position et taille de la fenetre d'apercu agrandi.
 *
 * `localStorage` et non `sessionStorage` : c'est un reglage d'ergonomie, il
 * doit survivre a la fermeture de l'onglet.
 */
const ENLARGED_GEOMETRY_KEY = 'studiio.creer-simple.apercu-agrandi';

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

/** Sequence mise en avant dans l'apercu, ou `'all'` pour la composition entiere. */
export type PreviewFocus = 'all' | 'intro' | 'cards' | 'video' | 'cta';

/** Classes de désactivation : `Button` n'en fournit aucune (ui/Button.tsx). */
const DISABLED = 'disabled:opacity-40 disabled:cursor-not-allowed';

/**
 * Onglets au-dessus de l'apercu, dans l'ordre des sequences du montage.
 *
 * « Tout » ferme la marche : c'est la composition entiere, celle qu'on regarde
 * juste avant d'envoyer — pas une entree en matiere. Il reste neanmoins la vue
 * PAR DEFAUT (`previewFocus` demarre a `'all'`), sa place dans la rangee ne
 * changeant que la lecture.
 *
 * « Video » se desactive tout seul sans rush : `activeOrder` ne contient
 * `'video'` que lorsqu'un rush est present.
 */
const PREVIEW_TABS: Array<{ id: PreviewFocus; label: string }> = [
  { id: 'intro', label: 'Titre' },
  { id: 'cards', label: 'Cartes' },
  { id: 'video', label: 'Vidéo' },
  { id: 'cta', label: 'CTA' },
  { id: 'all', label: 'Tout' },
];

/** Sections repliables de l'etape Style — l'ordre du panneau. */
type SectionId = 'format' | 'couleurs' | 'affiche' | 'texte' | 'sequences' | 'transition' | 'animation';

/** Photo proposee par `/api/pexels` — Pexels comme Unsplash. */
interface PosterPhoto {
  id: string | number;
  url: string;
  medium?: string;
  small?: string;
  photographer?: string;
  source?: string;
}

/** Nombre de vignettes ramenees par recherche. */
const POSTER_COUNT = 12;

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
/**
 * Element libre pose sur l'apercu.
 *
 * `x`/`y` sont en % du CONTENEUR DES CARTES, et non du plateau : c'est ce
 * conteneur qui est photographie puis blitte dans la video. Un element pose
 * ailleurs serait visible a l'apercu et absent du montage.
 */
/**
 * Recadrage de l'affiche.
 *
 * `scale` >= 1 (sous 1 le cadrage « cover » laisserait une bande vide),
 * `offsetX`/`offsetY` en FRACTION du plateau — la meme convention que le
 * compositeur, pour que l'apercu et la video montrent le meme cadrage.
 */
export interface PosterTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** Cles de sequence du compositeur — l'apercu, lui, dit « intro » et « cards ». */
export type SeqBgKey = 'titre' | 'cartes' | 'video' | 'cta';

/** Fond propre a une sequence : une photo et son recadrage. */
export interface SeqBackground {
  url: string;
  transform: PosterTransform;
}

export type SeqBackgrounds = Partial<Record<SeqBgKey, SeqBackground>>;

/**
 * Sequence visee par les actions « photo ».
 *
 * `null` sur l'onglet « Tout » : on y edite l'affiche GLOBALE. L'apercu empile
 * les sequences, il ne saurait pas laquelle montrer.
 */
export function seqBgKeyForFocus(focus: PreviewFocus): SeqBgKey | null {
  if (focus === 'intro') return 'titre';
  if (focus === 'cards') return 'cartes';
  if (focus === 'video') return 'video';
  if (focus === 'cta') return 'cta';
  return null;
}

/** Fond effectif d'un onglet : celui de la sequence, sinon l'affiche globale. */
export function resolveBackground(
  focus: PreviewFocus,
  seqBackgrounds: SeqBackgrounds,
  posterUrl: string | null,
  posterTransform: PosterTransform,
): { url: string | null; transform: PosterTransform } {
  const cle = seqBgKeyForFocus(focus);
  const propre = cle ? seqBackgrounds[cle] : undefined;
  if (propre?.url) return { url: propre.url, transform: propre.transform };
  return { url: posterUrl, transform: posterTransform };
}

/**
 * Type d'echange du glisser-deposer d'une photo.
 *
 * Un type A NOUS, et non `text/plain` : le reordonnancement des sequences se
 * sert deja de `text/plain`, et lire ce dernier faisait qu'un glissement de
 * sequence passait pour un depot de photo.
 */
export const PHOTO_DND_TYPE = 'application/x-studiio-photo';

/** URL d'une photo deposee, ou `null` si le depot ne vient pas de la grille. */
export function readDroppedPhoto(dt: DataTransfer | null | undefined): string | null {
  if (!dt) return null;
  const propre = dt.getData(PHOTO_DND_TYPE);
  if (propre) return propre;
  // `text/uri-list` couvre le glisser d'une image depuis un autre onglet.
  const uri = dt.getData('text/uri-list');
  return /^https?:\/\//.test(uri) ? uri : null;
}

/** Sans recadrage : le « cover » centre d'aujourd'hui. */
export const POSTER_TRANSFORM_NEUTRAL: PosterTransform = { scale: 1, offsetX: 0, offsetY: 0 };

/** Bornes du zoom d'affiche. */
export const POSTER_ZOOM_MIN = 1;
export const POSTER_ZOOM_MAX = 3;

export function clampPosterTransform(t: Partial<PosterTransform> | undefined): PosterTransform {
  const scale = Math.min(POSTER_ZOOM_MAX, Math.max(POSTER_ZOOM_MIN, Number(t?.scale) || 1));
  // Le decalage utile est borne par ce que le zoom laisse depasser : au-dela,
  // on tirerait l'image hors du cadre et une bande vide apparaitrait.
  const marge = (scale - 1) / 2;
  const borne = (v: number) => Math.min(marge, Math.max(-marge, Number.isFinite(v) ? v : 0));
  return { scale, offsetX: borne(Number(t?.offsetX) || 0), offsetY: borne(Number(t?.offsetY) || 0) };
}

/**
 * Element libre — defini avec le composant PARTAGE qui le rend.
 *
 * Re-exporte ici : le type etait ne dans cette page, et plusieurs modules
 * l'importent encore de la. Le nom `sizePct` differe volontairement du `size`
 * d'une version anterieure, qui etait en pixels : un brouillon ecrit avec
 * l'ancienne unite est ainsi ecarte a la relecture plutot que rejoue a une
 * echelle absurde.
 */
export type { FreeElement };

/** Taille d'un element a la pose, en % de la largeur du plateau. */
const ELEMENT_SIZE_PCT = (64 / 330) * 100;

/**
 * Bornes de redimensionnement, en % de la largeur du plateau.
 *
 * En deca de 8 %, l'icone n'est plus lisible dans la video ; au-dela de 60 %,
 * elle couvre le titre et les cartes. Le pas de 4 donne une douzaine de crans
 * entre les deux — assez pour ajuster, pas assez pour s'y perdre.
 */
const ELEMENT_SIZE_MIN = 8;
const ELEMENT_SIZE_MAX = 60;
const ELEMENT_SIZE_STEP = 4;

/** Taille bornee — une valeur hors bornes rend l'element illisible ou envahissant. */
export function clampElementSize(sizePct: number): number {
  if (!Number.isFinite(sizePct)) return ELEMENT_SIZE_PCT;
  return Math.min(ELEMENT_SIZE_MAX, Math.max(ELEMENT_SIZE_MIN, sizePct));
}

/**
 * Mode libre des cartes : les emplacements ET le format dans lequel ils ont
 * ete mesures. Les separer laisserait rejouer une mesure 9:16 en 16:9.
 */
/**
 * Distance au-dela de laquelle un appui devient un glissement. En deca, c'est
 * un clic : il selectionne, il ne restructure pas la disposition.
 */
const DRAG_THRESHOLD_PX = 4;

/** Filet des cartes groupees — assez lisible sans rivaliser avec la selection. */
const GROUP_TINT = 'rgba(236,72,153,0.9)';

interface FreeCards {
  format: Format;
  boxes: Record<string, CardBox>;
}

/**
 * Le mode libre vaut-il encore ? Il lui faut le MEME format que celui de la
 * mesure, et un emplacement pour chaque carte affichee.
 */
function validFree(f: FreeCards | null | undefined, ids: string[], fmt: Format): boolean {
  if (!f || f.format !== fmt) return false;
  return ids.length > 0 && ids.every((id) => !!f.boxes[id]);
}

/** Tableaux vides STABLES : un litteral par rendu relancerait le calque. */
const EMPTY_GUIDES: ActiveGuide[] = [];
const EMPTY_BADGES: DistanceBadge[] = [];

export function Preview({
  generated,
  format,
  previewRef,
  cardsRef,
  cardBoxes = null,
  onCardDragStart,
  draggingCard = null,
  selectedCards,
  onClearSelection,
  groupedCards,
  posterUrl = null,
  posterTransform,
  cropping = false,
  onPosterPanStart,
  onPosterZoomStart,
  onPhotoDrop,
  photoDragging = false,
  guides = EMPTY_GUIDES,
  distanceBadges = EMPTY_BADGES,
  elements,
  selectedElementId = null,
  onElementDragStart,
  onElementResizeStart,
  onElementDelete,
  capturing = false,
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
  hideHeader = false,
}: {
  /**
   * Masque l'en-tete « Aperçu ». Defaut `false` : l'apercu de la colonne de
   * droite garde le sien. La fenetre agrandie, elle, porte deja ce titre dans
   * sa barre — l'afficher deux fois volerait de la hauteur au plateau.
   */
  hideHeader?: boolean;
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
  onFocusChange?: (focus: PreviewFocus) => void;
  /**
   * Element mis en avant par les onglets au-dessus de l'apercu.
   *
   * `'all'` = la composition complete, celle que photographie l'export. Les
   * autres valeurs n'isolent qu'un element pour le regler de pres : elles ne
   * changent RIEN au montage, seulement ce qui est montre.
   */
  focus?: PreviewFocus;
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
  /**
   * Emplacements libres des cartes, ou `null` pour la disposition en flux
   * d'origine. Optionnel et defaut `null` : un apercu monte nu rend
   * exactement ce qu'il rendait avant le mode libre.
   */
  cardBoxes?: Record<string, CardBox> | null;
  onCardDragStart?: (id: string, e: React.PointerEvent) => void;
  draggingCard?: string | null;
  /**
   * Cartes selectionnees. Defaut : aucune — et surtout, ce liserе n'existe
   * QUE dans l'apercu : la selection est videe avant la photo des cartes,
   * sinon elle serait blittee dans la video.
   */
  selectedCards?: Set<string>;
  onClearSelection?: () => void;
  /**
   * Cartes groupees, par identifiant de groupe. Aide d'edition : jamais
   * photographiee, jamais exportee.
   */
  groupedCards?: Record<string, string>;
  /**
   * Elements libres poses dans la zone des cartes. Defaut `[]` : un montage
   * sans element se rend exactement comme avant.
   */
  /**
   * Photo d'affiche : fond de la composition, a la place du degrade plein.
   * Absente — le cas de tous les montages existants — le fond ne change pas.
   */
  posterUrl?: string | null;
  /** Recadrage de l'affiche — zoom et decalages en fraction du plateau. */
  posterTransform?: PosterTransform;
  /** Mode recadrage actif : poignees visibles, fond saisissable. */
  cropping?: boolean;
  onPosterPanStart?: (e: React.PointerEvent) => void;
  /** Photo deposee sur le plateau — devient le fond de la sequence affichee. */
  onPhotoDrop?: (url: string) => void;
  /** Un glisser de photo est en cours : la surface de depot s'affiche. */
  photoDragging?: boolean;
  /**
   * Guides d'alignement et badges d'ecart, PENDANT un glissement. Vides par
   * defaut : un apercu monte nu — dans les tests, dans le Calendrier — rend
   * exactement ce qu'il rendait avant.
   */
  guides?: ActiveGuide[];
  distanceBadges?: DistanceBadge[];
  onPosterZoomStart?: (e: React.PointerEvent) => void;
  elements?: FreeElement[];
  selectedElementId?: string | null;
  onElementDragStart?: (id: string, e: React.PointerEvent) => void;
  /** Prise d'une poignee de coin — redimensionne au lieu de deplacer. */
  onElementResizeStart?: (id: string, e: React.PointerEvent) => void;
  onElementDelete?: (id: string) => void;
  /**
   * L'apercu est en train d'etre photographie : aucune aide d'edition n'est
   * peinte, et le plateau devient inerte. C'est ce qui empeche un clic
   * concurrent de graver un lisere dans la video.
   */
  capturing?: boolean;
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

  /**
   * Disposition des cartes en GRILLE plutot qu'en colonne.
   *
   * Reservee au paysage, et pour une raison de place : le conteneur des cartes
   * occupe 48 % de la hauteur video, alors que la taille des cartes suit la
   * LARGEUR. En 16:9 les cartes sont donc presque deux fois plus grandes pour
   * un conteneur presque deux fois plus court — cinq cartes empilees en
   * colonne debordaient de 33 px en haut comme en bas.
   *
   * Trois colonnes, comme le compositeur en paysage (`cols = isReel ? 2 : 3`).
   * Le carre garde la colonne : il tient, et le changer modifierait des
   * montages existants sans necessite.
   */
  const landscapeCards = format === '16:9';
  /**
   * Les METRIQUES suivent le format ; la DISPOSITION suit aussi le mode libre.
   * Passer en mode libre ne doit pas changer la taille du texte des cartes.
   */
  // Les ratios de carte vivent desormais dans `SequenceCards`, qui les lit
  // dans la spec partagee — l'apercu n'a plus a les connaitre.

  /**
   * Epaisseur en pixels ECRAN pour un trait peint DANS le plateau.
   *
   * Le plateau est reduit par `transform: scale(displayScale)` — autour de
   * 0,25. Un `outline: 2px` y devient donc un demi-pixel a l'ecran, soit un
   * lisere de selection quasi invisible. Ces traits sont des aides d'edition,
   * jamais photographiees : les grossir ne change rien a l'export.
   */
  const uiPx = (n: number) => n / (displayScale > 0 ? displayScale : 1);

  // Rush illisible (fichier expire, format refuse par le navigateur) : on le
  // retire de l'apercu plutot que de laisser un rectangle noir. L'etat est
  // remis a zero a chaque changement d'URL — jamais de mutation directe du
  // DOM dans un `onError`, qui survivrait aux rendus suivants.
  const [rushBroken, setRushBroken] = useState(false);
  useEffect(() => setRushBroken(false), [rushUrl]);
  // Le rush se montre dans la composition entiere ET sur son propre onglet :
  // l'isoler est tout l'interet de cet onglet.
  const showRush =
    !!rushUrl && !rushBroken && activeOrder.includes('video')
    && (focus === 'all' || focus === 'video');

  /** Une sequence est visible si elle est active ET mise en avant. */
  const shows = (seq: 'intro' | 'cards' | 'cta') =>
    activeOrder.includes(seq) && (focus === 'all' || focus === seq);


  /**
   * Interlettrage : le compositeur multiplie la valeur saisie par `w / 320`
   * (l'echelle du viewport de l'editeur). Le plateau etant a la resolution
   * native, on applique le meme facteur — sinon 2 px saisis donneraient 2 px
   * a l'ecran et 6,75 px dans la video.
   */

  // Sous-titre : chaque champ non renseigne suit le titre, exactement comme
  // `drawIntro` le fait en l'absence du champ correspondant.
  // Sans couleur choisie : celle du titre a 80 % (le `CC` du compositeur).
  // Avec : peinte a plein, ce que l'utilisateur choisit est ce qu'il voit.

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
  // `leadingTrim` vit desormais dans `designSpec`.


  return (
    <div className="card-base p-4">
      {!hideHeader && (
        <div className="flex items-center gap-2 mb-3">
          <MonitorPlay className="w-4 h-4 text-gray-500" />
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Aperçu
          </span>
        </div>
      )}

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
        // Appui qui atteint le plateau = appui dans le vide : titre, CTA et
        // cartes arretent la propagation. C'est le geste universel « je
        // deselectionne ».
        onPointerDown={capturing ? undefined : onClearSelection}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          // Inerte pendant la photo : la capture est asynchrone, et un clic
          // dans cet intervalle se retrouverait dans le montage.
          pointerEvents: capturing ? 'none' : undefined,
          width: VIDEO_SIZE[format].w,
          height: VIDEO_SIZE[format].h,
          transform: `scale(${displayScale})`,
          transformOrigin: 'top left',
          // Fond STRICTEMENT identique a celui peint par le compositeur.
          //
          // Avec une affiche : la photo en `cover`, et par-dessus le seul
          // VOILE du degrade — c'est ce que fait `drawIntro` (photo, puis
          // `paintSeqGradient`). Y laisser le degrade plein cacherait la photo
          // a l'ecran alors que la video la montrerait.
          // Avec une affiche, le fond du plateau reste sombre : la photo et le
          // voile sont deux CALQUES distincts (voir juste apres). C'est ce qui
          // permet de recadrer la photo sans toucher au voile, et de refleter
          // exactement ce que fait le compositeur — photo, puis degrade.
          background: !generated
            ? DARK
            : posterUrl
              ? DARK
              : backdropCSS(format, gradStart, gradEnd, gradientOpacity),
          // `var(--font-inter)` est la SEULE reference valide : Next charge la
          // police via next/font, il n'existe aucune @font-face nommee 'Inter'.
          fontFamily: 'var(--font-inter), Inter, sans-serif',
        }}
      >
        {/* ── SURFACE DE DEPOT ────────────────────────────────────────
            Le plateau est couvert d'enfants absolus — cartes, titre, CTA,
            elements — qui recevaient l'evenement sans autoriser le depot :
            `onDrop` ne se declenchait donc jamais. Cette surface se pose
            au-dessus de tout pendant le glissement, et lui seul. */}
        {/* Guides d'alignement — aides d'ECRAN, jamais du contenu.
            `capturing` les efface pendant la photo des cartes et pendant le
            telechargement de l'affiche : un guide grave dans la video ne se
            rattrape pas. */}
        {!capturing && (guides.length > 0 || distanceBadges.length > 0) && (
          <SmartGuides guides={guides} distanceBadges={distanceBadges} showGrid={false} />
        )}

        {photoDragging && onPhotoDrop && !capturing && (
          <div
            data-photo-drop
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
            onDrop={(e) => {
              e.preventDefault();
              const url = readDroppedPhoto(e.dataTransfer);
              if (url) onPhotoDrop(url);
            }}
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: uiPx(16),
              border: `${uiPx(3)}px dashed rgba(255,255,255,0.85)`,
              backgroundColor: 'rgba(0,0,0,0.45)',
              textAlign: 'center',
            }}
          >
            <span
              style={{
                color: '#FFFFFF',
                fontWeight: 700,
                fontSize: uiPx(13),
                lineHeight: 1.4,
                textShadow: '0 1px 4px rgba(0,0,0,0.6)',
              }}
            >
              Déposez la photo ici
              <br />
              {focus === 'all' ? 'pour l’affiche globale' : 'pour la séquence affichée'}
            </span>
          </div>
        )}

        {/* ── AFFICHE ─────────────────────────────────────────────────
            Deux calques : la photo, puis le voile du degrade. Le compositeur
            peint dans cet ordre ; l'apercu doit dire la meme chose.

            `transform` reproduit le recadrage : `translate` en % de la propre
            largeur du calque — donc du plateau — puis `scale`, exactement le
            `cx = w/2 + offX*w` du compositeur. */}
        {generated && posterUrl && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={posterUrl}
              alt=""
              data-poster-layer
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transform: `translate(${(posterTransform?.offsetX ?? 0) * 100}%, ${(posterTransform?.offsetY ?? 0) * 100}%) scale(${posterTransform?.scale ?? 1})`,
                transformOrigin: 'center',
                // Toujours inerte : c'est la surface de recadrage ci-dessous
                // qui capte le glissement. La photo est SOUS le titre et les
                // cartes — un clic au centre du plateau les atteindrait avant
                // elle, et le deplacement ne partirait jamais.
                pointerEvents: 'none',
              }}
            />
            <div
              aria-hidden
              style={{
                position: 'absolute',
                inset: 0,
                background: backdropVeilCSS(gradStart, gradEnd, gradientOpacity),
                pointerEvents: 'none',
              }}
            />
            {/* Surface de saisie du recadrage — au-dessus de tout le contenu,
                sous les poignees. Sans elle, glisser au centre du plateau
                attraperait le conteneur des cartes. */}
            {cropping && !capturing && onPosterPanStart && (
              <div
                data-poster-pan
                onPointerDown={onPosterPanStart}
                onPointerMove={onDragMove}
                onPointerUp={onDragEnd}
                onPointerCancel={onDragEnd}
                onLostPointerCapture={onDragEnd}
                title="Glisser pour repositionner la photo"
                style={{
                  position: 'absolute',
                  inset: 0,
                  cursor: 'grab',
                  touchAction: 'none',
                  zIndex: 5,
                }}
              />
            )}
            {/* Poignees de recadrage — memes gestes que celles d'un element. */}
            {cropping && !capturing && onPosterZoomStart
              && ([
                { coin: 'nw', top: 0, left: 0 },
                { coin: 'ne', top: 0, left: '100%' },
                { coin: 'sw', top: '100%', left: 0 },
                { coin: 'se', top: '100%', left: '100%' },
              ] as const).map((p) => (
                <span
                  key={p.coin}
                  data-poster-handle={p.coin}
                  onPointerDown={(e) => { e.stopPropagation(); onPosterZoomStart(e); }}
                  onPointerMove={onDragMove}
                  onPointerUp={onDragEnd}
                  onPointerCancel={onDragEnd}
                  onLostPointerCapture={onDragEnd}
                  title="Tirer pour zoomer"
                  style={{
                    position: 'absolute',
                    top: p.top,
                    left: p.left,
                    width: uiPx(11),
                    height: uiPx(11),
                    marginTop: -uiPx(5.5),
                    marginLeft: -uiPx(5.5),
                    backgroundColor: '#FFFFFF',
                    border: `${uiPx(1)}px solid rgba(0,0,0,0.5)`,
                    borderRadius: uiPx(2),
                    cursor: p.coin === 'nw' || p.coin === 'se' ? 'nwse-resize' : 'nesw-resize',
                    touchAction: 'none',
                    zIndex: 6,
                  }}
                />
              ))}
          </>
        )}

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
              data-title-block
              title={onDragStart ? "Glisser pour déplacer le titre" : undefined}
              style={{
                // Cadre PARTAGE avec la composition Remotion : la position et
                // la largeur viennent du meme helper, les aides d'edition
                // s'ajoutent par-dessus.
                ...titleFrameStyle(titlePos),
                cursor: onDragStart ? (dragging === 'title' ? 'grabbing' : 'grab') : undefined,
                // Au-dessus de la grille de cartes : sans cela, un titre
                // depose sur la zone des cartes n'etait plus saisissable —
                // la grille couvre le cadre meme quand elle est vide.
                zIndex: onDragStart ? 2 : undefined,
                touchAction: onDragStart ? 'none' : undefined,
                outline: !capturing && dragging === 'title' ? `${uiPx(1)}px dashed rgba(255,255,255,0.7)` : undefined,
                outlineOffset: uiPx(2),
              }}
            >
              {/* Titre et sous-titre : composant PARTAGE avec la composition
                  Remotion (Phase 4). Le cadre et les aides d'edition restent
                  ici — cote serveur, il n'y a ni pointeur ni glissement. */}
              <SequenceTitle
                title={generated.title}
                subtitle={generated.subtitle}
                typography={text.title}
                subtitleTypography={text.subtitle}
                format={format}
                containerWidth={vw}
              />
            </div>
            )}

            {/* Cartes — ce conteneur est PHOTOGRAPHIÉ (modern-screenshot) et
                l'image est blittée telle quelle dans la vidéo par le
                compositeur. C'est ce qui garantit que les cartes de l'aperçu
                et celles du montage sont pixel pour pixel identiques.

                Depuis la Phase 2 du rendu serveur, le rendu lui-même vit dans
                `SequenceCards`, partagé avec la composition Remotion : le MÊME
                composant produit la même image des deux côtés. Les aides
                d'édition passent par `interaction`, absent côté serveur. */}
            <SequenceCards
              containerRef={cardsRef}
              cards={shows('cards') ? generated.cards : []}
              cardBoxes={cardBoxes}
              containerWidth={vw}
              landscape={landscapeCards}
              valueColor={gradEnd}
              interaction={{
                onCardDragStart,
                onDragMove,
                onDragEnd,
                draggingCard,
                selectedCards,
                groupedCards,
                capturing,
                uiPx,
                groupTint: GROUP_TINT,
              }}
            />

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
              data-cta-block
              title={onDragStart ? "Glisser pour déplacer le CTA" : undefined}
              style={{
                ...ctaFrameStyle(ctaPos),
                cursor: onDragStart ? (dragging === 'cta' ? 'grabbing' : 'grab') : undefined,
                zIndex: onDragStart ? 2 : undefined,
                touchAction: onDragStart ? 'none' : undefined,
                outline: !capturing && dragging === 'cta' ? `${uiPx(1)}px dashed rgba(255,255,255,0.7)` : undefined,
                outlineOffset: uiPx(2),
              }}
            >
              {/* CTA : composant PARTAGE avec la composition Remotion. */}
              <SequenceCta
                text={generated.cta}
                subText={generated.ctaSub}
                typography={text.cta}
                format={format}
                containerWidth={vw}
              />
            </div>
            )}

            {/* ── ELEMENTS LIBRES ─────────────────────────────────────────
                Poses sur le PLATEAU entier, et non dans le conteneur des
                cartes : le compositeur les peint desormais lui-meme sur les
                quatre sequences, ils n'ont donc plus a entrer dans la photo
                des cartes — ils y seraient meme dessines deux fois.
                Rendus quel que soit l'onglet d'apercu, comme dans la video.

                Depuis la Phase 5 du rendu serveur, le rendu lui-meme vit dans
                `FreeElementsLayer`, partage avec la composition Remotion : le
                MEME composant produit la meme image des deux cotes. Les aides
                d'edition passent par `interaction`, absent cote serveur. */}
            <FreeElementsLayer
              elements={elements ?? []}
              containerWidth={vw}
              interaction={{
                onElementDragStart,
                onDragMove,
                onDragEnd,
                selectedElementId,
                capturing,
                uiPx,
                // Poignees et bouton de suppression : ils vivent dans le
                // repere de l'element, mais restent ECRITS ici — cote
                // serveur, `interaction` est absent et rien de tout cela
                // n'existe.
                renderChrome: (el) => (
                  <>
                    {/* Poignees de coin — redimensionnement a la souris.
                        Elles arretent la propagation : sans cela, la prise
                        deplacerait l'element au lieu de le redimensionner. */}
                    {!capturing && onElementResizeStart && selectedElementId === el.id
                      && ([
                        { coin: 'nw', top: 0, left: 0 },
                        { coin: 'ne', top: 0, left: '100%' },
                        { coin: 'sw', top: '100%', left: 0 },
                        { coin: 'se', top: '100%', left: '100%' },
                      ] as const).map((p) => (
                        <span
                          key={p.coin}
                          data-element-handle={p.coin}
                          onPointerDown={(e) => { e.stopPropagation(); onElementResizeStart(el.id, e); }}
                          onPointerMove={onDragMove}
                          onPointerUp={onDragEnd}
                          onPointerCancel={onDragEnd}
                          onLostPointerCapture={onDragEnd}
                          title="Tirer pour redimensionner"
                          style={{
                            position: 'absolute',
                            top: p.top,
                            left: p.left,
                            width: uiPx(9),
                            height: uiPx(9),
                            marginTop: -uiPx(4.5),
                            marginLeft: -uiPx(4.5),
                            backgroundColor: '#FFFFFF',
                            border: `${uiPx(1)}px solid rgba(0,0,0,0.5)`,
                            borderRadius: uiPx(2),
                            cursor: p.coin === 'nw' || p.coin === 'se' ? 'nwse-resize' : 'nesw-resize',
                            touchAction: 'none',
                            zIndex: 5,
                          }}
                        />
                      ))}
                    {!capturing && onElementDelete && selectedElementId === el.id && (
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); onElementDelete(el.id); }}
                        title="Supprimer l’élément"
                        style={{
                          position: 'absolute',
                          top: -uiPx(10),
                          right: -uiPx(10),
                          width: uiPx(18),
                          height: uiPx(18),
                          borderRadius: '9999px',
                          backgroundColor: '#DC2626',
                          color: '#FFFFFF',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          lineHeight: 0,
                        }}
                      >
                        <X style={{ width: uiPx(11), height: uiPx(11) }} />
                      </button>
                    )}
                  </>
                ),
              }}
            />

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
  const [previewFocus, setPreviewFocus] = useState<PreviewFocus>('all');
  // Lu par les gestes, memoises sans dependances.
  const previewFocusRef = useRef<PreviewFocus>('all');
  useEffect(() => { previewFocusRef.current = previewFocus; }, [previewFocus]);
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

  /**
   * Etape la plus AVANCEE atteinte, et non l'etape courante.
   *
   * Sans ce reperage, revenir sur « Sujet » ramenerait `step` a 0 et
   * interdirait de repartir vers « Contenu » — soit exactement la navigation
   * que ces puces existent pour offrir.
   */
  const [maxStepReached, setMaxStepReached] = useState(0);
  useEffect(() => {
    setMaxStepReached((m) => (step > m ? step : m));
  }, [step]);


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

  /**
   * Style de transition joue entre deux sequences consecutives.
   *
   * Defaut `DEFAULT_TRANSITION` — c'est-a-dire le fondu enchaine — et non
   * « aucune » : le compositeur applique DEJA ce fondu a tout montage qui ne
   * demande rien (`drawTransition` y retombe pour tout style inconnu).
   * Prendre « aucune » comme defaut changerait donc le rendu de l'existant,
   * soit l'inverse de ce qu'on cherche.
   */
  const [transition, setTransition] = useState<TransitionStyle>(DEFAULT_TRANSITION);

  /**
   * Animation d'apparition du texte, jouee sur le debut de chaque sequence.
   * Defaut « Aucune » : le rendu de tous les montages existants.
   */
  const [textAnimation, setTextAnimation] = useState<TextAnimation>(DEFAULT_TEXT_ANIMATION);

  /* ── VOIX PAR SEQUENCE ───────────────────────────────────────────────
     Chaque sequence porte son propre texte et sa propre voix, et sa DUREE
     se cale sur celle de son audio — c'est ce qui garantit qu'un texte
     rentre exactement dans sa sequence.

     Vide par defaut : sans voix par sequence, les durees restent celles
     que l'utilisateur a reglees et le montage garde la voix unique
     `voiceUrl`, exactement comme avant. */
  const [sequenceVoices, setSequenceVoices] = useState<SequenceVoices>(() => emptySequenceVoices());
  const [sequenceVoicesUserEdited, setSequenceVoicesUserEdited] =
    useState<SequenceVoicesUserEdited>(() => emptySequenceVoicesUserEdited());

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
  const cardsRef = useRef<HTMLDivElement>(null);

  // ── Deplacement du titre et du CTA ────────────────────────────────────
  // Defauts = les constantes `DESIGN` d'origine : tant que l'utilisateur ne
  // deplace rien, l'apercu ET l'export sont identiques a avant, au pixel.
  const [titlePos, setTitlePos] = useState<Pos>(DESIGN.titlePos);
  const [ctaPos, setCtaPos] = useState<Pos>(DESIGN.ctaPos);
  /** Element en cours de glissement, et ecart de saisie fige au pointerdown. */
  const dragRef = useRef<{
    el: 'title' | 'cta' | 'card' | 'element' | 'element-resize' | 'poster-pan' | 'poster-zoom';
    /** Carte glissee, quand `el === 'card'` — son repere est le conteneur. */
    cardId?: string;
    pointerId: number;
    /**
     * Point d'appui, et « le glissement a-t-il vraiment commence ? ».
     *
     * Une carte se SELECTIONNE au clic et se DEPLACE au glissement : basculer
     * en mode libre des l'appui ferait retrecir toutes les cartes a chaque
     * simple clic. Le mode libre n'est donc arme qu'au premier mouvement
     * franc.
     */
    startX?: number;
    startY?: number;
    armed?: boolean;
    /** Cartes qui suivent le glissement — le lot, ou la seule carte saisie. */
    ids?: string[];
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

  // ── Cartes en mode libre ──────────────────────────────────────────────
  // `null` = disposition en flux (colonne centree), celle d'origine. Le mode
  // libre ne s'active qu'au premier glissement, et il commence par MESURER la
  // disposition en flux : les cartes reprennent exactement la place qu'elles
  // occupaient, donc rien ne saute a l'ecran ni a l'export.
  // Le FORMAT de mesure fait partie de l'etat : `h` est un % de la hauteur du
  // conteneur, or celle-ci et la taille du contenu varient en sens INVERSE
  // d'un format a l'autre (le conteneur suit la hauteur video, les cartes la
  // largeur). Rejouer un emplacement 9:16 en 16:9 ecraserait les cartes les
  // unes sur les autres — a l'ecran comme dans la video, puisque ce bloc est
  // photographie puis blitte.
  const [cardBoxes, setCardBoxes] = useState<FreeCards | null>(null);
  const cardBoxesRef = useRef<FreeCards | null>(null);
  const [draggingCard, setDraggingCard] = useState<string | null>(null);
  useEffect(() => { cardBoxesRef.current = cardBoxes; }, [cardBoxes]);

  /**
   * Le mode libre n'est VALIDE que s'il couvre toutes les cartes affichees.
   *
   * Regenerer le contenu, ajouter ou retirer une carte change les
   * identifiants : une carte sans emplacement se rendrait sans position dans
   * un conteneur qui n'est plus une colonne, donc empilee dans le coin avec
   * les autres. Plutot que d'inventer une place, on revient a la disposition
   * en flux — previsible, et c'est celle qu'on sait exacte.
   */
  const cardIds = useMemo(() => generated?.cards.map((c) => c.id) ?? [], [generated]);
  const effectiveCardBoxes = validFree(cardBoxes, cardIds, format) ? cardBoxes!.boxes : null;
  // Lus par `startCardDrag`, memoise sans dependances.
  const cardIdsRef = useRef<string[]>(cardIds);
  const formatRef = useRef<Format>(format);
  useEffect(() => { cardIdsRef.current = cardIds; }, [cardIds]);
  useEffect(() => { formatRef.current = format; }, [format]);

  /**
   * Le mode libre a-t-il ete abandonne sous les pieds de l'utilisateur ?
   *
   * Regenerer le contenu ou changer de format invalide les emplacements. Les
   * laisser disparaitre en silence, apres qu'on a passe du temps a ranger ses
   * cartes, donne l'impression d'un bug — et l'etat perime resterait en
   * memoire, a fusionner indefiniment des identifiants disparus.
   */
  /**
   * Cartes selectionnees. Etat de SESSION : ni enregistre, ni exporte — c'est
   * une intention d'edition, pas une propriete du montage.
   */
  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set());
  /**
   * Groupes de cartes. Aide d'EDITION : deux cartes groupees s'exportent
   * exactement comme deux cartes non groupees — le montage et les metadonnees
   * n'en savent rien.
   */
  const [cardGroups, setCardGroups] = useState<CardGroup[]>([]);

  /**
   * Elements libres. Defaut `[]` : un montage sans element se compose
   * exactement comme avant, et tout brouillon anterieur se relit tel quel.
   */
  const [freeElements, setFreeElements] = useState<FreeElement[]>([]);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);

  // ── Photo d'affiche ─────────────────────────────────────────────────────
  // `posterUrl` est l'URL RETENUE, et c'est elle qu'on enregistre — pas un
  // index dans la grille. La grille est transitoire : elle disparait au
  // rechargement, le choix non.
  const [posterPhotos, setPosterPhotos] = useState<PosterPhoto[]>([]);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [imageSource, setImageSource] = useState<'pexels' | 'unsplash'>('pexels');
  const [photoQuery, setPhotoQuery] = useState('');
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photosError, setPhotosError] = useState<string | null>(null);
  const [posterUploading, setPosterUploading] = useState(false);
  /** Recadrage de l'affiche. Neutre = le « cover » centre d'avant. */
  const [posterTransform, setPosterTransform] = useState<PosterTransform>(POSTER_TRANSFORM_NEUTRAL);
  const posterTransformRef = useRef<PosterTransform>(POSTER_TRANSFORM_NEUTRAL);
  useEffect(() => { posterTransformRef.current = posterTransform; }, [posterTransform]);
  const [cropping, setCropping] = useState(false);
  /** Une vignette est en cours de glissement : la surface de depot s'affiche. */
  const [photoDragging, setPhotoDragging] = useState(false);
  /**
   * Fonds propres a une sequence. Vide par defaut : chaque sequence herite
   * alors de l'affiche globale, exactement comme avant.
   */
  const [seqBackgrounds, setSeqBackgrounds] = useState<SeqBackgrounds>({});
  const seqBackgroundsRef = useRef<SeqBackgrounds>({});
  useEffect(() => { seqBackgroundsRef.current = seqBackgrounds; }, [seqBackgrounds]);
  const posterPageRef = useRef(1);
  // Lu par `searchPhotos`, memoise sans dependances : la taille du lot decide
  // combien de photos ramener pour esperer en avoir assez de distinctes.
  const batchCountRef = useRef(1);

  // ── Lot ────────────────────────────────────────────────────────────────
  // `1` par defaut : un lot d'une video, c'est le parcours d'avant, a
  // l'identique — pas de variation IA, pas de date decalee, un seul post.
  const [batchCount, setBatchCount] = useState(1);
  /**
   * Une affiche par video du lot, a l'indice de la video.
   *
   * Dans les DEUX modes : « auto » remplit cette liste, « manuel » la fait
   * remplir par l'utilisateur, et chaque emplacement reste modifiable
   * individuellement.
   */
  const [batchPhotoUrls, setBatchPhotoUrls] = useState<string[]>([]);
  /**
   * Comment les affiches du lot sont attribuees. « auto » par defaut : c'est
   * l'interet du lot — obtenir N publications differentes sans rien cocher.
   */
  const [batchPhotoMode, setBatchPhotoMode] = useState<'auto' | 'manuel'>('auto');
  /** Emplacement en cours de remplacement, ou `null`. */
  const [slotCible, setSlotCible] = useState<number | null>(null);
  // Un recadrage vaut pour UNE photo : le garder en changeant d'affiche
  // rognerait la nouvelle sur des reperes qui n'ont plus de sens.
  const posterUrlPrecedent = useRef<string | null>(null);
  useEffect(() => {
    if (posterUrlPrecedent.current !== null && posterUrlPrecedent.current !== posterUrl) {
      setPosterTransform(POSTER_TRANSFORM_NEUTRAL);
      setCropping(false);
    }
    posterUrlPrecedent.current = posterUrl;
  }, [posterUrl]);
  /**
   * Instant de la derniere prise d'un element.
   *
   * `FloatingPanel` se ferme au clic exterieur — or saisir l'element pour le
   * deplacer EST un clic exterieur. Sans ce delai de grace, prendre un element
   * le deselectionnait aussitot.
   */
  const selectionTouchedAt = useRef(0);
  /** Coin ou s'ouvre le panneau — a cote de l'apercu, jamais dessus. */
  const [panelPos, setPanelPos] = useState({ x: 120, y: 140 });
  useEffect(() => {
    if (!selectedElementId) return;
    const cadre = frameRef.current?.getBoundingClientRect();
    if (!cadre) return;
    // A gauche du cadre s'il y a la place, sinon juste dessous : le panneau ne
    // doit pas masquer ce qu'on est en train de regler.
    const largeur = 260;
    const x = cadre.left - largeur - 16 > 8 ? cadre.left - largeur - 16 : Math.max(8, cadre.left);
    setPanelPos({ x, y: Math.max(72, cadre.top) });
  }, [selectedElementId]);

  /**
   * Fermeture du panneau. `FloatingPanel` la declenche au clic exterieur — or
   * saisir l'element pour le deplacer EST un clic exterieur.
   */
  const closeElementPanel = useCallback(() => {
    if (Date.now() - selectionTouchedAt.current < 300) return;
    setSelectedElementId(null);
  }, []);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [elementPickerOpen, setElementPickerOpen] = useState(false);
  const [elementQuery, setElementQuery] = useState('');
  const freeElementsRef = useRef<FreeElement[]>(freeElements);
  useEffect(() => { freeElementsRef.current = freeElements; }, [freeElements]);

  /** Sujet courant — la requete par defaut de la recherche de photos. */
  const currentTopic = customTopic.trim() || (THEMES.find((t) => t.id === themeId) ?? THEMES[0]).topic;

  /**
   * Cherche des photos d'affiche.
   *
   * `page` s'incremente a chaque « Autres photos » pour proposer autre chose ;
   * une page vide ramene a la premiere plutot que de laisser une grille vide.
   */
  const searchPhotos = useCallback(async (
    query: string,
    source: 'pexels' | 'unsplash',
    nextPage = false,
  ) => {
    const q = query.trim();
    if (!q) return;
    setPhotosLoading(true);
    setPhotosError(null);
    const page = nextPage ? posterPageRef.current + 1 : 1;
    posterPageRef.current = page;
    const appel = async (p: number) => {
      const res = await fetch(
        `/api/pexels?query=${encodeURIComponent(q)}&count=${Math.max(POSTER_COUNT, photosToFetch(batchCountRef.current))}&page=${p}&source=${source}`,
      );
      return res.json();
    };
    try {
      let data = await appel(page);
      if ((!data?.success || !data.photos?.length) && page > 1) {
        // Plus de resultats : on revient au debut au lieu d'afficher du vide.
        posterPageRef.current = 1;
        data = await appel(1);
      }
      if (data?.success && Array.isArray(data.photos) && data.photos.length > 0) {
        // Une entree sans URL exploitable arrivait telle quelle : vignette
        // cassee, et depot qui posait « undefined » comme affiche.
        setPosterPhotos(sanitizePhotos(data.photos));
      } else {
        setPosterPhotos([]);
        // L'API dit si la source n'a pas de cle configuree. Sans cette
        // distinction, une source absente du serveur passait pour une
        // recherche infructueuse — et l'utilisateur reformulait sans fin.
        setPhotosError(
          data?.configured === false
            ? `${source === 'unsplash' ? 'Unsplash' : 'Pexels'} n’est pas configuré sur ce serveur.`
            : 'Aucune photo pour cette recherche.',
        );
      }
    } catch {
      setPosterPhotos([]);
      setPhotosError('Recherche de photos indisponible.');
    } finally {
      setPhotosLoading(false);
    }
  }, []);

  /** Bascule de source : on relance aussitot, sinon la grille ment. */
  const changeImageSource = useCallback((source: 'pexels' | 'unsplash') => {
    setImageSource(source);
    searchPhotos(photoQuery.trim() || currentTopic, source);
  }, [photoQuery, currentTopic, searchPhotos]);

  useEffect(() => { batchCountRef.current = batchCount; }, [batchCount]);

  /**
   * Attribution automatique des affiches du lot.
   *
   * Relancee quand les resultats de recherche ou la taille du lot changent :
   * une modification manuelle d'un emplacement tient donc jusqu'a la
   * prochaine recherche, ce qui est la lecture la plus previsible.
   */
  useEffect(() => {
    if (batchPhotoMode !== 'auto' || batchCount < 2) return;
    setBatchPhotoUrls(autoAssignPhotos(posterPhotos.map((p) => p.url), batchCount));
  }, [batchPhotoMode, batchCount, posterPhotos]);

  /** Affiches distinctes disponibles — ce qui borne l'attribution auto. */
  const affichesDisponibles = distinctUrls(posterPhotos.map((p) => p.url)).length;

  /** Le lot peut-il partir ? Une affiche par video, toutes differentes. */
  const affichesCompletes = batchPhotosReady(batchPhotoUrls, batchCount);

  /** Pose une affiche sur un emplacement precis, sans creer de doublon. */
  const assignerAffiche = useCallback((slot: number, url: string) => {
    setBatchPhotoUrls((prev) => {
      const next = [...prev];
      // Deja posee ailleurs : on echange les deux emplacements plutot que de
      // laisser deux videos avec la meme affiche.
      const ailleurs = next.findIndex((u, i) => u === url && i !== slot);
      if (ailleurs >= 0) next[ailleurs] = next[slot] ?? '';
      next[slot] = url;
      return next;
    });
    setSlotCible(null);
  }, []);

  /** Sequence visee par les actions « photo », ou `null` sur l'onglet « Tout ». */
  const seqCible = seqBgKeyForFocus(previewFocus);
  /** Fond REELLEMENT montre par l'onglet courant. */
  const fondAffiche = resolveBackground(previewFocus, seqBackgrounds, posterUrl, posterTransform);

  /** Pose une photo : sur la sequence affichee, ou sur l'affiche globale. */
  /* ── APERÇU DU VRAI RENDU ────────────────────────────────────────────
     Le bouton Play compose la vidéo pour de bon — animations, transitions,
     voix comprises — puis la joue. Le montage est GARDÉ : l'export le
     réutilise tant que rien n'a bougé, pour ne débiter qu'une fois.

     La signature est dérivée des options envoyées au compositeur, pas d'une
     liste écrite à la main : une liste serait fausse au premier réglage
     ajouté sans y penser, et son échec est silencieux — l'export livrerait
     un montage périmé. */
  const previewThumbRef = useRef<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  /** Signature du montage en cache — lue dans le rendu, sans le refaire dépendre. */
  const previewSignatureRef = useRef<string | null>(null);
  const previewBlobRef = useRef<Blob | null>(null);

  /** Remplace le montage en cache, et libère l'URL du précédent. */
  const setPreviewRender = useCallback((blob: Blob | null, signature: string | null, thumbnail: Blob | null = null) => {
    previewThumbRef.current = thumbnail;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = blob ? URL.createObjectURL(blob) : null;
    previewBlobRef.current = blob;
    previewSignatureRef.current = signature;
    setPreviewUrl(previewUrlRef.current);
  }, []);

  // Un démontage laisserait l'URL du blob — donc la vidéo entière — en mémoire.
  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  /** Dernier retour des outils IA — efface au traitement suivant. */
  /**
   * Vignettes dont le chargement a echoue.
   *
   * Une URL peut etre bien formee et le fichier avoir disparu : le filtre a
   * la reception ne suffit pas, il faut aussi ecouter l'echec reel.
   */
  const [brokenPhotos, setBrokenPhotos] = useState<Set<string>>(() => new Set());
  const marquerCassee = useCallback((url: string) => {
    setBrokenPhotos((prev) => (prev.has(url) ? prev : new Set(prev).add(url)));
  }, []);

  const [aiNotice, setAiNotice] = useState<string | null>(null);

  const applyPhoto = useCallback((url: string) => {
    const cle = seqBgKeyForFocus(previewFocusRef.current);
    if (!cle) {
      setPosterUrl(url);
      return;
    }
    // Nouveau fond = nouveau cadrage : le precedent visait une autre image.
    setSeqBackgrounds((prev) => ({ ...prev, [cle]: { url, transform: POSTER_TRANSFORM_NEUTRAL } }));
  }, []);

  /** Rend une sequence a l'affiche globale. */
  const resetSeqBackground = useCallback((cle: SeqBgKey) => {
    setSeqBackgrounds((prev) => {
      const next = { ...prev };
      delete next[cle];
      return next;
    });
  }, []);

  const addElement = useCallback((iconName: string) => {
    const id = newElementId();
    setFreeElements((prev) => [
      ...prev,
      {
        id,
        iconName,
        // Pose au centre du plateau : visible quel que soit l'onglet, et sur
        // les quatre sequences de la video.
        x: 50,
        y: 50,
        sizePct: ELEMENT_SIZE_PCT,
        // Blanc, et non l'accent : le fond du plateau EST le degrade de
        // l'accent, un element accent y etait quasi invisible. Le blanc se lit
        // sur ce degrade comme sur un rush. La couleur reste modifiable, et
        // les elements deja poses gardent la leur.
        color: '#FFFFFF',
      },
    ]);
    setSelectedElementId(id);
  }, [accent]);

  /**
   * Prepare les elements pour le compositeur.
   *
   * Le canvas ne sait pas dessiner un composant React : on serialise le SVG
   * lucide DEJA affiche dans l'apercu, ce qui garantit que la video montre
   * exactement le meme glyphe. Une table nom -> chemin cote compositeur ferait
   * une TROISIEME copie des icones (`ICON_MAP` et `CARD_ICON_MAP` existent
   * deja), a tenir a jour a la main.
   *
   * Rasterise a la resolution de DESTINATION, pas a celle de l'apercu : le
   * plateau est reduit a l'ecran, capturer sa taille affichee donnerait une
   * icone floue dans la video.
   */
  const rasterizeElements = useCallback(async () => {
    const list = freeElementsRef.current;
    if (list.length === 0) return undefined;
    const vw = VIDEO_SIZE[format].w;
    const prepared = await Promise.all(
      list.map(async (el) => {
        try {
          const host = document.querySelector(`[data-free-element="${el.id}"] svg`);
          if (!host) return null;
          const svg = host.cloneNode(true) as SVGElement;
          const px = Math.max(1, Math.round((el.sizePct / 100) * vw));
          // Taille intrinseque : sans elle l'image se decode en 0x0 dans
          // Chrome et `drawImage` ne peint rien.
          svg.setAttribute('width', String(px));
          svg.setAttribute('height', String(px));
          svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
          // `currentColor` n'a plus de contexte une fois le SVG detache.
          svg.setAttribute('color', el.color);
          svg.setAttribute('stroke', el.color);
          const source = new XMLSerializer().serializeToString(svg);
          const img = new Image();
          img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
          await new Promise<void>((resolve) => {
            // Delai de garde : une image qui ne se decode pas laisserait la
            // promesse pendante et l'envoi bloque.
            const timer = setTimeout(resolve, 4000);
            img.onload = () => { clearTimeout(timer); resolve(); };
            img.onerror = () => { clearTimeout(timer); resolve(); };
          });
          if (!img.complete || img.naturalWidth === 0) return null;
          return { x: el.x, y: el.y, sizePct: el.sizePct, img };
        } catch {
          return null;
        }
      }),
    );
    const kept = prepared.filter(Boolean) as { x: number; y: number; sizePct: number; img: HTMLImageElement }[];
    return kept.length > 0 ? kept : undefined;
  }, [format]);

  /**
   * Telecharge l'apercu courant en image, sur le poste de l'utilisateur.
   *
   * Aucun credit debite, aucun post cree : c'est un `<a download>` sur un blob
   * local. Ce qui est capture est l'ONGLET AFFICHE — « Tout » donne l'affiche
   * complete, « Cartes » la seule planche de cartes. WYSIWYG, et l'utilisateur
   * choisit en changeant d'onglet.
   */
  const [posterExporting, setPosterExporting] = useState(false);
  const downloadPoster = useCallback(async (fmt: 'png' | 'jpeg') => {
    const stage = previewRef.current;
    if (!stage || !generated || posterExporting) return;
    setPosterExporting(true);
    try {
      // Les aides d'edition — lisere de selection, croix de suppression,
      // pointille de glissement — ne doivent pas etre gravees dans l'affiche.
      // Meme drapeau que la photo des cartes, et il tient pour TOUTE la duree
      // de la capture : celle-ci est asynchrone, un clic entre-temps les
      // reposerait juste a temps pour qu'elles y figurent.
      flushSync(() => setCapturing(true));
      const { domToCanvas } = await import('modern-screenshot');
      // Polices chargees : sinon la capture serialise une police de repli et
      // l'affiche ne ressemble pas a l'apercu.
      try { await (document as unknown as { fonts?: FontFaceSet }).fonts?.ready; } catch { /* ignore */ }
      // Une frame de peinture, bornee : `requestAnimationFrame` est GELE dans
      // un onglet en arriere-plan.
      await new Promise<void>((r) => {
        const done = () => { clearTimeout(timer); r(); };
        const timer = setTimeout(r, 300);
        requestAnimationFrame(() => requestAnimationFrame(done));
      });

      // `width`/`height` sont OBLIGATOIRES : le plateau porte un
      // `transform: scale(displayScale)`, et `resolveBoundingBox` de
      // modern-screenshot lit `getBoundingClientRect()` — c'est-a-dire la
      // boite APRES reduction. Sans eux la capture ferait ~270 px de large au
      // lieu de la resolution native.
      const canvas = await domToCanvas(stage, {
        backgroundColor: undefined,
        scale: 1,
        width: stage.offsetWidth,
        height: stage.offsetHeight,
        // `transform: none` sur le clone : le plateau porte lui-meme un
        // `scale(displayScale)` pour tenir dans le panneau, et
        // modern-screenshot l'applique au clone. Les dimensions ci-dessus
        // donnaient alors une toile de 1080x1920 dans laquelle l'affiche
        // n'occupait qu'une bande centrale au quart de sa taille, le reste
        // transparent.
        style: { transform: 'none', transformOrigin: 'top left' },
      });
      const mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, mime, fmt === 'jpeg' ? 0.92 : undefined),
      );
      if (!blob) throw new Error('canvas.toBlob a renvoyé null');
      const base = (generated.title || 'studiio').replace(/[^a-zA-Z0-9-_]+/g, '_');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${base}-affiche.${fmt === 'png' ? 'png' : 'jpg'}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revocation differee : Safari lit le blob APRES le clic.
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setError(null);
    } catch (err) {
      setError(
        `Téléchargement de l’affiche impossible : ${err instanceof Error ? err.message : 'erreur inconnue'}`,
      );
    } finally {
      setCapturing(false);
      setPosterExporting(false);
    }
  }, [generated, posterExporting]);

  /** Element retenu, s'il y en a un — la cible de la recoloration. */
  const selectedElement = freeElements.find((el) => el.id === selectedElementId) ?? null;

  const recolorElement = useCallback((color: string) => {
    setFreeElements((prev) =>
      prev.map((el) => (el.id === selectedElementId ? { ...el, color } : el)),
    );
  }, [selectedElementId]);

  const resizeElement = useCallback((sizePct: number) => {
    if (!selectedElementId) return;
    const taille = clampElementSize(sizePct);
    setFreeElements((prev) =>
      prev.map((el) => (el.id === selectedElementId ? { ...el, sizePct: taille } : el)),
    );
  }, [selectedElementId]);

  const deleteElement = useCallback((id: string) => {
    setFreeElements((prev) => prev.filter((el) => el.id !== id));
    setSelectedElementId((cur) => (cur === id ? null : cur));
  }, []);
  const groupsRef = useRef<CardGroup[]>(cardGroups);
  useEffect(() => { groupsRef.current = cardGroups; }, [cardGroups]);
  // Lue par `moveDrag`, memoise sans dependances.
  const selectionRef = useRef<Set<string>>(selectedCards);
  useEffect(() => { selectionRef.current = selectedCards; }, [selectedCards]);
  const clearSelection = useCallback(
    () => setSelectedCards((prev) => (prev.size ? new Set() : prev)),
    [],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Echap dans un champ de saisie appartient au champ : il ferme une liste
      // deroulante, annule une saisie. Le detourner viderait la selection au
      // milieu d'une frappe.
      const cible = e.target as HTMLElement | null;
      if (cible?.isContentEditable) return;
      if (cible && /^(INPUT|TEXTAREA|SELECT)$/.test(cible.tagName)) return;
      clearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearSelection]);

  /**
   * Capture en cours : l'apercu est photographie. Aucune aide d'edition ne
   * doit y paraitre, et rien ne doit pouvoir en modifier l'etat.
   */
  const [capturing, setCapturing] = useState(false);

  const [layoutDropped, setLayoutDropped] = useState(false);
  useEffect(() => {
    if (cardBoxes && !validFree(cardBoxes, cardIds, format)) {
      cardBoxesRef.current = null;
      setCardBoxes(null);
      setLayoutDropped(true);
    }
    // Une selection qui survit a la disparition de sa carte agirait sur du
    // vide : dupliquer ou regrouper porterait sur un identifiant fantome.
    setSelectedCards((prev) => pruneSelection(prev, cardIds));
    // Un groupe qui designe des cartes disparues n'a plus d'objet.
    setCardGroups((prev) => pruneGroups(prev, cardIds));
  }, [cardBoxes, cardGroups, cardIds, format]);

  /**
   * Photographie la disposition en flux, en % du conteneur des cartes.
   *
   * La largeur NATURELLE est mesuree en plus : en flux, `align-items: stretch`
   * etire chaque carte a toute la largeur du conteneur, ce qui ne laisserait
   * aucune place au deplacement lateral. Les lectures et les ecritures sont
   * groupees en deux passes — alterner les deux forcerait un recalcul de mise
   * en page par carte.
   */
  const measureCards = useCallback((): Record<string, CardBox> | null => {
    const host = cardsRef.current;
    if (!host) return null;
    const hostRect = host.getBoundingClientRect();
    const els = Array.from(host.querySelectorAll<HTMLElement>('[data-card-id]'));
    const rects = els.map((el) => el.getBoundingClientRect());
    const saved = els.map((el) => el.style.width);
    els.forEach((el) => { el.style.width = 'max-content'; });
    const naturals = els.map((el) => el.getBoundingClientRect().width);
    els.forEach((el, i) => { el.style.width = saved[i]; });
    return boxesFromRects(
      hostRect,
      els.map((el, i) => ({ id: el.dataset.cardId ?? '', rect: rects[i], naturalWidth: naturals[i] })),
    );
  }, []);

  const startElementDrag = useCallback((id: string, e: React.PointerEvent) => {
    // En tete, comme pour les cartes : l'appui appartient a l'element, meme si
    // la prise echoue ensuite.
    e.stopPropagation();
    if (e.button !== 0 || !e.isPrimary) return;
    selectionTouchedAt.current = Date.now();
    setSelectedElementId(id);
    setSelectedCards((prev) => (prev.size ? new Set() : prev));
    // Le plateau, et non le conteneur des cartes : un element se pose partout.
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    if (dragRef.current) return;
    const el = freeElementsRef.current.find((x) => x.id === id);
    if (!el) return;
    const box = e.currentTarget.getBoundingClientRect();
    dragRef.current = {
      el: 'element',
      cardId: id,
      pointerId: e.pointerId,
      grab: grabOffset(e.clientX, e.clientY, rect, { x: el.x, y: el.y }),
      box: { width: (box.width / rect.width) * 100, height: (box.height / rect.height) * 100 },
    };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      dragRef.current = null;
    }
  }, []);

  /**
   * Prise d'une poignee de coin.
   *
   * L'element est carre et ancre par son CENTRE : sa taille suit donc la
   * distance du pointeur au centre, doublee. Pas besoin de savoir quel coin a
   * ete saisi — les quatre donnent le meme geste.
   */
  /** Recadrage courant : celui de la sequence affichee, sinon le global. */
  const currentTransform = useCallback((): PosterTransform => {
    const cle = seqBgKeyForFocus(previewFocusRef.current);
    const propre = cle ? seqBackgroundsRef.current[cle] : undefined;
    return propre?.transform ?? posterTransformRef.current;
  }, []);

  /** Ecrit un recadrage la ou il doit aller. */
  const applyTransform = useCallback((maj: (t: PosterTransform) => PosterTransform) => {
    const cle = seqBgKeyForFocus(previewFocusRef.current);
    if (!cle || !seqBackgroundsRef.current[cle]) {
      setPosterTransform((prev) => maj(prev));
      return;
    }
    setSeqBackgrounds((prev) => {
      const propre = prev[cle];
      if (!propre) return prev;
      return { ...prev, [cle]: { ...propre, transform: maj(propre.transform) } };
    });
  }, []);

  /** Glisser la photo : repositionne la zone visible. */
  const startPosterPan = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 || !e.isPrimary) return;
    e.stopPropagation();
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    if (dragRef.current) return;
    const t = currentTransform();
    dragRef.current = {
      el: 'poster-pan',
      pointerId: e.pointerId,
      // On memorise le point de depart ET le decalage d'alors : le
      // deplacement est RELATIF, sinon la photo sauterait au premier pixel.
      startX: e.clientX,
      startY: e.clientY,
      grab: { x: t.offsetX, y: t.offsetY },
      box: { width: 0, height: 0 },
    };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      dragRef.current = null;
    }
  }, []);

  /** Tirer un coin : zoome. */
  const startPosterZoom = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 || !e.isPrimary) return;
    e.stopPropagation();
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    if (dragRef.current) return;
    const t = currentTransform();
    // Distance au centre au moment de la prise : le zoom suivra son evolution,
    // ce qui evite un saut des le premier pixel.
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    dragRef.current = {
      el: 'poster-zoom',
      pointerId: e.pointerId,
      startX: Math.max(1, Math.hypot(dx, dy)),
      startY: 0,
      grab: { x: t.scale, y: 0 },
      box: { width: 0, height: 0 },
    };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      dragRef.current = null;
    }
  }, []);

  const startElementResize = useCallback((id: string, e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0 || !e.isPrimary) return;
    selectionTouchedAt.current = Date.now();
    setSelectedElementId(id);
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    if (dragRef.current) return;
    dragRef.current = {
      el: 'element-resize',
      cardId: id,
      pointerId: e.pointerId,
      grab: { x: 0, y: 0 },
      box: { width: 0, height: 0 },
    };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      dragRef.current = null;
    }
  }, []);

  const startCardDrag = useCallback((id: string, e: React.PointerEvent) => {
    // EN TETE, avant tout `return` : un appui sur une carte n'est jamais « un
    // appui dans le vide », meme quand la prise echoue. Sinon le second doigt
    // d'un multi-touch, ou une capture refusee, videraient la selection —
    // y compris la carte en cours de glissement.
    e.stopPropagation();
    // Clic droit et pointeurs secondaires n'ouvrent pas de glissement.
    if (e.button !== 0 || !e.isPrimary) return;

    setSelectedCards((prev) =>
      // Un groupe se prend en bloc : designer un membre suffit.
      expandSelection(
        nextSelection(prev, id, e.shiftKey || e.metaKey || e.ctrlKey),
        groupsRef.current,
      ),
    );
    setDuplicateNotice(null);

    const rect = cardsRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    if (dragRef.current) return;
    dragRef.current = {
      el: 'card',
      cardId: id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      armed: false,
      grab: { x: 0, y: 0 },
      box: { width: 0, height: 0 },
    };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      dragRef.current = null;
      setDraggingCard(null);
    }
  }, []);

  const startDrag = useCallback((el: 'title' | 'cta', e: React.PointerEvent) => {
    // Meme raison que pour les cartes : l'appui appartient a l'element, quelle
    // que soit l'issue de la prise.
    e.stopPropagation();
    if (e.button !== 0 || !e.isPrimary) return;
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
    }
  }, [titlePos, ctaPos]);

  /* ── GUIDES D'ALIGNEMENT ─────────────────────────────────────────────
     Lignes de centrage et badges d'ecart, affiches PENDANT un glissement.
     Vides au repos : ils n'existent que le temps du geste, et le drapeau
     `capturing` les efface en plus pendant la photo — deux verrous plutot
     qu'un, parce qu'un guide grave dans la video ne se rattrape pas. */
  const [dragGuides, setDragGuides] = useState<ActiveGuide[]>([]);
  const [dragBadges, setDragBadges] = useState<DistanceBadge[]>([]);

  /**
   * Reperes d'alignement : le centre des AUTRES elements de l'apercu.
   *
   * `exclure` retire l'element en cours de deplacement — il s'aimanterait
   * sinon a sa propre position, et ne bougerait plus.
   */
  const alignmentTargets = useCallback((exclure: string): ElementPos[] => {
    const out: ElementPos[] = [];
    if (exclure !== 'title') {
      out.push({ key: 'title', x: titlePosRef.current.x, y: titlePosRef.current.y, label: 'Titre' });
    }
    if (exclure !== 'cta') {
      out.push({ key: 'cta', x: ctaPosRef.current.x, y: ctaPosRef.current.y, label: 'CTA' });
    }
    for (const el of freeElementsRef.current) {
      if (el.id === exclure) continue;
      out.push({ key: 'element', x: el.x, y: el.y, label: 'Élément' });
    }
    return out;
  }, []);

  /**
   * Aimante une position d'ancre et met a jour les guides.
   *
   * Le calcul passe par le CENTRE : aimanter l'ancre reviendrait a centrer le
   * bord gauche du titre sur l'axe, visiblement decale de la moitie de sa
   * largeur.
   */
  const snapAndGuide = useCallback((
    pos: Pos,
    anchor: Anchor,
    box: { width: number; height: number },
    exclure: string,
    rect: { width: number; height: number },
  ): Pos => {
    const autres = alignmentTargets(exclure);
    const centre = anchorToCenter(pos, anchor, box);
    const snap = snapPosition(centre.x, centre.y, autres);
    setDragGuides(snap.guides);
    setDragBadges(
      computeDistanceBadges(
        { key: 'element', x: snap.x, y: snap.y, label: 'En cours' },
        autres,
        rect.width,
        rect.height,
      ),
    );
    return centerToAnchor({ x: snap.x, y: snap.y }, anchor, box);
  }, [alignmentTargets]);

  const moveDrag = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    // Une carte se borne a SON conteneur, pas au plateau entier — c'est la
    // zone photographiee et blittee par le compositeur.
    const rect = (drag?.el === 'card' ? cardsRef : previewRef).current?.getBoundingClientRect();
    if (!drag || !rect) return;
    // Seul le pointeur qui a commence le glissement le poursuit.
    if (drag.pointerId !== e.pointerId) return;
    // `pointermove` se declenche aussi au simple survol : sans bouton appuye,
    // il n'y a pas de glissement (garde-fou anti « element collant »).
    if (e.buttons === 0 && e.pointerType === 'mouse') return;
    if (drag.el === 'poster-pan') {
      // Deplacement RELATIF au point de prise, en fraction du plateau.
      const dx = (e.clientX - (drag.startX ?? e.clientX)) / rect.width;
      const dy = (e.clientY - (drag.startY ?? e.clientY)) / rect.height;
      applyTransform((prev) =>
        clampPosterTransform({ ...prev, offsetX: drag.grab.x + dx, offsetY: drag.grab.y + dy }),
      );
      return;
    }
    if (drag.el === 'poster-zoom') {
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      const distance = Math.max(1, Math.hypot(dx, dy));
      // Le zoom suit le RAPPORT des distances : eloigner le coin agrandit,
      // le rapprocher retrecit, sans saut a la prise.
      const facteur = distance / (drag.startX || 1);
      applyTransform((prev) => clampPosterTransform({ ...prev, scale: drag.grab.x * facteur }));
      return;
    }
    if (drag.el === 'element-resize') {
      const id = drag.cardId as string;
      const current = freeElementsRef.current.find((x) => x.id === id);
      if (!current) return;
      // Ecart au centre, en % de la LARGEUR du plateau — la meme unite que
      // `sizePct`. Le plus grand des deux axes commande : c'est ce qui donne
      // au geste la reponse attendue quel que soit le coin tire.
      const cx = rect.left + (current.x / 100) * rect.width;
      const cy = rect.top + (current.y / 100) * rect.height;
      const dx = Math.abs(e.clientX - cx);
      const dy = Math.abs(e.clientY - cy);
      const demi = Math.max(dx, dy);
      const taille = clampElementSize((demi * 2 / rect.width) * 100);
      if (taille === current.sizePct) return;
      setFreeElements((prev) => prev.map((x) => (x.id === id ? { ...x, sizePct: taille } : x)));
      return;
    }
    if (drag.el === 'element') {
      const id = drag.cardId as string;
      const current = freeElementsRef.current.find((x) => x.id === id);
      if (!current) return;
      const raw = pointToPct(e.clientX, e.clientY, rect, drag.grab, { x: current.x, y: current.y });
      // Aimantation AVANT bornage : l'inverse laisserait le bornage defaire
      // l'aimantation sur un element pose au ras du cadre.
      const aimante = snapAndGuide(raw, 'center', drag.box, id, rect);
      // Ancre au CENTRE, comme le `translate(-50%, -50%)` du rendu : sans quoi
      // l'element sortirait de moitie de la zone photographiee.
      const next = clampToBox(aimante, 'center', drag.box);
      if (next.x === current.x && next.y === current.y) return;
      setFreeElements((prev) => prev.map((x) => (x.id === id ? { ...x, x: next.x, y: next.y } : x)));
      return;
    }
    if (drag.el === 'card') {
      const id = drag.cardId as string;
      if (!drag.armed) {
        // Seuil : en dessous, c'est un clic (ou un tremblement de main), pas un
        // glissement — et le mode libre ne doit pas s'activer pour un clic.
        const dx = e.clientX - (drag.startX ?? e.clientX);
        const dy = e.clientY - (drag.startY ?? e.clientY);
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        const known = cardBoxesRef.current;
        const reusable = validFree(known, cardIdsRef.current, formatRef.current);
        const measured = reusable ? known!.boxes : measureCards();
        const start = measured?.[id];
        if (!measured || !start) {
          // La capture reste sinon accrochee a une carte qui ne bougera pas,
          // et le pointeur ne rend la main qu'au `pointerup`.
          try { (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId); } catch { /* deja relachee */ }
          dragRef.current = null;
          return;
        }
        if (!reusable) {
          const free = { format: formatRef.current, boxes: measured };
          cardBoxesRef.current = free;
          setCardBoxes(free);
        }
        // L'ecart de saisie se calcule depuis le point d'APPUI, pas depuis la
        // position courante : sinon la carte saute du seuil franchi.
        drag.grab = grabOffset(drag.startX!, drag.startY!, rect, { x: start.x, y: start.y });
        // Le lot qui suivra : toute la selection si la carte en fait partie.
        drag.ids = movingIds(selectionRef.current, id);
        drag.armed = true;
        setDraggingCard(id);
        setLayoutDropped(false);
      }
      const free = cardBoxesRef.current;
      const boxes = free?.boxes;
      const box = boxes?.[id];
      // Le glissement a commence : `boxes` couvre forcement `id`. Le garde
      // ci-dessous couvre le cas ou le contenu change EN COURS de glissement.
      if (!boxes || !box) return;
      const ids = (drag.ids ?? [id]).filter((k) => !!boxes[k]);
      const raw = pointToPct(e.clientX, e.clientY, rect, drag.grab, { x: box.x, y: box.y });
      // Un seul ecart pour tout le lot, borne sur son rectangle englobant :
      // borner chaque carte separement arreterait celles qui touchent le bord
      // pendant que les autres continuent, et deformerait l'agencement.
      const bounds = groupBounds(boxes, ids);
      if (!bounds) return;
      const delta = clampGroupDelta(bounds, { x: raw.x - box.x, y: raw.y - box.y });
      if (delta.x === 0 && delta.y === 0) return;
      const merged = { ...free!, boxes: shiftBoxes(boxes, ids, delta) };
      cardBoxesRef.current = merged;
      setCardBoxes(merged);
      return;
    }
    const current = drag.el === 'title' ? titlePosRef.current : ctaPosRef.current;
    const raw = pointToPct(e.clientX, e.clientY, rect, drag.grab, current);
    const ancre: Anchor = drag.el === 'title' ? 'top-left' : 'bottom-center';
    const aimante = snapAndGuide(raw, ancre, drag.box, drag.el, rect);
    const next = clampToBox(aimante, ancre, drag.box);
    if (drag.el === 'title') setTitlePos(next);
    else setCtaPos(next);
  }, [snapAndGuide]);

  /**
   * Le placement a-t-il ete touche ? Sans cette question, une carte deplacee
   * par erreur ne se rattrapait qu'en repartant de zero : le mode libre ne se
   * quitte pas tout seul.
   */
  const layoutTouched =
    !!effectiveCardBoxes ||
    cardGroups.length > 0 ||
    titlePos.x !== DESIGN.titlePos.x || titlePos.y !== DESIGN.titlePos.y ||
    ctaPos.x !== DESIGN.ctaPos.x || ctaPos.y !== DESIGN.ctaPos.y;

  /**
   * Duplique les cartes retenues.
   *
   * Les copies deviennent la nouvelle selection : on vient de les creer, c'est
   * sur elles qu'on va agir. Et en mode libre elles sont posees en decale de
   * leur original — superposees, on croirait qu'il ne s'est rien passe.
   */
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null);
  const limiteCartes = maxCards(format);
  const duplicateSelection = useCallback(() => {
    if (!generated || selectedCards.size === 0) return;
    const res = duplicateCards(generated.cards, selectedCards, newCardId, maxCards(format));
    if (res.created.length === 0) {
      setDuplicateNotice(`Maximum de ${maxCards(format)} cartes atteint dans ce format.`);
      return;
    }
    setGenerated({ ...generated, cards: res.cards });
    // Les emplacements suivent AVANT la selection : l'effet de purge tolere
    // ainsi les nouveaux identifiants des le rendu suivant.
    setCardBoxes((prev) => {
      if (!prev) return prev;
      const next = { format: prev.format, boxes: duplicateBoxes(prev.boxes, res.created) };
      cardBoxesRef.current = next;
      return next;
    });
    setSelectedCards(new Set(res.created.map((c) => c.id)));
    setDuplicateNotice(
      res.dropped > 0
        ? `${res.created.length} copie${res.created.length > 1 ? 's' : ''} — ${res.dropped} refusée${res.dropped > 1 ? 's' : ''}, maximum de ${maxCards(format)} cartes atteint.`
        : null,
    );
  }, [generated, selectedCards, format]);

  const groupSelection = useCallback(() => {
    if (selectedCards.size < MIN_GROUP) return;
    setCardGroups((prev) => groupCards(prev, [...selectedCards], newGroupId));
  }, [selectedCards]);

  const ungroupSelection = useCallback(() => {
    setCardGroups((prev) => ungroupCards(prev, selectedCards));
  }, [selectedCards]);

  /** La selection touche-t-elle un groupe existant ? */
  const selectionGrouped = [...selectedCards].some((id) => !!groupOf(cardGroups, id));
  /** Carte -> groupe, pour que l'apercu sache quoi marquer. */
  const groupedByCard = useMemo(() => {
    const out: Record<string, string> = {};
    for (const g of cardGroups) for (const id of g.cardIds) out[id] = g.id;
    return out;
  }, [cardGroups]);

  const resetLayout = useCallback(() => {
    setLayoutDropped(false);
    setTitlePos(DESIGN.titlePos);
    setCtaPos(DESIGN.ctaPos);
    setCardBoxes(null);
    cardBoxesRef.current = null;
    setCardGroups([]);
    setSelectedCards(new Set());
  }, []);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setDragging(null);
    setDraggingCard(null);
    // Les guides n'existent que le temps du geste.
    setDragGuides([]);
    setDragBadges([]);
  }, []);
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

  /* ── APERCU AGRANDI ──────────────────────────────────────────────────
     Une fenetre flottante qui montre le MEME apercu, en plus grand, qu'on
     deplace et redimensionne a volonte. Fermee par defaut : tant qu'on ne
     l'ouvre pas, rien ne change.

     Elle est un MIROIR, pas un second editeur. Les refs (`previewRef`,
     `cardsRef`, `frameRef`) sont la plomberie de l'edition ET de l'export :
     les partager ferait gagner le dernier monte, si bien que la photo des
     cartes — celle que le compositeur blitte dans la video — capturerait la
     fenetre au lieu du plateau. Elle recoit donc les memes ETATS (d'ou la
     synchronisation) mais ses propres refs, et aucune poignee d'edition.
     Ses onglets, eux, pilotent l'etat partage : ils marchent des deux cotes. */
  const [enlargedOpen, setEnlargedOpen] = useState(false);
  const enlargedFrameRef = useRef<HTMLDivElement>(null);
  const enlargedBodyRef = useRef<HTMLDivElement>(null);
  const [enlargedScale, setEnlargedScale] = useState(0);
  const [enlargedWidth, setEnlargedWidth] = useState(0);

  /** Geometrie de la fenetre, relue d'une session a l'autre. */
  const [enlargedGeometry, setEnlargedGeometry] = useState(() => {
    const repli = { x: 120, y: 90, w: 420, h: 640 };
    if (typeof window === 'undefined') return repli;
    try {
      const brut = window.localStorage.getItem(ENLARGED_GEOMETRY_KEY);
      return brut ? { ...repli, ...(JSON.parse(brut) as typeof repli) } : repli;
    } catch {
      return repli;
    }
  });

  const rememberEnlargedGeometry = useCallback((g: { x: number; y: number; w: number; h: number }) => {
    setEnlargedGeometry(g);
    try {
      window.localStorage.setItem(ENLARGED_GEOMETRY_KEY, JSON.stringify(g));
    } catch {
      // Quota plein ou stockage refuse : la fenetre marche, elle ne se
      // souvient simplement pas de sa taille.
    }
  }, []);

  /**
   * Taille du plateau dans la fenetre.
   *
   * Le plateau doit tenir dans les DEUX dimensions : borner sur la seule
   * largeur ferait deborder la hauteur en 9:16, et l'utilisateur elargirait
   * la fenetre pour voir de moins en moins. Le « chrome » (onglets et marges
   * de la carte) est MESURE — carte moins plateau — plutot que code en dur,
   * qu'un changement de marge rendrait faux en silence.
   */
  useEffect(() => {
    if (!enlargedOpen) return;
    const body = enlargedBodyRef.current;
    if (!body) return;
    const apply = () => {
      const frame = enlargedFrameRef.current;
      const carte = frame?.closest('.card-base') as HTMLElement | null;
      const chrome = carte && frame ? Math.max(0, carte.offsetHeight - frame.offsetHeight) : 0;
      const ratio = VIDEO_SIZE[format].w / VIDEO_SIZE[format].h;
      const large = Math.max(
        120,
        Math.min(body.clientWidth, Math.max(0, body.clientHeight - chrome) * ratio),
      );
      // Seuil de 1 px : sans lui, la mesure du chrome et la largeur qu'elle
      // determine se relanceraient l'une l'autre sans jamais se poser.
      setEnlargedWidth((prev) => (Math.abs(prev - large) > 1 ? large : prev));
      const w = frame?.clientWidth ?? 0;
      if (w > 0) setEnlargedScale(w / VIDEO_SIZE[format].w);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(body);
    if (enlargedFrameRef.current) ro.observe(enlargedFrameRef.current);
    return () => ro.disconnect();
  }, [enlargedOpen, format]);

  /**
   * Ramene le titre et le CTA dans le cadre, sur leur encombrement REEL.
   *
   * Le glissement borne au `pointerdown`, avec la boite mesuree a cet instant.
   * Rien ne re-bornait ensuite : agrandir le titre apres l'avoir pose en bas
   * le faisait deborder, et le compositeur reproduit fidelement la position —
   * l'apercu ET la video se retrouvaient sans titre. Un brouillon relu peut
   * porter la meme position pour les memes raisons.
   *
   * Idempotent : une position deja valide n'est pas reecrite, donc pas de
   * boucle de rendu.
   */
  useEffect(() => {
    const host = previewRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const recadre = (
      selecteur: string,
      anchor: 'top-left' | 'bottom-center',
      pos: Pos,
      set: (p: Pos) => void,
    ) => {
      const el = host.querySelector(selecteur);
      if (!el) return;
      const b = el.getBoundingClientRect();
      if (b.width <= 0 || b.height <= 0) return;
      const next = clampToBox(pos, anchor, {
        width: (b.width / rect.width) * 100,
        height: (b.height / rect.height) * 100,
      });
      if (!samePos(next, pos)) set(next);
    };
    recadre('[data-title-block]', 'top-left', titlePos, setTitlePos);
    recadre('[data-cta-block]', 'bottom-center', ctaPos, setCtaPos);
  }, [titlePos, ctaPos, format, textStyles, generated, displayScale]);


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
    transition,
    textAnimation,
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
    // Voix par sequence : le TEXTE et l'URL, jamais la duree — elle est
    // remesuree sur l'audio au chargement, et une valeur relue pourrait ne
    // plus correspondre au fichier.
    sequenceVoices: Object.fromEntries(
      SEQUENCE_KEYS.map((k) => [k, {
        text: sequenceVoices[k].text,
        audioUrl: persistableDraftUrl(sequenceVoices[k].audioUrl),
        source: sequenceVoices[k].source ?? undefined,
        ttsVoice: sequenceVoices[k].ttsVoice,
      }]),
    ),
    sequenceVoicesUserEdited,
    voiceName,
    musicVolume,
    voiceVolume,
    rushUrl: persistableDraftUrl(rushUrl),
    rushName,
    rushIsClip,
    scheduledDate,
    // Placement fait a la main. `undefined` quand rien n'a bouge : un
    // brouillon sans ces champs se relit exactement comme avant.
    titlePos: samePos(titlePos, DESIGN.titlePos) ? undefined : titlePos,
    ctaPos: samePos(ctaPos, DESIGN.ctaPos) ? undefined : ctaPos,
    cardBoxes: cardBoxes ?? undefined,
    cardGroups: cardGroups.length ? cardGroups : undefined,
    elements: freeElements.length ? freeElements : undefined,
    posterUrl: posterUrl ?? undefined,
    posterTransform: posterTransformActive(posterTransform) ? posterTransform : undefined,
    seqBackgrounds: Object.keys(seqBackgrounds).length ? seqBackgrounds : undefined,
    imageSource,
    batchCount,
    batchPhotoUrls: batchPhotoUrls.length ? batchPhotoUrls : undefined,
    batchPhotoMode,
  }), [
    started, step, themeId, customTopic, toneId, format, colors,
    titleStyle, subtitleStyle, ctaStyle, watermarkOverride, watermarkEnabled,
    sequences, introDuration, cardsDuration, videoDuration, ctaDuration,
    transition,
    textAnimation,
    generated, audioKeyframes, musicUrl, musicName, voiceUrl, voiceName, musicVolume,
    sequenceVoices, sequenceVoicesUserEdited,
    voiceVolume, rushUrl, rushName, rushIsClip, scheduledDate,
    titlePos, ctaPos, cardBoxes, cardGroups, freeElements, posterUrl, posterTransform, seqBackgrounds, imageSource, batchCount, batchPhotoUrls, batchPhotoMode,
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
    // `sanitizeDraft` a deja valide la valeur contre la liste du
    // compositeur : un style inconnu est arrive ici a `undefined`.
    if (draft.transition) setTransition(draft.transition as TransitionStyle);
    if (draft.textAnimation) setTextAnimation(draft.textAnimation as TextAnimation);
    setIntroDuration(draft.introDuration!);
    setCardsDuration(draft.cardsDuration!);
    setVideoDuration(draft.videoDuration!);
    setCtaDuration(draft.ctaDuration!);
    if (draft.generated) setGenerated(draft.generated as Generated);
    if (draft.audioKeyframes) setAudioKeyframes(draft.audioKeyframes as AudioKeyframe[]);
    if (draft.musicUrl) { setMusicUrl(draft.musicUrl); setMusicName(draft.musicName ?? ''); }
    if (draft.voiceUrl) { setVoiceUrl(draft.voiceUrl); setVoiceName(draft.voiceName ?? ''); }
    if (draft.sequenceVoices) {
      setSequenceVoices((prev) => {
        const next = { ...prev };
        for (const k of SEQUENCE_KEYS) {
          const v = draft.sequenceVoices?.[k];
          if (!v) continue;
          next[k] = {
            text: v.text ?? '',
            audioUrl: v.audioUrl ?? null,
            // Sans audio, pas de source : les deux vont ensemble.
            source: v.audioUrl ? ((v.source as 'tts' | 'record') ?? 'tts') : null,
            ttsVoice: v.ttsVoice,
            // Duree volontairement absente : elle sera remesuree.
          };
        }
        return next;
      });
    }
    if (draft.sequenceVoicesUserEdited) {
      setSequenceVoicesUserEdited((prev) => ({ ...prev, ...draft.sequenceVoicesUserEdited }));
    }
    setMusicVolume(draft.musicVolume!);
    setVoiceVolume(draft.voiceVolume!);
    if (draft.rushUrl) {
      setRushUrl(draft.rushUrl);
      setRushName(draft.rushName ?? '');
      setRushIsClip(!!draft.rushIsClip);
    }
    if (draft.scheduledDate) setScheduledDate(draft.scheduledDate);
    // Placement : chaque champ absent laisse le defaut d'origine en place.
    if (draft.titlePos) setTitlePos(draft.titlePos);
    if (draft.ctaPos) setCtaPos(draft.ctaPos);
    if (draft.cardBoxes) {
      const free = draft.cardBoxes as FreeCards;
      // La ref suit l'etat : c'est ELLE que lit le gestionnaire de glissement,
      // memoise sans dependances. Sans cela, la premiere prise remesurerait la
      // disposition et effacerait ce qu'on vient de restaurer.
      cardBoxesRef.current = free;
      setCardBoxes(free);
    }
    if (draft.cardGroups) setCardGroups(draft.cardGroups);
    if (draft.elements) setFreeElements(draft.elements);
    if (draft.posterUrl) setPosterUrl(draft.posterUrl);
    if (draft.posterTransform) setPosterTransform(clampPosterTransform(draft.posterTransform));
    if (draft.seqBackgrounds) setSeqBackgrounds(draft.seqBackgrounds as SeqBackgrounds);
    if (draft.imageSource) setImageSource(draft.imageSource);
    if (draft.batchCount) setBatchCount(draft.batchCount);
    if (draft.batchPhotoUrls) setBatchPhotoUrls(draft.batchPhotoUrls);
    if (draft.batchPhotoMode) setBatchPhotoMode(draft.batchPhotoMode);
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
      draft.titlePos || draft.ctaPos || draft.cardBoxes || draft.cardGroups ? 'placement' : null,
      draft.elements ? 'éléments' : null,
      draft.posterUrl ? 'affiche' : null,
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
   * Ce que l'apercu MONTRE — la seule source des deux instances.
   *
   * L'apercu de la colonne et la fenetre agrandie lisent cet objet : une
   * valeur ajoutee ici arrive dans les deux, alors que deux listes de props
   * recopiees divergeraient a la premiere evolution.
   *
   * N'y figurent que des VALEURS. Les refs et les poignees d'edition restent
   * sur l'apercu principal : lui seul est mesure, edite et photographie.
   */
  const previewShared = {
    generated,
    format,
    titlePos,
    ctaPos,
    cardBoxes: effectiveCardBoxes,
    selectedCards,
    groupedCards: groupedByCard,
    posterUrl: fondAffiche.url,
    posterTransform: fondAffiche.transform,
    elements: freeElements,
    selectedElementId,
    capturing,
    activeOrder,
    gradStart,
    gradEnd,
    gradientOpacity,
    rushUrl,
    watermark: watermarkLabel,
    accent,
    text: textStyles,
    focus: previewFocus,
  };
  /**
   * Les cartes sont-elles a l'ecran ? La sequence peut etre desactivee, ou
   * l'onglet d'apercu filtrer sur le titre. Annoncer « 2 cartes
   * selectionnees » sous un apercu ou rien n'est cercle ni cliquable serait
   * un message sans objet.
   */
  const cardsVisible =
    activeOrder.includes('cards') && (previewFocus === 'all' || previewFocus === 'cards');

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
   * Pre-remplissage des textes de voix depuis le contenu genere.
   *
   * Le Mode simple genere son contenu APRES l'etape Audio : il n'y a rien a
   * lire tant que `generated` est vide, et le panneau n'est donc propose
   * qu'a l'etape Contenu, une fois le texte connu.
   *
   * `userEdited` bloque la reecriture : une regeneration du contenu ne doit
   * pas effacer un texte que l'utilisateur a repris a la main.
   */
  useEffect(() => {
    if (!generated) return;
    const auto = buildAutoFillText({
      title: generated.title,
      subtitle: generated.subtitle,
      // Les cartes du Mode simple nomment leur intitule `title` la ou
      // `buildAutoFillText` attend `label`.
      cards: generated.cards.map((c) => ({
        label: c.title,
        value: c.value,
        description: c.description,
      })),
      ctaMainText: generated.cta,
      ctaSubText: generated.ctaSub,
    });
    setSequenceVoices((prev) => {
      let change = false;
      const next: SequenceVoices = { ...prev };
      for (const key of SEQUENCE_KEYS) {
        if (sequenceVoicesUserEdited[key]) continue;
        if (prev[key].text !== auto[key]) {
          next[key] = { ...prev[key], text: auto[key] };
          change = true;
        }
      }
      return change ? next : prev;
    });
  }, [generated, sequenceVoicesUserEdited]);

  /**
   * Duree de chaque sequence calee sur la duree REELLE de sa voix.
   *
   * Le panneau sonde l'audio genere et range sa duree dans
   * `sequenceVoices[k].duration` : on s'en sert plutot que de re-mesurer, ce
   * qui donnerait deux sources pour une meme valeur.
   *
   * Applique UNE FOIS par duree de voix, grace au registre ci-dessous. Sans
   * lui, l'effet se redeclencherait sur son propre changement de duree et
   * ecraserait tout reglage manuel a chaque rendu — l'utilisateur ne pourrait
   * plus toucher au curseur.
   */
  /**
   * URL des voix par sequence, dans la forme attendue par le compositeur.
   *
   * ⚠️ Le champ s'appelle `sequenceVoiceUrls` cote compositeur — une carte
   * d'URL, pas les objets `SequenceVoices`. Lui passer l'etat tel quel serait
   * ignore en silence, et le montage sortirait sans voix.
   *
   * Rend `undefined` quand aucune sequence n'a d'audio : le compositeur
   * retombe alors sur la voix unique `voiceUrl`, comme avant.
   */
  const sequenceVoiceUrls = useMemo(() => {
    const out: { titre?: string; cartes?: string; video?: string; cta?: string } = {};
    let une = false;
    for (const key of SEQUENCE_KEYS) {
      const url = sequenceVoices[key]?.audioUrl;
      if (url) { out[key] = url; une = true; }
    }
    return une ? out : undefined;
  }, [sequenceVoices]);

  const appliedVoiceDurations = useRef<Partial<Record<SequenceKey, number>>>({});
  useEffect(() => {
    const setters: Record<SequenceKey, (n: number) => void> = {
      titre: setIntroDuration,
      cartes: setCardsDuration,
      video: setVideoDuration,
      cta: setCtaDuration,
    };
    for (const key of SEQUENCE_KEYS) {
      const sv = sequenceVoices[key];
      const dur = sv.audioUrl ? sv.duration : undefined;
      if (typeof dur !== 'number' || !Number.isFinite(dur) || dur <= 0) {
        // Voix retiree : on oublie la valeur appliquee, sans toucher a la
        // duree — l'utilisateur garde ce qu'il avait.
        delete appliedVoiceDurations.current[key];
        continue;
      }
      if (appliedVoiceDurations.current[key] === dur) continue;
      appliedVoiceDurations.current[key] = dur;
      setters[key](voiceSequenceSeconds(dur));
    }
  }, [sequenceVoices]);

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
  /**
   * Contenu de la n-ieme video du lot.
   *
   * Sans angle impose, l'IA rend le meme texte a chaque appel sur un meme
   * sujet : un lot de cinq videos serait cinq fois la meme. On lui passe donc
   * un angle tournant, un jeton de variation, et les titres deja produits pour
   * qu'elle ne se repete pas.
   *
   * Rend `null` en cas d'echec : l'appelant garde alors le contenu courant.
   * Mieux vaut une video de plus au meme texte qu'un lot interrompu.
   */
  const generateBatchVariation = useCallback(async (
    index: number,
    priorTitles: string[],
  ): Promise<Generated | null> => {
    const topic = customTopic.trim() || (THEMES.find((t) => t.id === themeId) ?? THEMES[0]).topic;
    if (!topic) return null;
    try {
      const controller = new AbortController();
      // 45 s : Claude Haiku repond en 3 a 12 s, mais un plafond serre
      // renverrait au contenu courant avant meme l'arrivee de la variation.
      const timer = setTimeout(() => controller.abort(), 45000);
      const res = await fetch('/api/content/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: batchTopic(topic, index),
          locale: 'fr',
          cardCount: generated?.cards.length ?? 5,
          variationNonce: variationNonce(index, Date.now()),
          existingTitles: priorTitles,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      const data = await res.json();
      const c = data?.content;
      if (!data?.success || !c || typeof c.title !== 'string' || !Array.isArray(c.cards)) return null;
      return {
        title: c.title,
        subtitle: typeof c.subtitle === 'string' ? c.subtitle : '',
        cta: typeof c.cta === 'string' && c.cta ? c.cta : (generated?.cta ?? ''),
        ctaSub: typeof c.ctaSub === 'string' && c.ctaSub ? c.ctaSub : (generated?.ctaSub ?? ''),
        cards: c.cards.slice(0, generated?.cards.length ?? 5).map((carte: Record<string, unknown>) => ({
          id: newCardId(),
          icon: typeof carte.icon === 'string' ? carte.icon : 'Sparkles',
          title: typeof carte.label === 'string' ? carte.label : String(carte.title ?? ''),
          description: typeof carte.description === 'string' ? carte.description : '',
          value: typeof carte.value === 'string' ? carte.value : '',
        })),
      };
    } catch {
      return null;
    }
  }, [customTopic, themeId, generated]);

  /**
   * Rend le montage — vers le CALENDRIER, ou vers le disque de l'utilisateur.
   *
   * Un seul chemin pour les deux destinations : variation du lot, photo des
   * cartes, options du compositeur, credits. Deux copies auraient diverge des
   * la premiere option ajoutee d'un cote seulement, et la video telechargee
   * n'aurait plus ressemble a celle du Calendrier.
   *
   * Ne changent que la FIN de chaque tour : le Calendrier televerse puis cree
   * un post ; le bureau garde le blob et ne cree RIEN.
   */
  /**
   * Debite le rendu. Jamais bloquant : le montage est deja fait, le refuser
   * a posteriori ne le rendrait pas moins livre.
   *
   * `/api/credits/deduct` repond 402 sur solde insuffisant, et un `.catch()`
   * seul n'attrape que les erreurs reseau, pas un 402 — d'ou la lecture
   * explicite du statut.
   */
  /** Nom de fichier tire du titre : ni espace, ni accent, ni signe. */
  const slugTitre = (titre: string): string =>
    (titre || 'studiio').replace(/[^a-zA-Z0-9-_]+/g, '_').slice(0, 60) || 'studiio';

  const debiterRendu = async (cost: number, renderFormat: 'reel' | 'tv', postId?: string) => {
    try {
      const res = await fetch('/api/credits/deduct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cost, reason: 'render', format: renderFormat }),
      });
      if (!res.ok) {
        console.warn(
          `[Assistant] Débit des crédits refusé (${res.status})`
          + (postId ? ` — post ${postId} conservé` : ' — montage conservé'),
        );
      }
    } catch (e) {
      console.warn('[Assistant] Débit des crédits injoignable — montage conservé:', e);
    }
  };

  const runRender = async (destination: 'calendrier' | 'bureau' | 'apercu') => {
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
    // Le lot : combien de montages, et a quelles dates.
    // Un apercu ne rend qu'UNE video : en jouer cinq a la suite n'apprendrait
    // rien de plus, et couterait cinq rendus.
    const total = destination === 'apercu' ? 1 : clampBatchCount(batchCount);
    // Un lot incomplet livrerait deux montages a l'affiche identique — ce que
    // le lot existe precisement pour eviter. On refuse plutot que de dupliquer
    // en silence.
    if (total > 1 && !batchPhotosReady(batchPhotoUrls, total)) {
      setError(
        `Choisissez autant de photos que de vidéos (${batchPhotoUrls.filter(Boolean).length} sur ${total}), ou repassez en mode automatique.`,
      );
      setSending(false);
      return;
    }
    const coutTotal = batchCost(cost, total);
    const baseDate = scheduledDate ? new Date(`${scheduledDate}T12:00:00`) : new Date();
    const dates = batchDates(Number.isNaN(baseDate.getTime()) ? new Date() : baseDate, total);

    try {
      // 1. Solde — non bloquant si l'endpoint est indisponible, comme l'éditeur.
      try {
        const check = await fetch('/api/credits/balance').then((r) => r.json());
        const balance = check?.data?.credits ?? check?.balance;
        // `check.ok` est indispensable : la route renvoie `{ok:false, balance:0}`
        // sur 401/500. Sans ce garde, une panne passagère afficherait
        // « Crédits insuffisants : 0 disponible » à un utilisateur qui en a.
        const readable = check?.success !== false && check?.ok !== false;
        if (readable && typeof balance === 'number' && balance < coutTotal) {
          setError(`Crédits insuffisants : ${coutTotal} requis, ${balance} disponible(s).`);
          return;
        }
      } catch {
        // On continue : un échec de lecture du solde ne doit pas bloquer.
      }

      // ── Boucle du lot ──────────────────────────────────────────────
      // Une seule video : le corps s'execute une fois, exactement comme avant.
      // Le contenu courant sert TOUJOURS a la premiere — l'utilisateur vient
      // de le relire dans l'apercu, le remplacer par une variation le
      // surprendrait. Les suivantes sont variees.
      const contenuInitial = generated;
      const titresDejaVus = [generated.title].filter(Boolean);
      /** Montages a telecharger — uniquement en destination « bureau ». */
      const blobsBureau: Array<{ blob: Blob; titre: string }> = [];
      try {
        for (let b = 0; b < total; b += 1) {
          setBatchProgress({ done: b, total });
          let contenu = contenuInitial;
          if (total > 1 && b > 0) {
            setRenderStage(`Variation ${b + 1}/${total}…`);
            const variation = await generateBatchVariation(b, titresDejaVus);
            if (variation) {
              contenu = variation;
              if (variation.title) titresDejaVus.push(variation.title);
            }
          }
          // L'apercu EST la source de la photo des cartes : il doit porter le
          // contenu de cette iteration avant qu'on le photographie.
          if (contenu !== generated) flushSync(() => setGenerated(contenu));
          // Plus de `% length` : l'affiche vient de l'emplacement de CETTE
          // video. Hors lot, la photo unique fait office.
          const affiche = total > 1
            ? distinctPhotoForIndex(batchPhotoUrls, b)
            : (posterUrl ?? undefined);

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
          // Les liseres — selection et glissement — sont des aides d'edition :
          // photographies, ils seraient blittes dans la video.
          //
          // Ce drapeau tient pour TOUTE la duree de la capture, au lieu de vider
          // puis restaurer la selection : entre le vidage et `domToCanvas` il y a
          // un import dynamique et l'attente des polices, et l'apercu reste
          // interactif. Un clic pendant l'envoi reposait la selection juste a
          // temps pour qu'elle soit gravee dans le montage.
          flushSync(() => setCapturing(true));
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
          setCapturing(false);
        }

        // 3. Composition + upload (composeAndUpload fait les deux et produit
        //    aussi la vignette).
        setRenderStage('Rendu du montage…');
        // Cartes enrichies d'un `iconImage` : sans cela le repli canvas du
        // compositeur ecrirait « Droplet » en toutes lettres.
        const composerCards = await preRenderCardIcons(
          contenu.cards.map((c) => ({
            emoji: c.icon,
            label: c.title,
            value: c.value,
            description: c.description,
            color: accent,
          })),
        );
        const optionsRendu: ComposerOptions = {
          width: size.w,
          height: size.h,
          fps: 30,
          // Le compositeur ne met PAS le titre en majuscules (contrairement a
          // l'apercu, qui applique `uppercase` en CSS) : on le fait ici.
          title: (contenu.title || 'Infographie').toUpperCase(),
          subtitle: contenu.subtitle || undefined,
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
          // Style joue entre deux sequences consecutives. Toujours envoye :
          // le compositeur retombe de toute facon sur le fondu, autant lui
          // dire explicitement ce que l'ecran annonce.
          transition,
          introDuration: seqDuration('intro'),
          cardsDuration: seqDuration('cards'),
          videoDuration: seqDuration('video'),
          ctaDuration: seqDuration('cta'),
          // Le compositeur bascule en mode « normal » (temps reel, audio mixe et
          // embarque) des qu'une de ces deux URL est fournie ; sans elles il
          // reste en mode « fast ».
          musicUrl: musicUrl || undefined,
          voiceUrl: voiceUrl || undefined,
          // Voix PAR SEQUENCE : chaque clip est joue au debut de sa sequence
          // et coupe a sa fin. `voiceUrl` reste le repli quand il n'y en a
          // aucune — c'est le cas de tous les montages anterieurs.
          sequenceVoiceUrls,
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
          ctaText: contenu.ctaSub,
          ctaSubText: contenu.ctaSub,
          watermarkText: contenu.cta,
          // Filigrane. `enabled: false` est la SEULE facon de l'eteindre : le
          // compositeur allume le calque des qu'il n'est pas explicitement
          // desactive, et se rabat alors sur « Afroboost.com ».
          siteText: watermarkConfig,
          // Photo d'affiche : le compositeur la peint en fond de TOUTES les
          // sequences (`posterOnAllSequences` absent vaut « partout »), avec le
          // voile de degrade par-dessus — exactement ce que montre l'apercu.
          posterUrl: affiche,
          // Recadrage de l'affiche — le compositeur la pre-recadre une fois.
          posterTransform,
          // Fonds par sequence : le compositeur les substitue a l'affiche pour
          // la sequence concernee, recadrage compris. `undefined` tant
          // qu'aucune n'a le sien — le compositeur se comporte alors comme
          // avant, a la ligne pres.
          sequenceBackgrounds: Object.keys(seqBackgrounds).length
            ? {
                titre: seqBackgrounds.titre ? { url: seqBackgrounds.titre.url, opacity: 1, transform: seqBackgrounds.titre.transform } : null,
                cartes: seqBackgrounds.cartes ? { url: seqBackgrounds.cartes.url, opacity: 1, transform: seqBackgrounds.cartes.transform } : null,
                video: seqBackgrounds.video ? { url: seqBackgrounds.video.url, opacity: 1, transform: seqBackgrounds.video.transform } : null,
                cta: seqBackgrounds.cta ? { url: seqBackgrounds.cta.url, opacity: 1, transform: seqBackgrounds.cta.transform } : null,
              }
            : undefined,
          design: {
            // Animation d'apparition du texte, jouee sur le debut de chaque
            // sequence. `'none'` = le rendu d'hier, au pixel.
            textAnimation,
            cardStyle: CARD_STYLE,
            // Sans ce champ : titre et CTA en Helvetica, cartes en Inter.
            font: DESIGN.font,

            // ── Fond ──────────────────────────────────────────────────────
            gradientColor1: gradStart,
            gradientColor2: gradEnd,
            gradientOpacity,
            // Aucune sequence en noir plein. Sans affiche, le backdrop degrade
            // est peint partout ; avec une affiche, elle prend sa place et le
            // degrade ne subsiste qu'en voile — dans les deux cas l'apercu et la
            // video montrent la meme chose.
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
            ctaMainText: contenu.cta,
            ctaSubTextDesign: contenu.ctaSub,
            watermarkPosition: { x: ctaPos.x, y: ctaPos.y },
            watermarkSize: DESIGN.ctaWidth,

            // ── Cartes : image de l'apercu, blittee telle quelle ──────────
            cardsSnapshot,
            cardsSnapshotRect,
            // Couche d'elements : le compositeur la peint sur les quatre
            // sequences. `undefined` sans element — rien ne change alors.
            elements: await rasterizeElements(),
          },
          onProgress: (pct, stage) => {
            setRenderProgress(Math.max(0, Math.min(100, Math.round(pct))));
            if (stage) setRenderStage(stage);
          },
        };

        // Meme objet d'options pour les deux destinations — seule change la
        // fonction appelee. `composeVideo` compose SANS televerser : un
        // telechargement local n'a aucune raison de passer par le stockage.
        // La branche « bureau » sort avant d'atteindre `thumbnailUrl` : on
        // garde donc le type du Calendrier, complete d'un montage local.
        // ── Le montage de l'aperçu est-il encore valable ? ────────────
        // La signature couvre TOUT ce qui part au compositeur. Identique =
        // recomposer rendrait le même fichier, et débiterait une seconde fois
        // ce que l'utilisateur a déjà payé en cliquant sur Play.
        //
        // Le lot est exclu : ses vidéos 2..N ont un contenu VARIÉ, que le
        // montage de l'aperçu ne représente pas.
        const signature = renderSignature(optionsRendu);
        let vignetteApercu: Blob | null = null;
        const reutilisable =
          total === 1
          && destination !== 'apercu'
          && !!previewBlobRef.current
          && signatureMatches(previewSignatureRef.current, signature);

        let composed: { blob: Blob; url: string | null; thumbnailUrl: string | null; composerVersion: string };
        if (reutilisable) {
          setRenderStage('Montage déjà prêt — réutilisé.');
          setRenderProgress(60);
          const dejaFait = previewBlobRef.current!;
          composed = destination === 'bureau'
            ? { blob: dejaFait, url: null, thumbnailUrl: null, composerVersion: CURRENT_COMPOSER_VERSION }
            // Le Calendrier a besoin d'une URL : on téléverse le blob déjà
            // composé au lieu de refaire tout le rendu.
            : await uploadRendu(dejaFait, previewThumbRef.current, optionsRendu);
        } else if (destination === 'calendrier') {
          composed = await composeAndUpload(optionsRendu);
        } else {
          // Aperçu et bureau composent sans téléverser. La vignette est
          // gardée pour l'aperçu : un montage réutilisé par le Calendrier
          // arriverait sinon sans miniature.
          const rendu = await composeVideo(optionsRendu);
          composed = {
            blob: rendu.video,
            url: null,
            thumbnailUrl: null,
            composerVersion: CURRENT_COMPOSER_VERSION,
          };
          if (destination === 'apercu') vignetteApercu = rendu.thumbnail;
        }

        // ── Destination « aperçu » ─────────────────────────────────────
        // On garde le montage, on débite une fois, et on le joue. Aucun post,
        // aucun téléversement.
        if (destination === 'apercu') {
          setPreviewRender(composed.blob, signature, vignetteApercu);
          await debiterRendu(cost, renderFormat);
          setRenderProgress(100);
          setRenderStage('Prêt.');
          return;
        }

        // ── Destination « bureau » ─────────────────────────────────────
        // On garde le montage et on debite ; aucun post n'est cree. Le
        // telechargement se fait APRES la boucle, pour n'ouvrir qu'une seule
        // fenetre d'enregistrement meme sur un lot.
        if (destination === 'bureau') {
          blobsBureau.push({ blob: composed.blob, titre: contenu.title });
          // Un montage réutilisé a DÉJÀ été payé au moment du Play : le
          // débiter à nouveau ferait payer deux fois le même rendu.
          if (!reutilisable) await debiterRendu(cost, renderFormat);
          continue;
        }

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
          subtitle: contenu.subtitle,
          theme: theme.id,
          cards: contenu.cards.map((c) => ({
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
          hasAudio: !!(musicUrl || voiceUrl || sequenceVoiceUrls || (rushUrl && seqDuration('video') > 0)),
          // Les URL `blob:` ne survivent pas au rechargement de la page. Le
          // panneau audio televerse normalement les pistes et renvoie une URL
          // publique, mais il retombe sur un blob local si le televersement de
          // la voix de synthese echoue. Stocker cette URL-la laisserait une
          // reference morte dans le post.
          musicUrl: persistableUrl(musicUrl),
          voiceUrl: persistableUrl(voiceUrl),
          sequenceVoiceUrls,
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
            ctaText: contenu.cta,
            ctaSubText: contenu.ctaSub,
            watermarkText: contenu.cta,
            borderEnabled: false,
            borderColor: null,
          },
          design: {
            textAnimation,
            cardStyle: CARD_STYLE,
            font: DESIGN.font,
            // Persiste pour que le Calendrier (apercu HTML et regeneration)
            // ancre le titre a GAUCHE comme la video, et non centre sur x=8%.
            titleAlign: 'left',
            // Memes champs typographiques que ceux passes au compositeur : une
            // regeneration depuis le Calendrier repart donc du meme rendu.
            ...textDesign,
            ctaMainText: contenu.cta,
            ctaSubText: contenu.ctaSub,
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
              // Elements libres, en % du conteneur des cartes. Lecteurs : defaut
              // `[]` — les posts anterieurs n'ont pas ce champ.
              elements: freeElements,
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
            title: (contenu.title || 'Infographie').toUpperCase(),
            caption: contenu.subtitle || '',
            media_url: composed.url,
            media_type: 'video',
            format: renderFormat,
            platforms: [],
            scheduled_date: dates[b],
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
        if (!reutilisable) await debiterRendu(cost, renderFormat, json.post.id);

        }
      } finally {
        // L'ecran doit retrouver ce que l'utilisateur avait compose, quoi
        // qu'il soit arrive au lot.
        if (total > 1) setGenerated(contenuInitial);
        setBatchProgress(null);
      }

      // ── Telechargement ────────────────────────────────────────────
      // Apres la boucle, et une seule fois : un lot de cinq videos ouvrirait
      // sinon cinq fenetres d'enregistrement.
      if (destination === 'bureau') {
        if (blobsBureau.length === 0) {
          setError('Aucun montage à télécharger.');
          return;
        }
        setRenderStage('Préparation du téléchargement…');
        if (blobsBureau.length === 1) {
          await downloadBlob(
            blobsBureau[0].blob,
            `${slugTitre(blobsBureau[0].titre)}.webm`,
            (pct, stage) => {
              setRenderProgress(Math.max(0, Math.min(100, Math.round(pct))));
              if (stage) setRenderStage(stage);
            },
          );
        } else {
          // Un lot part en UN dossier compresse : `downloadBlob` convertit le
          // WebM en MP4 au passage, ce qu'on ne veut pas faire N fois — les
          // videos entrent donc telles quelles dans le zip.
          setRenderStage('Compression…');
          const JSZip = (await import('jszip')).default;
          const zip = new JSZip();
          blobsBureau.forEach((v, i) => {
            zip.file(`${slugTitre(v.titre)}-${i + 1}.webm`, v.blob);
          });
          const archive = await zip.generateAsync({ type: 'blob' });
          const lien = document.createElement('a');
          const url = URL.createObjectURL(archive);
          lien.href = url;
          lien.download = `${slugTitre(contenuInitial.title)}-videos.zip`;
          document.body.appendChild(lien);
          lien.click();
          document.body.removeChild(lien);
          // Safari lit le blob APRES le clic : revoquer tout de suite
          // annulerait le telechargement.
          setTimeout(() => { URL.revokeObjectURL(url); document.body.contains(lien) && lien.remove(); }, 5000);
        }
        setRenderProgress(100);
        setRenderStage('Téléchargé.');
        return;
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
    // Sans cela, le montage suivant garderait les puces du precedent
    // ouvertes jusqu'a « Envoi ».
    setMaxStepReached(0);
    setTransition(DEFAULT_TRANSITION);
    setTextAnimation(DEFAULT_TEXT_ANIMATION);
    // Sans cela, le montage suivant naitrait filtre sur l'onglet du precedent.
    setPreviewFocus('all');
    // Meme raison pour le placement : sans remise a zero, le montage suivant
    // heriterait en silence du titre et du CTA deplaces du precedent — et les
    // enverrait tels quels au compositeur et aux metadonnees.
    setTitlePos(DESIGN.titlePos);
    setCtaPos(DESIGN.ctaPos);
    setCardBoxes(null);
    setSelectedCards(new Set());
    setCardGroups([]);
    setFreeElements([]);
    setSelectedElementId(null);
    setPosterUrl(null);
    setPosterPhotos([]);
    setPosterTransform(POSTER_TRANSFORM_NEUTRAL);
    setSeqBackgrounds({});
    // Sans cette remise a zero, le montage suivant heriterait des textes ET
    // des audios du precedent — et de ses durees calees dessus.
    setSequenceVoices(emptySequenceVoices());
    setSequenceVoicesUserEdited(emptySequenceVoicesUserEdited());
    appliedVoiceDurations.current = {};
    setCropping(false);
    setBatchCount(1);
    setBatchPhotoUrls([]);
    setBatchPhotoMode('auto');
    setSlotCible(null);
    setDuplicateNotice(null);
    setOpenSection('format');
    genSigRef.current = '';
    setGenerated(null);
    setSent(false);
    setError(null);
  };

  // ── Rendu ───────────────────────────────────────────────────────────
  /**
   * Une etape est-elle atteignable d'un clic ?
   *
   * Deux conditions, et pas une de plus :
   *
   * 1. **Elle a deja ete atteinte.** Sauter vers une etape jamais visitee
   *    court-circuiterait ce que la precedente declenche — passer de
   *    « Sujet » a « Contenu » sauterait `ensureGenerated()`, et l'ecran
   *    s'afficherait vide, sans contenu ni generation en cours.
   * 2. **« Envoi » exige un contenu genere**, exactement comme le bouton
   *    « Continuer » qui y mene (`disabled={generating || !generated}`).
   *    Une seule regle pour les deux chemins : sinon les puces ouvriraient
   *    une porte que le bouton tient fermee.
   */
  const stepReachable = (i: number): boolean => {
    if (i > maxStepReached) return false;
    if (i === S.envoi) return !!generated && !generating;
    return true;
  };

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
                  {/* Le bouton « Activer » était désarmé : la carte annonçait
                      une fonctionnalité qui n'existait pas. Elle porte
                      désormais son propre réglage. */}
                  <div className="mt-4">
                    <AutopilotPanel accent={accent} />
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
              {STEPS.map((label, i) => {
                const atteignable = stepReachable(i);
                // Aller sur l'etape courante ne ferait rien : on n'annonce pas
                // un bouton qui n'a aucun effet.
                const cliquable = atteignable && i !== step;
                const aller = () => { if (cliquable) setStep(i); };
                return (
                <div key={label} className="flex items-center gap-2 flex-1 last:flex-none">
                  {/* Puce cliquable — l'apparence ne change pas, seule
                      l'interactivite est ajoutee. */}
                  <div
                    className={`flex items-center gap-1.5 min-w-0 rounded transition ${
                      cliquable
                        ? 'cursor-pointer hover:brightness-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400'
                        : 'cursor-not-allowed'
                    }`}
                    {...(cliquable
                      ? {
                          role: 'button',
                          tabIndex: 0,
                          'aria-label': `Aller à l’étape ${label}`,
                          onClick: aller,
                          onKeyDown: (e: React.KeyboardEvent) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              // Espace fait defiler la page par defaut.
                              e.preventDefault();
                              aller();
                            }
                          },
                        }
                      : { 'aria-disabled': true })}
                    data-step={i}
                    data-step-reachable={atteignable ? 'oui' : 'non'}
                  >
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
                );
              })}
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
                  id="affiche"
                  title="Photo d’affiche"
                  hint={posterUrl ? 'Photo choisie' : 'Dégradé'}
                  open={openSection === 'affiche'}
                  onToggle={toggleSection}
                >
                  <div className="space-y-3">
                    <p className="text-xs text-gray-500">
                      Sans photo, le fond reste le dégradé de vos couleurs.
                    </p>

                    {/* Source */}
                    <div className="flex items-center gap-1.5">
                      {(['pexels', 'unsplash'] as const).map((src) => (
                        <button
                          key={src}
                          type="button"
                          onClick={() => changeImageSource(src)}
                          data-poster-source={src}
                          className={`flex-1 rounded-lg border px-3 py-1.5 text-xs capitalize transition-colors ${
                            imageSource === src
                              ? 'border-purple-500 text-white'
                              : 'border-gray-800 text-gray-400 hover:text-white hover:border-gray-700'
                          }`}
                        >
                          {src}
                        </button>
                      ))}
                    </div>

                    {/* Recherche */}
                    <div className="flex items-center gap-1.5">
                      <div className="relative flex-1">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                        <input
                          type="text"
                          value={photoQuery}
                          onChange={(e) => setPhotoQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              searchPhotos(photoQuery.trim() || currentTopic, imageSource);
                            }
                          }}
                          placeholder={`Rechercher des photos… (ex : ${currentTopic})`}
                          className="w-full rounded-lg bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none pl-8 pr-2.5 py-2 text-sm"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => searchPhotos(photoQuery.trim() || currentTopic, imageSource)}
                        disabled={photosLoading}
                        data-poster-search
                        className="rounded-lg border border-gray-800 px-3 py-2 text-xs text-gray-300 hover:text-white hover:border-gray-700 disabled:opacity-40 transition-colors"
                      >
                        {photosLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Chercher'}
                      </button>
                    </div>

                    {photosError && <p className="text-xs text-gray-500">{photosError}</p>}

                    {/* ── AFFICHES DU LOT ─────────────────────────────
                        Une par video, toutes differentes. */}
                    {batchCount > 1 && (
                      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-3 space-y-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] uppercase tracking-wide text-gray-500 flex-1">
                            Affiches du lot
                          </span>
                          {(['auto', 'manuel'] as const).map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setBatchPhotoMode(m)}
                              data-batch-photo-mode={m}
                              className={`rounded-lg border px-2.5 py-1 text-xs capitalize transition-colors ${
                                batchPhotoMode === m
                                  ? 'border-purple-500 text-white'
                                  : 'border-gray-800 text-gray-400 hover:text-white hover:border-gray-700'
                              }`}
                            >
                              {m === 'auto' ? 'Auto' : 'Manuel'}
                            </button>
                          ))}
                        </div>

                        {batchPhotoMode === 'auto' && affichesDisponibles < batchCount && (
                          <p className="text-xs text-gray-500">
                            Pas assez de photos distinctes ({affichesDisponibles} pour {batchCount})
                            — élargissez la recherche ou demandez d’autres photos.
                          </p>
                        )}

                        {/* Un emplacement par video. Remplacable a l'unite,
                            dans les deux modes. */}
                        <div className="space-y-1.5">
                          {Array.from({ length: batchCount }, (_, b) => {
                            const url = batchPhotoUrls[b];
                            const vise = slotCible === b;
                            return (
                              <div
                                key={b}
                                data-batch-slot={b}
                                className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${
                                  vise ? 'border-purple-500' : 'border-gray-800'
                                }`}
                              >
                                <span className="w-5 text-center text-[11px] text-gray-500">{b + 1}</span>
                                {url ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={url} alt="" data-batch-slot-photo={url} className="h-8 w-8 rounded object-cover" />
                                ) : (
                                  <span className="h-8 w-8 rounded border border-dashed border-gray-700" />
                                )}
                                <span className="flex-1 truncate text-xs text-gray-500">
                                  {url ? 'Affiche choisie' : 'Aucune affiche'}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setSlotCible(vise ? null : b)}
                                  data-batch-slot-pick={b}
                                  className="rounded-lg border border-gray-800 px-2 py-1 text-[11px] text-gray-400 hover:text-white hover:border-gray-700 transition-colors"
                                >
                                  {vise ? 'Choisissez…' : 'Remplacer'}
                                </button>
                                <label className="rounded-lg border border-dashed border-gray-700 px-2 py-1 text-[11px] text-gray-400 cursor-pointer hover:border-purple-500 hover:text-white transition-colors">
                                  <Upload className="w-3 h-3 inline" />
                                  <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    disabled={posterUploading}
                                    data-batch-slot-upload={b}
                                    onChange={async (e) => {
                                      const file = e.target.files?.[0];
                                      e.target.value = '';
                                      if (!file) return;
                                      setPosterUploading(true);
                                      setPhotosError(null);
                                      try {
                                        const envoye = await uploadPosterFile(file);
                                        if (!envoye.url) {
                                          setPhotosError(`Photo non ajoutée : ${envoye.reason || 'envoi impossible'}`);
                                          return;
                                        }
                                        assignerAffiche(b, envoye.url);
                                        if (envoye.dataUrl) {
                                          setPhotosError(
                                            'Photo utilisée localement : l’envoi au stockage a échoué, elle ne survivra pas au rechargement.',
                                          );
                                        }
                                      } finally {
                                        setPosterUploading(false);
                                      }
                                    }}
                                  />
                                </label>
                              </div>
                            );
                          })}
                        </div>

                        {!affichesCompletes && (
                          <p className="text-xs text-gray-500">
                            {batchPhotoUrls.filter(Boolean).length} / {batchCount} — l’envoi est
                            bloqué tant que chaque vidéo n’a pas sa propre affiche.
                          </p>
                        )}
                      </div>
                    )}

                    {/* Grille */}
                    {posterPhotos.length > 0 && (
                      <>
                        {/* Ascenseur PROPRE : sans lui, parcourir la grille
                            faisait defiler toute la page et l'apercu sortait
                            de l'ecran — or c'est lui qu'on regarde en
                            choisissant une photo. */}
                        <div className="grid grid-cols-4 gap-1.5 max-h-64 overflow-y-auto pr-1">
                          {posterPhotos.map((photo) => {
                            const rang = batchPhotoUrls.indexOf(photo.url);
                            const retenue = batchCount > 1 ? rang >= 0 : posterUrl === photo.url;
                            // Une photo dont toutes les tailles ont echoue —
                            // ou dont l'affiche elle-meme est morte — n'est
                            // pas proposable : elle disparait de la grille
                            // plutot que d'y laisser une image brisee.
                            if (!photoUtilisable(photo, brokenPhotos)) return null;
                            const vignette = vignetteAffichable(photo, brokenPhotos)!;
                            return (
                              <button
                                key={`${photo.source ?? 'p'}-${photo.id}`}
                                type="button"
                                onClick={() => {
                                  if (slotCible !== null) {
                                    assignerAffiche(slotCible, photo.url);
                                    return;
                                  }
                                  // Onglet d'une sequence : la photo devient
                                  // SON fond, pas l'affiche globale.
                                  if (seqCible) {
                                    applyPhoto(photo.url);
                                    return;
                                  }
                                  if (batchCount > 1 && batchPhotoMode === 'manuel') {
                                    // Lot : on retient plusieurs affiches, dans
                                    // l'ordre des clics. Au-dela du nombre de
                                    // videos, le clic ne fait rien — le dire par
                                    // le compteur vaut mieux qu'ecraser un choix.
                                    setBatchPhotoUrls((prev) => {
                                      if (prev.includes(photo.url)) return prev.filter((u) => u !== photo.url);
                                      if (prev.length >= batchCount) return prev;
                                      return [...prev, photo.url];
                                    });
                                    // La premiere retenue sert aussi d'apercu.
                                    setPosterUrl((cur) => (cur === photo.url ? null : cur ?? photo.url));
                                    return;
                                  }
                                  setPosterUrl(retenue ? null : photo.url);
                                }}
                                data-poster-photo={photo.url}
                                draggable
                                onDragStart={(e) => {
                                  // Second filet : une URL inexploitable ne
                                  // part pas du tout. Sans lui, le depot
                                  // posait la chaine « undefined » comme
                                  // affiche — l'apercu ne changeait pas, et
                                  // on concluait que le glisser avait echoue.
                                  if (!urlUtilisable(photo.url)) {
                                    e.preventDefault();
                                    return;
                                  }
                                  // Type a nous EN PREMIER : `text/plain` sert
                                  // au reordonnancement des sequences, le lire
                                  // ici confondait les deux gestes.
                                  e.dataTransfer.setData(PHOTO_DND_TYPE, photo.url);
                                  e.dataTransfer.setData('text/uri-list', photo.url);
                                  e.dataTransfer.effectAllowed = 'copy';
                                  setPhotoDragging(true);
                                }}
                                onDragEnd={() => setPhotoDragging(false)}
                                title={photo.photographer ? `Photo : ${photo.photographer}` : 'Choisir cette photo'}
                                className={`relative overflow-hidden rounded-lg border transition-colors ${
                                  retenue ? 'border-purple-500' : 'border-gray-800 hover:border-gray-600'
                                }`}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={vignette}
                                  alt=""
                                  onError={() => {
                                    // La taille courante est marquee cassee ;
                                    // le rendu suivant essaie la suivante, et
                                    // masque la photo quand il n'en reste
                                    // aucune. Sans ce repli, une miniature
                                    // absente condamnerait une photo dont la
                                    // pleine resolution est parfaite.
                                    marquerCassee(vignette);
                                  }}
                                  className="aspect-[3/4] w-full object-cover"
                                />
                                {retenue && (
                                  <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-purple-500 text-[9px] font-bold">
                                    {batchCount > 1 ? rang + 1 : <Check className="w-2.5 h-2.5" />}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                        {batchCount > 1 && batchPhotoMode === 'manuel' && (
                          <p className="text-xs text-gray-500">
                            {batchPhotoUrls.length} / {batchCount} affiche
                            {batchPhotoUrls.length > 1 ? 's' : ''} retenue
                            {batchPhotoUrls.length > 1 ? 's' : ''}
                            {batchPhotoUrls.length > 0 && batchPhotoUrls.length < batchCount
                              ? ' — les manquantes reprendront les précédentes.'
                              : ''}
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={() => searchPhotos(photoQuery.trim() || currentTopic, imageSource, true)}
                          disabled={photosLoading}
                          className="w-full rounded-lg border border-gray-800 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:border-gray-700 disabled:opacity-40 transition-colors"
                        >
                          Autres photos
                        </button>
                      </>
                    )}

                    {/* Ma photo */}
                    <label className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-700 px-3 py-2 text-xs text-gray-400 cursor-pointer hover:border-purple-500 hover:text-white transition-colors">
                      {posterUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                      {posterUploading ? 'Envoi…' : 'Ma photo'}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={posterUploading}
                        data-poster-upload
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (!file) return;
                          setPosterUploading(true);
                          setPhotosError(null);
                          try {
                            // Passe par le stockage : un data URL ferait
                            // exploser le quota localStorage du brouillon.
                            const envoye = await uploadPosterFile(file);
                            if (!envoye.url) {
                              setPhotosError(`Photo non ajoutée : ${envoye.reason || 'envoi impossible'}`);
                              return;
                            }
                            const perso: PosterPhoto = {
                              id: `perso-${file.name}`,
                              url: envoye.url,
                              small: envoye.url,
                              photographer: 'Ma photo',
                              source: 'upload',
                            };
                            setPosterPhotos((prev) => [perso, ...prev]);
                            applyPhoto(envoye.url);
                            if (envoye.dataUrl) {
                              setPhotosError(
                                'Photo utilisée localement : l’envoi au stockage a échoué, elle ne survivra pas au rechargement.',
                              );
                            }
                          } finally {
                            setPosterUploading(false);
                          }
                        }}
                      />
                    </label>

                    {/* Recapitulatif : qui a son fond, qui herite. */}
                    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-3 space-y-1.5">
                      <p className="text-[11px] uppercase tracking-wide text-gray-500">
                        Fond par séquence
                      </p>
                      {([
                        { cle: 'titre', label: 'Titre', focus: 'intro' },
                        { cle: 'cartes', label: 'Cartes', focus: 'cards' },
                        { cle: 'video', label: 'Vidéo', focus: 'video' },
                        { cle: 'cta', label: 'CTA', focus: 'cta' },
                      ] as const).map((seq) => {
                        const propre = seqBackgrounds[seq.cle];
                        return (
                          <div key={seq.cle} className="flex items-center gap-2" data-seq-bg={seq.cle}>
                            <button
                              type="button"
                              onClick={() => setPreviewFocus(seq.focus)}
                              data-seq-bg-focus={seq.cle}
                              className={`w-16 text-left text-xs transition-colors ${
                                previewFocus === seq.focus ? 'text-white' : 'text-gray-400 hover:text-white'
                              }`}
                            >
                              {seq.label}
                            </button>
                            {propre ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={propre.url} alt="" className="h-7 w-7 rounded object-cover" />
                            ) : (
                              <span className="h-7 w-7 rounded border border-dashed border-gray-700" />
                            )}
                            <span className="flex-1 truncate text-[11px] text-gray-500">
                              {propre ? 'Fond propre' : 'Hérite de l’affiche'}
                            </span>
                            {propre && (
                              <button
                                type="button"
                                onClick={() => resetSeqBackground(seq.cle)}
                                data-seq-bg-reset={seq.cle}
                                title="Rendre cette séquence à l’affiche globale"
                                className="rounded-lg border border-gray-800 px-2 py-1 text-[11px] text-gray-400 hover:text-white hover:border-gray-700 transition-colors"
                              >
                                Réinitialiser
                              </button>
                            )}
                          </div>
                        );
                      })}
                      <p className="text-[11px] text-gray-600">
                        {seqCible
                          ? `Les photos choisies s’appliquent à la séquence « ${previewFocus === 'intro' ? 'Titre' : previewFocus === 'cards' ? 'Cartes' : previewFocus === 'video' ? 'Vidéo' : 'CTA'} ». Glissez-en une dans l’aperçu.`
                          : 'Onglet « Tout » : les photos choisies deviennent l’affiche globale.'}
                      </p>
                    </div>

                    {fondAffiche.url && (
                      <button
                        type="button"
                        onClick={() => setCropping((v) => !v)}
                        data-poster-crop
                        className={`w-full flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                          cropping
                            ? 'border-purple-500 text-white'
                            : 'border-gray-800 text-gray-400 hover:text-white hover:border-gray-700'
                        }`}
                      >
                        <Crop className="w-3.5 h-3.5" />
                        {cropping ? 'Terminer le recadrage' : 'Recadrer'}
                      </button>
                    )}
                    {cropping && (
                      <p className="text-xs text-gray-500">
                        Glissez la photo pour la repositionner, tirez un coin pour zoomer.
                        {fondAffiche.transform.scale > 1 && ` Zoom ${fondAffiche.transform.scale.toFixed(1)}×.`}
                        {' '}
                        <button
                          type="button"
                          onClick={() => applyTransform(() => POSTER_TRANSFORM_NEUTRAL)}
                          data-poster-crop-reset
                          className="underline underline-offset-2 hover:text-white transition-colors"
                        >
                          Rétablir le cadrage d’origine
                        </button>
                      </p>
                    )}
                    {posterUrl && (
                      <button
                        type="button"
                        onClick={() => setPosterUrl(null)}
                        className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-gray-800 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:border-gray-700 transition-colors"
                      >
                        <ImagePlus className="w-3.5 h-3.5" />
                        Revenir au fond dégradé
                      </button>
                    )}

                    {/* ── OUTILS IA ────────────────────────────────────────
                        Ils travaillent sur le fond EFFECTIF — celui de la
                        séquence affichée, ou l'affiche globale sur « Tout ».
                        Le résultat repart par `applyPhoto`, donc au même
                        endroit : traiter le fond du Titre et voir l'affiche
                        globale changer serait incompréhensible. */}
                    <div className="pt-1 border-t border-gray-800/60 space-y-2">
                      <p className="text-xs font-medium text-gray-300">Retouche IA</p>
                      <p className="text-xs text-gray-500">
                        Le résultat remplace {seqBgKeyForFocus(previewFocus)
                          ? 'le fond de la séquence affichée'
                          : 'l’affiche globale'} et reste recadrable.
                      </p>
                      <AiImageTools
                        imageUrl={fondAffiche.url}
                        onImageResult={(url) => {
                          applyPhoto(url);
                          setError(null);
                        }}
                        showToast={(msg, type) => {
                          if (type === 'error') { setAiNotice(null); setError(msg); }
                          else { setError(null); setAiNotice(msg); }
                        }}
                      />
                      {aiNotice && (
                        <p className="text-xs text-emerald-400">{aiNotice}</p>
                      )}
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

                <StyleSection
                  id="transition"
                  title="Transition"
                  hint={TRANSITION_LABELS[transition]}
                  open={openSection === 'transition'}
                  onToggle={toggleSection}
                >
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        Entre chaque séquence
                      </label>
                      <p className="text-xs text-gray-500 mb-2">
                        Un seul style pour tout le montage.
                      </p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {/* La liste vient du compositeur : recopiée ici, elle
                            proposerait un jour un style qu'il ne sait plus
                            jouer — ou tairait ceux qu'il a gagnés. */}
                        {TRANSITION_KEYS.map((style) => {
                          const choisi = style === transition;
                          return (
                            <button
                              key={style}
                              type="button"
                              onClick={() => setTransition(style)}
                              aria-pressed={choisi}
                              data-transition={style}
                              className={`rounded-lg px-2.5 py-2 text-[11px] font-medium transition text-left ${
                                choisi
                                  ? 'bg-gray-800 text-white ring-1 ring-purple-500/40'
                                  : 'bg-gray-900 text-gray-400 hover:text-white hover:bg-gray-800/60'
                              }`}
                            >
                              {TRANSITION_LABELS[style]}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        {TRANSITION_HINTS[transition]}
                      </p>
                    </div>
                </StyleSection>

                <StyleSection
                  id="animation"
                  title="Animation du texte"
                  hint={TEXT_ANIMATION_LABELS[textAnimation]}
                  open={openSection === 'animation'}
                  onToggle={toggleSection}
                >
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        Apparition du texte
                      </label>
                      <p className="text-xs text-gray-500 mb-2">
                        Jouée au début de chaque séquence. Visible à l&apos;export, pas dans
                        l&apos;aperçu.
                      </p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {TEXT_ANIMATION_KEYS.map((style) => {
                          const choisi = style === textAnimation;
                          return (
                            <button
                              key={style}
                              type="button"
                              onClick={() => setTextAnimation(style)}
                              aria-pressed={choisi}
                              data-text-animation={style}
                              className={`rounded-lg px-2.5 py-2 text-[11px] font-medium transition text-left ${
                                choisi
                                  ? 'bg-gray-800 text-white ring-1 ring-purple-500/40'
                                  : 'bg-gray-900 text-gray-400 hover:text-white hover:bg-gray-800/60'
                              }`}
                            >
                              {TEXT_ANIMATION_LABELS[style]}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        {TEXT_ANIMATION_HINTS[textAnimation]}
                      </p>
                      {textAnimation === 'typewriter' && (
                        <p className="text-xs text-amber-400 mt-1.5">
                          Les cartes sont photographiées : elles apparaissent d’un bloc, sans
                          frappe lettre par lettre.
                        </p>
                      )}
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

                {/* ── VOIX PAR SÉQUENCE ────────────────────────────────────
                    Chaque séquence a son texte et sa voix, et sa durée se cale
                    sur celle de son audio. Ici et non à l'étape Audio : les
                    textes sont pré-remplis depuis le contenu, qui n'existe pas
                    encore à ce moment-là du parcours. */}
                {!generating && generated && (
                  <SequenceVoicesPanel
                    sequenceVoices={sequenceVoices}
                    userEdited={sequenceVoicesUserEdited}
                    onChange={(key, patch) => {
                      setSequenceVoices((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
                    }}
                    onUserEditedChange={(key, edited) => {
                      setSequenceVoicesUserEdited((prev) => ({ ...prev, [key]: edited }));
                    }}
                    onResetText={(key) => {
                      // Le drapeau retombe → le pré-remplissage réécrit le
                      // texte depuis le contenu courant.
                      setSequenceVoicesUserEdited((prev) => ({ ...prev, [key]: false }));
                    }}
                    introDuration={introDuration}
                    cardsDuration={cardsDuration}
                    videoDuration={videoDuration}
                    ctaDuration={ctaDuration}
                    hasCardsContent={generated.cards.length > 0}
                    hasVideoOverlay={!!rushUrl}
                    batchCount={batchCount}
                    onAudioError={(msg) => setError(msg)}
                  />
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
                        {batchCount > 1 ? 'Les vidéos sont composées' : 'La vidéo est composée'}{' '}
                        maintenant, exactement telle que l&apos;aperçu l&apos;affiche, puis
                        enregistrée{batchCount > 1 ? 's' : ''} en brouillon.{' '}
                        <span className="text-gray-300">
                          {batchCost(format === '9:16' ? COST.reel : COST.tv, batchCount)} crédits
                        </span>{' '}
                        seront débités une fois le rendu terminé.
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-2">Combien de vidéos ?</label>
                      <div className="flex flex-wrap gap-1.5">
                        {Array.from({ length: MAX_BATCH }, (_, i) => i + 1).map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setBatchCount(n)}
                            data-batch-count={n}
                            className={`w-9 h-9 rounded-lg border text-sm transition-colors ${
                              batchCount === n
                                ? 'border-purple-500 text-white'
                                : 'border-gray-800 text-gray-400 hover:text-white hover:border-gray-700'
                            }`}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                      {batchCount > 1 && (
                        <p className="mt-2 text-xs text-gray-500">
                          Chaque vidéo reçoit un angle différent et sa propre date, un jour après
                          l’autre. La première garde le contenu affiché ci-contre.
                          {batchPhotoUrls.length > 0
                            ? ` ${batchPhotoUrls.length} affiche${batchPhotoUrls.length > 1 ? 's' : ''} retenue${batchPhotoUrls.length > 1 ? 's' : ''}, reprise${batchPhotoUrls.length > 1 ? 's' : ''} en boucle si besoin.`
                            : ' Choisissez plusieurs photos dans « Photo d’affiche » pour les varier.'}
                        </p>
                      )}
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

                    {/* ── TÉLÉCHARGER SUR L'ORDINATEUR ────────────────────
                        Rendu local : aucun post n'est créé. Les crédits sont
                        débités comme pour le Calendrier — c'est le même
                        rendu, au même coût. */}
                    <button
                      type="button"
                      onClick={() => runRender('bureau')}
                      disabled={sending}
                      data-export-bureau
                      title="Composer le montage et l’enregistrer sur votre ordinateur, sans créer de post"
                      className="w-full flex items-center justify-center gap-2 rounded-lg border border-gray-800 px-3 py-2 text-xs text-gray-300 hover:text-white hover:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      {batchCount > 1
                        ? `Télécharger les ${batchCount} vidéos (.zip)`
                        : 'Télécharger la vidéo'}
                    </button>

                    <div className="flex justify-between pt-2">
                      <Button variant="ghost" size="sm" onClick={() => setStep(S.contenu)}>
                        <span className="flex items-center gap-2">
                          <ArrowLeft className="w-4 h-4" /> Retour
                        </span>
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => runRender('calendrier')}
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
                              <CalendarPlus className="w-4 h-4" />{' '}
                              {batchCount > 1 ? `Composer et envoyer ${batchCount} vidéos` : 'Composer et envoyer'}
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
                        {batchProgress && batchProgress.total > 1 && (
                          <p className="text-center text-xs text-gray-400">
                            Vidéo {batchProgress.done + 1} / {batchProgress.total}
                          </p>
                        )}
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
          {...previewShared}
          previewRef={previewRef}
          cardsRef={cardsRef}
          frameRef={frameRef}
          displayScale={displayScale}
          onDragStart={startDrag}
          onDragMove={moveDrag}
          onDragEnd={endDrag}
          dragging={dragging}
          onCardDragStart={startCardDrag}
          draggingCard={draggingCard}
          onClearSelection={clearSelection}
          cropping={cropping}
          onPosterPanStart={startPosterPan}
          onPosterZoomStart={startPosterZoom}
          onPhotoDrop={(url) => { setPhotoDragging(false); applyPhoto(url); }}
          photoDragging={photoDragging}
          guides={dragGuides}
          distanceBadges={dragBadges}
          onElementDragStart={startElementDrag}
          onElementResizeStart={startElementResize}
          onElementDelete={deleteElement}
          onFocusChange={setPreviewFocus}
        />

        {/* ── APERÇU AGRANDI ──────────────────────────────────────────
            Le même aperçu dans une fenêtre qu'on déplace et redimensionne. */}
        {/* ── VOIR LE VRAI RENDU ──────────────────────────────────────
            L'onglet « Tout » est une image figée : ni animations, ni
            transitions. Ce bouton compose la vraie vidéo et la joue. */}
        {generated && (
          <button
            type="button"
            onClick={() => runRender('apercu')}
            disabled={sending}
            data-play-rendu
            title="Composer la vidéo et la regarder — animations et transitions comprises"
            className="mt-2 w-full flex items-center justify-center gap-2 rounded-lg border border-purple-500/40 bg-purple-600/15 px-3 py-1.5 text-xs text-purple-100 hover:bg-purple-600/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {sending ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Rendu…</>
            ) : (
              <><Play className="w-3.5 h-3.5" /> Voir le rendu</>
            )}
          </button>
        )}

        {/* Lecteur du montage rendu — superposé à l'aperçu. */}
        {previewUrl && (
          <div className="mt-2 rounded-xl border border-gray-800 bg-black p-2 space-y-2" data-play-lecteur>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              src={previewUrl}
              controls
              autoPlay
              playsInline
              className="w-full rounded-lg"
              style={{ maxHeight: '60vh' }}
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-gray-500">
                Ce montage sera réutilisé à l’envoi tant que rien ne change —
                un seul rendu débité.
              </span>
              <button
                type="button"
                onClick={() => setPreviewRender(null, null)}
                className="rounded-lg border border-gray-800 px-2 py-1 text-[11px] text-gray-400 hover:text-white transition-colors"
              >
                Fermer
              </button>
            </div>
          </div>
        )}

        {generated && (
          <button
            type="button"
            onClick={() => setEnlargedOpen((v) => !v)}
            title="Ouvrir l’aperçu dans une fenêtre déplaçable et redimensionnable"
            aria-pressed={enlargedOpen}
            className={`mt-2 w-full flex items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
              enlargedOpen
                ? 'border-purple-500/40 bg-gray-800 text-white'
                : 'border-gray-800 text-gray-300 hover:text-white hover:border-gray-700'
            }`}
          >
            <Maximize2 className="w-3.5 h-3.5" />
            {enlargedOpen ? 'Fermer la fenêtre' : 'Agrandir'}
          </button>
        )}

        <FloatingPanel
          title="Aperçu"
          isOpen={enlargedOpen && !!generated}
          onClose={() => setEnlargedOpen(false)}
          initialX={enlargedGeometry.x}
          initialY={enlargedGeometry.y}
          initialWidth={enlargedGeometry.w}
          initialHeight={enlargedGeometry.h}
          resizable
          // Elle reste ouverte pendant qu'on regle les couleurs, les cartes ou
          // les fonds a gauche : c'est tout son interet.
          closeOnClickOutside={false}
          onGeometryChange={rememberEnlargedGeometry}
          accentColor={accent}
        >
          <div ref={enlargedBodyRef} className="h-full w-full flex items-start justify-center">
            <div style={{ width: enlargedWidth || '100%' }}>
              <Preview
                {...previewShared}
                hideHeader
                frameRef={enlargedFrameRef}
                displayScale={enlargedScale}
                onFocusChange={setPreviewFocus}
              />
            </div>
          </div>
        </FloatingPanel>
        {/* ── AFFICHE ─────────────────────────────────────────────────
            Telechargement local de l'apercu tel qu'il est affiche. Ni credit,
            ni post : un `<a download>` sur un blob. */}
        {generated && (
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => downloadPoster('png')}
              disabled={posterExporting}
              title="Enregistrer l’aperçu affiché en image, sans débiter de crédit"
              className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:text-white hover:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {posterExporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ImageDown className="w-3.5 h-3.5" />
              )}
              {posterExporting ? 'Capture…' : 'Télécharger l’affiche'}
            </button>
            <button
              type="button"
              onClick={() => downloadPoster('jpeg')}
              disabled={posterExporting}
              title="Même image, au format JPG"
              className="rounded-lg border border-gray-800 px-2.5 py-1.5 text-xs text-gray-500 hover:text-white hover:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              JPG
            </button>
          </div>
        )}

        {/* ── BIBLIOTHEQUE D'ELEMENTS ─────────────────────────────────
            Sous l'apercu : c'est la qu'on voit ou l'element se pose.

            Sur TOUS les onglets, et non les seuls « Cartes » et « Tout » : un
            element se pose n'importe ou sur le plateau et le compositeur le
            peint sur les quatre sequences. Le reserver a l'onglet des cartes
            rendait la bibliotheque introuvable pour qui reglait son titre ou
            son CTA. */}
        {generated && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setElementPickerOpen((v) => !v)}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:text-white hover:border-gray-700 transition-colors"
            >
              <Shapes className="w-3.5 h-3.5" />
              {elementPickerOpen ? 'Masquer les éléments' : 'Ajouter un élément'}
            </button>
            {elementPickerOpen && (
              <div className="mt-2 rounded-xl border border-gray-800 bg-gray-900/50 p-3">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="text"
                    value={elementQuery}
                    onChange={(e) => setElementQuery(e.target.value)}
                    placeholder="Rechercher une icône…"
                    className="w-full rounded-lg bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none pl-8 pr-2.5 py-2 text-sm"
                  />
                </div>
                <div className="mt-3 max-h-64 overflow-y-auto space-y-3">
                  {Object.entries(ICON_LIBRARY).map(([categorie, noms]) => {
                    // Une categorie dont aucune icone ne correspond disparait :
                    // laisser un titre seul ferait croire a un panneau casse.
                    const retenues = noms.filter((n) => iconMatches(n, elementQuery));
                    if (retenues.length === 0) return null;
                    return (
                      <div key={categorie}>
                        <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1.5">
                          {categorie}
                        </p>
                        <div className="grid grid-cols-8 gap-1">
                          {retenues.map((nom) => (
                            <button
                              key={nom}
                              type="button"
                              onClick={() => addElement(nom)}
                              data-element-pick={nom}
                              title={nom}
                              className="flex items-center justify-center rounded-lg border border-gray-800 py-2 text-gray-300 hover:text-white hover:border-purple-500 transition-colors"
                            >
                              <CardIcon name={nom} size={16} color="currentColor" className="" />
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {Object.values(ICON_LIBRARY).flat().every((n) => !iconMatches(n, elementQuery)) && (
                    <p className="text-xs text-gray-500 text-center py-4">Aucune icône pour « {elementQuery} ».</p>
                  )}
                </div>
              </div>
            )}
            {freeElements.length > 0 && (
              <p className="mt-2 text-center text-xs text-gray-400">
                {freeElements.length} élément{freeElements.length > 1 ? 's' : ''} posé
                {freeElements.length > 1 ? 's' : ''}
                <span className="text-gray-600"> — cliquer pour sélectionner, glisser pour déplacer</span>
              </p>
            )}
          </div>
        )}
        {selectedCards.size > 0 && cardsVisible && (
          <div className="mt-2 flex flex-col items-center gap-1.5">
            <p className="text-center text-xs text-gray-400">
              {selectedCards.size} carte{selectedCards.size > 1 ? 's' : ''} sélectionnée
              {selectedCards.size > 1 ? 's' : ''}
              <span className="text-gray-600"> — Maj+clic pour en ajouter, Échap pour désélectionner</span>
            </p>
            <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={duplicateSelection}
              disabled={(generated?.cards.length ?? 0) >= limiteCartes}
              // Un bouton grise sans raison est une impasse : la limite vient
              // du compositeur, elle merite d'etre dite.
              title={
                (generated?.cards.length ?? 0) >= limiteCartes
                  ? `Maximum de ${limiteCartes} cartes dans ce format`
                  : 'Dupliquer la sélection'
              }
              className="flex items-center gap-1.5 rounded-lg border border-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:text-white hover:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
              Dupliquer
            </button>
            {selectionGrouped ? (
              <button
                type="button"
                onClick={ungroupSelection}
                title="Séparer les cartes de leur groupe"
                className="flex items-center gap-1.5 rounded-lg border border-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:text-white hover:border-gray-700 transition-colors"
              >
                <Ungroup className="w-3.5 h-3.5" />
                Dégrouper
              </button>
            ) : (
              <button
                type="button"
                onClick={groupSelection}
                disabled={selectedCards.size < MIN_GROUP}
                // Grise sans raison, on ne sait pas quoi faire de plus.
                title={
                  selectedCards.size < MIN_GROUP
                    ? 'Sélectionnez au moins deux cartes'
                    : 'Les déplacer ensemble'
                }
                className="flex items-center gap-1.5 rounded-lg border border-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:text-white hover:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Combine className="w-3.5 h-3.5" />
                Grouper
              </button>
            )}
            </div>
            {duplicateNotice && (
              <p className="text-center text-xs text-gray-500">{duplicateNotice}</p>
            )}
          </div>
        )}
        {layoutDropped && (
          <p className="mt-2 text-center text-xs text-gray-500">
            Disposition des cartes réinitialisée : le contenu ou le format a changé.
          </p>
        )}
        {layoutTouched && (
          <button
            type="button"
            onClick={resetLayout}
            className="mt-2 w-full flex items-center justify-center gap-2 text-xs text-gray-400 hover:text-white transition-colors py-2"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Rétablir la disposition d&apos;origine
          </button>
        )}
      </div>

      {/* ── PANNEAU FLOTTANT DE L'ELEMENT ─────────────────────────────
          Les reglages vivaient tout en bas de la colonne : il fallait
          descendre pour changer une couleur, et on perdait l'apercu de vue.
          Ici ils flottent par-dessus, sans pousser la mise en page. */}
      <FloatingPanel
        title="Élément"
        icon="✦"
        isOpen={!!selectedElement}
        onClose={closeElementPanel}
        initialX={panelPos.x}
        initialY={panelPos.y}
        accentColor={accent}
      >
        {selectedElement && (
          <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500 flex-1">
                    Couleur
                  </span>
                  {/* Trois choix en un clic — le nuancier reste dessous pour
                      tout le reste. */}
                  {([
                    { valeur: '#FFFFFF', nom: 'Blanc' },
                    { valeur: '#000000', nom: 'Noir' },
                    { valeur: accent, nom: 'Accent' },
                  ] as const).map((pastille) => (
                    <button
                      key={pastille.nom}
                      type="button"
                      onClick={() => recolorElement(pastille.valeur)}
                      title={pastille.nom}
                      aria-label={pastille.nom}
                      data-element-swatch={pastille.nom}
                      className={`w-5 h-5 rounded-full border transition-colors ${
                        selectedElement.color.toUpperCase() === pastille.valeur.toUpperCase()
                          ? 'border-white'
                          : 'border-gray-700 hover:border-gray-500'
                      }`}
                      style={{ backgroundColor: pastille.valeur }}
                    />
                  ))}
                </div>
                <ColorWheel
                  color={selectedElement.color}
                  onChange={recolorElement}
                  label="Teinte"
                />

                {/* Taille — le meme `sizePct` sert a l'apercu, a l'affiche et
                    a la video : le regler ici suffit. */}
                <div className="mt-3 border-t border-gray-800 pt-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[11px] uppercase tracking-wide text-gray-500 flex-1">
                      Taille
                    </span>
                    <span className="text-[11px] text-gray-500 tabular-nums">
                      {Math.round(selectedElement.sizePct)} %
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => resizeElement(selectedElement.sizePct - ELEMENT_SIZE_STEP)}
                      disabled={selectedElement.sizePct <= ELEMENT_SIZE_MIN}
                      data-element-smaller
                      title="Rétrécir"
                      aria-label="Rétrécir l’élément"
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-800 text-gray-300 hover:text-white hover:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="range"
                      min={ELEMENT_SIZE_MIN}
                      max={ELEMENT_SIZE_MAX}
                      step={1}
                      value={Math.round(selectedElement.sizePct)}
                      onChange={(e) => resizeElement(Number(e.target.value))}
                      data-element-size
                      aria-label="Taille de l’élément"
                      className="flex-1 accent-purple-500"
                    />
                    <button
                      type="button"
                      onClick={() => resizeElement(selectedElement.sizePct + ELEMENT_SIZE_STEP)}
                      disabled={selectedElement.sizePct >= ELEMENT_SIZE_MAX}
                      data-element-bigger
                      title="Agrandir"
                      aria-label="Agrandir l’élément"
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-800 text-gray-300 hover:text-white hover:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
          </div>
        )}
      </FloatingPanel>

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
