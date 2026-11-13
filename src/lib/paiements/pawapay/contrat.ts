/**
 * CONTRAT DU PRESTATAIRE MOBILE MONEY — ce que l'API attend, ce qu'elle rend,
 * et les pièges qui ont coûté des heures ailleurs.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI EST REPRIS DE L'INSTALLATION AFROBOOST
 * ─────────────────────────────────────────────────────────────────────────
 *
 * L'intégration d'afroboost (`afroboost-v11-dev`, API v2) est en Python et
 * adossée à MongoDB : aucun fichier n'est copiable ici. Ce qui se reprend,
 * c'est la CONNAISSANCE DU CONTRAT, annotée au fil de ses corrections, et
 * c'est le vrai gain — chacun de ces points est une panne déjà payée :
 *
 *   1. Le corps attend `amountDetails: { amount, currency }`, PAS `amount` à
 *      la racine. C'est l'erreur du premier essai en bac à sable.
 *   2. Le champ du numéro est `phoneNumber`, pas `msisdn`.
 *   3. Le montant part en CHAÎNE, en unité majeure.
 *   4. `reason` est borné à 50 caractères.
 *   5. L'URL de redirection revient sous plusieurs noms selon les versions :
 *      `redirectUrl`, `paymentPageUrl`, `paymentUrl`, `url`, `sessionUrl`.
 *   6. ⚠️ UN HTTP 200 PEUT ÊTRE UN ÉCHEC. La réponse peut ne contenir qu'un
 *      `failureReason` : c'est sa présence qui fait foi, pas le code HTTP.
 *   7. `INVALID_PHONE_NUMBER` mérite UNE relance sans le numéro — la page de
 *      paiement le redemandera elle-même.
 *   8. L'opérateur n'est jamais choisi par nous : la page hébergée du
 *      prestataire le demande. On n'envoie que le PAYS, dont découle la
 *      devise.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI N'EST PAS REPRIS, ET POURQUOI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les TAUX DE CHANGE d'afroboost (400 XOF par CHF d'un côté, 655 de l'autre)
 * ne sont pas des conversions : le 400 est un prix d'accessibilité
 * commercial, assumé comme tel dans son code. La conversion de Studiio passe
 * par `lib/paiements/cfa` — parité fixe du franc CFA à l'euro et taux CHF →
 * EUR daté de la BCE.
 *
 * Fonctions PURES : aucune lecture d'environnement, aucun appel réseau.
 */
import type { DeviseCfa } from '@/lib/paiements/cfa';

/** Longueur maximale du motif, imposée par le prestataire. */
export const MOTIF_MAX = 50;

/** Devises sans subdivision : le montant doit être un entier. */
export const DEVISES_SANS_DECIMALE: readonly string[] = ['XOF', 'XAF'];

export type StatutDepot = 'en_attente' | 'reussi' | 'echoue' | 'expire' | 'annule';

/**
 * Statuts du prestataire → les nôtres. Tout statut inconnu reste
 * `en_attente` : on ne conclut pas d'un mot qu'on ne connaît pas, et la
 * réconciliation repassera.
 */
export function statutDepuisPrestataire(brut: unknown): StatutDepot {
  const s = typeof brut === 'string' ? brut.trim().toUpperCase() : '';
  switch (s) {
    case 'COMPLETED': return 'reussi';
    case 'FAILED': case 'REJECTED': return 'echoue';
    case 'EXPIRED': return 'expire';
    case 'CANCELLED': case 'CANCELED': return 'annule';
    default: return 'en_attente';
  }
}

/** Un statut définitif ne sera plus interrogé. */
export function estDefinitif(s: StatutDepot): boolean {
  return s !== 'en_attente';
}

export interface DemandePagePaiement {
  depositId: string;
  /** Code pays ISO 3166-1 alpha-3, en majuscules. */
  pays: string;
  devise: DeviseCfa | string;
  /** Montant en unité majeure. Entier pour XOF / XAF. */
  montant: number;
  motif: string;
  retourUrl: string;
  /** Facultatif : la page le redemande si on ne l'a pas. */
  telephone?: string | null;
  langue?: 'FR' | 'EN';
}

/**
 * Le corps exact attendu par `POST /v2/paymentpage`. Les quatre pièges de
 * forme (1 à 4 ci-dessus) sont encodés ici, une fois pour toutes.
 */
export function corpsPagePaiement(d: DemandePagePaiement): Record<string, unknown> {
  const entier = DEVISES_SANS_DECIMALE.includes(String(d.devise).toUpperCase());
  const montant = entier ? String(Math.round(d.montant)) : d.montant.toFixed(2);
  const corps: Record<string, unknown> = {
    depositId: d.depositId,
    returnUrl: d.retourUrl,
    language: d.langue ?? 'FR',
    reason: d.motif.slice(0, MOTIF_MAX),
    country: d.pays.toUpperCase(),
    amountDetails: { amount: montant, currency: String(d.devise).toUpperCase() },
  };
  if (d.telephone) corps.phoneNumber = d.telephone;
  return corps;
}

/** Noms sous lesquels l'URL de redirection a déjà été observée. */
const CLES_REDIRECTION = ['redirectUrl', 'paymentPageUrl', 'paymentUrl', 'url', 'sessionUrl'] as const;

export type RefusPagePaiement = 'echec_annonce' | 'url_absente' | 'telephone_invalide';

export interface LecturePagePaiement {
  ok: boolean;
  urlRedirection: string | null;
  motifEchec: string | null;
  refus: RefusPagePaiement | null;
}

/**
 * Lit la réponse de création. ⚠️ `failureReason` PRIME SUR LE CODE HTTP : une
 * réponse 200 qui ne porte qu'un motif d'échec est un échec.
 */
export function lirePagePaiement(corps: unknown): LecturePagePaiement {
  const o = (corps && typeof corps === 'object' ? corps : {}) as Record<string, unknown>;
  const motifEchec = typeof o.failureReason === 'string'
    ? o.failureReason
    : (o.failureReason && typeof o.failureReason === 'object'
      ? String((o.failureReason as Record<string, unknown>).failureCode ?? 'inconnu')
      : null);

  if (motifEchec) {
    return {
      ok: false,
      urlRedirection: null,
      motifEchec,
      refus: motifEchec.toUpperCase().includes('INVALID_PHONE_NUMBER') ? 'telephone_invalide' : 'echec_annonce',
    };
  }
  for (const cle of CLES_REDIRECTION) {
    const v = o[cle];
    if (typeof v === 'string' && /^https:\/\//.test(v)) {
      return { ok: true, urlRedirection: v, motifEchec: null, refus: null };
    }
  }
  return { ok: false, urlRedirection: null, motifEchec: null, refus: 'url_absente' };
}

export interface LectureDepot {
  statut: StatutDepot;
  /** Montant réellement encaissé, en unité majeure. `null` si absent. */
  montant: number | null;
  devise: string | null;
  motifEchec: string | null;
}

/**
 * Lit `GET /v2/deposits/{id}`. Le prestataire a renvoyé, selon les versions,
 * un objet seul ou un tableau d'un élément : les deux sont acceptés.
 */
export function lireDepot(corps: unknown): LectureDepot {
  const brut = Array.isArray(corps) ? corps[0] : corps;
  const o = (brut && typeof brut === 'object' ? brut : {}) as Record<string, unknown>;
  const details = (o.amountDetails && typeof o.amountDetails === 'object'
    ? o.amountDetails
    : o) as Record<string, unknown>;
  const montantBrut = details.amount ?? o.amount ?? o.depositedAmount;
  const montant = Number(montantBrut);
  return {
    statut: statutDepuisPrestataire(o.status),
    montant: Number.isFinite(montant) ? montant : null,
    devise: typeof details.currency === 'string' ? details.currency.toUpperCase() : null,
    motifEchec: typeof o.failureReason === 'string' ? o.failureReason : null,
  };
}

export type RefusConfirmation =
  | 'statut_non_reussi'
  | 'montant_absent'
  | 'montant_insuffisant'
  | 'devise_differente';

export const MESSAGE_REFUS_CONFIRMATION: Record<RefusConfirmation, string> = {
  statut_non_reussi: 'Le paiement n’est pas confirmé par le prestataire.',
  montant_absent: 'Le prestataire n’a pas indiqué le montant encaissé.',
  montant_insuffisant: 'Le montant encaissé est inférieur au montant attendu.',
  devise_differente: 'La devise encaissée ne correspond pas à celle attendue.',
};

/**
 * CE QUI AUTORISE À CRÉDITER. Trois contrôles, et aucun n'est facultatif :
 * un statut réussi, le montant attendu, la devise attendue.
 *
 * La tolérance d'un centime absorbe les arrondis du prestataire sur les
 * devises à décimales ; elle ne laisse pas passer un paiement partiel.
 */
export function confirmationAutorisee(args: {
  lu: LectureDepot;
  montantAttendu: number;
  deviseAttendue: string;
}): { ok: true } | { ok: false; refus: RefusConfirmation; message: string } {
  const refus = (r: RefusConfirmation) => ({ ok: false as const, refus: r, message: MESSAGE_REFUS_CONFIRMATION[r] });
  if (args.lu.statut !== 'reussi') return refus('statut_non_reussi');
  if (args.lu.montant === null) return refus('montant_absent');
  if (args.lu.devise !== null && args.lu.devise !== args.deviseAttendue.toUpperCase()) return refus('devise_differente');
  if (args.lu.montant + 0.01 < args.montantAttendu) return refus('montant_insuffisant');
  return { ok: true };
}

/**
 * Référence de crédit d'un dépôt. Le préfixe `mm:` la distingue des débits
 * (`rendu:`, `op:`) et des crédits du prestataire carte (`stripe:`), et c'est
 * lui qui porte la garantie d'unicité en base.
 */
export function referenceCredit(depositId: string): string {
  return `mm:${depositId}`;
}

/**
 * Le corps d'une notification ne sert QU'À UNE CHOSE : donner l'identifiant
 * du dépôt. Tout le reste est relu auprès du prestataire. Une notification
 * n'est pas une preuve — n'importe qui peut en poster une.
 */
export function identifiantDeLaNotification(corps: unknown): string | null {
  const o = (corps && typeof corps === 'object' ? corps : {}) as Record<string, unknown>;
  for (const cle of ['depositId', 'deposit_id', 'id']) {
    const v = o[cle];
    if (typeof v === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(v)) return v;
  }
  const imbrique = o.deposit ?? o.data;
  if (imbrique && typeof imbrique === 'object') return identifiantDeLaNotification(imbrique);
  return null;
}
