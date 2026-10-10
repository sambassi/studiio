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
import { FONT_RATIO, TEXT_LAYOUT } from '@/lib/creer/designSpec';

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
  /** #502 — panneau sombre derrière le CTA (lisibilité sur n'importe quel plan). */
  ctaFond: string;
  /** #502 — part de blanc mêlée à la couleur de la ligne d'action, sur ce panneau. */
  ctaActionEclaircie: number;
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
  // Contraste mesuré dans le PIRE cas (plan blanc derrière) : titre blanc
  // 5,1:1, ligne d'action éclaircie 3,4:1 — au-dessus du seuil 3:1 du
  // conseiller (`REGLES_LISIBILITE.contrasteMin`).
  ctaFond: 'rgba(0,0,0,0.6)',
  ctaActionEclaircie: 0.6,
};

/** #502 — bande où poser le CTA : la plus CALME mesurée sur les plans de sortie. */
export type BandeCta = 'haut' | 'bas';
/** Bas de la ligne CTA (le cadre s'ancre par le bas, `ctaFrameStyle`). */
const CTA_Y: Record<BandeCta, number> = { bas: 76, haut: 34 };

/** Mêle `part` de blanc à une couleur #rrggbb (accent lisible sur fond sombre). Pure. */
export function eclaircir(hex: string | null | undefined, part: number): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * part));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function miseEnPageSurimpression(
  profil: NomProfilMontage | string | null | undefined,
  options: { ctaBande?: BandeCta | null } = {},
): MiseEnPageSurimpression | null {
  if (profil !== 'CARDIO_DANCE' && profil !== 'EVENT_IMMERSIVE') return null;
  return miseEnPageDuProfil(profil, options);
}

/**
 * La mise en page d'un profil, SANS la question « ce profil passe-t-il en
 * surimpression ? » (celle de `miseEnPageSurimpression`, qui reste la porte
 * de Créer). Les cartes suivent la position éditoriale du profil
 * (`TEXTES_PROFILS`) : bas-gauche → la boîte `DYNAMIQUE`, sinon le centre. Pur.
 */
function miseEnPageDuProfil(profil: string | null | undefined, options: { ctaBande?: BandeCta | null }): MiseEnPageSurimpression {
  const regle = (TEXTES_PROFILS as Record<string, { cartes: { position: string } } | undefined>)[profil ?? ''] ?? TEXTES_PROFILS.STANDARD;
  // La règle éditoriale (`TEXTES_PROFILS`) dit « cartes en bas-gauche » :
  // la boîte ci-dessus en est la traduction ; un autre réglage = autre boîte.
  const base = regle.cartes.position === 'bas-gauche' ? DYNAMIQUE : { ...DYNAMIQUE, carte: { x: 13, y: 40, w: 74, h: 22 } };
  // Sans mesure : en bas, comme avant.
  return options.ctaBande ? { ...base, ctaPos: { x: 50, y: CTA_Y[options.ctaBande] } } : base;
}

// ── CTA COMPLET (#504) ───────────────────────────────────────────────────
/** Largeur du cadre CTA (part de la largeur) : marges ≥ 10 % de chaque côté. */
export const CTA_LARGEUR_PART = TEXT_LAYOUT.ctaWidth / 100;
/** Largeur moyenne PRUDENTE d'un caractère en majuscules grasses (em). */
const EM_CTA = 0.68;

/**
 * Échelle du CTA pour que le mot le plus long — une URL comme
 * « AFROBOOST.COM. » — tienne ENTIER sur une ligne dans la largeur utile
 * (cadre moins le rembourrage du panneau) : retour à la ligne par mots, jamais
 * de coupure de « .com », jamais d'ellipse. Réduction bornée par la
 * lisibilité (ligne d'action ≥ 34 px). Pur.
 */
export function ajusterCta(p: {
  texte: string; sousTexte?: string | null; echelle: number; largeur: number;
  ratioTexte: number; ratioSousTexte: number; panneau?: boolean;
}): number {
  const utile = p.largeur * CTA_LARGEUR_PART - (p.panneau ? 2 * p.largeur * 0.04 : 0);
  const plusLong = (t: string | null | undefined) => Math.max(0, ...(t ?? '').trim().split(/\s+/).map((m) => m.length));
  const tient = (e: number) => plusLong(p.texte) * EM_CTA * p.largeur * p.ratioTexte * e <= utile
    && plusLong(p.sousTexte) * EM_CTA * p.largeur * p.ratioSousTexte * e <= utile;
  // Plancher : la ligne d'action reste lisible (≥ 34 px sur une image 1080 px).
  const plancher = Math.min(p.echelle, 34 / (p.largeur * p.ratioSousTexte));
  let e = p.echelle;
  while (e > plancher && !tient(e)) e = Math.max(plancher, e * 0.95);
  return e;
}

// ── ACCROCHE (#502) ──────────────────────────────────────────────────────
/** Hauteur maximale du bloc titre + sous-titre (part de la hauteur de l'image). */
export const ACCROCHE_HAUTEUR_MAX = 0.14;
/** Tailles minimales lisibles (px, image 1080×1920) : titre, sous-titre. */
const ACCROCHE_MIN_PX = { titre: 64, sousTitre: 34 };

/**
 * Échelles de l'accroche pour que titre + sous-titre tiennent dans
 * `ACCROCHE_HAUTEUR_MAX` de la hauteur, sans passer sous une taille lisible.
 * Estimation PRUDENTE (largeur moyenne des caractères 0,6 em), mêmes ratios
 * que `SequenceTitle`. `echelleSousTitre` est le multiplicateur du sous-titre
 * (sa taille = titre × ce multiplicateur). Pur.
 */
export function ajusterAccroche(p: {
  titre: string; sousTitre?: string | null; echelleTitre: number; echelleSousTitre: number;
  largeur: number; hauteur: number;
  /** Ratios de police du format (`FONT_RATIO[format]`). */
  ratioTitre: number; ratioSousTitre: number;
  /** Largeur du cadre titre (part de la largeur). */
  partLargeur?: number;
  interligneTitre?: number;
}): { echelleTitre: number; echelleSousTitre: number } {
  const largeurUtile = p.largeur * (p.partLargeur ?? 0.84);
  const lignes = (texte: string, px: number) => {
    let n = 1; let ligne = 0;
    for (const mot of texte.trim().split(/\s+/).filter(Boolean)) {
      const w = (mot.length + 1) * 0.6 * px;
      if (ligne > 0 && ligne + w > largeurUtile) { n += 1; ligne = w; } else ligne += w;
    }
    return texte.trim() ? n : 0;
  };
  const hauteurBloc = (e: number) => {
    const pt = p.largeur * p.ratioTitre * e;
    const ps = p.largeur * p.ratioSousTitre * e * p.echelleSousTitre;
    return lignes(p.titre, pt) * pt * (p.interligneTitre ?? 1.1) + lignes(p.sousTitre ?? '', ps) * ps * 1.25 + (p.sousTitre ? ps * 0.4 : 0);
  };
  const plafond = ACCROCHE_HAUTEUR_MAX * p.hauteur;
  const minTitre = ACCROCHE_MIN_PX.titre / (p.largeur * p.ratioTitre);
  const minSous = ACCROCHE_MIN_PX.sousTitre / (p.largeur * p.ratioSousTitre * p.echelleSousTitre);
  const plancher = Math.min(p.echelleTitre, Math.max(minTitre, minSous));
  let e = p.echelleTitre;
  while (e > plancher && hauteurBloc(e) > plafond) e = Math.max(plancher, e * 0.95);
  return { echelleTitre: e, echelleSousTitre: p.echelleSousTitre };
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
  /** #502 — panneau derrière le CTA. */
  ctaBackground?: string | null;
  ctaSubColor?: string;
  ctaText?: string;
  ctaSubText?: string;
  title?: string;
  subtitle?: string;
  /** Couleur de la valeur des cartes (sinon `gradientEnd`). */
  cardValueColor?: string | null;
  gradientEnd?: string;
}

/**
 * Applique la mise en page au design d'un montage en surimpression. Les
 * échelles choisies par l'utilisateur sont MULTIPLIÉES (jamais écrasées).
 * La carte est rendue seule (`c0`) : une seule boîte suffit.
 *
 * ⚠️ APPELÉE SEULEMENT QUAND IL Y A DES SURIMPRESSIONS (Autopilote,
 * `if (overlays)`). Elles existent aussi hors profils dynamiques : l'AVATAR
 * passe toujours ses textes en surimpression, quel que soit le profil du
 * thème (tutoriel, standard…). Sans mise en page, ces montages gardaient
 * les positions plein écran — cartes en bandeau minuscule au milieu de
 * l'image (texte ≈ 10 px, contraste < 3:1 mesuré au rendu réel) et CTA à
 * 92 %, sous l'interface des réseaux. La mise en page du profil s'applique
 * donc toujours ici.
 */
export function appliquerMiseEnPageSurimpression<T extends object>(
  design: T, profil: string | null | undefined, options: { ctaBande?: BandeCta | null } = {},
): T {
  const m = miseEnPageDuProfil(profil, options);
  const d = design as DesignSurimpression;
  // Accroche bornée en hauteur (#502) — la MÊME règle que Créer.
  const accroche = ajusterAccroche({
    titre: d.title ?? '', sousTitre: d.subtitle ?? null,
    echelleTitre: (d.titleScale ?? 1) * m.titleScale, echelleSousTitre: (d.subtitleScale ?? 1) * m.subtitleScale,
    largeur: 1080, hauteur: 1920, ratioTitre: FONT_RATIO['9:16'].title, ratioSousTitre: FONT_RATIO['9:16'].subtitle,
  });
  const ctaEchelle = ajusterCta({
    texte: d.ctaText ?? '', sousTexte: d.ctaSubText ?? null, echelle: (d.ctaScale ?? 1) * m.ctaScale, largeur: 1080,
    ratioTexte: FONT_RATIO['9:16'].cta, ratioSousTexte: FONT_RATIO['9:16'].ctaSub, panneau: true,
  });
  return {
    ...design,
    titlePos: m.titlePos,
    titleScale: accroche.echelleTitre,
    subtitleScale: accroche.echelleSousTitre,
    ctaBackground: m.ctaFond,
    ctaSubColor: eclaircir(d.ctaSubColor ?? '#EC4899', m.ctaActionEclaircie) ?? d.ctaSubColor,
    ctaPos: m.ctaPos,
    ctaScale: ctaEchelle,
    cardBoxes: { c0: m.carte },
    cardsTypography: { ...(d.cardsTypography ?? {}), scale: (d.cardsTypography?.scale ?? 1) * m.carteScale },
    cardBackground: m.carteFond,
    cardValueColor: eclaircir(d.gradientEnd ?? '#EC4899', m.valeurEclaircie),
  } as T;
}

// ── BADGES (#499) ─────────────────────────────────────────────────────────
// Rendu réel DANSE (6) : des badges « -76% », « 3-en-1 »… SANS libellé. La
// carte était une ligne icône | libellé | valeur où le libellé (base 0,
// ellipse) cédait toute la place : plus l'échelle des cartes montait (× 1,6
// en surimpression), plus il se réduisait — jusqu'à « … » seul (mesuré dans
// Chromium : 57 px pour « OS RENFORCÉS » à l'échelle 3,5).

/** Un badge s'affiche seulement s'il a un TITRE et une VALEUR. */
export function badgeValide(c: { title?: string | null; value?: string | null } | null | undefined): boolean {
  return !!c && !!(c.title ?? '').trim() && !!(c.value ?? '').trim();
}

/**
 * Largeur moyenne d'un caractère, en em — majuscules grasses, police large
 * (Poppins). Volontairement prudente : une police plus étroite ne fait que
 * laisser de la marge.
 */
const EM_CARACTERE = 0.7;

export interface AjustementBadge {
  /** Échelle à appliquer au texte et à l'icône (≤ l'échelle demandée). */
  echelle: number;
  /** L'icône est gardée si la place le permet (sinon texte seul). */
  icone: boolean;
}

/**
 * Taille d'un badge pour qu'il montre TITRE (≤ 2 lignes, mots entiers) et
 * VALEUR (1 ligne) dans `largeurPx`. Réduit l'échelle d'abord (jusqu'à la
 * moitié), puis retire l'icône. Jamais la valeur seule. Pur.
 */
export function ajusterBadge(p: {
  titre: string; valeur: string; largeurPx: number; echelle: number;
  /** Tailles à l'échelle 1, en px : texte du titre, valeur, icône, écart, rembourrage horizontal (par côté). */
  texte: number; valeurPx: number; icone: number; ecart: number; padX: number;
}): AjustementBadge {
  const motLePlusLong = Math.max(0, ...p.titre.trim().split(/\s+/).map((m) => m.length));
  const tient = (s: number, icone: boolean) => {
    const dispo = p.largeurPx - 2 * p.padX - (icone ? p.icone * s + p.ecart : 0);
    const em = (n: number, px: number) => n * EM_CARACTERE * px * s;
    return dispo > 0
      && em(p.valeur.trim().length, p.valeurPx) <= dispo
      && em(motLePlusLong, p.texte) <= dispo
      && em(p.titre.trim().length, p.texte) <= 2 * dispo;
  };
  const min = p.echelle * 0.5;
  for (const icone of [true, false]) {
    for (let s = p.echelle; s >= min - 1e-9; s *= 0.95) if (tient(s, icone)) return { echelle: s, icone };
  }
  return { echelle: min, icone: false };
}
