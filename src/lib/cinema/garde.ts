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
import { modeStockage } from '@/lib/cinema/contexte';

export type SujetSession = { id?: string | null } | null | undefined;

/** Vrai seulement pour `true` ou `1` (apres espaces et casse). */
export function cinemaActive(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.CINEMA_ACTIVE?.trim().toLowerCase();
  return v === 'true' || v === '1';
}

/**
 * LA GENERATION « IA » SIMULEE EST-ELLE AUTORISEE ? ETEINTE PAR DEFAUT.
 *
 * Le seul fournisseur ecrit a ce jour (`generation/simule.ts`) ne genere RIEN par IA :
 * il DESSINE une image ou une video avec ffmpeg. C'est precieux pour eprouver le reste
 * de la chaine sans depenser un centime, mais presenter cela a un utilisateur reviendrait
 * a lui annoncer une reussite qui n'en est pas une.
 *
 * `CINEMA_GENERATION_SIMULEE=true` (ou `1`) la rouvre, pour le developpement local et les
 * tests. En production, la variable reste absente : les boutons « Generer » ne sont pas
 * proposes et le serveur refuse le fournisseur (`atelier.ts`, controle `actif`).
 *
 * Le reste de Cinema IA ne depend pas de cet interrupteur : import de medias reels,
 * scenes, personnages, rendu Remotion + ffmpeg, progression, reprise et export.
 */
export function generationIaSimuleeActive(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.CINEMA_GENERATION_SIMULEE?.trim().toLowerCase();
  return v === 'true' || v === '1';
}

/**
 * EN PRODUCTION, LE MODULE N'OUVRE PAS SANS STOCKAGE DURABLE.
 *
 * `CINEMA_STOCKAGE=durable` absent, les films vivent dans des fichiers sous `var/` et les
 * travaux en memoire. C'est le bon defaut en developpement, et un PIEGE en production : le
 * conteneur est remplace a chaque deploiement, et l'utilisateur perdrait des films qu'on lui
 * a montres comme enregistres. Plutot que de l'accueillir dans un module qui oubliera son
 * travail, on garde la porte fermee (404) et on le dit dans les journaux.
 *
 * Hors production, rien ne change : le mode local reste utilisable.
 */
export function stockageCinemaUtilisable(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== 'production') return true;
  return modeStockage(env) === 'durable';
}

/** Interrupteur ouvert, STOCKAGE utilisable, ET utilisateur authentifie dont l'identifiant est sain. */
export function accesCinemaAutorise(user: SujetSession, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!cinemaActive(env)) return false;
  if (!stockageCinemaUtilisable(env)) {
    console.error(
      '[Cinema] CINEMA_ACTIVE est pose mais CINEMA_STOCKAGE n\'est pas « durable » : '
      + 'le module reste FERME en production — sans base ni MinIO, les films des utilisateurs '
      + 'seraient perdus au prochain remplacement du conteneur.',
    );
    return false;
  }
  return !!user && proprietaireValide(user.id);
}
