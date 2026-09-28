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

/**
 * Message d'un montage RENDU CÔTÉ SERVEUR (Autopilote, `serverRendered`).
 *
 * « Régénérer » n'existe pas pour ces posts : il recompose dans le navigateur
 * et écraserait le mp4 serveur par un WebM illisible (#313). La seule issue
 * est « Garder la vidéo actuelle », qui lève le blocage en connaissance de
 * cause — jamais en silence.
 */
export const MESSAGE_MONTAGE_PERIME_SERVEUR =
  'Cette vidéo a été modifiée après son rendu automatique et ne peut pas être régénérée ici. '
  + 'Ouvre-la dans le Calendrier et choisis « Garder la vidéo actuelle » pour la publier sans tes modifications.';

/** Montage produit par le rendu serveur (Autopilote) ? */
export function montageRenduServeur(metadata: unknown): boolean {
  return (
    typeof metadata === 'object'
    && metadata !== null
    && (metadata as Record<string, unknown>).serverRendered === true
  );
}

/** Le message à montrer pour CE post : il nomme l'issue réellement disponible. */
export function messageMontagePerime(metadata: unknown): string {
  return montageRenduServeur(metadata) ? MESSAGE_MONTAGE_PERIME_SERVEUR : MESSAGE_MONTAGE_PERIME;
}

/** `metadata.error` a-t-il été écrit par ce blocage (et lui seul) ? */
export function estErreurMontagePerime(erreur: unknown): boolean {
  return erreur === MESSAGE_MONTAGE_PERIME || erreur === MESSAGE_MONTAGE_PERIME_SERVEUR;
}

/**
 * Metadata à écrire quand le blocage est levé (nouveau rendu, ou « Garder la
 * vidéo actuelle ») : drapeau à `false`, et l'erreur retirée SEULEMENT si
 * c'est la nôtre — toute autre erreur reste affichée.
 */
export function leverMontagePerime(metadata: unknown): Record<string, unknown> {
  const base = (typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata))
    ? (metadata as Record<string, unknown>) : {};
  return {
    [CLE_MONTAGE_PERIME]: false,
    ...(estErreurMontagePerime(base.error) ? { error: null } : {}),
  };
}

/** Le montage rendu de ce post est-il périmé par un enregistrement ? */
export function montageEstPerime(metadata: unknown): boolean {
  return (
    typeof metadata === 'object'
    && metadata !== null
    && !Array.isArray(metadata)
    && (metadata as Record<string, unknown>)[CLE_MONTAGE_PERIME] === true
  );
}
