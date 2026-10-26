/**
 * MONTAGE AMÉLIORÉ — activation réservée à l'ADMINISTRATEUR (Créer ET Autopilote).
 *
 * Une seule décision, prise CÔTÉ SERVEUR à partir du compte relu EN BASE, pour les cinq
 * corrections regroupées sous « montage amélioré » :
 *   - sélection multi-rushs (un seul extrait net suffit à monter) et exclusion des rushs flous
 *     (`netteteCommune`, repli du montage simple sans rush flou) ;
 *   - avertissements de durée insuffisante dans les replis (Autopilote, aperçu et export de Créer) ;
 *   - protection des passages parlés (`protectionParole`) ;
 *   - contrôle qualité du MP4 final (Autopilote, MP4 durable de Créer).
 *
 * Vrai SEULEMENT si :
 *   1. l'interrupteur serveur `STUDIIO_MONTAGE_AMELIORE_ENABLED` vaut exactement `"true"`
 *      (jamais `NEXT_PUBLIC_*`) — absent ou autre chose : ÉTEINT POUR TOUS, c'est le retour
 *      arrière rapide (retirer la variable, redémarrer ; aucune donnée à toucher) ;
 *   2. l'identifiant du compte est EXACTEMENT celui de `STUDIIO_MONTAGE_AMELIORE_USER_ID`
 *      (un seul compte testeur) : variable absente, vide ou différente ⇒ REFUSÉ, y compris
 *      pour les autres administrateurs ;
 *   3. le compte est administrateur : rôle `admin` OU e-mail administrateur, relus EN BASE
 *      (`compteExempteDeCredits`, la MÊME règle que les exemptions avatar / IA / Autopilote) —
 *      jamais la session, jamais le corps ou l'URL d'une requête.
 * Toute erreur, base injoignable, compte inconnu ⇒ FAUX : le comportement de la production.
 *
 * Aucun réglage du navigateur n'active quoi que ce soit : le navigateur de Créer reçoit la
 * réponse de la route serveur `/api/creer/montage-ameliore`, et les traitements serveur
 * (Autopilote, MP4 durable) relisent la décision eux-mêmes. ⚠️ Le plan de montage de Créer est
 * calculé dans le navigateur, sur les rushs du compte : la route n'est pas une frontière de
 * sécurité pour ce calcul (comme `montage-config`) — elle décide de ce qui est PROPOSÉ ; le
 * contrôle du MP4 et tout ce qui est écrit en base sont, eux, décidés par le serveur.
 *
 * Aucun crédit, aucun paiement, aucun fournisseur : cette décision ne les touche pas.
 */
import { compteExempteDeCredits } from '@/lib/facturation/exemption';

export function montageAmelioreServeurActif(env: Record<string, string | undefined> = process.env): boolean {
  return env.STUDIIO_MONTAGE_AMELIORE_ENABLED === 'true';
}

/** Vrai seulement si `userId` est exactement l'identifiant du compte testeur (variable non vide). */
export function compteTesteurMontageAmeliore(
  userId: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const cible = env.STUDIIO_MONTAGE_AMELIORE_USER_ID;
  return typeof cible === 'string' && cible.length > 0 && userId === cible;
}

export async function montageAmelioreActifPourCompte(
  userId: string | null | undefined,
  deps: { env?: Record<string, string | undefined>; estAdmin?: (id: string) => Promise<boolean> } = {},
): Promise<boolean> {
  try {
    if (!userId) return false;
    const env = deps.env ?? process.env;
    if (!montageAmelioreServeurActif(env)) return false;
    if (!compteTesteurMontageAmeliore(userId, env)) return false;
    return (await (deps.estAdmin ?? compteExempteDeCredits)(userId)) === true;
  } catch {
    return false;
  }
}
