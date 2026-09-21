// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * LE MOTEUR DU JUMEAU SUR UN AVATAR D-ID — la chaîne de l'aperçu, intention
 * `normale`, avec la politique de crédits du jumeau.
 *
 * Fournisseurs doublés au niveau du `fetch` : le VRAI client ElevenLabs
 * (synthetiserAvecVoix) et le VRAI client D-ID (creerSceneAudio) s'exécutent ;
 * seul le réseau est intercepté. Base, stockage et crédits en mémoire.
 *
 * Ce que ces tests prouvent :
 *  - un avatar D-ID validé + voix → le moteur est DISPONIBLE avec le gate de
 *    l'aperçu (DID_VIDEO_AVATAR_ACTIVE + DID_API_KEY + ELEVENLABS_API_KEY),
 *    sans JUMEAU_MOTEUR_ACTIVE ;
 *  - UN débit (AVATAR_VIDEO_COST, référence `jumeau:<generationId>`), les
 *    appels dans l'ordre ElevenLabs → D-ID /scenes, l'audio déposé en PRIVÉ
 *    et transmis par URL signée, `avatar_generations.provider = 'did'`,
 *    `intention = 'normale'`, `credits_charged = 40` ;
 *  - échec ElevenLabs ou D-ID → failed + REMBOURSÉ, audio retiré, jamais un
 *    succès simulé ;
 *  - HeyGen n'est JAMAIS appelé pour un avatar D-ID, même moteur HeyGen actif ;
 *  - D-ID non configuré → refus qui NOMME la dépendance, aucun débit, rien en
 *    base ;
 *  - idempotence : une génération D-ID en vol est rendue telle quelle.
 */

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const A = '11111111-1111-4111-8111-000000000001';
const V1 = '44444444-4444-4444-8444-000000000001';

type Ligne = Record<string, unknown>;
const base = vi.hoisted(() => ({ avatars: [] as Ligne[], voices: [] as Ligne[], settings: [] as Ligne[], generations: [] as Ligne[], compteur: 0 }));
const stockage = vi.hoisted(() => ({ objets: new Map<string, { type: string; taille: number }>(), journal: [] as string[] }));
const credits = vi.hoisted(() => ({ solde: 1000, journal: [] as string[] }));
const reseau = vi.hoisted(() => ({
  appels: [] as Array<{ url: string; method: string; body: unknown }>,
  eleven: 200 as number,
  scene: 201 as number,
}));

vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => {
    const source = table === 'user_avatars' ? base.avatars : table === 'user_voices' ? base.voices : table === 'user_settings' ? base.settings : table === 'avatar_generations' ? base.generations : null;
    if (!source) throw new Error(`table inattendue ${table}`);
    const filtres: Array<(l: Ligne) => boolean> = [];
    let colonnes: string[] | null = null; let tri = false; let limite: number | undefined;
    let insertion: Ligne | null = null; let patch: Ligne | null = null;
    const projeter = (l: Ligne) => (colonnes ? Object.fromEntries(colonnes.map((c) => [c, l[c]])) : { ...l });
    const exec = () => {
      if (insertion) {
        const i = insertion;
        const enVol = (l: Ligne) => l.intention === 'normale' && String(l.voice_id ?? '').startsWith('jumeau:') && ['pending', 'processing'].includes(String(l.status));
        if (source === base.generations && enVol(i) && source.some((l) => enVol(l) && ['user_id', 'user_avatar_id', 'avatar_version', 'voice_id', 'aspect_ratio', 'script'].every((k) => l[k] === i[k]))) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "avatar_generations_jumeau_en_vol_uidx"' } };
        }
        // La base : `provider` a un défaut ('heygen'), `credits_refunded` aussi.
        const l = { id: `55555555-5555-4555-8555-${String(++base.compteur).padStart(12, '0')}`, created_at: new Date(Date.now() + base.compteur).toISOString(), video_url: null, error_message: null, provider: 'heygen', credits_refunded: false, ...i }; source.push(l); return { data: [projeter(l)], error: null };
      }
      let rows = source.filter((l) => filtres.every((f) => f(l)));
      if (patch) { for (const l of rows) Object.assign(l, patch); return { data: rows.map(projeter), error: null }; }
      if (tri) rows = [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      if (limite !== undefined) rows = rows.slice(0, limite);
      return { data: rows.map(projeter), error: null };
    };
    const api = {
      select(c?: string) { if (c && c !== '*') colonnes = c.split(',').map((x) => x.trim()); return api; },
      insert(v: Ligne) { insertion = v; return api; },
      update(p: Ligne) { patch = p; return api; },
      eq(k: string, v: unknown) { filtres.push((l) => l[k] === v); return api; },
      is(k: string, v: unknown) { filtres.push((l) => l[k] === v); return api; },
      in(k: string, vs: unknown[]) { filtres.push((l) => vs.includes(l[k])); return api; },
      order() { tri = true; return api; },
      async limit(n: number) { limite = n; return exec(); },
      async single() { const r = exec(); if (r.error) return { data: null, error: r.error }; const rows = r.data as unknown[]; return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: 'no rows' } }; },
      then(resolve: (v: unknown) => void, reject: (e: unknown) => void) { return Promise.resolve().then(exec).then(resolve, reject); },
    };
    return api;
  };
  const storage = {
    from: (bucket: string) => ({
      async upload(cle: string, octets: Buffer | Uint8Array, opts?: { contentType?: string; upsert?: boolean }) {
        stockage.journal.push(`upload:${cle}`);
        if (bucket !== 'media') return { data: null, error: { message: `bucket ${bucket}` } };
        if (!opts?.upsert && stockage.objets.has(cle)) return { data: null, error: { message: 'existe déjà' } };
        stockage.objets.set(cle, { type: opts?.contentType ?? '', taille: octets.length });
        return { data: { path: cle }, error: null };
      },
      async remove(cles: string[]) { for (const c of cles) { stockage.journal.push(`remove:${c}`); stockage.objets.delete(c); } return { data: cles, error: null }; },
      getPublicUrl(cle: string) { return { data: { publicUrl: `https://studiio.pro/storage/v1/object/public/media/${cle}` } }; },
    }),
  };
  return { supabase: { from, storage }, supabaseAdmin: { from, storage } };
});
vi.mock('@/lib/credits/system', () => ({
  getUserCredits: async () => credits.solde,
  deductCredits: async (_u: string, n: number, _raison: string, reference?: string | null) => { credits.journal.push(`debit:${n}:${reference ?? 'sans-reference'}`); credits.solde -= n; },
  addCredits: async (_u: string, n: number) => { credits.journal.push(`refund:${n}`); credits.solde += n; },
}));
const session = vi.hoisted(() => ({ courante: { user: { id: 'aaaaaaaa-1111-4111-8111-111111111111' } } as unknown }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => session.courante }));

globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
  const u = String(url);
  let body: unknown = init?.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* brut */ } }
  reseau.appels.push({ url: u, method: init?.method ?? 'GET', body });
  const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { 'content-type': 'application/json' } });
  if (u.startsWith('https://api.elevenlabs.io/v1/text-to-speech/')) {
    if (reseau.eleven !== 200) return new Response('quota', { status: reseau.eleven });
    return new Response(Buffer.from('MP3-VOIX-PERSO'), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
  }
  if (u === 'https://api.d-id.com/scenes' && init?.method === 'POST') {
    if (reseau.scene !== 201) return json({ kind: 'BadRequestError', description: 'bad audio' }, reseau.scene);
    return json({ id: 'scn-jumeau-1', status: 'created', object: 'scene' }, 201);
  }
  throw new Error(`fetch inattendu ${init?.method ?? 'GET'} ${u}`);
}) as unknown as typeof fetch;

// Le gate de l'aperçu, tel qu'en prod. PAS de JUMEAU_MOTEUR_ACTIVE, PAS de HEYGEN_API_KEY.
process.env.DID_API_KEY = 'user:secretDID';
process.env.DID_VIDEO_AVATAR_ACTIVE = '1';
process.env.ELEVENLABS_API_KEY = 'cle-eleven-test';
process.env.AUTH_SECRET = 'secret-de-test-tres-long';
process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';
delete process.env.JUMEAU_MOTEUR_ACTIVE;
delete process.env.HEYGEN_API_KEY;

const { genererVideoJumeau, PREFIXE_VOIX_JUMEAU } = await import('@/lib/avatar/moteur-jumeau');
const { POST } = await import('@/app/api/creer/jumeau/generer/route');
const { AVATAR_VIDEO_COST } = await import('@/lib/stripe/constants');

const avatar = (over: Ligne = {}): Ligne => ({
  id: A, user_id: U, provider: 'did', status: 'completed', provider_avatar_id: 'avt-did-1', provider_asset_id: null, source_object_key: `${U}/avatar/source-1-${'a'.repeat(32)}.mp4`,
  source_url: null, subject_type: 'self', consent_version: 'x', consent_at: '2026-09-01T00:00:00Z', consent_text: 'x', validated_at: '2026-09-15T00:00:00Z',
  version: 2, deleted_at: null, created_at: '2026-09-01T00:00:00.000Z', avatar_type: 'video', name: 'Bassi', training_error: null, ...over,
});
const voix = (over: Ligne = {}): Ligne => ({ id: V1, user_id: U, provider: 'elevenlabs', provider_voice_id: 'pvid_perso_0001', name: 'Bassi', lang: 'fr', consent_at: '2026-08-01T00:00:00Z', consent_text: 'x', created_at: '2026-08-01T00:00:00Z', ...over });
const TEXTE = 'Bienvenue chez Afroboost.';
const PRONONCE = 'Bienvenue chez Afro-boust.';
const generer = (textes: string[] = [TEXTE], env?: NodeJS.ProcessEnv) => genererVideoJumeau({ userId: U, textes, aspectRatio: '9:16' }, env ? { env } : {});
const appelsVers = (motif: RegExp) => reseau.appels.filter((a) => motif.test(a.url));
const sansReference = () => credits.journal.map((j) => j.replace(/:jumeau:[0-9a-f-]+$/, ''));

beforeEach(() => {
  base.avatars = [avatar()]; base.voices = [voix()]; base.generations = []; base.compteur = 0;
  base.settings = [{ user_id: U, creator_preferences: { voixPersonnelle: { userVoiceId: null, prononciations: [{ affiche: 'Afroboost', prononce: 'Afro-boust' }] } } }];
  credits.solde = 1000; credits.journal.length = 0;
  stockage.objets.clear(); stockage.journal.length = 0;
  reseau.appels.length = 0; reseau.eleven = 200; reseau.scene = 201;
  session.courante = { user: { id: U } };
  process.env.DID_API_KEY = 'user:secretDID'; process.env.DID_VIDEO_AVATAR_ACTIVE = '1'; process.env.ELEVENLABS_API_KEY = 'cle-eleven-test';
  delete process.env.JUMEAU_MOTEUR_ACTIVE; delete process.env.HEYGEN_API_KEY;
});

describe('genererVideoJumeau sur un avatar D-ID — la chaîne de l’aperçu, intention normale, UN débit', () => {
  it('⚠️ nominal : ElevenLabs (MA voix, SPOKEN) → audio privé → D-ID /scenes sur URL signée ; provider=did, intention=normale, credits_charged=40 ; un seul débit lié à la génération', async () => {
    const r = await generer();
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ status: 'processing', avatarVersion: 2, dejaEnCours: false, display: TEXTE, spoken: PRONONCE });
    // 1. ElevenLabs : la voix personnelle du compte, sur le texte DIT.
    const eleven = appelsVers(/elevenlabs\.io\/v1\/text-to-speech\//);
    expect(eleven).toHaveLength(1);
    expect(eleven[0].url).toContain('/text-to-speech/pvid_perso_0001?');
    expect((eleven[0].body as { text: string }).text).toBe(PRONONCE);
    // 2. L'audio en PRIVÉ, sous la clé de la génération — jamais public.
    const cleAudio = `${U}/avatar/audio-${r.generationId}.mp3`;
    expect(stockage.objets.get(cleAudio)).toEqual({ type: 'audio/mpeg', taille: 'MP3-VOIX-PERSO'.length });
    // 3. D-ID /scenes : l'avatar D-ID, un script AUDIO sur URL signée, jamais un texte ni une voix fournisseur.
    const scenes = appelsVers(/api\.d-id\.com\/scenes$/);
    expect(scenes).toHaveLength(1);
    const scene = scenes[0].body as Record<string, unknown>;
    expect(scene.avatar_id).toBe('avt-did-1');
    expect(scene.script).toMatchObject({ type: 'audio' });
    expect(String((scene.script as { audio_url: string }).audio_url)).toMatch(new RegExp(`^https://studiio\\.pro/api/avatar/media/[^/]+/audio-${r.generationId}\\.mp3$`));
    expect(JSON.stringify(scene)).not.toMatch(/"type":"text"|voice_id|pvid_perso/);
    // Ordre : ElevenLabs → D-ID. Aucun HeyGen.
    expect(reseau.appels.map((a) => a.url.replace(/\?.*$/, ''))).toEqual(['https://api.elevenlabs.io/v1/text-to-speech/pvid_perso_0001', 'https://api.d-id.com/scenes']);
    expect(appelsVers(/heygen/)).toEqual([]);
    // 4. La génération : provider D-ID, intention normale (pas un aperçu), version épinglée, voix INTERNE, script = SPOKEN.
    expect(base.generations[0]).toMatchObject({ id: r.generationId, user_id: U, user_avatar_id: A, avatar_version: 2, intention: 'normale', provider: 'did', voice_id: `${PREFIXE_VOIX_JUMEAU}${V1}`, script: PRONONCE, provider_video_id: 'scn-jumeau-1', status: 'processing', credits_charged: AVATAR_VIDEO_COST });
    // 5. UN débit, lié à la génération gagnante.
    expect(credits.journal).toEqual([`debit:${AVATAR_VIDEO_COST}:jumeau:${r.generationId}`]);
    expect(credits.solde).toBe(1000 - AVATAR_VIDEO_COST);
  });

  it('⚠️ ElevenLabs échoue → failed, REMBOURSÉ, aucun appel D-ID, aucun audio déposé', async () => {
    reseau.eleven = 429;
    const r = await generer();
    expect(r).toMatchObject({ ok: false, motif: 'fournisseur_voix' });
    expect(base.generations[0].status).toBe('failed');
    expect(appelsVers(/d-id\.com/)).toEqual([]);
    expect(stockage.journal).toEqual([]);
    expect(sansReference()).toEqual([`debit:${AVATAR_VIDEO_COST}`, `refund:${AVATAR_VIDEO_COST}`]);
    expect(credits.solde).toBe(1000);
  });

  it('⚠️ D-ID refuse la scène → failed, REMBOURSÉ, audio privé retiré, jamais un succès', async () => {
    reseau.scene = 400;
    const r = await generer();
    expect(r).toMatchObject({ ok: false, motif: 'fournisseur_avatar', statut: 400 });
    expect(r.ok ? '' : r.message).toContain('bad audio');
    expect(base.generations[0].status).toBe('failed');
    expect([...stockage.objets.keys()].filter((k) => k.includes('/audio-'))).toEqual([]);
    expect(stockage.journal.some((j) => j.startsWith('remove:'))).toBe(true);
    expect(sansReference()).toEqual([`debit:${AVATAR_VIDEO_COST}`, `refund:${AVATAR_VIDEO_COST}`]);
  });

  it('⚠️ HeyGen n’est JAMAIS appelé pour un avatar D-ID — même moteur HeyGen actif (JUMEAU_MOTEUR_ACTIVE=1 + HEYGEN_API_KEY)', async () => {
    const env = { ...process.env, JUMEAU_MOTEUR_ACTIVE: '1', HEYGEN_API_KEY: 'cle-heygen' } as NodeJS.ProcessEnv;
    const r = await generer([TEXTE], env);
    expect(r.ok).toBe(true);
    expect(appelsVers(/heygen/)).toEqual([]);
    expect(appelsVers(/api\.d-id\.com\/scenes$/)).toHaveLength(1);
    expect(base.generations[0].provider).toBe('did');
  });

  it('⚠️ D-ID non configuré → moteur_indisponible qui NOMME la dépendance ; aucun appel, aucun débit, rien en base — le drapeau HeyGen n’y change rien', async () => {
    for (const env of [
      { ...process.env, DID_VIDEO_AVATAR_ACTIVE: undefined } as unknown as NodeJS.ProcessEnv,
      { ...process.env, DID_API_KEY: undefined, JUMEAU_MOTEUR_ACTIVE: '1', HEYGEN_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv,
    ]) {
      const r = await generer([TEXTE], env);
      expect(r).toMatchObject({ ok: false, motif: 'moteur_indisponible' });
      expect(r.ok ? '' : r.message).toContain('DID_VIDEO_AVATAR_ACTIVE / DID_API_KEY');
      expect(r.ok ? '' : r.message).toContain('Aucun crédit n’est débité');
    }
    // ElevenLabs absente : c'est elle qui est nommée.
    const r = await generer([TEXTE], { ...process.env, ELEVENLABS_API_KEY: undefined } as unknown as NodeJS.ProcessEnv);
    expect(r).toMatchObject({ ok: false, motif: 'moteur_indisponible' });
    expect(r.ok ? '' : r.message).toContain('ELEVENLABS_API_KEY');
    expect(reseau.appels).toEqual([]); expect(credits.journal).toEqual([]); expect(base.generations).toEqual([]);
  });

  it('⚠️ jumeau non prêt (non validé / voix absente) → refus AVANT tout fournisseur et tout débit', async () => {
    base.avatars = [avatar({ validated_at: null })];
    expect(await generer()).toMatchObject({ ok: false, motif: 'avatar_non_valide' });
    base.avatars = [avatar()]; base.voices = [];
    expect(await generer()).toMatchObject({ ok: false, motif: 'voix_absente' });
    expect(reseau.appels).toEqual([]); expect(credits.journal).toEqual([]); expect(base.generations).toEqual([]);
  });

  it('⚠️ idempotence : une génération D-ID EN VOL pour le même script est rendue telle quelle — une synthèse, une scène, un débit', async () => {
    const r1 = await generer();
    const r2 = await generer();
    expect(r1.ok && r2.ok && r2.generationId).toBe(r1.ok && r1.generationId);
    expect(r2.ok && r2.dejaEnCours).toBe(true);
    expect(appelsVers(/elevenlabs/)).toHaveLength(1);
    expect(appelsVers(/api\.d-id\.com\/scenes$/)).toHaveLength(1);
    expect(credits.journal).toHaveLength(1);
    const [a, b] = await Promise.all([generer(['Autre texte.']), generer(['Autre texte.'])]);
    expect(a.ok && b.ok && a.generationId).toBe(b.ok && b.generationId);
    expect(appelsVers(/api\.d-id\.com\/scenes$/)).toHaveLength(2);
    expect(credits.journal).toHaveLength(2);
  });

  it('crédits insuffisants → refus, aucun fournisseur, réservation libérée en failed', async () => {
    credits.solde = 10;
    expect(await generer()).toMatchObject({ ok: false, motif: 'credits_insuffisants' });
    expect(reseau.appels).toEqual([]);
    expect(base.generations[0].status).toBe('failed');
    expect(credits.journal).toEqual([]);
  });
});

describe('POST /api/creer/jumeau/generer avec un avatar D-ID', () => {
  const post = (body: unknown) => POST(new NextRequest('https://studiio.pro/api/creer/jumeau/generer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

  it('⚠️ succès 200 sans drapeau HeyGen ; D-ID non configuré → 503 dont le message nomme la dépendance ; scène refusée → 502', async () => {
    const res = await post({ textes: [TEXTE], aspectRatio: '9:16' });
    expect(res.status).toBe(200);
    const corps = await res.json() as { data: { generationId: string; avatarVersion: number; spoken: string; status: string } };
    expect(corps.data).toMatchObject({ avatarVersion: 2, spoken: PRONONCE, status: 'processing' });
    expect(base.generations[0]).toMatchObject({ id: corps.data.generationId, provider: 'did' });

    delete process.env.DID_VIDEO_AVATAR_ACTIVE;
    const refus = await post({ textes: ['Encore un texte'] });
    expect(refus.status).toBe(503);
    const j = await refus.json() as { error: string; code: string };
    expect(j.code).toBe('moteur_indisponible');
    expect(j.error).toContain('DID_VIDEO_AVATAR_ACTIVE / DID_API_KEY');
    process.env.DID_VIDEO_AVATAR_ACTIVE = '1';

    reseau.scene = 400;
    expect((await post({ textes: ['Troisième texte'] })).status).toBe(502);
  });
});
