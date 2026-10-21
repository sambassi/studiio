'use client';

/**
 * Galerie des STYLES VIDÉO de l'étape Style (Créer).
 *
 * Un clic pose les réglages du style (`appliquerStyle`) ; les réglages
 * avancés restent en dessous, intacts et modifiables. Une retouche manuelle
 * ultérieure est respectée et SIGNALÉE (« retouché ») plutôt qu'écrasée.
 *
 * Les exemples sont de VRAIS extraits rendus par le compositeur de Créer
 * (`public/styles-video/*.mp4`, régénérés par `e2e/banc/rendus/styles-video.sh`).
 * Lecture muette en boucle au survol ou au focus seulement — jamais
 * d'autoplay, jamais avec la réduction des animations ; poster image sinon.
 *
 * Re-cliquer le style choisi le retire : les réglages restent, seul le
 * rythme redevient celui déduit du thème.
 */
import { useRef } from 'react';
import { Check } from 'lucide-react';
import InfoBulle from '@/components/ui/InfoBulle';
import { classesCarteOption } from '@/lib/ui/etats';
import { usePrefersReducedMotion } from '@/lib/hooks/usePrefersReducedMotion';
import { STYLES_VIDEO, exempleStyle, type StyleVideo, type StyleVideoId } from '@/lib/styles-video/styles';

export interface GalerieStylesVideoProps {
  choisi: StyleVideoId | null;
  /** Réglages retouchés depuis le choix du style (libellés), vide sinon. */
  retouches: readonly string[];
  onChoisir: (id: StyleVideoId | null) => void;
}

function CarteStyle({ style, choisi, retouches, onChoisir, reduire }: {
  style: StyleVideo;
  choisi: boolean;
  retouches: readonly string[];
  onChoisir: (id: StyleVideoId | null) => void;
  reduire: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ex = exempleStyle(style.id);
  const lire = () => {
    const v = videoRef.current;
    if (!v || reduire) return;
    v.play().catch(() => { /* lecture refusée : le poster reste */ });
  };
  const arreter = () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    try { v.currentTime = 0; } catch { /* pas encore chargé */ }
  };
  return (
    <div className="relative min-w-0" data-style-video={style.id}>
      <button
        type="button"
        onClick={() => onChoisir(choisi ? null : style.id)}
        onMouseEnter={lire}
        onMouseLeave={arreter}
        onFocus={lire}
        onBlur={arreter}
        aria-pressed={choisi}
        aria-label={`Style ${style.libelle}${choisi ? ' (choisi)' : ''}`}
        className={`w-full min-w-0 flex flex-col rounded-lg border p-1.5 text-left ${classesCarteOption(choisi)}`}
      >
        <span className="relative block w-full overflow-hidden rounded-md bg-black" style={{ aspectRatio: '9 / 12' }}>
          <video
            ref={videoRef}
            src={ex.video}
            poster={ex.poster}
            muted
            loop
            playsInline
            preload="none"
            aria-hidden="true"
            tabIndex={-1}
            className="absolute inset-0 h-full w-full object-cover"
          />
          {choisi && (
            <span className="absolute top-1 left-1 flex h-4 w-4 items-center justify-center rounded-full bg-studiio-primary text-white" data-coche>
              <Check size={10} strokeWidth={3} aria-hidden="true" />
            </span>
          )}
        </span>
        <span className="mt-1.5 block truncate text-[11px] font-semibold text-white">{style.libelle}</span>
        <span className="block text-[10px] leading-snug text-gray-400 line-clamp-2">{style.description}</span>
        {choisi && retouches.length > 0 && (
          <span className="mt-0.5 block truncate text-[10px] text-amber-300" data-style-retouche>
            Retouché : {retouches.join(', ')}
          </span>
        )}
      </button>
      <span className="absolute top-2 right-2">
        <InfoBulle label={`Détail du style ${style.libelle}`} titre={style.libelle} marqueur={`style-info-${style.id}`}>
          {style.detail.map((l) => <span key={l} className="block">{l}</span>)}
          <span className="block mt-1 text-gray-400">
            Le style pose des réglages de départ ; tout reste modifiable ci-dessous. Texte, voix, musique, couleurs et durées ne changent pas.
          </span>
        </InfoBulle>
      </span>
    </div>
  );
}

export default function GalerieStylesVideo({ choisi, retouches, onChoisir }: GalerieStylesVideoProps) {
  const reduire = usePrefersReducedMotion();
  return (
    <div role="group" aria-label="Styles vidéo" className="grid grid-cols-3 gap-2" data-galerie-styles>
      {STYLES_VIDEO.map((s) => (
        <CarteStyle
          key={s.id}
          style={s}
          choisi={choisi === s.id}
          retouches={choisi === s.id ? retouches : []}
          onChoisir={onChoisir}
          reduire={reduire}
        />
      ))}
    </div>
  );
}
