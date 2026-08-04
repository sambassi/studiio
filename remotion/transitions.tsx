import React from 'react';
import { AbsoluteFill, useVideoConfig } from 'remotion';
import { linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import { iris } from '@remotion/transitions/iris';
import type { TransitionPresentation, TransitionPresentationComponentProps } from '@remotion/transitions';
import type { TransitionStyle } from '../src/lib/video-composer';

/**
 * Les neuf transitions du montage, cote rendu serveur — Phase 6.
 *
 * ⚠️ C'EST `drawTransition` QUI FAIT FOI, PAS CE FICHIER.
 *
 * Le compositeur canvas est l'implementation de reference : ce module la
 * reproduit sous Remotion. Chaque style ci-dessous cite la ligne du canvas
 * qu'il imite, et les constantes numeriques (0,18 de zoom, 16 px et 26 px de
 * flou, sur-echelle 1,06) sont recopiees a l'identique — un ecart d'un
 * dixieme s'y verrait comme un raccord qui saute.
 *
 * ⚠️ LE TYPE SEUL EST IMPORTE DU COMPOSITEUR (`import type`), et il est efface
 * a la compilation. Importer une VALEUR de `video-composer` ferait entrer ses
 * 5 000 lignes — et ses appels au DOM — dans le bundle Remotion. La liste des
 * styles est donc redite ici, et un test verifie qu'elle n'a pas derive de
 * `TRANSITION_KEYS`.
 *
 * ── OU SE PLACE LA FENETRE DE TRANSITION ────────────────────────────────
 *
 * Le canvas joue la transition dans les **0,8 dernieres secondes de la
 * sequence sortante** (`seqElapsed > seq.duration - transitionDur`) : la duree
 * totale du montage ne change pas. `TransitionSeries`, lui, fait CHEVAUCHER
 * les deux sequences et raccourcit d'autant le total.
 *
 * Pour retomber sur la meme duree et le meme calage, chaque sequence SAUF LA
 * PREMIERE recoit la duree de la transition en plus (voir `sequenceFrames`).
 * Le chevauchement consomme exactement ce supplement.
 */

/** Duree de la fenetre de transition, en secondes — `transitionDur` du compositeur. */
export const TRANSITION_DURATION_SECONDS = 0.8;

/** Style joue quand rien n'est demande — `DEFAULT_TRANSITION` du compositeur. */
export const DEFAULT_TRANSITION_STYLE: TransitionStyle = 'crossfade';

/**
 * Vocabulaire des styles, redit ici pour ne pas embarquer le compositeur.
 * Un test le compare a `TRANSITION_KEYS` : les deux ne peuvent pas diverger
 * en silence.
 */
export const TRANSITION_STYLE_KEYS: readonly TransitionStyle[] = [
  'crossfade', 'slide', 'wipe', 'zoom', 'fade-to-black',
  'push', 'iris', 'blur-dissolve', 'whip-pan',
];

// ── Courbes, recopiees du compositeur ──────────────────────────────────────

/** Accelere puis ralentit — `easeInOut` du compositeur. */
export function easeInOut(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2;
}

/** Meme forme, en cubique — `easeInOutCubic` du compositeur. */
export function easeInOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

/** Nulle aux deux extremites, maximale au milieu — `bellCurve` du compositeur. */
export function bellCurve(t: number): number {
  return Math.sin(Math.PI * Math.max(0, Math.min(1, t)));
}

/** Flou maximal de `blur-dissolve`, pour une largeur de reference de 1080 px. */
export const BLUR_DISSOLVE_MAX_PX = 16;
/** Flou maximal du filé de `whip-pan`, meme reference. */
export const WHIP_PAN_MAX_BLUR_PX = 26;
/** Sur-echelle d'un calque floute : repousse hors cadre le lisere translucide. */
export const BLUR_MAX_OVERSCALE = 1.06;
/** Amplitude du zoom, dans les deux sens — `0.18` du compositeur. */
export const ZOOM_AMPLITUDE = 0.18;

// ── Presentations sur mesure ───────────────────────────────────────────────
//
// Les quatre styles que `@remotion/transitions` ne couvre pas. Chacune recoit
// `presentationProgress` deja calee par le `timing` : les styles qui ont
// besoin de la progression BRUTE (parce qu'ils melangent une courbe eased et
// une cloche) demandent donc un timing lineaire, et appliquent la courbe
// eux-memes. Voir `transitionTiming`.

/** `zoom` — echelles uniformes, jamais d'etirement (canvas : case 'zoom'). */
const ZoomPresentation: React.FC<TransitionPresentationComponentProps<Record<string, unknown>>> = ({
  children, presentationDirection, presentationProgress: e,
}) => {
  const entrant = presentationDirection === 'entering';
  // L'entrante zoome vers l'AVANT (facteur toujours >= 1) : sous 1 elle
  // serait plus petite que le cadre, et le pourtour laisserait passer un
  // lisere sombre en fin de transition.
  const echelle = entrant ? 1 + ZOOM_AMPLITUDE * (1 - e) : 1 + ZOOM_AMPLITUDE * e;
  return (
    <AbsoluteFill style={{ opacity: entrant ? e : 1 - e, transform: `scale(${echelle})` }}>
      {children}
    </AbsoluteFill>
  );
};

/** `fade-to-black` — A s'eteint, PUIS B s'allume (canvas : case 'fade-to-black'). */
const FadeToBlackPresentation: React.FC<TransitionPresentationComponentProps<Record<string, unknown>>> = ({
  children, presentationDirection, presentationProgress: t,
}) => {
  const entrant = presentationDirection === 'entering';
  const opacite = entrant
    ? (t < 0.5 ? 0 : (t - 0.5) / 0.5)
    : (t < 0.5 ? 1 - t / 0.5 : 0);
  return (
    // Le noir est peint SOUS la sortante — donc sous tout le reste — pour
    // qu'aucune image ne soit transparente a mi-course. L'entrante, elle,
    // passe par-dessus et le laisse voir tant qu'elle est effacee.
    //
    // ⚠️ SEULEMENT PENDANT LA TRANSITION (`t > 0`). Une sequence du MILIEU est
    // enveloppee par la presentation « sortante » de la transition SUIVANTE
    // des sa premiere image, avec une progression a zero : un fond noir pose
    // sans condition serait donc opaque sur toute sa duree, et masquerait la
    // sequence precedente pendant la transition qui l'amene. C'est ce qui
    // rendait la premiere moitie du fondu entierement noire.
    <AbsoluteFill style={{ backgroundColor: !entrant && t > 0 ? '#000000' : undefined }}>
      <AbsoluteFill style={{ opacity: opacite }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Style commun aux deux calques floutes : flou, sur-echelle, decalage. */
function styleFloute(largeur: number, tBrut: number, fluxMaxPx: number, decalagePct: number, opacite: number): React.CSSProperties {
  const cloche = bellCurve(tBrut);
  // Le flou est MIS A L'ECHELLE de la largeur : 16 px absolus ne pesent pas
  // le meme poids en 1080 et en 1920 de large.
  const flou = fluxMaxPx * (largeur / 1080) * cloche;
  const surEchelle = 1 + (BLUR_MAX_OVERSCALE - 1) * cloche;
  return {
    opacity: opacite,
    filter: flou > 0 ? `blur(${flou}px)` : undefined,
    // `translate` puis `scale` : la mise a l'echelle s'applique d'abord, au
    // centre, exactement comme le canvas qui recentre avant de mettre a
    // l'echelle puis translate.
    transform: `translateX(${decalagePct}%) scale(${surEchelle})`,
  };
}

/** `blur-dissolve` — fondu enchaine dont le flou monte puis redescend. */
const BlurDissolvePresentation: React.FC<TransitionPresentationComponentProps<Record<string, unknown>>> = ({
  children, presentationDirection, presentationProgress: t,
}) => {
  const { width } = useVideoConfig();
  const entrant = presentationDirection === 'entering';
  const e = easeInOut(t);
  return (
    <AbsoluteFill style={styleFloute(width, t, BLUR_DISSOLVE_MAX_PX, 0, entrant ? e : 1 - e)}>
      {children}
    </AbsoluteFill>
  );
};

/** `whip-pan` — glissement fulgurant et filé directionnel. */
const WhipPanPresentation: React.FC<TransitionPresentationComponentProps<Record<string, unknown>>> = ({
  children, presentationDirection, presentationProgress: t,
}) => {
  const { width } = useVideoConfig();
  const entrant = presentationDirection === 'entering';
  const e = easeInOutCubic(t);
  // Les deux calques restent OPAQUES : c'est un mouvement, pas un fondu. Une
  // opacite < 1 laisserait voir le vide derriere pendant tout le balayage.
  return (
    <AbsoluteFill style={styleFloute(width, t, WHIP_PAN_MAX_BLUR_PX, entrant ? 100 * (1 - e) : -100 * e, 1)}>
      {children}
    </AbsoluteFill>
  );
};

const surMesure = (
  composant: React.FC<TransitionPresentationComponentProps<Record<string, unknown>>>,
): TransitionPresentation<Record<string, unknown>> => ({ component: composant, props: {} });

/**
 * Le style a jouer, pour un cadre donne.
 *
 * `iris` a besoin des dimensions : le rayon final couvre les coins
 * (demi-diagonale), sinon la derniere image garderait quatre angles sur la
 * sortante.
 */
export function transitionPresentation(
  style: TransitionStyle,
  cadre: { width: number; height: number },
): TransitionPresentation<Record<string, unknown>> {
  switch (style) {
    // `shouldFadeOutExitingScene` : sans lui la sortante reste OPAQUE sous
    // l'entrante — ce serait un fondu en entree, pas un fondu enchaine.
    case 'crossfade':
      return fade({ shouldFadeOutExitingScene: true }) as TransitionPresentation<Record<string, unknown>>;
    // Le canvas chasse A vers la GAUCHE et fait entrer B par la droite.
    case 'slide':
      return slide({ direction: 'from-right' }) as TransitionPresentation<Record<string, unknown>>;
    // A reste en place, B est revelee par un volet qui s'elargit vers la droite.
    case 'wipe':
      return wipe({ direction: 'from-left' }) as TransitionPresentation<Record<string, unknown>>;
    // Pendant VERTICAL de `slide` : A monte, B arrive par le bas.
    case 'push':
      return slide({ direction: 'from-bottom' }) as TransitionPresentation<Record<string, unknown>>;
    // L'iris integre ouvre le MEME disque que le canvas : rayon
    // `hypot(w, h) / 2 × progression`, centre, sortante intacte.
    case 'iris':
      return iris({ width: cadre.width, height: cadre.height }) as unknown as TransitionPresentation<Record<string, unknown>>;
    case 'zoom':
      return surMesure(ZoomPresentation);
    case 'fade-to-black':
      return surMesure(FadeToBlackPresentation);
    case 'blur-dissolve':
      return surMesure(BlurDissolvePresentation);
    case 'whip-pan':
      return surMesure(WhipPanPresentation);
    default:
      // Style inconnu : le canvas retombe sur le fondu enchaine avant meme de
      // peindre. On fait pareil plutot que de couper franc.
      return fade({ shouldFadeOutExitingScene: true }) as TransitionPresentation<Record<string, unknown>>;
  }
}

/**
 * Le calage temporel du style.
 *
 * Deux familles, et c'est la progression demandee par le style qui tranche :
 *
 * - **Timing adouci** pour les styles dont TOUTE l'animation suit `easeInOut`
 *   (`slide`, `wipe`, `push`, `iris`, `zoom`).
 * - **Timing lineaire** pour ceux qui melangent une courbe adoucie et une
 *   cloche calculee sur la progression BRUTE (`blur-dissolve`, `whip-pan`),
 *   ainsi que pour `crossfade` et `fade-to-black`, que le canvas joue sans
 *   adoucissement. Adoucir en amont rendrait la cloche irrecuperable.
 */
export function transitionTiming(style: TransitionStyle, durationInFrames: number) {
  const adouci = style === 'slide' || style === 'wipe' || style === 'push'
    || style === 'iris' || style === 'zoom';
  return linearTiming({ durationInFrames, easing: adouci ? easeInOut : undefined });
}

/**
 * Duree de la fenetre de transition, en images.
 *
 * Bornee a la plus courte des sequences : `TransitionSeries` refuse une
 * transition plus longue qu'une des deux sequences qu'elle relie, et un
 * montage dont une sequence dure moins de 0,8 s ferait echouer le rendu
 * entier plutot que de jouer une transition un peu plus courte.
 */
export function transitionFrames(sequenceFrames: number[], fps: number): number {
  const voulu = Math.round(TRANSITION_DURATION_SECONDS * (fps > 0 ? fps : 30));
  const plusCourte = sequenceFrames.length ? Math.min(...sequenceFrames) : voulu;
  return Math.max(1, Math.min(voulu, plusCourte));
}

/**
 * Duree NOMINALE de chaque sequence, en images.
 *
 * Derivee des DEBUTS de sequence (`sequenceFrameOffsets`) et de la duree
 * totale, et non re-arrondie sequence par sequence : la somme retombe alors
 * exactement sur `totalDurationFrames`, celle que `calculateMetadata` annonce
 * a Remotion. Arrondir chacune de son cote pouvait s'en ecarter d'une image
 * par sequence, et la derniere serait tombee dans le vide.
 */
export function baseSequenceFrames(offsets: number[], totalFrames: number): number[] {
  return offsets.map((debut, i) => {
    const fin = i === offsets.length - 1 ? totalFrames : offsets[i + 1];
    return Math.max(1, fin - debut);
  });
}

/**
 * Duree de chaque sequence dans la serie, en images.
 *
 * Toutes SAUF LA PREMIERE recoivent la duree de transition en plus : c'est ce
 * supplement que le chevauchement consomme. Le total retombe exactement sur
 * la somme des durees voulues, et chaque transition tombe sur les dernieres
 * images de sa sequence sortante — la ou le canvas la joue.
 */
export function seriesSequenceFrames(baseFrames: number[], transition: number): number[] {
  return baseFrames.map((f, i) => (i === 0 ? f : f + transition));
}
