/**
 * Côté NAVIGATEUR : rejouer une requête payante seulement APRÈS que l'admin a
 * vu et accepté le coût fournisseur.
 *
 * 1. La requête part SANS confirmation. Le serveur répond 428 + devis
 *    (`confirmation-cout.ts`) avant toute écriture et tout appel.
 * 2. Le devis est montré ; Annuler → on s'arrête là : 0 appel fournisseur.
 * 3. Continuer → la MÊME requête repart, avec la confirmation — une seule fois.
 *
 * Un non-admin n'a jamais de 428 : sa requête passe au premier envoi, comme avant.
 */
import { CODE_CONFIRMATION_COUT, CHAMP_CONFIRMATION_COUT, type DevisFournisseur } from '@/lib/fournisseurs/devis-fournisseur';

export { CODE_CONFIRMATION_COUT, CHAMP_CONFIRMATION_COUT };

export const MESSAGE_ANNULE = 'Opération annulée : aucun appel fournisseur n’a été fait.';

export interface ContexteConfirmation {
  avatarExistant?: { id: string; nom: string | null; version: number } | null;
  nouvelEntrainement?: boolean;
  typeAvatar?: string;
}
/** `continuer` lance ; `annuler` ou `existant` (utiliser l'avatar déjà prêt) n'appellent rien. */
export type ChoixConfirmation = 'continuer' | 'annuler' | 'existant';
export type Confirmeur = (devis: DevisFournisseur, contexte: ContexteConfirmation) => Promise<ChoixConfirmation>;

export function estDemandeDeConfirmation(status: number, json: unknown): json is { devis: DevisFournisseur } & ContexteConfirmation {
  return status === 428 && !!json && typeof json === 'object'
    && (json as { code?: unknown }).code === CODE_CONFIRMATION_COUT
    && !!(json as { devis?: unknown }).devis;
}

/** Le confirmeur par défaut : la fenêtre « Coût fournisseur estimé » (chargée à la demande). */
const confirmeurParDefaut: Confirmeur = async (devis, contexte) => {
  const { demanderConfirmationCout } = await import('@/components/fournisseurs/ConfirmationCoutFournisseur');
  return demanderConfirmationCout(devis, contexte);
};

/** Opérations déjà en cours de confirmation/lancement : un double clic n'en lance jamais deux. */
const enCours = new Set<string>();

export type IssueConfirmee =
  | { annule: false; status: number; json: any; choix?: undefined } // eslint-disable-line @typescript-eslint/no-explicit-any
  | { annule: true; choix: Exclude<ChoixConfirmation, 'continuer'> | 'deja_en_cours'; status?: undefined; json?: undefined };

/**
 * Envoie, et si le serveur exige une confirmation de coût, la demande puis
 * renvoie la même requête confirmée. `envoyer(confirme)` construit la requête.
 */
export async function avecConfirmationCout(
  envoyer: (confirme: boolean) => Promise<Response>,
  opts: { cle?: string; confirmer?: Confirmeur } = {},
): Promise<IssueConfirmee> {
  const cle = opts.cle ?? null;
  if (cle && enCours.has(cle)) return { annule: true, choix: 'deja_en_cours' };
  if (cle) enCours.add(cle);
  try {
    const lire = async (r: Response) => ({ status: r.status, json: await r.json().catch(() => ({})) });
    const premier = await lire(await envoyer(false));
    if (!estDemandeDeConfirmation(premier.status, premier.json)) return { annule: false, ...premier };
    const { devis, ...contexte } = premier.json;
    const choix = await (opts.confirmer ?? confirmeurParDefaut)(devis, contexte);
    if (choix !== 'continuer') return { annule: true, choix };
    return { annule: false, ...(await lire(await envoyer(true))) };
  } finally {
    if (cle) enCours.delete(cle);
  }
}

/**
 * CRÉATION / NOUVELLE VERSION d'avatar : le devis est LU (`GET
 * /api/avatar/devis-creation`) AVANT d'envoyer le fichier — aucune écriture.
 * `non_requis` : compte non admin, ou devis illisible — l'envoi se fait comme
 * avant ; le serveur garde de toute façon sa propre garde (428).
 */
export async function confirmerCreationAvatar(args: {
  type: 'video' | 'photo';
  fetchImpl?: typeof fetch;
  confirmer?: Confirmeur;
}): Promise<ChoixConfirmation | 'non_requis'> {
  const r = await (args.fetchImpl ?? fetch)(`/api/avatar/devis-creation?type=${args.type}`).catch(() => null);
  if (!r || typeof r.json !== 'function') return 'non_requis';
  const json = await r.json().catch(() => ({}));
  if (!estDemandeDeConfirmation(r.status, json)) return 'non_requis';
  const { devis, ...contexte } = json;
  return (args.confirmer ?? confirmeurParDefaut)(devis, contexte);
}
