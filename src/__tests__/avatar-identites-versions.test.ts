// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';

/**
 * PLUSIEURS AVATARS, VERSIONS CANDIDATES, BASCULE EXPLICITE.
 *
 * Incident du 2026-10-09 : changer la source a écrasé l'avatar v3 actif avant
 * que le remplaçant existe. Ces tests verrouillent le nouveau contrat :
 *   - une candidate n'écrit JAMAIS dans l'avatar utilisé ;
 *   - la bascule n'a lieu que sur « Utiliser cette version », atomiquement ;
 *   - l'ancienne version reste en historique et peut revenir ;
 *   - « nouvel avatar » ≠ « remplacer » ;
 *   - Créer et l'Autopilote choisissent une identité LOGIQUE ;
 *   - aucun identifiant fournisseur n'atteint le navigateur.
 *
 * Doublures : une base en mémoire (contraintes uniques + les deux fonctions
 * SQL reproduites à l'identique, testées par ailleurs sur Postgres 16), le
 * fournisseur (dépôt, création, statut) et le stockage.
 */

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRUI = 'bbbbbbbb-2222-4222-8222-222222222222';
const A3 = '76e1011f-0000-4000-8000-000000000003';
const V3 = 'cccccccc-0000-4000-8000-000000000003';
const VOIX = '44444444-4444-4444-8444-000000000001';

type L = Record<string, unknown>;
const base = vi.hoisted(() => ({
  user_avatars: [] as L[], avatar_versions: [] as L[], avatar_generations: [] as L[],
  user_voices: [] as L[], user_settings: [] as L[], n: 0,
}));

vi.mock('@/lib/db/supabase', () => {
  const uuid = () => `dddddddd-0000-4000-8000-${String(++base.n).padStart(12, '0')}`;
  const from = (table: string) => {
    const rows = (base as unknown as Record<string, L[]>)[table];
    if (!rows) throw new Error(`table inattendue ${table}`);
    const f: Array<(l: L) => boolean> = [];
    let op: 'select' | 'insert' | 'update' = 'select';
    let patch: L | null = null; let ins: L | null = null; let cols: string[] | null = null;
    let tri: { k: string; asc: boolean } | null = null; let lim: number | undefined;
    const proj = (l: L) => (cols ? Object.fromEntries(cols.map((c) => [c, l[c]])) : { ...l });
    const exec = (): { data: unknown; error: { code?: string; message: string } | null } => {
      if (op === 'insert') {
        const l = { id: uuid(), created_at: new Date(Date.now() + base.n).toISOString(), ...ins } as L;
        if (table === 'avatar_versions' && rows.some((r) => r.user_avatar_id === l.user_avatar_id && r.version === l.version)) {
          return { data: null, error: { code: '23505', message: 'dup version' } };
        }
        if (table === 'user_avatars' && l.is_default === true && rows.some((r) => r.user_id === l.user_id && r.is_default === true && r.deleted_at == null)) {
          return { data: null, error: { code: '23505', message: 'dup defaut' } };
        }
        rows.push(l);
        return { data: [proj(l)], error: null };
      }
      let r = rows.filter((l) => f.every((x) => x(l)));
      if (op === 'update') { for (const l of r) Object.assign(l, patch); return { data: r.map(proj), error: null }; }
      if (tri) { const { k, asc } = tri; r = [...r].sort((a, b) => (String(a[k]) < String(b[k]) ? -1 : String(a[k]) > String(b[k]) ? 1 : 0) * (asc ? 1 : -1)); }
      if (lim !== undefined) r = r.slice(0, lim);
      return { data: r.map(proj), error: null };
    };
    const api = {
      select(c?: string) { if (c && c !== '*' && op === 'select') cols = c.split(',').map((x) => x.trim()); else if (c && c !== '*') cols = c.split(',').map((x) => x.trim()); return api; },
      insert(v: L) { op = 'insert'; ins = v; return api; },
      update(p: L) { op = 'update'; patch = p; return api; },
      eq(k: string, v: unknown) { f.push((l) => l[k] === v); return api; },
      is(k: string, v: unknown) { f.push((l) => (l[k] ?? null) === v); return api; },
      in(k: string, v: unknown[]) { f.push((l) => v.includes(l[k])); return api; },
      order(k: string, o?: { ascending?: boolean }) { tri = { k, asc: o?.ascending !== false }; return api; },
      limit(n: number) { lim = n; return api; },
      async single() { const r = exec(); if (r.error) return r; const d = r.data as L[]; return d.length === 1 ? { data: d[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'rows' } }; },
      async maybeSingle() { const r = exec(); if (r.error) return r; return { data: (r.data as L[])[0] ?? null, error: null }; },
      then(res: (v: unknown) => void, rej: (e: unknown) => void) { return Promise.resolve().then(exec).then(res, rej); },
    };
    return api;
  };
  // Les deux fonctions SQL de la migration, reproduites à l'identique.
  const rpc = async (nom: string, p: L) => {
    const a = base.user_avatars.find((x) => x.id === p.p_avatar_id && x.user_id === p.p_user_id && x.deleted_at == null);
    if (nom === 'definir_avatar_par_defaut') {
      if (!a) return { data: [{ ok: false, motif: 'introuvable' }], error: null };
      for (const x of base.user_avatars) if (x.user_id === p.p_user_id && x.id !== a.id) x.is_default = false;
      a.is_default = true;
      return { data: [{ ok: true, motif: null }], error: null };
    }
    if (!a) return { data: [{ ok: false, motif: 'introuvable' }], error: null };
    if ((a.active_version_id ?? null) !== (p.p_active_attendue ?? null)) return { data: [{ ok: false, motif: 'concurrent' }], error: null };
    const v = base.avatar_versions.find((x) => x.id === p.p_version_id && x.user_avatar_id === a.id && x.user_id === p.p_user_id && x.abandoned_at == null);
    if (!v) return { data: [{ ok: false, motif: 'version_introuvable' }], error: null };
    if (!v.provider_avatar_id || !v.validated_at || !['completed', 'ready', 'success'].includes(String(v.status))) return { data: [{ ok: false, motif: 'version_non_prete' }], error: null };
    Object.assign(a, {
      active_version_id: v.id, version: v.version, status: v.status, provider: v.provider, avatar_type: v.avatar_type,
      provider_avatar_id: v.provider_avatar_id, provider_asset_id: v.provider_asset_id, source_object_key: v.source_object_key,
      source_url: null, training_error: null, validated_at: v.validated_at,
    });
    v.activated_at = new Date().toISOString();
    return { data: [{ ok: true, motif: null }], error: null };
  };
  return { supabase: {}, supabaseAdmin: { from, rpc, storage: { from: () => ({ upload: async (k: string) => ({ data: { path: k }, error: null }), remove: async (k: string[]) => ({ data: k, error: null }) }) } } };
});

const fournisseur = vi.hoisted(() => ({
  appels: [] as string[], refus: null as null | string, statut: 'processing', compteur: 0,
}));
vi.mock('@/lib/avatar/heygen', async (orig) => {
  const reel = await orig<typeof import('@/lib/avatar/heygen')>();
  return {
    ...reel,
    uploadAsset: async () => { fournisseur.appels.push('asset'); return { assetId: `as-${++fournisseur.compteur}` }; },
    createAvatarFromAsset: async (_a: string, _n: string, kind: string, groupe?: string | null) => {
      fournisseur.appels.push(`avatars:${kind}:${groupe ?? 'nouveau-groupe'}`);
      if (fournisseur.refus) throw new reel.HeyGenError('limit of 1 verified avatar group slots', 400, fournisseur.refus);
      return { avatarId: `look-${fournisseur.compteur}`, status: 'processing', avatarGroupId: groupe ?? `grp-${fournisseur.compteur}` };
    },
    getAvatarTrainingStatus: async () => { fournisseur.appels.push('statut'); return { status: fournisseur.statut }; },
  };
});
vi.mock('@/lib/avatar/source', async (orig) => {
  const reel = await orig<typeof import('@/lib/avatar/source')>();
  const { Readable } = await import('node:stream');
  return {
    ...reel,
    ouvrirSourceAvatar: async (userId: string, cle: unknown) => (reel.cleSourceAvatarDuCompte(cle, userId) ? { flux: Readable.from([Buffer.from('mp4')]), type: 'video/mp4', taille: 3 } : null),
    sourceAvatarPresente: async (userId: string, cle: unknown) => reel.cleSourceAvatarDuCompte(cle, userId),
  };
});
const session = vi.hoisted(() => ({ courante: null as unknown }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => session.courante }));

process.env.AUTH_SECRET = 'secret-de-test-identites-versions';
process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';

const versions = await import('@/lib/avatar/versions');
const { executerActionVersion } = await import('@/lib/avatar/actions-version');
const { lancerVersionCandidate } = await import('@/lib/avatar/remplacement');
const { resoudreJumeauDuCompte } = await import('@/lib/avatar/jumeau');
const { jetonOuvertureApercu } = await import('@/lib/avatar/apercu');
const { moteurPourGeneration, qualitesDisponibles, moteursAutorises } = await import('@/lib/avatar/moteurs');
const listeRoute = await import('@/app/api/avatars/route');
const defautRoute = await import('@/app/api/avatars/defaut/route');
const versionRoute = await import('@/app/api/avatars/versions/[versionId]/route');
const createRoute = await import('@/app/api/avatar/create/route');
const { sanitizeConfig } = await import('@/lib/autopilot/rules');

const VIDE = {} as unknown as NodeJS.ProcessEnv;
const cle = (u: string, n: string) => `${u}/avatar/source-${'1'.repeat(13)}-${n.repeat(32).slice(0, 32)}.mp4`;
const CONSENT = { consent_text: 'x', consent_version: 'enrolement-2026-10-06', consent_at: '2026-10-09T00:00:00Z', subject_type: 'self' };

/** L'état de production restauré le 2026-10-09 : « Bassi principal », v3 active. */
function v3Restaure() {
  base.user_avatars.push({
    id: A3, user_id: U, name: 'Bassi principal', provider: 'heygen', avatar_type: 'video', status: 'completed',
    provider_avatar_id: 'a3b4look', provider_asset_id: 'as-v3', provider_group_id: 'a3b4look', provider_group_consent: 'accepted',
    source_object_key: cle(U, 'a'), source_url: null, validated_at: '2026-10-06 11:34:20.375851+00', version: 3,
    deleted_at: null, training_error: null, consent_at: '2026-10-06T00:00:00Z', consent_text: 'x', consent_version: 'x',
    subject_type: 'self', created_at: '2026-09-01T00:00:00Z', is_default: true, active_version_id: V3,
  });
  base.avatar_versions.push({
    id: V3, user_avatar_id: A3, user_id: U, version: 3, provider: 'heygen', avatar_type: 'video', status: 'completed',
    provider_avatar_id: 'a3b4look', provider_asset_id: 'as-v3', source_object_key: cle(U, 'a'), original_source_object_key: cle(U, 'a'),
    training_error: null, validated_at: '2026-10-06 11:34:20.375851+00', created_at: '2026-10-06T00:00:00Z', activated_at: '2026-10-06T00:00:00Z', abandoned_at: null,
  });
}
const miroir = () => base.user_avatars.find((a) => a.id === A3)!;
const ligneMiroir = () => { const { ...m } = miroir(); return m; };

async function candidateV4(): Promise<string> {
  const r = await lancerVersionCandidate({ userId: U, avatarId: A3, kind: 'video', nom: 'Bassi principal', cleSource: cle(U, 'b'), cleOriginal: cle(U, 'c'), mode: 'remplacer', groupeExistant: 'a3b4look', consentement: CONSENT });
  expect(r.ok).toBe(true);
  return r.ok ? r.version.id : '';
}
/** La candidate a terminé son entraînement, et son aperçu réel existe. */
function candidatePrete(versionId: string): string {
  const v = base.avatar_versions.find((x) => x.id === versionId)!;
  v.status = 'completed';
  const gen = 'eeeeeeee-0000-4000-8000-000000000044';
  base.avatar_generations.push({ id: gen, user_id: U, user_avatar_id: A3, avatar_version: v.version, intention: 'apercu', status: 'completed', video_url: `/storage/v1/object/public/media/${U}/avatar/${gen}.mp4`, created_at: new Date().toISOString() });
  return jetonOuvertureApercu({ userId: U, avatarId: A3, version: v.version as number, generationId: gen });
}

beforeEach(() => {
  base.user_avatars = []; base.avatar_versions = []; base.avatar_generations = []; base.n = 0;
  base.user_voices = [{ id: VOIX, user_id: U, provider: 'elevenlabs', provider_voice_id: 'pvid_0001_abcd', name: 'Bassi', lang: 'fr', consent_at: '2026-08-01T00:00:00Z', consent_text: 'x', created_at: '2026-08-01T00:00:00Z' }];
  base.user_settings = [];
  fournisseur.appels = []; fournisseur.refus = null; fournisseur.statut = 'processing'; fournisseur.compteur = 0;
  session.courante = { user: { id: U, email: 'contact.artboost@gmail.com' } };
  delete process.env.AVATAR_EMPLACEMENTS_VIDEO; delete process.env.AVATAR_MOTEURS_AUTORISES; delete process.env.HEYGEN_AVATAR_ENGINE;
  v3Restaure();
});

describe('1-3, 20. Le v3 reste actif tant que l’utilisateur n’a pas choisi', () => {
  it('⚠️ candidate en préparation : le miroir v3 est intact, Créer/Autopilote résolvent toujours le look v3', async () => {
    const avant = ligneMiroir();
    const id = await candidateV4();
    expect(ligneMiroir()).toEqual(avant);
    const cand = base.avatar_versions.find((v) => v.id === id)!;
    expect(cand).toMatchObject({ version: 4, status: 'processing', provider_avatar_id: 'look-1', original_source_object_key: cle(U, 'c'), source_object_key: cle(U, 'b') });
    // Remplacement d'un jumeau vidéo : la nouvelle vidéo rejoint le GROUPE existant.
    expect(fournisseur.appels).toContain('avatars:video:a3b4look');
    const j = await resoudreJumeauDuCompte(U);
    expect(j.ok && j.prive.providerAvatarId).toBe('a3b4look');
    expect(j.ok && j.prive.avatarVersionId).toBe(V3);
  });

  it('⚠️ échec fournisseur (emplacement plein) : candidate « échec » avec un message Studiio, v3 intact et toujours utilisé', async () => {
    fournisseur.refus = 'resource_limit_reached';
    const avant = ligneMiroir();
    const r = await lancerVersionCandidate({ userId: U, avatarId: A3, kind: 'video', nom: 'x', cleSource: cle(U, 'b'), cleOriginal: null, mode: 'remplacer', groupeExistant: 'a3b4look', consentement: CONSENT });
    expect(r.ok && r.etat).toBe('echec');
    expect(r.ok && r.message).toMatch(/Votre avatar actuel reste utilisable/);
    expect(r.ok && r.message).not.toMatch(/heygen|slot/i);
    expect(ligneMiroir()).toEqual(avant);
    const j = await resoudreJumeauDuCompte(U);
    expect(j.ok && j.prive.providerAvatarId).toBe('a3b4look');
  });

  it('⚠️ succès fournisseur : la candidate est PRÊTE, mais rien ne bascule sans clic', async () => {
    const id = await candidateV4();
    fournisseur.statut = 'completed';
    const s = await executerActionVersion(U, 'synchroniser', id, null);
    expect(s.ok && (s.data.version as { etat: string }).etat).toBe('prete');
    expect(miroir()).toMatchObject({ version: 3, provider_avatar_id: 'a3b4look', active_version_id: V3 });
  });

  it('une seconde candidate pendant qu’une première s’entraîne est refusée', async () => {
    await candidateV4();
    const r = await lancerVersionCandidate({ userId: U, avatarId: A3, kind: 'video', nom: 'x', cleSource: cle(U, 'd'), cleOriginal: null, mode: 'remplacer', groupeExistant: 'a3b4look', consentement: CONSENT });
    expect(r).toMatchObject({ ok: false, motif: 'candidate_en_cours' });
  });
});

describe('HeyGen — « Remplacer » n’utilise JAMAIS un nouveau groupe', () => {
  it('⚠️ la requête fournisseur réelle : type=digital_twin + avatar_group_id du groupe actif ; « nouveau » : sans avatar_group_id', async () => {
    const reel = await vi.importActual<typeof import('@/lib/avatar/heygen')>('@/lib/avatar/heygen');
    const corps: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      corps.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ data: { avatar_item: { id: 'look-x', status: 'processing' }, avatar_group: { id: 'grp-x' } } }), { status: 200 });
    }));
    process.env.HEYGEN_API_KEY = 'cle-de-test';
    try {
      await reel.createAvatarFromAsset('as-1', 'Bassi principal', 'video', 'a3b4look');
      await reel.createAvatarFromAsset('as-2', 'Bassi studio', 'video', null);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.HEYGEN_API_KEY;
    }
    expect(corps[0]).toMatchObject({ type: 'digital_twin', avatar_group_id: 'a3b4look', file: { type: 'asset_id', asset_id: 'as-1' } });
    expect(corps[1]).toMatchObject({ type: 'digital_twin' });
    expect('avatar_group_id' in corps[1]).toBe(false);
  });

  it('⚠️ remplacement vidéo SANS groupe connu : refusé avant toute écriture et tout appel fournisseur', async () => {
    const r = await lancerVersionCandidate({ userId: U, avatarId: A3, kind: 'video', nom: 'x', cleSource: cle(U, 'b'), cleOriginal: null, mode: 'remplacer', groupeExistant: null, consentement: CONSENT });
    expect(r).toMatchObject({ ok: false, motif: 'groupe_absent' });
    expect(fournisseur.appels).toEqual([]);
    expect(base.avatar_versions).toHaveLength(1);
  });

  it('⚠️ par la route : identité vidéo sans groupe, ou changement de nature (photo → vidéo) → refusé, aucun fournisseur', async () => {
    const fd = (champs: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(champs)) f.append(k, v); return f; };
    miroir().provider_group_id = null;
    let res = await createRoute.POST(new NextRequest('https://x/api/avatar/create', { method: 'POST', body: fd({ consent: 'true', mode: 'remplacer', avatarId: A3, cleSource: cle(U, 'b'), name: 'x' }) }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('groupe_absent');
    miroir().provider_group_id = 'a3b4look';
    miroir().avatar_type = 'photo';
    res = await createRoute.POST(new NextRequest('https://x/api/avatar/create', { method: 'POST', body: fd({ consent: 'true', mode: 'remplacer', avatarId: A3, cleSource: cle(U, 'b'), name: 'x' }) }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('type_different');
    expect(fournisseur.appels).toEqual([]);
    expect(base.avatar_versions).toHaveLength(1);
  });

  it('⚠️ remplacement accepté même emplacement plein : le groupe existant ne consomme pas d’emplacement', async () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ consent: 'true', mode: 'remplacer', avatarId: A3, cleSource: cle(U, 'b'), name: 'x' })) fd.append(k, v);
    const res = await createRoute.POST(new NextRequest('https://x/api/avatar/create', { method: 'POST', body: fd }));
    expect(res.status).toBe(200);
    expect(fournisseur.appels).toEqual(['asset', 'avatars:video:a3b4look']);
  });
});

describe('Candidate à chaque état : active_version_id ne bouge JAMAIS sans « Utiliser cette version »', () => {
  it('⚠️ source_ready, training, failed, completed : la version active reste v3, Créer et l’Autopilote aussi', async () => {
    const id = await candidateV4();
    const cand = base.avatar_versions.find((v) => v.id === id)!;
    for (const statut of ['source_ready', 'processing', 'failed', 'completed']) {
      cand.status = statut;
      fournisseur.statut = statut;
      await executerActionVersion(U, 'synchroniser', id, null);
      expect(miroir()).toMatchObject({ active_version_id: V3, version: 3, provider_avatar_id: 'a3b4look' });
      const j = await resoudreJumeauDuCompte(U);
      expect(j.ok && j.prive.providerAvatarId, statut).toBe('a3b4look');
    }
  });
});

describe('4-5, 21. Bascule atomique, retour arrière, historique', () => {
  it('⚠️ « Utiliser cette version » exige l’aperçu OUVERT, puis bascule le miroir en une fois', async () => {
    const id = await candidateV4();
    const jeton = candidatePrete(id);
    const sansJeton = await executerActionVersion(U, 'utiliser', id, null);
    expect(sansJeton).toMatchObject({ ok: false, code: 'apercu_non_ouvert' });
    expect(miroir().version).toBe(3);
    const r = await executerActionVersion(U, 'utiliser', id, jeton);
    expect(r.ok).toBe(true);
    expect(miroir()).toMatchObject({ version: 4, provider_avatar_id: 'look-1', active_version_id: id, source_object_key: cle(U, 'b') });
    expect(miroir().validated_at).toBeTruthy();
  });

  it('⚠️ compare-and-set : une bascule sur une active périmée est refusée, rien n’est écrit', async () => {
    const id = await candidateV4();
    candidatePrete(id);
    base.avatar_versions.find((v) => v.id === id)!.validated_at = '2026-10-09T00:00:00Z';
    const avant = ligneMiroir();
    const r = await versions.activerVersion({ userId: U, avatarId: A3, versionId: id, activeAttendue: 'ffffffff-0000-4000-8000-000000000000' });
    expect(r).toEqual({ ok: false, motif: 'concurrent' });
    expect(ligneMiroir()).toEqual(avant);
  });

  it('⚠️ après bascule, v3 reste en HISTORIQUE et « Revenir à cette version » la réactive', async () => {
    const id = await candidateV4();
    await executerActionVersion(U, 'utiliser', id, candidatePrete(id));
    const liste = await (await listeRoute.GET()).json();
    const carte = liste.data.avatars[0];
    expect(carte.versionActive.version).toBe(4);
    expect(carte.historique.map((h: { version: number }) => h.version)).toContain(3);
    const r = await executerActionVersion(U, 'revenir', V3, null);
    expect(r.ok).toBe(true);
    expect(miroir()).toMatchObject({ version: 3, provider_avatar_id: 'a3b4look', active_version_id: V3 });
  });

  it('« Garder ma version actuelle » met la candidate de côté ; une candidate non validée ne peut pas « revenir »', async () => {
    const id = await candidateV4();
    candidatePrete(id);
    expect((await executerActionVersion(U, 'revenir', id, null)).ok).toBe(false);
    expect((await executerActionVersion(U, 'garder', id, null)).ok).toBe(true);
    expect(base.avatar_versions.find((v) => v.id === id)!.abandoned_at).toBeTruthy();
    expect(miroir().version).toBe(3);
  });
});

describe('6-7, 18. Plusieurs identités ; nouveau ≠ remplacer ; permissions', () => {
  const requete = (champs: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(champs)) fd.append(k, v);
    return createRoute.POST(new NextRequest('https://studiio.pro/api/avatar/create', { method: 'POST', body: fd }));
  };

  it('⚠️ « Remplacer » par la route : 200 avec une candidate publique, le miroir v3 n’est pas touché', async () => {
    const avant = ligneMiroir();
    const res = await requete({ consent: 'true', mode: 'remplacer', avatarId: A3, cleSource: cle(U, 'b'), cleOriginal: cle(U, 'c'), name: 'Bassi principal' });
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.data).toMatchObject({ avatarId: A3, mode: 'remplacer', candidate: { version: 4, etat: 'entrainement' } });
    expect(JSON.stringify(j)).not.toMatch(/look-|as-|grp-|source-/);
    expect(ligneMiroir()).toEqual(avant);
  });

  it('⚠️ « Nouvel avatar » vidéo avec l’emplacement plein : refusé AVANT tout fournisseur, rien créé', async () => {
    const res = await requete({ consent: 'true', mode: 'nouveau', cleSource: cle(U, 'b'), name: 'Bassi studio' });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('emplacement_plein');
    expect(fournisseur.appels).toEqual([]);
    expect(base.user_avatars).toHaveLength(1);
  });

  it('⚠️ « Nouvel avatar » avec un emplacement libre : NOUVELLE identité, pas par défaut ; le défaut reste v3', async () => {
    process.env.AVATAR_EMPLACEMENTS_VIDEO = '2';
    const res = await requete({ consent: 'true', mode: 'nouveau', cleSource: cle(U, 'b'), name: 'Bassi studio' });
    expect(res.status).toBe(200);
    expect(base.user_avatars).toHaveLength(2);
    const nouvel = base.user_avatars.find((a) => a.id !== A3)!;
    expect(nouvel).toMatchObject({ name: 'Bassi studio', is_default: false });
    expect(nouvel.active_version_id ?? null).toBeNull();
    expect(fournisseur.appels).toContain('avatars:video:nouveau-groupe');
    expect(miroir()).toMatchObject({ is_default: true, version: 3 });
    const liste = await (await listeRoute.GET()).json();
    expect(liste.data.avatars.map((a: { nom: string }) => a.nom)).toEqual(['Bassi principal', 'Bassi studio']);
    // Une identité nouvelle n'est jamais l'avatar résolu par défaut.
    const j = await resoudreJumeauDuCompte(U);
    expect(j.ok && j.prive.providerAvatarId).toBe('a3b4look');
  });

  it('⚠️ un autre compte : ses versions sont introuvables, le défaut ne bascule pas, la source d’autrui est refusée', async () => {
    const id = await candidateV4();
    expect(await executerActionVersion(AUTRUI, 'garder', id, null)).toMatchObject({ ok: false, statut: 404 });
    expect(await versions.definirParDefaut(AUTRUI, A3)).toBe(false);
    session.courante = { user: { id: AUTRUI } };
    const r = await versionRoute.POST(new NextRequest('https://x/api/avatars/versions/x', { method: 'POST', body: JSON.stringify({ action: 'utiliser' }) }), { params: { versionId: id } });
    expect(r.status).toBe(404);
    session.courante = { user: { id: U, email: 'contact.artboost@gmail.com' } };
    const res = await requete({ consent: 'true', mode: 'remplacer', cleSource: cle(AUTRUI, 'b'), name: 'x' });
    expect(res.status).toBe(400);
  });

  it('⚠️ plafond d’avatars par compte : « nouvel avatar » refusé AVANT toute écriture et tout fournisseur', async () => {
    process.env.AVATAR_IDENTITES_MAX = '1';
    const res = await requete({ consent: 'true', mode: 'nouveau', cleSource: cle(U, 'b'), name: 'Encore un' });
    delete process.env.AVATAR_IDENTITES_MAX;
    // Vidéo + emplacement plein est tranché d'abord ; en photo, le plafond tranche.
    expect(res.status).toBe(409);
    process.env.AVATAR_IDENTITES_MAX = '1';
    const fd = new FormData();
    for (const [k, v] of Object.entries({ consent: 'true', mode: 'nouveau', name: 'Photo' })) fd.append(k, v);
    fd.append('file', new File([new Uint8Array(10)], 'p.jpg', { type: 'image/jpeg' }));
    const photo = await createRoute.POST(new NextRequest('https://x/api/avatar/create', { method: 'POST', body: fd }));
    delete process.env.AVATAR_IDENTITES_MAX;
    expect(photo.status).toBe(409);
    expect((await photo.json()).code).toBe('identites_max');
    expect(fournisseur.appels).toEqual([]);
    expect(base.user_avatars).toHaveLength(1);
  });

  it('⚠️ deux « nouvel avatar » simultanés : un seul passe le contrôle d’emplacement, l’autre est refusé (429), un seul appel fournisseur', async () => {
    process.env.AVATAR_EMPLACEMENTS_VIDEO = '2';
    const [a, b] = await Promise.all([
      requete({ consent: 'true', mode: 'nouveau', cleSource: cle(U, 'b'), name: 'A' }),
      requete({ consent: 'true', mode: 'nouveau', cleSource: cle(U, 'd'), name: 'B' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 429]);
    expect(fournisseur.appels.filter((x) => x.startsWith('avatars:'))).toHaveLength(1);
    expect(base.user_avatars).toHaveLength(2);
  });

  it('« Utiliser » (par défaut) change l’avatar par défaut — une seule identité par défaut', async () => {
    process.env.AVATAR_EMPLACEMENTS_VIDEO = '2';
    await requete({ consent: 'true', mode: 'nouveau', cleSource: cle(U, 'b'), name: 'Bassi studio' });
    const autre = base.user_avatars.find((a) => a.id !== A3)!;
    const r = await defautRoute.POST(new NextRequest('https://x/api/avatars/defaut', { method: 'POST', body: JSON.stringify({ avatarId: autre.id }) }));
    expect(r.status).toBe(200);
    expect(base.user_avatars.filter((a) => a.is_default)).toEqual([autre]);
  });

  it('sans session → 401 sur la liste, le défaut et les actions', async () => {
    session.courante = null;
    expect((await listeRoute.GET()).status).toBe(401);
    expect((await defautRoute.POST(new NextRequest('https://x', { method: 'POST', body: '{}' }))).status).toBe(401);
    expect((await versionRoute.POST(new NextRequest('https://x', { method: 'POST', body: '{}' }), { params: { versionId: V3 } })).status).toBe(401);
  });
});

describe('8-10. Créer et l’Autopilote choisissent une identité LOGIQUE ; rien de fournisseur côté navigateur', () => {
  it('⚠️ Créer : `avatarId` choisi → SA version active ; un id d’autrui → aucun avatar', async () => {
    base.user_avatars.push({ ...miroir(), id: 'dddddddd-0000-4000-8000-0000000000aa', name: 'Studio', is_default: false, provider_avatar_id: 'look-studio', active_version_id: null, created_at: '2026-10-01T00:00:00Z' });
    const choisi = await resoudreJumeauDuCompte(U, { avatarId: 'dddddddd-0000-4000-8000-0000000000aa' });
    expect(choisi.ok && choisi.prive.providerAvatarId).toBe('look-studio');
    const defaut = await resoudreJumeauDuCompte(U);
    expect(defaut.ok && defaut.prive.providerAvatarId).toBe('a3b4look');
    const autrui = await resoudreJumeauDuCompte(AUTRUI, { avatarId: A3 });
    expect(autrui.ok).toBe(false);
  });

  it('⚠️ Autopilote : la config garde l’identité logique (UUID seulement), et le moteur la transmet', () => {
    expect(sanitizeConfig({ jumeauAvatarId: A3 }).jumeauAvatarId).toBe(A3);
    expect(sanitizeConfig({ jumeauAvatarId: 'a3b4look' }).jumeauAvatarId).toBeNull();
    expect(sanitizeConfig({}).jumeauAvatarId).toBeNull();
    const src = readFileSync('src/lib/autopilot/jumeau-async.ts', 'utf8');
    expect(src).toMatch(/genererVideoJumeau\(\{[^}]*avatarId: input\.config\.jumeauAvatarId/);
  });

  it('⚠️ GET /api/avatars : aucun identifiant fournisseur, aucune clé de stockage ; capacité vidéo dite d’avance', async () => {
    await candidateV4();
    const j = await (await listeRoute.GET()).json();
    const brut = JSON.stringify(j);
    for (const interdit of ['a3b4look', 'look-1', 'as-v3', 'source-', 'provider']) expect(brut).not.toContain(interdit);
    expect(j.data.avatars[0]).toMatchObject({ nom: 'Bassi principal', parDefaut: true, versionActive: { version: 3 }, candidate: { version: 4, etat: 'entrainement' } });
    expect(j.data.capacite.nouvelAvatarVideo).toBe(false);
  });
});

describe('22. Qualité du rendu : choisie à la génération, indépendante de l’avatar', () => {
  it('⚠️ par défaut seul Standard (Avatar III) est ouvert ; une qualité fermée est REFUSÉE, jamais rabattue', () => {
    expect(moteursAutorises(VIDE)).toEqual(['avatar_iii']);
    expect(moteurPourGeneration(undefined, VIDE)).toEqual({ ok: true, moteur: 'avatar_iii' });
    expect(moteurPourGeneration('standard', VIDE)).toEqual({ ok: true, moteur: 'avatar_iii' });
    expect(moteurPourGeneration('premium', VIDE)).toMatchObject({ ok: false });
    expect(moteurPourGeneration('avatar_v', VIDE)).toMatchObject({ ok: false });
    expect(qualitesDisponibles(VIDE).map((q) => q.ouverte)).toEqual([true, false, false]);
  });

  it('ouvrir Qualité côté serveur ne change rien à la version d’avatar utilisée', async () => {
    const env = { AVATAR_MOTEURS_AUTORISES: 'avatar_iv' } as unknown as NodeJS.ProcessEnv;
    expect(moteurPourGeneration('qualite', env)).toEqual({ ok: true, moteur: 'avatar_iv' });
    const j = await resoudreJumeauDuCompte(U);
    expect(j.ok && j.prive.avatarVersionId).toBe(V3);
  });

  it('⚠️ chaque génération trace sa version et son moteur ; le moteur est vérifié AVANT tout débit', () => {
    const src = readFileSync('src/lib/avatar/moteur-jumeau.ts', 'utf8');
    expect(src).toMatch(/avatar_version_id: jumeau\.prive\.avatarVersionId/);
    expect(src).toMatch(/engine: choixMoteur\.moteur/);
    expect(src.indexOf('moteurPourGeneration(args.qualite')).toBeLessThan(src.indexOf('await deductCredits('));
  });
});

describe('Le chemin destructif a disparu', () => {
  it('⚠️ la route de création n’appelle plus jamais la réécriture de version de la ligne active', () => {
    const src = readFileSync('src/app/api/avatar/create/route.ts', 'utf8');
    expect(src).not.toMatch(/commencerNouvelleVersionAvatar/);
    expect(src).toMatch(/if \(actuel\) \{\n\s+return cheminCandidat/);
  });
});
