/**
 * CINEMA IA — LES CREDITS DE STUDIIO PAIENT LA GENERATION REELLE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI PASSER PAR LES CREDITS, ET PAS PAR UN COMPTEUR A PART
 * ─────────────────────────────────────────────────────────────────────────
 * Le plafond en dollars vit sur le FILM (`coutGenerationUsd`) : supprimer puis recreer un
 * film remettait son compteur a zero. Ce n'etait donc pas un budget, c'etait un garde-fou
 * local. Les credits, eux, vivent sur le COMPTE (`users.credits`, journal
 * `credit_transactions`) : ils survivent a la suppression d'un film, d'une scene, de tout.
 *
 * Et ils apportent, sans rien inventer, ce qu'un compteur maison aurait du reconstruire :
 *
 *   - RESERVATION ATOMIQUE. `debiter_credits_operation` (SQL, migration
 *     `2026-08-30-debit-operation.sql`) lit le solde, le decremente et journalise la
 *     transaction dans UNE transaction. Deux generations lancees en meme temps ne peuvent
 *     donc pas depasser le solde : la seconde est refusee, pas servie a credit.
 *   - PAS DE DOUBLE FACTURATION. La reference est unique par TENTATIVE
 *     (`cinema-generation:<uuid>`) et l'index unique `(user_id, reference_id)` rend tout
 *     rejeu sans effet : `dejaDebite` est rendu, aucun second debit n'a lieu.
 *   - UN PRIX ADMINISTRABLE. `ai.generate_background` (image) et `ai.image_to_video`
 *     (video) existent deja dans la grille de tarifs, modifiables depuis l'ecran admin,
 *     sans migration ni redeploiement.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ON NE DEPENSE JAMAIS A L'AVEUGLE
 * ─────────────────────────────────────────────────────────────────────────
 * Si le prix est illisible, ou si la fonction SQL de debit n'est pas appliquee sur ce
 * serveur, le budget est INCONNU : on refuse l'appel payant au lieu de l'engager en
 * esperant. Un refus est une information ; une depense non comptee n'en est pas une.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * REMBOURSEMENT : SEULEMENT SI RIEN N'EST PARTI
 * ─────────────────────────────────────────────────────────────────────────
 * Le debit precede l'appel — c'est la seule facon de ne pas depenser plus que le solde.
 * Si la generation est refusee AVANT que le fournisseur soit appele (plan inconnu, plafond
 * du film atteint, fournisseur eteint), rien n'a ete facture : on rend les credits. Des que
 * l'appel est parti, il est paye, meme s'il echoue : les credits restent pris, et c'est dit.
 * On rend TOUJOURS le montant reellement debite, relu au journal — jamais le tarif du
 * moment, que l'admin a pu changer entre-temps.
 */
import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/db/supabase';
import { debiterOperationAtomique, referenceOperation } from '@/lib/credits/atomique';
import { prixDe } from '@/lib/tarifs/serveur';
import type { CleTarif } from '@/lib/tarifs/catalogue';
import type { OperationGenerationIA } from '@/lib/cinema/generation/fournisseur';

/** Les clés de tarif DÉJÀ au catalogue — aucune nouvelle, aucune migration. */
export const CLE_TARIF_IMAGE: CleTarif = 'ai.generate_background';
export const CLE_TARIF_VIDEO: CleTarif = 'ai.image_to_video';

export const PREFIXE_REFERENCE = 'cinema-generation';

export function cleTarifGeneration(operation: OperationGenerationIA): CleTarif {
  return operation === 'video' ? CLE_TARIF_VIDEO : CLE_TARIF_IMAGE;
}

export interface Reservation {
  /** Crédits réellement pris. `0` = tarif administré à zéro : gratuit, aucun débit. */
  cout: number;
  /** Référence du débit, unique à cette tentative. */
  reference: string;
  /**
   * Rend les crédits — à appeler SEULEMENT si le fournisseur n'a jamais été appelé.
   * Idempotente : un second appel ne rend rien de plus.
   */
  rembourser: (raison: string) => Promise<boolean>;
}

export type MotifRefusCredits = 'solde_insuffisant' | 'budget_inconnu' | 'refuse';

export type IssueReservation =
  | { ok: true; reservation: Reservation }
  | { ok: false; motif: MotifRefusCredits; message: string; cout?: number };

const MESSAGE_BUDGET_INCONNU =
  'Le coût de cette génération ne peut pas être établi sur ce serveur : rien n’a été lancé ni débité.';

/** Une réservation qui ne prend rien (tarif à zéro) : rien à rendre. */
function gratuite(reference: string): Reservation {
  return { cout: 0, reference, rembourser: async () => false };
}

/**
 * Prend les crédits AVANT l'appel payant. Ne lève jamais : le refus est une valeur que la
 * route traduit (402 pour un solde insuffisant, 409 pour un budget inconnu).
 */
export async function reserverCredits(
  userId: string,
  operation: OperationGenerationIA,
  o: { prix?: (c: CleTarif) => Promise<number>; debiter?: typeof debiterOperationAtomique } = {},
): Promise<IssueReservation> {
  const lirePrix = o.prix ?? prixDe;
  const debiter = o.debiter ?? debiterOperationAtomique;
  const cle = cleTarifGeneration(operation);

  let cout: number;
  try {
    cout = await lirePrix(cle);
  } catch {
    return { ok: false, motif: 'budget_inconnu', message: MESSAGE_BUDGET_INCONNU };
  }
  // Un prix illisible n'est pas « gratuit » : c'est un budget inconnu.
  if (!Number.isFinite(cout) || cout < 0) {
    return { ok: false, motif: 'budget_inconnu', message: MESSAGE_BUDGET_INCONNU };
  }

  const reference = referenceOperation(PREFIXE_REFERENCE, randomUUID());
  if (!reference) return { ok: false, motif: 'budget_inconnu', message: MESSAGE_BUDGET_INCONNU };

  // Tarif administré à zéro : la génération est gratuite, rien à débiter.
  if (cout === 0) return { ok: true, reservation: gratuite(reference) };

  let issue: Awaited<ReturnType<typeof debiterOperationAtomique>>;
  try {
    issue = await debiter(userId, cout, 'render', reference, `Cinema IA — génération ${operation}`);
  } catch (e) {
    console.error('[Cinema/Credits] débit impossible :', e instanceof Error ? e.message : e);
    return { ok: false, motif: 'budget_inconnu', message: MESSAGE_BUDGET_INCONNU };
  }

  if (!issue.ok) {
    // Migration du débit atomique absente : on ne sait pas compter, donc on ne dépense pas.
    if (issue.motif === 'socle_absent') {
      return { ok: false, motif: 'budget_inconnu', message: MESSAGE_BUDGET_INCONNU };
    }
    if (issue.motif === 'solde_insuffisant') {
      return {
        ok: false, motif: 'solde_insuffisant', cout,
        message: `Crédits insuffisants : cette génération coûte ${cout} crédit${cout > 1 ? 's' : ''}, votre solde est de ${issue.solde}.`,
      };
    }
    return { ok: false, motif: 'refuse', cout, message: `Génération refusée (${issue.motif ?? 'raison inconnue'}) — rien n’a été débité.` };
  }

  return {
    ok: true,
    reservation: {
      cout,
      reference,
      rembourser: (raison: string) => rembourserUneFois(userId, reference, raison),
    },
  };
}

/** Référence du remboursement, dérivée du débit : c'est elle que l'index unique protège. */
export const referenceRemboursement = (reference: string) => `${reference}:remboursement`;

/**
 * Rend le montant RÉELLEMENT débité pour cette référence, UNE SEULE FOIS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * C'EST LA BASE QUI GARANTIT L'UNICITÉ, PAS UNE LECTURE PRÉALABLE
 * ─────────────────────────────────────────────────────────────────────────
 * `addCredits` n'écrit aucune `reference_id` : un remboursement ne laissait donc aucune
 * trace reconnaissable, et deux appels rendaient deux fois. On ÉCRIT ici la ligne de
 * remboursement avec sa propre référence (`<débit>:remboursement`), que l'index unique
 * partiel `credit_transactions_reference_unique (user_id, reference_id)` refuse en double.
 * Le second appel se heurte donc à la base, pas à une lecture qui peut arriver trop tard —
 * et deux requêtes simultanées ne peuvent pas rembourser deux fois.
 *
 * Le montant est RELU au journal, jamais pris au tarif du moment : l'admin a pu le changer
 * entre le débit et l'échec.
 */
export async function rembourserUneFois(userId: string, reference: string, raison: string): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from('credit_transactions')
      .select('id, amount, type')
      .eq('user_id', userId)
      .eq('reference_id', reference);
    if (error) {
      console.error(`[Cinema/Credits] journal illisible — remboursement différé (${reference}) :`, error.message);
      return false;
    }
    const lignes = (data ?? []) as Array<{ amount?: unknown; type?: unknown }>;
    if (lignes.length === 0) return false; // rien n'a été débité

    const montant = Math.abs(Number(lignes[0]?.amount));
    if (!Number.isFinite(montant) || montant === 0) return false;

    // 1. LA RÉSERVATION DU DROIT DE REMBOURSER — refusée en double par l'index unique.
    const { error: erreurTrace } = await supabaseAdmin
      .from('credit_transactions')
      .insert({
        user_id: userId,
        amount: montant,
        type: 'refund',
        reference_id: referenceRemboursement(reference),
        description: `Cinema IA — ${raison}`.slice(0, 200),
        created_at: new Date().toISOString(),
      });
    if (erreurTrace) {
      // 23505 : déjà remboursé. Ce n'est pas une panne, c'est la réponse à une course.
      const deja = String((erreurTrace as { code?: unknown }).code ?? '') === '23505'
        || /duplicate key|unique/i.test(erreurTrace.message ?? '');
      if (!deja) console.error(`[Cinema/Credits] trace de remboursement refusée (${reference}) :`, erreurTrace.message);
      return false;
    }

    // 2. LE SOLDE — la trace est posée, le crédit peut être rendu.
    await crediterSolde(userId, montant);
    console.warn(`[Cinema/Credits] ${montant} crédit(s) rendu(s) — ${raison} (${reference})`);
    return true;
  } catch (e) {
    // Jamais d'exception vers l'appelant : un remboursement manqué se dit, il n'emporte
    // pas la réponse de la route.
    console.error(`[Cinema/Credits] remboursement impossible (${reference}) :`, e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * Remonte le solde du compte. La ligne de journal est déjà écrite ci-dessus : on n'appelle
 * donc pas `addCredits`, qui en écrirait une SECONDE, sans référence — deux lignes pour un
 * seul remboursement rendraient le journal illisible.
 */
async function crediterSolde(userId: string, montant: number): Promise<void> {
  const { data } = await supabaseAdmin.from('users').select('credits').eq('id', userId).maybeSingle();
  const actuel = Number((data as { credits?: unknown } | null)?.credits);
  await supabaseAdmin
    .from('users')
    .update({ credits: (Number.isFinite(actuel) ? actuel : 0) + montant })
    .eq('id', userId);
}
