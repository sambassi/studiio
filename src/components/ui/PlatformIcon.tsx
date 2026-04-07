'use client';

import React from 'react';

// ─── SVG PATHS (official platform logos) ───
const PLATFORM_SVG_PATHS: Record<string, string> = {
  instagram:
    'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z',
  tiktok:
    'M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.75a8.18 8.18 0 004.77 1.52V6.84a4.84 4.84 0 01-1-.15z',
  youtube:
    'M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z',
  facebook:
    'M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z',
};

// ─── PLATFORM COLORS ───
export const PLATFORM_COLORS: Record<string, string> = {
  instagram: '#E1306C',
  tiktok: '#00F2EA',
  youtube: '#FF0000',
  facebook: '#1877F2',
};

// ─── PLATFORM LABELS ───
const PLATFORM_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  facebook: 'Facebook',
};

export type PlatformKey = 'instagram' | 'tiktok' | 'youtube' | 'facebook';

interface PlatformIconProps {
  platform: PlatformKey;
  isActive?: boolean;
  size?: 'sm' | 'md';
  showLabel?: boolean;
  onClick?: () => void;
  className?: string;
}

/**
 * Premium SVG-based platform icon with capsule container, glow effect, and active state.
 *
 * - `size="sm"` → compact 32×32px square (for safe zone selector above preview)
 * - `size="md"` → capsule with label (for platform selector in social/infographie)
 *
 * This component is purely additive — it does NOT replace any existing component.
 * Existing emoji-based selectors remain untouched.
 */
export function PlatformIcon({
  platform,
  isActive = false,
  size = 'md',
  showLabel = true,
  onClick,
  className = '',
}: PlatformIconProps) {
  const color = PLATFORM_COLORS[platform] || '#7C3AED';
  const path = PLATFORM_SVG_PATHS[platform];
  const label = PLATFORM_LABELS[platform] || platform;

  if (!path) return null;

  // ─── MINI ICON (sm) ───
  if (size === 'sm') {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`
          group relative w-10 h-10 rounded-xl flex items-center justify-center
          transition-all duration-200 ease-out
          ${isActive
            ? ''
            : 'bg-white/[0.06] border border-white/[0.12] hover:bg-white/[0.10] hover:border-white/[0.25]'
          }
          ${className}
        `}
        style={isActive ? {
          background: `${color}20`,
          border: `1.5px solid ${color}70`,
          boxShadow: `0 0 12px ${color}30`,
        } : undefined}
        title={label}
      >
        <svg
          viewBox="0 0 24 24"
          className="w-5 h-5 transition-opacity duration-200"
          style={{ opacity: isActive ? 1 : 0.6 }}
        >
          <path d={path} fill={isActive ? color : '#aaa'} />
        </svg>
      </button>
    );
  }

  // ─── CAPSULE (md) ───
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
          background: `${color}14`,
          border: `1px solid ${color}70`,
          boxShadow: `0 0 20px ${color}26, inset 0 0 20px ${color}0D`,
        } : {}),
      }}
    >
      {/* Glow radial (visible on hover + active) */}
      <div
        className={`absolute inset-0 rounded-[14px] transition-opacity duration-250 ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        style={{
          background: `radial-gradient(ellipse at 30% 50%, ${color}1F, transparent 70%)`,
        }}
      />

      {/* Icon circle */}
      <div
        className="relative w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0 transition-all duration-250"
        style={{
          background: isActive
            ? `${color}3D`
            : `${color}26`,
          boxShadow: isActive ? `0 0 12px ${color}4D` : 'none',
        }}
      >
        <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] relative z-[1]">
          <path d={path} fill={color} />
        </svg>
      </div>

      {/* Label */}
      {showLabel && (
        <span
          className={`text-[13px] font-semibold transition-colors duration-250 tracking-[0.01em] relative z-[1] ${
            isActive ? 'text-white' : 'text-white/60 group-hover:text-white/85'
          }`}
        >
          {label}
        </span>
      )}
    </button>
  );
}

export default PlatformIcon;
