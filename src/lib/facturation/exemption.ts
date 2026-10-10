/**
 * L'administrateur ne paie JAMAIS de crédits Studiio — une seule définition.
 *
 * ⚠️ DEUX DÉFINITIONS COEXISTAIENT. Les rendus (`politique.ts`) lisaient le
 * RÔLE en base (`users.role = 'admin'`) ; avatar, Jumeau, IA image et
 * Autopilote (`credits/system.ts`) lisaient la LISTE D'E-MAILS de
 * `lib/admin.ts`. Un administrateur reconnu par l'une et pas par l'autre
 * payait d'un côté et pas de l'autre. Désormais : rôle `admin` OU e-mail
 * administrateur, partout, via cette seule fonction.
 *
 * ⚠️ « EXEMPT » = 0 CRÉDIT STUDIIO DÉBITÉ, RIEN D'AUTRE. Les appels aux
 * fournisseurs (ElevenLabs, HeyGen, Replicate…) partent exactement comme pour
 * tout le monde et coûtent au compte Studiio. Rien ici ne les contourne.
 *
 * Fermé par défaut : base injoignable, ligne absente, valeurs inattendues →
 * non exempt (on facture plutôt que d'offrir).
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import { isAdmin } from '@/lib/admin';
import { ROLE_ADMIN } from './roles';

export function exempteDeCredits(compte: { role?: unknown; email?: unknown } | null | undefined): boolean {
  if (!compte) return false;
  const role = typeof compte.role === 'string' ? compte.role.trim().toLowerCase() : '';
  if (role === ROLE_ADMIN) return true;
  return typeof compte.email === 'string' && isAdmin(compte.email);
}

/** Relit le compte EN BASE (jamais la session, jamais le corps de la requête). */
export async function compteExempteDeCredits(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('role, email')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data) return false;
    return exempteDeCredits(data as { role?: unknown; email?: unknown });
  } catch {
    return false;
  }
}
