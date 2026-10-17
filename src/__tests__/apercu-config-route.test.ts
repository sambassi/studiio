/**
 * M3-a PR3 — GET /api/creer/apercu-config : l'aperçu rapide du plan n'est
 * proposé qu'à un administrateur (rôle EN BASE), interrupteur serveur strict.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const etat = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email?: string } },
  ligne: null as null | Record<string, unknown>,
  erreur: null as null | { message: string },
  lectures: 0,
  jette: false,
}));

vi.mock('@/lib/auth/config', () => ({ auth: vi.fn(async () => etat.session) }));
vi.mock('@/lib/db/supabase', () => {
  const chaine = () => {
    const c: Record<string, unknown> = {};
    c.select = () => c; c.eq = () => c;
    c.maybeSingle = async () => {
      etat.lectures += 1;
      if (etat.jette) throw new Error('base injoignable');
      return { data: etat.erreur ? null : etat.ligne, error: etat.erreur };
    };
    return c;
  };
  return { supabaseAdmin: { from: () => chaine() }, supabase: { from: () => chaine() } };
});

import * as route from '@/app/api/creer/apercu-config/route';
import { apercuPlanActif } from '@/lib/creer/apercu-plan-config';

async function appeler() {
  const r = await route.GET();
  return { status: r.status, corps: await r.json(), cache: r.headers.get('cache-control') ?? '' };
}

beforeEach(() => {
  etat.session = { user: { id: 'u1' } }; etat.ligne = { role: 'admin' }; etat.erreur = null; etat.lectures = 0; etat.jette = false;
  vi.stubEnv('STUDIIO_APERCU_PLAN_ENABLED', 'true');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('GET /api/creer/apercu-config', () => {
  it('interrupteur : "true" exactement', () => {
    expect(apercuPlanActif({ STUDIIO_APERCU_PLAN_ENABLED: 'true' })).toBe(true);
    for (const v of [undefined, '', '1', 'TRUE', ' true', 'true ', 'yes']) expect(apercuPlanActif({ STUDIIO_APERCU_PLAN_ENABLED: v })).toBe(false);
  });
  it('sans session ⇒ false, aucune lecture de base', async () => {
    etat.session = null;
    expect((await appeler()).corps).toEqual({ apercuPlan: false });
    expect(etat.lectures).toBe(0);
  });
  it('interrupteur absent / différent ⇒ false, même pour un admin, aucune lecture de base', async () => {
    for (const v of ['', '1', 'TRUE', ' true']) {
      vi.stubEnv('STUDIIO_APERCU_PLAN_ENABLED', v);
      expect((await appeler()).corps).toEqual({ apercuPlan: false });
    }
    expect(etat.lectures).toBe(0);
  });
  it('rôle non admin (user, null, administrateur…) ⇒ false', async () => {
    for (const role of ['user', null, 'administrateur', 'superadmin', undefined]) {
      etat.ligne = { role };
      expect((await appeler()).corps, String(role)).toEqual({ apercuPlan: false });
    }
  });
  it('interrupteur + rôle admin EN BASE ⇒ true', async () => {
    expect((await appeler()).corps).toEqual({ apercuPlan: true });
    expect(etat.lectures).toBe(1);
  });
  it('base en erreur / injoignable / ligne absente ⇒ false', async () => {
    etat.erreur = { message: 'x' };
    expect((await appeler()).corps).toEqual({ apercuPlan: false });
    etat.erreur = null; etat.jette = true;
    expect((await appeler()).corps).toEqual({ apercuPlan: false });
    etat.jette = false; etat.ligne = null;
    expect((await appeler()).corps).toEqual({ apercuPlan: false });
  });
  it('réponse = exactement { apercuPlan }, no-store, dynamique, aucun paramètre lu', async () => {
    const r = await appeler();
    expect(Object.keys(r.corps)).toEqual(['apercuPlan']);
    expect(r.cache).toMatch(/no-store/);
    expect(r.cache).toMatch(/private/);
    expect(route.dynamic).toBe('force-dynamic');
    expect(route.GET.length).toBe(0);
  });
});
