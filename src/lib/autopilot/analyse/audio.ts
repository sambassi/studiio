/**
 * M3-D1 — LA MESURE AUDIO LOCALE : ce que le serveur ENTEND d'un rush.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * UNE SEULE PASSE, ET AUCUN FICHIER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un rush pèse couramment plusieurs centaines de méga-octets. Contrairement
 * aux vignettes de `extraction.ts`, l'audio ne peut PAS se lire par requêtes
 * `Range` : la piste sonore est entrelacée sur toute la durée du fichier, il
 * faut donc le parcourir en entier. C'est le vrai coût de ce lot, et la seule
 * réponse honnête est d'en faire UNE passe qui mesure TOUT :
 *
 *   MinIO ──signature interne, TTL court──▶ URL http locale
 *        ──ffmpeg, un seul processus, `-f null -`──▶ quelques lignes de texte.
 *
 * Ce qui n'existe nulle part dans ce module, et ne doit jamais y apparaître :
 *
 *   • aucun `arrayBuffer()` / `Buffer` du rush,
 *   • aucun fichier temporaire — `-f null -` JETTE la sortie décodée, il n'y
 *     a donc rien à supprimer dans un `finally`,
 *   • aucun objet écrit dans MinIO : M3-D1 ne PRODUIT pas d'audio, il le
 *     MESURE. Un WAV extrait serait un média de plus à stocker, à signer, à
 *     purger, et à ne pas faire fuir.
 *
 * Aucun ré-encodage non plus : `silencedetect` et `volumedetect` travaillent
 * sur le flux décodé tel quel. Forcer `-ar 16000 -ac 1` coûterait un
 * ré-échantillonnage complet pour ne rien changer aux deux nombres cherchés.
 * La conversion voix viendra avec M3-D2, qui a un fichier à ENVOYER — ce lot
 * n'en a pas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * L'URL SIGNÉE NE SORT PAS D'ICI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Même règle qu'en M3-B2, et pour la même raison : ffmpeg répète volontiers
 * l'URL d'entrée dans ses messages. Elle est fabriquée sur le nom INTERNE du
 * stockage, elle vit quelques minutes, elle n'est ni rendue, ni écrite en
 * base, ni journalisée, et tout ce qui remonte d'ici passe par `masquerUrls`.
 *
 * Plus fort encore : `audioPourBase` RECONSTRUIT l'objet écrit en base champ
 * par champ, à partir de nombres. Aucun fragment de `stderr` n'a de chemin
 * vers la colonne `audio`, même par accident.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NE JAMAIS MENTIR : LES TROIS ISSUES
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ce module ne lève jamais et ne fait échouer aucune analyse. Il rend l'une
 * des trois issues de `audio-contrat.ts` — `mesuree`, `absente`,
 * `indisponible` — et `indisponible` n'écrit JAMAIS `present: false`. Une
 * panne de mesure sur un rush parlé le laisserait passer pour muet, et le lot
 * suivant sauterait sa transcription sans que personne ne sache pourquoi.
 */
import { bucketAutorise } from '@/lib/storage/buckets';
import { cheminFfmpeg } from '@/lib/ffmpeg/binaires';
import { signeurInterne } from '@/lib/storage/minio-client';
import {
  BORNE_MINIO, TIMEOUT_MINIO_MS, TTL_URL_SECONDES, PROTOCOLES_AUTORISES,
  masquerUrls, lancer,
} from './extraction';
import { prendrePlaceAudio } from './capacite';
import {
  SEUIL_SILENCE_DB, SILENCE_MIN_SECONDES, SILENCES_MAX,
  audioAbsent, audioIndisponible, normaliserSilences, nombreFini, arrondirSeconde,
  type MesureAudio, type NiveauAudio, type SilenceAudio,
} from './audio-contrat';

// ─────────────────────────────────────────────────────────────────────────
// Les bornes
// ─────────────────────────────────────────────────────────────────────────

/**
 * Temps maximal accordé à LA passe audio.
 *
 * ⚠️ BEAUCOUP PLUS LONG QUE `TIMEOUT_VIGNETTE_MS`, et ce n'est pas une
 * négligence. Une vignette lit quelques kilo-octets par `Range` ; cette passe
 * traverse le fichier ENTIER. Cent vingt secondes, c'est la marge d'un rush
 * long lu sur le réseau Docker local — au-delà, ce n'est plus « c'est long »,
 * c'est « le stockage ne suit pas », et il vaut mieux rendre la place.
 */
export const TIMEOUT_AUDIO_MS = 120_000;

/**
 * Le pire cas de `mesurerAudio`, en millisecondes. Calculé, jamais choisi.
 *
 * Une signature (comptée pour une requête MinIO, majoration volontaire :
 * elle n'en fait aucune aujourd'hui) plus la passe ffmpeg. C'est ce budget
 * qui s'ajoute à ceux de l'extraction et du visuel dans le `Retry-After`
 * annoncé par `capacite.ts`, et un test vérifie que les trois ne divergent
 * pas en silence.
 */
export const BUDGET_AUDIO_MS = TIMEOUT_MINIO_MS + TIMEOUT_AUDIO_MS;

/**
 * Délai de lecture/écriture réseau imposé à ffmpeg, en MICROsecondes.
 *
 * La même valeur qu'en extraction, et pour la même raison : la socket doit
 * rendre la main avant le `timeout` du processus. Sans lui, un stockage qui
 * accepte la connexion puis se tait ferait attendre ffmpeg jusqu'au `SIGKILL`,
 * c'est-à-dire jusqu'au bout du budget.
 */
const RW_TIMEOUT_US = '15000000';

/**
 * Plafond du tampon de sortie du processus, en octets.
 *
 * C'est `maxBuffer` de Node : au-delà, il TUE le processus. C'est donc la
 * seule borne qui protège réellement la mémoire, et elle est appliquée par le
 * runtime, pas par nous.
 *
 * Exporté pour être vérifiable : un test prouve que la conservation de
 * `stderr` s'aligne EXACTEMENT dessus, et ne peut pas s'en écarter en
 * silence.
 */
export const SORTIE_MAX_AUDIO = 8 * 1024 * 1024;

/**
 * La longueur de `stderr` conservée — ÉGALE au tampon, et c'est le point.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ POURQUOI PAS UNE BORNE INTERMÉDIAIRE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `lancer` garde par défaut les huit derniers milliers de caractères : cela
 * suffit à un message d'échec. Ici `stderr` n'est pas une cause d'échec,
 * c'est LA MESURE — `silencedetect` écrit une ligne par silence, au fil du
 * fichier.
 *
 * Une borne intermédiaire (256 Kio, par exemple) ne protégerait RIEN : le
 * processus a déjà tamponné jusqu'à `maxBuffer` quand nous découpons, donc le
 * pic mémoire est le même. Elle ne ferait que JETER de la mesure, et de la
 * pire façon possible :
 *
 *   • par la FIN, donc en supprimant les silences du DÉBUT du rush ;
 *   • en pouvant commencer entre un `silence_start` et son `silence_end`,
 *     laissant une fin orpheline en tête de tranche.
 *
 * Le résultat serait plausible et faux — l'erreur qu'on ne voit jamais. La
 * conservation vaut donc exactement le tampon : sous cette borne, RIEN n'est
 * jeté. Au-dessus, Node tue le processus et la mesure se dit `indisponible`
 * plutôt que d'être silencieusement amputée.
 *
 * (`lireSilences` apparie de toute façon les événements dans leur ORDRE
 * d'apparition, et ignore une fin orpheline : la ceinture tient même si une
 * troncature revenait un jour.)
 */
const STDERR_AUDIO_MAX = SORTIE_MAX_AUDIO;

// ─────────────────────────────────────────────────────────────────────────
// Point d'entrée
// ─────────────────────────────────────────────────────────────────────────

export interface EntreeAudio {
  bucket: string;
  cleObjet: string;
  userId: string;
  /** La durée MESURÉE par l'extraction. Elle borne tous les instants rendus. */
  dureeSecondes: number | null;
  /**
   * Ce que le sondage de l'extraction a vu : `true` une piste, `false` aucune,
   * `null` personne n'a pu le dire.
   *
   * ⚠️ C'EST LA SEULE AUTORITÉ sur la présence d'une piste, et elle vient du
   * MÊME ffprobe qui a mesuré la durée. Re-sonder ici ouvrirait la porte à
   * deux réponses différentes sur le même fichier.
   */
  pisteAttendue: boolean | null;
}

/**
 * Mesure la bande son d'un rush. Ne lève jamais, ne fait échouer rien.
 *
 * Aucune reprise : un stockage en panne ne devient pas joignable parce qu'on
 * relance ffmpeg, et une seconde passe doublerait le pire cas du budget.
 */
export async function mesurerAudio(entree: EntreeAudio): Promise<MesureAudio> {
  const duree = nombreFini(entree.dureeSecondes);
  const piste = typeof entree.pisteAttendue === 'boolean' ? entree.pisteAttendue : null;

  try {
    return await executer(entree, duree, piste);
  } catch {
    // Le filet. `clientMinio()` lève sur une configuration incomplète,
    // `require('minio')` sur un paquet absent. Le message n'est PAS repris :
    // il peut nommer un hôte de stockage.
    return audioIndisponible('stockage_injoignable', duree, piste);
  }
}

async function executer(
  entree: EntreeAudio, duree: number | null, piste: boolean | null,
): Promise<MesureAudio> {
  // ── 1. Aucune piste : rien à mesurer, et ce n'est pas un échec ────────
  //
  // Avant TOUT accès : pas de place prise, pas de signature, pas de
  // processus. Un rush muet ne doit rien coûter.
  if (piste === false) return audioAbsent(duree);

  // ── 2. Le périmètre, avant tout accès ────────────────────────────────
  //
  // Les mêmes gardes que `extraction.ts`, et elles sont répétées plutôt que
  // supposées : ce module est appelable depuis ailleurs, et une garde qu'on
  // suppose faite en amont est une garde absente.
  if (!bucketAutorise(entree.bucket)) return audioIndisponible('cle_hors_perimetre', duree, piste);
  if (typeof entree.userId !== 'string' || !/^[\w-]{1,64}$/.test(entree.userId)) {
    return audioIndisponible('cle_hors_perimetre', duree, piste);
  }
  const cle = entree.cleObjet;
  // Le préfixe EST la preuve de propriété. Qu'un objet EXISTE ne prouve rien.
  if (typeof cle !== 'string' || !cle.startsWith(`${entree.userId}/`)) {
    return audioIndisponible('cle_hors_perimetre', duree, piste);
  }
  // `A/../B/x` satisfait le préfixe tout en désignant l'espace de B.
  if (cle.includes('..') || cle.includes('://')) {
    return audioIndisponible('cle_hors_perimetre', duree, piste);
  }

  // ── 3. La place, avant le processus ──────────────────────────────────
  //
  // Une passe audio décode un fichier entier : deux en parallèle sur quatre
  // cœurs partagés avec la base et le stockage, c'est la production qui
  // ralentit. Un refus ici n'est PAS un échec d'analyse — c'est une mesure
  // qui n'a pas eu lieu, et elle se dit comme telle.
  const place = prendrePlaceAudio();
  if (!place) return audioIndisponible('capacite_saturee', duree, piste);

  try {
    // ── 4. L'URL signée, interne et brève ──────────────────────────────
    const signeur = signeurInterne(BORNE_MINIO);
    if (!signeur) return audioIndisponible('stockage_injoignable', duree, piste);

    let url: string;
    try {
      url = await signeur.presignedGetObject(entree.bucket, cle, TTL_URL_SECONDES);
    } catch {
      return audioIndisponible('stockage_injoignable', duree, piste);
    }
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      return audioIndisponible('stockage_injoignable', duree, piste);
    }

    // ── 5. LA passe ────────────────────────────────────────────────────
    const sortie = await lancer(cheminFfmpeg(), argumentsMesure(url), {
      timeoutMs: TIMEOUT_AUDIO_MS,
      maxSortie: SORTIE_MAX_AUDIO,
      stderrMax: STDERR_AUDIO_MAX,
    });

    if (sortie.introuvable) return audioIndisponible('outil_absent', duree, piste);
    // ⚠️ AVANT le délai : `maxBuffer` dépassé fait AUSSI tuer le processus par
    // Node, donc `timeout` serait vrai — et le motif dirait « le stockage ne
    // suit pas » là où ffmpeg a simplement trop parlé. Un `stderr` de plus de
    // huit mégaoctets est un échec CONTRÔLÉ, pas une mesure tronquée en
    // silence : c'est tout l'intérêt d'aligner la conservation sur le tampon.
    if (sortie.codeSysteme === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      return audioIndisponible('audio_illisible', duree, piste);
    }
    if (sortie.timeout) return audioIndisponible('timeout', duree, piste);
    // Un code non nul couvre le fichier illisible ET le cas où `-map 0:a:0`
    // ne trouve pas la piste que le sondage annonçait. Les deux se disent
    // `audio_illisible` : dans les deux cas la mesure n'a PAS eu lieu, et
    // c'est la seule chose qu'on ait le droit d'affirmer.
    if (sortie.code !== 0) return audioIndisponible('audio_illisible', duree, piste);

    // `masquerUrls` a déjà été appliqué par `lancer`. La double application
    // est sans effet, et l'oubli serait une fuite : on ne suppose pas.
    const journal = masquerUrls(sortie.stderr);

    return {
      present: true,
      etatMesure: 'mesuree',
      motif: null,
      dureeSecondes: duree,
      silences: normaliserSilences(lireSilences(journal, duree), duree),
      niveau: lireNiveaux(journal),
      mesure: {
        outil: 'ffmpeg', seuilDb: SEUIL_SILENCE_DB, silenceMinSecondes: SILENCE_MIN_SECONDES,
      },
    };
  } finally {
    // La seule libération, et elle couvre tout : un `return` de succès, un
    // refus contrôlé, une exception du signeur.
    place.liberer();
  }
}

/**
 * Les arguments de la passe. Exportés pour être PROUVABLES.
 *
 * Chacun porte une garantie qu'un test peut vérifier sans exécuter ffmpeg :
 * la liste blanche de protocoles ferme la porte SSRF qu'ouvrirait un fichier
 * reconnu comme playlist HLS ou `ffconcat` (le conteneur voisine
 * `studiio-postgrest` et `studiio-db`) ; `-f null -` prouve qu'aucun octet
 * n'est écrit ; `-vn -sn -dn` prouve qu'aucune image n'est décodée.
 */
export function argumentsMesure(url: string): string[] {
  return [
    '-hide_banner', '-nostdin', '-nostats', '-loglevel', 'info',
    // ⚠️ L'URL D'ENTRÉE EST SÛRE ; LE CONTENU DU FICHIER NE L'EST PAS.
    '-protocol_whitelist', PROTOCOLES_AUTORISES,
    '-rw_timeout', RW_TIMEOUT_US,
    '-i', url,
    // Rien d'autre que le son n'est décodé : la vidéo d'un rush 4K coûterait
    // cent fois la mesure qu'on vient chercher.
    '-vn', '-sn', '-dn',
    '-map', '0:a:0',
    '-af', `silencedetect=noise=${SEUIL_SILENCE_DB}dB:d=${SILENCE_MIN_SECONDES},volumedetect`,
    // La sortie décodée part au trou noir : aucun fichier, aucun objet.
    '-f', 'null', '-',
  ];
}

// ─────────────────────────────────────────────────────────────────────────
// Lecture de la sortie
// ─────────────────────────────────────────────────────────────────────────

const RE_EVENEMENT = /silence_(start|end):\s*(-?\d+(?:\.\d+)?)/g;

/**
 * Les silences, tels que `silencedetect` les écrit.
 *
 * Il écrit `silence_start:` puis, plus loin, `silence_end:` — deux lignes
 * SÉPARÉES. Une expression qui exigerait les deux dans la même ligne ne
 * trouverait jamais rien.
 *
 * ⚠️ L'APPARIEMENT SE FAIT DANS L'ORDRE D'APPARITION, ET NON PAR RANG DANS
 * DEUX LISTES SÉPARÉES.
 *
 * La différence ne se voit pas sur une sortie complète — ffmpeg alterne
 * toujours — mais elle est tout le sujet sur une sortie AMPUTÉE. Un journal
 * coupé en tête commence par une fin orpheline ; appariée par rang, elle
 * deviendrait la fin du premier début RESTANT, et tous les silences suivants
 * seraient décalés d'un cran. Le résultat serait plausible et faux. Lue dans
 * l'ordre, une fin sans début ouvert est simplement IGNORÉE.
 *
 * Un début alors qu'un autre est déjà ouvert ne peut pas venir de ffmpeg. Si
 * cela arrivait, le précédent serait abandonné plutôt que fermé sur une
 * valeur inventée : perdre une mesure est un moindre mal que d'en fabriquer
 * une.
 *
 * ffmpeg ferme lui-même un silence qui court jusqu'à la fin du flux. Mais
 * « lui-même » est une propriété du binaire installé, pas une décision de ce
 * code : un dernier début resté ouvert est donc fermé sur la durée du rush,
 * plutôt que jeté. Le jeter perdrait précisément le silence final — celui où
 * une coupe est la plus facile.
 *
 * Exportée pour être testable sans ffmpeg.
 */
export function lireSilences(journal: string, dureeSecondes: number | null): SilenceAudio[] {
  const duree = nombreFini(dureeSecondes);
  const bruts: SilenceAudio[] = [];
  let ouvert: number | null = null;

  // Une borne dure PENDANT le balayage : un `stderr` hostile ou un binaire
  // devenu bavard ne doit pas faire grossir le tas. `normaliserSilences`
  // plafonnera de nouveau après tri — les deux bornes ont des rôles
  // différents et aucune ne remplace l'autre.
  const PLAFOND = SILENCES_MAX * 4;

  for (const m of String(journal ?? '').matchAll(RE_EVENEMENT)) {
    if (bruts.length >= PLAFOND) break;
    const valeur = Number(m[2]);
    if (m[1] === 'start') {
      ouvert = valeur;
      continue;
    }
    // Une fin sans début ouvert : journal amputé en tête. On l'ignore.
    if (ouvert === null) continue;
    bruts.push({ debutSecondes: ouvert, finSecondes: valeur });
    ouvert = null;
  }

  if (ouvert !== null && duree !== null && bruts.length < PLAFOND) {
    bruts.push({ debutSecondes: ouvert, finSecondes: duree });
  }
  return bruts;
}

const RE_MOYENNE = /mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/;
const RE_CRETE = /max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/;

/**
 * Les deux nombres de `volumedetect`, écrits À LA FIN du flux et une seule
 * fois. Sur une piste totalement muette ffmpeg peut écrire `-inf` : la regex
 * ne l'attrape pas, la valeur reste `null`, et `null` se lit « non mesurée »
 * — ce qui est plus vrai que `-Infinity`, que JSON ne sait de toute façon pas
 * représenter.
 *
 * ⚠️ `volumedetect` écrit AUSSI une ligne `n_samples: 0` au moment de la
 * configuration du filtre, AVANT le flux. C'est pourquoi on ne lit que les
 * deux clés qui n'existent qu'au bilan.
 *
 * Exportée pour être testable sans ffmpeg.
 */
export function lireNiveaux(journal: string): NiveauAudio {
  const texte = String(journal ?? '');
  const moyenne = RE_MOYENNE.exec(texte);
  const crete = RE_CRETE.exec(texte);
  const nombre = (m: RegExpExecArray | null): number | null => {
    if (!m) return null;
    const n = nombreFini(m[1]);
    return n === null ? null : arrondirSeconde(n);
  };
  return { moyenneDb: nombre(moyenne), creteDb: nombre(crete) };
}
