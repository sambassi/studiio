/**
 * Idempotence des événements Stripe — façade du contrat SQL
 * `public.stripe_events` + RPC `stripe_event_claim / complete / fail`.
 *
 * Règle : claim → traitement → complete. Un événement n'est JAMAIS marqué
 * traité avant que son traitement ait réussi. L'ancien marqueur était inséré
 * AVANT le traitement, et son échec d'insertion passait en silence
 * (supabase-js ne lève pas) : aucune idempotence réelle, et un traitement
 * qui plantait était perdu au rejeu.
 *
 * Si la table ou les fonctions n'existent pas encore (migration non
 * appliquée), `reclamerEvenement` LÈVE : le webhook répond 500, Stripe
 * rejoue pendant trois jours, et rien n'est crédité sans garde.
 */
import { supabaseAdmin } from '@/lib/db/supabase';

export type Reclamation = 'claimed' | 'already_processed' | 'in_progress';
const RECLAMATIONS: readonly Reclamation[] = ['claimed', 'already_processed', 'in_progress'];

/** Durée du bail : au-delà, un traitement interrompu peut être repris. */
export const BAIL_SECONDES = 300;

export class ErreurIdempotence extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurIdempotence';
  }
}

export async function reclamerEvenement(eventId: string, type: string): Promise<Reclamation> {
  const { data, error } = await supabaseAdmin.rpc('stripe_event_claim', {
    p_event_id: eventId,
    p_type: type,
    p_lease_seconds: BAIL_SECONDES,
  });
  if (error) {
    throw new ErreurIdempotence(`stripe_event_claim indisponible : ${error.message || error.code || 'erreur'}`);
  }
  const valeur = (Array.isArray(data) ? data[0] : data) as unknown;
  if (typeof valeur === 'string' && (RECLAMATIONS as readonly string[]).includes(valeur)) {
    return valeur as Reclamation;
  }
  throw new ErreurIdempotence(`stripe_event_claim : reponse inattendue ${JSON.stringify(valeur)}`);
}

export async function terminerEvenement(eventId: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc('stripe_event_complete', { p_event_id: eventId });
  if (error) {
    throw new ErreurIdempotence(`stripe_event_complete : ${error.message || error.code || 'erreur'}`);
  }
}

/** Best-effort : ne lève jamais, l'appelant répond déjà 500. */
export async function echouerEvenement(eventId: string, erreur: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc('stripe_event_fail', {
      p_event_id: eventId,
      p_error: String(erreur).slice(0, 2000),
    });
    if (error) console.error('[webhook] stripe_event_fail', eventId, error.message);
  } catch (e: any) {
    console.error('[webhook] stripe_event_fail', eventId, e?.message);
  }
}
