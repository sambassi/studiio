/**
 * A_3d — LA BIBLIOTHÈQUE DE TRANSITIONS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ CE QUE FAISAIT L'ANCIEN MOTEUR, ET POURQUOI IL S'ARRÊTAIT LÀ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Trois transitions étaient rendues — `cut`, `crossfade`, `flash` — et les
 * deux dernières sont des fondus INTERNES à chaque plan : le clip se ferme au
 * noir dans sa propre durée, le suivant s'ouvre dans la sienne. Aucun
 * recouvrement, donc la durée du montage reste EXACTEMENT celle du plan.
 *
 * C'était voulu, et c'est écrit noir sur blanc dans `rendu-style` : un
 * `xfade` fait se chevaucher deux plans, raccourcit le montage de
 * (n-1) × durée, et `resultatConforme` — qui compare la durée mesurée à
 * `plan.dureeTotaleSecondes` — refusait alors le fichier produit.
 *
 * Ce lot lève cet obstacle en RENDANT LE RECOUVREMENT EXPLICITE : il est
 * calculé, transporté, retiré de la durée attendue, et vérifié. La mesure
 * devient plus stricte qu'avant, pas plus laxiste — elle contrôle désormais
 * que le recouvrement a bien été appliqué.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ VINGT-SIX EFFETS `xfade`, VÉRIFIÉS SUR LES DEUX BINAIRES
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `ffmpeg -h filter=xfade` rend la MÊME liste de 47 effets sur le binaire
 * embarqué (6.0) et dans le conteneur de production (5.1.9, Debian 12). Zéro
 * divergence : aucun effet n'est offert ici sans être présent des deux côtés.
 *
 * `custom` est exclu — il prend une EXPRESSION, c'est-à-dire un langage. Rien
 * de ce que le navigateur envoie ne doit pouvoir en devenir une.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ AUCUNE CARTE QUASI IDENTIQUE À UNE AUTRE, ET C'EST MESURÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Vingt-neuf candidats ont été rendus sur la même paire de plans, puis
 * comparés deux à deux — écart moyen absolu par pixel, à trois instants du
 * recouvrement (25 %, 50 %, 75 %). Sur 406 paires, une seule tombait sous le
 * seuil de 8/255 : `rectcrop` et `circlecrop`, tous deux entièrement noirs à
 * mi-parcours. `rectcrop` a été retiré.
 *
 * ⚠️ `fadeblack` ET `fadewhite` SONT ÉCARTÉS POUR LA MÊME RAISON, mais face
 * aux transitions HISTORIQUES : `crossfade` et `flash` produisent déjà un
 * passage par le noir et par le blanc. Deux cartes pour un même résultat
 * visible est exactement le défaut que le cahier des charges reproche aux
 * icônes en double.
 */
import type { EntreeCreative } from './catalogue-contrat';

export const VERSION_TRANSITIONS = 'transition-v1';

/**
 * Comment la transition est fabriquée.
 *
 * `coupe` : rien du tout, les plans se suivent.
 * `fondu-couleur` : les deux fondus internes historiques, SANS recouvrement.
 * `xfade` : un vrai recouvrement, qui raccourcit le montage.
 */
export const MOTEURS_TRANSITION = ['coupe', 'fondu-couleur', 'xfade'] as const;
export type MoteurTransition = (typeof MOTEURS_TRANSITION)[number];

export interface TransitionCreative extends EntreeCreative {
  famille: 'transition';
  moteur: MoteurTransition;
  /**
   * Le nom `xfade`, CHOISI DANS CE FICHIER et nulle part ailleurs.
   *
   * ⚠️ LE NAVIGATEUR N'ENVOIE QU'UN `id`. Ce champ est la seule chose qui
   * atteint la ligne de commande, et il ne peut valoir qu'une des vingt-six
   * chaînes écrites ci-dessous.
   */
  xfadeId: string | null;
  /** La durée du recouvrement, en millisecondes. Bornée par le moteur. */
  dureeDefautMs: number;
  /** Ce qu'on fait du son des rushes à cette jonction. */
  audio: 'coupe' | 'fondu-court';
}

/** Les durées que le moteur accepte. Rien en dehors n'est écrit. */
export const DUREE_TRANSITION_MIN_MS = 150;
export const DUREE_TRANSITION_MAX_MS = 900;

const t = (
  id: string, nom: string, categorie: EntreeCreative['categorie'],
  tags: string[], description: string,
  moteur: MoteurTransition, xfadeId: string | null, dureeDefautMs: number,
): TransitionCreative => ({
  id, nom, famille: 'transition', categorie, tags, description,
  rendu: true, version: VERSION_TRANSITIONS,
  moteur, xfadeId, dureeDefautMs,
  audio: moteur === 'coupe' ? 'coupe' : 'fondu-court',
});

export const TRANSITIONS_CREATIVES: readonly TransitionCreative[] = [
  // ── SOBRE ───────────────────────────────────────────────────────────
  t('cut', 'Coupe franche', 'sobre', ['coupe', 'aucune', 'net', 'direct'],
    'Les plans se suivent, sans effet.', 'coupe', null, 0),
  t('crossfade', 'Fondu au noir', 'sobre', ['fondu', 'noir', 'doux', 'classique'],
    'Chaque plan se ferme au noir avant le suivant.', 'fondu-couleur', null, 400),
  t('fondu', 'Fondu enchaîné', 'sobre', ['fondu', 'doux', 'enchaine', 'classique'],
    'Un plan se fond dans l’autre.', 'xfade', 'fade', 500),
  t('dissolution', 'Dissolution', 'sobre', ['dissolution', 'grain', 'doux'],
    'Le premier plan se dissout par petits points.', 'xfade', 'dissolve', 500),

  // ── DIRECTIONNEL ────────────────────────────────────────────────────
  t('glisse-gauche', 'Glisse vers la gauche', 'social',
    ['glisse', 'gauche', 'lateral', 'dynamique'],
    'Le nouveau plan pousse l’ancien vers la gauche.', 'xfade', 'slideleft', 400),
  t('glisse-droite', 'Glisse vers la droite', 'social',
    ['glisse', 'droite', 'lateral', 'dynamique'],
    'Le nouveau plan pousse l’ancien vers la droite.', 'xfade', 'slideright', 400),
  t('glisse-haut', 'Glisse vers le haut', 'social',
    ['glisse', 'haut', 'vertical', 'dynamique'],
    'Le nouveau plan pousse l’ancien vers le haut.', 'xfade', 'slideup', 400),
  t('glisse-bas', 'Glisse vers le bas', 'social',
    ['glisse', 'bas', 'vertical', 'dynamique'],
    'Le nouveau plan pousse l’ancien vers le bas.', 'xfade', 'slidedown', 400),
  t('balayage-gauche', 'Balayage vers la gauche', 'social',
    ['balayage', 'gauche', 'volet'],
    'Le nouveau plan se découvre depuis la droite.', 'xfade', 'wipeleft', 400),
  t('balayage-droite', 'Balayage vers la droite', 'social',
    ['balayage', 'droite', 'volet'],
    'Le nouveau plan se découvre depuis la gauche.', 'xfade', 'wiperight', 400),
  t('balayage-haut', 'Balayage vers le haut', 'social',
    ['balayage', 'haut', 'volet'],
    'Le nouveau plan se découvre depuis le bas.', 'xfade', 'wipeup', 400),
  t('balayage-bas', 'Balayage vers le bas', 'social',
    ['balayage', 'bas', 'volet'],
    'Le nouveau plan se découvre depuis le haut.', 'xfade', 'wipedown', 400),
  t('diagonale', 'Diagonale', 'social', ['diagonale', 'coin', 'oblique'],
    'Le nouveau plan arrive par un coin.', 'xfade', 'diagtl', 450),

  // ── CINÉMA ──────────────────────────────────────────────────────────
  t('ouverture-cercle', 'Ouverture en cercle', 'cinema',
    ['cercle', 'ouverture', 'iris'],
    'Le nouveau plan s’ouvre en cercle depuis le centre.', 'xfade', 'circleopen', 600),
  t('fermeture-cercle', 'Fermeture en cercle', 'cinema',
    ['cercle', 'fermeture', 'iris'],
    'L’ancien plan se referme en cercle.', 'xfade', 'circleclose', 600),
  t('iris-noir', 'Iris au noir', 'cinema', ['cercle', 'noir', 'iris', 'dramatique'],
    'L’image se referme au noir, puis se rouvre.', 'xfade', 'circlecrop', 700),
  t('ouverture-centre', 'Ouverture au centre', 'cinema',
    ['ouverture', 'rideau', 'centre'],
    'L’image s’écarte par le milieu.', 'xfade', 'vertopen', 600),
  t('fermeture-centre', 'Fermeture au centre', 'cinema',
    ['fermeture', 'rideau', 'centre'],
    'L’image se referme par le milieu.', 'xfade', 'horzclose', 600),
  t('fondu-gris', 'Fondu en gris', 'cinema', ['fondu', 'gris', 'sobre', 'doux'],
    'Les couleurs se retirent le temps du passage.', 'xfade', 'fadegrays', 600),

  // ── AMBIANCE ────────────────────────────────────────────────────────
  t('vague-gauche', 'Vague vers la gauche', 'ambiance',
    ['vague', 'gauche', 'doux', 'progressif'],
    'Un balayage aux bords fondus, vers la gauche.', 'xfade', 'smoothleft', 600),
  t('vague-droite', 'Vague vers la droite', 'ambiance',
    ['vague', 'droite', 'doux', 'progressif'],
    'Un balayage aux bords fondus, vers la droite.', 'xfade', 'smoothright', 600),
  t('eloignement', 'Éloignement', 'ambiance', ['distance', 'doux', 'onirique'],
    'Les deux plans se mêlent par leurs contrastes.', 'xfade', 'distance', 600),

  // ── ÉNERGIE ─────────────────────────────────────────────────────────
  t('flash', 'Flash blanc', 'energie', ['flash', 'blanc', 'vif', 'classique'],
    'Un éclair blanc entre les deux plans.', 'fondu-couleur', null, 300),
  t('zoom-avant', 'Zoom avant', 'energie', ['zoom', 'avant', 'vif', 'dynamique'],
    'Le nouveau plan arrive en avançant.', 'xfade', 'zoomin', 400),
  t('pixels', 'Pixels', 'energie', ['pixels', 'numerique', 'vif'],
    'L’image se pixellise puis se reforme.', 'xfade', 'pixelize', 350),
  t('balayage-circulaire', 'Balayage circulaire', 'energie',
    ['radial', 'horloge', 'rotation'],
    'Une aiguille balaie l’image.', 'xfade', 'radial', 450),
  t('flou-de-passage', 'Flou de passage', 'energie', ['flou', 'vitesse', 'vif'],
    'Un flou horizontal emporte le plan.', 'xfade', 'hblur', 350),
  t('compression', 'Compression', 'energie', ['compression', 'ecrase', 'vif'],
    'L’ancien plan s’écrase sur le côté.', 'xfade', 'squeezeh', 350),
  t('lamelles', 'Lamelles', 'energie', ['lamelles', 'bandes', 'graphique'],
    'L’image se décale en bandes horizontales.', 'xfade', 'hlslice', 400),
];

export const TRANSITION_CREATIVE_IDS: readonly string[] =
  TRANSITIONS_CREATIVES.map((x) => x.id);

/**
 * ⚠️ LES SEULS NOMS `xfade` QUE LE MOTEUR ÉCRIRA JAMAIS.
 *
 * Le graphe ne lit pas un champ : il cherche dans cet ensemble. Un
 * identifiant hors catalogue ne produit donc pas un nom inconnu passé à
 * ffmpeg — il ne produit AUCUNE transition.
 */
export const XFADE_AUTORISES: ReadonlySet<string> = new Set(
  TRANSITIONS_CREATIVES.map((x) => x.xfadeId).filter((x): x is string => x !== null),
);

export function transitionCreativeParId(id: unknown): TransitionCreative | null {
  if (typeof id !== 'string') return null;
  return TRANSITIONS_CREATIVES.find((x) => x.id === id) ?? null;
}

/**
 * Les identifiants d'AVANT ce lot qui ne sont pas dans la bibliothèque.
 *
 * ⚠️ ILS RESTENT VALIDES, ET ILS RESTENT RENDUS COMME AVANT. `zoom`, `slide`,
 * `whip` et `blur` étaient acceptés par le contrat et rendus comme une coupe,
 * tracés dans `usage.transitionsNonRendues`. Les faire pointer maintenant
 * vers un vrai effet CHANGERAIT la vidéo de qui les avait choisis, sans que
 * personne ne l'ait demandé. Ils gardent donc leur comportement, et
 * disparaissent seulement de la grille — où ils étaient des cartes mortes.
 */
export const TRANSITIONS_HERITEES: readonly string[] = ['zoom', 'slide', 'whip', 'blur'];
