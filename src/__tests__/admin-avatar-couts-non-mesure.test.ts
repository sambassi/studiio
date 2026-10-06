/** Coût fournisseur inconnu = « non mesuré », jamais 0 — y compris dans les totaux admin. */
import { describe, it, expect, vi } from 'vitest';

const lignes = vi.hoisted(() => ({ v: [] as Array<Record<string, unknown>> }));
vi.mock('@/lib/admin', () => ({ requireAdmin: async () => ({ error: null }) }));
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: () => ({ select: () => ({ order: () => ({ limit: async () => ({ data: lignes.v, error: null }) }) }) }) },
}));
import { GET } from '@/app/api/admin/avatar-couts/route';

describe('/api/admin/avatar-couts — totaux', () => {
  it('aucune génération mesurée → totaux null (non mesuré), jamais 0', async () => {
    lignes.v = [{ id: '1', provider_cost_eur: null, margin_eur: null }, { id: '2', provider_cost_eur: null }];
    const j = await (await GET()).json();
    expect(j.data.totaux.providerCostEur).toBeNull();
    expect(j.data.totaux.marginEur).toBeNull();
    expect(j.data.totaux.nonMesurees).toBe(2);
  });
  it('seules les générations mesurées sont additionnées', async () => {
    lignes.v = [{ id: '1', provider_cost_eur: 1.06, admin_usage: true, margin_eur: -1.06 }, { id: '2', provider_cost_eur: null }];
    const j = await (await GET()).json();
    expect(j.data.totaux.providerCostEur).toBeCloseTo(1.06, 4);
    expect(j.data.totaux.providerCostAdminEur).toBeCloseTo(1.06, 4);
    expect(j.data.totaux.nonMesurees).toBe(1);
  });
});
