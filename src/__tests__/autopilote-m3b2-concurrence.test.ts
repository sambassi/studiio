/**
 * M3-B2 — Le limiteur de concurrence n'a rien cassé.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE FICHIER N'EST PAS LE TEST DU LIMITEUR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le limiteur d'extractions concurrentes a ses propres tests, ailleurs
 * (`autopilote-m3b2-capacite.test.ts`). Ils répondent d'UNE question : est-ce
 * qu'il limite ? Ce fichier répond de l'autre, celle qu'un test de limiteur
 * ne pose jamais à lui-même : est-ce que les garanties déjà acquises du lot
 * tiennent encore MAINTENANT QU'IL EST LÀ ?
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA QUESTION CENTRALE : LE 429 NE DOIT PAS MANGER LE 409
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un refus de capacité (429) et un refus d'idempotence (409) se ressemblent
 * de loin — les deux disent « pas maintenant » — et ne veulent pas du tout
 * dire la même chose :
 *
 *   • 409 `analyse_active_existante` : CE rush a déjà une analyse en vol. Le
 *     client doit SUIVRE celle-là, dont l'identifiant lui est rendu. Relancer
 *     ne servirait à rien, jamais.
 *   • 429 `analyse_capacite_saturee` : le serveur est occupé AILLEURS. Il n'y
 *     a rien à suivre, et relancer plus tard est exactement la bonne conduite.
 *
 * Un limiteur posé trop tôt sur le chemin transforme silencieusement le
 * premier en second : l'écran affiche « réessayez » sur une analyse qui, en
 * réalité, tourne déjà — et la relance retombe sur le même refus, en boucle.
 * Le bug ne casse aucun test de limiteur, et aucun test d'idempotence n'y
 * passe non plus, puisque les deux sont écrits séparément. C'est le mode de
 * défaillance déjà rencontré sur ce lot avec `extraire` / `extraireRush` :
 * deux moitiés correctes qui ne se rencontrent nulle part.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ET LA SECONDE : UN REFUS DE CAPACITÉ NE DOIT RIEN RÉVÉLER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `POST /rushes/:id/analyse` répond 404 sur le rush d'autrui, délibérément :
 * un 403 confirmerait son existence. Si le limiteur s'acquiert AVANT la
 * vérification de propriété, alors sous saturation le rush d'autrui répond
 * 429 et le rush inexistant répond 404 — et la différence entre les deux
 * réponses devient un oracle d'existence. La politique « acquisition après
 * auth / propriété / vérification » n'est donc pas un détail d'ordre : c'est
 * ce qui tient l'isolation.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ÉCRIT AVANT LE MODULE QU'IL SURVEILLE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le limiteur est produit dans un autre arbre de travail. Ici il n'existe pas
 * encore. Comme dans `autopilote-m3b2-gros-fichiers.test.ts`, une GARDE qui
 * tourne toujours échoue tant que le module manque, en le nommant ; les blocs
 * qui en dépendent sont mis de côté par `skipIf`, pour n'avoir qu'un seul
 * échec lisible au lieu de vingt identiques.
 *
 * Les blocs qui ne dépendent QUE de l'existant — l'idempotence slot libre,
 * la cohérence d'états, les preuves statiques de la route, la rétention, le
 * plafond de vignettes — tournent dès maintenant, et sont précisément ceux
 * qui deviendront rouges si le limiteur casse quelque chose.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * COMMENT LE SLOT EST OCCUPÉ, SANS RIEN SUPPOSER DE L'API DU LIMITEUR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Aucun test ci-dessous n'appelle le limiteur. Le slot est occupé PAR LA
 * ROUTE ELLE-MÊME : une première requête dont le moteur injecté ne rend
 * jamais reste bloquée dans la mesure, donc tient le slot. C'est le seul
 * moyen d'écrire ces tests sans parier sur le nom d'une fonction ; et c'est
 * aussi le chemin réel, celui d'une extraction qui dure.
 *
 * ⚠️ Un test qui sature DOIT relâcher : le limiteur est un singleton de
 * module, un slot fuité empoisonnerait tous les tests suivants. Chaque test
 * saturant appelle son `relacher()`, et le bloc « canari » vérifie que le
 * slot est bien rendu.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE MOTEUR RÉEL N'EST PAS NEUTRALISÉ ICI — ET C'EST VOULU
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `autopilote-m3b2-route.test.ts` remplace `analyse/extraction` par un module
 * vide, pour que `definirMoteurExtraction(null)` signifie de nouveau « moteur
 * absent ». Ce fichier-ci n'a jamais besoin de simuler cette absence, et il a
 * en revanche besoin du VRAI module pour deux preuves : le plafond de huit
 * vignettes et le compartiment que le nettoyage balaie.
 *
 * Le moteur est donc toujours injecté avant chaque appel — jamais `null` —
 * de sorte qu'aucun ffmpeg ne démarre, sans avoir à neutraliser le module.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  definirMoteurExtraction,
  type DemandeExtraction, type ResultatExtraction,
} from '@/lib/autopilot/analyse/moteur';
import {
  VIGNETTES_MAX, BUCKET_VIGNETTES, positionsVignettes,
} from '@/lib/autopilot/analyse/extraction';

const authMock = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));

// ───────────────────────────────────────────────────────────────────────────
// La doublure PostgREST — reprise de `autopilote-m3b2-route.test.ts`
//
// Elle applique RÉELLEMENT les `.eq()` et les deux index uniques de
// `rush_analyses`. C'est ce qui permet de distinguer « la route s'est
// protégée par un `select` » de « la route a inséré et la BASE a refusé » —
// toute la question du 409 qu'un 429 ne doit pas remplacer.
// ───────────────────────────────────────────────────────────────────────────
interface Ligne { [k: string]: unknown }
let tables: Record<string, Ligne[]>;

/** Les insertions ACCEPTÉES. */
const insertions: Array<{ table: string; valeurs: Ligne }> = [];
/** Les insertions TENTÉES, refus de la base compris. */
const tentativesInsertion: Array<{ table: string; valeurs: Ligne }> = [];
const majEffectuees: Array<{ table: string; valeurs: Ligne }> = [];

const erreurTable = { code: '42P01', message: 'relation does not exist' };

function doublon(index: string) {
  return {
    code: '23505',
    message: `duplicate key value violates unique constraint "${index}"`,
  };
}

const etatActif = (e: unknown) => e === 'en_attente' || e === 'en_cours';

function refusUnicite(valeurs: Ligne): { code: string; message: string } | null {
  const lignes = tables.rush_analyses ?? [];
  const memeRush = lignes.filter((l) => l.rush_id === valeurs.rush_id);
  if (memeRush.some((l) => l.version === valeurs.version)) {
    return doublon('rush_analyses_rush_version_unique');
  }
  if (etatActif(valeurs.etat) && memeRush.some((l) => etatActif(l.etat))) {
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
    if (aInserer) {
      const valeurs: Ligne = { version: 1, etat: 'en_attente', ...aInserer };
      tentativesInsertion.push({ table, valeurs });
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
        etape: null, fournisseurs: {}, duree_secondes: null, technique: {},
        resume: null, textes_visibles: [], parole: {}, audio: {}, qualite: {},
        vignettes: [], usage: {}, motif_echec: null,
        created_at: maintenantIso(), updated_at: maintenantIso(),
        ...valeurs,
      };
      insertions.push({ table, valeurs });
      tables[table] = [...(tables[table] ?? []), ligne];
      return { data: ligne, error: null };
    }

    if (aMettreAJour) {
      const cibles = lignes();
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
    return { data: l.length ? l[0] : null, error: null };
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
    then: (resoudre: (v: unknown) => unknown) => resoudre(
      tables[table] === undefined
        ? { data: null, error: erreurTable }
        : { data: lignes(), error: null },
    ),
  };
  return api;
}

vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: (t: string) => requete(t) },
  supabase: { from: (t: string) => requete(t) },
}));

const { POST } = await import('@/app/api/autopilot/rushes/[id]/analyse/route');

// ───────────────────────────────────────────────────────────────────────────
// Le décor
// ───────────────────────────────────────────────────────────────────────────
const RUSH_DE_A: Ligne = {
  id: 'r-a', shoot_session_id: 's-a', user_id: 'A', bucket: 'media',
  cle_objet: 'A/rush/plan.mp4', nom_origine: 'plan.mp4', content_type: 'video/mp4',
  taille_octets: 5_000_000, duree_secondes: null, rang: 0, etat: 'verifie',
  metadata: {}, created_at: '2026-08-31T10:00:00Z', updated_at: '2026-08-31T10:00:00Z',
};
/** Un SECOND rush valide de A : la seule cible qu'un refus de capacité doit toucher. */
const RUSH_DE_A2: Ligne = { ...RUSH_DE_A, id: 'r-a2', cle_objet: 'A/rush/plan2.mp4' };
/** Un rush de A resté `indexe` : jamais analysable, saturation ou non. */
const RUSH_DE_A_NON_VERIFIE: Ligne = { ...RUSH_DE_A, id: 'r-a3', etat: 'indexe' };
const RUSH_DE_B: Ligne = {
  ...RUSH_DE_A, id: 'r-b', shoot_session_id: 's-b', user_id: 'B',
  cle_objet: 'B/rush/plan.mp4',
};

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
  vignettes: [{ bucket: 'media', cle: 'A/analyse/a-1/000.jpg', seconde: 0 }],
};

function appeler(rushId: string) {
  const req = new Request(`http://x/api/autopilot/rushes/${rushId}/analyse`, { method: 'POST' });
  return POST(req as never, { params: { id: rushId } });
}

function appelerAvecCorps(rushId: string, corps: unknown) {
  const req = new Request(`http://x/api/autopilot/rushes/${rushId}/analyse`, {
    method: 'POST', body: JSON.stringify(corps),
  });
  return POST(req as never, { params: { id: rushId } });
}

/** Une analyse déjà `en_cours` en base, posée SANS passer par la route. */
function analyseActiveEnBase(rushId = 'r-a'): Ligne {
  return {
    id: 'a-1', rush_id: rushId, user_id: 'A', version: 1, etat: 'en_cours',
    etape: 'extraction', fournisseurs: {}, duree_secondes: null, technique: {},
    resume: null, textes_visibles: [], parole: {}, audio: {}, qualite: {},
    vignettes: [], usage: {}, motif_echec: null,
    created_at: maintenantIso(), updated_at: maintenantIso(),
  };
}

/**
 * Occupe le slot d'extraction — par la route, jamais par le limiteur.
 *
 * Rend la fonction qui relâche. L'appeler est OBLIGATOIRE : le limiteur est
 * un singleton de module, et un slot fuité fausserait tous les tests suivants.
 */
async function saturer(rushId = 'r-a') {
  let libere!: () => void;
  const attente = new Promise<void>((r) => { libere = r; });
  definirMoteurExtraction(async (d) => {
    appelsMoteur.push(d);
    await attente;
    return EXTRACTION_OK;
  });
  const enVol = appeler(rushId);
  // On attend que la première ait ATTEINT le moteur : à ce moment elle a
  // forcément acquis le slot, puisque l'acquisition le précède.
  await vi.waitFor(() => expect(appelsMoteur.length).toBeGreaterThanOrEqual(1));
  definirMoteurExtraction(moteurQuiRend(EXTRACTION_OK));
  return async () => { libere(); await enVol; };
}

beforeEach(() => {
  insertions.length = 0;
  tentativesInsertion.length = 0;
  majEffectuees.length = 0;
  appelsMoteur = [];
  authMock.mockResolvedValue({ user: { id: 'A' } });
  // TOUJOURS un moteur injecté : sans cela la route chargerait le vrai module
  // et lancerait un ffmpeg contre un MinIO absent.
  definirMoteurExtraction(moteurQuiRend(EXTRACTION_OK));
  tables = {
    rushes: [
      { ...RUSH_DE_A }, { ...RUSH_DE_A2 }, { ...RUSH_DE_A_NON_VERIFIE }, { ...RUSH_DE_B },
    ],
    rush_analyses: [],
  };
});

afterEach(() => {
  definirMoteurExtraction(null);
});

// ───────────────────────────────────────────────────────────────────────────
// La garde
// ───────────────────────────────────────────────────────────────────────────
const MODULE_CAPACITE = 'src/lib/autopilot/analyse/capacite.ts';
const MODULE_ROUTE = 'src/app/api/autopilot/rushes/[id]/analyse/route.ts';

const chemin = (relatif: string) => join(process.cwd(), relatif);
const source = (relatif: string) => readFileSync(chemin(relatif), 'utf-8');
const sansCommentaires = (code: string) => code
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const capacitePresente = existsSync(chemin(MODULE_CAPACITE));

describe('Le limiteur de concurrence est bien là', () => {
  /**
   * Cette garde ÉCHOUE tant que le limiteur n'est pas intégré, et c'est le
   * signal voulu : sans elle, tous les blocs `skipIf` ci-dessous resteraient
   * silencieusement verts en ne vérifiant rien — pour toujours si le module
   * était un jour renommé.
   */
  it('le module de capacité existe', () => {
    expect(
      capacitePresente,
      `${MODULE_CAPACITE} absent — les preuves qui dépendent du limiteur sont `
      + 'mises de côté tant qu il manque. Si le module a été rangé ailleurs, '
      + 'corriger MODULE_CAPACITE ici plutôt que de supprimer cette garde.',
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. LE 429 NE MASQUE PAS LE 409
// ═══════════════════════════════════════════════════════════════════════════
describe('Un refus de capacité ne remplace jamais un refus d idempotence', () => {
  /**
   * LE TEST LE PLUS IMPORTANT DU FICHIER, et il tourne dès aujourd'hui.
   *
   * Le décor est celui qui se produit vraiment : une analyse est restée
   * `en_cours` en base — le processus qui la portait est mort, a été
   * redéployé, ou tourne sur une autre instance — et PLUS RIEN n'occupe le
   * slot local. Le limiteur laisse donc passer, et c'est la contrainte
   * PostgreSQL qui doit trancher.
   *
   * Un limiteur qui répondrait 429 ici enverrait « réessayez » sur une
   * situation qui ne se débloquera pas d'elle-même, et priverait le client de
   * l'identifiant de l'analyse à suivre.
   */
  it('analyse active en base + slot libre → 409 `analyse_active_existante`, jamais 429', async () => {
    tables.rush_analyses = [analyseActiveEnBase('r-a')];

    const r = await appeler('r-a');

    expect(r.status, 'un 429 ici masquerait le refus d idempotence').toBe(409);
    const corps = await r.json();
    expect(corps.motif).toBe('analyse_active_existante');
    expect(corps.motif).not.toBe('analyse_capacite_saturee');
    // Un `Retry-After` dirait « ça passera tout seul » : c'est faux ici.
    expect(r.headers.get('Retry-After')).toBeNull();
    // L'analyse gagnante est rendue : c'est elle que le client doit suivre.
    expect(corps.analyse).not.toBeNull();
    expect(corps.analyse.etat).toBe('en_cours');
  });

  it('le refus vient toujours de l INDEX UNIQUE, pas d une garde applicative', async () => {
    // La preuve : l'INSERT a été TENTÉ, et c'est la base qui l'a refusé. Un
    // limiteur qui se serait interposé aurait rendu sa réponse AVANT toute
    // tentative d'insertion — et ce compteur serait à zéro.
    tables.rush_analyses = [analyseActiveEnBase('r-a')];

    const r = await appeler('r-a');

    expect(r.status).toBe(409);
    expect(
      tentativesInsertion.filter((t) => t.table === 'rush_analyses'),
      'aucune tentative d insertion : le refus n est plus celui de la base',
    ).toHaveLength(1);
    expect(insertions).toHaveLength(0);
    expect(tables.rush_analyses).toHaveLength(1);
    expect(appelsMoteur).toHaveLength(0);
  });

  it('une analyse CLOSE ne déclenche ni 409 ni 429 — elle laisse relancer', async () => {
    tables.rush_analyses = [{ ...analyseActiveEnBase('r-a'), etat: 'echouee', motif_echec: 'timeout' }];
    const r = await appeler('r-a');
    expect(r.status).toBe(201);
    expect(insertions[0].valeurs.version).toBe(2);
  });

  it('une requête seule n est JAMAIS refusée pour capacité', async () => {
    // Le canari du fichier : si un slot a fuité d'un test précédent, c'est
    // ici qu'on le voit, et non dans un test sans rapport.
    const r = await appeler('r-a');
    expect(r.status, 'slot occupé alors que rien ne tourne — fuite de slot').toBe(201);
  });

  describe.skipIf(!capacitePresente)('sous saturation réelle', () => {
    /**
     * Le cas franchement concurrent : la première requête tient le slot, la
     * seconde vise LE MÊME rush.
     *
     * Les deux réponses sont défendables et le limiteur décide laquelle —
     * mais dans les deux cas trois invariants ne bougent pas : pas de 201,
     * une seule ligne, un seul appel au moteur. Et si c'est 429, il doit être
     * franc : rien créé, et une consigne de relance.
     *
     * ⚠️ C'est ici que se lit la tension entre les deux mécanismes. Un
     * limiteur global à un seul slot répondra 429, parce qu'il s'acquiert
     * avant `creerAnalyse` : l'idempotence n'a alors même pas la parole. Ce
     * n'est acceptable QUE parce que le cas « analyse active en base, slot
     * libre » — testé plus haut, sans garde — continue de rendre 409 : c'est
     * lui que voit un client qui relance, et lui qui porte l'information.
     */
    it('deux requêtes simultanées sur le MÊME rush : jamais un 201, jamais deux analyses', async () => {
      const relacher = await saturer('r-a');

      const seconde = await appeler('r-a');
      const corps = await seconde.json();

      expect(seconde.status, 'une seconde analyse du même rush a été acceptée').not.toBe(201);
      expect([409, 429]).toContain(seconde.status);
      if (seconde.status === 409) {
        expect(corps.motif).toBe('analyse_active_existante');
      } else {
        expect(corps.motif).toBe('analyse_capacite_saturee');
        expect(
          seconde.headers.get('Retry-After'),
          'un 429 sans Retry-After ne dit pas quand relancer',
        ).toBeTruthy();
        // Un refus de capacité n'écrit rien : il n'a même pas tenté.
        expect(tentativesInsertion.filter((t) => t.valeurs.rush_id === 'r-a')).toHaveLength(1);
      }

      await relacher();
      expect(tables.rush_analyses).toHaveLength(1);
      expect(appelsMoteur).toHaveLength(1);
    });

    it('une fois le slot rendu, le MÊME rush retrouve son 409 — pas un 429', async () => {
      // Le scénario du client qui relance après un refus. C'est la réponse
      // qu'il voit à ce moment-là qui décide de sa conduite, et elle doit
      // porter l'identifiant de l'analyse en cours, pas une invitation à
      // réessayer indéfiniment.
      tables.rush_analyses = [analyseActiveEnBase('r-a')];
      const relacher = await saturer('r-a2');
      await relacher();

      const r = await appeler('r-a');
      expect(r.status).toBe(409);
      expect((await r.json()).motif).toBe('analyse_active_existante');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. L'ISOLATION `user_id` NE BOUGE PAS SOUS SATURATION
// ═══════════════════════════════════════════════════════════════════════════
describe.skipIf(!capacitePresente)('Un refus de capacité ne révèle rien', () => {
  /**
   * Tous ces tests découlent d'UNE règle d'ordre : le slot s'acquiert APRÈS
   * l'authentification, la propriété et l'état d'ingestion. Chaque réponse
   * différente de celle du slot libre serait un canal par lequel un refus de
   * capacité renseigne l'appelant.
   */
  it('le rush d autrui reste 404 — jamais 429', async () => {
    const relacher = await saturer('r-a');
    const r = await appeler('r-b');
    expect(
      r.status,
      'un 429 sur le rush de B alors qu un rush inexistant rend 404 fait de la '
      + 'différence des deux codes un oracle d existence',
    ).toBe(404);
    expect((await r.json()).error).toBe('Rush introuvable');
    await relacher();
  });

  it('un rush inexistant rend EXACTEMENT la même réponse que celui d autrui', async () => {
    const relacher = await saturer('r-a');
    const inconnu = await appeler('r-inconnu');
    const autrui = await appeler('r-b');
    expect(inconnu.status).toBe(autrui.status);
    expect((await inconnu.json()).error).toBe((await autrui.json()).error);
    await relacher();
  });

  it('sans session, 401 — la capacité ne se consomme pas avant de savoir qui parle', async () => {
    const relacher = await saturer('r-a');
    authMock.mockResolvedValue(null);
    expect((await appeler('r-a2')).status).toBe(401);
    await relacher();
  });

  it('un champ interdit reste 422 — le corps est jugé avant la capacité', async () => {
    const relacher = await saturer('r-a');
    const r = await appelerAvecCorps('r-a2', { user_id: 'B' });
    expect(r.status).toBe(422);
    expect((await r.json()).error).toContain('user_id');
    await relacher();
  });

  it('un rush non vérifié reste 409 `rush_non_verifie` — jamais 429', async () => {
    // Il ne sera analysable ni maintenant ni plus tard : lui répondre
    // « réessayez » serait un mensonge sur la cause.
    const relacher = await saturer('r-a');
    const r = await appeler('r-a3');
    expect(r.status).toBe(409);
    const corps = await r.json();
    expect(corps.motif).toBe('rush_non_verifie');
    expect(corps.etat).toBe('indexe');
    await relacher();
  });

  it('un rush valide et LIBRE de l appelant, lui, est bien refusé pour capacité', async () => {
    // Le témoin du bloc. Sans lui, « tout rend autre chose que 429 » se
    // satisferait d'un limiteur qui ne limite rien.
    const relacher = await saturer('r-a');
    const r = await appeler('r-a2');
    expect(
      r.status,
      'aucun refus de capacité alors que le slot est occupé — le limiteur ne '
      + 'limite pas, et les tests ci-dessus ne prouvent plus rien',
    ).toBe(429);
    expect((await r.json()).motif).toBe('analyse_capacite_saturee');
    expect(r.headers.get('Retry-After')).toBeTruthy();
    await relacher();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. LES ÉTATS RESTENT COHÉRENTS
// ═══════════════════════════════════════════════════════════════════════════
describe('Aucune ligne ne reste active derrière une requête terminée', () => {
  /**
   * L'invariant qui protège le verrou d'unicité : une ligne abandonnée
   * `en_attente` ou `en_cours` occupe le slot d'unicité du rush POUR
   * TOUJOURS, et interdit toute relance sans intervention manuelle. Il tient
   * déjà ; le limiteur ne doit pas le défaire — notamment en sortant du
   * chemin par un `throw` après la création de la ligne.
   */
  const issues: Array<[string, unknown]> = [
    ['succès', EXTRACTION_OK],
    ['échec contrôlé', { ok: false, motif: 'timeout' }],
    ['échec définitif', { ok: false, motif: 'format_illisible' }],
    ['motif hors vocabulaire', { ok: false, motif: 'disque_plein' }],
    ['résultat inexploitable', { ok: true, dureeSecondes: 0, technique: {}, vignettes: [] }],
  ];

  it.each(issues)('après « %s », aucune analyse active ne subsiste', async (_nom, resultat) => {
    definirMoteurExtraction(moteurQuiRend(resultat));
    await appeler('r-a');
    const restantes = (tables.rush_analyses ?? []).filter((l) => etatActif(l.etat));
    expect(restantes, 'ligne abandonnée : le verrou d unicité reste pris').toEqual([]);
  });

  it('quand le moteur LÈVE, la ligne est close elle aussi', async () => {
    definirMoteurExtraction(async (d) => {
      appelsMoteur.push(d);
      throw new Error('ffmpeg a explosé');
    });
    const r = await appeler('r-a');
    expect(r.status).toBe(500);
    const ligne = (tables.rush_analyses ?? [])[0];
    expect(ligne.etat).toBe('echouee');
    expect(ligne.motif_echec).toBe('moteur_en_erreur');
  });

  describe.skipIf(!capacitePresente)('et un refus de capacité n écrit rien du tout', () => {
    it('un 429 ne laisse NI `en_attente` NI `en_cours` — parce qu il ne crée rien', async () => {
      const relacher = await saturer('r-a');
      const avant = (tables.rush_analyses ?? []).length;

      const r = await appeler('r-a2');
      expect(r.status).toBe(429);

      // Ni acceptée, ni même tentée : la ligne n'existe à aucun moment.
      expect(tentativesInsertion.filter((t) => t.valeurs.rush_id === 'r-a2')).toHaveLength(0);
      expect((tables.rush_analyses ?? []).length).toBe(avant);
      expect((tables.rush_analyses ?? []).filter((l) => l.rush_id === 'r-a2')).toEqual([]);

      await relacher();
    });

    it('le slot est rendu dans un `finally` — un refus 429 ne le retient pas', async () => {
      const relacher = await saturer('r-a');
      expect((await appeler('r-a2')).status).toBe(429);
      await relacher();
      // Le slot de la PREMIÈRE est rendu, et celui de la seconde n'a jamais
      // été pris : une relance doit passer.
      const r = await appeler('r-a2');
      expect(r.status, 'slot non rendu après un refus de capacité').toBe(201);
    });

    it('le slot est rendu même quand le moteur LÈVE', async () => {
      definirMoteurExtraction(async (d) => {
        appelsMoteur.push(d);
        throw new Error('ffmpeg a explosé');
      });
      expect((await appeler('r-a')).status).toBe(500);

      definirMoteurExtraction(moteurQuiRend(EXTRACTION_OK));
      const r = await appeler('r-a2');
      expect(
        r.status,
        'slot fuité sur exception : le serveur refuserait toute analyse jusqu au '
        + 'redémarrage. La libération doit être dans un `finally`.',
      ).toBe(201);
    });

    it('le slot est rendu quand la route sort en 409 après l avoir pris', async () => {
      // `analyse_active_existante` survient APRÈS l'acquisition. Sortir par ce
      // chemin sans relâcher condamnerait le serveur au premier doublon venu.
      tables.rush_analyses = [analyseActiveEnBase('r-a')];
      expect((await appeler('r-a')).status).toBe(409);

      const r = await appeler('r-a2');
      expect(r.status, 'slot fuité sur le chemin 409').toBe(201);
    });

    it('une analyse réussie rend le slot pour la suivante', async () => {
      expect((await appeler('r-a')).status).toBe(201);
      expect((await appeler('r-a2')).status).toBe(201);
      expect(tables.rush_analyses).toHaveLength(2);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. LES PREUVES DU LOT TIENNENT AVEC LE LIMITEUR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Les matérialisations connues du rush, et les imports refusés. Repris mot
 * pour mot de `autopilote-m3b2-gros-fichiers.test.ts` : deux listes du même
 * interdit divergeraient, mais celle-ci porte sur un module que l'autre ne
 * connaît pas encore, et l'étendre là-bas obligerait à toucher au fichier
 * d'un autre lot.
 */
const MATERIALISATIONS: Array<[string, RegExp]> = [
  ['.arrayBuffer()', /\.arrayBuffer\s*\(/],
  ['.blob()', /\.blob\s*\(/],
  ['.bytes()', /\.bytes\s*\(/],
  ['Buffer.concat', /Buffer\s*\.\s*concat\s*\(/],
  ['Buffer.from(await', /Buffer\s*\.\s*from\s*\(\s*await/],
  ['downloadMediaToBuffer', /downloadMediaToBuffer/],
  ['downloadMediaToFile', /downloadMediaToFile/],
  ['createWriteStream', /createWriteStream\s*\(/],
  ['writeFile', /\bwriteFile(Sync)?\s*\(/],
  ['getObject nu', /(?<!Partial)\bgetObject\s*\(/],
];

const CONCEPTS_INTERDITS = [
  'debiter_credits', 'credit_transactions', 'deductCredits',
  'scheduled_posts', 'anthropic', 'openai', 'replicate',
  'ANTHROPIC_API_KEY', 'REPLICATE_API_TOKEN',
];

const importsDe = (code: string) => [...new Set([
  ...[...code.matchAll(/from\s+'([^']+)'/g)].map((x) => x[1]),
  ...[...code.matchAll(/require\s*\(\s*'([^']+)'\s*\)/g)].map((x) => x[1]),
  ...[...code.matchAll(/import\s*\(\s*'([^']+)'\s*\)/g)].map((x) => x[1]),
])].sort();

describe('La route n a pas dérivé en accueillant le limiteur', () => {
  const code = sansCommentaires(source(MODULE_ROUTE));

  it('elle ne matérialise toujours le rush par aucun moyen connu', () => {
    for (const [nom, motif] of MATERIALISATIONS) {
      expect(code, `route : ${nom}`).not.toMatch(motif);
    }
  });

  it('elle ne touche toujours ni IA, ni débit, ni rendu, ni publication', () => {
    for (const interdit of [...CONCEPTS_INTERDITS, "from('rendus')", 'signed-url',
      'presignedGetObject', 'presignedPutObject', 'process.env', 'fetch(']) {
      expect(code, `route / ${interdit}`).not.toContain(interdit);
    }
  });

  it('elle appelle toujours le moteur par la couture, une seule fois', () => {
    expect(code).toContain('chargerMoteurExtraction');
    expect(
      [...code.matchAll(/await\s+moteur\s*\(/g)],
      'plus d un appel au moteur : une reprise cachée a été introduite',
    ).toHaveLength(1);
  });

  it('elle passe toujours au moteur la clé du rush LU', async () => {
    await appeler('r-a');
    expect(appelsMoteur).toHaveLength(1);
    expect(appelsMoteur[0].bucket).toBe('media');
    expect(appelsMoteur[0].cleObjet).toBe('A/rush/plan.mp4');
    expect(appelsMoteur[0].userId).toBe('A');
  });

  it('elle garde son `maxDuration` de 300 s', async () => {
    const { maxDuration } = await import('@/app/api/autopilot/rushes/[id]/analyse/route');
    // Plus court que le délai interne du moteur, le processus serait tué
    // pendant la mesure et l'analyse resterait `en_cours` pour toujours.
    expect(maxDuration).toBe(300);
  });
});

describe.skipIf(!capacitePresente)('Le module de capacité respecte les mêmes interdits', () => {
  const code = () => sansCommentaires(source(MODULE_CAPACITE));

  /**
   * La liste blanche d'imports, ÉTENDUE au limiteur.
   *
   * Elle est volontairement PLUS ÉTROITE que celle du moteur : un compteur de
   * slots n'a besoin ni de ffmpeg, ni de stockage, ni de base. S'il lui faut
   * autre chose, l'AJOUTER explicitement ici — et se demander d'abord
   * pourquoi.
   */
  const PREFIXES_AUTORISES = [
    './', '../',
    '@/lib/autopilot/',
    'node:timers/promises',
    'node:async_hooks',
    'next/server',
    'zod',
  ];

  const IMPORTS_REFUSES = [
    '@/lib/storage/fetch-media',
    '@/lib/db/supabase',
    '@ffmpeg/ffmpeg', '@ffmpeg/util', 'minio',
    'replicate', '@anthropic-ai/sdk', 'openai',
  ];

  it('il ne matérialise rien — un compteur de slots ne lit aucun octet', () => {
    for (const [nom, motif] of MATERIALISATIONS) {
      expect(code(), `capacite : ${nom}`).not.toMatch(motif);
    }
  });

  it('il n importe rien hors de la liste blanche', () => {
    const inattendus = importsDe(code()).filter(
      (spec) => !PREFIXES_AUTORISES.some((p) => spec === p || spec.startsWith(p)),
    );
    expect(
      inattendus,
      'import hors liste blanche dans le limiteur. Si l import est légitime, '
      + 'l AJOUTER explicitement à PREFIXES_AUTORISES — jamais élargir la règle.',
    ).toEqual([]);
  });

  it('il n importe aucun module interdit', () => {
    const importes = importsDe(code());
    for (const refuse of IMPORTS_REFUSES) {
      expect(importes, `capacite : ${refuse}`).not.toContain(refuse);
    }
  });

  it('il ne touche ni IA, ni débit, ni rendu, ni publication', () => {
    for (const interdit of CONCEPTS_INTERDITS) {
      expect(code(), `capacite / ${interdit}`).not.toContain(interdit);
    }
  });

  it('il n écrit dans AUCUNE table — la route reste seule à consigner', () => {
    // Un limiteur qui poserait sa propre ligne dans `rush_analyses` créerait
    // un second écrivain, et l'état de l'analyse ne serait plus décidé en un
    // seul endroit.
    expect(code()).not.toContain('rush_analyses');
    expect(code()).not.toMatch(/\.insert\s*\(/);
    expect(code()).not.toMatch(/supabaseAdmin/);
  });

  it('le plafond est déclaré, et vaut 1', () => {
    // Nommé en clair : un `1` littéral au milieu d'une condition ne se
    // retrouve pas quand il faut le changer.
    // Le nom réel choisi par le module : `MAX_EXTRACTIONS_SIMULTANEES`.
    // L'hypothèse écrite avant l'intégration disait `…_CONCURRENTES` — c'est
    // le test qu'on corrige, jamais la règle qu'on assouplit.
    expect(code(), 'plafond nommé introuvable').toContain('MAX_EXTRACTIONS_SIMULTANEES');
    // Nommé en clair ET valant 1 : un `1` littéral au milieu d'une condition
    // ne se retrouve pas quand il faut le changer.
    expect(code()).toMatch(/MAX_EXTRACTIONS_SIMULTANEES\s*=\s*1\b/);
  });
});

describe.skipIf(!capacitePresente)('L ordre du chemin est celui qui tient l isolation', () => {
  const code = sansCommentaires(source(MODULE_ROUTE));

  /**
   * Les symboles du limiteur, LUS dans l'import de la route.
   *
   * On ne devine pas leurs noms : on les prend là où ils sont écrits. Un test
   * qui parierait sur `acquerirSlot` échouerait pour la mauvaise raison le
   * jour où le module en face l'appelle autrement.
   */
  const ligneImport = /import\s*\{([^}]+)\}\s*from\s*'[^']*autopilot\/analyse\/capacite'/
    .exec(code);
  const symboles = (ligneImport?.[1] ?? '')
    .split(',').map((s) => s.trim().split(/\s+as\s+/).pop()!.trim()).filter(Boolean);

  it('la route importe bien le limiteur', () => {
    expect(
      ligneImport,
      'la route n importe rien depuis autopilot/analyse/capacite : le limiteur '
      + 'existe mais n est pas branché — exactement le mode de défaillance '
      + '`extraire` / `extraireRush` du lot.',
    ).not.toBeNull();
    expect(symboles.length).toBeGreaterThan(0);
  });

  it('l acquisition arrive APRÈS la vérification du rush et AVANT toute écriture', () => {
    // ⚠️ MESURÉ DANS LE CORPS DE `POST`, ET NON DANS TOUT LE FICHIER.
    //
    // La route a été découpée : le travail vit dans `executerAnalyse`, définie
    // AVANT `POST`. Comparer des positions à l'échelle du fichier comparait
    // donc l'ordre des déclarations, pas l'ordre d'exécution — la première
    // version de ce test échouait pour cette seule raison.
    const debutPost = code.indexOf('export async function POST');
    expect(debutPost, '`POST` introuvable').toBeGreaterThan(-1);
    const corpsPost = code.slice(debutPost);

    const posVerifie = corpsPost.indexOf("rush.etat !== 'verifie'");
    const posTravail = corpsPost.indexOf('executerAnalyse(');
    expect(posVerifie, "la garde `etat !== 'verifie'` a disparu").toBeGreaterThan(0);
    expect(posTravail, 'le travail n est plus appelé').toBeGreaterThan(posVerifie);

    const premiereUtilisation = Math.min(
      ...symboles.map((sym) => corpsPost.indexOf(sym)).filter((p) => p >= 0),
    );
    expect(
      premiereUtilisation,
      'le limiteur est sollicité avant la vérification de propriété / d état : '
      + 'sous saturation, le rush d autrui répondrait 429 là où un rush '
      + 'inexistant répond 404, et la différence renseignerait l appelant',
    ).toBeGreaterThan(posVerifie);
    expect(
      premiereUtilisation,
      'le limiteur est sollicité après le début du travail : une ligne serait '
      + 'créée puis abandonnée à chaque refus de capacité',
    ).toBeLessThan(posTravail);

    // Et la seule écriture reste bien DERRIÈRE l'appel au travail.
    expect(corpsPost.indexOf('creerAnalyse('), 'une écriture a lieu dans `POST` '
      + 'avant la prise de place').toBe(-1);
  });

  it('la libération est dans un `finally`', () => {
    const finallys = [...code.matchAll(/finally\s*\{/g)].map((m) => m.index ?? -1);
    expect(finallys.length, 'aucun `finally` : le slot fuite sur la première '
      + 'exception, et le serveur refuse tout jusqu au redémarrage').toBeGreaterThan(0);
    // On cherche la LIBÉRATION, pas un symbole importé : la place est un objet
    // local (`place.liberer()`), donc aucun symbole du module n'apparaît ici.
    const liberations = [...code.matchAll(/\.liberer\s*\(\s*\)/g)].map((m) => m.index ?? -1);
    expect(liberations.length, 'aucune libération').toBeGreaterThan(0);
    const dansUnFinally = liberations.some(
      (u) => finallys.some((f) => u > f && u - f < 400),
    );
    expect(dansUnFinally, 'la libération n est pas dans un `finally` : le slot '
      + 'fuite à la première exception, et le serveur refuse tout jusqu au '
      + 'redémarrage').toBe(true);
  });

  it('le motif et l en-tête de relance sont écrits en clair', () => {
    // Le motif vit dans une CONSTANTE du module de capacité, que la route
    // importe. C'est mieux qu'un littéral recopié — mais il faut alors
    // vérifier les deux bouts, sinon on ne vérifie plus rien.
    const capacite = sansCommentaires(source(MODULE_CAPACITE));
    expect(capacite, 'motif absent du module de capacité')
      .toContain("'analyse_capacite_saturee'");
    expect(code, 'la route n importe pas le motif').toContain('MOTIF_CAPACITE_SATUREE');
    expect(code, 'en-tête `Retry-After` absent : un 429 sans consigne de '
      + 'relance ne dit pas quand revenir').toContain('Retry-After');
    expect(code).toContain('429');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. LE PLAFOND DE VIGNETTES
// ═══════════════════════════════════════════════════════════════════════════
describe('Huit vignettes au plus, quoi qu il arrive', () => {
  it('le plafond déclaré vaut 8', () => {
    expect(VIGNETTES_MAX).toBe(8);
  });

  it.each([0.5, 1, 3, 7.9, 42.5, 600, 36_000])(
    'une durée de %s s ne produit jamais plus de 8 positions',
    (duree) => {
      const p = positionsVignettes(duree);
      expect(p.length).toBeLessThanOrEqual(VIGNETTES_MAX);
      // Et toutes DANS la vidéo : une position hors durée ferait échouer
      // ffmpeg sans que le plafond y soit pour quelque chose.
      for (const s of p) {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThan(duree);
      }
    },
  );

  it('une durée absurde ne produit AUCUNE position', () => {
    for (const duree of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(positionsVignettes(duree)).toEqual([]);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. LA RÉTENTION N'EST PAS AFFECTÉE
// ═══════════════════════════════════════════════════════════════════════════
describe('Le limiteur ne touche pas au sort des fichiers', () => {
  const CRON = 'src/app/api/cron/cleanup-media/route.ts';
  const nettoyage = source(CRON);

  it('le compartiment des vignettes est toujours balayé', () => {
    const balayes = /const buckets = \[([^\]]+)\]/.exec(nettoyage);
    expect(balayes).not.toBeNull();
    expect(balayes![1]).toContain(`'${BUCKET_VIGNETTES}'`);
  });

  it('l exemption du tournage et des analyses est toujours branchée', () => {
    expect(nettoyage).toContain('clesTournageEtAnalyses');
    // Illisible → 503, aucune suppression. Un ensemble vide se lirait « rien à
    // protéger » et laisserait tout supprimer.
    expect(nettoyage).toMatch(/tournageLu[\s\S]{0,400}status: 503/);
  });

  it('l exemption est toujours appliquée AVANT le calcul d expiration', () => {
    const posExemption = nettoyage.indexOf('clesTournage.has(cle)');
    const posExpiration = nettoyage.indexOf('const expiresAt = getExpiresAt');
    expect(posExemption).toBeGreaterThan(0);
    expect(posExpiration).toBeGreaterThan(posExemption);
  });

  it('le nettoyage ne connaît pas le limiteur — il n a rien à en savoir', () => {
    expect(sansCommentaires(nettoyage)).not.toContain('analyse/capacite');
  });

  describe.skipIf(!capacitePresente)('et un refus de capacité ne change rien à protéger', () => {
    it('un 429 ne crée aucune vignette, donc aucune clé nouvelle à exempter', async () => {
      const vignettesAvant = (tables.rush_analyses ?? [])
        .flatMap((l) => (Array.isArray(l.vignettes) ? l.vignettes : []));
      const relacher = await saturer('r-a');

      expect((await appeler('r-a2')).status).toBe(429);
      const vignettesApres = (tables.rush_analyses ?? [])
        .flatMap((l) => (Array.isArray(l.vignettes) ? l.vignettes : []));
      expect(vignettesApres).toEqual(vignettesAvant);

      await relacher();
    });
  });
});
