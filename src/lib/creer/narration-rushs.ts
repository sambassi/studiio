/**
 * CARTES SUR LES RUSHES — répartition narrative (Créer).
 *
 * Constat (export réel du 20/10, 85,6 s) : la voix des cartes durait 44 s.
 * La séquence Cartes restait 44 s sur un dégradé, cinq cartes figées, puis
 * TOUS les rushes passaient à la fin (25 s). Les images de l'utilisateur
 * n'illustraient jamais ce que la voix disait.
 *
 * Ici, quand la narration des cartes est LONGUE et qu'une séquence Vidéo a
 * des rushes, les cartes deviennent des surimpressions éditoriales posées
 * SUR les rushes : la séquence Cartes garde sa durée (celle de la voix,
 * jamais touchée), son audio et sa place, mais son fond est une suite de
 * plans pris dans les rushes, DANS L'ORDRE choisi par l'utilisateur, coupés
 * aux instants où chaque carte apparaît (calage sur la voix) et jamais plus
 * longs que `PLAN_MAX_S`. Les extraits déjà utilisés par la séquence Vidéo
 * sont évités tant que la matière le permet (pas de répétition abusive).
 *
 * Ce qui reste un CHOIX de l'utilisateur n'est jamais remplacé : ordre et
 * visibilité des séquences, durées, plan de la séquence Vidéo, fond
 * explicite de la séquence Cartes. Seul le fond PAR DÉFAUT (dégradé) change.
 *
 * Module PUR : partagé par le rendu (aperçu Play et export composent les
 * MÊMES options), la métadonnée du post et « Régénérer ».
 */
import type { RushSegment } from '@/lib/creer/multi-rush';

/** Narration des cartes à partir de laquelle on pose les cartes sur les rushes (s). */
export const SEUIL_NARRATION_LONGUE_S = 8;
/** Plus long plan figé sur un même extrait (s). */
export const PLAN_MAX_S = 6;
/** Plus court plan accepté : en deçà, il est fusionné avec son voisin (s). */
export const PLAN_MIN_S = 1.2;

export interface SourceRushNarration {
  url: string;
  /** Durée du rush (s) ; `null` = inconnue (le compositeur borne à la lecture). */
  duree: number | null;
}

/** Extrait déjà monté ailleurs (plan de la séquence Vidéo). */
export interface ExtraitUtilise {
  url: string;
  debut: number;
  fin: number;
  depuis?: number;
  vitesse?: number;
  kind?: string;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Faut-il poser les cartes sur les rushes ? Seulement si TOUT est réuni :
 * séquences Cartes et Vidéo jouées, narration longue, au moins une carte et
 * un rush vidéo, aucun fond de cartes choisi par l'utilisateur, et pas déjà
 * le mode « textes sur la vidéo » (surimpressions des profils dynamiques).
 */
export function cartesSurRushsApplicable(p: {
  dureeCartes: number;
  dureeVideo: number;
  nbCartes: number;
  nbSources: number;
  fondCartesExplicite: boolean;
  surimpressions: boolean;
}): boolean {
  return p.dureeCartes >= SEUIL_NARRATION_LONGUE_S
    && p.dureeVideo > 0
    && p.nbCartes > 0
    && p.nbSources > 0
    && !p.fondCartesExplicite
    && !p.surimpressions;
}

/**
 * Les rushes VIDÉO d'un plan, sans doublon, dans l'ordre de première
 * apparition (= l'ordre de l'utilisateur). Photos et avatar exclus : une
 * photo n'est pas un plan de coupe animé, et l'avatar muet sous une autre
 * voix serait un visage qui parle sans le son.
 */
export function sourcesDuPlan(
  plan: ReadonlyArray<{ url: string; kind?: string }>,
  durees: ReadonlyMap<string, number | null | undefined> = new Map(),
): SourceRushNarration[] {
  const vus = new Set<string>();
  const out: SourceRushNarration[] = [];
  for (const s of plan) {
    if (!s?.url || (s.kind && s.kind !== 'video') || vus.has(s.url)) continue;
    vus.add(s.url);
    const d = durees.get(s.url);
    out.push({ url: s.url, duree: typeof d === 'number' && d > 0 ? d : null });
  }
  return out;
}

/**
 * Coupes de la séquence Cartes : les instants d'apparition des cartes (une
 * carte = un nouveau plan), puis chaque plan trop long redécoupé à parts
 * égales (≤ `planMax`), et chaque plan trop court fusionné.
 */
export function coupesCartes(dureeCartes: number, apparitions: ReadonlyArray<number> = [], planMax = PLAN_MAX_S): number[] {
  if (!(dureeCartes > 0)) return [];
  const bornes = [0, ...apparitions.filter((t) => t > PLAN_MIN_S && t < dureeCartes - PLAN_MIN_S), dureeCartes]
    .sort((a, b) => a - b)
    .filter((t, i, a) => i === 0 || t - a[i - 1] >= PLAN_MIN_S || t === dureeCartes);
  // Dernière borne trop proche de la précédente : on retire la précédente.
  if (bornes.length > 2 && bornes[bornes.length - 1] - bornes[bornes.length - 2] < PLAN_MIN_S) bornes.splice(bornes.length - 2, 1);
  const out: number[] = [0];
  for (let i = 1; i < bornes.length; i++) {
    const a = bornes[i - 1];
    const b = bornes[i];
    const n = Math.max(1, Math.ceil((b - a) / planMax - 1e-9));
    for (let k = 1; k <= n; k++) out.push(r3(a + ((b - a) * k) / n));
  }
  return out;
}

/** Intervalles [a, b] occupés dans un rush par des extraits montés. */
function occupes(url: string, extraits: ReadonlyArray<ExtraitUtilise>): Array<[number, number]> {
  return extraits
    .filter((e) => e.url === url && (!e.kind || e.kind === 'video'))
    .map((e) => {
      const a = e.depuis ?? 0;
      return [a, a + (e.fin - e.debut) * (e.vitesse ?? 1)] as [number, number];
    })
    .sort((x, y) => x[0] - y[0]);
}

/**
 * Point d'entrée d'un extrait de `longueur` s dans un rush.
 *
 * #613 — la matière utilisable est celle des PLANS PROPRES du rush
 * (`plansPropres` de `smart-montage.ts` : ni coupe de la source ni image
 * figée — démo « LE SPORT » : l'extrait pris à 0 s du 3e rush ouvrait sur
 * 0,63 s d'image figée, un gel de 0,7 s dans la vidéo). Sans mesure : le
 * rush entier, comme avant.
 *
 * Choix : d'abord un départ LIBRE (aucune image déjà montée, marge
 * `MARGE_REPRISE_S`), au plus près après le curseur (le rush avance) ; rush
 * épuisé : le départ qui recouvre le MOINS de matière déjà montée — jamais
 * « le début par défaut » ; durée inconnue : le curseur.
 */
function pointEntree(
  duree: number | null, longueur: number, curseur: number, pris: Array<[number, number]>,
  propres: ReadonlyArray<readonly [number, number]> | null,
): number {
  if (duree === null) return curseur;
  const max = Math.max(0, duree - longueur);
  const plans = (propres && propres.length ? propres : [[0, duree] as const])
    .map(([x, y]) => [Math.max(0, x), Math.min(duree, y)] as [number, number])
    .filter(([x, y]) => y > x);
  // Plans assez longs pour l'extrait ; aucun : le départ de chaque plan (l'extrait finit sur une coupe
  // franche de la source — un raccord — mais ne commence jamais dans une image figée ou un flash).
  const tiennent = plans.filter(([x, y]) => y - x >= longueur - 1e-6);
  const departs = new Set<number>();
  const ajouter = (a: number) => departs.add(r3(Math.min(max, Math.max(0, a))));
  if (tiennent.length) {
    for (const [x, y] of tiennent) {
      ajouter(x); ajouter(y - longueur);
      for (let a = x; a <= y - longueur + 1e-6; a += 0.25) ajouter(a);
      for (const [, v] of pris) if (v + MARGE_REPRISE_S >= x && v + MARGE_REPRISE_S <= y - longueur + 1e-6) ajouter(v + MARGE_REPRISE_S);
    }
  } else {
    for (const [x] of plans) ajouter(x);
  }
  const recouvre = (a: number) => pris.reduce((t, [x, y]) => t + Math.max(0, Math.min(a + longueur, y + MARGE_REPRISE_S) - Math.max(a, x - MARGE_REPRISE_S)), 0);
  let meilleur = curseur;
  let note = Infinity;
  for (const a of departs) {
    // Recouvrement d'abord (matière neuve), puis avancer dans le rush, au plus près du curseur.
    const n = recouvre(a) * 100 + (a < curseur - 0.05 ? 1 : 0) + Math.abs(a - curseur) * 0.01;
    if (n < note - 1e-9) { note = n; meilleur = a; }
  }
  return r3(meilleur);
}

/** Marge entre deux extraits d'un même rush (s) : en deçà, la même image reviendrait. */
export const MARGE_REPRISE_S = 0.25;

/**
 * Le plan de la séquence Cartes : chaque plan (entre deux coupes) pris dans
 * le rush suivant, à tour de rôle dans l'ordre de l'utilisateur (deux plans
 * consécutifs ne viennent jamais du même rush quand il y en a plusieurs).
 * `null` sans source ou sans durée.
 */
export function planCartesSurRushs(p: {
  sources: ReadonlyArray<SourceRushNarration>;
  dureeCartes: number;
  apparitions?: ReadonlyArray<number>;
  /** Plan de la séquence Vidéo (évité, et son 1er rush ne clôt pas les cartes). */
  dejaUtilises?: ReadonlyArray<ExtraitUtilise>;
  planMax?: number;
  /**
   * #613 — plans propres mesurés de chaque rush, par URL (`plansPropres`) :
   * aucun extrait ne commence dans une image figée ni à cheval sur une coupe
   * de la source. Absent : le rush entier (comportement d'avant).
   */
  plansPropres?: ReadonlyMap<string, ReadonlyArray<readonly [number, number]>> | null;
  /**
   * #613 — matière montée AILLEURS que dans la séquence Vidéo (fonds en
   * mouvement du Titre / du CTA) : évitée tant que possible, comme la Vidéo.
   */
  autresUsages?: ReadonlyArray<ExtraitUtilise>;
  /** #613 — rush montré JUSTE AVANT les cartes (fond du Titre) : le 1er plan n'en vient pas. */
  rushAvant?: string | null;
}): RushSegment[] | null {
  const sources = p.sources.filter((s) => !!s.url);
  if (!sources.length || !(p.dureeCartes > 0)) return null;
  const coupes = coupesCartes(p.dureeCartes, p.apparitions ?? [], p.planMax ?? PLAN_MAX_S);
  const usages = [...(p.dejaUtilises ?? []), ...(p.autresUsages ?? [])];
  const pris = new Map(sources.map((s) => [s.url, occupes(s.url, usages)] as const));
  const propres = (url: string) => p.plansPropres?.get(url) ?? null;
  const curseurs = new Map<string, number>(sources.map((s) => [s.url, propres(s.url)?.[0]?.[0] ?? 0]));
  // Raccords : le DERNIER plan des cartes ne vient jamais du rush qui OUVRE la
  // Vidéo (sinon le même rush continuerait à travers la coupe, avec un saut en
  // arrière) ; #613 — et le PREMIER ne vient pas du rush du fond du Titre (le
  // même rush continuerait de l'autre côté de la coupe). On décale la
  // rotation (l'ordre cyclique de l'utilisateur est gardé) du plus petit pas
  // qui tient les deux ; sinon, le raccord avec la Vidéo seul (règle d'avant).
  const nbPlans = coupes.length - 1;
  const ouvreVideo = [...(p.dejaUtilises ?? [])].filter((e) => !e.kind || e.kind === 'video').sort((a, b) => a.debut - b.debut)[0]?.url;
  const n = sources.length;
  const finOk = (d: number) => !ouvreVideo || sources[(nbPlans - 1 + d) % n].url !== ouvreVideo;
  const debutOk = (d: number) => !p.rushAvant || sources[d % n].url !== p.rushAvant;
  let decalage = 0;
  if (n > 1) {
    const deux = Array.from({ length: n }, (_, d) => d).find((d) => finOk(d) && debutOk(d));
    if (deux !== undefined) decalage = deux;
    else while (decalage < n - 1 && !finOk(decalage)) decalage += 1;
  }
  const plan: RushSegment[] = [];
  for (let k = 1; k < coupes.length; k++) {
    const src = sources[(k - 1 + decalage) % n];
    const debut = coupes[k - 1];
    const fin = coupes[k];
    const longueur = fin - debut;
    const liste = pris.get(src.url)!;
    const depuis = pointEntree(src.duree, longueur, curseurs.get(src.url)!, liste, propres(src.url));
    liste.push([depuis, depuis + longueur]);
    liste.sort((x, y) => x[0] - y[0]);
    curseurs.set(src.url, r3(depuis + longueur));
    plan.push({ url: src.url, debut: r3(debut), fin: r3(fin), ...(depuis > 0 ? { depuis } : {}), jusqua: r3(depuis + longueur) });
  }
  return plan.length ? plan : null;
}

/** Relit `metadata.cartesSurRushs` ; `null` s'il est absent ou mal formé. */
export function cartesSurRushsDepuisMetadata(valeur: unknown): RushSegment[] | null {
  if (!Array.isArray(valeur) || valeur.length === 0 || valeur.length > 64) return null;
  const out: RushSegment[] = [];
  for (const v of valeur) {
    if (!v || typeof v !== 'object') return null;
    const { url, debut, fin, depuis, jusqua } = v as Record<string, unknown>;
    if (typeof url !== 'string' || !url) return null;
    if (typeof debut !== 'number' || typeof fin !== 'number' || !Number.isFinite(debut) || !Number.isFinite(fin) || fin <= debut) return null;
    out.push({
      url, debut, fin,
      ...(typeof depuis === 'number' && Number.isFinite(depuis) && depuis > 0 ? { depuis } : {}),
      ...(typeof jusqua === 'number' && Number.isFinite(jusqua) ? { jusqua } : {}),
    });
  }
  return out;
}
