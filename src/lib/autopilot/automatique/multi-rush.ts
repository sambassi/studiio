/**
 * A_7d — LE MONTAGE MULTI-RUSH, DE BOUT EN BOUT.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * UN SEUL CHEMIN POUR LE MANUEL ET L'AUTOMATIQUE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Quatre lots ont posé les briques : A_7M le schéma, A_7a le contrat, A_7B0
 * l'écriture indivisible, A_7b la décision, A_7c le rendu. Aucun ne les
 * assemblait — le seul chemin qui produisait des vidéos ne savait toujours
 * monter qu'un rush.
 *
 * ⚠️ CE MODULE N'EST PAS UN TROISIÈME PIPELINE. Il n'analyse pas, ne découpe
 * pas, ne note pas, ne rend pas. Il appelle, dans l'ordre, les fonctions qui
 * font déjà chacune de ces choses :
 *
 *   `preparerRush` + `preparerJeuClips`  A_0b — les MÊMES que l'automatique
 *                                        mono-rush, extraites et non recopiées
 *   `planifierMontageMultiRush`          A_7b — pool global, objectif,
 *                                        diversité de source, ordre entrelacé
 *   `persisterPlanMultiRush`             A_7B0 — plan et sources dans UNE
 *                                        transaction
 *
 * Écrire une seconde version de l'une d'elles aurait donné deux façons
 * d'analyser, de choisir ou d'écrire — et le jour où l'une serait corrigée,
 * l'autre continuerait, silencieusement.
 *
 * ⚠️ AUCUNE DÉPENDANCE AU NAVIGATEUR. Ni cookie, ni session, ni appel HTTP
 * interne : le cron doit pouvoir l'utiliser tel quel. `userId` est passé par
 * l'appelant, qui l'a déjà prouvé.
 *
 * ⚠️ IL NE REND PAS ET NE PUBLIE PAS. Il s'arrête au plan persisté. Le rendu
 * appartient à la route ou à la chaîne, et la publication à personne — une
 * création automatique n'est pas une publication automatique.
 */
import { preparerRush, preparerJeuClips } from './chaine-serveur';
import { geometrieDepuisTechnique } from '@/lib/autopilot/analyse/montage';
import { dimensionsCible, type FormatMontage } from '@/lib/autopilot/analyse/montage-contrat';
import {
  planifierMontageMultiRush,
  CONCURRENCE_PREPARATION, SOURCES_RETENUES_MIN,
  type SourceMontable, type ResultatPool,
} from '@/lib/autopilot/analyse/montage-pool';
import {
  creerPlanMultiRushAtomique, lireHistoriqueSources,
} from '@/lib/autopilot/analyse/montage-service';
import type { MontagePlan } from '@/lib/autopilot/analyse/montage-contrat';
import type { ObjectifCommunication } from '@/lib/autopilot/analyse/objectif-communication';

export interface DemandeMultiRush {
  userId: string;
  /** Les rushes retenus — déjà dédupliqués, bornés et prouvés au compte. */
  rushIds: readonly string[];
  format: FormatMontage;
  dureeCibleSecondes: number;
  objectif?: ObjectifCommunication | null;
}

export type MotifMultiRush =
  | 'aucun_rush'
  /** Une seule source exploitable : c'est le chemin mono-rush historique. */
  | 'source_unique'
  | 'plan_impossible'
  | 'plan_non_persiste'
  | 'socle_absent';

export interface SourceEcartee {
  rushId: string;
  motif: string;
}

export interface IssueMultiRush {
  plan: MontagePlan | null;
  motif: MotifMultiRush | null;
  /** Les sources RÉELLEMENT montées, dans l'ordre de première apparition. */
  sources: readonly { rushId: string; clipSetId: string }[];
  /** Ce qui n'a pas pu servir — dit, jamais tu. */
  ecartees: readonly SourceEcartee[];
  /** Le seul rush utile quand `source_unique` : l'appelant repart de là. */
  rushUnique: string | null;
  resultat: ResultatPool | null;
}

/**
 * Prépare plusieurs rushes, PAR PETITS PAQUETS.
 *
 * ⚠️ PAS DE `Promise.all` SUR LA LISTE ENTIÈRE. Chaque préparation appelle un
 * fournisseur d'analyse puis un de candidats ; en lancer huit d'un coup expose
 * le compte à une limite de débit et transforme un cycle en cascade d'échecs.
 * La borne vient d'A_7b — elle n'est pas redéfinie ici.
 */
async function parPaquets<T, R>(
  entrees: readonly T[], taille: number, f: (e: T) => Promise<R>,
): Promise<R[]> {
  const sortie: R[] = [];
  for (let i = 0; i < entrees.length; i += taille) {
    sortie.push(...await Promise.all(entrees.slice(i, i + taille).map(f)));
  }
  return sortie;
}

/**
 * D'un rush à une source montable — ou la raison pour laquelle il ne l'est pas.
 *
 * ⚠️ UN ÉCHEC N'EST PAS UNE EXCEPTION. Sur cinq rushes, il est NORMAL qu'un
 * fournisseur en refuse un ; faire tomber tout le montage pour cela punirait
 * les quatre autres. La raison est rendue, l'appelant décide.
 */
async function sourceDepuisRush(
  userId: string, rushId: string,
): Promise<
  { source: SourceMontable; algorithme: string; methodeMaterialisation: string }
  | { ecartee: SourceEcartee }
> {
  const raison = (i: { sorte: string } & Record<string, unknown>) =>
    (typeof i.motif === 'string' ? i.motif : i.sorte);
  try {
    const pret = await preparerRush(userId, rushId, null, null);
    if ('sorte' in pret) return { ecartee: { rushId, motif: raison(pret) } };

    const jeu = await preparerJeuClips(userId, pret.analysisId, pret.candidateSetId);
    if (!('ok' in jeu)) return { ecartee: { rushId, motif: raison(jeu) } };

    /* ⚠️ LA GÉOMÉTRIE EST LUE, JAMAIS DEVINÉE — et c'est CELLE DE CE RUSH.
       Sans dimensions mesurées, il n'y a aucun moyen de décider d'un
       recadrage : supposer du 1920×1080 recadrerait de travers un rush
       vertical, et le plan aurait l'air valide. */
    const geometrie = geometrieDepuisTechnique(jeu.analyse.technique);
    if (geometrie === null) return { ecartee: { rushId, motif: 'geometrie_inconnue' } };

    return {
      source: {
        rushId: jeu.rushId,
        clipSetId: jeu.set.id,
        clipSetVersion: jeu.set.version,
        geometrie,
        dureeRushSecondes: jeu.analyse.dureeSecondes ?? null,
        clips: jeu.set.clips,
      },
      /* ⚠️ CES DEUX-LA FONT PARTIE DE L'IDENTITE DU PLAN. `algorithme` dit
         comment les bornes ont ete decidees, `methodeMaterialisation` comment
         les octets ont ete produits — deux reponses communes a toutes les
         sources d'un meme montage, puisqu'elles viennent des memes versions de
         M3-E et M3-F. A_7M les a d'ailleurs laissees `not null` pour cette
         raison. On les prend sur le jeu, jamais sur une constante. */
      algorithme: jeu.set.algorithme,
      methodeMaterialisation: jeu.set.methodeMaterialisation,
    };
  } catch {
    /* Le message n'est pas repris : il porterait un détail de base. */
    return { ecartee: { rushId, motif: 'preparation_impossible' } };
  }
}

/**
 * Prépare, planifie et persiste un montage multi-rush.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠️ IL N'EXISTE AUCUN CHEMIN PAR LEQUEL CETTE FONCTION RENDE UN FAUX MULTI
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Elle refuse à trois endroits, et chacun a sa raison :
 *
 *   • MOINS DE DEUX RUSHES PRÉPARÉS  → `source_unique`. Un plan à une source
 *     recevrait une empreinte, basculerait sous l'index multi-rush d'A_7M, et
 *     ses MP4 déjà rendus deviendraient introuvables ;
 *   • A_7b NE RETIENT QU'UNE SOURCE   → `source_unique` aussi. Quatre rushes
 *     peuvent être préparés et un seul survivre au palier de qualité ;
 *   • LA RPC REFUSE                   → `plan_non_persiste`. Jamais un repli
 *     sur une écriture en deux temps.
 *
 * Dans les deux premiers cas, `rushUnique` dit lequel : l'appelant repart sur
 * le chemin mono-rush historique, celui dont tous les rendus sont en base.
 */
export async function monterMultiRush(d: DemandeMultiRush): Promise<IssueMultiRush> {
  const vide = (motif: MotifMultiRush, ecartees: SourceEcartee[] = [],
    rushUnique: string | null = null): IssueMultiRush =>
    ({ plan: null, motif, sources: [], ecartees, rushUnique, resultat: null });

  /* Dédupliqué ici aussi : la même liste peut venir d'une UI ou d'un cron, et
     un rush cité deux fois ferait deux préparations pour une seule source. */
  const rushIds: string[] = [];
  for (const id of d.rushIds) if (!rushIds.includes(id)) rushIds.push(id);
  if (rushIds.length === 0) return vide('aucun_rush');

  const issues = await parPaquets(rushIds, CONCURRENCE_PREPARATION,
    (rushId) => sourceDepuisRush(d.userId, rushId));

  const sources: SourceMontable[] = [];
  const ecartees: SourceEcartee[] = [];
  let algorithme = '';
  let methodeMaterialisation = '';
  for (const i of issues) {
    if ('source' in i) {
      sources.push(i.source);
      /* La premiere source preparee fixe la paire ; les suivantes la
         partagent, puisqu'elles sortent des memes versions de M3-E et M3-F. */
      if (algorithme === '') { algorithme = i.algorithme; }
      if (methodeMaterialisation === '') { methodeMaterialisation = i.methodeMaterialisation; }
    } else ecartees.push(i.ecartee);
  }

  if (sources.length < SOURCES_RETENUES_MIN) {
    return vide('source_unique', ecartees, sources[0]?.rushId ?? null);
  }

  /* ⚠️ L'HISTORIQUE EST LU, MAIS UNE PANNE NE VAUT PAS « AUCUN HISTORIQUE ».
     Rendre une liste vide sur une erreur ferait croire à la diversité que
     toutes les sources sont fraîches, et le même rush reviendrait à chaque
     cycle sans que rien ne le signale. `lireHistoriqueSources` lève ; on
     laisse alors le montage se faire sans récence plutôt que de le perdre,
     mais on ne l'invente pas. */
  let historique: string[][] = [];
  try {
    historique = (await lireHistoriqueSources(d.userId)).historique;
  } catch { historique = []; }

  const { resultat, motif } = planifierMontageMultiRush({
    sources,
    format: d.format,
    dureeCibleSecondes: d.dureeCibleSecondes,
    objectif: d.objectif ?? null,
    historique,
  });

  if (!resultat) {
    return motif === 'source_unique_retenue' || motif === 'sources_insuffisantes'
      ? vide('source_unique', ecartees, sources[0]?.rushId ?? null)
      : vide('plan_impossible', ecartees);
  }

  const cible = dimensionsCible(d.format);
  /* ⚠️ LA CADENCE VIENT DE LA PREMIÈRE SOURCE MONTÉE, et le renderer
     normalise toutes les branches dessus — `fps=` dans chaque branche, `-r` en
     sortie. Prendre une valeur choisie ici ferait ré-échantillonner un rush
     qui n'en avait pas besoin. */
  const premiere = sources.find((s) => s.clipSetId === resultat.sources[0]?.clipSetId)
    ?? sources[0];

  const creation = await persisterPlanMultiRush(
    d.userId, resultat,
    { algorithme, methodeMaterialisation },
    {
      format: d.format,
      dureeCibleSecondes: d.dureeCibleSecondes,
      fps: premiere.geometrie.fps,
      largeurCible: cible.largeur,
      hauteurCible: cible.hauteur,
    },
  );

  if (creation.motif === 'socle_absent') return vide('socle_absent', ecartees);
  if (!creation.plan) return vide('plan_non_persiste', ecartees);

  const parJeu = new Map(sources.map((s) => [s.clipSetId, s.rushId]));
  return {
    plan: creation.plan,
    motif: null,
    sources: resultat.sources.map((s) => ({
      clipSetId: s.clipSetId, rushId: parJeu.get(s.clipSetId) ?? '',
    })),
    ecartees,
    rushUnique: null,
    resultat,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// La persistance — par A_7B0, et par lui seul
// ───────────────────────────────────────────────────────────────────────────

export interface IdentitePool {
  algorithme: string;
  methodeMaterialisation: string;
}

/**
 * Persiste un plan multi-rush — INDIVISIBLEMENT.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠️ IL N'Y A QU'UN CHEMIN, ET C'EST LA RPC D'A_7B0
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Écrire le plan puis ses sources en deux appels laisserait, si le second
 * échoue, un plan portant une empreinte qui décrit une matière absente de la
 * base — indiscernable, pour A_7M, d'un plan AMPUTÉ par la suppression d'un
 * jeu de clips. `creerPlanMultiRushAtomique` fait les deux dans une seule
 * transaction ; ce module n'appelle donc NI `creerPlan`, NI
 * `ecrireSourcesPlan`, et un test le vérifie.
 *
 * ⚠️ L'IDEMPOTENCE VIENT DE LA BASE. Deux workers calculant le même montage
 * au même instant sont le fonctionnement normal de l'autopilote : l'index
 * `rush_montage_plans_identite_sources_unique` tranche, et le second repart
 * avec le plan du premier plutôt qu'avec une erreur. Rien n'est à décider ici.
 *
 * ⚠️ AUCUN DÉBIT. Un montage à quatre rushes reste UNE vidéo : facturer par
 * source ferait payer quatre fois le même rendu. Ce module n'importe pas
 * `@/lib/credits`, et un test le vérifie.
 */
export async function persisterPlanMultiRush(
  userId: string,
  resultat: ResultatPool,
  identite: IdentitePool,
  demande: { format: FormatMontage; dureeCibleSecondes: number; fps: number;
             largeurCible: number; hauteurCible: number },
) {
  return creerPlanMultiRushAtomique(
    userId,
    resultat.sources,
    {
      algorithme: identite.algorithme,
      methodeMaterialisation: identite.methodeMaterialisation,
      algorithmePlan: resultat.algorithmePlan,
      format: demande.format,
      dureeCibleSecondes: demande.dureeCibleSecondes,
    },
    {
      largeurCible: demande.largeurCible,
      hauteurCible: demande.hauteurCible,
      fps: demande.fps,
      plans: resultat.segments,
      dureeTotaleSecondes: resultat.dureeTotaleSecondes,
      ecartSecondes: resultat.ecartSecondes,
      clipsEcartes: resultat.clipsEcartes,
      usage: resultat.usage,
    },
  );
}
