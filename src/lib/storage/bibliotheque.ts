/**
 * Cle `bucket/<uid>/<dossier>/…` d'un fichier de BIBLIOTHEQUE utilisateur :
 * musique et voix (bucket `audio`), rushes importes (`media/<uid>/library/`).
 * Ces fichiers sont reutilises d'un contenu a l'autre (et par le brouillon
 * Creer, invisible du serveur) : supprimer un post ne doit pas les emporter.
 */
export function estMediaDeBibliotheque(cle: string): boolean {
  return /^audio\/[^/]+\/(music|voice)\//.test(cle) || /^media\/[^/]+\/library\//.test(cle);
}
