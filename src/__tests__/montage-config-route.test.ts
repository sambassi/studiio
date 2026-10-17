/**
 * M3-a PR2 — GET /api/creer/montage-config : la méthode B n'est proposée qu'à un
 * administrateur (rôle EN BASE) exempté de crédits, interrupteur serveur strict.
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

import { GET } from '@/app/api/creer/montage-config/route';
import * as route from '@/app/api/creer/montage-config/route';
import { politiqueDeLUtilisateur } from '@/lib/facturation/politique';

const ADMIN_EMAIL = 'contact.artboost@gmail.com';
async function appeler() {
  const r = await GET();
  return { status: r.status, corps: await r.json(), cache: r.headers.get('cache-control') ?? '' };
}

beforeEach(() => {
  etat.session = { user: { id: 'u1' } }; etat.ligne = { role: 'admin', email: 'a@b.c' }; etat.erreur = null; etat.lectures = 0; etat.jette = false;
  vi.stubEnv('STUDIIO_MONTAGE_PASSAGES_ENABLED', 'true');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('GET /api/creer/montage-config', () => {
  it('1. sans session ⇒ { passages: false }, aucune lecture de base', async () => {
    etat.session = null;
    expect((await appeler()).corps).toEqual({ passages: false });
    expect(etat.lectures).toBe(0);
  });

  it('2. interrupteur absent ou différent de "true" exactement ⇒ false, même pour un admin', async () => {
    for (const v of ['', '1', 'TRUE', ' true', 'true ', 'yes']) {
      vi.stubEnv('STUDIIO_MONTAGE_PASSAGES_ENABLED', v);
      expect((await appeler()).corps, JSON.stringify(v)).toEqual({ passages: false });
    }
    vi.unstubAllEnvs();
    delete process.env.STUDIIO_MONTAGE_PASSAGES_ENABLED;
    expect((await appeler()).corps).toEqual({ passages: false });
  });

  it('3. rôle user / null / administrateur / Admin-like inattendu ⇒ false', async () => {
    for (const role of ['user', null, 'administrateur', 'superadmin', undefined]) {
      etat.ligne = { role, email: 'x@y.z' };
      expect((await appeler()).corps, String(role)).toEqual({ passages: false });
    }
  });

  it('4. e-mail administrateur SANS rôle admin ⇒ false (rôle seul, règle du cahier)', async () => {
    etat.ligne = { role: 'user', email: ADMIN_EMAIL };
    expect((await politiqueDeLUtilisateur('u1')).politique).toBe('partner_cost_only'); // exempté pour la facturation…
    expect((await appeler()).corps).toEqual({ passages: false }); // …mais B n'est pas proposé
  });

  it('5. interrupteur "true" + rôle admin en base ⇒ true', async () => {
    expect((await appeler()).corps).toEqual({ passages: true });
  });

  it('6. base en erreur ou injoignable ⇒ false', async () => {
    etat.erreur = { message: 'boom' };
    expect((await appeler()).corps).toEqual({ passages: false });
    etat.erreur = null; etat.jette = true;
    expect((await appeler()).corps).toEqual({ passages: false });
    etat.jette = false; etat.ligne = null;
    expect((await appeler()).corps).toEqual({ passages: false });
  });

  it('7. GET sans paramètre : aucune query ni en-tête ne peut être lu (compte user ⇒ false)', async () => {
    expect(GET.length).toBe(0);
    etat.ligne = { role: 'user' };
    expect((await appeler()).corps).toEqual({ passages: false });
  });

  it('8. réponse = exactement { passages }, jamais mise en cache, rendu dynamique', async () => {
    const r = await appeler();
    expect(Object.keys(r.corps)).toEqual(['passages']);
    expect(r.status).toBe(200);
    expect(r.cache).toMatch(/no-store/);
    expect(r.cache).toMatch(/private/);
    expect(route.dynamic).toBe('force-dynamic');
  });

  it('9. invariant : passages true ⇒ politiqueDeLUtilisateur = partner_cost_only', async () => {
    const comptes = [
      { role: 'admin', email: 'a@b.c' }, { role: 'user', email: ADMIN_EMAIL }, { role: 'user', email: 'u@v.w' },
      { role: null, email: null }, { role: ' admin ', email: 'q@r.s' }, { role: 'ADMIN', email: 'q@r.s' },
    ];
    for (const c of comptes) {
      etat.ligne = c;
      const { corps } = await appeler();
      if (corps.passages) expect((await politiqueDeLUtilisateur('u1')).politique, JSON.stringify(c)).toBe('partner_cost_only');
    }
  });
});
