'use client';

import React from 'react';

// ─── SVG PATHS for design option icons ───
const DESIGN_ICON_PATHS: Record<string, string> = {
  font: 'M9.93 13.5h4.14L12 7.98zM20 2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-4.05 16.5l-1.14-3H9.17l-1.12 3H5.96l5.11-13h1.86l5.11 13h-2.09z',
  filter_none: 'M17.66 7.93L12 2.27 6.34 7.93c-3.12 3.12-3.12 8.19 0 11.31A7.98 7.98 0 0012 21.58c2.05 0 4.1-.78 5.66-2.34 3.12-3.12 3.12-8.19 0-11.31zM12 19.59c-1.6 0-3.11-.62-4.24-1.76C6.62 16.69 6 15.19 6 13.59s.62-3.11 1.76-4.24L12 5.1v14.49z',
  filter_neon: 'M9 21c0 .5.4 1 1 1h4c.6 0 1-.5 1-1v-1H9v1zm3-19C8.1 2 5 5.1 5 9c0 2.4 1.2 4.5 3 5.7V17c0 .5.4 1 1 1h6c.6 0 1-.5 1-1v-2.3c1.8-1.3 3-3.4 3-5.7 0-3.9-3.1-7-7-7z',
  filter_cinematic: 'M20 8.69V4h-4.69L12 .69 8.69 4H4v4.69L.69 12 4 15.31V20h4.69L12 23.31 15.31 20H20v-4.69L23.31 12 20 8.69zM12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6zm0-10c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4z',
  filter_warm: 'M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z',
  filter_cool: 'M22 11h-4.17l3.24-3.24-1.41-1.42L15 11h-2V9l4.66-4.66-1.42-1.41L13 6.17V2h-2v4.17L7.76 2.93 6.34 4.34 11 9v2H9L4.34 6.34 2.93 7.76 6.17 11H2v2h4.17l-3.24 3.24 1.41 1.42L9 13h2v2l-4.66 4.66 1.42 1.41L11 17.83V22h2v-4.17l3.24 3.24 1.42-1.41L13 15v-2h2l4.66 4.66 1.41-1.42L17.83 13H22z',
  card_compact: 'M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z',
  card_stats: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 10h2v7H7zm4-3h2v10h-2zm4 6h2v4h-2z',
  card_minimal: 'M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z',
  card_fullwidth: 'M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z',
};

interface DesignOptionProps {
  /** Icon key from DESIGN_ICON_PATHS */
  icon: string;
  /** Main label */
  label: string;
  /** Sublabel / description */
  sublabel?: string;
  /** Is this option selected */
  isActive?: boolean;
  /** Custom accent color (defaults to #7C3AED) */
  accentColor?: string;
  /** Custom icon color override */
  iconColor?: string;
  onClick?: () => void;
  className?: string;
}

/**
 * Premium design option capsule with glow effect and active state.
 * Used for font selection, filter selection, and card style selection.
 *
 * This component is purely additive — it does NOT replace any existing component.
 */
export function DesignOption({
  icon,
  label,
  sublabel,
  isActive = false,
  accentColor = '#7C3AED',
  iconColor,
  onClick,
  className = '',
}: DesignOptionProps) {
  const svgPath = DESIGN_ICON_PATHS[icon] || DESIGN_ICON_PATHS['font'];
  const fillColor = iconColor || (isActive ? lighten(accentColor) : dimColor(accentColor));

  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        group relative flex items-center gap-2.5 rounded-[14px]
        transition-all duration-250 ease-out overflow-hidden
        ${isActive
          ? ''
          : 'bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.07] hover:border-white/[0.15] hover:-translate-y-px'
        }
        ${className}
      `}
      style={{
        padding: '10px 18px 10px 14px',
        ...(isActive ? {
          background: `${accentColor}14`,
          border: `1px solid ${accentColor}80`,
          boxShadow: `0 0 20px ${accentColor}26, inset 0 0 20px ${accentColor}0D`,
        } : {}),
      }}
    >
      {/* Glow */}
      <div
        className={`absolute inset-0 rounded-[14px] transition-opacity duration-250 ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        style={{
          background: `radial-gradient(ellipse at 30% 50%, ${accentColor}1A, transparent 70%)`,
        }}
      />

      {/* Icon container */}
      <div
        className="relative w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0 transition-all duration-250"
        style={{
          background: isActive
            ? `${iconColor || accentColor}38`
            : `${iconColor || accentColor}1F`,
          boxShadow: isActive ? `0 0 12px ${iconColor || accentColor}4D` : 'none',
        }}
      >
        <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] relative z-[1]">
          <path d={svgPath} fill={fillColor} />
        </svg>
      </div>

      {/* Labels */}
      <div className="relative z-[1]">
        <div
          className={`text-[13px] font-semibold transition-colors duration-250 tracking-[0.01em] ${
            isActive ? 'text-white' : 'text-white/60 group-hover:text-white/85'
          }`}
        >
          {label}
        </div>
        {sublabel && (
          <div
            className={`text-[11px] mt-px transition-colors duration-250 ${
              isActive ? 'text-white/50' : 'text-white/30'
            }`}
          >
            {sublabel}
          </div>
        )}
      </div>
    </button>
  );
}

/** Lighten a hex color for active icon fill */
function lighten(hex: string): string {
  const colorMap: Record<string, string> = {
    '#7C3AED': '#C4B5FD',
    '#00FFC8': '#66FFD9',
    '#FFAA32': '#FFD080',
    '#FF6432': '#FF9070',
    '#64B4FF': '#A0D0FF',
  };
  return colorMap[hex] || '#C4B5FD';
}

/** Dim color for inactive icon fill */
function dimColor(hex: string): string {
  const colorMap: Record<string, string> = {
    '#7C3AED': '#A78BFA',
    '#00FFC8': '#00FFC8',
    '#FFAA32': '#FFAA32',
    '#FF6432': '#FF6432',
    '#64B4FF': '#64B4FF',
  };
  return colorMap[hex] || '#A78BFA';
}

// ─── PRESET CONFIGURATIONS ───

export const FONT_OPTIONS = [
  { icon: 'font', label: 'Anton', sublabel: 'Impact' },
  { icon: 'font', label: 'Syne', sublabel: 'Luxe' },
  { icon: 'font', label: 'Bebas Neue', sublabel: 'Sport' },
  { icon: 'font', label: 'Poppins', sublabel: 'Minimal' },
  { icon: 'font', label: 'Space Grotesk', sublabel: 'Futur' },
];

export const FILTER_OPTIONS = [
  { icon: 'filter_none', label: 'Aucun', sublabel: 'Original', accentColor: '#7C3AED' },
  { icon: 'filter_neon', label: 'Neon Glow', sublabel: 'Vibrant', accentColor: '#7C3AED', iconColor: '#00FFC8' },
  { icon: 'filter_cinematic', label: 'Cinematic', sublabel: 'Dark', accentColor: '#7C3AED', iconColor: '#FFAA32' },
  { icon: 'filter_warm', label: 'Warm Energy', sublabel: 'Chaleur', accentColor: '#7C3AED', iconColor: '#FF6432' },
  { icon: 'filter_cool', label: 'Cool Frost', sublabel: 'Frais', accentColor: '#7C3AED', iconColor: '#64B4FF' },
];

export const CARD_STYLE_OPTIONS = [
  { icon: 'card_compact', label: 'Compact', sublabel: 'Par defaut' },
  { icon: 'card_compact', label: 'Educatif', sublabel: 'Detaille' },
  { icon: 'card_stats', label: 'Stats Bold', sublabel: 'Chiffres' },
  { icon: 'card_minimal', label: 'Minimal Line', sublabel: 'Epure' },
  { icon: 'card_fullwidth', label: 'Full Width', sublabel: 'Large' },
];

export default DesignOption;
