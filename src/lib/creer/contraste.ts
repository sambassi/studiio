/**
 * CONTRASTE DU TEXTE (WCAG 2.x) — module PUR, partagé par l'aperçu
 * (`SequenceCta`) et le compositeur (`drawCTA`).
 *
 * Constat (export réel du 20/10) : la petite ligne du CTA, rose (#EC4899),
 * posée sur le dégradé rose/violet — contraste ≈ 1,3:1, illisible sur un
 * téléphone. Même le blanc n'atteint pas 4,5:1 sur le rose de marque : la
 * teinte seule ne suffit pas, il faut un fond.
 *
 * Règle : si la petite ligne n'atteint pas `CONTRASTE_MIN` sur l'une des
 * couleurs du fond, elle passe sur une PASTILLE sombre et sa teinte est
 * éclaircie (même famille) jusqu'à 4,5:1 contre cette pastille posée sur du
 * BLANC — le pire fond possible, donc lisible sur n'importe quelle image.
 */

export const CONTRASTE_MIN = 4.5;
/** Pastille derrière la petite ligne du CTA : noir de marque, opaque à 80 %. */
export const PASTILLE_RGB: [number, number, number] = [10, 10, 15];
export const PASTILLE_ALPHA = 0.8;
export const PASTILLE_CSS = `rgba(${PASTILLE_RGB.join(',')},${PASTILLE_ALPHA})`;

type Rgb = [number, number, number];

export function hexVersRgb(hex: string | null | undefined): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
export const rgbVersHex = (c: Rgb) => `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}`.toUpperCase();

export function luminance(c: Rgb): number {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function ratioContraste(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** La pastille composée sur du blanc : le fond le plus clair possible sous elle. */
export function fondPastillePire(): Rgb {
  return PASTILLE_RGB.map((v) => v * PASTILLE_ALPHA + 255 * (1 - PASTILLE_ALPHA)) as Rgb;
}

/** La petite ligne a-t-elle besoin de la pastille sur ces couleurs de fond ? */
export function besoinPastille(texte: string, fonds: ReadonlyArray<string | null | undefined>): boolean {
  const t = hexVersRgb(texte);
  if (!t) return false;
  const lus = fonds.map(hexVersRgb).filter((c): c is Rgb => !!c);
  if (!lus.length) return false;
  return lus.some((f) => ratioContraste(t, f) < CONTRASTE_MIN);
}

/**
 * La teinte, éclaircie vers le blanc par pas de 5 % jusqu'à `min` contre
 * `fond`. Inchangée si elle suffit déjà ; couleur illisible : inchangée.
 */
export function eclaircirPourContraste(texte: string, fond: Rgb = fondPastillePire(), min = CONTRASTE_MIN): string {
  const t = hexVersRgb(texte);
  if (!t) return texte;
  for (let k = 0; k <= 20; k++) {
    const m = k / 20;
    const c = t.map((v) => v + (255 - v) * m) as Rgb;
    if (ratioContraste(c, fond) >= min) return k === 0 ? texte : rgbVersHex(c);
  }
  return '#FFFFFF';
}

// ── TEXTE SUR L'IMAGE : CONTOUR FIN + OMBRE SERRÉE ─────────────────────────
//
// Constat (MP4 du 20/10) : CTA « dans un rectangle gris opaque, sur la
// poitrine », cartes en bandeau sombre — lourds (`rgba(0,0,0,.55–.72)`).
// Un premier remplacement par un voile radial (alpha 0,35) donnait, sur un
// fond clair, une TACHE grise floue. Rendu cible (sous-titres des formats
// courts, type Captions / OpusClip) :
//   1. lettres posées DIRECTEMENT sur l'image, avec un CONTOUR fin sombre
//      (2 px à 1080, alpha 0,55, quatre directions) et une ombre portée
//      douce et serrée — c'est lui qui porte le contraste au bord des lettres ;
//   2. un voile local SEULEMENT quand le fond derrière le texte est connu
//      clair ET chargé (`fondTexteSurImage`), discret (alpha ≤ 0,22), qui suit
//      la boîte du texte et s'efface sur ses bords — jamais une forme visible.
// Le contraste se mesure au BORD des lettres : contour posé (sur le voile
// éventuel) sur du BLANC, le pire plan possible (`fondHaloPire`).

/** Opacité maximale du voile local (fond clair ET chargé seulement). */
export const VOILE_TEXTE_ALPHA_MAX = 0.22;
/** Opacité d'UNE couche du contour fin. */
export const CONTOUR_TEXTE_ALPHA = 0.55;
/**
 * Opacité effective du contour au bord d'une lettre : deux couches décalées
 * (horizontale + verticale) s'y superposent toujours → 1 − (1 − 0,55)².
 */
export const HALO_TEXTE_ALPHA = Math.round((1 - (1 - CONTOUR_TEXTE_ALPHA) ** 2) * 1000) / 1000;
/** Fond d'un texte posé sur l'image sans voile : aucun aplat, contour seul. */
export const FOND_TEXTE_SUR_IMAGE = 'transparent';

/**
 * Voile LOCAL discret derrière un texte (CSS `background-image`) : ellipse
 * inscrite dans la boîte du texte, bords très doux, alpha ≤ 0,22. `lineaire`
 * (badge de carte) : un peu plus large que haute.
 */
export function voileLocal(forme: 'radial' | 'lineaire', alpha = VOILE_TEXTE_ALPHA_MAX): string {
  const a = Math.min(VOILE_TEXTE_ALPHA_MAX, Math.max(0, alpha));
  const r = (x: number) => Math.round(x * 1000) / 1000;
  const arrets = `rgba(0,0,0,${r(a)}) 0%, rgba(0,0,0,${r(a * 0.75)}) 45%, rgba(0,0,0,${r(a * 0.3)}) 75%, rgba(0,0,0,0) 100%`;
  return forme === 'radial'
    ? `radial-gradient(ellipse 50% 50% at 50% 50%, ${arrets})`
    : `radial-gradient(ellipse 52% 50% at 50% 50%, ${arrets})`;
}

/**
 * Fond d'un texte posé sur l'image : transparent (contour seul) par défaut ;
 * voile discret seulement si le fond derrière le texte est connu clair ET
 * chargé (détail fort), où le contour seul ne suffit plus à détacher la forme
 * des lettres.
 */
export function fondTexteSurImage(forme: 'radial' | 'lineaire', fond?: { clair?: boolean; charge?: boolean } | null): string {
  return fond?.clair && fond?.charge ? voileLocal(forme) : FOND_TEXTE_SUR_IMAGE;
}

/** Un fond de texte est-il un voile en dégradé (et non une couleur unie) ? */
export function estVoile(fond: string | null | undefined): boolean {
  return /gradient\(/.test(fond ?? '');
}

/** Opacité MAXIMALE d'un fond (voile ou couleur `rgba`) ; 1 pour une couleur opaque, 0 si transparent / illisible. */
export function alphaDuFond(fond: string | null | undefined): number {
  const alphas = Array.from((fond ?? '').matchAll(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/g)).map((m) => Number(m[1]));
  if (alphas.length) return Math.max(...alphas);
  return hexVersRgb(fond) ? 1 : 0;
}

/**
 * Contour fin + ombre serrée des glyphes (CSS `text-shadow`), à l'échelle de
 * la vidéo `vw` (valeurs données pour 1080) : quatre décalages de 2 px à
 * alpha 0,55 (un trait fin tout autour), puis une ombre portée douce de
 * 2 px / 5 px. Le même pour le CTA et les cartes.
 */
export function haloTexteCss(vw: number, alpha = CONTOUR_TEXTE_ALPHA): string {
  const k = vw / 1080;
  const px = (v: number) => Math.max(0.5, Math.round(v * k * 10) / 10);
  const c = `rgba(0,0,0,${alpha})`;
  const d = px(2); const f = px(1);
  return `${d}px 0 ${f}px ${c}, -${d}px 0 ${f}px ${c}, 0 ${d}px ${f}px ${c}, 0 -${d}px ${f}px ${c}, 0 ${px(2)}px ${px(5)}px rgba(0,0,0,0.4)`;
}

/** Le fond sous le bord d'une lettre dans le pire cas : contour (sur voile éventuel) sur BLANC. */
export function fondHaloPire(alphaVoile = 0, alphaHalo = HALO_TEXTE_ALPHA): Rgb {
  const v = 255 * (1 - alphaVoile) * (1 - alphaHalo);
  return [v, v, v];
}

/** Contraste WCAG d'une teinte de texte au bord de ses lettres, pire plan (blanc), sans voile par défaut. */
export function contrasteSurVoile(texte: string, alphaVoile = 0, alphaHalo = HALO_TEXTE_ALPHA): number {
  const t = hexVersRgb(texte);
  return t ? ratioContraste(t, fondHaloPire(alphaVoile, alphaHalo)) : 0;
}
