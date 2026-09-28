/**
 * Confirmation d'un dépôt PawaPay — logique PURE, dépendances injectées.
 *
 * Règle unique : on ne crédite QUE si la relecture chez PawaPay dit
 * `COMPLETED` avec un montant ET une devise strictement égaux à ce que Studiio
 * attendait.
 *
 * Trois déclencheurs partagent CE code : la route de statut (chemin normal,
 * par interrogation), le cron de rattrapage, et le callback facultatif. Aucun
 * ne transmet de statut : tous relisent le dépôt chez PawaPay.
 *
 * Anti double crédit : le crédit n'est appelé que si
 * `store.marquerCrediteSiNonCredite` renvoie `true` — ce qui n'arrive qu'une
 * fois par `depositId`, déclencheurs concurrents compris.
 */
import type {
  DependancesConfirmation,
  DepotAttendu,
  DepotDistant,
  DepotsStore,
  IssueConfirmation,
  VerdictDepot,
} from './types';

/**
 * Forme canonique d'un montant décimal, SANS flottant :
 * « 0123.500 » → « 123.5 », « 123.00 » → « 123 », « 0.0 » → « 0 ».
 * Renvoie `null` pour tout ce qui n'est pas une décimale positive simple
 * (signe, exposant, espaces internes, séparateur virgule…).
 */
export function normaliserMontant(valeur: unknown): string | null {
  let s: string;
  if (typeof valeur === 'string') s = valeur.trim();
  else if (typeof valeur === 'number' && Number.isSafeInteger(valeur) && valeur >= 0) s = String(valeur);
  else return null;
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const entier = m[1].replace(/^0+(?=\d)/, '');
  const fraction = (m[2] ?? '').replace(/0+$/, '');
  return fraction ? `${entier}.${fraction}` : entier;
}

/** Verdict pur : que faire de ce dépôt ? */
export function evaluerDepot(
  attendu: Pick<DepotAttendu, 'montant' | 'devise'>,
  distant: DepotDistant,
): VerdictDepot {
  if (!distant.trouve) return 'introuvable';
  if (distant.statut === 'FAILED') return 'echec';
  if (distant.statut !== 'COMPLETED') return 'en_attente';
  if (!attendu.devise || distant.devise !== attendu.devise) return 'devise_invalide';
  const a = normaliserMontant(attendu.montant);
  const d = normaliserMontant(distant.montant);
  if (a === null || d === null || a !== d) return 'montant_invalide';
  return 'crediter';
}

export function referenceCredit(depositId: string): string {
  return `pawapay:${depositId}`;
}

export interface ResultatConfirmation {
  issue: IssueConfirmation;
  depositId: string;
}

/**
 * Relit le dépôt chez PawaPay et agit.
 *
 * Toute exception (relecture, store, crédit) REMONTE : l'appelant répond 5xx
 * et PawaPay rejoue. Rien n'est avalé.
 */
export async function confirmerDepot(
  depositId: string,
  deps: DependancesConfirmation,
): Promise<ResultatConfirmation> {
  const local = await deps.store.lire(depositId);
  if (!local) return { issue: 'inconnu_local', depositId };
  if (local.statut === 'credite') return { issue: 'deja_credite', depositId };

  const distant = await deps.lireDepotDistant(depositId);
  const verdict = evaluerDepot(local, distant);

  switch (verdict) {
    case 'crediter': {
      const pris = await deps.store.marquerCrediteSiNonCredite(depositId);
      if (!pris) return { issue: 'deja_credite', depositId };
      try {
        await deps.crediter(local.userId, local.credits, referenceCredit(depositId));
      } catch (e) {
        // Le verrou est rendu pour qu'un rejeu puisse créditer ; `crediter`
        // est idempotent sur la référence, donc un crédit partiel ne se
        // doublera pas.
        await deps.store.relacherCredit(depositId);
        throw e;
      }
      return { issue: 'credite', depositId };
    }
    case 'echec':
      await deps.store.marquerEchec(depositId);
      return { issue: 'echec', depositId };
    default:
      // en_attente, introuvable, montant_invalide, devise_invalide : aucun
      // crédit, aucun changement d'état. Un montant ou une devise qui ne
      // correspond pas est laissé tel quel pour examen manuel.
      return { issue: verdict, depositId };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Store en mémoire — POUR LES TESTS UNIQUEMENT
// ─────────────────────────────────────────────────────────────────────────

/**
 * Store en mémoire. La vérification et la pose du drapeau se font sans
 * `await` intermédiaire : sur la boucle d'événements JS, c'est atomique.
 *
 * TODO(migration pawapay_deposits) : l'implémentation Postgres viendra avec
 * la migration (table `pawapay_deposits` + RPC atomique qui pose `credite` ET
 * inscrit la transaction de crédit dans une seule transaction SQL). Elle
 * n'existe pas encore : `obtenirStore()` renvoie `null` d'ici là.
 */
export function creerStoreMemoire(initial: DepotAttendu[] = []): DepotsStore & {
  etat(depositId: string): DepotAttendu | undefined;
} {
  const lignes = new Map<string, DepotAttendu>(initial.map((d) => [d.depositId, { ...d }]));
  return {
    async enregistrer(d) {
      if (lignes.has(d.depositId)) throw new Error(`depositId déjà enregistré : ${d.depositId}`);
      lignes.set(d.depositId, { ...d });
    },
    async lire(id) {
      const l = lignes.get(id);
      return l ? { ...l } : null;
    },
    async listerEnAttente({ avant, limite }) {
      return [...lignes.values()]
        .filter((l) => l.statut === 'en_attente' && l.creeLe <= avant)
        .sort((a, b) => a.creeLe.localeCompare(b.creeLe))
        .slice(0, Math.max(0, limite))
        .map((l) => ({ ...l }));
    },
    async marquerCrediteSiNonCredite(id) {
      const l = lignes.get(id);
      if (!l || l.statut === 'credite') return false;
      l.statut = 'credite';
      return true;
    },
    async relacherCredit(id) {
      const l = lignes.get(id);
      if (l && l.statut === 'credite') l.statut = 'en_attente';
    },
    async marquerEchec(id) {
      const l = lignes.get(id);
      if (l && l.statut !== 'credite') l.statut = 'echec';
    },
    etat(id) {
      const l = lignes.get(id);
      return l ? { ...l } : undefined;
    },
  };
}
