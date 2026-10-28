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
 * ⚠️ CORRECTIF SECURITE (revue automatique) : une generation n'est plus jugee perimee
 * sur son AGE DEPUIS CREATION, mais sur l'ECHEANCE DE SON BAIL — un executeur vivant le
 * renouvelle (voir `executeur-generation.ts`, meme principe que `travaux/executeur.ts`).
 *
 * L'ancienne regle (« en_cours depuis plus de 15 min = interrompue ») declarait a tort
 * interrompue — et donc REMBOURSAIT — une generation video LEGITIMEMENT en train de
 * reussir : l'appel Replicate le plus long (`DELAI_VIDEO_MS`, replicate.ts) est deja
 * borne a 10 min, et le telechargement + depot du resultat pouvait suffire a depasser
 * les 15 min sous charge. Le resultat tardif ecrivait alors `reussie` PAR-DESSUS un
 * remboursement deja effectue : l'utilisateur recuperait ses credits ET la video,
 * pendant que le compte Replicate du proprietaire avait ete facture pour rien.
 *
 * Conserve pour les generations ANTERIEURES a ce champ (pas de migration, voir
 * l'en-tete du fichier) : sans bail enregistre, l'ancienne regle par age s'applique —
 * ce sont des generations qui ne peuvent plus etre en cours de toute facon au moment
 * ou ce code tourne (aucune n'a pu survivre a un deploiement).
 */
export const DELAI_GENERATION_PERIMEE_MS = 15 * 60_000;

/**
 * Duree du bail, et intervalle de son renouvellement par battement de coeur
 * (`bailS / 3`, meme ratio que `travaux/types.ts` → `BAIL_S`) : deux battements peuvent
 * manquer sans que le bail n'expire.
 */
export const BAIL_GENERATION_S = 90;

/** Historique conserve sur le film (les plus recentes). */
export const HISTORIQUE_GENERATIONS_MAX = 20;

/** Le statut REEL a l'instant `maintenant` : un bail expire n'est plus « en cours ». */
export function statutEffectif(g: GenerationSuivie, maintenant = Date.now()): StatutGeneration {
  if (g.statut !== 'en_cours') return g.statut;
  if (g.bailJusqua) {
    const echeance = Date.parse(g.bailJusqua);
    if (Number.isFinite(echeance) && maintenant > echeance) return 'interrompue';
    return 'en_cours';
  }
  // Repli pour une generation d'avant ce champ, voir le commentaire ci-dessus.
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
      // Bail initial : le premier battement de coeur de l'executeur (voir
      // `executeur-generation.ts`) le renouvelle bien avant son echeance.
      bailJusqua: new Date(t + BAIL_GENERATION_S * 1000).toISOString(),
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
  'statut' | 'erreur' | 'creditsPris' | 'referenceCredits' | 'creditsRembourses' | 'bailJusqua'
  | 'referenceDepense' | 'referenceQuota' | 'depenseReconciliee'>>;

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
 * Renouvelle le bail d'une generation ENCORE `en_cours` — le battement de coeur de
 * l'executeur (voir `executeur-generation.ts`). Rend `false` sans rien ecrire si la
 * generation a deja change d'etat ailleurs (ex. declaree interrompue) : l'executeur
 * continue son appel (deja parti, non annulable), mais son resultat sera jete a la fin
 * (`appliquerPatchTerminal`) plutot que d'ecraser l'etat deja tranche.
 */
export async function renouvelerBailGeneration(
  depot: DepotFilms, filmId: string, proprietaire: string, id: string, bailS = BAIL_GENERATION_S,
): Promise<boolean> {
  let renouvele = false;
  await modifierFilm(depot, filmId, proprietaire, (f) => {
    const g = (f.generations ?? []).find((x) => x.id === id);
    if (!g || g.statut !== 'en_cours') return null;
    renouvele = true;
    return appliquerPatchGeneration(f, id, { bailJusqua: new Date(Date.now() + bailS * 1000).toISOString() });
  }).catch(() => { renouvele = false; });
  return renouvele;
}

/**
 * Applique un patch TERMINAL (reussie / echouee) a une generation UNIQUEMENT si elle
 * est encore `en_cours`. Un resultat tardif — la generation a ete entre-temps declaree
 * interrompue et remboursee par une reconciliation — ne doit JAMAIS ecraser cet etat :
 * ni faire croire a un succes gratuit apres remboursement, ni effacer la preuve d'un
 * remboursement deja applique en le remplacant par un simple echec.
 *
 * `surFilm`, si fourni, transforme le reste du film (media, cout) DANS LA MEME
 * transaction que le patch — jamais appele si la generation n'est plus `en_cours`.
 *
 * Rend `null` si le patch n'a PAS ete applique (deja tranchee ailleurs, ou film
 * introuvable) : l'appelant doit alors relire l'etat reel plutot que d'en supposer un.
 */
export async function appliquerPatchTerminal(
  depot: DepotFilms, filmId: string, proprietaire: string, id: string,
  patch: PatchGeneration, surFilm?: (f: Film) => Film,
): Promise<Film | null> {
  return modifierFilm(depot, filmId, proprietaire, (f) => {
    const g = (f.generations ?? []).find((x) => x.id === id);
    if (!g || g.statut !== 'en_cours') return null;
    const base = surFilm ? surFilm(f) : f;
    return appliquerPatchGeneration(base, id, { ...patch, bailJusqua: null });
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

/** Une generation interrompue dont la depense ou le quota n'a pas encore ete marque `incertaine`. */
export const depenseAReconcilier = (g: GenerationSuivie): boolean =>
  (!!g.referenceDepense || !!g.referenceQuota) && g.depenseReconciliee !== true;

/** Les generations interrompues qui laissent QUELQUE CHOSE a solder : credits ou depense. */
export function aReconcilier(film: Pick<Film, 'generations'>, maintenant = Date.now()): GenerationSuivie[] {
  return generationsDuFilm(film, maintenant).filter((g) => g.statut === 'interrompue' && (
    ((g.creditsPris ?? 0) > 0 && !!g.referenceCredits && g.creditsRembourses !== true) || depenseAReconcilier(g)));
}
