import { supabaseAdmin } from '@/lib/db/supabase';
import { deductCredits as systemDeductCredits } from '@/lib/credits/system';

// ⚠️ LE SOLDE FICTIF A ETE RETIRE.
//
// Ce module rendait `999_999_999` aux administrateurs. Depuis que le debit
// des rendus passe par le socle atomique -- qui lit la VRAIE colonne
// `users.credits` et ne connait aucune exception --, ce nombre invente
// devenait dangereux : l'ecran annoncait un solde quasi infini pendant qu'un
// debit reel pouvait echouer sur solde insuffisant.
//
// L'exemption administrateur existe toujours, mais elle est desormais une
// POLITIQUE resolue dans `lib/facturation/politique.ts`, a partir du role lu
// en base -- pas d'une liste d'e-mails codee dans le bundle.
//
// `system.ts` porte encore son propre `ADMIN_BALANCE`, pour les chemins IA
// image et avatar qui ne sont pas dans ce lot. Il y reste coherent : solde
// fictif ET debit neutralise, les deux ensemble.

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

  const current = u?.credits ?? 0;
  if (current < cost) return { ok: false, balance: current, error: 'insufficient' };
  try {
    await systemDeductCredits(userId, cost, reason);
  } catch (e: any) {
    return { ok: false, balance: current, error: e?.message || 'deduct failed' };
  }
  return { ok: true, balance: current - cost };
}
