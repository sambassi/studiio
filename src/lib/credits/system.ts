import { supabaseAdmin as supabase } from '@/lib/db/supabase';
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

export async function deductCredits(
  userId: string,
  amount: number,
  _reason: string = 'render'
): Promise<boolean> {
  // Admin = pas de décrément. On retourne true sans toucher à la DB.
  const { data: u } = await supabase
    .from('users')
    .select('email')
    .eq('id', userId)
    .single();
  if (u?.email && isAdmin(u.email)) return true;

  const currentCredits = await getUserCredits(userId);

  if (currentCredits < amount) {
    throw new Error('Insufficient credits');
  }

  const { error: updateError } = await supabase
    .from('users')
    .update({ credits: currentCredits - amount })
    .eq('id', userId);

  if (updateError) throw updateError;

  await supabase.from('credit_transactions').insert({
    user_id: userId,
    amount: -amount,
    type: 'render',
    created_at: new Date().toISOString(),
  });

  return true;
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
