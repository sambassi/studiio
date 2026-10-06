/**
 * Fournisseurs d'avatar — UNE abstraction pour « Mon jumeau ».
 *
 * Le parcours (Créer, Autopilote, suivi, facturation) ne parle qu'à
 * `AvatarProvider`. Changer de fournisseur = changer `fournisseurPrincipal`,
 * pas le parcours.
 *
 *  - HeyGen  : fournisseur PRINCIPAL. Tout nouvel avatar y est créé.
 *  - D-ID    : LEGACY. Les avatars existants ne sont ni supprimés ni migrés,
 *              mais D-ID n'est plus JAMAIS appelé (donc jamais payé) sans la
 *              décision explicite `AVATAR_DID_LEGACY_ACTIF=1`.
 *
 * Le fournisseur est INVISIBLE pour l'utilisateur : aucun nom, prix, URL ni
 * erreur brute de fournisseur ne sort vers l'écran. Les détails vont aux
 * journaux serveur et à l'administration uniquement.
 */
export type AvatarProvider = 'heygen' | 'did';
export const AVATAR_PROVIDERS: readonly AvatarProvider[] = ['heygen', 'did'];
export const PRIMARY_AVATAR_PROVIDER: AvatarProvider = 'heygen';

/** Le fournisseur des NOUVEAUX avatars. HeyGen, sauf décision explicite contraire. */
export function fournisseurPrincipal(env: NodeJS.ProcessEnv = process.env): AvatarProvider {
  return env.AVATAR_PROVIDER_PRINCIPAL?.trim() === 'did' ? 'did' : PRIMARY_AVATAR_PROVIDER;
}

/** D-ID (legacy) n'est appelé que sur décision explicite. */
export function didLegacyAutorise(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AVATAR_DID_LEGACY_ACTIF === '1' || fournisseurPrincipal(env) === 'did';
}

/** Messages UTILISATEUR — aucun nom de fournisseur, aucun détail technique. */
export const MESSAGES_AVATAR = {
  indisponible: 'Le service Avatar est temporairement indisponible. Aucun crédit Studiio n’a été débité.',
  echecAvantLancement: 'La génération de votre avatar a échoué. Aucun crédit Studiio n’a été débité.',
  echecRembourse: 'La génération de votre avatar a échoué. Vos crédits Studiio ont été recrédités.',
  echec: 'La génération de votre avatar a échoué.',
  voixIndisponible: 'Le service de voix est temporairement indisponible. Aucun crédit Studiio n’a été débité.',
  ancienMoteur: 'Votre avatar a été créé avec une ancienne version du service. Recréez-le dans « Mon avatar » pour l’utiliser dans vos vidéos. Aucun crédit Studiio n’a été débité. Votre voix reste utilisable pour la narration.',
  verificationTransitoire: 'Le statut de votre vidéo n’a pas pu être vérifié pour l’instant. Nouvel essai automatique.',
} as const;

/** Création d'avatar — messages UTILISATEUR. */
export const MESSAGES_CREATION = {
  echec: 'La création de votre avatar a échoué. Renvoyez votre photo ou votre vidéo.',
  indisponible: 'Le service Avatar est temporairement indisponible. Réessayez dans quelques minutes.',
} as const;

/** Un texte destiné à l'utilisateur trahit-il un fournisseur ? (garde des tests et des réponses) */
const TRACES_FOURNISSEUR = /\bhey\s*gen\b|\bd-id\b|\beleven\s*labs\b|\breplicate\b|api\.heygen|api\.d-id|elevenlabs\.io|_API_KEY|HEYGEN_|DID_[A-Z]/i;
export function trahitUnFournisseur(texte: string | null | undefined): boolean {
  return !!texte && TRACES_FOURNISSEUR.test(texte);
}

/** Ce que l'écran peut afficher : le message neutre si le texte trahit un fournisseur. */
export function messageUtilisateurSur(texte: string | null | undefined, repli: string): string {
  return !texte || trahitUnFournisseur(texte) ? repli : texte;
}
