/**
 * Packs de crédits vendus en Mobile Money — SOURCE CANONIQUE EN CHF.
 *
 * SERVEUR UNIQUEMENT. Le CHF est la devise de référence. La conversion vers
 * la devise locale se fait côté serveur, avec des taux FIXES lus dans la
 * variable d'environnement `PAWAPAY_RATES` (voir `analyserTauxChf` et
 * `obtenirTauxChf` dans `store.ts`) puis PASSÉS EN PARAMÈTRE à `prixLocal`.
 * Aucun taux n'est écrit dans le code, aucune API de taux n'est appelée.
 * Une devise sans taux valide est refusée — jamais de repli silencieux.
 * Le client n'envoie ni prix, ni crédits, ni taux : il choisit un pack.
 *
 * Calcul sans flottant : les prix sont en centimes CHF (entiers), les taux en
 * chaînes décimales, et le produit est fait en `BigInt`.
 *   montant local = plafond(prix en centimes CHF × taux / 100)
 *
 * RÈGLE D'ARRONDI (inchangée, testée)
 * - Unité ENTIÈRE de la devise locale, arrondie AU SUPÉRIEUR : 38 701,463 →
 *   38 702. Studiio ne perd jamais sur la conversion, et la plupart des
 *   opérateurs Mobile Money n'acceptent pas de décimales
 *   (`decimalsInAmount: NONE` dans `/v2/active-conf`).
 * - Minimum : 1 unité.
 * - `PAS_ARRONDI` permettrait un pas plus grossier par devise (ex. multiple de
 *   5 ou de 25 pour le XOF). Il est VIDE : ce choix, comme le respect des
 *   minimums et maximums par opérateur (`minTransactionLimit` /
 *   `maxTransactionLimit`), reste une décision métier non tranchée.
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

const CODE_DEVISE_RX = /^[A-Z]{3}$/;

/**
 * Bornes de PLAUSIBILITÉ par devise, en unités locales pour 1 CHF. Ce ne sont
 * PAS des taux : ce sont des garde-fous volontairement très larges (de l'ordre
 * de ÷5 à ×5 autour des ordres de grandeur connus) contre une faute de frappe
 * dans `PAWAPAY_RATES` — un zéro en trop ou en moins, une virgule déplacée.
 * Hors bornes, la devise est refusée (journal sans la valeur).
 *
 * Une devise ABSENTE de cette table est acceptée sans contrôle de
 * plausibilité : seul le contrôle de forme (> 0, décimale simple) s'applique.
 */
export const BORNES_TAUX_CHF: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
  XOF: [100, 2000],
  XAF: [100, 2000],
  GHS: [1, 100],
  KES: [20, 1000],
  NGN: [100, 20000],
  UGX: [500, 20000],
  RWF: [200, 10000],
  TZS: [500, 20000],
  ZMW: [1, 200],
  CDF: [500, 20000],
  MWK: [200, 10000],
  MZN: [10, 500],
  SLE: [2, 300],
});

/** Le taux (déjà valide en forme) est-il dans les bornes de sa devise ? */
function tauxPlausible(devise: string, brut: unknown): boolean {
  const bornes = BORNES_TAUX_CHF[devise];
  if (!bornes) return true;
  const { entier, echelle } = lireTaux(devise, brut);
  return entier >= BigInt(bornes[0]) * echelle && entier <= BigInt(bornes[1]) * echelle;
}

/** Un taux est-il exploitable ? Nombre fini > 0, ou chaîne décimale simple > 0. */
function tauxValide(devise: string, brut: unknown): boolean {
  try {
    lireTaux(devise, brut);
    return true;
  } catch {
    return false;
  }
}

export interface AnalyseTaux {
  /** Taux retenus, clés en majuscules. `null` si la configuration est refusée. */
  taux: TauxChf | null;
  /** Codes de devise écartés (taux invalide ou hors bornes) — jamais les valeurs. */
  devisesRefusees: string[];
  /** Sous-ensemble de `devisesRefusees` écarté parce que hors `BORNES_TAUX_CHF`. */
  devisesHorsBornes: string[];
  /** Nombre de clés ignorées car ce ne sont pas des codes ISO à 3 lettres. */
  clesIgnorees: number;
  /** Raison d'un refus global, sans jamais citer la valeur. */
  erreur?: 'absente' | 'json_invalide' | 'pas_un_objet' | 'aucun_taux_valide';
}

/**
 * Analyse `PAWAPAY_RATES` (JSON `{"XOF": 655.957, "XAF": 655.957}`).
 *
 * - Absente, JSON invalide, ou autre chose qu'un objet → configuration
 *   refusée en bloc (`taux: null`).
 * - Clés normalisées en majuscules (espaces retirés) ; une clé qui n'est pas
 *   un code ISO à 3 lettres est ignorée.
 * - Un taux ≤ 0, NaN, Infinity, non numérique, ou hors des bornes de
 *   plausibilité de sa devise (`BORNES_TAUX_CHF`) écarte SA devise seulement ;
 *   les autres restent utilisables. Si aucune devise ne reste, la
 *   configuration est refusée en bloc.
 * - Une clé en double après normalisation (ex. « xof » et « XOF ») est
 *   ambiguë : la devise est écartée.
 */
export function analyserTauxChf(brut: string | undefined): AnalyseTaux {
  const vide: AnalyseTaux = { taux: null, devisesRefusees: [], devisesHorsBornes: [], clesIgnorees: 0 };
  if (brut === undefined || brut.trim() === '') return { ...vide, erreur: 'absente' };
  let objet: unknown;
  try {
    objet = JSON.parse(brut);
  } catch {
    return { ...vide, erreur: 'json_invalide' };
  }
  if (typeof objet !== 'object' || objet === null || Array.isArray(objet)) {
    return { ...vide, erreur: 'pas_un_objet' };
  }
  const taux: TauxChf = {};
  const refusees = new Set<string>();
  const horsBornes = new Set<string>();
  const vues = new Set<string>();
  let clesIgnorees = 0;
  for (const [cle, valeur] of Object.entries(objet as Record<string, unknown>)) {
    const code = cle.trim().toUpperCase();
    if (!CODE_DEVISE_RX.test(code)) { clesIgnorees++; continue; }
    if (vues.has(code)) { refusees.add(code); delete taux[code]; continue; }
    vues.add(code);
    if (typeof valeur === 'number' || typeof valeur === 'string') {
      if (tauxValide(code, valeur)) {
        if (tauxPlausible(code, valeur)) { taux[code] = valeur; continue; }
        horsBornes.add(code);
      }
    }
    refusees.add(code);
  }
  const devisesRefusees = [...refusees].sort();
  const devisesHorsBornes = [...horsBornes].filter((c) => refusees.has(c)).sort();
  if (Object.keys(taux).length === 0) {
    return { taux: null, devisesRefusees, devisesHorsBornes, clesIgnorees, erreur: 'aucun_taux_valide' };
  }
  return { taux, devisesRefusees, devisesHorsBornes, clesIgnorees };
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
