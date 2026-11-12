/**
 * Lecture SERVEUR du portefeuille, pour l'assistant.
 *
 * Fermé par défaut : toute lecture qui échoue donne `null` (solde ou plan
 * inconnu) et jamais une valeur inventée — l'assistant dira « indisponible »
 * plutôt qu'un chiffre faux.
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import { lireTarifs } from '@/lib/tarifs/serveur';
import { exempteDeCredits } from '@/lib/facturation/exemption';
import { STRIPE_PLANS } from '@/lib/stripe/constants';
import { prixCitables, type ContexteCommercial } from './contexte-commercial';

function libellePlan(cle: unknown): string | null {
  if (typeof cle !== 'string' || !cle) return null;
  const p = (STRIPE_PLANS as Record<string, { name?: string }>)[cle];
  return p?.name ?? cle;
}

export async function lirePortefeuille(userId: string): Promise<ContexteCommercial> {
  const lireCompte = async () => {
    try {
      const r = await supabaseAdmin.from('users').select('credits, plan, role, email').eq('id', userId).maybeSingle();
      return r.error ? null : r.data;
    } catch {
      return null;
    }
  };
  const [compte, config] = await Promise.all([lireCompte(), lireTarifs()]);
  const exempte = exempteDeCredits(compte as { role?: unknown; email?: unknown } | null);
  const credits = compte && typeof (compte as { credits?: unknown }).credits === 'number'
    ? (compte as { credits: number }).credits
    : null;
  return {
    plan: libellePlan((compte as { plan?: unknown } | null)?.plan),
    solde: exempte ? null : credits,
    exempte,
    prix: prixCitables(config.prix),
  };
}
