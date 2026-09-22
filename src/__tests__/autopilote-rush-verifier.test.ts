import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Hygiène de la banque — `POST /api/autopilot/rush/verifier`.
 *
 * L'écran demande, au chargement, si chaque rush est toujours accessible. La
 * route HEAD chaque URL côté serveur et rend un booléen par URL.
 *
 * Ce que ce fichier verrouille :
 * - session requise (401) ;
 * - seuls les rushes RÉELLEMENT dans la banque du compte sont contactés — une
 *   URL hors compte est refusée, jamais HEADée (pas de sondeur d'URL
 *   arbitraire au nom du serveur) ;
 * - un 404/410 rend « expiré » (false), le reste « accessible » (true), via la
 *   même `rushEncorePresent` que le cron.
 *
 * ⚠️ AUCUN HEAD RÉEL : `rushEncorePresent` est doublé.
 */

const authMock = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));

let banque: string[];
vi.mock('@/lib/db/supabase', () => {
  const from = () => {
    const chaine: Record<string, unknown> = {};
    const self = () => chaine;
    Object.assign(chaine, {
      select: self, eq: self,
      async limit() { return { data: [{ rush_urls: banque }], error: null }; },
    });
    return chaine;
  };
  return { supabaseAdmin: { from }, supabase: { from } };
});

// Le HEAD est doublé : on rend « expiré » pour toute URL contenant `dead`.
const rushEncorePresent = vi.fn(async (url: string) => !url.includes('dead'));
vi.mock('@/lib/autopilot/poster', () => ({
  rushEncorePresent: (url: string) => rushEncorePresent(url),
}));

const A = 'https://projet.supabase.co/storage/v1/object/public/media/u/a.mp4';
const DEAD = 'https://projet.supabase.co/storage/v1/object/public/media/u/dead.mp4';
const HORS_COMPTE = 'https://ailleurs.test/x.mp4';

async function chargerRoute() {
  vi.resetModules();
  return import('@/app/api/autopilot/rush/verifier/route');
}

function requete(body: unknown) {
  return { json: async () => body } as unknown as import('next/server').NextRequest;
}

beforeEach(() => {
  authMock.mockResolvedValue({ user: { id: 'u1' } });
  banque = [A, DEAD];
  rushEncorePresent.mockClear();
});

describe('Session', () => {
  it('sans session : 401, rien n est HEADé', async () => {
    authMock.mockResolvedValue(null);
    const { POST } = await chargerRoute();
    const res = await POST(requete({ urls: [A] }));
    expect(res.status).toBe(401);
    expect(rushEncorePresent).not.toHaveBeenCalled();
  });
});

describe('Vérification', () => {
  it('rend un booléen par rush du compte : accessible / expiré', async () => {
    const { POST } = await chargerRoute();
    const corps = await (await POST(requete({ urls: [A, DEAD] }))).json();
    expect(corps.success).toBe(true);
    expect(corps.resultats[A]).toBe(true);
    expect(corps.resultats[DEAD]).toBe(false);
  });

  it('une URL hors compte est refusée, jamais contactée', async () => {
    const { POST } = await chargerRoute();
    const corps = await (await POST(requete({ urls: [A, HORS_COMPTE] }))).json();
    // Refusée : listée à part, absente des résultats, et jamais HEADée.
    expect(corps.refusees).toContain(HORS_COMPTE);
    expect(corps.resultats[HORS_COMPTE]).toBeUndefined();
    expect(rushEncorePresent).not.toHaveBeenCalledWith(HORS_COMPTE);
    // La légitime, elle, est bien vérifiée.
    expect(corps.resultats[A]).toBe(true);
  });

  it('un corps vide ne HEAD rien et ne lève pas', async () => {
    const { POST } = await chargerRoute();
    const corps = await (await POST(requete({}))).json();
    expect(corps.success).toBe(true);
    expect(corps.resultats).toEqual({});
    expect(rushEncorePresent).not.toHaveBeenCalled();
  });
});
