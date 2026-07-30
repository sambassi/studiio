'use client';

import React, { useState } from 'react';
import { Music, Film, Mic, Volume2, VolumeX, ChevronDown, ChevronRight } from 'lucide-react';
import AudioDuckingTimeline from './AudioDuckingTimeline';
import AudioMixPreview from './AudioMixPreview';
import type { AudioKeyframe } from '@/lib/creer/audioDucking';

/**
 * Mixer — UN seul bloc.
 *
 * Avant, trois choses se partageaient le meme travail : trois curseurs de
 * volume globaux, un bouton Auto-mix, un editeur de keyframes, et un bloc
 * « Ecouter le mixage » a part, avec ses propres niveaux. L'utilisateur
 * reglait le meme son a deux endroits et devait deviner lequel comptait.
 *
 * Ici : une ligne par piste (volume + coupure), un seul bouton de lecture,
 * et tout le reste — Auto-mix, keyframes — replie derriere « Avance ».
 * Rien n'est supprime : `AudioDuckingTimeline` et `AudioMixPreview` sont
 * reutilises tels quels, simplement reagences.
 */

/** Une piste du mixage. `Film` pour le rush : c'est le son de la video. */
const TRACKS = [
  { key: 'music', label: 'Musique', Icon: Music, accent: 'accent-cyan-500' },
  { key: 'rush', label: 'Son de la vidéo', Icon: Film, accent: 'accent-orange-500' },
  { key: 'voice', label: 'Voix off', Icon: Mic, accent: 'accent-purple-500' },
] as const;

type TrackKey = (typeof TRACKS)[number]['key'];

interface Props {
  keyframes: AudioKeyframe[];
  onChange: (next: AudioKeyframe[]) => void;
  totalDuration: number;
  /** `null` quand il n'y a pas de rush, ou qu'il est hors du montage. */
  rushUrl: string | null;
  musicUrl: string | null;
  voiceUrl: string | null;
  autoDuckRunning: boolean;
  onAutoDuck: () => void | Promise<void>;
  introDuration: number;
  cardsDuration: number;
  ctaDuration: number;
  videoSeqStart: number;
  videoSeqDuration: number;
}

export default function AudioMixer({
  keyframes,
  onChange,
  totalDuration,
  rushUrl,
  musicUrl,
  voiceUrl,
  autoDuckRunning,
  onAutoDuck,
  introDuration,
  cardsDuration,
  ctaDuration,
  videoSeqStart,
  videoSeqDuration,
}: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [playheadTime, setPlayheadTime] = useState<number | null>(null);
  /**
   * Volume d'avant la coupure, par piste.
   *
   * Couper met le volume a zero — c'est ce que lit le compositeur, aucun
   * champ n'est ajoute aux keyframes et l'export reste identique. Mais un
   * zero seul perdrait le reglage : sans cette memoire, retablir le son
   * ramenerait la piste a 100 % au lieu du niveau choisi.
   */
  const [beforeMute, setBeforeMute] = useState<Partial<Record<TrackKey, number>>>({});

  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  const first = sorted[0];

  /**
   * Niveau affiche — celui du PREMIER keyframe.
   *
   * C'est le point de reference du mixage : sans courbe de ducking, tous les
   * keyframes portent la meme valeur et le premier la represente donc
   * fidelement. Avec une courbe, il donne le niveau de depart.
   */
  const levelOf = (track: TrackKey): number => {
    if (!first) return track === 'rush' ? 0.5 : 1;
    if (track === 'music') return first.musicVolume ?? 1;
    if (track === 'rush') return first.rushVolume ?? 0.5;
    return first.voiceVolume ?? 1;
  };

  /**
   * Regle une piste sur TOUS les keyframes.
   *
   * Exactement ce que faisaient les curseurs globaux d'avant : n'ecrire que
   * sur le premier laisserait la courbe reprendre l'ancien niveau des la
   * seconde suivante, et le reglage semblerait ignore a l'export.
   */
  const setLevel = (track: TrackKey, value: number) => {
    const v = Math.max(0, Math.min(1, value));
    onChange(
      sorted.map((k) => ({
        ...k,
        ...(track === 'music' ? { musicVolume: v } : {}),
        ...(track === 'rush' ? { rushVolume: v } : {}),
        ...(track === 'voice' ? { voiceVolume: v } : {}),
      })),
    );
  };

  const toggleMute = (track: TrackKey) => {
    const current = levelOf(track);
    if (current > 0) {
      setBeforeMute((prev) => ({ ...prev, [track]: current }));
      setLevel(track, 0);
    } else {
      setLevel(track, beforeMute[track] ?? 1);
    }
  };

  /** Une piste sans source n'a rien a regler. */
  const available: Record<TrackKey, boolean> = {
    music: !!musicUrl,
    rush: !!rushUrl,
    voice: !!voiceUrl,
  };
  const anyTrack = available.music || available.rush || available.voice;

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-3 space-y-2">
      {/* Une ligne par piste : volume, coupure. Rien d'autre. */}
      {TRACKS.map(({ key, label, Icon, accent }) => {
        const level = levelOf(key);
        const muted = level === 0;
        const usable = available[key];
        return (
          <div key={key} className="flex items-center gap-2">
            <Icon
              size={12}
              className={`flex-shrink-0 ${usable ? 'text-gray-400' : 'text-gray-700'}`}
            />
            <span className={`w-28 text-[10px] truncate ${usable ? 'text-gray-300' : 'text-gray-600'}`}>
              {label}
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(level * 100)}
              disabled={!usable}
              onChange={(e) => setLevel(key, Number(e.target.value) / 100)}
              aria-label={`Volume — ${label}`}
              className={`flex-1 h-1 ${accent} disabled:opacity-30 disabled:cursor-not-allowed`}
            />
            <span className="w-9 text-right text-[9px] font-mono tabular-nums text-gray-400">
              {Math.round(level * 100)}%
            </span>
            <button
              type="button"
              onClick={() => toggleMute(key)}
              disabled={!usable}
              aria-pressed={muted}
              aria-label={`${muted ? 'Rétablir' : 'Couper'} — ${label}`}
              title={muted ? 'Rétablir le son' : 'Couper le son'}
              className="flex-shrink-0 text-gray-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
            </button>
          </div>
        );
      })}

      {/* Un seul bouton de lecture, pour tout le mixage. */}
      <AudioMixPreview
        compact
        audioKeyframes={sorted}
        musicUrl={musicUrl}
        voiceUrl={voiceUrl}
        rushUrl={rushUrl}
        introDuration={introDuration}
        cardsDuration={cardsDuration}
        ctaDuration={ctaDuration}
        totalDuration={totalDuration}
        videoSeqStart={videoSeqStart}
        videoSeqDuration={videoSeqDuration}
        onTimeUpdate={setPlayheadTime}
        onPlayStateChange={(playing) => { if (!playing) setPlayheadTime(null); }}
      />

      {/* Avance — Auto-mix et keyframes. Repliés : ils ne servent qu'a une
          minorite, et c'est leur presence permanente qui rendait le panneau
          illisible. Rien n'est retire, tout reste a un clic. */}
      <div className="border-t border-gray-800 pt-2">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          aria-expanded={advancedOpen}
          disabled={!anyTrack}
          className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-[10px] text-gray-500 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          {advancedOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          Avancé
          <span className="flex-1 text-left text-gray-600">auto-mix, réglages par moment</span>
        </button>

        {advancedOpen && anyTrack && (
          <AudioDuckingTimeline
            showLevels={false}
            keyframes={sorted}
            onChange={onChange}
            totalDuration={totalDuration}
            rushUrl={rushUrl}
            autoDuckRunning={autoDuckRunning}
            onAutoDuck={onAutoDuck}
            playheadTime={playheadTime}
          />
        )}
      </div>
    </div>
  );
}
