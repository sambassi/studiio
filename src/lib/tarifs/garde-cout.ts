/**
 * GARDE : pas de nouvelle opération payante dont le prix ne peut être validé.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'ELLE PROTÈGE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Une opération payante dont le coût fournisseur est inconnu se vend à
 * l'aveugle : on ne peut ni dire si elle est rentable, ni calculer son
 * plancher. Aujourd'hui les dix-huit tarifs du catalogue ont un coût relevé
 * sur une grille publique — la garde ne bloque donc RIEN. Son objet est le
 * cas suivant : un tarif ajouté demain sans son coût.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'ELLE NE BLOQUE JAMAIS
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   - une opération à 0 crédit (gratuite, ou offerte par la grille) ;
 *   - un geste manuel : déplacer un texte, régler une couleur, importer un
 *     média, consulter un devis. Rien de tout cela ne passe par un tarif.
 *   - un compte exempté : il ne paie pas, et ce n'est pas le sujet.
 *
 * Fonction PURE.
 */
import type { CleTarif } from './catalogue';
import { coutVerifie } from './rentabilite';

/**
 * Actif par défaut. Ce n'est PAS un changement de comportement : tous les
 * tarifs actuels ont un coût connu, donc aucun n'est refusé (c'est tenu par
 * un test). Le laisser à `false` rouvrirait la vente à l'aveugle.
 */
export const BLOCAGE_COUT_INCONNU_DEFAUT = true;

export type RefusCout = 'cout_inconnu';

export const MESSAGE_REFUS_COUT =
  'Cette opération est momentanément indisponible : son prix n’a pas pu être validé. Aucun crédit n’a été débité.';

export interface Verdict {
  autorisee: boolean;
  motif: RefusCout | null;
  /** Message destiné à l'utilisateur. Ne nomme aucun fournisseur. */
  message: string | null;
  /** Détail pour les journaux serveur et l'administration. */
  detail: string | null;
}

const PASSE: Verdict = { autorisee: true, motif: null, message: null, detail: null };

export function operationAutorisee(args: {
  cle: CleTarif;
  /** Crédits qui seraient débités. 0 = rien à valider. */
  credits: number;
  /** `false` désactive la garde (comportement d'avant). */
  blocage?: boolean;
}): Verdict {
  if (!(args.credits > 0)) return PASSE;
  if (args.blocage === false) return PASSE;
  const { usd } = coutVerifie(args.cle);
  if (usd !== null) return PASSE;
  return {
    autorisee: false,
    motif: 'cout_inconnu',
    message: MESSAGE_REFUS_COUT,
    detail: `Tarif « ${args.cle} » facturé ${args.credits} crédits sans coût fournisseur vérifié : opération refusée avant tout appel et tout débit.`,
  };
}
