/**
 * PAIEMENT EN FRANCS CFA — la conversion, et rien qu'elle.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE MODULE EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * L'intégration Mobile Money d'afroboost convertit avec des taux ÉCRITS À LA
 * MAIN : 400 XOF par CHF d'un côté, 655 de l'autre, sans date, sans source,
 * et les deux dépôts se contredisent. Le 400 n'est même pas une conversion :
 * c'est un prix d'accessibilité commercial. Rien de cela n'est réutilisable
 * pour facturer, et c'est le seul morceau que la reprise d'afroboost ne
 * fournit pas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI REND LA CONVERSION VÉRIFIABLE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le franc CFA n'est pas une monnaie flottante : XOF et XAF sont arrimés à
 * l'euro à une PARITÉ FIXE, 1 EUR = 655,957, inchangée depuis l'introduction
 * de l'euro. Ce n'est pas un taux de marché, c'est une convention monétaire —
 * on peut donc l'inscrire ici, avec sa source.
 *
 * La seule part qui bouge est CHF → EUR. Elle vient des taux de référence de
 * la BCE, AVEC leur date (`lib/tarifs/change`), jamais d'un chiffre codé.
 *
 *     1 CHF  →  (taux BCE du jour) EUR  →  × 655,957  →  XOF / XAF
 *
 * Conséquence : aucune valeur de repli. Sans taux daté, la conversion est
 * REFUSÉE — on n'affiche pas un prix en CFA qu'on ne sait pas justifier.
 *
 * Fonctions PURES.
 */
export type DeviseCfa = 'XOF' | 'XAF';

/**
 * Parité FIXE du franc CFA à l'euro. Convention monétaire, pas un taux de
 * marché : elle ne se rafraîchit pas et n'a pas besoin de l'être.
 */
export const PARITE_CFA_PAR_EUR = 655.957;
export const SOURCE_PARITE_CFA =
  'Parité fixe du franc CFA à l’euro : 1 EUR = 655,957 XOF et 655,957 XAF (convention monétaire, inchangée depuis 1999).';

/** XOF et XAF n'ont pas de subdivision : tout montant est un entier. */
export const DEVISES_SANS_DECIMALE: readonly DeviseCfa[] = ['XOF', 'XAF'];

export const LIBELLE_DEVISE_CFA: Record<DeviseCfa, string> = {
  XOF: 'franc CFA (BCEAO)',
  XAF: 'franc CFA (BEAC)',
};

export function estDeviseCfa(v: unknown): v is DeviseCfa {
  return v === 'XOF' || v === 'XAF';
}

export interface ConversionCfa {
  devise: DeviseCfa;
  /** Montant à payer, en unité entière de la devise (jamais de centimes). */
  montant: number;
  /** Montant d'origine en centimes de CHF, tel que facturé par Studiio. */
  chfCentimes: number;
  /** Taux EUR par CHF utilisé, et son jour de publication. */
  tauxEurParChf: number;
  tauxLe: string;
  /** Conversion exacte avant arrondi — pour afficher l'écart sans le cacher. */
  montantExact: number;
  /** Ce que l'arrondi ajoute, en unité de la devise. Toujours ≥ 0. */
  arrondi: number;
  /** Frais ajoutés au montant. 0 = Studiio les prend à sa charge. */
  frais: number;
  sources: readonly string[];
}

export type RefusConversion =
  | 'taux_absent'
  | 'taux_invalide'
  | 'devise_inconnue'
  | 'montant_invalide';

export const MESSAGE_REFUS_CONVERSION: Record<RefusConversion, string> = {
  taux_absent: 'Aucun taux de change enregistré : le prix en francs CFA ne peut pas être affiché.',
  taux_invalide: 'Le taux de change enregistré est hors des bornes acceptées.',
  devise_inconnue: 'Devise non prise en charge.',
  montant_invalide: 'Montant à convertir invalide.',
};

/** Bornes de bon sens pour CHF → EUR : la parité n'a jamais quitté cet intervalle. */
export const EUR_PAR_CHF_MIN = 0.5;
export const EUR_PAR_CHF_MAX = 2;

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

export interface EntreeConversion {
  chfCentimes: number;
  devise: unknown;
  /** Combien d'euros vaut 1 CHF, d'après les taux de référence de la BCE. */
  tauxEurParChf: number | null | undefined;
  /** Jour de publication du taux (`AAAA-MM-JJ`). */
  tauxLe: string | null | undefined;
  /**
   * Frais ajoutés au montant, en fraction (0,02 = 2 %). Par défaut 0 :
   * la commission du prestataire est prélevée sur l'encaissement marchand,
   * elle n'est pas répercutée sur le payeur. La répercuter est une décision
   * commerciale, pas un défaut technique.
   */
  fraisFraction?: number;
}

/**
 * Convertit un prix Studiio (CHF) en montant payable en franc CFA.
 *
 * Arrondi : vers le HAUT, à l'unité. La devise n'a pas de subdivision, donc
 * un montant fractionnaire n'est pas payable ; arrondir vers le bas ferait
 * encaisser moins que le prix. L'écart (moins d'un franc CFA, soit moins de
 * 0,002 CHF) est rendu dans `arrondi` pour être affiché, pas dissimulé.
 */
export function convertirChfVersCfa(
  e: EntreeConversion,
): { ok: true; conversion: ConversionCfa } | { ok: false; motif: RefusConversion; message: string } {
  const refus = (motif: RefusConversion) => ({ ok: false as const, motif, message: MESSAGE_REFUS_CONVERSION[motif] });

  if (!estDeviseCfa(e.devise)) return refus('devise_inconnue');
  if (!Number.isInteger(e.chfCentimes) || e.chfCentimes <= 0) return refus('montant_invalide');
  if (e.tauxEurParChf === null || e.tauxEurParChf === undefined || typeof e.tauxLe !== 'string' || !DATE_ISO.test(e.tauxLe)) {
    return refus('taux_absent');
  }
  const taux = Number(e.tauxEurParChf);
  if (!Number.isFinite(taux) || taux < EUR_PAR_CHF_MIN || taux > EUR_PAR_CHF_MAX) return refus('taux_invalide');

  const fraisFraction = Number.isFinite(e.fraisFraction) && (e.fraisFraction as number) >= 0 ? (e.fraisFraction as number) : 0;

  const chf = e.chfCentimes / 100;
  const montantExact = Math.round(chf * taux * PARITE_CFA_PAR_EUR * 100) / 100;
  const avecFrais = montantExact * (1 + fraisFraction);
  const montant = Math.ceil(avecFrais);

  return {
    ok: true,
    conversion: {
      devise: e.devise,
      montant,
      chfCentimes: e.chfCentimes,
      tauxEurParChf: taux,
      tauxLe: e.tauxLe,
      montantExact,
      arrondi: Math.round((montant - avecFrais) * 100) / 100,
      frais: Math.round((avecFrais - montantExact) * 100) / 100,
      sources: [
        SOURCE_PARITE_CFA,
        `Taux CHF → EUR : taux de référence de la Banque centrale européenne du ${e.tauxLe}.`,
      ],
    },
  };
}

/**
 * Ce que l'utilisateur lit avant de payer : son montant, sa devise, les
 * crédits achetés, et le prix Studiio d'origine. Volontairement explicite sur
 * l'arrondi et les frais — un montant qui ne correspond pas au prix annoncé,
 * sans explication, est ce qui fait abandonner un paiement.
 */
export function annonceConversion(c: ConversionCfa, credits: number): string {
  const chf = (c.chfCentimes / 100).toLocaleString('fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const montant = c.montant.toLocaleString('fr-CH');
  const base = `${montant} ${c.devise} pour ${credits.toLocaleString('fr-CH')} crédits (${chf} CHF, taux du ${c.tauxLe}).`;
  if (c.frais > 0) return `${base} Dont ${c.frais.toLocaleString('fr-CH')} ${c.devise} de frais.`;
  return `${base} Aucun frais ajouté.`;
}
