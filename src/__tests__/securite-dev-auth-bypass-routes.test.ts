/**
 * Deux routes lisaient `process.env.DEV_AUTH_BYPASS === '1'` en direct, sans
 * le verrou `NODE_ENV !== 'production'` de la garde centrale
 * (`isDevAuthBypassEnabled`, src/lib/auth/config.ts). Une variable oubliée
 * sur la production ouvrait donc l'écriture des feature flags et le montage
 * IA à n'importe qui.
 *
 * `DEV_AUTH_BYPASS` est figé au chargement du module : chaque cas repart d'un
 * registre de modules vide, avec l'environnement stubbé AVANT l'import.
 * La VRAIE garde est conservée ; seul `auth()` est doublé.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const authMock = vi.hoisted(() => vi.fn());
const ecritures = vi.hoisted(() => ({ from: [] as string[] }));

// `importOriginal` est mis en cache d'un `resetModules` à l'autre : la
// constante figée ne suivrait pas l'environnement stubbé. On ré-enregistre
// donc le double à chaque cas, en appliquant la VRAIE garde
// `isDevAuthBypassEnabled` à l'environnement du moment — exactement ce que
// fait le module réel à son chargement.
function doublerConfig() {
  vi.doMock('@/lib/auth/config', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/auth/config')>();
    return { ...actual, DEV_AUTH_BYPASS: actual.isDevAuthBypassEnabled(process.env), auth: authMock };
  });
}

vi.mock('@/lib/db/supabase', () => {
  const q: any = {
    upsert: () => Promise.resolve({ error: null }),
  };
  const client = {
    from: (t: string) => {
      ecritures.from.push(t);
      return q;
    },
  };
  return { supabaseAdmin: client, supabase: client };
});

const fetchEspion = vi.fn(async () => new Response('{}', { status: 500 }));

beforeEach(() => {
  vi.resetModules();
  doublerConfig();
  authMock.mockReset();
  authMock.mockResolvedValue(null);
  ecritures.from.length = 0;
  fetchEspion.mockClear();
  vi.stubGlobal('fetch', fetchEspion);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function post(url: string, corps: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    body: JSON.stringify(corps),
    headers: { 'content-type': 'application/json' },
  });
}

const CORPS_FLAG = { key: 'flag_test', value: true };
const CORPS_MONTAGE = { rushUrls: ['https://exemple.test/rush.mp4'] };

describe('Production + DEV_AUTH_BYPASS=1 : le contournement est MORT', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEV_AUTH_BYPASS', '1');
  });

  it('feature-flags : requête anonyme refusée, aucune écriture', async () => {
    const { POST } = await import('@/app/api/admin/settings/feature-flags/route');
    const res = await POST(post('/api/admin/settings/feature-flags', CORPS_FLAG));
    expect(res.status).toBe(403);
    expect(authMock).toHaveBeenCalled();
    expect(ecritures.from).toEqual([]);
  });

  it('agent/montage : requête anonyme refusée, aucun appel fournisseur', async () => {
    const { POST } = await import('@/app/api/agent/montage/route');
    const res = await POST(post('/api/agent/montage', CORPS_MONTAGE));
    expect(res.status).toBe(401);
    expect(authMock).toHaveBeenCalled();
    expect(fetchEspion).not.toHaveBeenCalled();
  });
});

describe('Hors production, comportement inchangé', () => {
  it('DEV_AUTH_BYPASS=1 en développement : feature-flags accepte sans session', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DEV_AUTH_BYPASS', '1');
    const { POST } = await import('@/app/api/admin/settings/feature-flags/route');
    const res = await POST(post('/api/admin/settings/feature-flags', CORPS_FLAG));
    expect(res.status).toBe(200);
    expect(ecritures.from).toEqual(['app_settings']);
  });

  it('DEV_AUTH_BYPASS=1 en développement : montage répond avec « dev-user »', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DEV_AUTH_BYPASS', '1');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const { POST } = await import('@/app/api/agent/montage/route');
    const res = await POST(post('/api/agent/montage', CORPS_MONTAGE));
    expect(res.status).toBe(200);
    expect((await res.json()).userId).toBe('dev-user');
  });

  it('sans drapeau en développement : anonyme refusé partout', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DEV_AUTH_BYPASS', '');
    const flags = await import('@/app/api/admin/settings/feature-flags/route');
    const montage = await import('@/app/api/agent/montage/route');
    expect((await flags.POST(post('/api/admin/settings/feature-flags', CORPS_FLAG))).status).toBe(403);
    expect((await montage.POST(post('/api/agent/montage', CORPS_MONTAGE))).status).toBe(401);
    expect(ecritures.from).toEqual([]);
  });

  it('admin authentifié : feature-flags écrit', async () => {
    vi.stubEnv('DEV_AUTH_BYPASS', '');
    authMock.mockResolvedValue({ user: { id: 'a', email: 'contact.artboost@gmail.com' } });
    const { POST } = await import('@/app/api/admin/settings/feature-flags/route');
    const res = await POST(post('/api/admin/settings/feature-flags', CORPS_FLAG));
    expect(res.status).toBe(200);
  });
});

describe('Source : plus aucune lecture brute de la variable', () => {
  it.each([
    'src/app/api/admin/settings/feature-flags/route.ts',
    'src/app/api/agent/montage/route.ts',
  ])('%s passe par la garde centrale', async (chemin) => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(join(process.cwd(), chemin), 'utf-8');
    expect(src).not.toContain('process.env.DEV_AUTH_BYPASS');
    expect(src).toMatch(/DEV_AUTH_BYPASS|isDevAuthBypassEnabled/);
  });
});
