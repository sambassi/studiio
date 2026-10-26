/**
 * CINEMA IA — ce qui garde les films et leurs medias.
 *
 * Trois regles, ecrites UNE fois et appelees par toutes les routes. Elles
 * repondent a trois defauts que la revue de securite du 2026-10-26 a nommes
 * sur la premiere version de ce module, et qui ont tous la meme cause :
 * `/api/cinema/*` n'est pas couvert par le `matcher` du middleware, donc rien
 * ne verifie a ma place.
 *
 *  1. UN FILM A UN PROPRIETAIRE. Sans lui, connaitre l'identifiant d'un film
 *     suffisait a le lire, le modifier et le faire rendre — depuis n'importe
 *     quel compte connecte.
 *  2. UN IDENTIFIANT EST BORNE. Il sert a composer un chemin de fichier :
 *     `../../` dedans, et la lecture sort du dossier des films.
 *  3. UN MEDIA EST LOCAL. L'URL d'un plan finit chargee par Chromium pendant
 *     le rendu, cote serveur : une URL libre, c'est une requete sortante
 *     choisie par l'appelant (SSRF), y compris vers une adresse interne.
 */

/** Identifiants acceptes : ceux que ce module fabrique, et eux seuls. */
export const MOTIF_ID_FILM = /^film-[a-z0-9][a-z0-9-]{0,62}$/;

export function idFilmValide(id: unknown): id is string {
  return typeof id === 'string' && MOTIF_ID_FILM.test(id);
}

/**
 * Identifiant de PLAN accepte : exactement la forme que `scenario.ts`
 * fabrique (`s<scene>-p-<plan>`), et rien d'autre.
 *
 * ⚠️ POURQUOI CE CONTROLE EXISTE, ALORS QUE `medias.importerMedia` verifie
 * DEJA que le plan existe dans le film avant d'ecrire quoi que ce soit.
 * `importerMedia` construit son chemin de fichier par CONCATENATION
 * (`${planId}-${alea}${ext}`) PUIS `path.posix.join` : un `planId` tel que
 * `../../autre-film/medias/x` se NORMALISE en route et peut ne plus
 * contenir `..` du tout dans le resultat, passant alors la verification
 * `mediaCinemaValide` qui s'applique APRES coup sur la chaine deja
 * normalisee — constate le 2026-10-26 (`path.posix.join('cinema','film-1',
 * 'medias','../../autre-film/medias/x-abcd.png')` donne
 * `cinema/autre-film/medias/x-abcd.png`, sans aucun `..` visible).
 *
 * Aujourd'hui, seuls les plans reellement generes par `scenario.ts`
 * (toujours `s<N>-p-<M>`) peuvent correspondre a un plan existant, donc
 * l'exploit n'est PAS accessible par l'API publique actuelle — mais s'y fier
 * suffit a rendre la protection fragile au premier refactor qui accepterait
 * un autre format d'id. Ce motif la rend STRUCTURELLE : un `planId` hors
 * forme est refuse avant meme de chercher s'il correspond a un plan.
 */
export const MOTIF_ID_PLAN = /^s[0-9]+-p-[0-9]+$/;

export function idPlanValide(id: unknown): id is string {
  return typeof id === 'string' && MOTIF_ID_PLAN.test(id);
}

/**
 * Un media de plan : un chemin RELATIF sous `cinema/`, servi par `public/`.
 * Pas de schema, pas d'hote, pas de remontee de dossier. Le jour ou un
 * fournisseur externe sera branche, c'est ICI qu'une liste d'hotes autorises
 * s'ajoutera — pas dans la route.
 */
export const MOTIF_MEDIA = /^\/?cinema\/[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/;

export function mediaCinemaValide(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  if (url.includes('..')) return false;
  if (/[\u0000-\u001f\s\\]/.test(url)) return false;
  return MOTIF_MEDIA.test(url);
}

/** Le media retenu pour un plan : `null` efface, une URL invalide est REFUSEE. */
export function mediaAccepte(valeur: unknown): { ok: true; url: string | null } | { ok: false } {
  if (valeur === null) return { ok: true, url: null };
  if (mediaCinemaValide(valeur)) return { ok: true, url: valeur };
  return { ok: false };
}

/** Le film appartient-il au compte qui le demande ? */
export function appartientA(film: { proprietaire?: string | null }, userId: string): boolean {
  return typeof film.proprietaire === 'string' && film.proprietaire.length > 0 && film.proprietaire === userId;
}
