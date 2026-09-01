/**
 * M3-G — LA PERSISTANCE DES PLANS DE MONTAGE.
 *
 * Calqué sur `clip-service.ts`, dont il reprend les gardes : idempotence
 * portée par un index unique EN BASE, panne de lecture jamais traduite en
 * valeur par défaut, propriété prouvée par la clé étrangère composite.
 *
 * ⚠️ UNE DIFFÉRENCE ASSUMÉE AVEC M3-F : PAS D'ÉTAT, PAS DE VERSION ACTIVE.
 *
 * M3-F crée sa ligne AVANT de travailler parce qu'il lance ffmpeg derrière la
 * réponse : sans ligne, un processus tué ne laisserait aucune trace. M3-G ne
 * lance rien — le plan est calculé en mémoire, en quelques microsecondes, et
 * la ligne n'est écrite qu'une fois la décision prise. Il n'y a donc ni état
 * `en_cours`, ni péremption, ni reprise : une insertion qui échoue ne laisse
 * rien derrière elle.
 *
 * ⚠️ AUCUN DÉBIT. `usage` est renseigné, jamais facturé. Ce module n'importe
 * pas `@/lib/credits`, et un test le vérifie.
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import {
  formatValide, planValide,
  type FormatMontage, type IdentitePlan, type MontagePlan, type PlanMontage,
} from './montage-contrat';

// ⚠️ UN SEUL LITTÉRAL, JAMAIS UNE CONCATÉNATION. `supabase-js` analyse cette
// chaîne AU NIVEAU DES TYPES ; un `+` la ramène à `string`, et le client rend
// alors `ParserError` au lieu de la ligne.
export const COLONNES_PLAN = 'id, user_id, clip_set_id, clip_set_version, candidate_set_id, analysis_id, algorithme, methode_materialisation, algorithme_plan, format, duree_cible_secondes, version, largeur_cible, hauteur_cible, fps, plans, duree_totale_secondes, ecart_secondes, clips_ecartes, usage, created_at, updated_at';

export type MotifPersistancePlan = 'socle_absent' | 'plan_concurrent';

/** 42P01 / PGRST205 : la migration M3-G n'est pas appliquée. */
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

function nombre(v: unknown, defaut = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : defaut;
}

/**
 * Relit une ligne en objet de domaine.
 *
 * ⚠️ LES PLANS SONT REVALIDÉS UN À UN. La base accepte n'importe quel `jsonb`
 * conforme au `check` ; M3-H, lui, demande une clé, un compartiment et un
 * rectangle. Un plan informe passerait la persistance et casserait au rendu.
 */
export function planDepuisLigne(row: Record<string, unknown>): MontagePlan {
  const bruts = Array.isArray(row.plans) ? row.plans : [];
  const plans = bruts.filter(planValide) as PlanMontage[];
  const format = formatValide(row.format) ? row.format : ('9:16' as FormatMontage);

  return {
    id: String(row.id),
    userId: String(row.user_id),
    clipSetId: String(row.clip_set_id),
    clipSetVersion: nombre(row.clip_set_version, 1),
    candidateSetId: String(row.candidate_set_id),
    analysisId: String(row.analysis_id),
    algorithme: typeof row.algorithme === 'string' ? row.algorithme : '',
    methodeMaterialisation: typeof row.methode_materialisation === 'string'
      ? row.methode_materialisation : '',
    algorithmePlan: typeof row.algorithme_plan === 'string' ? row.algorithme_plan : '',
    format,
    dureeCibleSecondes: nombre(row.duree_cible_secondes),
    version: nombre(row.version, 1),
    largeurCible: nombre(row.largeur_cible),
    hauteurCible: nombre(row.hauteur_cible),
    fps: nombre(row.fps, 30),
    plans,
    dureeTotaleSecondes: nombre(row.duree_totale_secondes),
    ecartSecondes: nombre(row.ecart_secondes),
    clipsEcartes: nombre(row.clips_ecartes),
    usage: typeof row.usage === 'object' && row.usage !== null
      ? row.usage as Record<string, unknown> : {},
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

export interface ContenuPlan {
  largeurCible: number;
  hauteurCible: number;
  fps: number;
  plans: PlanMontage[];
  dureeTotaleSecondes: number;
  ecartSecondes: number;
  clipsEcartes: number;
  usage: Record<string, unknown>;
}

/**
 * Cherche un plan d'identité STRICTEMENT identique.
 *
 * ⚠️ SEPT COLONNES, ET CHACUNE POUR UNE RAISON.
 *
 * Le jeu de clips et sa version disent SUR QUELS OCTETS. `algorithme` dit
 * comment les bornes ont été décidées, `methode_materialisation` comment les
 * octets ont été produits, `algorithme_plan` comment le montage a été décidé.
 * Le format et la durée cible disent CE QUI A ÉTÉ DEMANDÉ — les omettre
 * aurait ressorti le 9:16 de vingt-cinq secondes à qui demande ensuite un
 * 16:9 d'une minute, sans que rien ne le signale.
 */
export async function lirePlanIdentique(
  userId: string, identite: IdentitePlan,
): Promise<{ plan: MontagePlan | null; motif: MotifPersistancePlan | null }> {
  const { data, error } = await supabaseAdmin
    .from('rush_montage_plans')
    .select(COLONNES_PLAN)
    .eq('user_id', userId)
    .eq('clip_set_id', identite.clipSetId)
    .eq('clip_set_version', identite.clipSetVersion)
    .eq('algorithme', identite.algorithme)
    .eq('methode_materialisation', identite.methodeMaterialisation)
    .eq('algorithme_plan', identite.algorithmePlan)
    .eq('format', identite.format)
    .eq('duree_cible_secondes', identite.dureeCibleSecondes)
    .limit(1)
    .maybeSingle();

  if (error) {
    if (socleAbsent(error)) return { plan: null, motif: 'socle_absent' };
    throw new Error(error.message || 'lecture de plan impossible');
  }
  if (!data) return { plan: null, motif: null };
  return { plan: planDepuisLigne(data as Record<string, unknown>), motif: null };
}

/**
 * Écrit le plan, ou rend le refus de la base.
 *
 * ⚠️ AUCUN `select` PRÉALABLE NE PROTÈGE CETTE INSERTION. Deux requêtes
 * concurrentes passeraient toutes deux un `if (existant) return` avant que
 * l'une n'ait écrit, et deux plans identiques coexisteraient. C'est
 * `rush_montage_plans_identite_unique` qui refuse la seconde, et lui seul.
 * Le refus se traduit alors en relecture, jamais en erreur.
 */
export async function creerPlan(
  userId: string, identite: IdentitePlan, contenu: ContenuPlan,
): Promise<{ plan: MontagePlan | null; motif: MotifPersistancePlan | null }> {
  const { data: derniere, error: erreurLecture } = await supabaseAdmin
    .from('rush_montage_plans')
    .select('version')
    .eq('clip_set_id', identite.clipSetId)
    .eq('user_id', userId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (erreurLecture) {
    if (socleAbsent(erreurLecture)) return { plan: null, motif: 'socle_absent' };
    // ⚠️ NE PAS retomber à la version 1 : une panne de lecture ne dit rien sur
    // ce qui existe, et le refus d'insertion serait traduit en « ce plan
    // existe déjà » — un diagnostic FAUX pour une panne d'infrastructure.
    throw new Error(erreurLecture.message || 'lecture de la version impossible');
  }
  const version = derniere && typeof (derniere as { version?: unknown }).version === 'number'
    ? (derniere as { version: number }).version + 1 : 1;

  const { data, error } = await supabaseAdmin
    .from('rush_montage_plans')
    .insert({
      user_id: userId,
      clip_set_id: identite.clipSetId,
      clip_set_version: identite.clipSetVersion,
      candidate_set_id: identite.candidateSetId,
      analysis_id: identite.analysisId,
      algorithme: identite.algorithme,
      methode_materialisation: identite.methodeMaterialisation,
      algorithme_plan: identite.algorithmePlan,
      format: identite.format,
      duree_cible_secondes: identite.dureeCibleSecondes,
      version,
      largeur_cible: contenu.largeurCible,
      hauteur_cible: contenu.hauteurCible,
      fps: contenu.fps,
      plans: contenu.plans,
      duree_totale_secondes: contenu.dureeTotaleSecondes,
      ecart_secondes: contenu.ecartSecondes,
      clips_ecartes: contenu.clipsEcartes,
      usage: contenu.usage,
    })
    .select(COLONNES_PLAN)
    .maybeSingle();

  if (error) {
    if (socleAbsent(error)) return { plan: null, motif: 'socle_absent' };
    if (violationUnicite(error)) return { plan: null, motif: 'plan_concurrent' };
    // ⚠️ 23503 : la clé étrangère composite a refusé. Le jeu de clips
    // n'existe pas, ou il appartient à quelqu'un d'autre. La base l'a établi,
    // pas un `if` que l'on aurait pu oublier d'écrire.
    throw new Error(error.message || 'creation de plan impossible');
  }
  if (!data) return { plan: null, motif: null };
  return { plan: planDepuisLigne(data as Record<string, unknown>), motif: null };
}

/** Un plan par son identifiant, filtré par propriétaire DANS la requête. */
export async function lirePlanParId(
  userId: string, planId: string,
): Promise<{ plan: MontagePlan | null; motif: MotifPersistancePlan | null }> {
  const { data, error } = await supabaseAdmin
    .from('rush_montage_plans')
    .select(COLONNES_PLAN)
    .eq('id', planId)
    // Le filtre de propriété est ICI : le plan d'autrui ne revient pas, donc
    // l'appelant n'a rien à décider.
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    if (socleAbsent(error)) return { plan: null, motif: 'socle_absent' };
    throw new Error(error.message || 'lecture de plan impossible');
  }
  if (!data) return { plan: null, motif: null };
  return { plan: planDepuisLigne(data as Record<string, unknown>), motif: null };
}
