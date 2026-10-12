// @vitest-environment node
/**
 * JUMEAU DÉJÀ STOCKÉ AVEC BANDES — réutilisé PLEIN CADRE, sans régénération.
 *
 * #555 retire les bandes incrustées des NOUVELLES vidéos de jumeau. Un jumeau
 * rapatrié avant (720×1280, image utile 720×405 au centre) gardait ses bandes
 * dans chaque nouveau montage 9:16. Ce fichier prouve, sur médias
 * synthétiques et vrai ffmpeg :
 *   1. jumeau à bandes → version DÉRIVÉE plein cadre déposée sous le compte
 *      (`<uid>/jumeaux-recadres/9x16/avatar/<gen>.mp4`), original intact,
 *      montage 9:16 mesuré plein cadre 1080×1920, sujet non déformé ;
 *   2. jumeau propre → l'original, rien d'écrit, aucun recadrage ffmpeg ;
 *   3. second montage → la dérivée est réutilisée (ffmpeg non relancé) ;
 *   4. jumeau d'un autre compte → refusé, jamais lu ni signé ;
 *   5. ni fournisseur (HeyGen, D-ID) ni crédits ne sont touchés ;
 *   6. la dérivée n'est PAS lisible anonymement par le relais, mais l'est
 *      par son propriétaire (et refusée à un autre compte) ;
 *   7. la route (session, propriété) et le client (options du compositeur).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const etat = vi.hoisted(() => ({
  appelsMinio: [] as Array<{ methode: string; bucket: string; cle: string }>,
  session: null as null | { user: { id: string; email?: string } },
}));

// MinIO doublé (relais + route) : chaque appel est noté.
vi.mock('minio', async () => {
  const { Readable } = await import('node:stream');
  class Client {
    async statObject(bucket: string, cle: string) { etat.appelsMinio.push({ methode: 'stat', bucket, cle }); return { size: 4096, metaData: {} }; }
    async getObject(bucket: string, cle: string) { etat.appelsMinio.push({ methode: 'get', bucket, cle }); return Readable.from([Buffer.alloc(4096, 7)]); }
    async getPartialObject(bucket: string, cle: string, _d: number, l: number) { etat.appelsMinio.push({ methode: 'partial', bucket, cle }); return Readable.from([Buffer.alloc(l, 7)]); }
    async presignedGetObject(bucket: string, cle: string) { etat.appelsMinio.push({ methode: 'sign', bucket, cle }); return `http://minio.interne/${bucket}/${cle}`; }
    async putObject(bucket: string, cle: string) { etat.appelsMinio.push({ methode: 'put', bucket, cle }); return {}; }
  }
  return { Client };
});
vi.mock('@/lib/auth/config', () => ({ auth: async () => etat.session }));

// Fournisseurs et crédits ESPIONNÉS : aucun ne doit être appelé.
const espions = vi.hoisted(() => ({
  heygen: vi.fn(), did: vi.fn(), credits: vi.fn(),
}));
vi.mock('@/lib/avatar/heygen', async (orig) => {
  const vrai = await orig<Record<string, unknown>>();
  const out: Record<string, unknown> = { ...vrai };
  for (const [k, v] of Object.entries(vrai)) if (typeof v === 'function' && !/^[A-Z]/.test(k)) out[k] = (...a: unknown[]) => { espions.heygen(k); return (v as (...x: unknown[]) => unknown)(...a); };
  return out;
});
vi.mock('@/lib/providers/did/client', async (orig) => {
  const vrai = await orig<Record<string, unknown>>();
  const out: Record<string, unknown> = { ...vrai };
  for (const [k, v] of Object.entries(vrai)) if (typeof v === 'function' && !/^[A-Z]/.test(k)) out[k] = (...a: unknown[]) => { espions.did(k); return (v as (...x: unknown[]) => unknown)(...a); };
  return out;
});
vi.mock('@/lib/credits/system', async (orig) => {
  const vrai = await orig<Record<string, unknown>>();
  const out: Record<string, unknown> = { ...vrai };
  for (const [k, v] of Object.entries(vrai)) if (typeof v === 'function') out[k] = (...a: unknown[]) => { espions.credits(k); return (v as (...x: unknown[]) => unknown)(...a); };
  return out;
});

process.env.STORAGE_PROVIDER = 's3';
process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';
process.env.AUTH_SECRET = 'secret-de-test-plein-cadre-0123456789abcdef';
process.env.MINIO_SECRET_KEY = 'secret-minio-test';

const {
  jumeauPleinCadre, cibleJumeau, cleJumeauPleinCadre, ratioNormalise, oublierCachePleinCadre, BUCKET_JUMEAUX,
} = await import('@/lib/avatar/jumeau-plein-cadre');
const { retirerBandesIncrustees, lireDimensions } = await import('@/lib/avatar/cadrage-jumeau');
const { drawVideoSeq } = await import('@/lib/video-composer');
const { lectureAnonymeRelais } = await import('@/lib/storage/politique-relais');
const { generationDepuisRush } = await import('@/lib/avatar/identite');
const { pleinCadreDesJumeaux, oublierMemoPleinCadre } = await import('@/lib/creer/jumeau-plein-cadre-client');
const { POST: PLEIN_CADRE } = await import('@/app/api/creer/jumeau/plein-cadre/route');
const { GET: RELAIS } = await import('@/app/storage/v1/object/public/[bucket]/[...path]/route');

const FFMPEG = ['/opt/homebrew/bin/ffmpeg', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find((p) => existsSync(p)) ?? null;
const avecFfmpeg = FFMPEG ? describe : describe.skip;

const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const B = 'bbbbbbbb-2222-4222-8222-222222222222';
const GEN = 'c0ffee00-3333-4333-8333-333333333333';
const GEN_PROPRE = 'd00dfeed-4444-4444-8444-444444444444';
const ORIGINE = 'https://studiio.pro';
const url = (cle: string) => `${ORIGINE}/storage/v1/object/public/media/${cle}`;
const CLE_SOURCE = `${A}/avatar/${GEN}.mp4`;
const CLE_DERIVEE = `${A}/jumeaux-recadres/9x16/avatar/${GEN}.mp4`;

// ── Médias synthétiques ─────────────────────────────────────────────────────
const run = (args: string[]) => execFileSync(FFMPEG!, args, { stdio: ['ignore', 'pipe', 'pipe'] });
const stderrDe = (f: string) => String(spawnSync(FFMPEG!, ['-hide_banner', '-i', f], { encoding: 'utf8' }).stderr);

function traceCompositeur(src: readonly [number, number], cadre: readonly [number, number]) {
  const appels: number[][] = [];
  const ctx = new Proxy({}, {
    get: (_o, k) => (k === 'drawImage' ? (_s: unknown, ...a: number[]) => appels.push(a) : k === 'measureText' ? () => ({ width: 0 }) : () => undefined),
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  drawVideoSeq(ctx, cadre[0], cadre[1], { videoWidth: src[0], videoHeight: src[1] } as unknown as HTMLVideoElement, null, 0.5);
  const [x, y, l, h] = appels[0];
  return { x, y, l, h };
}

/** Lignes / colonnes entièrement noires sur l'image n°10. */
function mesurerBandes(fichier: string, cadre: readonly [number, number]) {
  const [w, h] = cadre;
  const raw = execFileSync(FFMPEG!, ['-v', 'error', '-i', fichier, '-vf', 'select=eq(n\\,10),format=gray', '-frames:v', '1', '-f', 'rawvideo', '-'], { maxBuffer: 64 * 1024 * 1024 });
  const ligneNoire = (y: number) => { for (let x = 0; x < w; x += 4) if (raw[y * w + x] >= 20) return false; return true; };
  const colNoire = (x: number) => { for (let y = 0; y < h; y += 4) if (raw[y * w + x] >= 20) return false; return true; };
  let haut = 0; while (haut < h && ligneNoire(haut)) haut++;
  let bas = 0; while (bas < h && ligneNoire(h - 1 - bas)) bas++;
  let gauche = 0; while (gauche < w && colNoire(gauche)) gauche++;
  let droite = 0; while (droite < w && colNoire(w - 1 - droite)) droite++;
  return { haut, bas, gauche, droite };
}

/** « Montage » 9:16 du compositeur, rejoué par ffmpeg, puis mesuré. */
function montage916(dossier: string, source: string, src: readonly [number, number], nom: string) {
  const cadre = [1080, 1920] as const;
  const r = traceCompositeur(src, cadre);
  const sortie = join(dossier, `${nom}.mp4`);
  const L = Math.round(r.l / 2) * 2; const H = Math.round(r.h / 2) * 2;
  run(['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=black:s=${cadre[0]}x${cadre[1]}:d=1:r=30`, '-i', source,
    '-filter_complex', `[1:v]scale=${L}:${H},setsar=1[s];[0:v][s]overlay=x=${Math.round(r.x)}:y=${Math.round(r.y)}:shortest=1`,
    '-frames:v', '15', '-pix_fmt', 'yuv420p', sortie]);
  return { dims: lireDimensions(stderrDe(sortie)), bandes: mesurerBandes(sortie, cadre) };
}

let dossier = '';
let BANDES: Buffer; let PROPRE: Buffer;
beforeAll(() => {
  if (!FFMPEG) return;
  dossier = mkdtempSync(join(tmpdir(), 'jumeau-plein-cadre-test-'));
  const hb = join(dossier, 'HB.mp4'); const v = join(dossier, 'V.mp4');
  // Jumeau rapatrié AVANT #555 : 720×1280, image utile 720×405 au centre, avec son.
  run(['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=720x405:rate=30', '-f', 'lavfi', '-i', 'sine=f=440', '-t', '1',
    '-vf', 'pad=720:1280:0:(1280-405)/2:black', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', hb]);
  run(['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=30', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', v]);
  BANDES = readFileSync(hb); PROPRE = readFileSync(v);
});
afterAll(() => { if (dossier) rmSync(dossier, { recursive: true, force: true }); });

// ── Dépôt en mémoire, espionné ──────────────────────────────────────────────
function depotMemoire(initial: Record<string, Buffer>) {
  const objets = new Map<string, Buffer>(Object.entries(initial).map(([k, v]) => [`media/${k}`, v]));
  const existe = vi.fn(async (b: string, c: string) => objets.has(`${b}/${c}`));
  const lire = vi.fn(async (b: string, c: string) => objets.get(`${b}/${c}`) ?? null);
  const ecrire = vi.fn(async (b: string, c: string, contenu: Buffer) => { objets.set(`${b}/${c}`, contenu); });
  return { objets, depot: { existe, lire, ecrire } };
}
/** ffmpeg RÉEL, chaque invocation comptée (cropdetect / recadrage). */
function recadreurCompte() {
  const invocations: Array<'cropdetect' | 'crop'> = [];
  const recadrer = vi.fn((buf: Buffer, o: { aspectRatio?: unknown }) => retirerBandesIncrustees(buf, {
    ...o, ffmpeg: FFMPEG!,
    executer: async (bin, args, opts) => {
      invocations.push(args.some((a) => a.startsWith('cropdetect')) ? 'cropdetect' : 'crop');
      const r = spawnSync(bin, args, { encoding: 'utf8', timeout: opts.timeout, maxBuffer: opts.maxBuffer });
      if (r.status !== 0) throw new Error(`ffmpeg ${r.status}`);
      return { stdout: String(r.stdout), stderr: String(r.stderr) };
    },
  }));
  return { recadrer, invocations };
}

beforeEach(() => {
  oublierCachePleinCadre(); oublierMemoPleinCadre();
  etat.appelsMinio = []; etat.session = null;
  espions.heygen.mockClear(); espions.did.mockClear(); espions.credits.mockClear();
});

describe('règles pures', () => {
  it('clé dérivée : même compte, déterministe, reconnue comme LE jumeau (generationDepuisRush)', () => {
    expect(cleJumeauPleinCadre(A, GEN, '9:16')).toBe(CLE_DERIVEE);
    expect(generationDepuisRush(url(CLE_DERIVEE))).toBe(GEN);
    expect(ratioNormalise('1080:1920')).toBe('9:16');
    expect(ratioNormalise('reel')).toBe('9:16');
    expect(ratioNormalise('3:7')).toBeNull();
  });
  it('cible : source, dérivée, autre, refus (autre compte, chemin tordu)', () => {
    expect(cibleJumeau(url(CLE_SOURCE), A)).toEqual({ genre: 'source', cle: CLE_SOURCE, generationId: GEN });
    expect(cibleJumeau(url(CLE_DERIVEE), A)).toEqual({ genre: 'derivee', cle: CLE_DERIVEE });
    expect(cibleJumeau(url(`${A}/rush.mp4`), A).genre).toBe('autre');
    expect(cibleJumeau(url(CLE_SOURCE), B).genre).toBe('refus');
    expect(cibleJumeau(url(`${A}/avatar/..%2F${B}/avatar/${GEN}.mp4`), A).genre).toBe('refus');
  });
});

avecFfmpeg('jumeau EXISTANT à bandes incrustées → version plein cadre dérivée (vrai ffmpeg)', () => {
  it('AVANT : monter l’original en 9:16 recopie les bandes (≈ 650 px en haut et en bas)', () => {
    const src = join(dossier, 'source.mp4'); writeFileSync(src, BANDES);
    const m = montage916(dossier, src, [720, 1280], 'avant');
    expect(m.bandes.haut).toBeGreaterThan(600);
    expect(m.bandes.bas).toBeGreaterThan(600);
  });

  it('APRÈS : dérivée déposée sous le compte, original intact, montage 9:16 PLEIN CADRE 1080×1920 sans déformation', async () => {
    const { objets, depot } = depotMemoire({ [CLE_SOURCE]: BANDES });
    const { recadrer, invocations } = recadreurCompte();
    const r = await jumeauPleinCadre({ url: url(CLE_SOURCE), userId: A, format: '9:16' }, { depot, recadrer });

    expect(r.statut).toBe('derive');
    expect(r.url).toBe(url(CLE_DERIVEE));
    expect(depot.ecrire).toHaveBeenCalledTimes(1);
    expect(depot.ecrire.mock.calls[0][0]).toBe(BUCKET_JUMEAUX);
    expect(depot.ecrire.mock.calls[0][1]).toBe(CLE_DERIVEE);
    // L'ORIGINAL n'est jamais réécrit.
    expect(depot.ecrire.mock.calls.some((c) => c[1] === CLE_SOURCE)).toBe(false);
    expect(objets.get(`media/${CLE_SOURCE}`)).toBe(BANDES);
    expect(invocations).toEqual(['cropdetect', 'crop']);

    // Le fichier dérivé : mêmes dimensions, aucune bande, son conservé.
    const derive = join(dossier, 'derive.mp4'); writeFileSync(derive, objets.get(`media/${CLE_DERIVEE}`)!);
    const info = stderrDe(derive);
    expect(lireDimensions(info)).toEqual({ l: 720, h: 1280 });
    expect(info).toMatch(/Audio:/);
    expect(mesurerBandes(derive, [720, 1280])).toEqual({ haut: 0, bas: 0, gauche: 0, droite: 0 });

    // Sujet NON déformé : même facteur d'échelle sur x et y.
    const plan = (await recadrer.mock.results[0].value).plan!;
    const fx = plan.sortie.l / plan.coupe.l; const fy = plan.sortie.h / plan.coupe.h;
    expect(Math.abs(fx - fy) / fx).toBeLessThan(0.02);

    // Le montage 9:16 du compositeur sur la dérivée : plein cadre.
    const m = montage916(dossier, derive, [720, 1280], 'apres');
    expect(m.dims).toEqual({ l: 1080, h: 1920 });
    expect(m.bandes).toEqual({ haut: 0, bas: 0, gauche: 0, droite: 0 });
  });

  it('second montage : la dérivée EXISTANTE est réutilisée — ni lecture, ni ffmpeg', async () => {
    const { depot } = depotMemoire({ [CLE_SOURCE]: BANDES });
    const { recadrer } = recadreurCompte();
    await jumeauPleinCadre({ url: url(CLE_SOURCE), userId: A, format: '9:16' }, { depot, recadrer });
    oublierCachePleinCadre(); // le cache, c'est l'objet stocké — pas la mémoire du processus
    depot.lire.mockClear(); recadrer.mockClear(); depot.ecrire.mockClear();
    const r2 = await jumeauPleinCadre({ url: url(CLE_SOURCE), userId: A, format: '1080:1920' }, { depot, recadrer });
    expect(r2).toEqual({ url: url(CLE_DERIVEE), statut: 'derive-existant' });
    expect(recadrer).not.toHaveBeenCalled();
    expect(depot.lire).not.toHaveBeenCalled();
    expect(depot.ecrire).not.toHaveBeenCalled();
    // L'URL dérivée repassée telle quelle : rien à faire.
    const r3 = await jumeauPleinCadre({ url: url(CLE_DERIVEE), userId: A, format: '9:16' }, { depot, recadrer });
    expect(r3.statut).toBe('deja-plein-cadre');
    expect(depot.existe).toHaveBeenCalledTimes(2);
  });

  it('deux montages simultanés : UNE seule correction', async () => {
    const { depot } = depotMemoire({ [CLE_SOURCE]: BANDES });
    const { recadrer } = recadreurCompte();
    const [x, y] = await Promise.all([
      jumeauPleinCadre({ url: url(CLE_SOURCE), userId: A, format: '9:16' }, { depot, recadrer }),
      jumeauPleinCadre({ url: url(CLE_SOURCE), userId: A, format: '9:16' }, { depot, recadrer }),
    ]);
    expect(x.url).toBe(url(CLE_DERIVEE)); expect(y.url).toBe(url(CLE_DERIVEE));
    expect(recadrer).toHaveBeenCalledTimes(1);
    expect(depot.ecrire).toHaveBeenCalledTimes(1);
  });

  it('jumeau PROPRE : l’original, rien d’écrit, aucun recadrage — et pas de second contrôle', async () => {
    const cle = `${A}/avatar/${GEN_PROPRE}.mp4`;
    const { depot } = depotMemoire({ [cle]: PROPRE });
    const { recadrer, invocations } = recadreurCompte();
    const r = await jumeauPleinCadre({ url: url(cle), userId: A, format: '9:16' }, { depot, recadrer });
    expect(r).toEqual({ url: url(cle), statut: 'original' });
    expect(depot.ecrire).not.toHaveBeenCalled();
    expect(invocations).toEqual(['cropdetect']);
    const r2 = await jumeauPleinCadre({ url: url(cle), userId: A, format: '9:16' }, { depot, recadrer });
    expect(r2.statut).toBe('original');
    expect(recadrer).toHaveBeenCalledTimes(1);
  });

  it('ni fournisseur ni crédits : HeyGen, D-ID et le système de crédits ne sont jamais appelés', async () => {
    const { depot } = depotMemoire({ [CLE_SOURCE]: BANDES });
    const { recadrer } = recadreurCompte();
    await jumeauPleinCadre({ url: url(CLE_SOURCE), userId: A, format: '9:16' }, { depot, recadrer });
    expect(espions.heygen).not.toHaveBeenCalled();
    expect(espions.did).not.toHaveBeenCalled();
    expect(espions.credits).not.toHaveBeenCalled();
  });
});

describe('propriété (#546) et relais (#554)', () => {
  it('jumeau d’un AUTRE compte : refusé — jamais lu, jamais signé, rien d’écrit', async () => {
    const { depot } = depotMemoire({ [CLE_SOURCE]: Buffer.from('x') });
    const recadrer = vi.fn();
    const r = await jumeauPleinCadre({ url: url(CLE_SOURCE), userId: B, format: '9:16' }, { depot, recadrer });
    expect(r).toEqual({ url: null, statut: 'refus' });
    expect(depot.existe).not.toHaveBeenCalled();
    expect(depot.lire).not.toHaveBeenCalled();
    expect(depot.ecrire).not.toHaveBeenCalled();
    expect(recadrer).not.toHaveBeenCalled();
    expect(etat.appelsMinio).toEqual([]);
  });

  it('échec du stockage : l’original, sans lever', async () => {
    const depot = { existe: vi.fn(async () => { throw new Error('minio down'); }), lire: vi.fn(), ecrire: vi.fn() };
    const r = await jumeauPleinCadre({ url: url(CLE_SOURCE), userId: A, format: '9:16' }, { depot });
    expect(r).toEqual({ url: url(CLE_SOURCE), statut: 'echec' });
  });

  const relais = (cle: string) => RELAIS(new Request(`${ORIGINE}/storage/v1/object/public/media/${cle}`) as never, { params: Promise.resolve({ bucket: 'media', path: cle.split('/') }) });

  it('la dérivée n’est PAS publique : anonyme → 404, autre compte → 404, propriétaire → 200', async () => {
    expect(lectureAnonymeRelais('media', CLE_DERIVEE)).toBe(false);
    etat.session = null;
    expect((await relais(CLE_DERIVEE)).status).toBe(404);
    etat.session = { user: { id: B } };
    expect((await relais(CLE_DERIVEE)).status).toBe(404);
    expect(etat.appelsMinio).toEqual([]);
    etat.session = { user: { id: A } };
    expect((await relais(CLE_DERIVEE)).status).toBe(200);
  });

  it('route : session obligatoire ; jumeau d’un autre compte → 404 neutre, MinIO jamais sondé', async () => {
    const appel = (corps: unknown) => PLEIN_CADRE(new Request(`${ORIGINE}/api/creer/jumeau/plein-cadre`, { method: 'POST', body: JSON.stringify(corps) }) as never);
    etat.session = null;
    expect((await appel({ url: url(CLE_SOURCE), format: '9:16' })).status).toBe(401);
    etat.session = { user: { id: B } };
    const r = await appel({ url: url(CLE_SOURCE), format: '9:16' });
    expect(r.status).toBe(404);
    expect(JSON.stringify(await r.json())).not.toContain(A);
    expect(etat.appelsMinio).toEqual([]);
    etat.session = { user: { id: A } };
    const r2 = await appel({ url: url(CLE_DERIVEE), format: '9:16' });
    expect(await r2.json()).toMatchObject({ success: true, data: { url: url(CLE_DERIVEE), pleinCadre: true } });
  });
});

describe('client — options du compositeur', () => {
  const opts = () => ({
    width: 1080, height: 1920,
    videoUrl: url(CLE_SOURCE),
    rushs: [{ url: url(CLE_SOURCE), secondes: 5 }, { url: url(`${A}/rush.mp4`), secondes: 3 }],
    montage: [{ url: url(CLE_SOURCE), debut: 0, fin: 5 }],
    sequenceVoiceUrls: { video: url(CLE_SOURCE), titre: 'https://cdn.test/v.mp3' },
  });

  it('chaque occurrence du jumeau est remplacée par l’URL rendue ; le reste est intact ; UN appel', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { url: url(CLE_DERIVEE) } }), { status: 200 }));
    const o = await pleinCadreDesJumeaux(opts() as never, f as never) as ReturnType<typeof opts>;
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toEqual({ url: url(CLE_SOURCE), format: '1080:1920' });
    expect(o.videoUrl).toBe(url(CLE_DERIVEE));
    expect(o.rushs.map((r) => r.url)).toEqual([url(CLE_DERIVEE), url(`${A}/rush.mp4`)]);
    expect(o.montage[0].url).toBe(url(CLE_DERIVEE));
    expect(o.sequenceVoiceUrls).toEqual({ video: url(CLE_DERIVEE), titre: 'https://cdn.test/v.mp3' });
  });

  it('échec réseau / refus : l’original est gardé (le montage n’est jamais bloqué)', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 404 }));
    const o = await pleinCadreDesJumeaux(opts() as never, f as never) as ReturnType<typeof opts>;
    expect(o.videoUrl).toBe(url(CLE_SOURCE));
  });

  it('sans jumeau (ou déjà plein cadre) : aucun appel', async () => {
    const f = vi.fn();
    await pleinCadreDesJumeaux({ width: 1080, height: 1920, videoUrl: url(`${A}/rush.mp4`) } as never, f as never);
    await pleinCadreDesJumeaux({ width: 1080, height: 1920, videoUrl: url(CLE_DERIVEE) } as never, f as never);
    expect(f).not.toHaveBeenCalled();
  });
});
