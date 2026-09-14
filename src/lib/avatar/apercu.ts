import { supabaseAdmin } from '@/lib/db/supabase';
import { INTENTION_APERCU } from '@/lib/avatar/contrat';

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
 * ⚠️ ELLE NE FABRIQUE RIEN. Elle ne trouve que ce qu'une generation d'apercu
 * a REELLEMENT produit ; tant qu'aucune n'existe, la reponse est `null`, et
 * c'est la bonne reponse.
 *
 * ⚠️ ET ELLE EST FILTREE PAR PROPRIETAIRE. `user_id` est dans la requete, pas
 * dans une decision prise apres : l'apercu du clone d'autrui ne revient jamais,
 * meme pour etre refuse ensuite.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * A_8f (correctif Gap-1) — L'APERCU APPARTIENT A UNE VERSION
 * ═════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ SEULE COMPTE LA VERSION COURANTE. Reentrainer produit une AUTRE personne
 * numerique ; l'apercu de la version 1 ne dit rien de la version 2. Sans ce
 * filtre, la validation de la nouvelle version s'appuierait sur une video de
 * l'ancienne — precisement ce que la remise a zero de `validated_at` (Gap-2)
 * empeche de l'autre cote.
 *
 * ⚠️ ET SEULE COMPTE UNE GENERATION D'APERCU. Une generation normale — apres
 * validation — n'a pas ete demandee pour juger le clone ; les lignes
 * historiques (intention `normale`, version NULL) ne valident donc rien non
 * plus.
 */
export async function apercuDuClone(
  userId: string, avatarId: string, version: unknown,
): Promise<string | null> {
  if (!userId || !avatarId) return null;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return null;

  const { data } = await supabaseAdmin
    .from('avatar_generations')
    .select('video_url')
    .eq('user_id', userId)
    .eq('user_avatar_id', avatarId)
    .eq('intention', INTENTION_APERCU)
    .eq('avatar_version', version)
    /* Seule une generation TERMINEE est un apercu. Une video en cours de
       calcul n'a pas d'URL a montrer, et une echouee encore moins. */
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const url = (data as { video_url?: unknown } | null)?.video_url;
  return typeof url === 'string' && url.length > 0 ? url : null;
}
