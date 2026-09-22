'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { flushSync } from 'react-dom';
import { useSearchParams } from 'next/navigation';
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
  Crosshair,
  Grid3x3,
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
  FolderOpen,
  Crop,
  Maximize2,
  Play,
  Info,
  MousePointerClick,
  X,
} from 'lucide-react';
import { generateSmartContent } from '@/lib/smart-content';
import {
  composeVideo, downloadBlob, CURRENT_COMPOSER_VERSION, posterTransformActive,
  type ComposerOptions,
  TRANSITION_KEYS, TRANSITION_LABELS, DEFAULT_TRANSITION, type TransitionStyle,
  TEXT_ANIMATION_KEYS, TEXT_ANIMATION_LABELS, TEXT_ANIMATION_HINTS,
  DEFAULT_TEXT_ANIMATION, type TextAnimation,
} from '@/lib/video-composer';
import { AudioStudioPanel } from '@/components/creer/AudioStudioPanel';
import { SequenceVoicesPanel } from '@/components/creer/SequenceVoicesPanel';
import BriefVideo, { NarrationRecap } from '@/components/creer/BriefVideo';
import { sanitizeBrief, briefRempli, type VideoBrief } from '@/lib/creer/brief';
import { voiceSequenceSeconds } from '@/lib/creer/voiceFit';
import {
  SEQUENCE_KEYS, emptySequenceVoices, emptySequenceVoicesUserEdited, buildAutoFillText,
  type SequenceVoices, type SequenceVoicesUserEdited, type SequenceKey,
} from '@/lib/types/voice';
import type { AudioKeyframe } from '@/lib/creer/audioDucking';
import { pointToPct, grabOffset, clampToBox, type Pos, type BoxPct, type CardBox, boxesFromRects, samePos } from '@/lib/creer/dragPosition';
import {
  snapPosition, computeGapBadges, collectGuideBoxes, shiftBox, boxCenter, sameGaps,
  sameGuides, sameBox, mergeGuides, onePerAxis, computeAlignmentLines,
  anchorToCenter, centerToAnchor,
  type ActiveGuide, type GapBadge, type ElementBox, type ElementPos, type Anchor,
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
import AfficheIA from '@/components/creer/AfficheIA';
import AutopilotPanel from '@/components/creer/AutopilotPanel';
import VideosPretes from '@/components/creer/VideosPretes';
import { buildAutopilotSample, samplePosterVisible } from '@/lib/autopilot/sample';
// ⚠️ DEPUIS `brand.ts`, PAS `design.ts`. Ce dernier entraîne toute la chaîne
// serveur de l'Autopilote (`voice` → `storage/upload` → `minio`) dans le
// paquet du navigateur, et le build échoue sur « Can't resolve 'fs/promises' ».
import { AUTOPILOT_WATERMARK, AUTOPILOT_GRADIENT_OPACITY } from '@/lib/autopilot/brand';
import { DEFAULT_CONFIG as AUTOPILOT_DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';
import {
  SCALE_MIN, SCALE_MAX, LETTER_SPACING_MIN, LETTER_SPACING_MAX,
  LINE_HEIGHT_MIN, LINE_HEIGHT_MAX,
  type AutopilotDesignStyle, type AutopilotTextZone,
} from '@/lib/autopilot/textStyle';
import TextFormatToolbar from '@/components/creer/TextFormatToolbar';
import { DEFAULT_TEXT_CASE, type TextCase, type TextAlign } from '@/lib/creer/textFormat';
import { CARD_STYLES, DEFAULT_CARD_STYLE } from '@/lib/creer/cardStyles';
import { useFrameScale } from '@/lib/hooks/useFrameScale';
import SequenceCards, { type CardsTypography } from '@/components/creer/SequenceCards';
import SequenceTitle, { titleFrameStyle } from '@/components/creer/SequenceTitle';
import SequenceCta, { ctaFrameStyle } from '@/components/creer/SequenceCta';
import FreeElementsLayer, { type FreeElement } from '@/components/creer/FreeElementsLayer';
import TextAnimationLayer from '@/components/creer/TextAnimationLayer';
import TransitionMiniPreview from '@/components/creer/TransitionMiniPreview';
import TextAnimationMiniPreview from '@/components/creer/TextAnimationMiniPreview';
import SequencePlayback, { type PlaybackRequest } from '@/components/creer/SequencePlayback';
import { transitionExtract, textAnimationExtract, type PlaybackExtract } from '@/lib/creer/transitionPreview';
import { INTRO_WINDOW } from '@/lib/creer/textAnimation';
import { usePrefersReducedMotion } from '@/lib/hooks/usePrefersReducedMotion';
import { useOptionPreview } from '@/lib/hooks/useOptionPreview';
import { DEFAULT_SEQUENCE_SECONDS, RUSH_SEQUENCE_SECONDS } from '@/lib/creer/designSpec';
import { THEMES as SHARED_THEMES, themeLabel } from '@/lib/themes';
import { renderSignature, signatureMatches } from '@/lib/creer/renderSignature';

import {
  sanitizePhotos, vignetteAffichable, photoUtilisable, urlUtilisable,
} from '@/lib/creer/posterPhotos';
import ClipDetectorModal, { type ClipSource } from '@/components/media/ClipDetectorModal';
import { CardIcon } from '@/components/ui/CardIcon';
import IconPicker from '@/components/creer/IconPicker';
import ColorWheel from '@/components/ui/ColorWheel';
import FloatingPanel from '@/components/ui/FloatingPanel';
import { uploadPosterFile } from '@/lib/creer/posterUpload';
import {
  importLutFile, decodeImageInBrowser, envoyerLutApi, listerLutsApi, LUT_ACCEPT,
} from '@/lib/luts/import';
import { supportDeLut, LIBELLES_SUPPORT } from '@/lib/luts/support';
import type { Lut, LutRef } from '@/lib/luts/types';
import {
  batchCost, distinctPhotoForIndex, distinctUrls,
  autoAssignPhotos, batchPhotosReady, photosToFetch, batchDates, batchTopic, variationNonce,
} from '@/lib/creer/batch';
import {
  batchRunId, batchItemId, initialBatchItems, setItemState, batchSummary,
  batchPartiel, repriseAutorisee, titreInterruption, messageInterruption,
  bilanSerie, type BatchItem,
} from '@/lib/creer/batchRun';
import {
  BATCH_SERIE_DISPONIBLE, BATCH_SERIE_BADGE, BATCH_SERIE_EXPLICATION,
  BATCH_SERIE_REFUS, BATCH_SERIE_MAX, batchCountAutorise, lotRefuse,
  nombresProposes,
} from '@/lib/creer/batchDisponible';
import { useVerrous, VERROU } from '@/lib/creer/verrouAction';
import {
  etatDepuisReponse, messagePhotos, reessayable, type EtatPhotos,
} from '@/lib/creer/photosEtat';
import {
  annonceCout, tarifsAffichables, libelleNombre, type Tarifs,
} from '@/lib/facturation/annonce';
import { rendreEtFacturer, messagePour } from '@/lib/rendus/client';
import { composerEtFacturer, televerserVignette } from '@/lib/rendus/composer';
// Catalogue de polices — LA source unique, partagee avec le compositeur.
// Deux listes finiraient par diverger, et la video ne ressemblerait plus a
// l'apercu.
import { FONT_GROUPS, fontStack, ensureFontLoaded, preloadCatalogPreview } from '@/lib/fonts/catalog';
import { useSession } from 'next-auth/react';
import type { Politique } from '@/lib/facturation/politique';
import {
  politiqueAffichable, MENTION_AUCUN_CREDIT,
} from '@/lib/facturation/libelles';
import JumeauPanel from '@/components/creer/JumeauPanel';
import { gardeJumeauAvantRendu, genererEtAttendreVideoJumeau, attendreStatutJumeau, type JumeauMode } from '@/lib/creer/jumeau';
import { AVATAR_VIDEO_COST } from '@/lib/stripe/constants';
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
import {
  chargerPostAModifier,
  type ChargementPost,
  type PostAModifier,
} from '@/lib/creer/loadPost';
import { readEditTargetFromQuery } from '@/lib/creer/editTarget';
import { toWizardDraft } from '@/lib/creer/postMetadata/to-wizard';
import {
  indexerCartesOrigine, cartesPourEnregistrement,
} from '@/lib/creer/postMetadata/cartes';
import {
  metadataPourEnregistrement, type ValeursWizard,
} from '@/lib/creer/postMetadata/from-wizard';
import { enregistrerModification, type Enregistrement } from '@/lib/creer/savePost';
import { useBranding, NEUTRAL_BRANDING } from '@/lib/hooks/useBranding';
import { useEtatReseaux } from '@/lib/hooks/useEtatReseaux';
import { RESEAUX, libelleCalendrier, type Reseau } from '@/lib/social/etatReseaux';
import { classesCarteOption, classesOnglet } from '@/lib/ui/etats';
import { preRenderCardIcons } from '@/lib/icons/prerender';
import { Card, CardTitle, CardContent } from '@/components/ui/Card';
import DeuxColonnes, { ColonneTravail, ColonneApercu } from '@/components/ux/DeuxColonnes';
import { ratioEnVariables } from '@/components/ux/ZoneApercu';
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
// La liste vit dans `@/lib/themes` : l'Autopilote propose EXACTEMENT les
// memes thèmes, et deux copies auraient fini par diverger.
const THEMES = SHARED_THEMES;

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
// Durées par défaut : partagées avec l'Autopilote, qui compose sans écran et
// doit produire le même montage qu'un assistant ouvert sans rien régler.
const SEQ = DEFAULT_SEQUENCE_SECONDS;

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
const RUSH_SECONDS = RUSH_SEQUENCE_SECONDS;

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

type Sequences = Array<{ key: SeqKey; enabled: boolean }>;

/** Ordre effectif : sequences activees, dans l'ordre choisi. */
const ordreActif = (seqs: Sequences): SeqKey[] => seqs.filter((s) => s.enabled).map((s) => s.key);

/**
 * Duree effective d'une sequence : 0 si elle est desactivee.
 *
 * Une sequence masquee a une duree NULLE — c'est ainsi que le compositeur
 * l'exclut, et que le Calendrier la filtre (`dur > 0`). Passer par ce seul
 * point evite que l'apercu, la video et le Calendrier divergent.
 *
 * Fonction pure, et non une lecture directe de l'etat : le rendu la
 * reapplique a un plateau LOCAL quand le jumeau vient de poser son rush
 * (voir `runRenderInterne`), sans attendre qu'un `setState` soit relu.
 */
const dureeDeSequence = (ordre: SeqKey[], durees: Record<SeqKey, number>) => (k: SeqKey): number =>
  (ordre.includes(k) ? durees[k] : 0);

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
 * Nouvelle attribution automatique des affiches du lot, a partir de resultats
 * de recherche FRAIS.
 *
 * Regle, la plus simple qui ne degrade jamais un lot pret :
 *
 *   1. Si les resultats fournissent a eux seuls `count` affiches distinctes,
 *      ils REMPLACENT le lot — c'est le sens d'une nouvelle recherche ou du
 *      bouton « Autres photos ».
 *   2. Sinon, ils COMPLETENT le lot existant : les affiches deja retenues
 *      gardent leur rang, les manquantes sont prises dans les resultats,
 *      toujours sans doublon et jamais au-dela de `count`.
 *
 * Un lot pret le reste donc quoi que rende la recherche ; un lot incomplet
 * ne peut que gagner des affiches. Aucune image n'est jamais reutilisee pour
 * atteindre le nombre : `autoAssignPhotos` dedoublonne, et l'envoi refuse un
 * lot incomplet plutot que de recycler.
 */
export function reattribuerAffichesAuto(
  existantes: string[],
  candidates: Array<string | undefined | null>,
  count: number,
): string[] {
  const fraiches = autoAssignPhotos(candidates, count);
  if (batchPhotosReady(fraiches, count)) return fraiches;
  return autoAssignPhotos([...(existantes || []), ...candidates], count);
}

/**
 * Refus d'un lot sans une affiche distincte par video — dit ce qu'il FAUT
 * faire, selon le mode.
 *
 * En automatique, « repassez en mode automatique » n'aurait aucun sens : les
 * affiches viennent de la recherche, c'est elle qu'il faut relancer. En
 * manuel, c'est a l'utilisateur de completer — ou de laisser l'automatique
 * le faire.
 */
export function messageAffichesManquantes(
  mode: 'auto' | 'manuel',
  retenues: number,
  total: number,
): string {
  return mode === 'auto'
    ? `Recherchez d’autres photos pour obtenir ${total} affiches distinctes (${retenues} sur ${total}).`
    : `Choisissez autant de photos que de vidéos (${retenues} sur ${total}), ou repassez en mode automatique.`;
}

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
/**
 * Formatage commun aux trois zones — souligne, barre, casse, alignement.
 *
 * ⚠️ TOUS OPTIONNELS, ET C'EST CE QUI PORTE LA RETRO-COMPATIBILITE. Absents,
 * les deux moteurs retombent sur leur rendu d'avant : capitales pour le titre
 * et le CTA, aucune decoration, alignement historique.
 */
// ⚠️ `type` ET NON `interface`. Ces styles sont ranges dans le brouillon,
// type `Record<string, unknown>` : TypeScript n'accorde une signature d'index
// IMPLICITE qu'aux alias de type, jamais aux interfaces. En interface, la
// simple intersection cassait l'enregistrement du brouillon.
type TextFormatFields = {
  textCase?: TextCase;
  align?: TextAlign;
  underline?: boolean;
  strike?: boolean;
};

interface TextStyles {
  title: {
    font: string;
    color: string;
    scale: number;
    bold: boolean;
    italic: boolean;
    letterSpacing: number;
    lineHeight: number;
  } & TextFormatFields;
  /**
   * Sous-titre. `null` = « suit le titre » — c'est ce que fait le
   * compositeur en l'absence de champ, donc l'etat par defaut ne transmet
   * rien et le rendu ne change pas.
   */
  subtitle: {
    font: string | null;
    color: string | null;
    scale: number;
  } & TextFormatFields;
  cta: {
    font: string;
    color: string;
    subColor: string;
    scale: number;
    bold: boolean;
    italic: boolean;
    letterSpacing: number;
    lineHeight: number;
  } & TextFormatFields;
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

/** Libelle de chaque zone reglable — l'ordre du montage. */
const ZONE_LABELS: Record<'title' | 'subtitle' | 'cta' | 'cards', string> = {
  title: 'Titre',
  subtitle: 'Sous-titre',
  cards: 'Cartes',
  cta: 'CTA',
};

const STEPS = ['Sujet', 'Style', 'Audio', 'Contenu', 'Envoi'] as const;

/**
 * Le fuseau dans lequel l'utilisateur SAISIT la date et l'heure d'envoi.
 *
 * C'est celui du navigateur : le champ `type="time"` n'en connait pas
 * d'autre. Ecrit dans `metadata.timezone`, il est relu par le cron de
 * publication pour decider qu'un post est du — sans lui, l'heure saisie est
 * lue comme une heure de Paris. Repli sur Paris si `Intl` ne repond pas :
 * exactement ce que le cron ferait de toute facon.
 */
function fuseauNavigateur(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris';
  } catch {
    return 'Europe/Paris';
  }
}

/** Les reseaux tels que l'ecran les nomme — les identifiants restent ceux du cron. */
const LIBELLE_RESEAU: Record<Reseau, string> = {
  instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', youtube: 'YouTube',
};

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

/**
 * Une affiche generee par l'IA n'est appliquee que si son URL est DURABLE :
 * enregistree dans le stockage Studiio par le serveur, jamais l'URL
 * temporaire du fournisseur (Replicate, qui expire en une heure).
 *
 * La regle, sur des valeurs :
 *  - une URL absolue `http(s)` qui se parse ;
 *  - dont l'hote n'est PAS `replicate.delivery` (ni un sous-domaine) ;
 *  - dont le chemin passe par `/storage/v1/object/public/` — le relais
 *    Studiio (`https://studiio.pro/storage/v1/object/public/media/…`) comme
 *    l'ancien chemin public Supabase repondent a cette forme.
 *
 * Une URL relative, `data:`, `blob:` ou `javascript:` est refusee : elle ne
 * survivrait pas au brouillon, ou n'en est pas une.
 */
export function estAfficheDurable(url: string): boolean {
  if (typeof url !== 'string' || !url) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const hote = u.hostname.toLowerCase();
  if (hote === 'replicate.delivery' || hote.endsWith('.replicate.delivery')) return false;
  return u.pathname.includes('/storage/v1/object/public/');
}

/** Sequence mise en avant dans l'apercu, ou `'all'` pour la composition entiere. */
export type PreviewFocus = 'all' | 'intro' | 'cards' | 'video' | 'cta';

/** Classes de désactivation : `Button` n'en fournit aucune (ui/Button.tsx). */
const DISABLED = 'disabled:opacity-40 disabled:cursor-not-allowed';

/**
 * Le parcours ouvert sur l'ecran d'entree, quand l'assistant n'a pas demarre.
 *
 * ⚠️ UX : l'ecran d'entree presentait « Creer avec l'assistant » ET le panneau
 * complet de l'Autopilote (six etapes) l'un sous l'autre : deux parcours,
 * plusieurs boutons violets, et personne ne savait lequel cliquer. Ici, on
 * CHOISIT d'abord ; l'Autopilote ne se deplie qu'a la demande. Le panneau
 * reste monte (masque par `hidden`) : ses reglages, sa configuration chargee
 * et l'apercu de droite ne changent pas.
 *
 * Persiste dans `localStorage` : quelqu'un qui configure l'Autopilote et
 * recharge la page doit le retrouver ouvert, pas revenir au choix.
 */
type ParcoursEntree = 'choix' | 'autopilote';

/**
 * L'en-tete de la page « Creer », selon OU l'on est.
 *
 * ⚠️ UX : « Creer — un parcours guide » restait affiche dans l'Autopilote, et
 * « Changer de parcours » etait un lien gris perdu sous un titre. Ici :
 * un titre et une phrase par mode, et le retour au choix des modes est un
 * VRAI bouton, toujours au meme endroit (a droite de l'en-tete), visible des
 * l'arrivee sur l'ecran, desktop comme mobile.
 */
function CreerEntete({
  mode,
  onRetour,
}: {
  mode: 'choix' | 'assistant' | 'autopilote';
  /** Retour aux deux cartes. Aucun reglage n'est perdu : l'etat reste monte. */
  onRetour: () => void;
}) {
  const texte = {
    choix: { titre: 'Créer du contenu', sous: 'Choisissez comment vous voulez créer.' },
    assistant: { titre: 'Créer une vidéo', sous: 'Une vidéo, étape par étape.' },
    autopilote: { titre: 'Autopilote', sous: 'Configurez une fois, Studiio crée ensuite vos contenus.' },
  }[mode];
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4" data-creer-entete={mode}>
      <div className="flex items-center gap-4 min-w-0">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #EC4899 100%)' }}
        >
          {mode === 'autopilote' ? <Rocket className="w-6 h-6 text-white" /> : <Sparkles className="w-6 h-6 text-white" />}
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{texte.titre}</h1>
          <p className="text-sm text-gray-400">{texte.sous}</p>
        </div>
      </div>
      {mode !== 'choix' && (
        <button
          type="button"
          onClick={onRetour}
          data-creer-retour-choix
          className="inline-flex items-center gap-2 self-start rounded-lg border border-gray-700 bg-gray-900/60 px-3 py-2 text-sm text-gray-200 hover:border-gray-500 hover:text-white transition flex-shrink-0"
        >
          <ArrowLeft className="w-4 h-4" /> Revenir au choix des modes
        </button>
      )}
    </div>
  );
}
const PARCOURS_KEY = 'studiio:creer:parcours';
function lireParcours(): ParcoursEntree {
  try {
    return window.localStorage.getItem(PARCOURS_KEY) === 'autopilote' ? 'autopilote' : 'choix';
  } catch {
    return 'choix';
  }
}
function ecrireParcours(p: ParcoursEntree): void {
  try {
    if (p === 'choix') window.localStorage.removeItem(PARCOURS_KEY);
    else window.localStorage.setItem(PARCOURS_KEY, p);
  } catch {
    /* stockage indisponible : le choix ne survit pas au rechargement, rien de plus */
  }
}

/** Du moins capable au plus capable — pour choisir le statut prudent quand la nature est inconnue. */
const ORDRE_SUPPORT = ['unsupported-render', 'preview-only', 'ready'] as const;

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
type SectionId = 'format' | 'couleurs' | 'affiche' | 'ambiance' | 'texte' | 'sequences' | 'transition' | 'animation';

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

/**
 * Poignees de coin d'un bloc de TEXTE — agrandir le titre ou le CTA.
 *
 * ⚠️ ELLES N'EXISTENT QUE SI `onStart` EST FOURNI. L'assistant manuel n'en
 * passe pas : son ergonomie — un curseur de taille dans le panneau de gauche —
 * ne change pas d'un pixel. L'Autopilote, lui, doit tout regler sur l'apercu
 * pour ne pas allonger sa colonne, d'ou ces poignees.
 *
 * ⚠️ ET ELLES DISPARAISSENT PENDANT LA PHOTO. `capturing` les efface, comme
 * les autres aides d'edition : une poignee gravee dans la video ne se
 * rattrape pas (cf. `tasks/lessons.md`, 2026-05-01).
 */
const TextResizeHandles: React.FC<{
  el: 'title' | 'cta';
  onStart?: (el: 'title' | 'cta', e: React.PointerEvent) => void;
  uiPx: (n: number) => number;
  capturing?: boolean;
  onDragMove?: (e: React.PointerEvent) => void;
  onDragEnd?: () => void;
  /**
   * La poignee est-elle visible ?
   *
   * ⚠️ ELLES ETAIENT PERMANENTES, comme celles des cartes. Un outil
   * d'edition affiche en continu encombre l'apercu qu'il sert a regler.
   */
  visible?: boolean;
}> = ({ el, onStart, uiPx, capturing, visible, onDragMove, onDragEnd }) => {
  if (!onStart || capturing || !visible) return null;
  return (
    <>
      {([
        { coin: 'nw', top: 0, left: 0 },
        { coin: 'ne', top: 0, left: '100%' },
        { coin: 'sw', top: '100%', left: 0 },
        { coin: 'se', top: '100%', left: '100%' },
      ] as const).map((p) => (
        <span
          key={p.coin}
          data-text-handle={`${el}-${p.coin}`}
          onPointerDown={(e) => { e.stopPropagation(); onStart(el, e); }}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          onLostPointerCapture={onDragEnd}
          title="Tirer pour agrandir le texte"
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
    </>
  );
};

/** Tableaux vides STABLES : un litteral par rendu relancerait le calque. */
const EMPTY_GUIDES: ActiveGuide[] = [];
const EMPTY_GAPS: GapBadge[] = [];

/**
 * Ce que le plateau CONTIENT, pour une sequence ou pour la composition.
 *
 * Extrait de `Preview` pour etre rendu DEUX fois par le meme code : par le
 * plateau photographie (composition, aides d'edition) et par les calques de
 * la lecture temporelle (`SequencePlayback`), sequence par sequence, avec
 * l'animation du texte. Une seule ecriture du titre, des cartes, du CTA, des
 * elements et du filigrane — le lecteur ne peut pas montrer autre chose que
 * l'apercu.
 *
 * `textAnimation` / `progress` : absents, `TextAnimationLayer` rend ses
 * enfants SANS enveloppe — le DOM du plateau est alors, noeud pour noeud,
 * celui d'avant l'extraction. `edit` : les poignees et gestes d'edition ;
 * absent, le contenu est inerte (calques de lecture).
 */
function PlateContent({
  generated,
  format,
  focus,
  activeOrder,
  rushUrl = null,
  onRushError,
  text,
  titlePos,
  ctaPos,
  cardBoxes = null,
  cardStyle,
  cardsTypography,
  elements,
  watermark,
  accent,
  gradEnd,
  textAnimation,
  progress = 1,
  edit,
}: {
  generated: Generated;
  format: Format;
  focus: PreviewFocus;
  activeOrder: string[];
  /** Rush A MONTRER (le parent a deja decide), ou `null`. */
  rushUrl?: string | null;
  onRushError?: () => void;
  text: TextStyles;
  titlePos: Pos;
  ctaPos: Pos;
  cardBoxes?: Record<string, CardBox> | null;
  cardStyle?: string;
  cardsTypography?: CardsTypography;
  elements?: FreeElement[];
  watermark?: string;
  accent: string;
  gradEnd: string;
  /** Animation d'apparition du texte — pour les calques de lecture. */
  textAnimation?: TextAnimation;
  /** Avancement de la sequence, de 0 a 1. Defaut 1 : texte entier, aucune enveloppe. */
  progress?: number;
  /** Aides d'edition du plateau. Absent : contenu inerte. */
  edit?: {
    cardsRef?: React.RefObject<HTMLDivElement>;
    onCardDragStart?: (id: string, e: React.PointerEvent) => void;
    onDragMove?: (e: React.PointerEvent) => void;
    onDragEnd?: () => void;
    draggingCard?: string | null;
    selectedCards?: Set<string>;
    groupedCards?: Record<string, string>;
    capturing?: boolean;
    uiPx?: (n: number) => number;
    onCardDoubleClick?: (id: string) => void;
    onCardResizeStart?: (id: string, e: React.PointerEvent) => void;
    onDragStart?: (el: 'title' | 'cta', e: React.PointerEvent) => void;
    dragging?: 'title' | 'cta' | null;
    onTextDoubleClick?: (el: 'title' | 'subtitle' | 'cta') => void;
    onTextResizeStart?: (el: 'title' | 'cta', e: React.PointerEvent) => void;
    onElementDragStart?: (id: string, e: React.PointerEvent) => void;
    onElementResizeStart?: (id: string, e: React.PointerEvent) => void;
    onElementDelete?: (id: string) => void;
    selectedElementId?: string | null;
  };
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
  /** Une sequence est visible si elle est active ET mise en avant. */
  const shows = (seq: 'intro' | 'cards' | 'cta') =>
    activeOrder.includes(seq) && (focus === 'all' || focus === seq);

  // Les aides d'edition, sous leurs noms d'origine : le JSX ci-dessous est
  // celui de `Preview`, deplace tel quel.
  const {
    cardsRef, onCardDragStart, onDragMove, onDragEnd, draggingCard = null, selectedCards,
    groupedCards, capturing = false, onCardDoubleClick, onCardResizeStart, onDragStart,
    dragging = null, onTextDoubleClick, onTextResizeStart, onElementDragStart,
    onElementResizeStart, onElementDelete, selectedElementId = null,
  } = edit ?? {};
  const uiPx = edit?.uiPx ?? ((n: number) => n);

  /**
   * Bloc de texte survole — c'est lui qui montre ses poignees.
   *
   * ⚠️ ON LES GARDE PENDANT LE GESTE (`dragging`). Le pointeur est CAPTURE
   * par la poignee : s'il sort du bloc, `pointerleave` tombe, la poignee se
   * demonte et le redimensionnement s'interrompt au milieu.
   */
  const [survolTexte, setSurvolTexte] = useState<'title' | 'cta' | null>(null);
  const poigneesVisibles = (el: 'title' | 'cta') => survolTexte === el || dragging === el;

  return (
    <>
            {rushUrl && (
              <video
                src={rushUrl}
                muted
                loop
                autoPlay
                playsInline
                preload="metadata"
                onError={onRushError}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
              />
            )}
            <TextAnimationLayer style={textAnimation} progress={progress}>
            {shows('intro') && (
            /* Titre — ancre au bord GAUCHE (x) et au bord HAUT (y), comme
                drawIntro avec titleAlign:'left' et textBaseline:'top'.
                L'ombre est appliquee en dur par le compositeur. */
            <div
              data-guide-key="title"
              data-guide-label="Titre"
              onPointerDown={(e) => onDragStart?.('title', e)}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
              onPointerCancel={onDragEnd}
              onLostPointerCapture={onDragEnd}
              onDoubleClick={onTextDoubleClick ? () => onTextDoubleClick('title') : undefined}
              onPointerEnter={onTextResizeStart ? () => setSurvolTexte('title') : undefined}
              onPointerLeave={onTextResizeStart ? () => setSurvolTexte((v) => (v === 'title' ? null : v)) : undefined}
              data-title-block
              title={
                onTextDoubleClick
                  ? 'Glisser pour déplacer · double-clic pour la police et la taille'
                  : onDragStart ? 'Glisser pour déplacer le titre' : undefined
              }
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
                onSubtitleDoubleClick={onTextDoubleClick ? () => onTextDoubleClick('subtitle') : undefined}
                typography={text.title}
                subtitleTypography={text.subtitle}
                format={format}
                containerWidth={vw}
              />
              {/* Poignees de coin — agrandir le TEXTE. Elles arretent la
                  propagation : sans cela, la prise deplacerait le bloc au
                  lieu de le redimensionner. */}
              <TextResizeHandles el="title" onStart={onTextResizeStart} uiPx={uiPx} capturing={capturing}
                visible={poigneesVisibles('title')}
                onDragMove={onDragMove} onDragEnd={onDragEnd} />
            </div>
            )}
            </TextAnimationLayer>

            {/* Cartes — ce conteneur est PHOTOGRAPHIÉ (modern-screenshot) et
                l'image est blittée telle quelle dans la vidéo par le
                compositeur. C'est ce qui garantit que les cartes de l'aperçu
                et celles du montage sont pixel pour pixel identiques.

                Depuis la Phase 2 du rendu serveur, le rendu lui-même vit dans
                `SequenceCards`, partagé avec la composition Remotion : le MÊME
                composant produit la même image des deux côtés. Les aides
                d'édition passent par `interaction`, absent côté serveur. */}
            <TextAnimationLayer style={textAnimation} progress={progress}>
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
                onCardDoubleClick,
                onCardResizeStart,
              }}
              cardStyle={cardStyle}
              typography={cardsTypography}
            />
            </TextAnimationLayer>

            <TextAnimationLayer style={textAnimation} progress={progress}>
            {shows('cta') && (
            /* CTA — ancre par le BAS a ctaPos.y, centre horizontalement :
                drawCTA fait `curY = ctaPosY - blockH`, donc y designe le bas
                du bloc. Graisse 900 en dur cote compositeur. */
            <div
              data-guide-key="cta"
              data-guide-label="CTA"
              onPointerDown={(e) => onDragStart?.('cta', e)}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
              onPointerCancel={onDragEnd}
              onLostPointerCapture={onDragEnd}
              onDoubleClick={onTextDoubleClick ? () => onTextDoubleClick('cta') : undefined}
              onPointerEnter={onTextResizeStart ? () => setSurvolTexte('cta') : undefined}
              onPointerLeave={onTextResizeStart ? () => setSurvolTexte((v) => (v === 'cta' ? null : v)) : undefined}
              data-cta-block
              title={
                onTextDoubleClick
                  ? 'Glisser pour déplacer · double-clic pour la police et la taille'
                  : onDragStart ? 'Glisser pour déplacer le CTA' : undefined
              }
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
              <TextResizeHandles el="cta" onStart={onTextResizeStart} uiPx={uiPx} capturing={capturing}
                visible={poigneesVisibles('cta')}
                onDragMove={onDragMove} onDragEnd={onDragEnd} />
            </div>
            )}
            </TextAnimationLayer>

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
  );
}

type PlateContentProps = Parameters<typeof PlateContent>[0];

/**
 * Un plateau COMPLET en lecture seule — fond, affiche, contenu d'UNE sequence.
 *
 * C'est le calque que `SequencePlayback` anime : le meme fond que le plateau
 * d'edition (`backdropCSS`, photo puis voile — l'ordre du compositeur) et le
 * meme contenu (`PlateContent`), rendu a la resolution video puis reduit par
 * `displayScale`, comme le plateau. Aucune aide d'edition : `edit` absent.
 *
 * ⚠️ HORS DU PLATEAU PHOTOGRAPHIE. Il vit dans le slot `overlay` de
 * `Preview`, jamais dans `previewRef` — sinon un calque de lecture finirait
 * blitte dans le montage.
 */
function PlateauLecture({
  displayScale,
  gradStart,
  gradientOpacity,
  posterUrl = null,
  posterTransform,
  ...plate
}: Omit<PlateContentProps, 'edit'> & {
  displayScale: number;
  gradStart: string;
  gradientOpacity: number;
  posterUrl?: string | null;
  posterTransform?: PosterTransform;
}) {
  const { format, gradEnd } = plate;
  return (
    <div
      data-plateau-lecture={plate.focus}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: VIDEO_SIZE[format].w,
        height: VIDEO_SIZE[format].h,
        transform: `scale(${displayScale})`,
        transformOrigin: 'top left',
        background: posterUrl ? DARK : backdropCSS(format, gradStart, gradEnd, gradientOpacity),
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        pointerEvents: 'none',
      }}
    >
      {posterUrl && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={posterUrl}
            alt=""
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: `translate(${(posterTransform?.offsetX ?? 0) * 100}%, ${(posterTransform?.offsetY ?? 0) * 100}%) scale(${posterTransform?.scale ?? 1})`,
              transformOrigin: 'center',
            }}
          />
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              background: backdropVeilCSS(gradStart, gradEnd, gradientOpacity),
            }}
          />
        </>
      )}
      <PlateContent {...plate} />
    </div>
  );
}

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
  gaps = EMPTY_GAPS,
  selection = null,
  onMeasure,
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
  hideFootnote = false,
  overlay = null,
  cardStyle,
  cardsTypography,
  onCardResizeStart,
  onTextResizeStart,
  onTextDoubleClick,
  onCardDoubleClick,
}: {
  /**
   * Prise d'une poignee de coin sur le TITRE ou le CTA — agrandir le texte.
   *
   * ⚠️ ABSENT = AUCUNE POIGNEE, donc l'assistant manuel est inchange. Il
   * regle deja sa taille de texte par un curseur dans le panneau de gauche ;
   * lui ajouter des poignees changerait son ergonomie sans qu'on l'ait
   * demande. L'Autopilote, lui, n'a pas de place pour un curseur de plus —
   * c'est toute la raison de ces poignees.
   *
   * Les elements libres ont deja les leurs (`onElementResizeStart`) : celles-ci
   * sont pour le texte, qui n'a pas de boite propre a redimensionner.
   */
  onTextResizeStart?: (el: 'title' | 'cta', e: React.PointerEvent) => void;
  /** Double-clic sur le titre ou le CTA — ouvre son panneau de reglages. */
  onTextDoubleClick?: (el: 'title' | 'subtitle' | 'cta') => void;
  /** Double-clic sur une carte — ouvre le choix de son icone. */
  onCardDoubleClick?: (id: string) => void;
  /**
   * Calque posé DANS le cadre, par-dessus le plateau.
   *
   * ⚠️ C'EST CE QUI MET FIN AU DEUXIÈME ÉCRAN. Le montage rendu s'affichait
   * dans un bloc `<video>` SOUS l'aperçu : l'utilisateur se retrouvait avec
   * deux images du même montage empilées — l'aperçu figé, puis la vidéo, avec
   * ses propres bordures, sa légende et son bouton « Fermer ». Le lecteur vit
   * désormais ICI, à la place exacte du plateau, dans le même cadre et au
   * même ratio.
   *
   * Un `ReactNode` plutôt qu'une prop `videoUrl` : le cadre n'a pas à savoir
   * ce qu'on y pose. `Preview` reste un rendu, pas un lecteur.
   *
   * Défaut `null` : l'aperçu de l'Autopilote et la fenêtre agrandie, qui n'en
   * passent pas, rendent exactement ce qu'ils rendaient avant.
   */
  overlay?: React.ReactNode;
  /**
   * Style de carte. Absent = le cadre, comme depuis toujours.
   *
   * ⚠️ IL DOIT SUIVRE LE COMPOSITEUR. « Text Only » y retire deja le
   * rectangle ; sans ce passage, l'apercu montrerait un cadre que la video
   * n'a pas.
   */
  cardStyle?: string;
  /**
   * Typographie du texte des cartes. Absente = le rendu d'aujourd'hui.
   *
   * ⚠️ ELLE SUFFIT A LA PARITE. « Creer simple » PHOTOGRAPHIE le conteneur
   * des cartes et le compositeur blitte l'image ; l'Autopilote rend le meme
   * composant sous Remotion. Les deux moteurs lisent donc ce meme JSX.
   */
  cardsTypography?: CardsTypography;
  /** Prise d'une poignee de coin sur une carte — agrandit SON texte. */
  onCardResizeStart?: (id: string, e: React.PointerEvent) => void;
  /**
   * Masque la note « les cartes de la vidéo seront exactement celles-ci ».
   *
   * ⚠️ ELLE EST VRAIE POUR L'ASSISTANT, FAUSSE POUR L'AUTOPILOTE. L'assistant
   * montre le contenu qui partira au compositeur ; l'aperçu de l'Autopilote
   * montre un ÉCHANTILLON, dont ni les cartes ni le titre ne seront repris —
   * seul le style l'est. Laisser cette phrase sous un échantillon aurait
   * promis exactement ce que l'Autopilote ne tient pas.
   *
   * Defaut `false` : l'assistant garde sa note, mot pour mot.
   */
  hideFootnote?: boolean;
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
  /** Ecarts BORD-A-BORD, en pixels du format d'export. */
  gaps?: GapBadge[];
  /** Emprise du bloc mesure — dessine son cadre de selection magenta. */
  selection?: ElementBox | null;
  /**
   * Bloc clique — sa regle reste affichee jusqu'au prochain clic ailleurs.
   * `null` quand le clic ne vise aucun bloc mesurable.
   */
  onMeasure?: (key: string | null) => void;
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
  /**
   * Cadre visible, mesure pour calculer la reduction.
   *
   * ⚠️ `React.Ref` ET NON `RefObject` : les appelants passent desormais une
   * ref de RAPPEL, seule facon d'etre prevenu au moment ou le noeud
   * s'attache. Voir `useFrameScale` — c'est la cause de l'apercu vide.
   */
  frameRef?: React.Ref<HTMLDivElement>;
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
  // La resolution video, la disposition des cartes et la visibilite des
  // sequences vivent desormais dans `PlateContent`, rendu ici ET par les
  // calques de lecture.
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

  /**
   * Reperes d'alignement — un reglage d'ECRAN, donc local a l'apercu.
   *
   * Rien a persister ni a transmettre au compositeur : ces lignes n'existent
   * que sous les yeux de l'utilisateur. Les garder ici plutot que dans l'etat
   * du wizard evite d'ajouter un champ a la sauvegarde, donc un champ de plus
   * a oublier dans un des payloads de design.
   */
  const [reperesCentre, setReperesCentre] = useState(false);
  const [reperesGrille, setReperesGrille] = useState(false);
  // Le rush se montre dans la composition entiere ET sur son propre onglet :
  // l'isoler est tout l'interet de cet onglet.
  const showRush =
    !!rushUrl && !rushBroken && activeOrder.includes('video')
    && (focus === 'all' || focus === 'video');

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
            Aperçu du style
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
              className={`flex-1 justify-center text-[11px] disabled:opacity-30 ${classesOnglet(focus === t.id)}`}
            >
              {t.label}
              {/* Marqueur de forme, pas seulement la couleur : barre sous l'onglet actif. */}
              {focus === t.id && <span aria-hidden="true" data-barre className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-purple-400" />}
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
        // `.apercu-cadre` : la largeur se deduit de la hauteur de fenetre — le
        // cadre est toujours ENTIEREMENT visible a droite (voir globals.css).
        // Le ResizeObserver de `useFrameScale` suit cette largeur.
        className="apercu-cadre w-full rounded-xl overflow-hidden relative"
        style={{
          aspectRatio: ASPECT_CSS[format],
          ...ratioEnVariables(ASPECT_CSS[format]),
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
        // Bloc dont la regle s'affiche — lu dans le DOM, donc valable pour
        // TOUT bloc marque, y compris ceux qu'aucun etat de selection ne
        // connait. Un clic hors de tout bloc marque range la regle.
        onClick={capturing ? undefined : (e) => {
          const bloc = (e.target as HTMLElement).closest('[data-guide-key]');
          onMeasure?.(bloc ? bloc.getAttribute('data-guide-key') : null);
        }}
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
        {!generated ? (
          /* ⚠️ DIMENSIONNE EN `uiPx` : ce bloc vit DANS le plateau, rendu a la
             resolution video puis reduit — en `text-xs`, le message faisait
             trois pixels a l'ecran, et l'apercu passait pour un rectangle vide. */
          <div
            className="absolute inset-0 flex flex-col items-center justify-center text-center"
            style={{ gap: uiPx(10), padding: uiPx(24) }}
            data-apercu-vide
          >
            <MonitorPlay style={{ width: uiPx(40), height: uiPx(40) }} className="text-gray-600" />
            <p className="text-gray-400" style={{ fontSize: uiPx(15), lineHeight: 1.5 }}>
              L&apos;aperçu apparaîtra à l&apos;étape Style,
              <br />
              une fois votre sujet choisi.
            </p>
          </div>
        ) : (
          <PlateContent
            generated={generated}
            format={format}
            focus={focus}
            activeOrder={activeOrder}
            rushUrl={showRush ? rushUrl : null}
            onRushError={() => setRushBroken(true)}
            text={text}
            titlePos={titlePos}
            ctaPos={ctaPos}
            cardBoxes={cardBoxes}
            cardStyle={cardStyle}
            cardsTypography={cardsTypography}
            elements={elements}
            watermark={watermark}
            accent={accent}
            gradEnd={gradEnd}
            edit={{
              cardsRef, onCardDragStart, onDragMove, onDragEnd, draggingCard, selectedCards,
              groupedCards, capturing, uiPx, onCardDoubleClick, onCardResizeStart, onDragStart,
              dragging, onTextDoubleClick, onTextResizeStart, onElementDragStart,
              onElementResizeStart, onElementDelete, selectedElementId,
            }}
          />
        )}
      </div>

      {/* ── CALQUE DU CADRE ──────────────────────────────────────────
          Posé APRÈS le plateau et DANS le cadre : il en hérite le ratio, les
          coins arrondis et le `overflow-hidden`, sans qu'aucune taille ne
          soit recalculée. C'est ce qui fait que le montage rendu occupe
          exactement la place de l'aperçu figé.

          ⚠️ HORS DU PLATEAU, PAS DEDANS. Le plateau (`previewRef`) est ce que
          `modern-screenshot` photographie pour l'export : un lecteur vidéo
          posé à l'intérieur finirait blitté dans le montage. */}
      {overlay && (
        <div className="absolute inset-0" data-preview-overlay>
          {overlay}
        </div>
      )}

      {/* ── REPERES D'ALIGNEMENT ─────────────────────────────────────
          Le MEME calque que Creer avance — memes regles, memes unites.

          ⚠️ DANS LE CADRE, PAS DANS LE PLATEAU. Le plateau (`previewRef`) est
          ce que `modern-screenshot` photographie : un repere pose dedans
          finirait grave dans le montage. Le cadre a exactement la taille et
          le ratio du plateau reduit, donc les pourcentages y sont les memes —
          et la police des pastilles reste a sa taille d'ecran au lieu d'etre
          reduite avec le plateau.
          `capturing` est un second verrou, pour l'affiche telechargee. */}
      {!capturing && (
        <SmartGuides
          guides={guides}
          gaps={gaps}
          selection={selection}
          showGrid={reperesGrille}
          // ⚠️ LE MILIEU S'AFFICHE DES QU'UN BLOC EST MESURE, sans attendre la
          // bascule : c'est pendant le placement qu'on a besoin de voir le
          // vrai centre du format. Rien de selectionne : retour au reglage.
          showCenter={reperesCentre || gaps.length > 0}
          showThirds={reperesCentre}
          format={format}
          showRatioLabel={reperesCentre || reperesGrille || gaps.length > 0}
        />
      )}

      {/* Bascules — posees DANS le cadre, en haut a droite : aucun pixel de
          hauteur ajoute a la page, donc aucune etape rallongee. */}
      {generated && !capturing && (
        <div className="absolute top-2 right-2 z-40 flex gap-1">
          <button
            type="button"
            onClick={() => setReperesCentre((v) => !v)}
            aria-pressed={reperesCentre}
            title={reperesCentre ? 'Masquer les repères' : 'Afficher les repères (centre + tiers)'}
            className={`flex items-center justify-center w-7 h-7 rounded-lg backdrop-blur transition ${
              reperesCentre
                ? 'bg-purple-600/40 text-purple-200 ring-1 ring-purple-400/50'
                : 'bg-gray-900/60 text-gray-400 hover:text-white'
            }`}
          >
            <Crosshair size={13} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => setReperesGrille((v) => !v)}
            aria-pressed={reperesGrille}
            title={reperesGrille ? 'Masquer la grille' : 'Afficher la grille'}
            className={`flex items-center justify-center w-7 h-7 rounded-lg backdrop-blur transition ${
              reperesGrille
                ? 'bg-cyan-600/40 text-cyan-200 ring-1 ring-cyan-400/50'
                : 'bg-gray-900/60 text-gray-400 hover:text-white'
            }`}
          >
            <Grid3x3 size={13} strokeWidth={2} />
          </button>
        </div>
      )}

      </div>

      {generated && !hideFootnote && (
        <p className="mt-3 text-[10px] text-gray-600 leading-relaxed">
          Les cartes de la vidéo seront exactement celles-ci. Le titre et le CTA, eux, apparaissent en séquences successives dans le montage.
          {showRush && ' Le rush occupe seul sa séquence, cadré comme ici.'}
        </p>
      )}
    </div>
  );
}

/**
 * Réglages d'une zone de texte de l'Autopilote — police, taille, graisse.
 *
 * ⚠️ IL VIT DANS UN PANNEAU FLOTTANT, PAS DANS LA COLONNE DE GAUCHE. C'est
 * toute la réponse à la contrainte « rester à six étapes sans allonger la
 * page » : ces sept réglages, empilés sous les couleurs, auraient doublé la
 * hauteur de l'étape « Style & médias ». Ouverts au double-clic sur
 * l'élément visé, ils n'occupent aucune place au repos.
 *
 * ⚠️ AUCUNE VALEUR N'EST ÉCRITE TANT QU'ON N'Y TOUCHE PAS. Les curseurs
 * affichent le défaut du Mode simple, mais `valeurs` reste vide : c'est ce
 * qui distingue « l'utilisateur a choisi 100 % » de « l'utilisateur n'a rien
 * choisi », et donc ce qui garde le montage rétro-compatible.
 */
const TextZonePanel: React.FC<{
  zone: 'title' | 'subtitle' | 'cta';
  valeurs: AutopilotTextZone;
  onChange: (patch: Partial<AutopilotTextZone>) => void;
}> = ({ zone, valeurs, onChange }) => {
  const defauts = zone === 'cta'
    ? DEFAULT_TEXT_STYLES.cta
    // Le sous-titre herite de la graisse et de l'interligne du titre : ce
    // sont donc les defauts du TITRE qu'il faut afficher, pas des siens.
    : DEFAULT_TEXT_STYLES.title;
  const police = valeurs.font ?? defauts.font;
  const echelle = valeurs.scale ?? defauts.scale;
  const interlettrage = valeurs.letterSpacing ?? defauts.letterSpacing;
  const interligne = valeurs.lineHeight ?? defauts.lineHeight;
  const libelle = zone === 'title' ? 'Titre' : zone === 'subtitle' ? 'Sous-titre' : 'CTA';

  return (
    <div className="space-y-3" data-autopilot-texte-panneau={zone}>
      <p className="text-[11px] text-gray-500">
        {libelle} — ces réglages valent pour
        {' '}<span className="text-gray-300">toutes les vidéos</span>.
      </p>
      {/* ⚠️ LE CONTENU N'EST PAS EDITABLE ICI, ET C'EST VOULU. L'Autopilote
          genere un texte DIFFERENT a chaque video : y figer une phrase
          detruirait la variete qui fait tout son interet. Le dire, plutot que
          de laisser l'utilisateur chercher un champ qui n'existe pas. */}
      <p className="text-[11px] text-gray-600">
        Le texte, lui, change à chaque vidéo — seul le style est constant.
      </p>

      <div>
        <label htmlFor={`ap-font-${zone}`} className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
          Police
        </label>
        <select
          id={`ap-font-${zone}`}
          value={police}
          onChange={(e) => {
            const f = e.target.value;
            // Sans chargement, l'apercu rendrait le nom dans la police
            // systeme — et l'utilisateur jugerait un rendu qui n'est pas le
            // sien.
            void ensureFontLoaded(f);
            onChange({ font: f });
          }}
          // Sans feuille chargee, les cinquante et quelques noms s'affichent
          // tous dans la meme police. On charge donc le 400 de TOUT le
          // catalogue — une seule requete — des qu'on s'approche du selecteur.
          onFocus={() => { void preloadCatalogPreview(); }}
          onPointerEnter={() => { void preloadCatalogPreview(); }}
          style={{ fontFamily: fontStack(police) }}
          data-autopilot-font={zone}
          className="w-full rounded-lg bg-gray-800 border border-gray-700 focus:border-purple-500 outline-none px-2 py-1.5 text-sm"
        >
          {FONT_GROUPS.map((g) => (
            <optgroup key={g.group} label={g.label}>
              {g.fonts.map((f) => (
                <option key={f} value={f} style={{ fontFamily: fontStack(f) }}>{f}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[11px] text-gray-500 w-20 flex-shrink-0">Taille</span>
        <input
          type="range"
          min={Math.round(SCALE_MIN * 100)}
          max={Math.round(SCALE_MAX * 100)}
          step={5}
          value={Math.round(echelle * 100)}
          onChange={(e) => onChange({ scale: Number(e.target.value) / 100 })}
          aria-label={`Taille — ${libelle}`}
          data-autopilot-scale={zone}
          className="flex-1 h-1 rounded-lg appearance-none bg-gray-700 accent-purple-500 cursor-pointer"
        />
        <span className="text-[11px] text-gray-400 w-11 text-right tabular-nums">
          {Math.round(echelle * 100)}%
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[11px] text-gray-500 w-20 flex-shrink-0">Interligne</span>
        <input
          type="range"
          min={LINE_HEIGHT_MIN}
          max={LINE_HEIGHT_MAX}
          step={0.05}
          value={interligne}
          onChange={(e) => onChange({ lineHeight: Number(e.target.value) })}
          aria-label={`Interligne — ${libelle}`}
          className="flex-1 h-1 rounded-lg appearance-none bg-gray-700 accent-purple-500 cursor-pointer"
        />
        <span className="text-[11px] text-gray-400 w-11 text-right tabular-nums">
          {interligne.toFixed(2)}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[11px] text-gray-500 w-20 flex-shrink-0">Interlettrage</span>
        <input
          type="range"
          min={LETTER_SPACING_MIN}
          max={LETTER_SPACING_MAX}
          step={0.5}
          value={interlettrage}
          onChange={(e) => onChange({ letterSpacing: Number(e.target.value) })}
          aria-label={`Interlettrage — ${libelle}`}
          className="flex-1 h-1 rounded-lg appearance-none bg-gray-700 accent-purple-500 cursor-pointer"
        />
        <span className="text-[11px] text-gray-400 w-11 text-right tabular-nums">
          {interlettrage.toFixed(1)}
        </span>
      </div>

      {/* La MEME barre que « Créer simple » — extraite plutot que recopiee.
          Le défaut de casse est `'uppercase'` : titre et CTA sont en
          capitales depuis toujours, et afficher « Normal » tant que rien
          n'est choisi annoncerait l'inverse de ce que la vidéo produit. */}
      <TextFormatToolbar
        zone={zone}
        valeurs={valeurs}
        defauts={{
          // Le sous-titre n'etait PAS en capitales, contrairement au titre et
          // au CTA : son repli de casse est « Normal ».
          textCase: zone === 'subtitle' ? 'none' : DEFAULT_TEXT_CASE,
          align: zone === 'cta' ? 'center' : 'left',
          bold: defauts.bold,
          italic: defauts.italic,
        }}
        // Graisse et italique du sous-titre sont ceux du TITRE — `drawIntro`
        // et `SequenceTitle` les lui imposent. Les proposer ici promettrait
        // un reglage sans effet.
        showBoldItalic={zone !== 'subtitle'}
        onChange={onChange}
      />
    </div>
  );
};

/**
 * Aperçu de l'Autopilote — un ÉCHANTILLON, pas la prochaine vidéo.
 *
 * ⚠️ LA COLONNE DE DROITE ÉTAIT VIDE SUR CET ÉCRAN. Elle sert l'assistant
 * « Créer simple », qui n'a rien généré tant qu'on n'a pas commencé : on
 * réglait donc les couleurs, le fond des cartes et les thèmes de l'Autopilote
 * devant un cadre en pointillés. C'était le seul endroit du produit où l'on
 * choisit un style sans jamais le voir.
 *
 * ⚠️ ET C'EST LE MÊME COMPOSANT `Preview` QUE L'ASSISTANT, à dessein. Un
 * second rendu écrit ici aurait fini par montrer une mise en page que le
 * moteur ne produit pas — et l'écart ne se serait vu qu'en comparant une
 * vraie vidéo à l'aperçu, c'est-à-dire trop tard. Ce composant n'ajoute donc
 * rien au rendu : il l'ALIMENTE, à partir de la configuration.
 */
function AutopilotPreview({ config, accent, onPatch }: {
  config: AutopilotConfig;
  accent: string;
  /**
   * Enregistre un reglage — c'est `enregistrer` du panneau, remonte.
   *
   * ⚠️ UN SEUL ECRIVAIN. Le panneau possede l'etat ET l'enregistrement ; lui
   * en ajouter un second ici aurait donne deux sources de verite pour la meme
   * configuration, et le dernier a ecrire aurait gagne au hasard des rendus.
   * L'apercu ne fait donc que rendre — et demander.
   */
  onPatch?: (patch: Partial<AutopilotConfig>) => void;
}) {
  // La MEME regle que l'assistant : mesurer au moment ou le noeud s'attache.
  // Cet apercu-ci n'etait pas touche — il se monte en meme temps que son
  // cadre — mais laisser deux mesures dont une seule est robuste, c'est
  // garder le piege arme pour le prochain montage conditionnel.
  const { setFrame, displayScale } = useFrameScale(VIDEO_SIZE['9:16'].w);
  const [focus, setFocus] = useState<PreviewFocus>('all');
  const [posterUrl, setPosterUrl] = useState<string | null>(null);

  // L'Autopilote ne produit que du vertical (`AUTOPILOT_FORMAT`).
  const format: Format = '9:16';

  /* ── LE STYLE, EN BROUILLON LOCAL ────────────────────────────────────
     Un glissement emet des dizaines de positions par seconde : les envoyer
     toutes au serveur inonderait la route de configuration pour un seul
     geste. Le brouillon suit le doigt ; l'enregistrement part au
     RELACHEMENT. */
  const [style, setStyle] = useState<AutopilotDesignStyle>(config.designStyle);
  // Resynchronisation sur la valeur SERIALISEE : `config.designStyle` est un
  // objet neuf a chaque assainissement, et comparer les references relancerait
  // cet effet a chaque rendu — il ecraserait le geste en cours.
  const styleSignature = JSON.stringify(config.designStyle ?? {});
  useEffect(() => { setStyle(JSON.parse(styleSignature)); }, [styleSignature]);



  /**
   * Le contenu d'exemple.
   *
   * ⚠️ MÉMOÏSÉ SUR LES SEULS THÈMES. `generateSmartContent` est synchrone mais
   * pas gratuit, et le relancer à chaque mouvement de roue chromatique
   * réécrirait tout le texte sous les yeux de l'utilisateur — impossible de
   * comparer deux couleurs si les mots changent entre les deux.
   */
  const topicsKey = config.topics.join('|');
  const sample = useMemo(
    () => buildAutopilotSample({ topics: topicsKey ? topicsKey.split('|') : [] }),
    [topicsKey],
  );

  const generated: Generated = useMemo(() => ({
    title: sample.title,
    subtitle: sample.subtitle,
    // L'icone du compte si l'utilisateur en a choisi une pour ce rang — la
    // MEME regle que `buildAutopilotDesign`, pour que l'apercu montre ce que
    // la video produira.
    cards: sample.cards.map((c, i) => ({
      ...c,
      icon: style.cardIcons?.[String(i)] ?? c.icon,
      id: `apercu-${i}`,
    })),
    cta: sample.cta,
    ctaSub: sample.ctaSub,
  }), [sample, style.cardIcons]);

  /**
   * Affiche d'exemple, cherchée dans la même banque que le moteur.
   *
   * ⚠️ AUCUN ÉCHEC NE DOIT SE VOIR. Sans clé Pexels, hors ligne, ou sur un
   * thème sans résultat, on rend `null` et le dégradé reprend sa place — ce
   * que fait exactement `buildAutopilotDesign` quand `pickPosterUrl` ne trouve
   * rien. Un cadre d'erreur à la place d'une photo décorative ferait croire à
   * une panne de l'Autopilote.
   */
  useEffect(() => {
    let annule = false;
    setPosterUrl(null);
    fetch(`/api/pexels?query=${encodeURIComponent(sample.posterQuery)}&count=1`)
      .then((r) => r.json())
      .then((d) => {
        if (annule || !d?.success || !Array.isArray(d.photos)) return;
        const p = d.photos[0];
        const url = p?.medium || p?.url || p?.small;
        if (typeof url === 'string' && url) setPosterUrl(url);
      })
      .catch(() => {});
    return () => { annule = true; };
  }, [sample.posterQuery]);

  /**
   * La typographie de l'échantillon : les défauts partagés, plus la seule
   * couleur de texte que l'Autopilote fait régler. Le sous-texte du CTA suit
   * la fin du dégradé, comme dans l'assistant.
   */
  const text: TextStyles = useMemo(() => ({
    title: {
      ...DEFAULT_TEXT_STYLES.title,
      color: config.titleColor,
      // ⚠️ `??` ET NON `||` : une echelle de 0 ou un interlettrage de 0 sont
      // des reglages legitimes, que `||` remplacerait par le defaut.
      font: style.title?.font ?? DEFAULT_TEXT_STYLES.title.font,
      scale: style.title?.scale ?? DEFAULT_TEXT_STYLES.title.scale,
      bold: style.title?.bold ?? DEFAULT_TEXT_STYLES.title.bold,
      italic: style.title?.italic ?? DEFAULT_TEXT_STYLES.title.italic,
      letterSpacing: style.title?.letterSpacing ?? DEFAULT_TEXT_STYLES.title.letterSpacing,
      lineHeight: style.title?.lineHeight ?? DEFAULT_TEXT_STYLES.title.lineHeight,
      // Absents = le rendu d'avant, decide par les composants partages.
      textCase: style.title?.textCase,
      align: style.title?.align,
      underline: style.title?.underline,
      strike: style.title?.strike,
    },
    subtitle: {
      ...DEFAULT_TEXT_STYLES.subtitle,
      font: style.subtitle?.font ?? DEFAULT_TEXT_STYLES.subtitle.font,
      scale: style.subtitle?.scale ?? DEFAULT_TEXT_STYLES.subtitle.scale,
      textCase: style.subtitle?.textCase,
      align: style.subtitle?.align,
      underline: style.subtitle?.underline,
      strike: style.subtitle?.strike,
    },
    cta: {
      ...DEFAULT_TEXT_STYLES.cta,
      subColor: config.cardGradientEnd,
      font: style.cta?.font ?? DEFAULT_TEXT_STYLES.cta.font,
      scale: style.cta?.scale ?? DEFAULT_TEXT_STYLES.cta.scale,
      bold: style.cta?.bold ?? DEFAULT_TEXT_STYLES.cta.bold,
      italic: style.cta?.italic ?? DEFAULT_TEXT_STYLES.cta.italic,
      letterSpacing: style.cta?.letterSpacing ?? DEFAULT_TEXT_STYLES.cta.letterSpacing,
      lineHeight: style.cta?.lineHeight ?? DEFAULT_TEXT_STYLES.cta.lineHeight,
      textCase: style.cta?.textCase,
      align: style.cta?.align,
      underline: style.cta?.underline,
      strike: style.cta?.strike,
    },
  }), [config.titleColor, config.cardGradientEnd, style]);

  /**
   * Séquences de l'échantillon.
   *
   * La séquence vidéo n'y figure que si l'utilisateur a des rushes : sans
   * banque, le moteur produit un montage titre → cartes → CTA
   * (`buildSequences` retire une séquence de durée nulle), et annoncer un
   * onglet « Vidéo » vide serait une promesse que le montage ne tient pas.
   */
  const activeOrder = useMemo(
    () => (config.rushUrls.length > 0
      ? ['intro', 'cards', 'video', 'cta']
      : ['intro', 'cards', 'cta']),
    [config.rushUrls.length],
  );

  /** Ecrit un reglage : brouillon tout de suite, base ensuite. */
  const poser = useCallback((suivant: AutopilotDesignStyle) => {
    setStyle(suivant);
    onPatch?.({ designStyle: suivant });
  }, [onPatch]);

  /** Modifie le texte des CARTES, sans toucher au reste. */
  const poserZoneCartes = useCallback((patch: Partial<AutopilotTextZone>) => {
    setStyle((prev) => {
      const suivant = { ...prev, cards: { ...(prev.cards ?? {}), ...patch } };
      onPatch?.({ designStyle: suivant });
      return suivant;
    });
  }, [onPatch]);

  /** Modifie UNE zone, sans toucher aux autres. */
  const poserZone = useCallback((
    zone: 'title' | 'subtitle' | 'cta',
    patch: Partial<AutopilotTextZone>,
  ) => {
    setStyle((prev) => {
      const suivant = { ...prev, [zone]: { ...(prev[zone] ?? {}), ...patch } };
      onPatch?.({ designStyle: suivant });
      return suivant;
    });
  }, [onPatch]);

  // Positions effectives : celles du compte, sinon les constantes partagees.
  // ⚠️ L'OBJET ENTIER, JAMAIS SES COMPOSANTES. Lire la constante
  // composante par composante est precisement ce que l'editeur manuel s'est
  // INTERDIT (`creer-simple-move-title-cta`) : c'est ainsi que son apercu
  // bougeait pendant que son export restait fige. Ici la constante n'est
  // qu'un DEFAUT, repris en bloc quand le compte n'a rien pose.
  const titlePos: Pos = style.title?.x !== undefined && style.title?.y !== undefined
    ? { x: style.title.x, y: style.title.y }
    : DESIGN.titlePos;
  const ctaPos: Pos = style.cta?.x !== undefined && style.cta?.y !== undefined
    ? { x: style.cta.x, y: style.cta.y }
    : DESIGN.ctaPos;
  const titlePosRef = useRef(titlePos);
  const ctaPosRef = useRef(ctaPos);
  useEffect(() => { titlePosRef.current = titlePos; }, [titlePos.x, titlePos.y]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { ctaPosRef.current = ctaPos; }, [ctaPos.x, ctaPos.y]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── GESTES SUR L'APERCU ─────────────────────────────────────────────
     Glisser pour deplacer, tirer un coin pour agrandir. Les helpers sont
     ceux de l'editeur manuel (`dragPosition`, `smartGuides`) : ses closures,
     elles, sont liees a son propre etat et ne se partagent pas. */
  const previewRef = useRef<HTMLDivElement>(null);
  const gesteRef = useRef<
    | { type: 'move'; el: 'title' | 'cta'; pointerId: number; grab: Pos; box: BoxPct }
    | { type: 'resize'; el: 'title' | 'cta' | 'cards'; pointerId: number; distance: number; echelle: number }
    | null
  >(null);
  const [dragging, setDragging] = useState<'title' | 'cta' | null>(null);
  const [guides, setGuides] = useState<ActiveGuide[]>([]);
  const [gaps, setGaps] = useState<GapBadge[]>([]);
  /** Bloc mesure et bloc survole — memes regles que le Mode simple. */
  const [measuredKey, setMeasuredKey] = useState<string | null>(null);
  const [selection, setSelection] = useState<ElementBox | null>(null);

  /**
   * Mesure PERSISTANTE — voir le commentaire du meme effet dans le wizard :
   * sans tableau de dependances, avec `sameGaps` pour couper la boucle.
   */
  useEffect(() => {
    if (gesteRef.current) return;
    const vide = () => {
      setGaps((prev) => (prev.length ? [] : prev));
      setGuides((prev) => (prev.length ? [] : prev));
      setSelection((prev) => (prev ? null : prev));
    };
    if (!measuredKey) return vide();
    const boites = collectGuideBoxes(previewRef.current);
    const active = boites.find((b) => b.key === measuredKey) ?? null;
    if (!active) return vide();
    const autres = boites.filter((b) => b.key !== measuredKey);
    const suivant = computeGapBadges(active, autres, format);
    const lignes = onePerAxis(computeAlignmentLines(active, autres, format));
    setGaps((prev) => (sameGaps(prev, suivant) ? prev : suivant));
    setGuides((prev) => (sameGuides(prev, lignes) ? prev : lignes));
    setSelection((prev) => (sameBox(prev, active) ? prev : active));
  });

  /** Ancre d'un bloc : le titre par son coin haut-gauche, le CTA par son bas. */
  const ancreDe = (el: 'title' | 'cta'): Anchor => (el === 'title' ? 'top-left' : 'bottom-center');

  const startDrag = useCallback((el: 'title' | 'cta', e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0 || !e.isPrimary || gesteRef.current) return;
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ancre = el === 'title' ? titlePosRef.current : ctaPosRef.current;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    gesteRef.current = {
      type: 'move',
      el,
      pointerId: e.pointerId,
      grab: grabOffset(e.clientX, e.clientY, rect, ancre),
      box: { width: (box.width / rect.width) * 100, height: (box.height / rect.height) * 100 },
    };
    setDragging(el);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      // Pointeur deja relache : sans ce garde on resterait en « glissement ».
      gesteRef.current = null;
      setDragging(null);
    }
  }, []);

  /**
   * Prise d'une poignee de coin sur une CARTE — agrandit son texte.
   *
   * ⚠️ LES CARTES N'EN AVAIENT PAS. Les poignees n'existaient que pour le
   * titre et le CTA : tirer un coin de carte ne faisait rien. Le geste est le
   * meme — rapport des distances au centre — mais il ecrit l'echelle des
   * CARTES, commune a toutes : une carte deux fois plus grosse que sa voisine
   * ne serait pas un reglage, ce serait un defaut.
   */
  const startCardResize = useCallback((_id: string, e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0 || !e.isPrimary || gesteRef.current) return;
    const cible = (e.currentTarget as HTMLElement).parentElement;
    const box = cible?.getBoundingClientRect();
    if (!box) return;
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    gesteRef.current = {
      type: 'resize',
      el: 'cards',
      pointerId: e.pointerId,
      distance: Math.max(1, Math.hypot(e.clientX - cx, e.clientY - cy)),
      echelle: style.cards?.scale ?? 1,
    };
    setDragging(null);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      gesteRef.current = null;
    }
  }, [style.cards?.scale]);

  const startResize = useCallback((el: 'title' | 'cta', e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0 || !e.isPrimary || gesteRef.current) return;
    const cible = (e.currentTarget as HTMLElement).parentElement;
    const box = cible?.getBoundingClientRect();
    if (!box) return;
    // Le facteur suit le RAPPORT des distances au centre du bloc : eloigner le
    // coin agrandit, le rapprocher retrecit, sans saut a la prise.
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    gesteRef.current = {
      type: 'resize',
      el,
      pointerId: e.pointerId,
      distance: Math.max(1, Math.hypot(e.clientX - cx, e.clientY - cy)),
      echelle: (el === 'title' ? style.title?.scale : style.cta?.scale) ?? 1,
    };
    setDragging(el);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      gesteRef.current = null;
      setDragging(null);
    }
  }, [style.title?.scale, style.cta?.scale]);

  const moveDrag = useCallback((e: React.PointerEvent) => {
    const geste = gesteRef.current;
    const rect = previewRef.current?.getBoundingClientRect();
    if (!geste || !rect || geste.pointerId !== e.pointerId) return;
    // `pointermove` se declenche aussi au survol : sans bouton appuye, il n'y
    // a pas de geste (garde-fou anti « element collant »).
    if (e.buttons === 0 && e.pointerType === 'mouse') return;

    if (geste.type === 'resize') {
      const cible = (e.currentTarget as HTMLElement).parentElement;
      const box = cible?.getBoundingClientRect();
      if (!box) return;
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      const distance = Math.max(1, Math.hypot(e.clientX - cx, e.clientY - cy));
      const brut = geste.echelle * (distance / geste.distance);
      const echelle = Math.min(SCALE_MAX, Math.max(SCALE_MIN, brut));
      setStyle((prev) => ({ ...prev, [geste.el]: { ...(prev[geste.el] ?? {}), scale: echelle } }));
      return;
    }

    const ancre = ancreDe(geste.el);
    const brut = pointToPct(e.clientX, e.clientY, rect, geste.grab);
    // Aimantation sur le centre de l'AUTRE bloc — le calcul passe par le
    // centre, sinon on centrerait le bord gauche du titre sur l'axe.
    const autres: ElementPos[] = geste.el === 'title'
      ? [{ key: 'cta', x: ctaPosRef.current.x, y: ctaPosRef.current.y, label: 'CTA' }]
      : [{ key: 'title', x: titlePosRef.current.x, y: titlePosRef.current.y, label: 'Titre' }];
    const centre = anchorToCenter(brut, ancre, geste.box);
    // Memes regles que le Mode simple et que l'editeur avance : centre, tiers,
    // centres des autres blocs et milieux des espaces libres.
    const boites = collectGuideBoxes(previewRef.current);
    const rendue = boites.find((b) => b.key === geste.el) ?? null;
    const autresBoites = boites.filter((b) => b.key !== geste.el);
    const snap = snapPosition(centre.x, centre.y, autres, { thirds: true, boxes: autresBoites });
    setMeasuredKey(geste.el);
    const boiteActive = rendue
      ? shiftBox(rendue, snap.x - boxCenter(rendue).x, snap.y - boxCenter(rendue).y)
      : null;
    setGuides(
      boiteActive
        // La cible AIMANTEE d'abord : elle a la priorite quand plusieurs
        // coincidences tombent sur le meme axe.
        ? onePerAxis(mergeGuides(snap.guides, computeAlignmentLines(boiteActive, autresBoites, format)))
        : onePerAxis(snap.guides),
    );
    setSelection(boiteActive);
    setGaps(boiteActive ? computeGapBadges(boiteActive, autresBoites, format) : []);
    const pos = clampToBox(centerToAnchor({ x: snap.x, y: snap.y }, ancre, geste.box), ancre, geste.box);
    setStyle((prev) => ({ ...prev, [geste.el]: { ...(prev[geste.el] ?? {}), x: pos.x, y: pos.y } }));
  }, [format]);

  /**
   * Fin du geste — c'est ICI qu'on enregistre.
   *
   * ⚠️ ET SEULEMENT ICI. Enregistrer a chaque `pointermove` enverrait des
   * dizaines de requetes par seconde pour un seul deplacement.
   */
  const endDrag = useCallback(() => {
    const geste = gesteRef.current;
    gesteRef.current = null;
    setDragging(null);
    // Seules les LIGNES magnetiques meurent avec le geste ; les ECARTS
    // restent, repris par l'effet de mesure persistante.
    setGuides([]);
    if (!geste) return;
    setStyle((courant) => { onPatch?.({ designStyle: courant }); return courant; });
  }, [onPatch]);

  /* ── PANNEAUX FLOTTANTS ──────────────────────────────────────────────
     Le double-clic ouvre les reglages de l'element vise. C'est ce qui permet
     de tout regler SUR l'apercu, sans ajouter un seul champ dans la colonne
     de gauche — donc sans allonger la page ni ajouter d'etape. */
  const [panneau, setPanneau] = useState<
    { type: 'texte'; zone: 'title' | 'subtitle' | 'cta' } | { type: 'icone'; rang: number } | null
  >(null);
  const [panneauPos, setPanneauPos] = useState({ x: 0, y: 0 });

  /**
   * La lecture des sequences est-elle en cours ? Le libelle sous l'apercu le
   * dit : « vue de composition » (les trois sequences EMPILEES) ou « lecture
   * des sequences » (l'ordre reel du montage).
   */
  const [lectureEnCours, setLectureEnCours] = useState(false);

  /**
   * Ce que l'Autopilote rend VRAIMENT : les durees par defaut du Mode simple
   * (`DEFAULT_SEQUENCE_SECONDS`), le repli de duree du rush — il ne decode
   * pas le fichier — et les transition / animation par defaut, codees en dur
   * dans `buildAutopilotDesign`. Aucun reglage n'existe pour ces valeurs :
   * les montrer autrement mentirait.
   */
  const etapesLecture = useMemo(
    () => activeOrder.map((k) => ({
      key: k,
      seconds: k === 'video' ? RUSH_SEQUENCE_SECONDS.fallback : DEFAULT_SEQUENCE_SECONDS[k as keyof typeof DEFAULT_SEQUENCE_SECONDS],
    })),
    [activeOrder],
  );

  const ouvrirPanneau = useCallback((suivant: typeof panneau) => {
    // Sous le curseur, borne a la fenetre : un panneau ouvert hors de l'ecran
    // est un panneau qu'on croit casse.
    const x = Math.min(Math.max(12, window.innerWidth / 2), window.innerWidth - 320);
    setPanneauPos({ x, y: Math.max(80, window.innerHeight / 2 - 200) });
    setPanneau(suivant);
  }, []);

  return (
    <div data-autopilot-apercu>
      <Preview
        generated={generated}
        format={format}
        frameRef={setFrame}
        previewRef={previewRef}
        displayScale={displayScale}
        titlePos={titlePos}
        ctaPos={ctaPos}
        dragging={dragging}
        guides={guides}
        gaps={gaps}
        selection={selection}
        onMeasure={setMeasuredKey}
        onDragStart={startDrag}
        onDragMove={moveDrag}
        onDragEnd={endDrag}
        onTextResizeStart={startResize}
        onTextDoubleClick={(zone) => ouvrirPanneau({ type: 'texte', zone })}
        onCardDoubleClick={(id) => {
          const rang = Number(String(id).replace('apercu-', ''));
          if (Number.isInteger(rang)) ouvrirPanneau({ type: 'icone', rang });
        }}
        // ⚠️ LA PORTÉE DE L'AFFICHE SUIT LA RÈGLE DU RENDU. Avec « cartes sur
        // les couleurs », l'onglet Cartes ne doit PAS montrer la photo :
        // `samplePosterVisible` est la même règle que `backgroundFor` côté
        // Remotion, et c'est ce qui rend cet aperçu digne de confiance.
        posterUrl={samplePosterVisible(focus, config.cardsShowPoster) ? posterUrl : null}
        gradStart={config.cardGradientStart}
        gradEnd={config.cardGradientEnd}
        gradientOpacity={AUTOPILOT_GRADIENT_OPACITY}
        accent={accent}
        text={text}
        activeOrder={activeOrder}
        watermark={AUTOPILOT_WATERMARK}
        focus={focus}
        onFocusChange={setFocus}
        // ⚠️ BUG 2 : CES DEUX LIGNES MANQUAIENT. Le selecteur ecrivait bien
        // `design_style.cardStyle`, le rendu video l'honorait — mais l'apercu
        // ne le recevait pas. Choisir « Sans cadre » ne changeait donc rien a
        // l'ecran, et seule la video produite montrait le resultat.
        cardStyle={style.cardStyle}
        cardsTypography={style.cards}
        onCardResizeStart={startCardResize}
        // « Les cartes de la vidéo seront exactement celles-ci » est vrai pour
        // l'assistant et FAUX ici : ce sont celles d'un échantillon. La note
        // honnête de l'Autopilote la remplace, juste en dessous.
        hideFootnote
        // ── LECTURE DES SÉQUENCES ──────────────────────────────────────
        // « Tout » empile titre, cartes et CTA — une vue de COMPOSITION que
        // l'utilisateur lisait comme le montage. Le lecteur les joue dans
        // l'ordre réel, avec la transition et l'animation que l'Autopilote
        // rend vraiment. À l'arrêt il ne couvre rien : le double-clic et le
        // glissement continuent de marcher.
        overlay={focus === 'all' ? (
          <SequencePlayback
            steps={etapesLecture}
            transition={DEFAULT_TRANSITION}
            frame={{ w: VIDEO_SIZE[format].w, h: VIDEO_SIZE[format].h, scale: displayScale }}
            onPlayingChange={setLectureEnCours}
            renderLayer={({ key, progress }) => (
              <PlateauLecture
                generated={generated}
                format={format}
                focus={key as PreviewFocus}
                activeOrder={activeOrder}
                rushUrl={key === 'video' ? (config.rushUrls[0] ?? null) : null}
                displayScale={displayScale}
                gradStart={config.cardGradientStart}
                gradEnd={config.cardGradientEnd}
                gradientOpacity={AUTOPILOT_GRADIENT_OPACITY}
                // La MÊME règle que l'onglet : `samplePosterVisible` est
                // `backgroundFor` côté Remotion.
                posterUrl={samplePosterVisible(key as PreviewFocus, config.cardsShowPoster) ? posterUrl : null}
                text={text}
                titlePos={titlePos}
                ctaPos={ctaPos}
                cardStyle={style.cardStyle}
                cardsTypography={style.cards}
                watermark={AUTOPILOT_WATERMARK}
                accent={accent}
                textAnimation={DEFAULT_TEXT_ANIMATION}
                progress={progress}
              />
            )}
          />
        ) : null}
      />

      {/* ── LE LIBELLÉ HONNÊTE ───────────────────────────────────────────
          Sans lui, l'utilisateur lit cet aperçu comme la prochaine vidéo et
          s'étonne d'en recevoir une autre. Ce qu'il regarde prouve le style,
          rien d'autre. */}
      <p
        className="mt-2 flex items-start gap-1.5 text-[11px] text-gray-500 leading-relaxed"
        data-autopilot-apercu-mention
      >
        <Info className="w-3 h-3 mt-0.5 shrink-0" />
        <span>
          Aperçu du projet — <span className="text-gray-400">exemple</span> sur le thème
          {' '}«&nbsp;{themeLabel(sample.topic)}&nbsp;». Le sujet, l’affiche et les textes
          changent à chaque vidéo ; le style, non.
          {/* Une DÉMONSTRATION, pas le script des futures vidéos : celui-ci
              est généré à chaque production, à partir du brief récurrent. */}
          <span data-autopilot-script-exemple>
            {' '}Exemple de démonstration — le script de chaque vidéo est généré à sa
            production à partir de votre brief.
          </span>
          {/* Ce que l'onglet « Tout » montre : une composition ou le montage.
              Sans cette phrase, les trois séquences empilées passent pour
              l'image finale. */}
          {focus === 'all' && (
            <span data-autopilot-apercu-lecture={lectureEnCours ? 'lecture' : 'composition'}>
              {lectureEnCours
                ? ' Lecture des séquences : l’ordre réel du montage, avec ses transitions.'
                : ' Vue de composition : titre, cartes et CTA sont superposés ici, mais se succèdent dans la vidéo — ▶ pour les lire dans l’ordre.'}
            </span>
          )}
        </span>
      </p>

      {/* ── LE MODE D'EMPLOI ─────────────────────────────────────────────
          ⚠️ IL REMPLACE UNE ÉTAPE ENTIÈRE, ET IL ÉTAIT INVISIBLE. Police,
          taille, position et icônes se règlent SUR l'aperçu : rien de tout
          cela n'ajoute un champ dans la colonne de gauche, et le wizard reste
          à six étapes. Mais la première version de cette phrase était écrite
          en `text-gray-600` sous un autre paragraphe gris — personne ne la
          lisait, donc personne ne découvrait le double-clic, donc la
          fonctionnalité n'existait pas.

          Un ENCART, et non une ligne de plus : bordure, icône de curseur et
          contraste lisible. C'est le minimum pour qu'un geste caché se
          découvre. */}
      <div
        className="mt-2 flex items-start gap-2 rounded-lg border border-purple-500/30 bg-purple-600/10 px-2.5 py-2"
        data-autopilot-apercu-aide
      >
        <MousePointerClick className="w-3.5 h-3.5 mt-0.5 shrink-0 text-purple-300" />
        <p className="text-[11px] text-gray-300 leading-relaxed">
          <span className="font-medium text-white">Double-cliquez un élément</span>
          {' '}— titre, CTA ou carte — pour régler sa police, sa taille et son icône.
          Glissez pour le déplacer, tirez les coins pour l’agrandir.
        </p>
      </div>

      {/* ── RÉGLAGES DU TEXTE ─────────────────────────────────────────── */}
      <FloatingPanel
        title={panneau?.type === 'texte'
          ? (panneau.zone === 'cta' ? 'CTA' : panneau.zone === 'subtitle' ? 'Sous-titre' : 'Titre')
          : 'Titre'}
        isOpen={panneau?.type === 'texte'}
        onClose={() => setPanneau(null)}
        initialX={panneauPos.x}
        initialY={panneauPos.y}
        accentColor={accent}
        // Un curseur qu'on relache HORS du panneau le fermerait : c'est
        // exactement le geste qu'on fait en reglant une taille.
        closeOnClickOutside={false}
      >
        {panneau?.type === 'texte' && (
          <TextZonePanel
            zone={panneau.zone}
            valeurs={style[panneau.zone] ?? {}}
            onChange={(patch) => poserZone(panneau.zone, patch)}
          />
        )}
      </FloatingPanel>

      {/* ── ICÔNE D'UNE CARTE ─────────────────────────────────────────── */}
      <FloatingPanel
        title={`Icône de la carte ${(panneau?.type === 'icone' ? panneau.rang : 0) + 1}`}
        isOpen={panneau?.type === 'icone'}
        onClose={() => setPanneau(null)}
        initialX={panneauPos.x}
        initialY={panneauPos.y}
        accentColor={accent}
        closeOnClickOutside={false}
      >
        {panneau?.type === 'icone' && (
          <div className="space-y-3" data-autopilot-icone-panneau>
            {/* ── STYLE DE CARTE ────────────────────────────────────────
                Il valait `'Compact'` EN DUR, alors que « Sans cadre »
                existait deja dans `CARD_STYLES`. Il vaut pour TOUTES les
                cartes, pas seulement celle qu'on a double-cliquee — d'ou sa
                place en haut du panneau, avant l'icone qui, elle, ne
                concerne que ce rang. */}
            <div>
              <p className="text-xs font-medium text-gray-300 mb-1.5">Style des cartes</p>
              <select
                value={style.cardStyle ?? DEFAULT_CARD_STYLE}
                onChange={(e) => poser({ ...style, cardStyle: e.target.value })}
                data-autopilot-card-style
                className="w-full rounded-lg bg-gray-800 border border-gray-700 focus:border-purple-500 outline-none px-2 py-1.5 text-sm"
              >
                {CARD_STYLES.map((c) => (
                  <option key={c.label} value={c.label}>{c.label} — {c.sublabel}</option>
                ))}
              </select>
              <p className="text-[11px] text-gray-500 mt-1">
                « Sans cadre » affiche le texte seul, sans rectangle de fond.
              </p>
            </div>

            {/* ── TEXTE DES CARTES ──────────────────────────────────────
                ⚠️ CES REGLAGES MANQUAIENT. Le panneau ne proposait que
                l'icone et le style : police, taille et format n'etaient
                disponibles que pour le titre et le CTA. La MEME barre que
                celles-ci — extraite, pas recopiee — et elle vaut pour toutes
                les cartes, pas seulement celle qu'on a double-cliquee. */}
            <div>
              <p className="text-xs font-medium text-gray-300 mb-1.5">Texte des cartes</p>
              <select
                value={style.cards?.font ?? DEFAULT_TEXT_STYLES.title.font}
                onChange={(e) => {
                  void ensureFontLoaded(e.target.value);
                  poserZoneCartes({ font: e.target.value });
                }}
                onFocus={() => { void preloadCatalogPreview(); }}
                onPointerEnter={() => { void preloadCatalogPreview(); }}
                style={{ fontFamily: fontStack(style.cards?.font ?? DEFAULT_TEXT_STYLES.title.font) }}
                data-autopilot-font="cards"
                className="w-full rounded-lg bg-gray-800 border border-gray-700 focus:border-purple-500 outline-none px-2 py-1.5 text-sm"
              >
                {FONT_GROUPS.map((g) => (
                  <optgroup key={g.group} label={g.label}>
                    {g.fonts.map((f) => (
                      <option key={f} value={f} style={{ fontFamily: fontStack(f) }}>{f}</option>
                    ))}
                  </optgroup>
                ))}
              </select>

              <div className="flex items-center gap-2 mt-2">
                <span className="text-[11px] text-gray-500 w-20 flex-shrink-0">Taille</span>
                <input
                  type="range"
                  min={Math.round(SCALE_MIN * 100)}
                  max={Math.round(SCALE_MAX * 100)}
                  step={5}
                  value={Math.round((style.cards?.scale ?? 1) * 100)}
                  onChange={(e) => poserZoneCartes({ scale: Number(e.target.value) / 100 })}
                  aria-label="Taille du texte des cartes"
                  data-autopilot-scale="cards"
                  className="flex-1 h-1 rounded-lg appearance-none bg-gray-700 accent-purple-500 cursor-pointer"
                />
                <span className="text-[11px] text-gray-400 w-11 text-right tabular-nums">
                  {Math.round((style.cards?.scale ?? 1) * 100)}%
                </span>
              </div>

              <div className="mt-2">
                {/* Le texte des cartes n'etait ni en capitales ni aligne :
                    ses replis sont donc « Normal » et « gauche ». */}
                <TextFormatToolbar
                  zone="cards"
                  valeurs={style.cards ?? {}}
                  defauts={{ textCase: 'none', align: 'left', bold: true, italic: false }}
                  onChange={poserZoneCartes}
                />
              </div>
            </div>

            <p className="text-[11px] text-gray-500">
              L’icône choisie vaut pour cette carte sur <span className="text-gray-300">toutes
              les vidéos</span>. Le texte de la carte, lui, change à chaque fois.
            </p>
            {/* La MEME grille que « Ajouter un element » de l'assistant. */}
            <IconPicker
              dense
              autoFocus
              selected={style.cardIcons?.[String(panneau.rang)] ?? null}
              onPick={(nom) => {
                poser({
                  ...style,
                  cardIcons: { ...(style.cardIcons ?? {}), [String(panneau.rang)]: nom },
                });
                setPanneau(null);
              }}
            />
            {style.cardIcons?.[String(panneau.rang)] && (
              <button
                type="button"
                onClick={() => {
                  const suivant = { ...(style.cardIcons ?? {}) };
                  delete suivant[String(panneau.rang)];
                  poser({ ...style, cardIcons: suivant });
                  setPanneau(null);
                }}
                data-autopilot-icone-reset
                className="w-full rounded-lg border border-gray-800 px-2 py-1.5 text-[11px] text-gray-400 hover:text-white transition-colors"
              >
                Laisser l’icône du contenu généré
              </button>
            )}
          </div>
        )}
      </FloatingPanel>
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
   * Vignettes animées des grilles Transition et Animation du texte.
   *
   * Une instance par grille : épingler une transition ne doit pas faire
   * jouer une animation de texte. La réduction des animations (réglage
   * système) les fige toutes les deux.
   */
  const reduireAnimations = usePrefersReducedMotion();
  const apercuTransitions = useOptionPreview<TransitionStyle>(reduireAnimations);
  const apercuAnimations = useOptionPreview<TextAnimation>(reduireAnimations);
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
   * Configuration de l'Autopilote, remontée par son panneau.
   *
   * Elle n'existe ici QUE pour alimenter l'aperçu de la colonne de droite :
   * l'écriture reste entièrement chez `AutopilotPanel`, qui possède son état
   * et son enregistrement. Deux propriétaires pour un même réglage auraient
   * fini par se contredire.
   */
  const [autopilotConfig, setAutopilotConfig] = useState<AutopilotConfig>(AUTOPILOT_DEFAULT_CONFIG);
  /**
   * ─────────────────────────────────────────────────────────────────────
   * L'APERÇU UNIQUE
   * ─────────────────────────────────────────────────────────────────────
   *
   * Le lecteur de la vidéo produite vivait DANS la colonne de configuration,
   * sous la liste des rushes — mesuré à 3 286 px du haut de page, pendant que
   * l'aperçu du style occupait la colonne de droite. Deux endroits où
   * regarder, dont un qu'il fallait aller chercher.
   *
   * Ces trois états portent le tournage regardé jusqu'à la colonne de droite,
   * qui devient le SEUL aperçu : elle montre le projet tant qu'aucune vidéo
   * n'existe, puis la vidéo elle-même.
   */
  const [tournageRegarde, setTournageRegarde] = useState<
    { sessionId: string | null; aucunRush: boolean }
  >({ sessionId: null, aucunRush: true });
  const [relanceVideos, setRelanceVideos] = useState(0);
  const [etatVideo, setEtatVideo] = useState<'vide' | 'en_cours' | 'prete' | 'echec'>('vide');
  /** La vidéo prend la place de l'aperçu du projet dès qu'elle existe. */
  const videoOccupeLApercu = etatVideo === 'en_cours' || etatVideo === 'prete';
  /**
   * L'enregistrement du panneau, emprunte par l'apercu.
   *
   * Dans une `ref` et non un `useState` : la fonction change a chaque
   * changement de configuration, et la ranger dans l'etat provoquerait un
   * rendu de tout l'ecran a chaque frappe.
   */
  const autopilotPatchRef = useRef<((p: Partial<AutopilotConfig>) => void) | null>(null);
  const autopilotPatch = useCallback((p: Partial<AutopilotConfig>) => {
    autopilotPatchRef.current?.(p);
  }, []);

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
  /**
   * Brief de la video — objectif, message, public, CTA. `{}` = aucun brief :
   * generation et narration se comportent alors exactement comme avant.
   */
  const [brief, setBrief] = useState<VideoBrief>({});
  /**
   * L'intention « jumeau » : 'aucun' (parcours normal), 'voix' (ma voix
   * clonée narre Titre/Cartes/CTA — posée dans `ttsVoiceId` par le bloc),
   * 'avatar' (mon avatar parlant devient la séquence « Vidéo » à l'envoi,
   * AVATAR_VIDEO_COST en plus). Une intention seulement : le serveur relit
   * tout avant d'y donner suite.
   */
  const [jumeauMode, setJumeauMode] = useState<JumeauMode>('aucun');
  /** Ce que la vidéo du jumeau est devenue : placée dans la séquence « Vidéo ». */
  const [jumeauNotice, setJumeauNotice] = useState<string | null>(null);
  /**
   * Génération vidéo du jumeau EN COURS — l'identifiant serveur, persisté au
   * lancement et effacé une fois la vidéo posée. Sa présence après un
   * rechargement déclenche la REPRISE : la page a été quittée pendant le rendu.
   */
  const [jumeauGenerationId, setJumeauGenerationId] = useState<string | null>(null);
  /**
   * État de la REPRISE d'une génération orpheline au montage : 'inactif' (rien
   * en attente), 'encours' (on sonde, l'utilisateur peut quitter et revenir),
   * 'echec' (le fournisseur a échoué — un bouton « Réessayer » relance).
   */
  const [jumeauReprise, setJumeauReprise] = useState<'inactif' | 'encours' | 'echec'>('inactif');
  /** Un seul poll de reprise à la fois ; remis à faux sur échec pour permettre « Réessayer ». */
  const jumeauRepriseFaite = useRef(false);
  /** Vrai pendant que le clic d'envoi gère lui-même la génération : la reprise ne double pas. */
  const jumeauRenduEnCours = useRef(false);
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
  // ── Filtre couleur (LUT) du rush ─────────────────────────────────────
  // Seule la REFERENCE canonique vit ici (empreinte, nom, intensite) : la
  // table validee a l'import n'est jamais conservee, les octets vivent dans
  // la bibliotheque privee du compte. La nature (3D / 1D) sert au libelle de
  // support ; elle n'est pas persistee, elle est relue de la bibliotheque.
  // A ce stade ni l'apercu ni l'export ne lisent `lut` : sans filtre, le
  // rendu est strictement celui d'avant cet ajout.
  const [lut, setLut] = useState<LutRef | null>(null);
  const [lutKind, setLutKind] = useState<Lut['kind'] | null>(null);
  const [lutLoading, setLutLoading] = useState(false);
  const [lutNotice, setLutNotice] = useState<string | null>(null);
  const lutInputRef = useRef<HTMLInputElement>(null);
  // Parcours ouvert sur l'ecran d'entree — voir `ParcoursEntree`.
  const [parcours, setParcoursState] = useState<ParcoursEntree>('choix');
  useEffect(() => { setParcoursState(lireParcours()); }, []);
  const setParcours = (p: ParcoursEntree) => { ecrireParcours(p); setParcoursState(p); };
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
  // Voix TTS des deux selecteurs (panneau audio et voix par sequence). Elle
  // ne vivait que dans localStorage : le brouillon ne la connaissait pas, et
  // la voix clonee choisie revenait en « Denise » au rechargement.
  // `undefined` = aucun choix connu ici, les panneaux gardent leur regle
  // historique (localStorage) — le comportement de tous les brouillons
  // anterieurs. Ils remontent chaque choix, y compris la preselection de
  // la voix clonee, et le brouillon l'ecrit.
  const [ttsVoiceId, setTtsVoiceId] = useState<string | undefined>(undefined);
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
  /**
   * Style des cartes.
   *
   * ⚠️ IL ETAIT FIGE A `'Compact'`, alors que « Sans cadre » existait deja
   * dans la liste des styles et que le compositeur savait deja le dessiner
   * (`if (cardStyle === 'Text Only')`). Ce n'etait donc pas une
   * fonctionnalite a ecrire, mais un choix a rendre a l'utilisateur.
   *
   * Le defaut reste `'Compact'` : c'est ce que tous les montages existants
   * ont recu.
   */
  const [cardStyle, setCardStyle] = useState<string>(DEFAULT_CARD_STYLE);
  /**
   * Typographie du texte des cartes.
   *
   * ⚠️ VIDE PAR DEFAUT : les cartes n'avaient aucun reglage, et l'absence
   * doit rendre exactement ce qu'elles rendaient. `SequenceCards` est
   * PHOTOGRAPHIE puis blitte dans la video — regler ici suffit donc a la
   * parite, sans toucher au compositeur.
   */
  const [cardsTypography, setCardsTypography] = useState<CardsTypography>({});
  const patchCards = useCallback((patch: Partial<CardsTypography>) => {
    setCardsTypography((prev) => ({ ...prev, ...patch }));
  }, []);

  /**
   * Prise d'une poignee de coin sur une carte — agrandit son TEXTE.
   *
   * Le rapport des distances au centre, comme les elements libres : eloigner
   * le coin agrandit, le rapprocher retrecit, sans saut a la prise. Un
   * `pointermove` natif suffit — inutile d'entrer dans la machine de
   * glissement du plateau, qui borne des positions dont il n'est pas
   * question ici.
   */
  const startCardTextResize = useCallback((_id: string, e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0 || !e.isPrimary) return;
    const carte = (e.currentTarget as HTMLElement).parentElement;
    const box = carte?.getBoundingClientRect();
    if (!box) return;
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const depart = Math.max(1, Math.hypot(e.clientX - cx, e.clientY - cy));
    const echelleDepart = cardsTypography.scale ?? 1;
    const cible = e.currentTarget as HTMLElement;
    const bouger = (ev: PointerEvent) => {
      const d = Math.max(1, Math.hypot(ev.clientX - cx, ev.clientY - cy));
      const brut = echelleDepart * (d / depart);
      patchCards({ scale: Math.min(SCALE_MAX, Math.max(SCALE_MIN, brut)) });
    };
    const finir = () => {
      cible.removeEventListener('pointermove', bouger);
      cible.removeEventListener('pointerup', finir);
      cible.removeEventListener('pointercancel', finir);
    };
    try { cible.setPointerCapture?.(e.pointerId); } catch { /* pointeur deja relache */ }
    cible.addEventListener('pointermove', bouger);
    cible.addEventListener('pointerup', finir);
    cible.addEventListener('pointercancel', finir);
  }, [cardsTypography.scale, patchCards]);

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
  /**
   * Zone ouverte au double-clic sur l'apercu — assistant.
   *
   * ⚠️ ICI LE CONTENU EST EDITABLE, contrairement a l'Autopilote. L'assistant
   * produit UN montage, dont l'utilisateur relit le texte avant de l'envoyer ;
   * l'Autopilote en produit un different a chaque cycle, et y figer une phrase
   * detruirait la variete qui fait tout son interet.
   */
  const [zoneOuverte, setZoneOuverte] = useState<
    'title' | 'subtitle' | 'cta' | 'cards' | null
  >(null);
  const [zonePos, setZonePos] = useState({ x: 0, y: 0 });
  const ouvrirZone = useCallback((zone: 'title' | 'subtitle' | 'cta' | 'cards') => {
    setZonePos({
      x: Math.min(Math.max(12, window.innerWidth / 2), window.innerWidth - 340),
      y: Math.max(80, window.innerHeight / 2 - 220),
    });
    setZoneOuverte(zone);
  }, []);

  const [scheduledDate, setScheduledDate] = useState('');
  /**
   * Heure de publication du post.
   *
   * `12:00` par defaut — exactement la valeur qui etait ecrite en dur dans le
   * `POST /api/posts`. Un lot existant qui ne touche pas ce champ produit donc
   * strictement les memes posts qu'avant.
   */
  const [scheduledTime, setScheduledTime] = useState('12:00');
  /**
   * Ce que l'envoi fait du post — l'intention, dite explicitement.
   *
   * `brouillon` par defaut : le post part en `draft`, sans plateforme —
   * exactement ce que l'envoi a toujours fait. Aucun cron ne publie un
   * brouillon (`/api/cron/publish` ne lit que `status = 'scheduled'`).
   *
   * `programmer` : le post part en `scheduled` avec les reseaux choisis
   * ci-dessous, et c'est le cron de publication qui le diffuse a la date et
   * l'heure saisies — le MEME mecanisme que « Programmer » dans le
   * Calendrier, sans passer par lui.
   *
   * Le telechargement n'est pas une troisieme valeur : il ne cree aucun post
   * (`runRender('bureau')`), il n'a donc rien a ecrire ici.
   *
   * Non persiste dans le brouillon local : a la reouverture, on repart en
   * `brouillon` — le choix le plus sur, jamais une publication surprise.
   */
  const [envoiIntention, setEnvoiIntention] = useState<'brouillon' | 'programmer'>('brouillon');
  /** Les reseaux (identifiants minuscules, ceux du cron et de l'Autopilote) vises par `programmer`. */
  const [reseauxProgrammes, setReseauxProgrammes] = useState<Reseau[]>([]);
  /**
   * L'etat des reseaux du compte — la MEME lecture que l'ecran Reseaux et le
   * Calendrier (`useEtatReseaux`). Seuls les reseaux `connecte` sont
   * proposes a la programmation : programmer sur un reseau non connecte
   * ferait un post que le cron marquerait « failed » a l'heure dite.
   *
   * Lue SEULEMENT a l'etape Envoi : le wizard est monte des « Sujet », et
   * appeler `/api/social/*` a chaque ouverture pour un choix qui n'apparait
   * qu'a la derniere etape serait du trafic pour rien.
   */
  const etatReseaux = useEtatReseaux(step === S.envoi);
  const reseauxConnectes: Reseau[] = etatReseaux.reseaux
    ? RESEAUX.filter((r) => etatReseaux.reseaux![r].etat === 'connecte')
    : [];
  /**
   * La politique de facturation, telle que le SERVEUR l'a decidee.
   *
   * `credits` par defaut, et tant que la reponse n'est pas arrivee : un
   * ecran qui annonce un prix a quelqu'un qui ne paiera pas dit une chose
   * inutile ; un ecran qui promet la gratuite a quelqu'un qui sera debite
   * ment sur de l'argent. Le defaut penche du cote reparable.
   *
   * Rien ici ne DECIDE : ni `isAdmin`, ni une adresse, ni un role lu dans la
   * session. On relaie ce que `/api/credits/balance` a repondu, et le debit
   * reel reste tranche par le serveur, seul, a la confirmation du rendu.
   */
  const [politiqueFacturation, setPolitiqueFacturation] = useState<Politique>('credits');

  /**
   * Les tarifs, tels que le SERVEUR les lit dans `tarifs_rendu`.
   *
   * `null` tant qu'on ne les a pas — et l'ecran ecrit alors « Tarif confirmé
   * au rendu » plutot qu'un prix calcule sur une constante locale. Le prix
   * affiche et le prix preleve viennent desormais de la meme table.
   */
  const [tarifsServeur, setTarifsServeur] = useState<Tarifs>(null);

  /**
   * Le verrou de lancement.
   *
   * `sending` grise bien le bouton, mais seulement au rendu suivant : deux
   * clics dans le meme tour le lisent tous les deux a `false` et lancent DEUX
   * series, donc quatre tentatives.
   */
  const { prendre, rendre, actif } = useVerrous();
  const [sending, setSending] = useState(false);
  /**
   * Ce que `runRender` est en train de produire, ou `null`.
   *
   * ⚠️ `sending` NE SUFFIT PLUS. Il vaut `true` pour les trois destinations —
   * calendrier, bureau, aperçu — alors que l'état de chargement doit
   * s'afficher DANS le cadre pour le seul aperçu. Sans cette distinction, un
   * envoi au calendrier recouvrirait le plateau d'un voile « Composition du
   * montage… » qui ne le concerne pas.
   */
  const [renderTarget, setRenderTarget] = useState<'calendrier' | 'bureau' | 'apercu' | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Lit la politique une fois au montage.
   *
   * `/api/credits/balance` la renvoie deja -- c'est la meme porte que la
   * barre superieure. Aucun appel supplementaire n'est ajoute au parcours,
   * et l'echec est silencieux : on reste sur `credits`.
   */
  useEffect(() => {
    let vivant = true;
    fetch('/api/credits/balance')
      .then((r) => r.json())
      .then((d) => { if (vivant) setPolitiqueFacturation(politiqueAffichable(d?.politique)); })
      .catch(() => { /* le defaut `credits` tient */ });
    // Le tarif vient de la meme table que le debit. Un echec laisse
    // `tarifsServeur` a `null`, et l'ecran l'avoue au lieu de deviner.
    fetch('/api/render/tarifs')
      .then((r) => r.json())
      .then((d) => { if (vivant) setTarifsServeur(tarifsAffichables(d?.tarifs)); })
      .catch(() => { /* « Tarif confirmé au rendu » */ });
    return () => { vivant = false; };
  }, []);

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
  /**
   * Pourquoi la grille est vide.
   *
   * `photosError` ne portait qu'un texte : impossible d'en deduire s'il
   * fallait proposer « Réessayer ». Un refus du fournisseur et une recherche
   * sans resultat s'affichaient pareil, et le second message etait faux.
   */
  const [photosEtat, setPhotosEtat] = useState<EtatPhotos | null>(null);
  /** La derniere recherche, pour la rejouer telle quelle. */
  const derniereRecherche = useRef<{ query: string; source: 'pexels' | 'unsplash' } | null>(null);
  const [photoQuery, setPhotoQuery] = useState('');
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photosError, setPhotosError] = useState<string | null>(null);
  const [posterUploading, setPosterUploading] = useState(false);
  // Les deux autres chemins vers une affiche : la mediatheque (images deja
  // envoyees) et la generation IA. Un seul ouvert a la fois.
  const [afficheLibOpen, setAfficheLibOpen] = useState(false);
  const [afficheIAOuvert, setAfficheIAOuvert] = useState(false);
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
  /**
   * Etat de CHAQUE contenu du lot — en attente, rendu, pret ou echoue.
   *
   * `batchProgress` ne dit que « x sur y » : quand le lot s'arrete en route,
   * il ne dit ni lequel a echoue, ni lesquels n'ont jamais demarre. Cette
   * liste survit a la fin de la boucle, c'est ce qui permet d'afficher un
   * echec partiel au lieu d'un simple message d'erreur.
   */
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  /**
   * Mode du lot, DEDUIT de `batchCount` : un seul contenu, ou une serie.
   *
   * Volontairement pas un second `useState` — deux sources de verite pour la
   * meme chose finissent par se contredire, et c'est le nombre qui compte
   * partout ailleurs (cout, dates, affiches, boucle).
   */
  const modeLot: 'unique' | 'serie' = batchCount > 1 ? 'serie' : 'unique';
  const [elementPickerOpen, setElementPickerOpen] = useState(false);
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
    derniereRecherche.current = { query: q, source };
    setPhotosLoading(true);
    setPhotosError(null);
    setPhotosEtat(null);
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
        // La route distingue desormais quatre raisons : source non
        // configuree, cle refusee, quota atteint, ou simplement rien trouve.
        // Les confondre faisait reformuler une requete que le fournisseur
        // n'avait jamais executee.
        const etat = etatDepuisReponse(data);
        setPhotosEtat(etat);
        setPhotosError(messagePhotos(etat, source));
      }
    } catch {
      setPosterPhotos([]);
      setPhotosEtat('indisponible');
      setPhotosError(messagePhotos('indisponible', source));
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
   *
   * Sans resultat de recherche (montage, brouillon restaure, recherche vide),
   * on ne touche a rien : l'effet tournait au montage avec une liste vide et
   * ecrasait les affiches restaurees depuis le brouillon — un lot de dix
   * revenait sans aucune photo et etait refuse au depart. Les resultats de
   * recherche ne sont PAS enregistres dans le brouillon, les affiches
   * retenues le sont : au rechargement, ce sont elles qui font foi.
   *
   * Avec des resultats, la regle est celle de `reattribuerAffichesAuto` : une
   * recherche qui fournit assez de photos distinctes remplace le lot (c'est
   * le sens du bouton « Autres photos ») ; une recherche qui n'en fournit
   * pas assez COMPLETE le lot existant sans jamais le degrader.
   *
   * Forme fonctionnelle de `setBatchPhotoUrls` : lire `batchPhotoUrls` par
   * les dependances relancerait l'effet a chaque remplacement manuel d'un
   * emplacement, et l'ecraserait.
   */
  useEffect(() => {
    if (batchPhotoMode !== 'auto' || batchCount < 2) return;
    if (posterPhotos.length === 0) return;
    const candidates = posterPhotos.map((p) => p.url);
    setBatchPhotoUrls((prev) => reattribuerAffichesAuto(prev, candidates, batchCount));
  }, [batchPhotoMode, batchCount, posterPhotos]);

  /** Affiches distinctes disponibles — ce qui borne l'attribution auto. */
  const affichesDisponibles = distinctUrls(posterPhotos.map((p) => p.url)).length;

  /** Le lot peut-il partir ? Une affiche par video, toutes differentes. */
  const affichesCompletes = batchPhotosReady(batchPhotoUrls, batchCount);

  /**
   * Affiches reellement posees. `filter(Boolean)` et non `.length` : un
   * echange d'emplacements (`assignerAffiche`) laisse une chaine vide, qui
   * n'est pas une affiche.
   */
  const affichesRetenues = batchPhotoUrls.filter(Boolean).length;

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
  /**
   * La tentative CONFIRMEE qui a paye le montage garde en memoire.
   *
   * Sans elle, « le blob existe » suffisait a le reutiliser pour le
   * Calendrier -- et un blob peut arriver la par un chemin qui n'a rien
   * facture. On exige donc la preuve elle-meme, pas sa consequence.
   *
   * `url` est celle de la CLE ATTRIBUEE PAR LE SERVEUR : le montage y est
   * deja, vu et verifie. Le Calendrier la relit telle quelle plutot que de
   * televerser une seconde copie vers une cle choisie par le navigateur.
   */
  const previewRenduRef = useRef<{ jobId: string; url: string | null } | null>(null);

  /** Remplace le montage en cache, et libère l'URL du précédent. */
  const setPreviewRender = useCallback((
    blob: Blob | null,
    signature: string | null,
    thumbnail: Blob | null = null,
    rendu: { jobId: string; url: string | null } | null = null,
  ) => {
    previewThumbRef.current = thumbnail;
    // La preuve suit le blob : effacer l'un sans l'autre laisserait un
    // montage reutilisable adosse a une tentative qui n'est plus la sienne.
    previewRenduRef.current = blob ? rendu : null;
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

  /**
   * Une image generee par l'IA arrive DEJA enregistree : le serveur
   * (`/api/ai/image`, action `generate-bg`) copie lui-meme l'image produite
   * dans le stockage Studiio et renvoie une URL durable. Le navigateur ne
   * telecharge jamais une URL du fournisseur, et n'envoie rien au stockage.
   *
   * Une image qui n'est pas enregistree n'est PAS appliquee : on refuse
   * (l'erreur remonte a `AfficheIA`, qui l'affiche) plutot que de ranger dans
   * le brouillon une URL qui mourra en une heure. Rien n'est touche dans ce
   * cas — ni `posterUrl`, ni la grille des photos.
   *
   * Si elle l'est : elle rejoint la grille en tete, puis `applyPhoto` la
   * pose (affiche globale, ou fond de la sequence affichee). L'attribution
   * aux videos d'une serie reste l'affaire de `reattribuerAffichesAuto`.
   */
  const utiliserAfficheIA = useCallback(async (url: string) => {
    if (!estAfficheDurable(url)) {
      throw new Error('Cette affiche n’a pas été enregistrée dans le stockage : elle n’a pas été appliquée.');
    }
    const perso: PosterPhoto = { id: `ia-${Date.now()}`, url, small: url, photographer: 'Générée par l’IA', source: 'upload' };
    setPosterPhotos((prev) => [perso, ...prev]);
    applyPhotoRef.current?.(url);
  }, []);

  const applyPhotoRef = useRef<((url: string) => void) | null>(null);

  const applyPhoto = useCallback((url: string) => {
    const cle = seqBgKeyForFocus(previewFocusRef.current);
    if (!cle) {
      setPosterUrl(url);
      return;
    }
    // Nouveau fond = nouveau cadrage : le precedent visait une autre image.
    setSeqBackgrounds((prev) => ({ ...prev, [cle]: { url, transform: POSTER_TRANSFORM_NEUTRAL } }));
  }, []);
  // Le chemin IA (defini plus haut, sans dependance) applique via cette ref.
  useEffect(() => { applyPhotoRef.current = applyPhoto; }, [applyPhoto]);

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

  /**
   * Import d'un filtre couleur.
   *
   * Le fichier est PRE-VALIDE par le socle avant tout envoi (un `.cube`
   * tronque ne coute aucun aller-retour), un PNG est canonicalise en `.cube`,
   * puis l'API commune de la bibliotheque revalide, hache, range l'objet
   * prive et rend la fiche. Le champ est remis a zero dans le `finally` —
   * sans quoi reselectionner le meme fichier apres un echec ne declenche
   * aucun `change`, et l'ecran parait fige.
   */
  const handleLutFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    setLutLoading(true);
    setError(null);
    setLutNotice(null);
    try {
      const { ref, asset, issue, avertissement } = await importLutFile(file, {
        envoyer: envoyerLutApi,
        decodeImage: decodeImageInBrowser,
      });
      setLut(ref);
      setLutKind(asset.kind);
      setLutNotice(
        issue === 'existante'
          ? `Ce filtre était déjà dans votre bibliothèque : « ${asset.nom} ».`
          : avertissement ?? null,
      );
      console.log(`[Assistant] Filtre couleur importé : ${asset.nom} (${issue})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Filtre illisible.');
    } finally {
      setLutLoading(false);
      input.value = '';
    }
  };

  /**
   * Une reference relue d'un brouillon ne dit pas la nature du filtre, ni
   * s'il existe encore dans la bibliotheque : on la relit une fois. Absente de
   * la bibliotheque (supprimee entre-temps) → la reference est retiree, elle
   * ne designe plus rien. Appel impossible → on garde la reference, sans rien
   * en deduire.
   */
  useEffect(() => {
    if (!lut || lutKind !== null) return;
    let annule = false;
    listerLutsApi().then((luts) => {
      if (annule || !luts) return;
      const fiche = luts.find((l) => l.empreinte === lut.empreinte);
      if (fiche) {
        setLutKind(fiche.kind);
      } else {
        console.warn('[Assistant] Filtre du brouillon absent de la bibliothèque, retiré.');
        setLut(null);
      }
    });
    return () => { annule = true; };
    // `lutKind` volontairement hors dependances : c'est lui qu'on renseigne.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lut?.empreinte]);

  /**
   * Ce que le filtre fait AUJOURD'HUI, derive par le socle — jamais decide
   * ici. Tant qu'aucun moteur ne consomme les LUT importees, le libelle le
   * dit : l'interface ne laisse pas croire a un rendu qui n'existe pas.
   */
  const lutSupportLibelle = lut
    ? LIBELLES_SUPPORT[
        lutKind
          ? supportDeLut(lutKind)
          // Nature inconnue (bibliotheque injoignable) : le statut le MOINS
          // capable des deux natures — jamais une promesse par defaut.
          : (['3d', '1d'] as const)
              .map((k) => supportDeLut(k))
              .sort((a, b) => ORDRE_SUPPORT.indexOf(a) - ORDRE_SUPPORT.indexOf(b))[0]
      ]
    : null;

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
  const [dragGaps, setDragGaps] = useState<GapBadge[]>([]);
  /**
   * Bloc dont la regle est affichee — `data-guide-key`, ou `null`.
   *
   * ⚠️ IL SURVIT AU GESTE. Les ecarts n'existaient que PENDANT un glissement :
   * des qu'on lachait le bloc, ils disparaissaient, et lire la distance entre
   * deux blocs deja poses etait impossible.
   */
  const [measuredKey, setMeasuredKey] = useState<string | null>(null);
  /** Emprise du bloc mesure — dessine son cadre de selection magenta. */
  const [dragSelection, setDragSelection] = useState<ElementBox | null>(null);

  /**
   * Mesure PERSISTANTE du bloc selectionne.
   *
   * ⚠️ SANS TABLEAU DE DEPENDANCES, ET C'EST VOULU. L'emprise d'un bloc
   * depend de son texte, de sa police, de son echelle, du format, de la
   * sequence affichee — trop d'etats pour une liste qu'on tiendrait a jour
   * sans en oublier un (et une mesure perimee a l'ecran ne se voit pas).
   * L'apercu se re-rend deja a chaque changement : on mesure apres CHAQUE
   * rendu, et `sameGaps` coupe la boucle — sans changement, aucun `setState`.
   *
   * Pendant un glissement, c'est `snapAndGuide` qui pilote : lui connait la
   * position aimantee, que le DOM n'a pas encore rendue.
   */
  useEffect(() => {
    if (dragRef.current) return;
    const vide = () => {
      setDragGaps((prev) => (prev.length ? [] : prev));
      setDragGuides((prev) => (prev.length ? [] : prev));
      setDragSelection((prev) => (prev ? null : prev));
    };
    if (!measuredKey || capturing) return vide();
    const boites = collectGuideBoxes(previewRef.current);
    const active = boites.find((b) => b.key === measuredKey) ?? null;
    if (!active) return vide();
    const autres = boites.filter((b) => b.key !== measuredKey);
    const suivant = computeGapBadges(active, autres, format);
    const lignes = onePerAxis(computeAlignmentLines(active, autres, format));
    setDragGaps((prev) => (sameGaps(prev, suivant) ? prev : suivant));
    setDragGuides((prev) => (sameGuides(prev, lignes) ? prev : lignes));
    setDragSelection((prev) => (sameBox(prev, active) ? prev : active));
  });

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
   * Aimante une position d'ancre, trace les guides et mesure les ecarts.
   *
   * Le calcul passe par le CENTRE : aimanter l'ancre reviendrait a centrer le
   * bord gauche du titre sur l'axe, visiblement decale de la moitie de sa
   * largeur.
   *
   * Les ecarts, eux, sont mesures BORD A BORD sur la boite reellement rendue
   * — `exclure` est aussi le `data-guide-key` de l'element deplace. Le DOM
   * ayant un rendu de retard, la boite est translatee de l'ecart entre son
   * centre rendu et le centre aimante ; sa taille, elle, ne bouge pas.
   */
  const snapAndGuide = useCallback((
    pos: Pos,
    anchor: Anchor,
    box: { width: number; height: number },
    exclure: string,
    guideKey: string = exclure,
  ): Pos => {
    const autres = alignmentTargets(exclure);
    const boites = collectGuideBoxes(previewRef.current);
    const rendue = boites.find((b) => b.key === guideKey) ?? null;
    const autresBoites = boites.filter((b) => b.key !== guideKey);
    const centre = anchorToCenter(pos, anchor, box);
    // `centre` est deja un centre : aucun `anchorOffset` a corriger.
    const snap = snapPosition(centre.x, centre.y, autres, { thirds: true, boxes: autresBoites });
    // Le bloc deplace devient le bloc MESURE : au relachement, sa regle reste
    // affichee au lieu de disparaitre avec le geste.
    setMeasuredKey(guideKey);
    const boiteActive = rendue
      ? shiftBox(rendue, snap.x - boxCenter(rendue).x, snap.y - boxCenter(rendue).y)
      : null;
    setDragGuides(
      boiteActive
        // La cible AIMANTEE d'abord : elle a la priorite quand plusieurs
        // coincidences tombent sur le meme axe.
        ? onePerAxis(mergeGuides(snap.guides, computeAlignmentLines(boiteActive, autresBoites, format)))
        : onePerAxis(snap.guides),
    );
    setDragSelection(boiteActive);
    setDragGaps(boiteActive ? computeGapBadges(boiteActive, autresBoites, format) : []);
    return centerToAnchor({ x: snap.x, y: snap.y }, anchor, box);
  }, [alignmentTargets, format]);

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
      const aimante = snapAndGuide(raw, 'center', drag.box, id, `element:${id}`);
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
    const aimante = snapAndGuide(raw, ancre, drag.box, drag.el);
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
    // Les LIGNES magnetiques n'existent que le temps du geste — elles disent
    // « ca s'aligne en ce moment ». Les ECARTS, eux, restent : ils repondent a
    // « quelle distance entre ces deux blocs », question qui survit au geste.
    // C'est l'effet de mesure persistante qui les reprend au rendu suivant.
    setDragGuides([]);
  }, []);
  /**
   * Facteur de reduction du plateau : largeur affichee / largeur video.
   *
   * ⚠️ LA MESURE PASSE PAR UNE REF DE RAPPEL, ET C'EST LE CORRECTIF DE
   * L'APERCU VIDE. L'effet qui vivait ici tournait au montage de l'ECRAN,
   * alors que le cadre n'est monte qu'apres « Commencer »
   * (`{!started ? … : …}`, PR #326) : `frameRef.current` valait `null`,
   * l'effet sortait aussitot, et ses dependances `[format]` ne changeant
   * jamais il ne repassait PLUS. `displayScale` restait a 0, le plateau
   * recevait `transform: scale(0)`, et tout son contenu mesurait 0 x 0 —
   * present dans le DOM, correctement style, et invisible.
   */
  const { frameRef, setFrame, displayScale } = useFrameScale(VIDEO_SIZE[format].w);

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

  /**
   * Identifiant du contenu a modifier, lu dans l'URL.
   *
   * Depuis l'URL et non depuis une propriete : la signature du composant est
   * lue TELLE QUELLE par sept tests du depot, qui bornent le source sur
   * `export default function AssistantWizard()`. Lui ajouter un parametre les
   * fait tous porter sur la mauvaise tranche de fichier — un lot de
   * modification n'a aucune raison de rendre fragiles les tests de l'apercu et
   * des cartes. C'est aussi le chemin que suit deja l'editeur avance.
   *
   * Le triage lui-meme reste dans `editTarget`, partage avec la page serveur.
   */
  const urlParams = useSearchParams();
  const cibleEdition = readEditTargetFromQuery(urlParams);
  const editPostId = cibleEdition.kind === 'edit' ? cibleEdition.postId : undefined;

  /**
   * ─────────────────────────────────────────────────────────────────────
   * MODIFICATION D'UN CONTENU EXISTANT
   * ─────────────────────────────────────────────────────────────────────
   *
   * `editPostId` absent = creation : TOUT ce bloc reste inerte, et le parcours
   * se comporte exactement comme avant ce lot.
   *
   * `chargement` decrit l'etat de la LECTURE seule. Rien n'est rendu, debite,
   * publie ni programme ici : ouvrir un contenu pour le regarder ne doit rien
   * couter. L'ecriture, elle, n'a lieu que sur une action explicite.
   */
  const [chargement, setChargement] = useState<
    { etat: 'inactif' } | { etat: 'encours' } | { etat: 'charge' } | { etat: 'echec'; issue: ChargementPost['kind'] }
  >(editPostId ? { etat: 'encours' } : { etat: 'inactif' });
  /** Le post tel que le serveur l'a rendu. Sert de base a l'enregistrement. */
  const postCharge = useRef<PostAModifier | null>(null);
  /** Vrai une fois le chargement TENTE : il n'a lieu qu'une fois. */
  const chargeRef = useRef(false);
  /**
   * Empreinte de l'ecran AU CHARGEMENT — la reference du « rien n'a change ».
   *
   * Sans elle, un enregistrement qui ne modifie rien reecrirait quand meme tout,
   * et reecrire c'est risquer de perdre : c'est ainsi que le gros texte des
   * posts venus de l'editeur avance disparaissait.
   */
  const valeursChargees = useRef<ValeursWizard | null>(null);
  /** Leve a la fin de l'hydratation ; l'empreinte est prise au rendu suivant. */
  const aCapturer = useRef(false);
  /**
   * Les cartes D'ORIGINE, indexees par l'identifiant que l'ecran leur donne.
   *
   * L'ecran ne porte que cinq champs par carte ; la metadata en compte sept
   * (`position`, `textOnly` et la couleur propre en plus). Reconstruire une
   * carte a partir de ce qui est affiche revenait donc a supprimer ce que ce
   * parcours ignore. On garde l'original sous la main pour n'y appliquer que
   * ce que l'utilisateur regle vraiment.
   */
  const cartesOrigine = useRef<ReadonlyMap<string, Record<string, unknown>>>(new Map());
  /** L'accent EN PLACE AU CHARGEMENT : il dit quelles cartes le suivaient. */
  const accentCharge = useRef<string | undefined>(undefined);

  /** Etat du dernier enregistrement demande. `repos` = rien en cours. */
  const [enregistrement, setEnregistrement] = useState<
    { etat: 'repos' } | { etat: 'encours' } | { etat: 'ok' }
    | { etat: 'echec'; issue: Enregistrement['kind'] }
  >({ etat: 'repos' });

  /**
   * Rechargement de la version en base, apres un conflit.
   *
   * `demande` est l'etape de CONFIRMATION, et elle n'est pas decorative :
   * reprendre la version serveur remplace ce qui est a l'ecran. Le faire sur un
   * seul clic effacerait, sans un mot, le travail que le conflit vient
   * justement de sauver.
   */
  const [rechargement, setRechargement] = useState<
    { etat: 'repos' } | { etat: 'demande' } | { etat: 'encours' }
    | { etat: 'echec'; issue: ChargementPost['kind'] }
  >({ etat: 'repos' });
  /**
   * Compteur d'hydratations. Il n'existe que pour RELANCER l'effet de
   * remplissage : `chargement.etat` vaut deja « charge », et le remettre a la
   * meme valeur ne declencherait rien.
   */
  const [hydratations, setHydratations] = useState(0);

  useEffect(() => {
    if (!editPostId || !sessionReady || chargeRef.current) return;
    chargeRef.current = true;
    let vivant = true;
    (async () => {
      const r = await chargerPostAModifier(editPostId, (u, i) => fetch(u, i));
      if (!vivant) return;
      if (r.kind === 'ok') {
        postCharge.current = r.post;
        setChargement({ etat: 'charge' });
      } else {
        setChargement({ etat: 'echec', issue: r.kind });
      }
    })();
    return () => { vivant = false; };
  }, [editPostId, sessionReady]);
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
    jumeauMode,
    // Champ historique, DÉRIVÉ : les anciens lecteurs y lisent « avatar demandé ».
    useDigitalTwin: jumeauMode === 'avatar',
    // Génération vidéo du jumeau en attente : persistée pour permettre la
    // reprise si la page se ferme pendant le rendu. `undefined` = rien en
    // attente, comme tous les brouillons antérieurs.
    jumeauGenerationId: jumeauGenerationId ?? undefined,
    started,
    step,
    themeId,
    customTopic,
    // Seuls les champs renseignes ; `undefined` sans brief, pour qu'un
    // brouillon sans ce champ se relise exactement comme avant.
    brief: briefRempli(brief) ? sanitizeBrief(brief) : undefined,
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
        // Texte au moment de la generation : sert au badge « audio perime »
        // apres rechargement, quand le texte a ete retouche.
        textAtGeneration: sequenceVoices[k].textAtGeneration,
      }]),
    ),
    sequenceVoicesUserEdited,
    voiceName,
    // `undefined` tant qu'aucun choix n'est remonte : un brouillon sans ce
    // champ se relit exactement comme avant.
    ttsVoiceId,
    musicVolume,
    voiceVolume,
    rushUrl: persistableDraftUrl(rushUrl),
    rushName,
    rushIsClip,
    // La reference canonique seule. `undefined` sans filtre, pour qu'un
    // brouillon sans ce champ se relise exactement comme avant.
    lut: lut ?? undefined,
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
    started, step, themeId, customTopic, brief, toneId, format, colors, jumeauMode, jumeauGenerationId,
    titleStyle, subtitleStyle, ctaStyle, watermarkOverride, watermarkEnabled,
    sequences, introDuration, cardsDuration, videoDuration, ctaDuration,
    transition,
    textAnimation,
    generated, audioKeyframes, musicUrl, musicName, voiceUrl, voiceName, musicVolume,
    sequenceVoices, sequenceVoicesUserEdited, ttsVoiceId,
    voiceVolume, rushUrl, rushName, rushIsClip, lut, scheduledDate,
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
    // MODIFICATION : on attend le contenu du serveur. Remplir depuis le
    // brouillon local en attendant, puis le remplacer, ferait clignoter un
    // autre montage a l'ecran — et si le chargement echouait, le brouillon
    // d'une creation precedente prendrait la place du contenu demande.
    if (editPostId && chargement.etat !== 'charge') return;
    restoredRef.current = true;
    // LA SOURCE, ET C'EST TOUT CE QUI CHANGE ICI.
    //
    // En modification, elle est le SERVEUR — le brouillon local n'est meme pas
    // lu. C'est ce qui garantit qu'un brouillon d'hier n'ecrase jamais, sans un
    // mot, le contenu qu'on vient d'ouvrir : les deux ne peuvent pas se
    // disputer l'ecran, l'un des deux n'est pas dans la piece.
    //
    // Les deux sources passent ensuite par le MEME `sanitizeDraft` : une
    // metadata abimee est bornee et ecartee exactement comme un brouillon
    // abime, ce que le depot sait deja encaisser.
    const source = editPostId
      ? toWizardDraft(postCharge.current ?? {})
      : readDraft(storageKey);
    const draft = sanitizeDraft(source, {
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
    setBrief(draft.brief ?? {});
    setToneId(draft.toneId!);
    setFormat(draft.format as Format);
    setColors(draft.colors ?? null);
    setTitleStyle(draft.titleStyle as TextStyles['title']);
    setSubtitleStyle(draft.subtitleStyle as TextStyles['subtitle']);
    setCtaStyle(draft.ctaStyle as TextStyles['cta']);
    setWatermarkOverride(draft.watermarkOverride ?? null);
    setWatermarkEnabled(draft.watermarkEnabled !== false);
    // `sanitizeDraft` a déjà tranché : `jumeauMode` explicite, sinon l'ancien
    // `useDigitalTwin: true` → 'avatar', sinon 'aucun'.
    setJumeauMode(draft.jumeauMode ?? 'aucun');
    // BUG B — génération orpheline : un identifiant persisté signale une vidéo
    // de jumeau lancée mais jamais montée (page fermée pendant le rendu). On
    // REPREND son suivi ici, sans en lancer une seconde ; si le rush porte déjà
    // cette génération, `reprendreJumeau` n'a rien à faire.
    if (draft.jumeauGenerationId) {
      setJumeauGenerationId(draft.jumeauGenerationId);
      reprendreJumeauRef.current(draft.jumeauGenerationId, draft.rushUrl);
    }
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
            textAtGeneration: v.textAtGeneration,
            // Duree volontairement absente : elle sera remesuree.
          };
        }
        return next;
      });
    }
    if (draft.sequenceVoicesUserEdited) {
      setSequenceVoicesUserEdited((prev) => ({ ...prev, ...draft.sequenceVoicesUserEdited }));
    }
    // La voix restauree prime sur localStorage ET sur la preselection de la
    // voix clonee : les panneaux ne remplacent jamais un choix hors defaut.
    if (draft.ttsVoiceId) setTtsVoiceId(draft.ttsVoiceId);
    setMusicVolume(draft.musicVolume!);
    setVoiceVolume(draft.voiceVolume!);
    if (draft.rushUrl) {
      setRushUrl(draft.rushUrl);
      setRushName(draft.rushName ?? '');
      setRushIsClip(!!draft.rushIsClip);
    }
    if (draft.lut) setLut(draft.lut);
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
    // Un brouillon enregistre AVANT la fermeture de la serie porte encore son
    // nombre : le relire tel quel rouvrirait le mode sans qu'aucun bouton ait
    // ete touche. Tout passe par la meme porte.
    if (draft.batchCount) setBatchCount(batchCountAutorise(draft.batchCount));
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
    if (editPostId) {
      // Le prochain rendu portera le contenu du serveur : c'est LUI qu'il faut
      // photographier pour savoir, plus tard, ce que l'utilisateur a change.
      aCapturer.current = true;
      // Meme instant, meme raison : l'index des cartes n'est fiable qu'ICI,
      // ou leur rang correspond encore a celui de la metadata. Ensuite
      // l'utilisateur peut en ajouter, en retirer ou les deplacer.
      cartesOrigine.current = indexerCartesOrigine(postCharge.current?.metadata);
      const brandingCharge = (postCharge.current?.metadata as
        { branding?: { accentColor?: unknown } } | undefined)?.branding;
      accentCharge.current = typeof brandingCharge?.accentColor === 'string'
        ? brandingCharge.accentColor
        : undefined;
      // « Brouillon restaure » serait faux ici : rien n'a ete retrouve, on a
      // ouvert un contenu enregistre. Le dire exactement evite de faire croire
      // a une reprise de travail perdu.
      setRestoredNotice(
        `Contenu chargé${bits.length ? ` (${bits.join(', ')})` : ''}. Vos modifications ne sont enregistrées que lorsque vous le demandez.`,
      );
    } else if (draft.started || draft.generated) {
      setRestoredNotice(`Brouillon restauré${bits.length ? ` (${bits.join(', ')})` : ''}.`);
    }
    // `restoredRef` garantit un seul passage : une fois la session resolue,
    // relancer la restauration ecraserait ce que l'utilisateur vient de regler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionReady, storageKey, editPostId, chargement.etat, hydratations]);

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
    // MODIFICATION : aucun brouillon local n'est ecrit. Le contenu d'un post
    // n'a rien a faire dans le brouillon des CREATIONS — il y prendrait la
    // place du travail en cours, et la creation suivante rouvrirait le post
    // qu'on vient de modifier en croyant reprendre son brouillon. Le contenu
    // vit deja au serveur ; sa copie locale n'apporte rien et peut nuire.
    if (editPostId) return;
    const draft = draftRef.current();
    if (!draft.started && !draft.generated) return;
    writeDraft(storageKey, draft);
  }, [editPostId, storageKey, sessionReady]);
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
  const activeOrder = ordreActif(sequences);

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
    // Le MEME champ que le compositeur : l'apercu retire son cadre en meme
    // temps que la video.
    cardStyle,
    cardsTypography,
  };

  /* ── LE RENDU JOUE DANS LE CADRE ──────────────────────────────────────
     Le montage composé s'affichait dans un bloc `<video>` SOUS l'aperçu :
     l'utilisateur avait donc deux images du même montage empilées — l'aperçu
     figé avec ses onglets, puis un second panneau avec sa bordure, sa légende
     et son bouton « Fermer ». Le lecteur vit maintenant DANS le cadre, à la
     place exacte du plateau.

     ⚠️ SUR L'ONGLET « TOUT », ET LUI SEUL. Les autres onglets — Titre,
     Cartes, Vidéo, CTA — isolent un élément pour le régler de près : y
     substituer la vidéo entière retirerait à l'utilisateur la seule vue qui
     lui sert à travailler. « Tout » était déjà l'image figée du montage
     complet ; c'est exactement ce que la vidéo remplace. */
  const rendPourApercu = sending && renderTarget === 'apercu';
  const renduJoue = !!previewUrl && previewFocus === 'all';

  const renduDansLeCadre = !generated ? null : rendPourApercu ? (
    // ── Composition en cours, DANS le cadre ────────────────────────────
    // L'attente se passait sous l'aperçu, dans un bouton qui disait
    // « Rendu… » : rien n'indiquait où le résultat allait apparaître.
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 backdrop-blur-sm"
      data-play-chargement
    >
      <Loader2 className="w-6 h-6 animate-spin text-purple-300" />
      <p className="text-xs text-gray-300">Composition du montage…</p>
      <div className="w-2/3 h-1 rounded-full bg-gray-800 overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{
            width: `${renderProgress}%`,
            background: `linear-gradient(90deg, ${accent} 0%, ${gradEnd} 100%)`,
            transition: 'width 300ms ease-out',
          }}
        />
      </div>
      {renderStage && <p className="text-[11px] text-gray-500">{renderStage}</p>}
    </div>
  ) : renduJoue ? (
    <div className="absolute inset-0 bg-black" data-play-lecteur>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        src={previewUrl!}
        controls
        autoPlay
        playsInline
        className="w-full h-full"
        // `contain` et non `cover` : le montage a EXACTEMENT le ratio du
        // cadre, mais un recadrage rognerait le CTA le jour où ce ne serait
        // plus vrai. Mieux vaut une bande noire qu'un texte coupé.
        style={{ objectFit: 'contain' }}
      />
      {/* ── RETOUR À L'ÉDITION ───────────────────────────────────────
          ⚠️ IL NE JETTE PAS LE MONTAGE. L'ancien bouton « Fermer » appelait
          `setPreviewRender(null, null)`, ce qui effaçait le blob ET sa
          signature : le rendu déjà PAYÉ était perdu, et l'envoi au calendrier
          en recomposait — donc en débitait — un second. Revenir à l'édition
          ne fait que changer d'onglet ; le montage reste en cache et sera
          réutilisé. */}
      <button
        type="button"
        onClick={() => setPreviewFocus('intro')}
        data-play-retour-edition
        title="Revenir à l’aperçu d’édition — le montage reste en mémoire"
        className="absolute top-2 right-2 flex items-center gap-1.5 rounded-lg border border-gray-700 bg-black/70 px-2 py-1 text-[11px] text-gray-200 hover:text-white hover:border-gray-500 backdrop-blur-sm transition-colors"
      >
        <X className="w-3 h-3" />
        Revenir à l’édition
      </button>
    </div>
  ) : null;

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
  const seqDuration = dureeDeSequence(activeOrder, { intro: introDuration, cards: cardsDuration, video: videoDuration, cta: ctaDuration });

  /* ── LECTURE DES SÉQUENCES, DANS LE CADRE ─────────────────────────────
     « Tout » EMPILE titre, cartes et CTA : c'est une vue de COMPOSITION, pas
     le montage. Ce lecteur les joue dans l'ordre réel, avec la transition et
     l'animation de texte choisies — les MÊMES règles que le compositeur
     (`sequenceClock`, `transitionLayerStyles`), sur les MÊMES composants que
     le plateau (`PlateContent`). À l'arrêt il ne couvre rien : l'édition
     continue.

     ⚠️ CE N'EST PAS LE RENDU. « Voir le rendu » compose la vraie vidéo (voix,
     rush, débit) et la joue à cette même place : quand elle existe ou se
     compose, elle a la priorité (`renduDansLeCadre`). Sur les autres onglets,
     rien — ils isolent un élément pour le régler. */
  /** Les séquences que le lecteur joue — durées du montage, par `seqDuration`. */
  const etapesLecture = activeOrder.map((k) => ({ key: k, seconds: seqDuration(k) }));

  /* ── L'EXTRAIT À LA DEMANDE ───────────────────────────────────────────
     Choisir une transition ou une animation dans une grille la joue TOUT DE
     SUITE dans le grand aperçu, sur le vrai contenu : la transition entre la
     séquence courante et la suivante, ou le début de la séquence courante
     avec l'animation. Un extrait court (`transitionExtract`,
     `textAnimationExtract`), pas le montage entier.

     Le lecteur ne vit que sur « Tout » : depuis un autre onglet, on y bascule
     le temps de l'extrait, puis on REVIENT (`finExtrait`). Avec la réduction
     des animations, rien ne se lance — l'image figée au milieu de l'effet
     est montrée, Lire reste un geste volontaire (`autoplay`).

     ⚠️ AUCUN RENDU. C'est le même lecteur que le bouton ▶ du cadre : rien
     n'est composé, rien n'est débité — `runRender` n'est pas concerné. */
  const [extraitDemande, setExtraitDemande] = useState<PlaybackRequest | null>(null);
  /** Compteur des demandes : chaque clic relance, même effet, mêmes bornes. */
  const extraitNo = useRef(0);
  /** L'onglet d'où l'extrait est parti — `null` : « Tout », rien à rendre. */
  const focusAvantExtrait = useRef<PreviewFocus | null>(null);

  const demanderExtrait = useCallback((
    extrait: PlaybackExtract | null,
    essai: { transition?: TransitionStyle; textAnimation?: TextAnimation },
  ) => {
    // Rien à jouer, ou le cadre est pris par le rendu (composition en cours,
    // montage rendu affiché) : le lecteur n'y est pas.
    if (!extrait || !generated || previewUrl || rendPourApercu) return;
    extraitNo.current += 1;
    if (previewFocus !== 'all') {
      focusAvantExtrait.current = previewFocus;
      setPreviewFocus('all');
    } else {
      focusAvantExtrait.current = null;
    }
    setExtraitDemande({ ...extrait, ...essai, id: extraitNo.current, autoplay: !reduireAnimations });
  }, [generated, previewUrl, rendPourApercu, previewFocus, reduireAnimations]);

  /** Transition `style` entre la séquence de l'onglet courant et la suivante. */
  const jouerTransition = useCallback((style: TransitionStyle) => {
    demanderExtrait(transitionExtract(etapesLecture, previewFocus), { transition: style });
    // `etapesLecture` est recalculé à chaque rendu : ses valeurs, pas sa
    // référence, comptent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demanderExtrait, previewFocus, activeOrder, seqDuration]);

  /** Animation `style` au début de la séquence de l'onglet courant (Titre par défaut). */
  const jouerAnimation = useCallback((style: TextAnimation) => {
    demanderExtrait(textAnimationExtract(etapesLecture, previewFocus, INTRO_WINDOW), { textAnimation: style });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demanderExtrait, previewFocus, activeOrder, seqDuration]);

  /** L'extrait est fini ou quitté : la demande est consommée, l'onglet rendu. */
  const finExtrait = useCallback(() => {
    setExtraitDemande(null);
    const retour = focusAvantExtrait.current;
    focusAvantExtrait.current = null;
    if (retour && retour !== 'all') setPreviewFocus(retour);
  }, []);

  // Quitter « Tout » (à la main, ou par `finExtrait`) démonte le lecteur :
  // une demande laissée là se rejouerait toute seule au retour sur l'onglet.
  useEffect(() => {
    if (previewFocus !== 'all') setExtraitDemande(null);
  }, [previewFocus]);

  const lectureSequences = generated && previewFocus === 'all' && !previewUrl && !rendPourApercu ? (
    <SequencePlayback
      steps={etapesLecture}
      transition={transition}
      frame={{ w: VIDEO_SIZE[format].w, h: VIDEO_SIZE[format].h, scale: displayScale }}
      demande={extraitDemande}
      onFin={finExtrait}
      renderLayer={({ key, progress, textAnimation: animationExtrait }) => {
        // Le fond de CETTE séquence — la règle de l'onglet correspondant.
        const fond = resolveBackground(key as PreviewFocus, seqBackgrounds, posterUrl, posterTransform);
        return (
          <PlateauLecture
            generated={generated}
            format={format}
            focus={key as PreviewFocus}
            activeOrder={activeOrder}
            rushUrl={key === 'video' ? rushUrl : null}
            displayScale={displayScale}
            gradStart={gradStart}
            gradEnd={gradEnd}
            gradientOpacity={gradientOpacity}
            posterUrl={fond.url}
            posterTransform={fond.transform}
            text={textStyles}
            titlePos={titlePos}
            ctaPos={ctaPos}
            cardBoxes={effectiveCardBoxes}
            cardStyle={cardStyle}
            cardsTypography={cardsTypography}
            elements={freeElements}
            watermark={watermarkLabel}
            accent={accent}
            // L'animation de l'ÉTAT — celle qui part au rendu — sauf pendant
            // l'essai d'une option par son bouton ▶, qui la montre sans la
            // choisir.
            textAnimation={animationExtrait ?? textAnimation}
            progress={progress}
          />
        );
      }}
    />
  ) : null;

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
      // Le brief : son message s'ajoute a la narration du titre, son CTA
      // remplace le CTA generique. Un texte repris a la main (`userEdited`)
      // n'est pas touche — et aucun audio n'est regenere ici.
      brief: briefRempli(brief) ? brief : null,
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
  }, [generated, sequenceVoicesUserEdited, brief]);

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
   *
   * Rend ce qu'il a pose — l'URL et la duree retenue — pour qu'un appelant
   * qui doit composer DANS LA FOULEE (le jumeau, produit puis monte au meme
   * clic) lise ces valeurs sans attendre le prochain rendu React. `null` si
   * un autre import a pris le dessus pendant la sonde : rien n'a ete pose.
   */
  const applyRush = async (url: string, name: string, isClip = false): Promise<{ url: string; secondes: number } | null> => {
    // Jeton d'import : deux imports rapproches se resolvent dans l'ordre de
    // leur SONDE, pas de leur appel. Sans ce garde, le rush affiche pourrait
    // porter la duree de celui qu'il vient de remplacer.
    const runId = ++rushRunIdRef.current;
    setRushUrl(url);
    setRushName(name);
    setRushIsClip(isClip);
    // Protège ce rush contre la rétention 24 h. Un rush de brouillon n'est
    // référencé que dans le `localStorage` du navigateur ; sans ce signal, le
    // cron de nettoyage le supprime au bout d'un jour et la séquence « Vidéo »
    // du montage devient un 404. Fire-and-forget, silencieux : le serveur
    // écarte de lui-même ce qui n'est pas une cible de stockage du compte
    // (clip local, jumeau…), donc l'appeler pour tout rush ne coûte rien et
    // ne bloque jamais l'import.
    void fetch('/api/creer/rush/keep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }).catch(() => {});
    setSequences((prev) => prev.map((s) => (s.key === 'video' ? { ...s, enabled: true } : s)));
    setRushLoading(true);
    try {
      const probed = await probeRushDuration(url);
      if (rushRunIdRef.current !== runId) return null;
      const seconds = probed
        ? Math.min(Math.max(Math.round(probed), RUSH_SECONDS.min), RUSH_SECONDS.max)
        : RUSH_SECONDS.fallback;
      setVideoDuration(seconds);
      console.log(
        `[Assistant] Rush importé — durée source ${probed ? probed.toFixed(1) + 's' : 'illisible'}, séquence vidéo ${seconds}s`,
      );
      return { url, secondes: seconds };
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

  /**
   * REPRISE d'une génération orpheline, au montage.
   *
   * BUG B : la vidéo du jumeau était produite DANS le clic d'envoi, par une
   * boucle de polling de 5-20 min. Fermer la page pendant ce temps laissait la
   * génération orpheline — jamais montée, aucune reprise. Désormais
   * l'identifiant est persisté dès le lancement (`jumeauGenerationId`) ; ici,
   * au montage, on REPREND le suivi de cette génération sans en lancer une
   * seconde. Le serveur, lui, finalise une scène `done` quel que soit son âge
   * (voir `avatar/status/route.ts`, BUG A) : une génération terminée pendant
   * l'absence est donc récupérée, pas perdue.
   *
   * `rushUrlActuel` (celui du brouillon restauré) : si le rush porte déjà cette
   * génération, la vidéo est en place — rien à reprendre, on efface le drapeau.
   */
  const reprendreJumeau = (generationId: string, rushUrlActuel?: string | null) => {
    if (rushUrlActuel && rushUrlActuel.includes(generationId)) { setJumeauGenerationId(null); return; }
    if (jumeauRepriseFaite.current || jumeauRenduEnCours.current) return;
    jumeauRepriseFaite.current = true;
    setJumeauReprise('encours');
    void (async () => {
      try {
        const { url } = await attendreStatutJumeau({ generationId });
        const posee = await applyRush(url, 'Mon jumeau', false);
        setJumeauMode('aucun');
        setJumeauGenerationId(null);
        setJumeauReprise('inactif');
        if (posee) setJumeauNotice('Votre jumeau est prêt : il est monté dans la séquence « Vidéo ».');
      } catch {
        // Le fournisseur a échoué (ou le délai est dépassé) : on le dit, et le
        // bouton « Réessayer » relance une génération (voir `relancerJumeau`).
        setJumeauReprise('echec');
        setJumeauNotice(null);
        // Rouvre la porte à un nouvel essai.
        jumeauRepriseFaite.current = false;
      }
    })();
  };
  /** Appelée par la restauration (définie plus haut) sans dépendance de portée. */
  const reprendreJumeauRef = useRef(reprendreJumeau);
  reprendreJumeauRef.current = reprendreJumeau;

  /**
   * « Réessayer » après un échec de reprise : relance une génération EN FOND
   * (pas dans le clic d'envoi) et pose le rush quand elle aboutit. L'envoi
   * suivant se contentera alors du rush déjà posé — aucun second débit.
   */
  const relancerJumeau = () => {
    if (jumeauRepriseFaite.current || jumeauRenduEnCours.current) return;
    const textes = Object.values(sequenceVoices)
      .map((v) => v.text)
      .filter((t): t is string => typeof t === 'string' && t.length > 0);
    jumeauRepriseFaite.current = true;
    setJumeauReprise('encours');
    setJumeauNotice(null);
    void (async () => {
      try {
        const video = await genererEtAttendreVideoJumeau({
          textes,
          aspectRatio: format,
          onLancee: (id) => setJumeauGenerationId(id),
        });
        const posee = await applyRush(video.url, `Mon jumeau (v${video.avatarVersion})`, false);
        setJumeauMode('aucun');
        setJumeauGenerationId(null);
        setJumeauReprise('inactif');
        if (posee) setJumeauNotice(`Votre jumeau (v${video.avatarVersion}) est monté dans la séquence « Vidéo ».`);
      } catch {
        setJumeauReprise('echec');
        jumeauRepriseFaite.current = false;
      }
    })();
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
   * Ordre volontaire, et le meme pour les trois destinations :
   *   1. lecture du solde        → on n'ouvre pas un rendu qu'on ne peut payer
   *   2. photo des cartes        → garantit apercu == video, pixel pour pixel
   *   3. TENTATIVE serveur       → le serveur attribue la cle et le cout
   *   4. composition             → dans le navigateur
   *   5. televersement VERS CETTE CLE, et nulle part ailleurs
   *   6. CONFIRMATION            → le serveur regarde l'objet, puis debite
   *   7. livraison               → post, telechargement ou apercu
   *
   * Le debit est en 6, pas en dernier : il precede la livraison. L'ordre
   * inverse -- livrer puis debiter sans bloquer -- laissait passer des
   * montages que rien n'avait factures, et ne prouvait au serveur ni que le
   * fichier existait ni ce qu'il valait.
   */
  /**
   * Contenu de la n-ieme video du lot.
   *
   * Sans angle impose, l'IA rend le meme texte a chaque appel sur un meme
   * sujet : un lot de cinq videos serait cinq fois la meme. On lui passe donc
   * un angle tournant, un jeton de variation, et les titres deja produits pour
   * qu'elle ne se repete pas.
   *
   * Rend `null` en cas d'echec (reponse non-ok, delai depasse, contenu
   * invalide). L'appelant REFUSE alors le doublon : reprendre le contenu
   * courant livrait une video identique a la premiere, presentee comme une
   * variation. La serie s'arrete sur cet element, avant toute composition et
   * tout debit — les suivants restent en attente.
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
          // Le brief n'est envoye que s'il est renseigne : un appel sans
          // brief garde exactement le corps d'avant.
          ...(briefRempli(brief) ? { brief: sanitizeBrief(brief) } : null),
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
  }, [customTopic, themeId, generated, brief]);

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

  /**
   * Le debit APRES COUP a ete retire.
   *
   * Il appelait `/api/credits/deduct` une fois le post cree, sans bloquer :
   * « le montage est deja livre, le refuser apres coup ne le rendrait pas
   * moins livre ». C'etait vrai, et c'etait le probleme -- la livraison
   * precedait le paiement, et rien ne prouvait au serveur que le fichier
   * annonce existait.
   *
   * Le Calendrier passe desormais par `composerEtFacturer`, qui debite a la
   * CONFIRMATION, apres que le serveur a vu l'objet. Garder les deux aurait
   * facture deux fois : les deux references idempotentes sont differentes,
   * l'une derivee du `jobId`, l'autre du `postId`.
   */

  /**
   * Lance un rendu — enveloppe par le verrou.
   *
   * Le corps historique est `runRenderInterne`. Ici, une seule chose : un
   * second clic dans le meme tour est ignore. Sur une serie, il aurait lance
   * DEUX series completes, donc quatre tentatives serveur et quatre debits.
   */
  const runRender = async (destination: 'calendrier' | 'bureau' | 'apercu') => {
    if (!prendre(VERROU.serie)) return;
    try { await runRenderInterne(destination); }
    finally { rendre(VERROU.serie); }
  };

  const runRenderInterne = async (destination: 'calendrier' | 'bureau' | 'apercu') => {
    // ⚠️ MODIFICATION : ON NE COMPOSE PAS. Le garde est ICI, et pas seulement
    // dans l'affichage : les trois destinations composent et debitent, et
    // « calendrier » ferait en plus un `POST /api/posts` — donc un SECOND post,
    // pendant qu'on croyait modifier le premier. Masquer les boutons suffirait
    // aujourd'hui ; ce retour garantit qu'aucun chemin futur (raccourci, rappel,
    // bouton ajoute ailleurs) ne puisse contourner la regle.
    //
    // Rendre a nouveau un contenu existant sera une action a part, avec son cout
    // annonce avant confirmation. Elle n'existe pas encore.
    if (editPostId) return;
    if (!generated || sending) return;

    // ── Serie fermee ────────────────────────────────────────────────
    // Place ici, et pas plus bas : la premiere chose que faisait ce
    // gestionnaire etait de lire le solde, donc un appel reseau. Rien ne doit
    // partir, rien ne doit etre compose, aucun post ne doit naitre, aucun
    // credit ne doit bouger. Meme pas `setSending(true)` : on rend la main
    // avant, ce qui evite d'avoir a defaire un etat de chargement.
    //
    // Griser la carte ne suffirait pas — un brouillon restaure porte un
    // nombre sans qu'aucun bouton ait ete touche.
    if (lotRefuse(batchCount)) {
      setError(BATCH_SERIE_REFUS);
      return;
    }

    // ── Jumeau numérique ────────────────────────────────────────────
    // AVANT tout état de chargement, tout appel de solde, toute composition :
    // si « Utiliser mon jumeau » est demandé, le SERVEUR revérifie tout
    // (avatar validé dans sa version courante, voix du compte, choix) et dit
    // si le moteur vidéo du jumeau existe. Sinon on s'arrête ici — jamais une
    // vidéo ordinaire livrée sous ce nom.
    const textesJumeau = Object.values(sequenceVoices).map((v) => v.text).filter((t) => typeof t === 'string' && t.length > 0);
    const refusJumeau = await gardeJumeauAvantRendu({ mode: jumeauMode, textes: textesJumeau });
    if (refusJumeau) {
      setError(refusJumeau);
      return;
    }
    // Une génération orpheline est déjà en cours de reprise (page rouverte
    // pendant le rendu) : on ne lance pas une SECONDE génération par-dessus —
    // ce serait un double débit. On attend qu'elle aboutisse d'elle-même.
    if (jumeauMode === 'avatar' && jumeauReprise === 'encours') {
      setError('Votre jumeau se prépare encore. Patientez quelques instants, puis renvoyez.');
      return;
    }
    // Le jumeau lui-meme est produit plus bas, apres le solde et avant la
    // boucle du lot (« Jumeau numerique — la video » ) : UN clic, et le
    // montage final sort avec sa video dedans.

    setSending(true);
    // Sert UNIQUEMENT a placer l'etat de chargement au bon endroit — dans le
    // cadre pour l'apercu, dans l'etape Envoi pour les deux autres. La
    // composition et la facturation ne le lisent nulle part.
    setRenderTarget(destination);
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
    // `batchCountAutorise` et non `clampBatchCount` : le second borne a
    // `MAX_BATCH` (dix), le premier au plafond du PILOTE. Une valeur injectee
    // qui aurait franchi `lotRefuse` ne pourrait donc toujours pas composer
    // plus que le pilote n'autorise.
    const total = destination === 'apercu' ? 1 : batchCountAutorise(batchCount);
    // Un lot incomplet livrerait deux montages a l'affiche identique — ce que
    // le lot existe precisement pour eviter. On refuse plutot que de dupliquer
    // en silence.
    if (total > 1 && !batchPhotosReady(batchPhotoUrls, total)) {
      setError(messageAffichesManquantes(batchPhotoMode, affichesRetenues, total));
      setSending(false);
      // ⚠️ CE RETOUR EST HORS DU `try`, donc hors du `finally` qui remet
      // l'indicateur a zero. L'oublier ici laisserait le cadre bloque sur
      // « Composition du montage… » sans que rien ne tourne.
      setRenderTarget(null);
      return;
    }
    // Le jumeau se paie a part, au tarif serveur d'une video avatar
    // (AVATAR_VIDEO_COST, le meme que /api/avatar/generate) : compte ICI pour
    // que le solde soit verifie sur le total AVANT de produire quoi que ce
    // soit. Sans cela, la video du jumeau pouvait etre payee, puis le montage
    // refuse pour solde insuffisant.
    const coutTotal = batchCost(cost, total) + (jumeauMode === 'avatar' ? AVATAR_VIDEO_COST : 0);
    const baseDate = scheduledDate ? new Date(`${scheduledDate}T12:00:00`) : new Date();
    const dates = batchDates(Number.isNaN(baseDate.getTime()) ? new Date() : baseDate, total);

    // ── Suivi par contenu ──────────────────────────────────────────
    // Un identifiant STABLE par contenu, derive du rang. L'apercu n'en a pas
    // besoin : il ne cree rien et rend la main dans la boucle.
    const suivi = destination !== 'apercu';
    const runId = batchRunId(Date.now());
    let items: BatchItem[] = suivi ? initialBatchItems(runId, total) : [];
    setBatchItems(items);
    /** Applique un etat au contenu `id`, en local ET a l'ecran. */
    const majItem = (id: string, etat: BatchItem['etat'], extra?: { postId?: string; erreur?: string }) => {
      if (!suivi) return;
      items = setItemState(items, id, etat, extra);
      setBatchItems(items);
    };
    /** Contenu en cours — sert au `catch` global, qui ne connait pas `b`. */
    let itemEnCours: string | null = null;

    try {
      // 1. Solde — non bloquant si l'endpoint est indisponible, comme l'éditeur.
      try {
        const check = await fetch('/api/credits/balance').then((r) => r.json());
        // La politique arrive avec le solde. On la relit ICI, au moment qui
        // compte, plutôt que de se fier à l'état posé au montage : la réponse
        // est fraîche et vient du serveur.
        const politiqueFraiche = politiqueAffichable(check?.politique);
        setPolitiqueFacturation(politiqueFraiche);
        const balance = check?.data?.credits ?? check?.balance;
        // `check.ok` est indispensable : la route renvoie `{ok:false, balance:0}`
        // sur 401/500. Sans ce garde, une panne passagère afficherait
        // « Crédits insuffisants : 0 disponible » à un utilisateur qui en a.
        const readable = check?.success !== false && check?.ok !== false;
        // Sous `partner_cost_only` il n'y a pas de solde à comparer : la route
        // renvoie `balance: null` et un libellé. « Crédits insuffisants » y
        // serait un refus inventé, sur un compte qui ne paie pas en crédits.
        if (politiqueFraiche === 'credits'
          && readable && typeof balance === 'number' && balance < coutTotal) {
          setError(`Crédits insuffisants : ${coutTotal} requis, ${balance} disponible(s).`);
          return;
        }
      } catch {
        // On continue : un échec de lecture du solde ne doit pas bloquer.
      }

      // ── Le plateau de CE passage ───────────────────────────────────
      // Ce que le montage lit du rush : son URL, la sequence « Video » et
      // sa duree. Par defaut, l'etat de l'ecran — a la lettre ce que
      // `activeOrder` et `seqDuration` calculent. Quand le jumeau est
      // demande, sa video, produite a l'instant, REMPLACE ces trois valeurs
      // pour ce passage : un etat pose par `setRushUrl` n'est pas relu dans
      // la fonction qui l'a pose, et exiger un second clic n'est pas le
      // parcours. Aucun second pipeline : les memes fonctions pures,
      // appliquees a un plateau local.
      // `avatarVideo` : vrai quand la séquence « Vidéo » est la vidéo du jumeau
      // parlant, qui porte déjà la voix — elle exclut alors toute voix off TTS
      // de séquence 'video' (pas de double narration). Faux pour un rush ordinaire.
      let plateau = { rushUrl, sequences, videoDuration, avatarVideo: false };

      // ── Jumeau numerique — la video ────────────────────────────────
      // Le garde a dit oui, le solde couvre le total. LA video du jumeau est
      // produite par le serveur (ElevenLabs sur MA voix + HeyGen sur MON
      // avatar), attendue, puis posee comme rush par `applyRush` — le geste
      // existant, qui rend ce qu'il a pose. Le montage continue AVEC, dans
      // ce meme clic. En cas d'echec : on s'arrete, message a l'ecran,
      // jamais une video ordinaire livree sous ce nom. Le mode 'voix' ne passe
      // pas ici : sa voix est deja posee dans `ttsVoiceId`, rien a produire.
      if (jumeauMode === 'avatar') {
        setRenderProgress(5);
        // Ce clic gère lui-même la génération : la reprise au montage ne doit
        // pas la doubler tant qu'elle tourne.
        jumeauRenduEnCours.current = true;
        let posee: Awaited<ReturnType<typeof applyRush>>;
        try {
          const video = await genererEtAttendreVideoJumeau({
            textes: textesJumeau,
            aspectRatio: format,
            // Persister l'identifiant DÈS le lancement : si la page se ferme
            // pendant les 5-20 min de rendu, la reprise au montage retrouvera
            // cette génération au lieu d'en payer une seconde.
            onLancee: (id) => setJumeauGenerationId(id),
            onEtape: (m) => setRenderStage(m),
          });
          posee = await applyRush(video.url, `Mon jumeau (v${video.avatarVersion})`, false);
          setJumeauNotice(`Votre jumeau (v${video.avatarVersion}) est monté dans la séquence « Vidéo ».`);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'La génération de votre jumeau a échoué.');
          return;
        }
        if (!posee) {
          setError('Le rush a été remplacé pendant la génération de votre jumeau. Relancez l’envoi.');
          return;
        }
        // L'intention est honoree : la video du jumeau EST le rush. Un
        // prochain envoi montera ce rush, sans produire un second jumeau.
        setJumeauMode('aucun');
        // La génération est aboutie et posée : plus rien à reprendre.
        setJumeauGenerationId(null);
        plateau = {
          rushUrl: posee.url,
          sequences: sequences.map((s) => (s.key === 'video' ? { ...s, enabled: true } : s)),
          videoDuration: posee.secondes,
          // La vidéo du jumeau porte DÉJÀ la voix (l'avatar dit le script) : la
          // séquence « Vidéo » ne doit pas recevoir en plus une voix off TTS.
          avatarVideo: true,
        };
        setRenderProgress(0);
        setRenderStage('Préparation…');
      }
      const ordre = ordreActif(plateau.sequences);
      const duree = dureeDeSequence(ordre, { intro: introDuration, cards: cardsDuration, video: plateau.videoDuration, cta: ctaDuration });

      // ── Voix de la séquence « Vidéo » — pas de double narration ─────
      // La vidéo du jumeau parlant PORTE DÉJÀ la voix (l'avatar dit le script
      // sur ma voix, et le compositeur route la piste du rush,
      // `hasRushAudio = !!videoEl`). Lui superposer une voix off TTS de
      // séquence 'video' ferait dire le texte DEUX fois. On la retire donc
      // quand la séquence « Vidéo » est l'avatar — signalé par le drapeau du
      // plateau (envoi en un clic) OU par l'URL du rush (avatar déjà posé, y
      // compris après une reprise), les vidéos d'avatar vivant sous
      // `.../avatar/<gen>.mp4`. Un rush ordinaire garde sa voix off, inchangé.
      const videoEstAvatar = plateau.avatarVideo || (!!plateau.rushUrl && /\/avatar\/[^/]+\.mp4/.test(plateau.rushUrl));
      const voixSequencesRendu = ((): typeof sequenceVoiceUrls => {
        if (!videoEstAvatar || !sequenceVoiceUrls || !sequenceVoiceUrls.video) return sequenceVoiceUrls;
        const reste: NonNullable<typeof sequenceVoiceUrls> = {};
        if (sequenceVoiceUrls.titre) reste.titre = sequenceVoiceUrls.titre;
        if (sequenceVoiceUrls.cartes) reste.cartes = sequenceVoiceUrls.cartes;
        if (sequenceVoiceUrls.cta) reste.cta = sequenceVoiceUrls.cta;
        return Object.keys(reste).length ? reste : undefined;
      })();

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
          itemEnCours = batchItemId(runId, b);
          majItem(itemEnCours, 'rendu');
          let contenu = contenuInitial;
          if (total > 1 && b > 0) {
            setRenderStage(`Variation ${b + 1}/${total}…`);
            const variation = await generateBatchVariation(b, titresDejaVus);
            // Pas de variation : on n'en fait pas un doublon en silence. On
            // leve AVANT la capture, la reservation et la composition — le
            // `catch` global marque cet element « echoue » et laisse les
            // suivants « en attente ». Rien n'est reserve ni debite.
            if (!variation) {
              throw new Error(
                `La variation du contenu ${b + 1}/${total} a échoué : rien n’a été composé ni débité pour ce contenu.`,
              );
            }
            contenu = variation;
            if (variation.title) titresDejaVus.push(variation.title);
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

        // 3 a 6. Tentative, composition, televersement, confirmation. Le
        //    parcours entier vit dans `@/lib/rendus` : l'ecran ne fait que
        //    fournir de quoi composer, et recoit un montage deja prouve.
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
          // (`hasRushAudio = !!videoEl`). Le mode fast est lui aussi cadence
          // a l'horloge murale (video-composer.ts, boucle `doFrame` sur
          // `performance.now()`), donc pas plus rapide : la difference est
          // le telechargement et le decodage du rush, inutiles pour une video
          // qui n'apparait nulle part dans le montage.
          videoUrl: duree('video') > 0 ? plateau.rushUrl || undefined : undefined,
          // Une sequence desactivee a une duree nulle : c'est ainsi que le
          // compositeur l'exclut (conditions d'inclusion), et le Calendrier la
          // filtre pareil (`dur > 0`).
          // Style joue entre deux sequences consecutives. Toujours envoye :
          // le compositeur retombe de toute facon sur le fondu, autant lui
          // dire explicitement ce que l'ecran annonce.
          transition,
          introDuration: duree('intro'),
          cardsDuration: duree('cards'),
          videoDuration: duree('video'),
          ctaDuration: duree('cta'),
          // Le compositeur bascule en mode « normal » (temps reel, audio mixe et
          // embarque) des qu'une de ces deux URL est fournie ; sans elles il
          // reste en mode « fast ».
          musicUrl: musicUrl || undefined,
          voiceUrl: voiceUrl || undefined,
          // Voix PAR SEQUENCE : chaque clip est joue au debut de sa sequence
          // et coupe a sa fin. `voiceUrl` reste le repli quand il n'y en a
          // aucune — c'est le cas de tous les montages anterieurs. En mode
          // avatar, la voix off de la séquence 'video' est retirée en amont
          // (`voixSequencesRendu`) : l'avatar porte déjà sa voix.
          sequenceVoiceUrls: voixSequencesRendu,
          musicVolume,
          voiceVolume,
          // Mixeur unifie : ces keyframes pilotent les trois bus audio du
          // compositeur (musique, rush, voix). Absents tant que l'utilisateur
          // n'a rien reglé — donc aucun changement pour les montages existants.
          audioKeyframes: audioKeyframes.length > 0 ? audioKeyframes : undefined,
          sequenceOrder: ordre,
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
            cardStyle,
            // ⚠️ LA PHOTO DES CARTES PORTE DEJA CES REGLAGES : le conteneur
            // est capture puis blitte, donc le rendu est acquis. On les ecrit
            // quand meme sur les champs QUE LE COMPOSITEUR CONNAIT DEJA
            // (`cardsFont`, `cardsTextScale` en pour-cent), pour qu'une
            // regeneration depuis le Calendrier — qui recompose SANS photo —
            // rende la meme chose.
            //
            // Le nom `cardsTypography` est deja pris cote compositeur par les
            // drapeaux de degrade : l'objet complet vit donc sous
            // `cardsTextStyle`.
            ...(cardsTypography.font ? { cardsFont: cardsTypography.font } : null),
            ...(cardsTypography.scale !== undefined
              ? { cardsTextScale: cardsTypography.scale * 100 } : null),
            cardsTextStyle: { ...cardsTypography },
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
        // Reutiliser suppose que le montage a DEJA ete paye et prouve. On
        // exige donc la tentative confirmee, pas seulement la presence d'un
        // blob : un blob peut arriver par un chemin qui n'a rien facture.
        const reutilisable =
          total === 1
          && destination !== 'apercu'
          && !!previewBlobRef.current
          && !!previewRenduRef.current
          && signatureMatches(previewSignatureRef.current, signature);

        let composed: { blob: Blob; url: string | null; thumbnailUrl: string | null; composerVersion: string };
        /** La tentative confirmee de CE tour, s'il en a ouvert une. */
        let renduConfirme: { jobId: string; url: string | null } | null = null;
        if (reutilisable) {
          setRenderStage('Montage déjà prêt — réutilisé.');
          setRenderProgress(60);
          const dejaFait = previewBlobRef.current!;
          const preuve = previewRenduRef.current!;
          composed = destination === 'bureau'
            ? { blob: dejaFait, url: null, thumbnailUrl: null, composerVersion: CURRENT_COMPOSER_VERSION }
            // Le Calendrier a besoin d'une URL. Ce montage est deja dans le
            // stockage, a la cle attribuee par le serveur, et le serveur l'y
            // a VU avant de confirmer. On relit cette cle. Televerser une
            // seconde copie vers une cle choisie par le navigateur donnerait
            // au Calendrier un fichier que rien n'a verifie.
            : {
                blob: dejaFait,
                url: preuve.url,
                thumbnailUrl: previewThumbRef.current
                  ? await televerserVignette(previewThumbRef.current)
                  : null,
                composerVersion: CURRENT_COMPOSER_VERSION,
              };
        } else if (destination === 'calendrier') {
          // ── Calendrier : parcours facture COMPLET ────────────────────
          // Cette branche appelait `composeAndUpload`, qui compose et
          // televerse vers une cle choisie par le navigateur : aucune
          // tentative n'etait ouverte, donc `public.rendus` restait vide et
          // la seule trace etait un `POST /api/credits/deduct` tire apres
          // coup, sans preuve que le fichier existait.
          //
          // `composerEtFacturer` rend le meme contrat et insere l'ordre :
          // tentative -> composition -> televersement vers LA cle attribuee
          // -> verification serveur -> livraison. Il LEVE si le serveur ne
          // confirme pas, et le `catch` de la boucle arrete l'envoi : aucun
          // post n'est cree pour un montage non prouve.
          composed = await composerEtFacturer('calendrier', renderFormat, optionsRendu);
        } else {
          // ── Aperçu et bureau : parcours facturé COMPLET ──────────────
          // Le serveur ouvre une tentative et attribue une clé de stockage ;
          // on compose ; on téléverse vers CETTE clé ; le serveur va
          // regarder l'objet et débite s'il l'y trouve. Le montage n'est
          // délivré qu'après cette confirmation — c'est ce qui remplace le
          // montant que le navigateur envoyait autrefois.
          const livraison = await rendreEtFacturer({
            operation: destination === 'apercu' ? 'apercu' : 'bureau',
            format: renderFormat,
            etape: (t) => setRenderStage(t),
            composer: async () => {
              const rendu = await composeVideo(optionsRendu);
              // La vignette est gardée pour l'aperçu : un montage réutilisé
              // par le Calendrier arriverait sinon sans miniature.
              if (destination === 'apercu') vignetteApercu = rendu.thumbnail;
              return rendu.video;
            },
          });

          if (!livraison.ok || !livraison.blob) {
            // Rien n'est livré, et rien n'a été débité : le serveur n'a pas
            // confirmé. La tentative est déjà close de son côté.
            setError(messagePour(livraison.motif));
            majItem(itemEnCours, 'echoue', { erreur: livraison.motif || 'rendu refusé' });
            return;
          }

          renduConfirme = { jobId: livraison.jobId ?? '', url: livraison.url ?? null };
          composed = {
            blob: livraison.blob,
            url: livraison.url ?? null,
            thumbnailUrl: null,
            composerVersion: CURRENT_COMPOSER_VERSION,
          };
        }

        // ── Destination « aperçu » ─────────────────────────────────────
        // On garde le montage, on débite une fois, et on le joue. Aucun post,
        // aucun téléversement.
        if (destination === 'apercu') {
          // On n'arrive ici QUE si le serveur a confirmé : l'objet existe, il
          // a été vu, et les crédits sont partis. L'aperçu est délivré après.
          // La preuve accompagne le montage : c'est elle qui autorisera sa
          // reutilisation par le Calendrier, plus tard.
          setPreviewRender(composed.blob, signature, vignetteApercu, renduConfirme);
          setRenderProgress(100);
          setRenderStage('Prêt.');
          return;
        }

        // ── Destination « bureau » ─────────────────────────────────────
        // Le montage est deja confirme et debite a ce stade : on n'arrive ici
        // que si le serveur a vu l'objet. Le telechargement se fait APRES la
        // boucle, pour n'ouvrir qu'une seule fenetre d'enregistrement meme
        // sur un lot — et il n'ouvre donc jamais avant confirmation.
        //
        // Un montage reutilise a DEJA ete paye au moment du Play : il ne
        // repasse pas par une tentative, donc il n'est pas facture deux fois.
        if (destination === 'bureau') {
          blobsBureau.push({ blob: composed.blob, titre: contenu.title });
          majItem(itemEnCours, 'pret');
          continue;
        }

        if (!composed.url) {
          setError("Le montage a été rendu mais son envoi a échoué. Réessayez.");
          return;
        }

        // 4. Création du post. Le rendu est deja paye et prouve a ce stade :
        //    on n'arrive ici que si le serveur a vu l'objet et confirme la
        //    tentative. Un echec de `/api/posts` laisse donc un montage paye
        //    et en ligne, mais aucun post — c'est le seul ordre qui ne livre
        //    jamais une video que rien n'a facturee.
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
          hasAudio: !!(musicUrl || voiceUrl || voixSequencesRendu || (plateau.rushUrl && duree('video') > 0)),
          // Les URL `blob:` ne survivent pas au rechargement de la page. Le
          // panneau audio televerse normalement les pistes et renvoie une URL
          // publique, mais il retombe sur un blob local si le televersement de
          // la voix de synthese echoue. Stocker cette URL-la laisserait une
          // reference morte dans le post.
          musicUrl: persistableUrl(musicUrl),
          voiceUrl: persistableUrl(voiceUrl),
          // La même liste que celle du rendu : en mode avatar, sans la voix off
          // de la séquence 'video', pour que le Calendrier ne rejoue pas une
          // double narration à la régénération.
          sequenceVoiceUrls: voixSequencesRendu,
          // Le rush est deja INCRUSTE dans le montage ; on le persiste quand
          // meme sous `rushUrls` — c'est le champ que le Calendrier relit pour
          // regenerer (`videoUrl: meta.rushUrls?.[0]`). Sans lui, une
          // regeneration produirait le meme montage AMPUTE de sa sequence video.
          // Meme condition que `videoUrl` ci-dessus : un rush persiste alors que
          // sa sequence est masquee ferait re-telecharger et re-decoder le
          // fichier a chaque regeneration depuis le Calendrier, en pure perte.
          rushUrls:
            duree('video') > 0 && persistableUrl(plateau.rushUrl)
              ? [persistableUrl(plateau.rushUrl)!]
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
            intro: duree('intro'),
            cards: duree('cards'),
            video: duree('video'),
            cta: duree('cta'),
            total: ordre.reduce((t, k) => t + duree(k), 0),
            order: ordre,
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
            cardStyle,
            // ⚠️ LA PHOTO DES CARTES PORTE DEJA CES REGLAGES : le conteneur
            // est capture puis blitte, donc le rendu est acquis. On les ecrit
            // quand meme sur les champs QUE LE COMPOSITEUR CONNAIT DEJA
            // (`cardsFont`, `cardsTextScale` en pour-cent), pour qu'une
            // regeneration depuis le Calendrier — qui recompose SANS photo —
            // rende la meme chose.
            //
            // Le nom `cardsTypography` est deja pris cote compositeur par les
            // drapeaux de degrade : l'objet complet vit donc sous
            // `cardsTextStyle`.
            ...(cardsTypography.font ? { cardsFont: cardsTypography.font } : null),
            ...(cardsTypography.scale !== undefined
              ? { cardsTextScale: cardsTypography.scale * 100 } : null),
            cardsTextStyle: { ...cardsTypography },
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

        // « Programmer » sans aucun reseau retenu ne programme rien : un post
        // `scheduled` sans plateforme serait marque « failed » par le cron a
        // l'heure dite. On retombe sur le brouillon, jamais sur un echec differe.
        const programmationEffective = envoiIntention === 'programmer' && reseauxProgrammes.length > 0;
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
            // ⚠️ L'INTENTION DECIDE, ET ELLE SEULE. `brouillon` : aucune
            // plateforme, `draft` — l'envoi historique, au caractere pres ;
            // le cron de publication ne lit que `status = 'scheduled'`, un
            // brouillon ne part jamais. `programmer` : les reseaux connectes
            // choisis, `scheduled` — le meme mecanisme que « Programmer »
            // dans le Calendrier, et c'est le cron qui publie a l'heure dite.
            // La convention du Calendrier (« Instagram »), pas l'identifiant
            // (« instagram ») : c'est le Calendrier qui relit et modifie ce
            // post, et il compare ses libellés tels quels. Le cron accepte
            // les deux.
            platforms: programmationEffective ? reseauxProgrammes.map(libelleCalendrier) : [],
            scheduled_date: dates[b],
            scheduled_time: scheduledTime || '12:00',
            status: programmationEffective ? 'scheduled' : 'draft',
            metadata: {
              ...metadata,
              // Le fuseau dans lequel la date et l'heure ont ete saisies :
              // sans lui, le cron lit `scheduled_time` comme une heure de
              // Paris. Les minutes, elles, arrivent telles quelles.
              timezone: fuseauNavigateur(),
            },
          }),
        });

        const json = await res.json();
        if (!json.success || !json.post?.id) {
          const motif = res.status === 401
            ? 'Session expirée.'
            : "Le montage est prêt mais l'enregistrement du post a échoué.";
          majItem(itemEnCours, 'echoue', { erreur: motif });
          setError(
            res.status === 401
              ? 'Votre session a expiré. Reconnectez-vous et réessayez.'
              : "Le montage est prêt mais l'enregistrement du post a échoué.",
          );
          // On s'arrete, comme avant : les contenus suivants restent « en
          // attente », donc jamais factures. Les poursuivre depenserait des
          // credits sur un lot qu'on sait deja casse.
          return;
        }
        // 5. Plus de debit ici : il a eu lieu a la confirmation, avant que
        //    le montage ne soit livre. Un post n'existe donc jamais pour un
        //    rendu non paye, et aucun rendu paye n'est facture deux fois.
        majItem(itemEnCours, 'pret', { postId: json.post.id });

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
      // Le contenu qui etait en vol est le seul a avoir echoue : les suivants
      // n'ont jamais demarre et restent « en attente ».
      if (itemEnCours) {
        majItem(itemEnCours, 'echoue', {
          erreur: err instanceof Error && err.message ? err.message : 'Rendu interrompu.',
        });
      }
      setError(
        err instanceof Error && err.message
          ? `Le rendu a échoué : ${err.message}`
          : 'Le rendu du montage a échoué. Réessayez.',
      );
    } finally {
      setSending(false);
      setRenderTarget(null);
      // Le clic a fini de gérer sa génération : la reprise au montage peut de
      // nouveau prendre la main si une génération orpheline subsiste.
      jumeauRenduEnCours.current = false;
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
    setBatchItems([]);
    setBatchPhotoUrls([]);
    setBatchPhotoMode('auto');
    setSlotCible(null);
    setDuplicateNotice(null);
    setOpenSection('format');
    genSigRef.current = '';
    setGenerated(null);
    setSent(false);
    // Le contenu suivant repart en brouillon : une programmation heritee en
    // silence du precedent serait une publication surprise.
    setEnvoiIntention('brouillon');
    setReseauxProgrammes([]);
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

  /**
   * ─────────────────────────────────────────────────────────────────────
   * ENREGISTRER LES MODIFICATIONS
   * ─────────────────────────────────────────────────────────────────────
   *
   * Sur DEMANDE EXPLICITE, et sur elle seule : rien ne part au chargement, rien
   * ne part sur une minuterie, rien ne part au demontage. C'est l'inverse exact
   * du brouillon local, et c'est voulu — une ecriture serveur qui se declenche
   * toute seule est une ecriture qu'on n'a pas choisie.
   *
   * Un enregistrement NE REND RIEN et NE DEBITE RIEN : le montage deja rendu
   * (`renderedVideoUrl`, `thumbnailUrl`, `composerVersion`) n'est pas touche.
   * Consequence a connaitre : apres avoir modifie des textes, la video en ligne
   * reste celle d'avant tant qu'on n'a pas relance un rendu. C'est un choix, pas
   * un oubli — rendre ici debiterait des credits sans que personne l'ait demande.
   */
  /**
   * Ce que l'ecran porte MAINTENANT, dans le vocabulaire de la metadata.
   *
   * Extrait de `enregistrer` pour une seule raison : il faut pouvoir en prendre
   * une empreinte AU CHARGEMENT, afin de savoir ensuite ce que l'utilisateur a
   * reellement change. Sans cette empreinte, un enregistrement qui ne modifie
   * rien reecrirait quand meme tout — et reecrire, c'est risquer de perdre.
   */
  const construireValeurs = useCallback((): ValeursWizard => {
    const taille = VIDEO_SIZE[format];
    return {
      subtitle: generated?.subtitle,
      theme: themeId,
      // Les cartes partent de leur ORIGINAL : voir `postMetadata/cartes.ts`.
      // En creation la table est vide, donc le comportement est celui d'avant.
      cards: generated
        ? cartesPourEnregistrement(generated.cards, cartesOrigine.current, accent, accentCharge.current)
        : undefined,
      accentColor: accent,
      ctaText: generated?.cta,
      ctaSubText: generated?.ctaSub,
      textAnimation,
      gradientColor1: gradStart,
      gradientColor2: gradEnd,
      gradientOpacity,
      titlePos: { x: titlePos.x, y: titlePos.y },
      ctaPos: { x: ctaPos.x, y: ctaPos.y },
      elements: freeElements,
      sequences: {
        intro: seqDuration('intro'), cards: seqDuration('cards'),
        video: seqDuration('video'), cta: seqDuration('cta'),
        total: activeOrder.reduce((t, k) => t + seqDuration(k), 0),
        order: activeOrder,
      },
      videoSize: { w: taille.w, h: taille.h },
      // `?? undefined` et non `?? ''` : une valeur absente ne doit pas etre
      // ENVOYEE, sinon elle effacerait ce que l'editeur avance y avait mis.
      posterUrl: posterUrl ?? undefined,
      musicUrl: musicUrl ?? undefined,
      voiceUrl: voiceUrl ?? undefined,
      musicVolume,
      voiceVolume,
      sequenceVoiceUrls,
      rushUrls: rushUrl && seqDuration('video') > 0 ? [rushUrl] : undefined,
      audioKeyframes,
      cardGroups,
      hasAudio: !!(musicUrl || voiceUrl || sequenceVoiceUrls
                   || (rushUrl && seqDuration('video') > 0)),
    };
  }, [format, generated, themeId, accent, textAnimation, gradStart, gradEnd,
      gradientOpacity, titlePos, ctaPos, freeElements, activeOrder, seqDuration,
      posterUrl, musicUrl, voiceUrl, musicVolume, voiceVolume, sequenceVoiceUrls,
      rushUrl, audioKeyframes, cardGroups]);

  /**
   * Prend l'empreinte sur le rendu qui SUIT l'hydratation : les `setState` de
   * l'effet de remplissage ne sont pas visibles dans sa propre fermeture, et
   * lire l'etat trop tot photographierait l'ecran d'avant.
   */
  useEffect(() => {
    if (!aCapturer.current) return;
    aCapturer.current = false;
    valeursChargees.current = construireValeurs();
  }, [construireValeurs]);

  const enregistrer = useCallback(async () => {
    if (!editPostId || enregistrement.etat === 'encours') return;
    setEnregistrement({ etat: 'encours' });

    const valeurs = construireValeurs();
    const corps = {
      ...(generated ? { title: generated.title, caption: generated.subtitle } : null),
      ...(scheduledDate ? { scheduled_date: scheduledDate } : null),
      // Troisieme argument : ce que l'ecran portait AU CHARGEMENT. Tout ce qui
      // n'a pas bouge depuis est omis, donc preserve tel quel en base.
      metadata: metadataPourEnregistrement(
        postCharge.current?.metadata, valeurs, valeursChargees.current ?? valeurs,
      ),
    };

    const r = await enregistrerModification(editPostId, corps, (u, i) => fetch(u, i));
    if (r.kind === 'ok') {
      // La base fait foi pour la suite : le prochain enregistrement repart de
      // ce que le serveur a REELLEMENT ecrit, pas de ce qu'on croyait avoir
      // envoye. Sans cela, deux enregistrements de suite rejoueraient la
      // metadata d'origine et pourraient defaire le premier.
      if (r.post) postCharge.current = r.post as typeof postCharge.current;
      setEnregistrement({ etat: 'ok' });
    } else {
      setEnregistrement({ etat: 'echec', issue: r.kind });
    }
  }, [editPostId, enregistrement.etat, construireValeurs, generated, scheduledDate]);

  /**
   * Reprend la version en base — UNIQUEMENT apres confirmation.
   *
   * Ne passe PAS par l'ecran de chargement plein cadre : un echec y remplacerait
   * le parcours par un message, et le travail affiche disparaitrait — l'inverse
   * exact de ce qu'un conflit doit proteger. En cas d'echec, l'ecran ne bouge
   * pas et l'erreur s'affiche a cote du bouton.
   *
   * Aucun rendu, aucun debit, aucune ecriture : c'est une LECTURE.
   */
  const rechargerVersionRecente = useCallback(async () => {
    if (!editPostId || rechargement.etat === 'encours') return;
    setRechargement({ etat: 'encours' });
    const r = await chargerPostAModifier(editPostId, (u, i) => fetch(u, i));
    if (r.kind !== 'ok') {
      // Le formulaire reste tel quel : rien n'a ete remplace.
      setRechargement({ etat: 'echec', issue: r.kind });
      return;
    }
    postCharge.current = r.post;
    // Rejoue le remplissage a partir de ce que le serveur vient de rendre.
    restoredRef.current = false;
    setHydratations((n) => n + 1);
    setEnregistrement({ etat: 'repos' });
    setRechargement({ etat: 'repos' });
  }, [editPostId, rechargement.etat]);

  /**
   * Ecran de chargement d'un contenu existant.
   *
   * Rendu A LA PLACE du parcours, jamais au-dessus : un wizard vierge affiche
   * pendant qu'on charge — ou apres un echec — est exactement l'image d'un
   * travail perdu. Tant que le contenu n'est pas la, l'ecran dit ou il en est.
   *
   * Chaque issue a son geste : se reconnecter, revenir au Calendrier, ou
   * reessayer. « Une erreur est survenue » ne laisse aucun geste possible.
   */
  if (chargement.etat === 'encours') {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-gray-800 bg-gray-900/50 px-4 py-6 text-sm text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin text-purple-300 flex-shrink-0" />
        <span>Chargement de votre contenu…</span>
      </div>
    );
  }

  if (chargement.etat === 'echec') {
    const message =
      chargement.issue === 'session'
        ? 'Votre session a expiré. Reconnectez-vous pour modifier ce contenu.'
        : chargement.issue === 'refuse' || chargement.issue === 'introuvable'
          ? 'Ce contenu est introuvable, ou ne vous appartient pas.'
          : chargement.issue === 'reseau'
            ? 'La connexion a été interrompue avant que le contenu n\'arrive.'
            : "Le contenu n'a pas pu être chargé.";
    // Reessayer n'a de sens que si la demande peut aboutir au coup suivant :
    // une session expiree ou un contenu qui n'est pas le votre ne changeront
    // pas d'avis, et proposer le bouton la ferait tourner en rond.
    const reessayable = chargement.issue === 'reseau' || chargement.issue === 'erreur';
    return (
      <div
        role="alert"
        className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4"
      >
        <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-medium text-amber-200">{message}</p>
          {reessayable && (
            <button
              type="button"
              onClick={() => { chargeRef.current = false; setChargement({ etat: 'encours' }); }}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-1.5 text-[13px] text-gray-300 hover:bg-gray-800 transition"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Réessayer
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
    <CreerEntete
      mode={started ? 'assistant' : parcours === 'autopilote' ? 'autopilote' : 'choix'}
      onRetour={() => {
        // Assistant : on revient au choix SANS toucher au brouillon — etape,
        // sujet, style, contenu restent ; « Creer une video » les rouvre.
        // Autopilote : le panneau reste monte, seulement replie.
        if (started) setStarted(false);
        else setParcours('choix');
      }}
    />
    {/* Choix du mode : PAS d'aperçu a droite — rien n'est encore a
        prévisualiser, et la colonne distrayait du choix. Une colonne centrée ;
        l'assistant et l'Autopilote gardent les deux colonnes. */}
    <DeuxColonnes nom={started ? 'assistant' : parcours} apercu={started || parcours !== 'choix'}>
      <ColonneTravail>
        {/* MODIFICATION — la seule porte de sortie vers le serveur.
            Visible uniquement quand on modifie : en creation, rien de tout ceci
            n'existe, et le parcours se termine comme avant. */}
        {editPostId && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-800 bg-gray-900/50 px-4 py-3">
            <button
              type="button"
              onClick={enregistrer}
              disabled={enregistrement.etat === 'encours'}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #EC4899 100%)' }}
            >
              {enregistrement.etat === 'encours'
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Check className="w-4 h-4" />}
              {enregistrement.etat === 'encours'
                ? 'Enregistrement…'
                : 'Enregistrer les modifications'}
            </button>

            {enregistrement.etat === 'ok' && (
              <span className="text-[13px] text-emerald-300">Modifications enregistrées.</span>
            )}

            {enregistrement.etat === 'echec' && (
              <span role="alert" className="text-[13px] text-amber-300">
                {enregistrement.issue === 'conflit'
                  // Le message DIT que rien n'a ete ecrit. « Une erreur est
                  // survenue » laisserait croire a un enregistrement partiel,
                  // et l'utilisateur repartirait en pensant son travail sauve.
                  ? 'Ce contenu a été modifié ailleurs entre-temps. Rien n’a été enregistré : vos modifications sont toujours à l’écran.'
                  : enregistrement.issue === 'reseau'
                    ? 'La connexion a été interrompue. Rien n’a été enregistré ; vos modifications sont toujours à l’écran, réessayez.'
                    : enregistrement.issue === 'session'
                      ? 'Votre session a expiré. Reconnectez-vous, puis réessayez : rien n’est perdu.'
                      : enregistrement.issue === 'refuse' || enregistrement.issue === 'introuvable'
                        ? 'Ce contenu est introuvable, ou ne vous appartient pas.'
                        : 'L’enregistrement a échoué. Vos modifications sont toujours à l’écran.'}
              </span>
            )}

            {/* ── REPRENDRE LA VERSION EN BASE ─────────────────────────
                Propose UNIQUEMENT apres un conflit, et en deux temps. Le
                premier clic ne va pas chercher le serveur : il annonce ce que
                le rechargement va couter — les modifications a l'ecran. Un
                seul clic les effacerait sans que personne l'ait demande. */}
            {enregistrement.etat === 'echec' && enregistrement.issue === 'conflit'
              && rechargement.etat !== 'demande' && (
              <button
                type="button"
                onClick={() => setRechargement({ etat: 'demande' })}
                disabled={rechargement.etat === 'encours'}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-1.5 text-[13px] text-gray-300 hover:bg-gray-800 disabled:opacity-60 transition"
              >
                {rechargement.etat === 'encours'
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <RotateCcw className="w-3.5 h-3.5" />}
                Recharger la version récente
              </button>
            )}

            {rechargement.etat === 'demande' && (
              <div className="flex flex-wrap items-center gap-2 basis-full">
                <span className="text-[13px] text-amber-200">
                  Recharger remplacera ce qui est à l’écran par la version enregistrée.
                  Vos modifications non enregistrées seront perdues.
                </span>
                <button
                  type="button"
                  onClick={rechargerVersionRecente}
                  className="inline-flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[13px] text-amber-100 hover:bg-amber-500/20 transition"
                >
                  Confirmer le rechargement
                </button>
                <button
                  type="button"
                  onClick={() => setRechargement({ etat: 'repos' })}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-1.5 text-[13px] text-gray-300 hover:bg-gray-800 transition"
                >
                  Annuler
                </button>
              </div>
            )}

            {rechargement.etat === 'echec' && (
              <span role="alert" className="text-[13px] text-amber-300 basis-full">
                {rechargement.issue === 'reseau'
                  ? 'Le rechargement a échoué : la connexion a été interrompue. Rien n’a changé à l’écran.'
                  : rechargement.issue === 'session'
                    ? 'Le rechargement a échoué : votre session a expiré. Rien n’a changé à l’écran.'
                    : 'Le rechargement a échoué. Rien n’a changé à l’écran.'}
              </span>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {jumeauNotice && (
          <div data-jumeau-notice className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            <span>{jumeauNotice}</span>
            <button onClick={() => setJumeauNotice(null)} className="ml-auto text-xs text-emerald-300 hover:text-white">OK</button>
          </div>
        )}

        {/* Reprise d'une génération de jumeau orpheline (BUG B). En cours : un
            indicateur discret qui dit qu'on peut quitter. En échec : le motif
            et un bouton « Réessayer » qui relance une génération en fond. */}
        {jumeauReprise === 'encours' && (
          <div data-jumeau-reprise="encours" className="flex items-center gap-3 rounded-xl border border-purple-500/30 bg-purple-500/10 px-4 py-2.5 text-[13px] text-purple-200">
            <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin" />
            <span>Votre jumeau se prépare… (vous pouvez quitter cette page et revenir plus tard)</span>
          </div>
        )}
        {jumeauReprise === 'echec' && (
          <div data-jumeau-erreur className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span className="flex-1">La génération de votre jumeau n’a pas abouti.</span>
            <button
              type="button"
              onClick={relancerJumeau}
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[13px] text-amber-100 hover:bg-amber-500/20 transition"
            >
              Réessayer
            </button>
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

        {/* ── Choix du parcours ─────────────────────────────────────────
            UNE action principale a l'ecran. Les deux parcours sont dits par
            leur RESULTAT — « une video maintenant » / « plusieurs contenus
            automatiquement » — pas par leur mecanique. L'Autopilote est
            replie tant qu'on ne l'a pas choisi : son panneau reste monte
            (`hidden`) pour ne rien perdre — reglages, apercu, tournages. */}
        {!started && parcours === 'choix' && (
          <div className="grid gap-4 sm:grid-cols-2" data-parcours-choix>
            {/* Ces deux cartes SONT la page : pas d'aperçu à côté, rien d'autre
                à lire avant de choisir. */}
            <Card>
              <div className="flex items-start gap-4">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: `${accent}26`, color: '#C4B5FD' }}
                >
                  <Wand2 className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <CardTitle className="text-lg">Créer une vidéo</CardTitle>
                  <CardContent className="mt-1 text-sm text-gray-400">
                    Je veux créer <strong className="text-gray-200">une vidéo maintenant</strong>,
                    étape par étape. Le texte et les cartes sont générés pour vous.
                  </CardContent>
                  <p className="mt-2 text-[11px] text-gray-500">
                    Sujet → Style → Audio → Contenu → Envoi
                  </p>
                  <div className="mt-4">
                    <Button variant="primary" size="sm" onClick={() => setStarted(true)} data-parcours-assistant>
                      Créer une vidéo
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
                    Je donne mes rushes et mes réglages, Studiio prépare
                    automatiquement <strong className="text-gray-200">plusieurs contenus</strong>.
                  </CardContent>
                  <p className="mt-2 text-[11px] text-gray-500">
                    Pour produire plusieurs vidéos sans refaire les réglages à chaque fois.
                  </p>
                  <div className="mt-4">
                    <Button variant="secondary" size="sm" onClick={() => setParcours('autopilote')} data-parcours-autopilote>
                      Configurer l&apos;Autopilote
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
            {/* L'editeur avance : une option pour qui veut plus de controle,
                dite comme telle — pas un troisieme parcours, et plus un lien
                present pendant tout le reste. */}
            <p className="sm:col-span-2 text-xs text-gray-500" data-editeur-avance>
              Besoin de plus de contrôle ?{' '}
              <Link href="/dashboard/creer-avance" className="underline underline-offset-2 hover:text-gray-300 transition">
                Ouvrir l’éditeur avancé
              </Link>
            </p>
          </div>
        )}

        {/* ── Autopilote, une fois choisi ───────────────────────────────
            L'autre parcours reste a un clic — un lien discret, pas une
            seconde carte qui rouvrirait la concurrence entre les deux. */}
        {!started && (
          <div hidden={parcours !== 'autopilote'} data-parcours-autopilote-panneau>
            {/* Pas de second titre « Autopilote » ici : l'en-tete de page le
                porte deja, avec le retour au choix des modes. */}
            <Card>
              <AutopilotPanel
                accent={accent}
                onConfigChange={setAutopilotConfig}
                onPatchReady={(patch) => { autopilotPatchRef.current = patch; }}
                onSessionChange={setTournageRegarde}
                onVideoLancee={() => setRelanceVideos((n) => n + 1)}
              />
            </Card>
          </div>
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
                <div key={label} className="flex items-center gap-2 flex-1 last:flex-none min-w-0">
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

                {/* Jumeau numérique — 'aucun' par défaut ; l'état vient du serveur.
                    Deux intentions : ma voix clonée (pose `ttsVoiceId`), ou mon
                    avatar parlant (séquence « Vidéo » à l'envoi). Les textes qu'il
                    dira sont ceux des voix par séquence, modifiables à l'étape Audio. */}
                <JumeauPanel
                  mode={jumeauMode}
                  onModeChange={setJumeauMode}
                  textes={{ titre: sequenceVoices.titre.text, cartes: sequenceVoices.cartes.text, video: sequenceVoices.video.text, cta: sequenceVoices.cta.text }}
                  voixCourante={ttsVoiceId}
                  onVoixJumeau={setTtsVoiceId}
                  coutAvatar={AVATAR_VIDEO_COST}
                />

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

                {/* ── BRIEF DE LA VIDÉO ─────────────────────────────────
                    « Danse » ne dit pas ce que le jumeau dira. Objectif,
                    message, public et CTA guident la generation du contenu
                    (variations du lot) et le pre-remplissage des narrations.
                    Persiste dans le brouillon ; rien n'est genere ici. */}
                <BriefVideo brief={brief} onChange={setBrief} />

                {/* Le texte EXACT de la narration, par sequence — celui de
                    SequenceVoicesPanel, modifiable a l'etape Contenu. */}
                <NarrationRecap
                  textes={generated
                    ? Object.fromEntries(SEQUENCE_KEYS.map((k) => [k, sequenceVoices[k].text]))
                    : null}
                  onModifier={goToGeneration}
                  brief={brief}
                />

                <div className="flex justify-end pt-2">
                  <Button variant="primary" size="sm" onClick={goToStyle}>
                    <span className="flex items-center gap-2">
                      Continuer vers Style <ArrowRight className="w-4 h-4" />
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
                          data-poster-query
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

                    {photosError && (
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-gray-500 flex-1" data-photos-erreur>{photosError}</p>
                        {/* « Réessayer » n'apparaît que là où il sert : une
                            source non configurée ne le deviendra pas d'un
                            clic, et une recherche sans résultat demande une
                            autre requête, pas la même. */}
                        {photosEtat && reessayable(photosEtat) && (
                          <button
                            type="button"
                            data-photos-reessayer
                            disabled={photosLoading}
                            onClick={() => {
                              const d = derniereRecherche.current;
                              if (d) searchPhotos(d.query, d.source);
                            }}
                            className="shrink-0 rounded-lg border border-gray-800 px-2.5 py-1 text-xs text-gray-400 hover:text-white hover:border-gray-700 disabled:opacity-40"
                          >
                            Réessayer
                          </button>
                        )}
                      </div>
                    )}

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
                            {affichesRetenues} / {batchCount} — l’envoi est
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
                        {/* Plus de « les manquantes reprendront les
                            précédentes » : c'est faux depuis que l'envoi
                            refuse un lot incomplet plutot que de recycler
                            une affiche. */}
                        {batchCount > 1 && batchPhotoMode === 'manuel' && (
                          <p className="text-xs text-gray-500">
                            {affichesRetenues} / {batchCount} affiche
                            {affichesRetenues > 1 ? 's' : ''} retenue
                            {affichesRetenues > 1 ? 's' : ''}
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

                    {/* Les deux autres chemins vers une affiche : une image deja
                        dans la mediatheque, ou une image generee par l'IA. */}
                    <div className="grid grid-cols-2 gap-1.5" data-affiche-sources>
                      <button
                        type="button"
                        onClick={() => setAfficheLibOpen(true)}
                        data-affiche-mediatheque
                        className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-800 px-3 py-2 text-xs text-gray-400 hover:border-gray-700 hover:text-white transition-colors"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        Médiathèque
                      </button>
                      <button
                        type="button"
                        onClick={() => setAfficheIAOuvert((v) => !v)}
                        aria-expanded={afficheIAOuvert}
                        data-affiche-generer-ia
                        className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors ${
                          afficheIAOuvert ? 'border-purple-500 text-white' : 'border-gray-800 text-gray-400 hover:border-gray-700 hover:text-white'
                        }`}
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        Générer avec l’IA
                      </button>
                    </div>
                    {afficheIAOuvert && (
                      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-3">
                        <AfficheIA suggestion={currentTopic} onUtiliser={utiliserAfficheIA} format={format} />
                      </div>
                    )}
                    <MediaLibrary
                      isOpen={afficheLibOpen}
                      onClose={() => setAfficheLibOpen(false)}
                      mediaType="image"
                      onSelect={(url) => { applyPhoto(url); setAfficheLibOpen(false); }}
                    />

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

                {/* Filtre couleur — n'etalonnera QUE le rush. Le dire ici est
                    la moitie de la fonctionnalite : sans cette phrase,
                    l'utilisateur attend un etalonnage du montage entier. Et le
                    libelle de support dit ce qui est reellement applique
                    aujourd'hui — rien de plus. */}
                <StyleSection
                  id="ambiance"
                  title="Ambiance"
                  hint={lut ? `${lut.nom} · ${Math.round(lut.intensite * 100)}%` : 'Aucun filtre'}
                  open={openSection === 'ambiance'}
                  onToggle={toggleSection}
                >
                  <div className="space-y-3">
                    <p className="text-xs text-gray-500">
                      Un filtre couleur (LUT) s&apos;applique à la vidéo importée — le rush — et
                      à elle seule. Les textes, le dégradé et l&apos;habillage gardent leurs
                      couleurs. Formats acceptés : .cube (3D ou 1D) et .png (HALD).
                    </p>

                    {!lut ? (
                      <button
                        type="button"
                        onClick={() => lutInputRef.current?.click()}
                        disabled={lutLoading}
                        className={`w-full rounded-xl bg-gray-900/60 px-3 py-2.5 text-sm text-gray-300 transition hover:bg-gray-800/70 ${DISABLED}`}
                      >
                        {lutLoading ? 'Lecture du filtre…' : 'Importer un filtre…'}
                      </button>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <span className="flex-1 truncate text-sm text-white">{lut.nom}</span>
                          <button
                            type="button"
                            onClick={() => { setLut(null); setLutKind(null); setLutNotice(null); }}
                            className="rounded-lg px-2 py-1 text-[11px] text-gray-500 transition hover:text-white"
                          >
                            Retirer
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-24 flex-shrink-0 text-[11px] text-gray-500">
                            Intensité
                          </span>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={lut.intensite}
                            onChange={(e) =>
                              setLut((prev) =>
                                prev ? { ...prev, intensite: Number(e.target.value) } : prev,
                              )
                            }
                            aria-label="Intensité du filtre"
                            className="h-1 flex-1 cursor-pointer appearance-none rounded-lg bg-gray-700 accent-purple-500"
                          />
                          <span className="w-9 text-right text-[11px] tabular-nums text-gray-400">
                            {Math.round(lut.intensite * 100)}%
                          </span>
                        </div>
                        {lutSupportLibelle && (
                          <p className="text-[11px] text-gray-400" data-lut-support>
                            {lutSupportLibelle}
                          </p>
                        )}
                        {lutNotice && (
                          <p className="text-[11px] text-emerald-400/90">{lutNotice}</p>
                        )}
                        {!rushUrl && (
                          <p className="text-[11px] text-amber-400/80">
                            Aucun rush pour l&apos;instant : le filtre n&apos;aura rien à
                            étalonner tant qu&apos;une vidéo n&apos;est pas importée.
                          </p>
                        )}
                      </div>
                    )}

                    <input
                      ref={lutInputRef}
                      type="file"
                      accept={LUT_ACCEPT}
                      hidden
                      onChange={handleLutFile}
                    />
                  </div>
                </StyleSection>

                <StyleSection
                  id="texte"
                  title="Texte"
                  hint={`${textStyles.title.font} · filigrane ${watermarkVisible ? 'affiché' : 'masqué'}`}
                  open={openSection === 'texte'}
                  onToggle={toggleSection}
                >
                    {/* ── TEXTE DES CARTES ──────────────────────────────
                        ⚠️ CES REGLAGES N'EXISTAIENT NULLE PART. Police,
                        taille et format n'etaient proposes que pour le titre
                        et le CTA ; les cartes n'avaient rien. La MEME barre
                        que les autres zones — extraite, pas recopiee. */}
                    <div className="mb-4">
                      <label htmlFor="cards-font" className="block text-sm font-medium mb-2">
                        Texte des cartes
                      </label>
                      <select
                        id="cards-font"
                        value={cardsTypography.font ?? DEFAULT_TEXT_STYLES.title.font}
                        onChange={(e) => {
                          void ensureFontLoaded(e.target.value);
                          patchCards({ font: e.target.value });
                        }}
                        onFocus={() => { void preloadCatalogPreview(); }}
                        style={{ fontFamily: fontStack(cardsTypography.font ?? DEFAULT_TEXT_STYLES.title.font) }}
                        data-cards-font
                        className="w-full rounded-lg bg-gray-800 border border-gray-700 focus:border-purple-500 outline-none px-2 py-1.5 text-sm"
                      >
                        {FONT_GROUPS.map((g) => (
                          <optgroup key={g.group} label={g.label}>
                            {g.fonts.map((f) => (
                              <option key={f} value={f} style={{ fontFamily: fontStack(f) }}>{f}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-[11px] text-gray-500 w-24 flex-shrink-0">Taille</span>
                        <input
                          type="range"
                          min={Math.round(SCALE_MIN * 100)}
                          max={Math.round(SCALE_MAX * 100)}
                          step={5}
                          value={Math.round((cardsTypography.scale ?? 1) * 100)}
                          onChange={(e) => patchCards({ scale: Number(e.target.value) / 100 })}
                          aria-label="Taille du texte des cartes"
                          data-cards-scale
                          className="flex-1 h-1 rounded-lg appearance-none bg-gray-700 accent-purple-500 cursor-pointer"
                        />
                        <span className="text-[11px] text-gray-400 w-11 text-right tabular-nums">
                          {Math.round((cardsTypography.scale ?? 1) * 100)}%
                        </span>
                      </div>
                      <div className="mt-2">
                        {/* Le texte des cartes n'etait ni en capitales ni
                            aligne : ses replis sont « Normal » et « gauche ». */}
                        <TextFormatToolbar
                          zone="cards"
                          valeurs={cardsTypography}
                          defauts={{ textCase: 'none', align: 'left', bold: true, italic: false }}
                          onChange={patchCards}
                        />
                      </div>
                    </div>

                    {/* ── STYLE DES CARTES ──────────────────────────────
                        ⚠️ IL ETAIT FIGE A « Compact », alors que « Sans
                        cadre » figurait deja dans la liste et que le
                        compositeur savait deja le dessiner. Ce n'etait pas
                        une fonctionnalite a ecrire, mais un choix a rendre
                        a l'utilisateur. */}
                    <div className="mb-4">
                      <label htmlFor="card-style" className="block text-sm font-medium mb-2">
                        Style des cartes
                      </label>
                      <select
                        id="card-style"
                        value={cardStyle}
                        onChange={(e) => setCardStyle(e.target.value)}
                        data-card-style
                        className="w-full rounded-lg bg-gray-800 border border-gray-700 focus:border-purple-500 outline-none px-2 py-1.5 text-sm"
                      >
                        {CARD_STYLES.map((c) => (
                          <option key={c.label} value={c.label}>{c.label} — {c.sublabel}</option>
                        ))}
                      </select>
                      <p className="text-[11px] text-gray-500 mt-1">
                        « Sans cadre » affiche le texte seul, sans rectangle de fond.
                      </p>
                    </div>

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

                            {/* ── BARRE DE FORMATAGE ───────────────────
                                Gras et italique y sont rejoints par souligne,
                                barre, casse et alignement. C'est la MEME barre
                                que l'Autopilote — extraite plutot que recopiee.

                                ⚠️ ELLE VAUT AUSSI POUR LE SOUS-TITRE, alors
                                que gras et italique lui restaient imposes par
                                le titre : `drawIntro` et `SequenceTitle`
                                appliquent bien SA casse, SON alignement et SA
                                decoration. Les lui refuser aurait ete un
                                manque, pas une prudence — d'ou `showBoldItalic`
                                qui masque les deux seuls reglages qu'il
                                n'a effectivement pas. */}
                            {(() => {
                              const st = isSubtitle
                                ? textStyles.subtitle
                                : isTitle ? textStyles.title : textStyles.cta;
                              return (
                                <TextFormatToolbar
                                  zone={isSubtitle ? 'subtitle' : isTitle ? 'title' : 'cta'}
                                  valeurs={st}
                                  defauts={{
                                    // Le rendu met titre et CTA en capitales
                                    // quand rien n'est choisi ; pas le
                                    // sous-titre.
                                    textCase: isSubtitle ? 'none' : DEFAULT_TEXT_CASE,
                                    align: isTitle || isSubtitle ? 'left' : 'center',
                                    bold: 'bold' in st ? (st.bold as boolean) : undefined,
                                    italic: 'italic' in st ? (st.italic as boolean) : undefined,
                                  }}
                                  showBoldItalic={!isSubtitle}
                                  onChange={(p) => patch(p as Record<string, unknown>)}
                                />
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
                        Un seul style pour tout le montage. Le choisir le rejoue aussitôt
                        dans l’aperçu, sur votre contenu.
                      </p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {/* La liste vient du compositeur : recopiée ici, elle
                            proposerait un jour un style qu'il ne sait plus
                            jouer — ou tairait ceux qu'il a gagnés. */}
                        {TRANSITION_KEYS.map((style) => {
                          const choisi = style === transition;
                          // La vignette joue si l'option est choisie, survolée,
                          // focalisée ou épinglée — jamais avec la réduction
                          // des animations (voir `useOptionPreview`).
                          const joue = apercuTransitions.isPlaying(style, choisi);
                          return (
                            /* Deux boutons FRÈRES, jamais imbriqués : un bouton
                               dans un bouton n'est pas du HTML valide, et le
                               clavier n'atteindrait que l'extérieur. */
                            <div key={style} className="relative">
                            <button
                              type="button"
                              // Choisir, ET voir tout de suite : l'extrait
                              // joue la transition sur le vrai contenu, dans
                              // le grand aperçu. Le style joué est celui de
                              // l'état — le même qui part au rendu.
                              onClick={() => { setTransition(style); jouerTransition(style); }}
                              {...apercuTransitions.bind(style)}
                              aria-pressed={choisi}
                              data-transition={style}
                              className={`w-full flex items-center gap-2 rounded-lg border px-2.5 py-2 pr-7 text-[11px] font-medium text-left ${classesCarteOption(choisi)}`}
                            >
                              {/* La géométrie RÉELLE de l'effet, au format du
                                  montage — `transitionLayerStyles` transcrit
                                  `drawTransition`, pas une illustration. */}
                              <TransitionMiniPreview style={style} playing={joue} aspect={ASPECT_CSS[format]} height={40} />
                              <span className="min-w-0">{TRANSITION_LABELS[style]}</span>
                              {choisi && <Check size={12} aria-hidden="true" data-coche className="ml-auto shrink-0 text-purple-300" />}
                            </button>
                            {/* Lecture explicite : mobile (pas de survol) et
                                lecteurs d'écran. Épingle la vignette, et joue
                                l'extrait dans le grand aperçu — avec CE style,
                                sans le choisir. */}
                            <button
                              type="button"
                              onClick={() => { apercuTransitions.togglePin(style); jouerTransition(style); }}
                              aria-pressed={apercuTransitions.pinned === style}
                              aria-label={`Lire l’aperçu de ${TRANSITION_LABELS[style]}`}
                              data-transition-play={style}
                              className={`absolute top-1 right-1 flex items-center justify-center w-5 h-5 rounded-md transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-purple-400 ${
                                apercuTransitions.pinned === style
                                  ? 'bg-purple-600/60 text-white'
                                  : 'bg-gray-800/70 text-gray-400 hover:text-white'
                              }`}
                            >
                              <Play size={10} strokeWidth={2.2} />
                            </button>
                            </div>
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
                        Jouée au début de chaque séquence. Chaque option s’anime au survol ;
                        la choisir la rejoue aussitôt dans l’aperçu, sur votre texte. Le rendu final
                        suit la même règle.
                      </p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {TEXT_ANIMATION_KEYS.map((style) => {
                          const choisi = style === textAnimation;
                          const joue = apercuAnimations.isPlaying(style, choisi);
                          return (
                            <div key={style} className="relative">
                            <button
                              type="button"
                              // Choisir, ET voir : le début de la séquence
                              // courante rejoue avec l'animation de l'état.
                              onClick={() => { setTextAnimation(style); jouerAnimation(style); }}
                              {...apercuAnimations.bind(style)}
                              aria-pressed={choisi}
                              data-text-animation={style}
                              className={`w-full flex items-center gap-2 rounded-lg border px-2.5 py-2 pr-7 text-[11px] font-medium text-left ${classesCarteOption(choisi)}`}
                            >
                              {/* Le MÊME `TextAnimationLayer` que le rendu
                                  serveur, sur un mot d'exemple. */}
                              <TextAnimationMiniPreview style={style} playing={joue} height={40} />
                              <span className="min-w-0">{TEXT_ANIMATION_LABELS[style]}</span>
                              {choisi && <Check size={12} aria-hidden="true" data-coche className="ml-auto shrink-0 text-purple-300" />}
                            </button>
                            <button
                              type="button"
                              // Épingle la vignette et joue l'extrait dans le
                              // grand aperçu — avec CETTE animation, sans la choisir.
                              onClick={() => { apercuAnimations.togglePin(style); jouerAnimation(style); }}
                              aria-pressed={apercuAnimations.pinned === style}
                              aria-label={`Lire l’aperçu de ${TEXT_ANIMATION_LABELS[style]}`}
                              data-text-animation-play={style}
                              className={`absolute top-1 right-1 flex items-center justify-center w-5 h-5 rounded-md transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-purple-400 ${
                                apercuAnimations.pinned === style
                                  ? 'bg-purple-600/60 text-white'
                                  : 'bg-gray-800/70 text-gray-400 hover:text-white'
                              }`}
                            >
                              <Play size={10} strokeWidth={2.2} />
                            </button>
                            </div>
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
                      <Music className="w-4 h-4" /> Continuer vers Audio
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
                  // La voix TTS vit dans le wizard pour entrer au brouillon.
                  voiceId={ttsVoiceId}
                  onVoiceIdChange={setTtsVoiceId}
                  // Carte « Ma voix clonée » : ce que l'Autopilote a et que
                  // Créer n'avait pas. « Utiliser ma voix » passe par
                  // `setTtsVoiceId`, donc aussi par les voix par séquence.
                  clonedVoiceCard
                />

                <div className="flex justify-between pt-2">
                  <Button variant="ghost" size="sm" onClick={() => setStep(S.style)}>
                    <span className="flex items-center gap-2">
                      <ArrowLeft className="w-4 h-4" /> Retour
                    </span>
                  </Button>
                  {/* ⚠️ Ce bouton ne GENERE rien de nouveau : le contenu est
                      produit des l'entree dans Style (`goToStyle` →
                      `ensureGenerated`), et `goToGeneration` ne le refait que
                      si le sujet a change. « Generer le contenu » contredisait
                      donc le fil d'etapes ; le libelle dit ou l'on va. */}
                  <Button variant="primary" size="sm" onClick={goToGeneration}>
                    <span className="flex items-center gap-2">
                      Continuer vers Contenu <ArrowRight className="w-4 h-4" />
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
                    // Meme voix que le panneau audio : les deux selecteurs
                    // montrent celle que le brouillon restaure.
                    voiceId={ttsVoiceId}
                    onVoiceIdChange={setTtsVoiceId}
                    onSequenceDurationChange={(key, seconds) => {
                      // Action explicite de l'utilisateur : la meme table de
                      // setters que le calage automatique a la generation.
                      const setters: Record<SequenceKey, (n: number) => void> = {
                        titre: setIntroDuration,
                        cartes: setCardsDuration,
                        video: setVideoDuration,
                        cta: setCtaDuration,
                      };
                      setters[key](seconds);
                    }}
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
                        Continuer vers Envoi <ArrowRight className="w-4 h-4" />
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
                      {envoiIntention === 'programmer' && reseauxProgrammes.length > 0 ? (
                        <p className="text-sm text-gray-400 mt-1" data-envoi-confirmation="programmer">
                          {batchCount > 1
                            ? `Les ${batchCount} vidéos sont composées et les posts programmés`
                            : 'La vidéo est composée et le post programmé'}{' '}
                          sur {reseauxProgrammes.map((r) => LIBELLE_RESEAU[r]).join(', ')}, à {scheduledTime}.
                          La publication est automatique, à l&apos;heure dite — vous pouvez encore
                          la modifier ou l&apos;annuler depuis le calendrier avant qu&apos;elle parte.
                        </p>
                      ) : (
                        <p className="text-sm text-gray-400 mt-1" data-envoi-confirmation="brouillon">
                          {batchCount > 1
                            ? `Les ${batchCount} vidéos sont composées et les posts enregistrés en brouillon.`
                            : 'La vidéo est composée et le post enregistré en brouillon.'}{' '}
                          Le calendrier les lit telles quelles — aucun nouveau rendu n&apos;est
                          nécessaire. Rien n&apos;est publié : la diffusion se déclenche depuis le
                          calendrier, une fois le brouillon programmé.
                        </p>
                      )}
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
                        {envoiIntention === 'programmer' && reseauxProgrammes.length > 0
                          ? ` programmée${batchCount > 1 ? 's' : ''} sur vos réseaux.`
                          : ` enregistrée${batchCount > 1 ? 's' : ''} en brouillon.`}{' '}
                        <span className="text-gray-300" data-facturation-annonce>
                          {annonceCout(
                            politiqueFacturation, tarifsServeur,
                            format === '9:16' ? 'reel' : 'tv',
                            batchCountAutorise(batchCount),
                          )}
                        </span>{' '}
                        {politiqueFacturation === 'partner_cost_only'
                          ? `— ${MENTION_AUCUN_CREDIT}`
                          : tarifsServeur
                            ? 'seront débités une fois le rendu terminé.'
                            : '— le tarif du serveur fait foi.'}
                      </p>
                    </div>

                    {/* ── UN SEUL CONTENU, OU UNE SERIE ───────────────────
                        Le choix precede le nombre : « 1 » perdu au milieu
                        d'une rangee de dix ne se lit pas comme un mode, et
                        c'est pourtant le parcours de loin le plus frequent.
                        `batchCount` reste la SEULE source de verite — le mode
                        s'en deduit, deux etats se desynchroniseraient. */}
                    <div>
                      <label className="block text-sm font-medium mb-2">Que voulez-vous produire ?</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          data-batch-mode="unique"
                          aria-pressed={modeLot === 'unique'}
                          onClick={() => setBatchCount(1)}
                          className={`rounded-lg border px-3 py-2.5 text-sm text-left transition-colors ${
                            modeLot === 'unique'
                              ? 'border-purple-500 text-white'
                              : 'border-gray-800 text-gray-400 hover:text-white hover:border-gray-700'
                          }`}
                        >
                          <span className="block font-medium">Un seul contenu</span>
                          <span className="block text-[11px] text-gray-500 mt-0.5">Le montage affiché</span>
                        </button>
                        {/* La carte reste VISIBLE : la masquer laisserait croire
                            que la serie n'a jamais existe. `disabled` sur un
                            bouton natif retire l'element de l'ordre de
                            tabulation et neutralise clic ET clavier. */}
                        <button
                          type="button"
                          data-batch-mode="serie"
                          disabled={!BATCH_SERIE_DISPONIBLE}
                          aria-disabled={!BATCH_SERIE_DISPONIBLE}
                          aria-pressed={modeLot === 'serie'}
                          title={BATCH_SERIE_DISPONIBLE ? undefined : BATCH_SERIE_EXPLICATION}
                          onClick={() => setBatchCount((n) => batchCountAutorise(n > 1 ? n : 2))}
                          className={`rounded-lg border px-3 py-2.5 text-sm text-left transition-colors ${
                            !BATCH_SERIE_DISPONIBLE
                              ? 'border-gray-900 text-gray-600 opacity-50 cursor-not-allowed'
                              : modeLot === 'serie'
                                ? 'border-purple-500 text-white'
                                : 'border-gray-800 text-gray-400 hover:text-white hover:border-gray-700'
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            <span className="block font-medium">Série</span>
                            {/* La pastille reste, et change de sens : elle
                                disait « Bientôt disponible », elle dit
                                maintenant « Pilote ». Un mode rouvert à deux
                                vidéos n'est pas le mode complet. */}
                            <span
                              data-batch-serie-badge
                              className="text-[9px] uppercase tracking-wide rounded px-1 py-0.5 border border-gray-700 text-gray-500"
                            >
                              {BATCH_SERIE_BADGE}
                            </span>
                          </span>
                          <span className="block text-[11px] text-gray-500 mt-0.5">
                            {BATCH_SERIE_EXPLICATION}
                          </span>
                        </button>
                      </div>
                    </div>

                    {modeLot === 'serie' && (
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        Combien de vidéos ?
                        <span className="ml-2 text-[11px] font-normal text-gray-500" data-serie-plafond>
                          De 2 à {BATCH_SERIE_MAX}
                        </span>
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {/* `nombresProposes()` et non une plage locale :
                            l'ecran ne doit pas pouvoir proposer un nombre que
                            le lancement refuserait : de 2 a `BATCH_SERIE_MAX`. */}
                        {nombresProposes().map((n) => (
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
                      <p className="mt-2 text-xs text-gray-500">
                        Chaque vidéo reçoit un angle différent et sa propre date, un jour après
                        l’autre. La première garde le contenu affiché ci-contre.
                        {/* Les attributs disent l'etat que la garde d'envoi
                            lira : combien d'affiches sont posees, et si le
                            lot peut partir. */}
                        <span
                          data-batch-photos-count={affichesRetenues}
                          data-batch-photos-ready={affichesCompletes ? 'true' : 'false'}
                        >
                          {affichesRetenues > 0
                            ? ` ${affichesRetenues} affiche${affichesRetenues > 1 ? 's' : ''} retenue${affichesRetenues > 1 ? 's' : ''}.`
                            : ' Choisissez plusieurs photos dans « Photo d’affiche » pour les varier.'}
                        </span>
                      </p>
                    </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-sm font-medium mb-2" htmlFor="lot-date">Date</label>
                        <input
                          id="lot-date"
                          type="date"
                          value={scheduledDate}
                          onChange={(e) => setScheduledDate(e.target.value)}
                          className="w-full rounded-xl bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none p-2.5 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-2" htmlFor="lot-heure">Heure</label>
                        {/* `step={60}` : la minute est explicite — « 18:45 »
                            ou « 19:15 » se saisit et s'envoie tel quel
                            (`scheduled_time`, colonne TIME ; le cron compare
                            en HH:MM). Le fuseau de saisie part avec le post
                            (`metadata.timezone`). */}
                        <input
                          id="lot-heure"
                          type="time"
                          step={60}
                          value={scheduledTime}
                          onChange={(e) => setScheduledTime(e.target.value || '12:00')}
                          className="w-full rounded-xl bg-gray-900 border border-gray-800 focus:border-purple-500 outline-none p-2.5 text-sm"
                        />
                      </div>
                    </div>

                    {/* ── TROIS INTENTIONS, DITES EXPLICITEMENT ──────────
                        1. Brouillon : `draft`, aucune plateforme — l'envoi
                           historique ; aucun cron ne publie un brouillon.
                        2. Programmer : `scheduled` + reseaux CONNECTES
                           choisis — le cron publie a la date et l'heure
                           saisies. Meme mecanisme que « Programmer » dans
                           le Calendrier.
                        3. Telecharger : le bouton dedie plus bas — aucun
                           post, aucune publication.
                        Absent en modification : l'envoi n'y existe pas. */}
                    {!editPostId && (
                    <div data-envoi-intentions>
                      <label className="block text-sm font-medium mb-2">Que faire de {batchCount > 1 ? 'ces vidéos' : 'cette vidéo'} ?</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          data-envoi-intention="brouillon"
                          aria-pressed={envoiIntention === 'brouillon'}
                          onClick={() => setEnvoiIntention('brouillon')}
                          className={`rounded-lg border px-3 py-2.5 text-sm text-left ${classesCarteOption(envoiIntention === 'brouillon')}`}
                        >
                          <span className="block font-medium">Garder en brouillon</span>
                          <span className="block text-[11px] text-gray-500 mt-0.5">
                            Dans le calendrier, sans publication automatique.
                          </span>
                        </button>
                        <button
                          type="button"
                          data-envoi-intention="programmer"
                          aria-pressed={envoiIntention === 'programmer'}
                          disabled={reseauxConnectes.length === 0}
                          aria-disabled={reseauxConnectes.length === 0}
                          title={reseauxConnectes.length === 0
                            ? 'Aucun réseau connecté : connectez-en un dans « Réseaux sociaux » pour programmer.'
                            : undefined}
                          onClick={() => setEnvoiIntention('programmer')}
                          className={`rounded-lg border px-3 py-2.5 text-sm text-left ${classesCarteOption(envoiIntention === 'programmer')}`}
                        >
                          <span className="block font-medium">Programmer la publication</span>
                          <span className="block text-[11px] text-gray-500 mt-0.5">
                            Publiée automatiquement à la date et l’heure choisies, sur les réseaux sélectionnés.
                          </span>
                        </button>
                      </div>
                      {/* Aucun reseau connecte : on le dit, et on reste en
                          brouillon — jamais un post « scheduled » que le
                          cron marquerait « failed » a l'heure dite. */}
                      {!etatReseaux.chargement && reseauxConnectes.length === 0 && (
                        <p className="mt-2 text-xs text-gray-500" data-envoi-aucun-reseau>
                          Aucun réseau connecté : la vidéo restera en brouillon.{' '}
                          <Link href="/dashboard/social" className="text-purple-300 hover:text-white underline">
                            Connecter un réseau
                          </Link>
                        </p>
                      )}
                      {envoiIntention === 'programmer' && reseauxConnectes.length > 0 && (
                        <div className="mt-2" data-envoi-reseaux>
                          <p className="text-xs text-gray-400 mb-1.5">Sur quels réseaux ?</p>
                          <div className="flex flex-wrap gap-1.5">
                            {reseauxConnectes.map((r) => {
                              const retenu = reseauxProgrammes.includes(r);
                              return (
                                <button
                                  key={r}
                                  type="button"
                                  data-envoi-reseau={r}
                                  aria-pressed={retenu}
                                  onClick={() => setReseauxProgrammes((prev) => (
                                    prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]
                                  ))}
                                  className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${
                                    retenu ? 'border-purple-500/50 bg-gray-800 text-white' : 'border-gray-800 text-gray-400 hover:text-white'
                                  }`}
                                >
                                  {LIBELLE_RESEAU[r]}
                                </button>
                              );
                            })}
                          </div>
                          {reseauxProgrammes.length === 0 && (
                            <p className="mt-1.5 text-[11px] text-amber-400" data-envoi-reseaux-vides>
                              Choisissez au moins un réseau — sinon la vidéo restera en brouillon.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                    )}

                    {/* ── RECAPITULATIF AVANT CONFIRMATION ────────────────
                        Le nombre exact et le cout, en clair, juste au-dessus
                        du bouton : c'est la derniere chose lue avant de
                        depenser des credits. */}
                    <div
                      data-batch-recap
                      className="rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2.5 text-xs text-gray-400"
                    >
                      <span className="text-gray-200 font-medium" data-serie-nombre>
                        {libelleNombre(batchCountAutorise(batchCount))}
                      </span>
                      {' · '}
                      <span className="text-gray-200 font-medium" data-facturation-recap>
                        {annonceCout(
                          politiqueFacturation, tarifsServeur,
                          format === '9:16' ? 'reel' : 'tv',
                          batchCountAutorise(batchCount),
                        )}
                      </span>
                      {scheduledDate ? (
                        <>
                          {' · '}
                          {batchCount > 1 ? 'à partir du ' : 'le '}
                          {scheduledDate} à {scheduledTime}
                          {batchCount > 1 ? ', un par jour' : ''}
                        </>
                      ) : (
                        <>{' · '}<span className="text-amber-400">choisissez une date</span></>
                      )}
                      {/* La phrase suit l'intention : elle est la derniere
                          chose lue avant de confirmer, elle doit dire ce qui
                          va VRAIMENT se passer. */}
                      {envoiIntention === 'programmer' && reseauxProgrammes.length > 0 ? (
                        <span className="block mt-1 text-gray-500" data-envoi-recap="programmer">
                          Programmé{batchCount > 1 ? 's' : ''}{scheduledDate ? ` le ${scheduledDate}` : ''} à {scheduledTime}
                          {' '}sur {reseauxProgrammes.map((r) => LIBELLE_RESEAU[r]).join(', ')} — publication
                          automatique par le cron, à l’heure dite ({fuseauNavigateur()}).
                        </span>
                      ) : (
                        <span className="block mt-1 text-gray-500" data-envoi-recap="brouillon">
                          Enregistré{batchCount > 1 ? 's' : ''} en brouillon. Aucune publication
                          automatique : la diffusion reste déclenchée depuis le calendrier.
                        </span>
                      )}
                    </div>

                    {/* ── TÉLÉCHARGER SUR L'ORDINATEUR ────────────────────
                        Rendu local : aucun post n'est créé, aucune
                        publication. La facturation est celle du Calendrier —
                        même rendu, même politique, donc aucun crédit non
                        plus sous `partner_cost_only` — et elle est AFFICHÉE
                        sur le bouton : c'est un rendu facturé, pas une
                        simple sauvegarde. Le fichier passe par le circuit
                        sécurisé d'export (`rendreEtFacturer`, clé attribuée
                        par le serveur, confirmation) et le navigateur
                        propose ensuite l'enregistrement : rien n'est
                        déposé automatiquement dans un dossier de la machine.

                        Absent en modification : il compose et débite, comme
                        l'envoi. */}
                    {!editPostId && (
                    <button
                      type="button"
                      onClick={() => runRender('bureau')}
                      disabled={sending || actif(VERROU.serie)}
                      data-export-bureau
                      title="Composer le montage et l’enregistrer sur votre ordinateur, sans créer de post ni publier — rendu facturé"
                      className="w-full flex items-center justify-center gap-2 rounded-lg border border-gray-800 px-3 py-2 text-xs text-gray-300 hover:text-white hover:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      {batchCount > 1
                        ? `Télécharger les ${batchCount} vidéos (.zip)`
                        : 'Télécharger la vidéo'}
                      <span className="text-gray-500">·</span>
                      <span data-export-bureau-cout>
                        {annonceCout(
                          politiqueFacturation, tarifsServeur,
                          format === '9:16' ? 'reel' : 'tv',
                          batchCountAutorise(batchCount),
                        )}
                      </span>
                    </button>
                    )}

                    <div className="flex justify-between pt-2">
                      <Button variant="ghost" size="sm" onClick={() => setStep(S.contenu)}>
                        <span className="flex items-center gap-2">
                          <ArrowLeft className="w-4 h-4" /> Retour
                        </span>
                      </Button>
                      {/* Absent en modification : il ferait un `POST /api/posts`,
                          donc un SECOND post, et debiterait un rendu. La seule
                          action y est « Enregistrer les modifications ». */}
                      {!editPostId && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => runRender('calendrier')}
                        // « Programmer » sans reseau retenu n'a rien a
                        // programmer : le bouton attend le choix plutot que
                        // d'envoyer un brouillon sous une etiquette qui dit
                        // le contraire.
                        disabled={sending || actif(VERROU.serie) || !scheduledDate
                          || (envoiIntention === 'programmer' && reseauxProgrammes.length === 0)}
                        className={DISABLED}
                        data-envoi-action={envoiIntention}
                      >
                        <span className="flex items-center gap-2">
                          {sending ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" /> Rendu…
                            </>
                          ) : (
                            <>
                              <CalendarPlus className="w-4 h-4" />{' '}
                              {envoiIntention === 'programmer'
                                ? (batchCount > 1 ? `Composer et programmer ${batchCount} vidéos` : 'Composer et programmer')
                                : (batchCount > 1 ? `Composer et envoyer ${batchCount} vidéos` : 'Composer et envoyer')}
                            </>
                          )}
                        </span>
                      </Button>
                      )}
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

                    {/* ── ECHEC PARTIEL ───────────────────────────────────
                        Un lot qui s'arrete en route laissait jusqu'ici un
                        simple message d'erreur : impossible de savoir ce qui
                        etait passe. On liste chaque contenu et son etat.

                        La REPRISE est volontairement inactive : relancer un
                        contenu echoue suppose de savoir qu'il n'a pas ete
                        facture, et le debit ne dispose d'aucune cle
                        d'idempotence. `repriseAutorisee` porte cette regle. */}
                    {!sending && batchPartiel(batchItems) && (
                      <div data-batch-report className="rounded-lg border border-amber-900/60 bg-amber-950/20 p-3 space-y-2">
                        <div className="flex items-center gap-2 text-sm font-medium text-amber-300">
                          <AlertTriangle className="w-4 h-4" />{' '}
                          <span data-interruption-titre>{titreInterruption(batchItems.length)}</span>
                        </div>
                        {/* Le bilan d'abord, en une ligne : ce qui est gagné
                            et ce qui est perdu. Le détail par contenu est
                            juste en dessous pour qui veut savoir lequel. */}
                        <p className="text-xs font-medium text-gray-300" data-serie-bilan>
                          {bilanSerie(batchItems)}
                        </p>
                        <p className="text-xs text-gray-400">
                          {(() => {
                            const { total, prets, restants } = batchSummary(batchItems);
                            return `${prets} sur ${total} enregistrée${prets > 1 ? 's' : ''} au calendrier`
                              + (restants > 0 ? `. Les contenus jamais démarrés n’ont ouvert aucune tentative — rien n’a été débité pour eux.` : '.');
                          })()}
                        </p>
                        <ul className="space-y-1">
                          {batchItems.map((it) => (
                            <li key={it.id} data-batch-item={it.id} data-batch-item-state={it.etat} className="flex items-center gap-2 text-xs">
                              <span
                                className="w-1.5 h-1.5 rounded-full shrink-0"
                                style={{
                                  backgroundColor:
                                    it.etat === 'pret' ? '#6EE7B7'
                                      : it.etat === 'echoue' ? '#FCA5A5'
                                        : it.etat === 'rendu' ? '#93C5FD' : '#4B5563',
                                }}
                              />
                              <span className="text-gray-400">Vidéo {it.index + 1}</span>
                              <span className="text-gray-500">
                                {it.etat === 'pret' ? 'prête'
                                  : it.etat === 'echoue' ? `échec — ${it.erreur || 'raison inconnue'}`
                                    : it.etat === 'rendu' ? 'rendu interrompu' : 'jamais démarrée'}
                              </span>
                            </li>
                          ))}
                        </ul>
                        {/* ── CE QUI RESTE A FAIRE ────────────────────
                            Un seul contenu : il n'y a rien a « reprendre »,
                            et l'ancienne raison affirmait que le debit n'a
                            pas de cle d'idempotence — ce n'est plus vrai
                            depuis le socle. On dit ce qui s'est reellement
                            passe : rien n'a ete debite, rien n'a ete
                            enregistre, la creation peut etre relancee.

                            Plusieurs contenus : le vocabulaire Serie et sa
                            regle de reprise sont conserves tels quels. */}
                        {batchItems.length > 1 && (
                          <button
                            type="button"
                            data-batch-retry
                            disabled
                            title={repriseAutorisee(batchItems).raison}
                            className="w-full rounded-lg border border-gray-800 px-3 py-2 text-xs text-gray-500 cursor-not-allowed"
                          >
                            Reprendre les contenus échoués
                          </button>
                        )}
                        <p className="text-[11px] text-gray-500" data-interruption-message>
                          {messageInterruption(batchItems.length)}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </Card>
        )}
      </ColonneTravail>

      {/* Colonne d'apercu COLLEE — les classes (sticky, top-20, items-start
          sur la grille) vivent dans `DeuxColonnes`, la même que Mon avatar.
          Absente sur le choix du mode (voir `apercu` ci-dessus). */}
      {(started || parcours !== 'choix') && (
      <ColonneApercu>
        {/* ── AVANT DE COMMENCER : L'APERÇU DE L'AUTOPILOTE ─────────────
            L'assistant n'a rien généré tant qu'on n'a pas cliqué
            « Commencer » : sa colonne d'aperçu n'affichait donc qu'un cadre
            en pointillés — juste à côté du panneau où l'on règle les
            couleurs et le fond des cartes de l'Autopilote.

            ⚠️ LE BASCULEMENT SE FAIT SUR `started`, ET SUR RIEN D'AUTRE. Dès
            que l'assistant démarre, c'est SON aperçu qui revient, avec ses
            poignées d'édition, ses refs d'export et son bouton de rendu :
            rien de ce qui suit n'est modifié. */}
        {!started ? (
          <div className="space-y-4">
            {/* ⚠️ TOUJOURS MONTÉ QUAND UN TOURNAGE EST OUVERT — c'est lui qui
                sonde. Il ne rend rien tant qu'il n'a rien à montrer, et
                prévient par `onEtat` : c'est ce qui permet à l'aperçu du
                projet de céder la place SANS qu'un second lecteur existe. */}
            {tournageRegarde.sessionId && (
              <VideosPretes
                sessionId={tournageRegarde.sessionId}
                aucunRush={tournageRegarde.aucunRush}
                relance={relanceVideos}
                onEtat={setEtatVideo}
              />
            )}
            {!videoOccupeLApercu && (
              /* ⚠️ PLUS DE DÉFILEMENT INTERNE. L'ancienne boîte `overflow-y-auto`
                 bornée à `100vh - 6rem` gardait son `scrollTop` une fois
                 descendue : l'en-tête, les onglets et le haut de l'affiche
                 restaient masqués — le « haut coupé » du choix et de
                 l'Autopilote, que l'assistant, sans cette boîte, n'avait pas.
                 Même règle que l'assistant : la colonne colle sous la navbar,
                 et ce qui dépasse en bas se voit en faisant défiler la page. */
              <div data-autopilot-apercu-cadre>
                <AutopilotPreview
                  config={autopilotConfig}
                  accent={accent}
                  onPatch={autopilotPatch}
                />
              </div>
            )}
          </div>
        ) : (
        <>
        <Preview
          {...previewShared}
          previewRef={previewRef}
          cardsRef={cardsRef}
          frameRef={setFrame}
          displayScale={displayScale}
          onDragStart={startDrag}
          onDragMove={moveDrag}
          onDragEnd={endDrag}
          dragging={dragging}
          onCardDragStart={startCardDrag}
          // ⚠️ LES CARTES N'AVAIENT PAS DE POIGNEES. Tirer un coin de carte
          // ne faisait rien — elles n'existaient que pour le titre et le CTA.
          // Le geste agrandit le TEXTE de toutes les cartes : une carte deux
          // fois plus grosse que sa voisine ne serait pas un reglage.
          onCardResizeStart={startCardTextResize}
          draggingCard={draggingCard}
          onClearSelection={clearSelection}
          cropping={cropping}
          onPosterPanStart={startPosterPan}
          onPosterZoomStart={startPosterZoom}
          onPhotoDrop={(url) => { setPhotoDragging(false); applyPhoto(url); }}
          photoDragging={photoDragging}
          guides={dragGuides}
          gaps={dragGaps}
          selection={dragSelection}
          onMeasure={setMeasuredKey}
            onElementDragStart={startElementDrag}
          onElementResizeStart={startElementResize}
          onElementDelete={deleteElement}
          onFocusChange={setPreviewFocus}
          // ⚠️ TOUTES LES SEQUENCES, PAS SEULEMENT CERTAINES. Titre,
          // sous-titre, cartes et CTA ouvrent chacun leur panneau — c'est ce
          // que l'utilisateur attend d'un double-clic sur un element.
          onTextDoubleClick={ouvrirZone}
          onCardDoubleClick={() => ouvrirZone('cards')}
          // Le vrai rendu d'abord ; sinon la lecture des séquences (« Tout »
          // seulement) ; sinon rien — le plateau nu.
          overlay={renduDansLeCadre ?? lectureSequences}
        />

        {/* ── RÉGLAGES D'UNE SÉQUENCE, AU DOUBLE-CLIC ──────────────────
            Le MÊME `FloatingPanel` et la MÊME `TextFormatToolbar` que
            l'Autopilote — extraits, jamais recopiés. La différence tient en
            une chose : ici le CONTENU s'édite aussi. */}
        <FloatingPanel
          title={ZONE_LABELS[zoneOuverte ?? 'title']}
          isOpen={zoneOuverte !== null}
          onClose={() => setZoneOuverte(null)}
          initialX={zonePos.x}
          initialY={zonePos.y}
          accentColor={accent}
          // Relâcher un curseur hors du panneau le fermerait : c'est
          // exactement le geste qu'on fait en réglant une taille.
          closeOnClickOutside={false}
        >
          {zoneOuverte && generated && (
            <div className="space-y-3" data-zone-panneau={zoneOuverte}>
              {/* ── LE TEXTE ────────────────────────────────────────────
                  ⚠️ LES CARTES N'ONT PAS UN TEXTE MAIS N : leur contenu se
                  règle à l'étape « Contenu », carte par carte, avec son
                  libellé et sa valeur. Y remettre un champ ici donnerait
                  deux endroits pour la même chose — et deux endroits pour un
                  même réglage finissent toujours par se contredire. */}
              {zoneOuverte !== 'cards' && (
                <div>
                  <label
                    htmlFor={`zone-texte-${zoneOuverte}`}
                    className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1"
                  >
                    {zoneOuverte === 'cta' ? 'Texte principal' : 'Texte'}
                  </label>
                  <textarea
                    id={`zone-texte-${zoneOuverte}`}
                    rows={2}
                    value={
                      zoneOuverte === 'title' ? generated.title
                        : zoneOuverte === 'subtitle' ? generated.subtitle
                          : generated.cta
                    }
                    onChange={(e) => setGenerated((g) => (g ? {
                      ...g,
                      ...(zoneOuverte === 'title' ? { title: e.target.value }
                        : zoneOuverte === 'subtitle' ? { subtitle: e.target.value }
                          : { cta: e.target.value }),
                    } : g))}
                    data-zone-texte={zoneOuverte}
                    style={{ resize: 'vertical' }}
                    className="w-full rounded-lg bg-gray-800 border border-gray-700 focus:border-purple-500 outline-none px-2 py-1.5 text-sm"
                  />
                </div>
              )}
              {/* ── LA PETITE LIGNE DU CTA ────────────────────────────────
                  Le SOUS-TEXTE, pas le filigrane : celui-ci vit a l'etape
                  Style et s'ecrit dans `design.siteText`. Ici, la ligne
                  complementaire peinte juste sous l'appel a l'action.
                  Elle existait dans l'etat et dans la metadata, sans aucun
                  moyen de l'editer : seuls le selecteur de ton et l'assistant
                  pouvaient la changer. */}
              {zoneOuverte === 'cta' && (
                <div>
                  <label
                    htmlFor="zone-soustexte-cta"
                    className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1"
                  >
                    Sous-texte
                  </label>
                  <input
                    id="zone-soustexte-cta"
                    type="text"
                    value={generated.ctaSub}
                    onChange={(e) => setGenerated((g) => (g ? { ...g, ctaSub: e.target.value } : g))}
                    data-zone-soustexte="cta"
                    placeholder="LIEN EN BIO"
                    maxLength={40}
                    className="w-full rounded-lg bg-gray-800 border border-gray-700 focus:border-purple-500 outline-none px-2 py-1.5 text-sm"
                  />
                  <p className="mt-1 text-[11px] text-gray-500">
                    Petite ligne sous l’appel à l’action. Champ vide : rien ne s’affiche.
                  </p>
                </div>
              )}
              {zoneOuverte === 'cards' && (
                <p className="text-[11px] text-gray-500">
                  Le texte des cartes se règle à l’étape
                  {' '}<span className="text-gray-300">Contenu</span>, carte par carte.
                  Ici, leur mise en forme.
                </p>
              )}

              {/* ── LE STYLE ────────────────────────────────────────────
                  La MÊME barre que l'Autopilote, sur les quatre zones. */}
              <TextFormatToolbar
                zone={zoneOuverte}
                valeurs={
                  zoneOuverte === 'cards' ? cardsTypography
                    : zoneOuverte === 'title' ? textStyles.title
                      : zoneOuverte === 'subtitle' ? textStyles.subtitle
                        : textStyles.cta
                }
                defauts={{
                  // Titre et CTA sortent en capitales quand rien n'est
                  // choisi ; le sous-titre et les cartes, non.
                  textCase: zoneOuverte === 'title' || zoneOuverte === 'cta'
                    ? DEFAULT_TEXT_CASE : 'none',
                  align: zoneOuverte === 'cta' ? 'center' : 'left',
                  bold: true,
                  italic: false,
                }}
                // Le sous-titre hérite de la graisse et de l'italique du
                // titre : les proposer promettrait un réglage sans effet.
                showBoldItalic={zoneOuverte !== 'subtitle'}
                onChange={(patch) => {
                  if (zoneOuverte === 'cards') patchCards(patch);
                  else if (zoneOuverte === 'title') setTitleStyle((v) => ({ ...v, ...patch }));
                  else if (zoneOuverte === 'subtitle') setSubtitleStyle((v) => ({ ...v, ...patch }));
                  else setCtaStyle((v) => ({ ...v, ...patch }));
                }}
              />
            </div>
          )}
        </FloatingPanel>

        {/* ── LE BOUTON DU RENDU — TROIS ÉTATS, UN SEUL BOUTON ─────────
            Il y en avait deux, à deux endroits : « Voir le rendu » sous
            l'aperçu, et « Fermer » dans le panneau du bas. Ils disent
            maintenant la même chose au même endroit.

            ⚠️ « REVOIR » NE RECOMPOSE PAS, ET C'EST LE POINT. Le montage est
            déjà payé : quand il existe mais qu'on regarde un autre onglet,
            le bouton se contente de revenir sur « Tout ». Seul
            « Recomposer », explicite, redéclenche un rendu — et donc un
            débit. */}
        {generated && !editPostId && (() => {
          const recomposer = () => { setPreviewRender(null, null); runRender('apercu'); };
          const etat = !previewUrl
            ? { onClick: () => runRender('apercu'), icone: <Play className="w-3.5 h-3.5" />, label: 'Voir le rendu',
                titre: 'Composer la vidéo et la regarder — animations et transitions comprises' }
            : renduJoue
              ? { onClick: recomposer, icone: <RefreshCw className="w-3.5 h-3.5" />, label: 'Recomposer le rendu',
                  titre: 'Refaire le montage avec les réglages actuels — un nouveau rendu est débité' }
              : { onClick: () => setPreviewFocus('all'), icone: <Play className="w-3.5 h-3.5" />, label: 'Revoir le rendu',
                  titre: 'Rejouer le montage déjà composé — aucun nouveau débit' };
          return (
            <button
              type="button"
              onClick={etat.onClick}
              disabled={sending}
              data-play-rendu
              title={etat.titre}
              className="mt-2 w-full flex items-center justify-center gap-2 rounded-lg border border-purple-500/40 bg-purple-600/15 px-3 py-1.5 text-xs text-purple-100 hover:bg-purple-600/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {sending ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Rendu…</>
              ) : (
                <>{etat.icone} {etat.label}</>
              )}
            </button>
          );
        })()}

        {/* ── LÉGENDE DU RENDU ─────────────────────────────────────────
            La mention de facturation était noyée dans le second panneau, à
            côté du bouton « Fermer ». Elle devient une légende COMPACTE sous
            le cadre, et n'apparaît que quand un montage existe réellement —
            sinon elle parlait d'un rendu que personne n'avait demandé. */}
        {previewUrl && (
          <p className="mt-2 text-[11px] text-gray-500" data-play-legende>
            Ce montage sera réutilisé à l’envoi tant que rien ne change —
            un seul rendu débité.
          </p>
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
                {/* La MEME grille que le choix d'icone de carte de
                    l'Autopilote — extraite dans `IconPicker` plutot que
                    recopiee. Deux grilles finissent par se desynchroniser :
                    le depot l'a deja paye avec les deux selecteurs de photos
                    de `/creer`. */}
                <IconPicker onPick={addElement} />
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
        </>
        )}
      </ColonneApercu>
      )}

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
    </DeuxColonnes>
    </div>
  );
}
