/**
 * ZONES SÛRES DU 9:16 — la SEULE définition, partagée par l'aperçu de Créer,
 * le compositeur (positions transmises par Créer), la composition Remotion
 * (Autopilote, rendu serveur) et la mise en page des surimpressions.
 *
 * Sur TikTok, Reels, Shorts et Facebook Reels, l'interface des réseaux se
 * pose PAR-DESSUS la vidéo verticale :
 *
 *   haut   : barre d'état + onglets (« Abonnements | Pour toi », « Reels »,
 *            recherche / caméra des Shorts) ≈ 0–8 % de la hauteur. Meta
 *            recommande de laisser 14 % libres en haut des Reels publicitaires
 *            (bandeau « Sponsorisé » en plus). On retient 12 % : au-dessous de
 *            toutes les barres organiques, sans repousser l'accroche au milieu
 *            de l'image (le visage d'un avatar commence à 17 %, `ZONE_VISAGE`).
 *   droite : rail d'actions (j'aime, commentaires, partage, son) — 15 % de la
 *            largeur sur les quatre réseaux, de 35 % (TikTok, le plus haut)
 *            à 80 % de la hauteur. Valeurs LUES dans `PLATFORM_SAFE_ZONES`.
 *   bas    : pseudo, description, son — jusqu'à 22 % (TikTok, le plus haut).
 *            Valeur LUE dans `PLATFORM_SAFE_ZONES`.
 *
 * TikTok est le plus restrictif sur chaque bord : ce qui tient dans sa zone
 * tient partout. Rien ici ne s'applique au 16:9 ni au 1:1, dont l'interface
 * des réseaux ne recouvre pas l'image de la même façon : leurs positions
 * restent octet pour octet celles d'avant.
 *
 * Module PUR : ni DOM, ni React.
 */
import { PLATFORM_SAFE_ZONES } from '@/lib/constants/platforms';
import { CARDS_FRAME, FONT_RATIO, GAP_RATIO, TEXT_LAYOUT, VIDEO_SIZE, type DesignFormat } from '@/lib/creer/designSpec';

type Pos = { x: number; y: number };

const ZONES_UI = Object.values(PLATFORM_SAFE_ZONES).flatMap((p) => p.zones);
const pct = (v: string | undefined) => (v === undefined ? NaN : parseFloat(v));
/** Bande de description la plus haute (TikTok 22 %). */
const BAS_UI = Math.max(...ZONES_UI.filter((z) => z.bottom === '0%').map((z) => pct(z.height)));
/** Rail d'actions : zones collées au bord droit et décrites depuis le haut. */
const RAILS = ZONES_UI.filter((z) => z.right === '0%' && z.top !== undefined);
const RAIL_LARGEUR = Math.max(...RAILS.map((z) => pct(z.width)));
const RAIL_HAUT = Math.min(...RAILS.map((z) => pct(z.top)));
const RAIL_BAS = Math.max(...RAILS.map((z) => pct(z.top) + pct(z.height)));

/**
 * Zone sûre du 9:16, en % de l'image (1080 × 1920).
 * `haut` : sous les barres du haut ; `bas` : au-dessus des descriptions ;
 * `droite` : bord gauche du rail d'actions, qui ne couvre que
 * [`railHaut`, `railBas`] en hauteur.
 */
export const ZONE_SURE_916 = {
  haut: 12,
  bas: 100 - BAS_UI,
  droite: 100 - RAIL_LARGEUR,
  railHaut: RAIL_HAUT,
  railBas: RAIL_BAS,
} as const;

/**
 * Bas du CTA posé en bas : 76 %, la valeur déjà calibrée et mesurée des
 * surimpressions (#502) — 2 % (≈ 38 px) au-dessus des descriptions.
 */
export const CTA_BAS_916 = 76;

/** Placement par défaut du titre et du CTA en 9:16 (mêmes ancres que `TEXT_LAYOUT`). */
export const TEXT_LAYOUT_916 = {
  /** Bord gauche inchangé (8 %), haut abaissé sous les barres des réseaux. */
  titlePos: { x: TEXT_LAYOUT.titlePos.x, y: ZONE_SURE_916.haut },
  /** Bas-centre, au-dessus des descriptions ; largeur 70 % → 15–85 %, hors du rail. */
  ctaPos: { x: TEXT_LAYOUT.ctaPos.x, y: CTA_BAS_916 },
} as const;

/**
 * Retrait à droite du conteneur des cartes (disposition en FLUX, 9:16) pour
 * que leur bord droit s'arrête au rail d'actions : 85 % − (100 % − 8 %) = 7 %
 * de la largeur de l'image. C'est un `padding` : le CADRE des cartes
 * (`CARDS_FRAME`) ne bouge pas, donc les positions LIBRES (`cardBoxes`, en %
 * de ce cadre) gardent exactement leur sens — un post aux cartes déplacées
 * à la main ne bouge pas d'un pixel.
 */
export const RETRAIT_DROIT_CARTES_916 = `${Math.round((100 - parseFloat(CARDS_FRAME.right) - ZONE_SURE_916.droite) * 100) / 100}%`;

/** Le format est-il le vertical des réseaux ? */
export function estFormat916(format: DesignFormat | string | null | undefined): boolean {
  return format === '9:16';
}

/** Position par défaut du titre ou du CTA pour ce format. */
export function positionTexteParDefaut(el: 'title' | 'cta', format: DesignFormat | string | null | undefined): Pos {
  const ref = estFormat916(format) ? TEXT_LAYOUT_916 : TEXT_LAYOUT;
  return el === 'title' ? ref.titlePos : ref.ctaPos;
}

/**
 * Position AFFICHÉE et RENDUE du titre ou du CTA de l'éditeur Créer.
 *
 * L'éditeur garde comme marqueur « placement automatique » l'ancre
 * historique (`TEXT_LAYOUT`, 8 %/8 % et 50 %/92 %) : c'est déjà elle qui fait
 * écrire `undefined` au brouillon (« rien n'a bougé »). En 9:16 ce marqueur se
 * lit comme le placement sûr ; toute autre position — glissée à la main,
 * relue d'un brouillon ou d'un post — est rendue telle quelle. Hors 9:16, rien
 * ne change.
 */
export function positionTexteEffective(el: 'title' | 'cta', pos: Pos | null | undefined, format: DesignFormat | string | null | undefined): Pos {
  if (!pos) return positionTexteParDefaut(el, format);
  const auto = el === 'title' ? TEXT_LAYOUT.titlePos : TEXT_LAYOUT.ctaPos;
  if (estFormat916(format) && pos.x === auto.x && pos.y === auto.y) return positionTexteParDefaut(el, format);
  return pos;
}

/**
 * Bas d'un CTA posé dans la bande HAUTE (#502) : son HAUT s'aligne sur la
 * zone sûre. Le cadre du CTA s'ancre par le bas (`ctaFrameStyle`) : on y
 * ajoute donc sa hauteur ESTIMÉE (estimation prudente, plus haute que le texte
 * réel — le haut réel tombe sous la limite, jamais au-dessus ; arrondi au
 * dixième SUPÉRIEUR pour la même raison). Pur.
 */
export function ctaBasPourBandeHaute916(hauteurPct: number): number {
  return Math.ceil((ZONE_SURE_916.haut + Math.max(0, hauteurPct)) * 10) / 10;
}

/** Boîte en % de l'image (coin haut-gauche x0/y0). */
export interface BoiteZone { x0: number; y0: number; x1: number; y1: number }

/**
 * Ce qu'une boîte (en % de l'image 9:16) recouvre de l'interface des
 * réseaux : liste vide = dans la zone sûre. Tolérance `eps` en points de %.
 */
export function horsZoneSure916(b: BoiteZone, eps = 0): string[] {
  const z = ZONE_SURE_916;
  const out: string[] = [];
  if (b.y0 < z.haut - eps) out.push(`haut (${b.y0.toFixed(1)} % < ${z.haut} %)`);
  if (b.y1 > z.bas + eps) out.push(`bas (${b.y1.toFixed(1)} % > ${z.bas} %)`);
  if (b.x0 < -eps || b.x1 > 100 + eps) out.push('hors image');
  const toucheRail = b.y1 > z.railHaut && b.y0 < z.railBas;
  if (toucheRail && b.x1 > z.droite + eps) out.push(`rail droit (${b.x1.toFixed(1)} % > ${z.droite} %)`);
  return out;
}

// ── TITRE PLEIN ÉCRAN AGRANDI (9:16) ─────────────────────────────────────
//
// Le cadre du titre s'ancre à gauche et descend avec le texte. Posé à 8 % sur
// 84 % de large, son bord droit est à 92 % : tant que le bloc reste au-dessus
// de 35 % rien ne le recouvre, mais un titre long AGRANDI (échelle jusqu'à
// `SCALE_MAX` = 3) descend dans la hauteur du rail d'actions et passe dessous.
//
// RÈGLE (9:16 seulement, identique pour l'aperçu, le compositeur et Remotion) :
//   1. LARGEUR — si le bloc PEUT atteindre la bande du rail (bas estimé
//      > `railHaut`), son bord droit s'arrête au rail : largeur ramenée à
//      `droite − x`. Le texte se replie sur une ligne de plus ; la position
//      (glissée à la main ou non) n'est jamais touchée, la taille non plus.
//   2. REPLI MINIMAL — si, même replié, le bloc descend sous la zone des
//      descriptions (bas estimé > `bas`), l'échelle baisse par pas de 0,01
//      jusqu'à ce qu'il tienne — jamais sous la taille par défaut (1) ni
//      sous l'échelle choisie. Sans ce repli, un titre long à l'échelle 3
//      sortait de l'image (mesuré : ≈ 120 % de la hauteur).
// La largeur ne descend jamais sous `LARGEUR_TITRE_MIN_916` : un titre posé
// à la main au-delà de 55 % garde sa position, avec cette largeur.

/** Largeur minimale du cadre titre une fois arrêté au rail (même plancher que la poignée, `LARGEUR_MIN`). */
export const LARGEUR_TITRE_MIN_916 = 30;

/** Mêmes ratios que `SequenceTitle` et `drawIntro`. */
const RATIO_TITRE_916 = FONT_RATIO['9:16'].title;
const RATIO_SOUS_TITRE_916 = FONT_RATIO['9:16'].subtitle;
const { w: LARGEUR_916, h: HAUTEUR_916 } = VIDEO_SIZE['9:16'];

/**
 * Chasse PRUDENTE d'un caractère, en em : [capitales, autre casse, espace].
 *
 * MESURÉE dans Chromium (canvas `measureText`, graisse la plus forte publiée,
 * polices Google du catalogue, sur deux titres français en capitales et une
 * phrase en casse normale), puis arrondie AU-DESSUS (≈ +5 %) : le bloc
 * estimé est un peu plus haut que le bloc rendu, jamais plus bas.
 * Mesures : Inter 900 0,670 / 0,564 / 0,199 ; défaut = la plus large des
 * familles courantes (Alfa Slab One 0,748, Archivo Black 0,738, Cinzel 0,730,
 * Montserrat 0,713 ; espace Shadows Into Light 0,45) ; étroites Oswald 0,516,
 * Passion One 0,565, Roboto Condensed 0,541, Teko 0,480, Fjalla One 0,458 ;
 * très étroites Anton 0,447, Bebas Neue 0,375, Staatliches 0,423 ; hors
 * norme Syne 800 1,135 / 0,881, Rubik Mono One 0,85 partout, Great Vibes
 * 0,915, Sacramento 0,909, Pacifico 0,767.
 */
const CHASSE_DEFAUT: readonly [number, number, number] = [0.78, 0.65, 0.47];
const CHASSES: Record<string, readonly [number, number, number]> = {
  Inter: [0.7, 0.6, 0.22],
  ...Object.fromEntries(['Oswald', 'Passion One', 'Roboto Condensed', 'Teko', 'Fjalla One'].map((f) => [f, [0.6, 0.5, 0.3] as const])),
  ...Object.fromEntries(['Anton', 'Anton SC', 'Bebas Neue', 'Staatliches'].map((f) => [f, [0.47, 0.48, 0.25] as const])),
  Syne: [1.2, 0.93, 0.33],
  'Rubik Mono One': [0.9, 0.9, 0.9],
  'Great Vibes': [0.96, 0.65, 0.3],
  Sacramento: [0.96, 0.65, 0.3],
  Pacifico: [0.81, 0.65, 0.3],
};
function chasse(police: string | null | undefined, capitales: boolean): { em: number; espace: number } {
  const c = (police && CHASSES[police]) || CHASSE_DEFAUT;
  return { em: capitales ? c[0] : c[1], espace: c[2] };
}

/** Lignes d'un texte replié mot à mot dans `largeur` px (comme le navigateur et `wrapText`). Pur. */
function lignes(texte: string, px: number, largeur: number, ch: { em: number; espace: number }, espacement: number): number {
  const c = ch.em * px + espacement;
  const espace = ch.espace * px + espacement;
  let n = 0; let ligne = 0;
  for (const mot of texte.trim().split(/\s+/).filter(Boolean)) {
    const w = mot.length * c;
    if (n > 0 && ligne + espace + w <= largeur) ligne += espace + w;
    else { n += 1; ligne = w; }
  }
  return n;
}

/** Le titre plein écran à poser (positions et largeur en % de l'image). */
export interface TitreAPlacer916 {
  format: DesignFormat | string | null | undefined;
  pos: Pos;
  /** Largeur du cadre choisie (% de la largeur). */
  largeur: number;
  /** Échelle choisie (`text.title.scale`). */
  echelle: number;
  titre: string;
  sousTitre?: string | null;
  /** Multiplicateur du sous-titre (sa taille = titre × ce multiplicateur). */
  echelleSousTitre?: number;
  /** Interligne du titre (le sous-titre le partage). Défaut 1,1. */
  interligne?: number;
  /** Interlettrage, en px de l'éditeur (base 320). */
  espacement?: number;
  police?: string | null;
  policeSousTitre?: string | null;
  /** Casse du titre ; absente = capitales (`DEFAULT_TEXT_CASE`). */
  casse?: 'none' | 'uppercase' | 'lowercase';
  casseSousTitre?: 'none' | 'uppercase' | 'lowercase';
}

/**
 * Boîte ESTIMÉE (prudente) du bloc titre + sous-titre, en % de l'image
 * 9:16, pour une largeur et une échelle données. Pur.
 */
export function boiteTitre916(t: TitreAPlacer916, largeur: number, echelle: number): BoiteZone {
  const lh = t.interligne ?? 1.1;
  const esp = ((t.espacement ?? 0) * LARGEUR_916) / 320;
  const utile = (largeur / 100) * LARGEUR_916;
  const pt = LARGEUR_916 * RATIO_TITRE_916 * echelle;
  const ps = LARGEUR_916 * RATIO_SOUS_TITRE_916 * echelle * (t.echelleSousTitre ?? 1);
  const nT = lignes(t.titre, pt, utile, chasse(t.police, (t.casse ?? 'uppercase') === 'uppercase'), esp);
  const sous = (t.sousTitre ?? '').trim();
  const nS = sous ? lignes(sous, ps, utile, chasse(t.policeSousTitre ?? t.police, t.casseSousTitre === 'uppercase'), 0) : 0;
  const h = nT * pt * lh + (nS ? LARGEUR_916 * GAP_RATIO + nS * ps * lh : 0);
  return { x0: t.pos.x, y0: t.pos.y, x1: t.pos.x + largeur, y1: t.pos.y + (h / HAUTEUR_916) * 100 };
}

/**
 * Largeur et échelle RENDUES du titre plein écran (voir la règle ci-dessus).
 * Hors 9:16 : celles choisies, inchangées. Pur et idempotent.
 */
export function titreSur916(t: TitreAPlacer916): { largeur: number; echelle: number } {
  const choisi = { largeur: t.largeur, echelle: t.echelle };
  if (!estFormat916(t.format) || !t.titre?.trim()) return choisi;
  const z = ZONE_SURE_916;
  let largeur = t.largeur;
  if (t.pos.x + largeur > z.droite && boiteTitre916(t, largeur, t.echelle).y1 > z.railHaut) {
    largeur = Math.min(largeur, Math.max(LARGEUR_TITRE_MIN_916, Math.round((z.droite - t.pos.x) * 100) / 100));
  }
  let echelle = t.echelle;
  const plancher = Math.min(t.echelle, 1);
  while (echelle > plancher && boiteTitre916(t, largeur, echelle).y1 > z.bas) {
    echelle = Math.max(plancher, Math.round((echelle - 0.01) * 100) / 100);
  }
  return { largeur, echelle };
}
