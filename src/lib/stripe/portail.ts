/**
 * Configuration du portail client Stripe DÉDIÉE à Studiio.
 *
 * Le compte Afroboosteur est partagé (BoostTribe, Afroboost). Sa
 * configuration par défaut (`is_default`) leur appartient : on ne la lit
 * pas, on ne la modifie jamais. Studiio utilise sa propre configuration :
 *
 *   1. `STRIPE_PORTAL_CONFIGURATION_ID` si la variable est posée ;
 *   2. sinon une configuration ACTIVE portant `metadata.app = 'studiio'` ;
 *   3. sinon on en crée une — sans `subscription_update` : un changement de
 *      plan ou de cycle via le portail crédite mal (proratas), il passe par
 *      l'équipe.
 *
 * Résultat mis en cache mémoire (par processus).
 */
import { stripe } from '@/lib/stripe/client';
import { MARQUEUR_APP } from '@/lib/stripe/prix';

const g = globalThis as unknown as { __studiioPortailConfig?: string };

/** Réservé aux tests. */
export function viderCachePortail(): void {
  delete g.__studiioPortailConfig;
}

export function parametresConfigurationStudiio(): Record<string, any> {
  const base = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'https://studiio.pro').replace(/\/+$/, '');
  return {
    business_profile: { headline: 'Studiio' },
    default_return_url: `${base}/dashboard/billing`,
    features: {
      customer_update: { enabled: true, allowed_updates: ['email', 'address'] },
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
      subscription_update: { enabled: false },
    },
    metadata: { app: MARQUEUR_APP },
  };
}

export async function configurationPortailStudiio(): Promise<string> {
  const env = process.env.STRIPE_PORTAL_CONFIGURATION_ID?.trim();
  if (env) return env;
  if (g.__studiioPortailConfig) return g.__studiioPortailConfig;

  let apres: string | undefined;
  for (let page = 0; page < 20; page++) {
    const res: any = await stripe.billingPortal.configurations.list({
      active: true, limit: 100, ...(apres ? { starting_after: apres } : {}),
    });
    const data: any[] = res?.data ?? [];
    const trouvee = data.find((c) => c?.active !== false && c?.metadata?.app === MARQUEUR_APP && !c?.is_default);
    if (trouvee) {
      g.__studiioPortailConfig = trouvee.id;
      return trouvee.id;
    }
    if (!res?.has_more || data.length === 0) break;
    apres = data[data.length - 1].id;
  }

  const creee: any = await stripe.billingPortal.configurations.create(parametresConfigurationStudiio() as any);
  g.__studiioPortailConfig = creee.id;
  return creee.id;
}
