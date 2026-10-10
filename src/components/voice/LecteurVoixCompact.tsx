'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { formatTime, pseudoWaveform, seedFromString, barPlayed, ratioFromPointer } from '@/lib/audio/waveform';

/** Nombre de barres de l'onde décorative : assez pour lire la progression, assez peu pour une colonne étroite. */
export const BARRES_LECTEUR_VOIX = 32;

/**
 * Lecteur compact aux couleurs de Studiio, pour une écoute COURTE (la
 * pré-écoute « Écouter ma voix »).
 *
 * Remplace `<audio controls>` : l'apparence du navigateur, son menu ⋮ et son
 * bouton de téléchargement n'ont rien à faire sur une pré-écoute gratuite.
 * L'élément `<audio>` reste là, caché et SANS `controls` : c'est lui qui lit ;
 * on ne dessine que l'habillage — lecture/pause, une onde décorative (hauteurs
 * fixes, stables pour une même source) colorée selon la progression, et le
 * chrono « 0:02 / 0:05 ».
 *
 * Aucune requête de plus : pas de décodage de l'audio (contrairement à
 * `ui/AudioPlayer`), l'onde n'est qu'un repère visuel.
 *
 * L'URL (`blob:`) appartient à l'appelant, qui la libère quand il la remplace :
 * ce composant remet seulement son état à zéro quand `src` change.
 */
const LecteurVoixCompact = forwardRef<HTMLAudioElement | null, {
  src: string;
  /** Appelé quand la lecture démarre (ex. : couper une autre écoute en cours). */
  onLecture?: () => void;
  className?: string;
}>(function LecteurVoixCompact({ src, onLecture, className = '' }, ref) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useImperativeHandle(ref, () => audioRef.current as HTMLAudioElement, []);
  const ondeRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  const [lecture, setLecture] = useState(false);
  const [position, setPosition] = useState(0);
  const [duree, setDuree] = useState(0);

  const barres = useMemo(() => pseudoWaveform(seedFromString(src), BARRES_LECTEUR_VOIX), [src]);

  const arreterSuivi = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  // Nouvelle source : on repart de zéro (la précédente a été libérée par l'appelant).
  useEffect(() => {
    setLecture(false); setPosition(0); setDuree(0);
    return arreterSuivi;
  }, [src, arreterSuivi]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const lireDuree = () => { if (Number.isFinite(el.duration) && el.duration > 0) setDuree(el.duration); };
    const surTemps = () => setPosition(el.currentTime);
    const surPause = () => { setLecture(false); arreterSuivi(); };
    const surFin = () => {
      arreterSuivi();
      setLecture(false);
      setPosition(0);
      try { el.currentTime = 0; } catch { /* source déjà retirée */ }
    };
    el.addEventListener('loadedmetadata', lireDuree);
    el.addEventListener('durationchange', lireDuree);
    el.addEventListener('timeupdate', surTemps);
    el.addEventListener('pause', surPause);
    el.addEventListener('ended', surFin);
    return () => {
      el.removeEventListener('loadedmetadata', lireDuree);
      el.removeEventListener('durationchange', lireDuree);
      el.removeEventListener('timeupdate', surTemps);
      el.removeEventListener('pause', surPause);
      el.removeEventListener('ended', surFin);
    };
  }, [src, arreterSuivi]);

  /** Progression fluide pendant la lecture (`timeupdate` ne passe que ~4 fois/s). */
  const suivre = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    setPosition(el.currentTime);
    rafRef.current = requestAnimationFrame(suivre);
  }, []);

  const basculer = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (lecture) {
      el.pause();
      setLecture(false);
      arreterSuivi();
      return;
    }
    onLecture?.();
    setLecture(true);
    // `play()` rend une promesse : une source illisible la rejette — on revient à « Lire ».
    Promise.resolve(el.play())
      .then(() => { arreterSuivi(); rafRef.current = requestAnimationFrame(suivre); })
      .catch(() => setLecture(false));
  }, [lecture, onLecture, arreterSuivi, suivre]);

  const allerA = useCallback((secondes: number) => {
    const el = audioRef.current;
    if (!el || !duree) return;
    const t = Math.min(duree, Math.max(0, secondes));
    el.currentTime = t;
    setPosition(t);
  }, [duree]);

  const progression = duree > 0 ? Math.min(1, position / duree) : 0;

  return (
    <div
      data-lecteur-voix={lecture ? 'lecture' : 'pause'}
      className={`flex items-center gap-3 rounded-full border border-white/10 bg-black/40 pl-1.5 pr-3 py-1.5 min-w-0 ${className}`}
    >
      {/* Le vrai lecteur : caché, sans `controls` (ni menu, ni téléchargement). */}
      <audio data-ecoute-audio ref={audioRef} src={src} preload="metadata" className="hidden" />

      <button
        type="button"
        data-lecteur-voix-bouton
        onClick={basculer}
        // Entrée / Espace : gérés ici (et le clic natif empêché) pour un seul basculement par appui.
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); basculer(); } }}
        onKeyUp={(e) => { if (e.key === ' ') e.preventDefault(); }}
        aria-label={lecture ? 'Pause' : 'Lire'}
        title={lecture ? 'Pause' : 'Lire'}
        className="shrink-0 flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-studiio-primary to-studiio-accent text-white transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
      >
        {lecture ? <Pause className="w-4 h-4" fill="currentColor" /> : <Play className="w-4 h-4" fill="currentColor" style={{ transform: 'translateX(1px)' }} />}
      </button>

      <div
        ref={ondeRef}
        data-lecteur-voix-onde
        role="slider"
        tabIndex={0}
        aria-label="Position de lecture"
        aria-valuemin={0}
        aria-valuemax={Math.round(duree)}
        aria-valuenow={Math.round(position)}
        aria-valuetext={`${formatTime(position)} sur ${formatTime(duree)}`}
        onClick={(e) => { if (ondeRef.current) allerA(ratioFromPointer(e.clientX, ondeRef.current.getBoundingClientRect()) * duree); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') allerA(position + 1);
          else if (e.key === 'ArrowLeft') allerA(position - 1);
          else return;
          e.preventDefault();
        }}
        className="flex-1 min-w-0 flex items-center h-8 cursor-pointer select-none rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
        // Écart et largeur minimale en style : 32 barres tiennent encore dans ~100 px (mobile 390 px).
        style={{ gap: 2 }}
      >
        {barres.map((h, i) => {
          const lue = barPlayed(i, barres.length, progression);
          return (
            <span
              key={i}
              data-barre={lue ? 'lue' : 'restante'}
              className={`flex-1 rounded-full ${lue ? 'bg-studiio-accent' : 'bg-gray-600'}`}
              style={{ height: `${Math.round(h * 100)}%`, minWidth: 1, transition: 'background-color 120ms linear' }}
            />
          );
        })}
      </div>

      <span data-lecteur-voix-temps className="shrink-0 text-xs text-gray-300" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {formatTime(position)} / {formatTime(duree)}
      </span>
    </div>
  );
});

export default LecteurVoixCompact;
