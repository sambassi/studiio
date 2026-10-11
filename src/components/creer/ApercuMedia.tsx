'use client';

/**
 * APERÇU DU MÉDIA — ce que l'on regarde AVANT de l'ajouter au projet.
 *
 * Un clic sur une vignette suggérée SÉLECTIONNE le média et le montre ici :
 * il ne l'ajoute pas, n'ouvre aucun onglet, ne quitte pas la page. Seul
 * « Ajouter au projet » ajoute.
 *
 * - Vidéo : un vrai `<video>`, MUET par défaut (politique autoplay), avec
 *   lecture/pause, durée et une barre de progression légère.
 * - Photo : la vraie image.
 * - Les deux remplissent le cadre au ratio du projet (9:16, 16:9, 1:1) en
 *   « cover » : jamais déformées.
 *
 * ⚠️ LA SOURCE TECHNIQUE NE SE VOIT PAS. Le nom du fournisseur n'apparaît
 * que dans « Informations du média », repliée : c'est le crédit exigé par
 * les conditions des banques d'images, et ses liens ne s'ouvrent que sur un
 * clic explicite.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Info, Loader2, Pause, Play, Plus, RefreshCw } from 'lucide-react';

export type FormatApercuMedia = '9:16' | '16:9' | '1:1';

export interface CreditMedia {
  auteur: string;
  auteurUrl?: string;
  /** Page du média chez la banque d'images. */
  sourceUrl: string;
  /** Nom affichable de la banque — n'apparaît QUE dans le crédit. */
  banque: string;
  /** Page d'accueil de la banque (lien du crédit). */
  banqueUrl: string;
}

export interface MediaApercu {
  type: 'video' | 'photo';
  /** Vidéo : le fichier lisible. Photo : l'image affichée en grand. */
  url: string;
  /** Image d'attente d'une vidéo. */
  posterUrl?: string;
  /** Libellé lisible (« Vidéo suggérée ») — jamais un nom de fichier. */
  libelle: string;
  /** Nom technique, gardé pour l'infobulle seulement. */
  nomTechnique?: string;
  dureeSecondes?: number;
  credit?: CreditMedia | null;
}

export type EtatAjoutMedia = 'pret' | 'en-cours' | 'ajoute';

export function formatDuree(s?: number | null): string {
  if (!s || !Number.isFinite(s) || s < 0) return '0:00';
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

const RATIO: Record<FormatApercuMedia, string> = { '9:16': '9 / 16', '16:9': '16 / 9', '1:1': '1 / 1' };

export interface ApercuMediaProps {
  media: MediaApercu;
  format: FormatApercuMedia;
  etat?: EtatAjoutMedia;
  onAjouter?: () => void;
  onRemplacer?: () => void;
  onRetour?: () => void;
  /** Libellé du bouton d'ajout (« Ajouter au projet » par défaut). */
  libelleAjouter?: string;
  /** Largeur maximale du cadre, en pixels (le cadre reste au ratio). */
  largeurMax?: number;
}

export default function ApercuMedia({
  media, format, etat = 'pret', onAjouter, onRemplacer, onRetour, libelleAjouter = 'Ajouter au projet', largeurMax,
}: ApercuMediaProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [lecture, setLecture] = useState(false);
  const [temps, setTemps] = useState(0);
  const [duree, setDuree] = useState<number>(media.dureeSecondes ?? 0);

  // Un autre média : on repart de zéro, à l'arrêt.
  useEffect(() => {
    setLecture(false);
    setTemps(0);
    setDuree(media.dureeSecondes ?? 0);
  }, [media.url, media.dureeSecondes]);

  const basculer = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      // `play()` rend une promesse : une pause avant sa résolution lève
      // AbortError, normal ici — silencé.
      const p = v.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
      setLecture(true);
    } else {
      v.pause();
      setLecture(false);
    }
  };

  const progression = duree > 0 ? Math.min(100, (temps / duree) * 100) : 0;
  const ajoute = etat === 'ajoute';

  return (
    <section data-apercu-media={media.type} aria-label="Aperçu du média" className="space-y-2">
      <header className="flex items-center gap-2">
        <h3 className="flex-1 text-[11px] uppercase tracking-wider text-gray-400">Aperçu du média</h3>
        {onRetour && (
          <button
            type="button"
            onClick={onRetour}
            data-apercu-media-retour
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-gray-400 hover:text-white hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Retour à l’aperçu du projet
          </button>
        )}
      </header>

      <div
        data-apercu-media-cadre={format}
        className="relative mx-auto w-full overflow-hidden rounded-xl bg-black border border-gray-800"
        style={{ aspectRatio: RATIO[format], maxWidth: largeurMax ? `${largeurMax}px` : undefined }}
      >
        {media.type === 'video' ? (
          <>
            <video
              ref={videoRef}
              src={media.url}
              poster={media.posterUrl}
              muted
              playsInline
              preload="metadata"
              loop
              data-apercu-media-video
              onLoadedMetadata={(e) => {
                const d = (e.currentTarget as HTMLVideoElement).duration;
                if (Number.isFinite(d) && d > 0) setDuree(d);
              }}
              onTimeUpdate={(e) => setTemps((e.currentTarget as HTMLVideoElement).currentTime)}
              onPause={() => setLecture(false)}
              onPlay={() => setLecture(true)}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
            <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent px-2 pb-2 pt-6">
              <button
                type="button"
                onClick={basculer}
                data-apercu-media-lecture
                aria-label={lecture ? 'Mettre en pause' : 'Lire la vidéo'}
                title={lecture ? 'Pause' : 'Lecture'}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/90 text-black hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400"
              >
                {lecture ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </button>
              <div className="relative h-1 flex-1 rounded-full bg-white/25" aria-hidden>
                <div data-apercu-media-progression className="absolute inset-y-0 left-0 rounded-full bg-white" style={{ width: `${progression}%` }} />
              </div>
              <span data-apercu-media-duree className="shrink-0 text-[11px] tabular-nums text-white">
                {formatDuree(temps)} / {formatDuree(duree)}
              </span>
            </div>
          </>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={media.url}
            alt={media.libelle}
            data-apercu-media-image
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        )}
      </div>

      <p className="truncate text-xs text-gray-300" title={media.nomTechnique || undefined} data-apercu-media-libelle>
        {media.libelle}
        {media.type === 'video' && duree > 0 && <span className="text-gray-500"> · {formatDuree(duree)}</span>}
      </p>

      {(onAjouter || onRemplacer) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {onAjouter && (
            <button
              type="button"
              onClick={onAjouter}
              disabled={ajoute || etat === 'en-cours'}
              data-apercu-media-ajouter
              aria-label={ajoute ? 'Déjà ajouté au projet' : libelleAjouter}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-purple-600 px-3 py-2 text-xs font-medium text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-300 transition-colors"
            >
              {etat === 'en-cours' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : ajoute ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
              {ajoute ? 'Ajouté' : libelleAjouter}
            </button>
          )}
          {onRemplacer && (
            <button
              type="button"
              onClick={onRemplacer}
              data-apercu-media-remplacer
              title="Choisir un autre média"
              aria-label="Remplacer : choisir un autre média"
              className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-800 px-3 py-2 text-xs text-gray-300 hover:text-white hover:border-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Remplacer
            </button>
          )}
        </div>
      )}

      {media.credit && (
        <details data-media-infos className="group rounded-lg text-[11px] text-gray-500">
          <summary className="flex cursor-pointer list-none items-center gap-1 hover:text-gray-300">
            <Info className="w-3 h-3" />
            Informations du média
          </summary>
          <p data-credit-media className="mt-1 pl-4">
            {media.type === 'video' ? 'Vidéo' : 'Photo'} de{' '}
            {media.credit.auteurUrl ? (
              <a href={media.credit.auteurUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-white">
                {media.credit.auteur || 'auteur inconnu'}
              </a>
            ) : (
              <a href={media.credit.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-white">
                {media.credit.auteur || 'auteur inconnu'}
              </a>
            )}{' '}
            sur{' '}
            <a href={media.credit.banqueUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-white">
              {media.credit.banque}
            </a>
          </p>
        </details>
      )}
    </section>
  );
}
