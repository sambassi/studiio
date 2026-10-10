import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import React from 'react';
import { I18nContext } from '@/i18n/client';

/**
 * Tableau de bord : les chiffres affichés sont ceux du compte connecté
 * (réseau simulé), jamais les anciennes valeurs codées en dur
 * (1250 crédits, 24 vidéos, 12 publications, 48.2K vues, tendances).
 */

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'user-1', name: 'Awa Diop' } }, status: 'authenticated' }),
}));
vi.mock('@/components/dashboard/RecentVideos', () => ({ RecentVideos: () => null }));

const { default: DashboardPage } = await import('@/app/dashboard/page');

const messages = JSON.parse(readFileSync(resolve(__dirname, '../../messages/fr.json'), 'utf-8'));

function rendre() {
  return render(
    <I18nContext.Provider value={{ locale: 'fr', messages, setLocale: () => {} }}>
      <DashboardPage />
    </I18nContext.Provider>,
  );
}

type Reponses = Record<string, { ok: boolean; body: unknown } | 'rejet'>;

function fauxFetch(reponses: Reponses) {
  return vi.fn(async (entree: RequestInfo | URL) => {
    const r = reponses[String(entree)];
    if (!r || r === 'rejet') throw new Error('réseau');
    return { ok: r.ok, status: r.ok ? 200 : 500, json: async () => r.body } as Response;
  });
}

/** Valeur affichée dans la carte dont le libellé est `libelle`. */
function valeurDe(libelle: string): string {
  const carte = screen.getByText(libelle).parentElement as HTMLElement;
  return within(carte).getByText((_, el) => el?.tagName === 'P' && el.className.includes('text-3xl')).textContent ?? '';
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Tableau de bord — chiffres réels', () => {
  it('affiche le solde, les vidéos et les publications du compte', async () => {
    const fetchMock = fauxFetch({
      '/api/credits/balance': { ok: true, body: { ok: true, politique: 'credits', balance: 10 } },
      '/api/user/stats': { ok: true, body: { ok: true, videos: 3, published: 7, scheduled: 2 } },
    });
    vi.stubGlobal('fetch', fetchMock);
    rendre();

    await waitFor(() => expect(valeurDe('Crédits restants')).toBe('10'));
    expect(valeurDe('Vidéos créées')).toBe('3');
    expect(valeurDe('Publications publiées')).toBe('7');
    expect(valeurDe('Publications programmées')).toBe('2');
    // Même source que la barre du haut.
    expect(fetchMock).toHaveBeenCalledWith('/api/credits/balance');
    // Le bloc « Crédits disponibles » montre le même solde.
    const bloc = screen.getByText('Crédits disponibles').parentElement as HTMLElement;
    expect(within(bloc).getByText('10')).toBeTruthy();
  });

  it("n'affiche plus aucun chiffre inventé ni la carte des vues", async () => {
    vi.stubGlobal('fetch', fauxFetch({
      '/api/credits/balance': { ok: true, body: { ok: true, balance: 10 } },
      '/api/user/stats': { ok: true, body: { ok: true, videos: 0, published: 0, scheduled: 0 } },
    }));
    const { container } = rendre();
    await waitFor(() => expect(valeurDe('Crédits restants')).toBe('10'));

    const texte = container.textContent ?? '';
    for (const faux of ['1250', '1 250', '1,250', '48.2K', 'Vues totales', 'cette semaine', "d'augmentation", '↑']) {
      expect(texte).not.toContain(faux);
    }
  });

  it('affiche « — » quand les API échouent', async () => {
    vi.stubGlobal('fetch', fauxFetch({
      '/api/credits/balance': { ok: false, body: { ok: false, balance: null, error: 'solde indisponible' } },
      '/api/user/stats': 'rejet',
    }));
    rendre();

    await waitFor(() => expect(valeurDe('Crédits restants')).toBe('—'));
    expect(valeurDe('Vidéos créées')).toBe('—');
    expect(valeurDe('Publications publiées')).toBe('—');
    expect(valeurDe('Publications programmées')).toBe('—');
    const bloc = screen.getByText('Crédits disponibles').parentElement as HTMLElement;
    expect(within(bloc).getByText('—')).toBeTruthy();
  });

  it('un compte sans crédits Studiio affiche le libellé, pas un nombre', async () => {
    vi.stubGlobal('fetch', fauxFetch({
      '/api/credits/balance': { ok: true, body: { ok: true, balance: null, libelle: 'Coûts partenaires uniquement' } },
      '/api/user/stats': { ok: true, body: { ok: true, videos: 1, published: null, scheduled: 4 } },
    }));
    rendre();

    await waitFor(() => expect(screen.getByText('Coûts partenaires uniquement')).toBeTruthy());
    expect(valeurDe('Crédits restants')).toBe('—');
    expect(valeurDe('Vidéos créées')).toBe('1');
    expect(valeurDe('Publications publiées')).toBe('—');
  });
});

// ── Route serveur /api/user/stats ─────────────────────────────────────────

const authMock = vi.fn();
const filtres: Array<{ table: string; eq: Array<[string, unknown]> }> = [];
let resultats: Record<string, { count: number | null; error: unknown }> = {};

function requete(table: string) {
  const f = { table, eq: [] as Array<[string, unknown]> };
  filtres.push(f);
  const q: any = {
    select: () => q,
    eq: (col: string, val: unknown) => { f.eq.push([col, val]); return q; },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
      const statut = f.eq.find(([c]) => c === 'status')?.[1];
      const cle = statut ? `${table}:${statut}` : table;
      return Promise.resolve(resultats[cle] ?? { count: null, error: 'absent' }).then(res, rej);
    },
  };
  return q;
}

vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));
vi.mock('@/lib/db/supabase', () => ({ supabaseAdmin: { from: (t: string) => requete(t) } }));

const { GET } = await import('@/app/api/user/stats/route');

describe('GET /api/user/stats', () => {
  beforeEach(() => { filtres.length = 0; resultats = {}; authMock.mockReset(); });

  it('refuse un visiteur anonyme', async () => {
    authMock.mockResolvedValue(null);
    const res = await GET({} as any);
    expect(res.status).toBe(401);
    expect(filtres).toHaveLength(0);
  });

  it("compte uniquement les lignes de l'utilisateur connecté", async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    resultats = {
      videos: { count: 3, error: null },
      'scheduled_posts:published': { count: 7, error: null },
      'scheduled_posts:scheduled': { count: 2, error: null },
    };
    const res = await GET({} as any);
    expect(await res.json()).toEqual({ ok: true, videos: 3, published: 7, scheduled: 2 });
    expect(filtres).toHaveLength(3);
    for (const f of filtres) expect(f.eq).toContainEqual(['user_id', 'user-1']);
  });

  it('renvoie null, jamais 0, quand un compteur échoue', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    resultats = {
      videos: { count: null, error: { message: 'boom' } },
      'scheduled_posts:published': { count: 0, error: null },
      'scheduled_posts:scheduled': { count: 5, error: null },
    };
    const res = await GET({} as any);
    expect(await res.json()).toEqual({ ok: true, videos: null, published: 0, scheduled: 5 });
  });
});
