/**
 * CINEMA IA — SUIVI DURABLE DES GENERATIONS (image, image-vers-video).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI
 * ─────────────────────────────────────────────────────────────────────────
 * La generation etait SYNCHRONE : la requete HTTP restait ouverte pendant tout
 * l'appel au fournisseur (1 a plusieurs minutes pour une video). Le navigateur
 * abandonnait au bout de 20 s, affichait « reessayez »… pendant que le serveur
 * continuait, debitait et produisait. Un second clic engageait une SECONDE
 * depense. Allonger le delai ne regle rien : un rechargement de page perdait
 * toujours la trace de ce qui tournait.
 *
 * Ici, chaque generation est une LIGNE du document du film (`Film.generations`),
 * persistee dans le meme depot que le film (PostgreSQL en production) :
 *
 *   - identifiant unique par generation ;
 *   - statut reel : `en_cours` → `reussie` | `echouee` | `interrompue` ;
 *   - UNE SEULE generation active par film, reservee de facon ATOMIQUE grace a
 *     l'ecriture versionnee du depot (`modifierFilm` rejoue sur conflit) : deux
 *     clics, deux onglets ou deux requetes simultanees ne peuvent pas reserver
 *     deux fois — la seconde recoit la generation deja en cours, sans debit ;
 *   - un rechargement relit le film et retrouve la generation et son etat.
 *
 * Aucune migration : le film est deja un document JSON versionne. Un film d'avant
 * ce module (sans `generations`) reste valide.
 */
import { randomUUID } from 'crypto';
import { modifierFilm, type DepotFilms } from '@/lib/cinema/stockage/depot-films';
import type { Film, GenerationSuivie, StatutGeneration } from '@/lib/cinema/types';

export type { GenerationSuivie, StatutGeneration };

/**
 * Au-dela, une generation `en_cours` n'a plus d'executeur vivant (conteneur
 * remplace, processus tue) : l'appel le plus long est borne a 10 min
 * (`DELAI_VIDEO_MS`, replicate.ts). Elle est alors lue `interrompue`.
 */
export const DELAI_GENERATION_PERIMEE_MS = 15 * 60_000;

/** Historique conserve sur le film (les plus recentes). */
export const HISTORIQUE_GENERATIONS_MAX = 20;

/** Le statut REEL a l'instant `maintenant` : une generation perimee n'est plus « en cours ». */
export function statutEffectif(g: GenerationSuivie, maintenant = Date.now()): StatutGeneration {
  if (g.statut !== 'en_cours') return g.statut;
  const debut = Date.parse(g.creeLe);
  if (Number.isFinite(debut) && maintenant - debut > DELAI_GENERATION_PERIMEE_MS) return 'interrompue';
  return 'en_cours';
}

/** Les generations du film, statut effectif applique — ce que l'ecran doit voir. */
export function generationsDuFilm(film: Pick<Film, 'generations'>, maintenant = Date.now()): GenerationSuivie[] {
  return (film.generations ?? []).map((g) => {
    const statut = statutEffectif(g, maintenant);
    return statut === g.statut ? g : { ...g, statut, erreur: g.erreur ?? 'generation interrompue (serveur redemarre ou delai depasse)' };
  });
}

/** La generation active du film, s'il y en a une. */
export function generationActive(film: Pick<Film, 'generations'>, maintenant = Date.now()): GenerationSuivie | null {
  return generationsDuFilm(film, maintenant).find((g) => g.statut === 'en_cours') ?? null;
}

export interface DemandeGeneration {
  planId: string;
  operation: 'image' | 'video';
  mode: 'reelle' | 'simulee';
}

export type IssueReservationGeneration =
  | { ok: true; generation: GenerationSuivie }
  | { ok: false; raison: 'en_cours'; generation: GenerationSuivie }
  | { ok: false; raison: 'absent' };

/**
 * Reserve LA generation du film. Atomique : la transformation est rejouee sur la
 * version la plus recente du film tant qu'une autre ecriture s'intercale, et elle
 * abandonne des qu'une generation active existe. Aucun debit n'a lieu ici.
 */
export async function reserverGeneration(
  depot: DepotFilms,
  filmId: string,
  proprietaire: string,
  demande: DemandeGeneration,
  o: { maintenant?: () => number; nouvelId?: () => string } = {},
): Promise<IssueReservationGeneration> {
  const maintenant = o.maintenant ?? Date.now;
  const id = (o.nouvelId ?? randomUUID)();
  let deja: GenerationSuivie | null = null;
  let creee: GenerationSuivie | null = null;

  const suivant = await modifierFilm(depot, filmId, proprietaire, (f) => {
    deja = null; creee = null;
    const t = maintenant();
    const active = generationActive(f, t);
    if (active) { deja = active; return null; }
    const iso = new Date(t).toISOString();
    const g: GenerationSuivie = {
      id, planId: demande.planId, operation: demande.operation, mode: demande.mode,
      statut: 'en_cours', creeLe: iso, majLe: iso, erreur: null,
    };
    creee = g;
    // Les perimees sont ecrites telles qu'on les lit : `interrompue`.
    const historique = generationsDuFilm(f, t);
    return { ...f, generations: [...historique, g].slice(-HISTORIQUE_GENERATIONS_MAX) };
  });

  if (deja) return { ok: false, raison: 'en_cours', generation: deja };
  if (!suivant || !creee) return { ok: false, raison: 'absent' };
  return { ok: true, generation: creee };
}

/** Champs qu'une generation peut recevoir en cours de route ou a sa fin. */
export type PatchGeneration = Partial<Pick<GenerationSuivie,
  'statut' | 'erreur' | 'creditsPris' | 'referenceCredits' | 'creditsRembourses'>>;

/** Applique un patch a UNE generation d'un film (pure, rejouable). */
export function appliquerPatchGeneration(f: Film, id: string, patch: PatchGeneration, maintenant = Date.now()): Film {
  const iso = new Date(maintenant).toISOString();
  return {
    ...f,
    generations: (f.generations ?? []).map((g) => (g.id === id ? { ...g, ...patch, majLe: iso } : g)),
  };
}

/** Met a jour une generation, seule (sans toucher au reste du film). */
export async function noterGeneration(
  depot: DepotFilms, filmId: string, proprietaire: string, id: string, patch: PatchGeneration,
): Promise<void> {
  await modifierFilm(depot, filmId, proprietaire, (f) => appliquerPatchGeneration(f, id, patch)).catch((e) => {
    console.error('[Cinema/Generation] suivi non ecrit —', e instanceof Error ? e.message : e);
  });
}

/**
 * Les generations interrompues dont les credits ont ete pris mais jamais rendus.
 * Le remboursement est idempotent (reference derivee du debit) : le rejouer est sans risque.
 */
export function aRembourser(film: Pick<Film, 'generations'>, maintenant = Date.now()): GenerationSuivie[] {
  return generationsDuFilm(film, maintenant).filter((g) =>
    g.statut === 'interrompue' && (g.creditsPris ?? 0) > 0 && !!g.referenceCredits && g.creditsRembourses !== true);
}
