// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

/**
 * COHÉRENCE DES PRIX — AFFICHÉ == SERVEUR == DÉBITÉ, pour CHAQUE opération payante.
 *
 * Une seule grille, écrite par le VRAI chemin admin (`ecrireTarifs`), où
 * chaque clé porte une valeur DISTINCTE et différente de son repli : une
 * constante égarée (10, 15, 25, 40, 5…) ou une clé croisée se verrait
 * immédiatement.
 *
 * Pour chaque opération :
 *   (1) AFFICHÉ  — `GET /api/tarifs` (ce que lisent les écrans, via le VRAI
 *       `chargerTarifsEcran`) et les fonctions d'écran pures ;
 *   (2) SERVEUR / DÉBITÉ — la route ou la fonction serveur réelle, dont le
 *       débit arrive à une RPC SQL simulée (`debiter_credits` lit
 *       `tarifs_rendu`, `debiter_credits_operation` reçoit le montant,
 *       `confirmer_rendu` débite le `cout` figé) ;
 *   (3) ADMIN — prix public toujours rendu (`exempte: true`), AUCUN débit.
 *
 * Réels : `lib/tarifs/serveur` (cache, lecture tarifs_rendu + app_settings),
 * `lib/credits/system`, `lib/credits/atomique`, `lib/facturation/*`, les
 * routes. Doublés : la base (mémoire), la session, HeyGen, Replicate,
 * ElevenLabs (`fetch`), le stockage, le rendu Remotion de l'Autopilote.
 * Aucun fournisseur réel, aucune base réelle.
 */

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const AV = '11111111-1111-4111-8111-000000000001';
const VX = '44444444-4444-4444-8444-000000000001';
type Ligne = Record<string, unknown>;

// ─────────────────────────────────────────────────────────────────────────
// Base en mémoire + RPC SQL simulées
// ─────────────────────────────────────────────────────────────────────────

const base = vi.hoisted(() => ({
  tables: {} as Record<string, Ligne[]>,
  compteur: 0,
  rpcs: [] as Array<{ nom: string; args: Record<string, unknown>; debite: number }>,
}));

vi.mock('@/lib/db/supabase', () => {
  const t = (n: string) => (base.tables[n] ??= []);
  const nouvelId = () => `99999999-9999-4999-8999-${String(++base.compteur).padStart(12, '0')}`;

  const from = (table: string) => {
    const filtres: Array<(l: Ligne) => boolean> = [];
    let colonnes: string[] | null = null;
    let op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
    let valeurs: Ligne[] = [];
    let patch: Ligne | null = null;
    let tri: { col: string; asc: boolean } | null = null;
    let limite: number | undefined;
    const projeter = (l: Ligne) => (colonnes ? Object.fromEntries(colonnes.map((c) => [c, l[c]])) : { ...l });
    const exec = (): { data: unknown; error: unknown } => {
      const source = t(table);
      if (op === 'insert') {
        const out = valeurs.map((v) => ({ id: nouvelId(), created_at: new Date(Date.now() + base.compteur).toISOString(), ...structuredClone(v) }));
        source.push(...out);
        return { data: out.map(projeter), error: null };
      }
      if (op === 'upsert') {
        for (const v of valeurs) {
          const i = source.findIndex((l) => (v.key !== undefined ? l.key === v.key : l.id === v.id));
          if (i >= 0) source[i] = { ...source[i], ...structuredClone(v) }; else source.push(structuredClone(v));
        }
        return { data: null, error: null };
      }
      let rows = source.filter((l) => filtres.every((f) => f(l)));
      if (op === 'update') { for (const l of rows) Object.assign(l, structuredClone(patch)); return { data: rows.map(projeter), error: null }; }
      if (op === 'delete') { base.tables[table] = source.filter((l) => !rows.includes(l)); return { data: null, error: null }; }
      if (tri) { const { col, asc } = tri; rows = [...rows].sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (asc ? 1 : -1)); }
      if (limite !== undefined) rows = rows.slice(0, limite);
      return { data: rows.map(projeter), error: null };
    };
    const api = {
      select(c?: string) { if (c && c !== '*') colonnes = c.split(',').map((x) => x.trim()); return api; },
      insert(v: Ligne | Ligne[]) { op = 'insert'; valeurs = Array.isArray(v) ? v : [v]; return api; },
      upsert(v: Ligne | Ligne[]) { op = 'upsert'; valeurs = Array.isArray(v) ? v : [v]; return api; },
      update(p: Ligne) { op = 'update'; patch = p; return api; },
      delete() { op = 'delete'; return api; },
      eq(k: string, v: unknown) { filtres.push((l) => l[k] === v); return api; },
      neq(k: string, v: unknown) { filtres.push((l) => l[k] !== v); return api; },
      is(k: string, v: unknown) { filtres.push((l) => (l[k] ?? null) === v); return api; },
      in(k: string, vs: unknown[]) { filtres.push((l) => vs.includes(l[k])); return api; },
      gte() { return api; }, lte() { return api; }, not() { return api; },
      order(col: string, o?: { ascending?: boolean }) { tri = { col, asc: o?.ascending !== false }; return api; },
      limit(n: number) { limite = n; return api; },
      async single() { const r = exec(); const rows = (r.data ?? []) as unknown[]; return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: 'no rows', code: 'PGRST116' } }; },
      async maybeSingle() { const r = exec(); const rows = (r.data ?? []) as unknown[]; return { data: rows[0] ?? null, error: null }; },
      then(ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) { return Promise.resolve().then(exec).then(ok, ko); },
    };
    return api;
  };

  /** Débit relatif, idempotent par (user_id, reference_id) — comme les fonctions SQL. */
  const debiter = (nom: string, args: Record<string, unknown>, userId: string, montant: number, reference: string) => {
    const user = t('users').find((u) => u.id === userId);
    if (!user) return { ok: false, solde: 0, deja_debite: false, motif: 'utilisateur_inconnu' };
    if (t('credit_transactions').some((x) => x.user_id === userId && x.reference_id === reference)) {
      base.rpcs.push({ nom, args, debite: 0 });
      return { ok: true, solde: user.credits, deja_debite: true, motif: null };
    }
    if (!Number.isInteger(montant) || montant <= 0) return { ok: false, solde: user.credits, deja_debite: false, motif: 'montant_invalide' };
    if ((user.credits as number) < montant) return { ok: false, solde: user.credits, deja_debite: false, motif: 'solde_insuffisant' };
    user.credits = (user.credits as number) - montant;
    t('credit_transactions').push({ id: nouvelId(), user_id: userId, reference_id: reference, amount: -montant, type: 'render' });
    base.rpcs.push({ nom, args, debite: montant });
    return { ok: true, solde: user.credits, deja_debite: false, motif: null };
  };

  const rpc = async (nom: string, args: Record<string, unknown>) => {
    if (nom === 'debiter_credits') {
      // La fonction SQL lit SON prix dans `tarifs_rendu` — aucun montant ne traverse.
      const prix = t('tarifs_rendu').find((l) => l.format === args.p_format)?.credits as number | undefined;
      if (prix === undefined) return { data: [{ ok: false, solde: 0, deja_debite: false, motif: 'format_inconnu' }], error: null };
      return { data: [debiter(nom, args, String(args.p_user_id), prix, String(args.p_reference))], error: null };
    }
    if (nom === 'debiter_credits_operation') {
      return { data: [debiter(nom, args, String(args.p_user_id), Number(args.p_montant), String(args.p_reference))], error: null };
    }
    if (nom === 'confirmer_rendu') {
      // Débite le `cout` FIGÉ sur la tentative (lu dans tarifs_rendu à la réservation).
      const r = t('rendus').find((l) => l.id === args.p_rendu_id && l.user_id === args.p_user_id);
      if (!r) return { data: [{ ok: false, etat: null, solde: 0, deja_confirme: false, motif: 'introuvable' }], error: null };
      const d = debiter(nom, args, String(args.p_user_id), r.cout as number, `rendu:${r.id}`);
      if (d.ok) r.etat = 'confirme';
      return { data: [{ ok: d.ok, etat: r.etat ?? null, solde: d.solde, deja_confirme: d.deja_debite, motif: d.motif }], error: null };
    }
    return { data: null, error: { code: '42883', message: `function ${nom} does not exist` } };
  };

  const storage = {
    from: (bucket: string) => ({
      getPublicUrl: (p: string) => ({ data: { publicUrl: `https://studiio.pro/storage/v1/object/public/${bucket}/${p}` } }),
      upload: async () => ({ data: {}, error: null }),
      remove: async () => ({ data: null, error: null }),
    }),
  };
  const client = { from, rpc, storage };
  return { supabase: client, supabaseAdmin: client };
});

vi.mock('@/lib/auth/config', () => ({ auth: async () => ({ user: { id: 'aaaaaaaa-1111-4111-8111-111111111111' } }) }));
vi.mock('@/lib/service-alerts', () => ({ detectAndReportServiceError: vi.fn(), reportServiceAlert: vi.fn() }));

// ── Fournisseurs ─────────────────────────────────────────────────────────
const heygen = vi.hoisted(() => ({ args: [] as Array<Record<string, unknown>>, audio: [] as Array<Record<string, unknown>> }));
vi.mock('@/lib/avatar/heygen', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  generateAvatarVideo: async (a: Record<string, unknown>) => { heygen.args.push(a); return { videoId: 'vid-1', status: 'processing' }; },
  generateAvatarVideoFromAudio: async (a: Record<string, unknown>) => { heygen.audio.push(a); return { videoId: 'vid-jumeau', status: 'waiting' }; },
  uploadAsset: async () => ({ assetId: 'asset-1' }),
  getAvatarTrainingStatus: async () => ({ status: 'completed' }),
  resolveVoiceId: async () => 'voice-1',
  // Confirmation HeyGen d'Avatar V pour ce look (lecture doublée, jamais réseau).
  moteursSupportesDuLook: async () => ['avatar_iii', 'avatar_iv', 'avatar_v'],
}));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const replicate = vi.hoisted(() => ({ runs: 0 }));
vi.mock('replicate', () => ({
  default: class {
    run = async (modele: string, o: { input: Record<string, unknown> }) => {
      replicate.runs += 1;
      if (/ocr|text-extract|florence|easyocr/i.test(modele)) return 'Texte lu sur l image';
      // Affiche IA (flux) : des octets PNG ; retouches : une URL de sortie.
      if (typeof o?.input?.num_outputs === 'number' || o?.input?.output_format === 'webp') return [{ blob: async () => new Blob([PNG]) }];
      return 'https://replicate.delivery/sortie.png';
    };
  },
}));

const stockage = vi.hoisted(() => ({ objets: new Set<string>() }));
vi.mock('@/lib/storage/upload', () => ({
  uploadBufferToStorage: vi.fn(async (o: { bucket: string; storagePath: string }) => { stockage.objets.add(`${o.bucket}/${o.storagePath}`); return `https://studiio.pro/storage/v1/object/public/${o.bucket}/${o.storagePath}`; }),
  deleteFromStorage: vi.fn(async (b: string, p: string) => { stockage.objets.delete(`${b}/${p}`); }),
  uploadToStorage: vi.fn(), uploadFileToStorage: vi.fn(), getSignedUrl: vi.fn(),
}));
vi.mock('@/lib/storage/minio-client', () => ({
  clientMinio: () => ({
    statObject: async (b: string, c: string) => {
      if (!stockage.objets.has(`${b}/${c}`)) throw new Error('Not Found');
      return { size: 1234, metaData: { 'content-type': 'audio/mpeg' } };
    },
  }),
  signeurPublic: () => null,
}));

// ── Autopilote : rendu Remotion, affiche, référence IA doublés ─────────────
vi.mock('@/lib/autopilot/render', () => ({
  renderAndUpload: async () => ({ videoUrl: 'https://cdn.test/rendu.mp4', thumbnailUrl: 'https://cdn.test/v.jpg', durationFrames: 900 }),
}));
vi.mock('@/lib/autopilot/poster', () => ({
  rushEncorePresent: async () => true,
  probeRushSeconds: async () => 6,
  pickPosterUrl: async () => 'https://pexels.test/stock.jpg',
  pickCustomPoster: (urls: string[]) => urls[0] ?? null,
}));
vi.mock('@/lib/ai/affiche-reference', () => ({
  genererAfficheReference: async () => ({ ok: true, url: 'https://minio.test/u/autopilote-affiche/job.webp' }),
}));

// ── Réseau : /api/tarifs (route RÉELLE) pour le chargeur d'écran, ElevenLabs ──
const routes = vi.hoisted(() => ({ tarifs: null as null | (() => Promise<Response>) }));
globalThis.fetch = vi.fn(async (url: unknown) => {
  const u = String(url);
  if (u === '/api/tarifs' && routes.tarifs) return routes.tarifs();
  if (u.startsWith('https://api.elevenlabs.io/v1/text-to-speech/')) {
    return new Response(Buffer.from('AUDIO-MP3'), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
  }
  throw new Error(`fetch inattendu ${u}`);
}) as unknown as typeof fetch;

process.env.REPLICATE_API_TOKEN = 'r8_test';
process.env.ELEVENLABS_API_KEY = 'cle-eleven-test';
process.env.HEYGEN_API_KEY = 'cle-heygen-test';
process.env.JUMEAU_MOTEUR_ACTIVE = '1';
process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';

const { CLE_ACTION_IA, TARIFS_DEFAUT, CLES_TARIF } = await import('@/lib/tarifs/catalogue');
const { ecrireTarifs, reinitialiserTarifs, prixDe } = await import('@/lib/tarifs/serveur');
const { chargerTarifsEcran, reinitialiserTarifsEcran, libellePrix } = await import('@/lib/tarifs/client');
const { GET: TARIFS } = await import('@/app/api/tarifs/route');
const { GET: TARIFS_RENDU } = await import('@/app/api/render/tarifs/route');
const { POST: DEDUCT } = await import('@/app/api/credits/deduct/route');
const { POST: RENDER } = await import('@/app/api/render/route');
const { POST: IA } = await import('@/app/api/ai/image/route');
const { POST: AVATAR } = await import('@/app/api/avatar/generate/route');
const { POST: AUDIO } = await import('@/app/api/voice/audio-complet/route');
const { GET: DEVIS_AUTOPILOTE } = await import('@/app/api/autopilot/produire-maintenant/route');
const { coutRenduVideo } = await import('@/lib/credits/system');
const { reserverRendu, confirmerRendu } = await import('@/lib/rendus/service');
const { genererVideoJumeau } = await import('@/lib/avatar/moteur-jumeau');
const { produireUnMontage, coutMontage, coutAfficheReference } = await import('@/lib/autopilot/produire');
const { preparePosts } = await import('@/lib/autopilot/engine');
const { DEFAULT_CONFIG } = await import('@/lib/autopilot/rules');
const { reinitialiserAudioComplet } = await import('@/lib/voice/audio-complet-serveur');
const { coutAudioComplet, libelleBoutonAudioComplet, explicationTarifAudioComplet } = await import('@/lib/voice/audio-complet');
const { cleTarifEcranMonAvatar, libelleBoutonGenererAvatar } = await import('@/lib/avatar/prix');
const { prixOutilIa } = await import('@/components/creer/AiImageTools');
const { tarifsAffichables } = await import('@/lib/facturation/annonce');

// ─────────────────────────────────────────────────────────────────────────
// LA GRILLE : chaque clé distincte, chacune différente de son repli.
// ─────────────────────────────────────────────────────────────────────────
const G = {
  'render.reel': 11,
  'render.tv': 17,
  'render.infographic': 27,
  'avatar.avatar_iii': 12,
  'avatar.avatar_iv': 26,
  'avatar.avatar_v': 41,
  'avatar.jumeau': 43,
  'audio.full_1000_chars': 3,
  'ai.ocr': 2,
  'ai.image_to_video': 19,
  'ai.remove_background': 4,
  'ai.magic_eraser': 6,
  'ai.magic_edit': 7,
  'ai.upscale': 8,
  'ai.generate_background': 9,
  'ai.magic_layers': 13,
  'ai.style_transfer': 14,
  'autopilot.poster_reference': 21,
} as const;

const SOLDE = 1000;
const post = (h: (r: NextRequest) => Promise<Response>, body: unknown) =>
  h(new NextRequest('https://studiio.pro/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const solde = () => base.tables.users.find((u) => u.id === U)!.credits as number;
const debits = () => base.rpcs.filter((r) => r.debite > 0).map((r) => r.debite);
const devenirAdmin = () => { base.tables.users.find((u) => u.id === U)!.role = 'admin'; };

/** Ce que l'ÉCRAN voit : le vrai chargeur client sur la vraie route. */
async function prixEcran() {
  reinitialiserTarifsEcran();
  return chargerTarifsEcran();
}

beforeEach(async () => {
  base.compteur = 0;
  base.rpcs = [];
  base.tables = {
    users: [{ id: U, email: 'client@exemple.ch', role: 'user', credits: SOLDE }],
    // Le socle SQL, à ses valeurs d'avant configuration.
    tarifs_rendu: [{ format: 'reel', credits: 10 }, { format: 'tv', credits: 15 }],
    app_settings: [], audit_log: [], credit_transactions: [], avatar_generations: [], rendus: [], scheduled_posts: [],
    user_avatars: [{
      id: AV, user_id: U, status: 'completed', provider: 'heygen', provider_avatar_id: 'hg-1', avatar_type: 'video',
      consent_at: '2026-09-01T00:00:00Z', consent_text: 'x', validated_at: '2026-09-03T00:00:00Z', version: 4, deleted_at: null,
      created_at: '2026-09-01T00:00:00Z', name: 'Moi',
    }],
    user_voices: [{ id: VX, user_id: U, provider: 'elevenlabs', provider_voice_id: 'pvid_0001', name: 'Moi', lang: 'fr', consent_at: '2026-08-01T00:00:00Z', consent_text: 'x', created_at: '2026-08-01T00:00:00Z' }],
    user_settings: [{ user_id: U, creator_preferences: { voixPersonnelle: { userVoiceId: null, prononciations: [] } } }],
  };
  heygen.args.length = 0; heygen.audio.length = 0; replicate.runs = 0; stockage.objets.clear();
  delete process.env.AVATAR_MOTEURS_AUTORISES; delete process.env.HEYGEN_AVATAR_ENGINE;
  reinitialiserAudioComplet();
  reinitialiserTarifs();
  routes.tarifs = () => TARIFS();
  // L'ADMIN enregistre la grille par le vrai chemin d'écriture.
  await ecrireTarifs({ prix: { ...G } }, 'contact.artboost@gmail.com');
  base.rpcs = [];
});

// ─────────────────────────────────────────────────────────────────────────
// 0. La grille elle-même
// ─────────────────────────────────────────────────────────────────────────

describe('La grille de test est discriminante', () => {
  it('couvre TOUTES les clés du catalogue, valeurs distinctes, toutes différentes de leur repli', () => {
    expect(Object.keys(G).sort()).toEqual([...CLES_TARIF].sort());
    expect(new Set(Object.values(G)).size).toBe(Object.keys(G).length);
    for (const [k, v] of Object.entries(G)) expect(v, k).not.toBe(TARIFS_DEFAUT[k as keyof typeof TARIFS_DEFAUT]);
  });

  it('écriture admin : reel/tv vont dans `tarifs_rendu` (la table du débit SQL), le reste dans app_settings', () => {
    expect(base.tables.tarifs_rendu).toEqual([
      expect.objectContaining({ format: 'reel', credits: 11 }),
      expect.objectContaining({ format: 'tv', credits: 17 }),
    ]);
    const prix = (base.tables.app_settings.find((l) => l.key === 'tarifs_credits')!.value as { prix: Record<string, number> }).prix;
    for (const [k, v] of Object.entries(G)) expect(prix[k], k).toBe(v);
  });

  it('`tarifs_rendu` fait foi pour reel/tv même si app_settings diverge', async () => {
    (base.tables.app_settings[0].value as { prix: Record<string, number> }).prix['render.reel'] = 999;
    reinitialiserTarifs();
    expect(await prixDe('render.reel')).toBe(11);
    expect((await prixEcran()).prix['render.reel']).toBe(11);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (1) AFFICHÉ — /api/tarifs et le chargeur d'écran
// ─────────────────────────────────────────────────────────────────────────

describe('(1) Affiché — GET /api/tarifs rend la grille, le chargeur d’écran aussi', () => {
  it('chaque clé : route == chargeur d’écran == grille ; exempte false', async () => {
    const j = await (await TARIFS()).json();
    expect(j.exempte).toBe(false);
    const ecran = await prixEcran();
    expect(ecran.exempte).toBe(false);
    for (const [k, v] of Object.entries(G)) {
      expect(j.prix[k], `route ${k}`).toBe(v);
      expect(ecran.prix[k as keyof typeof G], `écran ${k}`).toBe(v);
    }
  });

  it('administrateur : MÊME prix public, `exempte: true`, libellé « votre coût : 0 »', async () => {
    devenirAdmin();
    const j = await (await TARIFS()).json();
    expect(j.exempte).toBe(true);
    for (const [k, v] of Object.entries(G)) expect(j.prix[k], k).toBe(v);
    const ecran = await prixEcran();
    expect(ecran.exempte).toBe(true);
    expect(libellePrix(ecran, 'avatar.jumeau')).toBe('43 crédits — votre coût Studiio : 0 crédit');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (2)+(3) Opération par opération
// ─────────────────────────────────────────────────────────────────────────

describe('Rendu Reel / TV', () => {
  it.each([['reel', 11], ['tv', 17]] as const)('%s : affiché %i (/api/tarifs, /api/render/tarifs) = coutRenduVideo = débit SQL (POST /api/credits/deduct)', async (format, prix) => {
    expect((await prixEcran()).prix[`render.${format}`]).toBe(prix);
    // L'annonce de l'Assistant lit /api/render/tarifs (même table).
    const annonce = tarifsAffichables((await (await TARIFS_RENDU(new NextRequest('https://studiio.pro/api/render/tarifs'))).json()).tarifs);
    expect(annonce?.[format]).toBe(prix);
    expect(await coutRenduVideo(format)).toBe(prix);

    base.tables.scheduled_posts.push({ id: `post-${format}`, user_id: U, format });
    const res = await post(DEDUCT, { postId: `post-${format}` });
    expect(res.status).toBe(200);
    expect(base.rpcs.map((r) => [r.nom, r.args.p_format])).toEqual([['debiter_credits', format]]);
    expect(debits()).toEqual([prix]);
    expect(solde()).toBe(SOLDE - prix);
  });

  it.each([['reel', 11], ['tv', 17]] as const)('%s : chemin vivant /api/render/jobs — `cout` figé à la réservation = %i = débit à la confirmation', async (format, prix) => {
    const { rendu } = await reserverRendu(U, 'bureau', format);
    expect(rendu?.cout).toBe(prix);
    expect(rendu?.politique).toBe('credits');
    const c = await confirmerRendu(U, rendu!.id, 1234, 'video/webm');
    expect(c.ok).toBe(true);
    expect(debits()).toEqual([prix]);
  });

  it.each([['reel', 'AfroboostReel', 11], ['tv', 'AfroboostTV', 17]] as const)('%s : route historique POST /api/render débite %i', async (format, compositionId, prix) => {
    const res = await post(RENDER, { compositionId, format });
    const j = await res.json();
    expect(j.creditsCharged).toBe(prix);
    expect(solde()).toBe(SOLDE - prix);
    expect(base.tables.credit_transactions.find((x) => x.type === 'render')?.amount).toBe(-prix);
  });

  it('admin : /api/tarifs rend le prix public, /api/credits/deduct n’appelle AUCUNE RPC, la réservation est en frais partenaires', async () => {
    devenirAdmin();
    const j = await (await TARIFS()).json();
    expect([j.prix['render.reel'], j.prix['render.tv'], j.exempte]).toEqual([11, 17, true]);
    base.tables.scheduled_posts.push({ id: 'post-a', user_id: U, format: 'tv' });
    const res = await post(DEDUCT, { postId: 'post-a' });
    expect((await res.json()).politique).toBe('partner_cost_only');
    expect(base.rpcs).toEqual([]);
    expect((await reserverRendu(U, 'bureau', 'reel')).rendu?.politique).toBe('partner_cost_only');
    expect(solde()).toBe(SOLDE);
  });

  // Corrigé : la route historique /api/render applique la même exemption
  // administrateur que tous les parcours (aucun écran ne l'appelle encore).
  it('admin : POST /api/render (historique) ne débite rien', async () => {
    devenirAdmin();
    const res = await post(RENDER, { compositionId: 'AfroboostReel', format: 'reel' });
    expect(res.status).toBe(200);
    expect(solde()).toBe(SOLDE);
  });
});

describe('Rendu infographique', () => {
  it('affiché 27 (/api/tarifs) = coutRenduVideo(infographic) = débit de POST /api/render (InfographicReel / InfographicTV)', async () => {
    expect((await prixEcran()).prix['render.infographic']).toBe(27);
    expect(await coutRenduVideo('infographic')).toBe(27);
    for (const [compositionId, format] of [['InfographicReel', 'reel'], ['InfographicTV', 'tv']] as const) {
      const avant = solde();
      const j = await (await post(RENDER, { compositionId, format })).json();
      expect(j.creditsCharged, compositionId).toBe(27);
      expect(avant - solde(), compositionId).toBe(27);
    }
  });
});

describe('Avatar III / IV / V — POST /api/avatar/generate', () => {
  it.each([
    ['standard', 'avatar_iii', 12],
    ['qualite', 'avatar_iv', 26],
    ['premium', 'avatar_v', 41],
    [undefined, undefined, 26],
  ] as const)('qualité %s → moteur %s : affiché = 402 = débit = credits_charged = %i', async (qualite, moteur, prix) => {
    const ecran = await prixEcran();
    const cle = cleTarifEcranMonAvatar({ viaVoixClonee: false, ...(qualite ? { qualiteEnvoyee: qualite } : {}) });
    expect(ecran.prix[cle]).toBe(prix);
    expect(libelleBoutonGenererAvatar(ecran.prix[cle], ecran.exempte)).toBe(`Générer la vidéo (${prix} crédits)`);

    // 402 : le montant exigé est le même.
    base.tables.users[0].credits = prix - 1;
    const refus = await post(AVATAR, { script: 'Bonjour à tous.', ...(qualite ? { qualite } : {}) });
    expect(refus.status).toBe(402);
    expect((await refus.json()).error).toContain(`Requis : ${prix}`);
    expect(base.rpcs).toEqual([]);

    base.tables.users[0].credits = SOLDE;
    const res = await post(AVATAR, { script: 'Bonjour à tous.', ...(qualite ? { qualite } : {}) });
    expect(res.status).toBe(200);
    expect(heygen.args.at(-1)!.moteur).toBe(moteur);
    expect(debits()).toEqual([prix]);
    expect(base.rpcs[0].nom).toBe('debiter_credits_operation');
    expect(base.tables.avatar_generations.at(-1)!.credits_charged).toBe(prix);
    expect((await res.json()).data.creditsCharged).toBe(prix);
  });

  it('admin : prix public affiché, aucune RPC, credits_charged 0, pour les trois qualités', async () => {
    devenirAdmin();
    const ecran = await prixEcran();
    expect(libelleBoutonGenererAvatar(ecran.prix['avatar.avatar_v'], ecran.exempte)).toBe('Générer la vidéo — prix public 41 crédits · votre coût : 0');
    for (const qualite of ['standard', 'qualite', 'premium']) {
      const res = await post(AVATAR, { script: 'Bonjour à tous.', qualite });
      expect(res.status, qualite).toBe(200);
      expect((await res.json()).data.creditsCharged, qualite).toBe(0);
    }
    expect(base.rpcs).toEqual([]);
    expect(base.tables.avatar_generations.map((g) => g.credits_charged)).toEqual([0, 0, 0]);
    expect(solde()).toBe(SOLDE);
  });
});

describe('Jumeau — genererVideoJumeau (moteur-jumeau)', () => {
  // Ligne complète (revalidée par `avatarLigneValide`), avatar PHOTO : pas de
  // garde « jumeau vidéo réservé à l'admin », le prix seul est en jeu.
  beforeEach(() => {
    Object.assign(base.tables.user_avatars[0], {
      avatar_type: 'photo', provider_asset_id: 'as-1', source_object_key: `${U}/avatar/source-1-${'a'.repeat(32)}.mp4`,
      source_url: null, subject_type: 'self', consent_version: 'x', training_error: null,
    });
  });

  it('affiché 43 (écran Mon avatar voix clonée / Assistant) = débit 43 = credits_charged 43', async () => {
    const ecran = await prixEcran();
    expect(ecran.prix[cleTarifEcranMonAvatar({ viaVoixClonee: true, qualiteEnvoyee: 'premium' })]).toBe(43);
    const r = await genererVideoJumeau({ userId: U, textes: ['Bienvenue chez nous.'], aspectRatio: '9:16' });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    expect(heygen.audio).toHaveLength(1);
    expect(base.rpcs.map((x) => [x.nom, x.debite])).toEqual([['debiter_credits_operation', 43]]);
    expect(base.tables.avatar_generations.at(-1)!.credits_charged).toBe(43);
    expect(solde()).toBe(SOLDE - 43);
  });

  it('solde insuffisant : refus annoncé sur 43, aucun débit', async () => {
    base.tables.users[0].credits = 42;
    const r = await genererVideoJumeau({ userId: U, textes: ['Bienvenue chez nous.'], aspectRatio: '9:16' });
    expect(r.ok).toBe(false);
    expect(base.rpcs).toEqual([]);
  });

  it('admin : prix public 43 affiché, aucune RPC, credits_charged 0', async () => {
    devenirAdmin();
    expect((await prixEcran()).prix['avatar.jumeau']).toBe(43);
    const r = await genererVideoJumeau({ userId: U, textes: ['Bienvenue chez nous.'], aspectRatio: '9:16' });
    expect(r.ok).toBe(true);
    expect(base.rpcs).toEqual([]);
    expect(base.tables.avatar_generations.at(-1)!.credits_charged).toBe(0);
    expect(solde()).toBe(SOLDE);
  });
});

describe('Audio complet — POST /api/voice/audio-complet', () => {
  it('2500 caractères = 3 tranches × 3 = 9 : libellé écran = réponse `cout` = débit', async () => {
    const ecran = await prixEcran();
    const parTranche = ecran.prix['audio.full_1000_chars'];
    expect(parTranche).toBe(3);
    expect(coutAudioComplet(2500, parTranche)).toBe(9);
    expect(libelleBoutonAudioComplet(2500, false, parTranche)).toBe('Générer l’audio complet — 9 crédits');
    expect(explicationTarifAudioComplet(parTranche)).toContain('3 crédits par tranche de 1000 caractères');

    const res = await post(AUDIO, { texte: 'a'.repeat(2500) });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect([j.cout, j.creditsDebites]).toEqual([9, 9]);
    expect(base.rpcs.map((x) => [x.nom, x.debite])).toEqual([['debiter_credits_operation', 9]]);
    expect(solde()).toBe(SOLDE - 9);
  });

  it('admin : aucune RPC, libellé administrateur', async () => {
    devenirAdmin();
    const ecran = await prixEcran();
    expect(ecran.prix['audio.full_1000_chars']).toBe(3);
    expect(libelleBoutonAudioComplet(2500, ecran.exempte, 3)).toBe('Générer l’audio complet — 0 crédit (administrateur)');
    const res = await post(AUDIO, { texte: 'a'.repeat(2500) });
    expect(res.status).toBe(200);
    expect((await res.json()).creditsDebites).toBe(0);
    expect(base.rpcs).toEqual([]);
    expect(solde()).toBe(SOLDE);
  });
});

describe('IA image — POST /api/ai/image (9 actions)', () => {
  const corps = (action: string) => ({
    action, imageUrl: 'https://cdn.test/a.png', prompt: 'un fond', style: 'aquarelle',
  });
  const ACTIONS = Object.keys(CLE_ACTION_IA);

  it.each(ACTIONS)('%s : prixOutilIa(écran) = 402 creditsNeeded = débit = creditsUsed', async (action) => {
    const cle = CLE_ACTION_IA[action];
    const prix = G[cle as keyof typeof G];
    const ecran = await prixEcran();
    expect(prixOutilIa(ecran.prix, action as Parameters<typeof prixOutilIa>[1])).toBe(prix);

    base.tables.users[0].credits = prix - 1;
    const refus = await post(IA, corps(action));
    expect(refus.status).toBe(402);
    expect((await refus.json()).creditsNeeded).toBe(prix);
    expect(replicate.runs).toBe(0);

    base.tables.users[0].credits = SOLDE;
    const res = await post(IA, corps(action));
    const j = await res.json();
    expect(res.status, JSON.stringify(j)).toBe(200);
    expect(j.creditsUsed).toBe(prix);
    expect(base.rpcs.map((x) => [x.nom, x.debite])).toEqual([['debiter_credits_operation', prix]]);
    expect(solde()).toBe(SOLDE - prix);
  });

  it('admin : prix public affiché, aucune RPC pour les 9 actions', async () => {
    devenirAdmin();
    const ecran = await prixEcran();
    for (const action of ACTIONS) {
      expect(prixOutilIa(ecran.prix, action as Parameters<typeof prixOutilIa>[1]), action).toBe(G[CLE_ACTION_IA[action] as keyof typeof G]);
      const res = await post(IA, corps(action));
      expect(res.status, action).toBe(200);
    }
    expect(base.rpcs).toEqual([]);
    expect(solde()).toBe(SOLDE);
  });
});

describe('Autopilote — montage (render.reel) + affiche de référence', () => {
  const config = () => ({
    ...DEFAULT_CONFIG, enabled: true, platforms: ['instagram'], rushUrls: [], voiceEnabled: false,
    posterMode: 'reference', posterUrls: ['https://cdn.test/ma-photo.jpg'],
  }) as typeof DEFAULT_CONFIG;
  const T0 = Date.parse('2026-08-05T09:00:00.000Z');
  const produire = () => {
    const c = config();
    const p = preparePosts({ config: c, topic: 'routine du matin', count: 1, now: T0 })[0];
    return produireUnMontage({ userId: U, config: c, post: p, rang: 0, now: T0, jobId: 'job-1' });
  };

  it('sans configuration enregistrée (mode automatique) : devis = coutMontage = 11 ; affiche de référence = 21 ; débits 11 puis 21', async () => {
    const devis = await (await DEVIS_AUTOPILOTE()).json();
    expect(devis.cout).toBe(11);
    expect((await prixEcran()).prix['autopilot.poster_reference']).toBe(21);
    expect(await coutMontage()).toBe(11);
    expect(await coutAfficheReference()).toBe(21);

    const r = await produire();
    expect(r.debite).toBe(true);
    expect(base.rpcs.map((x) => [x.nom, x.args.p_reference, x.debite])).toEqual([
      ['debiter_credits_operation', 'autopilote:job-1', 11],
      ['debiter_credits_operation', 'autopilote-affiche:job-1', 21],
    ]);
    expect(solde()).toBe(SOLDE - 32);
  });

  it('⚠️ mode « référence » actif : le devis inclut l’affiche — devis 32 = débit 11 + 21', async () => {
    base.tables.autopilot_config = [{ user_id: U, enabled: true, poster_mode: 'reference', poster_urls: ['https://cdn.test/ma-photo.jpg'], rush_urls: ['https://cdn.test/r.mp4'] }];
    const devis = await (await DEVIS_AUTOPILOTE()).json();
    expect(devis.cout).toBe(32);
    await produire();
    expect(base.rpcs.reduce((n, x) => n + Number(x.debite), 0)).toBe(32);
  });

  it('admin : devis en frais partenaires, aucune RPC', async () => {
    devenirAdmin();
    const devis = await (await DEVIS_AUTOPILOTE()).json();
    expect(devis.politique).toBe('partner_cost_only');
    await produire();
    expect(base.rpcs).toEqual([]);
    expect(solde()).toBe(SOLDE);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// (4) Garde « grep » : plus de prix codé utilisé pour facturer
// ─────────────────────────────────────────────────────────────────────────

const SRC = path.resolve(__dirname, '..');
function fichiers(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return n === '__tests__' ? [] : fichiers(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}
const SOURCES = fichiers(SRC).map((p) => ({ p: path.relative(path.resolve(SRC, '..'), p), texte: readFileSync(p, 'utf8') }));
const occurrences = (motif: RegExp) => SOURCES.flatMap(({ p, texte }) =>
  texte.split('\n').flatMap((l, i) => (motif.test(l) ? [`${p}:${i + 1}`] : [])));

describe('(4) Garde — constantes de prix restantes', () => {
  it('AI_CREDITS, `isInfographic ? 25`, COST_AFFICHE_REFERENCE : disparus', () => {
    expect(occurrences(/\bAI_CREDITS\b/)).toEqual([]);
    expect(occurrences(/isInfographic\s*\?\s*25/)).toEqual([]);
    expect(occurrences(/\bCOST_AFFICHE_REFERENCE\b/)).toEqual([]);
  });

  it('AVATAR_VIDEO_COST : seulement sa définition (constants.ts), aucun usage', () => {
    expect(occurrences(/\bAVATAR_VIDEO_COST\b/)).toEqual(['src/lib/stripe/constants.ts:124']);
  });

  it('RENDER_COSTS : définition + `getVideoRenderCost` (repli documenté), qui n’a plus aucun appelant', () => {
    expect(occurrences(/\bRENDER_COSTS\b/)).toEqual([
      'src/lib/credits/system.ts:4',
      'src/lib/credits/system.ts:143',
      'src/lib/stripe/constants.ts:110',
    ]);
    expect(occurrences(/\bgetVideoRenderCost\b/)).toEqual(['src/lib/credits/system.ts:142']);
  });

  it('tout débit applicatif passe un montant lu dans la grille, jamais un littéral', () => {
    const appels = occurrences(/\b(deductCredits|debiterOperationAtomique)\(\s*[^)]/)
      .filter((o) => !o.startsWith('src/lib/credits/'));
    expect(appels.length).toBeGreaterThan(0);
    for (const o of appels) {
      const [p, n] = o.split(':');
      const ligne = SOURCES.find((s) => s.p === p)!.texte.split('\n')[Number(n) - 1];
      expect(ligne, o).not.toMatch(/(deductCredits|debiterOperationAtomique)\([^,]+,\s*\d/);
    }
  });

  // Corrigé : le contrôle de solde de Créer et son message « Crédits
  // insuffisants : N requis » lisent la grille (render.reel / render.tv), plus
  // une constante 10/15 qu'un tarif admin rendrait fausse.
  it('AssistantWizard : le coût du rendu vient de la grille, plus de `COST` codé', () => {
    const w = SOURCES.find((s) => s.p === 'src/app/dashboard/creer/AssistantWizard.tsx')!.texte;
    expect(w).not.toMatch(/const COST = \{/);
    expect(w).not.toMatch(/COST\.(reel|tv)/);
    expect(w).toMatch(/const cost = format === '16:9' \? grilleTarifs\['render\.tv'\] : grilleTarifs\['render\.reel'\];/);
    expect(w).toMatch(/const coutTotal = batchCost\(cost, total\)/);
  });
});
