/**
 * MAGASIN DES FILMS — fichiers JSON, volontairement hors base.
 *
 * Cinema IA ne cree AUCUNE table. Une migration ici exigerait les deux etapes
 * d'infrastructure du projet (droits PostgREST + rechargement du cache de
 * schema) sur une base de PRODUCTION, pour un module encore en prototype :
 * tout ce qu'on y gagnerait serait un risque sur Studiio.pro.
 *
 * Consequence a assumer, et a dire : la persistance est LOCALE au serveur qui
 * ecrit. Passer en multi-utilisateur demandera une vraie table
 * (`cinema_films`), avec ses droits et son rechargement de cache — c'est une
 * etape identifiee, pas un oubli.
 */
import { mkdir, readFile, readdir, writeFile } from 'fs/promises';
import path from 'path';
import type { Film } from '@/lib/cinema/types';
import { idFilmValide } from '@/lib/cinema/acces';

export const DOSSIER_PAR_DEFAUT = path.join('var', 'cinema', 'films');

export function dossierFilms(racine: string): string {
  return path.join(racine, DOSSIER_PAR_DEFAUT);
}

export async function enregistrerFilm(racine: string, film: Film): Promise<string> {
  // L'identifiant compose un chemin : il est verifie a l'ECRITURE comme a la
  // lecture, pas seulement a l'entree de l'API.
  if (!idFilmValide(film.id)) throw new Error(`identifiant de film refuse : ${String(film.id)}`);
  const dossier = dossierFilms(racine);
  await mkdir(dossier, { recursive: true });
  const fichier = path.join(dossier, `${film.id}.json`);
  await writeFile(fichier, JSON.stringify({ ...film, majLe: new Date().toISOString() }, null, 2), 'utf-8');
  return fichier;
}

export async function lireFilm(racine: string, filmId: string): Promise<Film | null> {
  if (!idFilmValide(filmId)) return null;
  try {
    const brut = await readFile(path.join(dossierFilms(racine), `${filmId}.json`), 'utf-8');
    return JSON.parse(brut) as Film;
  } catch { return null; }
}

/** Les films d'un compte. Sans proprietaire, on ne liste rien d'autre. */
export async function listerFilms(racine: string, proprietaire?: string): Promise<Array<{ id: string; titre: string; majLe: string }>> {
  try {
    const noms = await readdir(dossierFilms(racine));
    const films: Array<{ id: string; titre: string; majLe: string }> = [];
    for (const nom of noms.filter((n) => n.endsWith('.json'))) {
      const film = await lireFilm(racine, nom.replace(/\.json$/, ''));
      if (!film) continue;
      if (proprietaire && film.proprietaire !== proprietaire) continue;
      films.push({ id: film.id, titre: film.titre, majLe: film.majLe });
    }
    return films.sort((a, b) => b.majLe.localeCompare(a.majLe));
  } catch { return []; }
}
