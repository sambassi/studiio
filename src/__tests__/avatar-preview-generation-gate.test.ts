/**
 * A_8f (correctif Gap-1) — GÉNÉRER EXIGE UN CLONE VALIDÉ ; L'APERÇU EST L'EXCEPTION NOMMÉE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LE DÉFAUT QUE CE FICHIER FERME
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `/api/avatar/generate` ne lisait jamais `validated_at`. Le portail Autopilote
 * exigeait la validation du clone ; un appel direct à la route n'exigeait
 * rien : n'importe quel texte partait chez le fournisseur avant que la
 * personne ait accepté de prêter son visage.
 *
 * Mais la validation exige d'avoir VU le clone, et ce qu'on voit est une
 * génération. Exiger `validated_at` partout rendait la validation impossible
 * à jamais. D'où DEUX intentions :
 *
 *   apercu  — avant validation, une seule fois par version, script fixé par
 *             Studiio ;
 *   normale — après validation seulement.
 *
 * ⚠️ AUCUNE ASSERTION N'EST UNE EXPRESSION RÉGULIÈRE SUR LE SOURCE. Chaque
 * test monte la route, l'appelle, et lit la réponse, la base et les compteurs
 * du fournisseur simulé. Aucun appel réel ne peut partir : le module
 * fournisseur est remplacé en entier.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Ligne = Record<string, unknown>;

const UID = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRUI = 'bbbbbbbb-2222-4222-8222-222222222222';
const AVATAR = 'cccccccc-3333-4333-8333-333333333333';
const AVATAR_AUTRUI = 'dddddddd-4444-4444-8444-444444444444';

let tables: Record<string, Ligne[]> = {};
let compteurId = 0;

// ───────────────────────────────────────────────────────────────────────────
// La base, en mémoire — avec l'index unique partiel de la migration
// ───────────────────────────────────────────────────────────────────────────

/** `avatar_generations_apercu_unique` : (user_avatar_id, avatar_version) où intention='apercu' et status<>'failed'. */
function violeIndexApercu(table: string, ligne: Ligne): boolean {
  if (table !== 'avatar_generations') return false;
  if (ligne.intention !== 'apercu' || ligne.status === 'failed') return false;
  return (tables[table] ?? []).some((l) => l.intention === 'apercu' && l.status !== 'failed'
    && l.user_avatar_id === ligne.user_avatar_id && l.avatar_version === ligne.avatar_version);
}

function requete(table: string) {
  const eq: [string, unknown][] = [];
  const neq: [string, unknown][] = [];
  const estNul: string[] = [];
  let tri: { c: string; asc: boolean } | null = null;
  let limite: number | null = null;
  let majPatch: Ligne | null = null;
  let insertion: Ligne | null = null;

  const filtrees = (): Ligne[] => {
    let out = [...(tables[table] ?? [])];
    for (const [c, v] of eq) out = out.filter((l) => l[c] === v);
    for (const [c, v] of neq) out = out.filter((l) => l[c] !== v);
    for (const c of estNul) out = out.filter((l) => l[c] === null || l[c] === undefined);
    if (tri) {
      const { c, asc } = tri;
      out.sort((a, b) => {
        const x = String(a[c] ?? ''); const y = String(b[c] ?? '');
        return asc ? x.localeCompare(y) : y.localeCompare(x);
      });
    }
    if (limite !== null) out = out.slice(0, limite);
    return out;
  };

  const executer = (): { data: Ligne[]; error: { code?: string; message: string } | null } => {
    if (insertion) {
      /* ⚠️ LA CONTRAINTE CHECK DE LA MIGRATION : un aperçu sans version est
         refusé par la base, pas seulement par le code. */
      if (insertion.intention === 'apercu' && (insertion.avatar_version === null
        || insertion.avatar_version === undefined)) {
        return { data: [], error: { code: '23514', message: 'avatar_generations_apercu_versionne_check' } };
      }
      if (violeIndexApercu(table, insertion)) {
        return { data: [], error: { code: '23505', message: 'duplicate key value violates unique constraint "avatar_generations_apercu_unique"' } };
      }
      compteurId += 1;
      const ligne = { id: `gen-${compteurId}`, created_at: new Date().toISOString(), ...insertion };
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
    neq: (c: string, v: unknown) => { neq.push([c, v]); return api; },
    is: (c: string, v: unknown) => { if (v === null) estNul.push(c); return api; },
    order: (c: string, o?: { ascending?: boolean }) => { tri = { c, asc: o?.ascending !== false }; return api; },
    limit: (n: number) => { limite = n; return api; },
    insert: (l: Ligne) => { insertion = l; return api; },
    update: (l: Ligne) => { majPatch = l; return api; },
    single: async () => {
      const { data, error } = executer();
      if (error) return { data: null, error };
      return data.length ? { data: data[0], error: null } : { data: null, error: { message: 'aucune ligne' } };
    },
    maybeSingle: async () => {
      const { data, error } = executer();
      return { data: error ? null : (data[0] ?? null), error: error ?? null };
    },
    then: (resoudre: (v: unknown) => unknown) => resoudre(executer()),
  };
  return api;
}

let utilisateurConnecte: string | null = UID;

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: (t: string) => requete(t) },
  supabase: { from: (t: string) => requete(t) },
}));
vi.mock('@/lib/auth/config', () => ({
  auth: async () => (utilisateurConnecte ? { user: { id: utilisateurConnecte } } : null),
}));

// ───────────────────────────────────────────────────────────────────────────
// Le fournisseur, remplacé en entier — et compté
// ───────────────────────────────────────────────────────────────────────────

const compteurs = { generation: 0, statut: 0, voix: 0 };
let generationEchoue = false;
let statutDistant: string | null = 'completed';

vi.mock('@/lib/avatar/heygen', () => {
  class HeyGenError extends Error {
    httpStatus: number; code: string;
    constructor(m: string, s = 502, c = 'heygen') { super(m); this.httpStatus = s; this.code = c; }
  }
  return {
    HeyGenError,
    generateAvatarVideo: async () => {
      compteurs.generation += 1;
      if (generationEchoue) throw new HeyGenError('fournisseur en panne', 502, 'provider_down');
      return { videoId: `vid-${compteurs.generation}`, status: 'pending' };
    },
    getAvatarTrainingStatus: async () => { compteurs.statut += 1; return statutDistant ? { status: statutDistant } : null; },
    resolveVoiceId: async (v?: string) => { compteurs.voix += 1; return v ?? 'voix-simulee'; },
  };
});

const credits = { debits: 0, remboursements: 0, solde: 100 };
vi.mock('@/lib/credits/system', () => ({
  getUserCredits: async () => credits.solde,
  deductCredits: async () => { credits.debits += 1; return true; },
  addCredits: async () => { credits.remboursements += 1; },
}));

import { POST as GENERER } from '@/app/api/avatar/generate/route';
import { POST as VALIDER } from '@/app/api/avatar/[id]/validation/route';
import { generationPossible } from '@/lib/avatar/etats';
import {
  SCRIPT_APERCU, APERCU_SCRIPT_MAX_CHARS, APERCU_DUREE_MAX_S, lireIntention,
} from '@/lib/avatar/contrat';
import { AVATAR_VIDEO_COST } from '@/lib/stripe/constants';

/** Un clone RÉELLEMENT entraîné (fixture de test — aucun fournisseur derrière). */
const ENTRAINE = {
  status: 'completed', provider_avatar_id: 'hg_reel_v1', validated_at: null, version: 1,
};

function socle(avatar: Partial<Ligne> | null = {}, generations: Ligne[] = []) {
  tables = {
    user_avatars: avatar === null ? [] : [{
      id: AVATAR, user_id: UID, provider: 'heygen', avatar_type: 'video',
      provider_avatar_id: null, status: 'source_ready', validated_at: null, version: 1,
      deleted_at: null, consent_at: '2026-09-09T10:00:00Z', subject_type: 'self',
      created_at: '2026-09-09T10:00:00Z',
      ...avatar,
    }],
    avatar_generations: generations,
  };
}

beforeEach(() => {
  utilisateurConnecte = UID;
  compteurs.generation = 0; compteurs.statut = 0; compteurs.voix = 0;
  credits.debits = 0; credits.remboursements = 0; credits.solde = 100;
  generationEchoue = false;
  statutDistant = 'completed';
  compteurId = 0;
  socle();
});

const generer = (corps: Record<string, unknown>) => GENERER({ json: async () => corps } as never);
const apercu = (extra: Record<string, unknown> = {}) => generer({ avatarId: AVATAR, intention: 'apercu', ...extra });
const normale = (extra: Record<string, unknown> = {}) => generer({
  avatarId: AVATAR, intention: 'normale', script: 'Bienvenue chez Afroboost.', ...extra,
});
const valider = (id = AVATAR) => VALIDER({} as never, { params: { id } });

const generations = () => tables.avatar_generations;
const apercus = () => generations().filter((g) => g.intention === 'apercu');

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Le portail, avant toute route', () => {
  it('1.1 ⚠️ UNE SOURCE PRÊTE NE GÉNÈRE RIEN, NI APERÇU NI VIDÉO', () => {
    const src = { status: 'source_ready', provider_avatar_id: null, validated_at: null, version: 1 };
    expect(generationPossible({ avatar: src, intention: 'apercu', apercuOccupe: false }))
      .toEqual({ ok: false, motif: 'aucun_clone' });
    expect(generationPossible({ avatar: src, intention: 'normale', apercuOccupe: false }))
      .toEqual({ ok: false, motif: 'aucun_clone' });
  });

  it('1.2 un entraînement non terminé refuse les deux intentions', () => {
    const enCours = { ...ENTRAINE, status: 'processing' };
    expect(generationPossible({ avatar: enCours, intention: 'apercu', apercuOccupe: false }).ok).toBe(false);
    expect(generationPossible({ avatar: enCours, intention: 'normale', apercuOccupe: false }).ok).toBe(false);
  });

  it('1.3 ⚠️ L’APERÇU PASSE SANS VALIDATION, LA GÉNÉRATION NORMALE NON', () => {
    expect(generationPossible({ avatar: ENTRAINE, intention: 'apercu', apercuOccupe: false }))
      .toEqual({ ok: true, version: 1 });
    expect(generationPossible({ avatar: ENTRAINE, intention: 'normale', apercuOccupe: false }))
      .toEqual({ ok: false, motif: 'clone_non_valide' });
  });

  it('1.4 un aperçu déjà produit ferme l’aperçu', () => {
    expect(generationPossible({ avatar: ENTRAINE, intention: 'apercu', apercuOccupe: true }))
      .toEqual({ ok: false, motif: 'apercu_deja_produit' });
  });

  it('1.5 validé, la génération normale s’ouvre — et n’est plus limitée', () => {
    const valide = { ...ENTRAINE, validated_at: '2026-09-10T10:00:00Z' };
    expect(generationPossible({ avatar: valide, intention: 'normale', apercuOccupe: true }))
      .toEqual({ ok: true, version: 1 });
  });

  it('1.6 sans version connue, rien ne part', () => {
    expect(generationPossible({ avatar: { ...ENTRAINE, version: undefined }, intention: 'apercu', apercuOccupe: false }))
      .toEqual({ ok: false, motif: 'version_absente' });
  });

  it('1.7 ⚠️ L’INTENTION EST LUE EN TOUTES LETTRES, JAMAIS DEVINÉE', () => {
    expect(lireIntention('apercu')).toBe('apercu');
    expect(lireIntention('normale')).toBe('normale');
    expect(lireIntention(undefined)).toBeNull();
    expect(lireIntention('preview')).toBeNull();
    expect(lireIntention('')).toBeNull();
  });

  it('1.8 le script d’aperçu est court, borné, et la borne représente ~20 s', () => {
    expect(SCRIPT_APERCU.length).toBeLessThanOrEqual(APERCU_SCRIPT_MAX_CHARS);
    expect(APERCU_SCRIPT_MAX_CHARS).toBeLessThanOrEqual(300);
    expect(APERCU_DUREE_MAX_S).toBeLessThanOrEqual(20);
    // Il parle du clone, pas d'un produit : c'est un texte de contrôle.
    expect(SCRIPT_APERCU).toMatch(/clone/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. La route — source prête', () => {
  it('2.1 ⚠️ SOURCE_READY : APERÇU REFUSÉ, AUCUN APPEL FOURNISSEUR', async () => {
    const res = await apercu();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('aucun_clone');
    expect(compteurs.generation).toBe(0);
    expect(compteurs.statut).toBe(0);
    expect(generations()).toHaveLength(0);
  });

  it('2.2 SOURCE_READY : génération normale refusée, aucun appel', async () => {
    const res = await normale();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('aucun_clone');
    expect(compteurs.generation).toBe(0);
    expect(credits.debits).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. La route — clone entraîné, pas encore validé', () => {
  it('3.1 ⚠️ CE TEST ÉCHOUAIT AVANT LE CORRECTIF : validated_at NULL → génération normale refusée, fournisseur jamais appelé', async () => {
    /* L'ancienne route passait ici et appelait le fournisseur (compteur à 1).
       C'est la preuve de Gap-1. */
    socle(ENTRAINE);
    const res = await normale();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('clone_non_valide');
    expect(compteurs.generation).toBe(0);
    expect(credits.debits).toBe(0);
    expect(generations()).toHaveLength(0);
  });

  it('3.2 ⚠️ L’APERÇU EST AUTORISÉ, ET IL ATTEINT LE FOURNISSEUR SIMULÉ', async () => {
    socle(ENTRAINE);
    const res = await apercu();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.intention).toBe('apercu');
    expect(compteurs.generation).toBe(1);
    expect(credits.debits).toBe(1);
    const [g] = apercus();
    expect(g.avatar_version).toBe(1);
    expect(g.provider_video_id).toBe('vid-1');
    expect(g.status).toBe('pending');
    expect(g.credits_charged).toBe(AVATAR_VIDEO_COST);
  });

  it('3.3 ⚠️ LE SCRIPT DE L’APERÇU EST CELUI DU SERVEUR — le texte envoyé est ignoré', async () => {
    socle(ENTRAINE);
    const libre = 'Achetez mon programme à 299 CHF, '.repeat(30);
    await apercu({ script: libre });
    expect(apercus()[0].script).toBe(SCRIPT_APERCU);
    expect(String(apercus()[0].script).length).toBeLessThanOrEqual(APERCU_SCRIPT_MAX_CHARS);
  });

  it('3.4 ⚠️ LA RÉSERVATION PRÉCÈDE LE FOURNISSEUR', async () => {
    /* Si le fournisseur échoue, la ligne existe déjà — en `failed`. C'est ce
       qui prouve qu'elle a été écrite avant l'appel, pas après. */
    socle(ENTRAINE);
    generationEchoue = true;
    const res = await apercu();
    expect(res.status).toBe(502);
    expect(compteurs.generation).toBe(1);
    expect(apercus()).toHaveLength(1);
    expect(apercus()[0].status).toBe('failed');
    expect(credits.remboursements).toBe(1);
  });

  it('3.5 ⚠️ UN APERÇU ÉCHOUÉ LIBÈRE LA PLACE : le retry est accepté', async () => {
    socle(ENTRAINE, [{
      user_id: UID, user_avatar_id: AVATAR, intention: 'apercu', avatar_version: 1,
      status: 'failed', created_at: '2026-09-10T09:00:00Z',
    }]);
    const res = await apercu();
    expect(res.status).toBe(200);
    expect(compteurs.generation).toBe(1);
    // L'échec reste dans l'historique : rien n'a été effacé pour réessayer.
    expect(apercus()).toHaveLength(2);
    expect(apercus().filter((g) => g.status === 'failed')).toHaveLength(1);
  });

  it('3.6 ⚠️ UN APERÇU TERMINÉ FERME L’APERÇU, ET LA NORMALE RESTE FERMÉE', async () => {
    socle(ENTRAINE, [{
      user_id: UID, user_avatar_id: AVATAR, intention: 'apercu', avatar_version: 1,
      status: 'completed', video_url: 'https://x/apercu.mp4', created_at: '2026-09-10T09:00:00Z',
    }]);
    const res = await apercu();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('apercu_deja_produit');
    const res2 = await normale();
    expect(res2.status).toBe(409);
    expect((await res2.json()).code).toBe('clone_non_valide');
    expect(compteurs.generation).toBe(0);
  });

  it('3.7 un aperçu en cours (pending) ferme aussi l’aperçu', async () => {
    socle(ENTRAINE, [{
      user_id: UID, user_avatar_id: AVATAR, intention: 'apercu', avatar_version: 1,
      status: 'pending', created_at: '2026-09-10T09:00:00Z',
    }]);
    const res = await apercu();
    expect(res.status).toBe(409);
    expect(compteurs.generation).toBe(0);
  });

  it('3.8 ⚠️ L’ARBITRE EST L’INDEX, PAS LA LECTURE : un conflit d’insertion refuse sans appel', async () => {
    /* La lecture « aucun aperçu » passe (la ligne concurrente arrive juste
       après), l'insertion se heurte à l'index unique : 409, compteur à zéro. */
    socle(ENTRAINE);
    const original = tables.avatar_generations;
    let lectures = 0;
    // Première lecture (apercuOccupe) : rien. Puis la concurrente s'insère.
    Object.defineProperty(tables, 'avatar_generations', {
      configurable: true,
      get: () => {
        lectures += 1;
        if (lectures === 2) {
          original.push({
            user_id: UID, user_avatar_id: AVATAR, intention: 'apercu', avatar_version: 1,
            status: 'pending', created_at: new Date().toISOString(),
          });
        }
        return original;
      },
      set: (v) => { original.splice(0, original.length, ...v); },
    });
    const res = await apercu();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('apercu_deja_produit');
    expect(compteurs.generation).toBe(0);
    expect(credits.debits).toBe(0);
  });

  it('3.9 la version suivante a droit à son propre aperçu', async () => {
    socle({ ...ENTRAINE, provider_avatar_id: 'hg_reel_v2', version: 2 }, [{
      user_id: UID, user_avatar_id: AVATAR, intention: 'apercu', avatar_version: 1,
      status: 'completed', video_url: 'https://x/apercu-v1.mp4', created_at: '2026-09-10T09:00:00Z',
    }]);
    const res = await apercu();
    expect(res.status).toBe(200);
    expect(apercus().find((g) => g.avatar_version === 2)).toBeTruthy();
  });

  it('3.10 un entraînement encore en cours refuse l’aperçu après un seul appel de statut', async () => {
    socle({ ...ENTRAINE, status: 'processing' });
    statutDistant = 'processing';
    const res = await apercu();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('avatar_not_ready');
    expect(compteurs.statut).toBe(1);
    expect(compteurs.generation).toBe(0);
  });

  it('3.11 un entraînement échoué refuse l’aperçu', async () => {
    socle({ ...ENTRAINE, status: 'failed' });
    statutDistant = 'failed';
    const res = await apercu();
    expect(res.status).toBe(409);
    expect(compteurs.generation).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. La route — clone validé', () => {
  const VALIDE = { ...ENTRAINE, validated_at: '2026-09-10T12:00:00Z' };
  const APERCU_V1 = {
    user_id: UID, user_avatar_id: AVATAR, intention: 'apercu', avatar_version: 1,
    status: 'completed', video_url: 'https://x/apercu.mp4', created_at: '2026-09-10T09:00:00Z',
  };

  it('4.1 ⚠️ LA GÉNÉRATION NORMALE ATTEINT LE FOURNISSEUR SIMULÉ', async () => {
    socle(VALIDE, [APERCU_V1]);
    const res = await normale();
    expect(res.status).toBe(200);
    expect(compteurs.generation).toBe(1);
    const g = generations().find((x) => x.intention === 'normale')!;
    expect(g.avatar_version).toBe(1);
    expect(g.script).toBe('Bienvenue chez Afroboost.');
  });

  it('4.2 elle n’est plus limitée à une vidéo', async () => {
    socle(VALIDE, [APERCU_V1]);
    expect((await normale()).status).toBe(200);
    expect((await normale()).status).toBe(200);
    expect(compteurs.generation).toBe(2);
  });

  it('4.3 un texte vide ou trop long est refusé avant tout', async () => {
    socle(VALIDE, [APERCU_V1]);
    expect((await normale({ script: '   ' })).status).toBe(400);
    expect((await normale({ script: 'x'.repeat(5000) })).status).toBe(400);
    expect(compteurs.generation).toBe(0);
  });

  it('4.4 ⚠️ SANS INTENTION, RIEN NE PART — même validé', async () => {
    socle(VALIDE, [APERCU_V1]);
    const res = await generer({ avatarId: AVATAR, script: 'Bonjour' });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('intention_invalide');
    expect(compteurs.generation).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. Le clone d’autrui', () => {
  const socleAutrui = () => {
    socle({ ...ENTRAINE, validated_at: '2026-09-10T12:00:00Z' });
    tables.user_avatars.push({
      id: AVATAR_AUTRUI, user_id: AUTRUI, provider: 'heygen', avatar_type: 'video',
      provider_avatar_id: 'hg_autrui', status: 'completed', validated_at: '2026-09-10T12:00:00Z',
      version: 1, deleted_at: null, consent_at: '2026-09-09T10:00:00Z', subject_type: 'self',
      created_at: '2026-09-09T10:00:00Z',
    });
  };

  it('5.1 aperçu : 404, aucun appel', async () => {
    socleAutrui();
    const res = await generer({ avatarId: AVATAR_AUTRUI, intention: 'apercu' });
    expect(res.status).toBe(404);
    expect(compteurs.generation).toBe(0);
  });

  it('5.2 génération normale : 404, aucun appel', async () => {
    socleAutrui();
    const res = await generer({ avatarId: AVATAR_AUTRUI, intention: 'normale', script: 'Bonjour' });
    expect(res.status).toBe(404);
    expect(compteurs.generation).toBe(0);
  });

  it('5.3 validation : 404, rien n’est écrit', async () => {
    socleAutrui();
    tables.avatar_generations = [{
      user_id: AUTRUI, user_avatar_id: AVATAR_AUTRUI, intention: 'apercu', avatar_version: 1,
      status: 'completed', video_url: 'https://x/a.mp4', created_at: '2026-09-10T09:00:00Z',
    }];
    tables.user_avatars[1].validated_at = null;
    const res = await valider(AVATAR_AUTRUI);
    expect(res.status).toBe(404);
    expect(tables.user_avatars[1].validated_at).toBeNull();
  });

  it('5.4 sans session : 401', async () => {
    utilisateurConnecte = null;
    expect((await apercu()).status).toBe(401);
    expect(compteurs.generation).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. La validation exige l’aperçu de la VERSION COURANTE', () => {
  const APERCU = (version: number) => ({
    user_id: UID, user_avatar_id: AVATAR, intention: 'apercu', avatar_version: version,
    status: 'completed', video_url: `https://x/apercu-v${version}.mp4`, created_at: '2026-09-10T09:00:00Z',
  });

  it('6.1 ⚠️ VERSION 2 AVEC UN APERÇU DE VERSION 1 : REFUS', async () => {
    socle({ ...ENTRAINE, provider_avatar_id: 'hg_reel_v2', version: 2 }, [APERCU(1)]);
    const res = await valider();
    expect(res.status).toBe(409);
    expect((await res.json()).motif).toBe('apercu_absent');
    expect(tables.user_avatars[0].validated_at).toBeNull();
  });

  it('6.2 version 2 avec son propre aperçu : validée', async () => {
    socle({ ...ENTRAINE, provider_avatar_id: 'hg_reel_v2', version: 2 }, [APERCU(1), APERCU(2)]);
    const res = await valider();
    expect(res.status).toBe(200);
    expect(typeof tables.user_avatars[0].validated_at).toBe('string');
  });

  it('6.3 ⚠️ UNE GÉNÉRATION NORMALE N’EST PAS UN APERÇU', async () => {
    socle(ENTRAINE, [{ ...APERCU(1), intention: 'normale' }]);
    const res = await valider();
    expect(res.status).toBe(409);
    expect((await res.json()).motif).toBe('apercu_absent');
  });

  it('6.4 une génération historique (sans version) ne valide rien', async () => {
    socle(ENTRAINE, [{ ...APERCU(1), intention: 'normale', avatar_version: null }]);
    expect((await valider()).status).toBe(409);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('7. Le parcours complet, de l’aperçu à la vidéo', () => {
  it('7.1 aperçu → (terminé) → validation → génération normale', async () => {
    socle(ENTRAINE);
    expect((await apercu()).status).toBe(200);
    expect((await normale()).status).toBe(409);          // pas encore validé
    expect((await valider()).status).toBe(409);          // aperçu pas encore terminé
    apercus()[0].status = 'completed';
    apercus()[0].video_url = 'https://x/apercu.mp4';
    expect((await apercu()).status).toBe(409);           // un seul aperçu par version
    expect((await valider()).status).toBe(200);
    expect((await normale()).status).toBe(200);
    expect(compteurs.generation).toBe(2);
  });
});
