/**
 * Synchronisation des tarifs depuis Stripe vers `plans` / `credit_packs`.
 *
 * But : remplir la base (qui fait autorité, cf. `lib/stripe/prix`) sans SQL
 * manuel, à partir des produits Studiio du compte Afroboosteur.
 *
 * Pour chaque offre, le produit est `stripe_product_id` en base s'il existe,
 * sinon la constante `PRODUITS_STRIPE_*`. Ses prix ACTIFS en CHF sont lus :
 *   - plan : exactement un récurrent mensuel ET un récurrent annuel ;
 *   - pack : exactement un paiement unique.
 * Zéro ou plusieurs candidats → erreur pour cette offre. Rien n'est choisi
 * au hasard, et AUCUNE écriture n'a lieu tant qu'une erreur subsiste.
 *
 * `calculerSynchro` ne fait que lire ; `appliquerSynchro` écrit le diff.
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import { STRIPE_PLANS, CREDIT_PACKAGES } from '@/lib/stripe/constants';
import { PRODUITS_STRIPE_PLANS, PRODUITS_STRIPE_PACKS } from '@/lib/stripe/produits';
import { DEVISE, PLANS_PAYANTS, PACKS } from '@/lib/stripe/prix';

type StripeLecture = {
  prices: { list: (p: any) => Promise<{ data: any[]; has_more?: boolean }> };
};

export interface Changement<T> { avant: T; apres: T }

export interface LigneSynchro {
  table: 'plans' | 'credit_packs';
  key: string;
  existe: boolean;
  credits: number;
  champs: Record<string, Changement<string | number | null>>;
  /** Vrai si au moins un champ change. */
  modifie: boolean;
}

export interface ResultatSynchro {
  lignes: LigneSynchro[];
  erreurs: string[];
}

async function prixActifs(stripe: StripeLecture, produit: string): Promise<any[]> {
  const tous: any[] = [];
  let apres: string | undefined;
  for (let page = 0; page < 20; page++) {
    const res = await stripe.prices.list({ product: produit, active: true, limit: 100, ...(apres ? { starting_after: apres } : {}) });
    const data = res?.data ?? [];
    tous.push(...data);
    if (!res?.has_more || data.length === 0) break;
    apres = data[data.length - 1].id;
  }
  return tous.filter((p) => p?.active !== false && String(p?.currency || '').toLowerCase() === DEVISE);
}

const mensuel = (p: any) => p?.recurring?.interval === 'month' && (p.recurring.interval_count ?? 1) === 1;
const annuel = (p: any) => p?.recurring?.interval === 'year' && (p.recurring.interval_count ?? 1) === 1;
const unique = (p: any) => !p?.recurring;

function unSeul(candidats: any[], quoi: string, erreurs: string[]): any | null {
  if (candidats.length === 1) return candidats[0];
  erreurs.push(candidats.length === 0
    ? `${quoi} : aucun prix actif en CHF`
    : `${quoi} : ${candidats.length} prix actifs candidats (${candidats.map((c) => c.id).join(', ')}) — en archiver pour n'en garder qu'un`);
  return null;
}

function champ<T>(champs: LigneSynchro['champs'], nom: string, avant: T, apres: T) {
  champs[nom] = { avant: (avant ?? null) as any, apres: (apres ?? null) as any };
}

export async function calculerSynchro(stripe: StripeLecture): Promise<ResultatSynchro> {
  const erreurs: string[] = [];
  const lignes: LigneSynchro[] = [];

  const { data: plans, error: e1 } = await supabaseAdmin.from('plans').select('*');
  if (e1) throw new Error(`lecture plans : ${e1.message}`);
  const { data: packs, error: e2 } = await supabaseAdmin.from('credit_packs').select('*');
  if (e2) throw new Error(`lecture credit_packs : ${e2.message}`);

  for (const key of PLANS_PAYANTS) {
    const row = (plans ?? []).find((r: any) => r.key === key) ?? null;
    const produit = row?.stripe_product_id || PRODUITS_STRIPE_PLANS[key];
    const actifs = await prixActifs(stripe, produit);
    const m = unSeul(actifs.filter(mensuel), `plan ${key} mensuel (${produit})`, erreurs);
    const y = unSeul(actifs.filter(annuel), `plan ${key} annuel (${produit})`, erreurs);
    if (!m || !y) continue;
    const champs: LigneSynchro['champs'] = {};
    champ(champs, 'stripe_product_id', row?.stripe_product_id, produit);
    champ(champs, 'stripe_price_id', row?.stripe_price_id, m.id);
    champ(champs, 'stripe_yearly_price_id', row?.stripe_yearly_price_id, y.id);
    champ(champs, 'price_cents', row?.price_cents, m.unit_amount);
    // La base stocke l'équivalent MENSUEL de l'offre annuelle (affiché « /mois »).
    champ(champs, 'yearly_price_cents', row?.yearly_price_cents, Math.round(y.unit_amount / 12));
    lignes.push({
      table: 'plans', key, existe: !!row,
      credits: row?.credits ?? STRIPE_PLANS[key].credits,
      champs,
      modifie: !row || Object.values(champs).some((c) => c.avant !== c.apres),
    });
  }

  for (const key of PACKS) {
    const row = (packs ?? []).find((r: any) => r.key === key) ?? null;
    const produit = row?.stripe_product_id || PRODUITS_STRIPE_PACKS[key];
    const actifs = await prixActifs(stripe, produit);
    const p = unSeul(actifs.filter(unique), `pack ${key} (${produit})`, erreurs);
    if (!p) continue;
    const champs: LigneSynchro['champs'] = {};
    champ(champs, 'stripe_product_id', row?.stripe_product_id, produit);
    champ(champs, 'stripe_price_id', row?.stripe_price_id, p.id);
    champ(champs, 'price_cents', row?.price_cents, p.unit_amount);
    lignes.push({
      table: 'credit_packs', key, existe: !!row,
      credits: row?.amount ?? CREDIT_PACKAGES[key].amount,
      champs,
      modifie: !row || Object.values(champs).some((c) => c.avant !== c.apres),
    });
  }

  return { lignes, erreurs };
}

/** Écrit le diff. Lève à la première erreur d'écriture. */
export async function appliquerSynchro(lignes: LigneSynchro[]): Promise<number> {
  let ecrites = 0;
  for (const l of lignes) {
    if (!l.modifie) continue;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const [nom, c] of Object.entries(l.champs)) patch[nom] = c.apres;

    let error: any;
    if (l.existe) {
      ({ error } = await supabaseAdmin.from(l.table).update(patch).eq('key', l.key));
    } else if (l.table === 'plans') {
      const c = STRIPE_PLANS[l.key as keyof typeof STRIPE_PLANS] as any;
      ({ error } = await supabaseAdmin.from('plans').insert({
        key: l.key, name: c.name, credits: c.credits, features: c.features,
        watermark: c.watermark, max_socials: c.maxSocials === Infinity ? 999 : c.maxSocials,
        popular: !!c.popular, active: true, sort_order: Object.keys(STRIPE_PLANS).indexOf(l.key),
        ...patch,
      }));
    } else {
      const c = CREDIT_PACKAGES[l.key as keyof typeof CREDIT_PACKAGES] as any;
      ({ error } = await supabaseAdmin.from('credit_packs').insert({
        key: l.key, name: c.name, amount: c.amount, popular: !!c.popular, active: true,
        sort_order: Object.keys(CREDIT_PACKAGES).indexOf(l.key),
        ...patch,
      }));
    }
    if (error) throw new Error(`${l.table}.${l.key} : ${error.message}`);
    ecrites++;
  }
  return ecrites;
}
