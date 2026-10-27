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
import { generationReelleActive, ID_REPLICATE_IMAGE, ID_REPLICATE_VIDEO } from '@/lib/cinema/generation/replicate';
import { ID_FOURNISSEUR_SIMULE } from '@/lib/cinema/generation/simule';

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

export type ModeGeneration = 'reelle' | 'simulee';
export type OperationGeneration = 'image' | 'video';

/**
 * QUELS COMPTES ONT LE DROIT DE DEPENSER (generation REELLE).
 *
 * Ce n'est PAS une reserve de fonctionnalite : c'est une limite de COUT. Une generation
 * reelle est facturee au compte Replicate du proprietaire, pas aux credits de celui qui
 * clique. Un seul interrupteur ne doit donc pas pouvoir ouvrir cette depense a tous les
 * utilisateurs authentifies.
 *
 * `CINEMA_GENERATION_REELLE_COMPTES` : identifiants separes par des virgules.
 * ABSENTE ou vide ⇒ PERSONNE, jamais « tout le monde » par defaut.
 *
 * Le jour ou la generation sera reliee aux credits de Studiio, cette liste disparaitra :
 * c'est le credit qui autorisera la depense, compte par compte.
 */
export function compteAutoriseADepenser(userId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!userId) return false;
  const liste = env.CINEMA_GENERATION_REELLE_COMPTES;
  if (!liste) return false;
  return liste.split(',').map((x) => x.trim()).filter(Boolean).includes(userId);
}

/**
 * QUEL FOURNISSEUR, DECIDE PAR LE SERVEUR — et par lui seul.
 *
 * Le navigateur envoyait l'identifiant du fournisseur. Il ne le choisit plus : une
 * generation REELLE depense l'argent du compte Replicate, et aucun corps de requete ne
 * doit pouvoir la declencher. L'ordre est fixe :
 *
 *   1. generation REELLE si elle est autorisee (`CINEMA_GENERATION_REELLE` + jeton) ;
 *   2. sinon generation SIMULEE si elle est autorisee (developpement, tests) ;
 *   3. sinon `null` : aucune generation n'est proposee ni possible (la production).
 */
export function fournisseurServeur(
  operation: OperationGeneration, userId: string | null | undefined, env: NodeJS.ProcessEnv = process.env,
): { id: string; mode: ModeGeneration } | null {
  // REELLE : interrupteur + jeton + CE COMPTE explicitement autorise a depenser.
  if (generationReelleActive(env) && compteAutoriseADepenser(userId, env)) {
    return { id: operation === 'video' ? ID_REPLICATE_VIDEO : ID_REPLICATE_IMAGE, mode: 'reelle' };
  }
  if (generationIaSimuleeActive(env)) return { id: ID_FOURNISSEUR_SIMULE, mode: 'simulee' };
  return null;
}

/** Le mode annonce a l'ecran, POUR CE COMPTE : `null` = aucun bouton de generation. */
export function modeGenerationAffiche(userId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): ModeGeneration | null {
  return fournisseurServeur('image', userId, env)?.mode ?? null;
}
