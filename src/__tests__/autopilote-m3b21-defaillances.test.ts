/**
 * M3-B2.1 — Les défaillances du chemin d'analyse, de bout en bout.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER PROUVE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le raccord COMPLET, et pas une de ses moitiés :
 *
 *   route → capacité → récupération éventuelle → `creerAnalyse` → moteur
 *        → fermeture → libération de la place.
 *
 * Les lots précédents ont chacun leur fichier, et chacun est vert sur sa
 * moitié. Ce qui n'a jamais été parcouru, c'est ce qui se passe quand le
 * chemin S'INTERROMPT AU MILIEU : un processus tué pendant ffmpeg, un
 * conteneur redéployé, une exécution qui revient dix minutes trop tard. Ce
 * sont les seuls scénarios qui laissent une trace DURABLE — une analyse
 * active pour toujours, un rush qu'on ne peut plus jamais analyser — et ce
 * sont précisément ceux qu'aucune suite ne joue.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DEUX INVARIANTS, VÉRIFIÉS APRÈS CHAQUE TEST SANS EXCEPTION
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. LA PLACE EST RENDUE. `extractionsEnCours()` revient à zéro, quoi qu'il
 *    arrive : succès, refus, exception, panne de base. Une place fuitée est
 *    invisible sur le test qui la fuit et fait échouer tous les suivants —
 *    c'est le pire des bugs, celui qui accuse quelqu'un d'autre.
 *
 * 2. L'UNICITÉ DE L'ANALYSE ACTIVE TIENT. La doublure de base la vérifie
 *    APRÈS CHAQUE ÉCRITURE, insertion comme mise à jour, et note la
 *    violation. Un index unique ne protège que les INSERTIONS : une
 *    récupération boguée qui rouvrirait une analyse par un `update`
 *    passerait sous l'index sans rien casser de visible.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * COMMENT ON SIMULE UN CRASH SANS TUER LE PROCESSUS DE TEST
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un vrai `kill -9` n'est pas rejouable dans vitest, et un moteur qui lève
 * ne simule RIEN : la route l'attrape et clôt proprement l'analyse — c'est
 * même ce qu'on lui demande. Un crash, c'est l'inverse : personne ne clôt
 * rien.
 *
 * On coupe donc la BASE, pas le moteur. `crasherSur(table, predicat)` fait
 * lever la doublure PostgREST sur l'ecriture que le predicat designe.
 * L'exception traverse `majAnalyse`, traverse `executerAnalyse`, et sort par
 * le `catch` global de la route — qui repond 500 sans avoir rien pu fermer.
 * Ce que ca laisse derriere est exactement ce que laisse un processus tue :
 * une ligne active, une place rendue par le `finally`, et rien d'autre.
 *
 * Le predicat choisit OU le processus meurt :
 *   `AU_DEMARRAGE`      → au passage `en_cours` : la ligne reste `en_attente`,
 *                         et le moteur n'a jamais tourne ;
 *   `A_LA_CONSIGNATION` → apres la mesure : elle reste `en_cours`, et le
 *                         travail est perdu.
 *
 * Le predicat porte sur CE QUI EST ECRIT, jamais sur le rang de l'ecriture :
 * un compteur se decale des qu'un lot en amont ajoute une requete.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * COMMENT ON SIMULE UNE EXÉCUTION QUI REVIENT TROP TARD
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le moteur injecté BLOQUE. Pendant qu'il bloque, on modifie la ligne
 * DIRECTEMENT en base — sans passer par la route — comme le ferait une
 * récupération déclenchée par une autre requête. Puis on débloque le moteur
 * avec un succès. La question est alors : est-ce que ce succès, arrivé
 * après la fermeture, ressuscite l'analyse ?
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI N'EST PAS ENCORE INTÉGRÉ, ET COMMENT C'EST TRAITÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La récupération des analyses orphelines (lot A) et le bornage des appels
 * MinIO (lot B) sont produits dans d'autres arbres de travail. Ici ils
 * n'existent pas.
 *
 * Le bloc « CE QUE CE FICHIER ATTEND DES LOTS A ET B » porte UNE garde par
 * lot manquant. Elles ÉCHOUENT tant que le lot n'est pas là, en le NOMMANT :
 * c'est le signal, et c'est le seul moyen d'empêcher qu'un `skipIf` reste
 * silencieusement vert pour toujours après un renommage. Les preuves de
 * détail qui exigent réellement la récupération sont mises de côté par
 * `skipIf`, pour n'avoir qu'un échec lisible au lieu de dix identiques.
 *
 * ⚠️ Tout le reste — et c'est la majorité de ce fichier — tourne DÈS
 * MAINTENANT, y compris les deux tests qui comptent le plus :
 * « une analyse récente survit à une relance » (le test de mutation) et
 * « la relance d'un utilisateur ne touche pas l'analyse périmée d'un
 * autre » (le test d'isolation). Tous deux sont verts aujourd'hui et le
 * restent après intégration — sauf si la récupération est écrite de
 * travers, ce qui est exactement leur raison d'être.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA DOUBLURE DE BASE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Reprise de `autopilote-m3b2-route.test.ts` — elle applique réellement les
 * `.eq()` et les deux index uniques — avec quatre ajouts indispensables ici :
 *
 *   • les comparaisons `.lt/.lte/.gt/.gte`, SANS LESQUELLES le filtre
 *     `updated_at < seuil` de la récupération ne serait pas appliqué et le
 *     test de mutation ne prouverait rien ;
 *   • `updated_at` réel à l'insertion (`now()`), pour que « récent » et
 *     « périmé » soient des faits datés et non des constantes figées ;
 *   • l'enregistrement de TOUTES les mises à jour TENTÉES, avec leurs
 *     filtres — c'est la seule façon de prouver qu'une requête porte bien
 *     `user_id`, y compris quand elle ne touche aucune ligne ;
 *   • le crash injecté, décrit plus haut.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  definirMoteurExtraction,
  type DemandeExtraction, type ResultatExtraction,
} from '@/lib/autopilot/analyse/moteur';
import {
  extractionsEnCours, reinitialiserCapacite, MAX_EXTRACTIONS_SIMULTANEES,
} from '@/lib/autopilot/analyse/capacite';

const authMock = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));

// ═══════════════════════════════════════════════════════════════════════════
// LA DOUBLURE POSTGREST
// ═══════════════════════════════════════════════════════════════════════════
interface Ligne { [k: string]: unknown }

/** Une écriture telle qu'elle a été DEMANDÉE, filtres compris. */
interface EcritureTentee {
  table: string;
  valeurs: Ligne;
  filtres: Array<[string, unknown]>;
  filtresIn: Array<[string, unknown[]]>;
  comparaisons: Array<[string, string, unknown]>;
  /** Nombre de lignes réellement touchées. `0` = la requête n'a rien trouvé. */
  touchees: number;
}

let tables: Record<string, Ligne[]>;

/** Les insertions ACCEPTÉES par la base. */
const insertions: Array<{ table: string; valeurs: Ligne }> = [];
/** Les insertions TENTÉES, refus de la base compris. */
const tentativesInsertion: Array<{ table: string; valeurs: Ligne }> = [];
/** Les mises à jour TENTÉES — celles qui ne touchent rien comprises. */
const tentativesMaj: EcritureTentee[] = [];

/**
 * Les violations d'unicité constatées APRÈS écriture.
 *
 * L'index unique ne garde que les insertions. Une récupération qui
 * rouvrirait une analyse close par un `update`, ou qui laisserait deux
 * lignes actives sur un rush, passerait dessous sans bruit. Ce compteur est
 * vérifié après CHAQUE test.
 */
const violationsUnicite: string[] = [];

/**
 * Ce qui se produit ENTRE une lecture de `rush_analyses` et l'écriture qui la
 * suit — la fenêtre exacte qu'un `select` de garde laisserait ouverte.
 *
 * Appelé UNE fois, puis effacé : la course qu'on met en scène n'arrive
 * qu'une fois, comme dans la vraie vie.
 */
let hookApresLecture: (() => void) | null = null;

/**
 * Le crash injecté : à quelle écriture la base doit-elle mourir.
 *
 * ⚠️ DÉSIGNÉE PAR CE QU'ELLE ÉCRIT, JAMAIS PAR SON RANG.
 *
 * La première rédaction comptait les écritures — « meurs à la deuxième mise à
 * jour ». Elle a tenu jusqu'à ce que la récupération du lot A ajoute une
 * mise à jour AVANT `creerAnalyse` : le compteur s'est décalé, le crash a
 * tué la récupération au lieu du passage `en_cours`, et trois tests ont viré
 * au rouge en accusant le mauvais coupable. Constaté sur maquette, pas
 * supposé.
 *
 * Un prédicat sur le patch écrit ne se décale pas : « meurs quand quelqu'un
 * écrit `etat: en_cours` » désigne le même instant, quel que soit le nombre
 * d'écritures qui le précèdent.
 */
let planCrash: { table: string; quand: (valeurs: Ligne) => boolean } | null = null;

function crasherSur(table: string, quand: (valeurs: Ligne) => boolean) {
  planCrash = { table, quand };
}

/** Meurt au passage `en_cours` : le processus n'a rien mesuré du tout. */
const AU_DEMARRAGE = (v: Ligne) => v.etat === 'en_cours';
/**
 * Meurt à la consignation du succès : la mesure a eu lieu, et elle est perdue.
 *
 * `reussie` et rien d'autre. `echouee` désignerait AUSSI la fermeture écrite
 * par la récupération, et le crash tomberait sur elle.
 */
const A_LA_CONSIGNATION = (v: Ligne) => v.etat === 'reussie';

const erreurTable = { code: '42P01', message: 'relation does not exist' };
let tableAbsente: string | null = null;

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
 * L'invariant, relu après chaque écriture.
 *
 * Ce n'est pas l'index — c'est le CONSTAT que ce que l'index promet est
 * encore vrai après une opération qu'il ne surveille pas.
 */
function verifierUnicite(origine: string) {
  const parRush: Record<string, number> = {};
  for (const l of tables.rush_analyses ?? []) {
    if (!etatActif(l.etat)) continue;
    const cle = String(l.rush_id);
    parRush[cle] = (parRush[cle] ?? 0) + 1;
    if (parRush[cle] > 1) {
      violationsUnicite.push(
        `${origine} : ${parRush[cle]} analyses actives sur le rush ${cle}`,
      );
    }
  }
}

/**
 * Rend une valeur comparable, qu'elle arrive en `Date`, en ISO ou en nombre.
 *
 * On ne sait pas sous quelle forme la récupération passera son seuil. Une
 * doublure qui comparerait bêtement des chaînes rendrait `String(new Date())`
 * — « Wed Aug 28 2026 … » — et ordonnerait n'importe comment : le filtre
 * semblerait appliqué alors qu'il ne trierait rien.
 */
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
  /** Les lignes réellement écrites par la dernière exécution de CETTE requête. */
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

  const peutCrasher = (valeurs: Ligne) => {
    if (!planCrash || planCrash.table !== table || !planCrash.quand(valeurs)) return;
    planCrash = null;
    // Ce que voit le code appelant quand le conteneur part en plein vol.
    throw new Error('PROCESSUS_TUE: connexion base perdue pendant l ecriture');
  };

  const executer = () => {
    if (tableAbsente === table) return { data: null, error: erreurTable };

    if (aInserer) {
      peutCrasher(aInserer);
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
      const maintenant = new Date().toISOString();
      const ligne: Ligne = {
        id: `${table}-${(tables[table] ?? []).length + 1}`,
        etape: null, fournisseurs: {}, duree_secondes: null, technique: {},
        resume: null, textes_visibles: [], parole: {}, audio: {}, qualite: {},
        vignettes: [], usage: {}, motif_echec: null,
        // `now()` réel, comme la colonne par défaut : sans ça, une ligne
        // fraîchement créée porterait une date figée et paraîtrait périmée.
        created_at: maintenant, updated_at: maintenant,
        ...valeurs,
      };
      insertions.push({ table, valeurs });
      tables[table] = [...(tables[table] ?? []), ligne];
      ecrites = [ligne];
      verifierUnicite(`insert ${table}`);
      return { data: ligne, error: null };
    }

    if (aMettreAJour) {
      peutCrasher(aMettreAJour);
      const cibles = lignes() ?? [];
      // Enregistrée MÊME quand elle ne touche rien : une requête qui rate sa
      // cible reste une requête, et ses filtres sont ce qu'on veut prouver.
      tentativesMaj.push({
        table,
        valeurs: aMettreAJour,
        filtres: [...filtres],
        filtresIn: [...filtresIn],
        comparaisons: [...comparaisons],
        touchees: cibles.length,
      });
      if (cibles.length === 0) { ecrites = []; return { data: null, error: null }; }
      const patch = aMettreAJour;
      const idsTouches = new Set(cibles.map((l) => l.id));
      tables[table] = (tables[table] ?? []).map(
        (l) => (cibles.includes(l) ? { ...l, ...patch } : l),
      );
      verifierUnicite(`update ${table}`);
      ecrites = (tables[table] ?? []).filter((l) => idsTouches.has(l.id));
      const misAJour = (tables[table] ?? []).find((l) => l.id === cibles[0].id) ?? null;
      return { data: misAJour, error: null };
    }

    const l = lignes();
    // La fenêtre de course : ce qui arrive ENTRE la lecture et l'écriture.
    if (table === 'rush_analyses' && hookApresLecture) {
      const hook = hookApresLecture;
      hookApresLecture = null;
      hook();
    }
    return { data: l && l.length ? l[0] : null, error: null };
  };

  const api: Record<string, unknown> = {
    select: () => api,
    eq: (c: string, v: unknown) => { filtres.push([c, v]); return api; },
    /**
     * ⚠️ CES CINQ OPÉRATEURS MANQUENT AUX DOUBLURES DES AUTRES FICHIERS.
     *
     * `autopilote-m3b2-route.test.ts` et `autopilote-m3b2-concurrence.test.ts`
     * n'exposent que `eq`, `in`, `order`, `limit`. Le jour où la récupération
     * ajoutera un `.lt('updated_at', seuil)` sur le chemin de la route, leurs
     * doublures lèveront « api.lt is not a function » — l'exception sortira
     * par le `catch` global de la route, et une trentaine de leurs tests
     * passeront de 201 à 500 d'un coup, en accusant la route.
     *
     * Vérifié sur maquette, pas supposé : c'est le premier symptôme à
     * attendre à l'intégration du lot A, et il se corrige en ajoutant ces
     * opérateurs là-bas — jamais en retirant le filtre ici.
     */
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
    /**
     * `await` sur le constructeur, sans `maybeSingle()`.
     *
     * ⚠️ La doublure d'origine n'y traitait QUE les lectures : un `await
     * supabaseAdmin.from(t).update(...).select('id')` — la forme naturelle
     * d'une récupération qui ferme PLUSIEURS lignes d'un coup — n'aurait
     * rien écrit, et le test l'aurait déclaré vert. C'est exactement le
     * genre de doublure qui prouve le contraire de ce qu'on croit.
     */
    then: (resoudre: (v: unknown) => unknown) => {
      if (aInserer || aMettreAJour) {
        const res = executer() as { data: unknown; error: unknown };
        return resoudre(res.error ? { data: null, error: res.error } : { data: ecrites, error: null });
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

const { POST } = await import('@/app/api/autopilot/rushes/[id]/analyse/route');

// ═══════════════════════════════════════════════════════════════════════════
// LE DÉCOR
// ═══════════════════════════════════════════════════════════════════════════
const RUSH_DE_A: Ligne = {
  id: 'r-a', shoot_session_id: 's-a', user_id: 'A', bucket: 'media',
  cle_objet: 'A/rush/plan.mp4', nom_origine: 'plan.mp4', content_type: 'video/mp4',
  taille_octets: 5_000_000, duree_secondes: null, rang: 0, etat: 'verifie',
  metadata: {}, created_at: '2026-08-31T10:00:00Z', updated_at: '2026-08-31T10:00:00Z',
};
const RUSH_DE_A2: Ligne = { ...RUSH_DE_A, id: 'r-a2', cle_objet: 'A/rush/plan2.mp4' };
const RUSH_DE_A_NON_VERIFIE: Ligne = { ...RUSH_DE_A, id: 'r-a3', etat: 'indexe' };
const RUSH_DE_B: Ligne = {
  ...RUSH_DE_A, id: 'r-b', shoot_session_id: 's-b', user_id: 'B',
  cle_objet: 'B/rush/plan.mp4',
};

const MINUTE = 60_000;
const ilYA = (ms: number) => new Date(Date.now() - ms).toISOString();

/**
 * Une analyse posée DIRECTEMENT en base, sans passer par la route.
 *
 * `ageMinutes` est ce qui distingue « une analyse tourne » de « une analyse
 * a été abandonnée ». Les valeurs choisies dans les tests sont volontairement
 * loin de tout seuil plausible — quelques secondes d'un côté, vingt-quatre
 * heures de l'autre — pour qu'aucun test ne dépende de la valeur exacte du
 * seuil retenu par la récupération.
 */
function analyseEnBase(options: {
  id?: string; rushId?: string; userId?: string; version?: number;
  etat?: string; ageMinutes?: number; motifEchec?: string | null;
} = {}): Ligne {
  const date = ilYA((options.ageMinutes ?? 0) * MINUTE);
  return {
    id: options.id ?? 'a-1',
    rush_id: options.rushId ?? 'r-a',
    user_id: options.userId ?? 'A',
    version: options.version ?? 1,
    etat: options.etat ?? 'en_cours',
    etape: 'extraction', fournisseurs: {}, duree_secondes: null, technique: {},
    resume: null, textes_visibles: [], parole: {}, audio: {}, qualite: {},
    vignettes: [], usage: {}, motif_echec: options.motifEchec ?? null,
    created_at: date, updated_at: date,
  };
}

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

const analyses = () => tables.rush_analyses ?? [];
const analysesActives = () => analyses().filter((a) => etatActif(a.etat));
const analyseDe = (id: string) => analyses().find((a) => a.id === id) ?? null;

/**
 * Bloque le moteur, et rend de quoi le débloquer.
 *
 * Pendant qu'il bloque, la requête détient la place et son analyse est
 * `en_cours` : c'est la fenêtre dans laquelle on joue les scénarios de
 * concurrence et de reprise tardive.
 */
function moteurBloque(resultat: ResultatExtraction = EXTRACTION_OK) {
  let libere!: () => void;
  const attente = new Promise<void>((r) => { libere = r; });
  definirMoteurExtraction(async (d) => {
    appelsMoteur.push(d);
    await attente;
    return resultat;
  });
  return { libere: () => libere() };
}

beforeEach(() => {
  insertions.length = 0;
  tentativesInsertion.length = 0;
  tentativesMaj.length = 0;
  violationsUnicite.length = 0;
  appelsMoteur = [];
  planCrash = null;
  hookApresLecture = null;
  tableAbsente = null;
  authMock.mockResolvedValue({ user: { id: 'A' } });
  // TOUJOURS un moteur injecté : sans cela la route chargerait le vrai
  // module et lancerait un ffmpeg contre un MinIO absent.
  definirMoteurExtraction(moteurQuiRend(EXTRACTION_OK));
  reinitialiserCapacite();
  tables = {
    rushes: [
      { ...RUSH_DE_A }, { ...RUSH_DE_A2 }, { ...RUSH_DE_A_NON_VERIFIE }, { ...RUSH_DE_B },
    ],
    rush_analyses: [],
  };
});

afterEach(() => {
  // ── Invariant 1 : la place est rendue ───────────────────────────────────
  expect(
    extractionsEnCours(),
    'place d extraction NON rendue — elle empoisonnerait tous les tests suivants',
  ).toBe(0);
  // ── Invariant 2 : jamais deux analyses actives sur un même rush ─────────
  expect(
    violationsUnicite,
    'unicité de l analyse active violée par une écriture',
  ).toEqual([]);
  definirMoteurExtraction(null);
  reinitialiserCapacite();
});

// ═══════════════════════════════════════════════════════════════════════════
// CE QUE CE FICHIER ATTEND DES LOTS A ET B
// ═══════════════════════════════════════════════════════════════════════════

const FICHIER_ROUTE = 'src/app/api/autopilot/rushes/[id]/analyse/route.ts';
const FICHIER_SERVICE = 'src/lib/autopilot/analyse/service.ts';
const FICHIER_RECUPERATION = 'src/lib/autopilot/analyse/recuperation.ts';
/**
 * Le vocabulaire du lot vit dans le CONTRAT — c'est la convention du projet,
 * et le lot A l'a suivie : `MOTIF_ANALYSE_INTERROMPUE` y est déclaré, puis
 * importé par le service. Le littéral n'apparaît donc dans aucun des trois
 * fichiers cherchés à l'origine. C'est la liste de fichiers qu'on élargit,
 * jamais la garde qu'on supprime.
 */
const FICHIER_CONTRAT = 'src/lib/autopilot/analyse/contrat.ts';
const FICHIER_EXTRACTION = 'src/lib/autopilot/analyse/extraction.ts';

/**
 * Le motif que la récupération doit écrire.
 *
 * HYPOTHÈSE sur le lot A, et elle est là pour être vue : si la récupération
 * ferme les analyses interrompues sous un autre nom, c'est CETTE constante
 * qu'il faut corriger — jamais la garde qu'il faut supprimer.
 */
const MOTIF_INTERROMPUE = 'analyse_interrompue';

const chemin = (relatif: string) => join(process.cwd(), relatif);
const lire = (relatif: string) => (
  existsSync(chemin(relatif)) ? readFileSync(chemin(relatif), 'utf-8') : ''
);
const sansCommentaires = (code: string) => code
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

/**
 * La récupération est-elle intégrée ?
 *
 * On la cherche par son MOTIF, pas par le nom d'une fonction : le motif est
 * ce que l'utilisateur et le journal verront, donc la seule partie du lot A
 * dont on peut raisonnablement fixer le nom à l'avance.
 */
const recuperationIntegree = [
  FICHIER_RECUPERATION, FICHIER_CONTRAT, FICHIER_SERVICE, FICHIER_ROUTE,
]
  .some((f) => sansCommentaires(lire(f)).includes(MOTIF_INTERROMPUE));

describe('Ce que ce fichier attend des lots A et B', () => {
  /**
   * GARDE DU LOT A. Elle échoue tant que la récupération n'est pas là.
   *
   * Sans elle, les `describe.skipIf` ci-dessous resteraient verts en ne
   * vérifiant rien — y compris le jour où le motif serait renommé.
   */
  it('lot A — la récupération des analyses orphelines est intégrée', () => {
    expect(
      recuperationIntegree,
      `motif « ${MOTIF_INTERROMPUE} » introuvable dans ${FICHIER_RECUPERATION}, `
      + `${FICHIER_CONTRAT}, ${FICHIER_SERVICE} ni ${FICHIER_ROUTE}. Les preuves qui exigent la `
      + 'récupération sont mises de côté tant qu il manque. Si le lot A ferme '
      + 'les analyses interrompues sous un AUTRE motif, corriger '
      + 'MOTIF_INTERROMPUE ici plutôt que supprimer cette garde.',
    ).toBe(true);
  });

  /**
   * GARDE DU LOT B — et elle est aussi la preuve elle-même.
   *
   * Trois appels MinIO du moteur sont aujourd'hui `await`és nus :
   * `statObject`, `presignedGetObject`, `putObject`. Un MinIO qui accepte la
   * connexion puis ne répond jamais les fait pendre au-delà du budget de la
   * route, et l'analyse reste `en_cours` pour toujours — le seul état dont
   * l'index unique interdit de sortir sans intervention.
   *
   * On n'exige AUCUN nom de fonction ni de constante : seulement qu'aucun de
   * ces trois appels ne soit plus attendu à nu. C'est ce qui rend la preuve
   * indépendante de la forme que prendra le bornage.
   */
  it('lot B — aucun appel MinIO du moteur n est attendu sans borne', () => {
    // Les commentaires sont BLANCHIS plutôt que supprimés : les numéros de
    // ligne rendus doivent être ceux du fichier, pas ceux d'un extrait.
    const code = lire(FICHIER_EXTRACTION)
      .replace(/\/\*[\s\S]*?\*\//g, (bloc) => bloc.replace(/[^\n]/g, ' '))
      .split('\n').map((l) => (l.trim().startsWith('//') ? '' : l)).join('\n');
    expect(code.trim(), `${FICHIER_EXTRACTION} introuvable`).not.toBe('');
    // ⚠️ ON MESURE LA CONSTRUCTION DU CLIENT, PAS LA FORME DE L'APPEL.
    //
    // La première rédaction cherchait `await x.statObject(` — elle supposait
    // que le bornage se ferait en chaînant l'appel sur le constructeur. Le
    // lot B a rangé les clients bornés dans des variables
    // (`const signeur = signeurInterne(BORNE)`), ce que ce motif lisait
    // comme un appel « à nu » : un faux positif sur du code correct.
    //
    // Ce qui compte n'est pas où l'appel est écrit, c'est qu'AUCUN client de
    // ce fichier ne soit construit sans borne. Un constructeur aux
    // parenthèses vides est le seul moyen d'obtenir un client non borné —
    // c'est donc lui, et lui seul, qu'on interdit ici. La preuve reste
    // indépendante du nom de la borne et de la forme du bornage.
    const nus = [
      /\bclientMinio\s*\(\s*\)/,
      /\bsigneurInterne\s*\(\s*\)/,
      /\bsigneurPublic\s*\(\s*\)/,
    ];
    // On rend les LIGNES fautives, pas le fichier : un échec qui recrache
    // sept cents lignes de source ne se lit pas.
    const fautives = code.split('\n')
      .map((ligne, i) => [i + 1, ligne.trim()] as const)
      .filter(([, ligne]) => nus.some((m) => m.test(ligne)))
      .map(([n, ligne]) => `${FICHIER_EXTRACTION}:${n} — ${ligne}`);

    expect(
      fautives,
      'client MinIO construit sans borne : un stockage qui accepte la '
      + 'connexion puis ne répond jamais ferait pendre la requête au-delà de '
      + 'son budget, et l analyse resterait « en_cours » indéfiniment',
    ).toEqual([]);

    // Et le fichier utilise bien au moins un client borné — sans quoi la
    // règle ci-dessus serait vraie d'un fichier qui n'appelle rien.
    expect(code, 'aucun client borné dans le moteur')
      .toMatch(/(clientMinio|signeurInterne)\s*\(\s*[A-Za-z_$]/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. LES CRASHES — CE QU'ILS LAISSENT DERRIÈRE EUX
// ═══════════════════════════════════════════════════════════════════════════
describe('Un processus tué laisse une trace, et rend sa place', () => {
  it('tué APRÈS la création : la ligne existe, `en_attente`, et le moteur n a pas tourné', async () => {
    // La 1re écriture sur `rush_analyses` après l'insertion est le passage
    // `en_cours`. Mourir là, c'est mourir entre la création et le travail.
    crasherSur('rush_analyses', AU_DEMARRAGE);

    const r = await appeler('r-a');

    expect(r.status).toBe(500);
    // La ligne est là — c'est TOUTE la raison de la poser avant le travail.
    // Sans elle, rien ne dirait qu'une analyse a été tentée sur ce rush.
    expect(analyses()).toHaveLength(1);
    expect(analyses()[0].etat).toBe('en_attente');
    expect(analyses()[0].motif_echec).toBeNull();
    // Personne n'a fermé quoi que ce soit : c'est bien un crash, pas un
    // échec contrôlé. Et le moteur n'a jamais démarré.
    expect(appelsMoteur).toHaveLength(0);
    // Mais la place est rendue — vérifié aussi par l'invariant global.
    expect(extractionsEnCours()).toBe(0);
  });

  it('tué APRÈS la consignation : la ligne reste `en_cours`, mais la MESURE EST SAUVE', async () => {
    // ⚠️ CE TEST A CHANGÉ DE SENS AVEC M3-B4, ET C'EST UNE AMÉLIORATION.
    //
    // Avant, la consignation portait `etat: 'reussie'` : mourir sur cette
    // écriture perdait TOUT le travail de mesure. Depuis que l'étape `visuel`
    // s'intercale, la consignation n'a plus le droit de clore la ligne — elle
    // écrit la durée, la technique et les vignettes SANS l'état. Le crash
    // tombe donc sur l'écriture SUIVANTE, et ce qui a été mesuré reste en base.
    //
    // La ligne demeure `en_cours` : c'est la reprise (M3-B2.1) qui la fermera.
    // Mais le rush n'aura pas à être remesuré.
    crasherSur('rush_analyses', A_LA_CONSIGNATION);

    const r = await appeler('r-a');

    expect(r.status).toBe(500);
    expect(analyses()).toHaveLength(1);
    expect(analyses()[0].etat).toBe('en_cours');
    expect(analyses()[0].etape).toBe('extraction');
    // Le moteur A tourné : c'est ce qui distingue ce crash du précédent.
    expect(appelsMoteur).toHaveLength(1);
    // La mesure, elle, EST consignée — c'est tout l'intérêt du découpage.
    expect(analyses()[0].duree_secondes).toBe(42.5);
    // Et la copie de confort sur le rush a eu lieu elle aussi : elle vient
    // juste après la consignation, donc avant l'écriture qui a crashé.
    expect((tables.rushes ?? []).find((l) => l.id === 'r-a')!.duree_secondes).toBe(42.5);
    expect(extractionsEnCours()).toBe(0);
  });

  it('une analyse laissée par un crash BLOQUE le rush tant que rien ne la ferme', async () => {
    // C'est le problème que la récupération existe pour résoudre, énoncé
    // comme un fait mesuré et non comme une crainte : sans elle, ce rush
    // n'est plus jamais analysable.
    crasherSur('rush_analyses', AU_DEMARRAGE);
    await appeler('r-a');
    planCrash = null;

    const seconde = await appeler('r-a');

    expect(seconde.status).toBe(409);
    expect((await seconde.json()).motif).toBe('analyse_active_existante');
    expect(analyses()).toHaveLength(1);
  });

  it('un crash sur le rush d un utilisateur ne laisse rien chez l autre', async () => {
    crasherSur('rush_analyses', AU_DEMARRAGE);
    await appeler('r-a');
    expect(analyses().every((a) => a.user_id === 'A')).toBe(true);
    expect(analyses().every((a) => a.rush_id === 'r-a')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. LE TEST DE MUTATION — UNE ANALYSE RÉCENTE NE SE FAIT PAS RÉCUPÉRER
// ═══════════════════════════════════════════════════════════════════════════
describe('Une analyse RÉCENTE survit à une relance', () => {
  /**
   * ⚠️ LE TEST DE MUTATION DU LOT A.
   *
   * Retirez `updated_at < seuil` de la requête de récupération et ce test
   * devient rouge — trois fois plutôt qu'une :
   *
   *   • le code passerait de 409 à 201 ;
   *   • la LIGNE elle-même passerait de `en_cours` à `echouee` ;
   *   • son `motif_echec` porterait le motif de récupération.
   *
   * L'assertion sur la ligne est celle qui compte. Un test qui ne
   * regarderait que le code HTTP se laisserait tromper par une
   * récupération qui fermerait l'analyse ET rendrait quand même 409 pour
   * une autre raison — un cas très réel, puisque la place occupée par une
   * requête voisine produit exactement ce 409-là.
   *
   * Il tourne DÈS AUJOURD'HUI : sans récupération, rien ne touche la ligne
   * et il est vert. Il n'est pas là pour prouver que la récupération
   * existe, il est là pour la surveiller quand elle arrivera.
   */
  it('quelques secondes : 409, et la ligne est INTACTE', async () => {
    const recente = analyseEnBase({ ageMinutes: 0.5, etat: 'en_cours' });
    tables.rush_analyses = [recente];

    const r = await appeler('r-a');

    expect(r.status, 'une analyse récente ne doit pas être récupérée').toBe(409);
    expect((await r.json()).motif).toBe('analyse_active_existante');

    // ── La preuve qui résiste à la mutation : la LIGNE ────────────────────
    const ligne = analyseDe('a-1')!;
    expect(ligne, 'la ligne récente a disparu').not.toBeNull();
    expect(ligne.etat, 'une analyse récente a été fermée par la récupération').toBe('en_cours');
    expect(ligne.motif_echec).toBeNull();
    expect(ligne.updated_at, 'la ligne récente a été réécrite').toBe(recente.updated_at);
    // Et aucune nouvelle version n'a été créée derrière.
    expect(analyses()).toHaveLength(1);
    expect(insertions.filter((i) => i.table === 'rush_analyses')).toHaveLength(0);
  });

  it('une analyse récente `en_attente` est protégée exactement pareil', async () => {
    // `en_attente` est l'état d'une analyse qui vient de naître et dont le
    // travail n'a pas encore commencé : la fenêtre la plus courte du chemin,
    // et donc celle qu'une récupération trop large fermerait en premier.
    const recente = analyseEnBase({ ageMinutes: 0.1, etat: 'en_attente' });
    tables.rush_analyses = [recente];

    const r = await appeler('r-a');

    expect(r.status).toBe(409);
    const ligne = analyseDe('a-1')!;
    expect(ligne.etat).toBe('en_attente');
    expect(ligne.updated_at).toBe(recente.updated_at);
  });

  it('une analyse CLOSE, même ancienne, n est pas « récupérée » — elle est ignorée', async () => {
    // Rouvrir ou réécrire une analyse close serait pire que de ne rien
    // faire : elle porte un résultat, et ce résultat fait foi.
    const close = analyseEnBase({
      ageMinutes: 60 * 24, etat: 'reussie', motifEchec: null,
    });
    close.duree_secondes = 12.5;
    tables.rush_analyses = [close];

    const r = await appeler('r-a');

    expect(r.status).toBe(201);
    const ancienne = analyseDe('a-1')!;
    expect(ancienne.etat, 'une analyse réussie a été rouverte ou réécrite').toBe('reussie');
    expect(ancienne.duree_secondes).toBe(12.5);
    expect(ancienne.motif_echec).toBeNull();
    // La relance crée une VERSION, elle n'écrase pas.
    expect(analyses()).toHaveLength(2);
    expect(insertions[0].valeurs.version).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. L'ISOLATION — LA RÉCUPÉRATION N'EST PAS UN CONTOURNEMENT DE `user_id`
// ═══════════════════════════════════════════════════════════════════════════
describe('La récupération ne traverse jamais la frontière entre comptes', () => {
  /**
   * ⚠️ LE SECOND TEST EXIGÉ.
   *
   * Une récupération est la seule écriture du chemin qui vise des lignes que
   * l'appelant N'A PAS CRÉÉES. C'est aussi, pour cette raison exacte, le seul
   * endroit où il est tentant d'écrire un `update ... where etat actif and
   * updated_at < seuil` sans `user_id` : la requête est plus simple, elle
   * « nettoie mieux », et elle passe tous les tests de récupération.
   *
   * Elle ferme alors les analyses de tout le monde. Une requête de A tuerait
   * l'analyse que B est en train de faire tourner — et B verrait son travail
   * échouer sans cause visible.
   *
   * Ce test regarde les DEUX faces : ce que la ligne de B devient, et ce que
   * la RÉPONSE à A laisse filtrer.
   *
   * Il tourne dès aujourd'hui, et reste vert après intégration — sauf si le
   * filtre de propriété manque.
   */
  it('la relance de A ne ferme pas l analyse périmée de B', async () => {
    const perimeeDeB = analyseEnBase({
      id: 'a-b', rushId: 'r-b', userId: 'B', ageMinutes: 60 * 24,
    });
    tables.rush_analyses = [perimeeDeB];

    const r = await appeler('r-a');
    expect(r.status).toBe(201);

    // ── La ligne de B, mot pour mot ───────────────────────────────────────
    const apres = analyseDe('a-b')!;
    expect(apres.etat, 'la relance de A a fermé l analyse de B').toBe('en_cours');
    expect(apres.motif_echec).toBeNull();
    expect(apres.updated_at, 'la ligne de B a été réécrite').toBe(perimeeDeB.updated_at);
  });

  it('AUCUNE écriture sur `rush_analyses` ne part sans filtre de propriétaire', async () => {
    // La preuve structurelle, celle qui tient même si B n'a pas de ligne à
    // fermer ce jour-là : on regarde les REQUÊTES, pas leurs effets.
    tables.rush_analyses = [
      analyseEnBase({ id: 'a-b', rushId: 'r-b', userId: 'B', ageMinutes: 60 * 24 }),
    ];

    await appeler('r-a');

    const surAnalyses = tentativesMaj.filter((m) => m.table === 'rush_analyses');
    expect(surAnalyses.length).toBeGreaterThan(0);
    for (const maj of surAnalyses) {
      const proprietaire = maj.filtres.find(([c]) => c === 'user_id');
      expect(
        proprietaire,
        `une mise à jour de rush_analyses sans .eq('user_id') : ${JSON.stringify(maj.filtres)}`,
      ).toBeDefined();
      expect(proprietaire![1], 'écriture au nom d un autre compte').toBe('A');
    }
  });

  it('la relance de A ne LIT rien de B — la réponse ne porte aucune trace', async () => {
    tables.rush_analyses = [
      analyseEnBase({ id: 'a-b', rushId: 'r-b', userId: 'B', ageMinutes: 60 * 24 }),
    ];

    const r = await appeler('r-a');
    const texte = JSON.stringify(await r.json());

    // Ni l'identifiant de l'analyse de B, ni celui de son rush, ni son
    // compte : un refus ou un compte-rendu qui les citerait ferait de la
    // récupération un oracle d'existence.
    expect(texte).not.toContain('a-b');
    expect(texte).not.toContain('r-b');
    expect(texte).not.toContain('"B"');
  });

  it('B garde le droit d analyser SON rush après une relance de A', async () => {
    // La conséquence utile, vue depuis B : si A avait fermé son analyse, B
    // pourrait en relancer une — et c'est justement ce qu'on ne veut pas.
    tables.rush_analyses = [
      analyseEnBase({ id: 'a-b', rushId: 'r-b', userId: 'B', ageMinutes: 0.5 }),
    ];
    await appeler('r-a');

    authMock.mockResolvedValue({ user: { id: 'B' } });
    const r = await appeler('r-b');

    // Son analyse récente tient toujours le verrou : 409, et non 201.
    expect(r.status).toBe(409);
    expect((await r.json()).motif).toBe('analyse_active_existante');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. LA REPRISE TARDIVE — UN RÉSULTAT QUI ARRIVE APRÈS LA FERMETURE
// ═══════════════════════════════════════════════════════════════════════════
describe('Une exécution qui revient trop tard ne ressuscite rien', () => {
  /**
   * Le scénario réel : la requête est partie, sa mesure dure, une
   * récupération (ou un opérateur) l'a déclarée perdue et l'a fermée. Puis
   * la mesure aboutit.
   *
   * Si elle écrivait, on aurait une analyse `reussie` que plus rien ne
   * distingue d'une analyse valide, alors qu'une AUTRE version a pu être
   * lancée entre-temps sur le même rush. C'est le `.in('etat', actifs)` de
   * `majAnalyse` qui l'empêche, et c'est ici qu'il est mis à l'épreuve.
   */
  it('le résultat n écrase pas une analyse fermée entre-temps', async () => {
    const bloque = moteurBloque(EXTRACTION_OK);
    const enVol = appeler('r-a');
    await vi.waitFor(() => expect(appelsMoteur).toHaveLength(1));

    // Pendant la mesure, la ligne est fermée SANS passer par cette requête —
    // exactement ce que fait une récupération déclenchée ailleurs.
    tables.rush_analyses = analyses().map((a) => (
      a.id === 'rush_analyses-1'
        ? { ...a, etat: 'echouee', motif_echec: MOTIF_INTERROMPUE }
        : a
    ));

    bloque.libere();
    const r = await enVol;

    expect(r.status).toBe(409);
    expect((await r.json()).motif).toBe('analyse_close');

    const ligne = analyseDe('rush_analyses-1')!;
    expect(ligne.etat, 'une analyse close a été ressuscitée').toBe('echouee');
    expect(ligne.motif_echec).toBe(MOTIF_INTERROMPUE);
    expect(ligne.duree_secondes, 'un résultat tardif a été consigné').toBeNull();
    expect(ligne.technique).toEqual({});
    expect(ligne.vignettes).toEqual([]);
    // Et la copie de confort sur le rush n'a pas eu lieu non plus : elle
    // aurait donné une durée à un rush dont l'analyse a échoué.
    expect((tables.rushes ?? []).find((l) => l.id === 'r-a')!.duree_secondes).toBeNull();
  });

  it('elle n écrit pas davantage sur la NOUVELLE version lancée entre-temps', async () => {
    // Le cas qui fait vraiment mal : la récupération a fermé la v1, une v2
    // tourne. Un écrivain tardif qui viserait « l'analyse active de ce rush »
    // au lieu de SON identifiant écraserait le travail de la v2.
    const bloque = moteurBloque(EXTRACTION_OK);
    const enVol = appeler('r-a');
    await vi.waitFor(() => expect(appelsMoteur).toHaveLength(1));

    tables.rush_analyses = analyses().map((a) => (
      a.id === 'rush_analyses-1'
        ? { ...a, etat: 'echouee', motif_echec: MOTIF_INTERROMPUE }
        : a
    ));
    const v2 = analyseEnBase({ id: 'a-v2', version: 2, etat: 'en_cours', ageMinutes: 0 });
    tables.rush_analyses = [...analyses(), v2];

    bloque.libere();
    await enVol;

    const apres = analyseDe('a-v2')!;
    expect(apres.etat, 'la v2 a été écrasée par un écrivain tardif').toBe('en_cours');
    expect(apres.duree_secondes).toBeNull();
    expect(apres.updated_at).toBe(v2.updated_at);
  });

  it('un échec tardif ne rouvre pas non plus une analyse close', async () => {
    const bloque = moteurBloque({ ok: false, motif: 'timeout' });
    const enVol = appeler('r-a');
    await vi.waitFor(() => expect(appelsMoteur).toHaveLength(1));

    tables.rush_analyses = analyses().map((a) => (
      a.id === 'rush_analyses-1'
        ? { ...a, etat: 'reussie', motif_echec: null, duree_secondes: 30 }
        : a
    ));

    bloque.libere();
    await enVol;

    const ligne = analyseDe('rush_analyses-1')!;
    expect(ligne.etat, 'un échec tardif a écrasé un succès consigné').toBe('reussie');
    expect(ligne.duree_secondes).toBe(30);
    expect(ligne.motif_echec).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. LES DEUX TIMEOUTS — STOCKAGE ET FFMPEG
// ═══════════════════════════════════════════════════════════════════════════
describe('Un délai dépassé ferme l analyse et rend la place', () => {
  /**
   * Les deux causes n'ont ni le même code ni le même motif, et c'est
   * délibéré : `stockage_injoignable` dit que MinIO n'a pas répondu (503,
   * de notre côté), `timeout` dit que la mesure elle-même a dépassé son
   * délai (504). Les confondre ferait compter une panne d'infrastructure
   * comme un fichier trop lourd, et inversement.
   *
   * Ce qu'ils ont en commun est ce que ce fichier surveille : dans les deux
   * cas l'analyse est CLOSE — jamais laissée `en_cours` — et la place est
   * rendue.
   */
  const timeouts: Array<[string, string, number]> = [
    ['stockage — MinIO ne répond pas', 'stockage_injoignable', 503],
    ['ffmpeg — la mesure dépasse son délai', 'timeout', 504],
  ];

  it.each(timeouts)('%s → %s, analyse `echouee`, place rendue', async (_l, motif, statut) => {
    definirMoteurExtraction(moteurQuiRend({ ok: false, motif }));

    const r = await appeler('r-a');

    expect(r.status).toBe(statut);
    const corps = await r.json();
    expect(corps.ok).toBe(false);
    expect(corps.motif).toBe(motif);

    const ligne = analyses()[0];
    expect(ligne.etat, 'un délai dépassé a laissé l analyse active').toBe('echouee');
    expect(ligne.motif_echec).toBe(motif);
    // La place est rendue : c'est ce qui permet à la relance de passer.
    expect(extractionsEnCours()).toBe(0);
    // Et rien n'a été inventé sur le rush.
    expect((tables.rushes ?? []).find((l) => l.id === 'r-a')!.duree_secondes).toBeNull();
  });

  it.each(timeouts)('après %s, une relance immédiate passe', async (_l, motif) => {
    definirMoteurExtraction(moteurQuiRend({ ok: false, motif }));
    await appeler('r-a');

    definirMoteurExtraction(moteurQuiRend(EXTRACTION_OK));
    const r = await appeler('r-a');

    // Ni le verrou d'unicité ni la place ne restent pris : c'est la
    // conséquence observable des deux fermetures.
    expect(r.status).toBe(201);
    expect(analyses()).toHaveLength(2);
    expect(analyses()[1].version).toBe(2);
    expect(analyses()[1].etat).toBe('reussie');
  });

  it('un délai dépassé ne consomme pas la place suivante', async () => {
    definirMoteurExtraction(moteurQuiRend({ ok: false, motif: 'timeout' }));
    await appeler('r-a');
    expect(extractionsEnCours()).toBe(0);

    // Un autre rush doit pouvoir démarrer tout de suite.
    definirMoteurExtraction(moteurQuiRend(EXTRACTION_OK));
    expect((await appeler('r-a2')).status).toBe(201);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. LA PLACE EST RENDUE — DANS TOUS LES CAS, SANS EXCEPTION
// ═══════════════════════════════════════════════════════════════════════════
describe('La place est rendue quelle que soit la sortie', () => {
  /**
   * Une place fuitée ne se voit pas sur la requête qui la fuit : elle rend
   * 200 comme d'habitude. Elle se voit sur la SUIVANTE, qui reçoit 429 sans
   * raison — et sur toutes celles d'après, jusqu'au redémarrage.
   *
   * Chaque sortie du chemin est donc listée ici, et chacune est suivie d'une
   * relance qui doit passer. C'est cette relance, plus que le compteur, qui
   * prouve la libération : le compteur pourrait mentir, la relance non.
   */
  const sorties: Array<[string, () => void | Promise<void>, number]> = [
    ['succès', () => { definirMoteurExtraction(moteurQuiRend(EXTRACTION_OK)); }, 201],
    ['échec contrôlé', () => {
      definirMoteurExtraction(moteurQuiRend({ ok: false, motif: 'format_illisible' }));
    }, 422],
    ['moteur qui lève', () => {
      definirMoteurExtraction(async (d) => {
        appelsMoteur.push(d);
        throw new Error('ffmpeg a segfault');
      });
    }, 500],
    ['résultat inexploitable', () => {
      definirMoteurExtraction(moteurQuiRend({ ok: true, dureeSecondes: -1 }));
    }, 500],
    ['résultat refusé par le contrat', () => {
      definirMoteurExtraction(moteurQuiRend({
        ok: true, dureeSecondes: 5, technique: {},
        vignettes: [{ bucket: 'interdit', cle: 'A/0.jpg', seconde: 0 }],
      }));
    }, 500],
    ['crash de la base', () => {
      crasherSur('rush_analyses', AU_DEMARRAGE);
    }, 500],
    ['analyse déjà active', () => {
      tables.rush_analyses = [analyseEnBase({ ageMinutes: 0.2 })];
    }, 409],
  ];

  it.each(sorties)('%s → la place revient à zéro', async (_libelle, preparer, statut) => {
    await preparer();

    const r = await appeler('r-a');

    expect(r.status).toBe(statut);
    expect(extractionsEnCours(), 'place non rendue').toBe(0);

    // La preuve par l'usage : un AUTRE rush démarre tout de suite après.
    planCrash = null;
    definirMoteurExtraction(moteurQuiRend(EXTRACTION_OK));
    const suivante = await appeler('r-a2');
    expect(suivante.status, 'la place n a pas été rendue : la suivante est refusée').toBe(201);
  });

  const refusAvantLaPlace: Array<[string, () => void, string, number]> = [
    ['session absente', () => { authMock.mockResolvedValue(null); }, 'r-a', 401],
    ['rush d autrui', () => {}, 'r-b', 404],
    ['rush inexistant', () => {}, 'r-neant', 404],
    ['rush non vérifié', () => {}, 'r-a3', 409],
  ];

  it.each(refusAvantLaPlace)(
    '%s : la place n est même pas prise',
    async (_libelle, preparer, rushId, statut) => {
      preparer();
      const r = await appeler(rushId);
      expect(r.status).toBe(statut);
      expect(extractionsEnCours()).toBe(0);
      // Aucune ligne laissée derrière : un refus bénin ne doit pas bloquer
      // un rush pour toujours.
      expect(analyses()).toHaveLength(0);
    },
  );

  it('un refus de capacité ne prend, ni ne rend, ni ne laisse rien', async () => {
    // La place est occupée par une requête réelle, pas par un appel direct
    // au limiteur : c'est le chemin de production.
    const bloque = moteurBloque();
    const enVol = appeler('r-a');
    await vi.waitFor(() => expect(appelsMoteur).toHaveLength(1));
    expect(extractionsEnCours()).toBe(MAX_EXTRACTIONS_SIMULTANEES);

    definirMoteurExtraction(moteurQuiRend(EXTRACTION_OK));
    const refusee = await appeler('r-a2');

    expect(refusee.status).toBe(429);
    expect((await refusee.json()).motif).toBe('analyse_capacite_saturee');
    // La requête refusée n'a laissé AUCUNE ligne : une analyse créée puis
    // abandonnée occuperait le verrou d'unicité de `r-a2` pour toujours.
    expect(analyses().filter((a) => a.rush_id === 'r-a2')).toHaveLength(0);
    // Et elle n'a pas décrémenté la place de l'autre.
    expect(extractionsEnCours()).toBe(MAX_EXTRACTIONS_SIMULTANEES);

    bloque.libere();
    await enVol;
    expect(extractionsEnCours()).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. L'UNICITÉ DE L'ANALYSE ACTIVE, SOUS TOUS LES ANGLES
// ═══════════════════════════════════════════════════════════════════════════
describe('Jamais deux analyses actives sur un même rush', () => {
  it('une relance concurrente ne crée pas de seconde ligne active', async () => {
    const bloque = moteurBloque();
    const premiere = appeler('r-a');
    await vi.waitFor(() => expect(appelsMoteur).toHaveLength(1));

    definirMoteurExtraction(moteurQuiRend(EXTRACTION_OK));
    const seconde = await appeler('r-a');

    expect(seconde.status).toBe(409);
    expect(analysesActives()).toHaveLength(1);
    expect(insertions.filter((i) => i.table === 'rush_analyses')).toHaveLength(1);

    bloque.libere();
    await premiere;
    expect(analyses()).toHaveLength(1);
  });

  it('un concurrent qui gagne la course APRÈS notre lecture ne produit pas de doublon', async () => {
    /**
     * LA COURSE QUE LA PLACE UNIQUE NE PEUT PAS METTRE EN SCÈNE.
     *
     * Le limiteur sépare deux requêtes simultanées AVANT qu'elles n'atteignent
     * l'index unique : la perdante repart sans avoir rien tenté. La vraie
     * course — deux insertions qui arrivent ensemble — se produit donc en
     * production (plusieurs conteneurs, ou une place desserrée) mais jamais
     * dans un test qui passe par la route.
     *
     * On la reconstitue à l'endroit exact où elle fait mal : la ligne
     * concurrente apparaît APRÈS la lecture de la version et AVANT
     * l'insertion. Un `select` de garde ne l'aurait pas vue. Seul l'index
     * peut trancher là — et c'est ce qu'on vérifie.
     */
    hookApresLecture = () => {
      tables.rush_analyses = [
        ...(tables.rush_analyses ?? []),
        analyseEnBase({ id: 'a-concurrente', ageMinutes: 0 }),
      ];
    };

    const r = await appeler('r-a');

    expect(r.status).toBe(409);
    expect((await r.json()).motif).toBe('analyse_active_existante');
    // L'INSERT a bien été TENTÉ — c'est ce qui prouve que le refus vient de
    // la base et non d'une garde applicative — et il a été REFUSÉ.
    expect(tentativesInsertion.filter((t) => t.table === 'rush_analyses')).toHaveLength(1);
    expect(insertions.filter((i) => i.table === 'rush_analyses')).toHaveLength(0);
    expect(analyses()).toHaveLength(1);
    expect(analysesActives()).toHaveLength(1);
    expect(appelsMoteur, 'la perdante a quand même mesuré').toHaveLength(0);
  });

  it('après un crash puis une fermeture manuelle, une seule version reste active', async () => {
    crasherSur('rush_analyses', AU_DEMARRAGE);
    await appeler('r-a');
    planCrash = null;
    expect(analysesActives()).toHaveLength(1);

    // La fermeture — par la récupération, ou à la main.
    tables.rush_analyses = analyses().map(
      (a) => ({ ...a, etat: 'echouee', motif_echec: MOTIF_INTERROMPUE }),
    );

    const r = await appeler('r-a');
    expect(r.status).toBe(201);
    expect(analyses()).toHaveLength(2);
    expect(analysesActives()).toHaveLength(0);
    expect(analyses()[1].version).toBe(2);
  });

  it('deux rushes du même compte s analysent chacun sans se gêner', async () => {
    expect((await appeler('r-a')).status).toBe(201);
    definirMoteurExtraction(moteurQuiRend(EXTRACTION_OK));
    expect((await appeler('r-a2')).status).toBe(201);
    expect(analyses()).toHaveLength(2);
    expect(analysesActives()).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. LA RÉCUPÉRATION ELLE-MÊME — APRÈS INTÉGRATION DU LOT A
// ═══════════════════════════════════════════════════════════════════════════
describe.skipIf(!recuperationIntegree)(
  'Une analyse PÉRIMÉE est récupérée, et la relance repart',
  () => {
    /**
     * Ces preuves exigent réellement le lot A : sans lui, la relance rend
     * 409 et rien ne les rendrait vertes. Elles sont mises de côté par
     * `skipIf` — la garde du bloc « CE QUE CE FICHIER ATTEND » est ce qui
     * empêche cette mise de côté d'être silencieuse.
     */
    it('vingt-quatre heures : l ancienne est fermée, une nouvelle version démarre', async () => {
      tables.rush_analyses = [analyseEnBase({ ageMinutes: 60 * 24, etat: 'en_cours' })];

      const r = await appeler('r-a');

      expect(r.status).toBe(201);
      const ancienne = analyseDe('a-1')!;
      expect(ancienne.etat).toBe('echouee');
      expect(
        String(ancienne.motif_echec),
        'la fermeture doit dire POURQUOI : sans motif, une analyse récupérée '
        + 'est indiscernable d une analyse qui a vraiment échoué',
      ).toContain(MOTIF_INTERROMPUE);

      // La nouvelle est une VERSION, jamais un écrasement.
      expect(analyses()).toHaveLength(2);
      const nouvelle = analyses()[1];
      expect(nouvelle.version).toBe(2);
      expect(nouvelle.etat).toBe('reussie');
      expect(nouvelle.duree_secondes).toBe(42.5);
      expect(analysesActives()).toHaveLength(0);
    });

    it('une analyse périmée `en_attente` est récupérée elle aussi', async () => {
      // Le processus est mort AVANT le passage `en_cours` : la ligne bloque
      // le rush tout autant, et pour la même durée.
      tables.rush_analyses = [analyseEnBase({ ageMinutes: 60 * 24, etat: 'en_attente' })];

      const r = await appeler('r-a');

      expect(r.status).toBe(201);
      expect(analyseDe('a-1')!.etat).toBe('echouee');
      expect(analyses()).toHaveLength(2);
    });

    it('le raccord complet : crash, péremption, relance, succès', async () => {
      // Le seul test qui parcourt le chemin entier sans rien poser à la main.
      crasherSur('rush_analyses', A_LA_CONSIGNATION);
      const premiere = await appeler('r-a');
      expect(premiere.status).toBe(500);
      expect(analyses()[0].etat).toBe('en_cours');
      planCrash = null;

      // Le temps passe : la ligne abandonnée devient une orpheline.
      tables.rush_analyses = analyses().map(
        (a) => ({ ...a, updated_at: ilYA(60 * 24 * MINUTE) }),
      );

      definirMoteurExtraction(moteurQuiRend(EXTRACTION_OK));
      const relance = await appeler('r-a');

      expect(relance.status).toBe(201);
      const corps = await relance.json();
      expect(corps.ok).toBe(true);
      expect(corps.analyse.etat).toBe('reussie');
      expect(corps.analyse.dureeSecondes).toBe(42.5);
      expect(analyses()).toHaveLength(2);
      expect(String(analyses()[0].motif_echec)).toContain(MOTIF_INTERROMPUE);
      expect(analysesActives()).toHaveLength(0);
      // Et la durée mesurée a bien atterri sur le rush.
      expect((tables.rushes ?? []).find((l) => l.id === 'r-a')!.duree_secondes).toBe(42.5);
    });

    it('la récupération ne touche que le rush concerné', async () => {
      // Deux orphelines du MÊME compte, sur deux rushes différents. Une
      // récupération qui balaierait « toutes les analyses périmées de A »
      // fermerait la seconde sans que personne ne l'ait demandé — et
      // volerait au passage le travail d'une requête voisine.
      const autre = analyseEnBase({
        id: 'a-autre', rushId: 'r-a2', ageMinutes: 60 * 24,
      });
      tables.rush_analyses = [analyseEnBase({ ageMinutes: 60 * 24 }), autre];

      const r = await appeler('r-a');

      expect(r.status).toBe(201);
      expect(analyseDe('a-1')!.etat).toBe('echouee');
      const apres = analyseDe('a-autre')!;
      expect(apres.etat, 'une analyse d un AUTRE rush a été fermée').toBe('en_cours');
      expect(apres.updated_at).toBe(autre.updated_at);
    });

    it('deux relances simultanées après le seuil : une seule gagne, aucun doublon', async () => {
      /**
       * ⚠️ CE QUE CE TEST PEUT ET NE PEUT PAS ÉTABLIR.
       *
       * Avec `MAX_EXTRACTIONS_SIMULTANEES = 1`, les deux relances se croisent
       * sur la PLACE avant d'atteindre l'index unique : la perdante repart en
       * 409 ou en 429 selon ce qu'elle lit au moment du refus. On n'assertera
       * donc pas son code exact — ce serait tester l'ordonnanceur.
       *
       * Ce qui est asserté est l'invariant, et il est le même quelle que soit
       * la façon dont la perdante a perdu : UNE gagnante, UNE insertion
       * acceptée, DEUX lignes en tout — l'orpheline fermée et la nouvelle
       * version — jamais trois. Le doublon, s'il existait, serait là.
       *
       * La course au niveau de l'INDEX, elle, est couverte séparément par
       * « un concurrent qui gagne la course APRÈS notre lecture ».
       */
      tables.rush_analyses = [analyseEnBase({ ageMinutes: 60 * 24 })];

      const [r1, r2] = await Promise.all([appeler('r-a'), appeler('r-a')]);
      const statuts = [r1.status, r2.status].sort((a, b) => a - b);

      expect(statuts.filter((s) => s === 201), 'zéro ou deux gagnantes').toHaveLength(1);
      const perdant = statuts.find((s) => s !== 201)!;
      expect([409, 429]).toContain(perdant);

      expect(insertions.filter((i) => i.table === 'rush_analyses')).toHaveLength(1);
      expect(analyses(), 'une troisième ligne : la relance a doublonné').toHaveLength(2);
      expect(analysesActives()).toHaveLength(0);
      expect(appelsMoteur, 'le moteur a tourné deux fois sur le même rush').toHaveLength(1);
    });

    it('la récupération n est pas déclenchée par une requête qui n a pas le droit d analyser', async () => {
      // Une orpheline de A sur `r-a`. B demande l'analyse de `r-a` : il
      // reçoit 404, et rien ne doit avoir bougé. Une récupération placée
      // AVANT la vérification de propriété nettoierait chez A sur ordre de B.
      const orpheline = analyseEnBase({ ageMinutes: 60 * 24 });
      tables.rush_analyses = [orpheline];

      authMock.mockResolvedValue({ user: { id: 'B' } });
      const r = await appeler('r-a');

      expect(r.status).toBe(404);
      const apres = analyseDe('a-1')!;
      expect(apres.etat, 'B a déclenché une récupération chez A').toBe('en_cours');
      expect(apres.updated_at).toBe(orpheline.updated_at);
    });

    it('un rush non vérifié ne déclenche aucune récupération non plus', async () => {
      const orpheline = analyseEnBase({ id: 'a-3', rushId: 'r-a3', ageMinutes: 60 * 24 });
      tables.rush_analyses = [orpheline];

      const r = await appeler('r-a3');

      expect(r.status).toBe(409);
      expect((await r.json()).motif).toBe('rush_non_verifie');
      expect(analyseDe('a-3')!.updated_at).toBe(orpheline.updated_at);
    });
  },
);
