/**
 * Supprimer son avatar — SANS rien effacer de l'histoire.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE « SUPPRIMÉ » VEUT DIRE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La ligne `user_avatars` RESTE : `deleted_at` est posé. Elle garde son id,
 * sa version, ses identifiants fournisseur, son consentement daté — la
 * preuve de ce que la personne a accepté, et le fil des générations
 * (`avatar_generations.user_avatar_id` pointe toujours dessus : aucune
 * vidéo produite ne disparaît, aucun `DELETE`). Ce qui part, c'est la
 * DONNÉE BIOMÉTRIQUE : la source d'enrôlement — le visage — retirée du
 * stockage, et ses pointeurs (`source_object_key`, `source_url`) effacés de
 * la ligne SEULEMENT une fois l'objet réellement retiré. Si le stockage
 * refuse, la ligne supprimée garde son pointeur : un nettoyage ultérieur
 * peut le retrouver ; rien ne le sert (les lectures exigent `deleted_at`
 * NULL).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * L'ORDRE, ET POURQUOI
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   1. lire l'avatar VIVANT (une erreur de lecture n'est PAS « aucun
 *      avatar ») ;
 *   2. poser `deleted_at` par compare-and-set sur `(id, user_id, version,
 *      deleted_at is null)` — une version remplacée entre-temps n'est jamais
 *      supprimée par une requête qui visait la précédente ;
 *   3. zéro ligne touchée → relire : déjà supprimé (double clic) = succès
 *      idempotent (`dejaSupprime`), le retrait de l'objet — idempotent et
 *      protégé — est simplement retenté ; version plus récente = 409 ;
 *   4. erreur de la base à l'écriture → relire : posé malgré tout → on
 *      continue ; toujours vivante → 500, et rien n'est retiré ;
 *   5. l'objet, APRÈS la ligne : `retirerSourceAvatar` refuse la clé d'un
 *      autre compte, une vidéo générée, et la clé que la ligne vivante
 *      (nouvelle, s'il y en a une) désigne ;
 *   6. l'objet parti → effacer les pointeurs de la ligne supprimée.
 *
 * Le fournisseur : le client `heygen.ts` n'a AUCUNE opération de
 * suppression. On ne l'appelle donc pas, et on le DIT — `fournisseur:
 * 'non_disponible'` — plutôt que de laisser croire qu'un modèle distant a
 * disparu. `provider_avatar_id` reste sur la ligne, à dessein.
 */

import { supabaseAdmin } from '@/lib/db/supabase';
import { cleSourceDepuisUrlLegacy, retirerSourceAvatar, retirerObjetPriveAvatar } from '@/lib/avatar/source';
import { retirerAvatarChezDid } from '@/lib/avatar/did';

interface LigneAvatar {
  id: string;
  user_id: string;
  version: number;
  deleted_at: string | null;
  source_object_key: string | null;
  source_url: string | null;
  provider_avatar_id: string | null;
  provider?: string | null;
  consent_object_key?: string | null;
}

/**
 * `non_disponible` : HeyGen (heygen.ts ne sait pas supprimer) ; `retire` /
 * `non_retire` : D-ID, dont l'avatar est retiré chez le fournisseur en best
 * effort APRÈS la suppression douce — sur l'identifiant de la ligne
 * supprimée, jamais sur celui d'une ligne vivante.
 */
export type NettoyageFournisseur = 'non_disponible' | 'retire' | 'non_retire' | 'sans_objet';

export type ResultatSuppression =
  | { ok: true; avatarId: string; version: number; dejaSupprime: boolean; sourceRetiree: boolean; fournisseur: NettoyageFournisseur }
  | { ok: false; motif: 'aucun_avatar' }
  | { ok: false; motif: 'version_concurrente' }
  | { ok: false; motif: 'lecture_impossible' | 'ecriture_impossible'; erreur: string };

async function lireVivant(userId: string): Promise<{ ok: true; avatar: LigneAvatar | null } | { ok: false; erreur: string }> {
  const { data, error } = await supabaseAdmin
    .from('user_avatars')
    .select('id, user_id, version, deleted_at, source_object_key, source_url, provider_avatar_id, provider, consent_object_key')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) return { ok: false, erreur: error.message };
  return { ok: true, avatar: (data?.[0] as LigneAvatar | undefined) ?? null };
}

async function lireParId(userId: string, avatarId: string): Promise<{ ok: true; avatar: LigneAvatar | null } | { ok: false; erreur: string }> {
  const { data, error } = await supabaseAdmin
    .from('user_avatars')
    .select('id, user_id, version, deleted_at, source_object_key, source_url, provider_avatar_id')
    .eq('id', avatarId)
    .eq('user_id', userId)
    .limit(1);
  if (error) return { ok: false, erreur: error.message };
  return { ok: true, avatar: (data?.[0] as LigneAvatar | undefined) ?? null };
}

/** La clé de la source d'une ligne : la clé canonique, ou celle dérivée d'un `source_url` historique. */
function cleSourceDe(ligne: LigneAvatar, userId: string): string | null {
  return ligne.source_object_key ?? cleSourceDepuisUrlLegacy(ligne.source_url, userId);
}

/**
 * Retire l'objet de la source d'une ligne SUPPRIMÉE, puis efface ses
 * pointeurs. Rend `true` si l'objet est parti (ou n'existait plus).
 * `cleProtegee` : la clé que la ligne vivante du compte désigne maintenant —
 * jamais retirée, même si les deux clés se confondaient.
 */
async function retirerSourceDeLaLigneSupprimee(userId: string, ligne: LigneAvatar, cleProtegee: string | null): Promise<boolean> {
  const cle = cleSourceDe(ligne, userId);
  if (!cle) return true; // rien à retirer : la ligne ne désignait aucune source
  const retiree = await retirerSourceAvatar(userId, cle, cleProtegee);
  if (!retiree) {
    console.warn(`[Avatar][suppression] Nettoyage differe : la source de ${ligne.id} n'a pas pu etre retiree, pointeur conserve.`);
    return false;
  }
  // L'objet est parti : la ligne supprimée ne doit plus le désigner — CETTE
  // version-là seulement : une requête périmée ne blanchit jamais les
  // pointeurs d'une version qu'elle n'a pas supprimée.
  const { error } = await supabaseAdmin
    .from('user_avatars')
    .update({ source_object_key: null, source_url: null })
    .eq('id', ligne.id)
    .eq('user_id', userId)
    .eq('version', ligne.version)
    .not('deleted_at', 'is', null);
  if (error) console.warn(`[Avatar][suppression] Pointeurs non effaces pour ${ligne.id} : ${error.message}`);
  return true;
}

/**
 * Supprime l'avatar VIVANT du compte. Idempotent : un second appel (double
 * clic) rend `dejaSupprime: true` sans nouvelle écriture de `deleted_at`.
 */
export async function supprimerAvatarActif(userId: string): Promise<ResultatSuppression> {
  const lecture = await lireVivant(userId);
  if (!lecture.ok) return { ok: false, motif: 'lecture_impossible', erreur: lecture.erreur };
  const vivant = lecture.avatar;
  if (!vivant) return { ok: false, motif: 'aucun_avatar' };

  const { data: touchees, error: erreurMaj } = await supabaseAdmin
    .from('user_avatars')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', vivant.id)
    .eq('user_id', userId)
    .eq('version', vivant.version)
    .is('deleted_at', null)
    .select('id');

  // `dejaSupprime` : la ligne était déjà supprimée par une AUTRE requête
  // (double clic) quand la nôtre est passée — issue identique pour la
  // personne, mais on ne prétend pas l'avoir fait.
  let dejaSupprime = false;
  if (erreurMaj || !touchees || touchees.length !== 1) {
    // Zéro ligne, ou erreur : on ne suppose rien, on relit LA ligne.
    const relu = await lireParId(userId, vivant.id);
    if (!relu.ok) {
      return { ok: false, motif: erreurMaj ? 'ecriture_impossible' : 'lecture_impossible', erreur: relu.erreur };
    }
    const ligne = relu.avatar;
    if (ligne && ligne.deleted_at !== null && ligne.version === vivant.version) {
      // Posée : par nous (réponse perdue après écriture) ou par un autre
      // clic. Dans les deux cas la ligne est supprimée ; on continue vers
      // l'objet — retrait idempotent et protégé, qui rattrape aussi un
      // nettoyage différé de l'autre requête.
      dejaSupprime = !erreurMaj;
    } else if (ligne && ligne.deleted_at === null) {
      if (ligne.version !== vivant.version) return { ok: false, motif: 'version_concurrente' };
      // Même version, toujours vivante : notre écriture n'a pas été appliquée.
      return { ok: false, motif: 'ecriture_impossible', erreur: erreurMaj?.message ?? 'aucune ligne touchee' };
    } else {
      // Introuvable par id (jamais attendu : aucun DELETE physique) — on
      // n'a rien supprimé, on ne retire rien.
      return { ok: false, motif: 'ecriture_impossible', erreur: erreurMaj?.message ?? 'ligne introuvable apres ecriture' };
    }
  }

  // La ligne est supprimée : l'objet, maintenant — en protégeant la clé
  // qu'une éventuelle NOUVELLE ligne vivante désigne déjà. Si on ne peut pas
  // la relire, on ne sait pas quoi protéger : on ne retire rien.
  const vivantMaintenant = await lireVivant(userId);
  if (!vivantMaintenant.ok) {
    console.warn(`[Avatar][suppression] Nettoyage differe pour ${vivant.id} : ligne vivante illisible (${vivantMaintenant.erreur}).`);
    return { ok: true, avatarId: vivant.id, version: vivant.version, dejaSupprime, sourceRetiree: false, fournisseur: 'non_disponible' };
  }
  // La clé protégée est résolue comme toute source : canonique, sinon
  // dérivée d'un `source_url` historique validé — une réinscription legacy
  // est protégée au même titre.
  const cleProtegee = vivantMaintenant.avatar ? cleSourceDe(vivantMaintenant.avatar, userId) : null;
  const sourceRetiree = await retirerSourceDeLaLigneSupprimee(userId, vivant, cleProtegee);

  if (vivant.provider === 'did') {
    // La vidéo de consentement (notre objet) et l'avatar chez D-ID — sur les
    // identifiants de la ligne supprimée, en protégeant ce qu'une nouvelle
    // ligne vivante désigne déjà.
    const consentProtegee = vivantMaintenant.avatar?.consent_object_key ?? null;
    if (vivant.consent_object_key) await retirerObjetPriveAvatar(userId, vivant.consent_object_key, consentProtegee);
    const fournisseur = vivantMaintenant.avatar?.provider_avatar_id === vivant.provider_avatar_id
      ? 'sans_objet'
      : await retirerAvatarChezDid(vivant.provider_avatar_id);
    if (fournisseur === 'non_retire') console.warn(`[Avatar][suppression] avatar D-ID de ${vivant.id} non retiré chez le fournisseur.`);
    return { ok: true, avatarId: vivant.id, version: vivant.version, dejaSupprime, sourceRetiree, fournisseur };
  }
  if (vivant.provider_avatar_id) {
    console.warn(`[Avatar][suppression] Nettoyage fournisseur NON DISPONIBLE pour ${vivant.id} (heygen.ts ne sait pas supprimer) : le clone peut subsister chez le fournisseur.`);
  }
  return { ok: true, avatarId: vivant.id, version: vivant.version, dejaSupprime, sourceRetiree, fournisseur: 'non_disponible' };
}
