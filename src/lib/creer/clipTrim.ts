/**
 * Rognage manuel d'une séquence détectée.
 *
 * Fonctions PURES : la modale ne fait que les appliquer. Les bornes décident
 * de ce qui part réellement à l'extraction, et une borne fausse ne se voit
 * qu'après avoir attendu un rendu en temps réel — d'où l'intérêt de les
 * vérifier sur des valeurs.
 */

export interface Bounds {
  start: number;
  end: number;
}

/** En deçà, la séquence ne montre rien d'exploitable. */
export const MIN_CLIP_SECONDS = 0.5;

/**
 * Au-delà, ce n'est plus un temps fort.
 *
 * L'extraction se fait en TEMPS RÉEL : une séquence de deux minutes
 * immobiliserait l'onglet aussi longtemps, et le budget de la modale
 * (`durée × 3 + 30 s`) exploserait.
 */
export const MAX_CLIP_SECONDS = 60;

/** Écart minimal entre les deux poignées, pour qu'elles restent saisissables. */
const EPSILON = 0.05;

function fini(n: unknown, repli: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : repli;
}

/**
 * Borne un couple début/fin dans la source.
 *
 * `moved` dit QUELLE poignée l'utilisateur tire : c'est l'autre qui cède
 * quand la durée minimale est atteinte. Sans cette information, tirer la fin
 * vers la gauche repousserait le début, et la séquence glisserait au lieu de
 * se raccourcir.
 */
export function clampBounds(
  bounds: Partial<Bounds>,
  sourceDuration: number,
  moved: 'start' | 'end' = 'end',
): Bounds {
  const total = Math.max(MIN_CLIP_SECONDS, fini(sourceDuration, MIN_CLIP_SECONDS));
  let start = Math.min(Math.max(0, fini(bounds.start, 0)), total);
  let end = Math.min(Math.max(0, fini(bounds.end, total)), total);

  // Poignées croisées : on rétablit l'ordre avant tout le reste.
  if (end < start) {
    if (moved === 'end') end = start;
    else start = end;
  }

  if (end - start < MIN_CLIP_SECONDS) {
    if (moved === 'end') {
      end = Math.min(total, start + MIN_CLIP_SECONDS);
      // La source est trop courte pour la durée minimale : on recule le début.
      if (end - start < MIN_CLIP_SECONDS) start = Math.max(0, end - MIN_CLIP_SECONDS);
    } else {
      start = Math.max(0, end - MIN_CLIP_SECONDS);
      if (end - start < MIN_CLIP_SECONDS) end = Math.min(total, start + MIN_CLIP_SECONDS);
    }
  }

  if (end - start > MAX_CLIP_SECONDS) {
    // On rogne du côté qui NE bouge PAS : la poignée que l'utilisateur tient
    // doit suivre son curseur, sinon le geste semble bloqué.
    if (moved === 'end') start = end - MAX_CLIP_SECONDS;
    else end = start + MAX_CLIP_SECONDS;
  }

  return { start: arrondi(start), end: arrondi(Math.max(start + EPSILON, end)) };
}

/** Deux décimales : le seek d'un `<video>` ne vaut pas mieux. */
function arrondi(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Bornes effectives d'une séquence : celles que l'utilisateur a réglées, ou
 * celles détectées.
 *
 * ABSENCE = DÉTECTION. C'est ce qui garde le comportement d'hier pour qui ne
 * touche à rien.
 */
export function effectiveBounds(
  auto: { startTime: number; endTime: number },
  trim: Bounds | undefined | null,
): Bounds {
  if (!trim) return { start: auto.startTime, end: auto.endTime };
  return trim;
}

/** La séquence a-t-elle été retouchée ? Sert à le signaler à l'écran. */
export function isTrimmed(
  auto: { startTime: number; endTime: number },
  trim: Bounds | undefined | null,
): boolean {
  if (!trim) return false;
  return Math.abs(trim.start - auto.startTime) > 0.01
    || Math.abs(trim.end - auto.endTime) > 0.01;
}

/** Position d'un instant sur la timeline, en fraction de 0 à 1. */
export function timeToRatio(time: number, sourceDuration: number): number {
  const total = fini(sourceDuration, 0);
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, fini(time, 0) / total));
}

/** Instant visé par un pointeur sur la timeline. */
export function ratioToTime(
  clientX: number,
  rect: { left: number; width: number },
  sourceDuration: number,
): number {
  if (!rect.width || !Number.isFinite(clientX)) return 0;
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return arrondi(ratio * Math.max(0, fini(sourceDuration, 0)));
}

/** Timecode `M:SS`, jamais négatif ni `NaN`. */
export function timecode(seconds: number): string {
  const total = Math.max(0, Math.floor(fini(seconds, 0)));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Étiquette complète : « 0:00 → 0:02 · 2,6 s ». */
export function boundsLabel(bounds: Bounds): string {
  const duree = Math.max(0, bounds.end - bounds.start);
  return `${timecode(bounds.start)} → ${timecode(bounds.end)} · ${duree.toFixed(1).replace('.', ',')} s`;
}
