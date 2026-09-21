'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import type { TransitionStyle } from '@/lib/video-composer';
import {
  sequenceClock, totalSeconds, transitionLayerStyles, ENTERING_PROGRESS_RATIO,
  type SequenceStep, type TransitionFrame,
} from '@/lib/creer/transitionPreview';

/** Libellés des séquences, côté écran. */
const SEQUENCE_LABELS: Record<string, string> = {
  intro: 'Titre',
  cards: 'Cartes',
  video: 'Vidéo',
  cta: 'CTA',
};

/** Ce que le lecteur demande à l'appelant de dessiner pour un calque. */
export interface PlaybackLayer {
  /** Clé de la séquence (`intro`, `cards`, `video`, `cta`). */
  key: string;
  /** Avancement de la séquence, de 0 à 1 — pour l'animation du texte. */
  progress: number;
}

/**
 * Lecture TEMPORELLE des séquences, dans le cadre de l'aperçu.
 *
 * ⚠️ L'ONGLET « TOUT » EST UNE VUE DE COMPOSITION : titre, cartes et CTA y
 * sont EMPILÉS, alors que la vidéo les joue l'un après l'autre. Ce lecteur
 * est l'autre lecture du même montage — dans l'ordre réel, avec les
 * transitions et l'animation du texte — et il ne remplace pas la première :
 * à l'arrêt, il ne rend RIEN par-dessus le plateau, qui reste éditable.
 *
 * Il ne dessine pas les séquences lui-même : `renderLayer` le fait, avec les
 * MÊMES composants que le plateau (`PlateContent`). Il ne fait qu'orchestrer
 * l'horloge (`sequenceClock`, la règle du compositeur) et poser sur chaque
 * calque le style de transition (`transitionLayerStyles`, transcription de
 * `drawTransition`). Aucun second moteur.
 *
 * Posé dans le slot `overlay` de `Preview` : HORS du plateau photographié.
 */
export default function SequencePlayback({
  steps,
  transition,
  frame,
  renderLayer,
  onPlayingChange,
  disabled = false,
}: {
  /** Séquences dans l'ordre du montage, avec leur durée en secondes. */
  steps: readonly SequenceStep[];
  transition: TransitionStyle;
  /** Résolution vidéo et échelle d'affichage — pour le flou des transitions. */
  frame: TransitionFrame;
  /** Dessine une séquence à un avancement donné, à la taille du cadre. */
  renderLayer: (layer: PlaybackLayer) => React.ReactNode;
  /** Prévenu quand la lecture démarre ou s'arrête — pour le libellé de l'appelant. */
  onPlayingChange?: (playing: boolean) => void;
  /** Masque la commande (rien à lire : aucune séquence, aperçu occupé). */
  disabled?: boolean;
}) {
  const playable = steps.filter((s) => s.seconds > 0);
  const total = totalSeconds(playable);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const tRef = useRef(0);
  const rafRef = useRef(0);

  // L'appelant est prévenu APRÈS le rendu, jamais pendant.
  useEffect(() => { onPlayingChange?.(playing); }, [playing, onPlayingChange]);

  /* ── L'HORLOGE ─────────────────────────────────────────────────────────
     `requestAnimationFrame` avec le temps RÉEL (`performance.now`) : un
     compteur d'images dériverait sur un onglet ralenti, et les durées
     affichées ne seraient plus celles du montage. Arrêtée à la fin — le
     plateau reprend sa place — et annulée au démontage. */
  useEffect(() => {
    if (!playing || typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return;
    const depart = performance.now() - tRef.current * 1000;
    const tick = (now: number) => {
      const secondes = (now - depart) / 1000;
      if (secondes >= total) {
        tRef.current = 0;
        setT(0);
        setPlaying(false);
        return;
      }
      tRef.current = secondes;
      setT(secondes);
      rafRef.current = window.requestAnimationFrame(tick);
    };
    rafRef.current = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafRef.current);
  }, [playing, total]);

  // Les séquences ont changé sous le lecteur (durée réglée, séquence
  // masquée) : on repart du début plutôt que de lire un instant qui n'existe
  // plus.
  const signature = playable.map((s) => `${s.key}:${s.seconds}`).join('|');
  useEffect(() => { tRef.current = 0; setT(0); setPlaying(false); }, [signature]);

  const toggle = useCallback(() => {
    if (total <= 0) return;
    setPlaying((p) => !p);
  }, [total]);

  if (disabled || playable.length === 0) return null;

  const clock = sequenceClock(playable, t);
  const courante = playable[clock.index];
  const entrante = clock.nextIndex !== null ? playable[clock.nextIndex] : null;
  const styles = clock.inTransition
    ? transitionLayerStyles(transition, clock.transitionProgress, frame)
    : null;
  const label = SEQUENCE_LABELS[courante.key] ?? courante.key;

  return (
    <div className="absolute inset-0" style={{ pointerEvents: 'none' }} data-sequence-playback data-sequence-playing={playing ? 'true' : 'false'}>
      {/* ── LA SCÈNE ──────────────────────────────────────────────────
          Rendue SEULEMENT en lecture : à l'arrêt, le plateau de composition
          reste visible et éditable en dessous. Elle capte les pointeurs
          pendant la lecture — un glissement sur un calque en mouvement ne
          désignerait rien. */}
      {playing && (
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ pointerEvents: 'auto', backgroundColor: '#0A0A0F' }}
          data-playback-stage
        >
          {styles?.black && (
            <div className="absolute inset-0" style={{ backgroundColor: '#000000' }} />
          )}
          <div
            className="absolute inset-0"
            style={{ transformOrigin: 'center center', ...(styles?.a ?? {}) }}
            data-playback-layer="a"
            data-playback-sequence={courante.key}
          >
            {renderLayer({ key: courante.key, progress: clock.progress })}
          </div>
          {entrante && styles && (
            <div
              className="absolute inset-0"
              style={{ transformOrigin: 'center center', ...styles.b }}
              data-playback-layer="b"
              data-playback-sequence={entrante.key}
            >
              {/* La séquence entrante est dessinée à `t × 0,3`, comme
                  `drawB(t * 0.3)` du compositeur. */}
              {renderLayer({ key: entrante.key, progress: clock.transitionProgress * ENTERING_PROGRESS_RATIO })}
            </div>
          )}
          {/* Barre d'avancement — sur le bord bas, sans hauteur ajoutée. */}
          <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-white/15" aria-hidden>
            <div
              className="h-full bg-white/80"
              style={{ width: `${total > 0 ? Math.min(100, (t / total) * 100) : 0}%` }}
              data-playback-progress
            />
          </div>
        </div>
      )}

      {/* ── LA COMMANDE ───────────────────────────────────────────────
          En bas à GAUCHE : le CTA (centré, 70 % de large) et le filigrane
          (centré) ne passent jamais là — la commande ne cache rien
          d'éditable. Un vrai bouton : clavier, mobile, lecteur d'écran. */}
      <div className="absolute bottom-2 left-2 z-40 flex items-center gap-1.5" style={{ pointerEvents: 'auto' }}>
        <button
          type="button"
          onClick={toggle}
          aria-pressed={playing}
          aria-label={playing ? 'Mettre en pause la lecture des séquences' : 'Lire les séquences dans l’ordre du montage'}
          title={playing ? 'Pause — revenir à la vue de composition' : 'Lire les séquences, avec leurs transitions'}
          data-play-sequences
          className={`flex items-center justify-center w-7 h-7 rounded-full backdrop-blur transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
            playing
              ? 'bg-purple-600/70 text-white ring-1 ring-purple-300/60'
              : 'bg-gray-900/70 text-gray-200 hover:text-white hover:bg-gray-800/80'
          }`}
        >
          {playing ? <Pause size={13} strokeWidth={2.2} /> : <Play size={13} strokeWidth={2.2} />}
        </button>
        {playing && (
          <span
            className="rounded-md bg-gray-900/70 px-1.5 py-0.5 text-[10px] font-medium text-gray-200 backdrop-blur"
            data-playback-label
            aria-live="polite"
          >
            {label}
            {entrante && ` → ${SEQUENCE_LABELS[entrante.key] ?? entrante.key}`}
          </span>
        )}
      </div>
    </div>
  );
}
