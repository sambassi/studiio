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
 *
 * ⚠️ UNE SEULE UNITE FAIT AUTORITE : le **pixel du format d'export**
 * (1080 × 1920 en 9:16, 1920 × 1080 en 16:9). Mesurer en pixels d'ECRAN
 * donnait un chiffre qui changeait avec la taille de la fenetre : « 64 px »
 * sur un grand ecran et « 31 px » sur un petit, pour le MEME montage. Les
 * positions restent en % du cadre — sans unite, donc valables pour les deux
 * formats — et ne sont converties qu'a l'affichage du badge.
 */

export type ElementKey =
  | 'title'
  | 'cards'
  | 'watermark'
  | 'overlay'
  | 'logo'
  | 'sitetext'
  | 'character'
  // Ajoutes par le Mode simple. L'union s'elargit, elle ne se restreint
  // jamais : l'editeur avance ne voit aucune difference.
  | 'cta'
  | 'element'
  | 'card';

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
  source: 'preview-center' | 'element-center' | 'preview-thirds' | 'equal-gap';
}

export interface SnapResult {
  x: number;
  y: number;
  guides: ActiveGuide[];
}

export const SNAP_THRESHOLD_PERCENT = 1.6;

const SNAP_TARGETS_X = [50]; // preview horizontal center
const SNAP_TARGETS_Y = [50]; // preview vertical center

/** Regle des tiers — 33,33 % et 66,67 % du cadre, sur les deux axes. */
export const THIRDS_PERCENT = [100 / 3, 200 / 3];

function findSnap(
  value: number,
  targets: Array<{ pos: number; source: ActiveGuide['source'] }>,
  axis: 'x' | 'y',
): { value: number; guide?: ActiveGuide } {
  let best: { diff: number; pos: number; source: ActiveGuide['source'] } | null = null;
  for (const target of targets) {
    if (!Number.isFinite(target.pos)) continue;
    const diff = Math.abs(value - target.pos);
    if (diff <= SNAP_THRESHOLD_PERCENT && (best === null || diff < best.diff)) {
      best = { diff, pos: target.pos, source: target.source };
    }
  }
  if (!best) return { value };
  return { value: best.pos, guide: { axis, pos: best.pos, source: best.source } };
}

/**
 * Reglages facultatifs de l'aimantation.
 *
 * Tous par defaut inertes : un appelant qui ne les passe pas obtient
 * EXACTEMENT le comportement d'avant (centre du cadre + centres des autres
 * elements). C'est ce qui permet d'etendre l'aimantation sans toucher aux
 * appelants existants.
 */
export interface SnapOptions {
  /** Ajoute les tiers (33,33 % / 66,67 %) aux cibles des deux axes. */
  thirds?: boolean;
  /**
   * Boites des AUTRES elements — active l'aimantation sur ECARTS EGAUX :
   * le milieu de chaque espace libre entre deux bords devient une cible.
   * Ce milieu ne depend pas de la taille de l'element deplace, ce qui rend
   * la cible identique quel que soit ce qu'on deplace.
   */
  boxes?: ElementBox[];
  /**
   * Ecart entre la position TRANSMISE (l'ancre) et le centre geometrique de
   * l'element deplace, en % du cadre. Les cibles « ecart egal » visent un
   * CENTRE ; sans cette correction on centrerait l'ancre — donc le bord
   * gauche d'un titre ancre en haut-gauche.
   */
  anchorOffset?: { x: number; y: number };
}

export function snapPosition(
  x: number,
  y: number,
  others: ElementPos[],
  options: SnapOptions = {},
): SnapResult {
  const guides: ActiveGuide[] = [];
  const offX = Number.isFinite(options.anchorOffset?.x) ? options.anchorOffset!.x : 0;
  const offY = Number.isFinite(options.anchorOffset?.y) ? options.anchorOffset!.y : 0;
  const boxes = options.boxes ?? [];

  const targetsX = [
    ...SNAP_TARGETS_X.map((pos) => ({ pos, source: 'preview-center' as const })),
    ...(options.thirds ? THIRDS_PERCENT.map((pos) => ({ pos, source: 'preview-thirds' as const })) : []),
    ...others.map((o) => ({ pos: o.x, source: 'element-center' as const })),
    ...equalGapCenters(boxes.map((b) => [b.left, b.right] as [number, number]))
      .map((pos) => ({ pos: pos - offX, source: 'equal-gap' as const })),
  ];
  const targetsY = [
    ...SNAP_TARGETS_Y.map((pos) => ({ pos, source: 'preview-center' as const })),
    ...(options.thirds ? THIRDS_PERCENT.map((pos) => ({ pos, source: 'preview-thirds' as const })) : []),
    ...others.map((o) => ({ pos: o.y, source: 'element-center' as const })),
    ...equalGapCenters(boxes.map((b) => [b.top, b.bottom] as [number, number]))
      .map((pos) => ({ pos: pos - offY, source: 'equal-gap' as const })),
  ];

  const snapX = findSnap(x, targetsX, 'x');
  const snapY = findSnap(y, targetsY, 'y');
  if (snapX.guide) guides.push(snapX.guide);
  if (snapY.guide) guides.push(snapY.guide);

  return { x: snapX.value, y: snapY.value, guides };
}

/**
 * Milieux des espaces libres, sur un axe.
 *
 * Chaque intervalle est l'emprise d'un element ; les bords du cadre y sont
 * ajoutes comme intervalles de largeur nulle (0 et 100). Poser le CENTRE de
 * l'element deplace au milieu d'un espace libre y laisse le meme vide de
 * chaque cote — c'est la definition d'« espaces egaux ».
 */
function equalGapCenters(intervals: Array<[number, number]>): number[] {
  const all: Array<[number, number]> = [[0, 0], ...intervals.filter(
    ([a, b]) => Number.isFinite(a) && Number.isFinite(b),
  ), [100, 100]];
  const out: number[] = [];
  for (const [, aEnd] of all) {
    for (const [bStart] of all) {
      if (aEnd < bStart) out.push((aEnd + bStart) / 2);
    }
  }
  return out;
}

/* ── Format d'export — la seule unite de mesure ───────────────────────── */

export type FrameFormat = '9:16' | '1:1' | '16:9';

/**
 * Resolution reelle du montage, par format.
 *
 * ⚠️ LE CARRE EST DANS LA LISTE. Le Mode simple propose trois formats : le
 * supposer absent ferait retomber ses mesures sur le 9:16, donc afficher des
 * hauteurs 1,78 fois trop grandes sur un montage carre.
 */
export const FORMAT_PIXELS: Record<FrameFormat, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '16:9': { width: 1920, height: 1080 },
};

/**
 * Convertit un % du cadre en pixels du FORMAT D'EXPORT.
 *
 * L'axe decide du diviseur : 1080 en largeur et 1920 en hauteur pour du
 * 9:16, l'inverse en 16:9. Utiliser la meme dimension pour les deux axes
 * revient a supposer un cadre carre — l'erreur exacte que ce module corrige.
 */
export function pctToFormatPx(pct: number, axis: 'x' | 'y', format: FrameFormat): number {
  const dims = FORMAT_PIXELS[format] ?? FORMAT_PIXELS['9:16'];
  if (!Number.isFinite(pct)) return 0;
  return Math.round((pct / 100) * (axis === 'x' ? dims.width : dims.height));
}

/* ── Boites englobantes ───────────────────────────────────────────────── */

/** Rectangle minimal — compatible avec un `DOMRect`. */
export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Emprise d'un element, en % du cadre.
 *
 * Quatre BORDS, pas un centre : c'est ce que l'utilisateur voit et ce qu'il
 * veut mesurer. Le vide entre deux elements est la distance entre leurs
 * bords en regard — la distance entre leurs centres ne decrit aucun vide.
 */
export interface ElementBox {
  key: string;
  label: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function boxFromRects(
  key: string,
  label: string,
  el: RectLike,
  frame: RectLike,
): ElementBox {
  const w = frame.width || 1;
  const h = frame.height || 1;
  return {
    key,
    label,
    left: ((el.left - frame.left) / w) * 100,
    top: ((el.top - frame.top) / h) * 100,
    right: ((el.left + el.width - frame.left) / w) * 100,
    bottom: ((el.top + el.height - frame.top) / h) * 100,
  };
}

export function boxCenter(b: ElementBox): { x: number; y: number } {
  return { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
}

/** Meme boite, translatee — la taille ne change pas pendant un glissement. */
export function shiftBox(b: ElementBox, dx: number, dy: number): ElementBox {
  return { ...b, left: b.left + dx, right: b.right + dx, top: b.top + dy, bottom: b.bottom + dy };
}

/** Attribut porte par tout element que les reperes doivent mesurer. */
export const GUIDE_KEY_ATTR = 'data-guide-key';

function unionRect(els: HTMLElement[]): RectLike | null {
  let l = Infinity;
  let t = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  for (const el of els) {
    const rect = el.getBoundingClientRect();
    if (!rect.width && !rect.height) continue;
    l = Math.min(l, rect.left);
    t = Math.min(t, rect.top);
    r = Math.max(r, rect.left + rect.width);
    b = Math.max(b, rect.top + rect.height);
  }
  if (!Number.isFinite(l) || !Number.isFinite(t)) return null;
  return { left: l, top: t, width: r - l, height: b - t };
}

/**
 * Mesure, dans le DOM, la boite de chaque element marque `data-guide-key`.
 *
 * Lire le DOM plutot que l'etat React est ce qui rend la mesure JUSTE : les
 * elements ne sont pas ancres au meme endroit (titre par son coin haut-gauche,
 * CTA par le milieu de son bas) et leur taille depend du texte saisi. Aucun
 * etat ne connait cette emprise reelle — seul le rectangle rendu la connait.
 *
 * `data-guide-union` mesure l'union des ENFANTS plutot que l'element lui-meme :
 * le conteneur des cartes occupe toute une bande du cadre alors que les cartes
 * n'en remplissent que le milieu.
 */
export function collectGuideBoxes(frame: HTMLElement | null | undefined): ElementBox[] {
  if (!frame || typeof frame.getBoundingClientRect !== 'function') return [];
  const fr = frame.getBoundingClientRect();
  if (!fr.width || !fr.height) return [];
  const out: ElementBox[] = [];
  frame.querySelectorAll<HTMLElement>(`[${GUIDE_KEY_ATTR}]`).forEach((el) => {
    const key = el.getAttribute(GUIDE_KEY_ATTR);
    if (!key) return;
    const label = el.getAttribute('data-guide-label') || key;
    const rect = el.hasAttribute('data-guide-union')
      ? unionRect(Array.from(el.children) as HTMLElement[])
      : el.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return;
    out.push(boxFromRects(key, label, rect, fr));
  });
  return out;
}

/* ── Ecarts BORD-A-BORD ───────────────────────────────────────────────── */

export type GapSide = 'top' | 'bottom' | 'left' | 'right';

export interface GapBadge {
  axis: 'x' | 'y';
  side: GapSide;
  /** Milieu du segment mesure, en % du cadre. */
  midXPct: number;
  midYPct: number;
  /** Le vide mesure, en % du cadre sur l'axe concerne. */
  gapPct: number;
  /** Le MEME vide, en pixels du format d'export. C'est ce qui s'affiche. */
  gapPx: number;
  /** Mesure contre un voisin, ou contre le bord du cadre a defaut. */
  target: 'frame' | 'element';
  targetLabel: string;
  /** Vrai quand l'ecart oppose vaut le meme, a la tolerance pres. */
  equal: boolean;
}

/**
 * Tolerance de l'egalite, en pixels du format d'export.
 *
 * Deux ecarts a 1 px pres sont egaux pour l'oeil ; exiger l'egalite stricte
 * rendrait l'indicateur inatteignable a la souris.
 */
export const EQUAL_GAP_TOLERANCE_PX = 6;

/**
 * Les quatre vides autour de l'element deplace.
 *
 * De chaque cote : le voisin le plus proche QUI SE FAIT FACE (leurs emprises
 * se recouvrent sur l'autre axe — deux blocs cote a cote ne mesurent pas un
 * ecart vertical), ou a defaut le bord du cadre. Toujours quatre badges :
 * c'est ce qui permet de detecter « haut = bas » meme quand l'element est
 * seul dans le cadre, cas le plus courant du centrage.
 */
export function computeGapBadges(
  active: ElementBox,
  others: ElementBox[],
  format: FrameFormat,
): GapBadge[] {
  const facesX = (o: ElementBox) => o.right > active.left && o.left < active.right;
  const facesY = (o: ElementBox) => o.bottom > active.top && o.top < active.bottom;
  const overlapMidX = (o: ElementBox) =>
    (Math.max(o.left, active.left) + Math.min(o.right, active.right)) / 2;
  const overlapMidY = (o: ElementBox) =>
    (Math.max(o.top, active.top) + Math.min(o.bottom, active.bottom)) / 2;
  const activeMidX = (active.left + active.right) / 2;
  const activeMidY = (active.top + active.bottom) / 2;

  const above = others.filter((o) => facesX(o) && o.bottom <= active.top)
    .sort((a, b) => b.bottom - a.bottom)[0];
  const below = others.filter((o) => facesX(o) && o.top >= active.bottom)
    .sort((a, b) => a.top - b.top)[0];
  const left = others.filter((o) => facesY(o) && o.right <= active.left)
    .sort((a, b) => b.right - a.right)[0];
  const right = others.filter((o) => facesY(o) && o.left >= active.right)
    .sort((a, b) => a.left - b.left)[0];

  const vertical = (side: GapSide, from: number, to: number, partner?: ElementBox): GapBadge => ({
    axis: 'y',
    side,
    midXPct: partner ? overlapMidX(partner) : activeMidX,
    midYPct: (from + to) / 2,
    gapPct: to - from,
    gapPx: pctToFormatPx(to - from, 'y', format),
    target: partner ? 'element' : 'frame',
    targetLabel: partner ? partner.label : 'Cadre',
    equal: false,
  });
  const horizontal = (side: GapSide, from: number, to: number, partner?: ElementBox): GapBadge => ({
    axis: 'x',
    side,
    midXPct: (from + to) / 2,
    midYPct: partner ? overlapMidY(partner) : activeMidY,
    gapPct: to - from,
    gapPx: pctToFormatPx(to - from, 'x', format),
    target: partner ? 'element' : 'frame',
    targetLabel: partner ? partner.label : 'Cadre',
    equal: false,
  });

  const badges: GapBadge[] = [
    vertical('top', above ? above.bottom : 0, active.top, above),
    vertical('bottom', active.bottom, below ? below.top : 100, below),
    horizontal('left', left ? left.right : 0, active.left, left),
    horizontal('right', active.right, right ? right.left : 100, right),
  ];

  // Espaces EGAUX — l'indicateur de symetrie. Limite volontairement aux deux
  // cotes opposes de l'element deplace : la distribution d'une serie de trois
  // elements ou plus demanderait un autre calcul, et n'est pas couverte ici.
  const markEqual = (a: GapSide, b: GapSide) => {
    const x = badges.find((g) => g.side === a)!;
    const y = badges.find((g) => g.side === b)!;
    if (Math.abs(x.gapPx - y.gapPx) <= EQUAL_GAP_TOLERANCE_PX) {
      x.equal = true;
      y.equal = true;
    }
  };
  markEqual('top', 'bottom');
  markEqual('left', 'right');

  return badges;
}

/**
 * Conversion ancre ↔ centre.
 *
 * Les elements de l'apercu ne sont pas ancres au meme endroit : le titre par
 * son coin haut-gauche, le CTA par le milieu de son bas, un element libre par
 * son centre. Or un guide de centrage parle du CENTRE.
 *
 * Aimanter la position d'ancre reviendrait a centrer le BORD GAUCHE du titre
 * sur l'axe — visiblement decale de la moitie de sa largeur. On convertit
 * donc vers le centre, on aimante la, puis on revient a l'ancre.
 */
export type Anchor = 'top-left' | 'bottom-center' | 'center';

export interface Box {
  /** Largeur en % du conteneur. */
  width: number;
  /** Hauteur en % du conteneur. */
  height: number;
}

/** Centre d'un element, depuis sa position d'ancre. */
export function anchorToCenter(
  pos: { x: number; y: number },
  anchor: Anchor,
  box: Box,
): { x: number; y: number } {
  const w = Number.isFinite(box?.width) ? box.width : 0;
  const h = Number.isFinite(box?.height) ? box.height : 0;
  switch (anchor) {
    case 'top-left':
      return { x: pos.x + w / 2, y: pos.y + h / 2 };
    case 'bottom-center':
      return { x: pos.x, y: pos.y - h / 2 };
    default:
      return { x: pos.x, y: pos.y };
  }
}

/** Position d'ancre, depuis un centre — l'exacte reciproque. */
export function centerToAnchor(
  center: { x: number; y: number },
  anchor: Anchor,
  box: Box,
): { x: number; y: number } {
  const w = Number.isFinite(box?.width) ? box.width : 0;
  const h = Number.isFinite(box?.height) ? box.height : 0;
  switch (anchor) {
    case 'top-left':
      return { x: center.x - w / 2, y: center.y - h / 2 };
    case 'bottom-center':
      return { x: center.x, y: center.y + h / 2 };
    default:
      return { x: center.x, y: center.y };
  }
}
