/**
 * L'AVATAR COMME PERSONNAGE PRINCIPAL DE L'AUTOPILOTE — règles PURES.
 *
 * Aucune nouvelle colonne : « Faire apparaître mon avatar » EST le réglage
 * existant `jumeauAvatar` (colonne `jumeau_avatar`). Le serveur l'accepte déjà
 * sans rush (`decideRun(… allowWithoutRush: config.jumeauAvatar)`, refus 422
 * de « Produire maintenant » levé quand `jumeauAvatar`). Ce module dit à
 * l'ÉCRAN la même chose que le moteur — rien de plus.
 *
 * ⚠️ CE QUE LE RENDU CONTIENT VRAIMENT (`produireUnMontage`, à ce jour) :
 * quand la vidéo du jumeau est montée, elle tient SEULE la séquence « Vidéo »
 * — AUCUN rush (personnel ou stock) n'est monté avec elle. Les rushes de la
 * banque ne servent alors que de REPLI : si la génération de l'avatar échoue,
 * le montage sort sans lui (`rendreSansJumeau`), avec un rush de la banque
 * s'il y en a. L'écran le dit tel quel ; il n'annonce jamais un mélange
 * avatar + rushes que le moteur ne produit pas.
 */

/**
 * L'avatar est-il prêt pour les montages ? `null` = pas encore vérifié (ou
 * vérification impossible) : l'écran ne conclut rien.
 */
export type AvatarPret = boolean | null;

export type MotifBlocageRushes = 'sans-rush' | 'avatar-non-pret' | 'avatar-en-verification';

export interface ValidationEtapeRushes {
  bloque: boolean;
  motif: MotifBlocageRushes | null;
  /** La phrase affichée à côté du bouton « Continuer » (vide si rien ne bloque). */
  message: string;
}

/** Les phrases — une seule source pour l'écran et les tests. */
export const MESSAGES_RUSHES = {
  sansRush: 'Ajoutez au moins un rush pour continuer',
  avatarNonPret: 'Aucun avatar prêt : configurez votre avatar, ou décochez « Faire apparaître mon avatar ».',
  avatarEnVerification: 'Vérification de votre avatar…',
  avatarSeul: 'Votre vidéo utilisera uniquement votre avatar. Activez “Compléter automatiquement mes rushes” pour ajouter des plans stock.',
} as const;

/**
 * L'étape Rushes peut-elle être franchie ?
 *
 *   - avatar NON demandé : la règle historique, à l'identique — au moins un rush ;
 *   - avatar demandé et prêt : valide, avec ou sans rush ;
 *   - avatar demandé mais pas prêt : bloqué, explicitement (le montage
 *     échouerait au lancement du jumeau — on le dit avant) ;
 *   - avatar demandé, vérification en cours : bloqué SEULEMENT sans rush
 *     (avec des rushes, le doute ne retire rien à l'écran d'avant).
 *
 * Le stock seul (0 rush, avatar non demandé) reste bloqué : une proposition
 * stock n'est pas un rush tant qu'elle n'est pas « Conservée ».
 */
export function validerEtapeRushes(input: {
  nbRushes: number;
  avatarDemande: boolean;
  avatarPret: AvatarPret;
}): ValidationEtapeRushes {
  const { nbRushes, avatarDemande, avatarPret } = input;
  if (avatarDemande) {
    if (avatarPret === false) return { bloque: true, motif: 'avatar-non-pret', message: MESSAGES_RUSHES.avatarNonPret };
    if (avatarPret === null && nbRushes === 0) {
      return { bloque: true, motif: 'avatar-en-verification', message: MESSAGES_RUSHES.avatarEnVerification };
    }
    return { bloque: false, motif: null, message: '' };
  }
  if (nbRushes === 0) return { bloque: true, motif: 'sans-rush', message: MESSAGES_RUSHES.sansRush };
  return { bloque: false, motif: null, message: '' };
}

/** L'avatar peut-il, à lui seul, porter la production (aucun rush) ? */
export function avatarPorteLaProduction(avatarDemande: boolean, avatarPret: AvatarPret): boolean {
  return avatarDemande && avatarPret === true;
}

export type ContenuRendu = 'rien' | 'rushes' | 'avatar-seul' | 'avatar-rushes-en-repli';

/** Ce que contiendra la séquence « Vidéo » des montages, dit honnêtement. */
export function contenuRendu(input: { nbRushes: number; avatar: boolean }): { cas: ContenuRendu; phrase: string } {
  const { nbRushes, avatar } = input;
  if (avatar && nbRushes === 0) {
    return { cas: 'avatar-seul', phrase: 'La séquence Vidéo sera votre avatar parlant, seul.' };
  }
  if (avatar) {
    return {
      cas: 'avatar-rushes-en-repli',
      phrase: 'La séquence Vidéo sera votre avatar parlant. Vos rushes ne sont pas montés avec lui : '
        + 'ils servent si l’avatar ne peut pas être généré.',
    };
  }
  if (nbRushes > 0) return { cas: 'rushes', phrase: 'La séquence Vidéo sera montée avec vos rushes.' };
  return { cas: 'rien', phrase: 'Aucun média : rien ne sera produit.' };
}
