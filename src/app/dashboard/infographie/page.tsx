"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  Upload,
  Zap,
  Loader2,
  RefreshCw,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  Image as ImageIcon,
  Edit3,
  Check,
  Search,
  Video,
  AlertTriangle,
} from "lucide-react";
import { PlatformIcon, type PlatformKey } from "@/components/ui/PlatformIcon";
import {
  DesignOption,
  FONT_OPTIONS,
  FILTER_OPTIONS,
  CARD_STYLE_OPTIONS,
} from "@/components/ui/DesignOption";
import {
  PLATFORM_SAFE_ZONES,
  type SafeZoneArea,
} from "@/lib/constants/platforms";
import FloatingPanel from "@/components/ui/FloatingPanel";
import ColorWheel from "@/components/ui/ColorWheel";
import { composeAndUpload, downloadBlob } from "@/lib/video-composer";

// ── Types ──────────────────────────────────────────────────────
interface InfoCard {
  id: string;
  emoji: string;
  label: string;
  value: string;
  description: string;
  color: string;
}

interface PexelsPhoto {
  id: number;
  url: string;
  medium: string;
  small: string;
  photographer: string;
  alt: string;
}

type Format = "9:16" | "16:9";
type Destination = "draft" | "export" | "both" | "audio-studio";

// ── Content Themes ─────────────────────────────────────────────
const CONTENT_THEMES = [
  {
    id: "sommeil-sport",
    label: "Sommeil & Sport",
    emoji: "😴",
    pexelsQuery: "sleep fitness recovery rest",
    color: "from-indigo-600 to-blue-500",
  },
  {
    id: "nutrition-danse",
    label: "Nutrition & Danse",
    emoji: "🍎",
    pexelsQuery: "healthy food dance nutrition",
    color: "from-green-600 to-emerald-400",
  },
  {
    id: "energie-cardio",
    label: "Énergie & Cardio",
    emoji: "⚡",
    pexelsQuery: "cardio energy workout running",
    color: "from-orange-500 to-yellow-400",
  },
  {
    id: "stress-mental",
    label: "Stress & Mental",
    emoji: "🧠",
    pexelsQuery: "meditation mental health yoga calm",
    color: "from-purple-600 to-pink-400",
  },
  {
    id: "communaute",
    label: "Communauté",
    emoji: "👥",
    pexelsQuery: "group fitness community dance class",
    color: "from-pink-600 to-rose-400",
  },
  {
    id: "personnalise",
    label: "Personnalisé",
    emoji: "✨",
    pexelsQuery: "",
    color: "from-gray-600 to-gray-400",
  },
];

// ── Color Themes ───────────────────────────────────────────────
const COLOR_THEMES = [
  {
    id: "pink",
    name: "Rose",
    bg: "from-pink-600 to-pink-400",
    accent: "#ec4899",
  },
  {
    id: "purple",
    name: "Violet",
    bg: "from-purple-600 to-purple-400",
    accent: "#a855f7",
  },
  {
    id: "blue",
    name: "Bleu",
    bg: "from-blue-600 to-blue-400",
    accent: "#3b82f6",
  },
  {
    id: "green",
    name: "Vert",
    bg: "from-green-600 to-green-400",
    accent: "#10b981",
  },
  {
    id: "orange",
    name: "Orange",
    bg: "from-orange-500 to-yellow-400",
    accent: "#f59e0b",
  },
  {
    id: "red",
    name: "Rouge",
    bg: "from-red-600 to-rose-400",
    accent: "#ef4444",
  },
];

const EMOJIS = [
  "💪",
  "❤️",
  "⚡",
  "🔥",
  "🎯",
  "📊",
  "🏃",
  "🧠",
  "💨",
  "🌟",
  "😴",
  "🍎",
  "💧",
  "🛡️",
  "🏆",
  "👥",
  "🌿",
  "📈",
  "✨",
  "🦴",
];

// Map icon names from smart-content.ts to actual emoji characters
const ICON_TO_EMOJI: Record<string, string> = {
  droplet: "💧",
  brain: "🧠",
  fire: "🔥",
  shield: "🛡️",
  energy: "⚡",
  thermometer: "🌡️",
  muscle: "💪",
  apple: "🍎",
  heart: "❤️",
  moon: "😴",
  sun: "☀️",
  chart: "📈",
  audio: "🎵",
  leaf: "🌿",
  star: "⭐",
  clock: "⏰",
  bone: "🦴",
  eye: "👁️",
  running: "🏃",
  target: "🎯",
  vitamin: "💊",
  dna: "🧬",
  scale: "⚖️",
  food: "🍽️",
  water: "💧",
};

export default function InfographicPage() {
  const router = useRouter();

  // ── Step wizard ─────────────────────────────────────────────
  const [step, setStep] = useState(0); // 0: Theme & Content, 1: Personnalisation, 2: Export

  // ── Step 0: Theme & Content ─────────────────────────────────
  const [contentTheme, setContentTheme] = useState("sommeil-sport");
  const [customTopic, setCustomTopic] = useState("");
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [cards, setCards] = useState<InfoCard[]>([]);
  const [salesPhrases, setSalesPhrases] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");

  // ── Step 1: Personnalisation ────────────────────────────────
  const [colorTheme, setColorTheme] = useState("purple");
  const [customAccent, setCustomAccent] = useState("#a855f7");
  const [format, setFormat] = useState<Format>("9:16");
  const [batchCount, setBatchCount] = useState(1);
  const [characterImage, setCharacterImage] = useState<string | null>(null);

  // ── Logo Upload ────────────────────────────────────────────
  const [logoImage, setLogoImage] = useState<string | null>(null);
  const [logoScale, setLogoScale] = useState(1.0); // 0.3 to 3.0
  const [logoSequences, setLogoSequences] = useState<string[]>([
    "titre",
    "cta",
  ]); // which sequences show logo
  const [titleColor, setTitleColor] = useState("#ffffff");
  const [ctaColor, setCtaColor] = useState("#ffffff");
  // CTA text (customizable)
  const [ctaMainText, setCtaMainText] = useState("AFROBOOST");
  const [ctaSubText, setCtaSubText] = useState("CHAT POUR PLUS D'INFOS");
  const [isGeneratingCta, setIsGeneratingCta] = useState(false);
  // Gradient overlay
  const [gradientColor1, setGradientColor1] = useState("#7C3AED");
  const [gradientColor2, setGradientColor2] = useState("#EC4899");
  const [gradientOpacity, setGradientOpacity] = useState(0.3);
  // Per-sequence no-color mode (user decides which sequences have color or just photo)
  const [noColorBg, setNoColorBg] = useState(false);
  const [noColorSequences, setNoColorSequences] = useState<string[]>([]); // sequences where color is disabled

  // Per-sequence gradient settings: each sequence can override the global gradient
  // Keys: "titre" | "cartes" | "video" | "cta"
  // Values: { enabled?: boolean, color1?: string, color2?: string, opacity?: number, position?: 'top' | 'bottom' | 'both' | 'left' | 'right' }
  const [seqGradients, setSeqGradients] = useState<Record<string, {
    enabled?: boolean;
    color1?: string;
    color2?: string;
    opacity?: number;
    position?: 'top' | 'bottom' | 'both' | 'left' | 'right';
  }>>({});

  // Helper function to get effective gradient for a sequence
  const getSeqGradient = useCallback((seq: string) => {
    const override = seqGradients[seq];
    // Video sequence: gradient disabled by default unless user explicitly enables it
    const defaultEnabled = seq === 'video' ? false : true;
    return {
      enabled: override?.enabled ?? defaultEnabled,
      color1: override?.color1 || gradientColor1,
      color2: override?.color2 || gradientColor2,
      opacity: override?.opacity ?? gradientOpacity,
      position: override?.position || 'both',
    };
  }, [seqGradients, gradientColor1, gradientColor2, gradientOpacity]);

  // ── Video Upload ────────────────────────────────────────────
  const [rushUrl, setRushUrl] = useState<string | null>(null);
  const [rushFileName, setRushFileName] = useState<string | null>(null);
  const [isUploadingVideo, setIsUploadingVideo] = useState(false);

  // ── Video Overlay Text ─────────────────────────────────────
  const [videoOverlayText, setVideoOverlayText] = useState("");
  const [isGeneratingOverlay, setIsGeneratingOverlay] = useState(false);

  // ── Pexels Photos ───────────────────────────────────────────
  const [pexelsPhotos, setPexelsPhotos] = useState<PexelsPhoto[]>([]);
  const [pexelsLoading, setPexelsLoading] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [photoSearchQuery, setPhotoSearchQuery] = useState("");

  // ── Sequence Durations ──────────────────────────────────────
  const [introDuration, setIntroDuration] = useState(4);
  const [cardsDuration, setCardsDuration] = useState(6);
  const [videoDuration, setVideoDuration] = useState(12);
  const [ctaDuration, setCtaDuration] = useState(4);

  // ── Typography controls (per-element) — declared early for localStorage ──
  const [titleLetterSpacing, setTitleLetterSpacing] = useState(0);
  const [titleLineHeight, setTitleLineHeight] = useState(1.1);
  const [titleBold, setTitleBold] = useState(true);
  const [titleItalic, setTitleItalic] = useState(false);
  const [ctaLetterSpacing, setCtaLetterSpacing] = useState(2);
  const [ctaLineHeight, setCtaLineHeight] = useState(1.2);
  const [ctaBold, setCtaBold] = useState(true);
  const [ctaItalic, setCtaItalic] = useState(false);
  const [overlayLetterSpacing, setOverlayLetterSpacing] = useState(0);
  const [overlayLineHeight, setOverlayLineHeight] = useState(1.2);
  const [overlayBold, setOverlayBold] = useState(true);
  const [overlayItalic, setOverlayItalic] = useState(false);
  const [cardsLetterSpacing, setCardsLetterSpacing] = useState(0);
  const [customCardIcons, setCustomCardIcons] = useState<Record<string, string>>({});

  // Advanced text effects
  const [titleTextGradient, setTitleTextGradient] = useState(false);
  const [titleGradColor1, setTitleGradColor1] = useState("#FFD700");
  const [titleGradColor2, setTitleGradColor2] = useState("#FF6B6B");
  const [titleDuplicate, setTitleDuplicate] = useState(false);
  const [titleDuplicateOffset, setTitleDuplicateOffset] = useState(5);
  const [titleDuplicateOpacity, setTitleDuplicateOpacity] = useState(0.3);

  // ── Persist configurations across sessions ──────────────────
  const INFOGRAPHIC_CONFIG_KEY = "studiio_infographic_config";
  const [configLoaded, setConfigLoaded] = useState(false);
  const restoringFromStorage = useRef(true); // Skip auto-generate during initial localStorage restore

  // Load saved config on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(INFOGRAPHIC_CONFIG_KEY);
      if (saved) {
        const cfg = JSON.parse(saved);
        if (cfg.colorTheme) setColorTheme(cfg.colorTheme);
        if (cfg.format) setFormat(cfg.format);
        if (cfg.introDuration) setIntroDuration(cfg.introDuration);
        if (cfg.cardsDuration) setCardsDuration(cfg.cardsDuration);
        if (cfg.videoDuration) setVideoDuration(cfg.videoDuration);
        if (cfg.ctaDuration) setCtaDuration(cfg.ctaDuration);
        if (cfg.rushUrl) {
          setRushUrl(cfg.rushUrl);
          setRushFileName(cfg.rushFileName || "video.mp4");
        }
        if (cfg.characterImage) setCharacterImage(cfg.characterImage);
        // Typography
        if (cfg.titleLetterSpacing !== undefined)
          setTitleLetterSpacing(cfg.titleLetterSpacing);
        if (cfg.titleLineHeight !== undefined)
          setTitleLineHeight(cfg.titleLineHeight);
        if (cfg.titleBold !== undefined) setTitleBold(cfg.titleBold);
        if (cfg.titleItalic !== undefined) setTitleItalic(cfg.titleItalic);
        if (cfg.ctaLetterSpacing !== undefined)
          setCtaLetterSpacing(cfg.ctaLetterSpacing);
        if (cfg.ctaLineHeight !== undefined)
          setCtaLineHeight(cfg.ctaLineHeight);
        if (cfg.ctaBold !== undefined) setCtaBold(cfg.ctaBold);
        if (cfg.ctaItalic !== undefined) setCtaItalic(cfg.ctaItalic);
        if (cfg.overlayLetterSpacing !== undefined)
          setOverlayLetterSpacing(cfg.overlayLetterSpacing);
        if (cfg.overlayLineHeight !== undefined)
          setOverlayLineHeight(cfg.overlayLineHeight);
        if (cfg.overlayBold !== undefined) setOverlayBold(cfg.overlayBold);
        if (cfg.overlayItalic !== undefined)
          setOverlayItalic(cfg.overlayItalic);
        if (cfg.cardsLetterSpacing !== undefined)
          setCardsLetterSpacing(cfg.cardsLetterSpacing);
        // Advanced text effects
        if (cfg.titleTextGradient !== undefined) setTitleTextGradient(cfg.titleTextGradient);
        if (cfg.titleGradColor1) setTitleGradColor1(cfg.titleGradColor1);
        if (cfg.titleGradColor2) setTitleGradColor2(cfg.titleGradColor2);
        if (cfg.titleDuplicate !== undefined) setTitleDuplicate(cfg.titleDuplicate);
        if (cfg.titleDuplicateOffset !== undefined) setTitleDuplicateOffset(cfg.titleDuplicateOffset);
        if (cfg.titleDuplicateOpacity !== undefined) setTitleDuplicateOpacity(cfg.titleDuplicateOpacity);
        // Propriétés de design (police, filtre, style cartes, couleurs, positions, tailles, échelles)
        if (cfg.selectedFont) setSelectedFont(cfg.selectedFont);
        if (cfg.selectedFilter) setSelectedFilter(cfg.selectedFilter);
        if (cfg.selectedCardStyle) setSelectedCardStyle(cfg.selectedCardStyle);
        if (cfg.titleColor) setTitleColor(cfg.titleColor);
        if (cfg.ctaColor) setCtaColor(cfg.ctaColor);
        if (cfg.ctaSubColor) setCtaSubColor(cfg.ctaSubColor);
        if (cfg.ctaMainText) setCtaMainText(cfg.ctaMainText);
        if (cfg.ctaSubText) setCtaSubText(cfg.ctaSubText);
        if (cfg.gradientColor1) setGradientColor1(cfg.gradientColor1);
        if (cfg.gradientColor2) setGradientColor2(cfg.gradientColor2);
        if (cfg.gradientOpacity !== undefined) setGradientOpacity(cfg.gradientOpacity);
        if (cfg.noColorBg !== undefined) setNoColorBg(cfg.noColorBg);
        if (cfg.noColorSequences) setNoColorSequences(cfg.noColorSequences);
        if (cfg.seqGradients) setSeqGradients(cfg.seqGradients);
        if (cfg.textScale !== undefined) setTextScale(cfg.textScale);
        if (cfg.ctaTextScale !== undefined) setCtaTextScale(cfg.ctaTextScale);
        if (cfg.logoScale !== undefined) setLogoScale(cfg.logoScale);
        if (cfg.logoSequences) setLogoSequences(cfg.logoSequences);
        if (cfg.logoImage) setLogoImage(cfg.logoImage);
        if (cfg.customAccent) setCustomAccent(cfg.customAccent);
        if (cfg.customCardIcons) setCustomCardIcons(cfg.customCardIcons);
        // Positions des éléments
        if (cfg.titlePos) setTitlePos(cfg.titlePos);
        if (cfg.logoPositions) {
          setLogoPositions(cfg.logoPositions);
        } else if (cfg.logoPos) {
          // Migrate old single-pos format to per-sequence
          setLogoPositions({ titre: { ...cfg.logoPos }, cartes: { ...cfg.logoPos }, video: { ...cfg.logoPos }, cta: { ...cfg.logoPos } });
        }
        if (cfg.watermarkPos) setWatermarkPos(cfg.watermarkPos);
        if (cfg.cardsPos) setCardsPos(cfg.cardsPos);
        if (cfg.overlayPos) setOverlayPos(cfg.overlayPos);
        // Tailles des éléments
        if (cfg.titleSize) setTitleSize(cfg.titleSize);
        if (cfg.cardsSize) setCardsSize(cfg.cardsSize);
        if (cfg.watermarkSize) setWatermarkSize(cfg.watermarkSize);
        // Contenu (pour que la réédition préserve les textes)
        if (cfg.title) setTitle(cfg.title);
        if (cfg.subtitle) setSubtitle(cfg.subtitle);
        if (cfg.videoOverlayText) setVideoOverlayText(cfg.videoOverlayText);
        if (cfg.cards && cfg.cards.length > 0) setCards(cfg.cards);
        if (cfg.salesPhrases && cfg.salesPhrases.length > 0) setSalesPhrases(cfg.salesPhrases);
        if (cfg.contentTheme) setContentTheme(cfg.contentTheme);
        if (cfg.customTopic) setCustomTopic(cfg.customTopic);
        if (cfg.photoSearchQuery) setPhotoSearchQuery(cfg.photoSearchQuery);
        if (cfg.selectedPhotoIndex !== undefined) setSelectedPhotoIndex(cfg.selectedPhotoIndex);
        // Site text (Afroboost.com)
        if (cfg.siteText !== undefined) setSiteText(cfg.siteText);
        if (cfg.siteTextPositions) {
          setSiteTextPositions(cfg.siteTextPositions);
        } else if (cfg.siteTextPos) {
          // Migrate old single-pos format to per-sequence
          setSiteTextPositions({ titre: { ...cfg.siteTextPos }, cartes: { ...cfg.siteTextPos }, video: { ...cfg.siteTextPos }, cta: { ...cfg.siteTextPos } });
        }
        if (cfg.siteTextSize !== undefined) setSiteTextSize(cfg.siteTextSize);
        if (cfg.siteTextColor) setSiteTextColor(cfg.siteTextColor);
        if (cfg.siteTextOpacity !== undefined) setSiteTextOpacity(cfg.siteTextOpacity);
        if (cfg.siteTextSequences) setSiteTextSequences(cfg.siteTextSequences);
        if (cfg.siteTextEnabled !== undefined) setSiteTextEnabled(cfg.siteTextEnabled);
      }
    } catch {
      /* ignore */
    }
    // Marquer comme chargé APRÈS la restauration pour éviter que le save n'écrase les valeurs
    setConfigLoaded(true);
    // Allow auto-generate to work again after initial restore (next tick)
    requestAnimationFrame(() => { restoringFromStorage.current = false; });
  }, []);

  // ── Safe Zone Overlay (additive — does not affect existing logic) ────
  const [safeZonePlatform, setSafeZonePlatform] = useState<string | null>(null);

  // ── Design Step (additive — new step 1, shifts old steps) ────
  const [selectedFont, setSelectedFont] = useState("Anton");
  const [selectedFilter, setSelectedFilter] = useState("Aucun");
  const [selectedCardStyle, setSelectedCardStyle] = useState("Compact");

  // Font CSS variable mapping
  const FONT_CSS_MAP: Record<string, string> = {
    Anton: "var(--font-anton)",
    Syne: "var(--font-syne)",
    "Bebas Neue": "var(--font-bebas)",
    Poppins: "var(--font-poppins)",
    "Space Grotesk": "var(--font-space)",
  };

  // Filter CSS mapping (applied as overlay on preview)
  const FILTER_CSS_MAP: Record<string, React.CSSProperties> = {
    Aucun: {},
    "Neon Glow": {
      boxShadow:
        "inset 0 0 60px rgba(0, 255, 200, 0.15), inset 0 0 120px rgba(124, 58, 237, 0.1)",
    },
    Cinematic: {
      boxShadow: "inset 0 0 80px rgba(0, 0, 0, 0.6)",
      filter: "contrast(1.1) saturate(0.85)",
    },
    "Warm Energy": {
      boxShadow: "inset 0 0 60px rgba(255, 100, 50, 0.15)",
      filter: "saturate(1.15) brightness(1.05)",
    },
    "Cool Frost": {
      boxShadow: "inset 0 0 60px rgba(100, 180, 255, 0.15)",
      filter: "saturate(0.9) brightness(1.08) hue-rotate(10deg)",
    },
  };

  // Sequence view: show individual "pages" in preview
  const [activeSequence, setActiveSequence] = useState<
    "all" | "titre" | "cartes" | "video" | "cta"
  >("all");

  // Drag positions (percentage-based offsets from default)
  const [titlePos, setTitlePos] = useState({ x: 50, y: 10 });
  // Per-sequence logo positions: each sequence can have its own logo placement
  const defaultLogoPos = { x: 50, y: 85 };
  const [logoPositions, setLogoPositions] = useState<Record<string, { x: number; y: number }>>({
    titre: { ...defaultLogoPos },
    cartes: { ...defaultLogoPos },
    video: { ...defaultLogoPos },
    cta: { ...defaultLogoPos },
  });
  // Helper to get logo pos for current active sequence (or first enabled sequence)
  const getActiveLogoPos = () => {
    if (activeSequence !== 'all' && logoPositions[activeSequence]) return logoPositions[activeSequence];
    // In 'all' view, show the position of the first enabled logo sequence
    const firstSeq = logoSequences[0];
    return (firstSeq && logoPositions[firstSeq]) || defaultLogoPos;
  };
  const logoPos = getActiveLogoPos();
  const [watermarkPos, setWatermarkPos] = useState({ x: 50, y: 97 });
  const [cardsPos, setCardsPos] = useState({ x: 50, y: 50 });
  const [dragging, setDragging] = useState<string | null>(null);
  const [resizing, setResizing] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // Element sizes (percentage-based widths, 20-100)
  const [titleSize, setTitleSize] = useState(90);
  const [cardsSize, setCardsSize] = useState(92);
  const [watermarkSize, setWatermarkSize] = useState(70);
  const resizeStart = useRef<{ x: number; y: number; size: number } | null>(
    null,
  );

  // ── Play montage (auto-cycle through sequences) ────────────
  const [isPlaying, setIsPlaying] = useState(false);
  const playTimerRef = useRef<NodeJS.Timeout | null>(null);

  const stopPlayback = useCallback(() => {
    if (playTimerRef.current) clearTimeout(playTimerRef.current);
    playTimerRef.current = null;
    setIsPlaying(false);
  }, []);

  const startPlayback = useCallback(() => {
    stopPlayback();
    setIsPlaying(true);

    // Build sequence list with durations
    const sequences: { key: typeof activeSequence; duration: number }[] = [
      { key: 'titre', duration: introDuration },
      ...(cards.length > 0 ? [{ key: 'cartes' as const, duration: cardsDuration }] : []),
      ...(rushUrl ? [{ key: 'video' as const, duration: videoDuration }] : []),
      { key: 'cta', duration: ctaDuration },
    ];

    let i = 0;
    const playNext = () => {
      if (i >= sequences.length) {
        // Loop: restart from the beginning
        i = 0;
      }
      setActiveSequence(sequences[i].key);
      playTimerRef.current = setTimeout(() => {
        i++;
        playNext();
      }, sequences[i].duration * 1000);
    };
    playNext();
  }, [stopPlayback, introDuration, cardsDuration, videoDuration, ctaDuration, cards.length, rushUrl]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { if (playTimerRef.current) clearTimeout(playTimerRef.current); };
  }, []);

  // Auto-start looping playback once config is loaded (default behavior on page load/refresh)
  const autoPlayTriggered = useRef(false);
  useEffect(() => {
    if (configLoaded && !autoPlayTriggered.current && !isPlaying) {
      autoPlayTriggered.current = true;
      // Small delay to let the UI render first
      const t = setTimeout(() => startPlayback(), 500);
      return () => clearTimeout(t);
    }
  }, [configLoaded, startPlayback, isPlaying]);

  // Video overlay text position (draggable)
  const [overlayPos, setOverlayPos] = useState({ x: 50, y: 33 });

  // Site text (e.g. "Afroboost.com") — flexible text overlay
  const [siteText, setSiteText] = useState("Afroboost.com");
  const [siteTextSize, setSiteTextSize] = useState(1.0); // scale 0.3 to 3.0
  const [siteTextColor, setSiteTextColor] = useState("#FFFFFF");
  const [siteTextOpacity, setSiteTextOpacity] = useState(0.7);
  const [siteTextSequences, setSiteTextSequences] = useState<string[]>(["titre", "cartes", "video", "cta"]);
  const [siteTextEnabled, setSiteTextEnabled] = useState(true);
  // Per-sequence siteText positions: each sequence can have its own siteText placement
  const defaultSiteTextPos = { x: 50, y: 95 };
  const [siteTextPositions, setSiteTextPositions] = useState<Record<string, { x: number; y: number }>>({
    titre: { ...defaultSiteTextPos },
    cartes: { ...defaultSiteTextPos },
    video: { ...defaultSiteTextPos },
    cta: { ...defaultSiteTextPos },
  });
  // Helper to get siteText pos for current active sequence (or first enabled sequence)
  const getActiveSiteTextPos = () => {
    if (activeSequence !== 'all' && siteTextPositions[activeSequence]) return siteTextPositions[activeSequence];
    const firstSeq = siteTextSequences[0];
    return (firstSeq && siteTextPositions[firstSeq]) || defaultSiteTextPos;
  };
  const siteTextPos = getActiveSiteTextPos();

  // Text size scale (0.5 to 3.0)
  const [textScale, setTextScale] = useState(1.0);

  // CTA text scale (separate from global textScale, for CTA-specific sizing)
  const [ctaTextScale, setCtaTextScale] = useState(1.0);

  // CTA sub-text color (separate from main ctaColor)
  const [ctaSubColor, setCtaSubColor] = useState("#D91CD2");

  // ── Sauvegarde config à chaque changement — seulement APRÈS le chargement initial ──
  // (Placé après TOUTES les déclarations useState pour éviter les erreurs de zone morte temporelle)
  useEffect(() => {
    if (!configLoaded) return;
    try {
      localStorage.setItem(
        INFOGRAPHIC_CONFIG_KEY,
        JSON.stringify({
          colorTheme, format, introDuration, cardsDuration, videoDuration, ctaDuration,
          rushUrl, rushFileName, characterImage,
          titleLetterSpacing, titleLineHeight, titleBold, titleItalic,
          ctaLetterSpacing, ctaLineHeight, ctaBold, ctaItalic,
          overlayLetterSpacing, overlayLineHeight, overlayBold, overlayItalic, cardsLetterSpacing,
          selectedFont, selectedFilter, selectedCardStyle,
          titleColor, ctaColor, ctaSubColor, ctaMainText, ctaSubText,
          titleTextGradient, titleGradColor1, titleGradColor2,
          titleDuplicate, titleDuplicateOffset, titleDuplicateOpacity,
          gradientColor1, gradientColor2, gradientOpacity, noColorBg, noColorSequences, seqGradients,
          textScale, ctaTextScale, logoScale, logoSequences, logoImage, customAccent, customCardIcons,
          titlePos, logoPositions, watermarkPos, cardsPos, overlayPos,
          titleSize, cardsSize, watermarkSize,
          title, subtitle, videoOverlayText, cards, salesPhrases, contentTheme, customTopic,
          photoSearchQuery, selectedPhotoIndex,
          siteText, siteTextPositions, siteTextSize, siteTextColor, siteTextOpacity, siteTextSequences, siteTextEnabled,
        }),
      );
    } catch { /* ignore */ }
  }, [
    configLoaded, colorTheme, format, introDuration, cardsDuration, videoDuration, ctaDuration,
    rushUrl, rushFileName, characterImage,
    titleLetterSpacing, titleLineHeight, titleBold, titleItalic,
    ctaLetterSpacing, ctaLineHeight, ctaBold, ctaItalic,
    overlayLetterSpacing, overlayLineHeight, overlayBold, overlayItalic, cardsLetterSpacing,
    selectedFont, selectedFilter, selectedCardStyle,
    titleColor, ctaColor, ctaSubColor, ctaMainText, ctaSubText,
    titleTextGradient, titleGradColor1, titleGradColor2,
    titleDuplicate, titleDuplicateOffset, titleDuplicateOpacity,
    gradientColor1, gradientColor2, gradientOpacity, noColorBg, noColorSequences, seqGradients,
    textScale, ctaTextScale, logoScale, logoSequences, logoImage, customAccent, customCardIcons,
    titlePos, logoPositions, watermarkPos, cardsPos, overlayPos,
    titleSize, cardsSize, watermarkSize,
    title, subtitle, videoOverlayText, cards, salesPhrases, contentTheme, customTopic,
    photoSearchQuery, selectedPhotoIndex,
    siteText, siteTextPositions, siteTextSize, siteTextColor, siteTextOpacity, siteTextSequences, siteTextEnabled,
  ]);

  // (Typography states declared earlier for localStorage compatibility)

  // Settings panel visibility
  const [showSettings, setShowSettings] = useState(false);

  // Floating panels — which element panel is open
  const [activePanel, setActivePanel] = useState<
    "title" | "cards" | "cta" | "overlay" | "gradient" | "logo" | "sitetext" | "add" | null
  >(null);
  const [panelPos, setPanelPos] = useState({ x: 0, y: 0 });

  // Open a floating panel near the clicked element
  const openPanel = useCallback(
    (panel: typeof activePanel, e: React.MouseEvent) => {
      e.stopPropagation();
      // Position panel to the left of click, clamped to viewport
      const x = Math.min(e.clientX - 130, window.innerWidth - 320);
      const y = Math.max(
        20,
        Math.min(e.clientY - 40, window.innerHeight - 400),
      );
      setPanelPos({ x, y });
      setActivePanel((prev) => (prev === panel ? null : panel));
    },
    [],
  );

  // ── Step 2: Export ──────────────────────────────────────────
  const [destination, setDestination] = useState<Destination>("draft");
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  // ── Toast ───────────────────────────────────────────────────
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const showToast = (message: string, type: "success" | "error" = "error") =>
    setToast({ message, type });

  // ── Fetch Pexels photos based on theme ──────────────────────
  const [pexelsPage, setPexelsPage] = useState(1);

  const pexelsPageRef = useRef(1);
  const fetchPexelsPhotos = useCallback(
    async (query: string, newPage?: boolean) => {
      if (!query.trim()) return;
      setPexelsLoading(true);
      // Incrémente la page pour proposer de nouvelles photos à chaque clic
      const page = newPage ? pexelsPageRef.current + 1 : 1;
      pexelsPageRef.current = page;
      setPexelsPage(page);
      try {
        const count = Math.max(batchCount * 2, 6);
        const res = await fetch(
          `/api/pexels?query=${encodeURIComponent(query)}&count=${count}&page=${page}`,
        );
        const data = await res.json();
        if (data.success && data.photos && data.photos.length > 0) {
          setPexelsPhotos(data.photos);
          setSelectedPhotoIndex(0);
        } else if (page > 1) {
          // Plus de résultats, retour à la page 1
          pexelsPageRef.current = 1;
          setPexelsPage(1);
          const res2 = await fetch(
            `/api/pexels?query=${encodeURIComponent(query)}&count=${count}&page=1`,
          );
          const data2 = await res2.json();
          if (data2.success && data2.photos) {
            setPexelsPhotos(data2.photos);
            setSelectedPhotoIndex(0);
          }
        }
      } catch {
        console.error("Pexels fetch error");
      } finally {
        setPexelsLoading(false);
      }
    },
    [batchCount],
  );

  // ── Generate content (AI or local) ──────────────────────────
  const generateContent = useCallback(
    async (themeId?: string) => {
      const theme = themeId || contentTheme;
      setIsGenerating(true);
      setGenerationError("");

      try {
        // Determine topic text
        const themeObj = CONTENT_THEMES.find((t) => t.id === theme);
        const topicText =
          theme === "personnalise" ? customTopic : themeObj?.label || theme;

        if (theme === "personnalise" && !customTopic.trim()) {
          setIsGenerating(false);
          return;
        }

        // Try AI generation first (with 8s timeout to avoid blocking UI)
        let aiSuccess = false;
        try {
          const aiController = new AbortController();
          const aiTimeout = setTimeout(() => aiController.abort(), 8000);
          const aiRes = await fetch("/api/content/ai-generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              topic: topicText,
              locale: "fr",
              cardCount: 5,
            }),
            signal: aiController.signal,
          });
          clearTimeout(aiTimeout);

          if (aiRes.ok) {
            const aiData = await aiRes.json();
            if (aiData.success && aiData.content) {
              const c = aiData.content;
              setTitle(c.title || topicText.toUpperCase());
              setSubtitle(c.subtitle || "");
              setCards(
                (c.cards || []).map((card: any, i: number) => ({
                  id: `card-${Date.now()}-${i}`,
                  emoji: card.emoji || "⭐",
                  label: card.label || "",
                  value: card.value || "",
                  description: card.description || "",
                  color:
                    COLOR_THEMES.find((ct) => ct.id === colorTheme)?.accent ||
                    "#a855f7",
                })),
              );
              setSalesPhrases(c.salesPhrases || []);

              // Fetch photos matching the AI-suggested query or theme
              const pQuery =
                c.pexelsQuery || themeObj?.pexelsQuery || topicText;
              setPhotoSearchQuery(pQuery);
              fetchPexelsPhotos(pQuery);
              aiSuccess = true;
            }
          }
        } catch (aiErr: any) {
          console.warn(
            "[Infographie] AI generation failed/timeout, falling back to local:",
            aiErr?.name || aiErr?.message,
          );
        }
        if (aiSuccess) return;

        // Fallback: try local smart content (instant, no external API)
        const localRes = await fetch("/api/content/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic: topicText }),
        });
        if (localRes.ok) {
          const localData = await localRes.json();
          if (localData.success && localData.content) {
            const c = localData.content;
            setTitle(c.tagLine || topicText.toUpperCase());
            setSubtitle(c.subtitle || "");
            setCards(
              (c.cards || []).map((card: any, i: number) => ({
                id: `card-${Date.now()}-${i}`,
                emoji: ICON_TO_EMOJI[card.icon] || card.icon || "⭐",
                label: card.title || "",
                value: card.value || "",
                description: card.description || "",
                color:
                  COLOR_THEMES.find((ct) => ct.id === colorTheme)?.accent ||
                  "#a855f7",
              })),
            );
            setSalesPhrases([]);
            const pQuery = themeObj?.pexelsQuery || topicText;
            setPhotoSearchQuery(pQuery);
            fetchPexelsPhotos(pQuery);
            return;
          }
        }

        setGenerationError("Impossible de générer le contenu. Réessayez.");
      } catch (err) {
        console.error("Content generation error:", err);
        setGenerationError("Erreur de génération. Réessayez.");
      } finally {
        setIsGenerating(false);
      }
    },
    [contentTheme, customTopic, colorTheme, fetchPexelsPhotos],
  );

  // ── Auto-generate on theme change ───────────────────────────
  useEffect(() => {
    // Skip auto-generation when restoring from localStorage to preserve user's saved work
    if (restoringFromStorage.current) {
      // Still fetch photos for the restored theme so the gallery isn't empty
      if (contentTheme !== "personnalise") {
        const themeObj = CONTENT_THEMES.find((t) => t.id === contentTheme);
        const query = photoSearchQuery || themeObj?.pexelsQuery || themeObj?.label || "";
        if (query) fetchPexelsPhotos(query);
      }
      return;
    }
    if (contentTheme !== "personnalise") {
      // Set photo search query to theme's pexels query
      const themeObj = CONTENT_THEMES.find((t) => t.id === contentTheme);
      setPhotoSearchQuery(themeObj?.pexelsQuery || themeObj?.label || "");
      setPexelsPage(1); // Reset page counter for new theme
      generateContent(contentTheme);
    } else {
      // Clear content when switching to custom
      setTitle("");
      setSubtitle("");
      setCards([]);
      setSalesPhrases([]);
      setPexelsPhotos([]);
      setPhotoSearchQuery("");
      setPexelsPage(1);
    }
  }, [contentTheme]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Régénérer: regenerate content + new photos ──────────────
  const handleRegenerate = () => {
    if (contentTheme === "personnalise" && !customTopic.trim()) {
      showToast("Entrez un sujet personnalisé");
      return;
    }
    // Also fetch new photos (next page) in parallel
    const themeObj = CONTENT_THEMES.find((t) => t.id === contentTheme);
    const query =
      photoSearchQuery.trim() ||
      (contentTheme === "personnalise" ? customTopic : "") ||
      themeObj?.pexelsQuery ||
      themeObj?.label ||
      "fitness";
    fetchPexelsPhotos(query, true);
    generateContent();
  };

  // ── Card manipulation ───────────────────────────────────────
  const [isAddingCard, setIsAddingCard] = useState(false);

  const addCard = async () => {
    const accent =
      COLOR_THEMES.find((ct) => ct.id === colorTheme)?.accent || "#a855f7";
    const themeObj = CONTENT_THEMES.find((t) => t.id === contentTheme);
    const topicText =
      contentTheme === "personnalise"
        ? customTopic
        : themeObj?.label || "fitness";

    // Try to generate a smart card via Anthropic
    setIsAddingCard(true);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch("/api/content/ai-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topicText,
          locale: "fr",
          cardCount: 1,
          existingCards: cards.map((c) => c.label), // Avoid duplicate topics
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.content?.cards?.[0]) {
          const aiCard = data.content.cards[0];
          setCards([
            ...cards,
            {
              id: `card-${Date.now()}`,
              emoji: aiCard.emoji || "⭐",
              label: aiCard.label || "Info",
              value: aiCard.value || "",
              description: aiCard.description || "",
              color: accent,
            },
          ]);
          setIsAddingCard(false);
          return;
        }
      }
    } catch {
      // AI failed, fallback to generic
    }

    // Fallback: generic card
    setCards([
      ...cards,
      {
        id: `card-${Date.now()}`,
        emoji: "⭐",
        label: "Nouveau",
        value: "Valeur",
        description: "",
        color: accent,
      },
    ]);
    setIsAddingCard(false);
  };

  const deleteCard = (id: string) => setCards(cards.filter((c) => c.id !== id));

  const updateCard = (id: string, field: keyof InfoCard, value: string) => {
    setCards(cards.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  };

  // ── Character upload ────────────────────────────────────────
  const handleCharacterUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) =>
        setCharacterImage(event.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  // ── Logo upload ────────────────────────────────────────────
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => setLogoImage(event.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  // ── Video upload ───────────────────────────────────────────
  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("video/")) {
      showToast("Veuillez sélectionner un fichier vidéo");
      return;
    }

    // Validate file size (max 100MB)
    if (file.size > 100 * 1024 * 1024) {
      showToast("La vidéo ne doit pas dépasser 100 Mo");
      return;
    }

    setIsUploadingVideo(true);
    setRushFileName(file.name);

    try {
      // Use signed URL for large files (videos > 4MB) to bypass Vercel's 4.5MB body limit
      if (file.size > 4 * 1024 * 1024) {
        const signRes = await fetch("/api/upload/signed-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            contentType: file.type,
            purpose: "infographic-video",
          }),
        });
        const signData = await signRes.json();
        if (!signData.success) {
          showToast("Erreur lors de l'upload de la vidéo");
          setRushFileName(null);
          setIsUploadingVideo(false);
          return;
        }
        const putRes = await fetch(signData.signedUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!putRes.ok) {
          showToast("Erreur lors de l'upload de la vidéo");
          setRushFileName(null);
          setIsUploadingVideo(false);
          return;
        }
        console.log("[Upload] Signed URL upload OK:", signData.publicUrl);
        setRushUrl(signData.publicUrl);
        showToast("Vidéo uploadée avec succès", "success");
      } else {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("purpose", "infographic-video");
        const res = await fetch("/api/upload/media", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (data.success && data.file?.url) {
          setRushUrl(data.file.url);
          showToast("Vidéo uploadée avec succès", "success");
        } else {
          showToast("Erreur lors de l'upload de la vidéo");
          setRushFileName(null);
        }
      }
    } catch (err) {
      console.error("Video upload error:", err);
      showToast("Erreur lors de l'upload de la vidéo");
      setRushFileName(null);
    } finally {
      setIsUploadingVideo(false);
    }
  };

  const removeVideo = () => {
    setRushUrl(null);
    setRushFileName(null);
  };

  // ── Export ──────────────────────────────────────────────────
  const handleExport = async () => {
    if (cards.length === 0) {
      showToast("Ajoutez au moins une carte avant d'exporter");
      return;
    }

    // Safety check: if a video was expected but source is undefined, block export
    if (rushFileName && !rushUrl) {
      showToast(
        "La vidéo n'a pas été uploadée correctement. Veuillez re-sélectionner le média.",
      );
      return;
    }

    setIsExporting(true);
    setExportProgress(0);

    try {
      const total = batchCount;
      const createdPostIds: string[] = [];
      for (let b = 0; b < total; b++) {
        setExportProgress(Math.round((b / total) * 100));

        // Utiliser la photo sélectionnée par l'utilisateur (selectedPhotoIndex)
        // En mode batch, on peut aussi varier les photos après la première
        const photoIdx = b === 0 ? selectedPhotoIndex : (selectedPhotoIndex + b) % (pexelsPhotos.length || 1);
        const photo =
          pexelsPhotos.length > 0
            ? pexelsPhotos[photoIdx]
            : null;
        const posterUrl = photo?.url || null;

        // Pick a different sales phrase per batch item
        const salesPhrase =
          salesPhrases.length > 0 ? salesPhrases[b % salesPhrases.length] : "";

        // Upload character image if present (first iteration only)
        let mediaUrl: string | null = posterUrl;
        if (b === 0 && characterImage && characterImage.startsWith("data:")) {
          const blob = await fetch(characterImage).then((r) => r.blob());
          const file = new File([blob], "infographic-character.png", {
            type: "image/png",
          });
          if (file.size > 4 * 1024 * 1024) {
            const signRes = await fetch("/api/upload/signed-url", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                filename: file.name,
                contentType: file.type,
                purpose: "infographic",
              }),
            });
            const signData = await signRes.json();
            if (signData.success) {
              const putRes = await fetch(signData.signedUrl, {
                method: "PUT",
                headers: { "Content-Type": file.type },
                body: file,
              });
              if (putRes.ok) mediaUrl = signData.publicUrl;
            }
          } else {
            const formData = new FormData();
            formData.append("file", file);
            formData.append("purpose", "infographic");
            const uploadRes = await fetch("/api/upload/media", {
              method: "POST",
              body: formData,
            });
            const uploadData = await uploadRes.json();
            if (uploadData.success) mediaUrl = uploadData.file.url;
          }
        }

        // Determine media type based on whether video is present
        const hasVideo = !!rushUrl;
        const mediaType = hasVideo ? "video" : "image";

        if (destination === "draft" || destination === "both" || destination === "audio-studio") {
          const today = new Date();
          today.setDate(today.getDate() + b); // Spread across days
          const scheduledDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
          const caption = [
            subtitle,
            cards.map((c) => `${c.emoji} ${c.label}: ${c.value}`).join(" | "),
            salesPhrase ? `\n${salesPhrase}` : "",
            "\n💬 Plus d'infos → https://afroboost.com",
          ]
            .filter(Boolean)
            .join("\n");

          const postRes = await fetch("/api/posts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: title || "Infographie",
              caption,
              // For video posts: media_url = null — montage will be composed at schedule/publish time
              // For image posts: use the uploaded image or poster
              media_url: hasVideo ? null : (mediaUrl || posterUrl || null),
              media_type: hasVideo ? 'video' : 'image',
              format: format === "16:9" ? "tv" : "reel",
              platforms: [],
              scheduled_date: scheduledDate,
              scheduled_time: "12:00",
              status: "draft",
              metadata: {
                type: "infographic",
                subtitle,
                videoOverlayText: videoOverlayText || undefined,
                theme: contentTheme,
                colorTheme,
                salesPhrase,
                cards: cards.map((c) => ({
                  emoji: c.emoji,
                  label: c.label,
                  value: c.value,
                  description: c.description,
                  color: c.color,
                })),
                characterUrl: characterImage ? mediaUrl : null,
                posterUrl,
                pexelsUrl: posterUrl,
                logoUrl: logoImage || undefined,
                videoUrl: rushUrl || undefined,
                rushUrls: rushUrl ? [rushUrl] : undefined,
                sequences: {
                  intro: introDuration,
                  cards: cards.length > 0 ? cardsDuration : 0,
                  video: rushUrl ? videoDuration : 0,
                  cta: ctaDuration,
                  total:
                    introDuration +
                    (cards.length > 0 ? cardsDuration : 0) +
                    (rushUrl ? videoDuration : 0) +
                    ctaDuration,
                  order: [
                    "intro",
                    ...(cards.length > 0 ? ["cards"] : []),
                    ...(rushUrl ? ["video"] : []),
                    "cta",
                  ],
                },
                branding: {
                  accentColor:
                    COLOR_THEMES.find((ct) => ct.id === colorTheme)?.accent ||
                    "#a855f7",
                  ctaText: ctaSubText || "CHAT POUR PLUS D'INFOS",
                  ctaSubText: "LIEN EN BIO",
                  watermarkText: ctaMainText || "AFROBOOST",
                  borderColor: null,
                },
                // ── Design settings (positions, sizes, colors, font, filter, typography, etc.) ──
                design: {
                  font: selectedFont,
                  filter: selectedFilter,
                  cardStyle: selectedCardStyle,
                  textScale,
                  ctaTextScale,
                  titleColor,
                  ctaColor,
                  ctaSubColor,
                  ctaMainText: ctaMainText || "AFROBOOST",
                  ctaSubText: ctaSubText || "CHAT POUR PLUS D'INFOS",
                  noColorBg,
                  noColorSequences,
                  gradientColor1,
                  gradientColor2,
                  gradientOpacity,
                  seqGradients,
                  positions: {
                    title: titlePos,
                    logo: getActiveLogoPos(), // Legacy single pos (fallback for old callers)
                    watermark: watermarkPos,
                    cards: cardsPos,
                    overlay: overlayPos,
                  },
                  logoPositions, // Per-sequence logo positions
                  sizes: {
                    title: titleSize,
                    cards: cardsSize,
                    watermark: watermarkSize,
                  },
                  logoScale,
                  logoSequences,
                  logoUrl: logoImage || undefined,
                  siteText: siteTextEnabled ? {
                    text: siteText,
                    pos: getActiveSiteTextPos(), // Legacy single pos (fallback)
                    positions: siteTextPositions, // Per-sequence positions
                    size: siteTextSize,
                    color: siteTextColor,
                    opacity: siteTextOpacity,
                    sequences: siteTextSequences,
                    enabled: siteTextEnabled,
                  } : undefined,
                  typography: {
                    title: {
                      letterSpacing: titleLetterSpacing,
                      lineHeight: titleLineHeight,
                      bold: titleBold,
                      italic: titleItalic,
                      textGradient: titleTextGradient,
                      gradColor1: titleGradColor1,
                      gradColor2: titleGradColor2,
                      duplicate: titleDuplicate,
                      duplicateOffset: titleDuplicateOffset,
                      duplicateOpacity: titleDuplicateOpacity,
                    },
                    cta: {
                      letterSpacing: ctaLetterSpacing,
                      lineHeight: ctaLineHeight,
                      bold: ctaBold,
                      italic: ctaItalic,
                    },
                    overlay: {
                      letterSpacing: overlayLetterSpacing,
                      lineHeight: overlayLineHeight,
                      bold: overlayBold,
                      italic: overlayItalic,
                    },
                  },
                  cardCustomIcons: customCardIcons,
                },
              },
            }),
          });
          // Capture created post ID for Studio Son redirect
          try {
            const postData = await postRes.json();
            if (postData.success && postData.post?.id) {
              createdPostIds.push(postData.post.id);
            }
          } catch { /* ignore parse errors */ }
        }
      }

      setExportProgress(100);

      // ── Export bureau : composition du montage vidéo final (MP4 uniquement) ──
      if (destination === 'export' || destination === 'both') {
        try {
          const exportAccent =
            COLOR_THEMES.find((ct) => ct.id === colorTheme)?.accent || customAccent || "#a855f7";
          const isReel = format === "9:16";
          const exportPhoto = pexelsPhotos.length > 0 ? pexelsPhotos[0] : null;
          const exportPosterUrl = exportPhoto?.url || null;

          // Composer le montage vidéo final puis télécharger en MP4
          setExportProgress(50);
          const composedResult = await composeAndUpload({
            width: isReel ? 1080 : 1920,
            height: isReel ? 1920 : 1080,
            fps: 30,
            title: title || "Infographie",
            subtitle: subtitle || undefined,
            salesPhrase: salesPhrases.length > 0 ? salesPhrases[0] : undefined,
            cards: cards.length > 0
              ? cards.map((c) => ({ emoji: c.emoji, label: c.label, value: c.value, color: c.color }))
              : undefined,
            posterUrl: exportPosterUrl,
            videoUrl: rushUrl,
            logoUrl: logoImage || null,
            introDuration,
            cardsDuration: cards.length > 0 ? cardsDuration : 0,
            videoDuration: rushUrl ? videoDuration : 0,
            ctaDuration,
            accentColor: exportAccent,
            ctaText: ctaSubText || "CHAT POUR PLUS D'INFOS",
            ctaSubText: "LIEN EN BIO",
            watermarkText: ctaMainText || "AFROBOOST",
            siteText: siteTextEnabled ? {
              text: siteText,
              color: siteTextColor,
              opacity: siteTextOpacity,
              size: siteTextSize,
              sequences: siteTextSequences,
              enabled: siteTextEnabled,
              positions: siteTextPositions,
            } : { text: '', enabled: false },
            design: {
              font: selectedFont || undefined,
              titleColor: titleColor || undefined,
              gradientColor1: gradientColor1 || undefined,
              gradientColor2: gradientColor2 || undefined,
              gradientOpacity: gradientOpacity ?? undefined,
              ctaSubColor: ctaSubColor || undefined,
              ctaColor: ctaColor || undefined,
              textScale: textScale || undefined,
              ctaTextScale: ctaTextScale || undefined,
              cardStyle: selectedCardStyle || undefined,
              titlePosition: titlePos || undefined,
              cardsPosition: cardsPos || undefined,
              cardsSize: cardsSize || undefined,
              logoSequences: logoSequences || undefined,
              logoPosition: getActiveLogoPos() || undefined,
              logoPositions: logoPositions || undefined,
              logoScale: logoScale || undefined,
              ctaMainText: ctaMainText || undefined,
              ctaSubTextDesign: ctaSubText || undefined,
              titleTypography: {
                letterSpacing: titleLetterSpacing || undefined,
                lineHeight: titleLineHeight || undefined,
                bold: titleBold,
                italic: titleItalic,
              },
              watermarkPosition: watermarkPos || undefined,
              watermarkSize: watermarkSize || undefined,
              overlayPosition: overlayPos || undefined,
              titleSize: titleSize || undefined,
              ctaTypography: {
                letterSpacing: ctaLetterSpacing || undefined,
                lineHeight: ctaLineHeight || undefined,
                bold: ctaBold,
                italic: ctaItalic,
              },
              overlayTypography: {
                letterSpacing: overlayLetterSpacing || undefined,
                lineHeight: overlayLineHeight || undefined,
                bold: overlayBold,
                italic: overlayItalic,
              },
              overlayText: videoOverlayText || undefined,
            },
            onProgress: (pct, stage) => {
              setExportProgress(50 + Math.round(pct * 0.35));
            },
          });
          setExportProgress(85);
          // Télécharger uniquement le fichier MP4
          if (composedResult.blob && composedResult.blob.size > 0) {
            await downloadBlob(
              composedResult.blob,
              `infographie-${title || 'afroboost'}.mp4`,
              (pct, stage) => setExportProgress(85 + Math.round(pct * 0.15))
            );
          }
        } catch (e) {
          console.warn('[Export Bureau] Erreur:', e);
        }
      }

      const messages: string[] = [];
      if (destination === 'draft' || destination === 'both' || destination === 'audio-studio') {
        messages.push(`${total} infographie${total > 1 ? 's' : ''} ajoutée${total > 1 ? 's' : ''} au calendrier`);
      }
      if (destination === 'export' || destination === 'both') {
        messages.push('Fichiers téléchargés');
      }
      if (destination === 'audio-studio') {
        messages.push('Redirection vers Studio Son...');
      }
      showToast(messages.join(' + ') + ' !', 'success');

      if (destination === 'audio-studio') {
        const audioStudioUrl = createdPostIds.length === 1
          ? `/dashboard/audio-studio?postId=${createdPostIds[0]}`
          : createdPostIds.length > 1
            ? `/dashboard/audio-studio?postIds=${createdPostIds.join(',')}`
            : '/dashboard/audio-studio';
        setTimeout(() => router.push(audioStudioUrl), 1500);
      } else if (destination === "draft" || destination === "both") {
        setTimeout(() => router.push("/dashboard/calendar"), 2000);
      }
    } catch (error) {
      console.error("Export error:", error);
      showToast("Erreur lors de l'export");
    } finally {
      setIsExporting(false);
    }
  };

  // ── Preview helpers ─────────────────────────────────────────
  const activeColorTheme =
    colorTheme === "custom"
      ? { id: "custom", name: "Custom", bg: "", accent: customAccent }
      : COLOR_THEMES.find((ct) => ct.id === colorTheme) || COLOR_THEMES[1];
  const previewPhoto = pexelsPhotos[selectedPhotoIndex] || null;

  const getPreviewClasses = () => {
    if (format === "16:9")
      return { aspect: "aspect-[16/9]", maxW: "max-w-lg", cols: "grid-cols-3" };
    return { aspect: "aspect-[9/16]", maxW: "max-w-xs", cols: "grid-cols-2" };
  };
  const previewClasses = getPreviewClasses();

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col lg:flex-row bg-gray-900 text-white overflow-x-hidden">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
            toast.type === "success"
              ? "bg-green-600 text-white"
              : "bg-red-600 text-white"
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Left Panel - Form */}
      <div className="w-full lg:w-1/2 overflow-y-auto border-r-0 lg:border-r border-gray-800 p-3 sm:p-6 pb-24 lg:pb-6 lg:max-h-[calc(100vh-4rem)]">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-3">
          <h1 className="text-lg sm:text-2xl font-bold">
            Créer une Infographie
          </h1>
          <div className="flex items-center gap-1.5 sm:gap-2">
            {["Contenu", "Design", "Style", "Export"].map((label, i) => (
              <button
                key={label}
                onClick={() => setStep(i)}
                className={`flex items-center gap-1 rounded-full px-2.5 sm:px-3 py-1.5 text-[10px] sm:text-xs font-medium transition-all whitespace-nowrap ${
                  step === i
                    ? "bg-purple-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:text-white"
                }`}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-black/30 text-[10px]">
                  {i + 1}
                </span>
                {label}
              </button>
            ))}
          </div>
          {/* Paramètres gear button */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium transition-all ${
              showSettings
                ? "bg-purple-600 text-white"
                : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
            title="Paramètres Globaux"
          >
            <span>⚙️</span>
          </button>
        </div>

        {/* ── Quick Settings Row (Color + Format) — shown on ALL steps ── */}
        <div className="rounded-lg bg-gray-800/50 px-3 py-2 space-y-2 mb-4">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider mr-1">
              Couleur
            </span>
            {COLOR_THEMES.map((ct) => (
              <button
                key={ct.id}
                onClick={() => {
                  setColorTheme(ct.id);
                  setNoColorBg(false);
                }}
                className={`h-6 w-6 rounded-full bg-gradient-to-br ${ct.bg} transition-all flex-shrink-0 ${
                  colorTheme === ct.id && !noColorBg
                    ? "ring-2 ring-white scale-110"
                    : "opacity-60 hover:opacity-100"
                }`}
                title={ct.name}
              />
            ))}
            <button
              onClick={() => {
                setColorTheme("custom");
                setNoColorBg(false);
              }}
              className={`h-6 w-6 rounded-full transition-all flex-shrink-0 ${
                colorTheme === "custom" && !noColorBg
                  ? "ring-2 ring-white scale-110"
                  : "opacity-60 hover:opacity-100"
              }`}
              style={{
                background: `conic-gradient(#ef4444, #f59e0b, #10b981, #3b82f6, #a855f7, #ec4899, #ef4444)`,
              }}
              title="Personnalisé"
            />
            {/* Sans couleur button */}
            <button
              onClick={() => setNoColorBg(!noColorBg)}
              className={`h-6 w-6 rounded-full border-2 transition-all flex-shrink-0 ${
                noColorBg
                  ? "ring-2 ring-white scale-110 border-gray-400 bg-gray-900"
                  : "border-gray-600 bg-gray-800 opacity-60 hover:opacity-100"
              }`}
              title="Sans couleur (photo uniquement)"
            >
              {noColorBg && (
                <span className="block w-full h-full rounded-full relative">
                  <span className="absolute inset-0 flex items-center justify-center text-[8px] text-gray-400">
                    ∅
                  </span>
                </span>
              )}
            </button>
            {colorTheme === "custom" && !noColorBg && (
              <input
                type="color"
                value={customAccent}
                onChange={(e) => setCustomAccent(e.target.value)}
                className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
              />
            )}
            <div className="ml-auto flex gap-1">
              {(["9:16", "16:9"] as Format[]).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => setFormat(fmt)}
                  className={`rounded px-2 py-0.5 text-[10px] font-bold transition-all ${
                    format === fmt
                      ? "bg-purple-600 text-white"
                      : "bg-gray-700 text-gray-400 hover:text-white"
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>
          </div>
          {/* Per-sequence color control — shown when noColorBg is on */}
          {noColorBg && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[9px] text-gray-500">
                Sans couleur sur :
              </span>
              {["titre", "cartes", "video", "cta"].map((seq) => (
                <label
                  key={seq}
                  className="flex items-center gap-1 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={noColorSequences.includes(seq)}
                    onChange={(e) => {
                      if (e.target.checked)
                        setNoColorSequences([...noColorSequences, seq]);
                      else
                        setNoColorSequences(
                          noColorSequences.filter((s) => s !== seq),
                        );
                    }}
                    className="h-3 w-3 rounded border-gray-600 accent-purple-500"
                  />
                  <span className="text-[10px] text-gray-400 capitalize">
                    {seq}
                  </span>
                </label>
              ))}
              <button
                onClick={() =>
                  setNoColorSequences(["titre", "cartes", "video", "cta"])
                }
                className="text-[9px] text-purple-400 hover:text-purple-300 ml-1"
              >
                Toutes
              </button>
              <button
                onClick={() => setNoColorSequences([])}
                className="text-[9px] text-gray-500 hover:text-gray-400"
              >
                Aucune
              </button>
            </div>
          )}
        </div>

        {/* ── Settings Panel (overlaid when showSettings is true) — visible on ALL steps ── */}
        {showSettings && (
          <div className="rounded-lg bg-gray-800/80 border border-purple-500/30 p-4 space-y-4">
            {/* Font Selector */}
            <div>
              <label className="mb-2 block text-xs font-medium text-gray-400 uppercase tracking-wider">
                Police
              </label>
              <div className="flex flex-wrap gap-1.5">
                {FONT_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    onClick={() => setSelectedFont(opt.label)}
                    className={`px-2 py-1 rounded text-[9px] font-medium transition-all ${
                      selectedFont === opt.label
                        ? "bg-purple-600 text-white"
                        : "bg-gray-700 text-gray-400 hover:text-white"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Filter Selector */}
            <div>
              <label className="mb-2 block text-xs font-medium text-gray-400 uppercase tracking-wider">
                Filtre visuel
              </label>
              <div className="flex flex-wrap gap-1.5">
                {FILTER_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    onClick={() => setSelectedFilter(opt.label)}
                    className={`px-2 py-1 rounded text-[9px] font-medium transition-all ${
                      selectedFilter === opt.label
                        ? "bg-purple-600 text-white"
                        : "bg-gray-700 text-gray-400 hover:text-white"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Card Style Selector */}
            <div>
              <label className="mb-2 block text-xs font-medium text-gray-400 uppercase tracking-wider">
                Style des cartes
              </label>
              <div className="flex flex-wrap gap-1.5">
                {CARD_STYLE_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    onClick={() => setSelectedCardStyle(opt.label)}
                    className={`px-2 py-1 rounded text-[9px] font-medium transition-all ${
                      selectedCardStyle === opt.label
                        ? "bg-purple-600 text-white"
                        : "bg-gray-700 text-gray-400 hover:text-white"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Logo Upload */}
            <div>
              <label className="mb-2 block text-xs font-medium text-gray-400 uppercase tracking-wider">
                Logo
              </label>
              <div className="flex items-center gap-3">
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-gray-700 bg-gray-800 px-3 py-2 hover:border-purple-500 hover:bg-gray-700 transition-all">
                  <Upload size={14} />
                  <span className="text-xs text-gray-300">
                    {logoImage ? "Changer" : "Charger Logo"}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="hidden"
                  />
                </label>
                {logoImage && (
                  <div className="flex items-center gap-2">
                    <img
                      src={logoImage}
                      alt="Logo"
                      className="h-8 w-8 rounded object-contain bg-gray-800 border border-gray-700"
                    />
                    <button
                      onClick={() => setLogoImage(null)}
                      className="rounded p-1 text-gray-500 hover:bg-red-600 hover:text-white"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Format Selection */}
            <div>
              <label className="mb-2 block text-xs font-medium text-gray-400 uppercase tracking-wider">
                Format
              </label>
              <div className="flex gap-2">
                {(["9:16", "16:9"] as Format[]).map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => setFormat(fmt)}
                    className={`flex-1 rounded px-3 py-2 text-xs font-bold transition-all ${
                      format === fmt
                        ? "bg-purple-600 text-white"
                        : "bg-gray-700 text-gray-400 hover:text-white"
                    }`}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>

            {/* Reset Positions Button */}
            <button
              onClick={() => {
                setTitlePos({ x: 50, y: 10 });
                setLogoPositions({ titre: { x: 50, y: 85 }, cartes: { x: 50, y: 85 }, video: { x: 50, y: 85 }, cta: { x: 50, y: 85 } });
                setWatermarkPos({ x: 50, y: 97 });
                setCardsPos({ x: 50, y: 50 });
                setTitleSize(100);
                setCardsSize(95);
                setWatermarkSize(80);
              }}
              className="w-full rounded-lg border border-gray-700 bg-gray-700 px-3 py-2 text-xs font-medium text-gray-300 hover:bg-gray-600"
            >
              ↺ Réinitialiser les positions
            </button>

            {/* Close Settings Button */}
            <button
              onClick={() => setShowSettings(false)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs font-medium text-gray-300 hover:bg-gray-700"
            >
              Fermer les paramètres
            </button>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════ */}
        {/* STEP 0: Content Theme & Generation */}
        {/* ═══════════════════════════════════════════════════════ */}
        {step === 0 && (
          <div className="space-y-4">
            {/* Content Theme Selector */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-300">
                Thème du contenu
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {CONTENT_THEMES.map((theme) => (
                  <button
                    key={theme.id}
                    onClick={() => setContentTheme(theme.id)}
                    className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-all ${
                      contentTheme === theme.id
                        ? "ring-2 ring-purple-500 bg-gray-800"
                        : "bg-gray-800/50 hover:bg-gray-800"
                    }`}
                  >
                    <span className="text-sm">{theme.emoji}</span>
                    <span className="leading-tight">{theme.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Topic Input (only for Personnalisé) */}
            {contentTheme === "personnalise" && (
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-300">
                  Votre sujet personnalisé
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customTopic}
                    onChange={(e) => setCustomTopic(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && customTopic.trim())
                        generateContent();
                    }}
                    className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                    placeholder="Ex: moringa, collagène, stretching..."
                  />
                  <button
                    onClick={() => generateContent()}
                    disabled={!customTopic.trim() || isGenerating}
                    className="rounded-lg bg-purple-600 px-4 py-2.5 font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                  >
                    {isGenerating ? (
                      <Loader2 size={18} className="animate-spin" />
                    ) : (
                      <Sparkles size={18} />
                    )}
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  L'IA va générer des cartes d'information riches sur ce sujet
                </p>
              </div>
            )}

            {/* Loading / Error State */}
            {isGenerating && (
              <div className="flex items-center justify-center gap-3 rounded-lg border border-gray-700 bg-gray-800/50 py-8">
                <Loader2 size={24} className="animate-spin text-purple-400" />
                <span className="text-gray-300">
                  Génération du contenu par l'IA...
                </span>
              </div>
            )}
            {generationError && (
              <div className="rounded-lg border border-red-800 bg-red-900/30 p-3 text-sm text-red-300">
                {generationError}
              </div>
            )}

            {/* Photo Search — always visible in Step 0 for custom photo selection */}
            {pexelsPhotos.length > 0 && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-300">
                    Photos d'affiche ({pexelsPhotos.length})
                  </label>
                  <button
                    onClick={() => {
                      const query =
                        photoSearchQuery.trim() ||
                        (contentTheme === "personnalise" ? customTopic : "") ||
                        CONTENT_THEMES.find((t) => t.id === contentTheme)
                          ?.pexelsQuery ||
                        "fitness";
                      fetchPexelsPhotos(query, true);
                    }}
                    disabled={pexelsLoading}
                    className="flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-purple-400 hover:bg-gray-700"
                  >
                    <RefreshCw
                      size={14}
                      className={pexelsLoading ? "animate-spin" : ""}
                    />
                    Nouvelles photos
                  </button>
                </div>
                <div className="mb-2 flex gap-2">
                  <div className="relative flex-1">
                    <Search
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                    />
                    <input
                      type="text"
                      value={photoSearchQuery}
                      onChange={(e) => setPhotoSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && photoSearchQuery.trim()) {
                          pexelsPageRef.current = 0;
                          fetchPexelsPhotos(photoSearchQuery.trim(), true);
                        }
                      }}
                      className="w-full rounded-lg border border-gray-700 bg-gray-800 pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                      placeholder="Rechercher des photos... (ex: manioc, yoga, danse)"
                    />
                  </div>
                  <button
                    onClick={() => {
                      if (photoSearchQuery.trim()) {
                        pexelsPageRef.current = 0;
                        fetchPexelsPhotos(photoSearchQuery.trim(), true);
                      }
                    }}
                    disabled={pexelsLoading || !photoSearchQuery.trim()}
                    className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                  >
                    {pexelsLoading ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Search size={16} />
                    )}
                  </button>
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {pexelsPhotos.map((photo, i) => (
                    <button
                      key={photo.id}
                      onClick={() => setSelectedPhotoIndex(i)}
                      className={`relative overflow-hidden rounded-lg transition-all ${
                        selectedPhotoIndex === i
                          ? "ring-2 ring-purple-500"
                          : "opacity-70 hover:opacity-100"
                      }`}
                    >
                      <img
                        src={photo.small}
                        alt={photo.alt}
                        className="aspect-[3/4] w-full object-cover"
                      />
                      {selectedPhotoIndex === i && (
                        <div className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-purple-500">
                          <Check size={10} />
                        </div>
                      )}
                      {batchCount > 1 && i < batchCount && (
                        <div className="absolute bottom-0 left-0 rounded-tr bg-black/70 px-1 py-0.5 text-[8px] font-bold text-white">
                          #{i + 1}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Generated Content Preview */}
            {!isGenerating && cards.length > 0 && (
              <>
                {/* Title & Subtitle */}
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-400">
                      Titre
                    </label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-400">
                      Sous-titre
                    </label>
                    <input
                      type="text"
                      value={subtitle}
                      onChange={(e) => setSubtitle(e.target.value)}
                      className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Info Cards */}
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-300">
                      Cartes d'Information ({cards.length})
                    </h3>
                    <button
                      onClick={handleRegenerate}
                      disabled={isGenerating}
                      className="flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-purple-400 hover:bg-gray-700"
                    >
                      <RefreshCw
                        size={14}
                        className={isGenerating ? "animate-spin" : ""}
                      />
                      Régénérer
                    </button>
                  </div>
                  <div className="space-y-3">
                    {cards.map((card) => (
                      <div
                        key={card.id}
                        className="rounded-lg border border-gray-700 bg-gray-800 p-3"
                      >
                        <div className="flex items-start gap-3">
                          {/* Emoji */}
                          <div className="relative">
                            <button
                              onClick={() =>
                                setShowEmojiPicker(
                                  showEmojiPicker === card.id ? null : card.id,
                                )
                              }
                              className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-700 text-xl hover:bg-gray-600"
                            >
                              {card.emoji}
                            </button>
                            {showEmojiPicker === card.id && (
                              <div className="absolute top-full left-0 z-10 mt-1 grid grid-cols-4 sm:grid-cols-5 gap-1 rounded-lg border border-gray-600 bg-gray-800 p-2 shadow-xl">
                                {EMOJIS.map((emoji) => (
                                  <button
                                    key={emoji}
                                    onClick={() => {
                                      updateCard(card.id, "emoji", emoji);
                                      setShowEmojiPicker(null);
                                    }}
                                    className="rounded p-1 text-lg hover:bg-gray-700"
                                  >
                                    {emoji}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          {/* Content */}
                          <div className="flex-1 space-y-1.5">
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={card.label}
                                onChange={(e) =>
                                  updateCard(card.id, "label", e.target.value)
                                }
                                className="flex-1 rounded border border-gray-600 bg-gray-700 px-2 py-1 text-xs font-bold text-white focus:border-purple-500 focus:outline-none"
                                placeholder="Label"
                              />
                              <input
                                type="text"
                                value={card.value}
                                onChange={(e) =>
                                  updateCard(card.id, "value", e.target.value)
                                }
                                className="w-20 rounded border border-gray-600 bg-gray-700 px-2 py-1 text-xs font-bold text-purple-400 focus:border-purple-500 focus:outline-none"
                                placeholder="Valeur"
                              />
                            </div>
                            <input
                              type="text"
                              value={card.description}
                              onChange={(e) =>
                                updateCard(
                                  card.id,
                                  "description",
                                  e.target.value,
                                )
                              }
                              className="w-full rounded border border-gray-600 bg-gray-700 px-2 py-1 text-xs text-gray-300 focus:border-purple-500 focus:outline-none"
                              placeholder="Description courte"
                            />
                          </div>
                          {/* Delete */}
                          <button
                            onClick={() => deleteCard(card.id)}
                            className="rounded p-1 text-gray-500 hover:bg-red-600 hover:text-white"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={addCard}
                    disabled={isAddingCard}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-700 bg-gray-800/50 py-2.5 text-xs font-medium text-gray-400 hover:border-purple-500 hover:text-purple-400 disabled:opacity-50"
                  >
                    {isAddingCard ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <>
                        <Sparkles size={14} /> Ajouter une carte IA
                      </>
                    )}
                  </button>
                </div>

                {/* Sales Phrases */}
                {salesPhrases.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-gray-300">
                      Phrases de vente
                    </h3>
                    <div className="space-y-1.5">
                      {salesPhrases.map((phrase, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-2 text-xs text-gray-300"
                        >
                          <span className="text-purple-400">#{i + 1}</span>
                          <input
                            type="text"
                            value={phrase}
                            onChange={(e) => {
                              const updated = [...salesPhrases];
                              updated[i] = e.target.value;
                              setSalesPhrases(updated);
                            }}
                            className="flex-1 bg-transparent text-xs text-gray-300 focus:outline-none"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Next Step → Design */}
                <button
                  onClick={() => setStep(1)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-purple-600 py-3 font-bold text-white hover:bg-purple-700"
                >
                  Design
                  <ChevronRight size={18} />
                </button>
              </>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════ */}
        {/* ═══════════════════════════════════════════════════════ */}
        {/* STEP 1: Design (Simplified — now shows instructions + navigation) */}
        {/* ═══════════════════════════════════════════════════════ */}
        {step === 1 && (
          <div className="space-y-4">
            {/* ── Main Instruction Text ── */}
            <div className="rounded-lg bg-purple-900/20 border border-purple-500/30 px-4 py-3">
              <p className="text-sm text-purple-300 font-medium">
                Double-cliquez sur les éléments dans l'aperçu pour les modifier
                (couleurs, texte, taille...)
              </p>
            </div>

            {/* Navigation */}
            <div className="flex gap-3">
              <button
                onClick={() => setStep(0)}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-gray-700 bg-gray-800 py-2.5 text-sm font-medium text-gray-300 hover:bg-gray-700"
              >
                <ChevronLeft size={16} />
                Contenu
              </button>
              <button
                onClick={() => setStep(2)}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-purple-600 py-2.5 text-sm font-bold text-white hover:bg-purple-700"
              >
                Style
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: Médias & Export Settings (was step 1) */}
        {/* ═══════════════════════════════════════════════════════ */}
        {step === 2 && (
          <div className="space-y-4">
            {/* Batch Count — arrow counter */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-300">
                Nombre d'infographies
              </label>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setBatchCount(Math.max(1, batchCount - 1))}
                  disabled={batchCount <= 1}
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-800 border border-gray-700 text-lg font-bold text-white hover:bg-gray-700 disabled:opacity-30 transition-all"
                >
                  −
                </button>
                <div className="flex items-center justify-center rounded-lg bg-purple-600/20 border border-purple-500/40 px-5 py-1.5 min-w-[60px]">
                  <span className="text-lg font-bold text-purple-400">
                    x{batchCount}
                  </span>
                </div>
                <button
                  onClick={() => setBatchCount(Math.min(10, batchCount + 1))}
                  disabled={batchCount >= 10}
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-800 border border-gray-700 text-lg font-bold text-white hover:bg-gray-700 disabled:opacity-30 transition-all"
                >
                  +
                </button>
                <span className="text-[10px] text-gray-500 ml-1">1 à 10</span>
              </div>
            </div>

            {/* Pexels Photos */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <label className="text-sm font-medium text-gray-300">
                  Photos d'affiche{" "}
                  {pexelsPhotos.length > 0 && `(${pexelsPhotos.length})`}
                </label>
                <button
                  onClick={() => {
                    const query =
                      photoSearchQuery.trim() ||
                      (contentTheme === "personnalise" ? customTopic : "") ||
                      CONTENT_THEMES.find((t) => t.id === contentTheme)
                        ?.pexelsQuery ||
                      CONTENT_THEMES.find((t) => t.id === contentTheme)
                        ?.label ||
                      "fitness";
                    fetchPexelsPhotos(query, true);
                  }}
                  disabled={pexelsLoading}
                  className="flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-purple-400 hover:bg-gray-700"
                >
                  <RefreshCw
                    size={14}
                    className={pexelsLoading ? "animate-spin" : ""}
                  />
                  Régénérer
                </button>
              </div>
              {/* Photo search input */}
              <div className="mb-3 flex gap-2">
                <div className="relative flex-1">
                  <Search
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                  />
                  <input
                    type="text"
                    value={photoSearchQuery}
                    onChange={(e) => setPhotoSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && photoSearchQuery.trim()) {
                        fetchPexelsPhotos(photoSearchQuery.trim(), true);
                      }
                    }}
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                    placeholder="Rechercher des photos... (ex: manioc, yoga, danse)"
                  />
                </div>
                <button
                  onClick={() => {
                    if (photoSearchQuery.trim()) {
                      fetchPexelsPhotos(photoSearchQuery.trim(), true);
                    }
                  }}
                  disabled={pexelsLoading || !photoSearchQuery.trim()}
                  className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                >
                  {pexelsLoading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Search size={16} />
                  )}
                </button>
              </div>
              {pexelsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={24} className="animate-spin text-purple-400" />
                </div>
              ) : pexelsPhotos.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {pexelsPhotos.map((photo, i) => (
                    <button
                      key={photo.id}
                      onClick={() => setSelectedPhotoIndex(i)}
                      className={`relative overflow-hidden rounded-lg transition-all ${
                        selectedPhotoIndex === i
                          ? "ring-2 ring-purple-500"
                          : "opacity-70 hover:opacity-100"
                      }`}
                    >
                      <img
                        src={photo.small}
                        alt={photo.alt}
                        className="aspect-[3/4] w-full object-cover"
                      />
                      {selectedPhotoIndex === i && (
                        <div className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-purple-500">
                          <Check size={12} />
                        </div>
                      )}
                      {batchCount > 1 && i < batchCount && (
                        <div className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          #{i + 1}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center rounded-lg border border-dashed border-gray-700 py-8 text-sm text-gray-500">
                  <ImageIcon size={18} className="mr-2" />
                  Aucune photo chargée
                </div>
              )}
              {batchCount > 1 && pexelsPhotos.length > 0 && (
                <p className="mt-2 text-xs text-gray-500">
                  Chaque infographie du batch utilisera une photo différente
                </p>
              )}
            </div>

            {/* Character Image Upload */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-300">
                Image personnage (optionnel)
              </label>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-700 bg-gray-800 px-4 py-4 hover:border-purple-500 hover:bg-gray-700">
                <Upload size={18} />
                <span className="text-sm text-gray-300">
                  {characterImage ? "Changer l'image" : "Télécharger"}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleCharacterUpload}
                  className="hidden"
                />
              </label>
            </div>

            {/* Video Upload (Médias) */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-300">
                Vidéo de fond (optionnel)
              </label>
              {rushUrl ? (
                <div className="flex items-center gap-3 rounded-lg border border-green-700 bg-green-900/20 px-4 py-3">
                  <Video size={20} className="text-green-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-green-300 truncate">
                      {rushFileName}
                    </p>
                    <p className="text-xs text-green-500">
                      Vidéo prête pour l'export
                    </p>
                  </div>
                  <button
                    onClick={removeVideo}
                    className="rounded p-1 text-gray-400 hover:bg-red-600 hover:text-white"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ) : (
                <label
                  className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed ${
                    isUploadingVideo
                      ? "border-purple-500 bg-purple-900/20"
                      : "border-gray-700 bg-gray-800 hover:border-purple-500 hover:bg-gray-700"
                  } px-4 py-4`}
                >
                  {isUploadingVideo ? (
                    <>
                      <Loader2
                        size={18}
                        className="animate-spin text-purple-400"
                      />
                      <span className="text-sm text-purple-300">
                        Upload en cours...
                      </span>
                    </>
                  ) : (
                    <>
                      <Video size={18} />
                      <span className="text-sm text-gray-300">
                        Ajouter une vidéo
                      </span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="video/*"
                    onChange={handleVideoUpload}
                    disabled={isUploadingVideo}
                    className="hidden"
                  />
                </label>
              )}
              <p className="mt-1 text-xs text-gray-500">
                La vidéo sera utilisée comme fond dans le montage final (max 100
                Mo)
              </p>
            </div>

            {/* Video Overlay Text */}
            {rushUrl && (
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-300">
                  Texte sur la vidéo (optionnel)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={videoOverlayText}
                    onChange={(e) => setVideoOverlayText(e.target.value)}
                    placeholder="Ex: Découvrez les bienfaits du moringa"
                    className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                  />
                  <button
                    onClick={async () => {
                      setIsGeneratingOverlay(true);
                      try {
                        const themeObj = CONTENT_THEMES.find(
                          (t) => t.id === contentTheme,
                        );
                        const topicText =
                          contentTheme === "personnalise"
                            ? customTopic
                            : themeObj?.label || contentTheme;
                        const res = await fetch("/api/content/ai-generate", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            topic: topicText,
                            locale: "fr",
                            cardCount: 0,
                            videoOverlayOnly: true,
                          }),
                        });
                        if (res.ok) {
                          const data = await res.json();
                          if (data.success && data.content?.videoOverlayText) {
                            setVideoOverlayText(data.content.videoOverlayText);
                          } else if (data.success && data.content?.subtitle) {
                            // Fallback: use subtitle as overlay text
                            setVideoOverlayText(data.content.subtitle);
                          }
                        }
                      } catch (err) {
                        console.warn(
                          "[Infographie] AI overlay text generation failed:",
                          err,
                        );
                      } finally {
                        setIsGeneratingOverlay(false);
                      }
                    }}
                    disabled={isGeneratingOverlay}
                    className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
                    title="Générer un texte avec l'IA"
                  >
                    {isGeneratingOverlay ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Sparkles size={16} />
                    )}
                    IA
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Ce texte s'affichera en overlay sur la séquence vidéo dans le
                  montage
                </p>
              </div>
            )}

            {/* Sequence Durations */}
            <div>
              <label className="mb-3 block text-sm font-medium text-gray-300">
                Durée des séquences
              </label>
              <div className="space-y-3">
                {[
                  {
                    label: "🖼️ Affiche (Intro)",
                    value: introDuration,
                    setter: setIntroDuration,
                    min: 2,
                    max: 15,
                  },
                  {
                    label: "📊 Cartes d'Information",
                    value: cardsDuration,
                    setter: setCardsDuration,
                    min: 3,
                    max: 20,
                    disabled: cards.length === 0,
                  },
                  {
                    label: "🎬 Vidéo",
                    value: videoDuration,
                    setter: setVideoDuration,
                    min: 3,
                    max: 60,
                    disabled: !rushUrl,
                  },
                  {
                    label: "📢 CTA",
                    value: ctaDuration,
                    setter: setCtaDuration,
                    min: 2,
                    max: 15,
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className={`flex items-center gap-3 rounded-lg bg-gray-800 px-4 py-2.5 ${item.disabled ? "opacity-40" : ""}`}
                  >
                    <span className="flex-1 text-xs font-medium text-gray-300">
                      {item.label}
                    </span>
                    <button
                      onClick={() =>
                        item.setter(Math.max(item.min, item.value - 1))
                      }
                      disabled={item.disabled || item.value <= item.min}
                      className="flex h-7 w-7 items-center justify-center rounded bg-gray-700 text-sm font-bold text-white hover:bg-gray-600 disabled:opacity-30"
                    >
                      −
                    </button>
                    <span className="w-10 text-center text-sm font-bold text-purple-400">
                      {item.value}s
                    </span>
                    <button
                      onClick={() =>
                        item.setter(Math.min(item.max, item.value + 1))
                      }
                      disabled={item.disabled || item.value >= item.max}
                      className="flex h-7 w-7 items-center justify-center rounded bg-gray-700 text-sm font-bold text-white hover:bg-gray-600 disabled:opacity-30"
                    >
                      +
                    </button>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Durée totale:{" "}
                <span className="font-bold text-purple-400">
                  {introDuration +
                    (cards.length > 0 ? cardsDuration : 0) +
                    (rushUrl ? videoDuration : 0) +
                    ctaDuration}
                  s
                </span>
              </p>
            </div>

            {/* Navigation */}
            <div className="flex gap-3">
              <button
                onClick={() => setStep(1)}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-gray-700 bg-gray-800 py-3 font-medium text-gray-300 hover:bg-gray-700"
              >
                <ChevronLeft size={18} />
                Design
              </button>
              <button
                onClick={() => setStep(3)}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-purple-600 py-3 font-bold text-white hover:bg-purple-700"
              >
                Export
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════ */}
        {/* STEP 3: Export (was step 2) */}
        {/* ═══════════════════════════════════════════════════════ */}
        {step === 3 && (
          <div className="space-y-6">
            {/* Summary */}
            <div className="rounded-lg border border-gray-700 bg-gray-800 p-4">
              <h3 className="mb-3 text-sm font-semibold text-gray-300">
                Résumé
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 text-sm">
                <div>
                  <span className="text-gray-500">Thème:</span>
                  <span className="ml-2 text-white">
                    {CONTENT_THEMES.find((t) => t.id === contentTheme)?.label}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Cartes:</span>
                  <span className="ml-2 text-white">{cards.length}</span>
                </div>
                <div>
                  <span className="text-gray-500">Format:</span>
                  <span className="ml-2 text-white">{format}</span>
                </div>
                <div>
                  <span className="text-gray-500">Batch:</span>
                  <span className="ml-2 text-white">x{batchCount}</span>
                </div>
                <div>
                  <span className="text-gray-500">Photos:</span>
                  <span className="ml-2 text-white">{pexelsPhotos.length}</span>
                </div>
                <div>
                  <span className="text-gray-500">Phrases:</span>
                  <span className="ml-2 text-white">{salesPhrases.length}</span>
                </div>
                <div>
                  <span className="text-gray-500">Vidéo:</span>
                  <span
                    className={`ml-2 ${rushUrl ? "text-green-400" : "text-gray-500"}`}
                  >
                    {rushUrl ? "✓ Prête" : "Aucune"}
                  </span>
                </div>
              </div>
            </div>

            {/* Safety Warning: video source undefined */}
            {rushFileName && !rushUrl && (
              <div className="flex items-start gap-3 rounded-lg border border-yellow-700 bg-yellow-900/20 p-3">
                <AlertTriangle
                  size={18}
                  className="flex-shrink-0 text-yellow-400 mt-0.5"
                />
                <div>
                  <p className="text-sm font-medium text-yellow-300">
                    Source vidéo indéfinie
                  </p>
                  <p className="text-xs text-yellow-500 mt-0.5">
                    La vidéo n'a pas été uploadée correctement. Retournez à
                    l'étape Style pour re-sélectionner le fichier vidéo avant
                    d'exporter.
                  </p>
                </div>
              </div>
            )}

            {/* Destination */}
            <div>
              <label className="mb-3 block text-sm font-medium text-gray-300">
                Destination
              </label>
              <div className="space-y-2">
                {[
                  {
                    value: "draft" as Destination,
                    label: "Calendrier (brouillon)",
                  },
                  { value: "export" as Destination, label: "Export fichier" },
                  { value: "both" as Destination, label: "Les deux" },
                  { value: "audio-studio" as Destination, label: "Studio Son (ajouter musique/voix)" },
                ].map((option) => (
                  <label
                    key={option.value}
                    className="flex items-center gap-3 rounded-lg bg-gray-800 px-4 py-3 cursor-pointer hover:bg-gray-700"
                  >
                    <input
                      type="radio"
                      name="destination"
                      value={option.value}
                      checked={destination === option.value}
                      onChange={(e) =>
                        setDestination(e.target.value as Destination)
                      }
                      className="h-4 w-4 cursor-pointer"
                    />
                    <span className="text-sm text-gray-300">
                      {option.label}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Export Progress */}
            {isExporting && (
              <div className="rounded-lg border border-purple-800 bg-purple-900/20 p-4">
                <div className="mb-2 flex justify-between text-sm">
                  <span className="text-purple-300">Export en cours...</span>
                  <span className="text-purple-400 font-bold">
                    {exportProgress}%
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-700">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"
                    style={{ width: `${exportProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Export Button */}
            <button
              onClick={handleExport}
              disabled={isExporting || cards.length === 0}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-6 py-3 font-bold text-white hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isExporting ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <Zap size={20} />
              )}
              {isExporting
                ? "EXPORT EN COURS..."
                : batchCount > 1
                  ? `EXPORTER ${batchCount} INFOGRAPHIES`
                  : "EXPORTER L'INFOGRAPHIE"}
            </button>
            <div className="text-center text-sm text-gray-400">
              Coût:{" "}
              <span className="font-bold text-yellow-400">
                {25 * batchCount} crédits
              </span>
            </div>

            {/* Back */}
            <button
              onClick={() => setStep(2)}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-700 bg-gray-800 py-2.5 text-sm font-medium text-gray-300 hover:bg-gray-700"
            >
              <ChevronLeft size={16} />
              Retour
            </button>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* Right Panel - Preview */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="hidden lg:flex w-full lg:w-1/2 flex-col items-center border-l-0 lg:border-l border-gray-800 bg-gray-950 p-3 sm:p-6 mt-6 lg:mt-0 lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto">
        <h2 className="mb-3 text-base sm:text-xl font-bold text-white">
          Aperçu Vidéo Finale
        </h2>

        {/* ── Sequence Selector + Play Button ── */}
        <div className="flex items-center gap-1.5 mb-3 flex-wrap justify-center">
          {/* Play/Stop button — reads the montage */}
          <button
            onClick={() => {
              if (isPlaying) { stopPlayback(); setActiveSequence('all'); }
              else startPlayback();
            }}
            className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold transition-all ${
              isPlaying
                ? 'bg-red-600 text-white shadow-lg shadow-red-500/30 animate-pulse'
                : 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-500/30 hover:shadow-purple-500/50'
            }`}
          >
            <span>{isPlaying ? '⏸️' : '▶️'}</span>
            {isPlaying ? 'Stop' : 'Lire'}
          </button>

          {/* Sequence pages */}
          {[
            { key: "titre" as const, label: "Titre", icon: "📝" },
            { key: "cartes" as const, label: "Cartes", icon: "📊" },
            ...(rushUrl
              ? [{ key: "video" as const, label: "Vidéo", icon: "🎥" }]
              : []),
            { key: "cta" as const, label: "CTA", icon: "📢" },
          ].map((seq) => (
            <button
              key={seq.key}
              onClick={() => {
                stopPlayback();
                setActiveSequence(seq.key);
                // Auto-switch left panel to relevant content
                if (seq.key === "cartes") setStep(0);
                else if (seq.key === "video") setStep(2);
              }}
              className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                activeSequence === seq.key
                  ? "bg-purple-600 text-white shadow-lg shadow-purple-500/20"
                  : "bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700"
              }`}
            >
              <span>{seq.icon}</span>
              {seq.label}
            </button>
          ))}
        </div>

        {/* Safe Zone Platform Selector */}
        <div className="flex items-center gap-2 mb-3 rounded-xl bg-gray-800/60 border border-gray-700/50 px-3 py-2 w-full max-w-xs justify-center flex-wrap">
          <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">
            Zones
          </span>
          <div className="flex gap-1.5 flex-wrap justify-center">
            {Object.entries(PLATFORM_SAFE_ZONES).map(([key, zone]) => (
              <PlatformIcon
                key={key}
                platform={zone.platform}
                isActive={safeZonePlatform === key}
                size="sm"
                onClick={() =>
                  setSafeZonePlatform(safeZonePlatform === key ? null : key)
                }
              />
            ))}
          </div>
        </div>

        {/* Preview Container */}
        <div
          className={`relative w-full ${previewClasses.maxW} mx-auto`}
          onClick={() => {
            if (activePanel) setActivePanel(null);
          }}
        >
          <div
            ref={previewRef}
            onDoubleClick={(e) => {
              // Only trigger if clicking on the background, not on an element
              if (e.target === previewRef.current || (e.target as HTMLElement).closest('[data-preview-bg]')) {
                openPanel('add', e);
              }
            }}
            data-preview-bg
            className={`${previewClasses.aspect} relative flex flex-col items-center justify-between rounded-lg ${
              // Show color bg only if not in noColor mode and not in video-only sequence
              (() => {
                const isVideoOnly = activeSequence === "video" && rushUrl;
                const seqNoColor =
                  noColorBg &&
                  (activeSequence === "all" ||
                    noColorSequences.includes(activeSequence));
                return !isVideoOnly && !seqNoColor && activeColorTheme.bg
                  ? `bg-gradient-to-br ${activeColorTheme.bg}`
                  : "";
              })()
            } p-4 shadow-2xl overflow-hidden transition-all duration-300`}
            style={{
              fontFamily: FONT_CSS_MAP[selectedFont] || "inherit",
              ...(() => {
                // Video sequence: dark background so video shows without color tint
                if (activeSequence === "video" && rushUrl) return { background: "#0A0A0F" };
                const seqNoColor =
                  noColorBg &&
                  (activeSequence === "all"
                    ? noColorSequences.length === 4
                    : noColorSequences.includes(activeSequence));
                if (seqNoColor) return { background: "#0A0A0F" };
                if (colorTheme === "custom")
                  return {
                    ...FILTER_CSS_MAP[selectedFilter],
                    background: `linear-gradient(135deg, ${customAccent}, ${customAccent}99)`,
                  };
                return FILTER_CSS_MAP[selectedFilter];
              })(),
            }}
            onMouseMove={(e) => {
              if (!previewRef.current) return;
              const rect = previewRef.current.getBoundingClientRect();
              // Handle resize — use diagonal distance for intuitive scaling
              if (resizing && resizeStart.current) {
                const dx = e.clientX - resizeStart.current.x;
                const dy = e.clientY - resizeStart.current.y;
                const diagonal =
                  Math.sqrt(dx * dx + dy * dy) * Math.sign(dx || dy || 1);
                const deltaPercent =
                  (diagonal / Math.min(rect.width, rect.height)) * 150;
                const newSize = Math.round(
                  Math.max(
                    20,
                    Math.min(100, resizeStart.current.size + deltaPercent),
                  ),
                );
                if (resizing === "title") setTitleSize(newSize);
                else if (resizing === "cards") setCardsSize(newSize);
                else if (resizing === "watermark") setWatermarkSize(newSize);
                else if (resizing === "logo")
                  setLogoScale(
                    Math.max(
                      0.3,
                      Math.min(
                        3.0,
                        resizeStart.current.size + deltaPercent / 50,
                      ),
                    ),
                  );
                return;
              }
              // Handle drag
              if (!dragging) return;
              const x = Math.round(
                Math.max(
                  5,
                  Math.min(95, ((e.clientX - rect.left) / rect.width) * 100),
                ),
              );
              const y = Math.round(
                Math.max(
                  3,
                  Math.min(97, ((e.clientY - rect.top) / rect.height) * 100),
                ),
              );
              if (dragging === "title") setTitlePos({ x, y });
              else if (dragging === "logo") {
                // Update logo position ONLY for the active sequence
                // In 'all' view, update only the first enabled logo sequence (not all)
                // User should switch to a specific sequence to position its logo independently
                if (activeSequence !== 'all') {
                  setLogoPositions(prev => ({ ...prev, [activeSequence]: { x, y } }));
                } else {
                  // In 'all' view, only update the first enabled sequence
                  const firstSeq = logoSequences[0];
                  if (firstSeq) {
                    setLogoPositions(prev => ({ ...prev, [firstSeq]: { x, y } }));
                  }
                }
              }
              else if (dragging === "watermark") setWatermarkPos({ x, y });
              else if (dragging === "cards") setCardsPos({ x, y });
              else if (dragging === "overlay") setOverlayPos({ x, y });
              else if (dragging === "sitetext") {
                // Update siteText position ONLY for the active sequence (same as logo)
                if (activeSequence !== 'all') {
                  setSiteTextPositions(prev => ({ ...prev, [activeSequence]: { x, y } }));
                } else {
                  // In 'all' view, only update the first enabled sequence
                  const firstSeq = siteTextSequences[0];
                  if (firstSeq) {
                    setSiteTextPositions(prev => ({ ...prev, [firstSeq]: { x, y } }));
                  }
                }
              }
            }}
            onMouseUp={() => {
              setDragging(null);
              setResizing(null);
              resizeStart.current = null;
            }}
            onMouseLeave={() => {
              setDragging(null);
              setResizing(null);
              resizeStart.current = null;
            }}
          >
            {/* Background Photo */}
            {previewPhoto &&
              (activeSequence === "all" || activeSequence === "titre") && (
                <img
                  src={previewPhoto.medium}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                  style={{
                    opacity:
                      noColorBg &&
                      (activeSequence === "all"
                        ? noColorSequences.includes("titre")
                        : noColorSequences.includes(activeSequence))
                        ? 0.85
                        : 0.2,
                  }}
                />
              )}

            {/* Video Background (when in video sequence or uploaded video exists) */}
            {rushUrl &&
              (activeSequence === "all" || activeSequence === "video") && (
                <video
                  src={rushUrl}
                  className="absolute inset-0 h-full w-full object-cover"
                  style={{
                    opacity: activeSequence === "video" ? 1 : 0.6,
                  }}
                  autoPlay
                  muted
                  loop
                  playsInline
                  onError={(e) => {
                    (e.target as HTMLVideoElement).style.display = "none";
                  }}
                />
              )}

            {/* Format Badge */}
            <div className="absolute top-2 right-2 rounded-full bg-black/40 px-2.5 py-0.5 text-[10px] font-bold text-white backdrop-blur z-10">
              {format}
            </div>

            {/* Sequence label badge */}
            {activeSequence !== "all" && (
              <div className="absolute top-2 left-2 rounded-full bg-purple-600/80 px-2.5 py-0.5 text-[10px] font-bold text-white backdrop-blur z-10 uppercase">
                {activeSequence}
              </div>
            )}

            {/* ── Gradient Overlay (per-sequence, up to 200%) — double-click for panel ── */}
            {(() => {
              const seqKey = activeSequence === "all" ? "titre" : activeSequence;
              const gradient = getSeqGradient(seqKey);
              if (!gradient.enabled || gradient.opacity <= 0) return null;

              // Generate gradient CSS based on position
              const getGradientCSS = () => {
                const hex1 = `${gradient.color1}${Math.round(Math.min(gradient.opacity, 1) * 255).toString(16).padStart(2, "0")}`;
                const hex2 = `${gradient.color2}${Math.round(Math.min(gradient.opacity, 1) * 255).toString(16).padStart(2, "0")}`;

                switch (gradient.position) {
                  case 'top':
                    return `linear-gradient(180deg, ${gradient.color1}${Math.round(Math.min(gradient.opacity, 1) * 255).toString(16).padStart(2, "0")} 0%, transparent 50%)`;
                  case 'bottom':
                    return `linear-gradient(180deg, transparent 50%, ${gradient.color2}${Math.round(Math.min(gradient.opacity, 1) * 255).toString(16).padStart(2, "0")} 100%)`;
                  case 'left':
                    return `linear-gradient(90deg, ${gradient.color1}${Math.round(Math.min(gradient.opacity, 1) * 255).toString(16).padStart(2, "0")} 0%, transparent 50%)`;
                  case 'right':
                    return `linear-gradient(270deg, ${gradient.color1}${Math.round(Math.min(gradient.opacity, 1) * 255).toString(16).padStart(2, "0")} 0%, transparent 50%)`;
                  case 'both':
                  default:
                    return `linear-gradient(180deg, ${hex1} 0%, transparent 40%, transparent 60%, ${hex2} 100%)`;
                }
              };

              return (
                <>
                  <div
                    className="absolute inset-0 z-[1] cursor-pointer"
                    onDoubleClick={(e) => openPanel("gradient", e)}
                    style={{
                      background: getGradientCSS(),
                    }}
                  />
                  {/* Second layer for >100% intensity */}
                  {gradient.opacity > 1 && (
                    <div
                      className="absolute inset-0 z-[1] pointer-events-none"
                      style={{
                        background: (() => {
                          const hexBg = `${Math.round((gradient.opacity - 1) * 255).toString(16).padStart(2, "0")}`;
                          switch (gradient.position) {
                            case 'top':
                              return `linear-gradient(180deg, ${gradient.color1}${hexBg} 0%, transparent 50%)`;
                            case 'bottom':
                              return `linear-gradient(180deg, transparent 50%, ${gradient.color2}${hexBg} 100%)`;
                            case 'left':
                              return `linear-gradient(90deg, ${gradient.color1}${hexBg} 0%, transparent 50%)`;
                            case 'right':
                              return `linear-gradient(270deg, ${gradient.color1}${hexBg} 0%, transparent 50%)`;
                            case 'both':
                            default:
                              return `linear-gradient(180deg, ${gradient.color1}${hexBg} 0%, transparent 35%, transparent 65%, ${gradient.color2}${hexBg} 100%)`;
                          }
                        })(),
                      }}
                    />
                  )}
                </>
              );
            })()}

            {/* ── TITLE SECTION (visible in all, titre) — drag + double-click for panel ── */}
            {(activeSequence === "all" || activeSequence === "titre") && (
              <div
                className={`absolute z-20 text-center cursor-grab active:cursor-grabbing group/title ${activePanel === "title" ? "ring-1 ring-purple-400 ring-offset-1 ring-offset-transparent rounded" : ""}`}
                style={{
                  left: `${titlePos.x}%`,
                  top: `${titlePos.y}%`,
                  transform: "translate(-50%, 0)",
                  width: `${titleSize}%`,
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setDragging("title");
                }}
                onDoubleClick={(e) => openPanel("title", e)}
              >
                {/* Resize handles — always visible on hover */}
                <div
                  className="absolute -top-1 -left-1 w-2.5 h-2.5 bg-purple-500 rounded-full cursor-nw-resize z-30 border border-white/50 opacity-0 group-hover/title:opacity-100 transition-opacity"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setResizing("title");
                    resizeStart.current = {
                      x: e.clientX,
                      y: e.clientY,
                      size: titleSize,
                    };
                  }}
                />
                <div
                  className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-purple-500 rounded-full cursor-ne-resize z-30 border border-white/50 opacity-0 group-hover/title:opacity-100 transition-opacity"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setResizing("title");
                    resizeStart.current = {
                      x: e.clientX,
                      y: e.clientY,
                      size: titleSize,
                    };
                  }}
                />
                <div className="absolute inset-0 border border-dashed border-purple-500/0 group-hover/title:border-purple-500/40 rounded pointer-events-none transition-colors" />
                {titleDuplicate && (
                  <h3
                    style={{
                      fontSize: `${(format === "16:9" ? 18 : 14) * textScale}px`,
                      letterSpacing: `${titleLetterSpacing}px`,
                      lineHeight: titleLineHeight,
                      fontWeight: titleBold ? 900 : 400,
                      fontStyle: titleItalic ? "italic" : "normal",
                      color: titleColor,
                      position: "absolute",
                      transform: `translate(${titleDuplicateOffset}px, ${titleDuplicateOffset}px)`,
                      opacity: titleDuplicateOpacity,
                      zIndex: -1,
                    }}
                  >
                    {title || "TITRE"}
                  </h3>
                )}
                <h3
                  className="font-black drop-shadow-lg"
                  style={{
                    fontSize: `${(format === "16:9" ? 18 : 14) * textScale}px`,
                    letterSpacing: `${titleLetterSpacing}px`,
                    lineHeight: titleLineHeight,
                    fontWeight: titleBold ? 900 : 400,
                    fontStyle: titleItalic ? "italic" : "normal",
                    ...(titleTextGradient ? {
                      background: `linear-gradient(135deg, ${titleGradColor1}, ${titleGradColor2})`,
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                      backgroundClip: "text",
                    } : {
                      color: titleColor,
                    }),
                  }}
                >
                  {title || "TITRE"}
                </h3>
                {subtitle && (
                  <p
                    className="mt-1 drop-shadow"
                    style={{
                      fontSize: `${(format === "16:9" ? 11 : 9) * textScale}px`,
                      color: `${titleColor}cc`,
                      letterSpacing: `${titleLetterSpacing}px`,
                      lineHeight: titleLineHeight,
                      fontWeight: titleBold ? 900 : 400,
                      fontStyle: titleItalic ? "italic" : "normal",
                    }}
                  >
                    {subtitle}
                  </p>
                )}
              </div>
            )}

            {/* ── VIDEO OVERLAY TEXT (visible in video sequence) — draggable, no bg ── */}
            {rushUrl &&
              (activeSequence === "all" || activeSequence === "video") &&
              videoOverlayText && (
                <div
                  className={`absolute z-20 text-center cursor-grab active:cursor-grabbing group/overlay ${activePanel === "overlay" ? "ring-1 ring-cyan-400 ring-offset-1 ring-offset-transparent rounded" : ""}`}
                  style={{
                    left: `${overlayPos.x}%`,
                    top: `${overlayPos.y}%`,
                    transform: "translate(-50%, -50%)",
                    width: "85%",
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setDragging("overlay");
                  }}
                  onDoubleClick={(e) => openPanel("overlay", e)}
                >
                  <div className="absolute inset-0 border border-dashed border-cyan-500/0 group-hover/overlay:border-cyan-500/40 rounded pointer-events-none transition-colors" />
                  <p
                    className="font-black text-white drop-shadow-lg"
                    style={{
                      fontSize: `${16 * textScale}px`,
                      textShadow:
                        "0 2px 8px rgba(0,0,0,0.8), 0 0 20px rgba(0,0,0,0.5)",
                      letterSpacing: `${overlayLetterSpacing}px`,
                      lineHeight: overlayLineHeight,
                      fontWeight: overlayBold ? "bold" : "normal",
                      fontStyle: overlayItalic ? "italic" : "normal",
                    }}
                  >
                    {videoOverlayText}
                  </p>
                </div>
              )}

            {/* ── CARDS GRID (visible in all, cartes) — drag + double-click for panel ── */}
            {(activeSequence === "all" || activeSequence === "cartes") &&
              cards.length > 0 && (
                <div
                  className={`absolute z-20 cursor-grab active:cursor-grabbing group/cards ${activePanel === "cards" ? "ring-1 ring-pink-400 ring-offset-1 ring-offset-transparent rounded" : ""}`}
                  style={{
                    left: `${cardsPos.x}%`,
                    top: `${cardsPos.y}%`,
                    transform: "translate(-50%, -50%)",
                    width: `${cardsSize}%`,
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setDragging("cards");
                  }}
                  onDoubleClick={(e) => openPanel("cards", e)}
                >
                  {/* Resize handles — larger and always visible for easier interaction */}
                  <div
                    className="absolute -top-2 -right-2 w-4 h-4 bg-pink-500 rounded-full cursor-ne-resize z-30 border-2 border-white/70 shadow-lg shadow-pink-500/30"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setResizing("cards");
                      resizeStart.current = {
                        x: e.clientX,
                        y: e.clientY,
                        size: cardsSize,
                      };
                    }}
                  />
                  <div
                    className="absolute -bottom-2 -right-2 w-4 h-4 bg-pink-500 rounded-full cursor-se-resize z-30 border-2 border-white/70 shadow-lg shadow-pink-500/30"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setResizing("cards");
                      resizeStart.current = {
                        x: e.clientX,
                        y: e.clientY,
                        size: cardsSize,
                      };
                    }}
                  />
                  <div className="absolute inset-0 border border-dashed border-pink-500/30 group-hover/cards:border-pink-500/60 rounded pointer-events-none transition-colors" />
                  <div
                    className={`grid gap-1.5 w-full ${
                      selectedCardStyle === "Full Width"
                        ? "grid-cols-1"
                        : previewClasses.cols
                    }`}
                  >
                    {cards.slice(0, format === "16:9" ? 6 : 5).map((card) => {
                      const scaledLabel = `${Math.round(7 * textScale)}px`;
                      const scaledValue = `${Math.round(9 * textScale)}px`;
                      const scaledDesc = `${Math.round(6 * textScale)}px`;
                      // ── Compact ──
                      if (selectedCardStyle === "Compact") {
                        return (
                          <div
                            key={card.id}
                            className="flex flex-col items-center gap-0.5 rounded-lg bg-black/30 px-1.5 py-1.5 backdrop-blur-sm"
                            style={{ borderLeft: `2px solid ${card.color}` }}
                          >
                            <span
                              className={
                                format === "16:9" ? "text-lg" : "text-sm"
                              }
                            >
                              {card.emoji}
                            </span>
                            <p
                              className="text-center font-bold text-white drop-shadow"
                              style={{ fontSize: scaledLabel }}
                            >
                              {card.label}
                            </p>
                            <p
                              className="text-center font-black drop-shadow"
                              style={{
                                fontSize: scaledValue,
                                color: card.color,
                              }}
                            >
                              {card.value}
                            </p>
                            {card.description && (
                              <p
                                className="text-center text-white/60"
                                style={{ fontSize: scaledDesc }}
                              >
                                {card.description.substring(0, 30)}
                              </p>
                            )}
                          </div>
                        );
                      }
                      // ── Educatif ──
                      if (selectedCardStyle === "Educatif") {
                        return (
                          <div
                            key={card.id}
                            className="rounded-lg bg-black/40 px-2 py-2 backdrop-blur-sm"
                            style={{ borderTop: `2px solid ${card.color}` }}
                          >
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className="text-sm">{card.emoji}</span>
                              <p
                                className="font-bold text-white"
                                style={{ fontSize: scaledLabel }}
                              >
                                {card.label}
                              </p>
                            </div>
                            <p
                              className="text-white/70 leading-relaxed mb-1"
                              style={{ fontSize: scaledDesc }}
                            >
                              {card.description?.substring(0, 60) || ""}
                            </p>
                            <p
                              className="font-black"
                              style={{
                                fontSize: scaledValue,
                                color: card.color,
                              }}
                            >
                              {card.value}
                            </p>
                          </div>
                        );
                      }
                      // ── Stats Bold ──
                      if (selectedCardStyle === "Stats Bold") {
                        return (
                          <div
                            key={card.id}
                            className="flex flex-col items-center justify-center rounded-lg bg-black/50 px-2 py-2 backdrop-blur-sm border border-white/10"
                          >
                            <p
                              className="font-black drop-shadow"
                              style={{
                                fontSize: `${Math.round(13 * textScale)}px`,
                                color: card.color,
                              }}
                            >
                              {card.value}
                            </p>
                            <p
                              className="font-medium text-white/80 mt-0.5 text-center"
                              style={{ fontSize: scaledDesc }}
                            >
                              {card.label}
                            </p>
                          </div>
                        );
                      }
                      // ── Minimal Line ──
                      if (selectedCardStyle === "Minimal Line") {
                        return (
                          <div
                            key={card.id}
                            className="flex items-center gap-2 py-1 px-1"
                            style={{
                              borderBottom: `1px solid ${card.color}40`,
                            }}
                          >
                            <span className="text-xs">{card.emoji}</span>
                            <p
                              className="text-white/80 flex-1"
                              style={{ fontSize: scaledLabel }}
                            >
                              {card.label}
                            </p>
                            <p
                              className="font-bold"
                              style={{
                                fontSize: scaledValue,
                                color: card.color,
                              }}
                            >
                              {card.value}
                            </p>
                          </div>
                        );
                      }
                      // ── Full Width ──
                      return (
                        <div
                          key={card.id}
                          className="flex items-center gap-2 rounded-lg bg-black/30 px-3 py-1.5 backdrop-blur-sm"
                          style={{ borderLeft: `3px solid ${card.color}` }}
                        >
                          <span className="text-base">{card.emoji}</span>
                          <div className="flex-1 min-w-0">
                            <p
                              className="font-bold text-white truncate"
                              style={{ fontSize: scaledLabel }}
                            >
                              {card.label}
                            </p>
                            {card.description && (
                              <p
                                className="text-white/50 truncate"
                                style={{ fontSize: scaledDesc }}
                              >
                                {card.description.substring(0, 40)}
                              </p>
                            )}
                          </div>
                          <p
                            className="font-black flex-shrink-0"
                            style={{ fontSize: scaledValue, color: card.color }}
                          >
                            {card.value}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

            {/* ── CTA / WATERMARK (visible in all, cta) — drag + double-click for panel ── */}
            {(activeSequence === "all" || activeSequence === "cta") && (
              <div
                className={`absolute z-20 text-center cursor-grab active:cursor-grabbing group/cta ${activePanel === "cta" ? "ring-1 ring-yellow-400 ring-offset-1 ring-offset-transparent rounded" : ""}`}
                style={{
                  left: `${watermarkPos.x}%`,
                  top: `${watermarkPos.y}%`,
                  transform: "translate(-50%, -100%)",
                  width: `${watermarkSize}%`,
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setDragging("watermark");
                }}
                onDoubleClick={(e) => openPanel("cta", e)}
              >
                {/* Resize handles — visible on hover */}
                <div
                  className="absolute -bottom-1 -left-1 w-2.5 h-2.5 bg-yellow-500 rounded-full cursor-sw-resize z-30 border border-white/50 opacity-0 group-hover/cta:opacity-100 transition-opacity"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setResizing("watermark");
                    resizeStart.current = {
                      x: e.clientX,
                      y: e.clientY,
                      size: watermarkSize,
                    };
                  }}
                />
                <div
                  className="absolute -bottom-1 -right-1 w-2.5 h-2.5 bg-yellow-500 rounded-full cursor-se-resize z-30 border border-white/50 opacity-0 group-hover/cta:opacity-100 transition-opacity"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setResizing("watermark");
                    resizeStart.current = {
                      x: e.clientX,
                      y: e.clientY,
                      size: watermarkSize,
                    };
                  }}
                />
                <div className="absolute inset-0 border border-dashed border-yellow-500/0 group-hover/cta:border-yellow-500/40 rounded pointer-events-none transition-colors" />
                {salesPhrases.length > 0 && (
                  <p
                    className="font-medium drop-shadow"
                    style={{
                      fontSize: `${(format === "16:9" ? 10 : 8) * ctaTextScale}px`,
                      color: `${ctaColor}ee`,
                      letterSpacing: `${ctaLetterSpacing}px`,
                      lineHeight: ctaLineHeight,
                      fontWeight: ctaBold ? 900 : 400,
                      fontStyle: ctaItalic ? "italic" : "normal",
                    }}
                  >
                    {salesPhrases[0]}
                  </p>
                )}
                <p
                  className="mt-0.5 font-black drop-shadow-lg uppercase"
                  style={{
                    fontSize: `${(format === "16:9" ? 16 : 12) * ctaTextScale}px`,
                    color: ctaColor,
                    letterSpacing: `${ctaLetterSpacing}px`,
                    lineHeight: ctaLineHeight,
                    fontWeight: ctaBold ? 900 : 400,
                    fontStyle: ctaItalic ? "italic" : "normal",
                  }}
                >
                  {ctaMainText || "AFROBOOST"}
                </p>
                <p
                  className="font-bold drop-shadow mt-1 uppercase"
                  style={{
                    fontSize: `${(format === "16:9" ? 12 : 9) * ctaTextScale}px`,
                    color: ctaSubColor,
                    letterSpacing: `${ctaLetterSpacing}px`,
                    lineHeight: ctaLineHeight,
                    fontWeight: ctaBold ? 900 : 400,
                    fontStyle: ctaItalic ? "italic" : "normal",
                  }}
                >
                  {ctaSubText || "CHAT POUR PLUS D'INFOS"}
                </p>
              </div>
            )}

            {/* ── LOGO (draggable, resizable, per-sequence position) ── */}
            {logoImage &&
              (activeSequence === "all" ||
                logoSequences.includes(activeSequence)) && (
                <div
                  className={`absolute z-20 cursor-grab active:cursor-grabbing group/logo ${activePanel === "logo" ? "ring-1 ring-green-400 ring-offset-1 ring-offset-transparent rounded" : ""}`}
                  style={{
                    left: `${logoPos.x}%`,
                    top: `${logoPos.y}%`,
                    transform: `translate(-50%, -50%) scale(${logoScale})`,
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setDragging("logo");
                  }}
                  onDoubleClick={(e) => openPanel("logo", e)}
                  title={activeSequence === 'all'
                    ? `Logo — vue globale (déplace ${logoSequences[0] || 'titre'}). Sélectionnez une séquence pour positionner indépendamment.`
                    : `Logo — position pour "${activeSequence}"`}
                >
                  <div className="absolute inset-0 border border-dashed border-green-500/0 group-hover/logo:border-green-500/40 rounded pointer-events-none transition-colors" />
                  {/* Indicator: which sequence this logo position belongs to */}
                  <div className="absolute -top-5 left-1/2 -translate-x-1/2 opacity-0 group-hover/logo:opacity-100 transition-opacity pointer-events-none">
                    <span className="text-[8px] font-bold bg-green-600/90 text-white px-1.5 py-0.5 rounded whitespace-nowrap">
                      {activeSequence === 'all' ? (logoSequences[0] || 'titre') : activeSequence}
                    </span>
                  </div>
                  <div
                    className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-green-500 rounded-full cursor-ne-resize z-30 border border-white/50 opacity-0 group-hover/logo:opacity-100 transition-opacity"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setResizing("logo");
                      resizeStart.current = {
                        x: e.clientX,
                        y: e.clientY,
                        size: logoScale,
                      };
                    }}
                  />
                  <div
                    className="absolute -bottom-1 -right-1 w-2.5 h-2.5 bg-green-500 rounded-full cursor-se-resize z-30 border border-white/50 opacity-0 group-hover/logo:opacity-100 transition-opacity"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setResizing("logo");
                      resizeStart.current = {
                        x: e.clientX,
                        y: e.clientY,
                        size: logoScale,
                      };
                    }}
                  />
                  <img
                    src={logoImage}
                    alt="Logo"
                    className="h-8 w-auto max-w-[60px] object-contain drop-shadow-lg"
                  />
                </div>
              )}

            {/* Character Image */}
            {characterImage &&
              (activeSequence === "all" || activeSequence === "titre") && (
                <img
                  src={characterImage}
                  alt="Character"
                  className="absolute bottom-2 right-2 h-1/4 w-auto rounded z-10"
                />
              )}

            {/* ── Site Text (e.g. Afroboost.com) — draggable, per-sequence, double-click for panel ── */}
            {siteTextEnabled && siteText && (
              activeSequence === "all"
                ? siteTextSequences.length > 0
                : siteTextSequences.includes(activeSequence)
            ) && (
              <div
                className={`absolute z-20 cursor-grab active:cursor-grabbing group/sitetext ${activePanel === "sitetext" ? "ring-1 ring-cyan-400 ring-offset-1 ring-offset-transparent rounded" : ""}`}
                style={{
                  left: `${siteTextPos.x}%`,
                  top: `${siteTextPos.y}%`,
                  transform: "translate(-50%, -50%)",
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setDragging("sitetext");
                }}
                onDoubleClick={(e) => openPanel("sitetext", e)}
              >
                <div className="absolute inset-0 border border-dashed border-cyan-500/0 group-hover/sitetext:border-cyan-500/40 rounded pointer-events-none transition-colors" />
                <p
                  className="font-bold tracking-wider whitespace-nowrap drop-shadow-lg"
                  style={{
                    fontSize: `${12 * siteTextSize}px`,
                    color: siteTextColor,
                    opacity: siteTextOpacity,
                    textShadow: `0 0 10px ${siteTextColor}40, 0 2px 4px rgba(0,0,0,0.8)`,
                  }}
                >
                  {siteText}
                </p>
              </div>
            )}

            {/* Safe Zone Overlay (pointer-events: none, does not affect interactions) */}
            {safeZonePlatform && PLATFORM_SAFE_ZONES[safeZonePlatform] && (
              <div className="absolute inset-0 z-50 pointer-events-none">
                {PLATFORM_SAFE_ZONES[safeZonePlatform].zones.map(
                  (zone: SafeZoneArea, i: number) => (
                    <div
                      key={i}
                      className="absolute"
                      style={{
                        top: zone.top || "auto",
                        right: zone.right || "auto",
                        bottom: zone.bottom || "auto",
                        left: zone.left || "auto",
                        width: zone.width,
                        height: zone.height,
                        border: `1.5px dashed ${PLATFORM_SAFE_ZONES[safeZonePlatform].overlayColor}`,
                        borderRadius: "4px",
                        background: `${PLATFORM_SAFE_ZONES[safeZonePlatform].overlayColor}10`,
                      }}
                    >
                      <span
                        className="absolute top-0.5 left-1 text-[7px] font-bold uppercase tracking-wider"
                        style={{
                          color:
                            PLATFORM_SAFE_ZONES[safeZonePlatform].overlayColor,
                        }}
                      >
                        {zone.label}
                      </span>
                    </div>
                  ),
                )}
              </div>
            )}

            {/* Empty state for video sequence when no video uploaded */}
            {activeSequence === "video" && !rushUrl && (
              <div
                className="absolute inset-0 z-20 flex items-center justify-center cursor-pointer"
                onDoubleClick={(e) => openPanel("overlay", e)}
              >
                <div className="text-center text-white/50">
                  <Video size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-xs">Aucune vidéo uploadée</p>
                </div>
              </div>
            )}

            {/* Clickable zone to add overlay text when empty */}
            {(activeSequence === "all" || activeSequence === "video") &&
              rushUrl &&
              !videoOverlayText && (
                <div
                  className="absolute z-20 cursor-pointer rounded-lg border border-dashed border-white/20 px-4 py-2 hover:border-white/40 transition-colors"
                  style={{
                    left: "50%",
                    top: "33%",
                    transform: "translate(-50%, -50%)",
                  }}
                  onDoubleClick={(e) => openPanel("overlay", e)}
                >
                  <span className="text-[10px] text-white/40">
                    Double-clic = ajouter texte
                  </span>
                </div>
              )}

            {/* Hint: double-click to open controls */}
            <div className="absolute bottom-1 inset-x-0 text-center z-[60] pointer-events-none">
              <span className="text-[8px] text-white/30 bg-black/20 rounded px-1.5 py-0.5">
                Double-clic sur un élément = réglages
              </span>
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════ */}
        {/* FLOATING PANELS — contextual controls per element  */}
        {/* ═══════════════════════════════════════════════════ */}

        {/* ── Title Panel ── */}
        <FloatingPanel
          title="Titre"
          icon="📝"
          isOpen={activePanel === "title"}
          onClose={() => setActivePanel(null)}
          initialX={panelPos.x}
          initialY={panelPos.y}
        >
          <div className="space-y-2">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-white focus:border-purple-500 focus:outline-none"
              placeholder="Titre principal"
            />
            <input
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-white focus:border-purple-500 focus:outline-none"
              placeholder="Sous-titre"
            />
            <div>
              <span className="text-[9px] text-gray-500 uppercase">Police</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {FONT_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    onClick={() => setSelectedFont(opt.label)}
                    className={`px-2 py-1 rounded text-[9px] font-medium transition-all ${
                      selectedFont === opt.label
                        ? "bg-purple-600 text-white"
                        : "bg-gray-800 text-gray-400 hover:text-white"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <ColorWheel
              color={titleColor}
              onChange={setTitleColor}
              label="Couleur"
            />
            <div>
              <span className="text-[9px] text-gray-500 uppercase">
                Taille {Math.round(textScale * 100)}%
              </span>
              <input
                type="range"
                min="0.5"
                max="3.0"
                step="0.05"
                value={textScale}
                onChange={(e) => setTextScale(parseFloat(e.target.value))}
                className="w-full h-1.5 rounded-lg appearance-none bg-gray-700 accent-purple-500 cursor-pointer mt-1"
              />
            </div>
            {/* Typography */}
            <div className="flex gap-1 mt-1">
              <button
                onClick={() => setTitleBold(!titleBold)}
                className={`px-2 py-1 rounded text-[10px] font-bold transition-all ${titleBold ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-400"}`}
              >
                B
              </button>
              <button
                onClick={() => setTitleItalic(!titleItalic)}
                className={`px-2 py-1 rounded text-[10px] italic transition-all ${titleItalic ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-400"}`}
              >
                I
              </button>
            </div>
            <div>
              <span className="text-[9px] text-gray-500 uppercase">
                Espacement {titleLetterSpacing}px
              </span>
              <input
                type="range"
                min="-2"
                max="15"
                step="0.5"
                value={titleLetterSpacing}
                onChange={(e) =>
                  setTitleLetterSpacing(parseFloat(e.target.value))
                }
                className="w-full h-1.5 rounded-lg appearance-none bg-gray-700 accent-purple-500 cursor-pointer mt-1"
              />
            </div>
            <div>
              <span className="text-[9px] text-gray-500 uppercase">
                Interligne {titleLineHeight.toFixed(1)}
              </span>
              <input
                type="range"
                min="0.8"
                max="2.5"
                step="0.1"
                value={titleLineHeight}
                onChange={(e) => setTitleLineHeight(parseFloat(e.target.value))}
                className="w-full h-1.5 rounded-lg appearance-none bg-gray-700 accent-purple-500 cursor-pointer mt-1"
              />
            </div>

            {/* Text gradient effect */}
            <div className="mt-2 pt-2 border-t border-gray-800">
              <label className="flex items-center gap-2 cursor-pointer mb-2">
                <input
                  type="checkbox"
                  checked={titleTextGradient}
                  onChange={(e) => setTitleTextGradient(e.target.checked)}
                  className="accent-purple-500"
                />
                <span className="text-[9px] text-gray-400 uppercase">Dégradé sur texte</span>
              </label>
              {titleTextGradient && (
                <div className="space-y-1">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <span className="text-[8px] text-gray-500">Couleur 1</span>
                      <input type="color" value={titleGradColor1} onChange={(e) => setTitleGradColor1(e.target.value)} className="w-full h-6 rounded cursor-pointer bg-transparent" />
                    </div>
                    <div className="flex-1">
                      <span className="text-[8px] text-gray-500">Couleur 2</span>
                      <input type="color" value={titleGradColor2} onChange={(e) => setTitleGradColor2(e.target.value)} className="w-full h-6 rounded cursor-pointer bg-transparent" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Duplicate text effect */}
            <div className="mt-2 pt-2 border-t border-gray-800">
              <label className="flex items-center gap-2 cursor-pointer mb-2">
                <input
                  type="checkbox"
                  checked={titleDuplicate}
                  onChange={(e) => setTitleDuplicate(e.target.checked)}
                  className="accent-purple-500"
                />
                <span className="text-[9px] text-gray-400 uppercase">Dupliquer le texte</span>
              </label>
              {titleDuplicate && (
                <div className="space-y-1">
                  <span className="text-[8px] text-gray-500">Décalage</span>
                  <input type="range" min="1" max="20" value={titleDuplicateOffset} onChange={(e) => setTitleDuplicateOffset(parseInt(e.target.value))} className="w-full" />
                  <span className="text-[8px] text-gray-500">Opacité: {Math.round(titleDuplicateOpacity * 100)}%</span>
                  <input type="range" min="0.1" max="1" step="0.05" value={titleDuplicateOpacity} onChange={(e) => setTitleDuplicateOpacity(parseFloat(e.target.value))} className="w-full" />
                </div>
              )}
            </div>
          </div>
        </FloatingPanel>

        {/* ── Cards Panel ── */}
        <FloatingPanel
          title="Cartes"
          icon="📊"
          isOpen={activePanel === "cards"}
          onClose={() => setActivePanel(null)}
          initialX={panelPos.x}
          initialY={panelPos.y}
          accentColor="#EC4899"
        >
          <div className="space-y-2">
            <div>
              <span className="text-[9px] text-gray-500 uppercase">Style</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {CARD_STYLE_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    onClick={() => setSelectedCardStyle(opt.label)}
                    className={`px-2 py-1 rounded text-[9px] font-medium transition-all ${
                      selectedCardStyle === opt.label
                        ? "bg-pink-600 text-white"
                        : "bg-gray-800 text-gray-400 hover:text-white"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="text-[9px] text-gray-500 uppercase">
                Taille {cardsSize}%
              </span>
              <input
                type="range"
                min="30"
                max="100"
                step="1"
                value={cardsSize}
                onChange={(e) => setCardsSize(parseInt(e.target.value))}
                className="w-full h-1.5 rounded-lg appearance-none bg-gray-700 accent-pink-500 cursor-pointer mt-1"
              />
            </div>
            <div>
              <span className="text-[9px] text-gray-500 uppercase">Filtre</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {FILTER_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    onClick={() => setSelectedFilter(opt.label)}
                    className={`px-2 py-1 rounded text-[9px] font-medium transition-all ${
                      selectedFilter === opt.label
                        ? "bg-pink-600 text-white"
                        : "bg-gray-800 text-gray-400 hover:text-white"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </FloatingPanel>

        {/* ── CTA Panel ── */}
        <FloatingPanel
          title="CTA"
          icon="📢"
          isOpen={activePanel === "cta"}
          onClose={() => setActivePanel(null)}
          initialX={panelPos.x}
          initialY={panelPos.y}
          accentColor="#EAB308"
        >
          <div className="space-y-2">
            <input
              type="text"
              value={ctaMainText}
              onChange={(e) => setCtaMainText(e.target.value)}
              className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-white focus:border-purple-500 focus:outline-none"
              placeholder="Nom de marque"
            />
            <div className="flex gap-1">
              <input
                type="text"
                value={ctaSubText}
                onChange={(e) => setCtaSubText(e.target.value)}
                className="flex-1 rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-white focus:border-purple-500 focus:outline-none"
                placeholder="Call-to-action"
              />
              <button
                onClick={async () => {
                  setIsGeneratingCta(true);
                  try {
                    const themeObj = CONTENT_THEMES.find(
                      (t) => t.id === contentTheme,
                    );
                    const topicText =
                      contentTheme === "personnalise"
                        ? customTopic
                        : themeObj?.label || contentTheme;
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 8000);
                    const res = await fetch("/api/content/ai-generate", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        topic: topicText,
                        locale: "fr",
                        cardCount: 1,
                      }),
                      signal: controller.signal,
                    });
                    clearTimeout(timeout);
                    if (res.ok) {
                      const data = await res.json();
                      if (data.success && data.content) {
                        const phrases = data.content.salesPhrases || [];
                        if (phrases.length > 0)
                          setCtaSubText(phrases[0].toUpperCase());
                        else if (data.content.subtitle)
                          setCtaSubText(data.content.subtitle.toUpperCase());
                        if (data.content.title)
                          setCtaMainText(data.content.title.toUpperCase());
                      }
                    }
                  } catch {
                    const fallbacks = [
                      "DÉCOUVRIR MAINTENANT",
                      "EN SAVOIR PLUS",
                      "COMMENCER AUJOURD'HUI",
                      "REJOINS-NOUS",
                    ];
                    setCtaSubText(
                      fallbacks[Math.floor(Math.random() * fallbacks.length)],
                    );
                  } finally {
                    setIsGeneratingCta(false);
                  }
                }}
                disabled={isGeneratingCta}
                className="flex items-center justify-center rounded bg-purple-600 px-2 py-1.5 text-white hover:bg-purple-500 disabled:opacity-50"
              >
                {isGeneratingCta ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Sparkles size={12} />
                )}
              </button>
            </div>
            <ColorWheel
              color={ctaColor}
              onChange={setCtaColor}
              label="Couleur titre"
            />
            <ColorWheel
              color={ctaSubColor}
              onChange={setCtaSubColor}
              label="Couleur sous-texte"
            />
            <div>
              <span className="text-[9px] text-gray-500 uppercase">
                Taille {Math.round(ctaTextScale * 100)}%
              </span>
              <input
                type="range"
                min="0.5"
                max="3.0"
                step="0.05"
                value={ctaTextScale}
                onChange={(e) => setCtaTextScale(parseFloat(e.target.value))}
                className="w-full h-1.5 rounded-lg appearance-none bg-gray-700 accent-yellow-500 cursor-pointer mt-1"
              />
            </div>
            {/* Typography */}
            <div className="flex gap-1 mt-1">
              <button
                onClick={() => setCtaBold(!ctaBold)}
                className={`px-2 py-1 rounded text-[10px] font-bold transition-all ${ctaBold ? "bg-yellow-600 text-white" : "bg-gray-800 text-gray-400"}`}
              >
                B
              </button>
              <button
                onClick={() => setCtaItalic(!ctaItalic)}
                className={`px-2 py-1 rounded text-[10px] italic transition-all ${ctaItalic ? "bg-yellow-600 text-white" : "bg-gray-800 text-gray-400"}`}
              >
                I
              </button>
            </div>
            <div>
              <span className="text-[9px] text-gray-500 uppercase">
                Espacement {ctaLetterSpacing}px
              </span>
              <input
                type="range"
                min="-2"
                max="15"
                step="0.5"
                value={ctaLetterSpacing}
                onChange={(e) =>
                  setCtaLetterSpacing(parseFloat(e.target.value))
                }
                className="w-full h-1.5 rounded-lg appearance-none bg-gray-700 accent-yellow-500 cursor-pointer mt-1"
              />
            </div>
            <div>
              <span className="text-[9px] text-gray-500 uppercase">
                Interligne {ctaLineHeight.toFixed(1)}
              </span>
              <input
                type="range"
                min="0.8"
                max="2.5"
                step="0.1"
                value={ctaLineHeight}
                onChange={(e) => setCtaLineHeight(parseFloat(e.target.value))}
                className="w-full h-1.5 rounded-lg appearance-none bg-gray-700 accent-yellow-500 cursor-pointer mt-1"
              />
            </div>
          </div>
        </FloatingPanel>

        {/* ── Gradient Panel ── */}
        <FloatingPanel
          title="Dégradé"
          icon="🌈"
          isOpen={activePanel === "gradient"}
          onClose={() => setActivePanel(null)}
          initialX={panelPos.x}
          initialY={panelPos.y}
          accentColor="#7C3AED"
        >
          {(() => {
            const seqKey = activeSequence === "all" ? "titre" : activeSequence;
            const currentGradient = getSeqGradient(seqKey);
            const isGlobal = activeSequence === "all";

            return (
              <div className="space-y-3">
                {/* Mode indicator */}
                {!isGlobal && (
                  <div className="text-[9px] text-purple-300 font-semibold uppercase bg-purple-900/30 px-2 py-1 rounded">
                    Mode: {seqKey}
                  </div>
                )}

                {/* Enable/Disable toggle */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={currentGradient.enabled}
                    onChange={(e) => {
                      setSeqGradients({
                        ...seqGradients,
                        [seqKey]: { ...seqGradients[seqKey], enabled: e.target.checked },
                      });
                    }}
                    className="w-4 h-4 accent-purple-500"
                  />
                  <span className="text-[10px] font-semibold text-gray-300 uppercase">
                    Activer le dégradé
                  </span>
                </label>

                {currentGradient.enabled && (
                  <>
                    {/* Color selectors */}
                    <ColorWheel
                      color={currentGradient.color1}
                      onChange={(color) => {
                        setSeqGradients({
                          ...seqGradients,
                          [seqKey]: { ...seqGradients[seqKey], color1: color },
                        });
                      }}
                      label="Couleur 1"
                    />
                    <ColorWheel
                      color={currentGradient.color2}
                      onChange={(color) => {
                        setSeqGradients({
                          ...seqGradients,
                          [seqKey]: { ...seqGradients[seqKey], color2: color },
                        });
                      }}
                      label="Couleur 2"
                    />

                    {/* Position selector */}
                    <div>
                      <span className="text-[9px] text-gray-500 uppercase block mb-1.5">
                        Position
                      </span>
                      <select
                        value={currentGradient.position}
                        onChange={(e) => {
                          setSeqGradients({
                            ...seqGradients,
                            [seqKey]: { ...seqGradients[seqKey], position: e.target.value as any },
                          });
                        }}
                        className="w-full px-2 py-1.5 bg-gray-700 text-gray-100 rounded text-[9px] font-semibold border border-gray-600 focus:border-purple-500 focus:outline-none"
                      >
                        <option value="both">Haut & Bas</option>
                        <option value="top">Haut</option>
                        <option value="bottom">Bas</option>
                        <option value="left">Gauche</option>
                        <option value="right">Droite</option>
                      </select>
                    </div>

                    {/* Intensity slider */}
                    <div>
                      <span className="text-[9px] text-gray-500 uppercase">
                        Intensité {Math.round(currentGradient.opacity * 100)}%
                      </span>
                      <input
                        type="range"
                        min="0"
                        max="2.0"
                        step="0.05"
                        value={currentGradient.opacity}
                        onChange={(e) => {
                          setSeqGradients({
                            ...seqGradients,
                            [seqKey]: { ...seqGradients[seqKey], opacity: parseFloat(e.target.value) },
                          });
                        }}
                        className="w-full h-1.5 rounded-lg appearance-none bg-gray-700 accent-purple-500 cursor-pointer mt-1"
                      />
                    </div>

                    {/* Apply to all sequences button */}
                    {!isGlobal && (
                      <button
                        onClick={() => {
                          const newGradients: Record<string, any> = {};
                          ["titre", "cartes", "video", "cta"].forEach((seq) => {
                            newGradients[seq] = {
                              enabled: currentGradient.enabled,
                              color1: currentGradient.color1,
                              color2: currentGradient.color2,
                              opacity: currentGradient.opacity,
                              position: currentGradient.position,
                            };
                          });
                          setSeqGradients(newGradients);
                        }}
                        className="w-full px-2 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-[9px] font-bold rounded transition-colors uppercase"
                      >
                        Appliquer à toutes
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })()}
        </FloatingPanel>

        {/* ── Logo Panel ── */}
        <FloatingPanel
          title="Logo"
          icon="🎯"
          isOpen={activePanel === "logo"}
          onClose={() => setActivePanel(null)}
          initialX={panelPos.x}
          initialY={panelPos.y}
          accentColor="#10B981"
        >
          <div className="space-y-2">
            <div>
              <span className="text-[9px] text-gray-500 uppercase">
                Échelle {Math.round(logoScale * 100)}%
              </span>
              <input
                type="range"
                min="0.3"
                max="3.0"
                step="0.1"
                value={logoScale}
                onChange={(e) => setLogoScale(parseFloat(e.target.value))}
                className="w-full h-1.5 rounded-lg appearance-none bg-gray-700 accent-green-500 cursor-pointer mt-1"
              />
            </div>
            <div>
              <span className="text-[9px] text-gray-500 uppercase block mb-1.5">
                Afficher sur:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {["titre", "cartes", "video", "cta"].map((seq) => (
                  <label
                    key={seq}
                    className="flex items-center gap-1.5 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={logoSequences.includes(seq)}
                      onChange={(e) => {
                        if (e.target.checked)
                          setLogoSequences([...logoSequences, seq]);
                        else
                          setLogoSequences(
                            logoSequences.filter((s) => s !== seq),
                          );
                      }}
                      className="h-3 w-3 rounded border-gray-600 accent-green-500"
                    />
                    <span className="text-[9px] text-gray-400 capitalize">
                      {seq}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => setLogoSequences(["titre", "cartes", "video", "cta"])}
                className={`flex-1 flex items-center justify-center gap-1 rounded px-2 py-1.5 text-[10px] font-medium transition-all ${
                  logoSequences.length === 4
                    ? "bg-green-600 text-white"
                    : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                }`}
              >
                Toutes les séquences
              </button>
              <button
                onClick={() => setLogoSequences(activeSequence !== "all" ? [activeSequence] : ["titre"])}
                className="flex-1 flex items-center justify-center gap-1 rounded bg-gray-700 px-2 py-1.5 text-[10px] font-medium text-gray-300 hover:bg-gray-600 transition-all"
              >
                Séquence active
              </button>
            </div>
            <button
              onClick={() => setLogoImage(null)}
              className="w-full flex items-center justify-center gap-1.5 rounded bg-red-700 px-2 py-1.5 text-[10px] font-medium text-white hover:bg-red-600"
            >
              <Trash2 size={12} />
              Supprimer le logo
            </button>
          </div>
        </FloatingPanel>

        {/* ── Site Text Panel (Afroboost.com) ── */}
        <FloatingPanel
          title="Texte Site"
          icon="🌐"
          isOpen={activePanel === "sitetext"}
          onClose={() => setActivePanel(null)}
          initialX={panelPos.x}
          initialY={panelPos.y}
          accentColor="#06B6D4"
        >
          <div className="space-y-2">
            <input
              type="text"
              value={siteText}
              onChange={(e) => setSiteText(e.target.value)}
              className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
              placeholder="Ex: Afroboost.com"
            />
            <div>
              <span className="text-[9px] text-gray-500 uppercase">
                Taille {Math.round(siteTextSize * 100)}%
              </span>
              <input
                type="range"
                min="0.3"
                max="3.0"
                step="0.1"
                value={siteTextSize}
                onChange={(e) => setSiteTextSize(parseFloat(e.target.value))}
                className="w-full h-1.5 rounded-lg appearance-none bg-gray-700 accent-cyan-500 cursor-pointer mt-1"
              />
            </div>
            <div>
              <span className="text-[9px] text-gray-500 uppercase">
                Opacité {Math.round(siteTextOpacity * 100)}%
              </span>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={siteTextOpacity}
                onChange={(e) => setSiteTextOpacity(parseFloat(e.target.value))}
                className="w-full h-1.5 rounded-lg appearance-none bg-gray-700 accent-cyan-500 cursor-pointer mt-1"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-gray-500 uppercase">Couleur</span>
              <input
                type="color"
                value={siteTextColor}
                onChange={(e) => setSiteTextColor(e.target.value)}
                className="h-5 w-8 rounded border border-gray-600 bg-transparent cursor-pointer"
              />
            </div>
            <div>
              <span className="text-[9px] text-gray-500 uppercase block mb-1.5">
                Afficher sur:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {["titre", "cartes", "video", "cta"].map((seq) => (
                  <label
                    key={seq}
                    className="flex items-center gap-1.5 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={siteTextSequences.includes(seq)}
                      onChange={(e) => {
                        if (e.target.checked)
                          setSiteTextSequences([...siteTextSequences, seq]);
                        else
                          setSiteTextSequences(
                            siteTextSequences.filter((s) => s !== seq),
                          );
                      }}
                      className="h-3 w-3 rounded border-gray-600 accent-cyan-500"
                    />
                    <span className="text-[9px] text-gray-400 capitalize">
                      {seq}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => setSiteTextSequences(["titre", "cartes", "video", "cta"])}
                className={`flex-1 flex items-center justify-center gap-1 rounded px-2 py-1.5 text-[10px] font-medium transition-all ${
                  siteTextSequences.length === 4
                    ? "bg-cyan-600 text-white"
                    : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                }`}
              >
                Toutes
              </button>
              <button
                onClick={() => setSiteTextSequences(activeSequence !== "all" ? [activeSequence] : ["titre"])}
                className="flex-1 flex items-center justify-center gap-1 rounded bg-gray-700 px-2 py-1.5 text-[10px] font-medium text-gray-300 hover:bg-gray-600 transition-all"
              >
                Active seule
              </button>
            </div>
            <button
              onClick={() => setSiteTextEnabled(false)}
              className="w-full flex items-center justify-center gap-1.5 rounded bg-red-700 px-2 py-1.5 text-[10px] font-medium text-white hover:bg-red-600"
            >
              <Trash2 size={12} />
              Masquer le texte
            </button>
          </div>
        </FloatingPanel>

        {/* ── Video Overlay Panel ── */}
        <FloatingPanel
          title="Texte Vidéo"
          icon="🎥"
          isOpen={activePanel === "overlay"}
          onClose={() => setActivePanel(null)}
          initialX={panelPos.x}
          initialY={panelPos.y}
          accentColor="#06B6D4"
        >
          <div className="space-y-2">
            <input
              type="text"
              value={videoOverlayText}
              onChange={(e) => setVideoOverlayText(e.target.value)}
              className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-white focus:border-purple-500 focus:outline-none"
              placeholder="Texte affiché sur la vidéo"
            />
            <button
              onClick={async () => {
                setIsGeneratingOverlay(true);
                try {
                  const themeObj = CONTENT_THEMES.find(
                    (t) => t.id === contentTheme,
                  );
                  const topicText =
                    contentTheme === "personnalise"
                      ? customTopic
                      : themeObj?.label || contentTheme;
                  const res = await fetch("/api/content/ai-generate", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      topic: topicText,
                      locale: "fr",
                      cardCount: 1,
                    }),
                  });
                  if (res.ok) {
                    const data = await res.json();
                    if (data.success && data.content?.subtitle)
                      setVideoOverlayText(data.content.subtitle);
                  }
                } catch {
                  /* ignore */
                } finally {
                  setIsGeneratingOverlay(false);
                }
              }}
              disabled={isGeneratingOverlay}
              className="w-full flex items-center justify-center gap-1.5 rounded bg-cyan-700 px-2 py-1.5 text-[10px] font-medium text-white hover:bg-cyan-600 disabled:opacity-50"
            >
              {isGeneratingOverlay ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Sparkles size={12} />
              )}
              Générer par IA
            </button>
            {/* Typography */}
            <div className="flex gap-1 mt-1">
              <button
                onClick={() => setOverlayBold(!overlayBold)}
                className={`px-2 py-1 rounded text-[10px] font-bold transition-all ${overlayBold ? "bg-cyan-600 text-white" : "bg-gray-800 text-gray-400"}`}
              >
                B
              </button>
              <button
                onClick={() => setOverlayItalic(!overlayItalic)}
                className={`px-2 py-1 rounded text-[10px] italic transition-all ${overlayItalic ? "bg-cyan-600 text-white" : "bg-gray-800 text-gray-400"}`}
              >
                I
              </button>
            </div>
            <div>
              <span className="text-[9px] text-gray-500 uppercase">
                Espacement {overlayLetterSpacing}px
              </span>
              <input
                type="range"
                min="-2"
                max="15"
                step="0.5"
                value={overlayLetterSpacing}
                onChange={(e) =>
                  setOverlayLetterSpacing(parseFloat(e.target.value))
                }
                className="w-full h-1.5 rounded-lg appearance-none bg-gray-700 accent-cyan-500 cursor-pointer mt-1"
              />
            </div>
            <div>
              <span className="text-[9px] text-gray-500 uppercase">
                Interligne {overlayLineHeight.toFixed(1)}
              </span>
              <input
                type="range"
                min="0.8"
                max="2.5"
                step="0.1"
                value={overlayLineHeight}
                onChange={(e) =>
                  setOverlayLineHeight(parseFloat(e.target.value))
                }
                className="w-full h-1.5 rounded-lg appearance-none bg-gray-700 accent-cyan-500 cursor-pointer mt-1"
              />
            </div>
          </div>
        </FloatingPanel>

        {/* ── Add Element Panel (opens on background double-click) ── */}
        <FloatingPanel
          title="Ajouter un élément"
          icon="➕"
          isOpen={activePanel === 'add'}
          onClose={() => setActivePanel(null)}
          initialX={panelPos.x}
          initialY={panelPos.y}
          accentColor="#D91CD2"
        >
          <div className="space-y-2">
            {/* Upload Logo */}
            <label className="flex items-center gap-2 w-full cursor-pointer rounded bg-gray-800 px-3 py-2 hover:bg-gray-700 transition-colors">
              <Upload size={14} className="text-purple-400" />
              <span className="text-[10px] text-gray-300 font-medium">{logoImage ? 'Changer le logo' : 'Ajouter un logo'}</span>
              <input type="file" accept="image/*" onChange={(e) => { handleLogoUpload(e); setActivePanel(null); }} className="hidden" />
            </label>
            {/* Upload custom icon */}
            <label className="flex items-center gap-2 w-full cursor-pointer rounded bg-gray-800 px-3 py-2 hover:bg-gray-700 transition-colors">
              <span className="text-sm">🎨</span>
              <span className="text-[10px] text-gray-300 font-medium">Ajouter une icône</span>
              <input type="file" accept="image/*" onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    const dataUrl = ev.target?.result as string;
                    // Add as a card custom icon with a unique key
                    const key = `custom-${Date.now()}`;
                    setCustomCardIcons(prev => ({ ...prev, [key]: dataUrl }));
                  };
                  reader.readAsDataURL(file);
                }
                setActivePanel(null);
              }} className="hidden" />
            </label>
            {/* Quick actions */}
            <button
              onClick={() => { setActivePanel('title'); }}
              className="flex items-center gap-2 w-full rounded bg-gray-800 px-3 py-2 text-[10px] text-gray-300 font-medium hover:bg-gray-700 transition-colors"
            >
              <span>📝</span> Modifier le titre
            </button>
            <button
              onClick={() => { setActivePanel('cta'); }}
              className="flex items-center gap-2 w-full rounded bg-gray-800 px-3 py-2 text-[10px] text-gray-300 font-medium hover:bg-gray-700 transition-colors"
            >
              <span>📢</span> Modifier le CTA
            </button>
            <button
              onClick={() => { setActivePanel('gradient'); }}
              className="flex items-center gap-2 w-full rounded bg-gray-800 px-3 py-2 text-[10px] text-gray-300 font-medium hover:bg-gray-700 transition-colors"
            >
              <span>🌈</span> Dégradé / Ombre
            </button>
            {rushUrl && (
              <button
                onClick={() => { setActivePanel('overlay'); }}
                className="flex items-center gap-2 w-full rounded bg-gray-800 px-3 py-2 text-[10px] text-gray-300 font-medium hover:bg-gray-700 transition-colors"
              >
                <span>🎥</span> Texte sur la vidéo
              </button>
            )}
            <button
              onClick={() => { setSiteTextEnabled(true); setActivePanel('sitetext'); }}
              className="flex items-center gap-2 w-full rounded bg-gray-800 px-3 py-2 text-[10px] text-gray-300 font-medium hover:bg-gray-700 transition-colors"
            >
              <span>🌐</span> {siteTextEnabled ? 'Modifier texte site' : 'Ajouter texte site (Afroboost.com)'}
            </button>
          </div>
        </FloatingPanel>

        {/* Batch Preview Dots */}
        {batchCount > 1 && (
          <div className="mt-3 flex items-center gap-1.5 sm:gap-3 flex-wrap justify-center">
            <span className="text-xs text-gray-500">Batch: x{batchCount}</span>
            <div className="flex gap-1.5 flex-wrap justify-center">
              {Array.from({ length: Math.min(batchCount, 10) }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedPhotoIndex(i % pexelsPhotos.length)}
                  className={`h-2.5 w-2.5 rounded-full transition-all ${
                    selectedPhotoIndex === i % pexelsPhotos.length
                      ? "bg-purple-500 scale-125"
                      : "bg-gray-600 hover:bg-gray-500"
                  }`}
                />
              ))}
            </div>
          </div>
        )}

        {/* Photo Preview Grid (small thumbnails) */}
        {pexelsPhotos.length > 0 && (
          <div className="mt-3 flex gap-1.5 sm:gap-2 overflow-x-auto px-2 sm:px-4">
            {pexelsPhotos.slice(0, Math.max(batchCount, 4)).map((photo, i) => (
              <button
                key={photo.id}
                onClick={() => setSelectedPhotoIndex(i)}
                className={`flex-shrink-0 overflow-hidden rounded transition-all ${
                  selectedPhotoIndex === i
                    ? "ring-2 ring-purple-500"
                    : "opacity-60 hover:opacity-100"
                }`}
              >
                <img
                  src={photo.small}
                  alt=""
                  className="h-10 sm:h-16 w-8 sm:w-12 object-cover"
                />
              </button>
            ))}
          </div>
        )}

        {/* Stats */}
        <div className="mt-3 sm:mt-4 grid w-full max-w-xs grid-cols-3 gap-1.5 sm:gap-4 rounded-lg bg-gray-800 p-2 sm:p-3">
          <div className="text-center">
            <p className="text-[10px] sm:text-xs text-gray-400">Cartes</p>
            <p className="text-base sm:text-lg font-bold text-white">
              {cards.length}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] sm:text-xs text-gray-400">Batch</p>
            <p className="text-base sm:text-lg font-bold text-white">
              x{batchCount}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] sm:text-xs text-gray-400">Crédits</p>
            <p className="text-base sm:text-lg font-bold text-yellow-400">
              {25 * batchCount}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
