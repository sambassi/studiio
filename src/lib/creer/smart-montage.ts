/**
 * SMART MONTAGE V1 — construit UN montage à partir de plusieurs rushes.
 *
 *   RUSHES → ANALYSE (`analyse-rush.ts`, navigateur, gratuite)
 *          → SEGMENTS CANDIDATS → SCORE → PLAN DE MONTAGE (ce module, PUR)
 *          → RENDU (compositeur navigateur / Remotion, via `rushSegments`)
 *
 * Le plan est une liste d'extraits `{ url, debut, fin, depuis, score }` :
 * `debut`/`fin` placent l'extrait dans la séquence « Vidéo », `depuis` dit où
 * le lire DANS son rush. Même forme que `RushSegment` (multi-rush.ts) — un
 * plan « concaténation » est simplement un plan dont chaque `depuis` vaut 0.
 *
 * Règles :
 * - jamais un rush entier : fenêtres courtes, marges de début/fin retirées ;
 * - rejet des fenêtres noires, cramées ou floues (relativement au rush) ;
 * - score = mouvement + netteté + énergie audio + exposition, pénalité pour
 *   une fenêtre statique ou à cheval sur un changement de plan ;
 * - sélection à tour de rôle entre les rushes (alternance), extraits d'un
 *   même rush jamais voisins (pas deux plans quasi identiques) ;
 * - durée totale = durée cible, exactement.
 *
 * Aucune dépendance navigateur : testable avec des échantillons synthétiques.
 */
import type { RushSegment } from '@/lib/creer/multi-rush';

/** Mesures d'un instant du rush (toutes normalisées 0..1). */
export interface EchantillonRush {
  t: number;
  /** Différence moyenne avec l'échantillon précédent (activité, changement de plan). */
  mouvement: number;
  /** Luminosité moyenne. */
  luminosite: number;
  /** Netteté (contraste local moyen). */
  nettete: number;
  /** Énergie audio (RMS) de la fenêtre. 0 sans piste audio. */
  audio: number;
}

export interface AnalyseRush {
  url: string;
  duree: number;
  echantillons: EchantillonRush[];
}

export interface OptionsMontage {
  /** Longueur visée d'un extrait (s). Défaut : cible / 6, bornée 1,5–4 s. */
  longueurExtrait?: number;
}

const arrondi = (n: number) => Math.round(n * 1000) / 1000;
const borne = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const moyenne = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
};

/** Seuils de rejet (0..1). */
export const SEUILS = {
  noir: 0.07,
  crame: 0.95,
  /** Flou : netteté sous cette fraction de la netteté médiane du rush. */
  flouRelatif: 0.35,
  /** Statique : mouvement sous cette fraction du mouvement « haut » du rush. */
  statiqueRelatif: 0.08,
  /** Changement de plan : pic de mouvement au-delà de ce multiple de la moyenne. */
  coupeRelative: 2.5,
  /** Part maximale d'images ratées dans un extrait. */
  rateesMax: 0.2,
} as const;

export interface Candidat {
  url: string;
  depuis: number;
  jusqua: number;
  score: number;
}

/**
 * Découpe un rush en fenêtres candidates notées. Les fenêtres rejetées
 * (noires, cramées, floues) ne sont pas renvoyées.
 */
export function candidatsDuRush(analyse: AnalyseRush, longueur: number): Candidat[] {
  const { url, duree, echantillons } = analyse;
  if (!(duree > 0) || echantillons.length === 0) return [];
  const L = Math.min(longueur, duree);
  // Début et fin de prise souvent inutiles (bougé, mise en place).
  const marge = Math.min(0.5, duree * 0.05);
  const debutMin = duree - 2 * marge >= L ? marge : 0;
  const finMax = duree - 2 * marge >= L ? duree - marge : duree;

  const mouvements = echantillons.map((e) => e.mouvement);
  const mouvHaut = quantile(mouvements, 0.9) || 1e-6;
  const mouvMoyen = moyenne(mouvements) || 1e-6;
  const netMediane = quantile(echantillons.map((e) => e.nettete), 0.5) || 1e-6;
  const audioMax = Math.max(1e-6, ...echantillons.map((e) => e.audio));
  const coupes = echantillons.filter((e) => e.mouvement > mouvMoyen * SEUILS.coupeRelative).map((e) => e.t);

  const pas = Math.max(0.25, L / 2);
  const out: Candidat[] = [];
  for (let s = debutMin; s + L <= finMax + 1e-6; s += pas) {
    const e = s + L;
    const dedans = echantillons.filter((x) => x.t >= s && x.t < e);
    if (dedans.length === 0) continue;
    const lum = moyenne(dedans.map((x) => x.luminosite));
    const net = moyenne(dedans.map((x) => x.nettete));
    // Un extrait est raté dès qu'une part notable de ses images l'est (noir,
    // cramé, flou) — une moyenne masquerait une demi-seconde noire.
    const ratees = dedans.filter((x) =>
      x.luminosite < SEUILS.noir || x.luminosite > SEUILS.crame || x.nettete < netMediane * SEUILS.flouRelatif,
    ).length;
    if (ratees > dedans.length * SEUILS.rateesMax) continue;
    // Le premier échantillon mesure l'écart avec la fenêtre précédente : il
    // ne dit rien de l'activité DANS celle-ci.
    const interieurs = dedans.filter((x) => x.t > s + 1e-6);
    const mouv = borne(moyenne((interieurs.length ? interieurs : dedans).map((x) => x.mouvement)) / mouvHaut, 0, 1);
    const nettete = borne(net / (netMediane * 2), 0, 1);
    const audio = borne(moyenne(dedans.map((x) => x.audio)) / audioMax, 0, 1);
    const expo = 1 - Math.abs(lum - 0.5) * 2;
    let score = 0.45 * mouv + 0.2 * nettete + 0.2 * audio + 0.15 * expo;
    if (mouv < SEUILS.statiqueRelatif) score *= 0.4;
    // Un changement de plan AU MILIEU de l'extrait fait un faux raccord.
    if (coupes.some((c) => c > s + 0.3 && c < e - 0.3)) score *= 0.7;
    out.push({ url, depuis: arrondi(s), jusqua: arrondi(e), score: arrondi(score) });
  }
  return out;
}

/**
 * Plan de montage : ~`cible` secondes des meilleurs extraits, en alternant les
 * rushes. `null` si moins de 2 rushes exploitables — l'appelant garde alors
 * l'enchaînement classique (`planRushs`), à la lettre comme avant.
 */
export function planMontage(
  analyses: ReadonlyArray<AnalyseRush>,
  cible: number,
  options: OptionsMontage = {},
): RushSegment[] | null {
  if (!(cible > 0)) return null;
  const L = options.longueurExtrait ?? borne(cible / 6, 1.5, 4);
  const parRush = analyses
    .map((a) => ({ url: a.url, duree: a.duree, candidats: candidatsDuRush(a, L).sort((x, y) => y.score - x.score || x.depuis - y.depuis) }))
    .filter((r) => r.candidats.length > 0);
  if (parRush.length < 2) return null;

  // Deux extraits d'un même rush : au moins un demi-extrait d'écart, sinon
  // on reverrait quasiment le même plan.
  const ecart = L / 2;
  const choisis: Candidat[][] = parRush.map(() => []);
  const libre = (k: number, c: Candidat) =>
    choisis[k].every((p) => c.jusqua + ecart <= p.depuis || c.depuis >= p.jusqua + ecart);
  let total = 0;
  let progres = true;
  while (total < cible - 1e-6 && progres) {
    progres = false;
    for (let k = 0; k < parRush.length && total < cible - 1e-6; k++) {
      const c = parRush[k].candidats.find((x) => libre(k, x));
      if (!c) continue;
      choisis[k].push(c);
      total += c.jusqua - c.depuis;
      progres = true;
    }
  }

  // Pas assez de matière : on allonge les extraits dans le rush (vers l'avant
  // puis l'arrière) sans chevaucher les autres, jusqu'à la cible.
  for (let k = 0; k < parRush.length && total < cible - 1e-6; k++) {
    const pris = choisis[k].sort((a, b) => a.depuis - b.depuis);
    pris.forEach((c, i) => {
      if (total >= cible - 1e-6) return;
      const plafond = i + 1 < pris.length ? pris[i + 1].depuis : parRush[k].duree;
      const gain = Math.min(plafond - c.jusqua, cible - total);
      if (gain > 0) { c.jusqua = arrondi(c.jusqua + gain); total += gain; }
    });
    pris.forEach((c, i) => {
      if (total >= cible - 1e-6) return;
      const plancher = i > 0 ? pris[i - 1].jusqua : 0;
      const gain = Math.min(c.depuis - plancher, cible - total);
      if (gain > 0) { c.depuis = arrondi(c.depuis - gain); total += gain; }
    });
  }

  // Ordre : chaque rush dans l'ordre chronologique de ses extraits, les rushes
  // entrelacés (A1 B1 A2 B2 …).
  const files = choisis.map((l) => [...l].sort((a, b) => a.depuis - b.depuis));
  const ordre: Candidat[] = [];
  for (let rang = 0; files.some((f) => rang < f.length); rang++) {
    files.forEach((f) => { if (rang < f.length) ordre.push(f[rang]); });
  }

  // Placement dans la séquence, total ramené EXACTEMENT à la cible.
  const plan: RushSegment[] = [];
  let t = 0;
  for (const c of ordre) {
    if (t >= cible - 1e-6) break;
    const d = Math.min(c.jusqua - c.depuis, cible - t);
    if (d < 0.5 && plan.length > 0) { plan[plan.length - 1].fin = arrondi(cible); t = cible; break; }
    plan.push({ url: c.url, debut: arrondi(t), fin: arrondi(t + d), depuis: c.depuis, score: c.score });
    t += d;
  }
  if (plan.length === 0) return null;
  plan[plan.length - 1].fin = arrondi(Math.max(plan[plan.length - 1].fin, cible));
  return plan;
}

/**
 * Ramène un plan à la durée réelle de la séquence « Vidéo » au rendu
 * (proportionnellement), sans toucher aux points d'entrée `depuis`.
 */
export function ajusterPlan(plan: ReadonlyArray<RushSegment>, duree: number): RushSegment[] {
  const total = plan.length ? plan[plan.length - 1].fin : 0;
  if (!(total > 0) || !(duree > 0)) return plan.map((s) => ({ ...s }));
  const f = duree / total;
  return plan.map((s, i) => ({
    ...s,
    debut: arrondi(s.debut * f),
    fin: i === plan.length - 1 ? duree : arrondi(s.fin * f),
  }));
}

/**
 * Durée par défaut de la séquence « Vidéo » d'un montage multi-rush : la
 * somme des rushes, plafonnée — un montage sélectionne les meilleurs
 * passages, il ne rejoue pas tout. Réglable ensuite à l'écran.
 */
export const CIBLE_MONTAGE_DEFAUT = 15;

export function dureeCibleMontage(sommeRushs: number): number {
  return Math.min(sommeRushs, CIBLE_MONTAGE_DEFAUT);
}

/** Empreinte (rushes + durée) qui valide un plan calculé pour l'écran courant. */
export function cleMontage(urls: ReadonlyArray<string>, duree: number): string {
  return `${urls.join('|')}@${duree}`;
}
