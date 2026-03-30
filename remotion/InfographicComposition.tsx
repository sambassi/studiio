import {
  AbsoluteFill,
  Audio,
  Img,
  Loop,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type {InfographicProps, InfoCard} from "./types";

// ── BRAND ───────────────────────────────────────────────────
const VIOLET = "#D91CD2";
const NEON_PINK = "#FF2DAA";
const DARK_BG = "#000000";

const AFROBOOST_DESCRIPTION =
  "Afroboost : cardio + danse afrobeat\n+ casques audio immersifs.\nUn entraînement fun, énergétique\net accessible à tous.";

// ── TIMINGS ─────────────────────────────────────────────────
const INTRO_DUR = 3.0;
const CARD_INTERVAL = 1.6;
const VALUE_POP_DELAY = 0.25;
const CTA_DURATION = 5.0;
const MIX_TRANSITION = 0.4;

// ══════════════════════════════════════════════════════════════
// ══  PARTICULE                                                ══
// ══════════════════════════════════════════════════════════════
const Particle: React.FC<{delay: number; x: number; fps: number}> = ({delay, x, fps}) => {
  const frame = useCurrentFrame();
  const cycleDur = 6 * fps;
  const localFrame = ((frame - delay * fps) % cycleDur + cycleDur) % cycleDur;
  const progress = localFrame / cycleDur;
  const opacity = progress < 0.15 ? progress / 0.15 * 0.5
    : progress < 0.7 ? 0.5 - (progress - 0.15) * 0.3
    : Math.max(0, 0.5 - (progress - 0.7) * 1.5);
  const y = 110 - progress * 120;
  return (
    <div style={{
      position: "absolute", left: `${x}%`, bottom: `${y}%`,
      width: 3, height: 3, borderRadius: "50%",
      background: VIOLET, opacity: Math.max(0, opacity), pointerEvents: "none",
    }} />
  );
};

// ══════════════════════════════════════════════════════════════
// ══  HELPER : Titre affiché (réutilisé intro + contenu)       ══
// ══════════════════════════════════════════════════════════════
const TitleBlock: React.FC<{
  themeTitle: string;
  themeSubtitle?: string;
  tagLine: string;
  titleSize: number;
  tagSize: number;
  subSize: number;
  tagProgress: number;
  titleProgress: number;
  subProgress: number;
  divProgress: number;
  centered?: boolean;
}> = ({themeTitle, themeSubtitle, tagLine, titleSize, tagSize, subSize, tagProgress, titleProgress, subProgress, divProgress, centered}) => {
  const align = centered ? "center" : "left";
  const origin = centered ? "center center" : "left center";

  return (
    <div style={{
      textAlign: align as any,
      padding: centered ? "24px 16px" : "12px 8px",
    }}>
      {/* Tag */}
      <div style={{
        fontSize: tagSize, fontWeight: 700, letterSpacing: 8,
        color: `rgba(217, 28, 210, ${0.6 * tagProgress})`,
        textTransform: "uppercase",
        transform: `translateY(${interpolate(tagProgress, [0, 1], [-15, 0])}px)`,
        opacity: tagProgress,
        fontFamily: "'Montserrat', 'Inter', sans-serif",
      }}>{tagLine}</div>

      {/* Titre */}
      <div style={{
        fontSize: titleSize, fontWeight: 900, lineHeight: 1.05,
        marginTop: centered ? 20 : 10,
        transform: `scale(${interpolate(titleProgress, [0, 1], [0.8, 1])})`,
        transformOrigin: origin,
        opacity: titleProgress,
        fontFamily: "'Montserrat', 'Inter', sans-serif",
        textShadow: `0 4px 20px rgba(0,0,0,0.9), 0 0 60px rgba(217,28,210,0.5), 0 0 120px rgba(217,28,210,0.25)`,
      }}>
        {themeTitle.split("&").length > 1 ? (
          <>
            {themeTitle.split("&")[0].trim()}<br />
            <span style={{fontSize: titleSize * 0.5, color: "rgba(255,255,255,0.5)", fontWeight: 700}}>&amp;</span>{" "}
            <span style={{color: VIOLET}}>{themeTitle.split("&")[1].trim()}</span>
          </>
        ) : (
          <span style={{color: VIOLET}}>{themeTitle}</span>
        )}
      </div>

      {/* Sous-titre */}
      {themeSubtitle && (
        <div style={{
          fontSize: subSize, color: "rgba(255,255,255,0.5)",
          marginTop: centered ? 16 : 8, letterSpacing: 1.5,
          transform: `translateY(${interpolate(subProgress, [0, 1], [12, 0])}px)`,
          opacity: subProgress,
          fontFamily: "'Montserrat', 'Inter', sans-serif",
        }}>{themeSubtitle}</div>
      )}

      {/* Divider */}
      <div style={{
        width: interpolate(divProgress, [0, 1], [0, centered ? 80 : 50]),
        height: 3,
        background: `linear-gradient(90deg, ${centered ? "transparent," : ""}${VIOLET}, transparent)`,
        marginTop: centered ? 24 : 12,
        marginLeft: centered ? "auto" : 0,
        marginRight: centered ? "auto" : 0,
        opacity: divProgress,
      }} />
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
// ══  CARTE — TRÈS GRANDE, LISIBLE SUR MOBILE                 ══
// ══════════════════════════════════════════════════════════════
const AnimatedCard: React.FC<{
  card: InfoCard; index: number; appearFrame: number;
  isVertical: boolean; fps: number;
}> = ({card, index, appearFrame, isVertical, fps}) => {
  const frame = useCurrentFrame();
  const relFrame = frame - appearFrame;
  const fromLeft = index % 2 === 0;
  const slideProgress = spring({frame: Math.max(0, relFrame), fps, config: {damping: 14, stiffness: 140, mass: 0.7}});
  const translateX = fromLeft
    ? interpolate(slideProgress, [0, 1], [-60, 0])
    : interpolate(slideProgress, [0, 1], [60, 0]);
  const opacity = interpolate(slideProgress, [0, 1], [0, 1]);
  const valueDelay = VALUE_POP_DELAY * fps;
  const valueProgress = spring({frame: Math.max(0, relFrame - valueDelay), fps, config: {damping: 10, stiffness: 200, mass: 0.6}});
  const valueScale = interpolate(valueProgress, [0, 1], [0.3, 1]);
  const valueOpacity = interpolate(valueProgress, [0, 1], [0, 1]);
  const barOpacity = interpolate(slideProgress, [0.5, 1], [0, 1], {extrapolateRight: "clamp"});

  // ── TAILLES MAXIMALES pour lisibilité mobile ──
  const iconSize = isVertical ? 64 : 48;
  const titleSize = isVertical ? 32 : 24;
  const descSize = isVertical ? 24 : 18;
  const valueSize = isVertical ? 40 : 30;
  const padding = isVertical ? "18px 22px" : "14px 18px";
  const borderRadius = isVertical ? 18 : 12;

  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: isVertical ? 18 : 14,
      padding, borderRadius,
      background: `rgba(217, 28, 210, ${slideProgress > 0.5 ? 0.08 : 0.04})`,
      border: `1.5px solid rgba(217, 28, 210, ${slideProgress > 0.5 ? 0.3 : 0.1})`,
      opacity, transform: `translateX(${translateX}px)`,
      position: "relative", overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", left: 0, top: 0, width: 5, height: "100%",
        background: `linear-gradient(to bottom, ${VIOLET}, ${NEON_PINK})`, opacity: barOpacity,
      }} />
      <div style={{
        width: iconSize, height: iconSize, borderRadius: iconSize * 0.28,
        background: "rgba(217, 28, 210, 0.1)", border: "1.5px solid rgba(217, 28, 210, 0.2)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: iconSize * 0.55, flexShrink: 0, marginTop: 2,
      }}>{card.icon}</div>
      <div style={{flex: 1, minWidth: 0}}>
        <div style={{
          fontSize: titleSize, fontWeight: 900, color: VIOLET, letterSpacing: 1,
          fontFamily: "'Montserrat', 'Inter', sans-serif", textTransform: "uppercase",
        }}>{card.title}</div>
        <div style={{
          fontSize: descSize, color: "#FFFFFF", lineHeight: 1.5, marginTop: 4,
          fontWeight: 500, letterSpacing: 0.3,
          fontFamily: "'Montserrat', 'Inter', sans-serif",
          textShadow: "0 1px 4px rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.4)",
        }}>{card.description}</div>
      </div>
      <div style={{
        fontSize: valueSize, fontWeight: 900, color: NEON_PINK,
        textShadow: `0 0 18px rgba(255, 45, 170, 0.35)`, flexShrink: 0,
        opacity: valueOpacity, transform: `scale(${valueScale})`,
        fontFamily: "'Montserrat', 'Inter', sans-serif",
        marginTop: 4,
      }}>{card.value}</div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
// ══  MIX SECTION                                              ══
// ══════════════════════════════════════════════════════════════
const MixOverlay: React.FC = () => (
  <div style={{
    position: "absolute", inset: 0,
    background: "linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, transparent 30%, transparent 70%, rgba(0,0,0,0.5) 100%)",
    pointerEvents: "none",
  }} />
);

const MixSection: React.FC<{
  videos: string[]; clipDuration: number; startTimes?: number[];
  videoDurations?: number[];
  fps: number; totalFrames: number; isVertical: boolean;
}> = ({videos, clipDuration, startTimes, videoDurations, fps, totalFrames}) => {
  if (!videos || videos.length === 0) return null;

  const mixDurationSec = totalFrames / fps;

  if (videos.length === 1) {
    // Durée réelle de la vidéo détectée par ffprobe
    const realDur = videoDurations?.[0] ?? 999;
    const startSec = startTimes?.[0] ?? 0;
    const effectiveDur = Math.max(realDur - startSec, 1);

    // Si la vidéo est assez longue pour couvrir le mix → lecture directe, PAS de loop
    if (effectiveDur >= mixDurationSec - 0.5) {
      return (
        <AbsoluteFill>
          <OffthreadVideo src={videos[0]}
            startFrom={Math.round(startSec * fps)}
            toneMapped={false}
            style={{width: "100%", height: "100%", objectFit: "cover"}} volume={0} />
          <MixOverlay />
        </AbsoluteFill>
      );
    }

    // Vidéo plus courte que le mix → Loop pour combler la durée
    const loopFrames = Math.max(Math.round(effectiveDur * fps), 1);
    return (
      <AbsoluteFill>
        <Loop durationInFrames={loopFrames}>
          <OffthreadVideo src={videos[0]}
            startFrom={Math.round(startSec * fps)}
            toneMapped={false}
            style={{width: "100%", height: "100%", objectFit: "cover"}} volume={0} />
        </Loop>
        <MixOverlay />
      </AbsoluteFill>
    );
  }

  // Plusieurs vidéos : alterner les clips
  const clipFrames = Math.round(clipDuration * fps);
  const clips: {src: string; from: number; dur: number; loopFrames: number}[] = [];
  let f = 0;
  for (let i = 0; f < totalFrames; i++) {
    const vidIdx = i % videos.length;
    const dur = Math.min(clipFrames, totalFrames - f);
    const realDur = videoDurations?.[vidIdx] ?? 999;
    const loopF = Math.max(Math.round(realDur * fps), 1);
    clips.push({src: videos[vidIdx], from: f, dur, loopFrames: loopF});
    f += dur;
  }
  return (
    <AbsoluteFill>
      {clips.map((clip, i) => (
        <Sequence key={i} from={clip.from} durationInFrames={clip.dur}>
          <AbsoluteFill>
            {clip.dur <= clip.loopFrames ? (
              // Le clip est plus court ou = à la vidéo → pas besoin de loop
              <OffthreadVideo src={clip.src}
                toneMapped={false}
                style={{width: "100%", height: "100%", objectFit: "cover"}} volume={0} />
            ) : (
              // Le clip est plus long que la vidéo → loop
              <Loop durationInFrames={clip.loopFrames}>
                <OffthreadVideo src={clip.src}
                  toneMapped={false}
                  style={{width: "100%", height: "100%", objectFit: "cover"}} volume={0} />
              </Loop>
            )}
            <MixOverlay />
          </AbsoluteFill>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

// ══════════════════════════════════════════════════════════════
// ══  ÉCRAN CTA FINAL                                          ══
// ══════════════════════════════════════════════════════════════
const CTAScreen: React.FC<{
  logoUrl?: string; ctaText: string; ctaSubText: string;
  isVertical: boolean; fps: number;
}> = ({logoUrl, ctaText, ctaSubText, isVertical, fps}) => {
  const frame = useCurrentFrame();
  const {width} = useVideoConfig();
  const logoSp = spring({fps, frame: Math.max(0, frame), config: {damping: 14, stiffness: 160, mass: 0.6}});
  const titleSp = spring({fps, frame: Math.max(0, frame - 4), config: {damping: 10, stiffness: 140, mass: 0.8}});
  const descDelay = Math.max(0, frame - Math.round(fps * 0.3));
  const descOp = interpolate(descDelay, [0, 20], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const ctaBtnDelay = Math.max(0, frame - Math.round(fps * 0.8));
  const ctaBtnSp = spring({fps, frame: ctaBtnDelay, config: {damping: 12, stiffness: 120, mass: 0.8}});
  const pulsePhase = Math.max(0, frame - Math.round(fps * 1.5));
  const pulse = pulsePhase > 0 ? 1 + Math.sin(pulsePhase * 0.18) * 0.04 : 1;
  const glow = pulsePhase > 0 ? 0.4 + Math.sin(pulsePhase * 0.18) * 0.3 : 0.2;
  const lienDelay = Math.max(0, frame - Math.round(fps * 1.2));
  const lienOp = interpolate(lienDelay, [0, 15], [0, 0.55], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});

  return (
    <AbsoluteFill>
      <div style={{position: "absolute", inset: 0,
        background: "linear-gradient(180deg, #000000 0%, #050008 35%, #0a0015 70%, #120020 100%)"}} />
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        justifyContent: "center", alignItems: "center",
        gap: isVertical ? 36 : 28, padding: isVertical ? "60px 40px" : "40px 80px",
      }}>
        {logoUrl && (
          <div style={{
            opacity: interpolate(logoSp, [0, 1], [0, 1]),
            transform: `scale(${interpolate(logoSp, [0, 1], [0.3, 1])}) translateY(${interpolate(logoSp, [0, 1], [20, 0])}px)`,
            display: "flex", flexDirection: "column", alignItems: "center",
          }}>
            <Img src={logoUrl} style={{
              width: isVertical ? 400 : 320, height: "auto", objectFit: "contain",
              filter: "drop-shadow(0 0 20px rgba(217,28,210,0.4)) drop-shadow(0 0 40px rgba(217,28,210,0.2))",
            }} />
          </div>
        )}
        <div style={{
          opacity: interpolate(titleSp, [0, 1], [0, 1]),
          transform: `scale(${interpolate(titleSp, [0, 1], [0.5, 1])})`,
          fontSize: isVertical ? 68 : 52, fontWeight: 900, letterSpacing: 8, color: "#FFF",
          textAlign: "center", textShadow: "0 0 40px rgba(217,28,210,0.5), 0 0 80px rgba(217,28,210,0.3)",
          textTransform: "lowercase", fontFamily: "'Montserrat', 'Inter', sans-serif",
        }}>afroboost.com</div>
        <div style={{opacity: descOp, maxWidth: isVertical ? width * 0.85 : 700, textAlign: "center"}}>
          {AFROBOOST_DESCRIPTION.split("\n").map((line, i) => (
            <div key={i} style={{
              fontSize: isVertical ? 26 : 20, fontWeight: 500, color: "#FFFFFF",
              lineHeight: 1.6, letterSpacing: 1, fontFamily: "'Montserrat', 'Inter', sans-serif",
            }}>{line}</div>
          ))}
        </div>
        <div style={{
          opacity: interpolate(ctaBtnSp, [0, 1], [0, 1]),
          transform: `scale(${interpolate(ctaBtnSp, [0, 1], [0.7, 1]) * pulse})`,
        }}>
          <div style={{
            padding: isVertical ? "26px 52px" : "20px 44px",
            border: `2px solid ${VIOLET}`, borderRadius: 10,
            background: `rgba(217,28,210,${0.08 + glow * 0.15})`,
            boxShadow: `0 0 ${20 + glow * 40}px rgba(217,28,210,${glow}), inset 0 0 20px rgba(217,28,210,0.05)`,
          }}>
            <div style={{
              fontSize: isVertical ? 32 : 26, fontWeight: 900, color: "#FFF", letterSpacing: 4,
              textTransform: "uppercase", textAlign: "center",
              textShadow: `0 0 12px rgba(217,28,210,${glow})`,
              fontFamily: "'Montserrat', 'Inter', sans-serif",
            }}>CHAT POUR PLUS D'INFOS</div>
          </div>
        </div>
        <div style={{
          opacity: lienOp, fontSize: isVertical ? 24 : 19, fontWeight: 600,
          color: "rgba(255,255,255,0.45)", letterSpacing: 5,
          textTransform: "uppercase", textAlign: "center",
          fontFamily: "'Montserrat', 'Inter', sans-serif",
        }}>LIEN EN BIO</div>
      </div>
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        height: isVertical ? 200 : 140,
        background: "linear-gradient(to top, rgba(140,20,180,0.5) 0%, rgba(100,10,140,0.25) 40%, transparent 100%)",
        pointerEvents: "none",
      }} />
    </AbsoluteFill>
  );
};

// ══════════════════════════════════════════════════════════════
// ══  COMPOSITION PRINCIPALE                                    ══
// ══════════════════════════════════════════════════════════════
export const InfographicComposition: React.FC<InfographicProps> = (props) => {
  const frame = useCurrentFrame();
  const {fps, width, height, durationInFrames} = useVideoConfig();
  const isVertical = height > width;

  const introFrames = Math.round(INTRO_DUR * fps);
  const infoDurSec = props.infoDurationSec ?? 20;
  const mixDurSec = props.mixDurationSec ?? 10;
  const hasMix = props.mixVideos && props.mixVideos.length > 0;
  const ctaFramesDur = Math.round(CTA_DURATION * fps);
  const infoFrames = Math.round(infoDurSec * fps);
  const mixFrames = hasMix ? Math.round(mixDurSec * fps) : 0;

  // Timeline : tout est continu, PAS de Sequence séparée intro/contenu
  // [0 → introFrames] = affiche GROS titre centré plein écran
  // [introFrames → introFrames + infoFrames] = titre en haut + cartes
  // Le titre se TRANSFORME en douceur de centré → haut
  const mixStart = introFrames + infoFrames;
  const ctaStart = mixStart + mixFrames;

  const cards = props.cards || [];
  const tagLine = props.tagLine || "THÉMATIQUE DU JOUR";
  const ctaText = props.ctaText || "LA PISTE T'ATTEND";
  const ctaSubText = props.ctaSubText || "AFROBOOST.COM";

  // Cartes : démarrent dès la fin de l'intro, très rapide
  const cardAppearFrames = cards.map((_, i) =>
    introFrames + Math.round((0.2 + i * CARD_INTERVAL) * fps)
  );

  // CTA infographie : après dernière carte + 2s
  const lastCardFrame = cardAppearFrames[cardAppearFrames.length - 1] ?? introFrames;
  const infoCTAFrame = lastCardFrame + Math.round(2 * fps);
  const infoCTAProgress = spring({frame: Math.max(0, frame - infoCTAFrame), fps, config: {damping: 12, stiffness: 80}});
  const shimmerX = frame > infoCTAFrame + fps
    ? interpolate((frame - infoCTAFrame - fps) % (3 * fps), [0, 3 * fps], [-100, 200])
    : -100;

  // Ambient glow
  const ambientPulse = interpolate(Math.sin(frame / fps * Math.PI * 0.5), [-1, 1], [0.4, 0.8]);

  // ── TRANSITION TITRE : de centré/gros → haut/petit ──
  // De frame 0 à introFrames c'est l'intro, après c'est les cartes
  // introPhase used implicitly via transitionToContent
  const transitionToContent = interpolate(
    frame, [introFrames - Math.round(0.4 * fps), introFrames + Math.round(0.3 * fps)],
    [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"}
  );

  // Animations d'entrée du titre (partagées intro+contenu)
  const tagProg = spring({frame: Math.max(0, frame - 0.2 * fps), fps, config: {damping: 15, stiffness: 100}});
  const titleProg = spring({frame: Math.max(0, frame - 0.5 * fps), fps, config: {damping: 12, stiffness: 80, mass: 0.8}});
  const subProg = spring({frame: Math.max(0, frame - 0.9 * fps), fps, config: {damping: 15, stiffness: 100}});
  const divProg = spring({frame: Math.max(0, frame - 1.1 * fps), fps, config: {damping: 15, stiffness: 100}});

  // Taille du titre :
  // Avec image : taille fixe qui tient dans la zone noire du haut
  // Sans image : grand en intro → plus petit en contenu
  const introTitleSize = isVertical ? 220 : 170;
  const contentTitleSize = isVertical ? 160 : 120;
  const imageTitleSize = isVertical ? 180 : 140; // Fixe, tient dans la zone noire
  const currentTitleSize = props.characterImage
    ? imageTitleSize
    : interpolate(transitionToContent, [0, 1], [introTitleSize, contentTitleSize]);

  const introTagSize = isVertical ? 30 : 22;
  const contentTagSize = isVertical ? 22 : 16;
  const currentTagSize = props.characterImage
    ? introTagSize
    : interpolate(transitionToContent, [0, 1], [introTagSize, contentTagSize]);

  const introSubSize = isVertical ? 34 : 26;
  const contentSubSize = isVertical ? 28 : 20;
  const currentSubSize = props.characterImage
    ? introSubSize
    : interpolate(transitionToContent, [0, 1], [introSubSize, contentSubSize]);

  // Position du titre :
  // - AVEC image : toujours en haut (zone noire au-dessus du personnage)
  // - SANS image : centré en intro → haut en bienfaits (animation)
  const hasCharacterImage = !!props.characterImage;
  const titleY = hasCharacterImage
    ? (isVertical ? -height * 0.35 : -height * 0.32) // Fixe en haut
    : isVertical
      ? interpolate(transitionToContent, [0, 1], [0, -height * 0.32])
      : interpolate(transitionToContent, [0, 1], [0, -height * 0.3]);

  // Info → Mix transition
  const infoEndFrame = mixStart;
  const mixTransStart = infoEndFrame - Math.round(MIX_TRANSITION * fps);
  const infoOpacity = frame < mixTransStart ? 1
    : interpolate(frame, [mixTransStart, infoEndFrame], [1, 0], {extrapolateRight: "clamp"});

  // Progress bar
  const progress = (frame / durationInFrames) * 100;

  // Phase checks
  const isInInfoPhase = frame < mixStart;

  return (
    <AbsoluteFill style={{backgroundColor: DARK_BG}}>
      {/* ── Audio ── */}
      {props.backgroundAudio && <Audio src={props.backgroundAudio} volume={props.voiceOverAudio ? 0.12 : 0.25} />}
      {props.voiceOverAudio && <Audio src={props.voiceOverAudio} volume={1.5} />}

      {/* ══ PHASE INFOGRAPHIE (0 → mixStart) ══ */}
      {isInInfoPhase && (
        <AbsoluteFill style={{opacity: infoOpacity}}>
          {/* Ambient glow */}
          <div style={{
            position: "absolute", width: "200%", height: "200%",
            top: "-50%", left: "-50%",
            background: `radial-gradient(circle at 50% 50%, rgba(217,28,210,${0.05 * ambientPulse}) 0%, transparent 55%)`,
            pointerEvents: "none",
          }} />
          {[10, 25, 40, 55, 70, 85, 15, 60].map((x, i) => (
            <Particle key={i} delay={i * 0.8} x={x} fps={fps} />
          ))}

          {/* ── Image personnage (style affiche) ── */}
          {props.characterImage && (() => {
            // INTRO : personnage lumineux, bien visible (affiche)
            // BIENFAITS : personnage TRÈS sombre → texte lisible
            const charBrightness = interpolate(
              transitionToContent, [0, 1], [1.0, 0.12],
              {extrapolateLeft: "clamp", extrapolateRight: "clamp"}
            );
            const overlayOpacity = interpolate(
              transitionToContent, [0, 1], [0.0, 0.75],
              {extrapolateLeft: "clamp", extrapolateRight: "clamp"}
            );
            return (
            <div style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              width: "100%",
              height: isVertical ? "72%" : "100%",
              zIndex: 1,
              overflow: "hidden",
            }}>
              <Img
                src={props.characterImage}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: isVertical ? "center top" : "center center",
                  filter: `brightness(${charBrightness}) contrast(1.05) saturate(1.1)`,
                }}
              />
              {/* Léger dégradé en haut pour fusion douce avec la zone noire */}
              <div style={{
                position: "absolute", top: 0, left: 0, right: 0,
                height: "15%",
                background: "linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%)",
              }} />
              {/* Dégradé bas : pour le CTA/watermark */}
              <div style={{
                position: "absolute", bottom: 0, left: 0, right: 0,
                height: "15%",
                background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)",
              }} />
              {/* Overlay dynamique : transparent en intro, très sombre sur bienfaits */}
              <div style={{
                position: "absolute", inset: 0,
                background: `rgba(0,0,0,${overlayOpacity})`,
              }} />
            </div>
            );
          })()}

          {/* ── afroboost.com watermark (visible on ALL infographic screens) ── */}
          <div style={{
            position: "absolute",
            bottom: isVertical ? 32 : 22,
            left: 0, right: 0,
            textAlign: "center",
            zIndex: 10,
            pointerEvents: "none",
          }}>
            <span style={{
              fontSize: isVertical ? 34 : 26,
              fontWeight: 800,
              letterSpacing: 6,
              color: "rgba(255,255,255,0.35)",
              textTransform: "lowercase",
              fontFamily: "'Montserrat', 'Inter', sans-serif",
              textShadow: "0 0 15px rgba(217,28,210,0.4), 0 0 30px rgba(217,28,210,0.2)",
            }}>afroboost.com</span>
          </div>

          {/* ── VERTICAL 9:16 ── */}
          {isVertical ? (
            <div style={{
              width: "100%", height: "100%",
              display: "flex", flexDirection: "column",
              position: "relative", zIndex: 2,
            }}>
              {/* Titre — morphe de centré/gros à haut/petit */}
              <div style={{
                position: "absolute",
                left: 0, right: 0,
                top: "50%",
                transform: `translateY(calc(-50% + ${titleY}px))`,
                padding: "0 36px",
                textAlign: "center",
                zIndex: 3,
              }}>
                <TitleBlock
                  themeTitle={props.themeTitle}
                  themeSubtitle={props.themeSubtitle}
                  tagLine={tagLine}
                  titleSize={currentTitleSize}
                  tagSize={currentTagSize}
                  subSize={currentSubSize}
                  tagProgress={tagProg}
                  titleProgress={titleProg}
                  subProgress={subProg}
                  divProgress={divProg}
                  centered={true}
                />
              </div>

              {/* Cartes — apparaissent après intro, en bas */}
              <div style={{
                position: "absolute",
                left: 0, right: 0,
                bottom: 0,
                top: isVertical ? "24%" : "20%",
                padding: "0 32px 32px",
                display: "flex", flexDirection: "column",
                gap: 16,
                justifyContent: "center",
                opacity: interpolate(transitionToContent, [0.5, 1], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"}),
              }}>
                {cards.map((card, i) => (
                  <AnimatedCard key={i} card={card} index={i}
                    appearFrame={cardAppearFrames[i] ?? 0} isVertical={true} fps={fps} />
                ))}

                {/* Mini CTA */}
                <div style={{
                  textAlign: "center", marginTop: 10, padding: "22px 28px", borderRadius: 18,
                  background: `linear-gradient(135deg, rgba(217,28,210,0.12), rgba(255,45,170,0.08))`,
                  border: `1.5px solid rgba(217,28,210,${0.3 * infoCTAProgress})`,
                  opacity: infoCTAProgress,
                  transform: `translateY(${interpolate(infoCTAProgress, [0, 1], [15, 0])}px)`,
                  position: "relative", overflow: "hidden",
                }}>
                  <div style={{
                    position: "absolute", top: 0, left: `${shimmerX}%`, width: "50%", height: "100%",
                    background: `linear-gradient(90deg, transparent, rgba(217,28,210,0.12), transparent)`,
                    pointerEvents: "none",
                  }} />
                  <div style={{fontSize: 34, fontWeight: 900, color: VIOLET,
                    textShadow: `0 0 25px rgba(217,28,210,0.4)`, position: "relative", zIndex: 1,
                    fontFamily: "'Montserrat', 'Inter', sans-serif"}}>{ctaText}</div>
                  <div style={{fontSize: 20, color: "rgba(255,255,255,0.4)", marginTop: 4,
                    position: "relative", zIndex: 1,
                    fontFamily: "'Montserrat', 'Inter', sans-serif"}}>{ctaSubText}</div>
                </div>
              </div>
            </div>

          ) : (
            /* ── HORIZONTAL 16:9 ── */
            <div style={{
              width: "100%", height: "100%",
              display: "flex", flexDirection: "column",
              position: "relative", zIndex: 2,
            }}>
              {/* Titre — centré en intro, glisse vers le haut en phase cartes */}
              <div style={{
                position: "absolute",
                left: 0, right: 0,
                top: "50%",
                transform: `translateY(calc(-50% + ${titleY}px))`,
                padding: "0 50px",
                textAlign: "center",
                zIndex: 3,
              }}>
                <TitleBlock
                  themeTitle={props.themeTitle}
                  themeSubtitle={props.themeSubtitle}
                  tagLine={tagLine}
                  titleSize={currentTitleSize}
                  tagSize={currentTagSize}
                  subSize={currentSubSize}
                  tagProgress={tagProg}
                  titleProgress={titleProg}
                  subProgress={subProg}
                  divProgress={divProg}
                  centered={true}
                />
              </div>

              {/* Cartes — apparaissent après intro, centrées au milieu */}
              <div style={{
                position: "absolute",
                left: "50%",
                transform: "translateX(-50%)",
                top: "22%",
                bottom: 0,
                width: "75%",
                padding: "0 30px 60px",
                display: "flex", flexDirection: "column",
                gap: 12,
                justifyContent: "center",
                opacity: interpolate(transitionToContent, [0.5, 1], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"}),
              }}>
                {cards.map((card, i) => (
                  <AnimatedCard key={i} card={card} index={i}
                    appearFrame={cardAppearFrames[i] ?? 0} isVertical={false} fps={fps} />
                ))}

                {/* Mini CTA sous les cartes */}
                <div style={{
                  textAlign: "center", marginTop: 8, padding: "14px 24px", borderRadius: 12,
                  background: `linear-gradient(135deg, rgba(217,28,210,0.12), rgba(255,45,170,0.08))`,
                  border: `1.5px solid rgba(217,28,210,${0.3 * infoCTAProgress})`,
                  opacity: infoCTAProgress,
                  transform: `translateY(${interpolate(infoCTAProgress, [0, 1], [10, 0])}px)`,
                  position: "relative", overflow: "hidden",
                }}>
                  <div style={{
                    position: "absolute", top: 0, left: `${shimmerX}%`, width: "50%", height: "100%",
                    background: `linear-gradient(90deg, transparent, rgba(217,28,210,0.15), transparent)`,
                    pointerEvents: "none",
                  }} />
                  <div style={{fontSize: 26, fontWeight: 900, color: VIOLET,
                    textShadow: `0 0 15px rgba(217,28,210,0.4)`, position: "relative", zIndex: 1,
                    fontFamily: "'Montserrat', 'Inter', sans-serif"}}>{ctaText}</div>
                  <div style={{fontSize: 15, color: "rgba(255,255,255,0.35)", marginTop: 4,
                    position: "relative", zIndex: 1,
                    fontFamily: "'Montserrat', 'Inter', sans-serif"}}>{ctaSubText}</div>
                </div>
              </div>

              {/* Progress dots */}
              <div style={{position: "absolute", bottom: 18, right: 50, display: "flex", gap: 6}}>
                {cards.map((_, i) => {
                  const isActive = frame >= (cardAppearFrames[i] ?? 0);
                  return (
                    <div key={i} style={{
                      width: isActive ? 20 : 6, height: 6, borderRadius: 3,
                      background: isActive ? VIOLET : "rgba(255,255,255,0.1)",
                      boxShadow: isActive ? `0 0 8px rgba(217,28,210,0.6)` : "none",
                    }} />
                  );
                })}
              </div>
            </div>
          )}
        </AbsoluteFill>
      )}

      {/* ══ MIX COURS ══ */}
      {hasMix && (
        <Sequence from={mixStart} durationInFrames={mixFrames}>
          <AbsoluteFill>
            <MixSection
              videos={props.mixVideos!}
              clipDuration={props.mixClipDuration ?? 2.5}
              startTimes={props.mixStartTimes}
              videoDurations={props.mixVideoDurations}
              fps={fps} totalFrames={mixFrames} isVertical={isVertical}
            />
            {/* ── afroboost.com watermark on mix section ── */}
            <div style={{
              position: "absolute",
              bottom: isVertical ? 32 : 22,
              left: 0, right: 0,
              textAlign: "center",
              zIndex: 10,
              pointerEvents: "none",
            }}>
              <span style={{
                fontSize: isVertical ? 36 : 28,
                fontWeight: 800,
                letterSpacing: 6,
                color: "rgba(255,255,255,0.45)",
                textTransform: "lowercase",
                fontFamily: "'Montserrat', 'Inter', sans-serif",
                textShadow: "0 0 15px rgba(217,28,210,0.5), 0 0 40px rgba(0,0,0,0.9)",
              }}>afroboost.com</span>
            </div>
          </AbsoluteFill>
        </Sequence>
      )}

      {/* ══ ÉCRAN CTA FINAL ══ */}
      <Sequence from={ctaStart} durationInFrames={ctaFramesDur}>
        <CTAScreen logoUrl={props.logoUrl} ctaText={ctaText} ctaSubText={ctaSubText}
          isVertical={isVertical} fps={fps} />
      </Sequence>

      {/* ── VIOLET BORDER GLOW ── */}
      <div style={{
        position: "absolute", inset: isVertical ? 8 : 6, zIndex: 4, pointerEvents: "none",
        border: `${isVertical ? 4 : 3}px solid rgba(217,28,210,0.7)`,
        borderRadius: isVertical ? 20 : 14,
        boxShadow: [
          `inset 0 0 40px rgba(217,28,210,0.2)`,
          `inset 0 0 80px rgba(140,0,180,0.1)`,
          `0 0 15px rgba(217,28,210,0.5)`,
          `0 0 30px rgba(217,28,210,0.35)`,
          `0 0 60px rgba(217,28,210,0.2)`,
          `0 0 100px rgba(140,0,180,0.12)`,
        ].join(", "),
      }} />

      {/* ── PROGRESS BAR ── */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        height: 4, backgroundColor: "rgba(255,255,255,0.08)", zIndex: 5,
      }}>
        <div style={{
          height: "100%", width: `${progress}%`,
          background: `linear-gradient(90deg, ${NEON_PINK}, ${VIOLET})`,
          boxShadow: "0 0 8px rgba(217,28,210,0.6)",
        }} />
      </div>
    </AbsoluteFill>
  );
};
