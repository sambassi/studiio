import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Le cron de nettoyage, DE BOUT EN BOUT, sur les rushes de brouillon.
 *
 * Ce que ce fichier prouve, et qu'aucune assertion de texte ne peut prouver :
 *   - un rush de brouillon EXPIRÉ par la rétention (vidéo > 24 h) mais
 *     RÉFÉRENCÉ dans `creer_draft_rushes` n'est PAS supprimé ;
 *   - un rush voisin, tout aussi expiré mais NON référencé, l'est ;
 *   - si `creer_draft_rushes` est illisible, le cron ne supprime RIEN (503).
 *
 * Le stockage et PostgREST sont simulés ; le journal des `remove` est la seule
 * preuve qui vaille.
 */

const TROIS_JOURS = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

// Résultats programmables des quatre lectures d'exemption.
let scheduledPosts: unknown[] = [];
let autopilotRows: unknown[] = [];
let rushesRows: unknown[] = [];
let analysesRows: unknown[] = [];
let draftRows: unknown[] | null = [];
let draftError: unknown = null;

// Contenu simulé du stockage : prefixe → entrées.
let listing: Record<string, Array<{ name: string; id?: string; created_at?: string }>> = {};
const removed: string[] = [];

function tableResult(table: string): { data: unknown; error: unknown } {
  switch (table) {
    case 'scheduled_posts': return { data: scheduledPosts, error: null };
    case 'autopilot_config': return { data: autopilotRows, error: null };
    case 'rushes': return { data: rushesRows, error: null };
    case 'rush_analyses': return { data: analysesRows, error: null };
    case 'creer_draft_rushes': return { data: draftRows, error: draftError };
    default: throw new Error(`table inattendue: ${table}`);
  }
}

function builder(table: string) {
  const api: Record<string, unknown> = {
    select: () => api,
    in: () => api,
    eq: () => api,
    gt: () => api,
    order: () => api,
    range: () => api,
    then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
      Promise.resolve(tableResult(table)).then(onOk, onErr),
  };
  return api;
}

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => builder(table),
    storage: {
      from: (bucket: string) => ({
        list: async (prefix: string) => ({ data: listing[`${bucket}:${prefix}`] ?? [], error: null }),
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://studiio.pro/storage/v1/object/public/${bucket}/${path}` },
        }),
        remove: async (paths: string[]) => { removed.push(...paths); return { data: paths.map(() => ({})), error: null }; },
      }),
    },
  },
}));

const { GET } = await import('@/app/api/cron/cleanup-media/route');

const req = () => ({ headers: { get: (k: string) => (k === 'authorization' ? 'Bearer secret' : null) } }) as never;

beforeEach(() => {
  process.env.CRON_SECRET = 'secret';
  scheduledPosts = [];
  autopilotRows = [];
  rushesRows = [];
  analysesRows = [];
  draftRows = [];
  draftError = null;
  removed.length = 0;
  // Un dossier `media/u1/library` avec deux rushes vidéo tous deux expirés.
  listing = {
    'media:': [{ name: 'u1' }],
    'media:u1': [{ name: 'library' }],
    'media:u1/library': [
      { name: 'recent.mp4', id: 'r', created_at: TROIS_JOURS },
      { name: 'old.mp4', id: 'o', created_at: TROIS_JOURS },
    ],
    'audio:': [],
  };
});

describe('Rétention vs brouillon', () => {
  it('le rush de brouillon référencé survit, le voisin non référencé est supprimé', async () => {
    draftRows = [{ object_key: 'media/u1/library/recent.mp4' }];
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    // Le rush protégé n'est PAS supprimé ; l'autre l'est.
    expect(removed).toContain('u1/library/old.mp4');
    expect(removed).not.toContain('u1/library/recent.mp4');
    expect(body.exemptes.brouillons).toBe(1);
    expect(body.deleted).toBe(1);
  });

  it('sans référence de brouillon, les deux rushes expirés partent', async () => {
    draftRows = [];
    const res = await GET(req());
    await res.json();
    expect(removed).toContain('u1/library/old.mp4');
    expect(removed).toContain('u1/library/recent.mp4');
  });

  it('si les brouillons sont illisibles → 503 et AUCUNE suppression', async () => {
    draftError = { message: 'base injoignable' };
    draftRows = null;
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(removed).toHaveLength(0);
  });

  it('sans le bon secret → 401', async () => {
    const res = await GET({ headers: { get: () => 'Bearer faux' } } as never);
    expect(res.status).toBe(401);
    expect(removed).toHaveLength(0);
  });
});
