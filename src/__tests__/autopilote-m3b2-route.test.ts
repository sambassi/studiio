/**
 * M3-B2 — La route qui lance l'analyse d'un rush.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI EST VÉRIFIÉ ICI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le VRAI gestionnaire de route est appelé. Ce qui compte n'est pas qu'une
 * fonction existe, c'est ce que la route répond : à qui elle donne accès, ce
 * qu'elle refuse du client, dans quel ordre elle écrit, et ce qu'elle laisse
 * derrière elle quand la mesure échoue.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI N'EST PAS VÉRIFIÉ ICI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le moteur d'extraction lui-même. Le faire tourner demanderait ffmpeg et un
 * vrai fichier : ce test-là ne testerait pas l'orchestration, il testerait
 * ffmpeg. Le moteur est donc INJECTÉ par la couture `definirMoteurExtraction`,
 * et ce fichier vérifie ce que la route fait de chacune de ses réponses —
 * y compris celles qu'il n'a pas le droit de rendre.
 *
 * La doublure de base applique RÉELLEMENT les `.eq()` et les deux index
 * uniques de `rush_analyses`. Les index ne sont pas rejoués pour prouver
 * qu'ils existent — c'est le travail du test PostgreSQL de M3-B1 — mais pour
 * que le chemin d'idempotence de la route soit réellement emprunté, et non
 * simulé par un `if`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CHAMPS_INTERDITS_ANALYSE } from '@/lib/autopilot/analyse/contrat';
import {
  definirMoteurExtraction, resultatExtractionValide,
  type DemandeExtraction, type ResultatExtraction,
} from '@/lib/autopilot/analyse/moteur';

const authMock = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));

/**
 * Le moteur réel est REMPLACÉ par un module vide dans ce fichier.
 *
 * ⚠️ SANS CELA, « moteur absent » N'EST PLUS SIMULABLE. Depuis que le moteur
 * existe vraiment, `definirMoteurExtraction(null)` ne suffit plus : la
 * couture retombe sur l'import dynamique, trouve `extraireRush`, et la route
 * lance une vraie mesure — sans MinIO, donc `stockage_injoignable` au lieu du
 * 503 attendu.
 *
 * Ce fichier teste l'ORCHESTRATION, jamais la mesure : tous ses moteurs sont
 * injectés. Neutraliser le module ici rend `null` de nouveau signifiant, et
 * garantit qu'aucun ffmpeg ne démarre pendant ces 88 tests.
 *
 * Le raccord réel entre la couture et le moteur est vérifié ailleurs, dans
 * `autopilote-m3b2-branchement.test.ts`, qui charge le vrai module.
 */
vi.mock('@/lib/autopilot/analyse/extraction', async (importOriginal) => {
  // Le VOCABULAIRE est conservé — `moteur.ts` l'importe d'ici, et un module
  // entièrement vide ferait échouer la validation des motifs, transformant
  // chaque échec attendu en 500. Seule la FONCTION disparaît : c'est elle,
  // et elle seule, dont on veut simuler l'absence.
  const reel = await importOriginal<Record<string, unknown>>();
  return { MOTIFS_EXTRACTION: reel.MOTIFS_EXTRACTION };
});

// ───────────────────────────────────────────────────────────────────────────
// Une base minuscule, en mémoire, avec le filtrage que fait PostgREST.
// ───────────────────────────────────────────────────────────────────────────
interface Ligne { [k: string]: unknown }
let tables: Record<string, Ligne[]>;
let tableAbsente: string | null = null;
/** Panne d'écriture sur `rushes` — et sur elle seule. */
let panneEcritureRush = false;
/** Les insertions ACCEPTÉES. */
const insertions: Array<{ table: string; valeurs: Ligne }> = [];
/**
 * Les insertions TENTÉES, refus de la base compris.
 *
 * C'est la seule façon de distinguer « la route n'a pas inséré parce qu'elle
 * s'était protégée par un `select` » de « la route a inséré et la base a
 * refusé » — et c'est toute la question de l'idempotence.
 */
const tentativesInsertion: Array<{ table: string; valeurs: Ligne }> = [];
const majEffectuees: Array<{ table: string; valeurs: Ligne }> = [];

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

/**
 * L'horodatage d'une ligne d'analyse POSÉE À L'INSTANT.
 *
 * ⚠️ PAS UNE DATE EN DUR, ET C'EST M3-B2.1 QUI L'EXIGE. Depuis que
 * `creerAnalyse` ferme les analyses actives dont l'`updated_at` a dépassé
 * `PEREMPTION_ANALYSE_MS`, une analyse « active » figée à une date littérale
 * finit par devenir périmée avec le simple passage du temps réel : les tests
 * d'idempotence ci-dessous verraient un 201 là où ils attendent un 409, et
 * ils le verraient un jour donné, sans qu'aucun commit n'ait bougé. Une
 * analyse vivante se date maintenant.
 */
const maintenantIso = () => new Date().toISOString();

/**
 * `<` sur un `timestamptz`, ajouté par M3-B2.1.
 *
 * `recupererAnalysesInterrompues` filtre sur `updated_at < seuil` — une
 * doublure qui ignorerait `.lt()` laisserait passer la fermeture d'analyses
 * VIVANTES sans qu'aucun test ne s'en aperçoive. La comparaison porte donc
 * sur des DATES, pas sur des chaînes.
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
      const valeurs: Ligne = { version: 1, etat: 'en_attente', ...aInserer };
      tentativesInsertion.push({ table, valeurs: aInserer });
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
        created_at: maintenantIso(),
        updated_at: maintenantIso(),
        ...valeurs,
      };
      insertions.push({ table, valeurs: aInserer });
      tables[table] = [...(tables[table] ?? []), ligne];
      return { data: ligne, error: null };
    }

    if (aMettreAJour) {
      if (panneEcritureRush && table === 'rushes') {
        return {
          data: null,
          error: { code: '57P01', message: 'terminating connection due to administrator command' },
        };
      }
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

const { POST, maxDuration } = await import(
  '@/app/api/autopilot/rushes/[id]/analyse/route'
);

// ───────────────────────────────────────────────────────────────────────────
const RUSH_DE_A: Ligne = {
  id: 'r-a', shoot_session_id: 's-a', user_id: 'A', bucket: 'media',
  cle_objet: 'A/rush/plan.mp4', nom_origine: 'plan.mp4', content_type: 'video/mp4',
  taille_octets: 5_000_000, duree_secondes: null, rang: 0, etat: 'verifie',
  metadata: {}, created_at: '2026-08-31T10:00:00Z', updated_at: '2026-08-31T10:00:00Z',
};
const RUSH_DE_B: Ligne = {
  ...RUSH_DE_A, id: 'r-b', shoot_session_id: 's-b', user_id: 'B',
  cle_objet: 'B/rush/plan.mp4',
};

/** Les appels reçus par le moteur — pour prouver qu'il n'y en a qu'un. */
let appelsMoteur: DemandeExtraction[] = [];

function moteurQuiRend(resultat: ResultatExtraction | unknown) {
  return async (demande: DemandeExtraction) => {
    appelsMoteur.push(demande);
    return resultat as ResultatExtraction;
  };
}

const EXTRACTION_OK: ResultatExtraction = {
  ok: true,
  dureeSecondes: 42.5,
  technique: { largeur: 1080, hauteur: 1920, fps: 30, audio: true },
  vignettes: [
    { bucket: 'media', cle: 'A/analyse/rush_analyses-1/0.jpg', seconde: 0 },
    { bucket: 'media', cle: 'A/analyse/rush_analyses-1/21.jpg', seconde: 21 },
  ],
};

function appeler(rushId: string, corps?: unknown, corpsBrut?: string) {
  const init: RequestInit = { method: 'POST' };
  if (corpsBrut !== undefined) init.body = corpsBrut;
  else if (corps !== undefined) init.body = JSON.stringify(corps);
  const req = new Request(`http://x/api/autopilot/rushes/${rushId}/analyse`, init);
  return POST(req as never, { params: { id: rushId } });
}

beforeEach(() => {
  insertions.length = 0;
  tentativesInsertion.length = 0;
  majEffectuees.length = 0;
  appelsMoteur = [];
  tableAbsente = null;
  panneEcritureRush = false;
  authMock.mockResolvedValue({ user: { id: 'A' } });
  definirMoteurExtraction(moteurQuiRend(EXTRACTION_OK));
  tables = {
    rushes: [{ ...RUSH_DE_A }, { ...RUSH_DE_B }],
    rush_analyses: [],
  };
});

// ───────────────────────────────────────────────────────────────────────────
describe('L identité vient de la session, jamais du corps', () => {
  it('sans session, 401 — et rien n est créé', async () => {
    authMock.mockResolvedValue(null);
    const r = await appeler('r-a');
    expect(r.status).toBe(401);
    expect(insertions).toHaveLength(0);
    expect(appelsMoteur).toHaveLength(0);
  });

  it('une session sans `user.id` vaut absence de session', async () => {
    authMock.mockResolvedValue({ user: { email: 'a@x.fr' } });
    expect((await appeler('r-a')).status).toBe(401);
    expect(insertions).toHaveLength(0);
  });

  it('l analyse est créée pour l utilisateur de la SESSION', async () => {
    await appeler('r-a');
    expect(insertions[0].valeurs.user_id).toBe('A');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('Le corps ne décide de rien — et n est jamais ignoré en silence', () => {
  it('un corps absent est la requête normale', async () => {
    const r = await appeler('r-a');
    expect(r.status).toBe(201);
  });

  it('un corps vide aussi', async () => {
    const r = await appeler('r-a', undefined, '   ');
    expect(r.status).toBe(201);
  });

  it('un JSON illisible est refusé en 400, avant toute écriture', async () => {
    const r = await appeler('r-a', undefined, '{ pas du json');
    expect(r.status).toBe(400);
    expect(insertions).toHaveLength(0);
  });

  it('un corps qui n est pas un objet est refusé en 422', async () => {
    for (const brut of ['[]', '"x"', '42', 'null']) {
      const r = await appeler('r-a', undefined, brut);
      expect(r.status, brut).toBe(422);
    }
    expect(insertions).toHaveLength(0);
  });

  it.each([...CHAMPS_INTERDITS_ANALYSE])(
    'le champ « %s » est refusé en 422, et NOMMÉ',
    async (champ) => {
      const r = await appeler('r-a', { [champ]: 'peu importe' });
      expect(r.status).toBe(422);
      const corps = await r.json();
      expect(corps.error).toContain(champ);
      // La preuve qui compte : rien n'a été créé, et le moteur n'a pas tourné.
      expect(insertions).toHaveLength(0);
      expect(appelsMoteur).toHaveLength(0);
    },
  );

  it('un champ interdit à `null` ou `undefined` est refusé lui aussi', async () => {
    // `hasOwnProperty`, et non une vérité : envoyer `"userId": null` reste
    // une tentative de décider d'un champ du serveur.
    const r = await appeler('r-a', { userId: null });
    expect(r.status).toBe(422);
  });

  it('la liste couvre les deux orthographes du propriétaire', () => {
    expect(CHAMPS_INTERDITS_ANALYSE).toContain('user_id');
    expect(CHAMPS_INTERDITS_ANALYSE).toContain('userId');
  });

  it('un champ inconnu ne fait pas échouer — il n est simplement pas lu', async () => {
    const r = await appeler('r-a', { commentaire: 'bonjour' });
    expect(r.status).toBe(201);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('La propriété du rush est vérifiée côté serveur', () => {
  it('le rush d autrui est INTROUVABLE — 404, pas 403', async () => {
    const r = await appeler('r-b');
    expect(r.status).toBe(404);
    // Un 403 confirmerait l'existence du rush de B.
    expect((await r.json()).error).toBe('Rush introuvable');
    expect(insertions).toHaveLength(0);
    expect(appelsMoteur).toHaveLength(0);
  });

  it('un rush inexistant donne exactement la même réponse', async () => {
    const r = await appeler('r-inconnu');
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe('Rush introuvable');
  });

  it('le moteur reçoit la clé du rush LU, jamais une clé du corps', async () => {
    await appeler('r-a', { bucket: 'videos', cleObjet: 'B/rush/plan.mp4' });
    expect(appelsMoteur).toHaveLength(1);
    expect(appelsMoteur[0].bucket).toBe('media');
    expect(appelsMoteur[0].cleObjet).toBe('A/rush/plan.mp4');
    expect(appelsMoteur[0].userId).toBe('A');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('Un rush non vérifié ne s analyse pas', () => {
  it.each(['indexe', 'absent'])('l état « %s » est refusé en 409', async (etat) => {
    tables.rushes = [{ ...RUSH_DE_A, etat }];
    const r = await appeler('r-a');
    // 409 et non 422 : la requête est bien formée, il n'y a rien à y
    // corriger. Et non 404 : le rush existe et appartient à l'appelant.
    expect(r.status).toBe(409);
    const corps = await r.json();
    expect(corps.motif).toBe('rush_non_verifie');
    expect(corps.etat).toBe(etat);
    // Aucune analyse n'est créée : elle occuperait le verrou d'unicité pour
    // rien.
    expect(insertions).toHaveLength(0);
    expect(appelsMoteur).toHaveLength(0);
  });

  it('l état `verifie` passe', async () => {
    expect((await appeler('r-a')).status).toBe(201);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('Une migration absente se dit, et NOMME son fichier', () => {
  it('sans `rush_analyses` : 503 nommant 2026-09-01-rush-analyses.sql', async () => {
    tableAbsente = 'rush_analyses';
    const r = await appeler('r-a');
    expect(r.status).toBe(503);
    const corps = await r.json();
    expect(corps.error).toContain('2026-09-01-rush-analyses.sql');
    expect(corps.motif).toBe('socle_absent');
    expect(appelsMoteur).toHaveLength(0);
  });

  it('sans `rushes` : 503 nommant l AUTRE migration', async () => {
    // Les deux socles rendent le même motif côté service. Nommer le mauvais
    // fichier enverrait appliquer la mauvaise migration — c'est précisément
    // pourquoi la route relit le rush elle-même.
    tableAbsente = 'rushes';
    const r = await appeler('r-a');
    expect(r.status).toBe(503);
    const corps = await r.json();
    expect(corps.error).toContain('2026-08-31-shoot-sessions-rushes.sql');
    expect(corps.error).not.toContain('2026-09-01-rush-analyses.sql');
  });

  it('les deux fichiers nommés existent réellement', () => {
    for (const f of [
      'migrations/2026-08-31-shoot-sessions-rushes.sql',
      'migrations/2026-09-01-rush-analyses.sql',
    ]) {
      expect(() => readFileSync(join(process.cwd(), f), 'utf-8')).not.toThrow();
    }
  });

  it('M3-B2 n ajoute AUCUNE migration', () => {
    const route = readFileSync(
      join(process.cwd(), 'src/app/api/autopilot/rushes/[id]/analyse/route.ts'), 'utf-8',
    );
    // Les seuls fichiers SQL cités sont ceux des lots précédents.
    const cites = [...route.matchAll(/\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.sql/g)].map((m) => m[0]);
    expect([...new Set(cites)].sort()).toEqual([
      '2026-08-31-shoot-sessions-rushes.sql',
      '2026-09-01-rush-analyses.sql',
    ]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('La séquence d écriture — la ligne AVANT le travail', () => {
  it('l analyse naît `en_attente`, puis passe `en_cours` AVANT le moteur', async () => {
    let etatAuMomentDeLAppel: unknown = null;
    definirMoteurExtraction(async (d) => {
      appelsMoteur.push(d);
      etatAuMomentDeLAppel = (tables.rush_analyses ?? [])[0].etat;
      return EXTRACTION_OK;
    });
    await appeler('r-a');
    // Si la ligne n'était posée qu'après la mesure, un processus tué pendant
    // ffmpeg ne laisserait aucune trace de ce qui a été tenté.
    expect(insertions[0].valeurs.etat).toBe('en_attente');
    expect(etatAuMomentDeLAppel).toBe('en_cours');
  });

  it('`etape` et le fournisseur sont posés au démarrage, pas à la fin', async () => {
    let vuePendantLAppel: Ligne | null = null;
    definirMoteurExtraction(async (d) => {
      appelsMoteur.push(d);
      vuePendantLAppel = { ...(tables.rush_analyses ?? [])[0] };
      return EXTRACTION_OK;
    });
    await appeler('r-a');
    expect(vuePendantLAppel!.etape).toBe('extraction');
    expect(vuePendantLAppel!.fournisseurs)
      .toEqual({ extraction: { fournisseur: 'local', modele: 'ffmpeg' } });
  });

  it('aucun fournisseur externe : l extraction est locale', async () => {
    await appeler('r-a');
    const ligne = (tables.rush_analyses ?? [])[0];
    expect((ligne.fournisseurs as Record<string, { fournisseur: string }>).extraction.fournisseur)
      .toBe('local');
  });

  it('la version part à 1, et le serveur décide de tout le reste', async () => {
    await appeler('r-a');
    expect(insertions[0].valeurs).toEqual({
      rush_id: 'r-a', user_id: 'A', version: 1, etat: 'en_attente', etape: null,
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('Succès : le résultat est consigné, et la durée recopiée sur le rush', () => {
  it('201, analyse `reussie`, étape conservée', async () => {
    const r = await appeler('r-a');
    expect(r.status).toBe(201);
    const corps = await r.json();
    expect(corps.ok).toBe(true);
    expect(corps.analyse.etat).toBe('reussie');
    // `etape` n'est pas effacée : elle dit jusqu'où l'analyse est allée.
    expect(corps.analyse.etape).toBe('extraction');
    expect(corps.analyse.dureeSecondes).toBe(42.5);
    expect(corps.analyse.technique).toEqual(EXTRACTION_OK.ok ? EXTRACTION_OK.technique : {});
  });

  it('`rushes.duree_secondes` est écrit CÔTÉ SERVEUR, avec la valeur mesurée', async () => {
    const r = await appeler('r-a');
    expect((await r.json()).dureeRushEcrite).toBe(true);
    const rush = (tables.rushes ?? []).find((l) => l.id === 'r-a')!;
    expect(rush.duree_secondes).toBe(42.5);
    // Et c'est bien une écriture sur `rushes`, filtrée par propriétaire.
    const surRushes = majEffectuees.filter((m) => m.table === 'rushes');
    expect(surRushes).toHaveLength(1);
    expect(surRushes[0].valeurs.duree_secondes).toBe(42.5);
  });

  it('le rush d un autre utilisateur n est pas touché', async () => {
    await appeler('r-a');
    const rushB = (tables.rushes ?? []).find((l) => l.id === 'r-b')!;
    expect(rushB.duree_secondes).toBeNull();
  });

  it('la durée n est PAS recopiée quand la mesure échoue', async () => {
    definirMoteurExtraction(moteurQuiRend({ ok: false, motif: 'format_illisible' }));
    await appeler('r-a');
    const rush = (tables.rushes ?? []).find((l) => l.id === 'r-a')!;
    expect(rush.duree_secondes).toBeNull();
    expect(majEffectuees.filter((m) => m.table === 'rushes')).toHaveLength(0);
  });

  it('une copie qui échoue ne fait PAS mentir l analyse réussie', async () => {
    // La mesure faisant foi est dans `rush_analyses`. Répondre en échec
    // parce que la copie de confort n'a pas pris ferait croire que l'analyse
    // a raté alors qu'elle est consignée et `reussie`.
    panneEcritureRush = true;
    const r = await appeler('r-a');
    expect(r.status).toBe(201);
    const corps = await r.json();
    expect(corps.ok).toBe(true);
    expect(corps.analyse.etat).toBe('reussie');
    expect(corps.analyse.dureeSecondes).toBe(42.5);
    // Mais on ne le cache pas : l'appelant sait que la copie n'a pas pris.
    expect(corps.dureeRushEcrite).toBe(false);
    expect((tables.rushes ?? []).find((l) => l.id === 'r-a')!.duree_secondes).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('Aucune URL de stockage, aucun secret ne sort', () => {
  it('la réponse ne porte ni compartiment, ni clé de vignette', async () => {
    const r = await appeler('r-a');
    const texte = JSON.stringify(await r.json());
    expect(texte).not.toContain('A/analyse/');
    expect(texte).not.toContain('"bucket"');
    expect(texte).not.toContain('cle');
    expect(texte).not.toMatch(/https?:\/\//);
    expect(texte).not.toContain('://');
  });

  it('mais le nombre de vignettes et leurs positions sont rendus', async () => {
    const corps = await (await appeler('r-a')).json();
    expect(corps.analyse.vignettes).toEqual({ nombre: 2, secondes: [0, 21] });
  });

  it('les clés sont bien STOCKÉES, elles ne sont simplement pas rendues', async () => {
    await appeler('r-a');
    const ligne = (tables.rush_analyses ?? [])[0];
    expect(ligne.vignettes).toEqual(EXTRACTION_OK.ok ? EXTRACTION_OK.vignettes : []);
  });

  it('la route ne signe aucune URL et ne parle à aucun fournisseur', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/autopilot/rushes/[id]/analyse/route.ts'), 'utf-8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    for (const interdit of [
      'presignedGetObject', 'presignedPutObject', 'signed-url', 'process.env',
      'anthropic', 'openai', 'replicate', 'fetch(',
      'debiter_credits', 'credit_transactions', "from('rendus')", 'scheduled_posts',
    ]) {
      expect(code, interdit).not.toContain(interdit);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('Idempotence : la base tranche, pas un `if`', () => {
  it('une seconde requête pendant qu une analyse tourne est refusée en 409', async () => {
    // La première laisse une analyse `en_cours` : le moteur ne rend jamais.
    let libere: (() => void) | null = null;
    definirMoteurExtraction(async (d) => {
      appelsMoteur.push(d);
      await new Promise<void>((r) => { libere = r; });
      return EXTRACTION_OK;
    });
    const premiere = appeler('r-a');
    // Laisse la première atteindre l'appel au moteur.
    await vi.waitFor(() => expect(appelsMoteur).toHaveLength(1));

    definirMoteurExtraction(moteurQuiRend(EXTRACTION_OK));
    const seconde = await appeler('r-a');
    expect(seconde.status).toBe(409);
    const corps = await seconde.json();
    expect(corps.motif).toBe('analyse_active_existante');
    // Elle rend l'analyse gagnante, pour que le perdant sache quoi suivre.
    expect(corps.analyse.etat).toBe('en_cours');

    libere!();
    await premiere;
    // Une seule analyse existe, et le moteur n'a tourné qu'une fois.
    expect(tables.rush_analyses).toHaveLength(1);
    expect(appelsMoteur).toHaveLength(1);
  });

  it('le refus vient de l INDEX UNIQUE, pas d une lecture préalable', async () => {
    // Preuve : on pose directement une analyse active en base, sans passer
    // par la route. Si la route se protégeait par un `select` puis un
    // `insert`, elle refuserait ici aussi — mais elle refuserait de la même
    // façon avec un index absent. On vérifie donc que l'INSERT a bien été
    // TENTÉ et que c'est la base qui l'a refusé.
    tables.rush_analyses = [{
      id: 'a-1', rush_id: 'r-a', user_id: 'A', version: 1, etat: 'en_cours',
      etape: 'extraction', fournisseurs: {}, duree_secondes: null, technique: {},
      resume: null, textes_visibles: [], parole: {}, audio: {}, qualite: {},
      vignettes: [], usage: {}, motif_echec: null,
      created_at: maintenantIso(), updated_at: maintenantIso(),
    }];
    const r = await appeler('r-a');
    expect(r.status).toBe(409);
    // L'insertion a été TENTÉE — c'est ce qui prouve l'absence de garde
    // applicative « est-ce actif ? » en amont. Et elle a été REFUSÉE : aucune
    // ligne n'a été acceptée.
    expect(tentativesInsertion).toHaveLength(1);
    expect(tentativesInsertion[0].table).toBe('rush_analyses');
    expect(insertions).toHaveLength(0);
    // Et rien n'a été ajouté.
    expect(tables.rush_analyses).toHaveLength(1);
    expect(appelsMoteur).toHaveLength(0);
  });

  it('une analyse CLOSE n empêche pas d en relancer une', async () => {
    tables.rush_analyses = [{
      id: 'a-1', rush_id: 'r-a', user_id: 'A', version: 1, etat: 'echouee',
      etape: 'extraction', fournisseurs: {}, duree_secondes: null, technique: {},
      resume: null, textes_visibles: [], parole: {}, audio: {}, qualite: {},
      vignettes: [], usage: {}, motif_echec: 'timeout',
      created_at: maintenantIso(), updated_at: maintenantIso(),
    }];
    const r = await appeler('r-a');
    expect(r.status).toBe(201);
    // Une nouvelle VERSION, et non un écrasement de la précédente.
    expect(insertions[0].valeurs.version).toBe(2);
    expect(tables.rush_analyses).toHaveLength(2);
  });

  it('l analyse active d un AUTRE rush n empêche rien', async () => {
    tables.rushes = [{ ...RUSH_DE_A }, { ...RUSH_DE_A, id: 'r-a2' }];
    await appeler('r-a');
    definirMoteurExtraction(moteurQuiRend(EXTRACTION_OK));
    expect((await appeler('r-a2')).status).toBe(201);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('Les quatre échecs du moteur : `echouee`, un motif, un code', () => {
  const attendus: Array<[string, number]> = [
    ['format_illisible', 422],
    ['objet_introuvable', 422],
    ['timeout', 504],
    ['extraction_impossible', 503],
  ];

  it.each(attendus)('« %s » → %i, analyse `echouee` avec le motif', async (motif, statut) => {
    definirMoteurExtraction(moteurQuiRend({ ok: false, motif }));
    const r = await appeler('r-a');
    expect(r.status).toBe(statut);
    const corps = await r.json();
    expect(corps.ok).toBe(false);
    expect(corps.motif).toBe(motif);
    const ligne = (tables.rush_analyses ?? [])[0];
    expect(ligne.etat).toBe('echouee');
    expect(ligne.motif_echec).toBe(motif);
    // Le verrou est libéré : une relance est possible.
    expect(corps.analyse.etat).toBe('echouee');
  });

  it('un échec laisse le rush sans durée', async () => {
    definirMoteurExtraction(moteurQuiRend({ ok: false, motif: 'timeout' }));
    await appeler('r-a');
    expect((tables.rushes ?? []).find((l) => l.id === 'r-a')!.duree_secondes).toBeNull();
  });

  it('le moteur n est appelé QU UNE fois — aucune reprise cachée', async () => {
    definirMoteurExtraction(moteurQuiRend({ ok: false, motif: 'extraction_impossible' }));
    await appeler('r-a');
    expect(appelsMoteur).toHaveLength(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('Ce que le moteur n a PAS le droit de rendre', () => {
  it('un motif hors des quatre est un bug, pas un échec d analyse', async () => {
    definirMoteurExtraction(moteurQuiRend({ ok: false, motif: 'disque_plein' }));
    const r = await appeler('r-a');
    expect(r.status).toBe(500);
    expect((await r.json()).motif).toBe('resultat_moteur_invalide');
    expect((tables.rush_analyses ?? [])[0].etat).toBe('echouee');
  });

  it.each([
    ['une durée nulle', { ok: true, dureeSecondes: 0, technique: {}, vignettes: [] }],
    ['une durée négative', { ok: true, dureeSecondes: -3, technique: {}, vignettes: [] }],
    ['une durée absente', { ok: true, technique: {}, vignettes: [] }],
    ['un `technique` en tableau', { ok: true, dureeSecondes: 5, technique: [], vignettes: [] }],
    ['des vignettes en objet', { ok: true, dureeSecondes: 5, technique: {}, vignettes: {} }],
    ['ni ok:true ni ok:false', { dureeSecondes: 5 }],
    ['une réponse nulle', null],
    ['un tableau', []],
  ])('%s est refusée en 500, et l analyse est close', async (_libelle, mauvais) => {
    definirMoteurExtraction(moteurQuiRend(mauvais));
    const r = await appeler('r-a');
    expect(r.status).toBe(500);
    expect((await r.json()).motif).toBe('resultat_moteur_invalide');
    // Une ligne `en_cours` abandonnée occuperait le verrou pour toujours.
    expect((tables.rush_analyses ?? [])[0].etat).toBe('echouee');
    expect((tables.rush_analyses ?? [])[0].motif_echec).toBe('resultat_moteur_invalide');
  });

  it('une vignette hors compartiment est refusée par le CONTRAT, pas par la route', async () => {
    definirMoteurExtraction(moteurQuiRend({
      ok: true, dureeSecondes: 5, technique: {},
      vignettes: [{ bucket: 'inconnu', cle: 'A/0.jpg', seconde: 0 }],
    }));
    const r = await appeler('r-a');
    expect(r.status).toBe(500);
    const corps = await r.json();
    expect(corps.motif).toBe('resultat_moteur_refuse');
    // Le champ fautif est NOMMÉ — c'est ce que `majAnalyse` rend.
    expect(corps.champ).toBe('vignettes');
    const ligne = (tables.rush_analyses ?? [])[0];
    expect(ligne.etat).toBe('echouee');
    expect(ligne.motif_echec).toBe('resultat_moteur_refuse:vignettes');
    // Rien d'invalide n'a atteint la colonne.
    expect(ligne.vignettes).toEqual([]);
  });

  it('une vignette portant une URL est refusée de la même façon', async () => {
    definirMoteurExtraction(moteurQuiRend({
      ok: true, dureeSecondes: 5, technique: {},
      vignettes: [{ bucket: 'media', cle: 'https://minio/x/0.jpg', seconde: 0 }],
    }));
    expect((await appeler('r-a')).status).toBe(500);
    expect((tables.rush_analyses ?? [])[0].motif_echec).toBe('resultat_moteur_refuse:vignettes');
  });

  it('un moteur qui LÈVE clôt l analyse au lieu de l abandonner `en_cours`', async () => {
    definirMoteurExtraction(async (d) => {
      appelsMoteur.push(d);
      throw new Error('ffmpeg a segfault');
    });
    const r = await appeler('r-a');
    expect(r.status).toBe(500);
    const corps = await r.json();
    expect(corps.motif).toBe('moteur_en_erreur');
    expect(corps.error).toContain('segfault');
    expect((tables.rush_analyses ?? [])[0].etat).toBe('echouee');
    expect((tables.rush_analyses ?? [])[0].motif_echec).toBe('moteur_en_erreur');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('Le moteur absent se dit, il ne fait pas tomber la route', () => {
  it('503 nommant le fichier attendu, et l analyse est close', async () => {
    // `null` : ni couture injectée, ni module `extraction.ts` sur ce serveur.
    definirMoteurExtraction(null);
    const r = await appeler('r-a');
    expect(r.status).toBe(503);
    const corps = await r.json();
    expect(corps.motif).toBe('moteur_absent');
    expect(corps.error).toContain('extraction.ts');
    // La ligne ne reste pas `en_attente` : elle occuperait le verrou et
    // interdirait toute relance après le déploiement du moteur.
    expect((tables.rush_analyses ?? [])[0].etat).toBe('echouee');
    expect((tables.rush_analyses ?? [])[0].motif_echec).toBe('moteur_absent');
  });

  it('et une relance redevient possible ensuite', async () => {
    definirMoteurExtraction(null);
    await appeler('r-a');
    definirMoteurExtraction(moteurQuiRend(EXTRACTION_OK));
    expect((await appeler('r-a')).status).toBe(201);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('Le contrat attendu du moteur d extraction', () => {
  it('valide une réponse conforme et rejette tout le reste', () => {
    expect(resultatExtractionValide(EXTRACTION_OK)).toEqual(EXTRACTION_OK);
    expect(resultatExtractionValide({ ok: false, motif: 'timeout' }))
      .toEqual({ ok: false, motif: 'timeout', detail: undefined });
    expect(resultatExtractionValide({ ok: false, motif: 'autre' })).toBeNull();
    expect(resultatExtractionValide('x')).toBeNull();
  });

  it('le module de couture ne parle à personne', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/lib/autopilot/analyse/moteur.ts'), 'utf-8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/process\.env/);
    expect(code).not.toMatch(/execFile|spawn\s*\(/);
    // Un seul chemin, et c'est celui annoncé à l'agent qui écrit le moteur.
    expect(code).toContain("import('@/lib/autopilot/analyse/extraction')");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('Le cadre d exécution', () => {
  it('`maxDuration` couvre le pire cas vidéo du projet', () => {
    // Plus COURT que le délai interne du moteur, il ferait tuer le processus
    // pendant la mesure et laisserait l'analyse `en_cours` pour toujours.
    expect(maxDuration).toBe(300);
    // La même borne que les autres routes qui manipulent une vidéo.
    for (const f of [
      'src/app/api/convert/to-mp4/route.ts',
      'src/app/api/render/route.ts',
    ]) {
      expect(readFileSync(join(process.cwd(), f), 'utf-8'))
        .toContain('export const maxDuration = 300');
    }
  });

  it('la route tourne sur Node, en dynamique — jamais mise en cache', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/autopilot/rushes/[id]/analyse/route.ts'), 'utf-8',
    );
    expect(source).toContain("export const runtime = 'nodejs'");
    expect(source).toContain("export const dynamic = 'force-dynamic'");
  });

  it('ce lot n expose que POST — ni file d attente, ni worker', async () => {
    const module = await import('@/app/api/autopilot/rushes/[id]/analyse/route');
    expect(typeof module.POST).toBe('function');
    expect((module as Record<string, unknown>).GET).toBeUndefined();
    expect((module as Record<string, unknown>).DELETE).toBeUndefined();
  });
});
