// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * L'AVATAR VIDÉO D-ID, de bout en bout — domaine réel, routes réelles, client
 * D-ID réel jusqu'au `fetch` (intercepté) ; base et stockage en mémoire ;
 * HeyGen doublé au module (il n'intervient pas dans ce flux, et le flux
 * photo doit rester INCHANGÉ).
 *
 * Aucun appel réel D-ID, ElevenLabs ou HeyGen.
 */

type Ligne = Record<string, unknown>;
const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRUI = 'bbbbbbbb-2222-4222-8222-222222222222';
const V1 = '44444444-4444-4444-8444-000000000001';

const base = vi.hoisted(() => ({ avatars: [] as Ligne[], generations: [] as Ligne[], voices: [] as Ligne[], settings: [] as Ligne[], compteur: 0 }));
const stockage = vi.hoisted(() => ({ objets: new Map<string, { type: string; taille: number }>(), journal: [] as string[] }));
const session = vi.hoisted(() => ({ courante: { user: { id: 'aaaaaaaa-1111-4111-8111-111111111111' } } as unknown }));
const reseau = vi.hoisted(() => ({
  appels: [] as Array<{ url: string; method: string; body: unknown }>,
  consentement: { id: 'cst-1', text: 'Je soussigné(e), [user name], confirme détenir tous les droits pour créer un avatar. pomme vélo nuage' },
  statutConsentement: 'validating' as string,
  avatar: { id: 'avt-1', status: 'created' },
  statutAvatar: 'training-started' as string,
  scene: { id: 'scn-1', status: 'created' },
  statutScene: { status: 'started' } as Record<string, unknown>,
  erreur: null as null | { chemin: RegExp; statut: number; corps: unknown },
  eleven: 200,
}));

vi.mock('@/lib/auth/config', () => ({ auth: async () => session.courante }));
vi.mock('@/lib/credits/system', () => ({ addCredits: async () => true, getUserCredits: async () => 1000, deductCredits: async () => true }));
vi.mock('@/lib/avatar/heygen', () => {
  class HeyGenError extends Error { constructor(m: string, public httpStatus = 502, public code = 'x') { super(m); } }
  return {
    HeyGenError, HEYGEN_ASSET_MAX_BYTES: 32 * 1024 * 1024,
    uploadAsset: async () => { reseau.appels.push({ url: 'heygen:assets', method: 'POST', body: null }); return { assetId: 'as-1' }; },
    createAvatarFromAsset: async () => { reseau.appels.push({ url: 'heygen:avatars', method: 'POST', body: null }); return { avatarId: 'hg-1', status: 'processing' }; },
    getAvatarTrainingStatus: async () => ({ status: 'completed' }),
    listVoices: async () => [{ voiceId: 'v-fr', name: 'Voix', language: 'French' }],
    pickDefaultVoice: (v: Array<{ voiceId: string }>) => v[0] ?? null,
    getVideoStatus: async () => ({ status: 'processing' }),
    downloadVideo: async () => Buffer.from('HEYGEN'),
  };
});

vi.mock('@/lib/db/supabase', () => {
  const uuid = () => `55555555-5555-4555-8555-${String(++base.compteur).padStart(12, '0')}`;
  const from = (table: string) => {
    const source = table === 'user_avatars' ? base.avatars : table === 'avatar_generations' ? base.generations : table === 'user_voices' ? base.voices : table === 'user_settings' ? base.settings : null;
    if (!source) throw new Error(`table inattendue ${table}`);
    const filtres: Array<(l: Ligne) => boolean> = [];
    let colonnes: string[] | null = null; let tri = false; let limite: number | undefined;
    let insertion: Ligne | null = null; let patch: Ligne | null = null;
    const projeter = (l: Ligne) => (colonnes ? Object.fromEntries(colonnes.map((c) => [c, l[c]])) : { ...l });
    const exec = (): { data: unknown; error: { code?: string; message: string } | null } => {
      if (insertion) {
        const i = insertion;
        if (table === 'user_avatars' && i.deleted_at === null && source.some((a) => a.user_id === i.user_id && a.deleted_at === null)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "user_avatars_one_active_per_user_uidx"' } };
        }
        if (table === 'avatar_generations' && i.intention === 'apercu' && source.some((g) => g.intention === 'apercu' && g.status !== 'failed' && g.user_avatar_id === i.user_avatar_id && g.avatar_version === i.avatar_version)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "avatar_generations_apercu_unique"' } };
        }
        // Les défauts de la base : les colonnes absentes d'un insert sont NULL (ou leur défaut).
        const defauts = table === 'user_avatars'
          ? { provider: 'heygen', provider_consent_id: null, provider_consent_text: null, provider_consent_status: null, consent_object_key: null, consent_name: null, provider_consent_created_at: null, provider_consent_version: null, validated_at: null, deleted_at: null, training_error: null }
          : { video_url: null, error_message: null, credits_refunded: false, provider: 'heygen' };
        const l = { id: uuid(), created_at: new Date(Date.now() + base.compteur).toISOString(), ...defauts, ...i };
        source.push(l);
        return { data: [projeter(l)], error: null };
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
      not(k: string, op: string, v: unknown) { if (op !== 'is') throw new Error(`not(${op}) non doublé`); filtres.push((l) => l[k] !== v); return api; },
      in(k: string, vs: unknown[]) { filtres.push((l) => vs.includes(l[k])); return api; },
      order() { tri = true; return api; },
      async limit(n: number) { limite = n; await Promise.resolve(); return exec(); },
      async single() { await Promise.resolve(); const r = exec(); if (r.error) return r; const rows = r.data as unknown[]; return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } }; },
      async maybeSingle() { await Promise.resolve(); const r = exec(); if (r.error) return r; const rows = r.data as unknown[]; return { data: rows[0] ?? null, error: null }; },
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

globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
  const u = String(url);
  let body: unknown = init?.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* brut */ } }
  reseau.appels.push({ url: u, method: init?.method ?? 'GET', body });
  const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { 'content-type': 'application/json' } });
  if (reseau.erreur && reseau.erreur.chemin.test(u)) return json(reseau.erreur.corps, reseau.erreur.statut);
  if (u === 'https://api.d-id.com/consents' && init?.method === 'POST') return json({ id: reseau.consentement.id, text: reseau.consentement.text, created_at: 'x', created_by: 'y' }, 201);
  if (/^https:\/\/api\.d-id\.com\/consents\/[^/]+$/.test(u) && init?.method === 'POST') return json({ id: u.split('/').pop() });
  if (/^https:\/\/api\.d-id\.com\/consents\/[^/]+$/.test(u)) return json({ id: u.split('/').pop(), status: reseau.statutConsentement, ...(reseau.statutConsentement === 'error' ? { error: { description: 'audio-text mismatch' } } : {}) });
  if (u === 'https://api.d-id.com/scenes/avatars' && init?.method === 'POST') return json({ ...reseau.avatar, object: 'scene_avatar' }, 201);
  if (/^https:\/\/api\.d-id\.com\/scenes\/avatars\/[^/]+$/.test(u) && init?.method === 'DELETE') return new Response(null, { status: 204 });
  if (/^https:\/\/api\.d-id\.com\/scenes\/avatars\/[^/]+$/.test(u)) return json({ id: u.split('/').pop(), status: reseau.statutAvatar, ...(reseau.statutAvatar === 'error' ? { error: { description: 'face not found' } } : {}) });
  if (u === 'https://api.d-id.com/scenes' && init?.method === 'POST') return json({ ...reseau.scene, object: 'scene' }, 201);
  if (/^https:\/\/api\.d-id\.com\/scenes\/[^/]+$/.test(u)) return json({ id: u.split('/').pop(), ...reseau.statutScene });
  if (u === 'https://d-id-results.example/scn-1.mp4') return new Response(Buffer.from('VIDEO-DID'), { status: 200, headers: { 'content-type': 'video/mp4' } });
  if (u.startsWith('https://api.elevenlabs.io/v1/text-to-speech/')) {
    if (reseau.eleven !== 200) return new Response('quota', { status: reseau.eleven });
    return new Response(Buffer.from('MP3-VOIX-PERSO'), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
  }
  throw new Error(`fetch inattendu ${init?.method ?? 'GET'} ${u}`);
}) as unknown as typeof fetch;

process.env.DID_API_KEY = 'user:secretDID';
process.env.DID_VIDEO_AVATAR_ACTIVE = '1';
process.env.ELEVENLABS_API_KEY = 'cle-eleven';
process.env.HEYGEN_API_KEY = 'cle-heygen';
process.env.AUTH_SECRET = 'secret-de-test-tres-long';
process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';

const create = await import('@/app/api/avatar/create/route');
const consentement = await import('@/app/api/avatar/did/consentement/route');
const consentementVideo = await import('@/app/api/avatar/did/consentement/video/route');
const reutiliser = await import('@/app/api/avatar/did/consentement/reutiliser/route');
const creer = await import('@/app/api/avatar/did/creer/route');
const apercuDid = await import('@/app/api/avatar/did/apercu/route');
const statut = await import('@/app/api/avatar/status/route');
const generate = await import('@/app/api/avatar/generate/route');
const suppression = await import('@/app/api/avatar/route');
const { apercuDuClone } = await import('@/lib/avatar/apercu');
const { resoudreJumeauDuCompte } = await import('@/lib/avatar/jumeau');
const { SCRIPT_APERCU, CONSENTEMENT_ENROLEMENT_DID, CONSENTEMENT_ENROLEMENT } = await import('@/lib/avatar/contrat');
const { supprimerAvatarActif } = await import('@/lib/avatar/suppression');
const { consentementReutilisableDuCompte } = await import('@/lib/avatar/did');

const fichier = (nom: string, type: string, taille = 1024) => new File([new Uint8Array(taille)], nom, { type });
const formulaire = (champs: Record<string, string | File>) => { const fd = new FormData(); for (const [k, v] of Object.entries(champs)) fd.append(k, v); return fd; };
const postCreate = (fd: FormData) => create.POST(new NextRequest('https://studiio.pro/api/avatar/create', { method: 'POST', body: fd }));
const NOM = 'Henri Bassi';
const PHRASE_TEMPLATE = 'Je soussigné(e), [user name], confirme détenir tous les droits pour créer un avatar. pomme vélo nuage';
const PHRASE = PHRASE_TEMPLATE.replace('[user name]', NOM);
const postConsentement = (corps: unknown = { nom: NOM }) => consentement.POST(new NextRequest('https://studiio.pro/api/avatar/did/consentement', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps) }));
const getConsentement = (nom?: string) => consentement.GET(new NextRequest(`https://studiio.pro/api/avatar/did/consentement${nom ? `?nom=${encodeURIComponent(nom)}` : ''}`));
const postReutiliser = (corps: unknown = { nom: NOM }) => reutiliser.POST(new NextRequest('https://studiio.pro/api/avatar/did/consentement/reutiliser', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps) }));
const postVideoConsentement = (f: File) => consentementVideo.POST(new NextRequest('https://studiio.pro/api/avatar/did/consentement/video', { method: 'POST', body: formulaire({ file: f }) }));
const getStatut = (g: string) => statut.GET(new NextRequest(`https://studiio.pro/api/avatar/status?generationId=${g}`));
const appelsVers = (motif: RegExp | string, methode?: string) => reseau.appels.filter((a) => (typeof motif === 'string' ? a.url === motif : motif.test(a.url)) && (!methode || a.method === methode));
const vivant = () => base.avatars.find((a) => a.user_id === U && a.deleted_at === null)!;

/** Une source D-ID déposée par la vraie route `POST /api/avatar/create` (provider=did). */
async function deposerSourceDid(): Promise<Ligne> {
  const res = await postCreate(formulaire({ file: fichier('moi.mp4', 'video/mp4', 4096), consent: 'true', name: 'Mon avatar vidéo', provider: 'did' }));
  const json = await res.json();
  expect(json.success, JSON.stringify(json)).toBe(true);
  return json.data.avatar;
}
async function jusquAuConsentementAccepte(): Promise<Ligne> {
  await deposerSourceDid();
  expect((await (await postConsentement()).json()).success).toBe(true);
  expect((await postVideoConsentement(fichier('c.mp4', 'video/mp4', 2048))).status).toBe(200);
  reseau.statutConsentement = 'done';
  const etat = await (await getConsentement()).json();
  expect(etat.data.etape).toBe('consentement_accepte');
  return vivant();
}
async function jusquAPret(): Promise<Ligne> {
  await jusquAuConsentementAccepte();
  expect((await (await creer.POST()).json()).success).toBe(true);
  reseau.statutAvatar = 'done';
  const g = await (await create.GET()).json();
  expect(g.data.avatar.etat).toBe('entraine_non_valide');
  return vivant();
}

beforeEach(() => {
  base.avatars = []; base.generations = []; base.settings = []; base.compteur = 0;
  base.voices = [{ id: V1, user_id: U, provider: 'elevenlabs', provider_voice_id: 'pvid_perso_0001', name: 'Bassi', lang: 'fr', consent_at: '2026-08-01T00:00:00Z', consent_text: 'x', created_at: '2026-08-01T00:00:00Z' }];
  base.settings = [{ user_id: U, creator_preferences: { voixPersonnelle: { userVoiceId: null, prononciations: [{ affiche: 'avatar', prononce: 'a-va-tar' }] } } }];
  stockage.objets.clear(); stockage.journal.length = 0;
  reseau.appels.length = 0; reseau.erreur = null; reseau.eleven = 200;
  reseau.consentement = { id: 'cst-1', text: PHRASE_TEMPLATE }; reseau.statutConsentement = 'validating';
  reseau.avatar = { id: 'avt-1', status: 'created' }; reseau.statutAvatar = 'training-started';
  reseau.scene = { id: 'scn-1', status: 'created' }; reseau.statutScene = { status: 'started' };
  session.courante = { user: { id: U } };
  process.env.DID_API_KEY = 'user:secretDID'; process.env.DID_VIDEO_AVATAR_ACTIVE = '1';
});

describe('1. Garde-fous : drapeau, clé, session, propriété, formats', () => {
  it('⚠️ drapeau absent → « À partir d’une vidéo » fermé (didVideoActif=false), provider=did refusé 503 AVANT tout dépôt, aucun appel D-ID', async () => {
    delete process.env.DID_VIDEO_AVATAR_ACTIVE;
    expect((await (await create.GET()).json()).data.didVideoActif).toBe(false);
    const res = await postCreate(formulaire({ file: fichier('moi.mp4', 'video/mp4'), consent: 'true', provider: 'did' }));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('did_unavailable');
    expect(stockage.journal).toEqual([]);
    expect((await postConsentement()).status).toBe(503);
    expect(appelsVers(/d-id\.com/)).toEqual([]);
  });

  it('⚠️ DID_API_KEY absente (drapeau levé) → indisponible, pas de 500, aucun appel réseau, clé jamais dans la réponse', async () => {
    delete process.env.DID_API_KEY;
    expect((await (await create.GET()).json()).data.didVideoActif).toBe(false);
    const res = await postConsentement();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('Avatar vidéo temporairement indisponible.');
    expect(appelsVers(/d-id\.com/)).toEqual([]);
  });

  it('⚠️ sans session → 401 partout ; l’avatar d’autrui est invisible (404)', async () => {
    session.courante = null;
    expect((await postConsentement()).status).toBe(401);
    expect((await getConsentement()).status).toBe(401);
    expect((await postVideoConsentement(fichier('c.mp4', 'video/mp4'))).status).toBe(401);
    expect((await creer.POST()).status).toBe(401);
    expect((await apercuDid.POST()).status).toBe(401);
    session.courante = { user: { id: U } };
    await deposerSourceDid();
    session.courante = { user: { id: AUTRUI } };
    expect((await postConsentement()).status).toBe(404);
    expect((await creer.POST()).status).toBe(404);
    expect(appelsVers(/d-id\.com/)).toEqual([]);
  });

  it('⚠️ formats : WebM refusé pour D-ID (400), photo refusée (400), > 50 Mo refusé (413), fournisseur inconnu (400) — rien n’est déposé', async () => {
    expect((await postCreate(formulaire({ file: fichier('x.webm', 'video/webm'), consent: 'true', provider: 'did' }))).status).toBe(400);
    expect((await postCreate(formulaire({ file: fichier('x.jpg', 'image/jpeg'), consent: 'true', provider: 'did' }))).status).toBe(400);
    expect((await postCreate(formulaire({ file: fichier('x.mp4', 'video/mp4', 50 * 1024 * 1024 + 1), consent: 'true', provider: 'did' }))).status).toBe(413);
    expect((await postCreate(formulaire({ file: fichier('x.mp4', 'video/mp4'), consent: 'true', provider: 'synthesia' }))).status).toBe(400);
    expect(stockage.journal).toEqual([]);
    expect(base.avatars).toEqual([]);
  });
});

describe('2. La source D-ID par la route de création existante', () => {
  it('⚠️ provider=did : source privée, ligne provider=did / source_ready / fournisseur NULL / consentement fournisseur NULL, texte certifié D-ID ; aucun HeyGen ; identifiants absents de la réponse', async () => {
    const rendu = await deposerSourceDid();
    const a = vivant();
    expect(a).toMatchObject({ provider: 'did', avatar_type: 'video', status: 'source_ready', provider_avatar_id: null, provider_consent_id: null, provider_consent_status: null, consent_object_key: null, version: 1, validated_at: null });
    expect(a.consent_text).toBe(CONSENTEMENT_ENROLEMENT_DID.texte);
    expect(a.consent_version).toBe(CONSENTEMENT_ENROLEMENT_DID.version);
    expect(String(a.source_object_key)).toMatch(new RegExp(`^${U}/avatar/source-\\d+-[0-9a-f]{32}\\.mp4$`));
    expect(stockage.objets.has(String(a.source_object_key))).toBe(true);
    expect(rendu).toMatchObject({ provider: 'did', etape_did: 'consentement_a_demander' });
    expect(rendu).not.toHaveProperty('source_url');
    expect(rendu).not.toHaveProperty('provider_consent_id');
    expect(rendu).not.toHaveProperty('consent_object_key');
    expect(rendu).not.toHaveProperty('provider_avatar_id');
    expect(appelsVers(/heygen/)).toEqual([]);
    expect(appelsVers(/d-id\.com/)).toEqual([]);
  });

  it('⚠️ le flux PHOTO HeyGen est inchangé : sans `provider`, provider=heygen, HeyGen appelé, texte certifié HeyGen, aucun D-ID', async () => {
    const res = await postCreate(formulaire({ file: fichier('moi.jpg', 'image/jpeg'), consent: 'true', name: 'Mon avatar' }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(vivant()).toMatchObject({ provider: 'heygen', avatar_type: 'photo', provider_avatar_id: 'hg-1', consent_text: CONSENTEMENT_ENROLEMENT.textes.photo });
    expect(json.data.avatar.provider_avatar_id).toBe('hg-1');
    expect(json.data.avatar).not.toHaveProperty('etape_did');
    expect(appelsVers('heygen:assets')).toHaveLength(1);
    expect(appelsVers('heygen:avatars')).toHaveLength(1);
    expect(appelsVers(/d-id\.com/)).toEqual([]);
  });
});

describe('3. Le consentement fournisseur', () => {
  it('⚠️ POST → POST /consents {language: French}, phrase stockée et rendue ; un second POST rend LA MÊME phrase sans nouvel appel', async () => {
    await deposerSourceDid();
    const r1 = await (await postConsentement()).json();
    // `[user name]` est remplacé par le nom de la PERSONNE ; la phrase affichée est celle à prononcer.
    expect(r1).toMatchObject({ success: true, data: { texte: PHRASE, nom: NOM, etape: 'consentement_texte_pret', deja: false } });
    expect(r1.data.texte).not.toContain('[user name]');
    expect(typeof r1.data.expireLe).toBe('string');
    expect(appelsVers('https://api.d-id.com/consents', 'POST')[0].body).toEqual({ language: 'French' });
    expect(vivant()).toMatchObject({ provider_consent_id: 'cst-1', provider_consent_text: PHRASE, consent_name: NOM, provider_consent_status: null, name: 'Mon avatar vidéo' });
    expect(typeof vivant().provider_consent_created_at).toBe('string');
    const r2 = await (await postConsentement()).json();
    expect(r2.data).toMatchObject({ texte: PHRASE, nom: NOM, deja: true });
    expect(appelsVers('https://api.d-id.com/consents', 'POST')).toHaveLength(1);
    // La phrase, le nom et l'expiration sont dans la ligne rendue à la page, sans identifiant.
    const g = await (await create.GET()).json();
    expect(g.data.avatar).toMatchObject({ etape_did: 'consentement_texte_pret', provider_consent_text: PHRASE, consent_name: NOM });
    expect(typeof g.data.avatar.consent_expire_le).toBe('string');
    expect(g.data.avatar).not.toHaveProperty('provider_consent_id');
    expect(g.data.avatar).not.toHaveProperty('provider_consent_created_at');
  });

  it('⚠️ deux POST simultanés → un seul consentement RETENU, la même phrase pour les deux', async () => {
    await deposerSourceDid();
    const [a, b] = await Promise.all([postConsentement(), postConsentement()]);
    const ja = await a.json(); const jb = await b.json();
    expect(ja.success && jb.success).toBe(true);
    expect(ja.data.texte).toBe(jb.data.texte);
    expect(vivant().provider_consent_id).toBe('cst-1');
  });

  it('⚠️ avant la phrase, la vidéo de consentement est refusée (409) ; mauvais format → 400 ; rien n’est déposé', async () => {
    await deposerSourceDid();
    expect((await postVideoConsentement(fichier('c.mp4', 'video/mp4'))).status).toBe(409);
    await postConsentement();
    expect((await postVideoConsentement(fichier('c.webm', 'video/webm'))).status).toBe(400);
    expect((await postVideoConsentement(fichier('c.mp4', 'video/mp4', 0))).status).toBe(400);
    expect(stockage.journal.filter((j) => j.includes('consent-'))).toEqual([]);
  });

  it('⚠️ vidéo de consentement : dépôt PRIVÉ `consent-…`, POST /consents/{id} avec une URL SIGNÉE de notre média ; puis en vérification ; un second envoi → 409', async () => {
    await deposerSourceDid();
    await postConsentement();
    const res = await postVideoConsentement(fichier('c.mov', 'video/quicktime', 2048));
    expect((await res.json())).toMatchObject({ success: true, data: { etape: 'consentement_en_verification' } });
    const a = vivant();
    expect(String(a.consent_object_key)).toMatch(new RegExp(`^${U}/avatar/consent-\\d+-[0-9a-f]{32}\\.mov$`));
    expect(a.provider_consent_status).toBe('created');
    expect(stockage.objets.get(String(a.consent_object_key))).toEqual({ type: 'video/quicktime', taille: 2048 });
    const depot = appelsVers(/consents\/cst-1$/, 'POST')[0].body as { name: string; source_url: string };
    // ⚠️ Le nom envoyé à D-ID est celui de la PERSONNE — exactement celui de la phrase — jamais celui de l'avatar.
    expect(depot.name).toBe(NOM);
    expect(depot.name).not.toBe('Mon avatar vidéo');
    expect(String(vivant().provider_consent_text)).toContain(depot.name);
    expect(depot.source_url).toMatch(/^https:\/\/studiio\.pro\/api\/avatar\/media\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\/consent-\d+-[0-9a-f]{32}\.mov$/);
    expect(depot.source_url).not.toContain('storage/v1/object/public');
    expect((await postVideoConsentement(fichier('c2.mp4', 'video/mp4'))).status).toBe(409);
    expect(appelsVers(/consents\/cst-1$/, 'POST')).toHaveLength(1);
  });

  it('⚠️ suivi : validating → toujours en vérification ; done → accepté ; error → refusé, la vidéo se réimporte (ancienne retirée) ; jamais d’avatar créé sans `done`', async () => {
    await deposerSourceDid();
    await postConsentement();
    await postVideoConsentement(fichier('c.mp4', 'video/mp4'));
    expect((await (await getConsentement()).json()).data.etape).toBe('consentement_en_verification');
    expect((await creer.POST()).status).toBe(409);
    reseau.statutConsentement = 'error';
    const refus = await (await getConsentement()).json();
    expect(refus.data).toMatchObject({ etape: 'consentement_refuse', erreur: 'audio-text mismatch' });
    expect((await creer.POST()).status).toBe(409);
    const ancienne = String(vivant().consent_object_key);
    reseau.statutConsentement = 'validating';
    expect((await postVideoConsentement(fichier('c2.mp4', 'video/mp4'))).status).toBe(200);
    expect(vivant().consent_object_key).not.toBe(ancienne);
    expect(stockage.objets.has(ancienne)).toBe(false);
    reseau.statutConsentement = 'done';
    expect((await (await getConsentement()).json()).data.etape).toBe('consentement_accepte');
    expect(vivant().provider_consent_status).toBe('done');
  });

  it('D-ID injoignable pendant le suivi → l’état connu est rendu (pas de 500), prochain appel retentera', async () => {
    await deposerSourceDid();
    await postConsentement();
    await postVideoConsentement(fichier('c.mp4', 'video/mp4'));
    reseau.erreur = { chemin: /consents\/cst-1$/, statut: 503, corps: {} };
    const res = await getConsentement();
    expect(res.status).toBe(200);
    expect((await res.json()).data.etape).toBe('consentement_en_verification');
  });
});

describe('3 bis. Le NOM de consentement — la personne, jamais l’avatar', () => {
  it('⚠️ sans nom (ni corps, ni profil) → 400 nom_requis, AUCUN consentement D-ID créé ; « Mon avatar vidéo » n’est jamais un nom de personne', async () => {
    await deposerSourceDid();
    const res = await postConsentement({});
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('nom_requis');
    expect(appelsVers('https://api.d-id.com/consents', 'POST')).toEqual([]);
    expect(vivant().consent_name).toBeNull();
    // Un nom invalide non plus.
    for (const mauvais of ['H', 'x'.repeat(81), 'Henri <script>', '  ', 42, null]) {
      expect((await postConsentement({ nom: mauvais })).status, String(mauvais)).toBe(400);
    }
    expect(appelsVers('https://api.d-id.com/consents', 'POST')).toEqual([]);
  });

  it('⚠️ le nom du PROFIL pré-remplit à défaut ; espaces normalisés ; accents, apostrophes et traits d’union passent tels quels dans la phrase ET dans `name`', async () => {
    session.courante = { user: { id: U, name: '  Jean-Éric   d\u2019Aubigné ' } };
    await deposerSourceDid();
    const r = await (await postConsentement({})).json();
    expect(r, JSON.stringify(r)).toMatchObject({ success: true });
    expect(r.data.nom).toBe('Jean-Éric d\u2019Aubigné');
    expect(r.data.texte).toBe(PHRASE_TEMPLATE.replace('[user name]', 'Jean-Éric d\u2019Aubigné'));
    await postVideoConsentement(fichier('c.mp4', 'video/mp4'));
    expect((appelsVers(/consents\/cst-1$/, 'POST')[0].body as { name: string }).name).toBe('Jean-Éric d\u2019Aubigné');
  });

  it('⚠️ un autre nom → une NOUVELLE phrase (le nom change ce qu’il faut prononcer) ; le même nom → la même phrase', async () => {
    await deposerSourceDid();
    const r1 = await (await postConsentement({ nom: NOM })).json();
    reseau.consentement = { id: 'cst-2', text: PHRASE_TEMPLATE.replace('pomme vélo nuage', 'lac herbe salade') };
    const r2 = await (await postConsentement({ nom: 'Henri B.' })).json();
    expect(r2.data.deja).toBe(false);
    expect(r2.data.texte).toBe(PHRASE_TEMPLATE.replace('pomme vélo nuage', 'lac herbe salade').replace('[user name]', 'Henri B.'));
    expect(vivant()).toMatchObject({ provider_consent_id: 'cst-2', consent_name: 'Henri B.' });
    const r3 = await (await postConsentement({ nom: 'Henri B.' })).json();
    expect(r3.data.deja).toBe(true);
    expect(r3.data.texte).toBe(r2.data.texte);
    expect(r1.data.texte).not.toBe(r2.data.texte);
    expect(appelsVers('https://api.d-id.com/consents', 'POST')).toHaveLength(2);
  });

  it('⚠️ phrase expirée (30 min D-ID) : la vidéo est refusée AVANT tout envoi au fournisseur ; « renouveler » donne une nouvelle phrase ; puis la vidéo passe', async () => {
    await deposerSourceDid();
    await postConsentement();
    vivant().provider_consent_created_at = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    const res = await postVideoConsentement(fichier('c.mp4', 'video/mp4'));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('consentement_expire');
    expect(appelsVers(/consents\/cst-1$/, 'POST')).toEqual([]);
    expect(stockage.journal.filter((j) => j.startsWith('upload:') && j.includes('consent-'))).toEqual([]);
    // Une demande SANS renouveler sur une phrase expirée en donne aussi une nouvelle.
    reseau.consentement = { id: 'cst-2', text: PHRASE_TEMPLATE };
    const r = await (await postConsentement({ nom: NOM })).json();
    expect(r.data.deja).toBe(false);
    expect(vivant().provider_consent_id).toBe('cst-2');
    expect((await postVideoConsentement(fichier('c.mp4', 'video/mp4'))).status).toBe(200);
    expect((appelsVers(/consents\/cst-2$/, 'POST')[0].body as { name: string }).name).toBe(NOM);
  });

  it('⚠️ consentement REFUSÉ : nouvelle phrase possible (renouveler), l’ancienne vidéo retirée ; en vérification ou accepté : jamais remplacé', async () => {
    await deposerSourceDid();
    await postConsentement();
    await postVideoConsentement(fichier('c.mp4', 'video/mp4'));
    expect((await postConsentement({ nom: NOM, renouveler: true })).status).toBe(409);
    reseau.statutConsentement = 'error';
    await getConsentement();
    const ancienne = String(vivant().consent_object_key);
    reseau.consentement = { id: 'cst-2', text: PHRASE_TEMPLATE };
    const r = await (await postConsentement({ nom: NOM, renouveler: true })).json();
    expect(r.data).toMatchObject({ deja: false, texte: PHRASE });
    expect(vivant()).toMatchObject({ provider_consent_id: 'cst-2', provider_consent_status: null, consent_object_key: null });
    expect(stockage.objets.has(ancienne)).toBe(false);
    reseau.statutConsentement = 'validating';
    await postVideoConsentement(fichier('c2.mp4', 'video/mp4'));
    reseau.statutConsentement = 'done';
    await getConsentement();
    expect((await postConsentement({ nom: NOM, renouveler: true })).status).toBe(409);
  });

  it('⚠️ refus fournisseur (400) à l’envoi de la vidéo : la description D-ID est rendue et journalisée — jamais la clé', async () => {
    await deposerSourceDid();
    await postConsentement();
    const avert = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reseau.erreur = { chemin: /consents\/cst-1$/, statut: 400, corps: { kind: 'ValidationError', description: 'audio-text mismatch' } };
    const res = await postVideoConsentement(fichier('c.mp4', 'video/mp4'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('audio-text mismatch');
    expect(JSON.stringify(json)).not.toContain('secretDID');
    const journal = avert.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(journal).toContain('audio-text mismatch');
    expect(journal).toContain('did_validationerror');
    expect(journal).not.toContain('secretDID');
    avert.mockRestore();
    expect(vivant().provider_consent_status).toBe('error');
    // Le suivi rend l'étape « refusé » : la personne peut renouveler.
    expect((await (await getConsentement()).json()).data.etape).toBe('consentement_refuse');
  });
});

describe('3 ter. RÉUTILISER un consentement VALIDÉ — la même personne, un nouvel avatar', () => {
  /** Un avatar D-ID validé jusqu'au consentement `done`, puis créé, puis prêt. */
  const avatarComplet = async () => { await jusquAPret(); expect(vivant()).toMatchObject({ provider_consent_status: 'done', provider_consent_version: 1, provider_avatar_id: 'avt-1' }); };

  it('⚠️ (1) premier avatar : aucun consentement existant → rien de réutilisable, flux normal phrase + vidéo + validation', async () => {
    await deposerSourceDid();
    expect(await consentementReutilisableDuCompte(U, NOM)).toBeNull();
    const etat = await (await getConsentement(NOM)).json();
    expect(etat.data).toMatchObject({ etape: 'consentement_a_demander', reutilisable: null });
    expect((await postReutiliser()).status).toBe(409);
    expect((await (await postReutiliser()).json()).code).toBe('consentement_non_reutilisable');
    expect(appelsVers(/d-id\.com/)).toEqual([]);
    await jusquAuConsentementAccepte();
    // Le consentement obtenu dans CETTE version lui est rattaché.
    expect(vivant()).toMatchObject({ provider_consent_status: 'done', provider_consent_version: vivant().version });
  });

  it('⚠️ (2)(3)(5) « Changer de source » : le consentement done SURVIT à la version 2 (hérité, à confirmer) ; « Réutiliser » = aucun POST /consents, aucune phrase, aucune vidéo, même consent_id rattaché à la v2 ; l’ancien provider_avatar_id jamais repris ; puis création directe', async () => {
    await avatarComplet();
    reseau.avatar = { id: 'avt-2', status: 'created' };
    const rendu = await deposerSourceDid();
    const a = vivant();
    expect(a).toMatchObject({ version: 2, provider: 'did', provider_avatar_id: null, provider_consent_id: 'cst-1', provider_consent_status: 'done', consent_name: NOM, provider_consent_version: 1, consent_object_key: null });
    expect(rendu).toMatchObject({ etape_did: 'consentement_reutilisable', consent_name: NOM, consent_expire_le: null });
    // L'ancien avatar D-ID est retiré chez le fournisseur ; le CONSENTEMENT, lui, n'est pas touché.
    expect(appelsVers(/scenes\/avatars\/avt-1$/, 'DELETE')).toHaveLength(1);
    expect(appelsVers(/consents\/cst-1$/, 'DELETE')).toEqual([]);
    // Sans confirmation, la création est fermée.
    expect((await creer.POST()).status).toBe(409);
    const etat = await (await getConsentement(NOM)).json();
    expect(etat.data).toMatchObject({ etape: 'consentement_reutilisable', reutilisable: { nom: NOM, origine: 'ligne_vivante' } });
    const avantD = appelsVers(/d-id\.com/).length;
    const r = await (await postReutiliser({ nom: NOM })).json();
    expect(r).toMatchObject({ success: true, data: { etape: 'consentement_accepte', nom: NOM, texte: PHRASE, origine: 'ligne_vivante' } });
    // Un seul appel fournisseur : la relecture GET /consents/cst-1 (done). Ni POST /consents, ni vidéo.
    const apres = appelsVers(/d-id\.com/).slice(avantD);
    expect(apres.map((x) => `${x.method} ${x.url}`)).toEqual(['GET https://api.d-id.com/consents/cst-1']);
    expect(appelsVers('https://api.d-id.com/consents', 'POST')).toHaveLength(1);
    expect(appelsVers(/consents\/cst-1$/, 'POST')).toHaveLength(1);
    expect(vivant()).toMatchObject({ version: 2, provider_consent_id: 'cst-1', provider_consent_status: 'done', provider_consent_version: 2, consent_object_key: null, provider_avatar_id: null });
    expect((await (await create.GET()).json()).data.avatar.etape_did).toBe('consentement_accepte');
    // Création directe : nouvel avatar D-ID, avec le consent_id réutilisé, jamais l'ancien avatar.
    expect((await creer.POST()).status).toBe(200);
    const corps = appelsVers('https://api.d-id.com/scenes/avatars', 'POST')[1].body as Record<string, string>;
    expect(corps.consent_id).toBe('cst-1');
    expect(vivant().provider_avatar_id).toBe('avt-2');
    expect(vivant().provider_avatar_id).not.toBe('avt-1');
  });

  it('⚠️ (4) ancien avatar soft-deleted : son consentement done est retrouvé pour le nouvel avatar (nouvelle ligne)', async () => {
    await avatarComplet();
    expect((await suppression.DELETE()).status).toBe(200);
    reseau.avatar = { id: 'avt-3', status: 'created' };
    await deposerSourceDid();
    expect(base.avatars).toHaveLength(2);
    expect(vivant()).toMatchObject({ version: 1, provider_consent_id: null });
    expect(await consentementReutilisableDuCompte(U, NOM)).toMatchObject({ providerConsentId: 'cst-1', nom: NOM, origine: 'ligne_supprimee' });
    const etat = await (await getConsentement(NOM)).json();
    expect(etat.data).toMatchObject({ etape: 'consentement_a_demander', reutilisable: { nom: NOM, origine: 'ligne_supprimee' } });
    const r = await (await postReutiliser()).json();
    expect(r.data).toMatchObject({ etape: 'consentement_accepte', origine: 'ligne_supprimee' });
    expect(vivant()).toMatchObject({ provider_consent_id: 'cst-1', provider_consent_status: 'done', provider_consent_version: 1, consent_name: NOM });
    expect(appelsVers('https://api.d-id.com/consents', 'POST')).toHaveLength(1);
    expect((await creer.POST()).status).toBe(200);
    expect(vivant().provider_avatar_id).toBe('avt-3');
  });

  it('⚠️ (6) un autre nom → PAS de réutilisation : « Bassi Henri » exige une nouvelle phrase ; la réutilisation au mauvais nom est refusée', async () => {
    await avatarComplet();
    await deposerSourceDid();
    expect(await consentementReutilisableDuCompte(U, 'Bassi Henri')).toBeNull();
    expect((await (await getConsentement('Bassi Henri')).json()).data.reutilisable).toBeNull();
    const avantGet = appelsVers(/consents\/cst-1$/, 'GET').length;
    const refus = await postReutiliser({ nom: 'Bassi Henri' });
    expect(refus.status).toBe(409);
    expect((await refus.json()).code).toBe('consentement_non_reutilisable');
    // Refusé AVANT tout appel fournisseur : le nom ne correspond pas, on ne relit rien.
    expect(appelsVers(/consents\/cst-1$/, 'GET')).toHaveLength(avantGet);
    // Nouvelle phrase pour la nouvelle personne : le consentement hérité quitte la ligne.
    reseau.consentement = { id: 'cst-2', text: PHRASE_TEMPLATE };
    const r = await (await postConsentement({ nom: 'Bassi Henri' })).json();
    expect(r.data).toMatchObject({ deja: false, nom: 'Bassi Henri', texte: PHRASE_TEMPLATE.replace('[user name]', 'Bassi Henri') });
    expect(vivant()).toMatchObject({ provider_consent_id: 'cst-2', provider_consent_status: null, consent_name: 'Bassi Henri', provider_consent_version: 2 });
  });

  it('⚠️ (7) un consentement created / validating / error n’est JAMAIS réutilisable', async () => {
    await deposerSourceDid();
    await postConsentement();
    for (const statut of [null, 'created', 'validating', 'error']) {
      vivant().provider_consent_status = statut;
      expect(await consentementReutilisableDuCompte(U, NOM), String(statut)).toBeNull();
    }
    // Et une version remplacée garde un consentement NON validé ? Non : il est remis à zéro.
    vivant().provider_consent_status = 'validating';
    await deposerSourceDid();
    expect(vivant()).toMatchObject({ version: 2, provider_consent_id: null, provider_consent_status: null, consent_name: null });
  });

  it('⚠️ (8) un consentement done vieux de plus de 30 minutes reste réutilisable ; l’expiration ne concerne que le défi', async () => {
    await avatarComplet();
    vivant().provider_consent_created_at = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    await deposerSourceDid();
    expect((await (await create.GET()).json()).data.avatar).toMatchObject({ etape_did: 'consentement_reutilisable', consent_expire_le: null });
    // Le suivi non plus n'annonce aucune expiration pour un consentement validé.
    expect((await (await getConsentement(NOM)).json()).data).toMatchObject({ etape: 'consentement_reutilisable', expireLe: null, nom: NOM });
    expect(await consentementReutilisableDuCompte(U, NOM)).toMatchObject({ providerConsentId: 'cst-1' });
    expect((await postReutiliser()).status).toBe(200);
    expect((await creer.POST()).status).toBe(200);
  });

  it('⚠️ (9) le fournisseur ne connaît plus le consentement (404) ou ne le tient plus pour done (error) → 409 propre, retour à « Obtenir ma phrase » ; rien n’est écrit', async () => {
    await avatarComplet();
    await deposerSourceDid();
    reseau.erreur = { chemin: /consents\/cst-1$/, statut: 404, corps: { kind: 'NotFoundError', description: 'not found' } };
    let res = await postReutiliser();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('consentement_non_reutilisable');
    expect(vivant().provider_consent_version).toBe(1);
    reseau.erreur = null; reseau.statutConsentement = 'error';
    res = await postReutiliser();
    expect(res.status).toBe(409);
    expect(vivant().provider_consent_version).toBe(1);
    // Retour propre : une nouvelle phrase au même nom est possible (le fournisseur a lâché l'ancienne).
    reseau.consentement = { id: 'cst-9', text: PHRASE_TEMPLATE };
    reseau.statutConsentement = 'validating';
    // Le serveur refuse d'abord (« réutilisez-le ») tant que l'historique dit done : la personne renouvelle explicitement.
    const r = await (await postConsentement({ nom: NOM, renouveler: true })).json();
    expect(r.success, JSON.stringify(r)).toBe(true);
    expect(vivant()).toMatchObject({ provider_consent_id: 'cst-9', provider_consent_status: null, provider_consent_version: 2 });
    // Fournisseur indisponible (5xx) : pas un « non réutilisable », une erreur transitoire.
    await deposerSourceDid();
  });

  it('(12) suppression et remplacement hors consentement inchangés : l’ancien avatar D-ID retiré, la nouvelle version jamais ; HeyGen intact', async () => {
    await avatarComplet();
    await postCreate(formulaire({ file: fichier('moi2.jpg', 'image/jpeg'), consent: 'true' }));
    expect(vivant()).toMatchObject({ version: 2, provider: 'heygen', provider_avatar_id: 'hg-1' });
    expect(appelsVers(/scenes\/avatars\/avt-1$/, 'DELETE')).toHaveLength(1);
    // Passé HeyGen, le consentement D-ID reste sur la ligne (historique de la personne) mais n'est pas une étape HeyGen.
    expect((await (await create.GET()).json()).data.avatar).not.toHaveProperty('etape_did');
  });
});

describe('4. La création et l’entraînement', () => {
  it('⚠️ après `done` : POST /scenes/avatars {source_url signé de NOTRE source, consent_id, name} → processing → suivi → prêt (entraine_non_valide) ; identifiant fournisseur jamais rendu', async () => {
    await jusquAuConsentementAccepte();
    const r = await (await creer.POST()).json();
    expect(r).toMatchObject({ success: true, data: { etape: 'creation_en_cours', version: 1 } });
    const corps = appelsVers('https://api.d-id.com/scenes/avatars', 'POST')[0].body as Record<string, string>;
    expect(corps.consent_id).toBe('cst-1');
    expect(corps.name).toBe('Mon avatar vidéo');
    expect(corps.source_url).toMatch(/^https:\/\/studiio\.pro\/api\/avatar\/media\/[^/]+\/source-\d+-[0-9a-f]{32}\.mp4$/);
    expect(vivant()).toMatchObject({ provider_avatar_id: 'avt-1', status: 'processing' });
    let g = await (await create.GET()).json();
    expect(g.data.avatar).toMatchObject({ etat: 'entrainement', etape_did: 'creation_en_cours' });
    expect(g.data.avatar).not.toHaveProperty('provider_avatar_id');
    reseau.statutAvatar = 'done';
    g = await (await create.GET()).json();
    expect(g.data.avatar).toMatchObject({ etat: 'entraine_non_valide', etape_did: 'pret', status: 'completed', validated_at: null });
    expect(appelsVers(/scenes\/avatars\/avt-1$/, 'GET')).toHaveLength(2);
  });

  it('⚠️ deux POST /creer simultanés → UN seul avatar D-ID créé, l’autre 409', async () => {
    await jusquAuConsentementAccepte();
    const [a, b] = await Promise.all([creer.POST(), creer.POST()]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(appelsVers('https://api.d-id.com/scenes/avatars', 'POST')).toHaveLength(1);
    expect(base.avatars.filter((x) => x.user_id === U && x.deleted_at === null)).toHaveLength(1);
  });

  it('⚠️ un second POST /creer après création → 409 avatar_deja_cree, aucun nouvel appel', async () => {
    await jusquAuConsentementAccepte();
    await creer.POST();
    const res = await creer.POST();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('avatar_deja_cree');
    expect(appelsVers('https://api.d-id.com/scenes/avatars', 'POST')).toHaveLength(1);
  });

  it('⚠️ fournisseur 402 / 401 / 400 / 5xx à la création → échec explicite, statut failed + message, puis nouvel essai possible', async () => {
    await jusquAuConsentementAccepte();
    const cas: Array<[number, number, string]> = [[402, 402, 'did_insufficient_credits'], [401, 502, 'did_unauthorized'], [400, 400, 'did_badrequesterror'], [500, 502, 'did_unavailable']];
    for (const [statutDid, http, _code] of cas) {
      reseau.erreur = { chemin: /\/scenes\/avatars$/, statut: statutDid, corps: { kind: 'BadRequestError', description: 'invalid source url' } };
      const res = await creer.POST();
      expect(res.status, `D-ID ${statutDid}`).toBe(http);
      expect(vivant()).toMatchObject({ status: 'failed', provider_avatar_id: null });
      expect(String(vivant().training_error).length).toBeGreaterThan(0);
      expect(JSON.stringify(await res.json())).not.toContain('secretDID');
      void _code;
    }
    reseau.erreur = null;
    expect((await creer.POST()).status).toBe(200);
    expect(vivant()).toMatchObject({ status: 'processing', provider_avatar_id: 'avt-1' });
  });

  it('entraînement en échec chez D-ID → failed + message, étape echec', async () => {
    await jusquAuConsentementAccepte();
    await creer.POST();
    reseau.statutAvatar = 'error';
    const g = await (await create.GET()).json();
    expect(g.data.avatar).toMatchObject({ status: 'failed', etat: 'echec', etape_did: 'echec', training_error: 'face not found' });
  });
});

describe('5. L’aperçu RÉEL : ma voix ElevenLabs → audio privé → scène D-ID → re-hébergement', () => {
  it('⚠️ sans voix personnelle → 409 voix_indisponible, AUCUN appel fournisseur, aucune génération', async () => {
    await jusquAPret();
    base.voices = [];
    const res = await apercuDid.POST();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('voix_indisponible');
    expect(appelsVers(/elevenlabs|scenes$/)).toEqual([]);
    expect(base.generations).toEqual([]);
  });

  it('⚠️ ElevenLabs reçoit MA voix et le SPOKEN (prononciations appliquées, DISPLAY intact) ; l’audio est déposé en privé ; D-ID reçoit un script AUDIO sur une URL signée ; génération apercu/did à 0 crédit ; un second aperçu → 409', async () => {
    await jusquAPret();
    const res = await apercuDid.POST();
    const json = await res.json();
    expect(json.success, JSON.stringify(json)).toBe(true);
    const genId = json.data.generationId;
    expect(json.data.display).toBe(SCRIPT_APERCU);
    expect(json.data.spoken).toBe(SCRIPT_APERCU.replace('avatar', 'a-va-tar'));
    const eleven = appelsVers(/elevenlabs\.io\/v1\/text-to-speech\//);
    expect(eleven).toHaveLength(1);
    expect(eleven[0].url).toContain('/text-to-speech/pvid_perso_0001?');
    expect((eleven[0].body as { text: string }).text).toBe(json.data.spoken);
    const cleAudio = `${U}/avatar/audio-${genId}.mp3`;
    expect(stockage.objets.get(cleAudio)).toEqual({ type: 'audio/mpeg', taille: 'MP3-VOIX-PERSO'.length });
    const scene = appelsVers('https://api.d-id.com/scenes', 'POST')[0].body as Record<string, unknown>;
    expect(scene.avatar_id).toBe('avt-1');
    expect(scene.script).toMatchObject({ type: 'audio' });
    expect(String((scene.script as { audio_url: string }).audio_url)).toMatch(new RegExp(`^https://studiio\\.pro/api/avatar/media/[^/]+/audio-${genId}\\.mp3$`));
    expect(JSON.stringify(scene)).not.toMatch(/"type":"text"|voice_id|provider/);
    const g = base.generations[0];
    expect(g).toMatchObject({ id: genId, intention: 'apercu', provider: 'did', provider_video_id: 'scn-1', status: 'processing', credits_charged: 0, avatar_version: 1, script: json.data.spoken, voice_id: `jumeau:${V1}` });
    const second = await apercuDid.POST();
    expect(second.status).toBe(409);
    expect((await second.json()).code).toBe('apercu_existant');
    expect(appelsVers('https://api.d-id.com/scenes', 'POST')).toHaveLength(1);
  });

  it('⚠️ suivi par /api/avatar/status : started → processing ; done → résultat téléchargé, re-hébergé sous media/<u>/avatar/<gen>.mp4, audio retiré, URL fournisseur jamais conservée ; validated_at reste NULL ; l’aperçu est `pret`', async () => {
    await jusquAPret();
    const { generationId } = (await (await apercuDid.POST()).json()).data;
    let s = await (await getStatut(generationId)).json();
    expect(s.data).toMatchObject({ status: 'processing', videoUrl: null });
    reseau.statutScene = { status: 'done', result_url: 'https://d-id-results.example/scn-1.mp4' };
    s = await (await getStatut(generationId)).json();
    const attendue = `https://studiio.pro/storage/v1/object/public/media/${U}/avatar/${generationId}.mp4`;
    expect(s.data).toMatchObject({ status: 'completed', videoUrl: attendue });
    expect(stockage.objets.get(`${U}/avatar/${generationId}.mp4`)).toEqual({ type: 'video/mp4', taille: 'VIDEO-DID'.length });
    expect(stockage.objets.has(`${U}/avatar/audio-${generationId}.mp3`)).toBe(false);
    expect(base.generations[0]).toMatchObject({ status: 'completed', video_url: attendue });
    expect(String(base.generations[0].video_url)).not.toContain('d-id-results');
    expect(vivant().validated_at).toBeNull();
    const a = vivant();
    expect(await apercuDuClone(U, String(a.id), a.version)).toEqual({ statut: 'pret', generationId, url: attendue });
  });

  it('scène en échec chez D-ID → génération failed (0 crédit, rien à rembourser), audio retiré', async () => {
    await jusquAPret();
    const { generationId } = (await (await apercuDid.POST()).json()).data;
    reseau.statutScene = { status: 'rejected', error: { description: 'face not found' } };
    const s = await (await getStatut(generationId)).json();
    expect(s.data.status).toBe('failed');
    expect(s.data.error).toContain('face not found');
    expect(s.data.error).not.toContain('rembourses');
    expect(stockage.objets.has(`${U}/avatar/audio-${generationId}.mp3`)).toBe(false);
  });

  it('ElevenLabs en échec → génération failed, aucun appel D-ID ; D-ID refuse la scène → failed, audio retiré', async () => {
    await jusquAPret();
    reseau.eleven = 429;
    expect((await apercuDid.POST()).status).toBe(502);
    expect(base.generations[0].status).toBe('failed');
    expect(appelsVers('https://api.d-id.com/scenes', 'POST')).toEqual([]);
    base.generations = []; reseau.eleven = 200;
    reseau.erreur = { chemin: /\/scenes$/, statut: 400, corps: { kind: 'BadRequestError', description: 'bad audio' } };
    expect((await apercuDid.POST()).status).toBe(400);
    expect(base.generations[0].status).toBe('failed');
    expect([...stockage.objets.keys()].filter((k) => k.includes('/audio-'))).toEqual([]);
  });
});

describe('6. Remplacement, suppression, et ce qui reste HeyGen', () => {
  it('⚠️ remplacer un avatar photo HeyGen par une vidéo D-ID : même ligne, version 2, provider=did, consentement fournisseur à zéro', async () => {
    await postCreate(formulaire({ file: fichier('moi.jpg', 'image/jpeg'), consent: 'true' }));
    const id = vivant().id;
    await deposerSourceDid();
    expect(vivant()).toMatchObject({ id, version: 2, provider: 'did', avatar_type: 'video', provider_avatar_id: null, provider_consent_id: null, consent_object_key: null, validated_at: null });
    expect(base.avatars).toHaveLength(1);
  });

  it('⚠️ remplacer un avatar D-ID : l’ancien est retiré chez D-ID (sur SON identifiant) et sa vidéo de consentement retirée ; la nouvelle version ne l’est jamais', async () => {
    await jusquAPret();
    const ancienConsent = String(vivant().consent_object_key);
    reseau.avatar = { id: 'avt-2', status: 'created' };
    await postCreate(formulaire({ file: fichier('moi2.jpg', 'image/jpeg'), consent: 'true' }));
    expect(vivant()).toMatchObject({ version: 2, provider: 'heygen', provider_avatar_id: 'hg-1' });
    expect(appelsVers(/scenes\/avatars\/avt-1$/, 'DELETE')).toHaveLength(1);
    expect(appelsVers(/scenes\/avatars\/avt-2$/, 'DELETE')).toEqual([]);
    expect(stockage.objets.has(ancienConsent)).toBe(false);
  });

  it('⚠️ DELETE /api/avatar sur un avatar D-ID : suppression douce, avatar retiré chez D-ID, consentement retiré ; un double clic ne retire rien de plus', async () => {
    await jusquAPret();
    const consent = String(vivant().consent_object_key);
    const res = await suppression.DELETE();
    expect(res.status).toBe(200);
    expect(base.avatars[0].deleted_at).not.toBeNull();
    expect(appelsVers(/scenes\/avatars\/avt-1$/, 'DELETE')).toHaveLength(1);
    expect(stockage.objets.has(consent)).toBe(false);
    const r2 = await supprimerAvatarActif(U);
    expect(r2.ok).toBe(false);
    expect(appelsVers(/scenes\/avatars\/avt-1$/, 'DELETE')).toHaveLength(1);
  });

  it('⚠️ un avatar D-ID n’est JAMAIS envoyé à HeyGen : /api/avatar/generate refuse (409), le jumeau refuse (avatar_non_pret)', async () => {
    await jusquAPret();
    base.avatars[0].validated_at = '2026-09-15T00:00:00Z';
    const res = await generate.POST(new NextRequest('https://studiio.pro/api/avatar/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ script: 'Bonjour', voiceId: 'v-fr' }) }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('provider_did');
    const j = await resoudreJumeauDuCompte(U);
    expect(j.ok).toBe(false);
    expect(j.ok ? '' : 'motif' in j ? j.motif : '').toBe('avatar_non_pret');
    expect(appelsVers(/heygen/)).toEqual([]);
  });
});
