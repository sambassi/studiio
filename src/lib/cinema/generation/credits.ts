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
 * LE DEBIT, AU DERNIER MOMENT — ET LE REMBOURSEMENT, QUAND L'APPEL ECHOUE
 * ─────────────────────────────────────────────────────────────────────────
 * Le debit est pris AU DERNIER MOMENT, juste avant l'appel au fournisseur (`atelier.ts`,
 * option `payer`), apres TOUS les controles qui peuvent encore refuser : plan, operation,
 * plafond du film, fournisseur eteint. Un refus survient donc avant le debit, et ne laisse
 * rien a rembourser — c'est le cas le plus frequent, et il reste inchange.
 *
 * ⚠️ MAIS UN PAIEMENT REUSSI N'EST PAS UNE GARANTIE DE RESULTAT. L'appel au fournisseur peut
 * encore echouer APRES avoir ete facture par Studiio (delai depasse, prompt ou image refuses
 * par le fournisseur, reponse illisible) : le compte a paye, et n'a rien recu. Observe en
 * production : une erreur de forme sur l'appel Replicate faisait perdre des credits a chaque
 * tentative, sans aucun recours. `rembourserCredits` corrige cela — appelee par la route des
 * qu'un debit reussi est suivi d'un echec de generation.
 *
 * Le remboursement garde la MEME discipline que le debit, jamais une ecriture a main levee :
 *
 *   - ATOMIQUE. `rembourser_credits_operation` (SQL, migration
 *     `2026-10-30-remboursement-credits-operation.sql`) fait `credits = credits + montant`
 *     et journalise, dans UNE transaction — jamais un solde relu puis reecrit en JavaScript.
 *   - IDEMPOTENT, SANS DOUBLE REMBOURSEMENT. La reference du remboursement derive de celle du
 *     debit (`referenceRemboursement`, jamais la meme chaine) : un second appel avec la meme
 *     reference ne credite pas une seconde fois, l'index unique `(user_id, reference_id)` le
 *     garantit exactement comme pour le debit.
 *   - BUDGET INCONNU = PAS DE PROMESSE EN L'AIR. Si la migration n'est pas appliquee sur ce
 *     serveur, le remboursement est NON prouve : l'appelant le dit (`rembourse: false`),
 *     jamais un succes qui n'a pas eu lieu.
 */
import { randomUUID } from 'crypto';
import {
  debiterOperationAtomique, referenceOperation,
  rembourserOperationAtomique, referenceRemboursement,
} from '@/lib/credits/atomique';
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
}

export type MotifRefusCredits = 'solde_insuffisant' | 'budget_inconnu' | 'refuse';

export type IssueReservation =
  | { ok: true; reservation: Reservation }
  | { ok: false; motif: MotifRefusCredits; message: string; cout?: number };

const MESSAGE_BUDGET_INCONNU =
  'Le coût de cette génération ne peut pas être établi sur ce serveur : rien n’a été lancé ni débité.';

/** Une réservation qui ne prend rien (tarif administré à zéro). */
function gratuite(reference: string): Reservation {
  return { cout: 0, reference };
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

  return { ok: true, reservation: { cout, reference } };
}

export interface IssueRemboursement {
  ok: boolean;
  /** Absent si `ok` : sinon, pourquoi le remboursement n'a pas pu être PROUVÉ. */
  motif?: 'budget_inconnu' | 'refuse' | 'erreur';
}

/**
 * Rend les crédits d'une réservation dont la génération a ÉCHOUÉ APRÈS paiement.
 *
 * Ne lève jamais : un remboursement qui échoue est grave (le compte a payé pour rien), mais
 * ce n'est jamais une raison de faire échouer la réponse HTTP qui annonce l'échec de
 * génération — la route journalise et le dit, elle ne bloque pas dessus.
 *
 * Gratuit (`reservation.cout === 0`, tarif administré à zéro) : rien n'a été débité, rien à
 * rembourser — rendu `ok: true` sans appeler la base.
 */
export async function rembourserCredits(
  userId: string,
  reservation: Reservation,
  operation: OperationGenerationIA,
  o: { rembourser?: typeof rembourserOperationAtomique } = {},
): Promise<IssueRemboursement> {
  if (reservation.cout <= 0) return { ok: true };
  const rembourser = o.rembourser ?? rembourserOperationAtomique;
  const reference = referenceRemboursement(reservation.reference);

  let issue: Awaited<ReturnType<typeof rembourserOperationAtomique>>;
  try {
    issue = await rembourser(
      userId, reservation.cout, reference,
      `Cinema IA — remboursement génération ${operation} (échec après paiement)`,
    );
  } catch (e) {
    console.error('[Cinema/Credits] remboursement impossible :', e instanceof Error ? e.message : e);
    return { ok: false, motif: 'erreur' };
  }

  if (!issue.ok) {
    // Migration absente : on ne peut pas PROUVER le remboursement, donc on ne prétend pas
    // qu'il a eu lieu. Le motif distingue ce cas (`budget_inconnu`) d'un refus franc.
    const motif = issue.motif === 'socle_absent' ? 'budget_inconnu' : 'refuse';
    console.error(
      `[Cinema/Credits] remboursement refusé (${issue.motif ?? 'motif inconnu'}) — `
      + `compte ${userId}, référence ${reference}, ${reservation.cout} crédit(s) non rendus.`,
    );
    return { ok: false, motif };
  }

  return { ok: true };
}
