// @vitest-environment node
/**
 * M3-B2.2 — Les vignettes : produites pour de vrai, ou comptées comme perdues.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE DÉFAUT QUE CE FICHIER FERME
 * ─────────────────────────────────────────────────────────────────────────
 *
 * En production, une analyse a été enregistrée `reussie` avec `vignettes: []`
 * alors que huit positions étaient attendues : ffprobe avait mesuré le rush
 * — durée, dimensions, codecs, tout était juste — et pas une seule JPEG
 * n'était sortie. Rien, ni dans le résultat ni dans la ligne, ne disait que
 * huit extractions avaient échoué.
 *
 * La cause tient en une ligne de `analyse/extraction.ts` :
 *
 *     if (r.timeout || r.introuvable || r.code !== 0 || r.stdout.length === 0) continue;
 *
 * Quatre modes de panne distincts — processus tué par le délai, binaire
 * absent, ffmpeg en erreur, sortie vide — sont ramenés à un `continue` muet.
 * Le commentaire au-dessus le justifie pour UNE vignette qui tombe sur une
 * zone sans image clé exploitable, et c'est une bonne raison. Mais la même
 * ligne avale AUSSI le cas où les huit échouent pour la même cause
 * systémique, et `executer()` rend alors `ok: true, motif: null`.
 *
 * Un succès sans image est indiscernable d'un succès avec images pour tout
 * ce qui lit la ligne ensuite. C'est le défaut, et c'est ce que ce fichier
 * transforme en test.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI EST PROUVÉ, ET AVEC QUOI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Avec les VRAIS binaires, sur une VRAIE vidéo, servie par un VRAI serveur
 * HTTP local qui honore `Range` — pas une doublure de ffmpeg. Une doublure
 * ne prouverait que sa propre programmation : que huit JPEG non vides
 * sortent d'un vrai décodage est précisément ce qu'elle ne peut pas garantir,
 * et c'est exactement ce qui manquait en production.
 *
 * Le serveur compte les octets qu'il sert et enregistre les en-têtes `Range`
 * reçus, avec le code de réponse et le `Content-Range` rendu. C'est ainsi que
 * se prouve la règle de coût du lot — le rush n'est pas téléchargé en entier
 * pour une vignette — plutôt qu'en la relisant dans un commentaire.
 *
 * Seul le STOCKAGE est doublé (`@/lib/storage/minio-client`) : `statObject`
 * répond une taille, la signature rend l'URL de NOTRE serveur, et `putObject`
 * garde les octets en mémoire. Aucun accès réseau ne sort de la machine.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI LA FIXTURE PÈSE ~12 Mo ET NON QUELQUES CENTAINES DE KILO-OCTETS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * C'est mesuré, pas choisi. En dessous d'environ un méga-octet, ffmpeg lit le
 * fichier entier dans ses tampons dès l'ouverture et ne demande plus rien :
 * TOUTES les requêtes partent alors de l'octet zéro, aucun positionnement
 * n'est observable, et les points 5 et 6 du cahier des charges de ce fichier
 * ne pourraient être ni vrais ni faux — seulement invérifiables. Une fixture
 * minuscule aurait donné un test vert qui ne prouve rien, ce qui est pire
 * qu'un test absent.
 *
 * Au-delà, le comportement mesuré est celui d'un vrai rush : une requête
 * `bytes=0-` pour l'en-tête, puis un `Range` à décalage non nul par
 * positionnement. Le coût d'une vignette devient alors une CONSTANTE — de
 * l'ordre de deux à trois méga-octets, tampons compris — indépendante de la
 * taille du fichier, ce qui est précisément la propriété à démontrer.
 *
 * La fixture est fabriquée à la volée dans un dossier temporaire et
 * supprimée par `afterAll`. Rien n'est écrit dans le dépôt.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI `environment: node`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le projet tourne en `jsdom` par défaut. On ouvre ici de vraies sockets, on
 * lance de vrais processus et on lit des en-têtes HTTP bruts : la pile
 * `fetch` de jsdom n'est pas ce qu'on mesure.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { createServer, request as requeteHttp, type Server } from 'http';
import { chmodSync, createReadStream, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { cheminFfmpeg, cheminFfprobe } from '@/lib/ffmpeg/binaires';

// ─────────────────────────────────────────────────────────────────────────
// La doublure de stockage : elle ne stocke rien sur disque, elle raconte tout
// ─────────────────────────────────────────────────────────────────────────

/** Ce que `statObject` doit répondre, par `bucket/cle`. */
let objets: Record<string, { taille: number }> = {};

/** Les rangs d'appel de `putObject` qui doivent LEVER. Base 0. */
let putObjectEchoueAuRang = new Set<number>();

/** Combien de fois `putObject` a été appelé, échecs compris. */
let appelsPutObject = 0;

interface EcritureVignette {
  bucket: string;
  cle: string;
  taille: number;
  entetes?: Record<string, string>;
  /** Les octets réellement écrits. Une vignette est un fichier, on le vérifie. */
  corps: Buffer;
  /** Le compteur d'octets servis par le serveur AU MOMENT de cette écriture. */
  octetsServisAlors: number;
}

/** Tout ce qui a été écrit dans le stockage pendant un test. */
let ecritures: EcritureVignette[] = [];

let portServeur = 0;

/**
 * Les modules que ce chemin n'a PAS le droit de toucher, et la preuve à
 * l'exécution qu'il ne les touche pas.
 *
 * La fabrique d'un `vi.mock` n'est évaluée qu'au PREMIER import du module
 * qu'elle remplace. Tant que ce tableau reste vide, c'est qu'aucun de ces
 * quatre modules n'est entré dans le graphe — ni directement, ni par un
 * import transitif de `extraction.ts`. C'est une preuve dynamique, que la
 * lecture du source (plus bas) double par une preuve statique : l'une
 * attrape ce que l'autre laisse passer.
 */
let modulesInterditsTouches: string[] = [];

vi.mock('@/lib/credits/system', () => {
  modulesInterditsTouches.push('@/lib/credits/system');
  return {};
});
vi.mock('@/lib/autopilot/render', () => {
  modulesInterditsTouches.push('@/lib/autopilot/render');
  return {};
});
vi.mock('@/lib/autopilot/analyse/passerelle', () => {
  modulesInterditsTouches.push('@/lib/autopilot/analyse/passerelle');
  return {};
});
vi.mock('@/lib/social/publishing', () => {
  modulesInterditsTouches.push('@/lib/social/publishing');
  return {};
});

vi.mock('@/lib/storage/minio-client', () => ({
  clientMinio: () => ({
    statObject: async (bucket: string, cle: string) => {
      const o = objets[`${bucket}/${cle}`];
      if (!o) throw new Error('The specified key does not exist.');
      return { size: o.taille };
    },
    putObject: async (
      bucket: string, cle: string, corps: unknown,
      taille?: number, entetes?: Record<string, string>,
    ) => {
      const rang = appelsPutObject;
      appelsPutObject += 1;
      // La panne d'écriture d'UNE vignette, jouée pour de vrai. C'est le seul
      // moyen honnête de faire échouer une seule position sans toucher au
      // module : le stockage refuse, la boucle doit continuer.
      if (putObjectEchoueAuRang.has(rang)) {
        throw new Error(`ecriture refusee pour la vignette ${rang + 1}`);
      }
      const buf = corps as Buffer;
      ecritures.push({
        bucket, cle, taille: Number(taille ?? 0), entetes,
        corps: Buffer.isBuffer(buf) ? Buffer.from(buf) : Buffer.alloc(0),
        octetsServisAlors: octetsServis,
      });
      return {};
    },
  }),
  signeurInterne: () => ({
    /**
     * Une URL de la MÊME FORME qu'une présignée MinIO : les paramètres
     * `X-Amz-*` y sont, signature comprise. C'est ce qui rend vérifiable le
     * point « rien ne fuit » : si le module recopiait l'URL quelque part,
     * `X-Amz-Signature` apparaîtrait dans ce qu'il rend.
     */
    presignedGetObject: async (bucket: string, cle: string, ttl: number) => (
      `http://127.0.0.1:${portServeur}/${bucket}/${encodeURI(cle)}`
      + '?X-Amz-Algorithm=AWS4-HMAC-SHA256'
      + `&X-Amz-Credential=${randomBytes(6).toString('hex')}%2Fstudiio%2Fs3%2Faws4_request`
      + `&X-Amz-Date=20260829T000000Z&X-Amz-Expires=${ttl}&X-Amz-SignedHeaders=host`
      + `&X-Amz-Signature=${randomBytes(16).toString('hex')}`
    ),
  }),
  signeurPublic: () => null,
}));

// ─────────────────────────────────────────────────────────────────────────
// La fixture et le serveur HTTP à `Range`
// ─────────────────────────────────────────────────────────────────────────

const RACINE = join(tmpdir(), `studiio-m3b22-${process.pid}`);
const FICHIERS: Record<string, string> = {};

interface RequeteObservee {
  range: string | null;
  statut: number;
  contentRange: string | null;
  acceptRanges: string | null;
}

/** Chaque requête reçue, dans l'ordre, avec ce qu'on lui a répondu. */
let requetes: RequeteObservee[] = [];

/** Le total d'octets réellement sortis du serveur depuis la dernière remise à zéro. */
let octetsServis = 0;

let serveur: Server | null = null;

/**
 * Les binaires répondent-ils ? Décidé AU CHARGEMENT, pas dans `beforeAll`.
 *
 * Vitest collecte les tests — donc évalue `it` ou `it.skip` — avant
 * d'exécuter le moindre `beforeAll`. Une disponibilité calculée là-bas
 * arriverait toujours trop tard, et TOUS les tests seraient ignorés en
 * silence sur une machine parfaitement équipée.
 */
function repond(chemin: string): boolean {
  try {
    execFileSync(chemin, ['-hide_banner', '-version'], { timeout: 15_000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
const ffmpegDispo = repond(cheminFfmpeg());
const ffprobeDispo = repond(cheminFfprobe());
const binairesDispo = ffmpegDispo && ffprobeDispo;
const siBinaires = () => (binairesDispo ? it : it.skip);

/**
 * ~12 Mo de bruit, 32 secondes, avec une piste audio.
 *
 * Le bruit est là pour la TAILLE : `testsrc` est si compressible qu'il faut
 * une minute de vidéo sans perte pour dépasser deux méga-octets, et la
 * fixture doit franchir le seuil au-delà duquel ffmpeg cesse de tout garder
 * en tampon (voir l'en-tête). Trente-deux secondes garantissent au passage
 * que c'est le PLAFOND de huit vignettes qui décide, et non la durée.
 *
 * Le binaire des fixtures est CELUI QUE LE MODULE UTILISERA : les fabriquer
 * avec un ffmpeg et les lire avec un autre ferait ressembler une divergence
 * de versions à un bug du module.
 */
const DUREE_FIXTURE = 32;

function fabriquerRush(): string {
  const chemin = join(RACINE, 'rush.mp4');
  execFileSync(cheminFfmpeg(), [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `nullsrc=s=320x240:r=10:d=${DUREE_FIXTURE},geq=random(1)*255:128:128`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${DUREE_FIXTURE}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '10', '-qp', '34',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '2', '-ar', '44100', '-shortest',
    // `+faststart` place le `moov` en tête, comme un rush téléversé sain.
    '-movflags', '+faststart',
    chemin,
  ], { timeout: 120_000, stdio: 'pipe' });
  return chemin;
}

beforeAll(async () => {
  mkdirSync(RACINE, { recursive: true });
  if (binairesDispo) FICHIERS.rush = fabriquerRush();

  serveur = createServer((req, res) => {
    // `/bucket/<userId>/rush/<nom de fixture>` — seul le dernier segment
    // nomme le fichier servi. Le reste imite la forme réelle d'une clé.
    const chemin = decodeURI((req.url || '').split('?')[0]);
    const nom = chemin.split('/').filter(Boolean).pop() ?? '';
    const fichier = FICHIERS[nom.replace(/\.mp4$/, '')];
    if (!fichier) {
      requetes.push({ range: null, statut: 404, contentRange: null, acceptRanges: null });
      res.writeHead(404).end();
      return;
    }

    const taille = statSync(fichier).size;
    const range = req.headers.range ? String(req.headers.range) : null;
    const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;

    let flux;
    let observee: RequeteObservee;
    if (m) {
      const debut = m[1] ? Number(m[1]) : Math.max(0, taille - Number(m[2]));
      const fin = m[1] && m[2] ? Math.min(Number(m[2]), taille - 1) : taille - 1;
      if (debut >= taille) {
        requetes.push({ range, statut: 416, contentRange: `bytes */${taille}`, acceptRanges: 'bytes' });
        res.writeHead(416, { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes */${taille}` }).end();
        return;
      }
      const contentRange = `bytes ${debut}-${fin}/${taille}`;
      observee = { range, statut: 206, contentRange, acceptRanges: 'bytes' };
      res.writeHead(206, {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Content-Range': contentRange,
        'Content-Length': String(fin - debut + 1),
      });
      // Un tampon volontairement petit : le compteur mesure alors ce que le
      // client a demandé, et non ce que le noyau a bien voulu absorber
      // d'avance.
      flux = createReadStream(fichier, { start: debut, end: fin, highWaterMark: 8192 });
    } else {
      observee = { range: null, statut: 200, contentRange: null, acceptRanges: 'bytes' };
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Content-Length': String(taille),
      });
      flux = createReadStream(fichier, { highWaterMark: 8192 });
    }
    requetes.push(observee);
    flux.on('data', (c: Buffer | string) => { octetsServis += c.length; });
    // Sans cela, le flux continuerait de pousser des octets APRÈS que ffmpeg
    // a coupé pour se positionner ailleurs — et le compteur mesurerait la
    // générosité du serveur au lieu de l'appétit du client.
    res.on('close', () => flux.destroy());
    flux.pipe(res);
  });

  await new Promise<void>((resolve) => {
    serveur!.listen(0, '127.0.0.1', () => {
      const adr = serveur!.address();
      portServeur = typeof adr === 'object' && adr ? adr.port : 0;
      resolve();
    });
  });
}, 180_000);

afterAll(async () => {
  if (serveur) await new Promise<void>((r) => serveur!.close(() => r()));
  // La fixture ne survit pas au fichier de test : le disque de la machine de
  // développement est étroit, et douze méga-octets oubliés à chaque exécution
  // finiraient par se voir.
  try { rmSync(RACINE, { recursive: true, force: true }); } catch { /* rien à nettoyer */ }
});

beforeEach(() => {
  objets = {};
  ecritures = [];
  putObjectEchoueAuRang = new Set();
  appelsPutObject = 0;
  requetes = [];
  octetsServis = 0;
});

// ─────────────────────────────────────────────────────────────────────────
// Les appels
// ─────────────────────────────────────────────────────────────────────────

const USER = 'u-m3b22';
const ANALYSE = 'a-m3b22';
const CLE = `${USER}/rush/rush`;

function poser(): void {
  objets[`media/${CLE}`] = { taille: statSync(FICHIERS.rush).size };
}

async function extraire() {
  const { extraireRush } = await import('@/lib/autopilot/analyse/extraction');
  return extraireRush({ bucket: 'media', cleObjet: CLE, userId: USER, analysisId: ANALYSE });
}

/**
 * L'extraction nominale, jouée UNE fois et observée par plusieurs tests.
 *
 * Huit vignettes, c'est huit lancements de ffmpeg et une douzaine de
 * méga-octets sur la boucle locale. La rejouer pour chaque assertion
 * n'apprendrait rien de plus et rendrait ce fichier le premier qu'on
 * désactiverait.
 */
interface Nominal {
  resultat: Awaited<ReturnType<typeof extraire>>;
  ecritures: EcritureVignette[];
  requetes: RequeteObservee[];
  octetsServis: number;
  taille: number;
}
let nominal: Nominal | null = null;

beforeAll(async () => {
  if (!binairesDispo) return;
  objets = {}; ecritures = []; requetes = []; octetsServis = 0;
  putObjectEchoueAuRang = new Set(); appelsPutObject = 0;
  poser();
  const resultat = await extraire();
  // Le serveur peut avoir encore quelques octets en vol quand le dernier
  // ffmpeg rend la main : on laisse les sockets se fermer avant de lire le
  // compteur, sinon la mesure dépendrait de l'ordonnanceur.
  await new Promise<void>((r) => { setTimeout(r, 300); });
  nominal = {
    resultat,
    ecritures: [...ecritures],
    requetes: [...requetes],
    octetsServis,
    taille: statSync(FICHIERS.rush).size,
  };
}, 300_000);

// ─────────────────────────────────────────────────────────────────────────

describe('M3-B2.2 — l instrument de mesure lui-même', () => {
  it('les binaires attendus sont là, ou le fichier le dit', () => {
    // Un test qui se dégrade en silence est pire qu'un test absent : si les
    // binaires manquent, tout le reste est `skip` et cette ligne est le seul
    // endroit qui l'annonce.
    expect({ ffmpeg: ffmpegDispo, ffprobe: ffprobeDispo }).toEqual({
      ffmpeg: ffmpegDispo, ffprobe: ffprobeDispo,
    });
    if (!binairesDispo) {
      console.warn(
        `[m3b22] binaires absents (ffmpeg=${ffmpegDispo}, ffprobe=${ffprobeDispo}) :`
        + ' les preuves réelles sont ignorées.',
      );
    }
  });

  siBinaires()('le serveur honore vraiment `Range` : 206, Accept-Ranges, Content-Range', async () => {
    const taille = statSync(FICHIERS.rush).size;
    const reponse = await new Promise<{ statut: number; entetes: Record<string, unknown>; octets: number }>(
      (resolve, reject) => {
        const req = requeteHttp({
          host: '127.0.0.1', port: portServeur,
          path: `/media/${encodeURI(CLE)}?X-Amz-Signature=temoin`,
          headers: { Range: 'bytes=100-199' },
        }, (res) => {
          let n = 0;
          res.on('data', (c: Buffer) => { n += c.length; });
          res.on('end', () => resolve({
            statut: res.statusCode ?? 0, entetes: res.headers as Record<string, unknown>, octets: n,
          }));
        });
        req.on('error', reject);
        req.end();
      },
    );

    expect(reponse.statut).toBe(206);
    expect(reponse.entetes['accept-ranges']).toBe('bytes');
    expect(reponse.entetes['content-range']).toBe(`bytes 100-199/${taille}`);
    expect(reponse.octets).toBe(100);
  }, 30_000);

  siBinaires()('la fixture est une vraie vidéo, lisible par ffprobe', () => {
    const taille = statSync(FICHIERS.rush).size;
    // Au-dessus du seuil de tampon, sinon aucun positionnement ne serait
    // observable et les points 5 et 6 seraient invérifiables.
    expect(taille).toBeGreaterThan(2 * 1024 * 1024);
    // Et pas démesurée non plus : le disque de développement est étroit.
    expect(taille).toBeLessThan(40 * 1024 * 1024);
    const entete = readFileSync(FICHIERS.rush).subarray(4, 8).toString('ascii');
    expect(entete).toBe('ftyp');
  });
});

describe('M3-B2.2 — la mesure et les vignettes, sur un vrai rush servi en `Range`', () => {
  siBinaires()('ffprobe réussit sur l URL présignée', () => {
    const r = nominal!.resultat;
    expect(r.motif).toBe(null);
    expect(r.ok).toBe(true);
    // C'est bien ffprobe qui a mesuré, pas le repli : le point de départ du
    // défaut de production est exactement celui-là — la sonde réussit.
    expect(r.technique.sonde).toBe('ffprobe');
    expect(r.dureeSecondes).toBeGreaterThan(DUREE_FIXTURE - 0.6);
    expect(r.dureeSecondes).toBeLessThan(DUREE_FIXTURE + 0.6);
    expect(r.technique.codecVideo).toBe('h264');
    expect(r.technique.largeur).toBe(320);
    expect(r.technique.hauteur).toBe(240);
    expect(r.technique.aAudio).toBe(true);
    expect(r.technique.tailleOctets).toBe(nominal!.taille);
  });

  siBinaires()('produit de VRAIES JPEG non vides, signature FF D8 FF', () => {
    const ecrites = nominal!.ecritures;
    expect(ecrites.length, 'aucune vignette écrite').toBeGreaterThan(0);
    for (const e of ecrites) {
      expect(e.corps.length, e.cle).toBeGreaterThan(1024);
      expect([e.corps[0], e.corps[1], e.corps[2]], e.cle).toEqual([0xff, 0xd8, 0xff]);
      // Le marqueur de fin d'image : un JPEG tronqué passerait la signature
      // d'en-tête sans être une image.
      expect([e.corps[e.corps.length - 2], e.corps[e.corps.length - 1]], e.cle)
        .toEqual([0xff, 0xd9]);
      expect(e.entetes?.['Content-Type']).toBe('image/jpeg');
      expect(e.taille).toBe(e.corps.length);
    }
    expect(nominal!.resultat.vignettes.length).toBe(ecrites.length);
  });

  siBinaires()('au plus huit vignettes, quelle que soit la durée', async () => {
    const { VIGNETTES_MAX, positionsVignettes } = await import('@/lib/autopilot/analyse/extraction');
    expect(VIGNETTES_MAX).toBe(8);
    // Sur le fichier réel : trente-deux secondes, huit vignettes, pas
    // trente-deux. C'est le plafond qui décide.
    expect(nominal!.resultat.vignettes.length).toBe(VIGNETTES_MAX);
    expect(new Set(nominal!.resultat.vignettes.map((v) => v.cle)).size).toBe(VIGNETTES_MAX);
    for (const duree of [8, 32, 600, 36_000]) {
      expect(positionsVignettes(duree).length, `durée ${duree}`).toBeLessThanOrEqual(VIGNETTES_MAX);
    }
    expect(positionsVignettes(36_000).length).toBe(VIGNETTES_MAX);
  });

  siBinaires()('au moins un `Range` se positionne loin dans le fichier', () => {
    const avecRange = nominal!.requetes.filter((r) => r.range !== null);
    expect(avecRange.length, 'aucune requête `Range`').toBeGreaterThan(0);
    expect(avecRange.every((r) => r.statut === 206)).toBe(true);
    expect(avecRange.every((r) => r.acceptRanges === 'bytes')).toBe(true);
    expect(avecRange.every((r) => (r.contentRange ?? '').startsWith('bytes '))).toBe(true);

    const decalages = avecRange
      .map((r) => Number(/bytes=(\d+)-/.exec(r.range!)?.[1] ?? 0))
      .filter((n) => n > 0);
    expect(decalages.length, 'tout a été lu depuis l octet zéro').toBeGreaterThan(0);
    // Le plus lointain doit tomber dans la seconde moitié : c'est ce qui
    // distingue un vrai saut d'un simple redémarrage de lecture.
    expect(Math.max(...decalages)).toBeGreaterThan(nominal!.taille / 2);
  });

  siBinaires()('la vignette de FIN ne fait pas télécharger tout le rush', () => {
    const ecrites = nominal!.ecritures;
    expect(ecrites.length).toBeGreaterThanOrEqual(2);
    const derniere = ecrites[ecrites.length - 1];
    const avantDerniere = ecrites[ecrites.length - 2];
    // Les octets servis ENTRE l'avant-dernière écriture et la dernière : le
    // coût de la seule vignette la plus tardive, celle qui exige le
    // positionnement le plus lointain.
    const coutDerniere = derniere.octetsServisAlors - avantDerniere.octetsServisAlors;
    expect(coutDerniere, 'compteur figé : la mesure ne mesure rien').toBeGreaterThan(0);
    expect(
      coutDerniere,
      `vignette de fin : ${coutDerniere} octets servis pour un rush de ${nominal!.taille}`,
    ).toBeLessThan(nominal!.taille / 2);
  });

  siBinaires()('une vignette perdue n emporte pas les autres', async () => {
    poser();
    // Le stockage refuse la QUATRIÈME écriture, et elle seule.
    putObjectEchoueAuRang = new Set([3]);
    const r = await extraire();

    expect(r.ok, 'une seule vignette perdue ne doit pas casser la mesure').toBe(true);
    expect(r.motif).toBe(null);
    expect(r.dureeSecondes).toBeGreaterThan(DUREE_FIXTURE - 0.6);
    // Huit tentatives, sept écritures retenues.
    expect(appelsPutObject).toBe(8);
    expect(ecritures.length).toBe(7);
    expect(r.vignettes.length).toBe(7);
    // Et celles qui restent sont de vraies images, pas des reliquats.
    for (const e of ecritures) {
      expect([e.corps[0], e.corps[1], e.corps[2]]).toEqual([0xff, 0xd8, 0xff]);
    }
  }, 300_000);
});

// ─────────────────────────────────────────────────────────────────────────
// LE DÉFAUT LUI-MÊME
// ─────────────────────────────────────────────────────────────────────────

describe('M3-B2.2 — un échec TOTAL des vignettes n est pas une réussite', () => {
  /**
   * La panne de production, rejouée à l'identique.
   *
   * `FFPROBE_PATH` reste celui de la machine — la sonde RÉUSSIT, comme en
   * production — et `FFMPEG_PATH` désigne un chemin qui n'existe pas : les
   * huit extractions rendent `ENOENT`, et la ligne
   *
   *     if (r.timeout || r.introuvable || r.code !== 0 || r.stdout.length === 0) continue;
   *
   * les avale toutes les huit. C'est le seul montage qui reproduit le
   * symptôme exact — ffprobe vert, zéro JPEG — sans porte dérobée dans le
   * module : `cheminFfmpeg()` lit l'environnement à CHAQUE appel.
   */
  async function extraireSansFfmpeg() {
    const avant = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = join(RACINE, 'ffmpeg-qui-n-existe-pas');
    try {
      poser();
      return await extraire();
    } finally {
      if (avant === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = avant;
    }
  }

  siBinaires()('le montage reproduit bien la panne : sonde verte, zéro vignette', async () => {
    const r = await extraireSansFfmpeg();
    // Ce bloc-ci ne juge pas : il CONSTATE que le décor est le bon. Sans
    // lui, l'assertion suivante pourrait rougir pour une raison étrangère.
    expect(r.technique.sonde, 'la sonde doit avoir réussi').toBe('ffprobe');
    expect(r.dureeSecondes).toBeGreaterThan(DUREE_FIXTURE - 0.6);
    expect(r.vignettes).toEqual([]);
    expect(ecritures.length).toBe(0);
    expect(appelsPutObject).toBe(0);
  }, 300_000);

  siBinaires()('huit positions attendues, zéro produite : le résultat doit le dire', async () => {
    const { positionsVignettes } = await import('@/lib/autopilot/analyse/extraction');
    const r = await extraireSansFfmpeg();

    const attendues = positionsVignettes(r.dureeSecondes ?? 0).length;
    expect(attendues, 'des positions étaient bien attendues').toBe(8);

    /**
     * ⚠️ CETTE ASSERTION EST ROUGE AUJOURD'HUI, ET C'EST LE BUT.
     *
     * Elle n'impose PAS de forme de correction : elle refuse seulement le
     * silence. Deux corrections la satisfont, et ce sont les deux seules
     * défendables :
     *
     *   • rendre l'extraction en échec (`ok: false` + un `motif` du
     *     vocabulaire fermé) quand AUCUNE vignette n'a pu être produite
     *     alors que des positions étaient attendues ;
     *   • garder `ok: true` mais rendre l'échec COMPTABLE, en portant dans
     *     `technique` le nombre de positions attendues et le nombre
     *     d'échecs — de quoi distinguer, après coup, « rush sans image
     *     exploitable » de « ffmpeg absent du conteneur ».
     *
     * Ce qui n'est plus acceptable, c'est `ok: true`, `motif: null`,
     * `vignettes: []` et rien d'autre : la ligne d'analyse est alors
     * enregistrée `reussie` et personne ne peut plus compter les rushes
     * dont l'extraction d'images n'a rien donné.
     */
    const succesSilencieux = r.ok === true
      && r.motif === null
      && r.vignettes.length === 0
      && !('vignettesAttendues' in r.technique)
      && !('vignettesProduites' in r.technique)
      && !('vignettesEchouees' in r.technique);
    expect(
      succesSilencieux,
      'huit vignettes perdues sont ressorties en `ok: true, motif: null` sans aucun compteur',
    ).toBe(false);
  }, 300_000);

  siBinaires()('quelle que soit la correction, elle reste dans le vocabulaire fermé', async () => {
    const { MOTIFS_EXTRACTION } = await import('@/lib/autopilot/analyse/extraction');
    const r = await extraireSansFfmpeg();
    // Aujourd'hui `motif` vaut `null` et cette assertion passe. Elle existe
    // pour la correction : un motif inventé sur place — `vignettes_vides` —
    // casserait tous les comptages par cause.
    if (r.motif !== null) {
      expect(MOTIFS_EXTRACTION as readonly string[]).toContain(r.motif);
    }
    // Et un échec reste un échec complet : pas de demi-succès avec un motif.
    if (r.motif !== null) expect(r.ok).toBe(false);
  }, 300_000);
});

// ─────────────────────────────────────────────────────────────────────────
// Ce qui ne doit jamais sortir d'ici
// ─────────────────────────────────────────────────────────────────────────

describe('M3-B2.2 — l URL présignée et le stderr ne fuient pas', () => {
  const nEstPasUneFuite = (rendu: string, etiquette: string) => {
    expect(rendu, `${etiquette} : signature présignée`).not.toContain('X-Amz-Signature');
    expect(rendu, `${etiquette} : paramètre présigné`).not.toContain('X-Amz-');
    expect(rendu, `${etiquette} : hôte du stockage`).not.toContain('127.0.0.1');
    expect(rendu, `${etiquette} : URL entière`).not.toMatch(/https?:\/\//);
  };

  siBinaires()('rien de ce que rend une extraction réussie ne contient l URL', () => {
    nEstPasUneFuite(JSON.stringify(nominal!.resultat), 'succès');
    // Les CLÉS écrites non plus : ce sont des chemins d'objet, pas des URL.
    for (const e of nominal!.ecritures) {
      expect(e.cle.startsWith(`${USER}/analyse/${ANALYSE}/`)).toBe(true);
      expect(e.cle).not.toContain('://');
      expect(e.cle).not.toContain('..');
    }
  });

  siBinaires()('rien de ce que rend un échec total de vignettes ne contient l URL', async () => {
    const avant = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = join(RACINE, 'ffmpeg-qui-n-existe-pas');
    let r;
    try {
      poser();
      r = await extraire();
    } finally {
      if (avant === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = avant;
    }
    // Aujourd'hui `detail` vaut `null`. Cette assertion tient surtout pour la
    // correction : le jour où l'échec porte un détail, il devra être passé
    // par `masquerUrls` — ffmpeg répète l'URL d'entrée dans ses erreurs.
    nEstPasUneFuite(JSON.stringify(r), 'échec total');
    nEstPasUneFuite(String(r.detail ?? ''), 'detail');
  }, 300_000);

  it('le masquage est aveugle à l URL précise qu on vient de signer', async () => {
    const { masquerUrls } = await import('@/lib/autopilot/analyse/extraction');
    expect(masquerUrls('http://minio:9000/media/x.mp4?X-Amz-Signature=abc: Invalid data'))
      .toBe('<url-masquee> Invalid data');
    expect(masquerUrls('s3://media/objet')).toBe('<url-masquee>');
    expect(masquerUrls('rien à masquer')).toBe('rien à masquer');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Ce que ce chemin ne touche pas
// ─────────────────────────────────────────────────────────────────────────

describe('M3-B2.2 — ni IA, ni crédit, ni rendu, ni publication', () => {
  it('aucun de ces quatre modules n est entré dans le graphe', async () => {
    // La preuve dynamique : les fabriques de `vi.mock` n'ont jamais été
    // évaluées, donc les modules n'ont jamais été importés — ni directement,
    // ni transitivement par `extraction.ts`.
    await import('@/lib/autopilot/analyse/extraction');
    expect(modulesInterditsTouches).toEqual([]);
  });

  it('et le source ne les nomme nulle part', () => {
    const chemin = join(process.cwd(), 'src/lib/autopilot/analyse/extraction.ts');
    // Les commentaires ont le droit de parler de ce qu'on ne fait pas ; seul
    // le code compte.
    const code = readFileSync(chemin, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

    for (const interdit of [
      /credits?\//i, /deduireCredits|deductCredits|debiterCredits/,
      /autopilot\/render|renderMedia|remotion/i,
      /passerelle|openai|anthropic|replicate|@\/lib\/ai/i,
      /social\/publishing|publierSur|publishTo/i,
    ]) {
      expect(code, `extraction.ts ne doit pas contenir ${interdit}`).not.toMatch(interdit);
    }

    // La liste blanche d'imports : elle échoue le jour où un import arrive,
    // sans qu'il ait fallu prévoir son nom.
    const importes = [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect([...new Set(importes)].sort()).toEqual([
      '@/lib/ffmpeg/binaires',
      '@/lib/storage/buckets',
      '@/lib/storage/minio-client',
      './contrat',
      'child_process',
    ].sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────
// L'option que le ffmpeg de production n'a pas
// ─────────────────────────────────────────────────────────────────────────

/**
 * Le seul argument de la commande qui puisse faire échouer les HUIT
 * positions, immédiatement, pendant que ffprobe réussit.
 *
 * `-rw_timeout` n'est pas une option du protocole http : c'est une option
 * générique de l'URLContext (AVIO). Les ffmpeg récents (6.0, 8.1, mesurés)
 * l'acceptent, et elle est alors sans effet sur un stockage qui répond. Le
 * `ffmpeg` 5.1.9 du paquet Debian bookworm — celui qu'installe le
 * `Dockerfile`, et sur lequel `cheminFfmpeg()` retombe quand le binaire de
 * `ffmpeg-static` n'est pas dans l'image — la REFUSE à l'analyse de la ligne
 * de commande, avant même d'ouvrir l'entrée : sortie 1, aucun octet, aucune
 * lecture réseau. Le `ffprobe` du même paquet, lui, l'accepte : d'où une
 * mesure verte et zéro vignette, exactement le symptôme de production.
 *
 * Cette doublure REJOUE ce refus, et délègue tout le reste au vrai binaire :
 * ce qui est vérifié ici, ce n'est pas la programmation de la doublure, mais
 * que la commande de `produireVignettes` survive à un ffmpeg qui ne connaît
 * pas cette option-là. Un binaire qui l'accepte ne prouverait rien : c'est le
 * cas de tous ceux que cette machine possède.
 */
function ffmpegQuiRefuseRwTimeout(): string {
  const chemin = join(RACINE, 'ffmpeg-sans-rw-timeout.js');
  writeFileSync(chemin, [
    '#!/usr/bin/env node',
    "const { spawn } = require('child_process');",
    'const args = process.argv.slice(2);',
    "if (args.includes('-rw_timeout')) {",
    '  process.stderr.write("Unrecognized option \'rw_timeout\'.\\nError splitting the argument list: Option not found\\n");',
    '  process.exit(1);',
    '}',
    "const p = spawn(process.env.FFMPEG_REEL, args, { stdio: 'inherit' });",
    'p.on("exit", (c, s) => process.exit(s ? 1 : (c ?? 1)));',
  ].join('\n'));
  chmodSync(chemin, 0o755);
  return chemin;
}

describe('M3-B2.2 — un ffmpeg qui ignore `-rw_timeout` doit quand même produire les images', () => {
  siBinaires()('huit vignettes, sur un binaire qui refuse cette option', async () => {
    const avantChemin = process.env.FFMPEG_PATH;
    const avantReel = process.env.FFMPEG_REEL;
    process.env.FFMPEG_REEL = cheminFfmpeg();
    process.env.FFMPEG_PATH = ffmpegQuiRefuseRwTimeout();
    try {
      poser();
      const r = await extraire();

      // La mesure passe par ffprobe : elle réussissait DÉJÀ en production,
      // et elle doit continuer de réussir ici, sinon le décor est faux.
      expect(r.ok).toBe(true);
      expect(r.technique.sonde).toBe('ffprobe');

      // Le cœur : les huit images sortent malgré le binaire diminué.
      expect(r.technique.vignettesAttendues).toBe(8);
      expect(r.technique.vignettesProduites).toBe(8);
      expect(r.technique.vignettesEchouees).toBe(0);
      expect(r.vignettes).toHaveLength(8);
      // De VRAIES JPEG, pas des fichiers vides rendus par la doublure.
      for (const e of ecritures) {
        expect([e.corps[0], e.corps[1], e.corps[2]]).toEqual([0xff, 0xd8, 0xff]);
      }
    } finally {
      if (avantChemin === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = avantChemin;
      if (avantReel === undefined) delete process.env.FFMPEG_REEL;
      else process.env.FFMPEG_REEL = avantReel;
    }
  }, 300_000);

  it('`-rw_timeout` ne survit que sur ffprobe, et le source le dit', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/lib/autopilot/analyse/extraction.ts'), 'utf8',
    );
    // Une seule occurrence de l'argument : celle de `sonderFfprobe`, dont la
    // production prouve qu'elle est acceptée. Le jour où quelqu'un le
    // remet sur un lancement de ffmpeg, ce test le dira avant la production.
    const occurrences = source.match(/'-rw_timeout'/g) ?? [];
    expect(occurrences).toHaveLength(1);
    const avant = source.slice(0, source.indexOf("'-rw_timeout'"));
    expect(avant.lastIndexOf('cheminFfprobe()')).toBeGreaterThan(avant.lastIndexOf('cheminFfmpeg()'));
  });
});
