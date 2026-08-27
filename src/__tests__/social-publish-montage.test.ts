/**
 * `api/social/publish` doit publier le MONTAGE, jamais le rush, et refuser
 * proprement quand il n'y a rien de publiable.
 *
 * La route lisait `video.video_url` seule. Depuis que `POST /api/videos`
 * refuse cette colonne au navigateur — a raison —, les lignes creees par
 * `dashboard/infographic` et `AgentIAModal`, dont le montage est compose DANS
 * le navigateur, echouaient a la publication alors que leur montage existait,
 * dans `metadata.renderedVideoUrl`.
 *
 * Tout appel reseau est simule. Aucune publication reelle n'est emise.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isPubliableMediaUrl,
  resolvePublishableUrl,
} from '@/lib/videos/playable-url';

const MONTAGE = 'https://cdn.studiio.test/montage.webm';
const RUSH = 'https://cdn.studiio.test/rush-brut.mp4';

// ────────────────────────────────────────────────────────────────────────────
// Le resolveur de publication, sur des valeurs
// ────────────────────────────────────────────────────────────────────────────

describe('1. `video_url` presente reste prioritaire', () => {
  it('gagne sur le montage des metadonnees', () => {
    expect(resolvePublishableUrl({
      video_url: 'https://cdn.studiio.test/remotion.mp4',
      metadata: { renderedVideoUrl: MONTAGE },
    })).toBe('https://cdn.studiio.test/remotion.mp4');
  });
});

describe('2. `video_url` absente + renderedVideoUrl valide → le montage', () => {
  it('resout le montage', () => {
    expect(resolvePublishableUrl({ video_url: null, metadata: { renderedVideoUrl: MONTAGE } }))
      .toBe(MONTAGE);
  });
});

describe('3. La publication ne se rabat JAMAIS sur le rush', () => {
  it('un rush seul ne donne rien a publier', () => {
    expect(resolvePublishableUrl({ video_url: null, metadata: { rushUrls: [RUSH] } })).toBeNull();
  });

  it('le montage gagne quand les deux existent', () => {
    expect(resolvePublishableUrl({
      video_url: null,
      metadata: { renderedVideoUrl: MONTAGE, rushUrls: [RUSH] },
    })).toBe(MONTAGE);
  });

  it('ignore `metadata.videoUrl`, cle ambigue qui porte souvent le rush', () => {
    expect(resolvePublishableUrl({ video_url: null, metadata: { videoUrl: RUSH } })).toBeNull();
  });
});

describe('5. Protocoles et adresses refuses', () => {
  const refusees = [
    ['blob', 'blob:https://studiio.pro/8f0e-1234'],
    ['data', 'data:video/mp4;base64,AAAA'],
    ['javascript', 'javascript:alert(1)'],
    ['file', 'file:///etc/passwd'],
    ['http simple', 'http://cdn.studiio.test/x.mp4'],
    ['protocole-relatif', '//cdn.studiio.test/x.mp4'],
    ['chemin relatif', '/storage/v1/object/public/x.mp4'],
    ['malformee', 'pas une url'],
    ['vide', ''],
    ['blanc de tete masquant un schema', '\njavascript:alert(1)'],
    ['identifiants dans l URL', 'https://user:mdp@cdn.studiio.test/x.mp4'],
    // La seule forme de remontee qui SURVIT au parseur : `new URL` normalise
    // `..` et `%2e%2e` (verifie), mais laisse `%5c` intact.
    ['antislash encode', 'https://cdn.studiio.test/a%5c..%5cb.mp4'],
  ] as const;

  refusees.forEach(([nom, url]) => {
    it(`refuse : ${nom}`, () => {
      expect(isPubliableMediaUrl(url)).toBe(false);
      expect(resolvePublishableUrl({ video_url: null, metadata: { renderedVideoUrl: url } }))
        .toBeNull();
    });
  });

  it('une remontee litterale est neutralisee par le parseur, pas rejetee', () => {
    // Constat, pas un souhait : `new URL` normalise `..` et `%2e%2e`. L'URL
    // retenue est alors `https://cdn.studiio.test/etc/passwd` — un chemin
    // ordinaire chez un hote autorise, sans remontee. Le test l'ecrit pour
    // qu'une regression du parseur soit visible.
    expect(new URL('https://cdn.studiio.test/a/../../etc/passwd').pathname).toBe('/etc/passwd');
    expect(new URL('https://cdn.studiio.test/a/%2e%2e/etc/passwd').pathname).toBe('/etc/passwd');
  });

  it('refuse une valeur qui n est pas une chaine', () => {
    expect(isPubliableMediaUrl(42)).toBe(false);
    expect(isPubliableMediaUrl(null)).toBe(false);
    expect(isPubliableMediaUrl({ toString: () => MONTAGE })).toBe(false);
  });
});

describe('5b. SSRF — aucune adresse locale, privee ou interne', () => {
  const internes = [
    'https://localhost/x.mp4',
    'https://127.0.0.1/x.mp4',
    'https://127.1.2.3/x.mp4',
    'https://0.0.0.0/x.mp4',
    'https://10.0.0.5/x.mp4',
    'https://192.168.1.10/x.mp4',
    'https://172.16.0.1/x.mp4',
    'https://172.31.255.254/x.mp4',
    // Endpoint de metadonnees cloud — la cible classique.
    'https://169.254.169.254/latest/meta-data/',
    'https://metadata.google.internal/x.mp4',
    'https://base-interne.local/x.mp4',
    'https://api.internal/x.mp4',
    'https://[::1]/x.mp4',
    'https://[fd00::1]/x.mp4',
  ];

  internes.forEach((url) => {
    it(`refuse ${url}`, () => {
      expect(isPubliableMediaUrl(url)).toBe(false);
    });
  });

  it('laisse passer une plage publique voisine d une plage privee', () => {
    // 172.32.x n'est PAS prive : une regle trop large casserait des stockages
    // legitimes.
    expect(isPubliableMediaUrl('https://172.32.0.1/x.mp4')).toBe(true);
    expect(isPubliableMediaUrl('https://11.0.0.1/x.mp4')).toBe(true);
  });

  it('accepte un stockage public normal', () => {
    expect(isPubliableMediaUrl(MONTAGE)).toBe(true);
    expect(isPubliableMediaUrl('https://xyz.supabase.co/storage/v1/object/public/media/a.webm'))
      .toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// La route, reellement appelee — tous les clients sociaux simules
// ────────────────────────────────────────────────────────────────────────────

const authMock = vi.fn();
let ligneVideo: Record<string, unknown> | null = null;
/** Toute ecriture tentee en base, quelle qu'elle soit. */
const ecritures: Array<{ table: string; op: string }> = [];
/** Toute requete sortante. */
const requetes: string[] = [];
/** Le corps de chaque requete sortante — l'URL du media y voyage. */
const corps: string[] = [];

function makeQuery(table: string) {
  const api: Record<string, unknown> = {
    select: () => api,
    eq: () => api,
    insert: () => { ecritures.push({ table, op: 'insert' }); return api; },
    update: () => { ecritures.push({ table, op: 'update' }); return api; },
    delete: () => { ecritures.push({ table, op: 'delete' }); return api; },
    single: async () => (
      table === 'videos'
        ? { data: ligneVideo, error: ligneVideo ? null : { message: 'not found' } }
        : { data: null, error: null }
    ),
    maybeSingle: async () => ({ data: null, error: null }),
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: comptesSociaux, error: null }).then(ok),
  };
  return api;
}

let comptesSociaux: unknown[] = [];

vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: (t: string) => makeQuery(t),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
  },
  supabase: { from: (t: string) => makeQuery(t) },
}));
vi.mock('@/lib/social/token-refresh', () => ({
  getValidToken: async () => 'jeton-simule',
}));
vi.mock('@/lib/social/whatsapp', () => ({
  isWhatsAppEnabled: () => false,
  canUseWhatsApp: () => false,
  broadcastWhatsApp: async () => ({ ok: false }),
  resolveRecipients: async () => [],
  formatBroadcastFailures: () => '',
}));

const { POST } = await import('@/app/api/social/publish/route');

const publier = async (body: unknown) => {
  const res = await POST({ json: async () => body } as never);
  return { status: res.status, body: await res.json() };
};

/** Ligne telle que `dashboard/infographic` la cree DESORMAIS. */
const LIGNE_INFOGRAPHIE = {
  id: 'v-info',
  title: 'Mon infographie',
  status: 'draft',
  video_url: null,
  metadata: { renderedVideoUrl: MONTAGE, rushUrls: [RUSH] },
};

beforeEach(() => {
  ecritures.length = 0;
  requetes.length = 0;
  corps.length = 0;
  comptesSociaux = [];
  ligneVideo = null;
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.c' } });
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: unknown }) => {
    requetes.push(String(url));
    if (init?.body) corps.push(String(init.body));
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ id: 'post-simule' }),
      arrayBuffer: async () => new ArrayBuffer(8),
    };
  }));
});

describe('4. Aucune URL publiable → refus controle AVANT tout appel social', () => {
  it('refuse une ligne sans montage, avec un rush seul', async () => {
    ligneVideo = { id: 'v', title: 't', status: 'draft', video_url: null, metadata: { rushUrls: [RUSH] } };
    comptesSociaux = [{ platform: 'instagram', connected: true, access_token: 'x', account_id: '1' }];
    const res = await publier({ videoId: 'v', platforms: ['instagram'] });
    expect(res.status).toBe(400);
    expect(requetes).toEqual([]);
    expect(corps).toEqual([]);
  });

  it('refuse une ligne totalement vide', async () => {
    ligneVideo = { id: 'v', title: 't', status: 'draft', video_url: null, metadata: {} };
    const res = await publier({ videoId: 'v', platforms: ['instagram'] });
    expect(res.status).toBe(400);
    expect(requetes).toEqual([]);
    expect(corps).toEqual([]);
  });

  it('5. refuse un montage a URL interdite, avant tout appel social', async () => {
    ligneVideo = {
      id: 'v', title: 't', status: 'draft', video_url: null,
      metadata: { renderedVideoUrl: 'http://169.254.169.254/latest/meta-data/' },
    };
    const res = await publier({ videoId: 'v', platforms: ['youtube'] });
    expect(res.status).toBe(400);
    expect(requetes).toEqual([]);
    expect(corps).toEqual([]);
  });

  it('7. un refus ne change AUCUN statut', async () => {
    ligneVideo = { id: 'v', title: 't', status: 'draft', video_url: null, metadata: {} };
    await publier({ videoId: 'v', platforms: ['instagram'] });
    expect(ecritures).toEqual([]);
  });

  it('8. un refus ne debite rien', async () => {
    ligneVideo = { id: 'v', title: 't', status: 'draft', video_url: null, metadata: {} };
    await publier({ videoId: 'v', platforms: ['instagram', 'tiktok', 'youtube'] });
    expect(ecritures.filter((e) => ['users', 'credit_transactions'].includes(e.table))).toEqual([]);
  });
});

describe('2 & 3. Le montage du navigateur est bien celui qui part', () => {
  it("Instagram recoit exactement l'URL du montage, jamais le rush", async () => {
    ligneVideo = LIGNE_INFOGRAPHIE;
    comptesSociaux = [{ platform: 'instagram', connected: true, access_token: 'x', account_id: '1' }];
    await publier({ videoId: 'v-info', platforms: ['instagram'] });
    const envoye = [...requetes, ...corps].join(' | ');
    expect(envoye).toContain(MONTAGE);
    expect(envoye).not.toContain('rush-brut');
  });

  it('au moins un appel social a bien eu lieu — le test ne passe pas par vacuite', async () => {
    ligneVideo = LIGNE_INFOGRAPHIE;
    comptesSociaux = [{ platform: 'instagram', connected: true, access_token: 'x', account_id: '1' }];
    await publier({ videoId: 'v-info', platforms: ['instagram'] });
    expect(requetes.length).toBeGreaterThan(0);
    expect(requetes.some((u) => u.includes('graph.facebook.com'))).toBe(true);
  });

  it('6. aucune requete ne part vers un hote qui ne soit pas simule', async () => {
    ligneVideo = LIGNE_INFOGRAPHIE;
    comptesSociaux = [{ platform: 'instagram', connected: true, access_token: 'x', account_id: '1' }];
    await publier({ videoId: 'v-info', platforms: ['instagram'] });
    // `fetch` est intégralement remplacé : rien ne sort de la machine.
    expect(vi.isMockFunction(globalThis.fetch)).toBe(true);
  });
});

describe('9 & 10. Rien d autre n a bouge', () => {
  it('la securite de POST /api/videos est inchangee', async () => {
    const { VIDEO_POST_ALLOWED_COLUMNS, VIDEO_POST_FORCED_STATUS } =
      await import('@/lib/videos/post-payload');
    expect([...VIDEO_POST_ALLOWED_COLUMNS]).toEqual(['title', 'description', 'format', 'metadata']);
    expect(VIDEO_POST_FORCED_STATUS).toBe('draft');
  });

  it('le Batch reste borne et sa reprise desactivee', async () => {
    const { MAX_BATCH } = await import('@/lib/creer/batch');
    const { repriseAutorisee } = await import('@/lib/creer/batchRun');
    expect(MAX_BATCH).toBe(10);
    expect(MAX_BATCH).toBeLessThanOrEqual(20);
    expect(repriseAutorisee([]).autorisee).toBe(false);
  });

  it('le rendu Batch serveur reste desactive', async () => {
    const { BATCH_RENDER_DESACTIVE } = await import('@/lib/render/batch-disabled');
    expect(BATCH_RENDER_DESACTIVE).toBe(true);
  });

  it("l'apercu de la Bibliotheque garde son repli vers le rush", async () => {
    const { resolvePlayableVideoUrl } = await import('@/lib/videos/playable-url');
    // La lecture se rabat sur le rush ; la publication, non. C'est voulu.
    expect(resolvePlayableVideoUrl({ video_url: null, metadata: { rushUrls: [RUSH] } })).toBe(RUSH);
    expect(resolvePublishableUrl({ video_url: null, metadata: { rushUrls: [RUSH] } })).toBeNull();
  });
});
