import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PUT_ALLOWED_COLUMNS, PUT_ALLOWED_STATUSES } from '@/lib/posts/put-payload';
import { deepClone, deepFreeze } from '@/lib/creer/design/internal';
import { ADVANCED_METADATA, EDGE_METADATA } from './fixtures/canonical-design';

/**
 * PUT /api/posts — propriete, liste blanche, fusion des metadonnees.
 *
 * Ce que ces tests protegent : `user_id` etait reecrivable. Le `WHERE` portait
 * sur l'ancien proprietaire — donc l'ecriture passait — et le `SET` designait
 * le nouveau. Un compte cedait ainsi un post programme a un tiers, dont le
 * cron publiait ensuite le contenu avec SES jetons sociaux.
 *
 * La preuve recherchee n'est jamais le code de retour : c'est l'objet
 * effectivement transmis a PostgREST, et les filtres qui l'accompagnent.
 */

const authMock = vi.fn();

interface Call {
  table: string;
  op: 'read' | 'write' | 'insert' | 'upsert' | 'delete';
  filters: Record<string, unknown>;
  patch?: Record<string, unknown>;
}

const calls: Call[] = [];
let readRow: Record<string, unknown> | null = null;
let readError: unknown = null;
let writeRows: unknown[] | null = null;
let writeError: unknown = null;

function makeQuery(table: string) {
  const call: Call = { table, op: 'read', filters: {} };
  const api: Record<string, unknown> = {
    select: () => api,
    update: (patch: Record<string, unknown>) => { call.op = 'write'; call.patch = patch; return api; },
    insert: () => { call.op = 'insert'; calls.push(call); throw new Error('insert interdit'); },
    upsert: () => { call.op = 'upsert'; calls.push(call); throw new Error('upsert interdit'); },
    delete: () => { call.op = 'delete'; calls.push(call); throw new Error('delete interdit'); },
    eq: (key: string, value: unknown) => { call.filters[key] = value; return api; },
    maybeSingle: async () => { calls.push(call); return { data: readRow, error: readError }; },
    single: async () => { calls.push(call); return { data: readRow, error: readError }; },
    then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => {
      calls.push(call);
      return Promise.resolve({ data: writeRows, error: writeError }).then(onOk, onErr);
    },
  };
  return api;
}

vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: (table: string) => makeQuery(table) },
  supabase: { from: (table: string) => makeQuery(table) },
}));

const { PUT, GET, POST, DELETE } = await import('@/app/api/posts/route');

const put = async (body: unknown) => {
  const res = await PUT({ json: async () => body } as never);
  return { status: res.status, body: await res.json() };
};

const lastWrite = () => calls.filter((c) => c.op === 'write').at(-1);
const writtenKeys = () =>
  calls.filter((c) => c.op === 'write').flatMap((c) => Object.keys(c.patch ?? {}));

const A = 'user-A';
const B = 'user-B';

/** Le post complet tel que `GET /api/posts` (`select('*')`) le renvoie au Calendrier. */
const POST_ROW = {
  id: 'post-1',
  user_id: A,
  title: 'Mon post',
  caption: 'Une legende',
  media_url: 'https://media.exemple.test/montage.webm',
  media_type: 'video',
  format: 'reel',
  platforms: ['instagram'],
  scheduled_date: '2026-09-01',
  scheduled_time: '12:00',
  status: 'draft',
  video_id: null,
  agent_plan_id: null,
  agent_generated: false,
  approved_by: null,
  approved_at: null,
  published_at: null,
  created_at: '2026-08-01T10:00:00.000+00:00',
  updated_at: '2026-08-25T10:00:00.000+00:00',
  metadata: { posterUrl: 'p', design: { font: 'Anton' }, musicUrl: 'm' },
};

function seed(row: Record<string, unknown> = POST_ROW) {
  readRow = {
    id: row.id,
    user_id: row.user_id,
    metadata: row.metadata,
    updated_at: row.updated_at,
  };
  writeRows = [row];
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  readError = null;
  writeError = null;
  authMock.mockResolvedValue({ user: { id: A } });
  seed();
});

// ═══════════════════════════════════════════════════════════════════
describe('acces et propriete', () => {
  it('1. non authentifie : 401, aucune requete', async () => {
    authMock.mockResolvedValue(null);
    expect((await put({ id: 'post-1', title: 'x' })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('2. post inexistant : 404, aucune ecriture, aucune creation', async () => {
    readRow = null;
    const { status } = await put({ id: 'inconnu', title: 'x' });
    expect(status).toBe(404);
    expect(calls.filter((c) => c.op === 'write')).toHaveLength(0);
  });

  it('3. post d un autre utilisateur : 403, aucune ecriture', async () => {
    seed({ ...POST_ROW, user_id: B });
    const { status } = await put({ id: 'post-1', title: 'pirate' });
    expect(status).toBe(403);
    expect(calls.filter((c) => c.op === 'write')).toHaveLength(0);
  });

  it('17. l UPDATE est filtre par l id ET par le proprietaire de session', async () => {
    await put({ id: 'post-1', title: 'ok' });
    expect(lastWrite()?.filters).toStrictEqual({ id: 'post-1', user_id: A });
  });

  it('id manquant : 400, comme avant la correction', async () => {
    expect((await put({ title: 'x' })).status).toBe(400);
    expect((await put({ id: '', title: 'x' })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('une erreur base ne fuit aucun detail', async () => {
    readError = { message: 'postgres 10.0.0.4:5432 refuse la connexion' };
    readRow = null;
    const { status, body } = await put({ id: 'post-1', title: 'x' });
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('10.0.0.4');
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('liste blanche', () => {
  it('4. mise a jour legitime d un post possede', async () => {
    const { status, body } = await put({ id: 'post-1', title: 'Nouveau titre' });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.post).toBeTruthy();
    expect(lastWrite()?.patch).toStrictEqual({ title: 'Nouveau titre' });
  });

  it('5. la charge utile COMPLETE du Calendrier passe, filtree au strict necessaire', async () => {
    const { status } = await put({ ...POST_ROW, status: 'scheduled' });
    expect(status).toBe(200);
    expect(lastWrite()?.patch).toStrictEqual({
      title: POST_ROW.title,
      caption: POST_ROW.caption,
      media_url: POST_ROW.media_url,
      media_type: POST_ROW.media_type,
      format: POST_ROW.format,
      platforms: POST_ROW.platforms,
      scheduled_date: POST_ROW.scheduled_date,
      scheduled_time: POST_ROW.scheduled_time,
      status: 'scheduled',
      metadata: POST_ROW.metadata,
    });
  });

  it('6. `user_id` d une victime dans le corps : ignore, jamais ecrit', async () => {
    const { status, body } = await put({ ...POST_ROW, user_id: B });
    expect(status).toBe(200);
    expect(Object.prototype.hasOwnProperty.call(lastWrite()?.patch ?? {}, 'user_id')).toBe(false);
    expect(writtenKeys()).not.toContain('user_id');
    expect(body.message).toContain('user_id');
  });

  it('7. un `id` different dans le corps cible ce post-la, sans jamais etre ecrit', async () => {
    await put({ id: 'post-2', title: 'x' });
    // `id` sert au ciblage, pas a la mise a jour.
    expect(lastWrite()?.filters).toStrictEqual({ id: 'post-2', user_id: A });
    expect(Object.prototype.hasOwnProperty.call(lastWrite()?.patch ?? {}, 'id')).toBe(false);
  });

  it('8. `approved_by` et `approved_at` injectes : ignores', async () => {
    const { body } = await put({
      id: 'post-1', title: 'x',
      approved_by: B, approved_at: '2026-01-01T00:00:00Z',
    });
    expect(lastWrite()?.patch).toStrictEqual({ title: 'x' });
    expect(body.message).toContain('approved_by');
    expect(body.message).toContain('approved_at');
  });

  it('10. colonnes inconnues et colonnes serveur : toutes ignorees', async () => {
    const { body } = await put({
      id: 'post-1', title: 'x',
      colonneInventee: 'x', published_at: 'now', created_at: 'x', updated_at: 'x',
      agent_generated: true, agent_plan_id: 'p', video_id: 'v',
      platform_post_id: 'ig-1', platform_post_url: 'https://ig.test/1',
      owner_id: B, email: 'x@x.test', role: 'admin', is_admin: true,
    });
    expect(lastWrite()?.patch).toStrictEqual({ title: 'x' });
    for (const cle of ['colonneInventee', 'published_at', 'agent_generated', 'video_id', 'platform_post_id', 'role']) {
      expect(body.message, cle).toContain(cle);
    }
  });

  it('11. aucun champ autorise : 422, aucune requete', async () => {
    for (const corps of [{ id: 'post-1' }, { id: 'post-1', user_id: B }, { id: 'post-1', inconnu: 1 }]) {
      calls.length = 0;
      expect((await put(corps)).status).toBe(422);
      expect(calls).toHaveLength(0);
    }
  });

  it('refuse un corps non-objet et les cles de pollution de prototype', async () => {
    for (const corps of [['x'], 'texte', 42, null]) {
      calls.length = 0;
      expect((await put(corps)).status).toBe(422);
      expect(calls).toHaveLength(0);
    }
    for (const charge of [
      JSON.parse('{"id":"post-1","__proto__":{"user_id":"user-B"}}'),
      JSON.parse('{"id":"post-1","metadata":{"__proto__":{"x":1}}}'),
      JSON.parse('{"id":"post-1","constructor":{"x":1}}'),
    ]) {
      calls.length = 0;
      expect((await put(charge)).status).toBe(422);
      expect(calls).toHaveLength(0);
    }
    expect(({} as Record<string, unknown>).user_id).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('statut', () => {
  it('9. les quatre statuts de la table sont acceptes, `publishing` ne l est pas', async () => {
    for (const statut of PUT_ALLOWED_STATUSES) {
      calls.length = 0;
      seed();
      const { status } = await put({ id: 'post-1', status: statut });
      expect(status, statut).toBe(200);
      expect(lastWrite()?.patch).toStrictEqual({ status: statut });
    }

    // `publishing` est l etat transitoire que le cron s attribue de facon
    // atomique : un client ne doit jamais pouvoir l ecrire.
    calls.length = 0;
    seed();
    const { body } = await put({ id: 'post-1', title: 'x', status: 'publishing' });
    expect(lastWrite()?.patch).toStrictEqual({ title: 'x' });
    expect(body.message).toContain('status');
  });

  it('9bis. un statut invalide est ECARTE sans faire tomber le reste de la requete', async () => {
    // Deplacer dans le calendrier un post en cours de publication doit
    // fonctionner : sa date change, son statut n est pas touche.
    const { status } = await put({ id: 'post-1', status: 'publishing', scheduled_date: '2026-10-01' });
    expect(status).toBe(200);
    expect(lastWrite()?.patch).toStrictEqual({ scheduled_date: '2026-10-01' });
  });

  it('un champ mal type est ecarte, pas la requete entiere', async () => {
    await put({ id: 'post-1', title: 123, caption: 'ok', platforms: 'pas-un-tableau' });
    expect(lastWrite()?.patch).toStrictEqual({ caption: 'ok' });
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('metadata', () => {
  it('12. un fragment est fusionne, jamais substitue', async () => {
    seed({ ...POST_ROW, metadata: { videoUrl: 'v', posterUrl: 'p', design: { font: 'Anton' }, musicUrl: 'ancienne' } });
    await put({ id: 'post-1', metadata: { musicUrl: 'nouvelle' } });
    expect(lastWrite()?.patch?.metadata).toStrictEqual({
      videoUrl: 'v', posterUrl: 'p', design: { font: 'Anton' }, musicUrl: 'nouvelle',
    });
  });

  it('13. les cles inconnues, imbriquees comprises, survivent', async () => {
    seed({ ...POST_ROW, metadata: deepClone(EDGE_METADATA) });
    await put({ id: 'post-1', metadata: { subtitle: 'change' } });
    const meta = lastWrite()?.patch?.metadata as Record<string, unknown>;
    expect(meta.champInconnuRacine).toStrictEqual({ a: 1, b: [true, false], c: { d: '' } });
    expect((meta.design as Record<string, unknown>).champInconnuDansDesign)
      .toStrictEqual({ imbrique: { profond: [1, 2, 3] } });
    expect(meta.subtitle).toBe('change');
  });

  it('14. 0, false, chaine vide, null et tableau vide sont ecrits, pas effaces', async () => {
    seed({ ...POST_ROW, metadata: { musicVolume: 0.8, hasAudio: true, subtitle: 'plein', posterUrl: 'p', rushUrls: ['r'] } });
    await put({
      id: 'post-1',
      metadata: { musicVolume: 0, hasAudio: false, subtitle: '', posterUrl: null, rushUrls: [] },
    });
    expect(lastWrite()?.patch?.metadata).toStrictEqual({
      musicVolume: 0, hasAudio: false, subtitle: '', posterUrl: null, rushUrls: [],
    });
  });

  it('15. deux mises a jour sequentielles n erodent rien', async () => {
    let courant: Record<string, unknown> = deepClone(ADVANCED_METADATA);
    for (const [i, champ] of ['musicUrl', 'voiceUrl'].entries()) {
      calls.length = 0;
      seed({ ...POST_ROW, metadata: courant });
      await put({ id: 'post-1', metadata: { [champ]: `maj-${i}` } });
      courant = lastWrite()?.patch?.metadata as Record<string, unknown>;
    }
    for (const cle of Object.keys(ADVANCED_METADATA)) {
      if (cle === 'musicUrl' || cle === 'voiceUrl') continue;
      expect(courant[cle], cle).toStrictEqual(ADVANCED_METADATA[cle]);
    }
    expect(courant.musicUrl).toBe('maj-0');
    expect(courant.voiceUrl).toBe('maj-1');
  });

  it('ne mute ni la ligne lue ni la charge utile', async () => {
    const meta = deepFreeze(deepClone(ADVANCED_METADATA));
    seed({ ...POST_ROW, metadata: meta as Record<string, unknown> });
    const payload = deepFreeze({ id: 'post-1', metadata: { musicUrl: 'nouvelle' } });
    expect((await put(payload)).status).toBe(200);
    expect(meta).toStrictEqual(ADVANCED_METADATA);
    expect(payload).toStrictEqual({ id: 'post-1', metadata: { musicUrl: 'nouvelle' } });
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('concurrence', () => {
  it('16. une ecriture concurrente sur metadata donne 409', async () => {
    writeRows = [];
    const { status } = await put({ id: 'post-1', metadata: { musicUrl: 'x' } });
    expect(status).toBe(409);
  });

  it('la garde porte sur `updated_at`, et seulement quand metadata est present', async () => {
    await put({ id: 'post-1', metadata: { musicUrl: 'x' } });
    expect(lastWrite()?.filters).toStrictEqual({
      id: 'post-1', user_id: A, updated_at: POST_ROW.updated_at,
    });

    calls.length = 0;
    seed();
    await put({ id: 'post-1', scheduled_date: '2026-10-01' });
    expect(lastWrite()?.filters).toStrictEqual({ id: 'post-1', user_id: A });
  });

  it('sans `updated_at` exploitable, zero ligne signifie « disparue », pas « conflit »', async () => {
    seed({ ...POST_ROW, updated_at: null });
    writeRows = [];
    expect((await put({ id: 'post-1', metadata: { musicUrl: 'x' } })).status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('scenario anti-exploitation — cession de post', () => {
  it('A possede le post, le client envoie le user_id de B : A reste proprietaire', async () => {
    seed({ ...POST_ROW, user_id: A });

    const { status } = await put({
      id: 'post-1',
      user_id: B,                     // la cession
      status: 'scheduled',
      platforms: ['instagram'],
      scheduled_date: '2020-01-01',   // dans le passe : le cron le prendrait
    });

    expect(status).toBe(200);

    // 1. `user_id` n atteint jamais PostgREST, sous aucune requete.
    expect(writtenKeys()).not.toContain('user_id');
    for (const call of calls) {
      expect(JSON.stringify(call.patch ?? {})).not.toContain(B);
    }

    // 2. Aucune identite de B n apparait ni dans l ecriture, ni dans les filtres.
    expect(JSON.stringify(calls)).not.toContain(B);

    // 3. Le `WHERE` reste ancre sur A : meme un decalage entre lecture et
    //    ecriture ne peut pas toucher la ligne d un autre.
    expect(lastWrite()?.filters).toStrictEqual({ id: 'post-1', user_id: A });

    // 4. Le cron selectionne les comptes sociaux par `post.user_id` : celui-ci
    //    n ayant pas bouge, il ne peut pas considerer le post comme celui de B.
    expect(lastWrite()?.patch).toStrictEqual({
      status: 'scheduled',
      platforms: ['instagram'],
      scheduled_date: '2020-01-01',
    });
  });

  it('B ne peut pas non plus s emparer du post de A par l autre bout', async () => {
    authMock.mockResolvedValue({ user: { id: B } });
    seed({ ...POST_ROW, user_id: A });
    const { status } = await put({ id: 'post-1', user_id: B, title: 'a moi' });
    expect(status).toBe(403);
    expect(calls.filter((c) => c.op === 'write')).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('effets de bord interdits', () => {
  const source = readFileSync(resolve(__dirname, '../app/api/posts/route.ts'), 'utf-8');
  const putSource = source.slice(
    source.indexOf('/**\n * PUT /api/posts'),
    source.indexOf('// DELETE /api/posts?id=xxx'),
  );

  it('19. aucune publication sociale', () => {
    expect(putSource).not.toMatch(/publishTo|social\/publish|token-refresh|instagram|tiktok|youtube|facebook/i);
  });

  it('20. aucun rendu', () => {
    expect(putSource).not.toMatch(/composeAndUpload|video-composer|renderMedia|@remotion/);
  });

  it('21. aucun debit de credits', () => {
    expect(putSource).not.toMatch(/deductCredits|credits\/deduct|@\/lib\/credits/);
  });

  it('18. aucune operation insert, upsert ou delete, et une seule table', async () => {
    await put({ ...POST_ROW, status: 'scheduled' });
    expect(calls.some((c) => ['insert', 'upsert', 'delete'].includes(c.op))).toBe(false);
    expect([...new Set(calls.map((c) => c.table))]).toEqual(['scheduled_posts']);
    expect(calls.filter((c) => c.op === 'read')).toHaveLength(1);
    expect(calls.filter((c) => c.op === 'write')).toHaveLength(1);
  });

  it('n utilise jamais `body`, `updates` brut ni `{...body}` dans `.update()`', () => {
    // Les commentaires DECRIVENT l'ancien code (« le gestionnaire faisait
    // `const { id, ...updates } = body` ») : les retirer avant d'inspecter,
    // sinon l'assertion mesure la documentation au lieu du code.
    const code = putSource
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((ligne) => !ligne.trim().startsWith('//'))
      .join('\n');

    expect(code).toMatch(/const updates: Record<string, unknown> = \{ \.\.\.payload\.updates \}/);
    expect(code).toMatch(/\.update\(updates\)/);
    // Aucune des trois formes dangereuses ne subsiste dans le code execute.
    expect(code).not.toMatch(/const \{ id, \.\.\.updates \} = body/);
    expect(code).not.toMatch(/\.update\(body\)/);
    expect(code).not.toMatch(/\.update\(\{ \.\.\.body/);
    expect(code).not.toMatch(/\.update\(raw/);
    // `raw` ne sert qu'a la validation, jamais a l'ecriture.
    expect(code.slice(code.indexOf('const updates'))).not.toContain('raw');
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('les autres gestionnaires du fichier sont inchanges', () => {
  const source = readFileSync(resolve(__dirname, '../app/api/posts/route.ts'), 'utf-8');

  it('22. les cinq appels du Calendrier restent servis', async () => {
    const calendrier = readFileSync(
      resolve(__dirname, '../app/dashboard/calendar/page.tsx'),
      'utf-8',
    );
    // Les cinq charges utiles reelles, dans l ordre du fichier.
    const charges: Array<[string, Record<string, unknown>]> = [
      ['1250 handleSchedulePost', { ...POST_ROW, status: 'scheduled' }],
      ['1289 handleSavePost', { ...POST_ROW, title: 'edite', caption: 'edite', platforms: ['tiktok'], status: 'published' }],
      ['1338 handleDropOnDay', { ...POST_ROW, scheduled_date: '2026-09-15' }],
      ['1906 handlePublishNow', { ...POST_ROW, status: 'scheduled', scheduled_date: '2026-09-02', scheduled_time: '09:00' }],
      ['2465 handleExportPost', { ...POST_ROW, media_url: 'https://media.exemple.test/x.mp4', media_type: 'video', metadata: { ...POST_ROW.metadata, renderedVideoUrl: 'https://media.exemple.test/x.mp4' } }],
    ];
    for (const [label, corps] of charges) {
      calls.length = 0;
      seed();
      const { status, body } = await put(corps);
      expect(status, label).toBe(200);
      expect(body.success, label).toBe(true);
      expect(body.post, label).toBeTruthy();
    }
    // …et le Calendrier appelle toujours cette route de la meme facon.
    expect(calendrier.match(/fetch\('\/api\/posts', \{\s*\n\s*method: 'PUT'/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('l export du 2465 ne perd plus le design que la charge utile ne renvoyait pas', async () => {
    seed({ ...POST_ROW, metadata: { posterUrl: 'p', design: { font: 'Anton' }, cards: [1, 2] } });
    await put({ ...POST_ROW, metadata: { renderedVideoUrl: 'https://media.exemple.test/x.mp4' } });
    const meta = lastWrite()?.patch?.metadata as Record<string, unknown>;
    expect(meta.design).toStrictEqual({ font: 'Anton' });
    expect(meta.cards).toStrictEqual([1, 2]);
    expect(meta.renderedVideoUrl).toBe('https://media.exemple.test/x.mp4');
  });

  it('GET, POST et DELETE n ont pas ete reecrits', () => {
    expect(typeof GET).toBe('function');
    expect(typeof POST).toBe('function');
    expect(typeof DELETE).toBe('function');
    const post = source.slice(source.indexOf('// POST /api/posts'), source.indexOf('/**\n * PUT /api/posts'));
    expect(post).toContain('user_id: session.user.id');
    expect(post).toContain('.insert({');
    expect(post).not.toContain('parsePutPostPayload');
    const get = source.slice(source.indexOf('// GET /api/posts'), source.indexOf('// POST /api/posts'));
    expect(get).toContain(".eq('user_id', session.user.id)");
    const del = source.slice(source.indexOf('// DELETE /api/posts?id=xxx'));
    expect(del).toContain('collectStorageUrlsFromPost');
  });

  it('la liste blanche ne contient que les dix champs du Calendrier', () => {
    expect([...PUT_ALLOWED_COLUMNS]).toEqual([
      'title', 'caption', 'media_url', 'media_type', 'format',
      'platforms', 'scheduled_date', 'scheduled_time', 'status', 'metadata',
    ]);
  });
});
