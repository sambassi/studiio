/**
 * CINEMA IA — PLAFOND DE DEPENSE REELLE, PAR COMPTE ET GLOBAL.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE `couts.ts` NE PROTEGE PAS
 * ─────────────────────────────────────────────────────────────────────────
 * `verifierPlafond` (generation/couts.ts) borne la depense d'un FILM — mais le
 * compteur qu'il lit (`film.coutGenerationUsd`) vit dans le document JSON du
 * film. Supprimer puis recreer un film le remet a zero : ce n'est pas un
 * budget, c'est un garde-fou local, documente comme tel depuis l'origine.
 *
 * Ce module ajoute un DEUXIEME niveau, DURABLE, qui ne vit ni sur le film ni
 * sur un credit Studiio deja depense : un compteur PAR COMPTE et un compteur
 * GLOBAL (tous comptes confondus), poses en base (migration
 * `2026-10-31-cinema-plafond-compte.sql`, NON appliquee en production). Ils
 * survivent a la creation et a la suppression de n'importe quel film.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TROIS PHASES — MEME DISCIPLINE QUE LE DEBIT ET LE REMBOURSEMENT DE CREDITS
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   1. RESERVER, avant tout appel fournisseur : verifie ET incremente, dans
 *      UNE transaction SQL, le compteur du compte ET le compteur global.
 *      Refuse — sans rien ecrire — si l'un des deux plafonds serait depasse.
 *   2. CONFIRMER, apres l'appel, avec l'issue REELLE :
 *        - l'appel a eu lieu (succes, ou echec apres une reponse du
 *          fournisseur) → reste compte, montant inchange ;
 *        - le delai a expire pendant l'appel → 'incertaine' : on NE SAIT PAS
 *          si le fournisseur a demarre et facture quand meme. Reste compte
 *          (jamais sous-estimer) jusqu'a reconciliation ;
 *        - la preuve existe qu'aucun appel n'est jamais parti (validation
 *          locale refusee avant tout reseau) → 'liberee' : les deux
 *          compteurs sont decrementes du montant reserve.
 *   3. RECONCILIER une 'incertaine' plus tard : un second appel a
 *      `confirmerDepenseReplicate`, avec le statut final desormais connu
 *      (ex. verifie manuellement cote Replicate). Aucune fonction separee,
 *      meme garde d'idempotence que l'etape 2.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * BUDGET INCONNU = REFUS, JAMAIS UN APPEL A L'AVEUGLE
 * ─────────────────────────────────────────────────────────────────────────
 * Si la migration n'est pas appliquee sur ce serveur, ou si le cout de
 * l'operation n'est pas lisible, la reservation est refusee — exactement la
 * meme regle que `reserverCredits`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE NE FAIT PAS (assume, a traiter avant ouverture large)
 * ─────────────────────────────────────────────────────────────────────────
 * Aucune reconciliation AUTOMATIQUE contre l'API Replicate : ce module
 * ACCUEILLE un resultat reconcilie, il ne va pas le chercher. Un job qui
 * interrogerait Replicate pour les 'incertaine' trop anciennes est un
 * chantier separe (lecture seule, pas un appel payant — mais hors perimetre
 * ici).
 */
import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/db/supabase';

/**
 * Codes PostgREST qui signifient « la fonction n'existe pas ».
 *
 * Copie volontaire de l'equivalent dans `lib/credits/atomique.ts`, plutot
 * qu'un import : ce module gere un ledger de depense Replicate INDEPENDANT
 * des credits Studiio, et un test dedie (`cinema-travaux.test.ts`) verifie
 * qu'aucun fichier Cinema IA — hors les deux autorises — n'importe
 * `lib/credits/*`. Dupliquer sept lignes vaut mieux qu'affaiblir cette
 * frontiere pour un detail d'implementation.
 */
function socleAbsent(erreur: { code?: string; message?: string } | null): boolean {
  if (!erreur) return false;
  const code = erreur.code ?? '';
  const message = (erreur.message ?? '').toLowerCase();
  return code === '42883' || code === 'PGRST202'
    || message.includes('does not exist') || message.includes('schema cache');
}

export const PREFIXE_REFERENCE_DEPENSE = 'cinema-depense';

export function referenceDepense(sujet: string): string {
  return `${PREFIXE_REFERENCE_DEPENSE}:${sujet}`;
}

/**
 * Plafond PAR COMPTE, cote serveur. Jamais lu dans une requete. Valeur
 * invalide ou absente → le defaut ; borne haute 50 $ : une variable mal
 * saisie ne peut pas ouvrir un budget illimite pour un seul compte.
 */
export const PLAFOND_USD_PAR_COMPTE_DEFAUT = 5;
export function plafondCompteUsd(env: NodeJS.ProcessEnv = process.env): number {
  const brut = env.CINEMA_PLAFOND_USD_COMPTE;
  if (brut === undefined || brut === '') return PLAFOND_USD_PAR_COMPTE_DEFAUT;
  const n = Number(brut);
  if (!Number.isFinite(n) || n < 0) return PLAFOND_USD_PAR_COMPTE_DEFAUT;
  return Math.min(n, 50);
}

/**
 * Plafond GLOBAL (tous comptes confondus), cote serveur. Meme discipline,
 * borne haute 1000 $ : un filet de securite pour l'ensemble de Studiio, pas
 * un budget que quiconque peut relever depuis une requete.
 */
export const PLAFOND_USD_GLOBAL_DEFAUT = 100;
export function plafondGlobalUsd(env: NodeJS.ProcessEnv = process.env): number {
  const brut = env.CINEMA_PLAFOND_USD_GLOBAL;
  if (brut === undefined || brut === '') return PLAFOND_USD_GLOBAL_DEFAUT;
  const n = Number(brut);
  if (!Number.isFinite(n) || n < 0) return PLAFOND_USD_GLOBAL_DEFAUT;
  return Math.min(n, 1000);
}

export type MotifRefusDepense =
  | 'reference_absente' | 'montant_invalide' | 'operation_invalide' | 'plafond_invalide'
  | 'plafond_compte_depasse' | 'plafond_global_depasse' | 'socle_absent';

export interface ResultatReservationDepense {
  ok: boolean;
  motif: MotifRefusDepense | null;
  dejaEngagee: boolean;
  totalCompteUsd: number;
  totalGlobalUsd: number;
}

type RpcReserver = (
  userId: string, montantUsd: number, reference: string, operation: 'image' | 'video',
  plafondCompte: number, plafondGlobal: number,
) => Promise<ResultatReservationDepense>;

async function reserverViaSupabase(
  userId: string, montantUsd: number, reference: string, operation: 'image' | 'video',
  plafondCompte: number, plafondGlobal: number,
): Promise<ResultatReservationDepense> {
  const { data, error } = await supabaseAdmin.rpc('reserver_depense_cinema', {
    p_user_id: userId, p_montant_usd: montantUsd, p_reference: reference, p_operation: operation,
    p_plafond_compte: plafondCompte, p_plafond_global: plafondGlobal,
  });
  if (error) {
    if (socleAbsent(error)) {
      console.warn(
        '[Cinema/Plafond] `reserver_depense_cinema` introuvable — migration '
        + '2026-10-31-cinema-plafond-compte.sql non appliquee sur ce serveur.',
      );
      return { ok: false, motif: 'socle_absent', dejaEngagee: false, totalCompteUsd: 0, totalGlobalUsd: 0 };
    }
    throw new Error(error.message || 'reservation de depense impossible');
  }
  const ligne = (Array.isArray(data) ? data[0] : data) as {
    ok: boolean; motif: MotifRefusDepense | null; deja_engagee: boolean;
    total_compte: number; total_global: number;
  } | undefined;
  if (!ligne) throw new Error('reservation sans reponse');
  return {
    ok: !!ligne.ok, motif: ligne.motif ?? null, dejaEngagee: !!ligne.deja_engagee,
    totalCompteUsd: Number(ligne.total_compte ?? 0), totalGlobalUsd: Number(ligne.total_global ?? 0),
  };
}

/**
 * Reserve une depense Replicate ESTIMEE, AVANT l'appel fournisseur. Refuse
 * sans rien ecrire si le compte ou le plafond global serait depasse, ou si
 * le cout n'est pas un nombre positif connu. Ne leve jamais : le refus est
 * une valeur, traduite par la route en 409.
 */
export async function reserverDepenseReplicate(
  userId: string, montantUsd: number, operation: 'image' | 'video',
  o: { reserver?: RpcReserver; reference?: string; plafondCompte?: number; plafondGlobal?: number } = {},
): Promise<{ ok: true; reference: string; montantUsd: number } | { ok: false; motif: MotifRefusDepense; message: string }> {
  if (!Number.isFinite(montantUsd) || montantUsd <= 0) {
    return { ok: false, motif: 'montant_invalide', message: 'cout de generation inconnu ou nul : aucune reservation' };
  }
  const reserver = o.reserver ?? reserverViaSupabase;
  const reference = o.reference ?? referenceDepense(randomUUID());
  const plafondCompte = o.plafondCompte ?? plafondCompteUsd();
  const plafondGlobal = o.plafondGlobal ?? plafondGlobalUsd();

  let issue: ResultatReservationDepense;
  try {
    issue = await reserver(userId, montantUsd, reference, operation, plafondCompte, plafondGlobal);
  } catch (e) {
    console.error('[Cinema/Plafond] reservation impossible :', e instanceof Error ? e.message : e);
    return { ok: false, motif: 'socle_absent', message: 'le plafond de depense ne peut pas etre verifie sur ce serveur' };
  }

  if (!issue.ok) {
    const motif = issue.motif ?? 'plafond_compte_depasse';
    // ⚠️ CORRECTIF (confusion plafond PAR GENERATION vs CUMULE DU COMPTE, diagnostic 2026-10-28) :
    // le message ne disait QUE le plafond, jamais ce que le COMPTE a deja engage — un refus a
    // 2,00 $ de plafond ETAIT IDENTIQUE, a l'ecran, que le compte soit a 0,10 $ ou a 1,95 $
    // deja engages. Sans ce chiffre, un refus sur une generation a 0,45 $ pouvait se lire,
    // a tort, comme « 0,45 $ est traite comme le plafond du film » — alors que le plafond DU
    // COMPTE (independant du film, DURABLE, voir l'en-tete du fichier) etait simplement deja
    // presque atteint par d'AUTRES engagements (generations anterieures, y compris celles dont
    // la facturation reste incertaine). `issue.totalCompteUsd`/`totalGlobalUsd` existaient deja
    // dans la reponse SQL : ils etaient seulement jetes au lieu d'etre montres.
    const messages: Record<MotifRefusDepense, string> = {
      reference_absente: 'reference de reservation invalide',
      montant_invalide: 'cout de generation inconnu ou nul : aucune reservation',
      operation_invalide: 'operation invalide',
      plafond_invalide: 'plafond de depense invalide sur ce serveur',
      plafond_compte_depasse: `plafond de depense DU COMPTE atteint : ${issue.totalCompteUsd.toFixed(4)} $ deja engages (toutes generations, meme sur d'autres films) + ${montantUsd.toFixed(4)} $ proposes > ${plafondCompte.toFixed(2)} $ de plafond compte — generation refusee avant tout appel`,
      plafond_global_depasse: `plafond de depense GLOBAL de Studiio atteint : ${issue.totalGlobalUsd.toFixed(4)} $ deja engages (tous comptes) + ${montantUsd.toFixed(4)} $ proposes > ${plafondGlobal.toFixed(2)} $ de plafond global — generation refusee avant tout appel`,
      socle_absent: 'le plafond de depense ne peut pas etre verifie sur ce serveur',
    };
    return { ok: false, motif, message: messages[motif] };
  }
  return { ok: true, reference, montantUsd };
}

export type MotifRefusConfirmation = 'statut_invalide' | 'reference_absente' | 'deja_finalisee' | 'montant_invalide' | 'socle_absent';
export type StatutDepense = 'confirmee' | 'incertaine' | 'liberee';

export interface ResultatConfirmationDepense {
  ok: boolean;
  motif: MotifRefusConfirmation | null;
}

type RpcConfirmer = (
  userId: string, reference: string, statut: StatutDepense, montantFinal: number | null,
) => Promise<{ ok: boolean; motif: MotifRefusConfirmation | null }>;

async function confirmerViaSupabase(
  userId: string, reference: string, statut: StatutDepense, montantFinal: number | null,
): Promise<{ ok: boolean; motif: MotifRefusConfirmation | null }> {
  const { data, error } = await supabaseAdmin.rpc('confirmer_depense_cinema', {
    p_user_id: userId, p_reference: reference, p_statut: statut, p_montant_final: montantFinal,
  });
  if (error) {
    if (socleAbsent(error)) return { ok: false, motif: 'socle_absent' };
    throw new Error(error.message || 'confirmation de depense impossible');
  }
  const ligne = (Array.isArray(data) ? data[0] : data) as { ok: boolean; motif: MotifRefusConfirmation | null } | undefined;
  if (!ligne) throw new Error('confirmation sans reponse');
  return { ok: !!ligne.ok, motif: ligne.motif ?? null };
}

/**
 * Finalise une reservation avec l'issue REELLE. Ne leve jamais : un echec de
 * confirmation est grave (le compteur peut rester gonfle a tort pour une
 * depense 'liberee' qui n'a pas pu l'etre), mais ne doit jamais empecher la
 * route de repondre a l'utilisateur sur l'echec de generation lui-meme.
 */
export async function confirmerDepenseReplicate(
  userId: string, reference: string, statut: StatutDepense,
  o: { confirmer?: RpcConfirmer; montantFinal?: number } = {},
): Promise<ResultatConfirmationDepense> {
  const confirmer = o.confirmer ?? confirmerViaSupabase;
  try {
    const issue = await confirmer(userId, reference, statut, o.montantFinal ?? null);
    if (!issue.ok) {
      console.error(`[Cinema/Plafond] confirmation refusee (${issue.motif ?? 'motif inconnu'}) — compte ${userId}, reference ${reference}, statut demande ${statut}.`);
    }
    return { ok: !!issue.ok, motif: issue.motif ?? null };
  } catch (e) {
    console.error('[Cinema/Plafond] confirmation impossible :', e instanceof Error ? e.message : e);
    return { ok: false, motif: 'socle_absent' };
  }
}
