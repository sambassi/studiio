// @vitest-environment node
/**
 * M3-B2 — La preuve « gros fichiers » : un rush n'est JAMAIS chargé en entier.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `src/lib/storage/fetch-media.ts` porte déjà, en production, exactement ce
 * qu'il ne faut plus faire : `downloadMediaToBuffer` lit l'objet ENTIER en
 * mémoire (`Buffer.concat` d'un flux MinIO, ou `res.arrayBuffer()`), et
 * `downloadMediaToFile` — dont le commentaire promet « avoids holding entire
 * file in memory » — appelle en réalité le premier avant d'écrire le buffer
 * sur disque. Un rush de tournage pèse couramment plusieurs centaines de
 * mégaoctets ; le CAHIER DES CHARGES du lot dit que le chemin d'analyse ne
 * doit ni le bufferiser, ni le recopier.
 *
 * Une promesse pareille ne tient pas dans une revue de code : elle se re-perd
 * au premier « juste pour débloquer ». Ce fichier la transforme en test.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DEUX PREUVES, QUI NE PROUVENT PAS LA MÊME CHOSE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. STATIQUE — on lit le source des modules du chemin M3-B2 et on refuse
 *    d'y trouver les matérialisations connues (`arrayBuffer`, `Buffer.concat`,
 *    `downloadMediaTo*`, `blob()`), plus une LISTE BLANCHE D'IMPORTS. La
 *    liste blanche est ce qui rend la garantie durable : elle échoue le jour
 *    où quelqu'un ajoute `@/lib/storage/fetch-media` ou `@ffmpeg/ffmpeg`,
 *    sans qu'il ait fallu prévoir le nom du paquet. Un simple grep de mots,
 *    lui, ne connaît que ce qu'on lui a appris.
 *
 * 2. DYNAMIQUE — un vrai serveur HTTP local sert une fixture de quelques
 *    kilo-octets en honorant `Range`, COMPTE les octets réellement sortis et
 *    ENREGISTRE les en-têtes reçus. On y fait lire une tête et une queue —
 *    le motif exact d'une sonde d'atome `moov` — et on mesure.
 *
 * Ce que la preuve dynamique établit, précisément : que l'instrument de
 * mesure fonctionne, qu'une lecture par tranches ne transfère que les
 * tranches demandées, et qu'un consommateur qui ignore `Range` est
 * DÉTECTÉ par ce même compteur (le témoin du bloc « contrôle » — sans lui,
 * un compteur toujours à zéro « prouverait » n'importe quoi).
 *
 * Ce qu'elle n'établit PAS : que le moteur réel d'extraction lit par
 * tranches. Aucun test ne peut le dire tant que le moteur ne traverse pas ce
 * serveur. C'est le rôle de la preuve statique, et c'est la raison pour
 * laquelle les deux sont là.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE FICHIER EST ÉCRIT AVANT LES MODULES QU'IL SURVEILLE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le moteur (`analyse/extraction.ts`) et la route sont produits en parallèle,
 * dans d'autres arbres de travail. Ici, ils n'existent pas encore.
 *
 * Le bloc statique ne fait donc PAS semblant de passer : un test de garde,
 * qui tourne toujours, exige la présence de chaque module attendu et ÉCHOUE
 * tant qu'ils manquent, en les nommant. Les assertions de détail sont, elles,
 * mises de côté par `skipIf` — pour n'avoir qu'un seul échec lisible au lieu
 * de dix identiques. La garde est ce qui rend impossible le pire scénario :
 * un fichier renommé, des tests silencieusement sautés pour toujours, et
 * personne pour s'en apercevoir.
 *
 * Le bloc dynamique et le bloc « aucune migration », eux, ne dépendent de
 * rien et tournent dès maintenant.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI `environment: node`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le projet tourne en `jsdom` par défaut. On ouvre ici de vraies sockets et
 * on lit des en-têtes HTTP bruts : la pile `fetch` de jsdom n'est pas ce
 * qu'on veut mesurer. `node:http` des deux côtés, client compris, pour que
 * le compteur d'octets ne dépende d'aucune couche intermédiaire.
 *
 * La fixture pèse 48 Ko et vit en MÉMOIRE : rien n'est écrit sur le disque.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// ───────────────────────────────────────────────────────────────────────────
// Le chemin M3-B2, tel qu'il est attendu
// ───────────────────────────────────────────────────────────────────────────

/**
 * Les modules que ce lot ajoute, et les seuls.
 *
 * `extraction.ts` est le moteur : clé d'objet → durée, technique, vignettes.
 * La route est son unique déclencheur HTTP.
 */
const MODULE_EXTRACTION = 'src/lib/autopilot/analyse/extraction.ts';
const MODULE_ROUTE = 'src/app/api/autopilot/rushes/[id]/analyse/route.ts';
const MODULES_M3B2 = [MODULE_EXTRACTION, MODULE_ROUTE];

const chemin = (relatif: string) => join(process.cwd(), relatif);
const present = (relatif: string) => existsSync(chemin(relatif));
const source = (relatif: string) => readFileSync(chemin(relatif), 'utf-8');

/**
 * Le code, sans ses commentaires.
 *
 * Reprise de la technique de `autopilote-m3b1-analyse.test.ts`. Un commentaire
 * a le droit de dire « on n'appelle PAS `downloadMediaToBuffer` » — c'est même
 * souhaitable. Ce qui doit être absent, c'est l'appel.
 */
const sansCommentaires = (code: string) => code
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

const modulesManquants = MODULES_M3B2.filter((m) => !present(m));
const cheminComplet = modulesManquants.length === 0;

// ───────────────────────────────────────────────────────────────────────────
describe('Le chemin M3-B2 est bien celui qu on surveille', () => {
  /**
   * La garde. Elle échoue AVANT l'intégration, et c'est le signal voulu :
   * les assertions de détail ci-dessous sont mises de côté tant que les
   * modules manquent, et sans cette garde ce fichier deviendrait vert en ne
   * vérifiant rien.
   */
  it('les deux modules du lot existent', () => {
    expect(
      modulesManquants,
      'modules M3-B2 absents — les preuves de détail sont mises de côté tant '
      + 'qu ils manquent ; si un module a été renommé, corriger MODULES_M3B2',
    ).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe.skipIf(!cheminComplet)('Preuve statique — rien ne matérialise le rush', () => {
  /**
   * Les matérialisations connues.
   *
   * Chacune a une raison d'être là :
   *   `arrayBuffer` / `blob` / `bytes`  — la réponse entière en RAM.
   *   `Buffer.concat`                  — le motif d'accumulation d'un flux,
   *                                      exactement celui de
   *                                      `downloadFromMinioInternal`.
   *   `downloadMediaTo*`               — les deux helpers existants, dont le
   *                                      second appelle le premier.
   *   `createWriteStream` / `writeFile`— la copie disque complète. Les
   *                                      vignettes, elles, sont écrites par
   *                                      ffmpeg lui-même, pas par du JS.
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
  ];

  it.each(MODULES_M3B2)('%s ne matérialise le rush par aucun des moyens connus', (m) => {
    const code = sansCommentaires(source(m));
    for (const [nom, motif] of MATERIALISATIONS) {
      expect(code, `${m} : ${nom}`).not.toMatch(motif);
    }
  });

  /**
   * La liste blanche d'imports.
   *
   * Volontairement GÉNÉREUSE sur ce qui est légitime pour une extraction
   * locale — ffmpeg est un processus, il lui faut `child_process`, un chemin,
   * un dossier temporaire, et de quoi relire les VIGNETTES qu'il a écrites
   * (quelques kilo-octets chacune, ce n'est pas le rush). Elle est en
   * revanche FERMÉE : tout import hors de la liste fait échouer le test, et
   * oblige quelqu'un à regarder. C'est le seul mécanisme qui attrape un
   * paquet dont personne n'avait prévu le nom.
   */
  const PREFIXES_AUTORISES = [
    './', '../',
    '@/lib/autopilot/',
    // La résolution des binaires ffmpeg/ffprobe. AJOUTÉ EXPLICITEMENT, comme
    // la règle l'exige : le module ne fait que rendre un chemin d'exécutable,
    // il ne lit ni n'écrit aucun octet de rush.
    '@/lib/ffmpeg/binaires',
    '@/lib/storage/buckets',
    '@/lib/storage/minio-client',
    '@/lib/storage/verifier-objet',
    '@/lib/db/supabase',
    '@/lib/auth/config',
    '@/lib/service-alerts',
    'next/server',
    'node:child_process', 'child_process',
    'node:path', 'path',
    'node:os', 'os',
    'node:fs', 'node:fs/promises', 'fs', 'fs/promises',
    'node:stream', 'node:stream/promises', 'stream',
    'node:crypto', 'crypto',
    'node:timers/promises',
    'node:buffer',
    'ffmpeg-static',
    'zod',
  ];

  /**
   * Les imports refusés quoi qu'il arrive.
   *
   * `fetch-media` porte les deux helpers pleine-mémoire. `@ffmpeg/*` est la
   * version WASM : elle travaille dans un système de fichiers virtuel EN RAM,
   * c'est-à-dire le rush entier en mémoire, par construction. `minio` en
   * direct court-circuiterait la couture `minio-client.ts` — donc les tests.
   */
  const IMPORTS_REFUSES = [
    '@/lib/storage/fetch-media',
    '@ffmpeg/ffmpeg',
    '@ffmpeg/util',
    'minio',
    'replicate',
    '@anthropic-ai/sdk',
    'openai',
  ];

  const importsDe = (code: string) => [...new Set([
    ...[...code.matchAll(/from\s+'([^']+)'/g)].map((x) => x[1]),
    ...[...code.matchAll(/require\s*\(\s*'([^']+)'\s*\)/g)].map((x) => x[1]),
    ...[...code.matchAll(/import\s*\(\s*'([^']+)'\s*\)/g)].map((x) => x[1]),
  ])].sort();

  it.each(MODULES_M3B2)('%s n importe rien hors de la liste blanche', (m) => {
    const importes = importsDe(sansCommentaires(source(m)));
    const inattendus = importes.filter(
      (spec) => !PREFIXES_AUTORISES.some((p) => spec === p || spec.startsWith(p)),
    );
    expect(
      inattendus,
      `${m} : import hors liste blanche. Si l import est légitime, l AJOUTER `
      + 'explicitement à PREFIXES_AUTORISES — jamais élargir la règle.',
    ).toEqual([]);
  });

  it.each(MODULES_M3B2)('%s n importe aucun module interdit', (m) => {
    const importes = importsDe(sansCommentaires(source(m)));
    for (const refuse of IMPORTS_REFUSES) {
      expect(importes, `${m} : ${refuse}`).not.toContain(refuse);
    }
  });

  /**
   * Si MinIO est sollicité, ce doit être par la lecture PARTIELLE.
   *
   * `getObject` rend le flux de l'objet entier. Le piper vers ffmpeg ne
   * bufferise rien, mais transfère tout de même les 400 Mo ; `getPartialObject`
   * est la seule API qui prend un décalage et une longueur. La règle est donc :
   * pas de `getObject` nu sur ce chemin.
   */
  it.each(MODULES_M3B2)('%s ne lit pas l objet entier via getObject', (m) => {
    const code = sansCommentaires(source(m));
    expect(code, `${m} : getObject nu — utiliser getPartialObject`)
      .not.toMatch(/(?<!Partial)\bgetObject\s*\(/);
  });

  /**
   * Ni IA, ni crédit, ni rendu, ni publication.
   *
   * M3-B2 est l'étape `extraction` : ffmpeg, en local. La lecture visuelle
   * (M3-B4) et la transcription (M3-B5) viendront avec leurs propres lots et
   * leurs propres fournisseurs. Rien ici ne doit débiter quoi que ce soit.
   */
  const CONCEPTS_INTERDITS = [
    'debiter_credits', 'credit_transactions', 'deductCredits',
    'rendus', 'scheduled_posts',
    'anthropic', 'replicate', 'ANTHROPIC_API_KEY', 'REPLICATE_API_TOKEN',
  ];

  it.each(MODULES_M3B2)('%s ne touche ni IA, ni débit, ni rendu, ni publication', (m) => {
    const code = sansCommentaires(source(m));
    for (const interdit of CONCEPTS_INTERDITS) {
      // `FOURNISSEURS_ANALYSE` a le droit de NOMMER les moteurs : c'est son
      // travail. Ce qui est refusé, c'est un moyen de leur parler — donc le
      // nom en minuscules dans du code, jamais la constante en majuscules.
      expect(code, `${m} / ${interdit}`).not.toContain(interdit);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Preuve dynamique — un vrai serveur, un vrai compteur
// ───────────────────────────────────────────────────────────────────────────

/** 48 Ko en mémoire. Rien n'est écrit sur le disque, à aucun moment. */
const TAILLE_FIXTURE = 48 * 1024;

const FIXTURE = (() => {
  const b = Buffer.alloc(TAILLE_FIXTURE);
  for (let i = 0; i < TAILLE_FIXTURE; i += 1) b[i] = i % 251;
  // La forme d'un MP4 dont l'atome de métadonnées est à la FIN : exactement
  // le cas décrit dans CLAUDE.md, celui qui oblige un lecteur à sauter en
  // queue de fichier — et donc à demander une tranche.
  b.write('ftyp', 0, 'ascii');
  b.write('moovFINDUFICHIER', TAILLE_FIXTURE - 16, 'ascii');
  return b;
})();

let serveur: http.Server;
let base: string;
let octetsServis = 0;
let rangesRecus: string[] = [];
let requetesVues: Array<{ methode: string; range: string | null }> = [];

beforeAll(async () => {
  serveur = http.createServer((req, res) => {
    const range = typeof req.headers.range === 'string' ? req.headers.range : null;
    requetesVues.push({ methode: req.method ?? '', range });
    if (range) rangesRecus.push(range);

    const communs = {
      'Accept-Ranges': 'bytes',
      'Content-Type': 'video/mp4',
    };

    // Un HEAD annonce, il ne sert rien. C'est ce que fait la sonde du
    // Calendrier avant de décider si une vidéo est jouable.
    if (req.method === 'HEAD') {
      res.writeHead(200, { ...communs, 'Content-Length': String(FIXTURE.length) });
      res.end();
      return;
    }

    if (!range) {
      // Le consommateur naïf : il prend tout. Le compteur doit le voir.
      octetsServis += FIXTURE.length;
      res.writeHead(200, { ...communs, 'Content-Length': String(FIXTURE.length) });
      res.end(FIXTURE);
      return;
    }

    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    const refuser = () => {
      res.writeHead(416, { ...communs, 'Content-Range': `bytes */${FIXTURE.length}` });
      res.end();
    };
    if (!m || (m[1] === '' && m[2] === '')) { refuser(); return; }

    let debut: number;
    let fin: number;
    if (m[1] === '') {
      // `bytes=-N` : les N DERNIERS octets. La forme qu'emploie un lecteur
      // qui cherche un `moov` en queue sans connaître la taille exacte.
      const n = Number(m[2]);
      if (!Number.isFinite(n) || n <= 0) { refuser(); return; }
      debut = Math.max(0, FIXTURE.length - n);
      fin = FIXTURE.length - 1;
    } else {
      debut = Number(m[1]);
      fin = m[2] === '' ? FIXTURE.length - 1 : Number(m[2]);
    }

    if (!Number.isFinite(debut) || !Number.isFinite(fin)) { refuser(); return; }
    if (debut >= FIXTURE.length || debut > fin) { refuser(); return; }
    fin = Math.min(fin, FIXTURE.length - 1);

    const tranche = FIXTURE.subarray(debut, fin + 1);
    octetsServis += tranche.length;
    res.writeHead(206, {
      ...communs,
      'Content-Range': `bytes ${debut}-${fin}/${FIXTURE.length}`,
      'Content-Length': String(tranche.length),
    });
    res.end(tranche);
  });

  await new Promise<void>((resoudre) => {
    serveur.listen(0, '127.0.0.1', () => resoudre());
  });
  const adresse = serveur.address() as AddressInfo;
  base = `http://127.0.0.1:${adresse.port}`;
});

afterAll(async () => {
  // Un serveur laissé ouvert retient le processus de test : Vitest attendrait
  // le délai maximal avant de rendre la main, et l'échec ressemblerait à un
  // test lent plutôt qu'à une fuite.
  await new Promise<void>((resoudre) => { serveur.close(() => resoudre()); });
});

beforeEach(() => {
  octetsServis = 0;
  rangesRecus = [];
  requetesVues = [];
});

interface Reponse {
  statut: number;
  entetes: http.IncomingHttpHeaders;
  corps: Buffer;
}

/**
 * Un client HTTP minimal, en `node:http`.
 *
 * Pas de `fetch` : on veut compter des octets sans qu'une couche
 * intermédiaire décide seule d'un `Range`, d'un cache ou d'une reprise.
 */
function demander(
  chemin_: string, options: { methode?: string; range?: string } = {},
): Promise<Reponse> {
  return new Promise((resoudre, rejeter) => {
    const req = http.request(
      `${base}${chemin_}`,
      {
        method: options.methode ?? 'GET',
        headers: options.range ? { Range: options.range } : {},
      },
      (res) => {
        const morceaux: Buffer[] = [];
        res.on('data', (c: Buffer) => morceaux.push(c));
        res.on('end', () => resoudre({
          statut: res.statusCode ?? 0,
          entetes: res.headers,
          corps: Buffer.concat(morceaux),
        }));
      },
    );
    req.on('error', rejeter);
    req.end();
  });
}

// ───────────────────────────────────────────────────────────────────────────
describe('Preuve dynamique — lire par tranches ne télécharge pas le fichier', () => {
  it('un HEAD annonce la taille et le support des tranches, sans servir un octet', async () => {
    const r = await demander('/rush.mp4', { methode: 'HEAD' });
    expect(r.statut).toBe(200);
    expect(r.entetes['accept-ranges']).toBe('bytes');
    expect(Number(r.entetes['content-length'])).toBe(TAILLE_FIXTURE);
    expect(r.corps.length).toBe(0);
    expect(octetsServis).toBe(0);
  });

  /**
   * LE TÉMOIN.
   *
   * Sans lui, « 0,4 % du fichier a été servi » ne prouverait rien : un
   * compteur qui ne compte jamais rien affiche toujours zéro. Ce test montre
   * que l'instrument voit un téléchargement complet quand il y en a un.
   */
  it('témoin : un consommateur qui ignore Range prend TOUT, et le compteur le voit', async () => {
    const r = await demander('/rush.mp4');
    expect(r.statut).toBe(200);
    expect(r.corps.length).toBe(TAILLE_FIXTURE);
    expect(octetsServis).toBe(TAILLE_FIXTURE);
    expect(rangesRecus).toEqual([]);
  });

  it('une sonde tête + queue transfère moins de 5 % du fichier', async () => {
    // 1 Ko de chaque côté : la taille d'un en-tête d'atome, pas d'un fichier.
    // Le POURCENTAGE ci-dessous est écrasé par la petitesse de la fixture —
    // les mêmes 2 Ko sur un rush de 400 Mo font 0,0005 %. Ce qui se vérifie
    // ici, c'est que le coût de la sonde ne dépend PAS de la taille du
    // fichier : il vaut exactement `2 × TRANCHE`, et l'assertion en octets
    // absolus est la plus parlante des deux.
    const TRANCHE = 1024;

    const tete = await demander('/rush.mp4', { range: `bytes=0-${TRANCHE - 1}` });
    const queue = await demander('/rush.mp4', { range: `bytes=-${TRANCHE}` });

    expect(tete.statut).toBe(206);
    expect(queue.statut).toBe(206);

    // Le serveur a bien vu DEUX demandes de tranche, et rien d'autre.
    expect(rangesRecus).toEqual([`bytes=0-${TRANCHE - 1}`, `bytes=-${TRANCHE}`]);
    expect(requetesVues.every((q) => q.range !== null)).toBe(true);

    expect(octetsServis).toBe(2 * TRANCHE);
    expect(octetsServis / TAILLE_FIXTURE).toBeLessThan(0.05);

    // Et les octets rendus sont les BONS : une preuve d'économie qui rendrait
    // les mauvais octets ne serait qu'une preuve de fichier tronqué.
    expect(tete.corps.subarray(0, 4).toString('ascii')).toBe('ftyp');
    expect(queue.corps.subarray(-16).toString('ascii')).toBe('moovFINDUFICHIER');
    expect(tete.corps.equals(FIXTURE.subarray(0, TRANCHE))).toBe(true);
    expect(queue.corps.equals(FIXTURE.subarray(TAILLE_FIXTURE - TRANCHE))).toBe(true);
  });

  it('le 206 porte un Content-Range exact', async () => {
    const r = await demander('/rush.mp4', { range: 'bytes=1024-2047' });
    expect(r.statut).toBe(206);
    expect(r.entetes['content-range']).toBe(`bytes 1024-2047/${TAILLE_FIXTURE}`);
    expect(Number(r.entetes['content-length'])).toBe(1024);
    expect(r.corps.length).toBe(1024);
    expect(r.corps.equals(FIXTURE.subarray(1024, 2048))).toBe(true);
    expect(octetsServis).toBe(1024);
  });

  it('une tranche ouverte à droite s arrête à la fin du fichier', async () => {
    const debut = TAILLE_FIXTURE - 512;
    const r = await demander('/rush.mp4', { range: `bytes=${debut}-` });
    expect(r.statut).toBe(206);
    expect(r.entetes['content-range'])
      .toBe(`bytes ${debut}-${TAILLE_FIXTURE - 1}/${TAILLE_FIXTURE}`);
    expect(octetsServis).toBe(512);
  });

  it('une tranche aberrante est refusée en 416, sans servir un octet', async () => {
    for (const range of ['bytes=999999-1000000', 'bytes=20-10', 'octets=0-10', 'bytes=-']) {
      octetsServis = 0;
      // eslint-disable-next-line no-await-in-loop
      const r = await demander('/rush.mp4', { range });
      expect(r.statut, range).toBe(416);
      expect(r.entetes['content-range'], range).toBe(`bytes */${TAILLE_FIXTURE}`);
      expect(r.corps.length, range).toBe(0);
      expect(octetsServis, range).toBe(0);
    }
  });

  it('une lecture complète PAR TRANCHES reste une lecture complète — l économie vient du CIBLAGE', async () => {
    // Une nuance qui compte : lire par tranches n'économise rien si on
    // demande toutes les tranches. Ce que M3-B2 doit faire, c'est en demander
    // PEU. Le test le dit explicitement, pour qu'on ne confonde pas les deux.
    const PAS = 8 * 1024;
    for (let debut = 0; debut < TAILLE_FIXTURE; debut += PAS) {
      // eslint-disable-next-line no-await-in-loop
      await demander('/rush.mp4', { range: `bytes=${debut}-${debut + PAS - 1}` });
    }
    expect(rangesRecus).toHaveLength(TAILLE_FIXTURE / PAS);
    expect(octetsServis).toBe(TAILLE_FIXTURE);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('M3-B2 n ajoute AUCUNE migration', () => {
  /**
   * Le socle de données a été posé par M3-B1, entièrement. Ce lot branche un
   * moteur dessus : il n'a aucune raison de toucher au schéma, et le dire une
   * fois dans une PR ne survit pas au lot suivant.
   *
   * La règle est formulée sur `rush_analyses` plutôt que sur une date ou un
   * décompte de fichiers : un lot sans rapport a le droit d'ajouter sa
   * migration à lui sans faire rougir ce test.
   */
  const fichiersMigration = readdirSync(chemin('migrations')).filter((f) => f.endsWith('.sql'));

  /**
   * ⚠️ DEUX MIGRATIONS, ET LA SECONDE EST NOMMÉE.
   *
   * M3-C ajoute `rush_candidate_sets`, une table DÉRIVÉE des analyses. Sa clé
   * étrangère composite `(analysis_id, user_id)` exige un index unique
   * `(id, user_id)` sur `rush_analyses` — sans lui, PostgreSQL refuse la
   * contrainte, et rien en base n'empêcherait une génération d'annoncer un
   * propriétaire différent de celui de son analyse.
   *
   * C'est exactement le geste que M3-B1 avait dû faire sur `rushes`, une
   * table de M3-A, et pour la même raison.
   *
   * La liste reste FERMÉE et écrite en toutes lettres : un troisième fichier
   * qui parlerait de `rush_analyses` ferait rougir ce test, et c'est tout
   * l'intérêt de le maintenir.
   */
  /**
   * ⚠️ LE CODE, PAS LES COMMENTAIRES — ET C'EST M3-D2 QUI L'EXIGE.
   *
   * La règle porte sur ce qu'une migration FAIT à `rush_analyses`. La
   * migration de M3-D2 crée `rush_transcriptions` sans toucher aux analyses,
   * mais son en-tête explique POURQUOI elle ne se pose pas dans
   * `rush_analyses.parole` — et cette explication est précisément ce qui
   * empêchera quelqu'un de refaire le mauvais choix dans six mois.
   *
   * Chercher le nom dans le texte brut punirait donc le commentaire utile
   * tout en laissant passer un `alter table` déguisé sous un autre nom. Le
   * contrôle porte sur le SQL sans ses commentaires — le test frère fait déjà
   * exactement ce filtrage, pour exactement cette raison.
   */
  const sqlSansCommentaires = (f: string) => readFileSync(
    chemin(join('migrations', f)), 'utf-8',
  ).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

  it('seules les migrations M3-B1 et M3-C TOUCHENT `rush_analyses`', () => {
    const parlantes = fichiersMigration.filter(
      (f) => sqlSansCommentaires(f).includes('rush_analyses'),
    );
    expect(parlantes).toEqual([
      '2026-09-01-rush-analyses.sql',
      '2026-09-02-rush-candidate-sets.sql',
    ]);
  });

  /**
   * L'exception de M3-C n'est pas un chèque en blanc : ce qu'elle a le droit
   * de faire à `rush_analyses` est un index, et rien d'autre.
   */
  it('M3-C n ajoute qu un index à `rush_analyses`, sans rien détruire', () => {
    const sql = readFileSync(
      chemin(join('migrations', '2026-09-02-rush-candidate-sets.sql')), 'utf-8',
    ).toLowerCase();

    // Le seul contact avec la table existante : l'index unique que la clé
    // étrangère composite à TROIS colonnes exige.
    expect(sql).toMatch(
      /create\s+unique\s+index\s+if\s+not\s+exists\s+rush_analyses_id_rush_user_key\s+on\s+public\.rush_analyses/,
    );
    // Et rien d'autre. Les deux seuls contacts autorisés avec la table
    // existante sont l'index (`on`) et la référence de la clé étrangère
    // (`references`) — jamais un `alter table`, qui pourrait tout faire.
    const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect((code.match(/on public\.rush_analyses/g) ?? []).length).toBe(1);
    expect((code.match(/references public\.rush_analyses/g) ?? []).length).toBe(1);
    expect(code, 'aucun ALTER sur rush_analyses').not.toMatch(/alter table[^;]*rush_analyses/);
    // Et aucun geste destructif, nulle part.
    for (const interdit of [
      'drop table', 'drop column', 'drop index', 'truncate', 'delete from',
      'alter table public.rush_analyses drop', 'alter column',
    ]) {
      expect(sql, `M3-C ne doit pas contenir « ${interdit} »`).not.toContain(interdit);
    }
  });

  /**
   * L'exception de M3-D2 n'est pas un chèque en blanc non plus : elle a le
   * droit de CRÉER sa table, et de RÉFÉRENCER `rushes`. Rien d'autre.
   *
   * En particulier, elle ne pose AUCUN index sur une table existante — la clé
   * étrangère `(rush_id, user_id)` s'appuie sur `rushes_id_user_key`, que
   * M3-B1 avait déjà créé pour lui-même.
   */
  it('M3-D2 ne touche à AUCUNE table existante, et ne détruit rien', () => {
    const fichier = '2026-09-03-rush-transcriptions.sql';
    expect(fichiersMigration).toContain(fichier);
    const code = sqlSansCommentaires(fichier).toLowerCase();

    // Elle crée sa table, et c'est son seul objet.
    expect(code).toMatch(/create table if not exists public\.rush_transcriptions/);

    // Le SEUL contact avec une table existante : la référence de la clé
    // étrangère composite. Aucun index, aucun `alter`.
    expect((code.match(/references public\.rushes/g) ?? []).length).toBe(1);
    expect((code.match(/on public\.rushes\b/g) ?? []).length).toBe(0);
    expect(code, 'aucun ALTER, sur quoi que ce soit').not.toMatch(/alter\s+table/);

    // Les analyses et les candidats sont hors de son périmètre.
    expect(code).not.toContain('rush_analyses');
    expect(code).not.toContain('rush_candidate_sets');

    // Et aucun geste destructif, nulle part.
    for (const interdit of [
      'drop table', 'drop column', 'drop index', 'truncate', 'delete from', 'alter column',
    ]) {
      expect(code, `M3-D2 ne doit pas contenir « ${interdit} »`).not.toContain(interdit);
    }

    // Aucun droit ouvert au rôle anonyme de PostgREST.
    expect(code).not.toMatch(/\bgrant\b/);
  });

  /**
   * La règle porte sur la DATE du fichier, pas sur son vocabulaire.
   *
   * Une première rédaction cherchait « ffmpeg » dans tout le dossier. Elle
   * échouait sur la migration de M3-B1, dont un COMMENTAIRE explique
   * légitimement que l'étape `extraction` tournera en local. Un commentaire a
   * le droit d'annoncer la suite ; ce qui est interdit, c'est un fichier de
   * migration postérieur à M3-B1 qui toucherait aux rushes ou aux analyses.
   */
  it('aucune migration postérieure à M3-B1 ne touche aux rushes ni aux analyses', () => {
    // M3-C est l'exception NOMMÉE, et le test juste au-dessus borne ce
    // qu'elle a le droit d'y faire. L'exclure ici sans cette seconde garde
    // reviendrait à retirer la règle.
    // M3-C et M3-D2 sont les exceptions NOMMÉES, et chacune a sa propre garde
    // juste au-dessus / au-dessous, qui borne ce qu'elle a le droit de faire.
    // Les exclure ici sans ces gardes reviendrait à retirer la règle.
    const AUTORISEES = new Set([
      '2026-09-02-rush-candidate-sets.sql',
      '2026-09-03-rush-transcriptions.sql',
    ]);
    const posterieures = fichiersMigration.filter(
      (f) => f > '2026-09-01-rush-analyses.sql' && !AUTORISEES.has(f),
    );
    const fautives = posterieures.filter((f) => {
      const sql = readFileSync(chemin(join('migrations', f)), 'utf-8').toLowerCase();
      return sql.includes('rush') || sql.includes('analyse');
    });
    expect(fautives).toEqual([]);
  });
});
