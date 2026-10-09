/**
 * Lire l'avatar VIVANT d'un compte — ou savoir qu'on n'a pas pu le lire.
 *
 * Partagé par les routes d'aperçu et de validation. Une erreur de lecture
 * n'est jamais « aucun avatar » : les deux issues sont distinctes.
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import { type AvatarLigne, avatarLigneValide } from '@/lib/avatar/contrat';

export type AvatarVivant = AvatarLigne & {
  source_url: string | null; name: string | null; avatar_type: string | null; training_error: string | null;
  /** Version active (null : jamais validée). Absente avant la migration identités/versions. */
  active_version_id?: string | null;
  is_default?: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * L'identité demandée (`avatarId`, du compte seulement), sinon l'identité
 * PAR DÉFAUT du compte — jamais « la dernière créée » : créer un second
 * avatar ne doit pas changer celui qu'utilisent Créer et l'Autopilote.
 * Sans identité par défaut (base d'avant la migration), la plus ancienne.
 */
export async function avatarVivantDuCompte(
  userId: string,
  avatarId?: string | null,
): Promise<{ ok: true; avatar: AvatarVivant | null } | { ok: false; erreur: string }> {
  if (avatarId !== undefined && avatarId !== null && !UUID.test(avatarId)) return { ok: true, avatar: null };
  let requete = supabaseAdmin
    .from('user_avatars')
    .select('*')
    .eq('user_id', userId)
    .is('deleted_at', null);
  if (avatarId) requete = requete.eq('id', avatarId);
  const { data, error } = await requete.order('created_at', { ascending: true });
  if (error) return { ok: false, erreur: error.message };
  const lignes = (data ?? []) as Array<Record<string, unknown>>;
  const brut = avatarId
    ? lignes.find((l) => l.id === avatarId)
    : (lignes.find((l) => l.is_default === true) ?? lignes[0]);
  if (!brut) return { ok: true, avatar: null };
  // La ligne est REVALIDÉE même venant de la base : forme, compte, version.
  if (!avatarLigneValide(brut, userId)) return { ok: false, erreur: 'ligne user_avatars malformée' };
  return { ok: true, avatar: brut as unknown as AvatarVivant };
}
