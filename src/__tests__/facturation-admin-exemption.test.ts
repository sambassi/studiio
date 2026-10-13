// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * ADMIN = 0 CRÉDIT STUDIIO (#541) — et jamais de « remboursement » fantôme.
 * Base : AVATAR-2A — `POST /api/avatar/generate` parle avec l'avatar VIVANT, et
 * chaque génération porte la VERSION du clone qui l'a produite.
 *
 * - un avatar supprimé (`deleted_at`) n'est plus « l'avatar du compte » ;
 * - sans `provider_avatar_id`, aucun appel HeyGen (ni statut, ni vidéo),
 *   aucun débit : 409 ;
 * - la génération insérée porte `avatar_version = version` de la ligne.
 */

const U = 'aaaaaaaa-1111-4111-8111-111111111111';

const base = vi.hoisted(() => ({
  avatars: [] as Array<Record<string, unknown>>,
  generations: [] as Array<Record<string, unknown>>,
  settings: [] as Array<Record<string, unknown>>,
}));
const heygen = vi.hoisted(() => ({ appels: [] as string[], args: [] as Array<Record<string, unknown>>, moteursLook: null as string[] | null, retenir: null as null | Promise<void> }));
const credits = vi.hoisted(() => ({ journal: [] as string[] }));
const exemption = vi.hoisted(() => ({ admin: false, echecHeygen: false }));
vi.mock('@/lib/facturation/exemption', () => ({ compteExempteDeCredits: async () => exemption.admin, exempteDeCredits: () => exemption.admin }));

vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => {
    const filtres: Array<(l: Record<string, unknown>) => boolean> = [];
    let insertion: Record<string, unknown> | null = null;
    let patch: Record<string, unknown> | null = null;
    const source = () => (table === 'user_avatars' ? base.avatars : table === 'user_settings' ? base.settings : base.generations);
    const api = {
      select() { return api; },
      insert(v: Record<string, unknown>) { insertion = v; return api; },
      update(p: Record<string, unknown>) { patch = p; return api; },
      eq(k: string, v: unknown) { filtres.push((l) => l[k] === v); return api; },
      is(k: string, v: unknown) { filtres.push((l) => l[k] === v); return api; },
      order() { return api; },
      async limit() { return { data: source().filter((l) => filtres.every((f) => f(l))), error: null }; },
      async single() {
        if (insertion) { const l = { id: `gen-${base.generations.length + 1}`, ...insertion }; base.generations.push(l); return { data: l, error: null }; }
        const rows = source().filter((l) => filtres.every((f) => f(l)));
        return { data: rows[0] ?? null, error: rows[0] ? null : { message: 'no rows' } };
      },
      then(resolve: (v: unknown) => void) {
        const rows = source().filter((l) => filtres.every((f) => f(l)));
        if (patch) for (const l of rows) Object.assign(l, patch);
        resolve({ data: rows, error: null });
      },
    };
    return api;
  };
  return { supabase: {}, supabaseAdmin: { from } };
});

vi.mock('@/lib/avatar/heygen', () => ({
  HeyGenError: class extends Error { httpStatus = 502; code = 'x'; },
  generateAvatarVideo: async (args: { avatarId: string }) => { heygen.appels.push(`videos:${args.avatarId}`); heygen.args.push(args); if (heygen.retenir) await heygen.retenir; if (exemption.echecHeygen) throw new Error('heygen down'); return { videoId: 'vid-1', status: 'processing' }; },
  getAvatarTrainingStatus: async (id: string) => { heygen.appels.push(`looks:${id}`); return { status: 'completed' }; },
  resolveVoiceId: async () => 'voice-1',
  moteursSupportesDuLook: async (id: string) => { heygen.appels.push(`moteurs:${id}`); return heygen.moteursLook; },
}));
vi.mock('@/lib/credits/system', () => ({
  getUserCredits: async () => 1000,
  deductCredits: async (_u: string, n: number) => { credits.journal.push(`debit:${n}`); },
  addCredits: async (_u: string, n: number) => { credits.journal.push(`refund:${n}`); },
}));
vi.mock('@/lib/auth/config', () => ({ auth: async () => ({ user: { id: U } }) }));

const { POST } = await import('@/app/api/avatar/generate/route');

const requete = () =>
  POST(new NextRequest('https://studiio.pro/api/avatar/generate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ script: 'Bonjour à tous.', confirmationCoutFournisseur: true }),
  }));

const avatar = () => ({
  id: '11111111-1111-4111-8111-000000000001', user_id: U, status: 'completed', provider_avatar_id: 'hg-1',
  avatar_type: 'video', consent_at: '2026-09-01T00:00:00Z', version: 4, deleted_at: null, created_at: '2026-09-01T00:00:00Z',
});

beforeEach(() => {
  base.avatars = [avatar()]; base.generations = []; base.settings = []; heygen.appels.length = 0; heygen.args.length = 0; heygen.moteursLook = null; heygen.retenir = null;
  credits.journal.length = 0; exemption.admin = false; exemption.echecHeygen = false;
  delete process.env.AVATAR_MOTEURS_AUTORISES; delete process.env.HEYGEN_AVATAR_ENGINE;
});

describe('POST /api/avatar/generate — administrateur', () => {
  it('⚠️ admin : HeyGen appelé (coût fournisseur réel), AUCUN débit Studiio, credits_charged = 0', async () => {
    exemption.admin = true;
    const res = await requete();
    expect(res.status).toBe(200);
    expect(heygen.appels.some((a) => a.startsWith('videos:'))).toBe(true);
    expect(credits.journal).toEqual([]);
    expect(base.generations[0].credits_charged).toBe(0);
    expect((await res.json()).data.creditsCharged).toBe(0);
  });

  it('⚠️ admin + échec HeyGen : aucun « remboursement » de crédits jamais pris', async () => {
    exemption.admin = true; exemption.echecHeygen = true;
    const res = await requete();
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(credits.journal).toEqual([]);
  });

  it('utilisateur : débit 40 puis remboursement 40 si HeyGen échoue (inchangé)', async () => {
    const ok = await requete();
    expect(ok.status).toBe(200);
    expect(credits.journal).toEqual(['debit:40']);
    expect(base.generations[0].credits_charged).toBe(40);
    credits.journal.length = 0; exemption.echecHeygen = true;
    await requete();
    expect(credits.journal).toEqual(['debit:40', 'refund:40']);
  });
});

describe('#562 — coût fournisseur AVANT l’appel (admin, Mon avatar)', () => {
  const envoyer = (corps: Record<string, unknown>) => POST(new NextRequest('https://studiio.pro/api/avatar/generate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps),
  }));

  it('⚠️ F. sans confirmation : 428 + devis (moteur, durée, coût, source) — 0 appel vidéo, 0 ligne, 0 débit', async () => {
    exemption.admin = true;
    const res = await envoyer({ script: 'Bonjour à tous, voici ma vidéo du jour.', qualite: 'standard' });
    expect(res.status).toBe(428);
    const j = await res.json();
    expect(j.code).toBe('confirmation_cout_fournisseur');
    expect(j.devis).toMatchObject({ operation: 'video_avatar', moteur: 'avatar_iii', moteurImplicite: false, typeAvatar: 'twin', prixConnu: true, creditsStudiio: 0 });
    expect(j.devis.dureeSecondes.min).toBeLessThanOrEqual(j.devis.dureeSecondes.max);
    expect(j.devis.source).toContain('HeyGen');
    expect(heygen.appels.filter((a) => a.startsWith('videos:'))).toEqual([]);
    expect(base.generations).toEqual([]);
    expect(credits.journal).toEqual([]);
  });

  it('⚠️ E. admin : 0 crédit Studiio ET le coût HeyGen du bon moteur (Avatar IV = qualité « qualite »)', async () => {
    exemption.admin = true;
    const j = await (await envoyer({ script: 'Un deux trois quatre cinq six sept huit neuf dix onze douze treize.', qualite: 'qualite' })).json();
    expect(j.devis).toMatchObject({ moteur: 'avatar_iv', creditsStudiio: 0 });
    // 13 mots ≈ 5 s → 4–6 s à 4,83 $/min.
    expect(j.devis.tarifUsdParSeconde).toBeCloseTo(4.83 / 60, 4);
  });

  it('⚠️ G. confirmé → exactement 1 appel vidéo', async () => {
    exemption.admin = true;
    const res = await envoyer({ script: 'Bonjour à tous.', confirmationCoutFournisseur: true });
    expect(res.status).toBe(200);
    expect(heygen.appels.filter((a) => a.startsWith('videos:'))).toHaveLength(1);
  });

  it('⚠️ H. deux requêtes confirmées simultanées (double clic, deux onglets) → 1 seul appel vidéo, l’autre 409', async () => {
    exemption.admin = true;
    let liberer!: () => void;
    heygen.retenir = new Promise<void>((r) => { liberer = r; });
    const premiere = envoyer({ script: 'Bonjour à tous.', confirmationCoutFournisseur: true });
    await new Promise((r) => setTimeout(r, 20));
    const seconde = await envoyer({ script: 'Bonjour à tous.', confirmationCoutFournisseur: true });
    expect(seconde.status).toBe(409);
    expect((await seconde.json()).code).toBe('generation_en_cours');
    liberer();
    expect((await premiere).status).toBe(200);
    expect(heygen.appels.filter((a) => a.startsWith('videos:'))).toHaveLength(1);
    // Le verrou est rendu : une génération suivante repart.
    heygen.retenir = null;
    expect((await envoyer({ script: 'Encore.', confirmationCoutFournisseur: true })).status).toBe(200);
  });

  it('⚠️ aperçu sans qualité choisie : Avatar IV (défaut de Mon avatar) ENVOYÉ explicitement, rien réservé avant confirmation ; jamais de réentraînement', async () => {
    exemption.admin = true;
    base.avatars = [{ ...avatar(), validated_at: null }];
    const refus = await envoyer({ intention: 'apercu' });
    expect(refus.status).toBe(428);
    const j = await refus.json();
    expect(j.devis).toMatchObject({ operation: 'apercu_avatar', moteur: 'avatar_iv', moteurImplicite: false, creditsStudiio: 0 });
    expect(base.generations).toEqual([]);
    const ok = await envoyer({ intention: 'apercu', confirmationCoutFournisseur: true });
    expect(ok.status).toBe(200);
    // Le clone EXISTANT parle : une vidéo, aucune création / aucun entraînement d'avatar.
    expect(heygen.appels.filter((a) => a.startsWith('videos:'))).toEqual(['videos:hg-1']);
    expect(heygen.appels.some((a) => a.startsWith('avatars'))).toBe(false);
  });

  it('utilisateur non admin : aucune confirmation, le parcours d’avant (débit en crédits)', async () => {
    const res = await envoyer({ script: 'Bonjour à tous.' });
    expect(res.status).toBe(200);
  });
});

describe('#562 bis — la QUALITÉ choisie = le moteur envoyé = le devis = la trace', () => {
  const envoyer = (corps: Record<string, unknown>) => POST(new NextRequest('https://studiio.pro/api/avatar/generate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps),
  }));
  const moteurEnvoye = () => (heygen.args[0] as { moteur?: string }).moteur;

  for (const [qualite, moteur] of [['standard', 'avatar_iii'], ['qualite', 'avatar_iv'], ['premium', 'avatar_v']] as const) {
    it(`⚠️ ${qualite} → devis ${moteur}, ${moteur} ENVOYÉ, ${moteur} enregistré sur la génération`, async () => {
      exemption.admin = true;
      heygen.moteursLook = ['avatar_iii', 'avatar_iv', 'avatar_v'];
      const devis = (await (await envoyer({ script: 'Bonjour à tous.', qualite })).json()).devis;
      expect(devis.moteur).toBe(moteur);
      expect(devis.moteurImplicite).toBe(false);
      const res = await envoyer({ script: 'Bonjour à tous.', qualite, confirmationCoutFournisseur: true, moteurConfirme: devis.moteur });
      expect(res.status).toBe(200);
      expect(moteurEnvoye()).toBe(moteur);
      expect(base.generations[0].engine).toBe(moteur);
    });
  }

  it('⚠️ D. confirmé en Avatar IV puis passé en Standard : NOUVEAU devis Avatar III, aucun appel (ni IV ni III)', async () => {
    exemption.admin = true;
    const res = await envoyer({ script: 'Bonjour à tous.', qualite: 'standard', confirmationCoutFournisseur: true, moteurConfirme: 'avatar_iv' });
    expect(res.status).toBe(428);
    expect((await res.json()).devis.moteur).toBe('avatar_iii');
    expect(heygen.appels.filter((a) => a.startsWith('videos:'))).toEqual([]);
    expect(base.generations).toEqual([]);
  });

  it('⚠️ sans qualité dans la requête : la qualité ENREGISTRÉE pour cet avatar est appliquée (Standard → Avatar III)', async () => {
    base.settings = [{ user_id: U, creator_preferences: { qualitesAvatar: { [avatar().id as string]: 'standard' } } }];
    expect((await envoyer({ script: 'Bonjour à tous.' })).status).toBe(200);
    expect(moteurEnvoye()).toBe('avatar_iii');
    expect(base.generations[0].engine).toBe('avatar_iii');
  });

  it('aucune qualité nulle part : défaut de Mon avatar, ENVOYÉ explicitement (jamais un défaut HeyGen implicite)', async () => {
    expect((await envoyer({ script: 'Bonjour à tous.' })).status).toBe(200);
    expect(moteurEnvoye()).toBe('avatar_iv');
  });

  it('⚠️ aperçu : moteur de la qualité choisie, envoyé et enregistré', async () => {
    exemption.admin = true;
    base.avatars = [{ ...avatar(), validated_at: null }];
    const res = await envoyer({ intention: 'apercu', qualite: 'standard', confirmationCoutFournisseur: true, moteurConfirme: 'avatar_iii' });
    expect(res.status).toBe(200);
    expect(moteurEnvoye()).toBe('avatar_iii');
    expect(base.generations[0].engine).toBe('avatar_iii');
  });
});
