/**
 * FORMULES PROPOSÉES — une cible commerciale, PAS un tarif en vigueur.
 *
 * Les abonnements vendus vivent dans la table `plans`, éditable depuis
 * `/admin/pricing`. Ce module ne vend rien et ne modifie rien : il porte la
 * grille VISÉE (12,90 / 34,90 / 69,90 CHF) et la confronte à la valeur du
 * crédit effectivement configurée, pour qu'une formule ne soit activée
 * qu'après avoir été jugée tenable.
 *
 * Pourquoi cette confrontation : un abonnement ne vend pas un service, il
 * vend des CRÉDITS. Si une formule cède le crédit moins cher que sa valeur de
 * référence, elle dilue tout le reste de la grille — et le prix unitaire de
 * chaque opération devient faux, sans qu'aucun tarif n'ait changé.
 *
 * Fonctions PURES.
 */
export interface FormuleProposee {
  cle: 'decouverte' | 'createur' | 'pro' | 'studio';
  nom: string;
  /** Prix mensuel en centimes de CHF. 0 = gratuit. */
  prixCentimes: number;
  /** Crédits inclus par mois. */
  credits: number;
  /** `false` tant que la formule n'est pas jugée tenable ET activée à la main. */
  activee: false;
  resume: string;
}

/**
 * La cible annoncée. `activee: false` sur chaque ligne, par construction du
 * type : rien ici ne peut être mis en vente par mégarde.
 */
export const FORMULES_PROPOSEES: readonly FormuleProposee[] = [
  { cle: 'decouverte', nom: 'Découverte', prixCentimes: 0, credits: 0, activee: false, resume: 'Gratuit, recharge de crédits possible.' },
  { cle: 'createur', nom: 'Créateur', prixCentimes: 1290, credits: 1000, activee: false, resume: '12,90 CHF / mois, 1 000 crédits.' },
  { cle: 'pro', nom: 'Pro', prixCentimes: 3490, credits: 3000, activee: false, resume: '34,90 CHF / mois, 3 000 crédits.' },
  { cle: 'studio', nom: 'Studio', prixCentimes: 6990, credits: 6500, activee: false, resume: '69,90 CHF / mois, 6 500 crédits.' },
];

export type VerdictFormule = 'tenable' | 'dilue' | 'inconnu';

export interface AnalyseFormule {
  cle: FormuleProposee['cle'];
  nom: string;
  prixCentimes: number;
  credits: number;
  /** CHF effectivement payés par crédit dans cette formule. `null` si gratuite. */
  chfParCredit: number | null;
  /** La valeur de référence du crédit, telle que configurée. */
  valeurCreditChf: number | null;
  /** Rapport entre les deux : 1 = parité. < 1 = la formule cède le crédit au rabais. */
  rapport: number | null;
  verdict: VerdictFormule;
  motif: string;
}

const arrondi = (v: number, pas = 10_000) => Math.round(v * pas) / pas;

/**
 * Tolérance : un abonnement cède légitimement le crédit un peu moins cher
 * qu'une recharge ponctuelle — c'est l'intérêt de s'abonner. Au-delà, ce
 * n'est plus une remise, c'est une perte de valeur.
 */
export const REMISE_ABONNEMENT_TOLEREE = 0.3;

export function analyserFormule(f: FormuleProposee, valeurCreditChf: number | null): AnalyseFormule {
  const valeur = typeof valeurCreditChf === 'number' && valeurCreditChf > 0 ? valeurCreditChf : null;
  const base = { cle: f.cle, nom: f.nom, prixCentimes: f.prixCentimes, credits: f.credits, valeurCreditChf: valeur };

  if (f.credits === 0 || f.prixCentimes === 0) {
    return {
      ...base, chfParCredit: null, rapport: null, verdict: 'tenable',
      motif: f.credits === 0
        ? 'Formule sans crédits inclus : rien n’est cédé, la recharge reste au prix public.'
        : 'Formule gratuite avec crédits inclus : à chiffrer comme un coût d’acquisition, pas comme une vente.',
    };
  }
  const chfParCredit = arrondi((f.prixCentimes / 100) / f.credits);
  if (valeur === null) {
    return {
      ...base, chfParCredit, rapport: null, verdict: 'inconnu',
      motif: 'Valeur du crédit non configurée : impossible de dire si cette formule tient.',
    };
  }
  const rapport = arrondi(chfParCredit / valeur);
  const plancher = 1 - REMISE_ABONNEMENT_TOLEREE;
  if (rapport >= plancher) {
    return {
      ...base, chfParCredit, rapport, verdict: 'tenable',
      motif: `${chfParCredit} CHF le crédit, contre ${valeur} de référence (${Math.round(rapport * 100)} %).`,
    };
  }
  const creditsTenables = Math.floor((f.prixCentimes / 100) / (valeur * plancher));
  return {
    ...base, chfParCredit, rapport, verdict: 'dilue',
    motif: `${chfParCredit} CHF le crédit, soit ${Math.round(rapport * 100)} % de la valeur de référence (${valeur}). À ce prix, la formule tient jusqu’à ${creditsTenables} crédits inclus, pas ${f.credits}.`,
  };
}

export function analyserFormulesProposees(valeurCreditChf: number | null): AnalyseFormule[] {
  return FORMULES_PROPOSEES.map((f) => analyserFormule(f, valeurCreditChf));
}
