import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});

export async function createCheckoutSession(
  customerId: string,
  priceId: string,
  successUrl: string,
  cancelUrl: string
) {
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    mode: 'subscription',
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  return session;
}

// `createOneTimeCheckout` (montant libre, `price_data` fabriqué à la volée)
// a été retiré : tout paiement passe par un identifiant de prix Stripe
// configuré (CHF), résolu par `@/lib/stripe/prix`.

export async function createCustomer(
  email: string,
  name: string
) {
  const customer = await stripe.customers.create({
    email,
    name,
  });

  return customer;
}

/**
 * Portail client. `STRIPE_PORTAL_CONFIGURATION_ID` désigne une configuration
 * propre à Studiio, SANS changement de plan (`subscription_update`) : un
 * changement de plan ou de cycle via le portail crédite mal (0 crédit en
 * mensuel → annuel, double crédit en annuel → mensuel). Le compte Stripe est
 * partagé : la configuration par défaut appartient à tous les sites.
 */
export async function createBillingPortalSession(
  customerId: string,
  returnUrl: string
) {
  const configuration = process.env.STRIPE_PORTAL_CONFIGURATION_ID?.trim() || undefined;
  if (!configuration) {
    console.warn('[stripe] STRIPE_PORTAL_CONFIGURATION_ID absente : portail par defaut du compte (changement de plan possible, credits non geres)');
  }
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
    ...(configuration ? { configuration } : {}),
  });

  return session;
}

export async function getWebhookEvent(
  body: Buffer,
  signature: string
) {
  const event = stripe.webhooks.constructEvent(
    body,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!
  );

  return event;
}

export { stripe };
