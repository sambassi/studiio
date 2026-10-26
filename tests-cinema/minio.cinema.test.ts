/**
 * CINEMA IA — LOT 5 : le stockage d'objets contre un VRAI serveur MinIO.
 *
 * Le SDK est le vrai (`minio@8.0.7`, celui de la production), le serveur est
 * un MinIO JETABLE lance sur 127.0.0.1, dans un dossier temporaire, avec des
 * identifiants fictifs. Il n'a aucun lien avec le MinIO de production : rien
 * ici ne sait son adresse, et rien n'y est ecrit.
 *
 *   npm run test:cinema
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import { mkdtemp, rm, writeFile, readFile, stat, readdir } from 'fs/promises';
import { createServer } from 'net';
import { tmpdir } from 'os';
import path from 'path';
import http from 'http';
import { Client } from 'minio';
import { clientMinio, lecteurMinio } from '@/lib/storage/minio-client';
import { adapterClientMinio, objetsMinio, type StockageObjets } from '@/lib/cinema/stockage/objets';
import { BUCKET_CINEMA, cleScene, cleVoix, cleMedia, cleFilmMp4 } from '@/lib/cinema/stockage/cles';
import { supprimerFilm } from '@/lib/cinema/stockage/suppression';
import { depotFilmsMemoire } from '@/lib/cinema/stockage/depot-films';
import { depotTravauxMemoire } from '@/lib/cinema/travaux/depot-travaux';
import type { Film } from '@/lib/cinema/types';

const A = 'abcdef01-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const IDENTIFIANT = 'studiio-test';
const SECRET = 'secret-fictif-12345';

let proc: ChildProcess;
let dossier: string;
let port: number;
let admin: Client;
let objets: StockageObjets;
const env0 = { ...process.env };

const portLibre = () => new Promise<number>((ok, ko) => {
  const s = createServer(); s.once('error', ko);
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)); });
});
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  dossier = await mkdtemp(path.join(tmpdir(), 'cinema-minio-'));
  port = await portLibre();
  const console_ = await portLibre();
  proc = spawn('minio', ['server', path.join(dossier, 'data'), '--address', `127.0.0.1:${port}`, '--console-address', `127.0.0.1:${console_}`, '--quiet'], {
    env: { PATH: process.env.PATH ?? '', HOME: dossier, MINIO_ROOT_USER: IDENTIFIANT, MINIO_ROOT_PASSWORD: SECRET } as unknown as NodeJS.ProcessEnv,
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    const vivant = await new Promise<boolean>((ok) => {
      http.get({ host: '127.0.0.1', port, path: '/minio/health/live', timeout: 500 }, (r) => { r.resume(); ok(r.statusCode === 200); }).on('error', () => ok(false));
    });
    if (vivant) break;
    await pause(150);
  }
  admin = new Client({ endPoint: '127.0.0.1', port, useSSL: false, accessKey: IDENTIFIANT, secretKey: SECRET });
  await admin.makeBucket(BUCKET_CINEMA);
  // La config d'environnement que lit le client EXISTANT (`lib/storage/minio-client`).
  Object.assign(process.env, { MINIO_ENDPOINT: '127.0.0.1', MINIO_PORT: String(port), MINIO_USE_SSL: 'false', MINIO_ACCESS_KEY: IDENTIFIANT, MINIO_SECRET_KEY: SECRET });
  // Le client du PROJET (memes variables MINIO_*), pas un client ad hoc.
  objets = objetsMinio(adapterClientMinio(clientMinio(), lecteurMinio()));
}, 60_000);

afterAll(async () => {
  proc?.kill('SIGTERM');
  await pause(300);
  for (const k of Object.keys(process.env)) if (!(k in env0)) delete process.env[k];
  Object.assign(process.env, env0);
  await rm(dossier, { recursive: true, force: true });
});

describe('MinIO reel (jetable) — objetsMinio', () => {
  it('depose (octets et fichier en flux), retrouve, lit une plage, telecharge, supprime', async () => {
    const cle = cleScene(A, 'film-m-1', 's1', 'deadbeef')!;
    expect(await objets.existe(cle)).toBe(false);
    expect(await objets.ouvrir(cle)).toBeNull();
    expect(await objets.telechargerVers(cle, path.join(dossier, 'absent.mp4'))).toBe(false);
    await expect(stat(path.join(dossier, 'absent.mp4'))).rejects.toThrow();

    const contenu = Buffer.from(Array.from({ length: 3000 }, (_, i) => i % 251));
    await writeFile(path.join(dossier, 'src.mp4'), contenu);
    await objets.deposerFichier(cle, path.join(dossier, 'src.mp4'), 'video/mp4');
    expect(await objets.existe(cle)).toBe(true);
    // Le type est conserve cote serveur.
    expect((await admin.statObject(BUCKET_CINEMA, cle)).metaData['content-type']).toBe('video/mp4');

    const plein = await objets.ouvrir(cle);
    expect(plein!.taille).toBe(3000);
    const lire = async (f: NodeJS.ReadableStream) => { const m: Buffer[] = []; for await (const c of f) m.push(Buffer.from(c as Buffer)); return Buffer.concat(m); };
    expect(await lire(plein!.flux)).toEqual(contenu);
    const plage = await objets.ouvrir(cle, { debut: 100, fin: 199 });
    expect(plage!.plage).toEqual({ debut: 100, fin: 199 });
    expect(await lire(plage!.flux)).toEqual(contenu.subarray(100, 200));
    // Une plage qui deborde est bornee a la taille.
    const fin = await objets.ouvrir(cle, { debut: 2990, fin: 99999 });
    expect(await lire(fin!.flux)).toEqual(contenu.subarray(2990));

    const cible = path.join(dossier, 'sortie', 'copie.mp4');
    expect(await objets.telechargerVers(cle, cible)).toBe(true);
    expect(await readFile(cible)).toEqual(contenu);
    expect((await readdir(path.dirname(cible))).filter((n) => n.endsWith('.part'))).toEqual([]);

    await objets.deposerOctets(cle, new Uint8Array([9, 9]), 'video/mp4'); // remplace
    expect((await objets.ouvrir(cle))!.taille).toBe(2);
    await objets.supprimer(cle);
    await objets.supprimer(cle); // idempotent
    expect(await objets.existe(cle)).toBe(false);
  });

  it('les objets sont PRIVES : aucune lecture anonyme, ni par le chemin du relais', async () => {
    const cle = cleVoix(A, 'film-m-2', 's1-p-1', 'bbbbbbbb')!;
    await objets.deposerOctets(cle, new Uint8Array([1, 2, 3]), 'audio/mpeg');
    const statut = async (p: string) => (await fetch(`http://127.0.0.1:${port}${p}`)).status;
    expect(await statut(`/${BUCKET_CINEMA}/${cle}`)).toBe(403);
    expect(await statut(`/${BUCKET_CINEMA}/${cle}?x=1`)).toBe(403);
    // Le compartiment n'a aucune politique publique.
    await expect(admin.getBucketPolicy(BUCKET_CINEMA)).rejects.toThrow(/policy does not exist/i);
  });

  it('lister rend le dossier d\'UN film, avec des prefixes voisins, des comptes voisins et plus de 1000 objets ignores', async () => {
    const mettre = (k: string) => admin.putObject(BUCKET_CINEMA, k, Buffer.from('x'));
    const miens = [cleScene(A, 'film-l-1', 's1', 'aaaaaaaa')!, cleVoix(A, 'film-l-1', 's1-p-1', 'bbbbbbbb')!, cleFilmMp4(A, 'film-l-1', 'cccccccc')!];
    const autres = [cleScene(A, 'film-l-10', 's1', 'aaaaaaaa')!, cleScene(B, 'film-l-1', 's1', 'aaaaaaaa')!];
    for (const k of [...miens, ...autres]) await mettre(k);
    expect(await objets.lister(`${A}/cinema/film-l-1/`)).toEqual([...miens].sort());
  });

  it('SUPPRESSION : le dossier du film part, tout le reste reste (MinIO reel, objets fictifs)', async () => {
    const films = depotFilmsMemoire(); const travaux = depotTravauxMemoire();
    const film = (id: string) => ({ id, titre: 'x', majLe: new Date().toISOString(), scenes: [], personnages: [] }) as unknown as Film;
    await films.creer(film('film-s-1'), A); await films.creer(film('film-s-10'), A); await films.creer(film('film-s-b'), B);
    const mettre = (k: string) => objets.deposerOctets(k, new Uint8Array([1]), 'application/octet-stream');
    const miens = [cleScene(A, 'film-s-1', 's1', 'aaaaaaaa')!, cleScene(A, 'film-s-1', 's2', 'aaaaaaab')!, cleVoix(A, 'film-s-1', 's1-p-1', 'bbbbbbbb')!,
      cleMedia(A, 'film-s-1', 'cinema/film-s-1/medias/s1-p-1-0a1b2c3d.mp4')!, cleFilmMp4(A, 'film-s-1', 'cccccccc')!];
    const autres = [cleScene(A, 'film-s-10', 's1', 'aaaaaaaa')!, cleScene(B, 'film-s-b', 's1', 'aaaaaaaa')!, cleScene(B, 'film-s-1', 's1', 'aaaaaaaa')!];
    const hors = [`${A}/rendus/partage.webm`, `${A}/library/musique.mp3`, `${B}/library/x.mp4`];
    for (const k of [...miens, ...autres, ...hors]) await mettre(k);

    const r = await supprimerFilm({ films, travaux, objets }, A, 'film-s-1');
    expect(r).toEqual({ ok: true, objetsSupprimes: 5, objetsIgnores: 0 });
    for (const k of miens) expect(await objets.existe(k), k).toBe(false);
    for (const k of [...autres, ...hors]) expect(await admin.statObject(BUCKET_CINEMA, k).then(() => true, () => false), k).toBe(true);
    expect(await films.lire('film-s-1', A)).toBeNull();
  });

  it('une cle refusee n\'atteint jamais le reseau', async () => {
    await expect(objets.deposerOctets('../x', new Uint8Array([1]), 'x/y')).rejects.toThrow(/cle d'objet refusee/);
    await expect(objets.supprimer(`${A}/../${B}/cinema/film-a/x.mp4`)).rejects.toThrow(/cle d'objet refusee/);
    await expect(objets.lister(`${A}/`)).rejects.toThrow(/prefixe de film refuse/);
  });

  it('serveur injoignable : une ERREUR, jamais « absent » (on ne confond pas panne et inexistant)', async () => {
    const mort = new Client({ endPoint: '127.0.0.1', port: await portLibre(), useSSL: false, accessKey: 'a', secretKey: 'bbbbbbbb' });
    const o = objetsMinio({
      putObject: (b, k, f, t, e) => mort.putObject(b, k, f as never, t, e),
      statObject: (b, k) => mort.statObject(b, k), getObject: (b, k) => mort.getObject(b, k),
      getPartialObject: (b, k, d, l) => mort.getPartialObject(b, k, d, l), removeObject: (b, k) => mort.removeObject(b, k),
      listObjectsV2: (b, p, r) => mort.listObjectsV2(b, p, r) as never,
    });
    const cle = cleScene(A, 'film-m-9', 's1', 'deadbeef')!;
    await expect(o.existe(cle)).rejects.toThrow();
    await expect(o.ouvrir(cle)).rejects.toThrow();
    await expect(o.telechargerVers(cle, path.join(dossier, 'jamais.mp4'))).rejects.toThrow();
  });
});
