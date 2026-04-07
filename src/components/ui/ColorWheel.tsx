'use client';

import React, { useState } from 'react';
import { HexColorPicker, HexColorInput } from 'react-colorful';

interface ColorWheelProps {
  color: string;
  onChange: (color: string) => void;
  label?: string;
  showOpacity?: boolean;
  opacity?: number;
  onOpacityChange?: (opacity: number) => void;
}

export default function ColorWheel({
  color,
  onChange,
  label,
  showOpacity = false,
  opacity = 1,
  onOpacityChange,
}: ColorWheelProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="space-y-1.5">
      {label && (
        <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">{label}</span>
      )}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="h-7 w-7 rounded-lg border border-gray-600 cursor-pointer transition-all hover:scale-110 flex-shrink-0"
          style={{ background: color }}
        />
        <HexColorInput
          color={color}
          onChange={onChange}
          prefixed
          className="flex-1 rounded bg-gray-800 border border-gray-700 px-2 py-1 text-[10px] text-white font-mono focus:border-purple-500 focus:outline-none w-20"
        />
      </div>
      {expanded && (
        <div className="pt-1">
          <HexColorPicker
            color={color}
            onChange={onChange}
            style={{ width: '100%', height: '120px' }}
          />
        </div>
      )}
      {showOpacity && onOpacityChange && (
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-gray-500 w-10">Opacité</span>
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(opacity * 100)}
            onChange={(e) => onOpacityChange(parseInt(e.target.value) / 100)}
            className="flex-1 h-1 rounded-lg appearance-none bg-gray-700 accent-purple-500 cursor-pointer"
          />
          <span className="text-[9px] text-gray-400 w-7">{Math.round(opacity * 100)}%</span>
        </div>
      )}
    </div>
  );
}
