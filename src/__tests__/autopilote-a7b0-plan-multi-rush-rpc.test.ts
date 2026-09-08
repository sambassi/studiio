/**
 * A_7B0 — LA GARDE DE LA CREATION ATOMIQUE MULTI-RUSH.
 *
 * ---------------------------------------------------------------------------
 * CE QUE CE FICHIER TIENT, ET CE QU'IL NE PEUT PAS TENIR
 * ---------------------------------------------------------------------------
 *
 * L'ATOMICITE est une propriete du moteur : elle se mesure sur un vrai
 * PostgreSQL, et c'est `tests-pg/a7b0-plan-multi-rush.pg.test.ts` qui le fait
 * — dix-sept scenarios, dont un declencheur qui fait echouer la troisieme
 * source pour verifier qu'il ne reste ni plan ni ligne.
 *
 * Ce fichier-ci tient les DECISIONS, celles qu'un refactor peut defaire sans
 * qu'aucune base ne s'en apercoive :
 *
 *   • la migration n'ajoute qu'une fonction — aucune table, aucune colonne,
 *     aucun `drop`, aucun `grant`, aucune ligne effacee ;
 *   • le chemin mono-rush n'est pas detourne ;
 *   • l'empreinte est calculee EN TYPESCRIPT et jamais rehachee en SQL ;
 *   • le service valide ce qu'il peut avant l'aller-retour, sans jamais
 *     remplacer les cles etrangeres.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const CHEMIN = 'migrations/2026-09-08-autopilot-multi-rush-plan-rpc.sql';
const BRUT = readFileSync(path.join(process.cwd(), CHEMIN), 'utf8');

/** Le SQL debarrasse de sa prose : un commentaire ne prouve rien. */
const sansProse = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');

const CODE = sansProse(BRUT).toLowerCase();

// ---------------------------------------------------------------------------
// 1. La migration n'ajoute qu'une fonction
// ---------------------------------------------------------------------------
describe('A_7B0 — la migration ne touche a aucun schema', () => {
  it('n ajoute ni table, ni colonne, ni index, ni contrainte', () => {
    for (const interdit of [
      'create table', 'alter table', 'add column', 'drop column', 'alter column',
      'create index', 'create unique index', 'drop index', 'drop table',
      'add constraint', 'drop constraint', 'truncate', 'delete from', 'update ',
    ]) {
      expect(CODE, `A_7B0 ne doit pas contenir « ${interdit} »`).not.toContain(interdit);
    }
  });

  it('n ouvre aucun droit', () => {
    /* ⚠️ `grant` ABSENT, `revoke` PRESENT. A_7M n'a pose aucun droit sur les
       tables `rush_*` ; une fonction `security definer` ouverte a `public`
       donnerait au role anonyme de PostgREST de quoi ecrire des lignes sous
       n'importe quel `user_id`. */
    expect(CODE).not.toMatch(/\bgrant\b/);
    expect(CODE).toContain('revoke all on function public.creer_plan_montage_multi_rush');
  });

  it('cree UNE fonction, et une seule', () => {
    const fonctions = CODE.match(/create or replace function/g) ?? [];
    expect(fonctions).toHaveLength(1);
    expect(CODE).toContain('create or replace function public.creer_plan_montage_multi_rush');
  });
});

// ---------------------------------------------------------------------------
// 2. La securite de la fonction
// ---------------------------------------------------------------------------
describe('A_7B0 — la fonction est bornee', () => {
  it('fixe son search_path, pg_temp en dernier', () => {
    expect(CODE).toContain('security definer');
    expect(CODE).toContain('set search_path = public, pg_temp');
    /* ⚠️ `pg_temp` EN TETE serait une porte : un appelant creant une table
       `rush_clip_sets` temporaire detournerait le controle de propriete. */
    expect(CODE).not.toMatch(/search_path\s*=\s*pg_temp/);
  });

  it('ne construit aucun SQL dynamique', () => {
    for (const interdit of ['execute ', 'format(', 'quote_ident', 'quote_literal']) {
      expect(CODE, `A_7B0 ne doit pas contenir « ${interdit} »`).not.toContain(interdit);
    }
  });

  it('ne prend pas le controle de la transaction de l appelant', () => {
    /* ⚠️ UN `commit` DANS LA FONCTION DETRUIRAIT LA GARANTIE RECHERCHEE : les
       sources ecrites ensuite ne pourraient plus etre defaites avec le plan. */
    expect(CODE).not.toMatch(/\bcommit\b/);
    expect(CODE).not.toMatch(/\brollback\b/);
  });

  it('valide la propriete ET la version reelle du jeu de clips', () => {
    expect(CODE).toContain('c.user_id = p_user_id');
    /* La cle etrangere porte sur `(id, user_id)` : rien n'empeche d'annoncer
       la v2 d'un jeu qui en est a la v5. Seul ce controle le voit. */
    expect(CODE).toContain("c.version = (e->>'clip_set_version')::integer");
  });

  it('rattrape le doublon plutot que de le remonter', () => {
    expect(CODE).toContain('when unique_violation then');
  });
});

// ---------------------------------------------------------------------------
// 3. Le mono-rush garde son chemin
// ---------------------------------------------------------------------------
describe('A_7B0 — le chemin mono-rush n est pas detourne', () => {
  it('la fonction refuse moins de deux sources', () => {
    expect(CODE).toContain('sources_insuffisantes');
    expect(CODE).toMatch(/v_nb\s*<\s*2/);
  });

  it('les quatre scalaires historiques sont ecrits NULS', () => {
    /* ⚠️ Y METTRE LA PREMIERE SOURCE FERAIT PARLER UNE COLONNE D'IDENTITE AU
       NOM DE TOUTES LES AUTRES — c'est la decision d'A_7M, et A_7B0 la tient. */
    expect(CODE).toContain('p_user_id, null, null, null, null,');
  });

  it('la version se compte par empreinte, pas par jeu de clips', () => {
    /* `clip_set_id` vaut NULL pour un plan multi-rush : `max()` dessus
       rendrait toujours 1, et tous les plans porteraient la version 1. */
    expect(CODE).toMatch(/coalesce\(max\(p\.version\), 0\) \+ 1/);
    expect(CODE).toContain('p.source_set_fingerprint = p_source_set_fingerprint');
  });
});

// ---------------------------------------------------------------------------
// 4. L'empreinte n'a qu'une seule implementation
// ---------------------------------------------------------------------------
describe('A_7B0 — l empreinte reste calculee en TypeScript', () => {
  it('la fonction ne rehache rien', () => {
    /* ⚠️ DEUX ALGORITHMES DEVANT RESTER D'ACCORD POUR TOUJOURS FINIRAIENT PAR
       DIVERGER, et le meme montage serait recalcule puis refacture
       indefiniment, sans erreur visible. */
    for (const interdit of ['digest(', 'sha256', 'md5(', 'encode(']) {
      expect(CODE, `A_7B0 ne doit pas contenir « ${interdit} »`).not.toContain(interdit);
    }
  });

  it('elle verifie ce qu elle peut verifier sans recalculer', () => {
    expect(CODE).toContain('empreinte_invalide');
    expect(CODE).toMatch(/length\(p_source_set_fingerprint\)/);
    expect(CODE).toContain("p_source_set_fingerprint !~ '^[0-9a-f]+$'");
  });
});

// ---------------------------------------------------------------------------
// 5. Le service partage
// ---------------------------------------------------------------------------
const rpc = vi.fn();
const from = vi.fn();
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: (...a: unknown[]) => from(...a),
  },
}));

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';
const UTILISATEUR = '99999999-9999-4999-8999-999999999999';

const IDENTITE = {
  algorithme: 'm3e-v4',
  methodeMaterialisation: 'ffmpeg-copy',
  algorithmePlan: 'm3g-v2',
  format: '9:16' as const,
  dureeCibleSecondes: 25,
};

const CONTENU = {
  largeurCible: 1080, hauteurCible: 1920, fps: 30, plans: [],
  dureeTotaleSecondes: 0, ecartSecondes: 0, clipsEcartes: 0, usage: {},
};

beforeEach(() => { rpc.mockReset(); from.mockReset(); });

describe('A_7B0 — le service valide avant l aller-retour', () => {
  it('refuse une seule source sans appeler la base', async () => {
    const { creerPlanMultiRushAtomique } = await import('@/lib/autopilot/analyse/montage-service');
    const r = await creerPlanMultiRushAtomique(
      UTILISATEUR, [{ clipSetId: UUID_A, clipSetVersion: 1 }], IDENTITE, CONTENU,
    );
    expect(r.issue).toBe('sources_insuffisantes');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuse un jeu cite deux fois sans appeler la base', async () => {
    const { creerPlanMultiRushAtomique } = await import('@/lib/autopilot/analyse/montage-service');
    const r = await creerPlanMultiRushAtomique(UTILISATEUR, [
      { clipSetId: UUID_A, clipSetVersion: 1 },
      { clipSetId: UUID_A, clipSetVersion: 2 },
    ], IDENTITE, CONTENU);
    expect(r.issue).toBe('source_dupliquee');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuse au-dela de la borne mecanique d ordinal', async () => {
    const { creerPlanMultiRushAtomique, SOURCES_MULTI_RUSH_MAX } =
      await import('@/lib/autopilot/analyse/montage-service');
    expect(SOURCES_MULTI_RUSH_MAX).toBe(64);
    const trop = Array.from({ length: 65 }, (_, i) => ({
      clipSetId: `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`,
      clipSetVersion: 1,
    }));
    const r = await creerPlanMultiRushAtomique(UTILISATEUR, trop, IDENTITE, CONTENU);
    expect(r.issue).toBe('sources_trop_nombreuses');
    expect(rpc).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ LA TABLE DIT LA MATIERE, LE JSON DIT LE DECOUPAGE — ILS DOIVENT DIRE LA
   * MEME CHOSE. Un segment citant un jeu absent de la liste ferait reclamer au
   * rendu des octets que la table ne declare pas.
   */
  it('refuse un plan dont un segment cite une source non declaree', async () => {
    const { creerPlanMultiRushAtomique } = await import('@/lib/autopilot/analyse/montage-service');
    const segment = {
      rangClip: 0, cleClip: 'x', bucket: 'media', cle: 'k',
      debutTimelineSecondes: 0, entreeSecondes: 0, dureeRetenueSecondes: 2,
      largeurSource: 1080, hauteurSource: 1920, raccordEntrant: 'coupe',
      source: {
        rushId: UUID_C, clipSetId: UUID_C, clipSetVersion: 1,
        rangClip: 0, debutSourceSecondes: 0, finSourceSecondes: 2,
      },
    };
    const r = await creerPlanMultiRushAtomique(UTILISATEUR, [
      { clipSetId: UUID_A, clipSetVersion: 1 },
      { clipSetId: UUID_B, clipSetVersion: 1 },
    ], IDENTITE, { ...CONTENU, plans: [segment] } as never);
    expect(r.issue).toBe('sources_incoherentes');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('laisse passer un plan LEGACY dont aucun segment ne porte de provenance', async () => {
    const { creerPlanMultiRushAtomique } = await import('@/lib/autopilot/analyse/montage-service');
    rpc.mockResolvedValue({ data: [{ issue: 'cree', plan_id: null, cree: true }], error: null });
    const segment = {
      rangClip: 0, cleClip: 'x', bucket: 'media', cle: 'k',
      debutTimelineSecondes: 0, entreeSecondes: 0, dureeRetenueSecondes: 2,
      largeurSource: 1080, hauteurSource: 1920, raccordEntrant: 'coupe',
    };
    const r = await creerPlanMultiRushAtomique(UTILISATEUR, [
      { clipSetId: UUID_A, clipSetVersion: 1 },
      { clipSetId: UUID_B, clipSetVersion: 1 },
    ], IDENTITE, { ...CONTENU, plans: [segment] } as never);
    expect(r.issue).toBe('cree');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe('A_7B0 — le service parle a la bonne fonction', () => {
  it('envoie l empreinte d A_7a et les sources ordonnees', async () => {
    const { creerPlanMultiRushAtomique } = await import('@/lib/autopilot/analyse/montage-service');
    const { empreinteJeuxSources } = await import('@/lib/autopilot/analyse/montage-source');
    rpc.mockResolvedValue({ data: [{ issue: 'cree', plan_id: null, cree: true }], error: null });

    const sources = [
      { clipSetId: UUID_B, clipSetVersion: 3 },
      { clipSetId: UUID_A, clipSetVersion: 1 },
    ];
    await creerPlanMultiRushAtomique(UTILISATEUR, sources, IDENTITE, CONTENU);

    const [nom, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(nom).toBe('creer_plan_montage_multi_rush');
    expect(args.p_source_set_fingerprint).toBe(empreinteJeuxSources(sources));
    /* ⚠️ L'ORDRE PASSE TEL QUEL. Le trier confondrait `A,B` et `B,A`, qui ne
       sont pas le meme film. */
    expect(args.p_sources).toEqual([
      { clip_set_id: UUID_B, clip_set_version: 3 },
      { clip_set_id: UUID_A, clip_set_version: 1 },
    ]);
    /* Les quatre scalaires historiques ne sont meme pas transmis. */
    expect(args).not.toHaveProperty('p_clip_set_id');
    expect(args).not.toHaveProperty('p_analysis_id');
  });

  it('traduit une fonction absente en socle_absent, pas en panne', async () => {
    const { creerPlanMultiRushAtomique } = await import('@/lib/autopilot/analyse/montage-service');
    rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function' },
    });
    const r = await creerPlanMultiRushAtomique(UTILISATEUR, [
      { clipSetId: UUID_A, clipSetVersion: 1 },
      { clipSetId: UUID_B, clipSetVersion: 1 },
    ], IDENTITE, CONTENU);
    expect(r.motif).toBe('socle_absent');
  });

  it('remonte une vraie panne', async () => {
    const { creerPlanMultiRushAtomique } = await import('@/lib/autopilot/analyse/montage-service');
    rpc.mockResolvedValue({ data: null, error: { code: '08006', message: 'connexion perdue' } });
    await expect(creerPlanMultiRushAtomique(UTILISATEUR, [
      { clipSetId: UUID_A, clipSetVersion: 1 },
      { clipSetId: UUID_B, clipSetVersion: 1 },
    ], IDENTITE, CONTENU)).rejects.toThrow(/connexion perdue/);
  });
});

// ---------------------------------------------------------------------------
// 6. Ce que A_7B0 ne fait PAS
// ---------------------------------------------------------------------------
describe('A_7B0 — aucune decision creative', () => {
  it('la migration ne parle ni de score, ni de diversite, ni de rendu', () => {
    for (const interdit of ['score', 'diversite', 'ffmpeg', 'render', 'objectif', 'caption']) {
      expect(CODE, `A_7B0 ne doit pas contenir « ${interdit} »`).not.toContain(interdit);
    }
  });

  it('le service n appelle aucun selecteur de rush ni aucun moteur', async () => {
    const src = readFileSync(
      path.join(process.cwd(), 'src/lib/autopilot/analyse/montage-service.ts'), 'utf8',
    );
    /* ⚠️ A_7B0 EST DE LA PERSISTANCE. Le pool global, l'objectif et la
       diversite sont le sujet d'A_7b ; les faire entrer ici melangerait la
       decision et l'ecriture. */
    for (const interdit of ['objectif-communication', 'clip-selection', 'signaux', 'moteur-visuel']) {
      expect(src).not.toContain(interdit);
    }
  });
});
