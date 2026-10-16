/**
 * M1 — NETTETÉ « QUALITÉ », mesurée à plus haute résolution que le moteur.
 *
 * Pourquoi un second jeu de mesures : la netteté de `mesurerImage` est
 * calculée en 64×36 ; à cette taille un flou de 8 à 25 px (boxblur) sur une
 * vidéo 1080 p ne change presque rien, et la valeur dépend surtout de la
 * scène (QA du 16/10 : boxblur 4/10/25 non détectés). Ici, sur 8 images au
 * plus par rush, en 320×320 :
 *
 *  - `detail`  : contraste local moyen (laplacien 4-voisins) en 320×320 ;
 *  - `finesse` : `detail` rapporté au même calcul sur l'image réduite de
 *    moitié (160×160). Une image nette a du détail à TOUTES les échelles
 *    (finesse ≈ 0,6–0,8 mesurée sur les rushes réels) ; un flou efface
 *    d'abord l'échelle la plus fine (≈ 0,37–0,50 pour boxblur 8–10). Le
 *    rapport est propre au rush : il dépend bien moins de la scène que
 *    `detail` seul.
 *
 * ⚠️ `planMontage` ne lit JAMAIS ces champs : ils servent au diagnostic de
 * qualité seul (`qualite-rushs.ts`) et ne changent aucun plan.
 */
import type { AnalyseRush } from '@/lib/creer/smart-montage';

/** Taille des vignettes de netteté qualité. */
export const HD_L = 320;
export const HD_H = 320;
/** Nombre d'images mesurées par rush, au plus (réparties sur la durée analysée). */
export const HD_IMAGES = 8;

export interface NetteteHD {
  /** Médiane de `finesse` (détail fin / détail à mi-résolution). */
  finesse: number;
  /** Médiane de `detail` (contraste local moyen en 320×320, 0..1). */
  detail: number;
  /** Nombre d'images mesurées. */
  images: number;
}

/** Analyse d'un rush portant, en plus, la netteté qualité (facultative). */
export type AnalyseRushQualite = AnalyseRush & { netteteHD?: NetteteHD | null };

function laplacienMoyen(g: Float32Array, l: number, h: number): number {
  let s = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < l - 1; x++) {
      const c = y * l + x;
      s += Math.abs(4 * g[c] - g[c - 1] - g[c + 1] - g[c - l] - g[c + l]);
    }
  }
  return s / Math.max(1, (l - 2) * (h - 2));
}

function reduireDeMoitie(g: Float32Array, l: number, h: number): Float32Array {
  const l2 = l >> 1; const h2 = h >> 1;
  const o = new Float32Array(l2 * h2);
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < l2; x++) {
      const a = 2 * y * l + 2 * x;
      o[y * l2 + x] = (g[a] + g[a + 1] + g[a + l] + g[a + l + 1]) / 4;
    }
  }
  return o;
}

/** Mesures d'UNE image grise (0..1) `l`×`h`. Pure. */
export function mesurerNetteteHD(gris: Float32Array, l = HD_L, h = HD_H): { finesse: number; detail: number } {
  const detail = laplacienMoyen(gris, l, h);
  const grossier = laplacienMoyen(reduireDeMoitie(gris, l, h), l >> 1, h >> 1);
  // Image uniforme : aucun détail à aucune échelle — rapport sans objet (1).
  return { detail, finesse: grossier > 1e-4 ? detail / grossier : 1 };
}

const mediane = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Médianes d'un rush ; `null` sans image. Pure. */
export function agregerNetteteHD(mesures: ReadonlyArray<{ finesse: number; detail: number }>): NetteteHD | null {
  if (!mesures.length) return null;
  return {
    finesse: Math.round(mediane(mesures.map((m) => m.finesse)) * 1000) / 1000,
    detail: Math.round(mediane(mesures.map((m) => m.detail)) * 10000) / 10000,
    images: mesures.length,
  };
}

/** Découpe une sortie brute grise `HD_L`×`HD_H` en images 0..1. Pure. */
export function imagesHDDepuisBrut(brut: Uint8Array): Float32Array[] {
  const taille = HD_L * HD_H;
  const out: Float32Array[] = [];
  for (let o = 0; o + taille <= brut.length; o += taille) {
    const g = new Float32Array(taille);
    for (let i = 0; i < taille; i++) g[i] = brut[o + i] / 255;
    out.push(g);
  }
  return out;
}
