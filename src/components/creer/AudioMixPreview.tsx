'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, Repeat } from 'lucide-react';
import type { AudioKeyframe } from '@/lib/creer/audioDucking';

interface Props {
  audioKeyframes: AudioKeyframe[];
  musicUrl: string | null;
  voiceUrl: string | null;
  rushUrl: string | null;
  totalDuration: number;
  /** Seconds from montage start where the video sequence begins (intro + cards). */
  videoSeqStart: number;
  /** Seconds the video sequence lasts (0 if no rush or user disabled the video seq). */
  videoSeqDuration: number;
  /** Called every rAF with the current playback time (seconds). */
  onTimeUpdate?: (t: number) => void;
  /** Called when playback starts or stops. */
  onPlayStateChange?: (playing: boolean) => void;
}

/**
 * Live Web Audio mix preview for /creer. Mirrors the composer's audio
 * graph — music (AudioBufferSourceNode), voice (AudioBufferSourceNode),
 * rush video (MediaElementAudioSourceNode) — and applies the same
 * setValueAtTime keyframe automation on music + rush gains so the user
 * can hear exactly what the export will sound like, without rendering.
 *
 * Restarts automatically when keyframes change mid-playback so sliders
 * respond in "near real-time" (within one setValueAtTime cycle).
 */
export default function AudioMixPreview({
  audioKeyframes,
  musicUrl,
  voiceUrl,
  rushUrl,
  totalDuration,
  videoSeqStart,
  videoSeqDuration,
  onTimeUpdate,
  onPlayStateChange,
}: Props) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [loop, setLoop] = useState(false);
  const [musicLevel, setMusicLevel] = useState(0);
  const [rushLevel, setRushLevel] = useState(0);
  const [busy, setBusy] = useState(false);

  // ── Persistent across start()s ────────────────────────────────
  const audioCtxRef = useRef<AudioContext | null>(null);
  const musicGainRef = useRef<GainNode | null>(null);
  const voiceGainRef = useRef<GainNode | null>(null);
  const rushGainRef = useRef<GainNode | null>(null);
  const musicAnalyserRef = useRef<AnalyserNode | null>(null);
  const rushAnalyserRef = useRef<AnalyserNode | null>(null);
  const rushVideoRef = useRef<HTMLVideoElement | null>(null);
  const rushSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const rushElUrlRef = useRef<string | null>(null);

  // Per-start refs (recreated each playback)
  const musicSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const voiceSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const startAtRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  // Decoded buffers cached by URL so the same file isn't decoded twice.
  const musicCacheRef = useRef<Map<string, AudioBuffer>>(new Map());
  const voiceCacheRef = useRef<Map<string, AudioBuffer>>(new Map());

  // Live refs so the rAF tick reads latest values without restarting.
  const loopRef = useRef(loop);
  useEffect(() => { loopRef.current = loop; }, [loop]);
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  const canPlay = !!(musicUrl || voiceUrl || rushUrl) && totalDuration > 0;

  // ── helpers ───────────────────────────────────────────────────
  const decodeUrl = async (
    ctx: AudioContext,
    url: string,
    cache: Map<string, AudioBuffer>,
  ): Promise<AudioBuffer> => {
    const hit = cache.get(url);
    if (hit) return hit;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`audio fetch ${res.status}`);
    const bytes = await res.arrayBuffer();
    const buf = await ctx.decodeAudioData(bytes.slice(0));
    cache.set(url, buf);
    return buf;
  };

  const ensureRushElement = async (url: string): Promise<HTMLVideoElement | null> => {
    // Reuse the element only if the URL hasn't changed. Swapping the
    // src on a live element risks CORS / source-node stale references.
    if (rushVideoRef.current && rushElUrlRef.current === url) {
      return rushVideoRef.current;
    }
    // Fresh element for a new URL. Drop any previous source node so a
    // new createMediaElementSource call will succeed on the new element.
    if (rushVideoRef.current) {
      try { rushVideoRef.current.pause(); } catch { /* noop */ }
      rushVideoRef.current = null;
      rushSourceRef.current = null;
    }
    const vid = document.createElement('video');
    vid.crossOrigin = 'anonymous';
    vid.preload = 'auto';
    vid.muted = false;
    vid.playsInline = true;
    vid.style.display = 'none';
    vid.src = url;
    document.body.appendChild(vid);
    try {
      await new Promise<void>((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('rush metadata timeout')), 12000);
        vid.addEventListener('loadedmetadata', () => { clearTimeout(to); resolve(); }, { once: true });
        vid.addEventListener('error', () => { clearTimeout(to); reject(new Error('rush load error')); }, { once: true });
      });
    } catch (err) {
      console.warn('[AudioMixPreview] rush load failed:', err);
      try { document.body.removeChild(vid); } catch { /* noop */ }
      return null;
    }
    rushVideoRef.current = vid;
    rushElUrlRef.current = url;
    return vid;
  };

  const cleanup = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    try { musicSourceRef.current?.stop(); } catch { /* noop */ }
    try { voiceSourceRef.current?.stop(); } catch { /* noop */ }
    try { musicSourceRef.current?.disconnect(); } catch { /* noop */ }
    try { voiceSourceRef.current?.disconnect(); } catch { /* noop */ }
    musicSourceRef.current = null;
    voiceSourceRef.current = null;
    const rv = rushVideoRef.current;
    if (rv) { try { rv.pause(); rv.currentTime = 0; } catch { /* noop */ } }
    setCurrentTime(0);
    setMusicLevel(0);
    setRushLevel(0);
  }, []);

  const stop = useCallback(() => {
    cleanup();
    setIsPlaying(false);
    onPlayStateChange?.(false);
    onTimeUpdate?.(0);
  }, [cleanup, onPlayStateChange, onTimeUpdate]);

  const start = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    cleanup();
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        const AnyAudioCtx = (window.AudioContext
          || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
        audioCtxRef.current = new AnyAudioCtx({ sampleRate: 48000 });
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        await ctx.resume().catch(() => { /* noop */ });
      }

      // ── Lazy init persistent gains + analysers ──
      if (!musicGainRef.current) {
        const g = ctx.createGain();
        const a = ctx.createAnalyser();
        a.fftSize = 512;
        g.connect(a);
        a.connect(ctx.destination);
        musicGainRef.current = g;
        musicAnalyserRef.current = a;
      }
      if (!voiceGainRef.current) {
        const g = ctx.createGain();
        g.connect(ctx.destination);
        voiceGainRef.current = g;
      }
      if (!rushGainRef.current) {
        const g = ctx.createGain();
        const a = ctx.createAnalyser();
        a.fftSize = 512;
        g.connect(a);
        a.connect(ctx.destination);
        rushGainRef.current = g;
        rushAnalyserRef.current = a;
      }

      const musicGain = musicGainRef.current;
      const voiceGain = voiceGainRef.current;
      const rushGain = rushGainRef.current;

      // ── Decode music + voice as AudioBuffers (cached by URL) ──
      const [musicBuf, voiceBuf] = await Promise.all([
        musicUrl ? decodeUrl(ctx, musicUrl, musicCacheRef.current).catch((e) => { console.warn('[AudioMixPreview] music decode failed:', e); return null; }) : Promise.resolve(null),
        voiceUrl ? decodeUrl(ctx, voiceUrl, voiceCacheRef.current).catch((e) => { console.warn('[AudioMixPreview] voice decode failed:', e); return null; }) : Promise.resolve(null),
      ]);

      // ── Rush video element + source (one source per element lifetime) ──
      let rushEl: HTMLVideoElement | null = null;
      if (rushUrl) {
        rushEl = await ensureRushElement(rushUrl);
        if (rushEl && !rushSourceRef.current) {
          try {
            rushSourceRef.current = ctx.createMediaElementSource(rushEl);
            rushSourceRef.current.connect(rushGain);
          } catch (err) {
            console.warn('[AudioMixPreview] rush source creation failed:', err);
          }
        }
      }

      // ── Fresh one-shot buffer sources each start() ──
      if (musicBuf) {
        const src = ctx.createBufferSource();
        src.buffer = musicBuf;
        src.loop = true;
        src.connect(musicGain);
        musicSourceRef.current = src;
      }
      if (voiceBuf) {
        const src = ctx.createBufferSource();
        src.buffer = voiceBuf;
        src.loop = false;
        src.connect(voiceGain);
        voiceSourceRef.current = src;
      }

      // ── Schedule gain automation — same logic as the composer ──
      const startAt = ctx.currentTime + 0.08;
      startAtRef.current = startAt;
      const sorted = [...audioKeyframes].sort((a, b) => a.time - b.time);
      musicGain.gain.cancelScheduledValues(ctx.currentTime);
      rushGain.gain.cancelScheduledValues(ctx.currentTime);
      voiceGain.gain.cancelScheduledValues(ctx.currentTime);
      if (sorted.length > 0) {
        for (const kf of sorted) {
          const at = startAt + Math.max(0, kf.time);
          musicGain.gain.setValueAtTime(kf.musicVolume, at);
          rushGain.gain.setValueAtTime(kf.rushVolume, at);
          voiceGain.gain.setValueAtTime(kf.voiceVolume ?? 1, at);
        }
      } else {
        musicGain.gain.setValueAtTime(1, startAt);
        rushGain.gain.setValueAtTime(1, startAt);
        voiceGain.gain.setValueAtTime(1, startAt);
      }

      // ── Kick off sources ──
      try { musicSourceRef.current?.start(startAt); } catch (err) { console.warn('[AudioMixPreview] music start failed:', err); }
      try { voiceSourceRef.current?.start(startAt); } catch (err) { console.warn('[AudioMixPreview] voice start failed:', err); }

      setIsPlaying(true);
      onPlayStateChange?.(true);

      // ── rAF loop: time + analysers + rush play/pause windowing ──
      const tmpBuf = new Uint8Array(musicAnalyserRef.current?.fftSize ?? 512);
      const tick = () => {
        const now = ctx.currentTime;
        const t = Math.max(0, now - startAtRef.current);

        if (t >= totalDuration) {
          if (loopRef.current) {
            rafRef.current = null;
            void start();
            return;
          }
          stop();
          return;
        }

        // Gate rush video playback to the video sequence window.
        const rv = rushVideoRef.current;
        if (rv && rushUrl && videoSeqDuration > 0) {
          const inWindow = t >= videoSeqStart && t < videoSeqStart + videoSeqDuration;
          if (inWindow) {
            if (rv.paused) {
              try { rv.currentTime = Math.max(0, t - videoSeqStart); } catch { /* noop */ }
              rv.play().catch(() => { /* autoplay / decode hiccup — ignore */ });
            }
          } else if (!rv.paused) {
            try { rv.pause(); } catch { /* noop */ }
          }
        }

        // RMS off the analyser — simple, cheap, good enough for a VU meter.
        const measure = (node: AnalyserNode | null): number => {
          if (!node) return 0;
          node.getByteTimeDomainData(tmpBuf);
          let sum = 0;
          for (let i = 0; i < tmpBuf.length; i++) {
            const v = (tmpBuf[i] - 128) / 128;
            sum += v * v;
          }
          return Math.sqrt(sum / tmpBuf.length);
        };
        setMusicLevel(measure(musicAnalyserRef.current));
        setRushLevel(measure(rushAnalyserRef.current));

        setCurrentTime(t);
        onTimeUpdate?.(t);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      console.error('[AudioMixPreview] start failed:', err);
      cleanup();
      setIsPlaying(false);
      onPlayStateChange?.(false);
    } finally {
      setBusy(false);
    }
  }, [
    audioKeyframes, musicUrl, voiceUrl, rushUrl,
    totalDuration, videoSeqStart, videoSeqDuration,
    busy, cleanup, stop, onPlayStateChange, onTimeUpdate,
  ]);

  // Restart playback when keyframes change mid-play so sliders feel live.
  useEffect(() => {
    if (isPlayingRef.current) {
      void start();
    }
    // Intentionally exclude `start` — its identity changes on every render
    // and would cause infinite restart loops. We only care about KF edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioKeyframes]);

  // Stop if the underlying sources disappear while playing.
  useEffect(() => {
    if (isPlayingRef.current && !musicUrl && !voiceUrl && !rushUrl) stop();
  }, [musicUrl, voiceUrl, rushUrl, stop]);

  // Cleanup on unmount — stop sources, remove hidden video, close ctx.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      try { musicSourceRef.current?.stop(); } catch { /* noop */ }
      try { voiceSourceRef.current?.stop(); } catch { /* noop */ }
      const rv = rushVideoRef.current;
      if (rv) {
        try { rv.pause(); } catch { /* noop */ }
        try { document.body.removeChild(rv); } catch { /* noop */ }
      }
      audioCtxRef.current?.close().catch(() => { /* noop */ });
    };
  }, []);

  const pct = totalDuration > 0 ? Math.min(100, (currentTime / totalDuration) * 100) : 0;

  return (
    <div className="mt-3 rounded-lg border border-purple-900/50 bg-gray-900/60 p-3 space-y-2 backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
          Écouter le mixage
        </span>
        <label className="flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={loop}
            onChange={(e) => setLoop(e.target.checked)}
            className="accent-purple-500"
          />
          <Repeat size={10} /> Boucler
        </label>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => (isPlaying ? stop() : start())}
          disabled={!canPlay || busy}
          className="flex items-center gap-1.5 rounded bg-purple-700 hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 text-[11px] font-medium text-white transition"
          title={
            !canPlay
              ? "Upload music/voix ou rush pour activer le mixage"
              : isPlaying ? "Mettre en pause" : "Écouter le mixage complet (rush + musique + voix + ducking)"
          }
        >
          {isPlaying ? <Pause size={12} /> : <Play size={12} />}
          {isPlaying ? 'Pause mixage' : 'Écouter le mixage'}
        </button>
        <div className="flex-1 h-1.5 rounded bg-gray-800 overflow-hidden">
          <div
            className="h-full bg-purple-500"
            style={{ width: `${pct}%`, transition: 'width 80ms linear' }}
          />
        </div>
        <span className="text-[9px] font-mono text-gray-400 w-14 text-right tabular-nums">
          {currentTime.toFixed(1)}/{totalDuration.toFixed(1)}s
        </span>
      </div>

      {/* VU meters — RMS from AnalyserNodes, scaled 2× for visual punch */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-0.5">
          <div className="flex justify-between text-[9px] text-gray-400">
            <span>Musique</span>
            <span className="font-mono text-purple-300 tabular-nums">{Math.round(Math.min(100, musicLevel * 200))}%</span>
          </div>
          <div className="h-1 rounded bg-gray-800 overflow-hidden">
            <div
              className="h-full bg-purple-500"
              style={{ width: `${Math.min(100, musicLevel * 200)}%`, transition: 'width 40ms linear' }}
            />
          </div>
        </div>
        <div className="space-y-0.5">
          <div className="flex justify-between text-[9px] text-gray-400">
            <span>Son rush</span>
            <span className="font-mono text-orange-300 tabular-nums">{Math.round(Math.min(100, rushLevel * 200))}%</span>
          </div>
          <div className="h-1 rounded bg-gray-800 overflow-hidden">
            <div
              className="h-full bg-orange-500"
              style={{ width: `${Math.min(100, rushLevel * 200)}%`, transition: 'width 40ms linear' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
