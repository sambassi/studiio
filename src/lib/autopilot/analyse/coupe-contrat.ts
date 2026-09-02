/**
 * M3-E — LE CONTRAT DES COUPES INTELLIGENTES.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE M3-E EST, ET CE QU'IL N'EST PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * M3-C choisit un passage sur des IMAGES : il ne sait rien du son. M3-D1
 * mesure les silences, M3-D2 rend la parole horodatée. M3-E ne choisit
 * RIEN — il prend la fenêtre de M3-C et en POLIT les bords, pour qu'une
 * coupe ne tombe pas au milieu d'un mot.
 *
 * Trois conséquences, dans cet ordre :
 *
 *   1. M3-C fait autorité. `rang`, `scoreMontage` et `raison` sont recopiés
 *      sans un chiffre de différence.
 *   2. Le mouvement MINIMAL l'emporte. Un point d'ancrage plus « noble »
 *      mais plus lointain est un moins bon point.
 *   3. Le doute conserve. Sans donnée exploitable, la fenêtre M3-C est
 *      rendue telle quelle — ce n'est pas un échec, c'est un résultat.
 *
 * ⚠️ AUCUNE PERSISTANCE, AUCUN FOURNISSEUR, AUCUN COÛT. M3-C et M3-D2 ont
 * une table parce qu'ils appellent un service payant, et que payer deux fois
 * devait être impossible. M3-E ne paie rien : recalculer est gratuit,
 * instantané et déterministe. Une table lui donnerait une migration, un
 * versionnement, une concurrence et une péremption à gérer pour protéger un
 * calcul qui se refait en une milliseconde. La décision se figera au rendu,
 * quand il y aura enfin quelque chose dont être comptable.
 */
import type { CandidatMontage } from './candidat-contrat';
import type { SilenceAudio } from './audio-contrat';
import type { IntervalleTexte } from './transcription-contrat';

// ─────────────────────────────────────────────────────────────────────────
// L'identité de l'algorithme
// ─────────────────────────────────────────────────────────────────────────

/**
 * La version des heuristiques, rendue dans chaque réponse.
 *
 * Coût : une chaîne. Bénéfice : le jour où les règles changent, un montage
 * déjà décidé dit sous quelle règle il l'a été, et ne devient pas
 * incompréhensible. C'est le genre de champ qu'on ne peut pas ajouter
 * rétroactivement.
 */
export const ALGORITHME_COUPES = 'm3e-v2' as const;

// ─────────────────────────────────────────────────────────────────────────
// Deux fois le même moment n'est pas un montage
// ─────────────────────────────────────────────────────────────────────────

/**
 * La part maximale d'image commune entre DEUX fenêtres retenues.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE DÉFAUT, CONSTATÉ EN PRODUCTION
 * ─────────────────────────────────────────────────────────────────────────
 *
 * M3-C classe les passages, il ne les rend pas disjoints. Sur le rush de
 * production du 2026-09-02, le modèle a proposé :
 *
 *   #1  3,2 s → 11,2 s
 *   #2  0,0 s →  8,0 s
 *
 * soit 4,8 secondes — plus de la moitié de chaque fenêtre — communes aux
 * deux. M3-E les calait indépendamment, M3-F en extrayait deux clips, et
 * `planifierMontage` — qui n'utilise pourtant chaque clip qu'UNE fois —
 * plaçait donc bel et bien deux fois la même image dans la vidéo.
 *
 * ⚠️ LE FILTRE VIT ICI, ET PAS PLUS LOIN. En M3-F, on aurait déjà payé un
 * ffmpeg par clip inutile ; en M3-G, on aurait dû défaire une décision au
 * lieu de ne pas la prendre. M3-E est le premier endroit où les fenêtres
 * FINALES existent — après calage, donc après que les bornes ont bougé.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI LA MOITIÉ, ET DE LA PLUS COURTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Rapportée à la plus COURTE des deux fenêtres : une fenêtre brève entièrement
 * contenue dans une longue est un doublon total, même si elle ne couvre qu'un
 * tiers de sa voisine. Rapporter à l'union, ou à la plus longue, laisserait
 * passer précisément ce cas-là.
 *
 * Le seuil à la moitié est le point où l'on cesse de voir deux plans pour
 * voir deux fois le même. En deçà, deux fenêtres partagent une minorité
 * d'images et se lisent encore comme deux moments ; au-delà, la répétition
 * saute aux yeux. Sur le cas réel ci-dessus : 4,8 / 8,0 = 0,6 — écarté.
 */
export const CHEVAUCHEMENT_MAX = 0.5;

/** Une fenêtre temporelle, réduite à ce que la comparaison exige. */
export interface Fenetre {
  debutSecondes: number;
  finSecondes: number;
}

/**
 * La part d'image commune à deux fenêtres, entre 0 et 1.
 *
 * Rendue par rapport à la plus COURTE des deux — voir `CHEVAUCHEMENT_MAX`.
 * Deux fenêtres disjointes rendent 0 ; une fenêtre incluse dans l'autre rend
 * 1. Une fenêtre de durée nulle ou non finie rend 0 : on ne divise pas par
 * une durée qu'on n'a pas mesurée.
 */
export function chevauchement(a: Fenetre, b: Fenetre): number {
  const da = nombreFini(a?.finSecondes) !== null && nombreFini(a?.debutSecondes) !== null
    ? a.finSecondes - a.debutSecondes : 0;
  const db = nombreFini(b?.finSecondes) !== null && nombreFini(b?.debutSecondes) !== null
    ? b.finSecondes - b.debutSecondes : 0;
  if (!(da > 0) || !(db > 0)) return 0;

  const commun = Math.min(a.finSecondes, b.finSecondes)
    - Math.max(a.debutSecondes, b.debutSecondes);
  if (!(commun > 0)) return 0;
  return commun / Math.min(da, db);
}

/** Deux fenêtres montrent-elles trop souvent la même chose ? */
export function chevauchentTrop(a: Fenetre, b: Fenetre): boolean {
  return chevauchement(a, b) > CHEVAUCHEMENT_MAX;
}

/**
 * Écarte les fenêtres qui répètent une fenêtre déjà retenue.
 *
 * ⚠️ DÉTERMINISTE, ET « LE MIEUX CLASSÉ GAGNE ». La liste arrive triée par
 * rang — l'ordre de qualité de M3-C. On garde en avançant : une fenêtre n'est
 * écartée que par une fenêtre MIEUX classée qu'elle. Deux appels sur les
 * mêmes données rendent donc le même résultat, ce dont dépend la
 * réutilisation d'un jeu de clips.
 *
 * Ne renumérote RIEN : `rang` reste celui de M3-C, parce que c'est lui que
 * l'écran affiche et que M3-F met dans la clé de stockage du clip.
 */
export function ecarterChevauchements<T extends Fenetre>(fenetres: readonly T[]): T[] {
  const gardees: T[] = [];
  for (const f of fenetres) {
    if (gardees.some((g) => chevauchentTrop(g, f))) continue;
    gardees.push(f);
  }
  return gardees;
}

// ─────────────────────────────────────────────────────────────────────────
// Les bornes
// ─────────────────────────────────────────────────────────────────────────

/**
 * De combien une borne a le droit de bouger, en secondes.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ POURQUOI 0,750 ET NON 1,5 — ET POURQUOI C'EST AUSSI CE QUI PROTÈGE
 *    DES HORODATAGES FANTAISISTES
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Simulée sur les candidats réels de production, la règle rend le MÊME
 * résultat de 0,75 s à 2,0 s de tolérance : les points d'ancrage utiles sont
 * à quelques centièmes. La tolérance n'est donc pas le moteur du calage,
 * c'est son GARDE-FOU — et à résultat égal, on prend le plus serré.
 *
 * Ce serrage a un second effet, décisif. Un transcripteur produit parfois des
 * horodatages absurdes : sur notre rush de référence, le premier « mot »
 * couvre 10,36 s et le premier segment 21 s pour six mots. Leurs frontières
 * sont alors, par construction, TRÈS LOIN de la borne visuelle — donc hors
 * tolérance, donc ignorées. Une borne étroite écarte les données fantaisistes
 * sans avoir besoin d'un filtre statistique qui, lui, aurait à décider ce
 * qu'est un mot « vraisemblable ».
 *
 * Une médiane de mot français tient autour de 0,2 s : 0,750 s couvre donc
 * plusieurs mots, et reste sous le quart d'un clip de trois secondes.
 */
export const TOLERANCE_SECONDES = 0.75;

/**
 * De combien la DURÉE finale peut s'écarter de celle de M3-C.
 *
 * Proportionnelle, et plafonnée. Une borne absolue unique serait fausse aux
 * deux bouts : 1 s sur un clip de 12 s est un détail, 1 s sur un clip de 3 s
 * en change le tiers.
 *
 *   3 s  → 0,750 s     8 s  → 1,000 s
 *   5 s  → 1,000 s    12 s  → 1,000 s
 */
export function gardeDuree(dureeCibleSecondes: number): number {
  const cible = Number.isFinite(dureeCibleSecondes) ? dureeCibleSecondes : 0;
  return Math.min(1, 0.25 * Math.max(0, cible));
}

/** Le nombre de décimales des instants. La même que partout ailleurs. */
export const DECIMALES = 3;

/** Trois décimales, et pas un chiffre de plus. `-0` ramené à `0`. */
export function arrondirSeconde(n: number): number {
  const f = 10 ** DECIMALES;
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/** Un nombre utilisable, ou `null`. `NaN` et `±Infinity` valent `null`. */
export function nombreFini(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * La marge de comparaison des distances, en secondes.
 *
 * Deux ancrages à moins d'un millième l'un de l'autre sont à ÉGALITÉ : c'est
 * la précision du contrat, et comparer plus finement ferait dépendre le
 * résultat d'un bruit d'arrondi — donc casserait le déterminisme.
 */
export const EGALITE_SECONDES = 10 ** -DECIMALES;

// ─────────────────────────────────────────────────────────────────────────
// Le vocabulaire
// ─────────────────────────────────────────────────────────────────────────

/**
 * D'où vient le point sur lequel une borne s'est posée.
 *
 * L'ordre de cette liste EST l'ordre de départage — et il ne sert qu'à
 * départager : la proximité passe d'abord, toujours.
 */
export const SOURCES_ANCRAGE = ['silence', 'segment', 'mot', 'aucun'] as const;
export type SourceAncrage = (typeof SOURCES_ANCRAGE)[number];

/** Le rang de départage. Plus petit = préféré, à distance égale seulement. */
export function rangSource(source: SourceAncrage): number {
  const i = (SOURCES_ANCRAGE as readonly string[]).indexOf(source);
  return i < 0 ? SOURCES_ANCRAGE.length : i;
}

/**
 * Ce que la parole a apporté au calcul.
 *
 * ⚠️ À NE PAS CONFONDRE AVEC `transcription.source`, qui dit LAQUELLE a été
 * retenue. Ici on dit si elle a SERVI. Les deux sont nécessaires :
 * « la dernière a été retenue » et « ses horodatages étaient inutilisables »
 * sont deux faits distincts, et c'est leur conjonction qui explique une
 * fenêtre restée inchangée.
 */
export const ETATS_PAROLE = ['exploitee', 'sans_parole', 'ecartee', 'absente'] as const;
export type EtatParole = (typeof ETATS_PAROLE)[number];

/** Ce que la mesure audio de M3-D1 a apporté. Zéro silence n'est pas un échec. */
export const ETATS_AUDIO = ['exploitee', 'sans_silence', 'absente', 'indisponible'] as const;
export type EtatAudio = (typeof ETATS_AUDIO)[number];

/** D'où vient la transcription retenue — la provenance, pas l'exploitabilité. */
export const SOURCES_TRANSCRIPTION = ['demandee', 'derniere', 'aucune'] as const;
export type SourceTranscription = (typeof SOURCES_TRANSCRIPTION)[number];

// ─────────────────────────────────────────────────────────────────────────
// Les formes
// ─────────────────────────────────────────────────────────────────────────

export interface Ajustement {
  /** Déplacement signé, en secondes. `0` quand la borne n'a pas bougé. */
  deltaSecondes: number;
  source: SourceAncrage;
}

export interface Coupe {
  // ── Repris de M3-C, sans un chiffre de différence ────────────────────
  rang: number;
  secondeReference: number;
  dureeCibleSecondes: number;
  scoreMontage: number;
  raison: string;

  // ── La fenêtre d'origine, gardée pour que le calage soit lisible ─────
  debutOriginalSecondes: number;
  finOriginalSecondes: number;

  // ── La fenêtre finale ────────────────────────────────────────────────
  debutSecondes: number;
  finSecondes: number;
  dureeSecondes: number;

  ajustementDebut: Ajustement;
  ajustementFin: Ajustement;
}

/** L'état des deux sources, pour expliquer une fenêtre qui n'a pas bougé. */
export interface SourcesCoupes {
  parole: EtatParole;
  audio: EtatAudio;
}

export interface ResultatCoupes {
  algorithme: typeof ALGORITHME_COUPES;
  sources: SourcesCoupes;
  coupes: Coupe[];
}

/**
 * Ce que le moteur reçoit — des DONNÉES, jamais un accès.
 *
 * Aucune base, aucun réseau, aucun identifiant : le service lit, le moteur
 * décide. C'est ce qui rend le calage testable sans rien monter.
 */
export interface EntreeCoupes {
  /** La durée MESURÉE du rush. Elle borne tous les instants rendus. */
  dureeRushSecondes: number;
  /** Les candidats de M3-C. JAMAIS mutés. */
  candidats: readonly CandidatMontage[];
  /** Les silences de M3-D1, tels que l'analyse SOURCE les porte. */
  silences: readonly SilenceAudio[];
  /** L'état de la mesure audio, tel que M3-D1 l'a écrit. */
  audioEtatMesure: 'mesuree' | 'absente' | 'indisponible';
  /** `false` quand aucune transcription n'a été retenue. */
  transcriptionRetenue: boolean;
  /** `presente` de la transcription retenue. Sans objet si aucune. */
  parolePresente: boolean;
  segments: readonly IntervalleTexte[];
  mots: readonly IntervalleTexte[];
}

// ─────────────────────────────────────────────────────────────────────────
// Les contrôles structurels
// ─────────────────────────────────────────────────────────────────────────

/**
 * Un intervalle utilisable par le calage.
 *
 * ⚠️ STRUCTUREL, ET RIEN DE PLUS. On vérifie que l'intervalle EXISTE en tant
 * que tel — nombres finis, ordonnés, dans le rush. On ne juge pas s'il est
 * « vraisemblable » : décider qu'un mot de trois secondes n'en est pas un
 * demanderait un modèle de la parole que ce lot n'a pas, et se tromperait sur
 * une langue qu'on n'a pas testée. C'est `TOLERANCE_SECONDES` qui écarte les
 * horodatages fantaisistes, en les laissant hors de portée.
 */
export function intervalleUtilisable(v: unknown, dureeRush: number): boolean {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const d = nombreFini(o.debutSecondes);
  const f = nombreFini(o.finSecondes);
  if (d === null || f === null) return false;
  if (d < 0 || !(d < f)) return false;
  return f <= dureeRush + EGALITE_SECONDES;
}

/** Un candidat relu est-il exploitable comme fenêtre de départ ? */
export function candidatUtilisable(c: unknown, dureeRush: number): c is CandidatMontage {
  if (typeof c !== 'object' || c === null || Array.isArray(c)) return false;
  const o = c as Record<string, unknown>;
  for (const cle of ['rang', 'secondeReference', 'dureeCibleSecondes',
    'debutSecondes', 'finSecondes', 'scoreMontage']) {
    if (nombreFini(o[cle]) === null) return false;
  }
  const d = o.debutSecondes as number;
  const f = o.finSecondes as number;
  const r = o.secondeReference as number;
  if (d < 0 || !(d < f) || f > dureeRush + EGALITE_SECONDES) return false;
  return r >= d && r <= f;
}
