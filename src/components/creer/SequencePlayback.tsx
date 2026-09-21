'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, X } from 'lucide-react';
import type { TransitionStyle } from '@/lib/video-composer';
import type { TextAnimation } from '@/lib/creer/textAnimation';
import {
  sequenceClock, totalSeconds, transitionLayerStyles, ENTERING_PROGRESS_RATIO,
  type PlaybackExtract, type SequenceStep, type TransitionFrame,
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
  /**
   * Animation du texte imposée par l'extrait en cours, s'il en impose une
   * (aperçu d'une option qu'on n'a pas choisie) ; sinon l'appelant garde la
   * sienne.
   */
  textAnimation?: TextAnimation;
}

/**
 * Une DEMANDE d'extrait : « joue ce morceau du montage, maintenant ».
 *
 * `id` est un compteur : une valeur nouvelle relance l'extrait, même si ses
 * bornes n'ont pas changé — cliquer deux fois la même transition la rejoue
 * deux fois. `autoplay: false` (réduction des animations) ne lance rien : le
 * lecteur montre l'image FIGÉE à `still`, et le bouton Lire attend.
 *
 * `transition` / `textAnimation` : les effets à jouer pour CET extrait à la
 * place de ceux de l'appelant — le bouton ▶ d'une option la montre sans la
 * choisir.
 */
export interface PlaybackRequest extends PlaybackExtract {
  id: number;
  autoplay: boolean;
  transition?: TransitionStyle;
  textAnimation?: TextAnimation;
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
  demande = null,
  onFin,
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
  /**
   * Extrait à jouer, demandé par l'appelant (option choisie dans une grille).
   * Une demande arme l'extrait : Lire et Rejouer le rejouent jusqu'à ce que
   * l'utilisateur le quitte (✕) ou que les séquences changent.
   */
  demande?: PlaybackRequest | null;
  /** L'extrait est arrivé à son terme, ou a été quitté : le plateau est de retour. */
  onFin?: () => void;
}) {
  const playable = steps.filter((s) => s.seconds > 0);
  const total = totalSeconds(playable);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  /** L'extrait armé — `null` : le montage entier. */
  const [extrait, setExtrait] = useState<PlaybackRequest | null>(null);
  /** Image figée à l'instant `t`, sans lecture (réduction des animations). */
  const [fige, setFige] = useState(false);
  /** Compteur de départs : Rejouer en pleine lecture doit relancer l'horloge. */
  const [depart, setDepart] = useState(0);
  const tRef = useRef(0);
  const rafRef = useRef(0);
  // Rappel tenu à jour sans relancer l'horloge quand l'appelant se re-rend.
  const onFinRef = useRef(onFin);
  useEffect(() => { onFinRef.current = onFin; }, [onFin]);

  // L'appelant est prévenu APRÈS le rendu, jamais pendant.
  useEffect(() => { onPlayingChange?.(playing); }, [playing, onPlayingChange]);

  /** Fin de la lecture en cours : l'extrait se repositionne à son début, le montage à zéro. */
  const fin = extrait ? extrait.to : total;
  const debut = extrait ? extrait.from : 0;

  /* ── L'HORLOGE ─────────────────────────────────────────────────────────
     `requestAnimationFrame` avec le temps RÉEL (`performance.now`) : un
     compteur d'images dériverait sur un onglet ralenti, et les durées
     affichées ne seraient plus celles du montage. Arrêtée à la fin — le
     plateau reprend sa place — et annulée au démontage. */
  useEffect(() => {
    if (!playing || typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return;
    const origine = performance.now() - tRef.current * 1000;
    const tick = (now: number) => {
      const secondes = (now - origine) / 1000;
      if (secondes >= fin) {
        tRef.current = debut;
        setT(debut);
        setPlaying(false);
        // Un extrait terminé le dit à l'appelant : il peut rendre l'onglet
        // d'où il vient.
        if (extrait) onFinRef.current?.();
        return;
      }
      tRef.current = secondes;
      setT(secondes);
      rafRef.current = window.requestAnimationFrame(tick);
    };
    rafRef.current = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafRef.current);
    // `extrait` est lu pour `fin`/`debut` et pour prévenir l'appelant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, fin, debut, depart]);

  // Les séquences ont changé sous le lecteur (durée réglée, séquence
  // masquée) : on repart du début plutôt que de lire un instant qui n'existe
  // plus — et l'extrait armé, calculé sur l'ancien montage, tombe.
  const signature = playable.map((s) => `${s.key}:${s.seconds}`).join('|');
  useEffect(() => { tRef.current = 0; setT(0); setPlaying(false); setExtrait(null); setFige(false); }, [signature]);

  /* ── LA DEMANDE ────────────────────────────────────────────────────────
     Déclarée APRÈS l'effet de signature : au montage (l'appelant vient de
     basculer sur « Tout » avec une demande en main), la remise à zéro passe
     d'abord, l'armement ensuite. Une demande retirée (`null`) ne désarme
     rien — l'appelant la consomme une fois lue, Rejouer doit rester possible. */
  const demandeId = demande?.id ?? null;
  useEffect(() => {
    if (!demande || demandeId === null) return;
    // Un extrait hors du montage courant (séquence retirée entre-temps) ne
    // se joue pas.
    const dureeMontage = totalSeconds(steps.filter((s) => s.seconds > 0));
    if (!(demande.from < demande.to) || demande.to > dureeMontage + 1e-6) return;
    setExtrait(demande);
    if (demande.autoplay) {
      tRef.current = demande.from;
      setT(demande.from);
      setFige(false);
      setPlaying(true);
      setDepart((n) => n + 1);
    } else {
      // Réduction des animations : l'image qui représente l'effet, immobile.
      // Lire, s'il le veut, est un geste volontaire.
      tRef.current = demande.still;
      setT(demande.still);
      setPlaying(false);
      setFige(true);
    }
    // Une seule lecture par `id` : les bornes sont dans la demande elle-même.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demandeId]);

  const toggle = useCallback(() => {
    if (total <= 0) return;
    if (fige) {
      // L'image figée REPRÉSENTE l'effet, ce n'est pas une tête de lecture :
      // Lire joue l'extrait depuis son début.
      tRef.current = debut;
      setT(debut);
      setFige(false);
      setPlaying(true);
      setDepart((n) => n + 1);
      return;
    }
    setPlaying((p) => !p);
  }, [total, fige, debut]);

  /** Depuis le début — de l'extrait armé, sinon du montage. */
  const rejouer = useCallback(() => {
    if (total <= 0) return;
    tRef.current = debut;
    setT(debut);
    setFige(false);
    setPlaying(true);
    setDepart((n) => n + 1);
  }, [total, debut]);

  /** Quitte l'extrait : le montage entier redevient ce que Lire joue. */
  const quitter = useCallback(() => {
    tRef.current = 0;
    setT(0);
    setPlaying(false);
    setFige(false);
    setExtrait(null);
    onFinRef.current?.();
  }, []);

  if (disabled || playable.length === 0) return null;

  const clock = sequenceClock(playable, t);
  const courante = playable[clock.index];
  const entrante = clock.nextIndex !== null ? playable[clock.nextIndex] : null;
  const styles = clock.inTransition
    ? transitionLayerStyles(extrait?.transition ?? transition, clock.transitionProgress, frame)
    : null;
  const label = SEQUENCE_LABELS[courante.key] ?? courante.key;
  /** La scène est visible en lecture, et figée sur demande. */
  const scene = playing || fige;
  const calque = (key: string, progress: number) =>
    renderLayer({ key, progress, ...(extrait?.textAnimation ? { textAnimation: extrait.textAnimation } : {}) });

  return (
    <div
      className="absolute inset-0"
      style={{ pointerEvents: 'none' }}
      data-sequence-playback
      data-sequence-playing={playing ? 'true' : 'false'}
      data-sequence-frozen={fige ? 'true' : 'false'}
      data-sequence-extract={extrait ? `${extrait.sequence}${extrait.next ? `>${extrait.next}` : ''}` : undefined}
    >
      {/* ── LA SCÈNE ──────────────────────────────────────────────────
          Rendue SEULEMENT en lecture — ou figée, quand l'utilisateur réduit
          les animations et vient de choisir un effet : à l'arrêt, le plateau
          de composition reste visible et éditable en dessous. Elle capte les
          pointeurs pendant la lecture — un glissement sur un calque en
          mouvement ne désignerait rien. */}
      {scene && (
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
            {calque(courante.key, clock.progress)}
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
              {calque(entrante.key, clock.transitionProgress * ENTERING_PROGRESS_RATIO)}
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
          d'éditable. De vrais boutons : clavier, mobile, lecteur d'écran. */}
      <div className="absolute bottom-2 left-2 z-40 flex items-center gap-1.5" style={{ pointerEvents: 'auto' }}>
        <button
          type="button"
          onClick={toggle}
          aria-pressed={playing}
          aria-label={
            playing
              ? 'Mettre en pause la lecture des séquences'
              : extrait ? 'Lire l’extrait' : 'Lire les séquences dans l’ordre du montage'
          }
          title={
            playing
              ? 'Pause — revenir à la vue de composition'
              : extrait ? 'Lire l’extrait de l’effet choisi' : 'Lire les séquences, avec leurs transitions'
          }
          data-play-sequences
          className={`flex items-center justify-center w-7 h-7 rounded-full backdrop-blur transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
            playing
              ? 'bg-purple-600/70 text-white ring-1 ring-purple-300/60'
              : 'bg-gray-900/70 text-gray-200 hover:text-white hover:bg-gray-800/80'
          }`}
        >
          {playing ? <Pause size={13} strokeWidth={2.2} /> : <Play size={13} strokeWidth={2.2} />}
        </button>
        {/* Rejouer — dès qu'il y a quelque chose à reprendre du début. */}
        {(extrait || t > 0) && (
          <button
            type="button"
            onClick={rejouer}
            aria-label={extrait ? 'Rejouer l’extrait' : 'Rejouer depuis le début'}
            title={extrait ? 'Rejouer l’extrait depuis son début' : 'Rejouer le montage depuis le début'}
            data-replay-sequences
            className="flex items-center justify-center w-7 h-7 rounded-full bg-gray-900/70 text-gray-200 backdrop-blur transition hover:text-white hover:bg-gray-800/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
          >
            <RotateCcw size={13} strokeWidth={2.2} />
          </button>
        )}
        {/* Quitter l'extrait — à l'arrêt seulement : en lecture, Pause d'abord. */}
        {extrait && !playing && (
          <button
            type="button"
            onClick={quitter}
            aria-label="Quitter l’extrait — revenir au plateau"
            title="Quitter l’extrait : Lire rejouera le montage entier"
            data-quit-extract
            className="flex items-center justify-center w-7 h-7 rounded-full bg-gray-900/70 text-gray-200 backdrop-blur transition hover:text-white hover:bg-gray-800/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
          >
            <X size={13} strokeWidth={2.2} />
          </button>
        )}
        {scene && (
          <span
            className="rounded-md bg-gray-900/70 px-1.5 py-0.5 text-[10px] font-medium text-gray-200 backdrop-blur"
            data-playback-label
            aria-live="polite"
          >
            {label}
            {entrante && ` → ${SEQUENCE_LABELS[entrante.key] ?? entrante.key}`}
            {fige && ' · image figée'}
          </span>
        )}
      </div>
    </div>
  );
}
