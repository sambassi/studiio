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
  source:
    | 'preview-center'
    | 'element-center'
    | 'preview-thirds'
    | 'equal-gap'
    // Alignements de BORDS. Purement visuels : ils signalent une coincidence
    // deja atteinte, sans ajouter de cible d'aimantation — le placement ne
    // change donc pas de comportement.
    | 'frame-edge'
    | 'element-edge';
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
  /** Cle du voisin mesure — diagnostic seulement, jamais affichee. */
  targetKey?: string;
  /**
   * Toujours vrai.
   *
   * Le champ subsiste parce que la notion porte le sens de l'affichage : un
   * badge n'existe QUE dans une paire d'ecarts egaux. Il n'y a plus de badge
   * « non egal » a distinguer — c'etait le nuage de chiffres qu'on retire.
   */
  equal: true;
}

/**
 * Tolerance de l'egalite, en pixels du format d'export.
 *
 * Deux ecarts a 1 px pres sont egaux pour l'oeil ; exiger l'egalite stricte
 * rendrait l'indicateur inatteignable a la souris.
 */
export const EQUAL_GAP_TOLERANCE_PX = 6;

/**
 * Les vides autour du bloc, UNIQUEMENT lorsqu'ils sont egaux deux a deux.
 *
 * ⚠️ ON N'AFFICHE PLUS UN ECART SEUL, ET C'EST TOUT LE SUJET. Quatre chiffres
 * en permanence autour d'un bloc — « 157 » au-dessus, « 109 » en dessous —
 * ne repondent a aucune question : l'utilisateur ne cherche pas a lire des
 * distances, il cherche a les EGALISER. Un chiffre isole est du bruit ; deux
 * chiffres IDENTIQUES de part et d'autre sont une reponse.
 *
 * On mesure donc toujours les quatre cotes — le voisin le plus proche qui SE
 * FAIT FACE, ou le bord du cadre a defaut — mais on ne rend que les axes dont
 * les deux vides se valent, a `EQUAL_GAP_TOLERANCE_PX` pres. Rien a egaliser,
 * rien a l'ecran.
 *
 * Consequence voulue : un bloc seul dans le cadre et centre verticalement
 * montre sa paire haut/bas ; le meme bloc pose de travers ne montre rien.
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
    targetKey: partner?.key,
    equal: true,
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
    equal: true,
  });

  const out: GapBadge[] = [];

  const haut = vertical('top', above ? above.bottom : 0, active.top, above);
  const bas = vertical('bottom', active.bottom, below ? below.top : 100, below);
  if (Math.abs(haut.gapPx - bas.gapPx) <= EQUAL_GAP_TOLERANCE_PX) out.push(haut, bas);

  const gauche = horizontal('left', left ? left.right : 0, active.left, left);
  const droite = horizontal('right', active.right, right ? right.left : 100, right);
  if (Math.abs(gauche.gapPx - droite.gapPx) <= EQUAL_GAP_TOLERANCE_PX) out.push(gauche, droite);

  return out;
}

/* ── Lignes d'alignement ──────────────────────────────────────────────── */

/**
 * Tolerance d'un alignement visible, en pixels du format d'export.
 *
 * Plus serree que l'aimantation : une ligne d'alignement AFFIRME que deux
 * bords coincident. L'afficher pour un ecart d'un demi-pourcent serait un
 * mensonge que l'utilisateur decouvrirait a l'export.
 */
export const ALIGN_TOLERANCE_PX = 3;

/**
 * Les coincidences de bords et de centres, entre le bloc actif et le reste.
 *
 * ⚠️ AUCUNE CIBLE D'AIMANTATION N'EST AJOUTEE ICI. `snapPosition` aimante sur
 * les CENTRES et sur les milieux d'espaces libres ; y ajouter les bords
 * changerait la sensation du placement, que ce lot ne doit pas toucher. Ces
 * lignes ne font que RENDRE VISIBLE un alignement deja atteint — bord gauche
 * contre bord gauche, centre contre centre, bord contre bord du cadre.
 */
export function computeAlignmentLines(
  active: ElementBox,
  others: ElementBox[],
  format: FrameFormat,
): ActiveGuide[] {
  const out: ActiveGuide[] = [];
  const vus = new Set<string>();

  const ajoute = (axis: 'x' | 'y', pos: number, source: ActiveGuide['source']) => {
    const cle = `${axis}:${pos.toFixed(2)}`;
    if (vus.has(cle)) return;
    vus.add(cle);
    out.push({ axis, pos, source });
  };

  const proche = (a: number, b: number, axis: 'x' | 'y') =>
    Math.abs(pctToFormatPx(a - b, axis, format)) <= ALIGN_TOLERANCE_PX;

  const bordsX = [active.left, (active.left + active.right) / 2, active.right];
  const bordsY = [active.top, (active.top + active.bottom) / 2, active.bottom];

  // Contre le cadre : ses deux bords et son milieu.
  for (const a of bordsX) {
    for (const cible of [0, 50, 100]) {
      if (proche(a, cible, 'x')) {
        ajoute('x', cible, cible === 50 ? 'preview-center' : 'frame-edge');
      }
    }
  }
  for (const a of bordsY) {
    for (const cible of [0, 50, 100]) {
      if (proche(a, cible, 'y')) {
        ajoute('y', cible, cible === 50 ? 'preview-center' : 'frame-edge');
      }
    }
  }

  // Contre les autres blocs : bords et centres.
  for (const o of others) {
    const ciblesX: Array<[number, ActiveGuide['source']]> = [
      [o.left, 'element-edge'],
      [(o.left + o.right) / 2, 'element-center'],
      [o.right, 'element-edge'],
    ];
    for (const a of bordsX) {
      for (const [cible, source] of ciblesX) {
        if (proche(a, cible, 'x')) ajoute('x', cible, source);
      }
    }
    const ciblesY: Array<[number, ActiveGuide['source']]> = [
      [o.top, 'element-edge'],
      [(o.top + o.bottom) / 2, 'element-center'],
      [o.bottom, 'element-edge'],
    ];
    for (const a of bordsY) {
      for (const [cible, source] of ciblesY) {
        if (proche(a, cible, 'y')) ajoute('y', cible, source);
      }
    }
  }

  return out;
}

/** Deux series de lignes sont-elles identiques ? Meme role que `sameGaps`. */
export function sameGuides(a: ActiveGuide[], b: ActiveGuide[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((g, i) =>
    g.axis === b[i].axis && g.source === b[i].source && Math.abs(g.pos - b[i].pos) < 0.01);
}

/**
 * Reunit les lignes d'aimantation et celles d'alignement, sans doublon.
 *
 * Les deux tombent souvent au meme endroit — aimanter sur un centre, c'est
 * aussi s'y aligner. Deux traits superposes donneraient un trait deux fois
 * plus opaque a cet endroit precis, donc une hierarchie visuelle fausse.
 */
export function mergeGuides(...series: ActiveGuide[][]): ActiveGuide[] {
  const vus = new Set<string>();
  const out: ActiveGuide[] = [];
  for (const serie of series) {
    for (const g of serie) {
      const cle = `${g.axis}:${g.pos.toFixed(2)}`;
      if (vus.has(cle)) continue;
      vus.add(cle);
      out.push(g);
    }
  }
  return out;
}

/**
 * Au plus UNE ligne par axe.
 *
 * ⚠️ SANS CETTE COUPE, UN TRAIT PAR VOISIN. Un bloc pose au milieu de cinq
 * autres declenche cinq coincidences simultanees : cinq traits en travers de
 * l'apercu, qui ne designent plus rien. L'ordre d'entree porte la priorite —
 * les appelants passent d'abord la cible reellement AIMANTEE, puis les
 * alignements simplement constates.
 */
export function onePerAxis(guides: ActiveGuide[]): ActiveGuide[] {
  const out: ActiveGuide[] = [];
  for (const axis of ['x', 'y'] as const) {
    const premier = guides.find((g) => g.axis === axis);
    if (premier) out.push(premier);
  }
  return out;
}

/** Deux emprises sont-elles identiques ? Meme role que `sameGaps`. */
export function sameBox(a: ElementBox | null, b: ElementBox | null): boolean {
  if (!a || !b) return a === b;
  return a.key === b.key
    && Math.abs(a.left - b.left) < 0.01
    && Math.abs(a.top - b.top) < 0.01
    && Math.abs(a.right - b.right) < 0.01
    && Math.abs(a.bottom - b.bottom) < 0.01;
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
