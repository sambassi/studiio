import { chassePolice, enCapitales } from '@/lib/creer/zones-sures-916';
import { FONT_RATIO, VIDEO_SIZE, type DesignFormat } from '@/lib/creer/designSpec';
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

/**
 * 9:16 : échelle MINIMALE du CTA avant ajustement — 0,0375 × 1080 × 1,5 ≈ 61 px,
 * hauteur de capitale ≈ 44 px (export du 20/10 : 28 px, illisible sur
 * téléphone). `echelleCtaAjustee` ne fait ensuite que RÉDUIRE si le texte
 * déborderait : jamais de débordement, marges sûres gardées.
 */
export const ECHELLE_CTA_LISIBLE_916 = 1.5;

/**
 * Échelle de DÉPART du CTA : le plancher 9:16 ne remplace que le DÉFAUT
 * (échelle absente ou 1, jamais réglée), et seulement pour un projet créé
 * avec les défauts lisibles (`lisible`, marqueur `versionLisibilite` du
 * brouillon) — un ancien projet garde 1. Une échelle choisie par
 * l'utilisateur (poignée, curseur) est gardée telle quelle, plus petite
 * comprise. Les posts déjà rendus relisent leur `ctaTextScale` enregistrée.
 */
export function echelleCtaDeDepart(echelle: number | null | undefined, format: string, lisible = true): number {
  const e = echelle ?? 1;
  return lisible && format === '9:16' && e === 1 ? ECHELLE_CTA_LISIBLE_916 : e;
}

/** Version courante des défauts de lisibilité (projets créés à partir de #611). */
export const VERSION_LISIBILITE = 2;
/** Les défauts lisibles s'appliquent-ils à ce projet ? Absent (projet antérieur) : non. */
export const defautsLisibles = (version: number | null | undefined) => (version ?? 1) >= VERSION_LISIBILITE;

/**
 * Version de lisibilité d'un projet RELU (brouillon local ou post enregistré).
 *
 * Constat (« LE_SPORT_LE_PLUS_COMPLET (2) », 20/10) : un brouillon local
 * restauré sans `versionLisibilite` retombait en v1 — cartes minuscules, CTA
 * à l'échelle 1, sous-ligne rose sur rose — alors que l'utilisateur
 * travaillait sur un projet d'aujourd'hui.
 *
 *  - version écrite : gardée telle quelle ;
 *  - BROUILLON LOCAL sans version : la version courante (les défauts lisibles
 *    sont ceux de tout projet en cours) ;
 *  - POST ENREGISTRÉ sans version (métadonnées relues en modification, que le
 *    Calendrier relit aussi) : v1 — son rendu historique est gardé (règle
 *    « Default safe »).
 */
export function versionLisibiliteRestauree(version: number | null | undefined, source: 'brouillon' | 'post'): number {
  if (typeof version === 'number' && Number.isInteger(version) && version >= 1) return version;
  return source === 'brouillon' ? VERSION_LISIBILITE : 1;
}

// ── TITRE LISIBLE PAR DÉFAUT (v2, 9:16) ──────────────────────────────────
//
// Constat (démo « LE SPORT », lot 2) : écran titre de 5 s avec un titre
// minuscule en haut à gauche (≈ 40 px de capitale sur 1080) — l'échelle 1 du
// titre est celle de l'éditeur d'origine, pensée pour un plateau de 320 px.
// Pour un projet aux défauts lisibles (`versionLisibilite` ≥ 2) en 9:16, le
// titre à l'échelle par DÉFAUT (1) est ajusté pour occuper ≈ 80 % de la
// largeur utile de son cadre, sur 1 ou 2 lignes selon son nombre de mots,
// entre `ECHELLE_TITRE_LISIBLE` min et max. Une échelle réglée par
// l'utilisateur (poignée, curseur) est gardée telle quelle — la même règle que
// le CTA (`echelleCtaDeDepart`). La garde « aucun mot ne déborde »
// (`titreSur916`) s'applique ensuite.

/** Bornes de l'échelle automatique du titre (9:16) : ≈ 66 px à ≈ 113 px de corps sur 1080. */
export const ECHELLE_TITRE_LISIBLE = { min: 1.4, max: 2.4 } as const;
/**
 * #613 — les MÊMES bornes en pixels de corps (image de 1080 de petit côté),
 * pour les trois formats : un titre lisible a la même taille physique en
 * 9:16, en 1:1 et en 16:9 (seule la largeur cible change avec le cadre).
 */
export const CORPS_TITRE_LISIBLE_PX = {
  min: ECHELLE_TITRE_LISIBLE.min * VIDEO_SIZE['9:16'].w * FONT_RATIO['9:16'].title,
  max: ECHELLE_TITRE_LISIBLE.max * VIDEO_SIZE['9:16'].w * FONT_RATIO['9:16'].title,
} as const;
/** Part de la largeur utile du cadre visée par la ligne de titre. */
export const PART_LARGEUR_TITRE = 0.8;

export function echelleTitreDeDepart(p: {
  echelle: number | null | undefined; titre: string | null | undefined; format: string;
  /** Largeur du cadre titre (% de la vidéo). */
  largeurPct: number; police?: string | null; casse?: 'none' | 'uppercase' | 'lowercase'; lisible?: boolean;
}): number {
  const e = p.echelle ?? 1;
  const titre = (p.titre ?? '').trim();
  // #613 : les trois formats (9:16, 1:1, 16:9) — avant, le 9:16 seul.
  if (!p.lisible || !(p.format in VIDEO_SIZE) || e !== 1 || !titre) return e;
  const f = p.format as DesignFormat;
  const W = VIDEO_SIZE[f].w;
  /** Corps du titre à l'échelle 1 (px) : le ratio du compositeur pour ce format. */
  const corps1 = W * FONT_RATIO[f].title;
  const utile = (p.largeurPct / 100) * W * PART_LARGEUR_TITRE;
  const ch = chassePolice(p.police ?? 'Inter', enCapitales(titre, p.casse));
  const mots = titre.split(/\s+/).filter(Boolean);
  // Deux lignes au plus : le bloc reste au-dessus du rail d'actions des
  // réseaux (35 % de la hauteur), sa largeur n'y est pas rabotée.
  const lignes = Math.min(2, Math.max(1, Math.ceil(mots.length / 2)));
  const largeurA1 = mots.reduce((t, m) => t + m.length * ch.em, 0) * corps1 + (mots.length - 1) * ch.espace * corps1;
  const cible = (utile * lignes) / Math.max(1e-6, largeurA1);
  // Bornes en px de corps, identiques pour les trois formats (9:16 : 1,4–2,4 exactement comme avant).
  const min = CORPS_TITRE_LISIBLE_PX.min / corps1;
  const max = CORPS_TITRE_LISIBLE_PX.max / corps1;
  return Math.round(Math.min(max, Math.max(min, cible)) * 100) / 100;
}
