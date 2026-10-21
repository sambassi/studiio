/**
 * LE DÉBIT DE PAROLE DU COMPTE — lecture SEULE, côté serveur.
 *
 * Lit les derniers rendus du compte qui ont enregistré leur parole mesurée
 * (`metadata.paroleEstimation`, écrit par `produire.ts`) et en déduit le
 * débit (`debitCalibre`). Aucun rendu de ce genre, base indisponible, erreur :
 * `null` — l'appelant garde le débit par défaut. Ne lève jamais.
 *
 * Les rendus antérieurs à ce champ n'apportent rien : leur script n'était pas
 * enregistré, et le recomposer après coup serait deviner.
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import { debitCalibre, ECHANTILLONS_PAROLE_MAX } from '@/lib/autopilot/debit-parole';

export async function lireDebitParoleCompte(userId: string | null | undefined): Promise<number | null> {
  if (!userId) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from('scheduled_posts')
      .select('parole:metadata->paroleEstimation')
      .eq('user_id', userId)
      .not('metadata->paroleEstimation', 'is', null)
      .order('created_at', { ascending: false })
      .limit(ECHANTILLONS_PAROLE_MAX);
    if (error || !Array.isArray(data)) return null;
    return debitCalibre((data as Array<{ parole?: unknown }>).map((l) => l?.parole));
  } catch {
    return null;
  }
}
