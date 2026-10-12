'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import { Film } from 'lucide-react';
import { useVignetteVideo } from '@/lib/hooks/useVignetteVideo';

/**
 * MINIATURE D'UNE VIDÉO — l'image extraite une fois (`vignette-video.ts`),
 * jamais un `<video>` qui retélécharge le rush à chaque affichage.
 *
 * Trois états, tous de la même taille que la case : l'image ; une icône
 * pendant l'extraction ; « Aperçu indisponible » si elle échoue — la liste
 * autour ne bouge pas.
 *
 * `compact` : case d'icône (7×7, 12×16…) — pas de texte, seulement l'icône
 * et une infobulle.
 */
export default function MiniatureVideo({
  url, compact = false, className = '', style, onInfos, attrs,
}: {
  url: string | null | undefined;
  compact?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Ratio (l/h) et durée de la source, dès qu'ils sont connus. */
  onInfos?: (infos: { ratio: number; duree: number | null }) => void;
  attrs?: Record<string, string>;
}) {
  const e = useVignetteVideo(url);
  const vignette = e.etat === 'pret' ? e.vignette : null;
  // Le rappel du parent change à chaque rendu : on ne relance que sur la vignette.
  const rappel = useRef(onInfos);
  rappel.current = onInfos;
  useEffect(() => {
    if (vignette) rappel.current?.({ ratio: vignette.ratio, duree: vignette.duree });
  }, [vignette]);

  const base = `overflow-hidden bg-gray-800 ${className}`;
  // Position en style (et non en classe) : l'appelant peut la remplacer sans conflit d'utilitaires.
  const pos: CSSProperties = { position: 'relative', ...style };
  if (vignette) {
    return (
      <span className={base} style={{ display: 'block', ...pos }} data-miniature-video="pret" {...attrs}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={vignette.url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      </span>
    );
  }
  const echec = e.etat === 'echec';
  return (
    <span
      className={`${base} flex flex-col items-center justify-center text-gray-500`}
      style={{ gap: 4, ...pos }}
      data-miniature-video={echec ? 'echec' : 'chargement'}
      title={echec ? 'Aperçu indisponible' : undefined}
      {...attrs}
    >
      <Film className={compact ? 'w-3.5 h-3.5' : 'w-5 h-5'} style={echec ? undefined : { opacity: 0.6 }} />
      {echec && !compact && (
        <span className="text-[10px] leading-tight text-gray-500" data-miniature-video-indisponible>Aperçu indisponible</span>
      )}
    </span>
  );
}
