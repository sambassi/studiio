/**
 * A_7a — LIRE ET ÉCRIRE LES SOURCES D'UN PLAN.
 *
 * ---------------------------------------------------------------------------
 * LE PIÈGE QUE CES TESTS GARDENT
 * ---------------------------------------------------------------------------
 *
 * A_7M a fait DEUX choses : ouvrir `rush_montage_plan_sources`, et y backfiller
 * une ligne pour chaque plan historique. Depuis, la quasi-totalité des plans
 * portent leur source DEUX FOIS — dans la colonne scalaire `clip_set_id` et
 * dans une ligne ordinale 0 — et disent la même chose.
 *
 * Un lecteur qui les additionne rend deux sources là où il n'y en a qu'une.
 * Un plan à deux sources reçoit une empreinte, bascule sous l'index d'identité
 * multi-rush, et cesse d'être retrouvé par `lirePlanIdentique` : ses rendus
 * réussis deviennent introuvables et seront refacturés. La déduplication
 * n'est donc pas une commodité de lecture, c'est ce qui empêche le backfill
 * de casser le passé.
 *
 * ⚠️ ET LA TABLE N'EXISTE PAS ENCORE EN PRODUCTION. Les migrations A_7M et
 * A_7M2 sont écrites, pas appliquées. Le lecteur doit donc retomber sur la
 * source scalaire sans lever d'erreur — sinon ce lot casserait le montage
 * mono-rush en production le jour de son déploiement, avant même qu'un seul
 * plan multi-rush n'existe.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Ligne = Record<string, unknown>;

/** Ce que la fausse base a reçu — c'est le sujet de la moitié des tests. */
const journal: {
  table: string; eq: [string, unknown][]; ordre: string | null; insere: Ligne[] | null;
}[] = [];

let lignesSources: Ligne[] = [];
/** Quand la migration n'est pas appliquée, PostgREST répond ceci. */
let tableAbsente = false;

function requete(table: string) {
  const trace = { table, eq: [] as [string, unknown][], ordre: null as string | null,
    insere: null as Ligne[] | null };
  journal.push(trace);
  const api: Record<string, unknown> = {
    select: () => api,
    eq: (c: string, v: unknown) => { trace.eq.push([c, v]); return api; },
    order: (c: string) => { trace.ordre = c; return api; },
    insert: (v: Ligne[]) => { trace.insere = v; return api; },
    then: (resoudre: (v: unknown) => unknown) => {
      if (tableAbsente) {
        return resoudre({ data: null, error: { code: 'PGRST205', message: 'schema cache' } });
      }
      if (trace.insere) return resoudre({ data: trace.insere, error: null });
      const filtrees = lignesSources.filter(
        (l) => trace.eq.every(([c, v]) => l[c] === v),
      );
      return resoudre({ data: filtrees, error: null });
    },
  };
  return api;
}

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: (t: string) => requete(t) },
  supabase: { from: (t: string) => requete(t) },
}));

import {
  lireSourcesPlan, ecrireSourcesPlan, COLONNES_PLAN,
} from '@/lib/autopilot/analyse/montage-service';
import { ALGORITHME_PLAN, type IdentitePlan } from '@/lib/autopilot/analyse/montage-contrat';
import { empreinteJeuxSources } from '@/lib/autopilot/analyse/montage-source';

const USER = '11111111-1111-4111-8111-111111111111';
const AUTRUI = '99999999-9999-4999-8999-999999999999';
const PLAN = 'd1d1d1d1-1111-4111-8111-dddddddddddd';
const JEU_A = 'a2a2a2a2-1111-4111-8111-aaaaaaaaaaaa';
const JEU_B = 'b2b2b2b2-1111-4111-8111-bbbbbbbbbbbb';

const plan = { id: PLAN, clipSetId: JEU_A, clipSetVersion: 1 };

beforeEach(() => { journal.length = 0; lignesSources = []; tableAbsente = false; });

// ───────────────────────────────────────────────────────────────────────────
describe('A_7a — la lecture des sources ne double pas le backfill', () => {
  it('scalaire + ligne backfillée = UNE source', async () => {
    lignesSources = [{ plan_id: PLAN, user_id: USER, ordinal: 0,
      clip_set_id: JEU_A, clip_set_version: 1 }];
    const { sources, motif } = await lireSourcesPlan(USER, plan);
    expect(motif).toBeNull();
    expect(sources).toEqual([{ clipSetId: JEU_A, clipSetVersion: 1 }]);
  });

  it('la source unique ne reçoit AUCUNE empreinte', async () => {
    /* ⚠️ LE BOUT DE LA CHAÎNE. C'est ici que le doublon se serait payé : deux
       sources auraient produit une empreinte, donc un basculement d'index,
       donc des MP4 déjà rendus devenus introuvables. */
    lignesSources = [{ plan_id: PLAN, user_id: USER, ordinal: 0,
      clip_set_id: JEU_A, clip_set_version: 1 }];
    const { sources } = await lireSourcesPlan(USER, plan);
    expect(empreinteJeuxSources(sources)).toBeNull();
  });

  it('lit plusieurs sources dans l’ordre des ordinaux', async () => {
    lignesSources = [
      { plan_id: PLAN, user_id: USER, ordinal: 0, clip_set_id: JEU_A, clip_set_version: 1 },
      { plan_id: PLAN, user_id: USER, ordinal: 1, clip_set_id: JEU_B, clip_set_version: 2 },
    ];
    const { sources } = await lireSourcesPlan(USER, plan);
    expect(sources).toEqual([
      { clipSetId: JEU_A, clipSetVersion: 1 },
      { clipSetId: JEU_B, clipSetVersion: 2 },
    ]);
    expect(journal[0].ordre).toBe('ordinal');
  });

  it('retombe sur le scalaire quand la migration n’est pas appliquée', async () => {
    /* C'est l'état de la PRODUCTION au moment où ce code est écrit. */
    tableAbsente = true;
    const { sources, motif } = await lireSourcesPlan(USER, plan);
    expect(motif).toBe('socle_absent');
    expect(sources).toEqual([{ clipSetId: JEU_A, clipSetVersion: 1 }]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A_7a — le compte est revalidé côté serveur', () => {
  it('la lecture filtre sur le plan ET sur l’utilisateur', async () => {
    /* ⚠️ LA CLÉ ÉTRANGÈRE DE A_7M NE SUFFIT PAS. Elle garantit qu'une source
       appartient au même compte que son plan ; elle n'empêche pas de LIRE le
       plan d'autrui si le code oublie de filtrer. Un `planId` deviné suffirait
       alors à connaître la composition du montage d'un autre. */
    await lireSourcesPlan(USER, plan);
    expect(journal[0].eq).toEqual([['plan_id', PLAN], ['user_id', USER]]);
  });

  it('ne rend pas les sources d’un plan appartenant à autrui', async () => {
    lignesSources = [{ plan_id: PLAN, user_id: AUTRUI, ordinal: 0,
      clip_set_id: JEU_B, clip_set_version: 1 }];
    const { sources } = await lireSourcesPlan(USER, plan);
    expect(sources).toEqual([{ clipSetId: JEU_A, clipSetVersion: 1 }]);
  });

  it('l’écriture appose le compte sur chaque ligne', async () => {
    await ecrireSourcesPlan(USER, PLAN, [
      { clipSetId: JEU_A, clipSetVersion: 1 },
      { clipSetId: JEU_B, clipSetVersion: 2 },
    ]);
    for (const l of journal[0].insere!) expect(l.user_id).toBe(USER);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A_7a — l’écriture des sources', () => {
  it('numérote les ordinaux dans l’ordre reçu', async () => {
    /* L'ordre est ce qui distingue `A,B` de `B,A`, et l'empreinte en dépend. */
    const { ecrites } = await ecrireSourcesPlan(USER, PLAN, [
      { clipSetId: JEU_B, clipSetVersion: 2 },
      { clipSetId: JEU_A, clipSetVersion: 1 },
    ]);
    expect(ecrites).toBe(2);
    expect(journal[0].insere).toEqual([
      { plan_id: PLAN, user_id: USER, ordinal: 0, clip_set_id: JEU_B, clip_set_version: 2 },
      { plan_id: PLAN, user_id: USER, ordinal: 1, clip_set_id: JEU_A, clip_set_version: 1 },
    ]);
  });

  it('écrit toutes les sources en UNE instruction', async () => {
    /* ⚠️ L'ATOMICITÉ QUE POSTGREST OFFRE, ET LA SEULE. Un `insert` portant un
       tableau est une instruction, donc une transaction : trois sources
       entrent toutes les trois ou aucune. Les envoyer une par une laisserait
       un plan avec deux sources sur trois — un montage tronqué que rien ne
       signale. */
    await ecrireSourcesPlan(USER, PLAN, [
      { clipSetId: JEU_A, clipSetVersion: 1 },
      { clipSetId: JEU_B, clipSetVersion: 1 },
      { clipSetId: JEU_A, clipSetVersion: 2 },
    ]);
    expect(journal).toHaveLength(1);
    expect(journal[0].insere).toHaveLength(3);
  });

  it('n’écrit rien quand il n’y a rien à écrire', async () => {
    const { ecrites } = await ecrireSourcesPlan(USER, PLAN, []);
    expect(ecrites).toBe(0);
    expect(journal).toHaveLength(0);
  });

  it('signale le socle absent plutôt que de lever', async () => {
    tableAbsente = true;
    const { motif } = await ecrireSourcesPlan(USER, PLAN, [
      { clipSetId: JEU_A, clipSetVersion: 1 },
    ]);
    expect(motif).toBe('socle_absent');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('A_7a — l’identité d’un plan historique ne bouge pas', () => {
  it('l’algorithme de plan reste `m3g-v2`, au caractère près', () => {
    /* ⚠️ IL FAIT PARTIE DE L'IDENTITÉ, donc de l'index d'unicité, donc de la
       recherche de `lirePlanIdentique`. Le bouger parce que le CONTRAT a
       gagné un champ optionnel — alors que l'ALGORITHME n'a pas changé d'une
       ligne — rendrait introuvable chaque plan déjà calculé. */
    expect(ALGORITHME_PLAN).toBe('m3g-v2');
  });

  it('l’identité d’un plan porte exactement les mêmes champs qu’avant', () => {
    /* La provenance vit sur le SEGMENT, jamais sur l'identité du plan. Y
       ajouter un champ changerait ce que `lirePlanIdentique` compare. */
    const identite: IdentitePlan = {
      clipSetId: JEU_A, clipSetVersion: 1, candidateSetId: JEU_B, analysisId: PLAN,
      algorithme: 'm3e-v1', methodeMaterialisation: 'x264-crf23-v1',
      algorithmePlan: ALGORITHME_PLAN, format: '9:16', dureeCibleSecondes: 20,
    };
    expect(Object.keys(identite).sort()).toEqual([
      'algorithme', 'algorithmePlan', 'analysisId', 'candidateSetId', 'clipSetId',
      'clipSetVersion', 'dureeCibleSecondes', 'format', 'methodeMaterialisation',
    ]);
  });

  it('les colonnes lues d’un plan sont inchangées', () => {
    /* `source_set_fingerprint` n'est PAS ajoutée ici : A_7a ne crée aucun plan
       multi-rush, et sélectionner une colonne que la production n'a pas
       encore ferait échouer toute lecture de plan. */
    expect(COLONNES_PLAN).not.toContain('source_set_fingerprint');
    expect(COLONNES_PLAN.startsWith('id, user_id, clip_set_id, clip_set_version')).toBe(true);
  });
});
