/**
 * Cle `bucket/<uid>/<dossier>/…` d'un fichier de BIBLIOTHEQUE utilisateur :
 * musique et voix (bucket `audio`), rushes importes (`media/<uid>/library/`).
 * Ces fichiers sont reutilises d'un contenu a l'autre (et par le brouillon
 * Creer, invisible du serveur) : supprimer un post ne doit pas les emporter.
 */
export function estMediaDeBibliotheque(cle: string): boolean {
  return /^audio\/[^/]+\/(music|voice)\//.test(cle) || /^media\/[^/]+\/library\//.test(cle);
}

/**
 * Fichiers DURABLES, jamais purgés par la rétention temporaire :
 *
 * ⚠️ UNIQUEMENT HORS DES DOSSIERS `<userId>/` : les envois navigateur ne
 * peuvent écrire que là (garde `startsWith(userId + '/')` des routes
 * d'envoi). Un motif DANS le dossier utilisateur se laisserait imiter par un
 * nom de fichier choisi par le client — et deviendrait du stockage permanent
 * gratuit.
 *
 * - l'audio complet PAYÉ (`audio/audio-complet/<uid>/<empreinte>.mp3`,
 *   `/api/voice/audio-complet`) — l'utilisateur a payé des crédits : le
 *   re-télécharger ne doit coûter ni un nouvel appel fournisseur, ni un
 *   nouveau crédit. La pré-écoute gratuite n'est jamais stockée.
 * - l'attribution d'un média stock (`media/stock-attributions/<uid>/…json`) —
 *   quelques octets qui gardent la licence d'un média importé.
 */
export function estFichierDurable(cle: string): boolean {
  return /^audio\/audio-complet\/[^/]+\/[0-9a-f]{24}\.mp3$/.test(cle)
    || /^media\/stock-attributions\/[^/]+\/[^/]+\.json$/.test(cle);
}
