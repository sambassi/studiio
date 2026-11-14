/**
 * L'ÉCRITURE D'UN PAIEMENT SIMULÉ — côté serveur, et nulle part ailleurs.
 *
 * Séparé de `demonstration.ts` pour une raison concrète : ce fichier importe
 * le client de base de données, qui entraîne avec lui des modules Node. Un
 * écran qui aurait importé les libellés depuis ici aurait tiré tout cela dans
 * le navigateur, et la page n'aurait pas pu se construire.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * IL NE CRÉDITE PAS DEUX FOIS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Une démonstration qui créditerait deux fois ne démontrerait rien : le point
 * qu'on veut justement montrer est qu'un paiement confirmé crédite une fois.
 * L'écriture s'appuie sur l'index unique
 * `credit_transactions(user_id, reference_id)` du 27 août — qui existe en
 * production et couvre TOUTE référence, `demo:` comprise. La transaction est
 * écrite D'ABORD ; le solde n'est augmenté que si cette écriture a réussi.
 * Un rejeu bute sur l'index et ne touche pas au solde.
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import { PREFIXE_DEMO, type IssueDemo } from './demonstration';

export interface ResultatPaiementSimule {
  issue: IssueDemo;
  credits: number;
  solde: number | null;
  dejaCredite: boolean;
}

function violationUnicite(erreur: { code?: string; message?: string } | null): boolean {
  if (!erreur) return false;
  const m = `${erreur.code ?? ''} ${erreur.message ?? ''}`.toLowerCase();
  return m.includes('23505') || m.includes('duplicate key') || m.includes('unique');
}

/**
 * Accorde les crédits d'un paiement simulé, une seule fois.
 *
 * `reference` est l'identifiant du paiement simulé ; deux appels avec la même
 * référence ne créditent qu'une fois, l'index s'en charge.
 */
export async function crediterPaiementSimule(
  userId: string,
  credits: number,
  reference: string,
  description: string,
): Promise<{ solde: number | null; dejaCredite: boolean }> {
  if (!reference.startsWith(PREFIXE_DEMO)) {
    throw new Error('référence de démonstration invalide');
  }

  // 1. L'ÉCRITURE QUI PORTE L'UNICITÉ, EN PREMIER. Si elle échoue parce que la
  //    référence existe déjà, le solde n'est pas touché — c'est exactement ce
  //    qu'on veut démontrer.
  const { error } = await supabaseAdmin.from('credit_transactions').insert({
    user_id: userId,
    amount: credits,
    type: 'purchase',
    reference_id: reference,
    description,
  });
  if (error) {
    if (violationUnicite(error)) return { solde: null, dejaCredite: true };
    throw new Error(`paiement simulé non enregistré : ${error.message}`);
  }

  // 2. Le solde ensuite. Lecture puis écriture : acceptable ICI et nulle part
  //    ailleurs, parce qu'un environnement de démonstration n'a ni
  //    concurrence ni argent en jeu. Les vrais encaissements passent par les
  //    fonctions atomiques (`crediter_credits_stripe`, `..._mobile_money`).
  const { data } = await supabaseAdmin
    .from('users').select('credits').eq('id', userId).maybeSingle();
  const solde = (data?.credits ?? 0) + credits;
  await supabaseAdmin.from('users').update({ credits: solde }).eq('id', userId);
  return { solde, dejaCredite: false };
}
