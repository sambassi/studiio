// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * AVATAR-2A — `POST /api/avatar/create` remplace SANS effacer.
 *
 * La route est appelée pour de vrai. Trois doublures :
 * - la base : une table `user_avatars` en mémoire qui applique VRAIMENT les
 *   filtres (`eq`, `is`), l'index « un seul avatar vivant par compte »
 *   (23505) et rend le nombre de lignes touchées par un `update` ;
 * - le stockage : `upload` (refuse d'écraser) et `remove`, journalisés ;
 * - HeyGen : succès, échec, ou réponse RETENUE jusqu'à ce que le test la
 *   libère — c'est ce qui permet de prouver qu'une réponse périmée ne peut
 *   pas parler pour une version plus récente.
 *
 * Ce que ces tests verrouillent : plus de DELETE ; même `id` ; version+1 ;
 * `source_object_key` autorité, `source_url` NULL ; l'ancienne source
 * retirée APRÈS la transition seulement ; la source d'une requête perdante
 * retirée sans jamais toucher la gagnante ; le fournisseur APRÈS la base et
 * incapable d'écrire sur une autre version ; les générations jamais touchées.
 */

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRUI = 'bbbbbbbb-2222-4222-8222-222222222222';

interface Ligne { [k: string]: unknown; id: string; user_id: string; version: number; deleted_at: string | null; created_at: string; source_object_key: string | null; source_url: string | null }

/** La CHRONOLOGIE commune à la base, au stockage et au fournisseur : l'ordre est le contrat. */
const chrono = vi.hoisted(() => ({ evenements: [] as string[] }));

type Op = 'select' | 'insert' | 'update';
/**
 * Une PANNE injectée : à la `occurrence`-ième exécution de `op`,
 * - `erreur`  : la base répond une erreur SANS rien appliquer ;
 * - `fantome` : la base APPLIQUE la mutation puis répond une erreur — le
 *   commit incertain (réponse perdue après écriture).
 */
interface Panne { op: Op; occurrence: number; mode: 'erreur' | 'fantome' }
const base = vi.hoisted(() => ({
  avatars: [] as Ligne[],
  generations: [] as Array<Record<string, unknown>>,
  journal: [] as string[],
  compteur: 0,
  pannes: [] as Panne[],
  executions: { select: 0, insert: 0, update: 0 } as Record<Op, number>,
}));
const stockage = vi.hoisted(() => ({
  objets: new Map<string, number>(),
  journal: [] as string[],
  refuserUpload: false,
}));
/** L'aléa, contrôlable : `constant` force deux clés IDENTIQUES (voir le test « clés confondues »). */
const alea = vi.hoisted(() => ({ constant: null as null | string }));
vi.mock('node:crypto', async () => {
  const reel = await vi.importActual<typeof import('node:crypto')>('node:crypto');
  return {
    ...reel,
    randomBytes: (n: number) => (alea.constant ? Buffer.from(alea.constant.slice(0, n * 2), 'hex') : reel.randomBytes(n)),
  };
});

const heygen = vi.hoisted(() => ({
  mode: 'ok' as 'ok' | 'echec' | 'retenu',
  appels: [] as string[],
  liberer: null as null | ((r: { ok: boolean }) => void),
  compteur: 0,
  /** Le statut d'entraînement (GET) : rendu tout de suite, ou RETENU jusqu'à `libererStatut`. */
  statut: { status: 'completed' } as { status: string; error?: string } | null,
  statutRetenu: false,
  libererStatut: null as null | (() => void),
}));

vi.mock('@/lib/db/supabase', () => {
  const uuid = () => `11111111-1111-4111-8111-${String(++base.compteur).padStart(12, '0')}`;
  const from = (table: string) => {
    if (table !== 'user_avatars') throw new Error(`table inattendue ${table}`);
    const filtres: Array<(l: Ligne) => boolean> = [];
    let op: 'select' | 'insert' | 'update' = 'select';
    let patch: Record<string, unknown> | null = null;
    let insertion: Record<string, unknown> | null = null;
    let colonnes: string[] | null = null;
    let tri = false;
    let limite: number | undefined;
    const projeter = (l: Ligne) => (colonnes ? Object.fromEntries(colonnes.map((c) => [c, l[c]])) : { ...l });
    const executer = (): { data: unknown; error: { code?: string; message: string } | null } => {
      base.executions[op] += 1;
      const panne = base.pannes.find((x) => x.op === op && x.occurrence === base.executions[op]);
      if (panne?.mode === 'erreur') {
        base.journal.push(`${op}:PANNE`); chrono.evenements.push(`db:${op}:PANNE`);
        return { data: null, error: { message: `panne ${op} #${panne.occurrence}` } };
      }
      const resultat = executerReel();
      if (panne?.mode === 'fantome') {
        base.journal.push(`${op}:FANTOME`); chrono.evenements.push(`db:${op}:FANTOME`);
        return { data: null, error: { message: `reponse perdue apres ${op} #${panne.occurrence}` } };
      }
      return resultat;
    };
    const executerReel = (): { data: unknown; error: { code?: string; message: string } | null } => {
      if (op === 'insert') {
        const l = insertion!;
        base.journal.push(`insert:v${l.version}`); chrono.evenements.push('db:insert');
        if (l.deleted_at === null && base.avatars.some((a) => a.user_id === l.user_id && a.deleted_at === null)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "user_avatars_one_active_per_user_uidx"' } };
        }
        const ligne = { id: uuid(), created_at: new Date().toISOString(), ...l } as Ligne;
        base.avatars.push(ligne);
        return { data: [projeter(ligne)], error: null };
      }
      let rows = base.avatars.filter((l) => filtres.every((f) => f(l)));
      if (op === 'update') {
        base.journal.push(`update:${Object.keys(patch!).sort().join(',')}:${rows.length}`); chrono.evenements.push(`db:update:${rows.length}`);
        for (const l of rows) Object.assign(l, patch);
        return { data: rows.map(projeter), error: null };
      }
      if (tri) rows = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
      if (limite !== undefined) rows = rows.slice(0, limite);
      return { data: rows.map(projeter), error: null };
    };
    const api = {
      select(c?: string) { if (c && c !== '*') colonnes = c.split(',').map((x) => x.trim()); return api; },
      insert(v: Record<string, unknown>) { op = 'insert'; insertion = v; return api; },
      update(p: Record<string, unknown>) { op = 'update'; patch = p; return api; },
      eq(k: string, v: unknown) { filtres.push((l) => l[k] === v); return api; },
      is(k: string, v: unknown) { filtres.push((l) => l[k] === v); return api; },
      order() { tri = true; return api; },
      async limit(n: number) { limite = n; return executer(); },
      async single() {
        const r = executer();
        if (r.error) return r;
        const rows = r.data as unknown[];
        return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      },
      async maybeSingle() {
        const r = executer();
        if (r.error) return r;
        const rows = r.data as unknown[];
        if (rows.length > 1) return { data: null, error: { message: 'plusieurs lignes' } };
        return { data: rows[0] ?? null, error: null };
      },
      then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
        return Promise.resolve().then(executer).then(resolve, reject);
      },
    };
    return api;
  };
  return {
    supabase: {},
    supabaseAdmin: {
      from,
      storage: {
        from: (bucket: string) => ({
          async upload(cle: string, _octets: unknown) {
            stockage.journal.push(`upload:${cle}`); chrono.evenements.push('stockage:upload');
            if (bucket !== 'media') return { data: null, error: { message: `bucket ${bucket}` } };
            if (stockage.refuserUpload) return { data: null, error: { message: 'minio KO' } };
            // Comme S3 : un `put` sur une clé existante l'écrase en silence.
            stockage.objets.set(cle, 10);
            return { data: { path: cle }, error: null };
          },
          async remove(cles: string[]) {
            for (const c of cles) { stockage.journal.push(`remove:${c}`); chrono.evenements.push(`stockage:remove:${c}`); stockage.objets.delete(c); }
            return { data: cles, error: null };
          },
        }),
      },
    },
  };
});

vi.mock('@/lib/avatar/heygen', () => {
  class HeyGenError extends Error {
    constructor(message: string, public httpStatus = 502, public code = 'upstream_error') { super(message); }
  }
  const attendre = async () => {
    if (heygen.mode === 'retenu') {
      const r = await new Promise<{ ok: boolean }>((resolve) => { heygen.liberer = resolve; });
      if (!r.ok) throw new HeyGenError('HeyGen a refuse (tardivement).', 422, 'invalid_request');
      return;
    }
    if (heygen.mode === 'echec') throw new HeyGenError('HeyGen a refuse la source.', 422, 'invalid_request');
  };
  return {
    HeyGenError,
    HEYGEN_ASSET_MAX_BYTES: 32 * 1024 * 1024,
    uploadAsset: async (blob: Blob) => {
      heygen.appels.push(`assets:${blob.size}`); chrono.evenements.push('heygen:assets');
      await attendre();
      return { assetId: `as-${++heygen.compteur}` };
    },
    createAvatarFromAsset: async (assetId: string, name: string, kind: string) => {
      heygen.appels.push(`avatars:${assetId}:${kind}:${name}`);
      return { avatarId: `hg-${assetId}`, status: 'processing' };
    },
    getAvatarTrainingStatus: async (id: string) => {
      heygen.appels.push(`looks:${id}`);
      if (heygen.statutRetenu) await new Promise<void>((resolve) => { heygen.libererStatut = resolve; });
      return heygen.statut;
    },
    listVoices: async () => [],
    pickDefaultVoice: () => undefined,
  };
});

const session = vi.hoisted(() => ({ courante: null as unknown }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => session.courante }));

const { POST, GET } = await import('@/app/api/avatar/create/route');

function requete(over: { type?: string; nom?: string; consent?: string; taille?: number } = {}) {
  const fd = new FormData();
  const type = over.type ?? 'video/mp4';
  fd.append('file', new File([new Uint8Array(over.taille ?? 1024)], over.nom ?? 'moi.mp4', { type }));
  fd.append('consent', over.consent ?? 'true');
  fd.append('name', 'Mon avatar');
  return POST(new NextRequest('https://studiio.pro/api/avatar/create', { method: 'POST', body: fd }));
}

const NONCE = /source-\d{13}-[0-9a-f]{32}\.mp4$/;
const vivant = () => base.avatars.find((a) => a.user_id === U && a.deleted_at === null)!;
const generationDe = (avatarId: string, version: number | null) => {
  const g = { id: `gen-${base.generations.length + 1}`, user_id: U, user_avatar_id: avatarId, avatar_version: version, status: 'completed', video_url: `/x/${U}/avatar/gen.mp4` };
  base.generations.push(g);
  return g;
};
const avatarLegacy = (over: Partial<Ligne> = {}) => {
  const l: Ligne = {
    id: '11111111-1111-4111-8111-aaaaaaaaaaaa', user_id: U, version: 1, deleted_at: null,
    created_at: '2026-09-01T00:00:00.000Z', status: 'completed', provider_avatar_id: 'hg-old', provider_asset_id: 'as-old',
    source_object_key: null, source_url: `https://studiio.pro/storage/v1/object/public/media/${U}/avatar/source-1757000000000.jpg`,
    avatar_type: 'photo', name: 'Ancien', consent_at: '2026-09-01T00:00:00.000Z', consent_text: 'ancien texte',
    validated_at: '2026-09-02T00:00:00.000Z', training_error: null, ...over,
  };
  base.avatars.push(l);
  return l;
};

process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';

beforeEach(() => {
  base.avatars = []; base.generations = []; base.journal.length = 0; base.compteur = 0;
  stockage.objets.clear(); stockage.journal.length = 0; stockage.refuserUpload = false;
  heygen.mode = 'ok'; heygen.appels.length = 0; heygen.liberer = null; heygen.compteur = 0;
  alea.constant = null; chrono.evenements.length = 0;
  base.pannes = []; base.executions = { select: 0, insert: 0, update: 0 };
  heygen.statut = { status: 'completed' }; heygen.statutRetenu = false; heygen.libererStatut = null;
  session.courante = { user: { id: U } };
});

describe('POST /api/avatar/create — première inscription', () => {
  it('⚠️ insère version 1, source_object_key (nonce), source_url NULL, consentement versionné, subject self ; fournisseur APRÈS la base', async () => {
    const res = await requete();
    expect(res.status).toBe(200);
    const corps = await res.json() as { data: { avatar: Record<string, unknown> } };
    const l = vivant();
    expect(l.version).toBe(1);
    expect(l.source_object_key).toMatch(new RegExp(`^${U}/avatar/`));
    expect(l.source_object_key).toMatch(NONCE);
    expect(l.source_url).toBeNull();
    expect(l.subject_type).toBe('self');
    expect(l.consent_version).toBe('enrolement-2026-07-28');
    expect(l.consent_text).toMatch(/^Je certifie etre la personne visible dans la video/);
    expect(l.validated_at).toBeNull();
    expect(l.provider_avatar_id).toBe('hg-as-1');
    expect(l.provider_asset_id).toBe('as-1');
    expect(l.status).toBe('processing');
    // L'ordre : upload → insert → HeyGen → update provider.
    expect(chrono.evenements.slice(0, 4)).toEqual(['stockage:upload', 'db:insert', 'heygen:assets', 'db:update:1']);
    expect(base.journal[1]).toMatch(/^update:provider_asset_id,provider_avatar_id,status,training_error:1$/);
    // La réponse ne porte pas source_url ; l'objet est bien en stockage.
    expect('source_url' in corps.data.avatar).toBe(false);
    expect(stockage.objets.has(l.source_object_key as string)).toBe(true);
    expect(stockage.journal.filter((j) => j.startsWith('remove:'))).toEqual([]);
  });

  it('upload refusé → 500, ni base ni fournisseur', async () => {
    stockage.refuserUpload = true;
    expect((await requete()).status).toBe(500);
    expect(base.journal).toEqual([]);
    expect(heygen.appels).toEqual([]);
  });

  it('⚠️ deux premières inscriptions simultanées → UNE ligne vivante ; la perdante retire SA source, jamais la gagnante, sans HeyGen', async () => {
    const [a, b] = await Promise.all([requete(), requete()]);
    const statuts = [a.status, b.status].sort();
    expect(statuts).toEqual([200, 409]);
    const perdante = a.status === 409 ? a : b;
    expect((await perdante.json() as { code: string }).code).toBe('avatar_concurrent');
    expect(base.avatars.filter((l) => l.user_id === U && l.deleted_at === null)).toHaveLength(1);
    const gagnante = vivant();
    const uploads = stockage.journal.filter((j) => j.startsWith('upload:')).map((j) => j.slice(7));
    expect(uploads).toHaveLength(2);
    expect(new Set(uploads).size).toBe(2);
    const retraits = stockage.journal.filter((j) => j.startsWith('remove:')).map((j) => j.slice(7));
    expect(retraits).toHaveLength(1);
    expect(retraits[0]).not.toBe(gagnante.source_object_key);
    expect(uploads).toContain(retraits[0]);
    expect(stockage.objets.has(gagnante.source_object_key as string)).toBe(true);
    // La perdante n'a jamais parlé à HeyGen : un seul jeu d'appels.
    expect(heygen.appels.filter((x) => x.startsWith('assets:'))).toHaveLength(1);
    expect(base.journal.filter((j) => j === 'insert:v1')).toHaveLength(2);
  });
});

describe('POST /api/avatar/create — défense en profondeur : clés confondues', () => {
  it('⚠️ même si deux requêtes obtenaient la MÊME clé (aléa forcé, même ms), la perdante ne retire pas l’objet de la gagnante', async () => {
    alea.constant = 'e'.repeat(64);
    const horloge = vi.spyOn(Date, 'now').mockReturnValue(1757900000000);
    try {
      const [a, b] = await Promise.all([requete(), requete()]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const gagnante = vivant();
      const uploads = stockage.journal.filter((j) => j.startsWith('upload:')).map((j) => j.slice(7));
      // Le scénario est bien celui redouté : deux uploads, UNE seule clé.
      expect(uploads).toHaveLength(2);
      expect(new Set(uploads).size).toBe(1);
      expect(uploads[0]).toBe(gagnante.source_object_key);
      // `cleConservee` = la clé gagnante relue : le retrait est refusé.
      expect(stockage.journal.filter((j) => j.startsWith('remove:'))).toEqual([]);
      expect(stockage.objets.has(gagnante.source_object_key as string)).toBe(true);
    } finally {
      horloge.mockRestore();
    }
  });
});

describe('POST /api/avatar/create — remplacement', () => {
  it('⚠️ même id, version 2, nouvelle clé, ancienne clé legacy retirée APRÈS la transition, générations intactes', async () => {
    const ancien = avatarLegacy();
    stockage.objets.set(`${U}/avatar/source-1757000000000.jpg`, 10);
    const g = generationDe(ancien.id, null);
    const res = await requete();
    expect(res.status).toBe(200);
    expect(base.avatars).toHaveLength(1);
    const l = vivant();
    expect(l.id).toBe(ancien.id);
    expect(l.version).toBe(2);
    expect(l.created_at).toBe('2026-09-01T00:00:00.000Z');
    expect(l.source_object_key).toMatch(NONCE);
    expect(l.source_url).toBeNull();
    expect(l.avatar_type).toBe('video');
    expect(l.validated_at).toBeNull();
    expect(l.provider_avatar_id).toBe('hg-as-1');
    expect(l.consent_version).toBe('enrolement-2026-07-28');
    // L'ancienne source (dérivée du source_url legacy) est retirée APRÈS la transition
    // en base, et le fournisseur n'est appelé qu'APRÈS elle aussi.
    const ancienne = `stockage:remove:${U}/avatar/source-1757000000000.jpg`;
    expect(chrono.evenements.indexOf(ancienne)).toBeGreaterThan(chrono.evenements.indexOf('db:update:1'));
    expect(chrono.evenements.indexOf('heygen:assets')).toBeGreaterThan(chrono.evenements.indexOf('db:update:1'));
    expect(chrono.evenements.indexOf('stockage:upload')).toBeLessThan(chrono.evenements.indexOf('db:update:1'));
    expect(base.journal[0]).toMatch(/^update:.*version.*:1$/);
    expect(stockage.objets.has(`${U}/avatar/source-1757000000000.jpg`)).toBe(false);
    expect(stockage.objets.has(l.source_object_key as string)).toBe(true);
    // Aucun delete ; la génération historique est intacte et pointe toujours l'avatar.
    expect(base.journal.some((j) => j.startsWith('delete'))).toBe(false);
    expect(base.generations[0]).toEqual(g);
  });

  it('⚠️ deux remplacements simultanés (v1) → un seul v2 ; la perdante retire sa source seulement', async () => {
    avatarLegacy({ source_object_key: `${U}/avatar/source-1.mp4`, source_url: null });
    stockage.objets.set(`${U}/avatar/source-1.mp4`, 10);
    const [a, b] = await Promise.all([requete(), requete()]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(base.avatars).toHaveLength(1);
    const l = vivant();
    expect(l.version).toBe(2);
    const uploads = stockage.journal.filter((j) => j.startsWith('upload:')).map((j) => j.slice(7));
    const retraits = stockage.journal.filter((j) => j.startsWith('remove:')).map((j) => j.slice(7));
    // Deux retraits : l'ancienne source (par la gagnante) et la source de la perdante.
    expect(retraits.sort()).toEqual([`${U}/avatar/source-1.mp4`, uploads.find((u) => u !== l.source_object_key)].sort());
    // Et l'ancienne n'est retirée qu'APRÈS un update qui a touché une ligne.
    expect(chrono.evenements.indexOf(`stockage:remove:${U}/avatar/source-1.mp4`)).toBeGreaterThan(chrono.evenements.indexOf('db:update:1'));
    expect(stockage.objets.has(l.source_object_key as string)).toBe(true);
    expect(heygen.appels.filter((x) => x.startsWith('assets:'))).toHaveLength(1);
  });

  it('⚠️ HeyGen échoue sur la version courante → status failed + training_error, ligne, version et source conservées', async () => {
    avatarLegacy({ source_object_key: `${U}/avatar/source-1.mp4`, source_url: null });
    heygen.mode = 'echec';
    const res = await requete();
    expect(res.status).toBe(422);
    const l = vivant();
    expect(l.version).toBe(2);
    expect(l.status).toBe('failed');
    expect(l.training_error).toBe('HeyGen a refuse la source.');
    expect(l.provider_avatar_id).toBeNull();
    expect(l.source_object_key).toMatch(NONCE);
    expect(stockage.objets.has(l.source_object_key as string)).toBe(true);
  });

  it('un avatar supprimé (deleted_at) n’est pas remplacé : nouvelle ligne version 1', async () => {
    avatarLegacy({ deleted_at: '2026-09-10T00:00:00Z' });
    expect((await requete()).status).toBe(200);
    expect(base.avatars).toHaveLength(2);
    expect(vivant().version).toBe(1);
  });

  it('⚠️ l’avatar d’un autre compte n’est jamais lu ni touché', async () => {
    const autre = avatarLegacy({ user_id: AUTRUI, source_object_key: `${AUTRUI}/avatar/source-1.mp4` });
    stockage.objets.set(`${AUTRUI}/avatar/source-1.mp4`, 10);
    expect((await requete()).status).toBe(200);
    expect(base.avatars.find((l) => l.id === autre.id)!.version).toBe(1);
    expect(stockage.objets.has(`${AUTRUI}/avatar/source-1.mp4`)).toBe(true);
  });
});

describe('POST /api/avatar/create — réponse fournisseur PÉRIMÉE', () => {
  async function scenarioPerime(issue: { ok: boolean }) {
    // A : première inscription, HeyGen retenu.
    heygen.mode = 'retenu';
    const a = requete();
    while (!heygen.liberer) await new Promise((r) => setTimeout(r, 1));
    const v1 = vivant();
    expect(v1.version).toBe(1);
    // B : remplace pendant que A attend HeyGen — HeyGen répond à B tout de suite.
    heygen.mode = 'ok';
    const b = await requete();
    expect(b.status).toBe(200);
    const v2 = vivant();
    expect(v2.id).toBe(v1.id);
    expect(v2.version).toBe(2);
    // B a obtenu SON identifiant fournisseur (A n'a pas encore le sien).
    expect(v2.provider_avatar_id).toMatch(/^hg-as-\d$/);
    const instantane = { ...v2 };
    // HeyGen répond enfin à A.
    heygen.liberer!(issue);
    const resA = await a;
    return { resA, instantane };
  }

  it('⚠️ STALE_PROVIDER_SUCCESS_CANNOT_OVERWRITE_NEW_VERSION : A (v1) revient après B (v2) → 409, v2 intacte', async () => {
    const { resA, instantane } = await scenarioPerime({ ok: true });
    expect(resA.status).toBe(409);
    expect((await resA.json() as { code: string }).code).toBe('avatar_superseded');
    expect(vivant()).toEqual(instantane);
    expect(base.journal.filter((j) => j.startsWith('update:provider')).pop()).toMatch(/:0$/);
  });

  it('⚠️ STALE_PROVIDER_FAILURE_CANNOT_OVERWRITE_NEW_VERSION : l’échec de A ne met pas v2 en failed', async () => {
    const { resA, instantane } = await scenarioPerime({ ok: false });
    expect(resA.status).toBe(409);
    expect((await resA.json() as { code: string }).code).toBe('avatar_superseded');
    expect(vivant()).toEqual(instantane);
    expect(vivant().status).not.toBe('failed');
    expect(base.journal.filter((j) => j.startsWith('update:status,training_error')).pop()).toMatch(/:0$/);
  });
});

describe('GET /api/avatar/create', () => {
  it('ne rend que l’avatar vivant, sans source_url, et ne sonde pas HeyGen sans provider_avatar_id', async () => {
    avatarLegacy({ deleted_at: '2026-09-10T00:00:00Z', id: '11111111-1111-4111-8111-000000000dead' });
    avatarLegacy({ provider_avatar_id: null, status: 'source_ready', created_at: '2026-09-11T00:00:00.000Z', id: '11111111-1111-4111-8111-00000000a11e' });
    const res = await GET();
    expect(res.status).toBe(200);
    const corps = await res.json() as { data: { avatar: Record<string, unknown> } };
    expect(corps.data.avatar.id).toBe('11111111-1111-4111-8111-00000000a11e');
    expect('source_url' in corps.data.avatar).toBe(false);
    expect(heygen.appels.filter((x) => x.startsWith('looks:'))).toEqual([]);
  });

  it('sonde encore HeyGen pour un avatar en cours QUI a un provider_avatar_id, et écrit le statut sur SA version', async () => {
    avatarLegacy({ status: 'processing' });
    const res = await GET();
    expect(heygen.appels).toEqual(['looks:hg-old']);
    expect(vivant().status).toBe('completed');
    expect((await res.json() as { data: { avatar: { status: string } } }).data.avatar.status).toBe('completed');
    expect(base.journal.filter((j) => j.startsWith('update:status')).pop()).toMatch(/:1$/);
  });

  it('⚠️ STALE_TRAINING_POLL_CANNOT_OVERWRITE_NEW_VERSION : le GET lit v1 (hg-old), un POST passe en v2 (provider NULL), HeyGen répond « completed » pour hg-old → v2 reste source_ready', async () => {
    avatarLegacy({ status: 'processing', source_object_key: `${U}/avatar/source-1.mp4`, source_url: null });
    stockage.objets.set(`${U}/avatar/source-1.mp4`, 10);
    heygen.statutRetenu = true;
    const get = GET();
    while (!heygen.libererStatut) await new Promise((r) => setTimeout(r, 1));
    // Le remplacement : même id, v2, fournisseur en échec → provider NULL, statut failed → puis on force source_ready
    // pour être exactement dans le scénario (source enregistrée, fournisseur jamais sollicité).
    heygen.mode = 'echec';
    expect((await requete()).status).toBe(422);
    const v2 = vivant();
    expect(v2.version).toBe(2);
    expect(v2.provider_avatar_id).toBeNull();
    Object.assign(v2, { status: 'source_ready', training_error: null });
    const instantane = { ...v2 };
    // HeyGen répond (tardivement) au GET, pour hg-old.
    heygen.libererStatut!();
    const res = await get;
    expect(res.status).toBe(200);
    expect(vivant()).toEqual(instantane);
    expect(vivant().status).toBe('source_ready');
    // L'update conditionné n'a touché aucune ligne, et le GET a relu l'avatar courant.
    expect(base.journal.filter((j) => j.startsWith('update:status')).pop()).toMatch(/:0$/);
    const corps = await res.json() as { data: { avatar: { version: number; status: string } } };
    expect(corps.data.avatar.version).toBe(2);
    expect(corps.data.avatar.status).toBe('source_ready');
  });

  it('⚠️ défense en profondeur : même si v2 portait le MÊME identifiant fournisseur, le filtre version suffit à refuser le statut périmé', async () => {
    avatarLegacy({ status: 'processing', source_object_key: `${U}/avatar/source-1.mp4`, source_url: null });
    heygen.statutRetenu = true;
    const get = GET();
    while (!heygen.libererStatut) await new Promise((r) => setTimeout(r, 1));
    // Un remplacement a eu lieu (v2), et — cas limite — le fournisseur a rendu le même identifiant.
    Object.assign(vivant(), { version: 2, status: 'processing', provider_avatar_id: 'hg-old', provider_asset_id: 'as-2', source_object_key: `${U}/avatar/source-2-${'b'.repeat(32)}.mp4` });
    const instantane = { ...vivant() };
    heygen.libererStatut!();
    const res = await get;
    expect(res.status).toBe(200);
    expect(vivant()).toEqual(instantane);
    expect(vivant().status).toBe('processing');
    expect(base.journal.filter((j) => j.startsWith('update:status')).pop()).toMatch(/:0$/);
  });

  it('erreur DB pendant la resynchronisation : l’instantané est rendu tel quel, rien n’est inventé', async () => {
    avatarLegacy({ status: 'processing' });
    base.pannes = [{ op: 'update', occurrence: 1, mode: 'erreur' }];
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json() as { data: { avatar: { status: string } } }).data.avatar.status).toBe('processing');
    expect(vivant().status).toBe('processing');
  });
});

describe('POST /api/avatar/create — erreur DB ≠ concurrence ; incertitude ≠ suppression', () => {
  const cleActive = `${U}/avatar/source-1.mp4`;
  const remove = () => stockage.journal.filter((j) => j.startsWith('remove:')).map((j) => j.slice(7));

  it('INITIAL_AVATAR_READ_DB_ERROR_STOPS_BEFORE_UPLOAD : lecture initiale en erreur → 500 avant tout', async () => {
    avatarLegacy({ source_object_key: cleActive, source_url: null });
    base.pannes = [{ op: 'select', occurrence: 1, mode: 'erreur' }];
    const res = await requete();
    expect(res.status).toBe(500);
    expect((await res.json() as { code: string }).code).toBe('avatar_read_failed');
    expect(stockage.journal).toEqual([]);
    expect(base.journal.filter((j) => j.startsWith('insert') || j.startsWith('update'))).toEqual([]);
    expect(heygen.appels).toEqual([]);
  });

  it('LOSER_WINNER_REREAD_ERROR_DOES_NOT_DELETE_SOURCE : conflit certain (23505) mais relecture du gagnant en erreur → 409, remove appelé 0 fois', async () => {
    // Deux premières inscriptions, clés CONFONDUES, et la relecture du perdant tombe en panne.
    alea.constant = 'f'.repeat(64);
    const horloge = vi.spyOn(Date, 'now').mockReturnValue(1757900000000);
    try {
      // Ordre des selects : A lit (1), B lit (2), … la relecture du perdant est la 3ᵉ.
      base.pannes = [{ op: 'select', occurrence: 3, mode: 'erreur' }];
      const [a, b] = await Promise.all([requete(), requete()]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const perdante = a.status === 409 ? a : b;
      expect((await perdante.json() as { code: string }).code).toBe('avatar_concurrent');
      expect(remove()).toEqual([]);
      expect(stockage.objets.has(vivant().source_object_key as string)).toBe(true);
    } finally {
      horloge.mockRestore();
    }
  });

  it('FIRST_INSERT_AMBIGUOUS_COMMIT_RECOVERED : insert commité mais réponse perdue → relecture, reprise du flux fournisseur, 200', async () => {
    base.pannes = [{ op: 'insert', occurrence: 1, mode: 'fantome' }];
    const res = await requete();
    expect(res.status).toBe(200);
    const l = vivant();
    expect(l.version).toBe(1);
    expect(l.provider_avatar_id).toBe('hg-as-1');
    expect(remove()).toEqual([]);
    expect(stockage.objets.has(l.source_object_key as string)).toBe(true);
  });

  it('FIRST_INSERT_AMBIGUOUS_COMMIT_DOES_NOT_DELETE_LIVE_SOURCE : insert en erreur, relecture en erreur → 500, aucune suppression', async () => {
    base.pannes = [{ op: 'insert', occurrence: 1, mode: 'fantome' }, { op: 'select', occurrence: 2, mode: 'erreur' }];
    const res = await requete();
    expect(res.status).toBe(500);
    expect((await res.json() as { code: string }).code).toBe('avatar_insert_failed');
    expect(remove()).toEqual([]);
    expect(stockage.objets.has(vivant().source_object_key as string)).toBe(true);
    expect(heygen.appels).toEqual([]);
  });

  it('insert en erreur SANS commit, relecture OK et vide → notre source retirée, 500', async () => {
    base.pannes = [{ op: 'insert', occurrence: 1, mode: 'erreur' }];
    const res = await requete();
    expect(res.status).toBe(500);
    expect(remove()).toHaveLength(1);
    expect(stockage.objets.size).toBe(0);
    expect(heygen.appels).toEqual([]);
  });

  it('CAS_AMBIGUOUS_COMMIT_NEVER_DELETES_CURRENT_SOURCE : CAS commité mais réponse perdue → repris comme transition réussie ; relecture en panne → 500 sans suppression', async () => {
    avatarLegacy({ source_object_key: cleActive, source_url: null });
    stockage.objets.set(cleActive, 10);
    base.pannes = [{ op: 'update', occurrence: 1, mode: 'fantome' }];
    const res = await requete();
    expect(res.status).toBe(200);
    const l = vivant();
    expect(l.version).toBe(2);
    expect(l.provider_avatar_id).toBe('hg-as-1');
    expect(remove()).toEqual([cleActive]);

    // Variante : la relecture elle-même échoue → 500, aucune source retirée.
    stockage.journal.length = 0; heygen.appels.length = 0; heygen.compteur = 0;
    base.executions = { select: 0, insert: 0, update: 0 };
    base.pannes = [{ op: 'update', occurrence: 1, mode: 'fantome' }, { op: 'select', occurrence: 2, mode: 'erreur' }];
    const res2 = await requete();
    expect(res2.status).toBe(500);
    expect((await res2.json() as { code: string }).code).toBe('avatar_replace_failed');
    expect(remove()).toEqual([]);
    expect(heygen.appels).toEqual([]);
  });

  it('CAS en erreur SANS commit (ligne inchangée) → notre clé retirée en conservant la courante, 500', async () => {
    avatarLegacy({ source_object_key: cleActive, source_url: null });
    stockage.objets.set(cleActive, 10);
    base.pannes = [{ op: 'update', occurrence: 1, mode: 'erreur' }];
    const res = await requete();
    expect(res.status).toBe(500);
    expect(remove()).toHaveLength(1);
    expect(remove()[0]).not.toBe(cleActive);
    expect(stockage.objets.has(cleActive)).toBe(true);
    expect(vivant().version).toBe(1);
  });

  it('PROVIDER_SUCCESS_DB_ERROR_NOT_SUPERSEDED : update provider en erreur, version toujours courante, ids non persistés → 500 avatar_provider_persistence_failed, pas 409', async () => {
    avatarLegacy({ source_object_key: cleActive, source_url: null });
    // 1ʳᵉ update = CAS (ok) ; 2ᵉ update = écriture provider → erreur.
    base.pannes = [{ op: 'update', occurrence: 2, mode: 'erreur' }];
    const res = await requete();
    expect(res.status).toBe(500);
    expect((await res.json() as { code: string }).code).toBe('avatar_provider_persistence_failed');
    const l = vivant();
    expect(l.version).toBe(2);
    expect(l.provider_avatar_id).toBeNull();
    expect(stockage.objets.has(l.source_object_key as string)).toBe(true);
  });

  it('PROVIDER_SUCCESS_AMBIGUOUS_COMMIT_RECONCILED : update provider commité, réponse perdue → relecture montre les ids → 200', async () => {
    avatarLegacy({ source_object_key: cleActive, source_url: null });
    base.pannes = [{ op: 'update', occurrence: 2, mode: 'fantome' }];
    const res = await requete();
    expect(res.status).toBe(200);
    const corps = await res.json() as { data: { avatar: { provider_avatar_id: string; version: number } } };
    expect(corps.data.avatar.provider_avatar_id).toBe('hg-as-1');
    expect(corps.data.avatar.version).toBe(2);
  });

  it('PROVIDER_FAILURE_DB_ERROR_NOT_SUPERSEDED : HeyGen échoue, marquage failed en erreur, version courante non marquée → 500 avatar_failure_persistence_failed', async () => {
    avatarLegacy({ source_object_key: cleActive, source_url: null });
    heygen.mode = 'echec';
    base.pannes = [{ op: 'update', occurrence: 2, mode: 'erreur' }];
    const res = await requete();
    expect(res.status).toBe(500);
    expect((await res.json() as { code: string }).code).toBe('avatar_failure_persistence_failed');
    expect(vivant().version).toBe(2);
    expect(vivant().status).toBe('source_ready');
  });

  it('PROVIDER_FAILURE_AMBIGUOUS_COMMIT_RECONCILED : marquage failed commité, réponse perdue → relecture montre failed → l’erreur HeyGen normale (422)', async () => {
    avatarLegacy({ source_object_key: cleActive, source_url: null });
    heygen.mode = 'echec';
    base.pannes = [{ op: 'update', occurrence: 2, mode: 'fantome' }];
    const res = await requete();
    expect(res.status).toBe(422);
    expect(vivant().status).toBe('failed');
    expect(vivant().training_error).toBe('HeyGen a refuse la source.');
  });

  it('erreur DB à l’écriture provider ALORS qu’une v3 existe déjà → 409 avatar_superseded (réellement dépassée)', async () => {
    avatarLegacy({ source_object_key: cleActive, source_url: null });
    heygen.mode = 'retenu';
    const a = requete();
    while (!heygen.liberer) await new Promise((r) => setTimeout(r, 1));
    heygen.mode = 'ok';
    expect((await requete()).status).toBe(200); // v3
    // L'écriture provider de A (prochaine update) tombe en erreur ; la relecture montre v3.
    base.pannes = [{ op: 'update', occurrence: base.executions.update + 1, mode: 'erreur' }];
    heygen.liberer!({ ok: true });
    const res = await a;
    expect(res.status).toBe(409);
    expect((await res.json() as { code: string }).code).toBe('avatar_superseded');
    expect(vivant().version).toBe(3);
  });
});
