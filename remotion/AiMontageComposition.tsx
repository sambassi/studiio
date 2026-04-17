import React from 'react';
import {
  AbsoluteFill,
  Sequence,
  Img,
  OffthreadVideo,
  Audio,
  interpolate,
  useCurrentFrame,
  spring,
  useVideoConfig,
} from 'remotion';

export interface MontageClip {
  src: string;
  startSec: number;
  endSec: number;
}

export interface AiMontageProps {
  clips: MontageClip[];
  transition: 'crossfade' | 'cut';
  title: { text: string; color: string };
  subtitle: string;
  cta: { text: string; subText: string; color: string };
  posterUrl: string | null;
  musicUrl: string | null;
  totalDurationFrames: number;
  format: '9:16' | '16:9';
  watermark?: boolean;
}

const TitleOverlay: React.FC<{ text: string; subtitle: string; color: string }> = ({ text, subtitle, color }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({ frame, fps, config: { damping: 12, stiffness: 100 } });
  const opacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity }}>
      <div style={{
        transform: `scale(${scale})`,
        textAlign: 'center',
        padding: '0 60px',
      }}>
        <h1 style={{
          fontSize: 72,
          fontWeight: 900,
          color: color || '#FFFFFF',
          textShadow: '0 4px 20px rgba(0,0,0,0.8)',
          lineHeight: 1.1,
          letterSpacing: 2,
        }}>
          {text}
        </h1>
        {subtitle && (
          <p style={{
            fontSize: 28,
            color: 'rgba(255,255,255,0.8)',
            marginTop: 12,
            textShadow: '0 2px 10px rgba(0,0,0,0.6)',
          }}>
            {subtitle}
          </p>
        )}
      </div>
    </AbsoluteFill>
  );
};

const CtaOverlay: React.FC<{ text: string; subText: string; color: string }> = ({ text, subText, color }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{
      justifyContent: 'flex-end',
      alignItems: 'center',
      padding: '0 0 120px 0',
      opacity,
    }}>
      <div style={{
        backgroundColor: 'rgba(0,0,0,0.7)',
        borderRadius: 16,
        padding: '20px 40px',
        textAlign: 'center',
        backdropFilter: 'blur(10px)',
      }}>
        <p style={{ fontSize: 36, fontWeight: 800, color: color || '#FFFFFF', letterSpacing: 3 }}>
          {text}
        </p>
        {subText && (
          <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.6)', marginTop: 6 }}>
            {subText}
          </p>
        )}
      </div>
    </AbsoluteFill>
  );
};

export const AiMontageComposition: React.FC<AiMontageProps> = ({
  clips,
  title,
  subtitle,
  cta,
  posterUrl,
  musicUrl,
  totalDurationFrames,
  watermark,
}) => {
  const fps = 30;
  const posterFrames = posterUrl ? 90 : 0;
  const ctaFrames = 45;
  const transitionFrames = 15;

  const availableForClips = totalDurationFrames - posterFrames - ctaFrames;
  const clipFrames = clips.length > 0 ? Math.floor(availableForClips / clips.length) : availableForClips;

  let currentFrom = posterFrames;

  return (
    <AbsoluteFill style={{ backgroundColor: '#0A0A0F' }}>
      {/* Poster intro with title */}
      {posterUrl && (
        <Sequence from={0} durationInFrames={posterFrames}>
          <AbsoluteFill>
            <Img src={posterUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <AbsoluteFill style={{
              background: 'linear-gradient(180deg, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.7) 100%)',
            }} />
            <TitleOverlay text={title.text} subtitle={subtitle} color={title.color} />
          </AbsoluteFill>
        </Sequence>
      )}

      {/* Title overlay if no poster — show on first clip */}
      {!posterUrl && (
        <Sequence from={0} durationInFrames={45}>
          <TitleOverlay text={title.text} subtitle={subtitle} color={title.color} />
        </Sequence>
      )}

      {/* Video clips */}
      {clips.map((clip, i) => {
        const from = currentFrom;
        currentFrom += clipFrames;
        const startFrame = Math.round(clip.startSec * fps);
        const endFrame = Math.round(clip.endSec * fps);

        return (
          <Sequence key={i} from={from} durationInFrames={clipFrames}>
            <AbsoluteFill>
              <OffthreadVideo
                src={clip.src}
                startFrom={startFrame}
                endAt={endFrame > startFrame ? endFrame : undefined}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              {/* Crossfade transition: fade in at start of each clip after the first */}
              {i > 0 && (
                <AbsoluteFill style={{ backgroundColor: '#0A0A0F' }}>
                  {(() => {
                    const FadeIn: React.FC = () => {
                      const f = useCurrentFrame();
                      const o = interpolate(f, [0, transitionFrames], [1, 0], { extrapolateRight: 'clamp' });
                      return <AbsoluteFill style={{ backgroundColor: '#0A0A0F', opacity: o }} />;
                    };
                    return <FadeIn />;
                  })()}
                </AbsoluteFill>
              )}
            </AbsoluteFill>
          </Sequence>
        );
      })}

      {/* CTA overlay */}
      <Sequence from={totalDurationFrames - ctaFrames} durationInFrames={ctaFrames}>
        <CtaOverlay text={cta.text} subText={cta.subText} color={cta.color} />
      </Sequence>

      {/* Music */}
      {musicUrl && (
        <Audio src={musicUrl} volume={0.5} />
      )}

      {/* Free-plan watermark */}
      {watermark && (
        <AbsoluteFill style={{
          justifyContent: 'flex-end',
          alignItems: 'flex-end',
          padding: '0 20px 20px 0',
        }}>
          <p style={{
            fontSize: 14,
            color: 'rgba(255,255,255,0.4)',
            fontWeight: 600,
          }}>
            studiio.pro
          </p>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
