import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  AVATAR_URL_MAX_LENGTH,
  PROFILE_ALLOWED_FIELDS,
  isAcceptableAvatarUrl,
} from '@/lib/user/profile-payload';

/**
 * PATCH /api/user/profile — liste blanche.
 *
 * Ce que ces tests protegent : la route ecrivait le corps client tel quel sur
 * la table `users`, via la cle de service. `credits` et `plan` etaient donc
 * en libre-service, et `stripe_customer_id` ouvrait le portail de facturation
 * d'un tiers. La preuve recherchee n'est pas « la reponse est un 422 » mais
 * « l'objet transmis a PostgREST ne contient QUE avatar_url ».
 */

const authMock = vi.fn();

// ── Faux client Postgrest — temoin de ce qui atteint reellement la base ──
interface Call {
  table: string;
  op: 'read' | 'write' | 'insert' | 'upsert' | 'delete';
  filters: Record<string, unknown>;
  patch?: Record<string, unknown>;
}

const calls: Call[] = [];
let rows: unknown[] = [];
let dbError: unknown = null;

function makeQuery(table: string) {
  const call: Call = { table, op: 'read', filters: {} };
  const api: Record<string, unknown> = {
    select: () => api,
    update: (patch: Record<string, unknown>) => { call.op = 'write'; call.patch = patch; return api; },
    insert: () => { call.op = 'insert'; calls.push(call); throw new Error('insert interdit'); },
    upsert: () => { call.op = 'upsert'; calls.push(call); throw new Error('upsert interdit'); },
    delete: () => { call.op = 'delete'; calls.push(call); throw new Error('delete interdit'); },
    eq: (key: string, value: unknown) => { call.filters[key] = value; return api; },
    single: async () => { calls.push(call); return { data: rows[0] ?? null, error: dbError }; },
    maybeSingle: async () => { calls.push(call); return { data: rows[0] ?? null, error: dbError }; },
    then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => {
      calls.push(call);
      return Promise.resolve({ data: rows, error: dbError }).then(onOk, onErr);
    },
  };
  return api;
}

vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: (table: string) => makeQuery(table) },
  supabase: { from: (table: string) => makeQuery(table) },
}));

const { PATCH, GET } = await import('@/app/api/user/profile/route');

const patch = async (body: unknown) => {
  const res = await PATCH({ json: async () => body } as never);
  return { status: res.status, body: await res.json() };
};

const lastWrite = () => calls.filter((c) => c.op === 'write').at(-1);
/** Tout ce qui a ete transmis a PostgREST, toutes requetes confondues. */
const everythingWritten = () =>
  calls.filter((c) => c.op === 'write').flatMap((c) => Object.keys(c.patch ?? {}));

const ME = 'moi@exemple.test';
const ROW = { id: 'user-1', email: ME, name: 'Moi', avatar_url: '', credits: 10, plan: 'free' };
const AVATAR = 'https://cdn.exemple.test/avatar.png';

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  dbError = null;
  rows = [ROW];
  authMock.mockResolvedValue({ user: { id: 'user-1', email: ME } });
});

// ═══════════════════════════════════════════════════════════════════
describe('acces', () => {
  it('1. utilisateur non authentifie : 401, aucune requete en base', async () => {
    authMock.mockResolvedValue(null);
    const { status } = await patch({ avatar_url: AVATAR });
    expect(status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('1bis. une session sans e-mail ne cible aucune ligne', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    expect((await patch({ avatar_url: AVATAR })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('champ legitime', () => {
  it('2. avatar_url valide est ecrit, et lui seul', async () => {
    const { status, body } = await patch({ avatar_url: AVATAR });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual(ROW);
    expect(lastWrite()?.patch).toStrictEqual({ avatar_url: AVATAR });
  });

  it('accepte les trois formes d URL que l application produit reellement', async () => {
    for (const url of [
      AVATAR,                                        // https, fournisseur OAuth
      '/storage/v1/object/public/media/avatar.png',  // proxy interne post-MinIO
      '',                                            // retrait de l avatar (auth/config.ts:65)
      'http://localhost:3000/storage/v1/object/public/media/a.png', // dev local
    ]) {
      calls.length = 0;
      const { status } = await patch({ avatar_url: url });
      expect(status, url || '(vide)').toBe(200);
      expect(lastWrite()?.patch).toStrictEqual({ avatar_url: url });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('champs sensibles — ils n atteignent jamais PostgREST', () => {
  const sensibles: Array<[string, Record<string, unknown>]> = [
    ['3. credits', { credits: 999999 }],
    ['4. plan', { plan: 'enterprise' }],
    ['5a. role', { role: 'admin' }],
    ['5b. is_admin', { is_admin: true }],
    ['6. stripe_customer_id', { stripe_customer_id: 'cus_victime' }],
    ['7a. user_id', { user_id: 'user-2' }],
    ['7b. id', { id: 'user-2' }],
    ['8. email', { email: 'contact.artboost@gmail.com' }],
    ['blocked', { blocked: false }],
    ['deleted_at', { deleted_at: null }],
    ['subscription', { subscription: { plan: 'pro' } }],
    ['name', { name: 'Nouveau nom' }],
  ];

  it.each(sensibles)('%s seul : refus, aucune ecriture', async (_label, corps) => {
    const { status, body } = await patch(corps);
    // Aucun champ autorise ne reste apres filtrage → rien a ecrire.
    expect(status).toBe(422);
    expect(calls.filter((c) => c.op === 'write')).toHaveLength(0);
    expect(body.message).toContain(Object.keys(corps)[0]);
  });

  it('9. melange avatar_url + credits : avatar passe, credits N ATTEINT JAMAIS la base', async () => {
    const { status, body } = await patch({
      avatar_url: AVATAR,
      credits: 999999,
      plan: 'enterprise',
      role: 'admin',
      stripe_customer_id: 'cus_victime',
      email: 'contact.artboost@gmail.com',
    });

    expect(status).toBe(200);
    // LA preuve : l objet transmis a PostgREST, pas le code de retour.
    expect(lastWrite()?.patch).toStrictEqual({ avatar_url: AVATAR });
    expect(everythingWritten()).toEqual(['avatar_url']);
    for (const interdit of ['credits', 'plan', 'role', 'stripe_customer_id', 'email']) {
      expect(JSON.stringify(lastWrite()?.patch), interdit).not.toContain(interdit);
      expect(body.message).toContain(interdit);
    }
  });

  it('9bis. la totalite des colonnes de `users` en une requete : seul avatar_url survit', async () => {
    await patch({
      id: 'x', email: 'x@x.test', name: 'x', credits: 1, plan: 'enterprise',
      role: 'admin', blocked: false, deleted_at: null, avatar_url: AVATAR,
      stripe_customer_id: 'cus_x', created_at: '2020-01-01', updated_at: '2020-01-01',
      profile_image_url: 'x', branding: {},
    });
    expect(lastWrite()?.patch).toStrictEqual({ avatar_url: AVATAR });
  });

  it('10. charge utile sans aucun champ autorise : 422 et zero requete', async () => {
    for (const corps of [{}, { credits: 1 }, { inconnu: 'x' }]) {
      calls.length = 0;
      const { status } = await patch(corps);
      expect(status).toBe(422);
      expect(calls).toHaveLength(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('robustesse du champ avatar_url', () => {
  it('11. refuse les URL dangereuses ou d une forme inattendue', async () => {
    const mauvaises = [
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'blob:https://exemple.test/abc',
      'file:///etc/passwd',
      '//evil.test/avatar.png',              // protocole-relative
      'http://evil.test/avatar.png',         // http distant
      '/etc/passwd',                          // chemin local hors storage
      '/storage/../../etc/passwd',
      '   https://exemple.test/a.png',       // blanc de tete
      '\njavascript:alert(1)',
      'pas-une-url',
    ];
    for (const url of mauvaises) {
      calls.length = 0;
      const { status } = await patch({ avatar_url: url });
      expect(status, url).toBe(422);
      expect(calls, url).toHaveLength(0);
      expect(isAcceptableAvatarUrl(url), url).toBe(false);
    }
  });

  it('11bis. refuse un avatar_url qui n est pas une chaine', async () => {
    for (const valeur of [42, true, null, { url: AVATAR }, ['x']]) {
      calls.length = 0;
      expect((await patch({ avatar_url: valeur })).status).toBe(422);
      expect(calls).toHaveLength(0);
    }
  });

  it('12. refuse une charge utile trop longue', async () => {
    const trop = `https://cdn.exemple.test/${'a'.repeat(AVATAR_URL_MAX_LENGTH)}`;
    expect(trop.length).toBeGreaterThan(AVATAR_URL_MAX_LENGTH);
    const { status } = await patch({ avatar_url: trop });
    expect(status).toBe(422);
    expect(calls).toHaveLength(0);
    // La limite elle-meme est acceptee.
    const pile = `https://e.test/${'a'.repeat(AVATAR_URL_MAX_LENGTH - 'https://e.test/'.length)}`;
    expect(pile.length).toBe(AVATAR_URL_MAX_LENGTH);
    expect(isAcceptableAvatarUrl(pile)).toBe(true);
  });

  it('13. refuse les cles de pollution de prototype, sans rien ecrire', async () => {
    const charges = [
      JSON.parse('{"__proto__":{"credits":999},"avatar_url":"https://e.test/a.png"}'),
      JSON.parse('{"constructor":{"credits":999}}'),
      JSON.parse('{"avatar_url":"https://e.test/a.png","prototype":{"x":1}}'),
    ];
    for (const charge of charges) {
      calls.length = 0;
      const { status } = await patch(charge);
      expect(status).toBe(422);
      expect(calls).toHaveLength(0);
    }
    expect(({} as Record<string, unknown>).credits).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'credits')).toBe(false);
  });

  it('refuse un corps qui n est pas un objet', async () => {
    for (const corps of [['x'], 'texte', 42, null]) {
      calls.length = 0;
      expect((await patch(corps)).status).toBe(422);
      expect(calls).toHaveLength(0);
    }
  });

  it('un corps JSON illisible donne 400, pas 500', async () => {
    const res = await PATCH({ json: async () => { throw new SyntaxError('bad'); } } as never);
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('identite et effets de bord', () => {
  it('14. la ligne ciblee vient de la session, jamais du corps', async () => {
    await patch({ avatar_url: AVATAR, email: 'victime@exemple.test', id: 'user-2', user_id: 'user-2' });
    expect(lastWrite()?.filters).toStrictEqual({ email: ME });
  });

  it('15. aucune ecriture ne vise un autre utilisateur', async () => {
    await patch({ avatar_url: AVATAR, email: 'victime@exemple.test' });
    const filtres = calls.filter((c) => c.op === 'write').map((c) => c.filters);
    expect(filtres).toEqual([{ email: ME }]);
    expect(JSON.stringify(filtres)).not.toContain('victime');
  });

  it('16. aucune operation insert, upsert ou delete', async () => {
    await patch({ avatar_url: AVATAR });
    await patch({ credits: 1 });
    expect(calls.some((c) => ['insert', 'upsert', 'delete'].includes(c.op))).toBe(false);
    // …et donc aucune creation implicite : `.update()` sur zero ligne -> 404.
    calls.length = 0;
    rows = [];
    const { status } = await patch({ avatar_url: AVATAR });
    expect(status).toBe(404);
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });

  it('une erreur base ne fuit aucun detail', async () => {
    dbError = { message: 'postgres 10.0.0.4:5432 refuse la connexion' };
    const { status, body } = await patch({ avatar_url: AVATAR });
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('10.0.0.4');
  });

  it('n ecrit que dans la table users', async () => {
    await patch({ avatar_url: AVATAR });
    expect([...new Set(calls.map((c) => c.table))]).toEqual(['users']);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('les autres methodes de la route sont inchangees', () => {
  it('17. GET : 401 sans session, 200 avec, meme forme de reponse', async () => {
    authMock.mockResolvedValue(null);
    const refus = await GET({} as never);
    expect(refus.status).toBe(401);

    authMock.mockResolvedValue({ user: { id: 'user-1', email: ME } });
    const ok = await GET({} as never);
    expect(ok.status).toBe(200);
    const corps = await ok.json();
    expect(corps.success).toBe(true);
    expect(corps.data).toEqual(ROW);
  });

  it('17bis. le GET n a pas ete reecrit', () => {
    const source = readFileSync(
      resolve(__dirname, '../app/api/user/profile/route.ts'),
      'utf-8',
    );
    const get = source.slice(source.indexOf('export async function GET'), source.indexOf('/**\n * PATCH'));
    expect(get).toContain("if (!session?.user?.email)");
    expect(get).toContain(".eq('email', session.user.email)");
    expect(get).toContain("'Failed to fetch profile'");
    // La liste blanche ne concerne que l ecriture.
    expect(get).not.toContain('parseProfilePayload');
  });

  it('la liste blanche ne contient que avatar_url', () => {
    expect([...PROFILE_ALLOWED_FIELDS]).toEqual(['avatar_url']);
  });
});
