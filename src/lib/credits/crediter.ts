/**
 * Crédit Stripe atomique et idempotent — la façade TypeScript de
 * `crediter_credits_stripe` (migration `2026-09-29-stripe-events.sql`, #471).
 *
 * La fonction SQL fait tout en une transaction : contrôle de la référence
 * (`stripe:…`), du montant (1..100 000), du type ; incrément relatif du
 * solde sous verrou de ligne ; journal dans `credit_transactions` sous
 * l'index unique `(user_id, reference_id)`. Un rejeu, séquentiel ou
 * concurrent, rend `deja_credite = true` sans toucher au solde.
 *
 * Mode `ajouter`, jamais `fixer` : `fixer` remettrait le solde au quota du
 * plan à chaque renouvellement et effacerait les packs payés comptant.
 *
 * Si la fonction n'existe pas (migration non appliquée), l'appel LÈVE : le
 * webhook répond 500, Stripe rejoue, rien n'est crédité sans garde.
 */
import { supabaseAdmin } from '@/lib/db/supabase';

export type TypeCreditStripe = 'purchase' | 'subscription' | 'bonus' | 'refund';

export interface ResultatCredit {
  /** Vrai si cette référence avait déjà été créditée : rien n'a bougé. */
  dejaCredite: boolean;
  /** Solde après l'opération. */
  solde: number;
}

/** Plafond imposé par la base (Enterprise annuel = 30 000). */
export const CREDIT_MAX = 100_000;

export class ErreurCredit extends Error {
  constructor(message: string, readonly motif?: string) {
    super(message);
    this.name = 'ErreurCredit';
  }
}

export async function crediterIdempotent(params: {
  userId: string;
  montant: number;
  type: TypeCreditStripe;
  reference: string;
  description?: string;
}): Promise<ResultatCredit> {
  const { userId, montant, type, reference, description } = params;

  // Contrôles redondants avec la base, pour un message lisible sans aller-retour.
  if (!userId) throw new ErreurCredit('utilisateur absent', 'utilisateur_inconnu');
  if (!reference?.startsWith('stripe:')) throw new ErreurCredit(`reference invalide : ${reference}`, 'reference_invalide');
  if (!Number.isInteger(montant) || montant <= 0 || montant > CREDIT_MAX) {
    throw new ErreurCredit(`montant invalide : ${montant}`, 'montant_invalide');
  }

  const { data, error } = await supabaseAdmin.rpc('crediter_credits_stripe', {
    p_user_id: userId,
    p_montant: montant,
    p_type: type,
    p_reference: reference,
    p_description: description ?? null,
    p_mode: 'ajouter',
  });
  if (error) {
    throw new ErreurCredit(`crediter_credits_stripe indisponible : ${error.message || error.code || 'erreur'}`);
  }

  // PostgREST rend une fonction `returns table` sous forme de tableau.
  const ligne = (Array.isArray(data) ? data[0] : data) as {
    ok: boolean; solde: number; deja_credite: boolean; motif: string | null;
  } | undefined;
  if (!ligne) throw new ErreurCredit('crediter_credits_stripe sans reponse');
  if (!ligne.ok) {
    throw new ErreurCredit(`credit refuse : ${ligne.motif ?? 'inconnu'} (${reference})`, ligne.motif ?? undefined);
  }
  return { dejaCredite: !!ligne.deja_credite, solde: Number(ligne.solde ?? 0) };
}
