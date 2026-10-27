/**
 * MONTAGE AMÉLIORÉ — ACTIF POUR TOUT UTILISATEUR CONNECTÉ, par défaut.
 *
 * Une seule décision, prise CÔTÉ SERVEUR, pour les cinq corrections regroupées sous
 * « montage amélioré » :
 *   - sélection multi-rushs (un seul extrait net suffit à monter) et exclusion des rushs flous
 *     (`netteteCommune`, repli du montage simple sans rush flou) ;
 *   - avertissements de durée insuffisante dans les replis (Autopilote, aperçu et export de Créer) ;
 *   - protection des passages parlés (`protectionParole`) ;
 *   - contrôle qualité du MP4 final (Autopilote, MP4 durable de Créer).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PLUS DE RÉSERVE À QUELQUES COMPTES
 * ─────────────────────────────────────────────────────────────────────────
 * Ces corrections sont le comportement NORMAL du produit : il n'y a ni rôle, ni liste de comptes,
 * ni essai privé. La liste blanche `STUDIIO_MONTAGE_AMELIORE_COMPTES` a été retirée — une variable
 * qui traîne n'éteint plus rien et ne réserve plus rien (décision du propriétaire, 27/10/2026 :
 * tout développement vise directement tous les utilisateurs).
 *
 * Vrai SEULEMENT si :
 *   1. un utilisateur authentifié est connu (identifiant issu de la session ou du propriétaire du
 *      post, jamais du corps ni de l'URL d'une requête) — pas d'utilisateur ⇒ FAUX ;
 *   2. l'ARRÊT D'URGENCE n'est pas tiré : `STUDIIO_MONTAGE_AMELIORE_ENABLED` ne vaut pas
 *      « false » / « 0 » / « off » / « no » (casse et espaces indifférents).
 *      Variable ABSENTE ⇒ ACTIF. C'est le seul interrupteur, et il est volontairement tolérant :
 *      un arrêt d'urgence doit obéir à la première chose qu'on y écrit pour couper.
 *
 * Retour arrière en production : poser `STUDIIO_MONTAGE_AMELIORE_ENABLED=false` puis redémarrer.
 * Aucune donnée à toucher, aucun déploiement à refaire.
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
export const VARIABLE_ARRET = 'STUDIIO_MONTAGE_AMELIORE_ENABLED';

/** Valeurs qui COUPENT le montage amélioré. Tout le reste (y compris l'absence) le laisse actif. */
const VALEURS_ARRET = new Set(['false', '0', 'off', 'no', 'non']);

/** L'arrêt d'urgence est-il relâché ? (variable absente : oui, le montage amélioré est actif) */
export function montageAmelioreServeurActif(env: Record<string, string | undefined> = process.env): boolean {
  const v = env[VARIABLE_ARRET];
  if (v === undefined) return true;
  return !VALEURS_ARRET.has(v.trim().toLowerCase());
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
