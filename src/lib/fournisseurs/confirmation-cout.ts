/**
 * CONFIRMATION DU COÛT FOURNISSEUR — côté serveur, la garde qui rend
 * IMPOSSIBLE un appel payant déclenché à la main par l'admin sans qu'il ait
 * vu le devis.
 *
 * Contrat : une route qui va payer un fournisseur, appelée par un compte
 * admin (exempté de crédits) SANS `confirmationCoutFournisseur`, répond 428
 * `{ code: 'confirmation_cout_fournisseur', devis }` AVANT toute écriture,
 * tout débit et tout appel. Le navigateur montre le devis, puis rejoue la
 * MÊME requête avec la confirmation (ou rien : annuler = 0 appel).
 *
 * Les crons (Autopilote, reprise après solde) ne passent jamais par ici :
 * leur coût est montré à l'activation (budget), pas à chaque vidéo. Un
 * utilisateur non admin n'est pas concerné : il voit déjà le prix en crédits.
 */
import { NextResponse } from 'next/server';
import { CODE_CONFIRMATION_COUT, CHAMP_CONFIRMATION_COUT, type DevisFournisseur } from '@/lib/fournisseurs/devis-fournisseur';

export { CODE_CONFIRMATION_COUT, CHAMP_CONFIRMATION_COUT };


/** Corps JSON (`true`) ou formulaire (`'1'` / `'true'`). */
export function confirmationCoutLue(valeur: unknown): boolean {
  return valeur === true || valeur === '1' || valeur === 'true';
}

/** La réponse 428 : le devis, rien d'écrit, rien d'appelé. */
export function reponseConfirmationCout(devis: DevisFournisseur, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json(
    {
      success: false,
      code: CODE_CONFIRMATION_COUT,
      error: 'Coût fournisseur à confirmer avant de lancer cette opération.',
      devis,
      ...(extra ?? {}),
    },
    { status: 428, headers: { 'Cache-Control': 'private, no-store' } },
  );
}

/** La garde : `null` = l'appel peut partir ; sinon la réponse 428 à renvoyer telle quelle. */
export function exigerConfirmationCout(args: {
  admin: boolean;
  confirme: boolean;
  devis: DevisFournisseur;
  extra?: Record<string, unknown>;
}): NextResponse | null {
  if (!args.admin || args.confirme) return null;
  return reponseConfirmationCout(args.devis, args.extra);
}
