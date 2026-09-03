/**
 * M3-B3 — Le parcours d'analyse, de la lecture au clic, vignettes comprises.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER PROUVE, ET POURQUOI IL EST ÉCRIT AVANT LE CODE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * M3-B2 a donné le POST : « mesure ce rush ». Il ne dit rien de ce qui vient
 * après — comment un écran RETROUVE une analyse, comment il en SUIT une qui
 * tourne, et comment on REGARDE une vignette sans que l'objet devienne
 * public. Ce lot ajoute ces trois choses, dans trois arbres de travail :
 *
 *   lot A — `GET /api/autopilot/rushes/[id]/analyse` + l'accès authentifié
 *           aux vignettes (URL présignée courte, jamais stockée) ;
 *   lot B — le branchement dans `SessionsTournagePanel` : bouton, états,
 *           relance périodique bornée ;
 *   lot C — ce fichier, et lui seul.
 *
 * Les deux premiers n'existent pas ici. Ce fichier ne fait donc PAS semblant
 * de les valider : chaque bloc qui en dépend est précédé d'une GARDE qui
 * tourne toujours et qui ÉCHOUE en NOMMANT ce qui manque. Les assertions de
 * détail sont mises de côté par `skipIf`, pour n'avoir qu'un échec lisible au
 * lieu de vingt identiques.
 *
 * ⚠️ Un `skipIf` sans garde est le pire des pièges : un fichier renommé, des
 * tests silencieusement verts pour toujours, et personne pour s'en apercevoir.
 * La garde est ce qui l'empêche.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI TOURNE DÈS MAINTENANT, ET CE N'EST PAS RIEN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. AUCUNE URL DANS LA BASE. Le chemin d'analyse EXISTANT (le POST) est
 *    joué, et tout ce qu'il écrit est relu : pas une valeur persistée ne
 *    porte `http`, `X-Amz` ou un chemin public. C'est la moitié de la
 *    promesse « l'URL courte n'est jamais persistée » — celle qu'on peut
 *    déjà tenir.
 *
 * 2. LE TÉMOIN DE LA GARDE « AUCUN POST DANS UNE MINUTERIE ». Un détecteur
 *    qui ne se déclenche jamais « prouve » n'importe quoi. Deux composants
 *    jetables branchent donc un POST dans un `setInterval` — l'un
 *    synchrone, l'autre différé par un `await` — et on VÉRIFIE que le
 *    détecteur les attrape. Sans ce bloc, la garde du lot B serait une
 *    décoration.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA DOUBLURE POSTGREST EXPOSE `.lt()`, ET CE N'EST PAS FACULTATIF
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Depuis M3-B2.1, `creerAnalyse` récupère les analyses interrompues avec un
 * filtre `updated_at < seuil`. Une doublure qui n'expose que `eq/in/order`
 * lève « api.lt is not a function » : l'exception traverse tout, sort par le
 * `catch` global de la route, et TOUS les tests répondent 500 en accusant la
 * route. Le symptôme est spectaculaire et le coupable est ailleurs — d'où
 * les cinq comparateurs ci-dessous, repris de
 * `autopilote-m3b21-defaillances.test.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI LES REFUS DE VIGNETTE SONT ÉCRITS EN « CE QUI NE DOIT PAS SORTIR »
 * ─────────────────────────────────────────────────────────────────────────
 *
 * On ne sait pas quelle forme le lot A donnera à l'accès aux vignettes :
 * une route qui prend une clé et redirige vers une URL signée, une route qui
 * prend un rang, ou un relais qui recopie les octets. Un test qui exigerait
 * « 403 » choisirait le dessin à la place de son auteur, et virerait au rouge
 * pour une raison cosmétique.
 *
 * Les refus sont donc écrits sur le RÉSULTAT OBSERVABLE : la réponse ne doit,
 * d'aucune façon, donner accès à l'objet désigné par la clé étrangère — ni
 * l'exposer, ni le nommer dans une URL. Un refus explicite passe ; un service
 * qui ignore la clé et rend la sienne passe aussi ; un service qui signe la
 * clé d'autrui échoue. C'est exactement la propriété qu'on veut, et elle ne
 * dépend d'aucun choix de dessin.
 */
import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { createElement, useEffect } from 'react';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import {
  definirMoteurExtraction,
  type DemandeExtraction, type ResultatExtraction,
} from '@/lib/autopilot/analyse/moteur';
import {
  extractionsEnCours, reinitialiserCapacite,
} from '@/lib/autopilot/analyse/capacite';
import { vignettesValides } from '@/lib/autopilot/analyse/contrat';

/**
 * Un stockage joignable, pour que le signeur du lot A puisse SIGNER.
 *
 * `signeurInterne` et `signeurPublic` rendent `null` sans secret configuré,
 * et l'appelant traduit ce `null` en refus — le test « une vignette est
 * servie » échouerait alors pour une raison d'environnement, pas de code.
 * Aucune requête ne sort : la région est fixée dans les deux signeurs, donc
 * `presignedGetObject` signe hors ligne.
 */
process.env.STORAGE_PROVIDER = 's3';
process.env.MINIO_ACCESS_KEY = 'test-access';
process.env.MINIO_SECRET_KEY = 'test-secret';
process.env.MINIO_ENDPOINT = 'studiio-minio';
process.env.MINIO_PUBLIC_ENDPOINT = 'minio.exemple.test';

const authMock = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));
// Le panneau importe l'envoi de fichiers. Aucun test n'en téléverse : la
// doublure évite d'embarquer XHR et le découpage en morceaux pour rien.
vi.mock('@/lib/storage/uploadFile', () => ({ uploadFile: vi.fn() }));

/**
 * Le lecteur d'objets est une DOUBLURE — aucun serveur n'est joint.
 *
 * Le lot A sert les octets de la vignette au lieu de signer une URL. Sans
 * cette doublure, `getObject` tenterait une vraie connexion vers
 * `studiio-minio:9000`, échouerait, et la route rendrait 502 : le test
 * accuserait le stockage alors qu'il n'y a pas de stockage.
 *
 * On enregistre CE QUI EST OUVERT : c'est la preuve qui compte, bien plus
 * qu'un code HTTP — une clé arbitraire venue du navigateur ne doit jamais
 * apparaître ici.
 */
const objetsOuverts: Array<{ bucket: string; cle: string }> = [];
vi.mock('@/lib/storage/minio-client', async (original) => {
  const reel = await original<Record<string, unknown>>();
  const { Readable } = await import('stream');
  return {
    ...reel,
    lecteurMinio: () => ({
      async getObject(bucket: string, cle: string) {
        objetsOuverts.push({ bucket, cle });
        return Readable.from([Buffer.from('vignette-de-test')]);
      },
    }),
  };
});

// ═══════════════════════════════════════════════════════════════════════════
// LA DOUBLURE POSTGREST
// ═══════════════════════════════════════════════════════════════════════════
interface Ligne { [k: string]: unknown }

interface EcritureTentee {
  table: string;
  valeurs: Ligne;
  filtres: Array<[string, unknown]>;
}

let tables: Record<string, Ligne[]>;
/** Tout ce que le code a DEMANDÉ d'écrire — refus de la base compris. */
const ecrituresTentees: EcritureTentee[] = [];
let tableAbsente: string | null = null;

const erreurTable = { code: '42P01', message: 'relation does not exist' };
const etatActif = (e: unknown) => e === 'en_attente' || e === 'en_cours';

function doublon(index: string) {
  return {
    code: '23505',
    message: `duplicate key value violates unique constraint "${index}"`,
  };
}

function refusUnicite(valeurs: Ligne): { code: string; message: string } | null {
  const memeRush = (tables.rush_analyses ?? []).filter((l) => l.rush_id === valeurs.rush_id);
  if (memeRush.some((l) => l.version === valeurs.version)) {
    return doublon('rush_analyses_rush_version_unique');
  }
  if (etatActif(valeurs.etat) && memeRush.some((l) => etatActif(l.etat))) {
    return doublon('rush_analyses_active_unique');
  }
  return null;
}

/** Comparable, que la valeur arrive en `Date`, en ISO ou en nombre. */
function comparable(v: unknown): number | string {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const s = String(v ?? '');
  const t = Date.parse(s);
  return Number.isNaN(t) ? s : t;
}

function comparer(a: unknown, b: unknown): number {
  const x = comparable(a); const y = comparable(b);
  if (typeof x === 'number' && typeof y === 'number') return x - y;
  const sx = String(x); const sy = String(y);
  return sx < sy ? -1 : sx > sy ? 1 : 0;
}

function requete(table: string) {
  const filtres: Array<[string, unknown]> = [];
  const filtresIn: Array<[string, unknown[]]> = [];
  const comparaisons: Array<[string, string, unknown]> = [];
  let tri: { colonne: string; asc: boolean } | null = null;
  let limite: number | null = null;
  let aInserer: Ligne | null = null;
  let aMettreAJour: Ligne | null = null;
  let ecrites: Ligne[] = [];

  const passeComparaisons = (l: Ligne) => comparaisons.every(([c, op, v]) => {
    const d = comparer(l[c], v);
    if (op === 'lt') return d < 0;
    if (op === 'lte') return d <= 0;
    if (op === 'gt') return d > 0;
    if (op === 'gte') return d >= 0;
    if (op === 'neq') return d !== 0;
    return true;
  });

  const lignes = () => {
    if (tableAbsente === table) return null;
    let out = (tables[table] ?? []).filter(
      (l) => filtres.every(([c, v]) => l[c] === v)
        && filtresIn.every(([c, vs]) => vs.includes(l[c]))
        && passeComparaisons(l),
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
      ecrituresTentees.push({ table, valeurs, filtres: [] });
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
      const maintenant = new Date().toISOString();
      const ligne: Ligne = {
        id: `${table}-${(tables[table] ?? []).length + 1}`,
        etape: null, fournisseurs: {}, duree_secondes: null, technique: {},
        resume: null, textes_visibles: [], parole: {}, audio: {}, qualite: {},
        vignettes: [], usage: {}, motif_echec: null,
        created_at: maintenant, updated_at: maintenant,
        ...valeurs,
      };
      tables[table] = [...(tables[table] ?? []), ligne];
      ecrites = [ligne];
      return { data: ligne, error: null };
    }

    if (aMettreAJour) {
      const cibles = lignes() ?? [];
      // Enregistrée MÊME quand elle ne touche rien : une requête qui rate sa
      // cible reste une requête, et ce qu'elle voulait écrire est ce qu'on
      // relit pour prouver qu'aucune URL n'est passée par là.
      ecrituresTentees.push({ table, valeurs: aMettreAJour, filtres: [...filtres] });
      if (cibles.length === 0) { ecrites = []; return { data: null, error: null }; }
      const patch = aMettreAJour;
      const ids = new Set(cibles.map((l) => l.id));
      tables[table] = (tables[table] ?? []).map(
        (l) => (cibles.includes(l) ? { ...l, ...patch, updated_at: new Date().toISOString() } : l),
      );
      ecrites = (tables[table] ?? []).filter((l) => ids.has(l.id));
      return { data: ecrites[0] ?? null, error: null };
    }

    const l = lignes();
    return { data: l && l.length ? l[0] : null, error: null };
  };

  const api: Record<string, unknown> = {
    select: () => api,
    eq: (c: string, v: unknown) => { filtres.push([c, v]); return api; },
    // ⚠️ Les cinq comparateurs, SANS lesquels `updated_at < seuil` fait lever
    // la doublure et transforme trente tests en 500 qui accusent la route.
    neq: (c: string, v: unknown) => { comparaisons.push([c, 'neq', v]); return api; },
    lt: (c: string, v: unknown) => { comparaisons.push([c, 'lt', v]); return api; },
    lte: (c: string, v: unknown) => { comparaisons.push([c, 'lte', v]); return api; },
    gt: (c: string, v: unknown) => { comparaisons.push([c, 'gt', v]); return api; },
    gte: (c: string, v: unknown) => { comparaisons.push([c, 'gte', v]); return api; },
    in: (c: string, vs: unknown[]) => { filtresIn.push([c, vs]); return api; },
    order: (c: string, o?: { ascending?: boolean }) => {
      tri = { colonne: c, asc: o?.ascending !== false }; return api;
    },
    limit: (n: number) => { limite = n; return api; },
    insert: (valeurs: Ligne) => { aInserer = valeurs; return api; },
    update: (valeurs: Ligne) => { aMettreAJour = valeurs; return api; },
    maybeSingle: async () => executer(),
    single: async () => executer(),
    then: (resoudre: (v: unknown) => unknown) => {
      if (aInserer || aMettreAJour) {
        const res = executer() as { data: unknown; error: unknown };
        return resoudre(
          res.error ? { data: null, error: res.error } : { data: ecrites, error: null },
        );
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

// ═══════════════════════════════════════════════════════════════════════════
// LE DÉCOR
// ═══════════════════════════════════════════════════════════════════════════
const RUSH_DE_A: Ligne = {
  id: 'r-a', shoot_session_id: 's-a', user_id: 'A', bucket: 'media',
  cle_objet: 'A/rush/plan.mp4', nom_origine: 'plan.mp4', content_type: 'video/mp4',
  taille_octets: 5_000_000, duree_secondes: null, rang: 0, etat: 'verifie',
  metadata: {}, created_at: '2026-09-02T10:00:00Z', updated_at: '2026-09-02T10:00:00Z',
};
/** Indexé sans preuve : le POST le refuse, et l'écran ne doit rien proposer. */
const RUSH_DE_A_NON_VERIFIE: Ligne = { ...RUSH_DE_A, id: 'r-x', cle_objet: 'A/rush/x.mp4', etat: 'indexe', rang: 1 };
const RUSH_DE_B: Ligne = {
  ...RUSH_DE_A, id: 'r-b', shoot_session_id: 's-b', user_id: 'B',
  cle_objet: 'B/rush/plan.mp4',
};

const CLE_VIGNETTE_A = 'A/analyse/an-1/000.jpg';
const CLE_VIGNETTE_AUTRE_ANALYSE = 'A/analyse/an-9/000.jpg';
const CLE_VIGNETTE_DE_B = 'B/analyse/an-b/000.jpg';

function analyseEnBase(o: {
  id?: string; rushId?: string; userId?: string; version?: number;
  etat?: string; vignettes?: unknown[]; dureeSecondes?: number | null;
  technique?: Record<string, unknown>; motifEchec?: string | null;
} = {}): Ligne {
  const date = new Date().toISOString();
  return {
    id: o.id ?? 'an-1',
    rush_id: o.rushId ?? 'r-a',
    user_id: o.userId ?? 'A',
    version: o.version ?? 1,
    etat: o.etat ?? 'reussie',
    etape: 'extraction',
    fournisseurs: { extraction: { fournisseur: 'local', modele: 'ffmpeg' } },
    duree_secondes: o.dureeSecondes === undefined ? 42.5 : o.dureeSecondes,
    technique: o.technique ?? { largeur: 1080, hauteur: 1920, fps: 30, audio: true },
    resume: null, textes_visibles: [], parole: {}, audio: {}, qualite: {},
    vignettes: o.vignettes ?? [{ bucket: 'media', cle: CLE_VIGNETTE_A, seconde: 0 }],
    usage: {}, motif_echec: o.motifEchec ?? null,
    created_at: date, updated_at: date,
  };
}

const EXTRACTION_OK: ResultatExtraction = {
  ok: true,
  dureeSecondes: 42.5,
  technique: { largeur: 1080, hauteur: 1920, fps: 30, audio: true },
  vignettes: [{ bucket: 'media', cle: CLE_VIGNETTE_A, seconde: 0 }],
};

let appelsMoteur: DemandeExtraction[] = [];
function moteurQuiRend(resultat: unknown) {
  return async (demande: DemandeExtraction) => {
    appelsMoteur.push(demande);
    return resultat as ResultatExtraction;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CE QUE CE FICHIER ATTEND DES LOTS A ET B
// ═══════════════════════════════════════════════════════════════════════════
const FICHIER_ROUTE_ANALYSE = 'src/app/api/autopilot/rushes/[id]/analyse/route.ts';
const FICHIER_PANNEAU = 'src/components/creer/SessionsTournagePanel.tsx';
const RACINE_API_AUTOPILOTE = 'src/app/api/autopilot';
/**
 * Le module de signature, si le lot A en fait un plutôt qu'une route.
 *
 * HYPOTHÈSE sur son nom, et elle est là pour être vue : si le lot A l'appelle
 * autrement, c'est CETTE liste qu'on élargit — jamais la garde qu'on
 * supprime.
 */
const MODULES_VIGNETTES_POSSIBLES = [
  'src/lib/autopilot/analyse/vignettes.ts',
  'src/lib/autopilot/analyse/vignette.ts',
  'src/lib/autopilot/analyse/apercus.ts',
];

const chemin = (relatif: string) => join(process.cwd(), relatif);
const present = (relatif: string) => existsSync(chemin(relatif));
const lire = (relatif: string) => (present(relatif) ? readFileSync(chemin(relatif), 'utf-8') : '');
const sansCommentaires = (code: string) => code
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

/** Toutes les `route.ts` sous l'API autopilote, en chemins relatifs au dépôt. */
function routesAutopilote(): string[] {
  const sortie: string[] = [];
  const parcourir = (relatif: string) => {
    const abs = chemin(relatif);
    if (!existsSync(abs)) return;
    for (const entree of readdirSync(abs)) {
      const sous = `${relatif}/${entree}`;
      if (statSync(chemin(sous)).isDirectory()) parcourir(sous);
      else if (entree === 'route.ts' || entree === 'route.tsx') sortie.push(sous);
    }
  };
  parcourir(RACINE_API_AUTOPILOTE);
  return sortie;
}

/**
 * Le mécanisme de vignettes, cherché par ce qu'il DÉSIGNE, pas par un nom
 * qu'on aurait décidé à la place du lot A.
 *
 * Une route dont le CHEMIN porte « vignette » — quelle que soit sa
 * profondeur, ses segments dynamiques et son verbe — ou, à défaut, un module
 * de signature parmi les noms plausibles ci-dessus.
 */
const ROUTES_VIGNETTES = routesAutopilote().filter((r) => /vignette|apercu/i.test(r));
const MODULES_VIGNETTES = MODULES_VIGNETTES_POSSIBLES.filter(present);
const ROUTE_VIGNETTE = ROUTES_VIGNETTES[0] ?? null;
const mecanismeVignettes = ROUTES_VIGNETTES.length > 0 || MODULES_VIGNETTES.length > 0;

/** Les sources du lot A, quelles qu'elles soient, pour les preuves statiques. */
const SOURCES_VIGNETTES = [...ROUTES_VIGNETTES, ...MODULES_VIGNETTES];

const routeAnalyse = await import('@/app/api/autopilot/rushes/[id]/analyse/route');
const POST = (routeAnalyse as Record<string, unknown>).POST as
  (req: unknown, ctx: { params: { id: string } }) => Promise<Response>;
const GET = (routeAnalyse as Record<string, unknown>).GET as
  | ((req: unknown, ctx: { params: { id: string } }) => Promise<Response>)
  | undefined;
const getPresent = typeof GET === 'function';

/**
 * Le panneau est-il branché sur l'analyse ?
 *
 * Cherché sur l'URL — `/analyse` — et non sur un nom d'état ou de fonction :
 * l'URL est la seule partie du lot B dont on peut fixer le nom à l'avance,
 * puisqu'elle est décidée par le lot A.
 */
/**
 * Le panneau est branché — directement, ou en DÉLÉGUANT.
 *
 * La première rédaction exigeait que le fichier du panneau mentionne
 * lui-même une URL `/analyse`. Le lot B a mieux fait : il a monté un
 * composant dédié par rush et rangé tout le réseau dans une passerelle —
 * le panneau ne connaît aucune URL, et c'est précisément la bonne
 * architecture. Exiger l'URL dans ce fichier revenait à imposer un dessin.
 *
 * Ce qui compte est que le chemin d'écran EXISTE : soit le panneau parle
 * lui-même à l'analyse, soit il monte quelque chose qui le fait.
 */
const panneauSource = sansCommentaires(lire(FICHIER_PANNEAU));
const panneauIntegre = /\/analyse/.test(panneauSource)
  || (/[Aa]nalyse/.test(panneauSource)
      && ['src/components/creer/AnalyseRush.tsx',
          'src/lib/autopilot/analyse/passerelle.ts']
        .some((f) => /\/analyse/.test(sansCommentaires(lire(f)))));

describe('Ce que ce fichier attend des lots A et B', () => {
  it('la route d analyse exporte GET — c est le lot A', () => {
    expect(
      getPresent,
      `${FICHIER_ROUTE_ANALYSE} doit exporter GET : sans lui, un écran ne peut `
      + 'ni retrouver une analyse après rechargement, ni en suivre une qui tourne.',
    ).toBe(true);
  });

  it('un accès authentifié aux vignettes existe — c est le lot A', () => {
    expect(
      mecanismeVignettes,
      'Aucun accès aux vignettes trouvé. Attendu : une route sous '
      + `${RACINE_API_AUTOPILOTE} dont le chemin porte « vignette », ou l un de `
      + `ces modules : ${MODULES_VIGNETTES_POSSIBLES.join(', ')}. `
      + 'Si le lot A l a nommé autrement, élargir la recherche ici — jamais retirer la garde.',
    ).toBe(true);
  });

  it('le panneau de tournage appelle l analyse — c est le lot B', () => {
    expect(
      panneauIntegre,
      `${FICHIER_PANNEAU} ne mentionne aucune URL « /analyse » : le parcours `
      + 'écran du lot B n est pas branché.',
    ).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// OUTILS DE LECTURE DES RÉPONSES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tout ce qu'une réponse laisse voir : son statut, ses en-têtes, son corps.
 *
 * Une redirection met l'URL dans `Location`, un JSON la met dans le corps, un
 * relais ne met rien du tout. Les trois passent par ici, et les assertions
 * portent sur le tout.
 */
async function toutCeQueLaReponseMontre(res: Response): Promise<string> {
  const entetes = [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n');
  let corps = '';
  try { corps = await res.clone().text(); } catch { corps = ''; }
  return `${res.status}\n${entetes}\n${corps}`;
}

const URL_ABSOLUE = /https?:\/\/[^\s"'<>)\\]+/g;
const MARQUEURS_SIGNATURE = ['x-amz-signature', 'x-amz-credential', 'token=', 'signature=', 'sig='];
/** Le chemin qu'aucune réponse ne doit contenir : il ne périme jamais. */
const CHEMIN_PUBLIC_SUPABASE = '/storage/v1/object/public/';

function urlsAbsolues(texte: string): string[] {
  return texte.match(URL_ABSOLUE) ?? [];
}

function urlSignee(url: string): boolean {
  const bas = url.toLowerCase();
  return MARQUEURS_SIGNATURE.some((m) => bas.includes(m));
}

/** Aucune URL rendue ne doit être atteignable demain. */
function exigerAucuneUrlPermanente(texte: string, ou: string) {
  expect(texte.includes(CHEMIN_PUBLIC_SUPABASE), `${ou} : chemin public rendu`).toBe(false);
  for (const url of urlsAbsolues(texte)) {
    expect(urlSignee(url), `${ou} : URL sans signature — « ${url} »`).toBe(true);
  }
}

/** Le TTL annoncé par une URL signée AWS, quand il y en a une. */
function ttlsAnnonces(texte: string): number[] {
  return [...texte.matchAll(/[?&]X-Amz-Expires=(\d+)/gi)].map((m) => Number(m[1]));
}

/** Toutes les chaînes d'un objet, à n'importe quelle profondeur. */
function chainesProfondes(valeur: unknown, sortie: string[] = []): string[] {
  if (typeof valeur === 'string') sortie.push(valeur);
  else if (Array.isArray(valeur)) valeur.forEach((v) => chainesProfondes(v, sortie));
  else if (valeur && typeof valeur === 'object') {
    Object.values(valeur as Record<string, unknown>).forEach((v) => chainesProfondes(v, sortie));
  }
  return sortie;
}

/** Ce qui a été DEMANDÉ à la base, à plat — refus compris. */
function toutCeQuOnAVouluEcrire(): string[] {
  return ecrituresTentees.flatMap((e) => chainesProfondes(e.valeurs));
}

function exigerAucuneUrlEnBase(ou: string) {
  for (const valeur of toutCeQuOnAVouluEcrire()) {
    const bas = valeur.toLowerCase();
    expect(bas.includes('http://') || bas.includes('https://'), `${ou} : URL écrite en base — « ${valeur} »`).toBe(false);
    expect(bas.includes('x-amz-'), `${ou} : signature écrite en base — « ${valeur} »`).toBe(false);
    expect(bas.includes(CHEMIN_PUBLIC_SUPABASE), `${ou} : chemin public écrit en base`).toBe(false);
  }
}

/**
 * Les analyses d'une réponse GET.
 *
 * HYPOTHÈSE sur le lot A : `{ ok, analyses: [...] }`, du pluriel de
 * `listerAnalyses`. La forme singulière est acceptée parce qu'elle est le
 * seul autre dessin raisonnable. Toute autre forme lève, en la nommant : ce
 * fichier ne devine pas en silence.
 */
function analysesDeLaReponse(corps: Record<string, unknown>): Array<Record<string, unknown>> {
  if (Array.isArray(corps.analyses)) return corps.analyses as Array<Record<string, unknown>>;
  if (corps.analyse === null) return [];
  if (corps.analyse && typeof corps.analyse === 'object') {
    return [corps.analyse as Record<string, unknown>];
  }
  throw new Error(
    'HYPOTHÈSE À CORRIGER : GET doit rendre « analyses » (tableau) ou « analyse ». '
    + `Reçu : ${JSON.stringify(corps)}`,
  );
}

const requeteGet = (rushId: string, requeteUrl = '') => new Request(
  `http://x/api/autopilot/rushes/${rushId}/analyse${requeteUrl}`,
);
const appelerGet = (rushId: string, requeteUrl = '') => (
  GET!(requeteGet(rushId, requeteUrl) as never, { params: { id: rushId } })
);
const appelerPost = (rushId: string) => POST(
  new Request(`http://x/api/autopilot/rushes/${rushId}/analyse`, { method: 'POST' }) as never,
  { params: { id: rushId } },
);

// ═══════════════════════════════════════════════════════════════════════════
// LE DÉCOR, REMONTÉ AVANT CHAQUE TEST
// ═══════════════════════════════════════════════════════════════════════════
beforeEach(() => {
  ecrituresTentees.length = 0;
  appelsMoteur = [];
  tableAbsente = null;
  authMock.mockResolvedValue({ user: { id: 'A' } });
  // TOUJOURS un moteur injecté : sans cela la route chargerait le vrai module
  // et lancerait ffmpeg contre un MinIO absent.
  definirMoteurExtraction(moteurQuiRend(EXTRACTION_OK));
  reinitialiserCapacite();
  tables = {
    rushes: [{ ...RUSH_DE_A }, { ...RUSH_DE_A_NON_VERIFIE }, { ...RUSH_DE_B }],
    rush_analyses: [],
  };
});

afterEach(() => {
  cleanup();
  // La place d'extraction est rendue quoi qu'il arrive : une place fuitée est
  // invisible sur le test qui la fuit et fait échouer tous les suivants.
  expect(extractionsEnCours(), 'place d extraction NON rendue').toBe(0);
  definirMoteurExtraction(null);
  reinitialiserCapacite();
  vi.useRealTimers();
});

// ═══════════════════════════════════════════════════════════════════════════
// BLOC 1 — GET : retrouver une analyse
// ═══════════════════════════════════════════════════════════════════════════
describe.skipIf(!getPresent)('GET — retrouver l analyse d un rush', () => {
  it('sans session : 401, et rien d autre', async () => {
    authMock.mockResolvedValue(null);
    const res = await appelerGet('r-a');
    expect(res.status).toBe(401);
    expect(ecrituresTentees, 'un GET non authentifié n écrit rien').toEqual([]);
  });

  it('rush inexistant : 404', async () => {
    const res = await appelerGet('r-inconnu');
    expect(res.status).toBe(404);
  });

  it('rush d autrui : 404 — jamais 403, qui confirmerait son existence', async () => {
    tables.rush_analyses = [analyseEnBase({ id: 'an-b', rushId: 'r-b', userId: 'B' })];
    const res = await appelerGet('r-b');
    expect(res.status).toBe(404);
    const vu = await toutCeQueLaReponseMontre(res);
    expect(vu.includes('B/rush/plan.mp4'), 'la clé du rush d autrui a fuité').toBe(false);
    expect(vu.includes('an-b'), 'l identifiant de l analyse d autrui a fuité').toBe(false);
  });

  it('rush sans aucune analyse : 200 et une liste vide — pas un 404', async () => {
    const res = await appelerGet('r-a');
    expect(res.status).toBe(200);
    const corps = await res.json();
    expect(corps.ok).toBe(true);
    expect(analysesDeLaReponse(corps)).toEqual([]);
  });

  it('une analyse en cours est rendue avec son état', async () => {
    tables.rush_analyses = [analyseEnBase({ etat: 'en_cours', dureeSecondes: null, technique: {} })];
    const res = await appelerGet('r-a');
    expect(res.status).toBe(200);
    const [analyse] = analysesDeLaReponse(await res.json());
    expect(analyse.etat).toBe('en_cours');
    expect(analyse.id).toBe('an-1');
  });

  it('une analyse réussie rend la mesure — durée et technique', async () => {
    tables.rush_analyses = [analyseEnBase({ etat: 'reussie' })];
    const [analyse] = analysesDeLaReponse(await (await appelerGet('r-a')).json());
    expect(analyse.etat).toBe('reussie');
    expect(analyse.dureeSecondes ?? analyse.duree_secondes).toBe(42.5);
    expect(JSON.stringify(analyse.technique)).toContain('1080');
  });

  it('socle absent : 503 et un motif, jamais un 500 anonyme', async () => {
    tableAbsente = 'rush_analyses';
    const res = await appelerGet('r-a');
    expect(res.status).toBe(503);
    const corps = await res.json();
    expect(corps.ok).toBe(false);
    expect(corps.motif).toBe('socle_absent');
  });

  it('la lecture ne rend AUCUNE clé de stockage ni URL permanente', async () => {
    tables.rush_analyses = [analyseEnBase({ etat: 'reussie' })];
    const res = await appelerGet('r-a');
    const vu = await toutCeQueLaReponseMontre(res);
    exigerAucuneUrlPermanente(vu, 'GET analyse');
    expect(vu.includes(CLE_VIGNETTE_A), 'la clé brute de la vignette est sortie').toBe(false);
  });

  it('une lecture n écrit rien : GET ne crée ni ne clôt aucune analyse', async () => {
    tables.rush_analyses = [analyseEnBase({ etat: 'en_cours' })];
    await appelerGet('r-a');
    expect(ecrituresTentees, 'GET a écrit en base').toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BLOC 2 — Les vignettes : ce qui sort, et surtout ce qui ne sort pas
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Appelle le mécanisme de vignettes du lot A, quel qu'il soit.
 *
 * La clé est passée sous plusieurs noms de paramètre À LA FOIS. Pour un refus
 * c'est un durcissement : si l'un des noms est honoré, il doit l'être en
 * refusant. Pour un succès, c'est sans effet — les noms inconnus sont ignorés.
 *
 * Les segments dynamiques du chemin sont remplis d'après leur nom : `id` est
 * le rush, tout ce qui ressemble à un rang vaut `0`, le reste prend
 * l'identifiant de l'analyse. Une hypothèse de plus, nommée.
 */
async function demanderVignette(o: {
  rushId: string; analyseId: string; cle: string; bucket?: string; rang?: number;
}): Promise<Response> {
  if (!ROUTE_VIGNETTE) throw new Error('aucune route de vignette découverte');
  const specificateur = ['..', ...ROUTE_VIGNETTE.split('/').slice(1)]
    .join('/').replace(/\.tsx?$/, '');
  // Écrit en clair, cet import serait résolu par Vite À LA TRANSFORMATION,
  // donc bien avant que `skipIf` ait son mot à dire : le fichier entier
  // échouerait à charger tant que le lot A manque.
  const mod = await (import(/* @vite-ignore */ specificateur) as Promise<Record<string, unknown>>);
  const handler = mod.GET as ((req: unknown, ctx: unknown) => Promise<Response>) | undefined;
  if (typeof handler !== 'function') {
    throw new Error(`${ROUTE_VIGNETTE} doit exporter GET`);
  }
  // ⚠️ LE SEGMENT PRÉCÉDENT DÉCIDE, PAS LE NOM DU PARAMÈTRE.
  //
  // La première rédaction lisait le nom : `id` → rush, `index|rang|position`
  // → un entier, le reste → analyse. Le lot A a nommé sa route
  // `analyses/[id]/vignettes/[n]` : `id` y désigne l'ANALYSE et `n` l'index.
  // La règle par nom donnait donc exactement l'inverse des deux, et une
  // requête parfaitement légitime rendait 404.
  //
  // Le segment qui précède, lui, dit ce que la valeur désigne — c'est la
  // convention de toute route REST, et elle ne dépend d'aucun nom choisi.
  const params: Record<string, string> = {};
  const segments = ROUTE_VIGNETTE.split('/');
  segments.forEach((segment, i) => {
    const m = segment.match(/^\[\.{0,3}(.+?)\]$/);
    if (!m) return;
    const nom = m[1];
    const precedent = (segments[i - 1] ?? '').toLowerCase();
    if (/vignette|apercu|image/.test(precedent)) params[nom] = String(o.rang ?? 0);
    else if (/analyse/.test(precedent)) params[nom] = o.analyseId;
    else if (/rush/.test(precedent)) params[nom] = o.rushId;
    // Sans contexte utilisable, on retombe sur le nom.
    else if (/^(id|rushId|rush)$/i.test(nom)) params[nom] = o.rushId;
    else if (/(index|rang|position|seconde|^n$)/i.test(nom)) params[nom] = String(o.rang ?? 0);
    else params[nom] = o.analyseId;
  });
  const query = new URLSearchParams({
    cle: o.cle, key: o.cle, path: o.cle, objet: o.cle, vignette: o.cle,
    bucket: o.bucket ?? 'media', analyseId: o.analyseId,
  });
  const url = `http://x/api/autopilot/vignette?${query.toString()}`;
  return handler(new Request(url) as never, { params });
}

describe.skipIf(!ROUTE_VIGNETTE)('Les vignettes — un accès court, jamais un droit durable', () => {
  beforeEach(() => {
    tables.rush_analyses = [
      analyseEnBase({ id: 'an-1', etat: 'reussie' }),
      analyseEnBase({
        id: 'an-9', rushId: 'r-a', version: 2, etat: 'reussie',
        vignettes: [{ bucket: 'media', cle: CLE_VIGNETTE_AUTRE_ANALYSE, seconde: 0 }],
      }),
      analyseEnBase({
        id: 'an-b', rushId: 'r-b', userId: 'B', etat: 'reussie',
        vignettes: [{ bucket: 'media', cle: CLE_VIGNETTE_DE_B, seconde: 0 }],
      }),
    ];
  });

  it('une vignette de l analyse demandée est servie', async () => {
    const res = await demanderVignette({ rushId: 'r-a', analyseId: 'an-1', cle: CLE_VIGNETTE_A });
    expect(
      res.status >= 200 && res.status < 400,
      `une vignette légitime doit être servie — reçu ${res.status}`,
    ).toBe(true);
  });

  it('sans session, rien n est servi', async () => {
    authMock.mockResolvedValue(null);
    const res = await demanderVignette({ rushId: 'r-a', analyseId: 'an-1', cle: CLE_VIGNETTE_A });
    expect(res.status).toBe(401);
  });

  it('la clé d un AUTRE UTILISATEUR ne donne accès à rien', async () => {
    const res = await demanderVignette({ rushId: 'r-a', analyseId: 'an-1', cle: CLE_VIGNETTE_DE_B });
    const vu = await toutCeQueLaReponseMontre(res);
    expect(vu.includes(CLE_VIGNETTE_DE_B), 'la clé de B a été servie ou nommée').toBe(false);
  });

  it('la clé d une AUTRE ANALYSE du même utilisateur ne donne accès à rien', async () => {
    const res = await demanderVignette({ rushId: 'r-a', analyseId: 'an-1', cle: CLE_VIGNETTE_AUTRE_ANALYSE });
    const vu = await toutCeQueLaReponseMontre(res);
    expect(
      vu.includes(CLE_VIGNETTE_AUTRE_ANALYSE),
      'une clé étrangère à l analyse demandée a été servie',
    ).toBe(false);
  });

  it('un compartiment arbitraire est refusé', async () => {
    const res = await demanderVignette({
      rushId: 'r-a', analyseId: 'an-1', cle: CLE_VIGNETTE_A, bucket: 'secrets',
    });
    const vu = await toutCeQueLaReponseMontre(res);
    expect(vu.includes('secrets'), 'un compartiment hors liste blanche est sorti').toBe(false);
  });

  it('« .. » est refusé — un chemin qui remonte désigne l espace d autrui', async () => {
    const res = await demanderVignette({
      rushId: 'r-a', analyseId: 'an-1', cle: 'A/analyse/an-1/../../../B/rush/plan.mp4',
    });
    const vu = await toutCeQueLaReponseMontre(res);
    expect(vu.includes('..'), 'un chemin remontant est sorti tel quel').toBe(false);
    expect(vu.includes('B/rush'), 'l espace de B a été atteint').toBe(false);
  });

  it('aucune URL permanente n est rendue', async () => {
    const res = await demanderVignette({ rushId: 'r-a', analyseId: 'an-1', cle: CLE_VIGNETTE_A });
    exigerAucuneUrlPermanente(await toutCeQueLaReponseMontre(res), 'vignette');
  });

  it('quand une URL signée est rendue, elle expire en 5 minutes au plus', async () => {
    const res = await demanderVignette({ rushId: 'r-a', analyseId: 'an-1', cle: CLE_VIGNETTE_A });
    const ttls = ttlsAnnonces(await toutCeQueLaReponseMontre(res));
    // Aucune URL signée : le lot A relaie les octets. Rien à borner ici — la
    // preuve statique plus bas couvre ce cas.
    for (const ttl of ttls) {
      expect(ttl, `TTL de vignette trop long : ${ttl} s`).toBeLessThanOrEqual(300);
    }
  });

  it('l URL courte n est JAMAIS écrite en base', async () => {
    ecrituresTentees.length = 0;
    await demanderVignette({ rushId: 'r-a', analyseId: 'an-1', cle: CLE_VIGNETTE_A });
    exigerAucuneUrlEnBase('après signature d une vignette');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BLOC 3 — Aucune URL durable, nulle part. Ce bloc tourne DÈS MAINTENANT.
// ═══════════════════════════════════════════════════════════════════════════
const MODULES_CHEMIN_ANALYSE = [
  'src/lib/autopilot/analyse/contrat.ts',
  'src/lib/autopilot/analyse/service.ts',
  'src/lib/autopilot/analyse/moteur.ts',
  'src/lib/autopilot/analyse/extraction.ts',
  FICHIER_ROUTE_ANALYSE,
];

describe('Aucune URL durable — ni dans le code, ni dans la base', () => {
  it('aucun module du chemin d analyse ne fabrique un chemin public', () => {
    for (const module of MODULES_CHEMIN_ANALYSE.filter(present)) {
      expect(
        sansCommentaires(lire(module)).includes(CHEMIN_PUBLIC_SUPABASE),
        `${module} fabrique une URL publique`,
      ).toBe(false);
    }
  });

  it.skipIf(SOURCES_VIGNETTES.length === 0)(
    'les sources du lot A ne fabriquent aucun chemin public',
    () => {
      for (const module of SOURCES_VIGNETTES) {
        expect(
          sansCommentaires(lire(module)).includes(CHEMIN_PUBLIC_SUPABASE),
          `${module} fabrique une URL publique`,
        ).toBe(false);
      }
    },
  );

  it.skipIf(SOURCES_VIGNETTES.length === 0)(
    'aucune durée de signature du lot A ne dépasse 300 s',
    () => {
      for (const module of SOURCES_VIGNETTES) {
        const lignes = sansCommentaires(lire(module)).split('\n');
        for (const ligne of lignes) {
          if (!/presigned|signedurl|expires|ttl/i.test(ligne)) continue;
          for (const brut of ligne.match(/\b\d{2,8}\b/g) ?? []) {
            expect(
              Number(brut),
              `${module} : durée de signature trop longue — « ${ligne.trim()} »`,
            ).toBeLessThanOrEqual(300);
          }
        }
      }
    },
  );

  it('le POST d analyse ne persiste aucune URL, même quand la mesure réussit', async () => {
    const res = await appelerPost('r-a');
    expect(res.status).toBe(201);
    expect(ecrituresTentees.length, 'le POST doit avoir écrit').toBeGreaterThan(0);
    exigerAucuneUrlEnBase('après un POST réussi');
  });

  it('une vignette qui porte une URL au lieu d une clé est refusée avant la base', async () => {
    definirMoteurExtraction(moteurQuiRend({
      ...EXTRACTION_OK,
      vignettes: [{
        bucket: 'media',
        cle: 'https://minio.exemple.test/media/A/analyse/an-1/000.jpg?X-Amz-Signature=abc',
        seconde: 0,
      }],
    }));
    const res = await appelerPost('r-a');
    expect(res.status).toBe(500);
    expect((await res.json()).motif).toBe('resultat_moteur_refuse');
    exigerAucuneUrlEnBase('après un résultat de moteur porteur d URL');
  });

  it('le contrat refuse une vignette porteuse d URL ou de « .. » — sans passer par HTTP', () => {
    expect(vignettesValides([{ bucket: 'media', cle: 'https://x/y.jpg', seconde: 0 }]).ok).toBe(false);
    expect(vignettesValides([{ bucket: 'media', cle: 'A/../B/y.jpg', seconde: 0 }]).ok).toBe(false);
    expect(vignettesValides([{ bucket: 'secrets', cle: 'A/y.jpg', seconde: 0 }]).ok).toBe(false);
    expect(vignettesValides([{ bucket: 'media', cle: CLE_VIGNETTE_A, seconde: 0 }]).ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LE BANC D'ESSAI DE L'ÉCRAN
// ═══════════════════════════════════════════════════════════════════════════
interface AppelHttp { methode: string; url: string; viaMinuterie: boolean }

let appelsHttp: AppelHttp[] = [];
/**
 * La profondeur de minuterie au moment de l'appel.
 *
 * Incrémentée avant d'exécuter le rappel d'un `setTimeout`/`setInterval`,
 * décrémentée après. Tout `fetch` émis pendant que ce compteur est non nul
 * vient d'une minuterie — c'est le détecteur du bloc 5.
 */
let profondeurMinuterie = 0;
let restaurerMinuteries: (() => void) | null = null;

function installerDetecteurMinuterie() {
  const vraiSetInterval = globalThis.setInterval;
  const vraiSetTimeout = globalThis.setTimeout;
  const envelopper = (rappel: unknown) => (
    typeof rappel === 'function'
      ? (...args: unknown[]) => {
        profondeurMinuterie += 1;
        try { return (rappel as (...a: unknown[]) => unknown)(...args); } finally {
          profondeurMinuterie -= 1;
        }
      }
      : rappel
  );
  (globalThis as Record<string, unknown>).setInterval = (
    (rappel: unknown, ms?: number, ...reste: unknown[]) => (
      (vraiSetInterval as unknown as (...a: unknown[]) => unknown)(envelopper(rappel), ms, ...reste)
    )
  );
  (globalThis as Record<string, unknown>).setTimeout = (
    (rappel: unknown, ms?: number, ...reste: unknown[]) => (
      (vraiSetTimeout as unknown as (...a: unknown[]) => unknown)(envelopper(rappel), ms, ...reste)
    )
  );
  restaurerMinuteries = () => {
    (globalThis as Record<string, unknown>).setInterval = vraiSetInterval;
    (globalThis as Record<string, unknown>).setTimeout = vraiSetTimeout;
    restaurerMinuteries = null;
  };
}

/** L'état que le faux serveur rend à l'écran, et que les tests pilotent. */
let analyseCourante: Record<string, unknown> | null = null;
/** Les réponses que le prochain POST doit rendre, dans l'ordre. */
let reponsesPost: Array<{ statut: number; corps: Record<string, unknown> }> = [];

const ANALYSE_EN_COURS = {
  id: 'an-1', rushId: 'r-a', etat: 'en_cours', etape: 'extraction',
  dureeSecondes: null, technique: {}, motifEchec: null,
  vignettes: { nombre: 0, secondes: [] },
};
const ANALYSE_REUSSIE = {
  id: 'an-1', rushId: 'r-a', etat: 'reussie', etape: 'extraction',
  dureeSecondes: 42.5,
  technique: { largeur: 1080, hauteur: 1920, fps: 30, audio: true },
  motifEchec: null,
  vignettes: { nombre: 1, secondes: [0] },
};

function faireReponse(statut: number, corps: unknown): Response {
  return new Response(JSON.stringify(corps), {
    status: statut, headers: { 'Content-Type': 'application/json' },
  });
}

function installerFauxServeur() {
  appelsHttp = [];
  (globalThis as Record<string, unknown>).fetch = vi.fn(
    async (entree: unknown, init?: { method?: string }) => {
      const url = String(entree);
      const methode = (init?.method ?? 'GET').toUpperCase();
      appelsHttp.push({ methode, url, viaMinuterie: profondeurMinuterie > 0 });

      // ⚠️ L'ANALYSE D'ABORD. « /api/autopilot/rushes/r-a/analyse » contient
      // « /rushes » : tester la liste des rushes en premier renvoyait la
      // liste au lieu de l'analyse, et cinq tests d'écran accusaient le
      // panneau d'un défaut du banc d'essai. Constaté, pas supposé.
      if (url.includes('/analyse')) {
        if (methode === 'POST') {
          const prevue = reponsesPost.shift();
          if (prevue) {
            if (prevue.statut === 201 || prevue.statut === 200) {
              analyseCourante = (prevue.corps.analyse as Record<string, unknown>) ?? ANALYSE_EN_COURS;
            }
            return faireReponse(prevue.statut, prevue.corps);
          }
          analyseCourante = { ...ANALYSE_EN_COURS };
          return faireReponse(201, { ok: true, analyse: analyseCourante });
        }
        // ⚠️ LA FORME RÉELLE DU LOT A EST AU SINGULIER.
        //
        // Cette doublure rendait `{ analyses: [...] }`, une hypothèse écrite
        // avant que la route n'existe. Le lot A rend `{ analyse: <objet|null> }`
        // — une seule analyse, la plus récente. L'écran, qui lit la forme
        // réelle, ne voyait donc jamais d'analyse : ni suivi, ni mesure
        // affichée, et trois tests accusaient l'écran d'un défaut du banc
        // d'essai. On corrige la doublure, pas le code.
        return faireReponse(200, { ok: true, analyse: analyseCourante ?? null });
      }
      if (url.includes('/api/autopilot/sessions') && !url.includes('/rushes')) {
        if (methode === 'GET') {
          return faireReponse(200, {
            ok: true,
            sessions: [{ id: 's-a', titre: 'Cours du samedi', statut: 'brouillon' }],
          });
        }
        return faireReponse(201, {
          ok: true, session: { id: 's-a', titre: 'Cours du samedi', statut: 'brouillon' },
        });
      }
      if (url.includes('/rushes')) {
        return faireReponse(200, {
          ok: true,
          rushes: [
            {
              id: 'r-a', shootSessionId: 's-a', userId: 'A', bucket: 'media',
              cleObjet: 'A/rush/plan.mp4', nomOrigine: 'plan.mp4', rang: 0,
              etat: 'verifie', dureeSecondes: null,
            },
            {
              id: 'r-x', shootSessionId: 's-a', userId: 'A', bucket: 'media',
              cleObjet: 'A/rush/x.mp4', nomOrigine: 'x.mp4', rang: 1,
              etat: 'indexe', dureeSecondes: null,
            },
          ],
        });
      }
      return faireReponse(404, { ok: false, error: 'route non doublée' });
    },
  ) as unknown as typeof fetch;
}

const appelsAnalyse = (methode: string) => appelsHttp.filter(
  (a) => a.url.includes('/analyse') && a.methode === methode,
);

/**
 * Le bouton « Analyser » du rush, cherché comme un utilisateur le verrait.
 *
 * HYPOTHÈSE sur le lot B : soit un `data-tournage-analyser` portant
 * l'identifiant du rush, soit un bouton dont le libellé parle d'analyse, dans
 * la ligne du rush. Si le lot B nomme autrement, c'est ici qu'on élargit.
 */
function boutonAnalyser(rushId: string): HTMLButtonElement | null {
  const parAttribut = document.querySelector(`[data-tournage-analyser="${rushId}"]`);
  if (parAttribut) return parAttribut as HTMLButtonElement;
  // ⚠️ LA PORTEE EST CELLE DU RUSH, JAMAIS LE DOCUMENT ENTIER.
  //
  // L'ancienne version retombait sur `document` quand la ligne du rush
  // n'existait pas. Depuis la refonte, la chaine n'est montee QUE pour le
  // rush regarde : chercher partout retrouvait donc le bouton du rush VOISIN
  // et faisait passer pour present un bouton absent. Sans portee, ce test
  // aurait dit oui a exactement ce qu'il interdit.
  const ligne = document.querySelector(`[data-analyse-rush="${rushId}"]`);
  if (!ligne) return null;
  const boutons = Array.from(ligne.querySelectorAll('button'));
  return (boutons.find(
    (b) => /analys/i.test(b.textContent || '') || /analys/i.test(b.getAttribute('aria-label') || ''),
  ) as HTMLButtonElement | undefined) ?? null;
}

/**
 * Avance le temps, puis laisse les promesses en attente se résoudre.
 *
 * `ms = 0` ne fait QUE vider la file de micro-tâches : c'est ce qu'on utilise
 * pour attendre une réponse HTTP sans déclencher la relance périodique. Un
 * `waitFor` ferait l'inverse — il avance le temps réel, et sous fausses
 * minuteries il n'avance rien du tout.
 */
const avancer = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

/** Attend une condition SANS avancer l'horloge. */
async function jusqua(condition: () => boolean, quoi: string, tours = 60) {
  for (let i = 0; i < tours; i += 1) {
    if (condition()) return;
    // eslint-disable-next-line no-await-in-loop
    await avancer(0);
  }
  expect(condition(), `jamais atteint : ${quoi}`).toBe(true);
}

/**
 * Monte le panneau et sélectionne la session — sous fausses minuteries.
 *
 * Tout le bloc écran tourne sur des minuteries factices, y compris le
 * montage : basculer en cours de route laisserait une relance déjà planifiée
 * sur l'horloge réelle, et le test attendrait un tour qui n'arriverait jamais.
 */
async function monterPanneau() {
  const { default: SessionsTournagePanel } = await import(
    '@/components/creer/SessionsTournagePanel'
  );
  const vue = render(createElement(SessionsTournagePanel));
  await jusqua(() => screen.queryByText('Cours du samedi') !== null, 'la liste des sessions');
  // ⚠️ PLUS DE CLIC SUR LA SESSION : depuis la refonte, la premiere s'ouvre
  // d'elle-meme et la liste verticale des rushes est devenue une BANDE de
  // cartes. Ce que le test verrouille — un clic, un travail, aucune boucle —
  // ne change pas d'un iota ; seul le selecteur suit l'ecran.
  await jusqua(
    () => document.querySelector('[data-bande-carte="r-a"]') !== null,
    'la bande des rushes',
  );
  return vue;
}

const texteEcran = () => document.body.textContent ?? '';

// ═══════════════════════════════════════════════════════════════════════════
// BLOC 4 — Le parcours vu de l'écran
// ═══════════════════════════════════════════════════════════════════════════
describe.skipIf(!panneauIntegre)('Le parcours écran — un clic, un travail, aucune boucle', () => {
  beforeEach(() => {
    analyseCourante = null;
    reponsesPost = [];
    installerFauxServeur();
    vi.useFakeTimers();
  });

  it('le bouton « Analyser » n apparaît que pour un rush vérifié', async () => {
    await monterPanneau();
    expect(boutonAnalyser('r-a'), 'rush vérifié : le bouton doit être là').toBeTruthy();
    expect(
      boutonAnalyser('r-x'),
      'rush seulement indexé : le bouton promettrait une mesure que le serveur refuse',
    ).toBeNull();

    // Et en le REGARDANT, l'écran dit pourquoi plutôt que de se taire.
    const carte = document.querySelector('[data-bande-choisir="r-x"]') as HTMLElement | null;
    if (carte) {
      fireEvent.click(carte);
      await avancer(0);
      expect(boutonAnalyser('r-x')).toBeNull();
      expect(document.querySelector('[data-rush-non-verifie]')).toBeTruthy();
    }
  });

  it('un clic déclenche UN SEUL POST, même cliqué trois fois', async () => {
    await monterPanneau();
    const bouton = boutonAnalyser('r-a')!;
    fireEvent.click(bouton);
    fireEvent.click(bouton);
    fireEvent.click(bouton);
    await avancer(0);
    expect(appelsAnalyse('POST')).toHaveLength(1);
  });

  it('un 409 fait relire par GET, et n envoie AUCUN second POST', async () => {
    reponsesPost = [{
      statut: 409,
      corps: {
        ok: false, motif: 'analyse_active_existante',
        error: 'Une analyse de ce rush est déjà en cours.',
        analyse: ANALYSE_EN_COURS,
      },
    }];
    await monterPanneau();
    const avantClic = appelsAnalyse('GET').length;
    analyseCourante = { ...ANALYSE_EN_COURS };
    fireEvent.click(boutonAnalyser('r-a')!);
    await jusqua(
      () => appelsAnalyse('GET').length > avantClic,
      'une relecture après le 409',
    );
    expect(appelsAnalyse('POST'), 'un 409 ne se retente pas').toHaveLength(1);
  });

  it('un 429 ne déclenche AUCUN ré-essai automatique', async () => {
    reponsesPost = [{
      statut: 429,
      corps: { ok: false, motif: 'capacite_saturee', error: 'Le serveur est occupé.' },
    }];
    await monterPanneau();
    fireEvent.click(boutonAnalyser('r-a')!);
    await avancer(60_000);
    expect(appelsAnalyse('POST'), 'un 429 relancé tout seul martèle le serveur').toHaveLength(1);
  });

  it('la relance périodique ne tourne que pour une analyse active', async () => {
    analyseCourante = { ...ANALYSE_REUSSIE };
    await monterPanneau();
    await avancer(0);
    const apresChargement = appelsAnalyse('GET').length;
    expect(apresChargement, 'le panneau doit avoir lu l analyse au chargement').toBeGreaterThan(0);
    await avancer(30_000);
    expect(
      appelsAnalyse('GET').length,
      'une analyse terminée ne se relit pas en boucle',
    ).toBe(apresChargement);
  });

  it('elle tourne tant que l analyse est en cours, puis s arrête quand elle se termine', async () => {
    await monterPanneau();
    fireEvent.click(boutonAnalyser('r-a')!);
    await avancer(0);
    const avantAttente = appelsAnalyse('GET').length;
    await avancer(12_000);
    expect(
      appelsAnalyse('GET').length,
      'aucune relecture pendant une analyse en cours',
    ).toBeGreaterThan(avantAttente);

    analyseCourante = { ...ANALYSE_REUSSIE };
    await avancer(12_000);
    const apresFin = appelsAnalyse('GET').length;
    await avancer(60_000);
    expect(
      appelsAnalyse('GET').length,
      'la relance continue après la fin de l analyse',
    ).toBe(apresFin);
  });

  it('le démontage du composant arrête la relance', async () => {
    const vue = await monterPanneau();
    fireEvent.click(boutonAnalyser('r-a')!);
    await avancer(9_000);
    vue.unmount();
    const auDemontage = appelsHttp.length;
    await avancer(60_000);
    expect(
      appelsHttp.length,
      'un composant démonté continue d interroger le serveur',
    ).toBe(auDemontage);
  });

  it('après rechargement, l analyse est retrouvée par GET', async () => {
    const premiere = await monterPanneau();
    fireEvent.click(boutonAnalyser('r-a')!);
    await avancer(0);
    premiere.unmount();

    appelsHttp = [];
    analyseCourante = { ...ANALYSE_REUSSIE };
    await monterPanneau();
    await jusqua(() => appelsAnalyse('GET').length > 0, 'la relecture au rechargement');
    expect(appelsAnalyse('POST'), 'un rechargement ne relance pas la mesure').toHaveLength(0);
    await jusqua(() => /42[.,]5|1080/.test(texteEcran()), 'la mesure affichée après rechargement');
  });

  it('un succès affiche les données techniques mesurées', async () => {
    analyseCourante = { ...ANALYSE_REUSSIE };
    await monterPanneau();
    await jusqua(
      () => /42[.,]5|0?0:42|1080/.test(texteEcran()),
      'la durée ou les dimensions à l écran',
    );
  });

  it('un échec affiche un motif lisible, pas un code brut', async () => {
    reponsesPost = [{
      statut: 422,
      corps: {
        ok: false, motif: 'format_illisible',
        error: 'Ce fichier n’est pas une vidéo exploitable.',
      },
    }];
    await monterPanneau();
    fireEvent.click(boutonAnalyser('r-a')!);
    await jusqua(
      () => /vidéo exploitable|illisible/i.test(texteEcran()),
      'le motif d échec en clair',
    );
  });

  it('aucune fausse progression en pourcentage pendant une analyse', async () => {
    await monterPanneau();
    fireEvent.click(boutonAnalyser('r-a')!);
    await avancer(15_000);
    // Aucun téléversement n'est en cours : le seul « % » du panneau est celui
    // des envois, et il n'a rien à afficher. Un pourcentage ici ne pourrait
    // donc être qu'INVENTÉ — le serveur ne rend aucun avancement.
    expect(
      texteEcran(),
      'un pourcentage affiché pendant l analyse ne peut être qu inventé',
    ).not.toMatch(/\d+\s*%/);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// BLOC 5 — LA GARDE : AUCUN POST D'ANALYSE DEPUIS UNE MINUTERIE
// ═══════════════════════════════════════════════════════════════════════════
/**
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CETTE GARDE, ET POURQUOI ELLE MORD
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La relance périodique et le déclenchement de la mesure se ressemblent — même
 * URL, même composant, deux verbes. Le jour où quelqu'un branche le POST dans
 * la boucle « pour rafraîchir », l'écran devient une machine à lancer des
 * ffmpeg : chaque tour prend une place d'extraction, se heurte au 409, et
 * recommence trois secondes plus tard. Rien ne casse visiblement, la facture
 * seule le dit.
 *
 * DEUX DÉTECTEURS, QUI N'ATTRAPENT PAS LA MÊME FAUTE :
 *
 * 1. L'ATTRIBUTION. `setTimeout`/`setInterval` sont enveloppés : pendant
 *    l'exécution d'un rappel, un compteur est non nul, et tout `fetch` émis
 *    est marqué `viaMinuterie`. Ce détecteur NOMME le coupable — mais il
 *    perd la trace après un `await`, parce que la pile n'est plus celle du
 *    rappel.
 *
 * 2. LE COMPTE. Après UN clic, le nombre total de POST reste 1, quel que
 *    soit le temps écoulé. Celui-ci attrape le POST différé que le premier
 *    laisse passer — au prix de ne désigner personne.
 *
 * Les deux ensemble couvrent les deux formes. Et le bloc « témoin »
 * ci-dessous n'est pas décoratif : il MET EN SCÈNE les deux fautes et vérifie
 * que les détecteurs les attrapent. Un détecteur qui ne se déclenche jamais
 * « prouve » n'importe quoi — c'est la leçon du compteur d'octets de
 * `autopilote-m3b2-gros-fichiers.test.ts`.
 */

/** Un composant fautif : il POSTe depuis une minuterie, sans `await`. */
function CoupableSynchrone() {
  useEffect(() => {
    const t = setInterval(() => {
      fetch('/api/autopilot/rushes/r-a/analyse', { method: 'POST' });
    }, 3000);
    return () => clearInterval(t);
  }, []);
  return createElement('div', null, 'coupable synchrone');
}

/** Le même, mais différé par un `await` : l'attribution le perd. */
function CoupableDiffere() {
  useEffect(() => {
    const t = setInterval(() => {
      void (async () => {
        await Promise.resolve();
        fetch('/api/autopilot/rushes/r-a/analyse', { method: 'POST' });
      })();
    }, 3000);
    return () => clearInterval(t);
  }, []);
  return createElement('div', null, 'coupable différé');
}

describe('Le témoin de la garde — les détecteurs se déclenchent vraiment', () => {
  beforeEach(() => {
    analyseCourante = null;
    reponsesPost = [];
    installerFauxServeur();
    vi.useFakeTimers();
    installerDetecteurMinuterie();
  });

  afterEach(() => {
    restaurerMinuteries?.();
    profondeurMinuterie = 0;
  });

  it('un POST branché dans un setInterval est ATTRIBUÉ à la minuterie', async () => {
    render(createElement(CoupableSynchrone));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    const fautifs = appelsAnalyse('POST').filter((a) => a.viaMinuterie);
    expect(
      fautifs.length,
      'le détecteur d attribution ne voit pas un POST pourtant émis depuis une minuterie',
    ).toBeGreaterThan(0);
  });

  it('un POST différé par un await échappe à l attribution — et le COMPTE le rattrape', async () => {
    render(createElement(CoupableDiffere));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    const posts = appelsAnalyse('POST');
    expect(posts.length, 'aucun POST émis : le témoin ne prouve rien').toBeGreaterThan(1);
    expect(
      posts.every((a) => !a.viaMinuterie),
      'ce témoin doit justement ÉCHAPPER à l attribution — sinon il ne teste plus le compte',
    ).toBe(true);
  });

  it('sans minuterie fautive, aucun appel n est attribué à une minuterie', async () => {
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(appelsHttp.filter((a) => a.viaMinuterie)).toHaveLength(0);
  });
});

describe.skipIf(!panneauIntegre)('La garde appliquée au panneau', () => {
  beforeEach(() => {
    analyseCourante = null;
    reponsesPost = [];
    installerFauxServeur();
    vi.useFakeTimers();
    installerDetecteurMinuterie();
  });

  afterEach(() => {
    restaurerMinuteries?.();
    profondeurMinuterie = 0;
  });

  it('aucune minuterie du panneau n émet un POST d analyse', async () => {
    await monterPanneau();
    fireEvent.click(boutonAnalyser('r-a')!);
    // ⚠️ DEUX TEMPS, ET L'ORDRE COMPTE.
    //
    // `avancer(0)` d'abord : il SORT de `act`, et c'est cette sortie qui
    // déclenche les effets React en attente — dont celui qui arme la relance
    // périodique. Avancer directement de deux minutes n'aurait rien fait
    // tourner : la minuterie n'est armée qu'à la sortie de `act`, une fois
    // l'horloge déjà au bout. Le test passait alors sans avoir rien joué, y
    // compris avec un POST fautif branché exprès dans la boucle. Constaté sur
    // maquette, pas supposé — d'où la vérification de vivacité ci-dessous.
    await avancer(0);
    // L'analyse reste `en_cours` : c'est la seule situation où une relance
    // périodique tourne, donc la seule où la faute peut se produire.
    await avancer(120_000);

    // La preuve que ce test a joué quelque chose. Sans elle, une relance qui
    // ne démarre jamais rendrait la garde verte pour toujours.
    expect(
      appelsAnalyse('GET').length,
      'aucune relance n a tourné : cette garde ne prouverait rien',
    ).toBeGreaterThan(1);
    const attribues = appelsAnalyse('POST').filter((a) => a.viaMinuterie);
    expect(
      attribues.map((a) => a.url),
      'un POST d analyse est émis depuis une minuterie du panneau',
    ).toEqual([]);
    expect(
      appelsAnalyse('POST').length,
      'après UN clic, le nombre de POST doit rester 1 quel que soit le temps écoulé',
    ).toBe(1);
  });

  it('le code du panneau ne contient aucun POST d analyse dans un rappel de minuterie', () => {
    const code = sansCommentaires(lire(FICHIER_PANNEAU));
    // Le corps de chaque `setInterval(`/`setTimeout(`, extrait à accolades
    // équilibrées : une lecture de texte ne remplace pas le détecteur
    // d'exécution, elle l'accompagne — et elle survit à un test qu'on
    // oublierait de jouer.
    const corpsDeMinuteries: string[] = [];
    const motif = /set(?:Interval|Timeout)\s*\(/g;
    let m: RegExpExecArray | null = motif.exec(code);
    while (m) {
      let profondeur = 0;
      let i = m.index + m[0].length - 1;
      const debut = i;
      do {
        if (code[i] === '(') profondeur += 1;
        else if (code[i] === ')') profondeur -= 1;
        i += 1;
      } while (i < code.length && profondeur > 0);
      corpsDeMinuteries.push(code.slice(debut, i));
      m = motif.exec(code);
    }
    for (const corps of corpsDeMinuteries) {
      const postDAnalyse = /['"`]POST['"`]/.test(corps) && /analyse/.test(corps);
      expect(
        postDAnalyse,
        `un rappel de minuterie contient un POST d analyse : ${corps.slice(0, 160)}`,
      ).toBe(false);
    }
  });
});
