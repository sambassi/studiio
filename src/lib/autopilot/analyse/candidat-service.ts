/**
 * M3-C — LA PERSISTANCE DES GÉNÉRATIONS DE CANDIDATS.
 *
 * Calqué sur `service.ts`, dont il reprend les trois décisions structurantes :
 * la ligne est créée AVANT tout travail, l'idempotence est portée par un
 * index unique partiel EN BASE, et une panne de lecture ne retombe jamais sur
 * une valeur par défaut.
 *
 * ⚠️ AUCUN DÉBIT. `usage` est renseigné, jamais facturé. Ce module n'importe
 * pas `@/lib/credits`, et un test le vérifie.
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import { MOTIF_ECHEC_MAX } from './candidat-contrat';
import { candidatValide, type CandidatMontage } from './candidat-contrat';

/** Le même vocabulaire d'états que `rush_analyses`, et pour la même raison. */
export const ETATS_GENERATION = [
  'en_attente', 'en_cours', 'reussie', 'echouee', 'annulee',
] as const;
export type EtatGeneration = (typeof ETATS_GENERATION)[number];

export const ETATS_GENERATION_ACTIFS: readonly EtatGeneration[] = ['en_attente', 'en_cours'];

export function etatGenerationValide(v: unknown): v is EtatGeneration {
  return typeof v === 'string' && (ETATS_GENERATION as readonly string[]).includes(v);
}

// ⚠️ UN SEUL LITTÉRAL, JAMAIS UNE CONCATÉNATION. `supabase-js` analyse cette
// chaîne AU NIVEAU DES TYPES ; un `+` la ramène à `string`, et le client rend
// alors `GenericStringError` au lieu de la ligne. Même forme que
// `COLONNES_ANALYSE`, et pour cette raison précise.
export const COLONNES_GENERATION = 'id, analysis_id, rush_id, user_id, version, etat, etape, fournisseurs, candidats, usage, motif_echec, created_at, updated_at';

export interface GenerationCandidats {
  id: string;
  analysisId: string;
  rushId: string;
  userId: string;
  version: number;
  etat: EtatGeneration;
  etape: 'candidats' | null;
  fournisseurs: Record<string, { fournisseur: string; modele: string | null }>;
  candidats: CandidatMontage[];
  usage: Record<string, unknown>;
  motifEchec: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 42P01 / PGRST205 : la migration M3-C n'est pas appliquée. */
function socleAbsent(erreur: { code?: string; message?: string } | null): boolean {
  if (!erreur) return false;
  const code = erreur.code ?? '';
  const message = (erreur.message ?? '').toLowerCase();
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST202'
    || message.includes('does not exist') || message.includes('schema cache');
}

/** Violation d'unicité : c'est un refus attendu, pas une panne. */
function violationUnicite(erreur: { code?: string; message?: string } | null): boolean {
  if (!erreur) return false;
  const message = (erreur.message ?? '').toLowerCase();
  return erreur.code === '23505' || message.includes('duplicate key');
}

/**
 * Relit une ligne en objet de domaine.
 *
 * ⚠️ LES CANDIDATS SONT REVALIDÉS UN À UN. La base accepte n'importe quel
 * `jsonb` ; l'écran, lui, affiche des nombres. Un candidat informe passerait
 * la persistance et casserait à l'affichage — on l'écarte ici, silencieusement
 * pour l'écran mais sans jamais le compter comme valide.
 */
export function generationDepuisLigne(row: Record<string, unknown>): GenerationCandidats {
  const brut = Array.isArray(row.candidats) ? row.candidats : [];
  const etat = etatGenerationValide(row.etat) ? row.etat : 'echouee';
  return {
    id: String(row.id),
    analysisId: String(row.analysis_id),
    rushId: String(row.rush_id),
    userId: String(row.user_id),
    version: typeof row.version === 'number' ? row.version : 1,
    etat,
    etape: row.etape === 'candidats' ? 'candidats' : null,
    fournisseurs: (typeof row.fournisseurs === 'object' && row.fournisseurs !== null
      ? row.fournisseurs : {}) as GenerationCandidats['fournisseurs'],
    candidats: brut.filter(candidatValide),
    usage: (typeof row.usage === 'object' && row.usage !== null
      ? row.usage : {}) as Record<string, unknown>,
    motifEchec: typeof row.motif_echec === 'string' ? row.motif_echec : null,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

export type MotifGeneration =
  | 'socle_absent'
  | 'generation_active_existante';

export interface ResultatGeneration {
  generation: GenerationCandidats | null;
  motif: MotifGeneration | null;
}

/**
 * Crée une génération, ou refuse.
 *
 * ⚠️ LA GARANTIE EST EN BASE, PAS ICI. Aucun `select` préalable n'autorise
 * cette insertion : deux requêtes concurrentes passeraient toutes deux un
 * `if (existing) return` avant que l'une n'ait écrit. C'est
 * `rush_candidate_sets_active_unique` qui refuse la seconde, et lui seul.
 */
export async function creerGeneration(
  userId: string, analysisId: string, rushId: string,
): Promise<ResultatGeneration> {
  // La version suit ce qui existe. Si deux appels simultanés calculent le
  // même numéro, l'index unique en refuse un — c'est le comportement voulu.
  const { data: derniere, error: erreurLecture } = await supabaseAdmin
    .from('rush_candidate_sets')
    .select('version')
    .eq('analysis_id', analysisId)
    .eq('user_id', userId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (erreurLecture) {
    if (socleAbsent(erreurLecture)) return { generation: null, motif: 'socle_absent' };
    // ⚠️ NE PAS retomber à la version 1. Une panne de lecture ne dit rien sur
    // ce qui existe ; repartir à 1 ferait échouer l'insertion sur l'index de
    // version, et ce refus serait traduit en « une génération tourne déjà » —
    // un diagnostic FAUX pour une panne d'infrastructure.
    throw new Error(erreurLecture.message || 'lecture de la version impossible');
  }
  const version = derniere && typeof (derniere as { version?: unknown }).version === 'number'
    ? (derniere as { version: number }).version + 1 : 1;

  const { data, error } = await supabaseAdmin
    .from('rush_candidate_sets')
    .insert({
      analysis_id: analysisId,
      rush_id: rushId,
      user_id: userId,
      version,
      // L'état et l'étape sont décidés ICI, jamais reçus.
      etat: 'en_attente' as EtatGeneration,
      etape: null,
    })
    .select(COLONNES_GENERATION)
    .maybeSingle();

  if (error) {
    if (socleAbsent(error)) return { generation: null, motif: 'socle_absent' };
    if (violationUnicite(error)) {
      // Deux index peuvent refuser, et les deux disent la même chose à
      // l'utilisateur : une génération de cette analyse est déjà en cours.
      return { generation: null, motif: 'generation_active_existante' };
    }
    throw new Error(error.message || 'creation de generation impossible');
  }
  if (!data) throw new Error('creation sans reponse');
  return { generation: generationDepuisLigne(data as Record<string, unknown>), motif: null };
}

export interface MajGeneration {
  etat?: EtatGeneration;
  etape?: 'candidats' | null;
  fournisseurs?: Record<string, { fournisseur: string; modele: string | null }>;
  candidats?: CandidatMontage[];
  usage?: Record<string, unknown>;
  motifEchec?: string | null;
}

export interface ResultatMaj {
  ok: boolean;
  motif: MotifGeneration | 'non_consigne' | null;
}

/**
 * Met à jour une génération, en garantissant le propriétaire dans le `where`.
 *
 * ⚠️ `eq('user_id', userId)` N'EST PAS DÉCORATIF. Sans lui, un identifiant
 * de génération suffirait à écrire chez autrui — la clé étrangère composite
 * garantit la cohérence à la création, pas l'autorisation d'une mise à jour.
 */
export async function majGeneration(
  userId: string, generationId: string, maj: MajGeneration,
): Promise<ResultatMaj> {
  const champs: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (maj.etat !== undefined) champs.etat = maj.etat;
  if (maj.etape !== undefined) champs.etape = maj.etape;
  if (maj.fournisseurs !== undefined) champs.fournisseurs = maj.fournisseurs;
  if (maj.candidats !== undefined) champs.candidats = maj.candidats;
  if (maj.usage !== undefined) champs.usage = maj.usage;
  if (maj.motifEchec !== undefined) {
    champs.motif_echec = maj.motifEchec === null
      ? null : maj.motifEchec.slice(0, MOTIF_ECHEC_MAX);
  }

  const { data, error } = await supabaseAdmin
    .from('rush_candidate_sets')
    .update(champs)
    .eq('id', generationId)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();

  if (error) {
    if (socleAbsent(error)) return { ok: false, motif: 'socle_absent' };
    throw new Error(error.message || 'mise a jour de generation impossible');
  }
  // Aucune ligne touchée : la génération n'existe pas, ou n'est pas la sienne.
  if (!data) return { ok: false, motif: 'non_consigne' };
  return { ok: true, motif: null };
}

/**
 * Lit la dernière génération d'une analyse — celle que l'écran affiche.
 *
 * Rend `null` sans erreur quand il n'y en a aucune : une analyse sans
 * candidats est l'état normal tant que personne n'a cliqué.
 */
export async function lireDerniereGeneration(
  userId: string, analysisId: string,
): Promise<{ generation: GenerationCandidats | null; motif: MotifGeneration | null }> {
  const { data, error } = await supabaseAdmin
    .from('rush_candidate_sets')
    .select(COLONNES_GENERATION)
    .eq('analysis_id', analysisId)
    .eq('user_id', userId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (socleAbsent(error)) return { generation: null, motif: 'socle_absent' };
    throw new Error(error.message || 'lecture de generation impossible');
  }
  if (!data) return { generation: null, motif: null };
  return {
    generation: generationDepuisLigne(data as Record<string, unknown>),
    motif: null,
  };
}
