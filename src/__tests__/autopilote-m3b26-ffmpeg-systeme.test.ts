// @vitest-environment node
/**
 * M3-B2.6 — Le binaire SYSTÈME passe devant `ffmpeg-static`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE DÉFAUT QUE CE FICHIER FERME
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `ffmpeg-static` livre un ELF lié STATIQUEMENT. Un binaire statique n'a pas
 * d'éditeur de liens dynamique, mais la glibc, elle, résout les noms d'hôte
 * par NSS — c'est-à-dire par `dlopen`. Dans un exécutable statique ce
 * chargement tombe dans le vide : le processus meurt en SIGSEGV dès qu'une
 * URL porte un NOM D'HÔTE plutôt qu'une adresse IP littérale.
 *
 * En production, l'URL présignée de MinIO porte un nom d'hôte
 * (`studiio-minio`). Les huit vignettes mouraient donc toutes de la même
 * façon — et c'est le lot M3-B2.4 qui a permis de le LIRE, en écrivant
 * `signal=SIGSEGV` au journal là où l'on ne voyait que `code=aucun `.
 *
 * Le binaire Debian de l'image (`Dockerfile`, `apt-get install ffmpeg`) est
 * lié dynamiquement et n'a pas ce défaut. La correction est donc une
 * inversion de priorité, pas un contournement :
 *
 *     FFMPEG_PATH  >  binaires système  >  ffmpeg-static  >  'ffmpeg'
 *
 * `cheminFfprobe()` ne bouge pas : il n'a jamais connu `ffmpeg-static`, qui
 * ne livre pas de ffprobe.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * COMMENT L'ORDRE SE PROUVE — ET POURQUOI UN FAUX `accessSync`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Trois des quatre candidats sont des chemins CODÉS EN DUR (`/usr/bin`,
 * `/usr/local/bin`, `/opt/homebrew/bin`) : rien ne permet de les rediriger.
 * Sur une machine qui a Homebrew, « aucun binaire système n'existe » est une
 * situation IMPOSSIBLE À FABRIQUER ; sur la CI, qui n'a aucun ffmpeg, c'est
 * l'inverse. Un fichier qui s'en remettrait à la machine ne prouverait donc
 * l'ordre complet NULLE PART.
 *
 * ⚠️ CE N'EST PAS LA DOUBLURE QUE LE DÉPÔT INTERDIT. La règle — « une
 * doublure ne prouverait que sa propre programmation » — vise le cas où l'on
 * double le COLLABORATEUR dont la compétence est l'enjeu : doubler ffprobe
 * pour prouver que ffprobe lit un MP4 ne prouve rien. Ici l'objet du test est
 * une fonction de DÉCISION : étant donné un ensemble de chemins présents,
 * lequel est rendu. Le système de fichiers en est l'ENTRÉE, pas la réponse.
 *
 * Et la doublure ne reste jamais seule. Trois témoins la tiennent :
 *
 *   1. Elle enregistre l'ORDRE DE CONSULTATION, pas seulement le résultat.
 *      Une implémentation qui rendrait le bon chemin sans le chercher — une
 *      constante en dur — échouerait.
 *   2. Un test SANS AUCUN MOCK rejoue la même question sur le VRAI disque,
 *      avec le VRAI `accessSync`, là où la machine a les deux binaires.
 *   3. Une assertion sur le TEXTE SOURCE fixe l'ordre des candidats. C'est le
 *      seul témoin qui reste debout sur la CI, où aucun ffmpeg n'est installé.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ CE QUI EST HORS DE PORTÉE, ET IL FAUT LE DIRE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * a) `require('ffmpeg-static')` est du CODE MORT SOUS VITEST. Le module
 *    runner de Vite construit chaque module avec `new AsyncFunction` et six
 *    clés SSR : `require` n'y est ni paramètre ni global, l'appel lève
 *    `ReferenceError`, et le `catch {}` l'avale. Aucun test de comportement
 *    ne peut visiter cette branche — seule l'assertion de source la couvre,
 *    par sa POSITION dans le fichier.
 *
 * b) LE SEGFAULT LUI-MÊME NE SE REPRODUIT PAS SUR macOS : le binaire livré y
 *    est un Mach-O, et la résolution passe par libSystem, sans NSS. Le test
 *    qui l'observe ne s'arme donc que sous Linux. Prétendre le reproduire
 *    ailleurs serait un mensonge.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { execFileSync } from 'child_process';
import {
  createServer, type IncomingMessage, type Server, type ServerResponse,
} from 'http';
import { createReadStream, mkdirSync, readFileSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { lookup } from 'dns/promises';
import { cheminFfmpeg, cheminFfprobe } from '@/lib/ffmpeg/binaires';

// ─────────────────────────────────────────────────────────────────────────
// La doublure de stockage — reprise du harnais M3-B2.4
// ─────────────────────────────────────────────────────────────────────────

let objets: Record<string, { taille: number }> = {};
interface EcritureVignette { bucket: string; cle: string; taille: number; corps: Buffer }
let ecritures: EcritureVignette[] = [];

/**
 * ⚠️ UN NOM D'HÔTE, PAS UNE ADRESSE — c'est TOUT l'objet de ce fichier.
 *
 * `127.0.0.1` ne fait pas appeler NSS : le binaire statique s'en tirerait, et
 * le banc couvrirait la mauvaise famille de bug. En production l'endpoint
 * MinIO est un nom, et c'est ce nom qui tue le processus.
 */
let hoteServeur = 'localhost';
let portServeur = 0;

vi.mock('@/lib/storage/minio-client', () => ({
  clientMinio: () => ({
    statObject: async (bucket: string, cle: string) => {
      const o = objets[`${bucket}/${cle}`];
      if (!o) throw new Error('The specified key does not exist.');
      return { size: o.taille };
    },
    putObject: async (bucket: string, cle: string, corps: unknown, taille?: number) => {
      const buf = corps as Buffer;
      ecritures.push({
        bucket, cle, taille: Number(taille ?? 0),
        corps: Buffer.isBuffer(buf) ? Buffer.from(buf) : Buffer.alloc(0),
      });
      return {};
    },
  }),
  signeurInterne: () => ({
    presignedGetObject: async (bucket: string, cle: string, ttl: number) => (
      `http://${hoteServeur}:${portServeur}/${bucket}/${encodeURI(cle)}`
      + '?X-Amz-Algorithm=AWS4-HMAC-SHA256'
      + `&X-Amz-Credential=${randomBytes(6).toString('hex')}%2Fstudiio%2Fs3%2Faws4_request`
      + `&X-Amz-Date=20260829T000000Z&X-Amz-Expires=${ttl}&X-Amz-SignedHeaders=host`
      + `&X-Amz-Signature=${randomBytes(16).toString('hex')}`
    ),
  }),
  signeurPublic: () => null,
}));

// ─────────────────────────────────────────────────────────────────────────
// Le banc à système de fichiers contrôlé
// ─────────────────────────────────────────────────────────────────────────

const SYS = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg'] as const;
const SYS_PROBE = ['/usr/bin/ffprobe', '/usr/local/bin/ffprobe', '/opt/homebrew/bin/ffprobe'] as const;

/** Le seul candidat `ffmpeg-static` que Vitest atteigne : voir « hors de portée » (a). */
const STATIC_DE = (cwd: string) => join(cwd, 'node_modules', 'ffmpeg-static', 'ffmpeg');

const CWD_FICTIF = join(tmpdir(), 'studiio-m3b26-cwd-fictif');

interface Resolution {
  ffmpeg: string;
  ffprobe: string;
  /** Les chemins passés à `accessSync`, DANS L'ORDRE. */
  consultes: string[];
}

/**
 * Résout les deux binaires avec, pour tout système de fichiers, l'ensemble
 * `presents` — et rien d'autre.
 *
 * `vi.doMock` et non `vi.mock` : `vi.mock` est HOISTÉ au sommet du fichier et
 * s'appliquerait au serveur HTTP, aux fixtures et aux lectures de source du
 * même fichier. `doMock` n'agit que sur les imports dynamiques qui suivent.
 *
 * Tout est défait dans le `finally` : la configuration n'a pas `restoreMocks`,
 * et un `fs` resté faux ferait échouer le groupe suivant pour une raison qui
 * n'aurait plus rien à voir avec lui.
 */
async function resoudre(
  presents: readonly string[],
  env: { FFMPEG_PATH?: string; FFPROBE_PATH?: string } = {},
  cwd: string = CWD_FICTIF,
): Promise<Resolution> {
  const avantFfmpeg = process.env.FFMPEG_PATH;
  const avantFfprobe = process.env.FFPROBE_PATH;
  const ensemble = new Set(presents);
  const consultes: string[] = [];

  const reel = await vi.importActual<typeof import('fs')>('fs');
  const faux = {
    ...reel,
    accessSync: (p: unknown, mode?: number) => {
      const chemin = String(p);
      consultes.push(chemin);
      // Le module DOIT demander le droit d'EXÉCUTION, pas la simple présence.
      // Un `existsSync` rendrait « lisible » un dossier ou un fichier sans le
      // bit `x`, et l'échec sortirait plus loin, en `EACCES`, loin de sa cause.
      expect(mode, `accessSync(${chemin}) doit demander X_OK`).toBe(reel.constants.X_OK);
      if (!ensemble.has(chemin)) {
        const e: NodeJS.ErrnoException = new Error(`ENOENT: ${chemin}`);
        e.code = 'ENOENT';
        throw e;
      }
    },
  };

  const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(cwd);
  try {
    if (env.FFMPEG_PATH === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = env.FFMPEG_PATH;
    if (env.FFPROBE_PATH === undefined) delete process.env.FFPROBE_PATH;
    else process.env.FFPROBE_PATH = env.FFPROBE_PATH;

    vi.resetModules();
    // `fs` ET `node:fs` : Vitest les enregistre sous deux identifiants, et le
    // jour où quelqu'un change l'import du module, le banc doit suivre.
    vi.doMock('fs', () => ({ ...faux, default: faux }));
    vi.doMock('node:fs', () => ({ ...faux, default: faux }));

    const mod = await import('@/lib/ffmpeg/binaires');
    const ffmpeg = mod.cheminFfmpeg();
    const ffprobe = mod.cheminFfprobe();
    return { ffmpeg, ffprobe, consultes };
  } finally {
    cwdSpy.mockRestore();
    vi.doUnmock('fs');
    vi.doUnmock('node:fs');
    vi.resetModules();
    if (avantFfmpeg === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = avantFfmpeg;
    if (avantFfprobe === undefined) delete process.env.FFPROBE_PATH;
    else process.env.FFPROBE_PATH = avantFfprobe;
  }
}

const resoudreFfmpeg = async (...a: Parameters<typeof resoudre>) => (await resoudre(...a)).ffmpeg;

/** Le rang de consultation d'un chemin, ou `-1` s'il n'a jamais été demandé. */
const rang = (consultes: string[], chemin: string) => consultes.indexOf(chemin);

// ─────────────────────────────────────────────────────────────────────────
// PREUVE 1 — `FFMPEG_PATH` gagne, et n'est PAS vérifié
// ─────────────────────────────────────────────────────────────────────────

describe('M3-B2.6 — `FFMPEG_PATH` reste le prioritaire absolu', () => {
  it('un chemin inexistant est rendu TEL QUEL, sans un seul accès disque', async () => {
    const fantome = '/chemin/qui/n/existe/pas/ffmpeg';
    // Tout est présent autour de lui : si le module vérifiait, il aurait de
    // quoi préférer autre chose. Il ne doit rien préférer.
    const r = await resoudre([...SYS, STATIC_DE(CWD_FICTIF)], { FFMPEG_PATH: fantome });

    expect(r.ffmpeg).toBe(fantome);
    // La preuve forte : AUCUN chemin n'a été consulté pour ffmpeg. Un chemin
    // explicite qu'on ignorerait parce qu'il ne répond pas est la pire des
    // réponses — celui qui l'a posé croit piloter la machine, et c'est un
    // autre binaire qui tourne.
    expect(rang(r.consultes, fantome), 'FFMPEG_PATH ne doit pas être vérifié').toBe(-1);
    for (const s of SYS) expect(rang(r.consultes, s), s).toBe(-1);
  });

  it('une chaîne VIDE ne compte pas pour un chemin', async () => {
    // `FFMPEG_PATH=''` est une variable posée puis effacée dans un script de
    // déploiement. La traiter comme un chemin ferait lancer `execFile('')`.
    const r = await resoudre(['/usr/bin/ffmpeg'], { FFMPEG_PATH: '' });
    expect(r.ffmpeg).toBe('/usr/bin/ffmpeg');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PREUVE 2 — LE CŒUR DU LOT : le système passe devant `ffmpeg-static`
// ─────────────────────────────────────────────────────────────────────────

describe('M3-B2.6 — le binaire système est préféré à `ffmpeg-static`', () => {
  it('les deux existent : c est `/usr/bin/ffmpeg` qui sort', async () => {
    const statique = STATIC_DE(CWD_FICTIF);
    const r = await resoudre(['/usr/bin/ffmpeg', statique]);

    expect(
      r.ffmpeg,
      'un ELF statique segfaute sur tout nom d hôte : il ne doit plus gagner',
    ).toBe('/usr/bin/ffmpeg');
    expect(r.ffmpeg).not.toBe(statique);

    // ── ET IL A ÉTÉ CHERCHÉ D'ABORD ──────────────────────────────────────
    // Sans cette assertion, une implémentation qui rendrait une constante en
    // dur passerait l'assertion précédente sans rien avoir résolu.
    const rSysteme = rang(r.consultes, '/usr/bin/ffmpeg');
    expect(rSysteme, '/usr/bin/ffmpeg doit être consulté').toBeGreaterThanOrEqual(0);
    const rStatique = rang(r.consultes, statique);
    if (rStatique >= 0) {
      expect(rSysteme, 'le système doit être interrogé AVANT ffmpeg-static').toBeLessThan(rStatique);
    }
  });

  it('l ordre entre les trois emplacements système ne change pas', async () => {
    const statique = STATIC_DE(CWD_FICTIF);
    // `/usr/bin` d'abord — c'est celui du conteneur Debian.
    expect(await resoudreFfmpeg([...SYS, statique])).toBe('/usr/bin/ffmpeg');
    // Puis `/usr/local/bin` — compilations locales.
    expect(await resoudreFfmpeg(['/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg', statique]))
      .toBe('/usr/local/bin/ffmpeg');
    // Puis Homebrew — les machines de développement.
    expect(await resoudreFfmpeg(['/opt/homebrew/bin/ffmpeg', statique]))
      .toBe('/opt/homebrew/bin/ffmpeg');
  });

  it('même seul, chaque emplacement système bat `ffmpeg-static`', async () => {
    const statique = STATIC_DE(CWD_FICTIF);
    for (const s of SYS) {
      expect(await resoudreFfmpeg([s, statique]), s).toBe(s);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PREUVE 3 — `ffmpeg-static` reste le REPLI, il n'est pas supprimé
// ─────────────────────────────────────────────────────────────────────────

describe('M3-B2.6 — sans binaire système, `ffmpeg-static` sert encore', () => {
  it('aucun système : le paquet embarqué est rendu', async () => {
    const statique = STATIC_DE(CWD_FICTIF);
    const r = await resoudre([statique]);

    expect(
      r.ffmpeg,
      'le repli ne doit pas disparaître : une installation sans ffmpeg système en dépend',
    ).toBe(statique);
    // Les trois chemins système ont bien été TENTÉS avant de se rabattre.
    for (const s of SYS) {
      expect(rang(r.consultes, s), `${s} doit avoir été tenté`).toBeGreaterThanOrEqual(0);
      expect(rang(r.consultes, s)).toBeLessThan(rang(r.consultes, statique));
    }
  });

  it('le candidat embarqué suit le `cwd`, et rien d autre', async () => {
    // ⚠️ Ce test est ce qui rend le précédent honnête : il prouve que le
    // chemin rendu est bien CALCULÉ depuis `process.cwd()`, pas écrit en dur.
    const ailleurs = join(tmpdir(), 'studiio-m3b26-autre-racine');
    const r = await resoudre([STATIC_DE(ailleurs)], {}, ailleurs);
    expect(r.ffmpeg).toBe(STATIC_DE(ailleurs));
    expect(r.ffmpeg).toContain(ailleurs);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PREUVE 4 — le dernier recours
// ─────────────────────────────────────────────────────────────────────────

describe('M3-B2.6 — rien nulle part : le PATH, et un ENOENT visible', () => {
  it('rend `ffmpeg` tout court, après avoir tout tenté', async () => {
    const r = await resoudre([]);
    expect(r.ffmpeg).toBe('ffmpeg');
    // Les QUATRE candidats ont été tentés : le repli n'est pas un raccourci.
    for (const c of [...SYS, STATIC_DE(CWD_FICTIF)]) {
      expect(rang(r.consultes, c), `${c} doit avoir été tenté`).toBeGreaterThanOrEqual(0);
    }
    // Et surtout PAS `null` : un seul mécanisme décide que ffmpeg est absent —
    // le `ENOENT` du lancement, que M3-B2.4 traduit déjà en
    // `ffmpeg-absent(ENOENT)`. En rendre `null` ici en ajouterait un second,
    // et deux mécanismes pour un même fait finissent par se contredire.
    expect(r.ffmpeg).not.toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PREUVE 5 — `cheminFfprobe()` NE BOUGE PAS
// ─────────────────────────────────────────────────────────────────────────

describe('M3-B2.6 — la sonde est hors du lot, et le reste', () => {
  it('`FFPROBE_PATH` gagne, sans vérification', async () => {
    const fantome = '/chemin/qui/n/existe/pas/ffprobe';
    const r = await resoudre(SYS_PROBE, { FFPROBE_PATH: fantome });
    expect(r.ffprobe).toBe(fantome);
    expect(rang(r.consultes, fantome)).toBe(-1);
  });

  it('les trois mêmes candidats, dans le même ordre, et le même repli', async () => {
    expect((await resoudre(SYS_PROBE)).ffprobe).toBe('/usr/bin/ffprobe');
    expect((await resoudre(['/usr/local/bin/ffprobe', '/opt/homebrew/bin/ffprobe'])).ffprobe)
      .toBe('/usr/local/bin/ffprobe');
    expect((await resoudre(['/opt/homebrew/bin/ffprobe'])).ffprobe).toBe('/opt/homebrew/bin/ffprobe');
    expect((await resoudre([])).ffprobe).toBe('ffprobe');
  });

  it('ffprobe ne connaît toujours pas `ffmpeg-static` — le paquet n en livre pas', async () => {
    const statique = STATIC_DE(CWD_FICTIF);
    // Un ffprobe posé DANS le dossier du paquet : `cheminFfprobe` ne doit ni
    // le chercher, ni le trouver. Chercher un frère du binaire embarqué est
    // une perte de temps garantie, et le module le dit dans son en-tête.
    const frere = join(CWD_FICTIF, 'node_modules', 'ffmpeg-static', 'ffprobe');
    const r = await resoudre([statique, frere]);
    expect(r.ffprobe).toBe('ffprobe');
    expect(rang(r.consultes, frere), 'ffprobe ne doit pas fouiller le paquet').toBe(-1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PREUVE 5bis — LE TEXTE SOURCE : le seul témoin debout sur la CI
// ─────────────────────────────────────────────────────────────────────────

describe('M3-B2.6 — l ordre est écrit dans le source, pas seulement observé', () => {
  const MODULE = 'src/lib/ffmpeg/binaires.ts';
  const brut = () => readFileSync(join(process.cwd(), MODULE), 'utf8');
  /** Les commentaires NOMMENT les règles ; seul le code les applique. */
  const sansCommentaires = (code: string) => code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  const corpsFfmpeg = () => {
    const c = sansCommentaires(brut());
    const d = c.indexOf('export function cheminFfmpeg');
    const f = c.indexOf('export function cheminFfprobe');
    expect(d, 'cheminFfmpeg introuvable').toBeGreaterThan(-1);
    expect(f, 'cheminFfprobe introuvable').toBeGreaterThan(d);
    return c.slice(d, f);
  };

  it('`FFMPEG_PATH` est lu en PREMIER et rendu sans passer par `lisible`', () => {
    const c = corpsFfmpeg();
    const env = c.indexOf('FFMPEG_PATH');
    expect(env).toBeGreaterThan(-1);
    expect(env, 'FFMPEG_PATH doit précéder tout candidat')
      .toBeLessThan(c.indexOf("'/usr/bin/ffmpeg'"));
    expect(c).toMatch(/if\s*\(\s*force\s*\)\s*return\s+force\s*;/);
    expect(c, 'FFMPEG_PATH ne doit jamais être vérifié').not.toMatch(/lisible\s*\(\s*force\s*\)/);
  });

  it('les trois emplacements système précèdent `ffmpeg-static`', () => {
    const c = corpsFfmpeg();
    const iUsr = c.indexOf("'/usr/bin/ffmpeg'");
    const iLoc = c.indexOf("'/usr/local/bin/ffmpeg'");
    const iBrew = c.indexOf("'/opt/homebrew/bin/ffmpeg'");
    const iStat = c.search(/ffmpeg-static/);

    for (const [nom, i] of [
      ['usr', iUsr], ['local', iLoc], ['brew', iBrew], ['static', iStat],
    ] as const) {
      expect(i, `${nom} absent du corps de cheminFfmpeg`).toBeGreaterThan(-1);
    }
    expect(iUsr).toBeLessThan(iLoc);
    expect(iLoc).toBeLessThan(iBrew);
    // ── L'INVERSION, GRAVÉE ───────────────────────────────────────────────
    // C'est CETTE ligne qui rougit si quelqu'un remet le paquet en tête. Elle
    // couvre aussi le `require('ffmpeg-static')`, que Vitest ne peut PAS
    // exécuter : sa position dans le fichier est le seul moyen de la tenir.
    expect(
      iBrew,
      'ffmpeg-static doit venir APRÈS les trois emplacements système : '
      + 'l ELF statique segfaute sur tout nom d hôte',
    ).toBeLessThan(iStat);
  });

  it('les DEUX voies vers `ffmpeg-static` sont conservées', () => {
    const c = corpsFfmpeg();
    // Aucune ne couvre l'autre : `require` n'existe pas sous le
    // transformateur ESM, le chemin en dur rate un paquet hissé ailleurs.
    expect(c, 'la voie `require` a disparu').toMatch(/require\('ffmpeg-static'\)/);
    expect(c, 'la voie par chemin a disparu')
      .toMatch(/join\(process\.cwd\(\),\s*'node_modules',\s*'ffmpeg-static',\s*'ffmpeg'\)/);
  });

  it('le dernier recours reste le PATH, jamais `null`', () => {
    expect(corpsFfmpeg()).toMatch(/return\s+'ffmpeg'\s*;/);
    expect(corpsFfmpeg()).not.toMatch(/return\s+null\s*;/);
  });

  it('`cheminFfprobe` est LITTÉRALEMENT le même code qu avant le lot', () => {
    // Un diff, pas une paraphrase. Les commentaires ont le droit de bouger ;
    // le code, non. C'est la limite EXACTE du lot, et elle est vérifiable.
    const c = sansCommentaires(brut());
    const d = c.indexOf('export function cheminFfprobe');
    const f = c.indexOf('function lisible');
    const normaliser = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');

    expect(normaliser(c.slice(d, f))).toBe([
      'export function cheminFfprobe(): string {',
      'const force = process.env.FFPROBE_PATH;',
      'if (force) return force;',
      'const candidats = [',
      "'/usr/bin/ffprobe',",
      "'/usr/local/bin/ffprobe',",
      "'/opt/homebrew/bin/ffprobe',",
      '];',
      'for (const c of candidats) if (lisible(c)) return c;',
      "return 'ffprobe';",
      '}',
    ].join('\n'));
  });

  it('`lisible` continue de demander le droit d EXÉCUTION', () => {
    const c = sansCommentaires(brut());
    expect(c).toMatch(/accessSync\(\s*chemin\s*,\s*constants\.X_OK\s*\)/);
    // `existsSync` rendrait « lisible » un dossier ou un fichier sans le bit
    // `x`, et l'échec sortirait plus loin, en `EACCES`, loin de sa cause.
    expect(c).not.toMatch(/existsSync/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PREUVE 7 — les arguments d'extraction ne bougent pas d'un octet
// ─────────────────────────────────────────────────────────────────────────

describe('M3-B2.6 — l extraction n est pas touchée par le lot', () => {
  const MODULE = 'src/lib/autopilot/analyse/extraction.ts';
  const code = () => readFileSync(join(process.cwd(), MODULE), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  it('`-ss` reste AVANT `-i` — c est ce qui déclenche la lecture par `Range`', () => {
    // ⚠️ Chercher `'-i', url,` dans TOUT le fichier trouverait d'abord celui
    // des SONDES, qui n'ont pas de `-ss` : l'ordre paraîtrait inversé alors
    // qu'il est juste. Le motif exige donc les deux dans la MÊME liste
    // d'arguments, `-ss` immédiatement suivi de `-i`.
    //
    // Après `-i`, ffmpeg décoderait depuis la première image et téléchargerait
    // tout le rush pour rendre une seule vignette. Avant, c'est un
    // positionnement du démuxeur, donc une requête HTTP `Range`.
    expect(code(), 'la vignette doit positionner le démuxeur avant d ouvrir l entrée')
      .toMatch(/'-ss',\s*String\(seconde\),\s*'-i',\s*url,/);
  });

  it('la ligne de commande de la vignette est mot pour mot celle d avant', () => {
    const c = code();
    for (const [quoi, motif] of [
      ['liste blanche de protocoles', /'-protocol_whitelist',\s*PROTOCOLES_AUTORISES/],
      ['délai réseau', /'-rw_timeout',\s*RW_TIMEOUT_US/],
      ['une seule image', /'-frames:v',\s*'1'/],
      ['mise à l échelle', /'-vf',\s*`scale='min\(\$\{LARGEUR_VIGNETTE\},iw\)':-2`/],
      ['conteneur image2', /'-f',\s*'image2'/],
      ['codec mjpeg', /'-vcodec',\s*'mjpeg'/],
      ['qualité', /'-q:v',\s*'5'/],
      ['pas d entrée standard', /'-nostdin'/],
      ['plafonds', /\{\s*timeoutMs:\s*TIMEOUT_VIGNETTE_MS,\s*maxSortie:\s*SORTIE_MAX_VIGNETTE\s*\}/],
    ] as const) {
      expect(c, `${MODULE} : ${quoi}`).toMatch(motif);
    }
  });

  it('les constantes de bornage gardent leur valeur', async () => {
    const m = await import('@/lib/autopilot/analyse/extraction');
    expect(m.TIMEOUT_VIGNETTE_MS).toBe(20_000);
    expect(m.LARGEUR_VIGNETTE).toBe(640);
    expect(m.PROTOCOLES_AUTORISES).toBe('http,https,tcp,tls');
    // `SORTIE_MAX_VIGNETTE` n'est pas exporté : il se lit dans le source.
    expect(code()).toMatch(/const SORTIE_MAX_VIGNETTE = 8 \* 1024 \* 1024;/);
    expect(code()).toMatch(/const RW_TIMEOUT_US = '15000000';/);
  });

  it('extraction.ts n importe toujours que ce qui est annoncé', () => {
    // Le lot ne doit RIEN ajouter ici : il ne touche que `binaires.ts`.
    const importes = [...code().matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
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
// PREUVE 6 — NON-RÉGRESSION RÉELLE : une vraie JPEG, depuis un NOM D'HÔTE
// ─────────────────────────────────────────────────────────────────────────

const RACINE = join(tmpdir(), `studiio-m3b26-${process.pid}`);
const FICHIERS: Record<string, string> = {};
let serveur4: Server | null = null;
let serveur6: Server | null = null;

/**
 * Les binaires répondent-ils ? Décidé AU CHARGEMENT.
 *
 * Vitest COLLECTE les tests — donc évalue `it` ou `it.skip` — avant
 * d'exécuter le moindre `beforeAll`. Une disponibilité calculée là-bas
 * arriverait toujours trop tard, et TOUS les tests seraient ignorés en
 * silence sur une machine parfaitement équipée.
 */
function repond(chemin: string): boolean {
  try {
    execFileSync(chemin, ['-hide_banner', '-version'], { timeout: 15_000, stdio: 'pipe' });
    return true;
  } catch { return false; }
}
const ffmpegDispo = repond(cheminFfmpeg());
const ffprobeDispo = repond(cheminFfprobe());
const binairesDispo = ffmpegDispo && ffprobeDispo;
const siBinaires = () => (binairesDispo ? it : it.skip);

/** Le binaire embarqué sur CETTE machine — s'il a été téléchargé. */
const STATIQUE_REEL = join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg');
const statiqueDispo = (() => {
  try { statSync(STATIQUE_REEL); return true; } catch { return false; }
})();
/** Un binaire système RÉEL sur cette machine, s'il y en a un. */
const systemeReel = SYS.find((s) => {
  try { statSync(s); return true; } catch { return false; }
}) ?? null;

const requete = () => (req: IncomingMessage, res: ServerResponse) => {
  const chemin = decodeURI((req.url || '').split('?')[0]);
  const nom = (chemin.split('/').filter(Boolean).pop() ?? '').replace(/\.mp4$/, '');
  const fichier = FICHIERS[nom];
  if (!fichier) { res.writeHead(404).end(); return; }

  const taille = statSync(fichier).size;
  const m = req.headers.range ? /bytes=(\d*)-(\d*)/.exec(String(req.headers.range)) : null;
  if (m) {
    const debut = m[1] ? Number(m[1]) : Math.max(0, taille - Number(m[2]));
    const fin = m[1] && m[2] ? Math.min(Number(m[2]), taille - 1) : taille - 1;
    if (debut >= taille) {
      res.writeHead(416, { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes */${taille}` }).end();
      return;
    }
    res.writeHead(206, {
      'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${debut}-${fin}/${taille}`,
      'Content-Length': String(fin - debut + 1),
    });
    const flux = createReadStream(fichier, { start: debut, end: fin });
    res.on('close', () => flux.destroy());
    flux.pipe(res);
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': String(taille),
  });
  const flux = createReadStream(fichier);
  res.on('close', () => flux.destroy());
  flux.pipe(res);
};

beforeAll(async () => {
  mkdirSync(RACINE, { recursive: true });
  if (binairesDispo) {
    const chemin = join(RACINE, 'rush.mp4');
    // La fixture est fabriquée par le ffmpeg QUE LE MODULE UTILISERA : deux
    // binaires différents pour écrire et pour lire feraient ressembler leur
    // divergence à un bug du module.
    execFileSync(cheminFfmpeg(), [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc=s=160x120:r=8:d=10',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '8', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', chemin,
    ], { timeout: 120_000, stdio: 'pipe' });
    FICHIERS.rush = chemin;
  }

  // ── SERVIR SUR UN NOM D'HÔTE, SANS S'EXPOSER AU RÉSEAU ─────────────────
  //
  // `localhost` peut résoudre en `::1`, en `127.0.0.1`, ou dans les deux
  // ordres selon la machine. Écouter sur `0.0.0.0` réglerait la question en
  // ouvrant le banc au réseau local, ce qu'un fichier de test n'a pas à
  // faire. On écoute donc sur les DEUX bouclages, au même port : quelle que
  // soit l'adresse essayée en premier, elle répond — et rien d'autre que le
  // bouclage n'est joignable.
  await new Promise<void>((r) => {
    serveur4 = createServer(requete());
    serveur4.listen(0, '127.0.0.1', () => {
      const a = serveur4!.address();
      portServeur = typeof a === 'object' && a ? a.port : 0;
      r();
    });
  });
  try {
    await new Promise<void>((r, j) => {
      serveur6 = createServer(requete());
      serveur6.once('error', j);
      serveur6.listen(portServeur, '::1', () => r());
    });
  } catch {
    serveur6 = null;   // Pas d'IPv6 ici : `127.0.0.1` suffira.
  }
  hoteServeur = 'localhost';
}, 180_000);

afterAll(async () => {
  if (serveur4) await new Promise<void>((r) => serveur4!.close(() => r()));
  if (serveur6) await new Promise<void>((r) => serveur6!.close(() => r()));
  try { rmSync(RACINE, { recursive: true, force: true }); } catch { /* rien à nettoyer */ }
});

afterEach(() => {
  objets = {};
  ecritures = [];
  // Ceinture : la configuration n'a ni `restoreMocks` ni `unstubEnvs`, et un
  // `fs` resté faux ferait échouer le test suivant loin de sa cause.
  vi.doUnmock('fs');
  vi.doUnmock('node:fs');
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('M3-B2.6 — le banc, et ce qu il vaut', () => {
  it('l URL du banc porte bien un NOM D HÔTE, pas une adresse', () => {
    // Sans cela, tout ce fichier couvrirait la mauvaise famille de bug :
    // `127.0.0.1` ne fait jamais appeler NSS, et le binaire statique s en
    // sortirait très bien.
    expect(hoteServeur).toBe('localhost');
    expect(hoteServeur).not.toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });

  siBinaires()('`localhost` résout vers un bouclage, et le banc y répond', async () => {
    const adresses = await lookup('localhost', { all: true });
    expect(adresses.length, 'localhost ne résout nulle part').toBeGreaterThan(0);
    for (const a of adresses) {
      expect(['127.0.0.1', '::1'], `localhost résout vers ${a.address}`).toContain(a.address);
    }
  });
});

const USER = 'u-m3b26';
const CLE = `${USER}/rush/rush`;

async function extraire() {
  const { extraireRush } = await import('@/lib/autopilot/analyse/extraction');
  objets[`media/${CLE}`] = { taille: statSync(FICHIERS.rush).size };
  return extraireRush({ bucket: 'media', cleObjet: CLE, userId: USER, analysisId: 'a-m3b26' });
}

describe('M3-B2.6 — l extraction produit encore de VRAIES JPEG, depuis un nom d hôte', () => {
  siBinaires()('huit images valides, aucune ligne de journal', async () => {
    // `FFMPEG_PATH` n'est PAS posé : c'est `cheminFfmpeg()` qui résout,
    // exactement comme en production. C'est ce qui fait de ce test la
    // non-régression du lot, et pas un test de plus sur un faux binaire.
    const avant = process.env.FFMPEG_PATH;
    delete process.env.FFMPEG_PATH;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = await extraire();

      expect(r.ok).toBe(true);
      expect(r.motif).toBe(null);
      expect(r.technique.sonde).toBe('ffprobe');
      expect(r.technique.vignettesAttendues).toBe(8);
      expect(r.technique.vignettesProduites).toBe(8);
      expect(r.technique.vignettesEchouees).toBe(0);
      expect(r.vignettes.length).toBe(8);

      // De VRAIES images : signature `FF D8 FF` et marqueur de fin `FF D9`.
      // Une JPEG tronquée passerait l'en-tête seul.
      expect(ecritures.length).toBe(8);
      for (const e of ecritures) {
        expect([e.corps[0], e.corps[1], e.corps[2]], e.cle).toEqual([0xff, 0xd8, 0xff]);
        expect([e.corps[e.corps.length - 2], e.corps[e.corps.length - 1]], e.cle)
          .toEqual([0xff, 0xd9]);
        expect(e.corps.length, e.cle).toBeGreaterThan(512);
      }

      expect(warn.mock.calls.length, 'un succès ne journalise rien').toBe(0);
    } finally {
      warn.mockRestore();
      if (avant === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = avant;
    }
  }, 180_000);

  /**
   * LE MOTIF DU LOT, OBSERVÉ — là où il est observable.
   *
   * ⚠️ Ne s'arme que sous Linux, avec les deux binaires présents. Sur macOS
   * le paquet livre un Mach-O qui résout les noms par libSystem : il n'y a
   * pas de NSS, donc pas de segfault.
   *
   * Il est VERT avant comme après le lot : il ne juge pas la correction, il
   * documente le fait qui la justifie. Le jour où une version de
   * ffmpeg-static cessera de segfauter, il rougira — et ce sera le bon
   * signal : la priorité pourra alors être rediscutée.
   */
  const siSegfaultObservable = () => (
    binairesDispo && statiqueDispo && systemeReel !== null && process.platform === 'linux'
      ? it : it.skip
  );

  siSegfaultObservable()('le binaire STATIQUE, lui, meurt en SIGSEGV sur un nom d hôte', async () => {
    const avant = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = STATIQUE_REEL;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = await extraire();
      const appel = warn.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('aucune vignette produite'),
      );
      const cause = String(((appel?.[1] ?? {}) as Record<string, unknown>).cause ?? '');

      // L'étiquette vient de M3-B2.4 : sans ce lot-là, ce diagnostic serait
      // illisible (`code=aucun `), et personne n'aurait pu nommer la panne.
      expect(cause, `cause relevée : ${JSON.stringify(cause)}`).toContain('signal=SIGSEGV');
      expect(r.technique.vignettesProduites).toBe(0);
      // La MESURE, elle, a réussi : c'est ffprobe (dynamique) qui l'a faite.
      expect(r.ok).toBe(true);
      expect(r.technique.sonde).toBe('ffprobe');
    } finally {
      warn.mockRestore();
      if (avant === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = avant;
    }
  }, 180_000);

  /**
   * Le contrôle SANS AUCUN MOCK : le vrai `accessSync`, le vrai disque.
   *
   * C'est le témoin qui empêche le faux `accessSync` des groupes 1 à 5 de
   * dériver de la réalité. Il ne s'arme que là où la machine a réellement les
   * deux binaires — sur la CI actuelle, aucun des deux, donc ignoré ; c'est
   * pour cette raison exacte que l'assertion de source existe.
   */
  const siLesDeux = () => (systemeReel !== null && statiqueDispo ? it : it.skip);

  siLesDeux()('sur le VRAI disque, `cheminFfmpeg()` rend le binaire système', () => {
    const avant = process.env.FFMPEG_PATH;
    delete process.env.FFMPEG_PATH;
    try {
      const resolu = cheminFfmpeg();
      expect(
        resolu,
        `système disponible : ${systemeReel}, embarqué : ${STATIQUE_REEL}`,
      ).toBe(systemeReel);
      expect(resolu).not.toContain('ffmpeg-static');
    } finally {
      if (avant === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = avant;
    }
  });
});
