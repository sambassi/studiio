/**
 * TAUX DE CHANGE USD → CHF — fiable, daté, et jamais inventé.
 *
 * Les coûts fournisseurs sont en USD (HeyGen, Replicate, Higgsfield), les
 * recettes Studiio en CHF. Comparer les deux exige un taux. Deux pièges que
 * ce module ferme :
 *
 *  1. UN TAUX INVENTÉ EST PIRE QU'AUCUN TAUX. Il n'y a aucune valeur de repli
 *     ici : sans taux enregistré, la rentabilité reste `inconnu`, et
 *     l'administration le dit.
 *  2. UN TAUX SANS DATE N'EST PAS UN TAUX. Il vient avec le jour de sa
 *     publication et sa source ; passé `JOURS_TAUX_PERIME`, il est signalé
 *     comme périmé — il sert encore à alerter, plus à rassurer.
 *
 * Fonction PURE. La lecture du taux de référence vit dans
 * `/api/admin/tarifs/taux` ; l'enregistrement passe par l'admin, jamais
 * automatiquement : un taux qui change tout seul changerait les verdicts
 * économiques sans que personne l'ait décidé.
 */
export interface TauxChange {
  /** Combien de CHF vaut 1 USD. */
  chfParUsd: number;
  /** Jour de publication du taux (ISO `AAAA-MM-JJ`). */
  le: string;
  /** D'où il vient. Un taux sans source est un taux inventé. */
  source: string;
}

/** Au-delà, le taux ne décrit plus le mois en cours. */
export const JOURS_TAUX_PERIME = 30;

/** Bornes de bon sens : USD/CHF n'a jamais quitté cet intervalle. */
export const TAUX_MIN = 0.1;
export const TAUX_MAX = 10;

export const SOURCE_REFERENCE =
  'Banque centrale européenne (taux de référence), via api.frankfurter.dev';

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

export function tauxValide(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= TAUX_MIN && v <= TAUX_MAX;
}

export function normaliserTaux(brut: unknown): TauxChange | null {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return null;
  const t = brut as { chfParUsd?: unknown; le?: unknown; source?: unknown };
  if (!tauxValide(t.chfParUsd)) return null;
  if (typeof t.le !== 'string' || !DATE_ISO.test(t.le)) return null;
  return {
    chfParUsd: t.chfParUsd,
    le: t.le,
    source: typeof t.source === 'string' && t.source.trim() ? t.source.trim().slice(0, 200) : SOURCE_REFERENCE,
  };
}

export function jourAge(le: string, maintenant: Date = new Date()): number | null {
  if (!DATE_ISO.test(le)) return null;
  const t = Date.parse(`${le}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return Math.floor((maintenant.getTime() - t) / 86_400_000);
}

export function tauxPerime(taux: TauxChange | null, maintenant?: Date): boolean {
  if (!taux) return false;
  const age = jourAge(taux.le, maintenant);
  return age !== null && age > JOURS_TAUX_PERIME;
}

/** Phrase d'état, telle qu'affichée à l'administration. */
export function libelleTaux(taux: TauxChange | null, maintenant?: Date): string {
  if (!taux) return 'Aucun taux enregistré : les marges en USD ne sont pas calculées.';
  const age = jourAge(taux.le, maintenant);
  const vieux = tauxPerime(taux, maintenant);
  const jours = age === null ? '' : age === 0 ? ' (aujourd’hui)' : ` (il y a ${age} jour${age > 1 ? 's' : ''})`;
  return `1 USD = ${taux.chfParUsd} CHF — ${taux.le}${jours}${vieux ? ' · PÉRIMÉ, à rafraîchir' : ''}`;
}
