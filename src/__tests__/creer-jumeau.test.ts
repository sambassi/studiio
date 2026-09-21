// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * « UTILISER MON JUMEAU » — le contrat serveur et sa route.
 *
 * Doublures : user_avatars, user_voices, user_settings en mémoire. Le
 * serveur relit tout ; le navigateur n'apporte que son intention et ses
 * textes. Aucun identifiant fournisseur ne sort de la route.
 */

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRUI = 'bbbbbbbb-2222-4222-8222-222222222222';
const A = '11111111-1111-4111-8111-000000000001';
const V1 = '44444444-4444-4444-8444-000000000001';
const V2 = '44444444-4444-4444-8444-000000000002';

type Ligne = Record<string, unknown>;
const base = vi.hoisted(() => ({ avatars: [] as Ligne[], voices: [] as Ligne[], settings: [] as Ligne[] }));

vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => {
    const source = table === 'user_avatars' ? base.avatars : table === 'user_voices' ? base.voices : table === 'user_settings' ? base.settings : null;
    if (!source) throw new Error(`table inattendue ${table}`);
    const filtres: Array<(l: Ligne) => boolean> = [];
    let colonnes: string[] | null = null;
    let tri = false;
    let limite: number | undefined;
    const exec = () => {
      let rows = source.filter((l) => filtres.every((f) => f(l)));
      if (tri) rows = [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      if (limite !== undefined) rows = rows.slice(0, limite);
      const projeter = (l: Ligne) => (colonnes ? Object.fromEntries(colonnes.map((c) => [c, l[c]])) : { ...l });
      return { data: rows.map(projeter), error: null };
    };
    const api = {
      select(c?: string) { if (c && c !== '*') colonnes = c.split(',').map((x) => x.trim()); return api; },
      eq(k: string, v: unknown) { filtres.push((l) => l[k] === v); return api; },
      is(k: string, v: unknown) { filtres.push((l) => l[k] === v); return api; },
      order() { tri = true; return api; },
      async limit(n: number) { limite = n; return exec(); },
      then(resolve: (v: unknown) => void, reject: (e: unknown) => void) { return Promise.resolve().then(exec).then(resolve, reject); },
    };
    return api;
  };
  return { supabase: {}, supabaseAdmin: { from } };
});
const session = vi.hoisted(() => ({ courante: { user: { id: 'aaaaaaaa-1111-4111-8111-111111111111' } } as unknown }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => session.courante }));

const { resoudreJumeauDuCompte, scriptsDuJumeau, moteurJumeauDisponible } = await import('@/lib/avatar/jumeau');
const { GET, POST } = await import('@/app/api/creer/jumeau/route');
const { gardeJumeauAvantRendu, genererEtAttendreVideoJumeau, JUMEAU_INDISPONIBLE } = await import('@/lib/creer/jumeau');

const avatar = (over: Ligne = {}): Ligne => ({
  id: A, user_id: U, status: 'completed', provider_avatar_id: 'hg-1', provider_asset_id: 'as-1',
  source_object_key: `${U}/avatar/source-1-${'a'.repeat(32)}.mp4`, source_url: null, subject_type: 'self', consent_version: 'x',
  consent_at: '2026-09-01T00:00:00Z', consent_text: 'x', validated_at: '2026-09-03T00:00:00Z', version: 2, deleted_at: null,
  created_at: '2026-09-01T00:00:00.000Z', avatar_type: 'video', name: 'Bassi', training_error: null, ...over,
});
const voix = (id: string, over: Ligne = {}): Ligne => ({
  id, user_id: U, provider: 'elevenlabs', provider_voice_id: `pvid_${id.slice(-4)}_abcd`, name: `Voix ${id.slice(-1)}`, lang: 'fr',
  consent_at: '2026-08-01T00:00:00Z', consent_text: 'x', created_at: `2026-08-0${id.slice(-1)}T00:00:00Z`, ...over,
});
const post = (body: unknown) => POST(new NextRequest('https://studiio.pro/api/creer/jumeau', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

beforeEach(() => {
  base.avatars = [avatar()]; base.voices = [voix(V1)]; base.settings = [];
  session.courante = { user: { id: U } };
});

describe('resoudreJumeauDuCompte — prêt seulement si TOUT est vrai', () => {
  it('⚠️ avatar validé (version courante, fournisseur présent) + une voix utilisable → prêt ; le privé est séparé du public', async () => {
    const r = await resoudreJumeauDuCompte(U);
    expect(r).toMatchObject({ ok: true, jumeau: { avatar: { id: A, version: 2, nom: 'Bassi', valideLe: '2026-09-03T00:00:00Z' }, voix: { id: V1, nom: 'Voix 1' }, prononciations: 0 } });
    expect(r.ok && r.prive).toEqual({ providerAvatarId: 'hg-1', fournisseurAvatar: 'heygen', providerVoiceId: 'pvid_0001_abcd', prononciations: [] });
    // Le fournisseur (pas son identifiant) sort côté public : l'écran en a
    // besoin pour dire ce que le moteur vidéo sait faire de cet avatar.
    expect(r.ok && r.jumeau.avatar.fournisseur).toBe('heygen');
    expect(JSON.stringify(r.ok && r.jumeau)).not.toMatch(/hg-1|pvid_/);
  });

  it('⚠️ avatar absent / d’un autre compte / supprimé → avatar_absent', async () => {
    base.avatars = [];
    expect(await resoudreJumeauDuCompte(U)).toMatchObject({ ok: false, motif: 'avatar_absent' });
    base.avatars = [avatar({ user_id: AUTRUI })];
    expect(await resoudreJumeauDuCompte(U)).toMatchObject({ ok: false, motif: 'avatar_absent' });
    base.avatars = [avatar({ deleted_at: '2026-09-15T00:00:00Z' })];
    expect(await resoudreJumeauDuCompte(U)).toMatchObject({ ok: false, motif: 'avatar_absent' });
  });

  it('⚠️ avatar non prêt : source_ready, entraînement, échec, provider absent → avatar_non_pret', async () => {
    for (const over of [
      { provider_avatar_id: null, status: 'source_ready', validated_at: null },
      { status: 'processing', validated_at: null },
      { status: 'failed', validated_at: null },
      // validated_at d'une version précédente, mais nouvelle version en cours : ne compte pas.
      { status: 'processing', validated_at: '2026-09-03T00:00:00Z' },
      { provider_avatar_id: null, status: 'completed' },
    ]) {
      base.avatars = [avatar(over)];
      expect(await resoudreJumeauDuCompte(U), JSON.stringify(over)).toMatchObject({ ok: false, motif: 'avatar_non_pret' });
    }
  });

  it('⚠️ entraîné mais NON VALIDÉ → avatar_non_valide ; la version courante est celle relue (ancienne version jamais utilisée)', async () => {
    base.avatars = [avatar({ validated_at: null })];
    expect(await resoudreJumeauDuCompte(U)).toMatchObject({ ok: false, motif: 'avatar_non_valide' });
    // Remplacement → v3 non validée : l'ancienne v2 validée n'existe plus, rien ne « survit ».
    base.avatars = [avatar({ version: 3, validated_at: null, provider_avatar_id: 'hg-3' })];
    expect(await resoudreJumeauDuCompte(U)).toMatchObject({ ok: false, motif: 'avatar_non_valide' });
  });

  it('⚠️ voix : absente, autrui seulement, plusieurs sans choix, choix inutilisable / forgé', async () => {
    base.voices = [];
    expect(await resoudreJumeauDuCompte(U)).toMatchObject({ ok: false, motif: 'voix_absente' });
    base.voices = [voix(V1, { user_id: AUTRUI })];
    expect(await resoudreJumeauDuCompte(U)).toMatchObject({ ok: false, motif: 'voix_absente' });
    base.voices = [voix(V1), voix(V2)];
    expect(await resoudreJumeauDuCompte(U)).toMatchObject({ ok: false, motif: 'choix_voix_requis' });
    base.settings = [{ user_id: U, creator_preferences: { voixPersonnelle: { userVoiceId: '44444444-4444-4444-8444-00000000dead' } } }];
    expect(await resoudreJumeauDuCompte(U)).toMatchObject({ ok: false, motif: 'voix_inutilisable' });
    base.settings = [{ user_id: U, creator_preferences: { voixPersonnelle: { userVoiceId: V2 } } }];
    base.voices = [voix(V1), voix(V2, { provider_voice_id: 'x' })];
    expect(await resoudreJumeauDuCompte(U)).toMatchObject({ ok: false, motif: 'voix_inutilisable' });
    base.voices = [voix(V1), voix(V2)];
    expect(await resoudreJumeauDuCompte(U)).toMatchObject({ ok: true, jumeau: { voix: { id: V2 } } });
  });

  it('les prononciations du compte sont reprises ; scriptsDuJumeau garde le DISPLAY et produit le SPOKEN', async () => {
    base.settings = [{ user_id: U, creator_preferences: { voixPersonnelle: { userVoiceId: null, prononciations: [{ affiche: 'Afroboost', prononce: 'Afro-boust' }, { affiche: 'Neuchâtel', prononce: 'Neu-cha-tel' }] } } }];
    const r = await resoudreJumeauDuCompte(U);
    expect(r.ok && r.jumeau.prononciations).toBe(2);
    const s = scriptsDuJumeau(['Bienvenue chez Afroboost à Neuchâtel.'], r.ok ? r.prive.prononciations : []);
    expect(s).toEqual([{ display: 'Bienvenue chez Afroboost à Neuchâtel.', spoken: 'Bienvenue chez Afro-boust à Neu-cha-tel.' }]);
  });

  it('⚠️ le moteur vidéo du jumeau n’est disponible QUE sur activation explicite + fournisseurs configurés — jamais par défaut', () => {
    const env = (v: Record<string, string>) => v as unknown as NodeJS.ProcessEnv;
    expect(moteurJumeauDisponible(env({}))).toBe(false);
    expect(moteurJumeauDisponible(env({ HEYGEN_API_KEY: 'h', ELEVENLABS_API_KEY: 'e' }))).toBe(false);
    expect(moteurJumeauDisponible(env({ JUMEAU_MOTEUR_ACTIVE: '1' }))).toBe(false);
    expect(moteurJumeauDisponible(env({ JUMEAU_MOTEUR_ACTIVE: '1', HEYGEN_API_KEY: 'h' }))).toBe(false);
    expect(moteurJumeauDisponible(env({ JUMEAU_MOTEUR_ACTIVE: '1', HEYGEN_API_KEY: 'h', ELEVENLABS_API_KEY: 'e' }))).toBe(true);
    expect(moteurJumeauDisponible(env({ JUMEAU_MOTEUR_ACTIVE: 'true', HEYGEN_API_KEY: 'h', ELEVENLABS_API_KEY: 'e' }))).toBe(false);
  });
});

describe('/api/creer/jumeau', () => {
  it('sans session → 401', async () => { session.courante = null; expect((await GET()).status).toBe(401); expect((await post({})).status).toBe(401); });

  it('⚠️ GET/POST : prêt, sans AUCUN identifiant fournisseur ; moteur annoncé indisponible', async () => {
    const g = await (await GET()).json() as { data: Record<string, unknown> };
    expect(g.data).toMatchObject({ pret: true, motif: null, moteurDisponible: false, jumeau: { voix: { nom: 'Voix 1' } } });
    expect(JSON.stringify(g)).not.toMatch(/hg-1|pvid_|provider/);
    const p = await (await post({ textes: ['Bonjour'] })).json() as { data: Record<string, unknown> };
    expect(p.data).toMatchObject({ pret: true, scripts: [{ display: 'Bonjour', spoken: 'Bonjour' }] });
    expect(JSON.stringify(p)).not.toMatch(/hg-1|pvid_|provider/);
  });

  it('⚠️ avatar D-ID validé + voix : PRÊT (la voix sert partout), moteur vidéo indisponible avec le message qui dit quoi et pourquoi', async () => {
    base.avatars = [avatar({ provider: 'did', provider_avatar_id: 'did-1' })];
    const g = await (await GET()).json() as { data: Record<string, unknown> };
    expect(g.data).toMatchObject({ pret: true, motif: null, moteurDisponible: false, jumeau: { avatar: { fournisseur: 'did' } } });
    expect(String(g.data.messageMoteur)).toContain('créés à partir d’une photo');
    expect(String(g.data.messageMoteur)).toContain('voix reste utilisable');
    expect(JSON.stringify(g)).not.toMatch(/did-1|pvid_|provider|pas encore pris en charge/);
  });

  it('non prêt → pret:false avec motif et message ; POST ne calcule aucun script', async () => {
    base.avatars = [avatar({ validated_at: null })];
    const p = await (await post({ textes: ['Bonjour'] })).json() as { data: Record<string, unknown> };
    expect(p.data).toMatchObject({ pret: false, motif: 'avatar_non_valide', jumeau: null });
    expect('scripts' in p.data).toBe(false);
  });

  it('⚠️ le navigateur ne peut rien imposer : identifiants dans le corps ignorés, textes bornés', async () => {
    base.settings = [{ user_id: U, creator_preferences: { voixPersonnelle: { userVoiceId: null, prononciations: [{ affiche: 'A', prononce: 'B' }] } } }];
    const p = await (await post({ textes: Array.from({ length: 30 }, () => 'A'), avatarId: 'x', providerAvatarId: 'y', userVoiceId: 'z', prononciations: [{ affiche: 'A', prononce: 'PIRATE' }] })).json() as { data: { scripts: unknown[] } };
    expect(p.data.scripts).toHaveLength(20);
    expect(p.data.scripts[0]).toEqual({ display: 'A', spoken: 'B' });
  });
});

describe('gardeJumeauAvantRendu — le garde côté navigateur', () => {
  it('sans « Utiliser mon jumeau » → aucun appel, parcours normal', async () => {
    const verifier = vi.fn();
    expect(await gardeJumeauAvantRendu({ useDigitalTwin: false, textes: ['x'], verifier })).toBeNull();
    expect(await gardeJumeauAvantRendu({ useDigitalTwin: 'true' as unknown as boolean, textes: [], verifier })).toBeNull();
    expect(verifier).not.toHaveBeenCalled();
  });

  it('⚠️ avec : le serveur est interrogé avec les textes ; non prêt → son message ; injoignable → message générique', async () => {
    const verifier = vi.fn(async () => ({ pret: false, motif: 'avatar_non_valide', message: 'Votre avatar doit être validé…', jumeau: null, moteurDisponible: false, messageMoteur: null }));
    expect(await gardeJumeauAvantRendu({ useDigitalTwin: true, textes: ['a', 'b'], verifier })).toBe('Votre avatar doit être validé…');
    expect(verifier).toHaveBeenCalledWith(['a', 'b']);
    expect(await gardeJumeauAvantRendu({ useDigitalTwin: true, textes: [], verifier: async () => null })).toBe(JUMEAU_INDISPONIBLE);
  });

  it('⚠️ prêt mais moteur indisponible → arrêt avec le message du moteur ; prêt ET moteur → passe', async () => {
    const pret = { pret: true, motif: null, message: null, jumeau: null, moteurDisponible: false, messageMoteur: 'La génération vidéo avec votre jumeau numérique n’est pas encore disponible.' };
    expect(await gardeJumeauAvantRendu({ useDigitalTwin: true, textes: [], verifier: async () => pret })).toBe(pret.messageMoteur);
    expect(await gardeJumeauAvantRendu({ useDigitalTwin: true, textes: [], verifier: async () => ({ ...pret, moteurDisponible: true, messageMoteur: null }) })).toBeNull();
  });
});

describe('genererEtAttendreVideoJumeau — lancer, suivre par /api/avatar/status, rendre la vraie URL ou lever', () => {
  const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body } as unknown as Response);
  const fetchAvec = (statuts: Array<{ status: string; videoUrl?: string | null; error?: string }>, lancement = json(200, { success: true, data: { generationId: 'g-1', status: 'pending', avatarVersion: 3 } })) => {
    let i = 0;
    const appels: string[] = [];
    const f = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url); appels.push(`${init?.method ?? 'GET'} ${u}`);
      if (u === '/api/creer/jumeau/generer') return lancement;
      if (u.startsWith('/api/avatar/status?generationId=g-1')) return json(200, { success: true, data: statuts[Math.min(i++, statuts.length - 1)] });
      throw new Error(`fetch inattendu ${u}`);
    });
    return { f: f as unknown as typeof fetch, appels };
  };
  const rapide = async () => {};

  it('⚠️ pending → processing → completed : rend l’URL re-hébergée, la génération et la version ; les étapes sont annoncées', async () => {
    const { f, appels } = fetchAvec([{ status: 'pending', videoUrl: null }, { status: 'processing', videoUrl: null }, { status: 'completed', videoUrl: '/storage/v1/object/public/media/u/avatar/g-1.mp4' }]);
    const etapes: string[] = [];
    const r = await genererEtAttendreVideoJumeau({ textes: ['Bonjour'], aspectRatio: '9:16', fetchImpl: f, attendreMs: rapide, onEtape: (m) => etapes.push(m) });
    expect(r).toEqual({ url: '/storage/v1/object/public/media/u/avatar/g-1.mp4', generationId: 'g-1', avatarVersion: 3 });
    expect(appels[0]).toBe('POST /api/creer/jumeau/generer');
    expect(appels.filter((a) => a.includes('/api/avatar/status'))).toHaveLength(3);
    expect(etapes[0]).toBe('Génération de votre jumeau…');
  });

  it('⚠️ failed → lève avec le message serveur ; lancement refusé (409/503/502) → lève, aucun polling ; jamais une URL sans completed', async () => {
    const { f } = fetchAvec([{ status: 'failed', videoUrl: null, error: 'HeyGen a signale un echec. Credits rembourses.' }]);
    await expect(genererEtAttendreVideoJumeau({ textes: ['x'], aspectRatio: '9:16', fetchImpl: f, attendreMs: rapide })).rejects.toThrow(/HeyGen a signale un echec/);
    const refus = fetchAvec([], json(503, { success: false, error: 'La génération vidéo avec votre jumeau numérique n’est pas encore disponible.' }));
    await expect(genererEtAttendreVideoJumeau({ textes: ['x'], aspectRatio: '9:16', fetchImpl: refus.f, attendreMs: rapide })).rejects.toThrow(/pas encore disponible/);
    expect(refus.appels.filter((a) => a.includes('/api/avatar/status'))).toEqual([]);
    const jamais = fetchAvec([{ status: 'processing', videoUrl: '/x.mp4' }]);
    await expect(genererEtAttendreVideoJumeau({ textes: ['x'], aspectRatio: '9:16', fetchImpl: jamais.f, attendreMs: rapide, maxAttenteMs: 1 })).rejects.toThrow(/trop de temps/);
  });
});
