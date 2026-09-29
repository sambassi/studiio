import { NextRequest, NextResponse } from 'next/server';
import { getWebhookEvent } from '@/lib/stripe/client';
import { reclamerEvenement, terminerEvenement, echouerEvenement } from '@/lib/stripe/evenements';
import { traiterEvenementStripe, EVENEMENTS_GERES } from '@/lib/stripe/webhook-traitement';

export const dynamic = 'force-dynamic';

/**
 * Webhook Stripe (API épinglée 2023-10-16).
 *
 *   400  signature absente ou invalide — Stripe ne doit pas insister
 *   200  événement non géré, déjà traité, ou traité à l'instant
 *   503  événement en cours de traitement ailleurs — Stripe rejouera
 *   500  échec (réclamation impossible, traitement, clôture) — Stripe rejouera
 *
 * L'événement n'est marqué traité (`stripe_event_complete`) qu'APRÈS la
 * réussite de tout son traitement. Les crédits sont en plus idempotents par
 * référence Stripe (facture / session), donc un rejeu après un échec
 * partiel ne crédite jamais deux fois.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'signature absente' }, { status: 400 });
  }

  let event: any;
  try {
    const corps = Buffer.from(await req.arrayBuffer());
    event = await getWebhookEvent(corps, signature);
  } catch (e: any) {
    console.warn('[webhook] signature invalide', e?.message);
    return NextResponse.json({ error: 'signature invalide' }, { status: 400 });
  }

  if (!EVENEMENTS_GERES.has(event.type)) {
    return NextResponse.json({ received: true, ignored: true });
  }

  let reclamation;
  try {
    reclamation = await reclamerEvenement(event.id, event.type);
  } catch (e: any) {
    // Sans garde d'idempotence, on ne traite rien.
    console.error('[webhook] reclamation impossible', event.id, e?.message);
    return NextResponse.json({ error: 'idempotence indisponible' }, { status: 500 });
  }

  if (reclamation === 'already_processed') {
    return NextResponse.json({ received: true, idempotent: true });
  }
  if (reclamation === 'in_progress') {
    return NextResponse.json({ error: 'evenement en cours de traitement' }, { status: 503 });
  }

  try {
    await traiterEvenementStripe(event);
  } catch (e: any) {
    console.error('[webhook] traitement en echec', event.id, event.type, e?.message);
    await echouerEvenement(event.id, e?.message || 'erreur');
    return NextResponse.json({ error: 'traitement en echec' }, { status: 500 });
  }

  try {
    await terminerEvenement(event.id);
  } catch (e: any) {
    // Traitement fait, marque non posée : le rejeu retraitera, sans double
    // crédit (références Stripe).
    console.error('[webhook] cloture impossible', event.id, e?.message);
    return NextResponse.json({ error: 'cloture impossible' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
