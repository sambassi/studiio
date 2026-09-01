// @vitest-environment node
/**
 * M3-H (H2) — LA PERSISTANCE DES RENDUS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER VERROUILLE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un rendu coûte des dizaines de secondes de CPU sur quatre cœurs partagés.
 * Trois défauts coûteraient cher, et ce sont eux que les tests visent :
 *
 *   1. DEUX RENDUS SIMULTANÉS DU MÊME PLAN. Double clic, deux onglets, rejeu
 *      de requête : deux ffmpeg sur les mêmes octets, pour le même fichier.
 *      La garantie doit venir de la BASE — un `select` suivi d'un `insert`
 *      laisse passer deux requêtes qui se croisent.
 *   2. REFAIRE UN RENDU DÉJÀ FAIT. Un rendu réussi d'identité identique doit
 *      être réutilisé, et l'identité doit inclure la MÉTHODE : sans elle, un
 *      changement d'encodage servirait l'ancien fichier.
 *   3. BLOQUER UN PLAN POUR TOUJOURS. Un processus tué laisse sa ligne
 *      `en_cours` ; sans péremption, le plan devient impossible à rendre.
 *
 * ⚠️ CETTE PHASE NE REND RIEN. Aucun ffmpeg, aucun Remotion, aucun octet,
 * aucune route. La base est doublée, avec ses DEUX index partiels et sa clé
 * étrangère composite réellement appliqués — c'est ce qui rend les tests de
 * concurrence et de propriété honnêtes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ───────────────────────────────────────────────────────────────────────────
// Une base minuscule, en mémoire, avec les DEUX index uniques partiels et la
// CLÉ ÉTRANGÈRE COMPOSITE réellement appliqués
// ───────────────────────────────────────────────────────────────────────────
interface Ligne { [k: string]: unknown }
let tables: Record<string, Ligne[]>;
let tableAbsente: string | null = null;
let tableEnPanne: string | null = null;
const MESSAGE_INTERNE = 'connect ECONNREFUSED postgres 10.0.0.4:5432';

const erreurTable = { code: '42P01', message: 'relation does not exist' };
const doublon = (i: string) => ({
  code: '23505', message: `duplicate key value violates unique constraint "${i}"`,
});
const ACTIFS = ['en_attente', 'en_cours'];
const actif = (e: unknown) => ACTIFS.includes(String(e));

/**
 * Les deux index partiels, appliqués comme le ferait PostgreSQL.
 *
 * ⚠️ SANS EUX, LES TESTS DE CONCURRENCE SERAIENT DES FAUX VERTS : ils
 * prouveraient qu'un `if` applicatif fonctionne, pas que la base arbitre.
 */
function refusUnicite(valeurs: Ligne): { code: string; message: string } | null {
  const memes = (tables.rush_montage_renders ?? [])
    .filter((l) => l.montage_plan_id === valeurs.montage_plan_id);
  if (actif(valeurs.etat) && memes.some((l) => actif(l.etat))) {
    return doublon('rush_montage_renders_actif_unique');
  }
  if (String(valeurs.etat) === 'reussie' && memes.some(
    (l) => String(l.etat) === 'reussie'
      && String(l.montage_plan_version) === String(valeurs.montage_plan_version)
      && String(l.methode_rendu) === String(valeurs.methode_rendu),
  )) {
    return doublon('rush_montage_renders_reussi_unique');
  }
  return null;
}

function anterieurA(v: unknown, b: unknown): boolean {
  const x = Date.parse(String(v)); const y = Date.parse(String(b));
  return Number.isFinite(x) && Number.isFinite(y) && x < y;
}

function requete(table: string) {
  if (tableEnPanne === table) throw new Error(MESSAGE_INTERNE);
  const eq: Array<[string, unknown]> = [];
  const dans: Array<[string, unknown[]]> = [];
  const avant: Array<[string, unknown]> = [];
  let limite: number | null = null;
  let aInserer: Ligne | null = null;
  let aMaj: Ligne | null = null;

  const lignes = () => {
    if (tableAbsente === table) return null;
    let out = (tables[table] ?? []).filter(
      // `String` des deux côtés : `numeric` revient en chaîne de PostgREST,
      // et comparer des nombres serait plus permissif que la vraie base.
      (l) => eq.every(([c, v]) => String(l[c]) === String(v))
        && dans.every(([c, vs]) => vs.map(String).includes(String(l[c])))
        && avant.every(([c, v]) => anterieurA(l[c], v)),
    );
    if (limite !== null) out = out.slice(0, limite);
    return out;
  };

  const executer = () => {
    if (tableAbsente === table) return { data: null, error: erreurTable };
    if (aInserer) {
      const valeurs: Ligne = { etat: 'en_attente', ...aInserer };
      if (table === 'rush_montage_renders') {
        // ⚠️ LA CLÉ ÉTRANGÈRE COMPOSITE, APPLIQUÉE. Le plan doit exister ET
        // appartenir à l'utilisateur annoncé. Sans elle, le test de propriété
        // passerait sur un `if` que la vraie base n'a pas.
        // ⚠️ TROIS COLONNES : le plan doit exister, porter la VERSION
        // annoncée, et appartenir à l'utilisateur. Sans la version, un rendu
        // au numéro faux passerait, et sa réutilisation ne le retrouverait
        // jamais — deux encodages pour un seul montage.
        const plan = (tables.rush_montage_plans ?? []).find(
          (p) => p.id === valeurs.montage_plan_id && p.user_id === valeurs.user_id
            && String(p.version) === String(valeurs.montage_plan_version),
        );
        if (!plan) {
          return {
            data: null,
            error: {
              code: '23503',
              message: 'violates foreign key constraint "rush_montage_renders_plan_proprietaire"',
            },
          };
        }
        const refus = refusUnicite(valeurs);
        if (refus) return { data: null, error: refus };
      }
      const n = (tables[table] ?? []).length + 1;
      const maintenant = new Date().toISOString();
      const ligne: Ligne = {
        id: `55555555-5555-4555-8555-${String(n).padStart(12, '0')}`,
        etape: null, resultat: {}, usage: {}, motif_echec: null,
        created_at: maintenant, started_at: null, completed_at: null,
        updated_at: maintenant,
        ...valeurs,
      };
      tables[table] = [...(tables[table] ?? []), ligne];
      return { data: ligne, error: null };
    }
    if (aMaj) {
      const cibles = lignes() ?? [];
      if (cibles.length === 0) return { data: null, error: null };
      const patch = aMaj;
      tables[table] = (tables[table] ?? []).map(
        (l) => (cibles.includes(l) ? { ...l, ...patch } : l),
      );
      return { data: (tables[table] ?? []).find((l) => l.id === cibles[0].id) ?? null, error: null };
    }
    const l = lignes();
    return { data: l && l.length ? l[0] : null, error: null };
  };

  const api: Record<string, unknown> = {
    select: () => api,
    eq: (c: string, v: unknown) => { eq.push([c, v]); return api; },
    in: (c: string, vs: unknown[]) => { dans.push([c, vs]); return api; },
    lt: (c: string, v: unknown) => { avant.push([c, v]); return api; },
    order: () => api,
    limit: (n: number) => { limite = n; return api; },
    insert: (v: Ligne) => { aInserer = v; return api; },
    update: (v: Ligne) => { aMaj = v; return api; },
    maybeSingle: async () => executer(),
    then: (resoudre: (v: unknown) => unknown) => {
      if (aInserer || aMaj) {
        const cibles = lignes() ?? [];
        const r = executer() as { data: unknown; error: unknown };
        if (r.error) return resoudre({ data: null, error: r.error });
        return resoudre({ data: aMaj ? cibles : [r.data], error: null });
      }
      const l = lignes();
      return resoudre(l === null ? { data: null, error: erreurTable } : { data: l, error: null });
    },
  };
  return api;
}

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: (t: string) => requete(t) },
  supabase: { from: (t: string) => requete(t) },
}));

import {
  COLONNES_RENDU, ETATS_ACTIFS, creerRendu, lireRenduActif, lireRenduParId,
  lireRenduReussiIdentique, majRendu, recupererRendusInterrompus,
  renduDepuisLigne, seuilPeremptionRendu, usageSansUrl,
} from '@/lib/autopilot/analyse/rendu-service';
import {
  METHODE_RENDU, MOTIF_RENDU_INTERROMPU, PEREMPTION_RENDU_MS,
  BUDGET_RENDU_MAX_MS, cleRendu,
  type IdentiteRendu,
} from '@/lib/autopilot/analyse/rendu-contrat';

const SRC = {
  service: resolve(process.cwd(), 'src/lib/autopilot/analyse/rendu-service.ts'),
  contrat: resolve(process.cwd(), 'src/lib/autopilot/analyse/rendu-contrat.ts'),
};
const MIGRATION = resolve(process.cwd(), 'migrations/2026-09-06-rush-montage-renders.sql');

const PLAN = '4dbcd5a6-2e7b-4150-b43b-e318bb403198';
const AUTRE_PLAN = '99999999-9999-4999-8999-999999999999';
const UID = 'e0575f46-1a63-445c-aa5d-8a00296bd4a3';

const identite: IdentiteRendu = {
  montagePlanId: PLAN, montagePlanVersion: 1, methodeRendu: METHODE_RENDU,
};

function lignePlan(over: Ligne = {}): Ligne {
  return { id: PLAN, user_id: UID, version: 1, format: '9:16', ...over };
}

function ligneRendu(over: Ligne = {}): Ligne {
  const maintenant = new Date().toISOString();
  return {
    id: '55555555-5555-4555-8555-000000000001', user_id: UID,
    montage_plan_id: PLAN, montage_plan_version: 1, methode_rendu: METHODE_RENDU,
    etat: 'en_attente', etape: null, resultat: {}, motif_echec: null, usage: {},
    created_at: maintenant, started_at: null, completed_at: null,
    updated_at: maintenant,
    ...over,
  };
}

/** Un instant plus ancien que la péremption, donc réputé abandonné. */
const perime = () => new Date(Date.now() - PEREMPTION_RENDU_MS - 60_000).toISOString();

beforeEach(() => {
  tables = { rush_montage_plans: [lignePlan()], rush_montage_renders: [] };
  tableAbsente = null;
  tableEnPanne = null;
});

// ═════════════════════════════════════════════════════════════════════════
describe('1-6. La création et l’identité', () => {
  it('un rendu naît `en_attente`, sans étape et sans résultat', async () => {
    const { rendu, motif } = await creerRendu(UID, identite);
    expect(motif).toBeNull();
    expect(rendu).not.toBeNull();
    expect(rendu!.etat).toBe('en_attente');
    expect(rendu!.etape).toBeNull();
    expect(rendu!.resultat).toBeNull();
    expect(rendu!.motifEchec).toBeNull();
    expect(rendu!.startedAt).toBeNull();
    expect(rendu!.completedAt).toBeNull();
    expect(tables.rush_montage_renders).toHaveLength(1);
  });

  it('l’identité est persistée EN ENTIER, et rien du plan n’est recopié', async () => {
    const { rendu } = await creerRendu(UID, identite);
    expect(rendu).toMatchObject({
      montagePlanId: PLAN, montagePlanVersion: 1, methodeRendu: METHODE_RENDU,
      userId: UID,
    });
    const ligne = tables.rush_montage_renders[0];
    expect(ligne.montage_plan_id).toBe(PLAN);
    expect(ligne.montage_plan_version).toBe(1);
    expect(ligne.methode_rendu).toBe(METHODE_RENDU);
    // ⚠️ LE PLAN PORTE DÉJÀ LE RESTE. Recopier son format, sa durée cible ou
    // l'identité de son jeu de clips les ferait exister à deux endroits.
    for (const interdit of ['format', 'duree_cible_secondes', 'clip_set_id',
      'analysis_id', 'algorithme', 'methode_materialisation', 'algorithme_plan',
      'plans', 'largeur_cible', 'hauteur_cible', 'fps']) {
      expect(Object.keys(ligne), `le rendu ne doit pas porter ${interdit}`)
        .not.toContain(interdit);
    }
  });

  it('les colonnes lues sont un LITTÉRAL UNIQUE, jamais une concaténation', () => {
    // `supabase-js` analyse cette chaîne au niveau des TYPES : un `+` la
    // ramène à `string`, et le client rend `ParserError` au lieu de la ligne.
    const src = readFileSync(SRC.service, 'utf8');
    expect(src).toMatch(/export const COLONNES_RENDU = '[^']+';/);
    expect(COLONNES_RENDU).not.toContain('+');
    // Et elles correspondent exactement à la table.
    const sql = readFileSync(MIGRATION, 'utf8').split('\n')
      .filter((l) => !l.trim().startsWith('--')).join('\n');
    const bloc = /create table if not exists public\.rush_montage_renders \(([\s\S]*?)\n\);/
      .exec(sql)![1];
    const colonnes = [...bloc.matchAll(/^ {2}([a-z_]+) (?:uuid|text|integer|jsonb|timestamptz)/gm)]
      .map((m) => m[1]);
    expect(COLONNES_RENDU.split(', ').sort()).toEqual(colonnes.sort());
  });

  it('LE PLAN D’AUTRUI : la clé étrangère refuse, pas un `if`', async () => {
    // Le plan appartient à UID ; « B » le désigne. La base établit les deux
    // faits d'un coup — existence et propriété.
    await expect(creerRendu('B', identite)).rejects.toThrowError(
      /foreign key|rush_montage_renders_plan_proprietaire/,
    );
    expect(tables.rush_montage_renders).toHaveLength(0);

    // Un plan inexistant est refusé de la même façon.
    await expect(creerRendu(UID, { ...identite, montagePlanId: AUTRE_PLAN }))
      .rejects.toThrowError(/foreign key/);
  });

  it('lecture par identifiant : le propriétaire filtre DANS la requête', async () => {
    const { rendu } = await creerRendu(UID, identite);
    expect((await lireRenduParId(UID, rendu!.id)).rendu?.id).toBe(rendu!.id);
    // ⚠️ INDISTINGUABLE D'UN INCONNU. Un 403 confirmerait l'existence du
    // travail d'un tiers.
    expect((await lireRenduParId('B', rendu!.id)).rendu).toBeNull();
    expect((await lireRenduParId(UID, AUTRE_PLAN)).rendu).toBeNull();
  });

  it('une ligne relue REVALIDE son résultat', () => {
    const bon = {
      bucket: 'videos', cle: cleRendu(UID, '55555555-5555-4555-8555-000000000001'),
      octets: 1234, dureeMesureeSecondes: 25.02, largeur: 1080, hauteur: 1920,
      fpsMesure: 30, codecVideo: 'h264', aAudio: true, codecAudio: 'aac',
    };
    expect(renduDepuisLigne(ligneRendu({ etat: 'reussie', resultat: bon })).resultat)
      .toEqual(bon);
    // Un résultat informe ne ressort pas : il serait servi comme un fichier
    // valide alors qu'il ne l'est pas.
    expect(renduDepuisLigne(ligneRendu({ resultat: {} })).resultat).toBeNull();
    expect(renduDepuisLigne(ligneRendu({
      etat: 'reussie', resultat: { ...bon, cle: 'https://minio/x.mp4' },
    })).resultat).toBeNull();
    // Un résultat appartenant à un autre préfixe non plus.
    expect(renduDepuisLigne(ligneRendu({
      user_id: 'B', etat: 'reussie', resultat: bon,
    })).resultat).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('7-13. L’idempotence et la concurrence', () => {
  it('UN RENDU ACTIF BLOQUE LE SUIVANT — et c’est la BASE qui refuse', async () => {
    const premier = await creerRendu(UID, identite);
    expect(premier.motif).toBeNull();

    const second = await creerRendu(UID, identite);
    expect(second.rendu).toBeNull();
    expect(second.motif).toBe('rendu_actif');
    expect(tables.rush_montage_renders).toHaveLength(1);
  });

  it('DEUX CRÉATIONS CONCURRENTES : une seule gagne', async () => {
    // ⚠️ LE TEST QUI PROUVE QUE LA GARANTIE N'EST PAS UN `select`. Les deux
    // appels partent ensemble ; un `if (existant) return` les laisserait tous
    // deux passer avant qu'aucune n'ait écrit.
    const [x, y] = await Promise.allSettled([
      creerRendu(UID, identite), creerRendu(UID, identite),
    ]);
    const motifs = [x, y].map((r) => (r.status === 'fulfilled' ? r.value.motif : 'rejete'));
    expect(motifs.filter((m) => m === null)).toHaveLength(1);
    expect(motifs.filter((m) => m === 'rendu_actif')).toHaveLength(1);
    expect(tables.rush_montage_renders).toHaveLength(1);
  });

  it('AUCUN `select` PRÉALABLE ne protège l’insertion', () => {
    // La preuve sur la source : `creerRendu` ne consulte pas l'existant avant
    // d'insérer. Seule la récupération des périmés la précède, et elle ne
    // protège rien — elle libère la place d'un travail mort.
    const src = readFileSync(SRC.service, 'utf8');
    const corps = /export async function creerRendu\(([\s\S]*?)\n\}/.exec(src)![1];
    expect(corps).toContain('recupererRendusInterrompus');
    expect(corps).toContain('.insert(');
    expect(corps, 'aucune lecture de garde avant l’insertion')
      .not.toMatch(/lireRenduActif|lireRenduReussiIdentique/);
    expect(corps).toContain('violationUnicite');
  });

  it('un rendu RÉUSSI identique est retrouvé — méthode comprise', async () => {
    tables.rush_montage_renders = [ligneRendu({ id: 'ok', etat: 'reussie' })];
    expect((await lireRenduReussiIdentique(UID, identite)).rendu?.id).toBe('ok');

    // ⚠️ LA MÉTHODE FAIT PARTIE DE L'IDENTITÉ. Changer d'encodage sans
    // toucher au plan ne doit PAS servir le fichier précédent.
    expect((await lireRenduReussiIdentique(UID, {
      ...identite, methodeRendu: 'x264-crf18-concat-v2',
    })).rendu).toBeNull();
    // La version du plan aussi : un plan recalculé n'est pas le même plan.
    expect((await lireRenduReussiIdentique(UID, {
      ...identite, montagePlanVersion: 2,
    })).rendu).toBeNull();
    // Et un rendu d'autrui ne revient jamais.
    expect((await lireRenduReussiIdentique('B', identite)).rendu).toBeNull();
  });

  it('un rendu ÉCHOUÉ ne bloque pas, et n’est pas réutilisé', async () => {
    tables.rush_montage_renders = [ligneRendu({ etat: 'echouee', motif_echec: 'encodage_echoue' })];
    // Il n'est pas réutilisable : il n'a produit aucun fichier.
    expect((await lireRenduReussiIdentique(UID, identite)).rendu).toBeNull();
    // Et il ne bloque pas une nouvelle tentative : l'index actif est PARTIEL.
    const { motif } = await creerRendu(UID, identite);
    expect(motif).toBeNull();
    expect(tables.rush_montage_renders).toHaveLength(2);
  });

  it('un rendu RÉUSSI ne bloque pas une méthode différente', async () => {
    tables.rush_montage_renders = [ligneRendu({ etat: 'reussie' })];
    // L'index « réussi » porte sur l'identité complète : un autre encodage
    // produit un autre fichier, il a le droit d'exister.
    const { rendu, motif } = await creerRendu(UID, {
      ...identite, methodeRendu: 'x264-crf18-concat-v2',
    });
    expect(motif).toBeNull();
    expect(rendu!.methodeRendu).toBe('x264-crf18-concat-v2');
  });

  it('le rendu actif d’un AUTRE plan ne bloque rien', async () => {
    tables.rush_montage_plans.push(lignePlan({ id: AUTRE_PLAN }));
    tables.rush_montage_renders = [ligneRendu({ montage_plan_id: AUTRE_PLAN, etat: 'en_cours' })];
    const { motif } = await creerRendu(UID, identite);
    expect(motif).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('14-19. La péremption et la récupération', () => {
  it('un rendu actif RÉCENT est PROTÉGÉ, et n’est pas fermé', async () => {
    tables.rush_montage_renders = [ligneRendu({ etat: 'en_cours' })];
    const { fermes } = await recupererRendusInterrompus(UID, PLAN);
    expect(fermes).toBe(0);
    expect(tables.rush_montage_renders[0].etat).toBe('en_cours');
    // Et il bloque toujours une nouvelle création.
    expect((await creerRendu(UID, identite)).motif).toBe('rendu_actif');
  });

  it('un rendu actif PÉRIMÉ est fermé, et la place est rendue', async () => {
    tables.rush_montage_renders = [ligneRendu({ etat: 'en_cours', created_at: perime() })];
    const { rendu, motif } = await creerRendu(UID, identite);
    expect(motif).toBeNull();
    expect(rendu).not.toBeNull();
    const ferme = tables.rush_montage_renders.find((l) => l.etat === 'echouee');
    expect(ferme?.motif_echec).toBe(MOTIF_RENDU_INTERROMPU);
    expect(ferme?.completed_at).toBeTruthy();
  });

  it('LA PÉREMPTION SE COMPARE À `created_at`, jamais à `updated_at`', async () => {
    // ⚠️ SANS CELA, UN RENDU MORT REPOUSSE SON EXPIRATION POUR TOUJOURS.
    // Un travail qui a écrit une dernière progression juste avant de mourir
    // aurait un `updated_at` récent ; se fier à lui bloquerait le plan
    // définitivement.
    tables.rush_montage_renders = [ligneRendu({
      etat: 'en_cours', created_at: perime(), updated_at: new Date().toISOString(),
    })];
    const { fermes } = await recupererRendusInterrompus(UID, PLAN);
    expect(fermes).toBe(1);

    // Et l'inverse : un rendu créé à l'instant mais dont `updated_at` serait
    // ancien reste protégé.
    tables.rush_montage_renders = [ligneRendu({
      etat: 'en_cours', created_at: new Date().toISOString(), updated_at: perime(),
    })];
    expect((await recupererRendusInterrompus(UID, PLAN)).fermes).toBe(0);

    // La preuve sur la source.
    const src = readFileSync(SRC.service, 'utf8');
    const corps = /export async function recupererRendusInterrompus\(([\s\S]*?)\n\}/.exec(src)![1];
    expect(corps).toContain(".lt('created_at', seuilPeremptionRendu())");
    expect(corps).not.toMatch(/\.lt\('updated_at'|\.lt\('started_at'/);
  });

  it('`started_at` ne conviendrait pas : un rendu jamais démarré n’expirerait jamais', async () => {
    // Une ligne `en_attente` a `started_at` nul. Si la péremption s'y fiait,
    // un rendu créé puis jamais pris en charge bloquerait le plan à vie.
    tables.rush_montage_renders = [ligneRendu({
      etat: 'en_attente', created_at: perime(), started_at: null,
    })];
    expect((await recupererRendusInterrompus(UID, PLAN)).fermes).toBe(1);
  });

  it('la récupération ne touche NI le rendu d’autrui NI un autre plan', async () => {
    tables.rush_montage_plans.push(lignePlan({ id: AUTRE_PLAN }));
    tables.rush_montage_renders = [
      ligneRendu({ id: 'moi', etat: 'en_cours', created_at: perime() }),
      ligneRendu({ id: 'autrui', user_id: 'B', etat: 'en_cours', created_at: perime() }),
      ligneRendu({ id: 'autre-plan', montage_plan_id: AUTRE_PLAN, etat: 'en_cours', created_at: perime() }),
      ligneRendu({ id: 'termine', etat: 'reussie', created_at: perime() }),
    ];
    const { fermes } = await recupererRendusInterrompus(UID, PLAN);
    expect(fermes).toBe(1);
    const par = (id: string) => tables.rush_montage_renders.find((l) => l.id === id);
    expect(par('moi')!.etat).toBe('echouee');
    expect(par('autrui')!.etat).toBe('en_cours');
    expect(par('autre-plan')!.etat).toBe('en_cours');
    expect(par('termine')!.etat).toBe('reussie');
  });

  it('le seuil est CALCULÉ depuis le contrat, et dépasse le pire cas', async () => {
    const avant = Date.parse(seuilPeremptionRendu(1_000_000_000_000));
    expect(1_000_000_000_000 - avant).toBe(PEREMPTION_RENDU_MS);
    // L'invariant de H1, revérifié ici : fermer un rendu encore vivant ferait
    // repartir un second ffmpeg pendant le premier.
    expect(PEREMPTION_RENDU_MS).toBeGreaterThan(BUDGET_RENDU_MAX_MS);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('20-23. Les pannes et la mise à jour', () => {
  it('SOCLE ABSENT : `socle_absent`, jamais « aucun rendu »', async () => {
    tableAbsente = 'rush_montage_renders';
    expect((await creerRendu(UID, identite)).motif).toBe('socle_absent');
    expect((await lireRenduReussiIdentique(UID, identite)).motif).toBe('socle_absent');
    expect((await lireRenduActif(UID, PLAN)).motif).toBe('socle_absent');
    expect((await lireRenduParId(UID, 'x')).motif).toBe('socle_absent');
    expect((await recupererRendusInterrompus(UID, PLAN)).motif).toBe('socle_absent');
    expect(tables.rush_montage_renders).toHaveLength(0);
  });

  it('UNE PANNE DE LECTURE N’EST PAS UNE ABSENCE DE RENDU', async () => {
    // ⚠️ LA DISTINCTION QUI ÉVITE UN DIAGNOSTIC FAUX. Traduire une panne
    // d'infrastructure en « aucun rendu » ferait relancer un encodage déjà
    // fait, et le refus de l'index serait ensuite lu comme « un rendu tourne
    // déjà ».
    tableEnPanne = 'rush_montage_renders';
    await expect(lireRenduReussiIdentique(UID, identite)).rejects.toThrow();
    await expect(lireRenduParId(UID, 'x')).rejects.toThrow();
    await expect(creerRendu(UID, identite)).rejects.toThrow();
    // Aucune ligne n'a été écrite au passage.
    tableEnPanne = null;
    expect(tables.rush_montage_renders).toHaveLength(0);
  });

  it('la mise à jour filtre TOUJOURS `id` ET `user_id`', async () => {
    const { rendu } = await creerRendu(UID, identite);
    const maj = await majRendu(UID, rendu!.id, { etat: 'en_cours', etape: 'source', demarre: true });
    expect(maj.rendu!.etat).toBe('en_cours');
    expect(maj.rendu!.etape).toBe('source');
    expect(maj.rendu!.startedAt).toBeTruthy();

    // La ligne d'autrui reste hors d'atteinte, et le dire est distinct d'un
    // succès sans données.
    const chezAutrui = await majRendu('B', rendu!.id, { etat: 'annulee' });
    expect(chezAutrui.rendu).toBeNull();
    expect(chezAutrui.motif).toBe('rendu_absent');
    expect(tables.rush_montage_renders[0].etat).toBe('en_cours');

    const src = readFileSync(SRC.service, 'utf8');
    const corps = /export async function majRendu\(([\s\S]*?)\n\}/.exec(src)![1];
    expect(corps).toContain(".eq('id', renduId)");
    expect(corps).toContain(".eq('user_id', userId)");
  });

  it('les horodatages sont POSÉS PAR LE SERVEUR, jamais reçus', async () => {
    // Un appelant qui fournirait `started_at` pourrait antidater un rendu et
    // le faire échapper à la péremption.
    const src = readFileSync(SRC.service, 'utf8');
    const bloc = /export interface PatchRendu \{([^}]*)\}/.exec(src)![1];
    for (const interdit of ['created_at', 'started_at', 'completed_at',
      'updated_at', 'userId', 'user_id', 'id']) {
      expect(bloc, `PatchRendu ne doit pas accepter ${interdit}`).not.toContain(interdit);
    }
    expect(bloc).toContain('demarre');
    expect(bloc).toContain('termine');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('24-30. Ce que H2 ne fait pas', () => {
  /**
   * Les sources, PRIVÉES de la liste des champs refusés.
   *
   * `CHAMPS_INTERDITS_RENDU` cite légitimement `ffmpeg`, `codec`, `crop` — ce
   * sont précisément les noms que la route rejettera. Balayer la source
   * entière confondrait « ce module interdit ffmpeg » avec « ce module lance
   * ffmpeg », et le test rougirait pour la raison inverse de son intention.
   */
  const sources = () => Object.values(SRC).map((p) => readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    .replace(/export const CHAMPS_INTERDITS_RENDU = \[[\s\S]*?\] as const;/, ''));

  it('AUCUN ffmpeg, AUCUN Remotion, AUCUN processus', () => {
    for (const s of sources()) {
      expect(s).not.toMatch(/ffmpeg|ffprobe/i);
      expect(s).not.toMatch(/remotion|renderMedia|renderVideo|selectComposition/i);
      expect(s).not.toMatch(/execFile|spawn|child_process/);
    }
  });

  it('AUCUN octet : ni disque, ni stockage', () => {
    for (const s of sources()) {
      expect(s).not.toMatch(/readFile|writeFile|mkdtemp|unlink|rmdir/);
      expect(s).not.toMatch(/putObject|removeObject|presignedGetObject|clientMinio|signeurInterne/);
    }
  });

  it('AUCUN crédit, AUCUN fournisseur, AUCUN modèle de langage', () => {
    for (const s of sources()) {
      expect(s).not.toMatch(/@\/lib\/credits|credit_transactions|debiter|deduireCredits/);
      expect(s).not.toMatch(/from '@\/lib\/rendus|tarifs_rendu/);
      expect(s).not.toMatch(/anthropic|groq|openai/i);
      expect(s).not.toMatch(/\bfetch\s*\(|axios/);
    }
  });

  it('AUCUN `render_jobs`, `rendus`, `videos` ni `scheduled_posts`', () => {
    for (const s of sources()) {
      expect(s).not.toContain('render_jobs');
      expect(s).not.toContain('composition_id');
      expect(s).not.toContain('input_props');
      expect(s).not.toMatch(/from\('rendus'\)|from\('videos'\)|scheduled_posts/);
    }
  });

  it('AUCUNE anticipation de M3-I ni de l’habillage', () => {
    for (const s of sources()) {
      for (const interdit of ['subtitle', 'watermark', 'thumbnail', 'publier',
        'publish', 'scheduled']) {
        expect(s).not.toMatch(new RegExp(`\\b${interdit}\\b`, 'i'));
      }
    }
  });

  it('les états sont ceux de H1, sans ajout opportuniste', () => {
    expect(ETATS_ACTIFS).toEqual(['en_attente', 'en_cours']);
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain(
      "check (etat in ('en_attente', 'en_cours', 'reussie', 'echouee', 'annulee'))",
    );
    expect(sql).toContain("etape in ('source', 'encodage', 'mesure', 'televersement')");
  });

  it('la migration crée sa table, porte ses DEUX index, et ne détruit rien', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
      .toLowerCase();

    expect(code).toContain('create table if not exists public.rush_montage_renders');
    // L'index préalable qu'exige la clé étrangère composite.
    expect(code).toMatch(
      /create\s+unique\s+index\s+if\s+not\s+exists\s+rush_montage_plans_id_version_user_key\s+on\s+public\.rush_montage_plans/,
    );
    expect(code).toContain('references public.rush_montage_plans (id, version, user_id)');
    // ⚠️ LES DEUX GARANTIES, chacune pour un risque distinct.
    expect(code).toMatch(
      /create\s+unique\s+index\s+if\s+not\s+exists\s+rush_montage_renders_actif_unique[\s\S]*?where etat in \('en_attente', 'en_cours'\)/,
    );
    expect(code).toMatch(
      /create\s+unique\s+index\s+if\s+not\s+exists\s+rush_montage_renders_reussi_unique[\s\S]*?where etat = 'reussie'/,
    );
    // ⚠️ AUCUNE URL, NI DANS LE RÉSULTAT NI DANS LE RELEVÉ. Le relevé décrit
    // un travail qui part de sources SIGNÉES : c'est là qu'une URL atterrit
    // quand on journalise « ce qui a été téléchargé ».
    expect(code).toContain("resultat::text not like '%://%'");
    expect(code).toContain("usage::text not like '%://%'");

    // ⚠️ RIEN DE DESTRUCTIF, AUCUN DROIT OUVERT.
    expect(code, 'aucun ALTER').not.toMatch(/alter\s+table/);
    expect(code, 'aucun DROP').not.toMatch(/drop\s+/);
    expect(code, 'aucun GRANT').not.toMatch(/grant\s+/);
    expect(code, 'aucun DELETE').not.toMatch(/delete\s+from/);
    expect(code, 'aucun UPDATE').not.toMatch(/update\s+public\./);
    // Une seule table touchée hors la sienne, et seulement par un index.
    expect((code.match(/on public\.rush_montage_plans/g) ?? []).length).toBe(1);
    expect(code).not.toContain('rush_clip_sets');
    expect(code).not.toContain('rush_analyses');
    expect(code).not.toContain('render_jobs');
  });

  it('LA VERSION DU PLAN EST PROUVÉE PAR LA BASE, pas annoncée', async () => {
    // ⚠️ SANS CELA, UN NUMÉRO FAUX PRODUIT UN DOUBLE RENDU SILENCIEUX. Le
    // rendu réussirait, mais la recherche de réutilisation ne le retrouverait
    // jamais : deux encodages, deux fichiers, aucun invariant violé du point
    // de vue de la base.
    await expect(creerRendu(UID, { ...identite, montagePlanVersion: 2 }))
      .rejects.toThrowError(/foreign key|rush_montage_renders_plan_proprietaire/);
    expect(tables.rush_montage_renders).toHaveLength(0);

    // La bonne version passe.
    expect((await creerRendu(UID, identite)).motif).toBeNull();
  });

  it('UN RENDU FERMÉ NE RESSUSCITE PAS : la mise à jour peut exiger un état', async () => {
    // La péremption ferme sur un critère de TEMPS, sans preuve que le
    // processus est mort. Un travail vivant peut donc être fermé, un second
    // démarrer, et le premier écrire ensuite sa réussite.
    const { rendu } = await creerRendu(UID, identite);
    await majRendu(UID, rendu!.id, {
      etat: 'echouee', motifEchec: MOTIF_RENDU_INTERROMPU, termine: true,
    });

    const tardive = await majRendu(UID, rendu!.id, {
      etat: 'reussie', siEtat: ETATS_ACTIFS,
    });
    expect(tardive.rendu).toBeNull();
    expect(tardive.motif).toBe('rendu_absent');
    expect(tables.rush_montage_renders[0].etat).toBe('echouee');

    // Sans la garde, la même écriture passerait — c'est bien elle qui protège.
    const sansGarde = await majRendu(UID, rendu!.id, { etat: 'annulee' });
    expect(sansGarde.rendu!.etat).toBe('annulee');
  });

  it('un motif trop long est TRONQUÉ, jamais rejeté par la base', async () => {
    // ⚠️ SINON UNE ERREUR DE JOURNALISATION DEVIENT UNE INDISPONIBILITÉ.
    // Le `check` borne à 200 caractères ; un motif plus long ferait échouer la
    // mise à jour de CLÔTURE, le rendu resterait `en_cours`, et l'index actif
    // bloquerait le plan jusqu'à la péremption.
    const { rendu } = await creerRendu(UID, identite);
    const trop = 'x'.repeat(500) as never;
    const maj = await majRendu(UID, rendu!.id, { etat: 'echouee', motifEchec: trop });
    expect(String(maj.rendu!.motifEchec).length).toBe(200);
    // Et un motif nul reste nul, il n'est pas transformé en chaîne.
    const remis = await majRendu(UID, rendu!.id, { motifEchec: null });
    expect(remis.rendu!.motifEchec).toBeNull();
  });

  it('UNE RÉUSSITE SANS FICHIER NE RESSORT PAS comme une réussite', () => {
    // ⚠️ LES DEUX CHAMPS ÉTAIENT DÉRIVÉS SÉPARÉMENT. Une ligne `reussie` dont
    // le résultat ne passe pas la revalidation aurait affirmé la réussite
    // sans rien à servir — et c'est le chemin de la réutilisation.
    const sansFichier = renduDepuisLigne(ligneRendu({ etat: 'reussie', resultat: {} }));
    expect(sansFichier.resultat).toBeNull();
    expect(sansFichier.etat).toBe('echouee');

    // Une clé hors du préfixe du propriétaire compte comme « pas de fichier ».
    const volee = renduDepuisLigne(ligneRendu({
      etat: 'reussie',
      resultat: {
        bucket: 'videos', cle: 'B/autopilote/montages/x/montage.mp4', octets: 10,
        dureeMesureeSecondes: 25, largeur: 1080, hauteur: 1920, fpsMesure: 30,
        codecVideo: 'h264', aAudio: true, codecAudio: 'aac',
      },
    }));
    expect(volee.etat).toBe('echouee');
    // Et la base porte la même garde, pour les lignes à venir.
    const sql = readFileSync(MIGRATION, 'utf8');
    expect(sql).toContain("check (etat <> 'reussie' or resultat ? 'cle')");
  });

  it('un RÉSULTAT informe est refusé À L’ÉCRITURE, pas seulement à la lecture', async () => {
    const { rendu } = await creerRendu(UID, identite);
    // La base ne contrôle que le type JSON et l'absence de `://` ; c'est par
    // là qu'un résultat informe entrerait pour ressortir en fichier prêt.
    await expect(majRendu(UID, rendu!.id, {
      etat: 'reussie',
      resultat: { bucket: 'videos', cle: 'B/x.mp4', octets: 1 } as never,
    })).rejects.toThrowError(/resultat de rendu invalide/);
    expect(tables.rush_montage_renders[0].etat).toBe('en_attente');
  });

  it('une URL dans le RELEVÉ est masquée, jamais écrite telle quelle', async () => {
    // ⚠️ SINON UNE LIGNE DE JOURNAL BLOQUE LE PLAN : la base refuse `://`,
    // la clôture échouerait en 23514, le rendu resterait `en_cours`, et
    // l'index actif bloquerait le plan jusqu'à la péremption.
    expect(usageSansUrl({
      source: 'https://minio/x?X-Amz-Signature=abc',
      octets: 123,
      sources: ['https://minio/a', 'rang-01.mp4'],
      detail: { url: 'http://x/y', duree: 12 },
    })).toEqual({
      source: '[url masquee]',
      octets: 123,
      sources: ['[url masquee]', 'rang-01.mp4'],
      detail: { url: '[url masquee]', duree: 12 },
    });

    const { rendu } = await creerRendu(UID, identite);
    await majRendu(UID, rendu!.id, { usage: { source: 'https://minio/x' } });
    expect(JSON.stringify(tables.rush_montage_renders[0].usage)).not.toContain('://');
  });

  it('AUCUNE colonne `version` de rendu — et c’est démontré', () => {
    // M3-F et M3-G en portent une ; ici elle n'a aucun invariant à défendre.
    // Les deux index partiels couvrent le rendu concurrent ET le doublon
    // réussi, et la clé primaire distingue deux tentatives successives. Une
    // colonne que rien ne lit aurait surtout apporté le risque que M3-F
    // documente : retomber silencieusement à 1 après une panne de lecture.
    const sql = readFileSync(MIGRATION, 'utf8').split('\n')
      .filter((l) => !l.trim().startsWith('--')).join('\n');
    const bloc = /create table if not exists public\.rush_montage_renders \(([\s\S]*?)\n\);/
      .exec(sql)![1];
    expect(bloc).not.toMatch(/^\s{2}version\s+integer/m);
    // `montage_plan_version` n'est PAS ce compteur : c'est la version DU PLAN.
    expect(bloc).toMatch(/^\s{2}montage_plan_version\s+integer/m);
    // Et le service ne calcule aucune version.
    const src = readFileSync(SRC.service, 'utf8');
    expect(src).not.toMatch(/version:\s*derniere|version\s*\+\s*1/);
  });
});
