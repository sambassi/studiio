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
import { FOND_TEXTE_SUR_IMAGE, fondTexteSurImage } from '@/lib/creer/contraste';
import { ZONE_SURE_916, ctaBasPourBandeHaute916, chassePolice, enCapitales, echelleMaxMot, lignesRepliees } from '@/lib/creer/zones-sures-916';

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
  /** Fond du cadre de la carte : transparent (contour des glyphes), ou voile discret sur fond clair et chargé. */
  carteFond: string;
  /** Part de blanc mêlée à la couleur d'accent de la valeur (lisible sur le fond sombre). */
  valeurEclaircie: number;
  /** #502 — fond du CTA : transparent (contour des glyphes), ou voile discret sur fond clair et chargé. */
  ctaFond: string;
  /** #502 — part de blanc mêlée à la couleur de la ligne d'action, sur ce panneau. */
  ctaActionEclaircie: number;
  /**
   * Formats larges (16:9, 1:1) SEULEMENT : largeur des cadres titre / CTA (%
   * de l'image), celle de `MISE_EN_PAGE_LARGE`. Absentes en 9:16 : les cadres
   * gardent leur largeur par défaut (`TEXT_LAYOUT`), comme avant.
   */
  titleWidth?: number;
  ctaWidth?: number;
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
  // Texte posé SUR l'image (`contraste.ts`) : aucun aplat — contour fin
  // sombre + ombre serrée autour des glyphes, à la place des pavés opaques
  // d'avant (0,55 / 0,6 : « rectangle gris opaque sur la poitrine », MP4 du
  // 20/10). Voile discret seulement sur un fond connu clair ET chargé
  // (`fondTexte`). Contraste au bord des lettres, plan blanc derrière : texte
  // blanc ≈ 12:1, ligne d'action éclaircie ≥ 4,5:1 (`contrasteSurVoile`).
  carteFond: FOND_TEXTE_SUR_IMAGE,
  valeurEclaircie: 0.5,
  ctaFond: FOND_TEXTE_SUR_IMAGE,
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
 * comme `appliquerMiseEnPageSurimpression`) ; 16:9 et 1:1 reçoivent la mise
 * en page LARGE, la même que l'Autopilote (`MISE_EN_PAGE_LARGE`). `cta` : le
 * texte du CTA, pour poser la bande haute (9:16 seulement).
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
  // 16:9 / 1:1 : la mise en page LARGE, la MÊME que l'Autopilote. Avant,
  // Créer posait ici celle du 9:16 sur une image large (mesuré dans Chromium,
  // 1920 × 1080 : CTA long de la bande haute de −15 % à 34 % — coupé par le
  // haut de l'image —, accroche longue sur 8–90 % de la largeur, au milieu de
  // l'image ; positions différentes de celles de l'Autopilote pour le même
  // format). Couleurs et fonds : ceux du profil, inchangés.
  if (options.format === '16:9' || options.format === '1:1') {
    const L = MISE_EN_PAGE_LARGE[options.format];
    return {
      ...miseEnPageDuProfil(profil, {}),
      titlePos: L.titlePos, titleScale: L.titleScale, subtitleScale: L.subtitleScale,
      ctaPos: L.ctaPos, ctaScale: L.ctaScale,
      carte: L.carte, carteScale: L.carteScale,
      titleWidth: L.titleWidth, ctaWidth: L.ctaWidth,
    };
  }
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
  /** Police du CTA (chasse réelle, `CHASSES`). Absente : Inter, celle du rendu par défaut. */
  police?: string | null;
  /** Interlettrage, en px de l'éditeur (base 320). */
  espacement?: number;
}): number {
  const utile = p.largeur * (p.partLargeur ?? CTA_LARGEUR_PART) - (p.panneau ? 2 * p.largeur * 0.04 : 0);
  const plusLong = (t: string | null | undefined) => Math.max(0, ...(t ?? '').trim().split(/\s+/).map((m) => m.length));
  // Chasse : la plus large de l'estimation historique (0,68 em) et de la
  // police réelle — le CTA est en capitales par défaut.
  const em = Math.max(EM_CTA, chassePolice(p.police ?? 'Inter', true).em);
  const esp = ((p.espacement ?? 0) * p.largeur) / 320;
  const tient = (e: number) => plusLong(p.texte) * (em * p.largeur * p.ratioTexte * e + esp) <= utile
    && plusLong(p.sousTexte) * (em * p.largeur * p.ratioSousTexte * e + esp) <= utile;
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
 * La table `CHASSES` est PRUDENTE (mesures Chromium arrondies ≈ +5 %) : juste
 * pour le « mot le plus long » (un débordement coupe le texte), trop pessimiste
 * pour COMPTER des lignes — la hauteur estimée gonflerait et l'accroche
 * tomberait au plancher lisible sans raison. Les lignes se comptent donc à la
 * chasse MESURÉE (prudente ÷ 1,05).
 */
const CHASSE_MARGE = 1.05;

/**
 * Lignes estimées d'un texte, mots entiers, à la chasse RÉELLE de sa police
 * (`CHASSES`, `lignesRepliees`) — un mot plus large que la ligne compte pour
 * les lignes qu'il occupe, le premier compris. `em` (sans police) : chasse
 * forfaitaire, espace compté comme un caractère comme avant. Pur.
 */
function lignesEstimees(texte: string, px: number, largeurUtile: number, em = 0.6, police?: { nom?: string | null; capitales: boolean; espacement?: number }): number {
  if (!texte.trim()) return 0;
  if (police) {
    const c = chassePolice(police.nom ?? 'Inter', police.capitales);
    return lignesRepliees(texte, px, largeurUtile, { em: c.em / CHASSE_MARGE, espace: c.espace / CHASSE_MARGE }, police.espacement ?? 0);
  }
  return lignesRepliees(texte, px, largeurUtile, { em, espace: em });
}

/** Hauteur estimée (px) du bloc titre + sous-titre — la mesure d'`ajusterAccroche`. Pur. */
export function hauteurAccroche(p: {
  titre: string; sousTitre?: string | null; echelleTitre: number; echelleSousTitre: number;
  largeur: number; ratioTitre: number; ratioSousTitre: number; partLargeur?: number; interligneTitre?: number;
} & PoliceAccroche): number {
  const largeurUtile = p.largeur * (p.partLargeur ?? 0.84);
  const pt = p.largeur * p.ratioTitre * p.echelleTitre;
  const ps = p.largeur * p.ratioSousTitre * p.echelleTitre * p.echelleSousTitre;
  const esp = ((p.espacement ?? 0) * p.largeur) / 320;
  return lignesEstimees(p.titre, pt, largeurUtile, 0.6, { nom: p.police, capitales: enCapitales(p.titre, p.casse), espacement: esp }) * pt * (p.interligneTitre ?? 1.1)
    + lignesEstimees(p.sousTitre ?? '', ps, largeurUtile, 0.6, { nom: p.policeSousTitre ?? p.police, capitales: enCapitales(p.sousTitre, p.casseSousTitre, 'none') }) * ps * 1.25
    + (p.sousTitre ? ps * 0.4 : 0);
}

/**
 * Police et casse du bloc titre (chasse réelle, `CHASSES`). Absentes : Inter
 * en capitales pour le titre (le rendu par défaut de `SequenceTitle`), casse
 * du texte pour le sous-titre.
 */
export interface PoliceAccroche {
  police?: string | null;
  policeSousTitre?: string | null;
  casse?: 'none' | 'uppercase' | 'lowercase';
  casseSousTitre?: 'none' | 'uppercase' | 'lowercase';
  /** Interlettrage du titre, en px de l'éditeur (base 320). */
  espacement?: number;
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
} & PoliceAccroche): { echelleTitre: number; echelleSousTitre: number } {
  const hauteurBloc = (e: number) => hauteurAccroche({ ...p, echelleTitre: e });
  const plafond = (p.hauteurMax ?? ACCROCHE_HAUTEUR_MAX) * p.hauteur;
  const minTitre = ACCROCHE_MIN_PX.titre / (p.largeur * p.ratioTitre);
  const minSous = ACCROCHE_MIN_PX.sousTitre / (p.largeur * p.ratioSousTitre * p.echelleSousTitre);
  const plancher = Math.min(p.echelleTitre, Math.max(minTitre, minSous));
  // LARGEUR d'abord : le mot le plus long (titre comme sous-titre) tient dans
  // le cadre — « MOTIVATION » × 1,9 sortait de l'image sur une seule ligne,
  // que la règle de hauteur laissait passer. Cette contrainte prime sur le
  // plancher lisible, jusqu'au corps `ACCROCHE_MOT_MIN_PX`.
  const largeurUtile = p.largeur * (p.partLargeur ?? 0.84);
  const maxMot = Math.min(
    echelleMaxMot({
      texte: p.titre, pxParEchelle: p.largeur * p.ratioTitre, largeurUtile, police: p.police ?? 'Inter',
      capitales: enCapitales(p.titre, p.casse), espacement: ((p.espacement ?? 0) * p.largeur) / 320,
    }),
    echelleMaxMot({
      texte: p.sousTitre, pxParEchelle: p.largeur * p.ratioSousTitre * p.echelleSousTitre, largeurUtile,
      police: p.policeSousTitre ?? p.police ?? 'Inter', capitales: enCapitales(p.sousTitre, p.casseSousTitre, 'none'),
    }),
  );
  const plancherMot = Math.min(p.echelleTitre, ACCROCHE_MOT_MIN_PX / (p.largeur * p.ratioTitre));
  let e = Math.min(p.echelleTitre, Math.max(plancherMot, Math.floor(maxMot * 999) / 1000));
  while (e > plancher && hauteurBloc(e) > plafond) e = Math.max(plancher, e * 0.95);
  return { echelleTitre: e, echelleSousTitre: p.echelleSousTitre };
}

/** Corps minimal (px, image 1080) auquel un mot trop long peut réduire l'accroche. */
const ACCROCHE_MOT_MIN_PX = 40;

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
  /** Typographie lue pour la chasse réelle (mêmes clés que les props Remotion). */
  titleFont?: string | null;
  subtitleFont?: string | null;
  titleCase?: 'none' | 'uppercase' | 'lowercase';
  subtitleCase?: 'none' | 'uppercase' | 'lowercase';
  titleLetterSpacing?: number;
  ctaFont?: string | null;
  ctaLetterSpacing?: number;
}

/** Police et casse du titre d'un design (props Remotion), pour `ajusterAccroche`. Pure. */
function policeAccrocheDuDesign(d: DesignSurimpression): PoliceAccroche {
  return {
    police: d.titleFont || 'Inter', policeSousTitre: d.subtitleFont ?? null,
    casse: d.titleCase, casseSousTitre: d.subtitleCase, espacement: d.titleLetterSpacing ?? 0,
  };
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
 * qui laisse libre le visage de l'avatar (`ZONE_VISAGE`) — la MÊME que le
 * plateau de Créer (`miseEnPageSurimpression` + `echellesSurimpressionLarge`).
 */
export function appliquerMiseEnPageSurimpression<T extends object>(
  design: T, profil: string | null | undefined,
  options: {
    ctaBande?: BandeCta | null; format?: DesignFormat | null;
    /**
     * Textes posés sur un AVATAR (présentateur en buste) : cartes et CTA dans
     * la bande SOUS le menton (`ZONE_TEXTE_AVATAR_916`), CTA jamais remonté
     * en haut (il tomberait sur les yeux). Absent : la mise en page d'avant.
     */
    avatar?: boolean;
    /**
     * Fond MESURÉ derrière les textes, s'il est connu : clair ET chargé →
     * voile local discret (`fondTexteSurImage`). Absent : contour seul.
     */
    fondTexte?: { clair?: boolean; charge?: boolean } | null;
  } = {},
): T {
  const d = design as DesignSurimpression & { format?: string | null };
  const format = options.format ?? d.format;
  if (format === '16:9' || format === '1:1') return appliquerMiseEnPageLarge(design, profil, format);
  const surAvatar = options.avatar === true;
  const m0 = miseEnPageDuProfil(profil, {
    ctaBande: surAvatar ? 'bas' : options.ctaBande, format: '9:16',
    cta: { texte: d.ctaText ?? '', sousTexte: d.ctaSubText ?? null, echelle: d.ctaScale ?? 1 },
  });
  // Avatar : la carte commence SOUS le menton (même largeur, même hauteur).
  const m = surAvatar
    ? { ...m0, carte: { ...m0.carte, y: Math.round(((ZONE_TEXTE_AVATAR_916.haut - CADRE.y) / CADRE.h) * 1000) / 10 }, ctaPos: { x: 50, y: ZONE_TEXTE_AVATAR_916.bas } }
    : m0;
  // Accroche bornée en hauteur (#502) — la MÊME règle que Créer.
  const accroche = ajusterAccroche({
    titre: d.title ?? '', sousTitre: d.subtitle ?? null,
    echelleTitre: (d.titleScale ?? 1) * m.titleScale, echelleSousTitre: (d.subtitleScale ?? 1) * m.subtitleScale,
    largeur: 1080, hauteur: 1920, ratioTitre: FONT_RATIO['9:16'].title, ratioSousTitre: FONT_RATIO['9:16'].subtitle,
    ...policeAccrocheDuDesign(d),
  });
  let ctaEchelle = ajusterCta({
    texte: d.ctaText ?? '', sousTexte: d.ctaSubText ?? null, echelle: (d.ctaScale ?? 1) * m.ctaScale, largeur: 1080,
    ratioTexte: FONT_RATIO['9:16'].cta, ratioSousTexte: FONT_RATIO['9:16'].ctaSub, panneau: true,
    police: d.ctaFont || 'Inter', espacement: d.ctaLetterSpacing ?? 0,
  });
  if (surAvatar) {
    // Le panneau du CTA tient dans la bande sous le menton : jamais sur la bouche.
    const R = FONT_RATIO['9:16'];
    const plafond = ((ZONE_TEXTE_AVATAR_916.bas - ZONE_TEXTE_AVATAR_916.haut) / 100) * 1920;
    const plancher = Math.min(ctaEchelle, 34 / (1080 * R.ctaSub));
    const haut = (e: number) => hauteurCta({
      texte: d.ctaText ?? '', sousTexte: d.ctaSubText ?? CTA_SOUS_TEXTE_DEFAUT, echelle: e, largeur: 1080,
      partLargeur: TEXT_LAYOUT.ctaWidth / 100, ratioTexte: R.cta, ratioSousTexte: R.ctaSub,
    });
    while (ctaEchelle > plancher && haut(ctaEchelle) > plafond) ctaEchelle = Math.max(plancher, ctaEchelle * 0.95);
  }
  return {
    ...design,
    titlePos: m.titlePos,
    titleScale: accroche.echelleTitre,
    subtitleScale: accroche.echelleSousTitre,
    ctaBackground: options.fondTexte ? fondTexteSurImage('radial', options.fondTexte) : m.ctaFond,
    ctaSubColor: eclaircir(d.ctaSubColor ?? '#EC4899', m.ctaActionEclaircie) ?? d.ctaSubColor,
    ctaPos: m.ctaPos,
    ctaScale: ctaEchelle,
    cardBoxes: { c0: m.carte },
    cardsTypography: { ...(d.cardsTypography ?? {}), scale: (d.cardsTypography?.scale ?? 1) * m.carteScale },
    cardBackground: options.fondTexte ? fondTexteSurImage('lineaire', options.fondTexte) : m.carteFond,
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
/**
 * 9:16, textes posés sur l'AVATAR : la bande SOUS le menton (% de la hauteur).
 * Mesuré sur la vidéo HeyGen de production (présentateur en buste, plein
 * cadre) : yeux ≈ 30 %, bouche ≈ 50 %, menton ≈ 58–60 % — plus bas que la
 * mire de `ZONE_VISAGE`. Les cartes et le panneau du CTA restent entre 64 %
 * et 76 % (bas du CTA : `CTA_BAS_916`, au-dessus des descriptions des
 * réseaux) : jamais sur la bouche ni le menton.
 */
export const ZONE_TEXTE_AVATAR_916 = { haut: 64, bas: 76 } as const;

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
 *          CTA en bande BASSE centrée (18–82 %, bas à 85 %, haut ≥ 53 %).
 *   1:1  : accroche en bande BASSE (6–94 %, depuis 50 %) ;
 *          carte en bande BASSE (8–92 %, depuis 50 %) ;
 *          CTA en bande BASSE (8–92 %, bas à 91 %, haut ≥ 55 %).
 * Bas du CTA AU-DESSUS du filigrane, toujours affiché pendant le CTA (mesuré
 * dans Chromium) : `Filigrane` de Remotion (Autopilote, rendu hybride) haut à
 * 87,0 % en 16:9 et 92,7 % en 1:1 ; calque `siteText` du compositeur de Créer
 * (ligne de base à 96 %) haut à 92,9 %. Ancré à 92 % (16:9) le panneau du
 * CTA recouvrait le filigrane sur 50 px ; à 93 % (1:1) il le touchait (3 px).
 * 85 % / 91 % laissent ≥ 18 px.
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
    ctaPos: { x: 50, y: 85 }, ctaWidth: 64, ctaHauteurMax: 0.3, ctaScale: 1.6,
  },
  '1:1': {
    titlePos: { x: 6, y: 50 }, titleWidth: 88, titleHauteurMax: 0.3, titleScale: 1.6, subtitleScale: 1,
    carte: versCadre(8, 50, 92, 12), carteScale: 2.6,
    ctaPos: { x: 50, y: 91 }, ctaWidth: 84, ctaHauteurMax: 0.36, ctaScale: 1.6,
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

/**
 * Échelles FINALES du titre et du CTA en format large : l'accroche tient dans
 * sa colonne / sa bande (`ajusterAccroche`), le mot le plus long du CTA tient
 * sur une ligne (`ajusterCta`) puis le bloc tient sous le visage (plafond de
 * hauteur), sans passer sous une ligne d'action lisible (≥ 34 px).
 *
 * SOURCE UNIQUE : l'Autopilote (`appliquerMiseEnPageSurimpression`, images du
 * rendu Remotion / hybride) et le plateau photographié par Créer
 * (`PlateauSurimpression`) l'appellent avec les mêmes entrées. Pur.
 */
export function echellesSurimpressionLarge(format: '16:9' | '1:1', p: {
  titre: string; sousTitre?: string | null;
  /** Échelles choisies par l'utilisateur (1 si aucune), avant la mise en page. */
  echelleTitre?: number | null; echelleSousTitre?: number | null;
  cta: string; sousTexteCta?: string | null; echelleCta?: number | null;
  /** Typographie (chasse réelle). Absente : Inter en capitales, comme le rendu par défaut. */
  policeTitre?: PoliceAccroche; policeCta?: string | null; espacementCta?: number;
}): { titleScale: number; subtitleScale: number; ctaScale: number } {
  const L = MISE_EN_PAGE_LARGE[format];
  const { w: W, h: H } = VIDEO_SIZE[format];
  const R = FONT_RATIO[format];
  const accroche = ajusterAccroche({
    titre: p.titre, sousTitre: p.sousTitre ?? null,
    echelleTitre: (p.echelleTitre ?? 1) * L.titleScale, echelleSousTitre: (p.echelleSousTitre ?? 1) * L.subtitleScale,
    largeur: W, hauteur: H, ratioTitre: R.title, ratioSousTitre: R.subtitle,
    partLargeur: L.titleWidth / 100, hauteurMax: L.titleHauteurMax,
    ...(p.policeTitre ?? {}),
  });
  const cta = { texte: p.cta, sousTexte: p.sousTexteCta ?? CTA_SOUS_TEXTE_DEFAUT, largeur: W, ratioTexte: R.cta, ratioSousTexte: R.ctaSub };
  let ctaEchelle = ajusterCta({ ...cta, echelle: (p.echelleCta ?? 1) * L.ctaScale, panneau: true, partLargeur: L.ctaWidth / 100, police: p.policeCta, espacement: p.espacementCta });
  const plancherCta = Math.min(ctaEchelle, 34 / (W * R.ctaSub));
  while (ctaEchelle > plancherCta && hauteurCta({ ...cta, echelle: ctaEchelle, partLargeur: L.ctaWidth / 100 }) > L.ctaHauteurMax * H) {
    ctaEchelle = Math.max(plancherCta, ctaEchelle * 0.95);
  }
  return { titleScale: accroche.echelleTitre, subtitleScale: accroche.echelleSousTitre, ctaScale: ctaEchelle };
}

function appliquerMiseEnPageLarge<T extends object>(design: T, profil: string | null | undefined, format: '16:9' | '1:1'): T {
  // Couleurs et fonds : ceux du profil (contraste mesuré), seul le placement
  // change. La bande calme mesurée (`ctaBande`) n'est PAS suivie : en format
  // large, la bande HAUTE est celle du visage — le CTA reste en bande basse.
  const m = miseEnPageDuProfil(profil, {});
  const L = MISE_EN_PAGE_LARGE[format];
  const d = design as DesignSurimpression;
  const e = echellesSurimpressionLarge(format, {
    titre: d.title ?? '', sousTitre: d.subtitle ?? null, echelleTitre: d.titleScale, echelleSousTitre: d.subtitleScale,
    cta: d.ctaText ?? '', sousTexteCta: d.ctaSubText, echelleCta: d.ctaScale,
    policeTitre: policeAccrocheDuDesign(d), policeCta: d.ctaFont || 'Inter', espacementCta: d.ctaLetterSpacing ?? 0,
  });
  return {
    ...design,
    titlePos: L.titlePos,
    titleWidth: L.titleWidth,
    titleScale: e.titleScale,
    subtitleScale: e.subtitleScale,
    ctaBackground: m.ctaFond,
    ctaSubColor: eclaircir(d.ctaSubColor ?? '#EC4899', m.ctaActionEclaircie) ?? d.ctaSubColor,
    ctaPos: L.ctaPos,
    ctaWidth: L.ctaWidth,
    ctaScale: e.ctaScale,
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

/**
 * Un badge s'affiche s'il a un TITRE (#499 : jamais une valeur seule). La
 * VALEUR est facultative : sans chiffre soutenu par l'utilisateur
 * (`chiffres-sources.ts`), la carte est un titre avec son icône.
 */
export function badgeValide(c: { title?: string | null; value?: string | null } | null | undefined): boolean {
  return !!c && !!(c.title ?? '').trim();
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
  /** Police des cartes (chasse réelle, `CHASSES`). Absente : l'estimation prudente d'avant. */
  police?: string | null;
}): AjustementBadge {
  const motLePlusLong = Math.max(0, ...p.titre.trim().split(/\s+/).map((m) => m.length));
  // Chasse : jamais plus étroite que l'estimation historique (0,7 em).
  const chasse = Math.max(EM_CARACTERE, p.police ? chassePolice(p.police, true).em : 0);
  const tient = (s: number, icone: boolean) => {
    const dispo = p.largeurPx - 2 * p.padX - (icone ? p.icone * s + p.ecart : 0);
    const em = (n: number, px: number) => n * chasse * px * s;
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
