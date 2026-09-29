import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Portail client : configuration DÉDIÉE Studiio. Le compte Stripe est
 * partagé (BoostTribe, Afroboost) : la configuration par défaut (`is_default`)
 * ne doit jamais être utilisée ni modifiée. Stripe entièrement mocké.
 */

const configs: any[] = [];
const creees: any[] = [];
const modifiees: any[] = [];
const sessions: any[] = [];

vi.mock('@/lib/stripe/client', () => ({
  stripe: {
    billingPortal: {
      configurations: {
        list: vi.fn(async () => ({ data: configs, has_more: false })),
        create: vi.fn(async (p: any) => { creees.push(p); return { id: `bpc_new_${creees.length}`, ...p }; }),
        update: vi.fn(async (id: string, p: any) => { modifiees.push({ id, p }); return { id }; }),
      },
    },
  },
  createBillingPortalSession: vi.fn(async (customer: string, return_url: string, configuration?: string) => {
    sessions.push({ customer, return_url, configuration });
    return { url: 'https://portal.test' };
  }),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: vi.fn(async () => ({ user: { id: 'user-1', email: 'u@test.ch' } })),
}));

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: () => {
      const api: any = { select: () => api, eq: () => api, order: () => api, limit: () => api, single: async () => ({ data: { stripe_customer_id: 'cus_1' }, error: null }) };
      return api;
    },
  },
}));

const portail = await import('@/lib/stripe/portail');
const route = await import('@/app/api/stripe/create-portal/route');

beforeEach(() => {
  configs.length = 0; creees.length = 0; modifiees.length = 0; sessions.length = 0;
  portail.viderCachePortail();
  process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';
});
afterEach(() => { delete process.env.STRIPE_PORTAL_CONFIGURATION_ID; });

describe('configuration de portail Studiio', () => {
  it('STRIPE_PORTAL_CONFIGURATION_ID prime, sans appel Stripe', async () => {
    process.env.STRIPE_PORTAL_CONFIGURATION_ID = 'bpc_env';
    expect(await portail.configurationPortailStudiio()).toBe('bpc_env');
    expect(creees).toHaveLength(0);
  });

  it('réutilise une configuration active marquée app=studiio, ignore celle par défaut', async () => {
    configs.push(
      { id: 'bpc_defaut', active: true, is_default: true, metadata: {} },
      { id: 'bpc_afro', active: true, is_default: false, metadata: { app: 'afroboost' } },
      { id: 'bpc_studiio', active: true, is_default: false, metadata: { app: 'studiio' } },
    );
    expect(await portail.configurationPortailStudiio()).toBe('bpc_studiio');
    expect(creees).toHaveLength(0);
    expect(modifiees).toHaveLength(0);
  });

  it('sinon en crée une : sans subscription_update, annulation fin de période, marqueur, retour billing', async () => {
    configs.push({ id: 'bpc_defaut', active: true, is_default: true, metadata: {} });
    const id = await portail.configurationPortailStudiio();
    expect(id).toBe('bpc_new_1');
    expect(creees[0]).toEqual({
      business_profile: { headline: 'Studiio' },
      default_return_url: 'https://studiio.pro/dashboard/billing',
      features: {
        customer_update: { enabled: true, allowed_updates: ['email', 'address'] },
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true },
        subscription_cancel: { enabled: true, mode: 'at_period_end' },
        subscription_update: { enabled: false },
      },
      metadata: { app: 'studiio' },
    });
    expect(modifiees).toHaveLength(0);
  });

  it('mise en cache : un seul appel Stripe pour plusieurs portails', async () => {
    await portail.configurationPortailStudiio();
    await portail.configurationPortailStudiio();
    expect(creees).toHaveLength(1);
  });

  it('create-portal ouvre la session avec la configuration Studiio', async () => {
    configs.push({ id: 'bpc_studiio', active: true, metadata: { app: 'studiio' } });
    const res = await route.POST(new Request('http://localhost/x', { method: 'POST' }) as any);
    expect(res.status).toBe(200);
    expect(sessions[0]).toMatchObject({ customer: 'cus_1', configuration: 'bpc_studiio' });
  });
});
