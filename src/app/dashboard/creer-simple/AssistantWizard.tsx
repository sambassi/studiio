'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
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
} from 'lucide-react';
import { generateSmartContent } from '@/lib/smart-content';
import { composeAndUpload, CURRENT_COMPOSER_VERSION } from '@/lib/video-composer';
import { AudioStudioPanel } from '@/components/creer/AudioStudioPanel';
import { MediaLibrary } from '@/components/shared/MediaLibrary';
import ClipDetectorModal, { type ClipSource } from '@/components/media/ClipDetectorModal';
import { CardIcon } from '@/components/ui/CardIcon';
import ColorWheel from '@/components/ui/ColorWheel';
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
 * `180° − atan(w/h)`. En 9:16 → 150,64° ; en 16:9 → 119,36°.
 */
function backdropAngle(format: Format): number {
  const [w, h] = format === '9:16' ? [1080, 1920] : [1920, 1080];
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
 * Filigrane : metriques du compositeur, en fraction de la largeur video.
 * `linkFontSize = width * 0.0375 * size`, `y = 95 %`, centre, graisse 700,
 * opacite 0.85 (video-composer.ts, calque siteText).
 */
const WATERMARK = { fontRatio: 0.0375, y: 95, opacity: 0.85, color: '#FFFFFF' } as const;

/** Style de cartes utilisé partout : aperçu, compositeur, metadata. */
const CARD_STYLE = 'Compact';

/** Coût du rendu, aligné sur l'éditeur (RENDER_COSTS). */
const COST = { reel: 10, tv: 15 } as const;

type Format = '9:16' | '16:9';

interface GeneratedCard {
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
}: {
  /** Filigrane affiche sur toutes les sequences, ou chaine vide si masque. */
  watermark?: string;
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
  const showRush = !!rushUrl && !rushBroken && activeOrder.includes('video');

  return (
    <div className="card-base p-4">
      <div className="flex items-center gap-2 mb-3">
        <MonitorPlay className="w-4 h-4 text-gray-500" />
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Aperçu
        </span>
      </div>

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
          aspectRatio: format === '9:16' ? '9 / 16' : '16 / 9',
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
            {activeOrder.includes('intro') && (
            /* Titre — ancre au bord GAUCHE (x) et au bord HAUT (y), comme
                drawIntro avec titleAlign:'left' et textBaseline:'top'.
                Graisse 900 et ombre : le compositeur les applique en dur. */
            <div
              style={{
                position: 'absolute',
                left: `${DESIGN.titlePos.x}%`,
                top: `${DESIGN.titlePos.y}%`,
                width: `${DESIGN.titleWidth}%`,
                textAlign: 'left',
              }}
            >
              <div
                className="uppercase"
                style={{
                  fontSize: vw * FONT_RATIO[format].title,
                  fontWeight: 900,
                  color: DESIGN.titleColor,
                  lineHeight: 1.1,
                  filter: titleShadow(vw),
                }}
              >
                {generated.title}
              </div>
              <div
                style={{
                  fontSize: vw * FONT_RATIO[format].subtitle,
                  fontWeight: 900,
                  // drawIntro dessine le sous-titre en titleColor a 80 %
                  color: `${DESIGN.titleColor}CC`,
                  lineHeight: 1.1,
                  marginTop: vw * GAP_RATIO,
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
              {(activeOrder.includes('cards') ? generated.cards : []).map((c, i) => (
                <div
                  key={i}
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

            {activeOrder.includes('cta') && (
            /* CTA — ancre par le BAS a ctaPos.y, centre horizontalement :
                drawCTA fait `curY = ctaPosY - blockH`, donc y designe le bas
                du bloc. Graisse 900 en dur cote compositeur. */
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: `${DESIGN.ctaPos.y}%`,
                transform: 'translate(-50%, -100%)',
                width: `${DESIGN.ctaWidth}%`,
                textAlign: 'center',
              }}
            >
              <div
                className="uppercase"
                style={{
                  fontSize: vw * FONT_RATIO[format].cta,
                  fontWeight: 900,
                  color: DESIGN.ctaColor,
                  lineHeight: 1.2,
                  textShadow: `0 0 ${vw * 0.02}px ${DESIGN.ctaColor}66`,
                }}
              >
                {generated.cta}
              </div>
              <div
                className="uppercase"
                style={{
                  fontSize: vw * FONT_RATIO[format].ctaSub,
                  fontWeight: 900,
                  color: gradEnd,
                  lineHeight: 1.2,
                  marginTop: vw * GAP_RATIO,
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
                  top: `${WATERMARK.y}%`,
                  transform: 'translateY(-50%)',
                  textAlign: 'center',
                  fontSize: vw * WATERMARK.fontRatio,
                  fontWeight: 700,
                  color: WATERMARK.color,
                  opacity: WATERMARK.opacity,
                  textShadow: '0 0 8px rgba(0,0,0,0.85)',
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

  /**
   * Filigrane. Meme raisonnement que les couleurs pour la surcharge nulle :
   * `branding.watermarkText` arrive apres le premier rendu.
   */
  const [watermarkOverride, setWatermarkOverride] = useState<string | null>(null);
  const [watermarkEnabled, setWatermarkEnabled] = useState(true);
  const watermarkText = watermarkOverride ?? (branding.watermarkText || DEFAULT_WATERMARK);
  /** Ce qui est reellement peint : chaine vide si masque ou vide. */
  const watermarkLabel = watermarkEnabled ? watermarkText.trim() : '';

  const [started, setStarted] = useState(false);
  const [step, setStep] = useState(0);

  const [themeId, setThemeId] = useState(THEMES[0].id);
  const [customTopic, setCustomTopic] = useState('');
  const [toneId, setToneId] = useState(TONES[0].id);
  const [format, setFormat] = useState<Format>('9:16');
  const [sequences, setSequences] = useState(DEFAULT_SEQUENCES);
  const [dragKey, setDragKey] = useState<SeqKey | null>(null);

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

  const genTimerRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    return () => {
      if (genTimerRef.current) clearTimeout(genTimerRef.current);
    };
  }, []);

  // Date du jour posée après le montage : la calculer pendant le rendu
  // provoquerait un écart d'hydratation entre serveur et navigateur.
  useEffect(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    setScheduledDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }, []);

  /** Ordre effectif : sequences activees, dans l'ordre choisi. */
  const activeOrder = sequences.filter((s) => s.enabled).map((s) => s.key);

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
        const result = generateSmartContent(topicText, seed);
        setGenerated({
          title: result.tagLine,
          subtitle: result.subtitle,
          cards: result.cards.slice(0, 5),
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

  const goToGeneration = () => {
    setStep(S.contenu);
    runGeneration();
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
    // 9:16 = reel, 16:9 = tv. Même convention que l'éditeur (creer/page.tsx).
    // Inverser ces deux valeurs fait recadrer la vidéo par le Calendrier, qui
    // choisit son conteneur d'après `post.format`.
    const renderFormat: 'reel' | 'tv' = isReel ? 'reel' : 'tv';
    const cost = isReel ? COST.reel : COST.tv;

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
      try {
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
        width: isReel ? 1080 : 1920,
        height: isReel ? 1920 : 1080,
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
        siteText: {
          text: watermarkLabel || DEFAULT_WATERMARK,
          enabled: !!watermarkLabel,
          color: WATERMARK.color,
          opacity: WATERMARK.opacity,
          size: 1,
          pos: { x: 50, y: WATERMARK.y },
        },
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
          titleFont: DESIGN.font,
          titlePosition: { x: DESIGN.titlePos.x, y: DESIGN.titlePos.y },
          titleSize: DESIGN.titleWidth,
          titleColor: DESIGN.titleColor,

          // ── CTA : bas-centre ──────────────────────────────────────────
          // `ctaMainText` est lu EN PREMIER par drawCTA ; `ctaSubTextDesign`
          // est le nom du champ cote design pour le sous-texte.
          ctaMainText: generated.cta,
          ctaSubTextDesign: generated.ctaSub,
          watermarkPosition: { x: DESIGN.ctaPos.x, y: DESIGN.ctaPos.y },
          watermarkSize: DESIGN.ctaWidth,
          ctaColor: DESIGN.ctaColor,
          ctaSubColor: gradEnd,

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
          titleColor: DESIGN.titleColor,
          ctaColor: DESIGN.ctaColor,
          ctaSubColor: gradEnd,
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
          siteText: {
            text: watermarkLabel || DEFAULT_WATERMARK,
            enabled: !!watermarkLabel,
            color: WATERMARK.color,
            opacity: WATERMARK.opacity,
            size: 1,
            pos: { x: 50, y: WATERMARK.y },
          },
          // Le Calendrier lit les positions sous `positions.*` (imbrique),
          // la ou le compositeur attend des cles a plat. On ecrit la forme
          // du Calendrier ici pour que sa reconstruction HTML de secours
          // place le titre et le CTA au meme endroit que la video.
          positions: {
            title: { x: DESIGN.titlePos.x, y: DESIGN.titlePos.y },
            watermark: { x: DESIGN.ctaPos.x, y: DESIGN.ctaPos.y },
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
                  <Button variant="primary" size="sm" onClick={() => setStep(S.style)}>
                    <span className="flex items-center gap-2">
                      Continuer <ArrowRight className="w-4 h-4" />
                    </span>
                  </Button>
                </div>
              </div>
            )}

            {/* Étape 2 — ton + format */}
            {step === S.style && (
              <div className="space-y-5">
                <div>
                  <h3 className="font-semibold mb-1">Quel style ?</h3>
                  <p className="text-sm text-gray-400">
                    Le ton oriente l&apos;appel à l&apos;action et la variante de contenu retenue.
                  </p>
                </div>

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
                    {(['9:16', '16:9'] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => setFormat(f)}
                        className={`flex-1 rounded-xl px-3 py-2.5 text-sm transition ${
                          format === f
                            ? 'bg-purple-600/20 text-purple-200 ring-1 ring-purple-500/50'
                            : 'bg-gray-900 text-gray-400 hover:text-white'
                        }`}
                      >
                        {f}
                        <span className="block text-[10px] text-gray-500">
                          {f === '9:16' ? 'Reel / Short' : 'Paysage'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Couleurs — accent + degrade de fond. Elles alimentent d'un
                    seul tenant l'apercu, le compositeur et les metadonnees :
                    ce sont les memes variables partout, la surcharge se pose
                    en amont. Tant qu'on n'y touche pas, le kit de marque
                    (Reglages -> Branding) fait foi. */}
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

                {/* Filigrane — repris du kit de marque, sinon « Studiio.pro ».
                    Sans ce reglage le compositeur ecrivait « Afroboost.com »
                    sur chaque sequence, sans moyen de l'enlever. */}
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
                      {watermarkEnabled ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      {watermarkEnabled ? 'Affiché' : 'Masqué'}
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
                  </p>
                </div>

                {/* Sequences — reordonnables par glisser-deposer.
                    L'ordre choisi part a la fois au compositeur
                    (`sequenceOrder`) et dans `metadata.sequences.order`, donc
                    la video et l'apercu du Calendrier le suivent tous deux. */}
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
                      {(activeOrder.includes('cards') ? generated.cards : []).map((c, i) => (
                        <div
                          key={i}
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

      <div className="lg:col-span-2">
        <Preview
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
