/**
 * PAIEMENT SIMULÉ — pour parcourir l'achat de bout en bout sans prestataire.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE N'EST PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ce n'est PAS un faux Stripe. Il ne fabrique aucun identifiant Stripe, ne
 * prétend à aucun moment qu'une carte a été débitée, et ses écritures portent
 * leur propre préfixe `demo:` — jamais `stripe:`, jamais `mm:`. Quiconque lit
 * l'historique des crédits voit immédiatement ce qui est un encaissement et
 * ce qui est une démonstration.
 *
 * La raison d'être est étroite : en prévisualisation, l'identifiant de prix
 * Stripe n'existe pas, donc le parcours s'arrête au premier clic. On ne peut
 * ni voir l'écran de confirmation, ni vérifier l'attribution des crédits.
 * Ce module rend ce parcours praticable, sans jamais faire croire à un
 * paiement.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * MORT EN PRODUCTION, PAR CONSTRUCTION
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Deux conditions, toutes deux nécessaires : `NODE_ENV !== 'production'` et
 * le mode démonstration. Une image de production est bâtie avec
 * `NODE_ENV=production` : rien ici ne peut s'y exécuter, quelle que soit la
 * requête, quel que soit l'en-tête. Aucun cookie, aucun paramètre d'URL
 * n'ouvre cette porte.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE FICHIER EST PUR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Il ne touche NI la base, NI le réseau : seulement des constantes et des
 * fonctions pures. C'est ce qui permet aux écrans — qui tournent dans le
 * navigateur — d'en importer les libellés. L'écriture, elle, vit dans
 * `demonstration-credit.ts`, côté serveur uniquement : l'y laisser ici
 * entraînerait le client de base de données jusque dans le navigateur, et
 * la page ne se construirait même pas.
 */
import { estModeDemonstration, type EnvDemo } from '@/lib/apercu/mode-demo';

/** Les issues qu'une démonstration doit savoir produire, pas seulement le succès. */
export type IssueDemo = 'reussi' | 'refuse' | 'annule' | 'en_attente';

export const ISSUES_DEMO: readonly IssueDemo[] = ['reussi', 'refuse', 'annule', 'en_attente'];

export const LIBELLE_ISSUE_DEMO: Record<IssueDemo, string> = {
  reussi: 'Paiement confirmé',
  refuse: 'Paiement refusé',
  annule: 'Paiement annulé',
  en_attente: 'Paiement en attente',
};

/** Seule l'issue « confirmé » crédite. C'est tout l'intérêt de pouvoir choisir. */
export function issueCredite(issue: IssueDemo): boolean {
  return issue === 'reussi';
}

/**
 * Le paiement simulé est-il ouvert ?
 *
 * ⚠️ Les deux conditions sont nécessaires. `estModeDemonstration` exige déjà
 * `NODE_ENV !== 'production'` ; c'est répété ici parce qu'une protection de
 * paiement ne doit pas dépendre de la lecture qu'on fait d'un autre module.
 */
export function paiementSimuleOuvert(env: EnvDemo = process.env): boolean {
  if (env.NODE_ENV === 'production') return false;
  return estModeDemonstration(env);
}

export const MESSAGE_SIMULATION_FERMEE =
  'Le paiement simulé n’existe que dans un environnement de démonstration.';

/** Préfixe réservé. Ni `stripe:`, ni `mm:` — on ne se déguise pas en encaissement. */
export const PREFIXE_DEMO = 'demo:';

