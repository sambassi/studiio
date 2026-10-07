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

/**
 * Jumeau VIDÉO (digital twin) — TEMPORAIREMENT réservé à l'admin : son
 * consentement passe par une page externe du fournisseur (niveau 1). Un
 * utilisateur ne doit jamais y être envoyé tant qu'un parcours 100 % Studiio
 * n'existe pas.
 */
export function jumeauVideoAutorise(admin: boolean): boolean {
  return admin;
}

/** Création d'avatar — messages UTILISATEUR. */
export const MESSAGES_CREATION = {
  echec: 'La création de votre avatar a échoué. Renvoyez votre photo ou votre vidéo.',
  indisponible: 'Le service Avatar est temporairement indisponible. Réessayez dans quelques minutes.',
  videoIndisponible: 'La création d’un avatar à partir d’une vidéo n’est pas encore disponible. Créez votre avatar à partir d’une photo.',
  consentementRequis: 'Votre avatar vidéo attend encore votre consentement. Aucun crédit Studiio n’a été débité.',
} as const;

/** Un texte destiné à l'utilisateur trahit-il un fournisseur ? (garde des tests et des réponses) */
const TRACES_FOURNISSEUR = /\bhey\s*gen\b|\bd-id\b|\beleven\s*labs\b|\breplicate\b|api\.heygen|api\.d-id|elevenlabs\.io|_API_KEY|HEYGEN_|DID_[A-Z]/i;
export function trahitUnFournisseur(texte: string | null | undefined): boolean {
  return !!texte && TRACES_FOURNISSEUR.test(texte);
}

/**
 * Le MOTIF lisible d'un refus fournisseur, extrait de son corps de réponse
 * brut (JSON ou texte) — ou `null`. Jamais le corps brut : seul le message
 * (« audio too short »…) est gardé, sans URL, borné, et écarté s'il nomme un
 * fournisseur, une clé ou une variable. Le corps complet reste aux journaux.
 */
export function motifLisibleDuFournisseur(corpsBrut: string | null | undefined): string | null {
  if (!corpsBrut) return null;
  let message: unknown = null;
  try {
    const o = JSON.parse(corpsBrut) as Record<string, unknown>;
    const d = o?.detail as Record<string, unknown> | string | undefined;
    const e = o?.error as Record<string, unknown> | string | undefined;
    message = (typeof d === 'object' && d ? d.message : d)
      ?? o?.message
      ?? (typeof e === 'object' && e ? e.message : e);
  } catch {
    message = null; // un corps non JSON (page d'erreur HTML…) n'est jamais relayé
  }
  // Une URL désigne toujours le fournisseur (sa doc, son API) : motif écarté.
  if (typeof message !== 'string' || /https?:\/\/|www\./i.test(message)) return null;
  const propre = message.replace(/\s+/g, ' ').trim().slice(0, 200);
  return propre && !trahitUnFournisseur(propre) ? propre : null;
}

/** Ce que l'écran peut afficher : le message neutre si le texte trahit un fournisseur. */
export function messageUtilisateurSur(texte: string | null | undefined, repli: string): string {
  return !texte || trahitUnFournisseur(texte) ? repli : texte;
}
