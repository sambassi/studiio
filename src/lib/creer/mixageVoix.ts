/**
 * MIXAGE VOIX / MUSIQUE — ducking automatique et sécurité du master.
 *
 * Constat (export Créer réel du 19/10, « LE SPORT LE PLUS COMPLET ») : −14,1
 * LUFS intégrés, LRA 3, crête ≈ 0 dBFS — un mix tenu par la MUSIQUE. Sans
 * keyframes (le cas par défaut de Créer), la musique restait à son niveau
 * statique (0,5 = −6 dB) sous toute la voix : un morceau masterisé ≈ −8 LUFS
 * sort alors ≈ −14 LUFS, quand la voix clonée est ≈ −20 LUFS. La voix passait
 * ≈ 6 dB SOUS la musique. Et les sources étaient sommées sans aucune marge.
 *
 * Ce module fournit, en fonctions PURES (testables sans navigateur) :
 *   1. la détection de la parole dans une piste décodée ;
 *   2. l'enveloppe de ducking de la musique, calée sur TOUTES les voix
 *      (voix globale, voix par séquence), en temps de montage ;
 *   3. son application sur un `AudioParam` (même fonction pour l'aperçu et
 *      l'export) ;
 *   4. la chaîne master : un limiteur transparent sous son seuil.
 *
 * ⚠️ LA VOIX N'EST JAMAIS TRAITÉE. Ni EQ, ni compression, ni gain : seule la
 * musique est baissée. Le limiteur du master est compensé (gain de rattrapage
 * annulé) : sous son seuil, il laisse passer le signal à l'identique.
 */
import { sampleKeyframes, type AudioKeyframe } from './audioDucking';

/** Réglages du ducking automatique (secondes et dB). */
export interface ReglagesDucking {
  profondeurDb: number; ecartCibleDb: number; profondeurMinDb: number; profondeurMaxDb: number;
  attaqueS: number; maintienS: number; relacheS: number; fenetreS: number;
  seuilDb: number; seuilRelatifDb: number; trouMaxS: number; paroleMinS: number;
  fondDb: number; ecartFondDb: number;
  cibleVoixRmsDb: number; gainMasterMinDb: number; gainMasterMaxDb: number;
}

/** Réglages du ducking automatique. */
export const DUCKING_VOIX: Readonly<ReglagesDucking> = Object.freeze({
  /**
   * Profondeur sous la voix (dB) quand les niveaux sont inconnus (musique
   * indécodable). Sinon : `profondeurAdaptative`.
   */
  profondeurDb: -18,
  /** Écart visé voix / musique pendant la parole (dB, RMS). */
  ecartCibleDb: 15,
  /** Bornes de la profondeur adaptative (dB). */
  profondeurMinDb: -12,
  profondeurMaxDb: -26,
  /** La musique commence à descendre AVANT la première syllabe (s). */
  attaqueS: 0.08,
  /** Tenue après la dernière syllabe avant de remonter (s). */
  maintienS: 0.15,
  /** Remontée douce dans les pauses (s). */
  relacheS: 0.6,
  /** Fenêtre d'analyse (s). */
  fenetreS: 0.02,
  /** Seuil absolu de parole (dBFS RMS). */
  seuilDb: -45,
  /** Seuil relatif : une trame à plus de 40 dB sous la plus forte est un silence. */
  seuilRelatifDb: -40,
  /** Deux mots séparés de moins de ça forment une seule phrase (s). */
  trouMaxS: 0.35,
  /** Un « segment » plus court est un clic, pas de la parole (s). */
  paroleMinS: 0.06,
  /** Niveau du « lit » musical hors parole (dB, ≤ 0) — calculé par le plan. */
  fondDb: 0,
  /**
   * Le lit musical ne dépasse JAMAIS la voix de plus de ça (dB, RMS), même
   * dans les pauses : sinon chaque pause fait « exploser » la musique et le
   * montage s'entend comme un clip musical avec une voix par-dessus.
   */
  ecartFondDb: 0,
  /** Niveau RMS visé pour la voix après normalisation du master (≈ −15 LUFS). */
  cibleVoixRmsDb: -17.5,
  gainMasterMinDb: -6,
  gainMasterMaxDb: 9,
});

export interface SegmentParole { start: number; end: number }
export interface PointGain { t: number; gain: number }

/** Plancher de gain pour les rampes exponentielles (qui refusent 0). */
const GAIN_MIN = 1e-4;

export const dbVersGain = (db: number): number => Math.pow(10, db / 20);

/**
 * Où ça parle dans cette piste ? Temps en secondes depuis le DÉBUT du fichier.
 * RMS par trames de 20 ms (moyenne des canaux), seuil absolu ET relatif,
 * micro-pauses comblées, clics écartés.
 */
export function detecterParole(
  canaux: Float32Array[],
  sampleRate: number,
  o: Partial<ReglagesDucking> = {},
): SegmentParole[] {
  const p = { ...DUCKING_VOIX, ...o };
  if (canaux.length === 0 || !(sampleRate > 0)) return [];
  const n = canaux[0].length;
  const taille = Math.max(1, Math.round(sampleRate * p.fenetreS));
  const trames = Math.ceil(n / taille);
  const db = new Float64Array(trames);
  let max = -Infinity;
  for (let i = 0; i < trames; i++) {
    const a = i * taille;
    const b = Math.min(n, a + taille);
    let s = 0;
    for (const c of canaux) for (let j = a; j < b; j++) s += c[j] * c[j];
    const rms = Math.sqrt(s / ((b - a) * canaux.length));
    db[i] = rms > 1e-9 ? 20 * Math.log10(rms) : -180;
    if (db[i] > max) max = db[i];
  }
  const seuil = Math.max(p.seuilDb, max + p.seuilRelatifDb);
  const bruts: SegmentParole[] = [];
  let debut: number | null = null;
  for (let i = 0; i < trames; i++) {
    const parle = db[i] > seuil;
    if (parle && debut === null) debut = i;
    if (!parle && debut !== null) { bruts.push({ start: debut * taille / sampleRate, end: i * taille / sampleRate }); debut = null; }
  }
  if (debut !== null) bruts.push({ start: debut * taille / sampleRate, end: n / sampleRate });
  return fusionnerSegments(bruts, p.trouMaxS).filter((s) => s.end - s.start >= p.paroleMinS);
}

/** Niveau RMS (dBFS) d'une piste, limité aux `segments` s'ils sont fournis. */
export function niveauRmsDb(canaux: Float32Array[], sampleRate: number, segments?: SegmentParole[]): number {
  if (canaux.length === 0) return -180;
  const n = canaux[0].length;
  const zones = segments ?? [{ start: 0, end: n / sampleRate }];
  let s = 0;
  let compte = 0;
  for (const z of zones) {
    const a = Math.max(0, Math.floor(z.start * sampleRate));
    const b = Math.min(n, Math.ceil(z.end * sampleRate));
    for (const c of canaux) for (let j = a; j < b; j++) s += c[j] * c[j];
    compte += Math.max(0, b - a) * canaux.length;
  }
  return compte > 0 && s > 0 ? 10 * Math.log10(s / compte) : -180;
}

/** Moyenne en PUISSANCE de niveaux en dB (pondérée par leurs durées). */
export function moyenneDb(niveaux: Array<{ db: number; duree: number }>): number {
  let p = 0;
  let d = 0;
  for (const x of niveaux) {
    if (!(x.duree > 0) || x.db <= -180) continue;
    p += Math.pow(10, x.db / 10) * x.duree;
    d += x.duree;
  }
  return d > 0 ? 10 * Math.log10(p / d) : -180;
}

/**
 * Profondeur du ducking calée sur les VRAIS niveaux : la musique (à son
 * niveau réglé) doit passer `ecartCibleDb` sous la voix pendant la parole.
 * Une musique masterisée fort sous une voix clonée discrète réclame plus
 * qu'une baisse fixe — c'est exactement le cas de l'export du 19/10.
 * Bornée : au moins −12 dB (une baisse audible), au plus −26 dB (la musique
 * reste un fond, jamais un trou).
 */
export function profondeurAdaptative(
  voixDb: number,
  musiqueDb: number,
  o: Partial<ReglagesDucking> = {},
): number {
  const p = { ...DUCKING_VOIX, ...o };
  if (!(voixDb > -120) || !(musiqueDb > -120)) return p.profondeurDb;
  const voulu = voixDb - p.ecartCibleDb - musiqueDb;
  return Math.max(p.profondeurMaxDb, Math.min(p.profondeurMinDb, voulu));
}

/** Union triée ; deux segments séparés de moins de `trouMax` fusionnent. */
export function fusionnerSegments(segments: SegmentParole[], trouMax = 0): SegmentParole[] {
  const tri = segments.filter((s) => s.end > s.start).map((s) => ({ ...s })).sort((a, b) => a.start - b.start);
  const out: SegmentParole[] = [];
  for (const s of tri) {
    const der = out[out.length - 1];
    if (der && s.start - der.end <= trouMax) der.end = Math.max(der.end, s.end);
    else out.push(s);
  }
  return out;
}

/**
 * Place les segments d'une piste dans le temps du MONTAGE : décalés de
 * `depart`, coupés à `fin` (la voix d'une séquence s'arrête avec elle).
 */
export function placerParole(segments: SegmentParole[], depart: number, fin = Infinity): SegmentParole[] {
  return segments
    .map((s) => ({ start: s.start + depart, end: Math.min(s.end + depart, fin) }))
    .filter((s) => s.end > s.start && s.start < fin);
}

/** Retire une fenêtre (ex. la séquence du jumeau, déjà duckée à part). */
export function soustraireFenetre(segments: SegmentParole[], f: SegmentParole | null): SegmentParole[] {
  if (!f || !(f.end > f.start)) return segments;
  const out: SegmentParole[] = [];
  for (const s of segments) {
    if (s.end <= f.start || s.start >= f.end) { out.push(s); continue; }
    if (s.start < f.start) out.push({ start: s.start, end: f.start });
    if (s.end > f.end) out.push({ start: f.end, end: s.end });
  }
  return out;
}

/**
 * Enveloppe du ducking (facteur multiplicatif de la musique, 1 = intact) :
 * descente en `attaqueS` qui S'ACHÈVE au début de la parole, tenue, puis
 * remontée en `relacheS`. Deux phrases trop proches pour que la musique ait
 * le temps de remonter restent sous la même baisse (pas de « pompage »).
 */
export function enveloppeDucking(segments: SegmentParole[], o: Partial<ReglagesDucking> = {}): PointGain[] {
  const p = { ...DUCKING_VOIX, ...o };
  const haut = Math.max(GAIN_MIN, Math.min(1, dbVersGain(p.fondDb)));
  const bas = Math.max(GAIN_MIN, haut * dbVersGain(p.profondeurDb));
  const blocs = fusionnerSegments(segments, p.attaqueS + p.maintienS + p.relacheS);
  const pts: PointGain[] = [{ t: 0, gain: haut }];
  for (const b of blocs) {
    const debutDescente = Math.max(0, b.start - p.attaqueS);
    const finDescente = Math.max(b.start, debutDescente + 1e-3);
    if (debutDescente > pts[pts.length - 1].t) pts.push({ t: debutDescente, gain: haut });
    pts.push({ t: finDescente, gain: bas });
    const finTenue = Math.max(finDescente, b.end + p.maintienS);
    pts.push({ t: finTenue, gain: bas });
    pts.push({ t: finTenue + p.relacheS, gain: haut });
  }
  return pts;
}

/** Valeur de l'enveloppe à `t` — interpolation exponentielle, comme l'AudioParam. */
export function facteurEnveloppe(t: number, points: PointGain[]): number {
  if (points.length === 0) return 1;
  if (t <= points[0].t) return points[0].gain;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (t < b.t) {
      const u = (t - a.t) / (b.t - a.t);
      const ga = Math.max(GAIN_MIN, a.gain);
      const gb = Math.max(GAIN_MIN, b.gain);
      return ga * Math.pow(gb / ga, u);
    }
  }
  return points[points.length - 1].gain;
}

/**
 * Les keyframes MANUELLES de l'utilisateur sont respectées : le ducking
 * automatique est un PLAFOND (`base × enveloppe`), jamais un multiplicateur
 * aveugle. Là où l'utilisateur a déjà baissé la musique plus bas, rien ne
 * change (facteur 1) ; là où il ne l'a pas fait, la musique est ramenée au
 * plafond. Sans keyframes, le gain de la musique vaut `base` : facteur =
 * enveloppe. Le résultat s'applique sur un GainNode APRÈS celui de la musique.
 */
export function enveloppeSousKeyframes(
  enveloppe: PointGain[],
  keyframes: AudioKeyframe[] | undefined,
  base: number,
): PointGain[] {
  if (!keyframes || keyframes.length === 0 || !(base > 0)) return enveloppe;
  const kf = [...keyframes].sort((a, b) => a.time - b.time);
  const instants = new Set<number>(enveloppe.map((p) => p.t));
  for (const k of kf) {
    if (k.time > 0) { instants.add(Math.max(0, k.time - 1e-3)); instants.add(k.time); }
  }
  return [...instants].sort((a, b) => a - b).map((t) => {
    const env = facteurEnveloppe(t, enveloppe);
    const niveau = sampleKeyframes(kf, t).musicVolume;
    const g = niveau > 0 ? Math.min(1, (base * env) / niveau) : 1;
    return { t, gain: Math.max(GAIN_MIN, g) };
  });
}

/** Sous-ensemble d'`AudioParam` utilisé — testable avec un faux. */
export interface ParamAutomatisable {
  cancelScheduledValues(t: number): unknown;
  setValueAtTime(v: number, t: number): unknown;
  exponentialRampToValueAtTime(v: number, t: number): unknown;
}

/** Programme l'enveloppe sur l'horloge audio, `t0` = début du montage. */
export function planifierEnveloppe(param: ParamAutomatisable, points: PointGain[], t0: number): void {
  param.cancelScheduledValues(0);
  if (points.length === 0) { param.setValueAtTime(1, t0); return; }
  param.setValueAtTime(Math.max(GAIN_MIN, points[0].gain), t0 + points[0].t);
  // Paramètre sans rampe exponentielle (faux contexte) : paliers.
  const rampe = typeof param.exponentialRampToValueAtTime === 'function'
    ? (v: number, t: number) => param.exponentialRampToValueAtTime(v, t)
    : (v: number, t: number) => param.setValueAtTime(v, t);
  for (let i = 1; i < points.length; i++) {
    rampe(Math.max(GAIN_MIN, points[i].gain), t0 + points[i].t);
  }
}

/** Une voix du montage : sa parole (temps du fichier), où elle démarre, où elle est coupée. */
export interface SourceVoix {
  segments: SegmentParole[];
  depart: number;
  fin?: number;
  /** Niveau RMS (dBFS) de la voix PENDANT sa parole, si mesuré. */
  niveauDb?: number;
  /** Crête échantillon (dBFS) de la voix, si mesurée. */
  creteDb?: number;
}

/**
 * Plan complet du ducking de la musique pour un montage. `exclusion` : une
 * fenêtre déjà duckée par ailleurs (séquence du jumeau) — pas de double baisse.
 */
export function planDuckingVoix(args: {
  sources: SourceVoix[];
  exclusion?: SegmentParole | null;
  keyframes?: AudioKeyframe[];
  base: number;
  /** Niveau RMS (dBFS) du FICHIER musique, avant son gain. Absent : profondeur fixe. */
  musiqueFichierDb?: number;
  reglages?: Partial<ReglagesDucking>;
}): PointGain[] {
  const parole = fusionnerSegments(args.sources.flatMap((s) => placerParole(s.segments, s.depart, s.fin)));
  const utile = soustraireFenetre(parole, args.exclusion ?? null);
  if (utile.length === 0) return [];
  const { fondDb, profondeurDb } = niveauxPlan(args);
  return enveloppeSousKeyframes(enveloppeDucking(utile, { ...args.reglages, fondDb, profondeurDb }), args.keyframes, args.base);
}

/** Niveau RMS moyen des voix pendant leur parole (dBFS), -180 si inconnu. */
export function niveauVoixDb(sources: SourceVoix[]): number {
  return moyenneDb(sources
    .filter((s) => typeof s.niveauDb === 'number')
    .map((s) => ({ db: s.niveauDb as number, duree: s.segments.reduce((d, g) => d + (g.end - g.start), 0) })));
}

/**
 * Niveaux du plan, calés sur les VRAIS niveaux quand ils sont connus :
 *   - `fondDb` (≤ 0) : le lit musical hors parole ne dépasse pas la voix ;
 *   - `profondeurDb` : baisse SUPPLÉMENTAIRE sous la parole pour que la
 *     musique y passe `ecartCibleDb` sous la voix.
 * Niveaux inconnus (décodage impossible) : lit intact, profondeur fixe.
 */
export function niveauxPlan(args: {
  sources: SourceVoix[];
  base: number;
  musiqueFichierDb?: number;
  reglages?: Partial<ReglagesDucking>;
}): { fondDb: number; profondeurDb: number } {
  const p = { ...DUCKING_VOIX, ...args.reglages };
  const voixDb = niveauVoixDb(args.sources);
  if (typeof args.musiqueFichierDb !== 'number' || !(args.base > 0) || !(voixDb > -120)) {
    return { fondDb: 0, profondeurDb: p.profondeurDb };
  }
  const musiqueBaseDb = args.musiqueFichierDb + 20 * Math.log10(args.base);
  const fondDb = Math.min(0, voixDb + p.ecartFondDb - musiqueBaseDb);
  return { fondDb, profondeurDb: profondeurAdaptative(voixDb, musiqueBaseDb + fondDb, p) };
}

/**
 * Normalisation du master (dB), appliquée À TOUT LE MIX à l'identique :
 * amène la voix vers `cibleVoixRmsDb` (≈ −15 LUFS intégrés), sans jamais
 * pousser ses crêtes dans le limiteur (0,5 dB de marge sous son seuil) — la
 * voix n'est donc jamais limitée. Une voix très dynamique (crête −5,6 dBFS
 * pour −25,8 dBFS RMS) ne monte donc que de quelques dB : on accepte un mix
 * plus discret plutôt que de compresser la voix. Niveaux inconnus : 0 dB (rien ne bouge).
 */
export function gainMasterDb(sources: SourceVoix[], o: Partial<ReglagesDucking> = {}): number {
  const p = { ...DUCKING_VOIX, ...o };
  const voixDb = niveauVoixDb(sources);
  if (!(voixDb > -120)) return 0;
  const cretes = sources.map((s) => s.creteDb).filter((c): c is number => typeof c === 'number');
  const crete = cretes.length > 0 ? Math.max(...cretes) : -Infinity;
  const voulu = p.cibleVoixRmsDb - voixDb;
  const plafondCrete = crete > -120 ? (LIMITEUR_MASTER.seuilDb - MARGE_CRETE_VOIX_DB) - crete : p.gainMasterMaxDb;
  return Math.max(p.gainMasterMinDb, Math.min(p.gainMasterMaxDb, voulu, plafondCrete));
}

// ── MASTER ──────────────────────────────────────────────────────────────

/** Marge (dB) gardée entre les crêtes de la voix normalisée et le seuil du limiteur. */
export const MARGE_CRETE_VOIX_DB = 0.5;

/** Limiteur de sécurité du master. */
export const LIMITEUR_MASTER = {
  seuilDb: -2,
  ratio: 20,
  knee: 0,
  attaqueS: 0.001,
  relacheS: 0.1,
} as const;

/**
 * Le `DynamicsCompressorNode` applique d'office un gain de rattrapage
 * (spécification Web Audio : `(1 / gainPleineEchelle) ^ 0,6`). On l'annule
 * avec un gain de sortie, pour que le limiteur soit TRANSPARENT sous son
 * seuil : ni la voix ni la musique ne changent de niveau, seules les crêtes
 * au-dessus de −2 dBFS sont tenues.
 */
export function compensationLimiteur(seuilDb = LIMITEUR_MASTER.seuilDb, ratio = LIMITEUR_MASTER.ratio): number {
  const sortiePleineEchelleDb = seuilDb + (0 - seuilDb) / ratio;
  return Math.pow(dbVersGain(sortiePleineEchelleDb), 0.6);
}

/**
 * Chaîne master : entrée → limiteur → compensation → `destination`.
 * Rend le nœud d'ENTRÉE, où brancher toutes les sources.
 */
export function creerChaineMaster(ctx: BaseAudioContext, destination: AudioNode): GainNode {
  const entree = ctx.createGain();
  entree.gain.value = 1;
  // Contexte sans compresseur (très vieux navigateur, faux contexte de test) :
  // pas de limiteur plutôt qu'un export cassé.
  if (typeof (ctx as Partial<BaseAudioContext>).createDynamicsCompressor !== 'function') {
    entree.connect(destination);
    return entree;
  }
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = LIMITEUR_MASTER.seuilDb;
  lim.ratio.value = LIMITEUR_MASTER.ratio;
  lim.knee.value = LIMITEUR_MASTER.knee;
  lim.attack.value = LIMITEUR_MASTER.attaqueS;
  lim.release.value = LIMITEUR_MASTER.relacheS;
  const comp = ctx.createGain();
  comp.gain.value = compensationLimiteur();
  entree.connect(lim);
  lim.connect(comp);
  comp.connect(destination);
  return entree;
}

/** Décode une URL pour la détection — `null` en cas d'échec (jamais bloquant). */
export async function decoderPourDetection(ctx: BaseAudioContext, url: string): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const octets = await res.arrayBuffer();
    return await ctx.decodeAudioData(octets.slice(0));
  } catch {
    return null;
  }
}

function canauxDe(buf: AudioBuffer): Float32Array[] {
  const canaux: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) canaux.push(buf.getChannelData(c));
  return canaux;
}

/** Parole d'un AudioBuffer décodé. */
export function paroleDuBuffer(buf: AudioBuffer): SegmentParole[] {
  return detecterParole(canauxDe(buf), buf.sampleRate);
}

/** Parole, niveau pendant la parole et crête d'une voix décodée. */
export function analyserVoix(buf: AudioBuffer): { segments: SegmentParole[]; niveauDb: number; creteDb: number } {
  const canaux = canauxDe(buf);
  const segments = detecterParole(canaux, buf.sampleRate);
  let crete = 0;
  for (const c of canaux) for (let i = 0; i < c.length; i++) { const v = Math.abs(c[i]); if (v > crete) crete = v; }
  return { segments, niveauDb: niveauRmsDb(canaux, buf.sampleRate, segments), creteDb: crete > 0 ? 20 * Math.log10(crete) : -180 };
}

/** Niveau RMS (dBFS) d'un fichier musique décodé (2 premières minutes). */
export function niveauMusiqueDb(buf: AudioBuffer): number {
  return niveauRmsDb(canauxDe(buf), buf.sampleRate, [{ start: 0, end: Math.min(buf.duration, 120) }]);
}
