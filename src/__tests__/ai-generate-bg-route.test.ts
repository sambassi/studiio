import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { inspect } from 'util';

/**
 * Action `generate-bg` (Affiche IA) de /api/ai/image — chemin DURABLE.
 *
 * Ce qui est verifie ici, c'est NOTRE code : la sortie Replicate est
 * rapatriee cote serveur, verifiee (taille, signature), ecrite dans notre
 * stockage, et SEULEMENT ensuite facturee ; l'URL temporaire
 * `replicate.delivery` n'apparait nulle part ; et aucune erreur du SDK ne
 * fait fuir le jeton d'API dans les logs. Replicate, le stockage et les
 * credits sont des doubles.
 */

const runMock = vi.fn();
const deductCreditsMock = vi.fn();
const getUserCreditsMock = vi.fn();
const authMock = vi.fn();
const alertMock = vi.fn();
const reportAlertMock = vi.fn();
const uploadMock = vi.fn();
const removeMock = vi.fn();
const getPublicUrlMock = vi.fn();
const fromMock = vi.fn();
const fetchMock = vi.fn();

vi.mock('replicate', () => ({
  default: class {
    run = runMock;
  },
}));

vi.mock('@/lib/auth/config', () => ({
  auth: () => authMock(),
}));

vi.mock('@/lib/credits/system', () => ({
  getUserCredits: (...a: unknown[]) => getUserCreditsMock(...a),
  deductCredits: (...a: unknown[]) => deductCreditsMock(...a),
}));

vi.mock('@/lib/service-alerts', () => ({
  detectAndReportServiceError: (...a: unknown[]) => alertMock(...a),
  reportServiceAlert: (...a: unknown[]) => reportAlertMock(...a),
}));

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    storage: {
      from: (bucket: string) => {
        fromMock(bucket);
        return {
          upload: (...a: unknown[]) => uploadMock(...a),
          remove: (...a: unknown[]) => removeMock(...a),
          getPublicUrl: (...a: unknown[]) => getPublicUrlMock(...a),
        };
      },
    },
  },
  supabase: {},
}));

const { POST } = await import('@/app/api/ai/image/route');
const { detecterSignatureImage, MAX_AFFICHE_IA_BYTES } = await import('@/lib/storage/image-signature');
const { erreurReplicateSanitisee } = await import('@/lib/ai/replicate-erreur');

/** Faux NextRequest : la route n'utilise que `.json()`. */
const post = async (body: unknown) => {
  const res = await POST({ json: async () => body } as never);
  return { status: res.status, body: await res.json() };
};

// ── Octets de test ──
const octetsWebp = (): Uint8Array => {
  const b = new Uint8Array(64);
  b.set([0x52, 0x49, 0x46, 0x46, 0x38, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20], 0);
  return b;
};
const octetsPng = (taille = 64): Uint8Array => {
  const b = new Uint8Array(taille);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return b;
};
const octetsGif = (): Uint8Array => new TextEncoder().encode('GIF89a\x00\x00\x00\x00\x00\x00');

/** FileOutput du SDK 1.x : `blob()` et `url()` sont des METHODES. */
const fileOutput = (bytes: Uint8Array, url = 'https://replicate.delivery/pbxt/x.webp') => ({
  blob: async () => new Blob([bytes as BlobPart]),
  url: () => new URL(url),
  toString: () => url,
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_RE = /^user-1\/image\/([0-9a-f-]{36})-affiche-ia\.(webp|png|jpg)$/;

let consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];
const toutesLesSortiesConsole = (): string =>
  consoleSpies
    .flatMap((s) => s.mock.calls)
    .map((args) => args.map((a: unknown) => inspect(a, { depth: null })).join(' '))
    .join('\n');

beforeEach(() => {
  vi.clearAllMocks();
  process.env.REPLICATE_API_TOKEN = 'r8_test';
  process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';
  authMock.mockResolvedValue({ user: { id: 'user-1' } });
  getUserCreditsMock.mockResolvedValue(100);
  deductCreditsMock.mockResolvedValue(true);
  uploadMock.mockResolvedValue({ data: { path: 'x' }, error: null });
  removeMock.mockResolvedValue({ data: [], error: null });
  getPublicUrlMock.mockImplementation((path: string) => ({
    data: { publicUrl: `https://studiio.pro/storage/v1/object/public/media/${path}` },
  }));
  vi.stubGlobal('fetch', fetchMock);
  consoleSpies = [
    vi.spyOn(console, 'error').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
    vi.spyOn(console, 'log').mockImplementation(() => {}),
  ];
});

afterEach(() => {
  vi.unstubAllGlobals();
  consoleSpies.forEach((s) => s.mockRestore());
});

describe('generate-bg — nominal : l\'affiche est stockee chez nous, puis facturee', () => {
  it('upload → debit → reponse avec une URL Studiio absolue, jamais celle de Replicate', async () => {
    runMock.mockResolvedValue([fileOutput(octetsWebp())]);

    const { status, body } = await post({ action: 'generate-bg', prompt: 'salle de sport neon' });

    expect(status).toBe(200);
    expect(body.success).toBe(true);

    // 1. Upload : une fois, bon bucket, bonne cle, bon type, pas d'ecrasement.
    expect(fromMock).toHaveBeenCalledWith('media');
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const [key, corps, opts] = uploadMock.mock.calls[0] as [string, Buffer, { contentType: string; upsert: boolean }];
    const m = key.match(KEY_RE);
    expect(m, key).not.toBeNull();
    expect(m![2]).toBe('webp');
    expect(Buffer.isBuffer(corps)).toBe(true);
    expect(corps.byteLength).toBe(64);
    expect(opts).toEqual({ contentType: 'image/webp', upsert: false });

    // 2. Debit : une fois, APRES l'upload, avec la reference du meme uuid.
    const generationId = m![1];
    expect(deductCreditsMock).toHaveBeenCalledTimes(1);
    expect(deductCreditsMock).toHaveBeenCalledWith('user-1', 5, 'ai-generate-bg', `ia:generate-bg:${generationId}`);
    expect(uploadMock.mock.invocationCallOrder[0]).toBeLessThan(deductCreditsMock.mock.invocationCallOrder[0]);

    // 3. Reponse : contrat complet, URL absolue Studiio.
    expect(body.resultUrl).toBe(`https://studiio.pro/storage/v1/object/public/media/user-1/image/${generationId}-affiche-ia.webp`);
    expect(body.action).toBe('generate-bg');
    expect(body.generationId).toBe(generationId);
    expect(body.generationId).toMatch(UUID_RE);
    expect(body.creditsUsed).toBe(5);
    expect(body.creditsRemaining).toBe(95);
    expect(body.format).toBe('9:16');
    expect(JSON.stringify(body)).not.toContain('replicate.delivery');
    expect(removeMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lit un vrai ReadableStream (FileOutput etend ReadableStream) en le bornant', async () => {
    const bytes = octetsPng(100);
    const stream = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(bytes.slice(0, 40)); c.enqueue(bytes.slice(40)); c.close(); },
    });
    runMock.mockResolvedValue([stream]);

    const { status, body } = await post({ action: 'generate-bg', prompt: 'x' });

    expect(status).toBe(200);
    const [key, corps, opts] = uploadMock.mock.calls[0] as [string, Buffer, { contentType: string }];
    expect(key).toMatch(/-affiche-ia\.png$/);
    expect(corps.byteLength).toBe(100);
    expect(opts.contentType).toBe('image/png');
    expect(body.resultUrl).toMatch(/\.png$/);
  });

  it('ne logge ni le prompt ni l\'URL Replicate', async () => {
    runMock.mockResolvedValue([fileOutput(octetsWebp(), 'https://replicate.delivery/pbxt/SECRET_PATH.webp')]);

    await post({ action: 'generate-bg', prompt: 'PROMPT_ULTRA_SECRET' });

    const sorties = toutesLesSortiesConsole();
    expect(sorties).not.toContain('PROMPT_ULTRA_SECRET');
    expect(sorties).not.toContain('SECRET_PATH');
    expect(sorties).not.toContain('replicate.delivery');
  });
});

describe('generate-bg — REPLICATE_API_TOKEN absent (vu en prod : « Service IA non configuré »)', () => {
  it('503 nomme la configuration manquante, alerte l\'administrateur, ne touche ni Replicate ni le stockage ni le solde', async () => {
    delete process.env.REPLICATE_API_TOKEN;
    runMock.mockResolvedValue([fileOutput(octetsWebp())]);

    const { status, body } = await post({ action: 'generate-bg', prompt: 'salle de sport neon' });

    expect(status).toBe(503);
    expect(body.success).toBe(false);
    expect(body.code).toBe('ia_non_configuree');
    expect(String(body.error)).toContain('Service IA non configuré');
    expect(String(body.error)).toContain('Aucun crédit débité');
    // L'alerte nomme la VARIABLE — jamais une valeur (il n'y en a pas).
    expect(reportAlertMock).toHaveBeenCalledTimes(1);
    const [service, severite, titre, details] = reportAlertMock.mock.calls[0] as [string, string, string, string];
    expect(service).toBe('replicate');
    expect(severite).toBe('critical');
    expect(`${titre} ${details}`).toContain('REPLICATE_API_TOKEN');
    expect(runMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
    expect(deductCreditsMock).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });
});

describe('generate-bg — le fournisseur echoue : rien n\'est ecrit, rien n\'est facture', () => {
  it('provider throws → erreur, pas d\'upload, pas de debit, pas d\'URL temporaire', async () => {
    runMock.mockRejectedValue(new Error('Prediction failed: boom'));

    const { status, body } = await post({ action: 'generate-bg', prompt: 'x' });

    expect(status).toBeGreaterThanOrEqual(500);
    expect(body.success).toBe(false);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(deductCreditsMock).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain('replicate.delivery');
    expect(alertMock).toHaveBeenCalledTimes(1);
  });

  it('une ApiError avec le jeton dans le message et les en-tetes ne le fait fuir nulle part', async () => {
    const err = new Error(
      'Request to https://api.replicate.com/v1/models/x/predictions failed with status 401 Unauthorized: headers Authorization: Bearer SECRET_TEST_TOKEN',
    );
    Object.assign(err, {
      name: 'ApiError',
      request: {
        url: 'https://api.replicate.com/v1/predictions',
        headers: { Authorization: 'Bearer SECRET_TEST_TOKEN', 'Content-Type': 'application/json' },
      },
      response: { status: 401, headers: { 'x-secret': 'SECRET_TEST_TOKEN' } },
    });
    runMock.mockRejectedValue(err);

    const { body } = await post({ action: 'generate-bg', prompt: 'x' });

    // Aucun argument d'aucun console.* ne contient le jeton (inspect profond).
    expect(consoleSpies.some((s) => s.mock.calls.length > 0)).toBe(true);
    expect(toutesLesSortiesConsole()).not.toContain('SECRET_TEST_TOKEN');
    // Ni ce qui part vers les alertes admin.
    expect(alertMock).toHaveBeenCalledTimes(1);
    const [service, transmis] = alertMock.mock.calls[0] as [string, unknown];
    expect(service).toBe('replicate');
    expect(inspect(transmis, { depth: null })).not.toContain('SECRET_TEST_TOKEN');
    expect((transmis as Error).message).toContain('401');
    // Ni la reponse.
    expect(JSON.stringify(body)).not.toContain('SECRET_TEST_TOKEN');
    expect(deductCreditsMock).not.toHaveBeenCalled();
  });
});

describe('generate-bg — octets invalides : refus AVANT stockage et debit', () => {
  it('un GIF est refuse (502)', async () => {
    runMock.mockResolvedValue([fileOutput(octetsGif(), 'https://replicate.delivery/x.gif')]);

    const { status, body } = await post({ action: 'generate-bg', prompt: 'x' });

    expect(status).toBe(502);
    expect(body.success).toBe(false);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(deductCreditsMock).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain('replicate.delivery');
  });

  it('du texte (page d\'erreur) est refuse (502)', async () => {
    runMock.mockResolvedValue([fileOutput(new TextEncoder().encode('<html>Not an image</html>'))]);

    const { status } = await post({ action: 'generate-bg', prompt: 'x' });

    expect(status).toBe(502);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(deductCreditsMock).not.toHaveBeenCalled();
  });

  it('une sortie vide est refusee (502)', async () => {
    runMock.mockResolvedValue([]);

    const { status } = await post({ action: 'generate-bg', prompt: 'x' });

    expect(status).toBe(502);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(deductCreditsMock).not.toHaveBeenCalled();
  });

  it('plus de 10 Mio (PNG valide + bourrage) : refus, pas d\'upload, pas de debit', async () => {
    runMock.mockResolvedValue([fileOutput(octetsPng(MAX_AFFICHE_IA_BYTES + 1))]);

    const { status, body } = await post({ action: 'generate-bg', prompt: 'x' });

    expect(status).toBeGreaterThanOrEqual(400);
    expect(body.success).toBe(false);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(deductCreditsMock).not.toHaveBeenCalled();
  });

  it('plus de 10 Mio en flux : la lecture s\'arrete avant la fin', async () => {
    const morceau = octetsPng(1024 * 1024); // 1 Mio, entete PNG au debut
    let servis = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        servis += 1;
        if (servis > 40) { c.close(); return; }
        c.enqueue(servis === 1 ? morceau : new Uint8Array(1024 * 1024));
      },
    });
    runMock.mockResolvedValue([stream]);

    const { status } = await post({ action: 'generate-bg', prompt: 'x' });

    expect(status).toBe(502);
    expect(servis).toBeLessThan(40);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(deductCreditsMock).not.toHaveBeenCalled();
  });
});

describe('generate-bg — stockage', () => {
  it('upload en erreur → reponse d\'erreur, pas de debit, pas d\'URL temporaire', async () => {
    runMock.mockResolvedValue([fileOutput(octetsWebp())]);
    uploadMock.mockResolvedValue({ data: null, error: { message: 'bucket indisponible' } });

    const { status, body } = await post({ action: 'generate-bg', prompt: 'x' });

    expect(status).toBe(502);
    expect(body.success).toBe(false);
    expect(deductCreditsMock).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain('replicate.delivery');
    expect(body.resultUrl).toBeUndefined();
  });

  it('URL publique relative + NEXT_PUBLIC_APP_URL → absolue', async () => {
    runMock.mockResolvedValue([fileOutput(octetsWebp())]);
    getPublicUrlMock.mockImplementation((path: string) => ({ data: { publicUrl: `/storage/v1/object/public/media/${path}` } }));
    process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro/';

    const { status, body } = await post({ action: 'generate-bg', prompt: 'x' });

    expect(status).toBe(200);
    expect(body.resultUrl).toMatch(/^https:\/\/studiio\.pro\/storage\/v1\/object\/public\/media\/user-1\/image\/[0-9a-f-]{36}-affiche-ia\.webp$/);
    expect(deductCreditsMock).toHaveBeenCalledTimes(1);
  });

  it('URL publique relative SANS NEXT_PUBLIC_APP_URL → efface, pas de debit, erreur', async () => {
    runMock.mockResolvedValue([fileOutput(octetsWebp())]);
    getPublicUrlMock.mockImplementation((path: string) => ({ data: { publicUrl: `/storage/v1/object/public/media/${path}` } }));
    delete process.env.NEXT_PUBLIC_APP_URL;

    const { status, body } = await post({ action: 'generate-bg', prompt: 'x' });

    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const key = uploadMock.mock.calls[0][0];
    expect(removeMock).toHaveBeenCalledWith([key]);
    expect(deductCreditsMock).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });
});

describe('generate-bg — debit', () => {
  it('« Insufficient credits » → 402, objet efface, AUCUNE alerte Replicate', async () => {
    runMock.mockResolvedValue([fileOutput(octetsWebp())]);
    deductCreditsMock.mockRejectedValue(new Error('Insufficient credits'));

    const { status, body } = await post({ action: 'generate-bg', prompt: 'x' });

    expect(status).toBe(402);
    expect(body.success).toBe(false);
    expect(body.creditsNeeded).toBe(5);
    expect(body.error).toMatch(/Crédits insuffisants/);
    const key = uploadMock.mock.calls[0][0];
    expect(removeMock).toHaveBeenCalledWith([key]);
    expect(alertMock).not.toHaveBeenCalled();
    expect(reportAlertMock).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain('replicate.delivery');
  });

  it('autre erreur de debit → 500, objet efface, pas d\'alerte Replicate', async () => {
    runMock.mockResolvedValue([fileOutput(octetsWebp())]);
    deductCreditsMock.mockRejectedValue(new Error('debit refuse : socle_absent'));

    const { status, body } = await post({ action: 'generate-bg', prompt: 'x' });

    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(removeMock).toHaveBeenCalledWith([uploadMock.mock.calls[0][0]]);
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('solde insuffisant AVANT generation → 402 sans appel au modele', async () => {
    getUserCreditsMock.mockResolvedValue(2);

    const { status, body } = await post({ action: 'generate-bg', prompt: 'x' });

    expect(status).toBe(402);
    expect(body.creditsNeeded).toBe(5);
    expect(runMock).not.toHaveBeenCalled();
  });
});

describe('generate-bg — validation du prompt et du format', () => {
  it.each(['9:16', '1:1', '16:9'] as const)('format %s → aspect_ratio et suffixe du prompt coherents', async (format) => {
    runMock.mockResolvedValue([fileOutput(octetsWebp())]);

    const { status, body } = await post({ action: 'generate-bg', prompt: '  plage au coucher du soleil  ', format });

    expect(status).toBe(200);
    expect(body.format).toBe(format);
    const [model, options] = runMock.mock.calls[0] as [string, { input: Record<string, unknown>; signal?: AbortSignal }];
    expect(model).toBe('black-forest-labs/flux-schnell');
    expect(options.input.aspect_ratio).toBe(format);
    expect(options.input.num_outputs).toBe(1);
    expect(options.input.output_format).toBe('webp');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    const p = options.input.prompt as string;
    expect(p.startsWith('plage au coucher du soleil,')).toBe(true);
    expect(p).toContain(`${format} aspect ratio`);
    for (const autre of ['9:16', '1:1', '16:9']) {
      if (autre !== format) expect(p).not.toContain(autre);
    }
  });

  it('format absent → 9:16 (retro-compatible)', async () => {
    runMock.mockResolvedValue([fileOutput(octetsWebp())]);

    const { body } = await post({ action: 'generate-bg', prompt: 'x' });

    expect(body.format).toBe('9:16');
    expect(runMock.mock.calls[0][1].input.aspect_ratio).toBe('9:16');
  });

  it.each(['4:3', '9:16 ', 'match_input_image', 42, { a: 1 }])('format invalide %s → 400 sans appel ni debit', async (format) => {
    const { status, body } = await post({ action: 'generate-bg', prompt: 'x', format });

    expect(status).toBe(400);
    expect(body.error).toContain('format');
    expect(runMock).not.toHaveBeenCalled();
    expect(getUserCreditsMock).not.toHaveBeenCalled();
    expect(deductCreditsMock).not.toHaveBeenCalled();
  });

  it.each([undefined, '', '   ', 42, null])('prompt invalide %s → 400', async (prompt) => {
    const { status, body } = await post({ action: 'generate-bg', prompt });

    expect(status).toBe(400);
    expect(body.error).toContain('prompt');
    expect(runMock).not.toHaveBeenCalled();
  });

  it('prompt de plus de 1000 caracteres → 400', async () => {
    const { status } = await post({ action: 'generate-bg', prompt: 'a'.repeat(1001) });

    expect(status).toBe(400);
    expect(runMock).not.toHaveBeenCalled();
  });
});

describe('generate-bg — sortie « legacy » (chaine URL)', () => {
  it('une URL hors replicate.delivery est refusee sans fetch, upload ni debit', async () => {
    runMock.mockResolvedValue(['https://evil.example/x.png']);

    const { status, body } = await post({ action: 'generate-bg', prompt: 'x' });

    expect(status).toBe(502);
    expect(body.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
    expect(deductCreditsMock).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain('evil.example');
  });

  it.each([
    'http://replicate.delivery/x.png',
    'https://user:pw@replicate.delivery/x.png',
    'https://replicate.delivery.evil.example/x.png',
    'https://notreplicate.delivery/x.png',
  ])('%s est refusee', async (url) => {
    runMock.mockResolvedValue([url]);

    const { status } = await post({ action: 'generate-bg', prompt: 'x' });

    expect(status).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(deductCreditsMock).not.toHaveBeenCalled();
  });

  it('une URL replicate.delivery est telechargee sans suivre de redirection, puis stockee', async () => {
    runMock.mockResolvedValue(['https://replicate.delivery/pbxt/legacy.webp']);
    fetchMock.mockResolvedValue(new Response(octetsWebp() as BodyInit, { status: 200 }));

    const { status, body } = await post({ action: 'generate-bg', prompt: 'x' });

    expect(status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://replicate.delivery/pbxt/legacy.webp');
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(body.resultUrl).toMatch(/^https:\/\/studiio\.pro\//);
    expect(JSON.stringify(body)).not.toContain('replicate.delivery');
  });

  it('une redirection 3xx est refusee', async () => {
    runMock.mockResolvedValue(['https://replicate.delivery/pbxt/legacy.webp']);
    fetchMock.mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://evil.example/x' } }));

    const { status } = await post({ action: 'generate-bg', prompt: 'x' });

    expect(status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(deductCreditsMock).not.toHaveBeenCalled();
  });
});

describe('detecterSignatureImage — helper pur', () => {
  it('reconnait PNG, JPEG, WEBP et refuse le reste', () => {
    expect(detecterSignatureImage(octetsPng())).toEqual({ mime: 'image/png', ext: 'png' });
    expect(detecterSignatureImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
    expect(detecterSignatureImage(octetsWebp())).toEqual({ mime: 'image/webp', ext: 'webp' });
    expect(detecterSignatureImage(octetsGif())).toBeNull();
    expect(detecterSignatureImage(new Uint8Array())).toBeNull();
    // RIFF sans WEBP (un WAV, par exemple)
    expect(detecterSignatureImage(new TextEncoder().encode('RIFF\x00\x00\x00\x00WAVE'))).toBeNull();
    // Trop court pour etre un PNG complet
    expect(detecterSignatureImage(new Uint8Array([0x89, 0x50, 0x4e]))).toBeNull();
  });
});

describe('erreurReplicateSanitisee — helper pur', () => {
  it('ne garde que message/status/code, caviarde les jetons, tronque a 300', () => {
    const err = new Error(`Authorization: Bearer r8_abcDEF123 — token r8_zzz ${'x'.repeat(500)}`);
    Object.assign(err, { request: { headers: { Authorization: 'Bearer r8_abcDEF123' } }, response: { status: 401 } });

    const s = erreurReplicateSanitisee(err);

    expect(Object.keys(s).sort()).toEqual(['message', 'provider', 'status']);
    expect(s.provider).toBe('replicate');
    expect(s.status).toBe(401);
    expect(s.message.length).toBeLessThanOrEqual(300);
    expect(s.message).not.toContain('r8_abcDEF123');
    expect(s.message).not.toContain('r8_zzz');
    expect(inspect(s, { depth: null })).not.toContain('r8_abcDEF123');
  });

  it('tolere une valeur non-Error', () => {
    expect(erreurReplicateSanitisee('boom').message).toBe('boom');
    expect(erreurReplicateSanitisee(undefined).message).toBe('Erreur inconnue');
    expect(erreurReplicateSanitisee({ message: 1 }).message).toBe('Erreur inconnue');
  });
});
