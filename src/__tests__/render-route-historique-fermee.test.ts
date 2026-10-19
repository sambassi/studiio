/**
 * PR-A — l'ancienne route POST /api/render (Remotion historique) est FERMÉE.
 *
 * Elle débitait en « lu-puis-écrit » et remboursait en réécrivant l'ancien
 * solde. Désormais : 410 Gone, `Cache-Control: no-store`, et RIEN d'autre —
 * ni session, ni corps, ni base, ni crédits, ni stockage, ni Remotion, ni job,
 * ni fetch. Chaque dépendance possible est remplacée par une doublure qui
 * compte ses appels ; le moindre appel fait échouer le test.
 *
 * Discriminant : sur l'ancien code, `auth()` est appelé (session) puis
 * `supabase.from('users')`, et la réponse est 200/401/402 — jamais 410.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  appels: [] as string[],
  chargés: [] as string[],
  session: null as null | { user: { id: string } },
}));

const espion = (nom: string) => (...args: unknown[]) => {
  h.appels.push(nom);
  void args;
  return undefined as never;
};

vi.mock('@/lib/auth/config', () => {
  h.chargés.push('auth');
  return { auth: vi.fn(async () => { h.appels.push('auth'); return h.session; }) };
});
vi.mock('@/lib/db/supabase', () => {
  h.chargés.push('supabase');
  const client = {
    from: (t: string) => { h.appels.push(`from:${t}`); throw new Error('base interdite'); },
    rpc: (f: string) => { h.appels.push(`rpc:${f}`); throw new Error('rpc interdite'); },
    storage: { from: (b: string) => { h.appels.push(`storage:${b}`); throw new Error('stockage interdit'); } },
  };
  return { supabaseAdmin: client, supabase: client };
});
vi.mock('@/lib/credits/system', () => {
  h.chargés.push('credits');
  return { coutRenduVideo: vi.fn(async () => { h.appels.push('coutRenduVideo'); return 10; }) };
});
vi.mock('@/lib/facturation/exemption', () => {
  h.chargés.push('exemption');
  return { compteExempteDeCredits: vi.fn(async () => { h.appels.push('exemption'); return false; }) };
});
vi.mock('@/lib/render/worker', () => {
  h.chargés.push('worker');
  return {
    renderVideo: vi.fn(async () => { h.appels.push('renderVideo'); return { outputPath: '/tmp/x.mp4' }; }),
    completeJob: vi.fn(async () => { h.appels.push('completeJob'); }),
    failJob: vi.fn(async () => { h.appels.push('failJob'); }),
    getOrCreateBundle: vi.fn(async () => { h.appels.push('bundle'); return 'b'; }),
  };
});
vi.mock('@/lib/storage/upload', () => {
  h.chargés.push('storage-upload');
  return { uploadToStorage: vi.fn(async () => { h.appels.push('uploadToStorage'); return 'u'; }) };
});
vi.mock('@/lib/securite/medias-externes', () => {
  h.chargés.push('medias-externes');
  return { localiserProprietesLibres: vi.fn(async (p: unknown) => { h.appels.push('localiser'); return p; }) };
});
vi.mock('@remotion/renderer', () => {
  h.chargés.push('remotion-renderer');
  return { renderMedia: vi.fn(() => { h.appels.push('renderMedia'); }), selectComposition: vi.fn() };
});
vi.mock('@remotion/bundler', () => {
  h.chargés.push('remotion-bundler');
  return { bundle: vi.fn(() => { h.appels.push('bundle'); }) };
});
vi.mock('@/lib/rendus/service', () => {
  h.chargés.push('rendus');
  return { reserverRendu: espion('reserverRendu'), confirmerRendu: espion('confirmerRendu') };
});

const CHEMIN = resolve(__dirname, '../app/api/render/route.ts');
const CORPS_VALIDE = {
  compositionId: 'AfroboostReel',
  format: 'reel',
  inputProps: { title: 'Test', posterUrl: 'https://example.com/a.jpg' },
  title: 'Vidéo test',
};

function requete(corps: unknown = CORPS_VALIDE) {
  return new Request('http://localhost/api/render', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'authjs.session-token=x' },
    body: JSON.stringify(corps),
  });
}

let fetchEspion: ReturnType<typeof vi.fn>;

beforeEach(() => {
  h.appels.length = 0;
  h.session = null;
  fetchEspion = vi.fn(async () => { h.appels.push('fetch'); return new Response('{}'); });
  vi.stubGlobal('fetch', fetchEspion);
});

describe('POST /api/render — fermée (410 Gone)', () => {
  it('le chargement du module n’importe AUCUNE dépendance (ni auth, ni base, ni crédits, ni Remotion)', async () => {
    const mod = await import('@/app/api/render/route');
    expect(typeof mod.POST).toBe('function');
    expect(h.chargés).toEqual([]);
  });

  it('les seules méthodes exportées sont des 410 (POST) — aucun GET/PUT/PATCH/DELETE ajouté', async () => {
    const mod = (await import('@/app/api/render/route')) as Record<string, unknown>;
    const methodes = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].filter((m) => m in mod);
    expect(methodes).toEqual(['POST']);
  });

  it.each([
    ['sans session', null],
    ['avec session', { user: { id: 'u-1' } }],
  ] as const)('%s, corps valide : 410, no-store, et zéro effet de bord', async (_l, session) => {
    h.session = session as typeof h.session;
    const { POST } = await import('@/app/api/render/route');
    const req = requete();
    const res = await (POST as (r: Request) => Promise<Response>)(req);
    expect(res.status).toBe(410);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const j = await res.json();
    expect(j.success).toBe(false);
    expect(typeof j.error).toBe('string');
    expect(j).not.toHaveProperty('creditsCharged');
    expect(j).not.toHaveProperty('renderJob');
    // Le corps n'a même pas été lu.
    expect(req.bodyUsed).toBe(false);
    expect(h.appels).toEqual([]);
    expect(fetchEspion).not.toHaveBeenCalled();
    expect(h.chargés).toEqual([]);
  });

  it('corps invalide ou absent : toujours 410, toujours sans effet', async () => {
    const { POST } = await import('@/app/api/render/route');
    for (const req of [
      requete({ compositionId: 'Inconnue' }),
      new Request('http://localhost/api/render', { method: 'POST', body: 'pas du json' }),
      new Request('http://localhost/api/render', { method: 'POST' }),
    ]) {
      const res = await (POST as (r: Request) => Promise<Response>)(req);
      expect(res.status).toBe(410);
    }
    expect(h.appels).toEqual([]);
  });

  it('appels répétés : jamais d’état, jamais de débit cumulé', async () => {
    h.session = { user: { id: 'u-1' } };
    const { POST } = await import('@/app/api/render/route');
    for (let i = 0; i < 5; i++) {
      expect((await (POST as (r: Request) => Promise<Response>)(requete())).status).toBe(410);
    }
    expect(h.appels).toEqual([]);
  });
});

describe('Contrat de source — la route ne contient plus aucun débit', () => {
  const src = readFileSync(CHEMIN, 'utf-8');
  // On ne regarde que le CODE : les commentaires expliquent pourquoi elle est fermée.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('n’importe que next/server', () => {
    const imports = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(imports).toEqual(['next/server']);
    expect(code).not.toMatch(/import\s*\(/);
  });

  it.each([
    'credits', 'credit_transactions', '.from(', '.rpc(', 'auth(', 'req.json', 'render_jobs',
    'renderVideo', 'failJob', 'completeJob', 'uploadToStorage', 'waitUntil', 'maxDuration',
    'coutRenduVideo', 'compteExempteDeCredits', 'supabase', 'fetch(',
  ])('aucune trace de « %s »', (motif) => {
    expect(code).not.toContain(motif);
  });

  it('répond 410 avec Cache-Control: no-store', () => {
    expect(code).toContain('status: 410');
    expect(code).toMatch(/'Cache-Control':\s*'no-store'/);
  });
});
