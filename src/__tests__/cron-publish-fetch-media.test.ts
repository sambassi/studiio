/**
 * Le cron de publication telecharge des medias AU NOM DU PROPRIETAIRE du post.
 *
 * `downloadMediaToFile` (src/lib/storage/fetch-media.ts) refuse desormais
 * toute cle qui n'est pas sous `<userId>/…`. Le cron doit donc lui passer
 * `post.user_id` a CHAQUE appel — sinon un post dont `media_url` designe
 * l'objet d'un autre compte serait telecharge, converti et publie.
 *
 * Deux niveaux :
 * 1. Statique — chaque appel du fichier passe `{ userId }`, aucun ne passe
 *    plus l'ancien 3e argument positionnel `fallbackOrigin`.
 * 2. Comportemental — le gestionnaire `GET` tourne pour de vrai sur un post
 *    (`?force=true`, dependances lourdes mockees) :
 *    - media du compte → l'aide recoit `userId === post.user_id` ;
 *    - media forge d'un autre compte → l'aide leve `acces_refuse`, rien
 *      n'est publie, le post finit `failed` comme aujourd'hui, et ni l'URL
 *      ni le message de l'aide ne sortent dans les journaux d'erreur.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { NextRequest } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────
// 1. Statique
// ─────────────────────────────────────────────────────────────────────────

const CHEMIN_CRON = join(process.cwd(), 'src/app/api/cron/publish/route.ts');
const cron = readFileSync(CHEMIN_CRON, 'utf-8');

/** Chaque appel `downloadMediaToFile(…)` du fichier, avec ses arguments. */
function appelsTelechargement(source: string): Array<{ ligne: number; args: string }> {
  const appels: Array<{ ligne: number; args: string }> = [];
  const motif = /downloadMediaToFile\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = motif.exec(source)) !== null) {
    // L'import n'est pas un appel.
    const avant = source.slice(0, m.index);
    const ligne = avant.split('\n').length;
    appels.push({ ligne, args: m[1] });
  }
  return appels;
}

describe('Statique — chaque telechargement du cron porte le proprietaire du post', () => {
  const appels = appelsTelechargement(cron);

  it('il y a exactement quatre appels (video convertie, video muxee, musique, voix)', () => {
    expect(appels.map((a) => a.ligne)).toHaveLength(4);
  });

  it.each(appelsTelechargement(cron))(
    'ligne $ligne : passe un objet d options avec `userId`',
    ({ args }) => {
      const parts = args.split(',').map((s) => s.trim());
      expect(parts).toHaveLength(3);
      expect(parts[2]).toBe('{ userId }');
    },
  );

  it("aucun appel ne passe plus l'ancien 3e argument positionnel `fallbackOrigin`", () => {
    for (const { ligne, args } of appels) {
      const troisieme = args.split(',')[2]?.trim() ?? '';
      expect(troisieme.startsWith('{'), `L${ligne} : « ${troisieme} »`).toBe(true);
      expect(troisieme).not.toMatch(/^['"`]/);
      expect(troisieme).not.toBe('fallbackOrigin');
    }
    expect(cron).not.toContain('downloadMediaToBuffer');
  });

  it('le `userId` remonte du post traite, sans prefixe partage', () => {
    expect(cron).toContain('muxAudioIntoVideo(videoData.video_url, meta.musicUrl, meta.voiceUrl, post.user_id)');
    expect(cron).toContain('publishToInstagram(authedAccount, videoData, post.caption, post.user_id)');
    expect(cron).toContain('convertToMp4IfNeeded(video.video_url, userId)');
    // La source d'une conversion ou d'un muxage n'est jamais un
    // `converted/…` : le cron ne relit jamais ce qu'il ecrit.
    expect(cron).not.toContain('prefixesPartages');
  });

  it("les sites de capture journalisent un code, jamais l'erreur brute", () => {
    expect(cron).not.toContain('console.error(`[CONVERT] Conversion failed:`, error)');
    expect(cron).not.toContain('console.error(`[MUX] Erreur:`, err)');
    expect(cron).not.toContain('échoué:`, e)');
    expect(cron).toContain('motifErreur(');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. Comportemental
// ─────────────────────────────────────────────────────────────────────────

const PROPRIETAIRE = 'user-proprio-0000-0000-000000000001';
const AUTRE = 'user-autre-0000-0000-000000000002';
const POST_ID = 'post-0000-0000-0000-000000000001';

/** Ce que le faux `downloadMediaToFile` a recu. */
type AppelAide = { url: string; dest: string; options: unknown; reste: unknown[] };
const appelsAide: AppelAide[] = [];

/** Reglage par test : quelles URLs sont refusees, avec quel code. */
let refus: Map<string, string> = new Map();

class FausseErreurTelechargement extends Error {
  readonly code: string;
  constructor(code: string, url: string) {
    // Message VOLONTAIREMENT bavard : il porte l'URL. Si un journal
    // l'affichait tel quel, le test le verrait.
    super(`telechargement refuse pour ${url}`);
    this.code = code;
  }
}

vi.mock('@/lib/storage/fetch-media', () => ({
  downloadMediaToFile: vi.fn(async (url: string, dest: string, options: unknown, ...reste: unknown[]) => {
    appelsAide.push({ url, dest, options, reste });
    const code = refus.get(url);
    if (code) throw new FausseErreurTelechargement(code, url);
    return { sizeBytes: 1024, contentType: 'video/webm' };
  }),
}));

// ffmpeg ne tourne jamais dans ce test.
vi.mock('@/lib/ffmpeg/transcode-to-mp4', () => ({
  transcodeWebmToMp4WithLadder: vi.fn(async () => {
    throw new Error('ffmpeg indisponible en test');
  }),
}));
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const execFile = (_cmd: string, _args: unknown, _opts: unknown, cb: (e: Error | null) => void) => {
    cb(new Error('ffmpeg indisponible en test'));
  };
  return { ...actual, default: { ...actual, execFile }, execFile };
});

// Zernio : aucun compte connecte → chemin historique `social_accounts`.
vi.mock('@/lib/social/publishing', () => ({
  comptesConnectes: async () => [],
  droitDePublier: async () => ({ autorise: false }),
}));
vi.mock('@/lib/social/publishViaZernio', () => ({ publierViaZernio: vi.fn() }));
vi.mock('@/lib/social/token-refresh', () => ({ getValidToken: async () => 'jeton-test' }));
vi.mock('@/lib/email/resend', () => ({ sendEmail: vi.fn(async () => ({ success: true })) }));
vi.mock('@/lib/social/whatsapp', () => ({
  isWhatsAppEnabled: () => false,
  canUseWhatsApp: () => false,
  broadcastWhatsApp: vi.fn(),
  resolveRecipients: () => [],
  MAX_RECIPIENTS: 0,
  formatBroadcastFailures: () => '',
}));
vi.mock('@/lib/social/subscribers', () => ({ fetchSubscribers: async () => [], unsubscribeUrl: () => '' }));
vi.mock('@/lib/email/unsubscribe', () => ({
  unsubscribeEndpoint: () => '',
  filterSuppressed: async (l: unknown[]) => l,
  isSuppressed: async () => false,
  canUnsubscribe: async () => false,
}));
vi.mock('@/lib/admin', () => ({ isAdmin: () => false }));

/** Etat de la fausse base : le post du test, et ce que le cron y ecrit. */
let post: Record<string, unknown> = {};
const misesAJour: Array<{ table: string; valeurs: Record<string, unknown> }> = [];
const insertions: Array<{ table: string; valeurs: Record<string, unknown> }> = [];

type Appel = { m: string; args: unknown[] };

/** Reponse d'une chaine PostgREST, selon la table et les methodes appelees. */
function reponse(table: string, appels: Appel[]) {
  const a = (m: string) => appels.find((x) => x.m === m);
  if (a('update')) {
    const valeurs = a('update')!.args[0] as Record<string, unknown>;
    misesAJour.push({ table, valeurs });
    // Claim atomique scheduled → publishing : la ligne est rendue.
    if (table === 'scheduled_posts' && valeurs.status === 'publishing' && a('select')) {
      return { data: [{ id: POST_ID }], error: null };
    }
    return { data: [], error: null };
  }
  if (a('insert')) {
    insertions.push({ table, valeurs: a('insert')!.args[0] as Record<string, unknown> });
    return { data: null, error: null };
  }
  if (table === 'scheduled_posts') return { data: [post], error: null };
  if (table === 'social_accounts') {
    return {
      data: [{
        id: 'compte-ig', user_id: PROPRIETAIRE, platform: 'instagram', connected: true,
        access_token: 'jeton-stocke', account_id: '1789',
      }],
      error: null,
    };
  }
  return { data: [], error: null };
}

function chaine(table: string) {
  const appels: Appel[] = [];
  const p: Record<string | symbol, unknown> = new Proxy({}, {
    get(_cible, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (prop === 'then') {
        return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(reponse(table, appels)).then(res, rej);
      }
      return (...args: unknown[]) => { appels.push({ m: prop, args }); return p; };
    },
  });
  return p;
}

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => chaine(table),
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: (chemin: string) => ({ data: { publicUrl: `/storage/v1/object/public/media/${chemin}` } }),
      }),
    },
  },
}));

const SECRET = 'secret-cron-test';

function requeteForce() {
  return new NextRequest('http://localhost:3000/api/cron/publish?force=true', {
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

function fabriquerPost(mediaUrl: string, audio: { musicUrl?: string; voiceUrl?: string } = {}) {
  return {
    id: POST_ID,
    user_id: PROPRIETAIRE,
    title: 'Test',
    caption: 'legende',
    platforms: ['instagram'],
    status: 'scheduled',
    scheduled_date: '2026-01-01',
    scheduled_time: '08:00',
    video_id: null,
    videos: null,
    users: { email: 'proprio@test.local', name: 'Proprio' },
    media_url: mediaUrl,
    metadata: {
      renderedVideoUrl: mediaUrl,
      hasAudio: !!(audio.musicUrl || audio.voiceUrl),
      musicUrl: audio.musicUrl ?? null,
      voiceUrl: audio.voiceUrl ?? null,
    },
  };
}

type Journal = { canal: 'log' | 'warn' | 'error'; texte: string };
let journal: Journal[] = [];
const fetchGlobal = vi.fn(async () => { throw new Error('reseau ferme en test'); });

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  appelsAide.length = 0;
  misesAJour.length = 0;
  insertions.length = 0;
  refus = new Map();
  journal = [];
  const capter = (canal: Journal['canal']) => (...args: unknown[]) => {
    journal.push({
      canal,
      texte: args.map((x) => (typeof x === 'string' ? x : (x instanceof Error ? `${x.message}` : JSON.stringify(x)))).join(' '),
    });
  };
  vi.spyOn(console, 'log').mockImplementation(capter('log'));
  vi.spyOn(console, 'warn').mockImplementation(capter('warn'));
  vi.spyOn(console, 'error').mockImplementation(capter('error'));
  vi.stubGlobal('fetch', fetchGlobal);
  fetchGlobal.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function lancerCron() {
  const { GET } = await import('@/app/api/cron/publish/route');
  const res = await GET(requeteForce());
  return { statut: res.status, corps: await res.json() };
}

describe('Comportemental — media du compte', () => {
  const VIDEO = `/storage/v1/object/public/media/${PROPRIETAIRE}/rendus/montage.webm`;
  const MUSIQUE = `/storage/v1/object/public/audio/${PROPRIETAIRE}/musique.mp3`;
  const VOIX = `/storage/v1/object/public/audio/${PROPRIETAIRE}/voix.mp3`;

  it('chaque telechargement (mux ×3, conversion ×1) recoit `userId === post.user_id`', async () => {
    post = fabriquerPost(VIDEO, { musicUrl: MUSIQUE, voiceUrl: VOIX });
    const { statut } = await lancerCron();
    expect(statut).toBe(200);

    expect(appelsAide.map((a) => a.url)).toEqual([VIDEO, MUSIQUE, VOIX, VIDEO]);
    for (const a of appelsAide) {
      expect(a.options).toEqual({ userId: PROPRIETAIRE });
      expect(a.reste).toEqual([]);
    }
  });

  it("ne passe jamais un `prefixesPartages` : le cron ne relit pas `converted/`", async () => {
    post = fabriquerPost(VIDEO, { musicUrl: MUSIQUE });
    await lancerCron();
    for (const a of appelsAide) {
      expect(a.options).not.toHaveProperty('prefixesPartages');
    }
  });
});

describe("Comportemental — media forge d'un autre compte", () => {
  const FORGE = `/storage/v1/object/public/media/${AUTRE}/rendus/x.webm`;
  const MUSIQUE = `/storage/v1/object/public/audio/${PROPRIETAIRE}/musique.mp3`;

  beforeEach(() => {
    refus = new Map([[FORGE, 'acces_refuse']]);
    post = fabriquerPost(FORGE, { musicUrl: MUSIQUE });
  });

  it("l'aide est bien appelee avec le proprietaire du post, et refuse", async () => {
    const { statut } = await lancerCron();
    expect(statut).toBe(200);
    const tentatives = appelsAide.filter((a) => a.url === FORGE);
    // Mux (1) puis conversion (1) : les deux au nom du proprietaire.
    expect(tentatives).toHaveLength(2);
    for (const a of tentatives) expect(a.options).toEqual({ userId: PROPRIETAIRE });
  });

  it("rien n'est publie : aucun appel reseau vers la plateforme, pas de crash", async () => {
    const { corps } = await lancerCron();
    expect(fetchGlobal).not.toHaveBeenCalled();
    expect(corps.success).toBe(true);
    expect(corps.failed).toBe(1);
    expect(corps.succeeded).toBe(0);
  });

  it('le post finit `failed`, comme pour tout echec de conversion', async () => {
    await lancerCron();
    const finales = misesAJour.filter((m) => m.table === 'scheduled_posts' && m.valeurs.status === 'failed');
    expect(finales).toHaveLength(1);
    const historique = insertions.find((i) => i.table === 'publishing_history');
    expect(historique?.valeurs.status).toBe('failed');
    expect(String(historique?.valeurs.error_message)).toContain('telechargement:acces_refuse');
  });

  it("le muxage refuse est tolere (publication sans audio), puis la conversion echoue proprement", async () => {
    await lancerCron();
    const erreurs = journal.filter((j) => j.canal === 'error').map((j) => j.texte);
    expect(erreurs.some((t) => t.startsWith('[MUX] Erreur: telechargement:acces_refuse'))).toBe(true);
    expect(erreurs.some((t) => t.startsWith('[CONVERT] Conversion failed: telechargement:acces_refuse'))).toBe(true);
  });

  it("ni l'URL forgee ni le message de l'aide ne sortent dans les journaux d'erreur", async () => {
    await lancerCron();
    // Les sites de capture ecrivent sur `error` / `warn` : ni l'URL, ni le
    // message (qui la porte ici volontairement) ne doivent y apparaitre.
    for (const j of journal.filter((x) => x.canal !== 'log')) {
      expect(j.texte, `[${j.canal}] ${j.texte}`).not.toContain(FORGE);
      expect(j.texte, `[${j.canal}] ${j.texte}`).not.toContain('telechargement refuse pour');
    }
    // Et le message bavard de l'aide ne traverse AUCUN canal, meme `log` :
    // le cron ne relaie que le code.
    for (const j of journal) {
      expect(j.texte).not.toContain('telechargement refuse pour');
    }
    // Ce qui est ecrit en base ne porte pas l'URL non plus.
    const historique = insertions.find((i) => i.table === 'publishing_history');
    expect(String(historique?.valeurs.error_message)).not.toContain(FORGE);
    expect(String(historique?.valeurs.error_message)).not.toContain(AUTRE);
  });
});
