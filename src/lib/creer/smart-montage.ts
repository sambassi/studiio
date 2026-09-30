/**
 * SMART MONTAGE V2 — UN moteur, partagé par Créer (navigateur) et
 * l'Autopilote (serveur).
 *
 *   RUSH → ANALYSE TECHNIQUE (une fois, mise en cache côté serveur)
 *        → SEGMENTS CANDIDATS → QUALITÉ → PERTINENCE (thème / objectif / texte)
 *        → EXCLUSION DES PLAGES DÉJÀ UTILISÉES → PLAN DE MONTAGE → RENDU
 *
 * Chaque extrait du plan dit POURQUOI il a été retenu :
 * `{ url, debut, fin, depuis, jusqua, qualite, pertinence, raison, score }`.
 *
 * ── Ce que « pertinence » veut dire ICI, honnêtement ─────────────────────
 * Aucune analyse sémantique n'est faite localement : le moteur ne SAIT PAS
 * ce que montre une image. La pertinence est un PROFIL D'ACTIVITÉ attendu,
 * déduit par mots-clés du thème / sujet / objectif (danse, sport → plans
 * actifs et énergiques ; conseil, interview → parole, plan posé ; nature,
 * voyage → plan calme et net), comparé aux mesures techniques. Des
 * descriptions de plans (`AnalyseRush.descriptions`, vision / transcription)
 * sont prises en compte quand elles existent — aucune n'est produite
 * aujourd'hui. Sans profil reconnu : `pertinence = null`, sélection sur la
 * qualité seule, et la raison le dit.
 *
 * ── Unicité ───────────────────────────────────────────────────────────────
 * Une plage source ne sert qu'UNE fois par vidéo, avec une marge autour ;
 * les extraits visuellement quasi identiques (empreinte 8×8) sont écartés ;
 * aucun rush ne fournit plus de la moitié du montage tant que d'autres ont
 * de la matière. Entre vidéos d'un même cycle, les plages déjà montées sont
 * pénalisées (`plagesExclues`) tant qu'il reste d'autres bonnes séquences.
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
  /** Vignette 8×8 en gris (64 valeurs 0..1) : détecte les plans quasi identiques. */
  empreinte?: number[];
}

/** Description d'un passage (vision, transcription…) — facultative. */
export interface DescriptionPlan { debut: number; fin: number; texte: string }

export interface AnalyseRush {
  url: string;
  duree: number;
  echantillons: EchantillonRush[];
  descriptions?: DescriptionPlan[];
}

/** Ce que la vidéo doit raconter : sert à la PERTINENCE des extraits. */
export interface ContexteMontage {
  theme?: string | null;
  sujet?: string | null;
  objectif?: string | null;
  /** Texte de la voix off / des cartes. */
  texte?: string | null;
}

/** Plages sources déjà montées, par fichier (clé de stockage). */
export type PlagesUtilisees = Record<string, Array<[number, number]>>;

export interface OptionsMontage {
  /** Longueur visée d'un extrait (s). Défaut : cible / 6, bornée 1,5–4 s. */
  longueurExtrait?: number;
  contexte?: ContexteMontage | null;
  /** Plages montées dans d'AUTRES vidéos du cycle : pénalisées, pas interdites. */
  plagesExclues?: PlagesUtilisees | null;
}

const arrondi = (n: number) => Math.round(n * 1000) / 1000;
const arrondi2 = (n: number) => Math.round(n * 100) / 100;
const borne = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const moyenne = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
};

/** Seuils (0..1 sauf mention). */
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
  /** Écart d'empreinte sous lequel deux plans sont « quasi identiques ». */
  similaire: 0.05,
  /** Marge d'exclusion autour d'une plage utilisée (s), au minimum. */
  margeMin: 1,
  /** Mouvement moyen (écart de gris 0..1) d'un plan franchement actif. */
  mouvementReference: 0.06,
  /** Part maximale d'un seul rush dans le montage (1er passage). */
  partMaxRush: 0.5,
  /** 1er passage : score minimal relatif au meilleur extrait restant. */
  scoreRelatifMin: 0.6,
  /** Pénalité d'une plage déjà montée dans une autre vidéo du cycle. */
  penaliteDejaUtilise: 0.3,
} as const;

/** Clé d'un fichier source, indépendante de la forme de l'URL (relative / absolue). */
export function cleSource(url: string): string {
  const i = url.indexOf('/object/public/');
  const brut = i >= 0 ? url.slice(i + '/object/public/'.length) : url;
  return brut.split('?')[0];
}

// ── Pertinence : profil d'activité déduit du thème ─────────────────────
export type NomProfil = 'activite' | 'parole' | 'calme';
const LEXIQUE: Record<NomProfil, string[]> = {
  activite: [
    'danse', 'danser', 'dance', 'sport', 'fitness', 'muscle', 'cardio', 'workout', 'entrainement',
    'energie', 'bouger', 'mouvement', 'course', 'courir', 'saut', 'sauter', 'zumba', 'afro', 'choregraphie',
    'musculation', 'transpirer', 'calorie', 'rythme', 'fete', 'groupe', 'cours',
  ],
  parole: [
    'conseil', 'astuce', 'interview', 'temoignage', 'explique', 'expliquer', 'tuto', 'tutoriel', 'parole',
    'avis', 'question', 'reponse', 'apprendre', 'comment', 'pourquoi', 'formation', 'coaching',
  ],
  calme: [
    'nature', 'voyage', 'paysage', 'detente', 'meditation', 'yoga', 'calme', 'relax', 'respiration',
    'sommeil', 'recette', 'cuisine', 'produit', 'decor', 'ambiance',
  ],
};

const normaliser = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const mots = (s: string) => normaliser(s).split(/[^a-z0-9]+/).filter((m) => m.length > 2);

/** Profil attendu pour ce contexte, ou `null` si rien d'exploitable. Pur. */
export function profilDuContexte(contexte?: ContexteMontage | null): { nom: NomProfil; indices: string[] } | null {
  if (!contexte) return null;
  const texte = [contexte.theme, contexte.sujet, contexte.objectif, contexte.texte].filter(Boolean).join(' ');
  const liste = mots(texte);
  let meilleur: { nom: NomProfil; indices: string[] } | null = null;
  for (const nom of Object.keys(LEXIQUE) as NomProfil[]) {
    const indices = Array.from(new Set(liste.filter((m) => LEXIQUE[nom].some((k) => m.startsWith(k)))));
    if (indices.length > 0 && (!meilleur || indices.length > meilleur.indices.length)) meilleur = { nom, indices };
  }
  return meilleur;
}

export interface Candidat {
  url: string;
  cle: string;
  depuis: number;
  jusqua: number;
  qualite: number;
  pertinence: number | null;
  score: number;
  raison: string;
  empreinte: number[] | null;
}

/**
 * Découpe un rush en fenêtres candidates notées (qualité + pertinence). Les
 * fenêtres ratées (noires, cramées, floues) ne sont pas renvoyées.
 */
export function candidatsDuRush(analyse: AnalyseRush, longueur: number, contexte?: ContexteMontage | null): Candidat[] {
  const { url, duree, echantillons } = analyse;
  if (!(duree > 0) || echantillons.length === 0) return [];
  const L = Math.min(longueur, duree);
  const cle = cleSource(url);
  const profil = profilDuContexte(contexte);
  const motsContexte = contexte ? new Set(mots([contexte.theme, contexte.sujet, contexte.objectif, contexte.texte].filter(Boolean).join(' '))) : new Set<string>();
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
    // Un extrait est raté dès qu'une part notable de ses images l'est.
    const ratees = dedans.filter((x) =>
      x.luminosite < SEUILS.noir || x.luminosite > SEUILS.crame || x.nettete < netMediane * SEUILS.flouRelatif,
    ).length;
    if (ratees > dedans.length * SEUILS.rateesMax) continue;
    const interieurs = dedans.filter((x) => x.t > s + 1e-6);
    const mouvBrut = moyenne((interieurs.length ? interieurs : dedans).map((x) => x.mouvement));
    // Relatif au rush (le meilleur moment DE CE rush) et ABSOLU (un rush
    // entièrement statique n'est pas « actif » parce qu'il l'est partout
    // autant) : la pertinence d'activité se juge sur l'absolu.
    const mouvRel = borne(mouvBrut / mouvHaut, 0, 1);
    const mouvAbs = borne(mouvBrut / SEUILS.mouvementReference, 0, 1);
    const mouv = 0.5 * mouvRel + 0.5 * mouvAbs;
    const nettete = borne(net / (netMediane * 2), 0, 1);
    const audioBrut = moyenne(dedans.map((x) => x.audio));
    const audio = borne(audioBrut / audioMax, 0, 1);
    // Énergie audio ABSOLUE (RMS déjà normalisé 0..1) pour la pertinence.
    const audioAbs = borne(audioBrut, 0, 1);
    const expo = 1 - Math.abs(lum - 0.5) * 2;

    // ── QUALITÉ : technique seulement ──
    let qualite = 0.4 * mouv + 0.3 * nettete + 0.15 * expo + 0.15 * audio;
    const notes: string[] = [];
    if (mouvRel < SEUILS.statiqueRelatif || mouvAbs < SEUILS.statiqueRelatif) { qualite *= 0.4; notes.push('plan statique'); }
    if (coupes.some((c) => c > s + 0.3 && c < e - 0.3)) { qualite *= 0.7; notes.push('changement de plan au milieu'); }
    if (mouvAbs > 0.6) notes.push('mouvement fort');
    if (nettete > 0.6) notes.push('net');

    // ── PERTINENCE : profil attendu du thème, descriptions si présentes ──
    let pertinence: number | null = null;
    let raisonPertinence = 'aucune information thématique exploitable : qualité seule';
    if (profil) {
      pertinence = profil.nom === 'activite'
        ? 0.7 * mouvAbs + 0.3 * audioAbs
        : profil.nom === 'parole'
        ? 0.6 * audioAbs + 0.4 * (1 - mouvAbs)
        : 0.6 * (1 - mouvAbs) + 0.4 * nettete;
      raisonPertinence = `profil « ${profil.nom} » déduit de « ${profil.indices.join(', ')} » (mesures, pas de compréhension d'image)`;
    }
    const desc = (analyse.descriptions ?? []).filter((d) => d.fin > s && d.debut < e);
    if (desc.length && motsContexte.size) {
      const communs = new Set(desc.flatMap((d) => mots(d.texte)).filter((m) => motsContexte.has(m)));
      if (communs.size) {
        pertinence = Math.max(pertinence ?? 0, borne(0.5 + 0.1 * communs.size, 0, 1));
        raisonPertinence = `description du plan : ${Array.from(communs).join(', ')}`;
      }
    }
    const score = pertinence === null ? qualite : 0.45 * qualite + 0.55 * pertinence;
    const milieu = dedans[Math.floor(dedans.length / 2)];
    out.push({
      url, cle, depuis: arrondi(s), jusqua: arrondi(e),
      qualite: arrondi2(qualite), pertinence: pertinence === null ? null : arrondi2(pertinence),
      score: arrondi(score),
      raison: `qualité ${arrondi2(qualite)}${notes.length ? ` (${notes.join(', ')})` : ''} · pertinence ${pertinence === null ? '—' : arrondi2(pertinence)} : ${raisonPertinence}`,
      empreinte: milieu?.empreinte ?? null,
    });
  }
  return out;
}

const ecartEmpreinte = (a: number[], b: number[]) => {
  const n = Math.min(a.length, b.length);
  if (!n) return 1;
  let d = 0;
  for (let i = 0; i < n; i++) d += Math.abs(a[i] - b[i]);
  return d / n;
};

const chevauche = (a: number, b: number, plages: ReadonlyArray<[number, number]> | undefined, marge: number) =>
  (plages ?? []).some(([x, y]) => a < y + marge && b > x - marge);

/**
 * Plan de montage : ~`cible` secondes des meilleurs extraits UNIQUES, en
 * alternant les rushes. `null` si moins de 2 extraits possibles depuis au
 * moins 2 rushes — l'appelant garde l'enchaînement simple ET le signale.
 */
export function planMontage(
  analyses: ReadonlyArray<AnalyseRush>,
  cible: number,
  options: OptionsMontage = {},
): RushSegment[] | null {
  if (!(cible > 0)) return null;
  const L = options.longueurExtrait ?? borne(cible / 6, 1.5, 4);
  const marge = Math.max(SEUILS.margeMin, L / 2);
  const exclues = options.plagesExclues ?? {};

  // Un même fichier présent deux fois (URL relative ET absolue, ou ajouté
  // deux fois) n'est analysé et monté qu'UNE fois.
  const vus = new Set<string>();
  const uniques = analyses.filter((a) => { const k = cleSource(a.url); if (vus.has(k)) return false; vus.add(k); return true; });

  const parRush = uniques
    .map((a) => ({
      cle: cleSource(a.url),
      candidats: candidatsDuRush(a, L, options.contexte).map((c) => (
        chevauche(c.depuis, c.jusqua, exclues[c.cle], 0)
          ? { ...c, score: arrondi(c.score * SEUILS.penaliteDejaUtilise), raison: `${c.raison} · déjà monté dans une autre vidéo du cycle` }
          : c
      )).sort((x, y) => y.score - x.score || x.depuis - y.depuis),
    }))
    .filter((r) => r.candidats.length > 0);
  if (parRush.length < 2) return null;

  // USED_SOURCE_RANGES : global à la vidéo, par fichier source.
  const utilisees: PlagesUtilisees = {};
  const choisis: Candidat[][] = parRush.map(() => []);
  const tous = () => choisis.flat();
  const acceptable = (c: Candidat) =>
    !chevauche(c.depuis, c.jusqua, utilisees[c.cle], marge)
    && !(c.empreinte && tous().some((p) => p.empreinte && ecartEmpreinte(c.empreinte!, p.empreinte) < SEUILS.similaire));
  let total = 0;
  const prendre = (k: number, c: Candidat) => {
    choisis[k].push(c);
    (utilisees[c.cle] ??= []).push([c.depuis, c.jusqua]);
    total += c.jusqua - c.depuis;
  };

  // 1er passage : à tour de rôle (alternance), aucun rush au-delà de sa part
  // maximale, et seulement des extraits proches du meilleur disponible — un
  // plan hors sujet n'entre pas au nom de l'alternance.
  const meilleurRestant = () => Math.max(0, ...parRush.map((r) => r.candidats.find(acceptable)?.score ?? 0));
  let progres = true;
  while (total < cible - 1e-6 && progres) {
    progres = false;
    for (let k = 0; k < parRush.length && total < cible - 1e-6; k++) {
      const deja = choisis[k].reduce((t, c) => t + (c.jusqua - c.depuis), 0);
      if (deja >= cible * SEUILS.partMaxRush - 1e-6) continue;
      const c = parRush[k].candidats.find(acceptable);
      if (!c || c.score < SEUILS.scoreRelatifMin * meilleurRestant()) continue;
      prendre(k, c);
      progres = true;
    }
  }
  // 2e passage : le meilleur extrait restant, d'où qu'il vienne — part levée,
  // unicité et marge jamais.
  while (total < cible - 1e-6) {
    let meilleur: { k: number; c: Candidat } | null = null;
    parRush.forEach((r, k) => {
      const c = r.candidats.find(acceptable);
      if (c && (!meilleur || c.score > meilleur.c.score)) meilleur = { k, c };
    });
    if (!meilleur) break;
    prendre((meilleur as { k: number; c: Candidat }).k, (meilleur as { k: number; c: Candidat }).c);
  }

  // Ordre : chaque rush chronologique, rushes entrelacés (A1 B1 C1 A2 …).
  const files = choisis.map((l) => [...l].sort((a, b) => a.depuis - b.depuis));
  const ordre: Candidat[] = [];
  for (let rang = 0; files.some((f) => rang < f.length); rang++) {
    files.forEach((f) => { if (rang < f.length) ordre.push(f[rang]); });
  }

  // Placement : total = cible, ou la matière disponible si elle est plus
  // courte. Le dernier extrait est seulement COUPÉ, jamais allongé.
  const plan: RushSegment[] = [];
  let t = 0;
  for (const c of ordre) {
    if (t >= cible - 1e-6) break;
    const d = Math.min(c.jusqua - c.depuis, cible - t);
    if (d < 0.5) break;
    plan.push({
      url: c.url, debut: arrondi(t), fin: arrondi(t + d), depuis: c.depuis, jusqua: arrondi(c.depuis + d),
      score: c.score, qualite: c.qualite, pertinence: c.pertinence, raison: c.raison,
    });
    t += d;
  }
  return plan.length >= 2 ? plan : null;
}

/** Plages sources d'un plan, à cumuler entre les vidéos d'un même cycle. */
export function plagesDuPlan(plan: ReadonlyArray<RushSegment>, cumul: PlagesUtilisees = {}): PlagesUtilisees {
  for (const s of plan) {
    const a = s.depuis ?? 0;
    (cumul[cleSource(s.url)] ??= []).push([a, s.jusqua ?? a + (s.fin - s.debut)]);
  }
  return cumul;
}

/**
 * Ramène un plan à la durée réelle de la séquence « Vidéo » au rendu, sans
 * toucher aux points d'entrée. Plus COURTE : les extraits sont resserrés.
 * Plus LONGUE : rien n'est étiré (un extrait étiré rejouerait la matière
 * d'un autre) — seul le dernier extrait se prolonge jusqu'à la fin.
 */
export function ajusterPlan(plan: ReadonlyArray<RushSegment>, duree: number): RushSegment[] {
  const total = plan.length ? plan[plan.length - 1].fin : 0;
  if (!(total > 0) || !(duree > 0)) return plan.map((s) => ({ ...s }));
  const f = Math.min(1, duree / total);
  return plan.map((s, i) => ({
    ...s,
    debut: arrondi(s.debut * f),
    fin: i === plan.length - 1 ? duree : arrondi(s.fin * f),
  }));
}

/**
 * Durée par défaut de la séquence « Vidéo » d'un montage multi-rush : 30 s
 * (un Reel), jamais plus que la durée réellement disponible dans les rushes.
 * L'utilisateur la règle ensuite librement à l'écran ; le plan suit ce réglage.
 */
export const CIBLE_MONTAGE_DEFAUT = 30;

export function dureeCibleMontage(sommeRushs: number): number {
  return Math.min(sommeRushs, CIBLE_MONTAGE_DEFAUT);
}

/** Durée totale d'un plan (fin du dernier extrait). */
export function dureePlan(plan: ReadonlyArray<RushSegment>): number {
  return plan.length ? plan[plan.length - 1].fin : 0;
}

/** Empreinte (rushes + durée) qui valide un plan calculé pour l'écran courant. */
export function cleMontage(urls: ReadonlyArray<string>, duree: number): string {
  return `${urls.join('|')}@${duree}`;
}

/** Taille des images d'analyse (niveaux de gris). Partagée navigateur / serveur. */
export const ANALYSE_L = 64;
export const ANALYSE_H = 36;

/**
 * Mesures d'UNE image d'analyse (gris 0..1, `ANALYSE_L`×`ANALYSE_H`) —
 * la MÊME arithmétique pour l'analyseur navigateur (canvas) et l'analyseur
 * serveur (ffmpeg) : un seul moteur, quel que soit le chemin.
 */
export function mesurerImage(
  gris: Float32Array, prec: Float32Array | null,
): { luminosite: number; nettete: number; mouvement: number; empreinte: number[] } {
  const L = ANALYSE_L; const H = ANALYSE_H;
  let lum = 0;
  for (let q = 0; q < gris.length; q++) lum += gris[q];
  lum /= gris.length;
  // Netteté : contraste local moyen (laplacien 4-voisins).
  let net = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < L - 1; x++) {
      const c = y * L + x;
      net += Math.abs(4 * gris[c] - gris[c - 1] - gris[c + 1] - gris[c - L] - gris[c + L]);
    }
  }
  net /= (L - 2) * (H - 2);
  let mouv = 0;
  if (prec) {
    for (let q = 0; q < gris.length; q++) mouv += Math.abs(gris[q] - prec[q]);
    mouv /= gris.length;
  }
  // Empreinte 8×8 : moyenne de blocs, pour repérer deux plans quasi identiques.
  const empreinte: number[] = [];
  const bx = L / 8; const by = H / 8;
  for (let j = 0; j < 8; j++) {
    for (let i = 0; i < 8; i++) {
      let s = 0; let n = 0;
      for (let y = Math.floor(j * by); y < Math.floor((j + 1) * by); y++) {
        for (let x = Math.floor(i * bx); x < Math.floor((i + 1) * bx); x++) { s += gris[y * L + x]; n++; }
      }
      empreinte.push(n ? Math.round((s / n) * 1000) / 1000 : 0);
    }
  }
  return { luminosite: lum, nettete: net, mouvement: mouv, empreinte };
}
