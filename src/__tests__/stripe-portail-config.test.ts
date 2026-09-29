import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Portail client (I1) : sur un compte Stripe partagé, la configuration par
 * défaut autorise le changement de plan, que le webhook ne sait pas créditer
 * correctement. `STRIPE_PORTAL_CONFIGURATION_ID` impose la configuration
 * Studiio (sans `subscription_update`) ; absente, comportement inchangé mais
 * avertissement journalisé.
 */

const creations: any[] = [];
vi.mock('stripe', () => ({
  default: class {
    billingPortal = { sessions: { create: vi.fn(async (p: any) => { creations.push(p); return { url: 'https://portal.test' }; }) } };
  },
}));

const { createBillingPortalSession } = await import('@/lib/stripe/client');

beforeEach(() => { creations.length = 0; });
afterEach(() => { delete process.env.STRIPE_PORTAL_CONFIGURATION_ID; vi.restoreAllMocks(); });

describe('createBillingPortalSession', () => {
  it('passe la configuration Studiio quand la variable est posée', async () => {
    process.env.STRIPE_PORTAL_CONFIGURATION_ID = 'bpc_studiio';
    await createBillingPortalSession('cus_1', 'https://studiio.pro/dashboard/billing');
    expect(creations[0]).toEqual({ customer: 'cus_1', return_url: 'https://studiio.pro/dashboard/billing', configuration: 'bpc_studiio' });
  });

  it('sans variable : comportement actuel + avertissement', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await createBillingPortalSession('cus_1', 'https://studiio.pro/x');
    expect(creations[0]).toEqual({ customer: 'cus_1', return_url: 'https://studiio.pro/x' });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/STRIPE_PORTAL_CONFIGURATION_ID/));
  });
});
