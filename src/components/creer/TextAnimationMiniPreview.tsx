'use client';

import React from 'react';
import { revealText, textAnimationState, INTRO_WINDOW, type TextAnimation } from '@/lib/creer/textAnimation';
import TextAnimationLayer from '@/components/creer/TextAnimationLayer';
import { useLoopProgress } from '@/lib/hooks/useLoopProgress';

/** Texte d'exemple : court, pour qu'une frappe lettre à lettre se lise en une seconde. */
const EXEMPLE = 'Titre';

/**
 * Vignette animée d'une animation de texte.
 *
 * Le MÊME composant que le rendu serveur (`TextAnimationLayer`) et la MÊME
 * table de vérité que le canvas (`textAnimationState`, `revealText`) :
 * l'échantillon ne fait que parcourir l'avancement d'une séquence. Ce qui
 * apparaît ici est ce que la vidéo produira, aux dimensions près.
 *
 * L'avancement parcouru va de 0 à `INTRO_WINDOW` (la part de la séquence où
 * l'animation se joue) : au-delà, le texte est simplement là — inutile de
 * faire attendre l'œil sur une image fixe.
 *
 * Immobile, elle montre la fin de l'animation (texte entier), l'image qu'on
 * voit le plus longtemps dans la vidéo. `aria-hidden` : décorative.
 */
export default function TextAnimationMiniPreview({
  style,
  playing,
  height = 44,
}: {
  style: TextAnimation;
  playing: boolean;
  height?: number;
}) {
  // ~1 s de lecture, tenue aux deux bouts.
  const p = useLoopProgress(playing, 1000, 450, 1);
  // Avancement de SÉQUENCE : la fenêtre d'apparition entière est parcourue.
  const progress = p * INTRO_WINDOW;
  const reveal = textAnimationState(style, progress).charRatio;

  return (
    <span
      aria-hidden
      data-text-animation-mini={style}
      data-text-animation-mini-playing={playing ? 'true' : 'false'}
      style={{
        position: 'relative',
        display: 'block',
        width: Math.round(height * 1.6),
        height,
        flex: 'none',
        borderRadius: 4,
        overflow: 'hidden',
        background: 'linear-gradient(150deg, #7C3AED 0%, #EC4899 100%)',
        pointerEvents: 'none',
      }}
    >
      <TextAnimationLayer style={style} progress={progress}>
        <span
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: Math.max(9, Math.round(height * 0.3)),
            fontWeight: 800,
            color: '#FFFFFF',
            letterSpacing: '0.02em',
            lineHeight: 1,
            whiteSpace: 'pre',
          }}
        >
          {revealText(EXEMPLE, reveal)}
        </span>
      </TextAnimationLayer>
    </span>
  );
}
