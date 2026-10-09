'use client';

import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';

type Transform = { scale: number; offsetX: number; offsetY: number };

interface Props {
  isOpen: boolean;
  onClose: () => void;
  rush: { url: string; name: string; kind?: 'video' | 'image'; transform?: Transform } | null;
  format: 'reel' | 'tv' | '9:16' | '16:9' | '1:1' | string;
  onApply: (transform: Transform) => void;
}

const DEFAULT_T: Transform = { scale: 1, offsetX: 0, offsetY: 0 };

export default function CropRushModal({ isOpen, onClose, rush, format, onApply }: Props) {
  const isLandscape = format === 'tv' || format === '16:9';
  const isSquare = format === '1:1';
  const aspectRatio = isSquare ? '1 / 1' : isLandscape ? '16 / 9' : '9 / 16';
  const displayFormat = isSquare ? '1:1' : isLandscape ? '16:9' : '9:16';

  const [t, setT] = useState<Transform>(DEFAULT_T);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{ startX: number; startY: number; startOffX: number; startOffY: number } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setT(rush?.transform ? { ...rush.transform } : { ...DEFAULT_T });
    }
  }, [isOpen, rush]);

  if (!isOpen || !rush) return null;

  const clamp = (v: number) => Math.max(-1, Math.min(1, v));

  // Pointeur (souris ET doigt) : la même logique que le glisser d'origine.
  const onMouseDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      startOffX: t.offsetX,
      startOffY: t.offsetY,
    };
  };
  const onMouseMove = (e: React.PointerEvent) => {
    const ds = dragState.current;
    const el = containerRef.current;
    if (!ds || !el) return;
    const rect = el.getBoundingClientRect();
    const dx = (e.clientX - ds.startX) / rect.width;
    const dy = (e.clientY - ds.startY) / rect.height;
    setT((prev) => ({ ...prev, offsetX: clamp(ds.startOffX + dx), offsetY: clamp(ds.startOffY + dy) }));
  };
  const endDrag = () => { dragState.current = null; };

  const reset = () => setT({ ...DEFAULT_T });

  const isImage = rush.kind === 'image';
  // APERÇU = RENDU. Le moteur (`drawVideoSeq`) couvre le cadre (cover), zoome
  // de `scale` et décale le centre de `offsetX * largeur DU CADRE`. Le calque
  // fait donc exactement la taille du cadre : ses pourcentages de
  // translation sont ceux du cadre, pas du média (qui, en cover, peut
  // déborder et fausser le décalage).
  const calqueStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    transformOrigin: 'center center',
    transform: `translate(${t.offsetX * 100}%, ${t.offsetY * 100}%) scale(${t.scale})`,
    pointerEvents: 'none',
  };
  const mediaStyle: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Recadrer ${isImage ? "l'image" : 'la vidéo'} — cadre ${displayFormat}`} size="lg">
      <div className="space-y-4">
        <div
          ref={containerRef}
          data-recadrage-cadre={displayFormat}
          onPointerDown={onMouseDown}
          onPointerMove={onMouseMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={endDrag}
          className="relative mx-auto w-full bg-black overflow-hidden rounded-lg select-none cursor-move touch-none"
          style={{ aspectRatio, maxHeight: '60vh', maxWidth: isLandscape ? '100%' : isSquare ? '420px' : '360px' }}
        >
          <div data-recadrage-calque style={calqueStyle}>
            {isImage ? (
              <img src={rush.url} alt={rush.name} style={mediaStyle} />
            ) : (
              <video
                src={rush.url}
                muted
                loop
                autoPlay
                playsInline
                style={mediaStyle}
              />
            )}
          </div>
          <div className="absolute inset-0 border-2 border-white/20 pointer-events-none" />
        </div>

        <div>
          <label className="block text-sm text-gray-300 mb-1">
            Zoom : {t.scale.toFixed(2)}x
          </label>
          <input
            type="range"
            min="1"
            max="3"
            step="0.05"
            value={t.scale}
            onChange={(e) => setT((prev) => ({ ...prev, scale: parseFloat(e.target.value) }))}
            className="w-full"
          />
        </div>

        <p className="text-xs text-gray-500">
          Glisse {isImage ? "l'image" : 'la vidéo'} pour repositionner. Le cadre blanc représente la zone visible dans le montage final.
        </p>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-800">
          <button
            type="button"
            onClick={reset}
            className="px-3 py-2 text-sm text-gray-300 hover:text-white transition"
          >
            Centrer
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg bg-gray-700 text-white hover:bg-gray-600 transition"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={() => { onApply(t); }}
              className="px-4 py-2 text-sm rounded-lg bg-purple-600 text-white hover:bg-purple-700 transition"
            >
              Appliquer
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
