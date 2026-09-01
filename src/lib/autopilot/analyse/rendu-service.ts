/**
 * M3-H — LA PERSISTANCE DES RENDUS.
 *
 * Calqué sur `clip-service.ts` (M3-F) et `montage-service.ts` (M3-G), dont il
 * reprend les gardes : idempotence portée par des index uniques EN BASE,
 * panne de lecture jamais traduite en valeur par défaut, propriété prouvée
 * par la clé étrangère composite.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ CETTE PHASE NE REND RIEN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Aucun ffmpeg, aucun Remotion, aucun téléchargement, aucun téléversement,
 * aucun octet. Ce module crée une ligne `en_attente` et sait la relire ; la
 * transition vers `en_cours` puis `reussie` appartient à l'exécution, qui
 * n'existe pas encore. La primitive de mise à jour est fournie parce que
 * l'exécution en aura besoin, mais elle ne simule aucune transition.
 *
 * ⚠️ AUCUN DÉBIT. `usage` est renseigné, jamais facturé. Ce module n'importe
 * pas `@/lib/credits`, et un test le vérifie.
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import {
  MOTIF_RENDU_INTERROMPU, PEREMPTION_RENDU_MS,
  etapeRenduValide, etatRenduValide, renduMaterialiseValide,
  type EtapeRendu, type EtatRendu, type IdentiteRendu, type MotifRendu,
  type RenduMaterialise,
} from './rendu-contrat';

// ⚠️ UN SEUL LITTÉRAL, JAMAIS UNE CONCATÉNATION. `supabase-js` analyse cette
// chaîne AU NIVEAU DES TYPES ; un `+` la ramène à `string`, et le client rend
// alors `ParserError` au lieu de la ligne.
export const COLONNES_RENDU = 'id, user_id, montage_plan_id, montage_plan_version, methode_rendu, etat, etape, resultat, motif_echec, usage, created_at, started_at, completed_at, updated_at';

export const ETATS_ACTIFS: readonly EtatRendu[] = ['en_attente', 'en_cours'];

export type MotifPersistanceRendu =
  | 'socle_absent'
  | 'rendu_actif'
  | 'rendu_concurrent'
  /**
   * La mise à jour n'a touché AUCUNE ligne.
   *
   * Distinct d'un succès sans données : l'exécution détachée doit pouvoir
   * apprendre que sa ligne a disparu — fermée par péremption, ou emportée par
   * la cascade d'un plan supprimé — plutôt que de continuer à travailler pour
   * un rendu que plus personne n'attend.
   */
  | 'rendu_absent';

/** 42P01 / PGRST205 : la migration M3-H n'est pas appliquée. */
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
 * Lequel des deux index a refusé ?
 *
 * Les deux protègent des choses différentes, et l'appelant n'en fait pas la
 * même chose : un rendu ACTIF concurrent est un refus qu'on rend à
 * l'utilisateur, un rendu RÉUSSI concurrent est une invitation à relire et à
 * réutiliser. Les confondre ferait échouer une requête qui aurait dû rendre
 * un fichier déjà prêt.
 */
function motifUnicite(erreur: { message?: string } | null): MotifPersistanceRendu {
  const message = (erreur?.message ?? '').toLowerCase();
  if (message.includes('reussi_unique')) return 'rendu_concurrent';
  return 'rendu_actif';
}

/**
 * Masque toute URL avant d'écrire le relevé d'exécution.
 *
 * ⚠️ SANS CELA, UNE LIGNE DE JOURNAL BLOQUE UN PLAN. La base refuse tout
 * `://` dans `usage` ; une URL signée écrite par mégarde ferait échouer la
 * mise à jour de CLÔTURE en 23514, le rendu resterait `en_cours`, et
 * `rush_montage_renders_actif_unique` bloquerait le plan jusqu'à la
 * péremption. Le même raisonnement que la troncature du motif : une erreur de
 * journalisation ne doit jamais devenir une indisponibilité.
 *
 * On masque plutôt que de refuser : le relevé est un confort de diagnostic,
 * il ne vaut pas de faire échouer un rendu abouti.
 */
export function usageSansUrl(usage: Record<string, unknown>): Record<string, unknown> {
  const propre: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(usage)) {
    if (typeof valeur === 'string' && valeur.includes('://')) {
      propre[cle] = '[url masquee]';
    } else if (Array.isArray(valeur)) {
      // ⚠️ ET DANS LES OBJETS QU'IL CONTIENT. `usage.orphelins` est un tableau
      // d'objets — la seule structure imbriquée de la chaîne — alors que le
      // `check` de la base porte sur le TEXTE ENTIER. Ne masquer que les
      // chaînes de premier niveau laissait passer précisément ce que H4
      // écrit, et la clôture aurait échoué en 23514 : l'erreur de
      // journalisation devenue indisponibilité, que ce module existe pour
      // empêcher.
      propre[cle] = valeur.map((v) => {
        if (typeof v === 'string') return v.includes('://') ? '[url masquee]' : v;
        if (typeof v === 'object' && v !== null) {
          return usageSansUrl(v as Record<string, unknown>);
        }
        return v;
      });
    } else if (typeof valeur === 'object' && valeur !== null) {
      propre[cle] = usageSansUrl(valeur as Record<string, unknown>);
    } else {
      propre[cle] = valeur;
    }
  }
  return propre;
}

function nombre(v: unknown, defaut = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : defaut;
}

/**
 * Le seuil de péremption, en ISO — ce que la récupération compare.
 *
 * ⚠️ IL VIT ICI ET NON DANS LE CONTRAT, parce que H1 est figé. Chez M3-F,
 * `seuilPeremptionSet` est dans le contrat ; la divergence est assumée et
 * tient à l'ordre des phases, pas à une intention.
 *
 * ⚠️ ET IL SE COMPARE À `created_at`. `updated_at` bouge à chaque
 * progression : un rendu mort qui aurait écrit une dernière fois repousserait
 * son expiration indéfiniment, et le plan resterait bloqué pour toujours.
 * `started_at` est nul tant que l'état vaut `en_attente` : un rendu jamais
 * démarré n'expirerait alors jamais. `created_at` est le seul champ qui
 * marque le début de vie du travail et ne bouge plus.
 */
export function seuilPeremptionRendu(maintenant: number = Date.now()): string {
  return new Date(maintenant - PEREMPTION_RENDU_MS).toISOString();
}

/**
 * Un rendu, tel que la base le porte.
 *
 * ⚠️ DÉFINI ICI, ET NON DANS LE CONTRAT. Chez M3-F et M3-G, `ClipSet` et
 * `MontagePlan` vivent dans leur contrat respectif. H1 étant figé, ce type de
 * persistance est déclaré à l'endroit qui l'utilise plutôt que d'y toucher.
 */
export interface RenduMontage extends IdentiteRendu {
  id: string;
  userId: string;
  etat: EtatRendu;
  etape: EtapeRendu | null;
  /** Le fichier final, une fois mesuré. `null` tant qu'il n'existe pas. */
  resultat: RenduMaterialise | null;
  motifEchec: string | null;
  usage: Record<string, unknown>;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

/**
 * Relit une ligne en objet de domaine.
 *
 * ⚠️ LE RÉSULTAT EST REVALIDÉ. La base accepte n'importe quel objet `jsonb`
 * conforme au `check` ; l'exécution, elle, demande une clé, un compartiment
 * et des mesures. Un résultat informe passerait la persistance et casserait
 * plus loin — ou pire, serait servi comme un fichier valide.
 */
export function renduDepuisLigne(row: Record<string, unknown>): RenduMontage {
  const userId = String(row.user_id);
  const brut = row.resultat;
  const resultat = renduMaterialiseValide(brut, userId) ? brut : null;
  const etatBrut: EtatRendu = etatRenduValide(row.etat) ? row.etat : 'echouee';
  // ⚠️ UNE RÉUSSITE SANS FICHIER N'EST PAS UNE RÉUSSITE.
  //
  // Les deux champs étaient dérivés séparément : une ligne `reussie` dont le
  // résultat ne passe pas la revalidation — clé hors du préfixe utilisateur,
  // zéro octet, codec vide — rendait un objet qui AFFIRMAIT la réussite sans
  // rien à servir. C'est exactement le chemin de la réutilisation : on aurait
  // cru avoir un montage prêt. La base porte désormais la même garde, mais
  // une ligne écrite avant elle doit aussi être rattrapée à la lecture.
  const etat: EtatRendu = etatBrut === 'reussie' && resultat === null
    ? 'echouee' : etatBrut;
  return {
    id: String(row.id),
    userId,
    montagePlanId: String(row.montage_plan_id),
    montagePlanVersion: nombre(row.montage_plan_version, 1),
    methodeRendu: typeof row.methode_rendu === 'string' ? row.methode_rendu : '',
    etat,
    etape: etapeRenduValide(row.etape) ? row.etape : null,
    resultat,
    motifEchec: typeof row.motif_echec === 'string' ? row.motif_echec : null,
    usage: typeof row.usage === 'object' && row.usage !== null
      ? row.usage as Record<string, unknown> : {},
    createdAt: String(row.created_at ?? ''),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    updatedAt: String(row.updated_at ?? ''),
  };
}

/**
 * Ferme les rendus abandonnés de CE plan.
 *
 * ⚠️ QUATRE FILTRES, ET CHACUN POUR UNE RAISON.
 *
 * L'utilisateur : on ne touche jamais au travail d'autrui. Le plan : on ne
 * balaie pas la table au passage. Les états ACTIFS : un rendu terminé n'a
 * rien à rouvrir. Et `created_at < seuil` : un rendu RÉCENT est PROTÉGÉ — le
 * fermer ferait repartir un second ffmpeg pendant le premier, ce que l'index
 * actif empêcherait certes, mais au prix d'un refus incompréhensible.
 *
 * Appelée au seul moment où le blocage gêne quelqu'un : quand il redemande.
 * Un balayage périodique serait du travail permanent pour un cas rare.
 */
export async function recupererRendusInterrompus(
  userId: string, montagePlanId: string,
): Promise<{ fermes: number; motif: MotifPersistanceRendu | null }> {
  const maintenant = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('rush_montage_renders')
    .update({
      etat: 'echouee' as EtatRendu,
      motif_echec: MOTIF_RENDU_INTERROMPU as MotifRendu,
      completed_at: maintenant,
      updated_at: maintenant,
    })
    .eq('user_id', userId)
    .eq('montage_plan_id', montagePlanId)
    .in('etat', ETATS_ACTIFS as unknown as string[])
    .lt('created_at', seuilPeremptionRendu())
    .select('id');

  if (error) {
    if (socleAbsent(error)) return { fermes: 0, motif: 'socle_absent' };
    throw new Error(error.message || 'recuperation de rendu impossible');
  }
  return { fermes: Array.isArray(data) ? data.length : 0, motif: null };
}

/**
 * Cherche un rendu réussi d'identité STRICTEMENT identique.
 *
 * ⚠️ TROIS COLONNES, TOUTES COMPARÉES. Pas de « dernier rendu » implicite,
 * pas de comparaison partielle : le plan, SA VERSION, et la méthode. Sans la
 * version, un plan recalculé servirait le fichier de l'ancien ; sans la
 * méthode, un changement d'encodage servirait celui d'avant, en croyant
 * réencoder — la leçon que la revue de M3-F a mise au jour.
 */
export async function lireRenduReussiIdentique(
  userId: string, identite: IdentiteRendu,
): Promise<{ rendu: RenduMontage | null; motif: MotifPersistanceRendu | null }> {
  const { data, error } = await supabaseAdmin
    .from('rush_montage_renders')
    .select(COLONNES_RENDU)
    .eq('user_id', userId)
    .eq('montage_plan_id', identite.montagePlanId)
    .eq('montage_plan_version', identite.montagePlanVersion)
    .eq('methode_rendu', identite.methodeRendu)
    .eq('etat', 'reussie')
    // ⚠️ ORDONNÉE, MÊME AVEC UN INDEX UNIQUE. `rush_montage_renders_reussi_unique`
    // garantit qu'il n'y en a qu'un ; si cette garantie sautait un jour, une
    // lecture non ordonnée en choisirait un AU HASARD, et deux appels
    // successifs pourraient servir deux fichiers différents.
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (socleAbsent(error)) return { rendu: null, motif: 'socle_absent' };
    // ⚠️ ON NE RETOMBE PAS SUR « aucun rendu ». Une panne de lecture ne dit
    // rien sur ce qui existe ; la traduire en absence ferait relancer un
    // encodage déjà fait, et le refus de l'index serait alors lu comme « un
    // rendu tourne déjà » — un diagnostic FAUX pour une panne d'infra.
    throw new Error(error.message || 'lecture de rendu impossible');
  }
  if (!data) return { rendu: null, motif: null };
  return { rendu: renduDepuisLigne(data as Record<string, unknown>), motif: null };
}

/** Le rendu encore actif de ce plan, s'il y en a un. */
export async function lireRenduActif(
  userId: string, montagePlanId: string,
): Promise<{ rendu: RenduMontage | null; motif: MotifPersistanceRendu | null }> {
  const { data, error } = await supabaseAdmin
    .from('rush_montage_renders')
    .select(COLONNES_RENDU)
    .eq('user_id', userId)
    .eq('montage_plan_id', montagePlanId)
    .in('etat', ETATS_ACTIFS as unknown as string[])
    .limit(1)
    .maybeSingle();

  if (error) {
    if (socleAbsent(error)) return { rendu: null, motif: 'socle_absent' };
    throw new Error(error.message || 'lecture de rendu impossible');
  }
  if (!data) return { rendu: null, motif: null };
  return { rendu: renduDepuisLigne(data as Record<string, unknown>), motif: null };
}

export interface ResultatCreationRendu {
  rendu: RenduMontage | null;
  motif: MotifPersistanceRendu | null;
}

/**
 * Crée un rendu `en_attente`, ou rend le refus de la base.
 *
 * ⚠️ AUCUN `select` PRÉALABLE NE PROTÈGE CETTE INSERTION.
 *
 * Deux requêtes concurrentes passeraient toutes deux un `if (existant)
 * return` avant que l'une n'ait écrit, et deux ffmpeg partiraient sur les
 * mêmes octets. C'est `rush_montage_renders_actif_unique` qui refuse la
 * seconde, et lui seul. La récupération des périmés qui précède ne protège
 * rien : elle libère seulement la place d'un travail mort.
 *
 * Le refus est TRADUIT, jamais propagé en erreur. Ici il vaut toujours
 * `rendu_actif` : une insertion porte `en_attente`, qui n'entre jamais dans
 * le prédicat de `rush_montage_renders_reussi_unique`. `rendu_concurrent` ne
 * peut venir que de `majRendu`, au moment où deux rendus tentent d'atteindre
 * `reussie` pour la même identité.
 *
 * ⚠️ CE MODULE NE LANCE AUCUN TRAVAIL. La ligne naît `en_attente` ; c'est
 * l'exécution qui la fera avancer, et elle n'existe pas encore.
 */
export async function creerRendu(
  userId: string, identite: IdentiteRendu,
): Promise<ResultatCreationRendu> {
  // Les rendus abandonnés de CE plan sont fermés d'abord — au seul moment où
  // le blocage gêne quelqu'un, c'est-à-dire quand il redemande.
  const recuperation = await recupererRendusInterrompus(userId, identite.montagePlanId);
  if (recuperation.motif === 'socle_absent') return { rendu: null, motif: 'socle_absent' };

  const { data, error } = await supabaseAdmin
    .from('rush_montage_renders')
    .insert({
      user_id: userId,
      montage_plan_id: identite.montagePlanId,
      montage_plan_version: identite.montagePlanVersion,
      methode_rendu: identite.methodeRendu,
      // L'état et l'étape sont décidés ICI, jamais reçus.
      etat: 'en_attente' as EtatRendu,
      etape: null,
    })
    .select(COLONNES_RENDU)
    .maybeSingle();

  if (error) {
    if (socleAbsent(error)) return { rendu: null, motif: 'socle_absent' };
    if (violationUnicite(error)) return { rendu: null, motif: motifUnicite(error) };
    // ⚠️ 23503 : la clé étrangère composite a refusé. Le plan n'existe pas,
    // ou il appartient à quelqu'un d'autre. La base l'a établi, pas un `if`
    // que l'on aurait pu oublier d'écrire.
    throw new Error(error.message || 'creation de rendu impossible');
  }
  if (!data) return { rendu: null, motif: null };
  return { rendu: renduDepuisLigne(data as Record<string, unknown>), motif: null };
}

/** Un rendu par son identifiant, filtré par propriétaire DANS la requête. */
export async function lireRenduParId(
  userId: string, renduId: string,
): Promise<{ rendu: RenduMontage | null; motif: MotifPersistanceRendu | null }> {
  const { data, error } = await supabaseAdmin
    .from('rush_montage_renders')
    .select(COLONNES_RENDU)
    .eq('id', renduId)
    // Le filtre de propriété est ICI : le rendu d'autrui ne revient pas, donc
    // l'appelant n'a rien à décider, et un identifiant d'autrui est
    // indistinguable d'un identifiant inconnu.
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    if (socleAbsent(error)) return { rendu: null, motif: 'socle_absent' };
    throw new Error(error.message || 'lecture de rendu impossible');
  }
  if (!data) return { rendu: null, motif: null };
  return { rendu: renduDepuisLigne(data as Record<string, unknown>), motif: null };
}

export interface PatchRendu {
  etat?: EtatRendu;
  etape?: EtapeRendu | null;
  resultat?: RenduMaterialise;
  motifEchec?: MotifRendu | null;
  usage?: Record<string, unknown>;
  demarre?: boolean;
  termine?: boolean;
  /**
   * N'écrire QUE si la ligne est encore dans l'un de ces états.
   *
   * ⚠️ SANS CETTE GARDE, UN RENDU MORT RESSUSCITE. La péremption ferme une
   * ligne sur un critère de TEMPS, sans preuve que le processus est mort : un
   * travail réellement vivant peut donc être fermé, un second démarrer, et le
   * premier écrire ensuite sa réussite sur une ligne qu'on croyait terminée.
   * `rush_montage_renders_reussi_unique` rattrape le cas le plus grave, mais
   * un `compare-and-set` le règle à la source.
   *
   * Absent, la mise à jour ne regarde pas l'état — c'est ce qu'il faut pour
   * fermer une ligne quel que soit son état.
   */
  siEtat?: readonly EtatRendu[];
}

/**
 * La primitive d'écriture dont l'exécution aura besoin.
 *
 * ⚠️ ELLE FILTRE TOUJOURS `id` ET `user_id`. Un identifiant seul suffirait à
 * écrire dans la ligne d'autrui ; le second filtre coûte un mot et retire ce
 * risque de la table entière.
 *
 * Les horodatages ne sont pas reçus : `demarre` et `termine` demandent au
 * serveur de les poser. Un appelant qui fournirait `started_at` pourrait
 * antidater un rendu et le faire échapper à la péremption.
 *
 * ⚠️ H2 NE S'EN SERT PAS pour simuler une transition : aucune fonction de ce
 * module ne la chaîne. Elle existe parce que l'exécution la consommera.
 */
export async function majRendu(
  userId: string, renduId: string, patch: PatchRendu,
): Promise<{ rendu: RenduMontage | null; motif: MotifPersistanceRendu | null }> {
  const maintenant = new Date().toISOString();
  const valeurs: Record<string, unknown> = { updated_at: maintenant };
  if (patch.etat !== undefined) valeurs.etat = patch.etat;
  if (patch.etape !== undefined) valeurs.etape = patch.etape;
  if (patch.resultat !== undefined) {
    // ⚠️ REVALIDÉ À L'ÉCRITURE, PAS SEULEMENT À LA LECTURE. La base ne
    // contrôle que le type JSON et l'absence de `://` ; c'est par là qu'un
    // résultat informe entrerait, pour ressortir plus tard comme un fichier
    // prêt à servir.
    if (!renduMaterialiseValide(patch.resultat, userId)) {
      throw new Error('resultat de rendu invalide');
    }
    valeurs.resultat = patch.resultat;
  }
  if (patch.motifEchec !== undefined) {
    // ⚠️ TRONQUE, PARCE QUE LE `check` DE LA BASE BORNE A 200 CARACTERES.
    //
    // Le type `MotifRendu` ferme deja le vocabulaire a la compilation, mais
    // une valeur plus longue ferait echouer la mise a jour de CLOTURE : le
    // rendu resterait `en_cours`, et `rush_montage_renders_actif_unique`
    // bloquerait le plan jusqu'a la peremption. Une erreur de journalisation
    // deviendrait une indisponibilite. Même geste qu'en M3-F.
    valeurs.motif_echec = patch.motifEchec === null
      ? null : String(patch.motifEchec).slice(0, 200);
  }
  if (patch.usage !== undefined) valeurs.usage = usageSansUrl(patch.usage);
  if (patch.demarre) valeurs.started_at = maintenant;
  if (patch.termine) valeurs.completed_at = maintenant;

  let requete = supabaseAdmin
    .from('rush_montage_renders')
    .update(valeurs)
    .eq('id', renduId)
    .eq('user_id', userId);
  if (patch.siEtat) {
    requete = requete.in('etat', patch.siEtat as unknown as string[]);
  }
  const { data, error } = await requete.select(COLONNES_RENDU).maybeSingle();

  if (error) {
    if (socleAbsent(error)) return { rendu: null, motif: 'socle_absent' };
    if (violationUnicite(error)) return { rendu: null, motif: motifUnicite(error) };
    throw new Error(error.message || 'mise a jour de rendu impossible');
  }
  // ⚠️ AUCUNE LIGNE TOUCHÉE N'EST PAS UN SUCCÈS. La ligne a disparu, ou son
  // état ne correspond plus : l'exécution détachée doit l'apprendre plutôt
  // que de continuer pour un rendu que plus personne n'attend.
  if (!data) return { rendu: null, motif: 'rendu_absent' };
  return { rendu: renduDepuisLigne(data as Record<string, unknown>), motif: null };
}
