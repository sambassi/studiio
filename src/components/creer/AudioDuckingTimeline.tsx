'use client';

import React from 'react';
import { Plus, Trash2, Wand2, Loader2 } from 'lucide-react';

export interface AudioKeyframe {
  id: string;
  time: number;
  musicVolume: number;
  rushVolume: number;
}

interface Props {
  keyframes: AudioKeyframe[];
  onChange: (next: AudioKeyframe[]) => void;
  totalDuration: number;
  rushUrl: string | null;
  autoDuckRunning: boolean;
  onAutoDuck: () => void | Promise<void>;
  /** When set, render a vertical playhead line at this time (seconds)
   *  on the timeline bar. Driven by AudioMixPreview rAF tick. */
  playheadTime?: number | null;
}

/**
 * Timeline ducking editor: a row of dots along the montage duration, each
 * dot representing one keyframe. Clicking the bar adds a keyframe at the
 * clicked time. Each keyframe exposes two vertical-ish sliders (music
 * volume + rush volume) in a compact row below. The ducking curve is
 * applied by the composer via `sampleKeyframes`.
 */
export default function AudioDuckingTimeline({
  keyframes,
  onChange,
  totalDuration,
  rushUrl,
  autoDuckRunning,
  onAutoDuck,
  playheadTime,
}: Props) {
  const duration = Math.max(1, totalDuration); // never divide by zero
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);

  const addKeyframeAt = (time: number) => {
    const clampedTime = Math.max(0, Math.min(duration, time));
    // Inherit volumes from the most recent prior keyframe so a click
    // doesn't reset the curve unexpectedly.
    const prior = sorted.filter((k) => k.time <= clampedTime).pop();
    const next: AudioKeyframe = {
      id: `kf-${Math.round(clampedTime * 100)}-${Math.random().toString(36).slice(2, 6)}`,
      time: clampedTime,
      musicVolume: prior?.musicVolume ?? 1,
      rushVolume: prior?.rushVolume ?? 0.5,
    };
    onChange([...sorted, next].sort((a, b) => a.time - b.time));
  };

  const updateKeyframe = (id: string, patch: Partial<AudioKeyframe>) => {
    onChange(sorted.map((k) => (k.id === id ? { ...k, ...patch } : k)));
  };

  const removeKeyframe = (id: string) => {
    if (sorted.length <= 1) return; // always keep one anchor
    onChange(sorted.filter((k) => k.id !== id));
  };

  return (
    <div className="mt-3 rounded-lg border border-gray-800 bg-gray-900/60 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
          Ducking audio
        </span>
        <button
          onClick={onAutoDuck}
          disabled={!rushUrl || autoDuckRunning}
          className="flex items-center gap-1 rounded bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 disabled:cursor-not-allowed px-2 py-1 text-[10px] font-medium text-white transition"
          title={rushUrl ? "Détecter les voix dans le rush et ducker la musique automatiquement" : "Upload un rush vidéo pour auto-duck"}
        >
          {autoDuckRunning
            ? <Loader2 size={11} className="animate-spin" />
            : <Wand2 size={11} />}
          Auto-duck
        </button>
      </div>

      {/* Timeline bar — click to add a keyframe */}
      <div
        className="relative h-7 rounded bg-gray-800 cursor-crosshair overflow-hidden"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          addKeyframeAt(pct * duration);
        }}
        title={`Cliquer pour ajouter un keyframe · durée totale ${duration.toFixed(1)}s`}
      >
        {sorted.map((kf) => {
          const leftPct = Math.max(0, Math.min(100, (kf.time / duration) * 100));
          return (
            <div
              key={kf.id}
              className="absolute top-0 bottom-0 w-0.5 bg-cyan-400"
              style={{ left: `${leftPct}%` }}
              title={`t=${kf.time.toFixed(1)}s · musique ${Math.round(kf.musicVolume * 100)}% · rush ${Math.round(kf.rushVolume * 100)}%`}
            />
          );
        })}
        {typeof playheadTime === 'number' && playheadTime >= 0 && (
          <div
            className="absolute top-0 bottom-0 w-[2px] bg-purple-400 shadow-[0_0_6px_rgba(168,85,247,0.8)] pointer-events-none"
            style={{ left: `${Math.max(0, Math.min(100, (playheadTime / duration) * 100))}%` }}
            title={`Lecture t=${playheadTime.toFixed(1)}s`}
          />
        )}
        <div className="absolute bottom-0 left-0 right-0 flex justify-between text-[8px] text-gray-500 px-1 pb-0.5 pointer-events-none">
          <span>0s</span>
          <span>{duration.toFixed(1)}s</span>
        </div>
      </div>

      {/* Keyframe list — two sliders + delete per keyframe */}
      <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
        {sorted.map((kf, i) => (
          <div key={kf.id} className="rounded bg-gray-800/60 p-1.5">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-[9px] font-semibold text-cyan-400 min-w-[24px]">#{i + 1}</span>
              <input
                type="number"
                min={0}
                max={duration}
                step={0.1}
                value={kf.time.toFixed(2)}
                onChange={(e) => updateKeyframe(kf.id, { time: Math.max(0, Math.min(duration, parseFloat(e.target.value) || 0)) })}
                className="w-16 bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-[9px] text-white focus:outline-none focus:border-cyan-500"
              />
              <span className="text-[9px] text-gray-500">s</span>
              <button
                onClick={() => removeKeyframe(kf.id)}
                disabled={sorted.length <= 1}
                className="ml-auto rounded bg-red-900/50 hover:bg-red-900/80 p-1 text-red-300 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Supprimer ce keyframe"
              >
                <Trash2 size={10} />
              </button>
            </div>
            <div className="space-y-1">
              <label className="flex items-center gap-1.5 text-[9px] text-gray-300">
                <span className="w-14 text-gray-400">Musique</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(kf.musicVolume * 100)}
                  onChange={(e) => updateKeyframe(kf.id, { musicVolume: parseInt(e.target.value, 10) / 100 })}
                  className="flex-1 accent-cyan-500"
                />
                <span className="w-9 text-right text-cyan-300 font-mono">{Math.round(kf.musicVolume * 100)}%</span>
              </label>
              <label className="flex items-center gap-1.5 text-[9px] text-gray-300">
                <span className="w-14 text-gray-400">Son rush</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(kf.rushVolume * 100)}
                  onChange={(e) => updateKeyframe(kf.id, { rushVolume: parseInt(e.target.value, 10) / 100 })}
                  className="flex-1 accent-orange-500"
                />
                <span className="w-9 text-right text-orange-300 font-mono">{Math.round(kf.rushVolume * 100)}%</span>
              </label>
            </div>
          </div>
        ))}
        {sorted.length === 0 && (
          <button
            onClick={() => addKeyframeAt(0)}
            className="w-full flex items-center justify-center gap-1 rounded border border-dashed border-gray-700 px-2 py-2 text-[10px] text-gray-400 hover:border-cyan-500 hover:text-cyan-300 transition"
          >
            <Plus size={12} /> Ajouter un keyframe
          </button>
        )}
      </div>

      <p className="text-[9px] text-gray-500 leading-snug">
        Click sur la barre pour ajouter un keyframe. La musique et le son du rush utilisent la valeur du keyframe actif (curve étagée, pas d'interpolation linéaire en v1).
      </p>
    </div>
  );
}
