/**
 * Ce que l'ecran dit quand la grille de photos reste vide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * QUATRE RAISONS, UN SEUL MESSAGE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `/api/pexels` attrapait TOUTE erreur du fournisseur, la journalisait, et
 * rendait `{ success: true, photos: [] }`. L'ecran en concluait « Aucune
 * photo pour cette recherche » — ce qui est faux : la recherche n'a pas eu
 * lieu, elle a ete refusee.
 *
 * L'utilisateur reformulait alors sa requete, encore et encore, en croyant
 * mal chercher. C'est exactement ce que le message d'origine racontait, et
 * c'est la seule chose que la grille vide ne pouvait pas lui dire.
 *
 * Quatre etats distincts, donc :
 *
 *   `vide`          -- le fournisseur a repondu, il n'a rien ;
 *   `non-configure` -- la source n'a pas de cle sur ce serveur ;
 *   `auth`          -- la cle existe et le fournisseur la refuse ;
 *   `quota`         -- limite de requetes atteinte, temporairement ;
 *   `indisponible`  -- tout le reste : panne, reseau, reponse illisible.
 *
 * Trois d'entre eux valent la peine d'etre reessayes ; deux ne le valent
 * pas, et proposer « Reessayer » y serait une invitation a boucler.
 */

/** L'etat d'une recherche de photos, du point de vue de l'ecran. */
export type EtatPhotos =
  | 'vide' | 'non-configure' | 'auth' | 'quota' | 'indisponible';

/** Le motif renvoye par la route quand le fournisseur a refuse. */
export type EchecFournisseur = 'auth' | 'quota' | 'indisponible';

/** Nom affichable d'une source. */
export function nomSource(source: string): string {
  return source === 'unsplash' ? 'Unsplash' : 'Pexels';
}

/**
 * Traduit une reponse HTTP du fournisseur en motif.
 *
 * Aucun corps de reponse n'est relaye : un fournisseur peut y mettre
 * n'importe quoi, y compris un echo de la cle envoyee.
 */
export function motifPourStatut(statut: number): EchecFournisseur {
  if (statut === 401 || statut === 403) return 'auth';
  if (statut === 429) return 'quota';
  return 'indisponible';
}

/** Normalise ce que la route a renvoye. Tout l'inconnu devient `vide`. */
export function etatDepuisReponse(reponse: unknown): EtatPhotos {
  const d = (reponse ?? {}) as Record<string, unknown>;
  if (d.configured === false) return 'non-configure';
  const echec = d.echec;
  if (echec === 'auth' || echec === 'quota' || echec === 'indisponible') return echec;
  return 'vide';
}

/**
 * Le message montre a l'utilisateur.
 *
 * Aucun code HTTP, aucun nom de variable d'environnement, aucune trace de
 * cle : ce qui aide ici, c'est de savoir s'il faut reformuler, attendre, ou
 * prevenir quelqu'un.
 */
export function messagePhotos(etat: EtatPhotos, source: string): string {
  const nom = nomSource(source);
  switch (etat) {
    case 'non-configure':
      return `${nom} n’est pas configuré sur ce serveur.`;
    case 'auth':
      return `${nom} refuse l’accès : la configuration du serveur doit être vérifiée.`;
    case 'quota':
      return `Limite de recherches atteinte chez ${nom}. Réessayez dans quelques minutes.`;
    case 'indisponible':
      return `${nom} est momentanément indisponible.`;
    default:
      return 'Aucune photo pour cette recherche.';
  }
}

/**
 * Proposer « Reessayer » ?
 *
 * Pas quand la source n'est pas configuree — la cle n'apparaitra pas d'un
 * clic. Pas non plus quand le fournisseur a simplement repondu sans
 * resultat : c'est la requete qu'il faut changer, pas la repeter.
 */
export function reessayable(etat: EtatPhotos): boolean {
  return etat === 'quota' || etat === 'indisponible' || etat === 'auth';
}
