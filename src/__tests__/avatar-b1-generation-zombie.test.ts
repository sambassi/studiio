// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * B1 — UNE GÉNÉRATION ZOMBIE EST CLOSE ET REMBOURSÉE.
 *
 * Une génération `pending` SANS identifiant fournisseur et SANS marqueur
 * d'attente (crash / redéploiement en plein lancement) restait « en cours »
 * pour toujours ; l'index « en vol » renvoyait ensuite `dejaEnCours` sur ce
 * zombie à chaque nouvel essai du même texte. Au-delà du délai (30 min, le
 * même que le garde stale), elle est close `failed` et le débit
 * `jumeau:<id>` éventuel est rendu UNE fois (`rembourserGenerationUneFois`).
 *
 * Base et crédits en mémoire (même double que moteur-jumeau.test.ts) ;
 * fournisseurs interceptés au réseau, aucun appel réel.
 */
const U = 'aaaaaaaa-1111-4111-8111-111111111111';
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
      async maybeSingle() { const r = exec(); if (r.error) return { data: null, error: r.error }; const rows = r.data as unknown[]; return { data: rows[0] ?? null, error: null }; },
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
// Coût fournisseur (#562) : `coutAdmin.actif` fait de la session un ADMIN pour
// la garde de confirmation ; faux (défaut) = l'exemption réelle, inchangée.
const coutAdmin = vi.hoisted(() => ({ actif: false, jumeauVideo: false }));
vi.mock('@/lib/avatar/couts', async (orig) => {
  const vrai = await orig<typeof import('@/lib/avatar/couts')>();
  return { ...vrai, compteAdmin: async (u: string) => coutAdmin.jumeauVideo || vrai.compteAdmin(u) };
});
vi.mock('@/lib/facturation/exemption', async (orig) => {
  const vrai = await orig<typeof import('@/lib/facturation/exemption')>();
  return { ...vrai, compteExempteDeCredits: async (u: string) => coutAdmin.actif || vrai.compteExempteDeCredits(u) };
});
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
  // Lecture GRATUITE des moteurs d'un look (Avatar V confirmé ou non par HeyGen).
  if (u.startsWith('https://api.heygen.com/v3/avatars/looks/')) {
    return new Response(JSON.stringify({ data: { supported_api_engines: ['avatar_iii', 'avatar_iv', 'avatar_v'] } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  throw new Error(`fetch inattendu ${u}`);
}) as unknown as typeof fetch;

process.env.HEYGEN_API_KEY = 'cle-heygen-test';
process.env.ELEVENLABS_API_KEY = 'cle-eleven-test';
process.env.JUMEAU_MOTEUR_ACTIVE = '1';
process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';

const { avancerStatutGeneration, STALE_AFTER_MS } = await import('@/lib/avatar/statut');
const { genererVideoJumeau, PREFIXE_VOIX_JUMEAU, reconcilierLancement, DELAI_GENERATION_ZOMBIE_MS, estGenerationZombie } = await import('@/lib/avatar/moteur-jumeau');

const avatar = (over: Ligne = {}): Ligne => ({
  id: A, user_id: U, status: 'completed', provider_avatar_id: 'hg-avatar-1', provider_asset_id: 'as-1', source_object_key: `${U}/avatar/source-1-${'a'.repeat(32)}.mp4`,
  source_url: null, subject_type: 'self', consent_version: 'x', consent_at: '2026-09-01T00:00:00Z', consent_text: 'x', validated_at: '2026-09-03T00:00:00Z',
  version: 3, deleted_at: null, created_at: '2026-09-01T00:00:00.000Z', avatar_type: 'photo', name: 'Bassi', training_error: null, ...over,
});
const voix = (over: Ligne = {}): Ligne => ({ id: V1, user_id: U, provider: 'elevenlabs', provider_voice_id: 'pvid_perso_0001', name: 'Bassi', lang: 'fr', consent_at: '2026-08-01T00:00:00Z', consent_text: 'x', created_at: '2026-08-01T00:00:00Z', ...over });
const TEXTE = 'Bienvenue chez Afroboost à Neuchâtel.';
const PRONONCE = 'Bienvenue chez Afro-boust à Neu-cha-tel.';
const generer = (textes: string[] = [TEXTE]) => genererVideoJumeau({ userId: U, textes, aspectRatio: '9:16' });
const appelsVers = (prefixe: string) => reseau.appels.filter((a) => a.url.startsWith(prefixe));

beforeEach(() => {
  base.avatars = [avatar()]; base.voices = [voix()]; base.generations = []; base.transactions = []; base.compteur = 0;
  base.settings = [{ user_id: U, creator_preferences: { voixPersonnelle: { userVoiceId: null, prononciations: [{ affiche: 'Afroboost', prononce: 'Afro-boust' }, { affiche: 'Neuchâtel', prononce: 'Neu-cha-tel' }] } } }];
  credits.solde = 1000; credits.journal.length = 0; credits.leve = null; credits.admin = false; credits.majEchoue = false; coutAdmin.actif = false; coutAdmin.jumeauVideo = false;
  reseau.appels.length = 0; reseau.eleven = 200; reseau.heygenAssets = 200; reseau.heygenVideos = 200;
  process.env.JUMEAU_MOTEUR_ACTIVE = '1';
  session.courante = { user: { id: U } };
});

const ilYA = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000).toISOString();
const G = '66666666-6666-4666-8666-000000000001';
/** La ligne laissée par un crash entre la réservation (et le débit) et le lancement fournisseur. */
const zombie = (over: Ligne = {}): Ligne => ({
  id: G, user_id: U, user_avatar_id: A, avatar_version: 3, intention: 'normale', voice_id: `${PREFIXE_VOIX_JUMEAU}${V1}`,
  aspect_ratio: '9:16', script: PRONONCE, provider: 'heygen', provider_video_id: null, provider_error: null,
  status: 'pending', credits_charged: 0, credits_refunded: false, video_url: null, error_message: null,
  created_at: ilYA(45), ...over,
});
const debitDuZombie = () => base.transactions.push({ user_id: U, reference_id: `jumeau:${G}`, amount: -40 });
const remboursements = () => credits.journal.filter((j) => j.startsWith('refund:'));

describe('B1 — suivi d’une génération zombie (avancerStatutGeneration)', () => {
  it('le délai zombie est celui du garde stale (30 min)', () => {
    expect(DELAI_GENERATION_ZOMBIE_MS).toBe(STALE_AFTER_MS);
    expect(STALE_AFTER_MS).toBe(30 * 60 * 1000);
  });

  it('⚠️ zombie au-delà du délai, débit enregistré → failed + UN remboursement du montant débité', async () => {
    base.generations = [zombie()]; debitDuZombie();
    const r = await avancerStatutGeneration(U, G);
    expect(r).toMatchObject({ status: 'failed', rembourse: true });
    expect(r.status === 'failed' && r.error).toMatch(/recrédités/);
    expect(base.generations[0]).toMatchObject({ status: 'failed', credits_refunded: true });
    expect(remboursements()).toEqual(['refund:40']);
    expect(reseau.appels).toEqual([]); // aucun fournisseur interrogé
    // Repasse : état terminal, aucun second remboursement.
    expect(await avancerStatutGeneration(U, G)).toMatchObject({ status: 'failed', rembourse: false });
    expect(remboursements()).toEqual(['refund:40']);
  });

  it('zombie sans débit (admin, aperçu gratuit) → failed, rien à rembourser', async () => {
    base.generations = [zombie()];
    expect(await avancerStatutGeneration(U, G)).toMatchObject({ status: 'failed', rembourse: false });
    expect(base.generations[0].status).toBe('failed');
    expect(remboursements()).toEqual([]);
  });

  it('pending sans identifiant mais RÉCENT (< 30 min) → inchangé, toujours en cours', async () => {
    base.generations = [zombie({ created_at: ilYA(10) })]; debitDuZombie();
    expect(await avancerStatutGeneration(U, G)).toEqual({ status: 'processing', videoUrl: null, avatarVersion: 3 });
    expect(base.generations[0].status).toBe('pending');
    expect(remboursements()).toEqual([]);
  });

  it('ligne avec provider_video_id → jamais traitée en zombie (le fournisseur est interrogé)', () => {
    expect(estGenerationZombie({ status: 'processing', provider_video_id: 'vid-1', provider_error: null, created_at: ilYA(45) })).toBe(false);
    expect(estGenerationZombie({ status: 'pending', provider_video_id: 'vid-1', provider_error: null, created_at: ilYA(45) })).toBe(false);
    expect(estGenerationZombie({ status: 'pending', provider_video_id: null, provider_error: null, created_at: ilYA(45) })).toBe(true);
  });

  it('génération EN ATTENTE FOURNISSEUR (marqueur) → jamais un zombie, même après 30 min', async () => {
    expect(estGenerationZombie({ status: 'pending', provider_video_id: null, provider_error: 'waiting_provider:0:-|solde', created_at: ilYA(45) })).toBe(false);
  });

  it('⚠️ deux passes CONCURRENTES (Promise.all) → une seule clôture, UN seul remboursement', async () => {
    base.generations = [zombie()]; debitDuZombie();
    const [a, b] = await Promise.all([avancerStatutGeneration(U, G), avancerStatutGeneration(U, G)]);
    expect(a.status).toBe('failed'); expect(b.status).toBe('failed');
    expect(remboursements()).toEqual(['refund:40']);
    expect(base.generations[0]).toMatchObject({ status: 'failed', credits_refunded: true });
  });
});

describe('B1 — un nouvel essai du même texte ne bute plus sur le zombie', () => {
  it('⚠️ le zombie « en vol » est clos et remboursé, puis UNE nouvelle génération part', async () => {
    base.generations = [zombie()]; debitDuZombie();
    const r = await generer();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dejaEnCours).toBe(false);
    expect(r.generationId).not.toBe(G);
    expect(base.generations.find((g) => g.id === G)).toMatchObject({ status: 'failed', credits_refunded: true });
    expect(remboursements()).toEqual(['refund:40']);
    expect(appelsVers('https://api.heygen.com/v3/videos')).toHaveLength(1);
  });

  it('une génération en vol RÉCENTE reste rendue telle quelle (dejaEnCours), rien n’est remboursé', async () => {
    base.generations = [zombie({ created_at: ilYA(5) })]; debitDuZombie();
    const r = await generer();
    expect(r.ok && r.dejaEnCours && r.generationId).toBe(G);
    expect(remboursements()).toEqual([]);
    expect(reseau.appels).toEqual([]);
  });

  it('la réconciliation ne ressuscite jamais un zombie clos et remboursé', async () => {
    base.generations = [zombie({ status: 'failed', credits_refunded: true })];
    await reconcilierLancement(G, U, 'vid-tardif');
    expect(base.generations[0]).toMatchObject({ status: 'failed', provider_video_id: null });
  });
});

describe('B1 — l’âge se mesure depuis le DERNIER lancement, jamais depuis created_at seul', () => {
  it('⚠️ créée il y a 3 h, mise en attente puis reprise il y a 5 min, sans identifiant (marqueur présent) → NON close, NON remboursée', async () => {
    base.generations = [zombie({ created_at: ilYA(180), updated_at: ilYA(5), provider_error: 'waiting_provider:1:remplir|solde' })]; debitDuZombie();
    const r = await avancerStatutGeneration(U, G);
    expect(r.status).toBe('processing');
    expect(base.generations[0]).toMatchObject({ status: 'pending', credits_refunded: false });
    expect(remboursements()).toEqual([]);
  });

  it('⚠️ créée il y a 3 h, relancée il y a 5 min (updated_at), sans identifiant ni marqueur → NON close, NON remboursée', async () => {
    base.generations = [zombie({ created_at: ilYA(180), updated_at: ilYA(5) })]; debitDuZombie();
    expect((await avancerStatutGeneration(U, G)).status).toBe('processing');
    expect(base.generations[0].status).toBe('pending');
    expect(remboursements()).toEqual([]);
    // Nouvel essai du même texte : la génération relancée reste celle rendue.
    const r = await generer();
    expect(r.ok && r.dejaEnCours && r.generationId).toBe(G);
  });

  it('⚠️ relancée il y a 40 min, toujours sans identifiant → close UNE seule fois (passes concurrentes)', async () => {
    base.generations = [zombie({ created_at: ilYA(180), updated_at: ilYA(40) })]; debitDuZombie();
    const [a, b] = await Promise.all([avancerStatutGeneration(U, G), avancerStatutGeneration(U, G)]);
    expect([a.status, b.status]).toEqual(['failed', 'failed']);
    expect(base.generations[0]).toMatchObject({ status: 'failed', credits_refunded: true });
    expect(remboursements()).toEqual(['refund:40']);
  });

  it('marqueur d’attente présent, même reprise il y a 40 min → jamais close par le garde zombie', () => {
    expect(estGenerationZombie({ status: 'pending', provider_video_id: null, provider_error: 'waiting_provider:1:-', created_at: ilYA(180), updated_at: ilYA(40) })).toBe(false);
  });
});
