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
}

export default function FloatingPanel({
  title,
  icon,
  isOpen,
  onClose,
  initialX = 100,
  initialY = 100,
  children,
  accentColor = '#D91CD2',
}: FloatingPanelProps) {
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  // Reset position when panel opens with new initialX/Y
  useEffect(() => {
    if (isOpen) setPos({ x: initialX, y: initialY });
  }, [isOpen, initialX, initialY]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only drag from header area
    if ((e.target as HTMLElement).closest('[data-panel-body]')) return;
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

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      className="fixed z-[100] shadow-2xl"
      style={{
        left: `${pos.x}px`,
        top: `${pos.y}px`,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      <div
        className="rounded-xl overflow-hidden"
        style={{
          background: 'rgba(10, 10, 20, 0.92)',
          border: `1.5px solid ${accentColor}50`,
          boxShadow: `0 0 30px ${accentColor}15, 0 8px 32px rgba(0,0,0,0.6)`,
          minWidth: '220px',
          maxWidth: '300px',
        }}
      >
        {/* Header — draggable */}
        <div
          className="flex items-center justify-between px-3 py-2 cursor-grab active:cursor-grabbing select-none"
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

        {/* Body */}
        <div data-panel-body className="px-3 py-2.5 space-y-2.5 max-h-[60vh] overflow-y-auto custom-scrollbar">
          {children}
        </div>
      </div>
    </div>
  );
}
