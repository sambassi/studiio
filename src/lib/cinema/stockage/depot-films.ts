/**
 * CINEMA IA — le port des FILMS (scenarios, personnages, references).
 *
 * Le film est un document JSON de quelques dizaines de Ko ; les MEDIAS
 * (images, videos, MP4) ne sont jamais dedans, seulement leurs chemins
 * logiques. Un film se retrouve donc apres un redemarrage tant que sa ligne
 * existe, quel que soit le conteneur qui l'a ecrite.
 *
 * ⚠️ VERSION : chaque ecriture exige la version lue. Un PATCH de l'utilisateur
 * et la fin d'un rendu (qui scelle des scenes) se croisent : sans cette
 * regle, le dernier arrive ecrase l'autre sans le dire. Avec elle, le perdant
 * recoit `conflit`, relit, et recommence (`modifierFilm`).
 *
 * ⚠️ PROPRIETAIRE : `lire` et `lister` prennent le proprietaire. Un film
 * d'autrui est INTROUVABLE — pas « interdit » — comme dans les routes.
 */
import { mkdir, readFile, readdir, rename, writeFile } from 'fs/promises';
import path from 'path';
import type { Film } from '@/lib/cinema/types';
import { idFilmValide } from '@/lib/cinema/acces';
import { dossierFilms } from '@/lib/cinema/store';

export interface FilmVersionne { film: Film; version: number }
export interface ResumeFilm { id: string; titre: string; majLe: string }

export type ResultatEcriture =
  | { ok: true; version: number }
  | { ok: false; raison: 'conflit' | 'absent' | 'existe' };

export interface DepotFilms {
  lire(filmId: string, proprietaire: string): Promise<FilmVersionne | null>;
  /** Cree un film neuf. `existe` si l'identifiant est pris (par qui que ce soit). */
  creer(film: Film, proprietaire: string): Promise<ResultatEcriture>;
  /** Remplace, a condition que la version soit celle qu'on a lue. */
  remplacer(film: Film, proprietaire: string, versionAttendue: number): Promise<ResultatEcriture>;
  lister(proprietaire: string): Promise<ResumeFilm[]>;
}

/** Le film porte son proprietaire : celui de la session, jamais celui du client. */
function marque(film: Film, proprietaire: string): Film {
  return { ...film, proprietaire };
}

/**
 * Lit, transforme, ecrit — et recommence si quelqu'un a ecrit entre-temps.
 * `transformer` doit etre PURE : elle peut etre rejouee. Retourner `null`
 * abandonne sans ecrire.
 */
export async function modifierFilm(
  depot: DepotFilms,
  filmId: string,
  proprietaire: string,
  transformer: (film: Film) => Film | null,
  essais = 5,
): Promise<Film | null> {
  for (let i = 0; i < essais; i++) {
    const courant = await depot.lire(filmId, proprietaire);
    if (!courant) return null;
    const suivant = transformer(courant.film);
    if (!suivant) return null;
    const r = await depot.remplacer({ ...suivant, majLe: new Date().toISOString() }, proprietaire, courant.version);
    if (r.ok) return suivant;
    if (r.raison !== 'conflit') return null;
  }
  throw new Error('film modifie en continu par ailleurs — abandon apres plusieurs essais');
}

// ─────────────────────────────────────────────────────────────────────────
// Memoire — pour les tests
// ─────────────────────────────────────────────────────────────────────────

export function depotFilmsMemoire(): DepotFilms {
  const lignes = new Map<string, { film: Film; proprietaire: string; version: number }>();
  return {
    async lire(id, proprietaire) {
      const l = lignes.get(id);
      return l && l.proprietaire === proprietaire ? { film: structuredClone(l.film), version: l.version } : null;
    },
    async creer(film, proprietaire) {
      if (!idFilmValide(film.id)) throw new Error(`identifiant de film refuse : ${String(film.id)}`);
      if (lignes.has(film.id)) return { ok: false, raison: 'existe' };
      lignes.set(film.id, { film: structuredClone(marque(film, proprietaire)), proprietaire, version: 1 });
      return { ok: true, version: 1 };
    },
    async remplacer(film, proprietaire, versionAttendue) {
      const l = lignes.get(film.id);
      if (!l || l.proprietaire !== proprietaire) return { ok: false, raison: 'absent' };
      if (l.version !== versionAttendue) return { ok: false, raison: 'conflit' };
      l.film = structuredClone(marque(film, proprietaire));
      l.version += 1;
      return { ok: true, version: l.version };
    },
    async lister(proprietaire) {
      return [...lignes.values()].filter((l) => l.proprietaire === proprietaire)
        .map((l) => ({ id: l.film.id, titre: l.film.titre, majLe: l.film.majLe }))
        .sort((a, b) => b.majLe.localeCompare(a.majLe));
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Dossier — le mode local historique (`var/cinema/films/*.json`)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Meme emplacement et meme format que l'ancien `store.ts` : les films deja
 * ecrits restent lisibles. La version vit dans le fichier (`_version`) pour
 * survivre a un redemarrage ; elle n'est jamais rendue dans `Film`.
 */
export function depotFilmsDossier(racine: string): DepotFilms {
  const fichier = (id: string) => path.join(dossierFilms(racine), `${id}.json`);
  const lireBrut = async (id: string): Promise<{ film: Film; version: number } | null> => {
    if (!idFilmValide(id)) return null;
    try {
      const { _version, ...film } = JSON.parse(await readFile(fichier(id), 'utf-8')) as Film & { _version?: number };
      return { film: film as Film, version: typeof _version === 'number' ? _version : 1 };
    } catch { return null; }
  };
  const ecrire = async (film: Film, version: number) => {
    if (!idFilmValide(film.id)) throw new Error(`identifiant de film refuse : ${String(film.id)}`);
    await mkdir(dossierFilms(racine), { recursive: true });
    // Ecriture atomique : un crash en plein milieu ne laisse pas un JSON tronque.
    const cible = fichier(film.id);
    const tmp = `${cible}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ ...film, _version: version }, null, 2), 'utf-8');
    await rename(tmp, cible);
  };
  return {
    async lire(id, proprietaire) {
      const l = await lireBrut(id);
      return l && l.film.proprietaire === proprietaire ? l : null;
    },
    async creer(film, proprietaire) {
      if (await lireBrut(film.id)) return { ok: false, raison: 'existe' };
      await ecrire(marque(film, proprietaire), 1);
      return { ok: true, version: 1 };
    },
    async remplacer(film, proprietaire, versionAttendue) {
      const l = await lireBrut(film.id);
      if (!l || l.film.proprietaire !== proprietaire) return { ok: false, raison: 'absent' };
      if (l.version !== versionAttendue) return { ok: false, raison: 'conflit' };
      await ecrire(marque(film, proprietaire), l.version + 1);
      return { ok: true, version: l.version + 1 };
    },
    async lister(proprietaire) {
      try {
        const noms = (await readdir(dossierFilms(racine))).filter((n) => n.endsWith('.json'));
        const out: ResumeFilm[] = [];
        for (const nom of noms) {
          const l = await lireBrut(nom.replace(/\.json$/, ''));
          if (l && l.film.proprietaire === proprietaire) out.push({ id: l.film.id, titre: l.film.titre, majLe: l.film.majLe });
        }
        return out.sort((a, b) => b.majLe.localeCompare(a.majLe));
      } catch { return []; }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// PostgreSQL via PostgREST — la production
// ─────────────────────────────────────────────────────────────────────────

/** Ce dont le depot a besoin de `supabaseAdmin` : substituable. */
export interface ClientBase {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc(fn: string, args: Record<string, unknown>): any;
}

export function messageBase(e: { message?: string; code?: string } | null | undefined): string {
  // « Could not find the table … in the schema cache » : le piege deja connu
  // du projet. Le nommer evite de le prendre pour un bug applicatif.
  if (e?.code === 'PGRST205' || /schema cache/i.test(e?.message ?? '')) {
    return 'Tables Cinema IA absentes du cache PostgREST : migration 2026-10-27-cinema-ia.sql non appliquee, ou schema non recharge (SIGUSR1).';
  }
  return e?.message ?? 'erreur base inconnue';
}

export function depotFilmsPostgres(base: () => ClientBase): DepotFilms {
  const T = 'cinema_films';
  return {
    async lire(id, proprietaire) {
      if (!idFilmValide(id)) return null;
      const { data, error } = await base().from(T).select('film, version').eq('id', id).eq('proprietaire', proprietaire).maybeSingle();
      if (error) throw new Error(messageBase(error));
      return data ? { film: data.film as Film, version: data.version as number } : null;
    },
    async creer(film, proprietaire) {
      if (!idFilmValide(film.id)) throw new Error(`identifiant de film refuse : ${String(film.id)}`);
      const { error } = await base().from(T).insert({
        id: film.id, proprietaire, titre: film.titre.slice(0, 200), film: marque(film, proprietaire), version: 1,
      });
      if (error) {
        if (error.code === '23505') return { ok: false, raison: 'existe' };
        throw new Error(messageBase(error));
      }
      return { ok: true, version: 1 };
    },
    async remplacer(film, proprietaire, versionAttendue) {
      if (!idFilmValide(film.id)) return { ok: false, raison: 'absent' };
      // `version = attendue` dans le WHERE : l'ecriture et la verification
      // sont UNE instruction. Zero ligne = quelqu'un a ecrit entre-temps (ou le
      // film n'est pas a ce compte — on le distingue par une relecture).
      const { data, error } = await base().from(T)
        .update({ film: marque(film, proprietaire), titre: film.titre.slice(0, 200), version: versionAttendue + 1, maj_le: new Date().toISOString() })
        .eq('id', film.id).eq('proprietaire', proprietaire).eq('version', versionAttendue)
        .select('version');
      if (error) throw new Error(messageBase(error));
      if (Array.isArray(data) && data.length === 1) return { ok: true, version: data[0].version as number };
      const existe = await base().from(T).select('version').eq('id', film.id).eq('proprietaire', proprietaire).maybeSingle();
      return { ok: false, raison: existe.data ? 'conflit' : 'absent' };
    },
    async lister(proprietaire) {
      const { data, error } = await base().from(T).select('id, titre, maj_le').eq('proprietaire', proprietaire).order('maj_le', { ascending: false }).limit(200);
      if (error) throw new Error(messageBase(error));
      return (data ?? []).map((l: { id: string; titre: string; maj_le: string }) => ({ id: l.id, titre: l.titre, majLe: l.maj_le }));
    },
  };
}
