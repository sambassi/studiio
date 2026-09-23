// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * LE MOTEUR VIDÉO DU JUMEAU — la chaîne réelle, fournisseurs doublés au
 * niveau du `fetch` : le VRAI client ElevenLabs (synthetiserAvecVoix) et le
 * VRAI client HeyGen (uploadAsset, generateAvatarVideoFromAudio) s'exécutent ;
 * seul le réseau est intercepté. Base et crédits en mémoire.
 *
 * Ce que ces tests prouvent : le jumeau est relu (avatar validé de la
 * version courante, voix du compte) ; ElevenLabs reçoit MA voix et le
 * SPOKEN_SCRIPT ; l'audio part chez HeyGen en asset (multipart), jamais en
 * URL ; /v3/videos reçoit `audio_asset_id` + `avatar_id`, JAMAIS `script`
 * ni `voice_id` ; la génération porte avatar_version et la voix interne ;
 * crédits : politique existante, remboursés si la vidéo n'est pas lancée ;
 * échecs → jamais un succès ; idempotence sur une génération en cours ;
 * moteur inactif par défaut.
 */

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRUI = 'bbbbbbbb-2222-4222-8222-222222222222';
const A = '11111111-1111-4111-8111-000000000001';
const V1 = '44444444-4444-4444-8444-000000000001';

type Ligne = Record<string, unknown>;
const base = vi.hoisted(() => ({ avatars: [] as Ligne[], voices: [] as Ligne[], settings: [] as Ligne[], generations: [] as Ligne[], transactions: [] as Ligne[], compteur: 0 }));
const credits = vi.hoisted(() => ({ solde: 1000, journal: [] as string[], leve: null as null | { message: string; apresEcriture: boolean }, admin: false, majEchoue: false }));
const reseau = vi.hoisted(() => ({
  appels: [] as Array<{ url: string; method: string; body: unknown; contentType: string | null }>,
  eleven: 200 as number, heygenAssets: 200 as number, heygenVideos: 200 as number,
}));

vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => {
    const source = table === 'user_avatars' ? base.avatars : table === 'user_voices' ? base.voices : table === 'user_settings' ? base.settings : table === 'avatar_generations' ? base.generations : table === 'credit_transactions' ? base.transactions : null;
    if (!source) throw new Error(`table inattendue ${table}`);
    const filtres: Array<(l: Ligne) => boolean> = [];
    let colonnes: string[] | null = null; let tri = false; let limite: number | undefined;
    let insertion: Ligne | null = null; let patch: Ligne | null = null;
    const projeter = (l: Ligne) => (colonnes ? Object.fromEntries(colonnes.map((c) => [c, l[c]])) : { ...l });
    const exec = () => {
      if (insertion) {
        // L'index unique partiel de `2026-09-15-avatar-jumeau-en-vol.sql`, à
        // la lettre : même prédicat, même clé, même erreur que PostgREST.
        // (La preuve sur un VRAI Postgres est dans tests-pg/jumeau-idempotence.)
        const i = insertion;
        const enVol = (l: Ligne) => l.intention === 'normale' && String(l.voice_id ?? '').startsWith('jumeau:') && ['pending', 'processing'].includes(String(l.status));
        if (source === base.generations && enVol(i) && source.some((l) => enVol(l) && ['user_id', 'user_avatar_id', 'avatar_version', 'voice_id', 'aspect_ratio', 'script'].every((k) => l[k] === i[k]))) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "avatar_generations_jumeau_en_vol_uidx"' } };
        }
        const l = { id: `55555555-5555-4555-8555-${String(++base.compteur).padStart(12, '0')}`, created_at: new Date(Date.now() + base.compteur).toISOString(), video_url: null, error_message: null, credits_refunded: false, ...i }; source.push(l); return { data: [projeter(l)], error: null };
      }
      let rows = source.filter((l) => filtres.every((f) => f(l)));
      if (patch && credits.majEchoue && 'provider_video_id' in patch) return { data: null, error: { message: 'panne base' } };
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
  return { supabase: {}, supabaseAdmin: { from } };
});
vi.mock('@/lib/credits/system', () => ({
  getUserCredits: async () => credits.solde,
  deductCredits: async (_u: string, n: number, _raison: string, reference?: string | null) => {
    // Admin : exemption existante — aucun décrément, aucune ligne de journal.
    if (credits.admin) return true;
    if (credits.leve && !credits.leve.apresEcriture) throw new Error(credits.leve.message);
    credits.journal.push(`debit:${n}:${reference ?? 'sans-reference'}`); credits.solde -= n; base.transactions.push({ user_id: _u, reference_id: reference ?? null, amount: -n });
    // Débit ÉCRIT puis erreur (réponse perdue) : le cas où il faut rembourser.
    if (credits.leve?.apresEcriture) throw new Error(credits.leve.message);
    return true;
  },
  addCredits: async (_u: string, n: number) => { credits.journal.push(`refund:${n}`); credits.solde += n; },
}));
const session = vi.hoisted(() => ({ courante: { user: { id: 'aaaaaaaa-1111-4111-8111-111111111111' } } as unknown }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => session.courante }));

globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
  const u = String(url);
  const ct = init?.headers ? ((init.headers as Record<string, string>)['Content-Type'] ?? null) : null;
  let body: unknown = init?.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* brut */ } }
  if (body instanceof FormData) body = { formData: Array.from(body.keys()), file: body.get('file') };
  reseau.appels.push({ url: u, method: init?.method ?? 'GET', body, contentType: ct });
  if (u.startsWith('https://api.elevenlabs.io/v1/text-to-speech/')) {
    if (reseau.eleven !== 200) return new Response('quota', { status: reseau.eleven });
    return new Response(Buffer.from('MP3-VOIX-PERSO'), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
  }
  if (u === 'https://api.heygen.com/v3/assets') {
    if (reseau.heygenAssets !== 200) return new Response(JSON.stringify({ error: 'nope' }), { status: reseau.heygenAssets });
    return new Response(JSON.stringify({ data: { asset_id: 'asset-audio-1' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (u === 'https://api.heygen.com/v3/videos') {
    if (reseau.heygenVideos !== 200) return new Response(JSON.stringify({ error: { message: 'audio refuse' } }), { status: reseau.heygenVideos });
    return new Response(JSON.stringify({ data: { video_id: 'vid-jumeau-1', status: 'waiting' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new Error(`fetch inattendu ${u}`);
}) as unknown as typeof fetch;

process.env.HEYGEN_API_KEY = 'cle-heygen-test';
process.env.ELEVENLABS_API_KEY = 'cle-eleven-test';
process.env.JUMEAU_MOTEUR_ACTIVE = '1';
process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';

const { genererVideoJumeau, moteurJumeauDisponible, PREFIXE_VOIX_JUMEAU, rembourserGenerationUneFois, reconcilierLancement } = await import('@/lib/avatar/moteur-jumeau');
const { POST } = await import('@/app/api/creer/jumeau/generer/route');

const avatar = (over: Ligne = {}): Ligne => ({
  id: A, user_id: U, status: 'completed', provider_avatar_id: 'hg-avatar-1', provider_asset_id: 'as-1', source_object_key: `${U}/avatar/source-1-${'a'.repeat(32)}.mp4`,
  source_url: null, subject_type: 'self', consent_version: 'x', consent_at: '2026-09-01T00:00:00Z', consent_text: 'x', validated_at: '2026-09-03T00:00:00Z',
  version: 3, deleted_at: null, created_at: '2026-09-01T00:00:00.000Z', avatar_type: 'video', name: 'Bassi', training_error: null, ...over,
});
const voix = (over: Ligne = {}): Ligne => ({ id: V1, user_id: U, provider: 'elevenlabs', provider_voice_id: 'pvid_perso_0001', name: 'Bassi', lang: 'fr', consent_at: '2026-08-01T00:00:00Z', consent_text: 'x', created_at: '2026-08-01T00:00:00Z', ...over });
const TEXTE = 'Bienvenue chez Afroboost à Neuchâtel.';
const PRONONCE = 'Bienvenue chez Afro-boust à Neu-cha-tel.';
const generer = (textes: string[] = [TEXTE]) => genererVideoJumeau({ userId: U, textes, aspectRatio: '9:16' });
const appelsVers = (prefixe: string) => reseau.appels.filter((a) => a.url.startsWith(prefixe));

beforeEach(() => {
  base.avatars = [avatar()]; base.voices = [voix()]; base.generations = []; base.transactions = []; base.compteur = 0;
  base.settings = [{ user_id: U, creator_preferences: { voixPersonnelle: { userVoiceId: null, prononciations: [{ affiche: 'Afroboost', prononce: 'Afro-boust' }, { affiche: 'Neuchâtel', prononce: 'Neu-cha-tel' }] } } }];
  credits.solde = 1000; credits.journal.length = 0; credits.leve = null; credits.admin = false; credits.majEchoue = false;
  reseau.appels.length = 0; reseau.eleven = 200; reseau.heygenAssets = 200; reseau.heygenVideos = 200;
  process.env.JUMEAU_MOTEUR_ACTIVE = '1';
  session.courante = { user: { id: U } };
});

describe('genererVideoJumeau — la chaîne réelle, fournisseurs interceptés au réseau', () => {
  it('⚠️ ElevenLabs reçoit MA voix et le SPOKEN ; l’audio part en asset multipart ; /v3/videos reçoit audio_asset_id + avatar_id, JAMAIS script ni voice_id', async () => {
    const r = await generer();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ generationId: expect.any(String), status: 'pending', avatarVersion: 3, dejaEnCours: false, display: TEXTE, spoken: PRONONCE });
    // 1. ElevenLabs : la voix personnelle du compte, sur le texte DIT.
    const eleven = appelsVers('https://api.elevenlabs.io/v1/text-to-speech/');
    expect(eleven).toHaveLength(1);
    expect(eleven[0].url).toContain('/text-to-speech/pvid_perso_0001?');
    expect(eleven[0].body).toEqual({ text: PRONONCE, model_id: 'eleven_multilingual_v2' });
    // 2. HeyGen assets : l'audio en multipart, jamais une URL.
    const assets = appelsVers('https://api.heygen.com/v3/assets');
    expect(assets).toHaveLength(1);
    expect(assets[0].method).toBe('POST');
    expect((assets[0].body as { formData: string[]; file: Blob }).formData).toEqual(['file']);
    expect((assets[0].body as { file: Blob }).file.type).toBe('audio/mpeg');
    // 3. HeyGen videos : audio_asset_id + avatar courant, ni script ni voice_id.
    const videos = appelsVers('https://api.heygen.com/v3/videos');
    expect(videos).toHaveLength(1);
    expect(videos[0].body).toEqual({ type: 'avatar', avatar_id: 'hg-avatar-1', audio_asset_id: 'asset-audio-1', aspect_ratio: '9:16', resolution: '720p', output_format: 'mp4' });
    expect(JSON.stringify(videos[0].body)).not.toMatch(/script|voice_id|audio_url/);
    // Ordre : ElevenLabs → assets → videos.
    expect(reseau.appels.map((a) => a.url.replace(/\?.*$/, ''))).toEqual([
      'https://api.elevenlabs.io/v1/text-to-speech/pvid_perso_0001', 'https://api.heygen.com/v3/assets', 'https://api.heygen.com/v3/videos',
    ]);
    // 4. La génération : version épinglée, voix INTERNE marquée, script = SPOKEN, provider_video_id.
    const g = base.generations[0];
    expect(g).toMatchObject({ user_id: U, user_avatar_id: A, avatar_version: 3, intention: 'normale', voice_id: `${PREFIXE_VOIX_JUMEAU}${V1}`, script: PRONONCE, provider_video_id: 'vid-jumeau-1', status: 'pending', credits_charged: 40 });
    expect(JSON.stringify(g)).not.toContain('pvid_perso');
    // 5. Crédits : politique existante, débités une fois, LIÉS à la génération gagnante.
    expect(credits.journal).toEqual([`debit:40:jumeau:${g.id}`]);
  });

  it('⚠️ DISPLAY préservé : le résultat rend display intact et spoken distinct ; aucune prononciation → identiques', async () => {
    const r = await generer();
    expect(r.ok && r.display).toBe(TEXTE);
    base.generations = []; base.transactions = []; base.settings = []; reseau.appels.length = 0;
    const r2 = await generer();
    expect(r2.ok && r2.spoken).toBe(TEXTE);
  });

  it('⚠️ moteur INACTIF par défaut (drapeau absent) → moteur_indisponible, aucun appel, aucun débit, rien en base', async () => {
    delete process.env.JUMEAU_MOTEUR_ACTIVE;
    const r = await generer();
    expect(r).toMatchObject({ ok: false, motif: 'moteur_indisponible' });
    expect(reseau.appels).toEqual([]); expect(credits.journal).toEqual([]); expect(base.generations).toEqual([]);
    expect(moteurJumeauDisponible(process.env)).toBe(false);
  });

  it('⚠️ jumeau non prêt : avatar d’autrui / supprimé / non validé / sans provider ; voix d’autrui / absente / choix requis → refus AVANT tout fournisseur et tout débit', async () => {
    const cas: Array<[string, () => void, string]> = [
      ['avatar autrui', () => { base.avatars = [avatar({ user_id: AUTRUI })]; }, 'avatar_absent'],
      ['avatar supprimé', () => { base.avatars = [avatar({ deleted_at: '2026-09-15T00:00:00Z' })]; }, 'avatar_absent'],
      ['avatar non validé', () => { base.avatars = [avatar({ validated_at: null })]; }, 'avatar_non_valide'],
      ['provider absent', () => { base.avatars = [avatar({ provider_avatar_id: null, status: 'source_ready', validated_at: null })]; }, 'avatar_non_pret'],
      ['voix autrui', () => { base.voices = [voix({ user_id: AUTRUI })]; }, 'voix_absente'],
      ['voix sans provider id', () => { base.voices = [voix({ provider_voice_id: '' })]; }, 'voix_inutilisable'],
      ['choix requis', () => { base.voices = [voix(), voix({ id: '44444444-4444-4444-8444-000000000002', provider_voice_id: 'pvid_autre_0002' })]; }, 'choix_voix_requis'],
    ];
    for (const [nom, preparer, motif] of cas) {
      base.avatars = [avatar()]; base.voices = [voix()]; reseau.appels.length = 0; credits.journal.length = 0;
      preparer();
      const r = await generer();
      expect(r, nom).toMatchObject({ ok: false, motif });
      expect(reseau.appels, nom).toEqual([]); expect(credits.journal, nom).toEqual([]); expect(base.generations, nom).toEqual([]);
    }
  });

  it('⚠️ ancienne version jamais réutilisée : après remplacement (v4 non validée), refus ; une génération v3 en cours reste v3', async () => {
    const r1 = await generer();
    expect(r1.ok && r1.avatarVersion).toBe(3);
    base.avatars = [avatar({ version: 4, validated_at: null, provider_avatar_id: 'hg-avatar-4' })];
    const r2 = await generer();
    expect(r2).toMatchObject({ ok: false, motif: 'avatar_non_valide' });
    expect(base.generations[0].avatar_version).toBe(3);
  });

  it('⚠️ ElevenLabs échoue → génération failed, crédits REMBOURSÉS, aucun appel HeyGen, jamais un succès', async () => {
    reseau.eleven = 429;
    const r = await generer();
    expect(r).toMatchObject({ ok: false, motif: 'fournisseur_voix' });
    expect(base.generations[0].status).toBe('failed');
    expect(appelsVers('https://api.heygen.com')).toEqual([]);
    expect(credits.journal.map((j) => j.replace(/:jumeau:[0-9a-f-]+$/, ''))).toEqual(['debit:40', 'refund:40']);
  });

  it('⚠️ HeyGen refuse l’asset ou l’audio → failed, remboursés, aucun succès ; pas de repli vers une voix HeyGen', async () => {
    reseau.heygenAssets = 400;
    expect(await generer()).toMatchObject({ ok: false, motif: 'fournisseur_avatar' });
    expect(credits.journal.map((j) => j.replace(/:jumeau:[0-9a-f-]+$/, ''))).toEqual(['debit:40', 'refund:40']);
    expect(appelsVers('https://api.heygen.com/v3/videos')).toEqual([]);
    base.generations = []; base.transactions = []; credits.journal.length = 0; reseau.appels.length = 0; reseau.heygenAssets = 200; reseau.heygenVideos = 400;
    expect(await generer()).toMatchObject({ ok: false, motif: 'fournisseur_avatar' });
    expect(base.generations[0].status).toBe('failed');
    expect(credits.journal.map((j) => j.replace(/:jumeau:[0-9a-f-]+$/, ''))).toEqual(['debit:40', 'refund:40']);
    expect(JSON.stringify(reseau.appels)).not.toMatch(/voice_id/);
  });

  it('crédits insuffisants → refus, aucun fournisseur, réservation libérée en failed', async () => {
    credits.solde = 10;
    expect(await generer()).toMatchObject({ ok: false, motif: 'credits_insuffisants' });
    expect(reseau.appels).toEqual([]);
    expect(base.generations[0].status).toBe('failed');
  });

  it('⚠️ idempotence : une génération EN COURS pour le même script et la même version est rendue telle quelle — un seul audio, une seule vidéo, un seul débit', async () => {
    const r1 = await generer();
    const r2 = await generer();
    expect(r1.ok && r2.ok && r2.generationId).toBe(r1.ok && r1.generationId);
    expect(r2.ok && r2.dejaEnCours).toBe(true);
    expect(appelsVers('https://api.elevenlabs.io')).toHaveLength(1);
    expect(appelsVers('https://api.heygen.com/v3/videos')).toHaveLength(1);
    expect(credits.journal).toEqual([`debit:40:jumeau:${r1.ok ? r1.generationId : ''}`]);
    // Un texte différent → une autre génération.
    const r3 = await generer(['Autre texte.']);
    expect(r3.ok && r3.dejaEnCours).toBe(false);
    expect(base.generations).toHaveLength(2);
    // Un autre FORMAT du même texte → une autre vidéo, donc une autre génération.
    const r4 = await genererVideoJumeau({ userId: U, textes: [TEXTE], aspectRatio: '16:9' });
    expect(r4.ok && r4.dejaEnCours).toBe(false);
    expect(base.generations).toHaveLength(3);
    // Une génération ÉCHOUÉE libère la place : la relance produit une nouvelle génération.
    base.generations[0].status = 'failed';
    const r5 = await generer();
    expect(r5.ok && r5.dejaEnCours).toBe(false);
    expect(base.generations).toHaveLength(4);
  });

  it('⚠️ le perdant rend la génération EN VOL, jamais une plus récente échouée ; aucun fournisseur, aucun débit', async () => {
    const identite = { user_id: U, user_avatar_id: A, avatar_version: 3, intention: 'normale', voice_id: `${PREFIXE_VOIX_JUMEAU}${V1}`, aspect_ratio: '9:16', script: PRONONCE, credits_charged: 0 };
    base.generations = [
      { id: 'gen-en-vol', created_at: '2026-09-15T10:00:00.000Z', status: 'processing', ...identite },
      { id: 'gen-echouee', created_at: '2026-09-15T11:00:00.000Z', status: 'failed', ...identite },
    ];
    const r = await generer();
    expect(r.ok && r.dejaEnCours && r.generationId).toBe('gen-en-vol');
    expect(reseau.appels).toEqual([]); expect(credits.journal).toEqual([]);
  });

  it('⚠️ deux appels STRICTEMENT simultanés (Promise.all) : une réservation, une synthèse, un dépôt, une vidéo, un débit, le même generationId', async () => {
    const [a, b] = await Promise.all([generer(), generer()]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.generationId).toBe(b.generationId);
    expect([a.dejaEnCours, b.dejaEnCours].sort()).toEqual([false, true]);
    expect(appelsVers('https://api.elevenlabs.io')).toHaveLength(1);
    expect(appelsVers('https://api.heygen.com/v3/assets')).toHaveLength(1);
    expect(appelsVers('https://api.heygen.com/v3/videos')).toHaveLength(1);
    expect(credits.journal).toEqual([`debit:40:jumeau:${a.generationId}`]);
    expect(base.generations.filter((g) => ['pending', 'processing'].includes(String(g.status)))).toHaveLength(1);
  });

  it('⚠️ le moteur ignore tout identifiant fournisseur glissé dans ses arguments : seuls ceux relus du compte partent', async () => {
    const r = await genererVideoJumeau({ userId: U, textes: [TEXTE], aspectRatio: '9:16', providerVoiceId: 'PIRATE_VOIX', providerAvatarId: 'PIRATE_AVATAR', avatarVersion: 99, userVoiceId: 'PIRATE' } as never);
    expect(r.ok).toBe(true);
    expect(appelsVers('https://api.elevenlabs.io')[0].url).toContain('/text-to-speech/pvid_perso_0001?');
    expect(appelsVers('https://api.heygen.com/v3/videos')[0].body).toMatchObject({ avatar_id: 'hg-avatar-1' });
    expect(JSON.stringify(reseau.appels)).not.toMatch(/PIRATE/);
    expect(base.generations[0].avatar_version).toBe(3);
  });

  it('texte vide / trop long → refus sans fournisseur', async () => {
    expect(await generer([''])).toMatchObject({ ok: false, motif: 'texte_absent' });
    expect(await generer(['a'.repeat(1201)])).toMatchObject({ ok: false, motif: 'texte_trop_long' });
    expect(reseau.appels).toEqual([]);
  });
});

describe('POST /api/creer/jumeau/generer', () => {
  const post = (body: unknown) => POST(new NextRequest('https://studiio.pro/api/creer/jumeau/generer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

  it('sans session → 401 ; moteur inactif → 503 ; non prêt → 409 ; crédits → 402 ; fournisseur → 502 ; succès → generationId', async () => {
    session.courante = null;
    expect((await post({ textes: [TEXTE] })).status).toBe(401);
    session.courante = { user: { id: U } };
    delete process.env.JUMEAU_MOTEUR_ACTIVE;
    expect((await post({ textes: [TEXTE] })).status).toBe(503);
    process.env.JUMEAU_MOTEUR_ACTIVE = '1';
    base.avatars = [avatar({ validated_at: null })];
    expect((await post({ textes: [TEXTE] })).status).toBe(409);
    base.avatars = [avatar()]; credits.solde = 0;
    expect((await post({ textes: [TEXTE] })).status).toBe(402);
    credits.solde = 1000; base.generations = []; base.transactions = []; reseau.eleven = 500;
    expect((await post({ textes: [TEXTE] })).status).toBe(502);
    reseau.eleven = 200; base.generations = []; base.transactions = [];
    const res = await post({ textes: [TEXTE], aspectRatio: '16:9', providerAvatarId: 'PIRATE', providerVoiceId: 'PIRATE', avatarVersion: 99, userVoiceId: 'PIRATE' });
    expect(res.status).toBe(200);
    const corps = await res.json() as { data: { generationId: string; avatarVersion: number; spoken: string } };
    expect(corps.data.avatarVersion).toBe(3);
    expect(corps.data.spoken).toBe(PRONONCE);
    // Les identifiants du corps n'ont rien changé : le vrai avatar et la vraie voix ont été utilisés.
    const videos = appelsVers('https://api.heygen.com/v3/videos');
    expect(videos.pop()!.body).toMatchObject({ avatar_id: 'hg-avatar-1', aspect_ratio: '16:9' });
    expect(appelsVers('https://api.elevenlabs.io').pop()!.url).toContain('pvid_perso_0001');
  });
});

describe('Durcissement : débit, remboursement, génération lancée non enregistrée', () => {
  const remboursements = () => credits.journal.filter((j) => j.startsWith('refund:'));

  it('le DÉBIT lève (rien écrit) : génération close, AUCUN fournisseur, AUCUN remboursement', async () => {
    credits.leve = { message: 'debit refuse : socle_absent', apresEcriture: false };
    const r = await generer();
    expect(r).toMatchObject({ ok: false, motif: 'base' });
    expect(base.generations[0].status).toBe('failed');
    expect(reseau.appels).toHaveLength(0);
    expect(remboursements()).toHaveLength(0);
  });

  it('le débit lève APRÈS avoir été écrit : remboursé UNE fois, aucun fournisseur', async () => {
    credits.leve = { message: 'reponse perdue', apresEcriture: true };
    const r = await generer();
    expect(r.ok).toBe(false);
    expect(reseau.appels).toHaveLength(0);
    expect(remboursements()).toEqual(['refund:40']);
  });

  it('solde passé sous le seuil au débit : motif crédits, rien lancé', async () => {
    credits.leve = { message: 'Insufficient credits', apresEcriture: false };
    const r = await generer();
    expect(r).toMatchObject({ ok: false, motif: 'credits_insuffisants' });
    expect(reseau.appels).toHaveLength(0);
  });

  it('remboursement exécuté DEUX fois : un seul crédit rendu', async () => {
    reseau.eleven = 429;
    const r = await generer();
    expect(r.ok).toBe(false);
    expect(remboursements()).toEqual(['refund:40']);
    const id = String(base.generations[0].id);
    expect(await rembourserGenerationUneFois(U, id)).toBe(false);
    expect(await rembourserGenerationUneFois(U, id)).toBe(false);
    expect(remboursements()).toEqual(['refund:40']);
  });

  it('jamais débité → jamais remboursé (administrateur exempté)', async () => {
    credits.admin = true;
    reseau.eleven = 429;
    const r = await generer();
    expect(r.ok).toBe(false);
    expect(remboursements()).toHaveLength(0);
  });

  it('fournisseur ACCEPTÉ puis écriture ratée : lance=true, identifiants rendus, ni remboursement ni échec', async () => {
    credits.majEchoue = true;
    const r = await generer();
    expect(r).toMatchObject({ ok: false, lance: true, providerVideoId: 'vid-jumeau-1', generationId: base.generations[0].id });
    expect(base.generations[0].status).not.toBe('failed');
    expect(remboursements()).toHaveLength(0);
    expect(credits.journal.filter((j) => j.startsWith('debit:'))).toHaveLength(1);
  });

  it('réconciliation : rattache l identifiant, sans jamais écraser une génération déjà suivie', async () => {
    credits.majEchoue = true;
    await generer();
    credits.majEchoue = false;
    const id = String(base.generations[0].id);
    expect(await reconcilierLancement(id, U, 'vid-jumeau-1')).toBe(true);
    expect(base.generations[0]).toMatchObject({ provider_video_id: 'vid-jumeau-1', status: 'processing' });
    base.generations[0].status = 'completed';
    await reconcilierLancement(id, U, 'AUTRE');
    expect(base.generations[0]).toMatchObject({ provider_video_id: 'vid-jumeau-1', status: 'completed' });
  });
});
