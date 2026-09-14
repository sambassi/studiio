/**
 * A_8h — « UTILISER MON CLONE » DANS « CREER » : LES MOTS ET LA REGLE, SANS BASE.
 *
 * Module pur, partage par la route et par l'ecran : ce que la personne lit
 * pour chaque motif, et ce qui rend l'interrupteur actionnable. Une seule
 * regle : le jumeau est utilisable quand le portail dit « pret » — clone
 * entraine, valide, ET voix du compte choisie. Rien d'autre ne l'allume.
 */

/** Ce que la personne lit, par motif, dans le parcours « Creer ». */
export const MESSAGES_JUMEAU_CREER: Record<string, string> = {
  avatar_absent: 'Aucun clone n’est encore configuré.',
  avatar_supprime: 'Votre clone a été supprimé.',
  avatar_non_entraine: 'Votre vidéo est prête, mais votre clone n’est pas encore entraîné.',
  clone_non_valide: 'Validez d’abord votre clone avant de l’utiliser dans une vidéo.',
  voix_absente: 'Configurez votre voix pour utiliser votre clone.',
  voix_etrangere: 'Configurez votre voix pour utiliser votre clone.',
  script_absent: 'Écrivez le texte que votre clone doit dire (les voix-off des séquences).',
  jumeau_indisponible:
    'Votre clone est prêt à être utilisé. La génération avec le clone sera activée lors de la '
    + 'mise en service du moteur Digital Twin. Désactivez « Utiliser mon clone » pour créer une '
    + 'vidéo classique.',
};

export function messageJumeauCreer(motif: string): string {
  return MESSAGES_JUMEAU_CREER[motif] ?? 'Votre clone n’est pas disponible.';
}

/** L'etat du jumeau tel que l'ecran « Creer » le recoit. */
export type EtatJumeauCreer =
  | { etat: 'chargement' }
  | { etat: 'bloque'; motif: string }
  | { etat: 'pret'; voix: { userVoiceId: string; nom: string | null } };

/** L'interrupteur n'est actionnable que sur un clone que le portail dit pret. */
export function jumeauActivable(etat: EtatJumeauCreer): boolean {
  return etat.etat === 'pret';
}

/** Le lien qui debloque, par motif : le clone, ou la voix. */
export function lienJumeauCreer(motif: string): { href: string; libelle: string } {
  if (motif === 'avatar_absent') return { href: '/dashboard/avatar', libelle: 'Configurer mon clone' };
  if (motif === 'voix_absente' || motif === 'voix_etrangere') {
    return { href: '/dashboard/avatar#ma-voix', libelle: 'Configurer ma voix' };
  }
  return { href: '/dashboard/avatar', libelle: 'Voir mon clone' };
}

/**
 * L'evenement (fenetre) emis quand la voix du jumeau change dans « Ma voix »,
 * pour que les autres panneaux de la meme page la renomment sans recharger.
 * Le choix, lui, ne vit qu'en base : l'evenement ne transporte rien.
 */
export const EVENEMENT_VOIX_JUMEAU = 'studiio:voix-jumeau';
