/**
 * CINEMA IA — l'INTERRUPTEUR GENERAL. Eteint par defaut.
 *
 * `CINEMA_ACTIVE=true` (variable serveur, jamais `NEXT_PUBLIC_*`) ouvre le module
 * a TOUS les utilisateurs authentifies. Toute autre valeur, ou son absence, le
 * ferme : page et routes repondent 404, comme si le module n'existait pas.
 *
 * Ce qui reste, interrupteur ouvert, et qui ne depend d'aucun role :
 *   - l'authentification (401 sans session) ;
 *   - l'isolation par compte (un film d'autrui est « inconnu », ses fichiers
 *     vivent sous `<compte>/cinema/…`) ;
 *   - les bornes par compte (50 films, 2 travaux actifs, plafond de depense serveur).
 */
import { proprietaireValide } from '@/lib/cinema/stockage/cles';

export type SujetSession = { id?: string | null } | null | undefined;

/** Vrai seulement pour `true` ou `1` (apres espaces et casse). */
export function cinemaActive(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.CINEMA_ACTIVE?.trim().toLowerCase();
  return v === 'true' || v === '1';
}

/** Interrupteur ouvert ET utilisateur authentifie dont l'identifiant est un segment de chemin sain. */
export function accesCinemaAutorise(user: SujetSession, env: NodeJS.ProcessEnv = process.env): boolean {
  return cinemaActive(env) && !!user && proprietaireValide(user.id);
}
