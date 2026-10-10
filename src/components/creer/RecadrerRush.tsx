'use client';

/**
 * « RECADRER LA VIDÉO » — Créer, séquence Vidéo.
 *
 * Le rush remplit le cadre du format choisi (aucune bande, aucun étirement) ;
 * on choisit ce qui reste visible en le faisant glisser et en zoomant. Le
 * recadrage est enregistré tel que le compositeur l'applique à l'export
 * (`rushTransform`) : l'aperçu ici, celui du plateau et le MP4 final tracent la
 * même image (`lib/creer/recadrage-rush.ts`).
 */
import { useRef, useState, type PointerEvent as PointerEventReact } from 'react';
import { createPortal } from 'react-dom';
import { Crosshair, X } from 'lucide-react';
import {
  RECADRAGE_RUSH_NEUTRE, RATIO_FORMAT, ZOOM_RUSH_MAX, ZOOM_RUSH_MIN, bornerRecadrageRush, styleRecadrageRush, type RecadrageRush,
} from '@/lib/creer/recadrage-rush';

type Format = '9:16' | '1:1' | '16:9';
const RATIO = RATIO_FORMAT;

export default function RecadrerRush(props: {
  url: string;
  format: Format;
  valeur: RecadrageRush;
  onChange: (t: RecadrageRush) => void;
  onFermer: () => void;
}) {
  const cadre = useRef<HTMLDivElement | null>(null);
  const [dimsSource, setDimsSource] = useState<{ l: number; h: number } | null>(null);
  const glisse = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  /** Les bornes viennent de la SOURCE et du cadre : on ne peut jamais tirer l'image hors du cadre. */
  const borner = (t: Partial<RecadrageRush>) => {
    const r = cadre.current?.getBoundingClientRect();
    return bornerRecadrageRush(t, dimsSource && r && r.width > 0
      ? { srcW: dimsSource.l, srcH: dimsSource.h, w: r.width, h: r.height }
      : { srcW: dimsSource?.l ?? 0, srcH: dimsSource?.h ?? 0, w: 0, h: 0 });
  };
  const changer = (t: Partial<RecadrageRush>) => props.onChange(borner({ ...props.valeur, ...t }));

  const debut = (e: PointerEventReact<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    glisse.current = { x: e.clientX, y: e.clientY, ox: props.valeur.offsetX, oy: props.valeur.offsetY };
  };
  const pendant = (e: PointerEventReact<HTMLDivElement>) => {
    const g = glisse.current; const r = cadre.current?.getBoundingClientRect();
    if (!g || !r || r.width === 0) return;
    changer({ offsetX: g.ox + (e.clientX - g.x) / r.width, offsetY: g.oy + (e.clientY - g.y) / r.height });
  };
  const fin = () => { glisse.current = null; };

  const ratio = RATIO[props.format];
  // Rendue dans <body> : montée depuis une section repliable du panneau, la
  // fenêtre disparaissait avec elle (display: none) et un ancêtre transformé
  // aurait décalé son `position: fixed`.
  const fenetre = (
    <div data-recadrer-rush role="dialog" aria-modal="true" aria-label="Recadrer la vidéo" className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="w-full max-w-lg card-base p-5 space-y-4 bg-[#0A0A0F]">
        <header className="flex items-center justify-between">
          <h3 className="font-semibold">Recadrer la vidéo — format {props.format}</h3>
          <button type="button" aria-label="Fermer" onClick={props.onFermer} className="p-1 text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
        </header>
        <p className="text-xs text-gray-400">La vidéo remplit tout le cadre {props.format}. Faites-la glisser pour choisir ce qui reste visible, zoomez pour resserrer. L’export utilise exactement ce cadrage.</p>
        <div
          ref={cadre}
          data-recadrer-rush-cadre={props.format}
          onPointerDown={debut}
          onPointerMove={pendant}
          onPointerUp={fin}
          onPointerCancel={fin}
          className="relative mx-auto overflow-hidden rounded-xl bg-black cursor-move select-none"
          style={{ aspectRatio: `${ratio}`, width: `min(100%, calc(55vh * ${ratio}))`, touchAction: 'none' }}
        >
          <video
            data-recadrer-rush-video
            src={props.url}
            muted
            loop
            autoPlay
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => setDimsSource({ l: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
            className="pointer-events-none"
            style={styleRecadrageRush(props.valeur, dimsSource && dimsSource.h > 0 ? { source: dimsSource.l / dimsSource.h, cadre: ratio } : null)}
          />
        </div>
        <label className="block space-y-1 text-xs text-gray-300">
          <span className="flex justify-between"><span>Zoom</span><span className="tabular-nums">{props.valeur.scale.toFixed(2)}×</span></span>
          <input
            data-recadrer-rush-zoom
            type="range"
            min={ZOOM_RUSH_MIN}
            max={ZOOM_RUSH_MAX}
            step={0.01}
            value={props.valeur.scale}
            onChange={(e) => changer({ scale: Number(e.target.value) })}
            className="w-full accent-purple-500"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" data-recadrer-rush-centrer onClick={() => changer({ offsetX: 0, offsetY: 0 })} className="button-ghost gap-1.5 !min-h-[32px] !text-xs"><Crosshair className="w-3.5 h-3.5" /> Centrer</button>
          <button type="button" data-recadrer-rush-reinitialiser onClick={() => props.onChange({ ...RECADRAGE_RUSH_NEUTRE })} className="button-ghost !min-h-[32px] !text-xs">Réinitialiser</button>
          <button type="button" data-recadrer-rush-terminer onClick={props.onFermer} className="button-primary !min-h-[32px] !text-xs ml-auto">Terminer</button>
        </div>
      </div>
    </div>
  );
  return typeof document === 'undefined' ? fenetre : createPortal(fenetre, document.body);
}
