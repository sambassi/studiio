/**
 * A_3c1 — LES ANIMATIONS DE BLOC, ET LEUR MOTEUR TEMPOREL.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI EXISTAIT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un `drawtext` STATIQUE, allumé puis éteint par `enable=between(t,…)`. Le
 * texte apparaissait d'un coup et disparaissait de même. Le profil portait
 * bien un champ `animations.texteId`, validé et persisté — et consommé par
 * personne, comme les textes avant A_1.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ TROIS LEVIERS, ET ILS ONT ÉTÉ MESURÉS AVANT D'ÊTRE UTILISÉS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `drawtext` évalue `alpha`, `x`, `y` et `fontsize` À CHAQUE IMAGE. Vérifié
 * sur ce binaire, sur 50 images :
 *
 *   alpha    → luminance moyenne 0,00 → 2,60 → 5,43
 *   fontsize → luminance moyenne 1,32 → 3,02 → 5,43
 *   y        → centre vertical du texte 196,5 → 167,5 → 136,5 px
 *
 * ⚠️ ET LA PREMIÈRE MESURE DU DÉPLACEMENT ÉTAIT FAUSSE : comparer la
 * luminance MOYENNE ne détecte pas un mouvement — un texte qui se déplace a
 * exactement la même moyenne. Il a fallu mesurer le barycentre vertical.
 * C'est pourquoi les tests de ce lot mesurent la POSITION, pas l'intensité.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ AUCUNE EXPRESSION NE VIENT DU NAVIGATEUR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le client n'envoie qu'un identifiant. Les expressions sont fabriquées ici,
 * à partir de nombres que le serveur calcule. Une expression reçue serait un
 * langage exécuté par ffmpeg sur nos machines.
 */
import type { EntreeCreative } from './catalogue-contrat';

export const VERSION_ANIMATIONS_TEXTE = 'anim-texte-v1';

/** Deux familles, et elles ne se mélangent pas. */
export const TYPES_ANIMATION = ['bloc', 'contenu'] as const;
export type TypeAnimation = (typeof TYPES_ANIMATION)[number];

/**
 * Ce qu'une animation de BLOC fait, en trois leviers.
 *
 * Chaque champ décrit un ÉTAT DE DÉPART, ramené à l'état final pendant la
 * phase d'entrée. `null` = ce levier ne bouge pas.
 */
export interface GesteBloc {
  /** Opacité au départ. `1` = pas de fondu. */
  alphaDepart: number;
  /** Décalage horizontal au départ, en part de la LARGEUR du cadre. */
  decalageXPct: number;
  /** Décalage vertical au départ, en part de la HAUTEUR du cadre. */
  decalageYPct: number;
  /** Échelle au départ. `1` = taille finale d'emblée. */
  echelleDepart: number;
  /**
   * Dépassement : l'échelle monte au-delà de 1 avant de redescendre.
   * `0` = aucun. C'est ce qui fait un « pop » plutôt qu'un zoom.
   */
  depassement: number;
  /** L'animation se rejoue-t-elle à l'envers à la sortie ? */
  sortie: boolean;
}

export interface AnimationTexteCreative extends EntreeCreative {
  famille: 'animation-texte';
  type: TypeAnimation;
  /** La durée de la phase d'entrée, en secondes. */
  dureeEntreeSecondes: number;
  /** La durée de la phase de sortie. `0` si l'animation n'en a pas. */
  dureeSortieSecondes: number;
  geste: GesteBloc;
}

const NEUTRE: GesteBloc = {
  alphaDepart: 1, decalageXPct: 0, decalageYPct: 0,
  echelleDepart: 1, depassement: 0, sortie: false,
};

const a = (
  id: string, nom: string, categorie: EntreeCreative['categorie'],
  tags: string[], description: string,
  dureeEntreeSecondes: number, dureeSortieSecondes: number,
  geste: Partial<GesteBloc>,
): AnimationTexteCreative => ({
  id, nom, famille: 'animation-texte', categorie, tags, description,
  rendu: true, version: VERSION_ANIMATIONS_TEXTE, type: 'bloc',
  dureeEntreeSecondes, dureeSortieSecondes, geste: { ...NEUTRE, ...geste },
});

export const ANIMATIONS_TEXTE: readonly AnimationTexteCreative[] = [
  /* ⚠️ « AUCUNE » REPRODUIT EXACTEMENT LE RENDU D'AVANT CE LOT : le texte
     apparaît et disparaît net. C'est ce qui permet de livrer une
     bibliothèque sans changer une seule vidéo existante. */
  a('aucune', 'Aucune', 'sobre', ['statique', 'net', 'defaut'],
    'Le texte apparaît net, sans effet.', 0, 0, {}),

  // ── SOBRE ───────────────────────────────────────────────────────────
  a('fondu-entree', 'Fondu', 'sobre', ['fade', 'doux', 'apparition'],
    'Apparition en douceur.', 0.5, 0, { alphaDepart: 0 }),
  a('fondu-entree-sortie', 'Fondu entrée-sortie', 'sobre',
    ['fade', 'doux', 'disparition'],
    'Apparaît et disparaît en douceur.', 0.5, 0.5, { alphaDepart: 0, sortie: true }),
  a('fondu-lent', 'Fondu lent', 'cinema', ['fade', 'lent', 'film'],
    'Une apparition longue, tenue.', 1.2, 0.8, { alphaDepart: 0, sortie: true }),
  a('montee', 'Montée', 'sobre', ['rise', 'bas', 'doux'],
    'Le texte monte doucement à sa place.', 0.6, 0,
    { alphaDepart: 0, decalageYPct: 4 }),
  a('descente', 'Descente', 'sobre', ['drop', 'haut', 'doux'],
    'Le texte descend à sa place.', 0.6, 0,
    { alphaDepart: 0, decalageYPct: -4 }),

  // ── SOCIAL ──────────────────────────────────────────────────────────
  a('glisse-haut', 'Glisse vers le haut', 'social', ['slide', 'bas', 'reel'],
    'Arrive du bas, franchement.', 0.4, 0, { decalageYPct: 8 }),
  a('glisse-bas', 'Glisse vers le bas', 'social', ['slide', 'haut'],
    'Arrive du haut.', 0.4, 0, { decalageYPct: -8 }),
  a('glisse-gauche', 'Glisse vers la gauche', 'social', ['slide', 'droite'],
    'Arrive de la droite.', 0.4, 0, { decalageXPct: 10 }),
  a('glisse-droite', 'Glisse vers la droite', 'social', ['slide', 'gauche'],
    'Arrive de la gauche.', 0.4, 0, { decalageXPct: -10 }),
  a('zoom-avant', 'Zoom avant', 'social', ['zoom', 'grandit'],
    'Grandit jusqu’à sa taille.', 0.45, 0,
    { alphaDepart: 0, echelleDepart: 0.7 }),
  a('zoom-arriere', 'Zoom arrière', 'social', ['zoom', 'retrecit'],
    'Rétrécit jusqu’à sa taille.', 0.45, 0,
    { alphaDepart: 0, echelleDepart: 1.35 }),
  a('pop', 'Pop', 'social', ['pop', 'rebond', 'court'],
    'Dépasse légèrement puis se pose.', 0.4, 0,
    { alphaDepart: 0, echelleDepart: 0.75, depassement: 0.18 }),

  // ── ENERGIE ─────────────────────────────────────────────────────────
  a('pop-rapide', 'Pop rapide', 'energie', ['pop', 'vif', 'sport'],
    'Le même, plus sec.', 0.22, 0,
    { alphaDepart: 0, echelleDepart: 0.7, depassement: 0.24 }),
  a('rebond-doux', 'Rebond doux', 'energie', ['bounce', 'ressort'],
    'Se pose avec un léger rebond.', 0.55, 0,
    { echelleDepart: 0.85, depassement: 0.12, decalageYPct: 5 }),
  a('chute', 'Chute', 'energie', ['drop', 'haut', 'impact'],
    'Tombe du haut et s’arrête net.', 0.35, 0,
    { decalageYPct: -12, depassement: 0.08 }),
  a('surgissement', 'Surgissement', 'energie', ['zoom', 'impact', 'fort'],
    'Surgit en grand puis se cale.', 0.3, 0,
    { alphaDepart: 0, echelleDepart: 1.6 }),

  // ── CINEMA ──────────────────────────────────────────────────────────
  a('revelation', 'Révélation', 'cinema', ['reveal', 'lent', 'film'],
    'Se révèle en montant lentement.', 1, 0.6,
    { alphaDepart: 0, decalageYPct: 3, sortie: true }),
  a('ouverture-cinema', 'Ouverture cinéma', 'cinema', ['film', 'large', 'lent'],
    'Ouverture large et posée.', 1.1, 0.7,
    { alphaDepart: 0, echelleDepart: 1.12, sortie: true }),
];

export const ANIMATION_TEXTE_IDS: readonly string[] = ANIMATIONS_TEXTE.map((x) => x.id);
export const ANIMATION_TEXTE_DEFAUT = ANIMATIONS_TEXTE[0];

export function animationTexteParId(id: unknown): AnimationTexteCreative {
  if (typeof id !== 'string') return ANIMATION_TEXTE_DEFAUT;
  return ANIMATIONS_TEXTE.find((x) => x.id === id) ?? ANIMATION_TEXTE_DEFAUT;
}

// ─────────────────────────────────────────────────────────────────────────
// LE MOTEUR TEMPOREL
// ─────────────────────────────────────────────────────────────────────────

/** Trois décimales : la précision du reste du pipeline. */
const nb = (v: number): string => {
  const r = Number(v.toFixed(3));
  return (Object.is(r, -0) ? 0 : r).toFixed(3);
};

export interface ContexteAnimation {
  debutSecondes: number;
  finSecondes: number;
  /** La taille finale, en pixels. */
  taillePx: number;
  largeurCadre: number;
  hauteurCadre: number;
  /** La position finale, celle que les marges sûres ont validée. */
  y: number;
}

export interface ExpressionsAnimation {
  /** `null` quand le levier ne bouge pas : on n'écrit alors rien. */
  alpha: string | null;
  x: string | null;
  y: string | null;
  fontsize: string | null;
}

/**
 * Les expressions d'une animation, pour une couche donnée.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ LE TEMPS EST LOCAL, ET BORNÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `t` est le temps ABSOLU du montage. Toutes les expressions travaillent sur
 * `t - debut`, et sont saturées par `min`/`max` : une animation ne peut donc
 * ni commencer avant l'apparition du texte, ni continuer après sa
 * disparition — ce que `enable` cacherait, mais qui ferait sauter le texte
 * au moment où il s'allume.
 *
 * ⚠️ ET LA POSITION FINALE RESTE CELLE DES MARGES SÛRES. Les décalages sont
 * des états de DÉPART, ramenés à zéro : une animation ne peut pas terminer
 * hors du cadre, quelle que soit son amplitude.
 */
export function expressionsAnimation(
  anim: AnimationTexteCreative, c: ContexteAnimation,
): ExpressionsAnimation {
  const g = anim.geste;
  const vide: ExpressionsAnimation = { alpha: null, x: null, y: null, fontsize: null };
  if (anim.type !== 'bloc') return vide;

  const duree = Math.max(0, c.finSecondes - c.debutSecondes);
  /* Une entrée plus longue que la couche elle-même n'aurait jamais le temps
     de finir : le texte resterait à mi-chemin puis disparaîtrait. */
  const dE = Math.min(anim.dureeEntreeSecondes, duree / 2);
  const dS = Math.min(anim.dureeSortieSecondes, duree / 2);
  if (dE <= 0 && dS <= 0) return vide;

  const D = nb(c.debutSecondes);
  const F = nb(c.finSecondes);
  /** L'avancement de l'entrée, de 0 à 1. */
  const u = dE > 0 ? `min(1,max(0,(t-${D})/${nb(dE)}))` : '1';
  /** L'avancement de la sortie, de 1 à 0. */
  const v = g.sortie && dS > 0 ? `min(1,max(0,(${F}-t)/${nb(dS)}))` : '1';

  const sortie: ExpressionsAnimation = { ...vide };

  if (g.alphaDepart < 1) {
    const a0 = nb(g.alphaDepart);
    sortie.alpha = `(${a0}+(1-${a0})*${u})*${v}`;
  } else if (g.sortie && dS > 0) {
    sortie.alpha = v;
  }

  if (g.decalageXPct !== 0) {
    const px = nb((c.largeurCadre * g.decalageXPct) / 100);
    sortie.x = `(w-text_w)/2+${px}*(1-${u})`;
  }
  if (g.decalageYPct !== 0) {
    const px = nb((c.hauteurCadre * g.decalageYPct) / 100);
    sortie.y = `${nb(c.y)}+${px}*(1-${u})`;
  }

  if (g.echelleDepart !== 1 || g.depassement > 0) {
    const e0 = nb(g.echelleDepart);
    /* Le dépassement, sans moteur physique : une bosse `sin` sur la phase
       d'entrée. Déterministe, bornée, et elle retombe exactement à 1. */
    const bosse = g.depassement > 0
      ? `+${nb(g.depassement)}*sin(PI*${u})`
      : '';
    sortie.fontsize = `${nb(c.taillePx)}*((${e0}+(1-${e0})*${u})${bosse})`;
  }

  return sortie;
}
