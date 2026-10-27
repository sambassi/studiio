/**
 * CINEMA IA — ou vivent les films, les travaux et les medias.
 *
 *   CINEMA_STOCKAGE=durable  → PostgreSQL (via PostgREST) + MinIO.
 *   absent ou autre          → LOCAL : fichiers sous `var/`, travaux en
 *                              memoire. C'est le comportement SUR par defaut :
 *                              tant que la migration n'est pas appliquee et la
 *                              variable posee, rien ne parle a la base ni a
 *                              MinIO, et rien de Studiio ne change.
 *
 * Dans les deux modes, AUCUN media n'est ecrit dans `public/`.
 */
import os from 'os';
import path from 'path';
import { depotFilmsDossier, depotFilmsPostgres, type ClientBase, type DepotFilms } from '@/lib/cinema/stockage/depot-films';
import { objetsDossier, objetsMinio, type StockageObjets } from '@/lib/cinema/stockage/objets';
import { depotTravauxMemoire, depotTravauxPostgres, type DepotTravaux } from '@/lib/cinema/travaux/depot-travaux';
import { MOTEURS_REELS, type DependancesExecuteur, type MoteursProduction } from '@/lib/cinema/travaux/executeur';
import { PLAFOND_USD_PAR_FILM_DEFAUT } from '@/lib/cinema/generation/couts';

export type ModeStockage = 'local' | 'durable';

export function modeStockage(env: NodeJS.ProcessEnv = process.env): ModeStockage {
  return env.CINEMA_STOCKAGE === 'durable' ? 'durable' : 'local';
}

/**
 * Le PLAFOND de depense par film, cote serveur. Jamais lu dans une requete.
 * Valeur invalide ou absente → le defaut ; borne haute 10 $ : une variable
 * mal saisie ne peut pas ouvrir un budget illimite.
 */
export function plafondServeurUsd(env: NodeJS.ProcessEnv = process.env): number {
  const brut = env.CINEMA_PLAFOND_USD;
  if (brut === undefined || brut === '') return PLAFOND_USD_PAR_FILM_DEFAUT;
  const n = Number(brut);
  if (!Number.isFinite(n) || n < 0) return PLAFOND_USD_PAR_FILM_DEFAUT;
  return Math.min(n, 10);
}

export interface ContexteCinema {
  mode: ModeStockage;
  films: DepotFilms;
  travaux: DepotTravaux;
  objets: StockageObjets;
  racine: string;
  dossierTravail: string;
  plafondUsd: number;
  /** Substituable en test (Chromium, ffmpeg et voix sont lents et externes). */
  moteurs?: MoteursProduction;
  /** Substituable en test (la memoire libre d'un poste de dev n'est pas celle d'un serveur). */
  ressources?: DependancesExecuteur['ressources'];
}

const g = globalThis as unknown as { __cinemaContexte?: ContexteCinema; __cinemaTravauxLocal?: DepotTravaux };

export function construireContexte(env: NodeJS.ProcessEnv = process.env, racine = process.cwd()): ContexteCinema {
  const mode = modeStockage(env);
  let dossierTravail = path.join(racine, 'var', 'cinema', 'travail');
  if (mode === 'durable') {
    // Le conteneur de production tourne en utilisateur non-root et `/app` appartient
    // a root : `var/` n'y est pas creable. Les fichiers de travail (jetables, effaces
    // a la fin de chaque travail) vivent donc sous le dossier temporaire du systeme.
    dossierTravail = dossierTravailDurable(env);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { supabaseAdmin } = require('@/lib/db/supabase') as typeof import('@/lib/db/supabase');
    const base = () => supabaseAdmin as unknown as ClientBase;
    return {
      mode, racine, dossierTravail, plafondUsd: plafondServeurUsd(env),
      films: depotFilmsPostgres(base), travaux: depotTravauxPostgres(base), objets: objetsMinio(),
    };
  }
  return {
    mode, racine, dossierTravail, plafondUsd: plafondServeurUsd(env),
    films: depotFilmsDossier(racine),
    // En memoire dans le processus : perdus au redemarrage, ce qui est
    // l'honnete definition du mode local (les SCENES rendues, elles, restent).
    travaux: (g.__cinemaTravauxLocal ??= depotTravauxMemoire()),
    objets: objetsDossier(racine),
  };
}

/** `CINEMA_DOSSIER_TRAVAIL` (chemin absolu) ou `<tmp>/studiio-cinema`. */
export function dossierTravailDurable(env: NodeJS.ProcessEnv = process.env): string {
  const voulu = env.CINEMA_DOSSIER_TRAVAIL?.trim();
  return voulu && path.isAbsolute(voulu) && path.resolve(voulu) !== path.parse(voulu).root ? path.resolve(voulu) : path.join(os.tmpdir(), 'studiio-cinema');
}

export function contexteCinema(): ContexteCinema {
  return (g.__cinemaContexte ??= construireContexte());
}

export function dependancesExecuteur(ctx: ContexteCinema = contexteCinema()): DependancesExecuteur {
  return {
    films: ctx.films, travaux: ctx.travaux, objets: ctx.objets, moteurs: ctx.moteurs ?? MOTEURS_REELS,
    racine: ctx.racine, dossierTravail: ctx.dossierTravail, plafondUsd: ctx.plafondUsd, ressources: ctx.ressources,
  };
}
