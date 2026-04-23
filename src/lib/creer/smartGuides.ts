/**
 * Smart-alignment helpers for the /creer preview.
 *
 * The editor's drag handler feeds in the raw cursor position (as an x%, y%
 * percentage of the preview container) plus the list of positions of the
 * OTHER tracked elements. `snapPosition` returns:
 *
 *   - possibly-adjusted x, y (snapped to the nearest alignment)
 *   - the list of active guide lines (in %) that should be drawn
 *
 * Guide targets:
 *   - Preview center vertical / horizontal (50%)
 *   - The centers of every other tracked element
 *
 * Snap threshold is 1.6% which — on the 400-ish px preview width — is
 * roughly the 5 px the spec asked for. Small enough that fine-tuning is
 * still possible, large enough that snapping feels "sticky".
 */

export type ElementKey =
  | 'title'
  | 'cards'
  | 'watermark'
  | 'overlay'
  | 'logo'
  | 'sitetext'
  | 'character';

export interface ElementPos {
  key: ElementKey;
  /** Center x in 0..100 */
  x: number;
  /** Center y in 0..100 */
  y: number;
  /** Human label used for distance badges */
  label: string;
}

export interface ActiveGuide {
  axis: 'x' | 'y';
  /** Position in 0..100 */
  pos: number;
  /** Where this guide came from (for debugging / future "snapping to X" copy) */
  source: 'preview-center' | 'element-center';
}

export interface SnapResult {
  x: number;
  y: number;
  guides: ActiveGuide[];
}

export const SNAP_THRESHOLD_PERCENT = 1.6;

const SNAP_TARGETS_X = [50]; // preview horizontal center
const SNAP_TARGETS_Y = [50]; // preview vertical center

function findSnap(
  value: number,
  targets: Array<{ pos: number; source: ActiveGuide['source'] }>,
): { value: number; guide?: ActiveGuide } {
  let best: { diff: number; pos: number; source: ActiveGuide['source'] } | null = null;
  for (const target of targets) {
    const diff = Math.abs(value - target.pos);
    if (diff <= SNAP_THRESHOLD_PERCENT && (best === null || diff < best.diff)) {
      best = { diff, pos: target.pos, source: target.source };
    }
  }
  if (!best) return { value };
  return { value: best.pos, guide: { axis: 'x', pos: best.pos, source: best.source } };
}

export function snapPosition(
  x: number,
  y: number,
  others: ElementPos[],
): SnapResult {
  const guides: ActiveGuide[] = [];

  const targetsX = [
    ...SNAP_TARGETS_X.map((pos) => ({ pos, source: 'preview-center' as const })),
    ...others.map((o) => ({ pos: o.x, source: 'element-center' as const })),
  ];
  const targetsY = [
    ...SNAP_TARGETS_Y.map((pos) => ({ pos, source: 'preview-center' as const })),
    ...others.map((o) => ({ pos: o.y, source: 'element-center' as const })),
  ];

  const snapX = findSnap(x, targetsX);
  const snapY = findSnap(y, targetsY);
  if (snapX.guide) guides.push({ ...snapX.guide, axis: 'x' });
  if (snapY.guide) guides.push({ ...snapY.guide, axis: 'y' });

  return { x: snapX.value, y: snapY.value, guides };
}

/**
 * For a dragged element, return the pixel distance to the nearest OTHER
 * element on each axis (just the closest above/below/left/right). The
 * SmartGuides overlay uses these to render the little distance badges.
 */
export interface DistanceBadge {
  axis: 'x' | 'y';
  /** Midpoint of the segment, in % */
  midX: number;
  midY: number;
  /** Distance in preview pixels */
  distancePx: number;
}

export function computeDistanceBadges(
  active: ElementPos,
  others: ElementPos[],
  previewWidthPx: number,
  previewHeightPx: number,
): DistanceBadge[] {
  const out: DistanceBadge[] = [];

  // Nearest element above + below, left + right of the active one.
  const above = others
    .filter((o) => o.y < active.y)
    .sort((a, b) => b.y - a.y)[0];
  const below = others
    .filter((o) => o.y > active.y)
    .sort((a, b) => a.y - b.y)[0];
  const left = others
    .filter((o) => o.x < active.x)
    .sort((a, b) => b.x - a.x)[0];
  const right = others
    .filter((o) => o.x > active.x)
    .sort((a, b) => a.x - b.x)[0];

  const pushBadge = (partner: ElementPos | undefined, axis: 'x' | 'y') => {
    if (!partner) return;
    if (axis === 'y') {
      const deltaPct = Math.abs(active.y - partner.y);
      out.push({
        axis,
        midX: active.x,
        midY: (active.y + partner.y) / 2,
        distancePx: Math.round((deltaPct / 100) * previewHeightPx),
      });
    } else {
      const deltaPct = Math.abs(active.x - partner.x);
      out.push({
        axis,
        midX: (active.x + partner.x) / 2,
        midY: active.y,
        distancePx: Math.round((deltaPct / 100) * previewWidthPx),
      });
    }
  };

  pushBadge(above, 'y');
  pushBadge(below, 'y');
  pushBadge(left, 'x');
  pushBadge(right, 'x');
  return out;
}
