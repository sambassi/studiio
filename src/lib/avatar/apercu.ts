import { supabaseAdmin } from '@/lib/db/supabase';

/**
 * A_8e — L'APERCU REEL D'UN CLONE, S'IL EN EXISTE UN.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * POURQUOI CETTE FONCTION EST SI COURTE, ET POURQUOI ELLE EST PARTAGEE
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Deux endroits ont besoin de la meme reponse, et ils doivent la lire au
 * MEME endroit :
 *
 *   - l'ecran, pour savoir s'il a quelque chose a montrer ;
 *   - la route de validation, pour savoir si l'on peut accepter.
 *
 * Deux implementations divergeraient un jour, et le jour ou elles
 * divergeraient, l'ecran afficherait un apercu que la validation ne
 * reconnaitrait pas — ou l'inverse, ce qui est pire : un bouton « je valide »
 * offert au-dessus d'un vide.
 *
 * ⚠️ ELLE NE FABRIQUE RIEN. Aujourd'hui la generation d'apercu n'existe pas
 * encore : cette fonction ne trouve donc rien, et c'est la bonne reponse. Elle
 * est ecrite pour qu'A_8_FINAL n'ait qu'a produire la generation, pas pour
 * simuler un resultat en attendant.
 *
 * ⚠️ ET ELLE EST FILTREE PAR PROPRIETAIRE. `user_id` est dans la requete, pas
 * dans une decision prise apres : l'apercu du clone d'autrui ne revient jamais,
 * meme pour etre refuse ensuite.
 */
export async function apercuDuClone(
  userId: string, avatarId: string,
): Promise<string | null> {
  if (!userId || !avatarId) return null;
  const { data } = await supabaseAdmin
    .from('avatar_generations')
    .select('video_url')
    .eq('user_id', userId)
    .eq('user_avatar_id', avatarId)
    /* Seule une generation TERMINEE est un apercu. Une video en cours de
       calcul n'a pas d'URL a montrer, et une echouee encore moins. */
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const url = (data as { video_url?: unknown } | null)?.video_url;
  return typeof url === 'string' && url.length > 0 ? url : null;
}
