/**
 * M3-B2.1 — La récupération d'une analyse interrompue.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI EST VÉRIFIÉ ICI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Une analyse peut rester `en_attente` ou `en_cours` DÉFINITIVEMENT si le
 * processus meurt entre `majAnalyse({ etat: 'en_cours' })` et la consignation
 * du résultat. `rush_analyses_active_unique` interdit alors toute nouvelle
 * analyse du rush, et aucune route ne sait la fermer.
 *
 * Ce fichier vérifie que la fermeture existe, qu'elle ne touche QUE ce qui est
 * manifestement abandonné, qu'elle est ATOMIQUE — pas de fenêtre entre la
 * lecture des candidats et l'écriture — et qu'une exécution ancienne qui
 * revient ne peut pas ressusciter ce qu'elle a laissé.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA DOUBLURE DE BASE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Reprise de `autopilote-m3b2-route.test.ts`, ÉTENDUE de deux choses :
 *
 *   * `.lt()`, qui compare réellement les dates — sans lui, le filtre de
 *     péremption ne serait pas exercé et le test ne prouverait rien ;
 *   * `avantEcriture`, un crochet appelé juste avant qu'un `update` ne
 *     s'applique. C'est le seul moyen de reproduire la COURSE : faire
 *     rafraîchir la ligne entre l'énumération et l'écriture, exactement là où
 *     un `select` puis un `update` par `id` se ferait piéger.
 *
 * Les filtres sont appliqués POUR DE VRAI, y compris ceux de l'`update` : un
 * `update` dont le `where` ne correspond plus à aucune ligne ne touche rien et
 * rend `null`, comme PostgreSQL.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PEREMPTION_ANALYSE_MS, MOTIF_ANALYSE_INTERROMPUE, seuilPeremptionAnalyse,
  ETATS_ACTIFS, MOTIF_ECHEC_MAX,
} from '@/lib/autopilot/analyse/contrat';
import {
  VIGNETTES_MAX, TIMEOUT_SONDE_MS, TIMEOUT_VIGNETTE_MS,
} from '@/lib/autopilot/analyse/extraction';

// ───────────────────────────────────────────────────────────────────────────
// Une base minuscule, en mémoire, avec le filtrage que fait PostgREST.
// ───────────────────────────────────────────────────────────────────────────
interface Ligne { [k: string]: unknown }
let tables: Record<string, Ligne[]>;
let tableAbsente: string | null = null;

/** Les suppressions TENTÉES. Doit rester vide : rien ne s'efface ici. */
const suppressions: Array<{ table: string }> = [];
/** Chaque `update` réellement appliqué, avec le nombre de lignes touchées. */
const majEffectuees: Array<{ table: string; valeurs: Ligne; touchees: number }> = [];

/**
 * Le crochet de course : appelé juste AVANT qu'un `update` ne filtre.
 *
 * Il reçoit la table visée et peut modifier `tables`. C'est ce qui permet de
 * faire redevenir fraîche une analyse qui était périmée au moment où elle a
 * été énumérée.
 */
let avantEcriture: ((table: string) => void) | null = null;

const erreurTable = { code: '42P01', message: 'relation does not exist' };

function doublon(index: string) {
  return {
    code: '23505',
    message: `duplicate key value violates unique constraint "${index}"`,
  };
}

/** Les deux index uniques de `rush_analyses`, appliqués. */
function refusUnicite(valeurs: Ligne): { code: string; message: string } | null {
  const lignes = tables.rush_analyses ?? [];
  const memeRush = lignes.filter((l) => l.rush_id === valeurs.rush_id);
  if (memeRush.some((l) => l.version === valeurs.version)) {
    return doublon('rush_analyses_rush_version_unique');
  }
  const actif = (e: unknown) => e === 'en_attente' || e === 'en_cours';
  if (actif(valeurs.etat) && memeRush.some((l) => actif(l.etat))) {
    return doublon('rush_analyses_active_unique');
  }
  return null;
}

/** `<` sur un `timestamptz` : une COMPARAISON DE DATES, pas de chaînes. */
function anterieur(valeur: unknown, borne: unknown): boolean {
  const a = Date.parse(String(valeur));
  const b = Date.parse(String(borne));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return a < b;
}

function requete(table: string) {
  const filtres: Array<[string, unknown]> = [];
  const filtresIn: Array<[string, unknown[]]> = [];
  const filtresLt: Array<[string, unknown]> = [];
  let tri: { colonne: string; asc: boolean } | null = null;
  let limite: number | null = null;
  let aInserer: Ligne | null = null;
  let aMettreAJour: Ligne | null = null;

  const lignes = () => {
    if (tableAbsente === table) return null;
    let out = (tables[table] ?? []).filter(
      (l) => filtres.every(([c, v]) => l[c] === v)
        && filtresIn.every(([c, vs]) => vs.includes(l[c]))
        && filtresLt.every(([c, v]) => anterieur(l[c], v)),
    );
    if (tri) {
      out = [...out].sort((a, b) => {
        const x = Number(a[tri!.colonne] ?? 0); const y = Number(b[tri!.colonne] ?? 0);
        return tri!.asc ? x - y : y - x;
      });
    }
    if (limite !== null) out = out.slice(0, limite);
    return out;
  };

  const executer = () => {
    if (tableAbsente === table) return { data: null, error: erreurTable };

    if (aInserer) {
      const valeurs: Ligne = { version: 1, etat: 'en_attente', ...aInserer };
      if (table === 'rush_analyses') {
        const rush = (tables.rushes ?? []).find(
          (r) => r.id === valeurs.rush_id && r.user_id === valeurs.user_id,
        );
        if (!rush) {
          return {
            data: null,
            error: {
              code: '23503',
              message: 'violates foreign key constraint "rush_analyses_rush_meme_proprietaire"',
            },
          };
        }
        const refus = refusUnicite(valeurs);
        if (refus) return { data: null, error: refus };
      }
      const ligne: Ligne = {
        id: `${table}-${(tables[table] ?? []).length + 1}`,
        etape: null,
        fournisseurs: {},
        duree_secondes: null,
        technique: {},
        resume: null,
        textes_visibles: [],
        parole: {},
        audio: {},
        qualite: {},
        vignettes: [],
        usage: {},
        motif_echec: null,
        created_at: MAINTENANT_ISO,
        updated_at: MAINTENANT_ISO,
        ...valeurs,
      };
      tables[table] = [...(tables[table] ?? []), ligne];
      return { data: ligne, error: null };
    }

    if (aMettreAJour) {
      // ⚠️ LA COURSE SE JOUE ICI. Le crochet s'exécute AVANT le filtrage,
      // donc ce que l'`update` voit est l'état de la base à l'instant de
      // l'écriture — jamais celui qu'avait vu la lecture qui l'a précédé.
      if (avantEcriture) avantEcriture(table);
      const cibles = lignes() ?? [];
      majEffectuees.push({ table, valeurs: aMettreAJour, touchees: cibles.length });
      if (cibles.length === 0) return { data: null, error: null };
      const patch = aMettreAJour;
      tables[table] = (tables[table] ?? []).map(
        (l) => (cibles.includes(l) ? { ...l, ...patch } : l),
      );
      const misAJour = (tables[table] ?? []).find((l) => l.id === cibles[0].id) ?? null;
      return { data: misAJour, error: null };
    }

    const l = lignes();
    return { data: l && l.length ? l[0] : null, error: null };
  };

  const api: Record<string, unknown> = {
    select: () => api,
    eq: (c: string, v: unknown) => { filtres.push([c, v]); return api; },
    in: (c: string, vs: unknown[]) => { filtresIn.push([c, vs]); return api; },
    lt: (c: string, v: unknown) => { filtresLt.push([c, v]); return api; },
    order: (c: string, o?: { ascending?: boolean }) => {
      tri = { colonne: c, asc: o?.ascending !== false }; return api;
    },
    limit: (n: number) => { limite = n; return api; },
    insert: (valeurs: Ligne) => { aInserer = valeurs; return api; },
    update: (valeurs: Ligne) => { aMettreAJour = valeurs; return api; },
    delete: () => { suppressions.push({ table }); return api; },
    maybeSingle: async () => executer(),
    then: (resoudre: (v: unknown) => unknown) => {
      if (aInserer || aMettreAJour) return resoudre(executer());
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

const {
  creerAnalyse, majAnalyse, listerAnalyses, recupererAnalysesInterrompues,
} = await import('@/lib/autopilot/analyse/service');

// ───────────────────────────────────────────────────────────────────────────
// Le temps est FIGÉ : une péremption se prouve par des dates, pas par une
// attente de quinze minutes.
//
// L'horloge SYSTÈME est figée elle aussi (`vi.setSystemTime`), et pas
// seulement la constante ci-dessous : `creerAnalyse` appelle la récupération
// sans lui passer d'instant, donc c'est `Date.now()` qui décide du seuil dans
// le chemin qui compte le plus. Un test qui ne figerait que sa propre
// constante daterait ses lignes dans le futur et ne prouverait rien.
// ───────────────────────────────────────────────────────────────────────────
const MAINTENANT = Date.parse('2026-09-05T12:00:00.000Z');
const MAINTENANT_ISO = new Date(MAINTENANT).toISOString();

/** Un `updated_at` vieux de `minutes`. */
function ilYA(minutes: number): string {
  return new Date(MAINTENANT - minutes * 60_000).toISOString();
}

const RUSH_DE_A: Ligne = {
  id: 'r-a', shoot_session_id: 's-a', user_id: 'A', bucket: 'media',
  cle_objet: 'A/rush/plan.mp4', nom_origine: 'plan.mp4', content_type: 'video/mp4',
  taille_octets: 5_000_000, duree_secondes: null, rang: 0, etat: 'verifie',
  metadata: {}, created_at: '2026-08-31T10:00:00Z', updated_at: '2026-08-31T10:00:00Z',
};
const AUTRE_RUSH_DE_A: Ligne = {
  ...RUSH_DE_A, id: 'r-a2', rang: 1, cle_objet: 'A/rush/plan2.mp4',
};
const RUSH_DE_B: Ligne = {
  ...RUSH_DE_A, id: 'r-b', shoot_session_id: 's-b', user_id: 'B',
  cle_objet: 'B/rush/plan.mp4',
};

/** Pose une analyse directement en base, sans passer par le service. */
function poser(analyse: Partial<Ligne> & { id: string }): Ligne {
  const ligne: Ligne = {
    rush_id: 'r-a', user_id: 'A', version: 1, etat: 'en_cours', etape: 'extraction',
    fournisseurs: {}, duree_secondes: null, technique: {}, resume: null,
    textes_visibles: [], parole: {}, audio: {}, qualite: {}, vignettes: [], usage: {},
    motif_echec: null, created_at: ilYA(60), updated_at: ilYA(60),
    ...analyse,
  };
  tables.rush_analyses = [...(tables.rush_analyses ?? []), ligne];
  return ligne;
}

function lireBrut(id: string): Ligne | undefined {
  return (tables.rush_analyses ?? []).find((l) => l.id === id);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MAINTENANT);
  suppressions.length = 0;
  majEffectuees.length = 0;
  tableAbsente = null;
  avantEcriture = null;
  tables = {
    rushes: [{ ...RUSH_DE_A }, { ...AUTRE_RUSH_DE_A }, { ...RUSH_DE_B }],
    rush_analyses: [],
  };
});

afterEach(() => {
  vi.useRealTimers();
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Le seuil de péremption reste très au-dessus des bornes du moteur', () => {
  /**
   * Ce test est le garde-fou du choix de 900 s. Il échouera le jour où
   * quelqu'un ajoutera des vignettes, allongera un délai — ou baissera le
   * seuil — au point de rendre possible la fermeture d'une analyse VIVANTE.
   */
  it('le pire cas du moteur tient largement dans le seuil', () => {
    // Deux sondages (ffprobe, puis le repli ffmpeg) plus toutes les vignettes.
    const pireCasMoteurMs = 2 * TIMEOUT_SONDE_MS + VIGNETTES_MAX * TIMEOUT_VIGNETTE_MS;
    expect(pireCasMoteurMs).toBe(220_000);
    expect(PEREMPTION_ANALYSE_MS).toBeGreaterThanOrEqual(4 * pireCasMoteurMs);
  });

  it('le seuil dépasse largement le budget dur de la route', () => {
    // `maxDuration = 300` : au-delà, la requête qui tenait l'analyse n'existe
    // plus, donc plus personne ne la fermera jamais.
    const budgetRouteMs = 300_000;
    expect(PEREMPTION_ANALYSE_MS).toBeGreaterThanOrEqual(3 * budgetRouteMs);
  });

  it('le motif tient dans la colonne, et il est stable', () => {
    expect(MOTIF_ANALYSE_INTERROMPUE).toBe('analyse_interrompue');
    expect(MOTIF_ANALYSE_INTERROMPUE.length).toBeLessThanOrEqual(MOTIF_ECHEC_MAX);
  });

  it('le seuil est bien un instant ANTÉRIEUR de la durée annoncée', () => {
    expect(Date.parse(seuilPeremptionAnalyse(MAINTENANT)))
      .toBe(MAINTENANT - PEREMPTION_ANALYSE_MS);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Une analyse RÉCENTE n est jamais fermée', () => {
  // (1)
  it('`en_cours` depuis une minute : intouchée', async () => {
    poser({ id: 'a-1', etat: 'en_cours', updated_at: ilYA(1) });

    const { recuperees } = await recupererAnalysesInterrompues('A', 'r-a', MAINTENANT);

    expect(recuperees).toHaveLength(0);
    expect(lireBrut('a-1')).toMatchObject({ etat: 'en_cours', motif_echec: null });
    // La preuve qui compte : aucune écriture n'a même été tentée.
    expect(majEffectuees).toHaveLength(0);
  });

  // (2)
  it('`en_attente` depuis une minute : intouchée', async () => {
    poser({ id: 'a-1', etat: 'en_attente', etape: null, updated_at: ilYA(1) });

    const { recuperees } = await recupererAnalysesInterrompues('A', 'r-a', MAINTENANT);

    expect(recuperees).toHaveLength(0);
    expect(lireBrut('a-1')).toMatchObject({ etat: 'en_attente', motif_echec: null });
  });

  it('juste avant le seuil, elle vit encore', async () => {
    // Une seconde en deçà de la péremption : la borne est franche.
    poser({
      id: 'a-1', etat: 'en_cours',
      updated_at: new Date(MAINTENANT - PEREMPTION_ANALYSE_MS + 1_000).toISOString(),
    });

    const { recuperees } = await recupererAnalysesInterrompues('A', 'r-a', MAINTENANT);

    expect(recuperees).toHaveLength(0);
    expect(lireBrut('a-1')).toMatchObject({ etat: 'en_cours' });
  });

  it('et une relance ne peut pas passer devant elle : la base refuse toujours', async () => {
    poser({ id: 'a-1', etat: 'en_cours', updated_at: ilYA(1) });

    const r = await creerAnalyse('A', 'r-a');

    expect(r.motif).toBe('analyse_active_existante');
    expect(lireBrut('a-1')).toMatchObject({ etat: 'en_cours' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Une analyse ABANDONNÉE est close, avec un motif', () => {
  // (3)
  it('`en_cours` au-delà du seuil : `echouee` + `analyse_interrompue`', async () => {
    poser({ id: 'a-1', etat: 'en_cours', updated_at: ilYA(30) });

    const { recuperees, motif } = await recupererAnalysesInterrompues('A', 'r-a', MAINTENANT);

    expect(motif).toBeNull();
    expect(recuperees).toHaveLength(1);
    expect(recuperees[0].etat).toBe('echouee');
    expect(recuperees[0].motifEchec).toBe(MOTIF_ANALYSE_INTERROMPUE);
    expect(lireBrut('a-1')).toMatchObject({
      etat: 'echouee', motif_echec: MOTIF_ANALYSE_INTERROMPUE,
    });
  });

  // (4)
  it('`en_attente` au-delà du seuil : idem', async () => {
    poser({ id: 'a-1', etat: 'en_attente', etape: null, updated_at: ilYA(30) });

    const { recuperees } = await recupererAnalysesInterrompues('A', 'r-a', MAINTENANT);

    expect(recuperees).toHaveLength(1);
    expect(lireBrut('a-1')).toMatchObject({
      etat: 'echouee', motif_echec: MOTIF_ANALYSE_INTERROMPUE,
    });
  });

  it('`updated_at` est rafraîchi : la ligne ne reste pas datée d il y a une heure', async () => {
    poser({ id: 'a-1', etat: 'en_cours', updated_at: ilYA(30) });

    await recupererAnalysesInterrompues('A', 'r-a', MAINTENANT);

    expect(lireBrut('a-1')?.updated_at).toBe(MAINTENANT_ISO);
  });

  it('une analyse DÉJÀ close n est pas retouchée, si vieille soit-elle', async () => {
    poser({
      id: 'a-1', etat: 'reussie', updated_at: ilYA(600), motif_echec: null,
      duree_secondes: 42,
    });
    poser({ id: 'a-2', etat: 'echouee', version: 2, updated_at: ilYA(600), motif_echec: 'timeout' });
    poser({ id: 'a-3', etat: 'annulee', version: 3, updated_at: ilYA(600) });

    const { recuperees } = await recupererAnalysesInterrompues('A', 'r-a', MAINTENANT);

    expect(recuperees).toHaveLength(0);
    expect(lireBrut('a-1')).toMatchObject({ etat: 'reussie', duree_secondes: 42 });
    expect(lireBrut('a-2')).toMatchObject({ etat: 'echouee', motif_echec: 'timeout' });
    expect(lireBrut('a-3')).toMatchObject({ etat: 'annulee' });
    expect(majEffectuees).toHaveLength(0);
  });

  it('seuls les deux états actifs du contrat sont concernés', () => {
    expect([...ETATS_ACTIFS].sort()).toEqual(['en_attente', 'en_cours']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Le périmètre : ce rush, cette personne, et rien d autre', () => {
  // (5)
  it('l analyse d un AUTRE utilisateur n est jamais touchée', async () => {
    poser({ id: 'b-1', rush_id: 'r-b', user_id: 'B', etat: 'en_cours', updated_at: ilYA(60) });

    const { recuperees } = await recupererAnalysesInterrompues('A', 'r-a', MAINTENANT);

    expect(recuperees).toHaveLength(0);
    expect(lireBrut('b-1')).toMatchObject({ etat: 'en_cours', motif_echec: null });
    expect(majEffectuees).toHaveLength(0);
  });

  it('même en visant SON rush, on ne ferme pas l analyse d autrui', async () => {
    // Le cas tordu : `rush_id` correct, `user_id` faux. Seule la conjonction
    // des deux `.eq()` l'écarte.
    poser({ id: 'b-2', rush_id: 'r-a', user_id: 'B', etat: 'en_cours', updated_at: ilYA(60) });

    const { recuperees } = await recupererAnalysesInterrompues('A', 'r-a', MAINTENANT);

    expect(recuperees).toHaveLength(0);
    expect(lireBrut('b-2')).toMatchObject({ etat: 'en_cours' });
  });

  // (6)
  it('l analyse d un AUTRE rush du même utilisateur n est pas touchée', async () => {
    poser({ id: 'a-1', rush_id: 'r-a', etat: 'en_cours', updated_at: ilYA(60) });
    poser({ id: 'a2-1', rush_id: 'r-a2', etat: 'en_cours', updated_at: ilYA(60) });

    const { recuperees } = await recupererAnalysesInterrompues('A', 'r-a', MAINTENANT);

    expect(recuperees).toHaveLength(1);
    expect(recuperees[0].rushId).toBe('r-a');
    expect(lireBrut('a-1')).toMatchObject({ etat: 'echouee' });
    // L'autre rush garde son blocage : c'est SA relance qui le résoudra.
    expect(lireBrut('a2-1')).toMatchObject({ etat: 'en_cours', motif_echec: null });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('L atomicité : la course entre l énumération et l écriture', () => {
  // (8)
  it('une analyse redevenue FRAÎCHE entre les deux n est PAS fermée', async () => {
    poser({ id: 'a-1', etat: 'en_cours', updated_at: ilYA(60) });

    // Une reprise tardive rafraîchit la ligne juste avant que l'`update` ne
    // s'applique — exactement la fenêtre qu'un `select` puis un `update` par
    // `id` seul laisserait ouverte.
    avantEcriture = (table) => {
      if (table !== 'rush_analyses') return;
      avantEcriture = null;
      tables.rush_analyses = (tables.rush_analyses ?? []).map(
        (l) => (l.id === 'a-1' ? { ...l, updated_at: MAINTENANT_ISO } : l),
      );
    };

    const { recuperees, motif } = await recupererAnalysesInterrompues('A', 'r-a', MAINTENANT);

    // L'`update` a bien été TENTÉ — la course a donc bien eu lieu — mais il
    // n'a touché aucune ligne.
    expect(majEffectuees).toHaveLength(1);
    expect(majEffectuees[0].touchees).toBe(0);
    expect(motif).toBeNull();
    expect(recuperees).toHaveLength(0);
    expect(lireBrut('a-1')).toMatchObject({ etat: 'en_cours', motif_echec: null });
  });

  it('une analyse CLOSE entre les deux n est pas re-fermée', async () => {
    poser({ id: 'a-1', etat: 'en_cours', updated_at: ilYA(60) });

    // L'exécution qui la tenait revient et consigne son résultat pile entre
    // l'énumération et l'écriture.
    avantEcriture = (table) => {
      if (table !== 'rush_analyses') return;
      avantEcriture = null;
      tables.rush_analyses = (tables.rush_analyses ?? []).map(
        (l) => (l.id === 'a-1' ? { ...l, etat: 'reussie', duree_secondes: 42 } : l),
      );
    };

    const { recuperees } = await recupererAnalysesInterrompues('A', 'r-a', MAINTENANT);

    expect(recuperees).toHaveLength(0);
    // Le `.in('etat', …)` de l'`update` a protégé le résultat consigné.
    expect(lireBrut('a-1')).toMatchObject({
      etat: 'reussie', duree_secondes: 42, motif_echec: null,
    });
  });

  it('l écriture rejoue TOUTES les conditions, `id` compris', async () => {
    // Deux analyses périmées de rushes différents. Si l'`update` ne portait
    // que sur `rush_id`, il fermerait aussi celle de l'autre rush ; s'il ne
    // portait que sur `id`, il fermerait une ligne redevenue fraîche. Le test
    // précédent couvre le second cas, celui-ci le premier.
    poser({ id: 'a-1', rush_id: 'r-a', etat: 'en_cours', updated_at: ilYA(60) });
    poser({ id: 'a2-1', rush_id: 'r-a2', etat: 'en_attente', updated_at: ilYA(60) });

    await recupererAnalysesInterrompues('A', 'r-a', MAINTENANT);

    expect(majEffectuees).toHaveLength(1);
    expect(majEffectuees[0].touchees).toBe(1);
    expect(lireBrut('a2-1')).toMatchObject({ etat: 'en_attente' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Le retour tardif ne ressuscite rien', () => {
  // (9)
  it('une exécution ancienne ne peut pas repasser une analyse close en `reussie`', async () => {
    poser({ id: 'a-1', etat: 'en_cours', updated_at: ilYA(60) });
    await recupererAnalysesInterrompues('A', 'r-a', MAINTENANT);
    expect(lireBrut('a-1')).toMatchObject({ etat: 'echouee' });

    // L'exécution que l'on croyait morte revient et consigne son résultat.
    const tardif = await majAnalyse('A', 'a-1', {
      etat: 'reussie',
      dureeSecondes: 42.5,
      technique: { largeur: 1080 },
    });

    // `majAnalyse` porte `.in('etat', ['en_attente', 'en_cours'])` : l'analyse
    // close ne satisfait plus le filtre, aucune ligne n'est touchée, et le
    // service le NOMME au lieu de laisser croire à un succès.
    expect(tardif.motif).toBe('analyse_close');
    expect(tardif.analyse?.etat).toBe('echouee');
    expect(lireBrut('a-1')).toMatchObject({
      etat: 'echouee',
      motif_echec: MOTIF_ANALYSE_INTERROMPUE,
      duree_secondes: null,
      technique: {},
    });
  });

  it('elle ne peut pas non plus la remettre `en_cours`', async () => {
    poser({ id: 'a-1', etat: 'en_cours', updated_at: ilYA(60) });
    await recupererAnalysesInterrompues('A', 'r-a', MAINTENANT);

    const tardif = await majAnalyse('A', 'a-1', { etat: 'en_cours', etape: 'visuel' });

    expect(tardif.motif).toBe('analyse_close');
    expect(lireBrut('a-1')).toMatchObject({ etat: 'echouee', etape: 'extraction' });
  });

  it('et elle n écrase pas la NOUVELLE version lancée entre-temps', async () => {
    poser({ id: 'a-1', etat: 'en_cours', updated_at: ilYA(60) });
    const nouvelle = await creerAnalyse('A', 'r-a');
    expect(nouvelle.analyse?.version).toBe(2);

    // Le retardataire écrit sur SON identifiant, pas sur celui de la nouvelle.
    await majAnalyse('A', 'a-1', { etat: 'reussie', dureeSecondes: 99 });

    expect(lireBrut(nouvelle.analyse!.id)).toMatchObject({
      etat: 'en_attente', duree_secondes: null,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Après récupération, la relance passe', () => {
  // (7)
  it('`creerAnalyse` ferme l abandonnée puis crée la version suivante', async () => {
    poser({ id: 'a-1', etat: 'en_cours', version: 1, updated_at: ilYA(60) });

    const r = await creerAnalyse('A', 'r-a');

    expect(r.motif).toBeNull();
    expect(r.analyse?.version).toBe(2);
    expect(r.analyse?.etat).toBe('en_attente');
    // L'ancienne est close, pas effacée.
    expect(lireBrut('a-1')).toMatchObject({
      etat: 'echouee', motif_echec: MOTIF_ANALYSE_INTERROMPUE, version: 1,
    });
  });

  it('les deux versions coexistent dans la liste', async () => {
    poser({ id: 'a-1', etat: 'en_attente', etape: null, version: 1, updated_at: ilYA(60) });
    await creerAnalyse('A', 'r-a');

    const { analyses } = await listerAnalyses('A', 'r-a');

    expect(analyses.map((a) => a.version)).toEqual([2, 1]);
    expect(analyses.map((a) => a.etat)).toEqual(['en_attente', 'echouee']);
  });

  it('mais une analyse RÉCENTE bloque toujours la relance', async () => {
    poser({ id: 'a-1', etat: 'en_cours', updated_at: ilYA(2) });

    const r = await creerAnalyse('A', 'r-a');

    expect(r.motif).toBe('analyse_active_existante');
    expect(r.analyse).toBeNull();
    expect(tables.rush_analyses).toHaveLength(1);
  });

  it('la relance d un rush d autrui ne récupère rien du tout', async () => {
    poser({ id: 'b-1', rush_id: 'r-b', user_id: 'B', etat: 'en_cours', updated_at: ilYA(60) });

    // `A` demande le rush de `B` : introuvable, et la récupération n'a même
    // pas lieu — elle est APRÈS `lireRush`, exprès.
    const r = await creerAnalyse('A', 'r-b');

    expect(r.motif).toBe('rush_introuvable');
    expect(lireBrut('b-1')).toMatchObject({ etat: 'en_cours', motif_echec: null });
    expect(majEffectuees).toHaveLength(0);
  });

  it('sans socle, la récupération le DIT au lieu de lever', async () => {
    tableAbsente = 'rush_analyses';

    const { recuperees, motif } = await recupererAnalysesInterrompues('A', 'r-a', MAINTENANT);

    expect(motif).toBe('socle_absent');
    expect(recuperees).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Rien n est jamais supprimé', () => {
  // (10)
  it('récupération, relance, retour tardif : aucun `delete`, aucune perte', async () => {
    poser({ id: 'a-0', etat: 'reussie', version: 1, updated_at: ilYA(600) });
    poser({ id: 'a-1', etat: 'en_cours', version: 2, updated_at: ilYA(60) });

    await creerAnalyse('A', 'r-a');
    await majAnalyse('A', 'a-1', { etat: 'reussie' });
    await recupererAnalysesInterrompues('A', 'r-a', MAINTENANT);

    expect(suppressions).toHaveLength(0);
    expect(tables.rush_analyses).toHaveLength(3);
    expect((tables.rush_analyses ?? []).map((l) => l.version)).toEqual([1, 2, 3]);
    // La trace de l'interruption survit à tout le reste.
    expect(lireBrut('a-1')).toMatchObject({
      etat: 'echouee', motif_echec: MOTIF_ANALYSE_INTERROMPUE,
    });
  });

  it('la récupération est une FERMETURE, pas un effacement du travail fait', async () => {
    poser({
      id: 'a-1', etat: 'en_cours', updated_at: ilYA(60),
      etape: 'extraction', duree_secondes: 42.5, technique: { largeur: 1080 },
      fournisseurs: { extraction: { fournisseur: 'local', modele: 'ffmpeg' } },
    });

    await recupererAnalysesInterrompues('A', 'r-a', MAINTENANT);

    // Seuls `etat`, `motif_echec` et `updated_at` bougent. Ce que la mesure
    // avait eu le temps de consigner reste lisible.
    expect(lireBrut('a-1')).toMatchObject({
      etat: 'echouee',
      motif_echec: MOTIF_ANALYSE_INTERROMPUE,
      etape: 'extraction',
      duree_secondes: 42.5,
      technique: { largeur: 1080 },
    });
  });
});
