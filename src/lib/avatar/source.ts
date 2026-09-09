/**
 * A_8b — LA SOURCE PRIVEE D'UN AVATAR : LA DESIGNER, LA LIRE, LA TRANSMETTRE.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * CE QUE CE MODULE CORRIGE
 * ═════════════════════════════════════════════════════════════════════════
 *
 * La route de creation posait un `getPublicUrl` sur la photo — ou la video —
 * du visage de la personne, et rangeait cette URL en base comme verite
 * canonique. Le relais public sert tout objet d'un compartiment autorise SANS
 * SESSION : le lien etait donc permanent, non revocable, et pointait sur la
 * donnee la plus sensible que Studiio detienne.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * DEUX CHOSES SEPAREES, ET C'EST LE POINT
 * ═════════════════════════════════════════════════════════════════════════
 *
 * 1. LA SOURCE CANONIQUE — une cle d'objet, rien d'autre. Elle dit OU est la
 *    donnee, jamais comment y acceder.
 * 2. LE TRANSPORT — la facon dont un tiers (le fournisseur d'avatar) pourra
 *    la lire, decidee a chaque fois, jamais rangee en base.
 *
 * Les melanger est exactement ce qui a produit le defaut : une URL est un
 * DROIT D'ACCES, et un droit d'acces qu'on persiste devient permanent par
 * accident.
 *
 * ⚠️ AUCUN APPEL FOURNISSEUR ICI. Ce module ne connait ni HeyGen ni aucun
 * autre : il prepare un acces, il ne s'en sert pas. Le branchement est A_8c.
 */
import { clientMinio, lecteurMinio, signeurInterne } from '@/lib/storage/minio-client';
import { supabaseAdmin } from '@/lib/db/supabase';
import { BUCKET_NAMESPACE_AVATAR, SEGMENT_NAMESPACE_AVATAR } from '@/lib/storage/acces-objet';
import type { MesureSourceAvatar } from './qualite';

/** Le compartiment des sources d'avatar — celui des medias, deja en place. */
export const BUCKET_AVATAR = BUCKET_NAMESPACE_AVATAR;

/**
 * Combien de temps un acces accorde a un tiers reste valable.
 *
 * ⚠️ COURT, ET CE N'EST PAS UN REGLAGE DE CONFORT. Une URL signee est un droit
 * d'acces a un visage : plus elle vit, plus la fenetre pendant laquelle une
 * fuite reste exploitable est grande. Cinq minutes suffisent largement a un
 * televersement serveur-a-serveur, et ne suffisent a rien d'autre.
 */
export const TTL_SOURCE_AVATAR_SECONDES = 300;

/** Ce qu'une source d'avatar peut etre. Rien d'autre n'entre. */
const TYPES_SOURCE_AUTORISES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

/**
 * Le type a SERVIR pour une cle, decide par nous.
 *
 * ⚠️ JAMAIS LU SUR L'OBJET. MinIO pose `application/octet-stream` des qu'un
 * televersement n'a rien declare ; s'y fier laisserait servir en HTML, depuis
 * notre origine, un fichier depose par un autre chemin. Une extension inconnue
 * ne se devine pas : elle se refuse.
 */
export function typeSourceAvatar(cle: unknown): string | null {
  if (typeof cle !== 'string') return null;
  const point = cle.lastIndexOf('.');
  if (point < 0) return null;
  return TYPES_SOURCE_AUTORISES[cle.slice(point + 1).toLowerCase()] ?? null;
}

/**
 * La cle d'une nouvelle source d'avatar.
 *
 * ⚠️ LE COMPTE EST DANS LA CLE, ET C'EST LA PREUVE DE PROPRIETE. Le prefixe ne
 * suppose pas l'appartenance, il la porte — et `cleSourceAvatarDuCompte`
 * ci-dessous s'en sert pour refuser toute cle qui ne commence pas par le bon.
 *
 * Le segment `avatar` place l'objet dans le namespace que le relais public
 * refuse et que les routes d'envoi ne peuvent pas fabriquer.
 */
export function cleSourceAvatar(userId: string, extension: string, horodatage: number): string {
  return `${userId}/${SEGMENT_NAMESPACE_AVATAR}/source-${horodatage}.${extension}`;
}

/**
 * Cette cle appartient-elle bien a ce compte, et au namespace avatar ?
 *
 * Deux questions, une seule reponse, parce qu'elles ne se separent jamais :
 * une cle du bon compte hors du namespace n'est pas une source d'avatar, et
 * une cle du namespace d'un autre compte n'est pas la sienne.
 */
export function cleSourceAvatarDuCompte(cle: unknown, userId: string): cle is string {
  if (typeof cle !== 'string' || cle.length === 0 || !userId) return false;
  if (cle.includes('..') || cle.includes('://') || cle.includes('\\')) return false;
  const attendu = `${userId}/${SEGMENT_NAMESPACE_AVATAR}/`;
  if (!cle.startsWith(attendu)) return false;
  // Rien apres le prefixe, ou un segment vide : ce n'est pas un objet.
  return cle.length > attendu.length && !cle.includes('//');
}

/** Le flux d'une source, pour la servir. Les octets ne sont pas materialises. */
export function ouvrirSourceAvatar(cle: string): Promise<NodeJS.ReadableStream> {
  return lecteurMinio().getObject(BUCKET_AVATAR, cle);
}

/** La source existe-t-elle vraiment ? Question posee APRES la propriete. */
export async function sourceAvatarPresente(cle: string): Promise<boolean> {
  try {
    const stat = await clientMinio().statObject(BUCKET_AVATAR, cle);
    return Number(stat?.size ?? 0) > 0;
  } catch {
    return false;
  }
}

/* ═════════════════════════════════════════════════════════════════════════
   LE CONTRAT DE TRANSMISSION — ECRIT, TESTE, NON APPELE
   ═════════════════════════════════════════════════════════════════════════ */

/**
 * Comment un fournisseur recevra la source.
 *
 * `url_signee_courte` — le fournisseur va chercher les octets lui-meme, par
 *   une adresse qui expire. Simple, mais l'adresse existe pendant sa duree de
 *   vie : elle ne doit ni etre journalisee, ni persistee, ni voyager plus loin
 *   que l'appel qui la consomme.
 * `flux_serveur` — nos octets partent depuis notre serveur. Aucune adresse
 *   n'existe jamais, mais le fichier transite par nous.
 *
 * ⚠️ LES DEUX RESTENT OUVERTS EN A_8b. Le choix depend du protocole que le
 * fournisseur imposera (A_8c) ; trancher maintenant serait decider sans savoir.
 */
export type ModeTransmissionSource = 'url_signee_courte' | 'flux_serveur';

export type AccesSourceAvatar =
  | { mode: 'url_signee_courte'; url: string; expireDansSecondes: number; typeContenu: string }
  | { mode: 'flux_serveur'; flux: NodeJS.ReadableStream; typeContenu: string };

export type MotifAccesSource =
  | 'source_absente'
  | 'type_non_autorise'
  | 'stockage_injoignable';

/**
 * Prepare l'acces d'un fournisseur a la source d'un avatar.
 *
 * ⚠️ L'ENTREE EST UN COMPTE ET UNE CLE DEJA VERIFIEE, JAMAIS UNE CLE DU
 * NAVIGATEUR. La propriete est revalidee ici malgre tout : cette fonction
 * signera un jour un acces a un visage, et une garde de plus au bord d'une
 * telle porte ne coute rien.
 *
 * ⚠️ CE QUI SORT NE DOIT NI ETRE JOURNALISE NI ECRIT EN BASE. Une URL signee
 * rangee quelque part cesse d'etre temporaire — c'est le defaut d'origine sous
 * un autre nom.
 */
export async function preparerSourceAvatarPourProvider(
  userId: string,
  cle: unknown,
  mode: ModeTransmissionSource,
): Promise<{ acces: AccesSourceAvatar | null; motif: MotifAccesSource | null }> {
  const echec = (motif: MotifAccesSource) => ({ acces: null, motif });

  if (!cleSourceAvatarDuCompte(cle, userId)) return echec('source_absente');
  const typeContenu = typeSourceAvatar(cle);
  if (typeContenu === null) return echec('type_non_autorise');
  if (!(await sourceAvatarPresente(cle))) return echec('source_absente');

  if (mode === 'flux_serveur') {
    try {
      const flux = await ouvrirSourceAvatar(cle);
      return { acces: { mode, flux, typeContenu }, motif: null };
    } catch {
      return echec('stockage_injoignable');
    }
  }

  const signeur = signeurInterne();
  if (!signeur) return echec('stockage_injoignable');
  try {
    const url = await signeur.presignedGetObject(
      BUCKET_AVATAR, cle, TTL_SOURCE_AVATAR_SECONDES,
    );
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      return echec('stockage_injoignable');
    }
    return {
      acces: {
        mode, url, expireDansSecondes: TTL_SOURCE_AVATAR_SECONDES, typeContenu,
      },
      motif: null,
    };
  } catch {
    return echec('stockage_injoignable');
  }
}

/* ═════════════════════════════════════════════════════════════════════════
   LA SONDE — A_8c
   ═════════════════════════════════════════════════════════════════════════ */

/**
 * Les arguments ffprobe qui mesurent une source d'avatar.
 *
 * ⚠️ `side_data_list` EST DEMANDE, ET IL EST INDISPENSABLE. C'est la que vit
 * la rotation d'un telephone : sans elle, une video portrait filmee a l'iPhone
 * se lit `1920 x 1080` et se ferait classer paysage — un refus, ou pire, un
 * cadrage faux, pour une video parfaitement valide.
 */
export function argumentsSondeAvatar(fichier: string): string[] {
  return [
    '-v', 'error',
    '-show_entries',
    'format=duration,size:stream=codec_type,codec_name,width,height,'
    + 'avg_frame_rate,r_frame_rate:stream_side_data=rotation',
    '-of', 'json', fichier,
  ];
}

/** `avg_frame_rate` vient en fraction : « 30000/1001 ». */
function fpsDepuisFraction(brut: unknown): number | null {
  if (typeof brut !== 'string' || !brut.includes('/')) return null;
  const [n, d] = brut.split('/').map(Number);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0 || n === 0) return null;
  return n / d;
}

/**
 * La rotation declaree, ramenee a 0/90/180/270.
 *
 * ffprobe la rend tantot dans `side_data_list`, tantot negative (`-90`) :
 * les deux designent le meme quart de tour.
 */
export function rotationNormalisee(brut: unknown): number {
  const n = Number(brut);
  if (!Number.isFinite(n)) return 0;
  return ((Math.round(n) % 360) + 360) % 360;
}

/** Lit la sortie JSON de la sonde. Aucun champ n'est deduit d'un autre. */
export function lireSondeAvatar(stdout: string): MesureSourceAvatar {
  const vide: MesureSourceAvatar = {
    dureeSecondes: null, largeur: null, hauteur: null, fps: null,
    codecVideo: null, codecAudio: null, aAudio: false,
    orientation: null, rotationDegres: 0, octets: 0, lisible: false,
  };
  let o: {
    format?: { duration?: unknown; size?: unknown };
    streams?: Array<Record<string, unknown>>;
  };
  try { o = JSON.parse(stdout) as typeof o; } catch { return vide; }

  const flux = Array.isArray(o.streams) ? o.streams : [];
  const video = flux.find((f) => f.codec_type === 'video');
  const audio = flux.find((f) => f.codec_type === 'audio');
  if (!video) return vide;

  const largeurBrute = Number(video.width);
  const hauteurBrute = Number(video.height);
  const rotation = rotationNormalisee(
    (Array.isArray(video.side_data_list)
      ? (video.side_data_list as Array<Record<string, unknown>>)
        .find((d) => d.rotation !== undefined)?.rotation
      : undefined) ?? video.rotation,
  );
  /* ⚠️ UN QUART DE TOUR ECHANGE LES COTES. C'est la seule facon d'obtenir les
     dimensions telles qu'un lecteur les AFFICHE, et donc l'orientation reelle. */
  const pivote = rotation === 90 || rotation === 270;
  const largeur = Number.isFinite(largeurBrute)
    ? (pivote ? hauteurBrute : largeurBrute) : null;
  const hauteur = Number.isFinite(hauteurBrute)
    ? (pivote ? largeurBrute : hauteurBrute) : null;

  const duree = Number(o.format?.duration);
  const taille = Number(o.format?.size);

  return {
    dureeSecondes: Number.isFinite(duree) && duree > 0 ? duree : null,
    largeur: Number.isFinite(largeur as number) ? (largeur as number) : null,
    hauteur: Number.isFinite(hauteur as number) ? (hauteur as number) : null,
    fps: fpsDepuisFraction(video.avg_frame_rate) ?? fpsDepuisFraction(video.r_frame_rate),
    codecVideo: typeof video.codec_name === 'string' ? video.codec_name : null,
    codecAudio: audio && typeof audio.codec_name === 'string' ? audio.codec_name : null,
    aAudio: audio !== undefined,
    orientation: largeur === null || hauteur === null ? null
      : largeur === hauteur ? 'carre' : (hauteur as number) > (largeur as number)
        ? 'portrait' : 'paysage',
    rotationDegres: rotation,
    octets: Number.isFinite(taille) ? taille : 0,
    lisible: true,
  };
}

/**
 * Retire une source d'avatar devenue inutile — A_8e.
 *
 * ⚠️ TROIS GARDES AVANT LE MOINDRE APPEL AU STOCKAGE, et elles ne sont pas
 * decoratives :
 *
 *   1. la cle appartient au compte ET au namespace avatar. Une cle de
 *      `library/` passerait sinon, et supprimer un media de la mediatheque
 *      parce qu'on a remplace une video d'enrollment serait une perte de
 *      donnee que rien n'annonce.
 *   2. elle est differente de celle qu'on vient d'ecrire. Le meme horodatage
 *      a la milliseconde effacerait la source qui vient d'etre acceptee.
 *   3. l'echec est silencieux. Le remplacement, lui, a REUSSI : rendre une
 *      erreur ici ferait croire le contraire, et l'utilisateur reprendrait une
 *      operation deja faite.
 *
 * Rend `true` seulement si un objet a effectivement ete retire.
 */
export async function retirerSourceAvatar(
  userId: string, cle: unknown, cleConservee?: string,
): Promise<boolean> {
  if (!cleSourceAvatarDuCompte(cle, userId)) return false;
  if (cleConservee !== undefined && cle === cleConservee) return false;
  try {
    /* Le meme relais de stockage que partout ailleurs : `remove` prend une
       LISTE, et ne connait que le compartiment qu'on lui a donne. */
    const { error } = await supabaseAdmin.storage.from(BUCKET_AVATAR).remove([cle]);
    return !error;
  } catch {
    /* Objet deja disparu, stockage injoignable : le remplacement reste bon.
       Un orphelin coute quelques megaoctets ; une exception ici couterait la
       confiance dans une operation qui a pourtant abouti. */
    return false;
  }
}
