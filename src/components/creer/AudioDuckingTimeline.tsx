'use client';

import React, { useState } from 'react';
import { Plus, Trash2, Wand2, Loader2, ChevronDown, ChevronRight, Volume2, VolumeX, Mic, RotateCcw } from 'lucide-react';

export interface AudioKeyframe {
  id: string;
  time: number;
  musicVolume: number;
  rushVolume: number;
  /** Voice-off volume 0-1 (legacy + per-sequence voices share this). */
  voiceVolume?: number;
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
  /**
   * `true` = rendu SANS cadre ni marge propres, pour s'inserer dans un bloc
   * qui fournit deja les siens. Defaut `false` : les appelants existants
   * (dont /creer, qui monte ce composant seul) gardent exactement le meme
   * rendu qu'avant.
   */
  flush?: boolean;
  /**
   * « La musique s'adapte a la voix » — l'auto-mix baisse aussi la musique
   * pendant que la voix off parle, pas seulement pendant que le rush parle.
   *
   * `undefined` = interrupteur masque : un parent qui ne gere pas l'option
   * ne voit rien de nouveau. C'est le cas de `/dashboard/creer`.
   */
  duckOnVoice?: boolean;
  onDuckOnVoiceChange?: (next: boolean) => void;
  /** Grise l'interrupteur quand il n'y a aucune voix off a analyser. */
  hasVoice?: boolean;
  /**
   * Niveaux mesures pendant l'ecoute, affiches DANS la ligne de chaque piste.
   * Absents, aucune jauge n'apparait — rendu inchange pour les appelants qui
   * ne les fournissent pas (`/dashboard/creer`).
   */
  levels?: { music: number; rush: number; voice: number };
}

/**
 * Timeline ducking editor: a row of dots along the montage duration, each
 * dot representing one keyframe. Clicking the bar adds a keyframe at the
 * clicked time. Each keyframe exposes two vertical-ish sliders (music
 * volume + rush volume) in a compact row below. The ducking curve is
 * applied by the composer via `sampleKeyframes`.
 */
/** Valeurs de repli, alignees sur ce que le compositeur applique par defaut. */
const FALLBACK = { time: 0, musicVolume: 1, rushVolume: 0.5, voiceVolume: 1 };

/**
 * Rend un keyframe sur : tout champ absent, non numerique ou infini est
 * remplace par son repli. Un keyframe valide ressort INCHANGE — c'est ce qui
 * garantit qu'aucune courbe existante n'est modifiee par ce garde-fou.
 */
export function sanitizeKeyframe(kf: AudioKeyframe): AudioKeyframe {
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const time = Math.max(0, num(kf?.time, FALLBACK.time));
  const musicVolume = num(kf?.musicVolume, FALLBACK.musicVolume);
  const rushVolume = num(kf?.rushVolume, FALLBACK.rushVolume);
  // `voiceVolume` est optionnel par contrat : `undefined` reste `undefined`,
  // les appelants le lisent deja en `?? 1`. On ne corrige que l'aberrant.
  const voiceVolume = kf?.voiceVolume === undefined
    ? undefined
    : num(kf.voiceVolume, FALLBACK.voiceVolume);
  // `id` compte autant que les nombres : il sert de cle React ET de cible aux
  // modifications par keyframe. Absent, la ligne devient immodifiable.
  const hasId = typeof kf?.id === 'string' && kf.id.length > 0;
  if (
    hasId && time === kf?.time && musicVolume === kf?.musicVolume
    && rushVolume === kf?.rushVolume && voiceVolume === kf?.voiceVolume
  ) {
    return kf; // rien a reparer : meme reference, zero re-rendu inutile
  }
  return { ...kf, id: hasId ? kf.id : `kf-${Math.round(time * 100)}`, time, musicVolume, rushVolume, voiceVolume };
}

export default function AudioDuckingTimeline({
  keyframes,
  onChange,
  totalDuration,
  rushUrl,
  autoDuckRunning,
  onAutoDuck,
  playheadTime,
  flush = false,
  duckOnVoice,
  onDuckOnVoiceChange,
  hasVoice = false,
  levels,
}: Props) {
  const duration = Math.max(1, totalDuration); // never divide by zero
  // ⚠️ Les keyframes viennent d'ailleurs : brouillon restaure, post relu,
  // generateur d'auto-mix. Un seul champ manquant suffisait a faire tomber
  // toute la page — `kf.time.toFixed()` sur `undefined` leve, et le crash
  // survenait DANS le map de rendu, donc au deploiement du bloc « Avancé ».
  // On repare au lieu d'ecarter : ecarter un keyframe malforme le ferait
  // disparaitre a la premiere modification globale (les mutations remappent
  // cette liste), c'est-a-dire une perte de donnee silencieuse.
  const sorted = [...keyframes].map(sanitizeKeyframe).sort((a, b) => a.time - b.time);
  // Mode avancé: timeline + keyframes individuels. Caché par défaut pour
  // que le panneau reste lisible — l'utilisateur lambda n'a besoin que
  // des 3 sliders globaux. Auto-duck reste accessible directement.
  const [advancedOpen, setAdvancedOpen] = useState(false);

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
      voiceVolume: prior?.voiceVolume ?? 1,
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

  // Global sliders: applied to every keyframe at once. Display reflects the
  // first keyframe — a stable proxy when all keyframes share the same value
  // (the common case once the user has touched a global slider).
  const globalMusicValue = Math.round(((sorted[0]?.musicVolume ?? 1)) * 100);
  const globalRushValue = Math.round(((sorted[0]?.rushVolume ?? 1)) * 100);
  const globalVoiceValue = Math.round(((sorted[0]?.voiceVolume ?? 1)) * 100);
  const setGlobalMusic = (pct: number) => {
    const v = pct / 100;
    onChange(sorted.map((k) => ({ ...k, musicVolume: v })));
  };
  const setGlobalRush = (pct: number) => {
    const v = pct / 100;
    onChange(sorted.map((k) => ({ ...k, rushVolume: v })));
  };
  const setGlobalVoice = (pct: number) => {
    const v = pct / 100;
    onChange(sorted.map((k) => ({ ...k, voiceVolume: v })));
  };

  // ── Coupure par piste ───────────────────────────────────────────────────
  // Couper = mettre le niveau de la piste a 0 sur TOUS les keyframes. C'est ce
  // qui rend la coupure fidele : l'export lit les memes keyframes que l'ecoute,
  // donc une piste coupee est reellement absente du rendu — sans une seule
  // ligne touchee dans le pipeline d'export.
  //
  // Le niveau d'avant est garde en memoire ici (et non persiste) pour que
  // reactiver rende exactement ce que l'utilisateur avait regle. Un rechargement
  // pendant une coupure laisse la piste a 0, ce qui reste coherent : c'est bien
  // ce qu'il entendait et ce qu'il aurait exporte.
  const [mutedLevels, setMutedLevels] = useState<{ music?: number; rush?: number; voice?: number }>({});
  const isMuted = {
    music: globalMusicValue === 0,
    rush: globalRushValue === 0,
    voice: globalVoiceValue === 0,
  };
  const toggleMute = (track: 'music' | 'rush' | 'voice') => {
    const current = { music: globalMusicValue, rush: globalRushValue, voice: globalVoiceValue }[track];
    const apply = { music: setGlobalMusic, rush: setGlobalRush, voice: setGlobalVoice }[track];
    if (current === 0) {
      // Reactivation : on restaure le niveau memorise, 100 % a defaut.
      apply(mutedLevels[track] ?? 100);
      setMutedLevels((prev) => ({ ...prev, [track]: undefined }));
    } else {
      setMutedLevels((prev) => ({ ...prev, [track]: current }));
      apply(0);
    }
  };

  /** Jauge de niveau en direct, sous le curseur — remplace le second jeu de
   *  compteurs que « Écouter le mixage » affichait a part. */
  const LevelBar = ({ track, color }: { track: 'music' | 'rush' | 'voice'; color: string }) => {
    if (!levels) return null;
    const pct = Math.min(100, (levels[track] ?? 0) * 200);
    return (
      <div className="mt-0.5 h-0.5 w-full overflow-hidden rounded bg-gray-800">
        <div className={`h-full ${color}`} style={{ width: `${pct}%`, transition: 'width 40ms linear' }} />
      </div>
    );
  };

  /** Bouton de coupure d'une piste — meme dessin pour les trois. */
  const MuteButton = ({ track, label }: { track: 'music' | 'rush' | 'voice'; label: string }) => (
    <button
      type="button"
      onClick={() => toggleMute(track)}
      aria-pressed={isMuted[track]}
      title={isMuted[track] ? `Réactiver ${label}` : `Couper ${label}`}
      className={`flex h-5 w-5 items-center justify-center rounded transition-colors ${
        isMuted[track] ? 'text-red-400 hover:text-red-300' : 'text-gray-500 hover:text-white'
      }`}
    >
      {isMuted[track] ? <VolumeX size={11} /> : <Volume2 size={11} />}
    </button>
  );

  return (
    <div className={flush ? 'space-y-2' : 'mt-3 rounded-lg border border-gray-800 bg-gray-900/60 p-3 space-y-2'}>
      <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">
        Mixage audio
      </span>

      {/* Global volume sliders — bulk-apply to every keyframe at once */}
      <div className="rounded bg-gray-900/60 p-1.5 space-y-1">
        <div className="flex items-center gap-1.5 text-[9px] text-gray-300">
          <span className="w-16 text-gray-400">Musique</span>
          <input
            type="range"
            min={0}
            max={100}
            value={globalMusicValue}
            onChange={(e) => setGlobalMusic(parseInt(e.target.value, 10))}
            aria-label="Volume de la musique"
            className="flex-1 accent-cyan-500"
          />
          <span className="w-9 text-right text-cyan-300 font-mono">{globalMusicValue}%</span>
          <MuteButton track="music" label="la musique" />
        </div>
        <LevelBar track="music" color="bg-cyan-500" />
        <div className="flex items-center gap-1.5 text-[9px] text-gray-300">
          <span className="w-16 text-gray-400">Son rush</span>
          <input
            type="range"
            min={0}
            max={100}
            value={globalRushValue}
            onChange={(e) => setGlobalRush(parseInt(e.target.value, 10))}
            aria-label="Volume du son du rush"
            className="flex-1 accent-orange-500"
          />
          <span className="w-9 text-right text-orange-300 font-mono">{globalRushValue}%</span>
          <MuteButton track="rush" label="le son du rush" />
        </div>
        <LevelBar track="rush" color="bg-orange-500" />
        <div className="flex items-center gap-1.5 text-[9px] text-gray-300">
          <span className="w-16 text-gray-400">Voix off</span>
          <input
            type="range"
            min={0}
            max={100}
            value={globalVoiceValue}
            onChange={(e) => setGlobalVoice(parseInt(e.target.value, 10))}
            aria-label="Volume de la voix off"
            className="flex-1 accent-purple-500"
          />
          <span className="w-9 text-right text-purple-300 font-mono">{globalVoiceValue}%</span>
          <MuteButton track="voice" label="la voix off" />
        </div>
        <LevelBar track="voice" color="bg-purple-500" />
      </div>

      {/* ─── ADVANCED TOGGLE ──────────────────────────────────────────
          Les sliders globaux ci-dessus suffisent à 99% des utilisateurs.
          Le mode avancé (timeline + keyframes individuels) reste accessible
          mais caché par défaut pour ne pas effrayer l'utilisateur lambda.
      */}
      <button
        onClick={() => setAdvancedOpen((v) => !v)}
        className="flex items-center justify-between w-full mt-1 px-2 py-1.5 text-[10px] font-medium text-gray-400 hover:text-white bg-gray-900/40 hover:bg-gray-900/60 rounded transition"
      >
        <span className="flex items-center gap-1.5">
          {advancedOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          Avancé · auto-mix et keyframes ({sorted.length})
        </span>
        <span className="text-[9px] text-gray-500">
          {advancedOpen ? 'Masquer' : 'Afficher'}
        </span>
      </button>

      {advancedOpen && (
      <>
      {sorted.length > 1 && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onChange([{
              id: 'kf-0',
              time: 0,
              musicVolume: sorted[0].musicVolume,
              rushVolume: sorted[0].rushVolume,
              voiceVolume: sorted[0].voiceVolume,
            }])}
            className="flex items-center gap-1 rounded bg-gray-800 hover:bg-gray-700 px-2 py-1 text-[10px] font-medium text-gray-200 transition"
            title="Remplace la courbe par un seul niveau constant, en gardant les volumes actuels"
          >
            <RotateCcw size={11} />
            Revenir à un mixage simple
          </button>
          <span className="text-[9px] text-gray-500">
            {sorted.length} points de réglage — un montage simple n&apos;en a besoin que d&apos;un
          </span>
        </div>
      )}
      {/* Auto-mix — deplace ici depuis l'en-tete : c'est une aide ponctuelle,
          pas un reglage quotidien. Rien n'est retire, seulement replie. */}
      <div className="flex items-center gap-2">
        <button
          onClick={onAutoDuck}
          disabled={!rushUrl || autoDuckRunning}
          className="flex items-center gap-1 rounded bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 disabled:cursor-not-allowed px-2 py-1 text-[10px] font-medium text-white transition"
          title={rushUrl ? 'Baisse automatiquement la musique quand le rush parle' : 'Importe un rush vidéo pour utiliser l\'auto-mix'}
        >
          {autoDuckRunning
            ? <Loader2 size={11} className="animate-spin" />
            : <Wand2 size={11} />}
          Auto-mix
        </button>
        <span className="text-[9px] text-gray-500">
          Baisse la musique quand le rush parle
        </span>
      </div>

      {/* « La musique s'adapte a la voix ». L'auto-mix ne baissait la
          musique que pour le rush ; ici elle descend aussi pendant que la
          voix off parle, puis remonte. Defaut ETEINT : tant que
          l'utilisateur ne l'allume pas, la courbe est celle d'avant. */}
      {typeof duckOnVoice === 'boolean' && onDuckOnVoiceChange && (
        <button
          type="button"
          onClick={() => onDuckOnVoiceChange(!duckOnVoice)}
          disabled={!hasVoice}
          role="switch"
          aria-checked={duckOnVoice}
          aria-label="Musique s'adapte à la voix"
          title={hasVoice
            ? 'Pendant que la voix off parle, la musique descend puis remonte'
            : 'Ajoute une voix off pour activer cette option'}
          className="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-[10px] text-gray-300 hover:bg-gray-800/50 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          <Mic size={11} className={duckOnVoice && hasVoice ? 'text-purple-300' : 'text-gray-500'} />
          <span className="flex-1 text-left">Musique s&apos;adapte à la voix</span>
          {/* Interrupteur dessine plutot qu'une case a cocher : l'etat se
              lit d'un coup d'oeil dans un panneau deja dense. */}
          <span
            className={`relative h-3.5 w-6 flex-shrink-0 rounded-full transition ${
              duckOnVoice && hasVoice ? 'bg-purple-500' : 'bg-gray-700'
            }`}
          >
            <span
              className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all ${
                duckOnVoice && hasVoice ? 'left-3' : 'left-0.5'
              }`}
            />
          </span>
        </button>
      )}

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
              title={`t=${kf.time.toFixed(1)}s · musique ${Math.round(kf.musicVolume * 100)}% · rush ${Math.round(kf.rushVolume * 100)}% · voix ${Math.round((kf.voiceVolume ?? 1) * 100)}%`}
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
              <label className="flex items-center gap-1.5 text-[9px] text-gray-300">
                <span className="w-14 text-gray-400">Voix off</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round((kf.voiceVolume ?? 1) * 100)}
                  onChange={(e) => updateKeyframe(kf.id, { voiceVolume: parseInt(e.target.value, 10) / 100 })}
                  className="flex-1 accent-purple-500"
                />
                <span className="w-9 text-right text-purple-300 font-mono">{Math.round((kf.voiceVolume ?? 1) * 100)}%</span>
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
        Clique sur la barre pour ajouter un keyframe à un moment précis (utile pour ducker la musique pendant que la voix parle).
      </p>
      </>
      )}
    </div>
  );
}
