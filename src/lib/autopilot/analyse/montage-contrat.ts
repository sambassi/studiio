/**
 * M3-G — LE PLAN DE MONTAGE : CE QUI EST DÉCIDÉ, ET RIEN QUI SOIT PRODUIT.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE LOT DÉCIDE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * M3-F a produit des octets : cinq ou six fichiers MP4, aux bornes que M3-E
 * avait calées au millième. Personne, jusqu'ici, ne sait qu'en faire. Le
 * moteur de rendu du site ne sait recevoir qu'UNE source vidéo
 * (`CreerSimpleRenderInput.videoUrl`) ; il ne connaît pas la notion de liste
 * de plans.
 *
 * M3-G est la traduction manquante. Il décide quatre choses, et seulement
 * elles :
 *
 *   • QUELS clips entrent dans le montage, et lesquels sont écartés ;
 *   • DANS QUEL ORDRE ils passent ;
 *   • COMBIEN DE TEMPS chacun dure, et à quel instant il commence ;
 *   • COMMENT chacun est recadré vers le format demandé.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'IL NE FAIT NULLE PART
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Aucun octet. Aucun ffmpeg, aucun Remotion, aucun fournisseur, aucun réseau
 * sortant, aucun crédit, aucune URL. Le module entier est une fonction des
 * données déjà en base vers une structure : c'est ce qui le rend vérifiable
 * sur des valeurs, comme `coupe.ts` de M3-E.
 *
 * Ni sous-titre, ni musique, ni étalonnage, ni effet, ni fondu, ni habillage,
 * ni miniature, ni publication. Le rendu appartient à M3-H.
 */
import {
  CLIPS_MAX, SET_SECONDES_MAX, arrondirSeconde, nombreFini,
  type ClipMaterialise,
} from './clip-contrat';
import { VIDEO_SIZE, RUSH_SEQUENCE_SECONDS } from '@/lib/creer/designSpec';

// ───────────────────────────────────────────────────────────────────────────
// L'identité de l'algorithme
// ───────────────────────────────────────────────────────────────────────────

/**
 * Comment le PLAN a été décidé.
 *
 * Le pendant de `ALGORITHME_COUPES` ('m3e-v1') pour les bornes et de
 * `METHODE_MATERIALISATION` ('x264-crf23-v1') pour les octets. Trois
 * questions distinctes, trois réponses distinctes : « où couper »,
 * « comment encoder », « comment monter ». Les confondre rendrait
 * impossible de dire, devant un fichier, ce qui a changé depuis la veille.
 */
export const ALGORITHME_PLAN = 'm3g-v1' as const;

// ───────────────────────────────────────────────────────────────────────────
// Le format cible
// ───────────────────────────────────────────────────────────────────────────

/**
 * Les trois formats, repris de l'éditeur — jamais redéclarés.
 *
 * `VIDEO_SIZE` de `designSpec.ts` est déjà la source unique des dimensions
 * pour les deux moteurs de rendu du site. En écrire un quatrième jeu ici
 * aurait créé un vocabulaire de plus, et la divergence ne se serait vue
 * qu'en comparant deux vidéos image par image.
 */
export const FORMATS_MONTAGE = ['9:16', '1:1', '16:9'] as const;
export type FormatMontage = (typeof FORMATS_MONTAGE)[number];

export function formatValide(v: unknown): v is FormatMontage {
  return typeof v === 'string' && (FORMATS_MONTAGE as readonly string[]).includes(v);
}

/** Les dimensions du format, prises dans `VIDEO_SIZE` et nulle part ailleurs. */
export function dimensionsCible(format: FormatMontage): { largeur: number; hauteur: number } {
  const t = VIDEO_SIZE[format];
  return { largeur: t.w, hauteur: t.h };
}

// ───────────────────────────────────────────────────────────────────────────
// La durée cible
// ───────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ AUCUNE DURÉE UNIVERSELLE CACHÉE, ET AUCUNE PLAGE PAR RATIO.
 *
 * Le cadrage a cherché une durée cible déjà connue du produit : il n'en
 * existe aucune. `autopilot_config` porte la cadence, les plateformes, la
 * musique et les couleurs, mais pas une seconde de durée ; `shoot_sessions`
 * porte un titre et un contexte ; `objectives` porte une plateforme et un
 * ton ; et `DUREES_CANDIDAT_SECONDES` de M3-C ([3, 5, 8, 12]) est la durée
 * d'UN PLAN, jamais celle d'un montage.
 *
 * La durée cible est donc un paramètre EXPLICITE de l'appelant. Un appel qui
 * ne la porte pas est refusé : inventer trente secondes par défaut aurait
 * produit un montage que personne n'a demandé, et que rien dans la réponse
 * n'aurait signalé comme arbitraire.
 *
 * Les deux bornes ci-dessous sont CALCULÉES depuis ce que la chaîne peut
 * réellement fournir, et sont les MÊMES pour les trois formats. Une plage
 * par ratio serait exactement la durée inventée que l'arbitrage interdit :
 * rien, dans un rapport largeur/hauteur, ne dit combien de temps une vidéo
 * doit durer.
 */
export const DUREE_CIBLE_MIN_SECONDES = RUSH_SEQUENCE_SECONDS.min;

/**
 * Le plafond vient de M3-F, pas d'une préférence.
 *
 * `SET_SECONDES_MAX` borne déjà la matière qu'un jeu de clips peut contenir.
 * Viser plus long serait viser une durée que la chaîne ne sait pas remplir :
 * le plan sortirait systématiquement en déficit, et le déficit cesserait
 * d'être un signal.
 */
export const DUREE_CIBLE_MAX_SECONDES = SET_SECONDES_MAX;

/** Au plus autant de plans que M3-F sait produire de clips. */
export const PLANS_MAX = CLIPS_MAX;

/**
 * En dessous, un plan n'est plus un plan.
 *
 * Reprise de `RUSH_SEQUENCE_SECONDS.min`, la durée plancher que l'éditeur
 * applique déjà à une séquence de rush. Sert au raccourcissement du dernier
 * plan : le ramener à deux dixièmes de seconde pour tomber pile sur la cible
 * produirait un clignotement, pas un plan.
 */
export const DUREE_PLAN_MIN_SECONDES = RUSH_SEQUENCE_SECONDS.min;

export function dureeCibleValide(v: unknown): v is number {
  const n = nombreFini(v);
  return n !== null && n >= DUREE_CIBLE_MIN_SECONDES && n <= DUREE_CIBLE_MAX_SECONDES;
}

// ───────────────────────────────────────────────────────────────────────────
// Le raccord
// ───────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ UN VOCABULAIRE FERMÉ À UNE SEULE VALEUR, ET C'EST VOULU.
 *
 * Le champ existe alors qu'il n'a qu'une valeur possible. Deux raisons.
 *
 * D'abord, ajouter 'fondu' plus tard sera une valeur de plus dans le `check`
 * de la migration, sans changer la forme de la sortie ni casser M3-H.
 *
 * Ensuite et surtout : un champ ÉCRIT empêche qu'un fondu s'installe un jour
 * comme comportement implicite. `TRANSITION_SECONDS` (0,8 s) existe déjà dans
 * `designSpec.ts` et attend M3-J ; tant que le raccord est une coupe, il ne
 * doit intervenir nulle part.
 *
 * Conséquence arithmétique, que les tests gardent : avec des coupes franches,
 * la durée totale est EXACTEMENT la somme des durées retenues, et chaque plan
 * commence là où le précédent finit. Le jour du premier fondu, cette égalité
 * cassera — et le test forcera à traiter le recouvrement plutôt qu'à
 * l'oublier.
 */
export const RACCORDS = ['coupe'] as const;
export type Raccord = (typeof RACCORDS)[number];
export const RACCORD_DEFAUT: Raccord = 'coupe';

// ───────────────────────────────────────────────────────────────────────────
// Le recadrage
// ───────────────────────────────────────────────────────────────────────────

/**
 * Un rectangle NORMALISÉ dans le repère de la source : fractions de 0 à 1.
 *
 * ⚠️ DES FRACTIONS, PAS DES PIXELS. Un rectangle en pixels aurait figé dans
 * le plan la résolution du clip d'aujourd'hui : rejouer le même plan sur une
 * source réencodée en 720p aurait recadré à côté, sans que rien ne proteste.
 *
 * Une fraction se traduit aussi bien en `crop=iw*w:ih*h:iw*x:ih*y` pour
 * ffmpeg qu'en transformation CSS pour Remotion. M3-G ne présume donc PAS du
 * moteur que M3-H choisira.
 */
export interface Recadrage {
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
}

/** La stratégie retenue, dite explicitement plutôt que devinée du rectangle. */
export const STRATEGIES_RECADRAGE = ['aucun', 'centre-largeur', 'centre-hauteur'] as const;
export type StrategieRecadrage = (typeof STRATEGIES_RECADRAGE)[number];

/**
 * L'écart admis avant de recadrer quoi que ce soit.
 *
 * Une source 1920×1080 vers du 16:9 donne un rapport identique au millième
 * près ; un arrondi de conteneur peut donner 1,7778 contre 1,77777. Recadrer
 * pour ça retirerait un pixel et ferait une mise à l'échelle inutile.
 */
export const TOLERANCE_RATIO = 0.001;

/**
 * Le rectangle à prélever dans la source pour remplir le format cible.
 *
 * Trois cas, et aucun quatrième :
 *
 *   • même rapport → `aucun`, le rectangle est la source entière ;
 *   • source plus LARGE que la cible → on prélève sur la largeur, centré ;
 *   • source plus HAUTE que la cible → on prélève sur la hauteur, centré.
 *
 * ⚠️ ON NE SORT JAMAIS DE LA SOURCE. Un rush vertical vers du 16:9 est
 * recadré sur sa hauteur ; on n'ajoute ni bandes noires, ni fond flou, ni
 * agrandissement — ce serait de l'HABILLAGE, donc M3-J, et cela mentirait
 * sur ce que le cadreur a filmé.
 *
 * Le centrage est le défaut déterministe. Le suivi de sujet et le
 * repositionnement manuel viendront d'un lot ultérieur ; ils changeront `x`
 * et `y`, pas la forme du rectangle.
 */
export function recadrer(
  largeurSource: number, hauteurSource: number, format: FormatMontage,
): { recadrage: Recadrage; strategie: StrategieRecadrage } | null {
  if (!Number.isFinite(largeurSource) || !Number.isFinite(hauteurSource)) return null;
  if (largeurSource <= 0 || hauteurSource <= 0) return null;

  const cible = dimensionsCible(format);
  const ratioSource = largeurSource / hauteurSource;
  const ratioCible = cible.largeur / cible.hauteur;

  if (Math.abs(ratioSource - ratioCible) <= TOLERANCE_RATIO) {
    return {
      recadrage: { x: 0, y: 0, largeur: 1, hauteur: 1 },
      strategie: 'aucun',
    };
  }

  if (ratioSource > ratioCible) {
    // Trop large : on garde toute la hauteur et on prélève au centre.
    const fraction = ratioCible / ratioSource;
    return {
      recadrage: {
        x: arrondirFraction((1 - fraction) / 2),
        y: 0,
        largeur: arrondirFraction(fraction),
        hauteur: 1,
      },
      strategie: 'centre-largeur',
    };
  }

  // Trop haute : on garde toute la largeur et on prélève au centre.
  const fraction = ratioSource / ratioCible;
  return {
    recadrage: {
      x: 0,
      y: arrondirFraction((1 - fraction) / 2),
      largeur: 1,
      hauteur: arrondirFraction(fraction),
    },
    strategie: 'centre-hauteur',
  };
}

/**
 * Six décimales : à 1920 pixels, le pas vaut deux millièmes de pixel.
 *
 * Assez fin pour qu'aucun recadrage ne se voie, assez grossier pour qu'un
 * plan relu rende exactement le nombre qu'il portait — ce que ne garantit
 * pas un flottant brut passé par JSON puis par `numeric`.
 */
export function arrondirFraction(n: number): number {
  const r = Math.round(n * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
}

// ───────────────────────────────────────────────────────────────────────────
// Les formes
// ───────────────────────────────────────────────────────────────────────────

/** La géométrie de la source d'un clip, telle que M3-B l'a mesurée. */
export interface GeometrieSource {
  largeur: number;
  hauteur: number;
  fps: number;
}

/** Un plan du montage : d'où il vient, quand il passe, comment il est cadré. */
export interface PlanMontage {
  /** Sa place dans le montage, à partir de 1. */
  ordre: number;
  /** Le clip M3-F dont il sort — sa traçabilité vers les octets. */
  rangClip: number;
  bucket: string;
  cle: string;
  /** Où entrer DANS LE CLIP, dont le repère commence à zéro. */
  entreeSecondes: number;
  /** Ce qu'il dure dans le montage — jamais plus que le clip. */
  dureeRetenueSecondes: number;
  /** À quel instant du montage il commence. */
  debutTimelineSecondes: number;
  /** Le clip a-t-il été raccourci pour tomber sur la cible ? */
  raccourci: boolean;
  recadrage: Recadrage;
  strategieRecadrage: StrategieRecadrage;
  /** La géométrie d'où le rectangle a été calculé, pour la relecture. */
  largeurSource: number;
  hauteurSource: number;
  raccordEntrant: Raccord;
}

/**
 * Ce qui fait qu'un plan EST le même plan.
 *
 * ⚠️ LE FORMAT ET LA DURÉE CIBLE EN FONT PARTIE. Un même jeu de clips doit
 * pouvoir porter un 9:16 de vingt-cinq secondes ET un 16:9 d'une minute :
 * ce sont deux plans légitimes, pas deux versions du même. Les omettre
 * aurait rendu le premier plan calculé pour toute demande ultérieure.
 *
 * Le reste est hérité du jeu de clips sans être recalculé : un plan bâti sur
 * d'autres octets n'est pas le même plan, même si la décision de coupe est
 * identique.
 */
export interface IdentitePlan {
  clipSetId: string;
  clipSetVersion: number;
  candidateSetId: string;
  analysisId: string;
  algorithme: string;
  methodeMaterialisation: string;
  algorithmePlan: string;
  format: FormatMontage;
  dureeCibleSecondes: number;
}

export interface MontagePlan extends IdentitePlan {
  id: string;
  userId: string;
  version: number;
  largeurCible: number;
  hauteurCible: number;
  fps: number;
  plans: PlanMontage[];
  /** Ce que le plan dure réellement — la somme des durées retenues. */
  dureeTotaleSecondes: number;
  /**
   * Ce qui manque pour atteindre la cible, en secondes.
   *
   * ⚠️ EXPOSÉ, JAMAIS COMBLÉ. Ni rallongement d'un plan, ni répétition d'un
   * clip : la matière disponible est ce qu'elle est, et le dire est la seule
   * réponse honnête. Zéro quand la cible est atteinte.
   */
  ecartSecondes: number;
  clipsEcartes: number;
  usage: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ───────────────────────────────────────────────────────────────────────────
// Les refus
// ───────────────────────────────────────────────────────────────────────────

/**
 * Le vocabulaire fermé des refus.
 *
 * Même principe qu'en M3-C, M3-D2, M3-E et M3-F : un motif est une valeur
 * qu'on peut traduire, compter et tester. Un message libre ne se compare pas.
 */
export const MOTIFS_PLAN = [
  'jeu_non_reussi',
  'jeu_sans_clip',
  'format_invalide',
  'duree_cible_invalide',
  'geometrie_inconnue',
  'plan_vide',
] as const;
export type MotifPlan = (typeof MOTIFS_PLAN)[number];

// ───────────────────────────────────────────────────────────────────────────
// Les gardes de relecture
// ───────────────────────────────────────────────────────────────────────────

/**
 * Un plan relu porte-t-il ce qu'il prétend porter ?
 *
 * Reprend la garde de `clipMaterialiseValide` : ce qui a été écrit par une
 * version antérieure du code, ou par une main, ne doit pas être servi comme
 * s'il était complet. Une URL dans un plan est le signe qu'on a persisté une
 * signature — la table n'en veut aucune.
 */
export function planValide(v: unknown): v is PlanMontage {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  const nombres = ['ordre', 'rangClip', 'entreeSecondes', 'dureeRetenueSecondes',
    'debutTimelineSecondes', 'largeurSource', 'hauteurSource'];
  for (const c of nombres) if (nombreFini(p[c]) === null) return false;
  if (typeof p.bucket !== 'string' || p.bucket.length === 0) return false;
  if (typeof p.cle !== 'string' || p.cle.length === 0) return false;
  if (p.cle.includes('://')) return false;
  if (!(RACCORDS as readonly string[]).includes(String(p.raccordEntrant))) return false;
  if (!(STRATEGIES_RECADRAGE as readonly string[]).includes(String(p.strategieRecadrage))) {
    return false;
  }
  const r = p.recadrage as Record<string, unknown> | undefined;
  if (typeof r !== 'object' || r === null) return false;
  for (const c of ['x', 'y', 'largeur', 'hauteur']) {
    const n = nombreFini(r[c]);
    if (n === null || n < 0 || n > 1) return false;
  }
  return true;
}

/**
 * Un clip est-il utilisable comme plan ?
 *
 * ⚠️ LA DURÉE MESURÉE FAIT FOI, jamais la demandée. M3-F a payé son coût en
 * CPU précisément pour mesurer ce que le fichier dure VRAIMENT : sur le rush
 * de production, quatre clips sont tombés au millième et le cinquième à
 * quatorze millisecondes de la demande. Reprendre la valeur demandée aurait
 * rendu cette mesure inutile, et le montage aurait dérivé plan après plan.
 */
export function dureeUtilisable(clip: ClipMaterialise): number | null {
  const mesuree = nombreFini(clip.dureeMesureeSecondes);
  const demandee = nombreFini(clip.dureeSecondes);
  const retenue = mesuree !== null && mesuree > 0 ? mesuree : demandee;
  if (retenue === null || retenue <= 0) return null;
  return arrondirSeconde(retenue);
}
