/**
 * A_8f — L'OPT-IN QUI S'ÉCRIT, ET LA PRÉPARATION QUI S'EFFACE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DEUX ROUTES, DEUX PROMESSES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `PUT /api/autopilot/jumeau` promet qu'on n'active jamais ce qui ne pourrait
 * pas servir. Le corps porte un `avatarId` et un `userVoiceId` — deux
 * identifiants que n'importe qui peut écrire. Ils ne sont donc jamais crus.
 *
 * `POST /api/avatar/enrollment/suppression` promet de dire la vérité sur ce
 * qu'elle supprime : une préparation locale, oui ; un clone qui existe chez un
 * fournisseur, non — et elle refuse plutôt que de le laisser croire.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Ligne = Record<string, unknown>;

const UID = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRUI = 'bbbbbbbb-2222-4222-8222-222222222222';
const AVATAR = 'cccccccc-3333-4333-8333-333333333333';
const VOIX = 'dddddddd-4444-4444-8444-444444444444';
const SOURCE = `${UID}/avatar/source-1700000000.mp4`;

let tables: Record<string, Ligne[]> = {};
let objets: Set<string>;
let retires: string[];
let voixDuCompte: Ligne[] = [];

function requete(table: string) {
  const eq: [string, unknown][] = [];
  const estNul: string[] = [];
  let limite: number | null = null;
  let majPatch: Ligne | null = null;
  let insertion: Ligne | null = null;

  const filtrees = (): Ligne[] => {
    let out = [...(tables[table] ?? [])];
    for (const [c, v] of eq) out = out.filter((l) => l[c] === v);
    for (const c of estNul) out = out.filter((l) => l[c] === null || l[c] === undefined);
    if (limite !== null) out = out.slice(0, limite);
    return out;
  };

  const executer = (): { data: Ligne[]; error: unknown } => {
    if (insertion) {
      const ligne = { ...insertion };
      tables[table] = [...(tables[table] ?? []), ligne];
      return { data: [ligne], error: null };
    }
    if (majPatch) {
      const cibles = filtrees();
      for (const l of cibles) Object.assign(l, majPatch);
      return { data: cibles, error: null };
    }
    return { data: filtrees(), error: null };
  };

  const api: Record<string, unknown> = {
    select: () => api,
    eq: (c: string, v: unknown) => { eq.push([c, v]); return api; },
    is: (c: string, v: unknown) => { if (v === null) estNul.push(c); return api; },
    order: () => api,
    limit: (n: number) => { limite = n; return api; },
    insert: (l: Ligne) => { insertion = l; return api; },
    update: (l: Ligne) => { majPatch = l; return api; },
    upsert: (l: Ligne) => { insertion = l; return api; },
    single: async () => {
      const { data } = executer();
      return data.length ? { data: data[0], error: null } : { data: null, error: { message: 'vide' } };
    },
    maybeSingle: async () => ({ data: executer().data[0] ?? null, error: null }),
    then: (r: (v: unknown) => unknown) => r(executer()),
  };
  return api;
}

const stockage = () => ({
  from: () => ({
    remove: async (cles: string[]) => {
      for (const c of cles) { retires.push(c); objets.delete(c); }
      return { data: null, error: null };
    },
  }),
});

let utilisateurConnecte: string | null = UID;

/**
 * La fusion atomique de `design_style`, telle que la base la fait.
 *
 * ⚠️ ELLE FUSIONNE CLÉ PAR CLÉ, comme le `jsonb ||` de la fonction SQL. Un
 * faux qui REMPLACERAIT le document laisserait passer une régression que la
 * production révélerait : les réglages voisins effacés à chaque activation.
 */
function fusionner(userId: string, patch: Ligne) {
  const lignes = tables.autopilot_config ?? [];
  const ligne = lignes.find((l) => l.user_id === userId);
  if (!ligne) {
    tables.autopilot_config = [...lignes, { user_id: userId, design_style: { ...patch } }];
    return { error: null };
  }
  ligne.design_style = { ...(ligne.design_style as Ligne ?? {}), ...patch };
  return { error: null };
}

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: (t: string) => requete(t),
    storage: { from: () => stockage().from() },
    rpc: async (_nom: string, args: { p_user_id: string; p_patch: Ligne }) =>
      fusionner(args.p_user_id, args.p_patch),
  },
  supabase: { from: (t: string) => requete(t), storage: { from: () => stockage().from() } },
}));
vi.mock('@/lib/auth/config', () => ({
  auth: async () => (utilisateurConnecte ? { user: { id: utilisateurConnecte } } : null),
}));
vi.mock('@/lib/voice/store', () => ({
  listUserVoices: async (userId: string) => voixDuCompte.filter((v) => v.user_id === userId),
}));

import { PUT as ACTIVER, GET as LIRE_JUMEAU } from '@/app/api/autopilot/jumeau/route';
import { POST as SUPPRIMER } from '@/app/api/avatar/enrollment/suppression/route';

const AVATAR_COMPLET: Ligne = {
  id: AVATAR, user_id: UID, status: 'completed', provider_avatar_id: 'hg_1',
  validated_at: '2026-09-09T12:00:00Z', deleted_at: null,
  subject_type: 'self', version: 1, source_object_key: SOURCE,
  created_at: '2026-09-09T10:00:00Z',
};

function socle(avatar: Partial<Ligne> | null = {}, style: Ligne = {}) {
  tables = {
    user_avatars: avatar === null ? [] : [{ ...AVATAR_COMPLET, ...avatar }],
    autopilot_config: [{ user_id: UID, design_style: style }],
    avatar_generations: [{
      id: 'gen-1', user_id: UID, user_avatar_id: AVATAR,
      status: 'completed', video_url: 'https://x/deja.mp4',
    }],
  };
  objets = new Set([SOURCE, `${UID}/library/original.mp4`]);
  retires = [];
  voixDuCompte = [{
    id: VOIX, user_id: UID, provider_voice_id: 'el_1', name: 'Bassi',
    consent_at: '2026-09-01T10:00:00Z',
  }];
}

beforeEach(() => {
  utilisateurConnecte = UID;
  socle();
});

const activer = (jumeau: Ligne) => ACTIVER(
  { json: async () => ({ jumeau }) } as never,
);
const styleRange = () => (tables.autopilot_config[0].design_style ?? {}) as Ligne;

// ═══════════════════════════════════════════════════════════════════════════
describe('1. On n’active pas ce qui ne pourrait pas servir', () => {
  it('1.1 ⚠️ UNE SOURCE PRÊTE NE S’ACTIVE PAS', async () => {
    socle({ provider_avatar_id: null, status: 'source_ready', validated_at: null });
    const res = await activer({ active: true, avatarId: AVATAR, userVoiceId: VOIX });
    expect(res.status).toBe(409);
    expect((await res.json()).motif).toBe('avatar_non_entraine');
    expect(styleRange().jumeauNumerique).toBeUndefined();
  });

  it('1.2 ⚠️ UN CLONE NON VALIDÉ NE S’ACTIVE PAS', async () => {
    socle({ validated_at: null });
    const res = await activer({ active: true, avatarId: AVATAR, userVoiceId: VOIX });
    expect(res.status).toBe(409);
    expect((await res.json()).motif).toBe('clone_non_valide');
  });

  it('1.3 ⚠️ L’AVATAR D’AUTRUI EST INEXPRIMABLE', async () => {
    /* La lecture est filtrée par le compte : l'avatar d'un tiers ne revient
       pas, donc il n'y a rien à décider ensuite. */
    socle({ user_id: AUTRUI });
    const res = await activer({ active: true, avatarId: AVATAR, userVoiceId: VOIX });
    expect(res.status).toBe(409);
    expect((await res.json()).motif).toBe('avatar_absent');
  });

  it('1.4 ⚠️ LA VOIX D’AUTRUI N’EST PAS RETENUE', async () => {
    voixDuCompte = [{
      id: VOIX, user_id: AUTRUI, provider_voice_id: 'el_1', name: 'X',
      consent_at: '2026-09-01T10:00:00Z',
    }];
    const res = await activer({ active: true, avatarId: AVATAR, userVoiceId: VOIX });
    expect(res.status).toBe(200);
    // Activée, mais SANS cette voix : Autopilote restera fermé.
    expect((styleRange().jumeauNumerique as Ligne).userVoiceId).toBeNull();
  });

  it('1.5 ⚠️ SANS VOIX, ON PEUT CONFIGURER — MAIS ON LE DIT', async () => {
    voixDuCompte = [];
    const res = await activer({ active: true, avatarId: AVATAR, userVoiceId: null });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.voixPrete).toBe(false);
    expect(json.jumeau.active).toBe(true);
    expect(json.jumeau.userVoiceId).toBeNull();
  });

  it('1.6 configuration complète : activée, voix retenue', async () => {
    const res = await activer({ active: true, avatarId: AVATAR, userVoiceId: VOIX });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.voixPrete).toBe(true);
    expect(json.jumeau).toEqual({
      active: true, avatarId: AVATAR, avatarVersion: 1, userVoiceId: VOIX,
    });
  });

  it('1.7 ⚠️ LA VERSION EST RECOPIÉE DE LA LIGNE, PAS DU CORPS', async () => {
    socle({ version: 3 });
    const res = await activer({
      active: true, avatarId: AVATAR, avatarVersion: 1, userVoiceId: VOIX,
    });
    expect((await res.json()).jumeau.avatarVersion).toBe(3);
  });

  it('1.8 ⚠️ ÉTEINDRE N’EXIGE AUCUNE PREUVE', async () => {
    /* On ne demande pas à quelqu'un de prouver la validité de son clone pour
       cesser de s'en servir : la sortie doit toujours être ouverte. */
    socle({ validated_at: null, provider_avatar_id: null });
    const res = await activer({ active: false, avatarId: AVATAR });
    expect(res.status).toBe(200);
    expect((await res.json()).jumeau.active).toBe(false);
  });

  it('1.9 sans session, 401 et rien n’est écrit', async () => {
    utilisateurConnecte = null;
    expect((await activer({ active: true, avatarId: AVATAR })).status).toBe(401);
    expect((await LIRE_JUMEAU()).status).toBe(401);
    expect(styleRange().jumeauNumerique).toBeUndefined();
  });

  it('1.10 la lecture rend la configuration rangée', async () => {
    await activer({ active: true, avatarId: AVATAR, userVoiceId: VOIX });
    const json = await (await LIRE_JUMEAU()).json();
    expect(json.jumeau.active).toBe(true);
    expect(json.jumeau.avatarId).toBe(AVATAR);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Supprimer sa préparation', () => {
  it('2.1 ⚠️ UNE PRÉPARATION LOCALE PART, SOURCE COMPRISE', async () => {
    socle({ provider_avatar_id: null, status: 'source_ready', validated_at: null });
    const res = await SUPPRIMER();
    expect(res.status).toBe(200);
    expect(retires).toEqual([SOURCE]);
    expect(typeof tables.user_avatars[0].deleted_at).toBe('string');
    expect(tables.user_avatars[0].source_object_key).toBeNull();
  });

  it('2.2 ⚠️ LES VIDÉOS DÉJÀ PRODUITES SURVIVENT', async () => {
    socle({ provider_avatar_id: null, status: 'source_ready', validated_at: null });
    await SUPPRIMER();
    expect(tables.avatar_generations).toHaveLength(1);
    expect(tables.avatar_generations[0].video_url).toBe('https://x/deja.mp4');
  });

  it('2.3 ⚠️ LE MÉDIA D’ORIGINE DE LA MÉDIATHÈQUE N’EST JAMAIS TOUCHÉ', async () => {
    socle({ provider_avatar_id: null, status: 'source_ready', validated_at: null });
    await SUPPRIMER();
    expect(objets.has(`${UID}/library/original.mp4`)).toBe(true);
    expect(retires).not.toContain(`${UID}/library/original.mp4`);
  });

  it('2.4 ⚠️ L’OPT-IN AUTOPILOTE TOMBE AVEC LA PRÉPARATION', async () => {
    /* Sinon un réglage « actif » désignerait une préparation supprimée, et
       chaque créneau produirait un blocage nommé pour un clone que la
       personne vient elle-même de retirer. */
    socle({ provider_avatar_id: null, status: 'source_ready', validated_at: null },
      { jumeauNumerique: { active: true, avatarId: AVATAR, avatarVersion: 1, userVoiceId: VOIX } });
    await SUPPRIMER();
    const range = styleRange().jumeauNumerique as Ligne | undefined;
    expect(range === undefined || range.active === false).toBe(true);
  });

  it('2.5 ⚠️ UN VRAI CLONE N’EST JAMAIS DIT SUPPRIMÉ', async () => {
    /* La route ne sait pas supprimer chez le fournisseur. Prétendre le
       contraire ferait croire à quelqu'un que son visage a quitté un service
       où il resterait. */
    socle();
    const res = await SUPPRIMER();
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.motif).toBe('clone_chez_fournisseur');
    expect(json.error).toContain('existe encore');
    // Et rien n'a bougé.
    expect(retires).toEqual([]);
    expect(tables.user_avatars[0].deleted_at).toBeNull();
    expect(tables.user_avatars[0].source_object_key).toBe(SOURCE);
  });

  it('2.6 sans préparation, 404 plutôt qu’un faux succès', async () => {
    socle(null);
    expect((await SUPPRIMER()).status).toBe(404);
  });

  it('2.7 une préparation déjà supprimée ne se resupprime pas', async () => {
    socle({
      provider_avatar_id: null, status: 'source_ready', validated_at: null,
      deleted_at: '2026-09-09T13:00:00Z',
    });
    expect((await SUPPRIMER()).status).toBe(404);
    expect(retires).toEqual([]);
  });

  it('2.8 sans session, 401', async () => {
    utilisateurConnecte = null;
    expect((await SUPPRIMER()).status).toBe(401);
    expect(retires).toEqual([]);
  });
});
