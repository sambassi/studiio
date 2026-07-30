'use client';

import React, { useEffect, useRef, useState } from 'react';
import { gradeFrame } from '@/lib/luts/gradeFrame';
import type { Lut } from '@/lib/luts/types';

/**
 * Vidéo de l'aperçu, étalonnée par une LUT.
 *
 * La vidéo reste la source : c'est elle qui porte la lecture, la boucle et la
 * synchronisation. Quand une LUT est active, un canvas rejoue ses frames
 * étalonnées par-dessus, et la vidéo passe en `opacity: 0` — elle n'est
 * jamais retirée du DOM, sinon il n'y aurait plus rien à rejouer.
 *
 * **La vidéo n'est masquée qu'une fois une frame réellement étalonnée.** Sans
 * cette condition, un contexte 2D indisponible — vieux navigateur, mémoire
 * saturée — remplacerait le rush par un rectangle noir. Ici, le pire cas est
 * un aperçu non étalonné, ce que l'utilisateur peut comprendre.
 *
 * Le coût est négligeable : l'aperçu fait quelques centaines de pixels de
 * large, pas 1080. La vraie contrainte de performance est au rendu vidéo, et
 * elle se traite ailleurs.
 */
export default function GradedVideo({
  src,
  lut,
  intensity,
  style,
  onError,
}: {
  src: string;
  lut: Lut | null;
  intensity: number;
  style?: React.CSSProperties;
  onError?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Une frame étalonnée est-elle affichée ? Tant que non, la vidéo reste visible. */
  const [graded, setGraded] = useState(false);

  // Les valeurs vivantes passent par des refs : la boucle est montée une seule
  // fois, et changer l'intensité ne doit pas la relancer.
  const lutRef = useRef(lut);
  lutRef.current = lut;
  const intensityRef = useRef(intensity);
  intensityRef.current = intensity;

  useEffect(() => {
    if (!lut) {
      setGraded(false);
      return;
    }
    let frame = 0;
    let stopped = false;

    const tick = () => {
      if (stopped) return;
      frame = requestAnimationFrame(tick);
      const video = videoRef.current;
      const canvas = canvasRef.current;
      // `readyState` sous 2 : aucune donnée à peindre. Dessiner quand même
      // lèverait sur certains navigateurs et noircirait le canvas sur d'autres.
      if (!video || !canvas || video.readyState < 2) return;

      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      try {
        gradeFrame(ctx, video, lutRef.current, intensityRef.current, w, h);
      } catch {
        // Une frame ratée ne doit pas arrêter la boucle ni masquer la vidéo :
        // la suivante retentera.
        return;
      }
      setGraded(true);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      setGraded(false);
    };
  }, [lut]);

  const fill: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  };

  return (
    <>
      <video
        ref={videoRef}
        src={src}
        muted
        loop
        autoPlay
        playsInline
        preload="metadata"
        onError={onError}
        style={{ ...fill, ...style, opacity: graded ? 0 : 1 }}
      />
      {lut && (
        <canvas
          ref={canvasRef}
          aria-hidden
          style={{ ...fill, ...style, opacity: graded ? 1 : 0 }}
        />
      )}
    </>
  );
}
