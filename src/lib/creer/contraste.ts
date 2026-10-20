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
