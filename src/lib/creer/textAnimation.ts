/**
 * Animations d'apparition du texte.
 *
 * Fonctions PURES, sans canvas : le compositeur ne fait qu'appliquer ce
 * qu'elles calculent. C'est ce qui rend l'animation verifiable sur des
 * valeurs, la ou une lecture du rendu ne prouverait rien.
 *
 * Toute l'animation se joue sur le DEBUT de la sequence. Etalee sur sa duree
 * entiere, le texte finirait d'apparaitre au moment ou la sequence s'en va —
 * on ne le lirait jamais en entier.
 */

export type TextAnimation = 'none' | 'fade' | 'slide' | 'typewriter' | 'pop';

/** Cles proposees au menu, dans l'ordre d'affichage. */
export const TEXT_ANIMATION_KEYS: readonly TextAnimation[] = Object.freeze([
  'none', 'fade', 'slide', 'typewriter', 'pop',
] as TextAnimation[]);

export const TEXT_ANIMATION_LABELS: Record<TextAnimation, string> = {
  none: 'Aucune',
  fade: 'Fondu',
  slide: 'Glissement',
  typewriter: 'Machine à écrire',
  pop: 'Pop',
};

/** Ce que l'utilisateur verra, en une phrase. */
export const TEXT_ANIMATION_HINTS: Record<TextAnimation, string> = {
  none: 'Le texte est là dès le premier instant. Le rendu actuel.',
  fade: 'Le texte apparaît en fondu.',
  slide: 'Le texte monte depuis le bas en apparaissant.',
  typewriter: 'Le texte s’écrit lettre par lettre.',
  pop: 'Le texte grandit légèrement en apparaissant.',
};

/** Aucune animation — le defaut, et le rendu d'aujourd'hui. */
export const DEFAULT_TEXT_ANIMATION: TextAnimation = 'none';

/**
 * Part de la sequence sur laquelle l'animation se joue.
 *
 * 22 % : sur une sequence de 4 s, l'apparition dure moins d'une seconde et le
 * texte reste lisible tout le reste du temps.
 */
export const INTRO_WINDOW = 0.22;

/**
 * Avancement de l'animation, de 0 a 1, a partir de l'avancement de la
 * sequence.
 *
 * Sature a 1 des la fenetre passee : au-dela, le texte est simplement la.
 */
export function introRatio(progress: number, window: number = INTRO_WINDOW): number {
  if (!Number.isFinite(progress)) return 1;
  const w = Number.isFinite(window) && window > 0 ? window : INTRO_WINDOW;
  return Math.min(1, Math.max(0, progress / w));
}

/**
 * Adoucissement en sortie : rapide au debut, freine a l'arrivee.
 *
 * Une animation lineaire s'arrete net ; celle-ci se pose.
 */
export function easeOut(t: number): number {
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 1));
  return 1 - Math.pow(1 - x, 3);
}

/** Ce que le compositeur doit appliquer a un instant donne. */
export interface TextAnimationState {
  /** Opacite du bloc de texte. */
  alpha: number;
  /** Decalage vertical en FRACTION de la hauteur du cadre, vers le bas. */
  translateY: number;
  /** Facteur d'echelle, autour du centre du cadre. */
  scale: number;
  /**
   * Part du texte deja ecrite, de 0 a 1. Vaut 1 partout sauf en machine a
   * ecrire — ailleurs, le texte est entier des la premiere frame.
   */
  charRatio: number;
}

/** Etat neutre : exactement le rendu d'aujourd'hui. */
const NEUTRAL: TextAnimationState = { alpha: 1, translateY: 0, scale: 1, charRatio: 1 };

/** Amplitude du glissement, en fraction de la hauteur du cadre. */
const SLIDE_DISTANCE = 0.04;

/** Echelle de depart du « pop ». */
const POP_FROM = 0.8;

/**
 * Etat de l'animation pour un style et un avancement donnes.
 *
 * `'none'`, un style inconnu, ou une animation terminee rendent l'etat
 * NEUTRE : le compositeur n'a alors rien a appliquer, et le rendu est au
 * pixel celui d'avant.
 */
export function textAnimationState(
  style: TextAnimation | undefined,
  progress: number,
  window: number = INTRO_WINDOW,
): TextAnimationState {
  if (!style || style === 'none' || !TEXT_ANIMATION_KEYS.includes(style)) return NEUTRAL;
  const t = easeOut(introRatio(progress, window));
  if (t >= 1) return NEUTRAL;
  switch (style) {
    case 'fade':
      return { ...NEUTRAL, alpha: t };
    case 'slide':
      // Un peu de fondu avec le mouvement : un texte qui glisse en restant
      // opaque donne l'impression de sauter dans le cadre.
      return { ...NEUTRAL, alpha: t, translateY: (1 - t) * SLIDE_DISTANCE };
    case 'pop':
      return { ...NEUTRAL, alpha: t, scale: POP_FROM + (1 - POP_FROM) * t };
    case 'typewriter':
      // Progression LINEAIRE : une frappe qui ralentit a la fin ne ressemble
      // pas a quelqu'un qui tape.
      return { ...NEUTRAL, charRatio: introRatio(progress, window) };
    default:
      return NEUTRAL;
  }
}

/**
 * Debut d'un texte, a la proportion demandee.
 *
 * Arrondi au SUPERIEUR : a la premiere frame utile, une lettre est deja
 * visible, au lieu d'un cadre vide qui ressemble a un bug.
 */
export function revealText(text: string, ratio: number): string {
  if (typeof text !== 'string' || text.length === 0) return '';
  const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 1;
  if (r >= 1) return text;
  return text.slice(0, Math.max(1, Math.ceil(text.length * r)));
}

/** Le style demande-t-il de tronquer le texte ? */
export function isTypewriter(style: TextAnimation | undefined): boolean {
  return style === 'typewriter';
}
