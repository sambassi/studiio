'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
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

// ── AI tools config ──

type AiAction = 'remove-bg' | 'magic-eraser' | 'magic-edit' | 'upscale' | 'image-to-video' | 'generate-bg' | 'magic-layers' | 'style-transfer';

interface AiToolDef {
  action: AiAction;
  label: string;
  icon: React.ReactNode;
  /** Does this tool need the current image URL? */
  needsImage: boolean;
  /** Does this tool need a text prompt? */
  needsPrompt: boolean;
  /** Placeholder for prompt input */
  promptPlaceholder?: string;
  /** Does this tool need a style selection? */
  needsStyle?: boolean;
  /** Credit cost */
  credits: number;
}

const AI_TOOLS: AiToolDef[] = [
  { action: 'remove-bg', label: 'Effacer arrière-plan', icon: <Eraser size={11} />, needsImage: true, needsPrompt: false, credits: 2 },
  { action: 'magic-eraser', label: 'Gomme magique', icon: <Wand2 size={11} />, needsImage: true, needsPrompt: true, promptPlaceholder: 'Que voulez-vous effacer ? (ex: la personne, le texte…)', credits: 3 },
  { action: 'magic-edit', label: 'Édition magique', icon: <Paintbrush size={11} />, needsImage: true, needsPrompt: true, promptPlaceholder: 'Décrivez la modification (ex: changer le ciel en coucher de soleil)', credits: 5 },
  { action: 'upscale', label: 'Augmenter résolution', icon: <ArrowUpCircle size={11} />, needsImage: true, needsPrompt: false, credits: 3 },
  { action: 'image-to-video', label: "D'image à vidéo", icon: <Video size={11} />, needsImage: true, needsPrompt: false, credits: 15 },
  { action: 'generate-bg', label: 'Générer arrière-plan', icon: <ImageIcon size={11} />, needsImage: false, needsPrompt: true, promptPlaceholder: 'Décrivez le fond (ex: gym moderne sombre avec néons violets)', credits: 5 },
  { action: 'magic-layers', label: 'Calques magiques', icon: <Layers size={11} />, needsImage: true, needsPrompt: false, credits: 3 },
  { action: 'style-transfer', label: 'Transfert de style', icon: <Maximize size={11} />, needsImage: true, needsPrompt: false, needsStyle: true, credits: 5 },
];

const STYLE_PRESETS = [
  { value: 'anime', label: 'Anime' },
  { value: 'oil painting', label: 'Peinture' },
  { value: 'watercolor', label: 'Aquarelle' },
  { value: 'neon cyberpunk', label: 'Cyberpunk' },
  { value: 'pencil sketch', label: 'Croquis' },
  { value: 'pop art', label: 'Pop Art' },
  { value: 'vintage retro film', label: 'Vintage' },
  { value: 'minimalist flat design', label: 'Minimaliste' },
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
  /** Quand true, le gradient overlay du preview est temporairement
   *  masqué pour rendre le recadrage visible. La config user n'est PAS
   *  modifiée — c'est juste un toggle d'aperçu. */
  previewGradientHidden?: boolean;
  /** Toggler le gradient. Quand le user ferme le panneau, le parent
   *  remet à false automatiquement. */
  onTogglePreviewGradient?: () => void;
}

// ── Component ──

export default function ImageEditorPanel({
  seqKey,
  config,
  onUpdate,
  onUploadFile,
  showToast,
  previewGradientHidden,
  onTogglePreviewGradient,
}: ImageEditorPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [urlDraft, setUrlDraft] = useState(config?.url ?? '');
  const [uploading, setUploading] = useState(false);
  const [isDraggingCrop, setIsDraggingCrop] = useState(false);
  // AI tools state
  const [aiLoading, setAiLoading] = useState<AiAction | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiPromptFor, setAiPromptFor] = useState<AiAction | null>(null);
  const [aiStyle, setAiStyle] = useState<string | null>(null);
  const cropStartRef = useRef<{ x: number; y: number; startPosX: number; startPosY: number } | null>(null);
  const cropContainerRef = useRef<HTMLDivElement>(null);
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

  // ── AI tool execution ──
  const runAiTool = useCallback(async (tool: AiToolDef, prompt?: string, style?: string) => {
    if (tool.needsImage && !config?.url) {
      showToast('Uploadez d\'abord une image', 'error');
      return;
    }
    if (tool.needsPrompt && !prompt?.trim()) {
      // Open prompt input
      setAiPromptFor(tool.action);
      setAiPrompt('');
      return;
    }
    if (tool.needsStyle && !style) {
      setAiPromptFor(tool.action);
      return;
    }
    setAiLoading(tool.action);
    setAiPromptFor(null);
    try {
      const res = await fetch('/api/ai/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: tool.action,
          imageUrl: config?.url || undefined,
          prompt: prompt?.trim() || undefined,
          style: style || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Erreur ${res.status}`);
      }
      if (data.resultUrl) {
        // For image-to-video, the result is a video URL — store differently
        if (tool.action === 'image-to-video') {
          showToast(`Vidéo générée ! (${data.creditsUsed} cr. utilisés)`, 'success');
          // Could set as rushUrl or download — for now just show toast with URL
          // TODO: integrate with rush/video sequence
        } else {
          onUpdate({ url: data.resultUrl });
          showToast(`${tool.label} terminé ! (${data.creditsUsed} cr.)`, 'success');
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur IA';
      showToast(msg, 'error');
    } finally {
      setAiLoading(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.url, onUpdate, showToast]);

  // ── Parse current object-position into x/y percentages ──
  const parseObjPos = (pos: string): { x: number; y: number } => {
    const parts = pos.split(/[\s%]+/).filter(Boolean).map(Number);
    return { x: parts[0] ?? 50, y: parts[1] ?? 50 };
  };

  // ── Drag-to-crop : POINTER EVENTS UNIFIÉS ──
  //
  // Bug logs PR #151 → user a `pointerdown` mais JAMAIS `mousedown`.
  // Conclusion : le navigateur préfère pointer events. Comme on écoutait
  // `mouseup` sur window, le drag DÉMARRAIT (via fallback pointerdown
  // qu'on appelait via handleCropPointerDown) mais NE S'ARRÊTAIT PAS
  // (pas de pointerup listener). Symptôme : "impossible de s'arrêter,
  // ça glisse sans fin, l'editeur ne s'update pas".
  //
  // Fix : pipeline 100% pointer events avec setPointerCapture pour
  // que les events suivent le curseur même hors du cropContainer.
  // Aucun listener window — tout est sur l'élément, capturé.
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);

  const updateCropFromClient = useCallback((clientX: number, clientY: number) => {
    if (!cropStartRef.current || !cropContainerRef.current) return;
    const rect = cropContainerRef.current.getBoundingClientRect();
    const dx = clientX - cropStartRef.current.x;
    const dy = clientY - cropStartRef.current.y;
    const pctX = (dx / rect.width) * -100;
    const pctY = (dy / rect.height) * -100;
    const newX = Math.max(0, Math.min(100, cropStartRef.current.startPosX + pctX));
    const newY = Math.max(0, Math.min(100, cropStartRef.current.startPosY + pctY));
    const newPos = `${Math.round(newX)}% ${Math.round(newY)}%`;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      // Log sur le premier vrai mouvement détecté
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) {
        console.log('[ImageEditorPanel] FIRST MOVE detected', { dx, dy, newPos });
      }
    }
    onUpdateRef.current({ objectPosition: newPos });
  }, []);

  const handleCropPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Si l'utilisateur clique sur un bouton (Détacher) ou autre élément
    // interactif DANS le cropContainer, ne PAS démarrer le drag — sinon
    // setPointerCapture détourne le pointerup vers le cropContainer et
    // le click sur le bouton ne fire jamais.
    const target = e.target as HTMLElement;
    if (target.closest('button')) {
      console.log('[ImageEditorPanel] pointerdown on interactive child — skip drag');
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const cur = parseObjPos(objPos);
    cropStartRef.current = { x: e.clientX, y: e.clientY, startPosX: cur.x, startPosY: cur.y };
    setIsDraggingCrop(true);
    // Capture le pointer : tous les events suivants (move/up) seront
    // dirigés vers ce même élément, même si le curseur sort de sa zone.
    let captureOk = false;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
      captureOk = true;
    } catch (err) {
      console.warn('[ImageEditorPanel] setPointerCapture FAILED', err);
    }
    console.log('[ImageEditorPanel] pointerdown START', { seqKey, startPos: cur, client: { x: e.clientX, y: e.clientY }, pointerId: e.pointerId, captureOk });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objPos, seqKey]);

  // Throttle les logs de move : trop verbeux à 60fps. On log juste 1
  // sur 10 ticks pour confirmer que le handler fire.
  const moveLogCounterRef = useRef(0);
  const handleCropPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!cropStartRef.current) {
      // Log si pointermove fire SANS qu'on soit en drag — ça veut
      // dire que le pointerdown n'a pas attaché cropStartRef
      // correctement (ou qu'on a déjà release).
      moveLogCounterRef.current = (moveLogCounterRef.current + 1) % 30;
      if (moveLogCounterRef.current === 0) {
        console.warn('[ImageEditorPanel] pointermove FIRED but cropStartRef is null (no active drag)');
      }
      return;
    }
    e.preventDefault();
    moveLogCounterRef.current = (moveLogCounterRef.current + 1) % 10;
    if (moveLogCounterRef.current === 0) {
      console.log('[ImageEditorPanel] pointermove tick', { client: { x: e.clientX, y: e.clientY } });
    }
    updateCropFromClient(e.clientX, e.clientY);
  }, [updateCropFromClient]);

  const handleCropPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!cropStartRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    setIsDraggingCrop(false);
    cropStartRef.current = null;
    console.log('[ImageEditorPanel] pointerup END', { seqKey, pointerId: e.pointerId });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seqKey]);

  return (
    <div className="space-y-3">
      {/* Header info */}
      <div className="text-[10px] text-gray-400">
        Image de fond pour la séquence{' '}
        <span className="text-white font-medium">{SEQ_LABELS[seqKey]}</span>.
        Si aucune image, l&apos;éditeur utilise l&apos;image globale (Pexels / poster).
      </div>

      {/* ── Toggle pour cacher temporairement le gradient overlay du
           preview, sans modifier la config user. Utile pour voir clairement
           le recadrage en live (le gradient peut sinon masquer le bg shift). */}
      {config?.url && onTogglePreviewGradient && (
        <button
          type="button"
          onClick={onTogglePreviewGradient}
          className={`w-full flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] font-medium transition ${
            previewGradientHidden
              ? 'bg-purple-600/30 text-purple-300 ring-1 ring-purple-500/40'
              : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
          }`}
          title="Cacher temporairement le gradient pour voir l'image clairement (n'affecte pas l'export)"
        >
          {previewGradientHidden ? '👁️ Gradient masqué (cliquer pour réafficher)' : '👁️‍🗨️ Cacher le gradient pour voir l\'image'}
        </button>
      )}

      {/* ── Image preview + drag-to-crop + detach ── */}
      {config?.url ? (
        <div className="space-y-2">
          <div
            ref={cropContainerRef}
            className={`relative rounded overflow-hidden bg-gray-800 border ${isDraggingCrop ? 'border-purple-500' : 'border-gray-700'} select-none`}
            style={{
              cursor: isDraggingCrop ? 'grabbing' : 'grab',
              touchAction: 'none',
              pointerEvents: 'auto',
              userSelect: 'none',
              WebkitUserSelect: 'none',
            }}
            // Pipeline UNIQUEMENT pointer events. setPointerCapture (dans
            // handleCropPointerDown) garantit que pointermove + pointerup
            // arrivent sur ce même élément même si le curseur sort de la
            // zone. Aucun listener window → impossible d'avoir un drag qui
            // se "perd" ou ne s'arrête pas.
            onPointerDown={handleCropPointerDown}
            onPointerMove={handleCropPointerMove}
            onPointerUp={handleCropPointerUp}
            onPointerCancel={handleCropPointerUp}
          >
            <img
              src={config.url}
              alt={`bg ${seqKey}`}
              className="w-full h-28 object-cover pointer-events-none"
              draggable={false}
              style={{
                opacity: config.opacity ?? 1,
                filter: buildCssFilter(config.filters),
                objectPosition: objPos,
              }}
            />
            {/* Crosshair overlay showing focal point */}
            <div className="absolute inset-0 pointer-events-none" style={{ opacity: isDraggingCrop ? 0.8 : 0.3 }}>
              {(() => {
                const { x, y } = parseObjPos(objPos);
                return (
                  <>
                    <div className="absolute bg-purple-400" style={{ left: `${x}%`, top: 0, width: '1px', height: '100%' }} />
                    <div className="absolute bg-purple-400" style={{ top: `${y}%`, left: 0, width: '100%', height: '1px' }} />
                    <div className="absolute w-2.5 h-2.5 rounded-full border-2 border-purple-400 bg-purple-500/50" style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }} />
                  </>
                );
              })()}
            </div>
            {/* Drag hint */}
            <div className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[8px] text-gray-300 flex items-center gap-1 pointer-events-none">
              <Move size={8} /> Glisser pour recadrer
            </div>
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

      {/* ── Quick crop presets ── */}
      {config?.url && objPos !== '50% 50%' && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onUpdate({ objectPosition: '50% 50%' })}
            className="text-[9px] text-purple-400 hover:text-purple-300 flex items-center gap-1"
          >
            <Move size={9} /> Recentrer
          </button>
          <span className="text-[8px] text-gray-600 font-mono">{objPos}</span>
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

      {/* ── AI Tools ── */}
      <div className="pt-2 border-t border-gray-800">
        <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-1.5">
          Outils IA
        </div>

        {/* AI loading indicator */}
        {aiLoading && (
          <div className="mb-2 rounded bg-purple-900/30 border border-purple-700/50 px-2 py-2 text-[10px] text-purple-300 flex items-center gap-2">
            <div className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
            {AI_TOOLS.find(t => t.action === aiLoading)?.label} en cours…
          </div>
        )}

        {/* Prompt input (shown when a tool needs text input) */}
        {aiPromptFor && !AI_TOOLS.find(t => t.action === aiPromptFor)?.needsStyle && (
          <div className="mb-2 space-y-1.5">
            <input
              type="text"
              autoFocus
              placeholder={AI_TOOLS.find(t => t.action === aiPromptFor)?.promptPlaceholder || 'Décrivez…'}
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && aiPrompt.trim()) {
                  const tool = AI_TOOLS.find(t => t.action === aiPromptFor);
                  if (tool) runAiTool(tool, aiPrompt);
                }
                if (e.key === 'Escape') setAiPromptFor(null);
              }}
              className="w-full rounded bg-gray-800 border border-purple-600 px-2 py-1.5 text-[10px] text-white focus:outline-none focus:border-purple-400"
            />
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => {
                  const tool = AI_TOOLS.find(t => t.action === aiPromptFor);
                  if (tool && aiPrompt.trim()) runAiTool(tool, aiPrompt);
                }}
                disabled={!aiPrompt.trim()}
                className="flex-1 rounded bg-purple-600 hover:bg-purple-700 disabled:opacity-40 px-2 py-1 text-[10px] text-white transition-colors"
              >
                Lancer ({AI_TOOLS.find(t => t.action === aiPromptFor)?.credits} cr.)
              </button>
              <button
                type="button"
                onClick={() => setAiPromptFor(null)}
                className="rounded bg-gray-700 hover:bg-gray-600 px-2 py-1 text-[10px] text-gray-300 transition-colors"
              >
                Annuler
              </button>
            </div>
          </div>
        )}

        {/* Style selector (shown for style-transfer) */}
        {aiPromptFor === 'style-transfer' && (
          <div className="mb-2 space-y-1.5">
            <div className="text-[9px] text-gray-400 mb-1">Choisir un style :</div>
            <div className="grid grid-cols-2 gap-1">
              {STYLE_PRESETS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => {
                    setAiStyle(s.value);
                    const tool = AI_TOOLS.find(t => t.action === 'style-transfer');
                    if (tool) runAiTool(tool, undefined, s.value);
                  }}
                  className={`rounded px-2 py-1.5 text-[9px] transition-colors ${
                    aiStyle === s.value
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => { setAiPromptFor(null); setAiStyle(null); }}
              className="w-full rounded bg-gray-700 hover:bg-gray-600 px-2 py-1 text-[10px] text-gray-300 transition-colors"
            >
              Annuler
            </button>
          </div>
        )}

        {/* Tool buttons */}
        <div className="grid grid-cols-2 gap-1.5">
          {AI_TOOLS.map((tool) => {
            const isLoading = aiLoading === tool.action;
            const needsImage = tool.needsImage && !config?.url;
            const isDisabled = isLoading || !!aiLoading || (needsImage && tool.action !== 'generate-bg');
            return (
              <button
                key={tool.action}
                type="button"
                disabled={isDisabled}
                onClick={() => {
                  if (tool.needsPrompt) {
                    setAiPromptFor(tool.action);
                    setAiPrompt('');
                  } else if (tool.needsStyle) {
                    setAiPromptFor(tool.action);
                    setAiStyle(null);
                  } else {
                    runAiTool(tool);
                  }
                }}
                title={needsImage ? 'Uploadez d\'abord une image' : `${tool.label} (${tool.credits} cr.)`}
                className={`rounded px-2 py-1.5 text-[10px] flex items-center gap-1 transition-colors ${
                  isDisabled
                    ? 'bg-gray-800/60 text-gray-600 cursor-not-allowed opacity-50'
                    : 'bg-gray-800/80 text-gray-300 hover:bg-purple-700/50 hover:text-white cursor-pointer'
                }`}
              >
                {isLoading ? (
                  <div className="w-3 h-3 border border-purple-400 border-t-transparent rounded-full animate-spin" />
                ) : (
                  tool.icon
                )}
                <span className="flex-1 text-left">{tool.label}</span>
                <span className="text-[8px] text-gray-500">{tool.credits}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
