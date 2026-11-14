/**
 * MODE DÉMONSTRATION — dire quand les données affichées ne sont pas réelles.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE MODULE EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un écran d'administration qui annonce « 18 450 € de revenus » sans préciser
 * que le chiffre est inventé est pire qu'un écran vide : il se lit comme une
 * mesure. Deux cas différents doivent être nommés, et ils ne se confondent
 * pas :
 *
 *   1. des données d'EXEMPLE écrites en dur dans l'écran — elles sont
 *      fictives partout, y compris en production. Elles doivent porter leur
 *      étiquette en permanence, indépendamment de ce module
 *      (cf. `MENTION_EXEMPLES`) ;
 *   2. une BASE DE PRÉVISUALISATION — les données viennent bien de la base,
 *      mais cette base est un double local. C'est ce que détecte
 *      `estModeDemonstration`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * FERMÉ EN PRODUCTION, PAR CONSTRUCTION
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `NODE_ENV !== 'production'` est exigé : une image de production est bâtie
 * avec `NODE_ENV=production`, le mode y est donc mort quoi qu'il arrive. Rien
 * ici ne lit un cookie, un en-tête ni un paramètre d'URL : aucune requête ne
 * peut l'activer.
 *
 * Fonction PURE.
 */
export interface EnvDemo {
  NODE_ENV?: string;
  DEV_AUTH_BYPASS?: string;
  STUDIIO_DEMO?: string;
}

/**
 * Vrai quand les données affichées viennent d'une base de prévisualisation.
 *
 * `DEV_AUTH_BYPASS` suffit : il n'est posé que sur une machine de
 * développement, et il implique déjà une identité factice — donc des données
 * qui ne décrivent personne. `STUDIIO_DEMO` permet de l'annoncer sans le
 * contournement d'authentification.
 */
export function estModeDemonstration(env: EnvDemo = process.env): boolean {
  if (env.NODE_ENV === 'production') return false;
  return env.DEV_AUTH_BYPASS === '1' || env.STUDIIO_DEMO === '1';
}

/** Ce que lit l'utilisateur quand la base est un double de prévisualisation. */
export const MENTION_DEMO = 'Mode démonstration — données fictives';

export const DETAIL_DEMO =
  'Cet écran lit une base de prévisualisation locale. Les comptes, soldes, '
  + 'transactions et abonnements qui s’y trouvent sont des exemples : ils ne '
  + 'décrivent aucun client réel, aucun encaissement réel, et rien n’est '
  + 'envoyé à un prestataire de paiement.';

/**
 * Ce que lit l'utilisateur devant des données d'exemple ÉCRITES EN DUR. Cette
 * mention ne dépend d'aucun réglage : elle est vraie en production aussi.
 */
export const MENTION_EXEMPLES = 'Données d’exemple — non mesurées';

export const DETAIL_EXEMPLES =
  'Ces chiffres sont des exemples inscrits dans l’écran, pas une mesure. '
  + 'Ils ne proviennent ni de la base, ni du prestataire de paiement, et ne '
  + 'doivent pas être lus comme un revenu.';
