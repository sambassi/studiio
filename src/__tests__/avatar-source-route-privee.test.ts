// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * AVATAR-2B — `GET /api/avatar/source` : la source d'enrôlement (le visage)
 * se lit par une route authentifiée, et par elle seule.
 *
 * Ce que ces tests prouvent :
 * - 401 sans session, avant toute lecture ;
 * - 200 pour l'avatar ACTIF du compte, par `source_object_key` ou, à défaut,
 *   par la clé DÉRIVÉE du `source_url` historique ;
 * - 404 UNIFORME pour tout le reste : pas d'avatar, supprimé, aucune clé,
 *   clé d'autrui (même écrite en base), vidéo générée, autre namespace,
 *   `source_url` forgé, objet absent — et MinIO n'est pas consulté quand la
 *   clé est refusée avant lui ;
 * - le navigateur ne désigne rien : `?v=`, `?cle=`, en-têtes — ignorés ;
 * - en-têtes : type décidé par la clé, longueur, nosniff, inline, private.
 */

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRUI = 'bbbbbbbb-2222-4222-8222-222222222222';
const A = '11111111-1111-4111-8111-000000000001';
const GEN = '11111111-1111-4111-8111-000000000009';
const RELAIS = 'https://studiio.pro/storage/v1/object/public/media';

interface Ligne {
  id: string; user_id: string; source_object_key: string | null; source_url: string | null;
  deleted_at: string | null; created_at: string;
}

const etat = vi.hoisted(() => ({
  lignes: [] as Ligne[],
  requetes: [] as string[],
  objets: new Map<string, number>(),
  stats: [] as string[],
  lectures: [] as string[],
}));

vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => {
    if (table !== 'user_avatars') throw new Error(`table inattendue ${table}`);
    const filtres: Array<(l: Ligne) => boolean> = [];
    const journal: string[] = [];
    const api = {
      select() { return api; },
      eq(k: keyof Ligne, v: unknown) { journal.push(`eq:${k}`); filtres.push((l) => l[k] === v); return api; },
      is(k: keyof Ligne, v: unknown) { journal.push(`is:${k}`); filtres.push((l) => l[k] === v); return api; },
      order() { return api; },
      async limit(n: number) {
        etat.requetes.push(journal.join(','));
        const rows = etat.lignes.filter((l) => filtres.every((f) => f(l)))
          .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, n);
        return { data: rows, error: null };
      },
    };
    return api;
  };
  return { supabase: {}, supabaseAdmin: { from } };
});

vi.mock('@/lib/storage/minio-client', async () => {
  const { Readable } = await import('node:stream');
  return {
    clientMinio: () => ({
      statObject: async (_b: string, cle: string) => {
        etat.stats.push(cle);
        const taille = etat.objets.get(cle);
        if (taille === undefined) throw Object.assign(new Error('Not Found'), { code: 'NotFound' });
        return { size: taille };
      },
    }),
    lecteurMinio: () => ({
      getObject: async (_b: string, cle: string) => {
        etat.lectures.push(cle);
        return Readable.from([Buffer.alloc(etat.objets.get(cle) ?? 0, 7)]);
      },
    }),
  };
});

const session = vi.hoisted(() => ({ courante: null as unknown }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => session.courante }));

// La route lit la configuration au moment de l'appel : l'origine légitime
// est celle de l'application, pas un hôte codé en dur.
process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';
delete process.env.PUBLIC_STORAGE_URL;

const { GET } = await import('@/app/api/avatar/source/route');

const ligne = (over: Partial<Ligne> = {}): Ligne => ({
  id: A, user_id: U, source_object_key: `${U}/avatar/source-1.mp4`, source_url: null,
  deleted_at: null, created_at: '2026-09-01T00:00:00.000Z', ...over,
});

beforeEach(() => {
  etat.lignes = [ligne()];
  etat.requetes.length = 0; etat.stats.length = 0; etat.lectures.length = 0;
  etat.objets.clear();
  etat.objets.set(`${U}/avatar/source-1.mp4`, 2048);
  session.courante = { user: { id: U } };
});

describe('GET /api/avatar/source — accès', () => {
  it('401 sans session, avant toute lecture', async () => {
    session.courante = null;
    const res = await GET();
    expect(res.status).toBe(401);
    expect(etat.requetes).toEqual([]);
    expect(etat.stats).toEqual([]);
  });

  it('200 : l’avatar actif du compte, par source_object_key ; en-têtes complets', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(res.headers.get('content-length')).toBe('2048');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-disposition')).toBe('inline');
    expect(res.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(Buffer.from(await res.arrayBuffer()).length).toBe(2048);
    expect(etat.lectures).toEqual([`${U}/avatar/source-1.mp4`]);
    // La ligne est cherchée par compte ET vivante.
    expect(etat.requetes[0]).toContain('eq:user_id');
    expect(etat.requetes[0]).toContain('is:deleted_at');
  });

  it('200 : une source au NOUVEAU format (nonce) est servie, comme l’ancien', async () => {
    const cle = `${U}/avatar/source-1757900000000-${'d'.repeat(32)}.webm`;
    etat.lignes = [ligne({ source_object_key: cle })];
    etat.objets.set(cle, 777);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('video/webm');
    expect(res.headers.get('content-length')).toBe('777');
    expect(etat.lectures).toEqual([cle]);
  });

  it('200 : une photo legacy (source_url seul) est servie via la clé dérivée, en image/jpeg', async () => {
    const cle = `${U}/avatar/source-1757000000000.jpg`;
    etat.lignes = [ligne({ source_object_key: null, source_url: `${RELAIS}/${cle}` })];
    etat.objets.set(cle, 512);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('content-length')).toBe('512');
    expect(etat.lectures).toEqual([cle]);
  });

  it('⚠️ le navigateur ne désigne rien : la clé vient de la base, quoi qu’il envoie', async () => {
    // La route ne prend aucun argument : rien de ce qu'une requête porterait
    // (query `?v=`, `?cle=…`, en-tête) ne peut atteindre le choix de la clé.
    expect(GET.length).toBe(0);
    const res = await GET();
    expect(etat.lectures).toEqual([`${U}/avatar/source-1.mp4`]);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/avatar/source — 404 uniforme, MinIO non consulté quand la clé est refusée', () => {
  const attendre404 = async (sansStockage = true) => {
    const res = await GET();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Source introuvable.' });
    if (sansStockage) { expect(etat.stats).toEqual([]); expect(etat.lectures).toEqual([]); }
  };

  it('aucun avatar', async () => { etat.lignes = []; await attendre404(); });

  it('avatar supprimé (deleted_at) — même si sa source existe encore', async () => {
    etat.lignes = [ligne({ deleted_at: '2026-09-15T00:00:00Z' })];
    await attendre404();
  });

  it('aucune clé : ni source_object_key ni source_url', async () => {
    etat.lignes = [ligne({ source_object_key: null, source_url: null })];
    await attendre404();
  });

  it('⚠️ l’avatar d’un autre compte n’est jamais vu (filtre user_id)', async () => {
    etat.lignes = [ligne({ user_id: AUTRUI })];
    await attendre404();
  });

  it('⚠️ source_object_key d’AUTRUI écrit en base sur ma ligne → refusé avant le stockage', async () => {
    etat.lignes = [ligne({ source_object_key: `${AUTRUI}/avatar/source-1.mp4` })];
    etat.objets.set(`${AUTRUI}/avatar/source-1.mp4`, 10);
    await attendre404();
  });

  it('⚠️ source_object_key = vidéo générée → refusé (jamais servie par ce chemin)', async () => {
    etat.lignes = [ligne({ source_object_key: `${U}/avatar/${GEN}.mp4` })];
    etat.objets.set(`${U}/avatar/${GEN}.mp4`, 10);
    await attendre404();
  });

  it('source_object_key d’un autre namespace, traversée, malformée → refusés', async () => {
    for (const cle of [`${U}/lut/source-1.mp4`, `${U}/avatar/../${AUTRUI}/avatar/source-1.mp4`, `${U}/avatar/source-.mp4`, 'converted/source-1.mp4']) {
      etat.lignes = [ligne({ source_object_key: cle })];
      etat.objets.set(cle, 10);
      await attendre404();
    }
  });

  it('⚠️ DOMAINE FORGÉ avec le chemin exact du relais → 404, sans appel MinIO', async () => {
    etat.lignes = [ligne({ source_object_key: null, source_url: `https://evil.example/storage/v1/object/public/media/${U}/avatar/source-1.jpg` })];
    etat.objets.set(`${U}/avatar/source-1.jpg`, 10);
    await attendre404();
  });

  it('⚠️ source_url forgé : autre compte, autre bucket, autre namespace, génération, sous-domaine, userinfo, port, query → refusé', async () => {
    for (const url of [
      `https://studiio.pro.evil.example/storage/v1/object/public/media/${U}/avatar/source-1.jpg`,
      `https://studiio.pro@evil.example/storage/v1/object/public/media/${U}/avatar/source-1.jpg`,
      `https://studiio.pro:8443/storage/v1/object/public/media/${U}/avatar/source-1.jpg`,
      `http://studiio.pro/storage/v1/object/public/media/${U}/avatar/source-1.jpg`,
      `${RELAIS}/${AUTRUI}/avatar/source-1.jpg`,
      `https://studiio.pro/storage/v1/object/public/videos/${U}/avatar/source-1.jpg`,
      `${RELAIS}/${U}/lut/source-1.jpg`,
      `${RELAIS}/${U}/avatar/${GEN}.mp4`,
      `https://evil.example/${U}/avatar/source-1.jpg`,
      `${RELAIS}/${U}/avatar/source-1.jpg?x=${RELAIS}/${U}/avatar/source-2.jpg`,
    ]) {
      etat.lignes = [ligne({ source_object_key: null, source_url: url })];
      etat.objets.set(`${U}/avatar/source-1.jpg`, 10);
      etat.objets.set(`${AUTRUI}/avatar/source-1.jpg`, 10);
      await attendre404();
    }
  });

  it('objet MinIO absent → 404, sans 500 ni détail', async () => {
    etat.objets.clear();
    const res = await GET();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Source introuvable.' });
    expect(etat.lectures).toEqual([]);
  });

  it('objet vide (0 octet) → 404', async () => {
    etat.objets.set(`${U}/avatar/source-1.mp4`, 0);
    await attendre404(false);
  });
});
