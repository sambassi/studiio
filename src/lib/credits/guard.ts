import { supabaseAdmin } from '@/lib/db/supabase';
import { deductCredits as systemDeductCredits } from '@/lib/credits/system';
import { isAdmin } from '@/lib/admin';

// Solde affiché pour les admins (illimité côté business model — les admins
// n'achètent jamais de crédits, ils utilisent tous les services librement
// pour les démos, support, et tests internes). 999_999_999 plutôt que
// Infinity pour rester un nombre JSON-serializable côté API.
const ADMIN_BALANCE = 999_999_999;

export async function requireCredits(
  userId: string,
  cost: number,
): Promise<{ ok: boolean; balance: number; error?: string }> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('credits, email')
    .eq('id', userId)
    .single();
  if (error || !data) return { ok: false, balance: 0, error: 'user not found' };

  // Admin bypass : les admins ont un solde fictif illimité et passent
  // tous les checks. Le `deductCredits` côté admin est aussi neutralisé
  // ci-dessous, donc l'utilisation des services par un admin ne décrémente
  // jamais la valeur réelle stockée en DB.
  if (isAdmin(data.email)) {
    return { ok: true, balance: ADMIN_BALANCE };
  }

  const balance = data.credits ?? 0;
  return { ok: balance >= cost, balance };
}

export async function deductCredits(
  userId: string,
  cost: number,
  reason: string,
): Promise<{ ok: boolean; balance: number; error?: string }> {
  const { data: u } = await supabaseAdmin
    .from('users')
    .select('credits, email')
    .eq('id', userId)
    .single();

  // Admin bypass : pas de décrément, retour OK avec solde fictif.
  if (u?.email && isAdmin(u.email)) {
    return { ok: true, balance: ADMIN_BALANCE };
  }

  const current = u?.credits ?? 0;
  if (current < cost) return { ok: false, balance: current, error: 'insufficient' };
  try {
    await systemDeductCredits(userId, cost, reason);
  } catch (e: any) {
    return { ok: false, balance: current, error: e?.message || 'deduct failed' };
  }
  return { ok: true, balance: current - cost };
}
