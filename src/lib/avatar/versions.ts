/**
 * IDENTITÉS ET VERSIONS D'AVATAR — l'accès aux données, côté serveur.
 *
 *   user_avatars    = l'identité (« Bassi principal »). Ses colonnes de
 *                     version sont le MIROIR de la version active.
 *   avatar_versions = toutes les versions : active, candidate, échec,
 *                     historique.
 *
 * ⚠️ RÈGLE ABSOLUE (incident du 2026-10-09) : une version CANDIDATE n'écrit
 * jamais dans le miroir. Seule `activer_version_avatar` (transaction,
 * compare-and-set) change la version active — sur le clic « Utiliser cette
 * version », jamais automatiquement.
 *
 * Le miroir peut encore être écrit directement dans UN seul cas : une
 * identité qui n'a jamais eu de version active (première création). Il n'y a
 * alors rien à protéger. `ecrireMiroirSansVersionActive` le garantit par la
 * condition `active_version_id is null`, en base, pas par une promesse.
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import { estEtatPret, estEtatEnCours, ETAT_SOURCE_PRETE } from '@/lib/avatar/contrat';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface IdentiteAvatar {
  id: string;
  user_id: string;
  name: string | null;
  is_default: boolean;
  active_version_id: string | null;
  provider: string | null;
  avatar_type: string | null;
  provider_group_id: string | null;
  provider_group_consent: string | null;
  version: number;
  status: string;
  provider_avatar_id: string | null;
  validated_at: string | null;
  created_at: string;
  deleted_at: string | null;
}

export interface VersionAvatar {
  id: string;
  user_avatar_id: string;
  user_id: string;
  version: number;
  provider: string;
  avatar_type: string;
  status: string;
  provider_avatar_id: string | null;
  provider_asset_id: string | null;
  source_object_key: string | null;
  original_source_object_key: string | null;
  training_error: string | null;
  validated_at: string | null;
  created_at: string;
  activated_at: string | null;
  abandoned_at: string | null;
}

/** L'état d'une version CANDIDATE, pour l'écran — jamais calculé côté navigateur. */
export type EtatVersion = 'preparation' | 'entrainement' | 'prete' | 'echec' | 'abandonnee';

export function etatVersion(v: Pick<VersionAvatar, 'status' | 'provider_avatar_id' | 'abandoned_at'>): EtatVersion {
  if (v.abandoned_at) return 'abandonnee';
  if (estEtatPret(v.status) && v.provider_avatar_id) return 'prete';
  if (v.status === ETAT_SOURCE_PRETE || v.status === 'pending') return v.provider_avatar_id ? 'entrainement' : 'preparation';
  if (estEtatEnCours(v.status)) return 'entrainement';
  return 'echec';
}

/** Une version peut-elle devenir active ? (même règle que la fonction SQL) */
export function versionActivable(v: Pick<VersionAvatar, 'status' | 'provider_avatar_id' | 'validated_at' | 'abandoned_at'>): boolean {
  return !v.abandoned_at && !!v.provider_avatar_id && !!v.validated_at && estEtatPret(v.status);
}

/** La candidate « en vol » d'une identité : la plus récente non abandonnée, qui n'est pas l'active. */
export function candidateDe(identite: Pick<IdentiteAvatar, 'active_version_id'>, versions: readonly VersionAvatar[]): VersionAvatar | null {
  const c = versions
    .filter((v) => !v.abandoned_at && v.id !== identite.active_version_id)
    .sort((a, b) => b.version - a.version)[0];
  if (!c) return null;
  // Une version plus ANCIENNE que l'active n'est pas une candidate : c'est de l'historique.
  const active = versions.find((v) => v.id === identite.active_version_id);
  if (active && c.version < active.version) return null;
  return c;
}

const COLONNES_IDENTITE = 'id, user_id, name, is_default, active_version_id, provider, avatar_type, provider_group_id, provider_group_consent, version, status, provider_avatar_id, validated_at, created_at, deleted_at';
const COLONNES_VERSION = 'id, user_avatar_id, user_id, version, provider, avatar_type, status, provider_avatar_id, provider_asset_id, source_object_key, original_source_object_key, training_error, validated_at, created_at, activated_at, abandoned_at';

export async function listerIdentites(userId: string): Promise<{ ok: true; identites: IdentiteAvatar[] } | { ok: false; erreur: string }> {
  if (!UUID.test(userId)) return { ok: true, identites: [] };
  const { data, error } = await supabaseAdmin
    .from('user_avatars')
    .select(COLONNES_IDENTITE)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) return { ok: false, erreur: error.message };
  const identites = ((data ?? []) as IdentiteAvatar[]).filter((i) => i.user_id === userId);
  // L'identité par défaut en tête, puis l'ordre de création.
  identites.sort((a, b) => Number(b.is_default) - Number(a.is_default));
  return { ok: true, identites };
}

export async function versionsDe(userId: string, avatarIds: readonly string[]): Promise<VersionAvatar[]> {
  if (avatarIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('avatar_versions')
    .select(COLONNES_VERSION)
    .eq('user_id', userId)
    .in('user_avatar_id', avatarIds as string[])
    .order('version', { ascending: false });
  if (error) throw new Error(`avatar_versions: lecture impossible (${error.message})`);
  return ((data ?? []) as VersionAvatar[]).filter((v) => v.user_id === userId);
}

export async function versionDuCompte(userId: string, versionId: string): Promise<VersionAvatar | null> {
  if (!UUID.test(userId) || !UUID.test(versionId)) return null;
  const { data } = await supabaseAdmin
    .from('avatar_versions')
    .select(COLONNES_VERSION)
    .eq('id', versionId)
    .eq('user_id', userId)
    .maybeSingle();
  const v = data as VersionAvatar | null;
  return v && v.user_id === userId ? v : null;
}

/**
 * Crée la version CANDIDATE suivante d'une identité. N'écrit RIEN dans le
 * miroir. Refuse s'il existe déjà une candidate en vol (une à la fois).
 * Le numéro est `max + 1` ; une collision concurrente (`unique`) est rejouée.
 */
export async function creerVersionCandidate(args: {
  userId: string;
  avatarId: string;
  provider: string;
  avatarType: string;
  sourceKey: string;
  originalKey: string | null;
  consentement: { consent_text: string; consent_version: string; consent_at: string; subject_type: string };
}): Promise<{ ok: true; version: VersionAvatar } | { ok: false; motif: 'candidate_en_cours' | 'introuvable' | 'base' }> {
  const ident = await supabaseAdmin
    .from('user_avatars')
    .select('id, user_id, active_version_id, deleted_at')
    .eq('id', args.avatarId)
    .eq('user_id', args.userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!ident.data) return { ok: false, motif: 'introuvable' };
  const versions = await versionsDe(args.userId, [args.avatarId]);
  const enVol = candidateDe(ident.data as Pick<IdentiteAvatar, 'active_version_id'>, versions);
  if (enVol && (etatVersion(enVol) === 'preparation' || etatVersion(enVol) === 'entrainement')) {
    return { ok: false, motif: 'candidate_en_cours' };
  }
  for (let essai = 0; essai < 3; essai += 1) {
    const max = Math.max(0, ...(await versionsDe(args.userId, [args.avatarId])).map((v) => v.version));
    const { data, error } = await supabaseAdmin
      .from('avatar_versions')
      .insert({
        user_avatar_id: args.avatarId,
        user_id: args.userId,
        version: max + 1,
        provider: args.provider,
        avatar_type: args.avatarType,
        status: ETAT_SOURCE_PRETE,
        source_object_key: args.sourceKey,
        original_source_object_key: args.originalKey ?? args.sourceKey,
        ...args.consentement,
      })
      .select(COLONNES_VERSION)
      .single();
    if (data && !error) return { ok: true, version: data as VersionAvatar };
    if (error?.code !== '23505') return { ok: false, motif: 'base' };
  }
  return { ok: false, motif: 'base' };
}

/**
 * Écrit le résultat du fournisseur sur UNE version candidate, jamais sur
 * l'active ni sur une abandonnée. `true` = une ligne écrite.
 */
export async function ecrireVersion(userId: string, versionId: string, patch: Partial<Pick<VersionAvatar,
  'status' | 'provider_avatar_id' | 'provider_asset_id' | 'training_error' | 'validated_at'>>): Promise<boolean> {
  // L'active ne s'écrit jamais ici : on exclut toute version référencée comme active.
  const { data: actives } = await supabaseAdmin
    .from('user_avatars')
    .select('active_version_id')
    .eq('user_id', userId)
    .eq('active_version_id', versionId)
    .limit(1);
  if (actives && actives.length > 0) return false;
  const { data, error } = await supabaseAdmin
    .from('avatar_versions')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', versionId)
    .eq('user_id', userId)
    .is('abandoned_at', null)
    .select('id');
  return !error && (data ?? []).length === 1;
}

/** « Garder ma version actuelle » / « Abandonner » : la candidate reste en historique. */
export async function abandonnerVersion(userId: string, avatarId: string, versionId: string): Promise<boolean> {
  const { data: ident } = await supabaseAdmin
    .from('user_avatars')
    .select('active_version_id')
    .eq('id', avatarId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!ident || (ident as { active_version_id: string | null }).active_version_id === versionId) return false;
  const { data, error } = await supabaseAdmin
    .from('avatar_versions')
    .update({ abandoned_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', versionId)
    .eq('user_avatar_id', avatarId)
    .eq('user_id', userId)
    .is('abandoned_at', null)
    .select('id');
  return !error && (data ?? []).length === 1;
}

/**
 * LA bascule : la version devient active, le miroir est réécrit — dans une
 * transaction, en compare-and-set sur l'active attendue. Revenir à l'ancienne
 * version = rappeler avec elle.
 */
export async function activerVersion(args: {
  userId: string; avatarId: string; versionId: string; activeAttendue: string | null;
}): Promise<{ ok: true } | { ok: false; motif: string }> {
  const { data, error } = await supabaseAdmin.rpc('activer_version_avatar', {
    p_user_id: args.userId,
    p_avatar_id: args.avatarId,
    p_version_id: args.versionId,
    p_active_attendue: args.activeAttendue,
  });
  if (error) return { ok: false, motif: 'base' };
  const r = (Array.isArray(data) ? data[0] : data) as { ok?: boolean; motif?: string | null } | null;
  return r?.ok ? { ok: true } : { ok: false, motif: r?.motif ?? 'base' };
}

export async function definirParDefaut(userId: string, avatarId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc('definir_avatar_par_defaut', { p_user_id: userId, p_avatar_id: avatarId });
  if (error) return false;
  const r = (Array.isArray(data) ? data[0] : data) as { ok?: boolean } | null;
  return r?.ok === true;
}

/**
 * Recopie le miroir d'une identité SANS version active dans sa ligne de
 * version (même numéro) : la première création garde ainsi une trace
 * complète dans `avatar_versions`. Sans effet sur une identité active.
 */
export async function synchroniserPremiereVersion(userId: string, avatarId: string): Promise<VersionAvatar | null> {
  const { data: a } = await supabaseAdmin
    .from('user_avatars')
    .select('id, user_id, active_version_id, version, provider, avatar_type, status, provider_avatar_id, provider_asset_id, source_object_key, training_error, validated_at, consent_text, consent_version, consent_at, subject_type, deleted_at')
    .eq('id', avatarId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();
  const l = a as (Record<string, unknown> & { active_version_id: string | null; version: number }) | null;
  if (!l || l.active_version_id) return null;
  const champs = {
    provider: l.provider ?? 'heygen', avatar_type: l.avatar_type ?? 'photo', status: l.status,
    provider_avatar_id: l.provider_avatar_id ?? null, provider_asset_id: l.provider_asset_id ?? null,
    source_object_key: l.source_object_key ?? null, training_error: l.training_error ?? null,
    validated_at: l.validated_at ?? null, consent_text: l.consent_text ?? null, consent_version: l.consent_version ?? null,
    consent_at: l.consent_at ?? null, subject_type: l.subject_type ?? null, updated_at: new Date().toISOString(),
  };
  const existant = (await versionsDe(userId, [avatarId])).find((v) => v.version === l.version);
  if (existant) {
    const { data } = await supabaseAdmin.from('avatar_versions').update(champs).eq('id', existant.id).eq('user_id', userId).select(COLONNES_VERSION).single();
    return (data as VersionAvatar | null) ?? null;
  }
  const { data } = await supabaseAdmin
    .from('avatar_versions')
    .insert({ user_avatar_id: avatarId, user_id: userId, version: l.version, original_source_object_key: l.source_object_key ?? null, ...champs })
    .select(COLONNES_VERSION)
    .single();
  return (data as VersionAvatar | null) ?? null;
}

/** Combien d'identités VIDÉO (jumeau) le compte occupe chez le fournisseur. */
export function identitesVideoAvecGroupe(identites: readonly IdentiteAvatar[]): number {
  return identites.filter((i) => i.avatar_type === 'video' && !!i.provider_group_id).length;
}

/**
 * Emplacements de jumeaux vidéo du compte fournisseur. Constaté le
 * 2026-10-09 : « limit of 1 verified avatar group slots ». Configurable
 * (`AVATAR_EMPLACEMENTS_VIDEO`) le jour où l'abonnement change — jamais
 * deviné à la hausse.
 */
export function emplacementsVideo(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number.parseInt(env.AVATAR_EMPLACEMENTS_VIDEO ?? '', 10);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}
