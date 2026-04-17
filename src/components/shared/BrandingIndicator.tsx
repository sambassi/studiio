'use client';

import Link from 'next/link';
import { Palette, ChevronRight } from 'lucide-react';
import { type BrandingSettings } from '@/lib/hooks/useBranding';

interface BrandingIndicatorProps {
  branding: BrandingSettings;
}

function getPresetLabel(branding: BrandingSettings): string {
  if (branding.watermarkText || branding.borderEnabled) return branding.watermarkText || 'Personnalisé';
  return 'Par défaut';
}

export function BrandingIndicator({ branding }: BrandingIndicatorProps) {
  const label = getPresetLabel(branding);

  return (
    <Link
      href="/dashboard/settings?tab=branding"
      className="flex items-center gap-2.5 rounded-xl bg-gray-800/50 border border-gray-700/50 px-3 py-2 hover:bg-gray-800 transition-colors group"
    >
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: `${branding.accentColor}20`, color: branding.accentColor }}
      >
        <Palette size={14} />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-xs text-gray-300">
          Branding : <span className="font-medium text-white">{label}</span>
        </span>
      </div>
      <div className="flex items-center gap-1 text-[10px] text-gray-500 group-hover:text-purple-400 transition-colors">
        Modifier <ChevronRight size={12} />
      </div>
    </Link>
  );
}
