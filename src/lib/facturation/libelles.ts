/**
 * Ce que les ecrans ecrivent a la place du prix.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE MODULE EXISTE, SEPARE DE `politique.ts`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `politique.ts` DECIDE, et pour decider il lit la base : il importe
 * `supabaseAdmin`. Un composant client qui importerait le libelle depuis ce
 * module tirerait le client serveur dans le bundle du navigateur.
 *
 * Ici, il n'y a que du vocabulaire : aucune dependance, aucune decision. Le
 * type `Politique` est importe en `import type`, donc efface a la
 * compilation — le lien reste purement documentaire.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE MODULE N'EST PAS UNE SOURCE DE VERITE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Il met en mots une politique DEJA decidee par le serveur. Il ne la devine
 * pas : `politiqueAffichable` normalise ce que le serveur a renvoye, et tout
 * ce qui n'est pas exactement `partner_cost_only` retombe sur `credits`.
 *
 * Se tromper vers `credits` annonce un prix a quelqu'un qui ne paiera pas —
 * un texte inutile. Se tromper vers `partner_cost_only` promettrait la
 * gratuite a quelqu'un qui sera debite. Les deux erreurs ne se valent pas.
 */
import type { Politique } from './politique';

/** Le libelle unique, affiche partout ou un solde en credits n'a pas de sens. */
export const LIBELLE_PARTENAIRES = 'Frais partenaires uniquement';

/**
 * La promesse explicite qui accompagne le libelle a l'etape Envoi.
 *
 * Le libelle seul dit ce qui est facture ; il ne dit pas ce qui ne l'est
 * PAS. C'est pourtant la question que se pose quelqu'un devant un bouton
 * « Composer et envoyer ».
 */
export const MENTION_AUCUN_CREDIT = 'Aucun crédit Studiio ne sera débité.';

/**
 * Normalise la politique renvoyee par le serveur.
 *
 * Rien d'autre que la chaine exacte `partner_cost_only` n'ouvre la gratuite :
 * ni un booleen du navigateur, ni un role, ni une adresse. Un role absent,
 * `null`, inconnu, ou une reponse illisible retombent sur `credits`.
 */
export function politiqueAffichable(valeur: unknown): Politique {
  return valeur === 'partner_cost_only' ? 'partner_cost_only' : 'credits';
}

/**
 * Le cout, en mots, tel qu'il doit apparaitre a l'ecran.
 *
 * Sous `partner_cost_only`, AUCUN nombre n'est rendu. Le cout partenaire
 * reel vit dans `rendus.cout_partenaire`, il est nullable, et `NULL` y
 * signifie INDISPONIBLE — pas zero. Afficher un chiffre ici reviendrait a
 * l'inventer.
 */
export function libelleCout(politique: Politique, coutEnCredits: number): string {
  return politique === 'partner_cost_only'
    ? LIBELLE_PARTENAIRES
    : `${coutEnCredits} crédits`;
}
