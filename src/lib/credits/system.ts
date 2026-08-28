import { randomUUID } from 'crypto';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';
import { debiterOperationAtomique } from '@/lib/credits/atomique';
import { RENDER_COSTS } from '@/lib/stripe/constants';
import { isAdmin } from '@/lib/admin';

const ADMIN_BALANCE = 999_999_999;

export async function getUserCredits(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('users')
    .select('credits, email')
    .eq('id', userId)
    .single();

  if (error) throw new Error('Failed to fetch user credits');
  // Admin = solde illimité (jamais bloqué par les checks de crédits).
  if (data?.email && isAdmin(data.email)) return ADMIN_BALANCE;
  return data?.credits || 0;
}

/**
 * Débite des crédits — désormais en une seule instruction SQL.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE FAISAIT CETTE FONCTION
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   SELECT credits
 *     → comparaison en JavaScript
 *     → UPDATE credits = <valeur absolue calculée ici>
 *     → INSERT dans le journal, requête séparée
 *
 * Trois défauts, tous observables :
 *
 *   1. Deux appels concurrents lisaient le MÊME solde et écrivaient la MÊME
 *      valeur. Un des deux débits disparaissait — l'utilisateur payait une
 *      fois pour deux opérations.
 *   2. La comparaison `credits < amount` se faisait sur une lecture déjà
 *      périmée : rien n'empêchait le solde de passer sous zéro entre les
 *      deux requêtes.
 *   3. Le journal était une requête à part. Un échec après l'UPDATE retirait
 *      des crédits sans laisser de trace.
 *
 * Tout passe maintenant par `debiter_credits_operation` : décrément relatif
 * sous condition, journal dans la même transaction, et l'index unique
 * `(user_id, reference_id)` qui interdit le second débit d'une même
 * référence.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI N'A PAS CHANGÉ, ET POURQUOI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * L'exemption administrateur reste ce qu'elle était : une liste d'e-mails
 * (`lib/admin.ts`), distincte de la politique par rôle qui gouverne les
 * rendus. Les deux mécanismes coexistent, et ce lot ne les unifie pas — les
 * quatre parcours qui passent ici (IA image, avatar, autopilote, ajustement
 * admin) n'ont jamais connu que celui-ci, et les fusionner changerait ce que
 * paient des comptes réels.
 *
 * Le `type` reste `'render'` : la colonne porte un CHECK fermé sur cinq
 * valeurs, dont ni `avatar` ni `ia` ne font partie. La raison de l'appel,
 * elle, n'était pas enregistrée du tout ; elle part désormais en
 * `description`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * IDEMPOTENCE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `reference` est facultative. Fournie, elle rend l'appel rejouable sans
 * second débit — c'est ce qu'il faut pour un cron ou une reprise. Absente,
 * une référence jetable est fabriquée : l'atomicité tient, l'idempotence
 * non. C'est le comportement d'aujourd'hui, conservé pour les appelants qui
 * n'ont aucun sujet stable à désigner (une retouche d'image n'en a pas).
 */
export async function deductCredits(
  userId: string,
  amount: number,
  reason: string = 'render',
  reference?: string | null,
): Promise<boolean> {
  // Admin = pas de décrément. On retourne true sans toucher à la DB.
  const { data: u } = await supabase
    .from('users')
    .select('email')
    .eq('id', userId)
    .single();
  if (u?.email && isAdmin(u.email)) return true;

  // Une référence jetable reste une référence : elle nourrit l'index et rend
  // la ligne traçable. Ce qu'elle ne fait pas, c'est reconnaître un rejeu.
  const ref = (reference ?? '').trim() || `op:${reason}:${randomUUID()}`;

  const resultat = await debiterOperationAtomique(
    userId, amount, 'render', ref, reason,
  );

  if (resultat.ok) return true;

  // Le solde insuffisant garde son message exact : des appelants le lisent.
  if (resultat.motif === 'solde_insuffisant') {
    throw new Error('Insufficient credits');
  }
  throw new Error(`debit refuse : ${resultat.motif ?? 'inconnu'}`);
}

export async function addCredits(
  userId: string,
  amount: number,
  type: 'purchase' | 'bonus' | 'refund' = 'purchase'
): Promise<boolean> {
  const currentCredits = await getUserCredits(userId);

  const { error: updateError } = await supabase
    .from('users')
    .update({ credits: currentCredits + amount })
    .eq('id', userId);

  if (updateError) throw updateError;

  await supabase.from('credit_transactions').insert({
    user_id: userId,
    amount,
    type,
    created_at: new Date().toISOString(),
  });

  return true;
}

export function getVideoRenderCost(format: 'reel' | 'tv'): number {
  return RENDER_COSTS[format];
}

export async function canRenderVideo(
  userId: string,
  format: 'reel' | 'tv'
): Promise<boolean> {
  const credits = await getUserCredits(userId);
  const cost = getVideoRenderCost(format);
  return credits >= cost;
}
