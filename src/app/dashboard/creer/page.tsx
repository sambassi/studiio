"use client";

import { useState, useEffect, useCallback, useRef, Suspense, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
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
  ChevronDown,
  Image as ImageIcon,
  Edit3,
  Check,
  Search,
  Video,
  AlertTriangle,
  Crop,
  Grid3x3,
  Grid2x2,
  Move,
  Combine,
  Ungroup,
  CopyPlus,
  Group,
  Undo2,
  Redo2,
  LayoutTemplate,
  Type,
  LayoutGrid,
  Film,
  Music,
  Settings as SettingsIcon,
  Bold,
  Italic,
  Copy as CopyIcon,
  X,
  Play,
  Pause,
  Megaphone,
  Crosshair,
  Eye,
  EyeOff,
  Calendar,
  Download,
  Layers,
  Palette,
  Share2,
  RotateCcw,
  // Card-icon library — explicit imports so the bundler keeps them all.
  // `import * as LucideIcons` was tree-shaken in production, leaving dynamic
  // lookups undefined and the raw icon name bleeding through as text.
  ThumbsUp, Heart, Brain, Flame, Trophy, Target, Dumbbell, Activity,
  Apple, Carrot, Salad, Coffee, Pizza, Utensils, Wheat,
  Leaf, Sun, Moon, Star, Cloud, Flower, TreePine, Sprout,
  Laptop, Smartphone, Cpu, Wifi, Battery, Code, Bot,
  DollarSign, TrendingUp, Gem, Briefcase, Wallet, BarChart, PieChart, Receipt,
  Camera, Mic, PenTool, Brush, Image as LucideImage,
  Plane, Globe, Map, Mountain, Compass, MapPin, Hotel, Tent,
  Smile, Award, Gift, Bell, PartyPopper,
  Dog, Cat, Bird, Fish, Rabbit, Turtle,
  Home, Building, Car, Bike, Train, Rocket, Ship, Bus,
  ShoppingBag, ShoppingCart, Tag, Package, Truck, CreditCard,
  Book, GraduationCap, Lightbulb, Library, Pencil, Ruler,
  Stethoscope, Pill, Cross, HeartPulse,
  // Extended icon library
  Clock, Timer, AlarmClock, Watch, Hourglass, CalendarDays, CalendarCheck, CalendarClock, Sunrise, Sunset,
  Syringe, Thermometer, Bone,
  Baby, Users, User, UserPlus, PersonStanding,
  CloudRain, CloudSnow, Snowflake, Wind, Umbrella, Rainbow,
  Database, Server, Terminal, Bug, FileCode,
  TrendingDown, BarChart2, BarChart3, HandCoins, Landmark, PiggyBank, Coins,
  Aperture, Clapperboard, Disc, Volume2, Headphones, Speaker, Radio, Podcast,
  Gamepad2, Joystick, Puzzle,
  Anchor, Sailboat, Footprints, Navigation,
  Store, Warehouse, Factory, Church,
  Clipboard, ClipboardList, FileText, File, Folder, FolderOpen, Archive, Inbox, Mail, MessageSquare, MessageCircle, Send as SendIcon,
  Filter, Settings2, Wrench, Hammer, Paintbrush, Scissors,
  Shield, ShieldCheck, ShieldAlert, Lock, Unlock, Key, Fingerprint,
  Plug, Power, BatteryCharging, Signal,
  MapPinned, Route, Flag,
  Frown, Meh, Laugh, Cake,
  Trees, TreeDeciduous, Waves,
  Crown, Diamond, Medal,
  Rows3, Columns3,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PlatformIcon, type PlatformKey } from "@/components/ui/PlatformIcon";

// Static map: lucide icon names → component. MUST contain every name listed
// in ICON_LIBRARY below. The map is the single source of truth used by both
// the picker grid and the preview render path (renderCardIcon).
const ICON_MAP: Record<string, LucideIcon> = {
  ThumbsUp, Heart, Brain, Flame, Zap, Sparkles, Trophy, Target, Dumbbell, Activity, Bike,
  Apple, Carrot, Salad, Coffee, Pizza, Utensils, Wheat,
  Leaf, Sun, Moon, Star, Cloud, Flower, TreePine, Sprout, Trees, TreeDeciduous, Waves,
  Laptop, Smartphone, Cpu, Wifi, Battery, Code, Bot, Database, Server, Terminal, Bug, FileCode,
  DollarSign, TrendingUp, TrendingDown, Gem, Briefcase, Wallet, BarChart, BarChart2, BarChart3, PieChart, Receipt, HandCoins, Landmark, PiggyBank, Coins,
  Palette, Camera, Music, Mic, Video, PenTool, Brush, Paintbrush, Image: LucideImage, Aperture, Clapperboard, Disc, Volume2, Headphones, Speaker, Radio, Podcast,
  Plane, Globe, Map, Mountain, Compass, MapPin, MapPinned, Route, Hotel, Tent, Navigation, Flag, Anchor, Sailboat, Footprints,
  Smile, Frown, Meh, Laugh, Award, Gift, Bell, Megaphone, PartyPopper, Cake, Crown, Diamond, Medal,
  Dog, Cat, Bird, Fish, Rabbit, Turtle,
  Home, Building, Car, Train, Rocket, Ship, Bus, Store, Warehouse, Factory, Church,
  ShoppingBag, ShoppingCart, Tag, Package, Truck, CreditCard,
  Book, GraduationCap, Lightbulb, Library, Pencil, Ruler, Scissors,
  Stethoscope, Pill, Cross, HeartPulse, Syringe, Thermometer, Bone,
  Clock, Timer, AlarmClock, Watch, Hourglass, Calendar, CalendarDays, CalendarCheck, CalendarClock, Sunrise, Sunset,
  Baby, Users, User, UserPlus, PersonStanding,
  CloudRain, CloudSnow, Snowflake, Wind, Umbrella, Rainbow,
  Gamepad2, Joystick, Puzzle,
  Clipboard, ClipboardList, FileText, File, Folder, FolderOpen, Archive, Inbox, Mail, MessageSquare, MessageCircle, Send: SendIcon,
  Filter, Settings2, Wrench, Hammer,
  Shield, ShieldCheck, ShieldAlert, Lock, Unlock, Key, Fingerprint,
  Plug, Power, BatteryCharging, Signal,
};
import { AgentIAModal } from "@/components/creer/AgentIAModal";
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
import { Modal } from "@/components/ui/Modal";
import { detectClips, extractClip, type DetectedClip } from "@/lib/clip-detector";
import CropRushModal from "@/components/creer/CropRushModal";
import SmartGuides from "@/components/creer/SmartGuides";
import ImageEditorPanel, { buildCssFilter } from "@/components/creer/ImageEditorPanel";
import {
  snapPosition,
  computeDistanceBadges,
  type ActiveGuide,
  type DistanceBadge,
  type ElementPos,
} from "@/lib/creer/smartGuides";
import { useDesignHistory } from "@/lib/creer/useDesignHistory";
import { useSession } from "next-auth/react";
import { BuyCreditsModal } from "@/components/billing/BuyCreditsModal";
import { MediaLibrary } from "@/components/shared/MediaLibrary";
// ExportBar removed — using inline export button that respects destination selection
import { BrandingIndicator } from "@/components/shared/BrandingIndicator";
import { useBranding } from "@/lib/hooks/useBranding";
import { useAgentIAEnabled } from "@/lib/hooks/useAgentIAEnabled";
import { AudioStudioPanel } from "@/components/creer/AudioStudioPanel";
import { SequenceVoicesPanel } from "@/components/creer/SequenceVoicesPanel";
import AudioDuckingTimeline from "@/components/creer/AudioDuckingTimeline";
import AudioMixPreview from "@/components/creer/AudioMixPreview";
import { analyseRushForDucking, type AudioKeyframe } from "@/lib/creer/audioDucking";
import {
  buildAutoFillText,
  emptySequenceVoices,
  emptySequenceVoicesUserEdited,
  SEQUENCE_KEYS,
  type SequenceKey,
  type SequenceVoices,
  type SequenceVoicesUserEdited,
} from "@/lib/types/voice";
import { getExpiresAt, formatRemaining, getRetentionColor } from "@/lib/storage/retention";

// ── Unified icon badge style — filled Lucide icon + colored tint container ──
// Each color maps to literal Tailwind classes so JIT keeps them in the build.
const ICON_BADGE_STYLES = {
  purple: { bg: "bg-purple-500/[0.12]", text: "text-purple-500", solid: "bg-purple-500" },
  amber: { bg: "bg-amber-500/[0.12]", text: "text-amber-500", solid: "bg-amber-500" },
  blue: { bg: "bg-blue-500/[0.12]", text: "text-blue-500", solid: "bg-blue-500" },
  pink: { bg: "bg-pink-500/[0.12]", text: "text-pink-500", solid: "bg-pink-500" },
  emerald: { bg: "bg-emerald-500/[0.12]", text: "text-emerald-500", solid: "bg-emerald-500" },
  cyan: { bg: "bg-cyan-500/[0.12]", text: "text-cyan-500", solid: "bg-cyan-500" },
  slate: { bg: "bg-slate-500/[0.12]", text: "text-slate-300", solid: "bg-slate-500" },
  orange: { bg: "bg-orange-500/[0.12]", text: "text-orange-500", solid: "bg-orange-500" },
  red: { bg: "bg-red-500/[0.12]", text: "text-red-400", solid: "bg-red-500" },
} as const;
type IconBadgeColor = keyof typeof ICON_BADGE_STYLES;

function IconBadge({
  Icon,
  color,
  active = false,
  fill = true,
  size = 40,
  iconSize,
}: {
  Icon: React.ComponentType<any>;
  color: IconBadgeColor;
  active?: boolean;
  fill?: boolean;
  size?: number;
  iconSize?: number;
}) {
  const s = ICON_BADGE_STYLES[color];
  const innerSize = iconSize ?? Math.round(size * 0.5);
  const containerStyle: React.CSSProperties = { width: size, height: size };
  return (
    <span
      className={`inline-flex items-center justify-center rounded-xl flex-shrink-0 transition-colors ${
        active ? `${s.solid} text-white` : `${s.bg} ${s.text}`
      }`}
      style={containerStyle}
    >
      <Icon
        size={innerSize}
        className={active ? "text-white" : s.text}
        fill={fill ? "currentColor" : "none"}
        strokeWidth={fill ? 1.5 : 2}
      />
    </span>
  );
}

// ── Types ──────────────────────────────────────────────────────
interface InfoCard {
  id: string;
  // Empty string ("" or whitespace) means "no icon" — the card renders without the icon slot.
  // Holds an emoji string when iconType==='emoji', a lucide icon name when iconType==='svg'.
  emoji: string;
  label: string;
  value: string;
  description: string;
  color: string;
  /**
   * Free-positioning mode: x/y are percentages (0–100) of the preview
   * container (card center). When absent, falls back to the grid layout.
   */
  position?: { x: number; y: number };
  // Icon system. Cards saved before this feature have iconType undefined → treated as 'emoji'.
  iconType?: 'emoji' | 'svg';
  iconColor?: string;       // stroke color for outline / duotone, fill color for solid
  iconFillColor?: string;   // inner fill (used in duotone mode)
  iconSize?: number;        // 16–80 px
  iconStyle?: 'outline' | 'duotone' | 'solid';
  iconGradient?: { start: string; end: string; direction: 'h' | 'v' | 'd' };
  /**
   * When true, this individual card renders as plain text (label +
   * description only, no frame, no icon, no value), overriding the
   * global `selectedCardStyle`. Lets users mix styled and text cards.
   */
  textOnly?: boolean;
}

/**
 * Lightweight markdown bold parser: replaces **word** with <strong>word</strong>.
 * Returns React nodes, safe for use inside <p>/<span>. Plain text stays plain.
 */
function renderBoldMarkdown(text: string | undefined): ReactNode {
  if (!text) return text || '';
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

/**
 * Truncate a string at a word boundary and append an ellipsis when cut.
 * Avoids mid-word cuts like "longtemp" → now produces "longtemps" or
 * "On s'entraîne 3x plus…" depending on the limit. Returns the original
 * string untouched if it's already within the limit.
 */
function truncateAtWord(text: string | undefined, maxChars: number): string {
  if (!text) return '';
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  const trimmed = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return trimmed.replace(/[\s,;:.!?-]+$/, '') + '…';
}

const QUICK_EMOJIS = ['📝', '✨', '⭐', '🎯', '💪', '🔥', '💡', '📊', '🚀', '❤️', '👀', '✅', '⚡', '🎨', '🎬', '📈', '🏆', '💎', '🧠', '🥗'];

// Lucide icon library — names map to lucide-react exports. Looked up dynamically
// at render time via ICON_MAP[name] to keep this file lean.
const ICON_LIBRARY: Record<string, string[]> = {
  sport:       ['Dumbbell', 'Flame', 'Zap', 'Trophy', 'Target', 'Activity', 'Bike', 'Medal', 'Crown'],
  santé:       ['Heart', 'Brain', 'Stethoscope', 'Pill', 'Cross', 'HeartPulse', 'Syringe', 'Thermometer', 'Bone'],
  nutrition:   ['Apple', 'Carrot', 'Salad', 'Coffee', 'Pizza', 'Utensils', 'Wheat'],
  temps:       ['Clock', 'Timer', 'AlarmClock', 'Watch', 'Hourglass', 'Calendar', 'CalendarDays', 'CalendarCheck', 'CalendarClock', 'Sunrise', 'Sunset'],
  nature:      ['Leaf', 'Sun', 'Moon', 'Star', 'Cloud', 'Flower', 'TreePine', 'Sprout', 'Trees', 'TreeDeciduous', 'Waves', 'Mountain'],
  météo:       ['CloudRain', 'CloudSnow', 'Snowflake', 'Wind', 'Umbrella', 'Rainbow'],
  tech:        ['Laptop', 'Smartphone', 'Cpu', 'Wifi', 'Battery', 'Code', 'Bot', 'Database', 'Server', 'Terminal', 'Bug', 'FileCode'],
  finance:     ['DollarSign', 'TrendingUp', 'TrendingDown', 'Gem', 'Briefcase', 'Wallet', 'BarChart', 'PieChart', 'Receipt', 'HandCoins', 'Landmark', 'PiggyBank', 'Coins'],
  multimedia:  ['Palette', 'Camera', 'Music', 'Mic', 'Video', 'PenTool', 'Brush', 'Paintbrush', 'Image', 'Aperture', 'Clapperboard', 'Disc', 'Volume2', 'Headphones', 'Speaker', 'Radio', 'Podcast'],
  loisirs:     ['Gamepad2', 'Joystick', 'Puzzle', 'Diamond'],
  voyage:      ['Plane', 'Globe', 'Map', 'Compass', 'MapPin', 'MapPinned', 'Route', 'Hotel', 'Tent', 'Navigation', 'Flag', 'Anchor', 'Sailboat', 'Footprints'],
  émotions:    ['Smile', 'Frown', 'Meh', 'Laugh', 'Award', 'ThumbsUp', 'Gift', 'Bell', 'Megaphone', 'PartyPopper', 'Sparkles', 'Cake', 'Crown'],
  famille:     ['Baby', 'Users', 'User', 'UserPlus', 'PersonStanding'],
  animaux:     ['Dog', 'Cat', 'Bird', 'Fish', 'Rabbit', 'Turtle'],
  logement:    ['Home', 'Building', 'Store', 'Warehouse', 'Factory', 'Church'],
  transport:   ['Car', 'Bike', 'Train', 'Rocket', 'Ship', 'Bus', 'Truck'],
  communication: ['Mail', 'MessageSquare', 'MessageCircle', 'Send', 'Inbox', 'Archive'],
  outils:      ['Clipboard', 'ClipboardList', 'FileText', 'File', 'Folder', 'FolderOpen', 'Filter', 'Settings2', 'Wrench', 'Hammer', 'Scissors'],
  sécurité:    ['Shield', 'ShieldCheck', 'ShieldAlert', 'Lock', 'Unlock', 'Key', 'Fingerprint'],
  énergie:     ['Plug', 'Power', 'BatteryCharging', 'Signal'],
  shopping:    ['ShoppingBag', 'ShoppingCart', 'Tag', 'Package', 'CreditCard'],
  education:   ['Book', 'GraduationCap', 'Lightbulb', 'Library', 'Pencil', 'Ruler'],
};

const ICON_KEYWORDS: Record<string, string[]> = {
  Clock: ['horaire', 'heure', 'temps', 'clock'], Timer: ['chrono', 'compteur'],
  AlarmClock: ['alarme', 'réveil'], Watch: ['montre'], Hourglass: ['sablier', 'attente'],
  Calendar: ['calendrier', 'date'], CalendarDays: ['semaine'], CalendarCheck: ['rdv', 'rendez-vous'],
  CalendarClock: ['planning'], Sunrise: ['matin', 'lever'], Sunset: ['soir', 'coucher'],
  Heart: ['coeur', 'amour'], Brain: ['cerveau', 'intelligence'], Dumbbell: ['haltère', 'musculation'],
  Apple: ['pomme'], Coffee: ['café'], Music: ['musique'], Camera: ['photo', 'appareil'],
  Home: ['maison'], Car: ['voiture', 'auto'], Plane: ['avion'], Globe: ['monde', 'terre'],
  Mail: ['email', 'courrier'], Lock: ['verrou', 'cadenas'], Key: ['clé'],
  Shield: ['bouclier', 'protection'], Star: ['étoile', 'favori'],
  Headphones: ['casque', 'audio'], Mic: ['micro', 'enregistrement'],
};

const ALL_LUCIDE_NAMES: string[] = Object.values(ICON_LIBRARY).flat();

/** Map a content theme key to a sensible default lucide icon for new empty cards. */
function themeIconName(theme: string | undefined): string {
  const t = (theme || '').toLowerCase();
  if (t.includes('sport') || t.includes('fitness')) return 'Dumbbell';
  if (t.includes('santé') || t.includes('sante') || t.includes('bien')) return 'Heart';
  if (t.includes('nutrition') || t.includes('food')) return 'Apple';
  if (t.includes('parent')) return 'Smile';
  if (t.includes('nature')) return 'Leaf';
  if (t.includes('tech') || t.includes('coding')) return 'Laptop';
  if (t.includes('finance')) return 'DollarSign';
  if (t.includes('education') || t.includes('école') || t.includes('ecole')) return 'Book';
  if (t.includes('voyage') || t.includes('travel')) return 'Plane';
  return 'Sparkles';
}

const COLOR_SWATCHES_VIVID = ['#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6', '#EC4899'];
const COLOR_SWATCHES_PASTEL = ['#FCA5A5', '#FCD34D', '#6EE7B7', '#93C5FD', '#C4B5FD', '#F9A8D4'];

interface IconRenderOpts {
  size?: number;
  color?: string;
  fillColor?: string;
  style?: 'outline' | 'duotone' | 'solid';
  gradient?: { start: string; end: string; direction: 'h' | 'v' | 'd' };
  /** Unique id used as the SVG gradient defs id when gradient is enabled. */
  gradientId?: string;
}

function renderLucideIcon(name: string, opts: IconRenderOpts = {}): ReactNode {
  const Icon = ICON_MAP[name];
  if (!Icon) return null;
  const size = opts.size ?? 32;
  const color = opts.color ?? '#a855f7';
  const fillColor = opts.fillColor ?? color;
  const style = opts.style ?? 'outline';

  // Gradient mode wraps the icon in a custom <svg> with a linearGradient defs and applies
  // stroke="url(#id)" via a CSS variable trick. Simpler: render the icon, then overlay a
  // styled wrapper. Lucide accepts `color` as the stroke; we set strokeWidth + fill manually.
  if (opts.gradient && opts.gradientId) {
    const { start, end, direction } = opts.gradient;
    const x2 = direction === 'v' ? '0' : direction === 'd' ? '1' : '1';
    const y2 = direction === 'v' ? '1' : direction === 'd' ? '1' : '0';
    return (
      <span style={{ display: 'inline-flex', width: size, height: size, position: 'relative' }}>
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
          <defs>
            <linearGradient id={opts.gradientId} x1="0" y1="0" x2={x2} y2={y2}>
              <stop offset="0%" stopColor={start} />
              <stop offset="100%" stopColor={end} />
            </linearGradient>
          </defs>
        </svg>
        <Icon
          size={size}
          stroke={`url(#${opts.gradientId})`}
          fill={style === 'solid' ? `url(#${opts.gradientId})` : 'none'}
          strokeWidth={style === 'solid' ? 0 : 2}
        />
      </span>
    );
  }

  if (style === 'solid') {
    return <Icon size={size} color={color} fill={color} strokeWidth={0} />;
  }
  if (style === 'duotone') {
    return <Icon size={size} color={color} fill={fillColor} strokeWidth={2} />;
  }
  // outline (default)
  return <Icon size={size} color={color} fill="none" strokeWidth={2} />;
}

/**
 * Render a card icon based on its iconType. Falls back to emoji rendering for
 * cards saved before the SVG library feature.
 */
function renderCardIcon(card: InfoCard, fallbackSize?: number): ReactNode {
  if (card.iconType === 'svg' && card.emoji) {
    return renderLucideIcon(card.emoji, {
      size: card.iconSize ?? fallbackSize ?? 32,
      color: card.iconColor ?? card.color,
      fillColor: card.iconFillColor ?? card.color,
      style: card.iconStyle ?? 'outline',
      gradient: card.iconGradient,
      gradientId: card.iconGradient ? `card-grad-${card.id}` : undefined,
    });
  }
  // Emoji fallback
  return card.emoji;
}

function CardIconPicker({
  card,
  update,
  accentColor,
  aiBusy,
  onSuggestAI,
}: {
  card: InfoCard;
  update: (patch: Partial<InfoCard>) => void;
  accentColor: string;
  aiBusy: boolean;
  onSuggestAI: () => void;
}) {
  const [iconSearch, setIconSearch] = useState('');
  const iconType = card.iconType ?? 'emoji';
  const iconColor = card.iconColor ?? card.color ?? accentColor;
  const iconFillColor = card.iconFillColor ?? iconColor;
  const iconSize = card.iconSize ?? 32;
  const iconStyle = card.iconStyle ?? 'outline';
  const grad = card.iconGradient;

  const setSwatch = (color: string) => {
    if (grad) update({ iconGradient: { ...grad, start: color } });
    else update({ iconColor: color });
  };

  return (
    <div className="space-y-2">
      {/* Mode tabs */}
      <div className="flex gap-1 rounded bg-gray-900 p-0.5">
        <button
          onClick={() => update({ iconType: 'emoji' })}
          className={`flex-1 rounded px-2 py-1 text-[10px] font-semibold ${iconType === 'emoji' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}
        >
          Emojis
        </button>
        <button
          onClick={() => update({ iconType: 'svg', emoji: card.emoji && ICON_MAP[card.emoji] ? card.emoji : 'Sparkles' })}
          className={`flex-1 rounded px-2 py-1 text-[10px] font-semibold ${iconType === 'svg' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}
        >
          Icônes SVG
        </button>
      </div>

      {/* Top row: current preview + AI suggest */}
      <div className="flex gap-1.5 items-center">
        {iconType === 'svg' ? (
          <div className="h-10 w-12 rounded border border-gray-600 bg-gray-700 flex items-center justify-center text-base flex-shrink-0">
            {renderLucideIcon(card.emoji || 'Sparkles', { size: 22, color: iconColor, fillColor: iconFillColor, style: iconStyle, gradient: grad, gradientId: `prev-${card.id}` })}
          </div>
        ) : (
          <input
            type="text"
            value={card.emoji}
            onChange={(e) => update({ emoji: e.target.value })}
            maxLength={4}
            className="h-10 w-12 text-center rounded border border-gray-600 bg-gray-700 px-1 py-1 text-xl flex-shrink-0"
            placeholder="📝"
          />
        )}
        <button
          onClick={onSuggestAI}
          disabled={aiBusy || (!card.label.trim() && !card.description.trim())}
          className="flex-1 flex items-center justify-center gap-1 rounded bg-purple-600/20 px-2 py-1 text-[10px] font-semibold text-purple-300 hover:bg-purple-600/40 disabled:opacity-50"
          title="Générer icône avec IA (requiert titre ou description)"
        >
          {aiBusy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
          Générer icône IA
        </button>
      </div>

      {/* EMOJI MODE — quick palette */}
      {iconType === 'emoji' && (
        <div className="flex flex-wrap gap-0.5">
          {QUICK_EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => update({ emoji: e })}
              className={`h-6 w-6 rounded text-sm hover:bg-gray-700 ${card.emoji === e ? 'bg-purple-600/30' : ''}`}
              title={e}
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {/* SVG MODE — categorized library + customization */}
      {iconType === 'svg' && (
        <>
          <div
            className="space-y-2"
          >
            <input
              type="text"
              placeholder="Rechercher une icône..."
              value={iconSearch}
              onChange={(e) => setIconSearch(e.target.value)}
              className="w-full rounded bg-gray-800 border border-gray-700 px-3 py-1.5 text-xs text-white placeholder-gray-500"
            />
            <div className="max-h-[300px] overflow-y-auto rounded border border-gray-700 bg-gray-900/40 p-2 space-y-2">
            {Object.entries(ICON_LIBRARY).map(([category, names]) => {
              const q = iconSearch.toLowerCase().trim();
              const filteredNames = q ? names.filter((name) => {
                if (name.toLowerCase().includes(q)) return true;
                if (category.toLowerCase().includes(q)) return true;
                const kw = ICON_KEYWORDS[name];
                if (kw && kw.some(k => k.includes(q))) return true;
                return false;
              }) : names;
              if (filteredNames.length === 0) return null;
              return (
              <div key={category}>
                <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-1">{category}</div>
                <div className="grid grid-cols-6 sm:grid-cols-6 gap-1">
                  {filteredNames.map((name) => {
                    const Icon = ICON_MAP[name];
                    if (!Icon) return null;
                    const selected = card.emoji === name;
                    return (
                      <button
                        key={name}
                        onClick={() => update({ emoji: name })}
                        draggable
                        onDragStart={(e) => { e.dataTransfer.setData('text/plain', name); e.dataTransfer.effectAllowed = 'copy'; }}
                        className={`h-10 w-10 rounded-lg bg-gray-800 hover:bg-gray-700 hover:scale-110 transition flex items-center justify-center cursor-grab active:cursor-grabbing ${selected ? 'ring-2 ring-purple-500' : ''}`}
                        title={`${name} (glisser sur une carte)`}
                      >
                        <Icon size={20} color={iconColor} />
                      </button>
                    );
                  })}
                </div>
              </div>
              );
            })}
            </div>
          </div>

          {/* Style tabs: Outline / Duotone / Solid */}
          <div className="flex gap-1 rounded bg-gray-900 p-0.5">
            {(['outline', 'duotone', 'solid'] as const).map((s) => (
              <button
                key={s}
                onClick={() => update({ iconStyle: s })}
                className={`flex-1 rounded px-2 py-1 text-[9px] font-semibold uppercase ${iconStyle === s ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                {s === 'outline' ? 'Contour' : s === 'duotone' ? 'Duotone' : 'Rempli'}
              </button>
            ))}
          </div>

          {/* Color: stroke + (optionally) fill */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <label className="text-[9px] uppercase text-gray-500 w-14">Trait</label>
              <input
                type="color"
                value={iconColor}
                onChange={(e) => update({ iconColor: e.target.value })}
                className="h-6 w-10 rounded border border-gray-600 bg-transparent cursor-pointer"
              />
              <input
                type="text"
                value={iconColor}
                onChange={(e) => update({ iconColor: e.target.value })}
                className="flex-1 rounded border border-gray-600 bg-gray-700 px-2 py-1 text-[10px] font-mono text-white"
              />
            </div>
            {iconStyle === 'duotone' && (
              <div className="flex items-center gap-2">
                <label className="text-[9px] uppercase text-gray-500 w-14">Fond</label>
                <input
                  type="color"
                  value={iconFillColor}
                  onChange={(e) => update({ iconFillColor: e.target.value })}
                  className="h-6 w-10 rounded border border-gray-600 bg-transparent cursor-pointer"
                />
                <input
                  type="text"
                  value={iconFillColor}
                  onChange={(e) => update({ iconFillColor: e.target.value })}
                  className="flex-1 rounded border border-gray-600 bg-gray-700 px-2 py-1 text-[10px] font-mono text-white"
                />
              </div>
            )}
          </div>

          {/* Swatches */}
          <div>
            <div className="text-[9px] uppercase text-gray-500 mb-1">Vif</div>
            <div className="flex gap-1">
              {COLOR_SWATCHES_VIVID.map((c) => (
                <button
                  key={c}
                  onClick={() => setSwatch(c)}
                  className="h-5 flex-1 rounded border border-white/10 hover:scale-110 transition"
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
            <div className="text-[9px] uppercase text-gray-500 mb-1 mt-1.5">Pastel</div>
            <div className="flex gap-1">
              {COLOR_SWATCHES_PASTEL.map((c) => (
                <button
                  key={c}
                  onClick={() => setSwatch(c)}
                  className="h-5 flex-1 rounded border border-white/10 hover:scale-110 transition"
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          </div>

          {/* Theme match */}
          <button
            onClick={() => update({ iconColor: accentColor, iconFillColor: accentColor, iconGradient: undefined })}
            className="w-full flex items-center justify-center gap-1 rounded bg-amber-500/15 px-2 py-1 text-[10px] font-semibold text-amber-300 hover:bg-amber-500/25"
          >
            <Sparkles size={11} /> Assortir au thème
          </button>

          {/* Size */}
          <div>
            <div className="flex items-center justify-between text-[9px] uppercase text-gray-500">
              <span>Taille</span>
              <span className="text-gray-300">{iconSize}px</span>
            </div>
            <input
              type="range"
              min={16}
              max={80}
              value={iconSize}
              onChange={(e) => update({ iconSize: Number(e.target.value) })}
              className="w-full mt-1 accent-purple-500"
            />
          </div>

          {/* Gradient */}
          <div className="rounded border border-gray-700 bg-gray-900/40 p-2 space-y-1.5">
            <label className="flex items-center gap-2 text-[10px] text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={!!grad}
                onChange={(e) =>
                  update({
                    iconGradient: e.target.checked
                      ? { start: iconColor, end: iconFillColor !== iconColor ? iconFillColor : '#EC4899', direction: 'd' }
                      : undefined,
                  })
                }
                className="accent-purple-500"
              />
              Dégradé
            </label>
            {grad && (
              <>
                <div className="flex items-center gap-2">
                  <label className="text-[9px] uppercase text-gray-500 w-10">Début</label>
                  <input type="color" value={grad.start} onChange={(e) => update({ iconGradient: { ...grad, start: e.target.value } })} className="h-6 w-10 rounded border border-gray-600 bg-transparent cursor-pointer" />
                  <label className="text-[9px] uppercase text-gray-500 w-8">Fin</label>
                  <input type="color" value={grad.end} onChange={(e) => update({ iconGradient: { ...grad, end: e.target.value } })} className="h-6 w-10 rounded border border-gray-600 bg-transparent cursor-pointer" />
                </div>
                <div className="flex gap-1">
                  {(['h', 'v', 'd'] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => update({ iconGradient: { ...grad, direction: d } })}
                      className={`flex-1 rounded px-2 py-0.5 text-[9px] uppercase ${grad.direction === d ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
                    >
                      {d === 'h' ? 'Horiz' : d === 'v' ? 'Vert' : 'Diag'}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CardsRailPanel({
  cards,
  setCards,
  accentColor,
}: {
  cards: InfoCard[];
  setCards: React.Dispatch<React.SetStateAction<InfoCard[]>>;
  accentColor: string;
}) {
  const [aiBusyId, setAiBusyId] = useState<string | null>(null);

  const addEmptyCard = () => {
    setCards((prev) => [
      ...prev,
      {
        id: `card-${Date.now()}`,
        emoji: 'Star',
        label: '',
        value: '',
        description: '',
        color: accentColor,
        position: { x: 50, y: 50 },
        iconType: 'svg',
        iconColor: '#FFFFFF',
        iconSize: 32,
        iconStyle: 'outline',
      },
    ]);
  };

  const update = (id: string, patch: Partial<InfoCard>) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };
  const remove = (id: string) => setCards((prev) => prev.filter((c) => c.id !== id));
  const duplicate = (id: string) => {
    setCards((prev) => {
      const src = prev.find((c) => c.id === id);
      if (!src) return prev;
      return [...prev, { ...src, id: `card-${Date.now()}`, position: src.position ? { x: src.position.x + 5, y: src.position.y + 5 } : undefined }];
    });
  };

  const suggestIcon = async (card: InfoCard) => {
    if (!card.label.trim() && !card.description.trim()) return;
    setAiBusyId(card.id);
    try {
      const r = await fetch('/api/content/icon-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: card.label,
          description: card.description,
          mode: card.iconType === 'svg' ? 'svg' : 'emoji',
          allowed: card.iconType === 'svg' ? ALL_LUCIDE_NAMES : undefined,
        }),
      });
      const data = await r.json();
      if (data.success) {
        if (card.iconType === 'svg' && data.iconName) {
          // Validate it's actually in our library
          if (ICON_MAP[data.iconName]) update(card.id, { emoji: data.iconName });
        } else if (data.emoji) {
          update(card.id, { emoji: data.emoji });
        }
      } else {
        console.warn('[icon-suggest] failed:', data.error);
      }
    } catch (err) {
      console.warn('[icon-suggest] error:', err);
    } finally {
      setAiBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      <button
        onClick={addEmptyCard}
        className="w-full rounded bg-purple-600 hover:bg-purple-500 px-3 py-2.5 text-xs font-semibold text-white flex items-center justify-center gap-1"
      >
        <Plus size={12} /> Ajouter une carte
      </button>
      <p className="text-[10px] text-gray-500 text-center leading-relaxed">
        Carte vide ajoutée au centre de l'aperçu. Glissez pour la déplacer, double-cliquez pour styles avancés.<br />
        Astuce : utilisez <code className="text-purple-300">**mot**</code> pour mettre en gras.
      </p>

      {cards.length === 0 && (
        <p className="text-[10px] text-gray-600 italic text-center pt-2">Aucune carte. Cliquez "+ Ajouter une carte".</p>
      )}

      {cards.map((card) => (
        <div key={card.id} className="rounded-lg border border-gray-700 bg-gray-800/50 p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-gray-500">Carte</span>
            <div className="flex gap-1">
              <button
                onClick={() => duplicate(card.id)}
                className="h-6 w-6 rounded flex items-center justify-center text-gray-400 hover:bg-gray-700 hover:text-white"
                title="Dupliquer"
              >
                <CopyIcon size={11} />
              </button>
              <button
                onClick={() => remove(card.id)}
                className="h-6 w-6 rounded flex items-center justify-center text-gray-400 hover:bg-red-600/20 hover:text-red-400"
                title="Supprimer"
              >
                <Trash2 size={11} />
              </button>
            </div>
          </div>

          <CardIconPicker
            card={card}
            update={(patch) => update(card.id, patch)}
            accentColor={accentColor}
            aiBusy={aiBusyId === card.id}
            onSuggestAI={() => suggestIcon(card)}
          />

          <div>
            <label className="text-[9px] uppercase text-gray-500">Titre</label>
            <textarea
              value={card.label}
              onChange={(e) => update(card.id, { label: e.target.value })}
              rows={1}
              style={{ resize: 'vertical' }}
              className="w-full mt-1 rounded border border-gray-600 bg-gray-700 px-2 py-1 text-xs text-white focus:border-purple-500 focus:outline-none"
              placeholder="Titre — Entrée pour saut de ligne"
            />
          </div>

          <div>
            <label className="text-[9px] uppercase text-gray-500">Description</label>
            <textarea
              value={card.description}
              onChange={(e) => update(card.id, { description: e.target.value })}
              rows={2}
              className="w-full mt-1 rounded border border-gray-600 bg-gray-700 px-2 py-1 text-xs text-gray-300 focus:border-purple-500 focus:outline-none resize-none"
              placeholder="Détail. Utilisez **mot** pour gras."
            />
          </div>

          <div>
            <label className="text-[9px] uppercase text-gray-500">Valeur</label>
            <textarea
              value={card.value}
              onChange={(e) => update(card.id, { value: e.target.value })}
              maxLength={24}
              rows={1}
              style={{ resize: 'vertical' }}
              className="w-full mt-1 rounded border border-gray-600 bg-gray-700 px-2 py-1 text-xs font-bold text-white focus:border-purple-500 focus:outline-none"
              placeholder="ex: +30% — Entrée pour saut de ligne"
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="text-[9px] uppercase text-gray-500">Couleur carte</label>
            <input
              type="color"
              value={card.color}
              onChange={(e) => update(card.id, { color: e.target.value })}
              className="h-6 w-10 rounded border border-gray-600 bg-transparent cursor-pointer"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

interface PexelsPhoto {
  id: string | number;
  url: string;
  medium: string;
  small: string;
  photographer: string;
  alt: string;
  source?: 'pexels' | 'unsplash';
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
  // ── 15 nouveaux univers de contenu ──
  {
    id: "beauty",
    label: "Beauté",
    emoji: "💄",
    pexelsQuery: "beauty makeup skincare cosmetics",
    color: "from-pink-500 to-rose-300",
  },
  {
    id: "parenting",
    label: "Parentalité",
    emoji: "👶",
    pexelsQuery: "family parenting children baby",
    color: "from-yellow-500 to-pink-300",
  },
  {
    id: "travel",
    label: "Voyage",
    emoji: "✈️",
    pexelsQuery: "travel destination adventure plane",
    color: "from-sky-500 to-cyan-300",
  },
  {
    id: "productivity",
    label: "Productivité",
    emoji: "🚀",
    pexelsQuery: "productivity workspace laptop focus",
    color: "from-lime-500 to-green-300",
  },
  {
    id: "finance",
    label: "Finance",
    emoji: "💰",
    pexelsQuery: "finance money stock market investment",
    color: "from-emerald-600 to-teal-400",
  },
  {
    id: "coding",
    label: "Coding",
    emoji: "💻",
    pexelsQuery: "coding developer programming laptop",
    color: "from-slate-700 to-slate-400",
  },
  {
    id: "crypto",
    label: "Crypto",
    emoji: "🪙",
    pexelsQuery: "bitcoin cryptocurrency blockchain trading",
    color: "from-amber-500 to-yellow-300",
  },
  {
    id: "gaming",
    label: "Gaming",
    emoji: "🎮",
    pexelsQuery: "gaming esports console controller",
    color: "from-fuchsia-600 to-purple-400",
  },
  {
    id: "food",
    label: "Food",
    emoji: "🍕",
    pexelsQuery: "food cooking chef recipe kitchen",
    color: "from-red-500 to-orange-400",
  },
  {
    id: "pets",
    label: "Animaux",
    emoji: "🐾",
    pexelsQuery: "pets dog cat animals",
    color: "from-orange-400 to-amber-300",
  },
  {
    id: "cars",
    label: "Auto",
    emoji: "🚗",
    pexelsQuery: "car automobile driving road",
    color: "from-red-700 to-rose-500",
  },
  {
    id: "realestate",
    label: "Immobilier",
    emoji: "🏠",
    pexelsQuery: "real estate house apartment keys",
    color: "from-stone-600 to-amber-400",
  },
  {
    id: "education",
    label: "Éducation",
    emoji: "📚",
    pexelsQuery: "education books study learning",
    color: "from-blue-600 to-indigo-400",
  },
  {
    id: "astrology",
    label: "Astrologie",
    emoji: "🔮",
    pexelsQuery: "astrology zodiac stars mystical",
    color: "from-violet-700 to-fuchsia-400",
  },
  {
    id: "motivation",
    label: "Motivation",
    emoji: "🔥",
    pexelsQuery: "motivation mindset success discipline",
    color: "from-red-600 to-orange-400",
  },
  {
    id: "personnalise",
    label: "Personnalisé",
    emoji: "✨",
    pexelsQuery: "",
    color: "from-gray-600 to-gray-400",
  },
];

// Synonym keywords for the theme search dropdown. Matched against a free-text
// query in addition to the theme's own label/id.
const THEME_KEYWORDS: Record<string, string[]> = {
  'sommeil-sport': ['sommeil', 'dormir', 'nuit', 'repos', 'sleep', 'sport', 'fitness', 'workout', 'gym'],
  'nutrition-danse': ['nutrition', 'alimentation', 'manger', 'food', 'diet', 'danse', 'dance'],
  'energie-cardio': ['énergie', 'energie', 'cardio', 'running', 'course', 'endurance', 'energy'],
  'stress-mental': ['stress', 'mental', 'anxiété', 'anxiete', 'meditation', 'méditation', 'calm', 'yoga', 'zen'],
  'communaute': ['communauté', 'communaute', 'community', 'groupe', 'social', 'famille'],
  'beauty': ['beauté', 'beaute', 'beauty', 'cosmétique', 'skincare', 'maquillage', 'makeup'],
  'parenting': ['parent', 'enfant', 'bébé', 'bebe', 'famille', 'kids', 'baby', 'parentalité'],
  'travel': ['voyage', 'travel', 'vacances', 'tourisme', 'aventure'],
  'productivity': ['productivité', 'productivite', 'productivity', 'travail', 'work', 'efficacité'],
  'finance': ['finance', 'argent', 'money', 'invest', 'épargne', 'epargne', 'budget'],
  'coding': ['code', 'coding', 'développeur', 'developer', 'programmation', 'tech', 'dev'],
  'crypto': ['crypto', 'bitcoin', 'eth', 'blockchain', 'web3', 'nft'],
  'gaming': ['gaming', 'jeu', 'game', 'esport', 'gamer'],
  'food': ['food', 'cuisine', 'recette', 'manger', 'gastronomie'],
  'pets': ['animaux', 'pet', 'chien', 'chat', 'dog', 'cat', 'animal'],
  'cars': ['auto', 'voiture', 'car', 'véhicule', 'moto'],
  'realestate': ['immobilier', 'real estate', 'maison', 'appartement', 'investissement'],
  'education': ['éducation', 'education', 'apprentissage', 'study', 'school', 'école', 'ecole'],
  'astrology': ['astrologie', 'astrology', 'horoscope', 'zodiac', 'signe'],
  'motivation': ['motivation', 'mindset', 'inspiration', 'success', 'goal'],
  'personnalise': ['personnalisé', 'personnalise', 'custom', 'personnel', 'autre', 'sujet'],
};

// ── Color Themes ───────────────────────────────────────────────
const COLOR_THEMES = [
  {
    id: "pink",
    name: "Rose",
    bg: "from-pink-600 to-pink-400",
    accent: "#ec4899",
    gradient: { start: "#EC4899", end: "#BE185D" },
  },
  {
    id: "purple",
    name: "Violet",
    bg: "from-purple-600 to-purple-400",
    accent: "#a855f7",
    gradient: { start: "#A855F7", end: "#7C3AED" },
  },
  {
    id: "blue",
    name: "Bleu",
    bg: "from-blue-600 to-blue-400",
    accent: "#3b82f6",
    gradient: { start: "#3B82F6", end: "#1D4ED8" },
  },
  {
    id: "green",
    name: "Vert",
    bg: "from-green-600 to-green-400",
    accent: "#10b981",
    gradient: { start: "#10B981", end: "#047857" },
  },
  {
    id: "orange",
    name: "Orange",
    bg: "from-orange-500 to-yellow-400",
    accent: "#f59e0b",
    gradient: { start: "#F59E0B", end: "#D97706" },
  },
  {
    id: "red",
    name: "Rouge",
    bg: "from-red-600 to-rose-400",
    accent: "#ef4444",
    gradient: { start: "#EF4444", end: "#B91C1C" },
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

// Map icon names from smart-content.ts to actual emoji characters (legacy fallback)
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

// Map smart-content icon names → lucide icon name (must exist in ICON_MAP)
const SMART_ICON_TO_LUCIDE: Record<string, string> = {
  droplet: 'Sparkles', brain: 'Brain', fire: 'Flame', shield: 'Cross', energy: 'Zap',
  thermometer: 'Activity', muscle: 'Dumbbell', apple: 'Apple', heart: 'Heart',
  moon: 'Moon', sun: 'Sun', chart: 'BarChart', audio: 'Music', leaf: 'Leaf',
  star: 'Star', clock: 'Activity', bone: 'Activity', eye: 'Sparkles',
  running: 'Activity', target: 'Target', vitamin: 'Pill', dna: 'Brain',
  scale: 'Activity', food: 'Utensils', water: 'Sparkles', sparkle: 'Sparkles',
  trophy: 'Trophy', people: 'Smile', plane: 'Plane', map: 'Map', mountain: 'Mountain',
  compass: 'Compass', camera: 'Camera', checklist: 'Award', calendar: 'Award',
  rocket: 'Rocket', hourglass: 'Activity', money: 'DollarSign', bank: 'Building',
  coin: 'DollarSign', piggy: 'DollarSign', bill: 'Receipt', code: 'Code',
  bug: 'Bot', gear: 'Cpu', keyboard: 'Laptop', cloud: 'Cloud', crypto: 'DollarSign',
  chain: 'Wallet', bitcoin: 'DollarSign', trend: 'TrendingUp', game: 'Smartphone',
  joystick: 'Smartphone', controller: 'Smartphone', dice: 'Award',
  pizza: 'Pizza', burger: 'Pizza', salad: 'Salad', chef: 'Utensils', knife: 'Utensils',
  dog: 'Dog', cat: 'Cat', paw: 'Dog', fish: 'Fish', bird: 'Bird',
  car: 'Car', fuel: 'Car', wheel: 'Car', key: 'Home', road: 'Map',
  house: 'Home', door: 'Home', keys: 'Home', building: 'Building',
  book: 'Book', pencil: 'Pencil', graduation: 'GraduationCap', lightbulb: 'Lightbulb',
  teacher: 'GraduationCap', zodiac: 'Star', stars: 'Star', crystal: 'Gem',
  planet: 'Globe', tarot: 'Sparkles', flex: 'Dumbbell', flame: 'Flame',
  crown: 'Trophy', thunder: 'Zap', lipstick: 'Brush', perfume: 'Sparkles',
  mirror: 'Sparkles', nailpolish: 'Brush', baby: 'Smile', family: 'Smile',
  bottle: 'Apple', school: 'GraduationCap', suitcase: 'Briefcase', beach: 'Sun',
  lungs: 'HeartPulse',
};

/** Convert any legacy emoji or smart-content key into a valid lucide name. */
function toLucideName(input: string | undefined): string {
  if (!input) return 'Sparkles';
  // Already a lucide name?
  if (ICON_MAP[input]) return input;
  // smart-content key?
  if (SMART_ICON_TO_LUCIDE[input]) return SMART_ICON_TO_LUCIDE[input];
  // Common emoji → lucide
  const EMOJI_MAP: Record<string, string> = {
    '💧': 'Sparkles', '🧠': 'Brain', '🔥': 'Flame', '⚡': 'Zap', '💪': 'Dumbbell',
    '🍎': 'Apple', '❤️': 'Heart', '🌙': 'Moon', '😴': 'Moon', '☀️': 'Sun',
    '📈': 'TrendingUp', '🎵': 'Music', '🎧': 'Music', '🌿': 'Leaf', '⭐': 'Star',
    '🏆': 'Trophy', '🎯': 'Target', '💊': 'Pill', '🧬': 'Brain', '🍽️': 'Utensils',
    '🛡️': 'Cross', '🌡️': 'Activity', '🦴': 'Activity', '👁️': 'Sparkles',
    '🏃': 'Activity', '⚖️': 'Activity', '✨': 'Sparkles', '🎬': 'Video',
    '📊': 'BarChart', '🎨': 'Palette', '💎': 'Gem', '🥗': 'Salad',
    '👶': 'Smile', '👨‍👩‍👧': 'Smile', '🍼': 'Apple', '🏫': 'GraduationCap',
    '✈️': 'Plane', '🗺️': 'Map', '🧳': 'Briefcase', '🏖️': 'Sun', '⛰️': 'Mountain',
    '🧭': 'Compass', '📸': 'Camera', '✅': 'Award', '📅': 'Award',
    '🚀': 'Rocket', '⏳': 'Activity', '💰': 'DollarSign', '🏦': 'Building',
    '🪙': 'DollarSign', '🐷': 'DollarSign', '💵': 'Receipt', '💻': 'Laptop',
    '🐛': 'Bot', '⚙️': 'Cpu', '⌨️': 'Laptop', '☁️': 'Cloud',
    '⛓️': 'Wallet', '🎮': 'Smartphone', '🕹️': 'Smartphone', '🎲': 'Award',
    '🍕': 'Pizza', '🍔': 'Pizza', '👨‍🍳': 'Utensils', '🔪': 'Utensils',
    '🐕': 'Dog', '🐈': 'Cat', '🐾': 'Dog', '🐟': 'Fish', '🐦': 'Bird',
    '🚗': 'Car', '⛽': 'Car', '🛞': 'Car', '🔑': 'Home', '🛣️': 'Map',
    '🏠': 'Home', '🚪': 'Home', '🗝️': 'Home', '🏢': 'Building',
    '📚': 'Book', '✏️': 'Pencil', '🎓': 'GraduationCap', '💡': 'Lightbulb',
    '👨‍🏫': 'GraduationCap', '🌟': 'Star', '🔮': 'Gem', '🪐': 'Globe', '🃏': 'Sparkles',
    '👑': 'Trophy', '💄': 'Brush', '🧴': 'Sparkles', '🪞': 'Sparkles', '💅': 'Brush',
    '👥': 'Smile', '🫁': 'HeartPulse', '📝': 'Pencil', '🎤': 'Mic',
  };
  if (EMOJI_MAP[input]) return EMOJI_MAP[input];
  return 'Sparkles';
}

/**
 * Label → Unicode emoji dictionary for foods, fruits, and common objects that
 * Lucide doesn't model well (Lucide has "Apple" but no "Ananas" / "Mangue" /
 * etc., so every fruit used to fall back to Apple). Matched against the card
 * label (and optionally description) with a substring check. Keys are normalized
 * (lowercase, accent-stripped).
 */
const LABEL_TO_EMOJI: Record<string, string> = {
  // Fruits
  ananas: '🍍', 'pina': '🍍', pineapple: '🍍',
  mangue: '🥭', mango: '🥭',
  avocat: '🥑', avocado: '🥑',
  banane: '🍌', banana: '🍌', plantain: '🍌',
  pomme: '🍎', apple: '🍎',
  citron: '🍋', lemon: '🍋', lime: '🍋',
  orange: '🍊', clementine: '🍊', mandarine: '🍊',
  fraise: '🍓', strawberry: '🍓',
  raisin: '🍇', grape: '🍇',
  pasteque: '🍉', watermelon: '🍉',
  melon: '🍈',
  cerise: '🍒', cherry: '🍒',
  peche: '🍑', peach: '🍑',
  poire: '🍐', pear: '🍐',
  kiwi: '🥝',
  coco: '🥥', noixcoco: '🥥', coconut: '🥥',
  myrtille: '🫐', blueberry: '🫐',
  framboise: '🍓', raspberry: '🍓',
  grenade: '🍎', pomegranate: '🍎',
  papaye: '🥭', papaya: '🥭',
  baobab: '🌳',
  // Vegetables / herbs
  tomate: '🍅', tomato: '🍅',
  carotte: '🥕', carrot: '🥕',
  brocoli: '🥦', broccoli: '🥦',
  piment: '🌶️', chili: '🌶️',
  champignon: '🍄', mushroom: '🍄',
  aubergine: '🍆', eggplant: '🍆',
  mais: '🌽', corn: '🌽',
  concombre: '🥒', cucumber: '🥒',
  poivron: '🫑', pepper: '🫑',
  patate: '🥔', potato: '🥔',
  igname: '🍠', yam: '🍠', sweetpotato: '🍠',
  oignon: '🧅', onion: '🧅',
  ail: '🧄', garlic: '🧄',
  gingembre: '🫚', ginger: '🫚',
  curcuma: '🟡', turmeric: '🟡',
  moringa: '🌿',
  epinard: '🥬', spinach: '🥬',
  salade: '🥗', lettuce: '🥗',
  manioc: '🍠',
  // Proteins / staples
  pain: '🍞', bread: '🍞',
  fromage: '🧀', cheese: '🧀',
  oeuf: '🥚', egg: '🥚',
  viande: '🥩', meat: '🥩', beef: '🥩',
  poulet: '🍗', chicken: '🍗',
  poisson: '🐟', fish: '🐟',
  crevette: '🍤', shrimp: '🍤',
  riz: '🍚', rice: '🍚',
  pate: '🍝', pasta: '🍝',
  quinoa: '🌾', avoine: '🌾', oats: '🌾', cereale: '🌾',
  legumineuse: '🫘', haricot: '🫘', lentille: '🫘', pois: '🫘',
  // Sweet / processed
  chocolat: '🍫', chocolate: '🍫',
  miel: '🍯', honey: '🍯',
  gateau: '🍰', cake: '🍰',
  beurre: '🧈',
  // Drinks
  the: '🍵', tea: '🍵', matcha: '🍵',
  cafe: '☕', coffee: '☕',
  lait: '🥛', milk: '🥛',
  eau: '💧', water: '💧', hydration: '💧', hydratation: '💧',
  jus: '🧃', juice: '🧃',
  smoothie: '🥤',
  vin: '🍷', wine: '🍷',
  biere: '🍺', beer: '🍺',
  // Nuts / seeds
  noix: '🥜', nut: '🥜', amande: '🥜', almond: '🥜',
  graine: '🌱', seed: '🌱', chia: '🌱', lin: '🌱',
  olive: '🫒',
  sesame: '🌱',
  arachide: '🥜', peanut: '🥜',
  // Wellness / body (prefer emoji over generic SVG when very specific)
  sommeil: '😴', sleep: '😴',
  meditation: '🧘', relaxation: '🧘',
  cerveau: '🧠', brain: '🧠',
  coeur: '❤️', heart: '❤️',
  poumon: '🫁', lungs: '🫁',
  os: '🦴', bone: '🦴',
  muscle: '💪', biceps: '💪',
  oeil: '👁️', eye: '👁️', vue: '👁️',
  dent: '🦷', teeth: '🦷',
  peau: '✨', skin: '✨',
  // Science / nutrients
  vitamine: '💊', vitamin: '💊',
  calcium: '🦴', magnesium: '💊', fer: '🩸', zinc: '💊', iode: '💊',
  omega: '🐟', potassium: '🍌', sodium: '🧂', sel: '🧂',
  antioxydant: '🫐', antioxidant: '🫐',
  proteine: '🥩', protein: '🥩',
  glucide: '🍞', carb: '🍞',
  lipide: '🧈', fat: '🧈',
  fibre: '🌾', fiber: '🌾',
};

/**
 * Resolve the best icon for a given card label/description. Returns an
 * emoji-mode descriptor when the label matches a food/object we have a
 * specific Unicode glyph for (ananas → 🍍), otherwise falls back to an
 * SVG-mode descriptor using the provided Lucide name.
 */
function resolveCardIcon(
  label: string | undefined,
  description: string | undefined,
  fallbackLucide: string,
): { iconType: 'emoji' | 'svg'; emoji: string } {
  const haystack = `${label || ''} ${description || ''}`.toLowerCase();
  const normalized = haystack
    .replace(/[éèêë]/g, 'e').replace(/[àâä]/g, 'a')
    .replace(/[ùûü]/g, 'u').replace(/[ôö]/g, 'o')
    .replace(/[îï]/g, 'i').replace(/[ç]/g, 'c')
    .replace(/[^a-z0-9 ]/g, ' ');
  const words = normalized.split(/\s+/).filter(Boolean);
  // Exact word match first (avoids "pain" in "panning" false positives).
  for (const w of words) {
    if (LABEL_TO_EMOJI[w]) return { iconType: 'emoji', emoji: LABEL_TO_EMOJI[w] };
  }
  // Fallback: substring scan for composite keys and partial matches.
  for (const key of Object.keys(LABEL_TO_EMOJI)) {
    if (key.length >= 4 && normalized.includes(key)) {
      return { iconType: 'emoji', emoji: LABEL_TO_EMOJI[key] };
    }
  }
  return { iconType: 'svg', emoji: fallbackLucide };
}

const PLATFORM_DISPLAY_NAMES: Record<PlatformKey, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  youtube: 'YouTube',
};

function InfographicPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── Deeplink edit state ─────────────────────────────────────
  // When calendar's "Ajouter le son" button routes to
  // /creer?postId=X&tab=audio, we fetch the post, prefill the
  // editor, and open the Audio tab so the user lands where they
  // were expecting to go.
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editingPostTitle, setEditingPostTitle] = useState<string>('');

  // ── Step wizard ─────────────────────────────────────────────
  const [step, setStep] = useState(0); // 0: Theme & Content, 1: Personnalisation, 2: Export

  // ── Step 0: Theme & Content ─────────────────────────────────
  const [contentTheme, setContentTheme] = useState("sommeil-sport");
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [themeSearch, setThemeSearch] = useState('');
  const themePickerRef = useRef<HTMLDivElement>(null);

  // Close the theme dropdown on outside click.
  useEffect(() => {
    if (!themePickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (themePickerRef.current && !themePickerRef.current.contains(e.target as Node)) {
        setThemePickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [themePickerOpen]);
  const [customTopic, setCustomTopic] = useState("");
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [extraTitle, setExtraTitle] = useState("");
  const [extraSubtitle, setExtraSubtitle] = useState("");
  const [showExtraTitleBlock, setShowExtraTitleBlock] = useState(false);
  // ── Extra title typography (parité avec le titre principal) ────────────
  const [extraTitleScale, setExtraTitleScale] = useState(1);
  const [extraTitleGradient, setExtraTitleGradient] = useState(false);
  const [extraTitleGradColor1, setExtraTitleGradColor1] = useState("#FFD700");
  const [extraTitleGradColor2, setExtraTitleGradColor2] = useState("#FF6B6B");
  const [extraTitleLetterSpacing, setExtraTitleLetterSpacing] = useState(0);
  const [extraTitleLineHeight, setExtraTitleLineHeight] = useState(1.1);
  const [extraTitleBold, setExtraTitleBold] = useState(true);
  const [extraTitleItalic, setExtraTitleItalic] = useState(false);
  const [extraSubtitleScale, setExtraSubtitleScale] = useState(1);
  const [extraSubtitleGradient, setExtraSubtitleGradient] = useState(false);
  const [extraSubtitleGradColor1, setExtraSubtitleGradColor1] = useState("#FFD700");
  const [extraSubtitleGradColor2, setExtraSubtitleGradColor2] = useState("#FF6B6B");
  const [extraSubtitleLetterSpacing, setExtraSubtitleLetterSpacing] = useState(0);
  const [extraSubtitleLineHeight, setExtraSubtitleLineHeight] = useState(1.2);
  const [extraSubtitleBold, setExtraSubtitleBold] = useState(false);
  const [extraSubtitleItalic, setExtraSubtitleItalic] = useState(false);
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
  const [characterScale, setCharacterScale] = useState(1);
  const [characterPosition, setCharacterPosition] = useState({ x: 85, y: 75 });

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
  const [autoGradient, setAutoGradient] = useState(false);
  const [gradientColor1, setGradientColor1] = useState("#7C3AED");
  const [gradientColor2, setGradientColor2] = useState("#EC4899");
  const [gradientOpacity, setGradientOpacity] = useState(0.3);

  // Rounded-corner + inner margin on the sequence backdrop. Applies
  // globally (every sequence) since per-sequence backgrounds are a single
  // system for now. Keeps backward-compat: rounded=false means flat
  // rectangle identical to the pre-feature behavior.
  const [backdropRounded, setBackdropRounded] = useState(false);
  const [backdropRadius, setBackdropRadius] = useState(24); // px, scaled to video resolution server-side
  const [backdropMargin, setBackdropMargin] = useState(0); // percent (0..20)
  // Per-sequence no-color mode (user decides which sequences have color or just photo)
  const [noColorBg, setNoColorBg] = useState(false);
  const [noColorSequences, setNoColorSequences] = useState<string[]>(['video']);
  const [noColorUserOverride, setNoColorUserOverride] = useState<Record<string, boolean>>({});
  const [syncColorsGlobal, setSyncColorsGlobal] = useState(false);

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
  const getComplementary = (hex: string): string => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max === min) {
      const target = Math.max(0, Math.min(1, (max + 0.5) / 2));
      const v = Math.round(target * 255).toString(16).padStart(2, '0');
      return `#${v}${v}${v}`;
    }
    let h = 0;
    const d = max - min;
    h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6
      : max === g ? ((b - r) / d + 2) / 6
      : ((r - g) / d + 4) / 6;
    h = (h + 0.5) % 1;
    const s = 0.7, l = 0.5;
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return '#' + [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)]
      .map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  };

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

  // ── Audio ────────────────────────────────────────────────────
  // ── Per-sequence voice-overs (PR A — state only, no UI yet) ─────────
  // Replaces the single `audioVoiceUrl` global voice-over with 4 independent
  // voices, one per sequence. Auto-filled from editor content (title for
  // titre, cards for cartes, etc.) but the user can edit each text freely;
  // `userEdited` flags prevent auto-fill from clobbering manual edits.
  // Legacy `audioVoiceUrl` stays supported below — the composer will pick
  // sequenceVoices when present, otherwise fall back to the global voice.
  const [sequenceVoices, setSequenceVoices] = useState<SequenceVoices>(() => emptySequenceVoices());
  const [sequenceVoicesUserEdited, setSequenceVoicesUserEdited] = useState<SequenceVoicesUserEdited>(() => emptySequenceVoicesUserEdited());

  const [audioMusicUrl, setAudioMusicUrl] = useState<string | null>(null);
  const [audioMusicName, setAudioMusicName] = useState('');
  const [audioVoiceUrl, setAudioVoiceUrl] = useState<string | null>(null);
  const [audioVoiceName, setAudioVoiceName] = useState('');
  const [audioMusicVolume, setAudioMusicVolume] = useState(0.5);
  const [audioVoiceVolume, setAudioVoiceVolume] = useState(1.0);

  // Audio ducking keyframes. Each entry sets the absolute music + rush
  // volumes (0-1) at a specific time (seconds from the start of the final
  // montage). Composer applies a stepped gain curve during the video
  // sequence. Default: one keyframe at t=0 with both music and rush at 100%
  // so the user hears the rush by default — they can duck it via keyframes.
  const [audioKeyframes, setAudioKeyframes] = useState<AudioKeyframe[]>([
    { id: 'kf-init', time: 0, musicVolume: 1, rushVolume: 1 },
  ]);
  const [autoDuckRunning, setAutoDuckRunning] = useState(false);
  // Playhead from AudioMixPreview — null while stopped, seconds while playing.
  const [mixPlayheadTime, setMixPlayheadTime] = useState<number | null>(null);

  // ── Video Upload ────────────────────────────────────────────
  // `rushList` is the source of truth for multi-rush (user can upload
  // several videos and reorder them). `rushUrl` / `rushFileName` are
  // kept as derived convenience values = first item of rushList, so
  // that all existing composer/export code paths continue to work
  // unchanged (they read rushUrl).
  const [rushList, setRushList] = useState<{ url: string; name: string; kind?: 'video' | 'image'; transform?: { scale: number; offsetX: number; offsetY: number }; fromClip?: boolean }[]>([]);
  const [cropRushIdx, setCropRushIdx] = useState<number | null>(null);
  const [rushUrl, setRushUrl] = useState<string | null>(null);
  const [rushFileName, setRushFileName] = useState<string | null>(null);
  // Track media-load failures via React state so a transient error
  // (e.g. Supabase 404 during quota issues) doesn't permanently hide the
  // <video>/<img> via direct `style.display = 'none'` mutation. The
  // previous handler kept the element invisible across re-renders even
  // after rushUrl became valid again.
  const [rushVideoError, setRushVideoError] = useState(false);
  const [rushImageError, setRushImageError] = useState(false);
  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const [videoUploadProgress, setVideoUploadProgress] = useState(0);
  const [rushDragIdx, setRushDragIdx] = useState<number | null>(null);
  const [rushDragOverIdx, setRushDragOverIdx] = useState<number | null>(null);

  // Clip detection modal state
  const [clipModalOpen, setClipModalOpen] = useState(false);
  const [clipSourceIdx, setClipSourceIdx] = useState<number | null>(null);
  const [clipAnalyzing, setClipAnalyzing] = useState(false);
  const [clipProgress, setClipProgress] = useState(0);
  const [clipStage, setClipStage] = useState("");
  const [detectedClips, setDetectedClips] = useState<DetectedClip[]>([]);
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set());
  const [clipExtracting, setClipExtracting] = useState(false);
  const [clipExtractProgress, setClipExtractProgress] = useState(0);
  const [clipExtractStage, setClipExtractStage] = useState("");
  const [clipTrims, setClipTrims] = useState<Record<string, { startTime: number; endTime: number }>>({});
  const [previewClipId, setPreviewClipId] = useState<string | null>(null);
  const clipSourceFileRef = useRef<File | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewStopTimerRef = useRef<number | null>(null);

  // Keep rushUrl/rushFileName in sync with rushList[0]
  useEffect(() => {
    const first = rushList[0];
    const nextUrl = first?.url ?? null;
    const nextName = first?.name ?? null;
    console.log('[RushSync] rushList[0] →', { url: nextUrl, kind: first?.kind, name: nextName });
    setRushUrl((p) => (p === nextUrl ? p : nextUrl));
    setRushFileName((p) => (p === nextName ? p : nextName));
  }, [rushList]);

  // Reset error flags whenever the rush URL changes — a fresh upload
  // gets a clean rendering attempt instead of inheriting the previous
  // failure state.
  useEffect(() => {
    setRushVideoError(false);
    setRushImageError(false);
  }, [rushUrl]);

  // ── Video Overlay Text ─────────────────────────────────────
  const [videoOverlayText, setVideoOverlayText] = useState("");
  const [isGeneratingOverlay, setIsGeneratingOverlay] = useState(false);

  // ── Auto-fill sequenceVoices.text from editor content ──────
  // For each sequence, regenerate the suggested voice-over text whenever
  // the underlying editor content changes. The `userEdited` flag (set by
  // the future PR B textarea onChange) blocks the auto-fill so manual
  // edits stick. Texts are pure strings — generation/upload happens in
  // PR B; this PR is just the data shape.
  useEffect(() => {
    const auto = buildAutoFillText({
      title,
      subtitle,
      cards: cards.map((c) => ({ label: c.label, value: c.value, description: c.description })),
      videoOverlayText,
      ctaMainText,
      ctaSubText,
    });
    setSequenceVoices((prev) => {
      let changed = false;
      const next: SequenceVoices = { ...prev };
      for (const key of SEQUENCE_KEYS) {
        if (sequenceVoicesUserEdited[key]) continue;
        if (prev[key].text !== auto[key]) {
          next[key] = { ...prev[key], text: auto[key] };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [title, subtitle, cards, videoOverlayText, ctaMainText, ctaSubText, sequenceVoicesUserEdited]);

  // ── Pexels Photos ───────────────────────────────────────────
  const [pexelsPhotos, setPexelsPhotos] = useState<PexelsPhoto[]>([]);
  const [pexelsLoading, setPexelsLoading] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [batchPhotoIndices, setBatchPhotoIndices] = useState<number[]>([]);
  const [photoSearchQuery, setPhotoSearchQuery] = useState("");
  const [imageSource, setImageSource] = useState<"pexels" | "unsplash">(() => {
    if (typeof window === "undefined") return "pexels";
    const saved = window.localStorage.getItem("imageSearchSource");
    return saved === "unsplash" ? "unsplash" : "pexels";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("imageSearchSource", imageSource);
  }, [imageSource]);

  useEffect(() => {
    setBatchPhotoIndices((prev) => prev.length > batchCount ? prev.slice(0, batchCount) : prev);
  }, [batchCount]);

  // ── Sequence Durations ──────────────────────────────────────
  const [introDuration, setIntroDuration] = useState(4);
  const [cardsDuration, setCardsDuration] = useState(6);
  const [videoDuration, setVideoDuration] = useState(12);
  const [ctaDuration, setCtaDuration] = useState(4);
  const [exportedSequences, setExportedSequences] = useState<{
    titre: boolean;
    cartes: boolean;
    video: boolean;
    cta: boolean;
  }>({ titre: true, cartes: true, video: true, cta: true });

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
  const [overlayColor, setOverlayColor] = useState('#FFFFFF');

  // Per-element font overrides. undefined = inherit selectedFont.
  const [titleFont, setTitleFont] = useState<string | undefined>(undefined);
  const [ctaFont, setCtaFont] = useState<string | undefined>(undefined);
  const [overlayFont, setOverlayFont] = useState<string | undefined>(undefined);
  const [watermarkFont, setWatermarkFont] = useState<string | undefined>(undefined);
  const [cardsFont, setCardsFont] = useState<string | undefined>(undefined);

  // Gradient on text (toggle + two colors) per element. Title already has
  // titleTextGradient/titleGradColor1/titleGradColor2 below.
  const [ctaTextGradient, setCtaTextGradient] = useState(false);
  const [ctaGradColor1, setCtaGradColor1] = useState('#FFD700');
  const [ctaGradColor2, setCtaGradColor2] = useState('#FF6B6B');
  const [overlayTextGradient, setOverlayTextGradient] = useState(false);
  const [overlayGradColor1, setOverlayGradColor1] = useState('#FFD700');
  const [overlayGradColor2, setOverlayGradColor2] = useState('#FF6B6B');
  const [watermarkTextGradient, setWatermarkTextGradient] = useState(false);
  const [watermarkGradColor1, setWatermarkGradColor1] = useState('#FFD700');
  const [watermarkGradColor2, setWatermarkGradColor2] = useState('#FF6B6B');
  // Scale + timing on the legacy (primary) overlay. 1.0 = 100 %.
  // endTime < 0 means "until the video sequence ends".
  const [overlayTextScale, setOverlayTextScale] = useState(1.0);
  const [overlayStartTime, setOverlayStartTime] = useState(0);
  const [overlayEndTime, setOverlayEndTime] = useState(-1);

  // Up to 3 extra overlays (tabs "Overlay 2/3/4" in the panel). Each
  // carries its own text / position / color / typography / timing so
  // the user can combine a CTA-style title with a smaller caption that
  // appears later, or any similar multi-text composition.
  type ExtraOverlay = {
    id: string;
    text: string;
    position: { x: number; y: number };
    color: string;
    scale: number;
    startTime: number;
    endTime: number; // -1 = until sequence end
    bold: boolean;
    italic: boolean;
    letterSpacing: number;
    lineHeight: number;
  };
  const [extraOverlays, setExtraOverlays] = useState<ExtraOverlay[]>([]);
  const [activeOverlayIdx, setActiveOverlayIdx] = useState(0); // 0 = legacy, 1+ = extraOverlays[idx-1]
  const [cardsLetterSpacing, setCardsLetterSpacing] = useState(0);
  const [customCardIcons, setCustomCardIcons] = useState<Record<string, string>>({});

  // Advanced text effects
  const [titleTextGradient, setTitleTextGradient] = useState(false);
  const [cardsLabelGradient, setCardsLabelGradient] = useState(false);
  const [cardsValueGradient, setCardsValueGradient] = useState(false);
  const [cardsDescriptionGradient, setCardsDescriptionGradient] = useState(false);
  const [cardsTextGradColor1, setCardsTextGradColor1] = useState("#a855f7");
  const [cardsTextGradColor2, setCardsTextGradColor2] = useState("#ec4899");
  const [ctaIconName, setCtaIconName] = useState<string | null>(null);
  const [ctaIconSearch, setCtaIconSearch] = useState('');
  const [ctaIconColor, setCtaIconColor] = useState("#ffffff");
  const [ctaIconGradient, setCtaIconGradient] = useState(false);
  const [ctaIconGradColor1, setCtaIconGradColor1] = useState("#a855f7");
  const [ctaIconGradColor2, setCtaIconGradColor2] = useState("#ec4899");
  const [ctaIconSize, setCtaIconSize] = useState(60);
  const [titleGradColor1, setTitleGradColor1] = useState("#FFD700");
  const [titleGradColor2, setTitleGradColor2] = useState("#FF6B6B");
  const [titleDuplicate, setTitleDuplicate] = useState(false);
  const [titleDuplicateOffset, setTitleDuplicateOffset] = useState(5);
  const [titleDuplicateOpacity, setTitleDuplicateOpacity] = useState(0.3);

  // ── Persist design preferences across sessions ─────────────
  // Only DESIGN is persisted (colors, typography, positions, sizes, format,
  // branding overrides, sequence visibility, filter, site text, etc).
  // CONTENT (title, subtitle, cards, selected photo, rush, music, voice,
  // character image) is NOT persisted — each visit starts a fresh creation.
  const DESIGN_PREFS_KEY = "studiio-creer-design-prefs";
  const LEGACY_CONFIG_KEY = "studiio_infographic_config"; // pre-split storage key, migrated on first load
  const [configLoaded, setConfigLoaded] = useState(false);
  const restoringFromStorage = useRef(true); // Skip auto-generate during initial localStorage restore

  // Load saved design prefs on mount. Prefer the new key; migrate from the
  // legacy key (which also stored content fields) when only the old key is
  // present — we read the design subset and drop the rest.
  useEffect(() => {
    try {
      let raw = localStorage.getItem(DESIGN_PREFS_KEY);
      if (!raw) raw = localStorage.getItem(LEGACY_CONFIG_KEY);
      if (raw) {
        const cfg = JSON.parse(raw);
        if (cfg.colorTheme) setColorTheme(cfg.colorTheme);
        if (cfg.format) setFormat(cfg.format);
        if (cfg.introDuration) setIntroDuration(cfg.introDuration);
        if (cfg.cardsDuration) setCardsDuration(cfg.cardsDuration);
        if (cfg.videoDuration) setVideoDuration(cfg.videoDuration);
        if (cfg.ctaDuration) setCtaDuration(cfg.ctaDuration);
        if (cfg.exportedSequences && typeof cfg.exportedSequences === "object") {
          // Garde-fou : si l'utilisateur a accidentellement désactivé
          // TOUTES les séquences (ou si la persistance a sauvé un état
          // corrompu), on revient aux défauts plutôt que d'exporter une
          // vidéo vide. Sans ce check, l'utilisateur voit l'export
          // "réussir" mais le MP4 ne contient rien d'utile.
          const r = cfg.exportedSequences as { titre?: boolean; cartes?: boolean; video?: boolean; cta?: boolean };
          const anyEnabled = !!(r.titre || r.cartes || r.video || r.cta);
          if (!anyEnabled) {
            console.warn('[Restore] exportedSequences all false, reverting to defaults');
            setExportedSequences({ titre: true, cartes: true, video: true, cta: true });
          } else {
            setExportedSequences((prev) => ({ ...prev, ...cfg.exportedSequences }));
          }
        }
        // Rushes, character image are NOT restored (volatile uploads).
        // Audio (musique/voix) IS restored below — see the audioMusic*/audioVoice* block.
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
        if (cfg.overlayColor) setOverlayColor(cfg.overlayColor);
        if (cfg.cardsLetterSpacing !== undefined)
          setCardsLetterSpacing(cfg.cardsLetterSpacing);
        // Advanced text effects
        if (cfg.titleTextGradient !== undefined) setTitleTextGradient(cfg.titleTextGradient);
        if (typeof cfg.cardsTextGradient === 'boolean') {
          // Legacy v25 single-flag → migrate to all 3
          setCardsLabelGradient(cfg.cardsTextGradient);
          setCardsValueGradient(cfg.cardsTextGradient);
          setCardsDescriptionGradient(cfg.cardsTextGradient);
        }
        if (cfg.cardsLabelGradient !== undefined) setCardsLabelGradient(cfg.cardsLabelGradient);
        if (cfg.cardsValueGradient !== undefined) setCardsValueGradient(cfg.cardsValueGradient);
        if (cfg.cardsDescriptionGradient !== undefined) setCardsDescriptionGradient(cfg.cardsDescriptionGradient);
        if (cfg.cardsTextGradColor1) setCardsTextGradColor1(cfg.cardsTextGradColor1);
        if (cfg.cardsTextGradColor2) setCardsTextGradColor2(cfg.cardsTextGradColor2);
        if (typeof cfg.ctaIconName === 'string' || cfg.ctaIconName === null) setCtaIconName(cfg.ctaIconName);
        if (cfg.ctaIconColor) setCtaIconColor(cfg.ctaIconColor);
        if (cfg.ctaIconGradient !== undefined) setCtaIconGradient(cfg.ctaIconGradient);
        if (cfg.ctaIconGradColor1) setCtaIconGradColor1(cfg.ctaIconGradColor1);
        if (cfg.ctaIconGradColor2) setCtaIconGradColor2(cfg.ctaIconGradColor2);
        if (typeof cfg.ctaIconSize === 'number') setCtaIconSize(cfg.ctaIconSize);
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
        if (typeof cfg.autoGradient === 'boolean') setAutoGradient(cfg.autoGradient);
        if (cfg.noColorSequences) setNoColorSequences(cfg.noColorSequences);
        if (cfg.noColorUserOverride) setNoColorUserOverride(cfg.noColorUserOverride);
        if (typeof cfg.syncColorsGlobal === 'boolean') setSyncColorsGlobal(cfg.syncColorsGlobal);
        if (cfg.seqGradients) setSeqGradients(cfg.seqGradients);
        if (cfg.textScale !== undefined) setTextScale(cfg.textScale);
        if (cfg.cardsTextScale !== undefined) setCardsTextScale(cfg.cardsTextScale);
        if (cfg.ctaTextScale !== undefined) setCtaTextScale(cfg.ctaTextScale);
        if (cfg.logoScale !== undefined) setLogoScale(cfg.logoScale);
        if (cfg.logoSequences) setLogoSequences(cfg.logoSequences);
        if (cfg.logoImage) setLogoImage(cfg.logoImage);
        if (cfg.customAccent) setCustomAccent(cfg.customAccent);
        if (cfg.customCardIcons) setCustomCardIcons(cfg.customCardIcons);
        // Positions des éléments
        if (cfg.titlePos) setTitlePos(cfg.titlePos);
        if (cfg.extraTitlePosition && typeof cfg.extraTitlePosition.x === 'number') setExtraTitlePosition(cfg.extraTitlePosition);
        if (cfg.extraSubtitlePosition && typeof cfg.extraSubtitlePosition.x === 'number') setExtraSubtitlePosition(cfg.extraSubtitlePosition);
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
        // Text copy the user typed themselves (theme choice, custom topic,
        // main title, subtitle) IS restored — even empty strings, so
        // clearing a field sticks. Cards, sales phrases and the chosen
        // poster photo are also restored so a manual edit survives a
        // page refresh; rushes / audio / character image / overlay text
        // remain volatile (fresh uploads per creation flow).
        if (cfg.contentTheme) setContentTheme(cfg.contentTheme);
        if (typeof cfg.customTopic === 'string') setCustomTopic(cfg.customTopic);
        if (typeof cfg.title === 'string') setTitle(cfg.title);
        if (typeof cfg.subtitle === 'string') setSubtitle(cfg.subtitle);
        if (typeof cfg.extraTitle === 'string') {
          setExtraTitle(cfg.extraTitle);
          if (cfg.extraTitle) setShowExtraTitleBlock(true);
        }
        if (typeof cfg.extraSubtitle === 'string') {
          setExtraSubtitle(cfg.extraSubtitle);
          if (cfg.extraSubtitle) setShowExtraTitleBlock(true);
        }
        if (typeof cfg.extraTitleScale === 'number') setExtraTitleScale(cfg.extraTitleScale);
        if (typeof cfg.extraTitleGradient === 'boolean') setExtraTitleGradient(cfg.extraTitleGradient);
        if (typeof cfg.extraTitleGradColor1 === 'string') setExtraTitleGradColor1(cfg.extraTitleGradColor1);
        if (typeof cfg.extraTitleGradColor2 === 'string') setExtraTitleGradColor2(cfg.extraTitleGradColor2);
        if (typeof cfg.extraTitleLetterSpacing === 'number') setExtraTitleLetterSpacing(cfg.extraTitleLetterSpacing);
        if (typeof cfg.extraTitleLineHeight === 'number') setExtraTitleLineHeight(cfg.extraTitleLineHeight);
        if (typeof cfg.extraTitleBold === 'boolean') setExtraTitleBold(cfg.extraTitleBold);
        if (typeof cfg.extraTitleItalic === 'boolean') setExtraTitleItalic(cfg.extraTitleItalic);
        if (typeof cfg.extraSubtitleScale === 'number') setExtraSubtitleScale(cfg.extraSubtitleScale);
        if (typeof cfg.extraSubtitleGradient === 'boolean') setExtraSubtitleGradient(cfg.extraSubtitleGradient);
        if (typeof cfg.extraSubtitleGradColor1 === 'string') setExtraSubtitleGradColor1(cfg.extraSubtitleGradColor1);
        if (typeof cfg.extraSubtitleGradColor2 === 'string') setExtraSubtitleGradColor2(cfg.extraSubtitleGradColor2);
        if (typeof cfg.extraSubtitleLetterSpacing === 'number') setExtraSubtitleLetterSpacing(cfg.extraSubtitleLetterSpacing);
        if (typeof cfg.extraSubtitleLineHeight === 'number') setExtraSubtitleLineHeight(cfg.extraSubtitleLineHeight);
        if (typeof cfg.extraSubtitleBold === 'boolean') setExtraSubtitleBold(cfg.extraSubtitleBold);
        if (typeof cfg.extraSubtitleItalic === 'boolean') setExtraSubtitleItalic(cfg.extraSubtitleItalic);
        if (Array.isArray(cfg.cards)) setCards(cfg.cards as InfoCard[]);
        if (Array.isArray(cfg.salesPhrases)) setSalesPhrases(cfg.salesPhrases as string[]);
        if (Array.isArray(cfg.pexelsPhotos)) setPexelsPhotos(cfg.pexelsPhotos as PexelsPhoto[]);
        if (typeof cfg.selectedPhotoIndex === 'number') setSelectedPhotoIndex(cfg.selectedPhotoIndex);
        if (Array.isArray(cfg.batchPhotoIndices)) setBatchPhotoIndices(cfg.batchPhotoIndices as number[]);
        // Audio (musique + voix) — URL Supabase stable, restaurée au refresh
        // pour que l'utilisateur ne perde pas son upload. Volumes idem.
        // Le set est immédiat (UI ne flash pas) ; un HEAD asynchrone valide
        // ensuite que le fichier existe encore (cleanup, quota, suppression
        // manuelle Supabase) et clear l'URL si elle est morte.
        if (typeof cfg.audioMusicUrl === 'string') setAudioMusicUrl(cfg.audioMusicUrl);
        if (typeof cfg.audioVoiceUrl === 'string') setAudioVoiceUrl(cfg.audioVoiceUrl);
        if (typeof cfg.audioMusicVolume === 'number') setAudioMusicVolume(cfg.audioMusicVolume);
        if (typeof cfg.audioVoiceVolume === 'number') setAudioVoiceVolume(cfg.audioVoiceVolume);
        // Per-sequence voice-overs — restore the shape if it was persisted.
        // We validate keys + shape so a corrupt entry doesn't crash the
        // editor; missing keys fall back to empty defaults.
        if (cfg.sequenceVoices && typeof cfg.sequenceVoices === 'object') {
          const restored = emptySequenceVoices();
          for (const key of SEQUENCE_KEYS) {
            const v = (cfg.sequenceVoices as Record<string, unknown>)[key];
            if (v && typeof v === 'object') {
              const sv = v as { text?: unknown; audioUrl?: unknown; source?: unknown; ttsVoice?: unknown; duration?: unknown };
              restored[key] = {
                text: typeof sv.text === 'string' ? sv.text : '',
                audioUrl: typeof sv.audioUrl === 'string' ? sv.audioUrl : null,
                source: sv.source === 'tts' || sv.source === 'record' ? sv.source : null,
                ttsVoice: typeof sv.ttsVoice === 'string' ? sv.ttsVoice : undefined,
                duration: typeof sv.duration === 'number' ? sv.duration : undefined,
              };
            }
          }
          setSequenceVoices(restored);
        }
        if (cfg.sequenceVoicesUserEdited && typeof cfg.sequenceVoicesUserEdited === 'object') {
          const ue = emptySequenceVoicesUserEdited();
          for (const key of SEQUENCE_KEYS) {
            const v = (cfg.sequenceVoicesUserEdited as Record<string, unknown>)[key];
            if (typeof v === 'boolean') ue[key] = v;
          }
          setSequenceVoicesUserEdited(ue);
        }
        // Rush video/image: the file already sits on Supabase, so the URL
        // is stable and cheap to persist. Survives a refresh without a
        // re-upload.
        if (Array.isArray(cfg.rushList) && cfg.rushList.length > 0) {
          setRushList(
            cfg.rushList
              .filter((r: unknown): r is { url: string; name: string } =>
                !!r && typeof (r as { url?: unknown }).url === 'string',
              )
              .map((r: { url: string; name?: string; kind?: 'video' | 'image'; transform?: { scale: number; offsetX: number; offsetY: number }; fromClip?: boolean }) => ({
                url: r.url,
                name: r.name || 'video.mp4',
                kind: r.kind,
                transform: r.transform,
                fromClip: r.fromClip,
              })),
          );
        }
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
        if (typeof cfg.showCenterGuides === 'boolean') setShowCenterGuides(cfg.showCenterGuides);
        if (typeof cfg.smartGuidesEnabled === 'boolean') setSmartGuidesEnabled(cfg.smartGuidesEnabled);
        if (typeof cfg.showGridOverlay === 'boolean') setShowGridOverlay(cfg.showGridOverlay);
        if (typeof cfg.overlayTextScale === 'number') setOverlayTextScale(cfg.overlayTextScale);
        if (typeof cfg.overlayStartTime === 'number') setOverlayStartTime(cfg.overlayStartTime);
        if (typeof cfg.overlayEndTime === 'number') setOverlayEndTime(cfg.overlayEndTime);
        if (typeof cfg.videoOverlayText === 'string') setVideoOverlayText(cfg.videoOverlayText);
        // Per-element font overrides
        if (typeof cfg.titleFont === 'string') setTitleFont(cfg.titleFont);
        if (typeof cfg.ctaFont === 'string') setCtaFont(cfg.ctaFont);
        if (typeof cfg.overlayFont === 'string') setOverlayFont(cfg.overlayFont);
        if (typeof cfg.watermarkFont === 'string') setWatermarkFont(cfg.watermarkFont);
        if (typeof cfg.cardsFont === 'string') setCardsFont(cfg.cardsFont);
        // Text gradients per element (title gradient was already handled above)
        if (typeof cfg.backdropRounded === 'boolean') setBackdropRounded(cfg.backdropRounded);
        if (typeof cfg.backdropRadius === 'number') setBackdropRadius(cfg.backdropRadius);
        if (typeof cfg.backdropMargin === 'number') setBackdropMargin(cfg.backdropMargin);
        if (typeof cfg.ctaTextGradient === 'boolean') setCtaTextGradient(cfg.ctaTextGradient);
        if (cfg.ctaGradColor1) setCtaGradColor1(cfg.ctaGradColor1);
        if (cfg.ctaGradColor2) setCtaGradColor2(cfg.ctaGradColor2);
        if (typeof cfg.overlayTextGradient === 'boolean') setOverlayTextGradient(cfg.overlayTextGradient);
        if (cfg.overlayGradColor1) setOverlayGradColor1(cfg.overlayGradColor1);
        if (cfg.overlayGradColor2) setOverlayGradColor2(cfg.overlayGradColor2);
        if (typeof cfg.watermarkTextGradient === 'boolean') setWatermarkTextGradient(cfg.watermarkTextGradient);
        if (cfg.watermarkGradColor1) setWatermarkGradColor1(cfg.watermarkGradColor1);
        if (cfg.watermarkGradColor2) setWatermarkGradColor2(cfg.watermarkGradColor2);
        if (Array.isArray(cfg.extraOverlays)) {
          setExtraOverlays(
            cfg.extraOverlays.filter(
              (o: unknown): o is ExtraOverlay =>
                !!o && typeof (o as ExtraOverlay).text === 'string',
            ).slice(0, 3),
          );
        }
        if (Array.isArray(cfg.audioKeyframes) && cfg.audioKeyframes.length > 0) {
          setAudioKeyframes(
            cfg.audioKeyframes.filter(
              (k: unknown): k is AudioKeyframe =>
                !!k
                && typeof (k as AudioKeyframe).time === 'number'
                && typeof (k as AudioKeyframe).musicVolume === 'number'
                && typeof (k as AudioKeyframe).rushVolume === 'number',
            ),
          );
        }
        if (Array.isArray(cfg.cardGroups)) {
          setCardGroups(
            cfg.cardGroups.filter(
              (g: unknown): g is CardGroup =>
                !!g && typeof (g as CardGroup).id === 'string' && Array.isArray((g as CardGroup).cardIds),
            ),
          );
        }
        if (cfg.cardPositionMode === 'grid' || cfg.cardPositionMode === 'free') setCardPositionMode(cfg.cardPositionMode);
        if (cfg.exportFormat === 'video' || cfg.exportFormat === 'jpeg' || cfg.exportFormat === 'png') {
          setExportFormat(cfg.exportFormat);
        }
        // Per-sequence backgrounds (Phase 1+2) — shape validation per key.
        if (cfg.sequenceBackgrounds && typeof cfg.sequenceBackgrounds === 'object') {
          const restored: SequenceBackgrounds = { titre: null, cartes: null, video: null, cta: null };
          for (const key of ['titre', 'cartes', 'video', 'cta'] as const) {
            const raw = (cfg.sequenceBackgrounds as Record<string, unknown>)[key];
            if (raw && typeof raw === 'object') {
              const cfg2 = raw as { url?: unknown; opacity?: unknown; filters?: unknown };
              const url = typeof cfg2.url === 'string' ? cfg2.url : null;
              const opacity = typeof cfg2.opacity === 'number' && cfg2.opacity >= 0 && cfg2.opacity <= 1 ? cfg2.opacity : 1;
              let filters: ImageFilters | undefined;
              if (cfg2.filters && typeof cfg2.filters === 'object') {
                const f = cfg2.filters as Record<string, unknown>;
                filters = {
                  brightness: typeof f.brightness === 'number' ? f.brightness : 1,
                  contrast: typeof f.contrast === 'number' ? f.contrast : 1,
                  saturation: typeof f.saturation === 'number' ? f.saturation : 1,
                  temperature: typeof f.temperature === 'number' ? f.temperature : 0,
                  blur: typeof f.blur === 'number' ? f.blur : 0,
                  vignette: typeof f.vignette === 'number' ? f.vignette : 0,
                };
              }
              const objectPosition = typeof (cfg2 as Record<string, unknown>).objectPosition === 'string' ? (cfg2 as Record<string, unknown>).objectPosition as string : undefined;
              if (url || opacity !== 1 || filters || objectPosition) restored[key] = { url, opacity, ...(filters ? { filters } : {}), ...(objectPosition ? { objectPosition } : {}) };
            }
          }
          setSequenceBackgrounds(restored);
        }

        // ── Phase 4: HEAD validation des URLs Supabase restaurées ──
        // Les URLs sont set IMMÉDIATEMENT (UI ne flash pas), puis un fetch
        // HEAD en background détecte les URLs mortes (cleanup, quota dépassé,
        // fichier supprimé manuellement) et clear le state. Le user voit donc
        // son audio "tenté de charger" et disparaître proprement plutôt
        // qu'une URL qui plante au premier <audio src>.
        const validateAndClearUrl = async (
          url: string | null | undefined,
          clear: () => void,
          label: string,
        ) => {
          if (!url || typeof url !== 'string') return;
          try {
            const res = await fetch(url, { method: 'HEAD' });
            if (!res.ok) {
              console.warn(`[Restore] ${label} URL invalide (HTTP ${res.status}), clearing :`, url.substring(0, 80));
              clear();
            }
          } catch (err) {
            console.warn(`[Restore] ${label} HEAD échoué, clearing :`, err);
            clear();
          }
        };
        // Fire-and-forget — ne bloque pas le mount
        if (typeof cfg.audioMusicUrl === 'string') {
          validateAndClearUrl(cfg.audioMusicUrl, () => setAudioMusicUrl(null), 'audioMusicUrl');
        }
        if (typeof cfg.audioVoiceUrl === 'string') {
          validateAndClearUrl(cfg.audioVoiceUrl, () => setAudioVoiceUrl(null), 'audioVoiceUrl');
        }
        if (cfg.sequenceVoices && typeof cfg.sequenceVoices === 'object') {
          for (const key of SEQUENCE_KEYS) {
            const sv = (cfg.sequenceVoices as Record<string, { audioUrl?: unknown }>)[key];
            if (sv && typeof sv.audioUrl === 'string') {
              validateAndClearUrl(sv.audioUrl, () => {
                setSequenceVoices((prev) => ({
                  ...prev,
                  [key]: { ...prev[key], audioUrl: null, source: null, duration: undefined },
                }));
              }, `sequenceVoices.${key}.audioUrl`);
            }
          }
        }
        if (Array.isArray(cfg.rushList)) {
          for (const r of cfg.rushList as Array<{ url?: string }>) {
            if (r && typeof r.url === 'string') {
              const deadUrl = r.url;
              validateAndClearUrl(deadUrl, () => {
                setRushList((prev) => prev.filter((x) => x.url !== deadUrl));
              }, 'rushList');
            }
          }
        }

        // ── Phase 6: Toast de restauration ──
        // Liste des items restaurés (texte FR pour l'utilisateur). On ne
        // montre rien si le snapshot est vide (premier visit).
        const restoredItems: string[] = [];
        if (cfg.title) restoredItems.push('titre');
        if (Array.isArray(cfg.cards) && cfg.cards.length > 0) {
          restoredItems.push(`${cfg.cards.length} carte${cfg.cards.length > 1 ? 's' : ''}`);
        }
        if (Array.isArray(cfg.rushList) && cfg.rushList.length > 0) restoredItems.push('vidéo rush');
        if (cfg.audioMusicUrl) restoredItems.push('musique');
        const hasAnyVoice = !!cfg.audioVoiceUrl || (
          cfg.sequenceVoices && typeof cfg.sequenceVoices === 'object'
            && Object.values(cfg.sequenceVoices as Record<string, { audioUrl?: unknown }>).some(
              (v) => v && typeof v.audioUrl === 'string'
            )
        );
        if (hasAnyVoice) restoredItems.push('voix-off');
        if (Array.isArray(cfg.cardGroups) && cfg.cardGroups.length > 0) restoredItems.push('groupes');
        if (restoredItems.length > 0) {
          // Defer to let the UI render first (toast over hydrated DOM)
          setTimeout(() => {
            showToast(`✓ Configuration restaurée (${restoredItems.join(', ')})`, 'success');
          }, 300);
        }
      }
    } catch {
      /* ignore */
    }
    // Marquer comme chargé APRÈS la restauration pour éviter que le save n'écrase les valeurs
    setConfigLoaded(true);
    // Allow auto-generate to work again after initial restore (next tick)
    requestAnimationFrame(() => { restoringFromStorage.current = false; });
  }, []);

  // ── Deeplink: /creer?postId=X&tab=audio ──────────────────────
  // Fetch the post, prefill the editor, and switch to the requested tab.
  useEffect(() => {
    const postId = searchParams?.get('postId');
    const tab = searchParams?.get('tab');
    if (!postId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/posts/${postId}`);
        const data = await res.json().catch(() => ({ success: false }));
        if (cancelled || !data?.success || !data.data) {
          console.warn('[Deeplink] Post fetch failed:', data?.error);
          return;
        }
        const post = data.data;
        const meta = post.metadata || {};
        setEditingPostId(post.id);
        setEditingPostTitle(post.title || meta.title || '');

        if (post.title) setTitle(post.title);
        if (meta.subtitle) setSubtitle(meta.subtitle);
        if (Array.isArray(meta.cards) && meta.cards.length > 0) {
          setCards(meta.cards.map((c: Partial<InfoCard> & { id?: string }, i: number) => ({
            id: c.id || `card-${i}`,
            emoji: c.emoji || '',
            label: c.label || '',
            value: c.value || '',
            description: c.description || '',
            color: c.color || '#a855f7',
            position: c.position,
            iconType: c.iconType,
            iconColor: c.iconColor,
            iconFillColor: c.iconFillColor,
            iconSize: c.iconSize,
            iconStyle: c.iconStyle,
          })));
        }

        // Poster photo: inject a synthetic pexels-style entry so the
        // existing photo picker + export flow see it as "the selected
        // photo". This preserves the rest of the pipeline untouched.
        const posterUrl: string | undefined = meta.posterUrl || meta.pexelsUrl;
        if (posterUrl) {
          setPexelsPhotos([{
            id: `deeplink-${post.id}`,
            url: posterUrl,
            medium: posterUrl,
            small: posterUrl,
            photographer: '',
            alt: post.title || '',
          }]);
          setSelectedPhotoIndex(0);
        }

        // Rush (video or image)
        const rushUrl: string | undefined = meta.videoUrl || meta.videoImageUrl || meta.rushUrls?.[0];
        if (rushUrl) {
          const rushKind: 'video' | 'image' = meta.rushKind === 'image' || !!meta.videoImageUrl ? 'image' : 'video';
          setRushList([{ url: rushUrl, name: rushUrl.split('/').pop() || 'rush', kind: rushKind }]);
        }

        // Audio — the whole point of the deeplink
        if (meta.musicUrl) {
          setAudioMusicUrl(meta.musicUrl);
          setAudioMusicName(meta.musicName || 'Musique');
        }
        if (meta.voiceUrl) {
          setAudioVoiceUrl(meta.voiceUrl);
          setAudioVoiceName(meta.voiceName || 'Voix');
        }
        if (typeof meta.musicVolume === 'number') setAudioMusicVolume(meta.musicVolume);
        if (typeof meta.voiceVolume === 'number') setAudioVoiceVolume(meta.voiceVolume);

        if (tab === 'audio') setActiveRailTab('audio');

        // Wipe the undo history so Cmd+Z doesn't roll back before the
        // deeplink load. The save effect will commit a fresh baseline.
        history.reset();
      } catch (err) {
        console.error('[Deeplink] Error fetching post:', err);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // ── Auto-rule: titre gets noColor when a poster photo is loaded ────
  const selectedPhotoUrl = (pexelsPhotos as any[])?.[selectedPhotoIndex]?.url;
  useEffect(() => {
    if (!configLoaded) return;
    if (noColorUserOverride?.titre) return;
    const hasPhoto = !!selectedPhotoUrl;
    setNoColorSequences((prev) => {
      const has = prev.includes('titre');
      if (hasPhoto && !has) return [...prev, 'titre'];
      if (!hasPhoto && has) return prev.filter((s) => s !== 'titre');
      return prev;
    });
  }, [selectedPhotoUrl, configLoaded, noColorUserOverride?.titre]);

  // ── Safe Zone Overlay (additive — does not affect existing logic) ────
  const [safeZonePlatform, setSafeZonePlatform] = useState<string | null>(null);

  // ── Center guides (horizontal + vertical dashed lines through preview center) ────
  const [showCenterGuides, setShowCenterGuides] = useState(false);
  const [showThirdsGuides, setShowThirdsGuides] = useState(false);
  // ── Smart alignment guides + optional 8×8 grid overlay ────────────
  const [smartGuidesEnabled, setSmartGuidesEnabled] = useState(true);
  const [showGridOverlay, setShowGridOverlay] = useState(false);
  const [activeGuides, setActiveGuides] = useState<ActiveGuide[]>([]);
  const [activeDistanceBadges, setActiveDistanceBadges] = useState<DistanceBadge[]>([]);

  // ── Card position mode: 'grid' (default) uses the grid layout, 'free'
  // allows each card to be dragged independently using its `position` field.
  const [cardPositionMode, setCardPositionMode] = useState<'grid' | 'free'>('grid');
  // Index of the card being dragged in free mode (null when not dragging).
  const [dragCardIdx, setDragCardIdx] = useState<number | null>(null);
  // Drag-and-drop SVG icon from picker → specific card. Highlights the
  // hovered card in the preview during drag.
  const [dragOverIconCardIdx, setDragOverIconCardIdx] = useState<number | null>(null);
  const handleIconDrop = (idx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const iconName = e.dataTransfer.getData('text/plain');
    if (!iconName || !ICON_MAP[iconName]) { setDragOverIconCardIdx(null); return; }
    setCards((prev) => prev.map((c, i) => i === idx ? { ...c, emoji: iconName, iconType: 'svg' } : c));
    setDragOverIconCardIdx(null);
  };

  // ── Multi-select + groups (free-position mode only) ───────────
  // selectedCardIds is session-only. cardGroups persists in design prefs so
  // a user's logical groupings survive reloads.
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  type CardGroup = { id: string; cardIds: string[]; color: string };
  const [cardGroups, setCardGroups] = useState<CardGroup[]>([]);
  // Drag-select rectangle on the preview background (free-mode only).
  const [dragSelectRect, setDragSelectRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const dragSelectStartRef = useRef<{ x: number; y: number } | null>(null);

  // ESC clears the card multi-selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedCardIds.size > 0) {
        setSelectedCardIds(new Set());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedCardIds.size]);

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
    Montserrat: "var(--font-montserrat)",
    Oswald: "var(--font-oswald)",
    "Playfair Display": "var(--font-playfair)",
    Raleway: "var(--font-raleway)",
    "Roboto Condensed": "var(--font-roboto-condensed)",
    Lora: "var(--font-lora)",
    "Dancing Script": "var(--font-dancing)",
    "Permanent Marker": "var(--font-marker)",
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

  // Sequence view: show individual "pages" in preview.
  // Default "titre" — "all" is transitoire (cycle Lire ▶ uniquement) et
  // empilerait toutes les séquences au mount si utilisé comme état initial.
  const [activeSequence, setActiveSequence] = useState<
    "all" | "titre" | "cartes" | "video" | "cta"
  >("titre");

  // Drag positions (percentage-based offsets from default)
  const [titlePos, setTitlePos] = useState({ x: 50, y: 10 });
  const [extraTitlePosition, setExtraTitlePosition] = useState<{ x: number; y: number }>({ x: 50, y: 50 });
  const [extraSubtitlePosition, setExtraSubtitlePosition] = useState<{ x: number; y: number }>({ x: 50, y: 58 });
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
  // Ref to the rush <video> in the preview so we can track currentTime
  // and gate overlay visibility on the user-configured start/end windows.
  const rushVideoRef = useRef<HTMLVideoElement | null>(null);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);

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
      ...(exportedSequences.titre ? [{ key: 'titre' as const, duration: introDuration }] : []),
      ...(cards.length > 0 && exportedSequences.cartes ? [{ key: 'cartes' as const, duration: cardsDuration }] : []),
      ...(rushUrl && exportedSequences.video ? [{ key: 'video' as const, duration: videoDuration }] : []),
      ...(exportedSequences.cta ? [{ key: 'cta' as const, duration: ctaDuration }] : []),
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
  }, [stopPlayback, introDuration, cardsDuration, videoDuration, ctaDuration, cards.length, rushUrl, exportedSequences]);

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
  // Cards-only text scale (in %, 100 = neutral). Independent from `textScale`
  // so the user can grow/shrink card text without touching title/CTA.
  const [cardsTextScale, setCardsTextScale] = useState(100);

  // CTA text scale (separate from global textScale, for CTA-specific sizing)
  const [ctaTextScale, setCtaTextScale] = useState(1.0);

  // CTA sub-text color (separate from main ctaColor)
  const [ctaSubColor, setCtaSubColor] = useState("#D91CD2");

  // ── Undo / Redo history ─────────────────────────────────────
  // A single snapshot captures the whole design surface; the history
  // hook debounces commits so slider drags don't spam 50 entries. The
  // save effect below is also the "commit" moment — we centralize the
  // snapshot shape in one place.
  const history = useDesignHistory<Record<string, unknown>>(null, { debounceMs: 500, maxSize: 50 });
  const [undoToast, setUndoToast] = useState<string | null>(null);

  /** Apply a previously captured snapshot by calling every relevant setter. */
  const applyDesignSnapshot = (cfg: Record<string, unknown>) => {
    const c = cfg as Record<string, any>;
    if (c.colorTheme) setColorTheme(c.colorTheme);
    if (c.format) setFormat(c.format);
    if (typeof c.introDuration === 'number') setIntroDuration(c.introDuration);
    if (typeof c.cardsDuration === 'number') setCardsDuration(c.cardsDuration);
    if (typeof c.videoDuration === 'number') setVideoDuration(c.videoDuration);
    if (typeof c.ctaDuration === 'number') setCtaDuration(c.ctaDuration);
    if (c.exportedSequences && typeof c.exportedSequences === 'object') {
      setExportedSequences((prev) => ({ ...prev, ...c.exportedSequences }));
    }
    if (c.titleLetterSpacing !== undefined) setTitleLetterSpacing(c.titleLetterSpacing);
    if (c.titleLineHeight !== undefined) setTitleLineHeight(c.titleLineHeight);
    if (c.titleBold !== undefined) setTitleBold(c.titleBold);
    if (c.titleItalic !== undefined) setTitleItalic(c.titleItalic);
    if (c.ctaLetterSpacing !== undefined) setCtaLetterSpacing(c.ctaLetterSpacing);
    if (c.ctaLineHeight !== undefined) setCtaLineHeight(c.ctaLineHeight);
    if (c.ctaBold !== undefined) setCtaBold(c.ctaBold);
    if (c.ctaItalic !== undefined) setCtaItalic(c.ctaItalic);
    if (c.overlayLetterSpacing !== undefined) setOverlayLetterSpacing(c.overlayLetterSpacing);
    if (c.overlayLineHeight !== undefined) setOverlayLineHeight(c.overlayLineHeight);
    if (c.overlayBold !== undefined) setOverlayBold(c.overlayBold);
    if (c.overlayItalic !== undefined) setOverlayItalic(c.overlayItalic);
    if (c.overlayColor) setOverlayColor(c.overlayColor);
    if (c.cardsLetterSpacing !== undefined) setCardsLetterSpacing(c.cardsLetterSpacing);
    if (c.titleTextGradient !== undefined) setTitleTextGradient(c.titleTextGradient);
    if (typeof c.cardsTextGradient === 'boolean') {
      setCardsLabelGradient(c.cardsTextGradient);
      setCardsValueGradient(c.cardsTextGradient);
      setCardsDescriptionGradient(c.cardsTextGradient);
    }
    if (c.cardsLabelGradient !== undefined) setCardsLabelGradient(c.cardsLabelGradient);
    if (c.cardsValueGradient !== undefined) setCardsValueGradient(c.cardsValueGradient);
    if (c.cardsDescriptionGradient !== undefined) setCardsDescriptionGradient(c.cardsDescriptionGradient);
    if (c.cardsTextGradColor1) setCardsTextGradColor1(c.cardsTextGradColor1);
    if (c.cardsTextGradColor2) setCardsTextGradColor2(c.cardsTextGradColor2);
    if (typeof c.ctaIconName === 'string' || c.ctaIconName === null) setCtaIconName(c.ctaIconName);
    if (c.ctaIconColor) setCtaIconColor(c.ctaIconColor);
    if (c.ctaIconGradient !== undefined) setCtaIconGradient(c.ctaIconGradient);
    if (c.ctaIconGradColor1) setCtaIconGradColor1(c.ctaIconGradColor1);
    if (c.ctaIconGradColor2) setCtaIconGradColor2(c.ctaIconGradColor2);
    if (typeof c.ctaIconSize === 'number') setCtaIconSize(c.ctaIconSize);
    if (c.titleGradColor1) setTitleGradColor1(c.titleGradColor1);
    if (c.titleGradColor2) setTitleGradColor2(c.titleGradColor2);
    if (c.titleDuplicate !== undefined) setTitleDuplicate(c.titleDuplicate);
    if (c.titleDuplicateOffset !== undefined) setTitleDuplicateOffset(c.titleDuplicateOffset);
    if (c.titleDuplicateOpacity !== undefined) setTitleDuplicateOpacity(c.titleDuplicateOpacity);
    if (c.selectedFont) setSelectedFont(c.selectedFont);
    if (c.selectedFilter) setSelectedFilter(c.selectedFilter);
    if (c.selectedCardStyle) setSelectedCardStyle(c.selectedCardStyle);
    if (c.titleColor) setTitleColor(c.titleColor);
    if (c.ctaColor) setCtaColor(c.ctaColor);
    if (c.ctaSubColor) setCtaSubColor(c.ctaSubColor);
    if (c.ctaMainText !== undefined) setCtaMainText(c.ctaMainText);
    if (c.ctaSubText !== undefined) setCtaSubText(c.ctaSubText);
    if (c.gradientColor1) setGradientColor1(c.gradientColor1);
    if (c.gradientColor2) setGradientColor2(c.gradientColor2);
    if (c.gradientOpacity !== undefined) setGradientOpacity(c.gradientOpacity);
    if (c.noColorBg !== undefined) setNoColorBg(c.noColorBg);
    if (typeof c.autoGradient === 'boolean') setAutoGradient(c.autoGradient);
    if (c.noColorSequences) setNoColorSequences(c.noColorSequences);
    if (c.noColorUserOverride) setNoColorUserOverride(c.noColorUserOverride);
    if (typeof c.syncColorsGlobal === 'boolean') setSyncColorsGlobal(c.syncColorsGlobal);
    if (c.seqGradients) setSeqGradients(c.seqGradients);
    if (c.textScale !== undefined) setTextScale(c.textScale);
    if (c.cardsTextScale !== undefined) setCardsTextScale(c.cardsTextScale);
    if (c.ctaTextScale !== undefined) setCtaTextScale(c.ctaTextScale);
    if (c.logoScale !== undefined) setLogoScale(c.logoScale);
    if (c.logoSequences) setLogoSequences(c.logoSequences);
    if (c.logoImage !== undefined) setLogoImage(c.logoImage);
    if (c.customAccent !== undefined) setCustomAccent(c.customAccent);
    if (c.customCardIcons) setCustomCardIcons(c.customCardIcons);
    if (c.titlePos) setTitlePos(c.titlePos);
    if (c.extraTitlePosition && typeof c.extraTitlePosition.x === 'number') setExtraTitlePosition(c.extraTitlePosition);
    if (c.extraSubtitlePosition && typeof c.extraSubtitlePosition.x === 'number') setExtraSubtitlePosition(c.extraSubtitlePosition);
    if (c.logoPositions) setLogoPositions(c.logoPositions);
    if (c.watermarkPos) setWatermarkPos(c.watermarkPos);
    if (c.cardsPos) setCardsPos(c.cardsPos);
    if (c.overlayPos) setOverlayPos(c.overlayPos);
    if (typeof c.titleSize === 'number') setTitleSize(c.titleSize);
    if (typeof c.cardsSize === 'number') setCardsSize(c.cardsSize);
    if (typeof c.watermarkSize === 'number') setWatermarkSize(c.watermarkSize);
    if (typeof c.contentTheme === 'string') setContentTheme(c.contentTheme);
    if (typeof c.customTopic === 'string') setCustomTopic(c.customTopic);
    if (typeof c.title === 'string') setTitle(c.title);
    if (typeof c.subtitle === 'string') setSubtitle(c.subtitle);
    if (typeof c.extraTitle === 'string') setExtraTitle(c.extraTitle);
    if (typeof c.extraSubtitle === 'string') setExtraSubtitle(c.extraSubtitle);
    if (typeof c.extraTitleScale === 'number') setExtraTitleScale(c.extraTitleScale);
    if (typeof c.extraTitleGradient === 'boolean') setExtraTitleGradient(c.extraTitleGradient);
    if (typeof c.extraTitleGradColor1 === 'string') setExtraTitleGradColor1(c.extraTitleGradColor1);
    if (typeof c.extraTitleGradColor2 === 'string') setExtraTitleGradColor2(c.extraTitleGradColor2);
    if (typeof c.extraTitleLetterSpacing === 'number') setExtraTitleLetterSpacing(c.extraTitleLetterSpacing);
    if (typeof c.extraTitleLineHeight === 'number') setExtraTitleLineHeight(c.extraTitleLineHeight);
    if (typeof c.extraTitleBold === 'boolean') setExtraTitleBold(c.extraTitleBold);
    if (typeof c.extraTitleItalic === 'boolean') setExtraTitleItalic(c.extraTitleItalic);
    if (typeof c.extraSubtitleScale === 'number') setExtraSubtitleScale(c.extraSubtitleScale);
    if (typeof c.extraSubtitleGradient === 'boolean') setExtraSubtitleGradient(c.extraSubtitleGradient);
    if (typeof c.extraSubtitleGradColor1 === 'string') setExtraSubtitleGradColor1(c.extraSubtitleGradColor1);
    if (typeof c.extraSubtitleGradColor2 === 'string') setExtraSubtitleGradColor2(c.extraSubtitleGradColor2);
    if (typeof c.extraSubtitleLetterSpacing === 'number') setExtraSubtitleLetterSpacing(c.extraSubtitleLetterSpacing);
    if (typeof c.extraSubtitleLineHeight === 'number') setExtraSubtitleLineHeight(c.extraSubtitleLineHeight);
    if (typeof c.extraSubtitleBold === 'boolean') setExtraSubtitleBold(c.extraSubtitleBold);
    if (typeof c.extraSubtitleItalic === 'boolean') setExtraSubtitleItalic(c.extraSubtitleItalic);
    if (Array.isArray(c.cards)) setCards(c.cards);
    if (Array.isArray(c.salesPhrases)) setSalesPhrases(c.salesPhrases);
    if (Array.isArray(c.pexelsPhotos)) setPexelsPhotos(c.pexelsPhotos);
    if (typeof c.selectedPhotoIndex === 'number') setSelectedPhotoIndex(c.selectedPhotoIndex);
    if (Array.isArray(c.batchPhotoIndices)) setBatchPhotoIndices(c.batchPhotoIndices);
    if (Array.isArray(c.rushList)) setRushList(c.rushList);
    if (c.siteText !== undefined) setSiteText(c.siteText);
    if (c.siteTextPositions) setSiteTextPositions(c.siteTextPositions);
    if (c.siteTextSize !== undefined) setSiteTextSize(c.siteTextSize);
    if (c.siteTextColor) setSiteTextColor(c.siteTextColor);
    if (c.siteTextOpacity !== undefined) setSiteTextOpacity(c.siteTextOpacity);
    if (c.siteTextSequences) setSiteTextSequences(c.siteTextSequences);
    if (c.siteTextEnabled !== undefined) setSiteTextEnabled(c.siteTextEnabled);
    if (typeof c.showCenterGuides === 'boolean') setShowCenterGuides(c.showCenterGuides);
    if (typeof c.smartGuidesEnabled === 'boolean') setSmartGuidesEnabled(c.smartGuidesEnabled);
    if (typeof c.showGridOverlay === 'boolean') setShowGridOverlay(c.showGridOverlay);
    if (typeof c.overlayTextScale === 'number') setOverlayTextScale(c.overlayTextScale);
    if (typeof c.overlayStartTime === 'number') setOverlayStartTime(c.overlayStartTime);
    if (typeof c.overlayEndTime === 'number') setOverlayEndTime(c.overlayEndTime);
    if (typeof c.videoOverlayText === 'string') setVideoOverlayText(c.videoOverlayText);
    if (c.titleFont !== undefined) setTitleFont(c.titleFont);
    if (c.ctaFont !== undefined) setCtaFont(c.ctaFont);
    if (c.overlayFont !== undefined) setOverlayFont(c.overlayFont);
    if (c.watermarkFont !== undefined) setWatermarkFont(c.watermarkFont);
    if (c.cardsFont !== undefined) setCardsFont(c.cardsFont);
    if (typeof c.backdropRounded === 'boolean') setBackdropRounded(c.backdropRounded);
    if (typeof c.backdropRadius === 'number') setBackdropRadius(c.backdropRadius);
    if (typeof c.backdropMargin === 'number') setBackdropMargin(c.backdropMargin);
    if (typeof c.ctaTextGradient === 'boolean') setCtaTextGradient(c.ctaTextGradient);
    if (c.ctaGradColor1) setCtaGradColor1(c.ctaGradColor1);
    if (c.ctaGradColor2) setCtaGradColor2(c.ctaGradColor2);
    if (typeof c.overlayTextGradient === 'boolean') setOverlayTextGradient(c.overlayTextGradient);
    if (c.overlayGradColor1) setOverlayGradColor1(c.overlayGradColor1);
    if (c.overlayGradColor2) setOverlayGradColor2(c.overlayGradColor2);
    if (typeof c.watermarkTextGradient === 'boolean') setWatermarkTextGradient(c.watermarkTextGradient);
    if (c.watermarkGradColor1) setWatermarkGradColor1(c.watermarkGradColor1);
    if (c.watermarkGradColor2) setWatermarkGradColor2(c.watermarkGradColor2);
    if (Array.isArray(c.extraOverlays)) setExtraOverlays(c.extraOverlays);
    if (Array.isArray(c.audioKeyframes) && c.audioKeyframes.length > 0) setAudioKeyframes(c.audioKeyframes);
    if (Array.isArray(c.cardGroups)) setCardGroups(c.cardGroups);
    if (c.cardPositionMode === 'grid' || c.cardPositionMode === 'free') setCardPositionMode(c.cardPositionMode);
  };

  const handleUndo = () => {
    const prev = history.undo();
    if (!prev) return;
    history.suspend();
    applyDesignSnapshot(prev);
    window.setTimeout(() => history.resume(), 700);
    setUndoToast('↶ Action annulée');
    window.setTimeout(() => setUndoToast(null), 1000);
  };

  const handleRedo = () => {
    const next = history.redo();
    if (!next) return;
    history.suspend();
    applyDesignSnapshot(next);
    window.setTimeout(() => history.resume(), 700);
    setUndoToast('↷ Action refaite');
    window.setTimeout(() => setUndoToast(null), 1000);
  };

  // Keyboard shortcuts — Cmd/Ctrl+Z undo, Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y redo.
  // Ignored when the focus is on an editable field so the browser's native
  // text-undo keeps working inside inputs + textareas.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable = !!target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      );
      if (isEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);

  // ── Save DESIGN prefs on change (debounced, after initial restore) ──
  // Content (title, subtitle, cards, photo selection, rush, audio,
  // character image) is intentionally NOT serialized — each visit should
  // start with an empty canvas for content, only the visual design carries
  // over. The previous pre-split config key is wiped on first save so
  // migrated content doesn't linger. This effect also pushes the snapshot
  // into the undo history stack so Ctrl+Z returns to an earlier version.
  //
  // ⚠️ Export format must be declared BEFORE this useEffect — its
  // dep array references `exportFormat`, and Terser's production
  // minification hits TDZ ("Cannot access 'sl' before initialization")
  // if the useState declaration is placed later in the function body.
  // Original PR #121 declared it at "Step 2: Export" (~2900) — that
  // placement crashed /creer in prod. Keep this here.
  const [exportFormat, setExportFormat] = useState<'video' | 'jpeg' | 'png'>('video');
  // ── Per-sequence backgrounds (Phase 1) ──
  // Each sequence (titre / cartes / video / cta) can override the global
  // posterUrl with its own background image + opacity. `null` = inherit
  // global. Phase 2 will add CSS filter adjustments to this same shape.
  // ⚠️ Declared HERE (before the snapshot save useEffect) to avoid TDZ in
  // production minification — same constraint as `exportFormat` above.
  /** CSS-filter adjustments for a per-sequence background image (Phase 2). */
  type ImageFilters = {
    brightness: number; // 0–2, default 1
    contrast: number;   // 0–2, default 1
    saturation: number; // 0–3, default 1
    temperature: number; // -100–100, default 0 (mapped to hue-rotate)
    blur: number;       // 0–20px, default 0
    vignette: number;   // 0–1, default 0
  };
  type SequenceBackgroundConfig = {
    /** Supabase public URL or null for inheriting the global posterUrl. */
    url: string | null;
    /** 0–1. Default 1 (opaque). Applied on top of the chosen image. */
    opacity: number;
    /** CSS filter adjustments (Phase 2). Absent = all defaults. */
    filters?: ImageFilters;
    /** CSS object-position for cropping/repositioning, e.g. "50% 30%" */
    objectPosition?: string;
  };
  type SequenceBackgrounds = {
    titre: SequenceBackgroundConfig | null;
    cartes: SequenceBackgroundConfig | null;
    video: SequenceBackgroundConfig | null;
    cta: SequenceBackgroundConfig | null;
  };
  const emptySequenceBackgrounds = (): SequenceBackgrounds => ({
    titre: null, cartes: null, video: null, cta: null,
  });
  const [sequenceBackgrounds, setSequenceBackgrounds] = useState<SequenceBackgrounds>(
    () => emptySequenceBackgrounds(),
  );
  useEffect(() => {
    if (!configLoaded) return;
    // Closure-builder partagé entre le save debounced (500ms) et le save
    // synchrone au beforeunload. Garantit que les deux paths persistent
    // EXACTEMENT les mêmes champs.
    const buildSnapshot = () => ({
        colorTheme, format, introDuration, cardsDuration, videoDuration, ctaDuration, exportedSequences,
        titleLetterSpacing, titleLineHeight, titleBold, titleItalic,
        ctaLetterSpacing, ctaLineHeight, ctaBold, ctaItalic,
        overlayLetterSpacing, overlayLineHeight, overlayBold, overlayItalic, overlayColor, cardsLetterSpacing,
        selectedFont, selectedFilter, selectedCardStyle,
        titleColor, ctaColor, ctaSubColor, ctaMainText, ctaSubText,
        titleTextGradient, titleGradColor1, titleGradColor2,
        cardsLabelGradient, cardsValueGradient, cardsDescriptionGradient, cardsTextGradColor1, cardsTextGradColor2,
        ctaIconName, ctaIconColor, ctaIconGradient, ctaIconGradColor1, ctaIconGradColor2, ctaIconSize,
        titleDuplicate, titleDuplicateOffset, titleDuplicateOpacity,
        gradientColor1, gradientColor2, gradientOpacity, autoGradient, noColorBg, noColorSequences, noColorUserOverride, syncColorsGlobal, seqGradients,
        textScale, ctaTextScale, cardsTextScale, logoScale, logoSequences, logoImage, customAccent, customCardIcons,
        titlePos, extraTitlePosition, extraSubtitlePosition, logoPositions, watermarkPos, cardsPos, overlayPos,
        titleSize, cardsSize, watermarkSize,
        siteText, siteTextPositions, siteTextSize, siteTextColor, siteTextOpacity, siteTextSequences, siteTextEnabled,
        showCenterGuides,
        smartGuidesEnabled, showGridOverlay,
        cardGroups,
        cardPositionMode,
        overlayTextScale, overlayStartTime, overlayEndTime,
        videoOverlayText,
        extraOverlays,
        audioKeyframes,
        titleFont, ctaFont, overlayFont, watermarkFont, cardsFont,
        backdropRounded, backdropRadius, backdropMargin,
        ctaTextGradient, ctaGradColor1, ctaGradColor2,
        overlayTextGradient, overlayGradColor1, overlayGradColor2,
        watermarkTextGradient, watermarkGradColor1, watermarkGradColor2,
        contentTheme, customTopic, title, subtitle,
        extraTitle, extraSubtitle,
        extraTitleScale, extraTitleGradient, extraTitleGradColor1, extraTitleGradColor2,
        extraTitleLetterSpacing, extraTitleLineHeight, extraTitleBold, extraTitleItalic,
        extraSubtitleScale, extraSubtitleGradient, extraSubtitleGradColor1, extraSubtitleGradColor2,
        extraSubtitleLetterSpacing, extraSubtitleLineHeight, extraSubtitleBold, extraSubtitleItalic,
        cards, salesPhrases,
        pexelsPhotos, selectedPhotoIndex, batchPhotoIndices,
        rushList,
        // Audio (URLs Supabase persistantes — survit au refresh sans ré-upload)
        audioMusicUrl, audioVoiceUrl, audioMusicVolume, audioVoiceVolume,
        // Per-sequence voice-overs (PR A — texts auto-filled, audioUrls
        // populated by the future UI in PR B).
        sequenceVoices,
        sequenceVoicesUserEdited,
        // Export format choice (video MP4 / image JPG / image PNG).
        exportFormat,
        // Per-sequence background overrides (Phase 1).
        sequenceBackgrounds,
    });
    const persistSnapshot = (snap: ReturnType<typeof buildSnapshot>) => {
      try {
        localStorage.setItem(DESIGN_PREFS_KEY, JSON.stringify(snap));
        if (localStorage.getItem(LEGACY_CONFIG_KEY)) {
          localStorage.removeItem(LEGACY_CONFIG_KEY);
        }
      } catch { /* ignore (quota, private mode) */ }
    };
    const handle = window.setTimeout(() => {
      const snapshot = buildSnapshot();
      persistSnapshot(snapshot);
      history.commit(snapshot);
    }, 500);
    // Synchronous save on tab close / refresh / external navigation —
    // covers the window where the user edits something and quits before
    // the 500ms debounce fires. Latest closure is captured because this
    // useEffect re-runs on every state change (and removes the previous
    // handler in cleanup).
    const onBeforeUnload = () => {
      persistSnapshot(buildSnapshot());
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.clearTimeout(handle);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    configLoaded, colorTheme, format, introDuration, cardsDuration, videoDuration, ctaDuration, exportedSequences,
    titleLetterSpacing, titleLineHeight, titleBold, titleItalic,
    ctaLetterSpacing, ctaLineHeight, ctaBold, ctaItalic,
    overlayLetterSpacing, overlayLineHeight, overlayBold, overlayItalic, overlayColor, cardsLetterSpacing,
    selectedFont, selectedFilter, selectedCardStyle,
    titleColor, ctaColor, ctaSubColor, ctaMainText, ctaSubText,
    titleTextGradient, titleGradColor1, titleGradColor2,
    cardsLabelGradient, cardsValueGradient, cardsDescriptionGradient, cardsTextGradColor1, cardsTextGradColor2,
    ctaIconName, ctaIconColor, ctaIconGradient, ctaIconGradColor1, ctaIconGradColor2, ctaIconSize,
    titleDuplicate, titleDuplicateOffset, titleDuplicateOpacity,
    gradientColor1, gradientColor2, gradientOpacity, autoGradient, noColorBg, noColorSequences, noColorUserOverride, syncColorsGlobal, seqGradients,
    textScale, ctaTextScale, cardsTextScale, logoScale, logoSequences, logoImage, customAccent, customCardIcons,
    titlePos, extraTitlePosition, extraSubtitlePosition, logoPositions, watermarkPos, cardsPos, overlayPos,
    titleSize, cardsSize, watermarkSize,
    siteText, siteTextPositions, siteTextSize, siteTextColor, siteTextOpacity, siteTextSequences, siteTextEnabled,
    showCenterGuides,
    smartGuidesEnabled, showGridOverlay,
    cardGroups,
    cardPositionMode,
    overlayTextScale, overlayStartTime, overlayEndTime,
    videoOverlayText,
    extraOverlays,
    audioKeyframes,
    titleFont, ctaFont, overlayFont, watermarkFont, cardsFont,
    backdropRounded, backdropRadius, backdropMargin,
    ctaTextGradient, ctaGradColor1, ctaGradColor2,
    overlayTextGradient, overlayGradColor1, overlayGradColor2,
    watermarkTextGradient, watermarkGradColor1, watermarkGradColor2,
    contentTheme, customTopic, title, subtitle,
    extraTitle, extraSubtitle,
    extraTitleScale, extraTitleGradient, extraTitleGradColor1, extraTitleGradColor2,
    extraTitleLetterSpacing, extraTitleLineHeight, extraTitleBold, extraTitleItalic,
    extraSubtitleScale, extraSubtitleGradient, extraSubtitleGradColor1, extraSubtitleGradColor2,
    extraSubtitleLetterSpacing, extraSubtitleLineHeight, extraSubtitleBold, extraSubtitleItalic,
    cards, salesPhrases,
    pexelsPhotos, selectedPhotoIndex, batchPhotoIndices,
    rushList,
    audioMusicUrl, audioVoiceUrl, audioMusicVolume, audioVoiceVolume,
    sequenceVoices, sequenceVoicesUserEdited,
    exportFormat,
    sequenceBackgrounds,
  ]);

  // (Typography states declared earlier for localStorage compatibility)

  // (Settings panel removed — controls live in the Canva sidebar rail)

  // Floating panels — which element panel is open
  const [activePanel, setActivePanel] = useState<
    | "title" | "cards" | "cta" | "overlay" | "gradient" | "logo" | "sitetext"
    | "add" | "character" | "background"
    | "background-titre" | "background-cartes" | "background-video" | "background-cta"
    | null
  >(null);
  const [panelPos, setPanelPos] = useState({ x: 0, y: 0 });

  // ── B3: Canva-style rail (icon sidebar) ───────────────────────
  type RailTab =
    | 'templates'
    | 'elements'
    | 'text'
    | 'cards'
    | 'media'
    | 'audio'
    | 'settings'
    | null;
  const [activeRailTab, setActiveRailTab] = useState<RailTab>(null);
  const [zonesOpen, setZonesOpen] = useState(false);
  const [agentIAOpen, setAgentIAOpen] = useState(false);
  const zonesAnchorRef = useRef<HTMLDivElement>(null);
  const [zonesMenuPos, setZonesMenuPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!zonesOpen) {
      setZonesMenuPos(null);
      return;
    }
    // The toolbar has overflow-x-auto (which also clips Y), so we portal the
    // menu to document.body and position it with fixed coords from the anchor.
    const place = () => {
      const el = zonesAnchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setZonesMenuPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    };
    place();
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('[data-zones-menu]')) setZonesOpen(false);
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('mousedown', onDown);
    };
  }, [zonesOpen]);

  // ── B3: Contextual toolbar — selected element in the preview ──
  type SelectedEl =
    | null
    | { type: 'title' | 'logo' | 'overlay' | 'cta' }
    | { type: 'card'; index: number };
  const [selectedEl, setSelectedEl] = useState<SelectedEl>(null);

  // Helper: single-click selection (does not stop event propagation so that
  // existing drag / double-click handlers keep working).
  const selectEl = useCallback((el: SelectedEl) => {
    setSelectedEl(el);
  }, []);

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
  // Image export only goes to "Bureau" (download). Force destination back
  // to 'export' if the user switches to JPG/PNG while another destination
  // (calendrier / both / audio-studio) is selected.
  // (exportFormat is declared earlier — see "Export format must be declared
  // before snapshot save useEffect" comment near line ~2070.)
  useEffect(() => {
    if (exportFormat !== 'video' && destination !== 'export') {
      setDestination('export');
    }
  }, [exportFormat, destination]);
  const [selectedPublishPlatforms, setSelectedPublishPlatforms] = useState<PlatformKey[]>([]);
  const togglePublishPlatform = (p: PlatformKey) =>
    setSelectedPublishPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [showBuyCreditsModal, setShowBuyCreditsModal] = useState(false);
  const [mediaLibOpen, setMediaLibOpen] = useState(false);
  const [mediaLibTarget, setMediaLibTarget] = useState<'rush' | 'logo'>('rush');
  const { data: authSession } = useSession();
  const userPlan = ((authSession?.user as any)?.plan as string) || 'free';
  const useWatermark = !userPlan || userPlan === 'free';
  const { branding } = useBranding();
  const agentIAEnabled = useAgentIAEnabled();

  // ── Toast ───────────────────────────────────────────────────
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null);
  const [showMobilePreview, setShowMobilePreview] = useState(false);
  const [showExportPanel, setShowExportPanel] = useState(false);
  // Per-card AI icon generation state
  const [iconPrompts, setIconPrompts] = useState<Record<string, string>>({});
  const [iconLoadingId, setIconLoadingId] = useState<string | null>(null);

  const generateIconForCard = async (cardId: string) => {
    const prompt = (iconPrompts[cardId] || "").trim();
    if (!prompt) return;
    setIconLoadingId(cardId);
    try {
      const res = await fetch("/api/content/generate-icon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.icon) {
          setCards((prev) =>
            prev.map((c) => (c.id === cardId ? { ...c, emoji: data.icon } : c)),
          );
        }
      }
    } catch {
      // silent — keep existing emoji on error
    } finally {
      setIconLoadingId(null);
    }
  };

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
    async (query: string, newPage?: boolean, sourceOverride?: "pexels" | "unsplash") => {
      if (!query.trim()) return;
      setPexelsLoading(true);
      // Incrémente la page pour proposer de nouvelles photos à chaque clic
      const page = newPage ? pexelsPageRef.current + 1 : 1;
      pexelsPageRef.current = page;
      setPexelsPage(page);
      const source = sourceOverride || imageSource;
      try {
        const count = Math.max(batchCount * 2, 6);
        const res = await fetch(
          `/api/pexels?query=${encodeURIComponent(query)}&count=${count}&page=${page}&source=${source}`,
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
            `/api/pexels?query=${encodeURIComponent(query)}&count=${count}&page=1&source=${source}`,
          );
          const data2 = await res2.json();
          if (data2.success && data2.photos) {
            setPexelsPhotos(data2.photos);
            setSelectedPhotoIndex(0);
          }
        } else {
          setPexelsPhotos([]);
        }
      } catch {
        console.error("Image search error");
      } finally {
        setPexelsLoading(false);
      }
    },
    [batchCount, imageSource],
  );

  // ── Generate content (AI or local) ──────────────────────────
  const generateContent = useCallback(
    async (themeIdOrOpts?: string | { themeId?: string; cardsOnly?: boolean }) => {
      const opts = typeof themeIdOrOpts === 'object' && themeIdOrOpts !== null ? themeIdOrOpts : {};
      const themeId = typeof themeIdOrOpts === 'string' ? themeIdOrOpts : opts.themeId;
      const cardsOnly = !!opts.cardsOnly;
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

        const accent =
          COLOR_THEMES.find((ct) => ct.id === colorTheme)?.accent || "#a855f7";

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
              cardCount: 3,
            }),
            signal: aiController.signal,
          });
          clearTimeout(aiTimeout);

          if (aiRes.ok) {
            const aiData = await aiRes.json();
            if (aiData.success && aiData.content) {
              const c = aiData.content;
              if (!cardsOnly) {
                setTitle(c.title || topicText.toUpperCase());
                setSubtitle(c.subtitle || "");
                setSalesPhrases(c.salesPhrases || []);
              }
              setCards(
                (c.cards || []).map((card: any, i: number) => {
                  const resolved = resolveCardIcon(card.label, card.description, card.iconName || "Sparkles");
                  return {
                    id: `card-${Date.now()}-${i}`,
                    emoji: resolved.emoji,
                    label: card.label || "",
                    value: card.value || "",
                    description: card.description || "",
                    color: accent,
                    iconType: resolved.iconType,
                    iconColor: '#FFFFFF',
                    iconSize: 32,
                    iconStyle: 'outline' as const,
                  };
                }),
              );

              // Fetch photos only on initial generation, not on cards-only refresh.
              if (!cardsOnly) {
                const pQuery =
                  c.pexelsQuery || themeObj?.pexelsQuery || topicText;
                setPhotoSearchQuery(pQuery);
                fetchPexelsPhotos(pQuery);
              }
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
            if (!cardsOnly) {
              setTitle(c.tagLine || topicText.toUpperCase());
              setSubtitle(c.subtitle || "");
              setSalesPhrases([]);
            }
            setCards(
              (c.cards || []).slice(0, 3).map((card: any, i: number) => {
                const resolved = resolveCardIcon(card.title, card.description, toLucideName(card.icon));
                return {
                  id: `card-${Date.now()}-${i}`,
                  emoji: resolved.emoji,
                  label: card.title || "",
                  value: card.value || "",
                  description: card.description || "",
                  color: accent,
                  iconType: resolved.iconType,
                  iconColor: '#FFFFFF',
                  iconSize: 32,
                  iconStyle: 'outline' as const,
                };
              }),
            );
            if (!cardsOnly) {
              const pQuery = themeObj?.pexelsQuery || topicText;
              setPhotoSearchQuery(pQuery);
              fetchPexelsPhotos(pQuery);
            }
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
    // Only regenerate the cards (label/value/description/icon). Do NOT touch
    // the main title, subtitle, sales phrases, or the poster photo gallery —
    // those have their own dedicated regenerate buttons.
    generateContent({ cardsOnly: true });
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
          const resolved = resolveCardIcon(aiCard.label, aiCard.description, aiCard.iconName || "Sparkles");
          setCards([
            ...cards,
            {
              id: `card-${Date.now()}`,
              emoji: resolved.emoji,
              label: aiCard.label || "Info",
              value: aiCard.value || "",
              description: aiCard.description || "",
              color: accent,
              iconType: resolved.iconType,
              iconColor: '#FFFFFF',
              iconSize: 32,
              iconStyle: 'outline',
            },
          ]);
          setIsAddingCard(false);
          return;
        }
      }
    } catch {
      // AI failed, fallback to generic
    }

    // Fallback: generic card (still SVG, themed)
    setCards([
      ...cards,
      {
        id: `card-${Date.now()}`,
        emoji: themeIconName(contentTheme),
        label: "Nouveau",
        value: "Valeur",
        description: "",
        color: accent,
        iconType: 'svg',
        iconColor: '#FFFFFF',
        iconSize: 32,
        iconStyle: 'outline',
      },
    ]);
    setIsAddingCard(false);
  };

  const deleteCard = (id: string) => setCards(cards.filter((c) => c.id !== id));

  const updateCard = (id: string, field: keyof InfoCard, value: string) => {
    setCards(cards.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
  };

  // ── Multi-select + group helpers ─────────────────────────────
  const GROUP_COLORS = [
    '#60A5FA', // blue
    '#34D399', // green
    '#FB923C', // orange
    '#F472B6', // pink
    '#A78BFA', // violet
    '#22D3EE', // cyan
    '#FBBF24', // amber
  ];

  const toggleCardSelection = (cardId: string, additive: boolean) => {
    setSelectedCardIds((prev) => {
      const next = new Set(prev);
      if (additive) {
        if (next.has(cardId)) next.delete(cardId);
        else next.add(cardId);
      } else {
        next.clear();
        next.add(cardId);
      }
      return next;
    });
  };

  const clearCardSelection = () => setSelectedCardIds(new Set());

  /**
   * Evenly redistributes cards' free-mode positions along one axis. Uses
   * the current min/max of the axis so the user's framing is preserved
   * (cards get even spacing between their existing bounds). Falls back to
   * a sensible default band (10-90%) when every card shares the same
   * coord or has no position yet.
   */
  const distributeCards = (axis: 'vertical' | 'horizontal') => {
    if (cards.length < 2) return;
    const key: 'x' | 'y' = axis === 'vertical' ? 'y' : 'x';
    // Seed missing positions with the default grid fallback (same logic
    // as the free-mode renderer) so even cards the user never dragged
    // get repositioned to something reasonable.
    const cols = format === '16:9' ? 3 : 2;
    const withPos = cards.map((c, i) => {
      const defaultX = 25 + (i % cols) * 25;
      const defaultY = 40 + Math.floor(i / cols) * 18;
      return {
        id: c.id,
        pos: c.position || { x: defaultX, y: defaultY },
      };
    });
    const coords = withPos.map((p) => p.pos[key]);
    const minC = Math.min(...coords);
    const maxC = Math.max(...coords);
    const span = maxC - minC;
    // If every card is on the same line, expand to 10-90% band so the
    // distribute action still has a visible effect.
    const lo = span < 5 ? 10 : minC;
    const hi = span < 5 ? 90 : maxC;
    // Sort by the axis so the distribution respects the user's visual
    // order (top-to-bottom for vertical, left-to-right for horizontal).
    const sorted = [...withPos].sort((a, b) => a.pos[key] - b.pos[key]);
    const step = sorted.length > 1 ? (hi - lo) / (sorted.length - 1) : 0;
    // Plain object keyed by id — the global `Map` identifier is shadowed
    // in this file by the Lucide `Map` icon import, so `new Map()` fails.
    const byId: Record<string, number> = {};
    sorted.forEach((entry, rank) => { byId[entry.id] = lo + rank * step; });

    setCards((prev) =>
      prev.map((c) => {
        const newCoord = byId[c.id];
        if (newCoord === undefined) return c;
        const defaultX = 25 + (prev.indexOf(c) % cols) * 25;
        const defaultY = 40 + Math.floor(prev.indexOf(c) / cols) * 18;
        const base = c.position || { x: defaultX, y: defaultY };
        return {
          ...c,
          position: axis === 'vertical'
            ? { x: base.x, y: newCoord }
            : { x: newCoord, y: base.y },
        };
      }),
    );
  };

  const getCardGroupFor = (cardId: string): CardGroup | undefined =>
    cardGroups.find((g) => g.cardIds.includes(cardId));

  const groupSelectedCards = () => {
    const ids = Array.from(selectedCardIds);
    if (ids.length < 2) return;
    // Remove any membership of the selected cards in existing groups first
    // (a card belongs to at most one group at a time).
    const cleanedGroups = cardGroups
      .map((g) => ({ ...g, cardIds: g.cardIds.filter((cid) => !ids.includes(cid)) }))
      .filter((g) => g.cardIds.length >= 2);
    const color = GROUP_COLORS[cleanedGroups.length % GROUP_COLORS.length];
    setCardGroups([
      ...cleanedGroups,
      { id: `g-${Date.now()}`, cardIds: ids, color },
    ]);
  };

  const ungroupSelectedCards = () => {
    if (selectedCardIds.size === 0) return;
    setCardGroups((prev) =>
      prev
        .map((g) => ({ ...g, cardIds: g.cardIds.filter((cid) => !selectedCardIds.has(cid)) }))
        .filter((g) => g.cardIds.length >= 2),
    );
  };

  const duplicateSelectedCards = () => {
    if (selectedCardIds.size === 0) return;
    const idsToDup = cards.filter((c) => selectedCardIds.has(c.id));
    const copies: InfoCard[] = idsToDup.map((c) => ({
      ...c,
      id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      position: c.position ? { x: Math.min(100, c.position.x + 4), y: Math.min(100, c.position.y + 4) } : undefined,
    }));
    setCards((prev) => [...prev, ...copies]);
    // Leave the new copies selected so the user can immediately move/group them.
    setSelectedCardIds(new Set(copies.map((c) => c.id)));
  };

  const [aiFieldLoading, setAiFieldLoading] = useState<string | null>(null);
  const [rewritingPhraseIdx, setRewritingPhraseIdx] = useState<number | null>(null);

  const rewriteSalesPhrase = async (i: number) => {
    const current = salesPhrases[i];
    if (!current?.trim()) { showToast('Phrase vide'); return; }
    setRewritingPhraseIdx(i);
    try {
      const res = await fetch('/api/content/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fieldType: 'salesPhraseRewrite', topic: current, locale: 'fr' }),
      });
      const data = await res.json().catch(() => null);
      if (data?.success && typeof data.text === 'string' && data.text.trim()) {
        const next = data.text.trim();
        setSalesPhrases((prev) => prev.map((p, idx) => (idx === i ? next : p)));
      } else {
        showToast(`IA indisponible: ${data?.error || 'reponse invalide'} - phrase conservee`);
      }
    } catch (err) {
      showToast(`IA: ${(err as Error)?.message || 'erreur reseau'} - phrase conservee`);
    } finally {
      setRewritingPhraseIdx(null);
    }
  };

  // Resolve a human-readable topic for the AI prompt — the theme slug
  // alone ("sommeil-sport") lands as garbage input; the label ("Sommeil
  // & Sport") or the user's custom topic works better.
  const resolveTopicText = (): string => {
    const themeObj = CONTENT_THEMES.find((t) => t.id === contentTheme);
    return contentTheme === 'personnalise'
      ? (customTopic || 'fitness')
      : (themeObj?.label || contentTheme || 'fitness');
  };

  // Local fallback when Anthropic signals a billing error (or any
  // useLocalFallback flag). Calls the non-AI /api/content/generate which
  // uses the local knowledge base, then maps tagLine→title / subtitle.
  const fetchLocalTitleSubtitle = async (): Promise<{ title?: string; subtitle?: string }> => {
    try {
      const res = await fetch('/api/content/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: resolveTopicText(), seed: Date.now() }),
      });
      const data = await res.json().catch(() => null);
      if (data?.success && data.content) {
        return { title: data.content.tagLine, subtitle: data.content.subtitle };
      }
    } catch (err) {
      console.warn('[AI-Field] local fallback also failed:', err);
    }
    return {};
  };

  const suggestField = async (fieldType: string, setter: (v: string) => void) => {
    setAiFieldLoading(fieldType);
    const topicText = resolveTopicText();
    console.log('[AI-Field]', fieldType, 'topic:', topicText);
    try {
      const res = await fetch('/api/content/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: topicText, fieldType, locale: 'fr' }),
      });
      console.log('[AI-Field]', fieldType, 'status:', res.status);
      const data = await res.json().catch(() => null);
      console.log('[AI-Field]', fieldType, 'body:', data);
      if (data?.success && typeof data.text === 'string' && data.text.trim().length > 0) {
        setter(data.text.trim());
        return;
      }
      // Billing / service-down signal → pull from local knowledge base.
      if (data?.useLocalFallback) {
        const local = await fetchLocalTitleSubtitle();
        const value = fieldType === 'title' ? local.title : fieldType === 'subtitle' ? local.subtitle : undefined;
        if (value) {
          setter(value);
          showToast?.('Mode local: IA temporairement indisponible');
          return;
        }
      }
      console.warn('[AI-Field]', fieldType, 'generation failed:', data?.error);
      showToast?.(`IA ${fieldType}: ${data?.error || 'réponse invalide'} — réessayez`);
    } catch (err) {
      console.error('[AI-Field]', fieldType, 'threw:', err);
      showToast?.(`IA ${fieldType}: ${(err as Error)?.message || 'erreur réseau'} — réessayez`);
    } finally {
      setAiFieldLoading(null);
    }
  };

  // Convenience: run title + subtitle generation. On billing-error the
  // first call already flips to local fallback; we skip the second AI
  // call in that case and pull the local subtitle from the same knowledge
  // base result to avoid two separate local-fallback round-trips.
  const suggestTitleAndSubtitle = async () => {
    setAiFieldLoading('title');
    const topicText = resolveTopicText();
    try {
      const res = await fetch('/api/content/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: topicText, fieldType: 'title', locale: 'fr' }),
      });
      const data = await res.json().catch(() => null);
      if (data?.success && typeof data.text === 'string' && data.text.trim()) {
        setTitle(data.text.trim());
        // Title succeeded via AI — do subtitle via AI too.
        setAiFieldLoading(null);
        await suggestField('subtitle', setSubtitle);
        return;
      }
      if (data?.useLocalFallback) {
        const local = await fetchLocalTitleSubtitle();
        if (local.title) setTitle(local.title);
        if (local.subtitle) setSubtitle(local.subtitle);
        showToast?.('Mode local: IA temporairement indisponible');
        return;
      }
      showToast?.(`IA title: ${data?.error || 'réponse invalide'} — réessayez`);
    } catch (err) {
      showToast?.(`IA title: ${(err as Error)?.message || 'erreur réseau'} — réessayez`);
    } finally {
      setAiFieldLoading(null);
    }
  };

  /**
   * Regenerate a single card in-place (label + value + description + icon),
   * leaving all other cards, the poster gallery, and the main title/subtitle
   * untouched. Has a 15s client-side timeout on the AI call; on failure or
   * timeout it falls back to the local smart-content generator with a fresh
   * seed so the user still sees the card refresh to different content.
   */
  const suggestCardField = async (cardId: string, _field?: 'label' | 'description') => {
    const cardIndex = cards.findIndex((c) => c.id === cardId);
    const loadingKey = `${cardId}-label`;
    setAiFieldLoading(loadingKey);
    const themeObj = CONTENT_THEMES.find((t) => t.id === contentTheme);
    const topicText =
      contentTheme === 'personnalise'
        ? customTopic
        : themeObj?.label || contentTheme || 'fitness';
    const existingCards = cards.filter((c) => c.id !== cardId).map((c) => c.label);
    const accent = COLOR_THEMES.find((ct) => ct.id === colorTheme)?.accent || customAccent || '#a855f7';

    const applyCard = (label: string, value: string, description: string, iconName: string) => {
      const resolved = resolveCardIcon(label, description, iconName);
      setCards((prev) =>
        prev.map((c) =>
          c.id === cardId
            ? {
                ...c,
                label: label || c.label,
                value: value || c.value,
                description: description || c.description,
                color: c.color || accent,
                emoji: resolved.emoji,
                iconType: resolved.iconType,
              }
            : c,
        ),
      );
    };

    try {
      // 1. AI attempt with a 15s client-side AbortController. Server has its
      //    own 20s budget — 15s here keeps the UI feeling responsive while
      //    still letting Haiku 4.5 finish a small 1-card request.
      try {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 15_000);
        const res = await fetch('/api/content/ai-generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic: topicText,
            locale: 'fr',
            cardCount: 1,
            existingCards,
            variationNonce: `single-${cardIndex}-${Date.now().toString(36)}`,
          }),
          signal: ac.signal,
        });
        clearTimeout(timer);
        const data = await res.json();
        const aiCard = data?.content?.cards?.[0];
        console.log(`[Regenerate card ${cardIndex}] result:`, { success: data?.success, source: 'ai', card: aiCard });
        if (data.success && aiCard) {
          applyCard(aiCard.label, aiCard.value, aiCard.description, aiCard.iconName || 'Sparkles');
          return;
        }
      } catch (err: any) {
        const reason = err?.name === 'AbortError' ? 'timeout' : (err?.message || 'error');
        console.warn(`[Regenerate card ${cardIndex}] AI failed (${reason}), falling back to local pool`);
      }

      // 2. Local fallback. Seed with the card index + random offset so each
      //    click produces a different pool entry.
      try {
        const res = await fetch('/api/content/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic: topicText,
            seed: Math.floor(Math.random() * 1000) + cardIndex,
          }),
        });
        const data = await res.json();
        const localCards: any[] = data?.content?.cards || [];
        const candidate = localCards.find((c) => !existingCards.includes(c.title)) || localCards[0];
        console.log(`[Regenerate card ${cardIndex}] result:`, { success: data?.success, source: 'local', card: candidate });
        if (data.success && candidate) {
          applyCard(
            candidate.title,
            candidate.value,
            candidate.description,
            toLucideName(candidate.icon),
          );
          return;
        }
      } catch (err) {
        console.warn(`[Regenerate card ${cardIndex}] local fallback failed:`, err);
      }

      // 3. Nothing worked — tell the user so the click isn't silently inert.
      showToast('Impossible de régénérer cette carte pour le moment');
    } finally {
      setAiFieldLoading(null);
    }
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

  // ── Media upload (video or image) ──────────────────────────
  const uploadSingleMedia = async (
    file: File,
  ): Promise<{ url: string; name: string; kind: 'video' | 'image' } | null> => {
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    console.log('[Upload] file:', { name: file.name, size: file.size, type: file.type, isVideo, isImage });

    if (!isVideo && !isImage) {
      showToast(`"${file.name}" : format non supporté (vidéo ou image attendue)`);
      return null;
    }
    const maxBytes = isVideo ? 100 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxBytes) {
      const maxMB = Math.round(maxBytes / 1024 / 1024);
      showToast(`"${file.name}" dépasse ${maxMB} Mo`);
      return null;
    }

    const kind: 'video' | 'image' = isVideo ? 'video' : 'image';
    const purpose = isImage ? 'infographic-image' : 'infographic-video';

    try {
      // Signed URL for files > 4 Mo (bypasses Vercel's 4.5MB body limit).
      // The server sanitizes the filename into the storage key, so sending
      // the raw file.name here is safe.
      if (file.size > 4 * 1024 * 1024) {
        const signRes = await fetch('/api/upload/signed-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, contentType: file.type, purpose }),
        });
        const signData = await signRes.json().catch(() => ({ success: false, error: 'Réponse invalide' }));
        console.log('[Upload] sign response:', { httpStatus: signRes.status, success: signData?.success, error: signData?.error, bucket: signData?.bucket });
        if (!signRes.ok || !signData?.success) {
          const detail = signData?.error || `HTTP ${signRes.status}`;
          showToast(`Upload échoué "${file.name}" : ${detail}`);
          return null;
        }
        const putResult = await new Promise<{ ok: boolean; status: number; responseText: string }>((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', signData.signedUrl);
          xhr.setRequestHeader('Content-Type', file.type);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setVideoUploadProgress(Math.round((e.loaded / e.total) * 100));
          };
          xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, responseText: xhr.responseText?.slice(0, 200) || '' });
          xhr.onerror = () => resolve({ ok: false, status: xhr.status || 0, responseText: 'network error' });
          xhr.send(file);
        });
        setVideoUploadProgress(0);
        console.log('[Upload] PUT result:', putResult);
        if (!putResult.ok) {
          showToast(`Upload échoué "${file.name}" : Supabase HTTP ${putResult.status}${putResult.responseText ? ' — ' + putResult.responseText : ''}`);
          return null;
        }
        console.log('[Upload] Signed URL upload OK:', signData.publicUrl);
        return { url: signData.publicUrl, name: file.name, kind };
      }

      // Small files: go through the Next.js API route
      const formData = new FormData();
      formData.append('file', file);
      formData.append('purpose', purpose);
      const res = await fetch('/api/upload/media', { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({ success: false, error: 'Réponse invalide' }));
      console.log('[Upload] /api/upload/media response:', { httpStatus: res.status, success: data?.success, error: data?.error });
      if (!res.ok || !data?.success || !data.file?.url) {
        const detail = data?.error || `HTTP ${res.status}`;
        showToast(`Upload échoué "${file.name}" : ${detail}`);
        return null;
      }
      return { url: data.file.url, name: file.name, kind };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Upload] media upload error:', msg, err);
      showToast(`Upload échoué "${file.name}" : ${msg}`);
      return null;
    }
  };

  // Legacy name kept for callers that specifically want a video-only upload.
  const uploadSingleVideo = async (file: File) => {
    const result = await uploadSingleMedia(file);
    if (!result) return null;
    if (result.kind !== 'video') {
      showToast(`"${file.name}" n'est pas une vidéo`);
      return null;
    }
    return { url: result.url, name: result.name };
  };

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setIsUploadingVideo(true);
    const uploaded: { url: string; name: string; kind: 'video' | 'image' }[] = [];
    try {
      for (const file of files) {
        const result = await uploadSingleMedia(file);
        if (result) uploaded.push(result);
      }
      if (uploaded.length > 0) {
        setRushList((prev) => {
          const next = [...prev, ...uploaded];
          console.log('[Upload] rushList update :', {
            previous: prev.length,
            added: uploaded.length,
            firstUrl: next[0]?.url,
            firstKind: next[0]?.kind,
          });
          return next;
        });
        const videoCount = uploaded.filter((r) => r.kind === 'video').length;
        const imageCount = uploaded.filter((r) => r.kind === 'image').length;
        let msg: string;
        if (uploaded.length === 1) {
          msg = uploaded[0].kind === 'image' ? 'Image uploadée avec succès' : 'Vidéo uploadée avec succès';
        } else if (videoCount > 0 && imageCount === 0) {
          msg = `${videoCount} vidéos uploadées`;
        } else if (imageCount > 0 && videoCount === 0) {
          msg = `${imageCount} images uploadées`;
        } else {
          msg = `${uploaded.length} médias uploadés (${videoCount} vidéo${videoCount > 1 ? 's' : ''}, ${imageCount} image${imageCount > 1 ? 's' : ''})`;
        }
        showToast(msg, 'success');
      }
    } finally {
      setIsUploadingVideo(false);
      // Reset input so the same file can be re-selected after removal
      e.target.value = "";
    }
  };

  const removeRushAt = (idx: number) => {
    setRushList((prev) => prev.filter((_, i) => i !== idx));
  };

  const reorderRush = (from: number, to: number) => {
    if (from === to) return;
    setRushList((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const openClipAnalysis = async (idx: number) => {
    const rush = rushList[idx];
    if (!rush) return;
    setClipSourceIdx(idx);
    setClipModalOpen(true);
    setClipAnalyzing(true);
    setClipProgress(0);
    setClipStage("Téléchargement de la vidéo...");
    setDetectedClips([]);
    setSelectedClipIds(new Set());
    clipSourceFileRef.current = null;
    try {
      const res = await fetch(rush.url);
      if (!res.ok) throw new Error("fetch failed");
      const blob = await res.blob();
      const file = new File([blob], rush.name, {
        type: blob.type || "video/mp4",
      });
      clipSourceFileRef.current = file;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = URL.createObjectURL(file);
      const result = await detectClips(file, {
        onProgress: (p, s) => {
          setClipProgress(p);
          setClipStage(s);
        },
      });
      setDetectedClips(result.clips);
      setSelectedClipIds(new Set(result.clips.map((c) => c.id)));
      if (result.clips.length > 0) setPreviewClipId(result.clips[0].id);
      if (result.clips.length === 0) {
        showToast("Aucune séquence détectée");
      }
    } catch (err) {
      console.error("[Clip] analyze error:", err);
      showToast("Échec de l'analyse vidéo");
    } finally {
      setClipAnalyzing(false);
    }
  };

  const toggleClipSelection = (id: string) => {
    setSelectedClipIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const closeClipModal = () => {
    if (clipExtracting) return;
    setClipModalOpen(false);
    setClipSourceIdx(null);
    setDetectedClips([]);
    setSelectedClipIds(new Set());
    setClipTrims({});
    setPreviewClipId(null);
    if (previewStopTimerRef.current) {
      cancelAnimationFrame(previewStopTimerRef.current);
      previewStopTimerRef.current = null;
    }
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    clipSourceFileRef.current = null;
  };

  const playPreview = (clip: DetectedClip) => {
    const vid = previewVideoRef.current;
    if (!vid) return;
    const trim = clipTrims[clip.id];
    const effStart = trim?.startTime ?? clip.startTime;
    const effEnd = trim?.endTime ?? clip.endTime;
    if (previewStopTimerRef.current) {
      cancelAnimationFrame(previewStopTimerRef.current);
      previewStopTimerRef.current = null;
    }
    try {
      vid.currentTime = effStart;
      vid.play().catch(() => {});
    } catch {}
    const tick = () => {
      if (!previewVideoRef.current) return;
      if (previewVideoRef.current.currentTime >= effEnd) {
        previewVideoRef.current.pause();
        previewStopTimerRef.current = null;
        return;
      }
      previewStopTimerRef.current = requestAnimationFrame(tick);
    };
    previewStopTimerRef.current = requestAnimationFrame(tick);
  };

  const pausePreview = () => {
    if (previewStopTimerRef.current) {
      cancelAnimationFrame(previewStopTimerRef.current);
      previewStopTimerRef.current = null;
    }
    try {
      previewVideoRef.current?.pause();
    } catch {}
  };

  useEffect(() => {
    if (!previewClipId) return;
    const clip = detectedClips.find((c) => c.id === previewClipId);
    if (!clip) return;
    const vid = previewVideoRef.current;
    if (!vid) return;
    const effStart = clipTrims[clip.id]?.startTime ?? clip.startTime;
    try {
      vid.currentTime = effStart;
    } catch {}
  }, [previewClipId, detectedClips, clipTrims]);

  const resetClipTrim = (clipId: string) => {
    setClipTrims((prev) => {
      const next = { ...prev };
      delete next[clipId];
      return next;
    });
  };

  const keepOriginalRush = () => {
    closeClipModal();
  };

  const confirmClipExtraction = async () => {
    const file = clipSourceFileRef.current;
    const srcIdx = clipSourceIdx;
    if (!file || srcIdx === null) return;
    const chosen = detectedClips.filter((c) => selectedClipIds.has(c.id));
    if (chosen.length === 0) {
      showToast("Sélectionnez au moins une séquence");
      return;
    }
    setClipExtracting(true);
    const extracted: { url: string; name: string; fromClip: true }[] = [];
    try {
      for (let i = 0; i < chosen.length; i++) {
        const clip = chosen[i];
        setClipExtractStage(
          `Extraction ${i + 1}/${chosen.length} — ${clip.label}`,
        );
        setClipExtractProgress(0);
        const s = clipTrims[clip.id]?.startTime ?? clip.startTime;
        const e = clipTrims[clip.id]?.endTime ?? clip.endTime;
        const clipFile = await extractClip(
          file,
          s,
          e,
          (p) => setClipExtractProgress(p),
        );
        setClipExtractStage(`Upload ${i + 1}/${chosen.length}...`);
        const up = await uploadSingleVideo(clipFile);
        // Mark as fromClip=true so the 🎯 crop button appears on extracted tiles
        if (up) extracted.push({ ...up, fromClip: true });
      }
      if (extracted.length > 0) {
        setRushList((prev) => {
          const next = [...prev];
          next.splice(srcIdx, 1, ...extracted);
          return next;
        });
        showToast(
          `${extracted.length} séquence${extracted.length > 1 ? "s" : ""} extraite${extracted.length > 1 ? "s" : ""}`,
          "success",
        );
      }
      setClipModalOpen(false);
      setClipSourceIdx(null);
      setDetectedClips([]);
      setSelectedClipIds(new Set());
      setClipTrims({});
      clipSourceFileRef.current = null;
    } catch (err) {
      console.error("[Clip] extract error:", err);
      showToast("Échec de l'extraction");
    } finally {
      setClipExtracting(false);
      setClipExtractProgress(0);
      setClipExtractStage("");
    }
  };

  // ── Pre-render SVG icons as images for canvas drawing ──────
  const preRenderCtaIcon = async (): Promise<HTMLImageElement | null> => {
    if (!ctaIconName || !ICON_MAP[ctaIconName]) return null;
    try {
      const { renderToStaticMarkup } = await import('react-dom/server');
      const React = await import('react');
      const IconComp = ICON_MAP[ctaIconName];
      const renderColor = ctaIconGradient ? '#FFFFFF' : (ctaIconColor || '#FFFFFF');
      const svg = renderToStaticMarkup(React.createElement(IconComp, { size: 256, color: renderColor, strokeWidth: 2 }));
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      return await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
        image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('cta icon load failed')); };
        image.src = url;
      });
    } catch {
      return null;
    }
  };

  const preRenderCardIcons = async (cardList: typeof cards) => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const React = await import('react');
    return Promise.all(cardList.map(async (c) => {
      if (c.iconType === 'svg' && c.emoji && ICON_MAP[c.emoji]) {
        try {
          const IconComp = ICON_MAP[c.emoji];
          const svg = renderToStaticMarkup(React.createElement(IconComp, { size: 64, color: c.iconColor || '#FFFFFF', strokeWidth: 2 }));
          const blob = new Blob([svg], { type: 'image/svg+xml' });
          const url = URL.createObjectURL(blob);
          const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image();
            image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
            image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('icon load failed')); };
            image.src = url;
          });
          return { ...c, iconImage: img };
        } catch { return c; }
      }
      return c;
    }));
  };

  // ── Export ──────────────────────────────────────────────────
  /** Image export — for each visible sequence, switch the preview to that
   *  sequence, wait for re-render, take a modern-screenshot, then either
   *  download (single image) or zip (multiple). DOM-based: no composer
   *  refactor risk, output matches exactly what the user sees. */
  const handleImageExport = async (fmt: 'jpeg' | 'png') => {
    const visibleSequences: ('titre' | 'cartes' | 'video' | 'cta')[] = [];
    if (exportedSequences.titre) visibleSequences.push('titre');
    if (exportedSequences.cartes && cards.length > 0) visibleSequences.push('cartes');
    if (exportedSequences.video && rushUrl) visibleSequences.push('video');
    if (exportedSequences.cta) visibleSequences.push('cta');
    if (visibleSequences.length === 0) {
      showToast('Aucune séquence visible à exporter (active au moins un œil ouvert)');
      return;
    }
    if (!previewRef.current) {
      showToast('Aperçu introuvable — impossible de capturer une image');
      return;
    }

    setIsExporting(true);
    setExportProgress(0);

    const previousActive = activeSequence;
    const isReel = format === '9:16';
    // Target output resolution; previewRef is ~320-600px wide depending
    // on viewport. Compute scale so the screenshot lands at ~1080px wide
    // for reel, ~1920px wide for 16:9.
    const targetW = isReel ? 1080 : 1920;
    const scale = Math.max(1, targetW / (previewRef.current.offsetWidth || 320));

    try {
      const { domToCanvas } = await import('modern-screenshot');
      const blobs: { name: string; blob: Blob }[] = [];
      const baseTitle = (title || 'studiio').replace(/[^a-zA-Z0-9-_]+/g, '_');
      const ext = fmt === 'png' ? 'png' : 'jpg';
      const mime = fmt === 'png' ? 'image/png' : 'image/jpeg';

      for (let i = 0; i < visibleSequences.length; i++) {
        const seq = visibleSequences[i];
        setActiveSequence(seq);
        setExportProgress(Math.round((i / visibleSequences.length) * 85));
        // Double RAF + 50ms safety so React commits + browser paints the
        // newly active sequence before we screenshot it.
        await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
        await new Promise<void>((r) => setTimeout(r, 50));

        const canvas = await domToCanvas(previewRef.current!, { backgroundColor: undefined, scale });
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, mime, fmt === 'jpeg' ? 0.92 : undefined),
        );
        if (!blob) throw new Error(`canvas.toBlob returned null for ${seq}`);
        blobs.push({ name: `${baseTitle}-${seq}-${i + 1}.${ext}`, blob });
      }

      setExportProgress(95);

      if (blobs.length === 1) {
        const url = URL.createObjectURL(blobs[0].blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = blobs[0].name;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } else {
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        for (const { name, blob } of blobs) zip.file(name, blob);
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${baseTitle}-images.zip`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }

      setExportProgress(100);
      showToast(
        `✓ ${blobs.length} image${blobs.length > 1 ? 's' : ''} téléchargée${blobs.length > 1 ? 's (ZIP)' : ''}`,
        'success',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'erreur inconnue';
      console.error('[ImageExport] failed:', err);
      showToast(`Échec export image : ${msg}`);
    } finally {
      // Restore the sequence the user was viewing before export
      setActiveSequence(previousActive);
      setTimeout(() => {
        setIsExporting(false);
        setExportProgress(0);
      }, 1500);
    }
  };

  const handleExport = async () => {
    if (cards.length === 0) {
      showToast("Ajoutez au moins une carte avant d'exporter");
      return;
    }

    // Image export branch — captures the live preview DOM via
    // modern-screenshot for each visible sequence. Bypasses the entire
    // video pipeline (composer, audio mix, MediaRecorder, MP4 transcode).
    if (exportFormat === 'jpeg' || exportFormat === 'png') {
      await handleImageExport(exportFormat);
      return;
    }

    // Safety check: if a video was expected but source is undefined, block export
    if (rushFileName && !rushUrl) {
      showToast(
        "La vidéo n'a pas été uploadée correctement. Veuillez re-sélectionner le média.",
      );
      return;
    }

    // Coherence check: a rush is uploaded but the "video" sequence toggle
    // is off → the export will silently exclude the rush and the user
    // wonders why it's missing. Prompt before continuing so they can
    // either include it or knowingly skip it.
    if (rushUrl && !exportedSequences.video) {
      const userConfirms = confirm(
        "Vous avez uploadé une vidéo rush mais la séquence \"Vidéo\" est désactivée. " +
        "L'export ne l'inclura PAS.\n\n" +
        "Voulez-vous activer la séquence Vidéo avant l'export ?"
      );
      if (userConfirms) {
        setExportedSequences((prev) => ({ ...prev, video: true }));
        // Wait two animation frames so React commits the new state before
        // we read `exportedSequences.video` again below in the payload.
        await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      }
      // else: user wants to exclude the rush — continue with current toggles
    }

    setIsExporting(true);
    setExportProgress(0);

    // Credit check before export (cost × batchCount)
    const renderFormat: 'reel' | 'tv' = format === '16:9' ? 'tv' : 'reel';
    const cost = renderFormat === 'tv' ? 15 : 10;
    const totalCost = cost * (batchCount || 1);
    const check = await fetch('/api/credits/balance').then(r => r.json()).catch(() => ({ ok: false, balance: 0 }));
    if (!check.ok || (check.balance ?? 0) < totalCost) {
      showToast(`Crédits insuffisants (${check.balance ?? 0} / ${totalCost}). Achetez un pack ou passez au plan Pro.`);
      setShowBuyCreditsModal(true);
      setIsExporting(false);
      return;
    }

    try {
      const total = batchCount;
      const createdPostIds: string[] = [];
      // A short rotating list of ANGLES so each batch iteration asks the AI
      // for a distinct perspective on the theme. Without this hint Claude
      // tends to return near-identical content for the same topic string.
      const ANGLES = [
        "axe scientifique : données, études, chiffres précis",
        "axe pratique : routines quotidiennes, conseils actionnables",
        "axe débutant : vocabulaire simple, erreurs à éviter",
        "axe avancé : techniques pointues, optimisations",
        "axe motivation : transformation, gains concrets",
        "axe santé mentale : bien-être, récupération, stress",
        "axe alimentation : nutriments, timing des repas",
        "axe matériel / équipement : ce qu'il faut vraiment",
        "axe mythes et vérités : idées reçues vs réalité",
        "axe transformation 30 jours : plan structuré avec jalons",
        "axe pièges à éviter : erreurs communes et comment y échapper",
        "axe routine matin/soir : rituels pour encadrer la journée",
        "axe combinaison : synergies entre plusieurs pratiques",
        "axe récupération : repos actif, sommeil, techniques",
        "axe énergie rapide : gains sous 5-10 minutes",
        "axe longue durée : progression sur 3-6-12 mois",
        "axe débutant vs avancé : le même geste adapté à chaque niveau",
        "axe erreurs courantes : ce que presque tout le monde rate",
        "axe guide pas à pas : séquence numérotée de A à Z",
        "axe naturel vs industriel : choix bruts vs produits transformés",
      ];
      // Helper: fetch fresh AI-generated content for the SAME theme but a
      // DIFFERENT angle each iteration, so each batch video carries its own
      // title / subtitle / cards. Falls back to the local generator if AI
      // fails. Returns null if both fail (caller keeps the editor's values).
      // `priorTitles` accumulates the titles already used earlier in the
      // batch so each AI call can be told to avoid them explicitly. We seed
      // it with the editor title (shipped as b=0) so b=1+ steer clear of it.
      const priorTitles: string[] = [];
      if (title?.trim()) priorTitles.push(title.trim());
      const generateBatchVariation = async (batchIndex: number): Promise<{ title: string; subtitle: string; cards: typeof cards; salesPhrases: string[] } | null> => {
        const themeObj = CONTENT_THEMES.find((t) => t.id === contentTheme);
        const topicText = contentTheme === "personnalise" ? customTopic : themeObj?.label || contentTheme;
        console.log(`[BatchVariation #${batchIndex}] topic="${topicText}" contentTheme="${contentTheme}"`);
        if (!topicText.trim()) {
          console.warn(`[BatchVariation #${batchIndex}] ABORT — empty topic`);
          return null;
        }
        const accent = COLOR_THEMES.find((ct) => ct.id === colorTheme)?.accent || customAccent || "#a855f7";
        const angle = ANGLES[(batchIndex - 1) % ANGLES.length];
        // The topic itself stays clean; angle is injected as a prompt suffix
        // and the variationNonce goes in its own field so the server can
        // thread it into the prompt without polluting the topic string.
        const aiTopic = `${topicText} (angle: ${angle})`;
        const variationNonce = `${batchIndex}-${Date.now().toString(36)}`;
        // AI first — 45s client timeout. Claude Haiku 4.5 usually answers
        // in 3-12s; generous ceiling avoids punching to the lower-quality
        // local fallback before the real variation arrives on slow runs.
        try {
          console.log(`[BatchVariation #${batchIndex}] AI → /api/content/ai-generate angle="${angle.slice(0, 40)}..."`);
          const aiController = new AbortController();
          const aiTimeout = setTimeout(() => aiController.abort(), 45000);
          const r = await fetch("/api/content/ai-generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              topic: aiTopic,
              locale: "fr",
              cardCount: 3,
              variationNonce,
              // Tell the model which titles this batch has already shipped
              // so it avoids repeating them on the current iteration.
              existingTitles: priorTitles,
            }),
            signal: aiController.signal,
          });
          clearTimeout(aiTimeout);
          console.log(`[BatchVariation #${batchIndex}] AI http status:`, r.status, r.ok);
          if (r.ok) {
            const d = await r.json();
            console.log(`[BatchVariation #${batchIndex}] AI success?`, d?.success, 'has content?', !!d?.content);
            if (d.success && d.content) {
              console.log('[Batch variation] batchIndex:', batchIndex, 'cards count:', (d.content.cards || []).length, 'card labels:', (d.content.cards || []).map((c: any) => c.label));
              return {
                title: d.content.title || topicText.toUpperCase(),
                subtitle: d.content.subtitle || "",
                // Inherit every DESIGN-level field (position for free-mode
                // layout, per-card color, iconType/Color/Size/Style/Gradient)
                // from the editor's current cards[i] template so each batch
                // iteration keeps the user's configured layout; only the
                // CONTENT (label/value/description/icon emoji) is replaced
                // with the AI variation.
                cards: (d.content.cards || []).map((c: any, i: number) => {
                  const template = cards[i] || cards[0];
                  const resolved = resolveCardIcon(c.label, c.description, c.iconName || template?.emoji || "Sparkles");
                  return {
                    ...(template || {}),
                    id: `batch-${Date.now()}-${i}`,
                    label: c.label || "",
                    value: c.value || "",
                    description: c.description || "",
                    // When the template had an emoji icon, keep its glyph;
                    // otherwise use the lucide icon resolved from the
                    // new label text.
                    emoji: resolved.emoji,
                    iconType: template?.iconType || resolved.iconType,
                    color: template?.color || accent,
                  } as InfoCard;
                }),
                salesPhrases: d.content.salesPhrases || [],
              };
            }
          }
        } catch (err) {
          console.warn(`[BatchVariation #${batchIndex}] AI call failed:`, err);
        }
        // Local fallback — now pool-aware: batchIndex rotates the variant pick
        // and the card window, so consecutive calls yield genuinely different
        // content even with the same topic string.
        try {
          console.log(`[BatchVariation #${batchIndex}] LOCAL → /api/content/generate`);
          const localController = new AbortController();
          const localTimeout = setTimeout(() => localController.abort(), 10000);
          const r = await fetch("/api/content/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ topic: topicText, batchIndex }),
            signal: localController.signal,
          });
          clearTimeout(localTimeout);
          console.log(`[BatchVariation #${batchIndex}] LOCAL http status:`, r.status, r.ok);
          if (r.ok) {
            const d = await r.json();
            console.log(`[BatchVariation #${batchIndex}] LOCAL success?`, d?.success, 'has content?', !!d?.content);
            if (d.success && d.content) {
              console.log('[Batch variation local] batchIndex:', batchIndex, 'cards count:', (d.content.cards || []).length, 'card labels:', (d.content.cards || []).map((c: any) => c.title));
              return {
                title: d.content.tagLine || topicText.toUpperCase(),
                subtitle: d.content.subtitle || "",
                cards: (d.content.cards || []).slice(0, 3).map((c: any, i: number) => {
                  // Same design-inheritance strategy as the AI branch — keep
                  // the user's position/color/iconStyle, replace only the
                  // textual content.
                  const template = cards[i] || cards[0];
                  const resolved = resolveCardIcon(c.title, c.description, toLucideName(c.icon));
                  return {
                    ...(template || {}),
                    id: `batch-${Date.now()}-${i}`,
                    label: c.title || "",
                    value: c.value || "",
                    description: c.description || "",
                    emoji: resolved.emoji,
                    iconType: template?.iconType || resolved.iconType,
                    color: template?.color || accent,
                  } as InfoCard;
                }),
                salesPhrases: [],
              };
            }
          }
        } catch (err) {
          console.warn(`[BatchVariation #${batchIndex}] Local fallback failed:`, err);
        }

        // Last-resort stub: both endpoints failed. Return an angle-derived
        // variation so the batch at least ships distinct titles/subtitles
        // instead of N identical videos. Cards reuse the editor's templates
        // with a short angle suffix appended to the description so the text
        // is visibly different per iteration.
        console.warn(`[BatchVariation #${batchIndex}] BOTH endpoints failed — falling back to angle-stub`);
        const angleTitle = angle.split(':')[0].replace('axe ', '').trim();
        const stubTitle = `${topicText.toUpperCase()} — ${angleTitle.toUpperCase()}`;
        const stubSubtitle = angle.split(':').slice(1).join(':').trim() || angle;
        return {
          title: stubTitle,
          subtitle: stubSubtitle,
          cards: cards.map((template, i) => ({
            ...template,
            id: `batch-stub-${Date.now()}-${i}`,
            description: `${template.description || ''} — ${angleTitle}`.trim(),
          } as InfoCard)),
          salesPhrases: [],
        };
      };

      for (let b = 0; b < total; b++) {
        setExportProgress(Math.round((b / total) * 100));
        console.log(`[Batch ${b}/${total - 1}] START`);

        // Per-batch content. b=0 keeps the editor's current values so the
        // user's manual edits ship with the first video. b>0 fetches a
        // fresh variation on the same theme — different cards/title/sub.
        let bTitle = title;
        let bSubtitle = subtitle;
        let bCards = cards;
        let bSalesPhrases = salesPhrases;
        if (b > 0) {
          const variation = await generateBatchVariation(b);
          console.log(`[Batch ${b}] variation:`, variation ? 'SUCCESS' : 'NULL');
          if (variation) {
            console.log(`[Batch ${b}] variation.title:`, variation.title);
            console.log(`[Batch ${b}] variation.cards labels:`, variation.cards.map((c) => c.label));
            bTitle = variation.title;
            bSubtitle = variation.subtitle;
            bCards = variation.cards;
            if (variation.salesPhrases.length > 0) bSalesPhrases = variation.salesPhrases;
            // Record the title we just shipped so the next iteration's AI
            // call is told not to repeat it.
            if (bTitle?.trim()) priorTitles.push(bTitle.trim());
          } else {
            console.warn(`[Batch ${b}] variation returned NULL — post will reuse editor's current values (identical to b=0)`);
          }
        }
        console.log(`[Batch ${b}] FINAL bTitle="${bTitle}" bSubtitle="${bSubtitle}" cardLabels=${JSON.stringify(bCards.map((c) => c.label))}`);

        // Photo affiche = OPTIONNELLE. Si l'utilisateur a explicitement
        // désélectionné (selectedPhotoIndex = -1) ou n'a jamais cherché
        // de photos, posterUrl reste null et le composer peint le gradient.
        // batchPhotoIndices[b] n'est consulté QU'EN MODE BATCH (batchCount > 1)
        // — sinon des indices hérités d'une session batch précédente
        // écraseraient silencieusement le selectedPhotoIndex du mode single.
        const photoIdx = batchCount > 1 ? (batchPhotoIndices[b] ?? selectedPhotoIndex) : selectedPhotoIndex;
        const photo = (pexelsPhotos.length > 0 && photoIdx >= 0) ? pexelsPhotos[photoIdx] : null;
        const posterUrl = photo?.url || null;

        // Pick a different sales phrase per batch item
        const salesPhrase =
          bSalesPhrases.length > 0 ? bSalesPhrases[b % bSalesPhrases.length] : "";

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
            bSubtitle,
            bCards.map((c) => `${c.emoji} ${c.label}: ${c.value}`).join(" | "),
            salesPhrase ? `\n${salesPhrase}` : "",
            "\n💬 Plus d'infos → https://afroboost.com",
          ]
            .filter(Boolean)
            .join("\n");

          // ── Compose montage video NOW at export time (not deferred to calendar) ──
          // This ensures the exported post always has a ready-to-publish video
          // Accent used by the composer for text / CTA / progress bar. We
          // prefer `gradientColor1` (the actual dominant hex the editor paints
          // on-screen) over `colorTheme` lookup, because a stale localStorage
          // `colorTheme='green'` can silently inject '#10b981' green even
          // after the user has changed the gradient picker to purple.
          const exportAccent = customAccent || gradientColor1 || COLOR_THEMES.find((ct) => ct.id === colorTheme)?.accent || "#a855f7";
          const isReel = format === "9:16";
          let renderedVideoUrl: string | null = null;
          let renderedThumbnailUrl: string | null = null;
          let renderedComposerVersion: string | null = null;
          try {
            console.log('[Export→Calendar] Starting montage composition...', { batchIdx: b, posterUrl, rushUrl, isReel, format, title: bTitle, cardsCount: bCards.length, musicUrl: audioMusicUrl?.substring(0, 60) || 'NONE', voiceUrl: audioVoiceUrl?.substring(0, 60) || 'NONE', musicVolume: audioMusicVolume, voiceVolume: audioVoiceVolume });
            setExportProgress(Math.round(((b + 0.3) / total) * 100));
            // Snapshot the live editor cards grid for WYSIWYG parity. The
            // [data-cards-grid] element only renders when activeSequence is
            // Every iteration (including b > 0) captures a FRESH DOM
            // snapshot (modern-screenshot) of the cards grid rendered with the iteration's
            // variation content. Before PR #26's workaround we only
            // captured at b === 0 and every subsequent video inherited that
            // layout; skipping to the manual Canvas 2D fallback produced
            // noticeably different layouts (clipped / overlapping cards).
            // The fix: temporarily sync React `cards` state with `bCards`,
            // wait for the repaint, snapshot, then restore the editor's
            // original cards once the compose call returns.
            let cardsSnapshot: HTMLImageElement | undefined;
            let cardsSnapshotRect: { x: number; y: number; width: number; height: number } | undefined;
            const prevSequenceCal = activeSequence;
            let didForceSequenceCal = false;
            // modern-screenshot supports `background-clip: text` natively, so
            // the gradient gate that previously skipped the snapshot is gone.
            // Snapshot is now the single source of truth for cards rendering;
            // manual canvas draw in video-composer.ts only kicks in when the
            // snapshot itself fails (cardsEl absent or zero-sized).
            const shouldSnapshot = exportedSequences.cartes && bCards.length > 0;
            const originalCardsForBatch = cards; // captured once per iteration
            const needsStateSync = b > 0 && shouldSnapshot;
            if (shouldSnapshot && activeSequence !== 'cartes' && activeSequence !== 'all') {
              setActiveSequence('cartes');
              didForceSequenceCal = true;
            }
            if (needsStateSync) {
              // Push the iteration's cards into the editor state so the
              // DOM reflects what this video should display. flushSync
              // forces React to commit synchronously so the subsequent
              // rAFs actually observe the new DOM. The finally block
              // restores `originalCardsForBatch` so the editor view isn't
              // permanently mutated.
              flushSync(() => {
                setCards(bCards);
              });
            }
            if (needsStateSync || didForceSequenceCal) {
              // 1. Wait for any newly-requested fonts (per-element font
              //    overrides applied to card text) to finish loading, so
              //    modern-screenshot doesn't serialize fallback metrics.
              try {
                if (typeof document !== 'undefined' && (document as any).fonts?.ready) {
                  await (document as any).fonts.ready;
                }
              } catch { /* ignore */ }
              // 2. Flush React commits + force a layout reflow so offsetWidth
              //    reflects the updated cards. document.body.offsetHeight is
              //    a classic trick to synchronously force layout.
              await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
              // eslint-disable-next-line @typescript-eslint/no-unused-expressions
              document.body.offsetHeight;
              // 3. A third rAF to give the paint one more chance after the
              //    forced reflow.
              await new Promise<void>((r) => requestAnimationFrame(() => r()));
            }
            try {
              const cardsEl = shouldSnapshot ? document.querySelector('[data-cards-grid]') as HTMLElement | null : null;
              // Diagnostic: verify the DOM actually reflects bCards rather than
              // the editor's original cards — catches cases where the React
              // re-render got skipped or the element was stale.
              if (cardsEl && needsStateSync) {
                const firstLabelInDom = cardsEl.querySelector('p, h3, span')?.textContent?.slice(0, 40) || '(no text)';
                console.log(`[Batch #${b}] DOM first card label:`, firstLabelInDom, '| expected bCards[0].label:', bCards[0]?.label);
              }
              console.log(`[Batch #${b}] cardsEl offsetWidth/Height:`, cardsEl?.offsetWidth, cardsEl?.offsetHeight);
              if (cardsEl && cardsEl.offsetWidth > 0 && shouldSnapshot) {
                const { domToCanvas } = await import('modern-screenshot');
                const videoW = isReel ? 1080 : 1920;
                const previewW = previewRef.current?.offsetWidth || (isReel ? 320 : 512);
                const scale = videoW / previewW;
                // Wait for any web fonts to finish loading before snapshotting,
                // otherwise modern-screenshot may serialize a fallback font.
                try { await (document as any).fonts?.ready; } catch { /* ignore */ }
                const canvas = await domToCanvas(cardsEl, { backgroundColor: undefined, scale });
                const img = new Image();
                img.src = canvas.toDataURL('image/png');
                await new Promise<void>((r) => { img.onload = () => r(); });
                console.log(`[Batch #${b}] snapshot natural size:`, img.naturalWidth, img.naturalHeight);
                if (img.naturalWidth === 0 || img.naturalHeight === 0) {
                  console.warn(`[Batch #${b}] Snapshot has zero natural size — falling back to manual canvas render.`);
                } else {
                  cardsSnapshot = img;
                  if (previewRef.current) {
                    const pRect = previewRef.current.getBoundingClientRect();
                    const cRect = cardsEl.getBoundingClientRect();
                    cardsSnapshotRect = {
                      x: ((cRect.left - pRect.left) / pRect.width) * 100,
                      y: ((cRect.top - pRect.top) / pRect.height) * 100,
                      width: (cRect.width / pRect.width) * 100,
                      height: (cRect.height / pRect.height) * 100,
                    };
                  }
                  console.log(`[Batch #${b}] Cards snapshot OK:`, cardsSnapshot.width, 'x', cardsSnapshot.height, 'rect:', cardsSnapshotRect);
                }
              } else if (shouldSnapshot) {
                console.warn(`[Batch #${b}] Cards grid element missing or zero-sized — using manual canvas fallback.`);
              }
            } catch (err) {
              console.warn(`[Batch #${b}] Cards snapshot failed, composer will use canvas fallback:`, err);
            } finally {
              if (didForceSequenceCal) {
                setActiveSequence(prevSequenceCal);
              }
              if (needsStateSync) {
                // Restore the editor's own cards so the user's UI is intact.
                flushSync(() => {
                  setCards(originalCardsForBatch);
                });
              }
            }
            // eslint-disable-next-line no-console
            console.log('[Export PRE-COMPOSE site=Calendar] cardsSnapshot truthy?', !!cardsSnapshot, 'value:', cardsSnapshot);
            console.log('[Batch compose] b:', b, 'cards passed to composer:', bCards.map((c) => c.label));
            console.log('[Export PRE-COMPOSE site=Calendar] legacy overlay:', JSON.stringify({
              text: videoOverlayText,
              x: overlayPos.x,
              y: overlayPos.y,
              startTime: overlayStartTime,
              endTime: overlayEndTime,
              scale: overlayTextScale,
            }));
            console.log('[Export PRE-COMPOSE site=Calendar] extraOverlays passed:', JSON.stringify(
              extraOverlays.map((o) => ({
                text: o.text,
                x: o.position?.x,
                y: o.position?.y,
                startTime: o.startTime,
                endTime: o.endTime,
                scale: o.scale,
              }))
            ));
            const ctaIconImage = await preRenderCtaIcon();
            const { url: composedUrl, thumbnailUrl: composedThumbUrl, composerVersion: composedVersion } = await composeAndUpload({
              width: isReel ? 1080 : 1920,
              height: isReel ? 1920 : 1080,
              fps: 30,
              watermark: useWatermark,
              title: bTitle || "Infographie",
              subtitle: bSubtitle || undefined,
              salesPhrase: salesPhrase || undefined,
              cards: bCards.length > 0 && exportedSequences.cartes
                ? await preRenderCardIcons(bCards).then(rendered => rendered.map((c) => ({ emoji: c.emoji, label: c.label, value: c.value, description: c.description, color: c.color, position: c.position, textOnly: c.textOnly, iconImage: (c as any).iconImage })))
                : undefined,
              posterUrl: posterUrl,
              sequenceBackgrounds,
              videoUrl: exportedSequences.video && rushList[0]?.kind !== 'image' ? (rushUrl || undefined) : undefined,
              videoImageUrl: exportedSequences.video && rushList[0]?.kind === 'image' ? (rushUrl || undefined) : undefined,
              rushTransform: rushList[0]?.transform,
              logoUrl: logoImage || null,
              musicUrl: audioMusicUrl || undefined,
              voiceUrl: audioVoiceUrl || undefined,
              musicVolume: audioMusicVolume,
              voiceVolume: audioVoiceVolume,
              // Per-sequence voice-overs (PR C) — composer plays each at
              // its sequence offset. Falls back to legacy voiceUrl when
              // these are all undefined.
              sequenceVoiceUrls: {
                titre: sequenceVoices.titre.audioUrl || undefined,
                cartes: sequenceVoices.cartes.audioUrl || undefined,
                video: sequenceVoices.video.audioUrl || undefined,
                cta: sequenceVoices.cta.audioUrl || undefined,
              },
              audioKeyframes,
              introDuration: exportedSequences.titre ? introDuration : 0,
              cardsDuration: bCards.length > 0 && exportedSequences.cartes ? cardsDuration : 0,
              videoDuration: rushUrl && exportedSequences.video ? videoDuration : 0,
              ctaDuration: exportedSequences.cta ? ctaDuration : 0,
              accentColor: exportAccent,
              ctaText: ctaSubText || "CHAT POUR PLUS D'INFOS",
              ctaSubText: "LIEN EN BIO",
              watermarkText: ctaMainText || "AFROBOOST",
              siteText: siteTextEnabled ? {
                text: siteText, color: siteTextColor, opacity: siteTextOpacity,
                size: siteTextSize, sequences: siteTextSequences, enabled: siteTextEnabled,
                positions: siteTextPositions,
              } : undefined,
              design: {
                font: selectedFont, filter: selectedFilter, cardStyle: selectedCardStyle,
                textScale, ctaTextScale, cardsTextScale, titleColor, ctaColor, ctaSubColor,
                ctaMainText: ctaMainText || "AFROBOOST",
                ctaSubTextDesign: ctaSubText || "CHAT POUR PLUS D'INFOS",
                noColorBg, noColorSequences,
                gradientColor1, gradientColor2, gradientOpacity, seqGradients,
                backdropRounded, backdropRadius, backdropMargin,
                borderEnabled: branding.borderEnabled,
                borderColor: branding.borderColor,
                cardsSnapshot,
                cardsSnapshotRect,
                logoPosition: getActiveLogoPos(),
                logoPositions, cardsSize,
                logoScale, logoSequences,
                overlayText: videoOverlayText || undefined,
                overlayColor: overlayColor || undefined,
                overlayTextScale,
                overlayStartTime,
                overlayEndTime,
                overlays: extraOverlays.length > 0 ? extraOverlays.map(({ id: _id, ...rest }) => rest) : undefined,
                titlePosition: titlePos, cardsPosition: cardsPos,
                watermarkPosition: watermarkPos, overlayPosition: overlayPos,
                titleSize, watermarkSize: watermarkSize,
                titleTypography: {
                  letterSpacing: titleLetterSpacing, lineHeight: titleLineHeight,
                  bold: titleBold, italic: titleItalic,
                  textGradient: titleTextGradient, gradColor1: titleGradColor1, gradColor2: titleGradColor2,
                  duplicate: titleDuplicate, duplicateOffset: titleDuplicateOffset, duplicateOpacity: titleDuplicateOpacity,
                },
                ctaTypography: {
                  letterSpacing: ctaLetterSpacing, lineHeight: ctaLineHeight, bold: ctaBold, italic: ctaItalic,
                  textGradient: ctaTextGradient, gradColor1: ctaGradColor1, gradColor2: ctaGradColor2,
                },
                overlayTypography: {
                  letterSpacing: overlayLetterSpacing, lineHeight: overlayLineHeight, bold: overlayBold, italic: overlayItalic,
                  textGradient: overlayTextGradient, gradColor1: overlayGradColor1, gradColor2: overlayGradColor2,
                },
                titleFont, ctaFont, overlayFont, watermarkFont, cardsFont,
                watermarkTextGradient, watermarkGradColor1, watermarkGradColor2,
                cardsTypography: (cardsLabelGradient || cardsValueGradient || cardsDescriptionGradient) ? { labelGradient: cardsLabelGradient, valueGradient: cardsValueGradient, descriptionGradient: cardsDescriptionGradient, gradColor1: cardsTextGradColor1, gradColor2: cardsTextGradColor2 } : undefined,
                ctaIconImage,
                ctaIconColor,
                ctaIconGradient,
                ctaIconGradColor1,
                ctaIconGradColor2,
                ctaIconSize,
                extraTitle: extraTitle || undefined,
                extraSubtitle: extraSubtitle || undefined,
                extraTitlePosition,
                extraSubtitlePosition,
                extraTitleTypography: {
                  scale: extraTitleScale,
                  letterSpacing: extraTitleLetterSpacing,
                  lineHeight: extraTitleLineHeight,
                  bold: extraTitleBold,
                  italic: extraTitleItalic,
                  textGradient: extraTitleGradient,
                  gradColor1: extraTitleGradColor1,
                  gradColor2: extraTitleGradColor2,
                },
                extraSubtitleTypography: {
                  scale: extraSubtitleScale,
                  letterSpacing: extraSubtitleLetterSpacing,
                  lineHeight: extraSubtitleLineHeight,
                  bold: extraSubtitleBold,
                  italic: extraSubtitleItalic,
                  textGradient: extraSubtitleGradient,
                  gradColor1: extraSubtitleGradColor1,
                  gradColor2: extraSubtitleGradColor2,
                },
              },
              onProgress: (pct) => {
                setExportProgress(Math.round(((b + 0.3 + pct / 100 * 0.6) / total) * 100));
              },
            });
            renderedVideoUrl = composedUrl;
            renderedThumbnailUrl = composedThumbUrl || null;
            renderedComposerVersion = composedVersion || null;
            console.log('[Export→Calendar] Montage composed and uploaded:', renderedVideoUrl, 'thumb:', renderedThumbnailUrl, 'version:', renderedComposerVersion);
            // Deduct credits for this successful render
            await fetch('/api/credits/deduct', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ cost, reason: 'render', format: renderFormat }),
            }).catch(() => {});
            if (!renderedVideoUrl) {
              // Only surface errors as toasts — success is conveyed by the
              // progress bar reaching 100%.
              showToast('Attention : la vidéo a été composée mais l\'upload a échoué');
            }
          } catch (err) {
            console.error('[Export→Calendar] Montage composition failed:', err);
            showToast(`Erreur composition: ${err instanceof Error ? err.message : 'Erreur inconnue'}`);
            // Continue — post will be saved without video, calendar can retry
          }

          const postRes = await fetch("/api/posts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: bTitle || "Infographie",
              caption,
              // Use the composed video URL if available, otherwise fallback to image
              media_url: renderedVideoUrl || (hasVideo ? null : (mediaUrl || posterUrl || null)),
              media_type: 'video',
              format: format === "16:9" ? "tv" : "reel",
              platforms: selectedPublishPlatforms.map(p => PLATFORM_DISPLAY_NAMES[p]),
              scheduled_date: scheduledDate,
              scheduled_time: "12:00",
              status: (selectedPublishPlatforms.length > 0 && (renderedVideoUrl || (hasVideo ? null : (mediaUrl || posterUrl || null)))) ? "scheduled" : "draft",
              metadata: {
                type: "infographic",
                subtitle: bSubtitle,
                videoOverlayText: videoOverlayText || undefined,
                // Extra video overlays (Overlay 2/3/4 in the editor) +
                // their timing/scale on the legacy one. The composer
                // (and calendar re-composition) needs these to place
                // each overlay at its own position instead of stacking.
                overlays: extraOverlays.length > 0
                  ? extraOverlays.map(({ id: _id, ...rest }) => rest)
                  : undefined,
                overlayTextScale,
                overlayStartTime,
                overlayEndTime,
                overlayPosition: overlayPos,
                overlayColor,
                theme: contentTheme,
                colorTheme,
                salesPhrase,
                cards: bCards.map((c) => ({
                  emoji: c.emoji,
                  label: c.label,
                  value: c.value,
                  description: c.description,
                  color: c.color,
                  position: c.position,
                  textOnly: c.textOnly,
                })),
                characterUrl: characterImage ? mediaUrl : null,
                posterUrl,
                pexelsUrl: posterUrl,
                renderedVideoUrl: renderedVideoUrl || undefined,
                thumbnailUrl: renderedThumbnailUrl || undefined,
                composerVersion: renderedComposerVersion || undefined,
                logoUrl: logoImage || undefined,
                videoUrl: rushUrl && rushList[0]?.kind !== 'image' ? rushUrl : undefined,
                videoImageUrl: rushUrl && rushList[0]?.kind === 'image' ? rushUrl : undefined,
                rushKind: rushList[0]?.kind || (rushUrl ? 'video' : undefined),
                rushUrls: rushUrl ? [rushUrl] : undefined,
                cardGroups: cardGroups.length > 0 ? cardGroups : undefined,
                musicUrl: audioMusicUrl || undefined,
                voiceUrl: audioVoiceUrl || undefined,
                hasAudio: !!(audioMusicUrl || audioVoiceUrl || sequenceVoices.titre.audioUrl || sequenceVoices.cartes.audioUrl || sequenceVoices.video.audioUrl || sequenceVoices.cta.audioUrl),
                // Per-sequence voice-overs persisted in metadata so the
                // calendar regenerate path can replay them. Stored as a
                // simple URL map (not the full SequenceVoice with text/
                // userEdited — that's editor-only state).
                sequenceVoiceUrls: {
                  titre: sequenceVoices.titre.audioUrl || undefined,
                  cartes: sequenceVoices.cartes.audioUrl || undefined,
                  video: sequenceVoices.video.audioUrl || undefined,
                  cta: sequenceVoices.cta.audioUrl || undefined,
                },
                audioKeyframes: audioKeyframes.length > 0 ? audioKeyframes : undefined,
                sequences: {
                  intro: exportedSequences.titre ? introDuration : 0,
                  cards: cards.length > 0 && exportedSequences.cartes ? cardsDuration : 0,
                  video: rushUrl && exportedSequences.video ? videoDuration : 0,
                  cta: exportedSequences.cta ? ctaDuration : 0,
                  total:
                    (exportedSequences.titre ? introDuration : 0) +
                    (cards.length > 0 && exportedSequences.cartes ? cardsDuration : 0) +
                    (rushUrl && exportedSequences.video ? videoDuration : 0) +
                    (exportedSequences.cta ? ctaDuration : 0),
                  order: [
                    ...(exportedSequences.titre ? ["intro"] : []),
                    ...(cards.length > 0 && exportedSequences.cartes ? ["cards"] : []),
                    ...(rushUrl && exportedSequences.video ? ["video"] : []),
                    ...(exportedSequences.cta ? ["cta"] : []),
                  ],
                },
                branding: {
                  accentColor:
                    COLOR_THEMES.find((ct) => ct.id === colorTheme)?.accent ||
                    "#a855f7",
                  ctaText: ctaSubText || "CHAT POUR PLUS D'INFOS",
                  ctaSubText: "LIEN EN BIO",
                  watermarkText: ctaMainText || "AFROBOOST",
                  borderEnabled: branding.borderEnabled,
                  borderColor: branding.borderEnabled ? branding.borderColor : null,
                },
                // ── Design settings (positions, sizes, colors, font, filter, typography, etc.) ──
                design: {
                  font: selectedFont,
                  filter: selectedFilter,
                  cardStyle: selectedCardStyle,
                  textScale,
                  ctaTextScale,
                  cardsTextScale,
                  cardsLetterSpacing,
                  cardsFont,
                  titleFont,
                  ctaFont,
                  overlayFont,
                  watermarkFont,
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
                  borderEnabled: branding.borderEnabled,
                  borderColor: branding.borderColor,
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
                    cards: {
                      labelGradient: cardsLabelGradient,
                      valueGradient: cardsValueGradient,
                      descriptionGradient: cardsDescriptionGradient,
                      gradColor1: cardsTextGradColor1,
                      gradColor2: cardsTextGradColor2,
                    },
                  },
                  overlayColor,
                  cardCustomIcons: customCardIcons,
                  ctaIconName: ctaIconName || undefined,
                  ctaIconColor: ctaIconColor || undefined,
                  ctaIconGradient: ctaIconGradient,
                  ctaIconGradColor1: ctaIconGradColor1 || undefined,
                  ctaIconGradColor2: ctaIconGradColor2 || undefined,
                  ctaIconSize: ctaIconSize,
                  extraTitle: extraTitle || undefined,
                  extraSubtitle: extraSubtitle || undefined,
                  extraTitlePosition,
                  extraSubtitlePosition,
                  extraTitleTypography: {
                    scale: extraTitleScale,
                    letterSpacing: extraTitleLetterSpacing,
                    lineHeight: extraTitleLineHeight,
                    bold: extraTitleBold,
                    italic: extraTitleItalic,
                    textGradient: extraTitleGradient,
                    gradColor1: extraTitleGradColor1,
                    gradColor2: extraTitleGradColor2,
                  },
                  extraSubtitleTypography: {
                    scale: extraSubtitleScale,
                    letterSpacing: extraSubtitleLetterSpacing,
                    lineHeight: extraSubtitleLineHeight,
                    bold: extraSubtitleBold,
                    italic: extraSubtitleItalic,
                    textGradient: extraSubtitleGradient,
                    gradColor1: extraSubtitleGradColor1,
                    gradColor2: extraSubtitleGradColor2,
                  },
                },
              },
            }),
          });
          // Capture created post ID for Studio Son redirect
          try {
            const postData = await postRes.json();
            if (postData.success && postData.post?.id) {
              createdPostIds.push(postData.post.id);
            } else if (!postData.success) {
              showToast(`Erreur lors de la programmation : ${postData.error || 'réponse inattendue du serveur'}`);
              console.error('[Export→Calendar] POST /api/posts non-success:', postData);
            }
          } catch (err) {
            showToast(`Erreur réseau lors de la programmation : ${err instanceof Error ? err.message : 'inconnue'}`);
            console.error('[Export→Calendar] POST /api/posts network/parse error:', err);
          }
        }
      }

      setExportProgress(100);

      // ── Export bureau : composition du montage vidéo final (MP4 uniquement) ──
      if (destination === 'export' || destination === 'both') {
        try {
          // See comment on the sibling `exportAccent` above — we prefer the
          // live gradient color over the (possibly stale) color-theme lookup.
          const exportAccent =
            customAccent || gradientColor1 || COLOR_THEMES.find((ct) => ct.id === colorTheme)?.accent || "#a855f7";
          const isReel = format === "9:16";
          // Pas de fallback automatique vers pexelsPhotos[0] : si l'utilisateur
          // a désélectionné (-1), il veut le gradient — respecter ce signal.
          const exportPhoto = (pexelsPhotos.length > 0 && selectedPhotoIndex >= 0) ? pexelsPhotos[selectedPhotoIndex] : null;
          const exportPosterUrl = exportPhoto?.url || null;

          // Snapshot the live editor cards grid for WYSIWYG parity. The
          // [data-cards-grid] element only renders when activeSequence is
          // "all" or "cartes" — force the preview to the cards sequence
          // around the capture so the snapshot is never empty, then restore.
          let cardsSnapshot: HTMLImageElement | undefined;
          let cardsSnapshotRect: { x: number; y: number; width: number; height: number } | undefined;
          const prevSequenceBur = activeSequence;
          let didForceSequenceBur = false;
          if (exportedSequences.cartes && cards.length > 0 && activeSequence !== 'cartes' && activeSequence !== 'all') {
            setActiveSequence('cartes');
            didForceSequenceBur = true;
            await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
          }
          try {
            const cardsEl = document.querySelector('[data-cards-grid]') as HTMLElement | null;
            console.log('[Export] cardsEl offsetWidth/Height:', cardsEl?.offsetWidth, cardsEl?.offsetHeight);
            if (cardsEl && cardsEl.offsetWidth > 0 && exportedSequences.cartes && cards.length > 0) {
              const { domToCanvas } = await import('modern-screenshot');
              // Scale the capture so 1 DOM px = 1 video-canvas px. The
              // snapshot's intrinsic size then matches the cards' target
              // render size, and the composer can blit it at natural size.
              // modern-screenshot supports background-clip: text natively, so
              // gradient toggles no longer need to skip the snapshot.
              const videoW = isReel ? 1080 : 1920;
              const previewW = previewRef.current?.offsetWidth || (isReel ? 320 : 512);
              const scale = videoW / previewW;
              try { await (document as any).fonts?.ready; } catch { /* ignore */ }
              const canvas = await domToCanvas(cardsEl, { backgroundColor: undefined, scale });
              const img = new Image();
              img.src = canvas.toDataURL('image/png');
              await new Promise<void>((r) => { img.onload = () => r(); });
              console.log('[Export] snapshot natural size:', img.naturalWidth, img.naturalHeight);
              if (img.naturalWidth === 0 || img.naturalHeight === 0) {
                console.warn('[Export] Snapshot has zero natural size — falling back to manual canvas render.');
              } else {
                cardsSnapshot = img;
                if (previewRef.current) {
                  const pRect = previewRef.current.getBoundingClientRect();
                  const cRect = cardsEl.getBoundingClientRect();
                  cardsSnapshotRect = {
                    x: ((cRect.left - pRect.left) / pRect.width) * 100,
                    y: ((cRect.top - pRect.top) / pRect.height) * 100,
                    width: (cRect.width / pRect.width) * 100,
                    height: (cRect.height / pRect.height) * 100,
                  };
                }
                console.log('[Export] Cards snapshot OK:', cardsSnapshot.width, 'x', cardsSnapshot.height, '(scale', scale.toFixed(3), 'previewW', previewW + ') rect:', cardsSnapshotRect);
              }
            } else if (exportedSequences.cartes && cards.length > 0) {
              console.warn('[Export] Cards grid element missing or zero-sized after forced sequence switch — using manual canvas fallback.');
            }
          } catch (err) {
            console.warn('[Export] Cards snapshot failed, composer will use canvas fallback:', err);
          } finally {
            if (didForceSequenceBur) {
              setActiveSequence(prevSequenceBur);
            }
          }

          // Composer le montage vidéo final puis télécharger en MP4
          setExportProgress(50);
          // eslint-disable-next-line no-console
          console.log('[Export PRE-COMPOSE site=Bureau] cardsSnapshot truthy?', !!cardsSnapshot, 'value:', cardsSnapshot);
          console.log('[Export PRE-COMPOSE site=Bureau] legacy overlay:', JSON.stringify({
            text: videoOverlayText,
            x: overlayPos.x,
            y: overlayPos.y,
            startTime: overlayStartTime,
            endTime: overlayEndTime,
            scale: overlayTextScale,
          }));
          console.log('[Export PRE-COMPOSE site=Bureau] extraOverlays passed:', JSON.stringify(
            extraOverlays.map((o) => ({
              text: o.text,
              x: o.position?.x,
              y: o.position?.y,
              startTime: o.startTime,
              endTime: o.endTime,
              scale: o.scale,
            }))
          ));
          const ctaIconImage = await preRenderCtaIcon();
          const composedResult = await composeAndUpload({
            width: isReel ? 1080 : 1920,
            height: isReel ? 1920 : 1080,
            fps: 30,
            watermark: useWatermark,
            title: title || "Infographie",
            subtitle: subtitle || undefined,
            salesPhrase: salesPhrases.length > 0 ? salesPhrases[0] : undefined,
            cards: cards.length > 0 && exportedSequences.cartes
              ? await preRenderCardIcons(cards).then(rendered => rendered.map((c) => ({ emoji: c.emoji, label: c.label, value: c.value, description: c.description, color: c.color, position: c.position, textOnly: c.textOnly, iconImage: (c as any).iconImage })))
              : undefined,
            posterUrl: exportPosterUrl,
            sequenceBackgrounds,
            videoUrl: exportedSequences.video && rushList[0]?.kind !== 'image' ? rushUrl : undefined,
            videoImageUrl: exportedSequences.video && rushList[0]?.kind === 'image' ? rushUrl : undefined,
            rushTransform: rushList[0]?.transform,
            logoUrl: logoImage || null,
            musicUrl: audioMusicUrl || undefined,
            voiceUrl: audioVoiceUrl || undefined,
            musicVolume: audioMusicVolume,
            voiceVolume: audioVoiceVolume,
            sequenceVoiceUrls: {
              titre: sequenceVoices.titre.audioUrl || undefined,
              cartes: sequenceVoices.cartes.audioUrl || undefined,
              video: sequenceVoices.video.audioUrl || undefined,
              cta: sequenceVoices.cta.audioUrl || undefined,
            },
            audioKeyframes,
            introDuration: exportedSequences.titre ? introDuration : 0,
            cardsDuration: cards.length > 0 && exportedSequences.cartes ? cardsDuration : 0,
            videoDuration: rushUrl && exportedSequences.video ? videoDuration : 0,
            ctaDuration: exportedSequences.cta ? ctaDuration : 0,
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
              cardsSnapshot,
              cardsSnapshotRect,
              ctaSubColor: ctaSubColor || undefined,
              ctaColor: ctaColor || undefined,
              textScale: textScale || undefined,
              ctaTextScale: ctaTextScale || undefined,
              cardsTextScale: cardsTextScale || undefined,
              cardsLetterSpacing: cardsLetterSpacing || undefined,
              cardsFont: cardsFont || undefined,
              titleFont: titleFont || undefined,
              ctaFont: ctaFont || undefined,
              overlayFont: overlayFont || undefined,
              watermarkFont: watermarkFont || undefined,
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
                textGradient: ctaTextGradient,
                gradColor1: ctaGradColor1,
                gradColor2: ctaGradColor2,
              },
              overlayTypography: {
                letterSpacing: overlayLetterSpacing || undefined,
                lineHeight: overlayLineHeight || undefined,
                bold: overlayBold,
                italic: overlayItalic,
                textGradient: overlayTextGradient,
                gradColor1: overlayGradColor1,
                gradColor2: overlayGradColor2,
              },
              overlayText: videoOverlayText || undefined,
              overlayColor: overlayColor || undefined,
              overlayTextScale,
              overlayStartTime,
              overlayEndTime,
              overlays: extraOverlays.length > 0 ? extraOverlays.map(({ id: _id, ...rest }) => rest) : undefined,
              titleFont, ctaFont, overlayFont, watermarkFont, cardsFont,
              watermarkTextGradient, watermarkGradColor1, watermarkGradColor2,
              cardsTypography: (cardsLabelGradient || cardsValueGradient || cardsDescriptionGradient) ? { labelGradient: cardsLabelGradient, valueGradient: cardsValueGradient, descriptionGradient: cardsDescriptionGradient, gradColor1: cardsTextGradColor1, gradColor2: cardsTextGradColor2 } : undefined,
              ctaIconImage,
              ctaIconColor,
              ctaIconGradient,
              ctaIconGradColor1,
              ctaIconGradColor2,
              ctaIconSize,
              noColorBg, noColorSequences,
              seqGradients,
              backdropRounded, backdropRadius, backdropMargin,
              filter: selectedFilter || undefined,
              borderEnabled: branding.borderEnabled,
              borderColor: branding.borderColor,
              extraTitle: extraTitle || undefined,
              extraSubtitle: extraSubtitle || undefined,
              extraTitlePosition,
              extraSubtitlePosition,
              extraTitleTypography: {
                scale: extraTitleScale,
                letterSpacing: extraTitleLetterSpacing,
                lineHeight: extraTitleLineHeight,
                bold: extraTitleBold,
                italic: extraTitleItalic,
                textGradient: extraTitleGradient,
                gradColor1: extraTitleGradColor1,
                gradColor2: extraTitleGradColor2,
              },
              extraSubtitleTypography: {
                scale: extraSubtitleScale,
                letterSpacing: extraSubtitleLetterSpacing,
                lineHeight: extraSubtitleLineHeight,
                bold: extraSubtitleBold,
                italic: extraSubtitleItalic,
                textGradient: extraSubtitleGradient,
                gradColor1: extraSubtitleGradColor1,
                gradColor2: extraSubtitleGradColor2,
              },
            },
            onProgress: (pct, stage) => {
              setExportProgress(50 + Math.round(pct * 0.35));
            },
          });
          setExportProgress(85);
          // ── Téléchargement MP4 garanti ──
          // downloadBlob() cascades client-side FFmpeg WASM → server-side
          // /api/convert/to-mp4 → throws if both fail. NEVER returns a WebM
          // file disguised as .mp4: a thrown error means the user sees a
          // clear toast instead of saving an unplayable file.
          if (composedResult.blob && composedResult.blob.size > 0) {
            const downloadName = `infographie-${(title || 'afroboost').replace(/[^a-zA-Z0-9-_]+/g, '_')}.mp4`;
            try {
              await downloadBlob(composedResult.blob, downloadName, (pct) => {
                setExportProgress(85 + Math.round(pct * 0.14));
              });
              setExportProgress(100);
            } catch (dlErr) {
              console.error('[Export Bureau] downloadBlob cascade failed:', dlErr);
              showToast(`Export bureau échoué : ${(dlErr as Error)?.message || 'conversion MP4 impossible'}`);
              throw dlErr;
            }
            await fetch('/api/credits/deduct', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ cost, reason: 'render', format: renderFormat }),
            }).catch(() => {});
          } else {
            showToast('Export bureau échoué : le rendu vidéo est vide. Réessayez ou utilisez un autre navigateur.');
          }
        } catch (e) {
          console.error('[Export Bureau] Erreur:', e);
          showToast(`Export bureau échoué : ${(e as Error)?.message || 'erreur inconnue'}`);
        }
      }

      // Success is conveyed by the progress bar reaching 100%; no extra toast.
      // (User explicitly asked: ne pas en afficher ailleurs.)

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
  // Explicit `< 0` guard — `pexelsPhotos[-1]` already yields `undefined` but
  // we keep this defensive so the "Sans affiche" button (which sets the index
  // to -1) can never accidentally render the previously-selected poster.
  const previewPhoto = selectedPhotoIndex >= 0 ? (pexelsPhotos[selectedPhotoIndex] || null) : null;

  const getPreviewClasses = () => {
    if (format === "16:9")
      return { aspect: "aspect-[16/9]", maxW: "max-w-lg", cols: "grid-cols-3" };
    return { aspect: "aspect-[9/16]", maxW: "max-w-xs", cols: "grid-cols-2" };
  };
  const previewClasses = getPreviewClasses();

  // ── Render ──────────────────────────────────────────────────
  // ── B3: Rail configuration ────────────────────────────────────
  const railItems: Array<{
    id: Exclude<RailTab, null>;
    label: string;
    Icon: typeof LayoutTemplate;
    color: IconBadgeColor;
  }> = [
    { id: 'templates', label: 'Modèles', Icon: LayoutGrid, color: 'purple' },
    { id: 'elements', label: 'Éléments', Icon: Sparkles, color: 'amber' },
    { id: 'text', label: 'Texte', Icon: Type, color: 'blue' },
    { id: 'cards', label: 'Cartes', Icon: Grid2x2, color: 'pink' },
    { id: 'media', label: 'Médias', Icon: Film, color: 'emerald' },
    { id: 'audio', label: 'Audio', Icon: Music, color: 'cyan' },
    { id: 'settings', label: 'Paramètres', Icon: SettingsIcon, color: 'slate' },
  ];

  // Rail click: just toggle the relevant panel. Never touch `step` — the
  // Left Form panel stays at whatever step the user last selected, so opening
  // a rail tab never pulls unrelated content panels into view.
  const handleRailClick = (id: Exclude<RailTab, null>) => {
    if (activeRailTab === id) {
      setActiveRailTab(null);
      return;
    }
    setActiveRailTab(id);
  };

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col bg-gray-900 text-white overflow-x-hidden">
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

      {/* Undo/redo toast — bottom-center, 1s auto-dismiss */}
      {undoToast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-black/80 backdrop-blur-sm text-white text-xs font-medium shadow-xl border border-white/10">
          {undoToast}
        </div>
      )}

      {/* Edit-mode banner — shown when we arrived via /creer?postId=X&tab=... */}
      {editingPostId && (
        <div className="flex items-center justify-between gap-3 bg-purple-600/15 border-b border-purple-500/30 px-4 py-2">
          <div className="flex items-center gap-2 text-sm text-purple-100 min-w-0">
            <Edit3 size={14} className="flex-shrink-0" />
            <span className="truncate">
              Édition du post : <span className="font-semibold">{editingPostTitle || 'Sans titre'}</span>
            </span>
          </div>
          <button
            onClick={() => router.push('/dashboard/calendar')}
            className="text-xs font-medium rounded-lg px-3 py-1.5 bg-gray-800 text-gray-200 hover:bg-gray-700 transition flex-shrink-0"
          >
            Annuler
          </button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* Top horizontal toolbar — replaces the former vertical rail   */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="flex items-center lg:justify-center gap-1 bg-gray-950 border-b border-gray-800 px-2 lg:px-4 py-2 flex-shrink-0 overflow-x-auto scrollbar-hide whitespace-nowrap">
        <button
          onClick={() => { setActiveRailTab(null); setStep(0); }}
          className={`group flex items-center gap-2 rounded-lg px-3 py-2 transition-all ${
            !activeRailTab ? 'bg-gray-800 ring-1 ring-orange-500/40' : 'hover:bg-gray-900'
          }`}
          title="Thème"
        >
          <IconBadge Icon={Palette} color="orange" active={!activeRailTab} size={28} />
          <span className="hidden sm:inline text-xs font-medium text-gray-300">Thème</span>
        </button>
        <div className="mx-1 h-8 w-px bg-gray-800" />
        {railItems.map(({ id, label, Icon, color }) => (
          <button
            key={id}
            onClick={() => handleRailClick(id)}
            className={`group flex items-center gap-2 rounded-lg px-3 py-2 transition-all ${
              activeRailTab === id ? 'bg-gray-800 ring-1 ring-purple-500/40' : 'hover:bg-gray-900'
            }`}
            title={label}
          >
            <IconBadge Icon={Icon} color={color} active={activeRailTab === id} size={28} />
            <span className="hidden sm:inline text-xs font-medium text-gray-300">{label}</span>
          </button>
        ))}
        <div className="relative" data-zones-menu ref={zonesAnchorRef}>
          <button
            onClick={() => setZonesOpen((v) => !v)}
            className={`group flex items-center gap-2 rounded-lg px-3 py-2 transition-all ${
              zonesOpen ? 'bg-gray-800 ring-1 ring-cyan-500/40' : 'hover:bg-gray-900'
            }`}
            title="Zone — Safe zones réseaux sociaux"
          >
            <span
              className="inline-flex items-center justify-center rounded-lg"
              style={{
                width: 28,
                height: 28,
                backgroundColor: zonesOpen ? '#06B6D4' : '#06B6D420',
                color: zonesOpen ? '#FFFFFF' : '#06B6D4',
              }}
            >
              <Share2 size={16} strokeWidth={2} />
            </span>
            <span className="hidden sm:inline text-xs font-medium text-gray-300">Zone</span>
          </button>
          {zonesOpen && zonesMenuPos && typeof document !== 'undefined' &&
            createPortal(
              <div
                data-zones-menu
                className="fixed z-[100] flex items-center gap-1.5 rounded-xl bg-gray-900/95 backdrop-blur border border-gray-700/50 px-3 py-2 shadow-2xl"
                style={{ top: zonesMenuPos.top, right: zonesMenuPos.right }}
              >
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
              </div>,
              document.body,
            )}
        </div>
        {agentIAEnabled && (
          <>
            <div className="mx-1 h-8 w-px bg-gray-800" />
            <button
              onClick={() => setAgentIAOpen(true)}
              className={`group flex items-center gap-2 rounded-lg px-3 py-2 transition-all ${
                agentIAOpen ? 'bg-gray-800 ring-1 ring-amber-500/40' : 'hover:bg-gray-900'
              }`}
              title="Agent IA — Planificateur autonome"
            >
              <IconBadge Icon={Sparkles} color="amber" active={agentIAOpen} size={28} />
              <span className="hidden sm:inline text-xs font-medium text-gray-300">Agent IA</span>
            </button>
          </>
        )}
      </div>

      <div className="flex flex-col lg:flex-row flex-1 min-h-0 pb-14 lg:pb-0">

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* Rail slide-in panel — opens below the top toolbar           */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {activeRailTab && (
        <div
          className="flex flex-col w-full lg:w-[320px] flex-shrink-0 bg-gray-900 border-r border-gray-800 overflow-y-auto max-h-[calc(100vh-4rem)]"
          style={{ backdropFilter: 'blur(20px)' }}
        >
          <button
            onClick={() => setActiveRailTab(null)}
            className="lg:hidden flex items-center gap-1 text-xs text-gray-400 hover:text-white px-4 pt-3"
          >
            ← Retour
          </button>
          <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-white">
              {railItems.find((r) => r.id === activeRailTab)?.label}
            </h3>
            <button
              onClick={() => setActiveRailTab(null)}
              className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white"
              title="Fermer"
            >
              <X size={16} />
            </button>
          </div>
          <div className="p-4 space-y-4 text-sm">
            {activeRailTab === 'templates' && (
              <>
                <p className="text-xs text-gray-400">
                  Choisissez un thème de couleur, un style de carte, une police et un filtre.
                </p>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">
                    Couleur
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {COLOR_THEMES.map((ct) => (
                      <button
                        key={ct.id}
                        onClick={() => {
                          setColorTheme(ct.id);
                          setNoColorBg(false);
                          // Sync the global gradient + accent to the picked theme
                          // so the editor preview AND the exported video use
                          // exactly these colors, instead of a stale pair
                          // left over from a previous theme or localStorage.
                          setGradientColor1(ct.gradient.start);
                          setGradientColor2(ct.gradient.end);
                          setCustomAccent(ct.accent);
                        }}
                        className={`h-8 w-8 rounded-full bg-gradient-to-br ${ct.bg} transition-all ${
                          colorTheme === ct.id && !noColorBg
                            ? 'ring-2 ring-white scale-110'
                            : 'opacity-60 hover:opacity-100'
                        }`}
                        title={ct.name}
                      />
                    ))}
                    {/* Custom color picker button */}
                    <button
                      onClick={() => { setColorTheme('custom'); setNoColorBg(false); }}
                      className={`h-8 w-8 rounded-full transition-all flex items-center justify-center ${
                        colorTheme === 'custom' && !noColorBg
                          ? 'ring-2 ring-white scale-110'
                          : 'opacity-60 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: colorTheme === 'custom' ? customAccent : undefined, border: colorTheme !== 'custom' ? '2px dashed #6b7280' : undefined }}
                      title="Couleur personnalisée"
                    >
                      {colorTheme !== 'custom' && <span className="text-gray-500 text-xs font-bold">+</span>}
                    </button>
                  </div>
                  {/* Inline ColorWheel for custom color */}
                  {colorTheme === 'custom' && !noColorBg && (
                    <div className="mt-3">
                      <ColorWheel
                        color={customAccent}
                        onChange={(c) => {
                          // Custom color pick ALWAYS updates the gradient pair,
                          // mirroring how preset themes work. Previously gated
                          // behind `autoGradient`, which caused a stale
                          // gradientColor1 (e.g. stuck at black) while
                          // customAccent changed — editor showed new accent
                          // but composer exported with the stale gradient.
                          setCustomAccent(c);
                          setGradientColor1(c);
                          setGradientColor2(getComplementary(c));
                        }}
                        label="Couleur personnalisée"
                      />
                    </div>
                  )}
                  {/* Auto gradient toggle */}
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-[10px] text-gray-300">Dégradé automatique</span>
                    <button
                      onClick={() => {
                        const next = !autoGradient;
                        setAutoGradient(next);
                        if (next) {
                          const base = COLOR_THEMES.find(ct => ct.id === colorTheme)?.accent || customAccent;
                          setGradientColor1(base);
                          setGradientColor2(getComplementary(base));
                          setGradientOpacity(0.4);
                        }
                      }}
                      className={`relative w-9 h-5 rounded-full transition-colors ${autoGradient ? 'bg-purple-600' : 'bg-gray-800'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${autoGradient ? 'translate-x-4' : ''}`} />
                    </button>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">
                    Police
                  </div>
                  <select
                    value={selectedFont}
                    onChange={(e) => setSelectedFont(e.target.value)}
                    className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-white"
                  >
                    {FONT_OPTIONS.map((opt) => (
                      <option key={opt.label} value={opt.label}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">
                    Style de carte
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {CARD_STYLE_OPTIONS.map((opt) => (
                      <button
                        key={opt.label}
                        onClick={() => setSelectedCardStyle(opt.label)}
                        className={`rounded border px-2 py-1 text-[11px] transition ${
                          selectedCardStyle === opt.label
                            ? 'border-purple-500 bg-purple-600/20 text-white'
                            : 'border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-500'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-[11px] text-gray-500 italic">
                  Les réglages avancés (gradient, filtres) restent accessibles dans le panneau Design à gauche.
                </p>
              </>
            )}

            {activeRailTab === 'elements' && (
              <>
                <p className="text-xs text-gray-400">
                  Ajoutez un logo ou un personnage. Double-cliquez sur le logo dans l'aperçu pour plus d'options.
                </p>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">
                    Logo
                  </div>
                  {logoImage ? (
                    <div className="flex items-center gap-2">
                      <img src={logoImage} alt="Logo" className="h-10 w-10 rounded object-contain bg-gray-800" />
                      <button
                        onClick={() => setLogoImage(null)}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        Retirer
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <label className="flex-1 flex items-center justify-center gap-2 rounded border border-dashed border-gray-600 px-3 py-4 text-xs text-gray-400 cursor-pointer hover:border-purple-500 hover:text-white transition">
                        <Upload size={14} /> Téléverser
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = (ev) => setLogoImage(ev.target?.result as string);
                            reader.readAsDataURL(file);
                          }}
                        />
                      </label>
                      <button
                        onClick={() => { setMediaLibTarget('logo'); setMediaLibOpen(true); }}
                        className="flex items-center justify-center gap-1.5 rounded border border-gray-600 px-3 py-4 text-xs text-gray-400 hover:border-purple-500 hover:text-white transition"
                      >
                        <ImageIcon size={14} /> Médiathèque
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            {activeRailTab === 'text' && (
              <>
                {[
                  { label: 'Titre', value: title, set: setTitle, field: 'title', ph: 'Titre principal' },
                  { label: 'Sous-titre', value: subtitle, set: setSubtitle, field: 'subtitle', ph: 'Sous-titre' },
                  { label: 'CTA — Principal', value: ctaMainText, set: setCtaMainText, field: 'cta', ph: 'AFROBOOST' },
                  { label: 'CTA — Sous-texte', value: ctaSubText, set: setCtaSubText, field: 'ctaSub', ph: "CHAT POUR PLUS D'INFOS" },
                  { label: 'Overlay (vidéo)', value: videoOverlayText, set: setVideoOverlayText, field: 'overlay', ph: 'Texte superposé' },
                ].map((f) => (
                  <div key={f.field}>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                      {f.label}
                    </div>
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={f.value}
                        onChange={(e) => f.set(e.target.value)}
                        placeholder={f.ph}
                        className="flex-1 rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-white placeholder-gray-500"
                      />
                      <button
                        onClick={() => suggestField(f.field, f.set)}
                        disabled={aiFieldLoading === f.field}
                        className="rounded bg-purple-600/20 px-1.5 py-1.5 text-purple-400 hover:bg-purple-600/40 disabled:opacity-50 transition flex-shrink-0"
                        title="Générer avec IA"
                      >
                        {aiFieldLoading === f.field ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                      </button>
                    </div>
                  </div>
                ))}
                <p className="text-[11px] text-gray-500 italic">
                  Double-cliquez un texte dans l'aperçu pour la typographie.
                </p>
              </>
            )}

            {activeRailTab === 'cards' && (
              <CardsRailPanel
                cards={cards}
                setCards={setCards}
                accentColor={COLOR_THEMES.find((ct) => ct.id === colorTheme)?.accent || '#a855f7'}
              />
            )}

            {activeRailTab === 'media' && (
              <>
                <p className="text-xs text-gray-400">
                  Ajoutez un rush vidéo. L'éditeur complet (recherche Pexels, crop, détection de clips) est dans le panneau Style à gauche.
                </p>
                <div className="flex gap-2">
                  <label className="flex-1 flex items-center justify-center gap-2 rounded border border-dashed border-gray-600 px-3 py-4 text-xs text-gray-400 cursor-pointer hover:border-purple-500 hover:text-white transition">
                    {isUploadingVideo ? (
                      <>
                        <Loader2 size={14} className="animate-spin text-purple-400" />
                        <span className="text-purple-300">
                          Upload {videoUploadProgress > 0 ? `${videoUploadProgress}%` : 'en cours...'}
                        </span>
                      </>
                    ) : (
                      <>
                        <Video size={14} /> Téléverser vidéo ou image
                      </>
                    )}
                    <input
                      type="file"
                      accept="video/*,image/*"
                      multiple
                      disabled={isUploadingVideo}
                      className="hidden"
                      onChange={handleVideoUpload}
                    />
                  </label>
                  <button
                    onClick={() => { setMediaLibTarget('rush'); setMediaLibOpen(true); }}
                    className="flex items-center justify-center gap-1.5 rounded border border-gray-600 px-3 py-4 text-xs text-gray-400 hover:border-purple-500 hover:text-white transition"
                  >
                    <Film size={14} /> Médiathèque
                  </button>
                </div>
                {videoUploadProgress > 0 && videoUploadProgress < 100 && (
                  <div className="w-full h-2 bg-gray-800 rounded overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-200"
                      style={{ width: `${videoUploadProgress}%` }}
                    />
                  </div>
                )}
                {rushUrl && (
                  <div className="rounded border border-gray-700 bg-gray-800 p-2 text-xs text-gray-300">
                    {rushFileName || 'Rush chargé.'}
                  </div>
                )}
              </>
            )}

            {activeRailTab === 'audio' && (
              <>
                <AudioStudioPanel
                  musicUrl={audioMusicUrl}
                  musicName={audioMusicName}
                  voiceUrl={audioVoiceUrl}
                  voiceName={audioVoiceName}
                  musicVolume={audioMusicVolume}
                  voiceVolume={audioVoiceVolume}
                  onMusicChange={(url, name) => { setAudioMusicUrl(url); setAudioMusicName(name); }}
                  onVoiceChange={(url, name) => { setAudioVoiceUrl(url); setAudioVoiceName(name); }}
                  onMusicVolumeChange={setAudioMusicVolume}
                  onVoiceVolumeChange={setAudioVoiceVolume}
                  introDuration={introDuration}
                  cardsDuration={cardsDuration}
                  videoDuration={videoDuration}
                  ctaDuration={ctaDuration}
                  onIntroDurationChange={setIntroDuration}
                  onCardsDurationChange={setCardsDuration}
                  onVideoDurationChange={setVideoDuration}
                  onCtaDurationChange={setCtaDuration}
                  hasRush={rushList.length > 0}
                  contentTheme={contentTheme}
                />

                {/* Per-sequence voice-overs (PR B) — sits next to the
                    legacy AudioStudioPanel above. Both run in parallel:
                    the legacy `audioVoiceUrl` keeps playing in background
                    on existing posts, while new posts get fine-grained
                    per-sequence voices. PR C wires the composer to play
                    each sequenceVoices clip on its own offset. */}
                <SequenceVoicesPanel
                  sequenceVoices={sequenceVoices}
                  userEdited={sequenceVoicesUserEdited}
                  onChange={(key, patch) => {
                    setSequenceVoices((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
                  }}
                  onUserEditedChange={(key, edited) => {
                    setSequenceVoicesUserEdited((prev) => ({ ...prev, [key]: edited }));
                  }}
                  onResetText={(key) => {
                    // Drop the userEdited flag → the existing auto-fill
                    // useEffect re-runs and rewrites the text from the
                    // current editor content (title/cards/etc.).
                    setSequenceVoicesUserEdited((prev) => ({ ...prev, [key]: false }));
                  }}
                  introDuration={introDuration}
                  cardsDuration={cardsDuration}
                  videoDuration={videoDuration}
                  ctaDuration={ctaDuration}
                  hasCardsContent={cards.length > 0}
                  hasVideoOverlay={!!videoOverlayText.trim() || rushList.length > 0}
                  batchCount={batchCount}
                  onAudioError={(msg) => showToast(msg, 'error')}
                />

                {/* Live mix preview — lets the user hear the whole montage
                    (rush audio + music + voice + ducking keyframes) before
                    committing to an export. */}
                <AudioMixPreview
                  audioKeyframes={audioKeyframes}
                  musicUrl={audioMusicUrl}
                  voiceUrl={audioVoiceUrl}
                  rushUrl={rushUrl}
                  totalDuration={
                    (exportedSequences.titre ? introDuration : 0)
                    + (cards.length > 0 && exportedSequences.cartes ? cardsDuration : 0)
                    + (rushUrl && exportedSequences.video ? videoDuration : 0)
                    + (exportedSequences.cta ? ctaDuration : 0)
                  }
                  videoSeqStart={
                    (exportedSequences.titre ? introDuration : 0)
                    + (cards.length > 0 && exportedSequences.cartes ? cardsDuration : 0)
                  }
                  videoSeqDuration={rushUrl && exportedSequences.video ? videoDuration : 0}
                  onTimeUpdate={setMixPlayheadTime}
                  onPlayStateChange={(p) => { if (!p) setMixPlayheadTime(null); }}
                />

                {/* Audio ducking keyframes — user mixes music vs rush
                    audio along the video sequence timeline. */}
                <AudioDuckingTimeline
                  keyframes={audioKeyframes}
                  onChange={setAudioKeyframes}
                  totalDuration={
                    (exportedSequences.titre ? introDuration : 0)
                    + (cards.length > 0 && exportedSequences.cartes ? cardsDuration : 0)
                    + (rushUrl && exportedSequences.video ? videoDuration : 0)
                    + (exportedSequences.cta ? ctaDuration : 0)
                  }
                  rushUrl={rushUrl}
                  autoDuckRunning={autoDuckRunning}
                  playheadTime={mixPlayheadTime}
                  onAutoDuck={async () => {
                    if (!rushUrl) return;
                    setAutoDuckRunning(true);
                    try {
                      const ducked = await analyseRushForDucking(rushUrl);
                      if (ducked.length > 0) setAudioKeyframes(ducked);
                      else showToast("Auto-duck: aucun son détecté dans le rush");
                    } catch (err) {
                      console.error('[AutoDuck] failed:', err);
                      showToast(`Auto-duck échoué: ${err instanceof Error ? err.message : 'erreur'}`);
                    } finally {
                      setAutoDuckRunning(false);
                    }
                  }}
                />
              </>
            )}

            {activeRailTab === 'settings' && (
              <>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                    Format
                  </div>
                  <div className="flex gap-1">
                    {(['9:16', '16:9'] as Format[]).map((fmt) => (
                      <button
                        key={fmt}
                        onClick={() => setFormat(fmt)}
                        className={`flex-1 rounded px-3 py-1.5 text-xs font-bold transition ${
                          format === fmt
                            ? 'bg-purple-600 text-white'
                            : 'bg-gray-800 text-gray-400 hover:text-white'
                        }`}
                      >
                        {fmt}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                    Mode position cartes
                  </div>
                  <button
                    onClick={() =>
                      setCardPositionMode((m) => (m === 'grid' ? 'free' : 'grid'))
                    }
                    className="w-full rounded bg-gray-800 hover:bg-gray-700 px-3 py-2 text-xs text-white flex items-center justify-center gap-2"
                  >
                    {cardPositionMode === 'grid' ? <Grid3x3 size={12} /> : <Move size={12} />}
                    {cardPositionMode === 'grid' ? 'Grille' : 'Libre'}
                  </button>
                </div>

                {cardPositionMode === 'free' && cards.length >= 2 && (
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                      Distribuer cartes
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      <button
                        onClick={() => distributeCards('vertical')}
                        className="rounded bg-gray-800 hover:bg-purple-700 px-2 py-1.5 text-[11px] text-white flex items-center justify-center gap-1 transition"
                        title="Répartir les cartes avec un écart vertical égal entre min et max Y existants"
                      >
                        <Rows3 size={12} /> Vertical
                      </button>
                      <button
                        onClick={() => distributeCards('horizontal')}
                        className="rounded bg-gray-800 hover:bg-purple-700 px-2 py-1.5 text-[11px] text-white flex items-center justify-center gap-1 transition"
                        title="Répartir les cartes avec un écart horizontal égal entre min et max X existants"
                      >
                        <Columns3 size={12} /> Horizontal
                      </button>
                    </div>
                  </div>
                )}
                <div>
                  <label className="flex items-center gap-2 text-xs text-gray-300">
                    <input
                      type="checkbox"
                      checked={showCenterGuides}
                      onChange={(e) => setShowCenterGuides(e.target.checked)}
                      className="accent-purple-500"
                    />
                    Afficher les repères de centre
                  </label>
                </div>
                <div>
                  <label className="flex items-center gap-2 text-xs text-gray-300">
                    <input
                      type="checkbox"
                      checked={smartGuidesEnabled}
                      onChange={(e) => setSmartGuidesEnabled(e.target.checked)}
                      className="accent-purple-500"
                    />
                    Guides d'alignement intelligents (snap + distances)
                  </label>
                </div>
                <div>
                  <label className="flex items-center gap-2 text-xs text-gray-300">
                    <input
                      type="checkbox"
                      checked={syncColorsGlobal}
                      onChange={(e) => setSyncColorsGlobal(e.target.checked)}
                      className="accent-purple-500"
                    />
                    Synchroniser les couleurs entre séquences
                  </label>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">
                    Filtre visuel
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {FILTER_OPTIONS.map((opt) => (
                      <button
                        key={opt.label}
                        onClick={() => setSelectedFilter(opt.label)}
                        className={`px-2 py-1 rounded text-[9px] font-medium transition-all ${
                          selectedFilter === opt.label
                            ? 'bg-purple-600 text-white'
                            : 'bg-gray-800 text-gray-400 hover:text-white'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => {
                    setTitlePos({ x: 50, y: 10 });
                    setLogoPositions({ titre: { x: 50, y: 85 }, cartes: { x: 50, y: 85 }, video: { x: 50, y: 85 }, cta: { x: 50, y: 85 } });
                    setWatermarkPos({ x: 50, y: 97 });
                    setCardsPos({ x: 50, y: 50 });
                    setTitleSize(100);
                    setCardsSize(95);
                    setWatermarkSize(80);
                    setCharacterPosition({ x: 85, y: 75 });
                    setCharacterScale(1);
                  }}
                  className="w-full rounded bg-gray-800 hover:bg-gray-700 px-3 py-2 text-xs text-gray-300"
                >
                  ↺ Réinitialiser les positions
                </button>

                {/* Full wipe: clear localStorage-persisted prefs + hard reload */}
                <button
                  onClick={() => {
                    if (!confirm("Réinitialiser tous les paramètres ? Cette action supprime vos préférences locales (couleurs, polices, position, cartes sauvegardées).")) return;
                    const keys = [
                      'studiio-creer-design-prefs',
                      'studiio_infographic_config', // legacy (pre-split)
                      'studiio_branding',
                      'studiio_publishing_settings',
                      'studiio_chat_history',
                      'studiio_chat_opened',
                    ];
                    keys.forEach((k) => localStorage.removeItem(k));
                    window.location.reload();
                  }}
                  className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-red-900/30 hover:bg-red-900/50 border border-red-700/50 px-3 py-2 text-xs font-medium text-red-300 transition"
                >
                  <RotateCcw size={12} />
                  Réinitialiser les préférences
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Left Panel - Form */}
      <div className={`w-full lg:w-1/2 overflow-y-auto border-r-0 lg:border-r border-gray-800 p-3 sm:p-6 pb-24 lg:pb-6 lg:max-h-[calc(100vh-4rem)] ${activeRailTab ? 'hidden' : ''}`}>
        {/* Header — minimal, controls live in the Canva sidebar */}
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg sm:text-2xl font-bold">Créer</h1>
          <BrandingIndicator branding={branding} />
        </div>

        {/* ═══════════════════════════════════════════════════════ */}
        {/* STEP 0: Content Theme & Generation */}
        {/* ═══════════════════════════════════════════════════════ */}
        {step === 0 && (
          <div className="space-y-4">
            {/* Content Theme Selector — compact dropdown with search */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-300">
                Thème du contenu
              </label>
              <div ref={themePickerRef} className="relative">
                {(() => {
                  const active = CONTENT_THEMES.find((t) => t.id === contentTheme);
                  return (
                    <div className="flex items-stretch gap-1.5">
                      <button
                        onClick={() => { setThemePickerOpen((v) => !v); setThemeSearch(''); }}
                        className="flex-1 flex items-center justify-between gap-2 rounded-lg bg-gray-800 hover:bg-gray-750 ring-1 ring-purple-500/40 px-3 py-2.5 text-sm font-medium text-white transition"
                      >
                        <span className="flex items-center gap-2 truncate">
                          <span>{active?.emoji || '✨'}</span>
                          <span className="truncate">{active?.label || 'Choisir un thème'}</span>
                        </span>
                        <ChevronDown size={14} className={`text-gray-400 flex-shrink-0 transition-transform ${themePickerOpen ? 'rotate-180' : ''}`} />
                      </button>
                      <button
                        onClick={() => { setThemePickerOpen(true); setThemeSearch(''); }}
                        className="rounded-lg bg-gray-800 hover:bg-gray-750 px-3 py-2.5 text-xs text-gray-400 hover:text-white flex items-center gap-1.5 transition"
                        title="Rechercher un thème"
                      >
                        <Search size={14} />
                        <span className="hidden sm:inline">Changer</span>
                      </button>
                    </div>
                  );
                })()}

                {themePickerOpen && (
                  <div
                    className="absolute left-0 right-0 top-full mt-2 z-30 rounded-xl bg-gray-900 border border-gray-700 p-3 shadow-2xl max-h-[400px] overflow-y-auto"
                    style={{ animation: 'fadeInScale 150ms ease-out' }}
                  >
                    <div className="relative mb-2">
                      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                      <input
                        autoFocus
                        type="text"
                        value={themeSearch}
                        onChange={(e) => setThemeSearch(e.target.value)}
                        placeholder="Rechercher un thème..."
                        className="w-full rounded-lg bg-gray-800 border border-gray-700 pl-7 pr-2 py-1.5 text-xs text-white placeholder:text-gray-500 focus:border-purple-500 focus:outline-none"
                      />
                    </div>
                    {(() => {
                      const q = themeSearch.trim().toLowerCase();
                      const filtered = CONTENT_THEMES.filter((t) => {
                        if (!q) return true;
                        if (t.label.toLowerCase().includes(q)) return true;
                        if (t.id.toLowerCase().includes(q)) return true;
                        const kws = THEME_KEYWORDS[t.id] || [];
                        return kws.some((k) => k.toLowerCase().includes(q));
                      });
                      if (filtered.length === 0) {
                        return <p className="text-[11px] text-gray-500 text-center py-4">Aucun thème trouvé</p>;
                      }
                      return (
                        <div className="grid grid-cols-3 gap-1.5">
                          {filtered.map((theme) => {
                            const isActive = contentTheme === theme.id;
                            return (
                              <button
                                key={theme.id}
                                onClick={() => {
                                  setContentTheme(theme.id);
                                  setThemePickerOpen(false);
                                  setThemeSearch('');
                                  showToast(`Thème "${theme.label}" appliqué`, 'success');
                                }}
                                className={`flex items-center justify-center gap-1 rounded-lg px-2 py-2 text-[11px] font-medium transition-all ${
                                  isActive
                                    ? 'ring-2 ring-purple-500 bg-purple-600/20 text-white'
                                    : 'bg-gray-800/50 hover:bg-gray-800 text-gray-300'
                                }`}
                              >
                                <span>{theme.emoji}</span>
                                <span className="leading-tight truncate">{theme.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                )}
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
                {/* Source toggle — Pexels | Unsplash */}
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-gray-500">Source</span>
                  <div className="inline-flex rounded-full border border-white/10 bg-white/5 p-0.5 backdrop-blur">
                    {(["pexels", "unsplash"] as const).map((src) => (
                      <button
                        key={src}
                        onClick={() => {
                          if (imageSource === src) return;
                          setImageSource(src);
                          const query =
                            photoSearchQuery.trim() ||
                            (contentTheme === "personnalise" ? customTopic : "") ||
                            CONTENT_THEMES.find((t) => t.id === contentTheme)?.pexelsQuery ||
                            "fitness";
                          pexelsPageRef.current = 0;
                          fetchPexelsPhotos(query, true, src);
                        }}
                        className={`rounded-full px-3 py-1 text-[11px] font-medium capitalize transition ${
                          imageSource === src
                            ? "bg-gradient-to-r from-purple-600 to-pink-500 text-white shadow"
                            : "text-gray-400 hover:text-white"
                        }`}
                      >
                        {src}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {pexelsPhotos.map((photo, i) => {
                    const batchPos = batchCount > 1 ? batchPhotoIndices.indexOf(i) : -1;
                    const isBatchSelected = batchPos >= 0;
                    const isSingleSelected = batchCount === 1 && selectedPhotoIndex === i;
                    return (
                      <button
                        key={photo.id}
                        onClick={() => {
                          if (batchCount > 1) {
                            setBatchPhotoIndices((prev) => {
                              const idx = prev.indexOf(i);
                              if (idx >= 0) return prev.filter((x) => x !== i);
                              if (prev.length >= batchCount) return prev;
                              return [...prev, i];
                            });
                          } else {
                            setSelectedPhotoIndex(selectedPhotoIndex === i ? -1 : i);
                          }
                        }}
                        className={`relative overflow-hidden rounded-lg transition-all ${
                          isSingleSelected || isBatchSelected
                            ? "ring-2 ring-purple-500"
                            : "opacity-70 hover:opacity-100"
                        }`}
                      >
                        <img
                          src={photo.small}
                          alt={photo.alt}
                          className="aspect-[3/4] w-full object-cover"
                        />
                        {isSingleSelected && (
                          <div className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-purple-500">
                            <Check size={10} />
                          </div>
                        )}
                        {isBatchSelected && (
                          <div className="absolute bottom-0 left-0 rounded-tr bg-purple-600 px-1 py-0.5 text-[8px] font-bold text-white">
                            #{batchPos + 1}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
                {batchCount > 1 && pexelsPhotos.length > 0 && (
                  <p className="mt-1 text-[10px] text-gray-500">
                    {batchPhotoIndices.length > 0
                      ? `Sélectionnées : ${batchPhotoIndices.length} / ${batchCount}`
                      : "Cliquez les photos dans l'ordre souhaité — si rien n'est sélectionné, choix automatique"}
                  </p>
                )}

                {/* Upload custom photo button */}
                <label className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-600 px-3 py-2 text-xs text-gray-400 cursor-pointer hover:border-purple-500 hover:text-white transition mt-2">
                  <Upload size={12} /> Ma photo
                  <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      const dataUrl = ev.target?.result as string;
                      const customPhoto = { id: `custom-${Date.now()}`, url: dataUrl, medium: dataUrl, small: dataUrl, photographer: 'Vous', alt: file.name };
                      setPexelsPhotos(prev => [customPhoto, ...prev]);
                      setSelectedPhotoIndex(0);
                    };
                    reader.readAsDataURL(file);
                  }} />
                </label>
                <button
                  onClick={() => setSelectedPhotoIndex(-1)}
                  className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition mt-1 ${
                    selectedPhotoIndex < 0
                      ? 'border-2 border-purple-500 bg-purple-600/20 text-purple-300'
                      : 'border border-gray-600 text-gray-400 hover:border-red-500 hover:text-red-400'
                  }`}
                  title="N'utiliser que le fond coloré (pas de photo d'affiche)"
                >
                  <X size={12} />
                  {selectedPhotoIndex < 0 ? 'Sans photo (actif) — Fond seul' : 'Sans photo — Utiliser seulement le fond'}
                </button>

              </div>
            )}

            {/* Generated Content Preview */}
            {!isGenerating && cards.length > 0 && (
              <>
                {/* Title & Subtitle */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-400">
                      Titre &amp; Sous-titre
                    </span>
                    <button
                      onClick={suggestTitleAndSubtitle}
                      disabled={aiFieldLoading === 'title' || aiFieldLoading === 'subtitle'}
                      className="flex items-center gap-1 rounded bg-purple-600/20 hover:bg-purple-600/40 disabled:opacity-50 px-2 py-1 text-[11px] text-purple-300 transition"
                      title="Générer titre + sous-titre par IA selon le thème actuel"
                    >
                      {aiFieldLoading === 'title' || aiFieldLoading === 'subtitle'
                        ? <Loader2 size={11} className="animate-spin" />
                        : <Sparkles size={11} />}
                      Générer par IA
                    </button>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-400">
                      Titre
                    </label>
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                      />
                      <button
                        onClick={() => suggestField('title', setTitle)}
                        disabled={aiFieldLoading === 'title'}
                        className="rounded-lg bg-purple-600/20 px-2 text-purple-300 hover:bg-purple-600/40 disabled:opacity-50 transition flex-shrink-0"
                        title="Regénérer le titre par IA"
                      >
                        {aiFieldLoading === 'title' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-400">
                      Sous-titre
                    </label>
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={subtitle}
                        onChange={(e) => setSubtitle(e.target.value)}
                        className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                      />
                      <button
                        onClick={() => suggestField('subtitle', setSubtitle)}
                        disabled={aiFieldLoading === 'subtitle'}
                        className="rounded-lg bg-purple-600/20 px-2 text-purple-300 hover:bg-purple-600/40 disabled:opacity-50 transition flex-shrink-0"
                        title="Regénérer le sous-titre par IA"
                      >
                        {aiFieldLoading === 'subtitle' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                      </button>
                    </div>
                  </div>
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setShowExtraTitleBlock((v) => !v)}
                      className="flex w-full items-center justify-between rounded-lg border border-dashed border-gray-700 bg-gray-800/50 px-3 py-2 text-xs text-gray-400 hover:border-purple-500/50 hover:text-purple-300 transition"
                    >
                      <span>+ Ajouter un titre/sous-titre supplémentaire</span>
                      <span className="text-[10px]">{showExtraTitleBlock ? '▲' : '▼'}</span>
                    </button>
                    {showExtraTitleBlock && (
                      <div className="mt-2 space-y-3 rounded-lg border border-gray-800 bg-gray-900/40 p-3">
                        {/* ── Titre supplémentaire ── */}
                        <div className="space-y-2 rounded-md border border-gray-800/60 bg-gray-900/40 p-2">
                          <label className="block text-[11px] font-semibold uppercase tracking-wider text-purple-300">
                            Titre supplémentaire
                          </label>
                          <textarea
                            value={extraTitle}
                            onChange={(e) => setExtraTitle(e.target.value)}
                            placeholder="Optionnel — Entrée pour saut de ligne"
                            rows={2}
                            style={{ resize: 'vertical' }}
                            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                          />
                          <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-300">
                            <label className="flex flex-col gap-1">
                              <span className="text-gray-400">Taille ({extraTitleScale.toFixed(2)}x)</span>
                              <input
                                type="range" min={0.5} max={3} step={0.05}
                                value={extraTitleScale}
                                onChange={(e) => setExtraTitleScale(parseFloat(e.target.value))}
                                className="accent-purple-500"
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-gray-400">Espacement ({extraTitleLetterSpacing}px)</span>
                              <input
                                type="range" min={-2} max={20} step={0.5}
                                value={extraTitleLetterSpacing}
                                onChange={(e) => setExtraTitleLetterSpacing(parseFloat(e.target.value))}
                                className="accent-purple-500"
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-gray-400">Hauteur de ligne ({extraTitleLineHeight.toFixed(2)})</span>
                              <input
                                type="range" min={0.8} max={2} step={0.05}
                                value={extraTitleLineHeight}
                                onChange={(e) => setExtraTitleLineHeight(parseFloat(e.target.value))}
                                className="accent-purple-500"
                              />
                            </label>
                            <div className="flex items-end gap-3">
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input type="checkbox" checked={extraTitleBold} onChange={(e) => setExtraTitleBold(e.target.checked)} className="accent-purple-500" />
                                <span className="font-bold">Gras</span>
                              </label>
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input type="checkbox" checked={extraTitleItalic} onChange={(e) => setExtraTitleItalic(e.target.checked)} className="accent-purple-500" />
                                <span className="italic">Italique</span>
                              </label>
                            </div>
                          </div>
                          <label className="flex items-center gap-2 text-[10px] text-gray-300 cursor-pointer">
                            <input type="checkbox" checked={extraTitleGradient} onChange={(e) => setExtraTitleGradient(e.target.checked)} className="accent-pink-500" />
                            <span>Dégradé sur le texte</span>
                          </label>
                          {extraTitleGradient && (
                            <div className="flex items-center gap-2">
                              <label className="flex items-center gap-1 text-[10px] text-gray-400">
                                <span>Couleur 1</span>
                                <input type="color" value={extraTitleGradColor1} onChange={(e) => setExtraTitleGradColor1(e.target.value)} className="h-6 w-8 cursor-pointer rounded border border-gray-700 bg-transparent" />
                              </label>
                              <label className="flex items-center gap-1 text-[10px] text-gray-400">
                                <span>Couleur 2</span>
                                <input type="color" value={extraTitleGradColor2} onChange={(e) => setExtraTitleGradColor2(e.target.value)} className="h-6 w-8 cursor-pointer rounded border border-gray-700 bg-transparent" />
                              </label>
                            </div>
                          )}
                        </div>

                        {/* ── Sous-titre supplémentaire ── */}
                        <div className="space-y-2 rounded-md border border-gray-800/60 bg-gray-900/40 p-2">
                          <label className="block text-[11px] font-semibold uppercase tracking-wider text-pink-300">
                            Sous-titre supplémentaire
                          </label>
                          <textarea
                            value={extraSubtitle}
                            onChange={(e) => setExtraSubtitle(e.target.value)}
                            placeholder="Optionnel — Entrée pour saut de ligne"
                            rows={2}
                            style={{ resize: 'vertical' }}
                            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                          />
                          <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-300">
                            <label className="flex flex-col gap-1">
                              <span className="text-gray-400">Taille ({extraSubtitleScale.toFixed(2)}x)</span>
                              <input
                                type="range" min={0.5} max={3} step={0.05}
                                value={extraSubtitleScale}
                                onChange={(e) => setExtraSubtitleScale(parseFloat(e.target.value))}
                                className="accent-pink-500"
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-gray-400">Espacement ({extraSubtitleLetterSpacing}px)</span>
                              <input
                                type="range" min={-2} max={20} step={0.5}
                                value={extraSubtitleLetterSpacing}
                                onChange={(e) => setExtraSubtitleLetterSpacing(parseFloat(e.target.value))}
                                className="accent-pink-500"
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-gray-400">Hauteur de ligne ({extraSubtitleLineHeight.toFixed(2)})</span>
                              <input
                                type="range" min={0.8} max={2} step={0.05}
                                value={extraSubtitleLineHeight}
                                onChange={(e) => setExtraSubtitleLineHeight(parseFloat(e.target.value))}
                                className="accent-pink-500"
                              />
                            </label>
                            <div className="flex items-end gap-3">
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input type="checkbox" checked={extraSubtitleBold} onChange={(e) => setExtraSubtitleBold(e.target.checked)} className="accent-pink-500" />
                                <span className="font-bold">Gras</span>
                              </label>
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input type="checkbox" checked={extraSubtitleItalic} onChange={(e) => setExtraSubtitleItalic(e.target.checked)} className="accent-pink-500" />
                                <span className="italic">Italique</span>
                              </label>
                            </div>
                          </div>
                          <label className="flex items-center gap-2 text-[10px] text-gray-300 cursor-pointer">
                            <input type="checkbox" checked={extraSubtitleGradient} onChange={(e) => setExtraSubtitleGradient(e.target.checked)} className="accent-pink-500" />
                            <span>Dégradé sur le texte</span>
                          </label>
                          {extraSubtitleGradient && (
                            <div className="flex items-center gap-2">
                              <label className="flex items-center gap-1 text-[10px] text-gray-400">
                                <span>Couleur 1</span>
                                <input type="color" value={extraSubtitleGradColor1} onChange={(e) => setExtraSubtitleGradColor1(e.target.value)} className="h-6 w-8 cursor-pointer rounded border border-gray-700 bg-transparent" />
                              </label>
                              <label className="flex items-center gap-1 text-[10px] text-gray-400">
                                <span>Couleur 2</span>
                                <input type="color" value={extraSubtitleGradColor2} onChange={(e) => setExtraSubtitleGradColor2(e.target.value)} className="h-6 w-8 cursor-pointer rounded border border-gray-700 bg-transparent" />
                              </label>
                            </div>
                          )}
                        </div>

                        <p className="text-[10px] text-gray-500">
                          Affichés dans la séquence titre. Drag pour repositionner. Vide = ignoré.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Info Cards */}
                <div>
                  <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
                    <h3 className="text-sm font-semibold text-gray-300">
                      Cartes d'Information ({cards.length})
                    </h3>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        onClick={() =>
                          setCards((prev) =>
                            prev.map((c) => ({ ...c, position: undefined })),
                          )
                        }
                        title="Réinitialiser les positions individuelles des cartes"
                        className="flex items-center gap-1 rounded-lg bg-gray-800 px-2 py-1.5 text-[10px] font-medium text-pink-400 hover:bg-gray-700"
                      >
                        <Grid3x3 size={12} />
                        <span className="truncate">Positions</span>
                      </button>
                      <button
                        onClick={handleRegenerate}
                        disabled={isGenerating}
                        className="flex items-center gap-1 rounded-lg bg-gray-800 px-2 py-1.5 text-[10px] font-medium text-purple-400 hover:bg-gray-700"
                      >
                        <RefreshCw
                          size={12}
                          className={isGenerating ? "animate-spin" : ""}
                        />
                        <span className="truncate">Régénérer</span>
                      </button>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {cards.map((card) => (
                      <div
                        key={card.id}
                        className="rounded-lg border border-gray-700 bg-gray-800 p-3"
                      >
                        <div className="flex items-start gap-3">
                          {/* Emoji */}
                          <div className="relative flex flex-col items-stretch gap-1">
                            <button
                              onClick={() =>
                                setShowEmojiPicker(
                                  showEmojiPicker === card.id ? null : card.id,
                                )
                              }
                              className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-700 text-xl hover:bg-gray-600"
                              title={card.emoji ? "Changer l'icône" : "Aucune icône"}
                            >
                              {card.emoji ? renderCardIcon(card, 22) : "∅"}
                            </button>
                            {showEmojiPicker === card.id && (
                              <div className="absolute top-full left-0 z-10 mt-1 grid grid-cols-4 sm:grid-cols-5 gap-1 rounded-lg border border-gray-600 bg-gray-800 p-2 shadow-xl">
                                <button
                                  onClick={() => {
                                    updateCard(card.id, "emoji", "");
                                    setShowEmojiPicker(null);
                                  }}
                                  className="col-span-4 sm:col-span-5 rounded p-1 text-xs text-gray-400 hover:bg-gray-700"
                                  title="Aucune icône"
                                >
                                  ∅ Aucune
                                </button>
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
                            {/* AI icon generator */}
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                value={iconPrompts[card.id] || ""}
                                onChange={(e) =>
                                  setIconPrompts((prev) => ({
                                    ...prev,
                                    [card.id]: e.target.value,
                                  }))
                                }
                                placeholder="Décris l'icône"
                                className="w-24 rounded border border-gray-600 bg-gray-700 px-1.5 py-0.5 text-[10px] text-white placeholder:text-gray-500 focus:border-purple-500 focus:outline-none"
                              />
                              <button
                                onClick={() => generateIconForCard(card.id)}
                                disabled={
                                  iconLoadingId === card.id ||
                                  !(iconPrompts[card.id] || "").trim()
                                }
                                className="flex items-center justify-center rounded bg-purple-600 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-purple-500 disabled:opacity-40"
                                title="Générer une icône avec l'IA"
                              >
                                {iconLoadingId === card.id ? (
                                  <Loader2 size={10} className="animate-spin" />
                                ) : (
                                  <Sparkles size={10} />
                                )}
                              </button>
                            </div>
                          </div>
                          {/* Content */}
                          <div className="flex-1 space-y-1.5 min-w-0">
                            <div className="flex gap-1">
                              <textarea value={card.label} onChange={(e) => updateCard(card.id, "label", e.target.value)} rows={1}
                                style={{ resize: 'vertical' }}
                                className="flex-1 min-w-0 rounded border border-gray-600 bg-gray-700 px-2 py-1 text-xs font-bold text-white focus:border-purple-500 focus:outline-none" placeholder="Label (Entrée = saut de ligne)" />
                              <textarea value={card.value} onChange={(e) => updateCard(card.id, "value", e.target.value)} rows={1}
                                style={{ resize: 'vertical' }}
                                className="w-14 rounded border border-gray-600 bg-gray-700 px-2 py-1 text-xs font-bold text-purple-400 focus:border-purple-500 focus:outline-none" placeholder="Val" />
                            </div>
                            <textarea value={card.description} onChange={(e) => updateCard(card.id, "description", e.target.value)} rows={2} maxLength={200}
                              className="w-full rounded border border-gray-600 bg-gray-700 px-2 py-1 text-xs text-gray-300 focus:border-purple-500 focus:outline-none resize-none" placeholder="Description (Entrée pour saut de ligne)" />
                          </div>
                          <div className="flex flex-col gap-1 flex-shrink-0">
                            <button onClick={() => suggestCardField(card.id, 'label')} disabled={aiFieldLoading === `${card.id}-label`}
                              className="h-7 w-7 rounded-lg bg-purple-600/20 flex items-center justify-center text-purple-400 hover:bg-purple-600/40 disabled:opacity-50 transition" title="Régénérer IA">
                              {aiFieldLoading === `${card.id}-label` ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                            </button>
                            <button onClick={() => deleteCard(card.id)} className="h-7 w-7 rounded-lg flex items-center justify-center text-gray-500 hover:bg-red-600/20 hover:text-red-400 transition" title="Supprimer">
                              <Trash2 size={12} />
                            </button>
                          </div>
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
                        <Plus size={16} /> Ajouter une carte{" "}
                        <span className="text-purple-400">
                          <Sparkles size={12} className="inline" /> IA
                        </span>
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
                          <button
                            type="button"
                            onClick={() => rewriteSalesPhrase(i)}
                            disabled={rewritingPhraseIdx === i || !phrase?.trim()}
                            title="Ameliorer cette phrase avec l'IA"
                            className="flex h-6 w-6 items-center justify-center rounded text-purple-300 hover:bg-purple-500/20 hover:text-purple-200 disabled:opacity-40 disabled:cursor-not-allowed transition"
                          >
                            {rewritingPhraseIdx === i
                              ? <Loader2 size={12} className="animate-spin" />
                              : <Sparkles size={12} />}
                          </button>
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
          <div className="flex items-center justify-center py-12 text-center">
            <p className="text-sm text-gray-500">
              Utilisez la sidebar à gauche pour modifier les couleurs, polices et
              éléments. Double-cliquez sur un élément dans l'aperçu pour l'éditer.
            </p>
          </div>
        )}

        {/* STEP 2: Médias & Export Settings (was step 1) */}
        {/* ═══════════════════════════════════════════════════════ */}
        {step === 2 && (
          <div className="space-y-4">
            {/* Batch Count — arrow counter + presets */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-300">
                Nombre d'infographies
              </label>
              <div className="flex items-center gap-3 flex-wrap">
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
                  onClick={() => setBatchCount(Math.min(20, batchCount + 1))}
                  disabled={batchCount >= 20}
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-800 border border-gray-700 text-lg font-bold text-white hover:bg-gray-700 disabled:opacity-30 transition-all"
                >
                  +
                </button>
                <span className="text-[10px] text-gray-500 ml-1">1 à 20</span>
                <div className="flex items-center gap-1 ml-1">
                  {[1, 3, 5, 10, 20].map((n) => (
                    <button
                      key={n}
                      onClick={() => setBatchCount(n)}
                      className={`h-7 min-w-[36px] px-2 rounded-md text-[11px] font-semibold transition ${
                        batchCount === n
                          ? 'bg-purple-600 text-white ring-1 ring-purple-400'
                          : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      x{n}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-[10px] text-gray-400">
                  {batchCount * 25} crédits
                </span>
                {batchCount > 10 && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">
                    <AlertTriangle size={10} /> durée ≈ {batchCount * 15}s
                  </span>
                )}
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
              {/* Source toggle — Pexels | Unsplash */}
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wider text-gray-500">Source</span>
                <div className="inline-flex rounded-full border border-white/10 bg-white/5 p-0.5 backdrop-blur">
                  {(["pexels", "unsplash"] as const).map((src) => (
                    <button
                      key={src}
                      onClick={() => {
                        if (imageSource === src) return;
                        setImageSource(src);
                        const query =
                          photoSearchQuery.trim() ||
                          (contentTheme === "personnalise" ? customTopic : "") ||
                          CONTENT_THEMES.find((t) => t.id === contentTheme)?.pexelsQuery ||
                          CONTENT_THEMES.find((t) => t.id === contentTheme)?.label ||
                          "fitness";
                        pexelsPageRef.current = 0;
                        fetchPexelsPhotos(query, true, src);
                      }}
                      className={`rounded-full px-3 py-1 text-[11px] font-medium capitalize transition ${
                        imageSource === src
                          ? "bg-gradient-to-r from-purple-600 to-pink-500 text-white shadow"
                          : "text-gray-400 hover:text-white"
                      }`}
                    >
                      {src}
                    </button>
                  ))}
                </div>
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
              {characterImage ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <img src={characterImage} alt="Personnage" className="h-14 w-14 rounded-lg object-cover bg-gray-800 border border-gray-700" />
                    <div className="flex-1 space-y-1">
                      <label className="flex items-center gap-2 text-[10px] text-gray-400">
                        Taille {Math.round(characterScale * 100)}%
                        <input
                          type="range"
                          min={0.3}
                          max={2.5}
                          step={0.05}
                          value={characterScale}
                          onChange={(e) => setCharacterScale(Number(e.target.value))}
                          className="flex-1 accent-purple-500"
                        />
                      </label>
                    </div>
                    <label className="rounded-lg bg-gray-700 px-2 py-1.5 text-[10px] text-gray-300 hover:bg-gray-600 cursor-pointer transition">
                      Changer
                      <input type="file" accept="image/*" onChange={handleCharacterUpload} className="hidden" />
                    </label>
                    <button
                      onClick={() => { setCharacterImage(null); setCharacterScale(1); setCharacterPosition({ x: 85, y: 75 }); }}
                      className="rounded-lg bg-red-600/20 p-1.5 text-red-400 hover:bg-red-600/40 transition"
                      title="Supprimer"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <p className="text-[9px] text-gray-500">Glissez l'image dans l'aperçu pour la repositionner</p>
                </div>
              ) : (
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-700 bg-gray-800 px-4 py-4 hover:border-purple-500 hover:bg-gray-700">
                  <Upload size={18} />
                  <span className="text-sm text-gray-300">Télécharger</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleCharacterUpload}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            {/* Video Upload (Médias) — multi-rush grid with drag-to-reorder */}
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-300">
                Vidéos de fond (optionnel){rushList.length > 0 && (
                  <span className="ml-2 text-xs text-gray-500">
                    {rushList.length} vidéo{rushList.length > 1 ? "s" : ""}
                  </span>
                )}
              </label>

              {rushList.length > 0 && (
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {rushList.map((rush, idx) => (
                    <div
                      key={`${rush.url}-${idx}`}
                      draggable
                      onDragStart={() => setRushDragIdx(idx)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setRushDragOverIdx(idx);
                      }}
                      onDragLeave={() => setRushDragOverIdx(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (rushDragIdx !== null && rushDragIdx !== idx) {
                          reorderRush(rushDragIdx, idx);
                        }
                        setRushDragIdx(null);
                        setRushDragOverIdx(null);
                      }}
                      onDragEnd={() => {
                        setRushDragIdx(null);
                        setRushDragOverIdx(null);
                      }}
                      className={`group relative aspect-video cursor-move overflow-hidden rounded-lg border-2 bg-gray-800 transition ${
                        idx === 0 ? "border-green-500" : "border-gray-700"
                      } ${
                        rushDragOverIdx === idx
                          ? "scale-105 border-purple-500"
                          : ""
                      } ${rushDragIdx === idx ? "opacity-40" : ""}`}
                      title={`${rush.name} — glisser pour réordonner`}
                    >
                      {rush.kind === 'image' ? (
                        <img
                          src={rush.url}
                          alt={rush.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <video
                          src={rush.url}
                          muted
                          preload="metadata"
                          className="h-full w-full object-cover"
                        />
                      )}
                      {idx === 0 && (
                        <div className="absolute left-1 top-1 rounded bg-green-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          1ᵉʳ
                        </div>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeRushAt(idx);
                        }}
                        className="absolute right-1 top-1 rounded bg-red-600/80 p-1 text-white opacity-0 transition hover:bg-red-700 group-hover:opacity-100"
                        title="Supprimer"
                      >
                        <Trash2 size={12} />
                      </button>
                      {rush.kind !== 'image' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openClipAnalysis(idx);
                          }}
                          className="absolute right-1 bottom-5 rounded bg-purple-600/80 p-1 text-white opacity-0 transition hover:bg-purple-700 group-hover:opacity-100"
                          title="Analyser les meilleurs cuts"
                        >
                          <Sparkles size={12} />
                        </button>
                      )}
                      {(rush.fromClip || rush.kind === 'image') && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setCropRushIdx(idx);
                          }}
                          className="absolute left-1 bottom-5 rounded bg-blue-600/80 p-1 text-white opacity-0 transition hover:bg-blue-700 group-hover:opacity-100"
                          title={rush.kind === 'image' ? "Recadrer l'image" : 'Recadrer la vidéo'}
                        >
                          <Crop size={12} />
                        </button>
                      )}
                      <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-1 py-0.5">
                        <div className="truncate text-[10px] text-white">{rush.name}</div>
                        {rush.url && (() => {
                          const expires = getExpiresAt(new Date(), 'video');
                          const remaining = expires.getTime() - Date.now();
                          const color = getRetentionColor(remaining);
                          return (
                            <div className={`text-[9px] ${color} flex items-center gap-0.5`}>
                              <span>⏰</span> {formatRemaining(remaining)}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <label
                className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed ${
                  isUploadingVideo
                    ? "border-purple-500 bg-purple-900/20"
                    : "border-gray-700 bg-gray-800 hover:border-purple-500 hover:bg-gray-700"
                } px-4 py-3`}
              >
                {isUploadingVideo ? (
                  <div className="w-full space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Loader2 size={18} className="animate-spin text-purple-400" />
                      <span className="text-sm text-purple-300 flex-1">
                      Upload en cours...
                      </span>
                      {videoUploadProgress > 0 && <span className="text-xs text-purple-400 font-bold">{videoUploadProgress}%</span>}
                    </div>
                    {videoUploadProgress > 0 && (
                      <div className="h-1 w-full bg-gray-700 rounded-full overflow-hidden">
                        <div className="h-full bg-purple-500 rounded-full transition-all duration-200" style={{ width: `${videoUploadProgress}%` }} />
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <Video size={18} />
                    <span className="text-sm text-gray-300">
                      {rushList.length === 0
                        ? "Ajouter une ou plusieurs vidéos ou images"
                        : "Ajouter d'autres médias"}
                    </span>
                  </>
                )}
                <input
                  type="file"
                  accept="video/*,image/*"
                  multiple
                  onChange={handleVideoUpload}
                  disabled={isUploadingVideo}
                  className="hidden"
                />
              </label>
              <p className="mt-1 text-xs text-gray-500">
                {rushList.length > 1
                  ? "Le 1er média est utilisé dans le montage principal. Glisse pour réordonner."
                  : "La vidéo (max 100 Mo) ou l'image (max 10 Mo) sera utilisée comme fond dans le montage final."}
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

            {/* Export via sticky bar at bottom of preview */}
            <p className="text-center text-sm text-gray-500">
              Utilisez le bouton <span className="text-purple-400 font-medium">⚡ Export</span> en bas de l'aperçu
            </p>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* Right Panel - Preview */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {/* Mobile preview toggle button */}
      <button
        onClick={() => setShowMobilePreview(!showMobilePreview)}
        className="lg:hidden fixed bottom-16 left-1/2 -translate-x-1/2 z-30 bg-purple-600 text-white px-4 py-2 rounded-full shadow-lg text-sm font-medium flex items-center gap-1.5"
      >
        <Eye size={16} /> {showMobilePreview ? 'Fermer' : 'Aperçu'}
      </button>

      <div className={`${showMobilePreview ? 'fixed inset-0 z-20 flex bg-gray-900/95 overflow-y-auto p-4' : 'hidden lg:flex'} w-full lg:w-1/2 flex-col items-center border-l-0 lg:border-l border-gray-800 bg-gray-950 sm:p-6 mt-6 lg:mt-0 lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto`}>
        <h2 className="mb-3 text-base sm:text-xl font-bold text-white">
          Aperçu Vidéo Finale
        </h2>

        {/* ── Sequence Selector + Play Button ── */}
        <div className="flex items-center gap-2 mb-3 flex-wrap justify-center">
          {/* Play/Stop button — reads the montage */}
          <button
            onClick={() => {
              if (isPlaying) { stopPlayback(); setActiveSequence('titre'); }
              else startPlayback();
            }}
            className={`flex items-center gap-2 rounded-2xl pl-1 pr-3 py-1 text-xs font-bold transition-all ${
              isPlaying
                ? 'bg-red-600 text-white shadow-lg shadow-red-500/30 animate-pulse'
                : 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-500/30 hover:shadow-purple-500/50'
            }`}
          >
            <span
              className="inline-flex items-center justify-center rounded-xl bg-white/20 flex-shrink-0"
              style={{ width: 36, height: 36 }}
            >
              {isPlaying
                ? <Pause size={20} fill="currentColor" className="text-white" strokeWidth={1.5} />
                : <Play size={20} fill="currentColor" className="text-white" strokeWidth={1.5} />}
            </span>
            {isPlaying ? 'Stop' : 'Lire'}
          </button>

          {/* Sequence pages */}
          {([
            { key: "titre" as const, label: "Titre", Icon: Type, color: "amber" as IconBadgeColor },
            { key: "cartes" as const, label: "Cartes", Icon: LayoutGrid, color: "pink" as IconBadgeColor },
            ...(rushUrl
              ? [{ key: "video" as const, label: "Vidéo", Icon: Film, color: "emerald" as IconBadgeColor }]
              : []),
            { key: "cta" as const, label: "CTA", Icon: Megaphone, color: "blue" as IconBadgeColor },
          ]).map((seq) => {
            const seqKey = seq.key as "titre" | "cartes" | "video" | "cta";
            const included = exportedSequences[seqKey];
            const isActive = activeSequence === seq.key;
            return (
              <div
                key={seq.key}
                className={`flex items-center gap-0.5 rounded-2xl transition-all ${
                  isActive
                    ? "bg-gray-800/80 shadow-lg shadow-black/20"
                    : "bg-gray-900/60 hover:bg-gray-800/80"
                } ${!included ? "opacity-50" : ""}`}
              >
                <button
                  onClick={() => {
                    stopPlayback();
                    setActiveSequence(seq.key);
                    if (seq.key === "cartes") setStep(0);
                    else if (seq.key === "video") setStep(2);
                  }}
                  className={`flex items-center gap-2 rounded-l-2xl pl-1 pr-2 py-1 text-xs font-medium ${
                    isActive ? "text-white" : "text-gray-300"
                  }`}
                >
                  <IconBadge Icon={seq.Icon} color={seq.color} active={isActive} size={36} iconSize={18} />
                  {seq.label}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setExportedSequences((prev) => ({
                      ...prev,
                      [seqKey]: !prev[seqKey],
                    }));
                  }}
                  title={included ? "Inclure dans l'export" : "Exclu de l'export"}
                  className={`rounded-r-2xl py-2 pl-1 pr-2 transition-colors ${
                    included ? "text-gray-300 hover:text-white" : "text-gray-500 hover:text-gray-300"
                  }`}
                >
                  {included
                    ? <Eye size={16} strokeWidth={2} />
                    : <EyeOff size={16} strokeWidth={2} />}
                </button>
              </div>
            );
          })}

          {/* Undo / Redo */}
          <button
            onClick={handleUndo}
            disabled={!history.canUndo}
            title="Annuler (Cmd/Ctrl+Z)"
            className="flex items-center justify-center w-9 h-9 rounded-2xl bg-gray-900/60 text-gray-300 hover:bg-gray-800/80 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <Undo2 size={16} strokeWidth={2} />
          </button>
          <button
            onClick={handleRedo}
            disabled={!history.canRedo}
            title="Refaire (Cmd/Ctrl+Shift+Z)"
            className="flex items-center justify-center w-9 h-9 rounded-2xl bg-gray-900/60 text-gray-300 hover:bg-gray-800/80 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <Redo2 size={16} strokeWidth={2} />
          </button>

          {/* ── Compact utility toggles (icon-only, separated by a border) ── */}
          <div className="flex items-center gap-1 ml-1 pl-1 border-l border-gray-700/40">
            {/* Guides toggle */}
            <button
              onClick={() => {
                const anyOn = showCenterGuides || showThirdsGuides;
                setShowCenterGuides(!anyOn);
                setShowThirdsGuides(!anyOn);
              }}
              title={showCenterGuides ? "Masquer les guides" : "Afficher les guides"}
              className={`flex items-center justify-center w-9 h-9 rounded-xl transition-all ${
                showCenterGuides || showThirdsGuides
                  ? "bg-purple-600/30 text-purple-300 ring-1 ring-purple-500/40"
                  : "bg-gray-900/60 text-gray-400 hover:bg-gray-800/80 hover:text-white"
              }`}
            >
              <Crosshair size={16} strokeWidth={2} />
            </button>

            {/* Grid overlay toggle */}
            <button
              onClick={() => setShowGridOverlay((v) => !v)}
              title={showGridOverlay ? "Masquer la grille" : "Afficher la grille"}
              className={`flex items-center justify-center w-9 h-9 rounded-xl transition-all ${
                showGridOverlay
                  ? "bg-cyan-600/30 text-cyan-300 ring-1 ring-cyan-500/40"
                  : "bg-gray-900/60 text-gray-400 hover:bg-gray-800/80 hover:text-white"
              }`}
            >
              <Grid3x3 size={16} strokeWidth={2} />
            </button>

            {/* Card position mode toggle */}
            <button
              onClick={() => setCardPositionMode((m) => (m === 'grid' ? 'free' : 'grid'))}
              title={cardPositionMode === 'grid' ? "Mode libre" : "Mode grille"}
              className={`flex items-center justify-center w-9 h-9 rounded-xl transition-all ${
                cardPositionMode === 'free'
                  ? "bg-orange-600/30 text-orange-300 ring-1 ring-orange-500/40"
                  : "bg-gray-900/60 text-gray-400 hover:bg-gray-800/80 hover:text-white"
              }`}
            >
              {cardPositionMode === 'grid' ? <Grid3x3 size={16} strokeWidth={2} /> : <Move size={16} strokeWidth={2} />}
            </button>

            {/* Fond — background panel */}
            <button
              type="button"
              onClick={(e) => {
                const seqKey = (activeSequence === 'titre' || activeSequence === 'cartes' || activeSequence === 'video' || activeSequence === 'cta')
                  ? activeSequence
                  : 'titre';
                const target = `background-${seqKey}` as 'background-titre' | 'background-cartes' | 'background-video' | 'background-cta';
                const x = Math.min(e.clientX - 130, window.innerWidth - 320);
                const y = Math.max(20, Math.min(e.clientY - 40, window.innerHeight - 400));
                setPanelPos({ x, y });
                setActivePanel((prev) => (prev === target ? null : target));
              }}
              title={`Configurer le fond de la séquence ${activeSequence === 'all' ? 'Titre' : activeSequence}`}
              className={`flex items-center justify-center w-9 h-9 rounded-xl transition-all ${
                (typeof activePanel === 'string' && activePanel.startsWith('background-'))
                  ? "bg-purple-600/30 text-purple-300 ring-1 ring-purple-500/40"
                  : "bg-gray-900/60 text-gray-400 hover:bg-gray-800/80 hover:text-white"
              }`}
            >
              <ImageIcon size={16} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Hint when nothing is selected */}
        {!selectedEl && !isPlaying && (
          <p className="mb-2 text-center text-[11px] text-gray-600 italic">
            Double-cliquez sur un élément dans l'aperçu pour le modifier
          </p>
        )}

        {/* B3: Contextual toolbar — shown when an element is selected */}
        {selectedEl && (
          <div className="mb-3 w-full max-w-xl">
            <div
              className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-700/70 bg-gray-900/90 px-3 py-2 shadow-lg backdrop-blur"
              style={{ backdropFilter: 'blur(20px)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-purple-300">
                {selectedEl.type === 'title' && 'Titre'}
                {selectedEl.type === 'cta' && 'CTA'}
                {selectedEl.type === 'overlay' && 'Overlay'}
                {selectedEl.type === 'logo' && 'Logo'}
                {selectedEl.type === 'card' && `Carte ${selectedEl.index + 1}`}
              </span>

              {/* Title toolbar */}
              {selectedEl.type === 'title' && (
                <>
                  <select
                    value={selectedFont}
                    onChange={(e) => setSelectedFont(e.target.value)}
                    className="rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-white"
                    title="Police"
                  >
                    {FONT_OPTIONS.map((opt) => (
                      <option key={opt.label} value={opt.label}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1 text-[10px] text-gray-300">
                    Taille
                    <input
                      type="range"
                      min={0.5}
                      max={3.0}
                      step={0.05}
                      value={textScale}
                      onChange={(e) => setTextScale(Number(e.target.value))}
                      className="w-20 accent-purple-500"
                    />
                  </label>
                  <button
                    onClick={() => setTitleBold((v) => !v)}
                    className={`rounded p-1.5 transition ${titleBold ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
                    title="Gras"
                  >
                    <Bold size={12} />
                  </button>
                  <button
                    onClick={() => setTitleItalic((v) => !v)}
                    className={`rounded p-1.5 transition ${titleItalic ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
                    title="Italique"
                  >
                    <Italic size={12} />
                  </button>
                  <label className="flex items-center gap-1 text-[10px] text-gray-300">
                    Couleur
                    <input
                      type="color"
                      value={titleColor}
                      onChange={(e) => setTitleColor(e.target.value)}
                      className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
                    />
                  </label>
                </>
              )}

              {/* CTA toolbar */}
              {selectedEl.type === 'cta' && (
                <>
                  <select
                    value={selectedFont}
                    onChange={(e) => setSelectedFont(e.target.value)}
                    className="rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-white"
                    title="Police"
                  >
                    {FONT_OPTIONS.map((opt) => (
                      <option key={opt.label} value={opt.label}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1 text-[10px] text-gray-300">
                    Taille
                    <input
                      type="range"
                      min={0.5}
                      max={2}
                      step={0.05}
                      value={ctaTextScale}
                      onChange={(e) => setCtaTextScale(Number(e.target.value))}
                      className="w-20 accent-yellow-500"
                    />
                  </label>
                  <button
                    onClick={() => setCtaBold((v) => !v)}
                    className={`rounded p-1.5 transition ${ctaBold ? 'bg-yellow-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
                    title="Gras"
                  >
                    <Bold size={12} />
                  </button>
                  <button
                    onClick={() => setCtaItalic((v) => !v)}
                    className={`rounded p-1.5 transition ${ctaItalic ? 'bg-yellow-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
                    title="Italique"
                  >
                    <Italic size={12} />
                  </button>
                  <label className="flex items-center gap-1 text-[10px] text-gray-300">
                    Principal
                    <input
                      type="color"
                      value={ctaColor}
                      onChange={(e) => setCtaColor(e.target.value)}
                      className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-[10px] text-gray-300">
                    Sous-titre
                    <input
                      type="color"
                      value={ctaSubColor}
                      onChange={(e) => setCtaSubColor(e.target.value)}
                      className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
                    />
                  </label>
                </>
              )}

              {/* Card toolbar */}
              {selectedEl.type === 'card' && cards[selectedEl.index] && (
                <>
                  <label className="flex items-center gap-1 text-[10px] text-gray-300">
                    Fond
                    <input
                      type="color"
                      value={cards[selectedEl.index].color}
                      onChange={(e) => {
                        const idx = selectedEl.index;
                        setCards((prev) =>
                          prev.map((c, i) => (i === idx ? { ...c, color: e.target.value } : c)),
                        );
                      }}
                      className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-[10px] text-gray-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={!!cards[selectedEl.index].textOnly}
                      onChange={(e) => {
                        const idx = selectedEl.index;
                        const next = e.target.checked;
                        setCards((prev) =>
                          prev.map((c, i) => (i === idx ? { ...c, textOnly: next } : c)),
                        );
                      }}
                      className="accent-pink-500"
                    />
                    Texte seul
                  </label>
                  <button
                    onClick={() => {
                      const idx = selectedEl.index;
                      const src = cards[idx];
                      if (!src) return;
                      const copy: InfoCard = {
                        ...src,
                        id: `c_${Date.now()}`,
                        position: src.position
                          ? { x: Math.min(95, src.position.x + 5), y: Math.min(95, src.position.y + 5) }
                          : undefined,
                      };
                      setCards((prev) => [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)]);
                    }}
                    className="flex items-center gap-1 rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 hover:text-white"
                  >
                    <CopyIcon size={12} /> Dupliquer
                  </button>
                  <button
                    onClick={() => {
                      const idx = selectedEl.index;
                      setCards((prev) => prev.filter((_, i) => i !== idx));
                      setSelectedEl(null);
                    }}
                    className="flex items-center gap-1 rounded bg-red-900/60 px-2 py-1 text-xs text-red-200 hover:bg-red-900 hover:text-white"
                  >
                    <Trash2 size={12} /> Supprimer
                  </button>
                </>
              )}

              {/* Logo toolbar */}
              {selectedEl.type === 'logo' && (
                <>
                  <label className="flex items-center gap-1 text-[10px] text-gray-300">
                    Taille
                    <input
                      type="range"
                      min={0.3}
                      max={3}
                      step={0.05}
                      value={logoScale}
                      onChange={(e) => setLogoScale(Number(e.target.value))}
                      className="w-24 accent-green-500"
                    />
                  </label>
                  <button
                    onClick={() => {
                      setLogoImage(null);
                      setSelectedEl(null);
                    }}
                    className="flex items-center gap-1 rounded bg-red-900/60 px-2 py-1 text-xs text-red-200 hover:bg-red-900 hover:text-white"
                  >
                    <Trash2 size={12} /> Supprimer
                  </button>
                </>
              )}

              {/* Overlay toolbar */}
              {selectedEl.type === 'overlay' && (
                <>
                  <input
                    type="text"
                    value={videoOverlayText}
                    onChange={(e) => setVideoOverlayText(e.target.value)}
                    placeholder="Texte overlay"
                    className="rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-white placeholder-gray-500 w-40"
                  />
                  <button
                    onClick={() => setOverlayBold((v) => !v)}
                    className={`rounded p-1.5 transition ${overlayBold ? 'bg-cyan-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
                    title="Gras"
                  >
                    <Bold size={12} />
                  </button>
                  <button
                    onClick={() => setOverlayItalic((v) => !v)}
                    className={`rounded p-1.5 transition ${overlayItalic ? 'bg-cyan-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
                    title="Italique"
                  >
                    <Italic size={12} />
                  </button>
                </>
              )}

              <button
                onClick={() => setSelectedEl(null)}
                className="ml-auto rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-white"
                title="Fermer"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Preview Container */}
        <div
          className={`relative w-full ${previewClasses.maxW} mx-auto`}
          onClick={(e) => {
            if (activePanel) setActivePanel(null);
            // Deselect only when the click lands on the preview background itself,
            // not bubbled up from an element that already set a selection.
            const target = e.target as HTMLElement;
            if (target === previewRef.current || target.closest('[data-preview-bg]') === previewRef.current) {
              setSelectedEl(null);
            }
          }}
        >
          <div
            ref={previewRef}
            onDoubleClick={(e) => {
              if (e.target === previewRef.current || (e.target as HTMLElement).closest('[data-preview-bg]')) {
                // Per-sequence background panel (Phase 1) — opens the panel
                // for the currently active sequence. If activeSequence is
                // 'all' (cycle playing), fall back to the legacy global
                // background panel.
                if (activeSequence === 'titre' || activeSequence === 'cartes' || activeSequence === 'video' || activeSequence === 'cta') {
                  openPanel(`background-${activeSequence}` as 'background-titre' | 'background-cartes' | 'background-video' | 'background-cta', e);
                } else {
                  openPanel('background', e);
                }
              }
            }}
            onMouseDown={(e) => {
              // Drag-select rectangle — only when clicking the raw background
              // (not bubbled from a card/title/etc.) in free-position mode.
              if (cardPositionMode !== 'free') return;
              if (e.target !== previewRef.current) return;
              if (!previewRef.current) return;
              const rect = previewRef.current.getBoundingClientRect();
              const x = ((e.clientX - rect.left) / rect.width) * 100;
              const y = ((e.clientY - rect.top) / rect.height) * 100;
              dragSelectStartRef.current = { x, y };
              setDragSelectRect({ x1: x, y1: y, x2: x, y2: y });
              // Background click without shift clears current selection so
              // the drag-rectangle starts from a clean slate.
              if (!e.shiftKey && !e.metaKey && !e.ctrlKey) clearCardSelection();
            }}
            data-preview-bg
            className={`${previewClasses.aspect} relative flex flex-col items-center justify-between ${backdropRounded ? '' : 'rounded-lg'} p-4 shadow-2xl overflow-hidden transition-all duration-300`}
            style={{
              fontFamily: FONT_CSS_MAP[selectedFont] || "inherit",
              // Approximate the rounded-corner card effect in the preview.
              // The composer paints the full card with the exact radius +
              // margin at export time; the preview scales the radius
              // proportionally to the preview width.
              ...(backdropRounded
                ? { borderRadius: `${Math.round(backdropRadius * 0.3)}px` }
                : {}),
              ...(branding.borderEnabled
                ? { boxShadow: `inset 0 0 0 8px ${branding.borderColor || '#D91CD2'}, 0 25px 50px -12px rgb(0 0 0 / 0.25)` }
                : {}),
              ...(() => {
                if (activeSequence === "video" && rushUrl) return { background: "#0A0A0F" };
                const seqNoColor =
                  activeSequence === "all"
                    ? noColorSequences.length >= 4
                    : noColorSequences.includes(activeSequence);
                if (seqNoColor) return { background: "#0A0A0F" };
                // Use the SAME gradientColor1/gradientColor2 hex values that
                // are passed to the composer — guarantees editor↔export color
                // parity. Previously the editor painted a Tailwind class
                // derived from `colorTheme` while the composer painted the
                // hex pair, which diverged on some themes.
                return {
                  ...FILTER_CSS_MAP[selectedFilter],
                  background: `linear-gradient(135deg, ${gradientColor1}, ${gradientColor2})`,
                };
              })(),
            }}
            onMouseMove={(e) => {
              if (!previewRef.current) return;
              const rect = previewRef.current.getBoundingClientRect();
              // Drag-select rectangle grows while the user holds the mouse
              // on the preview background in free-position mode.
              if (dragSelectStartRef.current) {
                const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
                const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
                setDragSelectRect({
                  x1: dragSelectStartRef.current.x,
                  y1: dragSelectStartRef.current.y,
                  x2: x,
                  y2: y,
                });
                return;
              }
              // Free-mode card dragging — each card moved independently,
              // OR together when the card belongs to a group (or is part of
              // the current multi-selection). Delta from the dragged card's
              // old position is applied to every companion, clamped to the
              // preview bounds.
              if (dragCardIdx !== null) {
                let cx = Math.max(
                  0,
                  Math.min(100, ((e.clientX - rect.left) / rect.width) * 100),
                );
                let cy = Math.max(
                  0,
                  Math.min(100, ((e.clientY - rect.top) / rect.height) * 100),
                );
                if (smartGuidesEnabled) {
                  const otherCards: ElementPos[] = cards
                    .map((c, i) => ({ i, p: c.position }))
                    .filter((x) => x.i !== dragCardIdx && x.p)
                    .map(({ i, p }) => ({ key: 'cards' as const, x: p!.x, y: p!.y, label: `Carte ${i + 1}` }));
                  const snap = snapPosition(cx, cy, otherCards);
                  cx = snap.x;
                  cy = snap.y;
                  setActiveGuides(snap.guides);
                  const active: ElementPos = { key: 'cards', x: cx, y: cy, label: 'Carte' };
                  setActiveDistanceBadges(computeDistanceBadges(active, otherCards, rect.width, rect.height));
                }
                setCards((prev) => {
                  if (dragCardIdx >= prev.length) return prev;
                  const dragged = prev[dragCardIdx];
                  const oldX = dragged.position?.x ?? cx;
                  const oldY = dragged.position?.y ?? cy;
                  const dx = cx - oldX;
                  const dy = cy - oldY;
                  // Companions = group members of the dragged card, unioned
                  // with the current multi-selection (if the dragged card
                  // itself is selected). Guarantees at minimum the dragged
                  // card itself gets moved.
                  const companionIds = new Set<string>([dragged.id]);
                  const grp = cardGroups.find((g) => g.cardIds.includes(dragged.id));
                  if (grp) grp.cardIds.forEach((id) => companionIds.add(id));
                  if (selectedCardIds.has(dragged.id)) {
                    selectedCardIds.forEach((id) => companionIds.add(id));
                  }
                  return prev.map((c) => {
                    if (c.id === dragged.id) {
                      return { ...c, position: { x: cx, y: cy } };
                    }
                    if (companionIds.has(c.id) && c.position) {
                      return {
                        ...c,
                        position: {
                          x: Math.max(0, Math.min(100, c.position.x + dx)),
                          y: Math.max(0, Math.min(100, c.position.y + dy)),
                        },
                      };
                    }
                    return c;
                  });
                });
                return;
              }
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
              let rawX = Math.max(
                5,
                Math.min(95, ((e.clientX - rect.left) / rect.width) * 100),
              );
              let rawY = Math.max(
                3,
                Math.min(97, ((e.clientY - rect.top) / rect.height) * 100),
              );

              // ── Smart guides: snap + alignment hints ───────────────
              if (smartGuidesEnabled) {
                const activeLogoPos = getActiveLogoPos();
                const allPositions: ElementPos[] = [
                  { key: 'title', x: titlePos.x, y: titlePos.y, label: 'Titre' },
                  { key: 'cards', x: cardsPos.x, y: cardsPos.y, label: 'Cartes' },
                  { key: 'watermark', x: watermarkPos.x, y: watermarkPos.y, label: 'CTA' },
                  { key: 'overlay', x: overlayPos.x, y: overlayPos.y, label: 'Overlay' },
                  { key: 'logo', x: activeLogoPos.x, y: activeLogoPos.y, label: 'Logo' },
                  { key: 'sitetext', x: siteTextPos.x, y: siteTextPos.y, label: 'Site' },
                ];
                const others = allPositions.filter((p) => p.key !== dragging);
                const snap = snapPosition(rawX, rawY, others);
                rawX = snap.x;
                rawY = snap.y;
                setActiveGuides(snap.guides);
                const active: ElementPos = { key: dragging as ElementPos['key'], x: rawX, y: rawY, label: 'Actif' };
                setActiveDistanceBadges(computeDistanceBadges(active, others, rect.width, rect.height));
              }

              const x = Math.round(rawX);
              const y = Math.round(rawY);
              if (dragging === "title") setTitlePos({ x, y });
              else if (dragging === "extraTitle") setExtraTitlePosition({ x, y });
              else if (dragging === "extraSubtitle") setExtraSubtitlePosition({ x, y });
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
              else if (dragging?.startsWith('overlay:')) {
                const extraIdx = parseInt(dragging.slice('overlay:'.length), 10);
                if (!Number.isNaN(extraIdx)) {
                  setExtraOverlays((prev) =>
                    prev.map((o, i) => (i === extraIdx ? { ...o, position: { x, y } } : o)),
                  );
                }
              }
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
              // Finalize drag-select rectangle: every card whose center
              // lies inside the rectangle (in % space) joins the selection.
              if (dragSelectRect) {
                const minX = Math.min(dragSelectRect.x1, dragSelectRect.x2);
                const maxX = Math.max(dragSelectRect.x1, dragSelectRect.x2);
                const minY = Math.min(dragSelectRect.y1, dragSelectRect.y2);
                const maxY = Math.max(dragSelectRect.y1, dragSelectRect.y2);
                // Only count a real rectangle (≥1% on each axis) so a tiny
                // click-without-drag doesn't accidentally pick one card.
                if (maxX - minX >= 1 && maxY - minY >= 1) {
                  const hit = new Set<string>();
                  cards.forEach((c, i) => {
                    const cols = format === '16:9' ? 3 : 2;
                    const defaultX = 25 + (i % cols) * 25;
                    const defaultY = 40 + Math.floor(i / cols) * 18;
                    const cx = c.position?.x ?? defaultX;
                    const cy = c.position?.y ?? defaultY;
                    if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) hit.add(c.id);
                  });
                  setSelectedCardIds(hit);
                }
                dragSelectStartRef.current = null;
                setDragSelectRect(null);
              }
              setDragging(null);
              setResizing(null);
              setDragCardIdx(null);
              resizeStart.current = null;
              setActiveGuides([]);
              setActiveDistanceBadges([]);
            }}
            onMouseLeave={() => {
              dragSelectStartRef.current = null;
              setDragSelectRect(null);
              setDragging(null);
              setResizing(null);
              setDragCardIdx(null);
              resizeStart.current = null;
              setActiveGuides([]);
              setActiveDistanceBadges([]);
            }}
            onTouchMove={(e) => {
              if (dragCardIdx === null || !previewRef.current) return;
              const t = e.touches[0];
              if (!t) return;
              const rect = previewRef.current.getBoundingClientRect();
              const x = Math.max(
                0,
                Math.min(100, ((t.clientX - rect.left) / rect.width) * 100),
              );
              const y = Math.max(
                0,
                Math.min(100, ((t.clientY - rect.top) / rect.height) * 100),
              );
              setCards((prev) => {
                if (dragCardIdx >= prev.length) return prev;
                const next = prev.slice();
                next[dragCardIdx] = { ...next[dragCardIdx], position: { x, y } };
                return next;
              });
            }}
            onTouchEnd={() => {
              setDragCardIdx(null);
            }}
            onTouchCancel={() => {
              setDragCardIdx(null);
            }}
          >
            {/* Center guides — vertical + horizontal dashed lines through the preview center */}
            {/* Center + thirds guide lines */}
            {showCenterGuides && (
              <>
                <div className="pointer-events-none absolute inset-y-0 left-1/2 border-l border-dashed z-20" style={{ borderColor: 'rgba(168,85,247,0.3)' }} />
                <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed z-20" style={{ borderColor: 'rgba(168,85,247,0.3)' }} />
              </>
            )}
            {showThirdsGuides && (
              <>
                <div className="pointer-events-none absolute inset-y-0 z-20" style={{ left: '33.33%', borderLeft: '1px dashed rgba(168,85,247,0.2)' }} />
                <div className="pointer-events-none absolute inset-y-0 z-20" style={{ left: '66.66%', borderLeft: '1px dashed rgba(168,85,247,0.2)' }} />
                <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top: '33.33%', borderTop: '1px dashed rgba(168,85,247,0.2)' }} />
                <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top: '66.66%', borderTop: '1px dashed rgba(168,85,247,0.2)' }} />
              </>
            )}

            {/* Background Photo — global Pexels/poster (hidden when a per-sequence bg overrides it) */}
            {previewPhoto &&
              ((activeSequence === "all" && exportedSequences.titre) || activeSequence === "titre") &&
              !(activeSequence !== 'all' && sequenceBackgrounds[activeSequence as 'titre' | 'cartes' | 'video' | 'cta']?.url) && (
                <img
                  src={previewPhoto.medium}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                  style={{
                    opacity:
                      (activeSequence === "all"
                        ? noColorSequences.includes("titre")
                        : noColorSequences.includes(activeSequence))
                        ? 0.85
                        : 0.2,
                  }}
                />
              )}

            {/* Per-sequence background image with CSS filters (Phase 2) */}
            {activeSequence !== 'all' && (() => {
              const seqBgCfg = sequenceBackgrounds[activeSequence as 'titre' | 'cartes' | 'video' | 'cta'];
              if (!seqBgCfg?.url) return null;
              return (
                <>
                  <img
                    src={seqBgCfg.url}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover"
                    style={{
                      opacity: seqBgCfg.opacity ?? 1,
                      filter: buildCssFilter(seqBgCfg.filters),
                      objectPosition: seqBgCfg.objectPosition ?? '50% 50%',
                    }}
                  />
                  {/* Vignette overlay */}
                  {(seqBgCfg.filters?.vignette ?? 0) > 0 && (
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        background: `radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,${seqBgCfg.filters!.vignette}) 100%)`,
                      }}
                    />
                  )}
                </>
              );
            })()}

            {/* Video background (uploaded video or still image) — visible during the video sequence */}
            {rushUrl &&
              ((activeSequence === "all" && exportedSequences.video) || activeSequence === "video") && (
                rushList[0]?.kind === 'image' ? (
                  !rushImageError && (
                    <img
                      src={rushUrl}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover"
                      style={{
                        opacity: activeSequence === "video" ? 1 : 0.6,
                        transform: rushList[0]?.transform
                          ? `translate(${(rushList[0].transform.offsetX || 0) * 100}%, ${(rushList[0].transform.offsetY || 0) * 100}%) scale(${rushList[0].transform.scale || 1})`
                          : undefined,
                        transformOrigin: "center center",
                      }}
                      onError={(e) => {
                        const img = e.target as HTMLImageElement;
                        console.error('[RushImage] Failed to load:', img.src);
                        showToast(`Image rush non lisible. Vérifier l'upload.`);
                        setRushImageError(true);
                      }}
                    />
                  )
                ) : (
                  !rushVideoError && (
                    <video
                      ref={rushVideoRef}
                      src={rushUrl}
                      className="absolute inset-0 h-full w-full object-cover"
                      style={{
                        opacity: activeSequence === "video" ? 1 : 0.6,
                        transform: rushList[0]?.transform
                          ? `translate(${(rushList[0].transform.offsetX || 0) * 100}%, ${(rushList[0].transform.offsetY || 0) * 100}%) scale(${rushList[0].transform.scale || 1})`
                          : undefined,
                        transformOrigin: "center center",
                      }}
                      autoPlay
                      muted
                      loop
                      playsInline
                      onTimeUpdate={(e) => setVideoCurrentTime((e.target as HTMLVideoElement).currentTime)}
                      onError={(e) => {
                        const video = e.target as HTMLVideoElement;
                        const code = video.error?.code;
                        const msg = video.error?.message || 'unknown';
                        console.error('[RushVideo] Failed to load:', video.src, 'code=' + code, 'msg=' + msg);
                        showToast(`Vidéo rush non lisible (code ${code}). Vérifier que l'upload est complet.`);
                        setRushVideoError(true);
                      }}
                    />
                  )
                )
              )}

            {/* Smart alignment guides + optional grid overlay (pointer-events:none) */}
            <SmartGuides
              guides={smartGuidesEnabled ? activeGuides : []}
              distanceBadges={smartGuidesEnabled ? activeDistanceBadges : []}
              showGrid={showGridOverlay}
            />

            {/* Drag-select rectangle (free-mode cards only) */}
            {dragSelectRect && (
              <div
                className="pointer-events-none absolute z-30 border-2 border-dashed border-cyan-400 bg-cyan-400/10"
                style={{
                  left: `${Math.min(dragSelectRect.x1, dragSelectRect.x2)}%`,
                  top: `${Math.min(dragSelectRect.y1, dragSelectRect.y2)}%`,
                  width: `${Math.abs(dragSelectRect.x2 - dragSelectRect.x1)}%`,
                  height: `${Math.abs(dragSelectRect.y2 - dragSelectRect.y1)}%`,
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
                    onDoubleClick={(e) => {
                      // Double-click on gradient overlay opens the per-sequence
                      // background panel (primary action). Gradient settings are
                      // accessible via the toolbar "Fond" button → gradient section.
                      if (activeSequence === 'titre' || activeSequence === 'cartes' || activeSequence === 'video' || activeSequence === 'cta') {
                        openPanel(`background-${activeSequence}` as 'background-titre' | 'background-cartes' | 'background-video' | 'background-cta', e);
                      } else {
                        openPanel('gradient', e);
                      }
                    }}
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
            {((activeSequence === "all" && exportedSequences.titre) || activeSequence === "titre") && (
              <>
              <div
                className={`absolute z-20 text-center cursor-grab active:cursor-grabbing group/title ${activePanel === "title" || (selectedEl?.type === 'title') ? "ring-1 ring-purple-400 ring-offset-1 ring-offset-transparent rounded" : ""}`}
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
                onClick={(e) => { e.stopPropagation(); selectEl({ type: 'title' }); }}
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
                  className={`font-black ${titleTextGradient ? '' : 'drop-shadow-lg'}`}
                  style={{
                    fontSize: `${(format === "16:9" ? 18 : 14) * textScale}px`,
                    letterSpacing: `${titleLetterSpacing}px`,
                    lineHeight: titleLineHeight,
                    fontWeight: titleBold ? 900 : 400,
                    fontStyle: titleItalic ? "italic" : "normal",
                    fontFamily: titleFont ? (FONT_CSS_MAP[titleFont] || titleFont) : undefined,
                    ...(titleTextGradient ? {
                      backgroundImage: `linear-gradient(135deg, ${titleGradColor1}, ${titleGradColor2})`,
                      backgroundColor: 'transparent',
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                      backgroundClip: "text",
                      color: "transparent",
                      display: 'inline-block',
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
              {extraTitle && (
                <div
                  className="absolute z-20 select-none cursor-grab active:cursor-grabbing text-center"
                  style={{
                    left: `${extraTitlePosition.x}%`,
                    top: `${extraTitlePosition.y}%`,
                    transform: 'translate(-50%, -50%)',
                    fontSize: `${(format === "16:9" ? 9 : 7) * textScale * extraTitleScale}px`,
                    letterSpacing: `${extraTitleLetterSpacing}px`,
                    lineHeight: extraTitleLineHeight,
                    fontWeight: extraTitleBold ? 900 : 400,
                    fontStyle: extraTitleItalic ? 'italic' : 'normal',
                    fontFamily: titleFont ? (FONT_CSS_MAP[titleFont] || titleFont) : undefined,
                    whiteSpace: 'pre-wrap',
                    ...(extraTitleGradient ? {
                      backgroundImage: `linear-gradient(135deg, ${extraTitleGradColor1}, ${extraTitleGradColor2})`,
                      backgroundColor: 'transparent',
                      WebkitBackgroundClip: 'text',
                      backgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      color: 'transparent',
                      display: 'inline-block',
                    } : { color: titleColor }),
                  }}
                  onMouseDown={(e) => { e.preventDefault(); setDragging("extraTitle"); }}
                >
                  {extraTitle}
                </div>
              )}
              {extraSubtitle && (
                <div
                  className="absolute z-20 select-none cursor-grab active:cursor-grabbing text-center"
                  style={{
                    left: `${extraSubtitlePosition.x}%`,
                    top: `${extraSubtitlePosition.y}%`,
                    transform: 'translate(-50%, -50%)',
                    fontSize: `${(format === "16:9" ? 6.75 : 5.25) * textScale * extraSubtitleScale}px`,
                    letterSpacing: `${extraSubtitleLetterSpacing}px`,
                    lineHeight: extraSubtitleLineHeight,
                    fontWeight: extraSubtitleBold ? 900 : 400,
                    fontStyle: extraSubtitleItalic ? 'italic' : 'normal',
                    fontFamily: titleFont ? (FONT_CSS_MAP[titleFont] || titleFont) : undefined,
                    whiteSpace: 'pre-wrap',
                    ...(extraSubtitleGradient ? {
                      backgroundImage: `linear-gradient(135deg, ${extraSubtitleGradColor1}, ${extraSubtitleGradColor2})`,
                      backgroundColor: 'transparent',
                      WebkitBackgroundClip: 'text',
                      backgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      color: 'transparent',
                      display: 'inline-block',
                    } : { color: titleColor, opacity: 0.8 }),
                  }}
                  onMouseDown={(e) => { e.preventDefault(); setDragging("extraSubtitle"); }}
                >
                  {extraSubtitle}
                </div>
              )}
              </>
            )}

            {/* ── VIDEO OVERLAY TEXT (visible in video sequence) — draggable, no bg ──
                Fade in/out on a 300ms CSS transition based on the overlay's
                configured [startTime, endTime] window, tracked via a
                timeupdate listener on the rush <video>. When the overlay's
                panel tab is active we force-show it so the user can still
                drag/position it while out-of-window. */}
            {rushUrl &&
              ((activeSequence === "all" && exportedSequences.video) || activeSequence === "video") &&
              videoOverlayText && (
                <div
                  className={`absolute z-20 text-center cursor-grab active:cursor-grabbing group/overlay ${activePanel === "overlay" && activeOverlayIdx === 0 ? "ring-1 ring-cyan-400 ring-offset-1 ring-offset-transparent rounded" : ""}`}
                  style={{
                    left: `${overlayPos.x}%`,
                    top: `${overlayPos.y}%`,
                    transform: "translate(-50%, -50%)",
                    width: "85%",
                    // Fade out when outside the configured time window
                    // unless the user is actively editing this overlay.
                    opacity: (activePanel === 'overlay' && activeOverlayIdx === 0)
                      || (videoCurrentTime >= (overlayStartTime || 0)
                        && (overlayEndTime === undefined || overlayEndTime < 0 || videoCurrentTime <= overlayEndTime))
                      ? 1
                      : 0,
                    transition: 'opacity 300ms ease',
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setDragging("overlay");
                    setActiveOverlayIdx(0);
                  }}
                  onClick={(e) => { e.stopPropagation(); selectEl({ type: 'overlay' }); setActiveOverlayIdx(0); }}
                  onDoubleClick={(e) => { setActiveOverlayIdx(0); openPanel("overlay", e); }}
                >
                  <div className="absolute inset-0 border border-dashed border-cyan-500/0 group-hover/overlay:border-cyan-500/40 rounded pointer-events-none transition-colors" />
                  <p
                    // Strip `drop-shadow-lg` when the text gradient is on —
                    // Tailwind's `filter: drop-shadow(...)` creates a
                    // compositing layer that pre-paints the background
                    // rectangle and stops `background-clip: text` from
                    // resolving to glyph shape. We also drop textShadow in
                    // that mode so a dark silhouette doesn't leak through.
                    className={`font-black ${overlayTextGradient ? '' : 'drop-shadow-lg'}`}
                    style={{
                      fontSize: `${16 * textScale * overlayTextScale}px`,
                      letterSpacing: `${overlayLetterSpacing}px`,
                      lineHeight: overlayLineHeight,
                      fontWeight: overlayBold ? "bold" : "normal",
                      fontStyle: overlayItalic ? "italic" : "normal",
                      fontFamily: overlayFont ? (FONT_CSS_MAP[overlayFont] || overlayFont) : undefined,
                      ...(overlayTextGradient ? {
                        backgroundImage: `linear-gradient(135deg, ${overlayGradColor1}, ${overlayGradColor2})`,
                        backgroundColor: 'transparent',
                        WebkitBackgroundClip: 'text',
                        backgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        color: 'transparent',
                        display: 'inline-block',
                      } : {
                        color: overlayColor,
                        textShadow: "0 2px 8px rgba(0,0,0,0.8), 0 0 20px rgba(0,0,0,0.5)",
                      }),
                    }}
                  >
                    {videoOverlayText}
                  </p>
                </div>
              )}

            {/* Extra overlays — same timing window gating as the legacy
                overlay above. The active tab forces its overlay visible
                so drag handles stay reachable during editing. */}
            {rushUrl &&
              ((activeSequence === "all" && exportedSequences.video) || activeSequence === "video") &&
              extraOverlays.map((ov, i) => ov.text ? (
                <div
                  key={ov.id}
                  className={`absolute z-20 text-center cursor-grab active:cursor-grabbing ${activePanel === "overlay" && activeOverlayIdx === i + 1 ? "ring-1 ring-cyan-400 ring-offset-1 ring-offset-transparent rounded" : ""}`}
                  style={{
                    left: `${ov.position.x}%`,
                    top: `${ov.position.y}%`,
                    transform: "translate(-50%, -50%)",
                    width: "85%",
                    opacity: (activePanel === 'overlay' && activeOverlayIdx === i + 1)
                      || (videoCurrentTime >= (ov.startTime || 0)
                        && (ov.endTime === undefined || ov.endTime < 0 || videoCurrentTime <= ov.endTime))
                      ? 1
                      : 0,
                    transition: 'opacity 300ms ease',
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setActiveOverlayIdx(i + 1);
                    setDragging(`overlay:${i}`);
                  }}
                  onClick={(e) => { e.stopPropagation(); setActiveOverlayIdx(i + 1); }}
                  onDoubleClick={(e) => { setActiveOverlayIdx(i + 1); openPanel("overlay", e); }}
                >
                  <p
                    className={`font-black ${overlayTextGradient ? '' : 'drop-shadow-lg'}`}
                    style={{
                      fontSize: `${16 * textScale * (ov.scale || 1)}px`,
                      letterSpacing: `${ov.letterSpacing}px`,
                      lineHeight: ov.lineHeight,
                      fontWeight: ov.bold ? "bold" : "normal",
                      fontStyle: ov.italic ? "italic" : "normal",
                      fontFamily: overlayFont ? (FONT_CSS_MAP[overlayFont] || overlayFont) : undefined,
                      // Extras inherit the legacy overlay's gradient flag so
                      // the whole stack is styled consistently.
                      ...(overlayTextGradient ? {
                        backgroundImage: `linear-gradient(135deg, ${overlayGradColor1}, ${overlayGradColor2})`,
                        backgroundColor: 'transparent',
                        WebkitBackgroundClip: 'text',
                        backgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        color: 'transparent',
                        display: 'inline-block',
                      } : {
                        color: ov.color,
                        textShadow: "0 2px 8px rgba(0,0,0,0.8), 0 0 20px rgba(0,0,0,0.5)",
                      }),
                    }}
                  >
                    {ov.text}
                  </p>
                </div>
              ) : null)}

            {/* ── CARDS (visible in all, cartes) — grid or free-positioning mode ── */}
            {((activeSequence === "all" && exportedSequences.cartes) || activeSequence === "cartes") &&
              cards.length > 0 && (() => {
                const cardsK = (cardsTextScale || 100) / 100;
                const scaledLabel = `${Math.round(7 * textScale * cardsK)}px`;
                const scaledValue = `${Math.round(9 * textScale * cardsK)}px`;
                const scaledDesc = `${Math.round(6 * textScale * cardsK)}px`;
                // Cards-specific font overrides the page-wide selectedFont.
                // Falls back to `undefined` (inherit selectedFont) when unset.
                const cardsFontFamily = cardsFont ? (FONT_CSS_MAP[cardsFont] || cardsFont) : undefined;
                const _cardsGradStyle = {
                  backgroundImage: `linear-gradient(135deg, ${cardsTextGradColor1}, ${cardsTextGradColor2})`,
                  backgroundColor: 'transparent',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  color: 'transparent',
                  display: 'inline-block',
                  whiteSpace: 'pre-wrap' as const,
                } as const;
                const labelGradStyle = cardsLabelGradient ? _cardsGradStyle : null;
                const valueGradStyle = cardsValueGradient ? _cardsGradStyle : null;
                const descGradStyle = cardsDescriptionGradient ? _cardsGradStyle : null;
                const renderCardInner = (card: InfoCard) => {
                  // ── Compact ──
                  if (selectedCardStyle === "Compact") {
                    return (
                      <div
                        className="flex flex-col items-center gap-0.5 rounded-lg bg-black/30 px-1.5 py-1.5 backdrop-blur-sm w-full"
                        style={{ borderLeft: `2px solid ${card.color}` }}
                      >
                        {card.emoji && card.emoji.trim() !== "" && (
                          <span
                            className={
                              format === "16:9" ? "text-lg" : "text-sm"
                            }
                          >
                            {renderCardIcon(card)}
                          </span>
                        )}
                        <p
                          className={`text-center font-bold whitespace-pre-wrap ${labelGradStyle ? '' : 'text-white drop-shadow'}`}
                          style={{ fontSize: scaledLabel, ...(labelGradStyle ?? {}) }}
                        >
                          {renderBoldMarkdown(card.label)}
                        </p>
                        <p
                          className={`text-center font-black whitespace-pre-wrap ${valueGradStyle ? '' : 'drop-shadow'}`}
                          style={valueGradStyle
                            ? { fontSize: scaledValue, ...valueGradStyle }
                            : { fontSize: scaledValue, color: card.color }}
                        >
                          {card.value}
                        </p>
                        {card.description && (
                          <p
                            className={`text-center whitespace-pre-wrap ${descGradStyle ? '' : 'text-white/60'}`}
                            style={{ fontSize: scaledDesc, ...(descGradStyle ?? {}) }}
                          >
                            {renderBoldMarkdown(truncateAtWord(card.description, 70))}
                          </p>
                        )}
                      </div>
                    );
                  }
                  // ── Educatif ──
                  if (selectedCardStyle === "Educatif") {
                    return (
                      <div
                        className="rounded-lg bg-black/40 px-2 py-2 backdrop-blur-sm w-full"
                        style={{ borderTop: `2px solid ${card.color}` }}
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          {card.emoji && card.emoji.trim() !== "" && (
                            <span className="text-sm inline-flex items-center">{renderCardIcon(card)}</span>
                          )}
                          <p
                            className={`font-bold whitespace-pre-wrap ${labelGradStyle ? '' : 'text-white'}`}
                            style={{ fontSize: scaledLabel, ...(labelGradStyle ?? {}) }}
                          >
                            {renderBoldMarkdown(card.label)}
                          </p>
                        </div>
                        <p
                          className={`leading-relaxed mb-1 whitespace-pre-wrap ${descGradStyle ? '' : 'text-white/70'}`}
                          style={{ fontSize: scaledDesc, ...(descGradStyle ?? {}) }}
                        >
                          {renderBoldMarkdown(truncateAtWord(card.description, 90))}
                        </p>
                        <p
                          className="font-black whitespace-pre-wrap"
                          style={valueGradStyle
                            ? { fontSize: scaledValue, ...valueGradStyle }
                            : { fontSize: scaledValue, color: card.color }}
                        >
                          {card.value}
                        </p>
                      </div>
                    );
                  }
                  // ── Stats Bold ──
                  if (selectedCardStyle === "Stats Bold") {
                    return (
                      <div className="flex flex-col items-center justify-center rounded-lg bg-black/50 px-2 py-2 backdrop-blur-sm border border-white/10 w-full">
                        <p
                          className={`font-black whitespace-pre-wrap ${valueGradStyle ? '' : 'drop-shadow'}`}
                          style={valueGradStyle
                            ? { fontSize: `${Math.round(13 * textScale)}px`, ...valueGradStyle }
                            : { fontSize: `${Math.round(13 * textScale)}px`, color: card.color }}
                        >
                          {card.value}
                        </p>
                        <p
                          className={`font-medium mt-0.5 text-center whitespace-pre-wrap ${labelGradStyle ? '' : 'text-white/80'}`}
                          style={{ fontSize: scaledDesc, ...(labelGradStyle ?? {}) }}
                        >
                          {renderBoldMarkdown(card.label)}
                        </p>
                      </div>
                    );
                  }
                  // ── Minimal Line ──
                  if (selectedCardStyle === "Minimal Line") {
                    return (
                      <div
                        className="flex items-center gap-2 py-1 px-1 w-full"
                        style={{ borderBottom: `1px solid ${card.color}40` }}
                      >
                        {card.emoji && card.emoji.trim() !== "" && (
                          <span className="text-xs inline-flex items-center">{renderCardIcon(card)}</span>
                        )}
                        <p
                          className={`flex-1 whitespace-pre-wrap ${labelGradStyle ? '' : 'text-white/80'}`}
                          style={{ fontSize: scaledLabel, ...(labelGradStyle ?? {}) }}
                        >
                          {renderBoldMarkdown(card.label)}
                        </p>
                        <p
                          className="font-bold whitespace-pre-wrap"
                          style={valueGradStyle
                            ? { fontSize: scaledValue, ...valueGradStyle }
                            : { fontSize: scaledValue, color: card.color }}
                        >
                          {card.value}
                        </p>
                      </div>
                    );
                  }
                  // ── Text Only (no frame, no icon, no background) ──
                  // Used when the global cardStyle is "Text Only" OR the
                  // individual card has `textOnly=true` (mix-and-match).
                  // Pure typography — label + optional description + optional
                  // value. Editor chrome (dashed click-target border, group
                  // badge) is suppressed by the wrapper logic below.
                  if (selectedCardStyle === "Text Only" || card.textOnly) {
                    return (
                      <div className="flex flex-col items-center justify-center w-full px-2 py-1 text-center">
                        {card.emoji && card.emoji.trim() !== "" && (
                          <span className={`mb-1 inline-flex items-center justify-center ${format === "16:9" ? "text-lg" : "text-base"}`}>
                            {renderCardIcon(card)}
                          </span>
                        )}
                        <p
                          className={`font-bold whitespace-pre-wrap ${labelGradStyle ? '' : 'text-white drop-shadow'}`}
                          style={labelGradStyle
                            ? { fontSize: scaledLabel, ...labelGradStyle }
                            : { fontSize: scaledLabel, color: card.color }}
                        >
                          {renderBoldMarkdown(card.label)}
                        </p>
                        {card.description && (
                          <p
                            className={`leading-snug whitespace-pre-wrap ${descGradStyle ? '' : 'text-white/70'}`}
                            style={{ fontSize: scaledDesc, ...(descGradStyle ?? {}) }}
                          >
                            {renderBoldMarkdown(truncateAtWord(card.description, 120))}
                          </p>
                        )}
                        {card.value && (
                          <p
                            className="font-black mt-0.5 whitespace-pre-wrap"
                            style={valueGradStyle
                              ? { fontSize: scaledValue, ...valueGradStyle }
                              : { fontSize: scaledValue, color: card.color }}
                          >
                            {card.value}
                          </p>
                        )}
                      </div>
                    );
                  }

                  // ── Full Width ──
                  return (
                    <div
                      className="flex items-center gap-2 rounded-lg bg-black/30 px-3 py-1.5 backdrop-blur-sm w-full"
                      style={{ borderLeft: `3px solid ${card.color}` }}
                    >
                      {card.emoji && card.emoji.trim() !== "" && (
                        <span className="text-base inline-flex items-center">{renderCardIcon(card)}</span>
                      )}
                      <div className="flex-1 min-w-0">
                        <p
                          className={labelGradStyle ? 'font-bold whitespace-pre-wrap' : 'font-bold text-white truncate'}
                          style={{ fontSize: scaledLabel, ...(labelGradStyle ?? {}) }}
                        >
                          {renderBoldMarkdown(card.label)}
                        </p>
                        {card.description && (
                          <p
                            className={descGradStyle ? '' : 'text-white/50'}
                            style={{
                              fontSize: scaledDesc,
                              ...(descGradStyle ?? {}),
                              display: '-webkit-box',
                              WebkitBoxOrient: 'vertical',
                              WebkitLineClamp: 2,
                              overflow: 'hidden',
                            }}
                          >
                            {renderBoldMarkdown(truncateAtWord(card.description, 90))}
                          </p>
                        )}
                      </div>
                      <p
                        className="font-black flex-shrink-0 whitespace-pre-wrap"
                        style={valueGradStyle
                          ? { fontSize: scaledValue, ...valueGradStyle }
                          : { fontSize: scaledValue, color: card.color }}
                      >
                        {card.value}
                      </p>
                    </div>
                  );
                };

                const visibleCards = cards.slice(0, format === "16:9" ? 6 : 5);

                // ── FREE mode: each card absolutely positioned, individually draggable ──
                if (cardPositionMode === 'free') {
                  const cols = format === "16:9" ? 3 : 2;
                  // Approximate width for an absolutely-positioned card
                  // (percentage of preview container).
                  const cardWidthPct = cardsSize / cols;
                  return (
                    <div
                      data-cards-grid
                      className="absolute inset-0"
                      style={{ pointerEvents: 'none' }}
                    >
                      {visibleCards.map((card, i) => {
                        // Default position derived from grid index when unset
                        const defaultX = 25 + (i % cols) * 25;
                        const defaultY = 40 + Math.floor(i / cols) * 18;
                        const pos = card.position || { x: defaultX, y: defaultY };
                        const isDragging = dragCardIdx === i;
                        const isSelected = selectedCardIds.has(card.id);
                        const cardGroup = getCardGroupFor(card.id);
                        const accentHex = customAccent || COLOR_THEMES.find((ct) => ct.id === colorTheme)?.accent || '#A855F7';
                        return (
                          <div
                            key={card.id}
                            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOverIconCardIdx(i); }}
                            onDragLeave={() => setDragOverIconCardIdx((cur) => cur === i ? null : cur)}
                            onDrop={handleIconDrop(i)}
                            className={`absolute z-20 select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'} ${activePanel === 'cards' || (selectedEl?.type === 'card' && selectedEl.index === i) ? 'ring-1 ring-pink-400 ring-offset-1 ring-offset-transparent rounded' : ''} ${dragOverIconCardIdx === i ? 'ring-2 ring-pink-500' : ''}`}
                            style={{
                              left: `${pos.x}%`,
                              top: `${pos.y}%`,
                              transform: 'translate(-50%, -50%)',
                              width: `${cardWidthPct}%`,
                              touchAction: 'none',
                              pointerEvents: 'auto',
                              fontFamily: cardsFontFamily,
                              ...(isSelected ? { outline: `2px solid ${accentHex}`, outlineOffset: '2px', borderRadius: '6px' } : {}),
                            }}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              // Shift/Cmd+click toggles selection without starting a drag.
                              if (e.shiftKey || e.metaKey || e.ctrlKey) {
                                toggleCardSelection(card.id, true);
                                return;
                              }
                              // Regular click on an unselected card: clear selection + single-select it.
                              // If the card is ALREADY in the selection (possibly via a group), keep
                              // the selection so grouped drag moves every member.
                              if (!selectedCardIds.has(card.id)) {
                                const grp = getCardGroupFor(card.id);
                                if (grp) {
                                  // Selecting a grouped card picks up every sibling so group
                                  // drag snaps to feel like a single multi-card move.
                                  setSelectedCardIds(new Set(grp.cardIds));
                                } else {
                                  setSelectedCardIds(new Set([card.id]));
                                }
                              }
                              setDragCardIdx(i);
                            }}
                            onTouchStart={(e) => {
                              e.stopPropagation();
                              setDragCardIdx(i);
                            }}
                            onClick={(e) => { e.stopPropagation(); selectEl({ type: 'card', index: i }); }}
                            onDoubleClick={(e) => openPanel('cards', e)}
                            title={`Carte ${i + 1} — glisser pour déplacer, Maj+clic pour sélection multiple`}
                          >
                            {/* Editor click-target hint — hidden for Text Only
                                cards so they look purely typographic. */}
                            {!(selectedCardStyle === "Text Only" || card.textOnly) && (
                              <div className="pointer-events-none absolute inset-0 border border-dashed border-pink-500/30 hover:border-pink-500/60 rounded transition-colors" />
                            )}
                            {renderCardInner(card)}
                            {cardGroup && (
                              <div
                                className="pointer-events-none absolute -top-2 -right-2 w-4 h-4 rounded-full flex items-center justify-center shadow-md border border-white/30"
                                style={{ backgroundColor: cardGroup.color }}
                                title={`Groupe (${cardGroup.cardIds.length} cartes)`}
                              >
                                <Group size={10} strokeWidth={2.5} className="text-white" />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                }

                // ── GRID mode (default, existing behaviour) ──
                return (
                  <div
                    className={`absolute z-20 cursor-grab active:cursor-grabbing group/cards ${activePanel === "cards" || (selectedEl?.type === 'card') ? "ring-1 ring-pink-400 ring-offset-1 ring-offset-transparent rounded" : ""}`}
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
                    onClick={(e) => { e.stopPropagation(); selectEl({ type: 'card', index: 0 }); }}
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
                    {selectedCardStyle !== "Text Only" && (
                      <div className="absolute inset-0 border border-dashed border-pink-500/30 group-hover/cards:border-pink-500/60 rounded pointer-events-none transition-colors" />
                    )}
                    <div
                      className={`grid gap-1.5 w-full ${
                        selectedCardStyle === "Full Width"
                          ? "grid-cols-1"
                          : previewClasses.cols
                      }`}
                      data-cards-grid
                      style={{ fontFamily: cardsFontFamily }}
                    >
                      {visibleCards.map((card, gi) => (
                        <div
                          key={card.id}
                          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOverIconCardIdx(gi); }}
                          onDragLeave={() => setDragOverIconCardIdx((cur) => cur === gi ? null : cur)}
                          onDrop={handleIconDrop(gi)}
                          className={dragOverIconCardIdx === gi ? 'ring-2 ring-pink-500 rounded' : ''}
                        >{renderCardInner(card)}</div>
                      ))}
                    </div>
                  </div>
                );
              })()}

            {/* ── CTA / WATERMARK (visible in all, cta) — drag + double-click for panel ── */}
            {((activeSequence === "all" && exportedSequences.cta) || activeSequence === "cta") && (
              <div
                className={`absolute z-20 text-center cursor-grab active:cursor-grabbing group/cta ${activePanel === "cta" || (selectedEl?.type === 'cta') ? "ring-1 ring-yellow-400 ring-offset-1 ring-offset-transparent rounded" : ""}`}
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
                onClick={(e) => { e.stopPropagation(); selectEl({ type: 'cta' }); }}
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
                {ctaIconName && ICON_MAP[ctaIconName] && (
                  <div className="flex justify-center" style={{ marginBottom: '4px' }}>
                    {renderLucideIcon(ctaIconName, {
                      size: format === "16:9" ? Math.round(ctaIconSize / 2.5) : Math.round(ctaIconSize / 4),
                      color: ctaIconColor || '#FFFFFF',
                      gradient: ctaIconGradient ? { start: ctaIconGradColor1, end: ctaIconGradColor2, direction: 'd' } : undefined,
                      gradientId: `cta-live-${ctaIconName}`,
                    })}
                  </div>
                )}
                {salesPhrases.length > 0 && (
                  <p
                    className={`font-medium whitespace-pre-wrap ${ctaTextGradient ? '' : 'drop-shadow'}`}
                    style={{
                      fontSize: `${(format === "16:9" ? 10 : 8) * ctaTextScale}px`,
                      letterSpacing: `${ctaLetterSpacing}px`,
                      lineHeight: ctaLineHeight,
                      fontWeight: ctaBold ? 900 : 400,
                      fontStyle: ctaItalic ? "italic" : "normal",
                      fontFamily: ctaFont ? (FONT_CSS_MAP[ctaFont] || ctaFont) : undefined,
                      ...(ctaTextGradient ? {
                        backgroundImage: `linear-gradient(135deg, ${ctaGradColor1}, ${ctaGradColor2})`,
                        backgroundColor: 'transparent',
                        WebkitBackgroundClip: 'text',
                        backgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        color: 'transparent',
                        display: 'inline-block',
                      } : { color: `${ctaColor}ee` }),
                    }}
                  >
                    {salesPhrases[0]}
                  </p>
                )}
                <p
                  className={`mt-0.5 font-black uppercase whitespace-pre-wrap ${watermarkTextGradient ? '' : 'drop-shadow-lg'}`}
                  style={{
                    fontSize: `${(format === "16:9" ? 16 : 12) * ctaTextScale}px`,
                    letterSpacing: `${ctaLetterSpacing}px`,
                    lineHeight: ctaLineHeight,
                    fontWeight: ctaBold ? 900 : 400,
                    fontStyle: ctaItalic ? "italic" : "normal",
                    fontFamily: watermarkFont ? (FONT_CSS_MAP[watermarkFont] || watermarkFont) : undefined,
                    ...(watermarkTextGradient ? {
                      backgroundImage: `linear-gradient(135deg, ${watermarkGradColor1}, ${watermarkGradColor2})`,
                      backgroundColor: 'transparent',
                      WebkitBackgroundClip: 'text',
                      backgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      color: 'transparent',
                      display: 'inline-block',
                    } : { color: ctaColor }),
                  }}
                >
                  {ctaMainText || "AFROBOOST"}
                </p>
                <p
                  className={`font-bold mt-1 uppercase whitespace-pre-wrap ${ctaTextGradient ? '' : 'drop-shadow'}`}
                  style={{
                    fontSize: `${(format === "16:9" ? 12 : 9) * ctaTextScale}px`,
                    letterSpacing: `${ctaLetterSpacing}px`,
                    lineHeight: ctaLineHeight,
                    fontWeight: ctaBold ? 900 : 400,
                    fontStyle: ctaItalic ? "italic" : "normal",
                    fontFamily: ctaFont ? (FONT_CSS_MAP[ctaFont] || ctaFont) : undefined,
                    ...(ctaTextGradient ? {
                      backgroundImage: `linear-gradient(135deg, ${ctaGradColor1}, ${ctaGradColor2})`,
                      backgroundColor: 'transparent',
                      WebkitBackgroundClip: 'text',
                      backgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      color: 'transparent',
                      display: 'inline-block',
                    } : { color: ctaSubColor }),
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
                  className={`absolute z-20 cursor-grab active:cursor-grabbing group/logo ${activePanel === "logo" || (selectedEl?.type === 'logo') ? "ring-1 ring-green-400 ring-offset-1 ring-offset-transparent rounded" : ""}`}
                  style={{
                    left: `${logoPos.x}%`,
                    top: `${logoPos.y}%`,
                    transform: `translate(-50%, -50%) scale(${logoScale})`,
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setDragging("logo");
                  }}
                  onClick={(e) => { e.stopPropagation(); selectEl({ type: 'logo' }); }}
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

            {/* Character Image — draggable + resizable */}
            {characterImage &&
              ((activeSequence === "all" && exportedSequences.titre) || activeSequence === "titre") && (
                <div
                  className="absolute z-10 cursor-grab active:cursor-grabbing group/char"
                  style={{
                    left: `${characterPosition.x}%`,
                    top: `${characterPosition.y}%`,
                    transform: `translate(-50%, -50%) scale(${characterScale})`,
                    height: '25%',
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setPanelPos({ x: e.clientX + 10, y: e.clientY - 50 });
                    setActivePanel('character');
                  }}
                  onMouseDown={(e) => {
                    if (e.detail >= 2) return;
                    e.preventDefault();
                    const container = e.currentTarget.parentElement;
                    if (!container) return;
                    const rect = container.getBoundingClientRect();
                    const onMove = (ev: MouseEvent) => {
                      const x = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
                      const y = Math.max(0, Math.min(100, ((ev.clientY - rect.top) / rect.height) * 100));
                      setCharacterPosition({ x, y });
                    };
                    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                  }}
                >
                  <img
                    src={characterImage}
                    alt="Character"
                    className="h-full w-auto rounded"
                    draggable={false}
                  />
                  <button
                    onClick={(e) => { e.stopPropagation(); setCharacterImage(null); setCharacterScale(1); setCharacterPosition({ x: 85, y: 75 }); }}
                    className="absolute -top-2 -right-2 rounded-full bg-red-600 p-0.5 text-white opacity-0 group-hover/char:opacity-100 transition-opacity"
                    title="Supprimer"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
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
            {((activeSequence === "all" && exportedSequences.video) || activeSequence === "video") &&
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

            {/* Title font override */}
            <div className="mt-2 pt-2 border-t border-gray-800">
              <span className="text-[9px] text-gray-500 uppercase">Police</span>
              <select
                value={titleFont || ''}
                onChange={(e) => setTitleFont(e.target.value || undefined)}
                className="w-full mt-1 rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-white focus:border-purple-500 focus:outline-none"
              >
                <option value="">Héritée ({selectedFont})</option>
                {Object.keys(FONT_CSS_MAP).map((f) => (
                  <option key={f} value={f} style={{ fontFamily: FONT_CSS_MAP[f] }}>{f}</option>
                ))}
              </select>
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
            {/* Per-element text gradient on cards */}
            <div className="rounded-lg bg-gray-900/40 backdrop-blur-xl p-2 space-y-1.5 border border-gray-700/60">
              <span className="text-[9px] text-gray-400 uppercase block">Dégradé sur texte</span>
              <div className="flex gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={cardsLabelGradient} onChange={(e) => setCardsLabelGradient(e.target.checked)} className="accent-pink-500" />
                  <span className="text-[9px] text-gray-300">Label</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={cardsValueGradient} onChange={(e) => setCardsValueGradient(e.target.checked)} className="accent-pink-500" />
                  <span className="text-[9px] text-gray-300">Valeur</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={cardsDescriptionGradient} onChange={(e) => setCardsDescriptionGradient(e.target.checked)} className="accent-pink-500" />
                  <span className="text-[9px] text-gray-300">Description</span>
                </label>
              </div>
              {(cardsLabelGradient || cardsValueGradient || cardsDescriptionGradient) && (
                <div className="flex gap-2">
                  <div className="flex-1">
                    <span className="text-[8px] text-gray-500">Couleur 1</span>
                    <input type="color" value={cardsTextGradColor1} onChange={(e) => setCardsTextGradColor1(e.target.value)} className="w-full h-6 rounded cursor-pointer bg-transparent" />
                  </div>
                  <div className="flex-1">
                    <span className="text-[8px] text-gray-500">Couleur 2</span>
                    <input type="color" value={cardsTextGradColor2} onChange={(e) => setCardsTextGradColor2(e.target.value)} className="w-full h-6 rounded cursor-pointer bg-transparent" />
                  </div>
                </div>
              )}
            </div>
            {/* Multi-select actions (free-position mode) */}
            {cardPositionMode === 'free' && (
              <div className="rounded-lg bg-gray-900/40 backdrop-blur-xl p-2 space-y-1.5 border border-gray-700/60">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-gray-400 uppercase">Sélection</span>
                  <span className="text-[10px] font-semibold text-pink-300">
                    {selectedCardIds.size} carte{selectedCardIds.size > 1 ? 's' : ''}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <button
                    onClick={groupSelectedCards}
                    disabled={selectedCardIds.size < 2}
                    className="flex flex-col items-center gap-0.5 rounded-md bg-gray-800 hover:bg-gray-700 px-2 py-1.5 text-[10px] text-gray-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Grouper la sélection (min. 2 cartes)"
                  >
                    <Combine size={14} strokeWidth={2} className="text-blue-400" />
                    <span>Grouper</span>
                  </button>
                  <button
                    onClick={ungroupSelectedCards}
                    disabled={!Array.from(selectedCardIds).some((id) => !!getCardGroupFor(id))}
                    className="flex flex-col items-center gap-0.5 rounded-md bg-gray-800 hover:bg-gray-700 px-2 py-1.5 text-[10px] text-gray-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Dissocier"
                  >
                    <Ungroup size={14} strokeWidth={2} className="text-gray-300" />
                    <span>Dissocier</span>
                  </button>
                  <button
                    onClick={duplicateSelectedCards}
                    disabled={selectedCardIds.size === 0}
                    className="flex flex-col items-center gap-0.5 rounded-md bg-gray-800 hover:bg-gray-700 px-2 py-1.5 text-[10px] text-gray-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Dupliquer la sélection"
                  >
                    <CopyPlus size={14} strokeWidth={2} className="text-green-400" />
                    <span>Dupliquer</span>
                  </button>
                </div>
                <p className="text-[9px] text-gray-500 leading-snug">
                  Maj+clic sur une carte pour la sélection multiple. Glisser sur le fond pour un rectangle. ESC pour désélectionner.
                </p>
              </div>
            )}
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
                min="50"
                max="200"
                step="1"
                value={cardsSize}
                onChange={(e) => setCardsSize(parseInt(e.target.value))}
                className="w-full h-1.5 rounded-lg appearance-none bg-gray-700 accent-pink-500 cursor-pointer mt-1"
              />
            </div>
            <div>
              <span className="text-[9px] text-gray-500 uppercase">
                Taille texte {cardsTextScale}%
              </span>
              <input
                type="range"
                min="50"
                max="200"
                step="5"
                value={cardsTextScale}
                onChange={(e) => setCardsTextScale(parseInt(e.target.value))}
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
            <div className="mt-1 pt-2 border-t border-gray-800">
              <span className="text-[9px] text-gray-500 uppercase">Police cartes</span>
              <select
                value={cardsFont || ''}
                onChange={(e) => setCardsFont(e.target.value || undefined)}
                className="w-full mt-1 rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-white focus:border-pink-500 focus:outline-none"
              >
                <option value="">Héritée ({selectedFont})</option>
                {Object.keys(FONT_CSS_MAP).map((f) => (
                  <option key={f} value={f} style={{ fontFamily: FONT_CSS_MAP[f] }}>{f}</option>
                ))}
              </select>
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
            <div className="rounded-lg bg-gray-900/40 backdrop-blur-xl p-2 space-y-1.5 border border-gray-700/60">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-gray-400 uppercase">Icone SVG</span>
                {ctaIconName && (<button type="button" onClick={() => setCtaIconName(null)} className="text-[9px] text-red-400 hover:text-red-300">Retirer</button>)}
              </div>
              {ctaIconName && (
                <div className="flex items-center gap-2">
                  <div className="h-10 w-10 rounded border border-gray-600 bg-gray-700 flex items-center justify-center flex-shrink-0">
                    {renderLucideIcon(ctaIconName, {
                      size: 24,
                      color: ctaIconColor || '#FFFFFF',
                      gradient: ctaIconGradient ? { start: ctaIconGradColor1, end: ctaIconGradColor2, direction: 'd' } : undefined,
                      gradientId: `cta-prev-${ctaIconName}`,
                    })}
                  </div>
                  <span className="text-[10px] text-gray-300 font-mono">{ctaIconName}</span>
                </div>
              )}
              <input
                type="text"
                placeholder="Rechercher une icône..."
                value={ctaIconSearch}
                onChange={(e) => setCtaIconSearch(e.target.value)}
                className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1 text-[10px] text-white placeholder-gray-500"
              />
              <div className="max-h-[200px] overflow-y-auto rounded border border-gray-700 bg-gray-900/40 p-2 space-y-2">
                {Object.entries(ICON_LIBRARY).map(([category, names]) => {
                  const q = ctaIconSearch.toLowerCase().trim();
                  const filteredNames = q
                    ? names.filter((nm) => {
                        if (nm.toLowerCase().includes(q)) return true;
                        if (category.toLowerCase().includes(q)) return true;
                        const kw = ICON_KEYWORDS[nm];
                        if (kw && kw.some((k: string) => k.includes(q))) return true;
                        return false;
                      })
                    : names;
                  if (filteredNames.length === 0) return null;
                  return (
                    <div key={category}>
                      <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-1">{category}</div>
                      <div className="grid grid-cols-6 gap-1">
                        {filteredNames.map((nm) => {
                          const Icon = ICON_MAP[nm];
                          if (!Icon) return null;
                          const selected = ctaIconName === nm;
                          return (
                            <button
                              key={nm}
                              type="button"
                              onClick={() => setCtaIconName(nm)}
                              className={`h-8 w-8 rounded-lg bg-gray-800 hover:bg-gray-700 hover:scale-110 transition flex items-center justify-center ${selected ? 'ring-2 ring-yellow-500' : ''}`}
                              title={nm}
                            >
                              <Icon size={16} color={ctaIconColor || '#FFFFFF'} />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              {ctaIconName && (<>
                <div>
                  <span className="text-[8px] text-gray-500">Taille ({ctaIconSize}px)</span>
                  <input type="range" min={30} max={120} value={ctaIconSize} onChange={(e) => setCtaIconSize(Number(e.target.value))} className="w-full accent-yellow-500" />
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={ctaIconGradient} onChange={(e) => setCtaIconGradient(e.target.checked)} className="accent-yellow-500" />
                  <span className="text-[9px] text-gray-400 uppercase">Degrade sur icone</span>
                </label>
                {ctaIconGradient ? (
                  <div className="flex gap-2">
                    <div className="flex-1"><span className="text-[8px] text-gray-500">Couleur 1</span><input type="color" value={ctaIconGradColor1} onChange={(e) => setCtaIconGradColor1(e.target.value)} className="w-full h-6 rounded cursor-pointer bg-transparent" /></div>
                    <div className="flex-1"><span className="text-[8px] text-gray-500">Couleur 2</span><input type="color" value={ctaIconGradColor2} onChange={(e) => setCtaIconGradColor2(e.target.value)} className="w-full h-6 rounded cursor-pointer bg-transparent" /></div>
                  </div>
                ) : (
                  <div><span className="text-[8px] text-gray-500">Couleur</span><input type="color" value={ctaIconColor} onChange={(e) => setCtaIconColor(e.target.value)} className="w-full h-6 rounded cursor-pointer bg-transparent" /></div>
                )}
              </>)}
            </div>
            <textarea
              value={ctaMainText}
              onChange={(e) => setCtaMainText(e.target.value)}
              rows={2}
              style={{ resize: 'vertical' }}
              className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-white focus:border-purple-500 focus:outline-none"
              placeholder="Nom de marque (Entrée pour saut de ligne)"
            />
            <div className="flex gap-1">
              <textarea
                value={ctaSubText}
                onChange={(e) => setCtaSubText(e.target.value)}
                rows={2}
                style={{ resize: 'vertical' }}
                className="flex-1 rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-white focus:border-purple-500 focus:outline-none"
                placeholder="Call-to-action (Entrée pour saut de ligne)"
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

            {/* CTA font override (affects the small "CHAT POUR PLUS D'INFOS" sub-text) */}
            <div className="mt-2 pt-2 border-t border-gray-800">
              <span className="text-[9px] text-gray-500 uppercase">Police CTA</span>
              <select
                value={ctaFont || ''}
                onChange={(e) => setCtaFont(e.target.value || undefined)}
                className="w-full mt-1 rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-white focus:border-yellow-500 focus:outline-none"
              >
                <option value="">Héritée ({selectedFont})</option>
                {Object.keys(FONT_CSS_MAP).map((f) => (
                  <option key={f} value={f} style={{ fontFamily: FONT_CSS_MAP[f] }}>{f}</option>
                ))}
              </select>
              <span className="text-[9px] text-gray-500 uppercase block mt-2">Police Watermark</span>
              <select
                value={watermarkFont || ''}
                onChange={(e) => setWatermarkFont(e.target.value || undefined)}
                className="w-full mt-1 rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-white focus:border-yellow-500 focus:outline-none"
              >
                <option value="">Héritée ({selectedFont})</option>
                {Object.keys(FONT_CSS_MAP).map((f) => (
                  <option key={f} value={f} style={{ fontFamily: FONT_CSS_MAP[f] }}>{f}</option>
                ))}
              </select>
            </div>

            {/* CTA sub-text gradient */}
            <div className="mt-2 pt-2 border-t border-gray-800">
              <label className="flex items-center gap-2 cursor-pointer mb-1.5">
                <input type="checkbox" checked={ctaTextGradient} onChange={(e) => setCtaTextGradient(e.target.checked)} className="accent-yellow-500" />
                <span className="text-[9px] text-gray-400 uppercase">Dégradé sur CTA</span>
              </label>
              {ctaTextGradient && (
                <div className="flex gap-2">
                  <div className="flex-1">
                    <span className="text-[8px] text-gray-500">Couleur 1</span>
                    <input type="color" value={ctaGradColor1} onChange={(e) => setCtaGradColor1(e.target.value)} className="w-full h-6 rounded cursor-pointer bg-transparent" />
                  </div>
                  <div className="flex-1">
                    <span className="text-[8px] text-gray-500">Couleur 2</span>
                    <input type="color" value={ctaGradColor2} onChange={(e) => setCtaGradColor2(e.target.value)} className="w-full h-6 rounded cursor-pointer bg-transparent" />
                  </div>
                </div>
              )}
            </div>

            {/* Watermark gradient (big CTA text) */}
            <div className="mt-2 pt-2 border-t border-gray-800">
              <label className="flex items-center gap-2 cursor-pointer mb-1.5">
                <input type="checkbox" checked={watermarkTextGradient} onChange={(e) => setWatermarkTextGradient(e.target.checked)} className="accent-yellow-500" />
                <span className="text-[9px] text-gray-400 uppercase">Dégradé sur Watermark</span>
              </label>
              {watermarkTextGradient && (
                <div className="flex gap-2">
                  <div className="flex-1">
                    <span className="text-[8px] text-gray-500">Couleur 1</span>
                    <input type="color" value={watermarkGradColor1} onChange={(e) => setWatermarkGradColor1(e.target.value)} className="w-full h-6 rounded cursor-pointer bg-transparent" />
                  </div>
                  <div className="flex-1">
                    <span className="text-[8px] text-gray-500">Couleur 2</span>
                    <input type="color" value={watermarkGradColor2} onChange={(e) => setWatermarkGradColor2(e.target.value)} className="w-full h-6 rounded cursor-pointer bg-transparent" />
                  </div>
                </div>
              )}
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

                {/* Rounded-corner card + inner margin — global (every
                    sequence gets the same card frame). Off by default so
                    existing designs render identically. */}
                <div className="pt-2 border-t border-gray-800 space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={backdropRounded}
                      onChange={(e) => setBackdropRounded(e.target.checked)}
                      className="w-4 h-4 accent-purple-500"
                    />
                    <span className="text-[10px] font-semibold text-gray-300 uppercase">
                      Coins arrondis
                    </span>
                  </label>
                  {backdropRounded && (
                    <div>
                      <span className="text-[9px] text-gray-500 uppercase">
                        Rayon {backdropRadius}px
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={backdropRadius}
                        onChange={(e) => setBackdropRadius(parseInt(e.target.value, 10))}
                        className="w-full h-1.5 rounded-lg appearance-none bg-gray-700 accent-purple-500 cursor-pointer mt-1"
                      />
                    </div>
                  )}
                  <div>
                    <span className="text-[9px] text-gray-500 uppercase">
                      Marge intérieure {backdropMargin}%
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={20}
                      step={0.5}
                      value={backdropMargin}
                      onChange={(e) => setBackdropMargin(parseFloat(e.target.value))}
                      className="w-full h-1.5 rounded-lg appearance-none bg-gray-700 accent-purple-500 cursor-pointer mt-1"
                    />
                    <p className="text-[9px] text-gray-500 mt-0.5">0 = plein écran · 5% = effet carte centrée</p>
                  </div>
                </div>
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

        {/* ── Video Overlay Panel — tabs for up to 4 overlays ── */}
        <FloatingPanel
          title="Texte Vidéo"
          icon="🎥"
          isOpen={activePanel === "overlay"}
          onClose={() => setActivePanel(null)}
          initialX={panelPos.x}
          initialY={panelPos.y}
          accentColor="#06B6D4"
        >
          {(() => {
            // activeOverlayIdx === 0 edits the legacy overlay (existing
            // state). idx >= 1 edits extraOverlays[idx - 1].
            const isLegacy = activeOverlayIdx === 0;
            const extraIdx = activeOverlayIdx - 1;
            const extra = !isLegacy ? extraOverlays[extraIdx] : null;

            const updateExtra = (patch: Partial<ExtraOverlay>) => {
              setExtraOverlays((prev) =>
                prev.map((o, i) => (i === extraIdx ? { ...o, ...patch } : o)),
              );
            };

            const handleDuplicate = () => {
              if (extraOverlays.length >= 3) return; // cap at 4 total (1 legacy + 3 extras)
              const newOverlay: ExtraOverlay = isLegacy
                ? {
                    id: `ov-${Date.now()}`,
                    text: videoOverlayText || 'Nouveau texte',
                    position: { x: overlayPos.x + 5, y: overlayPos.y + 8 },
                    color: overlayColor,
                    scale: overlayTextScale,
                    startTime: overlayStartTime,
                    endTime: overlayEndTime,
                    bold: overlayBold,
                    italic: overlayItalic,
                    letterSpacing: overlayLetterSpacing,
                    lineHeight: overlayLineHeight,
                  }
                : {
                    id: `ov-${Date.now()}`,
                    text: extra?.text || 'Nouveau texte',
                    position: { x: (extra?.position.x ?? 50) + 5, y: (extra?.position.y ?? 33) + 8 },
                    color: extra?.color || '#FFFFFF',
                    scale: extra?.scale ?? 1,
                    startTime: extra?.startTime ?? 0,
                    endTime: extra?.endTime ?? -1,
                    bold: extra?.bold ?? true,
                    italic: extra?.italic ?? false,
                    letterSpacing: extra?.letterSpacing ?? 0,
                    lineHeight: extra?.lineHeight ?? 1.2,
                  };
              setExtraOverlays((prev) => [...prev, newOverlay]);
              setActiveOverlayIdx(extraOverlays.length + 1);
            };

            const handleAddBlank = () => {
              if (extraOverlays.length >= 3) return;
              const newOverlay: ExtraOverlay = {
                id: `ov-${Date.now()}`,
                text: '',
                position: { x: 50, y: 55 },
                color: '#FFFFFF',
                scale: 1,
                startTime: 0,
                endTime: -1,
                bold: true,
                italic: false,
                letterSpacing: 0,
                lineHeight: 1.2,
              };
              setExtraOverlays((prev) => [...prev, newOverlay]);
              setActiveOverlayIdx(extraOverlays.length + 1);
            };

            const handleDelete = () => {
              if (isLegacy) {
                setVideoOverlayText('');
                return;
              }
              setExtraOverlays((prev) => prev.filter((_, i) => i !== extraIdx));
              setActiveOverlayIdx(0);
            };

            const totalOverlays = 1 + extraOverlays.length;

            return (
              <div className="space-y-2">
                {/* Tabs */}
                <div className="flex items-center gap-1 pb-1.5 border-b border-gray-700 overflow-x-auto">
                  {Array.from({ length: totalOverlays }, (_, i) => (
                    <button
                      key={i}
                      onClick={() => setActiveOverlayIdx(i)}
                      className={`flex-shrink-0 px-2 py-1 rounded text-[10px] font-semibold transition ${
                        activeOverlayIdx === i
                          ? 'bg-cyan-600 text-white'
                          : 'bg-gray-800 text-gray-400 hover:text-white'
                      }`}
                    >
                      Overlay {i + 1}
                    </button>
                  ))}
                  {totalOverlays < 4 && (
                    <button
                      onClick={handleAddBlank}
                      className="flex-shrink-0 flex items-center gap-0.5 px-2 py-1 rounded text-[10px] font-semibold bg-gray-800 text-cyan-300 hover:text-cyan-200"
                      title="Ajouter un overlay"
                    >
                      <Plus size={10} /> Ajouter
                    </button>
                  )}
                </div>

                {/* Text */}
                <input
                  type="text"
                  value={isLegacy ? videoOverlayText : (extra?.text || '')}
                  onChange={(e) => {
                    if (isLegacy) setVideoOverlayText(e.target.value);
                    else updateExtra({ text: e.target.value });
                  }}
                  className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-white focus:border-purple-500 focus:outline-none"
                  placeholder="Texte affiché sur la vidéo"
                />

                {/* Color */}
                <ColorWheel
                  color={isLegacy ? overlayColor : (extra?.color || '#FFFFFF')}
                  onChange={(c) => {
                    if (isLegacy) setOverlayColor(c);
                    else updateExtra({ color: c });
                  }}
                  label="Couleur"
                />

                {/* Font override — applies to both legacy + extras (single setting per-panel). */}
                <div>
                  <span className="text-[9px] text-gray-500 uppercase">Police</span>
                  <select
                    value={overlayFont || ''}
                    onChange={(e) => setOverlayFont(e.target.value || undefined)}
                    className="w-full mt-1 rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-white focus:border-cyan-500 focus:outline-none"
                  >
                    <option value="">Héritée ({selectedFont})</option>
                    {Object.keys(FONT_CSS_MAP).map((f) => (
                      <option key={f} value={f} style={{ fontFamily: FONT_CSS_MAP[f] }}>{f}</option>
                    ))}
                  </select>
                </div>

                {/* Text gradient toggle (legacy overlay only — extras inherit) */}
                {isLegacy && (
                  <div className="pt-1 border-t border-gray-800">
                    <label className="flex items-center gap-2 cursor-pointer mb-1.5">
                      <input
                        type="checkbox"
                        checked={overlayTextGradient}
                        onChange={(e) => setOverlayTextGradient(e.target.checked)}
                        className="accent-cyan-500"
                      />
                      <span className="text-[9px] text-gray-400 uppercase">Texte en dégradé</span>
                    </label>
                    {overlayTextGradient && (
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <span className="text-[8px] text-gray-500">Couleur 1</span>
                          <input type="color" value={overlayGradColor1} onChange={(e) => setOverlayGradColor1(e.target.value)} className="w-full h-6 rounded cursor-pointer bg-transparent" />
                        </div>
                        <div className="flex-1">
                          <span className="text-[8px] text-gray-500">Couleur 2</span>
                          <input type="color" value={overlayGradColor2} onChange={(e) => setOverlayGradColor2(e.target.value)} className="w-full h-6 rounded cursor-pointer bg-transparent" />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {isLegacy && (
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
                    {isGeneratingOverlay ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                    Générer par IA
                  </button>
                )}

                {/* Typography B / I */}
                <div className="flex gap-1 mt-1">
                  <button
                    onClick={() => {
                      if (isLegacy) setOverlayBold(!overlayBold);
                      else updateExtra({ bold: !(extra?.bold ?? true) });
                    }}
                    className={`px-2 py-1 rounded text-[10px] font-bold transition-all ${(isLegacy ? overlayBold : extra?.bold ?? true) ? "bg-cyan-600 text-white" : "bg-gray-800 text-gray-400"}`}
                  >
                    B
                  </button>
                  <button
                    onClick={() => {
                      if (isLegacy) setOverlayItalic(!overlayItalic);
                      else updateExtra({ italic: !(extra?.italic ?? false) });
                    }}
                    className={`px-2 py-1 rounded text-[10px] italic transition-all ${(isLegacy ? overlayItalic : extra?.italic ?? false) ? "bg-cyan-600 text-white" : "bg-gray-800 text-gray-400"}`}
                  >
                    I
                  </button>
                </div>

                {/* Letter spacing */}
                <div>
                  <span className="text-[9px] text-gray-500 uppercase">
                    Espacement {(isLegacy ? overlayLetterSpacing : extra?.letterSpacing ?? 0)}px
                  </span>
                  <input
                    type="range"
                    min="-2"
                    max="15"
                    step="0.5"
                    value={isLegacy ? overlayLetterSpacing : extra?.letterSpacing ?? 0}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (isLegacy) setOverlayLetterSpacing(v);
                      else updateExtra({ letterSpacing: v });
                    }}
                    className="w-full h-1.5 rounded-lg appearance-none bg-gray-700 accent-cyan-500 cursor-pointer mt-1"
                  />
                </div>

                {/* Line height */}
                <div>
                  <span className="text-[9px] text-gray-500 uppercase">
                    Interligne {(isLegacy ? overlayLineHeight : extra?.lineHeight ?? 1.2).toFixed(1)}
                  </span>
                  <input
                    type="range"
                    min="0.8"
                    max="2.5"
                    step="0.1"
                    value={isLegacy ? overlayLineHeight : extra?.lineHeight ?? 1.2}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (isLegacy) setOverlayLineHeight(v);
                      else updateExtra({ lineHeight: v });
                    }}
                    className="w-full h-1.5 rounded-lg appearance-none bg-gray-700 accent-cyan-500 cursor-pointer mt-1"
                  />
                </div>

                {/* Text scale */}
                <div>
                  <span className="text-[9px] text-gray-500 uppercase">
                    Taille {Math.round((isLegacy ? overlayTextScale : extra?.scale ?? 1) * 100)}%
                  </span>
                  <input
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.05"
                    value={isLegacy ? overlayTextScale : extra?.scale ?? 1}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (isLegacy) setOverlayTextScale(v);
                      else updateExtra({ scale: v });
                    }}
                    className="w-full h-1.5 rounded-lg appearance-none bg-gray-700 accent-cyan-500 cursor-pointer mt-1"
                  />
                </div>

                {/* Timing */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[9px] text-gray-500 uppercase">Apparaît à (s)</span>
                    <input
                      type="number"
                      min={0}
                      max={videoDuration}
                      step={0.5}
                      value={isLegacy ? overlayStartTime : extra?.startTime ?? 0}
                      onChange={(e) => {
                        const v = Math.max(0, parseFloat(e.target.value) || 0);
                        if (isLegacy) setOverlayStartTime(v);
                        else updateExtra({ startTime: v });
                      }}
                      className="w-full mt-1 rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-white focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <span className="text-[9px] text-gray-500 uppercase">Disparaît à (s)</span>
                    <input
                      type="number"
                      min={-1}
                      max={videoDuration}
                      step={0.5}
                      value={isLegacy ? overlayEndTime : extra?.endTime ?? -1}
                      onChange={(e) => {
                        const raw = parseFloat(e.target.value);
                        const v = isNaN(raw) ? -1 : raw;
                        if (isLegacy) setOverlayEndTime(v);
                        else updateExtra({ endTime: v });
                      }}
                      className="w-full mt-1 rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-white focus:border-cyan-500 focus:outline-none"
                      title="-1 = jusqu'à la fin de la séquence vidéo"
                    />
                  </div>
                </div>

                {/* Duplicate + Delete */}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    onClick={handleDuplicate}
                    disabled={extraOverlays.length >= 3}
                    className="flex items-center justify-center gap-1 rounded bg-gray-800 hover:bg-gray-700 px-2 py-1.5 text-[10px] font-medium text-gray-200 transition disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Dupliquer l'overlay actif"
                  >
                    <CopyIcon size={14} strokeWidth={2} /> Dupliquer
                  </button>
                  <button
                    onClick={handleDelete}
                    className="flex items-center justify-center gap-1 rounded bg-red-900/40 hover:bg-red-900/60 px-2 py-1.5 text-[10px] font-medium text-red-200 transition"
                    title={isLegacy ? "Effacer le texte" : "Supprimer cet overlay"}
                  >
                    <Trash2 size={14} strokeWidth={2} /> Supprimer
                  </button>
                </div>
              </div>
            );
          })()}
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

        {/* Character FloatingPanel — opened by double-clicking character image */}
        <FloatingPanel
          title="Personnage"
          icon="👤"
          isOpen={activePanel === 'character'}
          onClose={() => setActivePanel(null)}
          initialX={panelPos.x}
          initialY={panelPos.y}
          accentColor="#EC4899"
        >
          <div className="space-y-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1">Taille</div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0.3}
                  max={2.5}
                  step={0.05}
                  value={characterScale}
                  onChange={(e) => setCharacterScale(Number(e.target.value))}
                  className="flex-1 accent-pink-500"
                />
                <span className="text-xs text-gray-300 w-10 text-right">{Math.round(characterScale * 100)}%</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setCharacterPosition({ x: 85, y: 75 })}
                className="flex-1 rounded bg-gray-800 px-2 py-1.5 text-[10px] text-gray-300 hover:bg-gray-700 transition"
              >
                ↺ Réinitialiser
              </button>
              <button
                onClick={() => { setCharacterImage(null); setCharacterScale(1); setCharacterPosition({ x: 85, y: 75 }); setActivePanel(null); }}
                className="flex-1 rounded bg-red-600/20 px-2 py-1.5 text-[10px] text-red-400 hover:bg-red-600/40 transition"
              >
                Supprimer
              </button>
            </div>
          </div>
        </FloatingPanel>

        {/* Background FloatingPanel — per-sequence color control */}
        <FloatingPanel
          title="Arrière-plan"
          icon="🎨"
          isOpen={activePanel === 'background'}
          onClose={() => setActivePanel(null)}
          initialX={panelPos.x}
          initialY={panelPos.y}
          accentColor="#7C3AED"
        >
          {(() => {
            const seq = activeSequence === 'all' ? 'titre' : activeSequence;
            const isNoColor = noColorSequences.includes(seq);
            const currentGrad = getSeqGradient(seq);
            return (
              <div className="space-y-3">
                <div className="text-[10px] text-gray-400">
                  Séquence : <span className="text-white font-medium capitalize">{activeSequence === 'all' ? 'Toutes' : activeSequence}</span>
                </div>

                {/* No-color toggle */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-300">Sans couleur de fond</span>
                  <button
                    onClick={() => {
                      setNoColorUserOverride((prev) => ({ ...prev, [seq]: true }));
                      if (syncColorsGlobal) {
                        if (isNoColor) setNoColorSequences([]);
                        else setNoColorSequences(['titre', 'cartes', 'video', 'cta']);
                      } else {
                        if (isNoColor) setNoColorSequences(noColorSequences.filter((s) => s !== seq));
                        else setNoColorSequences([...noColorSequences, seq]);
                      }
                    }}
                    className={`relative w-9 h-5 rounded-full transition-colors ${isNoColor ? 'bg-purple-600' : 'bg-gray-700'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${isNoColor ? 'translate-x-4' : ''}`} />
                  </button>
                </div>

                {/* Color picker */}
                {!isNoColor && (
                  <ColorWheel
                    color={colorTheme === 'custom' ? customAccent : gradientColor1}
                    onChange={(c) => {
                      setColorTheme('custom');
                      setCustomAccent(c);
                      setNoColorBg(false);
                    }}
                    label="Couleur de fond"
                  />
                )}

                {/* Gradient overlay controls */}
                <div className="border-t border-gray-700 pt-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2">
                    Dégradé superposé
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer mb-2">
                    <input
                      type="checkbox"
                      checked={currentGrad.enabled}
                      onChange={(e) => setSeqGradients({ ...seqGradients, [seq]: { ...seqGradients[seq], enabled: e.target.checked } })}
                      className="w-3.5 h-3.5 accent-purple-500"
                    />
                    <span className="text-[10px] text-gray-300">Activer</span>
                  </label>
                  {currentGrad.enabled && (
                    <div className="space-y-2">
                      <select
                        value={currentGrad.position}
                        onChange={(e) => setSeqGradients({ ...seqGradients, [seq]: { ...seqGradients[seq], position: e.target.value as any } })}
                        className="w-full px-2 py-1.5 bg-gray-700 text-gray-100 rounded text-[9px] border border-gray-600 focus:border-purple-500 focus:outline-none"
                      >
                        <option value="top">Haut</option>
                        <option value="bottom">Bas</option>
                        <option value="both">Haut + Bas</option>
                        <option value="left">Gauche</option>
                        <option value="right">Droite</option>
                      </select>
                      <ColorWheel
                        color={currentGrad.color1}
                        onChange={(c) => setSeqGradients({ ...seqGradients, [seq]: { ...seqGradients[seq], color1: c } })}
                        label="Couleur 1"
                      />
                      <ColorWheel
                        color={currentGrad.color2}
                        onChange={(c) => setSeqGradients({ ...seqGradients, [seq]: { ...seqGradients[seq], color2: c } })}
                        label="Couleur 2"
                      />
                      <div>
                        <span className="text-[9px] text-gray-500">Intensité {Math.round(currentGrad.opacity * 100)}%</span>
                        <input
                          type="range"
                          min="0"
                          max="2.0"
                          step="0.05"
                          value={currentGrad.opacity}
                          onChange={(e) => setSeqGradients({ ...seqGradients, [seq]: { ...seqGradients[seq], opacity: parseFloat(e.target.value) } })}
                          className="w-full h-1.5 rounded-lg appearance-none bg-gray-700 accent-purple-500 cursor-pointer mt-1"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </FloatingPanel>

        {/* ── Per-sequence background panels (Phase 1+2) ──
             Double-clicking the preview while a sequence is active opens
             one of these. Image + opacity + CSS filter adjustments + AI tools. */}
        {(['titre', 'cartes', 'video', 'cta'] as const).map((seqKey) => {
          const SEQ_LABELS_MAP: Record<typeof seqKey, string> = { titre: 'Titre', cartes: 'Cartes', video: 'Vidéo', cta: 'CTA' };
          const SEQ_ICONS_MAP: Record<typeof seqKey, string> = { titre: '📝', cartes: '🃏', video: '🎬', cta: '🎯' };
          const cfg = sequenceBackgrounds[seqKey];
          const updateCfg = (patch: Partial<SequenceBackgroundConfig>) => {
            setSequenceBackgrounds((prev) => {
              const current = prev[seqKey] ?? { url: null, opacity: 1 };
              const next = { ...current, ...patch };
              // Treat the all-defaults state as "null" for cleaner persistence
              const isDefault = next.url === null && next.opacity === 1 && !next.filters && !next.objectPosition;
              return { ...prev, [seqKey]: isDefault ? null : next };
            });
          };
          const handleUploadFile = async (file: File) => {
            try {
              const res = await fetch('/api/upload/signed-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: `bg-${seqKey}-${Date.now()}-${file.name}`, contentType: file.type, purpose: 'bg' }),
              });
              const data = await res.json();
              if (!res.ok || !data.success || !data.signedUrl || !data.publicUrl) {
                throw new Error(data.error || `Signed URL: HTTP ${res.status}`);
              }
              const putRes = await fetch(data.signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
              if (!putRes.ok) throw new Error(`Upload: HTTP ${putRes.status}`);
              const headRes = await fetch(data.publicUrl, { method: 'HEAD' });
              if (!headRes.ok) throw new Error(`Vérification HEAD: HTTP ${headRes.status}`);
              updateCfg({ url: data.publicUrl });
              showToast(`✓ Image fond ${SEQ_LABELS_MAP[seqKey]} uploadée`, 'success');
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'erreur inconnue';
              console.error('[BgPanel] upload failed:', err);
              showToast(`Échec upload fond ${SEQ_LABELS_MAP[seqKey]} : ${msg}`, 'error');
            }
          };
          return (
            <FloatingPanel
              key={seqKey}
              title={`Fond ${SEQ_LABELS_MAP[seqKey]}`}
              icon={SEQ_ICONS_MAP[seqKey]}
              isOpen={activePanel === `background-${seqKey}`}
              onClose={() => setActivePanel(null)}
              initialX={panelPos.x}
              initialY={panelPos.y}
              accentColor="#7C3AED"
            >
              <ImageEditorPanel
                seqKey={seqKey}
                config={cfg}
                onUpdate={updateCfg}
                onUploadFile={handleUploadFile}
                showToast={showToast}
              />
            </FloatingPanel>
          );
        })}

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

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* Collapsible Export Bar — right edge, collapsed by default   */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="hidden lg:flex fixed right-2 top-1/2 -translate-y-1/2 z-40 flex-col items-center gap-1.5">
        {/* Collapsed: just the export button + credits */}
        {!showExportPanel && (
          <div className="flex flex-col items-center gap-1 bg-gray-900/80 backdrop-blur-sm border border-gray-700/50 rounded-xl p-1.5 shadow-2xl">
            <span className="text-[8px] font-bold uppercase leading-none tracking-wide text-gray-300">Export</span>
            <button
              onClick={() => setShowExportPanel(true)}
              className="flex items-center justify-center rounded-lg bg-gradient-to-b from-purple-600 to-pink-600 h-11 w-11 text-white hover:from-purple-700 hover:to-pink-700 shadow-lg shadow-purple-500/25 transition-all"
              title="Ouvrir les options d'export"
            >
              <Download size={18} strokeWidth={2} />
            </button>
            <span className="text-[9px] text-yellow-400 font-bold leading-none">
              {(exportFormat === 'video' ? 25 : 5) * batchCount}cr
            </span>
          </div>
        )}

        {/* Expanded: full export panel */}
        {showExportPanel && (
          <div className="flex flex-col items-center gap-1.5 bg-gray-900/80 backdrop-blur-sm border border-gray-700/50 rounded-xl p-1.5 shadow-2xl animate-in slide-in-from-right-2 duration-200">
            {/* Close button */}
            <button
              onClick={() => setShowExportPanel(false)}
              className="text-gray-500 hover:text-white transition-colors self-end -mr-0.5 -mt-0.5"
              title="Fermer"
            >
              <X size={12} />
            </button>
            <span className="text-[8px] font-bold uppercase tracking-wider text-gray-500 leading-none">Format</span>
            {isExporting && (
              <div className="h-10 w-0.5 bg-gray-800 rounded-full overflow-hidden">
                <div className="w-full bg-gradient-to-b from-purple-500 to-pink-500 transition-all duration-300" style={{ height: `${exportProgress}%` }} />
              </div>
            )}
            {/* Format selector — MP4 / JPG / PNG */}
            {([
              { key: 'video' as const, Icon: Video, label: 'MP4', tip: 'Vidéo MP4' },
              { key: 'jpeg' as const, Icon: ImageIcon, label: 'JPG', tip: 'Image JPG (compressée)' },
              { key: 'png' as const, Icon: ImageIcon, label: 'PNG', tip: 'Image PNG (sans perte)' },
            ]).map(({ key, Icon, label, tip }) => (
              <button key={key} onClick={() => setExportFormat(key)} title={tip}
                className={`h-7 w-9 rounded-md flex items-center justify-center gap-0.5 transition-all flex-shrink-0 ${
                  exportFormat === key ? 'bg-purple-600 text-white ring-1 ring-purple-300' : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                <Icon size={9} />
                <span className="text-[8px] font-bold leading-none">{label}</span>
              </button>
            ))}
            <div className="h-px w-7 bg-gray-700/50" />
            {(exportFormat === 'video'
              ? [
                  { key: 'draft' as Destination, Icon: Calendar, color: '#3B82F6', tip: 'Calendrier' },
                  { key: 'export' as Destination, Icon: Download, color: '#10B981', tip: 'Fichier' },
                  { key: 'both' as Destination, Icon: Layers, color: '#A855F7', tip: 'Les deux' },
                  { key: 'audio-studio' as Destination, Icon: Music, color: '#EC4899', tip: 'Studio Son' },
                ]
              : [
                  { key: 'export' as Destination, Icon: Download, color: '#10B981', tip: 'Fichier (Bureau)' },
                ]).map(({ key, Icon, color, tip }) => (
              <button key={key} onClick={() => setDestination(key)} title={tip}
                className={`h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-all ${
                  destination === key ? 'ring-2 ring-white/40 scale-105' : 'opacity-60 hover:opacity-100'
                }`}
                style={{ backgroundColor: `${color}20`, color }}
              >
                <Icon size={16} fill="currentColor" strokeWidth={1.5} />
              </button>
            ))}
            {(destination === 'draft' || destination === 'both') && (
              <>
                <div className="h-px w-7 bg-gray-700/50" />
                <span className="text-[8px] font-bold uppercase tracking-wider text-gray-500 leading-none">Publier</span>
                {(['instagram', 'facebook', 'tiktok', 'youtube'] as const).map((p) => (
                  <PlatformIcon
                    key={p}
                    platform={p}
                    size="sm"
                    isActive={selectedPublishPlatforms.includes(p)}
                    onClick={() => togglePublishPlatform(p)}
                  />
                ))}
              </>
            )}
            <div className="h-px w-7 bg-gray-700/50" />
            <button onClick={handleExport} disabled={isExporting || cards.length === 0}
              className="flex items-center justify-center rounded-lg bg-gradient-to-b from-purple-600 to-pink-600 h-10 w-10 text-white hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-purple-500/25 transition-all"
              title={isExporting ? `${exportProgress}%` : batchCount > 1 ? `Export x${batchCount}` : 'Export Création'}
            >
              {isExporting
                ? <Loader2 size={16} className="animate-spin" />
                : <Zap size={16} fill="currentColor" strokeWidth={1.5} />}
            </button>
            <span className="text-[9px] text-yellow-400 font-bold leading-none">
              {isExporting
                ? `${exportProgress}%`
                : `${(exportFormat === 'video' ? 25 : 5) * batchCount}cr`}
            </span>
            <div className="h-px w-7 bg-gray-700/50" />
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-[7px] uppercase tracking-wider text-gray-500">Batch</span>
              <div className="flex items-center gap-px">
                <button onClick={() => setBatchCount(Math.max(1, batchCount - 1))} disabled={batchCount <= 1}
                  className="h-5 w-5 rounded text-[10px] font-bold text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30 transition">−</button>
                <span className="text-[10px] font-bold text-purple-400 w-5 text-center">x{batchCount}</span>
                <button onClick={() => setBatchCount(Math.min(20, batchCount + 1))} disabled={batchCount >= 20}
                  className="h-5 w-5 rounded text-[10px] font-bold text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30 transition">+</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* Mobile Horizontal Export Bar — bottom of viewport on <lg     */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="flex lg:hidden fixed bottom-0 left-0 right-0 z-40 items-center justify-between gap-1.5 bg-gray-900/95 backdrop-blur-sm border-t border-gray-700/50 px-2 py-1.5 shadow-2xl overflow-x-auto scrollbar-hide">
        {isExporting && (
          <div className="absolute top-0 left-0 h-0.5 bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300" style={{ width: `${exportProgress}%` }} />
        )}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Format pill — MP4 / JPG / PNG */}
          <div className="flex items-center gap-px rounded-md bg-gray-800/80 p-0.5 mr-1">
            {([
              { key: 'video' as const, label: 'MP4' },
              { key: 'jpeg' as const, label: 'JPG' },
              { key: 'png' as const, label: 'PNG' },
            ]).map(({ key, label }) => (
              <button key={key} onClick={() => setExportFormat(key)}
                className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition ${
                  exportFormat === key ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >{label}</button>
            ))}
          </div>
          {(exportFormat === 'video'
            ? [
                { key: 'draft' as Destination, Icon: Calendar, color: '#3B82F6' },
                { key: 'export' as Destination, Icon: Download, color: '#10B981' },
                { key: 'both' as Destination, Icon: Layers, color: '#A855F7' },
                { key: 'audio-studio' as Destination, Icon: Music, color: '#EC4899' },
              ]
            : [
                { key: 'export' as Destination, Icon: Download, color: '#10B981' },
              ]).map(({ key, Icon, color }) => (
            <button key={key} onClick={() => setDestination(key)}
              className={`h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-all ${
                destination === key ? 'ring-2 ring-white/40 scale-105' : 'opacity-60'
              }`}
              style={{ backgroundColor: `${color}20`, color }}
            >
              <Icon size={16} fill="currentColor" strokeWidth={1.5} />
            </button>
          ))}
          {(destination === 'draft' || destination === 'both') && (
            <div className="flex items-center gap-1 pl-1 ml-1 border-l border-gray-700/50">
              {(['instagram', 'facebook', 'tiktok', 'youtube'] as const).map((p) => (
                <PlatformIcon
                  key={p}
                  platform={p}
                  size="sm"
                  isActive={selectedPublishPlatforms.includes(p)}
                  onClick={() => togglePublishPlatform(p)}
                />
              ))}
            </div>
          )}
        </div>
        {/* Batch pill — compact, inline */}
        <div className="flex items-center gap-0.5 rounded-full bg-gray-800 px-1.5 py-0.5 flex-shrink-0" title="Nombre de variations à générer">
          <button
            onClick={() => setBatchCount(Math.max(1, batchCount - 1))}
            disabled={batchCount <= 1}
            className="h-6 w-6 rounded-full text-xs font-bold text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30 transition flex items-center justify-center"
          >−</button>
          <span className="text-[11px] font-bold text-purple-400 w-7 text-center">x{batchCount}</span>
          <button
            onClick={() => setBatchCount(Math.min(10, batchCount + 1))}
            disabled={batchCount >= 10}
            className="h-6 w-6 rounded-full text-xs font-bold text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30 transition flex items-center justify-center"
          >+</button>
        </div>
        <button onClick={handleExport} disabled={isExporting || cards.length === 0}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 h-10 px-4 text-white text-xs font-bold hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 shadow-lg shadow-purple-500/25 flex-shrink-0"
        >
          {isExporting
            ? <><Loader2 size={14} className="animate-spin" />{exportProgress}%</>
            : <><Zap size={14} fill="currentColor" />Export {batchCount > 1 ? `x${batchCount}` : ''}</>}
        </button>
        <span className="text-[10px] text-yellow-400 font-bold whitespace-nowrap flex-shrink-0">
          {(exportFormat === 'video' ? 25 : 5) * batchCount}cr
        </span>
      </div>

      <Modal
        isOpen={clipModalOpen}
        onClose={closeClipModal}
        title="Analyser les meilleurs cuts"
        size="xl"
      >
        {clipAnalyzing ? (
          <div className="py-8">
            <p className="mb-3 text-sm text-gray-300">{clipStage}</p>
            <div className="h-2 w-full overflow-hidden rounded bg-gray-800">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all"
                style={{ width: `${clipProgress}%` }}
              />
            </div>
            <p className="mt-2 text-right text-xs text-gray-500">
              {clipProgress}%
            </p>
          </div>
        ) : clipExtracting ? (
          <div className="py-8">
            <p className="mb-3 text-sm text-gray-300">{clipExtractStage}</p>
            <div className="h-2 w-full overflow-hidden rounded bg-gray-800">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all"
                style={{ width: `${clipExtractProgress}%` }}
              />
            </div>
            <p className="mt-2 text-right text-xs text-gray-500">
              {clipExtractProgress}%
            </p>
          </div>
        ) : detectedClips.length === 0 ? (
          <div>
            <p className="py-6 text-center text-sm text-gray-400">
              Aucune séquence détectée dans cette vidéo.
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-gray-800 pt-4">
              <button
                onClick={keepOriginalRush}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 transition hover:border-gray-500 hover:text-white"
              >
                Garder l'original
              </button>
            </div>
          </div>
        ) : (() => {
          const activeClip =
            detectedClips.find((c) => c.id === previewClipId) ??
            detectedClips[0];
          const trim = clipTrims[activeClip.id];
          const effStart = trim?.startTime ?? activeClip.startTime;
          const effEnd = trim?.endTime ?? activeClip.endTime;
          const effDur = effEnd - effStart;
          const trimmed = !!trim;
          return (
            <div>
              {/* Selection counter */}
              <div className="mb-2 flex items-center justify-between text-sm">
                <p className="text-gray-400">
                  {detectedClips.length} séquence
                  {detectedClips.length > 1 ? "s" : ""} détectée
                  {detectedClips.length > 1 ? "s" : ""} par l'IA
                </p>
                <p className="font-semibold text-purple-300">
                  {selectedClipIds.size} / {detectedClips.length} sélectionnée
                  {selectedClipIds.size > 1 ? "s" : ""}
                </p>
              </div>
              {/* Horizontal thumbnail strip */}
              <div className="mb-3 flex gap-2 overflow-x-auto pb-2">
                {detectedClips.map((clip) => {
                  const sel = selectedClipIds.has(clip.id);
                  const isActive = clip.id === activeClip.id;
                  return (
                    <button
                      key={clip.id}
                      onClick={() => {
                        setPreviewClipId(clip.id);
                        toggleClipSelection(clip.id);
                        pausePreview();
                      }}
                      className={`group relative shrink-0 overflow-hidden rounded-lg border-2 transition ${
                        isActive
                          ? "border-purple-400 ring-2 ring-purple-400/40"
                          : sel
                            ? "border-purple-500/60"
                            : "border-gray-700 opacity-60 hover:opacity-100"
                      }`}
                      style={{ width: 120, aspectRatio: "16/9" }}
                      title={clip.label}
                    >
                      <img
                        src={clip.thumbnailUrl}
                        alt={clip.label}
                        className="h-full w-full object-cover"
                      />
                      <div
                        className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded border"
                        style={{
                          borderColor: sel ? "#A855F7" : "#9CA3AF",
                          background: sel ? "#A855F7" : "rgba(0,0,0,0.5)",
                        }}
                      >
                        {sel && <Check size={10} className="text-white" />}
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 truncate bg-black/70 px-1 py-0.5 text-[10px] text-white">
                        {clip.label}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Main video player */}
              <div className="rounded-lg border border-purple-500/40 bg-gray-900 p-3">
                <video
                  ref={previewVideoRef}
                  src={previewUrlRef.current ?? undefined}
                  muted
                  playsInline
                  className="w-full rounded bg-black"
                  style={{ maxHeight: 320 }}
                />

                {/* Dual-handle trim slider */}
                <div className="mt-3">
                  <div
                    className="relative h-8"
                    style={{
                      // range track area
                    }}
                  >
                    {/* Filled selection band */}
                    <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded bg-gray-700" />
                    <div
                      className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded bg-gradient-to-r from-purple-500 to-pink-500"
                      style={{
                        left: `${
                          ((effStart - activeClip.startTime) /
                            Math.max(0.001, activeClip.endTime - activeClip.startTime)) *
                          100
                        }%`,
                        right: `${
                          (1 -
                            (effEnd - activeClip.startTime) /
                              Math.max(0.001, activeClip.endTime - activeClip.startTime)) *
                          100
                        }%`,
                      }}
                    />
                    <input
                      type="range"
                      min={activeClip.startTime}
                      max={activeClip.endTime}
                      step={0.1}
                      value={effStart}
                      onChange={(ev) => {
                        const v = parseFloat(ev.target.value);
                        setClipTrims((prev) => {
                          const curr = prev[activeClip.id] ?? {
                            startTime: activeClip.startTime,
                            endTime: activeClip.endTime,
                          };
                          const clamped = Math.min(
                            Math.max(v, activeClip.startTime),
                            curr.endTime - 0.5,
                          );
                          return {
                            ...prev,
                            [activeClip.id]: { ...curr, startTime: clamped },
                          };
                        });
                        if (previewVideoRef.current) {
                          try {
                            previewVideoRef.current.currentTime = v;
                          } catch {}
                        }
                      }}
                      className="range-dual pointer-events-auto absolute left-0 right-0 top-0 h-8 w-full appearance-none bg-transparent accent-purple-500"
                      style={{ zIndex: 2 }}
                    />
                    <input
                      type="range"
                      min={activeClip.startTime}
                      max={activeClip.endTime}
                      step={0.1}
                      value={effEnd}
                      onChange={(ev) => {
                        const v = parseFloat(ev.target.value);
                        setClipTrims((prev) => {
                          const curr = prev[activeClip.id] ?? {
                            startTime: activeClip.startTime,
                            endTime: activeClip.endTime,
                          };
                          const clamped = Math.max(
                            Math.min(v, activeClip.endTime),
                            curr.startTime + 0.5,
                          );
                          return {
                            ...prev,
                            [activeClip.id]: { ...curr, endTime: clamped },
                          };
                        });
                      }}
                      className="range-dual pointer-events-auto absolute left-0 right-0 top-0 h-8 w-full appearance-none bg-transparent accent-pink-500"
                      style={{ zIndex: 3 }}
                    />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] font-mono text-gray-400">
                    <span>{effStart.toFixed(1)}s</span>
                    <span>{effEnd.toFixed(1)}s</span>
                  </div>
                </div>

                {/* Controls row */}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => playPreview(activeClip)}
                      className="rounded bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700"
                    >
                      ▶ Lire la sélection
                    </button>
                    <button
                      onClick={pausePreview}
                      className="rounded bg-gray-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-600"
                    >
                      ⏸ Pause
                    </button>
                    {trimmed && (
                      <button
                        onClick={() => resetClipTrim(activeClip.id)}
                        className="rounded bg-gray-700/60 px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700"
                      >
                        Réinitialiser
                      </button>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-white">
                      {effDur.toFixed(1)}s
                    </div>
                    <div className="text-[10px] text-gray-500">
                      {trimmed ? "coupée" : "durée"} · score {activeClip.score}
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-gray-800 pt-4">
                <button
                  onClick={keepOriginalRush}
                  className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 transition hover:border-gray-500 hover:text-white"
                >
                  Garder l'original
                </button>
                <button
                  onClick={confirmClipExtraction}
                  disabled={selectedClipIds.size === 0}
                  className="rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Extraire {selectedClipIds.size > 0 ? `(${selectedClipIds.size})` : ""}
                </button>
              </div>
            </div>
          );
        })()}
      </Modal>
      <BuyCreditsModal isOpen={showBuyCreditsModal} onClose={() => setShowBuyCreditsModal(false)} />
      <MediaLibrary
        isOpen={mediaLibOpen}
        onClose={() => setMediaLibOpen(false)}
        mediaType={mediaLibTarget === 'rush' ? 'all' : 'image'}
        onSelect={(url, name, type) => {
          if (mediaLibTarget === 'logo') {
            setLogoImage(url);
          } else {
            const kind: 'video' | 'image' = type === 'image' ? 'image' : 'video';
            setRushList((prev) => [...prev, { url, name, kind, transform: undefined }]);
            setRushUrl(url);
            setRushFileName(name);
          }
        }}
      />
      <CropRushModal
        isOpen={cropRushIdx !== null}
        onClose={() => setCropRushIdx(null)}
        rush={cropRushIdx !== null ? rushList[cropRushIdx] ?? null : null}
        format={format}
        onApply={(t) => {
          setRushList((list) =>
            list.map((r, i) => (i === cropRushIdx ? { ...r, transform: t } : r)),
          );
          setCropRushIdx(null);
        }}
      />
      <AgentIAModal
        isOpen={agentIAOpen}
        onClose={() => setAgentIAOpen(false)}
      />
      </div>
    </div>
  );
}

export default function InfographicPage() {
  return (
    <Suspense fallback={<div className="p-6 text-gray-400">Chargement...</div>}>
      <InfographicPageInner />
    </Suspense>
  );
}
