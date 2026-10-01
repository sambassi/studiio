/**
 * SURIMPRESSIONS — MISE EN PAGE PARTAGÉE (Créer + Autopilote).
 *
 * Où et à quelle taille titre, cartes et CTA se posent SUR la vidéo, pour
 * un profil qui passe en surimpression (`profilEnSurimpression`). Les règles
 * éditoriales viennent de `TEXTES_PROFILS` (smart-montage-regles) ; ce module
 * les traduit en réglages que les composants partagés (`SequenceTitle`,
 * `SequenceCards`, `SequenceCta`) comprennent déjà — Remotion (Autopilote,
 * images du rendu hybride) et la capture de Créer lisent les MÊMES valeurs.
 *
 *   accroche : en haut à gauche, plus grande (≈ 2,2 % de l'image minimum) ;
 *   cartes   : en bas à gauche, une à la fois, fond sombre (contraste) ;
 *   CTA      : remonté vers le centre (bas-centre → 76 %), plus grand.
 *
 * Aucune détection de visage / corps : positions éditoriales seulement.
 * Le placement mesuré (zones calmes) reste un CONSEIL du conseiller.
 * Module PUR.
 */
import { TEXTES_PROFILS, type NomProfilMontage } from '@/lib/creer/smart-montage-regles';

export interface BoiteCarte { x: number; y: number; w: number; h: number }

export interface MiseEnPageSurimpression {
  titlePos: { x: number; y: number };
  /** Multiplicateurs appliqués à l'échelle choisie par l'utilisateur (1 si aucune). */
  titleScale: number;
  subtitleScale: number;
  ctaPos: { x: number; y: number };
  ctaScale: number;
  /** Emplacement de LA carte affichée, en % du cadre des cartes (`CARDS_FRAME`). */
  carte: BoiteCarte;
  carteScale: number;
  /** Fond du cadre de la carte (lisibilité sur un rush clair). */
  carteFond: string;
  /** Part de blanc mêlée à la couleur d'accent de la valeur (lisible sur le fond sombre). */
  valeurEclaircie: number;
}

/** Profils dynamiques : la vidéo continue, les textes passent par-dessus. */
const DYNAMIQUE: MiseEnPageSurimpression = {
  titlePos: { x: 8, y: 7 },
  // #496 : l'accroche ne doit pas couvrir le sujet — bloc ≤ ~15 % de la
  // hauteur (mesuré sur DANSE : 18 % → voir les tests). Titre toujours net.
  titleScale: 1.9,
  // ⚠️ `SequenceTitle` MULTIPLIE la taille du sous-titre par celle du titre :
  // 0,7 × 1,9 ≈ 1,33 — la phrase reste lisible, sous l'accroche.
  subtitleScale: 0.7,
  // Bas-centre de la ligne CTA : 76 % de la hauteur — plus central que 92 %,
  // sous les corps (mesuré sur DANSE : le sol est la zone la plus calme).
  ctaPos: { x: 50, y: 76 },
  ctaScale: 1.6,
  // Cadre des cartes = 8 %–92 % en largeur, 30 %–78 % en hauteur : la carte
  // occupe le bas-gauche de ce cadre (≈ 64 %–75 % de l'image).
  carte: { x: 0, y: 72, w: 100, h: 22 },
  carteScale: 1.6,
  carteFond: 'rgba(0,0,0,0.55)',
  valeurEclaircie: 0.5,
};

/** Mêle `part` de blanc à une couleur #rrggbb (accent lisible sur fond sombre). Pure. */
export function eclaircir(hex: string | null | undefined, part: number): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * part));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function miseEnPageSurimpression(profil: NomProfilMontage | string | null | undefined): MiseEnPageSurimpression | null {
  if (profil !== 'CARDIO_DANCE' && profil !== 'EVENT_IMMERSIVE') return null;
  // La règle éditoriale (`TEXTES_PROFILS`) dit « cartes en bas-gauche » :
  // la boîte ci-dessus en est la traduction ; un autre réglage = autre boîte.
  return TEXTES_PROFILS[profil].cartes.position === 'bas-gauche' ? DYNAMIQUE : { ...DYNAMIQUE, carte: { x: 13, y: 40, w: 74, h: 22 } };
}

/** Les champs de design que la mise en page renseigne (Remotion / composants partagés). */
export interface DesignSurimpression {
  titlePos?: { x: number; y: number };
  titleScale?: number;
  subtitleScale?: number;
  ctaPos?: { x: number; y: number };
  ctaScale?: number;
  cardBoxes?: Record<string, BoiteCarte> | null;
  cardsTypography?: { scale?: number } & Record<string, unknown>;
  cardBackground?: string | null;
  /** Couleur de la valeur des cartes (sinon `gradientEnd`). */
  cardValueColor?: string | null;
  gradientEnd?: string;
}

/**
 * Applique la mise en page au design d'un montage en surimpression. Les
 * échelles choisies par l'utilisateur sont MULTIPLIÉES (jamais écrasées).
 * La carte est rendue seule (`c0`) : une seule boîte suffit.
 */
export function appliquerMiseEnPageSurimpression<T extends object>(design: T, profil: string | null | undefined): T {
  const m = miseEnPageSurimpression(profil);
  if (!m) return design;
  const d = design as DesignSurimpression;
  return {
    ...design,
    titlePos: m.titlePos,
    titleScale: (d.titleScale ?? 1) * m.titleScale,
    subtitleScale: (d.subtitleScale ?? 1) * m.subtitleScale,
    ctaPos: m.ctaPos,
    ctaScale: (d.ctaScale ?? 1) * m.ctaScale,
    cardBoxes: { c0: m.carte },
    cardsTypography: { ...(d.cardsTypography ?? {}), scale: (d.cardsTypography?.scale ?? 1) * m.carteScale },
    cardBackground: m.carteFond,
    cardValueColor: eclaircir(d.gradientEnd ?? '#EC4899', m.valeurEclaircie),
  } as T;
}
