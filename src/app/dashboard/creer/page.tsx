"use client";

import { useState, useEffect, useCallback, useRef, Suspense, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
import { useSession } from "next-auth/react";
import { BuyCreditsModal } from "@/components/billing/BuyCreditsModal";
import { MediaLibrary } from "@/components/shared/MediaLibrary";
// ExportBar removed — using inline export button that respects destination selection
import { BrandingIndicator } from "@/components/shared/BrandingIndicator";
import { useBranding } from "@/lib/hooks/useBranding";
import { useAgentIAEnabled } from "@/lib/hooks/useAgentIAEnabled";
import { AudioStudioPanel } from "@/components/creer/AudioStudioPanel";
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
                        className={`h-10 w-10 rounded-lg bg-gray-800 hover:bg-gray-700 hover:scale-110 transition flex items-center justify-center ${selected ? 'ring-2 ring-purple-500' : ''}`}
                        title={name}
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
            <input
              type="text"
              value={card.label}
              onChange={(e) => update(card.id, { label: e.target.value })}
              className="w-full mt-1 rounded border border-gray-600 bg-gray-700 px-2 py-1 text-xs text-white focus:border-purple-500 focus:outline-none"
              placeholder="Titre de la carte"
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
            <input
              type="text"
              value={card.value}
              onChange={(e) => update(card.id, { value: e.target.value })}
              maxLength={12}
              className="w-full mt-1 rounded border border-gray-600 bg-gray-700 px-2 py-1 text-xs font-bold text-white focus:border-purple-500 focus:outline-none"
              placeholder="ex: +30%"
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

/** Migrate a legacy card (emoji-mode) to SVG-mode. Idempotent. */
function migrateCardToSvg<T extends Partial<InfoCard> & { iconType?: string; emoji?: string; icon?: string }>(card: T): T {
  if (card.iconType === 'svg') return card;
  // Some legacy shapes used "icon" instead of "emoji"
  const sourceName = card.emoji || (card as any).icon || '';
  return {
    ...card,
    iconType: 'svg' as const,
    emoji: toLucideName(sourceName),
    iconColor: (card as any).iconColor || '#FFFFFF',
    iconSize: (card as any).iconSize || 32,
    iconStyle: (card as any).iconStyle || 'outline',
  } as T;
}

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
  const [audioMusicUrl, setAudioMusicUrl] = useState<string | null>(null);
  const [audioMusicName, setAudioMusicName] = useState('');
  const [audioVoiceUrl, setAudioVoiceUrl] = useState<string | null>(null);
  const [audioVoiceName, setAudioVoiceName] = useState('');
  const [audioMusicVolume, setAudioMusicVolume] = useState(0.5);
  const [audioVoiceVolume, setAudioVoiceVolume] = useState(1.0);

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
    setRushUrl((p) => (p === nextUrl ? p : nextUrl));
    setRushFileName((p) => (p === nextName ? p : nextName));
  }, [rushList]);

  // ── Video Overlay Text ─────────────────────────────────────
  const [videoOverlayText, setVideoOverlayText] = useState("");
  const [isGeneratingOverlay, setIsGeneratingOverlay] = useState(false);

  // ── Pexels Photos ───────────────────────────────────────────
  const [pexelsPhotos, setPexelsPhotos] = useState<PexelsPhoto[]>([]);
  const [pexelsLoading, setPexelsLoading] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
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
        if (cfg.exportedSequences && typeof cfg.exportedSequences === "object") {
          setExportedSequences((prev) => ({ ...prev, ...cfg.exportedSequences }));
        }
        if (Array.isArray(cfg.rushList) && cfg.rushList.length > 0) {
          // New multi-rush format
          setRushList(
            cfg.rushList
              .filter((r: unknown): r is { url: string; name: string } =>
                !!r && typeof (r as { url?: unknown }).url === "string",
              )
              .map((r: { url: string; name?: string; kind?: 'video' | 'image'; transform?: { scale: number; offsetX: number; offsetY: number }; fromClip?: boolean }) => ({
                url: r.url,
                name: r.name || "video.mp4",
                kind: r.kind,
                transform: r.transform,
                fromClip: r.fromClip,
              })),
          );
        } else if (cfg.rushUrl) {
          // Legacy single-rush format — upgrade to list
          setRushList([
            { url: cfg.rushUrl, name: cfg.rushFileName || "video.mp4" },
          ]);
        }
        if (cfg.characterImage) setCharacterImage(cfg.characterImage);
        if (cfg.characterScale !== undefined) setCharacterScale(cfg.characterScale);
        if (cfg.characterPosition) setCharacterPosition(cfg.characterPosition);
        if (cfg.audioMusicUrl) setAudioMusicUrl(cfg.audioMusicUrl);
        if (cfg.audioMusicName) setAudioMusicName(cfg.audioMusicName);
        if (cfg.audioVoiceUrl) setAudioVoiceUrl(cfg.audioVoiceUrl);
        if (cfg.audioVoiceName) setAudioVoiceName(cfg.audioVoiceName);
        if (cfg.audioMusicVolume !== undefined) setAudioMusicVolume(cfg.audioMusicVolume);
        if (cfg.audioVoiceVolume !== undefined) setAudioVoiceVolume(cfg.audioVoiceVolume);
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
        if (cfg.cards && cfg.cards.length > 0) setCards(cfg.cards.map((c: any) => migrateCardToSvg(c)));
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
        if (typeof cfg.showCenterGuides === 'boolean') setShowCenterGuides(cfg.showCenterGuides);
        if (cfg.cardPositionMode === 'grid' || cfg.cardPositionMode === 'free') setCardPositionMode(cfg.cardPositionMode);
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
      } catch (err) {
        console.error('[Deeplink] Error fetching post:', err);
      }
    })();
    return () => { cancelled = true; };
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

  // ── Card position mode: 'grid' (default) uses the grid layout, 'free'
  // allows each card to be dragged independently using its `position` field.
  const [cardPositionMode, setCardPositionMode] = useState<'grid' | 'free'>('grid');
  // Index of the card being dragged in free mode (null when not dragging).
  const [dragCardIdx, setDragCardIdx] = useState<number | null>(null);

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

  // ── Sauvegarde config à chaque changement — seulement APRÈS le chargement initial ──
  // (Placé après TOUTES les déclarations useState pour éviter les erreurs de zone morte temporelle)
  useEffect(() => {
    if (!configLoaded) return;
    try {
      localStorage.setItem(
        INFOGRAPHIC_CONFIG_KEY,
        JSON.stringify({
          colorTheme, format, introDuration, cardsDuration, videoDuration, ctaDuration, exportedSequences,
          rushUrl, rushFileName, rushList, characterImage,
          titleLetterSpacing, titleLineHeight, titleBold, titleItalic,
          ctaLetterSpacing, ctaLineHeight, ctaBold, ctaItalic,
          overlayLetterSpacing, overlayLineHeight, overlayBold, overlayItalic, overlayColor, cardsLetterSpacing,
          selectedFont, selectedFilter, selectedCardStyle,
          titleColor, ctaColor, ctaSubColor, ctaMainText, ctaSubText,
          titleTextGradient, titleGradColor1, titleGradColor2,
          titleDuplicate, titleDuplicateOffset, titleDuplicateOpacity,
          gradientColor1, gradientColor2, gradientOpacity, autoGradient, noColorBg, noColorSequences, noColorUserOverride, syncColorsGlobal, seqGradients,
          textScale, ctaTextScale, cardsTextScale, logoScale, logoSequences, logoImage, customAccent, customCardIcons,
          titlePos, logoPositions, watermarkPos, cardsPos, overlayPos,
          titleSize, cardsSize, watermarkSize,
          title, subtitle, videoOverlayText, cards, salesPhrases, contentTheme, customTopic,
          photoSearchQuery, selectedPhotoIndex,
          siteText, siteTextPositions, siteTextSize, siteTextColor, siteTextOpacity, siteTextSequences, siteTextEnabled,
          showCenterGuides,
          cardPositionMode,
          characterScale, characterPosition,
          audioMusicUrl, audioMusicName, audioVoiceUrl, audioVoiceName, audioMusicVolume, audioVoiceVolume,
        }),
      );
    } catch { /* ignore */ }
  }, [
    configLoaded, colorTheme, format, introDuration, cardsDuration, videoDuration, ctaDuration, exportedSequences,
    rushUrl, rushFileName, rushList, characterImage, characterScale, characterPosition,
    titleLetterSpacing, titleLineHeight, titleBold, titleItalic,
    ctaLetterSpacing, ctaLineHeight, ctaBold, ctaItalic,
    overlayLetterSpacing, overlayLineHeight, overlayBold, overlayItalic, cardsLetterSpacing,
    selectedFont, selectedFilter, selectedCardStyle,
    titleColor, ctaColor, ctaSubColor, ctaMainText, ctaSubText,
    titleTextGradient, titleGradColor1, titleGradColor2,
    titleDuplicate, titleDuplicateOffset, titleDuplicateOpacity,
    gradientColor1, gradientColor2, gradientOpacity, noColorBg, noColorSequences, noColorUserOverride, syncColorsGlobal, seqGradients,
    textScale, ctaTextScale, cardsTextScale, logoScale, logoSequences, logoImage, customAccent, customCardIcons,
    titlePos, logoPositions, watermarkPos, cardsPos, overlayPos,
    titleSize, cardsSize, watermarkSize,
    title, subtitle, videoOverlayText, cards, salesPhrases, contentTheme, customTopic,
    photoSearchQuery, selectedPhotoIndex,
    siteText, siteTextPositions, siteTextSize, siteTextColor, siteTextOpacity, siteTextSequences, siteTextEnabled,
    showCenterGuides,
    cardPositionMode,
    characterScale, characterPosition,
    audioMusicUrl, audioMusicName, audioVoiceUrl, audioVoiceName, audioMusicVolume, audioVoiceVolume,
  ]);

  // (Typography states declared earlier for localStorage compatibility)

  // (Settings panel removed — controls live in the Canva sidebar rail)

  // Floating panels — which element panel is open
  const [activePanel, setActivePanel] = useState<
    "title" | "cards" | "cta" | "overlay" | "gradient" | "logo" | "sitetext" | "add" | "character" | "background" | null
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

  const [aiFieldLoading, setAiFieldLoading] = useState<string | null>(null);

  const suggestField = async (fieldType: string, setter: (v: string) => void) => {
    setAiFieldLoading(fieldType);
    try {
      const res = await fetch('/api/content/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: contentTheme || 'fitness', fieldType }),
      });
      const data = await res.json();
      if (data.success && data.text) setter(data.text);
    } catch {} finally { setAiFieldLoading(null); }
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
        setRushList((prev) => [...prev, ...uploaded]);
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
      ];
      // Helper: fetch fresh AI-generated content for the SAME theme but a
      // DIFFERENT angle each iteration, so each batch video carries its own
      // title / subtitle / cards. Falls back to the local generator if AI
      // fails. Returns null if both fail (caller keeps the editor's values).
      const generateBatchVariation = async (batchIndex: number): Promise<{ title: string; subtitle: string; cards: typeof cards; salesPhrases: string[] } | null> => {
        const themeObj = CONTENT_THEMES.find((t) => t.id === contentTheme);
        const topicText = contentTheme === "personnalise" ? customTopic : themeObj?.label || contentTheme;
        if (!topicText.trim()) return null;
        const accent = COLOR_THEMES.find((ct) => ct.id === colorTheme)?.accent || customAccent || "#a855f7";
        const angle = ANGLES[(batchIndex - 1) % ANGLES.length];
        // The topic itself stays clean; angle is injected as a prompt suffix
        // and the variationNonce goes in its own field so the server can
        // thread it into the prompt without polluting the topic string.
        const aiTopic = `${topicText} (angle: ${angle})`;
        const variationNonce = `${batchIndex}-${Date.now().toString(36)}`;
        // AI first
        try {
          const r = await fetch("/api/content/ai-generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              topic: aiTopic,
              locale: "fr",
              cardCount: 3,
              variationNonce,
            }),
          });
          if (r.ok) {
            const d = await r.json();
            if (d.success && d.content) {
              console.log('[Batch variation] batchIndex:', batchIndex, 'cards count:', (d.content.cards || []).length, 'card labels:', (d.content.cards || []).map((c: any) => c.label));
              return {
                title: d.content.title || topicText.toUpperCase(),
                subtitle: d.content.subtitle || "",
                cards: (d.content.cards || []).map((c: any, i: number) => {
                  const resolved = resolveCardIcon(c.label, c.description, c.iconName || "Sparkles");
                  return {
                    id: `batch-${Date.now()}-${i}`,
                    emoji: resolved.emoji,
                    label: c.label || "",
                    value: c.value || "",
                    description: c.description || "",
                    color: accent,
                    iconType: resolved.iconType,
                    iconColor: '#FFFFFF',
                    iconSize: 32,
                    iconStyle: 'outline' as const,
                  };
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
          const r = await fetch("/api/content/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ topic: topicText, batchIndex }),
          });
          if (r.ok) {
            const d = await r.json();
            if (d.success && d.content) {
              console.log('[Batch variation local] batchIndex:', batchIndex, 'cards count:', (d.content.cards || []).length, 'card labels:', (d.content.cards || []).map((c: any) => c.title));
              return {
                title: d.content.tagLine || topicText.toUpperCase(),
                subtitle: d.content.subtitle || "",
                cards: (d.content.cards || []).slice(0, 3).map((c: any, i: number) => {
                  const resolved = resolveCardIcon(c.title, c.description, toLucideName(c.icon));
                  return {
                    id: `batch-${Date.now()}-${i}`,
                    emoji: resolved.emoji,
                    label: c.title || "",
                    value: c.value || "",
                    description: c.description || "",
                    color: accent,
                    iconType: resolved.iconType,
                    iconColor: '#FFFFFF',
                    iconSize: 32,
                    iconStyle: 'outline' as const,
                  };
                }),
                salesPhrases: [],
              };
            }
          }
        } catch (err) {
          console.warn(`[BatchVariation #${batchIndex}] Local fallback failed:`, err);
        }
        return null;
      };

      for (let b = 0; b < total; b++) {
        setExportProgress(Math.round((b / total) * 100));

        // Per-batch content. b=0 keeps the editor's current values so the
        // user's manual edits ship with the first video. b>0 fetches a
        // fresh variation on the same theme — different cards/title/sub.
        let bTitle = title;
        let bSubtitle = subtitle;
        let bCards = cards;
        let bSalesPhrases = salesPhrases;
        if (b > 0) {
          const variation = await generateBatchVariation(b);
          if (variation) {
            bTitle = variation.title;
            bSubtitle = variation.subtitle;
            bCards = variation.cards;
            if (variation.salesPhrases.length > 0) bSalesPhrases = variation.salesPhrases;
            console.log('[Batch export] b:', b, 'bCards labels:', bCards.map((c) => c.label));
          } else {
            console.warn(`[BatchVariation #${b}] no variation returned — video will reuse the editor's current title/cards.`);
          }
        }
        console.log(`[Batch #${b}/${total - 1}] bTitle="${bTitle}" bSubtitle="${bSubtitle}" cardLabels=${JSON.stringify(bCards.map((c) => c.label))}`);

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
            // "all" or "cartes" — if the user switched to another tab before
            // clicking export, the node is absent and html2canvas captures
            // nothing. Force the preview to the cards sequence around the
            // capture, then restore whatever the user had selected.
            //
            // CRUCIAL for batch exports: only snapshot on iteration b === 0.
            // The DOM element renders the React `cards` state, not `bCards`
            // (the per-iteration variation), so capturing on b>0 would paste
            // iteration 0's cards onto every subsequent video. Skipping the
            // snapshot forces the composer's manual Canvas 2D renderer to
            // draw `bCards` directly, giving each iteration its own cards.
            let cardsSnapshot: HTMLImageElement | undefined;
            let cardsSnapshotRect: { x: number; y: number; width: number; height: number } | undefined;
            const prevSequenceCal = activeSequence;
            let didForceSequenceCal = false;
            const canSnapshotCards = b === 0;
            if (canSnapshotCards && exportedSequences.cartes && bCards.length > 0 && activeSequence !== 'cartes' && activeSequence !== 'all') {
              setActiveSequence('cartes');
              didForceSequenceCal = true;
              // Wait two frames so React commits the DOM mount before capture.
              await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
            }
            try {
              const cardsEl = canSnapshotCards ? document.querySelector('[data-cards-grid]') as HTMLElement | null : null;
              if (!canSnapshotCards) {
                console.log(`[Batch #${b}] Skipping cards snapshot — composer will render bCards directly.`);
              } else {
                console.log('[Export] cardsEl offsetWidth/Height:', cardsEl?.offsetWidth, cardsEl?.offsetHeight);
              }
              if (cardsEl && cardsEl.offsetWidth > 0 && exportedSequences.cartes && bCards.length > 0) {
                const html2canvas = (await import('html2canvas')).default;
                // Scale the capture so 1 DOM px = 1 video-canvas px. The
                // snapshot's intrinsic size then matches the cards' target
                // render size, and the composer can blit it at natural size.
                const videoW = isReel ? 1080 : 1920;
                const previewW = previewRef.current?.offsetWidth || (isReel ? 320 : 512);
                const scale = videoW / previewW;
                const canvas = await html2canvas(cardsEl, { backgroundColor: null, scale, logging: false });
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
              } else if (canSnapshotCards && exportedSequences.cartes && bCards.length > 0) {
                console.warn('[Export] Cards grid element missing or zero-sized after forced sequence switch — using manual canvas fallback.');
              }
            } catch (err) {
              console.warn('[Export] Cards snapshot failed, composer will use canvas fallback:', err);
            } finally {
              if (didForceSequenceCal) {
                setActiveSequence(prevSequenceCal);
              }
            }
            // eslint-disable-next-line no-console
            console.log('[Export PRE-COMPOSE site=Calendar] cardsSnapshot truthy?', !!cardsSnapshot, 'value:', cardsSnapshot);
            console.log('[Batch compose] b:', b, 'cards passed to composer:', bCards.map((c) => c.label));
            const { url: composedUrl, thumbnailUrl: composedThumbUrl, composerVersion: composedVersion } = await composeAndUpload({
              width: isReel ? 1080 : 1920,
              height: isReel ? 1920 : 1080,
              fps: 30,
              watermark: useWatermark,
              title: bTitle || "Infographie",
              subtitle: bSubtitle || undefined,
              salesPhrase: salesPhrase || undefined,
              cards: bCards.length > 0 && exportedSequences.cartes
                ? await preRenderCardIcons(bCards).then(rendered => rendered.map((c) => ({ emoji: c.emoji, label: c.label, value: c.value, description: c.description, color: c.color, position: c.position, iconImage: (c as any).iconImage })))
                : undefined,
              posterUrl: posterUrl,
              videoUrl: exportedSequences.video && rushList[0]?.kind !== 'image' ? (rushUrl || undefined) : undefined,
              videoImageUrl: exportedSequences.video && rushList[0]?.kind === 'image' ? (rushUrl || undefined) : undefined,
              rushTransform: rushList[0]?.transform,
              logoUrl: logoImage || null,
              musicUrl: audioMusicUrl || undefined,
              voiceUrl: audioVoiceUrl || undefined,
              musicVolume: audioMusicVolume,
              voiceVolume: audioVoiceVolume,
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
                borderEnabled: branding.borderEnabled,
                borderColor: branding.borderColor,
                cardsSnapshot,
                cardsSnapshotRect,
                logoPosition: getActiveLogoPos(),
                logoPositions, cardsSize,
                logoScale, logoSequences,
                overlayText: videoOverlayText || undefined,
                overlayColor: overlayColor || undefined,
                titlePosition: titlePos, cardsPosition: cardsPos,
                watermarkPosition: watermarkPos, overlayPosition: overlayPos,
                titleSize, watermarkSize: watermarkSize,
                titleTypography: {
                  letterSpacing: titleLetterSpacing, lineHeight: titleLineHeight,
                  bold: titleBold, italic: titleItalic,
                  textGradient: titleTextGradient, gradColor1: titleGradColor1, gradColor2: titleGradColor2,
                  duplicate: titleDuplicate, duplicateOffset: titleDuplicateOffset, duplicateOpacity: titleDuplicateOpacity,
                },
                ctaTypography: { letterSpacing: ctaLetterSpacing, lineHeight: ctaLineHeight, bold: ctaBold, italic: ctaItalic },
                overlayTypography: { letterSpacing: overlayLetterSpacing, lineHeight: overlayLineHeight, bold: overlayBold, italic: overlayItalic },
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
              platforms: [],
              scheduled_date: scheduledDate,
              scheduled_time: "12:00",
              status: "draft",
              metadata: {
                type: "infographic",
                subtitle: bSubtitle,
                videoOverlayText: videoOverlayText || undefined,
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
                musicUrl: audioMusicUrl || undefined,
                voiceUrl: audioVoiceUrl || undefined,
                hasAudio: !!(audioMusicUrl || audioVoiceUrl),
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
                  },
                  overlayColor,
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
          // See comment on the sibling `exportAccent` above — we prefer the
          // live gradient color over the (possibly stale) color-theme lookup.
          const exportAccent =
            customAccent || gradientColor1 || COLOR_THEMES.find((ct) => ct.id === colorTheme)?.accent || "#a855f7";
          const isReel = format === "9:16";
          const exportPhoto = pexelsPhotos.length > 0 ? pexelsPhotos[0] : null;
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
              const html2canvas = (await import('html2canvas')).default;
              // Scale the capture so 1 DOM px = 1 video-canvas px. The
              // snapshot's intrinsic size then matches the cards' target
              // render size, and the composer can blit it at natural size.
              const videoW = isReel ? 1080 : 1920;
              const previewW = previewRef.current?.offsetWidth || (isReel ? 320 : 512);
              const scale = videoW / previewW;
              const canvas = await html2canvas(cardsEl, { backgroundColor: null, scale, logging: false });
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
          const composedResult = await composeAndUpload({
            width: isReel ? 1080 : 1920,
            height: isReel ? 1920 : 1080,
            fps: 30,
            watermark: useWatermark,
            title: title || "Infographie",
            subtitle: subtitle || undefined,
            salesPhrase: salesPhrases.length > 0 ? salesPhrases[0] : undefined,
            cards: cards.length > 0 && exportedSequences.cartes
              ? await preRenderCardIcons(cards).then(rendered => rendered.map((c) => ({ emoji: c.emoji, label: c.label, value: c.value, color: c.color, position: c.position, iconImage: (c as any).iconImage })))
              : undefined,
            posterUrl: exportPosterUrl,
            videoUrl: exportedSequences.video && rushList[0]?.kind !== 'image' ? rushUrl : undefined,
            videoImageUrl: exportedSequences.video && rushList[0]?.kind === 'image' ? rushUrl : undefined,
            rushTransform: rushList[0]?.transform,
            logoUrl: logoImage || null,
            musicUrl: audioMusicUrl || undefined,
            voiceUrl: audioVoiceUrl || undefined,
            musicVolume: audioMusicVolume,
            voiceVolume: audioVoiceVolume,
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
              overlayColor: overlayColor || undefined,
              noColorBg, noColorSequences,
              seqGradients,
              filter: selectedFilter || undefined,
              borderEnabled: branding.borderEnabled,
              borderColor: branding.borderColor,
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
            await fetch('/api/credits/deduct', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ cost, reason: 'render', format: renderFormat }),
            }).catch(() => {});
          }
        } catch (e) {
          console.warn('[Export Bureau] Erreur:', e);
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
                      'studiio_infographic_config',
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
                  {pexelsPhotos.map((photo, i) => (
                    <button
                      key={photo.id}
                      onClick={() => setSelectedPhotoIndex(selectedPhotoIndex === i ? -1 : i)}
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
                              <input type="text" value={card.label} onChange={(e) => updateCard(card.id, "label", e.target.value)}
                                className="flex-1 min-w-0 rounded border border-gray-600 bg-gray-700 px-2 py-1 text-xs font-bold text-white focus:border-purple-500 focus:outline-none" placeholder="Label" />
                              <input type="text" value={card.value} onChange={(e) => updateCard(card.id, "value", e.target.value)}
                                className="w-14 rounded border border-gray-600 bg-gray-700 px-2 py-1 text-xs font-bold text-purple-400 focus:border-purple-500 focus:outline-none" placeholder="Val" />
                            </div>
                            <input type="text" value={card.description} onChange={(e) => updateCard(card.id, "description", e.target.value)}
                              className="w-full rounded border border-gray-600 bg-gray-700 px-2 py-1 text-xs text-gray-300 focus:border-purple-500 focus:outline-none" placeholder="Description courte" />
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
              if (isPlaying) { stopPlayback(); setActiveSequence('all'); }
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

          {/* Guides toggle — center lines + rule of thirds */}
          <button
            onClick={() => {
              const anyOn = showCenterGuides || showThirdsGuides;
              setShowCenterGuides(!anyOn);
              setShowThirdsGuides(!anyOn);
            }}
            title={showCenterGuides ? "Masquer les guides" : "Afficher les guides"}
            className={`flex items-center gap-2 rounded-2xl pl-1 pr-3 py-1 text-xs font-medium transition-all ${
              showCenterGuides || showThirdsGuides
                ? "bg-gray-800/80 text-white shadow-lg shadow-black/20"
                : "bg-gray-900/60 text-gray-300 hover:bg-gray-800/80 hover:text-white"
            }`}
          >
            <IconBadge Icon={Crosshair} color="purple" active={showCenterGuides || showThirdsGuides} size={36} iconSize={18} />
            Guides
          </button>

          {/* Card position mode toggle */}
          <button
            onClick={() => setCardPositionMode((m) => (m === 'grid' ? 'free' : 'grid'))}
            title={cardPositionMode === 'grid' ? "Mode libre" : "Mode grille"}
            className={`flex items-center gap-2 rounded-2xl pl-1 pr-3 py-1 text-xs font-medium transition-all ${
              cardPositionMode === 'free'
                ? "bg-gray-800/80 text-white shadow-lg shadow-black/20"
                : "bg-gray-900/60 text-gray-300 hover:bg-gray-800/80 hover:text-white"
            }`}
          >
            <IconBadge
              Icon={cardPositionMode === 'grid' ? Grid3x3 : Move}
              color={cardPositionMode === 'grid' ? 'slate' : 'orange'}
              active={cardPositionMode === 'free'}
              size={36}
              iconSize={18}
            />
            {cardPositionMode === 'grid' ? 'Grille' : 'Libre'}
          </button>
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
                openPanel('background', e);
              }
            }}
            data-preview-bg
            className={`${previewClasses.aspect} relative flex flex-col items-center justify-between rounded-lg p-4 shadow-2xl overflow-hidden transition-all duration-300`}
            style={{
              fontFamily: FONT_CSS_MAP[selectedFont] || "inherit",
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
              // Free-mode card dragging — each card moved independently
              if (dragCardIdx !== null) {
                const x = Math.max(
                  0,
                  Math.min(100, ((e.clientX - rect.left) / rect.width) * 100),
                );
                const y = Math.max(
                  0,
                  Math.min(100, ((e.clientY - rect.top) / rect.height) * 100),
                );
                setCards((prev) => {
                  if (dragCardIdx >= prev.length) return prev;
                  const next = prev.slice();
                  next[dragCardIdx] = { ...next[dragCardIdx], position: { x, y } };
                  return next;
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
              setDragCardIdx(null);
              resizeStart.current = null;
            }}
            onMouseLeave={() => {
              setDragging(null);
              setResizing(null);
              setDragCardIdx(null);
              resizeStart.current = null;
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

            {/* Background Photo */}
            {previewPhoto &&
              (activeSequence === "all" || activeSequence === "titre") && (
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

            {/* Video background (uploaded video or still image) — visible during the video sequence */}
            {rushUrl &&
              (activeSequence === "all" || activeSequence === "video") && (
                rushList[0]?.kind === 'image' ? (
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
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <video
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
                    onError={(e) => {
                      (e.target as HTMLVideoElement).style.display = "none";
                    }}
                  />
                )
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
                  className={`absolute z-20 text-center cursor-grab active:cursor-grabbing group/overlay ${activePanel === "overlay" || (selectedEl?.type === 'overlay') ? "ring-1 ring-cyan-400 ring-offset-1 ring-offset-transparent rounded" : ""}`}
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
                  onClick={(e) => { e.stopPropagation(); selectEl({ type: 'overlay' }); }}
                  onDoubleClick={(e) => openPanel("overlay", e)}
                >
                  <div className="absolute inset-0 border border-dashed border-cyan-500/0 group-hover/overlay:border-cyan-500/40 rounded pointer-events-none transition-colors" />
                  <p
                    className="font-black drop-shadow-lg"
                    style={{
                      fontSize: `${16 * textScale}px`,
                      color: overlayColor,
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

            {/* ── CARDS (visible in all, cartes) — grid or free-positioning mode ── */}
            {(activeSequence === "all" || activeSequence === "cartes") &&
              cards.length > 0 && (() => {
                const cardsK = (cardsTextScale || 100) / 100;
                const scaledLabel = `${Math.round(7 * textScale * cardsK)}px`;
                const scaledValue = `${Math.round(9 * textScale * cardsK)}px`;
                const scaledDesc = `${Math.round(6 * textScale * cardsK)}px`;
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
                          className="text-center font-bold text-white drop-shadow"
                          style={{ fontSize: scaledLabel }}
                        >
                          {renderBoldMarkdown(card.label)}
                        </p>
                        <p
                          className="text-center font-black drop-shadow"
                          style={{ fontSize: scaledValue, color: card.color }}
                        >
                          {card.value}
                        </p>
                        {card.description && (
                          <p
                            className="text-center text-white/60"
                            style={{ fontSize: scaledDesc }}
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
                            className="font-bold text-white"
                            style={{ fontSize: scaledLabel }}
                          >
                            {renderBoldMarkdown(card.label)}
                          </p>
                        </div>
                        <p
                          className="text-white/70 leading-relaxed mb-1"
                          style={{ fontSize: scaledDesc }}
                        >
                          {renderBoldMarkdown(truncateAtWord(card.description, 90))}
                        </p>
                        <p
                          className="font-black"
                          style={{ fontSize: scaledValue, color: card.color }}
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
                          className="text-white/80 flex-1"
                          style={{ fontSize: scaledLabel }}
                        >
                          {renderBoldMarkdown(card.label)}
                        </p>
                        <p
                          className="font-bold"
                          style={{ fontSize: scaledValue, color: card.color }}
                        >
                          {card.value}
                        </p>
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
                          className="font-bold text-white truncate"
                          style={{ fontSize: scaledLabel }}
                        >
                          {renderBoldMarkdown(card.label)}
                        </p>
                        {card.description && (
                          <p
                            className="text-white/50"
                            style={{
                              fontSize: scaledDesc,
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
                        className="font-black flex-shrink-0"
                        style={{ fontSize: scaledValue, color: card.color }}
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
                        return (
                          <div
                            key={card.id}
                            className={`absolute z-20 select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'} ${activePanel === 'cards' || (selectedEl?.type === 'card' && selectedEl.index === i) ? 'ring-1 ring-pink-400 ring-offset-1 ring-offset-transparent rounded' : ''}`}
                            style={{
                              left: `${pos.x}%`,
                              top: `${pos.y}%`,
                              transform: 'translate(-50%, -50%)',
                              width: `${cardWidthPct}%`,
                              touchAction: 'none',
                              // Re-enable events on the card itself — the parent
                              // wrapper sets pointerEvents:'none' so the preview
                              // background stays double-clickable, but each card
                              // must still receive drag/click events.
                              pointerEvents: 'auto',
                            }}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDragCardIdx(i);
                            }}
                            onTouchStart={(e) => {
                              e.stopPropagation();
                              setDragCardIdx(i);
                            }}
                            onClick={(e) => { e.stopPropagation(); selectEl({ type: 'card', index: i }); }}
                            onDoubleClick={(e) => openPanel('cards', e)}
                            title={`Carte ${i + 1} — glisser pour déplacer`}
                          >
                            <div className="pointer-events-none absolute inset-0 border border-dashed border-pink-500/30 hover:border-pink-500/60 rounded transition-colors" />
                            {renderCardInner(card)}
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
                    <div className="absolute inset-0 border border-dashed border-pink-500/30 group-hover/cards:border-pink-500/60 rounded pointer-events-none transition-colors" />
                    <div
                      className={`grid gap-1.5 w-full ${
                        selectedCardStyle === "Full Width"
                          ? "grid-cols-1"
                          : previewClasses.cols
                      }`}
                      data-cards-grid
                    >
                      {visibleCards.map((card) => (
                        <div key={card.id}>{renderCardInner(card)}</div>
                      ))}
                    </div>
                  </div>
                );
              })()}

            {/* ── CTA / WATERMARK (visible in all, cta) — drag + double-click for panel ── */}
            {(activeSequence === "all" || activeSequence === "cta") && (
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
              (activeSequence === "all" || activeSequence === "titre") && (
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
            <ColorWheel color={overlayColor} onChange={setOverlayColor} label="Couleur" />
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
      {/* Compact Vertical Export Bar — right edge of preview area    */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="hidden lg:flex fixed right-2 top-1/2 -translate-y-1/2 z-40 flex-col items-center gap-1.5 bg-gray-900/80 backdrop-blur-sm border border-gray-700/50 rounded-xl p-1.5 shadow-2xl">
        <span className="text-[8px] font-bold uppercase tracking-wider text-gray-500 leading-none">Export</span>
        {isExporting && (
          <div className="h-10 w-0.5 bg-gray-800 rounded-full overflow-hidden">
            <div className="w-full bg-gradient-to-b from-purple-500 to-pink-500 transition-all duration-300" style={{ height: `${exportProgress}%` }} />
          </div>
        )}
        {([
          { key: 'draft' as Destination, Icon: Calendar, color: '#3B82F6', tip: 'Calendrier' },
          { key: 'export' as Destination, Icon: Download, color: '#10B981', tip: 'Fichier' },
          { key: 'both' as Destination, Icon: Layers, color: '#A855F7', tip: 'Les deux' },
          { key: 'audio-studio' as Destination, Icon: Music, color: '#EC4899', tip: 'Studio Son' },
        ] as const).map(({ key, Icon, color, tip }) => (
          <button key={key} onClick={() => setDestination(key)} title={tip}
            className={`h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-all ${
              destination === key ? 'ring-2 ring-white/40 scale-105' : 'opacity-60 hover:opacity-100'
            }`}
            style={{ backgroundColor: `${color}20`, color }}
          >
            <Icon size={16} fill="currentColor" strokeWidth={1.5} />
          </button>
        ))}
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
          {isExporting ? `${exportProgress}%` : `${25 * batchCount}cr`}
        </span>
        <div className="h-px w-7 bg-gray-700/50" />
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[7px] uppercase tracking-wider text-gray-500">Batch</span>
          <div className="flex items-center gap-px">
            <button onClick={() => setBatchCount(Math.max(1, batchCount - 1))} disabled={batchCount <= 1}
              className="h-5 w-5 rounded text-[10px] font-bold text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30 transition">−</button>
            <span className="text-[10px] font-bold text-purple-400 w-5 text-center">x{batchCount}</span>
            <button onClick={() => setBatchCount(Math.min(10, batchCount + 1))} disabled={batchCount >= 10}
              className="h-5 w-5 rounded text-[10px] font-bold text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30 transition">+</button>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* Mobile Horizontal Export Bar — bottom of viewport on <lg     */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="flex lg:hidden fixed bottom-0 left-0 right-0 z-40 items-center justify-between gap-1.5 bg-gray-900/95 backdrop-blur-sm border-t border-gray-700/50 px-2 py-1.5 shadow-2xl overflow-x-auto scrollbar-hide">
        {isExporting && (
          <div className="absolute top-0 left-0 h-0.5 bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300" style={{ width: `${exportProgress}%` }} />
        )}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {([
            { key: 'draft' as Destination, Icon: Calendar, color: '#3B82F6' },
            { key: 'export' as Destination, Icon: Download, color: '#10B981' },
            { key: 'both' as Destination, Icon: Layers, color: '#A855F7' },
            { key: 'audio-studio' as Destination, Icon: Music, color: '#EC4899' },
          ] as const).map(({ key, Icon, color }) => (
            <button key={key} onClick={() => setDestination(key)}
              className={`h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-all ${
                destination === key ? 'ring-2 ring-white/40 scale-105' : 'opacity-60'
              }`}
              style={{ backgroundColor: `${color}20`, color }}
            >
              <Icon size={16} fill="currentColor" strokeWidth={1.5} />
            </button>
          ))}
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
          {25 * batchCount}cr
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
