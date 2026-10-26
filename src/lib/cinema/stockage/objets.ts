/**
 * CINEMA IA — le port des OBJETS (medias, MP4 de scene, MP4 de film).
 *
 * Trois implementations, une seule interface :
 *   - `objetsMinio`   : la production, MinIO via le client existant ;
 *   - `objetsMemoire` : les tests, et rien d'autre ;
 *   - `objetsDossier` : le mode local historique (developpement hors serveur).
 *
 * Aucune ne prend une URL : seulement une CLE fabriquee par `cles.ts`. Le
 * port refuse de lui-meme une cle que `cleObjetValide` rejette — la derniere
 * porte avant le disque ou le reseau.
 */
import { createReadStream, createWriteStream } from 'fs';
import { Readable } from 'stream';
import { mkdir, readFile, readdir, rm, stat, writeFile, copyFile } from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import { cleObjetValide } from '@/lib/storage/acces-objet';
import { BUCKET_CINEMA } from '@/lib/cinema/stockage/cles';

export interface StockageObjets {
  deposerOctets(cle: string, octets: Uint8Array, type: string): Promise<void>;
  deposerFichier(cle: string, fichier: string, type: string): Promise<void>;
  /** Copie l'objet vers `fichier`. `false` s'il n'existe pas ; une autre erreur est LEVEE. */
  telechargerVers(cle: string, fichier: string): Promise<boolean>;
  existe(cle: string): Promise<boolean>;
  supprimer(cle: string): Promise<void>;
  /**
   * Ouvre un objet EN FLUX, eventuellement une plage d'octets (`Range`). Rien
   * n'est materialise en memoire. `null` s'il n'existe pas. Sert la lecture
   * authentifiee (`/api/cinema/films/<id>/medias/<plan>`, `…/export`).
   */
  ouvrir(cle: string, plage?: PlageOctets): Promise<ObjetOuvert | null>;
  /**
   * Les cles sous le dossier d'UN film (`<compte>/cinema/<film>/`) — et
   * seulement lui : tout autre prefixe est refuse, pour qu'un appel ne puisse
   * jamais lister (donc supprimer) un compte entier ou le dossier d'un autre film.
   */
  lister(prefixeFilm: string): Promise<string[]>;
}

const MOTIF_PREFIXE_FILM = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\/cinema\/film-[a-z0-9][a-z0-9-]{0,62}\/$/;
function exigerPrefixe(p: string): void {
  if (!MOTIF_PREFIXE_FILM.test(p)) throw new Error('prefixe de film refuse');
}

/** Bornes INCLUSES, comme `Range: bytes=debut-fin`. */
export interface PlageOctets { debut: number; fin: number }
export interface ObjetOuvert { flux: NodeJS.ReadableStream; taille: number; plage: PlageOctets | null }

function plageValide(p: PlageOctets | undefined, taille: number): PlageOctets | null {
  if (!p) return null;
  const fin = Math.min(p.fin, taille - 1);
  if (!Number.isInteger(p.debut) || p.debut < 0 || p.debut > fin) return null;
  return { debut: p.debut, fin };
}

function exiger(cle: string): void {
  if (!cleObjetValide(cle)) throw new Error('cle d\'objet refusee');
}

// ─────────────────────────────────────────────────────────────────────────
// Memoire — pour les tests
// ─────────────────────────────────────────────────────────────────────────

export interface ObjetsMemoire extends StockageObjets {
  contenu(cle: string): Uint8Array | undefined;
  cles(): string[];
  /** Fait echouer le prochain depot (interruption, disque plein…). */
  echouerProchainDepot(message?: string): void;
}

export function objetsMemoire(): ObjetsMemoire {
  const magasin = new Map<string, { octets: Uint8Array; type: string }>();
  let echec: string | null = null;
  const verifierEchec = () => {
    if (echec !== null) { const m = echec; echec = null; throw new Error(m); }
  };
  return {
    async deposerOctets(cle, octets, type) { exiger(cle); verifierEchec(); magasin.set(cle, { octets: new Uint8Array(octets), type }); },
    async deposerFichier(cle, fichier, type) { exiger(cle); verifierEchec(); magasin.set(cle, { octets: new Uint8Array(await readFile(fichier)), type }); },
    async telechargerVers(cle, fichier) {
      exiger(cle);
      const o = magasin.get(cle);
      if (!o) return false;
      await mkdir(path.dirname(fichier), { recursive: true });
      await writeFile(fichier, o.octets);
      return true;
    },
    async existe(cle) { exiger(cle); return magasin.has(cle); },
    async supprimer(cle) { exiger(cle); magasin.delete(cle); },
    async ouvrir(cle, plage) {
      exiger(cle);
      const o = magasin.get(cle);
      if (!o) return null;
      const p = plageValide(plage, o.octets.length);
      const morceau = p ? o.octets.subarray(p.debut, p.fin + 1) : o.octets;
      return { flux: Readable.from([Buffer.from(morceau)]), taille: o.octets.length, plage: p };
    },
    async lister(prefixe) { exigerPrefixe(prefixe); return [...magasin.keys()].filter((k) => k.startsWith(prefixe)).sort(); },
    contenu: (cle) => magasin.get(cle)?.octets,
    cles: () => [...magasin.keys()],
    echouerProchainDepot: (message = 'stockage indisponible') => { echec = message; },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Dossier — mode local historique, HORS de public/
// ─────────────────────────────────────────────────────────────────────────

/** Meme interface, sur disque, sous `var/cinema/objets/` (jamais `public/`). */
export function objetsDossier(racine: string): StockageObjets {
  const base = path.resolve(racine, 'var', 'cinema', 'objets');
  const chemin = (cle: string) => {
    exiger(cle);
    const c = path.resolve(base, cle);
    if (!c.startsWith(base + path.sep)) throw new Error('cle d\'objet refusee');
    return c;
  };
  return {
    async deposerOctets(cle, octets) { const c = chemin(cle); await mkdir(path.dirname(c), { recursive: true }); await writeFile(c, octets); },
    async deposerFichier(cle, fichier) { const c = chemin(cle); await mkdir(path.dirname(c), { recursive: true }); await copyFile(fichier, c); },
    async telechargerVers(cle, fichier) {
      const c = chemin(cle);
      try { await stat(c); } catch { return false; }
      await mkdir(path.dirname(fichier), { recursive: true });
      await copyFile(c, fichier);
      return true;
    },
    async existe(cle) { const c = chemin(cle); try { return (await stat(c)).isFile(); } catch { return false; } },
    async lister(prefixe) {
      exigerPrefixe(prefixe);
      const dossier = path.resolve(base, prefixe);
      if (!dossier.startsWith(base + path.sep)) throw new Error('prefixe de film refuse');
      const cles: string[] = [];
      const marche = async (d: string): Promise<void> => {
        let entrees;
        try { entrees = await readdir(d, { withFileTypes: true }); } catch { return; }
        for (const e of entrees) {
          const c = path.join(d, e.name);
          // Un lien symbolique n'est ni suivi ni liste : on ne sort jamais du dossier du film.
          if (e.isDirectory()) await marche(c);
          else if (e.isFile()) cles.push(path.relative(base, c).split(path.sep).join('/'));
        }
      };
      await marche(dossier);
      return cles.sort();
    },
    async supprimer(cle) { await rm(chemin(cle), { force: true }); },
    async ouvrir(cle, plage) {
      const c = chemin(cle);
      let taille: number;
      try { const i = await stat(c); if (!i.isFile()) return null; taille = i.size; } catch { return null; }
      const p = plageValide(plage, taille);
      return { flux: createReadStream(c, p ? { start: p.debut, end: p.fin } : undefined), taille, plage: p };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// MinIO — la production
// ─────────────────────────────────────────────────────────────────────────

/** Ce dont `objetsMinio` a besoin du SDK : substituable en test. */
export interface ClientMinioCinema {
  putObject(bucket: string, cle: string, flux: unknown, taille?: number, entetes?: Record<string, string>): Promise<unknown>;
  statObject(bucket: string, cle: string): Promise<{ size: number }>;
  getObject(bucket: string, cle: string): Promise<NodeJS.ReadableStream>;
  getPartialObject(bucket: string, cle: string, decalage: number, longueur?: number): Promise<NodeJS.ReadableStream>;
  removeObject(bucket: string, cle: string): Promise<unknown>;
  listObjectsV2(bucket: string, prefixe: string, recursif: boolean): AsyncIterable<{ name?: string }>;
}

function estAbsent(e: unknown): boolean {
  const err = e as { code?: string; statusCode?: number } | null;
  return err?.code === 'NotFound' || err?.code === 'NoSuchKey' || err?.statusCode === 404;
}

/**
 * Assemble le client d'ecriture (`clientMinio()`) et le client de lecture
 * (`lecteurMinio()`) du projet en un seul `ClientMinioCinema`. Exporte pour que
 * le banc contre un vrai serveur MinIO teste exactement ce cablage.
 */
export function adapterClientMinio(
  ecriture: unknown, lecture: { getObject(b: string, k: string): Promise<NodeJS.ReadableStream>; getPartialObject(b: string, k: string, d: number, l?: number): Promise<NodeJS.ReadableStream> },
): ClientMinioCinema {
  const e = ecriture as ClientMinioCinema;
  return {
    putObject: (b, k, f, t, h) => e.putObject(b, k, f, t, h),
    statObject: (b, k) => e.statObject(b, k),
    getObject: (b, k) => lecture.getObject(b, k),
    getPartialObject: (b, k, d, l) => lecture.getPartialObject(b, k, d, l),
    removeObject: (b, k) => e.removeObject(b, k),
    listObjectsV2: (b, p, r) => e.listObjectsV2(b, p, r),
  };
}

/**
 * MinIO derriere le client EXISTANT (`lib/storage/minio-client`) : meme
 * configuration (`MINIO_*`), meme nom interne. Rien n'est lu en memoire : les
 * fichiers passent en flux, dans les deux sens — un MP4 de film pese des
 * dizaines de Mo.
 */
export function objetsMinio(client?: ClientMinioCinema): StockageObjets {
  let c: ClientMinioCinema | null = client ?? null;
  const obtenir = (): ClientMinioCinema => {
    if (!c) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { clientMinio, lecteurMinio } = require('@/lib/storage/minio-client') as typeof import('@/lib/storage/minio-client');
      c = adapterClientMinio(clientMinio(), lecteurMinio());
    }
    return c;
  };
  return {
    async deposerOctets(cle, octets, type) {
      exiger(cle);
      const buf = Buffer.from(octets);
      await obtenir().putObject(BUCKET_CINEMA, cle, buf, buf.length, { 'Content-Type': type });
    },
    async deposerFichier(cle, fichier, type) {
      exiger(cle);
      const { size } = await stat(fichier);
      await obtenir().putObject(BUCKET_CINEMA, cle, createReadStream(fichier), size, { 'Content-Type': type });
    },
    async telechargerVers(cle, fichier) {
      exiger(cle);
      let flux: NodeJS.ReadableStream;
      try { flux = await obtenir().getObject(BUCKET_CINEMA, cle); }
      catch (e) { if (estAbsent(e)) return false; throw e; }
      await mkdir(path.dirname(fichier), { recursive: true });
      // Ecrit dans un fichier voisin puis renomme : une coupure en plein
      // telechargement ne laisse pas un media tronque que le rendu croirait entier.
      const temporaire = `${fichier}.part`;
      try {
        await pipeline(flux, createWriteStream(temporaire));
        const { rename } = await import('fs/promises');
        await rename(temporaire, fichier);
      } catch (e) {
        await rm(temporaire, { force: true }).catch(() => {});
        if (estAbsent(e)) return false;
        throw e;
      }
      return true;
    },
    async existe(cle) {
      exiger(cle);
      try { await obtenir().statObject(BUCKET_CINEMA, cle); return true; }
      catch (e) { if (estAbsent(e)) return false; throw e; }
    },
    async lister(prefixe) {
      exigerPrefixe(prefixe);
      const cles: string[] = [];
      for await (const o of obtenir().listObjectsV2(BUCKET_CINEMA, prefixe, true)) {
        if (o.name && o.name.startsWith(prefixe)) cles.push(o.name);
      }
      return cles.sort();
    },
    async supprimer(cle) {
      exiger(cle);
      try { await obtenir().removeObject(BUCKET_CINEMA, cle); } catch (e) { if (!estAbsent(e)) throw e; }
    },
    async ouvrir(cle, plage) {
      exiger(cle);
      let taille: number;
      try { taille = (await obtenir().statObject(BUCKET_CINEMA, cle)).size; }
      catch (e) { if (estAbsent(e)) return null; throw e; }
      const p = plageValide(plage, taille);
      const flux = p
        ? await obtenir().getPartialObject(BUCKET_CINEMA, cle, p.debut, p.fin - p.debut + 1)
        : await obtenir().getObject(BUCKET_CINEMA, cle);
      return { flux, taille, plage: p };
    },
  };
}
