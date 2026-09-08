/**
 * A_7b — LE POOL GLOBAL MULTI-RUSH.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER FAIT, ET CE QU'IL SE REFUSE À FAIRE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A_7M a ouvert le schéma, A_7a le contrat, A_7B0 l'écriture indivisible.
 * Aucun des trois ne DÉCIDE quoi que ce soit : le moteur ne sait toujours
 * choisir que dans un seul rush.
 *
 * Ce module fait le pas manquant — rassembler les clips de plusieurs rushes
 * en UN pool, et le proposer au moteur EXISTANT.
 *
 * ⚠️ IL NE RÉÉCRIT PAS M3-G, ET C'EST LA CONTRAINTE PRINCIPALE DU LOT. Un
 * `m3g-v4-multirush` copié de `m3g-v3` aurait deux conséquences certaines :
 * les garde-fous éditoriaux (recouvrement, écart entre moments, plafond de
 * couverture, durée minimale, plafond de plans) existeraient en double, et le
 * jour où l'un serait corrigé, il ne le serait qu'une fois. `planifierMontage`
 * reste donc l'unique moteur ; A_7b lui a seulement appris que ses trois
 * scalaires — géométrie, durée du rush, plages prises — sont des attributs DE
 * LA SOURCE, et lui donne un pool au lieu d'un jeu.
 *
 * ⚠️ IL NE TOUCHE NI À M3-C, NI À M3-E, NI AU SCORING. Les candidats sont
 * choisis rush par rush, sans objectif — M3-C reste neutre. Les bornes de
 * phrase sont calées rush par rush, sur LA TRANSCRIPTION DE CE RUSH : une
 * frontière de phrase cherchée dans le transcript d'un autre fichier
 * couperait au milieu d'un mot. Et `objectif-score` n'est pas modifié d'une
 * ligne : c'est lui qui note, ici comme avant.
 *
 * ⚠️ IL NE REND RIEN. Un plan multi-rush peut être calculé et persisté ; le
 * rendre exige plusieurs entrées ffmpeg, et c'est A_7c. Une garde explicite
 * refuse le rendu plutôt que de laisser le moteur mono-source retomber sur la
 * première source — mieux vaut un plan non rendu qu'une vidéo qui prétend
 * mêler quatre rushes et n'en montre qu'un.
 */
import {
  palierDeQualite, politiqueDePlan, type PolitiquePlan,
} from './objectif-score';
import { planifierMontage, type ClipSource, type ContexteSourcePlan } from './montage';
import {
  jeuxSourcesDesSegments, empreinteJeuxSources,
  type JeuSource, type SegmentSourceAware,
} from './montage-source';
import type { ClipMaterialise } from './clip-contrat';
import type {
  FormatMontage, GeometrieSource, MotifPlan, PlanMontage,
} from './montage-contrat';
import type { ObjectifCommunication } from './objectif-communication';

// ───────────────────────────────────────────────────────────────────────────
// Les bornes
// ───────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ DEUX SOURCES RETENUES, PAS DEUX SOURCES PROPOSÉES.
 *
 * Un plan dont une seule source a finalement fourni un segment N'EST PAS un
 * plan multi-rush : lui en donner l'identité lui attribuerait une empreinte,
 * donc l'index multi-rush, alors qu'il est en tout point le plan mono-rush du
 * chemin historique — et ses rendus déjà produits deviendraient introuvables.
 * Le résultat retombe donc explicitement sur le chemin single-rush.
 */
export const SOURCES_RETENUES_MIN = 2;

/**
 * Combien de rushes le mode AUTOMATIQUE prépare pour une vidéo.
 *
 * ⚠️ LA BORNE EXISTE PARCE QUE PRÉPARER COÛTE. Analyser un rush appelle des
 * fournisseurs payants ; en préparer cinquante pour une vidéo de quinze
 * secondes brûlerait un budget pour de la matière qui ne sera pas montrée.
 * Le plafond suit donc la durée demandée, la seule mesure qui dise combien de
 * matière est réellement nécessaire.
 */
export function maxRushesAutomatique(dureeCibleSecondes: number): number {
  if (!Number.isFinite(dureeCibleSecondes) || dureeCibleSecondes <= 0) return 2;
  if (dureeCibleSecondes <= 20) return 3;
  if (dureeCibleSecondes <= 40) return 4;
  return 5;
}

/**
 * Le plafond du mode MANUEL.
 *
 * Plus large que l'automatique : la personne choisit elle-même, et paie sa
 * préparation en connaissance de cause. Il reste très en deçà des 64 sources
 * qu'`ordinal` autorise en base — cette borne-là est mécanique, celle-ci est
 * un jugement produit, et les confondre serait laisser la base décider d'une
 * question éditoriale.
 */
export const MAX_RUSHES_MANUEL = 8;

/**
 * Combien de rushes sont préparés EN PARALLÈLE.
 *
 * ⚠️ PAS DE `Promise.all` SUR LA LISTE ENTIÈRE. Chaque préparation appelle un
 * fournisseur d'analyse et un de transcription ; en lancer huit d'un coup
 * expose le compte à une limite de débit et transforme un cycle en cascade
 * d'échecs. Deux à la fois tient le temps de cycle sans faire du bruit.
 */
export const CONCURRENCE_PREPARATION = 2;

/**
 * L'historique lu pour la récence inter-vidéos.
 *
 * Repris de `HISTORIQUE_MAX` (politique créative), et pour la même raison :
 * au-delà d'une dizaine de vidéos, ce qui a servi ne dit plus rien de ce qu'on
 * vient de voir, et lire davantage coûterait une requête plus lourde pour un
 * signal mort.
 */
export const HISTORIQUE_SOURCES_MAX = 10;

/**
 * Ce que coûte une source déjà servie DANS CETTE VIDÉO.
 *
 * ⚠️ IL NE FRANCHIT JAMAIS UN PALIER DE QUALITÉ, parce qu'il ne s'applique
 * qu'À L'INTÉRIEUR d'un palier — voir `ordonnerAvecDiversiteSource`. Un clip
 * médiocre ne peut donc pas passer devant un bon clip pour faire joli.
 */
export const POIDS_OCCURRENCE_SOURCE = 100;

/**
 * Ce que coûte une source vue RÉCEMMENT, sur les vidéos précédentes.
 *
 * Dégressif comme `PENALITE_RECENCE` : très cher pour la dernière vidéo,
 * gratuit au-delà de l'historique. Une pénalité plate exclurait purement une
 * source, et un compte à deux rushes n'aurait plus rien à monter.
 */
export const POIDS_RECENCE_SOURCE = 60;

// ───────────────────────────────────────────────────────────────────────────
// Le pool
// ───────────────────────────────────────────────────────────────────────────

/** Ce qu'UN rush apporte au pool. Tout vient de SON analyse, de SON jeu. */
export interface SourceMontable {
  rushId: string;
  clipSetId: string;
  clipSetVersion: number;
  /** Mesurée sur CE rush. Deux rushes n'ont aucune raison d'avoir le même cadre. */
  geometrie: GeometrieSource;
  /** La durée de CE rush — le plafond de couverture est le sien. */
  dureeRushSecondes: number | null;
  /** Les clips de CE jeu, avec leurs rangs internes. */
  clips: readonly ClipMaterialise[];
}

/**
 * Un candidat du pool GLOBAL.
 *
 * ⚠️ `rangGlobal` N'EST PAS `rangDansJeu`, ET LES DEUX SONT NÉCESSAIRES.
 * Le rang d'un clip n'est unique qu'à l'intérieur de son jeu : le rang 1
 * existe dans A comme dans B. `politiqueDePlan` indexe ses notes PAR RANG —
 * lui passer deux rangs 1 lui ferait noter un candidat et oublier l'autre.
 * Le pool renumérote donc, et garde le rang réel pour la provenance A_7a.
 */
export interface CandidatGlobalMultiRush {
  rangGlobal: number;
  rushId: string;
  clipSetId: string;
  clipSetVersion: number;
  rangDansJeu: number;
  debutSourceSecondes: number;
  finSourceSecondes: number;
  dureeSecondes: number;
  scoreMontage: number | null;
  /** `null` quand la qualité manque — le palier est alors incalculable. */
  palierQualite: number | null;
  signaux: ClipMaterialise['signaux'];
}

export interface PoolGlobal {
  candidats: CandidatGlobalMultiRush[];
  /** Les clips renumérotés, prêts pour `planifierMontage`. */
  clips: ClipSource[];
  contextes: ContexteSourcePlan[];
  /** Les sources RÉELLEMENT présentes dans le pool, dans l'ordre reçu. */
  sources: JeuSource[];
}

/**
 * Rassemble plusieurs jeux de clips en UN pool ordonné.
 *
 * ⚠️ L'ORDRE GLOBAL EST CELUI DE LA QUALITÉ, PUIS DES SOURCES.
 *
 * `rang` porte, dans `m3g-v2`, le classement de M3-C : score décroissant puis
 * instant croissant. Concaténer bêtement les jeux donnerait `A1,A2,A3,B1,B2` —
 * c'est-à-dire l'ordre des SOURCES, où le pire clip de A passerait devant le
 * meilleur de B. La renumérotation rétablit donc la seule hiérarchie qui ait
 * un sens à l'échelle du pool : la qualité mesurée.
 *
 * ⚠️ À ÉGALITÉ, C'EST L'ORDRE DES SOURCES PUIS LE RANG INTERNE. Aucun tirage
 * au sort : deux appels sur la même matière rendent le même pool, sans quoi
 * l'identité du plan ne voudrait rien dire.
 *
 * ⚠️ UNE SOURCE SANS CLIP N'ENTRE PAS. Elle recevrait un contexte, donc une
 * ligne `plan_sources`, donc une empreinte décrivant une matière que le
 * montage ne montre pas — et deux montages identiques auraient deux identités.
 */
export function construirePoolGlobal(sources: readonly SourceMontable[]): PoolGlobal {
  const utiles = sources.filter((s) => s.clips.length > 0);

  const ordonnees = utiles.map((s, ordinal) => ({ source: s, ordinal }));
  const plats = ordonnees.flatMap(({ source, ordinal }) =>
    source.clips.map((clip) => ({ source, ordinal, clip })));

  plats.sort((a, b) => {
    /* Un clip sans qualité mesurée passe derrière tous ceux qui en ont une :
       le mettre devant le récompenserait d'une donnée manquante. */
    const sa = a.clip.scoreMontage ?? -1;
    const sb = b.clip.scoreMontage ?? -1;
    return sb - sa || a.ordinal - b.ordinal || a.clip.rang - b.clip.rang;
  });

  const candidats: CandidatGlobalMultiRush[] = [];
  const clips: ClipSource[] = [];

  plats.forEach(({ source, clip }, i) => {
    const rangGlobal = i + 1;
    candidats.push({
      rangGlobal,
      rushId: source.rushId,
      clipSetId: source.clipSetId,
      clipSetVersion: source.clipSetVersion,
      rangDansJeu: clip.rang,
      debutSourceSecondes: clip.debutSecondes,
      finSourceSecondes: clip.finSecondes,
      dureeSecondes: clip.finSecondes - clip.debutSecondes,
      scoreMontage: clip.scoreMontage,
      palierQualite: clip.scoreMontage === null ? null : palierDeQualite(clip.scoreMontage),
      signaux: clip.signaux,
    });
    /* ⚠️ `rang` PORTE LE RANG GLOBAL, et `rangDansJeu` le vrai. Le moteur
       indexe tout par `rang` — politique, notes, explicabilité ; la provenance
       A_7a, elle, doit dire le rang RÉEL du clip dans son jeu, sans quoi
       `(clipSetId, rangClip)` ne désignerait rien. */
    clips.push({ ...clip, rang: rangGlobal, cleSource: source.clipSetId,
      rangDansJeu: clip.rang });
  });

  const contextes: ContexteSourcePlan[] = ordonnees.map(({ source }) => ({
    cle: source.clipSetId,
    geometrie: source.geometrie,
    dureeRushSecondes: source.dureeRushSecondes ?? undefined,
    source: {
      rushId: source.rushId,
      clipSetId: source.clipSetId,
      clipSetVersion: source.clipSetVersion,
    },
  }));

  return {
    candidats,
    clips,
    contextes,
    sources: utiles.map((s) => ({ clipSetId: s.clipSetId, clipSetVersion: s.clipSetVersion })),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// La diversité de source
// ───────────────────────────────────────────────────────────────────────────

/**
 * Ce qu'une source a coûté RÉCEMMENT, sur les vidéos précédentes.
 *
 * `historique` est ordonné du plus récent au plus ancien ; chaque entrée est
 * l'ensemble des sources d'un montage passé.
 *
 * ⚠️ DÉGRESSIF, JAMAIS ÉLIMINATOIRE. Un compte qui possède deux rushes doit
 * pouvoir continuer à produire : une pénalité plate rendrait tout inutilisable
 * dès la seconde vidéo. Le coût vaut plein pour la vidéo précédente et tombe à
 * zéro au-delà de l'historique lu.
 */
export function penaliteRecenceSource(
  clipSetId: string, historique: readonly (readonly string[])[],
): number {
  const limite = Math.min(historique.length, HISTORIQUE_SOURCES_MAX);
  for (let age = 0; age < limite; age += 1) {
    if (historique[age].includes(clipSetId)) {
      return Math.round(POIDS_RECENCE_SOURCE * (limite - age) / limite);
    }
  }
  return 0;
}

/**
 * Ce qu'une source coûte DANS CETTE VIDÉO, selon ce qu'elle a déjà fourni.
 *
 * ⚠️ FONCTION PURE, SANS BASE ET SANS HORLOGE — c'est ce qui permet de prouver
 * la politique de diversité sur des valeurs plutôt que sur un montage.
 */
export function penaliteSourceRecente(
  clipSetId: string,
  dejaProposees: readonly string[],
  historique: readonly (readonly string[])[] = [],
): number {
  const occurrences = dejaProposees.filter((c) => c === clipSetId).length;
  return occurrences * POIDS_OCCURRENCE_SOURCE + penaliteRecenceSource(clipSetId, historique);
}

/**
 * Réordonne les candidats POUR VARIER LES SOURCES — sans jamais dégrader.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠️ LA DIVERSITÉ NE FRANCHIT PAS UN PALIER DE QUALITÉ
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Le réordonnancement se fait STRICTEMENT à l'intérieur d'un palier de
 * `palierDeQualite` — la même bande de vingt points qui sert déjà à l'objectif.
 * Sa raison est écrite dans `objectif-score` : la bande est « assez large pour
 * que deux fenêtres comparables (78 et 81) restent départageables, assez
 * étroite pour qu'un écart franc (45 contre 85) reste imbattable ».
 *
 * Conséquence directe, et c'est l'exigence n°13 du lot : un rush médiocre ne
 * remonte JAMAIS pour faire varier les sources. Il n'est pas dans le palier.
 *
 * ⚠️ ET ELLE PASSE APRÈS L'OBJECTIF. À l'intérieur d'un palier, l'ordre reçu
 * est celui qu'a décidé `politiqueDePlan` ; la diversité ne fait que
 * DÉPARTAGER, en servant d'abord la source la moins employée. Deux candidats
 * de même source restent dans leur ordre d'arrivée.
 *
 * ⚠️ AUCUN QUOTA. Rien n'interdit trois segments du même rush : si A occupe
 * seul le meilleur palier, A sort trois fois. La pénalité pousse, elle
 * n'interdit pas — un quota rigide forcerait un clip inférieur dès que le bon
 * rush aurait « épuisé son droit ».
 */
export function ordonnerAvecDiversiteSource(
  ordreBase: readonly number[],
  candidats: readonly CandidatGlobalMultiRush[],
  historique: readonly (readonly string[])[] = [],
): number[] {
  const parRang = new Map(candidats.map((c) => [c.rangGlobal, c]));

  /* Les paliers, dans l'ordre où l'ordre de base les rencontre. Un candidat
     sans qualité mesurée forme son propre groupe : il n'est comparable à
     personne, et le glisser dans un palier voisin serait inventer sa note. */
  const groupes: number[][] = [];
  let palierCourant: number | null | undefined;
  for (const rang of ordreBase) {
    const p = parRang.get(rang)?.palierQualite ?? null;
    if (groupes.length === 0 || p !== palierCourant) {
      groupes.push([rang]);
      palierCourant = p;
    } else {
      groupes[groupes.length - 1].push(rang);
    }
  }

  const sortie: number[] = [];
  const proposees: string[] = [];

  for (const groupe of groupes) {
    const restants = [...groupe];
    while (restants.length > 0) {
      let meilleur = 0;
      let meilleurCout = Number.POSITIVE_INFINITY;
      for (let i = 0; i < restants.length; i += 1) {
        const c = parRang.get(restants[i]);
        const cout = c ? penaliteSourceRecente(c.clipSetId, proposees, historique) : 0;
        /* ⚠️ `<` STRICT : à coût égal, le premier de l'ordre reçu l'emporte.
           C'est ce qui préserve la décision de l'objectif et rend le
           réordonnancement déterministe. */
        if (cout < meilleurCout) { meilleurCout = cout; meilleur = i; }
      }
      const [rang] = restants.splice(meilleur, 1);
      sortie.push(rang);
      const c = parRang.get(rang);
      if (c) proposees.push(c.clipSetId);
    }
  }
  return sortie;
}

// ───────────────────────────────────────────────────────────────────────────
// La planification
// ───────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ LE MARQUEUR MULTI-SOURCE DANS `algorithme_plan`.
 *
 * Un plan bâti sur un pool n'a pas été décidé comme un plan mono-rush : la
 * diversité de source a pesé sur l'ordre de proposition, et l'ordre de montage
 * suit `entrelacerSources` plutôt que la chronologie. Rendre le même
 * `algorithme_plan` que le chemin historique ferait passer deux politiques
 * différentes pour une seule — et `lirePlanIdentique` rendrait un jour l'un
 * pour l'autre.
 *
 * Suffixe plutôt que nouvelle constante : la politique de base (`m3g-v2` ou
 * `m3g-v3.<empreinte>`) reste lisible, et rien de ce qu'elle décide n'est
 * remplacé.
 */
export const SUFFIXE_PLAN_MULTI_SOURCE = '+ms1' as const;

export interface DemandePool {
  sources: readonly SourceMontable[];
  format: FormatMontage;
  dureeCibleSecondes: number;
  objectif?: ObjectifCommunication | null;
  /** Les sources des montages précédents, du plus récent au plus ancien. */
  historique?: readonly (readonly string[])[];
}

export type MotifPool =
  | MotifPlan
  | 'sources_insuffisantes'
  /** Une seule source a fini par fournir un segment : ce n'est pas un multi-rush. */
  | 'source_unique_retenue';

export interface ResultatPool {
  segments: SegmentSourceAware[];
  /** Les sources RÉELLEMENT employées, dans l'ordre de première apparition. */
  sources: JeuSource[];
  empreinteSources: string;
  algorithmePlan: string;
  politique: PolitiquePlan;
  dureeTotaleSecondes: number;
  ecartSecondes: number;
  clipsEcartes: number;
  usage: Record<string, unknown>;
  pool: PoolGlobal;
}

/**
 * Bâtit un plan MULTI-RUSH, ou dit pourquoi il n'y en a pas.
 *
 * ⚠️ IL N'EXISTE AUCUN CHEMIN PAR LEQUEL CETTE FONCTION RENDE UN PLAN À UNE
 * SEULE SOURCE. Elle refuse en amont (moins de deux sources dans le pool) et
 * en aval (une seule source a finalement fourni un segment). Dans les deux
 * cas, l'appelant doit repartir sur le chemin mono-rush historique — celui
 * dont les rendus sont déjà en base.
 */
export function planifierMontageMultiRush(
  demande: DemandePool,
): { resultat: ResultatPool | null; motif: MotifPool | null } {
  const pool = construirePoolGlobal(demande.sources);

  if (pool.sources.length < SOURCES_RETENUES_MIN) {
    return { resultat: null, motif: 'sources_insuffisantes' };
  }

  /* ⚠️ LE SCORING N'EST PAS RÉÉCRIT : c'est `politiqueDePlan` qui note, avec
     les mêmes poids, la même version, les mêmes cinq conditions. Elle voit un
     pool là où elle voyait un jeu, et ne s'en aperçoit pas — chaque fenêtre
     porte un rang unique, ce qui est tout ce qu'elle demande. */
  const politique = politiqueDePlan(
    pool.candidats.map((c) => ({
      rang: c.rangGlobal, scoreMontage: c.scoreMontage, signaux: c.signaux,
    })),
    demande.objectif,
    'm3g-v2',
  );

  const ordreDiversifie = ordonnerAvecDiversiteSource(
    politique.ordreRangs, pool.candidats, demande.historique ?? [],
  );

  const { resultat, motif } = planifierMontage({
    clips: pool.clips,
    format: demande.format,
    dureeCibleSecondes: demande.dureeCibleSecondes,
    // La géométrie de repli n'est jamais lue : `contextes` la porte par source.
    geometrie: pool.contextes[0].geometrie,
    contextes: pool.contextes,
    /* ⚠️ LA POLITIQUE EST PASSÉE DÉJÀ DÉCIDÉE, comme le fait la route : la
       recalculer dans le moteur donnerait un second verdict pour la même
       matière, et le plan serait rangé sous une identité qu'il n'a pas. */
    politique: { ...politique, ordreRangs: ordreDiversifie, objectiveAware: true },
  });

  if (!resultat) return { resultat: null, motif: motif ?? 'plan_vide' };

  const segments = resultat.plans.filter(
    (p): p is SegmentSourceAware => p.source !== undefined,
  );
  /* ⚠️ TOUS LES SEGMENTS, OU AUCUN. Un plan multi-rush dont un segment aurait
     perdu sa provenance ferait deviner sa source au renderer d'A_7c — c'est
     précisément ce que le lot A_7a a fermé. */
  if (segments.length !== resultat.plans.length) {
    return { resultat: null, motif: 'plan_vide' };
  }

  const employees = sourcesDuPlan(segments);
  if (employees.length < SOURCES_RETENUES_MIN) {
    return { resultat: null, motif: 'source_unique_retenue' };
  }

  const empreinte = empreinteJeuxSources(employees);
  if (!empreinte) return { resultat: null, motif: 'source_unique_retenue' };

  return {
    resultat: {
      segments,
      sources: employees,
      empreinteSources: empreinte,
      algorithmePlan: `${politique.algorithmePlan}${SUFFIXE_PLAN_MULTI_SOURCE}`,
      politique,
      dureeTotaleSecondes: resultat.dureeTotaleSecondes,
      ecartSecondes: resultat.ecartSecondes,
      clipsEcartes: resultat.clipsEcartes,
      usage: {
        ...resultat.usage,
        multiRush: {
          sourcesProposees: pool.sources.length,
          sourcesRetenues: employees.length,
          candidatsPool: pool.candidats.length,
          ordreDiversifie,
          historiqueLu: Math.min((demande.historique ?? []).length, HISTORIQUE_SOURCES_MAX),
        },
      },
      pool,
    },
    motif: null,
  };
}

/**
 * Les sources RÉELLEMENT employées par un montage, dans l'ordre canonique.
 *
 * ⚠️ ORDRE DE PREMIÈRE APPARITION À L'ÉCRAN, et c'est la règle d'A_7a que ce
 * lot ne fait que reprendre. Les trier par identifiant confondrait `A,B` et
 * `B,A` dans l'empreinte, donc dans le cache, donc au rendu. Les segments
 * `A1,B1,A2,C1` donnent exactement `A,B,C` : une source citée trois fois
 * reste UNE source — l'empreinte décrit la matière, pas le découpage.
 */
export function sourcesDuPlan(segments: readonly SegmentSourceAware[]): JeuSource[] {
  return jeuxSourcesDesSegments(segments);
}

// ───────────────────────────────────────────────────────────────────────────
// Le choix des rushes
// ───────────────────────────────────────────────────────────────────────────

/** Un rush de la banque, tel que le classement a besoin de le connaître. */
export interface RushEligible {
  rushId: string;
  /** `null` quand le rush n'a pas encore de jeu de clips. */
  clipSetId: string | null;
  /** Rang d'arrivée dans la banque : plus petit = indexé plus récemment. */
  ordreBanque: number;
  /** Un rush déjà préparé ne coûte rien de plus qu'un encodage. */
  pret: boolean;
}

/**
 * Classe les rushes éligibles pour UNE vidéo — déterministe, sans hasard.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠️ AUCUN `Math.random`, AUCUN `Date.now`
 * ═════════════════════════════════════════════════════════════════════════
 *
 * La graine tient au compte, au créneau et à la demande — la philosophie de
 * `graineCreative`. Un cron qui rejoue le même créneau doit refaire EXACTEMENT
 * la même vidéo, sans quoi la relecture d'un plan identique ne retrouverait
 * jamais rien et chaque réessai serait refacturé.
 *
 * ⚠️ LA GRAINE NE TIRE PAS AU SORT, ELLE DÉPARTAGE. Elle n'intervient qu'à
 * égalité parfaite de préparation et de récence — sans elle, deux comptes aux
 * banques semblables produiraient toujours le même ordre, et le premier rush
 * indexé serait monté à chaque cycle.
 */
export function classerRushesEligibles(
  eligibles: readonly RushEligible[],
  options: {
    graine: string;
    historique?: readonly (readonly string[])[];
    max: number;
  },
): RushEligible[] {
  const historique = options.historique ?? [];
  const note = (r: RushEligible) => {
    /* Un rush prêt passe devant : le monter ne coûte qu'un encodage, quand un
       rush brut appelle des fournisseurs payants. */
    const cout = r.pret ? 0 : 1000;
    const recence = r.clipSetId ? penaliteRecenceSource(r.clipSetId, historique) : 0;
    return cout + recence;
  };
  return [...eligibles]
    .sort((a, b) => note(a) - note(b)
      || a.ordreBanque - b.ordreBanque
      || departage(options.graine, a.rushId) - departage(options.graine, b.rushId)
      || (a.rushId < b.rushId ? -1 : 1))
    .slice(0, Math.max(0, options.max));
}

/** Un entier stable tiré d'une graine et d'un identifiant. Pas une horloge. */
function departage(graine: string, cle: string): number {
  let h = 2166136261;
  const texte = `${graine}|${cle}`;
  for (let i = 0; i < texte.length; i += 1) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type MotifSelectionManuelle =
  | 'liste_vide'
  | 'trop_de_rushes'
  | 'rush_inconnu';

/**
 * Valide une liste de rushes choisie À LA MAIN — pour A_7d.
 *
 * ⚠️ L'ORDRE DE SÉLECTION N'EST PAS L'ORDRE DU MONTAGE. Cocher B avant A dit
 * quels rushes employer, pas dans quel ordre les montrer : c'est le moteur qui
 * décide de l'enchaînement, sur la qualité et la diversité. L'ordre reçu ne
 * sert donc qu'à départager, jamais à imposer.
 *
 * ⚠️ LA PROPRIÉTÉ N'EST PAS VÉRIFIÉE ICI, ELLE EST PROUVÉE. `possedes` est la
 * liste que la base a rendue POUR CE COMPTE ; un identifiant absent est
 * refusé, qu'il appartienne à quelqu'un d'autre ou qu'il n'existe pas. Aucune
 * différence de message entre les deux cas : la distinction apprendrait à un
 * tiers quels identifiants existent.
 */
export function validerRushesChoisis(
  choisis: readonly string[], possedes: ReadonlySet<string>,
): { rushIds: string[]; motif: MotifSelectionManuelle | null } {
  const uniques: string[] = [];
  for (const id of choisis) if (!uniques.includes(id)) uniques.push(id);

  if (uniques.length === 0) return { rushIds: [], motif: 'liste_vide' };
  if (uniques.length > MAX_RUSHES_MANUEL) return { rushIds: [], motif: 'trop_de_rushes' };
  for (const id of uniques) {
    if (!possedes.has(id)) return { rushIds: [], motif: 'rush_inconnu' };
  }
  return { rushIds: uniques, motif: null };
}

// ───────────────────────────────────────────────────────────────────────────
// La garde de rendu
// ───────────────────────────────────────────────────────────────────────────

/**
 * Un plan est-il multi-source ?
 *
 * ⚠️ LU SUR LES SEGMENTS, PAS SUR LE NOMBRE DE LIGNES `plan_sources`. Un plan
 * dont les segments citent deux jeux EST multi-source, même si sa table de
 * sources n'a pas encore été écrite. C'est la lecture prudente : elle refuse
 * un rendu de trop, jamais un de moins.
 */
export function planEstMultiSource(segments: readonly PlanMontage[]): boolean {
  const vus = new Set<string>();
  for (const s of segments) if (s.source) vus.add(s.source.clipSetId);
  return vus.size > 1;
}

/**
 * Le renderer peut-il rendre ce plan ? — GARDE LEVÉE PAR A_7c.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * POURQUOI ELLE EXISTAIT, ET POURQUOI ELLE N'A PLUS LIEU D'ÊTRE
 * ═════════════════════════════════════════════════════════════════════════
 *
 * A_7b l'a posée sur une crainte précise : qu'un renderer mono-entrée, servi
 * d'un plan multi-rush, monte tous les segments depuis le premier fichier —
 * durée juste, vidéo produite, contenu faux, et facturé.
 *
 * ⚠️ CETTE CRAINTE ÉTAIT INFONDÉE, ET C'EST L'AUDIT D'A_7c QUI L'ÉTABLIT.
 * `argumentsRendu` ouvre DÉJÀ une entrée ffmpeg PAR SEGMENT — `-i s.chemin`,
 * une par `SourceLocale` — avec, dans chaque branche, son propre `trim`, son
 * propre `crop` calculé sur `largeurSource`/`hauteurSource` DU SEGMENT, sa
 * propre normalisation `scale`/`setsar`/`fps`, et son propre `[i:a]atrim`
 * pris sur LA MÊME entrée `i`. Monter l'image de B avec le son de A est
 * structurellement impossible : les deux pads sortent du même index.
 *
 * La raison en est architecturale et antérieure au lot : les objets montés ne
 * sont pas les RUSHES mais les CLIPS matérialisés par M3-F — un fichier par
 * passage, portant déjà son `bucket` et sa `cle`. Le renderer n'a jamais su de
 * quel rush venait un clip, et n'a jamais eu besoin de le savoir.
 *
 * ⚠️ CE QUI RESTAIT VRAIMENT MONO-RUSH, C'ÉTAIT LE TEXTE. `projeterMots`
 * recevait UNE liste de mots pour tout le montage : un segment de B y trouvait
 * les phrases de A. C'est cela qu'A_7c a corrigé — `motsParSource` — et c'est
 * la seule chose qui pouvait produire une vidéo fausse.
 *
 * La fonction est CONSERVÉE plutôt que supprimée : elle est le point où une
 * future incapacité du renderer se déclarerait, et ses appelants n'auraient
 * alors rien à réapprendre.
 */
export const MOTIF_RENDU_MULTI_SOURCE = 'multi_rush_renderer_not_ready' as const;

export function rendreEstPossible(
  segments: readonly PlanMontage[],
): { possible: boolean; motif: typeof MOTIF_RENDU_MULTI_SOURCE | null } {
  /* ⚠️ `segments` RESTE DANS LA SIGNATURE. Le jour où une capacité manquera
     — un codec, un format — c'est ici qu'elle se dira, et l'appel est déjà
     posé au bon endroit dans la route de rendu. */
  void segments;
  return { possible: true, motif: null };
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
  const { creerPlanMultiRushAtomique } = await import('./montage-service');
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
