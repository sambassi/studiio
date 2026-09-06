/**
 * LOT 2B ÉTAPE 4C — « MON OBJECTIF » : L'OBJECTIF PAR DÉFAUT DU COMPTE.
 *
 * ---------------------------------------------------------------------------
 * AUCUNE TABLE, AUCUNE MIGRATION — LA PLACE ÉTAIT DÉJÀ RÉSERVÉE
 * ---------------------------------------------------------------------------
 *
 * `AutopilotDesignStyle.objectifParDefaut` existe depuis le Lot 2B étape 1,
 * `sanitizeDesignStyle` le valide déjà, et `CLES_DESIGN_STYLE_HORS_CONFIG` le
 * protège déjà de l'écran de configuration. Ce module ne fait que lire et
 * écrire cette clé : il n'invente ni table, ni colonne, ni schéma.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ L'ÉCRITURE EST ATOMIQUE, OU N'EST PAS
 * ---------------------------------------------------------------------------
 *
 * Contrairement à « Mon style », l'objectif ne passe JAMAIS par le repli
 * lire-modifier-écrire. La raison est une question de moment : un style
 * s'enregistre quand un humain clique, un objectif s'enregistre pendant
 * qu'une vidéo se fabrique — une recette audio, un format de montage ou un
 * profil créatif peuvent tomber au même instant, et un repli les perdrait
 * sans un mot.
 *
 * Tant que la fonction SQL manque, cette porte répond « pas encore
 * disponible ». C'est un refus visible plutôt qu'une perte invisible.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ LE `userId` VIENT DE LA SESSION, JAMAIS DU CORPS
 * ---------------------------------------------------------------------------
 *
 * Les deux fonctions filtrent sur l'identifiant qu'on leur passe, et aucune
 * route ne doit leur passer une valeur venue du navigateur. Lire ou écrire
 * l'objectif d'autrui n'est pas « interdit » : c'est inexprimable.
 */
import {
  fusionnerDesignStyleStrict, lireStyleDuCompte, styleDuCompteDisponible,
} from './profil-compte';
import {
  normaliserObjectif, objectifEffectif, estObjectifGenerique,
  type ObjectifCommunication, type ObjectifPartiel,
} from './objectif-communication';

/**
 * L'objectif habituel du compte, ou `null`.
 *
 * ⚠️ `null` ET NON `OBJECTIF_DEFAUT`, exactement comme pour le profil créatif.
 * `null` dit « ce compte n'a jamais rien déclaré » — donc `m3g-v2`, donc le
 * montage d'avant ce lot. Rendre l'objectif générique ferait la même chose
 * par coïncidence, et cesserait de la faire au premier défaut qu'on
 * changerait.
 */
export async function lireObjectifCommunicationUtilisateur(
  userId: string,
): Promise<ObjectifCommunication | null> {
  if (!userId) return null;
  const style = await lireStyleDuCompte(userId);
  const o = style.objectifParDefaut;
  if (!o) return null;
  // Un objectif enregistré qui ne demande rien est un objectif absent : le
  // distinguer ferait calculer une identité de plan pour rien.
  return estObjectifGenerique(o) ? null : normaliserObjectif(o);
}

export type EcritureObjectif =
  | { ok: true; objectif: ObjectifCommunication }
  | { ok: false; motif: 'store_indisponible' | 'ecriture_non_atomique' | 'ecriture_impossible' };

/**
 * Enregistre « Mon objectif ».
 *
 * ⚠️ APPELÉE PAR UNE ACTION EXPLICITE, ET PAR ELLE SEULE. Aucun rendu, aucun
 * plan de montage, aucun override de vidéo n'appelle cette fonction. Un
 * objectif essayé sur une seule vidéo ne doit pas redéfinir l'intention du
 * compte à l'insu de son propriétaire — la règle vaut pour l'objectif comme
 * elle valait pour le style, et c'est ici qu'elle se tient.
 */
export async function enregistrerObjectifCommunicationUtilisateur(
  userId: string, objectif: ObjectifPartiel | ObjectifCommunication | null,
): Promise<EcritureObjectif> {
  if (!userId) return { ok: false, motif: 'ecriture_impossible' };
  if (!(await styleDuCompteDisponible())) return { ok: false, motif: 'store_indisponible' };

  // ⚠️ NORMALISÉ AVANT D'ÉCRIRE. La base ne doit jamais porter une valeur que
  // `sanitizeDesignStyle` jetterait à la relecture : l'utilisateur verrait
  // son objectif disparaître sans un mot.
  const normalise = normaliserObjectif(objectif);

  // ⚠️ UNE SEULE CLÉ DANS LE PATCH. `montage`, `audio`, `profilCreatif` et
  // les polices ne sont ni relus ni réécrits : ils ne peuvent donc pas être
  // perdus, même enregistrés au même instant.
  const issue = await fusionnerDesignStyleStrict(userId, { objectifParDefaut: normalise });
  if (issue === 'non_atomique') return { ok: false, motif: 'ecriture_non_atomique' };
  if (issue !== 'ok') return { ok: false, motif: 'ecriture_impossible' };
  return { ok: true, objectif: normalise };
}

/**
 * L'objectif EFFECTIF d'une vidéo — la règle complète, en un seul endroit.
 *
 *     générique  ⊕  objectif du compte  ⊕  override de la vidéo
 *
 * ⚠️ L'OVERRIDE REMPLACE, IL NE FUSIONNE PAS, et `objectif-communication` dit
 * pourquoi : un objectif est une INTENTION ENTIÈRE. Mêler « promouvoir un
 * événement » du compte avec « vendre un produit » de la vidéo donnerait un
 * événement affublé d'un prix produit — une intention que personne n'a
 * formulée.
 *
 * ⚠️ ET IL N'ÉCRIT RIEN. Cette fonction ne touche pas la base : l'objectif du
 * compte est exactement le même avant et après. Seule
 * `enregistrerObjectifCommunicationUtilisateur` le change.
 */
export async function objectifEffectifUtilisateur(
  userId: string,
  objectifVideo?: ObjectifPartiel | ObjectifCommunication | null,
): Promise<ObjectifCommunication> {
  const duCompte = await lireObjectifCommunicationUtilisateur(userId);
  return objectifEffectif(objectifVideo, duCompte);
}

export const MESSAGES_OBJECTIF_COMPTE: Record<
  'store_indisponible' | 'ecriture_non_atomique' | 'ecriture_impossible', string
> = {
  store_indisponible:
    'Ton objectif ne peut pas encore être enregistré : la mise à jour du serveur n’est pas terminée.',
  ecriture_non_atomique:
    'Ton objectif ne peut pas encore être enregistré sans risquer d’effacer ton style ou ton audio. '
    + 'La mise à jour du serveur n’est pas terminée.',
  ecriture_impossible: 'Ton objectif n’a pas pu être enregistré. Réessaie.',
};
