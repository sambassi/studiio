import { supabaseAdmin } from '@/lib/db/supabase';
import { deductCredits as systemDeductCredits } from '@/lib/credits/system';

export async function requireCredits(userId: string, cost: number): Promise<{ ok: boolean; balance: number; error?: string }> {
  const { data, error } = await supabaseAdmin.from('users').select('credits').eq('id', userId).single();
  if (error || !data) return { ok: false, balance: 0, error: 'user not found' };
  const balance = data.credits ?? 0;
  return { ok: balance >= cost, balance };
}

export async function deductCredits(userId: string, cost: number, reason: string): Promise<{ ok: boolean; balance: number; error?: string }> {
  const { data: u } = await supabaseAdmin.from('users').select('credits').eq('id', userId).single();
  const current = u?.credits ?? 0;
  if (current < cost) return { ok: false, balance: current, error: 'insufficient' };
  try {
    await systemDeductCredits(userId, cost, reason);
  } catch (e: any) {
    return { ok: false, balance: current, error: e?.message || 'deduct failed' };
  }
  return { ok: true, balance: current - cost };
}
