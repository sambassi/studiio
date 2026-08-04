import React from 'react';
import {
  AbsoluteFill, Sequence, Audio, OffthreadVideo, Img, useVideoConfig,
} from 'remotion';
import {
  buildSequences, sequenceFrameOffsets, isReelFormat, editorViewportPx,
  gradientOverlayCss, DEFAULT_COLORS,
  type PlannedSequence,
} from '../src/lib/creer/designSpec';
import SequenceCards from '../src/components/creer/SequenceCards';
import SequenceTitle, { titleFrameStyle } from '../src/components/creer/SequenceTitle';
import SequenceCta, { ctaFrameStyle } from '../src/components/creer/SequenceCta';
import FreeElementsLayer, { type FreeElement } from '../src/components/creer/FreeElementsLayer';
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
 * - Les transitions entre séquences sont des coupes franches. Le fondu de
 *   0,8 s du navigateur arrive en phase suivante.
 * - Animations de texte, éléments libres, voix par séquence et recadrage
 *   d'affiche ne sont PAS rendus. Ils sont câblés « sans effet » — les props
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
  /** Non rendu en Phase 1. */
  textAnimation?: string;
  /** Non rendu en Phase 1. */
  transition?: string;
  /**
   * Elements libres — rendus depuis la Phase 5, par le composant PARTAGE.
   *
   * Sur TOUTES les sequences, comme le compositeur canvas qui appelle
   * `drawFreeElements` a la fin de chacune d'elles.
   */
  elements?: FreeElement[];
  /** Non rendu en Phase 1. */
  sequenceVoiceUrls?: Record<string, string | null>;
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
  const offsets = sequenceFrameOffsets(sequences, fps);
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

  return (
    // La famille de police est posee A LA RACINE : sans elle, tout element
    // qui n'en declare pas retombe sur le serif par defaut de Chromium — le
    // filigrane sortait en Times. La police WEB elle-meme (Inter) n'est pas
    // encore embarquee dans le bundle : c'est un point de Phase 2.
    // La pile de police vient de `fontStack` — la MEME fonction que l'ecran.
    <AbsoluteFill style={{ backgroundColor: DEFAULT_COLORS.dark, fontFamily: fontStack('Inter') }}>
      {props.musicUrl && <Audio src={props.musicUrl} />}

      {sequences.map((seq, i) => {
        const durationInFrames = Math.max(1, Math.round(seq.duration * fps));
        return (
          <Sequence
            key={`${seq.type}-${i}`}
            from={offsets[i]}
            durationInFrames={durationInFrames}
            name={seq.type}
          >
            <AbsoluteFill>
              {seq.type === 'video' && props.videoUrl ? (
                <OffthreadVideo
                  src={props.videoUrl}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  muted
                />
              ) : (
                <Fond props={props} type={seq.type} />
              )}

              {seq.type === 'intro' && (
                // Le MEME composant que l'apercu, et le MEME cadre : la
                // position vient de `titlePos`, comme a l'ecran.
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
                  />
                </div>
              )}

              {seq.type === 'cards' && (
                // Le MEME composant que l'apercu, a la resolution de la
                // composition. C'est ce qui rend la parite structurelle :
                // aucune seconde implementation a recaler.
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
              )}

              {seq.type === 'cta' && (
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
                  />
                </div>
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
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
