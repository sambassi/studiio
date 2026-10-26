/**
 * MONTAGE AMÉLIORÉ — Créer ET Autopilote, pour tout utilisateur CONNECTÉ quand il est activé.
 *
 * Une seule décision, prise CÔTÉ SERVEUR, pour les cinq corrections regroupées sous
 * « montage amélioré » :
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
 *   2. un utilisateur authentifié est connu (identifiant issu de la session ou du propriétaire
 *      du post, jamais du corps ou de l'URL d'une requête).
 * Aucun rôle ni identifiant particulier n'est exigé. Pas d'utilisateur ⇒ FAUX.
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
export function montageAmelioreServeurActif(env: Record<string, string | undefined> = process.env): boolean {
  return env.STUDIIO_MONTAGE_AMELIORE_ENABLED === 'true';
}

export async function montageAmelioreActifPourCompte(
  userId: string | null | undefined,
  deps: { env?: Record<string, string | undefined> } = {},
): Promise<boolean> {
  try {
    if (!userId) return false;
    return montageAmelioreServeurActif(deps.env ?? process.env);
  } catch {
    return false;
  }
}
