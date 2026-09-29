/**
 * Client Stripe d'un utilisateur Studiio, valide sur le compte courant.
 *
 * `users.stripe_customer_id` peut désigner un client de l'ANCIEN compte
 * Stripe (avant Afroboosteur) : le passer tel quel à un checkout échoue
 * (« No such customer »). On vérifie donc qu'il existe sur ce compte, et on
 * en crée un nouveau sinon.
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import { stripe, createCustomer } from '@/lib/stripe/client';

export async function clientStripeUtilisateur(userId: string, email: string, nom: string): Promise<string> {
  let existant: string | undefined;
  try {
    const { data, error } = await supabaseAdmin.from('users').select('stripe_customer_id').eq('id', userId).single();
    if (error) console.error('[stripe] lecture users.stripe_customer_id impossible (colonne absente ? cf. #472) :', error.message);
    existant = (data as any)?.stripe_customer_id || undefined;
  } catch (e: any) {
    console.error('[stripe] lecture users.stripe_customer_id impossible :', e?.message);
  }

  if (existant) {
    try {
      const c: any = await stripe.customers.retrieve(existant);
      if (c && !c.deleted) return existant;
    } catch (e: any) {
      if (e?.code !== 'resource_missing' && e?.statusCode !== 404) throw e;
    }
  }

  const client = await createCustomer(email, nom || 'User');
  // Ne bloque jamais le paiement : le webhook sait retrouver l'utilisateur
  // sans cette colonne (metadata, puis subscriptions).
  try {
    const { error } = await supabaseAdmin.from('users').update({ stripe_customer_id: client.id }).eq('id', userId);
    if (error) console.error('[stripe] ecriture users.stripe_customer_id impossible (colonne absente ? cf. #472) :', error.message);
  } catch (e: any) {
    console.error('[stripe] ecriture users.stripe_customer_id impossible :', e?.message);
  }
  return client.id;
}
