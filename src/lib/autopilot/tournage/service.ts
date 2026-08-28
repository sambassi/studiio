import { supabaseAdmin } from '@/lib/db/supabase';
import { verifierObjet } from '@/lib/storage/verifier-objet';
import {
  sessionDepuisLigne, rushDepuisLigne,
  type ShootSession, type Rush, type RushIngestionStatus,
} from './contrat';

/**
 * L'accès aux sessions de tournage et à leurs rushes.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * `user_id` NE VIENT JAMAIS D'AILLEURS QUE DE LA SESSION
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Chaque fonction reçoit `userId` de son appelant, et cet appelant le tient
 * de `auth()`. Toutes les lectures portent `.eq('user_id', userId)` : une
 * session ou un rush d'autrui est INTROUVABLE, pas « interdit ». La nuance
 * compte — un 403 confirmerait l'existence de la ressource.
 *
 * La base pose la même garantie de son côté, par une clé étrangère composite
 * `(shoot_session_id, user_id)` : même un appelant qui oublierait le filtre
 * ne pourrait pas rattacher un rush à la session d'un autre.
 */

/** La migration n'est pas appliquée sur ce serveur. */
export type MotifTournage =
  | 'socle_absent' | 'session_introuvable' | 'objet_absent' | 'rush_introuvable';

/** Codes PostgREST qui signifient « la table n'existe pas ». */
function socleAbsent(erreur: { code?: string; message?: string } | null): boolean {
  if (!erreur) return false;
  const code = erreur.code ?? '';
  const message = (erreur.message ?? '').toLowerCase();
  // 42P01 = undefined_table ; PGRST205 = table hors du cache de schéma.
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST202'
    || message.includes('does not exist') || message.includes('schema cache');
}

export interface ResultatSession {
  session: ShootSession | null;
  motif: MotifTournage | null;
}

export async function creerSession(
  userId: string,
  titre: string,
  contexte: string | null,
  metadata: Record<string, unknown>,
): Promise<ResultatSession> {
  const { data, error } = await supabaseAdmin
    .from('shoot_sessions')
    .insert({ user_id: userId, titre, contexte, metadata })
    .select('id, user_id, titre, statut, contexte, metadata, created_at, updated_at')
    .maybeSingle();

  if (error) {
    if (socleAbsent(error)) return { session: null, motif: 'socle_absent' };
    throw new Error(error.message || 'creation de session impossible');
  }
  if (!data) throw new Error('creation sans reponse');
  return { session: sessionDepuisLigne(data as Record<string, unknown>), motif: null };
}

export async function listerSessions(
  userId: string,
): Promise<{ sessions: ShootSession[]; motif: MotifTournage | null }> {
  const { data, error } = await supabaseAdmin
    .from('shoot_sessions')
    .select('id, user_id, titre, statut, contexte, metadata, created_at, updated_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    if (socleAbsent(error)) return { sessions: [], motif: 'socle_absent' };
    throw new Error(error.message || 'lecture des sessions impossible');
  }
  const lignes = Array.isArray(data) ? data : [];
  return { sessions: lignes.map((l) => sessionDepuisLigne(l as Record<string, unknown>)), motif: null };
}

export async function lireSession(userId: string, id: string): Promise<ResultatSession> {
  const { data, error } = await supabaseAdmin
    .from('shoot_sessions')
    .select('id, user_id, titre, statut, contexte, metadata, created_at, updated_at')
    .eq('id', id)
    // Le filtre de propriété est ICI, dans la requête : une session d'autrui
    // ne revient pas, donc l'appelant n'a rien à décider.
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    if (socleAbsent(error)) return { session: null, motif: 'socle_absent' };
    throw new Error(error.message || 'lecture de session impossible');
  }
  if (!data) return { session: null, motif: 'session_introuvable' };
  return { session: sessionDepuisLigne(data as Record<string, unknown>), motif: null };
}

export async function listerRushes(
  userId: string, sessionId: string,
): Promise<{ rushes: Rush[]; motif: MotifTournage | null }> {
  // La session est relue d'abord : sans ça, demander les rushes d'une session
  // d'autrui rendrait une liste vide — indiscernable d'une session vide.
  const { session, motif } = await lireSession(userId, sessionId);
  if (motif) return { rushes: [], motif };
  if (!session) return { rushes: [], motif: 'session_introuvable' };

  const { data, error } = await supabaseAdmin
    .from('rushes')
    .select('id, shoot_session_id, user_id, bucket, cle_objet, nom_origine, content_type, taille_octets, duree_secondes, rang, etat, metadata, created_at, updated_at')
    .eq('shoot_session_id', sessionId)
    .eq('user_id', userId)
    .order('rang', { ascending: true });

  if (error) {
    if (socleAbsent(error)) return { rushes: [], motif: 'socle_absent' };
    throw new Error(error.message || 'lecture des rushes impossible');
  }
  const lignes = Array.isArray(data) ? data : [];
  return { rushes: lignes.map((l) => rushDepuisLigne(l as Record<string, unknown>)), motif: null };
}

/**
 * Un rush, par son identifiant — s'il appartient bien à l'appelant.
 *
 * Vit ICI et non dans le service d'analyse : c'est le vocabulaire du
 * tournage, et le lire depuis deux endroits est exactement l'erreur que
 * `contrat.ts` décrit en tête de fichier — deux définitions d'un même concept
 * ne divergent pas tout de suite, elles divergent au troisième changement.
 *
 * Le filtre de propriété est dans la requête : un rush d'autrui ne revient
 * pas, donc l'appelant n'a rien à décider.
 */
export async function lireRush(
  userId: string, id: string,
): Promise<{ rush: Rush | null; motif: MotifTournage | null }> {
  const { data, error } = await supabaseAdmin
    .from('rushes')
    .select('id, shoot_session_id, user_id, bucket, cle_objet, nom_origine, content_type, taille_octets, duree_secondes, rang, etat, metadata, created_at, updated_at')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    if (socleAbsent(error)) return { rush: null, motif: 'socle_absent' };
    throw new Error(error.message || 'lecture de rush impossible');
  }
  if (!data) return { rush: null, motif: 'rush_introuvable' };
  return { rush: rushDepuisLigne(data as Record<string, unknown>), motif: null };
}

export interface IndexationRush {
  bucket: string;
  cleObjet: string;
  nomOrigine: string | null;
  metadata: Record<string, unknown>;
}

export interface ResultatIndexation {
  rush: Rush | null;
  motif: MotifTournage | null;
  /** Renseigné quand l'objet a été refusé par la vérification de stockage. */
  refusStockage?: string;
}

/**
 * Indexe un rush — APRÈS avoir vérifié que le fichier est réellement là.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI VÉRIFIER, ET AVEC QUOI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le navigateur téléverse directement vers le stockage : l'application n'est
 * pas dans le chemin de la requête. Elle ne peut donc rien déduire de ce que
 * le client lui raconte ensuite — un booléen « c'est envoyé », une URL, un
 * nom de fichier : `curl` produit les trois.
 *
 * `verifierObjet` est la fonction que le socle de rendu utilise déjà pour la
 * même question. On la RÉUTILISE plutôt que d'en écrire une seconde : elle
 * interroge le stockage sur `(bucket, clé)`, exige que la clé soit dans le
 * périmètre de l'utilisateur, refuse un type non vidéo et une taille
 * dérisoire. Un rush est une vidéo dans MinIO ; ce sont exactement les bonnes
 * questions.
 *
 * L'état n'est donc `verifie` que lorsque le serveur a VU le fichier. Aucun
 * chemin ne pose `indexe` aujourd'hui — la valeur existe pour qu'un futur
 * import en masse n'ait pas à se déclarer vérifié pour passer.
 */
export async function indexerRush(
  userId: string, sessionId: string, entree: IndexationRush,
): Promise<ResultatIndexation> {
  const { session, motif } = await lireSession(userId, sessionId);
  if (motif) return { rush: null, motif };
  if (!session) return { rush: null, motif: 'session_introuvable' };

  const preuve = await verifierObjet(entree.bucket, entree.cleObjet, userId);
  if (!preuve.ok) {
    return { rush: null, motif: 'objet_absent', refusStockage: preuve.motif };
  }

  // Le rang est décidé par le SERVEUR, à la suite de ce qui existe. Un rang
  // reçu du client permettrait d'écraser l'ordre d'une session — et l'index
  // unique `(shoot_session_id, rang)` refuserait, en laissant l'appelant
  // deviner pourquoi.
  const { data: dernier } = await supabaseAdmin
    .from('rushes')
    .select('rang')
    .eq('shoot_session_id', sessionId)
    .order('rang', { ascending: false })
    .limit(1)
    .maybeSingle();
  const rang = dernier && typeof (dernier as { rang?: unknown }).rang === 'number'
    ? (dernier as { rang: number }).rang + 1 : 0;

  const etat: RushIngestionStatus = 'verifie';
  const { data, error } = await supabaseAdmin
    .from('rushes')
    .insert({
      shoot_session_id: sessionId,
      user_id: userId,
      bucket: entree.bucket,
      cle_objet: entree.cleObjet,
      nom_origine: entree.nomOrigine,
      // Ce que le STOCKAGE a répondu, pas ce que le navigateur a annoncé.
      content_type: preuve.contentType || null,
      taille_octets: preuve.taille,
      // La durée n'est pas connue à l'ingestion. `null`, et pas zéro.
      duree_secondes: null,
      rang,
      etat,
      metadata: entree.metadata,
    })
    .select('id, shoot_session_id, user_id, bucket, cle_objet, nom_origine, content_type, taille_octets, duree_secondes, rang, etat, metadata, created_at, updated_at')
    .maybeSingle();

  if (error) {
    if (socleAbsent(error)) return { rush: null, motif: 'socle_absent' };
    throw new Error(error.message || 'indexation impossible');
  }
  if (!data) throw new Error('indexation sans reponse');
  return { rush: rushDepuisLigne(data as Record<string, unknown>), motif: null };
}

/**
 * Consigne sur le rush la durée que l'analyse a MESURÉE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI ICI, ET NON DANS LE MODULE D'ANALYSE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `rushes` a un seul propriétaire dans le code, et c'est ce fichier. Écrire
 * la durée depuis le module d'analyse ferait deux modules qui écrivent la
 * même table — exactement la duplication que `CARD_ICON_MAP` a déjà coûtée à
 * ce projet : deux écritures d'une même colonne ne divergent pas tout de
 * suite, elles divergent au troisième changement.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA DURÉE FAISANT FOI EST CELLE DE L'ANALYSE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `rush_analyses.duree_secondes` est le résultat daté et versionné d'une
 * mesure ; `rushes.duree_secondes` en est une COPIE de confort, pour que
 * lister des rushes ne demande pas une jointure. La copie peut donc échouer
 * sans invalider la mesure — l'appelant traite ce refus comme tel.
 *
 * La valeur ne vient jamais d'un navigateur : elle vient du moteur, par la
 * route, qui la tient de ffmpeg. Elle est tout de même bornée ici, parce
 * qu'une colonne n'a pas à faire confiance à son appelant.
 */
export async function majDureeRush(
  userId: string, rushId: string, dureeSecondes: number,
): Promise<{ rush: Rush | null; motif: MotifTournage | null }> {
  // `0` est refusé au même titre qu'un négatif : `null` veut dire « inconnue »
  // et un zéro se lirait comme « vide », ce que le contrat interdit déjà.
  if (typeof dureeSecondes !== 'number' || !Number.isFinite(dureeSecondes) || dureeSecondes <= 0) {
    throw new Error('duree_secondes doit etre un nombre strictement positif');
  }

  const { data, error } = await supabaseAdmin
    .from('rushes')
    .update({ duree_secondes: dureeSecondes, updated_at: new Date().toISOString() })
    .eq('id', rushId)
    // Le filtre de propriété est DANS la requête : le rush d'autrui n'est pas
    // « refusé », il n'est pas atteint.
    .eq('user_id', userId)
    .select('id, shoot_session_id, user_id, bucket, cle_objet, nom_origine, content_type, taille_octets, duree_secondes, rang, etat, metadata, created_at, updated_at')
    .maybeSingle();

  if (error) {
    if (socleAbsent(error)) return { rush: null, motif: 'socle_absent' };
    throw new Error(error.message || 'ecriture de la duree impossible');
  }
  if (!data) return { rush: null, motif: 'rush_introuvable' };
  return { rush: rushDepuisLigne(data as Record<string, unknown>), motif: null };
}
