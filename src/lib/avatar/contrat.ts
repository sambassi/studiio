/**
 * Le contrat du clone vidéo — ce que la base de `main` sait déjà dire.
 *
 * Ce module ne parle à personne : ni base, ni stockage, ni fournisseur. Il
 * nomme les valeurs que la migration `2026-09-15-avatar-schema-foundation.sql`
 * a rendues possibles (`subject_type`, `consent_version`, `version`,
 * `validated_at`, `deleted_at`, `intention`) et DÉRIVE l'état d'un avatar de
 * sa ligne, au lieu de le stocker une seconde fois. Une seule source de
 * vérité : la ligne ; une seule façon de la lire : ici.
 *
 * Rien ici n'est branché sur une route : les écrans et les API actuels
 * continuent de lire les anciennes colonnes. Le branchement est AVATAR-2.
 */

// ─────────────────────────────────────────────────────────────────────────
// Le consentement — qui est la personne visible
// ─────────────────────────────────────────────────────────────────────────

/** Les deux seules valeurs que la contrainte `user_avatars_subject_type_check` accepte. */
export const SUJETS_AVATAR = ['self', 'third_party'] as const;
export type SujetAvatar = (typeof SUJETS_AVATAR)[number];

/** Le produit n'enrôle que la personne elle-même : le tiers reste refusé à l'entrée. */
export const SUJET_AVATAR: SujetAvatar = 'self';

/**
 * La version du texte de consentement. À CHANGER à chaque modification du
 * texte : c'est ce que `consent_version` enregistre, et ce qui permet de
 * savoir, plus tard, ce que la personne a réellement lu.
 */
export const VERSION_CONSENTEMENT = 'a8c-2026-09-09';

export const TEXTE_CONSENTEMENT =
  'Je certifie être la personne visible sur cette vidéo et j\'autorise Studiio à créer '
  + 'un clone vidéo de mon apparence pour générer des vidéos à ma demande. Je peux le '
  + 'supprimer à tout moment.';

export function estSujetAvatar(valeur: unknown): valeur is SujetAvatar {
  return typeof valeur === 'string' && (SUJETS_AVATAR as readonly string[]).includes(valeur);
}

// ─────────────────────────────────────────────────────────────────────────
// Les statuts — locaux et fournisseur
// ─────────────────────────────────────────────────────────────────────────

/**
 * Un statut LOCAL : la source est là, aucun fournisseur n'a été sollicité.
 * C'est ce que `provider_avatar_id` NULL rend possible depuis AVATAR-1A.
 */
export const ETAT_SOURCE_PRETE = 'source_ready';
export const ETATS_LOCAUX = [ETAT_SOURCE_PRETE] as const;

/** Les statuts que `main` écrit aujourd'hui depuis les réponses HeyGen. */
export const ETATS_FOURNISSEUR = ['processing', 'completed', 'ready', 'success', 'failed'] as const;

/** Trois orthographes fournisseur d'un seul fait : le modèle est entraîné. */
export const ETATS_PRETS = ['completed', 'ready', 'success'] as const;

export function estEtatLocal(statut: unknown): boolean {
  return typeof statut === 'string' && (ETATS_LOCAUX as readonly string[]).includes(statut);
}

export function estEtatPret(statut: unknown): boolean {
  return typeof statut === 'string' && (ETATS_PRETS as readonly string[]).includes(statut);
}

// ─────────────────────────────────────────────────────────────────────────
// L'intention d'une génération
// ─────────────────────────────────────────────────────────────────────────

export const INTENTION_APERCU = 'apercu';
export const INTENTION_NORMALE = 'normale';
export const INTENTIONS_GENERATION = [INTENTION_APERCU, INTENTION_NORMALE] as const;
export type IntentionGeneration = (typeof INTENTIONS_GENERATION)[number];

/** Lit une intention venue de la base ; tout inconnu (dont NULL) est « normale », comme la colonne. */
export function lireIntention(valeur: unknown): IntentionGeneration {
  return valeur === INTENTION_APERCU ? INTENTION_APERCU : INTENTION_NORMALE;
}

// ─────────────────────────────────────────────────────────────────────────
// La ligne `user_avatars`, telle que 1A l'a laissée
// ─────────────────────────────────────────────────────────────────────────

/** Les colonnes dont le domaine a besoin — pas la table entière. */
export interface AvatarLigne {
  id: string;
  user_id: string;
  status: string;
  provider_avatar_id: string | null;
  source_object_key: string | null;
  subject_type: string | null;
  consent_version: string | null;
  validated_at: string | null;
  version: number;
  deleted_at: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const texteOuNull = (v: unknown): v is string | null => v === null || typeof v === 'string';

/**
 * Une ligne lue en base est-elle un avatar DE CE COMPTE, bien formée ?
 *
 * La propriété se vérifie ici, une fois, avant toute décision : une ligne
 * d'un autre compte n'est pas « invalide », elle n'existe pas pour l'appelant.
 */
export function avatarLigneValide(brut: unknown, userId: string): brut is AvatarLigne {
  if (!brut || typeof brut !== 'object') return false;
  const l = brut as Record<string, unknown>;
  if (typeof l.id !== 'string' || !UUID.test(l.id)) return false;
  if (typeof l.user_id !== 'string' || l.user_id !== userId) return false;
  if (typeof l.status !== 'string' || l.status.length === 0) return false;
  if (!texteOuNull(l.provider_avatar_id)) return false;
  if (!texteOuNull(l.source_object_key)) return false;
  if (l.subject_type !== null && !estSujetAvatar(l.subject_type)) return false;
  if (!texteOuNull(l.consent_version)) return false;
  if (!texteOuNull(l.validated_at)) return false;
  if (!Number.isInteger(l.version) || (l.version as number) < 1) return false;
  if (!texteOuNull(l.deleted_at)) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// L'état dérivé — jamais stocké
// ─────────────────────────────────────────────────────────────────────────

export type EtatAvatar =
  | 'supprime'             // deleted_at posé : n'existe plus pour personne
  | 'source_prete'         // la source est là, aucun fournisseur sollicité
  | 'entrainement'         // le fournisseur travaille
  | 'entraine_non_valide'  // prêt chez le fournisseur, jamais regardé par la personne
  | 'valide'               // regardé et accepté
  | 'echec';               // le fournisseur a échoué (ou statut inconnu)

/**
 * L'ordre des règles EST le contrat :
 *   1. supprimé l'emporte sur tout ;
 *   2. « validé » exige d'être prêt : un `validated_at` sur un modèle non prêt
 *      (nouvelle version en cours) ne compte pas ;
 *   3. sans fournisseur, la source seule décide ;
 *   4. sinon, le statut fournisseur.
 */
export function etatAvatar(a: Pick<AvatarLigne, 'status' | 'provider_avatar_id' | 'validated_at' | 'deleted_at'>): EtatAvatar {
  if (a.deleted_at !== null) return 'supprime';
  if (estEtatPret(a.status) && a.provider_avatar_id !== null) {
    return a.validated_at !== null ? 'valide' : 'entraine_non_valide';
  }
  if (a.provider_avatar_id === null) {
    return a.status === ETAT_SOURCE_PRETE ? 'source_prete' : 'echec';
  }
  if (a.status === 'processing') return 'entrainement';
  return 'echec';
}

export function estActif(a: Pick<AvatarLigne, 'deleted_at'>): boolean {
  return a.deleted_at === null;
}

// ─────────────────────────────────────────────────────────────────────────
// La validation — ce qui manque avant de pouvoir accepter son clone
// ─────────────────────────────────────────────────────────────────────────

export type MotifValidation = 'supprime' | 'aucun_clone' | 'entrainement_en_cours' | 'apercu_absent' | 'deja_valide';

export const MESSAGES_VALIDATION: Record<MotifValidation, string> = {
  supprime: 'Ce clone a été supprimé.',
  aucun_clone: 'Aucun clone n’est encore entraîné pour cette version.',
  entrainement_en_cours: 'Le clone est encore en cours d’entraînement.',
  apercu_absent: 'Regardez d’abord l’aperçu de votre clone avant de le valider.',
  deja_valide: 'Ce clone est déjà validé.',
};

/**
 * Peut-on valider ce clone MAINTENANT ? L'aperçu est passé par l'appelant :
 * ce module ne sait pas où il vit (AVATAR-2 le produira), seulement qu'il faut
 * l'avoir vu.
 */
export function validationPossible(
  a: Pick<AvatarLigne, 'status' | 'provider_avatar_id' | 'validated_at' | 'deleted_at'>,
  apercuVu: boolean,
): { ok: true } | { ok: false; motif: MotifValidation } {
  const etat = etatAvatar(a);
  if (etat === 'supprime') return { ok: false, motif: 'supprime' };
  if (etat === 'valide') return { ok: false, motif: 'deja_valide' };
  if (etat === 'entrainement') return { ok: false, motif: 'entrainement_en_cours' };
  if (etat !== 'entraine_non_valide') return { ok: false, motif: 'aucun_clone' };
  if (!apercuVu) return { ok: false, motif: 'apercu_absent' };
  return { ok: true };
}
