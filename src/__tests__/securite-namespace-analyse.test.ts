// @vitest-environment node
/**
 * M3-B3.2a — LA NON-RÉGRESSION du blocage `media/<x>/analyse/<y>`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER PROUVE, ET CE QU'IL NE PROUVE PAS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Le lot ferme un espace de noms : dans le compartiment `media`, une clé de la
 * forme `<quelque-chose>/analyse/<quelque-chose>` n'est plus servie par
 * `/storage/v1/object/public/…`. C'est là que vivent les vignettes d'analyse
 * (`extraction.ts` : `<userId>/analyse/<analysisId>/vignette-NN.jpg`), dont la
 * clé est DÉTERMINISTE — deux identifiants que le navigateur possède déjà.
 *
 * Le risque de ce lot n'est PAS que le blocage manque. C'est qu'il soit TROP
 * LARGE, et qu'il coupe des rushes, des montages ou des affiches en même temps.
 * Un filtre de chemin qui mord un octet trop loin ne se voit pas en revue : il
 * se voit trois semaines plus tard, sur un aperçu vide, sans rien dans les
 * journaux qui désigne la cause.
 *
 * Ce fichier ne teste donc pas le blocage. Il teste TOUT LE RESTE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LES FAMILLES DE CLÉS SONT RECENSÉES DEPUIS LE CODE, PAS INVENTÉES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Un test de non-régression écrit sur des clés imaginaires ne prouve rien : il
 * garantit que le blocage épargne des chemins que personne n'emprunte. Chaque
 * entrée de `FAMILLES` porte donc le FICHIER qui la fabrique, et un test
 * structurel exige que ce fichier fabrique encore cette forme. Le jour où un
 * `purpose` change de nom, c'est ce test-là qui rougit, et l'inventaire est
 * remis à jour au lieu de vieillir en silence.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUI EST DÉJÀ COUVERT AILLEURS, ET QU'ON NE RECOPIE PAS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `securite-stockage-durcissement.test.ts` tient la liste blanche de
 * compartiment, le `Content-Type` décidé par nous, `nosniff`, la normalisation
 * de chemin, le CORS restreint et le 500 muet — sur des clés SYNTHÉTIQUES
 * (`u1/a.mp4`). `autopilote-m3b31-stockage.test.ts` tient la caractérisation,
 * les producteurs de l'URL et la garde Autopilote.
 *
 * Ce fichier les COMPLÈTE sur trois axes qu'aucun des deux ne couvre :
 *
 *   1. le contrat d'en-têtes vérifié sur les clés RÉELLES, famille par
 *      famille, dans les quatre compartiments, en GET **et** en HEAD ;
 *   2. la forme `bytes=-N` — la sonde d'atome `moov` — appliquée à CETTE
 *      route (elle n'est éprouvée que contre un serveur de fixture dans
 *      `autopilote-m3b2-gros-fichiers.test.ts`) ;
 *   3. le FAUX POSITIF : une clé légitime, délivrée par nos propres routes
 *      d'envoi, qui tombe dans l'espace de noms bloqué.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LE BLOCAGE N'EXISTE PAS ENCORE DANS CET ARBRE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Il est produit en parallèle. Sa forme exacte — nom de fonction, module — est
 * inconnue d'ici, et un test qui devinerait ce nom casserait au premier
 * renommage. La détection est donc COMPORTEMENTALE : on dépose une vignette
 * d'analyse et on regarde ce que la route en fait. Une garde le NOMME et
 * échoue tant qu'il manque ; sans elle, les rares blocs qui en dépendent
 * seraient verts pour toujours en ne vérifiant rien.
 *
 * L'immense majorité des blocs ci-dessous ne dépend PAS du blocage : ils sont
 * écrits pour passer AVANT et APRÈS. C'est exactement ce qu'on attend d'une
 * preuve de non-régression.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// Le stockage simulé. On COMPTE les appels : la preuve qu'une garde mord,
// c'est que MinIO n'est pas interrogé du tout.
// ═══════════════════════════════════════════════════════════════════════════

const etat = vi.hoisted(() => ({
  objets: new Map<string, Buffer>(),
  /** Ce que l'objet ANNONCE — c'est-à-dire ce que l'envoyeur a choisi. */
  typeAnnonce: undefined as string | undefined,
  journal: [] as Array<{ op: string; bucket: string; cle: string }>,
  /** Les envois multipart initiés, pour la démonstration du faux positif. */
  multipart: [] as Array<{ bucket: string; cle: string }>,
}));

vi.mock('minio', async () => {
  const { Readable } = await import('node:stream');
  const lire = (bucket: string, cle: string): Buffer => {
    const octets = etat.objets.get(`${bucket}/${cle}`);
    if (!octets) throw Object.assign(new Error('Not found'), { code: 'NoSuchKey' });
    return octets;
  };
  class Client {
    async statObject(bucket: string, cle: string) {
      etat.journal.push({ op: 'stat', bucket, cle });
      return {
        size: lire(bucket, cle).length,
        metaData: etat.typeAnnonce ? { 'content-type': etat.typeAnnonce } : {},
      };
    }
    async getObject(bucket: string, cle: string) {
      etat.journal.push({ op: 'objet', bucket, cle });
      return Readable.from([lire(bucket, cle)]);
    }
    async getPartialObject(bucket: string, cle: string, debut: number, longueur: number) {
      etat.journal.push({ op: 'partiel', bucket, cle });
      return Readable.from([lire(bucket, cle).subarray(debut, debut + longueur)]);
    }
    async presignedPutObject(bucket: string, cle: string) {
      etat.journal.push({ op: 'presigne', bucket, cle });
      return `https://minio.test/${bucket}/${cle}?signature=x`;
    }
    async initiateNewMultipartUpload(bucket: string, cle: string) {
      etat.multipart.push({ bucket, cle });
      return 'upload-1';
    }
  }
  return { Client };
});

/** La session. La route de stockage ne l'importe pas ; les routes d'envoi, si. */
const session = vi.hoisted(() => ({ courante: null as unknown }));
vi.mock('@/lib/auth/config', () => ({
  auth: async () => session.courante,
  DEV_AUTH_BYPASS: false,
}));

/**
 * Supabase n'est jamais atteint : sous `STORAGE_PROVIDER=s3`, les routes
 * d'envoi rendent leur réponse avant. La doublure existe pour que l'import
 * du module ne parte pas chercher une configuration absente.
 */
vi.mock('@/lib/db/supabase', () => ({
  supabase: {},
  supabaseAdmin: { storage: { from: () => ({}) } },
}));

// Ces variables sont lues AU CHARGEMENT du module de route : posées avant.
process.env.STORAGE_PROVIDER = 's3';
process.env.MINIO_SECRET_KEY = 'secret-de-test';
process.env.NEXT_PUBLIC_APP_URL = 'https://studiio.pro';

const ORIGINE = 'https://studiio.pro';
const PREFIXE_PUBLIC = '/storage/v1/object/public/';

const routeStockage = await import(
  '@/app/storage/v1/object/public/[bucket]/[...path]/route'
);

type Contexte = { params: Promise<{ bucket: string; path: string[] }> };
type Gestionnaire = (req: unknown, ctx: Contexte) => Promise<Response>;
const GET = routeStockage.GET as unknown as Gestionnaire;
const HEAD = routeStockage.HEAD as unknown as Gestionnaire;

function requete(bucket: string, cle: string, entetes: Record<string, string> = {}) {
  return new Request(`${ORIGINE}${PREFIXE_PUBLIC}${bucket}/${cle}`, { headers: entetes });
}

const contexte = (bucket: string, cle: string): Contexte =>
  ({ params: Promise.resolve({ bucket, path: cle.split('/') }) });

interface Reponse { statut: number; entetes: Headers; corps: Buffer; texte: string }

async function lireReponse(res: Response): Promise<Reponse> {
  const corps = Buffer.from(await res.arrayBuffer());
  return { statut: res.status, entetes: res.headers, corps, texte: corps.toString('utf-8') };
}

const demander = async (bucket: string, cle: string, entetes: Record<string, string> = {}) =>
  lireReponse(await GET(requete(bucket, cle, entetes), contexte(bucket, cle)));

const sonder = async (bucket: string, cle: string, entetes: Record<string, string> = {}) =>
  lireReponse(await HEAD(requete(bucket, cle, entetes), contexte(bucket, cle)));

function deposer(bucket: string, cle: string, contenu: Buffer | string): Buffer {
  const octets = Buffer.isBuffer(contenu) ? contenu : Buffer.from(contenu);
  etat.objets.set(`${bucket}/${cle}`, octets);
  return octets;
}

/** Les octets réellement ouverts — `stat` n'en ouvre aucun. */
const ouvertures = () => etat.journal.filter((a) => a.op !== 'stat');

const racine = (relatif: string) => join(process.cwd(), relatif);
const source = (relatif: string) => readFileSync(racine(relatif), 'utf-8');

/**
 * Le code, sans ses commentaires.
 *
 * Un commentaire a le DROIT de nommer une forme de clé pour expliquer qu'on ne
 * s'en sert pas — c'est ce que fait déjà `vignettes.ts`, qui écrit noir sur
 * blanc `<userId>/analyse/<analysisId>/vignette-NN.jpg` pour dire de NE PAS
 * passer par la route publique. Ce qui compte, c'est le code.
 */
const sansCommentaires = (code: string) => code
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

// ═══════════════════════════════════════════════════════════════════════════
// L'INVENTAIRE — les familles de clés que le projet fabrique RÉELLEMENT
//
// `source` est le fichier qui produit la forme, `marqueur` un fragment de ce
// fichier qui l'atteste. Si le marqueur disparaît, l'inventaire est périmé et
// le test le dit — c'est ce qui empêche cette table de devenir décorative.
// ═══════════════════════════════════════════════════════════════════════════

interface Famille {
  usage: string;
  bucket: string;
  cle: string;
  type: string;
  fichier: string;
  marqueur: string;
}

const UTILISATEUR = 'usr-42';
const HORODATAGE = '1756400000000';

const FAMILLES: Famille[] = [
  // ── `media` : tout ce qui passe par `<userId>/<purpose>/<ts>-<nom>` ──────
  {
    usage: 'rush téléversé (purpose par défaut)',
    bucket: 'media', cle: `${UTILISATEUR}/rush/${HORODATAGE}-tournage_01.mp4`,
    type: 'video/mp4',
    fichier: 'src/app/api/upload/signed-url/route.ts',
    marqueur: '${session.user.id}/${usage}/${timestamp}-${safeFilename}',
  },
  {
    usage: 'vignette de post — Calendrier',
    bucket: 'media', cle: `${UTILISATEUR}/thumbnail/${HORODATAGE}-poster.jpg`,
    type: 'image/jpeg',
    fichier: 'src/app/dashboard/calendar/page.tsx',
    marqueur: "purpose: isVideo ? 'rush' : 'thumbnail'",
  },
  {
    usage: 'montage livré par l Agent IA',
    bucket: 'media', cle: `${UTILISATEUR}/montage/${HORODATAGE}-montage.mp4`,
    type: 'video/mp4',
    fichier: 'src/components/creer/AgentIAModal.tsx',
    marqueur: "purpose: 'montage'",
  },
  {
    usage: 'média de la médiathèque',
    bucket: 'media', cle: `${UTILISATEUR}/library/${HORODATAGE}-clip.webm`,
    type: 'video/webm',
    fichier: 'src/components/shared/MediaLibrary.tsx',
    marqueur: "purpose: 'library'",
  },
  {
    usage: 'clip découpé',
    bucket: 'media', cle: `${UTILISATEUR}/clip/${HORODATAGE}-extrait.mp4`,
    type: 'video/mp4',
    fichier: 'src/components/media/ClipDetectorModal.tsx',
    marqueur: "purpose: 'clip'",
  },
  {
    usage: 'affiche exportée',
    bucket: 'media', cle: `${UTILISATEUR}/image/${HORODATAGE}-affiche.png`,
    type: 'image/png',
    fichier: 'src/lib/creer/posterUpload.ts',
    marqueur: "purpose: 'image'",
  },
  {
    usage: 'fond de séquence',
    bucket: 'media', cle: `${UTILISATEUR}/bg/${HORODATAGE}-bg_titre.jpg`,
    type: 'image/jpeg',
    fichier: 'src/app/dashboard/creer-avance/page.tsx',
    marqueur: "purpose: 'bg'",
  },
  {
    usage: 'vidéo de démo de la page d accueil',
    bucket: 'media', cle: `${UTILISATEUR}/demo/${HORODATAGE}-demo.mp4`,
    type: 'video/mp4',
    fichier: 'src/app/admin/landing/page.tsx',
    marqueur: "formData.append('purpose', 'demo')",
  },
  {
    usage: 'repli de conversion MP4',
    bucket: 'media', cle: `${UTILISATEUR}/convert/${HORODATAGE}-montage.mp4`,
    type: 'video/mp4',
    fichier: 'src/lib/video-composer.ts',
    marqueur: "purpose: 'convert'",
  },
  {
    usage: 'envoi direct par formulaire (purpose par défaut)',
    bucket: 'media', cle: `${UTILISATEUR}/general/${HORODATAGE}-fichier.mp4`,
    type: 'video/mp4',
    fichier: 'src/app/api/upload/media/route.ts',
    marqueur: "formData.get('purpose') as string || 'general'",
  },
  {
    usage: 'source d avatar',
    bucket: 'media', cle: `${UTILISATEUR}/avatar/source-${HORODATAGE}.png`,
    type: 'image/png',
    fichier: 'src/app/api/avatar/create/route.ts',
    marqueur: '${userId}/avatar/source-${Date.now()}.${ext}',
  },
  {
    usage: 'rendu serveur — le montage final',
    bucket: 'media', cle: `${UTILISATEUR}/rendus/rdu-77.webm`,
    type: 'video/webm',
    fichier: 'src/lib/rendus/service.ts',
    marqueur: '${userId}/rendus/${id}.webm',
  },
  {
    usage: 'conversion partagée, sans identifiant de compte',
    bucket: 'media', cle: `converted/${HORODATAGE}-montage.mp4`,
    type: 'video/mp4',
    fichier: 'src/app/api/convert/to-mp4/route.ts',
    marqueur: 'converted/${fileName}',
  },
  // ── `audio` ─────────────────────────────────────────────────────────────
  {
    usage: 'voix téléversée ou synthétisée — Studio Son',
    bucket: 'audio', cle: `${UTILISATEUR}/voice/${HORODATAGE}-voix.mp3`,
    type: 'audio/mpeg',
    fichier: 'src/components/creer/SequenceVoicesPanel.tsx',
    marqueur: "purpose: 'voice'",
  },
  {
    usage: 'musique de fond',
    bucket: 'audio', cle: `${UTILISATEUR}/music/${HORODATAGE}-piste.mp3`,
    type: 'audio/mpeg',
    fichier: 'src/components/creer/AudioStudioPanel.tsx',
    marqueur: "purpose: target === 'music' ? 'music' : 'voice'",
  },
  {
    usage: 'voix de l Autopilote — clé SANS segment `purpose`',
    bucket: 'audio', cle: `${UTILISATEUR}/autopilote-job77-titre.mp3`,
    type: 'audio/mpeg',
    fichier: 'src/lib/autopilot/voice.ts',
    marqueur: '${input.userId}/autopilote-${input.jobId}-${cle}.mp3',
  },
  // ── `videos` ────────────────────────────────────────────────────────────
  {
    usage: 'montage de l Autopilote',
    bucket: 'videos', cle: `${UTILISATEUR}/autopilote-job77.mp4`,
    type: 'video/mp4',
    fichier: 'src/lib/autopilot/render.ts',
    marqueur: '${input.userId}/autopilote-${input.jobId}.mp4',
  },
  // ── `images` ────────────────────────────────────────────────────────────
  {
    usage: 'vignette du montage de l Autopilote',
    bucket: 'images', cle: `${UTILISATEUR}/autopilote-job77.jpg`,
    type: 'image/jpeg',
    fichier: 'src/lib/autopilot/render.ts',
    marqueur: '${userId}/autopilote-${jobId}.jpg',
  },
];

/**
 * LA clé bloquée — la seule, et telle que `extraction.ts` la fabrique.
 *
 * `BUCKET_VIGNETTES = 'media'`, et la clé est
 * `<userId>/analyse/<analysisId>/vignette-NN.jpg`.
 */
const BUCKET_VIGNETTES = 'media';

/** Le segment que le lot B doit refuser dans `media`. */
const MOTIF_SEGMENT_INTERDIT = /\/analyse\//;
const CLE_VIGNETTE = `${UTILISATEUR}/analyse/an-1/vignette-01.jpg`;

// ═══════════════════════════════════════════════════════════════════════════
// LA DÉTECTION DU BLOCAGE — comportementale, jamais par nom de symbole
//
// Le module et la fonction qui portent la règle sont produits ailleurs. Deviner
// leur nom ici, c'est fabriquer un test qui casse au premier renommage sans
// qu'aucun comportement n'ait changé. On regarde donc ce que la route FAIT.
// ═══════════════════════════════════════════════════════════════════════════

async function detecterBlocage(): Promise<boolean> {
  etat.objets.clear();
  etat.journal.length = 0;
  deposer(BUCKET_VIGNETTES, CLE_VIGNETTE, Buffer.alloc(64, 1));
  const r = await demander(BUCKET_VIGNETTES, CLE_VIGNETTE);
  const bloque = r.statut === 404 && etat.journal.length === 0;
  etat.objets.clear();
  etat.journal.length = 0;
  return bloque;
}

const BLOCAGE_ACTIF = await detecterBlocage();

/**
 * Le module où la règle est ATTENDUE, d'après le cahier du lot.
 *
 * Le spécificateur est CONSTRUIT et l'import porte `@vite-ignore` : un
 * `import('@/…')` écrit en clair est résolu à la TRANSFORMATION du fichier,
 * c'est-à-dire avant tout `skipIf`, et ferait échouer le chargement du fichier
 * entier si le module n'existait pas. Ici il existe déjà — la précaution vaut
 * pour le jour où la règle déménagerait dans un module neuf.
 */
const MODULE_REGLE = 'src/lib/storage/acces-objet.ts';
const specificateurRegle = ['@', 'lib', 'storage', 'acces-objet'].join('/');

beforeEach(() => {
  etat.objets.clear();
  etat.journal.length = 0;
  etat.multipart.length = 0;
  etat.typeAnnonce = undefined;
  session.courante = null;
});

// ═══════════════════════════════════════════════════════════════════════════
// 0. LA GARDE — elle NOMME ce qui manque, et échoue tant qu'il manque
// ═══════════════════════════════════════════════════════════════════════════

describe('La garde du blocage de l espace de noms', () => {
  /**
   * Sans cette garde, les trois blocs marqués `skipIf` seraient verts en ne
   * vérifiant rien — pour toujours, et sans que personne ne s'en aperçoive.
   * Elle échoue AVANT l'intégration du lot B, et c'est le signal voulu.
   */
  it('la route refuse une clé de vignette d analyse sans appeler le stockage', () => {
    expect(
      BLOCAGE_ACTIF,
      `blocage absent : GET ${PREFIXE_PUBLIC}${BUCKET_VIGNETTES}/${CLE_VIGNETTE} `
      + 'sert encore l objet. Attendu : 404 rendu AVANT tout appel MinIO. La '
      + `règle est attendue dans ${MODULE_REGLE} ; les blocs qui en dépendent `
      + 'sont mis de côté tant qu elle manque.',
    ).toBe(true);
  });

  it('le module qui doit porter la règle existe toujours', async () => {
    expect(existsSync(racine(MODULE_REGLE)), MODULE_REGLE).toBe(true);
    const mod = await (import(/* @vite-ignore */ specificateurRegle) as
      Promise<Record<string, unknown>>);
    // Les deux gardes du lot précédent restent le socle : si elles
    // disparaissaient, la nouvelle règle n'aurait plus rien sur quoi s'appuyer.
    expect(typeof mod.cleObjetValide).toBe('function');
    expect(typeof mod.typeContenuDepuisCle).toBe('function');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. RIEN D'AUTRE N'EST BLOQUÉ — les familles de clés réellement produites
//
// Ces tests passent AVANT et APRÈS. C'est tout leur intérêt : ils ne décrivent
// pas le blocage, ils décrivent ce qu'il ne doit pas toucher.
// ═══════════════════════════════════════════════════════════════════════════

describe('L inventaire des clés est tenu depuis le code, pas de mémoire', () => {
  it.each(FAMILLES.map((f) => [f.usage, f] as const))(
    '%s — son fabricant produit encore cette forme',
    (_usage, f) => {
      expect(existsSync(racine(f.fichier)), f.fichier).toBe(true);
      expect(
        source(f.fichier),
        `${f.fichier} ne contient plus « ${f.marqueur} » : l inventaire de `
        + 'FAMILLES est périmé, le corriger avant de toucher au blocage',
      ).toContain(f.marqueur);
    },
  );

  it('les quatre compartiments de la liste blanche sont tous représentés', async () => {
    const { ALLOWED_BUCKETS } = await import('@/lib/storage/buckets');
    const couverts = new Set(FAMILLES.map((f) => f.bucket));
    for (const bucket of ALLOWED_BUCKETS) {
      expect(couverts.has(bucket), `aucune famille réelle pour « ${bucket} »`).toBe(true);
    }
  });

  /**
   * Le témoin. Une table de familles dont AUCUNE ne ressemblerait à la clé
   * bloquée ne prouverait rien sur la finesse du filtre : elle prouverait
   * seulement qu'on a choisi des exemples éloignés.
   */
  it('la clé bloquée est bien celle que l extraction fabrique', () => {
    const code = sansCommentaires(source('src/lib/autopilot/analyse/extraction.ts'));
    expect(code).toContain("export const BUCKET_VIGNETTES = 'media'");
    expect(code).toContain('/analyse/${entree.analysisId}/vignette-');
  });
});

describe('Chaque famille réelle est servie, en GET et en HEAD', () => {
  it.each(FAMILLES.map((f) => [f.usage, f] as const))('%s', async (_usage, f) => {
    const octets = deposer(f.bucket, f.cle, Buffer.alloc(2048, 5));

    const r = await demander(f.bucket, f.cle);
    expect(r.statut, `${f.bucket}/${f.cle}`).toBe(200);
    expect(r.entetes.get('content-type')).toBe(f.type);
    expect(Number(r.entetes.get('content-length'))).toBe(octets.length);
    expect(r.corps.equals(octets)).toBe(true);

    const h = await sonder(f.bucket, f.cle);
    expect(h.statut, `HEAD ${f.bucket}/${f.cle}`).toBe(200);
    expect(Number(h.entetes.get('content-length'))).toBe(octets.length);
    expect(h.entetes.get('accept-ranges')).toBe('bytes');
    expect(h.corps.length).toBe(0);
  });
});

describe('Les voisins immédiats de l espace de noms restent servis', () => {
  /**
   * C'est ici qu'un filtre trop large se voit.
   *
   * Chacune de ces clés CONTIENT les lettres « analyse » sans former le segment
   * `/analyse/` du compartiment `media`. Un `includes('analyse')`, un
   * `startsWith`, une expression sans ancre de segment, ou un filtre appliqué à
   * tous les compartiments : chacun mord au moins une ligne de cette table.
   */
  const VOISINS: Array<[string, string, string]> = [
    ['un dossier dont le nom COMMENCE par analyse',
      'media', `${UTILISATEUR}/analyses-brutes/rush.mp4`],
    ['un dossier dont le nom CONTIENT analyse',
      'media', `${UTILISATEUR}/pre-analyse-2026/rush.mp4`],
    ['un NOM DE FICHIER qui contient analyse',
      'media', `${UTILISATEUR}/rush/${HORODATAGE}-analyse_du_match.mp4`],
    ['un nom de fichier qui EST analyse',
      'media', `${UTILISATEUR}/rush/${HORODATAGE}-analyse.mp4`],
    ['le mot analyse en premier segment, sans identifiant de compte',
      'media', `analyse/${HORODATAGE}-rapport.mp4`],
    ['`analyse` comme DERNIER segment, donc sans suite',
      'media', `${UTILISATEUR}/analyse`],
    ['la casse différente — MinIO distingue les clés',
      'media', `${UTILISATEUR}/Analyse/an-1/vignette-01.jpg`],
    ['le même chemin dans un AUTRE compartiment — videos',
      'videos', `${UTILISATEUR}/analyse/an-1/vignette-01.jpg`],
    ['le même chemin dans un AUTRE compartiment — images',
      'images', `${UTILISATEUR}/analyse/an-1/vignette-01.jpg`],
    ['le même chemin dans un AUTRE compartiment — audio',
      'audio', `${UTILISATEUR}/analyse/an-1/voix.mp3`],
  ];

  it.each(VOISINS)('%s reste servi', async (_cas, bucket, cle) => {
    const octets = deposer(bucket, cle, Buffer.alloc(512, 8));
    const r = await demander(bucket, cle);
    expect(r.statut, `${bucket}/${cle}`).toBe(200);
    expect(r.corps.equals(octets)).toBe(true);
  });

  /**
   * ⚠️ CES TROIS-LÀ SONT DES DÉCISIONS, PAS DES ÉVIDENCES.
   *
   * Elles décrivent le périmètre le plus étroit qui couvre la fuite réelle :
   * seul `media` porte les vignettes (`BUCKET_VIGNETTES = 'media'`), et seule
   * la forme `<x>/analyse/<y>` est déterministe. Si le lot B choisit un
   * périmètre plus large — tous les compartiments, ou `analyse` en préfixe —
   * ces lignes rougiront, et c'est le bon moment pour que la question soit
   * posée explicitement plutôt que découverte en production.
   */
  it('le périmètre retenu est nommé, pour que l élargir soit un choix visible', () => {
    expect(BUCKET_VIGNETTES).toBe('media');
    expect(CLE_VIGNETTE.split('/')[1]).toBe('analyse');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. LES PROTECTIONS DU LOT PRÉCÉDENT TIENNENT — sur les clés RÉELLES
//
// Le durcissement M3-B3.1 est éprouvé ailleurs sur des clés synthétiques.
// Ce bloc ne le recopie pas : il le rejoue sur l'inventaire ci-dessus, là où
// une régression de filtre se manifesterait vraiment.
// ═══════════════════════════════════════════════════════════════════════════

describe('Le contrat d en-têtes tient sur chaque famille réelle', () => {
  it.each(FAMILLES.map((f) => [f.usage, f] as const))('%s', async (_usage, f) => {
    deposer(f.bucket, f.cle, Buffer.alloc(256, 3));
    const r = await demander(f.bucket, f.cle);
    expect(r.entetes.get('x-content-type-options')).toBe('nosniff');
    expect(r.entetes.get('content-disposition')).toBe('inline');
    expect(r.entetes.get('cache-control')).toBe('private, no-store');
    expect(r.entetes.get('accept-ranges')).toBe('bytes');
    expect(r.entetes.get('vary')).toBe('Origin');
    // Le CORS reste restreint : sans `Origin`, aucun en-tête d'autorisation.
    expect(r.entetes.get('access-control-allow-origin')).toBeNull();
  });

  it('le CORS de NOTRE origine survit — le canvas du compositeur en dépend', async () => {
    const f = FAMILLES.find((x) => x.usage.startsWith('rendu serveur'))!;
    deposer(f.bucket, f.cle, 'X');
    const r = await demander(f.bucket, f.cle, { origin: ORIGINE });
    expect(r.entetes.get('access-control-allow-origin')).toBe(ORIGINE);
    expect(r.entetes.get('vary')).toBe('Origin');
  });

  it('une origine étrangère n obtient toujours rien, même hors namespace', async () => {
    const f = FAMILLES[0];
    deposer(f.bucket, f.cle, 'X');
    const r = await demander(f.bucket, f.cle, { origin: 'https://ailleurs.example' });
    expect(r.entetes.get('access-control-allow-origin')).toBeNull();
  });

  /**
   * Le type reste DÉCIDÉ par nous, y compris sur une clé réelle dont l'objet
   * annonce autre chose. C'est la moitié du XSS stocké ; le blocage ne doit
   * pas avoir déplacé la décision ailleurs.
   */
  it('un objet qui ANNONCE text/html n est jamais servi en text/html', async () => {
    const cle = `${UTILISATEUR}/rush/${HORODATAGE}-piege.html`;
    deposer('media', cle, '<script>alert(1)</script>');
    etat.typeAnnonce = 'text/html';
    const r = await demander('media', cle);
    expect(r.statut).toBe(200);
    expect(r.entetes.get('content-type')).toBe('application/octet-stream');
    expect(r.entetes.get('x-content-type-options')).toBe('nosniff');
  });

  /**
   * La normalisation de chemin ne doit pas être devenue le seul rempart, ni
   * avoir été affaiblie au passage. On la rejoue AVEC le mot `analyse`, là où
   * un filtre écrit trop vite pourrait la court-circuiter.
   */
  it.each([
    `${UTILISATEUR}/analyse/../rush/x.mp4`,
    `${UTILISATEUR}/%2e%2e/analyse/x.mp4`,
    `${UTILISATEUR}/analyse\\an-1/x.mp4`,
    `https://ailleurs.example/${UTILISATEUR}/analyse/x.mp4`,
  ])('« %s » rend 404 sans appeler MinIO', async (cle) => {
    const r = await demander('media', cle);
    expect(r.statut).toBe(404);
    expect(etat.journal).toEqual([]);
  });

  it('un compartiment hors liste reste refusé sans appeler MinIO', async () => {
    const r = await demander('backups', `${UTILISATEUR}/analyse/an-1/vignette-01.jpg`);
    expect(r.statut).toBe(404);
    expect(etat.journal).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. RANGE, 206, 416 ET HEAD RESTENT IDENTIQUES HORS NAMESPACE
//
// `bytes=-N` — la sonde d'atome `moov` — n'est éprouvée nulle part CONTRE
// CETTE ROUTE : `autopilote-m3b2-gros-fichiers.test.ts` la mesure contre un
// serveur de fixture. C'est le trou que ce bloc ferme.
// ═══════════════════════════════════════════════════════════════════════════

describe('Range, 206, 416 et HEAD — sur un rush réel', () => {
  const CLE_RUSH = `${UTILISATEUR}/rush/${HORODATAGE}-tournage_01.mp4`;
  const TAILLE = 8192;
  let contenu: Buffer;

  beforeEach(() => {
    contenu = Buffer.alloc(TAILLE);
    for (let i = 0; i < TAILLE; i += 1) contenu[i] = i % 251;
    deposer('media', CLE_RUSH, contenu);
  });

  it('un seek au milieu rend 206 et exactement la tranche demandée', async () => {
    const r = await demander('media', CLE_RUSH, { range: 'bytes=2048-4095' });
    expect(r.statut).toBe(206);
    expect(r.entetes.get('content-range')).toBe(`bytes 2048-4095/${TAILLE}`);
    expect(Number(r.entetes.get('content-length'))).toBe(2048);
    expect(r.corps.equals(contenu.subarray(2048, 4096))).toBe(true);
    expect(ouvertures().map((a) => a.op)).toEqual(['partiel']);
  });

  /**
   * LA SONDE `moov`. Un MP4 dont l'atome `moov` est en fin de fichier —
   * c'est le cas des rushes décrits dans CLAUDE.md — n'est lisible qu'à cette
   * condition : pouvoir demander les N DERNIERS octets sans télécharger les
   * 18 Mo qui précèdent. `bytes=-N` est la seule forme qui l'exprime.
   */
  it('la forme suffixe `bytes=-N` rend la QUEUE du fichier, pas sa tête', async () => {
    const r = await demander('media', CLE_RUSH, { range: 'bytes=-1024' });
    expect(r.statut).toBe(206);
    expect(r.entetes.get('content-range')).toBe(`bytes 7168-8191/${TAILLE}`);
    expect(Number(r.entetes.get('content-length'))).toBe(1024);
    expect(r.corps.equals(contenu.subarray(TAILLE - 1024))).toBe(true);
  });

  it('un suffixe plus grand que le fichier rend le fichier entier, en 206', async () => {
    const r = await demander('media', CLE_RUSH, { range: `bytes=-${TAILLE * 4}` });
    expect(r.statut).toBe(206);
    expect(r.entetes.get('content-range')).toBe(`bytes 0-${TAILLE - 1}/${TAILLE}`);
    expect(r.corps.equals(contenu)).toBe(true);
  });

  it('un intervalle ouvert `bytes=N-` va jusqu au dernier octet', async () => {
    const r = await demander('media', CLE_RUSH, { range: 'bytes=6000-' });
    expect(r.statut).toBe(206);
    expect(r.entetes.get('content-range')).toBe(`bytes 6000-${TAILLE - 1}/${TAILLE}`);
    expect(r.corps.equals(contenu.subarray(6000))).toBe(true);
  });

  it('une fin au-delà de la taille est ramenée au dernier octet', async () => {
    const r = await demander('media', CLE_RUSH, { range: 'bytes=8000-99999' });
    expect(r.statut).toBe(206);
    expect(r.entetes.get('content-range')).toBe(`bytes 8000-${TAILLE - 1}/${TAILLE}`);
  });

  it.each(['bytes=8192-9000', 'bytes=99999-100000', 'bytes=4000-100'])(
    '« %s » rend 416 avec `bytes * / taille`', async (range) => {
      const r = await demander('media', CLE_RUSH, { range });
      expect(r.statut).toBe(416);
      expect(r.entetes.get('content-range')).toBe(`bytes */${TAILLE}`);
    },
  );

  it.each(['octets=0-10', 'bytes=abc-def', 'bytes 0-10', 'bytes=1-2, 5-6'])(
    'un en-tête Range illisible « %s » retombe sur un 200 complet', async (range) => {
      const r = await demander('media', CLE_RUSH, { range });
      expect(r.statut).toBe(200);
      expect(Number(r.entetes.get('content-length'))).toBe(TAILLE);
    },
  );

  /**
   * `bytes=-` — les deux bornes vides — traverse l'expression de la route et
   * ressort en 206 sur le fichier ENTIER. Ce n'est pas ce que dit la RFC 7233,
   * qui veut un 400 ou un 200. On le CONSTATE ici plutôt que de le corriger :
   * ce lot ne touche pas au bloc `Range`, et un client qui envoie cette forme
   * reçoit malgré tout ses octets. Le test existe pour que la prochaine
   * personne qui touche à ce bloc sache que ce comportement était là avant
   * elle.
   */
  it('`bytes=-` rend un 206 sur le fichier entier — constat, pas approbation', async () => {
    const r = await demander('media', CLE_RUSH, { range: 'bytes=-' });
    expect(r.statut).toBe(206);
    expect(r.entetes.get('content-range')).toBe(`bytes 0-${TAILLE - 1}/${TAILLE}`);
    expect(r.corps.equals(contenu)).toBe(true);
  });

  it('le HEAD du Calendrier annonce la taille et Accept-Ranges, sans corps', async () => {
    const r = await sonder('media', CLE_RUSH);
    expect(r.statut).toBe(200);
    expect(r.entetes.get('accept-ranges')).toBe('bytes');
    expect(Number(r.entetes.get('content-length'))).toBe(TAILLE);
    expect(r.corps.length).toBe(0);
    // `statObject` seul : la sonde n'ouvre aucun octet.
    expect(ouvertures()).toEqual([]);
  });

  it('HEAD applique les mêmes gardes de chemin, sans appeler MinIO', async () => {
    const r = await sonder('media', `${UTILISATEUR}/analyse/../rush/x.mp4`);
    expect(r.statut).toBe(404);
    expect(etat.journal).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. LES CONSOMMATEURS DE CETTE ROUTE NE CASSENT PAS
//
// Preuve STRUCTURELLE, et c'est volontaire : ces sept chemins appellent la
// route sans session, depuis Chromium, depuis un cron, ou depuis les serveurs
// de Meta et de TikTok. Aucun test unitaire ne peut les jouer. Ce qu'on peut
// prouver, en revanche, c'est que la FORME de leurs URL ne tombe jamais dans
// l'espace de noms bloqué — parce qu'aucun d'eux ne sait fabriquer une telle
// clé.
// ═══════════════════════════════════════════════════════════════════════════

describe('Aucun consommateur ne peut porter une clé de l espace bloqué', () => {
  /**
   * Le balayage. Il cherche, dans TOUT le code de production, les endroits qui
   * fabriquent une clé d'objet portant un segment `analyse`.
   *
   * Écrit comme une fonction pure pour être TÉMOIGNABLE : un balayage qui ne
   * lit que le dépôt réel est vert soit parce que le dépôt est propre, soit
   * parce qu'il ne regarde rien, et rien ne distingue les deux.
   */
  const MOTIF_CLE_ANALYSE = /\/analyse\/|['"`]analyse\/|\/analyse['"`]/;

  /**
   * Deux formes portent `analyse` sans être des clés d'objet, et il faut les
   * écarter SANS écarter ce qu'on cherche :
   *
   *   - les SPÉCIFICATEURS DE MODULE — `@/lib/autopilot/analyse/extraction`
   *     est un chemin de fichier, pas une clé ;
   *   - les CHEMINS D'API — `/api/autopilot/rushes/<id>/analyse` est une URL
   *     de l'application, servie par Next, pas par le stockage.
   *
   * On les retire par leur FORME (`from '…'`, `import('…')`, tout littéral qui
   * contient `/api/`), jamais en excluant des fichiers par leur nom : exclure
   * `src/lib/autopilot/analyse/` reviendrait à ne plus regarder l'endroit
   * précis où la clé est fabriquée.
   */
  const sansBruit = (code: string) => sansCommentaires(code)
    .replace(/from\s+['"][^'"]+['"]/g, 'from ""')
    .replace(/import\s*\(\s*(?:\/\*[^*]*\*\/\s*)?['"][^'"]+['"]\s*\)/g, 'import("")')
    .replace(/require\s*\(\s*['"][^'"]+['"]\s*\)/g, 'require("")')
    .replace(/[`'"][^`'"\n]*\/api\/[^`'"\n]*[`'"]/g, '""');

  function producteursDeCleAnalyse(entrees: Array<{ fichier: string; code: string }>) {
    return entrees
      .filter((e) => MOTIF_CLE_ANALYSE.test(sansBruit(e.code)))
      .map((e) => e.fichier);
  }

  function fichiersSources(relatif: string): string[] {
    const complet = racine(relatif);
    if (!existsSync(complet)) return [];
    if (statSync(complet).isFile()) return /\.tsx?$/.test(relatif) ? [relatif] : [];
    if (/node_modules|\.next/.test(relatif)) return [];
    return readdirSync(complet).flatMap((e) => fichiersSources(join(relatif, e)));
  }

  const estTest = (f: string) =>
    /\.(test|spec)\.tsx?$/.test(f) || f.includes('__tests__');

  /**
   * Les routes d'API ont un chemin `…/analyse/route.ts` : c'est une URL
   * d'application, pas une clé d'objet. On les écarte par leur CHEMIN, pas par
   * leur contenu — sinon on écarterait aussi ce qu'on cherche.
   */
  const estRouteApi = (f: string) => f.startsWith('src/app/api/');

  it('le seul code qui fabrique une clé `…/analyse/…` est l extraction', () => {
    const entrees = fichiersSources('src')
      .filter((f) => !estTest(f) && !estRouteApi(f))
      .map((fichier) => ({ fichier, code: source(fichier) }));
    expect(entrees.length, 'le balayage n a lu aucun fichier').toBeGreaterThan(100);

    const trouves = producteursDeCleAnalyse(entrees);
    expect(trouves.sort()).toEqual(['src/lib/autopilot/analyse/extraction.ts']);
  });

  it('le balayage MORD — sinon il ne prouverait rien', () => {
    const temoin = [{
      fichier: 'faux.ts',
      code: 'const cle = `${u}/analyse/${a}/vignette-01.jpg`;',
    }];
    expect(producteursDeCleAnalyse(temoin)).toEqual(['faux.ts']);
  });

  it.each<[string, string]>([
    ['un commentaire qui NOMME la forme pour l interdire',
      '// `<userId>/analyse/<id>/vignette-NN.jpg` — NE PAS servir ici\nconst x = 1;'],
    ['un spécificateur de module',
      "import { extraire } from '@/lib/autopilot/analyse/extraction';"],
    ['un import dynamique',
      "const m = await import('@/lib/autopilot/analyse/extraction');"],
    ['un chemin d API',
      'return `/api/autopilot/rushes/${id}/analyse`;'],
  ])('le balayage NE mord PAS sur %s', (_cas, code) => {
    expect(producteursDeCleAnalyse([{ fichier: 'x.ts', code }])).toEqual([]);
  });

  /**
   * Les sept appelants sans session, tels que l'en-tête de la route les
   * recense. Ce test fixe le fait qu'ils existent et qu'ils passent bien par
   * ce préfixe : si l'un d'eux disparaissait, la liste des risques du lot
   * changerait, et il faut le savoir.
   */
  const CONSOMMATEURS: Array<[string, string, string]> = [
    // ⚠️ MARQUEUR MIS À JOUR AU P0.1, PAS LE FAIT QU'IL PROUVE. Ces deux routes
    // rendaient l'URL INCHANGÉE dès qu'elle portait ce préfixe — donc un chemin
    // relatif, que Meta et TikTok ne pouvaient pas aller chercher. Elles
    // l'absolutisent désormais. Ce qu'il fallait fixer reste vrai et le
    // redevient même plus clairement : la publication passe par ce préfixe, et
    // les plateformes le lisent depuis Internet, SANS session.
    ['publication sociale immédiate', 'src/app/api/social/publish/route.ts',
      "!url.includes('/storage/v1/object/public/')"],
    ['publication programmée (cron)', 'src/app/api/cron/publish/route.ts',
      "!url.includes('/storage/v1/object/public/')"],
    ['relais authentifié du compositeur', 'src/app/api/proxy-media/route.ts',
      "u.pathname.startsWith('/storage/v1/object/public/')"],
    ['rendu serveur — lit MinIO en direct, hors de cette route',
      'src/lib/storage/fetch-media.ts',
      "const STORAGE_PROXY_PREFIX = '/storage/v1/object/public/'"],
    ['fabrication de l URL d un rendu', 'src/lib/rendus/cible-upload.ts',
      '/storage/v1/object/public/${bucket}/${cle}'],
    ['URL rendue par l envoi en un bloc', 'src/app/api/upload/signed-url/route.ts',
      '/storage/v1/object/public/${bucket}/${storagePath}'],
    ['URL rendue par l envoi multipart', 'src/app/api/upload/multipart/route.ts',
      '/storage/v1/object/public/${bucket}/${key}'],
  ];

  it.each(CONSOMMATEURS)('%s passe encore par ce préfixe', (_nom, fichier, marqueur) => {
    expect(existsSync(racine(fichier)), fichier).toBe(true);
    expect(sansCommentaires(source(fichier)), fichier).toContain(marqueur);
  });

  it.each(CONSOMMATEURS)('%s ne sait fabriquer aucune clé `analyse`', (_nom, fichier) => {
    expect(sansBruit(source(fichier))).not.toMatch(MOTIF_CLE_ANALYSE);
  });

  /**
   * Ceux qui ne FABRIQUENT pas l'URL, mais qui l'APPELLENT — c'est là que le
   * `HEAD` et le `Range` de cette route sont réellement consommés côté
   * serveur, hors navigateur.
   */
  const APPELANTS: Array<[string, string, string]> = [
    ['présence d un rush (HEAD)', 'src/lib/autopilot/poster.ts',
      "fetch(url, { method: 'HEAD'"],
    ['durée d un rush (lecture par tranches)', 'src/lib/autopilot/poster.ts',
      "await import('@remotion/media-parser')"],
    ['choix de l URL publiable', 'src/lib/videos/playable-url.ts',
      'export function resolvePublishableUrl'],
    ['relais Zernio', 'src/lib/social/zernio.ts',
      "fetch(fichierUrl, { cache: 'no-store' })"],
  ];

  it.each(APPELANTS)('%s appelle encore cette route', (_nom, fichier, marqueur) => {
    expect(existsSync(racine(fichier)), fichier).toBe(true);
    expect(sansCommentaires(source(fichier)), fichier).toContain(marqueur);
  });

  it.each(APPELANTS)('%s ne porte aucune clé `analyse`', (_nom, fichier) => {
    expect(sansBruit(source(fichier))).not.toMatch(MOTIF_CLE_ANALYSE);
  });

  /**
   * Les compositions Remotion ne connaissent que des URL reçues en `props` :
   * elles n'ont aucun littéral de stockage, donc aucune clé à elles. Ce qu'on
   * vérifie, c'est cette absence — c'est elle qui les met hors de portée du
   * blocage.
   */
  it('les compositions Remotion ne fabriquent aucune URL de stockage', () => {
    const fichiers = fichiersSources('remotion');
    expect(fichiers.length, 'aucune composition lue').toBeGreaterThan(0);
    for (const f of fichiers) {
      expect(sansCommentaires(source(f)), f).not.toContain(PREFIXE_PUBLIC);
      expect(sansBruit(source(f)), f).not.toMatch(MOTIF_CLE_ANALYSE);
    }
  });

  /**
   * Le Calendrier et la page d'accueil consomment des URL venues de la base ou
   * du CMS. Le seul chemin par lequel une vignette d'analyse pourrait y entrer
   * serait un code qui écrit une telle clé dans un post ou dans la landing —
   * et le balayage ci-dessus établit qu'il n'y en a pas.
   */
  it.each([
    'src/app/dashboard/calendar/page.tsx',
    'src/app/page.tsx',
    'src/app/admin/landing/page.tsx',
  ])('%s ne fabrique aucune clé `analyse`', (fichier) => {
    expect(sansBruit(source(fichier))).not.toMatch(MOTIF_CLE_ANALYSE);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. LA ROUTE AUTHENTIFIÉE RESTE LE SEUL ACCÈS LÉGITIME AUX VIGNETTES
//
// `autopilote-m3b31-stockage.test.ts` établit déjà, par lecture du source, que
// cette route exige une session et ne rend ni compartiment, ni clé, ni URL.
// Ce qu'il ne peut pas établir — parce que le blocage n'existait pas — c'est le
// COUPLE : la porte publique se ferme, l'autre reste ouverte, sur la MÊME clé.
// ═══════════════════════════════════════════════════════════════════════════

describe('Les vignettes : une seule porte, et elle demande une session', () => {
  const ROUTE_VIGNETTE = 'src/app/api/autopilot/analyses/[id]/vignettes/[n]/route.ts';

  it('la route authentifiée existe et exige une session', () => {
    expect(existsSync(racine(ROUTE_VIGNETTE))).toBe(true);
    const code = sansCommentaires(source(ROUTE_VIGNETTE));
    expect(code).toContain('await auth()');
    expect(code).toContain('401');
  });

  it('elle n accepte ni compartiment, ni clé, ni chemin depuis le navigateur', () => {
    const code = sansCommentaires(source(ROUTE_VIGNETTE));
    for (const porte of ['searchParams', 'req.json', 'params.bucket', 'params.cle']) {
      expect(code, `${ROUTE_VIGNETTE} : ${porte}`).not.toContain(porte);
    }
    // Elle ne prend qu'un identifiant d'analyse et un ENTIER.
    expect(code).toContain('indexVignetteValide');
  });

  it('l unique fabricant d adresse de vignette ne produit jamais l URL publique', async () => {
    const { cheminVignette } = await import('@/lib/autopilot/analyse/passerelle');
    for (const index of [0, 1, 7]) {
      const chemin = cheminVignette('an-1', index);
      expect(chemin).toBe(`/api/autopilot/analyses/an-1/vignettes/${index}`);
      expect(chemin).not.toContain(PREFIXE_PUBLIC);
      expect(chemin).not.toContain('/analyse/');
    }
  });

  it.skipIf(!BLOCAGE_ACTIF)(
    'la porte publique se ferme sur la clé exacte que l extraction écrit',
    async () => {
      deposer(BUCKET_VIGNETTES, CLE_VIGNETTE, Buffer.alloc(4096, 2));
      const r = await demander(BUCKET_VIGNETTES, CLE_VIGNETTE);
      expect(r.statut).toBe(404);
      expect(etat.journal, 'le stockage ne doit pas être interrogé').toEqual([]);
    },
  );

  it.skipIf(!BLOCAGE_ACTIF)(
    'le refus est indistinguable d un objet absent — corps ET en-têtes',
    async () => {
      // La clé bloquée, dont l'objet EXISTE.
      deposer(BUCKET_VIGNETTES, CLE_VIGNETTE, Buffer.alloc(4096, 2));
      const bloque = await demander(BUCKET_VIGNETTES, CLE_VIGNETTE);
      // Une clé de même forme dont l'objet N'EXISTE PAS.
      const absent = await demander(BUCKET_VIGNETTES,
        `${UTILISATEUR}/analyse/an-9/vignette-99.jpg`);
      expect(bloque.statut).toBe(absent.statut);
      expect(bloque.texte).toBe(absent.texte);
      // Sinon l'écart entre les deux réponses dirait quelles analyses existent.
      expect(bloque.entetes.get('content-type')).toBe(absent.entetes.get('content-type'));
    },
  );

  it.skipIf(!BLOCAGE_ACTIF)(
    'le HEAD se ferme aussi — sinon la taille suffirait à confirmer l existence',
    async () => {
      deposer(BUCKET_VIGNETTES, CLE_VIGNETTE, Buffer.alloc(4096, 2));
      const r = await sonder(BUCKET_VIGNETTES, CLE_VIGNETTE);
      expect(r.statut).toBe(404);
      expect(r.entetes.get('content-length')).not.toBe('4096');
      expect(etat.journal).toEqual([]);
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. LE FAUX POSITIF — une clé LÉGITIME qui tombe dans l'espace bloqué
//
// C'est le résultat le plus utile de ce lot, et il est rouge de nature : un
// test vert de plus n'aurait rien appris.
//
// `purpose` n'est CONTRAINT NULLE PART. Les trois routes d'envoi le prennent
// tel quel dans le corps de la requête et l'insèrent dans la clé :
//
//   signed-url  : `${session.user.id}/${usage}/${timestamp}-${safeFilename}`
//   multipart   : `${userId}/${purpose}/${Date.now()}-${filename}`
//   upload/media: `${session.user.id}/${purpose}/${timestamp}-${safeFilename}`
//
// `sanitizeStorageFilename` n'est appliqué qu'au NOM DE FICHIER. Rien ne
// touche `purpose`. Un client qui envoie `purpose: 'analyse'` obtient donc,
// de NOTRE PROPRE SERVEUR, une clé `media/<userId>/analyse/<ts>-<nom>` — et
// l'URL de lecture qui va avec, écrite en base.
// ═══════════════════════════════════════════════════════════════════════════

describe('FAUX POSITIF REFERME — `purpose` ne peut plus viser l espace reserve', () => {
  beforeEach(() => { session.courante = { user: { id: UTILISATEUR } }; });

  /**
   * ⚠️ CE BLOC DOCUMENTAIT UN TROU. IL DOCUMENTE MAINTENANT SA FERMETURE.
   *
   * `purpose` entrait tel quel dans la clé, sans liste blanche ni nettoyage :
   * un appelant demandant `purpose: "analyse"` recevait une clé
   * `<userId>/analyse/…` **délivrée par notre propre serveur**, que le blocage
   * de lecture rendait ensuite illisible — sans message et sans trace.
   *
   * Le lot refuse donc à l'ÉCRITURE ce qu'il refuse à la LECTURE, plutôt que
   * de documenter un trou. Cela ferme au passage la possibilité pour un compte
   * d'écraser ses propres vignettes, dont la clé est déterministe.
   */
  it('les trois routes d envoi valident desormais `purpose`', () => {
    const ROUTES = [
      'src/app/api/upload/signed-url/route.ts',
      'src/app/api/upload/multipart/route.ts',
      'src/app/api/upload/media/route.ts',
    ];
    for (const route of ROUTES) {
      const code = sansCommentaires(source(route));
      expect(code, `${route} : purpose n est pas valide`).toContain('purposeAcceptable');
    }
  });

  /**
   * LA DÉMONSTRATION. On appelle la vraie route, avec `purpose: 'analyse'`, et
   * on regarde ce qu'elle rend.
   */
  it('signed-url REFUSE desormais un purpose visant l espace reserve', async () => {
    delete process.env.MINIO_PUBLIC_ENDPOINT; // mode relais : pas de présigné
    const { POST } = await import('@/app/api/upload/signed-url/route');
    const res = await POST(new Request('https://studiio.pro/api/upload/signed-url', {
      method: 'POST',
      body: JSON.stringify({
        filename: 'mon rush.mp4', contentType: 'video/mp4', purpose: 'analyse',
      }),
    }) as never);
    // Plus aucune clé n'est délivrée : le refus tombe avant la signature.
    expect(res.status).toBe(422);
    const corps = await res.json() as { success: boolean; path?: string };
    expect(corps.success).toBe(false);
    expect(corps.path).toBeUndefined();
  });

  it('un purpose normal continue de passer — la garde ne mord que le reserve', async () => {
    delete process.env.MINIO_PUBLIC_ENDPOINT;
    const { POST } = await import('@/app/api/upload/signed-url/route');
    const res = await POST(new Request('https://studiio.pro/api/upload/signed-url', {
      method: 'POST',
      body: JSON.stringify({
        filename: 'mon rush.mp4', contentType: 'video/mp4', purpose: 'rush',
      }),
    }) as never);
    const corps = await res.json() as { path: string; bucket: string };
    expect(corps.bucket).toBe('media');
    expect(corps.path).toMatch(new RegExp(`^${UTILISATEUR}/rush/\\d+-mon_rush\\.mp4$`));
  });

  it('multipart REFUSE aussi, et n initie RIEN dans MinIO', async () => {
    process.env.MINIO_PUBLIC_ENDPOINT = 'minio.studiio.pro';
    try {
      const { POST } = await import('@/app/api/upload/multipart/route');
      const res = await POST(new Request('https://studiio.pro/api/upload/multipart', {
        method: 'POST',
        body: JSON.stringify({
          action: 'initiate', filename: 'rush.mp4',
          contentType: 'video/mp4', purpose: 'analyse',
        }),
      }) as never);
      expect(res.status).toBe(422);
      // La preuve qui compte : aucun envoi n'a été initié dans le stockage.
      expect(etat.multipart).toEqual([]);
    } finally {
      delete process.env.MINIO_PUBLIC_ENDPOINT;
    }
  });

  /**
   * Et `purpose` n'est même pas limité à UN segment : rien n'y filtre la barre
   * oblique. `purpose: 'x/analyse/y'` place le segment n'importe où.
   */
  it('`purpose` ne peut plus contenir de barre oblique', async () => {
    delete process.env.MINIO_PUBLIC_ENDPOINT;
    const { POST } = await import('@/app/api/upload/signed-url/route');
    const res = await POST(new Request('https://studiio.pro/api/upload/signed-url', {
      method: 'POST',
      body: JSON.stringify({
        filename: 'x.mp4', contentType: 'video/mp4', purpose: 'projets/analyse/2026',
      }),
    }) as never);
    // Une barre oblique permettrait de fabriquer un segment réservé au milieu
    // du chemin — elle est refusée pour cette seule raison.
    expect(res.status).toBe(422);
    const corps = await res.json() as { path?: string };
    expect(corps.path).toBeUndefined();
  });

  /**
   * Le relais d'écriture ne contraint que le PRÉFIXE. Tout le reste de la clé
   * vient de la chaîne de requête : un compte peut écrire exactement à la
   * forme d'une vignette, dans son propre espace.
   */
  it('le relais d écriture n exige que le préfixe du compte, rien de plus', () => {
    const code = sansCommentaires(source('src/app/api/storage/upload/route.ts'));
    expect(code).toContain("searchParams.get('path')");
    expect(code).toContain('storagePath.startsWith(`${session.user.id}/`)');
    expect(code, 'aucune contrainte de forme au-delà du préfixe')
      .not.toMatch(MOTIF_SEGMENT_INTERDIT);
  });

  /**
   * LA CONSÉQUENCE, écrite noir sur blanc.
   *
   * Ce test PASSE — et c'est bien le problème. Il documente qu'après le lot B,
   * un fichier téléversé légitimement par un utilisateur, sous une clé délivrée
   * par notre propre serveur, devient illisible pour lui.
   */
  it.skipIf(!BLOCAGE_ACTIF)(
    'RÉGRESSION DÉMONTRÉE — le rush d un utilisateur devient illisible',
    async () => {
      const cle = `${UTILISATEUR}/analyse/${HORODATAGE}-mon_rush.mp4`;
      const octets = deposer('media', cle, Buffer.alloc(4096, 6));
      const r = await demander('media', cle);
      expect(
        r.statut,
        'une clé délivrée par /api/upload/signed-url avec purpose=analyse est '
        + 'refusée par la route de lecture : le fichier est perdu pour son '
        + 'propriétaire, sans message et sans trace. Correctif attendu : '
        + 'contraindre `purpose` à une liste blanche dans les trois routes '
        + 'd envoi, OU restreindre la règle à la forme exacte des vignettes.',
      ).toBe(404);
      expect(octets.length).toBe(4096); // l'objet EST là ; c'est la lecture qui refuse
    },
  );
});

/**
 * Une règle plus étroite n'aurait pas ce faux positif.
 *
 * Proposition, éprouvée ici comme fonction pure — aucun code de production
 * n'est touché. La forme des vignettes est ENTIÈREMENT déterminée par
 * `extraction.ts` : quatre segments, le dernier `vignette-NN.jpg`. Or les trois
 * routes d'envoi préfixent TOUJOURS le nom de fichier d'un horodatage
 * (`${Date.now()}-${filename}`) : aucune d'elles ne peut produire un dernier
 * segment qui commence par `vignette-`. La collision disparaît.
 */
describe('Une règle ancrée sur la forme réelle n aurait aucun faux positif', () => {
  const regleEtroite = (bucket: string, cle: string): boolean =>
    bucket === 'media'
    && /^[^/]+\/analyse\/[^/]+\/vignette-\d{2}\.jpg$/.test(cle);

  it('elle attrape la clé que l extraction écrit', () => {
    expect(regleEtroite('media', CLE_VIGNETTE)).toBe(true);
    expect(regleEtroite('media', `${UTILISATEUR}/analyse/an-77/vignette-12.jpg`)).toBe(true);
  });

  it('elle laisse passer tout ce qu une route d envoi peut produire', () => {
    const produits = [
      `${UTILISATEUR}/analyse/${HORODATAGE}-mon_rush.mp4`,
      `${UTILISATEUR}/analyse/${HORODATAGE}-vignette-01.jpg`,
      `${UTILISATEUR}/projets/analyse/${HORODATAGE}-vignette-01.jpg`,
    ];
    for (const cle of produits) expect(regleEtroite('media', cle), cle).toBe(false);
  });

  it('elle laisse passer les dix-huit familles réelles de l inventaire', () => {
    for (const f of FAMILLES) expect(regleEtroite(f.bucket, f.cle), f.cle).toBe(false);
  });

  /**
   * Le fait sur lequel repose la proposition : le dernier segment d'une clé
   * d'envoi commence toujours par un horodatage.
   */
  it('les trois routes d envoi horodatent toujours le nom de fichier', () => {
    for (const route of [
      'src/app/api/upload/signed-url/route.ts',
      'src/app/api/upload/multipart/route.ts',
      'src/app/api/upload/media/route.ts',
    ]) {
      expect(sansCommentaires(source(route)), route)
        .toMatch(/\$\{(timestamp|Date\.now\(\))\}-\$\{(safeFilename|filename)\}/);
    }
  });

  /**
   * Et le nom de fichier, lui, ne peut PAS créer de segment : la barre oblique
   * est remplacée. C'est ce qui limite le faux positif à `purpose` seul.
   */
  it('un nom de fichier ne peut pas fabriquer de segment `analyse`', async () => {
    const { sanitizeStorageFilename } = await import('@/lib/storage/sanitize-filename');
    for (const nom of ['a/analyse/b.mp4', '../analyse/x.mp4', 'analyse\\y.mp4']) {
      const propre = sanitizeStorageFilename(nom);
      expect(propre, nom).not.toContain('/');
      expect(propre, nom).not.toContain('\\');
    }
  });

  /**
   * ⚠️ En revanche `sanitizeStorageFilename` GARDE les points : `../x.mp4`
   * devient `.._x.mp4`, qui contient encore `..`. Ce n'est pas une traversée —
   * il n'y a plus de barre oblique — mais la clé complète est malgré tout
   * refusée une route plus loin, par `cleObjetValide`. Les deux gardes ne font
   * pas le même travail, et il ne faut pas prendre l'une pour l'autre.
   */
  it('le point double survit au nettoyage, et c est `cleObjetValide` qui l arrête',
    async () => {
      const { sanitizeStorageFilename } = await import('@/lib/storage/sanitize-filename');
      const { cleObjetValide } = await import('@/lib/storage/acces-objet');
      const propre = sanitizeStorageFilename('../analyse/x.mp4');
      expect(propre).toContain('..');
      expect(cleObjetValide(`${UTILISATEUR}/rush/${HORODATAGE}-${propre}`)).toBe(false);
    });
});
