/**
 * LE CHEMIN UNIQUE QUI CRÉDITE — et la réponse au problème des notifications.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE PROBLÈME
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le prestataire n'accepte QU'UNE adresse de notification par compte
 * marchand. Celle du compte existant pointe vers afroboost, qui redistribue
 * ensuite vers ses autres applications. Brancher Studiio dessus ferait
 * dépendre la confirmation de SES paiements de la disponibilité d'afroboost.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA RÉPONSE : NE PAS DÉPENDRE DE LA NOTIFICATION
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Une notification n'est pas une preuve de paiement : c'est un SIGNAL qui
 * dit « va regarder ». La preuve, c'est la relecture du dépôt auprès du
 * prestataire, que nous pouvons faire quand nous voulons, avec notre propre
 * jeton, sans dépendre de personne.
 *
 * Tout passe donc par `confirmerDepot`, appelé par DEUX déclencheurs :
 *
 *   - la notification, quand elle arrive (chemin rapide) ;
 *   - la RÉCONCILIATION, qui repasse sur les dépôts en attente (filet).
 *
 * Conséquence directe, et c'est le point qui compte : une panne d'afroboost
 * RETARDE un crédit, elle ne le perd jamais. Le crédit n'exige ni la
 * notification, ni le retour du navigateur, ni afroboost — seulement notre
 * jeton et la réconciliation.
 *
 * Un compte marchand distinct resterait préférable pour la LATENCE. Il n'est
 * pas nécessaire à la CORRECTION.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI NE CRÉDITE JAMAIS
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   - le retour du navigateur (`returnUrl`) : il dit seulement que la
 *     personne est revenue, pas qu'elle a payé ;
 *   - le corps d'une notification : n'importe qui peut en poster une ;
 *   - un dépôt inconnu de notre journal : il appartient probablement à une
 *     autre application du même compte marchand. On ne le touche pas.
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import {
  confirmationAutorisee, estDefinitif, referenceCredit,
  type LectureDepot, type StatutDepot,
} from './contrat';
import {
  depasseLaBorne, lireDepotLocal, marquerAbandonne, marquerDepot, marquerVerifie,
  type Depot,
} from './depots';

export type ResultatConfirmation =
  | { issue: 'credite'; credits: number; solde: number }
  | { issue: 'deja_credite'; credits: number }
  | { issue: 'en_attente' }
  | { issue: 'echoue'; statut: StatutDepot; motif: string | null }
  | { issue: 'refuse'; motif: string; message: string }
  | { issue: 'depot_inconnu' };

/** Lecture de l'état chez le prestataire. Injectable : les tests ne sortent pas. */
export type LecteurEtat = (depositId: string) => Promise<LectureDepot>;

export const MESSAGE_CREDIT_INDISPONIBLE =
  'Le paiement est confirmé mais les crédits n’ont pas pu être ajoutés. '
  + 'Rien n’est perdu : la réconciliation reprendra l’opération.';

/**
 * Crédit atomique et idempotent du dépôt. `mm:<depositId>` est la référence :
 * deux appels, séquentiels ou concurrents, ne créditent qu'une fois.
 *
 * ⚠️ Si la fonction SQL n'existe pas (migration non appliquée), on LÈVE. Le
 * dépôt reste « en attente » et la réconciliation réessaiera — mieux vaut un
 * crédit retardé qu'un crédit accordé sans la garantie d'unicité.
 */
async function crediterUneFois(d: Depot): Promise<{ solde: number; deja: boolean }> {
  const { data, error } = await supabaseAdmin.rpc('crediter_credits_mobile_money', {
    p_user_id: d.user_id,
    p_montant: d.credits,
    p_type: d.offre_type === 'plan' ? 'subscription' : 'purchase',
    p_reference: referenceCredit(d.deposit_id),
    p_description: `Mobile Money — ${d.offre_cle} (${d.montant_local} ${d.devise})`,
  });
  if (error) {
    throw new Error(`crediter_credits_mobile_money indisponible : ${error.message || error.code || 'erreur'}`);
  }
  const ligne = (Array.isArray(data) ? data[0] : data) as
    { ok: boolean; solde: number; deja_credite: boolean; motif: string | null } | undefined;
  if (!ligne) throw new Error('crediter_credits_mobile_money sans reponse');
  if (!ligne.ok) throw new Error(`credit refuse : ${ligne.motif ?? 'inconnu'}`);
  return { solde: Number(ligne.solde ?? 0), deja: !!ligne.deja_credite };
}

/**
 * Confirme un dépôt et crédite si — et seulement si — le prestataire le
 * confirme, au bon montant et dans la bonne devise.
 */
export async function confirmerDepot(
  depositId: string,
  lireEtat: LecteurEtat,
): Promise<ResultatConfirmation> {
  const depot = await lireDepotLocal(depositId);
  if (!depot) {
    // Très probablement le dépôt d'une AUTRE application partageant le même
    // compte marchand. Ce n'est pas une erreur, et ce n'est pas à nous.
    console.info('[mobile money] dépôt inconnu de ce journal, ignoré', { depositId });
    return { issue: 'depot_inconnu' };
  }
  if (depot.credite_le) {
    return { issue: 'deja_credite', credits: depot.credits };
  }

  const lu = await lireEtat(depositId);

  if (lu.statut !== 'reussi') {
    if (estDefinitif(lu.statut)) {
      await marquerDepot(depositId, { statut: lu.statut, motif_echec: lu.motifEchec });
      return { issue: 'echoue', statut: lu.statut, motif: lu.motifEchec };
    }
    return { issue: 'en_attente' };
  }

  const verdict = confirmationAutorisee({
    lu,
    montantAttendu: Number(depot.montant_local),
    deviseAttendue: depot.devise,
  });
  if (!verdict.ok) {
    // Statut réussi mais montant ou devise inattendus : on NE CRÉDITE PAS et
    // on garde la trace. Un écart ici se règle à la main, pas en silence.
    console.error('[mobile money] confirmation refusée', {
      depositId, refus: verdict.refus, attendu: depot.montant_local, devise: depot.devise,
    });
    await marquerDepot(depositId, { statut: 'echoue', motif_echec: verdict.refus });
    return { issue: 'refuse', motif: verdict.refus, message: verdict.message };
  }

  const { solde, deja } = await crediterUneFois(depot);
  await marquerDepot(depositId, { statut: 'reussi', credite_le: new Date().toISOString() });
  return deja
    ? { issue: 'deja_credite', credits: depot.credits }
    : { issue: 'credite', credits: depot.credits, solde };
}

export interface BilanReconciliation {
  examines: number;
  credites: number;
  echoues: number;
  encoreEnAttente: number;
  refuses: number;
  /** Fermés comme abandonnés — APRÈS que le prestataire a répondu. */
  abandonnes: number;
  erreurs: number;
}

/**
 * Repasse sur les dépôts encore ouverts. C'est ce filet qui rend le crédit
 * indépendant de la notification — et donc d'afroboost.
 *
 * Une erreur sur un dépôt n'arrête pas les autres : un prestataire qui
 * répond mal pour l'un répond peut-être bien pour le suivant.
 */
export async function reconcilier(
  depots: readonly Depot[],
  lireEtat: LecteurEtat,
  /**
   * `false` pour la passe de seconde chance : ces dépôts sont DÉJÀ fermés,
   * les refermer à chaque passage réécrirait la même ligne sans rien
   * apprendre, et gonflerait le compte des fermetures dans le bilan.
   */
  options: { fermerLesAbandonnes?: boolean } = {},
): Promise<BilanReconciliation> {
  const fermer = options.fermerLesAbandonnes !== false;
  const bilan: BilanReconciliation = {
    examines: depots.length, credites: 0, echoues: 0, encoreEnAttente: 0,
    refuses: 0, abandonnes: 0, erreurs: 0,
  };
  for (const d of depots) {
    try {
      const r = await confirmerDepot(d.deposit_id, lireEtat);

      // ⚠️ RELU = REMIS EN FIN DE FILE, QUELLE QUE SOIT L'ISSUE. Ne l'écrire
      // que pour les dépôts encore en attente laissait les autres — ceux que
      // le prestataire déclare clos — avec une date de relecture jamais mise
      // à jour : ils revenaient donc en tête à chaque passage et occupaient
      // la fenêtre pour toujours. C'est le défaut que ce lot a déjà corrigé
      // une fois ; il s'était reformé dans la passe de seconde chance.
      await marquerVerifie(d.deposit_id);

      if (r.issue === 'en_attente') {
        // ⚠️ LE PRESTATAIRE VIENT DE RÉPONDRE « toujours en attente ». C'est
        // seulement maintenant, et jamais sur le seul critère de l'âge, qu'un
        // dépôt peut être déclaré abandonné : le fermer sans avoir demandé
        // reviendrait à renoncer à un paiement peut-être déjà encaissé.
        if (fermer && depasseLaBorne(d)) {
          await marquerAbandonne(d.deposit_id);
          bilan.abandonnes += 1;
        }
      }
      switch (r.issue) {
        case 'credite': bilan.credites += 1; break;
        case 'deja_credite': break;
        case 'echoue': bilan.echoues += 1; break;
        case 'refuse': bilan.refuses += 1; break;
        default: bilan.encoreEnAttente += 1;
      }
    } catch (e) {
      bilan.erreurs += 1;
      console.error('[mobile money] réconciliation en échec', {
        depositId: d.deposit_id, message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return bilan;
}
