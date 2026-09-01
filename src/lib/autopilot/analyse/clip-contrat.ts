/**
 * M3-F — LE CONTRAT DES CLIPS MATERIALISES.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE M3-F EST, ET CE QU'IL N'EST PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * M3-E rend une DÉCISION — « ce passage commence à 34,320 et finit à 37,240 »
 * — et ne produit aucun octet. M3-F produit les octets, et rien d'autre : il
 * ne monte pas, n'assemble pas, ne publie pas.
 *
 * ⚠️ AUCUN DÉBIT. M3-F n'appelle aucun fournisseur : son coût est du CPU
 * local et du disque. Facturer ici ferait payer deux fois le jour où le
 * montage livrable — lui déjà tarifé — sera produit. Ce module n'importe pas
 * `@/lib/credits`, et un test le vérifie.
 */
import type { Coupe } from './coupe-contrat';

// ─────────────────────────────────────────────────────────────────────────
// L'encodage — mesuré, pas choisi
// ─────────────────────────────────────────────────────────────────────────

/**
 * La méthode de matérialisation, nommée et versionnée.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ POURQUOI UN RÉENCODAGE, ALORS QUE LA COPIE DE FLUX EST 100× PLUS RAPIDE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Parce que la copie de flux ne peut commencer que sur une image-clé, et que
 * les images-clés d'un rush réel ne tombent pas là où l'on coupe. Mesuré sur
 * les cinq coupes réelles du rush de production, l'écart entre la borne
 * demandée et le premier octet réellement copié :
 *
 *   rang 1  −994 ms     rang 3  −490 ms     rang 5  −231 ms
 *   rang 2     0 ms     rang 4  −820 ms
 *
 * M3-E venait de déplacer une borne de QUARANTE MILLISECONDES pour ne pas
 * couper un mot. La copie de flux annulerait cet effort par un facteur vingt,
 * et ramasserait au passage jusqu'à une seconde d'images non demandées.
 *
 * Le réencodage, sur les mêmes cinq coupes, tombe à +3, +6, +10, +13 ms — la
 * durée d'une image à 30 images par seconde. Ce n'est pas une imprécision,
 * c'est le plancher physique du support.
 */
export const METHODE_MATERIALISATION = 'x264-crf23-v1' as const;

/** Le conteneur et son type MIME. */
export const CONTENEUR = 'mp4' as const;
export const CONTENT_TYPE = 'video/mp4' as const;

/**
 * Le compartiment des clips.
 *
 * `videos`, comme les montages rendus : un clip est une vidéo intermédiaire,
 * pas un média téléversé par une personne. Déjà dans `ALLOWED_BUCKETS`.
 */
export const BUCKET_CLIPS = 'videos';

/**
 * Le facteur de qualité, et pourquoi 23 plutôt que 20.
 *
 * Mesuré sur le même jeu de cinq clips : 23,6 Mo en CRF 23 contre 33,0 Mo en
 * CRF 20 — trente pour cent de moins, pour une différence invisible à 1080p.
 * CRF 20 produisait des clips PLUS LOURDS que le rush dont ils sortent, ce
 * qui n'a aucun sens pour un intermédiaire.
 */
export const CRF = 23;

/**
 * Le préréglage x264.
 *
 * `veryfast` sur quatre cœurs partagés avec la base et le stockage.
 * `medium` triplerait le temps pour environ dix pour cent de taille.
 */
export const PRESET = 'veryfast';

export const PIXEL_FORMAT = 'yuv420p';
export const AUDIO_BITRATE = '128k';
export const AUDIO_FREQUENCE = 48_000;

// ─────────────────────────────────────────────────────────────────────────
// Les bornes
// ─────────────────────────────────────────────────────────────────────────

/** Six au plus : c'est `CANDIDATS_MAX` de M3-C, et rien ne peut en produire plus. */
export const CLIPS_MAX = 6;

/**
 * La durée maximale d'un clip, en secondes.
 *
 * La plus longue durée cible de M3-C vaut douze secondes, et la garde de M3-E
 * autorise une seconde de plus. Trente laisse une marge confortable tout en
 * refusant un intervalle aberrant qui aurait franchi tous les contrats.
 */
export const CLIP_SECONDES_MAX = 30;

/** La durée cumulée d'un jeu. Six clips de trente secondes ne s'additionnent pas. */
export const SET_SECONDES_MAX = 120;

/**
 * La taille d'un clip produit, en octets.
 *
 * Mesuré : le plus gros des cinq clips réels pèse 14,3 Mo pour huit secondes
 * de 1080p. Soixante-quatre mébioctets couvrent trente secondes de 4K sans
 * laisser un encodage emballé remplir le disque.
 */
export const CLIP_OCTETS_MAX = 64 * 1024 * 1024;

/** Le disque temporaire d'un jeu entier. */
export const SET_OCTETS_MAX = 2 * 1024 * 1024 * 1024;

/** Temps maximal accordé à UN clip — décodage depuis MinIO compris. */
export const TIMEOUT_CLIP_MS = 120_000;

/** Temps maximal accordé au téléversement d'UN clip. */
export const TIMEOUT_TELEVERSEMENT_MS = 60_000;

/**
 * Le pire cas d'un jeu complet, en millisecondes. Calculé, jamais choisi.
 *
 * Six clips, chacun découpé puis téléversé, plus la signature de l'URL
 * source. C'est cette somme que la péremption doit franchement dépasser.
 */
export const BUDGET_SET_MS =
  10_000 + CLIPS_MAX * (TIMEOUT_CLIP_MS + TIMEOUT_TELEVERSEMENT_MS);

/**
 * Au bout de combien de temps un jeu actif est réputé abandonné.
 *
 * ⚠️ CALCULÉE, ET LARGEMENT AU-DESSUS DU PIRE CAS. `rush_clip_sets_active_unique`
 * interdit deux jeux actifs par jeu de candidats : c'est ce qui empêche deux
 * ffmpeg de partir sur les mêmes octets. Mais un processus tué au mauvais
 * moment laisse sa ligne `en_cours` pour toujours, et le jeu de candidats
 * devient définitivement impossible à matérialiser. Le piège s'est présenté
 * sur `rush_analyses`, puis sur `rush_candidate_sets`, puis sur
 * `rush_transcriptions` — il se traite pareil.
 *
 * Trente minutes : le pire cas (environ treize) plus du double de marge. En
 * dessous du seuil, un jeu actif est PROTÉGÉ : le fermer ferait repartir un
 * second découpage pendant le premier.
 */
export const PEREMPTION_SET_MS = 30 * 60 * 1000;

/** Le seuil, en ISO — ce que la récupération compare à `created_at`. */
export function seuilPeremptionSet(maintenant: number = Date.now()): string {
  return new Date(maintenant - PEREMPTION_SET_MS).toISOString();
}

/**
 * La durée de vie de l'URL signée du rush, en secondes.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ PROPRE À M3-F, ET NON CELLE DE M3-B2 — LA REVUE L'A EXIGÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `TTL_URL_SECONDES` de l'extraction vaut dix minutes : assez pour un sondage
 * et huit vignettes. M3-F signe UNE fois pour tout le jeu, puis découpe
 * jusqu'à six clips — `BUDGET_SET_MS` vaut plus de DIX-HUIT MINUTES au pire
 * cas. Reprendre la borne de M3-B2 aurait donc laissé la signature expirer
 * au milieu du jeu, et les derniers clips auraient échoué en
 * `media_illisible` — un diagnostic faux pour une signature périmée.
 *
 * La valeur n'est pas choisie : elle est celle de la PÉREMPTION du jeu. La
 * signature meurt donc exactement quand le jeu est déclaré abandonné, et ne
 * peut jamais lui survivre. Elle couvre le pire cas avec la marge que la
 * péremption porte déjà, et un test vérifie que les deux ne divergent pas.
 */
export const TTL_SOURCE_SECONDES = Math.floor(PEREMPTION_SET_MS / 1000);

/**
 * Le délai réseau imposé au STOCKAGE pendant un jeu.
 *
 * ⚠️ IL NE PEUT PAS ÊTRE CELUI DE M3-B2. `BORNE_MINIO` vaut dix secondes,
 * dimensionnées pour un `statObject` et des vignettes de quelques dizaines de
 * kilo-octets. Un clip pèse jusqu'à soixante-quatre mébioctets : le transport
 * borné de `minio-client.ts` DÉTRUIT la requête à l'échéance, la borne
 * effective aurait donc été de dix secondes, et non des soixante que ce lot
 * annonce. Le contrat aurait menti.
 *
 * C'est la SEULE autorité de délai du téléversement : le transport coupe la
 * socket et fait rejeter la promesse de `minio`. Aucun `Promise.race` ne
 * vient s'y superposer — `minio-client.ts` explique en toutes lettres qu'une
 * course est une borne en trompe-l'œil, qui cesse d'attendre sans cesser de
 * payer.
 */
export const BORNE_STOCKAGE_CLIPS = { timeoutMs: TIMEOUT_TELEVERSEMENT_MS };

/**
 * La tolérance de matérialisation, en secondes, pour une cadence donnée.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ ELLE VIENT DU SUPPORT, PAS D'UNE PRÉFÉRENCE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Une vidéo n'a d'images qu'à intervalle fixe : à trente images par seconde,
 * rien n'existe entre deux multiples de 33,3 ms. Le son a la même contrainte,
 * plus grossière encore — une trame AAC porte 1024 échantillons, soit 21,3 ms
 * à 48 kHz.
 *
 * Exiger mieux serait exiger l'impossible ; tolérer beaucoup plus laisserait
 * repasser la copie de flux et ses 800 ms. La borne est donc une image et
 * demie, avec un plancher qui couvre la trame audio.
 *
 * Mesuré sur les cinq coupes réelles : +3 à +13 ms. La marge est large.
 */
export function toleranceMaterialisation(imagesParSeconde: number): number {
  const fps = Number.isFinite(imagesParSeconde) && imagesParSeconde > 0
    ? imagesParSeconde : 30;
  return Math.max(0.06, 1.5 / fps);
}

/** Trois décimales, comme partout ailleurs dans la chaîne. */
export function arrondirSeconde(n: number): number {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
}

export function nombreFini(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// ─────────────────────────────────────────────────────────────────────────
// Le vocabulaire
// ─────────────────────────────────────────────────────────────────────────

/**
 * Les motifs d'échec. Fermé, comme partout dans l'Autopilote.
 *
 * Un motif libre finirait par contenir la sortie de ffmpeg — donc l'URL
 * signée du rush — et personne ne pourrait plus compter les échecs par cause.
 */
export const MOTIFS_CLIPS = [
  'candidats_introuvables',   // le jeu de candidats a disparu, ou n'est pas le sien
  'decision_invalide',        // M3-E n'a rendu aucune coupe exploitable
  'source_inaccessible',      // le rush n'est pas lisible dans le stockage
  'outil_absent',             // ffmpeg introuvable sur ce serveur
  'media_illisible',          // le rush ne se décode pas
  'extraction_echouee',       // ffmpeg a rendu un fichier inexploitable
  'televersement_echoue',     // le clip n'est pas arrivé au stockage
  'timeout',                  // un processus a dépassé son délai
  'capacite_saturee',         // un autre jeu occupe déjà le serveur
  'set_interrompu',           // fermé par péremption
] as const;
export type MotifClips = (typeof MOTIFS_CLIPS)[number];

export function motifClipsValide(v: unknown): v is MotifClips {
  return typeof v === 'string' && (MOTIFS_CLIPS as readonly string[]).includes(v);
}

export const ETATS_SET = ['en_attente', 'en_cours', 'reussie', 'echouee', 'annulee'] as const;
export type EtatSet = (typeof ETATS_SET)[number];
export const ETATS_SET_ACTIFS: readonly EtatSet[] = ['en_attente', 'en_cours'];

export function etatSetValide(v: unknown): v is EtatSet {
  return typeof v === 'string' && (ETATS_SET as readonly string[]).includes(v);
}

export const ETAPES_SET = ['extraction', 'televersement'] as const;
export type EtapeSet = (typeof ETAPES_SET)[number];

export function etapeSetValide(v: unknown): v is EtapeSet {
  return typeof v === 'string' && (ETAPES_SET as readonly string[]).includes(v);
}

// ─────────────────────────────────────────────────────────────────────────
// Les formes
// ─────────────────────────────────────────────────────────────────────────

/**
 * Un clip matérialisé, tel qu'il vit en base.
 *
 * ⚠️ UN COMPARTIMENT ET UNE CLÉ, JAMAIS UNE URL. Une URL signée vit quelques
 * minutes ; l'écrire ici la rendrait périmée et fausse le lendemain. La base
 * de M3-B1 pose la même interdiction sur ses vignettes, et la migration de ce
 * lot la répète en `CHECK`.
 *
 * `debutMesureSecondes` et `dureeMesureeSecondes` sont ce que `ffprobe` a lu
 * DANS LE FICHIER PRODUIT. Ils ne servent pas à décorer : ils rendent la
 * précision auditable sans avoir à retélécharger quoi que ce soit.
 */
export interface ClipMaterialise {
  rang: number;
  debutSecondes: number;
  finSecondes: number;
  dureeSecondes: number;
  bucket: string;
  cle: string;
  octets: number;
  debutMesureSecondes: number | null;
  dureeMesureeSecondes: number | null;
}

/**
 * L'identité immutable : de quelle décision ces fichiers sont sortis.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ `methode` EN FAIT PARTIE, ET CE N'EST PAS UN DÉTAIL
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `algorithme` dit comment les BORNES ont été décidées ; `methode` dit
 * comment les OCTETS ont été produits. Deux questions distinctes, et la
 * seconde manquait.
 *
 * Sans elle, passer un jour de `x264-crf23-v1` à `x264-crf22-v2` sans toucher
 * à M3-E aurait laissé `lireSetReussiIdentique` rendre les ANCIENS fichiers :
 * on aurait cru avoir réencodé, et l'on aurait servi l'encodage précédent,
 * sans qu'aucune erreur n'apparaisse. C'est précisément le genre de silence
 * que le versionnement d'algorithme existe pour empêcher.
 *
 * Elle est fixée par le serveur, jamais reçue de l'appelant.
 */
export interface IdentiteClipSet {
  candidateSetId: string;
  candidateSetVersion: number;
  rushId: string;
  analysisId: string;
  transcriptionId: string | null;
  transcriptionVersion: number | null;
  /** Comment les BORNES ont été décidées — `m3e-v1`. */
  algorithme: string;
  /** Comment les OCTETS ont été produits — `x264-crf23-v1`. */
  methode: string;
}

export interface ClipSet extends IdentiteClipSet {
  id: string;
  userId: string;
  version: number;
  etat: EtatSet;
  etape: EtapeSet | null;
  clips: ClipMaterialise[];
  usage: Record<string, unknown>;
  motifEchec: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────
// La clé de stockage — fabriquée par le serveur, jamais reçue
// ─────────────────────────────────────────────────────────────────────────

/**
 * La clé d'un clip dans le compartiment.
 *
 * ⚠️ ELLE NE PREND RIEN DE L'APPELANT. Le préfixe `<userId>/` vient de la
 * session, l'identifiant du jeu vient de la base, le rang vient de M3-C. Une
 * clé composée d'un fragment reçu du navigateur laisserait viser l'espace
 * d'autrui, ou écraser un objet existant — et c'est exactement ce que le
 * préfixe utilisateur sert à empêcher partout ailleurs dans le projet.
 *
 * Déterministe : le même jeu produit les mêmes clés. Deux jeux différents ne
 * peuvent pas se marcher dessus, puisque `clipSetId` les sépare.
 */
export function cleClip(userId: string, clipSetId: string, rang: number): string {
  const r = String(Math.max(1, Math.trunc(rang))).padStart(2, '0');
  return `${userId}/autopilote/clips/${clipSetId}/rang-${r}.${CONTENEUR}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Les contrôles
// ─────────────────────────────────────────────────────────────────────────

/** La forme d'un identifiant de ressource. Rien d'autre ne passe. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function identifiantValide(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}

/**
 * Une coupe de M3-E est-elle matérialisable ?
 *
 * Les bornes ont déjà été garanties par M3-E ; on ne les recalcule pas. On
 * vérifie seulement qu'elles sont exploitables PAR FFMPEG — un intervalle nul
 * ou démesuré n'est pas une erreur de M3-E, c'est un intervalle qu'on refuse
 * de découper.
 */
export function coupeMaterialisable(c: Coupe): boolean {
  const d = nombreFini(c?.debutSecondes);
  const f = nombreFini(c?.finSecondes);
  const rang = nombreFini(c?.rang);
  if (d === null || f === null || rang === null) return false;
  if (d < 0 || !(d < f)) return false;
  return (f - d) <= CLIP_SECONDES_MAX;
}

/** Un clip relu depuis la base est-il encore conforme ? */
export function clipValide(v: unknown): v is ClipMaterialise {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  for (const cle of ['rang', 'debutSecondes', 'finSecondes', 'dureeSecondes', 'octets']) {
    if (nombreFini(o[cle]) === null) return false;
  }
  if (typeof o.bucket !== 'string' || typeof o.cle !== 'string') return false;
  // Une URL n'est pas une clé — ni `https://…`, ni `s3://…`.
  if (o.cle.includes('://') || o.cle.includes('..')) return false;
  return (o.debutSecondes as number) < (o.finSecondes as number);
}
