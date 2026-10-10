// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * CÂBLAGE DE LA GRILLE TARIFAIRE — chaque débit serveur lit `prixDe`.
 *
 * Deux garanties :
 *   1. ZÉRO RÉGRESSION : avec la grille par défaut (aucune configuration
 *      admin), chaque montant débité est celui d'avant — IA 2/3/5/3/15/5/3/5/1,
 *      avatar 40 quel que soit le moteur, jumeau 40, reel 10, tv 15,
 *      infographie 25, affiche de référence 5, audio 1 / 1000 caractères
 *      (AI_PRICES_MIGRATED_WITHOUT_CHANGE).
 *   2. UNE SEULE SOURCE : un prix changé dans la grille change le débit
 *      suivant ; un remboursement rend ce qui a été PRIS, jamais le tarif du
 *      moment.
 *
 * Doublures : la grille (`@/lib/tarifs/serveur`), la base en mémoire, les
 * crédits (journal), HeyGen, Replicate, ElevenLabs (`fetch`), le stockage.
 * Aucun appel fournisseur réel.
 */

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
type Ligne = Record<string, unknown>;

const grille = vi.hoisted(() => ({ prix: {} as Record<string, number>, lectures: [] as string[] }));
vi.mock('@/lib/tarifs/serveur', () => ({
  prixDe: vi.fn(async (cle: string) => { grille.lectures.push(cle); return grille.prix[cle]; }),
}));

const base = vi.hoisted(() => ({
  tables: {} as Record<string, Ligne[]>,
  compteur: 0,
}));
vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => {
    const source = (base.tables[table] ??= []);
    const filtres: Array<(l: Ligne) => boolean> = [];
    let colonnes: string[] | null = null;
    let insertion: Ligne | null = null;
    let patch: Ligne | null = null;
    let limite: number | undefined;
    const projeter = (l: Ligne) => (colonnes ? Object.fromEntries(colonnes.map((c) => [c, l[c]])) : { ...l });
    const exec = () => {
      if (insertion) { const l = { id: `gen-${++base.compteur}`, ...insertion }; source.push(l); return { data: [projeter(l)], error: null }; }
      let rows = source.filter((l) => filtres.every((f) => f(l)));
      if (patch) { for (const l of rows) Object.assign(l, patch); }
      if (limite !== undefined) rows = rows.slice(0, limite);
      return { data: rows.map(projeter), error: null };
    };
    const api = {
      select(c?: string) { if (c && c !== '*') colonnes = c.split(',').map((x) => x.trim()); return api; },
      insert(v: Ligne) { insertion = v; return api; },
      update(p: Ligne) { patch = p; return api; },
      eq(k: string, v: unknown) { filtres.push((l) => l[k] === v); return api; },
      is(k: string, v: unknown) { filtres.push((l) => (l[k] ?? null) === v); return api; },
      in(k: string, vs: unknown[]) { filtres.push((l) => vs.includes(l[k])); return api; },
      order() { return api; },
      async limit(n: number) { limite = n; return exec(); },
      async single() { const r = exec(); return r.data.length ? { data: r.data[0], error: null } : { data: null, error: { message: 'no rows' } }; },
      async maybeSingle() { const r = exec(); return { data: r.data[0] ?? null, error: null }; },
      then(resolve: (v: unknown) => void, reject: (e: unknown) => void) { return Promise.resolve().then(exec).then(resolve, reject); },
    };
    return api;
  };
  const storage = { from: (bucket: string) => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://studiio.pro/storage/v1/object/public/${bucket}/${p}` } }) }) };
  return { supabase: {}, supabaseAdmin: { from, storage } };
});

const etat = vi.hoisted(() => ({ solde: 1000, admin: false, journal: [] as string[], objets: new Set<string>() }));
vi.mock('@/lib/credits/system', () => ({
  getUserCredits: async () => (etat.admin ? 999_999_999 : etat.solde),
  deductCredits: async (userId: string, n: number, raison: string, reference?: string | null) => {
    if (etat.admin) return true; // exemption existante : aucun débit, aucune ligne
    if (n === 0) return true;
    etat.journal.push(`debit:${n}:${raison}`);
    etat.solde -= n;
    (base.tables.credit_transactions ??= []).push({ id: `t${base.compteur++}`, user_id: userId, reference_id: reference ?? null, amount: -n });
    return true;
  },
  addCredits: async (_u: string, n: number) => { etat.journal.push(`refund:${n}`); etat.solde += n; return true; },
}));
vi.mock('@/lib/facturation/exemption', () => ({
  exempteDeCredits: () => etat.admin,
  compteExempteDeCredits: async () => etat.admin,
}));
vi.mock('@/lib/auth/config', () => ({ auth: async () => ({ user: { id: U } }) }));
vi.mock('@/lib/service-alerts', () => ({ detectAndReportServiceError: vi.fn(), reportServiceAlert: vi.fn() }));

const heygen = vi.hoisted(() => ({ args: [] as Array<Record<string, unknown>>, moteursLook: ['avatar_iii', 'avatar_iv', 'avatar_v'] as string[] | null, echec: false }));
vi.mock('@/lib/avatar/heygen', () => ({
  HeyGenError: class extends Error { httpStatus = 502; code = 'x'; },
  generateAvatarVideo: async (args: Record<string, unknown>) => { heygen.args.push(args); if (heygen.echec) throw new Error('heygen down'); return { videoId: 'vid-1', status: 'processing' }; },
  generateAvatarVideoFromAudio: vi.fn(),
  uploadAsset: vi.fn(),
  getAvatarTrainingStatus: async () => ({ status: 'completed' }),
  resolveVoiceId: async () => 'voice-1',
  // La confirmation HeyGen d'Avatar V, comme les tests existants : lue, jamais appelée en vrai.
  moteursSupportesDuLook: async () => heygen.moteursLook,
}));

const replicate = vi.hoisted(() => ({ runs: 0 }));
vi.mock('replicate', () => ({
  default: class { run = async () => { replicate.runs += 1; return 'Texte lu sur l image'; }; },
}));

vi.mock('@/lib/storage/upload', () => ({
  uploadBufferToStorage: vi.fn(async (o: { bucket: string; storagePath: string }) => { etat.objets.add(`${o.bucket}/${o.storagePath}`); return `https://studiio.pro/storage/v1/object/public/${o.bucket}/${o.storagePath}`; }),
  deleteFromStorage: vi.fn(async (b: string, p: string) => { etat.objets.delete(`${b}/${p}`); }),
  uploadToStorage: vi.fn(), uploadFileToStorage: vi.fn(), getSignedUrl: vi.fn(),
}));
vi.mock('@/lib/storage/minio-client', () => ({
  clientMinio: () => ({
    statObject: async (b: string, c: string) => {
      if (!etat.objets.has(`${b}/${c}`)) throw new Error('Not Found');
      return { size: 1234, metaData: { 'content-type': 'audio/mpeg' } };
    },
  }),
}));

globalThis.fetch = vi.fn(async (url: unknown) => {
  const u = String(url);
  if (u.startsWith('https://api.elevenlabs.io/v1/text-to-speech/')) {
    return new Response(Buffer.from('AUDIO-MP3'), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
  }
  throw new Error(`fetch inattendu ${u}`);
}) as unknown as typeof fetch;

process.env.REPLICATE_API_TOKEN = 'r8_test';
process.env.ELEVENLABS_API_KEY = 'cle-de-test';

const { TARIFS_DEFAUT, CLE_ACTION_IA } = await import('@/lib/tarifs/catalogue');
const { POST: IA } = await import('@/app/api/ai/image/route');
const { POST: AVATAR } = await import('@/app/api/avatar/generate/route');
const { POST: AUDIO } = await import('@/app/api/voice/audio-complet/route');
const { POST: ECOUTE } = await import('@/app/api/voice/ecoute/route');
const { rembourserGenerationUneFois, reconcilierLancement } = await import('@/lib/avatar/moteur-jumeau');
const { coutMontage, coutAfficheReference } = await import('@/lib/autopilot/produire');
const { reinitialiserAudioComplet } = await import('@/lib/voice/audio-complet-serveur');
const { reinitialiserPreecoute } = await import('@/lib/voice/preecoute-serveur');
// `coutRenduVideo` est réel (le module crédits est doublé ci-dessus).
const { coutRenduVideo } = await vi.importActual<typeof import('@/lib/credits/system')>('@/lib/credits/system');

const post = (h: (r: NextRequest) => Promise<Response>, body: unknown) =>
  h(new NextRequest('https://studiio.pro/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

const avatar = (): Ligne => ({
  id: '11111111-1111-4111-8111-000000000001', user_id: U, status: 'completed', provider: 'heygen', provider_avatar_id: 'hg-1',
  avatar_type: 'video', consent_at: '2026-09-01T00:00:00Z', version: 4, deleted_at: null, created_at: '2026-09-01T00:00:00Z',
});
const voix = (): Ligne => ({
  id: '44444444-4444-4444-8444-000000000001', user_id: U, provider: 'elevenlabs', provider_voice_id: 'pvid_0001', name: 'Bassi', lang: 'fr',
  consent_at: '2026-08-01T00:00:00Z', consent_text: 'x', created_at: '2026-08-01T00:00:00Z',
});

beforeEach(() => {
  grille.prix = { ...TARIFS_DEFAUT }; grille.lectures.length = 0;
  base.tables = {
    user_avatars: [avatar()], avatar_generations: [], credit_transactions: [], users: [],
    user_voices: [voix()], user_settings: [{ user_id: U, creator_preferences: { voixPersonnelle: { userVoiceId: null, prononciations: [] } } }],
  };
  etat.solde = 1000; etat.admin = false; etat.journal.length = 0; etat.objets.clear();
  heygen.args.length = 0; heygen.moteursLook = ['avatar_iii', 'avatar_iv', 'avatar_v']; heygen.echec = false;
  replicate.runs = 0;
  delete process.env.AVATAR_MOTEURS_AUTORISES; delete process.env.HEYGEN_AVATAR_ENGINE;
  reinitialiserAudioComplet(); reinitialiserPreecoute();
});

const PRIX_IA_AVANT: Record<string, number> = {
  'remove-bg': 2, 'magic-eraser': 3, 'magic-edit': 5, 'upscale': 3, 'image-to-video': 15,
  'generate-bg': 5, 'magic-layers': 3, 'style-transfer': 5, 'ocr': 1,
};

describe('AI_PRICES_MIGRATED_WITHOUT_CHANGE — grille par défaut = prix d’avant', () => {
  it('les 9 actions IA : le montant exigé (celui qui serait débité) est inchangé', async () => {
    etat.solde = 0; // 402 avant tout fournisseur : `creditsNeeded` est le `cost` du débit
    for (const [action, prix] of Object.entries(PRIX_IA_AVANT)) {
      const res = await post(IA, { action, imageUrl: 'https://cdn.test/a.png', prompt: 'un fond' });
      expect(res.status, action).toBe(402);
      expect((await res.json()).creditsNeeded, action).toBe(prix);
      expect(grille.lectures.at(-1), action).toBe(CLE_ACTION_IA[action]);
    }
    expect(replicate.runs).toBe(0);
  });

  it('OCR débité 1 crédit, et ce même nombre dans `creditsUsed`', async () => {
    const res = await post(IA, { action: 'ocr', imageUrl: 'https://cdn.test/a.png' });
    expect(res.status).toBe(200);
    expect((await res.json()).creditsUsed).toBe(1);
    expect(etat.journal).toEqual(['debit:1:ai-ocr']);
  });

  it('avatar : 40 quel que soit le moteur (sans qualité, Standard, Qualité, Premium)', async () => {
    for (const qualite of [undefined, 'standard', 'qualite', 'premium']) {
      etat.journal.length = 0;
      const res = await post(AVATAR, { script: 'Bonjour à tous.', ...(qualite ? { qualite } : {}) });
      expect(res.status, String(qualite)).toBe(200);
      expect(etat.journal, String(qualite)).toEqual(['debit:40:avatar']);
      expect((await res.json()).data.creditsCharged).toBe(40);
    }
  });

  it('rendus et Autopilote : reel 10, tv 15, infographie 25, montage 10, affiche de référence 5', async () => {
    expect(await coutRenduVideo('reel')).toBe(10);
    expect(await coutRenduVideo('tv')).toBe(15);
    expect(await coutRenduVideo('infographic')).toBe(25);
    expect(await coutMontage()).toBe(10);
    expect(await coutAfficheReference()).toBe(5);
  });

  it('audio complet : 1 crédit par tranche entamée de 1000 caractères (2500 → 3)', async () => {
    const res = await post(AUDIO, { texte: 'a'.repeat(2500) });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.cout).toBe(3);
    expect(etat.journal).toEqual(['debit:3:audio-complet']);
  });
});

describe('Avatar — le prix suit le MOTEUR choisi (grille admin)', () => {
  beforeEach(() => { grille.prix = { ...TARIFS_DEFAUT, 'avatar.avatar_iii': 10, 'avatar.avatar_iv': 25, 'avatar.avatar_v': 40 }; });

  it.each([
    ['standard', 10, 'avatar_iii'],
    ['qualite', 25, 'avatar_iv'],
    ['premium', 40, 'avatar_v'],
  ])('%s → débit %i (moteur %s), 402/débit/credits_charged/réponse sur le même nombre', async (qualite, prix, moteur) => {
    const res = await post(AVATAR, { script: 'Bonjour à tous.', qualite });
    expect(res.status).toBe(200);
    expect(heygen.args[0].moteur).toBe(moteur);
    expect(etat.journal).toEqual([`debit:${prix}:avatar`]);
    expect(base.tables.avatar_generations[0].credits_charged).toBe(prix);
    expect((await res.json()).data.creditsCharged).toBe(prix);
    expect(grille.lectures.filter((c) => c.startsWith('avatar.'))).toEqual([`avatar.${moteur}`]); // lu UNE fois
  });

  it('sans qualité : moteur non transmis, HeyGen prend Avatar IV → tarif avatar_iv', async () => {
    await post(AVATAR, { script: 'Bonjour à tous.' });
    expect(heygen.args[0].moteur).toBeUndefined();
    expect(etat.journal).toEqual(['debit:25:avatar']);
  });

  it('solde insuffisant : le 402 annonce le prix du moteur, rien n’est débité', async () => {
    etat.solde = 20;
    const res = await post(AVATAR, { script: 'Bonjour à tous.', qualite: 'qualite' });
    expect(res.status).toBe(402);
    expect((await res.json()).error).toContain('Requis : 25');
    expect(etat.journal).toEqual([]);
  });

  it('échec HeyGen : le remboursement rend le montant débité', async () => {
    heygen.echec = true;
    await post(AVATAR, { script: 'Bonjour à tous.', qualite: 'standard' });
    expect(etat.journal).toEqual(['debit:10:avatar', 'refund:10']);
  });

  it('administrateur : aucun débit, aucun remboursement, credits_charged 0', async () => {
    etat.admin = true;
    const res = await post(AVATAR, { script: 'Bonjour à tous.', qualite: 'premium' });
    expect(res.status).toBe(200);
    expect(etat.journal).toEqual([]);
    expect(base.tables.avatar_generations[0].credits_charged).toBe(0);
    expect((await res.json()).data.creditsCharged).toBe(0);
  });
});

describe('IA — un prix changé change le débit SUIVANT', () => {
  it('OCR 1 → 2', async () => {
    await post(IA, { action: 'ocr', imageUrl: 'https://cdn.test/a.png' });
    grille.prix['ai.ocr'] = 2;
    const res = await post(IA, { action: 'ocr', imageUrl: 'https://cdn.test/a.png' });
    expect((await res.json()).creditsUsed).toBe(2);
    expect(etat.journal).toEqual(['debit:1:ai-ocr', 'debit:2:ai-ocr']);
  });

  it('une action inconnue reste refusée (400), sans lecture de prix', async () => {
    const res = await post(IA, { action: 'inconnue' });
    expect(res.status).toBe(400);
    expect(grille.lectures).toEqual([]);
  });
});

describe('Audio complet — prix par tranche configurable', () => {
  it('2 crédits / tranche : 2500 caractères = 6', async () => {
    grille.prix['audio.full_1000_chars'] = 2;
    const res = await post(AUDIO, { texte: 'b'.repeat(2500) });
    const j = await res.json();
    expect(j.cout).toBe(6);
    expect(j.creditsDebites).toBe(6);
    expect(etat.journal).toEqual(['debit:6:audio-complet']);
  });

  it('la pré-écoute reste gratuite (aucun débit, aucune lecture de prix)', async () => {
    grille.prix['audio.full_1000_chars'] = 5;
    await post(ECOUTE, { texte: 'Bonjour à tous.' });
    expect(etat.journal).toEqual([]);
    expect(grille.lectures).not.toContain('audio.full_1000_chars');
  });
});

describe('Jumeau — on rend ce qui a été PRIS, jamais le tarif du moment', () => {
  const GEN = '55555555-5555-4555-8555-000000000001';
  const reference = `jumeau:${GEN}`;

  it('débit à 40, prix passé à 10 entre-temps → remboursement 40', async () => {
    base.tables.credit_transactions.push({ id: 't1', user_id: U, reference_id: reference, amount: -40 });
    base.tables.avatar_generations.push({ id: GEN, user_id: U, credits_refunded: false });
    grille.prix['avatar.jumeau'] = 10;
    expect(await rembourserGenerationUneFois(U, GEN)).toBe(true);
    expect(etat.journal).toEqual(['refund:40']);
    // Une seule fois.
    expect(await rembourserGenerationUneFois(U, GEN)).toBe(false);
    expect(etat.journal).toEqual(['refund:40']);
  });

  it('rien débité (admin, prix 0) → rien remboursé', async () => {
    base.tables.avatar_generations.push({ id: GEN, user_id: U, credits_refunded: false });
    expect(await rembourserGenerationUneFois(U, GEN)).toBe(false);
    expect(etat.journal).toEqual([]);
  });

  it('réconciliation : credits_charged = le montant débité, pas le tarif courant', async () => {
    base.tables.credit_transactions.push({ id: 't1', user_id: U, reference_id: reference, amount: -40 });
    base.tables.avatar_generations.push({ id: GEN, user_id: U, provider_video_id: null, credits_refunded: false });
    grille.prix['avatar.jumeau'] = 10;
    expect(await reconcilierLancement(GEN, U, 'vid-9')).toBe(true);
    expect(base.tables.avatar_generations[0]).toMatchObject({ provider_video_id: 'vid-9', credits_charged: 40 });
  });
});
