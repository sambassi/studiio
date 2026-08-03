'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X } from 'lucide-react';

interface FloatingPanelProps {
  title: string;
  icon?: string;
  isOpen: boolean;
  onClose: () => void;
  initialX?: number;
  initialY?: number;
  children: React.ReactNode;
  accentColor?: string;
  /**
   * Poignee de coin pour redimensionner. Defaut `false` : les panneaux
   * existants gardent leur largeur contrainte (220-300 px) et leur corps
   * borne a 60 % de la hauteur d'ecran.
   */
  resizable?: boolean;
  /** Taille de depart, quand le panneau est redimensionnable. */
  initialWidth?: number;
  initialHeight?: number;
  /**
   * Fermer au clic exterieur. Defaut `true` — le comportement de tous les
   * panneaux contextuels, qu'un clic ailleurs doit congedier.
   *
   * A passer a `false` pour une fenetre qu'on garde ouverte PENDANT qu'on
   * agit ailleurs : sans cela, regler un curseur dans le panneau de gauche
   * la refermerait aussitot.
   */
  closeOnClickOutside?: boolean;
  /** Position et taille apres chaque geste — pour les memoriser. */
  onGeometryChange?: (geometry: { x: number; y: number; w: number; h: number }) => void;
}

/** Bornes de redimensionnement — sous ce seuil le panneau n'affiche plus rien. */
const MIN_W = 240;
const MIN_H = 200;

export default function FloatingPanel({
  title,
  icon,
  isOpen,
  onClose,
  initialX = 100,
  initialY = 100,
  children,
  accentColor = '#D91CD2',
  resizable = false,
  initialWidth = 360,
  initialHeight = 520,
  closeOnClickOutside = true,
  onGeometryChange,
}: FloatingPanelProps) {
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const [size, setSize] = useState({ w: initialWidth, h: initialHeight });
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const panelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Taille rappelee a l'ouverture, comme la position juste en dessous.
  useEffect(() => {
    if (isOpen) setSize({ w: initialWidth, h: initialHeight });
  }, [isOpen, initialWidth, initialHeight]);

  // Reset position when panel opens with new initialX/Y
  useEffect(() => {
    if (isOpen) setPos({ x: initialX, y: initialY });
  }, [isOpen, initialX, initialY]);

  // Handle click outside to close
  useEffect(() => {
    if (!isOpen || !closeOnClickOutside) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    // Add a small delay to avoid closing immediately on the click that opened it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 50);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose, closeOnClickOutside]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only drag from header area — ni le corps, ni la poignee de coin, qui
    // redimensionne : sans cette seconde garde, tirer la poignee deplacerait
    // la fenetre au lieu de l'agrandir.
    const cible = e.target as HTMLElement;
    if (cible.closest('[data-panel-body]') || cible.closest('[data-panel-resize]')) return;
    e.preventDefault();
    setDragging(true);
    const rect = panelRef.current?.getBoundingClientRect();
    if (rect) {
      dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: MouseEvent) => {
      setPos({
        x: Math.max(0, e.clientX - dragOffset.current.x),
        y: Math.max(0, e.clientY - dragOffset.current.y),
      });
    };
    const handleUp = () => setDragging(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [dragging]);

  /** Prise de la poignee de coin — la taille suit le curseur, en delta. */
  const handleResizeDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setResizing(true);
      resizeStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
    },
    [size.w, size.h],
  );

  useEffect(() => {
    if (!resizing) return;
    const handleMove = (e: MouseEvent) => {
      const debut = resizeStart.current;
      // Borne haute = ce qui reste a l'ecran depuis le coin haut-gauche du
      // panneau : au-dela, la poignee sortirait du viewport et deviendrait
      // impossible a reprendre.
      setSize({
        w: Math.max(MIN_W, Math.min(window.innerWidth - pos.x - 8, debut.w + (e.clientX - debut.x))),
        h: Math.max(MIN_H, Math.min(window.innerHeight - pos.y - 8, debut.h + (e.clientY - debut.y))),
      });
    };
    const handleUp = () => setResizing(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [resizing, pos.x, pos.y]);

  // Geometrie rapportee a la FIN du geste seulement : a chaque frame, elle
  // ferait ecrire le localStorage des dizaines de fois par seconde.
  useEffect(() => {
    if (!isOpen || dragging || resizing || !onGeometryChange) return;
    onGeometryChange({ x: pos.x, y: pos.y, w: size.w, h: size.h });
  }, [isOpen, dragging, resizing, pos.x, pos.y, size.w, size.h, onGeometryChange]);

  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      // Pas de transition pendant un geste : elle transforme le suivi du
      // curseur en glissade molle de 200 ms.
      className={`fixed z-[100] shadow-2xl ease-out ${dragging || resizing ? '' : 'transition-all duration-200'}`}
      style={{
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        opacity: isOpen ? 1 : 0,
        transform: isOpen ? 'scale(1)' : 'scale(0.95)',
      }}
    >
      <div
        ref={panelRef}
        className={`rounded-xl overflow-hidden relative ${resizable ? 'flex flex-col' : ''}`}
        style={{
          background: 'rgba(10, 10, 20, 0.92)',
          border: `1.5px solid ${accentColor}50`,
          boxShadow: `0 0 30px ${accentColor}15, 0 8px 32px rgba(0,0,0,0.6)`,
          // Redimensionnable, la taille est celle que l'utilisateur a reglee ;
          // sinon, les bornes historiques, inchangees.
          ...(resizable
            ? { width: size.w, height: size.h, minWidth: MIN_W, minHeight: MIN_H }
            : { minWidth: '220px', maxWidth: '300px' }),
        }}
      >
        {/* Header — draggable */}
        <div
          className="flex items-center justify-between px-3 py-2 cursor-grab active:cursor-grabbing select-none shrink-0"
          style={{ borderBottom: `1px solid ${accentColor}30` }}
          onMouseDown={handleMouseDown}
        >
          <div className="flex items-center gap-2">
            {icon && <span className="text-sm">{icon}</span>}
            <span className="text-xs font-bold text-white uppercase tracking-wider">{title}</span>
          </div>
          <button
            onClick={onClose}
            className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-white/10 transition-colors"
          >
            <X size={12} className="text-gray-400" />
          </button>
        </div>

        {/* Body — redimensionnable, il occupe la hauteur restante exacte ;
            sinon il garde sa borne historique a 60 % de l'ecran. */}
        <div
          data-panel-body
          className={
            resizable
              ? 'flex-1 min-h-0 overflow-auto custom-scrollbar p-2'
              : 'px-3 py-2.5 space-y-2.5 max-h-[60vh] overflow-y-auto custom-scrollbar'
          }
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {children}
        </div>

        {/* Poignee de coin — deux traits obliques, la convention des fenetres
            redimensionnables. Hors du corps, pour que le clic ne soit pas
            arrete par le `stopPropagation` ci-dessus. */}
        {resizable && (
          <div
            data-panel-resize
            onMouseDown={handleResizeDown}
            title="Redimensionner"
            role="separator"
            aria-label="Redimensionner la fenêtre"
            className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
            style={{
              background: `linear-gradient(135deg, transparent 0 50%, ${accentColor}80 50% 60%, transparent 60% 72%, ${accentColor}80 72% 82%, transparent 82%)`,
            }}
          />
        )}
      </div>
    </div>
  );
}
