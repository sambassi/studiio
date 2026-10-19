/**
 * `POST /api/convert/to-mp4` — PLAFONDS de conversion (PR-F).
 *
 * Ce qui est vérifié, sur le VRAI gestionnaire de route, avec le VRAI
 * `fetch-media` et la VRAIE règle `acces-objet` :
 *
 * - 1 conversion à la fois par compte → la 2e reçoit 429 + `Retry-After` ;
 * - 2 conversions à la fois par processus → la 3e (autre compte) reçoit 429 ;
 * - le jeton revient après succès, échec ffmpeg, délai ffmpeg dépassé,
 *   échec de téléchargement, exception inattendue, abandon du client ;
 * - une source annoncée > 300 Mio → 413 SANS lire l'objet (seul `statObject`) ;
 * - non-régression : une conversion normale et le repli Bureau
 *   (`{uid}/convert/…`, URL relative) passent comme avant ;
 * - le cron de publication n'est pas soumis à ce limiteur.
 *
 * Seuls sont doublés : la session, le client MinIO (stat / lecture), ffmpeg
 * et le dépôt. ffmpeg attend une « porte » que le test ouvre : c'est ce qui
 * permet d'avoir deux conversions réellement EN COURS en même temps.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';

process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';
process.env.NEXTAUTH_URL = 'https://studiio.pro';

const ORIGINE = 'https://studiio.pro';
const PREFIXE = '/storage/v1/object/public/';
const objet = (bucketEtCle: string) => `${ORIGINE}${PREFIXE}${bucketEtCle}`;
const MIO = 1024 * 1024;

// ── Session ────────────────────────────────────────────────────────────────
const authMock = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));

// ── MinIO : la taille annoncée, et la lecture (qui ne doit pas toujours avoir lieu)
let tailleAnnoncee = 4096;
let panneLecture = false;
const statObject = vi.fn(async () => ({ size: tailleAnnoncee, metaData: { 'content-type': 'video/webm' } }));
const getObject = vi.fn(async () => {
  if (panneLecture) throw new Error('ECONNRESET');
  return Readable.from([Buffer.alloc(4096, 1)]);
});
vi.mock('@/lib/storage/minio-client', async (importOriginal) => {
  const reel = await importOriginal<Record<string, unknown>>();
  return {
    ...reel,
    clientMinio: vi.fn(() => ({ statObject, putObject: vi.fn() })),
    lecteurMinio: vi.fn(() => ({ getObject, getPartialObject: vi.fn() })),
  };
});

// ── ffmpeg : attend une porte, puis réussit / échoue / dépasse son délai ──
type Issue = 'ok' | 'echec' | 'delai';
let issueFfmpeg: Issue = 'ok';
let portes: Array<() => void> = [];
let bloquer = false;
const conversions: string[] = [];
vi.mock('@/lib/ffmpeg/transcode-to-mp4', () => ({
  transcodeWebmToMp4WithLadder: async (_ff: string, inputPath: string, outputPath: string) => {
    conversions.push(inputPath);
    if (bloquer) await new Promise<void>((r) => { portes.push(r); });
    if (issueFfmpeg === 'echec') throw new Error('All FFmpeg attempts failed. exit 1');
    if (issueFfmpeg === 'delai') throw new Error('All FFmpeg attempts failed. TIMEOUT');
    writeFileSync(outputPath, Buffer.alloc(8192, 2));
    return { stderr: '', attempt: '1080p CRF28' };
  },
}));

// ── Dépôt ──────────────────────────────────────────────────────────────────
const depots: string[] = [];
let depotJette = false;
let depotPendu = false;
let depotAtteint = false;
/** Règle le dépôt lent à la main : succès tardif ou échec tardif. */
let reglerDepot: ((issue: 'ok' | 'echec') => void) | null = null;
const suppressions: string[] = [];
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string) => {
          if (depotJette) throw new Error('socket hang up');
          if (depotPendu) {
            depotAtteint = true;
            // Dépôt LENT : ne se règle que quand le test le décide.
            return new Promise((r) => {
              reglerDepot = (issue) => r(issue === 'ok'
                ? (depots.push(`${bucket}/${path}`), { data: { path }, error: null })
                : { data: null, error: { message: 'tardif' } });
            });
          }
          depots.push(`${bucket}/${path}`);
          return { data: { path }, error: null };
        },
        remove: async (paths: string[]) => {
          suppressions.push(...paths.map((x) => `${bucket}/${x}`));
          return { data: paths, error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `${ORIGINE}${PREFIXE}${bucket}/${path}` } }),
      }),
    },
  },
}));

const { POST } = await import('@/app/api/convert/to-mp4/route');
const limites = await import('@/lib/ffmpeg/limiteur-conversions');

let qui = 'u1';
authMock.mockImplementation(async () => ({ user: { id: qui, email: `${qui}@test.io` } }));

function requete(videoUrl: string, signal?: AbortSignal) {
  return new Request('https://studiio.pro/api/convert/to-mp4', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ videoUrl }),
    signal,
  }) as unknown as import('next/server').NextRequest;
}

/** Lance un appel SANS l'attendre, au nom de `compte`. */
function lancer(compte: string, url = objet(`media/${compte}/rendus/a.webm`), signal?: AbortSignal) {
  qui = compte;
  const p = POST(requete(url, signal));
  return p;
}

async function appeler(compte: string, url?: string) {
  const res = await lancer(compte, url);
  return { statut: res.status, corps: await res.json(), retry: res.headers.get('retry-after') };
}

/** Attend que `n` conversions soient arrêtées à la porte. */
async function attendrePortes(n: number) {
  for (let i = 0; i < 200 && portes.length < n; i++) await new Promise((r) => setTimeout(r, 2));
  expect(portes.length).toBe(n);
}
function ouvrirPortes() { const p = portes; portes = []; p.forEach((r) => r()); }

beforeEach(() => {
  tailleAnnoncee = 4096; panneLecture = false; issueFfmpeg = 'ok'; bloquer = false; depotJette = false; depotPendu = false; depotAtteint = false;
  reglerDepot = null; suppressions.length = 0;
  portes = []; conversions.length = 0; depots.length = 0;
  statObject.mockClear(); getObject.mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  ouvrirPortes();
  vi.restoreAllMocks();
});

/** Après chaque scénario, PLUS AUCUN jeton ne doit traîner. */
const aucunJeton = () => expect(limites.limiteurConversions().etat()).toEqual({ global: 0, comptes: 0 });

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Concurrence par compte', () => {
  it('2e conversion simultanée du même compte → 429 + Retry-After, sans téléchargement', async () => {
    bloquer = true;
    const premiere = lancer('u1');
    await attendrePortes(1);

    const { statut, corps, retry } = await appeler('u1');
    expect(statut).toBe(429);
    expect(corps).toEqual({ success: false, error: limites.MESSAGE_CONVERSION_EN_COURS });
    expect(retry).toBe(String(limites.RETRY_AFTER_CONVERSION_S));
    expect(statObject).toHaveBeenCalledTimes(1); // celui de la 1re seulement
    expect(conversions).toHaveLength(1);

    ouvrirPortes();
    expect((await premiere).status).toBe(200);
    aucunJeton();

    // Le jeton est revenu : une nouvelle conversion du même compte passe.
    bloquer = false;
    expect((await appeler('u1')).statut).toBe(200);
    aucunJeton();
  });

  it('les refus gratuits (404, non-webm) ne prennent pas de jeton', async () => {
    bloquer = true;
    const premiere = lancer('u1');
    await attendrePortes(1);
    // Non-webm : raccourci sans conversion → toujours servi, pas 429.
    expect((await appeler('u1', objet('media/u1/rendus/a.mp4'))).statut).toBe(200);
    // Clé d'autrui → 404 inchangé, pas 429.
    expect((await appeler('u1', objet('media/u2/rendus/a.webm'))).statut).toBe(404);
    ouvrirPortes();
    await premiere;
    aucunJeton();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Plafond global du processus', () => {
  it(`au-delà de 2 conversions en cours → 429 pour un autre compte`, async () => {
    expect(limites.CONVERSIONS_MAX_PROCESSUS).toBe(2);
    bloquer = true;
    const a = lancer('u1');
    const b = lancer('u2');
    await attendrePortes(2);

    const { statut, corps, retry } = await appeler('u3');
    expect(statut).toBe(429);
    expect(corps).toEqual({ success: false, error: limites.MESSAGE_SERVEUR_OCCUPE });
    expect(retry).toBe(String(limites.RETRY_AFTER_CONVERSION_S));
    expect(conversions).toHaveLength(2);

    ouvrirPortes();
    expect((await a).status).toBe(200);
    expect((await b).status).toBe(200);
    aucunJeton();
    bloquer = false;
    expect((await appeler('u3')).statut).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Le jeton revient sur tous les chemins', () => {
  it.each([
    ['échec ffmpeg', 500, () => { issueFfmpeg = 'echec'; }],
    ['délai ffmpeg dépassé', 500, () => { issueFfmpeg = 'delai'; }],
    ['échec de lecture du stockage', 500, () => { panneLecture = true; }],
    ['exception inattendue au dépôt', 500, () => { depotJette = true; }],
    ['source trop volumineuse', 413, () => { tailleAnnoncee = limites.TAILLE_MAX_SOURCE_CONVERSION + 1; }],
  ] as Array<[string, number, () => void]>)('%s → %i, puis le compte peut reconvertir', async (_nom, attendu, preparer) => {
    preparer();
    expect((await appeler('u1')).statut).toBe(attendu);
    aucunJeton();
    issueFfmpeg = 'ok'; panneLecture = false; depotJette = false; tailleAnnoncee = 4096;
    expect((await appeler('u1')).statut).toBe(200);
    aucunJeton();
  });

  it('abandon du client : le jeton est rendu quand le travail se termine', async () => {
    bloquer = true;
    const controleur = new AbortController();
    const p = lancer('u1', undefined, controleur.signal);
    await attendrePortes(1);
    controleur.abort();
    // Le travail (ffmpeg) tourne encore : la machine est occupée, jeton tenu.
    expect(limites.limiteurConversions().etat().global).toBe(1);
    ouvrirPortes();
    await p.catch(() => undefined);
    aucunJeton();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3 bis. Dépôt plus lent que le délai', () => {
  /** Mène un appel jusqu'au dépôt lent, puis fait passer le délai de 120 s. */
  async function jusquauDelai() {
    depotPendu = true;
    // Seuls setTimeout/clearTimeout sont figés : E/S disque et setImmediate restent réels.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const p = lancer('u1');
      for (let i = 0; i < 2000 && !depotAtteint; i++) await new Promise((r) => setImmediate(r));
      expect(depotAtteint).toBe(true);
      expect(await Promise.race([p.then(() => 'fini'), new Promise((r) => setImmediate(() => r('pendu')))])).toBe('pendu');
      await vi.advanceTimersByTimeAsync(120_000);
      return await p;
    } finally {
      vi.useRealTimers();
    }
  }
  const attendreJeton = async () => {
    for (let i = 0; i < 200 && limites.limiteurConversions().etat().global > 0; i++) await new Promise((r) => setImmediate(r));
  };

  it('au délai → 500, mais le jeton reste tenu tant que le dépôt est en vol', async () => {
    const res = await jusquauDelai();
    expect(res.status).toBe(500);
    // Le buffer MP4 est encore en mémoire : le plafond doit le compter.
    expect(limites.limiteurConversions().etat()).toEqual({ global: 1, comptes: 1 });
    expect((await appeler('u1')).statut).toBe(429);

    // Le dépôt aboutit EN RETARD : jeton rendu, objet orphelin supprimé.
    reglerDepot!('ok');
    await attendreJeton();
    aucunJeton();
    expect(suppressions).toHaveLength(1);
    expect(suppressions[0]).toMatch(/^media\/u1\/converted\/[0-9a-f-]{36}\.mp4$/);
    expect(suppressions[0]).toBe(depots[0]);

    depotPendu = false;
    expect((await appeler('u1')).statut).toBe(200);
  });

  it('dépôt qui échoue en retard → jeton rendu, rien à supprimer', async () => {
    expect((await jusquauDelai()).status).toBe(500);
    expect(limites.limiteurConversions().etat().global).toBe(1);
    reglerDepot!('echec');
    await attendreJeton();
    aucunJeton();
    expect(suppressions).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Taille de la source', () => {
  it('annoncée > 300 Mio → 413, objet JAMAIS lu, ffmpeg jamais lancé', async () => {
    tailleAnnoncee = 300 * MIO + 1;
    const { statut, corps } = await appeler('u1');
    expect(statut).toBe(413);
    expect(corps).toEqual({ success: false, error: 'Média trop volumineux' });
    expect(statObject).toHaveBeenCalledTimes(1);
    expect(getObject).not.toHaveBeenCalled();
    expect(conversions).toHaveLength(0);
    expect(depots).toHaveLength(0);
  });

  it('exactement 300 Mio → accepté (borne incluse)', async () => {
    tailleAnnoncee = 300 * MIO;
    expect((await appeler('u1')).statut).toBe(200);
    expect(getObject).toHaveBeenCalledTimes(1);
  });

  it('le plafond de conversion est plus bas que la borne générique du stockage', async () => {
    const { MAX_MEDIA_DOWNLOAD_BYTES } = await import('@/lib/storage/fetch-media');
    expect(limites.TAILLE_MAX_SOURCE_CONVERSION).toBe(300 * MIO);
    expect(limites.TAILLE_MAX_SOURCE_CONVERSION).toBeLessThan(MAX_MEDIA_DOWNLOAD_BYTES);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. Non-régression', () => {
  it('conversion normale : sortie sous {uid}/converted/<uuid>.mp4', async () => {
    const { statut, corps } = await appeler('u1');
    expect(statut).toBe(200);
    expect(corps.success).toBe(true);
    expect(corps.mp4Url).toMatch(new RegExp(`^${ORIGINE}${PREFIXE}media/u1/converted/[0-9a-f-]{36}\\.mp4$`));
    expect(depots[0]).toMatch(/^media\/u1\/converted\/[0-9a-f-]{36}\.mp4$/);
  });

  it('repli Bureau : copie téléversée sous {uid}/convert/…, URL relative → 200', async () => {
    // Forme exacte de l'URL rendue par /api/upload/signed-url (purpose 'convert').
    const url = `${PREFIXE}media/u1/convert/1760000000000-desktop-export-1760000000000.webm`;
    const { statut, corps } = await appeler('u1', url);
    expect(statut).toBe(200);
    expect(corps.mp4Url).toMatch(/\/media\/u1\/converted\/[0-9a-f-]{36}\.mp4$/);
  });

  it('le cron de publication a sa propre conversion, NON soumise au limiteur', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/api/cron/publish/route.ts'), 'utf8');
    expect(source).not.toMatch(/limiteur-conversions|limiteurConversions/);
    expect(source).not.toMatch(/\/api\/convert\/to-mp4['"`]/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. Le limiteur seul', () => {
  it('liberer est idempotent et ne rend jamais le jeton d\'un autre', () => {
    const l = limites.creerLimiteurConversions({ maxParCompte: 1, maxGlobal: 2 });
    const a = l.acquerir('a');
    const b = l.acquerir('b');
    expect(a.ok && b.ok).toBe(true);
    expect(l.acquerir('c')).toEqual({ ok: false, motif: 'global' });
    if (a.ok) { a.liberer(); a.liberer(); }
    expect(l.etat()).toEqual({ global: 1, comptes: 1 });
    expect(l.acquerir('b')).toEqual({ ok: false, motif: 'compte' });
  });
});
