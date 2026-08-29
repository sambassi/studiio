/**
 * L'étape VISUELLE de l'analyse : les vignettes, lues et données à voir.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE FAIT, ET CE QU'IL NE FAIT PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Il relit au plus huit JPEG déjà produites par l'extraction, les borne, et
 * les remet à un FOURNISSEUR. Il ne parle à aucun réseau lui-même : le
 * fournisseur est injecté, et tant que personne n'en injecte un, cette étape
 * n'existe pas — l'analyse se clôt à `extraction`, exactement comme avant.
 *
 * ⚠️ AUCUN ADAPTATEUR RÉEL N'EST LIVRÉ DANS CE LOT. Il n'y a ici ni clé
 * d'API, ni point d'accès, ni `fetch`. L'invite est écrite (`visuel-invite.ts`)
 * mais n'est envoyée nulle part. Brancher un fournisseur réel est un lot à
 * part, et c'est délibéré : une dépendance ajoutée maintenant serait inerte,
 * non testée, et affaiblirait la preuve « ce chemin ne parle à aucune IA » qui
 * verrouille M3-B2.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ CE MODULE BUFFERISE, ET C'EST L'EXCEPTION ASSUMÉE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `minio-client.ts` dit « rien n'est matérialisé en mémoire par ce fichier, et
 * l'appelant doit se garder de le faire ». Un modèle de vision ne lit pas un
 * flux : l'octet doit exister en mémoire. La règle n'est pas abandonnée, elle
 * est REMPLACÉE par trois bornes qui se recouvrent :
 *
 *   1. `statObject` d'abord — refuse le vide et le trop gros AVANT de
 *      transférer un seul octet ;
 *   2. le compteur du flux — qui DÉTRUIT la socket au dépassement, parce que
 *      cesser de lire ne fait pas cesser d'arriver ;
 *   3. une borne GLOBALE du lot, parce que huit fois « acceptable » peut ne
 *      pas l'être.
 */
import { clientMinio, lecteurMinio, type BorneReseau } from '@/lib/storage/minio-client';
import { VIGNETTES_MAX, TIMEOUT_MINIO_MS, masquerUrls } from './extraction';
import { vignetteLisible } from './vignettes';
import type { VignetteAnalyse } from './contrat';
import {
  lireReponseVisuelle, usageVisuel,
  type AnalyseVisuelle, type ContexteVisuel, type MotifVisuel,
  type MotifVisuelEtape,
} from './visuel-contrat';

// ─────────────────────────────────────────────────────────────────────────
// Bornes
// ─────────────────────────────────────────────────────────────────────────

/**
 * Le nombre d'images. DÉRIVÉ de `VIGNETTES_MAX`, jamais recopié.
 *
 * Deux listes du même plafond ne divergent pas tout de suite : elles divergent
 * au troisième changement. Une image par vignette produite, jamais plus.
 */
export const IMAGES_MAX = VIGNETTES_MAX;

/**
 * Plafond par image.
 *
 * Une JPEG de 640 px à `-q:v 5` pèse quelques dizaines de kilo-octets — les
 * huit vignettes mesurées en production vont de 7 à 48 Ko. 512 Ko, c'est dix
 * fois le pire cas observé, et seize fois SOUS `SORTIE_MAX_VIGNETTE`, qui
 * n'est pas une borne de plausibilité mais le dernier filet de `maxBuffer`.
 */
export const TAILLE_MAX_IMAGE = 512 * 1024;

/**
 * Plancher. Une JPEG de 640 px complète ne descend pas sous ~1 Ko ; en dessous
 * de 512 octets, c'est une écriture tronquée, pas une image.
 */
export const TAILLE_MIN_IMAGE = 512;

/** Borne GLOBALE du lot envoyé. Huit fois « acceptable » peut ne pas l'être. */
export const BUDGET_IMAGES_OCTETS = IMAGES_MAX * TAILLE_MAX_IMAGE;

/**
 * Délai d'UN appel au fournisseur.
 *
 * ⚠️ ORDRE DES BORNES, NON NÉGOCIABLE — même doctrine que `extraction.ts` :
 *
 *   TIMEOUT_MINIO_MS (10 s)  <  TIMEOUT_VISUEL_MS (60 s)
 *                            <  BUDGET_ANALYSE_MS  <=  RETRY_APRES_SECONDES
 *
 * Huit images tiennent largement sous soixante secondes ; au-delà, ce n'est
 * plus un modèle lent, c'est un fournisseur qui ne répond plus.
 */
export const TIMEOUT_VISUEL_MS = 60_000;

/**
 * Le budget de l'analyse COMPLÈTE, extraction plus visuel.
 *
 * C'est ce nombre que `RETRY_APRES_SECONDES` doit couvrir : une place ne peut
 * pas rester prise plus longtemps que la requête qui la détient, et le client
 * qui revient à l'heure dite ne doit pas se faire refuser de nouveau.
 */
export const BUDGET_VISUEL_MS = TIMEOUT_VISUEL_MS;

/**
 * Une seule tentative. Jamais de reprise.
 *
 * Doctrine déjà écrite trois fois dans ce dossier : rejouer un fournisseur en
 * panne n'a jamais fait que tripler l'attente avant le même échec — en
 * triplant le coût. La relance est un geste de l'utilisateur.
 */
export const TENTATIVES_VISUEL = 1;

/** La borne réseau des lectures de vignettes. */
const BORNE_LECTURE: BorneReseau = { timeoutMs: TIMEOUT_MINIO_MS };

// ─────────────────────────────────────────────────────────────────────────
// Motifs
// ─────────────────────────────────────────────────────────────────────────

/**
 * Pourquoi une image n'a pas pu être envoyée. Vocabulaire FERMÉ.
 *
 * Ces motifs sont journalisables : ce sont des littéraux à nous, jamais une
 * chaîne venue du stockage ou d'un tiers.
 */
export const MOTIFS_IMAGE = [
  'cle_hors_perimetre', 'objet_absent', 'stockage_injoignable',
  'image_vide', 'image_trop_grosse', 'image_non_jpeg', 'image_tronquee',
  'budget_depasse',
] as const;
export type MotifImage = (typeof MOTIFS_IMAGE)[number];

/**
 * Réexportés, jamais recopiés : le vocabulaire fait autorité dans le contrat,
 * qui est le seul module que `moteur-visuel.ts` puisse importer sans tirer
 * ffmpeg avec lui.
 */
export {
  MOTIFS_VISUEL_ETAPE, motifVisuelEtapeValide, type MotifVisuelEtape,
} from './visuel-contrat';

// ─────────────────────────────────────────────────────────────────────────
// Lecture bornée des images
// ─────────────────────────────────────────────────────────────────────────

export interface ImageLue { octets: Buffer; seconde: number; index: number }
export interface LectureImages {
  images: ImageLue[];
  /** Ce qui a été écarté, et pourquoi. Des MOTIFS, jamais des clés. */
  ignorees: Array<{ index: number; motif: MotifImage }>;
  octetsTotal: number;
}

/**
 * Un JPEG commence par `FF D8 FF`.
 *
 * ⚠️ Ce n'est PAS une défense contre un attaquant — personne ne peut plus
 * écrire sous `<userId>/analyse/…`, c'est notre propre pipeline qui a produit
 * ces octets. C'est une défense contre l'ÉCRITURE TRONQUÉE : ffmpeg tué en
 * cours de route écrit ce qu'il avait produit, et la garde `stdout.length === 0`
 * de l'extraction n'attrape que le cas vide, pas le cas partiel.
 */
export function jpegEnTete(o: Buffer): boolean {
  return o.length >= 3 && o[0] === 0xff && o[1] === 0xd8 && o[2] === 0xff;
}

/**
 * Et se termine par `FF D9`. Une absence signale une troncature, pas une
 * attaque — on saute l'image, on ne fait pas échouer l'analyse.
 */
export function jpegComplet(o: Buffer): boolean {
  return o.length >= 2 && o[o.length - 2] === 0xff && o[o.length - 1] === 0xd9;
}

/** Lit au plus `max` octets, puis COUPE la socket. Ne lève pas. */
async function lireFluxBorne(flux: NodeJS.ReadableStream, max: number): Promise<Buffer | null> {
  const morceaux: Buffer[] = [];
  let total = 0;
  for await (const morceau of flux as AsyncIterable<Buffer>) {
    total += morceau.length;
    if (total > max) {
      // Cesser de lire ne fait pas cesser d'arriver : on détruit.
      (flux as { destroy?: (e?: Error) => void }).destroy?.();
      return null;
    }
    morceaux.push(morceau);
  }
  return Buffer.concat(morceaux, total);
}

/** UNE vignette, ou un motif. Ne lève jamais. */
export async function lireImageBornee(
  userId: string, v: VignetteAnalyse,
): Promise<{ octets: Buffer | null; motif: MotifImage | null }> {
  // La forme de la clé est déjà écrite une fois — on l'appelle, on ne la
  // recopie pas. `vignetteLisible` couvre le compartiment, l'absence de
  // `://`, l'absence de `..` ET le préfixe du propriétaire.
  if (!vignetteLisible(userId, v)) return { octets: null, motif: 'cle_hors_perimetre' };

  // ── 1. Regarder AVANT de transférer ──────────────────────────────────
  let taille = 0;
  try {
    const stat = await clientMinio(BORNE_LECTURE).statObject(v.bucket, v.cle);
    taille = Number((stat as { size?: unknown } | null)?.size ?? 0);
  } catch (e: unknown) {
    const m = e instanceof Error ? e.message : String(e);
    const absent = /not found|does not exist|NoSuchKey|NotFound/i.test(m);
    return { octets: null, motif: absent ? 'objet_absent' : 'stockage_injoignable' };
  }
  if (taille <= 0) return { octets: null, motif: 'image_vide' };
  if (taille < TAILLE_MIN_IMAGE) return { octets: null, motif: 'image_tronquee' };
  if (taille > TAILLE_MAX_IMAGE) return { octets: null, motif: 'image_trop_grosse' };

  // ── 2. Transférer, en comptant ───────────────────────────────────────
  let octets: Buffer | null;
  try {
    const flux = await lecteurMinio(BORNE_LECTURE).getObject(v.bucket, v.cle);
    octets = await lireFluxBorne(flux as NodeJS.ReadableStream, TAILLE_MAX_IMAGE);
  } catch {
    // Objet disparu entre les deux, stockage muet, délai dépassé : on ne
    // distingue pas — un motif plus fin renseignerait sur le stockage.
    return { octets: null, motif: 'stockage_injoignable' };
  }
  if (octets === null) return { octets: null, motif: 'image_trop_grosse' };
  if (octets.length === 0) return { octets: null, motif: 'image_vide' };
  if (octets.length < TAILLE_MIN_IMAGE) return { octets: null, motif: 'image_tronquee' };

  // ── 3. Le type RÉEL, pas l'extension ─────────────────────────────────
  if (!jpegEnTete(octets)) return { octets: null, motif: 'image_non_jpeg' };
  if (!jpegComplet(octets)) return { octets: null, motif: 'image_tronquee' };

  return { octets, motif: null };
}

/** Le lot entier — au plus `IMAGES_MAX`, au plus `BUDGET_IMAGES_OCTETS`. */
export async function lireImagesAnalyse(
  userId: string, vignettes: readonly VignetteAnalyse[],
): Promise<LectureImages> {
  const images: ImageLue[] = [];
  const ignorees: LectureImages['ignorees'] = [];
  let octetsTotal = 0;

  // ⚠️ La troncature est ICI, AVANT la première lecture : un tableau de
  // cinquante vignettes — ligne corrompue, migration future — ne doit pas
  // coûter cinquante requêtes avant d'être ramené à huit.
  const lot = vignettes.slice(0, IMAGES_MAX);

  for (const [index, v] of lot.entries()) {
    const { octets, motif } = await lireImageBornee(userId, v);
    if (!octets) { ignorees.push({ index, motif: motif ?? 'objet_absent' }); continue; }
    if (octetsTotal + octets.length > BUDGET_IMAGES_OCTETS) {
      ignorees.push({ index, motif: 'budget_depasse' });
      break; // On S'ARRÊTE : les suivantes ne tiendront pas davantage.
    }
    octetsTotal += octets.length;
    images.push({ octets, seconde: v.seconde, index });
  }
  return { images, ignorees, octetsTotal };
}

// ─────────────────────────────────────────────────────────────────────────
// Le fournisseur — injecté, jamais codé en dur
// ─────────────────────────────────────────────────────────────────────────

/** Ce qu'on remet au fournisseur : des images, et rien d'autre. */
export interface EntreeAnalyseVisuelle {
  images: ReadonlyArray<{ seconde: number; mimeType: 'image/jpeg'; data: Buffer }>;
}

/**
 * Ce que le fournisseur rend.
 *
 * Une CHAÎNE ou un OBJET brut : c'est `lireReponseVisuelle` qui tranche. Le
 * fournisseur ne valide rien lui-même — sinon deux validations du même objet
 * divergeraient au troisième changement.
 */
export interface SortieFournisseur {
  reponse: unknown;
  /** Métriques de transport. Jamais lues dans le JSON du modèle. */
  usage?: { inputTokens?: unknown; outputTokens?: unknown };
  /** Le nom du modèle, CONSTANTE de l'adaptateur — jamais un champ de réponse. */
  modele: string;
}

export type FournisseurVisuel = (entree: EntreeAnalyseVisuelle) => Promise<SortieFournisseur>;

/**
 * Le fournisseur posé à la main — la couture, pour les tests et pour le jour
 * où un adaptateur réel arrivera.
 *
 * Tant que personne n'en pose un, `moteurVisuelDisponible()` rend `false` et
 * l'étape visuelle n'a simplement pas lieu. Ce n'est pas une panne : c'est un
 * déploiement où l'analyse s'arrête à l'extraction, ce qu'elle a toujours
 * fait.
 */
let fournisseurInjecte: FournisseurVisuel | null = null;

export function definirFournisseurVisuel(f: FournisseurVisuel | null): void {
  fournisseurInjecte = f;
}

export function moteurVisuelDisponible(): boolean {
  return fournisseurInjecte !== null;
}

// ─────────────────────────────────────────────────────────────────────────
// L'étape
// ─────────────────────────────────────────────────────────────────────────

export interface DemandeVisuel {
  userId: string;
  analysisId: string;
  vignettes: readonly VignetteAnalyse[];
  dureeSecondes: number;
}

export type ResultatEtapeVisuelle =
  | { ok: true; visuel: AnalyseVisuelle; modele: string }
  | { ok: false; motif: MotifVisuelEtape; detail?: string };

/** Un délai qui ne laisse pas l'appel courir derrière lui. */
function avecDelai<T>(promesse: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const minuteur = setTimeout(
      () => reject(new Error(`delai_visuel_depasse:${ms}`)),
      ms,
    );
    promesse.then(
      (v) => { clearTimeout(minuteur); resolve(v); },
      (e) => { clearTimeout(minuteur); reject(e); },
    );
  });
}

/**
 * L'étape visuelle, de bout en bout. Ne lève jamais.
 *
 * ⚠️ AUCUNE REPRISE. Un seul appel, quoi qu'il arrive — `TENTATIVES_VISUEL`.
 */
export async function analyserVisuelRush(demande: DemandeVisuel): Promise<ResultatEtapeVisuelle> {
  const fournisseur = fournisseurInjecte;
  if (!fournisseur) return { ok: false, motif: 'fournisseur_absent' };

  const lecture = await lireImagesAnalyse(demande.userId, demande.vignettes);

  // Zéro image lisible : on n'appelle PAS le fournisseur. Payer un appel pour
  // ne rien lui montrer n'a aucun sens, et le refus est plus clair qu'une
  // réponse inventée sur rien.
  if (lecture.images.length === 0) {
    return { ok: false, motif: 'aucune_image' };
  }

  const entree: EntreeAnalyseVisuelle = {
    images: lecture.images.map((i) => ({
      seconde: i.seconde, mimeType: 'image/jpeg' as const, data: i.octets,
    })),
  };

  let sortie: SortieFournisseur;
  try {
    sortie = await avecDelai(fournisseur(entree), TIMEOUT_VISUEL_MS);
  } catch (e: unknown) {
    // Le message d'un fournisseur peut porter une URL de point d'accès : il
    // passe par le même masquage que la sortie de ffmpeg, et il est tronqué.
    const detail = masquerUrls(e instanceof Error ? e.message : String(e)).slice(0, 200);
    return { ok: false, motif: 'fournisseur_en_erreur', detail };
  }

  const contexte: ContexteVisuel = {
    positions: lecture.images.map((i) => i.seconde),
    dureeSecondes: demande.dureeSecondes,
  };
  const valide = lireReponseVisuelle(sortie.reponse, contexte);
  if (!valide.ok) {
    // Le motif FIN va au journal de l'appelant ; la base ne verra que
    // `resultat_visuel_invalide`. Le champ fautif est un nom de notre
    // contrat, jamais une valeur du modèle.
    const fin: MotifVisuel = valide.motif;
    return {
      ok: false,
      motif: 'resultat_visuel_invalide',
      detail: `${fin}:${valide.champ}`,
    };
  }

  return {
    ok: true,
    modele: sortie.modele,
    visuel: {
      ...valide.valeur,
      usage: usageVisuel({
        images: lecture.images.length,
        inputTokens: sortie.usage?.inputTokens,
        outputTokens: sortie.usage?.outputTokens,
      }),
    },
  };
}
