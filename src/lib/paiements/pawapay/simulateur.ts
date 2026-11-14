/**
 * PRESTATAIRE SIMULÉ — pour éprouver le parcours sans qu'un franc bouge.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'IL SERT À PROUVER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les cas qui comptent dans un encaissement ne sont pas le cas nominal : ce
 * sont la notification reçue deux fois, le montant qui ne correspond pas, la
 * confirmation qui arrive en retard, le retour du navigateur sans paiement.
 * Aucun ne se provoque à volonté chez un vrai prestataire. Ici, si.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI IL NE PEUT PAS SE DÉCLENCHER PAR ACCIDENT
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   - il n'est consulté que si `MOBILE_MONEY_SIMULE === '1'`, posé
 *     explicitement ; ce n'est jamais un repli silencieux ;
 *   - l'état vit EN MÉMOIRE du processus : rien n'est écrit, rien ne
 *     survit à un redémarrage, et aucune base ne le porte ;
 *   - un dépôt dont l'issue n'a pas été choisie reste « en attente » —
 *     le simulateur n'invente jamais un succès.
 */
import type { LectureDepot, StatutDepot } from './contrat';

interface EtatSimule {
  statut: StatutDepot;
  montant: number | null;
  devise: string | null;
  motifEchec: string | null;
  /** Nombre de lectures restantes avant que l'issue choisie s'applique. */
  retard: number;
}

const etats = new Map<string, EtatSimule>();

export interface IssueSimulee {
  statut: StatutDepot;
  /** Montant encaissé. Omis = celui attendu, donc un paiement conforme. */
  montant?: number | null;
  devise?: string | null;
  motifEchec?: string | null;
  /**
   * Confirmation RETARDÉE : nombre de lectures qui répondront encore
   * « en attente » avant que l'issue s'applique. C'est le cas réel d'un
   * paiement confirmé plusieurs minutes après le retour du navigateur.
   */
  retard?: number;
}

export function poserIssueSimulee(depositId: string, issue: IssueSimulee): void {
  etats.set(depositId, {
    statut: issue.statut,
    montant: issue.montant === undefined ? null : issue.montant,
    devise: issue.devise ?? null,
    motifEchec: issue.motifEchec ?? null,
    retard: Math.max(0, Number(issue.retard ?? 0)),
  });
}

export function oublierIssueSimulee(depositId: string): void {
  etats.delete(depositId);
}

/** Tests seulement : remet le simulateur à zéro entre deux scénarios. */
export function reinitialiserSimulateur(): void {
  etats.clear();
}

export function issuesSimulees(): number {
  return etats.size;
}

/**
 * Lecteur d'état simulé. `attendu` fournit le montant et la devise du dépôt,
 * pour qu'une issue « réussie » sans montant précisé soit CONFORME — c'est le
 * cas nominal, et il ne faut pas avoir à le décrire.
 */
export function lecteurSimule(attendu: (depositId: string) => { montant: number; devise: string } | null) {
  return async (depositId: string): Promise<LectureDepot> => {
    const e = etats.get(depositId);
    if (!e) {
      // Issue non choisie : en attente. Le simulateur n'invente pas un succès.
      return { statut: 'en_attente', montant: null, devise: null, motifEchec: null };
    }
    if (e.retard > 0) {
      e.retard -= 1;
      return { statut: 'en_attente', montant: null, devise: null, motifEchec: null };
    }
    const reference = attendu(depositId);
    return {
      statut: e.statut,
      montant: e.montant ?? (e.statut === 'reussi' ? reference?.montant ?? null : null),
      devise: e.devise ?? (e.statut === 'reussi' ? reference?.devise ?? null : null),
      motifEchec: e.motifEchec,
    };
  };
}
