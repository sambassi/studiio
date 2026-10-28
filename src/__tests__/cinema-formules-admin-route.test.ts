// @vitest-environment node
/**
 * /api/admin/cinema-formules — n'ecrit QUE `cinema_formules`, jamais un prix.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'fs';

const etat = vi.hoisted(() => ({
  admin: true,
  tables: [] as string[],
  ecrits: [] as Array<{ table: string; ligne: Record<string, unknown> }>,
  lignes: [] as Array<Record<string, unknown>>,
  erreurLecture: null as null | { code: string; message: string },
  erreurEcriture: null as null | { code: string; message: string },
  journal: [] as unknown[],
}));

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      etat.tables.push(table);
      return {
        select: async () => (etat.erreurLecture ? { data: null, error: etat.erreurLecture } : { data: etat.lignes, error: null }),
        upsert: async (ligne: Record<string, unknown>) => {
          if (etat.erreurEcriture) return { error: etat.erreurEcriture };
          etat.ecrits.push({ table, ligne });
          return { error: null };
        },
      };
    },
  },
}));
vi.mock('@/lib/admin', () => ({
  requireAdmin: async () => (etat.admin
    ? { error: null, session: { user: { email: 'admin@studiio.pro' } } }
    : { error: new Response(null, { status: 403 }), session: null }),
  logAdminAction: async (x: unknown) => { etat.journal.push(x); },
}));
vi.mock('@/lib/pricing/fetch', () => ({
  getPlans: async () => [
    { key: 'free', name: 'Gratuit', price_cents: 0 },
    { key: 'pro', name: 'Pro', price_cents: 4900 },
  ],
}));

const route = await import('@/app/api/admin/cinema-formules/route');

const FORMULE = {
  planKey: 'pro', inclus: true, filmsParMois: 30, secondesParMois: 1800, dureeMaxFilmS: 360,
  qualites: ['standard'], fonctionnalites: ['image_ia'], budgetUsdParMois: 10, renouvellement: 'periode_abonnement',
};
const put = (corps: unknown) => route.PUT(new NextRequest('https://studiio.pro/api/admin/cinema-formules', {
  method: 'PUT', body: JSON.stringify(corps),
}));

beforeEach(() => {
  etat.admin = true; etat.tables = []; etat.ecrits = []; etat.lignes = []; etat.journal = [];
  etat.erreurLecture = null; etat.erreurEcriture = null;
});

describe('GET', () => {
  it('chaque formule existante, NON incluse tant qu’elle n’est pas configuree, prix en lecture', async () => {
    const r = await (await route.GET()).json();
    expect(r.data.migrationAppliquee).toBe(true);
    expect(r.data.formules.map((f: { planKey: string }) => f.planKey)).toEqual(['free', 'pro']);
    expect(r.data.formules[1]).toMatchObject({ prixMensuelCentimes: 4900, configuree: false, formule: { inclus: false } });
  });

  it('migration absente : le dit, au lieu d’une liste vide rassurante', async () => {
    etat.erreurLecture = { code: '42P01', message: 'relation "cinema_formules" does not exist' };
    const r = await (await route.GET()).json();
    expect(r.data.migrationAppliquee).toBe(false);
    expect(r.data.message).toMatch(/non appliquee/);
  });

  it('non admin : refuse', async () => {
    etat.admin = false;
    expect((await route.GET()).status).toBe(403);
  });
});

describe('PUT', () => {
  it('enregistre dans cinema_formules SEULEMENT, et journalise l’action', async () => {
    const res = await put(FORMULE);
    expect(res.status).toBe(200);
    expect(etat.ecrits).toHaveLength(1);
    expect(etat.ecrits[0]).toMatchObject({ table: 'cinema_formules', ligne: { plan_key: 'pro', films_par_mois: 30, maj_par: 'admin@studiio.pro' } });
    expect(etat.tables).not.toContain('plans');
    expect(etat.journal).toHaveLength(1);
  });

  it('saisie invalide : 400 avec TOUTES les erreurs, rien n’est ecrit', async () => {
    const res = await put({ ...FORMULE, filmsParMois: -1, qualites: ['8k'] });
    expect(res.status).toBe(400);
    expect((await res.json()).erreurs.length).toBeGreaterThanOrEqual(2);
    expect(etat.ecrits).toHaveLength(0);
  });

  it('formule qui n’existe pas dans les tarifs : refusee', async () => {
    expect((await put({ ...FORMULE, planKey: 'platinum' })).status).toBe(400);
    expect(etat.ecrits).toHaveLength(0);
  });

  it('migration absente : 503, rien n’est pretendu enregistre', async () => {
    etat.erreurEcriture = { code: 'PGRST205', message: 'Could not find the table in the schema cache' };
    expect((await put(FORMULE)).status).toBe(503);
    expect(etat.journal).toHaveLength(0);
  });

  it('non admin : refuse, rien n’est ecrit', async () => {
    etat.admin = false;
    expect((await put(FORMULE)).status).toBe(403);
    expect(etat.ecrits).toHaveLength(0);
  });
});

describe('frontieres', () => {
  it('ni la route ni le depot ne touchent Stripe ou la table des prix', () => {
    for (const f of ['src/app/api/admin/cinema-formules/route.ts', 'src/lib/cinema/abonnement/depot.ts']) {
      const s = readFileSync(f, 'utf8');
      expect(s, f).not.toMatch(/from\s+['"][^'"]*stripe[^'"]*['"]/i);
      expect(s, f).not.toMatch(/from\(['"]plans['"]\)/);
    }
  });
});
