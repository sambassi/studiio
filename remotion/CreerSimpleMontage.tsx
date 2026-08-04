import React from 'react';
import {
  AbsoluteFill, Audio, OffthreadVideo, Img, useVideoConfig, useCurrentFrame,
} from 'remotion';
import {
  buildSequences, sequenceFrameOffsets, totalDurationFrames, isReelFormat, editorViewportPx,
  gradientOverlayCss, DEFAULT_COLORS,
  type PlannedSequence,
} from '../src/lib/creer/designSpec';
import SequenceCards from '../src/components/creer/SequenceCards';
import SequenceTitle, { titleFrameStyle } from '../src/components/creer/SequenceTitle';
import SequenceCta, { ctaFrameStyle } from '../src/components/creer/SequenceCta';
import FreeElementsLayer, { type FreeElement } from '../src/components/creer/FreeElementsLayer';
import TextAnimationLayer from '../src/components/creer/TextAnimationLayer';
import { MusiqueEnBoucle, VoixDeSequence, mixAt } from './audio';
import type { AudioKeyframe } from '../src/lib/creer/audioDucking';
import {
  textAnimationState, TEXT_ANIMATION_KEYS, DEFAULT_TEXT_ANIMATION, type TextAnimation,
} from '../src/lib/creer/textAnimation';
import { TransitionSeries } from '@remotion/transitions';
// Type SEUL : effacé à la compilation, donc le compositeur navigateur —
// et ses appels au DOM — n'entrent pas dans le bundle Remotion.
import type { TransitionStyle } from '../src/lib/video-composer';
import {
  transitionPresentation, transitionTiming, transitionFrames, seriesSequenceFrames,
  baseSequenceFrames,
  TRANSITION_STYLE_KEYS, DEFAULT_TRANSITION_STYLE,
} from './transitions';
import { TEXT_LAYOUT } from '../src/lib/creer/designSpec';
import { fontStack } from '../src/lib/fonts/catalog';
import { useMontageFonts } from './useMontageFonts';

/**
 * Montage « Créer (simple) » — rendu SERVEUR.
 *
 * Phase 1 : le cœur du montage — ordre et durées des séquences, fonds
 * (affiche globale, fond par séquence, dégradé), titre, cartes, CTA, musique.
 *
 * ⚠️ LA PARITÉ AVEC LE RENDU NAVIGATEUR EST L'ENJEU, pas la beauté du code.
 * L'ordre et les durées viennent de `buildSequences` — la MÊME fonction
 * qu'appelle `video-composer.ts`. Deux assemblages indépendants divergeraient
 * au premier réglage ajouté d'un seul côté, et l'écart ne se verrait qu'en
 * comparant deux vidéos image par image.
 *
 * Ce qui est APPROXIMÉ en Phase 1, et documenté comme tel :
 *
 * - Les cartes sont redessinées en HTML/CSS. Le navigateur, lui, blitte une
 *   PHOTOGRAPHIE du conteneur de l'aperçu (`cardsSnapshot`) : la parité y sera
 *   toujours une ressemblance, jamais une identité, tant qu'on ne photographie
 *   pas aussi côté serveur.
 * - Animations de texte, voix par séquence et recadrage d'affiche ne sont
 *   PAS rendus. Ils sont câblés « sans effet » — les props
 *   existent, le rendu les ignore — pour que la phase suivante n'ait pas à
 *   changer la signature.
 */

export interface CreerSimpleCard {
  icon?: string;
  title?: string;
  label?: string;
  description?: string;
  value?: string;
}

export interface CreerSimpleMontageProps {
  title: string;
  subtitle?: string;
  cards: CreerSimpleCard[];
  ctaText?: string;
  ctaSubText?: string;
  /** Affiche globale. */
  posterUrl?: string | null;
  /** Fond propre à une séquence — prioritaire sur l'affiche. */
  sequenceBackgrounds?: Partial<Record<'titre' | 'cartes' | 'video' | 'cta', string | null>>;
  videoUrl?: string | null;
  musicUrl?: string | null;
  gradientStart?: string;
  gradientEnd?: string;
  gradientOpacity?: number;
  titleColor?: string;
  /** Polices du design — memes noms que le selecteur de l'ecran. */
  titleFont?: string;
  subtitleFont?: string;
  ctaFont?: string;
  /** Typographie du titre — memes champs que `text.title` de l'ecran. */
  titleScale?: number;
  titleBold?: boolean;
  titleItalic?: boolean;
  titleLetterSpacing?: number;
  titleLineHeight?: number;
  subtitleColor?: string | null;
  subtitleScale?: number;
  /** Typographie du CTA. */
  ctaColor?: string;
  ctaSubColor?: string;
  ctaScale?: number;
  ctaBold?: boolean;
  ctaItalic?: boolean;
  ctaLetterSpacing?: number;
  ctaLineHeight?: number;
  /** Positions, en % du plateau — les memes qu'a l'ecran. */
  titlePos?: { x: number; y: number };
  ctaPos?: { x: number; y: number };
  watermark?: string;
  introDuration: number;
  cardsDuration: number;
  videoDuration: number;
  ctaDuration: number;
  sequenceOrder?: string[];
  /** Positions libres des cartes, ou absent pour la disposition en flux. */
  cardBoxes?: Record<string, { x: number; y: number; w: number; h: number }> | null;
  /** Durée totale, en images — calculée par `calculateMetadata`. */
  totalDurationFrames?: number;
  // ── Phases suivantes : acceptés, non rendus ────────────────────────────
  /**
   * Animation d'apparition du texte — rendue depuis la Phase 7.
   *
   * Une valeur inconnue vaut « aucune », comme `textAnimationState` qui rend
   * l'etat neutre des que le style n'est pas dans `TEXT_ANIMATION_KEYS`.
   */
  textAnimation?: string;
  /**
   * Style joue entre deux sequences — rendu depuis la Phase 6.
   *
   * Une valeur inconnue retombe sur le fondu enchaine, comme
   * `drawTransition` qui teste `TRANSITION_STYLES.includes(style)` avant de
   * peindre quoi que ce soit.
   */
  transition?: string;
  /**
   * Elements libres — rendus depuis la Phase 5, par le composant PARTAGE.
   *
   * Sur TOUTES les sequences, comme le compositeur canvas qui appelle
   * `drawFreeElements` a la fin de chacune d'elles.
   */
  elements?: FreeElement[];
  /**
   * Voix par sequence — rendues depuis la Phase 8.
   *
   * Les cles sont celles de l'editeur (`titre`, `cartes`, `video`, `cta`),
   * comme cote compositeur : c'est une carte d'URL, pas les objets
   * `SequenceVoices` du panneau.
   */
  sequenceVoiceUrls?: Record<string, string | null>;
  /** Voix unique — repli quand aucune voix par sequence n'est fournie. */
  voiceUrl?: string | null;
  /** Volumes du mixage. Absents : les defauts du compositeur. */
  musicVolume?: number;
  voiceVolume?: number;
  /** Attenuations posees a la main dans le mixeur. */
  audioKeyframes?: AudioKeyframe[];
}

/** Séquences du montage, à partir des props. */
export function planFromProps(props: CreerSimpleMontageProps): PlannedSequence[] {
  return buildSequences({
    introDuration: props.introDuration ?? 0,
    cardsDuration: props.cardsDuration ?? 0,
    videoDuration: props.videoDuration ?? 0,
    ctaDuration: props.ctaDuration ?? 0,
    cardCount: props.cards?.length ?? 0,
    // Côté serveur, un rush fourni est réputé jouable : Chromium le décode
    // avec `OffthreadVideo`. Un fichier illisible fera échouer le rendu, ce
    // qui vaut mieux qu'un montage silencieusement amputé.
    hasVideoBackground: !!props.videoUrl,
    videoRequested: !!props.videoUrl,
    sequenceOrder: props.sequenceOrder ?? null,
  });
}

/**
 * Style de transition demandé, ou le fondu enchaîné.
 *
 * Un style inconnu ne coupe pas franc : `drawTransition` teste
 * `TRANSITION_STYLES.includes(style)` et retombe sur le fondu **avant** de
 * peindre. Le rendu serveur fait la même chose, sinon un design venu d'une
 * version plus récente de l'éditeur perdrait ses transitions ici et les
 * garderait là.
 */
function resolveStyle(demande: string | undefined): TransitionStyle {
  return demande && (TRANSITION_STYLE_KEYS as readonly string[]).includes(demande)
    ? (demande as TransitionStyle)
    : DEFAULT_TRANSITION_STYLE;
}

/** Animation demandée, ou aucune — même repli que `textAnimationState`. */
function resolveAnimation(demande: string | undefined): TextAnimation {
  return demande && (TEXT_ANIMATION_KEYS as readonly string[]).includes(demande)
    ? (demande as TextAnimation)
    : DEFAULT_TEXT_ANIMATION;
}

/** Ce qu'une séquence doit appliquer à son texte à l'image courante. */
export interface AnimationCourante {
  /** Avancement de la SÉQUENCE, de 0 à 1. */
  progress: number;
  /** Part du texte déjà écrite — 1 hors machine à écrire. */
  reveal: number;
}

/**
 * Calcule l'avancement de la séquence à l'image courante, et rend son
 * contenu.
 *
 * ⚠️ L'AVANCEMENT PART DU DÉBUT **NOMINAL** DE LA SÉQUENCE, pas de sa
 * première image.
 *
 * Depuis la Phase 6, une séquence autre que la première commence
 * `prefixFrames` images plus tôt : c'est le chevauchement qui porte la
 * transition. Compter l'animation depuis là ferait apparaître le texte
 * PENDANT la transition, puis rester immobile ensuite.
 *
 * C'est aussi le seul endroit où le rendu serveur s'écarte volontairement du
 * canvas : celui-ci dessine la séquence entrante à `t × 0,3` pendant la
 * transition, si bien que l'apparition se joue une première fois pendant le
 * raccord, puis **recommence à zéro** quand la séquence prend la main. Le
 * texte apparaît donc deux fois. Ici, il apparaît une fois, une fois le
 * raccord posé.
 */
const SequenceAnimee: React.FC<{
  style: TextAnimation;
  baseFrames: number;
  prefixFrames: number;
  rendu: (anim: AnimationCourante) => React.ReactNode;
}> = ({ style, baseFrames, prefixFrames, rendu }) => {
  const frame = useCurrentFrame();
  const progress = baseFrames > 0
    ? Math.max(0, frame - prefixFrames) / baseFrames
    : 1;
  return <>{rendu({ progress, reveal: textAnimationState(style, progress).charRatio })}</>;
};

/** Clés des voix, côté éditeur — les mêmes que `SEQ_VOICE_KEYS` du compositeur. */
const SEQ_VOICE_KEYS = ['titre', 'cartes', 'video', 'cta'] as const;

/** Type de séquence → clé de l'éditeur. L'inverse de `SEQ_NAME_MAP`. */
const SEQ_TO_EDITOR: Record<string, string | undefined> = {
  intro: 'titre', cards: 'cartes', video: 'video', cta: 'cta',
};

/** Fond effectif d'une séquence : le sien, sinon l'affiche globale. */
function backgroundFor(props: CreerSimpleMontageProps, type: string): string | null {
  const cle = ({ intro: 'titre', cards: 'cartes', video: 'video', cta: 'cta' } as const)[
    type as 'intro' | 'cards' | 'video' | 'cta'
  ];
  const propre = cle ? props.sequenceBackgrounds?.[cle] : null;
  return propre || props.posterUrl || null;
}

/** Fond + voile, communs à toutes les séquences. */
const Fond: React.FC<{ props: CreerSimpleMontageProps; type: string }> = ({ props, type }) => {
  const url = backgroundFor(props, type);
  const start = props.gradientStart || DEFAULT_COLORS.gradientStart;
  const end = props.gradientEnd || DEFAULT_COLORS.gradientEnd;
  return (
    <>
      {url ? (
        <Img src={url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        // Sans affiche, le dégradé PLEIN tient lieu de fond — c'est ce que
        // fait le navigateur.
        <AbsoluteFill style={{ background: `linear-gradient(160deg, ${start} 0%, ${end} 100%)` }} />
      )}
      <AbsoluteFill
        style={{ background: gradientOverlayCss(start, end, props.gradientOpacity ?? 0.3) }}
      />
    </>
  );
};

/** Filigrane, en bas de cadre. */
const Filigrane: React.FC<{ texte?: string; echelle: number }> = ({ texte, echelle }) =>
  texte ? (
    <div
      style={{
        position: 'absolute', bottom: 24 * echelle, left: 0, right: 0,
        textAlign: 'center', color: 'rgba(255,255,255,0.75)',
        fontSize: 11 * echelle, letterSpacing: 1 * echelle, fontWeight: 600,
      }}
    >
      {texte}
    </div>
  ) : null;

export const CreerSimpleMontage: React.FC<CreerSimpleMontageProps> = (props) => {
  const { fps, width, height } = useVideoConfig();
  const sequences = planFromProps(props);
  const isReel = isReelFormat(width, height);
  // Même règle d'échelle que le compositeur Canvas : les tailles de l'éditeur
  // sont des pixels CSS fixes, remises à l'échelle de la vidéo.
  const echelle = width / editorViewportPx(isReel);
  const titleColor = props.titleColor || DEFAULT_COLORS.title;

  // Les polices du montage, plus Inter — celle des cartes et du filigrane.
  // Le rendu attend leur chargement : voir `useMontageFonts`.
  useMontageFonts(['Inter', props.titleFont, props.subtitleFont, props.ctaFont]);
  // Le format se DEDUIT des dimensions : le compositeur fait de meme, et une
  // prop separee pourrait le contredire.
  const format = isReel ? '9:16' : width === height ? '1:1' : '16:9';

  // ── Repères temporels, calculés UNE fois ────────────────────────────────
  // L'audio et l'image les lisent tous les deux : deux calculs séparés
  // finiraient par se désynchroniser d'une image, et un décalage son/image
  // ne se voit qu'à l'oreille.
  const offsets = sequenceFrameOffsets(sequences, fps);
  const totalFrames = totalDurationFrames(sequences, fps);
  const base = baseSequenceFrames(offsets, totalFrames);
  const tFrames = transitionFrames(base, fps);

  // Une voix PAR SÉQUENCE l'emporte sur la voix unique, comme côté
  // compositeur : le repli historique ne joue que si aucune n'est fournie.
  const voixParSequence = SEQ_VOICE_KEYS.some((cle) => !!props.sequenceVoiceUrls?.[cle]);
  const voixUnique = !voixParSequence && props.voiceUrl ? props.voiceUrl : null;
  const aDeLaVoix = voixParSequence || !!voixUnique;
  const mixOptions = {
    musicVolume: props.musicVolume,
    voiceVolume: props.voiceVolume,
    keyframes: props.audioKeyframes,
    hasVoice: aDeLaVoix,
    hasMixAudio: aDeLaVoix || !!props.musicUrl,
  };

  return (
    // La famille de police est posee A LA RACINE : sans elle, tout element
    // qui n'en declare pas retombe sur le serif par defaut de Chromium — le
    // filigrane sortait en Times. La police WEB elle-meme (Inter) n'est pas
    // encore embarquee dans le bundle : c'est un point de Phase 2.
    // La pile de police vient de `fontStack` — la MEME fonction que l'ecran.
    <AbsoluteFill style={{ backgroundColor: DEFAULT_COLORS.dark, fontFamily: fontStack('Inter') }}>
      {/* ── AUDIO ────────────────────────────────────────────────────────
          Musique et voix vivent a la RACINE, pas dans les
          `TransitionSeries.Sequence` : depuis la Phase 6, une sequence autre
          que la premiere demarre `tFrames` plus tot pour porter le raccord.
          Une voix posee dedans partirait 0,8 s trop tot, et le decalage
          s'accumulerait a chaque transition. Ici, `sequenceFrameOffsets`
          donne le debut NOMINAL, celui que le canvas utilise aussi. */}
      {props.musicUrl && (
        <MusiqueEnBoucle
          src={props.musicUrl}
          fps={fps}
          totalFrames={totalFrames}
          volume={(f) => mixAt(f / fps, mixOptions).music}
        />
      )}
      {voixParSequence && sequences.map((seq, i) => {
        const cle = SEQ_TO_EDITOR[seq.type];
        const url = cle ? props.sequenceVoiceUrls?.[cle] : null;
        if (!url) return null;
        return (
          <VoixDeSequence
            key={`voix-${seq.type}-${i}`}
            src={url}
            from={offsets[i]}
            durationInFrames={base[i]}
            // La frame reçue est relative à la séquence : on la ramène à
            // l'absolu, sans quoi une atténuation posée à la trentième
            // seconde du montage tomberait au début de chaque voix.
            volume={(f) => mixAt((offsets[i] + f) / fps, mixOptions).voice}
          />
        );
      })}
      {voixUnique && (
        // Repli historique : une seule voix, dès la première image.
        <Audio src={voixUnique} volume={(f) => mixAt(f / fps, mixOptions).voice} />
      )}

      {/* Le contenu d'une sequence, isole : la serie et un rendu direct
          montent ainsi EXACTEMENT le meme arbre. */}
      {(() => {
        // Debut ABSOLU de la sequence dans la serie : `offsets[i]` moins le
        // chevauchement qui la fait demarrer plus tot. Sert au volume du
        // rush, dont la fonction recoit une frame relative a sa sequence.
        const departSerie = (i: number) => (i === 0 ? 0 : offsets[i] - tFrames);

        const contenu = (type: string, anim: AnimationCourante, depart: number) => (
          <AbsoluteFill>
            {type === 'video' && props.videoUrl ? (
              <OffthreadVideo
                src={props.videoUrl}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                // Le rush garde SON son. Le canvas le route lui aussi — à la
                // moitié du volume dès qu'il y a un autre audio, à plein
                // sinon. Le couper ici aurait fait une vidéo serveur muette
                // là où celle du navigateur parle.
                //
                // La frame reçue est relative à la séquence de la série, qui
                // démarre `tFrames` plus tôt : `depart` la ramène à l'absolu.
                volume={(f) => mixAt((depart + f) / fps, mixOptions).rush}
              />
            ) : (
              <Fond props={props} type={type} />
            )}

            {type === 'intro' && (
              // L'animation enveloppe le TEXTE, jamais le fond : un fond en
              // fondu laisserait voir le noir, un fond qui glisse
              // decouvrirait une bande vide. Meme place que
              // `applyTextAnimation` dans `drawIntro`.
              <TextAnimationLayer style={animation} progress={anim.progress}>
              {/* Le MEME composant que l'apercu, et le MEME cadre : la
                  position vient de `titlePos`, comme a l'ecran. */}
              <div style={titleFrameStyle(props.titlePos ?? TEXT_LAYOUT.titlePos)}>
                <SequenceTitle
                  title={props.title}
                  subtitle={props.subtitle}
                  typography={{
                    font: props.titleFont || 'Inter',
                    color: titleColor,
                    scale: props.titleScale ?? 1,
                    bold: props.titleBold ?? true,
                    italic: props.titleItalic ?? false,
                    letterSpacing: props.titleLetterSpacing ?? 0,
                    lineHeight: props.titleLineHeight ?? 1.1,
                  }}
                  subtitleTypography={{
                    font: props.subtitleFont ?? null,
                    color: props.subtitleColor ?? null,
                    scale: props.subtitleScale ?? 1,
                  }}
                  format={format}
                  containerWidth={width}
                  reveal={anim.reveal}
                />
              </div>
              </TextAnimationLayer>
            )}

            {type === 'cards' && (
              // Fondu, glissement et pop s'appliquent aux cartes ; la machine
              // a ecrire, NON. Cote navigateur les cartes sont une PHOTO du
              // conteneur, sur laquelle une frappe lettre a lettre ne peut
              // rien : `drawCards` le dit, et le rendu serveur s'aligne
              // dessus plutot que d'offrir un effet que l'autre moteur n'a
              // pas.
              <TextAnimationLayer style={animation} progress={anim.progress}>
              {/* Le MEME composant que l'apercu, a la resolution de la
                  composition. C'est ce qui rend la parite structurelle :
                  aucune seconde implementation a recaler. */}
              <SequenceCards
                cards={(props.cards ?? []).map((c, i) => ({
                  id: (c as { id?: string }).id ?? `c${i}`,
                  icon: c.icon ?? 'Sparkles',
                  title: c.title ?? c.label ?? '',
                  value: c.value,
                }))}
                cardBoxes={props.cardBoxes ?? null}
                containerWidth={width}
                landscape={!isReel}
                valueColor={props.gradientEnd || DEFAULT_COLORS.gradientEnd}
              />
              </TextAnimationLayer>
            )}

            {type === 'cta' && (
              <TextAnimationLayer style={animation} progress={anim.progress}>
              <div style={ctaFrameStyle(props.ctaPos ?? TEXT_LAYOUT.ctaPos)}>
                <SequenceCta
                  text={props.ctaText ?? ''}
                  subText={props.ctaSubText}
                  typography={{
                    font: props.ctaFont || 'Inter',
                    color: props.ctaColor ?? '#FFFFFF',
                    subColor: props.ctaSubColor ?? '#EC4899',
                    scale: props.ctaScale ?? 1,
                    bold: props.ctaBold ?? true,
                    italic: props.ctaItalic ?? false,
                    letterSpacing: props.ctaLetterSpacing ?? 0,
                    lineHeight: props.ctaLineHeight ?? 1.2,
                  }}
                  format={format}
                  containerWidth={width}
                  reveal={anim.reveal}
                />
              </div>
              </TextAnimationLayer>
            )}

            {/* Elements libres — le MEME composant que l'apercu, sur les
                quatre sequences. Places AVANT le filigrane : le compositeur
                canvas peint le texte de site apres eux, donc par-dessus. */}
            <FreeElementsLayer
              elements={props.elements ?? []}
              containerWidth={width}
            />

            <Filigrane texte={props.watermark} echelle={echelle} />
          </AbsoluteFill>
        );

        // La transition se joue dans les DERNIERES images de la sequence
        // sortante, comme sur le canvas. `TransitionSeries` chevauchant les
        // deux sequences, chaque sequence sauf la premiere porte la duree de
        // transition en plus : le chevauchement la consomme, et le total
        // retombe sur la somme des durees voulues.
        const durees = seriesSequenceFrames(base, tFrames);
        const style = resolveStyle(props.transition);
        const animation = resolveAnimation(props.textAnimation);

        return (
          <TransitionSeries>
            {sequences.map((seq, i) => (
              <React.Fragment key={`${seq.type}-${i}`}>
                {i > 0 && (
                  <TransitionSeries.Transition
                    presentation={transitionPresentation(style, { width, height })}
                    timing={transitionTiming(style, tFrames)}
                  />
                )}
                <TransitionSeries.Sequence durationInFrames={durees[i]} name={seq.type}>
                  {/* L'avancement se mesure DANS la sequence : il faut donc
                      un composant, `useCurrentFrame` etant relatif a elle. */}
                  <SequenceAnimee
                    style={animation}
                    baseFrames={base[i]}
                    prefixFrames={i === 0 ? 0 : tFrames}
                    rendu={(anim) => contenu(seq.type, anim, departSerie(i))}
                  />
                </TransitionSeries.Sequence>
              </React.Fragment>
            ))}
          </TransitionSeries>
        );
      })()}

    </AbsoluteFill>
  );
};
