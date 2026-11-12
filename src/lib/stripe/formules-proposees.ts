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
 *
 * ─────────────────────────────────────────────────────────────────────────
 * D'OÙ VIENNENT CES QUANTITÉS DE CRÉDITS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les PRIX (12,90 / 34,90 / 69,90 CHF) sont la cible commerciale. Les CRÉDITS
 * ne le sont pas : ils sont calculés pour que la formule reste positive même
 * si l'abonné dépense la TOTALITÉ de son quota sur l'opération dont le coût
 * fournisseur par crédit est le plus élevé — le seul cas qui compte, puisque
 * c'est celui qui peut arriver.
 *
 * Une fois la grille alignée sur son prix conseillé (coût + marge visée de
 * 40 %), ce pire coût vaut par construction la valeur du crédit divisée par
 * 1,4, soit ≈ 0,0583 CHF à l'échelle conservée (0,0817 CHF le crédit). Les
 * plafonds sont donc 221 / 598 / 1 198 crédits ; les quantités retenues
 * restent dessous, avec une réserve.
 *
 * ⚠️ CES QUANTITÉS SUPPOSENT LES TARIFS D'AVATAR CORRIGÉS. Tant qu'un avatar
 * se vend 40 crédits pour 5,74 à 8,57 CHF de coût, il devient la pire façon
 * de dépenser son quota (0,214 CHF le crédit) et 12,90 CHF n'achèterait que
 * 60 crédits. `margeAbonnement` le montre à partir de la grille réelle, au
 * lieu de le supposer.
 *
 * Les quantités annoncées initialement (1 000 / 3 000 / 6 500) cédaient le
 * crédit à ≈ 16 % de sa valeur de référence : elles ne sont pas conservées.
 */
export const FORMULES_PROPOSEES: readonly FormuleProposee[] = [
  { cle: 'decouverte', nom: 'Découverte', prixCentimes: 0, credits: 0, activee: false, resume: 'Gratuit, recharge de crédits possible.' },
  { cle: 'createur', nom: 'Créateur', prixCentimes: 1290, credits: 200, activee: false, resume: '12,90 CHF / mois, 200 crédits (plafond tenable : 221).' },
  { cle: 'pro', nom: 'Pro', prixCentimes: 3490, credits: 550, activee: false, resume: '34,90 CHF / mois, 550 crédits (plafond tenable : 598).' },
  { cle: 'studio', nom: 'Studio', prixCentimes: 6990, credits: 1100, activee: false, resume: '69,90 CHF / mois, 1 100 crédits (plafond tenable : 1 198).' },
];

/**
 * Quantité maximale de crédits qu'une formule peut inclure en restant
 * positive au pire cas d'usage. Sert à justifier les quantités ci-dessus, et
 * à les recalculer si la valeur du crédit ou la marge visée changent.
 */
export function creditsTenables(prixCentimes: number, pireCoutParCredit: number): number | null {
  if (!(prixCentimes > 0) || !(pireCoutParCredit > 0)) return null;
  return Math.floor((prixCentimes / 100) / pireCoutParCredit);
}

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

/**
 * ─────────────────────────────────────────────────────────────────────────
 * LA MARGE RÉELLE D'UN ABONNEMENT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `analyserFormule` compare le prix du crédit à sa valeur de référence : ça
 * dit si la formule dilue la grille, pas si elle fait gagner de l'argent.
 *
 * Un abonné ne coûte rien tant qu'il ne consomme pas. Ce qui décide de la
 * marge, c'est CE QU'IL CHOISIT DE CONSOMMER : à crédits égaux, une opération
 * peut coûter cent fois moins qu'une autre. Le pire cas est donc le bon
 * repère — l'abonné qui dépense tout son quota sur l'opération dont le coût
 * fournisseur par crédit est le plus élevé.
 *
 * C'est le chiffre qui relie les deux écrans : aucune formule ne peut être
 * tenable tant qu'un tarif se vend sous son coût, parce que ce tarif-là
 * devient la pire façon de dépenser son quota.
 */
export interface MargeAbonnement {
  cle: FormuleProposee['cle'];
  nom: string;
  /** Ce que l'abonné paie, par mois. */
  prixVenteChf: number;
  /** Les crédits que la formule offre, par mois. */
  creditsOfferts: number;
  /** Coût fournisseur du quota entier dépensé au pire. `null` si inconnu. */
  coutUsageMaxChf: number | null;
  /** Le tarif qui constitue ce pire cas. */
  pireOperation: string | null;
  /** Prix de vente − coût d'usage au pire. `null` si le coût est inconnu. */
  margeReelleChf: number | null;
  /** Taux de consommation au-delà duquel la formule perd de l'argent. */
  partQuotaRentable: number | null;
  motif: string;
}

export interface LigneCoutParCredit {
  /** Clé tarifaire, pour nommer le pire cas. */
  cle: string;
  libelle: string;
  prixCredits: number;
  /** Coût fournisseur en CHF de UNE opération. `null` si inconnu. */
  coutChf: number | null;
}

/**
 * Le pire coût fournisseur par crédit de la grille. `null` si aucune ligne
 * n'a de coût connu — et une ligne inconnue est IGNORÉE, pas comptée zéro :
 * c'est dit dans le motif, pas dissimulé dans le total.
 */
export function pireCoutParCredit(
  lignes: readonly LigneCoutParCredit[],
): { cle: string; libelle: string; coutParCredit: number } | null {
  let pire: { cle: string; libelle: string; coutParCredit: number } | null = null;
  for (const l of lignes) {
    if (l.coutChf === null || !(l.prixCredits > 0)) continue;
    const parCredit = l.coutChf / l.prixCredits;
    if (!pire || parCredit > pire.coutParCredit) {
      pire = { cle: l.cle, libelle: l.libelle, coutParCredit: arrondi(parCredit) };
    }
  }
  return pire;
}

export function margeAbonnement(
  f: FormuleProposee,
  lignes: readonly LigneCoutParCredit[],
): MargeAbonnement {
  const prixVenteChf = arrondi(f.prixCentimes / 100);
  const base = { cle: f.cle, nom: f.nom, prixVenteChf, creditsOfferts: f.credits };
  const inconnues = lignes.filter((l) => l.coutChf === null).length;

  if (f.credits === 0) {
    return {
      ...base, coutUsageMaxChf: 0, pireOperation: null, margeReelleChf: prixVenteChf,
      partQuotaRentable: null,
      motif: 'Aucun crédit inclus : la formule ne porte aucun coût d’usage.',
    };
  }
  const pire = pireCoutParCredit(lignes);
  if (!pire) {
    return {
      ...base, coutUsageMaxChf: null, pireOperation: null, margeReelleChf: null,
      partQuotaRentable: null,
      motif: 'Aucun coût fournisseur connu dans la grille : marge réelle incalculable.',
    };
  }
  const coutUsageMaxChf = arrondi(f.credits * pire.coutParCredit);
  const margeReelleChf = arrondi(prixVenteChf - coutUsageMaxChf);
  const partQuotaRentable = coutUsageMaxChf > 0
    ? Math.min(1, arrondi(prixVenteChf / coutUsageMaxChf))
    : null;
  const reserve = inconnues > 0 ? ` ${inconnues} tarif(s) sans coût connu sont exclus de ce calcul.` : '';

  return {
    ...base, coutUsageMaxChf, pireOperation: pire.libelle, margeReelleChf, partQuotaRentable,
    motif: margeReelleChf < 0
      ? `À plein régime sur « ${pire.libelle} », le quota coûte ${coutUsageMaxChf} CHF pour ${prixVenteChf} CHF encaissés : la formule n’est rentable que si l’abonné consomme moins de ${Math.round((partQuotaRentable ?? 0) * 100)} % de ses crédits ainsi.${reserve}`
      : `Même quota entier dépensé sur « ${pire.libelle} » (${coutUsageMaxChf} CHF), la formule reste positive.${reserve}`,
  };
}

export function analyserFormulesProposees(valeurCreditChf: number | null): AnalyseFormule[] {
  return FORMULES_PROPOSEES.map((f) => analyserFormule(f, valeurCreditChf));
}
