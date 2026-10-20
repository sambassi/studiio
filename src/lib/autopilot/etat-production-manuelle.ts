/**
 * « Produire un brouillon maintenant » — les états RÉELS, dérivés de ce que
 * le serveur répond, jamais supposés.
 *
 *   repos → confirmation → en-cours | jumeau → fait | erreur | annule
 *
 *  - `annule` : SEUL un refus de l'utilisateur dans la fenêtre de coût
 *    fournisseur y mène (« Opération annulée : aucun appel fournisseur… »).
 *    Un verrou client déjà pris (`deja_en_cours`) n'est PAS une annulation :
 *    une production tourne, on la suit.
 *  - `erreur` : la raison réelle du serveur (ou du réseau), et une relance.
 *  - `en-cours` sans aucune trace côté serveur pendant plusieurs lectures
 *    (serveur redémarré, résultat expiré) : on ne laisse plus l'écran
 *    bloqué sans bouton — l'état redevient explicable et relançable.
 *
 * Aucune relance ne peut débiter deux fois : le serveur garde un verrou par
 * compte (409 `en-cours`), refuse un créneau déjà produit (409
 * `deja-produit`) et débite sous une référence déterministe
 * (`autopilote:<jobId>`, `deductCredits`).
 */
import { MESSAGE_ANNULE, type IssueConfirmee } from '@/lib/fournisseurs/confirmation-client';

export type EtatProduction =
  | { etat: 'repos' }
  | { etat: 'confirmation' }
  | { etat: 'en-cours' }
  /** Avatar en préparation : le montage attend en file — RIEN n'est encore dans le Calendrier. */
  | { etat: 'jumeau' }
  | { etat: 'fait'; postId: string | null; date: string; time: string; timezone: string; calendrierUrl: string; avertissements?: string[] }
  /** L'utilisateur a refusé le coût fournisseur : aucun appel n'est parti. */
  | { etat: 'annule'; message: string }
  | { etat: 'erreur'; message: string; code?: string };

/** Le bouton « Produire un brouillon maintenant » se montre-t-il ? */
export function boutonProduireVisible(e: EtatProduction): boolean {
  return e.etat === 'repos' || e.etat === 'fait' || e.etat === 'erreur' || e.etat === 'annule';
}

/** Libellé du bouton : après un échec technique, c'est une relance. */
export function libelleBoutonProduire(e: EtatProduction): string {
  return e.etat === 'erreur' ? 'Réessayer la production' : 'Produire un brouillon maintenant';
}

/** Ce que fait l'écran de la réponse au POST. */
export type SuiteEnvoi =
  | { suite: 'etat'; etat: EtatProduction }
  /** Le rendu tourne (202, 409 `en-cours`, verrou client déjà pris) : on le suit. */
  | { suite: 'suivre' }
  /** Réponse complète : `appliquerResultat`. */
  | { suite: 'resultat'; data: Record<string, unknown> };

export function suiteEnvoi(issue: IssueConfirmee): SuiteEnvoi {
  if (issue.annule) {
    if (issue.choix === 'deja_en_cours') return { suite: 'suivre' };
    return { suite: 'etat', etat: { etat: 'annule', message: MESSAGE_ANNULE } };
  }
  const data = (issue.json && typeof issue.json === 'object' ? issue.json : {}) as Record<string, unknown>;
  if (issue.status === 202 || data.code === 'en-cours') return { suite: 'suivre' };
  if (issue.status < 200 || issue.status >= 300 || !data.success) {
    const message = typeof data.error === 'string' && data.error
      ? data.error
      : issue.status === 401 ? 'Votre session a expiré : reconnectez-vous puis réessayez.'
        : `Le serveur a refusé la production (erreur ${issue.status}).`;
    return { suite: 'etat', etat: { etat: 'erreur', message, ...(typeof data.code === 'string' ? { code: data.code } : {}) } };
  }
  return { suite: 'resultat', data };
}

/** Message d'une exception (réseau coupé, réponse illisible) : la raison réelle. */
export function messageErreurTechnique(err: unknown): string {
  const brut = err instanceof Error ? err.message : '';
  if (/failed to fetch|networkerror|load failed|network/i.test(brut)) {
    return 'La connexion au serveur a été interrompue. Si la production avait démarré, elle continue : rechargez la page pour la retrouver, ou réessayez.';
  }
  return brut || 'Production impossible.';
}

/** Lectures consécutives sans AUCUNE trace serveur avant de cesser d'attendre (~2 s chacune). */
export const LECTURES_VIDES_MAX = 6;

/** Ce que dit une lecture de `/api/autopilot/produire-maintenant/progression`. */
export type LectureProgression =
  | { cas: 'progression' }
  | { cas: 'resultat'; resultat: Record<string, unknown> }
  | { cas: 'jumeau' }
  | { cas: 'jumeau-depose'; resultat: Record<string, unknown> }
  | { cas: 'echec'; message: string }
  | { cas: 'rien' };

export function lireProgressionServeur(d: unknown): LectureProgression {
  const o = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
  if (o.progression && typeof o.progression === 'object') return { cas: 'progression' };
  if (o.resultat && typeof o.resultat === 'object') return { cas: 'resultat', resultat: o.resultat as Record<string, unknown> };
  const j = (o.jumeau && typeof o.jumeau === 'object' ? o.jumeau : null) as
    | { etat?: string; message?: string; post?: { postId: string; scheduledDate: string; scheduledTime: string }; sansAvatar?: boolean }
    | null;
  if (j?.etat === 'en_preparation') return { cas: 'jumeau' };
  if (j?.etat === 'depose' && j.post) {
    return {
      cas: 'jumeau-depose',
      resultat: {
        success: true, postId: j.post.postId, scheduledDate: j.post.scheduledDate, scheduledTime: j.post.scheduledTime,
        avertissements: j.sansAvatar ? ['La vidéo de votre avatar n’a pas pu être préparée : le brouillon a été monté sans elle.'] : [],
      },
    };
  }
  if (j?.etat === 'echec') return { cas: 'echec', message: String(j.message ?? 'La production n’a pas abouti.') };
  return { cas: 'rien' };
}

/** Production suivie mais introuvable côté serveur : l'écran le dit et rend la main. */
export const MESSAGE_PRODUCTION_PERDUE =
  'La production suivie n’est plus retrouvée sur le serveur (il a peut-être redémarré). Vérifiez le Calendrier avant de relancer : un même créneau n’est jamais débité deux fois.';

/**
 * Au RETOUR sur la page : reprendre ce que le serveur a en cours, ou montrer
 * le résultat d'une production terminée pendant l'absence (sans nouveau POST,
 * donc sans nouveau débit). `null` : rien à
 * reprendre, l'écran reste au repos.
 */
export function repriseAuRetour(l: LectureProgression): 'en-cours' | 'jumeau' | 'resultat' | null {
  if (l.cas === 'progression') return 'en-cours';
  if (l.cas === 'jumeau') return 'jumeau';
  // Le résultat en mémoire du serveur (30 min) : une production finie
  // pendant l'absence. Un dépôt jumeau ancien n'est pas « repris » : il
  // s'afficherait à chaque visite, des jours après.
  if (l.cas === 'resultat') return 'resultat';
  return null;
}
