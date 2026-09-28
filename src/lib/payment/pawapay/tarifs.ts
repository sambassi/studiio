/**
 * Packs de crédits vendus en Mobile Money — SOURCE CANONIQUE EN CHF.
 *
 * La conversion vers la devise locale se fait CÔTÉ SERVEUR, avec des taux
 * PASSÉS EN PARAMÈTRE : aucun taux (XOF ou autre) n'est figé ici. Une devise
 * sans taux est refusée — jamais de repli silencieux.
 *
 * Calcul sans flottant : les prix sont en centimes CHF (entiers), les taux en
 * chaînes décimales, et le produit est fait en `BigInt`.
 *
 * ARRONDIS PAR DEVISE
 * - Par défaut : unité ENTIÈRE, arrondie AU SUPÉRIEUR (Studiio ne perd jamais
 *   sur la conversion). La plupart des opérateurs Mobile Money n'acceptent
 *   pas de décimales (`decimalsInAmount: NONE` dans `/v2/active-conf`).
 * - `PAS_ARRONDI` permet un pas plus grossier par devise (ex. arrondir au
 *   multiple de 5 ou de 100 supérieur). Il est vide aujourd'hui : un pas se
 *   choisit en connaissance du marché, pas par défaut.
 * - Minimum : 1 unité.
 */

export interface PackPawapay {
  id: PackId;
  credits: number;
  /** Prix en centimes de CHF (entier). */
  prixCentimesChf: number;
}

export type PackId = 'small' | 'medium' | 'large' | 'xlarge';

export const PACKS_PAWAPAY: Readonly<Record<PackId, PackPawapay>> = Object.freeze({
  small: { id: 'small', credits: 50, prixCentimesChf: 900 },
  medium: { id: 'medium', credits: 200, prixCentimesChf: 2900 },
  large: { id: 'large', credits: 500, prixCentimesChf: 5900 },
  xlarge: { id: 'xlarge', credits: 2000, prixCentimesChf: 17900 },
});

export function estPackId(v: unknown): v is PackId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PACKS_PAWAPAY, v);
}

/** Pas d'arrondi (en unités majeures entières) par devise. Défaut : 1. */
export const PAS_ARRONDI: Readonly<Record<string, number>> = Object.freeze({});

/** Taux : combien d'unités de la devise locale pour 1 CHF. */
export type TauxChf = Record<string, string | number>;

export class DeviseSansTauxErreur extends Error {
  constructor(devise: string) {
    super(`Aucun taux CHF → ${devise} : devise refusée`);
    this.name = 'DeviseSansTauxErreur';
  }
}

/** Taux en décimale positive → { entier, echelle } avec taux = entier / 10^echelle. */
function lireTaux(devise: string, brut: unknown): { entier: bigint; echelle: bigint } {
  let s: string;
  if (typeof brut === 'string') s = brut.trim();
  else if (typeof brut === 'number' && Number.isFinite(brut) && brut > 0) s = String(brut);
  else throw new DeviseSansTauxErreur(devise);
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new DeviseSansTauxErreur(devise);
  const fraction = m[2] ?? '';
  const entier = BigInt(m[1] + fraction);
  if (entier <= 0n) throw new DeviseSansTauxErreur(devise);
  return { entier, echelle: 10n ** BigInt(fraction.length) };
}

/**
 * Prix d'un pack en devise locale, chaîne d'entier (ex. « 5900 »).
 * Lève `DeviseSansTauxErreur` si la devise n'a pas de taux valide.
 */
export function prixLocal(packId: PackId, devise: string, taux: TauxChf): string {
  const pack = PACKS_PAWAPAY[packId];
  if (!pack) throw new Error(`Pack inconnu : ${packId}`);
  if (!devise || !Object.prototype.hasOwnProperty.call(taux, devise)) {
    throw new DeviseSansTauxErreur(devise);
  }
  const { entier, echelle } = lireTaux(devise, taux[devise]);
  const pas = BigInt(Math.max(1, Math.trunc(PAS_ARRONDI[devise] ?? 1)));

  // montant = centimes × taux / 100, arrondi au pas supérieur.
  const numerateur = BigInt(pack.prixCentimesChf) * entier;
  const denominateur = 100n * echelle * pas;
  let unites = (numerateur + denominateur - 1n) / denominateur; // plafond
  if (unites < 1n) unites = 1n;
  return (unites * pas).toString();
}
