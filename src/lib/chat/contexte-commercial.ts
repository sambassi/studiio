/**
 * CE QUE L'ASSISTANT SAIT DU PORTEFEUILLE DE L'UTILISATEUR.
 *
 * L'assistant ne doit JAMAIS annoncer un prix de mémoire : il reçoit, à
 * chaque message, la grille RÉELLEMENT en vigueur (`lib/tarifs/serveur`), le
 * plan et le solde du compte, lus côté serveur. Quatre règles tenues ici :
 *
 *  1. PRIX LUS, JAMAIS DEVINÉS. Le bloc liste les tarifs applicables ; la
 *     consigne interdit d'en inventer un ou d'en citer un autre.
 *  2. AUCUN FOURNISSEUR. Le bloc ne contient que des libellés Studiio. Ni
 *     coût fournisseur, ni marge, ni nom de prestataire : l'assistant ne peut
 *     pas divulguer ce qu'il n'a pas.
 *  3. AUCUN SECRET. Ni clé, ni identifiant de paiement, ni référence Stripe.
 *  4. RIEN N'EST DÉCLENCHÉ. L'assistant annonce et oriente ; le débit reste
 *     le fait des routes, après confirmation explicite dans l'écran.
 *
 * `blocContexteCommercial` est PURE — elle se teste sans base.
 */
import type { CleTarif, GrilleTarifs } from '@/lib/tarifs/catalogue';
import { CATALOGUE_TARIFS } from '@/lib/tarifs/catalogue';

export interface ContexteCommercial {
  /** Plan du compte, tel que l'utilisateur le voit. `null` = inconnu. */
  plan: string | null;
  /** Solde en crédits. `null` = illisible (on ne devine pas un solde). */
  solde: number | null;
  /** Compte exempté (administration) : 0 crédit débité. */
  exempte: boolean;
  /** Les tarifs en vigueur, libellés Studiio uniquement. */
  prix: ReadonlyArray<{ libelle: string; credits: number; unite: string }>;
}

export const LIEN_ABONNEMENT = '/dashboard/settings?tab=abonnement';
export const LIEN_RECHARGE = '/dashboard/billing';

/** Les tarifs que l'assistant a le droit de citer, dans l'ordre du catalogue. */
export function prixCitables(grille: GrilleTarifs): ContexteCommercial['prix'] {
  return CATALOGUE_TARIFS.map((e) => ({
    libelle: e.libelle,
    credits: grille[e.cle as CleTarif] ?? e.defaut,
    unite: e.unite,
  }));
}

/**
 * Le bloc injecté dans le prompt système. Volontairement sec et factuel :
 * tout ce qui n’y figure pas, l'assistant ne doit pas l'affirmer.
 */
export function blocContexteCommercial(c: ContexteCommercial): string {
  const lignes = c.prix.map((p) => `- ${p.libelle} : ${p.credits} (${p.unite})`).join('\n');
  const solde = c.exempte
    ? 'Compte de l’administration : aucune opération ne débite de crédits. Ne propose jamais de recharge à ce compte.'
    : c.solde === null
      ? 'Solde indisponible pour le moment : ne cite aucun chiffre de solde, invite à ouvrir la page Abonnement.'
      : `Solde actuel : ${c.solde} crédits.`;

  return `
=== PORTEFEUILLE DE CET UTILISATEUR (lu sur le serveur, à l’instant) ===
Plan : ${c.plan ?? 'inconnu'}
${solde}

TARIFS EN VIGUEUR POUR CE COMPTE (en crédits) :
${lignes}

RÈGLES DE PRIX — sans exception :
- N’annonce que les tarifs de la liste ci-dessus. Si une opération n’y figure pas, dis que son prix s’affiche dans l’écran concerné avant validation, et n’avance aucun chiffre.
- Pour un projet à plusieurs opérations, additionne CES tarifs et donne le total, puis compare-le au solde ci-dessus.
- S’il manque des crédits, dis exactement combien il en manque et oriente vers ${LIEN_RECHARGE} (recharge) ou ${LIEN_ABONNEMENT} (abonnement).
- Sont GRATUITS : naviguer, ouvrir un panneau, importer un média, modifier un texte ou un réglage à la main, consulter un devis, et la pré-écoute d’une voix (≈ 5 s). Ne facture jamais ces gestes dans une estimation.
- Ne lance jamais une opération payante toi-même et n’affirme jamais qu’elle est lancée : indique le bouton à cliquer, le prix sera reconfirmé par l'écran.
- Si l’utilisateur vient de recharger, invite-le à rouvrir la page pour que son solde soit relu ; ne suppose pas le nouveau solde.
`.trim();
}
