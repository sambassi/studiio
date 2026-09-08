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
import {
  empreinteJeuxSources, fusionnerJeuxSources, type JeuSource,
} from './montage-source';
import { UUID } from './clip-contrat';

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

// ---------------------------------------------------------------------------
// Les sources d'un plan — A_7a
// ---------------------------------------------------------------------------

/** Les colonnes de `rush_montage_plan_sources`, ouverte par A_7M. */
export const COLONNES_SOURCES_PLAN =
  'plan_id, user_id, ordinal, clip_set_id, clip_set_version';

/**
 * Les jeux de sources d'un plan, dans l'ordre, dedupliques.
 *
 * ⚠️ DEUX CHEMINS, UN SEUL RESULTAT. Un plan peut porter sa source de deux
 * facons : la colonne scalaire `clip_set_id`, qui existe depuis M3-G, et une
 * ligne dans `rush_montage_plan_sources`, ouverte par A_7M. La migration A_7M
 * ayant BACKFILLE les plans historiques, la quasi-totalite d'entre eux
 * portent maintenant LES DEUX — et disent la meme chose.
 *
 * Les additionner donnerait deux sources la ou il n'y en a qu'une, et un plan
 * a deux sources recoit une empreinte, bascule sous l'index d'identite
 * multi-rush, et perd les rendus deja reussis qui pointaient vers lui. La
 * fusion n'est donc pas une commodite : c'est ce qui empeche le backfill de
 * casser le passe.
 *
 * ⚠️ `socle_absent` PLUTOT QU'UNE ERREUR. La table n'existe pas tant que la
 * migration n'est pas appliquee, ce qui est le cas EN PRODUCTION au moment ou
 * ce code est ecrit. Le lecteur retombe alors sur la seule source scalaire,
 * exactement comme avant A_7M.
 */
export async function lireSourcesPlan(
  userId: string, plan: Pick<MontagePlan, 'id' | 'clipSetId' | 'clipSetVersion'>,
): Promise<{ sources: JeuSource[]; motif: MotifPersistancePlan | null }> {
  const scalaire: JeuSource | null = plan.clipSetId
    ? { clipSetId: plan.clipSetId, clipSetVersion: plan.clipSetVersion }
    : null;

  const { data, error } = await supabaseAdmin
    .from('rush_montage_plan_sources')
    .select(COLONNES_SOURCES_PLAN)
    .eq('plan_id', plan.id)
    // ⚠️ LE COMPTE EST REVALIDE ICI AUSSI. La cle etrangere composite de A_7M
    // garantit qu'une source appartient au meme compte que son plan ; elle ne
    // dispense pas de filtrer, sans quoi un `planId` devine suffirait a lire
    // la composition du montage d'autrui.
    .eq('user_id', userId)
    .order('ordinal', { ascending: true });

  if (error) {
    if (socleAbsent(error)) {
      return { sources: scalaire ? [scalaire] : [], motif: 'socle_absent' };
    }
    throw new Error(error.message || 'lecture des sources impossible');
  }

  const lignes: JeuSource[] = (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      clipSetId: String(row.clip_set_id),
      clipSetVersion: nombre(row.clip_set_version, 1),
    };
  });
  return { sources: fusionnerJeuxSources(scalaire, lignes), motif: null };
}

/**
 * Ecrit les sources d'un plan, dans l'ordre donne.
 *
 * ⚠️ UN SEUL `insert`, ET C'EST LA SEULE ATOMICITE QUE POSTGREST OFFRE. Un
 * `insert` portant un tableau est UNE instruction, donc une transaction :
 * trois sources entrent toutes les trois ou aucune. Un plan ne peut donc pas
 * se retrouver avec deux sources sur trois.
 *
 * ⚠️ CE QUI N'EST PAS ATOMIQUE, ET QUI EST DIT PLUTOT QUE BRICOLE : la
 * creation du PLAN et l'ecriture de ses SOURCES sont deux appels. Les rendre
 * indivisibles demanderait une fonction SQL `rpc`, donc une migration — que
 * ce lot n'ouvre pas, parce qu'il ne cree encore AUCUN plan multi-rush.
 * Enchainer deux requetes en faisant comme si elles etaient transactionnelles
 * serait la version silencieuse du meme probleme. A_7b, qui composera
 * reellement des plans multi-sources, devra trancher ce point-la.
 *
 * `ordinal` suit l'ordre du tableau : c'est lui qui distingue `A,B,C` de
 * `B,A,C`, et l'empreinte des sources en depend.
 */
export async function ecrireSourcesPlan(
  userId: string, planId: string, sources: readonly JeuSource[],
): Promise<{ ecrites: number; motif: MotifPersistancePlan | null }> {
  if (sources.length === 0) return { ecrites: 0, motif: null };

  const lignes = sources.map((s, i) => ({
    plan_id: planId,
    user_id: userId,
    ordinal: i,
    clip_set_id: s.clipSetId,
    clip_set_version: s.clipSetVersion,
  }));

  const { error } = await supabaseAdmin
    .from('rush_montage_plan_sources')
    .insert(lignes);

  if (error) {
    if (socleAbsent(error)) return { ecrites: 0, motif: 'socle_absent' };
    if (violationUnicite(error)) return { ecrites: 0, motif: 'plan_concurrent' };
    throw new Error(error.message || 'ecriture des sources impossible');
  }
  return { ecrites: lignes.length, motif: null };
}

// ---------------------------------------------------------------------------
// La creation ATOMIQUE d'un plan multi-rush — A_7B0
// ---------------------------------------------------------------------------

/**
 * ⚠️ DEUX SOURCES AU MINIMUM, ET LE MONO-RUSH GARDE SON CHEMIN.
 *
 * Faire passer aussi les plans a une source par la RPC aurait l'air d'une
 * unification ; ce serait un changement de comportement pour tout le parc. Un
 * plan mono-rush laisse `source_set_fingerprint` a NULL et vit sous l'index
 * d'identite historique ; lui donner une empreinte le ferait basculer sous
 * l'index multi-rush, et ses MP4 deja rendus deviendraient introuvables.
 */
export const SOURCES_MULTI_RUSH_MIN = 2;

/**
 * ⚠️ 64 PARCE QUE `ordinal` S'ARRETE A 63 — c'est la borne MECANIQUE posee par
 * A_7M, pas une politique produit. Le nombre de rushes qu'un montage a le
 * droit d'agreger sera decide par A_7b, plus bas que cette limite, et pourra
 * evoluer sans toucher a la base.
 */
export const SOURCES_MULTI_RUSH_MAX = 64;

/** Ce que la RPC peut repondre. Des VALEURS, jamais des exceptions. */
export type IssuePlanMultiRush =
  | 'cree'
  | 'existant'
  | 'parametres_invalides'
  | 'empreinte_invalide'
  | 'sources_insuffisantes'
  | 'sources_trop_nombreuses'
  | 'source_dupliquee'
  | 'source_inconnue'
  | 'identite_conflictuelle'
  /** Refuse cote serveur : les sources du JSON ne sont pas celles annoncees. */
  | 'sources_incoherentes';

/**
 * L'identite d'un plan multi-rush.
 *
 * ⚠️ LES QUATRE SCALAIRES HISTORIQUES N'Y SONT PAS. `clipSetId`,
 * `clipSetVersion`, `candidateSetId` et `analysisId` decrivent UNE source ;
 * un plan qui en a plusieurs ne peut en designer une sans mentir. A_7M les a
 * rendus nullables pour cette raison, et la liste ordonnee des sources — via
 * son empreinte — prend leur place dans l'identite.
 */
export interface IdentitePlanMultiRush {
  algorithme: string;
  methodeMaterialisation: string;
  algorithmePlan: string;
  format: FormatMontage;
  dureeCibleSecondes: number;
}

export interface CreationPlanMultiRush {
  plan: MontagePlan | null;
  issue: IssuePlanMultiRush;
  /** Les sources telles qu'elles seront persistees, dans l'ordre. */
  sources: JeuSource[];
  empreinte: string | null;
  motif: MotifPersistancePlan | null;
}

/** 42883 / PGRST202 : la migration A_7B0 n'est pas appliquee. */
function fonctionAbsente(erreur: { code?: string; message?: string } | null): boolean {
  if (!erreur) return false;
  const message = (erreur.message ?? '').toLowerCase();
  return erreur.code === '42883' || erreur.code === 'PGRST202'
    || message.includes('could not find the function')
    || message.includes('does not exist');
}

/**
 * Cree un plan MULTI-RUSH et ses sources ordonnees, indivisiblement.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ POURQUOI UNE RPC PLUTOT QUE DEUX APPELS
 * ---------------------------------------------------------------------------
 *
 * `creerPlan` puis `ecrireSourcesPlan` sont chacun atomiques, et ensemble ne
 * le sont pas. Entre les deux, le processus peut mourir. Il resterait un plan
 * portant une `source_set_fingerprint` qui decrit une matiere absente de la
 * base — indiscernable, pour A_7M, d'un plan AMPUTE par la suppression d'un
 * jeu de clips. Ce n'est donc pas « un plan incomplet », c'est un plan qui
 * ressemble a un plan corrompu.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ LE PARTAGE DU TRAVAIL AVEC LA BASE
 * ---------------------------------------------------------------------------
 *
 *   ICI            forme des sources, doublons, coherence avec le JSON du
 *                  plan, et le CALCUL de l'empreinte — un seul algorithme,
 *                  celui d'A_7a, jamais reecrit en SQL ;
 *   DANS LA RPC    propriete, version reelle du jeu, unicite d'identite,
 *                  ordre, et l'ATOMICITE, qui n'existe qu'en base.
 *
 * Valider ici ce qui peut l'etre evite un aller-retour et rend des refus
 * nommes ; cela ne remplace jamais les cles etrangeres, qui restent
 * l'autorite.
 */
export async function creerPlanMultiRushAtomique(
  userId: string,
  sources: readonly JeuSource[],
  identite: IdentitePlanMultiRush,
  contenu: ContenuPlan,
): Promise<CreationPlanMultiRush> {
  const vide = (issue: IssuePlanMultiRush): CreationPlanMultiRush =>
    ({ plan: null, issue, sources: [...sources], empreinte: null, motif: null });

  if (sources.length < SOURCES_MULTI_RUSH_MIN) return vide('sources_insuffisantes');
  if (sources.length > SOURCES_MULTI_RUSH_MAX) return vide('sources_trop_nombreuses');

  for (const s of sources) {
    if (typeof s.clipSetId !== 'string' || !UUID.test(s.clipSetId)) {
      return vide('parametres_invalides');
    }
    if (!Number.isInteger(s.clipSetVersion) || s.clipSetVersion < 1) {
      return vide('parametres_invalides');
    }
  }

  /* ⚠️ UN JEU N'APPARAIT QU'UNE FOIS. Reutiliser plusieurs passages du meme
     rush est le cas NORMAL, et cela s'ecrit par plusieurs SEGMENTS pointant la
     meme source — jamais par deux lignes de source. Deux lignes rendraient
     l'empreinte dependante d'un doublon sans signification, et la meme video
     aurait deux identites selon la facon dont on l'a ecrite. */
  const cles = sources.map((s) => s.clipSetId);
  if (new Set(cles).size !== cles.length) return vide('source_dupliquee');

  /* ⚠️ LE PLAN ET SES SOURCES DOIVENT DIRE LA MEME CHOSE — §26.
     La table dit la MATIERE, le `jsonb` dit le DECOUPAGE. Si un segment cite
     un jeu absent de la liste, le plan reclame au rendu des octets que la
     table ne declare pas ; et si une source declaree n'est employee par aucun
     segment, l'empreinte decrit une matiere plus large que le film — deux
     montages identiques recevraient deux identites. La verification se fait
     ICI, avant la RPC : elle demande de comprendre le contrat des segments,
     et le SQL n'a pas a le connaitre.

     Un plan dont AUCUN segment ne porte de provenance est laisse passer :
     c'est la forme legacy d'A_7a, et `normaliserPlanSourceAware` la resout a
     la lecture. Un plan MULTI-RUSH ne peut evidemment pas etre dans ce cas —
     mais le refuser ici en le nommant « incoherent » serait un faux
     diagnostic. */
  const citees = new Set<string>();
  for (const p of contenu.plans) {
    if (!p.source) continue;
    citees.add(p.source.clipSetId);
  }
  if (citees.size > 0) {
    const declarees = new Set(cles);
    for (const c of citees) if (!declarees.has(c)) return vide('sources_incoherentes');
    for (const d of declarees) if (!citees.has(d)) return vide('sources_incoherentes');
  }

  /* ⚠️ UNE SEULE VERITE POUR L'EMPREINTE, ET ELLE EST ICI. La canonicalisation
     d'A_7a n'est PAS reecrite en PL/pgSQL : deux implementations devant rester
     d'accord pour toujours finiraient par diverger sur un separateur, et le
     meme montage serait alors recalcule et refacture indefiniment. */
  const empreinte = empreinteJeuxSources(sources);
  if (!empreinte) return vide('empreinte_invalide');

  const { data, error } = await supabaseAdmin.rpc('creer_plan_montage_multi_rush', {
    p_user_id: userId,
    p_sources: sources.map((s) => ({
      clip_set_id: s.clipSetId, clip_set_version: s.clipSetVersion,
    })),
    p_source_set_fingerprint: empreinte,
    p_algorithme: identite.algorithme,
    p_methode_materialisation: identite.methodeMaterialisation,
    p_algorithme_plan: identite.algorithmePlan,
    p_format: identite.format,
    p_duree_cible_secondes: identite.dureeCibleSecondes,
    p_largeur_cible: contenu.largeurCible,
    p_hauteur_cible: contenu.hauteurCible,
    p_fps: contenu.fps,
    p_plans: contenu.plans,
    p_duree_totale_secondes: contenu.dureeTotaleSecondes,
    p_ecart_secondes: contenu.ecartSecondes,
    p_clips_ecartes: contenu.clipsEcartes,
    p_usage: contenu.usage,
  });

  if (error) {
    /* ⚠️ `socle_absent` PLUTOT QU'UNE PANNE. La migration n'est pas appliquee
       en production au moment ou ce code est ecrit. L'appelant doit pouvoir
       distinguer « la fonction n'existe pas encore » de « la base est
       tombee » — le premier cas se replie sur le chemin mono-rush, le second
       doit remonter. */
    if (fonctionAbsente(error) || socleAbsent(error)) {
      return { plan: null, issue: 'parametres_invalides', sources: [...sources], empreinte, motif: 'socle_absent' };
    }
    throw new Error(error.message || 'creation de plan multi-rush impossible');
  }

  const ligne = Array.isArray(data) ? data[0] : data;
  const issue = (ligne && typeof (ligne as { issue?: unknown }).issue === 'string'
    ? (ligne as { issue: string }).issue : 'parametres_invalides') as IssuePlanMultiRush;
  const planId = ligne && typeof (ligne as { plan_id?: unknown }).plan_id === 'string'
    ? (ligne as { plan_id: string }).plan_id : null;

  if (!planId) {
    return { plan: null, issue, sources: [...sources], empreinte, motif: null };
  }

  /* La RPC rend l'identifiant ; le modele canonique se relit par le chemin
     normal, filtre par proprietaire DANS la requete comme partout ailleurs. */
  const relu = await lirePlanParId(userId, planId);
  return { plan: relu.plan, issue, sources: [...sources], empreinte, motif: relu.motif };
}

/**
 * LES SOURCES DES DERNIERS MONTAGES — A_7b.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠️ CETTE DONNÉE EXISTE DÉJÀ, ET C'EST LE BACKFILL D'A_7M QUI LA DONNE
 * ═════════════════════════════════════════════════════════════════════════
 *
 * `rush_montage_plan_sources` porte une ligne par source de chaque plan, y
 * compris pour les plans mono-rush historiques — A_7M leur a écrit la source
 * qu'ils portaient déjà implicitement. La récence inter-vidéos n'est donc pas
 * une promesse en l'air : elle se lit sur le parc réel dès la migration
 * appliquée, sans attendre le premier montage multi-rush.
 *
 * ⚠️ BORNÉE, JAMAIS UN SCAN. Au-delà d'une dizaine de vidéos, ce qui a servi
 * ne dit plus rien de ce qu'on vient de voir, et lire tout l'historique
 * coûterait une requête qui grandit avec le compte pour un signal mort.
 *
 * ⚠️ UNE PANNE DE LECTURE N'EST PAS « AUCUN HISTORIQUE ». Rendre un tableau
 * vide sur une erreur ferait croire à la diversité que toutes les sources sont
 * fraîches, et le même rush reviendrait à chaque cycle sans que rien ne le
 * signale. Le motif remonte, et l'appelant décide.
 *
 * Rendu du plus RÉCENT au plus ancien — l'ordre qu'attend
 * `penaliteRecenceSource`.
 */
export async function lireHistoriqueSources(
  userId: string, limite = 10,
): Promise<{ historique: string[][]; motif: MotifPersistancePlan | null }> {
  const n = Math.max(1, Math.min(50, Math.floor(limite)));

  const { data: plans, error: erreurPlans } = await supabaseAdmin
    .from('rush_montage_plans')
    .select('id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(n);

  if (erreurPlans) {
    if (socleAbsent(erreurPlans)) return { historique: [], motif: 'socle_absent' };
    throw new Error(erreurPlans.message || 'lecture de l historique impossible');
  }

  const ids = (plans ?? []).map((p) => String((p as { id: unknown }).id));
  if (ids.length === 0) return { historique: [], motif: null };

  const { data: lignes, error } = await supabaseAdmin
    .from('rush_montage_plan_sources')
    .select(COLONNES_SOURCES_PLAN)
    // ⚠️ LE COMPTE EST REFILTRÉ ICI AUSSI : la clé étrangère composite garantit
    // l'appartenance, elle ne dispense pas de la demander.
    .eq('user_id', userId)
    .in('plan_id', ids);

  if (error) {
    if (socleAbsent(error)) return { historique: [], motif: 'socle_absent' };
    throw new Error(error.message || 'lecture des sources impossible');
  }

  const parPlan = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const l of lignes ?? []) {
    const row = l as Record<string, unknown>;
    parPlan.get(String(row.plan_id))?.push(String(row.clip_set_id));
  }
  /* L'ordre des plans fait foi : `ids` vient déjà du plus récent au plus
     ancien. Un plan sans ligne de source garde son rang, vide — il occupe une
     place dans la fenêtre de récence, et l'écraser décalerait les âges. */
  return { historique: ids.map((id) => parPlan.get(id) ?? []), motif: null };
}
