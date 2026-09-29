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
 * Session de portail client. `configuration` : la configuration dédiée
 * Studiio résolue par `lib/stripe/portail` — jamais celle par défaut du
 * compte, partagée avec d'autres sites.
 */
export async function createBillingPortalSession(
  customerId: string,
  returnUrl: string,
  configuration?: string,
) {
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
