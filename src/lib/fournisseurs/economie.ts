/**
 * ÉCONOMIE STUDIIO — ce que coûtent les fournisseurs, mois par mois.
 *
 * Source : `avatar_generations` (provider_cost_eur, studiio_price_eur,
 * admin_usage — migration 2026-10-06-avatar-couts). C'est aujourd'hui la SEULE
 * source de coût fournisseur MESURÉ : ElevenLabs hors avatar, Replicate,
 * Anthropic, Groq ne sont pas encore tracés par génération (il faudrait une
 * table de consommation — migration à valider). Le revenu d'abonnement n'est
 * pas rapproché ici : il vit dans Stripe (`subscriptions`, `stripe_events`).
 *
 * ⚠️ Un coût NON MESURÉ n'est pas un coût nul : `null` et un compteur
 * `nonMesurees`, jamais 0. Fonction PURE.
 */
export interface MoisEconomie {
  mois: string;
  parFournisseur: Record<string, { generations: number; mesurees: number; coutEur: number | null }>;
  generations: number;
  coutFournisseurEur: number | null;
  coutMoyenVideoEur: number | null;
  prixStudiioEur: number | null;
  margeBruteEur: number | null;
  nonMesurees: number;
  /**
   * Coût HeyGen ESTIMÉ (USD) : durée × tarif officiel du moteur
   * (`tarifs-heygen.ts`), générations terminées seulement. `null` sans durée.
   */
  coutHeygenEstimeUsd: number | null;
  /** Dont usages ADMIN : 0 crédit Studiio, mais bien payés chez HeyGen. */
  coutHeygenAdminEstimeUsd: number | null;
  /** Secondes générées (terminées) — la base de facturation HeyGen. */
  secondesHeygen: number;
}

import { coutEstimeHeygenUsd } from '@/lib/fournisseurs/tarifs-heygen';

const arrondi = (v: number) => Math.round(v * 10000) / 10000;
const nombre = (v: unknown): number | null => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

export function economieParMois(lignes: Array<Record<string, unknown>>): MoisEconomie[] {
  const parMois = new Map<string, Array<Record<string, unknown>>>();
  for (const l of lignes) {
    const mois = typeof l.created_at === 'string' ? l.created_at.slice(0, 7) : null;
    if (!mois) continue;
    parMois.set(mois, [...(parMois.get(mois) ?? []), l]);
  }
  return [...parMois.entries()].sort(([a], [b]) => (a < b ? 1 : -1)).map(([mois, ls]) => {
    const parFournisseur: MoisEconomie['parFournisseur'] = {};
    let cout = 0; let mesurees = 0; let prix = 0; let prixMesures = 0;
    let heygen = 0; let heygenAdmin = 0; let heygenEstimes = 0; let secondes = 0;
    for (const l of ls) {
      if (l.provider === 'heygen' && l.status === 'completed') {
        const usd = coutEstimeHeygenUsd({ engine: l.engine as string | null, avatarType: l.avatar_type as string | null, secondes: nombre(l.duration_seconds) });
        if (usd !== null) {
          heygen += usd; heygenEstimes += 1; secondes += nombre(l.duration_seconds) ?? 0;
          if (l.admin_usage === true) heygenAdmin += usd;
        }
      }
      const f = typeof l.provider === 'string' ? l.provider : 'inconnu';
      const entree = parFournisseur[f] ?? { generations: 0, mesurees: 0, coutEur: null };
      entree.generations += 1;
      const c = nombre(l.provider_cost_eur);
      if (c !== null) {
        entree.mesurees += 1;
        entree.coutEur = arrondi((entree.coutEur ?? 0) + c);
        cout += c; mesurees += 1;
      }
      const p = nombre(l.studiio_price_eur);
      if (p !== null) { prix += p; prixMesures += 1; }
      parFournisseur[f] = entree;
    }
    const coutFournisseurEur = mesurees ? arrondi(cout) : null;
    const prixStudiioEur = prixMesures ? arrondi(prix) : null;
    return {
      mois,
      parFournisseur,
      generations: ls.length,
      coutFournisseurEur,
      coutMoyenVideoEur: mesurees ? arrondi(cout / mesurees) : null,
      prixStudiioEur,
      margeBruteEur: coutFournisseurEur !== null && prixStudiioEur !== null ? arrondi(prixStudiioEur - coutFournisseurEur) : null,
      nonMesurees: ls.length - mesurees,
      coutHeygenEstimeUsd: heygenEstimes ? arrondi(heygen) : null,
      coutHeygenAdminEstimeUsd: heygenEstimes ? arrondi(heygenAdmin) : null,
      secondesHeygen: arrondi(secondes),
    };
  });
}
