/**
 * Versionner un clone — remplacer la source SANS effacer l'histoire.
 *
 * Aujourd'hui `/api/avatar/create` SUPPRIME la ligne `user_avatars` avant d'en
 * insérer une autre (create/route.ts:235). Depuis AVATAR-1A, la FK des
 * générations survit (`on delete set null`), mais la ligne, elle, disparaît
 * toujours : consentement, dates, versions — tout.
 *
 * Ce module dit COMMENT on remplacera : la même ligne avance d'une version,
 * ses champs fournisseur repartent à zéro, sa source est marquée prête. Une
 * fonction PURE calcule la transition ; une fonction d'écriture l'applique
 * en compare-and-set sur `version`, pour que deux envois simultanés ne
 * fabriquent pas deux « version 3 ».
 *
 * ⚠️ AUCUNE ROUTE NE L'APPELLE ENCORE. Le remplacement du `delete` par ce
 * chemin est le travail d'AVATAR-2 ; ici, la règle et sa preuve.
 */

import { supabaseAdmin } from '@/lib/db/supabase';
import { ETAT_SOURCE_PRETE } from '@/lib/avatar/contrat';
import { cleSourceAvatarDuCompte } from '@/lib/avatar/source';

export interface AvatarVersionnable {
  version: number;
  deleted_at: string | null;
}

/** Ce qu'une nouvelle version écrase — et rien d'autre. */
export interface PatchNouvelleVersion {
  version: number;
  status: typeof ETAT_SOURCE_PRETE;
  validated_at: null;
  provider_avatar_id: null;
  provider_asset_id: null;
  training_error: null;
}

/**
 * La transition, pure. `null` = pas de nouvelle version possible : un clone
 * supprimé ne se remplace pas, il se recrée ; une version malformée ne
 * s'incrémente pas (on n'inventerait pas « 2 » au-dessus de « NaN »).
 *
 * Les colonnes remises à zéro sont EXACTEMENT celles que `main` possède
 * (`2026-07-28-user-avatars.sql`, `-avatar-type.sql`, `2026-09-15-…`) : la
 * table n'a ni `updated_at` ni dates d'entraînement, on n'en invente pas.
 * Ce qui est CONSERVÉ délibérément (absent du patch) : `id`, `user_id`,
 * `created_at`, `consent_text`, `consent_version`, `consent_at`,
 * `subject_type`, `avatar_type`, `source_url`, `source_object_key` — la
 * nouvelle clé de source est passée par l'appelant en complément, après que
 * l'objet est réellement en stockage.
 */
export function patchNouvelleVersion(avatar: AvatarVersionnable): PatchNouvelleVersion | null {
  if (avatar.deleted_at !== null) return null;
  if (!Number.isInteger(avatar.version) || avatar.version < 1) return null;
  return {
    version: avatar.version + 1,
    status: ETAT_SOURCE_PRETE,
    validated_at: null,
    provider_avatar_id: null,
    provider_asset_id: null,
    training_error: null,
  };
}

export type MotifNouvelleVersion = 'introuvable' | 'version_concurrente' | 'version_invalide' | 'source_invalide';

export interface AvatarVersionne extends AvatarVersionnable {
  id: string;
  user_id: string;
  status: string;
  source_object_key: string | null;
}

/**
 * Applique la nouvelle version en compare-and-set.
 *
 * La mise à jour ne touche que la ligne `(id, user_id)` VIVANTE dont la
 * version est EXACTEMENT `versionAttendue`. Zéro ligne modifiée = quelqu'un
 * d'autre a avancé (ou la ligne n'est pas à ce compte) : on relit pour dire
 * lequel des deux, sans jamais écrire.
 *
 * `complement` : les colonnes que l'appelant a le droit d'ajouter au patch
 * (typiquement `source_object_key`, `consent_version`). Il ne peut pas
 * contredire le patch : ses clés lui sont réservées.
 *
 * ⚠️ `source_object_key`, s'il est fourni, est vérifié ICI, avant toute
 * requête : il doit être UNE SOURCE DE CE COMPTE au sens de
 * `cleSourceAvatarDuCompte` — ni la clé d'autrui, ni une vidéo générée, ni
 * un autre domaine, ni une traversée. C'est le point d'entrée d'une donnée
 * biométrique en base ; on ne s'en remet pas à l'appelant.
 */
export async function commencerNouvelleVersionAvatar(args: {
  userId: string;
  avatarId: string;
  versionAttendue: number;
  complement?: { source_object_key?: string; consent_version?: string; consent_text?: string; consent_at?: string };
}): Promise<{ ok: true; avatar: AvatarVersionne } | { ok: false; motif: MotifNouvelleVersion }> {
  const patch = patchNouvelleVersion({ version: args.versionAttendue, deleted_at: null });
  if (!patch) return { ok: false, motif: 'version_invalide' };
  const cleSource = args.complement?.source_object_key;
  if (cleSource !== undefined && !cleSourceAvatarDuCompte(cleSource, args.userId)) {
    return { ok: false, motif: 'source_invalide' };
  }

  const { data, error } = await supabaseAdmin
    .from('user_avatars')
    .update({ ...(args.complement ?? {}), ...patch })
    .eq('id', args.avatarId)
    .eq('user_id', args.userId)
    .is('deleted_at', null)
    .eq('version', args.versionAttendue)
    .select('id, user_id, status, version, deleted_at, source_object_key')
    .maybeSingle();

  if (error) throw new Error(`user_avatars: nouvelle version refusée (${error.message})`);
  if (data) return { ok: true, avatar: data as AvatarVersionne };

  // Rien écrit. Pourquoi ? On relit — la ligne vivante de CE compte, ou rien.
  const { data: actuel } = await supabaseAdmin
    .from('user_avatars')
    .select('version')
    .eq('id', args.avatarId)
    .eq('user_id', args.userId)
    .is('deleted_at', null)
    .maybeSingle();
  return { ok: false, motif: actuel ? 'version_concurrente' : 'introuvable' };
}
