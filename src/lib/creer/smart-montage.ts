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
  /** Rythme de la musique, recalé sur la séquence « Vidéo » (V3). */
  rythme?: { beats: number[]; forts: number[]; drop: number | null } | null;
  /** Profil imposé (sinon déduit du contexte). */
  profil?: ProfilMontage;
  /** Interne : nombre de passages recalés sur la durée réellement disponible. */
  recale?: number;
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

// ═══════════════════════════════════════════════════════════════════════
// SMART MONTAGE V3 — PROFILS DE MONTAGE, PHASES, COUPES SUR LE RYTHME
// ═══════════════════════════════════════════════════════════════════════
//
// Le plan n'est plus « les meilleurs extraits à la suite » : il est MONTÉ
// selon un profil (déduit du thème / titre / brief / textes, ou imposé) :
//
//   HOOK → BUILD → PEAK → FOCUS → CTA
//
// Chaque phase a sa durée de plan ; les coupes se calent sur les temps
// forts de la musique quand elle est analysée (`rythme-musique.ts`), sans
// couper sur chaque temps ; le drop, s'il existe, ouvre le PEAK.
//
// ⚠️ CE QUE LE MOTEUR NE SAIT PAS : il ne reconnaît ni un cadrage (large,
// gros plan), ni un visage, ni des pieds. La « variété visuelle » est
// mesurée par la DIFFÉRENCE d'empreinte avec le plan précédent, et la
// pertinence par le profil d'activité (mouvement, énergie audio). Les
// descriptions de plans (vision IA, plus tard) s'y ajoutent sans changer
// l'architecture.

export type ProfilMontage = 'CARDIO_DANCE' | 'LIFESTYLE_BRAND' | 'TUTORIAL_EDUCATION' | 'EVENT_IMMERSIVE' | 'STANDARD';
export type PhaseMontage = 'HOOK' | 'BUILD' | 'PEAK' | 'FOCUS' | 'CTA';

interface RegleProfil {
  /** Durée d'un plan par phase [min, max] (s). */
  phases: Record<PhaseMontage, [number, number]>;
  softMax: number;
  hardMax: number;
  /** Ralenti ponctuel autorisé sur un geste fort. */
  ralenti: boolean;
  /** Titres / cartes / CTA en SURIMPRESSION sur le rush (recommandation). */
  overlay: boolean;
  /** Profil d'activité utilisé pour la pertinence. */
  activite: NomProfil | null;
}

export const REGLES_PROFILS: Record<Exclude<ProfilMontage, 'STANDARD'>, RegleProfil> = {
  CARDIO_DANCE: {
    phases: { HOOK: [1.5, 2.5], BUILD: [1.2, 2], PEAK: [0.7, 1.5], FOCUS: [1.2, 1.8], CTA: [2, 3] },
    softMax: 1.8, hardMax: 3, ralenti: true, overlay: true, activite: 'activite',
  },
  EVENT_IMMERSIVE: {
    phases: { HOOK: [1.5, 2.5], BUILD: [1.5, 2.5], PEAK: [0.8, 1.6], FOCUS: [1.5, 2.2], CTA: [2, 3] },
    softMax: 2.2, hardMax: 3.5, ralenti: true, overlay: true, activite: 'activite',
  },
  LIFESTYLE_BRAND: {
    phases: { HOOK: [1.5, 2.5], BUILD: [1.5, 3], PEAK: [1.5, 2.5], FOCUS: [1.5, 3], CTA: [2, 3] },
    softMax: 2.5, hardMax: 3.5, ralenti: false, overlay: true, activite: 'calme',
  },
  TUTORIAL_EDUCATION: {
    phases: { HOOK: [2, 3], BUILD: [2.5, 5], PEAK: [2.5, 5], FOCUS: [2.5, 5], CTA: [2, 3] },
    softMax: 5, hardMax: 8, ralenti: false, overlay: false, activite: 'parole',
  },
};

const LEXIQUE_PROFILS: Record<Exclude<ProfilMontage, 'STANDARD'>, string[]> = {
  CARDIO_DANCE: LEXIQUE.activite,
  EVENT_IMMERSIVE: [
    'evenement', 'event', 'soiree', 'concert', 'festival', 'show', 'spectacle', 'battle', 'stage', 'dj',
    'gala', 'salon', 'ambiance', 'public', 'foule', 'live', 'party',
  ],
  LIFESTYLE_BRAND: [
    'mode', 'marque', 'produit', 'chaussure', 'sac', 'bijou', 'style', 'elegance', 'elegant', 'collection',
    'boutique', 'beaute', 'cosmetique', 'lifestyle', 'luxe', 'design', 'tenue', 'accessoire',
  ],
  TUTORIAL_EDUCATION: LEXIQUE.parole,
};

/** Profil de montage déduit du contexte (ou `STANDARD`). Pur. */
export function profilMontageDuContexte(contexte?: ContexteMontage | null): { profil: ProfilMontage; indices: string[] } {
  if (!contexte) return { profil: 'STANDARD', indices: [] };
  const liste = mots([contexte.theme, contexte.sujet, contexte.objectif, contexte.texte].filter(Boolean).join(' '));
  let meilleur: { profil: ProfilMontage; indices: string[] } = { profil: 'STANDARD', indices: [] };
  for (const profil of ['CARDIO_DANCE', 'EVENT_IMMERSIVE', 'LIFESTYLE_BRAND', 'TUTORIAL_EDUCATION'] as const) {
    const indices = Array.from(new Set(liste.filter((m) => LEXIQUE_PROFILS[profil].some((k) => m.startsWith(k)))));
    if (indices.length > meilleur.indices.length) meilleur = { profil, indices };
  }
  return meilleur;
}

const PHASES: Array<[PhaseMontage, number]> = [['HOOK', 0.1], ['BUILD', 0.33], ['PEAK', 0.67], ['FOCUS', 0.9], ['CTA', 1]];

/** Découpe la durée en plans : phase, bornes, temps fort visé. Pur. */
export function grilleDeCoupes(
  cible: number, regle: RegleProfil, rythme?: { beats: number[]; forts: number[]; drop: number | null } | null,
): Array<{ debut: number; fin: number; phase: PhaseMontage; beat: number | null }> {
  // Le drop, s'il tombe entre 20 % et 60 %, ouvre le PEAK.
  const bornes = PHASES.map(([p, f]) => [p, f * cible] as [PhaseMontage, number]);
  if (rythme?.drop !== null && rythme?.drop !== undefined && rythme.drop > 0.2 * cible && rythme.drop < 0.6 * cible) {
    bornes[1][1] = rythme.drop;
  }
  const phaseA = (t: number) => (bornes.find(([, fin]) => t < fin - 1e-6)?.[0] ?? 'CTA');
  const out: Array<{ debut: number; fin: number; phase: PhaseMontage; beat: number | null }> = [];
  let t = 0;
  while (t < cible - 0.3) {
    const phase = phaseA(t);
    const [mn, mx] = regle.phases[phase];
    const vise = t + (mn + mx) / 2;
    const dans = (b: number) => b >= t + mn && b <= t + mx;
    const pres = (l: number[]) => l.filter(dans).sort((a, b) => Math.abs(a - vise) - Math.abs(b - vise))[0];
    const beat = rythme ? (pres(rythme.forts) ?? pres(rythme.beats) ?? null) : null;
    let fin = Math.min(beat ?? vise, cible);
    if (cible - fin < mn * 0.6) fin = cible;
    out.push({ debut: arrondi(t), fin: arrondi(fin), phase, beat: beat !== null && fin === beat ? arrondi(beat) : null });
    t = fin;
  }
  return out;
}

interface StatsRush { mouvHaut: number; mouvMoyen: number; mouvMediane: number; netMediane: number; audioMax: number; coupes: number[] }

function statsRush(a: AnalyseRush): StatsRush {
  const mouvements = a.echantillons.map((e) => e.mouvement);
  const mouvMoyen = moyenne(mouvements) || 1e-6;
  return {
    mouvHaut: quantile(mouvements, 0.9) || 1e-6,
    mouvMoyen,
    mouvMediane: quantile(mouvements, 0.5) || 1e-6,
    netMediane: quantile(a.echantillons.map((e) => e.nettete), 0.5) || 1e-6,
    audioMax: Math.max(1e-6, ...a.echantillons.map((e) => e.audio)),
    coupes: a.echantillons.filter((e) => e.mouvement > mouvMoyen * SEUILS.coupeRelative).map((e) => e.t),
  };
}

/** Mesures d'une fenêtre [s, e] d'un rush (échantillon le plus proche si aucun dedans). */
function mesuresFenetre(a: AnalyseRush, st: StatsRush, s: number, e: number) {
  let dedans = a.echantillons.filter((x) => x.t >= s && x.t < e);
  if (dedans.length === 0) {
    const m = (s + e) / 2;
    const proche = a.echantillons.reduce((p, x) => (Math.abs(x.t - m) < Math.abs(p.t - m) ? x : p), a.echantillons[0]);
    dedans = [proche];
  }
  const lum = moyenne(dedans.map((x) => x.luminosite));
  const net = moyenne(dedans.map((x) => x.nettete));
  const ratees = dedans.filter((x) =>
    x.luminosite < SEUILS.noir || x.luminosite > SEUILS.crame || x.nettete < st.netMediane * SEUILS.flouRelatif,
  ).length / dedans.length;
  const mouvBrut = moyenne(dedans.map((x) => x.mouvement));
  const pic = Math.max(...dedans.map((x) => x.mouvement));
  const audioBrut = moyenne(dedans.map((x) => x.audio));
  return {
    ratees,
    mouvRel: borne(mouvBrut / st.mouvHaut, 0, 1),
    mouvAbs: borne(mouvBrut / SEUILS.mouvementReference, 0, 1),
    nettete: borne(net / (st.netMediane * 2), 0, 1),
    audio: borne(audioBrut / st.audioMax, 0, 1),
    audioAbs: borne(audioBrut, 0, 1),
    expo: 1 - Math.abs(lum - 0.5) * 2,
    geste: pic >= st.mouvMediane * 2.2 && pic / SEUILS.mouvementReference >= 0.5,
    coupeMilieu: st.coupes.some((c) => c > s + 0.2 && c < e - 0.2),
    empreinte: dedans[Math.floor(dedans.length / 2)]?.empreinte ?? null,
  };
}

/**
 * Plan de montage V3 : ~`cible` secondes MONTÉES selon le profil (phases,
 * durée de plan, coupes sur le rythme, variété visuelle, ralenti ponctuel),
 * extraits UNIQUES. `null` si moins de 2 extraits possibles depuis au moins
 * 2 rushes — l'appelant garde l'enchaînement simple ET le signale.
 */
export function planMontage(
  analyses: ReadonlyArray<AnalyseRush>,
  cible: number,
  options: OptionsMontage = {},
): RushSegment[] | null {
  if (!(cible > 0)) return null;
  const detection = options.profil
    ? { profil: options.profil, indices: ['choisi'] }
    : profilMontageDuContexte(options.contexte);
  const L = options.longueurExtrait ?? borne(cible / 6, 1.5, 4);
  const regle: RegleProfil = detection.profil === 'STANDARD'
    ? { phases: { HOOK: [L, L], BUILD: [L, L], PEAK: [L, L], FOCUS: [L, L], CTA: [L, L] }, softMax: L, hardMax: L, ralenti: false, overlay: false, activite: null }
    : REGLES_PROFILS[detection.profil];
  const activite = regle.activite ? { nom: regle.activite, indices: detection.indices } : profilDuContexte(options.contexte);
  const motsContexte = options.contexte
    ? new Set(mots([options.contexte.theme, options.contexte.sujet, options.contexte.objectif, options.contexte.texte].filter(Boolean).join(' ')))
    : new Set<string>();
  const exclues = options.plagesExclues ?? {};

  // Un même fichier présent deux fois n'est monté qu'une fois.
  const vus = new Set<string>();
  const rushs = analyses
    .filter((a) => { const k = cleSource(a.url); if (vus.has(k) || !(a.duree > 0) || !a.echantillons.length) return false; vus.add(k); return true; })
    .map((a) => ({ a, cle: cleSource(a.url), st: statsRush(a) }));
  if (rushs.length < 2) return null;

  const grille = grilleDeCoupes(cible, regle, options.rythme ?? null);
  const utilisees: PlagesUtilisees = {};
  const partRush = new Map<string, number>();
  const plan: RushSegment[] = [];
  let ralentis = 0;
  let precedent = null as { cle: string; empreinte: number[] | null } | null;
  const empreintesChoisies: number[][] = [];
  const partJuste = 1 / rushs.length;

  for (const creneau of grille) {
    const d = creneau.fin - creneau.debut;
    const prec: { cle: string; empreinte: number[] | null } | null = precedent;
    type Choix = { seg: RushSegment; score: number; cle: string; empreinte: number[] | null; source: number };
    // Jamais 3 plans de suite du même rush quand un autre rush a de quoi.
    const interdit = plan.length >= 2 && cleSource(plan[plan.length - 1].url) === cleSource(plan[plan.length - 2].url)
      ? cleSource(plan[plan.length - 1].url) : null;
    const chercher = (exclu: string | null): Choix | null => {
    let meilleur: Choix | null = null;
    for (const { a, cle, st } of rushs) {
      if (cle === exclu) continue;
      const marge = Math.max(SEUILS.margeMin, d / 2);
      const debutMin = Math.min(0.5, a.duree * 0.05);
      for (let s = debutMin; s + d <= a.duree - 0.05 + 1e-6; s += 0.5) {
        const m = mesuresFenetre(a, st, s, s + d);
        if (m.ratees > SEUILS.rateesMax) continue;
        // Ralenti : seulement sur un geste fort, peu de fois, profils dynamiques.
        const ralenti = regle.ralenti && ralentis < 2 && (creneau.phase === 'PEAK' || creneau.phase === 'HOOK') && m.geste;
        const vitesse = ralenti ? 0.6 : 1;
        const e = s + d * vitesse;
        if (chevauche(s, e, utilisees[cle], marge)) continue;
        if (m.empreinte && empreintesChoisies.some((p) => ecartEmpreinte(m.empreinte!, p) < SEUILS.similaire)) continue;

        // QUALITÉ / PERTINENCE (comme V2)
        const mouv = 0.5 * m.mouvRel + 0.5 * m.mouvAbs;
        let qualite = 0.4 * mouv + 0.3 * m.nettete + 0.15 * m.expo + 0.15 * m.audio;
        if (m.mouvRel < SEUILS.statiqueRelatif || m.mouvAbs < SEUILS.statiqueRelatif) qualite *= 0.4;
        if (m.coupeMilieu) qualite *= 0.7;
        let pertinence: number | null = null;
        if (activite) {
          pertinence = activite.nom === 'activite'
            ? 0.7 * m.mouvAbs + 0.3 * m.audioAbs
            : activite.nom === 'parole'
            ? 0.6 * m.audioAbs + 0.4 * (1 - m.mouvAbs)
            : 0.6 * (1 - m.mouvAbs) + 0.4 * m.nettete;
        }
        const desc = (a.descriptions ?? []).filter((x) => x.fin > s && x.debut < e);
        let parDescription = false;
        if (desc.length && motsContexte.size) {
          const communs = new Set(desc.flatMap((x) => mots(x.texte)).filter((w) => motsContexte.has(w)));
          if (communs.size) { pertinence = Math.max(pertinence ?? 0, borne(0.5 + 0.1 * communs.size, 0, 1)); parDescription = true; }
        }
        let score = pertinence === null ? qualite : 0.45 * qualite + 0.55 * pertinence;
        // Rôle de la phase
        if (creneau.phase === 'HOOK' || creneau.phase === 'PEAK') score += 0.25 * m.mouvAbs;
        if (creneau.phase === 'FOCUS') score += 0.15 * m.nettete;
        if (creneau.phase === 'CTA') score += 0.2 * qualite;
        // Variété visuelle : différent du plan précédent
        const diff: number = prec?.empreinte && m.empreinte ? borne(ecartEmpreinte(m.empreinte, prec.empreinte) / 0.25, 0, 1) : 1;
        if (prec && diff < 0.3) continue; // quasi le même plan que juste avant
        score += 0.2 * diff;
        if (prec?.cle === cle) score -= 0.2;
        // Diversité des rushes, jamais au prix d'un mauvais plan
        const part = (partRush.get(cle) ?? 0) / Math.max(1e-6, cible);
        if (part > partJuste * 1.4) score -= 0.3 * (part - partJuste * 1.4) / partJuste;
        if (chevauche(s, e, exclues[cle], 0)) score *= SEUILS.penaliteDejaUtilise;
        if (!meilleur || score > meilleur.score) {
          const raisons = [
            `${creneau.phase}`,
            m.mouvAbs > 0.6 ? 'plan très actif' : m.mouvAbs > 0.3 ? 'plan actif' : 'plan posé',
            diff > 0.6 ? 'différent du plan précédent' : 'proche du plan précédent',
            creneau.beat !== null ? `cut sur un temps fort (${creneau.beat}s)` : options.rythme ? 'aucun temps fort dans la fenêtre' : 'sans musique analysée',
            ralenti ? 'ralenti sur un geste fort' : null,
            parDescription ? 'description du plan' : activite ? `profil « ${activite.nom} »` : 'aucune information thématique exploitable : qualité seule',
          ].filter(Boolean);
          meilleur = {
            score, cle, empreinte: m.empreinte, source: e - s,
            seg: {
              url: a.url, debut: creneau.debut, fin: creneau.fin, depuis: arrondi(s), jusqua: arrondi(e),
              phase: creneau.phase, qualite: arrondi2(qualite), pertinence: pertinence === null ? null : arrondi2(pertinence),
              differenceVisuelle: arrondi2(diff), beatCible: creneau.beat, effet: ralenti ? 'ralenti' : null,
              ...(vitesse !== 1 ? { vitesse } : {}),
              score: arrondi(score), raison: raisons.join(' · '),
            },
          };
        }
      }
    }
    return meilleur;
    };
    const meilleur = chercher(interdit) ?? (interdit ? chercher(null) : null);
    // Plus de matière exploitable : la vidéo s'arrête là (jamais d'étirement).
    if (!meilleur) break;
    plan.push(meilleur.seg);
    (utilisees[meilleur.cle] ??= []).push([meilleur.seg.depuis ?? 0, meilleur.seg.jusqua ?? 0]);
    partRush.set(meilleur.cle, (partRush.get(meilleur.cle) ?? 0) + (creneau.fin - creneau.debut));
    if (meilleur.empreinte) empreintesChoisies.push(meilleur.empreinte);
    if (meilleur.seg.effet === 'ralenti') ralentis += 1;
    precedent = { cle: meilleur.cle, empreinte: meilleur.empreinte };
  }
  if (plan.length < 2 || new Set(plan.map((s) => cleSource(s.url))).size < 2) return null;
  // Matière épuisée avant la cible : la vidéo est plus courte (jamais
  // étirée), mais sa NARRATION doit rester complète — on remonte le plan
  // une fois sur la durée réellement disponible, pour garder HOOK → CTA.
  const obtenu = plan[plan.length - 1].fin;
  const passes = options.recale ?? 0;
  if (passes < 3 && obtenu < cible - 0.5 && detection.profil !== 'STANDARD') {
    return planMontage(analyses, obtenu, { ...options, profil: detection.profil, recale: passes + 1 }) ?? plan;
  }
  return plan;
}

/** Recommandation de mise en page du profil (titres/cartes en surimpression). */
export function miseEnPageDuProfil(profil: ProfilMontage): { overlay: boolean } {
  return { overlay: profil !== 'STANDARD' && REGLES_PROFILS[profil].overlay };
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
