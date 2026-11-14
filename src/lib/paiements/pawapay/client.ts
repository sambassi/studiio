/**
 * APPELS AU PRESTATAIRE MOBILE MONEY — côté serveur, et nulle part ailleurs.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TROIS VERROUS AVANT LE MOINDRE APPEL SORTANT
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   1. `etatMobileMoney()` doit être ouvert — drapeau à `'1'`, jeton présent,
 *      URL de rappel présente. Fermé par défaut.
 *   2. Le jeton n'est lu QUE dans ce module, n'est jamais journalisé, jamais
 *      rendu dans une réponse, jamais placé ailleurs que dans l'en-tête
 *      `Authorization`.
 *   3. `fournisseurSimule()` court-circuite tout appel réseau en test et en
 *      prévisualisation : la simulation n'est pas un repli silencieux, c'est
 *      un choix explicite de configuration.
 *
 * Aucune fonction d'ici n'écrit en base ni ne crédite : elle appelle,
 * elle lit, elle rend. La décision appartient à `confirmation.ts`.
 */
import {
  BASE_PRODUCTION, BASE_SANDBOX, etatMobileMoney, type EtatMobileMoney,
} from '@/lib/paiements/mobile-money';
import {
  corpsPagePaiement, lireDepot, lirePagePaiement,
  type DemandePagePaiement, type LectureDepot, type LecturePagePaiement,
} from './contrat';

export const DELAI_APPEL_MS = 15_000;

/** Message rendu à l'utilisateur quand le prestataire ne répond pas. */
export const MESSAGE_PRESTATAIRE_INJOIGNABLE =
  'Le service de paiement mobile est momentanément indisponible. Aucun montant n’a été débité.';

export class ErreurPrestataire extends Error {
  constructor(message: string, readonly etape: string, readonly statut?: number) {
    super(message);
    this.name = 'ErreurPrestataire';
  }
}

function base(env: NodeJS.ProcessEnv = process.env): string {
  const b = (env.MOBILE_MONEY_BASE_URL || BASE_SANDBOX).trim().replace(/\/+$/, '');
  return b || BASE_SANDBOX;
}

/** Vrai quand aucun appel réel ne doit partir : tests et prévisualisation. */
export function fournisseurSimule(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MOBILE_MONEY_SIMULE === '1';
}

export function enProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return base(env).startsWith(BASE_PRODUCTION);
}

async function appeler(
  chemin: string,
  init: RequestInit,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ statut: number; corps: unknown }> {
  const etat: EtatMobileMoney = etatMobileMoney(env);
  if (!etat.actif) {
    throw new ErreurPrestataire(etat.message ?? 'service fermé', 'ferme');
  }
  const jeton = (env.MOBILE_MONEY_API_TOKEN || '').trim();
  const reponse = await fetch(`${base(env)}${chemin}`, {
    ...init,
    cache: 'no-store',
    signal: AbortSignal.timeout(DELAI_APPEL_MS),
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      // Le jeton ne sort d'ici que dans cet en-tête.
      authorization: `Bearer ${jeton}`,
      ...(init.headers ?? {}),
    },
  });
  const texte = await reponse.text();
  let corps: unknown = null;
  try { corps = texte ? JSON.parse(texte) : null; } catch { corps = null; }
  return { statut: reponse.status, corps };
}

/**
 * Crée la page de paiement hébergée.
 *
 * ⚠️ UNE SEULE RELANCE, et seulement sur `INVALID_PHONE_NUMBER` : la page
 * redemandera le numéro elle-même. Toute autre erreur n'est pas retentée —
 * réessayer en aveugle sur un paiement, c'est risquer d'en créer deux.
 */
export async function creerPagePaiement(
  d: DemandePagePaiement,
  env: NodeJS.ProcessEnv = process.env,
): Promise<LecturePagePaiement> {
  const envoyer = async (avecTelephone: boolean) => {
    const corps = corpsPagePaiement(avecTelephone ? d : { ...d, telephone: null });
    const r = await appeler('/v2/paymentpage', { method: 'POST', body: JSON.stringify(corps) }, env);
    return { ...lirePagePaiement(r.corps), statutHttp: r.statut };
  };

  let lu = await envoyer(!!d.telephone);
  if (!lu.ok && lu.refus === 'telephone_invalide' && d.telephone) {
    console.warn('[mobile money] numéro refusé, relance sans numéro', { depositId: d.depositId });
    lu = await envoyer(false);
  }
  return lu;
}

/**
 * Relit l'état d'un dépôt AUPRÈS DU PRESTATAIRE. C'est la seule source de
 * vérité d'un paiement : ni le retour du navigateur, ni le corps d'une
 * notification ne valent preuve.
 */
export async function lireEtatDepot(
  depositId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<LectureDepot> {
  const r = await appeler(`/v2/deposits/${encodeURIComponent(depositId)}`, { method: 'GET' }, env);
  if (r.statut >= 500) {
    throw new ErreurPrestataire(`relecture impossible (${r.statut})`, 'relecture', r.statut);
  }
  return lireDepot(r.corps);
}

export interface PaysDisponible {
  pays: string;
  devise: string;
}

/**
 * Les pays RÉELLEMENT ouverts sur le compte marchand, et leur devise.
 *
 * ⚠️ On ne décide pas des pays : le compte le fait. Une liste codée ici
 * divergerait du compte sans prévenir — un pays retiré chez le prestataire
 * resterait proposé, et le paiement échouerait après le clic.
 */
export async function paysDisponibles(env: NodeJS.ProcessEnv = process.env): Promise<PaysDisponible[]> {
  const r = await appeler('/v2/active-conf', { method: 'GET' }, env);
  const racine = (r.corps && typeof r.corps === 'object' ? r.corps : {}) as Record<string, unknown>;
  const liste = Array.isArray(racine.countries) ? racine.countries : [];
  const out: PaysDisponible[] = [];
  for (const brut of liste) {
    const c = (brut && typeof brut === 'object' ? brut : {}) as Record<string, unknown>;
    const pays = typeof c.country === 'string' ? c.country.toUpperCase() : null;
    const devise = typeof c.currency === 'string'
      ? c.currency.toUpperCase()
      : (Array.isArray(c.providers) && c.providers[0] && typeof c.providers[0] === 'object'
        ? String((c.providers[0] as Record<string, unknown>).currency ?? '').toUpperCase() || null
        : null);
    if (pays && devise) out.push({ pays, devise });
  }
  return out;
}
