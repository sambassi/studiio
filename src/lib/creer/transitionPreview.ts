import type { CSSProperties } from 'react';
import type { TransitionStyle } from '@/lib/video-composer';

/**
 * Les transitions du montage, traduites en CSS pour l'aperçu de l'éditeur.
 *
 * ⚠️ C'EST `drawTransition` (video-composer.ts) QUI FAIT FOI, PAS CE FICHIER.
 *
 * Trois moteurs jouent désormais les mêmes transitions : le canvas
 * (référence), Remotion (`remotion/transitions.tsx`) et cet aperçu. Ce module
 * ne DÉCIDE rien : il recopie les courbes et les constantes du compositeur,
 * et un test le compare aux exports Remotion pour que les trois ne puissent
 * pas diverger en silence.
 *
 * ⚠️ FEUILLE SANS DÉPENDANCE. Importer une VALEUR de `video-composer` ferait
 * entrer ses 5 000 lignes dans chaque écran qui montre une vignette ; importer
 * `remotion/transitions.tsx` tirerait `remotion` dans le bundle navigateur.
 * Le type seul est importé — il est effacé à la compilation.
 */

/** Durée de la fenêtre de transition, en secondes — `transitionDur` du compositeur. */
export const TRANSITION_DURATION_SECONDS = 0.8;

/**
 * Part de la progression de transition à laquelle la séquence ENTRANTE est
 * dessinée pendant le raccord — `drawB(t * 0.3, …)` du compositeur. Son
 * animation de texte commence donc pendant la transition, puis repart de zéro
 * quand la séquence prend la main. L'aperçu montre ce que le canvas produit.
 */
export const ENTERING_PROGRESS_RATIO = 0.3;

/** Accélère puis ralentit — `easeInOut` du compositeur. */
export function easeInOut(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2;
}

/** Même forme, en cubique — `easeInOutCubic` du compositeur. */
export function easeInOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

/** Nulle aux deux extrémités, maximale au milieu — `bellCurve` du compositeur. */
export function bellCurve(t: number): number {
  return Math.sin(Math.PI * Math.max(0, Math.min(1, t)));
}

/** Flou maximal de `blur-dissolve`, pour une largeur de référence de 1080 px. */
export const BLUR_DISSOLVE_MAX_PX = 16;
/** Flou maximal du filé de `whip-pan`, même référence. */
export const WHIP_PAN_MAX_BLUR_PX = 26;
/** Sur-échelle d'un calque flouté : repousse hors cadre le liseré translucide. */
export const BLUR_MAX_OVERSCALE = 1.06;
/** Amplitude du zoom, dans les deux sens — `0.18` du compositeur. */
export const ZOOM_AMPLITUDE = 0.18;

/** Styles connus — un style absent d'ici retombe sur le fondu, comme le canvas. */
const STYLES_CONNUS: ReadonlySet<string> = new Set<TransitionStyle>([
  'crossfade', 'slide', 'wipe', 'zoom', 'fade-to-black',
  'push', 'iris', 'blur-dissolve', 'whip-pan',
]);

export interface TransitionLayerStyles {
  /** Calque de la séquence SORTANTE (A), dessiné en dessous. */
  a: CSSProperties;
  /** Calque de la séquence ENTRANTE (B), dessiné par-dessus. */
  b: CSSProperties;
  /** Un fond noir doit être peint SOUS les deux calques (`fade-to-black`). */
  black: boolean;
}

/**
 * Cadre dans lequel la transition se joue.
 *
 * `w` × `h` : la résolution VIDÉO (1080 × 1920…), celle dont le compositeur
 * déduit le flou. `scale` : le facteur de réduction à l'écran (largeur
 * affichée / `w`), pour convertir ce flou en pixels d'écran — un calque posé
 * dans un cadre de 400 px n'a pas à recevoir 16 px de flou vidéo. Défaut 1 :
 * le calque est à la résolution vidéo.
 */
export interface TransitionFrame {
  w: number;
  h: number;
  scale?: number;
}

/** Style commun aux deux calques floutés : flou, sur-échelle, décalage. */
function styleFloute(
  frame: TransitionFrame, tBrut: number, flouMaxPx: number, decalagePct: number, opacite: number,
): CSSProperties {
  const cloche = bellCurve(tBrut);
  // Le flou est MIS À L'ÉCHELLE de la largeur, comme le canvas : 16 px
  // absolus ne pèsent pas le même poids en 1080 et en 1920 de large. Puis
  // ramené aux pixels d'écran du calque.
  const flou = flouMaxPx * (frame.w / 1080) * cloche * (frame.scale ?? 1);
  const surEchelle = 1 + (BLUR_MAX_OVERSCALE - 1) * cloche;
  return {
    opacity: opacite,
    filter: flou > 0.1 ? `blur(${flou.toFixed(1)}px)` : undefined,
    transform: `translateX(${decalagePct}%) scale(${surEchelle})`,
  };
}

/**
 * Ce que chaque calque doit recevoir à l'instant `t` (0 → 1) de la transition.
 *
 * Chaque branche cite le `case` de `drawTransition` qu'elle transcrit. Les
 * translations et découpes sont en POURCENTAGE du calque — le calque couvrant
 * le cadre, `-100 %` dit exactement `-w`, quel que soit le format et
 * l'échelle d'affichage.
 */
export function transitionLayerStyles(
  style: TransitionStyle | string | undefined,
  t: number,
  frame: TransitionFrame,
): TransitionLayerStyles {
  const p = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const e = easeInOut(p);
  const s = style && STYLES_CONNUS.has(style) ? (style as TransitionStyle) : 'crossfade';

  switch (s) {
    case 'slide':
      // Translation pure des deux calques (case 'slide').
      return { a: { transform: `translateX(${-100 * e}%)` }, b: { transform: `translateX(${100 * (1 - e)}%)` }, black: false };

    case 'wipe':
      // A reste en place, B révélée par un volet qui s'élargit (case 'wipe').
      return { a: {}, b: { clipPath: `inset(0 ${100 * (1 - e)}% 0 0)` }, black: false };

    case 'zoom': {
      // Échelles uniformes, jamais d'étirement ; B entre en zoom AVANT
      // (facteur toujours ≥ 1) — case 'zoom'.
      const scaleA = 1 + ZOOM_AMPLITUDE * e;
      const scaleB = 1 + ZOOM_AMPLITUDE * (1 - e);
      return {
        a: { opacity: 1 - e, transform: `scale(${scaleA})` },
        b: { opacity: e, transform: `scale(${scaleB})` },
        black: false,
      };
    }

    case 'fade-to-black':
      // Première moitié : A s'éteint. Seconde : B s'allume. Le noir est
      // peint en dessous (case 'fade-to-black').
      return {
        a: { opacity: p < 0.5 ? 1 - p / 0.5 : 0 },
        b: { opacity: p < 0.5 ? 0 : (p - 0.5) / 0.5 },
        black: true,
      };

    case 'push':
      // Pendant VERTICAL de `slide` (case 'push').
      return { a: { transform: `translateY(${-100 * e}%)` }, b: { transform: `translateY(${100 * (1 - e)}%)` }, black: false };

    case 'iris':
      // Ouverture circulaire dont le rayon final couvre les coins — la
      // demi-diagonale, `hypot(w, h) / 2` (case 'iris'). En CSS, un rayon de
      // `circle()` en % se rapporte à `hypot(w, h) / √2` : la demi-diagonale
      // vaut donc `100 / √2` ≈ 70,71 %, dans tous les formats.
      return { a: {}, b: { clipPath: `circle(${((100 / Math.SQRT2) * e).toFixed(2)}% at 50% 50%)` }, black: false };

    case 'blur-dissolve':
      // Fondu enchaîné dont le flou monte puis redescend (case 'blur-dissolve').
      return {
        a: styleFloute(frame, p, BLUR_DISSOLVE_MAX_PX, 0, 1 - e),
        b: styleFloute(frame, p, BLUR_DISSOLVE_MAX_PX, 0, e),
        black: false,
      };

    case 'whip-pan': {
      // Balayage fulgurant et filé ; les deux calques restent OPAQUES
      // (case 'whip-pan').
      const eWhip = easeInOutCubic(p);
      return {
        a: styleFloute(frame, p, WHIP_PAN_MAX_BLUR_PX, -100 * eWhip, 1),
        b: styleFloute(frame, p, WHIP_PAN_MAX_BLUR_PX, 100 * (1 - eWhip), 1),
        black: false,
      };
    }

    case 'crossfade':
    default:
      // L'ancien code, mot pour mot : alphas linéaires.
      return { a: { opacity: 1 - p }, b: { opacity: p }, black: false };
  }
}

// ── Horloge des séquences ──────────────────────────────────────────────────

export interface SequenceStep {
  key: string;
  seconds: number;
}

export interface SequenceClock {
  /** Séquence en cours. */
  index: number;
  /** Avancement de la séquence en cours, de 0 à 1. */
  progress: number;
  /** La fenêtre de transition vers la suivante est-elle ouverte ? */
  inTransition: boolean;
  /** Séquence entrante pendant la fenêtre, sinon `null`. */
  nextIndex: number | null;
  /** Avancement de la transition, de 0 à 1 (0 hors fenêtre). */
  transitionProgress: number;
  /** Le montage est-il terminé (`t` ≥ durée totale) ? */
  ended: boolean;
}

/** Durée totale d'un montage. */
export function totalSeconds(steps: readonly SequenceStep[]): number {
  return steps.reduce((s, st) => s + Math.max(0, st.seconds), 0);
}

/**
 * Où en est le montage à l'instant `t`.
 *
 * La MÊME règle que `drawFrame` du compositeur : la transition occupe les
 * `TRANSITION_DURATION_SECONDS` dernières secondes de la séquence SORTANTE
 * (`seqElapsed > seq.duration - transitionDur`), et il n'y en a pas après la
 * dernière. La durée totale ne change donc pas.
 */
export function sequenceClock(steps: readonly SequenceStep[], t: number): SequenceClock {
  const n = steps.length;
  if (n === 0) {
    return { index: 0, progress: 1, inTransition: false, nextIndex: null, transitionProgress: 0, ended: true };
  }
  const total = totalSeconds(steps);
  const time = Number.isFinite(t) ? Math.max(0, t) : 0;
  if (time >= total) {
    return { index: n - 1, progress: 1, inTransition: false, nextIndex: null, transitionProgress: 0, ended: true };
  }

  const starts: number[] = [];
  let cum = 0;
  for (const st of steps) { starts.push(cum); cum += Math.max(0, st.seconds); }

  let index = 0;
  for (let i = n - 1; i >= 0; i--) { if (time >= starts[i]) { index = i; break; } }
  const duration = Math.max(0, steps[index].seconds);
  const elapsed = time - starts[index];
  const progress = duration > 0 ? Math.min(1, elapsed / duration) : 1;
  const inTransition = index < n - 1 && elapsed > duration - TRANSITION_DURATION_SECONDS;
  const transitionProgress = inTransition
    ? Math.max(0, Math.min(1, (elapsed - (duration - TRANSITION_DURATION_SECONDS)) / TRANSITION_DURATION_SECONDS))
    : 0;
  return {
    index,
    progress,
    inTransition,
    nextIndex: inTransition ? index + 1 : null,
    transitionProgress,
    ended: false,
  };
}

// ── Extraits ───────────────────────────────────────────────────────────────

/**
 * Secondes de la séquence SORTANTE jouées avant la fenêtre de transition :
 * on voit d'où l'on part, sans rejouer toute la séquence.
 */
export const EXTRACT_LEAD_SECONDS = 1;
/** Secondes de la séquence ENTRANTE jouées après la fenêtre : on voit où l'on arrive. */
export const EXTRACT_TAIL_SECONDS = 0.6;

/** Un extrait du montage, en secondes du montage (l'horloge de `sequenceClock`). */
export interface PlaybackExtract {
  from: number;
  to: number;
  /**
   * L'instant qui REPRÉSENTE l'effet, pour l'image figée quand l'utilisateur
   * a demandé à réduire les animations : le milieu de la fenêtre.
   */
  still: number;
  /** Séquence sortante (transition) ou séquence jouée (animation). */
  sequence: string;
  /** Séquence entrante — transition seulement. */
  next?: string;
}

/** Les séquences que le lecteur joue — la même règle que `SequencePlayback`. */
function jouables(steps: readonly SequenceStep[]): SequenceStep[] {
  return steps.filter((s) => s.seconds > 0);
}

/** Début de chaque séquence jouable, en secondes. */
function debuts(steps: readonly SequenceStep[]): number[] {
  const out: number[] = [];
  let cum = 0;
  for (const st of steps) { out.push(cum); cum += st.seconds; }
  return out;
}

/**
 * L'extrait qui montre la transition APRÈS la séquence `key`.
 *
 * La fenêtre est celle de `sequenceClock` — donc de `drawFrame` : les
 * `TRANSITION_DURATION_SECONDS` dernières secondes de la séquence sortante.
 * L'extrait la précède d'`EXTRACT_LEAD_SECONDS` et la suit
 * d'`EXTRACT_TAIL_SECONDS`, bornés au montage.
 *
 * `key` absente, inconnue ou DERNIÈRE (rien après elle) : la première paire
 * du montage. Moins de deux séquences jouables : `null`, il n'y a pas de
 * transition à montrer.
 */
export function transitionExtract(
  steps: readonly SequenceStep[],
  key: string | null | undefined,
): PlaybackExtract | null {
  const seqs = jouables(steps);
  if (seqs.length < 2) return null;
  let index = key ? seqs.findIndex((s) => s.key === key) : -1;
  if (index < 0 || index >= seqs.length - 1) index = 0;
  const starts = debuts(seqs);
  const total = totalSeconds(seqs);
  const fin = starts[index] + seqs[index].seconds;
  const ouverture = Math.max(starts[index], fin - TRANSITION_DURATION_SECONDS);
  return {
    from: Math.max(starts[index], ouverture - EXTRACT_LEAD_SECONDS),
    to: Math.min(total, fin + EXTRACT_TAIL_SECONDS),
    still: (ouverture + fin) / 2,
    sequence: seqs[index].key,
    next: seqs[index + 1].key,
  };
}

/**
 * L'extrait qui montre l'animation du texte au DÉBUT de la séquence `key`.
 *
 * L'animation occupe la part `window` de la séquence (`INTRO_WINDOW` du
 * compositeur) ; l'extrait la couvre puis tient `EXTRACT_TAIL_SECONDS` sur le
 * texte entier, sans dépasser la séquence. `key` absente ou inconnue : la
 * première séquence. Aucune séquence jouable : `null`.
 */
export function textAnimationExtract(
  steps: readonly SequenceStep[],
  key: string | null | undefined,
  window: number,
): PlaybackExtract | null {
  const seqs = jouables(steps);
  if (seqs.length === 0) return null;
  let index = key ? seqs.findIndex((s) => s.key === key) : -1;
  if (index < 0) index = 0;
  const starts = debuts(seqs);
  const debut = starts[index];
  const duree = seqs[index].seconds;
  const w = Number.isFinite(window) && window > 0 && window <= 1 ? window : 1;
  const finFenetre = debut + duree * w;
  return {
    from: debut,
    to: Math.min(debut + duree, finFenetre + EXTRACT_TAIL_SECONDS),
    still: debut + (duree * w) / 2,
    sequence: seqs[index].key,
  };
}
