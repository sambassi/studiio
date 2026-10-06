/**
 * /api/admin/avatar-couts — seule la session ADMIN lit les coûts fournisseur.
 * Utilisateur connecté non admin → 403, aucune donnée ; anonyme → 401.
 * (La page /admin/avatar-couts ne rend rien sans session admin : le layout
 * admin redirige, et ses données ne viennent QUE de cette route.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const etat = vi.hoisted(() => ({ session: null as unknown, lectures: 0 }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => etat.session }));
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: () => ({ select: () => ({ order: () => ({ limit: async () => { etat.lectures += 1; return { data: [{ id: 'g1', provider: 'heygen', provider_cost_eur: 1.2, provider_error: 'brut' }], error: null }; } }) }) }),
  },
}));
import { GET } from '@/app/api/admin/avatar-couts/route';

beforeEach(() => { etat.session = null; etat.lectures = 0; });

describe('/api/admin/avatar-couts — accès', () => {
  it('anonyme → 401, aucune lecture', async () => {
    const r = await GET();
    expect(r.status).toBe(401);
    expect(etat.lectures).toBe(0);
  });
  it('utilisateur connecté NON admin → 403, aucune donnée fournisseur ni coût', async () => {
    etat.session = { user: { id: 'u2', email: 'client@exemple.fr' } };
    const r = await GET();
    expect(r.status).toBe(403);
    const corps = JSON.stringify(await r.json());
    expect(corps).not.toMatch(/heygen|provider|cost|brut/i);
    expect(etat.lectures).toBe(0);
  });
  it('admin → 200 avec les coûts', async () => {
    etat.session = { user: { id: 'u1', email: 'contact.artboost@gmail.com' } };
    const r = await GET();
    expect(r.status).toBe(200);
    expect((await r.json()).data.generations).toHaveLength(1);
  });
});
