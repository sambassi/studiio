import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  VIDEO_PUT_ALLOWED_COLUMNS,
  VIDEO_PUT_FORBIDDEN_COLUMNS,
} from '@/lib/videos/put-payload';
import { deepClone, deepFreeze } from '@/lib/creer/design/internal';

/**
 * PUT /api/videos/[id] — propriete, liste blanche, fusion des metadonnees.
 *
 * Ce que ces tests protegent : la route faisait `.update(body)`. Le
 * `WHERE user_id = <session>` bornait la LIGNE visee, jamais les COLONNES
 * ecrites — `credits_used`, `render_job_id`, `status`, `video_url` et
 * `user_id` partaient donc tels quels vers PostgREST.
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
    // Une correction de mise a jour n'a aucune raison de creer une ligne :
    // ces trois-la doivent rester inatteignables depuis PUT.
    insert: () => { call.op = 'insert'; calls.push(call); throw new Error('insert interdit'); },
    upsert: () => { call.op = 'upsert'; calls.push(call); throw new Error('upsert interdit'); },
    // `delete` reste fonctionnel : le gestionnaire DELETE de la meme route
    // doit continuer de passer, et c'est justement ce que le test 20 verifie.
    delete: () => { call.op = 'delete'; return api; },
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

const { PUT, GET, DELETE } = await import('@/app/api/videos/[id]/route');

const put = async (body: unknown, id = 'video-1') => {
  const res = await PUT({ json: async () => body } as never, { params: { id } });
  return { status: res.status, body: await res.json() };
};

const writes = () => calls.filter((c) => c.op === 'write');
const lastWrite = () => writes().at(-1);
const patchOf = () => lastWrite()?.patch ?? {};

const A = 'user-A';
const B = 'user-B';

/**
 * La ligne complete telle que `select('*')` la renvoie.
 *
 * Les metadonnees melangent DELIBEREMENT les trois formes que `videos`
 * connait : design d'infographie (`subtitle`, `rushUrls`, `musicUrl`),
 * composition Remotion (`compositionId`, `inputProps`, `batchIndex`) et
 * extensions non declarees (`objective`, `title` interne).
 */
const VIDEO_ROW = {
  id: 'video-1',
  user_id: A,
  title: 'Ma video',
  description: 'Une description',
  format: 'reel',
  status: 'completed',
  objective_id: null,
  script: null,
  thumbnail_url: 'https://media.exemple.test/poster.jpg',
  video_url: 'https://media.exemple.test/rendu.webm',
  credits_used: 10,
  render_job_id: 'job-legitime',
  created_at: '2026-08-01T10:00:00.000+00:00',
  updated_at: '2026-08-25T10:00:00.000+00:00',
  metadata: {
    // ── cles du contrat canonique ──
    type: 'infographic',
    subtitle: 'Un sous-titre',
    rushUrls: ['https://media.exemple.test/rush.mp4'],
    musicUrl: 'https://media.exemple.test/musique.mp3',
    renderedVideoUrl: 'https://media.exemple.test/rendu.webm',
    // ── cles propres a `videos`, inconnues du contrat ──
    title: 'Titre interne',
    compositionId: 'InfographicReel',
    batchIndex: 0,
    batchTotal: 3,
    inputProps: { accentColor: '#7C3AED', cards: [{ title: 'C1' }] },
    objective: 'notoriete',
    posterPhotoUrl: 'https://media.exemple.test/poster.jpg',
  },
};

function seed(row: Record<string, unknown> = VIDEO_ROW) {
  readRow = deepClone(row);
  writeRows = [deepClone(row)];
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
    const { status } = await put({ title: 'x' });
    expect(status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('1b. session sans identifiant : 401, aucune requete', async () => {
    authMock.mockResolvedValue({ user: {} });
    expect((await put({ title: 'x' })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('2. video inexistante : 404, aucune ecriture, aucune creation', async () => {
    readRow = null;
    const { status, body } = await put({ title: 'x' }, 'inconnu');
    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(writes()).toHaveLength(0);
    expect(calls.some((c) => c.op === 'insert' || c.op === 'upsert')).toBe(false);
  });

  it('3. video d un autre utilisateur : 403, aucune ecriture', async () => {
    seed({ ...VIDEO_ROW, user_id: B });
    const { status } = await put({ title: 'pirate' });
    expect(status).toBe(403);
    expect(writes()).toHaveLength(0);
  });

  it('3b. le user_id du corps ne fait PAS passer le controle de propriete', async () => {
    // La video appartient a B ; l'attaquant (session A) affirme etre B.
    seed({ ...VIDEO_ROW, user_id: B });
    const { status } = await put({ user_id: B, title: 'pirate' });
    expect(status).toBe(403);
    expect(writes()).toHaveLength(0);
  });

  it('17. l UPDATE est filtre par l id ET par le proprietaire de session', async () => {
    await put({ title: 'ok' });
    expect(lastWrite()?.filters).toMatchObject({ id: 'video-1', user_id: A });
  });

  it('17b. le filtre user_id de l ecriture vient de la session, jamais du corps', async () => {
    await put({ user_id: B, title: 'ok' });
    expect(lastWrite()?.filters.user_id).toBe(A);
  });

  it('17c. la lecture est bornee a l id seul, et la reponse ne fuit rien d une autre ligne', async () => {
    seed({ ...VIDEO_ROW, user_id: B });
    const { body } = await put({ title: 'pirate' });
    const read = calls.find((c) => c.op === 'read');
    expect(read?.filters).toEqual({ id: 'video-1' });
    expect(JSON.stringify(body)).not.toContain('rendu.webm');
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('liste blanche', () => {
  it('4. mise a jour legitime : title et description sont ecrits', async () => {
    const { status, body } = await put({ title: 'Nouveau titre', description: 'Nouvelle desc' });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(patchOf()).toEqual({ title: 'Nouveau titre', description: 'Nouvelle desc' });
  });

  it('5. user_id injecte : filtre, absent du SET', async () => {
    await put({ title: 'ok', user_id: B });
    expect(patchOf()).not.toHaveProperty('user_id');
    expect(patchOf()).toEqual({ title: 'ok' });
  });

  it('6. credits_used injecte : filtre, absent du SET', async () => {
    await put({ title: 'ok', credits_used: 0 });
    expect(patchOf()).not.toHaveProperty('credits_used');
  });

  it('7. render_job_id injecte : filtre, absent du SET', async () => {
    await put({ title: 'ok', render_job_id: 'job-d-un-autre' });
    expect(patchOf()).not.toHaveProperty('render_job_id');
  });

  it('8. status injecte : filtre, absent du SET', async () => {
    await put({ title: 'ok', status: 'completed' });
    expect(patchOf()).not.toHaveProperty('status');
  });

  it('9. video_url injectee : filtre, absent du SET', async () => {
    await put({ title: 'ok', video_url: 'https://pirate.test/charge.webm' });
    expect(patchOf()).not.toHaveProperty('video_url');
  });

  it('10. colonne inconnue : filtree, absente du SET', async () => {
    await put({ title: 'ok', colonne_inventee: 1, role: 'admin', credits: 99999 });
    expect(Object.keys(patchOf())).toEqual(['title']);
  });

  it('10b. AUCUNE colonne nommement interdite n atteint PostgREST', async () => {
    const hostile: Record<string, unknown> = { title: 'ok' };
    for (const column of VIDEO_PUT_FORBIDDEN_COLUMNS) hostile[column] = 'valeur-hostile';
    await put(hostile);
    for (const column of VIDEO_PUT_FORBIDDEN_COLUMNS) {
      expect(patchOf(), `${column} ne doit pas etre ecrit`).not.toHaveProperty(column);
    }
    expect(Object.keys(patchOf())).toEqual(['title']);
  });

  it('10c. la ligne entiere relue par GET repasse sans rien ecrire d interdit', async () => {
    // Le scenario d un futur appelant : relire `GET` (`select('*')`), changer
    // le titre, tout renvoyer. Aucun 422, et seul le titre part.
    await put({ ...VIDEO_ROW, title: 'Renomme' });
    expect(Object.keys(patchOf()).sort()).toEqual(['description', 'metadata', 'title']);
    expect(patchOf().title).toBe('Renomme');
  });

  it('10d. une valeur de type invalide est ecartee, sans faire tomber le reste', async () => {
    await put({ title: 42, description: 'ok' });
    expect(patchOf()).toEqual({ description: 'ok' });
  });

  it('10e. metadata null est ecarte : on n efface pas tout le metadata', async () => {
    await put({ title: 'ok', metadata: null });
    expect(patchOf()).toEqual({ title: 'ok' });
  });

  it('10f. corps non-objet : 422, aucune requete', async () => {
    for (const body of ['une chaine', 42, null, ['a']]) {
      calls.length = 0;
      const { status } = await put(body);
      expect(status).toBe(422);
      expect(calls).toHaveLength(0);
    }
  });

  it('10g. cle de detournement de prototype : 422, aucune requete', async () => {
    const hostile = JSON.parse('{"title":"ok","metadata":{"__proto__":{"admin":true}}}');
    const { status } = await put(hostile);
    expect(status).toBe(422);
    expect(calls).toHaveLength(0);
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });

  it('11. aucun champ autorise : AUCUNE ecriture, ligne actuelle renvoyee', async () => {
    const { status, body } = await put({ user_id: B, credits_used: 0, status: 'published' });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual(VIDEO_ROW);
    expect(writes()).toHaveLength(0);
  });

  it('11b. corps vide : AUCUNE ecriture', async () => {
    const { status } = await put({});
    expect(status).toBe(200);
    expect(writes()).toHaveLength(0);
  });

  it('11c. la liste blanche reste minimale', async () => {
    // Un ajout de colonne doit etre un geste conscient, pas un glissement.
    expect([...VIDEO_PUT_ALLOWED_COLUMNS]).toEqual(['title', 'description', 'metadata']);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('fusion des metadonnees', () => {
  const metaOf = () => patchOf().metadata as Record<string, unknown>;

  it('12. metadata partiel : les cles non envoyees survivent', async () => {
    await put({ metadata: { musicUrl: 'https://media.exemple.test/nouvelle.mp3' } });
    expect(metaOf().musicUrl).toBe('https://media.exemple.test/nouvelle.mp3');
    expect(metaOf().subtitle).toBe('Un sous-titre');
    expect(metaOf().rushUrls).toEqual(['https://media.exemple.test/rush.mp4']);
    expect(metaOf().renderedVideoUrl).toBe('https://media.exemple.test/rendu.webm');
  });

  it('12b. le metadata entier n est JAMAIS remplace par un fragment', async () => {
    await put({ metadata: { subtitle: 'Nouveau' } });
    for (const key of Object.keys(VIDEO_ROW.metadata)) {
      expect(metaOf(), `${key} a disparu`).toHaveProperty(key);
    }
  });

  it('13. les cles propres a videos, inconnues du contrat, survivent', async () => {
    await put({ metadata: { subtitle: 'Nouveau' } });
    expect(metaOf().compositionId).toBe('InfographicReel');
    expect(metaOf().batchIndex).toBe(0);
    expect(metaOf().batchTotal).toBe(3);
    expect(metaOf().inputProps).toEqual({ accentColor: '#7C3AED', cards: [{ title: 'C1' }] });
    expect(metaOf().objective).toBe('notoriete');
    expect(metaOf().posterPhotoUrl).toBe('https://media.exemple.test/poster.jpg');
    expect(metaOf().title).toBe('Titre interne');
  });

  it('13b. une cle inconnue ENVOYEE par le client est ecrite, pas perdue', async () => {
    await put({ metadata: { extensionFuture: { a: 1 }, compositionId: 'AutreComposition' } });
    expect(metaOf().extensionFuture).toEqual({ a: 1 });
    expect(metaOf().compositionId).toBe('AutreComposition');
  });

  it('13c. le metadata fusionne ne contient AUCUNE cle introduite', async () => {
    await put({ metadata: { subtitle: 'Nouveau' } });
    const attendu = new Set([...Object.keys(VIDEO_ROW.metadata)]);
    for (const key of Object.keys(metaOf())) {
      expect(attendu.has(key), `${key} a ete introduit`).toBe(true);
    }
  });

  it('14. 0, false, "", null et [] envoyes sont ecrits fidelement', async () => {
    await put({
      metadata: {
        batchIndex: 0,
        hasAudio: false,
        subtitle: '',
        musicUrl: null,
        rushUrls: [],
        inputProps: {},
      },
    });
    expect(metaOf().batchIndex).toBe(0);
    expect(metaOf().hasAudio).toBe(false);
    expect(metaOf().subtitle).toBe('');
    expect(metaOf().musicUrl).toBeNull();
    expect(metaOf().rushUrls).toEqual([]);
    expect(metaOf().inputProps).toEqual({});
    // Les cles presentes le restent, meme portant une valeur vide.
    for (const key of ['batchIndex', 'hasAudio', 'subtitle', 'musicUrl', 'rushUrls', 'inputProps']) {
      expect(Object.prototype.hasOwnProperty.call(metaOf(), key)).toBe(true);
    }
  });

  it('14b. 0, false, "", null et [] DEJA en base survivent a une fusion qui ne les vise pas', async () => {
    seed({
      ...VIDEO_ROW,
      metadata: {
        batchIndex: 0,
        hasAudio: false,
        subtitle: '',
        musicUrl: null,
        rushUrls: [],
        inconnuVide: [],
      },
    });
    await put({ metadata: { compositionId: 'X' } });
    expect(metaOf()).toEqual({
      batchIndex: 0,
      hasAudio: false,
      subtitle: '',
      musicUrl: null,
      rushUrls: [],
      inconnuVide: [],
      compositionId: 'X',
    });
  });

  it('14c. un metadata existant absent ou non-objet ne fait pas tomber la fusion', async () => {
    for (const existant of [null, undefined, 'casse', 42]) {
      seed({ ...VIDEO_ROW, metadata: existant });
      const { status } = await put({ metadata: { subtitle: 'S' } });
      expect(status).toBe(200);
      expect(metaOf()).toEqual({ subtitle: 'S' });
    }
  });

  it('15. mises a jour sequentielles : aucune derive', async () => {
    // 1re : on change la musique.
    await put({ metadata: { musicUrl: 'https://media.exemple.test/1.mp3' } });
    const apres1 = metaOf();

    // 2e : la ligne relue porte le resultat de la 1re.
    seed({ ...VIDEO_ROW, metadata: apres1 });
    await put({ metadata: { subtitle: 'Deux' } });
    const apres2 = metaOf();

    // 3e : rigoureusement le meme fragment que la 2e -> objet identique.
    seed({ ...VIDEO_ROW, metadata: apres2 });
    await put({ metadata: { subtitle: 'Deux' } });
    const apres3 = metaOf();

    expect(apres3).toEqual(apres2);
    expect(apres2.musicUrl).toBe('https://media.exemple.test/1.mp3');
    expect(apres2.subtitle).toBe('Deux');
    expect(apres2.compositionId).toBe('InfographicReel');
    expect(Object.keys(apres3).sort()).toEqual(Object.keys(VIDEO_ROW.metadata).sort());
  });

  it('16. ni la ligne lue ni la charge utile ne sont mutees', async () => {
    const existant = deepFreeze(deepClone(VIDEO_ROW));
    readRow = existant as unknown as Record<string, unknown>;
    writeRows = [deepClone(VIDEO_ROW)];
    const entrant = deepFreeze({ metadata: { subtitle: 'Nouveau', rushUrls: ['a'] } });

    const { status } = await put(entrant);

    expect(status).toBe(200);
    expect(existant.metadata).toEqual(VIDEO_ROW.metadata);
    expect(entrant).toEqual({ metadata: { subtitle: 'Nouveau', rushUrls: ['a'] } });
    // Le resultat ne PARTAGE pas ses sous-objets avec l entree : le muter
    // plus tard ne remonterait pas dans l entrant.
    expect(metaOf().rushUrls).not.toBe(entrant.metadata.rushUrls);
  });

  it('16b. sans metadata dans le corps, la colonne n est pas touchee', async () => {
    await put({ title: 'ok' });
    expect(patchOf()).not.toHaveProperty('metadata');
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('effets de bord interdits', () => {
  it('18. aucune operation insert, upsert ou delete pendant un PUT', async () => {
    await put({ title: 'ok', metadata: { subtitle: 'S' } });
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
    expect(calls.filter((c) => c.op === 'upsert')).toHaveLength(0);
    expect(calls.filter((c) => c.op === 'delete')).toHaveLength(0);
  });

  it('21. aucun rendu : render_jobs n est jamais touchee', async () => {
    await put({ title: 'ok', status: 'rendering', render_job_id: 'x', metadata: { subtitle: 'S' } });
    expect(calls.some((c) => c.table === 'render_jobs')).toBe(false);
    expect(calls.every((c) => c.table === 'videos')).toBe(true);
  });

  it('22. aucun debit : ni credit_transactions ni users ne sont touchees', async () => {
    await put({ title: 'ok', credits_used: 999, credits: 999 });
    expect(calls.some((c) => c.table === 'credit_transactions')).toBe(false);
    expect(calls.some((c) => c.table === 'users')).toBe(false);
    expect(patchOf()).not.toHaveProperty('credits_used');
  });

  it('23. aucune publication : ni scheduled_posts ni social_accounts, et status intact', async () => {
    await put({ title: 'ok', status: 'published', published_at: '2026-08-25T00:00:00Z' });
    expect(calls.some((c) => c.table === 'scheduled_posts')).toBe(false);
    expect(calls.some((c) => c.table === 'social_accounts')).toBe(false);
    expect(patchOf()).not.toHaveProperty('status');
    expect(patchOf()).not.toHaveProperty('published_at');
  });

  it('23b. exactement une lecture et une ecriture, sur la seule table videos', async () => {
    await put({ title: 'ok' });
    expect(calls.filter((c) => c.op === 'read')).toHaveLength(1);
    expect(writes()).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('GET et DELETE inchanges', () => {
  const get = async (id = 'video-1') =>
    GET({} as never, { params: { id } }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const del = async (id = 'video-1') =>
    DELETE({} as never, { params: { id } }).then(async (r) => ({ status: r.status, body: await r.json() }));

  it('19. GET : lecture filtree par id ET proprietaire, contrat de reponse intact', async () => {
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body).toEqual({ success: true, data: VIDEO_ROW });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ table: 'videos', op: 'read', filters: { id: 'video-1', user_id: A } });
  });

  it('19b. GET non authentifie : 401, aucune requete', async () => {
    authMock.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('20. DELETE : suppression filtree par id ET proprietaire, contrat intact', async () => {
    const { status, body } = await del();
    expect(status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ table: 'videos', op: 'delete', filters: { id: 'video-1', user_id: A } });
  });

  it('20b. DELETE non authentifie : 401, aucune requete', async () => {
    authMock.mockResolvedValue(null);
    expect((await del()).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
