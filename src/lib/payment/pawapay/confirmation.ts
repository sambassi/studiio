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
 * Anti double crédit ET anti « crédité sans crédit » : le crédit passe par UN
 * SEUL appel atomique du store, `crediterSiNonCredite`, qui marque le dépôt
 * et écrit la transaction dans la même transaction SQL (référence UNIQUE
 * `pawapay:<depositId>`). Il n'y a plus de verrou posé avant un crédit
 * séparé, donc plus de fenêtre où un processus qui meurt laisserait un dépôt
 * « crédité » sans aucun crédit.
 */
import type {
  DependancesConfirmation,
  DemandeCredit,
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
 * Relit le dépôt chez PawaPay, note la vérification, puis agit.
 *
 * Toute exception (relecture, store, crédit) REMONTE : l'appelant répond 5xx
 * et le prochain passage réessaiera. Rien n'est avalé.
 */
export async function confirmerDepot(
  depositId: string,
  deps: DependancesConfirmation,
): Promise<ResultatConfirmation> {
  const local = await deps.store.lire(depositId);
  if (!local) return { issue: 'inconnu_local', depositId };
  if (local.statut === 'credite') return { issue: 'deja_credite', depositId };

  // `verifieLe` est noté après CHAQUE tentative, réussie ou non : un dépôt
  // dont la relecture échoue en permanence passe lui aussi en fin de file du
  // rattrapage. Cette écriture est secondaire : son échec est journalisé mais
  // ne bloque jamais le crédit, ni ne masque l'erreur de relecture.
  const noterSansBloquer = async () => {
    const quand = (deps.maintenant ?? (() => new Date()))().toISOString();
    try {
      await deps.store.noterVerification(depositId, quand);
    } catch (e) {
      console.error(`[PAWAPAY] verifieLe non noté pour ${depositId} :`, (e as Error)?.message);
    }
  };

  let distant: DepotDistant;
  try {
    distant = await deps.lireDepotDistant(depositId);
  } catch (e) {
    await noterSansBloquer();
    throw e;
  }
  await noterSansBloquer();

  const verdict = evaluerDepot(local, distant);
  switch (verdict) {
    case 'crediter': {
      const r = await deps.store.crediterSiNonCredite({
        depositId,
        userId: local.userId,
        credits: local.credits,
        referenceId: referenceCredit(depositId),
      });
      return { issue: r === 'credite' ? 'credite' : 'deja_credite', depositId };
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

export interface TransactionMemoire {
  referenceId: string;
  userId: string;
  credits: number;
}

export interface OptionsStoreMemoire {
  /** Simule une panne de la base au moment du crédit (rien n'est écrit). */
  echouerCredit?: () => boolean;
}

/**
 * Store en mémoire, atomique comme le sera la RPC : dans
 * `crediterSiNonCredite`, la vérification, le marquage et l'écriture de la
 * transaction se font sans `await` intermédiaire (atomique sur la boucle
 * d'événements JS), et une panne lève AVANT toute écriture.
 *
 * TODO(migration pawapay_deposits) : l'implémentation Postgres viendra avec
 * la migration — table `pawapay_deposits` (dont `verifie_le`, index sur
 * `(statut, verifie_le)`) et RPC `crediter_depot_pawapay(deposit_id,
 * user_id, credits, reference_id)` qui, dans UNE transaction :
 *   1. `UPDATE pawapay_deposits SET statut = 'credite' WHERE deposit_id = $1
 *       AND statut <> 'credite' RETURNING …` — aucune ligne → 'deja_credite' ;
 *   2. incrémente `users.credits` et insère dans `credit_transactions` avec
 *      `reference_id` (contrainte UNIQUE `credit_transactions_reference_unique`,
 *      déjà en place) ;
 *   3. renvoie 'credite'. Toute erreur annule les deux écritures.
 */
export function creerStoreMemoire(
  initial: DepotAttendu[] = [],
  options: OptionsStoreMemoire = {},
): DepotsStore & {
  etat(depositId: string): DepotAttendu | undefined;
  transactions(): TransactionMemoire[];
} {
  const lignes = new Map<string, DepotAttendu>(initial.map((d) => [d.depositId, { ...d }]));
  const transactions = new Map<string, TransactionMemoire>();
  return {
    async enregistrer(d) {
      if (lignes.has(d.depositId)) throw new Error(`depositId déjà enregistré : ${d.depositId}`);
      lignes.set(d.depositId, { ...d });
    },
    async lire(id) {
      const l = lignes.get(id);
      return l ? { ...l } : null;
    },
    async listerEnAttente({ creeAvant, creeApres, limite }) {
      return [...lignes.values()]
        .filter((l) => l.statut === 'en_attente' && l.creeLe <= creeAvant
          && (creeApres === undefined || l.creeLe >= creeApres))
        .sort((a, b) => {
          const va = a.verifieLe ?? '';
          const vb = b.verifieLe ?? '';
          return va !== vb ? va.localeCompare(vb) : a.creeLe.localeCompare(b.creeLe);
        })
        .slice(0, Math.max(0, limite))
        .map((l) => ({ ...l }));
    },
    async noterVerification(id, quand) {
      const l = lignes.get(id);
      if (l) l.verifieLe = quand;
    },
    async crediterSiNonCredite(demande: DemandeCredit) {
      const l = lignes.get(demande.depositId);
      if (!l) throw new Error(`Dépôt inconnu : ${demande.depositId}`);
      if (l.statut === 'credite') return 'deja_credite';
      if (options.echouerCredit?.()) throw new Error('Panne de la base pendant le crédit');
      if (transactions.has(demande.referenceId)) throw new Error('Violation UNIQUE reference_id');
      transactions.set(demande.referenceId, {
        referenceId: demande.referenceId, userId: demande.userId, credits: demande.credits,
      });
      l.statut = 'credite';
      return 'credite';
    },
    async marquerEchec(id) {
      const l = lignes.get(id);
      if (l && l.statut !== 'credite') l.statut = 'echec';
    },
    etat(id) {
      const l = lignes.get(id);
      return l ? { ...l } : undefined;
    },
    transactions() {
      return [...transactions.values()];
    },
  };
}
