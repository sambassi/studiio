/**
 * ESTIMATION DE LA PAROLE DE L'AVATAR — la règle UNIQUE, PURE (aucun réseau),
 * partagée par l'aperçu de l'Autopilote (`paroleAvatarPrevue`) et le moteur
 * (`produire.ts`, qui écrit l'estimation à côté de la parole mesurée).
 *
 * Avant : l'aperçu estimait la parole depuis le BUDGET du script
 * (`paroleAvatarDuBudget` ≈ la durée cible par construction), alors que le
 * script réel — composé par unités entières SOUS le budget — est plus court,
 * et que la voix clonée n'a pas exactement le débit de la constante
 * (`RATIO_DEBIT_AVATAR`). L'aperçu ne montrait presque jamais la séquence de
 * clôture que le MP4 aurait.
 *
 * Maintenant :
 *   1. l'estimation part du SCRIPT RÉEL (caractères, même décompte que
 *      `estimerParoleJumeau`) ;
 *   2. le débit est celui DU COMPTE quand des rendus précédents ont enregistré
 *      leur parole mesurée (`metadata.paroleEstimation`) — sinon le débit par
 *      défaut (`debitParoleAvatar`, inchangé).
 *
 * ⚠️ Rien ici ne touche à la voix, à sa vitesse ni au budget du script :
 * seule la PRÉVISION change.
 */
import { debitParoleAvatar } from '@/lib/autopilot/duree-cible';
import type { RythmeBrief } from '@/lib/creer/brief';

export const ESTIMATION_PAROLE_VERSION = 1;

/** Échantillons retenus pour calibrer (les plus récents). */
export const ECHANTILLONS_PAROLE_MAX = 10;
/** Script trop court pour mesurer un débit (pauses et attaques dominent). */
export const CARACTERES_MIN_ECHANTILLON = 40;
/** Débits plausibles (car./s) : hors de cette plage, l'échantillon est faux (mauvais script, mesure ratée). */
export const DEBIT_MIN = 5;
export const DEBIT_MAX = 25;

/** Le décompte de la parole — le MÊME que `estimerParoleJumeau` (longueur du script nettoyé). */
export function caracteresParole(script: string | null | undefined): number {
  return (script ?? '').trim().length;
}

export interface EchantillonParole {
  caracteres: number;
  mesureeS: number;
}

const debitPlausible = (d: unknown): d is number => typeof d === 'number' && Number.isFinite(d) && d >= DEBIT_MIN && d <= DEBIT_MAX;

/** L'échantillon d'un rendu (`metadata.paroleEstimation`), ou `null` s'il est inexploitable. */
export function echantillonDeMetadata(parole: unknown): EchantillonParole | null {
  if (!parole || typeof parole !== 'object') return null;
  const p = parole as { caracteres?: unknown; mesureeS?: unknown };
  const caracteres = p.caracteres;
  const mesureeS = p.mesureeS;
  if (typeof caracteres !== 'number' || !Number.isFinite(caracteres) || caracteres < CARACTERES_MIN_ECHANTILLON) return null;
  if (typeof mesureeS !== 'number' || !Number.isFinite(mesureeS) || mesureeS <= 0) return null;
  if (!debitPlausible(caracteres / mesureeS)) return null;
  return { caracteres, mesureeS };
}

/**
 * Le débit PROPRE AU COMPTE (car./s) : total des caractères ÷ total des
 * secondes mesurées, sur les `ECHANTILLONS_PAROLE_MAX` premiers échantillons
 * valides (passés du plus récent au plus ancien). `null` sans échantillon.
 *
 * Le débit mesuré ne dépend pas du rythme du brief : la voix n'est jamais
 * accélérée, seul le budget du script change avec le rythme.
 */
export function debitCalibre(echantillons: ReadonlyArray<unknown>): number | null {
  const ok = echantillons.map(echantillonDeMetadata).filter((e): e is EchantillonParole => e !== null).slice(0, ECHANTILLONS_PAROLE_MAX);
  if (!ok.length) return null;
  const c = ok.reduce((t, e) => t + e.caracteres, 0);
  const s = ok.reduce((t, e) => t + e.mesureeS, 0);
  const d = Math.round((c / s) * 100) / 100;
  return debitPlausible(d) ? d : null;
}

export interface EstimationParole {
  /** Parole estimée (s), au dixième ; 0 sans script. */
  secondes: number;
  caracteres: number;
  /** Débit retenu (car./s). */
  debit: number;
  methode: 'compte' | 'defaut';
}

/**
 * LA parole estimée d'un script. Sans débit du compte : EXACTEMENT
 * `estimerParoleJumeau` (débit par défaut du rythme).
 */
export function estimerParoleAvatar(
  script: string | null | undefined,
  o: { rythme?: RythmeBrief | null; debitCompte?: number | null } = {},
): EstimationParole {
  const caracteres = caracteresParole(script);
  const compte = debitPlausible(o.debitCompte) ? o.debitCompte : null;
  const debit = compte ?? debitParoleAvatar(o.rythme);
  return {
    secondes: caracteres > 0 ? Math.round((caracteres / debit) * 10) / 10 : 0,
    caracteres,
    debit,
    methode: compte !== null ? 'compte' : 'defaut',
  };
}

/** Ce que le moteur écrit dans `metadata.paroleEstimation` : la prévision ET la mesure. */
export function paroleEstimationPourMetadata(e: EstimationParole, mesureeS: number | null): {
  version: number;
  caracteres: number;
  debit: number;
  methode: EstimationParole['methode'];
  estimeeS: number;
  mesureeS: number | null;
  ecartS: number | null;
} {
  const m = typeof mesureeS === 'number' && Number.isFinite(mesureeS) && mesureeS > 0 ? Math.round(mesureeS * 1000) / 1000 : null;
  return {
    version: ESTIMATION_PAROLE_VERSION,
    caracteres: e.caracteres,
    debit: e.debit,
    methode: e.methode,
    estimeeS: e.secondes,
    mesureeS: m,
    ecartS: m === null ? null : Math.round((e.secondes - m) * 1000) / 1000,
  };
}
