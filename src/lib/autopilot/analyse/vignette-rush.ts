/**
 * CREER_PREMIUM_3F — L'APERÇU D'UN RUSH, QUAND L'ANALYSE N'EN A PAS PRODUIT.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE CORRIGE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les cartes de rush montraient une pellicule grise. Ce n'était pas un défaut
 * d'affichage : `rush_analyses.vignettes` valait `[]`, et la carte a raison de
 * ne pas demander une image dont elle sait qu'elle n'existe pas — une demande
 * par rush et par montage du composant, huit fois 404, pour rien.
 *
 * Mais « l'analyse n'a pas produit d'image » n'est PAS « ce média n'a pas
 * d'image ». Le rush est là, lisible, mesuré. Le seul obstacle était qu'aucun
 * chemin n'allait la chercher.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CETTE IMAGE NE PASSE PAS PAR L'ANALYSE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Écrire dans `rush_analyses.vignettes` ferait de l'affichage un producteur de
 * mesures : une analyse dirait avoir produit une image qu'elle n'a pas
 * produite, et le bilan `vignettesAttendues / produites / echouees` — qui
 * existe précisément pour distinguer une panne d'une absence normale —
 * deviendrait faux. L'aperçu vit donc à côté, sous une clé qui lui est propre,
 * et l'analyse garde sa vérité.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ LA CLÉ EST DÉTERMINISTE, ET C'EST TOUT LE CACHE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `<userId>/rush/<rushId>/apercu.jpg`. La route sonde l'objet avant de faire
 * quoi que ce soit : présent, elle le sert ; absent, elle l'extrait une fois
 * et l'écrit. Il n'y a donc ni table, ni migration, ni mémoire de processus à
 * tenir — et dix rushes affichés ne lancent pas dix ffmpeg à chaque rendu,
 * puisque le second rendu ne trouve plus rien à produire.
 *
 * Le `userId` est dans la clé pour la même raison que partout ailleurs : le
 * préfixe PROUVE la propriété, il ne la suppose pas.
 */
import { clientMinio, lecteurMinio, signeurInterne } from '@/lib/storage/minio-client';
import { cheminFfmpeg } from '@/lib/ffmpeg/binaires';
import {
  lancer, masquerUrls, BORNE_MINIO, BUCKET_VIGNETTES, LARGEUR_VIGNETTE,
  PROTOCOLES_AUTORISES, TIMEOUT_VIGNETTE_MS, TTL_URL_SECONDES,
} from './extraction';

/** Ce qu'un octet d'aperçu est, décidé par nous — jamais lu sur l'objet. */
export const TYPE_APERCU = 'image/jpeg';

/**
 * Où l'image est prise dans la durée.
 *
 * ⚠️ PAS LA PREMIÈRE IMAGE. Un rush commence très souvent par un fondu, un
 * clap ou une seconde de noir : la carte afficherait un rectangle sombre,
 * c'est-à-dire à peine mieux que la pellicule grise qu'elle remplace. Un quart
 * de la durée tombe dans la matière du plan.
 */
export const FRACTION_APERCU = 0.25;

/**
 * Faute de durée connue, on prend cette seconde-là.
 *
 * Une seconde plutôt que zéro, pour la raison ci-dessus ; et si le rush est
 * plus court, ffmpeg rendra simplement sa dernière image.
 */
export const SECONDE_APERCU_DEFAUT = 1;

/** Un aperçu tient en quelques dizaines de kilo-octets ; ceci est le filet. */
const SORTIE_MAX_APERCU = 8 * 1024 * 1024;

const RW_TIMEOUT_US = '15000000';

export function secondeApercu(dureeSecondes: number | null): number {
  if (dureeSecondes === null || !Number.isFinite(dureeSecondes) || dureeSecondes <= 0) {
    return SECONDE_APERCU_DEFAUT;
  }
  return Math.max(0, Math.min(dureeSecondes * FRACTION_APERCU, dureeSecondes));
}

/**
 * La clé de l'aperçu d'un rush.
 *
 * ⚠️ NI COMPARTIMENT NI CHEMIN NE VIENNENT DU NAVIGATEUR. Les deux morceaux
 * sont des identifiants relus côté serveur ; c'est la même règle que pour les
 * vignettes d'analyse, et elle ferme la même porte.
 */
export function cleApercuRush(userId: string, rushId: string): string {
  return `${userId}/rush/${rushId}/apercu.jpg`;
}

export type MotifApercu =
  | 'objet_introuvable'
  | 'stockage_injoignable'
  | 'extraction_impossible';

export interface ApercuRush {
  bucket: string;
  cle: string;
}

/** L'aperçu est-il déjà là ? C'est la question qui rend le cache gratuit. */
export async function apercuDejaLa(cle: string): Promise<boolean> {
  try {
    const stat = await clientMinio(BORNE_MINIO).statObject(BUCKET_VIGNETTES, cle);
    return Number(stat?.size ?? 0) > 0;
  } catch {
    // Absent, ou stockage muet : dans les deux cas on tentera de produire, et
    // c'est la production qui dira laquelle des deux causes s'applique.
    return false;
  }
}

/**
 * Extrait UNE image du rush et l'écrit à sa clé d'aperçu.
 *
 * Aucun octet du rush ne transite par le navigateur : ffmpeg lit l'objet par
 * une URL signée INTERNE et brève, et ne rapatrie qu'un fragment — `-ss` est
 * placé AVANT `-i`, donc le démuxeur se positionne par une requête `Range` au
 * lieu de décoder le rush depuis le début.
 */
export async function produireApercuRush(
  userId: string, rushId: string,
  source: { bucket: string; cleObjet: string; dureeSecondes: number | null },
): Promise<{ apercu: ApercuRush | null; motif: MotifApercu | null }> {
  const echec = (motif: MotifApercu) => ({ apercu: null, motif });

  // Sondé AVANT la signature : une URL signée vers un objet absent produit un
  // « 404 » que ffmpeg range avec les fichiers corrompus, et « rush disparu »
  // ne se soigne pas comme « rush illisible ».
  try {
    const stat = await clientMinio(BORNE_MINIO).statObject(source.bucket, source.cleObjet);
    if (Number(stat?.size ?? 0) <= 0) return echec('objet_introuvable');
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return echec(
      /not found|does not exist|NoSuchKey|NotFound/i.test(message)
        ? 'objet_introuvable' : 'stockage_injoignable',
    );
  }

  const signeur = signeurInterne(BORNE_MINIO);
  if (!signeur) return echec('stockage_injoignable');

  let url: string;
  try {
    url = await signeur.presignedGetObject(
      source.bucket, source.cleObjet, TTL_URL_SECONDES,
    );
  } catch {
    return echec('stockage_injoignable');
  }
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
    return echec('stockage_injoignable');
  }

  const r = await lancer(cheminFfmpeg(), [
    '-hide_banner',
    '-loglevel', 'error',
    '-nostdin',
    '-protocol_whitelist', PROTOCOLES_AUTORISES,
    '-rw_timeout', RW_TIMEOUT_US,
    // ⚠️ AVANT `-i` : positionnement du démuxeur, donc requête `Range`.
    '-ss', String(secondeApercu(source.dureeSecondes)),
    '-i', url,
    '-frames:v', '1',
    '-vf', `scale='min(${LARGEUR_VIGNETTE},iw)':-2`,
    '-f', 'image2',
    '-vcodec', 'mjpeg',
    '-q:v', '5',
    '-',
  ], { timeoutMs: TIMEOUT_VIGNETTE_MS, maxSortie: SORTIE_MAX_APERCU });

  if (r.timeout || r.introuvable || r.code !== 0 || r.stdout.length === 0) {
    // La cause va au journal SERVEUR, jamais à l'écran : la sortie de ffmpeg
    // porte l'URL signée, et `masquerUrls` est la seule chose qui l'en retire.
    console.warn('[apercu-rush] extraction impossible', {
      rushId,
      cause: r.introuvable ? 'ffmpeg-absent(ENOENT)'
        : r.timeout ? 'processus-interrompu'
          : typeof r.code === 'number' && r.code !== 0 ? `code=${r.code}`
            : r.codeSysteme ? `errno=${r.codeSysteme}`
              : r.signal ? `signal=${r.signal}`
                : 'sortie-vide(code=0)',
      detail: masquerUrls(r.stderr).slice(-400),
    });
    return echec('extraction_impossible');
  }

  const cle = cleApercuRush(userId, rushId);
  try {
    await clientMinio(BORNE_MINIO).putObject(
      BUCKET_VIGNETTES, cle, r.stdout, r.stdout.length,
      { 'Content-Type': TYPE_APERCU },
    );
  } catch {
    return echec('stockage_injoignable');
  }
  return { apercu: { bucket: BUCKET_VIGNETTES, cle }, motif: null };
}

/**
 * Le flux d'un aperçu déjà écrit.
 *
 * Les octets vont du stockage à la réponse sans être matérialisés — ni
 * `Buffer`, ni fichier temporaire.
 */
export function ouvrirApercu(cle: string): Promise<NodeJS.ReadableStream> {
  return lecteurMinio(BORNE_MINIO).getObject(BUCKET_VIGNETTES, cle);
}
