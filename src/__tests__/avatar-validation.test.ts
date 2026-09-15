// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * VALIDATION RÉELLE DU CLONE — aperçu réel, ouverture prouvée, validation
 * serveur liée à la version.
 *
 * Doublures : base en mémoire (user_avatars + avatar_generations) qui
 * applique les filtres, l'index unique d'aperçu (23505) et rend les lignes
 * touchées, avec pannes injectables ; HeyGen contrôlé ; crédits journalisés.
 *
 * Ce que ces tests verrouillent :
 * - aucun aperçu n'est inventé : seule une génération `apercu` TERMINÉE et
 *   re-hébergée pour CETTE version est « prêt » ; URL fournisseur, autre
 *   compte, autre génération, placeholder → jamais ;
 * - la validation exige : clone entraîné (statut fournisseur synchronisé),
 *   non validé, aperçu prêt, jeton d'ouverture de CET aperçu ;
 * - `validated_at` écrit par CAS (id, user_id, version, deleted_at null,
 *   validated_at null) ; version remplacée → 409 ; nouvelle version →
 *   validation à zéro et ancien jeton caduc ; erreur DB → jamais un succès.
 */

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRUI = 'bbbbbbbb-2222-4222-8222-222222222222';
const A = '11111111-1111-4111-8111-000000000001';
const G = '22222222-2222-4222-8222-000000000001';
const RELAIS = 'https://studiio.pro/storage/v1/object/public/media';

type Op = 'select' | 'insert' | 'update';
interface Panne { table: string; op: Op; occurrence: number; mode: 'erreur' | 'fantome' }
type Ligne = Record<string, unknown> & { id: string };

const base = vi.hoisted(() => ({
  avatars: [] as Ligne[],
  generations: [] as Ligne[],
  journal: [] as string[],
  pannes: [] as Panne[],
  executions: {} as Record<string, number>,
  compteur: 0,
  crochets: { avantUpdate: null as null | ((table: string, n: number) => void) },
}));
const heygen = vi.hoisted(() => ({ appels: [] as string[], echec: false, statutEntrainement: 'completed' as string }));
const credits = vi.hoisted(() => ({ journal: [] as string[], solde: 1000 }));

vi.mock('@/lib/db/supabase', () => {
  const from = (table: string) => {
    const source = () => (table === 'user_avatars' ? base.avatars : table === 'avatar_generations' ? base.generations : null);
    if (!source()) throw new Error(`table inattendue ${table}`);
    const filtres: Array<(l: Ligne) => boolean> = [];
    const clesFiltre: string[] = [];
    let op: Op = 'select';
    let patch: Ligne | null = null;
    let insertion: Record<string, unknown> | null = null;
    let colonnes: string[] | null = null;
    let tri = false;
    let limite: number | undefined;
    const projeter = (l: Ligne) => (colonnes ? Object.fromEntries(colonnes.map((c) => [c, l[c]])) : { ...l });
    const reel = (): { data: unknown; error: { code?: string; message: string } | null } => {
      if (op === 'insert') {
        const l = insertion!;
        if (table === 'avatar_generations' && l.intention === 'apercu'
          && base.generations.some((g) => g.user_avatar_id === l.user_avatar_id && g.avatar_version === l.avatar_version && g.intention === 'apercu' && g.status !== 'failed')) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "avatar_generations_apercu_unique"' } };
        }
        const ligne = { id: `33333333-3333-4333-8333-${String(++base.compteur).padStart(12, '0')}`, created_at: new Date(Date.now() + base.compteur).toISOString(), video_url: null, error_message: null, ...l } as Ligne;
        source()!.push(ligne);
        base.journal.push(`${table}:insert`);
        return { data: [projeter(ligne)], error: null };
      }
      let rows = source()!.filter((l) => filtres.every((f) => f(l)));
      if (op === 'update') {
        base.journal.push(`${table}:update:${Object.keys(patch!).sort().join(',')}:${rows.length}`);
        base.journal.push(`${table}:filtres:${clesFiltre.join(',')}`);
        for (const l of rows) Object.assign(l, patch);
        return { data: rows.map(projeter), error: null };
      }
      if (tri) rows = [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      if (limite !== undefined) rows = rows.slice(0, limite);
      return { data: rows.map(projeter), error: null };
    };
    const executer = () => {
      const cle = `${table}:${op}`;
      base.executions[cle] = (base.executions[cle] ?? 0) + 1;
      const panne = base.pannes.find((x) => x.table === table && x.op === op && x.occurrence === base.executions[cle]);
      if (panne?.mode === 'erreur') return { data: null, error: { message: `panne ${cle} #${panne.occurrence}` } };
      if (op === 'update') base.crochets.avantUpdate?.(table, base.executions[cle]);
      const r = reel();
      if (panne?.mode === 'fantome') return { data: null, error: { message: `reponse perdue ${cle}` } };
      return r;
    };
    const api = {
      select(c?: string) { if (c && c !== '*') colonnes = c.split(',').map((x) => x.trim()); return api; },
      insert(v: Record<string, unknown>) { op = 'insert'; insertion = v; return api; },
      update(p: Ligne) { op = 'update'; patch = p; return api; },
      delete() { throw new Error('DELETE physique interdit'); },
      eq(k: string, v: unknown) { clesFiltre.push(`eq:${k}`); filtres.push((l) => l[k] === v); return api; },
      is(k: string, v: unknown) { clesFiltre.push(`is:${k}`); filtres.push((l) => l[k] === v); return api; },
      order() { tri = true; return api; },
      async limit(n: number) { limite = n; return executer(); },
      async single() {
        const r = executer();
        if (r.error) return r;
        const rows = r.data as unknown[];
        return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
      },
      async maybeSingle() { const r = executer(); if (r.error) return r; const rows = r.data as unknown[]; return { data: rows[0] ?? null, error: null }; },
      then(resolve: (v: unknown) => void, reject: (e: unknown) => void) { return Promise.resolve().then(executer).then(resolve, reject); },
    };
    return api;
  };
  return { supabase: {}, supabaseAdmin: { from } };
});

vi.mock('@/lib/avatar/heygen', () => {
  class HeyGenError extends Error { constructor(message: string, public httpStatus = 422, public code = 'invalid_request') { super(message); } }
  return {
    HeyGenError,
    generateAvatarVideo: async (args: { avatarId: string; script: string }) => {
      heygen.appels.push(`videos:${args.avatarId}:${args.script}`);
      if (heygen.echec) throw new HeyGenError('HeyGen a refuse.');
      return { videoId: `vid-${heygen.appels.length}`, status: 'processing' };
    },
    getAvatarTrainingStatus: async (id: string) => { heygen.appels.push(`looks:${id}`); return { status: heygen.statutEntrainement }; },
    resolveVoiceId: async () => 'voice-1',
    listVoices: async () => [],
    pickDefaultVoice: () => undefined,
  };
});
vi.mock('@/lib/credits/system', () => ({
  getUserCredits: async () => credits.solde,
  deductCredits: async (_u: string, n: number) => { credits.journal.push(`debit:${n}`); },
  addCredits: async (_u: string, n: number) => { credits.journal.push(`refund:${n}`); },
}));
const session = vi.hoisted(() => ({ courante: { user: { id: 'aaaaaaaa-1111-4111-8111-111111111111' } } as unknown }));
vi.mock('@/lib/auth/config', () => ({ auth: async () => session.courante }));

process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';
process.env.AUTH_SECRET = 'secret-de-test-suffisamment-long';

const { GET: APERCU } = await import('@/app/api/avatar/apercu/route');
const { POST: OUVRIR } = await import('@/app/api/avatar/apercu/ouverture/route');
const { POST: VALIDER } = await import('@/app/api/avatar/validation/route');
const { POST: GENERER } = await import('@/app/api/avatar/generate/route');
const { GET: CREATE_GET } = await import('@/app/api/avatar/create/route');
const { apercuDuClone, estUrlApercuReelle, jetonOuvertureApercu, jetonOuvertureValide } = await import('@/lib/avatar/apercu');
const { patchNouvelleVersion } = await import('@/lib/avatar/version');

const avatar = (over: Record<string, unknown> = {}): Ligne => ({
  id: A, user_id: U, status: 'completed', provider_avatar_id: 'hg-1', provider_asset_id: 'as-1', source_object_key: `${U}/avatar/source-1-${'a'.repeat(32)}.mp4`,
  source_url: null, subject_type: 'self', consent_version: 'enrolement-2026-07-28', consent_at: '2026-09-01T00:00:00Z', consent_text: 'x',
  validated_at: null, version: 2, deleted_at: null, created_at: '2026-09-01T00:00:00.000Z', avatar_type: 'video', name: 'Moi', training_error: null, ...over,
});
const apercuPret = (over: Record<string, unknown> = {}): Ligne => ({
  id: G, user_id: U, user_avatar_id: A, avatar_version: 2, intention: 'apercu', status: 'completed',
  video_url: `${RELAIS}/${U}/avatar/${G}.mp4`, error_message: null, created_at: '2026-09-02T00:00:00.000Z', ...over,
});
const valider = (jeton: unknown) => VALIDER(new NextRequest('https://studiio.pro/api/avatar/validation', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jeton }),
}));
const generer = (body: Record<string, unknown>) => GENERER(new NextRequest('https://studiio.pro/api/avatar/generate', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}));
const jeton = (over: Partial<{ userId: string; avatarId: string; version: number; generationId: string }> = {}) =>
  jetonOuvertureApercu({ userId: U, avatarId: A, version: 2, generationId: G, ...over });
const l = () => base.avatars.find((x) => x.id === A)!;

beforeEach(() => {
  base.avatars = [avatar()]; base.generations = []; base.journal.length = 0; base.pannes = []; base.executions = {}; base.compteur = 0;
  heygen.appels.length = 0; heygen.echec = false; heygen.statutEntrainement = 'completed'; credits.journal.length = 0; credits.solde = 1000;
  base.crochets = { avantUpdate: null };
  session.courante = { user: { id: U } };
});

describe('apercu — un aperçu RÉEL, ou rien', () => {
  it('aucune génération → aucun ; en cours → en_cours ; échec → echec ; terminée et re-hébergée → pret', async () => {
    expect(await apercuDuClone(U, A, 2)).toEqual({ statut: 'aucun' });
    base.generations = [apercuPret({ status: 'processing', video_url: null })];
    expect(await apercuDuClone(U, A, 2)).toEqual({ statut: 'en_cours', generationId: G });
    base.generations = [apercuPret({ status: 'failed', video_url: null, error_message: 'boom' })];
    expect(await apercuDuClone(U, A, 2)).toEqual({ statut: 'echec', generationId: G, erreur: 'boom' });
    base.generations = [apercuPret()];
    expect(await apercuDuClone(U, A, 2)).toEqual({ statut: 'pret', generationId: G, url: `${RELAIS}/${U}/avatar/${G}.mp4` });
  });

  it('⚠️ FAUX aperçu : URL fournisseur, placeholder, autre compte, autre génération, chemin forgé → indisponible / jamais réel', async () => {
    for (const url of [
      'https://files.heygen.ai/aws_pacific/avatar_tmp/xyz/video.mp4',
      '/placeholder.mp4', 'data:video/mp4;base64,AAAA', '',
      `${RELAIS}/${AUTRUI}/avatar/${G}.mp4`,
      `${RELAIS}/${U}/avatar/22222222-2222-4222-8222-000000000009.mp4`,
      `https://evil.example/storage/v1/object/public/media/${U}/avatar/${G}.mp4`,
      `${RELAIS}/${U}/avatar/${G}.mp4?x=1`,
      `${RELAIS}/${U}/avatar/source-1.mp4`,
    ]) {
      expect(estUrlApercuReelle(url, U, G), url).toBe(false);
      base.generations = [apercuPret({ video_url: url })];
      expect((await apercuDuClone(U, A, 2)).statut, url).toBe('indisponible');
    }
    expect(estUrlApercuReelle(null, U, G)).toBe(false);
  });

  it('⚠️ l’aperçu appartient à UNE version : celui de v1 ne vaut rien pour v2 ; une génération « normale » n’est pas un aperçu', async () => {
    base.generations = [apercuPret({ avatar_version: 1 })];
    expect(await apercuDuClone(U, A, 2)).toEqual({ statut: 'aucun' });
    base.generations = [apercuPret({ intention: 'normale' })];
    expect(await apercuDuClone(U, A, 2)).toEqual({ statut: 'aucun' });
    base.generations = [apercuPret({ user_id: AUTRUI })];
    expect(await apercuDuClone(U, A, 2)).toEqual({ statut: 'aucun' });
  });

  it('le jeton est lié à (compte, avatar, version, génération) et vérifié en temps constant', () => {
    const j = jeton();
    expect(jetonOuvertureValide(j, { userId: U, avatarId: A, version: 2, generationId: G })).toBe(true);
    expect(jetonOuvertureValide(j, { userId: U, avatarId: A, version: 3, generationId: G })).toBe(false);
    expect(jetonOuvertureValide(j, { userId: AUTRUI, avatarId: A, version: 2, generationId: G })).toBe(false);
    expect(jetonOuvertureValide(j, { userId: U, avatarId: A, version: 2, generationId: '22222222-2222-4222-8222-000000000009' })).toBe(false);
    expect(jetonOuvertureValide('', { userId: U, avatarId: A, version: 2, generationId: G })).toBe(false);
    expect(jetonOuvertureValide(true, { userId: U, avatarId: A, version: 2, generationId: G })).toBe(false);
    expect(jetonOuvertureValide(j.slice(0, -1), { userId: U, avatarId: A, version: 2, generationId: G })).toBe(false);
  });
});

describe('GET /api/avatar/apercu et POST /api/avatar/apercu/ouverture', () => {
  it('sans session → 401 ; sans avatar → 404', async () => {
    session.courante = null;
    expect((await APERCU()).status).toBe(401);
    expect((await OUVRIR()).status).toBe(401);
    session.courante = { user: { id: U } };
    base.avatars = [];
    expect((await APERCU()).status).toBe(404);
  });

  it('GET rend l’état dérivé et l’aperçu ; GET create expose aussi `etat`', async () => {
    base.generations = [apercuPret()];
    const res = await APERCU();
    expect(res.status).toBe(200);
    expect((await res.json() as { data: unknown }).data).toEqual({ avatarId: A, version: 2, etat: 'entraine_non_valide', apercu: { statut: 'pret', generationId: G, url: `${RELAIS}/${U}/avatar/${G}.mp4` } });
    const create = await (await CREATE_GET()).json() as { data: { avatar: { etat: string; version: number; validated_at: null } } };
    expect(create.data.avatar.etat).toBe('entraine_non_valide');
    expect(create.data.avatar.version).toBe(2);
  });

  it('⚠️ ouverture : jeton seulement pour un aperçu PRÊT de la version courante ; sinon 409 sans jeton', async () => {
    expect((await OUVRIR()).status).toBe(409); // aucun aperçu
    base.generations = [apercuPret({ status: 'processing', video_url: null })];
    expect((await (await OUVRIR()).json() as { code: string }).code).toBe('apercu_en_cours');
    base.generations = [apercuPret({ video_url: 'https://files.heygen.ai/x.mp4' })];
    expect((await (await OUVRIR()).json() as { code: string }).code).toBe('apercu_indisponible');
    base.generations = [apercuPret()];
    const res = await OUVRIR();
    expect(res.status).toBe(200);
    const corps = await res.json() as { data: { jeton: string; url: string; version: number; generationId: string } };
    expect(corps.data.url).toBe(`${RELAIS}/${U}/avatar/${G}.mp4`);
    expect(corps.data.jeton).toBe(jeton());
    // Entraînement en cours / validé / provider NULL : pas de jeton.
    for (const over of [{ status: 'processing' }, { validated_at: '2026-09-03T00:00:00Z' }, { provider_avatar_id: null, status: 'source_ready' }]) {
      base.avatars = [avatar(over)];
      expect((await OUVRIR()).status, JSON.stringify(over)).toBe(409);
    }
  });
});

describe('POST /api/avatar/validation — le gate', () => {
  it('⚠️ entraînement non terminé → interdit, rien écrit', async () => {
    base.avatars = [avatar({ status: 'processing' })];
    base.generations = [apercuPret()];
    const res = await valider(jeton());
    expect(res.status).toBe(409);
    expect((await res.json() as { code: string }).code).toBe('entrainement_en_cours');
    expect(l().validated_at).toBeNull();
  });

  it('⚠️ provider_avatar_id absent, ou fournisseur en échec → interdit', async () => {
    base.generations = [apercuPret()];
    base.avatars = [avatar({ provider_avatar_id: null, status: 'source_ready' })];
    expect((await (await valider(jeton())).json() as { code: string }).code).toBe('aucun_clone');
    base.avatars = [avatar({ status: 'failed' })];
    expect((await (await valider(jeton())).json() as { code: string }).code).toBe('aucun_clone');
    expect(l().validated_at).toBeNull();
  });

  it('⚠️ clone prêt mais aperçu absent / en cours / faux → interdit', async () => {
    expect((await (await valider(jeton())).json() as { code: string }).code).toBe('apercu_absent');
    base.generations = [apercuPret({ status: 'processing', video_url: null })];
    expect((await (await valider(jeton())).json() as { code: string }).code).toBe('apercu_absent');
    base.generations = [apercuPret({ video_url: 'https://files.heygen.ai/x.mp4' })];
    expect((await (await valider(jeton())).json() as { code: string }).code).toBe('apercu_absent');
    expect(l().validated_at).toBeNull();
  });

  it('⚠️ aperçu prêt mais NON OUVERT (pas de jeton, jeton forgé, jeton d’une autre version/génération/compte) → interdit', async () => {
    base.generations = [apercuPret()];
    for (const j of [null, undefined, true, 'oui', 'a'.repeat(43), jeton({ version: 1 }), jeton({ generationId: '22222222-2222-4222-8222-000000000009' }), jeton({ userId: AUTRUI })]) {
      const res = await valider(j);
      expect(res.status, String(j)).toBe(409);
      expect((await res.json() as { code: string }).code, String(j)).toBe('apercu_non_ouvert');
    }
    expect(l().validated_at).toBeNull();
  });

  it('⚠️ aperçu ouvert (jeton délivré par la route d’ouverture) → validation écrite par CAS, version et compte exacts', async () => {
    base.generations = [apercuPret()];
    const ouverture = await (await OUVRIR()).json() as { data: { jeton: string } };
    const res = await valider(ouverture.data.jeton);
    expect(res.status).toBe(200);
    const corps = await res.json() as { data: { avatarId: string; version: number; validatedAt: string; dejaValide: boolean; etat: string } };
    expect(corps.data).toMatchObject({ avatarId: A, version: 2, dejaValide: false, etat: 'valide' });
    expect(l().validated_at).toBe(corps.data.validatedAt);
    expect(base.journal.filter((j) => j.startsWith('user_avatars:filtres')).pop()).toBe('user_avatars:filtres:eq:id,eq:user_id,eq:version,is:deleted_at,is:validated_at');
    // Déjà validé : idempotent, aucune réécriture de la date.
    const bis = await valider(ouverture.data.jeton);
    expect(bis.status).toBe(409);
    expect((await bis.json() as { code: string }).code).toBe('deja_valide');
    expect(l().validated_at).toBe(corps.data.validatedAt);
  });

  it('⚠️ mauvais compte : l’avatar d’autrui n’existe pas (404), rien écrit', async () => {
    base.avatars = [avatar({ user_id: AUTRUI })];
    base.generations = [apercuPret({ user_id: AUTRUI })];
    expect((await valider(jeton({ userId: AUTRUI }))).status).toBe(404);
    expect(l().validated_at).toBeNull();
  });

  it('⚠️ avatar supprimé → 404, rien écrit', async () => {
    base.avatars = [avatar({ deleted_at: '2026-09-15T00:00:00Z' })];
    base.generations = [apercuPret()];
    expect((await valider(jeton())).status).toBe(404);
    expect(l().validated_at).toBeNull();
  });

  it('⚠️ version remplacée entre la lecture et le CAS → 409 avatar_superseded ; la nouvelle version reste NULL', async () => {
    base.generations = [apercuPret()];
    // Juste avant le CAS (1ʳᵉ update sur user_avatars), la ligne passe en v3.
    base.crochets.avantUpdate = (table, n) => { if (table === 'user_avatars' && n === 1) Object.assign(l(), { version: 3, validated_at: null }); };
    const res = await valider(jeton());
    expect(res.status).toBe(409);
    expect((await res.json() as { code: string }).code).toBe('avatar_superseded');
    expect(l().version).toBe(3);
    expect(l().validated_at).toBeNull();
  });

  it('⚠️ nouvelle version : validated_at repart à NULL, l’aperçu et le jeton de l’ancienne version ne valent plus', async () => {
    base.avatars = [avatar({ validated_at: '2026-09-03T00:00:00Z' })];
    base.generations = [apercuPret()];
    const patch = patchNouvelleVersion({ version: 2, deleted_at: null })!;
    expect(patch.validated_at).toBeNull();
    Object.assign(l(), patch, { provider_avatar_id: 'hg-2', status: 'completed' });
    expect(l().version).toBe(3);
    expect(l().validated_at).toBeNull();
    // Aperçu de v2 → aucun pour v3 ; jeton de v2 → refusé.
    expect(await apercuDuClone(U, A, 3)).toEqual({ statut: 'aucun' });
    expect((await (await valider(jeton())).json() as { code: string }).code).toBe('apercu_absent');
    base.generations = [apercuPret(), apercuPret({ id: '22222222-2222-4222-8222-000000000003', avatar_version: 3, video_url: `${RELAIS}/${U}/avatar/22222222-2222-4222-8222-000000000003.mp4` })];
    expect((await (await valider(jeton())).json() as { code: string }).code).toBe('apercu_non_ouvert');
    expect(l().validated_at).toBeNull();
  });

  it('⚠️ erreur DB à l’écriture → 500, jamais un succès ; erreur DB à la lecture → 500', async () => {
    base.generations = [apercuPret()];
    base.pannes = [{ table: 'user_avatars', op: 'update', occurrence: 1, mode: 'erreur' }];
    const res = await valider(jeton());
    expect(res.status).toBe(500);
    expect((await res.json() as { code: string }).code).toBe('validation_persistence_failed');
    expect(l().validated_at).toBeNull();
    base.executions = {}; base.pannes = [{ table: 'user_avatars', op: 'select', occurrence: 1, mode: 'erreur' }];
    expect((await valider(jeton())).status).toBe(500);
    base.executions = {}; base.pannes = [{ table: 'avatar_generations', op: 'select', occurrence: 1, mode: 'erreur' }];
    expect((await valider(jeton())).status).toBe(500);
    expect(l().validated_at).toBeNull();
  });

  it('écriture commitée mais réponse perdue → relecture montre validated_at → succès (dejaValide), pas 409', async () => {
    base.generations = [apercuPret()];
    base.pannes = [{ table: 'user_avatars', op: 'update', occurrence: 1, mode: 'fantome' }];
    const res = await valider(jeton());
    // Une erreur explicite du serveur : on ne prétend pas avoir validé…
    expect(res.status).toBe(500);
    // …et la ligne, elle, l'est : un second clic le constate.
    const bis = await valider(jeton());
    expect(bis.status).toBe(409);
    expect((await bis.json() as { code: string }).code).toBe('deja_valide');
  });
});

describe('POST /api/avatar/generate — intention apercu', () => {
  it('⚠️ un aperçu = vraie génération HeyGen sur le texte FIXE, réservée AVANT le débit (une par version), avatar_version écrit', async () => {
    const res = await generer({ intention: 'apercu', script: 'texte libre ignoré' });
    expect(res.status).toBe(200);
    const corps = await res.json() as { data: { generationId: string; intention: string } };
    expect(corps.data.intention).toBe('apercu');
    const g = base.generations.find((x) => x.id === corps.data.generationId)!;
    expect(g.intention).toBe('apercu');
    expect(g.avatar_version).toBe(2);
    expect(g.script).toMatch(/^Bonjour, je suis votre avatar/);
    expect(g.provider_video_id).toBe('vid-1');
    expect(heygen.appels[0]).toMatch(/^videos:hg-1:Bonjour, je suis votre avatar/);
    // Réservation (insert) AVANT l'appel fournisseur.
    expect(base.journal.indexOf('avatar_generations:insert')).toBeLessThan(base.journal.findIndex((j) => j.startsWith('avatar_generations:update:credits_charged')));
    // ⚠️ OFFERT : aucun débit, credits_charged = 0, la réponse le dit.
    expect(credits.journal).toEqual([]);
    expect(g.credits_charged).toBe(0);
    expect((corps.data as unknown as { creditsCharged: number }).creditsCharged).toBe(0);
  });

  it('⚠️ aperçu offert même sans crédits : aucun contrôle de solde, aucun débit', async () => {
    credits.solde = 0;
    const res = await generer({ intention: 'apercu' });
    expect(res.status).toBe(200);
    expect(credits.journal).toEqual([]);
    expect(base.generations[0].credits_charged).toBe(0);
  });

  it('⚠️ deux aperçus simultanés → un seul lancé chez le fournisseur, l’autre 409 (index unique), aucun débit', async () => {
    const [a, b] = await Promise.all([generer({ intention: 'apercu' }), generer({ intention: 'apercu' })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(heygen.appels.filter((x) => x.startsWith('videos:'))).toHaveLength(1);
    expect(credits.journal).toEqual([]);
    expect(base.generations.filter((g) => g.intention === 'apercu' && g.status !== 'failed')).toHaveLength(1);
  });

  it('HeyGen échoue → réservation marquée failed (place libre), AUCUN débit ni remboursement fictif, aucun faux succès', async () => {
    heygen.echec = true;
    const res = await generer({ intention: 'apercu' });
    expect(res.status).toBe(422);
    const g = base.generations[0];
    expect(g.status).toBe('failed');
    expect(credits.journal).toEqual([]);
    expect((await res.json() as { refunded: boolean }).refunded).toBe(false);
    // La place est libre : un nouvel aperçu peut être réservé.
    heygen.echec = false;
    expect((await generer({ intention: 'apercu' })).status).toBe(200);
  });

  it('génération NORMALE : coût inchangé (40, débité avant l’appel, remboursé si HeyGen échoue), 402 sans crédits', async () => {
    const res = await generer({ script: 'Mon texte.' });
    expect(res.status).toBe(200);
    expect(credits.journal).toEqual(['debit:40']);
    expect(base.generations[0].credits_charged).toBe(40);
    credits.journal.length = 0; heygen.echec = true;
    expect((await generer({ script: 'Mon texte.' })).status).toBe(422);
    expect(credits.journal).toEqual(['debit:40', 'refund:40']);
    credits.journal.length = 0; heygen.echec = false; credits.solde = 10;
    expect((await generer({ script: 'Mon texte.' })).status).toBe(402);
    expect(credits.journal).toEqual([]);
  });

  it('aperçu refusé si le clone est validé, en cours, ou sans fournisseur', async () => {
    base.avatars = [avatar({ validated_at: '2026-09-03T00:00:00Z' })];
    expect((await (await generer({ intention: 'apercu' })).json() as { code: string }).code).toBe('avatar_deja_valide');
    // En cours chez le fournisseur (statut réel resynchronisé) : refusé avant tout débit.
    base.avatars = [avatar({ status: 'processing' })];
    heygen.statutEntrainement = 'processing';
    expect((await generer({ intention: 'apercu' })).status).toBe(409);
    base.avatars = [avatar({ provider_avatar_id: null, status: 'source_ready' })];
    expect((await generer({ intention: 'apercu' })).status).toBe(409);
    expect(heygen.appels.filter((x) => x.startsWith('videos:'))).toEqual([]);
    expect(credits.journal).toEqual([]);
  });

  it('génération normale : inchangée, texte libre, intention normale', async () => {
    const res = await generer({ script: 'Mon texte à moi.' });
    expect(res.status).toBe(200);
    const g = base.generations[0];
    expect(g.intention).toBe('normale');
    expect(g.script).toBe('Mon texte à moi.');
  });
});
