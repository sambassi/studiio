'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Play, Pause, Trash2 } from 'lucide-react';
import {
  BAR_COUNT,
  formatTime,
  nextPlaybackRate,
  rateLabel,
  pseudoWaveform,
  seedFromString,
  barsFromSamples,
  ratioFromPointer,
  barPlayed,
  type PlaybackRate,
} from '@/lib/audio/waveform';

/**
 * Lecteur audio a ondes, aux couleurs de Studiio.
 *
 * Remplace `<audio controls>`, dont l'apparence est celle du navigateur et non
 * celle du produit. L'element `<audio>` reste la, cache : c'est lui qui lit,
 * cherche et regle la vitesse — on ne reimplemente que l'habillage.
 *
 * L'onde essaie d'abord les VRAIES amplitudes (`decodeAudioData`), et retombe
 * sur une onde decorative stable si le decodage echoue — un `blob:` d'une
 * autre origine, un format que le navigateur ne decode pas, ou un
 * `AudioContext` refuse. La retombee est silencieuse : une onde approximative
 * vaut mieux qu'un lecteur casse.
 */
export default function AudioPlayer({
  src,
  onDelete,
  className = '',
}: {
  src: string;
  /** Absent = pas de corbeille. */
  onDelete?: () => void;
  className?: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const seekingRef = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState<PlaybackRate>(1);
  const [bars, setBars] = useState<number[] | null>(null);
  const [failed, setFailed] = useState(false);

  /** Onde de repli — stable pour une meme source. */
  const fallbackBars = useMemo(() => pseudoWaveform(seedFromString(src), BAR_COUNT), [src]);
  const shownBars = bars ?? fallbackBars;

  // ── Vraies amplitudes ──────────────────────────────────────────────────
  // Non bloquant : tant que le decodage n'a pas abouti, l'onde de repli est
  // deja affichee, donc rien ne clignote ni ne saute.
  useEffect(() => {
    let cancelled = false;
    setBars(null);
    (async () => {
      try {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        const res = await fetch(src);
        const buf = await res.arrayBuffer();
        const ctx = new Ctx();
        const audio = await ctx.decodeAudioData(buf);
        // Le contexte n'a servi qu'a decoder : le laisser ouvert retiendrait
        // un peripherique audio pour rien.
        ctx.close().catch(() => {});
        if (cancelled) return;
        setBars(barsFromSamples(audio.getChannelData(0), BAR_COUNT));
        // La duree du decodage est plus fiable que celle de `<audio>` : un
        // WebM issu de MediaRecorder annonce souvent `Infinity`.
        if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
      } catch {
        // Onde decorative : voir le commentaire d'en-tete.
      }
    })();
    return () => { cancelled = true; };
  }, [src]);

  // ── Etat de lecture ────────────────────────────────────────────────────
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setCurrentTime(el.currentTime);
    const onMeta = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) setDuration(el.duration);
      setFailed(false);
    };
    const onEnd = () => { setPlaying(false); setCurrentTime(0); };
    const onErr = () => { setFailed(true); setPlaying(false); };
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('durationchange', onMeta);
    el.addEventListener('ended', onEnd);
    el.addEventListener('error', onErr);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('durationchange', onMeta);
      el.removeEventListener('ended', onEnd);
      el.removeEventListener('error', onErr);
    };
  }, [src]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  }, [rate]);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el || failed) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      // `play()` rend une promesse : une source illisible la rejette, et sans
      // ce `catch` la console se remplit d'erreurs non gerees.
      el.play().then(() => setPlaying(true)).catch(() => setFailed(true));
    }
  }, [playing, failed]);

  /** Deplace la lecture a la position visee dans l'onde. */
  const seekTo = useCallback((clientX: number) => {
    const el = audioRef.current;
    const zone = waveRef.current;
    if (!el || !zone || !duration) return;
    const ratio = ratioFromPointer(clientX, zone.getBoundingClientRect());
    el.currentTime = ratio * duration;
    setCurrentTime(ratio * duration);
  }, [duration]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // La capture suit le curseur meme hors de la zone : sans elle, glisser
    // au-dela du bord de l'onde interromprait le geste en pleine course.
    e.currentTarget.setPointerCapture(e.pointerId);
    seekingRef.current = true;
    seekTo(e.clientX);
  }, [seekTo]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (seekingRef.current) seekTo(e.clientX);
  }, [seekTo]);

  const endSeek = useCallback(() => { seekingRef.current = false; }, []);

  const progress = duration > 0 ? currentTime / duration : 0;

  return (
    <div
      className={`flex items-center gap-3 rounded-full border border-gray-800 px-3 py-2 ${className}`}
      style={{ backgroundColor: '#0A0A0F' }}
      data-audio-player
    >
      {/* L'element qui lit vraiment. `preload="metadata"` suffit : on ne
          telecharge tout qu'a la lecture. */}
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />

      {/* ── Lecture / pause ─────────────────────────────────────────── */}
      <button
        type="button"
        onClick={toggle}
        disabled={failed}
        aria-label={playing ? 'Mettre en pause' : 'Lire l’enregistrement'}
        data-audio-toggle
        className="shrink-0 flex h-9 w-9 items-center justify-center rounded-full text-white transition focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:opacity-40 hover:brightness-110"
        style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #D91CD2 100%)' }}
      >
        {playing ? (
          <Pause className="w-4 h-4" fill="currentColor" />
        ) : (
          <Play className="w-4 h-4 translate-x-[1px]" fill="currentColor" />
        )}
      </button>

      {/* ── Onde ────────────────────────────────────────────────────── */}
      <div
        ref={waveRef}
        role="slider"
        tabIndex={0}
        aria-label="Position de lecture"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(currentTime)}
        aria-valuetext={`${formatTime(currentTime)} sur ${formatTime(duration)}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endSeek}
        onLostPointerCapture={endSeek}
        onKeyDown={(e) => {
          const el = audioRef.current;
          if (!el || !duration) return;
          // Les fleches deplacent de 5 s : l'onde est atteignable au clavier.
          if (e.key === 'ArrowRight') el.currentTime = Math.min(duration, el.currentTime + 5);
          else if (e.key === 'ArrowLeft') el.currentTime = Math.max(0, el.currentTime - 5);
          else return;
          e.preventDefault();
          setCurrentTime(el.currentTime);
        }}
        className="flex-1 flex items-center gap-[2px] h-9 cursor-pointer touch-none select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 rounded"
      >
        {shownBars.map((h, i) => {
          const lue = barPlayed(i, shownBars.length, progress);
          return (
            <span
              key={i}
              data-bar={lue ? 'lue' : 'restante'}
              className="flex-1 rounded-full"
              style={{
                height: `${Math.round(h * 100)}%`,
                minWidth: 2,
                // Lue : le degrade Studiio. Restante : un gris qui se lit sur
                // le fond sombre sans attirer l'oeil.
                background: lue
                  ? `linear-gradient(180deg, #7C3AED 0%, #EC4899 100%)`
                  : '#374151',
                transition: 'background 120ms linear',
              }}
            />
          );
        })}
      </div>

      {/* ── Chrono ──────────────────────────────────────────────────── */}
      <span
        className="shrink-0 text-xs text-gray-400"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>

      {/* ── Vitesse ─────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setRate((r) => nextPlaybackRate(r))}
        aria-label={`Vitesse de lecture : ${rateLabel(rate)}`}
        data-audio-rate
        className="shrink-0 rounded-full border border-gray-700 px-2 py-0.5 text-[11px] text-gray-300 hover:text-white hover:border-gray-600 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {rateLabel(rate)}
      </button>

      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label="Supprimer l’enregistrement"
          className="shrink-0 text-gray-500 hover:text-red-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 rounded"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
