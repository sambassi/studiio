/**
 * LA QUALITÉ CHOISIE PAR L'UTILISATEUR, PAR AVATAR — source de vérité du
 * moteur HeyGen (Standard → Avatar III, Qualité → Avatar IV, Premium →
 * Avatar V) pour TOUTE génération de cet avatar : Mon avatar, aperçu, Créer,
 * Autopilote.
 *
 * Rangée dans `user_settings.creator_preferences.qualitesAvatar[avatarId]`
 * (JSON existant, aucune migration). Écrite seulement par un CHOIX explicite
 * dans Mon avatar. Sans choix enregistré, chaque parcours garde son défaut
 * d'avant (Créer / Autopilote : `moteurAvatar(env)`, Avatar III) — un défaut
 * plus cher n'est jamais appliqué en silence.
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import { MOTEUR_PAR_QUALITE, QUALITES, moteurAvatar, type MoteurAvatar, type QualiteRendu } from '@/lib/avatar/moteurs';

const CLE = 'qualitesAvatar';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function estQualiteRendu(v: unknown): v is QualiteRendu {
  return typeof v === 'string' && (QUALITES as readonly string[]).includes(v);
}

async function lirePreferences(userId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabaseAdmin.from('user_settings').select('creator_preferences').eq('user_id', userId).limit(1);
  if (error) return null;
  const brut = (data?.[0] as { creator_preferences?: unknown } | undefined)?.creator_preferences;
  return brut && typeof brut === 'object' ? (brut as Record<string, unknown>) : {};
}

/** La qualité enregistrée pour CET avatar ; `null` = aucun choix (ou lecture impossible). */
export async function lireQualiteAvatar(userId: string, avatarId: string | null | undefined): Promise<QualiteRendu | null> {
  if (!avatarId || !UUID.test(userId)) return null;
  const prefs = await lirePreferences(userId).catch(() => null);
  const table = prefs?.[CLE];
  const v = table && typeof table === 'object' ? (table as Record<string, unknown>)[avatarId] : null;
  return estQualiteRendu(v) ? v : null;
}

/** Enregistre le choix ; les AUTRES préférences du compte sont conservées. */
export async function ecrireQualiteAvatar(userId: string, avatarId: string, qualite: QualiteRendu): Promise<{ ok: true } | { ok: false; erreur: string }> {
  if (!UUID.test(userId) || !UUID.test(avatarId)) return { ok: false, erreur: 'identifiant invalide' };
  const prefs = await lirePreferences(userId);
  if (prefs === null) return { ok: false, erreur: 'préférences illisibles' };
  const table = prefs[CLE] && typeof prefs[CLE] === 'object' ? (prefs[CLE] as Record<string, unknown>) : {};
  const fusion = { ...prefs, [CLE]: { ...table, [avatarId]: qualite } };
  const { error } = await supabaseAdmin
    .from('user_settings')
    .upsert({ user_id: userId, creator_preferences: fusion, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  return error ? { ok: false, erreur: error.message } : { ok: true };
}

/**
 * Le moteur d'une génération SANS qualité explicite (Créer, Autopilote) : la
 * qualité enregistrée de l'avatar si elle existe, sinon le défaut serveur.
 */
export async function moteurParDefautDeLAvatar(
  userId: string, avatarId: string | null | undefined, env: NodeJS.ProcessEnv = process.env,
): Promise<{ moteur: MoteurAvatar; qualite: QualiteRendu | null }> {
  const qualite = await lireQualiteAvatar(userId, avatarId);
  return { moteur: qualite ? MOTEUR_PAR_QUALITE[qualite] : moteurAvatar(env), qualite };
}
