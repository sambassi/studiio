/**
 * L'AVATAR VIDÉO D-ID — dans la MÊME table, les MÊMES versions, la MÊME
 * validation que l'avatar HeyGen. Ce module ne fait que ce que le
 * fournisseur D-ID ajoute : un consentement tiré au sort, lu à la caméra,
 * vérifié ; puis un V3 Instant Avatar entraîné ; puis un aperçu produit sur
 * NOTRE voix (ElevenLabs personnelle, SPOKEN_SCRIPT), jamais sur un clone de
 * voix D-ID.
 *
 * Ce qui est RÉUTILISÉ : `user_avatars` (provider = 'did'), `version` et le
 * compare-and-set, `source_object_key` (la source privée, déposée par
 * `/api/avatar/create` avec `provider=did`), `avatar_generations` (intention
 * `apercu`, index unique « un aperçu vivant par version »), le suivi par
 * `/api/avatar/status` (re-hébergement), `validated_at` (validation
 * humaine, jamais automatique), la suppression douce.
 *
 * Ce qui n'est JAMAIS fait : une URL fournisseur persistée comme identité,
 * un objet privé rendu public (le fournisseur reçoit une URL SIGNÉE et
 * EXPIRANTE, `jeton-media.ts`), une validation automatique, un repli HeyGen.
 *
 * Idempotence : chaque étape avance par compare-and-set sur la ligne
 * `(id, user_id, version)` et sur l'état exact qu'elle remplace. Deux clics
 * simultanés : un seul consentement D-ID retenu, une seule vidéo déposée, un
 * seul avatar D-ID créé, un seul aperçu (index unique).
 */

import { supabaseAdmin } from '@/lib/db/supabase';
import { ETAT_SOURCE_PRETE, SCRIPT_APERCU, INTENTION_APERCU, etatAvatar, type AvatarLigne } from '@/lib/avatar/contrat';
import { avatarVivantDuCompte, type AvatarVivant } from '@/lib/avatar/lecture';
import {
  BUCKET_AVATAR, cleConsentementAvatar, cleAudioAvatar, cleSourceAvatarDuCompte, retirerObjetPriveAvatar,
} from '@/lib/avatar/source';
import { urlMediaTemporaire } from '@/lib/avatar/jeton-media';
import {
  DidError, didVideoAvatarDisponible, didVideoAvatarConfigure, creerConsentement, deposerVideoConsentement,
  lireConsentement, creerAvatarDid as creerAvatarChezDid, lireAvatarDid, supprimerAvatarDid,
  creerSceneAudio, type DepsDid, type StatutAvatarDid, type StatutConsentementDid,
} from '@/lib/providers/did/client';
import { resoudreVoixDuCompte } from '@/lib/voice/profil';
import { scripts } from '@/lib/voice/prononciations';
import { synthetiserAvecVoix } from '@/lib/voice/synthese';

export const FOURNISSEUR_DID = 'did';
export const MESSAGE_DID_INDISPONIBLE = 'Avatar vidéo temporairement indisponible.';
/** Ce que D-ID accepte en `source_url` : MP4 et QuickTime. WebM n'en fait pas partie. */
export const TYPES_VIDEO_DID: Readonly<Record<string, 'mp4' | 'mov'>> = { 'video/mp4': 'mp4', 'video/quicktime': 'mov' };
/** Limite documentée par D-ID pour une vidéo de consentement (« Video buffer size exceeds 50MB »). */
export const MAX_VIDEO_CONSENTEMENT_OCTETS = 50 * 1024 * 1024;
export const MAX_VIDEO_SOURCE_DID_OCTETS = 50 * 1024 * 1024;

/** Les colonnes D-ID de `user_avatars`, en plus du contrat commun. */
export interface AvatarDid extends AvatarVivant {
  provider?: string | null;
  provider_consent_id?: string | null;
  provider_consent_text?: string | null;
  provider_consent_status?: string | null;
  consent_object_key?: string | null;
  /** Le nom de la PERSONNE qui consent — celui qu'elle prononce et que D-ID reçoit. Jamais le nom de l'avatar. */
  consent_name?: string | null;
  provider_consent_created_at?: string | null;
  /** La version de l'avatar à laquelle le consentement est rattaché ; différente de `version` = consentement hérité, à confirmer. */
  provider_consent_version?: number | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Le nom de consentement et la phrase
// ─────────────────────────────────────────────────────────────────────────

/**
 * D-ID rend une phrase qui contient le marqueur `[user name]` (et un
 * passcode de trois mots). La personne doit lire la phrase AVEC son nom à
 * la place du marqueur, et ce même nom part dans `name` de
 * `POST /consents/{id}` : c'est ce que D-ID compare à l'audio. Un nom
 * différent — a fortiori « Mon avatar vidéo » — c'est « audio-text mismatch ».
 */
export const MARQUEUR_NOM_DID = /\[user[ _-]?name\]/gi;

/** Un consentement D-ID expire 30 minutes après sa création (documentation D-ID). On prévient un peu avant. */
export const DUREE_VALIDITE_CONSENTEMENT_MS = 30 * 60 * 1000;
export const MARGE_EXPIRATION_CONSENTEMENT_MS = 2 * 60 * 1000;

/**
 * Le nom tel qu'il sera prononcé : lettres (accents compris), espaces,
 * apostrophes, traits d'union ; 2 à 80 caractères ; espaces normalisés.
 * `null` si rien d'utilisable — on ne fabrique pas un nom.
 */
export function nomConsentementValide(brut: unknown): string | null {
  if (typeof brut !== 'string') return null;
  const nom = brut.trim().replace(/\s+/g, ' ');
  if (nom.length < 2 || nom.length > 80) return null;
  // Lettres de toute écriture, marques (accents combinés), apostrophes droite et typographique, espace, point, trait d'union.
  if (!/^[\p{L}][\p{L}\p{M}'\u2019 .-]*[\p{L}.]$/u.test(nom)) return null;
  return nom;
}

/** La phrase À LIRE : le marqueur remplacé par le nom ; sans marqueur, la phrase telle quelle. */
export function phraseConsentementAvecNom(texte: string, nom: string): string {
  return texte.replace(MARQUEUR_NOM_DID, nom);
}

export function consentementExpire(creeLe: string | null | undefined, maintenant = Date.now()): boolean {
  if (!creeLe) return true;
  const t = new Date(creeLe).getTime();
  if (!Number.isFinite(t)) return true;
  return maintenant - t > DUREE_VALIDITE_CONSENTEMENT_MS - MARGE_EXPIRATION_CONSENTEMENT_MS;
}

export type EtapeDid =
  | 'consentement_a_demander'      // source déposée, aucun consentement fournisseur
  | 'consentement_reutilisable'    // un consentement VALIDÉ (done) d'une version précédente : la personne confirme, ou change de nom
  | 'consentement_texte_pret'      // phrase reçue, vidéo de consentement à importer
  | 'consentement_en_verification' // vidéo déposée, D-ID vérifie
  | 'consentement_refuse'          // D-ID a refusé : réimporter
  | 'consentement_accepte'         // prêt à créer l'avatar
  | 'creation_en_cours'            // avatar D-ID en entraînement
  | 'pret'                         // entraîné, à valider (aperçu)
  | 'valide'
  | 'echec';

/** L'étape D-ID, DÉRIVÉE de la ligne — jamais stockée une seconde fois. */
export function etapeDid(a: AvatarDid): EtapeDid {
  const etat = etatAvatar(a);
  if (etat === 'valide') return 'valide';
  if (etat === 'entraine_non_valide') return 'pret';
  if (etat === 'entrainement') return 'creation_en_cours';
  if (etat === 'echec' && a.provider_avatar_id) return 'echec';
  // Fournisseur jamais sollicité (ou échec avant création) : le consentement décide.
  if (!a.provider_consent_id || !a.provider_consent_text) return 'consentement_a_demander';
  const s = a.provider_consent_status;
  // Un consentement validé n'est « accepté » POUR CETTE VERSION que s'il lui est rattaché ;
  // hérité d'une version précédente, il attend la confirmation explicite de la personne.
  if (s === 'done') return a.provider_consent_version === a.version ? 'consentement_accepte' : 'consentement_reutilisable';
  if (s === 'error') return 'consentement_refuse';
  if (s === 'created' || s === 'validating') return 'consentement_en_verification';
  return 'consentement_texte_pret';
}

export type MotifDid =
  | 'moteur_indisponible' | 'avatar_absent' | 'fournisseur_different' | 'source_absente'
  | 'consentement_absent' | 'consentement_non_accepte' | 'consentement_en_verification' | 'consentement_deja_accepte'
  | 'avatar_deja_cree' | 'avatar_non_pret' | 'concurrent' | 'format_invalide' | 'fichier_trop_lourd' | 'fichier_vide'
  | 'voix_indisponible' | 'apercu_existant' | 'nom_requis' | 'consentement_expire' | 'consentement_non_reutilisable' | 'base';

export type ResultatDid<T> = { ok: true } & T | { ok: false; motif: MotifDid; message: string; statut: number };

const refus = <T>(motif: MotifDid, message: string, statut: number): ResultatDid<T> => ({ ok: false, motif, message, statut });

const MESSAGES: Record<MotifDid, string> = {
  moteur_indisponible: MESSAGE_DID_INDISPONIBLE,
  avatar_absent: 'Importez d’abord votre vidéo.',
  fournisseur_different: 'Votre avatar courant n’est pas un avatar vidéo.',
  source_absente: 'Votre vidéo n’est plus disponible. Réimportez-la.',
  consentement_absent: 'Obtenez d’abord votre phrase de consentement.',
  consentement_non_accepte: 'Votre consentement n’a pas encore été accepté.',
  consentement_en_verification: 'Votre vidéo de consentement est déjà en cours de vérification.',
  consentement_deja_accepte: 'Votre consentement est déjà accepté.',
  avatar_deja_cree: 'Votre avatar vidéo est déjà créé.',
  avatar_non_pret: 'Votre avatar vidéo n’est pas encore prêt.',
  concurrent: 'Une autre action vient de modifier votre avatar. Rechargez la page.',
  format_invalide: 'Format vidéo non supporté. Utilisez MP4 ou MOV.',
  fichier_trop_lourd: 'Vidéo trop lourde (50 Mo maximum).',
  fichier_vide: 'Le fichier est vide.',
  voix_indisponible: 'Configurez votre voix personnelle (« Ma voix ») pour générer l’aperçu.',
  apercu_existant: 'Un aperçu est déjà en cours ou disponible pour cette version.',
  nom_requis: 'Indiquez votre nom tel que vous le prononcerez dans la vidéo de consentement.',
  consentement_expire: 'Votre phrase de consentement a expiré (30 minutes). Obtenez une nouvelle phrase, puis réenregistrez-la.',
  consentement_non_reutilisable: 'Aucun consentement validé n’est réutilisable pour ce nom. Obtenez une nouvelle phrase de consentement.',
  base: 'Votre avatar n’a pas pu être lu ou enregistré. Réessayez.',
};

function disponibilite<T>(env: NodeJS.ProcessEnv): ResultatDid<T> | null {
  if (didVideoAvatarDisponible(env)) return null;
  // Drapeau levé mais clé absente : même phrase à l'écran, code distinct dans le journal.
  if (env.DID_VIDEO_AVATAR_ACTIVE === '1' && !didVideoAvatarConfigure(env)) {
    console.warn('[Avatar][D-ID] DID_VIDEO_AVATAR_ACTIVE=1 mais DID_API_KEY absente : avatar vidéo indisponible.');
  }
  return refus('moteur_indisponible', MESSAGES.moteur_indisponible, 503);
}

async function avatarDidDuCompte(userId: string): Promise<ResultatDid<{ avatar: AvatarDid }>> {
  const lecture = await avatarVivantDuCompte(userId);
  if (!lecture.ok) return refus('base', MESSAGES.base, 500);
  if (!lecture.avatar) return refus('avatar_absent', MESSAGES.avatar_absent, 404);
  const a = lecture.avatar as AvatarDid;
  if (a.provider !== FOURNISSEUR_DID) return refus('fournisseur_different', MESSAGES.fournisseur_different, 409);
  return { ok: true, avatar: a };
}

const messageFournisseur = (e: unknown, defaut: string) => (e instanceof DidError ? e.message : defaut);
const statutFournisseur = (e: unknown) => (e instanceof DidError ? e.httpStatus : 502);

/** D-ID → vocabulaire local de `user_avatars.status` (celui que `etatAvatar` lit). */
export function statutLocalDid(statut: StatutAvatarDid): 'processing' | 'completed' | 'failed' {
  if (statut === 'done') return 'completed';
  if (statut === 'error' || statut === 'rejected') return 'failed';
  return 'processing';
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Le consentement : la phrase
// ─────────────────────────────────────────────────────────────────────────

/**
 * La phrase à lire, pour CE nom.
 *
 * `nom` : le nom de la personne, tel qu'elle le prononcera (saisi à l'écran,
 * pré-rempli du profil). `renouveler` : demander une nouvelle phrase même si
 * une phrase valide existe (elle a expiré côté personne, ou le nom change).
 * Une phrase est rendue telle quelle (`deja: true`) si elle existe, n'est ni
 * refusée ni expirée, porte le même nom, et qu'on ne demande pas à renouveler.
 * Un consentement en VÉRIFICATION ou ACCEPTÉ ne se remplace pas.
 */
export async function demanderConsentementDid(
  userId: string, args: { nom?: unknown; renouveler?: boolean } = {}, deps: DepsDid = {},
): Promise<ResultatDid<{ texte: string; nom: string; etape: EtapeDid; deja: boolean; expireLe: string | null }>> {
  type R = { texte: string; nom: string; etape: EtapeDid; deja: boolean; expireLe: string | null };
  const env = deps.env ?? process.env;
  const indispo = disponibilite<R>(env);
  if (indispo) return indispo;
  const lu = await avatarDidDuCompte(userId);
  if (!lu.ok) return lu;
  const a = lu.avatar;
  if (a.provider_avatar_id) return refus('avatar_deja_cree', MESSAGES.avatar_deja_cree, 409);
  if (!cleSourceAvatarDuCompte(a.source_object_key, userId)) return refus('source_absente', MESSAGES.source_absente, 409);
  const s = a.provider_consent_status;
  if (s === 'created' || s === 'validating') return refus('consentement_en_verification', MESSAGES.consentement_en_verification, 409);
  const nom = nomConsentementValide(args.nom) ?? nomConsentementValide(a.consent_name);
  if (!nom) return refus('nom_requis', MESSAGES.nom_requis, 400);
  // Un consentement VALIDÉ rattaché à cette version ne se remplace pas ; hérité au même
  // nom, il se RÉUTILISE (jamais une nouvelle phrase pour la même personne) ; hérité à un
  // autre nom, la personne change : nouvelle phrase, l'ancien consentement quitte la ligne.
  if (s === 'done' && a.provider_consent_version === a.version) return refus('consentement_deja_accepte', MESSAGES.consentement_deja_accepte, 409);
  // Même nom, hérité, sans demande explicite de renouvellement : on oriente vers la réutilisation.
  // `renouveler` = la personne le demande (par exemple : le fournisseur ne connaît plus l'ancien consentement).
  if (s === 'done' && a.consent_name === nom && !args.renouveler) return refus('consentement_deja_accepte', 'Un consentement validé existe déjà pour ce nom : réutilisez-le.', 409);
  const expireLeDe = (cree: string | null | undefined) => (cree ? new Date(new Date(cree).getTime() + DUREE_VALIDITE_CONSENTEMENT_MS).toISOString() : null);

  // Une phrase valide, non refusée, au même nom : la même — aucun second consentement.
  if (!args.renouveler && a.provider_consent_id && a.provider_consent_text && s !== 'error'
    && a.consent_name === nom && !consentementExpire(a.provider_consent_created_at)) {
    return { ok: true, texte: a.provider_consent_text, nom, etape: etapeDid(a), deja: true, expireLe: expireLeDe(a.provider_consent_created_at) };
  }

  let consentement: { id: string; texte: string };
  try {
    consentement = await creerConsentement('French', deps);
  } catch (e) {
    console.warn(`[Avatar][D-ID] consentement non créé pour l'avatar ${a.id} v${a.version} : ${e instanceof DidError ? `${e.code} — ${e.message}` : 'erreur inconnue'}`);
    return refus('base', messageFournisseur(e, 'Le fournisseur n’a pas pu créer le consentement.'), statutFournisseur(e));
  }
  const phrase = phraseConsentementAvecNom(consentement.texte, nom);
  const creeLe = new Date().toISOString();
  // CAS sur l'état exact remplacé : le consentement précédent (ou aucun), jamais un consentement en vérification/accepté.
  let maj = supabaseAdmin
    .from('user_avatars')
    .update({
      provider_consent_id: consentement.id, provider_consent_text: phrase, provider_consent_status: null, consent_object_key: null,
      consent_name: nom, provider_consent_created_at: creeLe, provider_consent_version: a.version,
    })
    .eq('id', a.id).eq('user_id', userId).eq('version', a.version).is('deleted_at', null).is('provider_avatar_id', null);
  maj = a.provider_consent_id ? maj.eq('provider_consent_id', a.provider_consent_id) : maj.is('provider_consent_id', null);
  const { data: touchees, error } = await maj.select('id');
  if (error) return refus('base', MESSAGES.base, 500);
  if (!touchees || touchees.length !== 1) {
    // Une autre requête a gagné : on rend ce qu'elle a posé (le consentement qu'on vient de créer reste orphelin, sans coût).
    const relu = await avatarDidDuCompte(userId);
    if (relu.ok && relu.avatar.provider_consent_text && relu.avatar.consent_name && relu.avatar.version === a.version) {
      return { ok: true, texte: relu.avatar.provider_consent_text, nom: relu.avatar.consent_name, etape: etapeDid(relu.avatar), deja: true, expireLe: expireLeDe(relu.avatar.provider_consent_created_at) };
    }
    return refus('concurrent', MESSAGES.concurrent, 409);
  }
  // L'ancienne vidéo de consentement (refusée) n'a plus de ligne qui la désigne.
  if (a.consent_object_key) await retirerObjetPriveAvatar(userId, a.consent_object_key);
  return { ok: true, texte: phrase, nom, etape: 'consentement_texte_pret', deja: false, expireLe: expireLeDe(creeLe) };
}

// ─────────────────────────────────────────────────────────────────────────
// 2. La vidéo de consentement
// ─────────────────────────────────────────────────────────────────────────

export interface FichierRecu { buffer: Buffer; type: string; taille: number; nom: string }

export async function deposerVideoConsentementDid(
  userId: string, fichier: FichierRecu, deps: DepsDid = {},
): Promise<ResultatDid<{ etape: EtapeDid }>> {
  const env = deps.env ?? process.env;
  const indispo = disponibilite<{ etape: EtapeDid }>(env);
  if (indispo) return indispo;
  const ext = TYPES_VIDEO_DID[fichier.type];
  if (!ext) return refus('format_invalide', MESSAGES.format_invalide, 400);
  if (fichier.taille <= 0 || fichier.buffer.length === 0) return refus('fichier_vide', MESSAGES.fichier_vide, 400);
  if (fichier.taille > MAX_VIDEO_CONSENTEMENT_OCTETS) return refus('fichier_trop_lourd', MESSAGES.fichier_trop_lourd, 413);

  const lu = await avatarDidDuCompte(userId);
  if (!lu.ok) return lu;
  const a = lu.avatar;
  if (a.provider_avatar_id) return refus('avatar_deja_cree', MESSAGES.avatar_deja_cree, 409);
  if (!a.provider_consent_id || !a.provider_consent_text) return refus('consentement_absent', MESSAGES.consentement_absent, 409);
  // Le nom de la PERSONNE, jamais celui de l'avatar : sans lui, la phrase n'a pas été obtenue par ce chemin.
  const nomConsentement = nomConsentementValide(a.consent_name);
  if (!nomConsentement) return refus('nom_requis', MESSAGES.nom_requis, 409);
  const s = a.provider_consent_status;
  if (s === 'created' || s === 'validating') return refus('consentement_en_verification', MESSAGES.consentement_en_verification, 409);
  if (s === 'done') return refus('consentement_deja_accepte', MESSAGES.consentement_deja_accepte, 409);
  if (consentementExpire(a.provider_consent_created_at)) return refus('consentement_expire', MESSAGES.consentement_expire, 409);

  // Le dépôt privé, AVANT la base : sans objet, rien d'autre.
  const cle = cleConsentementAvatar(userId, ext);
  const { error: upErr } = await supabaseAdmin.storage.from(BUCKET_AVATAR).upload(cle, fichier.buffer, { contentType: fichier.type, upsert: false });
  if (upErr) return refus('base', 'Votre vidéo n’a pas pu être enregistrée. Réessayez.', 500);

  // CAS sur l'état exact remplacé : pas de vidéo (statut NULL) ou vidéo refusée ('error').
  let maj = supabaseAdmin
    .from('user_avatars')
    .update({ consent_object_key: cle, provider_consent_status: 'created', provider_consent_version: a.version })
    .eq('id', a.id).eq('user_id', userId).eq('version', a.version).is('deleted_at', null)
    .eq('provider_consent_id', a.provider_consent_id);
  maj = s === 'error' ? maj.eq('provider_consent_status', 'error') : maj.is('provider_consent_status', null);
  const { data: touchees, error } = await maj.select('id');
  if (error || !touchees || touchees.length !== 1) {
    // Rien posé (ou incertain) : MA clé est retirée, jamais celle qu'une autre requête a posée.
    const relu = await avatarDidDuCompte(userId);
    const conservee = relu.ok ? relu.avatar.consent_object_key ?? null : null;
    if (relu.ok) await retirerObjetPriveAvatar(userId, cle, conservee);
    return refus(error ? 'base' : 'concurrent', error ? MESSAGES.base : MESSAGES.concurrent, error ? 500 : 409);
  }
  // L'ancienne vidéo refusée n'a plus de ligne qui la désigne.
  if (a.consent_object_key && a.consent_object_key !== cle) await retirerObjetPriveAvatar(userId, a.consent_object_key, cle);

  // Le fournisseur reçoit une URL signée, expirante — jamais l'objet public.
  try {
    await deposerVideoConsentement({ consentId: a.provider_consent_id, nom: nomConsentement, sourceUrl: urlMediaTemporaire(cle, {}, env) }, deps);
  } catch (e) {
    // Le refus fournisseur est JOURNALISÉ avec son code et sa description
    // (jamais la clé) : un 400 doit pouvoir être diagnostiqué.
    console.warn(`[Avatar][D-ID] vidéo de consentement refusée pour l'avatar ${a.id} v${a.version} (consentement ${a.provider_consent_id}) : ${e instanceof DidError ? `${e.code} — ${e.message}` : 'erreur inconnue'}`);
    await supabaseAdmin.from('user_avatars').update({ provider_consent_status: 'error' })
      .eq('id', a.id).eq('user_id', userId).eq('version', a.version).eq('consent_object_key', cle);
    return refus('base', messageFournisseur(e, 'Le fournisseur n’a pas pu recevoir votre vidéo de consentement.'), statutFournisseur(e));
  }
  return { ok: true, etape: 'consentement_en_verification' };
}

// ─────────────────────────────────────────────────────────────────────────
// 2 bis. Réutiliser un consentement VALIDÉ — la même personne, un nouvel avatar
// ─────────────────────────────────────────────────────────────────────────

export interface ConsentementReutilisable {
  providerConsentId: string;
  texte: string;
  nom: string;
  creeLe: string | null;
  /** D'où il vient : la ligne vivante (version précédente) ou une ligne supprimée. */
  origine: 'ligne_vivante' | 'ligne_supprimee';
}

/**
 * Le consentement D-ID VALIDÉ le plus récent de CE compte pour EXACTEMENT ce
 * nom — dans l'historique de `user_avatars` : lignes supprimées comprises
 * (elles gardent leurs colonnes de consentement), et la ligne vivante quand
 * une version précédente l'a validé. D-ID confirme qu'un consentement `done`
 * sert aux futurs avatars de la même personne.
 *
 * Ce qui n'est JAMAIS repris de l'ancien avatar : `provider_avatar_id`.
 * Ce qui l'est : l'identifiant du consentement, sa phrase, le nom.
 * `null` si aucun — ou si le nom demandé n'est pas exactement celui validé.
 */
export async function consentementReutilisableDuCompte(userId: string, nomDemande: unknown): Promise<ConsentementReutilisable | null> {
  const nom = nomConsentementValide(nomDemande);
  if (!nom) return null;
  const { data, error } = await supabaseAdmin
    .from('user_avatars')
    .select('provider_consent_id, provider_consent_text, provider_consent_status, consent_name, provider_consent_created_at, deleted_at, created_at')
    .eq('user_id', userId)
    .eq('provider', FOURNISSEUR_DID)
    .eq('provider_consent_status', 'done')
    .eq('consent_name', nom)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error || !data) return null;
  for (const l of data as Array<Record<string, unknown>>) {
    if (typeof l.provider_consent_id !== 'string' || !l.provider_consent_id) continue;
    if (typeof l.provider_consent_text !== 'string' || !l.provider_consent_text) continue;
    if (l.consent_name !== nom) continue;
    return {
      providerConsentId: l.provider_consent_id,
      texte: l.provider_consent_text,
      nom,
      creeLe: typeof l.provider_consent_created_at === 'string' ? l.provider_consent_created_at : null,
      origine: l.deleted_at === null ? 'ligne_vivante' : 'ligne_supprimee',
    };
  }
  return null;
}

/**
 * Rattache à la version courante un consentement VALIDÉ de la même personne
 * (même nom, exactement) — sans POST /consents, sans phrase, sans vidéo.
 * Le fournisseur est d'abord relu (`GET /consents/{id}`) : s'il ne le connaît
 * plus ou ne le tient plus pour `done`, on revient PROPREMENT au flux
 * « Obtenir ma phrase » (409 `consentement_non_reutilisable`) — aucun repli
 * silencieux. L'écriture est un CAS sur l'état exact de la ligne.
 */
export async function reutiliserConsentementDid(
  userId: string, args: { nom?: unknown }, deps: DepsDid = {},
): Promise<ResultatDid<{ etape: EtapeDid; nom: string; texte: string; origine: ConsentementReutilisable['origine'] }>> {
  type R = { etape: EtapeDid; nom: string; texte: string; origine: ConsentementReutilisable['origine'] };
  const env = deps.env ?? process.env;
  const indispo = disponibilite<R>(env);
  if (indispo) return indispo;
  const lu = await avatarDidDuCompte(userId);
  if (!lu.ok) return lu;
  const a = lu.avatar;
  if (a.provider_avatar_id) return refus('avatar_deja_cree', MESSAGES.avatar_deja_cree, 409);
  if (!cleSourceAvatarDuCompte(a.source_object_key, userId)) return refus('source_absente', MESSAGES.source_absente, 409);
  const s = a.provider_consent_status;
  if (s === 'created' || s === 'validating') return refus('consentement_en_verification', MESSAGES.consentement_en_verification, 409);
  if (s === 'done' && a.provider_consent_version === a.version) return refus('consentement_deja_accepte', MESSAGES.consentement_deja_accepte, 409);
  const nom = nomConsentementValide(args.nom) ?? (s === 'done' ? nomConsentementValide(a.consent_name) : null);
  if (!nom) return refus('nom_requis', MESSAGES.nom_requis, 400);

  const reutilisable = await consentementReutilisableDuCompte(userId, nom);
  if (!reutilisable) return refus('consentement_non_reutilisable', MESSAGES.consentement_non_reutilisable, 409);

  // Le fournisseur le tient-il toujours pour validé ?
  try {
    const distant = await lireConsentement(reutilisable.providerConsentId, deps);
    if (distant.statut !== 'done') {
      console.warn(`[Avatar][D-ID] consentement ${reutilisable.providerConsentId} non réutilisable : statut fournisseur ${distant.statut}${distant.erreur ? ` — ${distant.erreur}` : ''}`);
      return refus('consentement_non_reutilisable', MESSAGES.consentement_non_reutilisable, 409);
    }
  } catch (e) {
    if (e instanceof DidError && (e.code === 'did_not_found' || e.httpStatus === 400)) {
      console.warn(`[Avatar][D-ID] consentement ${reutilisable.providerConsentId} introuvable chez le fournisseur : ${e.code} — ${e.message}`);
      return refus('consentement_non_reutilisable', MESSAGES.consentement_non_reutilisable, 409);
    }
    return refus('base', messageFournisseur(e, 'Le fournisseur n’a pas pu confirmer votre consentement.'), statutFournisseur(e));
  }

  // CAS sur l'état exact remplacé : le consentement présent sur la ligne (ou aucun).
  let maj = supabaseAdmin
    .from('user_avatars')
    .update({
      provider_consent_id: reutilisable.providerConsentId, provider_consent_text: reutilisable.texte, provider_consent_status: 'done',
      consent_name: nom, provider_consent_created_at: reutilisable.creeLe, provider_consent_version: a.version, consent_object_key: null,
    })
    .eq('id', a.id).eq('user_id', userId).eq('version', a.version).is('deleted_at', null).is('provider_avatar_id', null);
  maj = a.provider_consent_id ? maj.eq('provider_consent_id', a.provider_consent_id) : maj.is('provider_consent_id', null);
  const { data: touchees, error } = await maj.select('id');
  if (error) return refus('base', MESSAGES.base, 500);
  if (!touchees || touchees.length !== 1) return refus('concurrent', MESSAGES.concurrent, 409);
  if (a.consent_object_key) await retirerObjetPriveAvatar(userId, a.consent_object_key);
  return { ok: true, etape: 'consentement_accepte', nom, texte: reutilisable.texte, origine: reutilisable.origine };
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Le suivi du consentement (un poll par appel)
// ─────────────────────────────────────────────────────────────────────────

export async function verifierConsentementDid(
  userId: string, args: { nomReutilisation?: unknown } = {}, deps: DepsDid = {},
): Promise<ResultatDid<{ etape: EtapeDid; texte: string | null; nom: string | null; expireLe: string | null; erreur: string | null; reutilisable: { nom: string; origine: ConsentementReutilisable['origine'] } | null }>> {
  const lu = await avatarDidDuCompte(userId);
  if (!lu.ok) return lu;
  let a = lu.avatar;
  let erreur: string | null = null;
  // Pour le nom que la personne saisit : existe-t-il un consentement VALIDÉ à réutiliser ?
  // Seulement tant qu'aucun avatar n'est créé et qu'aucun défi n'est en vérification.
  let reutilisable: { nom: string; origine: ConsentementReutilisable['origine'] } | null = null;
  const nomR = nomConsentementValide(args.nomReutilisation);
  if (nomR && !a.provider_avatar_id && !(a.provider_consent_status === 'done' && a.provider_consent_version === a.version)) {
    const r = await consentementReutilisableDuCompte(userId, nomR);
    if (r) reutilisable = { nom: r.nom, origine: r.origine };
  }
  if (a.provider_consent_id && (a.provider_consent_status === 'created' || a.provider_consent_status === 'validating') && !a.provider_avatar_id) {
    if (!didVideoAvatarDisponible(deps.env ?? process.env)) return refus('moteur_indisponible', MESSAGES.moteur_indisponible, 503);
    let distant: { statut: StatutConsentementDid; erreur: string | null };
    try {
      distant = await lireConsentement(a.provider_consent_id, deps);
    } catch (e) {
      // Transitoire : on rend l'état connu, le prochain appel retentera.
      return { ok: true, etape: etapeDid(a), texte: a.provider_consent_text ?? null, nom: a.consent_name ?? null, expireLe: expirationDe(a), erreur: e instanceof DidError ? e.message : null, reutilisable };
    }
    erreur = distant.erreur;
    if (distant.statut === 'error') console.warn(`[Avatar][D-ID] consentement ${a.provider_consent_id} refusé par le fournisseur : ${distant.erreur ?? 'sans description'}`);
    if (distant.statut !== a.provider_consent_status) {
      const { data: touchees } = await supabaseAdmin
        .from('user_avatars')
        .update({ provider_consent_status: distant.statut })
        .eq('id', a.id).eq('user_id', userId).eq('version', a.version).is('deleted_at', null)
        .eq('provider_consent_id', a.provider_consent_id)
        .select('*');
      if (touchees && touchees.length === 1) a = touchees[0] as AvatarDid;
    }
  }
  return { ok: true, etape: etapeDid(a), texte: a.provider_consent_text ?? null, nom: a.consent_name ?? null, expireLe: expirationDe(a), erreur, reutilisable };
}

/** L'expiration ne concerne que le DÉFI : un consentement validé (`done`) ne périme pas. */
function expirationDe(a: AvatarDid): string | null {
  if (a.provider_consent_status === 'done') return null;
  if (!a.provider_consent_created_at) return null;
  const t = new Date(a.provider_consent_created_at).getTime();
  return Number.isFinite(t) ? new Date(t + DUREE_VALIDITE_CONSENTEMENT_MS).toISOString() : null;
}

// ─────────────────────────────────────────────────────────────────────────
// 4. L'avatar D-ID
// ─────────────────────────────────────────────────────────────────────────

export async function creerAvatarVideoDid(
  userId: string, deps: DepsDid = {},
): Promise<ResultatDid<{ etape: EtapeDid; avatarId: string; version: number }>> {
  const env = deps.env ?? process.env;
  const indispo = disponibilite<{ etape: EtapeDid; avatarId: string; version: number }>(env);
  if (indispo) return indispo;
  const lu = await avatarDidDuCompte(userId);
  if (!lu.ok) return lu;
  const a = lu.avatar;
  if (a.provider_avatar_id) return refus('avatar_deja_cree', MESSAGES.avatar_deja_cree, 409);
  if (!cleSourceAvatarDuCompte(a.source_object_key, userId)) return refus('source_absente', MESSAGES.source_absente, 409);
  if (!a.provider_consent_id) return refus('consentement_absent', MESSAGES.consentement_absent, 409);
  if (a.provider_consent_status !== 'done') return refus('consentement_non_accepte', MESSAGES.consentement_non_accepte, 409);
  // Un consentement hérité d'une version précédente n'ouvre la création qu'une fois
  // RATTACHÉ à cette version par la personne (« Réutiliser mon consentement »).
  if (a.provider_consent_version !== a.version) return refus('consentement_non_accepte', 'Confirmez d’abord la réutilisation de votre consentement.', 409);
  if (a.status !== ETAT_SOURCE_PRETE && a.status !== 'failed') return refus('concurrent', MESSAGES.concurrent, 409);

  // Réservation : `processing` posé en CAS sur l'état exact remplacé. Deux clics → un seul passe.
  const { data: reservee, error: erreurReservation } = await supabaseAdmin
    .from('user_avatars')
    .update({ status: 'processing', training_error: null })
    .eq('id', a.id).eq('user_id', userId).eq('version', a.version).is('deleted_at', null)
    .is('provider_avatar_id', null).eq('status', a.status)
    .select('id');
  if (erreurReservation) return refus('base', MESSAGES.base, 500);
  if (!reservee || reservee.length !== 1) return refus('concurrent', MESSAGES.concurrent, 409);

  let cree: { id: string; statut: StatutAvatarDid };
  try {
    cree = await creerAvatarChezDid({
      sourceUrl: urlMediaTemporaire(a.source_object_key, {}, env),
      consentId: a.provider_consent_id,
      nom: a.name ?? 'Mon avatar vidéo',
    }, deps);
  } catch (e) {
    const message = messageFournisseur(e, 'Le fournisseur n’a pas pu créer votre avatar vidéo.');
    await supabaseAdmin.from('user_avatars').update({ status: 'failed', training_error: message })
      .eq('id', a.id).eq('user_id', userId).eq('version', a.version).is('provider_avatar_id', null).eq('status', 'processing');
    return refus('base', message, statutFournisseur(e));
  }
  const { data: posees, error: erreurPose } = await supabaseAdmin
    .from('user_avatars')
    .update({ provider_avatar_id: cree.id, status: statutLocalDid(cree.statut), training_error: null })
    .eq('id', a.id).eq('user_id', userId).eq('version', a.version).is('deleted_at', null)
    .is('provider_avatar_id', null).eq('status', 'processing')
    .select('*');
  if (erreurPose || !posees || posees.length !== 1) {
    // La version a bougé (ou la base n'a pas répondu) : l'avatar créé chez D-ID n'est
    // à personne dans notre base. On le retire — c'est le nôtre, certain — sans
    // jamais toucher à ce que la nouvelle version a pu créer.
    if (!erreurPose) { try { await supprimerAvatarDid(cree.id, deps); } catch { /* orphelin fournisseur, journalisé */ console.warn(`[Avatar][D-ID] avatar ${cree.id} orphelin non retiré`); } }
    return refus(erreurPose ? 'base' : 'concurrent', erreurPose ? MESSAGES.base : MESSAGES.concurrent, erreurPose ? 500 : 409);
  }
  return { ok: true, etape: etapeDid(posees[0] as AvatarDid), avatarId: a.id, version: a.version };
}

/**
 * Rafraîchit l'entraînement D-ID — l'équivalent de la resynchronisation
 * HeyGen de `GET /api/avatar/create`. Écrit UNIQUEMENT sur la version et
 * l'identifiant interrogés. Rend la ligne à jour, ou `null` si rien n'a changé.
 */
export async function rafraichirEntrainementDid(a: AvatarDid, deps: DepsDid = {}): Promise<AvatarDid | null> {
  if (a.provider !== FOURNISSEUR_DID || !a.provider_avatar_id) return null;
  if (etatAvatar(a) !== 'entrainement') return null;
  if (!didVideoAvatarConfigure(deps.env ?? process.env)) return null;
  let distant: { statut: StatutAvatarDid; erreur: string | null };
  try { distant = await lireAvatarDid(a.provider_avatar_id, deps); } catch { return null; }
  const local = statutLocalDid(distant.statut);
  if (local === a.status) return null;
  const patch: Record<string, unknown> = { status: local };
  if (local === 'failed') patch.training_error = distant.erreur ?? 'Le fournisseur n’a pas pu entraîner cet avatar.';
  const { data: touchees } = await supabaseAdmin
    .from('user_avatars')
    .update(patch)
    .eq('id', a.id).eq('user_id', a.user_id).eq('version', a.version).eq('provider_avatar_id', a.provider_avatar_id).is('deleted_at', null)
    .select('*');
  return touchees && touchees.length === 1 ? (touchees[0] as AvatarDid) : null;
}

/** Retire l'avatar chez D-ID — best effort, jamais bloquant, jamais sans identifiant certain. */
export async function retirerAvatarChezDid(providerAvatarId: string | null | undefined, deps: DepsDid = {}): Promise<'retire' | 'non_retire' | 'sans_objet'> {
  if (!providerAvatarId) return 'sans_objet';
  if (!didVideoAvatarConfigure(deps.env ?? process.env)) return 'non_retire';
  try { await supprimerAvatarDid(providerAvatarId, deps); return 'retire'; } catch { return 'non_retire'; }
}

// ─────────────────────────────────────────────────────────────────────────
// 5. LA chaîne D-ID sur MA voix : ElevenLabs (SPOKEN) → audio privé →
//    scène D-ID sur URL signée. Commune à l'aperçu (Mon avatar) et au
//    jumeau (Créer une vidéo) : une seule chaîne, jamais deux copies.
// ─────────────────────────────────────────────────────────────────────────

export type ResultatAnimationDid =
  | { ok: true; sceneId: string }
  | { ok: false; etape: 'voix' | 'stockage' | 'fournisseur'; message: string; statut: number };

/**
 * Anime l'avatar D-ID `providerAvatarId` sur MA voix disant `spoken`, pour
 * la génération `generationId` DÉJÀ RÉSERVÉE par l'appelant.
 *
 * Ce qui est fait ici, dans cet ordre : synthèse ElevenLabs sur la voix
 * personnelle (en mémoire) → dépôt de l'audio en PRIVÉ sous
 * `cleAudioAvatar(userId, generationId)` → `POST /scenes` chez D-ID avec une
 * URL SIGNÉE et expirante vers cet audio. Rend l'identifiant de scène.
 *
 * Ce qui n'est PAS fait ici : la réservation, le débit, la mise à jour de
 * la génération (statut, `provider_video_id`), le remboursement — chaque
 * appelant garde sa politique (aperçu gratuit, jumeau payant). En cas
 * d'échec, l'audio déposé est retiré : rien de biométrique ne reste.
 */
export async function animerAvatarDidSurMaVoix(
  args: { userId: string; generationId: string; providerAvatarId: string; providerVoiceId: string; spoken: string; nom: string },
  deps: DepsDid = {},
): Promise<ResultatAnimationDid> {
  const env = deps.env ?? process.env;
  const synthese = await synthetiserAvecVoix({ providerVoiceId: args.providerVoiceId, texte: args.spoken }, { env, fetch: deps.fetch });
  if (!synthese.ok) {
    return { ok: false, etape: 'voix', message: synthese.motif === 'indisponible' ? 'La voix personnelle n’est pas disponible.' : 'Votre voix n’a pas pu être synthétisée.', statut: 502 };
  }
  const cleAudio = cleAudioAvatar(args.userId, args.generationId);
  const { error: upErr } = await supabaseAdmin.storage.from(BUCKET_AVATAR).upload(cleAudio, synthese.audio, { contentType: synthese.contentType, upsert: false });
  if (upErr) return { ok: false, etape: 'stockage', message: "L'audio de votre voix n'a pas pu être enregistré.", statut: 500 };
  try {
    const scene = await creerSceneAudio({ avatarId: args.providerAvatarId, audioUrl: urlMediaTemporaire(cleAudio, {}, env), nom: args.nom }, deps);
    return { ok: true, sceneId: scene.id };
  } catch (e) {
    await retirerObjetPriveAvatar(args.userId, cleAudio);
    return { ok: false, etape: 'fournisseur', message: messageFournisseur(e, "Le fournisseur n'a pas pu animer votre avatar."), statut: statutFournisseur(e) };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 6. L'aperçu : la chaîne commune, réservée sous l'index « un aperçu vivant
//    par version », à 0 crédit
// ─────────────────────────────────────────────────────────────────────────

export async function lancerApercuDid(
  userId: string, deps: DepsDid = {},
): Promise<ResultatDid<{ generationId: string; display: string; spoken: string }>> {
  const env = deps.env ?? process.env;
  const indispo = disponibilite<{ generationId: string; display: string; spoken: string }>(env);
  if (indispo) return indispo;
  const lu = await avatarDidDuCompte(userId);
  if (!lu.ok) return lu;
  const a = lu.avatar;
  if (etatAvatar(a) !== 'entraine_non_valide' || !a.provider_avatar_id) return refus('avatar_non_pret', MESSAGES.avatar_non_pret, 409);

  // La voix personnelle, relue maintenant — jamais un clone de voix fournisseur.
  const voix = await resoudreVoixDuCompte(userId);
  if (!voix.ok) return refus('voix_indisponible', MESSAGES.voix_indisponible, 409);
  const { display, spoken } = scripts(SCRIPT_APERCU, voix.prononciations);

  // Réservation sous l'index « un aperçu vivant par (avatar, version) ».
  const { data: reservee, error: erreurReservation } = await supabaseAdmin
    .from('avatar_generations')
    .insert({
      user_id: userId, user_avatar_id: a.id, avatar_version: a.version, intention: INTENTION_APERCU, provider: FOURNISSEUR_DID,
      provider_video_id: null, script: spoken, voice_id: `jumeau:${voix.voix.id}`, aspect_ratio: '9:16', status: 'pending', credits_charged: 0,
    })
    .select('id')
    .single();
  if (erreurReservation || !reservee) {
    if (erreurReservation?.code === '23505') return refus('apercu_existant', MESSAGES.apercu_existant, 409);
    return refus('base', "L'aperçu n'a pas pu être réservé. Réessayez.", 500);
  }
  const generationId = (reservee as { id: string }).id;

  // La chaîne commune ; en cas d'échec elle a déjà retiré l'audio déposé.
  const anime = await animerAvatarDidSurMaVoix(
    { userId, generationId, providerAvatarId: a.provider_avatar_id, providerVoiceId: voix.providerVoiceId, spoken, nom: 'Aperçu Studiio' },
    deps,
  );
  if (!anime.ok) {
    const message = anime.etape === 'stockage' ? "L'audio de l'aperçu n'a pas pu être enregistré." : anime.message;
    await supabaseAdmin.from('avatar_generations').update({ status: 'failed', error_message: message }).eq('id', generationId).eq('user_id', userId);
    return refus('base', message, anime.statut);
  }
  const { error: erreurMaj } = await supabaseAdmin
    .from('avatar_generations')
    .update({ provider_video_id: anime.sceneId, status: 'processing' })
    .eq('id', generationId).eq('user_id', userId);
  if (erreurMaj) {
    console.error(`[Avatar][D-ID] scène ${anime.sceneId} lancée mais génération ${generationId} non mise à jour : ${erreurMaj.message}`);
    return refus('base', 'Aperçu lancé mais non enregistré. Contactez le support.', 500);
  }
  return { ok: true, generationId, display, spoken };
}

/** Réexporté pour les routes : le type de ligne commun. */
export type { AvatarLigne };
