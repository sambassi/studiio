/**
 * M3-B2 — Le moteur d'extraction locale.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI SE PROUVE ICI, ET COMMENT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Deux natures de vérification cohabitent, volontairement :
 *
 * 1. AVEC LES VRAIS BINAIRES, sur de vraies vidéos. Les fixtures sont
 *    fabriquées par le ffmpeg du dépôt lui-même (quelques dizaines de
 *    kilo-octets), servies par un serveur HTTP local qui implémente les
 *    requêtes `Range` — c'est-à-dire exactement ce que MinIO fait, et que
 *    Supabase Storage ne faisait pas. Une doublure de ffprobe ne prouverait
 *    que sa propre programmation : qu'un vrai ffprobe sache lire un vrai
 *    fichier est précisément ce qu'une doublure ne peut pas garantir.
 *
 *    Le serveur enregistre les en-têtes `Range` reçus. C'est ainsi que se
 *    prouve la règle la plus importante du lot — le rush n'est pas
 *    téléchargé — plutôt qu'en la relisant dans un commentaire.
 *
 * 2. SANS AUCUN BINAIRE, sur le code source. Qu'aucun `arrayBuffer`,
 *    qu'aucune écriture disque, qu'aucun `shell` n'existe dans le module ne
 *    se démontre pas en l'exécutant : il faudrait exécuter tous les chemins.
 *    On lit le source, et le test échoue le jour où quelqu'un les ajoute.
 *
 * Les tests du premier groupe sont IGNORÉS si le ffmpeg du dépôt est absent
 * (installation sans binaires natifs). Ils ne sont jamais remplacés par une
 * doublure qui « vérifierait » la même chose : un test qui se dégrade en
 * silence est pire qu'un test absent.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { createServer, type Server } from 'http';
import { createReadStream, statSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { cheminFfmpeg } from '@/lib/ffmpeg/binaires';

// ─────────────────────────────────────────────────────────────────────────
// La doublure de stockage : elle ne stocke rien, elle raconte tout.
// ─────────────────────────────────────────────────────────────────────────

interface ObjetFactice { taille: number; fichier?: string }

/** Ce que `statObject` doit répondre, par `bucket/cle`. */
let objets: Record<string, ObjetFactice> = {};
/** Panne de stockage simulée : `statObject` lève ce message. */
let panneStat: string | null = null;
/** `signeurInterne()` rend `null` quand ceci est vrai. */
let sansSigneur = false;
/** `signeurInterne()` LÈVE quand ceci est vrai — comme `require('minio')`
 *  le ferait sur un paquet absent. */
let signeurLeve = false;
/** Tout ce qui a été écrit dans le stockage pendant un test. */
let ecritures: Array<{ bucket: string; cle: string; taille: number; entetes?: Record<string, string> }> = [];

let portServeur = 0;

vi.mock('@/lib/storage/minio-client', () => ({
  clientMinio: () => ({
    statObject: async (bucket: string, cle: string) => {
      if (panneStat) throw new Error(panneStat);
      const o = objets[`${bucket}/${cle}`];
      if (!o) throw new Error('The specified key does not exist.');
      return { size: o.taille };
    },
    putObject: async (
      bucket: string, cle: string, corps: unknown,
      taille?: number, entetes?: Record<string, string>,
    ) => {
      ecritures.push({ bucket, cle, taille: Number(taille ?? 0), entetes });
      // Une vignette est un VRAI JPEG : on le vérifie ici plutôt que de
      // croire ffmpeg sur parole. `FF D8 FF` est sa signature.
      const buf = corps as Buffer;
      expect(Buffer.isBuffer(buf), 'le corps écrit est un Buffer').toBe(true);
      expect([buf[0], buf[1], buf[2]]).toEqual([0xff, 0xd8, 0xff]);
      return {};
    },
  }),
  signeurInterne: () => {
    if (signeurLeve) throw new Error("Cannot find module 'minio'");
    return sansSigneur ? null : {
    presignedGetObject: async (bucket: string, cle: string, ttl: number) => {
      // Le TTL remonte dans l'URL pour qu'un test puisse l'observer sans
      // avoir à espionner l'appel.
      return `http://127.0.0.1:${portServeur}/${bucket}/${encodeURI(cle)}?ttl=${ttl}&sig=${randomBytes(8).toString('hex')}`;
      },
    };
  },
  signeurPublic: () => null,
}));

// ─────────────────────────────────────────────────────────────────────────
// Fixtures et serveur HTTP à `Range`
// ─────────────────────────────────────────────────────────────────────────

const RACINE = join(tmpdir(), `studiio-m3b2-${process.pid}`);
const FICHIERS: Record<string, string> = {};

/** Les `Range` reçus par le serveur, dans l'ordre. */
let rangesRecus: string[] = [];

let serveur: Server | null = null;

const ffmpegDuDepot = cheminFfmpeg;

/**
 * ffmpeg répond-il ? Décidé AU CHARGEMENT, pas dans `beforeAll`.
 *
 * Vitest collecte les tests — donc évalue `it` ou `it.skip` — avant
 * d'exécuter le moindre `beforeAll`. Une disponibilité calculée là-bas
 * arriverait toujours trop tard, et TOUS les tests seraient ignorés en
 * silence sur une machine parfaitement équipée. C'est exactement ce qui
 * s'est produit à la première rédaction de ce fichier.
 */
const ffmpegDispo = (() => {
  try {
    execFileSync(ffmpegDuDepot(), ['-hide_banner', '-version'], { timeout: 15_000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})();

/**
 * Le ffmpeg des fixtures est CELUI QUE LE MODULE UTILISERA.
 *
 * Résoudre le binaire autrement ici — `require('ffmpeg-static')`, un chemin
 * en dur — ferait fabriquer les fixtures par un ffmpeg et les lire par un
 * autre. Le jour où les deux divergent, l'écart ressemblerait à un bug du
 * module.
 */
function fabriquer(nom: string, args: string[]): string {
  const chemin = join(RACINE, nom);
  execFileSync(ffmpegDuDepot(), ['-hide_banner', '-loglevel', 'error', '-y', ...args, chemin], {
    timeout: 60_000, stdio: 'pipe',
  });
  return chemin;
}

beforeAll(async () => {
  mkdirSync(RACINE, { recursive: true });

  if (ffmpegDispo) {
    // 12 s : au-delà du plafond de huit vignettes, donc c'est le plafond qui
    // décide et non la durée. Minuscule quand même — 320x240, 10 im/s.
    FICHIERS.valide = fabriquer('valide.mp4', [
      '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10:duration=12',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ac', '2', '-ar', '44100', '-shortest',
      '-movflags', '+faststart',
    ]);
    // ~2 Mo, images clés toutes les secondes. Il existe pour UNE raison :
    // en dessous d'environ un méga-octet, ffmpeg garde le fichier entier
    // dans ses tampons et n'a plus besoin de demander quoi que ce soit —
    // toutes les requêtes partent alors de l'octet zéro, et l'on ne peut
    // rien conclure. Au-delà, les positionnements deviennent visibles sous
    // forme de `Range` à décalage non nul, c'est-à-dire le comportement
    // qu'aura un vrai rush de plusieurs centaines de méga-octets.
    FICHIERS.gros = fabriquer('gros.mp4', [
      '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10:duration=60',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '10', '-b:v', '500k',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    ]);
    // 3 s, sans piste audio : la durée décide, et il n'y a pas d'audio à
    // trouver. Deux vérifications d'un coup.
    FICHIERS.sansAudio = fabriquer('sans-audio.mp4', [
      '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10:duration=3',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
    ]);
  }

  // Ni vidéo ni conteneur : du bruit. Aucun binaire nécessaire pour le faire.
  const invalide = join(RACINE, 'invalide.bin');
  writeFileSync(invalide, randomBytes(4096));
  FICHIERS.invalide = invalide;

  serveur = createServer((req, res) => {
    // `/bucket/<userId>/<nom de fixture>` — seul le dernier segment nomme le
    // fichier servi. Le reste imite la forme réelle d'une clé pour que le
    // module travaille sur des chemins de la même allure qu'en production.
    const chemin = decodeURI((req.url || '').split('?')[0]);
    const segments = chemin.split('/').filter(Boolean);
    const nom = segments[segments.length - 1] ?? '';
    const fichier = FICHIERS[nom];
    if (!fichier || !existsSync(fichier)) {
      res.writeHead(404).end();
      return;
    }
    const taille = statSync(fichier).size;
    const range = req.headers.range;
    if (range) rangesRecus.push(String(range));

    const m = range ? /bytes=(\d*)-(\d*)/.exec(String(range)) : null;
    if (m) {
      const debut = m[1] ? Number(m[1]) : Math.max(0, taille - Number(m[2]));
      const fin = m[1] && m[2] ? Math.min(Number(m[2]), taille - 1) : taille - 1;
      if (debut >= taille) {
        res.writeHead(416, { 'Content-Range': `bytes */${taille}` }).end();
        return;
      }
      res.writeHead(206, {
        'Content-Type': 'application/octet-stream',
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${debut}-${fin}/${taille}`,
        'Content-Length': String(fin - debut + 1),
      });
      createReadStream(fichier, { start: debut, end: fin }).pipe(res);
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Content-Length': String(taille),
    });
    createReadStream(fichier).pipe(res);
  });

  await new Promise<void>((resolve) => {
    serveur!.listen(0, '127.0.0.1', () => {
      const adr = serveur!.address();
      portServeur = typeof adr === 'object' && adr ? adr.port : 0;
      resolve();
    });
  });
}, 120_000);

afterAll(async () => {
  if (serveur) await new Promise<void>((r) => serveur!.close(() => r()));
  try { rmSync(RACINE, { recursive: true, force: true }); } catch { /* rien à nettoyer */ }
});

beforeEach(() => {
  objets = {};
  panneStat = null;
  sansSigneur = false;
  signeurLeve = false;
  ecritures = [];
  rangesRecus = [];
});

/** Déclare un objet dans le stockage factice et le rend joignable par HTTP. */
function poser(nomFixture: string, cle: string, bucket = 'media') {
  objets[`${bucket}/${cle}`] = { taille: statSync(FICHIERS[nomFixture]).size };
  // La correspondance clé → fichier passe par le NOM de la fixture, placé en
  // fin de clé, pour que le serveur le retrouve.
  return { bucket, cleObjet: cle };
}

const USER = 'u-abc123';
const ANALYSE = 'a-def456';

async function extraire(over: Partial<{ bucket: string; cleObjet: string; userId: string; analysisId: string }> = {}) {
  const { extraireRush } = await import('@/lib/autopilot/analyse/extraction');
  return extraireRush({
    bucket: 'media', cleObjet: `${USER}/valide`, userId: USER, analysisId: ANALYSE, ...over,
  });
}

// ─────────────────────────────────────────────────────────────────────────

describe('M3-B2 — périmètre et refus, sans toucher au stockage', () => {
  it('refuse un compartiment hors liste blanche', async () => {
    const r = await extraire({ bucket: 'secrets' });
    expect(r.ok).toBe(false);
    expect(r.motif).toBe('cle_hors_perimetre');
    expect(r.vignettes).toEqual([]);
  });

  it('refuse une clé qui ne commence pas par le préfixe du propriétaire', async () => {
    const r = await extraire({ cleObjet: 'quelquun-dautre/valide' });
    expect(r.motif).toBe('cle_hors_perimetre');
  });

  it('refuse `..` dans la clé, même sous le bon préfixe', async () => {
    const r = await extraire({ cleObjet: `${USER}/../autre/valide` });
    expect(r.motif).toBe('cle_hors_perimetre');
  });

  it('refuse une URL présentée comme une clé', async () => {
    const r = await extraire({ cleObjet: `${USER}/https://ailleurs/x.mp4` });
    expect(r.motif).toBe('cle_hors_perimetre');
  });

  it('refuse un identifiant qui pourrait sortir du préfixe des vignettes', async () => {
    expect((await extraire({ analysisId: '../../autre' })).motif).toBe('cle_hors_perimetre');
    expect((await extraire({ userId: 'a/b' })).motif).toBe('cle_hors_perimetre');
  });

  it('objet absent → `objet_introuvable`, pas `format_illisible`', async () => {
    const r = await extraire({ cleObjet: `${USER}/inexistant` });
    expect(r.motif).toBe('objet_introuvable');
  });

  it('panne de stockage → `stockage_injoignable`, distinct de l absence', async () => {
    panneStat = 'connect ECONNREFUSED 10.0.0.1:9000';
    const r = await extraire();
    expect(r.motif).toBe('stockage_injoignable');
  });

  it('stockage non configuré → `stockage_injoignable`, jamais une URL de repli', async () => {
    objets[`media/${USER}/valide`] = { taille: 1000 };
    sansSigneur = true;
    const r = await extraire();
    expect(r.motif).toBe('stockage_injoignable');
  });

  it('une panne inattendue devient un motif, jamais une exception', async () => {
    // Une exception remonterait au moteur, qui laisserait l'analyse
    // `en_cours` — et le verrou d'unicité de M3-B1 interdirait alors d'en
    // relancer une. L'échec doit rester une valeur de retour.
    objets[`media/${USER}/valide`] = { taille: 1000 };
    signeurLeve = true;
    const r = await extraire();
    expect(r.ok).toBe(false);
    expect(r.motif).toBe('extraction_impossible');
    expect(r.detail).toContain('minio');
    expect(r.vignettes).toEqual([]);
  });

  it('tous les motifs rendus appartiennent au vocabulaire fermé', async () => {
    const { MOTIFS_EXTRACTION } = await import('@/lib/autopilot/analyse/extraction');
    for (const cas of [
      { bucket: 'secrets' }, { cleObjet: 'autrui/x' }, { cleObjet: `${USER}/absent` },
    ]) {
      const r = await extraire(cas);
      expect(MOTIFS_EXTRACTION as readonly string[]).toContain(r.motif!);
    }
  });
});

describe('M3-B2 — placement des vignettes', () => {
  it('plafonne à huit, quelle que soit la durée', async () => {
    const { positionsVignettes, VIGNETTES_MAX } = await import('@/lib/autopilot/analyse/extraction');
    expect(VIGNETTES_MAX).toBe(8);
    for (const duree of [9, 12, 60, 600, 36_000]) {
      expect(positionsVignettes(duree).length, `durée ${duree}`).toBe(8);
    }
  });

  it('en produit moins sur une vidéo courte', async () => {
    const { positionsVignettes } = await import('@/lib/autopilot/analyse/extraction');
    expect(positionsVignettes(3).length).toBe(3);
    expect(positionsVignettes(1).length).toBe(1);
    expect(positionsVignettes(0.4).length).toBe(1);
  });

  it('aucune position sur une durée absente ou absurde', async () => {
    const { positionsVignettes } = await import('@/lib/autopilot/analyse/extraction');
    for (const d of [0, -5, NaN, Infinity]) expect(positionsVignettes(d)).toEqual([]);
  });

  it('évite la première et la dernière image, et reste ordonné', async () => {
    const { positionsVignettes } = await import('@/lib/autopilot/analyse/extraction');
    const p = positionsVignettes(12);
    expect(p[0]).toBeGreaterThan(0);
    expect(p[p.length - 1]).toBeLessThan(12);
    expect([...p].sort((a, b) => a - b)).toEqual(p);
  });
});

describe('M3-B2 — mesure réelle, vrais binaires, vrai HTTP à `Range`', () => {
  const siFfmpeg = () => (ffmpegDispo ? it : it.skip);

  siFfmpeg()('mesure une vidéo valide : durée, dimensions, codecs, audio', async () => {
    const { cleObjet, bucket } = poser('valide', `${USER}/valide`);
    const r = await extraire({ bucket, cleObjet });

    expect(r.motif).toBe(null);
    expect(r.ok).toBe(true);
    // 12 s demandées ; on tolère la marge d'un encodage réel.
    expect(r.dureeSecondes).toBeGreaterThan(11.5);
    expect(r.dureeSecondes).toBeLessThan(12.6);
    expect(r.technique.largeur).toBe(320);
    expect(r.technique.hauteur).toBe(240);
    expect(r.technique.codecVideo).toBe('h264');
    expect(r.technique.aAudio).toBe(true);
    expect(r.technique.fps).toBeCloseTo(10, 1);
    expect(r.technique.frequenceAudio).toBe(44100);
    expect(r.technique.canauxAudio).toBe(2);
    expect(String(r.technique.conteneur)).toContain('mp4');
    expect(r.technique.tailleOctets).toBe(statSync(FICHIERS.valide).size);
    expect(['ffprobe', 'ffmpeg']).toContain(r.technique.sonde);
  }, 120_000);

  siFfmpeg()('produit huit vignettes, écrites sous le préfixe déterministe', async () => {
    const { cleObjet, bucket } = poser('valide', `${USER}/valide`);
    const r = await extraire({ bucket, cleObjet });

    expect(r.vignettes.length).toBe(8);
    // Le compartiment vient de la constante, jamais d'un littéral recopié :
    // il a changé à l'intégration (`images` → `media`, pour que le nettoyage
    // périodique le balaie), et un littéral en second exemplaire aurait fait
    // échouer ce test pour la mauvaise raison. Ce que le compartiment doit
    // valoir est vérifié une fois, dans `autopilote-m3b2-branchement`.
    const { BUCKET_VIGNETTES } = await import('@/lib/autopilot/analyse/extraction');
    for (const v of r.vignettes) {
      expect(v.bucket).toBe(BUCKET_VIGNETTES);
      expect(v.cle.startsWith(`${USER}/analyse/${ANALYSE}/`)).toBe(true);
      expect(v.cle).not.toContain('://');
      expect(v.cle).not.toContain('..');
      expect(v.seconde).toBeGreaterThan(0);
      // Une vignette est une CLÉ. Rien de plus.
      expect(Object.keys(v).sort()).toEqual(['bucket', 'cle', 'seconde']);
    }
    // Les clés sont distinctes, et le stockage a bien été écrit autant de fois.
    expect(new Set(r.vignettes.map((v) => v.cle)).size).toBe(8);
    expect(ecritures.length).toBe(8);
    for (const e of ecritures) {
      expect(e.entetes?.['Content-Type']).toBe('image/jpeg');
      expect(e.taille).toBeGreaterThan(0);
    }
  }, 120_000);

  /**
   * LA vérification du lot : le rush est lu par positionnement, pas avalé.
   *
   * Ce qui se prouve exactement : pour atteindre une seconde tardive, ffmpeg
   * demande au serveur une tranche qui COMMENCE loin dans le fichier. Il n'a
   * donc pas relu depuis le début, et le coût d'une vignette ne dépend pas
   * de la taille du rush.
   *
   * Ce qui ne se prouve PAS ici, et qu'il serait malhonnête de prétendre :
   * qu'aucun octet superflu ne transite. ffmpeg décode depuis l'image clé
   * qui précède la position demandée, et sur un fichier minuscule ses
   * tampons couvrent parfois tout le fichier. C'est une propriété de ffmpeg,
   * pas de ce module — ce que ce module garantit, c'est de ne JAMAIS
   * demander l'objet entier lui-même, ce que vérifie le groupe suivant en
   * lisant le code source.
   */
  siFfmpeg()('lit par `Range`, en se positionnant loin dans le fichier', async () => {
    const { cleObjet, bucket } = poser('gros', `${USER}/gros`);
    const r = await extraire({ bucket, cleObjet });
    expect(r.ok).toBe(true);

    expect(rangesRecus.length).toBeGreaterThan(0);
    expect(rangesRecus.every((x) => x.startsWith('bytes='))).toBe(true);

    const decalages = rangesRecus
      .map((x) => Number(/bytes=(\d+)-/.exec(x)?.[1] ?? 0))
      .filter((n) => n > 0);
    expect(decalages.length, 'aucun positionnement : tout a été lu depuis zéro').toBeGreaterThan(0);

    // Le positionnement le plus lointain doit tomber dans la seconde moitié
    // du fichier : c'est ce qui distingue un vrai saut d'un simple
    // redémarrage de lecture.
    const taille = statSync(FICHIERS.gros).size;
    expect(Math.max(...decalages)).toBeGreaterThan(taille / 2);
  }, 180_000);

  siFfmpeg()('une vidéo sans audio est mesurée, et déclarée sans audio', async () => {
    const { cleObjet, bucket } = poser('sansAudio', `${USER}/sansAudio`);
    const r = await extraire({ bucket, cleObjet });

    expect(r.ok).toBe(true);
    expect(r.technique.aAudio).toBe(false);
    expect(r.technique.codecAudio).toBeUndefined();
    expect(r.technique.canauxAudio).toBeUndefined();
    expect(r.dureeSecondes).toBeGreaterThan(2.5);
    expect(r.dureeSecondes).toBeLessThan(3.6);
    // Trois secondes : trois vignettes, pas huit.
    expect(r.vignettes.length).toBe(3);
  }, 120_000);

  siFfmpeg()('un fichier qui n est pas une vidéo → `format_illisible`', async () => {
    const { cleObjet, bucket } = poser('invalide', `${USER}/invalide`);
    const r = await extraire({ bucket, cleObjet });

    expect(r.ok).toBe(false);
    expect(r.motif).toBe('format_illisible');
    expect(r.dureeSecondes).toBe(null);
    expect(r.technique).toEqual({});
    expect(r.vignettes).toEqual([]);
    expect(ecritures.length).toBe(0);
  }, 60_000);

  siFfmpeg()('rien de ce qui sort ne contient l URL signée', async () => {
    for (const nom of ['valide', 'invalide']) {
      const { cleObjet, bucket } = poser(nom, `${USER}/${nom}`);
      const r = await extraire({ bucket, cleObjet });
      const rendu = JSON.stringify(r);
      expect(rendu, nom).not.toContain('127.0.0.1');
      expect(rendu, nom).not.toContain('sig=');
      expect(rendu, nom).not.toMatch(/https?:\/\//);
    }
  }, 120_000);

  /**
   * Le repli, joué pour de vrai.
   *
   * `FFPROBE_PATH` désigne un chemin qui n'existe pas : le lancement rend
   * `ENOENT`, et c'est le seul cas où le module a le droit de retomber sur
   * `ffmpeg -i`. Sans ce test, la branche de repli ne serait jamais
   * exécutée sur une machine qui possède ffprobe — c'est-à-dire jamais.
   */
  siFfmpeg()('sans ffprobe, la mesure passe par ffmpeg et reste juste', async () => {
    const avant = process.env.FFPROBE_PATH;
    process.env.FFPROBE_PATH = join(RACINE, 'ffprobe-qui-n-existe-pas');
    try {
      const { cleObjet, bucket } = poser('valide', `${USER}/valide`);
      const r = await extraire({ bucket, cleObjet });

      expect(r.ok).toBe(true);
      expect(r.technique.sonde).toBe('ffmpeg');
      expect(r.technique.largeur).toBe(320);
      expect(r.technique.hauteur).toBe(240);
      expect(r.technique.codecVideo).toBe('h264');
      expect(r.technique.aAudio).toBe(true);
      expect(r.technique.canauxAudio).toBe(2);
      expect(r.technique.frequenceAudio).toBe(44100);
      expect(r.dureeSecondes).toBeGreaterThan(11.5);
      expect(r.dureeSecondes).toBeLessThan(12.6);
      expect(r.vignettes.length).toBe(8);
    } finally {
      if (avant === undefined) delete process.env.FFPROBE_PATH;
      else process.env.FFPROBE_PATH = avant;
    }
  }, 120_000);

  siFfmpeg()('sans ffprobe non plus, un fichier illisible reste illisible', async () => {
    const avant = process.env.FFPROBE_PATH;
    process.env.FFPROBE_PATH = join(RACINE, 'ffprobe-qui-n-existe-pas');
    try {
      const { cleObjet, bucket } = poser('invalide', `${USER}/invalide`);
      const r = await extraire({ bucket, cleObjet });
      expect(r.motif).toBe('format_illisible');
      expect(r.vignettes).toEqual([]);
    } finally {
      if (avant === undefined) delete process.env.FFPROBE_PATH;
      else process.env.FFPROBE_PATH = avant;
    }
  }, 120_000);

  siFfmpeg()('le message d échec est masqué, jamais brut', async () => {
    const { masquerUrls } = await import('@/lib/autopilot/analyse/extraction');
    expect(masquerUrls('open http://a.b/c?sig=x failed')).toBe('open <url-masquee> failed');
    expect(masquerUrls('s3://bucket/objet')).toBe('<url-masquee>');
    expect(masquerUrls('rien à masquer')).toBe('rien à masquer');
  });
});

describe('M3-B2 — ce que le code source n a PAS le droit de contenir', () => {
  const source = (chemin: string) => readFileSync(join(process.cwd(), chemin), 'utf8');
  /** Les commentaires NOMMENT les interdits ; seul le code compte. */
  const sansCommentaires = (code: string) => code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  const MODULE = 'src/lib/autopilot/analyse/extraction.ts';

  it('ne charge jamais le rush en mémoire ni sur le disque', () => {
    const code = sansCommentaires(source(MODULE));
    for (const interdit of [
      /\.arrayBuffer\s*\(/, /\.blob\s*\(/,
      /downloadMediaToBuffer/, /downloadMediaToFile/,
      /writeFile|createWriteStream|copyFile/,
      /tmpdir|os\.tmpdir|['"]\/tmp/,
      /\bfetch\s*\(/,
    ]) {
      expect(code, `${MODULE} : ${interdit}`).not.toMatch(interdit);
    }
  });

  it('ne lance jamais de shell et n interpole jamais dans une commande', () => {
    const code = sansCommentaires(source(MODULE));
    // Ni `exec` ni `execSync` : seuls `execFile` (tableau d'arguments) est
    // admis. `spawn` avec `shell: true` le serait tout autant, d'où la garde
    // sur l'option elle-même.
    expect(code).not.toMatch(/\bexecSync\s*\(/);
    // `child_process` ne cède QUE `execFile`. Ni `exec`, ni `spawn`, ni
    // `execSync` n'entrent — et l'import est le seul endroit où le vérifier
    // sans confondre `exec(` avec le `RegExp.prototype.exec` du parseur.
    expect(code).toMatch(/import\s*\{\s*execFile\s*\}\s*from\s*'child_process'/);
    expect(code).not.toMatch(/shell\s*:\s*true/);
    // Un seul point de lancement, et il reçoit bien un tableau.
    expect(code).toMatch(/execFile\(\s*binaire,\s*args,/);
  });

  it('protège chaque processus : timeout, kill dur, plafond de sortie', () => {
    const code = sansCommentaires(source(MODULE));
    expect(code).toMatch(/timeout:\s*opts\.timeoutMs/);
    expect(code).toMatch(/killSignal:\s*'SIGKILL'/);
    expect(code).toMatch(/maxBuffer:\s*opts\.maxSortie/);
    // Aucune reprise automatique : pas de boucle de tentatives.
    expect(code).not.toMatch(/for\s*\(\s*(let|const)\s+\w*(essai|tentative|retry)/i);
  });

  it('place `-ss` AVANT `-i` — c est ce qui déclenche la lecture par `Range`', () => {
    const code = sansCommentaires(source(MODULE));
    const ss = code.indexOf("'-ss'");
    const i = code.indexOf("'-i', url,\n      '-frames:v'");
    expect(ss).toBeGreaterThan(0);
    expect(i).toBeGreaterThan(ss);
  });

  it('n importe que ce qui est annoncé', () => {
    const code = sansCommentaires(source(MODULE));
    const importes = [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect([...new Set(importes)].sort()).toEqual([
      '@/lib/ffmpeg/binaires',
      '@/lib/storage/buckets',
      '@/lib/storage/minio-client',
      './contrat',
      'child_process',
    ].sort());
  });

  it('le compartiment des vignettes appartient à la liste blanche partagée', async () => {
    const { BUCKET_VIGNETTES } = await import('@/lib/autopilot/analyse/extraction');
    const { ALLOWED_BUCKETS } = await import('@/lib/storage/buckets');
    expect(ALLOWED_BUCKETS as readonly string[]).toContain(BUCKET_VIGNETTES);
  });

  it('la validation des vignettes est celle de M3-B1, pas une seconde', async () => {
    const code = sansCommentaires(source(MODULE));
    expect(code).toMatch(/vignettesValides\(/);
    // Aucune liste blanche recopiée ici.
    expect(code).not.toMatch(/ALLOWED_BUCKETS\s*=/);
  });

  it('l URL signée est brève et jamais retournée', () => {
    const code = sansCommentaires(source(MODULE));
    expect(code).toMatch(/TTL_URL_SECONDES\s*=\s*600/);
    // `url` n'apparaît dans aucun objet rendu.
    expect(code).not.toMatch(/return\s*\{[^}]*\burl\b\s*[,:}]/);
  });
});
