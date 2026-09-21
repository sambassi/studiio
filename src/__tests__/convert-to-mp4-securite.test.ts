/**
 * `POST /api/convert/to-mp4` — ce que la route accepte, refuse, et laisse
 * derrière elle.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI EST VÉRIFIÉ ICI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le VRAI gestionnaire de route est appelé. Ce qui compte n'est pas qu'une
 * fonction existe, c'est ce que la route répond : à qui elle donne accès,
 * quelles cibles elle refuse SANS toucher le stockage, ce qu'elle écrit, ce
 * qu'elle ne dit jamais dans une réponse ni dans un journal, et si les
 * fichiers temporaires disparaissent sur tous les chemins d'échec.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI N'EST PAS VÉRIFIÉ ICI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le téléchargement lui-même (`fetch-media`) et la conversion (`ffmpeg`) :
 * tous deux sont doublés. La doublure de téléchargement ÉCRIT réellement un
 * fichier au chemin demandé — c'est ce qui permet de prouver qu'il est
 * supprimé ensuite. La règle de validation des cibles est, elle, la VRAIE
 * (`acces-objet`) dès qu'elle expose le contrat ; sinon une doublure au
 * même contrat prend le relais, le temps que le module arrive.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Origines DÉTERMINISTES — `setup.ts` met NEXTAUTH_URL sur localhost:3000,
// qui est justement une des formes que ce fichier veut voir REFUSÉE.
process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';
process.env.NEXTAUTH_URL = 'https://studiio.pro';

const ORIGINE = 'https://studiio.pro';
const PREFIXE = '/storage/v1/object/public/';
const objet = (bucketEtCle: string) => `${ORIGINE}${PREFIXE}${bucketEtCle}`;

// ───────────────────────────────────────────────────────────────────────────
// Session
// ───────────────────────────────────────────────────────────────────────────
const authMock = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));

// ───────────────────────────────────────────────────────────────────────────
// Téléchargement — écrit vraiment `destPath`, ou lève une ErreurTelechargement
// ───────────────────────────────────────────────────────────────────────────
type CodeErreur = 'cible_invalide' | 'acces_refuse' | 'introuvable' | 'trop_volumineux' | 'delai' | 'reseau' | 'stockage';

interface AppelTelechargement { url: string; destPath: string; options: Record<string, unknown> }
const telechargements: AppelTelechargement[] = [];
/** Ce que la doublure fait : `{ octets }` écrit un fichier, `{ code }` lève. */
let scenarioTelechargement: { octets: number } | { code: CodeErreur; octetsPartiels?: number } = { octets: 4096 };

const MAX_OCTETS_TEST = 500 * 1024 * 1024;

vi.mock('@/lib/storage/fetch-media', async (importOriginal) => {
  let reel: Record<string, unknown> = {};
  try { reel = await importOriginal<Record<string, unknown>>(); } catch { /* module en cours d'écriture */ }
  const ErreurTelechargement = (reel.ErreurTelechargement as (new (code: string) => Error & { code: string }) | undefined)
    ?? class ErreurTelechargementFactice extends Error {
      code: string;
      constructor(code: string) { super(`échec ${code}`); this.name = 'ErreurTelechargement'; this.code = code; }
    };
  return {
    ...reel,
    ErreurTelechargement,
    MAX_MEDIA_DOWNLOAD_BYTES: (reel.MAX_MEDIA_DOWNLOAD_BYTES as number | undefined) ?? MAX_OCTETS_TEST,
    downloadMediaToFile: async (url: string, destPath: string, options: Record<string, unknown>) => {
      telechargements.push({ url, destPath, options });
      if ('code' in scenarioTelechargement) {
        // Téléchargement PARTIEL interrompu : un fichier existe déjà quand on lève.
        writeFileSync(destPath, Buffer.alloc(scenarioTelechargement.octetsPartiels ?? 2048, 1));
        throw new ErreurTelechargement(scenarioTelechargement.code);
      }
      writeFileSync(destPath, Buffer.alloc(scenarioTelechargement.octets, 1));
      return { sizeBytes: scenarioTelechargement.octets, contentType: 'video/webm' };
    },
  };
});

// ───────────────────────────────────────────────────────────────────────────
// ffmpeg — écrit `outputPath`, ou lève avec la ligne de commande et le stderr
// ───────────────────────────────────────────────────────────────────────────
interface AppelFfmpeg { ffmpegPath: string; inputPath: string; outputPath: string; tag: string }
const conversions: AppelFfmpeg[] = [];
let scenarioFfmpeg: { octets: number } | { echec: true } = { octets: 8192 };
const STDERR_SECRET = 'ffmpeg version 6.0 … Input #0, matroska, from /tmp/secret';

vi.mock('@/lib/ffmpeg/transcode-to-mp4', () => ({
  transcodeWebmToMp4WithLadder: async (ffmpegPath: string, inputPath: string, outputPath: string, tag: string) => {
    conversions.push({ ffmpegPath, inputPath, outputPath, tag });
    if ('echec' in scenarioFfmpeg) {
      throw new Error(`Command failed: /usr/bin/ffmpeg -i ${inputPath} -c:v libx264 ${outputPath}\nstderr : boom ${STDERR_SECRET}`);
    }
    writeFileSync(outputPath, Buffer.alloc(scenarioFfmpeg.octets, 2));
    return { stderr: STDERR_SECRET, attempt: '1080p CRF28' };
  },
}));

// ───────────────────────────────────────────────────────────────────────────
// Stockage — enregistre les dépôts, fabrique les URL publiques
// ───────────────────────────────────────────────────────────────────────────
interface Depot { bucket: string; path: string; octets: number; options: Record<string, unknown> }
const depots: Depot[] = [];
let panneDepot = false;

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, buf: Buffer, options: Record<string, unknown>) => {
          depots.push({ bucket, path, octets: buf.length, options });
          return panneDepot
            ? { data: null, error: { message: 'S3 AccessDenied: secret-bucket-host:9000 rejected PUT' } }
            : { data: { path }, error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `${ORIGINE}${PREFIXE}${bucket}/${path}` } }),
      }),
    },
  },
}));

// ───────────────────────────────────────────────────────────────────────────
// La règle de validation — la VRAIE dès qu'elle existe
// ───────────────────────────────────────────────────────────────────────────
vi.mock('@/lib/storage/acces-objet', async (importOriginal) => {
  const reel = await importOriginal<Record<string, unknown>>();
  const contratPresent = ['originesStockageConfigurees', 'extraireCibleStockage', 'cibleRecevable', 'cleDuCompteStrict']
    .every((nom) => typeof reel[nom] === 'function');
  if (contratPresent) return reel;

  // Doublure AU MÊME CONTRAT, le temps que le module réel l'expose.
  const { ALLOWED_BUCKETS } = await import('@/lib/storage/buckets');
  const cleObjetValide = reel.cleObjetValide as (c: unknown) => c is string;
  const dansAnalyse = reel.cleDansNamespaceAnalyse as (b: unknown, c: unknown) => boolean;
  const dansMontage = reel.cleDansNamespaceMontage as (b: unknown, c: unknown) => boolean;
  const dansLut = reel.cleDansNamespaceLut as (b: unknown, c: unknown) => boolean;
  const sourceAvatar = reel.cleSourceAvatarPrivee as (b: unknown, c: unknown) => boolean;

  const originesStockageConfigurees = (env: NodeJS.ProcessEnv = process.env) =>
    Array.from(new Set([env.NEXT_PUBLIC_APP_URL, env.NEXTAUTH_URL]
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .map((v) => v.replace(/\/$/, ''))));

  const extraireCibleStockage = (valeur: unknown, { origines }: { origines: readonly string[] }) => {
    if (typeof valeur !== 'string' || valeur.length === 0) return null;
    let chemin: string;
    if (valeur.startsWith('/')) {
      chemin = valeur;
    } else {
      let url: URL;
      try { url = new URL(valeur); } catch { return null; }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
      if (!origines.includes(url.origin)) return null;
      chemin = url.pathname + url.search + url.hash;
    }
    if (chemin.includes('?') || chemin.includes('#')) return null;
    if (!chemin.startsWith(PREFIXE)) return null;
    const reste = chemin.slice(PREFIXE.length);
    const barre = reste.indexOf('/');
    if (barre <= 0) return null;
    const bucket = reste.slice(0, barre);
    const cle = reste.slice(barre + 1);
    if (!(ALLOWED_BUCKETS as readonly string[]).includes(bucket)) return null;
    if (!cleObjetValide(cle)) return null;
    return { bucket, cle };
  };

  const cibleRecevable = (bucket: string, cle: string) =>
    !dansAnalyse(bucket, cle) && !dansMontage(bucket, cle) && !dansLut(bucket, cle) && !sourceAvatar(bucket, cle);

  const cleDuCompteStrict = (cle: unknown, userId: unknown) =>
    typeof userId === 'string' && userId.length > 0 && cleObjetValide(cle) && cle.startsWith(`${userId}/`);

  return { ...reel, originesStockageConfigurees, extraireCibleStockage, cibleRecevable, cleDuCompteStrict };
});

// ───────────────────────────────────────────────────────────────────────────
// La route — importée APRÈS les doublures
// ───────────────────────────────────────────────────────────────────────────
const { POST } = await import('@/app/api/convert/to-mp4/route');

const journal: unknown[][] = [];
let espions: Array<ReturnType<typeof vi.spyOn>> = [];

function requete(body: unknown) {
  return new Request('https://studiio.pro/api/convert/to-mp4', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest;
}

async function appeler(videoUrl: unknown) {
  const res = await POST(requete({ videoUrl }));
  const corps = await res.json();
  return { statut: res.status, corps, texte: JSON.stringify(corps) };
}

const connecte = (id = 'u1') => authMock.mockResolvedValue({ user: { id, email: `${id}@test.io` } });

beforeEach(() => {
  telechargements.length = 0;
  conversions.length = 0;
  depots.length = 0;
  journal.length = 0;
  scenarioTelechargement = { octets: 4096 };
  scenarioFfmpeg = { octets: 8192 };
  panneDepot = false;
  authMock.mockReset();
  authMock.mockResolvedValue(null);
  espions = (['log', 'warn', 'error', 'info', 'debug'] as const).map((niveau) =>
    vi.spyOn(console, niveau).mockImplementation((...args: unknown[]) => { journal.push(args); }),
  );
});

afterEach(() => {
  for (const e of espions) e.mockRestore();
});

/** Tout ce que le journal a reçu, aplati en une seule chaîne. */
const journalTexte = () => journal.map((args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')).join('\n');

// ═══════════════════════════════════════════════════════════════════════════
describe('1. La session', () => {
  it('sans session → 401, et rien ne tourne', async () => {
    const { statut, corps } = await appeler(objet('media/u1/rendus/a.webm'));
    expect(statut).toBe(401);
    expect(corps).toEqual({ success: false, error: 'Non autorisé' });
    expect(telechargements).toHaveLength(0);
    expect(conversions).toHaveLength(0);
    expect(depots).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Le chemin nominal', () => {
  it('une clé du compte est téléchargée, convertie, déposée sous le compte', async () => {
    connecte('u1');
    const url = objet('media/u1/rendus/a.webm');
    const { statut, corps } = await appeler(url);

    expect(statut).toBe(200);
    expect(telechargements).toHaveLength(1);
    expect(telechargements[0].url).toBe(url);
    expect(telechargements[0].options).toMatchObject({ userId: 'u1', maxBytes: expect.any(Number) });
    expect(telechargements[0].options.maxBytes).toBeGreaterThan(0);
    expect(telechargements[0].destPath.startsWith(tmpdir())).toBe(true);
    expect(telechargements[0].destPath).toMatch(/convert_[0-9a-f-]{36}\.webm$/);

    expect(conversions).toHaveLength(1);
    expect(conversions[0].inputPath).toBe(telechargements[0].destPath);
    expect(conversions[0].outputPath).toMatch(/convert_[0-9a-f-]{36}\.mp4$/);
    expect(conversions[0].tag).toBe('[CONVERT-API]');

    expect(depots).toHaveLength(1);
    expect(depots[0].bucket).toBe('media');
    expect(depots[0].path).toMatch(/^u1\/converted\/[0-9a-f-]{36}\.mp4$/);
    expect(depots[0].options).toMatchObject({ upsert: false, contentType: 'video/mp4' });
    expect(depots[0].octets).toBe(8192);

    expect(corps.success).toBe(true);
    expect(corps.mp4Url).toBe(`${ORIGINE}${PREFIXE}media/${depots[0].path}`);
    expect(corps.conversionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(depots[0].path).toContain(corps.conversionId);
    expect(corps.attempt).toBe('1080p CRF28');

    // Et les temporaires ont disparu.
    expect(existsSync(conversions[0].inputPath)).toBe(false);
    expect(existsSync(conversions[0].outputPath)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3-12. Les cibles refusées — 404 uniforme, sans toucher le stockage', () => {
  const refus = async (videoUrl: string) => {
    connecte('u1');
    const { statut, corps } = await appeler(videoUrl);
    expect(corps, videoUrl).toEqual({ success: false, error: 'Média introuvable' });
    expect(statut, videoUrl).toBe(404);
    expect(telechargements, videoUrl).toHaveLength(0);
    expect(conversions, videoUrl).toHaveLength(0);
    expect(depots, videoUrl).toHaveLength(0);
  };

  it('3. la clé d un autre compte', () => refus(objet('media/u2/rendus/a.webm')));
  it('4. un compartiment inconnu', () => refus(objet('secrets/u1/rendus/a.webm')));
  it('5. l espace d analyse', () => refus(objet('media/u1/analyse/abc/vignette-01.webm')));
  it('6. les montages de l Autopilote', () => refus(objet('videos/u1/montages/m1.webm')));
  it('7. les LUT importées', () => refus(objet('media/u1/lut/look.webm')));
  it('8. la source d un avatar', () => refus(objet('media/u1/avatar/source-1.webm')));
  it('9. une origine étrangère', () => refus('https://evil.example/x.webm'));
  it('9b. une origine étrangère qui imite le chemin', () => refus(`https://evil.example${PREFIXE}media/u1/rendus/a.webm`));
  it('10. une adresse locale', async () => {
    await refus(`http://127.0.0.1${PREFIXE}media/u1/rendus/a.webm`);
    await refus(`http://localhost:3000${PREFIXE}media/u1/rendus/a.webm`);
    await refus(`http://169.254.169.254/latest/meta-data/x.webm`);
  });
  it('11. les schémas exotiques', async () => {
    await refus('data:video/webm;base64,AAAA.webm');
    await refus('file:///etc/passwd.webm');
    await refus('ftp://studiio.pro/x.webm');
    await refus('javascript:alert(1)//.webm');
  });
  it('12. le préfixe partagé `converted/` n est PAS une source acceptable ici', async () => {
    await refus(objet('media/converted/x.webm'));
    await refus(objet('media/converted/converted_1712345678.webm'));
  });
  it('12b. une traversée ou une clé vide', async () => {
    await refus(objet('media/u1/../u2/rendus/a.webm'));
    await refus(objet('media/u1/rendus/..%2F..%2Fu2/a.webm'));
    await refus(objet('media/'));
    await refus(objet('media'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Le corps de la requête', () => {
  it('videoUrl absent, non chaîne, ou trop long → 400', async () => {
    connecte('u1');
    for (const v of [undefined, null, 42, {}, [], '', 'x'.repeat(2049)]) {
      const { statut } = await appeler(v);
      expect(statut, String(v).slice(0, 20)).toBe(400);
    }
    expect(telechargements).toHaveLength(0);
  });

  it('un JSON illisible → 400', async () => {
    connecte('u1');
    const res = await POST(requete('{pas du json'));
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('13-14. Les échecs de téléchargement', () => {
  it('13. trop volumineux → 413, pas de ffmpeg, temporaire supprimé', async () => {
    connecte('u1');
    scenarioTelechargement = { code: 'trop_volumineux', octetsPartiels: 4096 };
    const { statut, texte } = await appeler(objet('media/u1/rendus/a.webm'));
    expect(statut).toBe(413);
    expect(conversions).toHaveLength(0);
    expect(depots).toHaveLength(0);
    expect(telechargements).toHaveLength(1);
    expect(existsSync(telechargements[0].destPath)).toBe(false);
    expect(texte).not.toContain('/tmp');
    expect(texte).not.toContain('u1/rendus');
  });

  it('14. délai → 504, temporaire supprimé', async () => {
    connecte('u1');
    scenarioTelechargement = { code: 'delai' };
    const { statut } = await appeler(objet('media/u1/rendus/a.webm'));
    expect(statut).toBe(504);
    expect(conversions).toHaveLength(0);
    expect(existsSync(telechargements[0].destPath)).toBe(false);
  });

  it.each([
    ['introuvable', 404], ['acces_refuse', 404], ['cible_invalide', 404],
    ['reseau', 500], ['stockage', 500],
  ] as const)('%s → %i, sans détail', async (code, attendu) => {
    connecte('u1');
    scenarioTelechargement = { code };
    const { statut, corps, texte } = await appeler(objet('media/u1/rendus/a.webm'));
    expect(statut).toBe(attendu);
    // Le corps est la chaîne STATIQUE du statut — jamais le message de l'erreur.
    expect(corps).toEqual({
      success: false,
      error: attendu === 404 ? 'Média introuvable' : 'La conversion a échoué',
    });
    expect(texte).not.toContain('u1/rendus');
    expect(existsSync(telechargements[0].destPath)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('15. Le raccourci non-webm — après la session et la propriété', () => {
  it('une clé mp4 du compte → skipped, avec l URL publique RECONSTRUITE', async () => {
    connecte('u1');
    const { statut, corps } = await appeler(objet('media/u1/montage/x.mp4'));
    expect(statut).toBe(200);
    expect(corps).toEqual({
      success: true, skipped: true,
      mp4Url: `${ORIGINE}${PREFIXE}media/u1/montage/x.mp4`,
    });
    expect(corps.mp4Url).toContain('/storage/v1/object/public/media/u1/montage/x.mp4');
    expect(telechargements).toHaveLength(0);
    expect(conversions).toHaveLength(0);
    expect(depots).toHaveLength(0);
  });

  it('l extension est lue sur la CLÉ, pas sur la chaîne brute', async () => {
    connecte('u1');
    // `.WEBM` en majuscules est bien un webm → conversion.
    const { statut } = await appeler(objet('media/u1/rendus/A.WEBM'));
    expect(statut).toBe(200);
    expect(telechargements).toHaveLength(1);
  });

  it('une clé mp4 d un AUTRE compte → 404, jamais d écho', async () => {
    connecte('u1');
    const { statut, corps } = await appeler(objet('media/u2/montage/x.mp4'));
    expect(statut).toBe(404);
    expect(corps.skipped).toBeUndefined();
    expect(corps.mp4Url).toBeUndefined();
  });

  it('sans session → 401 même pour un mp4', async () => {
    const { statut } = await appeler(objet('media/u1/montage/x.mp4'));
    expect(statut).toBe(401);
  });

  it('une requête (`?webm`) est refusée : 404, pas de raccourci', async () => {
    connecte('u1');
    const { statut, corps } = await appeler(`${objet('media/u1/montage/x.mp4')}?webm`);
    expect(statut).toBe(404);
    expect(corps.mp4Url).toBeUndefined();
    expect(telechargements).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('16. Deux conversions en parallèle', () => {
  it('deux identifiants, deux temporaires, deux clés de dépôt distincts', async () => {
    connecte('u1');
    const [a, b] = await Promise.all([
      appeler(objet('media/u1/rendus/a.webm')),
      appeler(objet('media/u1/rendus/b.webm')),
    ]);
    expect(a.statut).toBe(200);
    expect(b.statut).toBe(200);
    expect(a.corps.conversionId).not.toBe(b.corps.conversionId);
    expect(new Set(telechargements.map((t) => t.destPath)).size).toBe(2);
    expect(new Set(conversions.map((c) => c.outputPath)).size).toBe(2);
    expect(new Set(depots.map((d) => d.path)).size).toBe(2);
    for (const c of conversions) {
      expect(existsSync(c.inputPath)).toBe(false);
      expect(existsSync(c.outputPath)).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('17. Les échecs de conversion et de dépôt ne disent rien', () => {
  const INTERDITS = ['/tmp', 'Command failed', 'stderr', 'ffmpeg', '/usr/bin', 'secret', 'u1/rendus', 'AccessDenied', '9000'];

  it('ffmpeg lève → 500 générique', async () => {
    connecte('u1');
    scenarioFfmpeg = { echec: true };
    const { statut, corps, texte } = await appeler(objet('media/u1/rendus/a.webm'));
    expect(statut).toBe(500);
    expect(corps).toEqual({ success: false, error: 'La conversion a échoué' });
    for (const mot of INTERDITS) expect(texte).not.toContain(mot);
    expect(depots).toHaveLength(0);
    expect(existsSync(conversions[0].inputPath)).toBe(false);
  });

  it('sortie trop petite → 500 générique, sans stderr', async () => {
    connecte('u1');
    scenarioFfmpeg = { octets: 100 };
    const { statut, corps, texte } = await appeler(objet('media/u1/rendus/a.webm'));
    expect(statut).toBe(500);
    expect(corps).toEqual({ success: false, error: 'La conversion a échoué' });
    for (const mot of INTERDITS) expect(texte).not.toContain(mot);
    expect(corps.outputSize).toBeUndefined();
    expect(depots).toHaveLength(0);
    expect(existsSync(conversions[0].outputPath)).toBe(false);
  });

  it('le dépôt échoue → 500 générique, sans message du SDK', async () => {
    connecte('u1');
    panneDepot = true;
    const { statut, corps, texte } = await appeler(objet('media/u1/rendus/a.webm'));
    expect(statut).toBe(500);
    expect(corps).toEqual({ success: false, error: 'La conversion a échoué' });
    for (const mot of INTERDITS) expect(texte).not.toContain(mot);
    expect(existsSync(conversions[0].outputPath)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('18. Le journal', () => {
  const URL_SENSIBLE = objet('media/u1/rendus/a.webm');

  it('ne porte jamais l URL, la clé, ni l URL publique — chemin nominal', async () => {
    connecte('u1');
    const { corps } = await appeler(URL_SENSIBLE);
    const texte = journalTexte();
    expect(texte).not.toContain(URL_SENSIBLE);
    expect(texte).not.toContain('u1/rendus/a.webm');
    expect(texte).not.toContain(corps.mp4Url);
    expect(texte).not.toContain('?token');
    expect(texte).toContain(corps.conversionId);
  });

  it('ni sur les chemins d échec', async () => {
    connecte('u1');
    const sensible = `${URL_SENSIBLE}`;
    scenarioTelechargement = { code: 'trop_volumineux' };
    await appeler(sensible);
    scenarioTelechargement = { octets: 4096 };
    scenarioFfmpeg = { echec: true };
    await appeler(sensible);
    scenarioFfmpeg = { octets: 8192 };
    panneDepot = true;
    await appeler(sensible);
    const texte = journalTexte();
    expect(texte).not.toContain(URL_SENSIBLE);
    expect(texte).not.toContain('u1/rendus/a.webm');
    expect(texte).not.toContain('?token');
    expect(texte).not.toContain('AccessDenied');
  });

  it('un identifiant de compte n y figure qu abrégé', async () => {
    connecte('0123456789abcdef-compte-long');
    await appeler(objet('media/0123456789abcdef-compte-long/rendus/a.webm'));
    const texte = journalTexte();
    expect(texte).not.toContain('0123456789abcdef-compte-long');
    expect(texte).toContain('01234567');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('19. Le cadre d exécution', () => {
  it('`maxDuration` reste à 300 s — un autre test le lit aussi', () => {
    const source = readFileSync(join(process.cwd(), 'src/app/api/convert/to-mp4/route.ts'), 'utf-8');
    expect(source).toContain('export const maxDuration = 300');
    // Et le temporaire vient du système, jamais d'un `/tmp` en dur.
    expect(source).toContain('tmpdir()');
    expect(source).not.toMatch(/['"]\/tmp['"]/);
    // Jamais d'écrasement au dépôt.
    expect(source).toContain('upsert: false');
    expect(source).not.toContain('upsert: true');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('20. Une source trop petite', () => {
  it('< 1024 octets → 422 sans révéler la taille', async () => {
    connecte('u1');
    scenarioTelechargement = { octets: 512 };
    const { statut, corps } = await appeler(objet('media/u1/rendus/a.webm'));
    expect(statut).toBe(422);
    expect(corps).toEqual({ success: false, error: 'Source vidéo vide ou corrompue' });
    expect(corps.sourceSize).toBeUndefined();
    expect(JSON.stringify(corps)).not.toContain('512');
    expect(conversions).toHaveLength(0);
    expect(existsSync(telechargements[0].destPath)).toBe(false);
  });
});
