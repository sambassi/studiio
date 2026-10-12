'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Film, ImageIcon, Info, Loader2, Pause, Play, X, type LucideIcon } from 'lucide-react';
import { LIBELLES_ORIGINE, dureeLisible, type OrigineMedia } from '@/lib/medias/libelles';
import MiniatureVideo from '@/components/medias/MiniatureVideo';

/**
 * CARTE MÉDIA — un média montré comme un média : une vignette, sa durée, ce
 * qu'il est pour l'utilisateur (« Rush personnel », « Vidéo suggérée »…) et
 * des actions nommées. Jamais un nom de fichier en libellé (il ne vit que
 * dans l'attribut `title`), jamais le nom d'un fournisseur hors crédits.
 *
 * ⚠️ AUCUNE NAVIGATION. « Aperçu » (ou un clic sur la vignette) ouvre un
 * lecteur DANS la page — muet, Lecture / Pause, cadré en « cover ». Pas de
 * lien, pas de `window.open`. Le seul lien sortant est celui des crédits,
 * révélé par un clic explicite sur « Informations du média ».
 *
 * ⚠️ PRÉSENTATION SEULE. La carte n'enregistre rien : chaque action appelle
 * le chemin EXISTANT de l'écran qui l'utilise (suppression, conservation…).
 *
 * Partagé : l'Autopilote l'utilise ; Créer pourra le reprendre tel quel.
 */

/** L'attribution exigée par les banques d'images — montrée seulement à la demande. */
export interface CreditMediaCarte {
  texte: string;
  /** Page du média chez la plateforme — un lien, jamais ouvert sans clic. */
  lien?: string | null;
}

export interface ActionCarte {
  cle: string;
  libelle: string;
  icone: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  /** Une action en cours (import…) : l'icône devient un indicateur. */
  enCours?: boolean;
  ariaLabel?: string;
  titre?: string;
  variante?: 'principal' | 'neutre' | 'danger' | 'fait';
  attrs?: Record<string, string>;
}

export interface MediaApercu {
  url: string;
  type: 'video' | 'photo';
  vignetteUrl?: string | null;
  libelle: string;
  credit?: CreditMediaCarte | null;
}

function lancer(v: HTMLVideoElement | null) {
  if (!v) return;
  try {
    const p = v.play?.();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch { /* lecture refusée : le bouton reste disponible */ }
}

/** « Informations du média » — l'attribution, repliée tant qu'on ne la demande pas. */
export function InformationsMedia({ credit }: { credit: CreditMediaCarte }) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <div className="text-[10px] text-gray-500" data-credit-media>
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-expanded={ouvert}
        data-carte-informations
        className="flex items-center gap-1 hover:text-gray-300"
      >
        <Info className="w-3 h-3" /> Informations du média
      </button>
      {ouvert && (
        <p className="mt-1 break-words" data-carte-credit>
          {credit.texte}
          {credit.lien ? (
            <>
              {' · '}
              <a href={credit.lien} target="_blank" rel="noopener noreferrer" className="underline hover:text-white" data-carte-credit-lien>
                Voir la page du média
              </a>
            </>
          ) : null}
        </p>
      )}
    </div>
  );
}

/**
 * Le lecteur d'aperçu — une fenêtre dans la page (portail sur `body`),
 * fermée par Échap, le bouton ou un clic hors du lecteur.
 */
export function ApercuMedia({ media, onFermer }: { media: MediaApercu; onFermer: () => void }) {
  const video = useRef<HTMLVideoElement | null>(null);
  const [lecture, setLecture] = useState(true);
  const [prete, setPrete] = useState(false);

  useEffect(() => {
    const touche = (e: KeyboardEvent) => { if (e.key === 'Escape') onFermer(); };
    window.addEventListener('keydown', touche);
    return () => window.removeEventListener('keydown', touche);
  }, [onFermer]);

  useEffect(() => {
    if (media.type !== 'video') return;
    if (lecture) lancer(video.current);
    else video.current?.pause?.();
  }, [lecture, media.type]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onFermer}
      data-carte-apercu-fenetre
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Aperçu — ${media.libelle}`}
        className="w-full max-w-sm rounded-xl border border-gray-800 bg-gray-950 p-3 space-y-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-gray-200 min-w-0 truncate">{media.libelle}</p>
          <button type="button" onClick={onFermer} aria-label="Fermer l’aperçu" data-carte-apercu-fermer className="shrink-0 text-gray-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="relative w-full overflow-hidden rounded-lg bg-gray-900" style={{ height: 'min(60vh, 520px)' }}>
          {media.type === 'video' ? (
            <>
              <video
                ref={video}
                src={media.url}
                poster={media.vignetteUrl || undefined}
                muted
                playsInline
                loop
                autoPlay
                preload="metadata"
                onLoadedData={() => setPrete(true)}
                className="absolute inset-0 h-full w-full object-cover"
                data-carte-apercu-video
              />
              <button
                type="button"
                onClick={() => setLecture((l) => !l)}
                aria-label={lecture ? 'Pause' : 'Lecture'}
                data-carte-apercu-lecture={lecture ? 'lecture' : 'pause'}
                className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white hover:bg-black/80"
              >
                {lecture ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                {lecture ? 'Pause' : 'Lecture'}
              </button>
              {!prete && (
                <span className="pointer-events-none absolute right-2 top-2 text-gray-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /></span>
              )}
            </>
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={media.url} alt={media.libelle} className="absolute inset-0 h-full w-full object-cover" data-carte-apercu-image />
          )}
        </div>
        {media.credit ? <InformationsMedia credit={media.credit} /> : null}
      </div>
    </div>,
    document.body,
  );
}

const CLASSES_ACTION: Record<NonNullable<ActionCarte['variante']>, string> = {
  principal: 'text-white',
  neutre: 'border border-gray-800 text-gray-300 hover:text-white',
  danger: 'border border-gray-800 text-gray-300 hover:text-red-400',
  fait: 'text-emerald-400',
};

export default function CarteMedia({
  url, type, vignetteUrl, origine, libelle, nomTechnique, dureeSecondes, credit, badges, alerte, actions = [],
  accent, attrs, vignetteAttrs, ratio = '4 / 5', apercuUrl, sansApercu, metadonnees = true,
}: {
  /** Le média lui-même — lu par l'aperçu (et pour la première image d'une vidéo sans vignette). */
  url: string;
  type: 'video' | 'photo';
  vignetteUrl?: string | null;
  origine: OrigineMedia;
  /** Remplace le libellé de l'origine (rare). */
  libelle?: string;
  /** Nom de fichier — SEULEMENT dans `title`. */
  nomTechnique?: string;
  /** Durée connue d'avance (banque d'images) ; sinon lue sur les métadonnées. */
  dureeSecondes?: number | null;
  credit?: CreditMediaCarte | null;
  /** Pastilles d'état sous le libellé (expiré, accessible…). */
  badges?: ReactNode;
  /** Cadre ambré : le média pose un problème (expiré). */
  alerte?: boolean;
  actions?: ActionCarte[];
  accent?: string;
  attrs?: Record<string, string>;
  vignetteAttrs?: Record<string, string>;
  ratio?: string;
  /** Fichier lu par l'aperçu, s'il diffère de `url` (proposition pas encore importée). */
  apercuUrl?: string;
  sansApercu?: boolean;
  /**
   * Lire les métadonnées de la vidéo (première image + durée) quand la durée
   * n'est pas connue. `false` pour un média distant pas encore choisi : rien
   * n'est téléchargé avant un clic.
   */
  metadonnees?: boolean;
}) {
  const nom = libelle ?? LIBELLES_ORIGINE[origine];
  const [duree, setDuree] = useState<number | null>(dureeSecondes ?? null);
  const [videoKo, setVideoKo] = useState(false);
  const [apercu, setApercu] = useState(false);
  useEffect(() => { if (dureeSecondes) setDuree(dureeSecondes); }, [dureeSecondes]);
  const fermer = useCallback(() => setApercu(false), []);

  // Une vidéo SANS vignette fournie : miniature extraite une fois puis gardée
  // en cache (`useVignetteVideo`), qui donne aussi la durée et le ratio de la
  // source. Plus de `<video preload="metadata">` par carte : le relais privé
  // répond `no-store`, chaque affichage retéléchargeait le rush.
  const miniatureExtraite = metadonnees && type === 'video' && !vignetteUrl;
  // Une vidéo AVEC vignette mais sans durée lit encore ses métadonnées.
  const lireMetadonnees = metadonnees && type === 'video' && !!vignetteUrl && !dureeSecondes && !videoKo;
  const [ratioSource, setRatioSource] = useState<number | null>(null);
  const surInfos = useCallback((i: { ratio: number; duree: number | null }) => {
    setRatioSource(i.ratio);
    if (!dureeSecondes && i.duree && Number.isFinite(i.duree)) setDuree(i.duree);
  }, [dureeSecondes]);
  // Miniature extraite : le ratio de la SOURCE (16:9 tant qu'il est inconnu).
  const styleVignette: CSSProperties = { aspectRatio: miniatureExtraite ? String(ratioSource ?? 16 / 9) : ratio };
  const temps = dureeLisible(duree);

  return (
    <div
      className={`flex min-w-0 flex-col overflow-hidden rounded-lg border bg-gray-900 ${alerte ? 'border-amber-500/40' : 'border-gray-800'}`}
      title={nomTechnique}
      data-carte-media={origine}
      {...attrs}
    >
      <button
        type="button"
        onClick={() => { if (!sansApercu) setApercu(true); }}
        aria-label={`Aperçu — ${nom}`}
        className="relative block w-full overflow-hidden bg-gray-800"
        style={styleVignette}
        data-carte-vignette
        data-carte-ratio={miniatureExtraite ? String(ratioSource ?? 16 / 9) : undefined}
        tabIndex={sansApercu ? -1 : 0}
      >
        {miniatureExtraite ? (
          <MiniatureVideo url={url} onInfos={surInfos} className="pointer-events-none" style={{ position: 'absolute', inset: 0 }} attrs={{ 'data-carte-miniature': '' }} />
        ) : lireMetadonnees ? (
          <video
            src={`${url}#t=0.1`}
            poster={vignetteUrl || undefined}
            preload="metadata"
            muted
            playsInline
            onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d) && d > 0) setDuree(d); }}
            onError={() => setVideoKo(true)}
            className="absolute inset-0 h-full w-full object-cover pointer-events-none"
            data-carte-premiere-image
          />
        ) : vignetteUrl || type === 'photo' ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={vignetteUrl || url} alt={nom} className="absolute inset-0 h-full w-full object-cover" {...vignetteAttrs} />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-gray-500"><Film className="w-5 h-5" /></span>
        )}
        <span className="absolute bottom-1 left-1 flex items-center gap-1 rounded-full bg-black/65 px-1.5 py-0.5 text-[10px] text-white" data-carte-badge>
          {type === 'video' ? <Play className="w-2.5 h-2.5" /> : <ImageIcon className="w-2.5 h-2.5" />}
          {type === 'video' && temps ? <span data-carte-duree>{temps}</span> : null}
        </span>
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1 p-1.5">
        <p className="truncate text-[11px] font-medium text-gray-200" data-carte-libelle>{nom}</p>
        {badges}
        <div className="mt-auto flex flex-wrap gap-1">
          {!sansApercu && (
            <button
              type="button"
              onClick={() => setApercu(true)}
              aria-label={`Aperçu — ${nom}`}
              data-carte-apercu
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${CLASSES_ACTION.neutre}`}
            >
              <Play className="w-2.5 h-2.5" /> Aperçu
            </button>
          )}
          {actions.map((a) => {
            const Icone = a.icone;
            const variante = a.variante ?? 'neutre';
            return (
              <button
                key={a.cle}
                type="button"
                onClick={a.onClick}
                disabled={a.disabled}
                aria-label={a.ariaLabel}
                title={a.titre}
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium disabled:opacity-40 ${CLASSES_ACTION[variante]}`}
                style={variante === 'principal' && accent ? { backgroundColor: accent } : undefined}
                {...a.attrs}
              >
                {a.enCours ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Icone className="w-2.5 h-2.5" />} {a.libelle}
              </button>
            );
          })}
        </div>
      </div>
      {apercu && (
        <ApercuMedia
          media={{ url: apercuUrl ?? url, type, vignetteUrl, libelle: nom, credit }}
          onFermer={fermer}
        />
      )}
    </div>
  );
}

/** La grille des cartes — colonnes selon la largeur du CONTENEUR, pas de l'écran. */
export function GrilleMedias({ children, attrs, min = 104 }: { children: ReactNode; attrs?: Record<string, string>; min?: number }) {
  return (
    <ul className="grid gap-2 min-w-0" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${min}px, 100%), 1fr))` }} {...attrs}>
      {children}
    </ul>
  );
}
