/**
 * Drapeau « le montage rendu ne correspond plus à la metadata ».
 *
 * Module PUR, sans aucune dépendance : il est importé à la fois par le client
 * (Calendrier, parcours guidé) et par le serveur (cron de publication, route
 * de publication manuelle). Ne rien y importer qui tire du code client.
 *
 * Posé par `metadataPourEnregistrement` quand un enregistrement change le
 * rendu ; retiré (`false`) par tout chemin qui écrit un nouveau
 * `renderedVideoUrl`. Absent — tous les posts antérieurs — il vaut « à jour » :
 * le comportement d'avant est inchangé.
 */
export const CLE_MONTAGE_PERIME = 'montagePerime';

/** Message montré à l'utilisateur quand une publication est bloquée. */
export const MESSAGE_MONTAGE_PERIME =
  'Cette vidéo a été modifiée. Régénère-la avant de la publier.';

/** Le montage rendu de ce post est-il périmé par un enregistrement ? */
export function montageEstPerime(metadata: unknown): boolean {
  return (
    typeof metadata === 'object'
    && metadata !== null
    && !Array.isArray(metadata)
    && (metadata as Record<string, unknown>)[CLE_MONTAGE_PERIME] === true
  );
}
