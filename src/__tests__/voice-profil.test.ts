// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * « Ma voix & prononciations » — le serveur est l'autorité.
 *
 * Doublures : `user_voices` et `user_settings` en mémoire (filtres réels,
 * upsert), ElevenLabs par `fetch` intercepté, clé API contrôlée par l'env.
 *
 * Ce que ces tests verrouillent : la voix vient de `user_voices` DU compte,
 * jamais du navigateur ; un choix forgé/étranger/inexistant/inutilisable ne
 * parle jamais ; le choix est persisté dans `creator_preferences` sans
 * écraser les autres préférences ; les prononciations sont validées côté
 * serveur et scoppées au compte ; l'écoute envoie LA voix résolue et le
 * SPOKEN_SCRIPT, ou dit honnêtement qu'elle est indisponible / en échec.
 */

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRUI = 'bbbbbbbb-2222-4222-8222-222222222222';
const V1 = '44444444-4444-4444-8444-000000000001';
const V2 = '44444444-4444-4444-8444-000000000002';
const V_AUTRUI = '44444444-4444-4444-8444-000000000009';

type Ligne = Record<string, unknown>;
const base = vi.hoisted(() => ({
  voices: [] as Ligne[],
  settings: [] as Ligne[],
  journal: [] as string[],
  panneSettings: false,
}));
const eleven = vi.hoisted(() => ({ appels: [] as Array<{ url: string; body: unknown }>, statut: 200, audio: 'AUDIO-MP3' }));

vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => {
    const source = table === 'user_voices' ? base.voices : table === 'user_settings' ? base.settings : null;
    if (!source) throw new Error(`table inattendue ${table}`);
    const filtres: Array<(l: Ligne) => boolean> = [];
    let colonnes: string[] | null = null;
    let tri = false;
    const exec = () => {
      if (table === 'user_settings' && base.panneSettings) return { data: null, error: { message: 'panne settings' } };
      let rows = source.filter((l) => filtres.every((f) => f(l)));
      if (tri) rows = [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      const projeter = (l: Ligne) => (colonnes ? Object.fromEntries(colonnes.map((c) => [c, l[c]])) : { ...l });
      return { data: rows.map(projeter), error: null };
    };
    const api = {
      select(c?: string) { if (c && c !== '*') colonnes = c.split(',').map((x) => x.trim()); return api; },
      eq(k: string, v: unknown) { filtres.push((l) => l[k] === v); return api; },
      order() { tri = true; return api; },
      async limit() { return exec(); },
      async upsert(v: Ligne, opts: { onConflict: string }) {
        if (table !== 'user_settings') throw new Error('upsert inattendu');
        if (base.panneSettings) return { data: null, error: { message: 'panne settings' } };
        base.journal.push(`upsert:${opts.onConflict}:${JSON.stringify(v.creator_preferences)}`);
        const existante = base.settings.find((l) => l.user_id === v.user_id);
        if (existante) Object.assign(existante, v); else base.settings.push({ ...v });
        return { data: [v], error: null };
      },
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
    eleven.appels.push({ url: u, body: JSON.parse(String(init?.body)) });
    if (eleven.statut !== 200) return new Response('quota', { status: eleven.statut });
    return new Response(Buffer.from(eleven.audio), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
  }
  throw new Error(`fetch inattendu ${u}`);
}) as unknown as typeof fetch;

process.env.ELEVENLABS_API_KEY = 'cle-de-test';

const { GET: PROFIL } = await import('@/app/api/voice/profil/route');
const { PUT: CHOISIR } = await import('@/app/api/voice/profil/voix/route');
const { PUT: PRONONCIATIONS } = await import('@/app/api/voice/profil/prononciations/route');
const { POST: ECOUTER } = await import('@/app/api/voice/ecoute/route');
const { resoudreVoix, resoudreVoixDuCompte, voixUtilisable } = await import('@/lib/voice/profil');

const voix = (id: string, over: Ligne = {}): Ligne => ({
  id, user_id: U, provider: 'elevenlabs', provider_voice_id: `pvid_${id.slice(-4)}_abcd`, name: `Voix ${id.slice(-1)}`, lang: 'fr',
  consent_at: '2026-08-01T00:00:00Z', consent_text: 'x', created_at: `2026-08-0${id.slice(-1)}T00:00:00Z`, ...over,
});
const put = (h: (r: NextRequest) => Promise<Response>, body: unknown) =>
  h(new NextRequest('https://studiio.pro/x', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const post = (h: (r: NextRequest) => Promise<Response>, body: unknown) =>
  h(new NextRequest('https://studiio.pro/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const profil = async () => (await (await PROFIL()).json() as { data: Record<string, unknown> }).data;
const prefs = () => (base.settings.find((l) => l.user_id === U)?.creator_preferences ?? null) as Record<string, unknown> | null;

beforeEach(() => {
  base.voices = []; base.settings = []; base.journal.length = 0; base.panneSettings = false;
  eleven.appels.length = 0; eleven.statut = 200;
  session.courante = { user: { id: U } };
  process.env.ELEVENLABS_API_KEY = 'cle-de-test';
});

describe('résolution de la voix — la règle, pure', () => {
  it('aucune voix ; une seule utilisable → elle ; plusieurs → choix requis ; choix inexistant / inutilisable', () => {
    expect(resoudreVoix([], null)).toEqual({ ok: false, motif: 'aucune_voix' });
    const a = voix(V1) as never; const b = voix(V2) as never;
    expect(resoudreVoix([a], null)).toMatchObject({ ok: true, voix: { id: V1, utilisable: true } });
    expect(resoudreVoix([a, b], null)).toEqual({ ok: false, motif: 'choix_requis' });
    expect(resoudreVoix([a, b], V2)).toMatchObject({ ok: true, voix: { id: V2 } });
    expect(resoudreVoix([a, b], V_AUTRUI)).toEqual({ ok: false, motif: 'voix_inexistante' });
    expect(resoudreVoix([voix(V1, { provider_voice_id: '' }) as never], V1)).toEqual({ ok: false, motif: 'voix_inutilisable' });
    expect(resoudreVoix([voix(V1, { provider: 'inconnu' }) as never], null)).toEqual({ ok: false, motif: 'voix_inutilisable' });
  });

  it('utilisable = fournisseur câblé + provider_voice_id de forme valide', () => {
    expect(voixUtilisable({ provider: 'elevenlabs', provider_voice_id: 'abcdefgh' })).toBe(true);
    expect(voixUtilisable({ provider: 'elevenlabs', provider_voice_id: 'a/b' })).toBe(false);
    expect(voixUtilisable({ provider: 'elevenlabs', provider_voice_id: 'court' })).toBe(false);
    expect(voixUtilisable({ provider: 'heygen', provider_voice_id: 'abcdefgh' })).toBe(false);
  });
});

describe('GET /api/voice/profil', () => {
  it('sans session → 401', async () => { session.courante = null; expect((await PROFIL()).status).toBe(401); });

  it('aucune voix → état propre : liste vide, motif aucune_voix, écoute indisponible', async () => {
    expect(await profil()).toMatchObject({ voix: [], choix: null, voixResolue: null, motifVoix: 'aucune_voix', prononciations: [], ecouteDisponible: false });
  });

  it('une vraie voix → exposée par son id interne (jamais le provider_voice_id), résolue, écoute disponible', async () => {
    base.voices = [voix(V1)];
    const p = await profil();
    expect(p.voixResolue).toMatchObject({ id: V1, nom: 'Voix 1', utilisable: true });
    expect(JSON.stringify(p)).not.toContain('pvid_');
    expect(p.ecouteDisponible).toBe(true);
  });

  it('plusieurs voix → liste, choix requis, écoute indisponible tant qu’on n’a pas choisi ; sans clé fournisseur → écoute indisponible', async () => {
    base.voices = [voix(V1), voix(V2)];
    expect(await profil()).toMatchObject({ motifVoix: 'choix_requis', ecouteDisponible: false });
    base.settings = [{ user_id: U, creator_preferences: { voixPersonnelle: { userVoiceId: V2 } } }];
    expect(await profil()).toMatchObject({ voixResolue: { id: V2 }, ecouteDisponible: true });
    delete process.env.ELEVENLABS_API_KEY;
    expect(await profil()).toMatchObject({ voixResolue: { id: V2 }, ecouteDisponible: false });
  });

  it('⚠️ la voix d’un autre compte n’apparaît jamais ; un choix stocké vers elle → voix_inexistante', async () => {
    base.voices = [voix(V_AUTRUI, { user_id: AUTRUI }), voix(V1)];
    base.settings = [{ user_id: U, creator_preferences: { voixPersonnelle: { userVoiceId: V_AUTRUI } } }];
    const p = await profil();
    expect((p.voix as Array<{ id: string }>).map((v) => v.id)).toEqual([V1]);
    expect(p.motifVoix).toBe('voix_inexistante');
  });
});

describe('PUT /api/voice/profil/voix — le choix', () => {
  it('⚠️ choix persisté dans creator_preferences sans écraser les autres préférences ; serveur relit', async () => {
    base.voices = [voix(V1), voix(V2)];
    base.settings = [{ user_id: U, creator_preferences: { theme: 'sombre' } }];
    const res = await put(CHOISIR, { userVoiceId: V2 });
    expect(res.status).toBe(200);
    expect(prefs()).toEqual({ theme: 'sombre', voixPersonnelle: { userVoiceId: V2, prononciations: [] } });
    expect(await profil()).toMatchObject({ choix: V2, voixResolue: { id: V2 } });
    // null efface le choix.
    expect((await put(CHOISIR, { userVoiceId: null })).status).toBe(200);
    expect(await profil()).toMatchObject({ choix: null, motifVoix: 'choix_requis' });
  });

  it('⚠️ identifiant forgé, voix d’autrui, voix inexistante, voix inutilisable → refus, rien écrit', async () => {
    base.voices = [voix(V1), voix(V_AUTRUI, { user_id: AUTRUI }), voix(V2, { provider_voice_id: 'x' })];
    expect((await put(CHOISIR, { userVoiceId: 'pvid_0001_abcd' })).status).toBe(400);
    expect((await put(CHOISIR, { userVoiceId: V_AUTRUI })).status).toBe(404);
    expect((await put(CHOISIR, { userVoiceId: '44444444-4444-4444-8444-00000000dead' })).status).toBe(404);
    expect((await put(CHOISIR, { userVoiceId: V2 })).status).toBe(409);
    expect((await put(CHOISIR, {})).status).toBe(400);
    expect(base.journal).toEqual([]);
  });

  it('⚠️ un identifiant écrit DIRECTEMENT dans les préférences (contournement) est revalidé à la lecture', async () => {
    base.voices = [voix(V1)];
    base.settings = [{ user_id: U, creator_preferences: { voixPersonnelle: { userVoiceId: V_AUTRUI, prononciations: 'bruit' } } }];
    const r = await resoudreVoixDuCompte(U);
    expect(r).toEqual({ ok: false, motif: 'voix_inexistante' });
  });

  it('erreur DB → 500, rien de faux', async () => {
    base.voices = [voix(V1)]; base.panneSettings = true;
    expect((await put(CHOISIR, { userVoiceId: V1 })).status).toBe(500);
  });
});

describe('PUT /api/voice/profil/prononciations', () => {
  it('ajout / modification / suppression via la liste complète, validée ; persistance scoppée au compte', async () => {
    base.voices = [voix(V1)];
    expect((await put(PRONONCIATIONS, { prononciations: [{ affiche: 'Afroboost', prononce: 'Afro-boust' }] })).status).toBe(200);
    expect(prefs()).toEqual({ voixPersonnelle: { userVoiceId: null, prononciations: [{ affiche: 'Afroboost', prononce: 'Afro-boust' }] } });
    // Modification + ajout.
    expect((await put(PRONONCIATIONS, { prononciations: [{ affiche: 'Afroboost', prononce: 'A-fro-boust' }, { affiche: 'Neuchâtel', prononce: 'Neu-cha-tel' }] })).status).toBe(200);
    expect((await profil()).prononciations).toEqual([{ affiche: 'Afroboost', prononce: 'A-fro-boust' }, { affiche: 'Neuchâtel', prononce: 'Neu-cha-tel' }]);
    // Suppression.
    expect((await put(PRONONCIATIONS, { prononciations: [{ affiche: 'Neuchâtel', prononce: 'Neu-cha-tel' }] })).status).toBe(200);
    expect((await profil()).prononciations).toEqual([{ affiche: 'Neuchâtel', prononce: 'Neu-cha-tel' }]);
    expect(base.settings.every((l) => l.user_id === U)).toBe(true);
  });

  it('⚠️ vide, doublon, identique, trop long, corps sans liste → 400, rien écrit', async () => {
    for (const [liste, code] of [
      [[{ affiche: '', prononce: 'x' }], 'vide'],
      [[{ affiche: 'A', prononce: 'B' }, { affiche: 'a', prononce: 'C' }], 'doublon'],
      [[{ affiche: 'A', prononce: 'a' }], 'identique'],
      [[{ affiche: 'a'.repeat(81), prononce: 'x' }], 'trop_long'],
    ] as const) {
      const res = await put(PRONONCIATIONS, { prononciations: liste });
      expect(res.status, code).toBe(400);
      expect((await res.json() as { code: string }).code).toBe(code);
    }
    expect((await put(PRONONCIATIONS, { prononciations: 'x' })).status).toBe(400);
    expect(base.journal).toEqual([]);
  });

  it('⚠️ les prononciations d’un autre compte ne sont ni lues ni touchées', async () => {
    base.settings = [{ user_id: AUTRUI, creator_preferences: { voixPersonnelle: { userVoiceId: null, prononciations: [{ affiche: 'Secret', prononce: 'x' }] } } }];
    expect((await profil()).prononciations).toEqual([]);
    expect((await put(PRONONCIATIONS, { prononciations: [{ affiche: 'Moi', prononce: 'mwa' }] })).status).toBe(200);
    expect((base.settings.find((l) => l.user_id === AUTRUI)!.creator_preferences as Record<string, unknown>)).toEqual({ voixPersonnelle: { userVoiceId: null, prononciations: [{ affiche: 'Secret', prononce: 'x' }] } });
  });
});

describe('POST /api/voice/ecoute — un vrai audio, LA voix du compte, le texte DIT', () => {
  it('⚠️ envoie la voix résolue (provider_voice_id serveur) et le SPOKEN_SCRIPT ; rend l’audio et le texte dit', async () => {
    base.voices = [voix(V1)];
    base.settings = [{ user_id: U, creator_preferences: { voixPersonnelle: { userVoiceId: null, prononciations: [{ affiche: 'Afroboost', prononce: 'Afro-boust' }] } } }];
    const res = await post(ECOUTER, { texte: 'Bienvenue chez Afroboost.' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('AUDIO-MP3');
    expect(eleven.appels).toHaveLength(1);
    expect(eleven.appels[0].url).toContain('/v1/text-to-speech/pvid_0001_abcd?');
    expect(eleven.appels[0].body).toEqual({ text: 'Bienvenue chez Afro-boust.', model_id: 'eleven_multilingual_v2' });
    expect(decodeURIComponent(res.headers.get('X-Studiio-Spoken')!)).toBe('Bienvenue chez Afro-boust.');
    expect(res.headers.get('X-Studiio-Voice')).toBe(V1);
  });

  it('⚠️ le navigateur ne peut pas désigner une voix : un voiceId dans le corps est ignoré', async () => {
    base.voices = [voix(V1)];
    await post(ECOUTER, { texte: 'Bonjour', voice: 'elevenlabs-AUTRE_VOIX_1234', voiceId: 'AUTRE_VOIX_1234', providerVoiceId: 'AUTRE_VOIX_1234' });
    expect(eleven.appels[0].url).toContain('/pvid_0001_abcd?');
  });

  it('⚠️ sans voix personnelle → 409, AUCUN appel fournisseur (jamais une voix générique) ; choix requis → 409', async () => {
    expect((await post(ECOUTER, { texte: 'Bonjour' })).status).toBe(409);
    base.voices = [voix(V1), voix(V2)];
    expect((await (await post(ECOUTER, { texte: 'Bonjour' })).json() as { code: string }).code).toBe('choix_requis');
    expect(eleven.appels).toEqual([]);
  });

  it('⚠️ sans clé fournisseur → 503 « pas encore disponible », aucun appel, aucun audio', async () => {
    base.voices = [voix(V1)];
    delete process.env.ELEVENLABS_API_KEY;
    const res = await post(ECOUTER, { texte: 'Bonjour' });
    expect(res.status).toBe(503);
    expect((await res.json() as { code: string }).code).toBe('ecoute_indisponible');
    expect(eleven.appels).toEqual([]);
  });

  it('⚠️ erreur fournisseur → 502, aucun faux succès, aucun audio', async () => {
    base.voices = [voix(V1)]; eleven.statut = 429;
    const res = await post(ECOUTER, { texte: 'Bonjour' });
    expect(res.status).toBe(502);
    expect(res.headers.get('content-type')).toMatch(/json/);
  });

  it('texte vide ou trop long → 400 ; sans session → 401 ; aucun appel', async () => {
    base.voices = [voix(V1)];
    expect((await post(ECOUTER, { texte: '' })).status).toBe(400);
    expect((await post(ECOUTER, { texte: 'a'.repeat(601) })).status).toBe(400);
    session.courante = null;
    expect((await post(ECOUTER, { texte: 'Bonjour' })).status).toBe(401);
    expect(eleven.appels).toEqual([]);
  });
});
