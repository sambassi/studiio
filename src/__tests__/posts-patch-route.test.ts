import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { MANAGED_FIELDS } from '@/lib/creer/design';
import { deepClone, deepFreeze } from '@/lib/creer/design/internal';
import {
  ADVANCED_METADATA,
  EDGE_METADATA,
} from './fixtures/canonical-design';

/**
 * PATCH /api/posts/[id] — mise a jour PARTIELLE.
 *
 * Ce que ces tests protegent : la colonne `metadata` est un `jsonb` sans
 * historique. Une ecriture qui la remplace au lieu de la fusionner detruit du
 * travail utilisateur, definitivement et sans bruit. C'est exactement ce que
 * faisait `.update(body)`.
 */

const authMock = vi.fn();

// ── Faux client Postgrest ────────────────────────────────────────────
interface Call {
  table: string;
  op: 'read' | 'write' | string;
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
    update: (patch: Record<string, unknown>) => {
      call.op = 'write';
      call.patch = patch;
      return api;
    },
    // Aucune de ces trois operations ne doit jamais etre atteinte : la route
    // met a jour une ligne existante, elle n'en cree ni n'en detruit.
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

const { PATCH } = await import('@/app/api/posts/[id]/route');

const patch = async (body: unknown, id = 'post-1') => {
  const res = await PATCH(
    { json: async () => body } as never,
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, body: await res.json() };
};

/** Derniere ecriture observee. */
const lastWrite = () => calls.filter((c) => c.op === 'write').at(-1);

/** Ligne existante par defaut : appartient a `user-1`. */
function seed(metadata: Record<string, unknown>, updatedAt: unknown = '2026-08-25T10:00:00.000+00:00') {
  readRow = { id: 'post-1', user_id: 'user-1', metadata, updated_at: updatedAt };
  writeRows = [{ id: 'post-1', user_id: 'user-1', metadata }];
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  readError = null;
  writeError = null;
  authMock.mockResolvedValue({ user: { id: 'user-1' } });
  seed({});
});

// ═══════════════════════════════════════════════════════════════════
describe('fusion de metadata', () => {
  it('1. un seul champ envoye ne touche que ce champ', async () => {
    seed({
      videoUrl: 'https://media.exemple.test/v.mp4',
      posterUrl: 'https://media.exemple.test/p.jpg',
      design: { font: 'Anton', titleColor: '#FFF' },
      musicUrl: 'ancienne-musique',
    });

    const { status } = await patch({ metadata: { musicUrl: 'nouvelle-musique' } });

    expect(status).toBe(200);
    expect(lastWrite()?.patch?.metadata).toStrictEqual({
      videoUrl: 'https://media.exemple.test/v.mp4',
      posterUrl: 'https://media.exemple.test/p.jpg',
      design: { font: 'Anton', titleColor: '#FFF' },
      musicUrl: 'nouvelle-musique',
    });
  });

  it('2. plusieurs champs a la fois, les autres intacts', async () => {
    seed({ posterUrl: 'p', musicUrl: 'm', voiceUrl: 'v', hasAudio: false, design: { font: 'Anton' } });

    await patch({ metadata: { musicUrl: 'm2', voiceUrl: 'v2', hasAudio: true } });

    expect(lastWrite()?.patch?.metadata).toStrictEqual({
      posterUrl: 'p',
      musicUrl: 'm2',
      voiceUrl: 'v2',
      hasAudio: true,
      design: { font: 'Anton' },
    });
  });

  it('3. les 38 cles gerees survivent a une modification d une seule d entre elles', async () => {
    expect(MANAGED_FIELDS.length).toBe(38);
    // Une valeur reconnaissable par cle : si l une disparait ou se decale,
    // la comparaison finale le dit precisement.
    const complet: Record<string, unknown> = {};
    for (const field of MANAGED_FIELDS) complet[field.key] = `valeur-${field.key}`;
    complet.inconnuAuContrat = { garde: true };
    seed(deepClone(complet));

    await patch({ metadata: { musicUrl: 'remplacee' } });

    const written = lastWrite()?.patch?.metadata as Record<string, unknown>;
    expect(Object.keys(written).sort()).toEqual(Object.keys(complet).sort());
    for (const field of MANAGED_FIELDS) {
      if (field.key === 'musicUrl') continue;
      expect(written[field.key], field.key).toBe(`valeur-${field.key}`);
    }
    expect(written.musicUrl).toBe('remplacee');
    expect(written.inconnuAuContrat).toStrictEqual({ garde: true });
  });

  it('4. les cles inconnues imbriquees survivent', async () => {
    seed(deepClone(EDGE_METADATA));

    await patch({ metadata: { subtitle: 'change' } });

    const written = lastWrite()?.patch?.metadata as Record<string, unknown>;
    expect(written.champInconnuRacine).toStrictEqual({ a: 1, b: [true, false], c: { d: '' } });
    expect((written.design as Record<string, unknown>).champInconnuDansDesign)
      .toStrictEqual({ imbrique: { profond: [1, 2, 3] } });
    expect(written.cron_publish_results).toStrictEqual(EDGE_METADATA.cron_publish_results);
    expect(written.subtitle).toBe('change');
  });

  it('5. 0, false, chaine vide, null et tableau vide sont ecrits, pas effaces', async () => {
    seed({ musicVolume: 0.8, hasAudio: true, subtitle: 'plein', posterUrl: 'p', rushUrls: ['r'] });

    await patch({
      metadata: { musicVolume: 0, hasAudio: false, subtitle: '', posterUrl: null, rushUrls: [] },
    });

    expect(lastWrite()?.patch?.metadata).toStrictEqual({
      musicVolume: 0,
      hasAudio: false,
      subtitle: '',
      posterUrl: null,
      rushUrls: [],
    });
  });

  it('5bis. une cle INCONNUE du contrat envoyee par le client est bien ecrite', async () => {
    // `toPostMetadata` ne connait que les 38 cles gerees : sans la passe
    // dediee de `mergePostMetadata`, une extension envoyee par le client
    // serait acceptee avec un 200 puis perdue en silence.
    seed({ musicUrl: 'm', extensionFuture: { v: 1 } });

    await patch({ metadata: { extensionFuture: { v: 2, ajout: [] }, toutNeuf: 0 } });

    expect(lastWrite()?.patch?.metadata).toStrictEqual({
      musicUrl: 'm',
      extensionFuture: { v: 2, ajout: [] },
      toutNeuf: 0,
    });
  });

  it('6. `metadata` absent : la colonne n est pas touchee du tout', async () => {
    seed({ musicUrl: 'm', design: { font: 'Anton' } });

    const { status } = await patch({ scheduled_time: '15:30:00' });

    expect(status).toBe(200);
    const write = lastWrite();
    expect(write?.patch).toStrictEqual({ scheduled_time: '15:30:00' });
    expect(Object.prototype.hasOwnProperty.call(write?.patch ?? {}, 'metadata')).toBe(false);
  });

  it('7. `metadata: {}` est accepte et ne change rien', async () => {
    const avant = { musicUrl: 'm', design: { font: 'Anton' }, sequences: { intro: 5 } };
    seed(deepClone(avant));

    const { status } = await patch({ metadata: {} });

    expect(status).toBe(200);
    expect(lastWrite()?.patch?.metadata).toStrictEqual(avant);
  });

  it('8. cinq mises a jour successives n erodent rien', async () => {
    let courant = deepClone(ADVANCED_METADATA);
    const champs = ['musicUrl', 'voiceUrl', 'thumbnailUrl', 'composerVersion', 'subtitle'];

    for (let i = 0; i < champs.length; i += 1) {
      seed(courant);
      calls.length = 0;
      await patch({ metadata: { [champs[i]]: `maj-${i}` } });
      courant = lastWrite()?.patch?.metadata as Record<string, unknown>;
    }

    for (const cle of Object.keys(ADVANCED_METADATA)) {
      if (champs.includes(cle)) continue;
      expect(courant[cle], cle).toStrictEqual(ADVANCED_METADATA[cle]);
    }
    expect(courant.musicUrl).toBe('maj-0');
    expect(courant.subtitle).toBe('maj-4');
  });

  it('9. ne mute ni la ligne lue ni la charge utile', async () => {
    const existant = deepFreeze(deepClone(ADVANCED_METADATA));
    seed(existant as Record<string, unknown>);
    const payload = deepFreeze({ metadata: { musicUrl: 'nouvelle' } });

    const { status } = await patch(payload);

    expect(status).toBe(200);
    expect(existant).toStrictEqual(ADVANCED_METADATA);
    expect(payload).toStrictEqual({ metadata: { musicUrl: 'nouvelle' } });
    expect(lastWrite()?.patch?.metadata).not.toBe(existant);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('validation de la charge utile', () => {
  it('10. refuse un champ mal type, une cle inconnue et un corps non-objet', async () => {
    expect((await patch({ title: 123 })).status).toBe(422);
    expect((await patch({ champInvente: 'x' })).status).toBe(422);
    expect((await patch(['tableau'])).status).toBe(422);
    expect((await patch({})).status).toBe(422);
    expect((await patch({ metadata: null })).status).toBe(422);
    expect(calls.filter((c) => c.op === 'write')).toHaveLength(0);
  });

  it('10c. une cle inconnue GLISSEE a cote d un champ valide fait echouer la requete', async () => {
    // Sans `.strict()`, Zod se contenterait de retirer la cle inconnue et la
    // requete passerait a 200 : le client croirait avoir modifie un champ que
    // la base n a jamais vu. C est un echec silencieux, pas une tolerance.
    const { status } = await patch({ title: 'valide', champInvente: 'x' });
    expect(status).toBe(422);
    expect(calls.filter((c) => c.op === 'write')).toHaveLength(0);
  });

  it('10b. un corps JSON illisible donne 400, pas 500', async () => {
    const res = await PATCH(
      { json: async () => { throw new SyntaxError('bad json'); } } as never,
      { params: Promise.resolve({ id: 'post-1' }) },
    );
    expect(res.status).toBe(400);
  });

  it('11. refuse __proto__, constructor et prototype, a la racine comme en profondeur', async () => {
    const charges = [
      JSON.parse('{"metadata":{"__proto__":{"pollue":1}}}'),
      JSON.parse('{"metadata":{"design":{"__proto__":{"pollue":1}}}}'),
      JSON.parse('{"metadata":{"constructor":{"pollue":1}}}'),
      JSON.parse('{"metadata":{"design":{"prototype":{"pollue":1}}}}'),
      JSON.parse('{"__proto__":{"pollue":1},"title":"x"}'),
    ];
    for (const charge of charges) {
      const { status } = await patch(charge);
      expect(status).toBe(422);
    }
    expect(calls.filter((c) => c.op === 'write')).toHaveLength(0);
    // Ni le prototype global, ni celui d un objet nu neuf n ont ete touches.
    expect(({} as Record<string, unknown>).pollue).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'pollue')).toBe(false);
  });

  it('6bis. `user_id` fourni par le client est refuse, jamais pris pour une autorisation', async () => {
    const { status, body } = await patch({ user_id: 'user-2', title: 'x' });
    expect(status).toBe(422);
    expect(body.details?.join(' ')).toContain('user_id');
    expect(calls.filter((c) => c.op === 'write')).toHaveLength(0);
  });

  it('refuse aussi id, published_at et agent_generated', async () => {
    for (const cle of ['id', 'published_at', 'agent_generated', 'created_at', 'updated_at']) {
      expect((await patch({ [cle]: 'x' })).status, cle).toBe(422);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('authentification et autorisation', () => {
  it('12. non authentifie -> 401, aucune lecture en base', async () => {
    authMock.mockResolvedValue(null);
    const { status } = await patch({ metadata: { musicUrl: 'x' } });
    expect(status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('13. post d un autre utilisateur -> 403, aucune ecriture', async () => {
    seed({ musicUrl: 'm' });
    readRow = { ...(readRow as object), user_id: 'user-2' } as Record<string, unknown>;

    const { status } = await patch({ metadata: { musicUrl: 'pirate' } });

    expect(status).toBe(403);
    expect(calls.filter((c) => c.op === 'write')).toHaveLength(0);
  });

  it('14. post inexistant -> 404', async () => {
    readRow = null;
    const { status } = await patch({ metadata: { musicUrl: 'x' } });
    expect(status).toBe(404);
  });

  it('15. aucune creation implicite : ni insert, ni upsert, ni delete', async () => {
    readRow = null;
    await patch({ metadata: { musicUrl: 'x' } }, 'inexistant');
    seed({});
    await patch({ metadata: { musicUrl: 'x' } });
    expect(calls.some((c) => c.op === 'insert' || c.op === 'upsert' || c.op === 'delete')).toBe(false);
  });

  it('une erreur de lecture ne fuit aucun detail', async () => {
    readError = { message: 'connexion postgres refusee sur 10.0.0.4:5432' };
    readRow = null;
    const { status, body } = await patch({ metadata: { musicUrl: 'x' } });
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('10.0.0.4');
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('concurrence', () => {
  it('19. une ecriture concurrente donne 409, pas un ecrasement silencieux', async () => {
    seed({ musicUrl: 'm' });
    writeRows = []; // la ligne a change entre la lecture et l ecriture

    const { status, body } = await patch({ metadata: { musicUrl: 'nouvelle' } });

    expect(status).toBe(409);
    expect(body.success).toBe(false);
  });

  it('la garde de version porte sur `updated_at`, lu juste avant', async () => {
    seed({ musicUrl: 'm' }, '2026-08-25T10:00:00.000+00:00');
    await patch({ metadata: { musicUrl: 'x' } });
    expect(lastWrite()?.filters).toStrictEqual({
      id: 'post-1',
      user_id: 'user-1',
      updated_at: '2026-08-25T10:00:00.000+00:00',
    });
  });

  it('aucune garde sans `metadata` : un lot d horaires ne doit pas se voir refuser', async () => {
    seed({ musicUrl: 'm' });
    await patch({ scheduled_time: '09:00:00' });
    expect(lastWrite()?.filters).toStrictEqual({ id: 'post-1', user_id: 'user-1' });
  });

  it('sans `updated_at` exploitable, on se degrade sans jamais inventer de conflit', async () => {
    seed({ musicUrl: 'm' }, null);
    await patch({ metadata: { musicUrl: 'x' } });
    expect(lastWrite()?.filters).toStrictEqual({ id: 'post-1', user_id: 'user-1' });

    calls.length = 0;
    seed({ musicUrl: 'm' }, null);
    writeRows = [];
    // Zero ligne SANS garde ne peut vouloir dire que « disparue », pas « conflit ».
    expect((await patch({ metadata: { musicUrl: 'x' } })).status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('effets de bord interdits', () => {
  const source = readFileSync(
    resolve(__dirname, '../app/api/posts/[id]/route.ts'),
    'utf-8',
  );

  it('16. la route ne touche jamais aux credits', async () => {
    expect(source).not.toMatch(/deductCredits|credits\/deduct|@\/lib\/credits/);
    seed({ musicUrl: 'm' });
    await patch({ metadata: { musicUrl: 'x' } });
    expect(calls.every((c) => c.table === 'scheduled_posts')).toBe(true);
  });

  it('17. la route ne declenche aucun rendu', () => {
    expect(source).not.toMatch(/composeAndUpload|video-composer|renderMedia|@remotion/);
  });

  it('18. la route ne publie sur aucune plateforme', () => {
    expect(source).not.toMatch(/publishTo|social\/publish|token-refresh|instagram|tiktok/i);
  });

  it('ne lit et n ecrit qu une seule table', async () => {
    seed({ musicUrl: 'm' });
    await patch({ metadata: { musicUrl: 'x' } });
    expect([...new Set(calls.map((c) => c.table))]).toEqual(['scheduled_posts']);
    expect(calls.filter((c) => c.op === 'read')).toHaveLength(1);
    expect(calls.filter((c) => c.op === 'write')).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('contrat public inchange', () => {
  it('20. les champs des appelants existants passent tels quels', async () => {
    // calendar/page.tsx:1379 — changement de date en lot
    seed({});
    await patch({ scheduled_date: '2026-09-01', scheduled_time: '09:30:00' });
    expect(lastWrite()?.patch).toStrictEqual({
      scheduled_date: '2026-09-01',
      scheduled_time: '09:30:00',
    });

    // calendar/page.tsx:806 — regeneration du montage
    calls.length = 0;
    seed({ posterUrl: 'p', design: { font: 'Anton' } });
    const { status } = await patch({
      media_url: 'https://media.exemple.test/montage.webm',
      media_type: 'video',
      metadata: { renderedVideoUrl: 'https://media.exemple.test/montage.webm', thumbnailUrl: 't' },
    });
    expect(status).toBe(200);
    expect(lastWrite()?.patch?.media_url).toBe('https://media.exemple.test/montage.webm');
    expect(lastWrite()?.patch?.media_type).toBe('video');
    // …et le design que ce lot n envoyait pas est desormais preserve, la ou
    // il etait efface avant cette phase.
    expect((lastWrite()?.patch?.metadata as Record<string, unknown>).design)
      .toStrictEqual({ font: 'Anton' });
  });

  it('la reponse garde la forme `{ success, data }`', async () => {
    seed({ musicUrl: 'm' });
    const { status, body } = await patch({ metadata: { musicUrl: 'x' } });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeTruthy();
    expect(body.data.id).toBe('post-1');
  });
});
