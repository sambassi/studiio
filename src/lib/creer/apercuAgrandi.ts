/**
 * Géométrie de l'aperçu AGRANDI — une vraie fenêtre quasi plein écran,
 * centrée, au ratio de la vidéo. Une géométrie mémorisée n'est reprise que
 * si elle reste un VRAI agrandissement (au moins la taille de la cible) et qu'elle tient
 * dans l'écran ; sinon la cible. Pure.
 */
export interface Geometrie { x: number; y: number; w: number; h: number }

/** Marge autour de la fenêtre, en px. */
const MARGE = 16;
/** Hauteur hors plateau dans la fenêtre : en-tête, onglets, marges (px). */
const CHROME = 130;

export function geometrieCible(vw: number, vh: number, ratio: number): Geometrie {
  const h = Math.max(320, vh - 2 * MARGE);
  const w = Math.max(280, Math.min(vw - 2 * MARGE, Math.round((h - CHROME) * ratio + 48)));
  return { x: Math.round((vw - w) / 2), y: Math.round((vh - h) / 2), w, h };
}

export function geometrieAgrandie(memo: Partial<Geometrie> | null | undefined, vw: number, vh: number, ratio: number): Geometrie {
  const cible = geometrieCible(vw, vh, ratio);
  const g = memo && [memo.x, memo.y, memo.w, memo.h].every((n) => typeof n === 'number' && Number.isFinite(n)) ? memo as Geometrie : null;
  // Une taille mémorisée n'est reprise que si elle est AU MOINS aussi grande
  // que la cible : sinon la fenêtre « agrandie » restait petite et décentrée.
  if (!g || g.w < cible.w || g.h < cible.h) return cible;
  const w = Math.min(g.w, vw - 2 * MARGE);
  const h = Math.min(g.h, vh - 2 * MARGE);
  const x = Math.min(Math.max(MARGE, g.x), vw - MARGE - w);
  const y = Math.min(Math.max(MARGE, g.y), vh - MARGE - h);
  return { x, y, w, h };
}
