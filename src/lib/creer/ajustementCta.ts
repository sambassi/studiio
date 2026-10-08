/**
 * CTA qui ne déborde jamais — UNE règle, appliquée avant l'aperçu ET
 * l'export (elle produit l'échelle que les deux reçoivent).
 *
 *  1. LARGEUR : le mot le plus long (texte principal comme sous-texte) tient
 *     dans la largeur utile du bloc (largeur réglée, marge de sécurité). Un
 *     mot n'est jamais coupé : c'est la taille qui baisse ;
 *  2. HAUTEUR : le bloc, une fois les lignes formées mot à mot, reste sous
 *     une hauteur maximale (zone sûre au-dessus du bas de l'image).
 *
 * Jamais au-dessus de l'échelle choisie : l'ajustement ne fait que réduire,
 * jusqu'à un plancher lisible. Mesure par ESTIMATION (chasse d'une capitale
 * grasse ≈ 0,72 em) — prudente, identique des deux côtés. Pure.
 */
const CHASSE_EM = 0.72;
const MARGE = 0.94;
const INTERLIGNE = 1.2;
/** Part maximale de la hauteur que le CTA peut occuper. */
export const HAUTEUR_CTA_MAX = 0.3;
/** Plancher : en dessous, le texte ne serait plus lisible. */
export const ECHELLE_CTA_MIN = 0.35;

const mots = (t: string) => t.split(/\s+/).filter(Boolean);

function lignes(texte: string, taille: number, utile: number): number {
  let n = 0;
  let ligne = 0;
  for (const m of mots(texte)) {
    const lm = m.length * CHASSE_EM * taille;
    const avecEspace = ligne > 0 ? ligne + 0.3 * taille + lm : lm;
    if (ligne > 0 && avecEspace > utile) { n += 1; ligne = lm; } else ligne = avecEspace;
  }
  return ligne > 0 ? n + 1 : n;
}

export function echelleCtaAjustee(p: {
  texte: string;
  sousTexte?: string | null;
  echelle: number;
  /** Largeur du bloc CTA, en % de la vidéo. */
  largeurPct: number;
  /** Taille de la vidéo (px) : mêmes ratios de police que le compositeur. */
  video: { w: number; h: number };
}): number {
  const { w, h } = p.video;
  const reel = h > w;
  const principal = w * (reel ? 0.0375 : 0.031);
  const sous = w * (reel ? 0.028 : 0.023);
  const utile = w * (p.largeurPct / 100) * MARGE;
  const plusLong = (t: string) => mots(t).reduce((m, x) => Math.max(m, x.length), 0);
  let echelle = Math.max(0, p.echelle || 1);
  const lp = plusLong(p.texte || '');
  const ls = plusLong(p.sousTexte || '');
  if (lp > 0) echelle = Math.min(echelle, utile / (lp * CHASSE_EM * principal));
  if (ls > 0) echelle = Math.min(echelle, utile / (ls * CHASSE_EM * sous));
  const hauteur = (e: number) =>
    lignes(p.texte || '', principal * e, utile) * principal * e * INTERLIGNE
    + lignes(p.sousTexte || '', sous * e, utile) * sous * e * INTERLIGNE;
  while (echelle > ECHELLE_CTA_MIN && hauteur(echelle) > h * HAUTEUR_CTA_MAX) echelle *= 0.95;
  return Math.max(ECHELLE_CTA_MIN, Math.floor(echelle * 100) / 100);
}
