// @vitest-environment node
/**
 * M3-B2.4 — La CAUSE d'un échec de processus doit être nommée.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE DÉFAUT QUE CE FICHIER FERME
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `lancer()`, dans `analyse/extraction.ts`, réduit tout ce que Node rapporte
 * d'un processus mort à trois booléens et à un entier :
 *
 *     code:        err ? (typeof e?.code === 'number' ? e.code : null) : 0,
 *     timeout:     Boolean(e?.killed) || e?.signal === 'SIGKILL',
 *     introuvable: e?.code === 'ENOENT',
 *
 * Or `err.code` n'est un NOMBRE que dans un seul cas : le processus a
 * réellement démarré et s'est terminé avec un code de sortie. Partout
 * ailleurs, Node y met une CHAÎNE — `EACCES` quand le binaire n'est pas
 * exécutable, `EAGAIN` quand la machine ne peut plus forker,
 * `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` quand la sortie déborde — et ces
 * chaînes tombent toutes dans le `: null`. De même, `err.signal` n'est
 * retenu que s'il vaut exactement `SIGKILL` : un `SIGSEGV` ou un `SIGABRT`
 * ne laisse aucune trace.
 *
 * Le résultat visible en production, dans `produireVignettes` :
 *
 *     : r.code !== 0 ? `code=${r.code ?? 'aucun'}`
 *
 * a produit la ligne de journal
 *
 *     [analyse] aucune vignette produite { cause: 'code=aucun ' }
 *
 * Huit vignettes perdues, un message qui ne nomme RIEN. Le lot précédent
 * (M3-B2.2) avait rendu la panne visible ; il restait à la rendre
 * DIAGNOSTICABLE. C'est l'objet de celui-ci.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE CONTRAT DE NOMMAGE QUE CE FICHIER FIXE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le lot ajoutera deux champs internes à `SortieProcessus` :
 *
 *     codeSysteme: string | null   // `err.code` quand c'est une chaîne
 *     signal:      string | null   // `err.signal`, quel qu'il soit
 *
 * et les fera apparaître dans la cause du PREMIER échec, uniquement dans la
 * ligne `console.warn('[analyse] aucune vignette produite', …)`, sous deux
 * étiquettes littérales que les assertions ci-dessous gravent :
 *
 *     errno=<codeSysteme>     ex. `errno=EACCES`
 *     signal=<signal>         ex. `signal=SIGSEGV`
 *
 * Ce sont des ÉTIQUETTES, pas des phrases : elles doivent rester greppables
 * dans les journaux du serveur, où c'est un humain pressé qui les lit.
 *
 * ⚠️ Ces deux champs ne vont NI dans `technique`, NI dans `detail`, NI dans
 * quoi que ce soit qui remonte au navigateur. `technique` est écrit en base
 * et rendu par `analysePublique` ; le contrat de sortie de M3-B1 lui interdit
 * déjà tout ce qui ressemble à un chemin serveur. Un errno n'est pas un
 * secret, mais la place d'un diagnostic de processus est le journal du
 * serveur, et nulle part ailleurs. Un test le vérifie plus bas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * COMMENT CHAQUE PANNE EST PROVOQUÉE — SANS PORTE DÉROBÉE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `lancer()` n'est pas exporté et ne le sera pas : le tester directement
 * reviendrait à tester une fonction privée plutôt que le comportement qui
 * compte. Tout passe donc par `extraireRush`, et le levier est
 * `cheminFfmpeg()`, qui relit `FFMPEG_PATH` À CHAQUE APPEL. On y pointe un
 * FAUX BINAIRE — un script `sh` de deux lignes, fabriqué dans un dossier
 * temporaire — qui produit à volonté :
 *
 *   • `exit 1`                 → code de sortie NUMÉRIQUE
 *   • `kill -SEGV $$`          → mort par SIGNAL, `err.code = null`
 *   • un fichier `chmod 000`   → `err.code = 'EACCES'` (chaîne)
 *   • un chemin inexistant     → `err.code = 'ENOENT'` (chaîne)
 *   • `dd` de 12 Mo sur stdout → `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`
 *   • `kill -KILL $$`          → `err.signal = 'SIGKILL'`
 *   • `sleep 60`               → le VRAI délai, `err.killed = true`
 *
 * Du `sh` pur, jamais du Node : un script à shebang `#!<process.execPath>`
 * casserait sur une machine dont le chemin de node contient une espace, et
 * un test d'infrastructure qui rougit pour cette raison-là ne dit plus rien
 * de `extraction.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE DÉCOR : LA SONDE RÉUSSIT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `FFPROBE_PATH` reste le binaire de la machine, et le rush est une VRAIE
 * vidéo servie par un VRAI serveur HTTP local. C'est exactement la situation
 * de production : mesure verte — durée, dimensions, codec — et vignettes en
 * échec. Sonder avec une doublure ferait de ce fichier un test de sa propre
 * programmation.
 *
 * La fixture est minuscule (≈100 Ko, dix secondes) : contrairement à
 * `autopilote-m3b22-vignettes-range.test.ts`, rien ici ne dépend du
 * comportement `Range` de ffmpeg — ce qui se prouve est la CAUSE d'un échec,
 * pas le coût d'une lecture. Dix secondes suffisent à obtenir les huit
 * positions dont le point 10 a besoin. Tout est supprimé par `afterAll`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI EST ROUGE AUJOURD'HUI, ET C'EST VOULU
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   ROUGE  errno=EACCES · errno=<toute chaîne> · maxBuffer · signal=SIGSEGV
 *   VERT   ENOENT · SIGKILL/délai · code=1 · succès · non-fuite · 8/8 comptés
 *
 * Les quatre premiers décrivent le lot à venir. Les six autres sont le filet
 * de non-régression : ils doivent être verts AVANT comme APRÈS.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { createServer, type Server } from 'http';
import { createReadStream, chmodSync, mkdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { cheminFfmpeg, cheminFfprobe } from '@/lib/ffmpeg/binaires';

// ─────────────────────────────────────────────────────────────────────────
// La doublure de stockage
// ─────────────────────────────────────────────────────────────────────────

/** Ce que `statObject` doit répondre, par `bucket/cle`. */
let objets: Record<string, { taille: number }> = {};

interface EcritureVignette {
  bucket: string;
  cle: string;
  taille: number;
  corps: Buffer;
}

/** Tout ce qui a été écrit dans le stockage pendant un test. */
let ecritures: EcritureVignette[] = [];

let portServeur = 0;

vi.mock('@/lib/storage/minio-client', () => ({
  clientMinio: () => ({
    statObject: async (bucket: string, cle: string) => {
      const o = objets[`${bucket}/${cle}`];
      if (!o) throw new Error('The specified key does not exist.');
      return { size: o.taille };
    },
    putObject: async (
      bucket: string, cle: string, corps: unknown, taille?: number,
    ) => {
      const buf = corps as Buffer;
      ecritures.push({
        bucket, cle, taille: Number(taille ?? 0),
        corps: Buffer.isBuffer(buf) ? Buffer.from(buf) : Buffer.alloc(0),
      });
      return {};
    },
  }),
  signeurInterne: () => ({
    /**
     * La MÊME FORME qu'une présignée MinIO, `X-Amz-Signature` comprise.
     *
     * C'est ce qui rend vérifiable le point « rien ne fuit » : le faux ffmpeg
     * qui recopie son `argv` dans stderr écrit alors une vraie signature dans
     * le seul canal — le journal — par lequel elle pourrait sortir.
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
// Les binaires réels : décidés AU CHARGEMENT
// ─────────────────────────────────────────────────────────────────────────

/**
 * Vitest COLLECTE les tests — donc évalue `it` ou `it.skip` — avant
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

// ─────────────────────────────────────────────────────────────────────────
// Les fixtures et les faux binaires
// ─────────────────────────────────────────────────────────────────────────

const RACINE = join(tmpdir(), `studiio-m3b24-${process.pid}`);
const FICHIERS: Record<string, string> = {};

/** Les faux ffmpeg, par nom de panne. */
const FAUX: Record<string, string> = {};

let serveur: Server | null = null;

/** Dix secondes : c'est ce qui donne les HUIT positions du point 10. */
const DUREE_RUSH = 10;

/** Une seconde : UNE seule position, donc un seul délai de 20 s à subir. */
const DUREE_COURT = 1;

/**
 * `testsrc` compressé en x264 : ≈100 Ko pour dix secondes.
 *
 * Volontairement minuscule — rien ici ne dépend d'un positionnement `Range`,
 * et le disque des machines de développement est étroit.
 */
function fabriquerRush(nom: string, duree: number): string {
  const chemin = join(RACINE, `${nom}.mp4`);
  execFileSync(cheminFfmpeg(), [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc=s=160x120:r=8:d=${duree}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '8', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    chemin,
  ], { timeout: 120_000, stdio: 'pipe' });
  return chemin;
}

/** Un faux binaire `sh`, exécutable, dans le dossier temporaire. */
function fauxBinaire(nom: string, corps: string, mode = 0o755): string {
  const chemin = join(RACINE, `faux-${nom}`);
  writeFileSync(chemin, corps, { mode });
  chmodSync(chemin, mode);
  return chemin;
}

beforeAll(async () => {
  mkdirSync(RACINE, { recursive: true });
  if (binairesDispo) {
    FICHIERS.rush = fabriquerRush('rush', DUREE_RUSH);
    FICHIERS.court = fabriquerRush('court', DUREE_COURT);
  }

  // ── Les sept pannes, en `sh` pur ────────────────────────────────────────

  // Un code de sortie NUMÉRIQUE, avec un stderr qui ressemble à du ffmpeg.
  FAUX.code1 = fauxBinaire('code1',
    '#!/bin/sh\necho "Invalid data found when processing input" >&2\nexit 1\n');

  // Le même, mais qui recopie ses ARGUMENTS — donc l'URL signée — dans
  // stderr. C'est le seul montage qui mette réellement le masquage à
  // l'épreuve : sur `ENOENT` ou `EACCES`, stderr est vide et prouver la
  // non-fuite ne prouverait rien.
  FAUX.bavardArgv = fauxBinaire('bavard-argv',
    '#!/bin/sh\nprintf "%s " "$@" >&2\nexit 1\n');

  // Mort par signal, `err.code = null`, `err.signal = "SIGSEGV"`.
  // `$$` est le PID du shell lui-même, c'est-à-dire l'enfant direct de Node.
  FAUX.segv = fauxBinaire('segv', '#!/bin/sh\nkill -SEGV $$\nsleep 5\n');

  // `err.signal = "SIGKILL"` SANS `err.killed` : c'est la seconde moitié du
  // `||` de `lancer()`, et elle doit rester `processus-interrompu`.
  FAUX.sigkill = fauxBinaire('sigkill', '#!/bin/sh\nkill -KILL $$\nsleep 5\n');

  // Existe, mais n'est pas exécutable → `err.code = "EACCES"`.
  // ⚠️ `chmod 000` n'arrête pas root : la garde `siEacces` plus bas le dit.
  FAUX.eacces = fauxBinaire('eacces', '#!/bin/sh\nexit 0\n', 0o644);
  chmodSync(FAUX.eacces, 0o000);

  // Douze méga-octets sur stdout, contre `SORTIE_MAX_VIGNETTE` = 8 Mo.
  // `exec` pour que l'enfant direct SOIT `dd` : sinon le shell survivrait au
  // `kill` de Node et le `dd` orphelin continuerait d'écrire.
  FAUX.bavardStdout = fauxBinaire('bavard-stdout',
    '#!/bin/sh\nexec dd if=/dev/zero bs=1048576 count=12 2>/dev/null\n');

  // Le VRAI délai : `exec` pour la même raison — un `sleep` orphelin
  // survivrait soixante secondes à la suite de tests.
  FAUX.dort = fauxBinaire('dort', '#!/bin/sh\nexec sleep 60\n');

  // Et le binaire qui n'existe pas.
  FAUX.absent = join(RACINE, 'faux-ffmpeg-qui-n-existe-pas');

  // ── Le serveur qui sert le rush ─────────────────────────────────────────

  serveur = createServer((req, res) => {
    const chemin = decodeURI((req.url || '').split('?')[0]);
    const nom = chemin.split('/').filter(Boolean).pop() ?? '';
    const fichier = FICHIERS[nom.replace(/\.mp4$/, '')];
    if (!fichier) { res.writeHead(404).end(); return; }

    const taille = statSync(fichier).size;
    const range = req.headers.range ? String(req.headers.range) : null;
    const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;

    // `Range` est honoré non pas pour le prouver — ce n'est pas l'objet de ce
    // fichier — mais parce qu'un serveur qui l'ignore ferait échouer ffprobe
    // sur un fichier qu'il sait pourtant lire, et le décor ne serait plus
    // celui de la production.
    if (m) {
      const debut = m[1] ? Number(m[1]) : Math.max(0, taille - Number(m[2]));
      const fin = m[1] && m[2] ? Math.min(Number(m[2]), taille - 1) : taille - 1;
      if (debut >= taille) {
        res.writeHead(416, { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes */${taille}` }).end();
        return;
      }
      res.writeHead(206, {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${debut}-${fin}/${taille}`,
        'Content-Length': String(fin - debut + 1),
      });
      const flux = createReadStream(fichier, { start: debut, end: fin });
      res.on('close', () => flux.destroy());
      flux.pipe(res);
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Content-Length': String(taille),
    });
    const flux = createReadStream(fichier);
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
  // Rien ne survit au fichier de test : ni fixture, ni faux binaire.
  try { rmSync(RACINE, { recursive: true, force: true }); } catch { /* rien à nettoyer */ }
});

beforeEach(() => {
  objets = {};
  ecritures = [];
});

/**
 * `chmod 000` n'interdit rien à root : sous un conteneur de CI qui tourne en
 * `uid 0`, le faux binaire s'exécuterait et le test constaterait `code=0`
 * plutôt qu'`EACCES`. Mieux vaut le dire que rougir pour la mauvaise raison.
 */
const siEacces = () => (binairesDispo && typeof process.getuid === 'function' && process.getuid() !== 0
  ? it
  : it.skip);

// ─────────────────────────────────────────────────────────────────────────
// Les appels
// ─────────────────────────────────────────────────────────────────────────

const USER = 'u-m3b24';
const ANALYSE = 'a-m3b24';
const CLE_RUSH = `${USER}/rush/rush`;
const CLE_COURT = `${USER}/rush/court`;

async function extraire(cle: string) {
  const { extraireRush } = await import('@/lib/autopilot/analyse/extraction');
  return extraireRush({ bucket: 'media', cleObjet: cle, userId: USER, analysisId: ANALYSE });
}

interface Diagnostic {
  resultat: Awaited<ReturnType<typeof extraire>>;
  /** Le nombre d'appels à `console.warn` pendant l'extraction. */
  appels: number;
  /** `details.cause` de la ligne de journal, ou `''` si rien n'a été journalisé. */
  cause: string;
  /** Les détails de la ligne, tels quels. */
  details: Record<string, unknown>;
  /** L'appel ENTIER, sérialisé — c'est là-dessus que se prouve la non-fuite. */
  rendu: string;
  ecritures: EcritureVignette[];
}

/**
 * Joue une extraction avec un faux ffmpeg, et rend ce que le journal a dit.
 *
 * `FFMPEG_PATH` est posé puis RESTAURÉ dans un `finally` : un test qui laisse
 * l'environnement modifié fait échouer le suivant pour une raison qui n'a
 * plus rien à voir avec lui.
 */
async function diagnostiquer(
  fauxFfmpeg: string | null,
  cle: string = CLE_RUSH,
): Promise<Diagnostic> {
  const avant = process.env.FFMPEG_PATH;
  if (fauxFfmpeg === null) delete process.env.FFMPEG_PATH;
  else process.env.FFMPEG_PATH = fauxFfmpeg;

  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const fichier = cle === CLE_COURT ? FICHIERS.court : FICHIERS.rush;
    objets[`media/${cle}`] = { taille: statSync(fichier).size };
    const resultat = await extraire(cle);

    const appel = warn.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('aucune vignette produite'),
    );
    const details = (appel?.[1] ?? {}) as Record<string, unknown>;
    return {
      resultat,
      appels: warn.mock.calls.length,
      cause: appel ? String(details.cause ?? '') : '',
      details,
      rendu: appel ? JSON.stringify(appel) : '',
      ecritures: [...ecritures],
    };
  } finally {
    warn.mockRestore();
    if (avant === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = avant;
  }
}

/** L'errno tel qu'il apparaît dans la cause, ou `null`. */
function errnoDe(cause: string): string | null {
  return /errno=([A-Za-z0-9_]+)/.exec(cause)?.[1] ?? null;
}

/** Le signal tel qu'il apparaît dans la cause, ou `null`. */
function signalDe(cause: string): string | null {
  return /signal=([A-Za-z0-9_]+)/.exec(cause)?.[1] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────
// L'instrument de mesure
// ─────────────────────────────────────────────────────────────────────────

describe('M3-B2.4 — le banc lui-même', () => {
  it('les binaires attendus sont là, ou le fichier le dit', () => {
    expect({ ffmpeg: ffmpegDispo, ffprobe: ffprobeDispo }).toEqual({
      ffmpeg: ffmpegDispo, ffprobe: ffprobeDispo,
    });
    if (!binairesDispo) {
      console.warn(
        `[m3b24] binaires absents (ffmpeg=${ffmpegDispo}, ffprobe=${ffprobeDispo}) :`
        + ' les preuves réelles sont ignorées.',
      );
    }
  });

  siBinaires()('le décor est bien celui de la production : sonde VERTE, huit positions', async () => {
    // Ce bloc-ci ne juge rien : il CONSTATE que le montage reproduit la
    // situation de production. Sans lui, chaque assertion des blocs suivants
    // pourrait rougir pour une raison étrangère à la cause qu'elle teste.
    const d = await diagnostiquer(FAUX.code1);
    expect(d.resultat.technique.sonde, 'la sonde doit avoir réussi').toBe('ffprobe');
    expect(d.resultat.dureeSecondes).toBeGreaterThan(DUREE_RUSH - 0.6);
    expect(d.resultat.dureeSecondes).toBeLessThan(DUREE_RUSH + 0.6);
    expect(d.resultat.technique.codecVideo).toBe('h264');
    expect(d.resultat.technique.vignettesAttendues).toBe(8);
    expect(d.resultat.vignettes).toEqual([]);
    expect(d.appels, 'exactement une ligne de journal').toBe(1);
  }, 120_000);

  siBinaires()('la fixture reste minuscule : le disque de développement est étroit', () => {
    const rush = statSync(FICHIERS.rush).size;
    const court = statSync(FICHIERS.court).size;
    expect(rush).toBeGreaterThan(1024);
    expect(rush, `rush de ${rush} octets`).toBeLessThan(2 * 1024 * 1024);
    expect(court).toBeLessThan(512 * 1024);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// CE QUI EST ROUGE AUJOURD'HUI — les quatre causes muettes
// ─────────────────────────────────────────────────────────────────────────

describe('M3-B2.4 — un errno en CHAÎNE doit être nommé', () => {
  /** PREUVE 1 — `err.code = 'EACCES'` → `errno=EACCES`. */
  siEacces()('un ffmpeg présent mais non exécutable dit `errno=EACCES`', async () => {
    const d = await diagnostiquer(FAUX.eacces);

    // Le décor d'abord : la mesure a réussi, seules les images ont échoué.
    expect(d.resultat.ok).toBe(true);
    expect(d.resultat.technique.sonde).toBe('ffprobe');
    expect(d.appels).toBe(1);

    // ── LE DÉFAUT, NOMMÉ ──────────────────────────────────────────────────
    //
    // Aujourd'hui `err.code` vaut la chaîne `'EACCES'`, `typeof e.code` n'est
    // pas `'number'`, donc `code` devient `null`, et la cause s'écrit
    // `code=aucun ` — le message exact relevé en production. Un binaire dont
    // les droits ont sauté au déploiement est pourtant la panne la plus
    // banale qui soit, et la plus vite corrigée QUAND ON LA VOIT.
    expect(
      d.cause,
      'la cause ne doit plus être le mot « aucun » : elle doit nommer l errno',
    ).not.toMatch(/code=aucun/);
    expect(
      d.cause,
      `contrat de nommage : la cause doit contenir « errno=EACCES » (reçu : ${JSON.stringify(d.cause)})`,
    ).toContain('errno=EACCES');
  }, 120_000);

  /**
   * PREUVE 2 — toute chaîne d'errno est conservée, `EAGAIN` compris.
   *
   * ⚠️ `EAGAIN` N'EST PAS PROVOCABLE HONNÊTEMENT. Il signifie « la machine ne
   * peut plus créer de processus » : le provoquer demanderait d'épuiser
   * `RLIMIT_NPROC` du processus de test lui-même, ce qui ferait tomber
   * vitest avant l'assertion, et laisserait la machine dans un état dont
   * aucun `finally` ne la sortirait de façon fiable. Un test qui PRÉTENDRAIT
   * le provoquer serait un mensonge.
   *
   * La preuve porte donc sur la PROPRIÉTÉ dont `EAGAIN` n'est qu'un cas :
   * deux chaînes d'errno sans aucun rapport l'une avec l'autre — `EACCES`,
   * un errno POSIX de `spawn`, et `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`, un
   * code interne à Node — ressortent TOUTES DEUX verbatim. Ce qui traite
   * verbatim deux chaînes disjointes ne peut pas être une liste blanche à
   * laquelle `EAGAIN` manquerait : c'est le passage de `err.code` tel quel.
   */
  siEacces()('deux errno disjoints ressortent verbatim : ce n est pas une liste blanche', async () => {
    const acces = await diagnostiquer(FAUX.eacces);
    const buffer = await diagnostiquer(FAUX.bavardStdout);

    expect(errnoDe(acces.cause), 'errno POSIX de spawn').toBe('EACCES');
    expect(errnoDe(buffer.cause), 'code interne de Node').toBe('ERR_CHILD_PROCESS_STDIO_MAXBUFFER');

    // Et les deux sont bien DISTINCTS : une implémentation qui écrirait une
    // constante satisferait chaque assertion prise isolément, pas les deux.
    expect(errnoDe(acces.cause)).not.toBe(errnoDe(buffer.cause));
  }, 180_000);

  /**
   * PREUVE 3 — le débordement de `maxBuffer` a une cause BORNÉE et
   * identifiable.
   *
   * MESURÉ, non supposé (Node 20.19.5, macOS) : quand la sortie dépasse
   * `maxBuffer`, Node rend
   *
   *     err.code    = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'   (une CHAÎNE)
   *     err.message = 'stdout maxBuffer length exceeded'
   *     err.killed  = undefined
   *     err.signal  = undefined
   *     stdout      = exactement `maxBuffer` octets
   *
   * Ce sont ces deux `undefined` qui rendent le cas si vicieux : `timeout`
   * reste FAUX — donc la cause n'est pas `processus-interrompu` —, `code`
   * devient `null`, et la ligne rendue est `code=aucun `. Un ffmpeg devenu
   * bavard, ou une entrée hostile, produisent aujourd'hui exactement le même
   * message qu'un segfault. Il n'y a pas d'autre différence entre eux dans
   * le journal.
   */
  siBinaires()('un débordement de maxBuffer nomme sa cause, et la borne', async () => {
    const d = await diagnostiquer(FAUX.bavardStdout);

    expect(d.appels).toBe(1);
    expect(d.cause, 'un débordement n est pas un mystère').not.toMatch(/code=aucun/);
    expect(
      d.cause,
      `contrat de nommage : « errno=ERR_CHILD_PROCESS_STDIO_MAXBUFFER » (reçu : ${JSON.stringify(d.cause)})`,
    ).toContain('errno=ERR_CHILD_PROCESS_STDIO_MAXBUFFER');

    // BORNÉE : la cause part au journal du serveur, et douze méga-octets de
    // sortie ne doivent pas s'y déverser sous prétexte de diagnostic.
    // `lancer()` tronque déjà stderr à 8000, `premierEchec` le retaille à
    // 400 ; l'étiquette elle-même ne doit rien ajouter d'illimité.
    expect(d.cause.length, `cause de ${d.cause.length} caractères`).toBeLessThanOrEqual(600);
  }, 120_000);

  /**
   * PREUVE 4 — mort par SIGNAL autre que `SIGKILL` → `signal=SIGSEGV`.
   *
   * MESURÉ : `err.code = null`, `err.killed = false`, `err.signal = 'SIGSEGV'`.
   * `lancer()` ne regarde `err.signal` que pour le comparer à `SIGKILL` : un
   * ffmpeg qui segfaute sur un fichier tordu — c'est arrivé, et cela
   * s'appelle un bug de codec — ressort aujourd'hui `code=aucun `,
   * indiscernable d'un débordement de tampon.
   */
  siBinaires()('un ffmpeg tué par SIGSEGV dit `signal=SIGSEGV`', async () => {
    const d = await diagnostiquer(FAUX.segv);

    expect(d.appels).toBe(1);
    // Ce n'est PAS un délai : le confondre avec `processus-interrompu` serait
    // une seconde erreur, pas une correction.
    expect(d.cause, 'un segfault n est pas une interruption par délai')
      .not.toMatch(/^processus-interrompu/);
    expect(d.cause).not.toMatch(/code=aucun/);
    expect(
      signalDe(d.cause),
      `contrat de nommage : « signal=SIGSEGV » (reçu : ${JSON.stringify(d.cause)})`,
    ).toBe('SIGSEGV');
  }, 120_000);
});

// ─────────────────────────────────────────────────────────────────────────
// CE QUI DOIT RESTER VERT — le filet de non-régression
// ─────────────────────────────────────────────────────────────────────────

describe('M3-B2.4 — les trois causes déjà nommées ne changent pas', () => {
  /** PREUVE 5 — `ENOENT` reste `ffmpeg-absent(ENOENT)`. */
  siBinaires()('un ffmpeg absent reste `ffmpeg-absent(ENOENT)`', async () => {
    const d = await diagnostiquer(FAUX.absent);

    expect(d.appels).toBe(1);
    // La forme EXACTE, en tête de cause. `ENOENT` est déjà une chaîne
    // d'errno : la correction, qui va apprendre à lire les chaînes, ne doit
    // pas transformer ce cas-là en `errno=ENOENT` — l'étiquette dédiée dit
    // davantage, et un tableau de bord qui compte par cause la connaît déjà.
    expect(d.cause).toMatch(/^ffmpeg-absent\(ENOENT\)/);
    expect(d.resultat.technique.vignettesAttendues).toBe(8);
    expect(d.resultat.technique.vignettesProduites).toBe(0);
    expect(d.resultat.technique.vignettesEchouees).toBe(8);
  }, 120_000);

  /**
   * PREUVE 6a — `err.signal === 'SIGKILL'` sans `err.killed` reste
   * `processus-interrompu`.
   *
   * C'est la SECONDE moitié du `||` de `lancer()`, et elle a sa raison
   * d'être : un ffmpeg tué par l'OOM killer du conteneur arrive exactement
   * sous cette forme. La correction ajoute `signal` au diagnostic ; elle ne
   * doit pas pour autant déclasser `SIGKILL` en simple signal parmi d'autres.
   */
  siBinaires()('un SIGKILL sans `killed` reste `processus-interrompu`', async () => {
    const d = await diagnostiquer(FAUX.sigkill);

    expect(d.appels).toBe(1);
    expect(d.cause).toMatch(/^processus-interrompu/);
  }, 120_000);

  /**
   * PREUVE 6b — le VRAI délai (`err.killed === true`) reste
   * `processus-interrompu`.
   *
   * Sur la fixture d'UNE seconde, et c'est délibéré : `positionsVignettes(1)`
   * ne rend qu'UNE position, donc un seul `TIMEOUT_VIGNETTE_MS` de vingt
   * secondes à subir. Sur la fixture de dix secondes, huit positions
   * coûteraient cent soixante secondes pour prouver la même chose — et ce
   * fichier serait le premier qu'on désactiverait.
   */
  siBinaires()('un vrai dépassement de délai reste `processus-interrompu`', async () => {
    const { TIMEOUT_VIGNETTE_MS } = await import('@/lib/autopilot/analyse/extraction');
    const debut = Date.now();
    const d = await diagnostiquer(FAUX.dort, CLE_COURT);
    const ecoule = Date.now() - debut;

    // UNE seule position : c'est ce qui rend ce test tenable.
    expect(d.resultat.technique.vignettesAttendues).toBe(1);
    // Le délai a réellement coupé — et il n'a pas coupé à côté.
    expect(ecoule, 'le processus a rendu la main trop tôt pour être un délai')
      .toBeGreaterThanOrEqual(TIMEOUT_VIGNETTE_MS - 2_000);
    expect(d.appels).toBe(1);
    expect(d.cause).toMatch(/^processus-interrompu/);
  }, 120_000);

  /** PREUVE 7 — un code de sortie numérique reste `code=1`. */
  siBinaires()('un code de sortie numérique reste `code=1`', async () => {
    const d = await diagnostiquer(FAUX.code1);

    expect(d.appels).toBe(1);
    expect(d.cause).toMatch(/^code=1\b/);
    // Et surtout : PAS d'`errno=` là où Node a rendu un vrai code de sortie.
    // Le nouveau champ ne doit pas se substituer à l'ancien, sans quoi les
    // comptages par cause déjà en place changeraient de sens en silence.
    expect(errnoDe(d.cause), 'un code de sortie n est pas un errno').toBe(null);
    // Le stderr de ffmpeg suit l'étiquette : c'est lui qui dit POURQUOI.
    expect(d.cause).toContain('Invalid data found');
  }, 120_000);
});

describe('M3-B2.4 — le succès ne change pas, et ne journalise rien', () => {
  /**
   * PREUVE 8 — un vrai ffmpeg, huit vraies JPEG, aucun message.
   *
   * `FFMPEG_PATH` est SUPPRIMÉ ici — pas pointé ailleurs : c'est
   * `cheminFfmpeg()` qui résout, exactement comme en production.
   */
  siBinaires()('huit JPEG produites, zéro ligne de journal', async () => {
    const d = await diagnostiquer(null);

    expect(d.resultat.ok).toBe(true);
    expect(d.resultat.motif).toBe(null);
    expect(d.resultat.detail).toBe(null);
    expect(d.resultat.vignettes.length).toBe(8);
    expect(d.resultat.technique.vignettesAttendues).toBe(8);
    expect(d.resultat.technique.vignettesProduites).toBe(8);
    expect(d.resultat.technique.vignettesEchouees).toBe(0);

    // De VRAIES images, pas des tampons vides : signature `FF D8 FF` et
    // marqueur de fin `FF D9`. Une JPEG tronquée passerait l'en-tête seul.
    expect(d.ecritures.length).toBe(8);
    for (const e of d.ecritures) {
      expect([e.corps[0], e.corps[1], e.corps[2]], e.cle).toEqual([0xff, 0xd8, 0xff]);
      expect([e.corps[e.corps.length - 2], e.corps[e.corps.length - 1]], e.cle)
        .toEqual([0xff, 0xd9]);
    }

    // ── LE SILENCE ────────────────────────────────────────────────────────
    //
    // Un succès qui journaliserait noierait le seul message qui compte sous
    // le bruit des rushes sains. C'est la contrepartie exacte du lot M3-B2.2.
    expect(d.appels, 'un succès ne journalise rien').toBe(0);
    expect(d.cause).toBe('');
  }, 180_000);
});

// ─────────────────────────────────────────────────────────────────────────
// PREUVE 9 — rien de rejouable ne sort du diagnostic
// ─────────────────────────────────────────────────────────────────────────

describe('M3-B2.4 — la cause est dite, l URL ne l est pas', () => {
  /**
   * Le faux ffmpeg recopie SON PROPRE `argv` dans stderr — donc l'URL
   * présignée, sa signature `X-Amz-Signature`, l'hôte et le port du banc.
   *
   * C'est le seul montage qui éprouve vraiment le masquage : sur `ENOENT`,
   * sur `EACCES` ou sur un signal, stderr est VIDE, et prouver la non-fuite
   * sur du vide ne prouve rien du tout. Ici la ligne de journal reçoit
   * littéralement le secret, et doit n'en rien laisser passer.
   *
   * L'appel ENTIER est inspecté — message et détails —, pas seulement la
   * cause : un champ ajouté à côté d'elle échapperait à une assertion qui ne
   * regarderait que `details.cause`.
   */
  siBinaires()('l argv de ffmpeg, URL signée comprise, ne ressort pas du journal', async () => {
    const d = await diagnostiquer(FAUX.bavardArgv);

    expect(d.appels).toBe(1);
    // La cause reste DIAGNOSTIQUE : sans elle, la ligne ne vaudrait pas la
    // peine d'exister, et la non-fuite serait triviale à obtenir.
    expect(d.cause.length, 'une cause vide n est pas une victoire').toBeGreaterThan(0);
    expect(d.cause).toMatch(/^code=1\b/);
    // La preuve que le faux binaire a bien écrit ses arguments : sans elle,
    // ce test pourrait passer parce que rien n'a jamais été écrit.
    expect(d.cause, 'les arguments n ont pas été recopiés : le banc ne prouve rien')
      .toContain('-frames:v');

    for (const [quoi, motif] of [
      ['schéma d URL', /[a-z][a-z0-9+.-]*:\/\//i],
      ['paramètre présigné', /X-Amz-/],
      ['algorithme de signature', /AWS4-HMAC-SHA256/],
      ['hôte du banc', /127\.0\.0\.1/],
      // `:<port>` et non le port seul : `-rw_timeout 15000000` contient déjà
      // des suites de chiffres, et un port éphémère qui s'y retrouverait par
      // hasard ferait rougir ce test une fois sur quelques milliers — la
      // pire espèce de test, celui qu'on finit par désactiver.
      ['port du banc', new RegExp(`:${portServeur}\\b`)],
    ] as const) {
      expect(d.rendu, `${quoi} dans la ligne de journal`).not.toMatch(motif);
    }

    // Et rien non plus dans ce que le module REND à son appelant.
    const sortie = JSON.stringify(d.resultat);
    expect(sortie).not.toMatch(/[a-z][a-z0-9+.-]*:\/\//i);
    expect(sortie).not.toContain('X-Amz-');
    expect(sortie).not.toContain('127.0.0.1');
  }, 120_000);

  /**
   * Les deux champs à venir vont au JOURNAL, et nulle part ailleurs.
   *
   * `technique` est écrit en base ET rendu au navigateur par
   * `analysePublique`. Y faire remonter `codeSysteme` ou `signal` — ou la
   * cause elle-même — reviendrait à publier la sortie d'un processus serveur
   * dans une réponse HTTP, ce que le contrat de sortie de M3-B1 interdit.
   * Cette assertion est verte aujourd'hui et doit le rester : c'est la
   * limite exacte du lot.
   */
  /**
   * LE BALAYAGE — la non-fuite sur TOUTES les pannes, pas sur une seule.
   *
   * ⚠️ CE TEST EXISTE À CAUSE D'UNE MUTATION QUI EST PASSÉE À CÔTÉ DU FILET.
   *
   * Le test précédent n'éprouve qu'un seul chemin : `code=1`, où `err.code`
   * est un NOMBRE. Or les deux champs ajoutés par ce lot ne se remplissent
   * que sur les autres chemins — une chaîne d'errno, ou une mort par signal.
   * En remplaçant `etiquetteSysteme(...)` par `e.message`, on fait donc
   * fuiter l'URL présignée ENTIÈRE, signature comprise, par la branche
   * `signal` — et le test précédent reste vert, puisqu'il ne visite jamais
   * cette branche.
   *
   * Le filet doit donc être posé sur la panne, pas sur un exemplaire : ce qui
   * ne fuit pas sur `code=1` peut parfaitement fuir sur `SIGSEGV`.
   */
  for (const panne of ['code1', 'bavardArgv', 'bavardStdout', 'segv', 'sigkill', 'eacces', 'absent'] as const) {
    siBinaires()(`« ${panne} » : rien de rejouable dans la ligne de journal`, async () => {
      const d = await diagnostiquer(FAUX[panne]);

      // On ne se satisfait pas d'une ligne vide : il faut qu'elle ait été
      // écrite, et qu'elle dise quelque chose.
      expect(d.appels, 'aucune ligne : le balayage ne prouverait rien').toBe(1);
      expect(d.cause.length, 'une cause vide n est pas une victoire').toBeGreaterThan(0);

      for (const [quoi, motif] of [
        ['schéma d URL', /[a-z][a-z0-9+.-]*:\/\//i],
        ['paramètre présigné', /X-Amz-/],
        ['algorithme de signature', /AWS4-HMAC-SHA256/],
        ['hôte du banc', /127\.0\.0\.1/],
        ['port du banc', new RegExp(`:${portServeur}\\b`)],
        // Le chemin serveur du binaire : `masquerUrls` ne le voit pas — il ne
        // connaît que `schéma://` — et `err.message` le porte toujours.
        ['chemin du binaire', new RegExp(RACINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))],
      ] as const) {
        expect(d.rendu, `${quoi} dans la ligne de journal (panne « ${panne} »)`).not.toMatch(motif);
      }
    }, 120_000);
  }

  /**
   * LA CEINTURE, PROUVÉE EN DIRECT.
   *
   * Node ne fabrique jamais ces chaînes à partir de l'entrée : le vocabulaire
   * est fermé, et c'est précisément ce qui rend l'allowlist INVISIBLE à tout
   * test passant par `execFile` — la retirer laisse la suite entière verte.
   * Une protection qu'aucun test ne distingue de son absence n'est pas une
   * protection, c'est un commentaire. On l'éprouve donc en direct, avec des
   * valeurs qu'un runtime honnête ne produit pas.
   */
  it('une valeur hors vocabulaire ne peut rien transporter', async () => {
    const { etiquetteSysteme } = await import('@/lib/autopilot/analyse/extraction');

    // Ce que Node produit réellement : conservé verbatim, c'est le but.
    for (const bon of ['EACCES', 'EAGAIN', 'ENOENT', 'SIGSEGV', 'SIGKILL', 'SIGVTALRM',
      'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', 'EPROTONOSUPPORT', 'EAI_AGAIN']) {
      expect(etiquetteSysteme(bon), bon).toBe(bon);
    }

    // Ce qu'il ne produit pas, et qui ne doit donc jamais passer tel quel —
    // à commencer par tout ce qui pourrait porter un secret.
    for (const mauvais of [
      'Command failed: /app/ffmpeg -i http://h/x?X-Amz-Signature=deadbeef',
      'spawn /app/node_modules/ffmpeg-static/ffmpeg EACCES',
      'eacces',
      'SIGRTMIN+3',
      'A'.repeat(41),
    ]) {
      const rendu = etiquetteSysteme(mauvais);
      expect(rendu, JSON.stringify(mauvais)).toBe('hors-vocabulaire');
      // La borne est totale : rien de l'entrée ne survit, pas un fragment.
      expect(rendu).not.toContain('X-Amz-');
      expect(rendu).not.toMatch(/[a-z][a-z0-9+.-]*:\/\//i);
      expect(rendu).not.toContain('/app');
    }

    // Absence : `null`, et non l'étiquette de repli — « rien à dire » et
    // « valeur suspecte » ne se comptent pas ensemble.
    for (const vide of [null, undefined, '', 42, {}, []]) {
      expect(etiquetteSysteme(vide), JSON.stringify(vide)).toBe(null);
    }
  });

  siBinaires()('ni la cause ni ses champs ne remontent dans `technique` ou `detail`', async () => {
    const d = await diagnostiquer(FAUX.segv);

    const technique = JSON.stringify(d.resultat.technique);
    for (const interdit of ['errno', 'signal', 'SIGSEGV', 'cause', 'stderr', 'ffmpeg']) {
      expect(technique, `« ${interdit} » n a rien à faire dans technique`)
        .not.toContain(interdit);
    }
    // `technique` reste ce qu'il a toujours été : des nombres et des noms de
    // codec, rien qui vienne d'un processus.
    expect(d.resultat.technique.vignettesEchouees).toBe(8);
    expect(d.resultat.detail).toBe(null);
  }, 120_000);
});

// ─────────────────────────────────────────────────────────────────────────
// PREUVE 10 — l'extraction elle-même ne bouge pas
// ─────────────────────────────────────────────────────────────────────────

describe('M3-B2.4 — un échec de vignette reste non fatal, et compté une fois', () => {
  /**
   * Le comportement que le lot ne doit PAS toucher, éprouvé sur les cinq
   * pannes d'un coup plutôt que rappelé dans un commentaire.
   *
   * Ce qui doit rester vrai, quelle que soit la cause :
   *
   *   • `ok: true` — la MESURE a réussi, et c'est elle dont dépendent les
   *     lots suivants. Les images ne sont qu'un confort de lecture.
   *   • `motif: null` — un motif ferait de l'analyse un échec, et la ligne
   *     serait marquée `echouee` alors que la durée est connue.
   *   • 8 attendues, 0 produites, 8 échouées — la soustraction de M3-B2.2.
   *   • UNE ligne de journal, pas huit : `premierEchec ??=` ne retient que
   *     la première cause, et huit lignes identiques multiplieraient par
   *     huit l'occasion qu'un secret passe.
   */
  const pannes = ['code1', 'bavardArgv', 'segv', 'sigkill', 'bavardStdout', 'absent'] as const;

  for (const panne of pannes) {
    siBinaires()(`« ${panne} » : mesure intacte, 8/0/8 comptés, un seul message`, async () => {
      const d = await diagnostiquer(FAUX[panne]);

      expect(d.resultat.ok, 'un échec de vignette n est pas fatal').toBe(true);
      expect(d.resultat.motif).toBe(null);
      expect(d.resultat.detail).toBe(null);
      expect(d.resultat.dureeSecondes).toBeGreaterThan(DUREE_RUSH - 0.6);
      expect(d.resultat.technique.sonde).toBe('ffprobe');
      expect(d.resultat.technique.largeur).toBe(160);
      expect(d.resultat.technique.hauteur).toBe(120);

      expect(d.resultat.technique.vignettesAttendues, 'huit positions demandées').toBe(8);
      expect(d.resultat.technique.vignettesProduites, 'aucune image produite').toBe(0);
      expect(d.resultat.technique.vignettesEchouees, 'les huit sont perdues').toBe(8);
      expect(d.resultat.vignettes).toEqual([]);
      expect(d.ecritures.length, 'rien n a été écrit dans le stockage').toBe(0);

      expect(d.appels, 'un avertissement, pas huit').toBe(1);
      expect(d.details.analysisId).toBe(ANALYSE);
      expect(d.details.attendues).toBe(8);
      // La cause est TOUJOURS renseignée, quelle que soit la panne — c'est le
      // minimum que la correction doit garantir, avant même de savoir quoi y
      // écrire.
      expect(String(d.details.cause ?? '').trim().length, 'cause vide').toBeGreaterThan(0);
      expect(String(d.details.cause)).not.toBe('inconnue');
    }, 180_000);
  }

  siBinaires()('le vocabulaire des motifs reste fermé, quelle que soit la correction', async () => {
    const { MOTIFS_EXTRACTION } = await import('@/lib/autopilot/analyse/extraction');
    const d = await diagnostiquer(FAUX.segv);
    // Aujourd'hui `motif` vaut `null`. Cette assertion existe pour la
    // correction : un motif inventé sur place — `processus_casse` — casserait
    // tous les comptages par cause déjà en place.
    if (d.resultat.motif !== null) {
      expect(MOTIFS_EXTRACTION as readonly string[]).toContain(d.resultat.motif);
      expect(d.resultat.ok).toBe(false);
    }
  }, 120_000);
});
