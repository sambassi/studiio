/**
 * M3-B3 — LIRE une analyse, et voir ses vignettes sans les rendre publiques.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI EST VÉRIFIÉ ICI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les VRAIS gestionnaires sont appelés — `GET /api/autopilot/rushes/[id]/analyse`
 * et `GET /api/autopilot/analyses/[id]/vignettes/[n]`. Ce qui compte n'est
 * pas qu'ils existent, c'est ce qu'ils répondent : à qui, avec quoi, et
 * surtout quel objet du stockage ils acceptent d'ouvrir.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * L'INVARIANT QUE CE FICHIER EXISTE POUR PROUVER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * AUCUNE clé venue du navigateur ne donne jamais accès à un objet. La preuve
 * n'est pas « une clé malformée est refusée » — c'est qu'il n'existe AUCUN
 * paramètre par lequel une clé puisse entrer. La route ne prend qu'un
 * identifiant d'analyse et un ENTIER ; le journal du lecteur MinIO montre
 * qu'il ne reçoit jamais que la clé LUE en base, à la position demandée.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI N'EST PAS VÉRIFIÉ ICI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * MinIO. Le lecteur est une doublure : ce fichier teste QUEL objet lui est
 * demandé et ce que la route fait de ses réponses, jamais le stockage.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  vignetteLisible, indexVignetteValide, TYPE_VIGNETTE,
} from '@/lib/autopilot/analyse/vignettes';

const authMock = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));

/**
 * Le moteur réel est neutralisé — ce fichier ne lance AUCUNE mesure.
 *
 * `moteur.ts` importe statiquement `./extraction`, qui tire ffmpeg et MinIO.
 * Rien de tout cela n'a sa place dans un test de LECTURE. Seul le vocabulaire
 * des motifs est conservé : `moteur.ts` en dépend au chargement.
 */
vi.mock('@/lib/autopilot/analyse/extraction', async (importOriginal) => {
  // ⚠️ TOUT le module est rendu, SAUF la fonction de mesure : c'est elle
  // seule qu'on neutralise. Depuis M3-D1, `analyse/audio.ts` importe d'ici
  // les bornes réseau et le lancement de processus ; ne rendre que les motifs
  // ferait échouer le CHARGEMENT de la route au lieu de neutraliser le
  // moteur. Rien n'est exécuté pour autant : ce fichier ne lance aucune
  // mesure.
  const reel = await importOriginal<Record<string, unknown>>();
  return { ...reel, extraireRush: undefined, extraire: undefined, default: undefined };
});

// ───────────────────────────────────────────────────────────────────────────
// Le lecteur MinIO, en doublure — et le journal de TOUT ce qu'on lui demande.
// ───────────────────────────────────────────────────────────────────────────
interface AppelLecture { bucket: string; cle: string; borne: unknown }
let appelsLecture: AppelLecture[] = [];
/** Le stockage refuse d'ouvrir : objet absent, panne, délai. */
let lectureEchoue = false;
const OCTETS_VIGNETTE = 'JPEG-FICTIF';

vi.mock('@/lib/storage/minio-client', async () => {
  const { Readable } = await import('node:stream');
  return {
    lecteurMinio: (borne: unknown) => ({
      getObject: async (bucket: string, cle: string) => {
        appelsLecture.push({ bucket, cle, borne });
        if (lectureEchoue) throw new Error('NoSuchKey');
        return Readable.from([Buffer.from(OCTETS_VIGNETTE)]);
      },
    }),
    signeurPublic: () => null,
    signeurInterne: () => null,
    // `verifier-objet` l'importe ; aucun test de ce fichier ne l'atteint.
    clientMinio: () => ({
      statObject: async () => { throw new Error('non sollicité'); },
      putObject: async () => { throw new Error('non sollicité'); },
    }),
  };
});

// ───────────────────────────────────────────────────────────────────────────
// Une base minuscule, en mémoire, avec le filtrage que fait PostgREST.
//
// Reprise de `autopilote-m3b2-route.test.ts`. `.lt()` EN FAIT PARTIE : sans
// lui, la récupération d'analyses de M3-B2.1 lèverait et tout répondrait 500.
// ───────────────────────────────────────────────────────────────────────────
interface Ligne { [k: string]: unknown }
let tables: Record<string, Ligne[]>;
let tableAbsente: string | null = null;
/** Toute écriture tentée — un GET ne doit en produire AUCUNE. */
const ecritures: Array<{ table: string; type: 'insert' | 'update'; valeurs: Ligne }> = [];
/** Toute lecture, avec ses filtres — pour compter le coût d'un sondage. */
const lectures: Array<{ table: string; filtres: Array<[string, unknown]>; limite: number | null }> = [];

const erreurTable = { code: '42P01', message: 'relation does not exist' };

/**
 * `<` sur un `timestamptz`.
 *
 * La comparaison porte sur des DATES, pas sur des chaînes : une doublure qui
 * ignorerait `.lt()` laisserait passer la fermeture d'analyses VIVANTES sans
 * qu'aucun test ne s'en aperçoive.
 */
function anterieurA(valeur: unknown, borne: unknown): boolean {
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
        && filtresLt.every(([c, v]) => anterieurA(l[c], v)),
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
      ecritures.push({ table, type: 'insert', valeurs: aInserer });
      const ligne: Ligne = {
        id: `${table}-${(tables[table] ?? []).length + 1}`,
        ...aInserer,
      };
      tables[table] = [...(tables[table] ?? []), ligne];
      return { data: ligne, error: null };
    }

    if (aMettreAJour) {
      const cibles = lignes() ?? [];
      if (cibles.length === 0) return { data: null, error: null };
      ecritures.push({ table, type: 'update', valeurs: aMettreAJour });
      const patch = aMettreAJour;
      tables[table] = (tables[table] ?? []).map(
        (l) => (cibles.includes(l) ? { ...l, ...patch } : l),
      );
      const misAJour = (tables[table] ?? []).find((l) => l.id === cibles[0].id) ?? null;
      return { data: misAJour, error: null };
    }

    lectures.push({ table, filtres: [...filtres], limite });
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
    maybeSingle: async () => executer(),
    then: (resoudre: (v: unknown) => unknown) => {
      lectures.push({ table, filtres: [...filtres], limite });
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

const { GET: LIRE_ANALYSE } = await import(
  '@/app/api/autopilot/rushes/[id]/analyse/route'
);
const { GET: LIRE_VIGNETTE } = await import(
  '@/app/api/autopilot/analyses/[id]/vignettes/[n]/route'
);

// ───────────────────────────────────────────────────────────────────────────
const RUSH_DE_A: Ligne = {
  id: 'r-a', shoot_session_id: 's-a', user_id: 'A', bucket: 'media',
  cle_objet: 'A/rush/plan.mp4', nom_origine: 'plan.mp4', content_type: 'video/mp4',
  taille_octets: 5_000_000, duree_secondes: null, rang: 0, etat: 'verifie',
  metadata: {}, created_at: '2026-08-31T10:00:00Z', updated_at: '2026-08-31T10:00:00Z',
};
/** Un SECOND rush du MÊME utilisateur. */
const AUTRE_RUSH_DE_A: Ligne = {
  ...RUSH_DE_A, id: 'r-a2', cle_objet: 'A/rush/plan2.mp4',
};
const RUSH_DE_B: Ligne = {
  ...RUSH_DE_A, id: 'r-b', shoot_session_id: 's-b', user_id: 'B',
  cle_objet: 'B/rush/plan.mp4',
};

const maintenantIso = () => new Date().toISOString();

/** Une ligne d'analyse complète, telle que la base la rendrait. */
function analyseLigne(patch: Ligne = {}): Ligne {
  return {
    id: 'an-1', rush_id: 'r-a', user_id: 'A', version: 1,
    etat: 'reussie', etape: 'extraction',
    fournisseurs: { extraction: { fournisseur: 'local', modele: 'ffmpeg' } },
    duree_secondes: 42.5,
    technique: { largeur: 1080, hauteur: 1920, fps: 30, audio: true },
    resume: null,
    textes_visibles: [],
    parole: {},
    audio: {},
    qualite: {},
    vignettes: [
      { bucket: 'media', cle: 'A/analyse/an-1/vignette-01.jpg', seconde: 0 },
      { bucket: 'media', cle: 'A/analyse/an-1/vignette-02.jpg', seconde: 21 },
    ],
    usage: {},
    motif_echec: null,
    created_at: maintenantIso(),
    updated_at: maintenantIso(),
    ...patch,
  };
}

function lireAnalyseHttp(rushId: string) {
  const req = new Request(`http://x/api/autopilot/rushes/${rushId}/analyse`);
  return LIRE_ANALYSE(req as never, { params: { id: rushId } });
}

function lireVignetteHttp(analyseId: string, n: string, requete_ = '') {
  const req = new Request(
    `http://x/api/autopilot/analyses/${analyseId}/vignettes/${n}${requete_}`,
  );
  return LIRE_VIGNETTE(req as never, { params: { id: analyseId, n } });
}

beforeEach(() => {
  ecritures.length = 0;
  lectures.length = 0;
  appelsLecture = [];
  tableAbsente = null;
  lectureEchoue = false;
  authMock.mockResolvedValue({ user: { id: 'A' } });
  tables = {
    rushes: [{ ...RUSH_DE_A }, { ...AUTRE_RUSH_DE_A }, { ...RUSH_DE_B }],
    rush_analyses: [],
  };
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. QUI A LE DROIT DE LIRE
// ═══════════════════════════════════════════════════════════════════════════
describe('L identité vient de la session, jamais de la requête', () => {
  it('sans session, 401 sur les deux routes — et aucun objet ouvert', async () => {
    authMock.mockResolvedValue(null);
    tables.rush_analyses = [analyseLigne()];
    expect((await lireAnalyseHttp('r-a')).status).toBe(401);
    expect((await lireVignetteHttp('an-1', '0')).status).toBe(401);
    expect(appelsLecture).toEqual([]);
  });

  it('une session sans `id` vaut absence de session', async () => {
    authMock.mockResolvedValue({ user: { email: 'a@x' } });
    tables.rush_analyses = [analyseLigne()];
    expect((await lireAnalyseHttp('r-a')).status).toBe(401);
    expect((await lireVignetteHttp('an-1', '0')).status).toBe(401);
    expect(appelsLecture).toEqual([]);
  });

  it('un rush inexistant rend 404', async () => {
    expect((await lireAnalyseHttp('r-inconnu')).status).toBe(404);
  });

  it('le rush d autrui rend 404, JAMAIS 403', async () => {
    tables.rush_analyses = [analyseLigne({ id: 'an-b', rush_id: 'r-b', user_id: 'B' })];
    const r = await lireAnalyseHttp('r-b');
    expect(r.status).toBe(404);
    expect(r.status).not.toBe(403);
  });

  it('un rush d autrui et un rush inexistant sont INDISCERNABLES', async () => {
    tables.rush_analyses = [analyseLigne({ id: 'an-b', rush_id: 'r-b', user_id: 'B' })];
    const autrui = await lireAnalyseHttp('r-b');
    const nulle = await lireAnalyseHttp('r-inconnu');
    expect(autrui.status).toBe(nulle.status);
    expect(await autrui.json()).toEqual(await nulle.json());
  });

  it('l analyse d autrui rend 404 et n ouvre AUCUN objet', async () => {
    tables.rush_analyses = [analyseLigne({
      id: 'an-b', rush_id: 'r-b', user_id: 'B',
      vignettes: [{ bucket: 'media', cle: 'B/analyse/an-b/vignette-01.jpg', seconde: 0 }],
    })];
    const r = await lireVignetteHttp('an-b', '0');
    expect(r.status).toBe(404);
    expect(r.status).not.toBe(403);
    expect(appelsLecture).toEqual([]);
  });

  it('l analyse d autrui et une analyse inexistante sont INDISCERNABLES', async () => {
    tables.rush_analyses = [analyseLigne({ id: 'an-b', rush_id: 'r-b', user_id: 'B' })];
    const autrui = await lireVignetteHttp('an-b', '0');
    const nulle = await lireVignetteHttp('an-fantome', '0');
    expect(autrui.status).toBe(nulle.status);
    expect(await autrui.json()).toEqual(await nulle.json());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. CE QUE LE GET D ÉTAT REND
// ═══════════════════════════════════════════════════════════════════════════
describe('GET /analyse rend la plus récente, ou rien', () => {
  it('aucune analyse : 200 et `analyse: null` — pas un 404', async () => {
    const r = await lireAnalyseHttp('r-a');
    expect(r.status).toBe(200);
    const corps = await r.json();
    expect(corps.ok).toBe(true);
    expect(corps.analyse).toBeNull();
  });

  it('une analyse ACTIVE est rendue telle quelle', async () => {
    tables.rush_analyses = [analyseLigne({
      etat: 'en_cours', etape: 'extraction',
      duree_secondes: null, technique: {}, vignettes: [],
    })];
    const corps = await (await lireAnalyseHttp('r-a')).json();
    expect(corps.analyse.etat).toBe('en_cours');
    expect(corps.analyse.etape).toBe('extraction');
    expect(corps.analyse.dureeSecondes).toBeNull();
    expect(corps.analyse.vignettes).toEqual({ nombre: 0, secondes: [] });
  });

  it('une analyse RÉUSSIE rend sa mesure et ses vignettes en nombre', async () => {
    tables.rush_analyses = [analyseLigne()];
    const corps = await (await lireAnalyseHttp('r-a')).json();
    expect(corps.analyse.id).toBe('an-1');
    expect(corps.analyse.etat).toBe('reussie');
    expect(corps.analyse.dureeSecondes).toBe(42.5);
    expect(corps.analyse.technique).toEqual({
      largeur: 1080, hauteur: 1920, fps: 30, audio: true,
    });
    expect(corps.analyse.fournisseurs).toEqual({
      extraction: { fournisseur: 'local', modele: 'ffmpeg' },
    });
    expect(corps.analyse.vignettes).toEqual({ nombre: 2, secondes: [0, 21] });
  });

  it('un échec rend son motif', async () => {
    tables.rush_analyses = [analyseLigne({
      etat: 'echouee', motif_echec: 'format_illisible',
      duree_secondes: null, technique: {}, vignettes: [],
    })];
    const corps = await (await lireAnalyseHttp('r-a')).json();
    expect(corps.analyse.etat).toBe('echouee');
    expect(corps.analyse.motifEchec).toBe('format_illisible');
  });

  it('la PLUS RÉCENTE est celle de plus grande `version`', async () => {
    tables.rush_analyses = [
      analyseLigne({ id: 'an-1', version: 1, etat: 'echouee', motif_echec: 'timeout' }),
      analyseLigne({ id: 'an-3', version: 3, etat: 'en_cours' }),
      analyseLigne({ id: 'an-2', version: 2, etat: 'reussie' }),
    ];
    const corps = await (await lireAnalyseHttp('r-a')).json();
    expect(corps.analyse.id).toBe('an-3');
    expect(corps.analyse.version).toBe(3);
  });

  it('tous les champs du contrat sont présents, VIDES compris', async () => {
    tables.rush_analyses = [analyseLigne()];
    const corps = await (await lireAnalyseHttp('r-a')).json();
    for (const champ of [
      'id', 'version', 'etat', 'etape', 'dureeSecondes', 'technique',
      'fournisseurs', 'resume', 'textesVisibles', 'parole', 'audio',
      'qualite', 'vignettes', 'motifEchec', 'createdAt', 'updatedAt',
    ]) {
      expect(corps.analyse, champ).toHaveProperty(champ);
    }
  });

  it('les champs que M3-B4/B5 remplira restent VIDES — rien n est inventé', async () => {
    tables.rush_analyses = [analyseLigne()];
    const corps = await (await lireAnalyseHttp('r-a')).json();
    expect(corps.analyse.resume).toBeNull();
    expect(corps.analyse.textesVisibles).toEqual([]);
    expect(corps.analyse.parole).toEqual({});
    expect(corps.analyse.qualite).toEqual({});
    expect(corps.analyse.audio).toEqual({});
  });

  it('l analyse d un AUTRE rush du même utilisateur n est pas rendue', async () => {
    tables.rush_analyses = [analyseLigne({ id: 'an-a2', rush_id: 'r-a2' })];
    const corps = await (await lireAnalyseHttp('r-a')).json();
    expect(corps.analyse).toBeNull();
  });

  /**
   * L'écran SONDE cet état. Une lecture non bornée rapatrierait toutes les
   * versions, avec toutes leurs colonnes `jsonb`, pour n'en afficher qu'une.
   */
  it('le sondage ne rapatrie qu UNE ligne, quel que soit le nombre de versions', async () => {
    tables.rush_analyses = [1, 2, 3, 4, 5].map(
      (v) => analyseLigne({ id: `an-${v}`, version: v }),
    );
    await lireAnalyseHttp('r-a');
    const surAnalyses = lectures.filter((l) => l.table === 'rush_analyses');
    expect(surAnalyses).toHaveLength(1);
    expect(surAnalyses[0].limite).toBe(1);
    // Et le rush n'est lu qu'UNE fois, pas deux.
    expect(lectures.filter((l) => l.table === 'rushes')).toHaveLength(1);
  });

  it('la lecture des analyses porte toujours le filtre de propriété', async () => {
    tables.rush_analyses = [analyseLigne()];
    await lireAnalyseHttp('r-a');
    const surAnalyses = lectures.find((l) => l.table === 'rush_analyses')!;
    expect(surAnalyses.filtres).toContainEqual(['user_id', 'A']);
    expect(surAnalyses.filtres).toContainEqual(['rush_id', 'r-a']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. LIRE N ÉCRIT PAS
// ═══════════════════════════════════════════════════════════════════════════
describe('Consulter une analyse ne la modifie jamais', () => {
  it('aucune écriture, sur aucune table', async () => {
    tables.rush_analyses = [analyseLigne()];
    await lireAnalyseHttp('r-a');
    await lireVignetteHttp('an-1', '0');
    expect(ecritures).toEqual([]);
  });

  it('une analyse active et PÉRIMÉE n est PAS fermée par une lecture', async () => {
    // Un quart d'heure de retard : `recupererAnalysesInterrompues` la
    // fermerait. Une lecture ne doit pas la toucher — sinon un écran qui
    // sonde toutes les 3 s tuerait le travail qu'il regarde.
    const vieux = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    tables.rush_analyses = [analyseLigne({
      etat: 'en_cours', created_at: vieux, updated_at: vieux,
    })];
    const corps = await (await lireAnalyseHttp('r-a')).json();
    expect(corps.analyse.etat).toBe('en_cours');
    expect((tables.rush_analyses ?? [])[0].etat).toBe('en_cours');
    expect(ecritures).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. LE SOCLE
// ═══════════════════════════════════════════════════════════════════════════
describe('Un socle absent est nommé, et le bon fichier', () => {
  it('`rushes` absente : 503 nommant la migration du tournage', async () => {
    tableAbsente = 'rushes';
    const r = await lireAnalyseHttp('r-a');
    expect(r.status).toBe(503);
    const corps = await r.json();
    expect(corps.motif).toBe('socle_absent');
    expect(corps.error).toContain('2026-08-31-shoot-sessions-rushes.sql');
  });

  it('`rush_analyses` absente : 503 nommant la migration des analyses', async () => {
    tableAbsente = 'rush_analyses';
    for (const r of [
      await lireAnalyseHttp('r-a'),
      await lireVignetteHttp('an-1', '0'),
    ]) {
      expect(r.status).toBe(503);
      const corps = await r.json();
      expect(corps.motif).toBe('socle_absent');
      expect(corps.error).toContain('2026-09-01-rush-analyses.sql');
    }
    expect(appelsLecture).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. AUCUNE CLÉ, AUCUN COMPARTIMENT, AUCUNE URL NE SORT DU GET D ÉTAT
// ═══════════════════════════════════════════════════════════════════════════
describe('Le GET d état ne laisse sortir aucun pointeur de stockage', () => {
  it('ni compartiment, ni clé, ni URL dans la réponse', async () => {
    tables.rush_analyses = [analyseLigne()];
    const texte = JSON.stringify(await (await lireAnalyseHttp('r-a')).json());
    expect(texte).not.toContain('A/analyse/');
    expect(texte).not.toContain('"bucket"');
    expect(texte).not.toContain('vignette-01');
    expect(texte).not.toMatch(/https?:\/\//);
    expect(texte).not.toContain('://');
    expect(texte).not.toContain('/storage/v1/object/public');
  });

  it('mais le nombre de vignettes et leurs positions sont rendus', async () => {
    tables.rush_analyses = [analyseLigne()];
    const corps = await (await lireAnalyseHttp('r-a')).json();
    expect(corps.analyse.vignettes).toEqual({ nombre: 2, secondes: [0, 21] });
  });

  it('la route d état n ouvre aucun objet du stockage', async () => {
    tables.rush_analyses = [analyseLigne()];
    await lireAnalyseHttp('r-a');
    expect(appelsLecture).toEqual([]);
  });

  it('la réponse n est pas mise en cache par un intermédiaire', async () => {
    tables.rush_analyses = [analyseLigne()];
    const r = await lireAnalyseHttp('r-a');
    expect(r.headers.get('Cache-Control')).toContain('no-store');
    expect(r.headers.get('Cache-Control')).toContain('private');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. LES VIGNETTES — LE CŒUR DU LOT
// ═══════════════════════════════════════════════════════════════════════════
describe('Une vignette est servie par l application, jamais par une URL', () => {
  beforeEach(() => { tables.rush_analyses = [analyseLigne()]; });

  it('l index désigne la position dans la liste STOCKÉE', async () => {
    const r0 = await lireVignetteHttp('an-1', '0');
    expect(r0.status).toBe(200);
    expect(appelsLecture.at(-1)).toMatchObject({
      bucket: 'media', cle: 'A/analyse/an-1/vignette-01.jpg',
    });

    appelsLecture = [];
    const r1 = await lireVignetteHttp('an-1', '1');
    expect(r1.status).toBe(200);
    expect(appelsLecture.at(-1)).toMatchObject({
      bucket: 'media', cle: 'A/analyse/an-1/vignette-02.jpg',
    });
  });

  it('les octets de l objet sont bien ceux servis', async () => {
    const r = await lireVignetteHttp('an-1', '0');
    expect(await r.text()).toBe(OCTETS_VIGNETTE);
  });

  it('le type est DÉCIDÉ par nous, et le navigateur ne doit pas renifler', async () => {
    const r = await lireVignetteHttp('an-1', '0');
    expect(r.headers.get('Content-Type')).toBe(TYPE_VIGNETTE);
    expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(r.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
  });

  it('la réponse dépend de la session : elle ne doit jamais être cachée', async () => {
    const r = await lireVignetteHttp('an-1', '0');
    expect(r.headers.get('Cache-Control')).toContain('no-store');
    expect(r.headers.get('Cache-Control')).toContain('private');
  });

  it('la lecture du stockage est BORNÉE — un MinIO muet ne fait pas pendre l onglet', async () => {
    await lireVignetteHttp('an-1', '0');
    const borne = appelsLecture[0].borne as { timeoutMs?: number } | undefined;
    expect(borne, 'lecteur MinIO construit sans borne').toBeTruthy();
    expect(borne!.timeoutMs).toBeGreaterThan(0);
    expect(borne!.timeoutMs).toBeLessThanOrEqual(30_000);
  });

  it('un objet illisible rend 502, sans nommer la cause', async () => {
    lectureEchoue = true;
    const r = await lireVignetteHttp('an-1', '0');
    expect(r.status).toBe(502);
    const corps = await r.json();
    expect(corps.motif).toBe('stockage_injoignable');
    expect(JSON.stringify(corps)).not.toContain('NoSuchKey');
    expect(JSON.stringify(corps)).not.toContain('A/analyse/');
  });

  it('un index hors liste rend 404 et n ouvre rien', async () => {
    for (const n of ['2', '7', '99']) {
      const r = await lireVignetteHttp('an-1', n);
      expect(r.status, n).toBe(404);
    }
    expect(appelsLecture).toEqual([]);
  });

  it('une analyse sans vignette rend 404 pour l index 0', async () => {
    tables.rush_analyses = [analyseLigne({ vignettes: [] })];
    expect((await lireVignetteHttp('an-1', '0')).status).toBe(404);
    expect(appelsLecture).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. L INVARIANT : IL N EXISTE AUCUNE PORTE POUR UNE CLÉ
// ═══════════════════════════════════════════════════════════════════════════
describe('Aucune clé venue du navigateur ne donne accès à quoi que ce soit', () => {
  it('l objet ouvert est EXACTEMENT celui de la ligne d analyse', async () => {
    tables.rush_analyses = [analyseLigne()];
    await lireVignetteHttp('an-1', '0');
    expect(appelsLecture.map((a) => [a.bucket, a.cle])).toEqual([
      ['media', 'A/analyse/an-1/vignette-01.jpg'],
    ]);
  });

  it('`?bucket=`, `?cle=`, `?path=`, `?url=` n ont AUCUN effet', async () => {
    tables.rush_analyses = [analyseLigne()];
    const r = await lireVignetteHttp(
      'an-1', '0',
      '?bucket=videos&cle=B/prive/secret.mp4&url=https://ailleurs/x'
      + '&path=../../B/prive/secret.mp4&key=B/prive/secret.mp4',
    );
    expect(r.status).toBe(200);
    // Le journal du lecteur est la preuve : il n'a vu que la clé stockée.
    expect(appelsLecture.map((a) => [a.bucket, a.cle])).toEqual([
      ['media', 'A/analyse/an-1/vignette-01.jpg'],
    ]);
    expect(await r.text()).toBe(OCTETS_VIGNETTE);
  });

  /**
   * Le segment `[n]` est le SEUL endroit où le navigateur écrit quelque
   * chose qui touche au stockage. Il ne doit jamais pouvoir y glisser autre
   * chose qu'un entier — surtout pas un fragment de chemin.
   */
  it.each([
    ['une remontée', '../../B/prive/secret'],
    ['un chemin', 'A/analyse/an-1/vignette-01.jpg'],
    ['une URL', 'https://ailleurs/x.jpg'],
    ['un nombre négatif', '-1'],
    ['un flottant', '0.5'],
    ['un hexadécimal', '0x0'],
    ['une notation exponentielle', '1e0'],
    ['un espace avant', ' 0'],
    ['du vide', ''],
    ['un mot', 'toutes'],
  ])('%s dans le segment d index est refusée sans lecture', async (_nom, n) => {
    tables.rush_analyses = [analyseLigne()];
    expect(indexVignetteValide(n)).toBeNull();
    const r = await lireVignetteHttp('an-1', n);
    expect(r.status).toBe(404);
    // Refusé AVANT la base : un segment absurde ne doit rien coûter.
    expect(lectures.filter((l) => l.table === 'rush_analyses')).toHaveLength(0);
    expect(appelsLecture).toEqual([]);
  });

  it('un entier ordinaire, lui, est accepté', () => {
    expect(indexVignetteValide('0')).toBe(0);
    expect(indexVignetteValide('7')).toBe(7);
  });

  it('la route ne lit AUCUN paramètre de requête ni aucun corps', () => {
    const source = readFileSync(join(
      process.cwd(),
      'src/app/api/autopilot/analyses/[id]/vignettes/[n]/route.ts',
    ), 'utf-8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    for (const interdit of [
      'searchParams', 'nextUrl', 'req.json', 'req.text', 'req.formData',
      'presignedGetObject', 'presignedPutObject', 'signeurPublic', 'signeurInterne',
      '/storage/v1/object/public',
    ]) {
      expect(code, `vignette : ${interdit}`).not.toContain(interdit);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. LES GARDES SUR LA CLÉ STOCKÉE — SI LA BASE MENT
// ═══════════════════════════════════════════════════════════════════════════
describe('Une clé stockée hors périmètre n est jamais ouverte', () => {
  /**
   * Toutes les clés que `vignetteLisible` refuse.
   *
   * Quatre d'entre elles sont DÉJÀ écartées plus tôt, par `vignettesValides`
   * du contrat, à la lecture même de la ligne. Les revalider ici n'est pas de
   * la superstition : ce module OUVRE un objet du stockage, et il ne doit pas
   * dépendre du fait qu'un autre fichier ait bien fait son travail.
   */
  const REFUSEES: Array<[string, unknown]> = [
    ['compartiment hors liste blanche',
      { bucket: 'prive', cle: 'A/analyse/an-1/v.jpg', seconde: 0 }],
    ['compartiment vide',
      { bucket: '', cle: 'A/analyse/an-1/v.jpg', seconde: 0 }],
    ['préfixe d un AUTRE utilisateur',
      { bucket: 'media', cle: 'B/analyse/an-9/v.jpg', seconde: 0 }],
    ['préfixe absent',
      { bucket: 'media', cle: 'analyse/an-1/v.jpg', seconde: 0 }],
    ['préfixe seulement RESSEMBLANT (pas de séparateur)',
      { bucket: 'media', cle: 'AB/analyse/an-1/v.jpg', seconde: 0 }],
    ['remontée `..`',
      { bucket: 'media', cle: 'A/../B/analyse/an-9/v.jpg', seconde: 0 }],
    ['URL déguisée en clé',
      { bucket: 'media', cle: 'https://ailleurs/x.jpg', seconde: 0 }],
    ['clé vide',
      { bucket: 'media', cle: '   ', seconde: 0 }],
  ];

  it.each(REFUSEES)('%s — refusée par `vignetteLisible`', (_nom, vignette) => {
    expect(vignetteLisible('A', vignette as never)).toBe(false);
  });

  it('une clé légitime, elle, est acceptée', () => {
    expect(vignetteLisible('A', {
      bucket: 'media', cle: 'A/analyse/an-1/vignette-01.jpg', seconde: 0,
    })).toBe(true);
  });

  it.each(REFUSEES)('%s — la ROUTE ne l ouvre JAMAIS', async (_nom, vignette) => {
    tables.rush_analyses = [analyseLigne({ vignettes: [vignette] })];
    const r = await lireVignetteHttp('an-1', '0');
    expect(r.status).toBe(404);
    expect(appelsLecture).toEqual([]);
  });

  /**
   * ⚠️ DEUX FILETS, ET ILS N'ATTRAPENT PAS LA MÊME CHOSE.
   *
   * `vignettesValides` (contrat) refuse la LISTE ENTIÈRE dès qu'une entrée
   * est mal formée : compartiment hors liste, `..`, `://`, clé vide. Une
   * ligne corrompue ne rend donc AUCUNE vignette — fermé par défaut.
   *
   * Le PRÉFIXE UTILISATEUR, lui, n'est vérifié nulle part ailleurs : le
   * contrat n'a pas accès à `userId`, et une clé `B/…` le traverse intacte.
   * C'est la garde propre à ce lot, et la seule qui distingue « ma vignette »
   * de « une vignette ».
   */
  it.each([
    ['préfixe d un AUTRE utilisateur', 'B/analyse/an-9/v.jpg'],
    ['préfixe absent', 'analyse/an-1/v.jpg'],
    ['préfixe seulement RESSEMBLANT', 'AB/analyse/an-1/v.jpg'],
  ])('%s — traverse le contrat, et meurt à l ouverture', async (_nom, cle) => {
    tables.rush_analyses = [analyseLigne({
      vignettes: [
        { bucket: 'media', cle, seconde: 4 },
        { bucket: 'media', cle: 'A/analyse/an-1/vignette-02.jpg', seconde: 21 },
      ],
    })];
    // Le GET d'état la compte encore — le contrat ne la refuse pas.
    const etat = await (await lireAnalyseHttp('r-a')).json();
    expect(etat.analyse.vignettes.nombre).toBe(2);
    // Mais l'ouvrir est refusé, et la voisine légitime reste servie.
    expect((await lireVignetteHttp('an-1', '0')).status).toBe(404);
    expect(appelsLecture).toEqual([]);
    expect((await lireVignetteHttp('an-1', '1')).status).toBe(200);
    expect(appelsLecture.map((a) => a.cle)).toEqual(['A/analyse/an-1/vignette-02.jpg']);
  });

  it.each([
    ['compartiment hors liste blanche', 'prive', 'A/analyse/an-1/v.jpg'],
    ['remontée `..`', 'media', 'A/../B/analyse/an-9/v.jpg'],
    ['URL déguisée en clé', 'media', 'https://ailleurs/x.jpg'],
    ['clé vide', 'media', '   '],
  ])('%s — le contrat vide la liste AVANT toute ouverture', async (_n, bucket, cle) => {
    tables.rush_analyses = [analyseLigne({
      vignettes: [
        { bucket, cle, seconde: 4 },
        { bucket: 'media', cle: 'A/analyse/an-1/vignette-02.jpg', seconde: 21 },
      ],
    })];
    // `vignettesValides` refuse la liste ENTIÈRE : fermé par défaut.
    const etat = await (await lireAnalyseHttp('r-a')).json();
    expect(etat.analyse.vignettes).toEqual({ nombre: 0, secondes: [] });
    expect((await lireVignetteHttp('an-1', '0')).status).toBe(404);
    expect((await lireVignetteHttp('an-1', '1')).status).toBe(404);
    expect(appelsLecture).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. LES DEUX ROUTES N ONT PAS DÉRIVÉ
// ═══════════════════════════════════════════════════════════════════════════
describe('Les routes de lecture restent des lectures', () => {
  const lire = (relatif: string) => readFileSync(join(process.cwd(), relatif), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  const ROUTE_ANALYSE = 'src/app/api/autopilot/rushes/[id]/analyse/route.ts';
  const ROUTE_VIGNETTE = 'src/app/api/autopilot/analyses/[id]/vignettes/[n]/route.ts';
  const MODULE_VIGNETTES = 'src/lib/autopilot/analyse/vignettes.ts';

  it('le GET d état n écrit dans aucune table et n ouvre aucun objet', () => {
    const code = lire(ROUTE_ANALYSE);
    const debut = code.indexOf('export async function GET');
    const fin = code.indexOf('export async function POST');
    expect(debut).toBeGreaterThan(-1);
    expect(fin).toBeGreaterThan(debut);
    const corpsGet = code.slice(debut, fin);
    for (const interdit of [
      'creerAnalyse', 'majAnalyse', 'recupererAnalysesInterrompues',
      'prendrePlaceExtraction', 'chargerMoteurExtraction',
      'presignedGetObject', 'lecteurMinio', 'clientMinio', 'process.env',
    ]) {
      expect(corpsGet, `GET /analyse : ${interdit}`).not.toContain(interdit);
    }
  });

  it('le GET d état réutilise `analysePublique` — pas une seconde projection', () => {
    const code = lire(ROUTE_ANALYSE);
    const debut = code.indexOf('export async function GET');
    const corpsGet = code.slice(debut, code.indexOf('export async function POST'));
    expect(corpsGet).toContain('analysePublique(');
    // Une seule définition dans tout le fichier.
    expect([...code.matchAll(/function\s+analysePublique/g)]).toHaveLength(1);
  });

  it('la route de vignette n écrit rien et ne touche ni IA ni crédits', () => {
    const code = lire(ROUTE_VIGNETTE);
    for (const interdit of [
      'creerAnalyse', 'majAnalyse', 'recupererAnalysesInterrompues',
      '.insert(', '.update(', 'credit_transactions', 'deductCredits',
      'anthropic', 'openai', 'replicate', 'scheduled_posts',
    ]) {
      expect(code, `vignette : ${interdit}`).not.toContain(interdit);
    }
  });

  it('rien ne matérialise l objet en mémoire : c est un flux', () => {
    for (const module of [ROUTE_VIGNETTE, MODULE_VIGNETTES]) {
      const code = lire(module);
      for (const [nom, motif] of [
        ['.arrayBuffer()', /\.arrayBuffer\s*\(/],
        ['.blob()', /\.blob\s*\(/],
        ['.bytes()', /\.bytes\s*\(/],
        ['Buffer.concat', /Buffer\s*\.\s*concat\s*\(/],
        ['Buffer.from(await', /Buffer\s*\.\s*from\s*\(\s*await/],
        ['createWriteStream', /createWriteStream\s*\(/],
        ['writeFile', /\bwriteFile(Sync)?\s*\(/],
        ['downloadMediaToBuffer', /downloadMediaToBuffer/],
      ] as Array<[string, RegExp]>) {
        expect(code, `${module} : ${nom}`).not.toMatch(motif);
      }
    }
  });

  it('le module de vignettes ne signe ni ne journalise aucune URL', () => {
    const code = lire(MODULE_VIGNETTES);
    for (const interdit of [
      'presignedGetObject', 'presignedPutObject', 'signeurPublic', 'signeurInterne',
      'console.log', 'console.error', 'supabaseAdmin', '.insert(', '.update(',
      '/storage/v1/object/public',
    ]) {
      expect(code, `vignettes.ts : ${interdit}`).not.toContain(interdit);
    }
  });

  it('la clé n entre JAMAIS par un argument public du module', () => {
    const code = lire(MODULE_VIGNETTES);
    // `resoudreVignette` prend un identifiant et un nombre — pas une clé.
    expect(code).toMatch(
      /export async function resoudreVignette\(\s*userId: string, analyseId: string, index: number,?\s*\)/,
    );
    // `ouvrirVignette` prend une `VignetteAnalyse` — donc une valeur issue de
    // la base, jamais une paire (bucket, cle) reconstruite par un appelant.
    expect(code).toMatch(
      /export async function ouvrirVignette\(\s*vignette: VignetteAnalyse,?\s*\)/,
    );
  });
});
