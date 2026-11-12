/**
 * BILAN DU MOIS — crédits vendus, consommés, et ce que ça rapporte.
 *
 * Le tableau de bord montrait déjà le COÛT fournisseur par génération
 * d'avatar. Il manquait l'autre côté : combien de crédits ont été vendus,
 * accordés par abonnement, consommés, remboursés — et la recette que cela
 * représente.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE NE PRÉTEND PAS SAVOIR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La recette RÉELLE en francs est chez Stripe, pas ici :
 * `credit_transactions` enregistre des CRÉDITS, pas des montants encaissés.
 * La recette rendue est donc une ESTIMATION — crédits vendus × valeur du
 * crédit — et elle est nommée comme telle (`recetteEstimeeChf`). Sans valeur
 * du crédit configurée, elle vaut `null` : une recette inconnue n'est pas une
 * recette nulle.
 *
 * Même règle pour la marge : elle n'existe que si la recette ET le coût sont
 * tous deux connus, dans la même monnaie.
 *
 * Fonction PURE.
 */
export type TypeTransaction = 'purchase' | 'subscription' | 'bonus' | 'refund' | 'render';

export interface LigneTransaction {
  type?: unknown;
  amount?: unknown;
  created_at?: unknown;
}

export interface MoisCredits {
  /** `AAAA-MM`. */
  mois: string;
  /** Crédits payés comptant (recharges). */
  vendus: number;
  /** Crédits accordés par un abonnement. */
  abonnement: number;
  /** Crédits offerts. */
  offerts: number;
  /** Crédits rendus après un échec. */
  remboursés: number;
  /** Crédits réellement consommés par des générations. */
  consommes: number;
  /**
   * Recette ESTIMÉE des recharges, en CHF : crédits vendus × valeur du
   * crédit. `null` sans valeur configurée. Ce n'est pas l'encaissement réel.
   */
  recetteEstimeeChf: number | null;
  /** Nombre de lignes dont le `type` n'a pas pu être reconnu. */
  nonClassees: number;
}

const arrondi = (v: number) => Math.round(v * 100) / 100;

function entier(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Regroupe les transactions par mois. Les montants sont pris en VALEUR
 * ABSOLUE par type : selon les appelants, un débit a pu être enregistré
 * négatif ou positif, et additionner les deux conventions donnerait un total
 * faux dans un sens comme dans l'autre.
 */
export function bilanParMois(
  lignes: readonly LigneTransaction[],
  valeurCreditChf: number | null,
): MoisCredits[] {
  const valeur = typeof valeurCreditChf === 'number' && valeurCreditChf > 0 ? valeurCreditChf : null;
  const parMois = new Map<string, MoisCredits>();

  for (const l of lignes) {
    const mois = typeof l.created_at === 'string' && l.created_at.length >= 7 ? l.created_at.slice(0, 7) : null;
    if (!mois) continue;
    const entree = parMois.get(mois) ?? {
      mois, vendus: 0, abonnement: 0, offerts: 0, remboursés: 0, consommes: 0,
      recetteEstimeeChf: null, nonClassees: 0,
    };
    const montant = entier(l.amount);
    const type = typeof l.type === 'string' ? l.type : '';
    if (montant === null || montant === 0) {
      entree.nonClassees += 1;
    } else {
      const n = Math.abs(montant);
      switch (type) {
        case 'purchase': entree.vendus += n; break;
        case 'subscription': entree.abonnement += n; break;
        case 'bonus': entree.offerts += n; break;
        case 'refund': entree.remboursés += n; break;
        case 'render': entree.consommes += n; break;
        default: entree.nonClassees += 1;
      }
    }
    parMois.set(mois, entree);
  }

  return [...parMois.values()]
    .map((m) => ({ ...m, recetteEstimeeChf: valeur === null ? null : arrondi(m.vendus * valeur) }))
    .sort((a, b) => (a.mois < b.mois ? 1 : -1));
}

export interface MargeMois {
  mois: string;
  recetteEstimeeChf: number | null;
  coutFournisseurChf: number | null;
  margeEstimeeChf: number | null;
  /** Pourquoi la marge est inconnue, quand elle l'est. */
  motif: string | null;
}

/**
 * Rapproche la recette estimée du coût fournisseur MESURÉ du même mois.
 *
 * `coutFournisseurEur` vient de `fournisseurs/economie` ; il faut donc un taux
 * EUR → CHF pour comparer. Sans lui, la marge reste inconnue plutôt que
 * calculée sur deux monnaies différentes — une erreur qui ne se voit pas et
 * qui fausse tout.
 */
export function margeParMois(args: {
  credits: readonly MoisCredits[];
  coutsFournisseurEur: ReadonlyArray<{ mois: string; coutFournisseurEur: number | null }>;
  /** Combien de CHF vaut 1 EUR. `null` = pas de rapprochement possible. */
  chfParEur: number | null;
}): MargeMois[] {
  const couts = new Map(args.coutsFournisseurEur.map((c) => [c.mois, c.coutFournisseurEur]));
  const taux = typeof args.chfParEur === 'number' && args.chfParEur > 0 ? args.chfParEur : null;

  return args.credits.map((m) => {
    const eur = couts.get(m.mois) ?? null;
    const coutFournisseurChf = eur === null || taux === null ? null : arrondi(eur * taux);
    if (m.recetteEstimeeChf === null) {
      return { mois: m.mois, recetteEstimeeChf: null, coutFournisseurChf, margeEstimeeChf: null, motif: 'Valeur du crédit non configurée : recette non estimable.' };
    }
    if (eur === null) {
      return { mois: m.mois, recetteEstimeeChf: m.recetteEstimeeChf, coutFournisseurChf: null, margeEstimeeChf: null, motif: 'Aucun coût fournisseur mesuré sur ce mois.' };
    }
    if (taux === null) {
      return { mois: m.mois, recetteEstimeeChf: m.recetteEstimeeChf, coutFournisseurChf: null, margeEstimeeChf: null, motif: 'Taux EUR → CHF non enregistré : recette et coût ne sont pas dans la même monnaie.' };
    }
    return {
      mois: m.mois,
      recetteEstimeeChf: m.recetteEstimeeChf,
      coutFournisseurChf,
      margeEstimeeChf: arrondi(m.recetteEstimeeChf - (coutFournisseurChf as number)),
      motif: null,
    };
  });
}
