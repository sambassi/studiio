import { supabaseAdmin } from '@/lib/db/supabase';
import { lireRush } from '@/lib/autopilot/tournage/service';
import {
  analyseDepuisLigne, COLONNES_ANALYSE,
  type RushAnalysis, type RushAnalysisStatus, type RushAnalysisStep,
  type FournisseursParEtape, type VignetteAnalyse,
} from './contrat';

/**
 * L'accès aux analyses de rush.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * `user_id` NE VIENT JAMAIS D'AILLEURS QUE DE LA SESSION
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Chaque fonction reçoit `userId` de son appelant, et cet appelant le tient
 * de `auth()`. Toutes les lectures portent `.eq('user_id', userId)` : une
 * analyse ou un rush d'autrui est INTROUVABLE, pas « interdit ». La nuance
 * compte — un 403 confirmerait l'existence de la ressource.
 *
 * La base pose la même garantie de son côté, par une clé étrangère composite
 * `(rush_id, user_id)` : même un appelant qui oublierait le filtre ne
 * pourrait pas rattacher une analyse au rush d'un autre.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * L'IDEMPOTENCE EST PORTÉE PAR LE MOTEUR, PAS PAR CE FICHIER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `rush_analyses_active_unique` interdit deux analyses actives sur un même
 * rush. Ce module ne fait AUCUN `select` préalable pour vérifier qu'il peut
 * insérer : entre la lecture et l'écriture il y a une fenêtre, et deux
 * requêtes parallèles la traversent toutes les deux. Il insère, et traduit le
 * refus de la base en motif lisible.
 *
 * Même chose pour la version : elle est calculée à partir du maximum
 * existant, et si deux appels tombent sur le même numéro, c'est
 * `rush_analyses_rush_version_unique` qui tranche — pas un verrou applicatif.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE NE FAIT PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Aucune route HTTP, aucun appel à un modèle, aucun ffmpeg, aucune URL de
 * stockage — ni signée, ni publique. Il prépare les primitives que M3-B2
 * utilisera ; il n'en utilise aucune lui-même.
 */

/** Les motifs qu'un appelant doit savoir traduire. */
export type MotifAnalyse =
  | 'socle_absent'
  | 'rush_introuvable'
  | 'analyse_introuvable'
  | 'analyse_active_existante'
  | 'analyse_close';

/**
 * Codes PostgREST qui signifient « la table n'existe pas ».
 *
 * Copie assumée de `socleAbsent` du service de tournage : les deux modules
 * répondent de deux migrations différentes, et devront un jour nommer des
 * fichiers différents dans leur message. Les fusionner reviendrait à ce que
 * l'absence de `rush_analyses` fasse dire « appliquez la migration du
 * tournage ».
 */
function socleAbsent(erreur: { code?: string; message?: string } | null): boolean {
  if (!erreur) return false;
  const code = erreur.code ?? '';
  const message = (erreur.message ?? '').toLowerCase();
  // 42P01 = undefined_table ; PGRST205 = table hors du cache de schéma.
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST202'
    || message.includes('does not exist') || message.includes('schema cache');
}

/** Violation d'unicité : c'est un refus attendu, pas une panne. */
function violationUnicite(erreur: { code?: string; message?: string } | null): boolean {
  if (!erreur) return false;
  const message = (erreur.message ?? '').toLowerCase();
  return erreur.code === '23505' || message.includes('duplicate key');
}

export interface ResultatAnalyse {
  analyse: RushAnalysis | null;
  motif: MotifAnalyse | null;
}

/**
 * Crée une analyse `en_attente` pour un rush — et rien d'autre.
 *
 * La ligne est posée AVANT tout travail. Elle existe donc même si le
 * processus qui devait la traiter meurt : une reprise la retrouve `en_attente`
 * ou `en_cours` plutôt que d'avoir à deviner qu'un travail a eu lieu.
 *
 * Le rush est relu d'abord : sans ça, demander l'analyse du rush d'autrui
 * échouerait sur la clé étrangère, et le message de la base parlerait de
 * contrainte là où l'appelant attend « introuvable ».
 */
export async function creerAnalyse(
  userId: string, rushId: string,
): Promise<ResultatAnalyse> {
  const { rush, motif } = await lireRush(userId, rushId);
  if (motif === 'socle_absent') return { analyse: null, motif: 'socle_absent' };
  if (!rush) return { analyse: null, motif: 'rush_introuvable' };

  // La version suit ce qui existe. Si deux appels simultanés calculent le
  // même numéro, l'index unique en refuse un — c'est le comportement voulu.
  const { data: derniere, error: erreurLecture } = await supabaseAdmin
    .from('rush_analyses')
    .select('version')
    .eq('rush_id', rushId)
    .eq('user_id', userId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (erreurLecture && socleAbsent(erreurLecture)) {
    return { analyse: null, motif: 'socle_absent' };
  }
  const version = derniere && typeof (derniere as { version?: unknown }).version === 'number'
    ? (derniere as { version: number }).version + 1 : 1;

  const { data, error } = await supabaseAdmin
    .from('rush_analyses')
    .insert({
      rush_id: rushId,
      user_id: userId,
      version,
      // L'état et l'étape sont décidés ICI, jamais reçus. Une analyse qui
      // naîtrait `reussie` serait un résultat inventé.
      etat: 'en_attente' as RushAnalysisStatus,
      etape: null,
    })
    .select(COLONNES_ANALYSE)
    .maybeSingle();

  if (error) {
    if (socleAbsent(error)) return { analyse: null, motif: 'socle_absent' };
    if (violationUnicite(error)) {
      // Deux index peuvent refuser : `rush_analyses_active_unique` si une
      // analyse tourne déjà, `rush_analyses_rush_version_unique` si un appel
      // simultané a pris le même numéro de version. Les deux disent la même
      // chose à l'utilisateur — une analyse de ce rush est déjà en cours —
      // parce que dans le second cas c'est l'appel gagnant qui vient de la
      // créer. Un motif distinct par index nommerait un détail d'index dans
      // un message d'écran sans rien apprendre à personne.
      return { analyse: null, motif: 'analyse_active_existante' };
    }
    throw new Error(error.message || 'creation d analyse impossible');
  }
  if (!data) throw new Error('creation sans reponse');
  return { analyse: analyseDepuisLigne(data as Record<string, unknown>), motif: null };
}

export async function lireAnalyse(
  userId: string, analyseId: string,
): Promise<ResultatAnalyse> {
  const { data, error } = await supabaseAdmin
    .from('rush_analyses')
    .select(COLONNES_ANALYSE)
    .eq('id', analyseId)
    // Le filtre de propriété est ICI, dans la requête : une analyse d'autrui
    // ne revient pas, donc l'appelant n'a rien à décider.
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    if (socleAbsent(error)) return { analyse: null, motif: 'socle_absent' };
    throw new Error(error.message || 'lecture d analyse impossible');
  }
  if (!data) return { analyse: null, motif: 'analyse_introuvable' };
  return { analyse: analyseDepuisLigne(data as Record<string, unknown>), motif: null };
}

/**
 * Les analyses d'un rush, la plus récente d'abord.
 *
 * Le rush est relu d'abord, pour la même raison qu'en M3-A : sans ça,
 * demander les analyses du rush d'autrui rendrait une liste vide —
 * indiscernable d'un rush jamais analysé.
 */
export async function listerAnalyses(
  userId: string, rushId: string,
): Promise<{ analyses: RushAnalysis[]; motif: MotifAnalyse | null }> {
  const { rush, motif } = await lireRush(userId, rushId);
  if (motif === 'socle_absent') return { analyses: [], motif: 'socle_absent' };
  if (!rush) return { analyses: [], motif: 'rush_introuvable' };

  const { data, error } = await supabaseAdmin
    .from('rush_analyses')
    .select(COLONNES_ANALYSE)
    .eq('rush_id', rushId)
    .eq('user_id', userId)
    .order('version', { ascending: false });

  if (error) {
    if (socleAbsent(error)) return { analyses: [], motif: 'socle_absent' };
    throw new Error(error.message || 'lecture des analyses impossible');
  }
  const lignes = Array.isArray(data) ? data : [];
  return {
    analyses: lignes.map((l) => analyseDepuisLigne(l as Record<string, unknown>)),
    motif: null,
  };
}

/**
 * Ce qu'un traitement a le droit d'écrire sur une analyse en cours.
 *
 * Ni `id`, ni `rush_id`, ni `user_id`, ni `version` : ces quatre-là sont
 * l'identité de la ligne. Les modifier ne serait pas une mise à jour, ce
 * serait une autre analyse.
 */
export interface MajAnalyse {
  etat?: RushAnalysisStatus;
  etape?: RushAnalysisStep | null;
  fournisseurs?: FournisseursParEtape;
  dureeSecondes?: number | null;
  technique?: Record<string, unknown>;
  resume?: string | null;
  textesVisibles?: unknown[];
  parole?: Record<string, unknown>;
  audio?: Record<string, unknown>;
  qualite?: Record<string, unknown>;
  vignettes?: VignetteAnalyse[];
  usage?: Record<string, unknown>;
  motifEchec?: string | null;
}

/**
 * Met à jour une analyse — seulement si elle est encore ouverte.
 *
 * Le `.in('etat', ETATS_ACTIFS)` n'est pas une politesse : sans lui, une
 * reprise tardive écraserait un résultat déjà consigné, et un `reussie`
 * pourrait redevenir `en_cours`. Une analyse close ne se rouvre pas ; on en
 * démarre une nouvelle version.
 *
 * `updated_at` est posé ici parce que la table n'a pas de déclencheur — c'est
 * le choix de M3-A, conservé : un déclencheur invisible se cherche longtemps
 * le jour où une colonne bouge sans qu'on comprenne pourquoi.
 */
export async function majAnalyse(
  userId: string, analyseId: string, patch: MajAnalyse,
): Promise<ResultatAnalyse> {
  const colonnes: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.etat !== undefined) colonnes.etat = patch.etat;
  if (patch.etape !== undefined) colonnes.etape = patch.etape;
  if (patch.fournisseurs !== undefined) colonnes.fournisseurs = patch.fournisseurs;
  if (patch.dureeSecondes !== undefined) colonnes.duree_secondes = patch.dureeSecondes;
  if (patch.technique !== undefined) colonnes.technique = patch.technique;
  if (patch.resume !== undefined) colonnes.resume = patch.resume;
  if (patch.textesVisibles !== undefined) colonnes.textes_visibles = patch.textesVisibles;
  if (patch.parole !== undefined) colonnes.parole = patch.parole;
  if (patch.audio !== undefined) colonnes.audio = patch.audio;
  if (patch.qualite !== undefined) colonnes.qualite = patch.qualite;
  if (patch.vignettes !== undefined) colonnes.vignettes = patch.vignettes;
  if (patch.usage !== undefined) colonnes.usage = patch.usage;
  if (patch.motifEchec !== undefined) colonnes.motif_echec = patch.motifEchec;

  const { data, error } = await supabaseAdmin
    .from('rush_analyses')
    .update(colonnes)
    .eq('id', analyseId)
    .eq('user_id', userId)
    .in('etat', ['en_attente', 'en_cours'])
    .select(COLONNES_ANALYSE)
    .maybeSingle();

  if (error) {
    if (socleAbsent(error)) return { analyse: null, motif: 'socle_absent' };
    throw new Error(error.message || 'mise a jour d analyse impossible');
  }
  if (!data) {
    // Rien n'a bougé : soit la ligne n'existe pas (ou appartient à un autre),
    // soit elle est close. On distingue les deux, parce que l'appelant ne
    // réagit pas de la même façon.
    const { analyse } = await lireAnalyse(userId, analyseId);
    if (!analyse) return { analyse: null, motif: 'analyse_introuvable' };
    return { analyse, motif: 'analyse_close' };
  }
  return { analyse: analyseDepuisLigne(data as Record<string, unknown>), motif: null };
}
