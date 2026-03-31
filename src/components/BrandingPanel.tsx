'use client';

import React from 'react';
import { type BrandingSettings } from '@/lib/hooks/useBranding';

interface BrandingPanelProps {
  branding: BrandingSettings;
  onChange: (updates: Partial<BrandingSettings>) => void;
  compact?: boolean;
}

const PRESET_COLORS = [
  '#D91CD2', // violet (default)
  '#EC4899', // pink
  '#FF2DAA', // neon pink
  '#7C3AED', // purple
  '#00D4FF', // cyan
  '#10B981', // green
  '#F59E0B', // amber
  '#EF4444', // red
  '#FFFFFF', // white
];

export default function BrandingPanel({ branding, onChange, compact = false }: BrandingPanelProps) {
  return (
    <div className={`space-y-${compact ? '3' : '4'}`}>
      {/* Watermark / Site web */}
      <div>
        <label className="block text-xs font-semibold text-gray-400 mb-1.5">
          Watermark / Site web
        </label>
        <input
          type="text"
          value={branding.watermarkText}
          onChange={(e) => onChange({ watermarkText: e.target.value })}
          placeholder="Ex: monsite.com"
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
        />
        <p className="text-[10px] text-gray-500 mt-1">Apparaît en bas de chaque vidéo. Laissez vide pour aucun watermark.</p>
      </div>

      {/* Border / Contour */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-semibold text-gray-400">Contour de couleur</label>
          <button
            onClick={() => onChange({ borderEnabled: !branding.borderEnabled })}
            className={`relative w-9 h-5 rounded-full transition-colors ${branding.borderEnabled ? 'bg-purple-600' : 'bg-gray-700'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${branding.borderEnabled ? 'translate-x-4' : ''}`} />
          </button>
        </div>
        {branding.borderEnabled && (
          <div className="space-y-2">
            <div className="flex gap-1.5 flex-wrap">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => onChange({ borderColor: color })}
                  className={`w-7 h-7 rounded-lg border-2 transition-all ${
                    branding.borderColor === color ? 'border-white scale-110' : 'border-gray-600 hover:border-gray-400'
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={branding.borderColor}
                onChange={(e) => onChange({ borderColor: e.target.value })}
                className="w-8 h-8 rounded cursor-pointer bg-transparent border-0"
              />
              <input
                type="text"
                value={branding.borderColor}
                onChange={(e) => onChange({ borderColor: e.target.value })}
                className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:border-purple-500 focus:outline-none"
              />
            </div>
          </div>
        )}
      </div>

      {/* CTA Text */}
      <div>
        <label className="block text-xs font-semibold text-gray-400 mb-1.5">
          Texte CTA (appel à l&apos;action)
        </label>
        <input
          type="text"
          value={branding.ctaText}
          onChange={(e) => onChange({ ctaText: e.target.value })}
          placeholder="Ex: RÉSERVE TA PLACE"
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
        />
      </div>

      {/* CTA Sub-text */}
      <div>
        <label className="block text-xs font-semibold text-gray-400 mb-1.5">
          Sous-texte CTA
        </label>
        <input
          type="text"
          value={branding.ctaSubText}
          onChange={(e) => onChange({ ctaSubText: e.target.value })}
          placeholder="Ex: LIEN EN BIO"
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
        />
      </div>

      {/* Accent Color */}
      <div>
        <label className="block text-xs font-semibold text-gray-400 mb-1.5">
          Couleur d&apos;accent
        </label>
        <div className="flex gap-1.5 flex-wrap">
          {PRESET_COLORS.slice(0, 7).map((color) => (
            <button
              key={color}
              onClick={() => onChange({ accentColor: color })}
              className={`w-7 h-7 rounded-lg border-2 transition-all ${
                branding.accentColor === color ? 'border-white scale-110' : 'border-gray-600 hover:border-gray-400'
              }`}
              style={{ backgroundColor: color }}
            />
          ))}
          <input
            type="color"
            value={branding.accentColor}
            onChange={(e) => onChange({ accentColor: e.target.value })}
            className="w-7 h-7 rounded cursor-pointer bg-transparent border-0"
          />
        </div>
      </div>
    </div>
  );
}
