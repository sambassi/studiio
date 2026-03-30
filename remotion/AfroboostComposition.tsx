import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type {AfroboostProps, ElementPosition, PositionAnchor, VideoObjective} from "./types";

// ── POSITION HELPER ──────────────────────────────────────────
// Convertit une ancre ou des coordonnées X/Y en styles CSS
function anchorToXY(anchor: PositionAnchor): {x: number; y: number} {
  const map: Record<PositionAnchor, {x: number; y: number}> = {
    "top-left":      {x: 15, y: 15},
    "top-center":    {x: 50, y: 15},
    "top-right":     {x: 85, y: 15},
    "center-left":   {x: 15, y: 50},
    "center":        {x: 50, y: 50},
    "center-right":  {x: 85, y: 50},
    "bottom-left":   {x: 15, y: 80},
    "bottom-center": {x: 50, y: 80},
    "bottom-right":  {x: 85, y: 80},
  };
  return map[anchor] || {x: 50, y: 50};
}

function positionToStyle(pos?: ElementPosition): React.CSSProperties {
  if (!pos) return {};
  const {x, y} = pos.x !== 50 || pos.y !== 50 ? pos : anchorToXY(pos.anchor);
  return {
    position: "absolute" as const,
    left: `${x}%`,
    top: `${y}%`,
    transform: "translate(-50%, -50%)",
  };
}

// ── BRAND ───────────────────────────────────────────────────
const VIOLET = "#D91CD2";
const NEON_BLUE = "#00D4FF";

// ══════════════════════════════════════════════════════════════
// ══  TEXTES PAR OBJECTIF MARKETING                           ══
// ══════════════════════════════════════════════════════════════
// Chaque objectif a ses propres mots-clés "affiches animées"
// qui s'affichent en overlay néon sur les clips vidéo.
// ══════════════════════════════════════════════════════════════

const OBJECTIVE_TEXTS: Record<VideoObjective, string[]> = {
  promotion: [
    "OFFRE SPÉCIALE", "BOOSTE TON ÉNERGIE", "RÉSERVE VITE",
    "PROMO FLASH", "DEAL EXCLUSIF", "PLACES LIMITÉES",
    "DERNIÈRE CHANCE", "TARIF RÉDUIT", "OFFRE LIMITÉE",
    "PACK DÉCOUVERTE", "ESSAYE MAINTENANT", "PRIX CASSÉ",
    "VIENS TESTER", "C'EST MAINTENANT", "NOUVELLE OFFRE",
    "EN CE MOMENT", "RÉSERVE TA PLACE", "OFFRE UNIQUE",
    "PRIX SPÉCIAL", "FONCE !",
  ],
  abonnement: [
    "ESSAI OFFERT", "REJOINS LA TRIBU", "ABONNE-TOI",
    "COURS ILLIMITÉS", "SANS ENGAGEMENT", "1er MOIS OFFERT",
    "ACCÈS VIP", "MEMBRE PREMIUM", "CARTE AFROBOOST",
    "FORFAIT LIBERTÉ", "PASS DÉCOUVERTE", "REJOINS-NOUS",
    "COMMUNAUTÉ AFRO", "TRIBU AFROBOOST", "DEVIENS MEMBRE",
    "ACCÈS TOTAL", "ABONNEMENT FLEX", "ON T'ATTEND",
    "FAMILLE AFROBOOST", "INSCRIS-TOI",
  ],
  motivation: [
    "DISCIPLINE", "DÉPASSE-TOI", "NO EXCUSES", "VIBE UNIQUE",
    "RESTE FOCUS", "ZERO LIMITE", "GRIND MODE",
    "PUSH HARDER", "LÂCHE RIEN", "TU GÈRES",
    "WARRIOR MODE", "NEVER STOP", "PLUS FORT",
    "DONNE TOUT", "MENTAL ACIER", "UNSTOPPABLE",
    "BOSS MINDSET", "CHAQUE JOUR", "AVANCE",
    "FIRE INSIDE",
  ],
  bienfaits: [
    "SANTÉ PHYSIQUE", "MENTAL D'ACIER", "BIEN-ÊTRE TOTAL",
    "CORPS & ESPRIT", "ÉNERGIE VITALE", "POSTURE PARFAITE",
    "SOMMEIL RÉPARÉ", "CONFIANCE EN SOI", "ANTI-STRESS",
    "SOUPLESSE", "ENDURANCE", "DÉTOX MENTALE",
    "RESPIRATION", "EQUILIBRE", "TONUS MUSCULAIRE",
    "JOIE DE VIVRE", "LÂCHER-PRISE", "FORCE INTÉRIEURE",
    "CARDIO SANTÉ", "FEEL GOOD",
  ],
  nutrition: [
    "RÉÉQUILIBRAGE", "ÉNERGIE NATURELLE", "ZÉRO FRUSTRATION",
    "NUTRITION SMART", "REPAS ÉQUILIBRÉ", "FUEL TON CORPS",
    "PROTÉINES POWER", "HYDRATATION", "MEAL PREP",
    "SUPER ALIMENTS", "BOOST NATUREL", "EAT CLEAN",
    "COLLATION SAINE", "VITAMINES", "MACRO FRIENDLY",
    "ZÉRO SUCRE AJOUTÉ", "SMOOTHIE BOOST", "FIBRE & ÉNERGIE",
    "ALIMENTATION SPORT", "BIEN MANGER",
  ],
};

// ── DESCRIPTION STATIQUE POUR L'ÉCRAN DE FIN ────────────────
const AFROBOOST_DESCRIPTION =
  "Afroboost : cardio + danse afrobeat\n+ casques audio immersifs.\nUn entraînement fun, énergétique\net accessible à tous.";

// ── TIMING ──────────────────────────────────────────────────
// Enchaînement "Beat" automatique:
//   [Video + texte overlay] (2-3s) → [Écran noir + texte seul] (1s) → [Video 2]...
// Rythme flash qui capte l'attention.
const BEAT_INTERLUDE_SEC = 1.0; // Durée des cartes texte intercalées
const DEFAULT_CLIP_SEC = 3.0;
const CTA_DURATION_SEC = 5; // Écran de fin
const CHARACTER_INTRO_SEC = 3; // Durée intro photo affiche (si présente)

type SegType = "video" | "text";
type Segment = { type: SegType; start: number; end: number; srcIdx?: number };

function buildTimeline(
  fps: number,
  durationInFrames: number,
  clipDurations?: number[],
  _numVideos?: number,
): Segment[] {
  const segments: Segment[] = [];
  const ctaFrames = Math.round(CTA_DURATION_SEC * fps);
  const ctaFrame = durationInFrames - ctaFrames;
  let cursor = 0;
  let videoIdx = 0;
  const numClips = clipDurations?.length || 1;

  while (cursor < ctaFrame && videoIdx < numClips * 3) {
    // Video segment — durée depuis clipDurations (round-robin)
    const clipDur = clipDurations && clipDurations.length > 0
      ? clipDurations[videoIdx % clipDurations.length]
      : DEFAULT_CLIP_SEC;
    const videoDur = Math.round(clipDur * fps);
    const videoEnd = Math.min(cursor + videoDur, ctaFrame);
    segments.push({ type: "video", start: cursor, end: videoEnd, srcIdx: videoIdx });
    cursor = videoEnd;
    videoIdx++;
    if (cursor >= ctaFrame) break;

    // "Beat" interlude: 1s écran noir avec texte seul
    const beatDur = Math.round(BEAT_INTERLUDE_SEC * fps);
    const beatEnd = Math.min(cursor + beatDur, ctaFrame);
    segments.push({ type: "text", start: cursor, end: beatEnd });
    cursor = beatEnd;
  }
  return segments;
}

// ── CADRAGE: styles visuellement contrastés ──────────────────
type CadrageStyle = {
  scale: number;
  mirror: boolean;
  origin: string;
};

// Cadrage centré sur les personnages — les origins restent proches du centre
// pour ne jamais couper les danseurs/coachs. Petits décalages subtils pour varier.
const CADRAGE_CYCLE: CadrageStyle[] = [
  { scale: 1.0,  mirror: false, origin: "center center" },        // Plan large centré
  { scale: 1.08, mirror: false, origin: "50% 42%" },              // Léger zoom haut (visage)
  { scale: 1.0,  mirror: true,  origin: "center center" },        // Miroir plan large
  { scale: 1.08, mirror: false, origin: "50% 48%" },              // Léger zoom bas (corps)
  { scale: 1.0,  mirror: false, origin: "center center" },        // Plan large
  { scale: 1.1,  mirror: false, origin: "48% 45%" },              // Zoom subtil gauche
  { scale: 1.0,  mirror: true,  origin: "center center" },        // Miroir
  { scale: 1.1,  mirror: false, origin: "52% 45%" },              // Zoom subtil droite
  { scale: 1.0,  mirror: false, origin: "center center" },        // Plan large
  { scale: 1.05, mirror: false, origin: "center 40%" },           // Mini zoom visage
  { scale: 1.0,  mirror: false, origin: "center center" },        // Plan large
  // IMPORTANT: mirror=true DOIT avoir "center" en horizontal
  { scale: 1.05, mirror: true,  origin: "center center" },        // Miroir mini zoom
];

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const x = Math.sin((seed + i * 13) * 127.1 + 311.7) * 43758.5453;
    const r = x - Math.floor(x);
    const j = Math.floor(r * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ══════════════════════════════════════════════════════════════
// ── VIDEO CLIP — enchaînement simple ─────────────────────────
// ══════════════════════════════════════════════════════════════
// Pas d'offset, pas de motion detection. On joue chaque source
// vidéo depuis le début avec un cadrage différent à chaque
// segment pour donner de la variété visuelle.
// ══════════════════════════════════════════════════════════════

const VideoClip: React.FC<{
  src: string;
  segIndex: number;
  cadrage: CadrageStyle;
  segDuration: number;
  isVertical: boolean;
  videoPosition?: ElementPosition;
  startFrom?: number;
  isTemoignage?: boolean;
}> = ({src, segIndex, cadrage, segDuration, isVertical, videoPosition, startFrom, isTemoignage = false}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const progress = segDuration > 0 ? frame / segDuration : 0;
  // Mouvement de caméra plus prononcé pour du dynamisme
  const zoomMotion = interpolate(progress, [0, 1], [0, 0.03], {extrapolateRight: "clamp"});
  const zoom = cadrage.scale + zoomMotion;

  // Si position custom, on surcharge le transformOrigin
  const hasCustomVideoPos = videoPosition && (videoPosition.x !== 50 || videoPosition.y !== 50 || videoPosition.anchor !== "center");
  // SÉCURITÉ: mirror=true → forcer l'origin horizontal à "center"
  // sinon scaleX négatif pousse le contenu hors cadre
  let safeOrigin = hasCustomVideoPos
    ? `${videoPosition!.x}% ${videoPosition!.y}%`
    : cadrage.origin;
  if (cadrage.mirror && !hasCustomVideoPos) {
    // Extraire la partie verticale et forcer "center" en horizontal
    const parts = cadrage.origin.split(/\s+/);
    const vertPart = parts.length > 1 ? parts[1] : "center";
    safeOrigin = `center ${vertPart}`;
  }

  return (
    <AbsoluteFill style={{backgroundColor: "#000000", overflow: "hidden"}}>
      <div style={{
        position: "absolute",
        top: 0, left: 0, width: "100%", height: "100%",
        transform: `${cadrage.mirror ? "scaleX(-1) " : ""}scale(${zoom})`,
        transformOrigin: safeOrigin,
      }}>
        <OffthreadVideo
          src={src}
          volume={isTemoignage ? 0.85 : 0}
          startFrom={startFrom ? Math.round(startFrom * fps) : 0}
          style={{
            width: "100%", height: "100%",
            objectFit: "cover",
          }}
        />
      </div>

      {/* Dégradé violet signature — STABLE */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        height: isVertical ? 320 : 200,
        background: "linear-gradient(to top, rgba(100,0,140,0.55) 0%, rgba(140,20,180,0.25) 35%, rgba(180,40,220,0.08) 65%, transparent 100%)",
        pointerEvents: "none",
      }} />

      {/* afroboost.com — STABLE */}
      <div style={{
        position: "absolute", bottom: isVertical ? 55 : 35,
        left: 0, right: 0, textAlign: "center" as const,
      }}>
        <span style={{
          fontSize: isVertical ? 22 : 17, fontWeight: 800,
          color: "#FFFFFF", letterSpacing: 4,
          textTransform: "lowercase" as const,
          textShadow: "0 0 16px rgba(217,28,210,0.6), 0 2px 8px rgba(0,0,0,0.5)",
        }}>afroboost.com</span>
      </div>
    </AbsoluteFill>
  );
};

// ══════════════════════════════════════════════════════════════
// ── IMAGE CLIP — affiche une image statique avec cadrage ─────
// ══════════════════════════════════════════════════════════════

const ImageClip: React.FC<{
  src: string;
  segIndex: number;
  cadrage: CadrageStyle;
  segDuration: number;
  isVertical: boolean;
  videoPosition?: ElementPosition;
}> = ({src, segIndex, cadrage, segDuration, isVertical, videoPosition}) => {
  const frame = useCurrentFrame();
  const progress = segDuration > 0 ? frame / segDuration : 0;

  // ── Ken Burns très doux ──
  const zoomOut = segIndex % 2 === 1;
  const finalZoom = zoomOut
    ? interpolate(progress, [0, 1], [1.04, 1.0], {extrapolateRight: "clamp"})
    : interpolate(progress, [0, 1], [1.0, 1.04], {extrapolateRight: "clamp"});

  return (
    <AbsoluteFill style={{backgroundColor: "#000000", overflow: "hidden"}}>
      {/* Image — objectFit "cover" pour remplir le cadre 9:16 comme dans l'aperçu */}
      <Img
        src={src}
        style={{
          position: "absolute",
          top: 0, left: 0,
          width: "100%", height: "100%",
          objectFit: "cover",
          transform: `${cadrage.mirror ? "scaleX(-1) " : ""}scale(${finalZoom})`,
          transformOrigin: "center center",
        }}
      />

      {/* Dégradé violet signature */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        height: isVertical ? 320 : 200,
        background: "linear-gradient(to top, rgba(100,0,140,0.55) 0%, rgba(140,20,180,0.25) 35%, rgba(180,40,220,0.08) 65%, transparent 100%)",
        pointerEvents: "none",
      }} />

      {/* afroboost.com */}
      <div style={{
        position: "absolute", bottom: isVertical ? 55 : 35,
        left: 0, right: 0, textAlign: "center" as const,
      }}>
        <span style={{
          fontSize: isVertical ? 22 : 17, fontWeight: 800,
          color: "#FFFFFF", letterSpacing: 4,
          textTransform: "lowercase" as const,
          textShadow: "0 0 16px rgba(217,28,210,0.6), 0 2px 8px rgba(0,0,0,0.5)",
        }}>afroboost.com</span>
      </div>
    </AbsoluteFill>
  );
};

// ══════════════════════════════════════════════════════════════
// ── TEXT CARD — NÉON GLOW sur fond noir ─────────────────────
// ══════════════════════════════════════════════════════════════
// Chaque texte d'objectif s'affiche avec un effet "glow" néon
// violet/cyan qui pulse et ressort sur le fond noir.
// ══════════════════════════════════════════════════════════════

const NeonTextCard: React.FC<{
  word: string;
  segDuration: number;
  isVertical: boolean;
  textPosition?: ElementPosition;
}> = ({word, segDuration, isVertical, textPosition}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const isLongText = word.length > 10;
  const keywordSize = isVertical
    ? (isLongText ? 60 : 100)
    : (isLongText ? 50 : 80);

  const sp = spring({
    fps, frame: Math.max(0, frame),
    config: {damping: 7, stiffness: 300, mass: 0.35},
  });
  const scale = interpolate(sp, [0, 0.5, 0.85, 1], [0.2, 1.25, 1.02, 1], {
    extrapolateRight: "clamp",
  });
  const fadeIn = interpolate(frame, [0, 2], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [segDuration - 3, segDuration], [1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });

  // Glow pulse
  const glowIntensity = 0.6 + Math.sin(frame * 0.3) * 0.2;

  // Position dynamique ou centré par défaut
  const hasCustomPos = textPosition && (textPosition.x !== 50 || textPosition.y !== 50 || textPosition.anchor !== "center");
  const posStyle = hasCustomPos ? positionToStyle(textPosition) : {};

  return (
    <AbsoluteFill style={{
      backgroundColor: "#000000",
      display: hasCustomPos ? "block" : "flex",
      justifyContent: hasCustomPos ? undefined : "center",
      alignItems: hasCustomPos ? undefined : "center",
    }}>
      <div style={{
        ...posStyle,
        opacity: Math.min(fadeIn, fadeOut),
        transform: `${posStyle.transform || ""} scale(${scale})`.trim(),
        fontSize: keywordSize, lineHeight: 1.15, fontWeight: 900,
        letterSpacing: 6,
        textTransform: "uppercase" as const, textAlign: "center" as const,
        color: "#FFFFFF",
        textShadow: [
          `0 0 10px rgba(217,28,210,${glowIntensity})`,
          `0 0 30px rgba(217,28,210,${glowIntensity * 0.7})`,
          `0 0 60px rgba(217,28,210,${glowIntensity * 0.4})`,
          `0 0 90px rgba(0,212,255,${glowIntensity * 0.25})`,
          `0 0 120px rgba(217,28,210,${glowIntensity * 0.15})`,
        ].join(", "),
        padding: "0 40px",
      }}>
        {word}
      </div>
    </AbsoluteFill>
  );
};

// ══════════════════════════════════════════════════════════════
// ── MAIN COMPOSITION ────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
export const AfroboostComposition: React.FC<AfroboostProps> = ({
  titleText,
  subtitleText,
  backgroundVideo,
  backgroundVideos,
  backgroundAudio,
  videoMode = "cardio",
  objective = "promotion",
  renderSeed,
  textPosition,
  videoPosition,
  clipDurations,
  startTimes,
  isImageFlags,
  logoUrl,
  voiceOverAudio,
  characterImage,
  textItems,
}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames, width, height} = useVideoConfig();
  const isVertical = height > width;
  const isTemoignage = videoMode === "temoignage";

  // ─── VIDEO SOURCES ──────────────────────────────────────────
  const videoSources: string[] = [];
  if (backgroundVideos && backgroundVideos.length > 0) {
    videoSources.push(...backgroundVideos);
  } else if (backgroundVideo) {
    videoSources.push(backgroundVideo);
  }
  const hasVideo = videoSources.length > 0;
  const numVideos = videoSources.length;

  const audioSrc = backgroundAudio || undefined;

  // ─── INTRO CHARACTER IMAGE ─────────────────────────────────
  const hasCharIntro = !!characterImage;
  const introFrames = hasCharIntro ? Math.round(CHARACTER_INTRO_SEC * fps) : 0;

  // ─── OBJECTIVE TEXTS ─────────────────────────────────────────
  const objectiveTexts = OBJECTIVE_TEXTS[objective] || OBJECTIVE_TEXTS.promotion;

  // ─── TIMELINE (offset by intro frames) ─────────────────────
  // Build timeline for the montage portion (after intro, before CTA)
  const montageFrames = durationInFrames - introFrames;
  const rawTimeline = buildTimeline(fps, montageFrames, clipDurations, numVideos);
  // Offset all segments by introFrames so they start after the intro
  const timeline = rawTimeline.map(seg => ({...seg, start: seg.start + introFrames, end: seg.end + introFrames}));
  const ctaStartFrame = introFrames + (montageFrames - Math.round(CTA_DURATION_SEC * fps));
  const isIntro = frame < introFrames;
  const isCTA = frame >= ctaStartFrame;

  const videoSegs = timeline.filter((s) => s.type === "video");
  const textSegs = timeline.filter((s) => s.type === "text");

  const seed = renderSeed || 12345;

  // ─── SIMPLE VIDEO ASSIGNMENT ──────────────────────────────
  // Round-robin basé sur l'index de segment timeline.
  // Chaque source est jouée depuis le début. Le cadrage change
  // pour donner de la variété visuelle.
  // ─────────────────────────────────────────────────────────────
  const videoAssignments: {src: string; srcIdx: number}[] = videoSegs.map((seg) => {
    const srcIdx = numVideos > 0 ? (seg.srcIdx ?? 0) % numVideos : 0;
    return {src: videoSources[srcIdx] || "", srcIdx};
  });

  // Cadrage rotation basée sur le seed
  const cadrageRot = Math.abs(
    Math.floor(Math.sin((seed + 777) * 63.7 + 157.3) * 21879.2)
  ) % CADRAGE_CYCLE.length;

  // Textes d'objectif — shuffle complet sans répétition
  // On épuise les 20 phrases avant de recycler un nouveau cycle shufflé
  const shuffledTexts: string[] = [];
  const totalNeeded = textSegs.length;
  let cycle = 0;
  while (shuffledTexts.length < totalNeeded) {
    const batch = seededShuffle(objectiveTexts, seed + 500 + cycle * 31);
    // Éviter que la dernière phrase du cycle précédent = la première du suivant
    if (shuffledTexts.length > 0 && batch[0] === shuffledTexts[shuffledTexts.length - 1]) {
      const swap = Math.min(1, batch.length - 1);
      [batch[0], batch[swap]] = [batch[swap], batch[0]];
    }
    shuffledTexts.push(...batch);
    cycle++;
  }

  // ─── AUDIO ────────────────────────────────────────────────
  const FADE_OUT_SEC = 3;
  const fadeStart = durationInFrames - FADE_OUT_SEC * fps;
  const MUSIC_VOL = isTemoignage ? 0.15 : 0.85;

  const musicVolume = interpolate(frame, [fadeStart, durationInFrames], [MUSIC_VOL, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });

  const globalFade = interpolate(
    frame, [durationInFrames - fps, durationInFrames], [1, 0],
    {extrapolateLeft: "clamp", extrapolateRight: "clamp"},
  );

  const progress = (frame / durationInFrames) * 100;

  // ─── INTRO FADE ────────────────────────────────────────────
  const introFadeIn = interpolate(frame, [0, Math.round(fps * 0.4)], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const introFadeOut = interpolate(frame, [introFrames - Math.round(fps * 0.3), introFrames], [1, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});

  // ═══════════════════════════════════════════════════════════
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#000000",
        overflow: "hidden",
        fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
      }}
    >
      {audioSrc ? <Audio src={audioSrc} volume={voiceOverAudio ? 0.3 : musicVolume} /> : null}
      {voiceOverAudio ? <Audio src={voiceOverAudio} volume={0.9} /> : null}

      {/* ══════════════════════════════════════════════════════
          ── INTRO PHOTO AFFICHE (plein écran, 3s) ────────────
          ══════════════════════════════════════════════════════ */}
      {hasCharIntro && characterImage && (
        <Sequence from={0} durationInFrames={introFrames}>
          <AbsoluteFill style={{backgroundColor: "#000", overflow: "hidden"}}>
            {/* Image plein écran 9:16 */}
            <Img
              src={characterImage}
              style={{
                position: "absolute",
                top: 0, left: 0,
                width: "100%", height: "100%",
                objectFit: "cover",
                objectPosition: "top center",
                opacity: introFadeIn * introFadeOut,
                transform: `scale(${interpolate(frame, [0, introFrames], [1.05, 1.0], {extrapolateLeft: "clamp", extrapolateRight: "clamp"})})`,
              }}
            />
            {/* Dégradé bas pour le titre */}
            <div style={{
              position: "absolute", bottom: 0, left: 0, right: 0,
              height: isVertical ? 400 : 250,
              background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 50%, transparent 100%)",
              pointerEvents: "none",
              opacity: introFadeIn,
            }} />
            {/* Titre sur la photo */}
            <div style={{
              position: "absolute", bottom: isVertical ? 120 : 80, left: 0, right: 0,
              display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
              opacity: introFadeIn,
              transform: `translateY(${interpolate(frame, [Math.round(fps * 0.2), Math.round(fps * 0.6)], [20, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp"})}px)`,
            }}>
              <div style={{
                fontSize: isVertical ? 48 : 40, fontWeight: 900, letterSpacing: 4,
                color: "#FFF", textAlign: "center" as const, textTransform: "uppercase" as const,
                textShadow: `0 0 20px rgba(217,28,210,0.6), 0 2px 12px rgba(0,0,0,0.8)`,
                padding: "0 32px", maxWidth: "90%",
              }}>{titleText}</div>
              {subtitleText && (
                <div style={{
                  fontSize: isVertical ? 22 : 18, fontWeight: 600, letterSpacing: 3,
                  color: VIOLET, textAlign: "center" as const, textTransform: "uppercase" as const,
                  textShadow: `0 0 12px rgba(217,28,210,0.5)`,
                }}>{subtitleText}</div>
              )}
            </div>
            {/* afroboost.com en bas */}
            <div style={{
              position: "absolute", bottom: isVertical ? 50 : 30, left: 0, right: 0,
              textAlign: "center" as const, opacity: introFadeIn * 0.7,
            }}>
              <span style={{
                fontSize: isVertical ? 16 : 13, fontWeight: 700, color: "#FFF",
                letterSpacing: 3, textTransform: "lowercase" as const,
                textShadow: "0 0 10px rgba(217,28,210,0.4)",
              }}>afroboost.com</span>
            </div>
          </AbsoluteFill>
        </Sequence>
      )}

      {/* ══════════════════════════════════════════════════════
          ── ÉCRAN DE FIN (CTA) ───────────────────────────────
          afroboost.com + descriptif permanent + CTA
          ══════════════════════════════════════════════════════ */}
      {!isIntro && isCTA && !isTemoignage ? (
        <AbsoluteFill style={{opacity: globalFade}}>
          <div style={{
            position: "absolute", inset: 0,
            background: "linear-gradient(180deg, #000000 0%, #050008 35%, #0a0015 70%, #120020 100%)",
          }} />
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", flexDirection: "column",
            justifyContent: "center", alignItems: "center",
            gap: isVertical ? 36 : 28,
            padding: isVertical ? "60px 40px" : "40px 80px",
          }}>
            {/* ── LOGO AFROBOOST ── */}
            {(() => {
              const t = frame - ctaStartFrame;
              const logoSp = spring({fps, frame: Math.max(0, t), config: {damping: 14, stiffness: 160, mass: 0.6}});
              const logoStyle: React.CSSProperties = {
                opacity: interpolate(logoSp, [0, 1], [0, 1]),
                transform: `scale(${interpolate(logoSp, [0, 1], [0.3, 1])}) translateY(${interpolate(logoSp, [0, 1], [20, 0])}px)`,
                display: "flex", flexDirection: "column", alignItems: "center",
              };

              // ── Logo PNG importé par l'utilisateur ──
              if (logoUrl) {
                return (
                  <div style={logoStyle}>
                    <Img
                      src={logoUrl}
                      style={{
                        width: isVertical ? 400 : 320,
                        height: "auto",
                        objectFit: "contain",
                        filter: "drop-shadow(0 0 20px rgba(217,28,210,0.4)) drop-shadow(0 0 40px rgba(217,28,210,0.2))",
                      }}
                    />
                  </div>
                );
              }

              // ── Pas de logo → rien (l'utilisateur doit importer son logo) ──
              return null;
            })()}

            {/* afroboost.com — titre principal */}
            {(() => {
              const t = frame - ctaStartFrame;
              const sp = spring({fps, frame: Math.max(0, t - 4), config: {damping: 10, stiffness: 140, mass: 0.8}});
              return (
                <div style={{
                  opacity: interpolate(sp, [0, 1], [0, 1]),
                  transform: `scale(${interpolate(sp, [0, 1], [0.5, 1])})`,
                  fontSize: isVertical ? 52 : 42,
                  fontWeight: 900, letterSpacing: 6, color: "#FFF",
                  textAlign: "center" as const,
                  textShadow: "0 0 40px rgba(217,28,210,0.5), 0 0 80px rgba(217,28,210,0.3)",
                  textTransform: "lowercase" as const,
                }}>afroboost.com</div>
              );
            })()}

            {/* ── DESCRIPTIF PERMANENT ── */}
            {(() => {
              const t = frame - ctaStartFrame;
              const d = Math.max(0, t - Math.round(fps * 0.3));
              const descOp = interpolate(d, [0, 20], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
              return (
                <div style={{
                  opacity: descOp,
                  maxWidth: isVertical ? width * 0.85 : 700,
                  textAlign: "center" as const,
                }}>
                  {AFROBOOST_DESCRIPTION.split("\n").map((line, i) => (
                    <div key={i} style={{
                      fontSize: isVertical ? 22 : 18,
                      fontWeight: 500,
                      color: "#FFFFFF",
                      lineHeight: 1.6,
                      letterSpacing: 1,
                    }}>{line}</div>
                  ))}
                </div>
              );
            })()}

            {/* CTA Button */}
            {(() => {
              const t = frame - ctaStartFrame;
              const d = Math.max(0, t - Math.round(fps * 0.8));
              const sp = spring({fps, frame: d, config: {damping: 12, stiffness: 120, mass: 0.8}});
              const pulsePhase = Math.max(0, t - Math.round(fps * 1.5));
              const pulse = pulsePhase > 0 ? 1 + Math.sin(pulsePhase * 0.18) * 0.04 : 1;
              const glow = pulsePhase > 0 ? 0.4 + Math.sin(pulsePhase * 0.18) * 0.3 : 0.2;
              return (
                <div style={{
                  opacity: interpolate(sp, [0, 1], [0, 1]),
                  transform: `scale(${interpolate(sp, [0, 1], [0.7, 1]) * pulse})`,
                }}>
                  <div style={{
                    padding: isVertical ? "22px 48px" : "18px 40px",
                    border: `2px solid ${VIOLET}`, borderRadius: 10,
                    background: `rgba(217,28,210,${0.08 + glow * 0.15})`,
                    boxShadow: `0 0 ${20 + glow * 40}px rgba(217,28,210,${glow}), inset 0 0 20px rgba(217,28,210,0.05)`,
                  }}>
                    <div style={{
                      fontSize: isVertical ? 28 : 24, fontWeight: 900,
                      color: "#FFF", letterSpacing: 4,
                      textTransform: "uppercase" as const, textAlign: "center" as const,
                      textShadow: `0 0 12px rgba(217,28,210,${glow})`,
                    }}>CHAT POUR PLUS D'INFOS</div>
                  </div>
                </div>
              );
            })()}

            {/* LIEN EN BIO */}
            {(() => {
              const t = frame - ctaStartFrame;
              const d = Math.max(0, t - Math.round(fps * 1.2));
              const op = interpolate(d, [0, 15], [0, 0.55], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
              return (
                <div style={{
                  opacity: op, fontSize: isVertical ? 20 : 17, fontWeight: 600,
                  color: "rgba(255,255,255,0.45)", letterSpacing: 5,
                  textTransform: "uppercase" as const, textAlign: "center" as const,
                }}>LIEN EN BIO</div>
              );
            })()}
          </div>

          {/* Gradient bottom */}
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0,
            height: isVertical ? 200 : 140,
            background: "linear-gradient(to top, rgba(140,20,180,0.5) 0%, rgba(100,10,140,0.25) 40%, transparent 100%)",
            pointerEvents: "none",
          }} />
        </AbsoluteFill>
      ) : null}

      {/* ══════════════════════════════════════════════════════
          ── MONTAGE — vidéos + textes d'objectif intercalés ──
          Enchaînement simple : round-robin sur les sources.
          ══════════════════════════════════════════════════════ */}
      {!isIntro && !isCTA && !isTemoignage ? (
        <AbsoluteFill style={{opacity: globalFade}}>
          <AbsoluteFill style={{backgroundColor: "#000"}} />

          {timeline.map((seg, idx) => {
            const segDur = seg.end - seg.start;

            if (seg.type === "video" && hasVideo) {
              const vIdx = videoSegs.indexOf(seg);
              if (vIdx < 0) return null;
              const assignment = videoAssignments[vIdx];
              if (!assignment || !assignment.src) return null;
              const cadrage = CADRAGE_CYCLE[(vIdx + cadrageRot) % CADRAGE_CYCLE.length];

              // startFrom en secondes pour ce clip source
              const clipStartTime = startTimes && startTimes.length > assignment.srcIdx
                ? startTimes[assignment.srcIdx]
                : 0;

              // Check if this source is an image
              const srcIsImage = isImageFlags && isImageFlags.length > assignment.srcIdx
                ? isImageFlags[assignment.srcIdx]
                : false;

              return (
                <Sequence
                  key={`v-${idx}`}
                  from={seg.start}
                  durationInFrames={segDur}
                >
                  {srcIsImage ? (
                    <ImageClip
                      src={assignment.src}
                      segIndex={vIdx}
                      cadrage={cadrage}
                      segDuration={segDur}
                      isVertical={isVertical}
                      videoPosition={videoPosition}
                    />
                  ) : (
                    <VideoClip
                      src={assignment.src}
                      segIndex={vIdx}
                      cadrage={cadrage}
                      segDuration={segDur}
                      isVertical={isVertical}
                      videoPosition={videoPosition}
                      startFrom={clipStartTime}
                      isTemoignage={isTemoignage}
                    />
                  )}
                </Sequence>
              );
            }

            if (seg.type === "text") {
              const tIdx = textSegs.indexOf(seg);
              if (tIdx < 0) return null;
              // Use custom textItems from timeline if available, otherwise fall back to shuffled objective texts
              const word = (textItems && textItems.length > 0 && tIdx < textItems.length)
                ? textItems[tIdx].text
                : (shuffledTexts[tIdx] || objectiveTexts[0]);
              return (
                <Sequence key={`t-${idx}-${tIdx}`} from={seg.start} durationInFrames={segDur}>
                  <NeonTextCard word={word} segDuration={segDur} isVertical={isVertical} textPosition={textPosition} />
                </Sequence>
              );
            }

            return null;
          })}

          {!hasVideo && (
            <AbsoluteFill style={{
              backgroundColor: "#000000",
              display: "flex", justifyContent: "center", alignItems: "center",
            }}>
              <div style={{
                fontSize: isVertical ? 60 : 50, fontWeight: 900,
                color: "rgba(255,255,255,0.06)", letterSpacing: 10,
                textTransform: "uppercase" as const,
              }}>AFROBOOST</div>
            </AbsoluteFill>
          )}
        </AbsoluteFill>
      ) : null}

      {/* ── TÉMOIGNAGE ── */}
      {isTemoignage ? (
        <AbsoluteFill style={{opacity: globalFade}}>
          {hasVideo ? (
            <OffthreadVideo
              src={videoSources[0]}
              volume={interpolate(frame, [fadeStart, durationInFrames], [1.0, 0], {
                extrapolateLeft: "clamp", extrapolateRight: "clamp",
              })}
              style={{width: "100%", height: "100%", objectFit: "cover"}}
            />
          ) : (
            <div style={{position: "absolute", inset: 0, backgroundColor: "#000000"}} />
          )}
          {/* Titre + sous-titre — masqué si titleText vide (mode Agent) */}
          {titleText ? (
          <div style={{
            position: "absolute", bottom: isVertical ? 140 : 80, left: 0, right: 0,
            display: "flex", flexDirection: "column", alignItems: "center",
            padding: isVertical ? "0 48px" : "0 80px",
            opacity: interpolate(frame, [10, 40], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"}),
          }}>
            <div style={{
              position: "absolute", bottom: -40, left: 0, right: 0,
              height: isVertical ? 280 : 220,
              background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.6) 50%, transparent 100%)",
              pointerEvents: "none",
            }} />
            <div style={{
              fontSize: isVertical ? 44 : 38, lineHeight: 1.3, fontWeight: 700,
              color: "#FFF", letterSpacing: 2, textTransform: "uppercase" as const,
              textAlign: "center" as const, maxWidth: isVertical ? width * 0.85 : 900,
              textShadow: "0 2px 20px rgba(0,0,0,0.8)", zIndex: 1,
            }}>{titleText}</div>
            {subtitleText ? (
              <div style={{marginTop: 12, zIndex: 1}}>
                <div style={{
                  fontSize: isVertical ? 28 : 24, fontWeight: 600, color: VIOLET,
                  letterSpacing: 4, textTransform: "uppercase" as const,
                  textShadow: `0 0 16px rgba(217,28,210,0.8), 0 0 40px rgba(217,28,210,0.4)`,
                  textAlign: "center" as const,
                }}>{subtitleText}</div>
              </div>
            ) : null}
            <div style={{
              marginTop: 16, width: 60, height: 2,
              background: `linear-gradient(90deg, transparent, ${VIOLET}, transparent)`,
              zIndex: 1,
            }} />
          </div>
          ) : null}
        </AbsoluteFill>
      ) : null}

      {/* Character image now rendered as intro sequence above — no overlay needed */}

      {/* ── VIOLET BORDER GLOW — cadre lumineux signature ── */}
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
        height: isTemoignage ? 3 : 4,
        backgroundColor: "rgba(255,255,255,0.08)", zIndex: 5,
      }}>
        <div style={{
          height: "100%", width: `${progress}%`,
          background: `linear-gradient(90deg, ${NEON_BLUE}, ${VIOLET})`,
          boxShadow: "0 0 8px rgba(217,28,210,0.6)",
        }} />
      </div>
    </AbsoluteFill>
  );
};
