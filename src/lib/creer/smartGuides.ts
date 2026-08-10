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
  | 'card'
  // Blocs de texte secondaires de l'editeur avance. Ils etaient deplacables
  // sans etre mesurables : la regle ne les voyait pas, donc « entre deux
  // titres » ne donnait aucun chiffre.
  | 'titleIcon'
  | 'extraTitle'
  | 'extraSubtitle'
  // Instances multiples — la cle porte l'index ou l'identifiant, sinon deux
  // exemplaires du meme type se confondraient dans `collectGuideBoxes`.
  | `overlay:${number}`
  | `card:${number}`
  | `element:${string}`;

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
  /** Cle du voisin mesure — sert a ne pas le mesurer deux fois. */
  targetKey?: string;
  /** Vrai quand l'ecart oppose vaut le meme, a la tolerance pres. */
  equal: boolean;
  /**
   * Les deux boites SE FONT FACE sur l'autre axe.
   *
   * Faux = mesure « en diagonale » : l'ecart reste un vrai bord-a-bord sur
   * cet axe, mais rien ne se trouve reellement en vis-a-vis. Le calque le
   * trace en pointilles pour que le chiffre ne se lise pas comme un
   * alignement.
   */
  aligned: boolean;
}

/**
 * Tolerance de l'egalite, en pixels du format d'export.
 *
 * Deux ecarts a 1 px pres sont egaux pour l'oeil ; exiger l'egalite stricte
 * rendrait l'indicateur inatteignable a la souris.
 */
export const EQUAL_GAP_TOLERANCE_PX = 6;

/** Ecart bord-a-bord entre deux boites sur un axe ; 0 si elles se recouvrent. */
function axisGap(aMin: number, aMax: number, bMin: number, bMax: number): number {
  if (bMin >= aMax) return bMin - aMax;
  if (aMin >= bMax) return aMin - bMax;
  return 0;
}

/**
 * Distance bord-a-bord entre deux boites, en pixels du format.
 *
 * Chaque axe est converti avec SA dimension avant d'etre combine : melanger
 * des % de largeur et des % de hauteur donnerait un nombre sans signification
 * des que le cadre n'est pas carre.
 */
export function boxDistancePx(a: ElementBox, b: ElementBox, format: FrameFormat): number {
  const dx = pctToFormatPx(axisGap(a.left, a.right, b.left, b.right), 'x', format);
  const dy = pctToFormatPx(axisGap(a.top, a.bottom, b.top, b.bottom), 'y', format);
  return Math.round(Math.hypot(dx, dy));
}

/**
 * Ecarts vers UN voisin designe, sur chaque axe qui les separe reellement.
 *
 * ⚠️ DEUX CHIFFRES PLUTOT QU'UNE DIAGONALE. Deux blocs poses en biais sont
 * separes horizontalement ET verticalement ; une seule longueur diagonale
 * melangerait les deux unites (la largeur du format et sa hauteur ne sont pas
 * la meme echelle) et ne dirait a l'utilisateur ni de combien deplacer a
 * droite, ni de combien deplacer en bas. Un axe qui se recouvre ne produit
 * aucun badge : il n'y a rien a mesurer.
 */
function pairBadges(
  active: ElementBox,
  partner: ElementBox,
  format: FrameFormat,
): GapBadge[] {
  const out: GapBadge[] = [];
  const midX = ((active.left + active.right) / 2 + (partner.left + partner.right) / 2) / 2;
  const midY = ((active.top + active.bottom) / 2 + (partner.top + partner.bottom) / 2) / 2;

  const dy = axisGap(active.top, active.bottom, partner.top, partner.bottom);
  if (dy > 0) {
    const dessus = partner.bottom <= active.top;
    const from = dessus ? partner.bottom : active.bottom;
    out.push({
      axis: 'y',
      side: dessus ? 'top' : 'bottom',
      midXPct: midX,
      midYPct: from + dy / 2,
      gapPct: dy,
      gapPx: pctToFormatPx(dy, 'y', format),
      target: 'element',
      targetLabel: partner.label,
      targetKey: partner.key,
      equal: false,
      aligned: false,
    });
  }

  const dx = axisGap(active.left, active.right, partner.left, partner.right);
  if (dx > 0) {
    const gauche = partner.right <= active.left;
    const from = gauche ? partner.right : active.right;
    out.push({
      axis: 'x',
      side: gauche ? 'left' : 'right',
      midXPct: from + dx / 2,
      midYPct: midY,
      gapPct: dx,
      gapPx: pctToFormatPx(dx, 'x', format),
      target: 'element',
      targetLabel: partner.label,
      targetKey: partner.key,
      equal: false,
      aligned: false,
    });
  }
  return out;
}

export interface GapOptions {
  /**
   * Voisin a mesurer explicitement — celui que le pointeur survole.
   *
   * Sans lui, c'est le voisin le PLUS PROCHE qui est mesure. Avec lui,
   * l'utilisateur choisit la paire : « quelle distance entre ces deux-la ».
   */
  pairWith?: string | null;
}

/**
 * Les vides autour de l'element mis en avant.
 *
 * Deux familles, et c'est la correction du defaut « aucune mesure entre deux
 * elements » :
 *
 *   1. LES QUATRE COTES. De chaque cote : le voisin le plus proche QUI SE
 *      FAIT FACE, ou a defaut le bord du cadre. Toujours quatre badges —
 *      c'est ce qui permet de detecter « haut = bas » meme quand l'element
 *      est seul, cas le plus courant du centrage.
 *
 *   2. LE VOISIN LE PLUS PROCHE. Deux blocs poses en biais ne se font face
 *      sur aucun axe : la premiere famille ne les mesurait donc jamais, et
 *      deux titres decales ne donnaient aucun chiffre. Celui-ci est mesure
 *      quoi qu'il arrive, sauf s'il figure deja parmi les quatre.
 */
export function computeGapBadges(
  active: ElementBox,
  others: ElementBox[],
  format: FrameFormat,
  options: GapOptions = {},
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
    targetKey: partner?.key,
    equal: false,
    aligned: true,
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
    targetKey: partner?.key,
    equal: false,
    aligned: true,
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

  // ── Le voisin le plus proche ───────────────────────────────────────
  // Survole, l'utilisateur designe lui-meme la paire ; sinon on prend le plus
  // proche. Deja mesure par un des quatre cotes, on ne le repete pas.
  const designe = options.pairWith
    ? others.find((o) => o.key === options.pairWith) ?? null
    : null;
  const proche = designe
    ?? others.slice().sort(
      (a, b) => boxDistancePx(active, a, format) - boxDistancePx(active, b, format),
    )[0]
    ?? null;
  if (proche && !badges.some((g) => g.targetKey === proche.key)) {
    badges.push(...pairBadges(active, proche, format));
  }

  return badges;
}

/**
 * Deux series de mesures sont-elles identiques ?
 *
 * Le calcul tourne apres CHAQUE rendu — sans cette comparaison, poser le
 * resultat dans l'etat declencherait un rendu, donc un calcul, sans fin.
 */
export function sameGaps(a: GapBadge[], b: GapBadge[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((g, i) => {
    const o = b[i];
    return g.side === o.side
      && g.gapPx === o.gapPx
      && g.equal === o.equal
      && g.aligned === o.aligned
      && g.targetKey === o.targetKey
      && Math.abs(g.midXPct - o.midXPct) < 0.01
      && Math.abs(g.midYPct - o.midYPct) < 0.01;
  });
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
