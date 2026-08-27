/**
 * Qui paie quoi, et comment. Decide cote SERVEUR, une seule fois.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DEUX POLITIQUES, ET UNE SEULE PORTE POUR LES DEPARTAGER
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   `credits`            -- l'utilisateur paie en credits Studiio, au tarif
 *                          serveur de `public.tarifs_rendu`.
 *   `partner_cost_only`  -- l'administrateur ne consomme aucun credit
 *                          commercial : seuls les frais reellement factures
 *                          par les partenaires externes le concernent.
 *
 * Les quatre parcours de rendu passent par ce module et par lui seul. Une
 * politique resolue a deux endroits finirait par diverger, et la divergence
 * se paierait en argent.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * FERME PAR DEFAUT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Seul `role === 'admin'` ouvre `partner_cost_only`. `user`, `NULL`, colonne
 * absente, casse inattendue, valeur inconnue : tout retombe sur `credits`.
 * Se tromper dans ce sens fait payer quelqu'un qui aurait pu ne pas payer ;
 * se tromper dans l'autre offre le service a qui le demande.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PAS D'ADRESSE EN DUR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `lib/admin.ts` autorise plus de vingt routes sur une liste d'e-mails
 * codee dans le bundle. Cette politique-ci ne s'en sert pas : elle lit le
 * ROLE, en base, a chaque decision. Le role vit dans la donnee, la liste
 * d'e-mails vivait dans le code — l'un se corrige sans redeploiement.
 */
import { supabaseAdmin } from '@/lib/db/supabase';

export type Politique = 'credits' | 'partner_cost_only';

/** La seule valeur de role qui ouvre la politique partenaires. */
export const ROLE_ADMIN = 'admin';

export const POLITIQUE_DEFAUT: Politique = 'credits';

/** Ce que l'ecran affiche a la place d'un solde, sous cette politique. */
export const LIBELLE_PARTENAIRES = 'Frais partenaires uniquement';

/**
 * Champs qu'un client n'a jamais le droit de proposer sur un chemin de
 * facturation. Enumeres pour que les tests les PARCOURENT : une reouverture
 * accidentelle fait alors tomber un test au lieu de passer inapercue.
 */
export const CHAMPS_INTERDITS_FACTURATION = [
  'role', 'isAdmin', 'admin', 'billingMode', 'politique', 'policy',
  'user_id', 'userId', 'email',
  'cost', 'cout', 'amount', 'credits', 'balance', 'solde',
] as const;

/**
 * Politique deduite d'un role.
 *
 * Comparaison stricte sur une chaine normalisee : ni `Admin`, ni ` admin `,
 * ni `administrateur` n'ouvrent la porte. Un role qu'on n'a pas prevu n'est
 * pas un role de confiance.
 */
export function politiquePourRole(role: unknown): Politique {
  if (typeof role !== 'string') return POLITIQUE_DEFAUT;
  return role.trim().toLowerCase() === ROLE_ADMIN ? 'partner_cost_only' : POLITIQUE_DEFAUT;
}

export interface ResolutionPolitique {
  politique: Politique;
  /** Role tel que la base le porte, pour le journal. Jamais recu du client. */
  role: string | null;
}

/**
 * Relit le role EN BASE et en deduit la politique.
 *
 * Volontairement une lecture, et pas la copie portee par la session : une
 * session vit des heures, un role peut etre retire entre-temps. La session
 * sert a AFFICHER, la base sert a DECIDER.
 *
 * Une base injoignable ou une colonne absente ne fait pas echouer l'appel :
 * elle rend `credits`. Refuser le service parce qu'on ne sait pas lire un
 * role serait pire que facturer quelqu'un qui n'aurait pas du l'etre — et
 * le second cas se rembourse.
 */
export async function politiqueDeLUtilisateur(userId: string): Promise<ResolutionPolitique> {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) return { politique: POLITIQUE_DEFAUT, role: null };

    const role = typeof data.role === 'string' ? data.role : null;
    return { politique: politiquePourRole(role), role };
  } catch {
    return { politique: POLITIQUE_DEFAUT, role: null };
  }
}

/** Cette politique consomme-t-elle des credits Studiio ? */
export function consommeDesCredits(politique: Politique): boolean {
  return politique === 'credits';
}

/**
 * Cout partenaire retenu, ou `null`.
 *
 * `null` veut dire INDISPONIBLE, et surtout pas zero. Un zero enregistre se
 * lirait plus tard comme « cette operation n'a rien coute », alors qu'elle
 * signifie « le partenaire ne nous a pas dit combien ». La facture du
 * partenaire reste la source de verite.
 */
export function coutPartenaireVerifiable(valeur: unknown): number | null {
  if (typeof valeur !== 'number') return null;
  if (!Number.isFinite(valeur) || valeur < 0) return null;
  return valeur;
}
