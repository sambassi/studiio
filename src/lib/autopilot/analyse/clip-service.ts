/**
 * M3-F — LA PERSISTANCE DES JEUX DE CLIPS.
 *
 * Calqué sur `candidat-service.ts` et `transcription-service.ts`, dont il
 * reprend les trois décisions structurantes : la ligne est créée AVANT tout
 * travail, l'idempotence est portée par un index unique partiel EN BASE, et
 * une panne de lecture ne retombe jamais sur une valeur par défaut.
 *
 * ⚠️ AUCUN DÉBIT. `usage` est renseigné, jamais facturé. Ce module n'importe
 * pas `@/lib/credits`, et un test le vérifie.
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import {
  clipValide, etatSetValide, etapeSetValide, seuilPeremptionSet,
  type ClipMaterialise, type ClipSet, type EtapeSet, type EtatSet,
  type IdentiteClipSet,
} from './clip-contrat';

/** Le motif écrit en base quand un jeu est fermé par péremption. */
export const MOTIF_SET_INTERROMPU = 'set_interrompu';

export const ETATS_ACTIFS: readonly EtatSet[] = ['en_attente', 'en_cours'];

// ⚠️ UN SEUL LITTÉRAL, JAMAIS UNE CONCATÉNATION. `supabase-js` analyse cette
// chaîne AU NIVEAU DES TYPES ; un `+` la ramène à `string`, et le client rend
// alors `ParserError` au lieu de la ligne.
export const COLONNES_SET = 'id, user_id, candidate_set_id, candidate_set_version, rush_id, analysis_id, transcription_id, transcription_version, algorithme, version, etat, etape, clips, usage, motif_echec, created_at, started_at, completed_at, updated_at';

/** 42P01 / PGRST205 : la migration M3-F n'est pas appliquée. */
function socleAbsent(erreur: { code?: string; message?: string } | null): boolean {
  if (!erreur) return false;
  const code = erreur.code ?? '';
  const message = (erreur.message ?? '').toLowerCase();
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST202'
    || message.includes('does not exist') || message.includes('schema cache');
}

/** Violation d'unicité : un refus attendu, pas une panne. */
function violationUnicite(erreur: { code?: string; message?: string } | null): boolean {
  if (!erreur) return false;
  const message = (erreur.message ?? '').toLowerCase();
  return erreur.code === '23505' || message.includes('duplicate key');
}

/**
 * Relit une ligne en objet de domaine.
 *
 * ⚠️ LES CLIPS SONT REVALIDÉS UN À UN. La base accepte n'importe quel
 * `jsonb` ; l'écran, lui, demande une clé et un compartiment. Un clip informe
 * passerait la persistance et casserait à la lecture.
 */
export function setDepuisLigne(row: Record<string, unknown>): ClipSet {
  const brut = Array.isArray(row.clips) ? row.clips : [];
  const nombre = (v: unknown, defaut: number) => (typeof v === 'number' ? v : defaut);
  return {
    id: String(row.id),
    userId: String(row.user_id),
    candidateSetId: String(row.candidate_set_id),
    candidateSetVersion: nombre(row.candidate_set_version, 1),
    rushId: String(row.rush_id),
    analysisId: String(row.analysis_id),
    transcriptionId: typeof row.transcription_id === 'string' ? row.transcription_id : null,
    transcriptionVersion: typeof row.transcription_version === 'number'
      ? row.transcription_version : null,
    algorithme: typeof row.algorithme === 'string' ? row.algorithme : '',
    version: nombre(row.version, 1),
    etat: etatSetValide(row.etat) ? row.etat : 'echouee',
    etape: etapeSetValide(row.etape) ? row.etape : null,
    clips: brut.filter(clipValide),
    usage: (typeof row.usage === 'object' && row.usage !== null
      ? row.usage : {}) as Record<string, unknown>,
    motifEchec: typeof row.motif_echec === 'string' ? row.motif_echec : null,
    createdAt: String(row.created_at ?? ''),
    startedAt: typeof row.started_at === 'string' ? row.started_at : null,
    completedAt: typeof row.completed_at === 'string' ? row.completed_at : null,
    updatedAt: String(row.updated_at ?? ''),
  };
}

export type MotifPersistanceSet = 'socle_absent' | 'set_actif_existant';

/**
 * Ferme les jeux actifs PÉRIMÉS de ce jeu de candidats.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE PIÈGE QUE CE BLOC FERME
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `rush_clip_sets_active_unique` interdit deux jeux actifs — c'est ce qui
 * empêche deux ffmpeg de partir sur les mêmes octets. Mais un processus tué
 * au mauvais moment laisse sa ligne `en_cours` POUR TOUJOURS, et le jeu de
 * candidats devient définitivement impossible à matérialiser. Le piège s'est
 * présenté sur `rush_analyses`, sur `rush_candidate_sets`, puis sur
 * `rush_transcriptions`.
 *
 * ⚠️ TROIS PRÉCAUTIONS, ET AUCUNE N'EST DÉCORATIVE : `user_id` — une
 * péremption n'autorise pas à écrire chez autrui ; `candidate_set_id` — on ne
 * balaie pas la table au passage ; `created_at < seuil` — un jeu RÉCENT
 * découpe peut-être encore, et le fermer ferait repartir un second ffmpeg
 * pendant le premier.
 */
export async function recupererSetsInterrompus(
  userId: string, candidateSetId: string,
): Promise<{ fermes: number; motif: MotifPersistanceSet | null }> {
  const maintenant = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('rush_clip_sets')
    .update({
      etat: 'echouee' as EtatSet,
      motif_echec: MOTIF_SET_INTERROMPU,
      completed_at: maintenant,
      updated_at: maintenant,
    })
    .eq('user_id', userId)
    .eq('candidate_set_id', candidateSetId)
    .in('etat', ETATS_ACTIFS as unknown as string[])
    .lt('created_at', seuilPeremptionSet())
    .select('id');

  if (error) {
    if (socleAbsent(error)) return { fermes: 0, motif: 'socle_absent' };
    throw new Error(error.message || 'recuperation de jeu impossible');
  }
  return { fermes: Array.isArray(data) ? data.length : 0, motif: null };
}

/**
 * Le jeu RÉUSSI portant exactement cette identité, s'il existe.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ C'EST LA RÈGLE DE RÉUTILISATION, ET ELLE EST DÉLIBÉRÉE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * M3-C et M3-D2 REGÉNÈRENT à la demande, parce qu'un modèle interrogé deux
 * fois peut mieux répondre. M3-F est DÉTERMINISTE : les mêmes bornes sur les
 * mêmes octets produisent le même fichier. Refaire coûterait trente secondes
 * de CPU pour un résultat identique, et changerait les clés de stockage sans
 * qu'aucun besoin ne le demande.
 *
 * Un jeu réussi de même identité est donc RENDU TEL QUEL. Il n'existe aucun
 * `force` ni `regenerate` en v1 : un fichier source différent doit devenir un
 * rush différent en amont, pas un remplacement silencieux d'octets sous la
 * même identité historique.
 */
export async function lireSetReussiIdentique(
  userId: string, identite: IdentiteClipSet,
): Promise<{ set: ClipSet | null; motif: MotifPersistanceSet | null }> {
  const requete = supabaseAdmin
    .from('rush_clip_sets')
    .select(COLONNES_SET)
    .eq('user_id', userId)
    .eq('candidate_set_id', identite.candidateSetId)
    .eq('candidate_set_version', identite.candidateSetVersion)
    .eq('analysis_id', identite.analysisId)
    .eq('rush_id', identite.rushId)
    .eq('algorithme', identite.algorithme)
    .eq('etat', 'reussie');

  // ⚠️ `null` NE SE COMPARE PAS AVEC `eq`. Un rush sans transcription réussie
  // porte `transcription_id` à `null` ; `eq('transcription_id', null)` ne
  // ramènerait jamais rien, et l'on refabriquerait le même jeu à l'infini.
  const filtree = identite.transcriptionId === null
    ? requete.is('transcription_id', null)
    : requete.eq('transcription_id', identite.transcriptionId);

  const { data, error } = await filtree
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (socleAbsent(error)) return { set: null, motif: 'socle_absent' };
    throw new Error(error.message || 'lecture de jeu impossible');
  }
  if (!data) return { set: null, motif: null };
  return { set: setDepuisLigne(data as Record<string, unknown>), motif: null };
}

export interface ResultatCreationSet {
  set: ClipSet | null;
  motif: MotifPersistanceSet | null;
}

/**
 * Crée un jeu, ou refuse.
 *
 * ⚠️ LA GARANTIE EST EN BASE, PAS ICI. Aucun `select` préalable n'autorise
 * cette insertion : deux requêtes concurrentes passeraient toutes deux un
 * `if (existant) return` avant que l'une n'ait écrit, et deux ffmpeg
 * partiraient sur les mêmes octets. C'est `rush_clip_sets_active_unique` qui
 * refuse la seconde, et lui seul.
 */
export async function creerSet(
  userId: string, identite: IdentiteClipSet,
): Promise<ResultatCreationSet> {
  // Les jeux abandonnés de CE jeu de candidats sont fermés d'abord — au seul
  // moment où le blocage gêne quelqu'un, c'est-à-dire quand il redemande.
  const recuperation = await recupererSetsInterrompus(userId, identite.candidateSetId);
  if (recuperation.motif === 'socle_absent') return { set: null, motif: 'socle_absent' };

  const { data: derniere, error: erreurLecture } = await supabaseAdmin
    .from('rush_clip_sets')
    .select('version')
    .eq('candidate_set_id', identite.candidateSetId)
    .eq('user_id', userId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (erreurLecture) {
    if (socleAbsent(erreurLecture)) return { set: null, motif: 'socle_absent' };
    // ⚠️ NE PAS retomber à la version 1 : une panne de lecture ne dit rien sur
    // ce qui existe, et le refus d'insertion serait traduit en « un jeu tourne
    // déjà » — un diagnostic FAUX pour une panne d'infrastructure.
    throw new Error(erreurLecture.message || 'lecture de la version impossible');
  }
  const version = derniere && typeof (derniere as { version?: unknown }).version === 'number'
    ? (derniere as { version: number }).version + 1 : 1;

  const { data, error } = await supabaseAdmin
    .from('rush_clip_sets')
    .insert({
      user_id: userId,
      candidate_set_id: identite.candidateSetId,
      candidate_set_version: identite.candidateSetVersion,
      rush_id: identite.rushId,
      analysis_id: identite.analysisId,
      transcription_id: identite.transcriptionId,
      transcription_version: identite.transcriptionVersion,
      algorithme: identite.algorithme,
      version,
      // L'état et l'étape sont décidés ICI, jamais reçus.
      etat: 'en_attente' as EtatSet,
      etape: null,
    })
    .select(COLONNES_SET)
    .maybeSingle();

  if (error) {
    if (socleAbsent(error)) return { set: null, motif: 'socle_absent' };
    if (violationUnicite(error)) return { set: null, motif: 'set_actif_existant' };
    throw new Error(error.message || 'creation de jeu impossible');
  }
  if (!data) throw new Error('creation sans reponse');
  return { set: setDepuisLigne(data as Record<string, unknown>), motif: null };
}

export interface MajSet {
  etat?: EtatSet;
  etape?: EtapeSet | null;
  clips?: ClipMaterialise[];
  usage?: Record<string, unknown>;
  motifEchec?: string | null;
  demarre?: boolean;
  termine?: boolean;
}

export interface ResultatMajSet {
  ok: boolean;
  motif: MotifPersistanceSet | 'non_consigne' | null;
}

/**
 * Met à jour un jeu, en garantissant le propriétaire dans le `where`.
 *
 * ⚠️ `eq('user_id', userId)` N'EST PAS DÉCORATIF. Sans lui, un identifiant de
 * jeu suffirait à écrire chez autrui — la clé étrangère composite garantit la
 * cohérence à la création, pas l'autorisation d'une mise à jour.
 */
export async function majSet(
  userId: string, setId: string, maj: MajSet,
): Promise<ResultatMajSet> {
  const maintenant = new Date().toISOString();
  const champs: Record<string, unknown> = { updated_at: maintenant };
  if (maj.etat !== undefined) champs.etat = maj.etat;
  if (maj.etape !== undefined) champs.etape = maj.etape;
  if (maj.clips !== undefined) champs.clips = maj.clips;
  if (maj.usage !== undefined) champs.usage = maj.usage;
  if (maj.motifEchec !== undefined) {
    champs.motif_echec = maj.motifEchec === null ? null : maj.motifEchec.slice(0, 200);
  }
  if (maj.demarre) champs.started_at = maintenant;
  if (maj.termine) champs.completed_at = maintenant;

  const { data, error } = await supabaseAdmin
    .from('rush_clip_sets')
    .update(champs)
    .eq('id', setId)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();

  if (error) {
    if (socleAbsent(error)) return { ok: false, motif: 'socle_absent' };
    throw new Error(error.message || 'mise a jour de jeu impossible');
  }
  if (!data) return { ok: false, motif: 'non_consigne' };
  return { ok: true, motif: null };
}

/** Lit UN jeu, désigné par son identifiant. Inconnu et d'autrui rendent `null`. */
export async function lireSetParId(
  userId: string, setId: string,
): Promise<{ set: ClipSet | null; motif: MotifPersistanceSet | null }> {
  const { data, error } = await supabaseAdmin
    .from('rush_clip_sets')
    .select(COLONNES_SET)
    .eq('id', setId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    if (socleAbsent(error)) return { set: null, motif: 'socle_absent' };
    throw new Error(error.message || 'lecture de jeu impossible');
  }
  if (!data) return { set: null, motif: null };
  return { set: setDepuisLigne(data as Record<string, unknown>), motif: null };
}
