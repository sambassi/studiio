/**
 * A_7a — LA PROVENANCE D'UN SEGMENT DE MONTAGE.
 *
 * ---------------------------------------------------------------------------
 * CE QUE CE FICHIER SUPPRIME : UNE HYPOTHÈSE JAMAIS ÉCRITE
 * ---------------------------------------------------------------------------
 *
 * Jusqu'ici, « de quel rush vient ce segment ? » n'avait pas de réponse dans
 * le contrat : elle se lisait ailleurs, sur le PLAN, parce qu'un plan n'avait
 * qu'un seul jeu de clips. `PlanMontage` porte bien `bucket` et `cle`, et la
 * clé encode le `clipSetId` — mais une provenance qui se déduit en découpant
 * un chemin de stockage n'est pas un contrat, c'est une coïncidence qu'un
 * changement de nommage casserait en silence.
 *
 * A_7M a ouvert le schéma : un plan peut désormais désigner plusieurs jeux de
 * clips. Tant que le contrat applicatif garde l'hypothèse « un plan, un
 * rush », ce schéma reste inatteignable — et pire, la première tentative de
 * mélange produirait des segments dont la source serait devinée.
 *
 * ⚠️ A_7a NE MÉLANGE RIEN. Aucun pool multi-rush, aucune diversité, aucun
 * renderer multi-entrée, aucune sélection automatique. Ce lot rend la
 * provenance DISABLE et VÉRIFIABLE, pour que A_7b puisse composer et A_7c
 * rendre sans rien deviner.
 *
 * ---------------------------------------------------------------------------
 * SOURCE ≠ TIMELINE, ET LES DEUX NE SE MÉLANGENT PAS
 * ---------------------------------------------------------------------------
 *
 * Un segment a DEUX plages, dans deux référentiels sans rapport :
 *
 *   SOURCE   `debutSourceSecondes` / `finSourceSecondes`, dans SON rush.
 *   MONTAGE  `debutTimelineSecondes` / `dureeRetenueSecondes`, dans le film.
 *
 * Un passage pris à 15–18 s du rush B peut occuper 4–7 s du montage. Les
 * confondre est le bug qu'on ne voit qu'au rendu, sur une image décalée.
 * `SourceSegment` ne porte donc QUE la plage source ; la plage montage reste
 * où elle a toujours été, sur `PlanMontage`.
 *
 * ---------------------------------------------------------------------------
 * CE QUI N'ENTRE PAS DANS LA PROVENANCE, ET POURQUOI
 * ---------------------------------------------------------------------------
 *
 * `analysisId`, `candidateSetId`, `transcriptionId` : tous les trois sont des
 * colonnes NON NULL de la ligne `rush_clip_sets`, fixées à l'insertion et
 * jamais réécrites. Un `clipSetId` les résout donc de façon déterministe, y
 * compris pour un jeu vieux de six mois. Les recopier dans chaque segment
 * créerait une seconde vérité, capable de diverger de la première sans qu'une
 * contrainte ne le remarque — exactement la classe de bug que le lot cherche
 * à fermer.
 *
 * `rushId`, LUI, EST RECOPIÉ. Il est tout aussi dérivable, et c'est un choix
 * assumé : c'est la question que le renderer, les captions et l'audio de A_7c
 * poseront à CHAQUE segment, des milliers de fois, dans du code qui n'aura
 * pas la ligne du jeu de clips sous la main. Une provenance qui exige un
 * aller-retour en base pour être lue serait contournée. Il est donc dupliqué
 * ET vérifié : `sourceCoherente` refuse un `rushId` qui contredit son jeu.
 */
import { createHash } from 'crypto';
import {
  UUID, arrondirSeconde,
  type ClipMaterialise, type IdentiteClipSet,
} from './clip-contrat';
import type { PlanMontage } from './montage-contrat';

// ---------------------------------------------------------------------------
// Le contrat
// ---------------------------------------------------------------------------

/**
 * D'où vient un segment — la seule représentation, dans tout le projet.
 *
 * ⚠️ UNE SEULE FORME, ET C'EST L'ESSENTIEL DU LOT. Cinq représentations
 * voisines de la même provenance produiraient cinq conversions, dont quatre
 * finiraient par mentir. Tout ce qui a besoin de savoir d'où vient un segment
 * lit CE type.
 */
export interface SourceSegment {
  /** Le rush d'origine. Dupliqué depuis le jeu de clips, et vérifié. */
  rushId: string;
  /** Le jeu de clips dont ce segment est issu. */
  clipSetId: string;
  /**
   * La version de ce jeu.
   *
   * ⚠️ ELLE FAIT PARTIE DE L'IDENTITÉ. Rematérialiser un jeu produit des
   * octets différents pour les mêmes bornes ; un montage calculé sur la v2 ne
   * décrit pas le fichier de la v3.
   */
  clipSetVersion: number;
  /**
   * Le clip, DANS son jeu.
   *
   * ⚠️ `rangClip` SEUL N'IDENTIFIE RIEN. Le rang n'est unique qu'à l'intérieur
   * d'un jeu : le rang 2 existe dans A comme dans B. L'identité complète d'un
   * clip est donc la paire `(clipSetId, rangClip)`, et c'est cette paire que
   * `cleClip` utilise déjà pour fabriquer la clé de stockage.
   */
  rangClip: number;
  /** Début du passage DANS LE RUSH — jamais dans la timeline du montage. */
  debutSourceSecondes: number;
  /** Fin du passage DANS LE RUSH — jamais dans la timeline du montage. */
  finSourceSecondes: number;
}

/** Un segment dont la provenance est résolue. La forme d'après A_7a. */
export type SegmentSourceAware = PlanMontage & { source: SourceSegment };

export const MOTIFS_SOURCE = [
  /** Une provenance à moitié écrite — voir `sourceValide`. */
  'source_incomplete',
  /** Une provenance qui se contredit — voir `sourceCoherente`. */
  'source_incoherente',
  /** Un segment dont le clip n'existe pas dans le jeu annoncé. */
  'clip_introuvable',
] as const;
export type MotifSource = (typeof MOTIFS_SOURCE)[number];

// ---------------------------------------------------------------------------
// Les contrôles
// ---------------------------------------------------------------------------

/**
 * Cette provenance est-elle COMPLÈTE ?
 *
 * ⚠️ PAS DE DEMI-CONTRAT. Un segment portant `rushId` sans `clipSetId` est
 * pire qu'un segment legacy sans provenance du tout : le legacy se répare par
 * l'adaptateur, avec le contexte du plan ; le demi-contrat, lui, a l'air
 * renseigné et sera cru sur parole. Il est donc refusé, jamais complété.
 */
export function sourceValide(v: unknown): v is SourceSegment {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const s = v as Record<string, unknown>;
  for (const cle of ['rushId', 'clipSetId']) {
    if (typeof s[cle] !== 'string' || !UUID.test(s[cle] as string)) return false;
  }
  /* ⚠️ PLUS STRICT QUE `nombreFini`, ET DELIBEREMENT.
     Le reste du moteur tolere `'2'` a la lecture d'une ligne, parce qu'un
     champ de base peut arriver en texte et qu'un jeu de clips de la semaine
     derniere doit rester lisible. La provenance, elle, n'existe nulle part en
     base avant ce lot : aucun `source` historique ne peut etre en texte, donc
     rien n'est a menager. Accepter `'2'` ne servirait qu'a laisser passer une
     provenance fabriquee ailleurs que par ce contrat — exactement ce qu'on
     refuse de croire sur parole. */
  const entier = (v: unknown): boolean =>
    typeof v === 'number' && Number.isInteger(v) && v >= 1;
  if (!entier(s.clipSetVersion) || !entier(s.rangClip)) return false;
  const reel = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (!reel(s.debutSourceSecondes) || !reel(s.finSourceSecondes)) return false;
  if (s.debutSourceSecondes < 0 || s.finSourceSecondes <= s.debutSourceSecondes) {
    return false;
  }
  return true;
}

/**
 * Cette provenance se contredit-elle ?
 *
 * ⚠️ LA DUPLICATION DE `rushId` SE PAIE ICI. Un segment annonçant le rush A
 * alors que son jeu de clips appartient au rush B ferait rendre les bonnes
 * bornes sur le mauvais fichier — un montage qui se joue, qui ne lève aucune
 * erreur, et qui ne montre pas ce qu'il devrait. C'est le seul contrôle que
 * la base ne peut pas faire à notre place : A_7M garantit que le jeu de clips
 * appartient au bon COMPTE, pas que le `rushId` recopié dit vrai.
 *
 * `lignee` est ce que la base sait du jeu de clips. Sans elle, on ne prétend
 * rien : la cohérence est indécidable, pas acquise.
 */
export function sourceCoherente(
  source: SourceSegment, lignee: Pick<IdentiteClipSet, 'rushId'> | null | undefined,
): boolean {
  if (!lignee) return true;
  return source.rushId === lignee.rushId;
}

// ---------------------------------------------------------------------------
// La construction
// ---------------------------------------------------------------------------

/**
 * La provenance d'un clip matérialisé.
 *
 * ⚠️ LE CLIP N'EST PAS MODIFIÉ. A_7a ne change ni comment un clip est
 * découpé, ni ce qui est écrit dans le `jsonb` du jeu — l'identité et le
 * cache des clips single-rush restent au bit près ceux d'avant. La provenance
 * est CALCULÉE à la lecture, à partir de la ligne du jeu, qui la porte déjà.
 */
export function sourceDuClip(
  clip: Pick<ClipMaterialise, 'rang' | 'debutSecondes' | 'finSecondes'>,
  clipSetId: string, clipSetVersion: number,
  lignee: Pick<IdentiteClipSet, 'rushId'>,
): SourceSegment {
  return {
    rushId: lignee.rushId,
    clipSetId,
    clipSetVersion,
    rangClip: clip.rang,
    debutSourceSecondes: arrondirSeconde(clip.debutSecondes),
    finSourceSecondes: arrondirSeconde(clip.finSecondes),
  };
}

/**
 * La provenance d'un SEGMENT, qui n'est pas celle de son clip entier.
 *
 * ⚠️ `entreeSecondes` EST UN DÉCALAGE DANS LE FICHIER DÉCOUPÉ, pas dans le
 * rush. Le montage peut ne garder que 2 s d'un clip de 5 s : la plage source
 * du segment est alors `clip.debut + entree` → `+ duree`, et non les bornes
 * du clip. Prendre les bornes du clip ferait pointer les captions de A_7c sur
 * un passage plus large que ce qui est réellement montré.
 */
export function sourceDuSegment(
  segment: Pick<PlanMontage, 'rangClip' | 'entreeSecondes' | 'dureeRetenueSecondes'>,
  clip: Pick<ClipMaterialise, 'rang' | 'debutSecondes' | 'finSecondes'>,
  clipSetId: string, clipSetVersion: number,
  lignee: Pick<IdentiteClipSet, 'rushId'>,
): SourceSegment {
  const debut = arrondirSeconde(clip.debutSecondes + segment.entreeSecondes);
  return {
    rushId: lignee.rushId,
    clipSetId,
    clipSetVersion,
    rangClip: segment.rangClip,
    debutSourceSecondes: debut,
    finSourceSecondes: arrondirSeconde(debut + segment.dureeRetenueSecondes),
  };
}

// ---------------------------------------------------------------------------
// L'adaptateur — un seul endroit qui connaît le passé
// ---------------------------------------------------------------------------

/**
 * Ce que la base sait d'un jeu de clips, et que le plan ne porte pas.
 *
 * Un plan historique ne mentionne aucun `rushId` : `rush_montage_plans` n'a
 * pas cette colonne, elle vit sur `rush_clip_sets`. Et il ne mentionne aucune
 * borne source : elles vivent sur les clips. L'adaptateur a donc besoin des
 * deux — les inventer serait précisément le « deviner » que ce lot ferme.
 */
export interface ContexteJeuClips {
  clipSetId: string;
  clipSetVersion: number;
  rushId: string;
  clips: readonly Pick<ClipMaterialise, 'rang' | 'debutSecondes' | 'finSecondes'>[];
}

/**
 * Rend un plan source-aware, qu'il vienne d'avant ou d'après A_7a.
 *
 * ⚠️ UN SEUL ENDROIT, ET C'EST TOUT L'INTÉRÊT. La tentation, en ajoutant un
 * champ optionnel, est d'écrire `if (!segment.source)` partout où on en a
 * besoin — une douzaine de branches qui divergeront, dont la moitié oubliera
 * de valider. Ici, le passé est traité une fois ; tout le reste du code
 * travaille sur une forme où la provenance est TOUJOURS présente.
 *
 * ⚠️ N'ÉCRIT RIEN. L'adaptation se fait à la LECTURE. Réécrire les lignes
 * historiques pour leur ajouter une provenance changerait le `jsonb` de plans
 * dont des rendus réussis dépendent, pour un gain nul : la provenance est
 * entièrement déductible du contexte, c'est justement pourquoi elle a pu
 * rester implicite si longtemps.
 */
export function normaliserPlanSourceAware(
  segments: readonly PlanMontage[],
  contexte: readonly ContexteJeuClips[],
): { segments: SegmentSourceAware[] | null; motif: MotifSource | null } {
  const parJeu = new Map(contexte.map((c) => [c.clipSetId, c]));
  const resultat: SegmentSourceAware[] = [];

  for (const segment of segments) {
    const portee = (segment as Partial<SegmentSourceAware>).source;

    // ── Le chemin NOUVEAU : la provenance est écrite, on la contrôle ──
    if (portee !== undefined) {
      if (!sourceValide(portee)) return { segments: null, motif: 'source_incomplete' };
      const jeu = parJeu.get(portee.clipSetId);
      if (!sourceCoherente(portee, jeu)) {
        return { segments: null, motif: 'source_incoherente' };
      }
      resultat.push({ ...segment, source: portee });
      continue;
    }

    // ── Le chemin HISTORIQUE : un plan mono-rush, un seul jeu ─────────
    //
    // ⚠️ EXACTEMENT UN JEU, SINON RIEN. Un segment sans provenance dans un
    // plan qui en compte plusieurs est indécidable : lui en attribuer une au
    // hasard rendrait le mauvais rush sans qu'aucune erreur ne le dise.
    if (contexte.length !== 1) return { segments: null, motif: 'source_incomplete' };
    const jeu = contexte[0];
    const clip = jeu.clips.find((c) => c.rang === segment.rangClip);
    if (!clip) return { segments: null, motif: 'clip_introuvable' };
    resultat.push({
      ...segment,
      source: sourceDuSegment(segment, clip, jeu.clipSetId, jeu.clipSetVersion, jeu),
    });
  }

  return { segments: resultat, motif: null };
}

// ---------------------------------------------------------------------------
// Le jeu de sources — ce qui alimentera `source_set_fingerprint`
// ---------------------------------------------------------------------------

/** Un jeu de clips utilisé par un plan, à sa place dans l'ordre. */
export interface JeuSource {
  clipSetId: string;
  clipSetVersion: number;
}

/**
 * Les jeux de sources d'un plan, dans l'ordre, sans doublon.
 *
 * ⚠️ L'ORDRE EST CELUI DE PREMIÈRE APPARITION, et il compte. `A,B,C` et
 * `B,A,C` sont deux plans différents ; les trier par identifiant les
 * confondrait dans l'empreinte, donc dans le cache, donc au rendu.
 *
 * ⚠️ UN JEU CITÉ TROIS FOIS RESTE UNE SOURCE. Un montage qui alterne
 * `A1,B1,A2` a DEUX sources, pas trois : `source_set_fingerprint` décrit la
 * MATIÈRE employée, pas le découpage. L'ordre des segments, lui, est une
 * autre identité — voir `empreinteSegments`.
 */
export function jeuxSourcesDesSegments(
  segments: readonly SegmentSourceAware[],
): JeuSource[] {
  const vus = new Set<string>();
  const jeux: JeuSource[] = [];
  for (const s of segments) {
    const cle = `${s.source.clipSetId}@${s.source.clipSetVersion}`;
    if (vus.has(cle)) continue;
    vus.add(cle);
    jeux.push({ clipSetId: s.source.clipSetId, clipSetVersion: s.source.clipSetVersion });
  }
  return jeux;
}

/**
 * Fusionne la source SCALAIRE historique et les lignes `plan_sources`.
 *
 * ⚠️ A_7M A BACKFILLÉ. Chaque plan mono-rush possède DÉSORMAIS les deux : sa
 * colonne `clip_set_id` d'origine ET une ligne de source ordinale 0 qui dit
 * la même chose. Les additionner ferait compter deux sources là où il n'y en
 * a qu'une — et un plan à deux sources reçoit une empreinte, donc bascule
 * sous l'index d'identité multi-rush, donc perd ses rendus. La déduplication
 * n'est pas un raffinement, c'est ce qui empêche le backfill de casser le
 * passé.
 *
 * Les lignes font foi quand elles existent : elles portent l'ordre.
 */
export function fusionnerJeuxSources(
  scalaire: JeuSource | null,
  lignes: readonly JeuSource[],
): JeuSource[] {
  if (lignes.length === 0) return scalaire ? [scalaire] : [];
  const vus = new Set<string>();
  const jeux: JeuSource[] = [];
  for (const j of lignes) {
    const cle = `${j.clipSetId}@${j.clipSetVersion}`;
    if (vus.has(cle)) continue;
    vus.add(cle);
    jeux.push(j);
  }
  if (scalaire && !vus.has(`${scalaire.clipSetId}@${scalaire.clipSetVersion}`)) {
    jeux.push(scalaire);
  }
  return jeux;
}

// ---------------------------------------------------------------------------
// Les empreintes
// ---------------------------------------------------------------------------

/**
 * La longueur d'une empreinte, reprise de `rendu-contrat`.
 *
 * La colonne `source_set_fingerprint` accepte 8 à 128 caractères ; 24 tient
 * largement, et garder la même longueur que les empreintes de rendu évite
 * d'avoir deux conventions dans le même moteur.
 */
export const LONGUEUR_EMPREINTE_SOURCES = 24;

/**
 * La forme canonique d'un jeu de sources — champ par champ, ordre fixe.
 *
 * ⚠️ JAMAIS `JSON.stringify`. L'ordre des clés d'un objet littéral dépend de
 * l'ordre d'écriture, qu'un refactor déplace sans le vouloir : deux plans
 * identiques rendraient alors deux empreintes, et le cache manquerait
 * silencieusement. C'est la règle déjà tenue par `recetteCanonique`, et elle
 * vaut ici pour exactement la même raison.
 *
 * ⚠️ LE SÉPARATEUR N'EST PAS COSMÉTIQUE. Sans lui, deux découpages différents
 * des mêmes caractères — une version à deux chiffres suivie d'un identifiant
 * commençant par un chiffre — donneraient la même chaîne.
 */
export function jeuxSourcesCanoniques(jeux: readonly JeuSource[]): string {
  return jeux.map((j) => `${j.clipSetId}@${j.clipSetVersion}`).join('|');
}

/**
 * L'empreinte d'un jeu de sources — la valeur de `source_set_fingerprint`.
 *
 * ⚠️ `null` POUR UNE SOURCE UNIQUE, ET C'EST LA GARANTIE DE
 * RÉTROCOMPATIBILITÉ DU LOT. A_7M a laissé les plans mono-rush gouvernés par
 * `rush_montage_plans_identite_unique`, avec une empreinte NULL ; leur en
 * attribuer une les ferait basculer sous l'index multi-rush et rendrait
 * introuvables des plans dont les MP4 sont déjà rendus et déjà facturés.
 *
 * Un plan mono-rush n'a d'ailleurs rien à empreindre : son identité complète
 * tient déjà dans ses colonnes scalaires.
 */
export function empreinteJeuxSources(jeux: readonly JeuSource[]): string | null {
  if (jeux.length < 2) return null;
  return createHash('sha256')
    .update(jeuxSourcesCanoniques(jeux), 'utf8')
    .digest('hex')
    .slice(0, LONGUEUR_EMPREINTE_SOURCES);
}

/**
 * L'empreinte de l'ORDRE DES SEGMENTS — une autre identité, pour A_7b.
 *
 * ⚠️ CE N'EST PAS L'EMPREINTE DES SOURCES. `A1,B1,A2` et `A1,A2,B1` emploient
 * la même matière — même empreinte de sources — et ne sont pas le même film.
 * Un montage qui alterne entre deux rushes et un montage qui les enchaîne par
 * blocs se regardent différemment ; les confondre reviendrait à servir l'un
 * quand l'autre a été demandé.
 *
 * Chaque segment entre avec son jeu, son rang et sa plage SOURCE : deux
 * segments du même clip mais coupés ailleurs ne montrent pas la même image,
 * et se distinguent donc.
 */
export function empreinteSegments(segments: readonly SegmentSourceAware[]): string {
  const canonique = segments.map((s) => [
    `${s.source.clipSetId}@${s.source.clipSetVersion}`,
    `rang=${s.source.rangClip}`,
    `src=${s.source.debutSourceSecondes.toFixed(3)}-${s.source.finSourceSecondes.toFixed(3)}`,
  ].join(';')).join('|');
  return createHash('sha256')
    .update(canonique, 'utf8')
    .digest('hex')
    .slice(0, LONGUEUR_EMPREINTE_SOURCES);
}
