// @vitest-environment node
/**
 * M3-G — LE PLAN DE MONTAGE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER VERROUILLE EN PRIORITÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * M3-G est le premier lot qui DÉCIDE d'un montage. Quatre défauts coûteraient
 * cher, et ce sont eux que les tests visent :
 *
 *   1. INVENTER UNE DURÉE. Aucune donnée du produit ne dit combien de temps
 *      un montage doit durer ; en choisir une par défaut produirait un
 *      montage que personne n'a demandé. La durée cible est obligatoire, et
 *      un appel sans elle est refusé.
 *   2. COMBLER SILENCIEUSEMENT UN MANQUE. Rallonger un plan au-delà de son
 *      clip ou répéter un clip donnerait la durée demandée en mentant sur la
 *      matière. Le déficit est EXPOSÉ, jamais comblé.
 *   3. IGNORER LA DURÉE MESURÉE. M3-F a payé son CPU pour mesurer ce que
 *      chaque fichier dure vraiment ; reprendre la durée demandée rendrait
 *      ce coût absurde et ferait dériver le montage plan après plan.
 *   4. LAISSER UN FONDU S'INSTALLER. Le raccord est écrit, fermé à 'coupe',
 *      et la durée totale est exactement la somme des durées retenues.
 *
 * ⚠️ AUCUN RENDU, AUCUN FFMPEG, AUCUN FOURNISSEUR, AUCUN CRÉDIT. Le moteur
 * est pur ; seule la base est doublée, avec ses index et sa clé étrangère
 * réellement appliqués.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('@/lib/auth/config', () => ({ auth: async () => ({ user: { id: 'A' } }) }));

// ───────────────────────────────────────────────────────────────────────────
// Une base minuscule, en mémoire, avec l'index unique et la CLÉ ÉTRANGÈRE
// réellement appliqués — c'est ce qui rend les tests de propriété honnêtes
// ───────────────────────────────────────────────────────────────────────────
interface Ligne { [k: string]: unknown }
let tables: Record<string, Ligne[]>;
let tableAbsente: string | null = null;
let tableEnPanne: string | null = null;
const MESSAGE_INTERNE = 'connect ECONNREFUSED postgres 10.0.0.4:5432';
const insertions: Array<{ table: string; valeurs: Ligne }> = [];

const erreurTable = { code: '42P01', message: 'relation does not exist' };
const doublon = (i: string) => ({
  code: '23505', message: `duplicate key value violates unique constraint "${i}"`,
});

/** Les sept colonnes de `rush_montage_plans_identite_unique`. */
const CLES_IDENTITE = ['clip_set_id', 'clip_set_version', 'algorithme',
  'methode_materialisation', 'algorithme_plan', 'format', 'duree_cible_secondes'];

function refusUnicite(valeurs: Ligne): { code: string; message: string } | null {
  const existe = (tables.rush_montage_plans ?? []).some(
    (l) => CLES_IDENTITE.every((c) => String(l[c]) === String(valeurs[c])),
  );
  return existe ? doublon('rush_montage_plans_identite_unique') : null;
}

function requete(table: string) {
  if (tableEnPanne === table) throw new Error(MESSAGE_INTERNE);
  const eq: Array<[string, unknown]> = [];
  let tri: { c: string; asc: boolean } | null = null;
  let limite: number | null = null;
  let aInserer: Ligne | null = null;

  const lignes = () => {
    if (tableAbsente === table) return null;
    let out = (tables[table] ?? []).filter(
      // La comparaison passe par `String` : `numeric` revient en chaîne de
      // PostgREST, et un test qui comparerait des nombres serait plus
      // permissif que la vraie base.
      (l) => eq.every(([c, v]) => String(l[c]) === String(v)),
    );
    if (tri) {
      out = [...out].sort((a, b) => {
        const x = Number(a[tri!.c] ?? 0); const y = Number(b[tri!.c] ?? 0);
        return tri!.asc ? x - y : y - x;
      });
    }
    if (limite !== null) out = out.slice(0, limite);
    return out;
  };

  const executer = () => {
    if (tableAbsente === table) return { data: null, error: erreurTable };
    if (aInserer) {
      const valeurs: Ligne = { version: 1, ...aInserer };
      insertions.push({ table, valeurs: aInserer });
      if (table === 'rush_montage_plans') {
        // ⚠️ LA CLÉ ÉTRANGÈRE COMPOSITE, APPLIQUÉE. Le jeu de clips doit
        // exister ET appartenir à l'utilisateur annoncé. Sans cela, le test
        // de propriété passerait sur un `if` que la vraie base n'a pas.
        const jeu = (tables.rush_clip_sets ?? []).find(
          (c) => c.id === valeurs.clip_set_id && c.user_id === valeurs.user_id,
        );
        if (!jeu) {
          return {
            data: null,
            error: {
              code: '23503',
              message: 'violates foreign key constraint "rush_montage_plans_jeu_proprietaire"',
            },
          };
        }
        const refus = refusUnicite(valeurs);
        if (refus) return { data: null, error: refus };
      }
      const n = (tables[table] ?? []).length + 1;
      const ligne: Ligne = {
        id: `88888888-8888-4888-8888-${String(n).padStart(12, '0')}`,
        plans: [], usage: {}, duree_totale_secondes: 0, ecart_secondes: 0,
        clips_ecartes: 0,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        ...valeurs,
      };
      tables[table] = [...(tables[table] ?? []), ligne];
      return { data: ligne, error: null };
    }
    const l = lignes();
    return { data: l && l.length ? l[0] : null, error: null };
  };

  const api: Record<string, unknown> = {
    select: () => api,
    eq: (c: string, v: unknown) => { eq.push([c, v]); return api; },
    order: (c: string, o?: { ascending?: boolean }) => {
      tri = { c, asc: o?.ascending !== false }; return api;
    },
    limit: (n: number) => { limite = n; return api; },
    insert: (v: Ligne) => { aInserer = v; return api; },
    maybeSingle: async () => executer(),
    then: (resoudre: (v: unknown) => unknown) => {
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
  ALGORITHME_PLAN, DUREE_CIBLE_MAX_SECONDES, DUREE_CIBLE_MIN_SECONDES,
  DUREE_PLAN_MIN_SECONDES, FORMATS_MONTAGE, PLANS_MAX, RACCORDS, RACCORD_DEFAUT,
  STRATEGIES_RECADRAGE, TOLERANCE_RATIO, MOTIFS_PLAN,
  dimensionsCible, dureeCibleValide, dureeUtilisable, formatValide,
  planValide, recadrer,
} from '@/lib/autopilot/analyse/montage-contrat';
import { geometrieDepuisTechnique, planifierMontage } from '@/lib/autopilot/analyse/montage';
import {
  creerPlan, lirePlanIdentique, lirePlanParId, planDepuisLigne,
} from '@/lib/autopilot/analyse/montage-service';
import { POST } from '@/app/api/autopilot/clips/[clipSetId]/montage/route';
import { GET } from '@/app/api/autopilot/montages/[montagePlanId]/route';
import type { ClipMaterialise } from '@/lib/autopilot/analyse/clip-contrat';
import type { IdentitePlan } from '@/lib/autopilot/analyse/montage-contrat';

const SRC = {
  contrat: resolve(process.cwd(), 'src/lib/autopilot/analyse/montage-contrat.ts'),
  moteur: resolve(process.cwd(), 'src/lib/autopilot/analyse/montage.ts'),
  service: resolve(process.cwd(), 'src/lib/autopilot/analyse/montage-service.ts'),
  routePost: resolve(process.cwd(), 'src/app/api/autopilot/clips/[clipSetId]/montage/route.ts'),
  routeGet: resolve(process.cwd(), 'src/app/api/autopilot/montages/[montagePlanId]/route.ts'),
};
const MIGRATION = resolve(process.cwd(), 'migrations/2026-09-05-rush-montage-plans.sql');

const CL = '77777777-7777-4777-8777-777777777777';
const CS = '11111111-1111-4111-8111-111111111111';
const AN = '22222222-2222-4222-8222-222222222222';
const AUTRE = '33333333-3333-4333-8333-333333333333';

/**
 * Les cinq clips RÉELS du jeu de production, durées mesurées comprises.
 *
 * ⚠️ LES TIMECODES SOURCE SONT DISJOINTS, comme en production. La première
 * rédaction posait `debutSecondes: 0` sur les cinq — un raccourci sans
 * conséquence tant que le plan ignorait la position des passages dans le
 * rush. Depuis la politique éditoriale (couverture plafonnée, aucune image
 * source deux fois), cette position DÉCIDE : cinq passages qui commencent
 * tous à zéro se répètent intégralement, et quatre d'entre eux seraient
 * légitimement écartés. La fixture dit donc ce que M3-F écrit vraiment.
 */
function clipsProduction(): ClipMaterialise[] {
  const debuts = [0, 10, 20, 30, 40];
  const base = (rang: number, duree: number, mesuree: number, octets: number) => ({
    rang,
    debutSecondes: debuts[rang - 1],
    finSecondes: debuts[rang - 1] + duree,
    dureeSecondes: duree,
    bucket: 'videos',
    cle: `A/autopilote/clips/${CL}/rang-0${rang}.mp4`,
    octets,
    debutMesureSecondes: 0,
    dureeMesureeSecondes: mesuree,
  });
  return [
    base(1, 5, 5, 3086489),
    base(2, 8, 8, 10265172),
    base(3, 8, 8, 8747467),
    base(4, 2.92, 2.934, 1053907),
    base(5, 3, 3, 351240),
  ];
}

const GEO_16_9 = { largeur: 1920, hauteur: 1080, fps: 30 };

function ligneJeu(over: Ligne = {}): Ligne {
  return {
    id: CL, user_id: 'A', candidate_set_id: CS, candidate_set_version: 1,
    rush_id: '44444444-4444-4444-8444-444444444444', analysis_id: AN,
    transcription_id: null, transcription_version: null,
    algorithme: 'm3e-v1', methode_materialisation: 'x264-crf23-v1',
    version: 1, etat: 'reussie', etape: 'televersement',
    clips: clipsProduction(), usage: {}, motif_echec: null,
    created_at: new Date().toISOString(), started_at: null,
    completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    ...over,
  };
}

function ligneAnalyse(over: Ligne = {}): Ligne {
  return {
    id: AN, rush_id: '44444444-4444-4444-8444-444444444444', user_id: 'A',
    version: 1, etat: 'reussie', etape: null, fournisseurs: {},
    duree_secondes: 60,
    technique: { largeur: 1920, hauteur: 1080, fps: 30, codecVideo: 'h264' },
    resume: null, textes_visibles: [], parole: {}, audio: {}, qualite: {},
    vignettes: [], usage: {}, motif_echec: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    ...over,
  };
}

const identite: IdentitePlan = {
  clipSetId: CL, clipSetVersion: 1, candidateSetId: CS, analysisId: AN,
  algorithme: 'm3e-v1', methodeMaterialisation: 'x264-crf23-v1',
  algorithmePlan: ALGORITHME_PLAN, format: '9:16', dureeCibleSecondes: 25,
};

const contenu = {
  largeurCible: 1080, hauteurCible: 1920, fps: 30,
  plans: [], dureeTotaleSecondes: 0, ecartSecondes: 0, clipsEcartes: 0, usage: {},
};

function post(corps: unknown, clipSetId = CL) {
  return POST(
    { text: async () => (corps === undefined ? '' : JSON.stringify(corps)) } as never,
    { params: { clipSetId } },
  );
}

beforeEach(() => {
  tables = { rush_clip_sets: [ligneJeu()], rush_analyses: [ligneAnalyse()], rush_montage_plans: [] };
  tableAbsente = null;
  tableEnPanne = null;
  insertions.length = 0;
});

// ═════════════════════════════════════════════════════════════════════════
describe('1-8. Le contrat : formats, durée, raccord, recadrage', () => {
  it('les vocabulaires sont FERMÉS', () => {
    expect(FORMATS_MONTAGE).toEqual(['9:16', '1:1', '16:9']);
    expect(RACCORDS).toEqual(['coupe']);
    expect(RACCORD_DEFAUT).toBe('coupe');
    expect(STRATEGIES_RECADRAGE).toEqual(['aucun', 'centre-largeur', 'centre-hauteur']);
    expect(MOTIFS_PLAN).toEqual([
      'jeu_non_reussi', 'jeu_sans_clip', 'format_invalide',
      'duree_cible_invalide', 'geometrie_inconnue', 'plan_vide',
    ]);
    expect(ALGORITHME_PLAN).toBe('m3g-v1');
    expect(formatValide('9:16')).toBe(true);
    expect(formatValide('4:3')).toBe(false);
    expect(formatValide('')).toBe(false);
  });

  it('les dimensions viennent de l’éditeur, jamais d’un second jeu de valeurs', () => {
    expect(dimensionsCible('9:16')).toEqual({ largeur: 1080, hauteur: 1920 });
    expect(dimensionsCible('1:1')).toEqual({ largeur: 1080, hauteur: 1080 });
    expect(dimensionsCible('16:9')).toEqual({ largeur: 1920, hauteur: 1080 });

    // ⚠️ PAS DE QUATRIÈME VOCABULAIRE. Les dimensions sont lues dans
    // `designSpec.ts`, et un test le prouve sur la source : les redéclarer
    // aurait fait diverger l'éditeur et l'Autopilote sans que rien ne rougisse.
    const contrat = readFileSync(SRC.contrat, 'utf8');
    expect(contrat).toContain("from '@/lib/creer/designSpec'");
    expect(contrat).toContain('VIDEO_SIZE[format]');
    expect(contrat).not.toMatch(/1080\s*,\s*h(auteur)?:\s*1920/);
  });

  it('la durée cible n’a AUCUN défaut, et ses bornes sont DÉRIVÉES', () => {
    // ⚠️ LE CŒUR DE L'ARBITRAGE. Aucune durée universelle cachée : sans
    // valeur explicite, rien ne passe.
    expect(dureeCibleValide(undefined)).toBe(false);
    expect(dureeCibleValide(null)).toBe(false);
    expect(dureeCibleValide('')).toBe(false);
    expect(dureeCibleValide(0)).toBe(false);
    expect(dureeCibleValide(-5)).toBe(false);
    expect(dureeCibleValide(Number.NaN)).toBe(false);
    expect(dureeCibleValide(25)).toBe(true);

    // Les bornes ne sont pas choisies : le plancher est celui de l'éditeur,
    // le plafond est la matière que M3-F sait produire.
    const spec = readFileSync(resolve(process.cwd(), 'src/lib/creer/designSpec.ts'), 'utf8');
    const min = /RUSH_SEQUENCE_SECONDS = \{ fallback: \d+, min: (\d+)/.exec(spec);
    expect(Number(min![1])).toBe(DUREE_CIBLE_MIN_SECONDES);
    const clipContrat = readFileSync(
      resolve(process.cwd(), 'src/lib/autopilot/analyse/clip-contrat.ts'), 'utf8',
    );
    const max = /export const SET_SECONDES_MAX = (\d+);/.exec(clipContrat);
    expect(Number(max![1])).toBe(DUREE_CIBLE_MAX_SECONDES);
    expect(dureeCibleValide(DUREE_CIBLE_MAX_SECONDES)).toBe(true);
    expect(dureeCibleValide(DUREE_CIBLE_MAX_SECONDES + 0.001)).toBe(false);
  });

  it('AUCUNE PLAGE DE DURÉE PAR RATIO — la même pour les trois formats', () => {
    // L'arbitrage l'interdit explicitement : rien, dans un rapport
    // largeur/hauteur, ne dit combien de temps une vidéo doit durer.
    for (const f of FORMATS_MONTAGE) {
      void f;
      expect(dureeCibleValide(DUREE_CIBLE_MIN_SECONDES)).toBe(true);
      expect(dureeCibleValide(DUREE_CIBLE_MAX_SECONDES)).toBe(true);
    }
    const src = readFileSync(SRC.contrat, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    // Aucune table de durées indexée par format.
    expect(src).not.toMatch(/'9:16'\s*:\s*\{[^}]*duree/i);
    expect(src).not.toMatch(/DUREE[A-Z_]*_PAR_FORMAT/);
  });

  it('la durée MESURÉE fait foi, la demandée ne sert que de repli', () => {
    // ⚠️ TOUT LE SENS DU COÛT CPU DE M3-F. Sur le rush de production, le
    // quatrième clip mesure 2,934 s pour 2,92 s demandées.
    const [, , , quatrieme] = clipsProduction();
    expect(quatrieme.dureeSecondes).toBe(2.92);
    expect(dureeUtilisable(quatrieme)).toBe(2.934);

    // Mesure absente : on retombe sur la demandée plutôt que d'écarter le clip.
    expect(dureeUtilisable({ ...quatrieme, dureeMesureeSecondes: null })).toBe(2.92);
    // Les deux inutilisables : aucune invention.
    expect(dureeUtilisable({
      ...quatrieme, dureeMesureeSecondes: null, dureeSecondes: 0,
    })).toBeNull();
  });

  it('le recadrage prélève AU CENTRE, et ne sort jamais de la source', () => {
    // 16:9 vers 16:9 : rien à faire.
    const identiteRatio = recadrer(1920, 1080, '16:9')!;
    expect(identiteRatio.strategie).toBe('aucun');
    expect(identiteRatio.recadrage).toEqual({ x: 0, y: 0, largeur: 1, hauteur: 1 });

    // 16:9 vers 1:1 : on prélève sur la largeur.
    const carre = recadrer(1920, 1080, '1:1')!;
    expect(carre.strategie).toBe('centre-largeur');
    expect(carre.recadrage.hauteur).toBe(1);
    expect(carre.recadrage.largeur).toBeCloseTo(1080 / 1920, 6);
    expect(carre.recadrage.x).toBeCloseTo((1 - 1080 / 1920) / 2, 6);

    // 16:9 vers 9:16 : on prélève beaucoup plus.
    const vertical = recadrer(1920, 1080, '9:16')!;
    expect(vertical.strategie).toBe('centre-largeur');
    expect(vertical.recadrage.largeur).toBeCloseTo((1080 / 1920) * (1080 / 1920), 6);
    expect(vertical.recadrage.y).toBe(0);

    // Un rush VERTICAL vers du 16:9 : on prélève sur la hauteur — jamais de
    // bandes noires ni de fond flou, ce serait de l'habillage.
    const paysage = recadrer(1080, 1920, '16:9')!;
    expect(paysage.strategie).toBe('centre-hauteur');
    expect(paysage.recadrage.largeur).toBe(1);
    expect(paysage.recadrage.x).toBe(0);
    expect(paysage.recadrage.hauteur).toBeLessThan(1);

    // Aucun rectangle ne sort de [0, 1].
    for (const c of [identiteRatio, carre, vertical, paysage]) {
      const { x, y, largeur, hauteur } = c.recadrage;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + largeur).toBeLessThanOrEqual(1 + 1e-9);
      expect(y + hauteur).toBeLessThanOrEqual(1 + 1e-9);
    }

    // Une géométrie absurde ne produit pas un rectangle de fantaisie.
    expect(recadrer(0, 1080, '9:16')).toBeNull();
    expect(recadrer(1920, -1, '9:16')).toBeNull();
    expect(recadrer(Number.NaN, 1080, '9:16')).toBeNull();
  });

  it('un écart de ratio négligeable ne déclenche AUCUN recadrage', () => {
    // 1,7778 contre 1,77777 : un arrondi de conteneur, pas un cadrage.
    const presque = recadrer(1920, 1080 * (1 + TOLERANCE_RATIO / 2), '16:9')!;
    expect(presque.strategie).toBe('aucun');
  });

  it('un plan relu sans clé, avec une URL, ou hors bornes est ÉCARTÉ', () => {
    const bon = {
      ordre: 1, rangClip: 1, bucket: 'videos', cle: 'A/x.mp4',
      entreeSecondes: 0, dureeRetenueSecondes: 5, debutTimelineSecondes: 0,
      raccourci: false, recadrage: { x: 0, y: 0, largeur: 1, hauteur: 1 },
      strategieRecadrage: 'aucun', largeurSource: 1920, hauteurSource: 1080,
      raccordEntrant: 'coupe',
    };
    expect(planValide(bon)).toBe(true);
    expect(planValide({ ...bon, cle: '' })).toBe(false);
    expect(planValide({ ...bon, cle: 'https://minio/x.mp4' })).toBe(false);
    expect(planValide({ ...bon, raccordEntrant: 'fondu' })).toBe(false);
    expect(planValide({ ...bon, strategieRecadrage: 'magique' })).toBe(false);
    expect(planValide({ ...bon, recadrage: { x: -0.1, y: 0, largeur: 1, hauteur: 1 } })).toBe(false);
    expect(planValide({ ...bon, recadrage: { x: 0, y: 0, largeur: 2, hauteur: 1 } })).toBe(false);
    expect(planValide({ ...bon, dureeRetenueSecondes: 'cinq' })).toBe(false);
    expect(planValide(null)).toBe(false);
  });

  it('la géométrie est LUE, jamais devinée', () => {
    expect(geometrieDepuisTechnique({ largeur: 1920, hauteur: 1080, fps: 25 }))
      .toEqual({ largeur: 1920, hauteur: 1080, fps: 25 });
    // Les images par seconde retombent sur la cadence des compositions.
    expect(geometrieDepuisTechnique({ largeur: 1920, hauteur: 1080 })?.fps).toBe(30);
    // Les dimensions, elles, n'ont AUCUN défaut : supposer du 1920×1080
    // aurait recadré de travers un rush vertical, sans que rien ne proteste.
    expect(geometrieDepuisTechnique({ hauteur: 1080 })).toBeNull();
    expect(geometrieDepuisTechnique({ largeur: 0, hauteur: 1080 })).toBeNull();
    expect(geometrieDepuisTechnique({})).toBeNull();
    expect(geometrieDepuisTechnique(null)).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('9-18. Le moteur : ordre, durée, recadrage, déterminisme', () => {
  it('un jeu réussi donne un plan valide, dans l’ordre de M3-F', () => {
    const { resultat } = planifierMontage({
      clips: clipsProduction(), format: '9:16',
      dureeCibleSecondes: 30, geometrie: GEO_16_9,
    });
    expect(resultat).not.toBeNull();
    expect(resultat!.plans.map((p) => p.ordre)).toEqual([1, 2, 3, 4, 5]);
    expect(resultat!.plans.map((p) => p.rangClip)).toEqual([1, 2, 3, 4, 5]);
    // 5 + 8 + 8 + 2,934 + 3 : la somme des durées MESURÉES.
    expect(resultat!.dureeTotaleSecondes).toBe(26.934);
    expect(resultat!.clipsEcartes).toBe(0);
  });

  it('L’ORDRE EST DÉTERMINISTE : l’ordre d’arrivée ne change rien', () => {
    const melange = [...clipsProduction()].reverse();
    const a = planifierMontage({
      clips: clipsProduction(), format: '9:16', dureeCibleSecondes: 30, geometrie: GEO_16_9,
    });
    const b = planifierMontage({
      clips: melange, format: '9:16', dureeCibleSecondes: 30, geometrie: GEO_16_9,
    });
    expect(b.resultat).toEqual(a.resultat);
    // Et deux appels identiques rendent strictement la même chose.
    const c = planifierMontage({
      clips: clipsProduction(), format: '9:16', dureeCibleSecondes: 30, geometrie: GEO_16_9,
    });
    expect(c.resultat).toEqual(a.resultat);
  });

  it('COUPE FRANCHE : la timeline est la somme exacte, sans recouvrement', () => {
    const { resultat } = planifierMontage({
      clips: clipsProduction(), format: '9:16',
      dureeCibleSecondes: 30, geometrie: GEO_16_9,
    });
    const plans = resultat!.plans;
    // Chaque plan porte le raccord, écrit et non deviné.
    for (const p of plans) expect(p.raccordEntrant).toBe('coupe');

    // ⚠️ L'ÉGALITÉ QUI CASSERA AU PREMIER FONDU — et forcera à traiter le
    // recouvrement plutôt qu'à l'oublier.
    let attendu = 0;
    for (const p of plans) {
      expect(p.debutTimelineSecondes).toBeCloseTo(attendu, 6);
      attendu += p.dureeRetenueSecondes;
    }
    expect(resultat!.dureeTotaleSecondes).toBeCloseTo(attendu, 6);
    expect(resultat!.dureeTotaleSecondes).toBeCloseTo(
      plans.reduce((t, p) => t + p.dureeRetenueSecondes, 0), 6,
    );

    // `TRANSITION_SECONDS` de l'éditeur n'intervient nulle part ici.
    const moteur = readFileSync(SRC.moteur, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(moteur).not.toContain('TRANSITION_SECONDS');
    expect(moteur).not.toMatch(/fondu|crossfade/i);
  });

  it('cible INFÉRIEURE au disponible : le dernier plan est RACCOURCI', () => {
    // 5 + 8 + 8 = 21, puis 2,934 déborderait à 23,934 : on raccourcit à 22.
    const { resultat } = planifierMontage({
      clips: clipsProduction(), format: '9:16',
      dureeCibleSecondes: 22, geometrie: GEO_16_9,
    });
    expect(resultat!.dureeTotaleSecondes).toBe(22);
    expect(resultat!.ecartSecondes).toBe(0);
    const dernier = resultat!.plans[resultat!.plans.length - 1];
    expect(dernier.raccourci).toBe(true);
    expect(dernier.dureeRetenueSecondes).toBe(1);
    // Le cinquième clip n'a plus de place : écarté, et COMPTÉ.
    expect(resultat!.clipsEcartes).toBe(1);
    expect(resultat!.plans).toHaveLength(4);
  });

  it('un plan raccourci SOUS LE PLANCHER est écarté, pas laissé clignoter', () => {
    // 5 + 8 + 8 = 21 ; viser 21,5 ne laisserait que 0,5 s au suivant.
    const { resultat } = planifierMontage({
      clips: clipsProduction(), format: '9:16',
      dureeCibleSecondes: 21.5, geometrie: GEO_16_9,
    });
    expect(resultat!.plans).toHaveLength(3);
    expect(resultat!.dureeTotaleSecondes).toBe(21);
    // Le déficit de 0,5 s est DIT, pas comblé par un plan de 0,5 s.
    expect(resultat!.ecartSecondes).toBe(0.5);
    expect(DUREE_PLAN_MIN_SECONDES).toBe(1);
  });

  it('cible SUPÉRIEURE au disponible : l’écart est EXPOSÉ, jamais comblé', () => {
    const { resultat } = planifierMontage({
      clips: clipsProduction(), format: '9:16',
      dureeCibleSecondes: 60, geometrie: GEO_16_9,
    });
    expect(resultat!.plans).toHaveLength(5);
    expect(resultat!.dureeTotaleSecondes).toBe(26.934);
    // 60 − 26,934 : le manque, dit en clair.
    expect(resultat!.ecartSecondes).toBe(33.066);
    // ⚠️ AUCUN CLIP DUPLIQUÉ pour remplir. Chaque clé n'apparaît qu'une fois.
    const cles = resultat!.plans.map((p) => p.cle);
    expect(new Set(cles).size).toBe(cles.length);
    const rangs = resultat!.plans.map((p) => p.rangClip);
    expect(new Set(rangs).size).toBe(rangs.length);
    // Et aucun plan ne dure plus que son clip.
    const parRang = new Map(clipsProduction().map((c) => [c.rang, dureeUtilisable(c)!]));
    for (const p of resultat!.plans) {
      expect(p.dureeRetenueSecondes).toBeLessThanOrEqual(parRang.get(p.rangClip)!);
    }
  });

  it('AUCUN CLIP DUPLIQUÉ, même quand la cible est très supérieure', () => {
    const { resultat } = planifierMontage({
      clips: clipsProduction(), format: '9:16',
      dureeCibleSecondes: DUREE_CIBLE_MAX_SECONDES, geometrie: GEO_16_9,
    });
    expect(resultat!.plans).toHaveLength(5);
    expect(resultat!.dureeTotaleSecondes).toBe(26.934);
    expect(new Set(resultat!.plans.map((p) => p.cle)).size).toBe(5);
  });

  it('jamais plus de plans que M3-F ne sait produire de clips', () => {
    // ⚠️ NEUF PASSAGES DISTINCTS, pas neuf copies du premier. Depuis la
    // politique editoriale, neuf clips qui pointent tous sur `0 → 5` sont
    // NEUF FOIS LA MEME IMAGE : huit seraient ecartes comme repetitions, et
    // ce test ne mesurerait plus le plafond qu'il vise.
    const beaucoup = Array.from({ length: 9 }, (_, i) => ({
      ...clipsProduction()[0], rang: i + 1,
      debutSecondes: i * 10,
      finSecondes: i * 10 + 5,
      cle: `A/autopilote/clips/${CL}/rang-0${i + 1}.mp4`,
    }));
    const { resultat } = planifierMontage({
      clips: beaucoup, format: '9:16',
      dureeCibleSecondes: DUREE_CIBLE_MAX_SECONDES, geometrie: GEO_16_9,
    });
    expect(resultat!.plans.length).toBeLessThanOrEqual(PLANS_MAX);
    expect(resultat!.plans).toHaveLength(6);
    expect(resultat!.clipsEcartes).toBe(3);
  });

  it('les trois formats produisent chacun leur recadrage', () => {
    const attendu: Record<string, string> = {
      '16:9': 'aucun', '1:1': 'centre-largeur', '9:16': 'centre-largeur',
    };
    for (const format of FORMATS_MONTAGE) {
      const { resultat } = planifierMontage({
        clips: clipsProduction(), format,
        dureeCibleSecondes: 30, geometrie: GEO_16_9,
      });
      expect(resultat).not.toBeNull();
      // ⚠️ CHAQUE PLAN PORTE SON RECTANGLE — M3-H n'a rien à recalculer.
      for (const p of resultat!.plans) {
        expect(p.strategieRecadrage).toBe(attendu[format]);
        expect(p.recadrage).toBeDefined();
        expect(p.largeurSource).toBe(1920);
        expect(p.hauteurSource).toBe(1080);
      }
      const dims = dimensionsCible(format);
      expect(resultat!.usage.largeurCible).toBe(dims.largeur);
      expect(resultat!.usage.hauteurCible).toBe(dims.hauteur);
    }
  });

  it('un jeu HÉTÉROGÈNE n’est pas refusé — chaque plan porte sa géométrie', () => {
    // La géométrie vient du rush ; deux rushes différents donnent deux
    // rectangles différents. Refuser le jeu aurait été le contraire de
    // l'arbitrage : M3-G DÉCRIT le recadrage, il ne s'y dérobe pas.
    const vertical = planifierMontage({
      clips: clipsProduction(), format: '9:16',
      dureeCibleSecondes: 20, geometrie: { largeur: 1080, hauteur: 1920, fps: 30 },
    });
    expect(vertical.resultat!.plans[0].strategieRecadrage).toBe('aucun');
    const paysage = planifierMontage({
      clips: clipsProduction(), format: '9:16', dureeCibleSecondes: 20, geometrie: GEO_16_9,
    });
    expect(paysage.resultat!.plans[0].strategieRecadrage).toBe('centre-largeur');
    expect(vertical.resultat!.plans[0].recadrage)
      .not.toEqual(paysage.resultat!.plans[0].recadrage);
  });

  it('sans clip, sans géométrie : un motif, jamais un plan vide', () => {
    expect(planifierMontage({
      clips: [], format: '9:16', dureeCibleSecondes: 25, geometrie: GEO_16_9,
    }).motif).toBe('jeu_sans_clip');

    expect(planifierMontage({
      clips: clipsProduction(), format: '9:16', dureeCibleSecondes: 25,
      geometrie: { largeur: 0, hauteur: 0, fps: 30 },
    }).motif).toBe('geometrie_inconnue');

    // Des clips tous inexploitables : aucun plan, et on le dit.
    const morts = clipsProduction().map((c) => ({
      ...c, dureeSecondes: 0, dureeMesureeSecondes: 0,
    }));
    expect(planifierMontage({
      clips: morts, format: '9:16', dureeCibleSecondes: 25, geometrie: GEO_16_9,
    }).motif).toBe('plan_vide');
  });

  it('le relevé de décision dit ce qui a été écarté et pourquoi', () => {
    const { resultat } = planifierMontage({
      clips: clipsProduction(), format: '1:1',
      dureeCibleSecondes: 22, geometrie: GEO_16_9,
    });
    expect(resultat!.usage).toMatchObject({
      algorithmePlan: 'm3g-v1',
      clipsRecus: 5,
      plansRetenus: 4,
      clipsEcartes: 1,
      plansRaccourcis: 1,
      secondesDisponibles: 26.934,
      strategieRecadrage: 'centre-largeur',
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('19-24. La persistance : identité, idempotence, propriété', () => {
  it('un plan identique est RETROUVÉ — format et durée compris', async () => {
    const cree = await creerPlan('A', identite, contenu);
    expect(cree.motif).toBeNull();
    expect(cree.plan).not.toBeNull();

    expect((await lirePlanIdentique('A', identite)).plan?.id).toBe(cree.plan!.id);

    // ⚠️ LE FORMAT FAIT PARTIE DE L'IDENTITÉ. Sans lui, demander un 16:9
    // ressortirait le 9:16 déjà calculé, sans que rien ne le signale.
    expect((await lirePlanIdentique('A', { ...identite, format: '16:9' })).plan).toBeNull();
    // La durée cible aussi.
    expect((await lirePlanIdentique('A', {
      ...identite, dureeCibleSecondes: 40,
    })).plan).toBeNull();
    // Et la méthode de matérialisation : d'autres octets, un autre plan.
    expect((await lirePlanIdentique('A', {
      ...identite, methodeMaterialisation: 'x264-crf18-v2',
    })).plan).toBeNull();
    // Comme la version du jeu de clips.
    expect((await lirePlanIdentique('A', { ...identite, clipSetVersion: 2 })).plan).toBeNull();
  });

  it('deux créations concurrentes : LA BASE en refuse une', async () => {
    const [x, y] = await Promise.allSettled([
      creerPlan('A', identite, contenu), creerPlan('A', identite, contenu),
    ]);
    const motifs = [x, y].map(
      (r) => (r.status === 'fulfilled' ? r.value.motif : 'rejete'),
    );
    // L'index unique tranche : un plan créé, un refus explicite.
    expect(motifs.filter((m) => m === null)).toHaveLength(1);
    expect(motifs.filter((m) => m === 'plan_concurrent')).toHaveLength(1);
    expect(tables.rush_montage_plans).toHaveLength(1);
  });

  it('le jeu de clips d’autrui : LA CLÉ ÉTRANGÈRE refuse, pas un `if`', async () => {
    // Le jeu appartient à A ; B le désigne. La base établit les deux faits
    // d'un coup — existence et propriété.
    await expect(creerPlan('B', identite, contenu)).rejects.toThrowError(
      /foreign key|rush_montage_plans_jeu_proprietaire/,
    );
    expect(tables.rush_montage_plans).toHaveLength(0);
  });

  it('une lecture par identifiant filtre le propriétaire DANS la requête', async () => {
    const cree = await creerPlan('A', identite, contenu);
    expect((await lirePlanParId('A', cree.plan!.id)).plan?.id).toBe(cree.plan!.id);
    // Le plan d'autrui ne revient pas : l'appelant n'a rien à décider.
    expect((await lirePlanParId('B', cree.plan!.id)).plan).toBeNull();
  });

  it('une table absente se dit `socle_absent`, jamais « aucun plan »', async () => {
    tableAbsente = 'rush_montage_plans';
    expect((await lirePlanIdentique('A', identite)).motif).toBe('socle_absent');
    expect((await lirePlanParId('A', CL)).motif).toBe('socle_absent');
    expect((await creerPlan('A', identite, contenu)).motif).toBe('socle_absent');
  });

  it('une ligne relue revalide ses plans un à un', () => {
    const plan = planDepuisLigne({
      id: 'x', user_id: 'A', clip_set_id: CL, clip_set_version: 1,
      candidate_set_id: CS, analysis_id: AN, algorithme: 'm3e-v1',
      methode_materialisation: 'x264-crf23-v1', algorithme_plan: 'm3g-v1',
      format: '9:16', duree_cible_secondes: '25', version: 1,
      largeur_cible: 1080, hauteur_cible: 1920, fps: 30,
      plans: [
        { ordre: 1, rangClip: 1, bucket: 'videos', cle: 'A/x.mp4', entreeSecondes: 0,
          dureeRetenueSecondes: 5, debutTimelineSecondes: 0, raccourci: false,
          recadrage: { x: 0, y: 0, largeur: 1, hauteur: 1 },
          strategieRecadrage: 'aucun', largeurSource: 1920, hauteurSource: 1080,
          raccordEntrant: 'coupe' },
        // ⚠️ CELUI-CI PORTE UNE URL : il ne doit pas ressortir.
        { ordre: 2, rangClip: 2, bucket: 'videos', cle: 'https://minio/y.mp4',
          entreeSecondes: 0, dureeRetenueSecondes: 5, debutTimelineSecondes: 5,
          raccourci: false, recadrage: { x: 0, y: 0, largeur: 1, hauteur: 1 },
          strategieRecadrage: 'aucun', largeurSource: 1920, hauteurSource: 1080,
          raccordEntrant: 'coupe' },
        'pas un objet',
      ],
      duree_totale_secondes: '10', ecart_secondes: '0', clips_ecartes: 0, usage: {},
      created_at: 'x', updated_at: 'y',
    });
    expect(plan.plans).toHaveLength(1);
    // Les `numeric` reviennent en chaîne de PostgREST : ils redeviennent des
    // nombres, sinon une comparaison d'identité échouerait en silence.
    expect(plan.dureeCibleSecondes).toBe(25);
    expect(plan.dureeTotaleSecondes).toBe(10);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('25-36. Les routes : refus, propriété, aucun paramètre de montage', () => {
  it('sans session : 401', async () => {
    const auth = await import('@/lib/auth/config');
    const espion = vi.spyOn(auth, 'auth').mockResolvedValueOnce(null as never);
    expect((await post({ format: '9:16', dureeCibleSecondes: 25 })).status).toBe(401);
    espion.mockRestore();
  });

  it('identifiant malformé : 422, avant toute lecture', async () => {
    const rep = await post({ format: '9:16', dureeCibleSecondes: 25 }, 'pas-un-uuid');
    expect(rep.status).toBe(422);
    expect(insertions).toHaveLength(0);
  });

  it('jeu de clips inconnu, ou d’autrui : 404 indistinguable', async () => {
    expect((await post({ format: '9:16', dureeCibleSecondes: 25 }, AUTRE)).status).toBe(404);
    // Le jeu de B existe, mais A ne doit pas apprendre qu'il existe.
    tables.rush_clip_sets = [ligneJeu({ user_id: 'B' })];
    expect((await post({ format: '9:16', dureeCibleSecondes: 25 })).status).toBe(404);
  });

  it('jeu non réussi, ou sans clip : 409 avec son motif', async () => {
    tables.rush_clip_sets = [ligneJeu({ etat: 'en_cours' })];
    const a = await post({ format: '9:16', dureeCibleSecondes: 25 });
    expect(a.status).toBe(409);
    expect((await a.json()).motif).toBe('jeu_non_reussi');

    tables.rush_clip_sets = [ligneJeu({ clips: [] })];
    const b = await post({ format: '9:16', dureeCibleSecondes: 25 });
    expect(b.status).toBe(409);
    expect((await b.json()).motif).toBe('jeu_sans_clip');
    expect(insertions).toHaveLength(0);
  });

  it('LA DURÉE CIBLE EST OBLIGATOIRE — aucun défaut ne la remplace', async () => {
    // ⚠️ LE TEST QUI TIENT L'ARBITRAGE. Sans durée, rien n'est monté.
    const vide = await post(undefined);
    expect(vide.status).toBe(422);
    expect((await vide.json()).motif).toBe('corps_manquant');

    const sansDuree = await post({ format: '9:16' });
    expect(sansDuree.status).toBe(422);
    expect((await sansDuree.json()).motif).toBe('duree_cible_invalide');

    for (const mauvaise of [0, -1, 'trente', null, DUREE_CIBLE_MAX_SECONDES + 1]) {
      const r = await post({ format: '9:16', dureeCibleSecondes: mauvaise });
      expect(r.status).toBe(422);
    }
    expect(insertions).toHaveLength(0);
  });

  it('format absent ou inconnu : 422, sans rien écrire', async () => {
    for (const mauvais of [undefined, '4:3', '', 42]) {
      const r = await post({ format: mauvais, dureeCibleSecondes: 25 });
      expect(r.status).toBe(422);
      expect((await r.json()).motif).toBe('format_invalide');
    }
    expect(insertions).toHaveLength(0);
  });

  it('AUCUN PARAMÈTRE DE MONTAGE CLIENT : les champs sont REFUSÉS', async () => {
    // Accepter `plans` ou `dureeRetenueSecondes` laisserait monter n'importe
    // quoi sous couvert d'un plan calculé — et contournerait M3-C → M3-F.
    for (const interdit of ['plans', 'ordre', 'dureeRetenueSecondes',
      'debutTimelineSecondes', 'entreeSecondes', 'debutSecondes', 'finSecondes',
      'coupes', 'clips', 'recadrage', 'crop', 'largeurSource', 'hauteurSource',
      'largeurCible', 'hauteurCible', 'raccordEntrant', 'bucket', 'cle',
      'cleObjet', 'rushId', 'userId', 'user_id']) {
      const rep = await post({
        format: '9:16', dureeCibleSecondes: 25, [interdit]: 'peu importe',
      });
      expect(rep.status, interdit).toBe(422);
      expect(String((await rep.json()).error)).toContain(interdit);
    }
    expect(insertions).toHaveLength(0);
  });

  it('un POST nominal rend 201, et le plan porte tout ce que M3-H attend', async () => {
    const rep = await post({ format: '9:16', dureeCibleSecondes: 25 });
    expect(rep.status).toBe(201);
    const b = await rep.json();
    expect(b.reutilise).toBe(false);
    expect(b.plan).toMatchObject({
      clipSetId: CL, clipSetVersion: 1, candidateSetId: CS, analysisId: AN,
      algorithme: 'm3e-v1', methodeMaterialisation: 'x264-crf23-v1',
      algorithmePlan: 'm3g-v1', format: '9:16', dureeCibleSecondes: 25,
      largeurCible: 1080, hauteurCible: 1920, fps: 30, version: 1,
    });
    expect(b.plan.plans.length).toBeGreaterThan(0);
    for (const p of b.plan.plans) {
      expect(p.bucket).toBe('videos');
      expect(p.cle).toMatch(/^A\/autopilote\/clips\//);
      expect(p.raccordEntrant).toBe('coupe');
      expect(p.recadrage).toBeDefined();
      expect(p.strategieRecadrage).toBe('centre-largeur');
    }
  });

  it('DOUBLE POST IDENTIQUE : le plan est RÉUTILISÉ, rien n’est recalculé', async () => {
    const premier = await post({ format: '9:16', dureeCibleSecondes: 25 });
    expect(premier.status).toBe(201);
    const id = (await premier.json()).plan.id;
    const nbInsertions = insertions.length;

    const second = await post({ format: '9:16', dureeCibleSecondes: 25 });
    expect(second.status).toBe(200);
    const b = await second.json();
    expect(b.reutilise).toBe(true);
    expect(b.plan.id).toBe(id);
    // Aucune écriture supplémentaire, aucune version de plus.
    expect(insertions).toHaveLength(nbInsertions);
    expect(tables.rush_montage_plans).toHaveLength(1);
    expect(tables.rush_montage_plans[0].version).toBe(1);
  });

  it('un FORMAT différent produit un plan DISTINCT, pas une réutilisation', async () => {
    const a = await post({ format: '9:16', dureeCibleSecondes: 25 });
    const b = await post({ format: '16:9', dureeCibleSecondes: 25 });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const [ja, jb] = [await a.json(), await b.json()];
    expect(jb.reutilise).toBe(false);
    expect(jb.plan.id).not.toBe(ja.plan.id);
    expect(tables.rush_montage_plans).toHaveLength(2);
    // Le second est bien en 16:9, sans recadrage.
    expect(jb.plan.largeurCible).toBe(1920);
    expect(jb.plan.plans[0].strategieRecadrage).toBe('aucun');
  });

  it('géométrie inconnue : 409, et aucun plan écrit', async () => {
    tables.rush_analyses = [ligneAnalyse({ technique: {} })];
    const rep = await post({ format: '9:16', dureeCibleSecondes: 25 });
    expect(rep.status).toBe(409);
    expect((await rep.json()).motif).toBe('geometrie_inconnue');
    expect(insertions).toHaveLength(0);

    // Analyse absente : même refus, jamais un recadrage supposé.
    tables.rush_analyses = [];
    expect((await post({ format: '9:16', dureeCibleSecondes: 25 })).status).toBe(409);
  });

  it('socle absent : 503, jamais une panne muette', async () => {
    tableAbsente = 'rush_montage_plans';
    const rep = await post({ format: '9:16', dureeCibleSecondes: 25 });
    expect(rep.status).toBe(503);
    expect((await rep.json()).motif).toBe('socle_absent');
  });

  it('GET : lecture seule, 404 non fuyant, aucune écriture', async () => {
    const cree = await post({ format: '9:16', dureeCibleSecondes: 25 });
    const id = (await cree.json()).plan.id;
    const avant = JSON.stringify(tables.rush_montage_plans);

    const rep = await GET({} as never, { params: { montagePlanId: id } });
    expect(rep.status).toBe(200);
    expect((await rep.json()).plan.id).toBe(id);
    expect(rep.headers.get('Cache-Control')).toBe('private, no-store');
    // Consulter ne recalcule rien : un plan est une décision figée.
    expect(JSON.stringify(tables.rush_montage_plans)).toBe(avant);

    expect((await GET({} as never, { params: { montagePlanId: 'zzz' } })).status).toBe(422);
    expect((await GET({} as never, { params: { montagePlanId: AUTRE } })).status).toBe(404);
  });

  it('une panne inattendue ne RECOPIE jamais le message interne', async () => {
    const journal = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      tableEnPanne = 'rush_clip_sets';
      const rep = await post({ format: '9:16', dureeCibleSecondes: 25 });
      expect(rep.status).toBe(500);
      const corps = JSON.stringify(await rep.json());
      expect(corps).toContain('erreur_interne');
      expect(corps).not.toContain('10.0.0.4');
      expect(corps).not.toContain('postgres');
      expect(journal).toHaveBeenCalled();
    } finally {
      tableEnPanne = null;
      journal.mockRestore();
    }
  });

  it('AUCUNE URL dans ce qui sort ou ce qui est stocké', async () => {
    const rep = await post({ format: '9:16', dureeCibleSecondes: 25 });
    const texte = JSON.stringify(await rep.json())
      + JSON.stringify(tables.rush_montage_plans);
    expect(texte).not.toMatch(/https?:\/\//);
    expect(texte).not.toContain('X-Amz');
    expect(texte).not.toContain('studiio-minio');
    expect(texte).not.toContain('/tmp/');
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('37-44. Ce que M3-G ne touche pas', () => {
  const sources = () => Object.values(SRC).map((p) => readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''));

  it('AUCUN crédit, nulle part sur le chemin M3-G', () => {
    for (const s of sources()) {
      expect(s).not.toMatch(/@\/lib\/credits|credit_transactions|debiter|deduireCredits/);
      expect(s).not.toMatch(/from '@\/lib\/rendus/);
    }
  });

  it('AUCUN rendu, AUCUN ffmpeg, AUCUN fournisseur, AUCUN appel sortant', () => {
    for (const s of sources()) {
      expect(s).not.toMatch(/remotion|renderMedia|renderVideo|selectComposition/i);
      expect(s).not.toMatch(/ffmpeg|ffprobe|execFile|spawn|child_process/i);
      expect(s).not.toMatch(/anthropic|groq|openai/i);
      expect(s).not.toMatch(/\bfetch\s*\(|axios/);
    }
  });

  it('`render_jobs`, `rendus` et `videos` ne sont pas détournés', () => {
    for (const s of sources()) {
      expect(s).not.toContain('render_jobs');
      expect(s).not.toMatch(/from\('rendus'\)|from\('videos'\)|scheduled_posts/);
    }
  });

  it('AUCUN téléversement, AUCUNE signature : M3-G ne touche pas au stockage', () => {
    for (const s of sources()) {
      expect(s).not.toMatch(/putObject|removeObject|presignedGetObject|signeurInterne/);
      expect(s).not.toMatch(/clientMinio/);
    }
  });

  it('la dette de M3-H n’a pas été anticipée', () => {
    for (const s of sources()) {
      expect(s).not.toMatch(/sous-titre|subtitle|musicUrl|lut\b|watermark/i);
      expect(s).not.toMatch(/inputProps|compositionId/);
    }
  });

  it('les sources M3-C à M3-F ne sont pas modifiées par ce lot', () => {
    // M3-G les LIT — il ne les réécrit pas, et ne recopie pas leurs algorithmes.
    const moteur = readFileSync(SRC.moteur, 'utf8');
    expect(moteur).not.toContain('TOLERANCE_SECONDES');
    expect(moteur).not.toContain('gardeDuree');
    expect(moteur).not.toContain('argumentsDecoupe');
    // L'identité est HÉRITÉE, jamais recalculée.
    const route = readFileSync(SRC.routePost, 'utf8');
    expect(route).toContain('algorithme: set.algorithme');
    expect(route).toContain('methodeMaterialisation: set.methodeMaterialisation');
  });

  it('aucune commande shell, aucun accès disque', () => {
    for (const s of sources()) {
      expect(s).not.toMatch(/sh\s+-c|bash\s+-c|execSync/);
      expect(s).not.toMatch(/readFile|writeFile|mkdtemp|unlink/);
    }
  });

  it('la migration crée sa table, borne ce qu’elle accepte, et n’ouvre aucun droit', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
      .toLowerCase();

    expect(code).toContain('create table if not exists public.rush_montage_plans');
    expect(code).toMatch(
      /create\s+unique\s+index\s+if\s+not\s+exists\s+rush_montage_plans_identite_unique/,
    );
    // L'index préalable qu'exige la clé étrangère composite.
    expect(code).toMatch(
      /create\s+unique\s+index\s+if\s+not\s+exists\s+rush_clip_sets_id_user_key\s+on\s+public\.rush_clip_sets/,
    );
    expect(code).toContain('references public.rush_clip_sets (id, user_id)');
    // Le format et la durée cible sont bornés EN BASE, pas seulement en TypeScript.
    expect(code).toContain("format in ('9:16', '1:1', '16:9')");
    expect(code).toMatch(/duree_cible_secondes\s+numeric\(10,3\)\s+not null/);
    // Aucune URL ne peut entrer dans les plans.
    expect(code).toContain("plans::text not like '%://%'");

    // ⚠️ RIEN DE DESTRUCTIF, ET AUCUN DROIT OUVERT.
    expect(code, 'aucun ALTER').not.toMatch(/alter\s+table/);
    expect(code, 'aucun DROP').not.toMatch(/drop\s+/);
    expect(code, 'aucun GRANT').not.toMatch(/grant\s+/);
    expect(code, 'aucun DELETE').not.toMatch(/delete\s+from/);
    expect(code, 'aucun UPDATE').not.toMatch(/update\s+public\./);
    // Une seule table touchée hors la sienne, et seulement par un index.
    expect((code.match(/on public\.rush_clip_sets/g) ?? []).length).toBe(1);
    expect(code).not.toContain('rush_analyses');
    expect(code).not.toContain('rush_candidate_sets');
    expect(code).not.toContain('render_jobs');
  });

  it('les jeux de clips et les analyses ne sont jamais mutés', async () => {
    const avantJeux = JSON.stringify(tables.rush_clip_sets);
    const avantAnalyses = JSON.stringify(tables.rush_analyses);
    await post({ format: '9:16', dureeCibleSecondes: 25 });
    await post({ format: '1:1', dureeCibleSecondes: 12 });
    expect(JSON.stringify(tables.rush_clip_sets)).toBe(avantJeux);
    expect(JSON.stringify(tables.rush_analyses)).toBe(avantAnalyses);
    // Et rien n'a été inséré ailleurs que dans la table de M3-G.
    expect(insertions.every((i) => i.table === 'rush_montage_plans')).toBe(true);
  });
});
