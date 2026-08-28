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
 * Le bilan d'une serie, en une ligne.
 *
 * « 1 réussie · 1 échouée » : la seule information qui compte apres un echec
 * partiel est ce qui a ete gagne et ce qui a ete perdu. Le detail par contenu
 * est juste en dessous ; ce resume evite d'avoir a le lire pour comprendre.
 *
 * Ce qui n'a jamais demarre est compte a part : ces contenus n'ont ouvert
 * aucune tentative, donc rien n'a ete debite pour eux.
 */
export function bilanSerie(items: BatchItem[]): string {
  const { prets, echoues, restants } = batchSummary(items);
  const morceaux: string[] = [];
  if (prets > 0) morceaux.push(`${prets} réussie${prets > 1 ? 's' : ''}`);
  if (echoues > 0) morceaux.push(`${echoues} échouée${echoues > 1 ? 's' : ''}`);
  if (restants > 0) {
    morceaux.push(`${restants} jamais démarrée${restants > 1 ? 's' : ''}`);
  }
  return morceaux.join(' · ');
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
  'La reprise n’est pas encore activée. Le débit est bien idempotent — mais '
  + 'par TENTATIVE, et reprendre un contenu en ouvrirait une nouvelle : rien '
  + 'ne permet encore de reconnaître qu’il s’agit du même. Les contenus '
  + 'réussis sont conservés ; relancez les manquants depuis une nouvelle '
  + 'série.';

/**
 * Ce qu'on dit apres l'echec d'une creation UNIQUE.
 *
 * `REPRISE_INDISPONIBLE` parlait d'un debit « sans cle d'idempotence » : ce
 * n'est plus vrai. Le socle ouvre une tentative, ne debite qu'a la
 * confirmation, et un index unique sur `(user_id, reference_id)` interdit le
 * second debit. Un echec d'envoi ne facture rien et n'enregistre rien --
 * relancer est donc sans risque, et le dire evite de laisser croire a une
 * perte.
 */
export const CREATION_INTERROMPUE =
  'L’envoi a échoué. Aucun crédit n’a été débité et aucun contenu n’a été '
  + 'enregistré. Vous pouvez relancer la création.';

/** Titre du rapport d'echec — le vocabulaire suit le nombre de contenus. */
export function titreInterruption(total: number): string {
  return total > 1 ? 'Série interrompue' : 'Création interrompue';
}

/**
 * Le message d'echec, selon le nombre de contenus.
 *
 * Le vocabulaire « Serie » est conserve au-dela d'un contenu, comme demande.
 * En dessous, il decrivait une situation qui n'existe pas : un seul contenu
 * ne s'interrompt pas « en serie », et rien n'y reste a reprendre.
 */
export function messageInterruption(total: number): string {
  return total > 1 ? REPRISE_INDISPONIBLE : CREATION_INTERROMPUE;
}

export interface Reprise {
  autorisee: boolean;
  raison: string;
}

/**
 * La reprise est-elle autorisee ?
 *
 * NON, systematiquement, et ce n'est toujours pas un oubli — mais la raison
 * a change.
 *
 * Les trois defauts d'origine sont fermes : `debiter_credits` est atomique,
 * le cout vient du serveur, et un index unique sur `(user_id, reference_id)`
 * interdit le second debit d'une meme reference.
 *
 * Ce qui manque est ailleurs. L'idempotence porte sur la TENTATIVE : la
 * reference est derivee du `jobId`, cree a la reservation. Reprendre un
 * contenu echoue ouvrirait une NOUVELLE tentative, donc une nouvelle
 * reference — et le socle la facturerait, a juste titre, comme un rendu
 * different. Il n'existe aucune cle stable par element du lot, persistee
 * cote serveur et retrouvee apres un rechargement.
 *
 * Tant que cette cle n'existe pas, « reprendre » veut dire « recomposer et
 * repayer », ce qui n'est pas ce que le mot promet.
 *
 * La fonction prend quand meme le lot : le jour ou cette cle existera, c'est
 * ici que la regle changera, et nulle part ailleurs dans l'ecran.
 */
export function repriseAutorisee(items: BatchItem[]): Reprise {
  void items;
  return { autorisee: false, raison: REPRISE_INDISPONIBLE };
}
