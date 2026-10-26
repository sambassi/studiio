// @vitest-environment node
/**
 * CINEMA IA — le stockage DURABLE : cles, objets, films.
 *
 * Ce que ces tests tiennent :
 *   - une cle appartient a un compte PAR SON CHEMIN, et le relais de stockage
 *     existant la refuse a tout autre compte ;
 *   - aucune cle ne vient du navigateur, aucune ne sort de son film ;
 *   - un film retrouve apres « redemarrage » (nouvelle instance, meme
 *     stockage) ; un film d'autrui est introuvable ;
 *   - deux ecritures concurrentes ne s'ecrasent pas (version).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { Readable } from 'stream';
import { cibleLisibleParCompte } from '@/lib/storage/acces-objet';
import {
  BUCKET_CINEMA, cleFilmMp4, cleMedia, cleReference, cleScene, cleVoix, prefixeFilm, proprietaireValide,
} from '@/lib/cinema/stockage/cles';
import { objetsDossier, objetsMemoire, objetsMinio, type ClientMinioCinema } from '@/lib/cinema/stockage/objets';
import { depotFilmsDossier, depotFilmsMemoire, modifierFilm } from '@/lib/cinema/stockage/depot-films';
import { analyserRange, servirObjet } from '@/lib/cinema/stockage/servir';
import { presenterMontage } from '@/lib/cinema/stockage/presentation';
import { monterFilm } from '@/lib/cinema/montage';
import { preparerFilm } from '@/lib/cinema/atelier';
import { appliquerPatch, erreurPatch } from '@/lib/cinema/patch';
import { referenceCinemaValide } from '@/lib/cinema/acces';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const HISTOIRE = 'Nina entre dans la salle avant le lever du jour. Marco la regarde sans bouger. Nina murmure « je ne reculerai pas ». Le jour se leve sur la salle vide.';
const film = (id = 'film-stock-1') => preparerFilm({ histoire: HISTOIRE, personnages: [{ nom: 'Nina', description: 'veste rouge' }, { nom: 'Marco', description: 'ceinture noire' }], idFilm: id, maintenant: () => new Date('2026-10-26T09:00:00Z') });
const MEDIA = 'cinema/film-stock-1/medias/s1-p-1-abcd1234.png';

describe('cles — la propriete est dans le chemin', () => {
  it('fabrique des cles sous <compte>/cinema/<film>/', () => {
    expect(cleMedia(A, 'film-stock-1', MEDIA)).toBe(`${A}/${MEDIA}`);
    expect(cleMedia(A, 'film-stock-1', `/${MEDIA}`)).toBe(`${A}/${MEDIA}`);
    expect(cleScene(A, 'film-stock-1', 's1', 'deadbeef')).toBe(`${A}/cinema/film-stock-1/scenes/s1-deadbeef.mp4`);
    expect(cleFilmMp4(A, 'film-stock-1', 'deadbeef')).toBe(`${A}/cinema/film-stock-1/exports/film-deadbeef.mp4`);
    expect(cleVoix(A, 'film-stock-1', 's1-p-2', 'deadbeef')).toBe(`${A}/cinema/film-stock-1/voix/s1-p-2-deadbeef.mp3`);
    expect(cleReference(A, 'film-stock-1', 'cinema/film-stock-1/references/pers-nina-abcd1234.png')).toBe(`${A}/cinema/film-stock-1/references/pers-nina-abcd1234.png`);
  });

  it('refuse tout ce qui sortirait du film ou du compte', () => {
    const mauvais = [
      cleMedia(A, 'film-stock-1', 'cinema/film-stock-1/medias/../../film-autre/medias/x-abcd1234.png'),
      cleMedia(A, 'film-stock-1', 'cinema/film-autre/medias/s1-p-1-abcd1234.png'),   // un AUTRE film
      cleMedia(A, 'film-stock-1', 'cinema/film-stock-1/medias/sous/dossier.png'),
      cleMedia(A, 'film-stock-1', 'cinema/film-stock-1/medias/s1-p-1-abcd1234.html'),
      cleMedia(A, 'film-stock-1', 'http://169.254.169.254/latest'),
      cleMedia('../autre', 'film-stock-1', MEDIA),
      cleMedia('a/b', 'film-stock-1', MEDIA),
      cleMedia(A, '../film-1', MEDIA),
      cleScene(A, 'film-stock-1', '../s1', 'deadbeef'),
      cleScene(A, 'film-stock-1', 's1', 'DEADBEEF'),
      cleFilmMp4(A, 'film-stock-1', 'x'),
      cleReference(A, 'film-stock-1', 'cinema/film-stock-1/medias/s1-p-1-abcd1234.png'),
      cleReference(A, 'film-stock-1', 'http://exemple.org/x.png'),
    ];
    for (const m of mauvais) expect(m).toBeNull();
  });

  it('un identifiant de compte est un segment propre', () => {
    for (const bon of [A, 'user_1']) expect(proprietaireValide(bon)).toBe(true);
    for (const mauvais of ['', 'a/b', '..', '../x', 'a b', null, 12]) expect(proprietaireValide(mauvais)).toBe(false);
    expect(prefixeFilm(A, 'film-stock-1')).toBe(`${A}/cinema/film-stock-1/`);
  });

  it('le relais de stockage existant ne sert ces cles qu\'a leur proprietaire', () => {
    const cles = [
      cleMedia(A, 'film-stock-1', MEDIA)!, cleScene(A, 'film-stock-1', 's1', 'deadbeef')!,
      cleFilmMp4(A, 'film-stock-1', 'deadbeef')!, cleVoix(A, 'film-stock-1', 's1-p-2', 'deadbeef')!,
    ];
    for (const cle of cles) {
      expect(cibleLisibleParCompte(BUCKET_CINEMA, cle, A)).toBe(true);
      expect(cibleLisibleParCompte(BUCKET_CINEMA, cle, B)).toBe(false);
      expect(cibleLisibleParCompte(BUCKET_CINEMA, cle, '')).toBe(false);
    }
  });

  it('l\'image de reference d\'un personnage est un chemin local de la forme exacte', () => {
    expect(referenceCinemaValide('cinema/film-stock-1/references/pers-nina-abcd1234.webp')).toBe(true);
    for (const m of ['http://x/y.png', 'data:image/png;base64,AAAA', '//evil/x.png', 'cinema/film-1/references/../x-abcd1234.png', 'cinema/film-1/medias/x-abcd1234.png', null]) {
      expect(referenceCinemaValide(m)).toBe(false);
    }
  });
});

describe('objets — memoire, dossier, MinIO derriere la meme interface', () => {
  let dossier: string;
  beforeEach(async () => { dossier = await mkdtemp(path.join(tmpdir(), 'cinema-objets-')); });
  afterEach(async () => { await rm(dossier, { recursive: true, force: true }); });

  const lireFlux = async (flux: NodeJS.ReadableStream) => { const morceaux: Buffer[] = []; for await (const m of flux) morceaux.push(Buffer.from(m as Buffer)); return Buffer.concat(morceaux); };

  const clientMinioFictif = () => {
    const magasin = new Map<string, Buffer>();
    const absent = () => Object.assign(new Error('Not Found'), { code: 'NotFound' });
    const client: ClientMinioCinema & { magasin: Map<string, Buffer>; appels: string[] } = {
      magasin, appels: [],
      async putObject(b, k, f, t) {
        client.appels.push(`put:${b}/${k}`);
        const buf = Buffer.isBuffer(f) ? f : await lireFlux(f as NodeJS.ReadableStream);
        if (t !== undefined && t !== buf.length) throw new Error('taille annoncee incoherente');
        magasin.set(k, buf); return {};
      },
      async statObject(_b, k) { const o = magasin.get(k); if (!o) throw absent(); return { size: o.length }; },
      async getObject(_b, k) { const o = magasin.get(k); if (!o) throw absent(); return Readable.from([o]); },
      async getPartialObject(_b, k, d, l) { const o = magasin.get(k); if (!o) throw absent(); return Readable.from([o.subarray(d, l === undefined ? undefined : d + l)]); },
      async removeObject(_b, k) { magasin.delete(k); return {}; },
      async *listObjectsV2(_b, prefixe) { for (const k of [...magasin.keys()].sort()) if (k.startsWith(prefixe)) yield { name: k }; },
    };
    return client;
  };

  for (const [nom, fabrique] of [
    ['memoire', () => objetsMemoire()],
    ['dossier', () => objetsDossier(dossier)],
    ['minio (client fictif)', () => objetsMinio(clientMinioFictif())],
  ] as const) {
    it(`${nom} : liste le dossier d'UN film, et refuse tout autre prefixe`, async () => {
      const objets = fabrique();
      const miens = [cleScene(A, 'film-l-1', 's1', 'aaaaaaaa')!, cleVoix(A, 'film-l-1', 's1-p-1', 'bbbbbbbb')!];
      const voisins = [cleScene(A, 'film-l-10', 's1', 'aaaaaaaa')!, cleScene(A, 'film-l-2', 's1', 'aaaaaaaa')!, cleScene('autre-compte', 'film-l-1', 's1', 'aaaaaaaa')!];
      for (const k of [...miens, ...voisins]) await objets.deposerOctets(k, new Uint8Array([1]), 'video/mp4');
      expect(await objets.lister(`${A}/cinema/film-l-1/`)).toEqual([...miens].sort());
      expect(await objets.lister(`${A}/cinema/film-vide/`)).toEqual([]);
      for (const mauvais of [`${A}/`, `${A}/cinema/`, `${A}/cinema/film-l-1`, '', '/', '../x/cinema/film-a/', `${A}/cinema/../film-a/`, `${A}/rendus/`, 'a/b/cinema/film-a/']) {
        await expect(objets.lister(mauvais), mauvais).rejects.toThrow(/prefixe de film refuse/);
      }
    });

    it(`${nom} : depose, retrouve, lit une plage, supprime`, async () => {
      const objets = fabrique();
      const cle = cleScene(A, 'film-stock-1', 's1', 'deadbeef')!;
      expect(await objets.existe(cle)).toBe(false);
      expect(await objets.ouvrir(cle)).toBeNull();
      expect(await objets.telechargerVers(cle, path.join(dossier, 'x.mp4'))).toBe(false);

      await objets.deposerOctets(cle, new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), 'video/mp4');
      expect(await objets.existe(cle)).toBe(true);

      const entier = await objets.ouvrir(cle);
      expect(entier!.taille).toBe(10);
      expect([...await lireFlux(entier!.flux)]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      const plage = await objets.ouvrir(cle, { debut: 2, fin: 4 });
      expect(plage!.plage).toEqual({ debut: 2, fin: 4 });
      expect([...await lireFlux(plage!.flux)]).toEqual([2, 3, 4]);

      const copie = path.join(dossier, 'sous', 'copie.mp4');
      expect(await objets.telechargerVers(cle, copie)).toBe(true);
      expect((await readFile(copie)).length).toBe(10);

      await objets.supprimer(cle);
      expect(await objets.existe(cle)).toBe(false);
      await objets.supprimer(cle);   // idempotent
    });

    it(`${nom} : depose un fichier local`, async () => {
      const objets = fabrique();
      const source = path.join(dossier, 'src.mp4');
      await writeFile(source, Buffer.from('contenu'));
      const cle = cleFilmMp4(A, 'film-stock-1', 'deadbeef')!;
      await objets.deposerFichier(cle, source, 'video/mp4');
      const dest = path.join(dossier, 'dest.mp4');
      expect(await objets.telechargerVers(cle, dest)).toBe(true);
      expect((await readFile(dest)).toString()).toBe('contenu');
    });

    it(`${nom} : refuse une cle qui n'en est pas une`, async () => {
      const objets = fabrique();
      for (const mauvaise of ['../evasion', 'a/../../b', 'http://x/y', 'a\\b', '']) {
        await expect(objets.existe(mauvaise)).rejects.toThrow(/refusee/);
        await expect(objets.deposerOctets(mauvaise, new Uint8Array(1), 'x')).rejects.toThrow(/refusee/);
      }
    });
  }

  it('minio : tout part dans le compartiment `media`, et rien ne passe en memoire pour un fichier', async () => {
    const client = clientMinioFictif();
    const objets = objetsMinio(client);
    const source = path.join(dossier, 'src.mp4');
    await writeFile(source, Buffer.from('abc'));
    await objets.deposerFichier(cleScene(A, 'film-stock-1', 's1', 'deadbeef')!, source, 'video/mp4');
    expect(client.appels).toEqual([`put:media/${A}/cinema/film-stock-1/scenes/s1-deadbeef.mp4`]);
  });

  it('minio : un telechargement interrompu ne laisse pas de fichier tronque', async () => {
    const client = clientMinioFictif();
    client.getObject = async () => Readable.from((async function* () { yield Buffer.from('debut'); throw new Error('connexion coupee'); })());
    const objets = objetsMinio(client);
    const dest = path.join(dossier, 'media.png');
    await expect(objets.telechargerVers(cleMedia(A, 'film-stock-1', MEDIA)!, dest)).rejects.toThrow(/coupee/);
    await expect(readFile(dest)).rejects.toThrow();
    await expect(readFile(`${dest}.part`)).rejects.toThrow();
  });

  it('dossier : le magasin local est HORS de public/', async () => {
    const objets = objetsDossier(dossier);
    await objets.deposerOctets(cleMedia(A, 'film-stock-1', MEDIA)!, new Uint8Array([1]), 'image/png');
    expect(await objets.existe(cleMedia(A, 'film-stock-1', MEDIA)!)).toBe(true);
    await expect(readFile(path.join(dossier, 'public', MEDIA))).rejects.toThrow();
    expect((await readFile(path.join(dossier, 'var', 'cinema', 'objets', A, MEDIA))).length).toBe(1);
  });
});

describe('films — retrouves apres redemarrage, isoles, jamais ecrases', () => {
  let racine: string;
  beforeEach(async () => { racine = await mkdtemp(path.join(tmpdir(), 'cinema-films-')); });
  afterEach(async () => { await rm(racine, { recursive: true, force: true }); });

  for (const [nom, fabrique] of [['memoire', () => depotFilmsMemoire()], ['dossier', () => depotFilmsDossier(racine)]] as const) {
    it(`${nom} : cree, relit, liste — et un autre compte ne voit rien`, async () => {
      const depot = fabrique();
      expect((await depot.creer(film(), A)).ok).toBe(true);
      expect((await depot.creer(film(), A))).toEqual({ ok: false, raison: 'existe' });
      expect((await depot.creer(film(), B))).toEqual({ ok: false, raison: 'existe' });

      const lu = await depot.lire('film-stock-1', A);
      expect(lu!.film.proprietaire).toBe(A);
      expect(lu!.version).toBe(1);
      expect(await depot.lire('film-stock-1', B)).toBeNull();
      expect((await depot.lister(A)).map((f) => f.id)).toEqual(['film-stock-1']);
      expect(await depot.lister(B)).toEqual([]);
      expect(await depot.lire('../../etc/passwd', A)).toBeNull();
    });

    it(`${nom} : le proprietaire vient de l'appelant, pas du film`, async () => {
      const depot = fabrique();
      await depot.creer({ ...film(), proprietaire: B }, A);
      expect((await depot.lire('film-stock-1', A))!.film.proprietaire).toBe(A);
      expect(await depot.lire('film-stock-1', B)).toBeNull();
    });

    it(`${nom} : deux ecritures sur la meme version — la seconde est un CONFLIT`, async () => {
      const depot = fabrique();
      await depot.creer(film(), A);
      const lu = (await depot.lire('film-stock-1', A))!;
      expect(await depot.remplacer({ ...lu.film, titre: 'Premier' }, A, lu.version)).toEqual({ ok: true, version: 2 });
      expect(await depot.remplacer({ ...lu.film, titre: 'Second' }, A, lu.version)).toEqual({ ok: false, raison: 'conflit' });
      expect((await depot.lire('film-stock-1', A))!.film.titre).toBe('Premier');
      expect(await depot.remplacer({ ...lu.film }, B, 2)).toEqual({ ok: false, raison: 'absent' });
    });

    it(`${nom} : modifierFilm rejoue sur le film le plus recent au lieu d'ecraser`, async () => {
      const depot = fabrique();
      await depot.creer(film(), A);
      let essais = 0;
      const resultat = await modifierFilm(depot, 'film-stock-1', A, (f) => {
        essais += 1;
        return { ...f, titre: `${f.titre}+patch` };
      });
      expect(essais).toBe(1);
      // Une ecriture passe entre la lecture et l'ecriture de la 1ere tentative.
      let intercepte = false;
      const concurrent = { ...depot, async remplacer(...a: Parameters<typeof depot.remplacer>) {
        if (!intercepte) { intercepte = true; const l = (await depot.lire('film-stock-1', A))!; await depot.remplacer({ ...l.film, histoire: `${l.film.histoire} (autre onglet)` }, A, l.version); }
        return depot.remplacer(...a);
      } };
      const fin = await modifierFilm(concurrent, 'film-stock-1', A, (f) => ({ ...f, titre: 'rejoue' }));
      expect(fin!.titre).toBe('rejoue');
      const final = (await depot.lire('film-stock-1', A))!.film;
      expect(final.histoire).toContain('(autre onglet)');   // l'autre ecriture n'est PAS perdue
      expect(final.titre).toBe('rejoue');
      expect(resultat!.titre).toContain('+patch');
    });
  }

  it('dossier : un film survit a un redemarrage (nouvelle instance, memes fichiers)', async () => {
    await depotFilmsDossier(racine).creer(film(), A);
    const apres = depotFilmsDossier(racine);
    const lu = await apres.lire('film-stock-1', A);
    expect(lu!.film.scenes.length).toBeGreaterThan(0);
    expect(lu!.version).toBe(1);
    await apres.remplacer(lu!.film, A, 1);
    expect((await depotFilmsDossier(racine).lire('film-stock-1', A))!.version).toBe(2);
  });

  it('dossier : la version n\'apparait jamais dans le film rendu', async () => {
    const depot = depotFilmsDossier(racine);
    await depot.creer(film(), A);
    expect(Object.keys((await depot.lire('film-stock-1', A))!.film)).not.toContain('_version');
  });

  it('refuse d\'ecrire un identifiant de film non conforme', async () => {
    await expect(depotFilmsDossier(racine).creer({ ...film(), id: '../evasion' }, A)).rejects.toThrow(/refuse/);
    await expect(depotFilmsMemoire().creer({ ...film(), id: '../evasion' }, A)).rejects.toThrow(/refuse/);
  });
});

describe('servir — la forme de la reponse', () => {
  it('analyse Range : plage, ouverte, suffixe, invalide', () => {
    expect(analyserRange(null, 100)).toEqual({ genre: 'aucune' });
    expect(analyserRange('bytes=0-9', 100)).toEqual({ genre: 'plage', debut: 0, fin: 9 });
    expect(analyserRange('bytes=90-', 100)).toEqual({ genre: 'plage', debut: 90, fin: 99 });
    expect(analyserRange('bytes=-10', 100)).toEqual({ genre: 'plage', debut: 90, fin: 99 });
    expect(analyserRange('bytes=50-500', 100)).toEqual({ genre: 'plage', debut: 50, fin: 99 });
    for (const mauvais of ['bytes=100-', 'bytes=9-2', 'bytes=-', 'bytes=0-1,5-9', 'items=0-1', 'bytes=a-b', 'bytes=-0']) {
      expect(analyserRange(mauvais, 100)).toEqual({ genre: 'invalide' });
    }
  });

  it('200 / 206 / 416 / 404 avec des en-tetes surs, et un type decide par nous', async () => {
    const objets = objetsMemoire();
    const cle = cleScene(A, 'film-stock-1', 's1', 'deadbeef')!;
    await objets.deposerOctets(cle, new Uint8Array(Array.from({ length: 100 }, (_, i) => i)), 'text/html');   // le type annonce par l'envoyeur est ignore
    const req = (range?: string) => new Request('http://x/', { headers: range ? { range } : {} });

    const plein = await servirObjet(req(), cle, objets);
    expect(plein.status).toBe(200);
    expect(plein.headers.get('content-type')).toBe('video/mp4');
    expect(plein.headers.get('x-content-type-options')).toBe('nosniff');
    expect(plein.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(plein.headers.get('cache-control')).toBe('private, no-store');
    expect(plein.headers.get('accept-ranges')).toBe('bytes');
    expect((await plein.arrayBuffer()).byteLength).toBe(100);

    const partiel = await servirObjet(req('bytes=10-19'), cle, objets);
    expect(partiel.status).toBe(206);
    expect(partiel.headers.get('content-range')).toBe('bytes 10-19/100');
    expect([...new Uint8Array(await partiel.arrayBuffer())]).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);

    const hors = await servirObjet(req('bytes=500-'), cle, objets);
    expect(hors.status).toBe(416);
    expect(hors.headers.get('content-range')).toBe('bytes */100');

    const absent = await servirObjet(req(), cleScene(A, 'film-stock-1', 's2', 'deadbeef')!, objets);
    expect(absent.status).toBe(404);
  });
});

describe('presentation — le navigateur ne voit aucun chemin de stockage', () => {
  it('reecrit les medias et les voix vers les routes authentifiees', () => {
    const f = film('film-stock-1');
    f.scenes[0].plans[0].media = { url: MEDIA, genre: 'image', largeur: 10, hauteur: 10, dureeS: null, octets: 1, origine: 'import' };
    const m = presenterMontage(monterFilm(f, { 's1-p-1': 'cinema/film-stock-1/s1-p-1.mp3' }), f.id, new Map([['s1-p-1', 'deadbeef']]));
    const json = JSON.stringify(m);
    expect(json).not.toContain('/cinema/film-stock-1/medias');
    expect(json).not.toContain('cinema/film-stock-1/s1-p-1.mp3');
    expect(json).not.toContain('storage/v1');
    const seg = m.segments.find((s) => s.planId === 's1-p-1')!;
    expect(seg.media!.url).toMatch(/^\/api\/cinema\/films\/film-stock-1\/medias\/s1-p-1\?v=[0-9a-f]{8}$/);
    expect(seg.voixUrl).toBe('/api/cinema/films/film-stock-1/voix/s1-p-1?v=deadbeef');
  });

  it('une voix non prise en charge n\'est pas annoncee', () => {
    const f = film();
    const m = presenterMontage(monterFilm(f, { 's1-p-1': 'cinema/film-stock-1/s1-p-1.mp3' }), f.id);
    expect(m.segments.every((s) => s.voixUrl === null)).toBe(true);
  });
});

describe('patch — pur, rejouable, sans URL libre', () => {
  it('refuse un media declare par URL et une image de personnage par adresse', () => {
    expect(erreurPatch({ plans: [{ id: 's1-p-1', media: { url: 'http://x' } }] })).toMatch(/POST \/medias/);
    expect(erreurPatch({ plans: [{ id: 's1-p-1', mediaUrl: 'http://x' }] })).toMatch(/POST \/medias/);
    expect(erreurPatch({ reference: { personnageId: 'pers-nina', urlImage: 'http://169.254.169.254/x.png' } })).toMatch(/references/);
    expect(erreurPatch({ reference: { personnageId: 'pers-nina', urlImage: 'data:image/png;base64,AAA' } })).toMatch(/references/);
    expect(erreurPatch({ plans: [{ id: 's1-p-1', media: null }] })).toBeNull();
    expect(erreurPatch({ reference: { personnageId: 'pers-nina', urlImage: 'cinema/film-stock-1/references/pers-nina-abcd1234.png' } })).toBeNull();
  });

  it('appliquer deux fois le meme patch sur le meme film donne le meme film', () => {
    const f = film();
    const corps = { plans: [{ id: 's1-p-1', texte: 'Nouvelle description' }], scenes: [{ id: f.scenes[0].id, etat: 'validee' }] };
    expect(appliquerPatch(appliquerPatch(f, corps), corps)).toEqual(appliquerPatch(f, corps));
  });
});
