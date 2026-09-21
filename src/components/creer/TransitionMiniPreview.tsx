'use client';

import React from 'react';
import type { TransitionStyle } from '@/lib/video-composer';
import { transitionLayerStyles, TRANSITION_DURATION_SECONDS } from '@/lib/creer/transitionPreview';
import { useLoopProgress } from '@/lib/hooks/useLoopProgress';

/**
 * Vignette animée d'une transition — deux plateaux « A » et « B ».
 *
 * Elle rejoue les MÊMES calculs que le compositeur (`transitionLayerStyles`
 * transcrit `drawTransition` case par case) sur deux tuiles de couleur : ce
 * qu'elle montre est la géométrie réelle de l'effet — sens du glissement,
 * volet, iris, flou — pas une illustration approchée.
 *
 * ⚠️ DÉCORATIVE. `aria-hidden` et inerte aux pointeurs : le bouton qui la
 * contient porte déjà le libellé et l'état ; une vignette lue par un lecteur
 * d'écran n'ajouterait que du bruit.
 *
 * Immobile, elle montre l'INSTANT MÉDIAN (t = 0,5) : c'est là que chaque
 * style se distingue le mieux — un fondu à moitié, un volet à mi-course.
 */
export default function TransitionMiniPreview({
  style,
  playing,
  aspect = '9 / 16',
  height = 44,
}: {
  style: TransitionStyle;
  /** Anime la vignette ; sinon, image fixe à mi-transition. */
  playing: boolean;
  /** Ratio CSS du cadre (`ASPECT_CSS` de l'éditeur) — `9 / 16`, `1 / 1`, `16 / 9`. */
  aspect?: string;
  /** Hauteur en pixels d'écran ; la largeur suit le ratio. */
  height?: number;
}) {
  // La vraie durée de la fenêtre (0,8 s), tenue aux deux bouts pour que
  // l'œil sépare une lecture de la suivante.
  const t = useLoopProgress(playing, TRANSITION_DURATION_SECONDS * 1000, 450, 0.5);
  const [num, den] = aspect.split('/').map((s) => Number(s.trim()));
  const ratio = num > 0 && den > 0 ? num / den : 9 / 16;
  // En paysage, c'est la LARGEUR qui est bornée : une tuile 16:9 de 40 px de
  // haut ferait 71 px de large et pousserait le libellé à la ligne dans une
  // cellule de grille à largeur de téléphone. Le ratio, lui, est respecté.
  const LARGEUR_MAX = 48;
  let width = Math.round(height * ratio);
  let hauteur = height;
  if (width > LARGEUR_MAX) {
    width = LARGEUR_MAX;
    hauteur = Math.round(LARGEUR_MAX / ratio);
  }
  // Le cadre représente une vidéo de 1080 de large : le flou vidéo est
  // ramené à l'échelle de la vignette, comme sur le plateau.
  const w = ratio >= 1 ? 1920 : 1080;
  const styles = transitionLayerStyles(style, t, { w, h: Math.round(w / ratio), scale: width / w });

  const tuile: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: Math.max(9, Math.round(hauteur * 0.32)),
    fontWeight: 800,
    color: 'rgba(255,255,255,0.9)',
    lineHeight: 1,
    transformOrigin: 'center center',
  };

  return (
    <span
      aria-hidden
      data-transition-mini={style}
      data-transition-mini-playing={playing ? 'true' : 'false'}
      style={{
        position: 'relative',
        display: 'block',
        width,
        height: hauteur,
        flex: 'none',
        borderRadius: 4,
        overflow: 'hidden',
        backgroundColor: '#0A0A0F',
        pointerEvents: 'none',
      }}
    >
      {styles.black && (
        <span style={{ position: 'absolute', inset: 0, backgroundColor: '#000000' }} />
      )}
      <span
        data-transition-mini-layer="a"
        style={{ ...tuile, background: 'linear-gradient(150deg, #7C3AED 0%, #EC4899 100%)', ...styles.a }}
      >
        A
      </span>
      <span
        data-transition-mini-layer="b"
        style={{ ...tuile, background: 'linear-gradient(150deg, #0EA5E9 0%, #2563EB 100%)', ...styles.b }}
      >
        B
      </span>
    </span>
  );
}
