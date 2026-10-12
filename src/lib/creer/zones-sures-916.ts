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
import { CARDS_FRAME, TEXT_LAYOUT, type DesignFormat } from '@/lib/creer/designSpec';

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
