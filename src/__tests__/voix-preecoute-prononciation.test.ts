// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Pré-écoute d'une prononciation (icône haut-parleur) et borne ≈ 5 s de
 * « Écouter ma voix » — le serveur est seul juge.
 *
 * Doublures : `user_voices` / `user_settings` en mémoire, ElevenLabs par
 * `fetch` intercepté (aucun appel réseau réel), crédits et stockage
 * espionnés pour prouver qu'ils ne sont jamais touchés.
 *
 * Ce que ces tests verrouillent : seul `{ affiche }` est lu ; le mini-texte
 * est fabriqué par le serveur depuis l'entrée DU COMPTE et passe par
 * `scriptParle` ; le texte dit est borné à MAX_CARACTERES_PREECOUTE ;
 * `/api/voice/ecoute` refuse un texte dit trop long ; le limiteur répond 429
 * avec Retry-After ; aucun crédit, aucun envoi au stockage.
 */

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const V1 = '44444444-4444-4444-8444-000000000001';

type Ligne = Record<string, unknown>;
const base = vi.hoisted(() => ({ voices: [] as Ligne[], settings: [] as Ligne[] }));
const eleven = vi.hoisted(() => ({ appels: [] as Array<{ url: string; body: { text: string; model_id: string } }>, statut: 200 }));
const espions = vi.hoisted(() => ({ credits: [] as string[], stockage: [] as string[] }));

vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => {
    const source = table === 'user_voices' ? base.voices : table === 'user_settings' ? base.settings : null;
    if (!source) throw new Error(`table inattendue ${table}`);
    const filtres: Array<(l: Ligne) => boolean> = [];
    let colonnes: string[] | null = null;
    const exec = () => {
      const rows = source.filter((l) => filtres.every((f) => f(l)));
      const projeter = (l: Ligne) => (colonnes ? Object.fromEntries(colonnes.map((c) => [c, l[c]])) : { ...l });
      return { data: rows.map(projeter), error: null };
    };
    const api = {
      select(c?: string) { if (c && c !== '*') colonnes = c.split(',').map((x) => x.trim()); return api; },
      eq(k: string, v: unknown) { filtres.push((l) => l[k] === v); return api; },
      order() { return api; },
      async limit() { return exec(); },
      async upsert() { throw new Error('écriture inattendue'); },
      then(resolve: (v: unknown) => void, reject: (e: unknown) => void) { return Promise.resolve().then(exec).then(resolve, reject); },
    };
    return api;
  };
  // Aucun `storage` : un envoi au stockage par ce client lèverait.
  return { supabase: {}, supabaseAdmin: { from } };
});

const session = vi.hoisted(() => ({ courante: { user: { id: 'aaaaaaaa-1111-4111-8111-111111111111' } } as unknown }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => session.courante }));

// Crédits et stockage : chaque fonction est remplacée par un espion qui note son appel.
const espion = (liste: string[], nom: string) => vi.fn(async () => { liste.push(nom); throw new Error(`${nom} ne doit pas être appelé`); });
vi.mock('@/lib/credits/system', () => ({
  getUserCredits: espion(espions.credits, 'getUserCredits'), deductCredits: espion(espions.credits, 'deductCredits'),
  addCredits: espion(espions.credits, 'addCredits'), canRenderVideo: espion(espions.credits, 'canRenderVideo'),
  getVideoRenderCost: vi.fn(() => { espions.credits.push('getVideoRenderCost'); return 0; }),
}));
vi.mock('@/lib/credits/guard', () => ({ requireCredits: espion(espions.credits, 'requireCredits'), deductCredits: espion(espions.credits, 'guard.deductCredits') }));
vi.mock('@/lib/credits/atomique', () => ({ debiterRenduAtomique: espion(espions.credits, 'debiterRenduAtomique'), debiterOperationAtomique: espion(espions.credits, 'debiterOperationAtomique') }));
vi.mock('@/lib/credits/crediter', () => ({ crediterIdempotent: espion(espions.credits, 'crediterIdempotent') }));
vi.mock('@/lib/storage/upload', () => ({
  uploadToStorage: espion(espions.stockage, 'uploadToStorage'), uploadBufferToStorage: espion(espions.stockage, 'uploadBufferToStorage'),
  uploadFileToStorage: espion(espions.stockage, 'uploadFileToStorage'), deleteFromStorage: espion(espions.stockage, 'deleteFromStorage'),
  getSignedUrl: espion(espions.stockage, 'getSignedUrl'),
}));
vi.mock('@/lib/storage/s3-client', () => {
  const s3Storage = { from: vi.fn(() => { espions.stockage.push('s3Storage.from'); throw new Error('stockage interdit'); }) };
  return { s3Storage, default: s3Storage };
});

globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
  const u = String(url);
  if (u.startsWith('https://api.elevenlabs.io/v1/text-to-speech/')) {
    eleven.appels.push({ url: u, body: JSON.parse(String(init?.body)) });
    if (eleven.statut !== 200) return new Response('quota', { status: eleven.statut });
    return new Response(Buffer.from('AUDIO-MP3'), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
  }
  throw new Error(`fetch inattendu ${u}`);
}) as unknown as typeof fetch;

process.env.ELEVENLABS_API_KEY = 'cle-de-test';

const { POST: ECOUTER_PRONONCIATION } = await import('@/app/api/voice/prononciations/ecoute/route');
const { POST: ECOUTER } = await import('@/app/api/voice/ecoute/route');
const { scriptParle } = await import('@/lib/voice/prononciations');
const { MAX_CARACTERES_PREECOUTE, couperAuMot } = await import('@/lib/voice/preecoute');
const { reinitialiserPreecoute, LIMITE_PREECOUTE_MINUTE, LIMITE_PREECOUTE_HEURE } = await import('@/lib/voice/preecoute-serveur');
const { creerLimiteurMemoire } = await import('@/lib/securite/limiteur-memoire');

const PRONONCIATIONS = [
  { affiche: 'Afroboost', prononce: 'Afro-Boost' },
  { affiche: 'Neuchâtel', prononce: 'Neu-châ-tel' },
];
const voix = (): Ligne => ({
  id: V1, user_id: U, provider: 'elevenlabs', provider_voice_id: 'pvid_0001_abcd', name: 'Bassi', lang: 'fr',
  consent_at: '2026-08-01T00:00:00Z', consent_text: 'x', created_at: '2026-08-01T00:00:00Z',
});
const avecPrononciations = (liste: Array<{ affiche: string; prononce: string }>) => {
  base.settings = [{ user_id: U, creator_preferences: { voixPersonnelle: { userVoiceId: null, prononciations: liste } } }];
};
const post = (h: (r: NextRequest) => Promise<Response>, body: unknown) =>
  h(new NextRequest('https://studiio.pro/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

beforeEach(() => {
  base.voices = [voix()];
  avecPrononciations(PRONONCIATIONS);
  eleven.appels.length = 0; eleven.statut = 200;
  espions.credits.length = 0; espions.stockage.length = 0;
  session.courante = { user: { id: U } };
  process.env.ELEVENLABS_API_KEY = 'cle-de-test';
  reinitialiserPreecoute();
});

describe('POST /api/voice/prononciations/ecoute — le mini-extrait, fabriqué par le serveur', () => {
  it('⚠️ seul le mot de la ligne part à la synthèse, tel que `scriptParle` le dit (Afroboost → Afro-Boost), même voix et même modèle', async () => {
    const res = await post(ECOUTER_PRONONCIATION, { affiche: 'Afroboost' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('AUDIO-MP3');
    expect(eleven.appels).toHaveLength(1);
    expect(eleven.appels[0].url).toContain('/v1/text-to-speech/pvid_0001_abcd?');
    expect(eleven.appels[0].body).toEqual({ text: scriptParle('Afroboost', PRONONCIATIONS), model_id: 'eleven_multilingual_v2' });
    expect(eleven.appels[0].body.text).toBe('Afro-Boost');
    expect(decodeURIComponent(res.headers.get('X-Studiio-Spoken')!)).toBe('Afro-Boost');
  });

  it('la casse et les espaces de la demande ne comptent pas : l’entrée DU COMPTE est retrouvée par sa clé', async () => {
    expect((await post(ECOUTER_PRONONCIATION, { affiche: '  AFROBOOST ' })).status).toBe(200);
    expect(eleven.appels[0].body.text).toBe('Afro-Boost');
  });

  it('⚠️ un long texte libre dans le corps est ignoré : seul l’`affiche` de l’entrée est dit', async () => {
    const long = 'Lorem ipsum '.repeat(200);
    const res = await post(ECOUTER_PRONONCIATION, { affiche: 'Neuchâtel', texte: long, text: long, spoken: long, duree: 600, voiceId: 'AUTRE_VOIX_1234' });
    expect(res.status).toBe(200);
    expect(eleven.appels).toHaveLength(1);
    expect(eleven.appels[0].body.text).toBe('Neu-châ-tel');
    expect(eleven.appels[0].url).toContain('/pvid_0001_abcd?');
  });

  it('⚠️ un texte libre SANS `affiche` → 400, aucun appel fournisseur', async () => {
    expect((await post(ECOUTER_PRONONCIATION, { texte: 'Dis ce que je veux pendant dix minutes' })).status).toBe(400);
    expect((await post(ECOUTER_PRONONCIATION, { affiche: 42 })).status).toBe(400);
    expect(eleven.appels).toEqual([]);
  });

  it('⚠️ une prononciation absente du compte → 404, aucun appel fournisseur', async () => {
    const res = await post(ECOUTER_PRONONCIATION, { affiche: 'Inconnu' });
    expect(res.status).toBe(404);
    expect((await res.json() as { code: string }).code).toBe('prononciation_introuvable');
    expect(eleven.appels).toEqual([]);
  });

  it('⚠️ la borne ≈ 5 s s’applique au texte DIT : une prononciation de 80 caractères est coupée au mot, ≤ MAX', async () => {
    const prononce = 'Un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze'.padEnd(80, 'z').slice(0, 80);
    expect(prononce.length).toBe(80);
    avecPrononciations([{ affiche: 'Long', prononce }]);
    const res = await post(ECOUTER_PRONONCIATION, { affiche: 'Long' });
    expect(res.status).toBe(200);
    const dit = eleven.appels[0].body.text;
    expect(dit.length).toBeLessThanOrEqual(MAX_CARACTERES_PREECOUTE);
    expect(prononce.startsWith(dit)).toBe(true);
    expect(prononce[dit.length]).toBe(' '); // coupé à une frontière de mot
    expect(MAX_CARACTERES_PREECOUTE).toBe(70);
  });

  it('sans voix → 409 ; sans session → 401 ; sans clé → 503 ; erreur fournisseur → 502 — jamais de faux audio', async () => {
    base.voices = [];
    expect((await post(ECOUTER_PRONONCIATION, { affiche: 'Afroboost' })).status).toBe(409);
    base.voices = [voix()];
    session.courante = null;
    expect((await post(ECOUTER_PRONONCIATION, { affiche: 'Afroboost' })).status).toBe(401);
    session.courante = { user: { id: U } };
    delete process.env.ELEVENLABS_API_KEY;
    expect((await post(ECOUTER_PRONONCIATION, { affiche: 'Afroboost' })).status).toBe(503);
    expect(eleven.appels).toEqual([]);
    process.env.ELEVENLABS_API_KEY = 'cle-de-test';
    eleven.statut = 500;
    expect((await post(ECOUTER_PRONONCIATION, { affiche: 'Afroboost' })).status).toBe(502);
  });

  it('cache : le même mot recliqué n’est synthétisé qu’une fois', async () => {
    expect((await post(ECOUTER_PRONONCIATION, { affiche: 'Afroboost' })).status).toBe(200);
    const res = await post(ECOUTER_PRONONCIATION, { affiche: 'Afroboost' });
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('AUDIO-MP3');
    expect(eleven.appels).toHaveLength(1);
  });

  it('⚠️ aucun crédit, aucun envoi au stockage, aucune URL publique', async () => {
    const res = await post(ECOUTER_PRONONCIATION, { affiche: 'Afroboost' });
    expect(res.status).toBe(200);
    await post(ECOUTER, { texte: 'Bienvenue chez Afroboost.' });
    expect(espions.credits).toEqual([]);
    expect(espions.stockage).toEqual([]);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('content-type')).not.toMatch(/json/);
  });
});

describe('POST /api/voice/ecoute — pré-écoute gratuite ≈ 5 s, refusée au-delà côté serveur', () => {
  it('⚠️ texte dit au-delà de la borne → 400 `texte_trop_long`, aucun appel fournisseur', async () => {
    const long = 'Bienvenue au cours Afroboost à Neuchâtel, venez danser avec nous ce soir.';
    expect(long.length).toBeLessThan(600);
    expect(scriptParle(long, PRONONCIATIONS).length).toBeGreaterThan(MAX_CARACTERES_PREECOUTE);
    const res = await post(ECOUTER, { texte: long });
    expect(res.status).toBe(400);
    expect((await res.json() as { code: string }).code).toBe('texte_trop_long');
    expect(eleven.appels).toEqual([]);
  });

  it('la borne porte sur le texte DIT, pas sur l’affiché : « 76% » compte « 76 pour cent »', async () => {
    const texte = '76% '.repeat(10).trim(); // 39 caractères affichés
    expect(texte.length).toBeLessThanOrEqual(MAX_CARACTERES_PREECOUTE);
    expect(scriptParle(texte, []).length).toBeGreaterThan(MAX_CARACTERES_PREECOUTE);
    expect((await post(ECOUTER, { texte })).status).toBe(400);
    expect(eleven.appels).toEqual([]);
  });

  it('un texte court passe toujours (exemple de l’écran)', async () => {
    const res = await post(ECOUTER, { texte: 'Bienvenue au cours Afroboost à Neuchâtel.' });
    expect(res.status).toBe(200);
    expect(eleven.appels[0].body.text).toBe('Bienvenue au cours Afro-Boost à Neu-châ-tel.');
  });
});

describe('limiteur — 10 / minute et 60 / heure par compte, communs aux deux écoutes', () => {
  it('⚠️ au-delà du quota de la fenêtre → 429 avec Retry-After, aucun appel fournisseur en plus', async () => {
    expect(LIMITE_PREECOUTE_MINUTE).toBe(10);
    expect(LIMITE_PREECOUTE_HEURE).toBe(60);
    for (let i = 0; i < LIMITE_PREECOUTE_MINUTE; i += 1) {
      const route = i % 2 === 0 ? ECOUTER_PRONONCIATION : ECOUTER;
      const res = await post(route, i % 2 === 0 ? { affiche: i % 4 === 0 ? 'Afroboost' : 'Neuchâtel' } : { texte: `Bonjour ${i}` });
      expect(res.status).toBe(200);
    }
    const appels = eleven.appels.length;
    for (const [route, body] of [[ECOUTER_PRONONCIATION, { affiche: 'Afroboost' }], [ECOUTER, { texte: 'Bonjour' }]] as const) {
      const res = await post(route, body);
      expect(res.status).toBe(429);
      expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
      expect((await res.json() as { error: string }).error).toBe('Trop d’écoutes, réessayez dans un instant.');
    }
    expect(eleven.appels.length).toBe(appels);
  });

  it('fenêtres glissantes, horloge injectée : la minute se libère, l’heure tient', () => {
    let t = 0;
    const l = creerLimiteurMemoire({ fenetres: [{ dureeMs: 60_000, max: 10 }, { dureeMs: 3_600_000, max: 60 }], maintenant: () => t });
    for (let i = 0; i < 10; i += 1) expect(l.consommer('u').ok).toBe(true);
    const refus = l.consommer('u');
    expect(refus).toEqual({ ok: false, reessayerDansS: 60 });
    expect(l.consommer('autre').ok).toBe(true); // par compte
    t = 30_000;
    expect(l.consommer('u')).toEqual({ ok: false, reessayerDansS: 30 });
    t = 60_000;
    expect(l.consommer('u').ok).toBe(true);
    // 60 passages dans l'heure, puis refus même minute après minute.
    for (let m = 2; m <= 7; m += 1) {
      t = m * 60_000;
      while (l.consommer('u').ok) { /* remplit la minute */ }
    }
    t = 8 * 60_000;
    const r = l.consommer('u');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reessayerDansS).toBeGreaterThan(60);
    t = 3_600_000 + 1;
    expect(l.consommer('u').ok).toBe(true);
  });

  it('couperAuMot : intact sous la borne, jamais au-delà, coupe franche si un seul mot géant', () => {
    expect(couperAuMot('Afro-Boost')).toBe('Afro-Boost');
    expect(couperAuMot('x'.repeat(90)).length).toBe(MAX_CARACTERES_PREECOUTE);
    expect(couperAuMot('aaa bbb ccc', 9)).toBe('aaa bbb');
  });
});
