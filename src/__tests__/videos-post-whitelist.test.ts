/**
 * `POST /api/videos` : liste blanche, identite imposee, statut impose.
 *
 * La route faisait `.insert({ ...body, user_id, status: body.status || 'draft' })`.
 * Un porteur de session pouvait donc creer une video `completed` sans qu'aucun
 * rendu n'ait eu lieu, avec l'URL de son choix et un cout facture arbitraire.
 *
 * Ces tests APPELLENT la route et inspectent l'objet reellement transmis a
 * PostgREST — pas le source. Grepper aurait laisse passer une regression ou la
 * liste blanche est bien importee mais jamais appliquee.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  VIDEO_POST_ALLOWED_COLUMNS,
  VIDEO_POST_FORBIDDEN_COLUMNS,
  VIDEO_POST_FORCED_STATUS,
} from '@/lib/videos/post-payload';

const authMock = vi.fn();

interface Call {
  table: string;
  op: 'read' | 'insert' | 'write' | 'delete';
  values?: Record<string, unknown>;
}

const calls: Call[] = [];
let insertRow: unknown = { id: 'video-1' };
let insertError: unknown = null;

function makeQuery(table: string) {
  const call: Call = { table, op: 'read' };
  const api: Record<string, unknown> = {
    select: () => api,
    insert: (values: Record<string, unknown>) => {
      call.op = 'insert';
      call.values = values;
      return api;
    },
    update: (values: Record<string, unknown>) => {
      call.op = 'write';
      call.values = values;
      return api;
    },
    delete: () => { call.op = 'delete'; return api; },
    eq: () => api,
    order: () => api,
    range: () => api,
    single: async () => { calls.push(call); return { data: insertRow, error: insertError }; },
    maybeSingle: async () => { calls.push(call); return { data: insertRow, error: insertError }; },
  };
  return api;
}

vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: (table: string) => makeQuery(table) },
  supabase: { from: (table: string) => makeQuery(table) },
}));

const { POST } = await import('@/app/api/videos/route');

const post = async (body: unknown) => {
  const res = await POST({ json: async () => body } as never);
  return { status: res.status, body: await res.json() };
};

const inserts = () => calls.filter((c) => c.op === 'insert');
const lastInsert = () => inserts().at(-1);
const valuesOf = () => lastInsert()?.values ?? {};

beforeEach(() => {
  calls.length = 0;
  insertRow = { id: 'video-1' };
  insertError = null;
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'user-legitime' } });
});

describe('Acces', () => {
  it('401 sans session, et AUCUNE requete', async () => {
    authMock.mockResolvedValue(null);
    const res = await post({ title: 'x' });
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe('user_id vient TOUJOURS de la session', () => {
  it('un user_id du corps ne remplace pas celui de la session', async () => {
    await post({ title: 'x', user_id: 'victime' });
    expect(valuesOf().user_id).toBe('user-legitime');
  });

  it('meme accompagne de toutes les autres cles interdites', async () => {
    const hostile: Record<string, unknown> = { title: 'x' };
    for (const col of VIDEO_POST_FORBIDDEN_COLUMNS) hostile[col] = 'valeur-hostile';
    await post(hostile);
    expect(valuesOf().user_id).toBe('user-legitime');
  });
});

describe('Le statut est IMPOSE a la creation', () => {
  it("vaut 'draft' quand le client n'en demande pas", async () => {
    await post({ title: 'x' });
    expect(valuesOf().status).toBe('draft');
    expect(VIDEO_POST_FORCED_STATUS).toBe('draft');
  });

  it("refuse status: 'completed' — une ligne ne nait pas terminee", async () => {
    await post({ title: 'x', status: 'completed', video_url: 'https://ailleurs/x.mp4' });
    expect(valuesOf().status).toBe('draft');
  });

  it("refuse status: 'published'", async () => {
    await post({ title: 'x', status: 'published' });
    expect(valuesOf().status).toBe('draft');
  });

  it("refuse status: 'rendering' — seul le worker rend", async () => {
    await post({ title: 'x', status: 'rendering' });
    expect(valuesOf().status).toBe('draft');
  });
});

describe('Colonnes interdites', () => {
  it('AUCUNE colonne nommement interdite n atteint PostgREST', async () => {
    const hostile: Record<string, unknown> = { title: 'ok' };
    for (const col of VIDEO_POST_FORBIDDEN_COLUMNS) hostile[col] = 'valeur-hostile';
    await post(hostile);
    const values = valuesOf();
    for (const col of VIDEO_POST_FORBIDDEN_COLUMNS) {
      if (col === 'user_id' || col === 'status') {
        // Poses par le serveur, jamais repris du corps.
        expect(values[col], `${col} doit venir du serveur`).not.toBe('valeur-hostile');
        continue;
      }
      expect(values, `${col} ne doit pas etre ecrit`).not.toHaveProperty(col);
    }
  });

  it('video_url du client est refuse', async () => {
    await post({ title: 'x', video_url: 'https://ailleurs/x.mp4' });
    expect(valuesOf()).not.toHaveProperty('video_url');
  });

  it('credits_used du client est refuse', async () => {
    await post({ title: 'x', credits_used: 0 });
    expect(valuesOf()).not.toHaveProperty('credits_used');
  });

  it('render_job_id du client est refuse', async () => {
    await post({ title: 'x', render_job_id: 'job-d-un-tiers' });
    expect(valuesOf()).not.toHaveProperty('render_job_id');
  });

  it('thumbnail_url du client est refuse', async () => {
    await post({ title: 'x', thumbnail_url: 'https://ailleurs/x.jpg' });
    expect(valuesOf()).not.toHaveProperty('thumbnail_url');
  });

  it('un id impose par le client est refuse', async () => {
    await post({ title: 'x', id: 'id-choisi' });
    expect(valuesOf()).not.toHaveProperty('id');
  });

  it('les cles inconnues sont ecartees silencieusement', async () => {
    const res = await post({ title: 'x', cleQuiNExistePas: 1 });
    expect(res.status).not.toBe(422);
    expect(valuesOf()).not.toHaveProperty('cleQuiNExistePas');
  });
});

describe('Champs autorises', () => {
  it('laisse passer exactement la liste blanche, plus les deux champs serveur', async () => {
    await post({
      title: 'Mon titre',
      description: 'ma description',
      format: 'tv',
      metadata: { a: 1 },
    });
    expect(Object.keys(valuesOf()).sort()).toEqual(
      ['description', 'format', 'metadata', 'status', 'title', 'user_id'],
    );
  });

  it('la liste blanche reste minimale', () => {
    expect([...VIDEO_POST_ALLOWED_COLUMNS]).toEqual(['title', 'description', 'format', 'metadata']);
  });

  it('conserve les metadonnees telles quelles — c est la ou vit l URL du montage', async () => {
    const metadata = { renderedVideoUrl: 'https://cdn/x.webm', rushUrls: ['https://cdn/r.mp4'] };
    await post({ title: 'x', metadata });
    expect(valuesOf().metadata).toEqual(metadata);
  });

  it('accepte les deux formats de la contrainte SQL', async () => {
    await post({ title: 'x', format: 'reel' });
    expect(valuesOf().format).toBe('reel');
    await post({ title: 'x', format: 'tv' });
    expect(valuesOf().format).toBe('tv');
  });

  it('ecarte un format hors contrainte au lieu de faire echouer l insert', async () => {
    const res = await post({ title: 'x', format: 'carre' });
    expect(res.status).not.toBe(500);
    expect(valuesOf()).not.toHaveProperty('format');
  });

  it('ecarte une valeur mal typee sans faire tomber le reste', async () => {
    await post({ title: 'x', description: 42, metadata: { ok: true } });
    expect(valuesOf()).not.toHaveProperty('description');
    expect(valuesOf().metadata).toEqual({ ok: true });
  });
});

describe('Corps refuses fermement, AVANT toute requete', () => {
  it('refuse un corps non-objet', async () => {
    const res = await post('bonjour');
    expect(res.status).toBe(422);
    expect(calls).toHaveLength(0);
  });

  it('refuse un tableau', async () => {
    const res = await post([{ title: 'x' }]);
    expect(res.status).toBe(422);
    expect(calls).toHaveLength(0);
  });

  it('refuse une cle de detournement de prototype', async () => {
    const res = await post(JSON.parse('{"title":"x","__proto__":{"admin":true}}'));
    expect(res.status).toBe(422);
    expect(calls).toHaveLength(0);
  });

  it('refuse un titre absent — la colonne est NOT NULL', async () => {
    const res = await post({ format: 'reel' });
    expect(res.status).toBe(422);
    expect(calls).toHaveLength(0);
  });

  it('refuse un titre vide', async () => {
    const res = await post({ title: '' });
    expect(res.status).toBe(422);
    expect(calls).toHaveLength(0);
  });

  it('refuse un corps JSON illisible avec un 400 explicite', async () => {
    const res = await POST({
      json: async () => { throw new SyntaxError('bad json'); },
    } as never);
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe('Aucun effet de bord', () => {
  it('ne touche que la table videos', async () => {
    await post({ title: 'x' });
    expect(calls.every((c) => c.table === 'videos')).toBe(true);
  });

  it("n'ecrit ni credits, ni jobs de rendu, ni posts", async () => {
    await post({ title: 'x', credits_used: 99, render_job_id: 'j' });
    const interdites = ['credit_transactions', 'render_jobs', 'scheduled_posts', 'users'];
    expect(calls.filter((c) => interdites.includes(c.table))).toHaveLength(0);
  });

  it('fait exactement une ecriture', async () => {
    await post({ title: 'x' });
    expect(inserts()).toHaveLength(1);
  });
});

describe('Les deux appelants reels passent toujours', () => {
  // Corps envoyes par `dashboard/infographic/page.tsx:637` et
  // `components/creer/AgentIAModal.tsx:524`. Ils sont fire-and-forget : ils ne
  // lisent pas la reponse. Ce qui compte est que l'insert reste VALIDE.
  const corpsInfographie = {
    title: 'Mon infographie',
    format: 'tv',
    type: 'infographic',
    status: 'completed',
    video_url: 'https://cdn/montage.webm',
    thumbnail_url: 'https://cdn/poster.jpg',
    metadata: { renderedVideoUrl: 'https://cdn/montage.webm', rushUrls: [] },
  };

  it('infographie : la ligne est creee, en brouillon, sans URL client', async () => {
    const res = await post(corpsInfographie);
    expect(res.status).not.toBe(422);
    expect(valuesOf().title).toBe('Mon infographie');
    expect(valuesOf().format).toBe('tv');
    expect(valuesOf().status).toBe('draft');
    expect(valuesOf()).not.toHaveProperty('video_url');
  });

  it("infographie : l'URL du montage survit dans metadata", async () => {
    await post(corpsInfographie);
    expect((valuesOf().metadata as Record<string, unknown>).renderedVideoUrl)
      .toBe('https://cdn/montage.webm');
  });

  it('agent IA : la ligne est creee, en brouillon', async () => {
    const res = await post({
      title: 'Post agent',
      format: 'reel',
      type: 'creator',
      status: 'completed',
      video_url: 'https://cdn/agent.webm',
      thumbnail_url: 'https://cdn/agent.jpg',
      metadata: { objective: 'ventes', renderedVideoUrl: 'https://cdn/agent.webm' },
    });
    expect(res.status).not.toBe(422);
    expect(valuesOf().status).toBe('draft');
    expect(valuesOf().format).toBe('reel');
  });
});
