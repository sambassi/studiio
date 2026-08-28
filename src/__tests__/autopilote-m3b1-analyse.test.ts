/**
 * M3-B1 — Socle de données des analyses de rush.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE LOT POSE, ET CE QU'IL NE POSE PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Il pose une table, un contrat et un service. Il ne pose AUCUNE route, aucun
 * bouton, aucun appel à un modèle, aucun ffmpeg, aucune URL de stockage. Ce
 * fichier le vérifie plutôt que de le supposer : le dernier bloc lit le code
 * source des deux modules et refuse d'y trouver la moindre trace d'un
 * fournisseur d'analyse.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI SE VÉRIFIE ICI, ET CE QUI SE VÉRIFIE SUR POSTGRES
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ici : le vocabulaire, le mapping, l'isolation par `user_id`, et la façon
 * dont le service TRADUIT un refus de la base en motif lisible.
 *
 * Sur un vrai PostgreSQL (`tests-pg/analyse-schema.pg.test.ts`) : que la base
 * refuse réellement. Une doublure qui « refuserait » un doublon ne prouverait
 * que sa propre programmation — c'est précisément la garantie qu'un faux
 * client ne peut pas porter.
 *
 * La doublure ci-dessous applique tout de même les deux index uniques, non
 * pour prouver qu'ils existent, mais pour que le chemin de traduction de
 * l'erreur soit réellement emprunté.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  STATUTS_ANALYSE, ETAPES_ANALYSE, FOURNISSEURS_ANALYSE,
  ETATS_ACTIFS, ETATS_TERMINAUX, CHAMPS_INTERDITS_ANALYSE,
  RESUME_MAX, MOTIF_ECHEC_MAX, COLONNES_ANALYSE,
  statutAnalyseValide, etapeAnalyseValide, fournisseurValide, analyseActive,
  objetJsonValide, tableauJsonValide, fournisseursValides, vignettesValides,
  analyseDepuisLigne,
} from '@/lib/autopilot/analyse/contrat';

interface Ligne { [k: string]: unknown }
let tables: Record<string, Ligne[]>;
let tableAbsente: string | null = null;
/** Panne de lecture sur le `select('version')` — et sur lui seul. */
let panneLectureVersion = false;
const insertions: Array<{ table: string; valeurs: Ligne }> = [];
const majEffectuees: Array<{ table: string; valeurs: Ligne }> = [];

const erreurTable = { code: '42P01', message: 'relation does not exist' };

/** Le refus que PostgreSQL rendrait, avec le nom de l'index fautif. */
function doublon(index: string) {
  return {
    code: '23505',
    message: `duplicate key value violates unique constraint "${index}"`,
  };
}

/**
 * Les deux index uniques de `rush_analyses`, appliqués.
 *
 * Rejoués ici pour que le service emprunte son chemin de traduction — pas
 * pour prouver que les index existent, ce qui est le travail du test
 * PostgreSQL.
 */
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

/**
 * Une base minuscule, en mémoire, avec le filtrage que fait PostgREST.
 *
 * Les `.eq()` et `.in()` sont RÉELLEMENT appliqués : c'est ce qui permet de
 * vérifier qu'une analyse d'autrui est introuvable, et non « trouvée puis
 * refusée par un `if` » — la nuance est tout l'intérêt du test.
 */
function requete(table: string) {
  const filtres: Array<[string, unknown]> = [];
  const filtresIn: Array<[string, unknown[]]> = [];
  let tri: { colonne: string; asc: boolean } | null = null;
  let limite: number | null = null;
  let aInserer: Ligne | null = null;
  let aMettreAJour: Ligne | null = null;
  let colonnesLues: string | null = null;

  const lignes = () => {
    if (tableAbsente === table) return null;
    let out = (tables[table] ?? []).filter(
      (l) => filtres.every(([c, v]) => l[c] === v)
        && filtresIn.every(([c, vs]) => vs.includes(l[c])),
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
    // Une panne qui n'est PAS « table absente » : connexion perdue, délai
    // dépassé. Le service ne doit pas la confondre avec « aucune analyse ».
    if (panneLectureVersion && colonnesLues === 'version') {
      return {
        data: null,
        error: { code: '57P01', message: 'terminating connection due to administrator command' },
      };
    }

    if (aInserer) {
      const valeurs: Ligne = { version: 1, etat: 'en_attente', ...aInserer };
      // La clé étrangère composite : une analyse ne peut pas désigner un rush
      // dont le propriétaire diffère du sien.
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
        created_at: '2026-09-01T10:00:00Z',
        updated_at: '2026-09-01T10:00:00Z',
        ...valeurs,
      };
      insertions.push({ table, valeurs: aInserer });
      tables[table] = [...(tables[table] ?? []), ligne];
      return { data: ligne, error: null };
    }

    if (aMettreAJour) {
      const cibles = lignes() ?? [];
      if (cibles.length === 0) return { data: null, error: null };
      majEffectuees.push({ table, valeurs: aMettreAJour });
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
    select: (cols?: string) => { colonnesLues = cols ?? null; return api; },
    eq: (c: string, v: unknown) => { filtres.push([c, v]); return api; },
    in: (c: string, vs: unknown[]) => { filtresIn.push([c, vs]); return api; },
    order: (c: string, o?: { ascending?: boolean }) => {
      tri = { colonne: c, asc: o?.ascending !== false }; return api;
    },
    limit: (n: number) => { limite = n; return api; },
    insert: (valeurs: Ligne) => { aInserer = valeurs; return api; },
    update: (valeurs: Ligne) => { aMettreAJour = valeurs; return api; },
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

const {
  creerAnalyse, lireAnalyse, listerAnalyses, majAnalyse,
} = await import('@/lib/autopilot/analyse/service');

const RUSH_DE_A = {
  id: 'r-a', shoot_session_id: 's-a', user_id: 'A', bucket: 'media',
  cle_objet: 'A/rush/plan.mp4', nom_origine: 'plan.mp4', content_type: 'video/mp4',
  taille_octets: 5_000_000, duree_secondes: null, rang: 0, etat: 'verifie',
  metadata: {}, created_at: '2026-08-31T10:00:00Z', updated_at: '2026-08-31T10:00:00Z',
};
const RUSH_DE_B = { ...RUSH_DE_A, id: 'r-b', shoot_session_id: 's-b', user_id: 'B', cle_objet: 'B/rush/plan.mp4' };

beforeEach(() => {
  insertions.length = 0;
  majEffectuees.length = 0;
  tableAbsente = null;
  panneLectureVersion = false;
  tables = {
    rushes: [{ ...RUSH_DE_A }, { ...RUSH_DE_B }],
    rush_analyses: [],
  };
});

// ───────────────────────────────────────────────────────────────────────────
describe('Le vocabulaire est fermé, et aligné sur les CHECK de la migration', () => {
  it('les cinq états, les trois étapes, les trois moteurs', () => {
    expect(STATUTS_ANALYSE).toEqual(['en_attente', 'en_cours', 'reussie', 'echouee', 'annulee']);
    expect(ETAPES_ANALYSE).toEqual(['extraction', 'visuel', 'transcription']);
    expect(FOURNISSEURS_ANALYSE).toEqual(['local', 'anthropic', 'replicate']);
  });

  it('actifs et terminaux partitionnent les états, sans recouvrement ni oubli', () => {
    expect([...ETATS_ACTIFS, ...ETATS_TERMINAUX].sort())
      .toEqual([...STATUTS_ANALYSE].sort());
    expect(ETATS_ACTIFS.some((e) => ETATS_TERMINAUX.includes(e))).toBe(false);
    // C'est la clause `where` de `rush_analyses_active_unique`. Les deux
    // doivent dire la même chose, sinon le verrou de la base et le message de
    // l'écran désignent des ensembles différents.
    const sql = readFileSync(
      join(process.cwd(), 'migrations/2026-09-01-rush-analyses.sql'), 'utf-8',
    );
    expect(sql).toContain("where etat in ('en_attente', 'en_cours')");
  });

  it('un état ou une étape inconnus sont refusés', () => {
    for (const e of STATUTS_ANALYSE) expect(statutAnalyseValide(e)).toBe(true);
    for (const e of ['terminee', 'pending', '', null, 42, {}]) {
      expect(statutAnalyseValide(e)).toBe(false);
    }
    for (const e of ETAPES_ANALYSE) expect(etapeAnalyseValide(e)).toBe(true);
    for (const e of ['montage', 'scoring', null, 7]) expect(etapeAnalyseValide(e)).toBe(false);
    expect(fournisseurValide('gemini')).toBe(false);
    expect(fournisseurValide('anthropic')).toBe(true);
  });

  it('`analyseActive` ne considère actifs que les deux premiers', () => {
    expect(analyseActive('en_attente')).toBe(true);
    expect(analyseActive('en_cours')).toBe(true);
    expect(analyseActive('reussie')).toBe(false);
    expect(analyseActive('echouee')).toBe(false);
    expect(analyseActive('annulee')).toBe(false);
  });

  it('les bornes reprennent celles de la migration', () => {
    const sql = readFileSync(
      join(process.cwd(), 'migrations/2026-09-01-rush-analyses.sql'), 'utf-8',
    );
    expect(sql).toContain(`length(resume) <= ${RESUME_MAX}`);
    expect(sql).toContain(`length(motif_echec) <= ${MOTIF_ECHEC_MAX}`);
  });

  it('les colonnes lues sont exactement celles de la table', () => {
    const sql = readFileSync(
      join(process.cwd(), 'migrations/2026-09-01-rush-analyses.sql'), 'utf-8',
    );
    for (const colonne of COLONNES_ANALYSE.split(', ')) {
      expect(sql, colonne).toMatch(new RegExp(`\\b${colonne}\\b`));
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('Les validations refusent au lieu de nettoyer en silence', () => {
  it('un objet JSON n est pas un tableau, et inversement', () => {
    expect(objetJsonValide({ a: 1 })).toEqual({ ok: true, valeur: { a: 1 } });
    expect(objetJsonValide(undefined)).toEqual({ ok: true, valeur: {} });
    expect(objetJsonValide([]).ok).toBe(false);
    expect(objetJsonValide('x').ok).toBe(false);
    expect(tableauJsonValide([1, 2])).toEqual({ ok: true, valeur: [1, 2] });
    expect(tableauJsonValide({}).ok).toBe(false);
  });

  it('une carte de fournisseurs valide est acceptée telle quelle', () => {
    const carte = {
      extraction: { fournisseur: 'local', modele: null },
      visuel: { fournisseur: 'anthropic', modele: 'claude-sonnet-4-20250514' },
    };
    expect(fournisseursValides(carte)).toEqual({ ok: true, valeur: carte });
  });

  it('une étape ou un moteur inconnus font échouer toute la carte', () => {
    expect(fournisseursValides({ montage: { fournisseur: 'local', modele: null } }).ok)
      .toBe(false);
    expect(fournisseursValides({ visuel: { fournisseur: 'gemini', modele: 'x' } }).ok)
      .toBe(false);
    expect(fournisseursValides({ visuel: { fournisseur: 'anthropic', modele: 7 } }).ok)
      .toBe(false);
    expect(fournisseursValides([]).ok).toBe(false);
  });

  it('une carte peut ne couvrir qu une étape — une analyse s arrête où elle s arrête', () => {
    const r = fournisseursValides({ extraction: { fournisseur: 'local' } });
    expect(r.ok).toBe(true);
    expect(r.valeur.extraction).toEqual({ fournisseur: 'local', modele: null });
    expect(r.valeur.visuel).toBeUndefined();
  });

  it('une vignette porte une clé, jamais une URL', () => {
    const bonnes = [{ bucket: 'media', cle: 'A/analyse/r-a/0.jpg', seconde: 0 }];
    expect(vignettesValides(bonnes)).toEqual({ ok: true, valeur: bonnes });

    for (const mauvaise of [
      [{ bucket: 'media', cle: 'https://exemple/v.jpg', seconde: 0 }],
      [{ bucket: 'media', cle: 's3://media/v.jpg', seconde: 0 }],
      [{ bucket: 'https://media', cle: 'A/v.jpg', seconde: 0 }],
      // `A/../B/x` satisfait un préfixe tout en désignant l'espace de B —
      // même garde que `verifierObjet`.
      [{ bucket: 'media', cle: 'A/../B/v.jpg', seconde: 0 }],
      [{ bucket: 'media', cle: '', seconde: 0 }],
      [{ bucket: 'media', cle: 'A/v.jpg', seconde: -1 }],
      [{ bucket: 'media', cle: 'A/v.jpg' }],
      'pas un tableau',
    ]) {
      expect(vignettesValides(mauvaise).ok, JSON.stringify(mauvaise)).toBe(false);
    }
  });

  it('le compartiment d une vignette passe par la liste blanche unique', async () => {
    // La même liste que les deux chemins d'envoi et que l'indexation des
    // rushes. Pas de seconde liste ici : deux listes blanches divergent le
    // jour où l'une accueille un compartiment et pas l'autre.
    const { ALLOWED_BUCKETS } = await import('@/lib/storage/buckets');
    for (const bucket of ALLOWED_BUCKETS) {
      expect(vignettesValides([{ bucket, cle: 'A/analyse/0.jpg', seconde: 0 }]).ok, bucket)
        .toBe(true);
    }
    for (const bucket of ['nimporte', 'rushes', '..', '', 'MEDIA', 'media ', null, 7]) {
      expect(vignettesValides([{ bucket, cle: 'A/analyse/0.jpg', seconde: 0 }]).ok,
        String(bucket)).toBe(false);
    }
  });

  it('les cinq refus attendus sur une vignette', () => {
    expect(vignettesValides([{ bucket: 'media', cle: 'A/analyse/0.jpg', seconde: 0 }]).ok)
      .toBe(true);
    expect(vignettesValides([{ bucket: 'inconnu', cle: 'A/0.jpg', seconde: 0 }]).ok).toBe(false);
    expect(vignettesValides([{ bucket: '..', cle: 'A/0.jpg', seconde: 0 }]).ok).toBe(false);
    expect(vignettesValides([{ bucket: 'media', cle: 'A/../B/0.jpg', seconde: 0 }]).ok).toBe(false);
    expect(vignettesValides([{ bucket: 'media', cle: 'https://x/0.jpg', seconde: 0 }]).ok)
      .toBe(false);
  });

  it('la liste des champs interdits couvre les DEUX orthographes', () => {
    // Un client ne doit pas pouvoir passer par l'orthographe que la liste a
    // oubliée.
    for (const [snake, camel] of [
      ['user_id', 'userId'], ['rush_id', 'rushId'],
      ['duree_secondes', 'dureeSecondes'], ['motif_echec', 'motifEchec'],
      ['textes_visibles', 'textesVisibles'],
      ['created_at', 'createdAt'], ['updated_at', 'updatedAt'],
    ]) {
      expect(CHAMPS_INTERDITS_ANALYSE, snake).toContain(snake);
      expect(CHAMPS_INTERDITS_ANALYSE, camel).toContain(camel);
    }
    // Et tout ce que la base décide est protégé.
    for (const c of ['id', 'version', 'etat', 'etape', 'fournisseurs', 'usage']) {
      expect(CHAMPS_INTERDITS_ANALYSE, c).toContain(c);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('Le mapping base → domaine', () => {
  const LIGNE = {
    id: 'a-1', rush_id: 'r-a', user_id: 'A', version: 2,
    etat: 'reussie', etape: 'visuel',
    fournisseurs: { visuel: { fournisseur: 'anthropic', modele: 'm' } },
    duree_secondes: '12.500',
    technique: { largeur: 1080 },
    resume: 'Un cours de danse',
    textes_visibles: ['AFROBOOST'],
    parole: { presente: true },
    audio: { niveau: -18 },
    qualite: { net: true },
    vignettes: [{ bucket: 'media', cle: 'A/analyse/0.jpg', seconde: 0 }],
    usage: { jetons: 1200 },
    motif_echec: null,
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:05:00Z',
  };

  it('traduit chaque colonne, et convertit le numeric rendu en chaîne', () => {
    const a = analyseDepuisLigne(LIGNE);
    expect(a).toEqual({
      id: 'a-1', rushId: 'r-a', userId: 'A', version: 2,
      etat: 'reussie', etape: 'visuel',
      fournisseurs: { visuel: { fournisseur: 'anthropic', modele: 'm' } },
      dureeSecondes: 12.5,
      technique: { largeur: 1080 },
      resume: 'Un cours de danse',
      textesVisibles: ['AFROBOOST'],
      parole: { presente: true },
      audio: { niveau: -18 },
      qualite: { net: true },
      vignettes: [{ bucket: 'media', cle: 'A/analyse/0.jpg', seconde: 0 }],
      usage: { jetons: 1200 },
      motifEchec: null,
      createdAt: '2026-09-01T10:00:00Z',
      updatedAt: '2026-09-01T10:05:00Z',
    });
  });

  it('une durée absente reste `null`, jamais `0`', () => {
    // Un zéro se lirait comme « vidéo vide », et c'est le genre de zéro qu'on
    // finit par afficher.
    expect(analyseDepuisLigne({ ...LIGNE, duree_secondes: null }).dureeSecondes).toBeNull();
    expect(analyseDepuisLigne({ ...LIGNE, duree_secondes: 'x' }).dureeSecondes).toBeNull();
  });

  it('un état illisible devient `echouee`, et non `en_attente`', () => {
    // Traduire l'inconnu en « en attente » annoncerait un travail qui n'aura
    // pas lieu.
    expect(analyseDepuisLigne({ ...LIGNE, etat: 'zombie' }).etat).toBe('echouee');
    expect(analyseDepuisLigne({ ...LIGNE, etape: 'montage' }).etape).toBeNull();
  });

  it('une forme JSON aberrante ne fait pas tomber la lecture', () => {
    const a = analyseDepuisLigne({
      ...LIGNE, technique: [1], parole: null, textes_visibles: {}, vignettes: 'x',
      fournisseurs: { montage: {} },
    });
    expect(a.technique).toEqual({});
    expect(a.parole).toEqual({});
    expect(a.textesVisibles).toEqual([]);
    expect(a.vignettes).toEqual([]);
    expect(a.fournisseurs).toEqual({});
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('Créer une analyse', () => {
  it('la première naît `en_attente`, en version 1, sans étape', async () => {
    const { analyse, motif } = await creerAnalyse('A', 'r-a');
    expect(motif).toBeNull();
    expect(analyse?.etat).toBe('en_attente');
    expect(analyse?.version).toBe(1);
    expect(analyse?.etape).toBeNull();
    expect(analyse?.userId).toBe('A');
    expect(analyse?.rushId).toBe('r-a');
  });

  it('l état n est jamais reçu : le service l impose', async () => {
    await creerAnalyse('A', 'r-a');
    expect(insertions).toHaveLength(1);
    expect(insertions[0].valeurs.etat).toBe('en_attente');
    expect(insertions[0].valeurs.etape).toBeNull();
    // Rien d'interprété n'est inséré : une analyse qui naîtrait avec un
    // résumé serait un résultat inventé.
    for (const champ of ['resume', 'technique', 'vignettes', 'usage', 'duree_secondes']) {
      expect(insertions[0].valeurs, champ).not.toHaveProperty(champ);
    }
  });

  it('une seconde analyse pendant qu une tourne est refusée', async () => {
    await creerAnalyse('A', 'r-a');
    const { analyse, motif } = await creerAnalyse('A', 'r-a');
    expect(analyse).toBeNull();
    expect(motif).toBe('analyse_active_existante');
    expect(tables.rush_analyses).toHaveLength(1);
  });

  it('une fois la précédente close, la suivante prend la version 2', async () => {
    const premiere = await creerAnalyse('A', 'r-a');
    await majAnalyse('A', premiere.analyse!.id, { etat: 'reussie' });
    const { analyse, motif } = await creerAnalyse('A', 'r-a');
    expect(motif).toBeNull();
    expect(analyse?.version).toBe(2);
    expect(tables.rush_analyses).toHaveLength(2);
  });

  it('le rush d un autre utilisateur est INTROUVABLE, pas interdit', async () => {
    // Un « interdit » confirmerait l'existence de la ressource.
    const { analyse, motif } = await creerAnalyse('A', 'r-b');
    expect(analyse).toBeNull();
    expect(motif).toBe('rush_introuvable');
    expect(insertions).toHaveLength(0);
  });

  it('un rush inexistant est introuvable aussi', async () => {
    const { motif } = await creerAnalyse('A', 'r-inconnu');
    expect(motif).toBe('rush_introuvable');
  });

  it('sans la migration, le motif nomme le socle absent', async () => {
    tableAbsente = 'rush_analyses';
    const { analyse, motif } = await creerAnalyse('A', 'r-a');
    expect(analyse).toBeNull();
    expect(motif).toBe('socle_absent');
  });

  it('sans le socle du tournage non plus, rien n est inventé', async () => {
    tableAbsente = 'rushes';
    const { motif } = await creerAnalyse('A', 'r-a');
    expect(motif).toBe('socle_absent');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('Lire et lister — l isolation tient dans la requête', () => {
  it('une analyse d autrui ne revient pas', async () => {
    const { analyse } = await creerAnalyse('B', 'r-b');
    const vue = await lireAnalyse('A', analyse!.id);
    expect(vue.analyse).toBeNull();
    expect(vue.motif).toBe('analyse_introuvable');
  });

  it('son propriétaire la lit', async () => {
    const { analyse } = await creerAnalyse('B', 'r-b');
    const vue = await lireAnalyse('B', analyse!.id);
    expect(vue.analyse?.id).toBe(analyse!.id);
    expect(vue.motif).toBeNull();
  });

  it('lister les analyses du rush d autrui rend `rush_introuvable`, pas une liste vide', async () => {
    // Une liste vide serait indiscernable d'un rush jamais analysé.
    await creerAnalyse('B', 'r-b');
    const { analyses, motif } = await listerAnalyses('A', 'r-b');
    expect(analyses).toEqual([]);
    expect(motif).toBe('rush_introuvable');
  });

  it('les siennes reviennent, la plus récente d abord', async () => {
    const p = await creerAnalyse('A', 'r-a');
    await majAnalyse('A', p.analyse!.id, { etat: 'reussie' });
    await creerAnalyse('A', 'r-a');
    const { analyses, motif } = await listerAnalyses('A', 'r-a');
    expect(motif).toBeNull();
    expect(analyses.map((a) => a.version)).toEqual([2, 1]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('Mettre à jour — une analyse close ne se rouvre pas', () => {
  it('un traitement écrit son avancement sur une analyse ouverte', async () => {
    const { analyse } = await creerAnalyse('A', 'r-a');
    const maj = await majAnalyse('A', analyse!.id, {
      etat: 'en_cours', etape: 'extraction',
      fournisseurs: { extraction: { fournisseur: 'local', modele: null } },
      dureeSecondes: 42.5, technique: { largeur: 1080 },
    });
    expect(maj.motif).toBeNull();
    expect(maj.analyse?.etat).toBe('en_cours');
    expect(maj.analyse?.etape).toBe('extraction');
    expect(maj.analyse?.dureeSecondes).toBe(42.5);
  });

  it('une analyse `reussie` ne se remet pas `en_cours`', async () => {
    const { analyse } = await creerAnalyse('A', 'r-a');
    await majAnalyse('A', analyse!.id, { etat: 'reussie', resume: 'ok' });
    const tardive = await majAnalyse('A', analyse!.id, { etat: 'en_cours', resume: 'ecrase' });
    expect(tardive.motif).toBe('analyse_close');
    expect(tardive.analyse?.etat).toBe('reussie');
    expect(tardive.analyse?.resume).toBe('ok');
  });

  it('l analyse d autrui n est pas modifiable, et se dit introuvable', async () => {
    const { analyse } = await creerAnalyse('B', 'r-b');
    const tentative = await majAnalyse('A', analyse!.id, { etat: 'annulee' });
    expect(tentative.motif).toBe('analyse_introuvable');
    const inchangee = await lireAnalyse('B', analyse!.id);
    expect(inchangee.analyse?.etat).toBe('en_attente');
  });

  it('l identité de la ligne n est jamais réécrite', async () => {
    const { analyse } = await creerAnalyse('A', 'r-a');
    await majAnalyse('A', analyse!.id, { etat: 'en_cours' });
    expect(majEffectuees).toHaveLength(1);
    for (const champ of ['id', 'rush_id', 'user_id', 'version']) {
      expect(majEffectuees[0].valeurs, champ).not.toHaveProperty(champ);
    }
    // `updated_at` est posé ici parce que la table n'a pas de déclencheur.
    expect(majEffectuees[0].valeurs).toHaveProperty('updated_at');
  });

  it('un champ non fourni n est pas écrasé par `undefined`', async () => {
    const { analyse } = await creerAnalyse('A', 'r-a');
    await majAnalyse('A', analyse!.id, { etat: 'en_cours' });
    expect(majEffectuees[0].valeurs).not.toHaveProperty('resume');
    expect(majEffectuees[0].valeurs).not.toHaveProperty('vignettes');
  });

  it('sans la migration, la mise à jour nomme le socle absent', async () => {
    const { analyse } = await creerAnalyse('A', 'r-a');
    tableAbsente = 'rush_analyses';
    const maj = await majAnalyse('A', analyse!.id, { etat: 'en_cours' });
    expect(maj.motif).toBe('socle_absent');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('Rien d invalide n atteint la base — la validation est AVANT l ecriture', () => {
  const invalides: Array<[string, Record<string, unknown>]> = [
    ['etat', { etat: 'terminee' }],
    ['etape', { etape: 'montage' }],
    ['fournisseurs', { fournisseurs: { montage: { fournisseur: 'local' } } }],
    ['fournisseurs', { fournisseurs: { visuel: { fournisseur: 'gemini' } } }],
    ['fournisseurs', { fournisseurs: { visuel: { fournisseur: 'anthropic', modele: 7 } } }],
    ['fournisseurs', { fournisseurs: [] }],
    ['dureeSecondes', { dureeSecondes: -1 }],
    ['dureeSecondes', { dureeSecondes: Number.NaN }],
    ['dureeSecondes', { dureeSecondes: 'douze' }],
    ['technique', { technique: [] }],
    ['technique', { technique: null }],
    ['resume', { resume: 7 }],
    ['resume', { resume: 'x'.repeat(RESUME_MAX + 1) }],
    ['textesVisibles', { textesVisibles: {} }],
    ['parole', { parole: [] }],
    ['audio', { audio: 'x' }],
    ['qualite', { qualite: null }],
    ['vignettes', { vignettes: [{ bucket: 'inconnu', cle: 'a/0.jpg', seconde: 0 }] }],
    ['vignettes', { vignettes: [{ bucket: 'media', cle: 'https://x/0.jpg', seconde: 0 }] }],
    ['vignettes', { vignettes: [{ bucket: '..', cle: 'a/0.jpg', seconde: 0 }] }],
    ['usage', { usage: [] }],
    ['motifEchec', { motifEchec: 'x'.repeat(MOTIF_ECHEC_MAX + 1) }],
  ];

  it.each(invalides)('refuse %s AVANT tout appel a la base', async (champ, patch) => {
    const { analyse } = await creerAnalyse('A', 'r-a');
    majEffectuees.length = 0;
    const r = await majAnalyse('A', analyse!.id, patch as never);
    expect(r.motif).toBe('donnees_invalides');
    expect(r.champ).toBe(champ);
    expect(r.analyse).toBeNull();
    // La preuve qui compte : aucune écriture n'a été tentée.
    expect(majEffectuees).toHaveLength(0);
  });

  it('rien n est nettoye en silence — le refus NOMME le champ', async () => {
    const { analyse } = await creerAnalyse('A', 'r-a');
    const r = await majAnalyse('A', analyse!.id, {
      fournisseurs: { montage: { fournisseur: 'local', modele: null } } as never,
    });
    expect(r.champ).toBe('fournisseurs');
    // Et la ligne n'a pas bougé : ni `{}` écrit à la place, ni état modifié.
    const relue = await lireAnalyse('A', analyse!.id);
    expect(relue.analyse?.fournisseurs).toEqual({});
    expect(relue.analyse?.etat).toBe('en_attente');
  });

  it('ce qui est ecrit est la valeur NORMALISEE du validateur', async () => {
    const { analyse } = await creerAnalyse('A', 'r-a');
    await majAnalyse('A', analyse!.id, {
      // `modele` absent : le validateur le normalise en `null`.
      fournisseurs: { extraction: { fournisseur: 'local' } } as never,
    });
    expect(majEffectuees[0].valeurs.fournisseurs)
      .toEqual({ extraction: { fournisseur: 'local', modele: null } });
  });

  it('une valeur valide passe toujours', async () => {
    const { analyse } = await creerAnalyse('A', 'r-a');
    const r = await majAnalyse('A', analyse!.id, {
      etat: 'en_cours', etape: 'extraction', dureeSecondes: 42.5,
      technique: { largeur: 1080 }, resume: null, textesVisibles: [],
      vignettes: [{ bucket: 'media', cle: 'A/analyse/0.jpg', seconde: 0 }],
      usage: { jetons: 0 }, motifEchec: null,
    });
    expect(r.motif).toBeNull();
    expect(r.analyse?.etat).toBe('en_cours');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('Une panne de lecture n est pas « une analyse tourne deja »', () => {
  it('elle remonte comme erreur, et AUCUN insert n est tente', async () => {
    // Retomber à la version 1 ferait échouer l'insertion sur l'index unique,
    // et ce refus serait traduit en `analyse_active_existante` — un
    // diagnostic faux qui enverrait chercher un verrou là où il y a une base
    // injoignable.
    panneLectureVersion = true;
    await expect(creerAnalyse('A', 'r-a')).rejects.toThrow(/terminating connection/i);
    expect(insertions).toHaveLength(0);
    expect(tables.rush_analyses).toHaveLength(0);
  });

  it('mais « table absente » reste un socle absent, pas une panne', async () => {
    tableAbsente = 'rush_analyses';
    const { motif } = await creerAnalyse('A', 'r-a');
    expect(motif).toBe('socle_absent');
    expect(insertions).toHaveLength(0);
  });

  it('et « aucune analyse existante » donne bien la version 1', async () => {
    const { analyse, motif } = await creerAnalyse('A', 'r-a');
    expect(motif).toBeNull();
    expect(analyse?.version).toBe(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('Ce que M3-B1 ne fait pas — vérifié, pas supposé', () => {
  const source = (chemin: string) => readFileSync(join(process.cwd(), chemin), 'utf-8');
  const MODULES = [
    'src/lib/autopilot/analyse/contrat.ts',
    'src/lib/autopilot/analyse/service.ts',
  ];

  /**
   * Le code, sans ses commentaires.
   *
   * Chercher « anthropic » dans le fichier brut trouverait la constante
   * `FOURNISSEURS_ANALYSE` — qui doit précisément nommer les moteurs, c'est
   * son travail. Ce qui doit être absent, ce n'est pas le NOM d'un
   * fournisseur, c'est tout moyen de lui parler.
   */
  const sansCommentaires = (code: string) => code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  /** Ce que chaque module a le droit d'importer, exhaustivement. */
  const IMPORTS_AUTORISES: Record<string, string[]> = {
    // `buckets.ts` est une LISTE DE NOMS, pas un accès au stockage : aucun
    // client, aucune requête, aucune variable d'environnement. L'importer est
    // ce qui évite une seconde liste blanche qui divergerait de la première.
    'src/lib/autopilot/analyse/contrat.ts': ['@/lib/storage/buckets'],
    'src/lib/autopilot/analyse/service.ts': [
      '@/lib/db/supabase', '@/lib/autopilot/tournage/service', './contrat',
    ],
  };

  it('aucun module ne peut PARLER à un fournisseur ni au stockage', () => {
    for (const chemin of MODULES) {
      const code = sansCommentaires(source(chemin));
      // Pas d'appel réseau, pas de clé, pas d'URL — d'où qu'elle vienne.
      expect(code, `${chemin} : fetch`).not.toMatch(/\bfetch\s*\(/);
      expect(code, `${chemin} : process.env`).not.toMatch(/process\.env/);
      expect(code, `${chemin} : URL en dur`).not.toMatch(/https?:\/\//);
      // Pas de processus externe : ni ffmpeg, ni ffprobe, ni rien d'autre.
      expect(code, `${chemin} : processus`).not.toMatch(/execFile|spawn\s*\(|exec\s*\(/);
    }
  });

  it('les imports sont exactement ceux annoncés — rien d autre n entre', () => {
    // Une liste blanche d'imports est ce qui rend la garantie durable : elle
    // échoue le jour où quelqu'un ajoute `minio`, `replicate` ou
    // `@/lib/storage/...`, sans qu'il faille avoir prévu le nom du paquet.
    for (const chemin of MODULES) {
      const code = sansCommentaires(source(chemin));
      const importes = [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
      expect([...new Set(importes)].sort(), chemin)
        .toEqual([...IMPORTS_AUTORISES[chemin]].sort());
    }
  });

  it('aucune route HTTP n est créée par ce lot', async () => {
    const { existsSync } = await import('fs');
    for (const chemin of [
      'src/app/api/autopilot/rushes',
      'src/app/api/autopilot/analyses',
      'src/app/api/analyse',
    ]) {
      expect(existsSync(join(process.cwd(), chemin)), chemin).toBe(false);
    }
  });

  it('ni crédit, ni rendu, ni publication n est touché', () => {
    for (const chemin of MODULES) {
      const code = source(chemin);
      for (const interdit of ['debiter_credits', 'credit_transactions', 'rendus', 'scheduled_posts']) {
        expect(code, `${chemin} / ${interdit}`).not.toContain(interdit);
      }
    }
  });

  it('le service ne parle qu à `rush_analyses` et au rush par le service du tournage', () => {
    const code = source('src/lib/autopilot/analyse/service.ts');
    const tablesCitees = [...code.matchAll(/\.from\('([a-z_]+)'\)/g)].map((m) => m[1]);
    expect([...new Set(tablesCitees)]).toEqual(['rush_analyses']);
    // Le rush est lu par `lireRush`, dans le vocabulaire du tournage : deux
    // lecteurs d'un même concept divergeraient au troisième changement.
    expect(code).toContain("from '@/lib/autopilot/tournage/service'");
  });
});
