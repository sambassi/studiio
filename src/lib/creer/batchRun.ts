/**
 * Suivi d'un LOT en cours : un etat par contenu, et un identifiant stable.
 *
 * Complement de `batch.ts`, qui decide QUOI produire (angles, dates, affiches).
 * Ce module-ci decide ce qu'on SAIT de chaque contenu pendant et apres la
 * boucle : lequel est pret, lequel a echoue, lesquels n'ont jamais demarre.
 *
 * Fonctions PURES, sans React ni reseau. Un lot touche aux credits : son etat
 * doit etre verifiable sur des valeurs, pas seulement observable a l'ecran.
 */

/**
 * Etat d'un contenu du lot.
 *
 * `attente` : jamais demarre — donc jamais facture.
 * `rendu`   : composition en cours.
 * `pret`    : post enregistre. C'est le seul etat qui implique un debit.
 * `echoue`  : la composition ou l'enregistrement a echoue.
 */
export type BatchItemState = 'attente' | 'rendu' | 'pret' | 'echoue';

export interface BatchItem {
  /** Identifiant STABLE du contenu, constant sur toute la vie du lot. */
  id: string;
  /** Rang dans le lot, a partir de 0. */
  index: number;
  etat: BatchItemState;
  /** Renseigne quand `etat === 'pret'`. */
  postId?: string;
  /** Renseigne quand `etat === 'echoue'`. */
  erreur?: string;
}

/**
 * Identifiant du lot.
 *
 * Prend l'instant en parametre au lieu de lire l'horloge : une fonction qui
 * lit `Date.now()` elle-meme n'est pas testable sur des valeurs.
 */
export function batchRunId(seed: number): string {
  const n = Number.isFinite(seed) ? Math.abs(Math.floor(seed)) : 0;
  return `lot-${n.toString(36)}`;
}

/**
 * Identifiant d'un contenu.
 *
 * Derive du lot et du RANG, jamais d'un compteur ou d'un aleatoire : c'est ce
 * qui le rend stable d'une tentative a l'autre. Une reprise doit pouvoir
 * designer « la troisieme du lot » et retrouver exactement la meme.
 */
export function batchItemId(runId: string, index: number): string {
  return `${runId}-${Math.max(0, Math.floor(index)) + 1}`;
}

/** Lot au depart : tout en attente, donc rien de facture. */
export function initialBatchItems(runId: string, count: number): BatchItem[] {
  const total = Math.max(0, Math.floor(count));
  const out: BatchItem[] = [];
  for (let i = 0; i < total; i += 1) {
    out.push({ id: batchItemId(runId, i), index: i, etat: 'attente' });
  }
  return out;
}

/**
 * Nouvel etat d'un contenu, sans muter la liste recue.
 *
 * Un identifiant inconnu laisse la liste inchangee plutot que d'ajouter une
 * ligne : un lot ne gagne pas de contenu en cours de route.
 */
export function setItemState(
  items: BatchItem[],
  id: string,
  etat: BatchItemState,
  extra?: { postId?: string; erreur?: string },
): BatchItem[] {
  return (items || []).map((it) => {
    if (it.id !== id) return it;
    const suivant: BatchItem = { ...it, etat };
    if (extra?.postId !== undefined) suivant.postId = extra.postId;
    if (extra?.erreur !== undefined) suivant.erreur = extra.erreur;
    return suivant;
  });
}

/** Contenus echoues, dans l'ordre du lot. */
export function failedItems(items: BatchItem[]): BatchItem[] {
  return (items || []).filter((it) => it.etat === 'echoue');
}

/** Contenus aboutis, dans l'ordre du lot. */
export function succeededItems(items: BatchItem[]): BatchItem[] {
  return (items || []).filter((it) => it.etat === 'pret');
}

export interface BatchSummary {
  total: number;
  prets: number;
  echoues: number;
  /** Ni prets ni echoues : en attente ou en cours. */
  restants: number;
}

export function batchSummary(items: BatchItem[]): BatchSummary {
  const liste = items || [];
  const prets = succeededItems(liste).length;
  const echoues = failedItems(liste).length;
  return { total: liste.length, prets, echoues, restants: liste.length - prets - echoues };
}

/**
 * Le lot s'est-il arrete en cours de route ?
 *
 * Vrai des qu'un contenu a echoue OU qu'il en reste sur le carreau alors que
 * d'autres sont passes. C'est ce qui declenche l'affichage de l'echec partiel.
 */
export function batchPartiel(items: BatchItem[]): boolean {
  const { total, prets, echoues, restants } = batchSummary(items);
  if (total === 0) return false;
  if (echoues > 0) return true;
  return restants > 0 && prets > 0;
}

/**
 * Message affiche a la place de la reprise.
 *
 * Il dit la vraie raison. Un « indisponible pour le moment » laisserait croire
 * a une panne passagere alors que c'est une garantie deliberee.
 */
export const REPRISE_INDISPONIBLE =
  'La reprise des contenus échoués n’est pas encore activée : le débit des '
  + 'crédits ne dispose d’aucune clé d’idempotence, donc relancer un contenu '
  + 'pourrait le facturer deux fois. Les contenus déjà réussis sont conservés '
  + 'dans le calendrier ; relancez les manquants depuis un nouveau lot.';

export interface Reprise {
  autorisee: boolean;
  raison: string;
}

/**
 * La reprise est-elle autorisee ?
 *
 * NON, systematiquement, et ce n'est pas un oubli. Rejouer un contenu echoue
 * suppose de savoir qu'il n'a PAS ete facture — or `POST /api/credits/deduct`
 * n'accepte aucune cle d'idempotence, `credit_transactions` ne porte aucune
 * contrainte unique, et `deductCredits` est un lire-modifier-ecrire non
 * atomique. Tant que ces trois points tiennent, une reprise est un double
 * debit en puissance.
 *
 * La fonction prend quand meme le lot : le jour ou l'idempotence existera,
 * c'est ici que la regle changera, et nulle part ailleurs dans l'ecran.
 */
export function repriseAutorisee(items: BatchItem[]): Reprise {
  void items;
  return { autorisee: false, raison: REPRISE_INDISPONIBLE };
}
