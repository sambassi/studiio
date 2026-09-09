/**
 * A_7F — LE MONTAGE MULTI-RUSH REVIENT JUSQU'À L'ÉCRAN.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUI SE PASSAIT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `lireRenduDeSession` retrouvait les plans par `rush_montage_plans.clip_set_id`
 * — la colonne SCALAIRE d'origine, une seule source par plan.
 *
 * A_7M l'a rendue nullable, et les plans multi-source l'écrivent NULL : leurs
 * sources vivent dans `rush_montage_plan_sources`, une ligne par rush. Un
 * `in('clip_set_id', …)` ne pouvait donc structurellement pas les voir.
 *
 * Conséquence mesurée le 2026-09-09 : quatre plans `m3g-v2+ms1` en base, tous
 * à `clip_set_id = NULL`, et l'écran affichait encore le dernier montage MONO
 * de la veille — après un rendu multi-rush réussi, et après rechargement. La
 * vidéo existait bel et bien dans le stockage ; personne ne pouvait la voir.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER TIENT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Que la lecture connaisse LES DEUX formes, et qu'elle ne perde pas l'ancienne
 * en apprenant la nouvelle. Le client de base est simulé — ce qui est vérifié
 * ici n'est pas le comportement du moteur mais la FORME de l'interrogation :
 * quelles tables sont lues, avec quels filtres, et sous quel compte.
 *
 * ⚠️ CE N'EST PAS LA SEULE PREUVE. Le correctif a d'abord été constaté sur la
 * vraie base et la vraie route : `/api/autopilot/sessions/…/rendus` rendait le
 * montage mono de 09:03, et rend désormais le montage multi de 13:14.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const UID = 'e0575f46-1a63-445c-aa5d-8a00296bd4a3';
const SESSION = '11111111-2222-4333-8444-555555555555';
const JEU_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const JEU_B = 'bbbbbbbb-2222-4222-8222-222222222222';
const PLAN_MULTI = 'dddddddd-4444-4444-8444-444444444444';
const RENDU_MULTI = 'eeeeeeee-5555-4555-8555-555555555555';

/** Ce que la simulation a réellement demandé — c'est cela qu'on inspecte. */
interface Appel {
  table: string;
  filtres: string[];
  ou: string | null;
}
let appels: Appel[] = [];

/** Ce que chaque table rend. Modifiable par test. */
let sourcesRendues: Array<{ plan_id: string }> = [];
let erreurSources: { message: string; code?: string } | null = null;

function requete(table: string) {
  const appel: Appel = { table, filtres: [], ou: null };
  appels.push(appel);
  const q: Record<string, unknown> = {};
  const chainer = (nom: string) => (...a: unknown[]) => {
    appel.filtres.push(`${nom}:${a.map((x) => JSON.stringify(x)).join('|')}`);
    if (nom === 'or') appel.ou = String(a[0]);
    return q;
  };
  for (const nom of ['select', 'eq', 'in', 'or', 'order', 'limit']) q[nom] = chainer(nom);

  const donnees = () => {
    if (table === 'rush_montage_plan_sources') {
      return { data: sourcesRendues, error: erreurSources };
    }
    if (table === 'rush_montage_plans') {
      return { data: [{ id: PLAN_MULTI, created_at: '2026-09-09T13:14:00Z' }], error: null };
    }
    if (table === 'rush_clip_sets') {
      return { data: [{ id: JEU_A }, { id: JEU_B }], error: null };
    }
    return { data: [], error: null };
  };
  // La chaîne est « thenable » : `await supabaseAdmin.from(…)…` la résout.
  q.then = (r: (v: unknown) => unknown) => Promise.resolve(donnees()).then(r);
  q.maybeSingle = async () => ({
    data: {
      id: RENDU_MULTI, user_id: UID, etat: 'reussie', etape: 'televersement',
      montage_plan_id: PLAN_MULTI, created_at: '2026-09-09T13:14:40Z',
      resultat: {}, motif_echec: null,
    },
    error: null,
  });
  return q;
}

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: (t: string) => requete(t) },
  supabase: { from: (t: string) => requete(t) },
}));

vi.mock('@/lib/autopilot/tournage/service', () => ({
  listerRushes: async () => ({
    rushes: [{ id: 'f1111111-1111-4111-8111-111111111111' }], motif: null,
  }),
}));

const { lireRenduDeSession } = await import('@/lib/autopilot/analyse/rendu-session');

const table = (nom: string) => appels.find((a) => a.table === nom);

beforeEach(() => {
  appels = [];
  sourcesRendues = [{ plan_id: PLAN_MULTI }];
  erreurSources = null;
});

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Les deux formes de plan sont lues', () => {
  it('1.1 ⚠️ LES SOURCES MULTI-RUSH SONT INTERROGÉES', async () => {
    /* SANS CETTE LECTURE, aucun montage multi-rush n'était jamais retrouvé :
       leur `clip_set_id` est NULL depuis A_7M. */
    await lireRenduDeSession(UID, SESSION);
    expect(table('rush_montage_plan_sources')).toBeDefined();
  });

  it('1.2 elles sont cherchées par les jeux de clips de la session', async () => {
    await lireRenduDeSession(UID, SESSION);
    const t = table('rush_montage_plan_sources');
    expect(t?.filtres.some((f) => f.startsWith('in:"clip_set_id"'))).toBe(true);
  });

  it('1.3 ⚠️ LES PLANS SONT CHERCHÉS SOUS LES DEUX FORMES', async () => {
    /* `clip_set_id` retrouve les MONO — la forme d'origine, intacte — et `id`
       ceux dont les sources viennent d'être lues, c'est-à-dire les MULTI.
       Deux lectures simples plutôt qu'un `or` assemblé à la main : une chaîne
       de filtre PostgREST avec des listes d'UUID produit `in.()` sur une liste
       vide, et tous les clients ne savent pas la rejouer. */
    await lireRenduDeSession(UID, SESSION);
    const lectures = appels.filter((a) => a.table === 'rush_montage_plans');
    expect(lectures).toHaveLength(2);
    expect(lectures[0].filtres.some((f) => f.startsWith('in:"clip_set_id"'))).toBe(true);
    const parId = lectures[1].filtres.find((f) => f.startsWith('in:"id"'));
    expect(parId).toBeDefined();
    expect(parId).toContain(PLAN_MULTI);
  });

  it('1.4 le scalaire n’est PAS rempli en échange', async () => {
    /* La décision d'A_7M tient : un montage à deux sources n'en a pas une
       seule, et y écrire un « rush principal » ferait mentir la donnée.
       C'est la LECTURE qui apprend les deux formes, jamais l'écriture. */
    await lireRenduDeSession(UID, SESSION);
    const ecritures = appels.filter((a) => a.filtres.some(
      (f) => f.startsWith('update:') || f.startsWith('insert:') || f.startsWith('upsert:'),
    ));
    expect(ecritures).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Le chemin mono ne régresse pas', () => {
  it('2.1 sans aucune source multi, les plans restent cherchés par le scalaire', async () => {
    sourcesRendues = [];
    await lireRenduDeSession(UID, SESSION);
    const lectures = appels.filter((a) => a.table === 'rush_montage_plans');
    // UNE seule lecture : une liste vide ne doit pas coûter un aller-retour
    // qui ne peut rien rendre.
    expect(lectures).toHaveLength(1);
    expect(lectures[0].filtres.some((f) => f.startsWith('in:"clip_set_id"'))).toBe(true);
  });

  it('2.2 ⚠️ UNE TABLE DE SOURCES ABSENTE NE CASSE PAS L’ÉCRAN', async () => {
    /* La table est arrivée avec A_7M. Sur un serveur qui ne l'a pas encore,
       les montages mono doivent continuer de s'afficher exactement comme
       avant — une migration en retard n'est pas une panne d'affichage. */
    erreurSources = { message: 'relation "rush_montage_plan_sources" does not exist' };
    const r = await lireRenduDeSession(UID, SESSION);
    expect(r.motif).not.toBe('socle_absent');
    const lectures = appels.filter((a) => a.table === 'rush_montage_plans');
    expect(lectures[0].filtres.some((f) => f.startsWith('in:"clip_set_id"'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Le compte reste le filtre de tout', () => {
  it('3.1 ⚠️ CHAQUE LECTURE EST FILTRÉE PAR L’UTILISATEUR', async () => {
    /* `supabaseAdmin` contourne RLS : sans ce filtre, la requête rendrait la
       première ligne venue, c'est-à-dire le montage d'un inconnu. */
    await lireRenduDeSession(UID, SESSION);
    for (const nom of [
      'rush_clip_sets', 'rush_montage_plan_sources',
      'rush_montage_plans', 'rush_montage_renders',
    ]) {
      const t = table(nom);
      expect(t, `${nom} doit être lue`).toBeDefined();
      expect(
        t?.filtres.some((f) => f === `eq:"user_id"|${JSON.stringify(UID)}`),
        `${nom} doit filtrer sur user_id`,
      ).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. Le coût de la lecture reste borné', () => {
  it('4.1 une requête de plus, et une seule', async () => {
    /* Pas une par rush ni une par plan : la table des sources se lit d'un
       coup, comme les jeux de clips juste avant. */
    await lireRenduDeSession(UID, SESSION);
    expect(appels.filter((a) => a.table === 'rush_montage_plan_sources')).toHaveLength(1);
    expect(appels.length).toBeLessThanOrEqual(6);
  });
});
