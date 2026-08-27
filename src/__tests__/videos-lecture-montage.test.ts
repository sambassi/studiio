/**
 * La Bibliotheque doit lire le MONTAGE, jamais le rush quand un montage existe.
 *
 * Regression corrigee ici : `POST /api/videos` refuse desormais `video_url`
 * depuis le navigateur — a raison, c'est ce qui empechait de se declarer
 * `completed` sans rendu. Mais les deux ecrans qui creent ces lignes composent
 * leur montage DANS le navigateur : la colonne restait nulle, et la
 * Bibliotheque retombait sur `metadata.rushUrls[0]`, le rush BRUT.
 *
 * L'URL du montage n'avait jamais disparu : elle vit dans
 * `metadata.renderedVideoUrl`. Plus personne ne la lisait.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  resolveMontageUrl,
  resolvePlayableVideoUrl,
  resolveExportableUrl,
} from '@/lib/videos/playable-url';

const MONTAGE = 'https://cdn.test/montage.webm';
const RUSH = 'https://cdn.test/rush-brut.mp4';
const AFFICHE = 'https://cdn.test/affiche.jpg';

// ────────────────────────────────────────────────────────────────────────────
// Le resolveur, sur des valeurs
// ────────────────────────────────────────────────────────────────────────────

describe('1. `video_url` presente reste prioritaire', () => {
  it('gagne sur renderedVideoUrl', () => {
    expect(resolveMontageUrl({
      video_url: 'https://cdn.test/rendu-serveur.mp4',
      metadata: { renderedVideoUrl: MONTAGE },
    })).toBe('https://cdn.test/rendu-serveur.mp4');
  });

  it('gagne sur le rush', () => {
    expect(resolvePlayableVideoUrl({
      video_url: 'https://cdn.test/rendu-serveur.mp4',
      metadata: { rushUrls: [RUSH] },
    })).toBe('https://cdn.test/rendu-serveur.mp4');
  });

  it('une colonne vide ne compte pas comme presente', () => {
    expect(resolveMontageUrl({ video_url: '', metadata: { renderedVideoUrl: MONTAGE } }))
      .toBe(MONTAGE);
  });
});

describe('2. `video_url` absente + renderedVideoUrl presente → le montage est lu', () => {
  it('avec video_url nulle', () => {
    expect(resolveMontageUrl({ video_url: null, metadata: { renderedVideoUrl: MONTAGE } }))
      .toBe(MONTAGE);
  });

  it('avec la colonne absente du tout', () => {
    expect(resolveMontageUrl({ metadata: { renderedVideoUrl: MONTAGE } })).toBe(MONTAGE);
  });

  it("le montage passe AVANT le rush, meme quand les deux sont la", () => {
    expect(resolvePlayableVideoUrl({
      video_url: null,
      metadata: { renderedVideoUrl: MONTAGE, rushUrls: [RUSH] },
    })).toBe(MONTAGE);
  });
});

describe('3. Aucun montage → repli historique vers le rush', () => {
  it('lit le premier rush', () => {
    expect(resolvePlayableVideoUrl({ video_url: null, metadata: { rushUrls: [RUSH] } }))
      .toBe(RUSH);
  });

  it('rend null quand il n y a rien du tout', () => {
    expect(resolvePlayableVideoUrl({ video_url: null, metadata: {} })).toBeNull();
    expect(resolvePlayableVideoUrl({})).toBeNull();
    expect(resolvePlayableVideoUrl(null)).toBeNull();
  });

  it('ne confond jamais un rush avec un montage', () => {
    expect(resolveMontageUrl({ video_url: null, metadata: { rushUrls: [RUSH] } })).toBeNull();
  });

  it('ignore `metadata.videoUrl`, cle ambigue qui porte souvent le rush', () => {
    // `creer-avance` y met le rush, `cron/publish` l'exclut nommement de sa
    // priorite. Sur la table `videos`, personne ne l'ecrit.
    expect(resolveMontageUrl({ video_url: null, metadata: { videoUrl: RUSH } })).toBeNull();
  });

  it('survit a des metadonnees absurdes', () => {
    expect(resolvePlayableVideoUrl({ metadata: { rushUrls: 'pas-un-tableau' } as never })).toBeNull();
    expect(resolvePlayableVideoUrl({ metadata: { rushUrls: [] } })).toBeNull();
    expect(resolveMontageUrl({ metadata: { renderedVideoUrl: 42 } as never })).toBeNull();
  });
});

describe('Export et repost prolongent la meme cascade', () => {
  it('preferent le montage au rush', () => {
    expect(resolveExportableUrl({
      video_url: null,
      metadata: { renderedVideoUrl: MONTAGE, rushUrls: [RUSH], posterPhotoUrl: AFFICHE },
    })).toBe(MONTAGE);
  });

  it("retombent sur l'affiche quand il n'y a ni montage ni rush", () => {
    expect(resolveExportableUrl({ video_url: null, metadata: { posterPhotoUrl: AFFICHE } }))
      .toBe(AFFICHE);
  });

  it('conservent le dernier repli historique', () => {
    expect(resolveExportableUrl({ video_url: null, metadata: { characterImageUrl: AFFICHE } }))
      .toBe(AFFICHE);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Les routes, reellement appelees
// ────────────────────────────────────────────────────────────────────────────

const authMock = vi.fn();
const tables: Record<string, unknown[]> = { videos: [], scheduled_posts: [] };
/** Toute ecriture tentee, quelle qu'elle soit. */
const ecritures: Array<{ table: string; op: string; values?: unknown }> = [];
let ligneUnique: unknown = null;

function makeQuery(table: string) {
  const api: Record<string, unknown> = {
    select: () => api,
    eq: () => api,
    order: () => Promise.resolve({ data: tables[table] ?? [], count: (tables[table] ?? []).length, error: null }),
    insert: (values: unknown) => { ecritures.push({ table, op: 'insert', values }); return api; },
    update: (values: unknown) => { ecritures.push({ table, op: 'update', values }); return api; },
    delete: () => { ecritures.push({ table, op: 'delete' }); return api; },
    single: async () => ({ data: ligneUnique, error: ligneUnique ? null : { message: 'not found' } }),
    maybeSingle: async () => ({ data: ligneUnique, error: null }),
  };
  return api;
}

vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: (t: string) => makeQuery(t) },
  supabase: { from: (t: string) => makeQuery(t) },
}));

const { GET } = await import('@/app/api/videos/route');
const { POST: EXPORT } = await import('@/app/api/videos/[id]/export/route');

/** Ligne telle que `dashboard/infographic` la cree DESORMAIS : sans video_url. */
const LIGNE_INFOGRAPHIE = {
  id: 'v-info',
  title: 'Mon infographie',
  format: 'tv',
  status: 'draft',
  created_at: '2026-08-27T10:00:00Z',
  video_url: null,
  thumbnail_url: null,
  metadata: { renderedVideoUrl: MONTAGE, rushUrls: [RUSH], posterPhotoUrl: AFFICHE },
};

/** Ligne telle que `AgentIAModal` la cree : montage navigateur, meme forme. */
const LIGNE_AGENT = {
  id: 'v-agent',
  title: 'Post agent',
  format: 'reel',
  status: 'draft',
  created_at: '2026-08-27T09:00:00Z',
  video_url: null,
  thumbnail_url: null,
  metadata: { renderedVideoUrl: MONTAGE, rushUrls: [RUSH], objective: 'ventes' },
};

const lister = async () => {
  const res = await GET({ url: 'http://x/api/videos?page=1&limit=20' } as never);
  return (await res.json()).data as Array<Record<string, unknown>>;
};

beforeEach(() => {
  tables.videos = [];
  tables.scheduled_posts = [];
  ecritures.length = 0;
  ligneUnique = null;
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'user-1' } });
});

describe('4. Montage d infographie : la Bibliotheque sert le montage, pas le rush', () => {
  it('expose le montage', async () => {
    tables.videos = [LIGNE_INFOGRAPHIE];
    const [item] = await lister();
    expect(item.video_url).toBe(MONTAGE);
  });

  it('ne sert JAMAIS le rush brut quand un montage existe', async () => {
    tables.videos = [LIGNE_INFOGRAPHIE];
    const [item] = await lister();
    expect(item.video_url).not.toBe(RUSH);
  });
});

describe('5. Montage navigateur (agent IA) : meme garantie', () => {
  it('expose le montage', async () => {
    tables.videos = [LIGNE_AGENT];
    const [item] = await lister();
    expect(item.video_url).toBe(MONTAGE);
    expect(item.video_url).not.toBe(RUSH);
  });
});

describe('Repli conserve pour les lignes sans montage', () => {
  it('une ligne a rush seul n invente pas de montage', async () => {
    tables.videos = [{ ...LIGNE_INFOGRAPHIE, metadata: { rushUrls: [RUSH] } }];
    const [item] = await lister();
    expect(item.video_url).toBeNull();
    // Le rush reste accessible a l'ecran par `metadata.rushUrls[0]`.
    expect((item.metadata as Record<string, unknown>).rushUrls).toEqual([RUSH]);
  });

  it('une ligne rendue par le serveur garde sa colonne', async () => {
    tables.videos = [{ ...LIGNE_INFOGRAPHIE, video_url: 'https://cdn.test/remotion.mp4' }];
    const [item] = await lister();
    expect(item.video_url).toBe('https://cdn.test/remotion.mp4');
  });
});

describe('6. Le statut reste `draft` — lire un montage ne rend rien', () => {
  it('la ligne servie est toujours en brouillon', async () => {
    tables.videos = [LIGNE_INFOGRAPHIE];
    const [item] = await lister();
    expect(item.status).toBe('draft');
  });

  it('lister ne declare rien `completed`', async () => {
    tables.videos = [LIGNE_INFOGRAPHIE, LIGNE_AGENT];
    const items = await lister();
    expect(items.every((i) => i.status === 'draft')).toBe(true);
  });
});

describe('8. Aucun rendu, aucun debit, aucune publication', () => {
  it('lister n ecrit strictement rien', async () => {
    tables.videos = [LIGNE_INFOGRAPHIE];
    await lister();
    expect(ecritures).toEqual([]);
  });

  it('exporter n ecrit strictement rien', async () => {
    ligneUnique = LIGNE_INFOGRAPHIE;
    await EXPORT({} as never, { params: { id: 'v-info' } } as never);
    expect(ecritures).toEqual([]);
  });

  it('exporter sert le montage, pas le rush', async () => {
    ligneUnique = LIGNE_INFOGRAPHIE;
    const res = await EXPORT({} as never, { params: { id: 'v-info' } } as never);
    const body = await res.json();
    expect(body.url).toBe(MONTAGE);
    expect(body.url).not.toBe(RUSH);
  });

  it('ne touche ni les credits, ni les jobs de rendu', async () => {
    tables.videos = [LIGNE_INFOGRAPHIE];
    await lister();
    const interdites = ['credit_transactions', 'render_jobs', 'users'];
    expect(ecritures.filter((e) => interdites.includes(e.table))).toEqual([]);
  });
});

describe('7. La securite du POST reste intacte', () => {
  it('le resolveur ne rouvre aucune colonne protegee', async () => {
    const { VIDEO_POST_ALLOWED_COLUMNS, VIDEO_POST_FORCED_STATUS } =
      await import('@/lib/videos/post-payload');
    expect([...VIDEO_POST_ALLOWED_COLUMNS]).toEqual(['title', 'description', 'format', 'metadata']);
    expect(VIDEO_POST_FORCED_STATUS).toBe('draft');
    expect([...VIDEO_POST_ALLOWED_COLUMNS]).not.toContain('video_url');
    expect([...VIDEO_POST_ALLOWED_COLUMNS]).not.toContain('status');
    expect([...VIDEO_POST_ALLOWED_COLUMNS]).not.toContain('credits_used');
    expect([...VIDEO_POST_ALLOWED_COLUMNS]).not.toContain('render_job_id');
    expect([...VIDEO_POST_ALLOWED_COLUMNS]).not.toContain('user_id');
  });

  it("l'URL du montage reste dans metadata — on ne l'a pas deplacee", async () => {
    tables.videos = [LIGNE_INFOGRAPHIE];
    const [item] = await lister();
    expect((item.metadata as Record<string, unknown>).renderedVideoUrl).toBe(MONTAGE);
  });
});

describe('Une seule cascade, partagee', () => {
  it('export et repost passent par le resolveur commun', () => {
    const lus = [
      'src/app/api/videos/[id]/export/route.ts',
      'src/app/api/videos/[id]/repost/route.ts',
      'src/app/api/videos/route.ts',
    ];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('fs');
    for (const chemin of lus) {
      const source = readFileSync(chemin, 'utf-8');
      expect(source, `${chemin} doit utiliser le resolveur`).toContain('@/lib/videos/playable-url');
      expect(source, `${chemin} ne doit plus porter sa propre cascade`)
        .not.toContain("video.metadata?.rushUrls?.[0]");
    }
  });
});
