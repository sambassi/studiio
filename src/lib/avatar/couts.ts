/**
 * Coût d'une génération d'avatar — fournisseur, prix Studiio, marge.
 *
 *  - provider_cost : coût EXTERNE (fournisseur vidéo + synthèse de la voix),
 *    calculé sur les tarifs déclarés côté serveur. `null` = non mesurable
 *    (tarif absent) — jamais 0 inventé.
 *  - studiio_price : crédits Studiio réellement débités (0 pour un admin).
 *  - margin        : prix Studiio en euros − coût fournisseur ; pour un admin
 *    = −coût fournisseur (usage interne, payé par Studiio).
 *
 * Tarifs (variables serveur, jamais exposées à l'utilisateur) :
 *   AVATAR_COUT_EUR_PAR_SECONDE    — vidéo d'avatar, par seconde produite
 *   VOIX_COUT_EUR_PAR_CARACTERE    — synthèse de la voix, par caractère dit
 *   STUDIIO_VALEUR_CREDIT_EUR      — valeur d'un crédit Studiio en euros
 * Les prix commerciaux Studiio ne sont PAS modifiés ici.
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import { isAdmin } from '@/lib/admin';
import type { AvatarProvider } from '@/lib/avatar/fournisseurs';

const nombre = (v: string | undefined): number | null => {
  const n = v === undefined || v.trim() === '' ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export interface TarifsFournisseurs { avatarEurParSeconde: number | null; voixEurParCaractere: number | null; valeurCreditEur: number | null }
export function tarifsFournisseurs(env: NodeJS.ProcessEnv = process.env): TarifsFournisseurs {
  return {
    avatarEurParSeconde: nombre(env.AVATAR_COUT_EUR_PAR_SECONDE),
    voixEurParCaractere: nombre(env.VOIX_COUT_EUR_PAR_CARACTERE),
    valeurCreditEur: nombre(env.STUDIIO_VALEUR_CREDIT_EUR),
  };
}

export interface CoutGeneration {
  provider: AvatarProvider;
  admin: boolean;
  /** Coût externe en euros, `null` si non mesurable. */
  providerCostEur: number | null;
  /** Crédits Studiio réellement débités. */
  studiioCredits: number;
  studiioPriceEur: number | null;
  marginEur: number | null;
}

const arrondi = (n: number) => Math.round(n * 10000) / 10000;

export function calculerCoutGeneration(
  p: { provider: AvatarProvider; admin: boolean; secondes: number | null; caracteres: number; creditsDebites: number },
  env: NodeJS.ProcessEnv = process.env,
): CoutGeneration {
  const t = tarifsFournisseurs(env);
  const video = t.avatarEurParSeconde !== null && p.secondes !== null ? t.avatarEurParSeconde * p.secondes : null;
  const voix = t.voixEurParCaractere !== null ? t.voixEurParCaractere * p.caracteres : null;
  const providerCostEur = video !== null && voix !== null ? arrondi(video + voix) : null;
  // Un admin ne paie RIEN à Studiio, quel que soit ce que la ligne a noté.
  const studiioCredits = p.admin ? 0 : Math.max(0, p.creditsDebites);
  const studiioPriceEur = t.valeurCreditEur !== null ? arrondi(studiioCredits * t.valeurCreditEur) : (p.admin ? 0 : null);
  const marginEur = providerCostEur !== null && studiioPriceEur !== null ? arrondi(studiioPriceEur - providerCostEur) : null;
  return { provider: p.provider, admin: p.admin, providerCostEur, studiioCredits, studiioPriceEur, marginEur };
}

export async function compteAdmin(userId: string): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin.from('users').select('email').eq('id', userId).single();
    return !!(data as { email?: string } | null)?.email && isAdmin((data as { email: string }).email);
  } catch {
    return false;
  }
}

/**
 * Écrit le coût sur `avatar_generations` (colonnes de la migration
 * 2026-10-06-avatar-couts.sql). Tant que la migration n'est pas appliquée,
 * l'écriture échoue proprement et le coût est JOURNALISÉ — jamais bloquant.
 */
export async function enregistrerCoutGeneration(generationId: string, cout: CoutGeneration, providerError?: string | null): Promise<void> {
  const ligne = {
    provider_cost_eur: cout.providerCostEur,
    studiio_credits: cout.studiioCredits,
    studiio_price_eur: cout.studiioPriceEur,
    margin_eur: cout.marginEur,
    admin_usage: cout.admin,
    ...(providerError ? { provider_error: providerError.slice(0, 2000) } : {}),
  };
  try {
    const { error } = await supabaseAdmin.from('avatar_generations').update(ligne).eq('id', generationId);
    if (error) console.warn(`[Avatar][coût] non enregistré en base (${error.message}) :`, JSON.stringify({ generationId, ...ligne }));
  } catch (e) {
    console.warn('[Avatar][coût] écriture impossible :', e instanceof Error ? e.message : e, JSON.stringify({ generationId, ...ligne }));
  }
}
