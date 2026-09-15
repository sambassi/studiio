/**
 * Lire l'avatar VIVANT d'un compte — ou savoir qu'on n'a pas pu le lire.
 *
 * Partagé par les routes d'aperçu et de validation. Une erreur de lecture
 * n'est jamais « aucun avatar » : les deux issues sont distinctes.
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import { type AvatarLigne, avatarLigneValide } from '@/lib/avatar/contrat';

export type AvatarVivant = AvatarLigne & { source_url: string | null; name: string | null; avatar_type: string | null; training_error: string | null };

export async function avatarVivantDuCompte(
  userId: string,
): Promise<{ ok: true; avatar: AvatarVivant | null } | { ok: false; erreur: string }> {
  const { data, error } = await supabaseAdmin
    .from('user_avatars')
    .select('*')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) return { ok: false, erreur: error.message };
  const brut = data?.[0];
  if (!brut) return { ok: true, avatar: null };
  // La ligne est REVALIDÉE même venant de la base : forme, compte, version.
  if (!avatarLigneValide(brut, userId)) return { ok: false, erreur: 'ligne user_avatars malformée' };
  return { ok: true, avatar: brut as AvatarVivant };
}
