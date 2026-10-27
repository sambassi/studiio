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
 * AUCUN REMBOURSEMENT, PARCE QU'IL N'Y A RIEN A RENDRE
 * ─────────────────────────────────────────────────────────────────────────
 * Le debit est pris AU DERNIER MOMENT, juste avant l'appel au fournisseur (`atelier.ts`,
 * option `payer`), apres TOUS les controles qui peuvent encore refuser : plan, operation,
 * plafond du film, fournisseur eteint. Un refus survient donc avant le debit, et ne laisse
 * rien a rembourser.
 *
 * C'est aussi ce qui evite une SECONDE ecriture de solde. Rendre des credits voulait dire
 * relire le solde puis le reecrire depuis l'application : deux operations concurrentes
 * pouvaient s'ecraser et perdre une mise a jour. Le seul mouvement d'argent ici est le debit
 * atomique de PostgreSQL, qui fait `credits = credits - montant` dans sa transaction. Aucun
 * solde n'est jamais calcule en JavaScript.
 *
 * Reste le cas honnete : l'appel est parti et echoue (delai, resultat illisible). Il a ete
 * facture par le fournisseur, les credits restent pris, et la reponse le dit.
 */
import { randomUUID } from 'crypto';
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
