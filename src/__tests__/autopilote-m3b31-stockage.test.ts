// @vitest-environment node
/**
 * M3-B3.1 — Le proxy de stockage `/storage/v1/object/public/{bucket}/{path}`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Cette route sert N'IMPORTE QUEL objet de N'IMPORTE QUEL compartiment MinIO,
 * à N'IMPORTE QUI. Elle n'appelle aucune authentification, et `src/middleware.ts`
 * ne la couvre pas : son `matcher` ne liste que `/dashboard`, `/admin`,
 * `/api/user`, `/api/credits` et `/api/admin`. Rien qui commence par `/storage`.
 *
 * Le durcissement est conçu ailleurs et n'existe pas encore. Ce fichier ne le
 * fait pas : il fixe le SOL sur lequel il sera posé.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CINQ BLOCS, QUI NE PROUVENT PAS LA MÊME CHOSE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. CARACTÉRISATION — ce que la route fait AUJOURD'HUI, décrit sans le juger.
 *    Chaque comportement qui devra changer porte un `DEVRA CHANGER` et sa
 *    raison. Ces tests-là sont faits pour DEVENIR ROUGES le jour du
 *    durcissement : c'est leur rougeur qui dira ce qu'on a changé, et c'est
 *    tout ce qu'on demande d'un test de caractérisation.
 *
 * 2. SÉCURITÉ — ce qui devra passer APRÈS. Mis de côté par une garde qui NOMME
 *    les signaux de durcissement absents du source de la route. La garde
 *    échoue tant qu'ils manquent : sans elle, un `skipIf` rendrait ce bloc
 *    vert en ne vérifiant rien, pour toujours.
 *
 * 3. NON-RÉGRESSION — les usages réels qui doivent continuer de fonctionner.
 *    Ils sont écrits pour passer AVANT ET APRÈS : chaque requête est faite au
 *    nom du PROPRIÉTAIRE de la clé, ce qui est vrai aujourd'hui (la session est
 *    ignorée) et devra l'être demain (la session autorise).
 *
 * 4. GARDE PERMANENTE — aucun code Autopilote ne réintroduit ce chemin. Avec
 *    ses TÉMOINS : une garde qu'on ne voit jamais mordre ne prouve rien.
 *
 * 5. LES VIGNETTES M3-B3 — elles ne passent que par leur route authentifiée.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUI N'EST PAS VÉRIFIÉ ICI
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * MinIO. Le client est une doublure : ce fichier teste QUEL objet la route
 * demande, et ce qu'elle fait des réponses — jamais le stockage lui-même.
 * Aucun octet ne quitte le processus, aucun fichier n'est écrit.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POURQUOI `environment: node`
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * La route rend un `ReadableStream` web construit par `Readable.toWeb`. La
 * pile `fetch` de jsdom n'est pas celle qui sert cette réponse en production ;
 * `node` l'est.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// ═══════════════════════════════════════════════════════════════════════════
// 0. OUTILS — la doublure MinIO, la doublure de session, et les helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * L'état partagé avec la doublure `minio`.
 *
 * `vi.hoisted` est OBLIGATOIRE : `vi.mock` est remonté au-dessus de toutes les
 * déclarations du fichier, et une `const` ordinaire référencée dans la
 * fabrique serait lue dans sa zone morte temporelle.
 */
const etat = vi.hoisted(() => ({
  /** Les objets du stockage fictif, indexés `"{bucket}/{cle}"`. */
  objets: new Map<string, { octets: Buffer; metaData?: Record<string, string> }>(),
  /** TOUT ce qui est demandé au stockage — l'opération, l'objet, la tranche. */
  journal: [] as Array<{
    op: 'stat' | 'objet' | 'partiel'; bucket: string; cle: string;
    debut?: number; longueur?: number;
  }>,
  /** Une panne du stockage autre que « objet absent ». */
  panne: null as string | null,
}));

vi.mock('minio', async () => {
  const { Readable } = await import('node:stream');
  const lire = (bucket: string, cle: string) => {
    if (etat.panne) throw new Error(etat.panne);
    const objet = etat.objets.get(`${bucket}/${cle}`);
    if (!objet) {
      const erreur = new Error('The specified key does not exist.') as Error & { code: string };
      erreur.code = 'NoSuchKey';
      throw erreur;
    }
    return objet;
  };
  class Client {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_options: unknown) { /* la configuration ne nous intéresse pas */ }
    async statObject(bucket: string, cle: string) {
      etat.journal.push({ op: 'stat', bucket, cle });
      const objet = lire(bucket, cle);
      return { size: objet.octets.length, metaData: objet.metaData };
    }
    async getObject(bucket: string, cle: string) {
      etat.journal.push({ op: 'objet', bucket, cle });
      return Readable.from([lire(bucket, cle).octets]);
    }
    async getPartialObject(bucket: string, cle: string, debut: number, longueur: number) {
      etat.journal.push({ op: 'partiel', bucket, cle, debut, longueur });
      return Readable.from([lire(bucket, cle).octets.subarray(debut, debut + longueur)]);
    }
  }
  return { Client };
});

/**
 * La session, en doublure.
 *
 * La route N'IMPORTE PAS ce module aujourd'hui — c'est précisément le défaut.
 * La doublure est posée quand même : le jour où le durcissement l'importera,
 * le bloc 2 aura déjà de quoi ouvrir et fermer une session, sans qu'il faille
 * réécrire ce fichier.
 */
const session = vi.hoisted(() => ({ courante: null as unknown }));
vi.mock('@/lib/auth/config', () => ({
  auth: async () => session.courante,
  DEV_AUTH_BYPASS: false,
}));

// L'interrupteur est lu AU CHARGEMENT du module : il doit être posé avant.
process.env.STORAGE_PROVIDER = 's3';
process.env.MINIO_SECRET_KEY = 'secret-de-test';
process.env.MINIO_ENDPOINT = 'studiio-minio';
// Le CORS n'est plus `*` : il n'est émis que pour l'origine configurée. Sans
// elle, aucun en-tête ne sort — ce qui est le bon comportement, mais rendrait
// les preuves de non-régression du compositeur vides de sens.
process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';
const ORIGINE_APP = 'https://studiio.pro';

const CHEMIN_ROUTE = 'src/app/storage/v1/object/public/[bucket]/[...path]/route.ts';

const routeStockage = await import(
  '@/app/storage/v1/object/public/[bucket]/[...path]/route'
);

type Contexte = { params: Promise<{ bucket: string; path: string[] }> };
type Gestionnaire = (req: unknown, ctx: Contexte) => Promise<Response>;

const GET = routeStockage.GET as unknown as Gestionnaire;
const HEAD = routeStockage.HEAD as unknown as Gestionnaire;
// `OPTIONS` reçoit désormais la requête : le CORS dépend de son `Origin`.
const OPTIONS = routeStockage.OPTIONS as unknown as
  (req?: unknown) => Promise<Response>;

/** L'origine de production — jamais jointe, seulement écrite dans l'URL. */
const ORIGINE = 'https://studiio.pro';
const PREFIXE_PUBLIC = '/storage/v1/object/public/';

function requete(bucket: string, chemin: string[], entetes: Record<string, string> = {}) {
  const url = `${ORIGINE}${PREFIXE_PUBLIC}${encodeURIComponent(bucket)}/`
    + chemin.map(encodeURIComponent).join('/');
  return new Request(url, { headers: entetes });
}

const contexte = (bucket: string, chemin: string[]): Contexte =>
  ({ params: Promise.resolve({ bucket, path: chemin }) });

interface Reponse { statut: number; entetes: Headers; corps: Buffer; texte: string }

async function lireReponse(res: Response): Promise<Reponse> {
  const corps = Buffer.from(await res.arrayBuffer());
  return { statut: res.status, entetes: res.headers, corps, texte: corps.toString('utf-8') };
}

const demander = async (
  bucket: string, chemin: string[], entetes: Record<string, string> = {},
) => lireReponse(await GET(requete(bucket, chemin, entetes), contexte(bucket, chemin)));

const sonder = async (
  bucket: string, chemin: string[], entetes: Record<string, string> = {},
) => lireReponse(await HEAD(requete(bucket, chemin, entetes), contexte(bucket, chemin)));

function deposer(
  bucket: string, cle: string, contenu: string | Buffer,
  metaData?: Record<string, string>,
) {
  const octets = Buffer.isBuffer(contenu) ? contenu : Buffer.from(contenu);
  etat.objets.set(`${bucket}/${cle}`, { octets, metaData });
  return octets;
}

/** Les octets réellement ouverts — `stat` n'en ouvre aucun. */
const octetsOuverts = () => etat.journal.filter((a) => a.op !== 'stat');

/** Tout ce qu'une réponse laisse voir : son corps ET ses en-têtes. */
const toutCeQueLaReponseMontre = (r: Reponse) =>
  `${r.texte}\n${[...r.entetes.entries()].map(([k, v]) => `${k}: ${v}`).join('\n')}`;

const racine = (relatif: string) => join(process.cwd(), relatif);
const source = (relatif: string) => readFileSync(racine(relatif), 'utf-8');

/**
 * Le code, sans ses commentaires.
 *
 * Un commentaire a le DROIT de nommer ce qu'il ne faut pas faire — c'est même
 * ce que font déjà `vignettes.ts` et `passerelle.ts`, qui expliquent tous deux
 * pourquoi ils n'utilisent pas cette route. Ce qui doit être absent, c'est
 * l'usage.
 */
const sansCommentaires = (code: string) => code
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const CODE_ROUTE = sansCommentaires(source(CHEMIN_ROUTE));

beforeEach(() => {
  etat.objets.clear();
  etat.journal.length = 0;
  etat.panne = null;
  session.courante = null;
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. CARACTÉRISATION — ce que la route fait AUJOURD'HUI
//
// Aucun de ces tests ne dit qu'un comportement est bon. Ils disent qu'il est.
// Ceux marqués `DEVRA CHANGER` sont faits pour rougir au durcissement.
// ═══════════════════════════════════════════════════════════════════════════

describe('CARACTÉRISATION — la route ne demande aucune identité', () => {
  /**
   * DEVRA CHANGER — c'est LE défaut du lot.
   *
   * Un objet privé (un rush, un montage, une affiche) est servi en entier à
   * une requête sans cookie, sans en-tête, sans rien.
   */
  it('un objet est servi ENTIER à une requête sans aucune session', async () => {
    const octets = deposer('media', 'u1/library/rush.mp4', 'CONTENU-PRIVE-DE-U1');
    expect(session.courante).toBeNull();

    const r = await demander('media', ['u1', 'library', 'rush.mp4']);

    expect(r.statut).toBe(200);
    expect(r.corps.equals(octets)).toBe(true);
    expect(Number(r.entetes.get('content-length'))).toBe(octets.length);
  });

  /**
   * DEVRA CHANGER — la preuve statique du même fait.
   *
   * L'absence de comportement d'authentification pourrait s'expliquer par une
   * doublure mal posée. L'absence de tout MOYEN de s'authentifier, non.
   */
  it('le source de la route ne contient aucun mécanisme d identité', () => {
    for (const absent of [
      '@/lib/auth/config', 'getServerSession', 'auth()', 'session',
      'user_id', 'userId', 'cookies(',
    ]) {
      expect(CODE_ROUTE, `${CHEMIN_ROUTE} : ${absent}`).not.toContain(absent);
    }
  });

  /**
   * DEVRA CHANGER — l'autre moitié du même trou.
   *
   * Même si la route voulait s'appuyer sur le middleware, celui-ci ne la voit
   * pas : `/storage` n'est dans aucun de ses préfixes, et le `matcher` d'un
   * middleware Next décide ce qui est SEULEMENT évalué.
   */
  it('le middleware ne couvre pas /storage — ni par son matcher, ni par ses préfixes', () => {
    const middleware = source('src/middleware.ts');
    const bloc = /matcher:\s*\[([^\]]*)\]/.exec(middleware);
    expect(bloc, 'src/middleware.ts : `config.matcher` introuvable').not.toBeNull();
    const motifs = [...(bloc as RegExpExecArray)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

    expect(motifs.length, 'le matcher doit lister au moins une route').toBeGreaterThan(0);
    expect(motifs.filter((m) => m.startsWith('/storage'))).toEqual([]);
    expect(middleware).not.toContain("startsWith('/storage");
  });
});

describe('DURCI — le compartiment passe par la liste blanche', () => {
  /**
   * C'ÉTAIT UNE CARACTÉRISATION, C'EST DEVENU UNE GARANTIE.
   *
   * Avant ce lot, `bucket` allait tel quel à `statObject` : n'importe quel
   * compartiment de l'instance MinIO était lisible — y compris un futur
   * compartiment de sauvegarde. `src/lib/storage/buckets.ts` portait déjà la
   * liste blanche, avec le commentaire « toute route qui reçoit un nom de
   * compartiment du navigateur doit passer par `bucketAutorise` » ; cette
   * route était la seule à ne pas s'en servir.
   *
   * Le refus est un 404, identique à « objet absent », et il tombe AVANT tout
   * appel au stockage : on ne sonde pas l'existence d'un compartiment.
   */
  it.each([
    ['un compartiment hors liste blanche', 'prive'],
    ['un compartiment de sauvegarde', 'backups'],
    ['un nom inventé', 'nimporte-quoi'],
  ])('%s est refusé, sans toucher au stockage', async (_nom, bucket) => {
    deposer(bucket, 'secret.json', '{"jeton":"..."}');
    const r = await demander(bucket, ['secret.json']);
    expect(r.statut).toBe(404);
    expect(etat.journal).toEqual([]);
  });

  it('la route importe désormais la liste blanche du projet', () => {
    expect(CODE_ROUTE).toContain('bucketAutorise');
  });

  it('la liste blanche, elle, existe bien — et compte quatre compartiments', async () => {
    const { ALLOWED_BUCKETS } = await import('@/lib/storage/buckets');
    expect([...ALLOWED_BUCKETS]).toEqual(['media', 'audio', 'videos', 'images']);
  });
});

describe('CARACTÉRISATION — la clé est le chemin, recollé tel quel', () => {
  /**
   * `path.join('/')` — ni normalisation, ni décodage, ni refus. Ce qui arrive
   * dans les segments dynamiques arrive à MinIO.
   */
  it('les segments sont recollés par `/` et remis au stockage sans retouche', async () => {
    deposer('media', 'u1/dossier/sous/a.mp4', 'A');
    const r = await demander('media', ['u1', 'dossier', 'sous', 'a.mp4']);
    expect(r.statut).toBe(200);
    expect([...new Set(etat.journal.map((a) => a.cle))]).toEqual(['u1/dossier/sous/a.mp4']);
  });

  /**
   * DEVRA CHANGER — aucune remontée `..` n'est refusée par la route.
   *
   * Nuance honnête : Next normalise le chemin de l'URL avant le routage, donc
   * un `..` littéral n'arrive en pratique pas jusqu'ici par ce canal. Ce que
   * ce test établit, c'est que LE GESTIONNAIRE, lui, ne s'en protège pas — il
   * dépend entièrement d'une couche au-dessus de lui. Le durcissement doit
   * poser le refus ICI.
   */
  it('une remontée `..` est refusée AVANT le stockage', async () => {
    // Elle était transmise telle quelle. MinIO traite les clés comme opaques,
    // donc l'objet n'existait pas — mais une garantie de périmètre ne doit
    // pas dépendre du fait qu'un fournisseur ne normalise pas ses clés.
    deposer('media', 'u1/../u2/prive.mp4', 'CONTENU-DE-U2');
    const r = await demander('media', ['u1', '..', 'u2', 'prive.mp4']);
    expect(r.statut).toBe(404);
    expect(etat.journal).toEqual([]);
  });

  /**
   * DEVRA CHANGER — une URL dans le chemin n'est pas refusée non plus.
   *
   * Il n'y a PAS de SSRF ici : le SDK MinIO traite la valeur comme une clé
   * d'objet, pas comme une adresse, et rien n'est joint. Le défaut est de ne
   * pas dire non — le durcissement doit refuser cette forme avant même de
   * toucher au stockage.
   */
  it('une URL absolue dans les segments est refusée, et non transmise', async () => {
    // Il n'y avait pas de SSRF — le SDK traite la valeur comme une clé. Le
    // défaut était de ne pas dire non : la forme est désormais refusée avant
    // de toucher au stockage.
    const r = await demander('media', ['https:', '', 'evil.example', 'x.mp4']);
    expect(r.statut).toBe(404);
    expect(etat.journal).toEqual([]);
  });

  /**
   * DEVRA CHANGER — aucune notion de périmètre utilisateur.
   *
   * Les clés de Studiio commencent par l'identifiant du propriétaire
   * (`{userId}/library/…`, `{userId}/rendus/…`). La route ne le sait pas.
   */
  it('une clé préfixée par l identifiant d un AUTRE utilisateur est servie', async () => {
    const octets = deposer('media', 'utilisateur-B/rendus/job-77.webm', 'MONTAGE-DE-B');
    session.courante = { user: { id: 'utilisateur-A' } };
    const r = await demander('media', ['utilisateur-B', 'rendus', 'job-77.webm']);
    expect(r.statut).toBe(200);
    expect(r.corps.equals(octets)).toBe(true);
  });
});

describe('CARACTÉRISATION — Range, 206 et 416', () => {
  const TAILLE = 4096;
  const FIXTURE = (() => {
    const b = Buffer.alloc(TAILLE);
    for (let i = 0; i < TAILLE; i += 1) b[i] = i % 251;
    return b;
  })();

  beforeEach(() => { deposer('videos', 'u1/rush.mp4', FIXTURE); });

  it('sans Range, la réponse est un 200 complet qui annonce accepter les tranches', async () => {
    const r = await demander('videos', ['u1', 'rush.mp4']);
    expect(r.statut).toBe(200);
    expect(r.entetes.get('accept-ranges')).toBe('bytes');
    expect(r.entetes.get('content-range')).toBeNull();
    expect(r.corps.length).toBe(TAILLE);
    expect(etat.journal.at(-1)?.op).toBe('objet');
  });

  it('`bytes=0-1023` rend un 206 avec un Content-Range exact et une lecture PARTIELLE', async () => {
    const r = await demander('videos', ['u1', 'rush.mp4'], { range: 'bytes=0-1023' });
    expect(r.statut).toBe(206);
    expect(r.entetes.get('content-range')).toBe(`bytes 0-1023/${TAILLE}`);
    expect(Number(r.entetes.get('content-length'))).toBe(1024);
    expect(r.corps.equals(FIXTURE.subarray(0, 1024))).toBe(true);
    expect(etat.journal.at(-1)).toMatchObject({ op: 'partiel', debut: 0, longueur: 1024 });
  });

  it('`bytes=N-` va jusqu à la fin', async () => {
    const debut = TAILLE - 512;
    const r = await demander('videos', ['u1', 'rush.mp4'], { range: `bytes=${debut}-` });
    expect(r.statut).toBe(206);
    expect(r.entetes.get('content-range')).toBe(`bytes ${debut}-${TAILLE - 1}/${TAILLE}`);
    expect(etat.journal.at(-1)).toMatchObject({ op: 'partiel', debut, longueur: 512 });
  });

  it('`bytes=-N` rend les N DERNIERS octets — la sonde d atome `moov`', async () => {
    const r = await demander('videos', ['u1', 'rush.mp4'], { range: 'bytes=-256' });
    expect(r.statut).toBe(206);
    expect(r.entetes.get('content-range')).toBe(`bytes ${TAILLE - 256}-${TAILLE - 1}/${TAILLE}`);
    expect(r.corps.equals(FIXTURE.subarray(TAILLE - 256))).toBe(true);
  });

  it('une fin au-delà de la taille est ramenée au dernier octet', async () => {
    const r = await demander('videos', ['u1', 'rush.mp4'], { range: 'bytes=4000-999999' });
    expect(r.statut).toBe(206);
    expect(r.entetes.get('content-range')).toBe(`bytes 4000-${TAILLE - 1}/${TAILLE}`);
  });

  it('un début hors fichier est refusé en 416, sans ouvrir un octet', async () => {
    const r = await demander('videos', ['u1', 'rush.mp4'], { range: 'bytes=999999-1000000' });
    expect(r.statut).toBe(416);
    expect(r.entetes.get('content-range')).toBe(`bytes */${TAILLE}`);
    expect(r.corps.length).toBe(0);
    expect(octetsOuverts()).toEqual([]);
  });

  /**
   * Un `Range` que la regex `^bytes=(\d*)-(\d*)$` ne reconnaît pas est IGNORÉ,
   * et le fichier entier part en 200. La RFC 7233 §3.1 dit bien qu'une unité
   * inconnue s'ignore ; elle dit aussi qu'un `bytes=` à tranches multiples est
   * légitime — la route n'en sert alors que… tout. Décrit, pas jugé.
   */
  it.each([
    ['une unité inconnue', 'octets=0-10'],
    ['une syntaxe absente', 'nimporte quoi'],
    ['des tranches multiples', 'bytes=0-9,20-29'],
    ['un espace intérieur', 'bytes= 0-10'],
  ])('%s : l en-tête est ignoré et le fichier ENTIER est servi en 200', async (_n, range) => {
    const r = await demander('videos', ['u1', 'rush.mp4'], { range });
    expect(r.statut).toBe(200);
    expect(r.corps.length).toBe(TAILLE);
  });

  /**
   * `bytes=20-10` passe la regex : deux nombres, donc `start=20`, `end=10`.
   * `start > end` déclenche le 416 — c'est le comportement attendu par la RFC
   * pour un intervalle non satisfaisable, et il est ici correct.
   */
  it('un intervalle inversé est refusé en 416, sans ouvrir un octet', async () => {
    const r = await demander('videos', ['u1', 'rush.mp4'], { range: 'bytes=20-10' });
    expect(r.statut).toBe(416);
    expect(r.entetes.get('content-range')).toBe(`bytes */${TAILLE}`);
    expect(octetsOuverts()).toEqual([]);
  });

  /**
   * La curiosité du parseur, notée pour qu'elle ne surprenne personne : les
   * deux bornes vides passent la regex, aucune branche ne s'applique, et la
   * route rend un 206 « partiel » qui couvre tout le fichier.
   */
  it('`bytes=-` rend un 206 qui couvre le fichier entier', async () => {
    const r = await demander('videos', ['u1', 'rush.mp4'], { range: 'bytes=-' });
    expect(r.statut).toBe(206);
    expect(r.entetes.get('content-range')).toBe(`bytes 0-${TAILLE - 1}/${TAILLE}`);
    expect(r.corps.length).toBe(TAILLE);
    expect(etat.journal.at(-1)).toMatchObject({ op: 'partiel', debut: 0, longueur: TAILLE });
  });

  /**
   * DEVRA CHANGER — le 416 est un ORACLE DE TAILLE.
   *
   * `Content-Range: bytes *\/4096` révèle la taille exacte d'un objet privé à
   * qui n'y a pas droit, sans même le servir. Après durcissement, ce 416 ne
   * doit jamais précéder le contrôle d'accès.
   */
  it('le 416 divulgue la taille exacte de l objet, à une requête sans session', async () => {
    const r = await demander('videos', ['u1', 'rush.mp4'], { range: 'bytes=999999-' });
    expect(r.statut).toBe(416);
    expect(r.entetes.get('content-range')).toContain(String(TAILLE));
  });
});

describe('CARACTÉRISATION — HEAD', () => {
  it('HEAD rend la taille et `Accept-Ranges` sans ouvrir un octet', async () => {
    const octets = deposer('videos', 'u1/rush.mp4', Buffer.alloc(2048));
    const r = await sonder('videos', ['u1', 'rush.mp4']);
    expect(r.statut).toBe(200);
    expect(Number(r.entetes.get('content-length'))).toBe(octets.length);
    expect(r.entetes.get('accept-ranges')).toBe('bytes');
    expect(r.corps.length).toBe(0);
    expect(octetsOuverts()).toEqual([]);
  });

  /**
   * DEVRA CHANGER — HEAD est un ORACLE D'EXISTENCE.
   *
   * Les clés de Studiio sont déterministes. Un HEAD qui distingue 200 et 404
   * sans session permet d'énumérer ce que possède un utilisateur.
   */
  it('HEAD distingue présent (200) et absent (404), sans aucune session', async () => {
    deposer('media', 'u1/existe.jpg', 'X');
    expect((await sonder('media', ['u1', 'existe.jpg'])).statut).toBe(200);
    expect((await sonder('media', ['u1', 'absent.jpg'])).statut).toBe(404);
  });

  it('HEAD porte les mêmes en-têtes de cache, de type et de CORS que GET', async () => {
    deposer('media', 'u1/a.jpg', 'X');
    const tete = await sonder('media', ['u1', 'a.jpg']);
    const complet = await demander('media', ['u1', 'a.jpg']);
    for (const nom of ['cache-control', 'access-control-allow-origin', 'content-type']) {
      expect(tete.entetes.get(nom), nom).toBe(complet.entetes.get(nom));
    }
  });
});

describe('CARACTÉRISATION — cache et CORS', () => {
  beforeEach(() => { deposer('media', 'u1/rendus/job.webm', 'MONTAGE'); });

  /**
   * DEVRA CHANGER — LE point du cahier des charges.
   *
   * `public` autorise TOUT intermédiaire (proxy d'entreprise, CDN, cache
   * partagé de navigateur) à conserver et à re-servir un média privé pendant
   * une heure. C'est exactement ce que `vignettes.ts` refuse de faire pour les
   * vignettes d'analyse, et pour cette raison-là.
   */
  it('le cache est PRIVÉ — plus aucun intermédiaire ne conserve un média', async () => {
    // `public, max-age=3600` autorisait tout proxy d'entreprise, tout CDN et
    // tout cache partagé à conserver et re-servir un média privé une heure.
    const r = await demander('media', ['u1', 'rendus', 'job.webm']);
    const cache = r.entetes.get('cache-control') ?? '';
    expect(cache).toContain('private');
    expect(cache).toContain('no-store');
    expect(cache).not.toContain('public');
  });

  /**
   * `*` est aujourd'hui NÉCESSAIRE : le compositeur client dessine les frames
   * d'un rush sur un canvas, et un canvas taint rend `captureStream()` vide.
   * Le durcissement doit le restreindre à l'origine de l'application, pas le
   * supprimer. Voir `src/lib/video-composer.ts` (`loadVideo`).
   */
  it('le CORS n est plus ouvert à toutes les origines', async () => {
    // `*` donnait à n'importe quelle page web une primitive de lecture sur
    // nos octets. Il est désormais restreint — et une requête sans `Origin`
    // (Remotion, fetch serveur, Meta, TikTok) n'en reçoit aucun, ce dont elle
    // n'a pas besoin.
    const r = await demander('media', ['u1', 'rendus', 'job.webm']);
    expect(r.entetes.get('access-control-allow-origin')).not.toBe('*');
  });

  it('OPTIONS reste un 204 de préflight, sans toucher au stockage', async () => {
    const res = await OPTIONS(
      new Request('http://x/storage/v1/object/public/media/u1/a.mp4',
        { headers: { origin: ORIGINE_APP } }) as never,
    );
    expect(res.status).toBe(204);
    // Restreint à l'origine de l'application, plus jamais `*`.
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGINE_APP);
    expect(res.headers.get('vary')).toBe('Origin');
    expect(etat.journal).toEqual([]);
  });

  it('une origine étrangère ne reçoit AUCUN en-tête CORS', async () => {
    const r = await demander('media', ['u1', 'rendus', 'job.webm'],
      { origin: 'https://evil.example' });
    expect(r.entetes.get('access-control-allow-origin')).toBeNull();
    expect(r.entetes.get('vary')).toBe('Origin');
  });
});

describe('CARACTÉRISATION — le type MIME', () => {
  it.each([
    ['mp4', 'video/mp4'], ['webm', 'video/webm'], ['mov', 'video/quicktime'],
    ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['png', 'image/png'],
    ['mp3', 'audio/mpeg'], ['wav', 'audio/wav'], ['json', 'application/json'],
  ])('l extension `.%s` décide du type : %s', async (ext, type) => {
    deposer('media', `u1/a.${ext}`, 'X');
    const r = await demander('media', ['u1', `a.${ext}`]);
    expect(r.entetes.get('content-type')).toBe(type);
  });

  it('une extension inconnue rend `application/octet-stream`', async () => {
    deposer('media', 'u1/a.bin', 'X');
    expect((await demander('media', ['u1', 'a.bin'])).entetes.get('content-type'))
      .toBe('application/octet-stream');
  });

  it('l extension est comparée en minuscules', async () => {
    deposer('media', 'u1/A.JPG', 'X');
    expect((await demander('media', ['u1', 'A.JPG'])).entetes.get('content-type'))
      .toBe('image/jpeg');
  });

  /**
   * DEVRA CHANGER — le type stocké l'emporte, et il n'est pas de nous.
   *
   * Le `content-type` des métadonnées MinIO est fixé au dépôt. Un objet déposé
   * en `text/html` est donc servi en `text/html` DEPUIS NOTRE ORIGINE, sans
   * `X-Content-Type-Options: nosniff`, sans `Content-Disposition`, et sans
   * politique de sécurité de contenu. C'est un XSS de même origine.
   * `analyses/[id]/vignettes/[n]` pose les trois en-têtes et DÉCIDE le type
   * lui-même — c'est le modèle à reprendre.
   */
  it('le type des métadonnées NE l emporte plus — le XSS stocké est fermé', async () => {
    // C'était le défaut le plus grave du lot. Le `Content-Type` venait des
    // métadonnées de l'objet, or ce type est choisi par celui qui téléverse :
    // les trois chemins d'envoi recopient l'en-tête du navigateur, et
    // `sanitizeStorageFilename` conserve les points sans liste d'extensions.
    // Un compte pouvait donc faire servir du HTML depuis notre origine —
    // celle de la session NextAuth.
    deposer('media', 'u1/piege.jpg', '<script>alert(1)</script>',
      { 'content-type': 'text/html' });
    const r = await demander('media', ['u1', 'piege.jpg']);
    expect(r.entetes.get('content-type')).not.toContain('text/html');
    expect(r.entetes.get('x-content-type-options')).toBe('nosniff');
    expect(r.entetes.get('content-disposition')).toBeTruthy();
  });
});

describe('CARACTÉRISATION — objet absent et panne du stockage', () => {
  it('un objet absent rend un 404 JSON `{"error":"not found"}`', async () => {
    const r = await demander('media', ['u1', 'nexiste-pas.mp4']);
    expect(r.statut).toBe(404);
    expect(JSON.parse(r.texte)).toEqual({ error: 'not found' });
    expect(octetsOuverts()).toEqual([]);
  });

  it('un objet absent rend un 404 SANS corps en HEAD', async () => {
    const r = await sonder('media', ['u1', 'nexiste-pas.mp4']);
    expect(r.statut).toBe(404);
    expect(r.corps.length).toBe(0);
  });

  /**
   * DEVRA CHANGER — le message brut du stockage sort tel quel.
   *
   * Il peut porter le nom d'hôte interne, le compartiment, la clé. Un message
   * d'erreur est une surface de reconnaissance ; les routes récentes
   * (`vignettes/[n]`) rendent un motif fermé, jamais le message d'en dessous.
   */
  it('une panne ne recopie plus le message du stockage', async () => {
    // Le 500 rendait `err.message` : hôte interne, compartiment et cause.
    const silence = vi.spyOn(console, 'error').mockImplementation(() => {});
    etat.panne = 'connect ECONNREFUSED studiio-minio:9000 (bucket=media)';
    const r = await demander('media', ['u1', 'a.mp4']);
    expect(r.statut).toBe(500);
    expect(r.texte).not.toContain('studiio-minio:9000');
    expect(r.texte).not.toContain('ECONNREFUSED');
    silence.mockRestore();
  });

  it('la même panne rend un 500 muet en HEAD', async () => {
    etat.panne = 'panne';
    const r = await sonder('media', ['u1', 'a.mp4']);
    expect(r.statut).toBe(500);
    expect(r.corps.length).toBe(0);
  });
});

describe('CARACTÉRISATION — l interrupteur STORAGE_PROVIDER', () => {
  afterEach(() => {
    process.env.STORAGE_PROVIDER = 's3';
    vi.resetModules();
  });

  /**
   * Le seul verrou existant, et il est global : il coupe la route pour tout le
   * monde, y compris pour les usages légitimes. Ce n'est donc pas une réponse
   * au problème d'accès — mais c'est un fait à connaître avant de refondre le
   * fichier.
   */
  it('avec `STORAGE_PROVIDER != s3`, GET et HEAD rendent 404 sans toucher au stockage', async () => {
    vi.resetModules();
    process.env.STORAGE_PROVIDER = 'supabase';
    const desactivee = await import('@/app/storage/v1/object/public/[bucket]/[...path]/route');

    const req = () => requete('media', ['u1', 'a.mp4']);
    const ctx = () => contexte('media', ['u1', 'a.mp4']);
    const get = await lireReponse(
      await (desactivee.GET as unknown as Gestionnaire)(req(), ctx()),
    );
    const head = await lireReponse(
      await (desactivee.HEAD as unknown as Gestionnaire)(req(), ctx()),
    );

    expect(get.statut).toBe(404);
    expect(JSON.parse(get.texte).error).toContain('storage proxy disabled');
    expect(head.statut).toBe(404);
    expect(etat.journal).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. SÉCURITÉ — ce qui devra passer APRÈS le durcissement
//
// La garde ci-dessous ÉCHOUE tant que le durcissement manque, et elle NOMME ce
// qui manque. C'est voulu, et c'est le modèle de
// `autopilote-m3b2-gros-fichiers.test.ts` : sans elle, un `skipIf` rendrait ce
// bloc vert en ne vérifiant rien, pour toujours.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Les signaux du durcissement, cherchés dans le source de la route.
 *
 * Un signal absent ne dit pas seulement « le test est mis de côté » : il dit
 * QUOI poser. Si le durcissement nomme les choses autrement, corriger cette
 * liste — jamais l'assouplir.
 */
const SIGNAUX_DURCISSEMENT: Array<[string, (code: string) => boolean]> = [
  ['une AUTHENTIFICATION : la route n importe aucun module de session '
    + '(attendu : `@/lib/auth/config`)',
  (c) => c.includes('@/lib/auth/config')],
  ['une LISTE BLANCHE DE COMPARTIMENT : le nom vient du navigateur sans filtre '
    + '(attendu : `bucketAutorise` de `@/lib/storage/buckets`)',
  (c) => /bucketAutorise|ALLOWED_BUCKETS/.test(c)],
  ['une VÉRIFICATION DE PROPRIÉTÉ : rien ne rattache la clé à un utilisateur '
    + '(attendu : un préfixe `userId` comparé à la session)',
  (c) => /user_id|userId/.test(c)],
  ['un CACHE PRIVÉ : l en-tête annonce encore `public, max-age=3600` '
    + '(attendu : `private, no-store`)',
  (c) => !c.includes("'public, max-age") && c.includes('private')],
];

const signauxManquants = SIGNAUX_DURCISSEMENT
  .filter(([, present]) => !present(CODE_ROUTE)).map(([nom]) => nom);
const durcissementPresent = signauxManquants.length === 0;

/**
 * ⚠️ LA GARDE EST SCINDÉE, ET C'EST UNE DÉCISION, PAS UN ASSOUPLISSEMENT.
 *
 * Elle exigeait les quatre signaux ensemble. Ce lot en livre DEUX — la liste
 * blanche de compartiment et le cache privé — et laisse délibérément les deux
 * autres. Exiger une session sur cette route couperait sept chemins, dont la
 * publication Instagram, Facebook et TikTok : ce sont les serveurs de Meta et
 * de TikTok qui viennent chercher le fichier, sans session et sans pouvoir en
 * obtenir une. La fermeture demande une séquence en quatre étapes et une URL
 * présignée ; elle fait l'objet du lot suivant.
 *
 * Une garde tout-ou-rien serait restée rouge en ne disant plus rien de ce qui
 * a été fait. Scindée, elle vérifie ce qui a atterri ET nomme ce qui reste,
 * sans qu'aucun des deux ne puisse être oublié.
 */
const SIGNAUX_LIVRES = ['une LISTE BLANCHE', 'un CACHE PRIVÉ'];
const manquantsLivres = signauxManquants
  .filter((n) => SIGNAUX_LIVRES.some((l) => n.startsWith(l)));
const manquantsReportes = signauxManquants
  .filter((n) => !SIGNAUX_LIVRES.some((l) => n.startsWith(l)));

describe('La garde du durcissement', () => {
  it('ce que CE lot devait poser est bien posé', () => {
    expect(
      manquantsLivres,
      `${CHEMIN_ROUTE} : un durcissement annoncé par ce lot a disparu.`,
    ).toEqual([]);
  });

  it('ce qui reste ouvert est NOMMÉ, et attend le lot suivant', () => {
    // Ce test ne juge pas : il tient l'inventaire. Le jour où la session
    // arrivera, il deviendra rouge — et ce rouge dira « mets à jour la
    // liste », ce qui est exactement le bon signal.
    expect(manquantsReportes.length,
      'la session et la vérification de propriété sont désormais présentes : '
      + 'retirer ce test et activer le bloc SÉCURITÉ ci-dessous.').toBe(2);
    expect(durcissementPresent).toBe(false);
  });
});

/**
 * Un refus, quelle que soit la forme choisie par le durcissement.
 *
 * 401 (pas de session), 403 (session sans droit) et 404 (refus indistinct, le
 * choix de `vignettes/[n]`) sont tous des refus acceptables. Ce qui ne l'est
 * pas, c'est un 200, un 206 ou un 416 — ce dernier divulguant la taille.
 */
const REFUS = [401, 403, 404];
const PROPRIO = 'utilisateur-A';
const AUTRUI = 'utilisateur-B';

describe.skipIf(!durcissementPresent)('SÉCURITÉ — l accès sans droit est refusé', () => {
  beforeEach(() => { deposer('media', `${PROPRIO}/library/rush.mp4`, 'PRIVE'); });

  it('sans session, un objet privé est refusé et aucun octet n est ouvert', async () => {
    session.courante = null;
    const r = await demander('media', [PROPRIO, 'library', 'rush.mp4']);
    expect(REFUS, `statut ${r.statut}`).toContain(r.statut);
    expect(octetsOuverts()).toEqual([]);
  });

  it('l utilisateur A ne lit jamais l objet de B', async () => {
    session.courante = { user: { id: AUTRUI } };
    const r = await demander('media', [PROPRIO, 'library', 'rush.mp4']);
    expect(REFUS, `statut ${r.statut}`).toContain(r.statut);
    expect(r.texte).not.toContain('PRIVE');
    expect(octetsOuverts()).toEqual([]);
  });

  it('le propriétaire, lui, lit son objet — le durcissement ne casse pas l usage', async () => {
    session.courante = { user: { id: PROPRIO } };
    const r = await demander('media', [PROPRIO, 'library', 'rush.mp4']);
    expect(r.statut).toBe(200);
    expect(r.texte).toBe('PRIVE');
  });

  it.each<[string, string]>([
    ['hors liste blanche', 'prive'],
    ['de sauvegarde', 'backups'],
    ['vide', ''],
    ['une remontée', '..'],
    ['un caractère de chemin', 'media/../prive'],
  ])('un compartiment %s est refusé sans lecture', async (_n, bucket) => {
    session.courante = { user: { id: PROPRIO } };
    deposer(bucket, `${PROPRIO}/a.mp4`, 'X');
    const r = await demander(bucket, [PROPRIO, 'a.mp4']);
    expect(REFUS, `${bucket} → ${r.statut}`).toContain(r.statut);
    expect(octetsOuverts()).toEqual([]);
  });

  it.each<[string, string[]]>([
    ['une remontée `..`', [PROPRIO, '..', AUTRUI, 'prive.mp4']],
    ['une remontée encodée', [PROPRIO, '%2e%2e', AUTRUI, 'prive.mp4']],
    ['une URL absolue', ['https:', '', 'evil.example', 'x.mp4']],
    ['un chemin absolu', ['', 'etc', 'passwd']],
    ['une antislash', [`${PROPRIO}\\..\\${AUTRUI}`, 'x.mp4']],
    ['un octet nul', [`${PROPRIO}`, 'a.mp4 .jpg']],
    ['le préfixe d autrui', [AUTRUI, 'library', 'rush.mp4']],
    ['aucun préfixe', ['library', 'rush.mp4']],
    ['un préfixe seulement RESSEMBLANT', [`${PROPRIO}B`, 'library', 'rush.mp4']],
  ])('%s dans la clé est refusée sans lecture', async (_n, chemin) => {
    session.courante = { user: { id: PROPRIO } };
    const r = await demander('media', chemin);
    expect(REFUS, `${chemin.join('/')} → ${r.statut}`).toContain(r.statut);
    expect(octetsOuverts()).toEqual([]);
  });
});

describe.skipIf(!durcissementPresent)('SÉCURITÉ — Range, HEAD et les oracles', () => {
  const TAILLE = 4096;
  beforeEach(() => { deposer('videos', `${PROPRIO}/rush.mp4`, Buffer.alloc(TAILLE, 7)); });

  it('un Range sur l objet d autrui est refusé — ni 206, ni 416, ni Content-Range', async () => {
    session.courante = { user: { id: AUTRUI } };
    const r = await demander('videos', [PROPRIO, 'rush.mp4'], { range: 'bytes=0-1023' });
    expect(REFUS, `statut ${r.statut}`).toContain(r.statut);
    expect(r.entetes.get('content-range'), 'oracle de taille').toBeNull();
    expect(r.texte).not.toContain(String(TAILLE));
    expect(octetsOuverts()).toEqual([]);
  });

  it('un Range hors bornes sur l objet d autrui ne rend pas 416 — il refuse', async () => {
    session.courante = { user: { id: AUTRUI } };
    const r = await demander('videos', [PROPRIO, 'rush.mp4'], { range: 'bytes=999999-' });
    expect(r.statut).not.toBe(416);
    expect(REFUS, `statut ${r.statut}`).toContain(r.statut);
  });

  it('le propriétaire garde le 206 et le Content-Range exact — le seek survit', async () => {
    session.courante = { user: { id: PROPRIO } };
    const r = await demander('videos', [PROPRIO, 'rush.mp4'], { range: 'bytes=0-1023' });
    expect(r.statut).toBe(206);
    expect(r.entetes.get('content-range')).toBe(`bytes 0-1023/${TAILLE}`);
    expect(r.entetes.get('accept-ranges')).toBe('bytes');
    expect(r.corps.length).toBe(1024);
  });

  it('HEAD suit exactement les mêmes règles que GET — aucun oracle d existence', async () => {
    session.courante = { user: { id: AUTRUI } };
    const present = await sonder('videos', [PROPRIO, 'rush.mp4']);
    const absent = await sonder('videos', [PROPRIO, 'nexiste-pas.mp4']);
    expect(REFUS, `présent → ${present.statut}`).toContain(present.statut);
    expect(present.statut, 'présent et absent doivent être indiscernables')
      .toBe(absent.statut);
    expect(present.entetes.get('content-length'))
      .toBe(absent.entetes.get('content-length'));
    expect(octetsOuverts()).toEqual([]);
  });

  it('HEAD reste disponible pour le propriétaire — la sonde du Calendrier en dépend', async () => {
    session.courante = { user: { id: PROPRIO } };
    const r = await sonder('videos', [PROPRIO, 'rush.mp4']);
    expect(r.statut).toBe(200);
    expect(Number(r.entetes.get('content-length'))).toBe(TAILLE);
    expect(r.entetes.get('accept-ranges')).toBe('bytes');
  });
});

describe.skipIf(!durcissementPresent)('SÉCURITÉ — rien ne fuit, rien ne se met en cache', () => {
  const SECRETS = [
    'secret-de-test', 'studiio-minio', 'MINIO_SECRET_KEY', 'MINIO_ACCESS_KEY',
    'X-Amz-Signature', 'x-amz-credential', 'AWS4-HMAC',
  ];

  it('un refus ne rend ni la clé, ni le compartiment, ni l hôte du stockage', async () => {
    deposer('media', `${PROPRIO}/library/rush-tres-identifiable.mp4`, 'X');
    session.courante = { user: { id: AUTRUI } };
    const r = await demander('media', [PROPRIO, 'library', 'rush-tres-identifiable.mp4']);
    const tout = toutCeQueLaReponseMontre(r);
    for (const fuite of ['rush-tres-identifiable', 'library', PROPRIO, 'studiio-minio', 'bucket']) {
      expect(tout, `fuite : ${fuite}`).not.toContain(fuite);
    }
  });

  it('une panne du stockage ne recopie plus le message d en dessous', async () => {
    const silence = vi.spyOn(console, 'error').mockImplementation(() => {});
    deposer('media', `${PROPRIO}/a.mp4`, 'X');
    session.courante = { user: { id: PROPRIO } };
    etat.panne = 'connect ECONNREFUSED studiio-minio:9000 (bucket=media)';
    const r = await demander('media', [PROPRIO, 'a.mp4']);
    expect(r.texte).not.toContain('studiio-minio');
    expect(r.texte).not.toContain('ECONNREFUSED');
    silence.mockRestore();
  });

  it('aucune réponse ne porte de secret ni de signature', async () => {
    deposer('media', `${PROPRIO}/a.mp4`, 'X');
    for (const identite of [null, { user: { id: PROPRIO } }, { user: { id: AUTRUI } }]) {
      session.courante = identite;
      // eslint-disable-next-line no-await-in-loop
      const r = await demander('media', [PROPRIO, 'a.mp4']);
      const tout = toutCeQueLaReponseMontre(r).toLowerCase();
      for (const secret of SECRETS) {
        expect(tout, `secret : ${secret}`).not.toContain(secret.toLowerCase());
      }
    }
  });

  it('AUCUN cache public pour un média privé — même servi à son propriétaire', async () => {
    deposer('media', `${PROPRIO}/rendus/job.webm`, 'MONTAGE');
    session.courante = { user: { id: PROPRIO } };
    const r = await demander('media', [PROPRIO, 'rendus', 'job.webm']);
    expect(r.statut).toBe(200);
    const cache = r.entetes.get('cache-control') ?? '';
    expect(cache, 'un intermédiaire ne doit pas conserver un média privé')
      .not.toContain('public');
    expect(cache).toContain('private');
  });

  it('le CORS n est plus ouvert à toutes les origines', async () => {
    deposer('media', `${PROPRIO}/a.mp4`, 'X');
    session.courante = { user: { id: PROPRIO } };
    const r = await demander('media', [PROPRIO, 'a.mp4']);
    expect(r.entetes.get('access-control-allow-origin')).not.toBe('*');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. NON-RÉGRESSION — les usages qui doivent survivre au durcissement
//
// Chaque requête est faite au nom du PROPRIÉTAIRE de la clé. C'est vrai
// aujourd'hui (la session est ignorée) et devra l'être demain (elle autorise) :
// ces tests passent donc AVANT et APRÈS, ce qui est tout leur intérêt.
// ═══════════════════════════════════════════════════════════════════════════

describe('NON-RÉGRESSION — les quatre compartiments continuent de servir', () => {
  beforeEach(() => { session.courante = { user: { id: PROPRIO } }; });

  it.each<[string, string, string, string]>([
    ['aperçu vidéo et rendu final — montage WebM', 'media', 'rendus/job-77.webm', 'video/webm'],
    ['bibliothèque et calendrier — rush MP4', 'videos', 'library/rush.mp4', 'video/mp4'],
    ['affiche et images de carte', 'images', 'affiches/poster.jpg', 'image/jpeg'],
    ['studio son — musique et voix', 'audio', 'voix/seq-1.mp3', 'audio/mpeg'],
  ])('%s', async (_usage, bucket, suffixe, type) => {
    const cle = `${PROPRIO}/${suffixe}`;
    const octets = deposer(bucket, cle, `OCTETS-${bucket}`);
    const r = await demander(bucket, cle.split('/'));
    expect(r.statut).toBe(200);
    expect(r.entetes.get('content-type')).toBe(type);
    expect(r.entetes.get('accept-ranges')).toBe('bytes');
    expect(Number(r.entetes.get('content-length'))).toBe(octets.length);
    expect(r.corps.equals(octets)).toBe(true);
  });

  it('les quatre compartiments de la liste blanche sont tous servis', async () => {
    const { ALLOWED_BUCKETS } = await import('@/lib/storage/buckets');
    for (const bucket of ALLOWED_BUCKETS) {
      deposer(bucket, `${PROPRIO}/a.mp4`, bucket);
      // eslint-disable-next-line no-await-in-loop
      const r = await demander(bucket, [PROPRIO, 'a.mp4']);
      expect(r.statut, bucket).toBe(200);
      expect(r.texte, bucket).toBe(bucket);
    }
  });

  it('le seek vidéo survit : Range rend un 206 avec la bonne tranche', async () => {
    const octets = deposer('videos', `${PROPRIO}/rush.mp4`, Buffer.alloc(8192, 3));
    const r = await demander('videos', [PROPRIO, 'rush.mp4'], { range: 'bytes=4096-8191' });
    expect(r.statut).toBe(206);
    expect(r.entetes.get('content-range')).toBe('bytes 4096-8191/8192');
    expect(r.corps.equals(octets.subarray(4096))).toBe(true);
  });

  /**
   * La sonde décrite dans CLAUDE.md : le Calendrier fait un HEAD avant de
   * charger une vidéo, et saute la séquence si le serveur n'annonce pas les
   * tranches. Sans HEAD, toutes les séquences vidéo disparaissent de l'aperçu.
   */
  it('la sonde HEAD du Calendrier survit : taille et `Accept-Ranges`', async () => {
    deposer('videos', `${PROPRIO}/rush.mp4`, Buffer.alloc(1234));
    const r = await sonder('videos', [PROPRIO, 'rush.mp4']);
    expect(r.statut).toBe(200);
    expect(r.entetes.get('accept-ranges')).toBe('bytes');
    expect(Number(r.entetes.get('content-length'))).toBe(1234);
  });

  /**
   * Le téléchargement « export bureau » : le corps complet et un
   * `Content-Length` exact, sinon le fichier arrive tronqué.
   */
  it('le téléchargement complet rend un Content-Length exact et tous les octets', async () => {
    const octets = deposer('media', `${PROPRIO}/rendus/job.webm`, Buffer.alloc(65536, 9));
    const r = await demander('media', [PROPRIO, 'rendus', 'job.webm']);
    expect(Number(r.entetes.get('content-length'))).toBe(65536);
    expect(r.corps.length).toBe(65536);
    expect(r.corps.equals(octets)).toBe(true);
  });

  /**
   * Le compositeur client dessine les frames du rush sur un canvas. Sans
   * en-tête CORS, le canvas est taint et `captureStream()` sort du vide : la
   * séquence vidéo disparaît de TOUS les montages refaits côté navigateur. Le
   * durcissement peut restreindre l'origine ; il ne peut pas la supprimer.
   */
  it('un en-tête CORS reste émis pour NOTRE origine — le canvas en dépend', async () => {
    // `loadImage` du compositeur pose `crossOrigin`, donc le navigateur envoie
    // un `Origin`. Sans en-tête en retour, le canvas est taint et
    // `captureStream()` sort du vide : la séquence vidéo disparaît de tous les
    // montages refaits côté navigateur. Restreindre l'origine suffit ;
    // la supprimer aurait cassé ce chemin.
    deposer('media', `${PROPRIO}/rendus/job.webm`, 'X');
    const r = await demander('media', [PROPRIO, 'rendus', 'job.webm'],
      { origin: ORIGINE_APP });
    expect(r.entetes.get('access-control-allow-origin')).toBe(ORIGINE_APP);
    expect(r.entetes.get('access-control-expose-headers') ?? '')
      .toContain('Content-Range');
  });

  it('le préflight OPTIONS reste un 204', async () => {
    // Appelé avec l'origine de l'application, comme le ferait le navigateur.
    const res = await OPTIONS(
      new Request('http://x/storage/v1/object/public/media/u1/a.mp4',
        { headers: { origin: ORIGINE_APP } }) as never,
    );
    expect(res.status).toBe(204);
  });
});

describe('NON-RÉGRESSION — les producteurs de cette URL, et ce qui les casserait', () => {
  /**
   * Cinq endroits FABRIQUENT ce chemin et l'écrivent en base. Si la forme de
   * l'URL change, les cinq changent avec elle — et tout ce qui est déjà stocké
   * devient injoignable.
   */
  const PRODUCTEURS = [
    'src/lib/storage/s3-client.ts',
    'src/lib/db/supabase.ts',
    'src/lib/rendus/cible-upload.ts',
    'src/app/api/upload/signed-url/route.ts',
    'src/app/api/upload/multipart/route.ts',
  ];

  it.each(PRODUCTEURS)('%s fabrique encore ce chemin', (fichier) => {
    expect(existsSync(racine(fichier)), fichier).toBe(true);
    expect(source(fichier), fichier).toContain('/storage/v1/object/public');
  });

  /**
   * Le rendu serveur NE dépend PAS de cette route : `fetch-media.ts` reconnaît
   * le préfixe et va lire MinIO EN DIRECT, par le réseau Docker interne. C'est
   * une bonne nouvelle pour le durcissement — le pipeline de rendu ne sera pas
   * cassé par une exigence de session.
   */
  it('le rendu serveur court-circuite la route et lit MinIO en direct', () => {
    const code = source('src/lib/storage/fetch-media.ts');
    expect(code).toContain("const STORAGE_PROXY_PREFIX = '/storage/v1/object/public/'");
    expect(code).toContain('downloadFromMinioInternal');
    expect(sansCommentaires(code)).toContain("require('minio')");
  });

  /**
   * LE POINT DE RUPTURE N°1 — la publication sociale.
   *
   * `ensurePublicUrl` laisse passer une URL `/storage/v1/object/public/…` TELLE
   * QUELLE vers Instagram, TikTok, Facebook et YouTube. Ce sont LEURS serveurs
   * qui viennent chercher le média, depuis Internet, sans cookie et sans
   * session. Un durcissement par session SEULE coupe la publication.
   *
   * Ce test fixe le fait ; il ne dit pas comment le résoudre.
   */
  it.each([
    'src/app/api/social/publish/route.ts',
    'src/app/api/cron/publish/route.ts',
  ])('%s livre ce chemin tel quel aux plateformes', (fichier) => {
    const code = sansCommentaires(source(fichier));
    expect(code).toContain("if (url.includes('/storage/v1/object/public/')) return url;");
  });

  /**
   * LE POINT DE RUPTURE N°2 — `/api/proxy-media`.
   *
   * Il authentifie SON appelant, puis refait un `fetch` same-origin vers
   * `/storage/v1/object/public/…` SANS transmettre le moindre cookie. Un
   * durcissement par session coupe donc aussi ce relais — et avec lui l'audio
   * et les images du compositeur client.
   */
  it('proxy-media authentifie son appelant mais ne transmet aucun cookie au relais', () => {
    const code = sansCommentaires(source('src/app/api/proxy-media/route.ts'));
    expect(code).toContain('await auth()');
    expect(code).toContain("u.pathname.startsWith('/storage/v1/object/public/')");
    expect(code).toContain("headers: { 'Accept': '*/*' }");
    expect(code, 'aucun cookie transmis au fetch interne')
      .not.toMatch(/headers:\s*\{[^}]*[Cc]ookie/);
  });

  it('la forme de l URL est bien celle que la route sert', () => {
    expect(PREFIXE_PUBLIC).toBe('/storage/v1/object/public/');
    expect(CHEMIN_ROUTE).toContain('app/storage/v1/object/public/[bucket]/[...path]');
    expect(existsSync(racine(CHEMIN_ROUTE))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. GARDE PERMANENTE — aucun code Autopilote ne réintroduit ce chemin
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Les deux racines exigées par le lot, plus les trois écrans qui consomment
 * l'Autopilote. Élargir cette liste est toujours permis ; la réduire ne l'est
 * pas.
 */
const RACINES_AUTOPILOTE = [
  'src/lib/autopilot',
  'src/app/api/autopilot',
  'src/components/creer/AutopilotPanel.tsx',
  'src/components/creer/SessionsTournagePanel.tsx',
  'src/components/creer/AnalyseRush.tsx',
];

function fichiersSources(relatif: string): string[] {
  const complet = racine(relatif);
  if (!existsSync(complet)) return [];
  if (statSync(complet).isFile()) return /\.tsx?$/.test(relatif) ? [relatif] : [];
  return readdirSync(complet).flatMap((entree) => fichiersSources(join(relatif, entree)));
}

/** Les fichiers de test sont hors sujet : une assertion a le droit de citer. */
const estTest = (f: string) =>
  /\.(test|spec)\.tsx?$/.test(f) || f.includes('__tests__');

interface Entree { fichier: string; code: string }

/**
 * LA GARDE, sous forme de fonction pure — c'est ce qui la rend TÉMOIGNABLE.
 *
 * Une garde qui ne lit que le dépôt réel ne peut jamais être vue mordre : elle
 * est verte parce que le dépôt est propre, ou parce qu'elle ne regarde rien, et
 * rien ne distingue les deux. En passant le contenu en argument, on peut lui
 * soumettre une chaîne fautive fabriquée et exiger qu'elle la trouve.
 */
function mentionsInterdites(entrees: Entree[]): string[] {
  return entrees
    .filter((e) => !estTest(e.fichier))
    .filter((e) => sansCommentaires(e.code).includes(PREFIXE_PUBLIC))
    .map((e) => e.fichier);
}

const ENTREES_AUTOPILOTE: Entree[] = RACINES_AUTOPILOTE
  .flatMap(fichiersSources)
  .map((fichier) => ({ fichier, code: source(fichier) }));

describe('GARDE — l Autopilote ne réintroduit jamais la route publique', () => {
  /**
   * Sans ce test, la garde passerait en ne lisant AUCUN fichier — le jour où un
   * dossier est renommé, elle deviendrait verte pour de mauvaises raisons.
   */
  it('les racines surveillées ne sont pas vides', () => {
    for (const r of RACINES_AUTOPILOTE) {
      expect(fichiersSources(r).length, `${r} : aucun fichier surveillé`).toBeGreaterThan(0);
    }
    expect(ENTREES_AUTOPILOTE.length).toBeGreaterThanOrEqual(29);
  });

  it('aucun fichier Autopilote n emploie la route publique de stockage', () => {
    expect(
      mentionsInterdites(ENTREES_AUTOPILOTE),
      'Un code Autopilote emploie la route publique de stockage. Elle sert '
      + 'n importe quel objet sans authentification : y envoyer un contenu '
      + 'privé aggrave un trou connu. Servir les octets depuis une route '
      + 'authentifiée, comme `/api/autopilot/analyses/[id]/vignettes/[n]`.',
    ).toEqual([]);
  });

  it('TÉMOIN — la garde mord sur une chaîne fautive', () => {
    const fautif: Entree[] = [{
      fichier: 'src/lib/autopilot/faux.ts',
      code: `export const u = '${PREFIXE_PUBLIC}media/u1/vignette.jpg';`,
    }];
    expect(mentionsInterdites(fautif)).toEqual(['src/lib/autopilot/faux.ts']);
  });

  it('TÉMOIN — la garde mord aussi sur une concaténation et sur un gabarit', () => {
    const fautifs: Entree[] = [
      { fichier: 'a.ts', code: `const u = '${PREFIXE_PUBLIC}' + bucket + '/' + cle;` },
      { fichier: 'b.ts', code: `const u = \`${PREFIXE_PUBLIC}\${bucket}/\${cle}\`;` },
    ];
    expect(mentionsInterdites(fautifs)).toEqual(['a.ts', 'b.ts']);
  });

  it('TÉMOIN — une mention en commentaire passe, dans les deux syntaxes', () => {
    const commentes: Entree[] = [
      {
        fichier: 'c.ts',
        code: `/**\n * Ne pas utiliser ${PREFIXE_PUBLIC} ici.\n */\nexport const x = 1;`,
      },
      { fichier: 'd.ts', code: `// interdit : ${PREFIXE_PUBLIC}\nexport const y = 2;` },
    ];
    expect(mentionsInterdites(commentes)).toEqual([]);
  });

  it('TÉMOIN — une assertion de test passe', () => {
    const tests: Entree[] = [
      {
        fichier: 'src/__tests__/x.test.ts',
        code: `expect(u).not.toContain('${PREFIXE_PUBLIC}');`,
      },
      { fichier: 'src/lib/autopilot/__tests__/y.ts', code: `const u = '${PREFIXE_PUBLIC}a/b';` },
    ];
    expect(mentionsInterdites(tests)).toEqual([]);
  });

  /**
   * Les deux fichiers qui EXPLIQUENT pourquoi ils n'utilisent pas cette route.
   * Ils doivent rester verts : c'est la preuve que le dépliage des commentaires
   * fonctionne sur du texte réel, pas seulement sur des témoins fabriqués.
   */
  it.each([
    'src/lib/autopilot/analyse/vignettes.ts',
    'src/lib/autopilot/analyse/passerelle.ts',
  ])('%s cite le chemin en commentaire, et reste accepté', (fichier) => {
    expect(source(fichier), `${fichier} doit citer le chemin`).toContain(PREFIXE_PUBLIC);
    expect(mentionsInterdites([{ fichier, code: source(fichier) }])).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. LES VIGNETTES M3-B3 PASSENT EXCLUSIVEMENT PAR LEUR ROUTE
// ═══════════════════════════════════════════════════════════════════════════

describe('GARDE — les vignettes ne passent que par leur route authentifiée', () => {
  const ROUTE_VIGNETTE = 'src/app/api/autopilot/analyses/[id]/vignettes/[n]/route.ts';

  it('la route authentifiée existe, et elle exige une session', () => {
    expect(existsSync(racine(ROUTE_VIGNETTE))).toBe(true);
    const code = sansCommentaires(source(ROUTE_VIGNETTE));
    expect(code).toContain("from '@/lib/auth/config'");
    expect(code).toContain('await auth()');
    expect(code).toContain('401');
  });

  it('l unique fabricant d adresse de vignette produit cette route, et rien d autre', async () => {
    const { cheminVignette } = await import('@/lib/autopilot/analyse/passerelle');
    expect(cheminVignette('an-1', 0)).toBe('/api/autopilot/analyses/an-1/vignettes/0');
    expect(cheminVignette('an-1', 7)).toBe('/api/autopilot/analyses/an-1/vignettes/7');
    expect(cheminVignette('a/b?c', 0)).toBe('/api/autopilot/analyses/a%2Fb%3Fc/vignettes/0');
    for (const index of [0, 3, 11]) {
      expect(cheminVignette('an-2', index)).not.toContain(PREFIXE_PUBLIC);
      expect(cheminVignette('an-2', index)).not.toMatch(/https?:\/\//);
    }
  });

  it('l écran d analyse ne fabrique aucune adresse de vignette par lui-même', () => {
    const ecran = sansCommentaires(source('src/components/creer/AnalyseRush.tsx'));
    expect(ecran).not.toContain(PREFIXE_PUBLIC);
    expect(ecran).not.toContain('/storage/');
    // L'écran passe par la passerelle, il ne recompose pas le chemin.
    expect(ecran).toContain('vignettesAffichables');
  });

  it('la route de vignette ne rend jamais ni compartiment, ni clé, ni URL signée', () => {
    const code = sansCommentaires(source(ROUTE_VIGNETTE));
    for (const interdit of [
      PREFIXE_PUBLIC, 'presignedGetObject', 'presignedPutObject',
      'signeurPublic', 'signeurInterne', 'searchParams',
    ]) {
      expect(code, `${ROUTE_VIGNETTE} : ${interdit}`).not.toContain(interdit);
    }
  });

  it('elle refuse le cache public que le chemin /storage impose', () => {
    const code = source(ROUTE_VIGNETTE);
    expect(code).toContain("'Cache-Control': 'private, no-store, max-age=0'");
    expect(code).toContain("'X-Content-Type-Options': 'nosniff'");
  });
});
