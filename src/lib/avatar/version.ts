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
  /** Le consentement FOURNISSEUR (D-ID) est propre à une source : il repart à zéro. */
  provider_consent_id: null;
  provider_consent_text: null;
  provider_consent_status: null;
  consent_object_key: null;
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
    provider_consent_id: null,
    provider_consent_text: null,
    provider_consent_status: null,
    consent_object_key: null,
  };
}

/**
 * Ce qu'une nouvelle version peut RÉÉCRIRE en plus du patch : la source, le
 * consentement (renouvelé à chaque envoi), la nature et le nom, et
 * `source_url` — à `null` seulement : une source AVATAR-2A n'a plus d'URL,
 * `source_object_key` est son identité.
 */
export interface ComplementNouvelleVersion {
  /** Le fournisseur de CETTE version : une nouvelle source peut changer de fournisseur. */
  provider?: 'heygen' | 'did';
  source_object_key?: string;
  consent_version?: string;
  consent_text?: string;
  consent_at?: string;
  subject_type?: 'self' | 'third_party';
  avatar_type?: 'photo' | 'video';
  name?: string;
  source_url?: null;
}

const CLES_COMPLEMENT = new Set<keyof ComplementNouvelleVersion>([
  'provider', 'source_object_key', 'consent_version', 'consent_text', 'consent_at',
  'subject_type', 'avatar_type', 'name', 'source_url',
]);
const FOURNISSEURS = new Set(['heygen', 'did']);

/**
 * Seules les clés admises passent — `id`, `user_id`, `deleted_at`, ou
 * n'importe quelle colonne glissée par un appelant, sont écartées ici, en
 * plus des clés que le patch écrase de toute façon. `source_url` n'est admis
 * qu'à `null`.
 */
function complementAdmissible(complement: ComplementNouvelleVersion | undefined): Partial<ComplementNouvelleVersion> {
  const admis: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(complement ?? {})) {
    if (!CLES_COMPLEMENT.has(cle as keyof ComplementNouvelleVersion)) continue;
    if (cle === 'source_url' && valeur !== null) continue;
    if (cle === 'provider' && !FOURNISSEURS.has(String(valeur))) continue;
    admis[cle] = valeur;
  }
  return admis as Partial<ComplementNouvelleVersion>;
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
  complement?: ComplementNouvelleVersion;
}): Promise<{ ok: true; avatar: AvatarVersionne } | { ok: false; motif: MotifNouvelleVersion }> {
  const patch = patchNouvelleVersion({ version: args.versionAttendue, deleted_at: null });
  if (!patch) return { ok: false, motif: 'version_invalide' };
  const cleSource = args.complement?.source_object_key;
  if (cleSource !== undefined && !cleSourceAvatarDuCompte(cleSource, args.userId)) {
    return { ok: false, motif: 'source_invalide' };
  }

  const { data, error } = await supabaseAdmin
    .from('user_avatars')
    .update({ ...complementAdmissible(args.complement), ...patch })
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
