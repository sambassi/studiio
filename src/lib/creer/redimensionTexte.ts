/**
 * Redimensionnement du titre et du CTA dans l'aperçu — calcul PUR du geste.
 *
 * ⚠️ TOUT EST FIGÉ À LA PRISE : position du pointeur, taille du bloc,
 * échelle. Re-mesurer le bloc pendant le geste créait une boucle : le texte
 * grandit, son centre se déplace VERS le pointeur, le rapport des distances
 * retombe vers 1 — et la poignée semblait ne rien faire.
 *
 * Coin : le déplacement projeté sur la diagonale du coin (vers l'extérieur =
 * agrandir), rapporté à la demi-diagonale du bloc de départ.
 * Bord : la largeur suit le pointeur ; un bloc CENTRÉ (CTA) s'élargit des
 * deux côtés, d'où le facteur 2.
 */
export type Coin = 'nw' | 'ne' | 'sw' | 'se';

export function echelleDepuisCoin(g: {
  echelleDepart: number;
  coin: Coin;
  dx: number;
  dy: number;
  largeurBloc: number;
  hauteurBloc: number;
  min: number;
  max: number;
}): number {
  const sx = g.coin === 'ne' || g.coin === 'se' ? 1 : -1;
  const sy = g.coin === 'sw' || g.coin === 'se' ? 1 : -1;
  const demiDiagonale = Math.max(8, Math.hypot(g.largeurBloc, g.hauteurBloc) / 2);
  const rapport = Math.max(0.05, 1 + (sx * g.dx + sy * g.dy) / demiDiagonale);
  return Math.min(g.max, Math.max(g.min, Math.round(g.echelleDepart * rapport * 100) / 100));
}

/** Bornes de largeur d'un bloc de texte, en % de la vidéo. */
export const LARGEUR_MIN = 30;
export const LARGEUR_MAX = 96;

export function largeurDepuisBord(g: {
  largeurDepart: number;
  dx: number;
  /** Largeur du bloc à la prise, en px écran. */
  largeurBlocPx: number;
  centre: boolean;
}): number {
  const pxParPourcent = Math.max(0.01, g.largeurBlocPx / g.largeurDepart);
  const delta = (g.dx / pxParPourcent) * (g.centre ? 2 : 1);
  return Math.min(LARGEUR_MAX, Math.max(LARGEUR_MIN, Math.round(g.largeurDepart + delta)));
}
