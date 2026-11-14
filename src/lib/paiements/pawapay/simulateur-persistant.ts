/**
 * ISSUES SIMULÉES, PERSISTÉES — parce que la mémoire du processus ne suffit
 * pas.
 *
 * Le simulateur en mémoire (`simulateur.ts`) convient aux tests : un seul
 * processus, une seule exécution. En prévisualisation, non : le serveur de
 * développement recharge ses modules entre deux requêtes, et l'issue posée
 * dans une requête avait disparu à la suivante — la réconciliation ne
 * trouvait plus rien à confirmer.
 *
 * Les issues vivent donc dans une table à part, `pawapay_simulation`, qui
 * n'existe QUE dans une base de prévisualisation. En production, rien ne la
 * lit : le simulateur n'est consulté que si `MOBILE_MONEY_SIMULE === '1'`.
 * Et si la table est absente, l'issue est simplement « non choisie » — le
 * simulateur n'invente jamais un succès.
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import type { LectureDepot, StatutDepot } from './contrat';
import type { IssueSimulee } from './simulateur';

const TABLE = 'pawapay_simulation';

interface LigneSimulation {
  deposit_id: string;
  statut: StatutDepot;
  montant: number | null;
  devise: string | null;
  motif_echec: string | null;
  retard: number;
}

export async function poserIssuePersistante(depositId: string, issue: IssueSimulee): Promise<void> {
  const ligne: LigneSimulation = {
    deposit_id: depositId,
    statut: issue.statut,
    montant: issue.montant ?? null,
    devise: issue.devise ?? null,
    motif_echec: issue.motifEchec ?? null,
    retard: Math.max(0, Number(issue.retard ?? 0)),
  };
  const { error } = await supabaseAdmin.from(TABLE).upsert(ligne, { onConflict: 'deposit_id' });
  if (error) throw new Error(`issue simulée non posée : ${error.message}`);
}

async function lireLigne(depositId: string): Promise<LigneSimulation | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLE).select('*').eq('deposit_id', depositId).maybeSingle();
    if (error) return null;
    return (data as LigneSimulation | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * Lecteur d'état adossé à la table. `attendu` donne le montant du dépôt, pour
 * qu'une issue « réussie » sans précision soit CONFORME — le cas nominal ne
 * doit pas avoir à être décrit.
 */
export function lecteurSimulePersistant(
  attendu: (depositId: string) => Promise<{ montant: number; devise: string } | null>,
) {
  return async (depositId: string): Promise<LectureDepot> => {
    const l = await lireLigne(depositId);
    if (!l) return { statut: 'en_attente', montant: null, devise: null, motifEchec: null };

    if (Number(l.retard) > 0) {
      // Un cran de retard consommé par lecture : c'est le cas réel d'une
      // confirmation qui arrive quelques minutes après le retour du payeur.
      await supabaseAdmin.from(TABLE).update({ retard: Number(l.retard) - 1 }).eq('deposit_id', depositId);
      return { statut: 'en_attente', montant: null, devise: null, motifEchec: null };
    }

    const reference = l.statut === 'reussi' ? await attendu(depositId) : null;
    return {
      statut: l.statut,
      montant: l.montant ?? reference?.montant ?? null,
      devise: l.devise ?? reference?.devise ?? null,
      motifEchec: l.motif_echec,
    };
  };
}
