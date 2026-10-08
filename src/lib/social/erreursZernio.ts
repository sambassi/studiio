import { libelleCalendrier, type Reseau } from '@/lib/social/etatReseaux';

/**
 * Traduire un refus de Zernio en motif LISIBLE — sans perdre la cause.
 *
 * ⚠️ AVANT, TOUT REFUS DEVENAIT « Le réseau a refusé la publication. » Le
 * vrai motif (compte Instagram déconnecté, jeton expiré…) ne restait que dans
 * les journaux serveur : l'utilisateur ne pouvait rien corriger. Désormais :
 * - `motif`   : phrase courte, affichée dans le Calendrier ;
 * - `details` : une ligne par réseau visé (`cron_publish_results`) ;
 * - `technique` : code + message Zernio, gardés dans `metadata`.
 *
 * Aucun secret : le message Zernio ne contient que l'identifiant du compte ;
 * les URL éventuelles sont tronquées à leur chemin.
 */

export interface ErreurZernioBrute {
  status: number;
  code?: string;
  detail?: string;
}

export interface TraductionErreur {
  motif: string;
  details: Array<{ platform: string; success: false; error: string }>;
  technique: { status: number; code: string | null; message: string | null };
  /** Identifiant Zernio du compte CIBLÉ que Zernio signale déconnecté, sinon `null`. */
  compteDeconnecte: string | null;
}

/** Retire les paramètres d'URL (signatures, jetons) d'un message. */
export function sansParametresUrl(texte: string): string {
  return texte.replace(/(https?:\/\/[^\s?"']+)\?[^\s"']*/g, '$1');
}

export function traduireErreurZernio(
  erreur: ErreurZernioBrute,
  cibles: ReadonlyArray<{ platform: string; accountId: string }>,
): TraductionErreur {
  const message = erreur.detail ? sansParametresUrl(erreur.detail).slice(0, 400) : null;
  const technique = { status: erreur.status, code: erreur.code ?? null, message };
  const compteNomme = message?.match(/Account ([a-f0-9]{24})/i)?.[1] ?? null;
  const visee = (compteNomme && cibles.find((c) => c.accountId === compteNomme)) || null;
  const libelle = (p: string) => libelleCalendrier(p as Reseau) ?? p;

  let motif: string;
  if (erreur.code === 'ACCOUNT_DISCONNECTED') {
    const nom = visee ? libelle(visee.platform) : 'Un réseau';
    motif = `${nom} doit être reconnecté : son autorisation a expiré ou a été révoquée. Reconnectez-le dans Réseaux sociaux.`;
  } else if (erreur.status === 402 || erreur.code === 'PAYMENT_REQUIRED') {
    motif = 'Service de publication suspendu (facturation du service de publication).';
  } else if (erreur.status === 429) {
    motif = 'Trop de publications en peu de temps : réessayez plus tard.';
  } else if (message) {
    motif = `Refus du réseau : ${message.slice(0, 200)}`;
  } else {
    motif = `Le réseau a refusé la publication (HTTP ${erreur.status}).`;
  }

  const concernes = visee ? [visee] : cibles;
  const details = concernes.map((c) => ({
    platform: libelle(c.platform),
    success: false as const,
    error: erreur.code === 'ACCOUNT_DISCONNECTED' ? 'compte à reconnecter' : (message ?? `HTTP ${erreur.status}`).slice(0, 200),
  }));

  // Seul un compte RÉELLEMENT CIBLÉ par cet envoi peut être marqué
  // déconnecté : un identifiant nommé hors cibles ne touche à rien.
  return { motif, details, technique, compteDeconnecte: erreur.code === 'ACCOUNT_DISCONNECTED' && visee ? visee.accountId : null };
}
