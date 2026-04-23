'use client';

import React from 'react';
import { type BrandingSettings } from '@/lib/hooks/useBranding';

interface Props {
  branding: BrandingSettings;
}

/**
 * Live 9:16 thumbnail that reflects the user's current Branding settings
 * (watermark, border, CTA text/sub-text, accent color). Matches the
 * glassmorphism aesthetic of the /creer preview so the user can see what
 * the saved branding will look like on future videos.
 */
export default function BrandingPreview({ branding }: Props) {
  const accent = branding.accentColor || '#D91CD2';
  const borderStyle = branding.borderEnabled
    ? { boxShadow: `inset 0 0 0 6px ${branding.borderColor || accent}` }
    : {};

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Aperçu</p>
      <div
        className="relative rounded-2xl overflow-hidden"
        style={{
          width: 200,
          height: 355,
          background: `linear-gradient(135deg, #0A0A0F 0%, ${accent}33 100%)`,
          ...borderStyle,
        }}
      >
        {/* Top accent dot (where a logo would sit) */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: `${accent}33` }}>
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: accent }} />
        </div>

        {/* Title block */}
        <div className="absolute inset-x-4 top-16 text-center">
          <p className="text-white text-[15px] font-black tracking-wide leading-tight">VOTRE TITRE</p>
          <p className="text-gray-300/90 text-[10px] mt-1 leading-snug">Votre sous-titre</p>
        </div>

        {/* Middle glassmorphism card with accent color stripe */}
        <div
          className="absolute inset-x-4 top-1/2 -translate-y-1/2 rounded-xl px-3 py-2 border-l-4 backdrop-blur-sm"
          style={{ backgroundColor: 'rgba(0,0,0,0.35)', borderLeftColor: accent }}
        >
          <p className="text-[9px] text-white font-semibold">Exemple de carte</p>
          <p className="text-[8px] text-gray-300 mt-0.5">Avec couleur d'accent</p>
        </div>

        {/* CTA block bottom */}
        <div className="absolute inset-x-0 bottom-10 text-center px-3">
          <p className="text-white text-[12px] font-black tracking-wide uppercase leading-tight">
            {branding.ctaText || 'CHAT POUR PLUS D\'INFOS'}
          </p>
          <p className="text-[9px] font-semibold uppercase tracking-wider mt-0.5" style={{ color: accent }}>
            {branding.ctaSubText || 'LIEN EN BIO'}
          </p>
        </div>

        {/* Watermark */}
        {branding.watermarkText && (
          <div className="absolute inset-x-0 bottom-2 text-center">
            <p className="text-white/80 text-[9px] font-semibold tracking-wider">
              {branding.watermarkText}
            </p>
          </div>
        )}

        {/* Progress bar — visual parity with real montage */}
        <div className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${accent}, #FF2DAA, #00D4FF)` }} />
      </div>
      <p className="text-[10px] text-gray-500 leading-relaxed">
        Aperçu en temps réel. Les modifications s'appliqueront à tous les nouveaux montages.
      </p>
    </div>
  );
}
