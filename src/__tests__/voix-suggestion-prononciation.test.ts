// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * « Suggérer » une prononciation : la règle locale (réutilise
 * `normaliserPourTTS`), la route serveur des cas difficiles (Anthropic
 * MOCKÉ — aucun appel réseau réel), et « Écouter avant d'enregistrer »
 * sur la route de pré-écoute existante (ElevenLabs MOCKÉ).
 */

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const V1 = '44444444-4444-4444-8444-000000000001';

type Ligne = Record<string, unknown>;
const base = vi.hoisted(() => ({ voices: [] as Ligne[], settings: [] as Ligne[], ecritures: 0 }));
const reseau = vi.hoisted(() => ({
  eleven: [] as Array<{ url: string; body: { text: string } }>,
  anthropic: [] as Array<{ headers: Record<string, string>; body: { model: string; messages: Array<{ content: string }> } }>,
  reponseAnthropic: { status: 200, texte: 'Afro-boust' as string | null },
  autres: [] as string[],
}));

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
      async upsert() { base.ecritures += 1; throw new Error('écriture inattendue'); },
      async update() { base.ecritures += 1; throw new Error('écriture inattendue'); },
      async insert() { base.ecritures += 1; throw new Error('écriture inattendue'); },
      then(resolve: (v: unknown) => void, reject: (e: unknown) => void) { return Promise.resolve().then(exec).then(resolve, reject); },
    };
    return api;
  };
  return { supabase: {}, supabaseAdmin: { from } };
});

const session = vi.hoisted(() => ({ courante: { user: { id: 'aaaaaaaa-1111-4111-8111-111111111111' } } as unknown }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => session.courante }));

globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
  const u = String(url);
  if (u.startsWith('https://api.elevenlabs.io/v1/text-to-speech/')) {
    reseau.eleven.push({ url: u, body: JSON.parse(String(init?.body)) });
    return new Response(Buffer.from('AUDIO-MP3'), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
  }
  if (u === 'https://api.anthropic.com/v1/messages') {
    reseau.anthropic.push({ headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) });
    const r = reseau.reponseAnthropic;
    if (r.status !== 200) return new Response('erreur', { status: r.status });
    return new Response(JSON.stringify({ content: r.texte === null ? [] : [{ type: 'text', text: r.texte }] }), { status: 200 });
  }
  reseau.autres.push(u);
  throw new Error(`fetch inattendu ${u}`);
}) as unknown as typeof fetch;

process.env.ELEVENLABS_API_KEY = 'cle-de-test';

const { suggererPrononciationLocale, nettoyerSuggestion } = await import('@/lib/voice/suggestion-prononciation');
const { normaliserPourTTS } = await import('@/lib/voice/normalisation-tts');
const { POST: SUGGERER } = await import('@/app/api/voice/prononciations/suggestion/route');
const { POST: ECOUTER_PRONONCIATION } = await import('@/app/api/voice/prononciations/ecoute/route');
const { reinitialiserPreecoute } = await import('@/lib/voice/preecoute-serveur');

const PRONONCIATIONS = [{ affiche: 'Afroboost', prononce: 'Afro-Boost' }];
const voix = (): Ligne => ({
  id: V1, user_id: U, provider: 'elevenlabs', provider_voice_id: 'pvid_0001_abcd', name: 'Bassi', lang: 'fr',
  consent_at: '2026-08-01T00:00:00Z', consent_text: 'x', created_at: '2026-08-01T00:00:00Z',
});
const post = (h: (r: NextRequest) => Promise<Response>, body: unknown) =>
  h(new NextRequest('https://studiio.pro/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

let compteurSession = 0;
beforeEach(() => {
  base.voices = [voix()];
  base.settings = [{ user_id: U, creator_preferences: { voixPersonnelle: { userVoiceId: null, prononciations: PRONONCIATIONS } } }];
  base.ecritures = 0;
  reseau.eleven.length = 0; reseau.anthropic.length = 0; reseau.autres.length = 0;
  reseau.reponseAnthropic = { status: 200, texte: 'Afro-boust' };
  session.courante = { user: { id: U } };
  delete process.env.ANTHROPIC_API_KEY;
  process.env.ELEVENLABS_API_KEY = 'cle-de-test';
  reinitialiserPreecoute();
  compteurSession += 1;
});

describe('suggestion LOCALE — règles déterministes, réutilise normaliserPourTTS', () => {
  const s = (t: string) => suggererPrononciationLocale(t);

  it('⚠️ « 3-en-1 OS RENFORCÉS » → « trois en un os renforcés » (mots courants en capitales remis en minuscules, pluriel compris)', () => {
    expect(s('3-en-1 OS RENFORCÉS')).toEqual({ suggestion: 'trois en un os renforcés', incertain: false, siglesEpeles: [] });
  });

  it('nombres, %, multiplicateurs, rythmes', () => {
    expect(s('-33 %').suggestion).toBe('moins trente-trois pour cent');
    expect(s('10x').suggestion).toBe('dix fois');
    expect(s('24h/24').suggestion).toBe('vingt-quatre heures sur vingt-quatre');
    expect(s('TOP 10').suggestion).toBe('top dix');
    // Au-delà de 99 ou décimal : laissé au moteur, comme la normalisation.
    expect(s('2 500 €').suggestion).toBe('2 500 euros');
    expect(s('1,5 kg').suggestion).toBe('1,5 kilo');
  });

  it('sigles : NEJM suit la règle existante, HIIT se dit comme un mot, un sigle inconnu est épelé et marqué incertain', () => {
    expect(s('NEJM').suggestion).toBe(normaliserPourTTS('NEJM'));
    expect(s('NEJM').suggestion).toBe('Nèjm');
    expect(s('HIIT')).toEqual({ suggestion: 'hit', incertain: false, siglesEpeles: [] });
    expect(s('ADN')).toEqual({ suggestion: 'A D N', incertain: true, siglesEpeles: ['ADN'] });
    expect(s('CARDIO').suggestion).toBe('cardio'); // mot long : un mot, pas un sigle
  });

  it('un nom propre que la règle ne sait pas dire → inchangé, marqué incertain', () => {
    expect(s('Afroboost')).toEqual({ suggestion: 'Afroboost', incertain: true, siglesEpeles: [] });
    expect(s('   ')).toEqual({ suggestion: '', incertain: true, siglesEpeles: [] });
  });

  it('⚠️ le texte affiché n’est jamais modifié, et la règle est déterministe', () => {
    const affiche = '3-en-1 OS RENFORCÉS';
    const copie = String(affiche);
    const a = s(affiche); const b = s(affiche);
    expect(affiche).toBe(copie);
    expect(a).toEqual(b);
  });

  it('nettoyerSuggestion : une ligne, sans guillemets, bornée, jamais identique à l’affiché', () => {
    expect(nettoyerSuggestion('« Afro-boust »\nexplication', 'Afroboost')).toBe('Afro-boust');
    expect(nettoyerSuggestion('afroboost', 'Afroboost')).toBeNull();
    expect(nettoyerSuggestion('x'.repeat(81), 'Afroboost')).toBeNull();
    expect(nettoyerSuggestion(42, 'Afroboost')).toBeNull();
  });
});

describe('POST /api/voice/prononciations/suggestion', () => {
  it('⚠️ session obligatoire : 401 sans session, aucun appel', async () => {
    session.courante = null;
    process.env.ANTHROPIC_API_KEY = 'cle-anthropic-test';
    expect((await post(SUGGERER, { affiche: 'Afroboost' })).status).toBe(401);
    expect(reseau.anthropic).toEqual([]);
  });

  it('entrée vide ou trop longue → 400', async () => {
    expect((await post(SUGGERER, {})).status).toBe(400);
    expect((await post(SUGGERER, { affiche: 'x'.repeat(81) })).status).toBe(400);
  });

  it('⚠️ cas sûr : la suggestion locale, AUCUN appel externe même avec la clé', async () => {
    process.env.ANTHROPIC_API_KEY = 'cle-anthropic-test';
    const res = await post(SUGGERER, { affiche: '3-en-1 OS RENFORCÉS' });
    expect(await res.json()).toEqual({ success: true, data: { suggestion: 'trois en un os renforcés', source: 'locale' } });
    expect(reseau.anthropic).toEqual([]);
  });

  it('⚠️ cas difficile SANS clé Anthropic : suggestion locale seulement, aucun appel', async () => {
    const res = await post(SUGGERER, { affiche: 'Afroboost' });
    expect(await res.json()).toEqual({ success: true, data: { suggestion: null, source: 'aucune', message: 'Aucune suggestion de prononciation différente trouvée.' } });
    expect(reseau.anthropic).toEqual([]);
  });

  it('cas difficile AVEC clé : l’infrastructure Anthropic existante (mockée) propose, rien n’est enregistré', async () => {
    process.env.ANTHROPIC_API_KEY = 'cle-anthropic-test';
    session.courante = { user: { id: `ia-${compteurSession}` } };
    const res = await post(SUGGERER, { affiche: 'Afroboost' });
    expect(await res.json()).toEqual({ success: true, data: { suggestion: 'Afro-boust', source: 'ia' } });
    expect(reseau.anthropic).toHaveLength(1);
    expect(reseau.anthropic[0].headers['x-api-key']).toBe('cle-anthropic-test');
    expect(reseau.anthropic[0].body.model).toBe('claude-sonnet-4-20250514');
    expect(reseau.anthropic[0].body.messages[0].content).toContain('Afroboost');
    expect(base.ecritures).toBe(0);
    expect(reseau.autres).toEqual([]);
  });

  it('panne, réponse vide ou identique → repli sur la suggestion locale', async () => {
    process.env.ANTHROPIC_API_KEY = 'cle-anthropic-test';
    session.courante = { user: { id: `panne-${compteurSession}` } };
    reseau.reponseAnthropic = { status: 500, texte: null };
    expect((await (await post(SUGGERER, { affiche: 'ADN' })).json()).data).toEqual({ suggestion: 'A D N', source: 'locale' });
    reseau.reponseAnthropic = { status: 200, texte: null };
    expect((await (await post(SUGGERER, { affiche: 'Afroboost' })).json()).data.source).toBe('aucune');
    reseau.reponseAnthropic = { status: 200, texte: 'AFROBOOST' };
    expect((await (await post(SUGGERER, { affiche: 'Afroboost' })).json()).data).toEqual({ suggestion: null, source: 'aucune', message: 'Aucune suggestion de prononciation différente trouvée.' });
  });

  it('limiteur par compte : au-delà de 10 par minute → 429 avec Retry-After', async () => {
    process.env.ANTHROPIC_API_KEY = 'cle-anthropic-test';
    session.courante = { user: { id: `limite-${compteurSession}` } };
    for (let i = 0; i < 10; i += 1) expect((await post(SUGGERER, { affiche: 'Afroboost' })).status).toBe(200);
    const res = await post(SUGGERER, { affiche: 'Afroboost' });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect(reseau.anthropic).toHaveLength(10);
  });
});

describe('POST /api/voice/prononciations/ecoute — écouter AVANT d’enregistrer', () => {
  it('⚠️ une paire non enregistrée { affiche, prononce } est dite telle quelle, sans rien enregistrer', async () => {
    const res = await post(ECOUTER_PRONONCIATION, { affiche: '3-en-1 OS RENFORCÉS', prononce: 'trois en un, os renforcés' });
    expect(res.status).toBe(200);
    expect(reseau.eleven).toHaveLength(1);
    expect(reseau.eleven[0].body.text).toBe('trois en un, os renforcés');
    expect(reseau.eleven[0].url).toContain('/pvid_0001_abcd?');
    expect(base.ecritures).toBe(0);
  });

  it('la forme en cours d’édition remplace l’entrée enregistrée le temps de l’écoute', async () => {
    const res = await post(ECOUTER_PRONONCIATION, { affiche: 'Afroboost', prononce: 'Afro-boust' });
    expect(res.status).toBe(200);
    expect(reseau.eleven[0].body.text).toBe('Afro-boust');
  });

  it('⚠️ mêmes règles qu’à l’enregistrement : identique, vide, trop long → 400 sans synthèse', async () => {
    expect((await post(ECOUTER_PRONONCIATION, { affiche: 'Afroboost', prononce: 'AFROBOOST' })).status).toBe(400);
    expect((await post(ECOUTER_PRONONCIATION, { affiche: 'Afroboost', prononce: '   ' })).status).toBe(400);
    expect((await post(ECOUTER_PRONONCIATION, { affiche: 'Afroboost', prononce: 'x'.repeat(81) })).status).toBe(400);
    expect(reseau.eleven).toEqual([]);
  });

  it('sans `prononce` : comportement d’avant inchangé (entrée inconnue → 404)', async () => {
    expect((await post(ECOUTER_PRONONCIATION, { affiche: 'Inconnu' })).status).toBe(404);
    expect(reseau.eleven).toEqual([]);
  });

  it('la borne ≈ 5 s et la session s’appliquent aussi à la paire non enregistrée', async () => {
    const prononce = 'un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze';
    expect(prononce.length).toBeLessThanOrEqual(80);
    expect((await post(ECOUTER_PRONONCIATION, { affiche: 'Long', prononce })).status).toBe(200);
    expect(reseau.eleven[0].body.text.length).toBeLessThanOrEqual(70);
    session.courante = null;
    expect((await post(ECOUTER_PRONONCIATION, { affiche: 'Long', prononce })).status).toBe(401);
  });
});
