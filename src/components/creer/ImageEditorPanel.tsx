'use client';

import React, { useCallback, useRef, useState } from 'react';
import {
  Sun, Contrast, Palette, Thermometer, Sparkles, CircleOff,
  Upload, Link2, Trash2, Image as ImageIcon, Wand2, Eraser,
  Maximize, Video, Paintbrush, Layers, ArrowUpCircle, Move,
} from 'lucide-react';

// ── Types (mirrored from page.tsx to avoid circular imports) ──

export type ImageFilters = {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  blur: number;
  vignette: number;
};

export const DEFAULT_FILTERS: ImageFilters = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
  temperature: 0,
  blur: 0,
  vignette: 0,
};

export type SequenceBackgroundConfig = {
  url: string | null;
  opacity: number;
  filters?: ImageFilters;
  /** CSS object-position for cropping/repositioning, e.g. "50% 30%" */
  objectPosition?: string;
};

type SequenceKey = 'titre' | 'cartes' | 'video' | 'cta';

const SEQ_LABELS: Record<SequenceKey, string> = {
  titre: 'Titre',
  cartes: 'Cartes',
  video: 'Vidéo',
  cta: 'CTA',
};

// ── Filter slider config ──

interface FilterSliderDef {
  key: keyof ImageFilters;
  label: string;
  icon: React.ReactNode;
  min: number;
  max: number;
  step: number;
  defaultVal: number;
  format: (v: number) => string;
}

const FILTER_SLIDERS: FilterSliderDef[] = [
  {
    key: 'brightness',
    label: 'Luminosité',
    icon: <Sun size={12} />,
    min: 0,
    max: 2,
    step: 0.01,
    defaultVal: 1,
    format: (v) => `${Math.round(v * 100)}%`,
  },
  {
    key: 'contrast',
    label: 'Contraste',
    icon: <Contrast size={12} />,
    min: 0,
    max: 2,
    step: 0.01,
    defaultVal: 1,
    format: (v) => `${Math.round(v * 100)}%`,
  },
  {
    key: 'saturation',
    label: 'Saturation',
    icon: <Palette size={12} />,
    min: 0,
    max: 3,
    step: 0.01,
    defaultVal: 1,
    format: (v) => `${Math.round(v * 100)}%`,
  },
  {
    key: 'temperature',
    label: 'Température',
    icon: <Thermometer size={12} />,
    min: -100,
    max: 100,
    step: 1,
    defaultVal: 0,
    format: (v) => `${v > 0 ? '+' : ''}${Math.round(v)}`,
  },
  {
    key: 'blur',
    label: 'Flou',
    icon: <CircleOff size={12} />,
    min: 0,
    max: 20,
    step: 0.5,
    defaultVal: 0,
    format: (v) => `${v}px`,
  },
  {
    key: 'vignette',
    label: 'Vignette',
    icon: <Sparkles size={12} />,
    min: 0,
    max: 1,
    step: 0.01,
    defaultVal: 0,
    format: (v) => `${Math.round(v * 100)}%`,
  },
];

// ── AI tool placeholders ──

const AI_TOOLS = [
  { label: 'Effacer arrière-plan', icon: <Eraser size={11} /> },
  { label: 'Gomme magique', icon: <Wand2 size={11} /> },
  { label: 'Édition magique', icon: <Paintbrush size={11} /> },
  { label: 'Augmenter résolution', icon: <ArrowUpCircle size={11} /> },
  { label: "D'image à vidéo", icon: <Video size={11} /> },
  { label: 'Générer arrière-plan', icon: <ImageIcon size={11} /> },
  { label: 'Calques magiques', icon: <Layers size={11} /> },
  { label: 'Transfert de style', icon: <Maximize size={11} /> },
];

// ── Helper: build CSS filter string from ImageFilters ──

export function buildCssFilter(f: ImageFilters | undefined): string {
  if (!f) return 'none';
  const parts: string[] = [];
  if (f.brightness !== 1) parts.push(`brightness(${f.brightness})`);
  if (f.contrast !== 1) parts.push(`contrast(${f.contrast})`);
  if (f.saturation !== 1) parts.push(`saturate(${f.saturation})`);
  if (f.temperature !== 0) parts.push(`hue-rotate(${f.temperature * 0.5}deg)`);
  if (f.blur > 0) parts.push(`blur(${f.blur}px)`);
  return parts.length > 0 ? parts.join(' ') : 'none';
}

/**
 * Build the equivalent Canvas2D filter string (no CSS `blur()` — Canvas uses
 * pixels already, no px-to-viewport conversion needed).
 */
export function buildCanvasFilter(f: ImageFilters | undefined): string {
  if (!f) return 'none';
  const parts: string[] = [];
  if (f.brightness !== 1) parts.push(`brightness(${f.brightness})`);
  if (f.contrast !== 1) parts.push(`contrast(${f.contrast})`);
  if (f.saturation !== 1) parts.push(`saturate(${f.saturation})`);
  if (f.temperature !== 0) parts.push(`hue-rotate(${f.temperature * 0.5}deg)`);
  if (f.blur > 0) parts.push(`blur(${f.blur}px)`);
  return parts.length > 0 ? parts.join(' ') : 'none';
}

// ── Props ──

interface ImageEditorPanelProps {
  seqKey: SequenceKey;
  config: SequenceBackgroundConfig | null;
  /** Partial update — caller merges with existing config. */
  onUpdate: (patch: Partial<SequenceBackgroundConfig>) => void;
  /** Upload a file to Supabase and return the public URL. */
  onUploadFile: (file: File) => Promise<void>;
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

// ── Component ──

export default function ImageEditorPanel({
  seqKey,
  config,
  onUpdate,
  onUploadFile,
  showToast: _showToast,
}: ImageEditorPanelProps) {
  void _showToast; // Reserved for future AI tools feedback
  const fileRef = useRef<HTMLInputElement>(null);
  const [urlDraft, setUrlDraft] = useState(config?.url ?? '');
  const [uploading, setUploading] = useState(false);
  const filters = config?.filters ?? DEFAULT_FILTERS;
  const objPos = config?.objectPosition ?? '50% 50%';

  // Sync urlDraft when config.url changes externally (upload / detach)
  const lastUrlRef = useRef(config?.url ?? '');
  if ((config?.url ?? '') !== lastUrlRef.current) {
    lastUrlRef.current = config?.url ?? '';
    setUrlDraft(config?.url ?? '');
  }

  const updateFilter = useCallback(
    (key: keyof ImageFilters, value: number) => {
      const next = { ...filters, [key]: value };
      onUpdate({ filters: next });
    },
    [filters, onUpdate],
  );

  const resetFilters = useCallback(() => {
    onUpdate({ filters: { ...DEFAULT_FILTERS } });
  }, [onUpdate]);

  const hasNonDefaultFilters =
    filters.brightness !== 1 ||
    filters.contrast !== 1 ||
    filters.saturation !== 1 ||
    filters.temperature !== 0 ||
    filters.blur !== 0 ||
    filters.vignette !== 0;

  // Wrapped upload handler with loading state
  const handleUpload = useCallback(async (file: File) => {
    setUploading(true);
    try {
      await onUploadFile(file);
    } finally {
      setUploading(false);
    }
  }, [onUploadFile]);

  // ── Focal-point position presets ──
  const POSITIONS = [
    { label: 'Haut-G', value: '0% 0%' },
    { label: 'Haut', value: '50% 0%' },
    { label: 'Haut-D', value: '100% 0%' },
    { label: 'Gauche', value: '0% 50%' },
    { label: 'Centre', value: '50% 50%' },
    { label: 'Droite', value: '100% 50%' },
    { label: 'Bas-G', value: '0% 100%' },
    { label: 'Bas', value: '50% 100%' },
    { label: 'Bas-D', value: '100% 100%' },
  ];

  return (
    <div className="space-y-3">
      {/* Header info */}
      <div className="text-[10px] text-gray-400">
        Image de fond pour la séquence{' '}
        <span className="text-white font-medium">{SEQ_LABELS[seqKey]}</span>.
        Si aucune image, l&apos;éditeur utilise l&apos;image globale (Pexels / poster).
      </div>

      {/* ── Image preview + detach ── */}
      {config?.url ? (
        <div className="space-y-2">
          <div className="relative rounded overflow-hidden bg-gray-800 border border-gray-700">
            <img
              src={config.url}
              alt={`bg ${seqKey}`}
              className="w-full h-24 object-cover"
              style={{
                opacity: config.opacity ?? 1,
                filter: buildCssFilter(config.filters),
                objectPosition: objPos,
              }}
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onUpdate({ url: null, filters: undefined, objectPosition: undefined });
              }}
              className="absolute top-1 right-1 rounded bg-red-600/80 px-2 py-0.5 text-[10px] text-white hover:bg-red-600 flex items-center gap-1 z-10"
              title="Détacher l'image (revient à l'image globale)"
            >
              <Trash2 size={10} /> Détacher
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded border border-dashed border-gray-700 bg-gray-800/40 px-3 py-4 text-center text-[10px] text-gray-500">
          Aucune image personnalisée — utilise le fond global
        </div>
      )}

      {/* ── Upload ── */}
      <div>
        <label className="block text-[9px] uppercase tracking-wider text-gray-500 mb-1">
          Upload image
        </label>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleUpload(f);
            e.target.value = '';
          }}
          className="hidden"
        />
        <button
          type="button"
          disabled={uploading}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            fileRef.current?.click();
          }}
          className="w-full rounded bg-purple-600 hover:bg-purple-700 disabled:bg-purple-800 disabled:opacity-60 px-3 py-1.5 text-[10px] text-white flex items-center justify-center gap-1.5 transition-colors"
        >
          <Upload size={12} /> {uploading ? 'Upload en cours…' : 'Choisir une image'}
        </button>
      </div>

      {/* URL field — controlled */}
      <div>
        <label className="block text-[9px] uppercase tracking-wider text-gray-500 mb-1">
          <Link2 size={10} className="inline mr-1" />
          Ou URL directe
        </label>
        <input
          type="url"
          placeholder="https://..."
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          onBlur={() => {
            const val = urlDraft.trim();
            if (val && val !== config?.url) onUpdate({ url: val });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const val = urlDraft.trim();
              if (val && val !== config?.url) onUpdate({ url: val });
            }
          }}
          className="w-full rounded bg-gray-800 border border-gray-700 px-2 py-1 text-[10px] text-white focus:border-purple-500 focus:outline-none"
        />
      </div>

      {/* ── Opacity slider ── */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[9px] uppercase tracking-wider text-gray-500">
            Opacité
          </label>
          <span className="text-[10px] text-purple-300 font-mono">
            {Math.round((config?.opacity ?? 1) * 100)}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={config?.opacity ?? 1}
          onChange={(e) => onUpdate({ opacity: parseFloat(e.target.value) })}
          className="w-full h-1.5 rounded-lg appearance-none bg-gray-700 accent-purple-500 cursor-pointer"
        />
      </div>

      {/* ── Recadrage (object-position) ── */}
      {config?.url && (
        <div className="pt-2 border-t border-gray-800">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9px] uppercase tracking-wider text-gray-500 flex items-center gap-1">
              <Move size={10} /> Recadrage
            </span>
            {objPos !== '50% 50%' && (
              <button
                type="button"
                onClick={() => onUpdate({ objectPosition: '50% 50%' })}
                className="text-[9px] text-purple-400 hover:text-purple-300"
              >
                Centrer
              </button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-1">
            {POSITIONS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => onUpdate({ objectPosition: p.value })}
                className={`rounded px-1 py-1 text-[9px] transition-colors ${
                  objPos === p.value
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Adjustments (Phase 2) ── */}
      <div className="pt-2 border-t border-gray-800">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] uppercase tracking-wider text-gray-500">
            Ajustements
          </span>
          {hasNonDefaultFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="text-[9px] text-purple-400 hover:text-purple-300"
            >
              Réinitialiser
            </button>
          )}
        </div>
        <div className="space-y-2">
          {FILTER_SLIDERS.map((s) => (
            <div key={s.key}>
              <div className="flex items-center justify-between mb-0.5">
                <label className="text-[10px] text-gray-400 flex items-center gap-1">
                  {s.icon} {s.label}
                </label>
                <span className="text-[9px] text-purple-300 font-mono min-w-[32px] text-right">
                  {s.format(filters[s.key])}
                </span>
              </div>
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={filters[s.key]}
                onChange={(e) => updateFilter(s.key, parseFloat(e.target.value))}
                className="w-full h-1 rounded-lg appearance-none bg-gray-700 accent-purple-500 cursor-pointer"
              />
            </div>
          ))}
        </div>
      </div>

      {/* ── AI Tools (placeholder) ── */}
      <div className="pt-2 border-t border-gray-800">
        <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-1.5">
          Outils IA — bientôt disponibles
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {AI_TOOLS.map(({ label, icon }) => (
            <button
              key={label}
              type="button"
              disabled
              title="Bientôt disponible"
              className="rounded bg-gray-800/60 px-2 py-1.5 text-[10px] text-gray-500 cursor-not-allowed opacity-50 flex items-center gap-1"
            >
              {icon} {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
