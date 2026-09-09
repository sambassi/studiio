import { estEtatPret } from '@/lib/avatar/etats';
import { SUJET_AVATAR } from '@/lib/avatar/contrat';

/**
 * A_8f — « UTILISER MON CLONE DANS AUTOPILOTE ».
 *
 * ═════════════════════════════════════════════════════════════════════════
 * CE QUE CE MODULE DECIDE, ET POURQUOI IL EST PUR
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Laisser un moteur automatique parler avec le VISAGE et la VOIX de quelqu'un
 * est le geste le plus lourd du produit. Il ne peut pas dependre d'une lecture
 * faite au bon endroit par le bon appelant : la decision vit ici, en une seule
 * fonction, sans base et sans reseau, pour qu'elle soit verifiable sur des
 * valeurs plutot que lue dans une chaine de six cents lignes.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠️ TROIS REGLES QUI NE SE NEGOCIENT PAS
 * ═════════════════════════════════════════════════════════════════════════
 *
 * 1. ETEINT PAR DEFAUT. Aucun compte existant ne se reveille avec son clone
 *    activé. Creer un enrollment n'active rien ; valider son clone n'active
 *    rien non plus. Seul un geste explicite le fait.
 *
 * 2. AUCUN REPLI SILENCIEUX. Si la configuration ne tient pas — clone non
 *    valide, voix absente, avatar supprime —, le chemin rend un MOTIF NOMME.
 *    Il ne retombe pas sur une video ordinaire : quelqu'un qui a demande son
 *    clone doit apprendre qu'il ne l'a pas eu, pas recevoir autre chose sans
 *    le savoir.
 *
 * 3. AUCUN HASARD SUR L'IDENTITE. Le mode creatif variable fait tourner les
 *    LUT, les transitions, la musique — jamais l'avatar ni la voix. Ce module
 *    ne tire rien au sort, et c'est structurel : il n'a pas de graine.
 */

/** L'identite d'une personne numerique, telle qu'elle est rangee. */
export interface ConfigJumeauNumerique {
  /** ⚠️ `false` PAR DEFAUT, POUR TOUT LE MONDE. */
  active: boolean;
  /** L'avatar interne choisi. `null` tant qu'aucun. */
  avatarId: string | null;
  /**
   * La version INTERNE du clone, pas un numero fournisseur.
   *
   * ⚠️ ELLE NE BOUGE PAS QUAND ON REMPLACE SA VIDEO SOURCE. Une source prete
   * n'est pas encore une version de personne numerique : ce sont des
   * candidats. La version change quand un entrainement REEL produit une autre
   * identite — ce que fera A_8_FINAL.
   */
  avatarVersion: number | null;
  /**
   * La voix de la personne, par son identifiant INTERNE (`user_voices.id`).
   *
   * ⚠️ SURTOUT PAS UN `voiceId` DE CATALOGUE. Le catalogue d'un fournisseur
   * est partage par tous les comptes ; seule cette table dit a qui une voix
   * appartient. Ranger un identifiant de catalogue reviendrait a autoriser
   * n'importe quelle voix sous le nom de la personne.
   */
  userVoiceId: string | null;
}

export const JUMEAU_DESACTIVE: ConfigJumeauNumerique = Object.freeze({
  active: false, avatarId: null, avatarVersion: null, userVoiceId: null,
});

/** Un identifiant tel que la base en produit. Rien d'autre n'entre. */
const IDENTIFIANT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const identifiant = (v: unknown): string | null =>
  (typeof v === 'string' && IDENTIFIANT.test(v) ? v : null);

const version = (v: unknown): number | null => (
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10_000 ? v : null
);

/**
 * Relit la configuration rangee en base.
 *
 * ⚠️ UNE VALEUR ILLISIBLE REND LA CONFIGURATION ETEINTE, PAS UNE MOITIE.
 * Un `active: true` accompagne d'un avatar illisible activerait un clone que
 * personne ne peut designer ; on prefere l'eteindre et le redire a l'ecran.
 */
export function lireConfigJumeau(brut: unknown): ConfigJumeauNumerique {
  if (!brut || typeof brut !== 'object') return { ...JUMEAU_DESACTIVE };
  const o = brut as Record<string, unknown>;
  const avatarId = identifiant(o.avatarId);
  const config: ConfigJumeauNumerique = {
    active: o.active === true && avatarId !== null,
    avatarId,
    avatarVersion: version(o.avatarVersion),
    userVoiceId: identifiant(o.userVoiceId),
  };
  return config;
}

/** La configuration est-elle celle d'origine — c'est-a-dire aucune ? */
export function jumeauHistorique(c: ConfigJumeauNumerique | null | undefined): boolean {
  return !c || (!c.active && c.avatarId === null
    && c.avatarVersion === null && c.userVoiceId === null);
}

/* ═════════════════════════════════════════════════════════════════════════
   LE PORTAIL — CE QUI EST VRAI AU MOMENT DE GENERER
   ═════════════════════════════════════════════════════════════════════════ */

/**
 * Pourquoi la personne numerique n'a pas pu servir.
 *
 * ⚠️ UNE LISTE FERMEE, ET AUCUN « ERREUR ». Chacun de ces etats est un etat
 * UTILISATEUR normal — pas une panne. Les confondre ferait sonner une alarme
 * technique pour quelqu'un qui n'a simplement pas encore enregistre sa voix.
 */
export const MOTIFS_JUMEAU = [
  'avatar_absent',
  'avatar_etranger',
  'avatar_supprime',
  'avatar_non_entraine',
  'clone_non_valide',
  'sujet_non_self',
  'version_absente',
  'voix_absente',
  'voix_etrangere',
] as const;
export type MotifJumeau = (typeof MOTIFS_JUMEAU)[number];

/** L'identite qui part dans le rendu quand la personne numerique sert. */
export interface IdentiteJumeau {
  avatarId: string;
  avatarVersion: number;
  userVoiceId: string;
}

export type IssueJumeau =
  | { etat: 'desactive' }
  | { etat: 'pret'; identite: IdentiteJumeau }
  | { etat: 'bloque'; motif: MotifJumeau };

/** Ce que le portail a besoin de savoir de l'avatar, et rien de plus. */
export interface AvatarPourJumeau {
  id?: unknown;
  user_id?: unknown;
  status?: unknown;
  provider_avatar_id?: unknown;
  validated_at?: unknown;
  deleted_at?: unknown;
  subject_type?: unknown;
  version?: unknown;
}

/** Ce que le portail a besoin de savoir de la voix. */
export interface VoixPourJumeau {
  id?: unknown;
  user_id?: unknown;
  provider_voice_id?: unknown;
  consent_at?: unknown;
}

/**
 * LA PERSONNE NUMERIQUE PEUT-ELLE SERVIR POUR CETTE GENERATION ?
 *
 * ⚠️ TOUT EST VERIFIE ICI, MEME CE QUI L'A DEJA ETE A L'ACTIVATION. Un compte
 * peut avoir active son clone il y a un mois, puis avoir supprime sa voix ou
 * remplace sa video : la configuration rangee dit ce que la personne a
 * DEMANDE, jamais ce qui est vrai aujourd'hui.
 *
 * ⚠️ ET LA PROPRIETE EST VERIFIEE SUR LES LIGNES, PAS SUR LA CONFIGURATION.
 * Un `avatarId` range en base ne prouve rien : c'est la ligne relue qui porte
 * son `user_id`.
 */
export function resoudreJumeauPourGeneration(entree: {
  config: ConfigJumeauNumerique | null | undefined;
  userId: string;
  avatar: AvatarPourJumeau | null | undefined;
  voix: VoixPourJumeau | null | undefined;
}): IssueJumeau {
  const { config, userId, avatar, voix } = entree;
  if (!config?.active || !config.avatarId || !userId) return { etat: 'desactive' };

  if (!avatar || avatar.id !== config.avatarId) return { etat: 'bloque', motif: 'avatar_absent' };
  if (avatar.user_id !== userId) return { etat: 'bloque', motif: 'avatar_etranger' };
  if (avatar.deleted_at) return { etat: 'bloque', motif: 'avatar_supprime' };
  if (avatar.subject_type !== SUJET_AVATAR) return { etat: 'bloque', motif: 'sujet_non_self' };

  /* Un identifiant chez le fournisseur, sinon il n'y a pas de clone : une
     source prete n'a jamais rencontre de moteur d'entrainement. */
  const chezFournisseur = typeof avatar.provider_avatar_id === 'string'
    && avatar.provider_avatar_id.length > 0;
  if (!chezFournisseur || !estEtatPret(avatar.status)) {
    return { etat: 'bloque', motif: 'avatar_non_entraine' };
  }

  /* ⚠️ LA VALIDATION HUMAINE EST UNE CONDITION D'USAGE, PAS UNE FORMALITE
     D'INSCRIPTION. Personne ne fait parler un clone que son proprietaire n'a
     pas regarde et accepte. */
  const valide = typeof avatar.validated_at === 'string' && avatar.validated_at.length > 0;
  if (!valide) return { etat: 'bloque', motif: 'clone_non_valide' };

  const v = typeof avatar.version === 'number' && Number.isInteger(avatar.version)
    && avatar.version >= 1 ? avatar.version : null;
  if (v === null) return { etat: 'bloque', motif: 'version_absente' };

  /* ⚠️ SANS VOIX REELLE, RIEN NE PART. C'est la garde qui empeche la pire
     sortie possible : une video du visage de la personne, parlant avec une
     voix qui n'est pas la sienne. */
  if (!config.userVoiceId) return { etat: 'bloque', motif: 'voix_absente' };
  if (!voix || voix.id !== config.userVoiceId) return { etat: 'bloque', motif: 'voix_absente' };
  if (voix.user_id !== userId) return { etat: 'bloque', motif: 'voix_etrangere' };
  const voixUtilisable = typeof voix.provider_voice_id === 'string'
    && voix.provider_voice_id.length > 0
    && typeof voix.consent_at === 'string' && voix.consent_at.length > 0;
  if (!voixUtilisable) return { etat: 'bloque', motif: 'voix_absente' };

  return {
    etat: 'pret',
    identite: {
      avatarId: config.avatarId,
      avatarVersion: v,
      userVoiceId: config.userVoiceId,
    },
  };
}

/** Ce que la personne lit quand son clone n'a pas pu servir. */
export const MESSAGES_JUMEAU: Record<MotifJumeau, string> = {
  avatar_absent: 'Votre clone est introuvable.',
  avatar_etranger: 'Votre clone est introuvable.',
  avatar_supprime: 'Votre clone a été supprimé.',
  avatar_non_entraine: 'Votre clone n’a pas encore été entraîné.',
  clone_non_valide: 'Regardez et validez votre clone avant de l’activer.',
  sujet_non_self: 'Un clone ne peut représenter que vous-même.',
  version_absente: 'La version de votre clone est inconnue.',
  voix_absente: 'Votre voix doit être configurée avant d’utiliser votre clone.',
  voix_etrangere: 'Cette voix ne vous appartient pas.',
};
