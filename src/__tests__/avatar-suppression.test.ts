// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * AVATAR-2C — `DELETE /api/avatar` : suppression LOGIQUE de l'avatar.
 *
 * Doublures : une base en mémoire qui applique VRAIMENT les filtres et rend
 * le nombre de lignes touchées, avec pannes injectables (`erreur` : rien
 * appliqué ; `fantome` : appliqué puis réponse perdue) ; un stockage
 * journalisé ; pas de HeyGen (le client n'a pas d'opération de suppression,
 * et la route ne doit pas l'importer).
 *
 * Ce que ces tests verrouillent : jamais de DELETE physique ; `deleted_at`
 * par CAS (id, user_id, version, deleted_at is null) ; générations et vidéos
 * intactes ; la source (clé canonique OU legacy) retirée APRÈS la ligne, et
 * jamais la clé d'une nouvelle version vivante ; double clic idempotent ;
 * version remplacée pendant la suppression → 409 sans rien retirer ; erreur
 * DB avant → 500 sans rien ; erreur DB ambiguë après → relecture ; erreur
 * stockage → ligne supprimée, pointeur conservé, `sourceRetiree:false` ;
 * fournisseur → `non_disponible`, jamais un faux succès.
 */

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRUI = 'bbbbbbbb-2222-4222-8222-222222222222';
const A = '11111111-1111-4111-8111-000000000001';
const CLE = `${U}/avatar/source-1757000000000-${'a'.repeat(32)}.mp4`;
const CLE_LEGACY = `${U}/avatar/source-1757000000000.jpg`;
const URL_LEGACY = `https://studiio.pro/storage/v1/object/public/media/${CLE_LEGACY}`;

type Op = 'select' | 'update';
interface Panne { op: Op; occurrence: number; mode: 'erreur' | 'fantome' }
interface Ligne { [k: string]: unknown; id: string; user_id: string; version: number; deleted_at: string | null; source_object_key: string | null; source_url: string | null; provider_avatar_id: string | null; created_at: string }

const base = vi.hoisted(() => ({
  avatars: [] as Ligne[],
  generations: [] as Array<Record<string, unknown>>,
  journal: [] as string[],
  pannes: [] as Panne[],
  executions: { select: 0, update: 0 } as Record<Op, number>,
  /** Crochets déterministes : juste avant / juste après la N-ième update. */
  crochets: { avantUpdate: null as null | ((n: number) => void), apresUpdate: null as null | ((n: number) => void) },
}));
const stockage = vi.hoisted(() => ({ objets: new Set<string>(), journal: [] as string[], panne: false }));
const chrono = vi.hoisted(() => ({ evenements: [] as string[] }));

vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => {
    if (table !== 'user_avatars') throw new Error(`table inattendue ${table} — aucune écriture sur avatar_generations n'est permise`);
    const filtres: Array<(l: Ligne) => boolean> = [];
    const clesFiltre: string[] = [];
    let op: Op = 'select';
    let patch: Record<string, unknown> | null = null;
    let colonnes: string[] | null = null;
    let tri = false;
    let limite: number | undefined;
    const projeter = (l: Ligne) => (colonnes ? Object.fromEntries(colonnes.map((c) => [c, l[c]])) : { ...l });
    const reel = () => {
      let rows = base.avatars.filter((l) => filtres.every((f) => f(l)));
      if (op === 'update') {
        if (Object.keys(patch!).some((k) => k === 'id' || k === 'user_id')) throw new Error('mutation interdite');
        base.journal.push(`update:${Object.keys(patch!).sort().join(',')}:${rows.length}`);
        base.journal.push(`filtres:${clesFiltre.join(',')}`);
        chrono.evenements.push(`db:update:${Object.keys(patch!).sort().join(',')}:${rows.length}`);
        for (const l of rows) Object.assign(l, patch);
        return { data: rows.map(projeter), error: null };
      }
      if (tri) rows = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
      if (limite !== undefined) rows = rows.slice(0, limite);
      return { data: rows.map(projeter), error: null };
    };
    const executer = () => {
      base.executions[op] += 1;
      const panne = base.pannes.find((x) => x.op === op && x.occurrence === base.executions[op]);
      if (panne?.mode === 'erreur') { chrono.evenements.push(`db:${op}:PANNE`); return { data: null, error: { message: `panne ${op} #${panne.occurrence}` } }; }
      if (op === 'update') base.crochets.avantUpdate?.(base.executions.update);
      const r = reel();
      if (op === 'update') base.crochets.apresUpdate?.(base.executions.update);
      if (panne?.mode === 'fantome') { chrono.evenements.push(`db:${op}:FANTOME`); return { data: null, error: { message: `reponse perdue ${op} #${panne.occurrence}` } }; }
      return r;
    };
    const api = {
      select(c?: string) { if (c && c !== '*') colonnes = c.split(',').map((x) => x.trim()); return api; },
      update(p: Record<string, unknown>) { op = 'update'; patch = p; return api; },
      delete() { throw new Error('DELETE physique interdit'); },
      eq(k: string, v: unknown) { clesFiltre.push(`eq:${k}`); filtres.push((l) => l[k] === v); return api; },
      is(k: string, v: unknown) { clesFiltre.push(`is:${k}`); filtres.push((l) => l[k] === v); return api; },
      not(k: string, opr: string, v: unknown) { if (opr !== 'is') throw new Error(opr); clesFiltre.push(`not:${k}`); filtres.push((l) => l[k] !== v); return api; },
      order() { tri = true; return api; },
      async limit(n: number) { limite = n; return executer(); },
      then(resolve: (v: unknown) => void, reject: (e: unknown) => void) { return Promise.resolve().then(executer).then(resolve, reject); },
    };
    return api;
  };
  return {
    supabase: {},
    supabaseAdmin: {
      from,
      storage: {
        from: () => ({
          async remove(cles: string[]) {
            if (stockage.panne) return { data: null, error: { message: 'minio KO' } };
            for (const c of cles) { stockage.journal.push(`remove:${c}`); chrono.evenements.push(`stockage:remove:${c}`); stockage.objets.delete(c); }
            return { data: cles, error: null };
          },
        }),
      },
    },
  };
});

const session = vi.hoisted(() => ({ courante: null as unknown }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => session.courante }));
vi.mock('@/lib/avatar/heygen', () => { throw new Error('la suppression ne doit pas importer le client HeyGen'); });

process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';
const { DELETE } = await import('@/app/api/avatar/route');


const avatar = (over: Partial<Ligne> = {}): Ligne => ({
  id: A, user_id: U, version: 2, deleted_at: null, source_object_key: CLE, source_url: null,
  provider_avatar_id: 'hg-1', created_at: '2026-09-01T00:00:00.000Z', status: 'completed', ...over,
});
const generation = (avatarId: string | null) => ({ id: 'gen-1', user_id: U, user_avatar_id: avatarId, avatar_version: 2, video_url: `/x/${U}/avatar/gen-1.mp4`, status: 'completed' });
const removes = () => stockage.journal.filter((j) => j.startsWith('remove:')).map((j) => j.slice(7));
const ligne = (id = A) => base.avatars.find((l) => l.id === id)!;

beforeEach(() => {
  base.avatars = [avatar()]; base.generations = [generation(A)]; base.journal.length = 0;
  base.pannes = []; base.executions = { select: 0, update: 0 }; base.crochets = { avantUpdate: null, apresUpdate: null };
  stockage.objets = new Set([CLE, `${U}/avatar/gen-1.mp4`]); stockage.journal.length = 0; stockage.panne = false;
  chrono.evenements.length = 0;
  session.courante = { user: { id: U } };
});

describe('DELETE /api/avatar — suppression normale', () => {
  it('⚠️ deleted_at posé par CAS, source retirée APRÈS la ligne, pointeurs effacés, génération et vidéo intactes, fournisseur non_disponible', async () => {
    const res = await DELETE();
    expect(res.status).toBe(200);
    const corps = await res.json() as { data: Record<string, unknown> };
    expect(corps.data).toEqual({ avatarId: A, version: 2, dejaSupprime: false, sourceRetiree: true, fournisseur: 'non_disponible' });
    const l = ligne();
    expect(l.deleted_at).not.toBeNull();
    expect(l.source_object_key).toBeNull();
    expect(l.source_url).toBeNull();
    // Conservés : la ligne (pas de DELETE), id, version, provider, la génération et sa vidéo.
    expect(base.avatars).toHaveLength(1);
    expect(l.provider_avatar_id).toBe('hg-1');
    expect(base.generations).toEqual([generation(A)]);
    expect(stockage.objets.has(`${U}/avatar/gen-1.mp4`)).toBe(true);
    expect(removes()).toEqual([CLE]);
    // Ordre : deleted_at (1 ligne) → remove → pointeurs.
    expect(chrono.evenements).toEqual([`db:update:deleted_at:1`, `stockage:remove:${CLE}`, 'db:update:source_object_key,source_url:1']);
    // ⚠️ Le CAS porte id, user_id, version ET deleted_at is null — les quatre, toujours.
    expect(base.journal[1]).toBe('filtres:eq:id,eq:user_id,eq:version,is:deleted_at');
    // L'effacement des pointeurs ne vise que la ligne SUPPRIMÉE du compte.
    expect(base.journal[3]).toBe('filtres:eq:id,eq:user_id,not:deleted_at');
  });

  it('source LEGACY (source_url seul) : la clé dérivée est retirée, source_url effacé', async () => {
    base.avatars = [avatar({ source_object_key: null, source_url: URL_LEGACY })];
    stockage.objets.add(CLE_LEGACY);
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(removes()).toEqual([CLE_LEGACY]);
    expect(ligne().source_url).toBeNull();
  });

  it('source_url legacy FORGÉ (autre compte / domaine) : rien n’est retiré, ligne supprimée quand même', async () => {
    base.avatars = [avatar({ source_object_key: null, source_url: `https://studiio.pro/storage/v1/object/public/media/${AUTRUI}/avatar/source-1.jpg` })];
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect((await res.json() as { data: { sourceRetiree: boolean } }).data.sourceRetiree).toBe(true);
    expect(removes()).toEqual([]);
    expect(ligne().deleted_at).not.toBeNull();
  });

  it('source absente du stockage : suppression idempotente (200, sourceRetiree true)', async () => {
    stockage.objets.delete(CLE);
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect((await res.json() as { data: { sourceRetiree: boolean } }).data.sourceRetiree).toBe(true);
  });

  it('⚠️ AUCUN DELETE physique n’est jamais émis (le double lève sur .delete())', async () => {
    const src = (await import('node:fs')).readFileSync((await import('node:path')).resolve(__dirname, '../lib/avatar/suppression.ts'), 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    expect(code).not.toMatch(/\.delete\(/);
    expect(code).not.toMatch(/avatar_generations/);
    await DELETE();
    expect(base.avatars).toHaveLength(1);
  });
});

describe('DELETE /api/avatar — refus et absence', () => {
  it('sans session → 401, rien lu', async () => {
    session.courante = null;
    expect((await DELETE()).status).toBe(401);
    expect(base.executions.select).toBe(0);
  });

  it('aucun avatar vivant → 404 ; avatar déjà supprimé → 404 aussi (il n’est plus « le mien »)', async () => {
    base.avatars = [];
    expect((await DELETE()).status).toBe(404);
    base.avatars = [avatar({ deleted_at: '2026-09-15T00:00:00Z' })];
    expect((await DELETE()).status).toBe(404);
    expect(removes()).toEqual([]);
  });

  it('⚠️ l’avatar d’un autre compte n’est jamais vu ni touché', async () => {
    base.avatars = [avatar({ user_id: AUTRUI, source_object_key: `${AUTRUI}/avatar/source-1.mp4` })];
    stockage.objets.add(`${AUTRUI}/avatar/source-1.mp4`);
    expect((await DELETE()).status).toBe(404);
    expect(ligne().deleted_at).toBeNull();
    expect(removes()).toEqual([]);
  });
});

describe('DELETE /api/avatar — concurrence', () => {
  it('⚠️ double clic : deux requêtes → une seule écriture de deleted_at, la seconde dejaSupprime, source retirée une fois, aucune erreur', async () => {
    const [a, b] = await Promise.all([DELETE(), DELETE()]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const corps = await Promise.all([a.json(), b.json()]) as Array<{ data: { dejaSupprime: boolean } }>;
    expect(corps.map((c) => c.data.dejaSupprime).sort()).toEqual([false, true]);
    expect(base.journal.filter((j) => j.startsWith('update:deleted_at:1'))).toHaveLength(1);
    expect(base.journal.filter((j) => j.startsWith('update:deleted_at:0'))).toHaveLength(1);
    expect(stockage.objets.has(CLE)).toBe(false);
    expect(ligne().deleted_at).not.toBeNull();
  });

  it('⚠️ version remplacée pendant la suppression (v2 → v3 entre lecture et CAS) → 409, rien supprimé, source de v3 intacte', async () => {
    const CLE_V3 = `${U}/avatar/source-1757000000001-${'c'.repeat(32)}.mp4`;
    stockage.objets.add(CLE_V3);
    // Juste avant notre CAS : un remplacement a fait passer la ligne en v3.
    base.crochets.avantUpdate = (n) => { if (n === 1) Object.assign(ligne(), { version: 3, source_object_key: CLE_V3 }); };
    const res = await DELETE();
    expect(res.status).toBe(409);
    expect((await res.json() as { code: string }).code).toBe('avatar_superseded');
    expect(ligne().deleted_at).toBeNull();
    expect(ligne().version).toBe(3);
    expect(stockage.objets.has(CLE_V3)).toBe(true);
    expect(stockage.objets.has(CLE)).toBe(true);
    expect(removes()).toEqual([]);
  });

  it('⚠️ une NOUVELLE ligne vivante (réinscription) apparue après le CAS et avant le retrait : sa clé est protégée, même confondue', async () => {
    // Juste après notre deleted_at : le compte se réinscrit, nouvelle ligne v1 dont la clé est… la même (cas limite).
    base.crochets.apresUpdate = (n) => {
      if (n === 1) base.avatars.push(avatar({ id: '11111111-1111-4111-8111-000000000002', version: 1, source_object_key: CLE, created_at: '2026-09-16T00:00:00.000Z' }));
    };
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect((await res.json() as { data: { sourceRetiree: boolean } }).data.sourceRetiree).toBe(false);
    expect(removes()).toEqual([]);
    expect(stockage.objets.has(CLE)).toBe(true);
    // L'ancienne ligne est supprimée et garde son pointeur ; la nouvelle vit.
    expect(ligne().deleted_at).not.toBeNull();
    expect(ligne('11111111-1111-4111-8111-000000000002').deleted_at).toBeNull();
  });
});

describe('DELETE /api/avatar — erreurs DB et stockage', () => {
  it('erreur DB AVANT la mutation (lecture) → 500, rien écrit, rien retiré', async () => {
    base.pannes = [{ op: 'select', occurrence: 1, mode: 'erreur' }];
    const res = await DELETE();
    expect(res.status).toBe(500);
    expect((await res.json() as { code: string }).code).toBe('avatar_delete_lecture_impossible');
    expect(ligne().deleted_at).toBeNull();
    expect(removes()).toEqual([]);
  });

  it('⚠️ erreur DB AMBIGUË après la mutation (deleted_at posé, réponse perdue) → relecture → on continue, source retirée', async () => {
    base.pannes = [{ op: 'update', occurrence: 1, mode: 'fantome' }];
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect((await res.json() as { data: { dejaSupprime: boolean; sourceRetiree: boolean } }).data).toMatchObject({ dejaSupprime: false, sourceRetiree: true });
    expect(ligne().deleted_at).not.toBeNull();
    expect(removes()).toEqual([CLE]);
  });

  it('erreur DB sans commit (ligne toujours vivante) → 500 ecriture_impossible, rien retiré', async () => {
    base.pannes = [{ op: 'update', occurrence: 1, mode: 'erreur' }];
    const res = await DELETE();
    expect(res.status).toBe(500);
    expect((await res.json() as { code: string }).code).toBe('avatar_delete_ecriture_impossible');
    expect(ligne().deleted_at).toBeNull();
    expect(removes()).toEqual([]);
  });

  it('erreur DB à la relecture après état ambigu → 500, rien retiré', async () => {
    base.pannes = [{ op: 'update', occurrence: 1, mode: 'fantome' }, { op: 'select', occurrence: 2, mode: 'erreur' }];
    const res = await DELETE();
    expect(res.status).toBe(500);
    expect(removes()).toEqual([]);
  });

  it('⚠️ relecture de la ligne vivante impossible avant le retrait → ligne supprimée, source CONSERVÉE (sourceRetiree false)', async () => {
    base.pannes = [{ op: 'select', occurrence: 2, mode: 'erreur' }];
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect((await res.json() as { data: { sourceRetiree: boolean } }).data.sourceRetiree).toBe(false);
    expect(ligne().deleted_at).not.toBeNull();
    expect(ligne().source_object_key).toBe(CLE);
    expect(removes()).toEqual([]);
  });

  it('⚠️ erreur STOCKAGE : ligne supprimée, pointeur conservé pour un nettoyage ultérieur, sourceRetiree false', async () => {
    stockage.panne = true;
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect((await res.json() as { data: { sourceRetiree: boolean } }).data.sourceRetiree).toBe(false);
    expect(ligne().deleted_at).not.toBeNull();
    expect(ligne().source_object_key).toBe(CLE);
    expect(base.journal.some((j) => j.startsWith('update:source_object_key'))).toBe(false);
  });
});
