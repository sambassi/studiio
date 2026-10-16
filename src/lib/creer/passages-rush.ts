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
import { ecartEmpreinte, memeTimecode } from '@/lib/creer/smart-montage-regles';

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
  incertitudes: string[];
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
  const paroleLocalisable = silencesFournis && entrees.pisteAudio !== false && partSonore <= S.partSonoreMax;
  if (entrees.pisteAudio !== false && E.some((x) => x.audio > S.audioMuet)) {
    if (!silencesFournis) incertitudes.push('parole non vérifiée : aucun silence mesuré finement (trames de 50 ms) — le RMS de 0,5 s ne prouve ni un silence ni une fin de phrase');
    else if (partSonore > S.partSonoreMax) incertitudes.push(`son quasi continu (${Math.round(partSonore * 100)} % du temps) : parole et musique indiscernables, aucune pause garantie`);
  } else if (entrees.pisteAudio == null) {
    incertitudes.push('audio nul sans sonde : piste absente ou non décodée, indiscernable d\'un silence');
  }

  if (!(a.duree > 0) || E.length === 0) {
    return { pas, resolution: 'grossiere', zones: [], passages: [], ecartes: [], partSonore, paroleLocalisable: false, incertitudes: [...incertitudes, 'rush sans mesure'] };
  }
  if (pas > S.pasGrossierS) {
    incertitudes.push(`mesures espacées de ${r3(pas)} s (images-clés) : aucun changement de plan interne localisable, le rush entier forme un seul passage`);
    const passages: Passage[] = finUtile - debutUtile >= S.passageMinS
      ? [{ debut: r3(debutUtile), fin: r3(finUtile), motifDebut: 'debut_rush', motifFin: 'fin_rush', gestes: [] }]
      : [];
    return { pas, resolution: 'grossiere', zones: [], passages, ecartes: [], partSonore, paroleLocalisable, incertitudes };
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
  return { pas, resolution: 'fine', zones, passages, ecartes, partSonore, paroleLocalisable, incertitudes };
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
  if ((entrees.plagesParole ?? []).some(([x, y]) => dans(s, [x + 0.05, y - 0.05]) || dans(e, [x + 0.05, y - 0.05]))) {
    return { ok: false, motif: 'borne au milieu d\'une parole horodatée' };
  }
  return { ok: true, passage: p };
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
  const borne = (t: number): ParoleBorne => (d.paroleLocalisable && (entrees.silences ?? []).some(([x, y]) =>
    y - x >= S.silenceMinS - 1e-6 && t >= x + S.silenceMargeS - 1e-6 && t <= y - S.silenceMargeS + 1e-6) ? 'pause_franche' : 'incertaine');
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
  ctx: { pertinence: number | null | undefined; departPassage: boolean; prolongeAction: boolean },
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
    const d = decouperPassages(a, entrees[cle] ?? {});
    if (utilisees.has(cle)) d.incertitudes.forEach((x) => incertitudes.add(`${cle.split('/').pop()} : ${x}`));
    else ecartes.push({ cle, motif: d.passages.length ? 'aucun passage retenu (score, cohérence ou répétition)' : 'aucun passage utilisable' });
  }
  const incertainesN = segs.filter((s) => s.parole && (s.parole.debut === 'incertaine' || s.parole.fin === 'incertaine')).length;
  if (incertainesN) incertitudes.add(`${incertainesN} extrait(s) dont une borne peut tomber dans un son (parole non vérifiée)`);
  if (replis) incertitudes.add(`${replis} extrait(s) pris faute d'alternative : coupe possible au milieu d'un plan`);
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
