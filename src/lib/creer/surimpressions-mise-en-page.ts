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
import { FONT_RATIO, TEXT_LAYOUT, VIDEO_SIZE, CARDS_FRAME, cardRatios, type DesignFormat } from '@/lib/creer/designSpec';
import { ZONE_SURE_916, ctaBasPourBandeHaute916 } from '@/lib/creer/zones-sures-916';

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
/**
 * Bas de la ligne CTA (le cadre s'ancre par le bas, `ctaFrameStyle`).
 * `haut: 34` ne reste que le repli HORS 9:16 (ou sans texte de CTA connu) :
 * en 9:16 le CTA haut s'aligne par son HAUT sur la zone sûre — ancré à 34 %
 * par le bas, un CTA long remontait sous la barre des réseaux (mesuré : haut
 * du panneau à 10 % pour « Réservez votre bilan sommeil gratuit sur
 * afroboost.com »), un CTA court flottait au milieu de l'image, sous la
 * bande calme mesurée (rangées 0–1 = 0–25 %, `zone-calme.ts`).
 */
const CTA_Y: Record<BandeCta, number> = { bas: 76, haut: 34 };

/**
 * 9:16 — la mise en page dynamique tenue dans la zone sûre des réseaux
 * (`zones-sures-916.ts`) : l'accroche commence SOUS les barres du haut (7 % →
 * 12 %), la carte bas-gauche s'arrête au rail d'actions (bord droit 92 % →
 * 85 %). Tout le reste (tailles, fonds, contrastes, CTA bas) est celui de
 * `DYNAMIQUE`, inchangé.
 */
const LARGEUR_CARTE_916 = Math.floor(((ZONE_SURE_916.droite - parseFloat(CARDS_FRAME.left)) / (100 - parseFloat(CARDS_FRAME.left) - parseFloat(CARDS_FRAME.right))) * 1000) / 10;
const DYNAMIQUE_916: MiseEnPageSurimpression = {
  ...DYNAMIQUE,
  titlePos: { x: DYNAMIQUE.titlePos.x, y: ZONE_SURE_916.haut },
  carte: { ...DYNAMIQUE.carte, w: Math.min(DYNAMIQUE.carte.w, LARGEUR_CARTE_916) },
};

/** Le texte du CTA, pour placer la bande haute d'après sa hauteur (9:16). */
export interface CtaAPlacer { texte?: string | null; sousTexte?: string | null; echelle?: number | null }

/**
 * Bas du CTA de la bande HAUTE, en 9:16 : son haut sur la zone sûre. Même
 * échelle que celle que le CTA recevra au rendu (`ajusterCta`, panneau), même
 * estimation de hauteur que les contrôles (`hauteurCta`). Pur.
 */
function ctaHaut916(cta: CtaAPlacer, ctaScale: number): number {
  const R = FONT_RATIO['9:16'];
  const { w: W, h: H } = VIDEO_SIZE['9:16'];
  const texte = cta.texte ?? '';
  const sousTexte = cta.sousTexte ?? CTA_SOUS_TEXTE_DEFAUT;
  const echelle = ajusterCta({
    texte, sousTexte: cta.sousTexte ?? null, echelle: (cta.echelle ?? 1) * ctaScale, largeur: W,
    ratioTexte: R.cta, ratioSousTexte: R.ctaSub, panneau: true,
  });
  const hauteur = hauteurCta({
    texte, sousTexte, echelle, largeur: W, partLargeur: TEXT_LAYOUT.ctaWidth / 100, ratioTexte: R.cta, ratioSousTexte: R.ctaSub,
  });
  return ctaBasPourBandeHaute916((hauteur / H) * 100);
}

/** Mêle `part` de blanc à une couleur #rrggbb (accent lisible sur fond sombre). Pure. */
export function eclaircir(hex: string | null | undefined, part: number): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * part));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Options de placement. `format` absent = 9:16 (le format des surimpressions,
 * comme `appliquerMiseEnPageSurimpression`) ; tout autre format garde les
 * positions d'avant. `cta` : le texte du CTA, pour poser la bande haute.
 */
export interface OptionsMiseEnPage { ctaBande?: BandeCta | null; format?: DesignFormat | null; cta?: CtaAPlacer | null }

export function miseEnPageSurimpression(
  profil: NomProfilMontage | string | null | undefined,
  options: OptionsMiseEnPage = {},
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
function miseEnPageDuProfil(profil: string | null | undefined, options: OptionsMiseEnPage): MiseEnPageSurimpression {
  const regle = (TEXTES_PROFILS as Record<string, { cartes: { position: string } } | undefined>)[profil ?? ''] ?? TEXTES_PROFILS.STANDARD;
  // 9:16 (ou format absent) : la variante tenue dans la zone sûre des réseaux.
  const vertical = !options.format || options.format === '9:16';
  const dyn = vertical ? DYNAMIQUE_916 : DYNAMIQUE;
  // La règle éditoriale (`TEXTES_PROFILS`) dit « cartes en bas-gauche » :
  // la boîte ci-dessus en est la traduction ; un autre réglage = autre boîte
  // (centrée, 19–81 % : déjà hors du rail d'actions).
  const base = regle.cartes.position === 'bas-gauche' ? dyn : { ...dyn, carte: { x: 13, y: 40, w: 74, h: 22 } };
  // Sans mesure : en bas, comme avant.
  if (!options.ctaBande) return base;
  const y = options.ctaBande === 'haut' && vertical && options.cta
    ? ctaHaut916(options.cta, base.ctaScale)
    : CTA_Y[options.ctaBande];
  return { ...base, ctaPos: { x: 50, y } };
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
  /** Largeur du cadre CTA (part de la largeur). Absente : `CTA_LARGEUR_PART`. */
  partLargeur?: number;
}): number {
  const utile = p.largeur * (p.partLargeur ?? CTA_LARGEUR_PART) - (p.panneau ? 2 * p.largeur * 0.04 : 0);
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

/** Lignes estimées d'un texte (0,6 em par caractère, mots entiers). Pur. */
function lignesEstimees(texte: string, px: number, largeurUtile: number, em = 0.6): number {
  let n = 1; let ligne = 0;
  for (const mot of texte.trim().split(/\s+/).filter(Boolean)) {
    const w = (mot.length + 1) * em * px;
    if (ligne > 0 && ligne + w > largeurUtile) { n += 1; ligne = w; } else ligne += w;
  }
  return texte.trim() ? n : 0;
}

/** Hauteur estimée (px) du bloc titre + sous-titre — la mesure d'`ajusterAccroche`. Pur. */
export function hauteurAccroche(p: {
  titre: string; sousTitre?: string | null; echelleTitre: number; echelleSousTitre: number;
  largeur: number; ratioTitre: number; ratioSousTitre: number; partLargeur?: number; interligneTitre?: number;
}): number {
  const largeurUtile = p.largeur * (p.partLargeur ?? 0.84);
  const pt = p.largeur * p.ratioTitre * p.echelleTitre;
  const ps = p.largeur * p.ratioSousTitre * p.echelleTitre * p.echelleSousTitre;
  return lignesEstimees(p.titre, pt, largeurUtile) * pt * (p.interligneTitre ?? 1.1)
    + lignesEstimees(p.sousTitre ?? '', ps, largeurUtile) * ps * 1.25 + (p.sousTitre ? ps * 0.4 : 0);
}

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
  /** Plafond du bloc (part de la hauteur). Absent : `ACCROCHE_HAUTEUR_MAX` (9:16). */
  hauteurMax?: number;
}): { echelleTitre: number; echelleSousTitre: number } {
  const hauteurBloc = (e: number) => hauteurAccroche({ ...p, echelleTitre: e });
  const plafond = (p.hauteurMax ?? ACCROCHE_HAUTEUR_MAX) * p.hauteur;
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
 *
 * FORMAT : celui du design (`format`, défaut 9:16) ou `options.format`. Le
 * 9:16 garde la mise en page calibrée et mesurée, tenue dans la zone sûre des
 * réseaux (`DYNAMIQUE_916` : accroche à 12 %, carte jusqu'à 85 %, CTA haut
 * aligné par son haut) ; le 16:9 et le 1:1 ont la leur (`MISE_EN_PAGE_LARGE`),
 * inchangée, qui laisse libre le visage de l'avatar (`ZONE_VISAGE`).
 */
export function appliquerMiseEnPageSurimpression<T extends object>(
  design: T, profil: string | null | undefined,
  options: { ctaBande?: BandeCta | null; format?: DesignFormat | null } = {},
): T {
  const d = design as DesignSurimpression & { format?: string | null };
  const format = options.format ?? d.format;
  if (format === '16:9' || format === '1:1') return appliquerMiseEnPageLarge(design, profil, format);
  const m = miseEnPageDuProfil(profil, {
    ctaBande: options.ctaBande, format: '9:16',
    cta: { texte: d.ctaText ?? '', sousTexte: d.ctaSubText ?? null, echelle: d.ctaScale ?? 1 },
  });
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

// ── FORMATS LARGES (16:9, 1:1) ───────────────────────────────────────────
//
// La mise en page ci-dessus est calibrée pour le 9:16 (accroche en haut sur
// toute la largeur, CTA remonté au centre). Posée telle quelle sur une image
// large, elle tombait sur le visage de l'avatar — mesuré au rendu réel :
// accroche sur 26–27 % du visage et CTA sur 63 % en 16:9, accroche sur
// 12–15 % en 1:1. Les formats larges ont donc leur propre placement, avec
// les MÊMES outils (positions en %, `ajusterAccroche`, `ajusterCta`,
// `ajusterBadge`, `FONT_RATIO` du format) — pas de nouveau moteur.

/** Ellipse en % de l'image (centre, demi-axes). */
export interface Ellipse { cx: number; cy: number; rx: number; ry: number }

/**
 * ZONE PROTÉGÉE — le visage d'un présentateur cadré AU CENTRE (avatar),
 * dans l'image de sortie, en % (ellipse).
 *
 * Studiio ne détecte pas les visages (voir `zone-calme.ts`) : c'est une
 * constante de CADRAGE. L'avatar remplit l'image en `cover`, centré ; la tête
 * occupe le haut-centre — environ le tiers supérieur à la moitié de la
 * hauteur, sur un cinquième (16:9) à un tiers (1:1, 9:16) de la largeur.
 * Les valeurs englobent le visage de la mire de validation des rendus
 * (16:9 : x 41,5–58,5 %, y 13–47 % ; 1:1 : x 37–63 %, y 13–43 % ;
 * 9:16 : x 33–67 %, y 17–39 %) avec une marge pour les formats larges.
 */
export const ZONE_VISAGE: Record<DesignFormat, Ellipse> = {
  '9:16': { cx: 50, cy: 28, rx: 17, ry: 11 },
  '16:9': { cx: 50, cy: 30, rx: 10, ry: 20 },
  '1:1': { cx: 50, cy: 28, rx: 15, ry: 17 },
};

interface MiseEnPageLarge {
  /** Bord gauche / haut du bloc titre, et sa largeur (% de l'image). */
  titlePos: { x: number; y: number };
  titleWidth: number;
  /** Plafond du bloc titre (part de la hauteur). */
  titleHauteurMax: number;
  titleScale: number;
  subtitleScale: number;
  /** Boîte de la carte, en % du cadre des cartes (`CARDS_FRAME`). */
  carte: BoiteCarte;
  carteScale: number;
  /** Bas-centre du CTA, sa largeur (% de l'image) et le plafond de sa hauteur. */
  ctaPos: { x: number; y: number };
  ctaWidth: number;
  ctaHauteurMax: number;
  ctaScale: number;
}

/** % de l'image → % du cadre des cartes (8 %–92 % × 30 %–78 %). */
const CADRE = { x: parseFloat(CARDS_FRAME.left), y: parseFloat(CARDS_FRAME.top), w: 100 - parseFloat(CARDS_FRAME.left) - parseFloat(CARDS_FRAME.right), h: 100 - parseFloat(CARDS_FRAME.top) - parseFloat(CARDS_FRAME.bottom) };
const versCadre = (x0: number, y0: number, x1: number, h: number): BoiteCarte => ({
  x: Math.round(((x0 - CADRE.x) / CADRE.w) * 1000) / 10,
  y: Math.round(((y0 - CADRE.y) / CADRE.h) * 1000) / 10,
  w: Math.round(((x1 - x0) / CADRE.w) * 1000) / 10,
  h: Math.round((h / CADRE.h) * 1000) / 10,
});

/**
 * Placement des formats larges (% de l'image). Marges ≥ 5 % partout.
 *
 *   16:9 : accroche en colonne GAUCHE (6–37 %, depuis 8 % du haut) ;
 *          carte en colonne DROITE (62–94 %, depuis 30 %) ;
 *          CTA en bande BASSE centrée (18–82 %, bas à 92 %, haut ≥ 60 %).
 *   1:1  : accroche en bande BASSE (6–94 %, depuis 50 %) ;
 *          carte en bande BASSE (8–92 %, depuis 50 %) ;
 *          CTA en bande BASSE (8–92 %, bas à 93 %, haut ≥ 57 %).
 * Le visage (`ZONE_VISAGE`) est au centre-haut : ni colonne latérale ni
 * bande basse ne le recouvrent. En 16:9 les trois boîtes sont disjointes.
 * En 1:1 les colonnes latérales sont trop étroites (≤ 29 % : badge mesuré
 * au rendu à ≈ 16 px de texte, icône retirée) : les trois textes partagent
 * la bande basse — la seule place lisible sous le visage — et ne sont
 * JAMAIS affichés ensemble (accroche, puis cartes une à une, puis CTA :
 * `planOverlays`).
 */
const MISE_EN_PAGE_LARGE: Record<'16:9' | '1:1', MiseEnPageLarge> = {
  '16:9': {
    titlePos: { x: 6, y: 8 }, titleWidth: 31, titleHauteurMax: 0.42, titleScale: 1.3, subtitleScale: 0.85,
    carte: versCadre(62, 30, 94, 12), carteScale: 2,
    ctaPos: { x: 50, y: 92 }, ctaWidth: 64, ctaHauteurMax: 0.32, ctaScale: 1.6,
  },
  '1:1': {
    titlePos: { x: 6, y: 50 }, titleWidth: 88, titleHauteurMax: 0.3, titleScale: 1.6, subtitleScale: 1,
    carte: versCadre(8, 50, 92, 12), carteScale: 2.6,
    ctaPos: { x: 50, y: 93 }, ctaWidth: 84, ctaHauteurMax: 0.36, ctaScale: 1.6,
  },
};

/**
 * Sous-texte du CTA quand le design n'en porte pas : la composition Remotion
 * le pose par défaut (`defaultProps` de `creer-simple-montage`,
 * remotion/index.tsx). Les estimations de hauteur en tiennent compte.
 */
export const CTA_SOUS_TEXTE_DEFAUT = 'LIEN EN BIO';

/** Hauteur estimée (px) du CTA sur panneau — mêmes ratios que `SequenceCta`. Pur. */
export function hauteurCta(p: {
  texte: string; sousTexte?: string | null; echelle: number; largeur: number; partLargeur: number;
  ratioTexte: number; ratioSousTexte: number;
}): number {
  const pad = { x: p.largeur * 0.04, y: p.largeur * 0.03 };
  const utile = p.largeur * p.partLargeur - 2 * pad.x;
  const pt = p.largeur * p.ratioTexte * p.echelle;
  const ps = p.largeur * p.ratioSousTexte * p.echelle;
  return lignesEstimees(p.texte, pt, utile, EM_CTA) * pt * 1.2
    + (p.sousTexte?.trim() ? lignesEstimees(p.sousTexte, ps, utile, EM_CTA) * ps * 1.2 + p.largeur * (4 / 320) : 0)
    + 2 * pad.y;
}

/** Les champs ajoutés par la mise en page large (absents en 9:16). */
export interface DesignSurimpressionLarge extends DesignSurimpression {
  titleWidth?: number;
  ctaWidth?: number;
}

function appliquerMiseEnPageLarge<T extends object>(design: T, profil: string | null | undefined, format: '16:9' | '1:1'): T {
  // Couleurs et fonds : ceux du profil (contraste mesuré), seul le placement
  // change. La bande calme mesurée (`ctaBande`) n'est PAS suivie : en format
  // large, la bande HAUTE est celle du visage — le CTA reste en bande basse.
  const m = miseEnPageDuProfil(profil, {});
  const L = MISE_EN_PAGE_LARGE[format];
  const { w: W, h: H } = VIDEO_SIZE[format];
  const R = FONT_RATIO[format];
  const d = design as DesignSurimpression;
  const accroche = ajusterAccroche({
    titre: d.title ?? '', sousTitre: d.subtitle ?? null,
    echelleTitre: (d.titleScale ?? 1) * L.titleScale, echelleSousTitre: (d.subtitleScale ?? 1) * L.subtitleScale,
    largeur: W, hauteur: H, ratioTitre: R.title, ratioSousTitre: R.subtitle,
    partLargeur: L.titleWidth / 100, hauteurMax: L.titleHauteurMax,
  });
  // CTA : le mot le plus long tient sur une ligne (`ajusterCta`), puis le
  // bloc tient sous le visage (plafond de hauteur), sans passer sous une
  // ligne d'action lisible (≥ 34 px).
  const cta = { texte: d.ctaText ?? '', sousTexte: d.ctaSubText ?? CTA_SOUS_TEXTE_DEFAUT, largeur: W, ratioTexte: R.cta, ratioSousTexte: R.ctaSub };
  let ctaEchelle = ajusterCta({ ...cta, echelle: (d.ctaScale ?? 1) * L.ctaScale, panneau: true, partLargeur: L.ctaWidth / 100 });
  const plancherCta = Math.min(ctaEchelle, 34 / (W * R.ctaSub));
  while (ctaEchelle > plancherCta && hauteurCta({ ...cta, echelle: ctaEchelle, partLargeur: L.ctaWidth / 100 }) > L.ctaHauteurMax * H) {
    ctaEchelle = Math.max(plancherCta, ctaEchelle * 0.95);
  }
  return {
    ...design,
    titlePos: L.titlePos,
    titleWidth: L.titleWidth,
    titleScale: accroche.echelleTitre,
    subtitleScale: accroche.echelleSousTitre,
    ctaBackground: m.ctaFond,
    ctaSubColor: eclaircir(d.ctaSubColor ?? '#EC4899', m.ctaActionEclaircie) ?? d.ctaSubColor,
    ctaPos: L.ctaPos,
    ctaWidth: L.ctaWidth,
    ctaScale: ctaEchelle,
    cardBoxes: { c0: L.carte },
    cardsTypography: { ...(d.cardsTypography ?? {}), scale: (d.cardsTypography?.scale ?? 1) * L.carteScale },
    cardBackground: m.carteFond,
    cardValueColor: eclaircir(d.gradientEnd ?? '#EC4899', m.valeurEclaircie),
  } as T;
}

/** Boîte en % de l'image (x0/y0 = coin haut-gauche). */
export interface BoiteImage { x0: number; y0: number; x1: number; y1: number }

/**
 * Boîtes ESTIMÉES (en % de l'image) du titre, de la carte et du CTA d'un
 * design déjà mis en page — pour vérifier qu'elles ne couvrent pas le visage
 * et ne se chevauchent pas. Mêmes estimations prudentes que les ajustements
 * (0,6 em / 0,68 em par caractère) ; la carte compte sa valeur et deux lignes
 * de titre. Pur.
 */
export function boitesSurimpression(design: object, format: DesignFormat): { titre: BoiteImage; carte: BoiteImage; cta: BoiteImage } {
  const d = design as DesignSurimpressionLarge & { cards?: Array<{ title?: string; label?: string; value?: string }> };
  const { w: W, h: H } = VIDEO_SIZE[format];
  const R = FONT_RATIO[format];
  const tPos = d.titlePos ?? TEXT_LAYOUT.titlePos;
  const tW = d.titleWidth ?? TEXT_LAYOUT.titleWidth;
  const hT = hauteurAccroche({
    titre: d.title ?? '', sousTitre: d.subtitle ?? null, echelleTitre: d.titleScale ?? 1, echelleSousTitre: d.subtitleScale ?? 1,
    largeur: W, ratioTitre: R.title, ratioSousTitre: R.subtitle, partLargeur: tW / 100,
  }) / H * 100;
  const cPos = d.ctaPos ?? TEXT_LAYOUT.ctaPos;
  const cW = d.ctaWidth ?? TEXT_LAYOUT.ctaWidth;
  const hC = hauteurCta({
    texte: d.ctaText ?? '', sousTexte: d.ctaSubText ?? CTA_SOUS_TEXTE_DEFAUT, echelle: d.ctaScale ?? 1, largeur: W, partLargeur: cW / 100,
    ratioTexte: R.cta, ratioSousTexte: R.ctaSub,
  }) / H * 100;
  const b = d.cardBoxes?.c0 ?? { x: 0, y: 0, w: 100, h: 22 };
  const x0 = CADRE.x + (b.x / 100) * CADRE.w; const y0 = CADRE.y + (b.y / 100) * CADRE.h;
  const x1 = x0 + (b.w / 100) * CADRE.w;
  // Hauteur de la carte : la plus grande des cartes (valeur + 2 lignes de titre), au moins sa boîte.
  const CR = cardRatios(format !== '9:16');
  const ech = d.cardsTypography?.scale ?? 1;
  const hCarteMax = Math.max(0, ...(d.cards ?? [{ title: 'x', value: 'x' }]).map((c) => {
    const aj = ajusterBadge({
      titre: c.title ?? c.label ?? '', valeur: c.value ?? '', largeurPx: W * 0.84 * (b.w / 100), echelle: ech,
      texte: W * CR.text, valeurPx: W * CR.value, icone: W * CR.icon, ecart: W * CR.gap, padX: W * CR.padX,
    });
    return (2 * W * CR.padY + aj.echelle * (W * CR.value * 1.3 + 2 * W * CR.text * 1.3)) / H * 100;
  }));
  const hK = Math.max((b.h / 100) * CADRE.h, hCarteMax);
  return {
    titre: { x0: tPos.x, y0: tPos.y, x1: tPos.x + tW, y1: tPos.y + hT },
    carte: { x0, y0, x1, y1: y0 + hK },
    cta: { x0: cPos.x - cW / 2, y0: cPos.y - hC, x1: cPos.x + cW / 2, y1: cPos.y },
  };
}

/** Part (0..1) de l'ellipse `e` couverte par la boîte `b` (échantillonnage 200 × 200). Pur. */
export function couvertureVisage(b: BoiteImage, e: Ellipse): number {
  let dans = 0; let couvert = 0;
  const N = 200;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = e.cx - e.rx + ((i + 0.5) / N) * 2 * e.rx;
      const y = e.cy - e.ry + ((j + 0.5) / N) * 2 * e.ry;
      if (((x - e.cx) / e.rx) ** 2 + ((y - e.cy) / e.ry) ** 2 > 1) continue;
      dans += 1;
      if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) couvert += 1;
    }
  }
  return dans ? couvert / dans : 0;
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
