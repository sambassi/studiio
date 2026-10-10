// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'crypto';

/**
 * « Générer l'audio complet » — 1 crédit par bloc entamé de 1000 caractères,
 * 0 pour l'administrateur, débité APRÈS synthèse et envoi réussis, jamais
 * deux fois pour le même audio. La pré-écoute reste gratuite.
 *
 * Doublures : `user_voices` / `user_settings` en mémoire, ElevenLabs par
 * `fetch` intercepté (aucun appel réseau réel), crédits, exemption, stockage
 * et MinIO espionnés.
 */

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const V1 = '44444444-4444-4444-8444-000000000001';
const PVID = 'pvid_0001_abcd';

type Ligne = Record<string, unknown>;
const base = vi.hoisted(() => ({ voices: [] as Ligne[], settings: [] as Ligne[], transactions: [] as Ligne[] }));
const eleven = vi.hoisted(() => ({ appels: [] as string[], statut: 200, retard: null as Promise<void> | null }));
const etat = vi.hoisted(() => ({
  exempt: false, solde: 100, objets: new Set<string>(), uploadEchoue: false, debitErreur: null as string | null,
}));

vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => {
    const source = table === 'user_voices' ? base.voices : table === 'user_settings' ? base.settings : table === 'credit_transactions' ? base.transactions : null;
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
      async maybeSingle() { const r = exec(); return { data: r.data[0] ?? null, error: null }; },
      then(resolve: (v: unknown) => void, reject: (e: unknown) => void) { return Promise.resolve().then(exec).then(resolve, reject); },
    };
    return api;
  };
  const storage = { from: (bucket: string) => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://studiio.pro/storage/v1/object/public/${bucket}/${p}` } }) }) };
  return { supabase: {}, supabaseAdmin: { from, storage } };
});

const session = vi.hoisted(() => ({ courante: { user: { id: 'aaaaaaaa-1111-4111-8111-111111111111' } } as unknown }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => session.courante }));

const credits = vi.hoisted(() => ({
  getUserCredits: vi.fn(async () => etat.solde),
  deductCredits: vi.fn(async (userId: string, _n: number, _r?: string, reference?: string) => {
    if (etat.debitErreur) throw new Error(etat.debitErreur);
    // Le journal idempotent : une ligne par référence, comme l'index unique en base.
    if (reference && !base.transactions.some((t) => t.reference_id === reference)) base.transactions.push({ id: `t${base.transactions.length}`, user_id: userId, reference_id: reference });
    return true;
  }),
}));
vi.mock('@/lib/credits/system', () => ({ getUserCredits: credits.getUserCredits, deductCredits: credits.deductCredits }));
vi.mock('@/lib/facturation/exemption', () => ({
  exempteDeCredits: () => false,
  compteExempteDeCredits: vi.fn(async () => etat.exempt),
}));

const stockage = vi.hoisted(() => ({
  uploadBufferToStorage: vi.fn(async (o: { bucket: string; storagePath: string }) => {
    if (etat.uploadEchoue) throw new Error('Storage upload failed: down');
    etat.objets.add(`${o.bucket}/${o.storagePath}`);
    return `https://studiio.pro/storage/v1/object/public/${o.bucket}/${o.storagePath}`;
  }),
  deleteFromStorage: vi.fn(async (b: string, p: string) => { etat.objets.delete(`${b}/${p}`); }),
}));
vi.mock('@/lib/storage/upload', () => ({
  uploadBufferToStorage: stockage.uploadBufferToStorage, deleteFromStorage: stockage.deleteFromStorage,
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
    eleven.appels.push(u);
    if (eleven.retard) await eleven.retard;
    if (eleven.statut !== 200) return new Response('quota', { status: eleven.statut });
    return new Response(Buffer.from('AUDIO-MP3'), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
  }
  throw new Error(`fetch inattendu ${u}`);
}) as unknown as typeof fetch;

process.env.ELEVENLABS_API_KEY = 'cle-de-test';

const { POST } = await import('@/app/api/voice/audio-complet/route');
const { POST: ECOUTER } = await import('@/app/api/voice/ecoute/route');
const { POST: ECOUTER_PRONONCIATION } = await import('@/app/api/voice/prononciations/ecoute/route');
const { coutAudioComplet, libelleBoutonAudioComplet, MAX_CARACTERES_AUDIO_COMPLET } = await import('@/lib/voice/audio-complet');
const { reinitialiserAudioComplet, cheminAudioComplet } = await import('@/lib/voice/audio-complet-serveur');
const { reinitialiserPreecoute } = await import('@/lib/voice/preecoute-serveur');
const { scriptParle } = await import('@/lib/voice/prononciations');

const PRONONCIATIONS = [{ affiche: 'Afroboost', prononce: 'Afro-Boost' }];
const voix = (): Ligne => ({
  id: V1, user_id: U, provider: 'elevenlabs', provider_voice_id: PVID, name: 'Bassi', lang: 'fr',
  consent_at: '2026-08-01T00:00:00Z', consent_text: 'x', created_at: '2026-08-01T00:00:00Z',
});
const post = (h: (r: NextRequest) => Promise<Response>, body: unknown) =>
  h(new NextRequest('https://studiio.pro/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const texteDe = (n: number) => 'a'.repeat(n);
const empreinte = (texte: string) => createHash('sha256').update(`${U}|${PVID}|${scriptParle(texte, PRONONCIATIONS)}`).digest('hex');

beforeEach(() => {
  base.voices = [voix()]; base.transactions = [];
  base.settings = [{ user_id: U, creator_preferences: { voixPersonnelle: { userVoiceId: null, prononciations: PRONONCIATIONS } } }];
  eleven.appels.length = 0; eleven.statut = 200; eleven.retard = null;
  etat.exempt = false; etat.solde = 100; etat.objets.clear(); etat.uploadEchoue = false; etat.debitErreur = null;
  credits.getUserCredits.mockClear(); credits.deductCredits.mockClear();
  stockage.uploadBufferToStorage.mockClear(); stockage.deleteFromStorage.mockClear();
  session.courante = { user: { id: U } };
  process.env.ELEVENLABS_API_KEY = 'cle-de-test';
  reinitialiserAudioComplet();
  reinitialiserPreecoute();
});

describe('coutAudioComplet — 1 crédit par bloc entamé de 1000 caractères', () => {
  it.each([[1, 1], [500, 1], [1000, 1], [1001, 2], [2000, 2], [2500, 3], [5000, 5], [0, 1]])('%i caractères → %i crédit(s)', (n, c) => {
    expect(coutAudioComplet(n)).toBe(c);
  });
  it('libellés du bouton', () => {
    expect(libelleBoutonAudioComplet(500, false)).toBe('Générer l’audio complet — 1 crédit');
    expect(libelleBoutonAudioComplet(2500, false)).toBe('Générer l’audio complet — 3 crédits');
    expect(libelleBoutonAudioComplet(2500, true)).toBe('Générer l’audio complet — 0 crédit (administrateur)');
  });
});

describe('POST /api/voice/audio-complet — tarif calculé par le serveur', () => {
  it.each([[500, 1], [1000, 1], [1001, 2], [2500, 3]])('⚠️ %i caractères → débit de %i, référence audio-complet:<empreinte>, APRÈS synthèse et envoi', async (n, c) => {
    const texte = texteDe(n);
    const res = await post(POST, { texte });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(json).toMatchObject({ success: true, creditsDebites: c, cout: c, caracteres: n, dejaGenere: false });
    expect(eleven.appels).toHaveLength(1);
    expect(eleven.appels[0]).toContain(PVID);
    expect(credits.deductCredits).toHaveBeenCalledTimes(1);
    const h = empreinte(texte);
    expect(credits.deductCredits).toHaveBeenCalledWith(U, c, 'audio-complet', `audio-complet:${h}`);
    expect(json.url).toContain(cheminAudioComplet(U, h));
    expect(cheminAudioComplet(U, h)).toBe(`${U}/voice/audio-complet-${h.slice(0, 24)}.mp3`);
    // Ordre : envoi au stockage avant le débit.
    expect(stockage.uploadBufferToStorage.mock.invocationCallOrder[0]).toBeLessThan(credits.deductCredits.mock.invocationCallOrder[0]);
  });

  it('⚠️ administrateur : aucun appel de débit, 0 crédit — le fournisseur est quand même appelé une fois', async () => {
    etat.exempt = true;
    const res = await post(POST, { texte: texteDe(2500) });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.creditsDebites).toBe(0);
    expect(credits.deductCredits).not.toHaveBeenCalled();
    expect(credits.getUserCredits).not.toHaveBeenCalled();
    expect(eleven.appels).toHaveLength(1);
  });

  it('⚠️ double clic (deux requêtes concurrentes) : une seule synthèse, un seul débit, même résultat', async () => {
    let liberer: () => void = () => {};
    eleven.retard = new Promise<void>((r) => { liberer = r; });
    const texte = 'Bienvenue au cours Afroboost à Neuchâtel.';
    const p1 = post(POST, { texte });
    const p2 = post(POST, { texte });
    await new Promise((r) => setTimeout(r, 20));
    liberer();
    const [r1, r2] = await Promise.all([p1, p2]);
    const [j1, j2] = await Promise.all([r1.json(), r2.json()]);
    expect(r1.status).toBe(200); expect(r2.status).toBe(200);
    expect(j1.url).toBe(j2.url);
    expect(eleven.appels).toHaveLength(1);
    expect(credits.deductCredits.mock.calls.length).toBeLessThanOrEqual(1);
    expect(stockage.uploadBufferToStorage).toHaveBeenCalledTimes(1);
  });

  it('⚠️ rejeu après succès (rafraîchissement) : objet déjà là → ni synthèse, ni débit', async () => {
    const texte = texteDe(1500);
    await post(POST, { texte });
    credits.deductCredits.mockClear(); eleven.appels.length = 0; stockage.uploadBufferToStorage.mockClear();
    const res = await post(POST, { texte });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ success: true, creditsDebites: 0, dejaGenere: true });
    expect(json.url).toContain(cheminAudioComplet(U, empreinte(texte)));
    expect(eleven.appels).toHaveLength(0);
    expect(credits.deductCredits).not.toHaveBeenCalled();
    expect(stockage.uploadBufferToStorage).not.toHaveBeenCalled();
  });

  it('⚠️ fichier présent mais JAMAIS payé (suppression ratée après un débit refusé) → débité maintenant, sinon pas livré', async () => {
    const texte = texteDe(1500);
    const cle = `audio/${cheminAudioComplet(U, empreinte(texte))}`;
    etat.objets.add(cle);
    etat.debitErreur = 'Insufficient credits';
    const refuse = await post(POST, { texte });
    expect(refuse.status).toBe(402);
    expect(JSON.stringify(await refuse.json())).not.toContain('storage/v1');
    etat.debitErreur = null;
    credits.deductCredits.mockClear();
    const ok = await post(POST, { texte });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ creditsDebites: 2, dejaGenere: true });
    expect(credits.deductCredits).toHaveBeenCalledTimes(1);
    expect(eleven.appels).toHaveLength(0);
  });

  it('déjà payé puis fichier purgé → régénéré SANS second débit', async () => {
    const texte = texteDe(900);
    await post(POST, { texte });
    etat.objets.clear();
    credits.deductCredits.mockClear(); eleven.appels.length = 0;
    const res = await post(POST, { texte });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ creditsDebites: 0, dejaGenere: false });
    expect(eleven.appels).toHaveLength(1);
    expect(credits.deductCredits).not.toHaveBeenCalled();
  });

  it('échec du fournisseur → 502, aucun débit, rien envoyé au stockage', async () => {
    eleven.statut = 500;
    const res = await post(POST, { texte: texteDe(800) });
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe('audio_echec');
    expect(credits.deductCredits).not.toHaveBeenCalled();
    expect(stockage.uploadBufferToStorage).not.toHaveBeenCalled();
  });

  it('sans clé fournisseur → 503, aucun débit', async () => {
    delete process.env.ELEVENLABS_API_KEY;
    const res = await post(POST, { texte: texteDe(800) });
    expect(res.status).toBe(503);
    expect(credits.deductCredits).not.toHaveBeenCalled();
  });

  it('échec de l’envoi au stockage → 503, aucun débit', async () => {
    etat.uploadEchoue = true;
    const res = await post(POST, { texte: texteDe(800) });
    expect(res.status).toBe(503);
    expect(eleven.appels).toHaveLength(1);
    expect(credits.deductCredits).not.toHaveBeenCalled();
  });

  it('⚠️ solde insuffisant au pré-contrôle → 402 avec le coût, AUCUN appel fournisseur', async () => {
    etat.solde = 2;
    const res = await post(POST, { texte: texteDe(2500) });
    const json = await res.json();
    expect(res.status).toBe(402);
    expect(json).toMatchObject({ code: 'credits_insuffisants', cout: 3 });
    expect(eleven.appels).toHaveLength(0);
    expect(credits.deductCredits).not.toHaveBeenCalled();
  });

  it('débit refusé après la synthèse (solde vidé entre-temps) → 402 et l’objet est supprimé', async () => {
    etat.debitErreur = 'Insufficient credits';
    const res = await post(POST, { texte: texteDe(800) });
    expect(res.status).toBe(402);
    expect(stockage.deleteFromStorage).toHaveBeenCalledTimes(1);
    expect(etat.objets.size).toBe(0);
  });

  it('autre erreur de débit → 503 et l’objet est supprimé', async () => {
    etat.debitErreur = 'debit refuse : socle_absent';
    const res = await post(POST, { texte: texteDe(800) });
    expect(res.status).toBe(503);
    expect(etat.objets.size).toBe(0);
  });

  it.each(['cout', 'amount', 'credits', 'cost', 'userId', 'reference'])('⚠️ champ « %s » dans le corps → 422, rien n’est fait', async (champ) => {
    const res = await post(POST, { texte: texteDe(800), [champ]: 0 });
    expect(res.status).toBe(422);
    expect(eleven.appels).toHaveLength(0);
    expect(credits.getUserCredits).not.toHaveBeenCalled();
    expect(credits.deductCredits).not.toHaveBeenCalled();
  });

  it('texte vide → 400 texte_invalide ; trop long → 400 texte_trop_long', async () => {
    const vide = await post(POST, { texte: '   ' });
    expect(vide.status).toBe(400);
    expect((await vide.json()).code).toBe('texte_invalide');
    const long = await post(POST, { texte: texteDe(MAX_CARACTERES_AUDIO_COMPLET + 1) });
    expect(long.status).toBe(400);
    expect((await long.json()).code).toBe('texte_trop_long');
    expect(eleven.appels).toHaveLength(0);
  });

  it('non connecté → 401 ; sans voix → 409', async () => {
    session.courante = null;
    expect((await post(POST, { texte: 'x' })).status).toBe(401);
    session.courante = { user: { id: U } };
    base.voices = [];
    const res = await post(POST, { texte: 'x' });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('aucune_voix');
  });
});

describe('la pré-écoute reste gratuite', () => {
  it('⚠️ /api/voice/ecoute et /api/voice/prononciations/ecoute ne touchent jamais aux crédits', async () => {
    const r1 = await post(ECOUTER, { texte: 'Bonjour Afroboost' });
    const r2 = await post(ECOUTER_PRONONCIATION, { affiche: 'Afroboost' });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(credits.deductCredits).not.toHaveBeenCalled();
    expect(credits.getUserCredits).not.toHaveBeenCalled();
    expect(stockage.uploadBufferToStorage).not.toHaveBeenCalled();
  });
});
