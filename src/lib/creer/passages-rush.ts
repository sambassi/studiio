/**
 * M3-a — PASSAGES À L'INTÉRIEUR DES RUSHES (module pur, ÉTEINT par défaut).
 *
 * Un « passage » est une unité naturelle d'un rush : l'intervalle entre deux
 * changements de plan RÉELS. Le moteur (`planMontage(…, { selection:
 * 'passages' })`) n'y prend un extrait que s'il tient dans UN passage et
 * qu'aucune de ses bornes ne tombe au milieu d'un geste. Sans l'option, rien
 * ici n'est appelé : le plan reste celui d'aujourd'hui, octet pour octet.
 *
 * Mesures RÉUTILISÉES (aucune nouvelle passe de décodage, aucun appel) : les
 * échantillons de `AnalyseRush` (mouvement, empreinte 8×8, saturation,
 * luminosité, RMS audio par pas de 0,5 s).
 *
 * ── Ce que ce module ne sait PAS, honnêtement ─────────────────────────────
 * - Il ne voit pas l'image : un changement de plan est un pic de mouvement
 *   suivi d'une image différente (empreinte, couleur, lumière).
 * - Il n'entend pas : une baisse de volume NE PROUVE PAS une fin de phrase.
 *   Une borne n'est dite « coupe dans un silence » (`pause_franche`) que si un
 *   silence franc MESURÉ (trames de 50 ms, fourni en entrée) l'entoure. Le
 *   RMS de 0,5 s du moteur ne suffit jamais : sans mesure fine, la borne est
 *   `incertaine` et l'incertitude remonte dans le rapport (`incertitudes`).
 * - Précision : celle de l'échantillonnage (± un pas). Rush à images-clés
 *   espacées (pas > 0,75 s) : AUCUN changement interne n'est revendiqué.
 */
import type { AnalyseRush, EchantillonRush, PhaseMontage } from '@/lib/creer/smart-montage';
import type { RushSegment } from '@/lib/creer/multi-rush';
import { ecartEmpreinte, memeTimecode, similariteVisuelle, SIMILARITE_FLASH } from '@/lib/creer/smart-montage-regles';

/** Réglages chiffrés (écrits une fois, testés, ajustés sur la vérité terrain des 6 rushes réels). */
export const SEUILS_PASSAGES = {
  /** Pic de mouvement : au-delà de ce multiple de la moyenne du rush (= `SEUILS.coupeRelative`). */
  picRelatif: 2.5,
  /**
   * CORRECTION A — deux pics séparés de ≤ 1 s appartiennent au MÊME événement
   * (geste, panoramique, transition glissée) : une seule zone, jamais une
   * suite de changements de plan.
   */
  ecartPicsMaxS: 1,
  /** Marge après le dernier pic d'une zone (s). */
  margeZoneS: 0.1,
  /** Changement de plan : écart d'empreinte avant / après la zone… */
  changementEmpreinte: 0.25,
  /** …ou, sans saturation mesurée, cet écart (plus prudent : on préfère couper moins). */
  changementEmpreinteSansCouleur: 0.12,
  /** …ou un saut de saturation (couleur) avant / après. */
  changementSaturation: 0.04,
  /** …ou, sans saturation mesurée, un saut de luminosité avant / après. */
  changementLuminosite: 0.08,
  /** Passage plus court : inutilisable (il couperait forcément un plan). */
  passageMinS: 0.8,
  /** Pas d'échantillonnage au-delà duquel le découpage est « grossier ». */
  pasGrossierS: 0.75,
  /** Accroche franche : l'extrait démarre au plus ce délai après un début de passage ou la fin d'un geste. */
  accrocheMaxS: 0.3,
  /** Part « sonore » au-delà de laquelle la parole n'est pas localisable (son continu, musique). */
  partSonoreMax: 0.8,
  /** Plateau sonore : RMS au-dessus de cette fraction du maximum du rush. */
  sonoreRelatif: 0.15,
  /** Silence franc (mesuré sur trames de 50 ms, agent Audio) : durée minimale… */
  silenceMinS: 0.3,
  /** …et marge minimale entre la borne et chaque bord du silence. */
  silenceMargeS: 0.1,
  /** RMS normalisé (min(1, RMS×4)) sous lequel la piste est muette (≈ -60 dBFS). */
  audioMuet: 0.004,
  /**
   * PLAN FIXE OU GRAPHIQUE : mouvement (écart de gris 0..1 entre deux mesures)
   * sous lequel l'image est immobile — photo, carton de texte, écran de cartes
   * d'un ancien montage. Mesuré : 0,000–0,003 sur ces écrans ; ≥ 0,016 sur le
   * plan le plus calme filmé (mer, pexels-35532643).
   */
  mouvementFixe: 0.006,
  /** Passage écarté quand cette part de ses mesures est immobile. */
  partFixeMax: 0.6,
  /** Passage plus court que ce seuil : UN extrait au plus (jamais découpé en morceaux). */
  passageCourtS: 8,
  /** Extraits au plus par passage (diversité). */
  extraitsParPassage: 2,
  /** Dans une zone de transition : saut d'empreinte entre deux mesures = changement interne. */
  sautInterne: 0.1,
  /** Pics minimum d'une zone pour y chercher un plan propre interne. */
  picsZoneInterne: 3,
  /**
   * Plan propre interne à une zone de transition : durée minimale. Mesuré image par
   * image (rush réel 2) : le volet finit vers 49,7 s, la mesure suivante sûre est
   * 49,75 s, la coupe suivante tombe après 50,5 s ⇒ 0,75 s propres garanties.
   */
  passageInterneMinS: 0.7,
  /** Plan entier plus court admis : au moins cette part du créneau. */
  partCreneauMin: 0.6,
  /**
   * PR2 — INTERVIEW SUR PIED (plan quasi immobile mais vivant) : mouvement
   * LOCAL = plus grand écart d'un bloc de l'empreinte 8×8 entre deux mesures
   * (mêmes images 64×36, aucun décodage en plus). Mesuré sur les 6 rushes :
   * photo fixe et écrans de texte ≤ 0,003 (bruit de compression), médiane
   * 0,000–0,001. Seuil provisoire = 3 × ce bruit, À VALIDER sur une vraie
   * interview sur pied (validation audiovisuelle en attente).
   */
  mouvementLocalInterview: 0.01,
  /** Interview probable : part des mesures du passage où la piste est sonore. */
  partSonoreInterview: 0.5,
  /** PR2 — passages longs : au plus ce nombre d'extraits par passage… */
  extraitsParPassageMax: 6,
  /** …et au plus un extrait par cette durée de passage (s). */
  sParExtrait: 3,
  /** Deux fenêtres d'un passage sont des moments distincts si leur énergie diffère d'au moins… */
  ecartEnergieMoment: 0.25,
  /** PR2 — répétition visuelle : même rush, timecodes à moins de cet écart (s)… */
  procheS: 4,
  /** PR2 — marge de sécurité devant / derrière tout plan fixe ou graphique (s). */
  margeGraphiqueS: 0.5,
  /** PR2 — suite d'images immobiles DANS un passage traitée comme un graphisme (s). */
  immobileInterneMinS: 1,
  /** PR2 — accroche : pertinence M2-c FIABLE minimale d'un plan HOOK. */
  pertinenceAccroche: 0.6,
} as const;

export type TypeZone = 'coupe' | 'transition' | 'geste';
export type ParoleBorne = 'pause_franche' | 'incertaine' | 'absente';
export type MotifBorne = 'debut_rush' | 'fin_rush' | 'coupe' | 'transition';

/** Zone de mouvement : aucune borne d'extrait n'y tombe. */
export interface ZoneMouvement {
  debut: number;
  fin: number;
  /** `coupe` (pic isolé) et `transition` (pics groupés) changent de plan ; `geste` reste dans le même plan. */
  type: TypeZone;
  /** Instants des pics regroupés (échantillons). */
  pics: number[];
  /** Écart d'empreinte avant / après (null si au bord du rush). */
  ecart: number | null;
}

export interface Passage {
  debut: number;
  fin: number;
  motifDebut: MotifBorne;
  motifFin: MotifBorne;
  /** Zones de geste contenues : un extrait peut les contenir, jamais y couper. */
  gestes: Array<[number, number]>;
  /** Plan propre retrouvé À L'INTÉRIEUR d'une zone de transition (entre deux changements). */
  interne?: boolean;
}

/** Entrées facultatives, mesurées HORS du moteur. Absentes : comportement prudent. */
export interface EntreesPassages {
  /** Sonde du fichier : `false` = aucune piste audio. Absent = inconnu. */
  pisteAudio?: boolean | null;
  /** Silences francs mesurés (trames de 50 ms, ≥ 300 ms, seuil agent Audio). */
  silences?: Array<[number, number]> | null;
  /** Plages de parole horodatées (transcription) : aucune borne dedans. */
  plagesParole?: Array<[number, number]> | null;
  /** Pertinence M2-c 0..1, `null` = inconnue ⇒ facteur NEUTRE (1). */
  pertinence?: number | null;
  /** PR2 — pertinence FIABLE (niveau connu, pas « à vérifier », confiance ≠ faible). Absent : non fiable. */
  pertinenceFiable?: boolean;
  /** PR2 — son continu ou pulsation musicale mesuré (trames de 50 ms) : parole non localisable. */
  sonContinu?: boolean | null;
}

/**
 * PR2 — entrées d'un rush : les mesures portées par l'analyse (silences de
 * 50 ms, sonde de piste, son continu — mesurés là où le son est déjà décodé),
 * complétées ou remplacées par celles de l'appelant. Pur.
 */
export function entreesDuRush(a: AnalyseRush, e: EntreesPassages = {}): EntreesPassages {
  const out: EntreesPassages = { ...e };
  if (out.pisteAudio === undefined && a.pisteAudio !== undefined) out.pisteAudio = a.pisteAudio;
  if (out.silences === undefined && Array.isArray(a.silences)) out.silences = a.silences;
  if (out.sonContinu === undefined && typeof a.sonContinu === 'boolean') out.sonContinu = a.sonContinu;
  return out;
}

/**
 * Forme minimale d'une pertinence M2-c (`PertinenceRush`), sans importer son
 * module : le moteur reste isolé de `pertinence-rushs` (garde M2-c).
 */
export interface PertinencePassage { niveau: string; aVerifier: boolean; score: number | null; confiance: string }

/** PR2 — pertinence M2-c d'un rush pour le mode passages : score et fiabilité. Pur. */
export function pertinencePourPassages(p: PertinencePassage | null | undefined): Pick<EntreesPassages, 'pertinence' | 'pertinenceFiable'> {
  if (!p || p.niveau === 'inconnu' || typeof p.score !== 'number') return { pertinence: null, pertinenceFiable: false };
  return { pertinence: p.score, pertinenceFiable: !p.aVerifier && p.confiance !== 'faible' };
}

/** PR2 — la pertinence de ce rush est-elle connue ET fiable ? */
export function pertinenceFiable(e: EntreesPassages | undefined): e is EntreesPassages & { pertinence: number } {
  return !!e && typeof e.pertinence === 'number' && Number.isFinite(e.pertinence) && e.pertinenceFiable === true;
}

/**
 * PR2 — cœurs des silences francs (≥ 0,3 s) : 0,1 s retirés de chaque bord
 * INTÉRIEUR. Un silence qui touche le début ou la fin du fichier n'a pas de
 * bord de ce côté (aucun son au-delà).
 */
export function coeursSilences(silences: ReadonlyArray<[number, number]> | null | undefined, duree: number = Infinity): Array<[number, number]> {
  const S = SEUILS_PASSAGES;
  return (silences ?? []).filter(([x, y]) => y - x >= S.silenceMinS - 1e-6)
    .map(([x, y]) => [x <= S.silenceMargeS / 2 ? -Infinity : x + S.silenceMargeS, y >= duree - S.silenceMargeS ? Infinity : y - S.silenceMargeS] as [number, number])
    .sort((p, q) => p[0] - q[0]);
}

/**
 * PR2 — borne d'extrait acceptable pour la parole : au cœur d'un silence ; OU,
 * à un bord de passage qui est un VRAI changement de plan, dans un silence avec
 * la marge du seul côté de l'extrait (le son d'avant la coupe appartient à
 * l'autre plan : rush réel 1, haltères dès 20,1 s, silence 20,1–32 s). La
 * marge ne fait alors pas perdre un plan entier muet.
 */
export function borneSilencieuse(
  silences: ReadonlyArray<[number, number]> | null | undefined, t: number, duree: number,
  p: Pick<Passage, 'debut' | 'fin' | 'motifDebut' | 'motifFin'>, cote: 'debut' | 'fin',
): boolean {
  if (dansUnSilence(silences, t, duree)) return true;
  const S = SEUILS_PASSAGES;
  const auBord = cote === 'debut'
    ? Math.abs(t - p.debut) < 1e-6 && (p.motifDebut === 'coupe' || p.motifDebut === 'transition')
    : Math.abs(t - p.fin) < 1e-6 && (p.motifFin === 'coupe' || p.motifFin === 'transition');
  if (!auBord) return false;
  return (silences ?? []).some(([x, y]) => y - x >= S.silenceMinS - 1e-6 && (cote === 'debut'
    ? t >= x - 1e-6 && (t <= y - S.silenceMargeS + 1e-6 || y >= duree - S.silenceMargeS)
    : t <= y + 1e-6 && (t >= x + S.silenceMargeS - 1e-6 || x <= S.silenceMargeS / 2)));
}

/** PR2 — l'instant `t` est-il au cœur d'un silence franc (≥ 0,3 s, ≥ 0,1 s de chaque bord) ? */
export function dansUnSilence(silences: ReadonlyArray<[number, number]> | null | undefined, t: number, duree: number = Infinity): boolean {
  return coeursSilences(silences, duree).some(([x, y]) => t >= x - 1e-6 && t <= y + 1e-6);
}

/** PR2 — mouvement LOCAL entre deux mesures : plus grand écart d'un bloc de l'empreinte 8×8 (0..1), `null` sans empreintes. */
export function mouvementLocal(x: EchantillonRush, prec: EchantillonRush | undefined): number | null {
  if (!x.empreinte || !prec?.empreinte) return null;
  const n = Math.min(x.empreinte.length, prec.empreinte.length);
  if (!n) return null;
  let m = 0;
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(x.empreinte[i] - prec.empreinte[i]));
  return m;
}

/**
 * PR2 — image d'une fenêtre [s, e] pour comparer deux extraits : la mesure du
 * milieu, ou à défaut (rush à images-clés espacées, aucune mesure dedans) la
 * mesure la plus proche du centre. `null` seulement sans aucune empreinte.
 */
export function empreinteProche(a: AnalyseRush, s: number, e: number): number[] | null {
  const E = a.echantillons.filter((x) => x.empreinte);
  if (!E.length) return null;
  const dedans = E.filter((x) => x.t >= s - 1e-6 && x.t <= e + 1e-6);
  if (dedans.length) return dedans[Math.floor(dedans.length / 2)].empreinte!;
  const c = (s + e) / 2;
  return E.reduce((p, x) => (Math.abs(x.t - c) < Math.abs(p.t - c) ? x : p), E[0]).empreinte!;
}

/**
 * PR2 — INTERVIEW SUR PIED probable sur les mesures [s, e] : piste sonore
 * sur au moins la moitié des mesures ET (mouvement local médian ≥ seuil, ou
 * mouvement local non mesurable). Une photo fixe qui porte une voix (rush
 * réel 2) n'a AUCUN mouvement local : elle reste un plan fixe.
 */
export function interviewProbable(a: AnalyseRush, s: number, e: number, entrees: EntreesPassages = {}): boolean {
  const S = SEUILS_PASSAGES;
  if (entrees.pisteAudio === false) return false;
  const E = a.echantillons;
  const idx = E.map((_x, i) => i).filter((i) => i > 0 && E[i].t >= s - 1e-6 && E[i].t <= e + 1e-6);
  if (!idx.length) return false;
  if (idx.filter((i) => E[i].audio > S.audioMuet).length / idx.length < S.partSonoreInterview) return false;
  const locaux = idx.map((i) => mouvementLocal(E[i], E[i - 1])).filter((x): x is number => x !== null).sort((x, y) => x - y);
  if (!locaux.length) return true;
  return locaux[Math.floor(locaux.length / 2)] >= S.mouvementLocalInterview - 1e-9;
}

export interface DecoupageRush {
  pas: number;
  resolution: 'fine' | 'grossiere';
  zones: ZoneMouvement[];
  passages: Passage[];
  /** Matière écartée par le découpage, avec la raison. */
  ecartes: Array<{ debut: number; fin: number; motif: string }>;
  /** Part des échantillons « sonores » (RMS > 15 % du max). */
  partSonore: number;
  /** Vrai seulement si des silences mesurés sont fournis ET le son n'est pas continu. */
  paroleLocalisable: boolean;
  /**
   * PR2 — son de parole PROBABLE (entre deux silences francs mesurés, marge
   * de 0,1 s comprise) : aucune borne d'extrait dedans. Vide si la parole
   * n'est pas localisable. « Probable » : un silence ne prouve pas une fin de phrase.
   */
  paroleMesuree: Array<[number, number]>;
  /** Durée du rush (s). */
  duree: number;
  /** PR2 — passages quasi immobiles gardés comme interview probable (début du passage). */
  interviews: number[];
  incertitudes: string[];
}

/** PR2 — son de parole probable : le complément des cœurs de silence (marge 0,1 s) sur [0, durée]. */
export function paroleEntreSilences(silences: ReadonlyArray<[number, number]>, duree: number): Array<[number, number]> {
  const coeurs = coeursSilences(silences, duree);
  const out: Array<[number, number]> = [];
  let t = 0;
  for (const [x, y] of coeurs) {
    if (x > t + 1e-6) out.push([r3(t), r3(Math.min(x, duree))]);
    t = Math.max(t, y);
  }
  if (t < duree - 1e-6) out.push([r3(t), r3(duree)]);
  return out.filter(([x, y]) => y - x > 1e-6);
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const moyenne = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function pasDe(e: ReadonlyArray<EchantillonRush>): number {
  const d = e.slice(1).map((x, i) => x.t - e[i].t).filter((x) => x > 0).sort((a, b) => a - b);
  return d.length ? d[Math.floor(d.length / 2)] : 0.5;
}

/** Le pic regroupé change-t-il de plan ? (comparaison des images avant / après). */
function changeDePlan(avant: EchantillonRush | undefined, apres: EchantillonRush | undefined): { change: boolean; ecart: number | null } {
  if (!avant || !apres) return { change: true, ecart: null }; // au bord : prudence, on ne coupe pas dedans
  const ecart = avant.empreinte && apres.empreinte ? ecartEmpreinte(avant.empreinte, apres.empreinte) : null;
  const couleur = typeof avant.saturation === 'number' && typeof apres.saturation === 'number';
  const S = SEUILS_PASSAGES;
  const change = (ecart === null)
    || ecart >= (couleur ? S.changementEmpreinte : S.changementEmpreinteSansCouleur)
    // Couleur mesurée : le saut de saturation tranche (la lumière varie dans un même plan
    // quand le sujet bouge — rush réel, orateur 16,5–18,5 s). Sans couleur : la lumière, par prudence.
    || (couleur
      ? Math.abs((avant.saturation as number) - (apres.saturation as number)) >= S.changementSaturation
      : Math.abs(avant.luminosite - apres.luminosite) >= S.changementLuminosite);
  return { change, ecart: ecart === null ? null : r3(ecart) };
}

/**
 * Découpe un rush en passages. Déterministe, pur, linéaire en échantillons.
 * Début / fin utiles : mêmes marges que le moteur (`min(0,5 s, 5 %)`, fin − 0,05 s).
 */
export function decouperPassages(a: AnalyseRush, entrees: EntreesPassages = {}): DecoupageRush {
  const S = SEUILS_PASSAGES;
  const E = a.echantillons;
  const pas = pasDe(E);
  const debutUtile = Math.min(0.5, a.duree * 0.05);
  const finUtile = a.duree - 0.05;
  const incertitudes: string[] = [];
  const audioMax = Math.max(1e-6, ...E.map((x) => x.audio));
  const partSonore = E.length ? E.filter((x) => x.audio > audioMax * S.sonoreRelatif && x.audio > S.audioMuet).length / E.length : 0;
  const silencesFournis = !!entrees.silences;
  const paroleLocalisable = silencesFournis && entrees.pisteAudio !== false && partSonore <= S.partSonoreMax && entrees.sonContinu !== true;
  if (entrees.pisteAudio !== false && E.some((x) => x.audio > S.audioMuet)) {
    if (!silencesFournis) incertitudes.push('parole non vérifiée : aucun silence mesuré finement (trames de 50 ms) — le RMS de 0,5 s ne prouve ni un silence ni une fin de phrase');
    else if (partSonore > S.partSonoreMax) incertitudes.push(`son quasi continu (${Math.round(partSonore * 100)} % du temps) : parole et musique indiscernables, aucune pause garantie`);
    else if (entrees.sonContinu === true) incertitudes.push('son continu ou musique mesurés (trames de 50 ms) : parole non localisable, aucune pause garantie — bornes non vérifiées');
    else incertitudes.push('coupes placées dans des silences mesurés (trames de 50 ms) : cela évite de couper un son, sans prouver une fin de phrase');
  } else if (entrees.pisteAudio == null) {
    incertitudes.push('audio nul sans sonde : piste absente ou non décodée, indiscernable d\'un silence');
  }
  const paroleMesuree = paroleLocalisable && a.duree > 0 ? paroleEntreSilences(entrees.silences ?? [], a.duree) : [];
  const interviews: number[] = [];
  const noterInterview = (p: { debut: number }) => {
    interviews.push(p.debut);
    incertitudes.push(`passage ${p.debut} s quasi immobile gardé : piste sonore et mouvement local mesurés (interview sur pied probable — seuil à valider sur une vraie interview)`);
  };

  if (!(a.duree > 0) || E.length === 0) {
    return { pas, resolution: 'grossiere', zones: [], passages: [], ecartes: [], partSonore, paroleLocalisable: false, paroleMesuree: [], duree: a.duree, interviews, incertitudes: [...incertitudes, 'rush sans mesure'] };
  }
  if (pas > S.pasGrossierS) {
    incertitudes.push(`mesures espacées de ${r3(pas)} s (images-clés) : aucun changement de plan interne localisable, le rush entier forme un seul passage`);
    const m = E.filter((_x, i) => i > 0);
    const immobile = m.length > 0 && m.filter((x) => x.mouvement < S.mouvementFixe).length / m.length >= S.partFixeMax;
    const interview = immobile && interviewProbable(a, debutUtile, finUtile, entrees);
    if (interview) noterInterview({ debut: r3(debutUtile) });
    const fixe = immobile && !interview;
    const passages: Passage[] = finUtile - debutUtile >= S.passageMinS && !fixe
      ? [{ debut: r3(debutUtile), fin: r3(finUtile), motifDebut: 'debut_rush', motifFin: 'fin_rush', gestes: [] }]
      : [];
    const ecartes = fixe ? [{ debut: r3(debutUtile), fin: r3(finUtile), motif: 'plan fixe ou graphique (image immobile)' }] : [];
    return { pas, resolution: 'grossiere', zones: [], passages, ecartes, partSonore, paroleLocalisable, paroleMesuree, duree: a.duree, interviews, incertitudes };
  }

  // 1. Pics de mouvement, regroupés (CORRECTION A).
  const moy = moyenne(E.map((x) => x.mouvement)) || 1e-6;
  const pics = E.map((x, i) => (x.mouvement > moy * S.picRelatif ? i : -1)).filter((i) => i >= 0);
  const groupes: number[][] = [];
  for (const i of pics) {
    const g = groupes[groupes.length - 1];
    if (g && E[i].t - E[g[g.length - 1]].t <= S.ecartPicsMaxS + 1e-6) g.push(i);
    else groupes.push([i]);
  }
  // 2. Chaque groupe = UNE zone : changement de plan (coupe / transition) ou geste.
  const zones: ZoneMouvement[] = groupes.map((g) => {
    const i0 = g[0]; const i1 = g[g.length - 1];
    const { change, ecart } = changeDePlan(E[i0 - 1], E[i1 + 1]);
    return {
      // Le mouvement mesuré à t compare t − pas et t : l'événement est dans ]t₀ − pas, t₁].
      debut: r3(Math.max(0, E[i0].t - pas)),
      fin: r3(Math.min(a.duree, E[i1].t + S.margeZoneS)),
      type: change ? (g.length === 1 ? 'coupe' : 'transition') : 'geste',
      pics: g.map((i) => E[i].t),
      ecart,
    };
  });

  // 3. Passages = matière utile hors changements de plan.
  const passages: Passage[] = [];
  const ecartes: DecoupageRush['ecartes'] = [];
  let debut = debutUtile; let motif: MotifBorne = 'debut_rush';
  const changements = zones.filter((z) => z.type !== 'geste');
  const fermer = (fin: number, motifFin: MotifBorne) => {
    const f = Math.min(fin, finUtile);
    if (f - debut >= S.passageMinS) {
      passages.push({
        debut: r3(debut), fin: r3(f), motifDebut: motif, motifFin,
        gestes: zones.filter((z) => z.type === 'geste' && z.fin > debut && z.debut < f).map((z) => [z.debut, z.fin] as [number, number]),
      });
    } else if (f > debut) ecartes.push({ debut: r3(debut), fin: r3(f), motif: `passage trop court (< ${S.passageMinS} s) entre deux changements de plan` });
  };
  for (const z of changements) {
    const mz = z.type as 'coupe' | 'transition';
    if (z.fin <= debut) { debut = Math.max(debut, z.fin); motif = mz; continue; }
    if (z.debut >= finUtile) break;
    fermer(z.debut, mz);
    debut = Math.max(debut, z.fin); motif = mz;
  }
  if (debut < finUtile) fermer(finUtile, 'fin_rush');

  // 4. Une zone de transition peut contenir la seule action du rush (rush réel 2 :
  //    volet → danse au sol 49,5–50,5 s → coupe → volet) : les mesures consécutives
  //    quasi identiques (saut < 0,1) y forment un plan propre, gardé s'il dure ≥ 0,8 s.
  for (const z of changements) {
    if (z.pics.length < S.picsZoneInterne) continue;
    const idx = E.map((_x, i) => i).filter((i) => E[i].t >= z.pics[0] - 1e-6 && E[i].t <= z.pics[z.pics.length - 1] + 1e-6);
    let run: number[] = [];
    const clore = () => {
      if (run.length >= 2) {
        // Début : une demi-mesure après la première image stable (la fin d'un volet peut y traîner).
        const d0 = E[run[0]].t + pas / 2; const f0 = E[run[run.length - 1]].t;
        if (f0 - d0 >= S.passageInterneMinS - 1e-6 && d0 >= debutUtile && f0 <= finUtile) {
          passages.push({ debut: r3(d0), fin: r3(f0), motifDebut: 'transition', motifFin: 'transition', gestes: [], interne: true });
        }
      }
      run = [];
    };
    for (const i of idx) {
      const saut = i > 0 && E[i].empreinte && E[i - 1].empreinte ? ecartEmpreinte(E[i].empreinte!, E[i - 1].empreinte!) : 1;
      if (run.length && saut < S.sautInterne) run.push(i);
      else { clore(); run = [i]; }
    }
    clore();
  }
  passages.sort((x, y) => x.debut - y.debut);

  // 5. PLAN FIXE OU GRAPHIQUE : écarté (photo, texte incrusté, surimpression animée sur image fixe).
  const gardes = passages.filter((p) => {
    const m = E.filter((x, i) => i > 0 && x.t >= p.debut - 1e-6 && x.t <= p.fin + 1e-6);
    const part = m.length ? m.filter((x) => x.mouvement < S.mouvementFixe).length / m.length : 0;
    if (part >= S.partFixeMax && interviewProbable(a, p.debut, p.fin, entrees)) { noterInterview(p); return true; }
    if (part >= S.partFixeMax) {
      ecartes.push({ debut: p.debut, fin: p.fin, motif: `plan fixe ou graphique (image immobile ${Math.round(part * 100)} % du passage : photo, texte incrusté ou surimpression)` });
      return false;
    }
    return true;
  });
  const finaux = margesGraphiques(a, gardes, ecartes, entrees);
  return { pas, resolution: 'fine', zones, passages: finaux, ecartes, partSonore, paroleLocalisable, paroleMesuree, duree: a.duree, interviews, incertitudes };
}

/**
 * PR2 (QA sur le vrai MP4 B) — MARGE DEVANT TOUT GRAPHISME. Un passage vivant
 * qui touche un plan fixe ou graphique (passage écarté juste à côté, ou suite
 * d'images immobiles ≥ 1 s À L'INTÉRIEUR du passage, faute d'un pic de
 * mouvement assez fort pour la séparer) est rogné de ce côté : jusqu'à la
 * dernière mesure STABLE avant le fondu ou le volet (saut d'empreinte ≥ 0,1
 * ou de lumière ≥ 0,08 = image en train de changer), et au moins 0,5 s avant
 * le graphisme. Cas réel : tractions du rush 1, fondu 27,5–28 s vers l'écran
 * « JE ME LANCE » — l'extrait 26,1–27,6 laissait voir le texte en fantôme.
 */
function margesGraphiques(a: AnalyseRush, passages: Passage[], ecartes: DecoupageRush['ecartes'], entrees: EntreesPassages): Passage[] {
  const S = SEUILS_PASSAGES;
  const E = a.echantillons;
  const instable = (i: number) => i > 0 && i < E.length && (
    (E[i].empreinte && E[i - 1].empreinte ? ecartEmpreinte(E[i].empreinte!, E[i - 1].empreinte!) >= S.sautInterne : false)
    || Math.abs(E[i].luminosite - E[i - 1].luminosite) >= S.changementLuminosite);
  const indexA = (t: number) => E.findIndex((x) => x.t >= t - 1e-6);
  /** Fin sûre devant un graphisme qui commence (image déjà fixe) à `t0`. */
  const finDevant = (t0: number) => {
    let k = indexA(t0); if (k < 0) k = E.length;
    k -= 1; // dernière mesure avant le graphisme
    while (k > 0 && instable(k)) k -= 1;
    return Math.min(t0 - S.margeGraphiqueS, k >= 0 ? E[k].t : t0 - S.margeGraphiqueS);
  };
  /** Début sûr derrière un graphisme qui finit (image encore fixe) à `t1`. */
  const debutDerriere = (t1: number) => {
    let k = E.findIndex((x) => x.t > t1 + 1e-6); if (k < 0) return Infinity;
    while (k < E.length && instable(k)) k += 1;
    return Math.max(t1 + S.margeGraphiqueS, k < E.length ? E[k].t : Infinity);
  };
  const graphiques = ecartes.filter((e) => /plan fixe ou graphique/.test(e.motif));
  const out: Passage[] = [];
  for (const p of passages) {
    // Suites d'images immobiles (≥ 1 s) DANS le passage, hors interview probable.
    const idx = E.map((_x, i) => i).filter((i) => i > 0 && E[i].t >= p.debut - 1e-6 && E[i].t <= p.fin + 1e-6);
    const suites: Array<[number, number]> = [];
    let i0 = -1;
    for (let k = 0; k <= idx.length; k++) {
      const imm = k < idx.length && E[idx[k]].mouvement < S.mouvementFixe;
      if (imm && i0 < 0) i0 = k;
      if (!imm && i0 >= 0) {
        const t0 = E[idx[i0] - 1].t; const t1 = E[idx[k - 1]].t;
        if (t1 - t0 >= S.immobileInterneMinS - 1e-6 && !interviewProbable(a, t0, t1, entrees)) suites.push([t0, t1]);
        i0 = -1;
      }
    }
    for (const [x, y] of suites) ecartes.push({ debut: r3(x), fin: r3(y), motif: 'plan fixe ou graphique dans le passage (image immobile ≥ 1 s), avec sa marge' });
    // Morceaux vivants entre ces suites, rognés devant / derrière chaque graphisme.
    const bornes: Array<[number, number, boolean, boolean]> = [];
    let d0 = p.debut; let apresGraphisme = false;
    for (const [x, y] of suites) { bornes.push([d0, x, apresGraphisme, true]); d0 = y; apresGraphisme = true; }
    bornes.push([d0, p.fin, apresGraphisme, false]);
    for (const [deb, fin, apres, avant] of bornes) {
      let d = deb; let f = fin;
      if (apres) d = Math.max(d, debutDerriere(deb));
      if (avant) f = Math.min(f, finDevant(fin));
      // Graphisme écarté juste à côté du passage (≤ 1 s) : même marge.
      for (const g of graphiques) {
        if (g.debut >= f - 1e-6 && g.debut - f <= 1 + 1e-6) f = Math.min(f, finDevant(g.debut));
        if (g.fin <= d + 1e-6 && d - g.fin <= 1 + 1e-6) d = Math.max(d, debutDerriere(g.fin));
      }
      d = r3(d); f = r3(f);
      if (f - d >= (p.interne ? S.passageInterneMinS : S.passageMinS) - 1e-6) {
        const rogne = d !== p.debut || f !== p.fin;
        out.push(rogne
          ? { ...p, debut: d, fin: f, motifDebut: d !== p.debut ? 'transition' : p.motifDebut, motifFin: f !== p.fin ? 'transition' : p.motifFin, gestes: p.gestes.filter(([x, y]) => y > d && x < f) }
          : p);
      }
    }
  }
  return out.sort((x, y) => x.debut - y.debut);
}

/**
 * Fenêtre [s, e] immobile (mouvement moyen sous `mouvementFixe`) : plan fixe ou graphique.
 * PR2 : sauf interview sur pied probable (piste sonore + mouvement local mesuré).
 */
export function fenetreFixe(a: AnalyseRush, s: number, e: number, entrees?: EntreesPassages): boolean {
  const m = a.echantillons.filter((x, i) => i > 0 && x.t >= s - 1e-6 && x.t <= e + 1e-6);
  const immobile = m.length > 0 && moyenne(m.map((x) => x.mouvement)) < SEUILS_PASSAGES.mouvementFixe;
  return immobile && !(entrees && interviewProbable(a, s, e, entrees));
}

/**
 * Nombre maximal d'extraits tirés d'un passage : 1 s'il est court (< 8 s), sinon 2.
 * PR2 (`moments` fourni) : selon les moments distincts mesurés, JAMAIS moins
 * qu'avant, au plus 6 et au plus un extrait par 3 s de passage.
 */
export function plafondPassage(p: Passage, moments?: number | null): number {
  const S = SEUILS_PASSAGES;
  const duree = p.fin - p.debut;
  const actuel = duree < S.passageCourtS ? 1 : S.extraitsParPassage;
  if (typeof moments !== 'number' || !Number.isFinite(moments)) return actuel;
  const haut = Math.max(actuel, Math.min(S.extraitsParPassageMax, Math.floor(duree / S.sParExtrait + 1e-9)));
  return Math.min(haut, Math.max(actuel, Math.floor(moments)));
}

/**
 * PR2 — MOMENTS DISTINCTS d'un passage : fenêtres consécutives de `longueur`
 * secondes, gardées (glouton) si leur image diffère de toutes les précédentes
 * (similarité < seuil anti-flash) OU si leur énergie diffère d'au moins 0,25.
 * Mesure visuelle, pas sémantique. Pur.
 */
export function momentsDistincts(a: AnalyseRush, p: Passage, longueur: number, mouvHaut: number): number {
  const S = SEUILS_PASSAGES;
  if (!(longueur > 0)) return 1;
  const E = a.echantillons;
  const vus: Array<{ emp: number[] | null; en: number }> = [];
  for (let s = p.debut; s + longueur <= p.fin + 1e-6; s += longueur) {
    const idx = E.map((_x, i) => i).filter((i) => E[i].t >= s - 1e-6 && E[i].t <= s + longueur + 1e-6);
    if (!idx.length) continue;
    // Image de la fenêtre : la mesure du milieu (même choix que `mesuresFenetre` du moteur).
    const emp = E[idx[Math.floor(idx.length / 2)]].empreinte ?? null;
    const mv = idx.filter((i) => i > 0).map((i) => E[i].mouvement);
    const en = Math.min(1, Math.max(0, moyenne(mv) / Math.max(1e-6, mouvHaut)));
    const nouveau = vus.every((v) => {
      const sim = similariteVisuelle(emp, v.emp);
      return (sim !== null && sim < SIMILARITE_FLASH) || Math.abs(en - v.en) >= S.ecartEnergieMoment - 1e-9;
    });
    if (nouveau) vus.push({ emp, en });
  }
  return Math.max(1, vus.length);
}

/**
 * Plans ENTIERS plus courts que le créneau (≥ 60 % de lui) : le reste du créneau
 * passe au plan suivant (la grille musicale ne bouge pas).
 */
export function plansEntiersCourts(d: DecoupageRush, duree: number): Array<[number, number]> {
  const S = SEUILS_PASSAGES;
  return d.passages
    .filter((p) => p.fin - p.debut < duree - 1e-6 && p.fin - p.debut >= S.partCreneauMin * duree - 1e-6)
    .map((p) => [p.debut, r3(p.fin - p.debut)] as [number, number]);
}

/** Le passage qui contient entièrement [s, e], s'il existe. */
export function passageDe(d: DecoupageRush, s: number, e: number): Passage | null {
  return d.passages.find((p) => s >= p.debut - 1e-6 && e <= p.fin + 1e-6) ?? null;
}

/** Une borne d'extrait [s, e] est-elle permise ? Jamais à cheval sur un changement de plan, jamais dans un geste. */
export function bornesAutorisees(d: DecoupageRush, s: number, e: number, entrees: EntreesPassages = {}): { ok: boolean; motif?: string; passage?: Passage } {
  const p = passageDe(d, s, e);
  if (!p) return { ok: false, motif: 'à cheval sur un changement de plan (ou hors matière utile)' };
  const dans = (t: number, [x, y]: [number, number]) => t > x + 1e-6 && t < y - 1e-6;
  if (p.gestes.some((g) => dans(s, g) || dans(e, g))) return { ok: false, motif: 'borne au milieu d\'un geste' };
  // PR2 — silences mesurés, parole localisable : une borne hors d'un silence franc tombe
  // dans un son de parole probable ⇒ REFUSÉE (la vidéo raccourcit plutôt que de couper un mot).
  if (d.paroleLocalisable && !(borneSilencieuse(entrees.silences, s, d.duree, p, 'debut') && borneSilencieuse(entrees.silences, e, d.duree, p, 'fin'))) {
    return { ok: false, motif: 'borne dans un son de parole probable (hors d\'un silence mesuré)' };
  }
  if ((entrees.plagesParole ?? []).some(([x, y]) => dans(s, [x + 0.05, y - 0.05]) || dans(e, [x + 0.05, y - 0.05]))) {
    return { ok: false, motif: 'borne au milieu d\'une parole horodatée' };
  }
  return { ok: true, passage: p };
}

/**
 * PR2 — fenêtres placées sur les SILENCES mesurés d'un passage : (1) départs
 * tels que les DEUX bornes tombent au cœur d'un silence ; (2) PHRASES
 * ENTIÈRES (d'un cœur de silence au suivant, une ou plusieurs phrases) plus
 * courtes que le créneau mais d'au moins 60 % de lui. `[départ, durée]`. Pur.
 */
export function fenetresSilences(d: DecoupageRush, silences: ReadonlyArray<[number, number]> | null | undefined, duree: number): Array<[number, number]> {
  const S = SEUILS_PASSAGES;
  if (!d.paroleLocalisable || !silences?.length) return [];
  const out: Array<[number, number]> = [];
  for (const p of d.passages) {
    const coeurs = coeursSilences(silences, d.duree)
      .map(([x, y]) => [Math.max(p.debut, x), Math.min(p.fin, y)] as [number, number])
      .filter(([x, y]) => y >= x - 1e-6);
    for (let i = 0; i < coeurs.length; i++) {
      for (let j = i; j < coeurs.length; j++) {
        const lo = Math.max(coeurs[i][0], coeurs[j][0] - duree);
        const hi = Math.min(coeurs[i][1], coeurs[j][1] - duree);
        if (hi >= lo - 1e-6) out.push([r3((lo + hi) / 2), r3(duree)]);
        if (j > i) {
          const c0 = (coeurs[i][0] + coeurs[i][1]) / 2; const c1 = (coeurs[j][0] + coeurs[j][1]) / 2;
          const l = c1 - c0;
          if (l < duree - 1e-6 && l >= S.partCreneauMin * duree - 1e-6) out.push([r3(c0), r3(l)]);
        }
      }
    }
  }
  return out;
}

/** Départs candidats : débuts de passage, sorties de geste, puis tous les 0,5 s DANS le passage. */
export function departsCandidats(d: DecoupageRush, duree: number): number[] {
  const out = new Set<number>();
  for (const p of d.passages) {
    for (let s = p.debut; s + duree <= p.fin + 1e-6; s += 0.5) out.add(r3(s));
    for (const [, fin] of p.gestes) if (fin >= p.debut && fin + duree <= p.fin + 1e-6) out.add(r3(fin));
  }
  return Array.from(out).sort((x, y) => x - y);
}

/**
 * CORRECTION B — ce que l'on peut dire de la parole à l'extrait [s, e].
 * `pause_franche` : borne au cœur d'un silence franc MESURÉ (≥ 0,3 s, marge
 * 0,1 s) — « coupe dans un silence », jamais « fin de phrase ».
 * `absente` : piste absente selon la sonde, ou piste muette sur tout l'extrait.
 * Sinon `incertaine` (baisse de volume, son continu, musique, mesure 0,5 s seule, audio nul sans sonde).
 */
export function paroleExtrait(a: AnalyseRush, d: DecoupageRush, s: number, e: number, entrees: EntreesPassages = {}): { debut: ParoleBorne; fin: ParoleBorne } {
  const S = SEUILS_PASSAGES;
  if (entrees.pisteAudio === false) return { debut: 'absente', fin: 'absente' };
  if (entrees.pisteAudio === true) {
    const dedans = a.echantillons.filter((x) => x.t >= s - 1e-6 && x.t <= e + 1e-6);
    if (dedans.length && dedans.every((x) => x.audio < S.audioMuet)) return { debut: 'absente', fin: 'absente' };
  }
  const borne = (t: number): ParoleBorne => (d.paroleLocalisable && dansUnSilence(entrees.silences, t, d.duree) ? 'pause_franche' : 'incertaine');
  return { debut: borne(s), fin: borne(e) };
}

/** Une borne tombe-t-elle dans un plateau sonore (échantillon le plus proche) ? */
export function borneDansLeSon(a: AnalyseRush, t: number): boolean {
  const E = a.echantillons;
  if (!E.length) return false;
  const max = Math.max(1e-6, ...E.map((x) => x.audio));
  const proche = E.reduce((p, x) => (Math.abs(x.t - t) < Math.abs(p.t - t) ? x : p), E[0]);
  return proche.audio > max * SEUILS_PASSAGES.sonoreRelatif && proche.audio > SEUILS_PASSAGES.audioMuet;
}

export interface MesuresPassage {
  /** Score de base du moteur (qualité × pertinence d'activité, formule actuelle). */
  base: number;
  qualite: number;
  mouvAbs: number;
  nettete: number;
  /** Énergie comparée à toute la matière (0..1). */
  energie: number;
  ratees: number;
}

/**
 * Note d'un extrait en mode passages : `base × facteurSens + rôle`.
 * facteurSens (M2-c) : `null` ⇒ 1 exactement (neutre) ; sinon 0,6 + 0,4·P ≤ 1 —
 * la pertinence ne peut que RETIRER, jamais inventer un bonus.
 */
export function notePassagePhase(
  m: MesuresPassage, phase: PhaseMontage,
  ctx: { pertinence: number | null | undefined; departPassage: boolean; prolongeAction: boolean; pertinenceFiable?: boolean },
): { score: number; raisons: string[] } {
  const raisons: string[] = [];
  const P = typeof ctx.pertinence === 'number' && Number.isFinite(ctx.pertinence) ? Math.min(1, Math.max(0, ctx.pertinence)) : null;
  const facteurSens = P === null ? 1 : 0.6 + 0.4 * P;
  if (P !== null) raisons.push(`pertinence du rush ${Math.round(P * 100) / 100} (facteur ${Math.round(facteurSens * 100) / 100})`);
  let score = m.base * facteurSens;
  if (phase === 'HOOK') {
    score += 0.25 * m.mouvAbs;
    if (ctx.departPassage) { score += 0.15; raisons.push('accroche franche : départ en début de passage'); }
    if (m.energie < 0.6 || m.ratees > 0) { score -= 0.3; raisons.push('accroche faible (énergie < 0,6 ou image ratée, pénalisé)'); }
    // PR2 — pertinence M2-c FIABLE : une accroche hors sujet (< 0,6) est pénalisée (jamais un trou).
    if (P !== null && ctx.pertinenceFiable === true && P < SEUILS_PASSAGES.pertinenceAccroche) {
      score -= 0.3; raisons.push(`accroche peu pertinente (pertinence ${Math.round(P * 100) / 100} < 0,6, pénalisé)`);
    }
  }
  if (phase === 'BUILD' && ctx.prolongeAction) { score += 0.1; raisons.push('prolonge l\'action du plan précédent'); }
  if (phase === 'PEAK') score += 0.25 * m.mouvAbs;
  if (phase === 'FOCUS') score += 0.15 * m.nettete;
  if (phase === 'CTA') score += 0.2 * m.qualite;
  return { score, raisons };
}

export interface RapportSelection {
  version: 1;
  mode: 'passages';
  cible: number;
  /** Durée réellement montable sans répétition, ralenti ni remplissage. */
  dureeRealisable: number;
  /** Ce qui manque, dit en clair ; `null` si la cible est tenue. */
  manque: string | null;
  /** Extraits reprenant une matière déjà montée (timecodes qui se chevauchent). */
  repetitions: number;
  /** Extraits pris « faute d'alternative » (règle actuelle, coupe possible dans un plan). */
  replis: number;
  incertitudes: string[];
  plans: Array<{ cle: string; depuis: number; jusqua: number; phase: string | null; score: number | null; parole: { debut: ParoleBorne; fin: ParoleBorne } | null; raison: string }>;
  ecartes: Array<{ cle: string; motif: string }>;
}

/** Rapport lisible d'un plan en mode passages (pour `decisionMontage.selection`). Pur. */
export function rapportSelection(
  plan: ReadonlyArray<RushSegment> | null, analyses: ReadonlyArray<AnalyseRush>, cible: number,
  entrees: Record<string, EntreesPassages> = {}, cleDe: (url: string) => string = (u) => u,
): RapportSelection {
  const segs = plan ?? [];
  const duree = segs.length ? segs[segs.length - 1].fin : 0;
  const fen = segs.map((s) => ({ cle: cleDe(s.url), depuis: s.depuis ?? 0, jusqua: s.jusqua ?? (s.depuis ?? 0) + (s.fin - s.debut), empreinte: null }));
  let repetitions = 0;
  fen.forEach((f, i) => { if (fen.slice(0, i).some((g) => memeTimecode(f, g))) repetitions += 1; });
  const replis = segs.filter((s) => (s.raison ?? '').includes('faute d\'alternative : coupe au milieu d\'un plan')).length;
  const incertitudes = new Set<string>();
  const utilisees = new Set(fen.map((f) => f.cle));
  const ecartes: RapportSelection['ecartes'] = [];
  for (const a of analyses) {
    const cle = cleDe(a.url);
    const d = decouperPassages(a, entreesDuRush(a, entrees[cle] ?? {}));
    if (utilisees.has(cle)) d.incertitudes.forEach((x) => incertitudes.add(`${cle.split('/').pop()} : ${x}`));
    else ecartes.push({ cle, motif: d.passages.length ? 'aucun passage retenu (score, cohérence ou répétition)' : 'aucun passage utilisable' });
  }
  const incertainesN = segs.filter((s) => s.parole && (s.parole.debut === 'incertaine' || s.parole.fin === 'incertaine')).length;
  if (incertainesN) incertitudes.add(`${incertainesN} extrait(s) dont une borne peut tomber dans un son (parole non vérifiée)`);
  if (replis) incertitudes.add(`${replis} extrait(s) pris faute d'alternative : coupe possible au milieu d'un plan`);
  // PR2 — accroche : sans pertinence M2-c fiable pour son rush, elle est choisie sur l'image seule.
  const hook = segs.find((s) => s.phase === 'HOOK');
  if (hook && !pertinenceFiable(entrees[cleDe(hook.url)])) incertitudes.add('accroche choisie sur des critères visuels (pertinence du sujet inconnue ou non fiable)');
  const manque = !segs.length
    ? `aucun montage possible : moins de 2 extraits propres pour ${cible} s visées`
    : duree < cible - 0.5
      ? `matière propre insuffisante : ${Math.round(duree * 10) / 10} s réalisables sur ${cible} s visées — la vidéo est plus courte, sans répétition, ralenti ni remplissage`
      : null;
  return {
    version: 1, mode: 'passages', cible, dureeRealisable: r3(duree), manque, repetitions, replis,
    incertitudes: Array.from(incertitudes),
    plans: segs.map((s, i) => ({ cle: fen[i].cle, depuis: fen[i].depuis, jusqua: fen[i].jusqua, phase: s.phase ?? null, score: s.score ?? null, parole: s.parole ?? null, raison: s.raison ?? '' })),
    ecartes,
  };
}
