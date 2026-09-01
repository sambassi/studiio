/**
 * M3-D2 — LA PERSISTANCE DES TRANSCRIPTIONS.
 *
 * Calqué sur `candidat-service.ts`, dont il reprend les trois décisions
 * structurantes : la ligne est créée AVANT tout travail, l'idempotence est
 * portée par un index unique partiel EN BASE, et une panne de lecture ne
 * retombe jamais sur une valeur par défaut.
 *
 * ⚠️ AUCUN DÉBIT. `usage` est renseigné, jamais facturé. Ce module n'importe
 * pas `@/lib/credits`, et un test le vérifie.
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import {
  MOTIF_ECHEC_MAX, intervalleValide, seuilPeremptionTranscription,
  type IntervalleTexte,
} from './transcription-contrat';

/** Le motif écrit en base quand une transcription est fermée par péremption. */
export const MOTIF_TRANSCRIPTION_INTERROMPUE = 'transcription_interrompue';

/** Le même vocabulaire d'états que `rush_analyses`, et pour la même raison. */
export const ETATS_TRANSCRIPTION = [
  'en_attente', 'en_cours', 'reussie', 'echouee', 'annulee',
] as const;
export type EtatTranscription = (typeof ETATS_TRANSCRIPTION)[number];

export const ETATS_TRANSCRIPTION_ACTIFS: readonly EtatTranscription[] = ['en_attente', 'en_cours'];

export function etatTranscriptionValide(v: unknown): v is EtatTranscription {
  return typeof v === 'string' && (ETATS_TRANSCRIPTION as readonly string[]).includes(v);
}

export const ETAPES_TRANSCRIPTION = ['extraction_audio', 'transcription'] as const;
export type EtapeTranscription = (typeof ETAPES_TRANSCRIPTION)[number];

export function etapeTranscriptionValide(v: unknown): v is EtapeTranscription {
  return typeof v === 'string' && (ETAPES_TRANSCRIPTION as readonly string[]).includes(v);
}

// ⚠️ UN SEUL LITTÉRAL, JAMAIS UNE CONCATÉNATION. `supabase-js` analyse cette
// chaîne AU NIVEAU DES TYPES ; un `+` la ramène à `string`, et le client rend
// alors `GenericStringError` au lieu de la ligne. Même forme que
// `COLONNES_ANALYSE` et `COLONNES_GENERATION`, et pour cette raison précise.
export const COLONNES_TRANSCRIPTION = 'id, rush_id, user_id, version, etat, etape, fournisseurs, presente, langue, texte, segments, mots, usage, motif_echec, created_at, started_at, completed_at, updated_at';

/**
 * Les mêmes colonnes, SANS `mots`.
 *
 * ⚠️ CE N'EST PAS UNE OPTIMISATION DE CONFORT. Les mots horodatés d'un long
 * rush pèsent plusieurs centaines de kilo-octets ; l'écran qui liste les
 * transcriptions n'en affiche aucun. Les rapatrier à chaque lecture ferait
 * payer à toutes les vues le prix de la seule qui s'en sert.
 */
export const COLONNES_TRANSCRIPTION_SANS_MOTS = 'id, rush_id, user_id, version, etat, etape, fournisseurs, presente, langue, texte, segments, usage, motif_echec, created_at, started_at, completed_at, updated_at';

export interface TranscriptionRush {
  id: string;
  rushId: string;
  userId: string;
  version: number;
  etat: EtatTranscription;
  etape: EtapeTranscription | null;
  fournisseurs: Record<string, { fournisseur: string; modele: string | null }>;
  presente: boolean;
  langue: string | null;
  texte: string;
  segments: IntervalleTexte[];
  /** Absent — et NON vide — quand la lecture ne les a pas demandés. */
  mots?: IntervalleTexte[];
  usage: Record<string, unknown>;
  motifEchec: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

/** 42P01 / PGRST205 : la migration M3-D2 n'est pas appliquée. */
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
 * ⚠️ SEGMENTS ET MOTS SONT REVALIDÉS UN À UN. La base accepte n'importe quel
 * `jsonb` ; l'écran, lui, affiche des nombres. Un intervalle informe passerait
 * la persistance et casserait à l'affichage — on l'écarte ici, silencieusement
 * pour l'écran mais sans jamais le compter comme valide.
 */
export function transcriptionDepuisLigne(row: Record<string, unknown>): TranscriptionRush {
  const etat = etatTranscriptionValide(row.etat) ? row.etat : 'echouee';
  const filtrer = (v: unknown): IntervalleTexte[] => (
    Array.isArray(v) ? v.filter(intervalleValide) : []
  );

  const objet: TranscriptionRush = {
    id: String(row.id),
    rushId: String(row.rush_id),
    userId: String(row.user_id),
    version: typeof row.version === 'number' ? row.version : 1,
    etat,
    etape: etapeTranscriptionValide(row.etape) ? row.etape : null,
    fournisseurs: (typeof row.fournisseurs === 'object' && row.fournisseurs !== null
      ? row.fournisseurs : {}) as TranscriptionRush['fournisseurs'],
    presente: row.presente === true,
    langue: typeof row.langue === 'string' && row.langue ? row.langue : null,
    texte: typeof row.texte === 'string' ? row.texte : '',
    segments: filtrer(row.segments),
    usage: (typeof row.usage === 'object' && row.usage !== null
      ? row.usage : {}) as Record<string, unknown>,
    motifEchec: typeof row.motif_echec === 'string' ? row.motif_echec : null,
    createdAt: String(row.created_at ?? ''),
    startedAt: typeof row.started_at === 'string' ? row.started_at : null,
    completedAt: typeof row.completed_at === 'string' ? row.completed_at : null,
    updatedAt: String(row.updated_at ?? ''),
  };
  // `mots` reste ABSENT quand la colonne n'a pas été demandée : un tableau
  // vide se lirait « aucun mot », ce qui est faux.
  if (row.mots !== undefined) objet.mots = filtrer(row.mots);
  return objet;
}

export type MotifPersistance = 'socle_absent' | 'transcription_active_existante';

/**
 * Ferme les transcriptions actives PÉRIMÉES de ce rush.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE PIÈGE QUE CE BLOC FERME
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `rush_transcriptions_active_unique` interdit deux transcriptions actives
 * par rush — c'est ce qui empêche de payer deux fois le fournisseur. Mais un
 * processus tué au mauvais moment laisse sa ligne `en_cours` POUR TOUJOURS,
 * et le rush devient alors définitivement impossible à transcrire. Le même
 * piège s'était présenté sur `rush_analyses`, puis sur `rush_candidate_sets`,
 * et se traite pareil.
 *
 * ⚠️ TROIS PRÉCAUTIONS, ET AUCUNE N'EST DÉCORATIVE :
 *
 *   * `user_id` dans le `where` — une péremption n'est pas une autorisation
 *     d'écrire chez autrui ;
 *   * `rush_id` dans le `where` — on ne balaie pas la table entière au
 *     passage, seulement ce qui bloque CETTE demande ;
 *   * `created_at < seuil` — une transcription RÉCENTE travaille peut-être
 *     encore, et la fermer ferait payer un second appel pendant le premier.
 *     `created_at`, et non `updated_at` : ce dernier bouge à chaque étape,
 *     donc une génération morte qui aurait eu le temps de passer `en_cours`
 *     repousserait indéfiniment sa propre péremption.
 *
 * Aucun texte ni usage n'est écrit : une transcription interrompue n'a rien
 * produit, et lui inventer un résultat vide serait affirmer qu'elle a écouté.
 */
export async function recupererTranscriptionsInterrompues(
  userId: string, rushId: string,
): Promise<{ fermees: number; motif: MotifPersistance | null }> {
  const maintenant = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('rush_transcriptions')
    .update({
      etat: 'echouee' as EtatTranscription,
      motif_echec: MOTIF_TRANSCRIPTION_INTERROMPUE,
      completed_at: maintenant,
      updated_at: maintenant,
    })
    .eq('user_id', userId)
    .eq('rush_id', rushId)
    .in('etat', ETATS_TRANSCRIPTION_ACTIFS as unknown as string[])
    .lt('created_at', seuilPeremptionTranscription())
    .select('id');

  if (error) {
    if (socleAbsent(error)) return { fermees: 0, motif: 'socle_absent' };
    throw new Error(error.message || 'recuperation de transcription impossible');
  }
  return { fermees: Array.isArray(data) ? data.length : 0, motif: null };
}

export interface ResultatCreation {
  transcription: TranscriptionRush | null;
  motif: MotifPersistance | null;
}

/**
 * Crée une transcription, ou refuse.
 *
 * ⚠️ LA GARANTIE EST EN BASE, PAS ICI. Aucun `select` préalable n'autorise
 * cette insertion : deux requêtes concurrentes passeraient toutes deux un
 * `if (existing) return` avant que l'une n'ait écrit, et le fournisseur
 * serait payé deux fois. C'est `rush_transcriptions_active_unique` qui refuse
 * la seconde, et lui seul.
 */
export async function creerTranscription(
  userId: string, rushId: string,
): Promise<ResultatCreation> {
  // ── Les transcriptions abandonnées de CE rush sont fermées d'abord ────
  //
  // Ici, et pas ailleurs : le seul moment où le blocage gêne quelqu'un est
  // celui où il redemande une transcription de ce rush. Avant tout le reste,
  // pour que le verrou soit libre quand l'insertion se présente.
  //
  // Ce n'est PAS le `select` que ce module s'interdit : rien ici n'autorise
  // l'insertion qui suit. Si la récupération échoue à libérer le verrou, ou
  // si une transcription fraîche naît entre-temps, c'est l'index unique qui
  // refuse — comme sans ce bloc.
  const recuperation = await recupererTranscriptionsInterrompues(userId, rushId);
  if (recuperation.motif === 'socle_absent') {
    return { transcription: null, motif: 'socle_absent' };
  }

  // La version suit ce qui existe. Si deux appels simultanés calculent le
  // même numéro, l'index unique en refuse un — c'est le comportement voulu.
  const { data: derniere, error: erreurLecture } = await supabaseAdmin
    .from('rush_transcriptions')
    .select('version')
    .eq('rush_id', rushId)
    .eq('user_id', userId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (erreurLecture) {
    if (socleAbsent(erreurLecture)) return { transcription: null, motif: 'socle_absent' };
    // ⚠️ NE PAS retomber à la version 1. Une panne de lecture ne dit rien sur
    // ce qui existe ; repartir à 1 ferait échouer l'insertion sur l'index de
    // version, et ce refus serait traduit en « une transcription tourne
    // déjà » — un diagnostic FAUX pour une panne d'infrastructure.
    throw new Error(erreurLecture.message || 'lecture de la version impossible');
  }
  const version = derniere && typeof (derniere as { version?: unknown }).version === 'number'
    ? (derniere as { version: number }).version + 1 : 1;

  const { data, error } = await supabaseAdmin
    .from('rush_transcriptions')
    .insert({
      rush_id: rushId,
      user_id: userId,
      version,
      // L'état et l'étape sont décidés ICI, jamais reçus.
      etat: 'en_attente' as EtatTranscription,
      etape: null,
    })
    .select(COLONNES_TRANSCRIPTION)
    .maybeSingle();

  if (error) {
    if (socleAbsent(error)) return { transcription: null, motif: 'socle_absent' };
    if (violationUnicite(error)) {
      // Deux index peuvent refuser, et les deux disent la même chose à
      // l'utilisateur : une transcription de ce rush est déjà en cours.
      return { transcription: null, motif: 'transcription_active_existante' };
    }
    throw new Error(error.message || 'creation de transcription impossible');
  }
  if (!data) throw new Error('creation sans reponse');
  return {
    transcription: transcriptionDepuisLigne(data as Record<string, unknown>),
    motif: null,
  };
}

export interface MajTranscription {
  etat?: EtatTranscription;
  etape?: EtapeTranscription | null;
  fournisseurs?: Record<string, { fournisseur: string; modele: string | null }>;
  presente?: boolean;
  langue?: string | null;
  texte?: string;
  segments?: IntervalleTexte[];
  mots?: IntervalleTexte[];
  usage?: Record<string, unknown>;
  motifEchec?: string | null;
  demarree?: boolean;
  terminee?: boolean;
}

export interface ResultatMaj {
  ok: boolean;
  motif: MotifPersistance | 'non_consigne' | null;
}

/**
 * Met à jour une transcription, en garantissant le propriétaire dans le `where`.
 *
 * ⚠️ `eq('user_id', userId)` N'EST PAS DÉCORATIF. Sans lui, un identifiant de
 * transcription suffirait à écrire chez autrui — la clé étrangère composite
 * garantit la cohérence à la création, pas l'autorisation d'une mise à jour.
 */
export async function majTranscription(
  userId: string, transcriptionId: string, maj: MajTranscription,
): Promise<ResultatMaj> {
  const maintenant = new Date().toISOString();
  const champs: Record<string, unknown> = { updated_at: maintenant };
  if (maj.etat !== undefined) champs.etat = maj.etat;
  if (maj.etape !== undefined) champs.etape = maj.etape;
  if (maj.fournisseurs !== undefined) champs.fournisseurs = maj.fournisseurs;
  if (maj.presente !== undefined) champs.presente = maj.presente;
  if (maj.langue !== undefined) champs.langue = maj.langue;
  if (maj.texte !== undefined) champs.texte = maj.texte;
  if (maj.segments !== undefined) champs.segments = maj.segments;
  if (maj.mots !== undefined) champs.mots = maj.mots;
  if (maj.usage !== undefined) champs.usage = maj.usage;
  if (maj.motifEchec !== undefined) {
    champs.motif_echec = maj.motifEchec === null
      ? null : maj.motifEchec.slice(0, MOTIF_ECHEC_MAX);
  }
  if (maj.demarree) champs.started_at = maintenant;
  if (maj.terminee) champs.completed_at = maintenant;

  const { data, error } = await supabaseAdmin
    .from('rush_transcriptions')
    .update(champs)
    .eq('id', transcriptionId)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();

  if (error) {
    if (socleAbsent(error)) return { ok: false, motif: 'socle_absent' };
    throw new Error(error.message || 'mise a jour de transcription impossible');
  }
  // Aucune ligne touchée : la transcription n'existe pas, ou n'est pas la sienne.
  if (!data) return { ok: false, motif: 'non_consigne' };
  return { ok: true, motif: null };
}

/**
 * Lit UNE transcription, désignée par son identifiant, avec ses MOTS.
 *
 * ⚠️ AVEC LES MOTS, ET C'EST LE POINT. `lireDerniereTranscription` les omet
 * par défaut, à raison : l'écran affiche du texte et des phrases. M3-E, lui,
 * a besoin de savoir si une borne tombe AU MILIEU d'un mot — ce que seuls les
 * mots peuvent dire. Cette lecture est donc plus chère, et elle n'est appelée
 * que par qui en a l'usage.
 *
 * `eq('user_id', userId)` : inconnue et appartenant à un tiers rendent la
 * même chose, et l'appelant répond 404 dans les deux cas.
 */
export async function lireTranscriptionParId(
  userId: string, transcriptionId: string,
): Promise<{ transcription: TranscriptionRush | null; motif: MotifPersistance | null }> {
  const { data, error } = await supabaseAdmin
    .from('rush_transcriptions')
    .select(COLONNES_TRANSCRIPTION)
    .eq('id', transcriptionId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    if (socleAbsent(error)) return { transcription: null, motif: 'socle_absent' };
    throw new Error(error.message || 'lecture de transcription impossible');
  }
  if (!data) return { transcription: null, motif: null };
  return {
    transcription: transcriptionDepuisLigne(data as Record<string, unknown>),
    motif: null,
  };
}

/**
 * Lit la dernière transcription RÉUSSIE d'un rush, avec ses MOTS.
 *
 * ⚠️ « RÉUSSIE », ET C'EST TOUTE LA DIFFÉRENCE AVEC
 * `lireDerniereTranscription`.
 *
 * Cette dernière rend la version la plus haute, quel que soit son état —
 * c'est ce que l'écran veut, puisqu'il doit pouvoir afficher « la dernière
 * tentative a échoué ». Son comportement ne change pas.
 *
 * M3-E veut de la MATIÈRE. Une tentative échouée en version 3 ne doit pas
 * masquer la transcription réussie de la version 2 : sans ce filtre, un
 * simple échec de fournisseur ferait perdre le calage sur la parole d'un
 * rush qui en a pourtant une, parfaitement exploitable.
 */
export async function lireDerniereTranscriptionReussie(
  userId: string, rushId: string,
): Promise<{ transcription: TranscriptionRush | null; motif: MotifPersistance | null }> {
  const { data, error } = await supabaseAdmin
    .from('rush_transcriptions')
    .select(COLONNES_TRANSCRIPTION)
    .eq('rush_id', rushId)
    .eq('user_id', userId)
    .eq('etat', 'reussie')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (socleAbsent(error)) return { transcription: null, motif: 'socle_absent' };
    throw new Error(error.message || 'lecture de transcription impossible');
  }
  if (!data) return { transcription: null, motif: null };
  return {
    transcription: transcriptionDepuisLigne(data as Record<string, unknown>),
    motif: null,
  };
}

/**
 * Lit la dernière transcription d'un rush — celle que l'écran affiche.
 *
 * `avecMots` est FAUX par défaut, et c'est le bon défaut : l'écran affiche du
 * texte et des phrases, pas des mots. Qui a besoin des mots le demande.
 *
 * Rend `null` sans erreur quand il n'y en a aucune : un rush sans
 * transcription est l'état normal tant que personne n'a cliqué.
 */
export async function lireDerniereTranscription(
  userId: string, rushId: string, avecMots = false,
): Promise<{ transcription: TranscriptionRush | null; motif: MotifPersistance | null }> {
  // ⚠️ DEUX CHAÎNES ÉCRITES EN ENTIER, ET NON UN `select(a ? b : c)`.
  //
  // `supabase-js` analyse la liste de colonnes AU NIVEAU DES TYPES : un
  // ternaire la lui rend comme `string`, et le client répond alors
  // `ParserError` au lieu de la ligne. C'est la même raison qui interdit la
  // concaténation dans `COLONNES_TRANSCRIPTION` — et elle coûte ici six
  // lignes répétées, ce qui reste moins cher qu'une lecture qui échoue en
  // production sans que rien ne l'ait annoncé.
  const { data, error } = avecMots
    ? await supabaseAdmin
      .from('rush_transcriptions')
      .select(COLONNES_TRANSCRIPTION)
      .eq('rush_id', rushId)
      .eq('user_id', userId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()
    : await supabaseAdmin
      .from('rush_transcriptions')
      .select(COLONNES_TRANSCRIPTION_SANS_MOTS)
      .eq('rush_id', rushId)
      .eq('user_id', userId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

  if (error) {
    if (socleAbsent(error)) return { transcription: null, motif: 'socle_absent' };
    throw new Error(error.message || 'lecture de transcription impossible');
  }
  if (!data) return { transcription: null, motif: null };
  return {
    transcription: transcriptionDepuisLigne(data as Record<string, unknown>),
    motif: null,
  };
}
